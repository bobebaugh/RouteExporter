const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  },
  body: JSON.stringify(body),
});

const isPoint = (point) => {
  const { lat, lon } = point || {};
  return Number.isFinite(lat)
    && Number.isFinite(lon)
    && Math.abs(lat) <= 90
    && Math.abs(lon) <= 180;
};

const waypoint = ({ lat, lon }, via = false) => ({
  location: { latLng: { latitude: lat, longitude: lon } },
  ...(via ? { via: true } : {}),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  if (!process.env.GOOGLE_ROUTES_API_KEY) {
    return json(503, {
      error: "Google routing is not configured yet. Enable Routes API and add GOOGLE_ROUTES_API_KEY in Netlify.",
    });
  }

  let request;
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";
    request = JSON.parse(body);
  } catch {
    return json(400, { error: "The route request was not valid." });
  }

  const points = request?.points;
  if (!Array.isArray(points) || points.length < 2 || !points.every(isPoint)) {
    return json(400, { error: "A route needs at least two valid map points." });
  }
  if (points.length > 27) {
    return json(400, { error: "Google Routes supports up to 25 intermediate points in one route." });
  }

  const body = {
    origin: waypoint(points[0]),
    destination: waypoint(points.at(-1)),
    intermediates: points.slice(1, -1).map((point) => waypoint(point, !point.isNamedStop)),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
    routeModifiers: { avoidHighways: request.avoidHighways === true },
  };

  let response;
  let data;
  try {
    const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(25000) : undefined;
    response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_ROUTES_API_KEY,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    data = await response.json().catch(() => ({}));
  } catch {
    return json(504, { error: "Google Routes did not respond. Please try again." });
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return json(502, { error: "Google Routes rejected this request. Confirm the Routes API, billing, and API-key restrictions." });
    }
    if (response.status === 429) return json(429, { error: "Google Routes is temporarily rate-limited. Please try again shortly." });
    return json(502, { error: "Google could not calculate this road route. Check the link and try again." });
  }

  const route = data.routes?.[0];
  if (!route?.polyline?.encodedPolyline || !Number.isFinite(route.distanceMeters)) {
    return json(502, { error: "Google returned no usable route for these points." });
  }

  return json(200, {
    distanceMeters: route.distanceMeters,
    encodedPolyline: route.polyline.encodedPolyline,
  });
};
