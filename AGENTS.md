# Route Exporter: how work happens here

For any assistant (Claude, Codex, others) and for Bob coming back after a break. Bob's current instruction wins.
This repo is the project's memory: read this, [README.md](README.md), then the recent commits.
[docs/AI-QUICKSTART.md](docs/AI-QUICKSTART.md) is the guide for operating the app (planning and saving rides).
[docs/DESIGN.md](docs/DESIGN.md) holds the agreed design for what comes next (folders, accounts, lock-down
hooks, OneNote import) and its build phases.

## Two kinds of work

**Using the app** (adding or changing rides) changes saved trips, not code. Prefer, in order:

1. Bob does it in the app at https://rideplan.ebaugh.net.
2. With a shell and this checkout: put the trip in a recipe file (the version-2 format of
   `trips/new-england-2027.json`: title, notes, and one segment per leg with `title` and `sourceUrl`)
   and run `node scripts/import-trip.mjs <recipe.json>` to route and check it, then again with
   `--create` to save it as a new trip. The script uses the app's own `app/routing.mjs` and
   `app/kml.mjs`, refuses a duplicate title, and reads the trip back to verify it.
3. With a browser: follow the browser workflow in the quickstart.

Rules for saved trips: create new trips (Save As or `--create`); update or delete an existing shared trip
only when Bob asks for that trip. Every leg routed costs one Google Routes call on Bob's billing account.
Keep personal ride recipes outside this repo (it is public); the saved trip itself is the record.
Google Maps short links (`maps.app.goo.gl`) work as-is; a OneNote page's "Leg" may hold two alternative
routes, so expand the links and look at start/end before deciding how legs group into trips.

**Changing the app** (code, docs, deployment):

- `main` deploys production through Netlify on every push. Put `[skip netlify]` in the commit message
  for docs-only changes. `codex/pilot` deploys the pilot site, which has its own trip store.
- Changes go to the pilot first; promote to production only with Bob's approval. Each production deploy
  uses Netlify deploy credits, so Bob batches promotions to `main` unless something is broken. Ask before
  pushing to `main`, and use `[skip netlify]` for docs-only pushes anywhere.
- Pilot and production have separate trip stores (`scripts/build.mjs`): a trip saved on one doesn't
  exist on the other. To use a pilot-only feature on a production trip, Download KML in production and
  Import KML on the pilot; the open copy works without saving it there.
- Run `npm ci` once, then `npm test` before committing.
- `npm run build` rewrites `server/deployment.mjs` with a generated store name. Never commit that
  change; restore it with `git checkout -- server/deployment.mjs`.
- Never print, request or commit the Google key (`GOOGLE_ROUTES_API_KEY` lives in Netlify only).
- Agent commits say who made them, per command, because this PC has no global git identity and Bob's
  shouldn't be changed: Claude uses `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`
  plus its `Co-Authored-By` trailer; Codex uses `codex@openai.com`. Fetch before pushing; never force-push.

## Open items

- "Copy for email": built in `app/email.mjs`, on the pilot since 2026-11-18. Bob's Gmail paste test
  passed (map and clickable links came through). Waiting for the next batched promotion to production;
  minor polish later: some waypoint labels crowd each other. One click copies the shown trip, and one
  paste into a Gmail draft gives the map image plus title, notes, legs (distance, time, start/end, stops,
  Google Maps links) and the trip link. Evidence (2026-11-18): Bob's OneNote copy → Gmail paste works.
  OneNote's clipboard `HTML Format` carries each picture as `<img src="data:image/png;base64,...">`, and
  Gmail turns those into inline (`cid:`) images in the draft, so no hosting is needed. Plan: render the
  route on a canvas from the same OSM/OpenTopoMap tiles (both send `Access-Control-Allow-Origin: *`, so
  the canvas can be exported), draw the legs in their colors with tile attribution, then write a
  `ClipboardItem` with `text/html` (data-URI `<img>` + details) and `text/plain`. Works for unsaved trips.
  Unproven part: whether the browser's clipboard write keeps the data-URI image as OneNote's does; if
  not, fall back to `execCommand('copy')` on a hidden selection, then to a hosted image (PNG in Blobs
  served by a function). No Google Static Maps (key exposure, per-image cost, caching terms). Bob tests
  the paste in Gmail on the pilot.

- Folders, accounts, IP logging and the OneNote bulk import: designed, not started. See
  [docs/DESIGN.md](docs/DESIGN.md) for decisions and phases. The raw ride data is OneNote pages (a
  Tampa-area weekly section and a WNC Riders section, about 75 pages) with dated titles, notes, photos and
  `maps.app.goo.gl` leg links; no assistant tool reads OneNote, so Bob exports sections to Word (.docx).

- Google cost controls in [README.md](README.md#google-cost-controls-to-confirm-bob-2026-10-22): the
  routing function still has no same-origin check, and anyone who finds it can spend Routes calls.
