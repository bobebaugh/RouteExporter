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
   `trips/new-england-2027.json`: title, notes, optional `folder`/`rideDate`, and one segment per leg
   with `title` and `sourceUrl`; photos are added in the app)
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

## Site pages other projects rely on

- `privacy.html` and `terms.html` (added 2026-11-23, with Bob) are the privacy policy and terms links for
  Bob's Google OAuth app in the Google Cloud project "rclone" (his home camera recordings to his own Drive;
  see the private pc-setup repo). That app lists `ebaugh.net` as its authorized domain and
  `https://rideplan.ebaugh.net` as its home page. Keep both pages at these paths; Google requires them for
  the app to stay published.
- Why here: an OAuth app that reads and writes a personal Google account's Drive must be published, or
  Google expires its sign-ins every 7 days ("Testing" status), which meant a weekly re-sign-in. The
  console won't publish without home page, privacy and terms links on a domain Bob controls. Sign-in-only
  apps (name/email, as Firebase sites use) are exempt, which is why Bob's other apps never needed this.
  Bob already owns `ebaugh.net` and this site is static on Netlify, so two plain pages were the smallest
  fix. They are generic (household apps; data stays in the person's own Google account) because this
  repo is public. No app logo was uploaded: a logo triggers Google's brand verification.
- The same push promoted the whole pilot to production at Bob's request (one deploy).

## Open items

- **Promoted to production 2026-11-23** at Bob's request (the whole pilot, with the pages above). Built
  on the pilot 2026-11-18; notes kept for follow-up:
  - Copy for email (`app/email.mjs`): one map of all legs drawn on a canvas from the OSM/OpenTopoMap tiles
    (both allow cross-origin use), copied as `text/html` with the image as a `data:` URI plus `text/plain`.
    Bob's Gmail paste test passed. Why data URIs: his OneNote clipboard carries pictures that way and Gmail
    turns them into inline images, so no hosting is needed. No Google Static Maps (key exposure, cost,
    caching terms). Polish later: some waypoint labels crowd each other.
  - Folders and ride dates (design phase 1; `app/organize.mjs`): folder tree, search, ride-date sorting,
    Folder and Ride date fields; list metadata gains `createdAt`, `folder`, `rideDate`, totals.
  - Route color per leg in Edit leg (picker plus suggested colors).
  - Optional photo and caption per leg (`app/photo.mjs`): paste/drop/choose in Edit leg, shrunk in the
    browser to ~1000 px JPEG, stored in the leg inside the KML (so in Blobs with the trip), shown only at
    the end of Copy for email as `Leg N - <destination> - <caption>`. Showing photos in the app itself is
    undecided (screen space); a camera mark on leg cards was suggested. Bob's own snips come from Street
    View and Google place photos via Snipaste; Google's terms limit keeping those on a public site, which
    he has been told.
  - Every addition leaves older trips' KML byte-identical when the new fields are empty; keep it that way
    (check with a `toKml(fromKml(stored)) === stored` loop over both sites' trips after codec changes).

- Folders, accounts, IP logging and the OneNote bulk import: designed; phase 1 (folders and ride dates,
  no accounts) is on the pilot, above. See
  [docs/DESIGN.md](docs/DESIGN.md) for decisions and phases. The raw ride data is OneNote pages (a
  Tampa-area weekly section and a WNC Riders section, about 75 pages) with dated titles, notes, photos and
  `maps.app.goo.gl` leg links; no assistant tool reads OneNote, so Bob exports sections to Word (.docx).

- Google cost controls in [README.md](README.md#google-cost-controls-to-confirm-bob-2026-10-22): the
  routing function still has no same-origin check, and anyone who finds it can spend Routes calls.
