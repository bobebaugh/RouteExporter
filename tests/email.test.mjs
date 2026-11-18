import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailParts, fitView, project } from '../app/email.mjs';

const leg = (title, color, sourceUrl, points, stops, extra = {}) => ({
  title, color, sourceUrl, note: '', avoidHighways: false, distance: 16093.44, duration: 1800, points, stops,
  startName: stops[0].name, endName: stops.at(-1).name, shapingPointCount: 0, ...extra,
});
const trip = {
  title: 'Smoke & "Mirrors" <Ride>', notes: 'Line one\nLine two', mapStyle: 'standard', opacity: 0.5,
  segments: [
    leg('Leg 1', '#f05a28', 'https://maps.app.goo.gl/abc?x=1&y=2', [[27.8, -82.7], [27.9, -82.5]],
      [{ lat: 27.8, lon: -82.7, name: 'Start Diner, Tampa, FL' }, { lat: 27.85, lon: -82.6, name: '123 Main St, Tampa, FL' }, { lat: 27.9, lon: -82.5, name: 'Lunch Spot, Dover, FL' }]),
    leg('Leg 2', '#1684e8', '', [[27.9, -82.5], [28.0, -82.3]],
      [{ lat: 27.9, lon: -82.5, name: 'Lunch Spot, Dover, FL' }, { lat: 28.0, lon: -82.3, name: 'Home' }], { distance: null, note: 'Back roads' }),
  ],
};
const image = { src: 'data:image/jpeg;base64,AAAA', width: 720, height: 400 };

test('email HTML has the map image, escaped text and clickable Google Maps links', () => {
  const { html } = emailParts(trip, { image, link: 'https://rideplan.ebaugh.net/?trip=t1&name=smoke' });
  assert.match(html, /<img src="data:image\/jpeg;base64,AAAA" width="720" height="400"/);
  assert.ok(html.includes('Smoke &amp; &quot;Mirrors&quot; &lt;Ride&gt;'));
  assert.ok(!html.includes('<Ride>'));
  assert.ok(html.includes('Line one<br>Line two'));
  assert.ok(html.includes('<a href="https://maps.app.goo.gl/abc?x=1&amp;y=2">https://maps.app.goo.gl/abc?x=1&amp;y=2</a>'));
  assert.equal((html.match(/Google Maps: <a /g) || []).length, 1, 'a leg without a link gets no link line');
  assert.ok(html.includes('Stops: Main St'), 'intermediate stops only, with short names');
  assert.ok(!html.includes('Stops: Start Diner'));
  assert.ok(html.includes('distance unknown'));
  assert.ok(html.includes('totals exclude unknown values'));
  assert.ok(html.includes('<a href="https://rideplan.ebaugh.net/?trip=t1&amp;name=smoke">'));
  assert.ok(html.includes('color:#f05a28'));
});

test('unsaved trips omit the Route Exporter link; plain text keeps the links', () => {
  const { html, text } = emailParts(trip, { image });
  assert.ok(!html.includes('Route Exporter'));
  assert.ok(text.startsWith('Smoke & "Mirrors" <Ride>\nLine one\nLine two\n2 legs · 10.0 mi · 1 hr 0 min riding'));
  assert.ok(text.includes('\n\nLeg 1: Start Diner → Lunch Spot · 10.0 mi · 30 min\nStops: Main St\nGoogle Maps: https://maps.app.goo.gl/abc?x=1&y=2'));
  assert.ok(text.includes('\n\nLeg 2: Lunch Spot → Home · distance unknown · 30 min\nBack roads'));
  assert.ok(!text.includes('null'));
});

test('the map view fits every point inside the image', () => {
  const points = trip.segments.flatMap(s => s.points);
  const view = fitView(points);
  assert.equal(view.width, 720);
  assert.ok(view.height >= 400 && view.height <= 900);
  for (const [lat, lon] of points) {
    const [x, y] = project(lat, lon, view.z);
    assert.ok(x - view.left >= 0 && x - view.left <= view.width, 'x inside');
    assert.ok(y - view.top >= 0 && y - view.top <= view.height, 'y inside');
  }
  assert.ok(fitView([[27.8, -82.7], [42.9, -71.0]]).z < view.z, 'a longer trip zooms out');
});
