# Zillow → Property Tool bookmarklet

A one-click bookmark that reads a Zillow listing page and opens the
Property Tool at Add Property with everything it could extract already
pre-filled.

## Install

Open [`install.html`](./install.html) in your browser — from the
deployed app that's
[opoo-em.github.io/property-tool/bookmarklet/install.html](https://opoo-em.github.io/property-tool/bookmarklet/install.html).
It walks through dragging the button to your bookmarks bar. Both users
install it once per browser.

## How it works

Nothing server-side and nothing new to authenticate. When you click the
bookmark on a Zillow listing:

1. The bookmarklet's JS runs inside the Zillow tab and scrapes the page
   for property fields (see [`zillow-extract.js`](./zillow-extract.js)).
   Two extraction paths, tried in order and merged:
   - `<script id="__NEXT_DATA__">` — Next.js server-rendered state, has
     the most fields (price, HOA, beds/baths/sqft, year built, lat/lng,
     home type, address parts). BFS scan for any object with a numeric
     `price` plus `bedrooms` or `bathrooms`.
   - `<script type="application/ld+json">` — schema.org blocks. Fewer
     fields but stable across Zillow redesigns; used as fallback and
     cross-check.
2. Opens the Property Tool in a new tab at
   `https://opoo-em.github.io/property-tool/?prefill=<encoded JSON>#add`.
3. The app reads `?prefill=` at boot (see `js/app.js`), stashes it,
   cleans the URL so refresh doesn't re-apply it, and hands it to
   `mountAddEdit` (see `js/add-edit.js`), which merges it into a fresh
   property before rendering.

The write path is unchanged — your own PAT in the app tab's
`localStorage` still saves to `property-tool-private` via the GitHub
Contents API, exactly as before.

## Files

- `zillow-extract.js` — human-readable source of the bookmarklet.
- `zillow-extract.min.txt` — the actual `javascript:` URL that gets
  bookmarked. Rebuild from `zillow-extract.js` with the build script
  documented below.
- `install.html` — user-facing install page with the drag-to-bookmark
  button. Fetches `zillow-extract.min.txt` at page load so it always
  serves whatever the last build produced.

## Rebuild after editing the extractor

There is no framework and no CI step. To rebuild `zillow-extract.min.txt`
after changing `zillow-extract.js`, run this from the repo root:

```bash
node -e "
  const fs = require('fs');
  const src = fs.readFileSync('bookmarklet/zillow-extract.js', 'utf8');
  let code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}])\/\/[^\n]*/g, '\$1');
  code = code.replace(/\n+/g, '\n').replace(/[ \t]+/g, ' ').trim();
  fs.writeFileSync('bookmarklet/zillow-extract.min.txt', 'javascript:' + encodeURIComponent(code) + '\n');
  console.log('Wrote bookmarklet/zillow-extract.min.txt (' + code.length + ' chars source, ' + (encodeURIComponent(code).length + 'javascript:'.length) + ' chars URL)');
"
```

Then commit both files together — `install.html` reloads the new URL on
the next page visit automatically.

## Updating when Zillow changes their page shape

The extractor is defensive (BFS scan + JSON-LD fallback) but Zillow does
occasionally rename fields inside `__NEXT_DATA__`. If a field stops
coming through:

1. Open a Zillow listing that reproduces the miss.
2. In DevTools console: `JSON.parse(document.getElementById('__NEXT_DATA__').textContent)` and hunt for where the field lives now.
3. Tweak `zillow-extract.js`, rerun the build, commit both files.

## Not for search-results pages

The extractor keys off a single property object. On search-result pages,
map pages, or "your saved homes" pages, there isn't one — the
bookmarklet will just open the app with `listing_url` filled and nothing
else. That's by design; it's easier to catch than partially-guessed
wrong data.
