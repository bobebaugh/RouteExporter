export const parseRoutePoints = (url) => {
        const points = [];
        const addPoint = (lat, lon) => {
          const latitude = Number(lat);
          const longitude = Number(lon);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
          if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
          points.push({ lat: latitude, lon: longitude });
        };

        // Google Maps normally marks a listed stop as !2m2 and a point created by
        // dragging as !1m2. A !1m0 is a placeholder for a typed latitude/longitude
        // waypoint that appears in the URL path but has no coordinate in the data block.
        const parsedUrl = new URL(url);
        if (parsedUrl.pathname.startsWith("/maps/dir") && parsedUrl.searchParams.get("api") === "1") {
          const origin = parsedUrl.searchParams.get("origin");
          const destination = parsedUrl.searchParams.get("destination");
          const middle = parsedUrl.searchParams.get("waypoints");
          if (!origin?.trim() || !destination?.trim()) throw new Error("The Google Maps link needs an origin and destination.");
          const names = [origin, ...(middle ? middle.split("|") : []), destination];
          if (names.some((name) => !name.trim())) throw new Error("The Google Maps link contains an empty waypoint.");
          return {
            points: names.map((name) => ({ address: name, name, isNamedStop: true })),
            routeNames: names,
          };
        }
        const routeData = parsedUrl.searchParams.get("data") || url;
        for (const match of routeData.matchAll(/!(?:(2m2|1m2)!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)|(1m0))/g)) {
          if (match[4]) {
            points.push({ coordinateWaypointPlaceholder: true });
            continue;
          }
          const before = points.length;
          addPoint(match[3], match[2]);
          if (points.length > before) points.at(-1).isNamedStop = match[1] === "2m2";
        }

        const path = parsedUrl.pathname;
        const match = path.match(/\/maps\/dir\/([^?]*)/);
        const pathStops = match
          ? match[1]
              .split("/")
              .filter((part) => part && !part.startsWith("@") && !part.startsWith("data="))
              .map((part) => {
                let name;
                try { name = decodeURIComponent(part.replace(/\+/g, " ")); }
                catch { name = part; }
                const coordinate = name.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
                return coordinate
                  ? { name, lat: Number(coordinate[1]), lon: Number(coordinate[2]), isCoordinateWaypoint: true }
                  : { name, isCoordinateWaypoint: false };
              })
          : [];
        const names = pathStops.filter((stop) => !stop.isCoordinateWaypoint).map((stop) => stop.name);
        const coordinateWaypoints = pathStops.filter((stop) => stop.isCoordinateWaypoint);

        // Google sometimes encodes a listed route stop (often a plain street address)
        // as !1m2. When the directions path lists more stops than !2m2 supplied,
        // promote only the missing coordinates in order. The remaining !1m2 points
        // are true unlabeled shapers.
        let namedPointCount = points.filter((point) => point.isNamedStop || point.coordinateWaypointPlaceholder).length;
        const expectedNamedPointCount = Math.min(pathStops.length, points.length);
        if (namedPointCount < expectedNamedPointCount) {
          for (const point of points) {
            if (point.isNamedStop || point.coordinateWaypointPlaceholder) continue;
            point.isNamedStop = true;
            namedPointCount += 1;
            if (namedPointCount === expectedNamedPointCount) break;
          }
        }

        let namedIndex = 0;
        let coordinateWaypointIndex = 0;
        const labelledPoints = points.flatMap((point) => {
          if (point.coordinateWaypointPlaceholder) {
            const waypoint = coordinateWaypoints[coordinateWaypointIndex++];
            return waypoint
              ? [{ lat: waypoint.lat, lon: waypoint.lon, isNamedStop: true, name: waypoint.name }]
              : [];
          }
          if (!point.isNamedStop) return point;
          const namedPoint = { ...point, name: names[namedIndex] || `Stop ${namedIndex + 1}` };
          namedIndex += 1;
          return namedPoint;
        });
        // The URL path is the authoritative list of requested endpoints. Google
        // occasionally exposes fewer corresponding !2m2 marker coordinates, so
        // keep it separately from the marker list used for routing and map labels.
        return { points: labelledPoints, routeNames: pathStops.map((stop) => stop.name) };
      };

export const escapeXml = (value) => String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");

export const shortStopName = (name) => {
        const primary = String(name).split(",")[0].trim() || String(name);
        // A numbered street address is commonly an intentional road-shaping
        // waypoint. Show its road name, not an arbitrary house number, while
        // retaining POI names such as "5 Points Cafe".
        const address = primary.match(/^(\d+[a-z]?(?:-\d+[a-z]?)?)\s+(.+)$/i);
        const streetType = /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|highway|hwy\.?|route|rte\.?|parkway|pkwy\.?|way|court|ct\.?|circle|cir\.?|trail|trl\.?|place|pl\.?|terrace|ter\.?|loop|pike|turnpike|tpke\.?)\b/i;
        return address && streetType.test(address[2]) ? address[2].trim() : primary;
      };

export const kmlColor = (hex) => {
        const rgb = hex.slice(1);
        return `ff${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`;
      };

export const resolveLink = async (url) => {
        const parsed = new URL(url);
        if (!["goo.gl", "maps.app.goo.gl"].includes(parsed.hostname)) return url;

        const response = await fetch(`/.netlify/functions/unshorten?url=${encodeURIComponent(url)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "The short link could not be resolved.");
        return data.longUrl;
      };

export const decodePolyline = (encoded) => {
        const points = [];
        let index = 0;
        let latitude = 0;
        let longitude = 0;

        while (index < encoded.length) {
          let result = 0;
          let shift = 0;
          let byte;
          do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
          } while (byte >= 0x20 && index < encoded.length);
          latitude += result & 1 ? ~(result >> 1) : result >> 1;

          result = 0;
          shift = 0;
          do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
          } while (byte >= 0x20 && index < encoded.length);
          longitude += result & 1 ? ~(result >> 1) : result >> 1;
          points.push([latitude / 1e5, longitude / 1e5]);
        }

        return points;
      };

export const parseDuration = (duration) => {
        const match = String(duration || "").match(/^(\d+(?:\.\d+)?)s$/);
        return match ? Number(match[1]) : 0;
      };

export const formatDuration = (seconds) => {
        const totalMinutes = Math.round(seconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours) return `${hours} hr ${minutes} min`;
        return `${minutes} min`;
      };

export const calculateRoute = async (routePoints, shouldAvoidHighways) => {
        const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(25000) : undefined;
        const response = await fetch("/.netlify/functions/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: routePoints, avoidHighways: shouldAvoidHighways }),
          ...(signal ? { signal } : {}),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.encodedPolyline || !Number.isFinite(data.distanceMeters)) {
          throw new Error(data.error || "Google could not calculate this road route. Check the link and try again.");
        }
        return data;
      };

export const locateStops = (stops, route) => stops.map((stop, index) => {
        if (Number.isFinite(stop.lat) && Number.isFinite(stop.lon)) return stop;
        const location = route.stopLocations?.[index];
        if (!Number.isFinite(location?.lat) || !Number.isFinite(location?.lon)) {
          throw new Error("Google did not locate every named stop.");
        }
        return { ...stop, ...location };
      });


export async function buildLeg(sourceUrl, avoidHighways, title, color) {
 const u = new URL(sourceUrl);
 if (u.protocol !== 'https:' || !['google.com','www.google.com','maps.google.com','goo.gl','maps.app.goo.gl'].includes(u.hostname)) throw new Error('Use a Google Maps directions link.');
 const parsed = parseRoutePoints(await resolveLink(sourceUrl));
 const stops = parsed.points.filter(p => p.isNamedStop);
 if (stops.length < 2) throw new Error('No route stops found in this link.');
 const route = await calculateRoute(parsed.points, avoidHighways);
 const points = decodePolyline(route.encodedPolyline);
 if (points.length < 2) throw new Error('Google returned no route line.');
 return {title, color, sourceUrl, avoidHighways, note:'', distance:route.distanceMeters, duration:parseDuration(route.duration), points, stops:locateStops(stops,route), startName:parsed.routeNames[0], endName:parsed.routeNames.at(-1), shapingPointCount:parsed.points.length-stops.length};
}
