// One-time setup for a local n8n: Gemini credential, the two data tables and the workflow.
//
// Usage (n8n must be running):
//   set N8N_URL, N8N_EMAIL, N8N_PASSWORD (your n8n login) and GEMINI_API_KEY, then
//   node scripts/setup_n8n.mjs
//
// Safe to run again: existing tables and credentials are reused, the workflow is replaced.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = (process.env.N8N_URL || 'http://localhost:5678').replace(/\/$/, '');
const EMAIL = process.env.N8N_EMAIL;
const PASSWORD = process.env.N8N_PASSWORD;
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_FILE = path.join(HERE, '..', 'workflow', 'ai_lead_inbox.json');

const COLUMNS = [
  'received_at', 'source', 'name', 'email', 'company', 'budget', 'message',
  'category', 'service', 'urgency', 'summary', 'reason', 'reply_draft', 'next_step',
].map((name) => ({ name, type: 'string' }));

function fail(message) {
  console.error(`Setup stopped: ${message}`);
  process.exit(1);
}

if (!EMAIL || !PASSWORD) fail('set N8N_EMAIL and N8N_PASSWORD to your n8n login.');
if (!GEMINI_API_KEY) fail('set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey).');

let cookie = '';

async function call(method, url, body, { apiKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-N8N-API-KEY'] = apiKey;
  else if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && !apiKey) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) fail(`${method} ${url} returned ${res.status}: ${(data.message || text).slice(0, 300)}`);
  return data.data !== undefined && !Array.isArray(data) && Object.keys(data).length === 1 ? data.data : data;
}

// 1. Log in and make a short-lived API key for this script.
await call('POST', '/rest/login', { emailOrLdapLoginId: EMAIL, password: PASSWORD });
const scopes = await call('GET', '/rest/api-keys/scopes');
const key = await call('POST', '/rest/api-keys', {
  label: `setup script ${Date.now()}`,
  scopes,
  expiresAt: Date.now() + 60 * 60 * 1000,
});
const apiKey = key.rawApiKey || key.apiKey;
if (!apiKey) fail('n8n did not return an API key.');
const api = (method, url, body) => call(method, `/api/v1${url}`, body, { apiKey });

// 2. Data tables.
// The workflow points at tables by ID: n8n's lookup by name also matches "leads" inside "hot_leads".
const existingTables = (await api('GET', '/data-tables?limit=100')).data || [];
const tableIds = {};
for (const name of ['leads', 'hot_leads']) {
  const found = existingTables.find((t) => t.name === name);
  if (found) {
    tableIds[name] = found.id;
    console.log(`Table "${name}" already exists`);
  } else {
    tableIds[name] = (await api('POST', '/data-tables', { name, columns: COLUMNS })).id;
    console.log(`Created table "${name}"`);
  }
}

// 3. Gemini credential (the key is stored encrypted inside n8n, never in the workflow file).
// Replace any earlier copy so repeated runs leave exactly one, holding the current key.
const savedCredentials = await call('GET', '/rest/credentials');
for (const old of (Array.isArray(savedCredentials) ? savedCredentials : []).filter(
  (c) => c.name === 'Gemini API' && c.type === 'googlePalmApi',
)) {
  await api('DELETE', `/credentials/${old.id}`);
}
const credential = await api('POST', '/credentials', {
  name: 'Gemini API',
  type: 'googlePalmApi',
  data: { host: 'https://generativelanguage.googleapis.com', apiKey: GEMINI_API_KEY },
});
console.log('Saved the Gemini credential');

// 4. Workflow: replace any older copy, then publish it so the form and webhook are live.
const workflow = JSON.parse(await readFile(WORKFLOW_FILE, 'utf8'));
for (const node of workflow.nodes) {
  if (node.credentials?.googlePalmApi) node.credentials.googlePalmApi.id = credential.id;
  const table = node.parameters?.dataTableId;
  const match = typeof table?.value === 'string' && table.value.match(/^__TABLE_ID:(\w+)__$/);
  if (match) table.value = tableIds[match[1]];
}
const existing = (await api('GET', '/workflows?limit=100')).data || [];
for (const old of existing.filter((w) => w.name === workflow.name)) {
  if (old.active) await api('POST', `/workflows/${old.id}/deactivate`);
  // Unpublishing finishes in the background; deleting too early returns 409.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}/api/v1/workflows/${old.id}`, {
      method: 'DELETE',
      headers: { 'X-N8N-API-KEY': apiKey },
    });
    if (res.ok || res.status === 404) break;
    if (res.status !== 409 || attempt === 15) fail(`could not remove the old workflow (${res.status}).`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const created = await api('POST', '/workflows', {
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings,
});
await api('POST', `/workflows/${created.id}/activate`);

console.log(`\nWorkflow is live: ${BASE}/workflow/${created.id}`);
console.log(`Contact form:      ${BASE}/form/contact`);
console.log(`Webhook (POST):    ${BASE}/webhook/lead`);
