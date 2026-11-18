// "Copy for email": one map image of the whole trip plus the leg details, as HTML that pastes into Gmail.
// The image travels inside the HTML as a data: URI, the same way OneNote's clipboard carries pictures;
// Gmail turns it into an inline image. No storage or Google calls: the map is drawn from the same
// OpenStreetMap / OpenTopoMap tiles the app shows (both allow cross-origin use, so the canvas exports).
import { shortStopName, formatDuration, escapeXml as esc } from './routing.mjs';

const TILE = 256;
const TILE_SOURCES = {
  standard: { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, credit: '© OpenStreetMap contributors' },
  terrain: { url: (z, x, y) => `https://${'abc'[(x + y) % 3]}.tile.opentopomap.org/${z}/${x}/${y}.png`, credit: '© OpenStreetMap, SRTM | OpenTopoMap (CC-BY-SA)' },
};

// Web Mercator world pixel coordinates at zoom z.
export const project = (lat, lon, z) => {
  const size = TILE * 2 ** z;
  const sin = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360 * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
};

// The highest zoom at which every point fits in the image, with the image height following the trip's shape.
export function fitView(points, { width = 720, minHeight = 400, maxHeight = 900, pad = 36, maxZoom = 15 } = {}) {
  const lats = points.map(p => p[0]), lons = points.map(p => p[1]);
  const [north, south, west, east] = [Math.max(...lats), Math.min(...lats), Math.min(...lons), Math.max(...lons)];
  for (let z = maxZoom; z >= 1; z--) {
    const [left, top] = project(north, west, z);
    const [right, bottom] = project(south, east, z);
    if (z > 1 && (right - left > width - 2 * pad || bottom - top > maxHeight - 2 * pad)) continue;
    const height = Math.min(maxHeight, Math.max(minHeight, Math.ceil(bottom - top + 2 * pad)));
    return { z, width, height, left: Math.round((left + right - width) / 2), top: Math.round((top + bottom - height) / 2) };
  }
}

const browserCanvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
const browserImage = url => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const timer = setTimeout(() => reject(new Error('Map tile timed out.')), 10000);
  img.onload = () => { clearTimeout(timer); resolve(img); };
  img.onerror = () => { clearTimeout(timer); reject(new Error('Map tile failed.')); };
  img.src = url;
});

// Draws every leg on one map. Returns { src, width, height } with src a JPEG data: URI.
export async function renderMapImage(trip, { createCanvas = browserCanvas, loadImage = browserImage } = {}) {
  const view = fitView(trip.segments.flatMap(s => s.points));
  const source = TILE_SOURCES[trip.mapStyle] || TILE_SOURCES.standard;
  const canvas = createCanvas(view.width, view.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e9e5dc';
  ctx.fillRect(0, 0, view.width, view.height);

  const count = 2 ** view.z, tiles = [];
  for (let ty = Math.floor(view.top / TILE); ty <= Math.floor((view.top + view.height - 1) / TILE); ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(view.left / TILE); tx <= Math.floor((view.left + view.width - 1) / TILE); tx++) {
      tiles.push({ url: source.url(view.z, ((tx % count) + count) % count, ty), x: tx * TILE - view.left, y: ty * TILE - view.top });
    }
  }
  await Promise.all(tiles.map(async t => { try { ctx.drawImage(await loadImage(t.url), t.x, t.y, TILE, TILE); } catch { /* leave background */ } }));

  const xy = (lat, lon) => { const [x, y] = project(lat, lon, view.z); return [x - view.left, y - view.top]; };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const s of trip.segments) {
    const path = () => { ctx.beginPath(); s.points.forEach((p, i) => { const [x, y] = xy(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
    path(); ctx.strokeStyle = 'rgba(23, 32, 24, .35)'; ctx.lineWidth = 9; ctx.stroke();
    path(); ctx.strokeStyle = s.color; ctx.lineWidth = 5; ctx.stroke();
  }

  // Waypoints and their labels, skipping duplicates and labels that would overlap one already drawn.
  const seen = new Set(), placed = [];
  ctx.font = '600 12px Arial, Helvetica, sans-serif';
  ctx.textBaseline = 'alphabetic';
  for (const s of trip.segments) {
    for (const stop of s.stops) {
      const key = `${stop.lat.toFixed(5)},${stop.lon.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [x, y] = xy(stop.lat, stop.lon);
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = s.color; ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
      const label = shortStopName(stop.name);
      const w = ctx.measureText(label).width;
      const box = { x: Math.min(x + 7, view.width - w - 4), y: y - 20, w, h: 15 };
      if (box.x < 2 || box.y < 2 || placed.some(b => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h)) continue;
      placed.push(box);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255, 255, 255, .9)'; ctx.strokeText(label, box.x, y - 8);
      ctx.fillStyle = '#1d241e'; ctx.fillText(label, box.x, y - 8);
    }
  }

  ctx.font = '11px Arial, Helvetica, sans-serif';
  const creditWidth = ctx.measureText(source.credit).width;
  ctx.fillStyle = 'rgba(255, 255, 255, .8)';
  ctx.fillRect(view.width - creditWidth - 10, view.height - 17, creditWidth + 10, 17);
  ctx.fillStyle = '#333333';
  ctx.fillText(source.credit, view.width - creditWidth - 5, view.height - 5);

  return { src: canvas.toDataURL('image/jpeg', 0.88), width: view.width, height: view.height };
}

const miles = meters => `${(meters / 1609.344).toFixed(1)} mi`;

// HTML and plain text for the email. image: { src, width, height } or null; link: saved trip URL or null.
export function emailParts(trip, { image = null, link = null } = {}) {
  const legs = trip.segments;
  const partial = legs.some(s => s.distance === null || s.duration === null);
  const summary = `${legs.length} ${legs.length === 1 ? 'leg' : 'legs'} · ${miles(legs.reduce((n, s) => n + (s.distance || 0), 0))}`
    + ` · ${formatDuration(legs.reduce((n, s) => n + (s.duration || 0), 0))} riding${partial ? ' (totals exclude unknown values)' : ''}`;
  const legLine = s => {
    const ends = s.startName || s.endName ? `${shortStopName(s.startName)} → ${shortStopName(s.endName)}` : '';
    const size = `${s.distance === null ? 'distance unknown' : miles(s.distance)} · ${s.duration === null ? 'time unknown' : formatDuration(s.duration)}`;
    return { ends, size, stops: s.stops.slice(1, -1).map(p => shortStopName(p.name)) };
  };

  // Leg photos go at the end, each headed "Leg 2 - Smoke On The River - caption".
  const photos = legs.filter(s => s.photo?.src);
  const photoTitle = s => [s.title, s.endName && shortStopName(s.endName), s.photoCaption].filter(Boolean).join(' - ');
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#202124">',
    `<p style="margin:0 0 4px;font-size:20px;font-weight:bold">${esc(trip.title)}</p>`,
    trip.notes ? `<p style="margin:0 0 4px">${esc(trip.notes).replace(/\r?\n/g, '<br>')}</p>` : '',
    `<p style="margin:0 0 10px;color:#5f6368">${esc(summary)}</p>`,
    image ? `<p style="margin:0 0 12px"><img src="${image.src}" width="${image.width}" height="${image.height}" alt="${esc(`Route map: ${trip.title}`)}" style="max-width:100%;height:auto"></p>` : '',
    ...legs.map(s => {
      const { ends, size, stops } = legLine(s);
      return `<p style="margin:0 0 10px"><span style="color:${s.color};font-size:16px">■</span> <b>${esc(s.title)}</b>`
        + `${ends ? `: ${esc(ends)}` : ''} · ${esc(size)}`
        + (s.note ? `<br>${esc(s.note).replace(/\r?\n/g, '<br>')}` : '')
        + (stops.length ? `<br><span style="color:#5f6368">Stops: ${esc(stops.join(', '))}</span>` : '')
        + (s.sourceUrl ? `<br>Google Maps: <a href="${esc(s.sourceUrl)}">${esc(s.sourceUrl)}</a>` : '')
        + '</p>';
    }),
    link ? `<p style="margin:12px 0 0">Whole ride in Route Exporter: <a href="${esc(link)}">${esc(trip.title)}</a></p>` : '',
    ...photos.map(s => {
      const width = Math.min(600, s.photo.width), height = Math.round(s.photo.height * width / s.photo.width);
      return `<p style="margin:18px 0 6px;font-weight:bold">${esc(photoTitle(s))}</p>`
        + `<p style="margin:0"><img src="${s.photo.src}" width="${width}" height="${height}" alt="${esc(photoTitle(s))}" style="max-width:100%;height:auto"></p>`;
    }),
    '</div>',
  ].join('');

  // '' is a blank separator line; null is an absent line.
  const lines = [trip.title, trip.notes || null, summary];
  for (const s of legs) {
    const { ends, size, stops } = legLine(s);
    lines.push('', `${s.title}${ends ? `: ${ends}` : ''} · ${size}`, s.note || null,
      stops.length ? `Stops: ${stops.join(', ')}` : null, s.sourceUrl ? `Google Maps: ${s.sourceUrl}` : null);
  }
  if (link) lines.push('', `Whole ride in Route Exporter: ${link}`);
  if (photos.length) lines.push('', ...photos.map(s => `Photo: ${photoTitle(s)}`));
  const text = lines.filter(line => line !== null).join('\n');

  return { html, text };
}
