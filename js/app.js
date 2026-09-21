import { getPat, setPat, clearPat, testPat, bootstrap } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const show = (id) => { const el = document.getElementById(id); if (el) el.hidden = false; };
const hide = (id) => { const el = document.getElementById(id); if (el) el.hidden = true; };

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

function enterApp() {
  hide('loading');
  hide('wizard');
  show('app-main');
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

function attachHandlers() {
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

  const resetBtn = $('#reset-pat-btn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (confirm('Clear the stored token from this browser and return to setup?')) {
      clearPat();
      window.location.reload();
    }
  });
}

async function boot() {
  attachHandlers();

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

  try {
    await bootstrap(existingPat);
    enterApp();
  } catch (e) {
    console.error('Bootstrap failed:', e);
    enterWizard(3);
    showWizardError(`Failed to initialize data repo: ${e.message || e}`);
  }
}

document.addEventListener('DOMContentLoaded', boot);
