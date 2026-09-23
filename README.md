# Route Exporter

Working deployment: `codex/pilot`. Production builds from `main` remain deliberately skipped by `netlify.toml`. Do not promote until the owner has tested the pilot.

## Trip workflow

The opening page lists saved trips. New / Open / Save / Save As, rename/notes and confirmed deletion are available to everyone. There is intentionally no login or ownership enforcement. Download KML is the portable personal backup; Import KML creates an unsaved local copy. Import never overwrites an online trip until the user explicitly saves it.

Saved links use `?trip=<stable-id>&name=<readable-name>`; the name is decorative, so rename does not break links. Existing `#trip=` version-2 links remain readable, but those links contain no geometry and must calculate once before Save As.

KML contains native LineStrings with every coordinate (no simplification), native Point waypoints, and `ExtendedData` for metadata and each leg's original Google URL. Our files round-trip labels, notes, colors, route preferences, distance/time, and map style/opacity. Third-party KML LineStrings and Points import without routing; unknown distance/time remain unknown. NetworkLinks are not fetched. DTD/entity declarations and invalid geometry are rejected. Current limit: 4 MB / 100 legs / 250,000 coordinates.

Opening, saving, renaming, downloading, importing, and sharing stored trips do not call Google. Adding a route or changing its source link / avoid-highways setting does. Google routing output retention and map-display terms remain a known provider constraint discussed with the owner; this implementation does not claim those terms authorize indefinite retention. The routing adapter is separate so the provider can be replaced.

## Module boundaries

- `app/kml.mjs`: portable KML format and validation; no networking.
- `app/storage.mjs`: browser list/read/write/delete client.
- `server/trip-service.mjs`: HTTP validation and storage-independent operations.
- `server/blob-storage.mjs`: Netlify Blobs adapter; replace this to move storage.
- `server/access.mjs`: intentionally open authorization hook; future invite policy belongs here.
- `app/routing.mjs` and `netlify/functions/route.js`: Google routing integration.
- `app/main.mjs`: editor, trip browser, map interactions.

The storage adapter returns a revision token. Updates use conditional writes, so stale clients cannot silently replace a newer version. Deletion writes an empty conditional tombstone (not retained trip content) to prevent races with saves. Saved trip contents are raw KML, not a database JSON record; lightweight metadata supports listing without downloading all geometry.

By default production uses `route-trips-production`. The build script selects a separate, sanitized and hashed namespace for each branch; a `TRIP_STORE` environment variable can explicitly select a store. Keep production and pilot separate. Stores persist across deployments. No periodic jobs or background polling are used.

## Tests

`npm ci && npm test`

Checks cover KML fidelity, source links, third-party imports, malformed input, storage lifecycle and stale revisions, legacy Maps URL parsing, and address/numeric Google request behavior. Live pilot acceptance also checks storage connectivity, Save As/reopen, import/export, rename/delete, and route selection. Google key remains a server-side Netlify environment variable.
