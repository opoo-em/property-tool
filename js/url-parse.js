// Google Maps URL → { lat, lng } parser (build spec § 9).
//
// The Google Maps URL shapes we care about all embed coords as `/@LAT,LNG`
// somewhere in the path — direct coordinate URLs and place URLs both match.
// Short redirect URLs (maps.app.goo.gl, goo.gl/maps/…) cannot be resolved
// from client-side JS (CORS), so callers should surface a message telling
// the user to open it and paste the full URL from the address bar.

const SHORT_URL_RE = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i;
const COORD_RE = /\/@(-?\d+\.\d+),(-?\d+\.\d+)/;

export function isGoogleShortUrl(url) {
  return SHORT_URL_RE.test(String(url || '').trim());
}

export function parseGoogleMapsUrl(url) {
  const s = String(url || '').trim();
  if (!s || isGoogleShortUrl(s)) return null;
  const m = s.match(COORD_RE);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat: Math.round(lat * 1_000_000) / 1_000_000,
    lng: Math.round(lng * 1_000_000) / 1_000_000,
  };
}

// UI-friendly wrapper: distinguishes "empty", "short url", and "no match"
// so the Add/Edit form can render the right inline hint.
//   { ok: true, lat, lng }
//   { ok: false, code: 'empty' | 'short_url' | 'no_match', message }
export function diagnoseMapsUrl(url) {
  const s = String(url || '').trim();
  if (!s) return { ok: false, code: 'empty', message: '' };
  if (isGoogleShortUrl(s)) {
    return {
      ok: false,
      code: 'short_url',
      message: "This is a short URL. Open it in Google Maps, then copy the full URL from the address bar (it should start with https://www.google.com/maps/).",
    };
  }
  const parsed = parseGoogleMapsUrl(s);
  if (parsed) return { ok: true, ...parsed };
  return {
    ok: false,
    code: 'no_match',
    message: "Couldn't find coordinates in this URL — the property will save without a map pin.",
  };
}
