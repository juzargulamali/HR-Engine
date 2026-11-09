# JARVIS: setup (environment, pilot switches, data handling)

JARVIS is the Enginious OS assistant (reference: [`enginious-os/modules/jarvis.md`](./enginious-os/modules/jarvis.md)). **It is OFF by default and nothing here has been applied to hosted V2 or Production.** This page is for the owner. Database steps are in [`jarvis-deployment.md`](./jarvis-deployment.md). What was verified: the isolated local stack with the **simulated** provider only. **No live AI provider check has been made** (see "Live provider check" below).

## 1. Environment variables (server only, set in Vercel; none of them is ever sent to the browser)

| Variable | Needed | Default | What it does |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes, for the real provider | none | The Anthropic key. Missing = JARVIS is unavailable (no launcher, every call refused); ordinary Sales & CRM is unaffected. **Never** put it in Git, a screenshot, a chat or a log. Mark it Sensitive in Vercel. |
| `JARVIS_CONFIRMATION_SECRET` | **yes in Production and Preview** | dev-only constant outside production | At least 32 random characters. Signs the confirmation tokens. In production JARVIS **refuses to operate** if it is missing or shorter. Generate with `openssl rand -base64 48`. Changing it invalidates reviews that are open (people review again). |
| `JARVIS_MODEL` | no | `claude-sonnet-5-5` | The model id sent to the API. A product setting: change it in Vercel without a code release. |
| `JARVIS_MAX_INPUT_CHARS` | no | 6000 | Longest pasted brief (200 to 20000). |
| `JARVIS_MAX_OUTPUT_TOKENS` | no | 1200 | Output cap per request (100 to 4000). |
| `JARVIS_TIMEOUT_MS` | no | 20000 | Provider call limit (1000 to 60000). A timeout ends in a clear message; CRM still works. |
| `JARVIS_DAILY_LIMIT_PER_USER` | no | 30 | Provider requests per person per Dubai day (1 to 500), counted in the database (`jarvis_usage`), so restarts and several instances do not reset it. Reviewing and confirming are not counted. |
| `JARVIS_CONFIRMATION_TTL_MINUTES` | no | 15 | How long a reviewed card can be confirmed (1 to 60). |
| `JARVIS_DISABLED=1` | no | unset | **Hard off**, regardless of the database switches. |
| `JARVIS_PROVIDER` | no | `anthropic` | `anthropic`, or `simulated` (tests and local runs only: **refused when `NODE_ENV` or `VERCEL_ENV` is `production`**). |
| `JARVIS_ALLOW_SIMULATED_ON_LOCAL_STACK=1` | local stack only | unset | Lets the isolated local test stack (a production build pointing at a loopback database, never on Vercel) use the simulated provider. Never set it anywhere hosted: it has no effect on Vercel (Vercel always sets `VERCEL`), and it needs a loopback database address. |

## 2. Adding a key to the isolated Preview (owner steps; Claude does none of them)

1. Use a **separate Anthropic key** for Preview with a low spend limit set in the Anthropic console. Do not reuse a Production key.
2. Vercel -> the project -> Settings -> Environment Variables: add `ANTHROPIC_API_KEY` and `JARVIS_CONFIRMATION_SECRET` for **Preview only** (leave Production unchecked), mark them Sensitive. Optionally `JARVIS_DAILY_LIMIT_PER_USER` (for example 10) while piloting.
3. Redeploy the Preview. The Preview must point at the isolated (V2 or a throwaway) Supabase project, never at Production data.
4. Apply the database pack to **that** project (`jarvis-deployment.md`), then switch the pilot on for named people only (section 3).
5. Production stays off: do not add the variables to Production, and do not add anyone to the pilot there, until the owner decides.

## 3. Switching the pilot on and off (no code release)

All switches are rows the owner changes in the Supabase SQL Editor (there is no screen for them in part 1). Exact statements are in [`jarvis-deployment.md`](./jarvis-deployment.md) section "Pilot controls". In short:

* **On**: `update jarvis_settings set enabled = true;` then add people: `insert into jarvis_pilot_users (user_id, note) values ('<user id>', 'pilot');`. A person needs both the pilot row **and** an active Sales grant for a company to see the launcher.
* **Writes off, read-only help stays**: `update jarvis_settings set writes_enabled = false;` (creating is refused with a clear message).
* **Restrict to companies**: `insert into jarvis_pilot_companies (company_id) values ('<company id>');` (while the list is empty there is no company restriction).
* **Off at once for everyone**: `update jarvis_settings set enabled = false;`, or set `JARVIS_DISABLED=1` in Vercel. Both are enforced on the server for every request; hiding the launcher is not the control.

## 4. Data handling

* **Sent to the AI provider**: only what a person pastes into the panel, fixed instructions, today's date and the field schema. No enquiries, organisations, ids, company data or other modules.
* **Kept by Enginious OS**: the enquiry the person approved (with a short summary as its Brief); a ledger row (who approved, company, action, the created enquiry's reference, timestamps, no text); a usage counter. **Not kept**: the pasted text, prompts, model output, chat history. Logs carry no text.
* **Real client briefs need separate owner approval.** Until the owner says so, use fictional briefs only. Anthropic's own retention and training terms depend on the owner's agreement and settings: not verified here. Check them before real briefs are pasted.
* A person can only ever do through JARVIS what their own Sales grant lets them do; JARVIS cannot read salaries, leave, payroll, other modules, configuration, credentials or permissions, and cannot delete anything.

## 5. Live provider check (pending)

Nothing in this change called the real API. The request in `apps/web/src/lib/jarvis/provider/anthropic.ts` (Messages API, one forced tool, model `claude-sonnet-5-5`) is tested against a mocked `fetch`. **Before the pilot**, the owner (or Claude, with an owner-approved Preview key and fictional text) should run one fictional brief through the Preview and check that the card fills in; until then "live provider works" is `Unverified`.

## 6. Local runs (developers)

`apps/web/os-shell-checks/README.md` ("JARVIS flow") shows how to start the isolated stack with the simulated provider and run `jarvis-flow.mjs`. For `next dev` set `JARVIS_PROVIDER=simulated` (allowed outside production) and apply the migration to the local database.
