// Google Maps URL → { lat, lng } parser (build spec § 9).
//
// The Google Maps URL shapes we care about all embed coords as `/@LAT,LNG`
// somewhere in the path — direct coordinate URLs and place URLs both match.
// Short redirect URLs (maps.app.goo.gl, goo.gl/maps/…) cannot be resolved
// from client-side JS (CORS), so callers should surface a message telling
// the user to open it and paste the full URL from the address bar.

const SHORT_URL_RE = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i;
const COORD_URL_RE = /\/@(-?\d+\.\d+),(-?\d+\.\d+)/;
// Bare "lat, lng" or "lat,lng" as you'd get from right-click → copy
// coordinates in Google Maps.
const BARE_COORD_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

function roundCoord(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat: Math.round(lat * 1_000_000) / 1_000_000,
    lng: Math.round(lng * 1_000_000) / 1_000_000,
  };
}

export function isGoogleShortUrl(url) {
  return SHORT_URL_RE.test(String(url || '').trim());
}

export function parseGoogleMapsUrl(url) {
  const s = String(url || '').trim();
  if (!s || isGoogleShortUrl(s)) return null;
  const m = s.match(COORD_URL_RE);
  if (!m) return null;
  return roundCoord(Number(m[1]), Number(m[2]));
}

// Bare coordinate pair (right-click → Copy coordinates in Google Maps).
export function parseCoordinatePair(input) {
  const s = String(input || '').trim();
  const m = s.match(BARE_COORD_RE);
  if (!m) return null;
  return roundCoord(Number(m[1]), Number(m[2]));
}

// UI-friendly wrapper: tries bare coords first, then the full URL forms,
// so the Add/Edit form can accept either.
//   { ok: true, lat, lng }
//   { ok: false, code: 'empty' | 'short_url' | 'no_match', message }
export function diagnoseMapsUrl(input) {
  const s = String(input || '').trim();
  if (!s) return { ok: false, code: 'empty', message: '' };

  const pair = parseCoordinatePair(s);
  if (pair) return { ok: true, ...pair };

  if (isGoogleShortUrl(s)) {
    return {
      ok: false,
      code: 'short_url',
      message: "This is a short URL. Open it in Google Maps, then copy the full URL from the address bar (it should start with https://www.google.com/maps/) — or right-click on the map and paste the coordinates here instead.",
    };
  }
  const parsed = parseGoogleMapsUrl(s);
  if (parsed) return { ok: true, ...parsed };
  return {
    ok: false,
    code: 'no_match',
    message: "Couldn't find coordinates in this input. Try right-clicking the location in Google Maps and pasting the coordinates (e.g. \"38.9128, -77.2265\"). The property will save without a map pin.",
  };
}
