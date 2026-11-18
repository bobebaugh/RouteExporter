// Create a saved trip from Google Maps directions links without the browser.
//
//   node scripts/import-trip.mjs <recipe.json> [--create] [--out trip.kml] [--base https://...]
//
// The recipe is the version-2 trip format in trips/new-england-2027.json:
//   { "version": 2, "title": "...", "notes": "...", "mapStyle": "standard",
//     "segments": [ { "title": "Leg 1", "note": "", "avoidHighways": false, "sourceUrl": "https://maps.app.goo.gl/..." } ] }
// Only title and each segment's sourceUrl are required; color defaults to the app's palette.
// Optional "folder" ("Tampa Weekly/2026") and "rideDate" ("2026-03-27"; defaults to a date in the title).
//
// Each leg goes through the site's own routing and unshorten functions using app/routing.mjs
// (one Google Routes call per leg, as with Add route), then app/kml.mjs builds the KML the app saves.
// Without --create nothing is written online. With --create it refuses if a saved trip already has
// the same title, creates a NEW trip (never updates or deletes one), reads it back and compares.
// --base defaults to production; use the pilot URL to try things against the pilot's separate store.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = name => { const i = args.indexOf(name); return i >= 0 && args.splice(i, 1).length > 0; };
const base = (option('--base') || 'https://rideplan.ebaugh.net').replace(/\/$/, '');
const out = option('--out');
const create = flag('--create');
if (args.length !== 1) {
  console.error('Usage: node scripts/import-trip.mjs <recipe.json> [--create] [--out trip.kml] [--base https://...]');
  process.exit(2);
}

// app/routing.mjs calls the site's functions by relative URL, as it does in the browser.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => realFetch(String(url).startsWith('/') ? base + url : url, init);
const { buildLeg } = await import(pathToFileURL(resolve(repo, 'app/routing.mjs')).href);
const { toKml, fromKml } = await import(pathToFileURL(resolve(repo, 'app/kml.mjs')).href);
const { rideDateFromTitle } = await import(pathToFileURL(resolve(repo, 'app/organize.mjs')).href);
const { DOMParser } = createRequire(resolve(repo, 'package.json'))('@xmldom/xmldom');
const palette = ['#f05a28', '#1684e8', '#a946d1', '#d99b00', '#00a884', '#e34878']; // same as app/main.mjs

const api = async (method, query = '', body) => {
  const response = await realFetch(`${base}/.netlify/functions/trips${query}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} trips: HTTP ${response.status} ${result.error || ''}`.trim());
  return result;
};

const recipe = JSON.parse(readFileSync(args[0], 'utf8'));
if (!recipe.title?.trim() || !Array.isArray(recipe.segments) || recipe.segments.length === 0) {
  throw new Error('The recipe needs a title and at least one segment.');
}
if (create) { // before any Google calls
  const { trips } = await api('GET');
  const same = trips.filter(t => t.title.trim().toLowerCase() === recipe.title.trim().toLowerCase());
  if (same.length) throw new Error(`A saved trip already has this title (${same.map(t => t.id).join(', ')}). Rename the recipe or use the app.`);
}

const segments = [];
for (const [i, s] of recipe.segments.entries()) {
  const color = /^#[a-f\d]{6}$/i.test(s.color) ? s.color : palette[i % palette.length];
  const leg = { ...await buildLeg(s.sourceUrl, s.avoidHighways === true, s.title || `Leg ${i + 1}`, color), note: s.note || '' };
  segments.push(leg);
  console.log(`${leg.title}: ${(leg.distance / 1609.344).toFixed(1)} mi, ${Math.round(leg.duration / 60)} min, `
    + `${leg.stops.length} stops, ${leg.startName.split(',')[0]} -> ${leg.endName.split(',')[0]}`);
}
const trip = { title: recipe.title, notes: recipe.notes || '', mapStyle: recipe.mapStyle || 'standard', opacity: recipe.opacity ?? 0.5,
  folder: recipe.folder || '', rideDate: recipe.rideDate ?? rideDateFromTitle(recipe.title), segments };
const kml = toKml(trip);
const expected = JSON.stringify(fromKml(kml, DOMParser)); // the validation the app applies when opening
const miles = segments.reduce((sum, s) => sum + s.distance, 0) / 1609.344;
console.log(`"${trip.title}": ${segments.length} legs, ${miles.toFixed(1)} mi, ${kml.length} bytes of KML`
  + `, folder "${trip.folder || '(none)'}", ride date ${trip.rideDate || '(none)'}`);
if (out) { writeFileSync(out, kml); console.log(`Wrote ${out}`); }

if (!create) {
  console.log(`Checked only; nothing saved online. Add --create to save it as a new trip at ${base}.`);
} else {
  const saved = await api('POST', '', { kml });
  const reread = await api('GET', `?id=${encodeURIComponent(saved.id)}`);
  if (JSON.stringify(fromKml(reread.kml, DOMParser)) !== expected) throw new Error(`Saved trip ${saved.id} does not match what was sent.`);
  console.log(`Created and verified: ${base}/?trip=${encodeURIComponent(saved.id)}`);
}
