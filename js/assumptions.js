import { state } from './app.js';
import { saveAssumptions, seedAssumptions, PLACEHOLDER_NET_INCOME, loadAssumptions, migrateAssumptions } from './storage.js';

// --- Section spec ---
//
// Fields declare their dotted `path` into the assumptions object,
// their `unit` (used for formatting/parsing), an optional `default`
// (label shown in the "Default" column — the wireframe formats these
// once, so we keep them as strings), an optional `range` and `source`
// note, and their display `label`.
//
// Two special section kinds: `locations` and `income` use custom
// 3-column layouts; every other section uses the standard 5-column
// (Label / Default / Your value / Range / Source) table.

const COLLAPSED_LS_KEY = 'pt.ui.assumptions_collapsed';

const SECTIONS = [
  {
    id: 'locations',
    title: 'Locations',
    kind: 'locations',
  },
  {
    id: 'income',
    title: 'Income & taxes',
    kind: 'income',
    fields: [
      {
        path: 'income.monthly_net_va',
        label: 'Monthly net income (VA baseline)',
        unit: '$',
        source: 'Derived from paystub. Federal + FICA + VA state + 401k + benefits.',
      },
      {
        path: 'income.md_penalty_monthly',
        label: 'MD net-income penalty (per month)',
        unit: '$',
        source: 'MD state 5.0% + Montgomery County 3.2% vs. VA state 5.75%. Applied to properties in MD.',
      },
      {
        path: 'income.dc_penalty_monthly',
        label: 'DC net-income penalty (per month)',
        unit: '$',
        source: 'DC top marginal 10.75% vs. VA 5.75%, mitigated by DC using federal std. deduction. Roughly half of MD. Applied to DC properties.',
      },
    ],
  },
  {
    id: 'financing',
    title: 'Financing rates',
    kind: 'standard',
    fields: [
      {
        path: 'financing.mortgage_rate_pct',
        label: 'Mortgage rate',
        unit: '%',
        default: '6.9%',
        range: '6.3% – 7.5%',
        source: 'Sept 2026 spot; Fed raised Sept 16 — no sub-6% forecast through 2027.',
      },
      {
        path: 'financing.condo_rate_overlay_pct',
        label: 'Condo rate overlay',
        unit: '%',
        default: '+0.25pp',
        range: '+0.125 – +0.375pp',
        source: 'Applied to condo/TH loans only.',
      },
      {
        path: 'financing.down_payment_default',
        label: 'Default down payment',
        unit: '$',
        default: '$140,000',
        range: '—',
        source: 'Applied to every property unless a specific property overrides it. Assumed cash on hand for a purchase.',
      },
    ],
  },
  {
    id: 'appreciation',
    title: 'Home appreciation (10-yr annualized, by market + type)',
    kind: 'standard',
    fields: [
      {
        path: 'appreciation_pct.nova_sfh',
        label: 'NoVA single-family home',
        unit: '%', default: '4.0%', range: '3.0% – 5.0%',
        source: 'Fairfax 10-yr 4.91% (NeighborhoodScout); metro 3.6%; SFH outperforming condos.',
      },
      {
        path: 'appreciation_pct.nova_condo_th',
        label: 'NoVA condo / TH',
        unit: '%', default: '2.5%', range: '1.0% – 4.0%',
        source: 'DC-area condo ~2–3%/yr over the decade; 2026 forecast −2.7%. Structural HOA/insurance drag.',
      },
      {
        path: 'appreciation_pct.moco_sfh',
        label: 'Montgomery SFH',
        unit: '%', default: '3.5%', range: '2.5% – 4.5%',
        source: 'Metro 3.6%; MoCo 2025 +8.1% (Redfin), 2026 spot slightly negative — normalizing.',
      },
      {
        path: 'appreciation_pct.dc_rowhouse_sfh',
        label: 'DC rowhouse / SFH',
        unit: '%', default: '4.25%', range: '3.0% – 5.5%',
        source: 'UrbanTurf 10-yr: DC rowhouse median +56–57% (~4.5–4.7%/yr); DC SFH similar. 2026 near-flat.',
      },
      {
        path: 'appreciation_pct.dc_condo',
        label: 'DC condo',
        unit: '%', default: '2.75%', range: '1.5% – 4.0%',
        source: 'DC condo median +35% over decade (~3%/yr); only Mid-Atlantic segment forecast to decline in 2026. Warrantability risk adds tail exposure.',
      },
    ],
  },
  {
    id: 'tax-growth',
    title: 'Property tax growth (annual, by jurisdiction)',
    kind: 'standard',
    fields: [
      {
        path: 'property_tax_growth_pct.fairfax_va',
        label: 'Fairfax County VA (no cap)',
        unit: '%', default: '4.0%', range: '3.0% – 5.5%',
        source: 'Assessed at 100% market value, annual reassessment, no homestead cap; 6-yr avg equalization ~5.7% (2021–26). Effective rate ~1.12%.',
      },
      {
        path: 'property_tax_growth_pct.montgomery_md',
        label: 'Montgomery County MD (Homestead cap + phase-in)',
        unit: '%', default: '3.5%', range: '2.5% – 5.0%',
        source: 'Triennial reassessment, 3-yr phase-in, 10% Homestead cap. Bill grows slower than market value. Effective rate ~0.87–1.15%.',
      },
      {
        path: 'property_tax_growth_pct.dc',
        label: 'DC (Homestead deduction + 10% cap)',
        unit: '%', default: '3.0%', range: '0% – 5.0%',
        source: 'Class 1 base ~0.85%/$100; effective ~0.55–0.61% after Homestead Deduction ($91,950 for 2026). 10% cap on taxable-assessment growth.',
      },
    ],
  },
  {
    id: 'operating-growth',
    title: 'Operating cost growth',
    kind: 'standard',
    fields: [
      {
        path: 'operating_cost_growth_pct.hoa_nova_md',
        label: 'HOA / condo fee growth / yr (NoVA + MD)',
        unit: '%', default: '4.0%', range: '3.0% – 5.0%',
        source: 'Realtor.com condo fee CAGR ~4.4% (2019–25); rule-of-thumb 3–5%.',
      },
      {
        path: 'operating_cost_growth_pct.hoa_dc',
        label: 'HOA / condo fee growth / yr (DC)',
        unit: '%', default: '5.0%', range: '4.0% – 8.0%',
        source: 'National baseline plus DC-specific pressure: BEPS Cycle 1 retrofits, older stock, master-policy premium spikes. Episodic special-assessment risk not modeled here.',
      },
      {
        path: 'operating_cost_growth_pct.insurance',
        label: 'Insurance premium growth / yr',
        unit: '%', default: '6.0%', range: '4.0% – 8.0%',
        source: 'National spike moderating; Triple-I projects ~6–7% for 2025–26. Lean lower half for DC-metro (non-coastal).',
      },
    ],
  },
  {
    id: 'maintenance',
    title: 'SFH maintenance reserve ($/sqft/yr, by home age)',
    kind: 'standard',
    intro: 'Replaces the older "% of home value" model. Rationale: physical maintenance scales with square footage and age, not with local market price. DMV labor premium not added — age tiers already sit at the top half of national data, and Mom\'s trade-level DIY offsets remaining labor cost. Per-property override on Add/Edit.',
    fields: [
      {
        path: 'maintenance_sqft_yr.post_2010',
        label: 'Post-2010 build',
        unit: '$', default: '$1.50/sqft/yr', range: '$1.00 – $2.00',
        source: 'Big-ticket items still years out; Census AHS 2019 ~0.2% of value for 2010s-built.',
      },
      {
        path: 'maintenance_sqft_yr.1990_2010',
        label: '1990 – 2010',
        unit: '$', default: '$2.25/sqft/yr', range: '$1.50 – $2.75',
        source: 'Some big-ticket replacements starting to land; Angi 2025 avg spend ~$1.93/sqft.',
      },
      {
        path: 'maintenance_sqft_yr.pre_1990',
        label: 'Pre-1990',
        unit: '$', default: '$3.00/sqft/yr', range: '$2.50 – $4.00',
        source: 'Full big-ticket cycle in play; Census pre-1960 ~0.8% of value → ~$3.20/sqft at DMV price/sqft ratios.',
      },
    ],
  },
  {
    id: 'closing',
    title: 'Closing costs (buyer side, % of price)',
    kind: 'standard',
    fields: [
      {
        path: 'closing_costs_pct.fairfax_va',
        label: 'Fairfax County VA',
        unit: '%', default: '2.5%', range: '2.0% – 4.0%',
        source: 'Buyer transfer/recordation ~0.33% total; grantor\'s tax paid by seller.',
      },
      {
        path: 'closing_costs_pct.montgomery_md',
        label: 'Montgomery County MD',
        unit: '%', default: '3.5%', range: '3.0% – 5.0%',
        source: 'Transfer + recordation ~2–3%, customarily split 50/50. On $650K home, buyer transfer/recordation share ~$6–7K.',
      },
      {
        path: 'closing_costs_pct.dc_standard',
        label: 'DC (standard recordation rate)',
        unit: '%', default: '3.5%', range: '2.4% – 5.0%',
        source: 'Recordation tax 1.1% (<$400K) / 1.45% (≥$400K) — buyer\'s obligation by statute. Purchase-money mortgage exempt from recordation.',
      },
      {
        path: 'closing_costs_pct.dc_first_time_reduced',
        label: 'DC (first-time reduced recordation)',
        unit: '%', default: '2.75%', range: '2.0% – 3.5%',
        source: 'Qualified first-time buyer at ≤$206K income on any property ≤$777K. Recordation reduced from 1.45% → 0.725%. Applied via Form ROD-11 at closing.',
      },
    ],
  },
];

// --- Path helpers ---

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

// --- Formatting ---

function formatValue(v, unit) {
  if (v == null || v === '') return '';
  if (unit === '$') return `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (unit === '%') return `${v}%`;
  return String(v);
}
function parseValue(raw, unit) {
  if (raw == null) return null;
  const stripped = String(raw).replace(/[$%,\s]/g, '').replace(/[+]/g, '');
  if (stripped === '' || stripped === '-') return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

// --- Collapsed state ---

function loadCollapsedMap() {
  try {
    const raw = localStorage.getItem(COLLAPSED_LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveCollapsedMap(map) {
  try { localStorage.setItem(COLLAPSED_LS_KEY, JSON.stringify(map)); }
  catch { /* ignore */ }
}

// --- Renderers ---

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderStandardTable(section, working) {
  const rows = section.fields.map((f) => {
    const value = getPath(working, f.path);
    return `
      <tr>
        <td>${escapeHtml(f.label)}</td>
        <td class="col-default">${f.default ? escapeHtml(f.default) : ''}</td>
        <td class="col-input">
          <input type="text" data-path="${escapeHtml(f.path)}" data-unit="${escapeHtml(f.unit)}"
                 value="${escapeHtml(formatValue(value, f.unit))}">
        </td>
        <td class="note">${f.range ? escapeHtml(f.range) : ''}</td>
        <td class="note">${f.source ? escapeHtml(f.source) : ''}</td>
      </tr>
    `;
  }).join('');
  return `
    ${section.intro ? `<p class="section-intro">${escapeHtml(section.intro)}</p>` : ''}
    <table class="assumptions-table">
      <thead>
        <tr>
          <th>Assumption</th>
          <th>Default</th>
          <th>Your value</th>
          <th>Reasonable range</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderLocationsTable(working) {
  const rowFor = (key, label) => {
    const addr = getPath(working, `locations.${key}.address`) || '';
    const url = getPath(working, `locations.${key}.maps_url`) || '';
    return `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td class="col-input col-input-wide">
          <input type="text" data-path="locations.${key}.address" data-unit="text" value="${escapeHtml(addr)}">
        </td>
        <td class="col-input col-input-wide">
          <input type="text" data-path="locations.${key}.maps_url" data-unit="text" value="${escapeHtml(url)}" placeholder="https://maps.google.com/…">
        </td>
      </tr>
    `;
  };
  return `
    <table class="assumptions-table">
      <thead>
        <tr><th>Anchor</th><th>Address</th><th>Google Maps URL</th></tr>
      </thead>
      <tbody>
        ${rowFor('workplace', 'Workplace')}
        ${rowFor('family', 'Family (daughter)')}
      </tbody>
    </table>
  `;
}

function renderIncomeTable(section, working) {
  const rows = section.fields.map((f) => {
    const value = getPath(working, f.path);
    return `
      <tr>
        <td>${escapeHtml(f.label)}</td>
        <td class="col-input">
          <input type="text" data-path="${escapeHtml(f.path)}" data-unit="${escapeHtml(f.unit)}"
                 value="${escapeHtml(formatValue(value, f.unit))}">
        </td>
        <td class="note">${escapeHtml(f.source)}</td>
      </tr>
    `;
  }).join('');
  return `
    <table class="assumptions-table">
      <thead>
        <tr><th>Assumption</th><th>Value</th><th>Where it comes from</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderSection(section, working, collapsedMap) {
  const collapsed = !!collapsedMap[section.id];
  let body = '';
  if (section.kind === 'locations') body = renderLocationsTable(working);
  else if (section.kind === 'income') body = renderIncomeTable(section, working);
  else body = renderStandardTable(section, working);
  return `
    <section class="assumptions-section" data-section-id="${section.id}" ${collapsed ? 'data-collapsed="true"' : ''}>
      <button class="assumptions-section-header" data-toggle-section="${section.id}" aria-expanded="${!collapsed}">
        <span class="chev">${collapsed ? '▸' : '▾'}</span>
        <span>${escapeHtml(section.title)}</span>
      </button>
      <div class="assumptions-section-body" ${collapsed ? 'hidden' : ''}>${body}</div>
    </section>
  `;
}

function renderPlaceholderBanner(working) {
  const val = getPath(working, 'income.monthly_net_va');
  if (val !== PLACEHOLDER_NET_INCOME) return '';
  return `
    <div class="banner banner-warning">
      <strong>⚠ Placeholder net income.</strong> The Monthly net income below ($${PLACEHOLDER_NET_INCOME.toLocaleString()}) is a temporary value. Replace it with the derived monthly net from Mom's paystub when it lands, then Save.
    </div>
  `;
}

// --- Mount ---

export async function mountAssumptions(container) {
  // Abandon any listeners attached during a prior mount of this container
  // so they don't stack when navigating Assumptions → other view → Assumptions.
  if (container._abortController) container._abortController.abort();
  const controller = new AbortController();
  container._abortController = controller;
  const { signal } = controller;

  container.innerHTML = '<p class="loading-inline">Loading assumptions…</p>';

  // Always fetch fresh — the assumptions could have been edited elsewhere.
  let working;
  try {
    const { data, sha } = await loadAssumptions(state.pat);
    if (data) {
      state.assumptions = migrateAssumptions(data);
      state.assumptionsSha = sha;
    } else {
      state.assumptions = seedAssumptions();
      state.assumptionsSha = null;
    }
    working = structuredClone(state.assumptions);
  } catch (e) {
    container.innerHTML = `<div class="banner banner-error">Failed to load assumptions: ${escapeHtml(e.message || String(e))}</div>`;
    return;
  }

  const collapsedMap = loadCollapsedMap();
  let saveState = 'idle'; // 'idle' | 'saving' | 'saved' | 'error'
  let saveMessage = '';

  // Container-level delegated listeners — attached once per mount.
  container.addEventListener('change', onFieldChange, { signal });
  container.addEventListener('focusout', onFieldBlur, { signal });

  function render() {
    container.innerHTML = `
      ${renderPlaceholderBanner(working)}
      <div class="screen-header">
        <h2>Assumptions</h2>
        <div class="header-actions">
          <span id="save-status" class="save-status ${saveState}">${escapeHtml(saveMessage)}</span>
          <button class="btn subtle" id="reset-defaults-btn">Reset to defaults</button>
          <button class="btn primary" id="save-assumptions-btn">Save</button>
        </div>
      </div>
      <p class="intro-note">Change any value and every calculation on every screen updates. The tool auto-picks the correct rate for each property based on its state and type.</p>
      ${SECTIONS.map((s) => renderSection(s, working, collapsedMap)).join('')}
      <p class="footer-note">Defaults sourced from <code>tco-modeling-research-brief.md</code> and <code>dc-modeling-research-brief.md</code>. Special-assessment risk on condos and DC condo warrantability tail risk are per-building overlays, not market-wide defaults.</p>
    `;
    attachPerRenderHandlers();
  }

  function setSaveState(next, message = '') {
    saveState = next;
    saveMessage = message;
    const el = document.getElementById('save-status');
    if (el) {
      el.className = `save-status ${next}`;
      el.textContent = message;
    }
  }

  // Handlers on per-render DOM (section toggles + save + reset) — the DOM
  // nodes themselves are replaced on every render so their listeners die
  // with them; no cleanup needed.
  function attachPerRenderHandlers() {
    container.querySelectorAll('[data-toggle-section]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggleSection;
        collapsedMap[id] = !collapsedMap[id];
        saveCollapsedMap(collapsedMap);
        render();
      });
    });
    const saveBtn = document.getElementById('save-assumptions-btn');
    if (saveBtn) saveBtn.addEventListener('click', doSave);
    const resetBtn = document.getElementById('reset-defaults-btn');
    if (resetBtn) resetBtn.addEventListener('click', doReset);
  }

  function onFieldChange(e) {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.path) return;
    const path = input.dataset.path;
    const unit = input.dataset.unit;
    if (unit === 'text') {
      setPath(working, path, input.value);
    } else {
      const parsed = parseValue(input.value, unit);
      setPath(working, path, parsed);
    }
    if (saveState !== 'idle') setSaveState('idle', '');
  }

  function onFieldBlur(e) {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.path) return;
    const unit = input.dataset.unit;
    if (unit === 'text') return;
    const value = getPath(working, input.dataset.path);
    input.value = formatValue(value, unit);
  }

  async function doSave() {
    const btn = document.getElementById('save-assumptions-btn');
    if (btn) btn.disabled = true;
    setSaveState('saving', 'Saving…');
    try {
      const newSha = await saveAssumptions(state.pat, working, state.assumptionsSha);
      state.assumptionsSha = newSha;
      state.assumptions = structuredClone(working);
      // Re-render to reflect any placeholder-banner change or reformatted values.
      render();
      setSaveState('saved', 'Saved.');
      setTimeout(() => { if (saveState === 'saved') setSaveState('idle', ''); }, 2500);
    } catch (e) {
      setSaveState('error', e.message || String(e));
      if (btn) btn.disabled = false;
    }
  }

  function doReset() {
    if (!confirm('Replace every value on this page with the seed defaults? You will still need to click Save to persist.')) return;
    working = seedAssumptions();
    render();
    setSaveState('idle', 'Reset to defaults — click Save to persist.');
  }

  render();
}
