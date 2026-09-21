import { getPat, setPat, clearPat, testPat, bootstrap, loadAssumptions } from './storage.js';
import { mountAssumptions } from './assumptions.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const show = (id) => { const el = document.getElementById(id); if (el) el.hidden = false; };
const hide = (id) => { const el = document.getElementById(id); if (el) el.hidden = true; };

// --- Shared session state ---
// Populated once the PAT is validated. Views read from here and dispatch
// storage.js calls with `state.pat`. `assumptions` and `assumptionsSha`
// are the last known good server state; a view updates them after
// successfully writing so subsequent PUTs carry the current sha.
export const state = {
  pat: null,
  assumptions: null,
  assumptionsSha: null,
};

// --- Router ---

const ROUTES = ['dashboard', 'map', 'add', 'compare', 'assumptions'];
const DEFAULT_ROUTE = 'dashboard';

function currentRoute() {
  const hash = window.location.hash.replace(/^#/, '');
  return ROUTES.includes(hash) ? hash : DEFAULT_ROUTE;
}

function updateNav(route) {
  $$('.top-nav .nav-links a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
    if (a.dataset.route === route) {
      a.setAttribute('aria-current', 'page');
    } else {
      a.removeAttribute('aria-current');
    }
  });
}

async function renderView() {
  const route = currentRoute();
  updateNav(route);
  const container = $('#app-view');
  container.innerHTML = '';
  container.dataset.view = route;

  if (route === 'assumptions') {
    await mountAssumptions(container);
    return;
  }
  mountStub(container, route);
}

function mountStub(container, route) {
  const nextLabels = {
    dashboard: 'Dashboard',
    map: 'Map',
    add: 'Add / Edit Property',
    compare: 'Compare',
  };
  container.innerHTML = `
    <h2>${nextLabels[route] || 'Coming soon'}</h2>
    <p>This screen hasn't been built yet.</p>
    <p>Build order from the spec: Assumptions (done) &rarr; Add / Edit Property &rarr; Dashboard &rarr; Compare &rarr; Map &rarr; PDF export.</p>
    <p style="margin-top: 32px;">
      <a class="btn subtle" href="#assumptions">Go to Assumptions</a>
      <button class="btn subtle" id="reset-pat-btn">Reset stored token (log out)</button>
    </p>
  `;
  attachResetButton();
}

function attachResetButton() {
  const btn = $('#reset-pat-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (confirm('Clear the stored token from this browser and return to setup?')) {
      clearPat();
      window.location.hash = '';
      window.location.reload();
    }
  });
}

// --- Wizard state ---

let wizardStep = 1;

function renderWizardStep() {
  $$('.wizard-step').forEach((el) => {
    el.hidden = parseInt(el.dataset.step, 10) !== wizardStep;
  });
  $$('.wizard-progress .dot').forEach((el) => {
    el.classList.toggle('active', parseInt(el.dataset.step, 10) <= wizardStep);
  });
}

function showWizardError(message) {
  const status = $('#pat-status');
  if (!status) return;
  status.className = 'pat-status error';
  status.textContent = message;
}

function enterWizard(atStep = 1) {
  hide('loading');
  hide('app-main');
  show('wizard');
  wizardStep = atStep;
  renderWizardStep();
}

async function enterApp() {
  hide('loading');
  hide('wizard');
  show('app-main');
  // Load assumptions once at app entry; views read from state.
  try {
    const { data, sha } = await loadAssumptions(state.pat);
    state.assumptions = data;
    state.assumptionsSha = sha;
  } catch (e) {
    console.error('Could not load assumptions', e);
  }
  await renderView();
}

async function runPatTest() {
  const input = $('#pat-input');
  const status = $('#pat-status');
  const testBtn = $('#test-pat-btn');
  if (!input || !status || !testBtn) return;

  const raw = input.value;
  status.className = 'pat-status info';
  status.textContent = 'Testing…';
  testBtn.disabled = true;

  try {
    const result = await testPat(raw);
    if (!result.ok) {
      status.className = 'pat-status error';
      status.textContent = result.message;
      testBtn.disabled = false;
      return;
    }
    status.className = 'pat-status info';
    status.textContent = 'Token accepted. Initializing your data repo…';
    const cleanPat = raw.trim();
    setPat(cleanPat);
    state.pat = cleanPat;
    const { created } = await bootstrap(cleanPat);
    status.className = 'pat-status success';
    status.textContent = created.length
      ? `Setup complete. Created: ${created.join(', ')}. Loading app…`
      : 'Setup complete. Loading app…';
    setTimeout(enterApp, 800);
  } catch (e) {
    status.className = 'pat-status error';
    status.textContent = `Setup failed: ${e.message || e}`;
    testBtn.disabled = false;
  }
}

function attachWizardHandlers() {
  $$('.wizard-step button[data-action="next"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (wizardStep < 3) { wizardStep += 1; renderWizardStep(); }
    });
  });
  $$('.wizard-step button[data-action="back"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (wizardStep > 1) { wizardStep -= 1; renderWizardStep(); }
    });
  });

  const testBtn = $('#test-pat-btn');
  if (testBtn) testBtn.addEventListener('click', runPatTest);

  const input = $('#pat-input');
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runPatTest(); }
  });
}

// --- Boot ---

async function boot() {
  attachWizardHandlers();
  window.addEventListener('hashchange', () => { renderView(); });

  const existingPat = getPat();
  if (!existingPat) {
    enterWizard(1);
    return;
  }

  const result = await testPat(existingPat);
  if (!result.ok) {
    console.warn('Stored PAT rejected:', result);
    clearPat();
    enterWizard(3);
    showWizardError(`Your stored token was rejected (${result.code}). Please paste a fresh one.`);
    return;
  }
  state.pat = existingPat;

  try {
    await bootstrap(existingPat);
    await enterApp();
  } catch (e) {
    console.error('Bootstrap failed:', e);
    enterWizard(3);
    showWizardError(`Failed to initialize data repo: ${e.message || e}`);
  }
}

document.addEventListener('DOMContentLoaded', boot);
