// Builds workflow/ai_lead_inbox_template.json: the version shared on the n8n template library.
// Differences from the workflow the setup script imports: no credential or table IDs, a neutral
// business description, and sticky notes that explain setup inside the canvas.
//
//   node scripts/make_template.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, '..', 'workflow', 'ai_lead_inbox.json');
const TARGET = path.join(HERE, '..', 'workflow', 'ai_lead_inbox_template.json');

const workflow = JSON.parse(await readFile(SOURCE, 'utf8'));

for (const node of workflow.nodes) {
  // The person importing the template picks their own credential and tables.
  delete node.credentials;
  if (node.parameters?.dataTableId) {
    const name = node.parameters.dataTableId.cachedResultName;
    node.parameters.dataTableId = { __rl: true, mode: 'list', value: '', cachedResultName: name };
  }
  if (node.name === 'Clean up the lead') {
    node.parameters.jsCode = node.parameters.jsCode
      .replace(/const BUSINESS = '.*';/, "const BUSINESS = 'Acme Studio, a small web design agency (websites, online shops, SEO)';")
      .replace(/const SIGN_OFF = '.*';/, "const SIGN_OFF = 'Alex';");
  }
}

const sticky = (id, name, content, position, width, height, color) => ({
  parameters: { content, width, height, color },
  id,
  name,
  type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1,
  position,
});

workflow.nodes.unshift(
  sticky('0f1c6a52-0101-4c1e-9a10-a1b2c3d40101', 'About this workflow', [
    '## AI Lead Inbox: sort new leads and draft the reply',
    '',
    'Every new lead from the contact form or the webhook is read by an AI model, which fills in:',
    '- **category**: hot, warm, cold or spam',
    '- **service** it fits, **urgency**, a one-line **summary** and the **reason** for the rating',
    '- a **reply draft** that mentions a detail from their message (empty for spam)',
    '',
    'Everything goes to the `leads` data table. Hot leads are also copied to `hot_leads`, so nobody misses them.',
    '',
    'Replies are drafts. Nothing is emailed to the lead automatically.',
  ].join('\n'), [-420, -320], 380, 460, 7),
  sticky('0f1c6a52-0102-4c1e-9a10-a1b2c3d40102', 'Setup', [
    '## Setup (about 5 minutes)',
    '',
    '1. **Data tables**: create two tables, `leads` and `hot_leads`, each with these text columns: received_at, source, name, email, company, budget, message, category, service, urgency, summary, reason, reply_draft, next_step. Select them in the two table nodes.',
    '2. **AI model**: add a Google Gemini credential (free key at aistudio.google.com) to the **Gemini** node, or swap it for an OpenAI or Anthropic chat model node.',
    '3. **Your business**: edit the first two lines of **Clean up the lead** (what you sell, and the name replies are signed with).',
    '4. Publish, then open the form URL from **Website form**, or POST JSON to the webhook: `{ "name", "email", "company", "budget", "message" }`.',
  ].join('\n'), [-420, 170], 380, 470, 5),
  sticky('0f1c6a52-0103-4c1e-9a10-a1b2c3d40103', 'Guardrails', [
    '### Guardrails',
    'The AI may use only facts from the lead, must return JSON that matches the schema, and never claims a time slot is free. **Build the lead record** checks the output again and falls back to `warm` if the category is unexpected.',
  ].join('\n'), [460, -200], 300, 200, 6),
);

await writeFile(TARGET, JSON.stringify(workflow, null, 2) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), TARGET)} (${workflow.nodes.length} nodes)`);
