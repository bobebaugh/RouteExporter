const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app/routing.mjs', 'utf8');
const parser = source.slice(source.indexOf('export const parseRoutePoints'), source.indexOf('export const escapeXml')).replace('export const', 'const');
const parse = vm.runInNewContext(`${parser}; parseRoutePoints`, { URL });
const trip = JSON.parse(fs.readFileSync('trips/new-england-2027.json'));

test('all fourteen days preserve their order, continuity and avoid-highways request', () => {
  assert.equal(trip.segments.length, 14);
  let previous;
  for (const [index, segment] of trip.segments.entries()) {
    assert.equal(segment.title, `Day ${index + 1}`);
    assert.equal(segment.avoidHighways, true);
    const url = new URL(segment.sourceUrl);
    assert.ok(url.searchParams.get('avoid') === 'highways' || url.pathname.includes('!2m1!1b1'));
    const route = parse(segment.sourceUrl);
    assert.ok(route.points.length >= 2 && route.points.length <= 11);
    assert.ok(route.points.every(p => p.isNamedStop && (p.address || Number.isFinite(p.lat))));
    if (previous) assert.equal(route.routeNames[0].split(',')[0], previous.split(',')[0]);
    previous = route.routeNames.at(-1);
  }
  assert.equal(parse(trip.segments[0].sourceUrl).routeNames[0], 'St. Petersburg, FL');
  assert.equal(previous, 'St. Petersburg, FL');
});

test('legacy Google URL retains named stops and invisible shaping point', () => {
  const result = parse('https://www.google.com/maps/dir/A/B/data=!2m2!1d-82!2d35!1m2!1d-81.5!2d35.5!2m2!1d-81!2d36');
  assert.equal(result.points.length, 3);
  assert.equal(result.points[0].name, 'A');
  assert.equal(result.points[1].isNamedStop, false);
  assert.equal(result.points[2].name, 'B');
});

test('routing sends addresses to Google, retains numeric routes and rejects unresolved stops', async () => {
  const { handler } = require('../netlify/functions/route');
  process.env.GOOGLE_ROUTES_API_KEY = 'test-placeholder';
  let body;
  let legs = [{startLocation:{latLng:{latitude:27.77,longitude:-82.64}},endLocation:{latLng:{latitude:32.08,longitude:-81.09}}}];
  const originalFetch = global.fetch;
  global.fetch = async (_, options) => {
    body = JSON.parse(options.body);
    return { ok:true, json: async () => ({routes:[{distanceMeters:600000,duration:'30000s',polyline:{encodedPolyline:'abc'},legs}]}) };
  };
  try {
    const invoke = points => handler({httpMethod:'POST',body:JSON.stringify({points,avoidHighways:true})});
    let response = await invoke(parse(trip.segments[0].sourceUrl).points);
    assert.equal(response.statusCode, 200);
    assert.equal(body.origin.address, 'St. Petersburg, FL');
    assert.equal(body.routeModifiers.avoidHighways, true);
    assert.equal(JSON.parse(response.body).stopLocations.length, 2);
    response = await invoke([{lat:27,lon:-82},{lat:28,lon:-82},{lat:32,lon:-81}]);
    assert.equal(response.statusCode, 200);
    assert.equal(body.origin.location.latLng.latitude,27);
    assert.equal(body.intermediates[0].via, true);
    legs=[];
    response = await invoke(parse(trip.segments[0].sourceUrl).points);
    assert.equal(response.statusCode, 502);
    response = await invoke([{address:' '},{address:'Bangor, ME'}]);
    assert.equal(response.statusCode, 400);
  } finally { global.fetch = originalFetch; delete process.env.GOOGLE_ROUTES_API_KEY; }
});
