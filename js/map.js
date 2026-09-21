import { state } from './app.js';
import { loadProperties } from './storage.js';
import { CONFIG, LS_KEYS } from './config.js';
import { computeAll } from './calc.js';
import { gutCheckAverage } from './score.js';

// Screen B — Map (build spec § 5.2 / § 10).
// Lazy-loads Leaflet from CDN, renders CARTO Positron tiles with our
// domain-restricted key, drops anchor pins for workplace/family and
// hollow-circle property pins for every saved property that has lat/lng.
// Filter controls at the top mirror Dashboard (type + state +
// hearted-only) and read the same pt.ui.filter localStorage key.

const LEAFLET_JS_CDN = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS_CDN = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';

const DEFAULT_FILTER = {
  types: ['condo', 'townhouse', 'sfh'],
  states: ['VA', 'MD', 'DC'],
  hearted_only: false,
};

// --- CSS/JS lazy loaders ---

function ensureLeafletCss() {
  if (document.querySelector(`link[data-leaflet-css]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = LEAFLET_CSS_CDN;
  link.setAttribute('data-leaflet-css', '1');
  document.head.appendChild(link);
}

let leafletPromise = null;
function loadLeaflet() {
  ensureLeafletCss();
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LEAFLET_JS_CDN;
    s.async = true;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error('Failed to load Leaflet from the CDN.'));
    document.head.appendChild(s);
  });
  return leafletPromise;
}

// --- Helpers ---

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtPct(p) {
  if (p == null || !Number.isFinite(p)) return '—';
  return Math.round(p * 100) + '%';
}
function firstLetter(nickname) {
  const s = String(nickname || '').trim();
  if (!s) return '?';
  return s[0].toUpperCase();
}
function typeStateLabel(p) {
  const t = p.type === 'condo' ? 'Condo' : p.type === 'townhouse' ? 'Townhouse' : p.type === 'sfh' ? 'Detached' : '—';
  return p.state ? `${t} · ${p.state}` : t;
}
function typeBadgeClass(type) {
  if (type === 'condo') return 'condo';
  if (type === 'townhouse') return 'th';
  if (type === 'sfh') return 'sfh';
  return '';
}
function readFilter() {
  try {
    const raw = localStorage.getItem(LS_KEYS.UI_FILTER);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      types: Array.isArray(parsed.types) ? parsed.types : DEFAULT_FILTER.types.slice(),
      states: Array.isArray(parsed.states) ? parsed.states : DEFAULT_FILTER.states.slice(),
      hearted_only: !!parsed.hearted_only,
    };
  } catch { return { ...DEFAULT_FILTER, types: DEFAULT_FILTER.types.slice(), states: DEFAULT_FILTER.states.slice() }; }
}
function writeFilter(filter) {
  try { localStorage.setItem(LS_KEYS.UI_FILTER, JSON.stringify(filter)); }
  catch { /* ignore */ }
}
function loadSelectedIds() {
  try {
    const raw = localStorage.getItem(LS_KEYS.UI_SELECTED);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveSelectedIds(ids) {
  try { localStorage.setItem(LS_KEYS.UI_SELECTED, JSON.stringify(ids)); }
  catch { /* ignore */ }
}

function passesFilter(p, filter) {
  if (!filter.types.includes(p.type)) return false;
  if (!filter.states.includes(p.state)) return false;
  if (filter.hearted_only && !p.hearted) return false;
  return true;
}

// --- Renderers ---

function renderControls(filter) {
  const chk = (group, value, label) => {
    const on = filter[group].includes(value);
    return `<label class="${on ? 'checked' : ''}"><input type="checkbox" data-filter-group="${escapeHtml(group)}" data-filter-value="${escapeHtml(value)}" ${on ? 'checked' : ''}> ${escapeHtml(label)}</label>`;
  };
  return `
    <div class="map-controls">
      <div class="filter-group">
        <span class="filter-label">Show</span>
        ${chk('types', 'condo', 'Condo')}
        ${chk('types', 'townhouse', 'Townhouse')}
        ${chk('types', 'sfh', 'Detached SFH')}
      </div>
      <div class="filter-group">
        <span class="filter-label">State</span>
        ${chk('states', 'VA', 'VA')}
        ${chk('states', 'MD', 'MD')}
        ${chk('states', 'DC', 'DC')}
      </div>
      <div class="filter-group">
        <label class="${filter.hearted_only ? 'checked' : ''}">
          <input type="checkbox" id="map-hearted" ${filter.hearted_only ? 'checked' : ''}>
          Hearted only
        </label>
      </div>
      <div class="map-legend">
        <span><span class="legend-marker anchor"></span> Anchor (work / family)</span>
        <span><span class="legend-marker"></span> Property</span>
      </div>
    </div>
  `;
}

function popupHtml(p, assumptions) {
  const c = computeAll(p, assumptions);
  const gut = gutCheckAverage(p.gut_check);
  return `
    <div class="map-popup">
      <div class="map-popup-title">${escapeHtml(p.nickname || '(untitled)')}</div>
      <div><span class="type-badge ${typeBadgeClass(p.type)}">${escapeHtml(typeStateLabel(p))}</span></div>
      <div class="map-popup-stat">All-in / mo: <strong>${escapeHtml(fmtMoney(c.allInMonthly))}</strong></div>
      <div class="map-popup-stat">% of net: <strong>${escapeHtml(fmtPct(c.pctNet))}</strong></div>
      <div class="map-popup-stat">Gut: <strong>${gut == null ? '—' : gut.toFixed(1)}</strong></div>
      <div class="map-popup-actions">
        <a href="#add/${encodeURIComponent(p.id)}">Edit</a>
        <a href="#" data-map-compare-id="${escapeHtml(p.id)}">Open in Compare</a>
      </div>
    </div>
  `;
}

// --- Marker builders ---

function makeAnchorIcon(L, label) {
  return L.divIcon({
    className: 'map-anchor-icon',
    html: `<div class="anchor-dot" title="${escapeHtml(label)}"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}
function makePropertyIcon(L, letter, hearted) {
  return L.divIcon({
    className: 'map-property-icon',
    html: `<div class="property-dot ${hearted ? 'hearted' : ''}">${escapeHtml(letter)}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// --- Mount ---

export async function mountMap(container) {
  if (container._abortController) container._abortController.abort();
  const controller = new AbortController();
  container._abortController = controller;
  const { signal } = controller;

  container.innerHTML = '<p class="loading-inline">Loading map…</p>';

  if (!state.assumptions) {
    container.innerHTML = `<div class="banner banner-error">Assumptions haven't loaded. Try refreshing.</div>`;
    return;
  }

  let allProperties = [];
  try {
    const { data } = await loadProperties(state.pat);
    allProperties = Array.isArray(data) ? data : [];
  } catch (e) {
    container.innerHTML = `<div class="banner banner-error">Failed to load properties: ${escapeHtml(e.message || String(e))}</div>`;
    return;
  }

  let L;
  try {
    L = await loadLeaflet();
  } catch (e) {
    container.innerHTML = `<div class="banner banner-error">${escapeHtml(e.message || String(e))}</div>`;
    return;
  }

  let filter = readFilter();

  // Track live Leaflet layers so we can efficiently rebuild pins on
  // filter changes without tearing down the whole map.
  let map = null;
  let propertyLayer = null;

  function render() {
    container.innerHTML = `
      <div class="screen-header">
        <h2>Map</h2>
        <div class="header-actions">
          <span class="note">Click any pin for details</span>
        </div>
      </div>
      ${renderControls(filter)}
      <div id="map-canvas" class="map-canvas"></div>
      <p class="footer-note">Property pins only appear when the property's Google Maps URL has been pasted on the Add form. Add or paste a URL there to place a pin here.</p>
    `;
    initLeaflet();
  }

  function initLeaflet() {
    const el = document.getElementById('map-canvas');
    if (!el) return;
    if (map) { map.remove(); map = null; }
    map = L.map(el, { center: [38.97, -77.17], zoom: 11, scrollWheelZoom: false });
    L.tileLayer(
      `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${CONFIG.CARTO_KEY}`,
      {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }
    ).addTo(map);

    // Anchor pins.
    const locs = state.assumptions.locations || {};
    if (locs.workplace?.lat != null && locs.workplace?.lng != null) {
      L.marker([locs.workplace.lat, locs.workplace.lng], { icon: makeAnchorIcon(L, 'Workplace') })
        .bindTooltip('Workplace', { direction: 'top' })
        .addTo(map);
    }
    if (locs.family?.lat != null && locs.family?.lng != null) {
      L.marker([locs.family.lat, locs.family.lng], { icon: makeAnchorIcon(L, 'Family') })
        .bindTooltip('Family (Aspen Hill)', { direction: 'top' })
        .addTo(map);
    }

    rebuildPropertyLayer();

    // Fit bounds to whatever we have, with a reasonable minimum.
    fitBoundsToPins();
  }

  function rebuildPropertyLayer() {
    if (!map) return;
    if (propertyLayer) { propertyLayer.remove(); propertyLayer = null; }
    propertyLayer = L.layerGroup();
    for (const p of allProperties) {
      if (p.lat == null || p.lng == null) continue;
      if (!passesFilter(p, filter)) continue;
      const marker = L.marker([p.lat, p.lng], {
        icon: makePropertyIcon(L, firstLetter(p.nickname), p.hearted),
      });
      marker.bindPopup(popupHtml(p, state.assumptions), { maxWidth: 260 });
      marker.on('popupopen', (e) => {
        const el = e.popup.getElement();
        if (!el) return;
        const link = el.querySelector('[data-map-compare-id]');
        if (link) {
          link.addEventListener('click', (ev) => {
            ev.preventDefault();
            openInCompare(p.id);
          });
        }
      });
      marker.addTo(propertyLayer);
    }
    propertyLayer.addTo(map);
    fitBoundsToPins();
  }

  function fitBoundsToPins() {
    if (!map) return;
    const points = [];
    const locs = state.assumptions.locations || {};
    if (locs.workplace?.lat != null) points.push([locs.workplace.lat, locs.workplace.lng]);
    if (locs.family?.lat != null) points.push([locs.family.lat, locs.family.lng]);
    for (const p of allProperties) {
      if (p.lat == null || p.lng == null) continue;
      if (!passesFilter(p, filter)) continue;
      points.push([p.lat, p.lng]);
    }
    if (points.length >= 2) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 13 });
    } else if (points.length === 1) {
      map.setView(points[0], 12);
    }
  }

  function openInCompare(id) {
    let ids = loadSelectedIds();
    if (!ids.includes(id)) ids.push(id);
    while (ids.length > 3) ids.shift();
    saveSelectedIds(ids);
    window.location.hash = '#compare';
  }

  function onChange(e) {
    const el = e.target;
    if (!el) return;
    if (el.dataset && el.dataset.filterGroup) {
      const group = el.dataset.filterGroup;
      const value = el.dataset.filterValue;
      const list = filter[group];
      const idx = list.indexOf(value);
      if (idx === -1) list.push(value); else list.splice(idx, 1);
      writeFilter(filter);
      // Update chip visual without full re-render, then rebuild pins.
      updateChipVisuals();
      rebuildPropertyLayer();
      return;
    }
    if (el.id === 'map-hearted') {
      filter.hearted_only = el.checked;
      writeFilter(filter);
      updateChipVisuals();
      rebuildPropertyLayer();
      return;
    }
  }

  function updateChipVisuals() {
    container.querySelectorAll('.map-controls label').forEach((lbl) => {
      const input = lbl.querySelector('input[type="checkbox"]');
      if (!input) return;
      lbl.classList.toggle('checked', input.checked);
    });
  }

  container.addEventListener('change', onChange, { signal });

  render();
}
