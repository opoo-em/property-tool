import { state } from './app.js';
import { loadProperties, saveProperties } from './storage.js';
import { LS_KEYS } from './config.js';
import { computeAll } from './calc.js';
import { financialScore, commuteScore, fitScore, gutCheckAverage } from './score.js';

// Screen A — Dashboard (build spec § 5.1, wireframe screen-a).
// Loads properties fresh on mount, keeps filter/sort/selection UI state in
// localStorage. computeAll + the four scorers are called once per property
// per render — pure functions, cheap enough to skip memoization.

// --- LocalStorage keys not in config.js's LS_KEYS ---
// (config.js already namespaces PAT, UI_SELECTED, UI_FILTER, UI_SORT, UI_REJECTED_COLLAPSED.)
const LS_SCORED_OPEN = 'pt.ui.scored_open';

const DEFAULT_FILTER = {
  types: ['condo', 'townhouse', 'sfh'],
  states: ['VA', 'MD', 'DC'],
  hearted_only: false,
  // Rejected properties are shown inline in the main table by default so
  // she can see WHY each was rejected as she scans the list, and remember
  // "this one doesn't fit because of X" while comparing across the rest.
  include_rejected: true,
};
const DEFAULT_SORT = 'recent';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recently added' },
  { value: 'price_asc', label: 'Price ↑' },
  { value: 'price_desc', label: 'Price ↓' },
  { value: 'allin_asc', label: 'All-in / mo ↑' },
  { value: 'allin_desc', label: 'All-in / mo ↓' },
  { value: 'pctnet_asc', label: '% of net ↑' },
  { value: 'gut_desc', label: 'Gut score ↓' },
];

// --- localStorage helpers ---

function lsRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}
function lsWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* ignore */ }
}
function loadSelected() {
  const raw = lsRead(LS_KEYS.UI_SELECTED, []);
  return Array.isArray(raw) ? raw : [];
}
function saveSelected(ids) { lsWrite(LS_KEYS.UI_SELECTED, ids); }

// --- Formatting ---

function fmtPrice(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtPct(proportion) {
  if (proportion == null || !Number.isFinite(proportion)) return '—';
  return Math.round(proportion * 100) + '%';
}
function dots(score) {
  if (score == null) return '<span class="dots-empty">—</span>';
  const filled = Math.max(0, Math.min(5, Math.round(score)));
  return '●'.repeat(filled) + '○'.repeat(5 - filled);
}
function gutLabel(score) {
  if (score == null) return '—';
  return score.toFixed(1);
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function typeLabel(type) {
  if (type === 'condo') return 'Condo · HOA';
  if (type === 'townhouse') return 'Townhouse';
  if (type === 'sfh') return 'Detached · No HOA';
  return '—';
}
function typeBadgeClass(type) {
  if (type === 'condo') return 'condo';
  if (type === 'townhouse') return 'th';
  if (type === 'sfh') return 'sfh';
  return '';
}

// --- Filter / sort ---

function passesFilter(row, filter) {
  const p = row.p;
  if (!filter.types.includes(p.type)) return false;
  if (!filter.states.includes(p.state)) return false;
  if (filter.hearted_only && !p.hearted) return false;
  if (!filter.include_rejected && row.c.isRejected) return false;
  return true;
}

function sortProperties(rows, sortKey) {
  const cmp = (a, b) => {
    switch (sortKey) {
      case 'price_asc': return (a.p.financial?.price ?? Infinity) - (b.p.financial?.price ?? Infinity);
      case 'price_desc': return (b.p.financial?.price ?? -Infinity) - (a.p.financial?.price ?? -Infinity);
      case 'allin_asc': return a.c.allInMonthly - b.c.allInMonthly;
      case 'allin_desc': return b.c.allInMonthly - a.c.allInMonthly;
      case 'pctnet_asc':
        return (a.c.pctNet ?? Infinity) - (b.c.pctNet ?? Infinity);
      case 'gut_desc':
        return (b.gut ?? -Infinity) - (a.gut ?? -Infinity);
      case 'recent':
      default:
        return (b.p.created_at || '').localeCompare(a.p.created_at || '');
    }
  };
  return rows.slice().sort(cmp);
}

// --- Row derivation ---

// Build one row descriptor per property. computeAll and the scorers are
// called here so both the filter/sort pipeline and the renderer can share
// the results.
function deriveRow(property, assumptions) {
  const c = computeAll(property, assumptions);
  const financial = financialScore(c.pctNet);
  const commuteS = commuteScore(
    property.commute?.tysons_minutes_one_way,
    property.commute?.aspen_hill_minutes_one_way,
  );
  const fitS = fitScore(
    property.physical?.outdoor_space,
    property.physical?.condition,
    property.physical?.sqft,
  );
  const gut = gutCheckAverage(property.gut_check);
  return { p: property, c, financial, commute: commuteS, fit: fitS, gut };
}

// --- Renderers ---

function renderFilterBar(filter, sortKey, counts) {
  const chk = (group, value, label) => {
    const on = filter[group].includes(value);
    return `<label class="${on ? 'checked' : ''}"><input type="checkbox" data-filter-group="${escapeHtml(group)}" data-filter-value="${escapeHtml(value)}" ${on ? 'checked' : ''}> ${escapeHtml(label)}</label>`;
  };
  const sortOpts = SORT_OPTIONS.map((o) =>
    `<option value="${escapeHtml(o.value)}" ${o.value === sortKey ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
  ).join('');
  return `
    <div class="filter-bar">
      <div class="filter-group">
        <span class="filter-label">Type</span>
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
          <input type="checkbox" id="filter-hearted" ${filter.hearted_only ? 'checked' : ''}>
          Hearted only
        </label>
        <label class="${filter.include_rejected ? 'checked' : ''}">
          <input type="checkbox" id="filter-include-rejected" ${filter.include_rejected ? 'checked' : ''}>
          Include rejected
        </label>
      </div>
      <div class="filter-group">
        <span class="filter-label">Sort</span>
        <select id="sort-select">${sortOpts}</select>
      </div>
      <span class="filter-count">${counts.shown} shown · ${counts.selected} selected · ${counts.rejected} rejected</span>
    </div>
  `;
}

function renderRow(row, selectedSet) {
  const { p, c, financial, commute, fit, gut } = row;
  const isSelected = selectedSet.has(p.id);
  const isRejected = c.isRejected;
  const warrant = (p.state === 'DC' && p.type === 'condo')
    ? '<br><span class="warrantability-note">⚠ warrantability watch</span>' : '';
  const addr = [p.address, p.state].filter(Boolean).join(', ');
  const priceCell = fmtPrice(p.financial?.price);
  const allInCell = (p.financial?.price ? fmtMoney(c.allInMonthly) : '—');
  const pctCell = fmtPct(c.pctNet);
  const rejectPill = isRejected
    ? `<div class="rejected-pill" title="Doesn't meet a hard filter">⊘ Rejected: ${escapeHtml(c.rejectionReasons.join('; '))}</div>`
    : '';
  const rowClass = [
    isSelected ? 'selected' : '',
    isRejected ? 'is-rejected' : '',
  ].filter(Boolean).join(' ');
  return `
    <tr class="${rowClass}" data-property-id="${escapeHtml(p.id)}">
      <td><input type="checkbox" data-select-id="${escapeHtml(p.id)}" ${isSelected ? 'checked' : ''}></td>
      <td>
        <a class="prop-name" href="#add/${encodeURIComponent(p.id)}">${escapeHtml(p.nickname || '(untitled)')}</a>
        <br><span class="note">${escapeHtml(addr || '—')}</span>
        ${rejectPill}
      </td>
      <td>
        <span class="type-badge ${typeBadgeClass(p.type)}">${escapeHtml(typeLabel(p.type))}${p.state ? ' · ' + escapeHtml(p.state) : ''}</span>
        ${warrant}
      </td>
      <td>${priceCell}</td>
      <td>${allInCell}</td>
      <td>${pctCell}</td>
      <td class="dots" title="Financial: % of state-adjusted monthly net">${dots(financial)}</td>
      <td class="dots" title="Commute: weekly hours (Tysons + Aspen Hill)">${dots(commute)}</td>
      <td class="dots" title="Fit: outdoor + condition + sqft">${dots(fit)}</td>
      <td class="stars">${escapeHtml(gutLabel(gut))}</td>
      <td class="row-actions">
        <button type="button" class="heart ${p.hearted ? 'on' : ''}" data-heart-id="${escapeHtml(p.id)}" aria-label="${p.hearted ? 'Unheart' : 'Heart'}">${p.hearted ? '♥' : '♡'}</button>
        <a class="btn small subtle" href="#add/${encodeURIComponent(p.id)}">Edit</a>
      </td>
    </tr>
  `;
}

function renderStatusSummary(rows) {
  const priced = rows.filter((r) => (r.p.financial?.price ?? 0) > 0);
  if (priced.length === 0) return '';
  const allIns = priced.map((r) => r.c.allInMonthly);
  const pcts = priced.filter((r) => r.c.pctNet != null).map((r) => r.c.pctNet);
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const min = Math.min(...allIns);
  const max = Math.max(...allIns);
  const avgAllIn = avg(allIns);
  const avgPct = pcts.length ? avg(pcts) : null;
  return `
    <div class="status-summary">
      <div class="stat">Avg all-in / mo: <b>${fmtMoney(avgAllIn)}</b></div>
      <div class="stat">Avg % of net: <b>${fmtPct(avgPct)}</b></div>
      <div class="stat">Range: <b>${fmtMoney(min)} – ${fmtMoney(max)}</b></div>
    </div>
  `;
}

function renderScoredExplainers(openMap) {
  const oo = (k) => openMap[k] ? 'open' : '';
  return `
    <div class="scored-explainers">
      <details class="scored" ${oo('financial')} data-scored-key="financial">
        <summary>? How Financial is scored</summary>
        <div class="scored-detail">
          <b>Financial</b> — from % of monthly net income (state-adjusted).
          <table>
            <tr><td>&lt; 33%</td><td>5 dots (very comfortable)</td></tr>
            <tr><td>33% – 42%</td><td>4 dots (comfortable)</td></tr>
            <tr><td>42% – 50%</td><td>3 dots (workable)</td></tr>
            <tr><td>50% – 60%</td><td>2 dots (stretch)</td></tr>
            <tr><td>≥ 60%</td><td>1 dot (tight)</td></tr>
          </table>
        </div>
      </details>
      <details class="scored" ${oo('commute')} data-scored-key="commute">
        <summary>? How Commute is scored</summary>
        <div class="scored-detail">
          <b>Commute</b> — weekly hours: Tysons round-trip × 4/wk + Aspen Hill round-trip × 2/wk.
          <table>
            <tr><td>&lt; 5 hr/wk</td><td>5 dots</td></tr>
            <tr><td>5 – 6.5 hr/wk</td><td>4 dots</td></tr>
            <tr><td>6.5 – 8 hr/wk</td><td>3 dots</td></tr>
            <tr><td>8 – 10 hr/wk</td><td>2 dots</td></tr>
            <tr><td>≥ 10 hr/wk</td><td>1 dot</td></tr>
          </table>
        </div>
      </details>
      <details class="scored" ${oo('fit')} data-scored-key="fit">
        <summary>? How Fit is scored</summary>
        <div class="scored-detail">
          <b>Fit</b> — average of outdoor-space sub-score, condition (1–5), and size sub-score (sqft/240, capped at 5). Missing sub-scores drop out of the average rather than penalizing to 0.
        </div>
      </details>
    </div>
  `;
}

// --- Mount ---

export async function mountDashboard(container) {
  if (container._abortController) container._abortController.abort();
  const controller = new AbortController();
  container._abortController = controller;
  const { signal } = controller;

  container.innerHTML = '<p class="loading-inline">Loading properties…</p>';

  // Local UI state — read once, mutated in place, persisted on change.
  let filter = { ...DEFAULT_FILTER, ...(lsRead(LS_KEYS.UI_FILTER, {}) || {}) };
  filter.types = Array.isArray(filter.types) ? filter.types : DEFAULT_FILTER.types.slice();
  filter.states = Array.isArray(filter.states) ? filter.states : DEFAULT_FILTER.states.slice();
  if (typeof filter.include_rejected !== 'boolean') filter.include_rejected = DEFAULT_FILTER.include_rejected;
  let sortKey = lsRead(LS_KEYS.UI_SORT, DEFAULT_SORT);
  if (!SORT_OPTIONS.some((o) => o.value === sortKey)) sortKey = DEFAULT_SORT;
  let scoredOpen = lsRead(LS_SCORED_OPEN, {}) || {};
  let selectedIds = loadSelected();

  // Data
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

  if (!state.assumptions) {
    container.innerHTML = `<div class="banner banner-error">Assumptions haven't loaded. Try refreshing.</div>`;
    return;
  }

  // Prune selection to IDs that still exist.
  const validIds = new Set(allProperties.map((p) => p.id));
  const prunedSel = selectedIds.filter((id) => validIds.has(id));
  if (prunedSel.length !== selectedIds.length) {
    selectedIds = prunedSel;
    saveSelected(selectedIds);
  }

  container.addEventListener('change', onChange, { signal });
  container.addEventListener('click', onClick, { signal });

  function render() {
    const derivedAll = allProperties.map((p) => deriveRow(p, state.assumptions));
    const shown = derivedAll.filter((r) => passesFilter(r, filter));
    const shownSorted = sortProperties(shown, sortKey);
    const rejectedShown = shownSorted.filter((r) => r.c.isRejected);
    const nonRejectedShown = shownSorted.filter((r) => !r.c.isRejected);
    const selectedSet = new Set(selectedIds);

    const counts = {
      shown: shownSorted.length,
      selected: selectedIds.length,
      rejected: rejectedShown.length,
    };
    const canCompare = selectedIds.length >= 2 && selectedIds.length <= 3;

    let body;
    if (allProperties.length === 0) {
      body = `
        <div class="empty-state">
          <p>No properties yet.</p>
          <p><a class="btn primary" href="#add">Add your first property</a></p>
        </div>
      `;
    } else {
      // Stat summary is calculated from non-rejected only — averaging a
      // property she's already ruled out into "avg all-in / mo" would
      // muddy the number. Rejected rows stay visible in the table so she
      // can still see them and remember why.
      body = `
        ${renderFilterBar(filter, sortKey, counts)}
        ${shownSorted.length === 0 ? '<p class="empty-inline">No properties match the current filter.</p>' : `
          <table class="props">
            <thead>
              <tr>
                <th style="width:30px;"></th>
                <th>Property</th>
                <th>Type</th>
                <th>Price</th>
                <th>All-in / mo</th>
                <th>% of net</th>
                <th>Financial</th>
                <th>Commute</th>
                <th>Fit</th>
                <th>Gut</th>
                <th style="width:130px;">Actions</th>
              </tr>
            </thead>
            <tbody>${shownSorted.map((r) => renderRow(r, selectedSet)).join('')}</tbody>
          </table>
          ${renderStatusSummary(nonRejectedShown)}
          ${renderScoredExplainers(scoredOpen)}
        `}
      `;
    }

    container.innerHTML = `
      <div class="screen-header">
        <h2>Your Properties</h2>
        <div class="header-actions">
          <span id="dashboard-save-status" class="save-status"></span>
          <a class="btn subtle" href="#add">+ Add Property</a>
          <button type="button" class="btn primary" id="compare-btn" ${canCompare ? '' : 'disabled'}>Compare selected (${selectedIds.length})</button>
        </div>
      </div>
      <p id="compare-hint" class="empty-inline" hidden></p>
      ${body}
    `;

    // Update the top nav's Compare label so it reads "Compare (N)".
    updateCompareBadge(selectedIds.length);
  }

  function setSaveStatus(next, msg) {
    const el = document.getElementById('dashboard-save-status');
    if (!el) return;
    el.className = `save-status ${next}`;
    el.textContent = msg || '';
  }

  async function persistHeartToggle(propertyId) {
    const prop = allProperties.find((p) => p.id === propertyId);
    if (!prop) return;
    prop.hearted = !prop.hearted;
    prop.updated_at = new Date().toISOString();
    render();
    setSaveStatus('saving', 'Saving…');
    try {
      const newSha = await saveProperties(state.pat, allProperties, propertiesSha);
      propertiesSha = newSha;
      setSaveStatus('saved', 'Saved.');
      setTimeout(() => setSaveStatus('idle', ''), 1500);
    } catch (e) {
      // Roll back the optimistic toggle so UI matches server state.
      prop.hearted = !prop.hearted;
      render();
      setSaveStatus('error', e.message || String(e));
    }
  }

  function toggleFilterListItem(list, value) {
    const idx = list.indexOf(value);
    if (idx === -1) list.push(value);
    else list.splice(idx, 1);
  }

  function onChange(e) {
    const el = e.target;
    if (!el) return;
    if (el.dataset && el.dataset.filterGroup) {
      const group = el.dataset.filterGroup;
      const value = el.dataset.filterValue;
      toggleFilterListItem(filter[group], value);
      lsWrite(LS_KEYS.UI_FILTER, filter);
      render();
      return;
    }
    if (el.id === 'filter-hearted') {
      filter.hearted_only = el.checked;
      lsWrite(LS_KEYS.UI_FILTER, filter);
      render();
      return;
    }
    if (el.id === 'filter-include-rejected') {
      filter.include_rejected = el.checked;
      lsWrite(LS_KEYS.UI_FILTER, filter);
      render();
      return;
    }
    if (el.id === 'sort-select') {
      sortKey = el.value;
      lsWrite(LS_KEYS.UI_SORT, sortKey);
      render();
      return;
    }
    if (el.dataset && el.dataset.selectId) {
      const id = el.dataset.selectId;
      const idx = selectedIds.indexOf(id);
      if (el.checked && idx === -1) selectedIds.push(id);
      if (!el.checked && idx !== -1) selectedIds.splice(idx, 1);
      // Enforce max 3 for compare — extra clicks quietly drop the oldest.
      while (selectedIds.length > 3) selectedIds.shift();
      saveSelected(selectedIds);
      render();
      return;
    }
  }

  function onClick(e) {
    const target = e.target;

    // <details> open/close for the scoring explainers — bubble to update
    // the persisted map. Native <details> handles the toggle itself; we
    // just record which are open.
    const scoredEl = target.closest('details.scored[data-scored-key]');
    if (scoredEl && target.tagName === 'SUMMARY') {
      // Native summary click fires a toggle after this handler; defer to next tick.
      setTimeout(() => {
        scoredOpen[scoredEl.dataset.scoredKey] = scoredEl.open;
        lsWrite(LS_SCORED_OPEN, scoredOpen);
      }, 0);
      return;
    }

    const heartBtn = target.closest('[data-heart-id]');
    if (heartBtn) {
      e.preventDefault();
      persistHeartToggle(heartBtn.dataset.heartId);
      return;
    }

    if (target.id === 'compare-btn') {
      e.preventDefault();
      const hintEl = document.getElementById('compare-hint');
      if (selectedIds.length < 2 || selectedIds.length > 3) {
        if (hintEl) {
          hintEl.textContent = 'Select 2 or 3 properties (checkbox on each row) to compare.';
          hintEl.hidden = false;
        }
        return;
      }
      window.location.hash = '#compare';
    }
  }

  render();
}

// --- Compare-count badge in the top nav ---

// Exported so app.js can call it on initial boot, before Dashboard mounts.
export function updateCompareBadge(count) {
  const el = document.querySelector('.top-nav .nav-links a[data-route="compare"]');
  if (!el) return;
  el.textContent = count > 0 ? `Compare (${count})` : 'Compare';
}
