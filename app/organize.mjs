// Folders and ride dates (docs/DESIGN.md, phase 1). Pure functions: used by the KML codec, the server,
// the Saved trips list and scripts/import-trip.mjs.
export const MAX_FOLDER = 200;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "  Tampa Weekly / 2025/ " -> "Tampa Weekly/2025". Empty means the top level (Unfiled, for now).
export const normalizeFolder = value => String(value ?? '')
  .split('/').map(part => part.trim().replace(/\s+/g, ' ')).filter(Boolean).join('/')
  .slice(0, MAX_FOLDER).replace(/\/+$/, '');

// A real calendar date as YYYY-MM-DD, or ''.
export const validDate = value => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : '';
};

const iso = (y, mo, d) => validDate(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

// Ride date from titles like "2026 MAR 27 - Smoke on the River", "2026 JAN 23rd", "7/05/2025 -- Pisgah Inn",
// "Current Weekly Ride 2026-05-01". '' when the title has no full date (e.g. "2024 APR North Ukulele").
export function rideDateFromTitle(title) {
  const t = String(title ?? '');
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) return iso(m[1], m[2], m[3]);
  m = /\b(\d{4})[ -]+([a-z]{3,9})\.?[ -]+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(t);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) return iso(m[1], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, m[3]);
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(t);
  if (m) return iso(m[3], m[1], m[2]);
  return '';
}

// Newest ride first; trips with no date (not even in the title) after dated ones, newest save first.
export const sortDate = row => validDate(row.rideDate) || rideDateFromTitle(row.title);
export function compareTrips(a, b) {
  const da = sortDate(a), db = sortDate(b);
  if (da !== db) return !da ? 1 : !db ? -1 : db.localeCompare(da);
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.title).localeCompare(String(b.title));
}

// Saved-trip rows -> { folders: [{ name, path, count, folders, trips }], trips } with folder names matched
// ignoring case (first spelling wins), folders alphabetical (numbers in order) and trips by compareTrips.
export function buildTree(rows) {
  const make = (name, path) => ({ name, path, count: 0, folders: new Map(), trips: [] });
  const root = make('', '');
  for (const row of rows) {
    let node = root;
    node.count++;
    for (const part of normalizeFolder(row.folder).split('/').filter(Boolean)) {
      const key = part.toLowerCase();
      if (!node.folders.has(key)) node.folders.set(key, make(part, node.path ? `${node.path}/${part}` : part));
      node = node.folders.get(key);
      node.count++;
    }
    node.trips.push(row);
  }
  const finish = node => ({
    ...node,
    folders: [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })).map(finish),
    trips: node.trips.sort(compareTrips),
  });
  return finish(root);
}

// Every folder path and its parents, for the Folder field's suggestions.
export function folderPaths(rows) {
  const paths = new Map();
  for (const row of rows) {
    const parts = normalizeFolder(row.folder).split('/').filter(Boolean);
    parts.forEach((_, i) => { const path = parts.slice(0, i + 1).join('/'); if (!paths.has(path.toLowerCase())) paths.set(path.toLowerCase(), path); });
  }
  return [...paths.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

// Search: every word must appear in the title or folder path, ignoring case.
export function searchTrips(rows, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => { const hay = `${row.title} ${row.folder || ''}`.toLowerCase(); return words.every(w => hay.includes(w)); }).sort(compareTrips);
}
