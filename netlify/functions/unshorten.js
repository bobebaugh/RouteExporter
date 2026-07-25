const ALLOWED_HOSTS = new Set([
  "goo.gl",
  "maps.app.goo.gl",
  "maps.google.com",
  "www.google.com",
]);

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed." });
  }

  const rawUrl = event.queryStringParameters?.url;
  if (!rawUrl) {
    return json(400, { error: "A Google Maps URL is required." });
  }

  let currentUrl;
  try {
    currentUrl = new URL(rawUrl);
  } catch {
    return json(400, { error: "The URL is not valid." });
  }

  if (currentUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(currentUrl.hostname)) {
    return json(400, { error: "Only HTTPS Google Maps links are supported." });
  }

  try {
    for (let hop = 0; hop < 6; hop += 1) {
      let response = await fetch(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        headers: { "User-Agent": "RouteExporter/2.0" },
      });

      if (response.status === 405) {
        response = await fetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          headers: { "User-Agent": "RouteExporter/2.0" },
        });
      }

      if (response.status < 300 || response.status >= 400) {
        return json(200, { longUrl: currentUrl.toString() });
      }

      const location = response.headers.get("location");
      if (!location) {
        return json(502, { error: "The short link did not provide a destination." });
      }

      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(nextUrl.hostname)) {
        return json(400, { error: "The link redirected outside Google Maps." });
      }
      currentUrl = nextUrl;
    }

    return json(508, { error: "The link redirected too many times." });
  } catch {
    return json(502, { error: "Google Maps did not respond. Please try again." });
  }
};

