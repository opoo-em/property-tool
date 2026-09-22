// Readable source of the "Add to Property Tool" bookmarklet.
//
// This file is NOT loaded by the app. It ships as a `javascript:` URL the
// user drags to their bookmarks bar — see README.md in this folder for the
// install steps and the current minified URL.
//
// Flow: user is on a Zillow listing page, clicks the bookmark, this script
// runs in the Zillow tab, extracts what it can, and opens the app in a
// new tab with the extracted fields packed into a URL query param. The
// app on boot (see js/app.js) reads that param, stashes it, cleans the
// URL, and mountAddEdit (see js/add-edit.js) merges it into a fresh
// property. The bookmarklet never touches GitHub — the user's own
// PAT in her app-tab localStorage still writes the property, unchanged.
//
// Two extraction paths, tried in order and merged (first-wins per field):
//   1. __NEXT_DATA__ (Next.js server-rendered state): most complete, but
//      Zillow rejigs the shape periodically. BFS scan looks for any
//      object with a numeric `price` plus `bedrooms` or `bathrooms` —
//      that's the property. Embedded JSON strings (gdpClientCache) get
//      parsed and walked too.
//   2. JSON-LD schema.org <script> blocks: fewer fields but the shape
//      is stable across Zillow redesigns. Used as fallback + cross-check.
//
// If both come back empty, the bookmarklet still opens the app tab with
// just listing_url populated — she can fill the rest manually, same as
// before.

(function () {
  var APP_URL = 'https://opoo-em.github.io/property-tool/';

  function isPropertyish(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    var hasPrice = typeof o.price === 'number' && o.price > 1000;
    var hasBedsOrBaths = 'bedrooms' in o || 'bathrooms' in o;
    return hasPrice && hasBedsOrBaths;
  }

  function findProperty(root) {
    var q = [root];
    var seen = typeof WeakSet === 'function' ? new WeakSet() : null;
    var steps = 0;
    while (q.length && steps < 200000) {
      steps++;
      var cur = q.shift();
      if (!cur || typeof cur !== 'object') continue;
      if (seen) { if (seen.has(cur)) continue; seen.add(cur); }
      if (isPropertyish(cur)) return cur;
      if (Array.isArray(cur)) {
        for (var i = 0; i < cur.length; i++) q.push(cur[i]);
        continue;
      }
      for (var k in cur) {
        if (!Object.prototype.hasOwnProperty.call(cur, k)) continue;
        var v = cur[k];
        if (typeof v === 'string' && v.length > 60) {
          var c = v.charAt(0);
          if (c === '{' || c === '[') {
            try { q.push(JSON.parse(v)); } catch (e) { /* skip */ }
          }
        } else if (v && typeof v === 'object') {
          q.push(v);
        }
      }
    }
    return null;
  }

  function mapHomeType(t) {
    if (!t) return null;
    var s = String(t).toUpperCase();
    if (s === 'CONDO' || s === 'APARTMENT') return 'condo';
    if (s === 'TOWNHOUSE') return 'townhouse';
    if (s === 'SINGLE_FAMILY' || s === 'MANUFACTURED') return 'sfh';
    return null;
  }

  function joinAddress(street, city, state, zip) {
    var cityState = [city, state].filter(Boolean).join(', ');
    return [street, cityState, zip].filter(Boolean).join(', ');
  }

  function fromNextData(prop, p) {
    var addrObj = p.address || null;
    if (addrObj && typeof addrObj === 'object') {
      var street = addrObj.streetAddress || '';
      var city = addrObj.city || '';
      var st = addrObj.state || '';
      var zip = addrObj.zipcode || addrObj.postalCode || '';
      var joined = joinAddress(street, city, st, zip);
      if (joined) prop.address = joined;
      if (city) prop.city = city;
      if (st && /^(VA|MD|DC)$/.test(st)) prop.state = st;
    } else if (p.streetAddress) {
      var joined2 = joinAddress(p.streetAddress, p.city || '', p.state || '', p.zipcode || '');
      if (joined2) prop.address = joined2;
      if (p.city) prop.city = p.city;
      if (p.state && /^(VA|MD|DC)$/.test(p.state)) prop.state = p.state;
    }

    if (typeof p.latitude === 'number' && typeof p.longitude === 'number') {
      prop.lat = p.latitude;
      prop.lng = p.longitude;
    }

    if (typeof p.price === 'number') prop.financial.price = p.price;
    if (typeof p.monthlyHoaFee === 'number') prop.financial.hoa_monthly = p.monthlyHoaFee;
    if (prop.financial.hoa_monthly == null && p.resoFacts && typeof p.resoFacts.hoaFee === 'number') {
      prop.financial.hoa_monthly = p.resoFacts.hoaFee;
    }
    if (prop.financial.hoa_monthly == null && typeof p.hoaFee === 'number') {
      prop.financial.hoa_monthly = p.hoaFee;
    }

    if (typeof p.bedrooms === 'number') prop.physical.beds = p.bedrooms;
    if (typeof p.bathrooms === 'number') prop.physical.baths = p.bathrooms;
    if (typeof p.livingArea === 'number') prop.physical.sqft = p.livingArea;
    if (typeof p.yearBuilt === 'number') prop.physical.year_built = p.yearBuilt;

    var t = mapHomeType(p.homeType);
    if (t) prop.type = t;
  }

  function fromJsonLd(prop, ld) {
    if (!ld) return;
    if (Array.isArray(ld)) { for (var i = 0; i < ld.length; i++) fromJsonLd(prop, ld[i]); return; }
    if (typeof ld !== 'object') return;
    if (ld['@graph']) fromJsonLd(prop, ld['@graph']);

    if (ld.offers && prop.financial.price == null) {
      var off = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
      if (off && typeof off.price !== 'undefined') {
        var n = Number(off.price);
        if (isFinite(n) && n > 1000) prop.financial.price = n;
      }
    }
    if (ld.address && typeof ld.address === 'object' && !prop.address) {
      var a = ld.address;
      var street = a.streetAddress || '';
      var city = a.addressLocality || '';
      var st = a.addressRegion || '';
      var zip = a.postalCode || '';
      var joined = joinAddress(street, city, st, zip);
      if (joined) prop.address = joined;
      if (city && !prop.city) prop.city = city;
      if (st && !prop.state && /^(VA|MD|DC)$/.test(st)) prop.state = st;
    }
    if (ld.geo && typeof ld.geo === 'object' && prop.lat == null) {
      var lat = Number(ld.geo.latitude);
      var lng = Number(ld.geo.longitude);
      if (isFinite(lat) && isFinite(lng)) { prop.lat = lat; prop.lng = lng; }
    }
    if (ld.floorSize && typeof ld.floorSize === 'object' && prop.physical.sqft == null) {
      var v = Number(ld.floorSize.value);
      if (isFinite(v)) prop.physical.sqft = v;
    }
    if (typeof ld.numberOfRooms === 'number' && prop.physical.beds == null) {
      prop.physical.beds = ld.numberOfRooms;
    }
  }

  function extract() {
    var prop = {
      listing_url: location.href.split('#')[0].split('?')[0],
      address: null, city: null, state: null,
      lat: null, lng: null,
      maps_url: null,
      type: null,
      financial: { price: null, hoa_monthly: null },
      physical: { beds: null, baths: null, sqft: null, year_built: null },
    };

    var nextEl = document.getElementById('__NEXT_DATA__');
    if (nextEl && nextEl.textContent) {
      try {
        var next = JSON.parse(nextEl.textContent);
        var p = findProperty(next);
        if (p) fromNextData(prop, p);
      } catch (e) { /* fall through to JSON-LD */ }
    }

    var lds = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < lds.length; i++) {
      try { fromJsonLd(prop, JSON.parse(lds[i].textContent)); } catch (e) { /* skip */ }
    }

    if (prop.lat != null && prop.lng != null && !prop.maps_url) {
      prop.maps_url = prop.lat + ', ' + prop.lng;
    }

    return prop;
  }

  try {
    var data = extract();
    var url = APP_URL + '?prefill=' + encodeURIComponent(JSON.stringify(data)) + '#add';
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    alert('Property Tool: could not extract from this page.\n\n' + msg + '\n\nOpening app without prefill.');
    window.open(APP_URL + '#add', '_blank', 'noopener');
  }
})();
