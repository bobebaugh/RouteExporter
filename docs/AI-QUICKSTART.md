# Route Exporter AI cheat sheet

For Claude, ChatGPT, or another assistant helping a person plan and save rides. This is an app operating guide, not permission to change someone else's trips. Follow the user's instructions and your own tool policies. Verified against the September 23, 2026 production release.

**App:** https://rideplan.ebaugh.net  
**Human guide:** [Route Exporter User Guide](Route-Exporter-User-Guide.docx)  
**Source:** https://github.com/bobebaugh/RouteExporter

## Start here

- A **trip** is a named collection of **legs**. Each leg can represent one day or one loop.
- Use production above for real work. `codex-pilot--routeexporter.netlify.app` is a separate test collection. The small “Pilot” heading currently appears in production too; use the URL to identify the environment.
- No login is required. Anyone can edit or delete shared trips. A public link is not ownership or authorization to overwrite.
- Prefer **Save As** for a new itinerary or a variation of an existing trip. Use **Save** only when updating the shared original is intended.
- Deliver both a saved trip link and a downloaded **KML backup** when your tools support them. A link always opens the current online version; it is not a frozen backup.
- Do not claim success until the trip reopens with the expected leg count, names, and source links.

## Choose a working method

| Available capability | Best approach |
| --- | --- |
| Interactive browser | Operate the app using its visible controls. This is the simplest complete workflow. |
| HTTP and file tools | Read saved trips using the storage API below; preserve KML and revisions. Use the browser for route creation or the repository's existing routing adapter. |
| File tools only | Inspect or edit a supplied KML with the repository codec. Give the user the result to Import KML and Save As. |
| Chat only | Prepare a table of ordered legs and Google Maps directions links. Give the user paste-and-save instructions. Do not claim to have operated the app. |

Browser access varies by assistant and account. Do not assume you can control the user's local tabs. Use your supported browser tools, and give a precise handoff when uploads, downloads, or clipboard access are unavailable.

## Turn a written itinerary into routes

1. Extract the day order, start and end places, overnight stops, mandatory intermediate stops, and preferences such as avoiding highways. Preserve supplied Google Maps links.
2. Separate confirmed facts from gaps. A broad region is not an exact overnight address. Ask about a material ambiguity; otherwise mark a reasonable choice as **provisional** in the leg's notes. Do not silently invent reservations or exact venues.
3. Prepare a working table: `Day | Start | Ordered stops | Finish | Maps link | Notes`. Check that each day's finish connects to the next day's start unless a transfer is intentional.
4. For each day or loop, prepare a Google Maps **driving directions** link. An ordinary place pin or map viewport is not a route. Use intermediate towns or actual stops to express intended corridors; do not assume “scenic route” determines a particular road.
5. Add each route to the app, then inspect the calculated line, endpoints, distance, and time. The routing API can choose a different path from the route displayed in Google Maps. Never guarantee that a shared URL reproduces a manually dragged route exactly.
6. Label legs consistently, such as **Day 1**, and put assumptions, highlights, overnight information, and unresolved choices in Notes. Trip menu → Rename / notes holds overall trip notes.
7. Flag implausibly long days. Driving time excludes breaks and overnight stops. Imported unknown distances and times are excluded from totals; do not interpret those totals as complete.

Example directions URL structure (URL-encode each location and preserve waypoint order):

```text
https://www.google.com/maps/dir/?api=1&origin=St.+Petersburg%2C+FL&destination=Savannah%2C+GA&travelmode=driving&avoid=highways
```

This is a link template, not evidence that a route has been calculated or validated. For complicated routes, verify the link in Maps and the resulting app leg. Do not fabricate a road-following KML line by connecting a few towns with straight segments.

## Browser workflow

Use fresh page observations and accessible labels rather than fixed screen coordinates or undocumented browser internals. Wait for status changes and controls to re-enable; avoid duplicate Add route or Save clicks while a request runs.

### Create a new trip

1. Visit the app. The **Saved trips** dialog opens; choose **New Trip**. The toolbar **New** button also starts an empty trip.
2. Fill **Google Maps directions link** and set **Avoid highways** explicitly for this route. Click **Add route** once.
3. Wait for the new leg card and route line. Inspect them, then use that card's **Edit** button to set its Name and Notes. Click **Continue**.
4. Repeat in the intended order. The arrows or drag-and-drop reorder cards; they do **not** renumber titles automatically.
5. Click **Save As**, enter the trip Name and Notes, and **Continue**. Wait for **Saved**.
6. Click **Copy Link** and capture the clipboard text with your supported tools. Download the KML to a real file and make it available to the user.
7. Reopen the copied link and verify the saved result. Report any assumptions or legs still needing review.

### Open or change an existing trip

- **Open** shows the shared list; use the row-specific Open button, not the toolbar button again. **Refresh** updates the list.
- Before making a variant, use **Save As** to create your own named copy. Similar names do not mean the same trip; retain the stable ID from the URL.
- In **Edit leg**, changing Name or Notes keeps the existing geometry. Changing the Google Maps link or Avoid highways recalculates that leg with Google.
- The checkbox above the map affects newly added routes; it does not change all saved legs.
- **Save** on an existing trip asks to replace its shared version. Confirm only when that update is within the user's request.
- **Trip menu → Rename / notes** changes the open copy. Follow with Save. A rename keeps its existing link valid.
- **Remove** removes one leg from the open copy. Save commits the removal online.

### Inspect the map

- Click a route line to select its leg and scroll the left list to it.
- Click the body of a leg card to select and zoom to that route. Card buttons and links have their own actions.
- **Show whole trip** fits all routes. Use the map zoom controls to inspect roads.
- **Route opacity** ranges from 15% to 90%; lower values expose road labels. The selected route is emphasized.
- **Standard / Terrain** changes the background. Map style and opacity are saved with the trip.
- **Open in Google Maps** opens the leg's original URL. **Copy Link** shares the entire saved trip in Route Exporter.

## Backup and recovery

**Download KML** exports the current open trip, including unsaved edits. **Import KML** replaces the open trip; it does not append or merge. Preserve current work first. Imported files are unsaved copies: use Save As to put one online and obtain a new link.

**Trip menu → Delete saved trip** deletes the online copy for everyone, with confirmation. There is no in-app recycle bin. The current open copy remains available to download or Save As. Do not delete a trip merely to test a workflow.

On a conflict, preserve the open work with Download KML or Save As, then reopen the shared trip. Do not repeatedly retry an old revision or force an overwrite. On a storage error, keep the page open and download a backup before reloading.

## Optional HTTP and file workflow

These are existing app endpoints, not a separate authenticated integration. Browser automation environments may prohibit arbitrary HTTP or code injection; use this section only through tools your environment allows. An open endpoint does not authorize writes beyond the user's request.

Base endpoint: `https://rideplan.ebaugh.net/.netlify/functions/trips`

| Method | Request | Result |
| --- | --- | --- |
| GET | Base endpoint | `{ "trips": [{ "id", "title", "updatedAt", "legCount", "revision" }] }` |
| GET | `?id=<URL-encoded-id>` | Record including `id`, raw `kml`, metadata, and `revision` |
| POST | JSON `{ "kml": "<complete KML>" }` | Creates a new trip; returns metadata, generated `id`, and `revision`; HTTP 201 |
| PUT | `?id=...`, JSON `{ "kml": "<complete KML>", "revision": "<last-read revision>" }` | Updates that trip conditionally; HTTP 200 |
| DELETE | `?id=...`, JSON `{ "revision": "<last-read revision>" }` | Deletes that shared trip conditionally; HTTP 200 |

Send `Content-Type: application/json` for writes. Treat `revision` as an opaque string, retaining embedded quotes exactly through JSON serialization. A 409 is a conflict, not a reason to bypass the guard. Errors are JSON with an `error` message. A write timeout has an uncertain outcome: check the collection before retrying a create to avoid duplicates.

Read-only examples:

```sh
curl --fail-with-body 'https://rideplan.ebaugh.net/.netlify/functions/trips'
curl --fail-with-body 'https://rideplan.ebaugh.net/.netlify/functions/trips?id=new-england-2027'
```

The read response is JSON, not a KML download. Decode its `kml` field and write that string as UTF-8 to a `.kml` file. Do not rename the entire JSON response to `.kml`.

A link has the form `https://rideplan.ebaugh.net/?trip=<id>&name=<readable-slug>`. The ID is authoritative; the name is decorative. Prefer the app's Copy Link. A link containing just `?trip=<id>` also opens the trip. Never invent IDs from titles.

### KML details for file-capable assistants

Use the repository's `app/kml.mjs` codec instead of reconstructing its extended metadata by hand. In Node, pass `DOMParser` from `@xmldom/xmldom` to `fromKml`; `toKml` serializes the resulting trip object. Inspect the current source before relying on the schema.

- KML coordinate order is **longitude, latitude, altitude**. The codec's internal `points` use **latitude, longitude, optional altitude**.
- Document ExtendedData `routeExporter` is JSON with format version 1 and trip metadata. Each leg Folder has `routeExporterLeg` JSON and one LineString.
- Preserve every route coordinate, original `sourceUrl`, ordered stops, names, notes, colors, highway flags, distances, durations, and map settings. Do not simplify geometry unless requested.
- Distances use meters; durations use seconds. Unknown values are `null`, not zero.
- Own-format KML round-trips metadata and geometry. Generic KML imports LineStrings and Points, but does not recover absent Maps URLs or times. Generic point markers are attached to the first imported leg; inspect multi-leg imports.
- Limits: 4 MiB KML, 100 legs, 250,000 route coordinates, and 2,000 stops per leg. Use uncompressed `.kml`. DTD/entity declarations are rejected; NetworkLinks are not fetched.
- Opening, importing, exporting, saving, or renaming stored geometry makes no Google routing call. Adding routes or changing routing inputs does. Map tiles still require network access; a KML backup is not an offline basemap.
- Routing code is in `app/routing.mjs` and `netlify/functions/route.js`; storage code is separate. Do not request or embed the server's Google API key. Do not change app code or deployment settings just to operate the app.

## Completion checklist

- [ ] Correct production trip, day order, start/end continuity, and requested highway preferences.
- [ ] Provisional places and deviations documented; no invented routing results or travel times.
- [ ] Intended save mode used, and saved trip reopened successfully.
- [ ] Original Google Maps links retained for legs where supplied.
- [ ] Share link and actual KML backup delivered, or a clear explanation of a tool limitation.
- [ ] No unrelated shared trips changed or deleted.

## A prompt the rider can reuse

> Use the attached Route Exporter AI cheat sheet to turn my itinerary into a saved trip at https://rideplan.ebaugh.net. Start with Day 1 at [location], preserve my day order and required stops, and [avoid highways / use my stated preferences]. Mark uncertain overnight choices as provisional and flag unrealistic days. Create a new trip with Save As; do not overwrite an existing shared trip. Give me its link and a KML backup. If your tools cannot operate the browser, prepare the ordered Maps links and tell me exactly what to paste into the app.
