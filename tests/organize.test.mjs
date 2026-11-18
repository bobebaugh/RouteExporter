import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { normalizeFolder, validDate, rideDateFromTitle, buildTree, folderPaths, searchTrips } from '../app/organize.mjs';
import { fromKml, toKml } from '../app/kml.mjs';
import { handle } from '../server/trip-service.mjs';

test('folder paths are tidied and capped', () => {
  assert.equal(normalizeFolder('  Tampa   Weekly / 2025/ '), 'Tampa Weekly/2025');
  assert.equal(normalizeFolder('//a///b//'), 'a/b');
  assert.equal(normalizeFolder(undefined), '');
  assert.ok(normalizeFolder('x'.repeat(300)).length <= 200);
  assert.ok(!normalizeFolder(`${'y'.repeat(199)}/z`).endsWith('/'));
});

test('ride dates: only real dates, and dates read from Bob\'s title styles', () => {
  assert.equal(validDate('2026-03-27'), '2026-03-27');
  for (const bad of ['2026-02-30', '2026-13-01', '3/27/2026', '', null]) assert.equal(validDate(bad), '');
  const titles = {
    '2026 MAR 27 - Smoke on the River': '2026-03-27', '2026 JAN 23rd - Smokin Aces': '2026-01-23',
    '2026 Jan 2 - Brees Riverside Nobleton': '2026-01-02', '2025 May 15/16': '2025-05-15', '2024 Nov 8': '2024-11-08',
    '6/13/2024': '2024-06-13', '7/05/2025 -- Pisgah Inn on BRP': '2025-07-05', '9/5/2025 Wayah Tapoco Loop': '2025-09-05',
    'Current Weekly Ride 2026-05-01': '2026-05-01', '2024 APR North Ukulele': '', 'Haywood Bowtie': '', '2026 FEB 30 - nope': '',
  };
  for (const [title, date] of Object.entries(titles)) assert.equal(rideDateFromTitle(title), date, title);
});

const rows = [
  { id: 'a', title: '2025 MAR 21', folder: 'Tampa Weekly/2025', updatedAt: '2026-01-01' },
  { id: 'b', title: 'Late ride', folder: 'tampa weekly/2025', rideDate: '2025-12-05', updatedAt: '2026-01-02' },
  { id: 'c', title: 'Haywood Bowtie', folder: 'WNC Riders', updatedAt: '2026-01-03' },
  { id: 'd', title: '2026 MAR 27 - Smoke on the River', folder: '', updatedAt: '2026-11-18' },
  { id: 'e', title: 'No date here', updatedAt: '2026-11-19' },
  { id: 'f', title: '2026 NOV 19 - Smoke on the River', updatedAt: '2026-11-18' },
];

test('the trip tree groups folders ignoring case and sorts newest ride first', () => {
  const tree = buildTree(rows);
  assert.equal(tree.count, 6);
  assert.deepEqual(tree.folders.map(f => [f.name, f.count]), [['Tampa Weekly', 2], ['WNC Riders', 1]]);
  assert.deepEqual(tree.folders[0].folders[0].trips.map(t => t.id), ['b', 'a']);
  assert.equal(tree.folders[0].folders[0].path, 'Tampa Weekly/2025');
  assert.deepEqual(tree.trips.map(t => t.id), ['f', 'd', 'e'], 'dated first (title dates count), undated last');
  assert.deepEqual(folderPaths(rows), ['Tampa Weekly', 'Tampa Weekly/2025', 'WNC Riders']);
});

test('search matches every word in the title or folder', () => {
  assert.deepEqual(searchTrips(rows, 'smoke river').map(r => r.id), ['f', 'd']);
  assert.deepEqual(searchTrips(rows, 'WNC').map(r => r.id), ['c']);
  assert.deepEqual(searchTrips(rows, 'tampa 2025').map(r => r.id), ['b', 'a']);
});

const trip = { title: 'T', notes: '', mapStyle: 'standard', opacity: 0.5, segments: [{ title: 'Leg 1', color: '#f05a28', points: [[27, -82], [28, -82]], stops: [], distance: 1609.344, duration: 600 }] };

test('folder and ride date travel in the KML; empty ones leave old KML unchanged', () => {
  const saved = fromKml(toKml({ ...trip, folder: ' WNC Riders / 2025 ', rideDate: '2025-07-05' }), DOMParser);
  assert.equal(saved.folder, 'WNC Riders/2025');
  assert.equal(saved.rideDate, '2025-07-05');
  const plain = toKml(trip);
  assert.ok(!plain.includes('folder') && !plain.includes('rideDate'));
  assert.equal(toKml(fromKml(plain, DOMParser)), plain);
  assert.equal(fromKml(toKml({ ...trip, rideDate: '2025-02-30' }), DOMParser).rideDate, '');
});

test('the server lists folder, ride date and totals, and keeps the creation time across saves', async () => {
  const rowsById = new Map(); let serial = 0;
  const store = {
    async list() { return [...rowsById].map(([id, v]) => ({ id, ...v })); },
    async read(id) { return rowsById.get(id) || null; },
    async write(id, kml, meta, revision) { if (rowsById.has(id) ? rowsById.get(id).revision !== revision : revision) return null; const value = { kml, ...meta, revision: String(++serial) }; rowsById.set(id, value); return { id, ...value }; },
  };
  const req = (method, id, body) => handle(new Request(`https://app.test/api${id ? `?id=${id}` : ''}`, { method, body: JSON.stringify(body) }), store);
  const created = await (await req('POST', null, { kml: toKml({ ...trip, folder: 'WNC Riders', rideDate: '2025-07-05' }) })).json();
  assert.equal(created.folder, 'WNC Riders');
  assert.equal(created.rideDate, '2025-07-05');
  assert.equal(created.distanceMeters, 1609.344);
  assert.equal(created.durationSeconds, 600);
  assert.equal(created.createdAt, created.updatedAt);
  await new Promise(r => setTimeout(r, 5));
  const updated = await (await req('PUT', created.id, { kml: toKml({ ...trip, title: 'Renamed' }), revision: created.revision })).json();
  assert.equal(updated.createdAt, created.createdAt);
  assert.notEqual(updated.updatedAt, created.updatedAt);
  assert.equal(updated.folder, '');
  // A trip saved before createdAt existed takes its last save time.
  rowsById.set('old', { kml: toKml(trip), title: 'T', updatedAt: '2026-09-23T00:00:00.000Z', legCount: 1, revision: 'r1' });
  const old = await (await req('PUT', 'old', { kml: toKml(trip), revision: 'r1' })).json();
  assert.equal(old.createdAt, '2026-09-23T00:00:00.000Z');
  // Unknown distance leaves the total unknown rather than undercounting.
  const partial = await (await req('POST', null, { kml: toKml({ ...trip, segments: [...trip.segments, { ...trip.segments[0], distance: null }] }) })).json();
  assert.equal(partial.distanceMeters, null);
});

test('leg photos travel in the KML; unsafe or oversized ones are dropped; no photo leaves old KML unchanged', () => {
  const photo = { src: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', width: 1000, height: 750 };
  const leg = { ...trip.segments[0], photo, photoCaption: '  Lunch  ' };
  const back = fromKml(toKml({ ...trip, segments: [leg] }), DOMParser).segments[0];
  assert.deepEqual(back.photo, photo);
  assert.equal(back.photoCaption, 'Lunch');
  for (const bad of [{ ...photo, src: 'data:image/svg+xml;base64,PHN2Zz4=' }, { ...photo, src: 'javascript:alert(1)' },
    { ...photo, width: 0 }, { ...photo, src: `data:image/jpeg;base64,${'A'.repeat(700000)}` }, 'not an object']) {
    assert.equal(fromKml(toKml({ ...trip, segments: [{ ...leg, photo: bad }] }), DOMParser).segments[0].photo, null);
  }
  const plain = toKml(trip);
  assert.ok(!plain.includes('photo'));
});
