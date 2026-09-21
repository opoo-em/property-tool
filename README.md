# property-tool

Browser-based property comparator for a single user's home search. Runs
entirely in the browser; no server, no analytics, no third-party tracking.

**Live:** https://opoo-em.github.io/property-tool/

## How it works

The app is static HTML/CSS/JS (no build step). Data lives in a private
sibling repo, `opoo-em/property-tool-private`, and is read/written via
a fine-grained GitHub Personal Access Token the user pastes on first
launch. The token is stored in `localStorage` and never sent anywhere
except `api.github.com`.

Map tiles come from CARTO (Positron raster), keyed by a domain-restricted
API key — see `js/config.js`. Restriction to `opoo-em.github.io` is the
security model; the key being visible in the public repo is by design.

## Documentation

Design and build docs live in a separate owner-private repo:

- `property-comparator-design-handoff.md` — the design rationale ("why")
- `property-comparator-build-spec.md` — the executable spec this repo implements
- `wireframes/v4-grayscale.html` — the visual truth

## Privacy

See [PRIVACY.md](./PRIVACY.md).
