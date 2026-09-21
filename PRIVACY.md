# Privacy

## What this app is

A personal property comparison tool built for one family member. It runs
entirely in your browser.

## What data it stores

- Property details you enter (address, price, HOA, ratings, notes, etc.)
- A set of financial assumptions (income, growth rates, tax rates)
- A GitHub Personal Access Token (PAT) that gives it read/write access
  to a single private repository under the owner's account

## Where the data lives

All property data is stored in the private GitHub repository
`opoo-em/property-tool-private`. Only GitHub accounts with access to
that repository can read it. The PAT itself lives in your browser's
`localStorage`. It is never sent anywhere except to `api.github.com`.

## What data leaves your browser

Two things:

1. **GitHub API** (`api.github.com`) — for reading and writing your
   property data and assumptions.
2. **CARTO** (`basemaps.cartocdn.com`) — for the map tiles on the Map
   screen. CARTO sees which map tiles are requested (roughly, which
   geographic areas you're looking at) but never sees your property
   data, prices, or notes.

No analytics. No telemetry. No ads. No third parties beyond those two.

## How to stop

- Revoke the PAT at
  <https://github.com/settings/personal-access-tokens>
- Delete the private data repository if you want the data gone entirely
- The app will stop working immediately in either case
