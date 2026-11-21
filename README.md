# AI Lead Inbox (n8n + Gemini)

An n8n workflow that reads every new lead from your website, decides how promising it is,
and writes a reply for you to check and send. Nobody has to sort the inbox by hand: hot leads
are waiting in their own table with a draft that mentions what the person actually asked for.

```
Website form ─┐
              ├─> Clean up the lead ─> Qualify the lead (AI) ─> Build the record ─> Leads table ─> Hot lead? ─> Hot leads table
Lead webhook ─┘                               │
                                            Gemini
```

## What it does with each lead

| Field | What the AI fills in |
|---|---|
| `category` | `hot` (clear need, budget or deadline), `warm` (real but vague), `cold` (just asking), `spam` |
| `service` | Which of the business's services fits, in a few words (for example "support chatbot"), or `other` |
| `urgency` | `high` only when the person names a deadline or asks to talk now |
| `summary` | One sentence, facts from the message only |
| `reason` | Why it got that category, so you can disagree quickly |
| `reply_draft` | 50 to 110 words, uses the person's name and one detail from their message. Empty for spam |
| `next_step` | Call or reply today / reply with questions / short info reply / ignore |

Results from the five sample leads in `sample_data/sample_leads.json`:

| Lead | Category | Service | Next step |
|---|---|---|---|
| Dental clinic group, wants a chatbot live before January | hot | support chatbot | Call or reply today |
| Parts distributor, 60 PDF invoices a week typed by hand | warm | email or document automation | Reply with questions |
| "How much does a chatbot cost in general?" | cold | support chatbot | Short info reply |
| "500 backlinks for $49" | spam | other | Ignore |
| Podcast, 8 episodes a month from next month | hot | video content repurposing | Call or reply today |

The replies are drafts. A person reads them before anything is sent; the workflow never emails a lead on its own.

## Guardrails

- The prompt allows only facts from the lead: no invented prices, dates or past projects.
- The output must match a JSON schema with fixed values for category and urgency.
- Replies never claim a time slot is free or booked, and never ask for details the lead already gave.
- A code step checks the AI output again and falls back to `warm` if the category is anything unexpected.
- The Gemini key is stored as an encrypted n8n credential. It is not in the workflow file or this repository.

## Run it locally

Needs [Node.js 20 or newer](https://nodejs.org) and a free Gemini key from https://aistudio.google.com/apikey.

```powershell
npx n8n
```

Open http://localhost:5678 and create your n8n login. Then, in a second terminal in this folder:

```powershell
$env:N8N_EMAIL="your n8n login email"
$env:N8N_PASSWORD="your n8n password"
$env:GEMINI_API_KEY="your Gemini key"
node scripts/setup_n8n.mjs
```

The script creates the `leads` and `hot_leads` data tables, saves the Gemini credential, imports the
workflow and publishes it. It prints the two addresses that are now live:

- **Contact form:** http://localhost:5678/form/contact
- **Webhook:** `POST http://localhost:5678/webhook/lead` with JSON `{ "name", "email", "company", "budget", "message" }`.
  Optional: `source` (shown in the table, e.g. "website chat"), and `business` / `sign_off` when the sender
  answers for a different business. The [website chat agent](https://github.com/mkaku2400-lang/website-ai-agent)
  uses these to send leads for its clinic demo.

Send the five sample leads to the webhook:

```powershell
Get-Content sample_data/sample_leads.json -Raw | ConvertFrom-Json | ForEach-Object {
  Invoke-RestMethod http://localhost:5678/webhook/lead -Method Post -ContentType application/json -Body ($_ | ConvertTo-Json)
}
```

Then open **Overview > Data tables > leads** in n8n to see the results.

To import by hand instead: in n8n choose **Import from file**, pick `workflow/ai_lead_inbox.json`,
create a Google Gemini credential, and point the two Data table nodes at your own tables.

## Adapting it for a business

- **Who the replies are from:** two lines at the top of the *Clean up the lead* node (`BUSINESS`, `SIGN_OFF`).
- **Categories and reply rules:** the schema and system prompt in *Qualify the lead (AI)*.
- **Where leads go:** swap the Data table nodes for Google Sheets, HubSpot, Airtable or a Slack message.
  The record coming out of *Build the lead record* is flat, so any of these can map it directly.
- **Model:** the *Gemini* node uses `gemini-3.5-flash-lite`, which is fast and inexpensive. Any chat model n8n supports
  (OpenAI, Anthropic, Ollama) can replace it without touching the rest of the workflow.

## Files

| File | Purpose |
|---|---|
| `workflow/ai_lead_inbox.json` | The n8n workflow |
| `scripts/setup_n8n.mjs` | Creates tables and credential, imports and publishes the workflow |
| `sample_data/sample_leads.json` | Five realistic test leads (fictional people and companies) |
