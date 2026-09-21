import { state } from './app.js';
import { loadProperties, saveProperties } from './storage.js';
import { diagnoseMapsUrl } from './url-parse.js';

// Screen C — Add / Edit Property (build spec § 5.3, wireframe screen-b).
// Mirrors the mount + delegated-listener + AbortController pattern from
// assumptions.js. Kept spec-driven where practical (radio groups,
// gut-check questions), but form layout is per-row rather than one big
// declarative table because the sections are heterogeneous.

// --- State-based auto-suggest defaults (§ 5.3 bullet 4) ---
// Only ever fills fields that are still null. Never clobbers a value
// the user (or a prior edit) has entered.
const STATE_DEFAULTS = {
  VA: { tax_rate_pct: 1.12, insurance: { condo: 55, townhouse: 55, sfh: 120 } },
  MD: { tax_rate_pct: 1.15, insurance: { condo: 55, townhouse: 55, sfh: 120 } },
  DC: { tax_rate_pct: 0.58, insurance: { condo: 50, townhouse: 50, sfh: 120 } },
};

const GUT_CHECK_QUESTIONS = [
  { path: 'gut_check.grandson_visits', label: 'Would your grandson happily visit here regularly?' },
  { path: 'gut_check.friends_over', label: 'Would you happily invite friends over for dinner?' },
  { path: 'gut_check.diy_projects', label: 'Can you picture yourself making this home your own — projects, DIY, personalizing it?' },
  { path: 'gut_check.pepper_safe', label: 'Is this a place Pepper can be safe and happy — walks, backyard/space, sunny spots?' },
  { path: 'gut_check.outdoor_life', label: 'Does this give you enough outdoor life — coffee outside, birds, sun on your face?' },
];

const OUTDOOR_OPTIONS = [
  { value: '', label: '— select —' },
  { value: 'small_balcony', label: 'Small balcony' },
  { value: 'large_balcony', label: 'Large balcony / terrace' },
  { value: 'patio', label: 'Patio' },
  { value: 'small_yard', label: 'Small yard' },
  { value: 'large_yard', label: 'Large yard' },
  { value: 'none', label: 'None' },
];

// --- Path helpers (dotted-path get/set on a plain object) ---

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((acc, key) => {
    if (acc[key] == null || typeof acc[key] !== 'object') acc[key] = {};
    return acc[key];
  }, obj);
  parent[last] = value;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function attrVal(v) {
  return v == null ? '' : escapeHtml(v);
}

function generateId() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return 'prop_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function blankProperty() {
  return {
    id: null,
    nickname: '',
    address: '',
    listing_url: '',
    maps_url: '',
    lat: null,
    lng: null,
    type: null,
    state: null,
    city: '',
    hearted: false,
    rejected: false,
    rejection_reason: null,
    financial: {
      price: null,
      hoa_monthly: null,
      property_tax_rate_pct: null,
      insurance_monthly: null,
      down_payment: null,
      mortgage_rate_pct: null,
      maintenance_sqft_override: null,
      first_time_dc_buyer: false,
    },
    physical: {
      beds: null, baths: null, sqft: null, year_built: null, floor: null,
      outdoor_space: null, single_level: null, condition: null,
    },
    hard_filters: {
      covered_assigned_parking: 'unknown',
      elevator: 'unknown',
      not_ground_floor: 'unknown',
      pet_friendly: 'unknown',
    },
    commute: {
      tysons_minutes_one_way: null,
      aspen_hill_minutes_one_way: null,
      walk_score: null,
      near_metro: null,
    },
    gut_check: {
      grandson_visits: null, friends_over: null, diy_projects: null,
      pepper_safe: null, outdoor_life: null,
      notes: '', last_updated: null,
    },
    created_at: null,
    updated_at: null,
  };
}

// Apply state-based auto-suggest defaults to any still-null fields.
// Fires when state or type changes; harmless when neither has changed.
function applyStateDefaults(working) {
  const st = working.state;
  const type = working.type;
  if (!st || !STATE_DEFAULTS[st]) return;
  const def = STATE_DEFAULTS[st];
  if (working.financial.property_tax_rate_pct == null) {
    working.financial.property_tax_rate_pct = def.tax_rate_pct;
  }
  if (type && working.financial.insurance_monthly == null) {
    const key = type === 'sfh' ? 'sfh' : type; // 'condo'|'townhouse'
    working.financial.insurance_monthly = def.insurance[key] ?? null;
  }
}

// --- Renderers ---

function textRow(label, path, working, opts = {}) {
  const rawValue = getPath(working, path);
  const format = opts.format; // 'money' | undefined
  let displayValue;
  if (rawValue == null || rawValue === '') {
    displayValue = '';
  } else if (format === 'money' && typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    displayValue = rawValue.toLocaleString('en-US');
  } else {
    displayValue = String(rawValue);
  }
  // We deliberately render every numeric field as type="text" — the
  // browser strips commas from <input type="number"> silently, and any
  // paste like "699,900" comes back as "" (the source of a real Save
  // regression). coerce() below tolerates commas, dollar signs, and
  // percent signs when reading back.
  const wantsNumber = opts.type === 'number';
  const type = wantsNumber ? 'text' : (opts.type || 'text');
  const inputmode = opts.inputmode || (wantsNumber ? 'decimal' : '');
  const inputmodeAttr = inputmode ? ` inputmode="${inputmode}"` : '';
  const placeholder = opts.placeholder ? ` placeholder="${escapeHtml(opts.placeholder)}"` : '';
  const helper = opts.helper ? `<span class="helper">${escapeHtml(opts.helper)}</span>` : '';
  const inputStyle = opts.narrow ? ' style="max-width:120px;"' : '';
  const dtype = opts.dtype || (wantsNumber ? 'number' : 'string');
  const dataFormat = format ? ` data-format="${escapeHtml(format)}"` : '';
  return `
    <div class="form-row">
      <label>${escapeHtml(label)}</label>
      <input type="${type}"${inputmodeAttr}${placeholder}${inputStyle}
             data-path="${escapeHtml(path)}" data-dtype="${escapeHtml(dtype)}"${dataFormat}
             value="${attrVal(displayValue)}">
      ${helper}
    </div>
  `;
}

function radioRow(label, path, working, options, opts = {}) {
  const current = getPath(working, path);
  const helper = opts.helper ? `<span class="helper">${escapeHtml(opts.helper)}</span>` : '';
  const radios = options.map((o) => {
    // options: [{ value, label, dtype? }]
    const checked = String(current) === String(o.value) ? 'checked' : '';
    const dtype = o.dtype || 'string';
    return `
      <label>
        <input type="radio" name="radio-${escapeHtml(path)}"
               data-path="${escapeHtml(path)}" data-dtype="${escapeHtml(dtype)}"
               value="${attrVal(o.value)}" ${checked}>
        ${escapeHtml(o.label)}
      </label>
    `;
  }).join('');
  return `
    <div class="form-row">
      <label>${escapeHtml(label)}</label>
      <div class="radio-group">${radios}</div>
      ${helper}
    </div>
  `;
}

function selectRow(label, path, working, options, opts = {}) {
  const current = getPath(working, path) ?? '';
  const helper = opts.helper ? `<span class="helper">${escapeHtml(opts.helper)}</span>` : '';
  const opts_html = options.map((o) => {
    const sel = String(current) === String(o.value) ? 'selected' : '';
    return `<option value="${attrVal(o.value)}" ${sel}>${escapeHtml(o.label)}</option>`;
  }).join('');
  return `
    <div class="form-row">
      <label>${escapeHtml(label)}</label>
      <select data-path="${escapeHtml(path)}" data-dtype="string">${opts_html}</select>
      ${helper}
    </div>
  `;
}

function textareaRow(label, path, working, opts = {}) {
  const value = getPath(working, path) ?? '';
  const placeholder = opts.placeholder ? ` placeholder="${escapeHtml(opts.placeholder)}"` : '';
  return `
    <div class="form-row">
      <label>${escapeHtml(label)}</label>
      <textarea data-path="${escapeHtml(path)}" data-dtype="string"${placeholder} rows="3">${escapeHtml(value)}</textarea>
    </div>
  `;
}

function starRow(question, working) {
  const current = getPath(working, question.path);
  const rating = typeof current === 'number' ? current : 0;
  const stars = [1, 2, 3, 4, 5].map((n) => {
    const filled = n <= rating;
    return `<button type="button" class="star ${filled ? 'on' : ''}" data-star-value="${n}" aria-label="${n} star${n === 1 ? '' : 's'}">${filled ? '★' : '☆'}</button>`;
  }).join('');
  return `
    <div class="gutcheck-question" data-star-path="${escapeHtml(question.path)}">
      <div class="gutcheck-q-text">${escapeHtml(question.label)}</div>
      <div class="stars">${stars}</div>
    </div>
  `;
}

function renderMapsUrlHint(hint) {
  if (!hint || !hint.text) return '';
  return `<div class="form-hint ${hint.type || 'note'}">${escapeHtml(hint.text)}</div>`;
}

// Commute row with a "Look up in Google Maps" link that opens driving
// directions in a new tab, prefilled from the property (address or
// coords, whichever we have) to the anchor location. She reads the drive
// time in Maps and types it back — this is the honest "outsource the
// gathering" answer we can ship without a serverless proxy.
function commuteRow(label, path, working, opts) {
  const anchor = state.assumptions?.locations?.[opts.anchor];
  const origin = (working.lat != null && working.lng != null)
    ? `${working.lat},${working.lng}`
    : (working.address || '').trim();
  const dest = anchor?.address ? anchor.address : (anchor?.lat != null ? `${anchor.lat},${anchor.lng}` : '');
  const canLookUp = !!origin && !!dest;
  const url = canLookUp
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`
    : null;
  const value = getPath(working, path);
  const displayValue = (value == null || value === '') ? '' : String(value);
  const helper = opts.helper ? `<span class="helper">${escapeHtml(opts.helper)}</span>` : '';
  const lookupBtn = canLookUp
    ? `<a class="btn small subtle" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Look up in Google Maps →</a>`
    : `<span class="helper">Add an address or coordinates above to enable the Look-up link.</span>`;
  return `
    <div class="form-row">
      <label>${escapeHtml(label)}</label>
      <div class="commute-input-cluster">
        <input type="text" inputmode="decimal" style="max-width:120px;"
               data-path="${escapeHtml(path)}" data-dtype="number"
               value="${attrVal(displayValue)}">
        ${lookupBtn}
      </div>
      ${helper}
    </div>
  `;
}

function renderForm(working, isEdit, opts) {
  const stillGatheringInfo = opts.stillGatheringInfo;
  const mapsUrlHint = opts.mapsUrlHint;
  const saveStatus = opts.saveStatus;
  const saveMessage = opts.saveMessage;
  const heading = isEdit
    ? `Editing <span class="ink-2">${escapeHtml(working.nickname || 'property')}</span>`
    : 'Add Property';

  const type = working.type;
  const st = working.state;
  const isCondoOrTh = type === 'condo' || type === 'townhouse';
  const isSfh = type === 'sfh';

  // The "still gathering info" checkbox is transient UI state — it only
  // exists to satisfy the § 5.3 validation ("nickname AND (price OR flag)")
  // when a price is not yet known. It is not persisted to the property.
  const stillGatheringChecked = stillGatheringInfo ? 'checked' : '';

  const actionBar = (pos) => `
    <div class="header-actions">
      <span class="save-status ${escapeHtml(saveStatus || '')}" data-save-status>${escapeHtml(saveMessage || '')}</span>
      <button type="button" class="btn subtle" data-cancel-btn>Cancel</button>
      ${isEdit ? '<button type="button" class="btn subtle" data-delete-btn>Delete property</button>' : ''}
      <button type="button" class="btn primary" data-save-btn>Save</button>
    </div>
  `;

  return `
    <div class="screen-header">
      <h2>${heading}</h2>
      ${actionBar('top')}
    </div>

    <p class="intro-note">Nothing is required except a nickname (plus a price or "still gathering info" if you haven't got the number yet). Everything else can be filled in later.</p>

    <form id="add-edit-form" autocomplete="off" novalidate>

      <div class="form-section">
        <h3>Basics</h3>
        ${textRow('Nickname', 'nickname', working, { placeholder: 'e.g. Halstead 2B — Merrifield' })}
        ${textRow('Address', 'address', working)}
        ${textRow('Listing URL', 'listing_url', working, { type: 'url', placeholder: 'https://www.zillow.com/...' })}
        <div class="form-row">
          <label>Location <span class="helper">enables map pin</span></label>
          <input type="text" data-path="maps_url" data-dtype="string"
                 id="maps-url-input"
                 placeholder='e.g. "38.9128, -77.2265" or https://www.google.com/maps/...'
                 value="${attrVal(working.maps_url)}">
          <span class="helper">Easiest: right-click the spot in Google Maps → click the "lat, lng" line to copy → paste here. A full Maps URL also works.</span>
        </div>
        ${renderMapsUrlHint(mapsUrlHint)}
        ${radioRow('Property type', 'type', working, [
          { value: 'condo', label: 'Condo' },
          { value: 'townhouse', label: 'Townhouse' },
          { value: 'sfh', label: 'Detached SFH' },
        ])}
        ${radioRow('State', 'state', working, [
          { value: 'VA', label: 'VA' },
          { value: 'MD', label: 'MD' },
          { value: 'DC', label: 'DC' },
        ])}
        ${textRow('City / neighborhood', 'city', working)}
        <div class="form-row form-row-flag">
          <label>&nbsp;</label>
          <label class="checkbox-inline">
            <input type="checkbox" id="still-gathering-info" ${stillGatheringChecked}>
            <span>Still gathering info (no price yet)</span>
          </label>
        </div>
      </div>

      <div class="form-section">
        <h3>Financial</h3>
        ${textRow('Asking price', 'financial.price', working, { type: 'number', format: 'money', helper: 'Commas OK — 699,900 or 699900 both work.' })}
        ${textRow('Monthly HOA / condo fee', 'financial.hoa_monthly', working, { type: 'number', format: 'money', helper: '$0 for detached with no HOA' })}
        ${textRow('Property tax rate (effective, %)', 'financial.property_tax_rate_pct', working, { type: 'number', helper: 'Default: VA 1.12% · MD 1.15% · DC ~0.58% (post-Homestead)' })}
        ${textRow('Insurance / mo (est.)', 'financial.insurance_monthly', working, { type: 'number', format: 'money', helper: 'Default: $55 VA/MD condo · $50 DC condo · $120 SFH' })}
        ${textRow('Assumed mortgage rate (%)', 'financial.mortgage_rate_pct', working, { type: 'number', helper: 'Leave blank to use the Assumptions default (currently ' + (state.assumptions?.financing?.mortgage_rate_pct ?? '—') + '%). Condo overlay is added automatically.' })}
        ${isSfh ? textRow('Maintenance override ($/sqft/yr)', 'financial.maintenance_sqft_override', working, { type: 'number', placeholder: 'uses age-tier default', helper: 'Enter a value to override the age-tier default for this property' }) : ''}
        ${st === 'DC' ? radioRow('First-time DC buyer?', 'financial.first_time_dc_buyer', working, [
          { value: 'true', label: 'Yes (reduced recordation)', dtype: 'bool' },
          { value: 'false', label: 'No / N/A', dtype: 'bool' },
        ]) : ''}
        <p class="section-intro"><em>Down payment is set globally on <a href="#assumptions">Assumptions</a> (currently ${escapeHtml('$' + (state.assumptions?.financing?.down_payment_default ?? 140000).toLocaleString('en-US'))}) — one value applies to every property. Change it there to test different scenarios.</em></p>
      </div>

      <div class="form-section">
        <h3>Physical</h3>
        ${textRow('Bedrooms', 'physical.beds', working, { type: 'number', narrow: true })}
        ${textRow('Bathrooms', 'physical.baths', working, { type: 'number', narrow: true })}
        ${textRow('Square feet', 'physical.sqft', working, { type: 'number', format: 'money' })}
        ${textRow('Year built', 'physical.year_built', working, { type: 'number', narrow: true })}
        ${isCondoOrTh ? textRow('Floor', 'physical.floor', working, { type: 'number', narrow: true, helper: 'For condo/TH only' }) : ''}
        ${selectRow('Outdoor space', 'physical.outdoor_space', working, OUTDOOR_OPTIONS)}
        ${radioRow('Single-level living?', 'physical.single_level', working, [
          { value: 'true', label: 'Yes', dtype: 'bool' },
          { value: 'false', label: 'No (multi-level)', dtype: 'bool' },
          { value: '', label: 'N/A (elevator building)', dtype: 'nullbool' },
        ])}
        ${textRow('Condition (1–5)', 'physical.condition', working, { type: 'number', narrow: true, helper: '1 = major work needed · 2 = dated throughout, functional · 3 = livable but needs updates (kitchen/bath/floors) · 4 = move-in ready, minor cosmetic possible · 5 = brand new or fully renovated' })}
      </div>

      <div class="form-section hard-filters">
        <h3>Hard filters (deal-breakers)</h3>
        <p class="section-intro">If any is "No," the property moves to Rejected on the Dashboard. Deal-breakers can be edited later if info was wrong.</p>
        ${radioRow('Covered + assigned parking?', 'hard_filters.covered_assigned_parking', working, [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'unknown', label: 'Unknown' },
        ])}
        ${radioRow('Elevator building?', 'hard_filters.elevator', working, [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'unknown', label: 'Unknown' },
          { value: 'n/a', label: 'N/A' },
        ], { helper: '(N/A for SFH)' })}
        ${radioRow('Not ground floor?', 'hard_filters.not_ground_floor', working, [
          { value: 'yes', label: 'Yes (above ground)' },
          { value: 'no', label: 'No (ground floor)' },
          { value: 'unknown', label: 'Unknown' },
          { value: 'n/a', label: 'N/A' },
        ], { helper: '(N/A for SFH)' })}
        ${radioRow('Pet-friendly (20-lb dog)?', 'hard_filters.pet_friendly', working, [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'unknown', label: 'Unknown' },
        ])}
      </div>

      <div class="form-section">
        <h3>Commute &amp; walkability</h3>
        ${commuteRow('Drive to Tysons / West Park Dr', 'commute.tysons_minutes_one_way', working, {
          helper: 'min · one way, morning peak (getting to work). Click "Look up" to open Google Maps prefilled — copy the number back here.',
          anchor: 'workplace',
        })}
        ${commuteRow('Drive to Aspen Hill (visits)', 'commute.aspen_hill_minutes_one_way', working, {
          helper: 'min · one way, off-peak / non-rush-hour (typical visit time — e.g. Sunday morning, not evening rush).',
          anchor: 'family',
        })}
        ${textRow('Walk Score (0–100)', 'commute.walk_score', working, { type: 'number', narrow: true, helper: 'Copy from the Zillow listing page' })}
        ${radioRow('Near Metro?', 'commute.near_metro', working, [
          { value: 'walkable', label: 'Walkable' },
          { value: 'short_drive', label: 'Short drive' },
          { value: 'no', label: 'No' },
        ])}
      </div>

      <div class="form-section">
        <h3>Gut check — your read of this property</h3>
        <p class="section-intro">Rate this from what you know now — listing photos, neighborhood, floor plan. Update it later if you visit and your read shifts. The tool doesn't score these; it captures your reactions so patterns become visible over time.</p>
        <p class="section-intro">Last updated: ${working.gut_check?.last_updated ? escapeHtml(new Date(working.gut_check.last_updated).toLocaleString()) : 'not yet rated'}</p>
        ${GUT_CHECK_QUESTIONS.map((q) => starRow(q, working)).join('')}
        ${textareaRow('Notes', 'gut_check.notes', working, { placeholder: 'What stood out? What worried you? What did the neighbors seem like? What did you learn if you visited?' })}
      </div>

      <div class="form-footer-bar">
        ${actionBar('bottom')}
      </div>

    </form>
  `;
}

// --- Validation ---

function validate(working, stillGatheringInfo) {
  const errors = [];
  if (!working.nickname || !working.nickname.trim()) {
    errors.push('Nickname is required.');
  }
  const price = working.financial?.price;
  if ((price == null || price === '' || Number(price) === 0) && !stillGatheringInfo) {
    errors.push('Enter a price, or check "Still gathering info".');
  }
  return errors;
}

// --- Mount ---

export async function mountAddEdit(container, propertyId) {
  if (container._abortController) container._abortController.abort();
  const controller = new AbortController();
  container._abortController = controller;
  const { signal } = controller;

  container.innerHTML = '<p class="loading-inline">Loading…</p>';

  // Always fetch properties fresh; the source of truth is the private repo.
  let allProperties = [];
  let propertiesSha = null;
  try {
    const { data, sha } = await loadProperties(state.pat);
    allProperties = Array.isArray(data) ? data : [];
    propertiesSha = sha;
  } catch (e) {
    container.innerHTML = `<div class="banner banner-error">Failed to load properties: ${escapeHtml(e.message || String(e))}</div>`;
    return;
  }

  const isEdit = !!propertyId;
  let working;
  if (isEdit) {
    const existing = allProperties.find((p) => p.id === propertyId);
    if (!existing) {
      container.innerHTML = `
        <div class="banner banner-error">Property <code>${escapeHtml(propertyId)}</code> not found.</div>
        <p><a class="btn subtle" href="#dashboard">← Back to Dashboard</a></p>
      `;
      return;
    }
    working = structuredClone(existing);
    // Ensure new-schema fields exist even on older saved records.
    if (!working.financial) working.financial = {};
    if (!working.physical) working.physical = {};
    if (!working.hard_filters) working.hard_filters = {};
    if (!working.commute) working.commute = {};
    if (!working.gut_check) working.gut_check = {};
  } else {
    working = blankProperty();
  }

  // UI-only state
  let stillGatheringInfo = false;
  let mapsUrlHint = null; // { text, type: 'note' | 'error' }
  let saveStatus = 'idle';
  let saveMessage = '';

  container.addEventListener('change', onFieldChange, { signal });
  container.addEventListener('focusout', onFieldBlur, { signal });
  container.addEventListener('click', onClick, { signal });
  container.addEventListener('input', onInput, { signal });

  function render() {
    container.innerHTML = renderForm(working, isEdit, {
      stillGatheringInfo, mapsUrlHint, saveStatus, saveMessage,
    });
  }

  function setSaveState(next, message = '') {
    saveStatus = next;
    saveMessage = message;
    // Update both the header and footer status pills.
    container.querySelectorAll('[data-save-status]').forEach((el) => {
      el.className = `save-status ${next}`;
      el.textContent = message;
    });
  }

  // Coerce an input value string into the type indicated by data-dtype.
  // Number coercion tolerates commas, dollar signs, percent signs, and
  // whitespace so "$699,900" and "6.9%" round-trip cleanly.
  function coerce(raw, dtype) {
    if (dtype === 'string') return raw;
    if (dtype === 'bool') return raw === 'true';
    if (dtype === 'nullbool') return raw === '' ? null : raw === 'true';
    if (dtype === 'number') {
      if (raw == null) return null;
      const stripped = String(raw).replace(/[$%,\s]/g, '').replace(/^\+/, '');
      if (stripped === '' || stripped === '-') return null;
      const n = Number(stripped);
      return Number.isFinite(n) ? n : null;
    }
    return raw;
  }

  // Read every [data-path] input in the container into `working`. Called
  // at the top of doSave() so a value the user typed but never blurred
  // out of doesn't get dropped on the floor by the change-event pipeline.
  function syncInputsToWorking() {
    const inputs = container.querySelectorAll('[data-path]');
    inputs.forEach((el) => {
      const path = el.dataset.path;
      const dtype = el.dataset.dtype || 'string';
      let raw;
      if (el.type === 'checkbox') raw = el.checked ? 'true' : 'false';
      else if (el.type === 'radio') {
        if (!el.checked) return;
        raw = el.value;
      } else {
        raw = el.value;
      }
      const value = coerce(raw, dtype);
      setPath(working, path, value);
    });
  }

  function onInput(e) {
    const el = e.target;
    // Live path for the still-gathering checkbox (no data-path)
    if (el.id === 'still-gathering-info') {
      stillGatheringInfo = el.checked;
      // Clear any prior "price required" error hint if present.
      if (saveStatus === 'error') setSaveState('idle', '');
      return;
    }
  }

  function onFieldChange(e) {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.path) return;
    const path = el.dataset.path;
    let dtype = el.dataset.dtype || 'string';
    let raw = el.value;
    if (el.type === 'checkbox') raw = el.checked ? 'true' : 'false';
    const value = coerce(raw, dtype);
    setPath(working, path, value);

    // Cross-field reactions.
    if (path === 'state' || path === 'type') {
      applyStateDefaults(working);
      // Some fields hinge on state/type (maintenance override, DC buyer,
      // floor for condo/TH, insurance placeholder). Re-render to reflect.
      render();
    } else if (path === 'physical.single_level' && dtype === 'nullbool' && el.value === '') {
      // The N/A radio for single-level stores null in the property.
      setPath(working, 'physical.single_level', null);
    }

    // Any gut-check text change (notes) doesn't touch last_updated.
    // Only star clicks bump last_updated.

    if (saveStatus !== 'idle') setSaveState('idle', '');
  }

  function onFieldBlur(e) {
    const el = e.target;
    // Google Maps URL / coordinate parsing on blur.
    if (el && el.id === 'maps-url-input') {
      const raw = el.value;
      working.maps_url = raw;
      if (!raw.trim()) {
        working.lat = null;
        working.lng = null;
        mapsUrlHint = null;
      } else {
        const d = diagnoseMapsUrl(raw);
        if (d.ok) {
          working.lat = d.lat;
          working.lng = d.lng;
          mapsUrlHint = { text: `Pinned at ${d.lat}, ${d.lng}.`, type: 'note' };
        } else {
          working.lat = null;
          working.lng = null;
          mapsUrlHint = d.code === 'empty' ? null : { text: d.message, type: 'error' };
        }
      }
      render();
      return;
    }
    // Reformat money fields with commas after blur (699900 → 699,900).
    if (el && el.dataset && el.dataset.format === 'money') {
      const value = getPath(working, el.dataset.path);
      if (typeof value === 'number' && Number.isFinite(value)) {
        el.value = value.toLocaleString('en-US');
      }
    }
  }

  function onClick(e) {
    const target = e.target.closest('button, a');
    if (!target) return;

    if (target.closest('[data-save-btn]')) {
      e.preventDefault();
      doSave();
      return;
    }
    if (target.closest('[data-cancel-btn]')) {
      e.preventDefault();
      window.location.hash = '#dashboard';
      return;
    }
    if (target.closest('[data-delete-btn]')) {
      e.preventDefault();
      doDelete();
      return;
    }
    if (target.classList.contains('star')) {
      e.preventDefault();
      const wrap = target.closest('[data-star-path]');
      if (!wrap) return;
      const path = wrap.dataset.starPath;
      const value = Number(target.dataset.starValue);
      const current = getPath(working, path);
      // Second click on the same star clears the rating.
      const next = current === value ? null : value;
      setPath(working, path, next);
      working.gut_check.last_updated = new Date().toISOString();
      render();
      return;
    }
  }

  async function doSave() {
    // Fold in anything the user typed but hasn't blurred yet — otherwise
    // clicking Save with focus still in the price field would validate
    // against a stale null.
    syncInputsToWorking();

    const errors = validate(working, stillGatheringInfo);
    if (errors.length > 0) {
      setSaveState('error', errors.join(' '));
      return;
    }

    const nowIso = new Date().toISOString();
    if (!isEdit) {
      working.id = generateId();
      working.created_at = nowIso;
    }
    working.updated_at = nowIso;

    // Trim string fields.
    working.nickname = (working.nickname || '').trim();
    working.address = (working.address || '').trim();
    working.city = (working.city || '').trim();
    working.listing_url = (working.listing_url || '').trim();
    working.maps_url = (working.maps_url || '').trim();

    // Reject/rejection derivation: hard filters can set rejected=true.
    // For now we leave rejected/rejection_reason to be computed at read
    // time via calc.evaluateHardFilters — keep the persisted schema
    // clean unless a downstream view asks us to persist it.

    // Both save buttons live in the DOM (header + footer). Disable both.
    const saveBtns = container.querySelectorAll('[data-save-btn]');
    saveBtns.forEach((b) => { b.disabled = true; });
    setSaveState('saving', 'Saving…');

    let nextArray;
    if (isEdit) {
      nextArray = allProperties.map((p) => (p.id === working.id ? working : p));
    } else {
      nextArray = [...allProperties, working];
    }

    try {
      await saveProperties(state.pat, nextArray, propertiesSha);
      setSaveState('saved', 'Saved.');
      // Land back on Dashboard after a beat so she can see the confirmation.
      setTimeout(() => { window.location.hash = '#dashboard'; }, 700);
    } catch (e) {
      setSaveState('error', e.message || String(e));
      saveBtns.forEach((b) => { b.disabled = false; });
    }
  }

  async function doDelete() {
    if (!isEdit) return;
    const label = working.nickname || working.id;
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;

    setSaveState('saving', 'Deleting…');
    const nextArray = allProperties.filter((p) => p.id !== working.id);
    try {
      await saveProperties(state.pat, nextArray, propertiesSha);
      window.location.hash = '#dashboard';
    } catch (e) {
      setSaveState('error', e.message || String(e));
    }
  }

  render();
}
