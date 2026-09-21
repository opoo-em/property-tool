import { state } from './app.js';
import { loadProperties } from './storage.js';
import { LS_KEYS } from './config.js';
import { computeAll } from './calc.js';
import {
  financialScore, commuteScore, fitScore, gutCheckAverage,
} from './score.js';

// Screen D — Compare Detail (build spec § 5.4).
// Renders 2–3 selected properties as columns, all rows visible in one
// long scroll. Two conditional callouts: cross-type (condo/TH + SFH mix)
// and DC-condo warrantability watch. Includes a client-side PDF export
// via html2pdf.js (lazy-loaded from CDN on first click).

const HTML2PDF_CDN = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js';

// --- Formatting (duplicated intentionally — a light shared util can wait
// until a third screen needs it) ---

function fmtMoney(n, dashOnZero = false) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (dashOnZero && n === 0) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtMoneyThousands(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '$' + Math.round(n / 1000).toLocaleString('en-US') + ',000';
}
function fmtPct(proportion) {
  if (proportion == null || !Number.isFinite(proportion)) return '—';
  return Math.round(proportion * 100) + '%';
}
function fmtPctRate(pct, digits = 2) {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return `${(+pct).toFixed(digits).replace(/\.00$/, '')}%`;
}
function fmtScore(n, digits = 1) {
  if (n == null) return '—';
  return n.toFixed(digits);
}
function dots(score) {
  if (score == null) return '—';
  const filled = Math.max(0, Math.min(5, Math.round(score)));
  return '●'.repeat(filled) + '○'.repeat(5 - filled);
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function typeStateLabel(p) {
  const t = p.type === 'condo' ? 'Condo · HOA'
          : p.type === 'townhouse' ? 'Townhouse · HOA'
          : p.type === 'sfh' ? 'Detached · No HOA'
          : '—';
  return p.state ? `${t} · ${p.state}` : t;
}
function typeBadgeClass(type) {
  if (type === 'condo') return 'condo';
  if (type === 'townhouse') return 'th';
  if (type === 'sfh') return 'sfh';
  return '';
}

// --- Contextual notes ---

function jurisdictionTaxNote(p) {
  const rate = p.financial?.property_tax_rate_pct;
  if (rate == null) return '';
  if (p.state === 'VA') return `(${fmtPctRate(rate)} Fairfax)`;
  if (p.state === 'MD') return `(${fmtPctRate(rate)} MoCo)`;
  if (p.state === 'DC') return `(~${fmtPctRate(rate)} DC effective)`;
  return `(${fmtPctRate(rate)})`;
}

function closingCostNote(p, assumptions) {
  const cc = assumptions.closing_costs_pct;
  if (p.state === 'MD') return `(${fmtPctRate(cc.montgomery_md)} MD)`;
  if (p.state === 'DC') {
    return p.financial?.first_time_dc_buyer
      ? `(${fmtPctRate(cc.dc_first_time_reduced)} DC, 1st-time reduced recordation)`
      : `(${fmtPctRate(cc.dc_standard)} DC)`;
  }
  return `(${fmtPctRate(cc.fairfax_va)} VA)`;
}

function appreciationNote(p) {
  const label = (p.type === 'sfh')
    ? ({ VA: 'NoVA SFH', MD: 'MoCo SFH', DC: 'DC rowhouse/SFH' }[p.state] || 'SFH')
    : ({ VA: 'NoVA condo/TH', MD: 'MoCo condo/TH', DC: 'DC condo' }[p.state] || 'condo');
  return `(${label})`;
}

function netIncomeNote(p, assumptions) {
  const inc = assumptions.income;
  if (p.state === 'MD') return `(MD net $${(inc.monthly_net_va - inc.md_penalty_monthly).toLocaleString()})`;
  if (p.state === 'DC') return `(DC net $${(inc.monthly_net_va - inc.dc_penalty_monthly).toLocaleString()})`;
  return `(VA net $${inc.monthly_net_va.toLocaleString()})`;
}

function typeCostNote(p, c, assumptions) {
  if (p.type === 'sfh') {
    const sqft = p.physical?.sqft;
    if (c.maintenanceYr1 > 0 && sqft) {
      const rate = c.maintenanceYr1 / sqft;
      return `No HOA; $/sqft maintenance model: ${sqft.toLocaleString()} sqft × $${rate.toFixed(2)}/sqft = $${Math.round(c.maintenanceYr1).toLocaleString()}/yr (~$${Math.round(c.maintenanceYr1 / 12).toLocaleString()}/mo).`;
    }
    return 'No HOA; $/sqft maintenance reserve derived from Assumptions.';
  }
  if (p.state === 'DC' && p.type === 'condo') {
    const g = assumptions.operating_cost_growth_pct.hoa_dc;
    return `DC condo fee growth default ${g}%/yr (BEPS-adjusted); property tax runs low vs. VA/MD via Homestead Deduction. Verify Fannie warrantability before offering.`;
  }
  const g = assumptions.operating_cost_growth_pct.hoa_nova_md;
  return `HOA growth default ${g}%/yr; special-assessment risk verified per-building on resale packet.`;
}

// --- Derived row per property ---

function derive(p, assumptions) {
  const c = computeAll(p, assumptions);
  const fin = financialScore(c.pctNet);
  const com = commuteScore(
    p.commute?.tysons_minutes_one_way,
    p.commute?.aspen_hill_minutes_one_way,
  );
  const fit = fitScore(
    p.physical?.outdoor_space,
    p.physical?.condition,
    p.physical?.sqft,
  );
  const gut = gutCheckAverage(p.gut_check);
  return { p, c, fin, com, fit, gut };
}

// --- Callouts (conditional) ---

function renderCrossTypeCallout(rows) {
  const hasCondoTh = rows.some((r) => r.p.type === 'condo' || r.p.type === 'townhouse');
  const hasSfh = rows.some((r) => r.p.type === 'sfh');
  if (!(hasCondoTh && hasSfh)) return '';
  return `
    <div class="cross-callout">
      <strong>Mixed-type comparison.</strong>
      This lineup includes both condo/townhouse and detached SFH — property types with different long-term risks and different cost structures. All-in monthly and net 10-yr cost are the two rows that make the packages directly comparable. Beyond monthly cost: detached homes require self-funded maintenance; condos and townhouses carry HOA growth and special-assessment risk.
    </div>
  `;
}

function renderWarrantabilityCallout(rows) {
  const dcCondos = rows.filter((r) => r.p.state === 'DC' && r.p.type === 'condo');
  if (dcCondos.length === 0) return '';
  const names = dcCondos.map((r) => r.p.nickname || '(untitled)').join(', ');
  return `
    <div class="cross-callout warrantability">
      <strong>⚠ DC condo warrantability watch (${escapeHtml(names)}).</strong>
      Fannie Mae's 15% reserve rule (effective Jan 4, 2027) is expected to make 30–40% of older/smaller DC condos non-warrantable. A non-warrantable building loses conventional financing eligibility, which means all units in it pay ~2pp higher rates and face a shrunken resale buyer pool. Before offering, verify: (1) reserve funding %, (2) whether the building's already flagged on Fannie's non-eligible list, (3) any planned BEPS retrofit or special assessment. Ask the agent for the reserve study and last 24 months of board minutes.
    </div>
  `;
}

// --- Row builders ---

function sectionRow(label, colCount) {
  return `<tr class="section-row"><td colspan="${colCount + 1}">${escapeHtml(label)}</td></tr>`;
}

function row(label, cells, opts = {}) {
  const bold = opts.bold ? 'strong-row' : '';
  const labelHtml = opts.boldLabel ? `<strong>${escapeHtml(label)}</strong>` : escapeHtml(label);
  const note = opts.labelNote ? ` <span class="note">${escapeHtml(opts.labelNote)}</span>` : '';
  return `
    <tr class="${bold}">
      <th class="metric-label">${labelHtml}${note}</th>
      ${cells.map((c) => `<td>${c}</td>`).join('')}
    </tr>
  `;
}

function cellWithNote(value, note) {
  if (note == null || note === '') return escapeHtml(String(value));
  return `${escapeHtml(String(value))} <span class="note">${escapeHtml(note)}</span>`;
}

// --- Row/section renderers ---

function renderFinancialSection(rows, assumptions) {
  const n = rows.length;
  const dpText = (r) => {
    const price = r.p.financial?.price;
    const dp = r.p.financial?.down_payment;
    if (!price || !dp) return fmtMoney(dp);
    const pct = Math.round((dp / price) * 100);
    return `${fmtMoney(dp)} (${pct}%)`;
  };
  return [
    sectionRow('Financial (all-in, honest)', n),
    row('Price', rows.map((r) => fmtMoney(r.p.financial?.price))),
    row('Down payment', rows.map(dpText)),
    row(`P&I @ ${fmtPctRate(assumptions.financing.mortgage_rate_pct)}`, rows.map((r) => fmtMoney(r.c.monthlyPI))),
    row('Property tax / mo', rows.map((r) => cellWithNote(fmtMoney(r.c.monthlyPropertyTax), jurisdictionTaxNote(r.p)))),
    row('Insurance / mo', rows.map((r) => fmtMoney(r.c.monthlyInsurance))),
    row('HOA / mo', rows.map((r) => fmtMoney(r.c.monthlyHoa, true))),
    row('All-in monthly', rows.map((r) => `<strong>${escapeHtml(fmtMoney(r.c.allInMonthly))}</strong>`), { boldLabel: true }),
    row('% of monthly net', rows.map((r) => cellWithNote(fmtPct(r.c.pctNet), netIncomeNote(r.p, assumptions)))),
    row('Buyer closing costs', rows.map((r) => cellWithNote(fmtMoney(r.c.closingCosts), closingCostNote(r.p, assumptions)))),
    row('Cash to close (est.)', rows.map((r) => fmtMoney((r.p.financial?.down_payment || 0) + r.c.closingCosts))),
    row('Type-cost note', rows.map((r) => `<span class="note">${escapeHtml(typeCostNote(r.p, r.c, assumptions))}</span>`), { labelNote: '' }),
  ].join('');
}

function renderTenYrSection(rows) {
  const n = rows.length;
  return [
    sectionRow('10-year outlook (from Assumptions)', n),
    row('Assumed appreciation', rows.map((r) => cellWithNote(`${fmtPctRate(r.c.appreciationRatePct)}/yr`, appreciationNote(r.p)))),
    row('Estimated home value in yr 10', rows.map((r) => fmtMoneyThousands(r.c.homeValueYr10))),
    row('Loan balance in yr 10', rows.map((r) => fmtMoneyThousands(r.c.loanBalanceYr10))),
    row('Ending equity', rows.map((r) => fmtMoneyThousands(r.c.endingEquity))),
    row('Total 10-yr out-of-pocket', rows.map((r) => {
      const includesMaint = r.p.type === 'sfh' && r.c.maintenanceYr1 > 0;
      const note = includesMaint ? '* incl. $/sqft maintenance' : '';
      return cellWithNote(fmtMoneyThousands(r.c.totalOutOfPocket), note);
    })),
    row('Net 10-yr cost', rows.map((r) => `<strong>${escapeHtml(fmtMoneyThousands(r.c.net10YrCost))}</strong>`), { boldLabel: true, labelNote: '(spend − equity)' }),
  ].join('');
}

function renderCommuteSection(rows) {
  const n = rows.length;
  const hoursFmt = (minsOneWay, tripsPerWeek) => {
    if (minsOneWay == null) return '—';
    const hrs = (minsOneWay * 2 * tripsPerWeek) / 60;
    const label = hrs < 1 ? `~${hrs.toFixed(1)} hr/wk` : `~${Math.round(hrs)} hr/wk`;
    const each = `${minsOneWay} min each way`;
    return `${escapeHtml(label)}<br><span class="note">${escapeHtml(each)}</span>`;
  };
  const weekly = (r) => {
    const t = r.p.commute?.tysons_minutes_one_way;
    const a = r.p.commute?.aspen_hill_minutes_one_way;
    if (t == null && a == null) return '—';
    const hrs = ((t || 0) * 2 * 4 + (a || 0) * 2 * 2) / 60;
    return `<strong>~${Math.round(hrs)} hr/wk</strong>`;
  };
  return [
    sectionRow('Commute (weekly hours)', n),
    row('To Tysons (4×/wk)', rows.map((r) => hoursFmt(r.p.commute?.tysons_minutes_one_way, 4))),
    row('To Aspen Hill (2×/wk)', rows.map((r) => hoursFmt(r.p.commute?.aspen_hill_minutes_one_way, 2))),
    row('Weekly total', rows.map(weekly), { boldLabel: true }),
    row('Walk Score', rows.map((r) => r.p.commute?.walk_score != null ? `${r.p.commute.walk_score} / 100` : '—')),
    row('Near Metro', rows.map((r) => {
      const nm = r.p.commute?.near_metro;
      if (nm === 'walkable') return 'Walkable';
      if (nm === 'short_drive') return 'Short drive';
      if (nm === 'no') return 'No';
      return '—';
    })),
  ].join('');
}

function renderFitSection(rows) {
  const n = rows.length;
  const outdoorMap = {
    small_balcony: 'Small balcony',
    large_balcony: 'Large balcony / terrace',
    patio: 'Patio',
    small_yard: 'Small yard',
    large_yard: 'Large yard',
    none: 'None',
  };
  const singleLevel = (r) => {
    const v = r.p.physical?.single_level;
    if (v === true) return 'Yes';
    if (v === false) return 'No (multi-level)';
    return 'N/A (elevator)';
  };
  return [
    sectionRow('Fit', n),
    row('Bedrooms / baths', rows.map((r) => {
      const b = r.p.physical?.beds, ba = r.p.physical?.baths;
      if (b == null && ba == null) return '—';
      return `${b ?? '—'} / ${ba ?? '—'}`;
    })),
    row('Square feet', rows.map((r) => r.p.physical?.sqft ? r.p.physical.sqft.toLocaleString() : '—')),
    row('Year built', rows.map((r) => r.p.physical?.year_built ?? '—')),
    row('Outdoor space', rows.map((r) => outdoorMap[r.p.physical?.outdoor_space] || '—')),
    row('Single-level', rows.map(singleLevel)),
    row('Condition', rows.map((r) => r.p.physical?.condition != null ? `${r.p.physical.condition}/5` : '—')),
  ].join('');
}

function renderHardFiltersSection(rows) {
  const n = rows.length;
  const yn = (v, yesLabel = '✓ Yes', noLabel = 'No') => {
    if (v === 'yes') return yesLabel;
    if (v === 'no') return `<span class="fail">✗ ${escapeHtml(noLabel)}</span>`;
    if (v === 'n/a') return 'N/A';
    return 'Unknown';
  };
  return [
    sectionRow('Hard filters (deal-breakers)', n),
    row('Covered + assigned parking', rows.map((r) => yn(r.p.hard_filters?.covered_assigned_parking, '✓ Yes'))),
    row('Elevator (or SFH)', rows.map((r) => {
      if (r.p.type === 'sfh') return 'N/A — detached';
      return yn(r.p.hard_filters?.elevator, '✓ Elevator');
    })),
    row('Not ground floor', rows.map((r) => {
      if (r.p.type === 'sfh') return 'N/A';
      const floor = r.p.physical?.floor;
      const v = r.p.hard_filters?.not_ground_floor;
      if (v === 'yes' && floor) return `✓ Floor ${floor}`;
      return yn(v, '✓ Yes');
    })),
    row('Pet-friendly', rows.map((r) => yn(r.p.hard_filters?.pet_friendly, '✓'))),
  ].join('');
}

function renderGutCheckSection(rows) {
  const n = rows.length;
  const g = (r, key) => {
    const v = r.p.gut_check?.[key];
    return typeof v === 'number' ? String(v) : '—';
  };
  const avg = (r) => (r.gut == null ? '<span class="note">Not yet rated</span>' : `<strong>${fmtScore(r.gut)}</strong>`);
  return [
    sectionRow("Gut check (Mom's ratings, 1–5)", n),
    row('Grandson visits', rows.map((r) => g(r, 'grandson_visits'))),
    row('Invite friends over', rows.map((r) => g(r, 'friends_over'))),
    row('Make it your own / DIY', rows.map((r) => g(r, 'diy_projects'))),
    row('Pepper safe & happy', rows.map((r) => g(r, 'pepper_safe'))),
    row('Outdoor life', rows.map((r) => g(r, 'outdoor_life'))),
    row('Gut check average', rows.map(avg), { boldLabel: true }),
  ].join('');
}

function renderScorecardSection(rows) {
  const n = rows.length;
  const cell = (score) => score == null
    ? '<span class="dots-empty">—</span>'
    : `<span class="dots">${dots(score)}</span> (${fmtScore(score)})`;
  const gutCell = (r) => r.gut == null ? '—' : `<span class="stars">${fmtScore(r.gut)}</span>`;
  return [
    sectionRow('Scorecard summary', n),
    row('Financial', rows.map((r) => cell(r.fin))),
    row('Commute', rows.map((r) => cell(r.com))),
    row('Fit', rows.map((r) => cell(r.fit))),
    row('Gut check', rows.map(gutCell)),
  ].join('');
}

function renderNotesSection(rows) {
  const n = rows.length;
  return [
    sectionRow('Notes', n),
    row("Mom's notes", rows.map((r) => {
      const notes = r.p.gut_check?.notes;
      return notes ? `<span class="note">${escapeHtml(notes)}</span>` : '<span class="note">—</span>';
    })),
  ].join('');
}

// --- Header row ---

function renderHeaderRow(rows) {
  return `
    <tr>
      <th class="metric-label"></th>
      ${rows.map((r) => {
        const warrant = (r.p.state === 'DC' && r.p.type === 'condo')
          ? '<br><span class="warrantability-note">⚠ warrantability watch</span>' : '';
        return `
          <td class="prop-header">
            ${escapeHtml(r.p.nickname || '(untitled)')}
            <br><span class="type-badge ${typeBadgeClass(r.p.type)}">${escapeHtml(typeStateLabel(r.p))}</span>
            ${warrant}
          </td>
        `;
      }).join('')}
    </tr>
  `;
}

// --- Full grid ---

function renderGrid(rows, assumptions) {
  return `
    <table class="compare-grid">
      <thead>${renderHeaderRow(rows)}</thead>
      <tbody>
        ${renderFinancialSection(rows, assumptions)}
        ${renderTenYrSection(rows)}
        ${renderCommuteSection(rows)}
        ${renderFitSection(rows)}
        ${renderHardFiltersSection(rows)}
        ${renderGutCheckSection(rows)}
        ${renderScorecardSection(rows)}
        ${renderNotesSection(rows)}
      </tbody>
    </table>
    <p class="note" style="margin-top:16px;">* 10-yr TCO uses current Assumptions. Change them on the Assumptions screen and every number here updates.</p>
  `;
}

// --- html2pdf lazy loader ---

let html2pdfPromise = null;
function loadHtml2Pdf() {
  if (html2pdfPromise) return html2pdfPromise;
  html2pdfPromise = new Promise((resolve, reject) => {
    if (window.html2pdf) return resolve(window.html2pdf);
    const s = document.createElement('script');
    s.src = HTML2PDF_CDN;
    s.async = true;
    s.onload = () => resolve(window.html2pdf);
    s.onerror = () => reject(new Error('Failed to load html2pdf.js from the CDN.'));
    document.head.appendChild(s);
  });
  return html2pdfPromise;
}

async function exportPdf(container, filename) {
  const target = container.querySelector('#compare-print-area');
  if (!target) return;
  const html2pdf = await loadHtml2Pdf();
  await html2pdf().set({
    margin: [0.4, 0.4, 0.4, 0.4],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' },
    pagebreak: { mode: ['css', 'legacy'] },
  }).from(target).save();
}

// --- Mount ---

export async function mountCompare(container) {
  if (container._abortController) container._abortController.abort();
  const controller = new AbortController();
  container._abortController = controller;
  const { signal } = controller;

  container.innerHTML = '<p class="loading-inline">Loading comparison…</p>';

  // Selection lives in localStorage — Dashboard writes it.
  let selectedIds = [];
  try {
    const raw = localStorage.getItem(LS_KEYS.UI_SELECTED);
    selectedIds = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(selectedIds)) selectedIds = [];
  } catch { selectedIds = []; }

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

  const byId = new Map(allProperties.map((p) => [p.id, p]));
  const selected = selectedIds.map((id) => byId.get(id)).filter(Boolean);

  if (selected.length < 2 || selected.length > 3) {
    container.innerHTML = `
      <div class="screen-header">
        <h2>Compare</h2>
        <div class="header-actions">
          <a class="btn subtle" href="#dashboard">← Back to Dashboard</a>
        </div>
      </div>
      <div class="banner">
        <strong>Select 2 or 3 properties first.</strong> Head back to the Dashboard, check the boxes next to the properties you want to compare, then click Compare.
      </div>
    `;
    return;
  }

  const rows = selected.map((p) => derive(p, state.assumptions));
  const summary = selected.map((p) => `${p.state || '—'} ${p.type || ''}`.trim()).join(' · ');

  container.addEventListener('click', onClick, { signal });

  function render() {
    container.innerHTML = `
      <div class="screen-header no-print">
        <h2>Compare — ${selected.length} properties · ${escapeHtml(summary)}</h2>
        <div class="header-actions">
          <a class="btn subtle" href="#dashboard">← Back to Dashboard</a>
          <button type="button" class="btn" id="compare-pdf-btn">Export as PDF</button>
        </div>
      </div>
      <div id="compare-print-area">
        <div class="compare-print-header">
          <h1>Property Comparison</h1>
          <p class="note">Generated ${new Date().toLocaleDateString()} · ${escapeHtml(summary)}</p>
        </div>
        ${renderCrossTypeCallout(rows)}
        ${renderWarrantabilityCallout(rows)}
        ${renderGrid(rows, state.assumptions)}
      </div>
    `;
  }

  async function onClick(e) {
    const btn = e.target.closest('#compare-pdf-btn');
    if (!btn) return;
    e.preventDefault();
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generating PDF…';
    try {
      const nickname = rows.map((r) => (r.p.nickname || 'property').replace(/[^\w-]+/g, '_')).slice(0, 3).join('-vs-');
      const stamp = new Date().toISOString().slice(0, 10);
      await exportPdf(container, `compare-${nickname}-${stamp}.pdf`);
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  render();
}
