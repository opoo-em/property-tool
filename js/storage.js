import { CONFIG, LS_KEYS } from './config.js';

const GITHUB_API = 'https://api.github.com';

const headers = (pat) => ({
  'Authorization': `Bearer ${pat}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

// UTF-8 safe base64 helpers. GitHub content responses are base64 with
// embedded newlines; strip whitespace before decoding.
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function fromBase64(b64) {
  const cleaned = b64.replace(/\s/g, '');
  const bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// --- PAT localStorage ---

export function getPat() {
  try { return localStorage.getItem(LS_KEYS.PAT); }
  catch { return null; }
}
export function setPat(pat) {
  try { localStorage.setItem(LS_KEYS.PAT, pat); }
  catch (e) { console.error('Could not save PAT to localStorage', e); }
}
export function clearPat() {
  try { localStorage.removeItem(LS_KEYS.PAT); }
  catch { /* private mode / storage disabled */ }
}

// --- Low-level GitHub API ---

async function ghFetch(pat, path, init = {}) {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...headers(pat), ...(init.headers || {}) },
  });
}

// Verify a token by reading the private repo metadata.
// { ok: true } on success; { ok: false, code, message } otherwise.
export async function testPat(pat) {
  const trimmed = (pat || '').trim();
  if (!trimmed) {
    return { ok: false, code: 'empty', message: 'Please paste a token.' };
  }
  try {
    const res = await ghFetch(trimmed, `/repos/${CONFIG.OWNER}/${CONFIG.PRIVATE_REPO}`);
    if (res.status === 200) return { ok: true };
    if (res.status === 401) {
      return { ok: false, code: 401, message: 'Token was rejected (401). Check that you pasted the whole token and that it has not expired.' };
    }
    if (res.status === 403) {
      return { ok: false, code: 403, message: `Token is valid but does not have permission (403). Confirm it was scoped to ${CONFIG.OWNER}/${CONFIG.PRIVATE_REPO} with Contents: Read and Write.` };
    }
    if (res.status === 404) {
      return { ok: false, code: 404, message: `Repo not found (404). Either the token cannot see ${CONFIG.OWNER}/${CONFIG.PRIVATE_REPO}, or the repo does not exist.` };
    }
    return { ok: false, code: res.status, message: `Unexpected response from GitHub (${res.status}).` };
  } catch (e) {
    return { ok: false, code: 'network', message: `Network error: ${e.message || e}` };
  }
}

// { data, sha } on 200; { data: null, sha: null, missing: true } on 404; throws otherwise.
async function readJsonFile(pat, filename) {
  const res = await ghFetch(pat, `/repos/${CONFIG.OWNER}/${CONFIG.PRIVATE_REPO}/contents/${filename}`);
  if (res.status === 404) return { data: null, sha: null, missing: true };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${filename} failed: ${res.status} — ${body}`);
  }
  const body = await res.json();
  const text = fromBase64(body.content);
  const data = JSON.parse(text);
  return { data, sha: body.sha, missing: false };
}

// If sha is null, creates the file; if provided, updates it. Returns the new sha.
async function writeJsonFile(pat, filename, obj, sha, message) {
  const body = {
    message: message || `Update ${filename}`,
    content: toBase64(JSON.stringify(obj, null, 2) + '\n'),
    branch: CONFIG.DEFAULT_BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await ghFetch(pat, `/repos/${CONFIG.OWNER}/${CONFIG.PRIVATE_REPO}/contents/${filename}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${filename} failed: ${res.status} — ${text}`);
  }
  const result = await res.json();
  return result.content.sha;
}

// --- Public data operations ---

export async function loadProperties(pat) {
  const { data, sha, missing } = await readJsonFile(pat, 'properties.json');
  return missing ? { data: [], sha: null } : { data, sha };
}
export async function saveProperties(pat, arr, sha) {
  return writeJsonFile(pat, 'properties.json', arr, sha, 'Update properties');
}
export async function loadAssumptions(pat) {
  const { data, sha, missing } = await readJsonFile(pat, 'assumptions.json');
  return missing ? { data: null, sha: null } : { data, sha };
}
export async function saveAssumptions(pat, obj, sha) {
  const stamped = { ...obj, updated_at: new Date().toISOString() };
  return writeJsonFile(pat, 'assumptions.json', stamped, sha, 'Update assumptions');
}

// --- Seed data (build spec Section 6) ---

export function seedAssumptions() {
  return {
    locations: {
      workplace: { address: '8484 Westpark Dr, Tysons, VA 22102', maps_url: '', lat: 38.9128, lng: -77.2265 },
      family: { address: 'Aspen Hill, MD', maps_url: '', lat: 39.0784, lng: -77.0817 },
    },
    income: { monthly_net_va: 8038, md_penalty_monthly: 440, dc_penalty_monthly: 220 },
    financing: { mortgage_rate_pct: 6.9, condo_rate_overlay_pct: 0.25, down_payment_default: 140000 },
    appreciation_pct: {
      nova_sfh: 4.0,
      nova_condo_th: 2.5,
      moco_sfh: 3.5,
      dc_rowhouse_sfh: 4.25,
      dc_condo: 2.75,
    },
    property_tax_growth_pct: { fairfax_va: 4.0, montgomery_md: 3.5, dc: 3.0 },
    operating_cost_growth_pct: { hoa_nova_md: 4.0, hoa_dc: 5.0, insurance: 6.0 },
    maintenance_sqft_yr: { post_2010: 1.50, '1990_2010': 2.25, pre_1990: 3.00 },
    closing_costs_pct: { fairfax_va: 2.5, montgomery_md: 3.5, dc_standard: 3.5, dc_first_time_reduced: 2.75 },
    updated_at: new Date().toISOString(),
  };
}

// The placeholder-detection convention: any assumption blob whose
// income.monthly_net_va equals this exact value is still on the seed
// placeholder. The Assumptions screen should surface a banner while
// this is true.
export const PLACEHOLDER_NET_INCOME = 8038;

// In-place patch for older assumptions.json files that predate a schema
// addition. Idempotent; safe to call every load. Any fresh install goes
// through seedAssumptions() and skips these fills.
export function migrateAssumptions(a) {
  if (!a || typeof a !== 'object') return a;
  if (!a.financing) a.financing = {};
  if (a.financing.down_payment_default == null) {
    a.financing.down_payment_default = 140000;
  }
  return a;
}

// --- Bootstrap ---

// Ensure the private repo has both JSON files. Idempotent.
export async function bootstrap(pat) {
  const created = [];

  const assumptionsRead = await readJsonFile(pat, 'assumptions.json');
  if (assumptionsRead.missing) {
    await writeJsonFile(pat, 'assumptions.json', seedAssumptions(), null, 'Seed assumptions.json');
    created.push('assumptions.json');
  }

  const propertiesRead = await readJsonFile(pat, 'properties.json');
  if (propertiesRead.missing) {
    await writeJsonFile(pat, 'properties.json', [], null, 'Seed empty properties.json');
    created.push('properties.json');
  }

  return { created };
}
