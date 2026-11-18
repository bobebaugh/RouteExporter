# Route Exporter design: folders, accounts and lock-down hooks

Decided with Bob on 2026-11-18. Nothing here is built yet; build it in the phases at the end, each on the
pilot first and promoted to production in Bob's batches (production deploys use Netlify deploy credits).

## Principles

- **The KML stays the trip's content record.** Download KML → Import KML reproduces the trip byte for byte
  (checked on all production trips, 2026-11-18). New content fields go inside the KML so exports keep them.
- **Ownership is held by the server, never read from KML.** Anyone can edit and import a KML file, so space,
  owner, editors and authorship live in server-side metadata and records.
- **Open by default.** Anyone can view any ride and copy it. Unfiled is an open sandbox. Routing (Google
  calls) stays open without sign-in.
- **Structured for lock-down, not locked down.** Build the hooks (logging, quotas, switches) but leave the
  restricting ones off until there's a real problem. There may never be one: the site is `noindex` and has
  had little traffic beyond people Bob told.
- **Switches change without a deploy.** Lock-down settings live in a Blobs record the functions read at run
  time, because environment-variable changes need a redeploy (deploy credits).
- **Trip IDs never change.** Folders and spaces are metadata, not storage keys, so `?trip=<id>` links keep
  working when a ride moves.

## Organization

- **Spaces** are the top level. Every signed-in user may claim one personal space, named by them (first come,
  first served). Only admins (Bob, for now) create other top-level spaces, e.g. a shared "WNC Riders".
- **Unfiled** is everything not in a space: the existing trips and anything saved without signing in.
  Open to everyone for viewing, creating, editing and deleting.
- **Folders** inside a space (or inside Unfiled) form a path such as `Tampa Weekly/2025`. No hard depth
  limit; the whole path is capped at 200 characters and the UI is designed for about 4 levels.
- **One folder per ride.** Tags are not planned now; they can be added later as an optional field without
  converting anything.
- **Repeated rides are separate trips.** Riding Smoke on the River again means a new trip (a copy), not a
  list of dates on one route.

## Data

**Trip content (inside the KML's `routeExporter` metadata), added fields:**

| Field | Notes |
|---|---|
| `folder` | Path within its space or Unfiled, `/`-separated, ≤200 chars, empty = top of the space |
| `rideDate` | `YYYY-MM-DD` or empty; drives sorting. The OneNote import derives it from page titles |
| leg `photo`, `photoCaption` | Built separately on 2026-11-18: one optional shrunk photo per leg (data URI) and caption, used by Copy for email. The OneNote import could carry each page's destination photo here |

**Server-held trip metadata (Blobs metadata, returned by the public list, so never IPs or emails):**
`title`, `legCount`, `distanceMeters`, `durationSeconds` (for the list without opening trips), `folder` and
`rideDate` (copied from the KML for listing), `spaceId` (empty = Unfiled), `createdAt` (kept across saves;
existing trips get their last `updatedAt`), `createdBy`, `updatedAt`, `updatedBy` (user IDs, empty when
anonymous), `copiedFrom` (`{id, revision}` when made with Copy to my space).

**Records (new Blobs keys in the same store):**
- `users/<google-subject>.json`: display name, role (`user` or `admin`), personal `spaceId`, created time.
  Email only if an invite feature needs it.
- `spaces/<spaceId>.json`: permanent ID, display name, owner, editor user IDs, created time. Renaming a
  space changes only this record. Names are unique ignoring case; reserved: Unfiled, admin, api, trips and
  similar.
- `settings/config.json`: the lock-down switches below.
- `audit/<date>/<time>-<random>.json`: the IP log below.

## Permissions

All decisions go through `server/access.mjs` (already the intended hook).

| Action | Who |
|---|---|
| View any trip, list everything, Download KML, Copy for email | Everyone |
| Create, edit, move, delete in Unfiled | Everyone |
| Copy any trip into Unfiled | Everyone |
| Copy any trip into a space; create, edit, move, delete there | That space's owner and editors, admins |
| Claim a personal space (one per user) | Any signed-in user |
| Create other spaces; manage editors; act anywhere | Admins |

- **Admin ("Bob class")**: full access to every space. Bob's account is admin and can make other users admin.
  More granular roles only if access is ever charged for.
- A trip you can't edit opens read-only: Save disabled, **Copy to my space** prominent (or Save As into
  Unfiled when not signed in).
- Moving a trip from Unfiled into a space is a copy; the sandbox original stays.

## Identity

- Google Identity Services sign-in; no passwords. The browser gets a Google ID token; a function verifies it
  (signature against Google's keys, audience = our client ID) and sets a session cookie (`HttpOnly`,
  `Secure`, `SameSite=Lax`, signed with a `SESSION_SECRET` environment variable).
- Writes check the session plus a same-origin check.
- Google Cloud setup (Bob): an OAuth client with authorized origins `https://rideplan.ebaugh.net` and the pilot
  URL. Free and separate from Maps billing; the client ID is public-safe.
- The pilot has its own store, so its own users, spaces and settings.

## Logging and lock-down hooks

- **IP log, always on.** One small record per event: time, IP, action (`route`, `create`, `update`,
  `delete`), trip ID, user ID. IP from Netlify's `x-nf-client-connection-ip`. Never returned by any public
  API; read by Bob with a script. Kept 90 days (pruned during writes or by script; no scheduled jobs).
- **Switches in `settings/config.json`**, read at run time with a short cache, all off/unlimited by default:
  routing enabled; per-IP daily routing quota; total daily routing cap; sign-in required for routing;
  Unfiled read-only; same-origin check on the routing function.
- **Quota counting**: per day per client, keyed by a salted hash of the IPv4 address or of the IPv6 /64
  (one household or phone), incremented with conditional writes. A bypass token (environment variable on
  Netlify and Bob's PC, never in the repo) lets `scripts/import-trip.mjs` run bulk imports.
- **Deferred until needed**: quota numbers (check Routes billing first; ~25–50 per IP per day is generous for a
  person), Cloudflare Turnstile before Add route.
- **The hard spending ceiling stays at Google**: restrict the key to the Routes API and set a daily quota in
  Google Cloud (README, "Google cost controls"). That is Bob's to do in the console.

## Screens

- **Saved trips**: spaces, then a collapsible folder tree; Unfiled; a "My space" shortcut; search by title;
  newest ride date first within a folder; miles and riding time on each row.
- **Save As / Rename**: Folder field suggesting existing folders; Ride date picker; space shown, choosable
  among spaces the user can edit.
- **Sign in / out** in the toolbar; read-only state as above. Everything must work on a phone.
- `scripts/import-trip.mjs`: recipes gain `folder`, `rideDate` and (with sign-in) a target space.

## Deferred, and why they stay easy to add

- **Version history and trash**: every save already passes through `server/trip-service.mjs`. History only
  covers changes after it exists; until then Download KML is the safety net.
- **List index** (opening Saved trips reads each trip's metadata one by one, plus deleted-trip markers):
  fine at the expected ~100 trips; the index would hold fields already in the metadata, so no migration.
- **Backup script** (download every trip's KML to Bob's PC or Drive): independent and small.
- **Tags**, quota numbers, Turnstile, crowded map labels in Copy for email, paid tiers.

## Build phases

1. **Folders without accounts** (built, on the pilot since 2026-11-18; code in `app/organize.mjs`):
   `folder`, `rideDate`, `createdAt`, distance/duration in metadata; folder tree, search and ride-date
   sorting in Saved trips; Folder and Ride date in Save As / trip details (date prefilled from a date in the
   name); import script fields. Existing trips land in Unfiled and keep identical KML until given a folder or
   date; their list rows show miles and time after their next save.
2. **Logging and switches**: IP log, `settings/config.json`, quota counting and bypass token, all switched
   off except logging.
3. **Accounts and spaces**: Google sign-in, users, spaces, admin role, permissions, read-only view, Copy to my
   space. Bob moves his folders from Unfiled into his space (admin script).
4. **OneNote bulk import**: Bob exports each OneNote section to Word; parse pages into recipes (title, ride
   date, notes, leg links); Bob reviews a table; import with `scripts/import-trip.mjs --create` into the
   right folders. Leg links may be alternative routes (one trip each) rather than one route.
