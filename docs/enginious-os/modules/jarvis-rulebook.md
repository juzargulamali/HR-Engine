# The Enginious OS rulebook for JARVIS

What JARVIS may do, for whom, with which records, what it may show, what may leave Enginious OS for the AI provider (Anthropic), and what needs a confirmation. **This document and the code are kept in step by a test**: the enforced copy is `apps/web/src/lib/jarvis/rulebook.ts`; `apps/web/src/lib/jarvis/assistant-rules.test.ts` fails if a capability below is missing here, if a registered action has no rule, or if an action could call the provider without its rule approving it. To change a rule, change both in the same pull request.

Related: how JARVIS works [`jarvis.md`](./jarvis.md); the Sales actions [`sales-action-catalogue.md`](./sales-action-catalogue.md) section 3.9; the staff guidance JARVIS answers from [`../staff-guidance/README.md`](../staff-guidance/README.md).

## 1. Principles (each is enforced on the server)

1. **Deny by default.** A capability, a field or an outbound source that is not listed in section 2 is not approved. Unknown action ids are refused by the registry (`lib/jarvis/registry.ts`); a provider request from a capability without an approving rule, or with a source its rule does not list, is refused by the outbound gate (`lib/jarvis/outbound.ts`).
2. **The signed-in person's identity, every time.** Every request, every lookup and every follow-up is authorised again from the session (`createDispatcher.authorize`, `lib/jarvis/dispatcher.ts`): JARVIS switched on, the person on the pilot list, the company allowed, the module grant for the selected company; then the action's own rule; and the records are read through that person's own database session, so the database's company and record rules decide what exists for them. There is no privileged database client in JARVIS.
3. **Nothing is proof of permission except that check.** Not the model, not a prompt, not memory, not an earlier answer and not the context the browser sends with a follow-up. "Show last month instead" runs the lookup again; if access was removed in between, it is refused.
4. **The model never decides.** Messages are routed locally by fixed rules (`lib/jarvis/router.ts`); no provider call classifies intent. The model can only return a proposal or a text; it has no tool that reads or writes anything.
5. **Writes need the person's confirmation** on a review card, bound to the reviewed values and verified in the database (`jarvis.md` section 6). A chat message such as "confirmed" saves nothing. A repeated confirmation returns the original result.
6. **JARVIS sends no messages.** A draft is text for the person to review and copy.

## 2. The capabilities

"Sales grant" means an active Sales & CRM grant for the selected company. Every row also needs: signed in, JARVIS on, on the pilot list, company allowed. "Paused by" lists the independent switches (section 5).

| Capability (`id`) | Who | Company and records | May display | May go to Anthropic | Confirmation | Paused by |
|---|---|---|---|---|---|---|
| Greetings, thanks, one short clarifying question `jarvis.local.conversation` | Anyone who may open JARVIS | None | Fixed sentences written in the app | **Nothing** (no provider call) | None | main switch |
| General questions and writing help `jarvis.sales.chat.reply` | Sales grant | **No records.** The person's own message, at most four earlier turns of the same conversation, their own saved preferences | The answer or draft, after it is screened; which preferences were applied | The message; at most four earlier turns (each cut to 3,000 characters); fixed preference sentences. All screened for protected content first | None (nothing is saved or sent) | main switch, `chat` |
| How Enginious OS works `jarvis.sales.help.answer` | Sales grant | The published staff guidance only. No records | Guidance title, summary, steps, links to screens | **Nothing** | None | main switch, `help` |
| Show my overdue Sales follow-ups `jarvis.sales.followups.overdue` | Sales grant | The selected company; open follow-ups assigned to the signed-in person whose due time has passed; the enquiries they belong to | Follow-up title (hidden if it contains protected details), type, due date, days overdue; enquiry reference, title and link; company name; cutoff time; count | **Nothing.** Computed and shown inside Enginious OS | None (read only) | main switch, `lookups` |
| Create an enquiry from a brief `jarvis.sales.enquiry.create_from_brief` | Sales grant (the existing rules of creating an enquiry) | One new enquiry in the selected company; organisations the person can see | The proposed form fields; matching organisations (name, place); possible duplicates (reference, title, stage); the saved reference and link | **The full non-sensitive narrative of the brief**, prepared locally before the call (section 3.1): event context, venue, dates, visitor or game journey, technical requirements, equipment, deliverables. Never pricing, budgets, costs, margins, contacts, personal or employee data, credentials, contract or restricted material; labelled client, end-client and agency names go as placeholders | Review card, plus acknowledgement of a likely duplicate | main switch, `writes` |
| Draft a reply about an enquiry `jarvis.sales.draft_reply` | Sales grant | One enquiry of the selected company that the person can see | The draft subject and body; what to confirm; the enquiry reference and title | The pasted conversation, screened; the enquiry's reference, title, agency and end-client names, event and installation dates, location, technologies, scope and brief summary. **Never** its value, currency, budget note, owner, ids, estimates or proposals | None (a draft; nothing is sent) | main switch |
| Register a client or agency `jarvis.sales.organisation.register` | Sales grant (the existing rules of Clients & Agencies) | One new organisation; existing organisations the person can see | Matching organisations (name, type, place, country, website); the proposed details; the saved name and link | **Nothing** | Review card, plus acknowledgement of a same-name or same-website organisation | main switch, `writes` |
| Update an enquiry `jarvis.sales.enquiry.update` | The enquiry's owner or a Sales founder of its company | One enquiry; ten fields only: title, brief, event start and end, installation start, location, technologies, scope, waiting on, budget note | Each change, before and after | The request, screened; the current values of those fields except the budget note | Review card, bound to the record version | main switch, `writes` |
| Change an enquiry's status `jarvis.sales.enquiry.change_stage` | The enquiry's owner or a Sales founder | One enquiry; one step between the six working stages; never Won, Lost, On hold, reopen or handover | Current and proposed stage; whether the evidence is recorded | **Nothing** | Review card, bound to the record version | main switch, `writes` |
| Meeting notes to an activity and follow-up `jarvis.sales.meeting.record` | Sales grant | One enquiry; one activity and one follow-up for the signed-in person | The proposed activity and follow-up | The pasted notes only, screened | Review card (both saved together or neither) | main switch, `writes` |
| What JARVIS remembers `jarvis.memory.preferences` | Anyone who may open JARVIS; **their own preferences only** | The person's own rows of a closed set of preferences (section 4) | The person's own preferences | Nothing when saving, listing or deleting. A saved preference reaches the provider only as its fixed sentence inside a general chat request | None | main switch, `memory` (saving only; seeing and deleting stay available) |
| Suggest a correction to the guidance `jarvis.knowledge.suggest_correction` | Anyone who may open JARVIS | One suggestion row of their own, for review | That it was sent for review | **Nothing** | None | main switch, `help` |
| Requests about protected information `jarvis.protected.guide` | Anyone who may open JARVIS | **Only the person's own access** (roles and grants). Never the protected records | That JARVIS cannot show it; the screen to use when the person has access; that they have no access (without saying whether a record exists); or that access could not be checked | **Nothing** | None | main switch |
| Live requests not supported yet `jarvis.unsupported.live` | Anyone who may open JARVIS | None | What is not supported and the screen to use | **Nothing** | None | main switch |

Not in the table = not approved. In particular there is **no live record access to Projects & Tasks, Inventory, Finance, People & HR or Approvals**, no summaries or counts, and no client or project creation beyond the rows above (see section 7).

## 3. Protected information

**Salaries and payroll, reimbursements, medical and insurance details, personal IDs and bank details, private leave details, quote and estimate amounts, unit rates, discounts, margins and project financials never appear in a JARVIS response and never go to Anthropic. Passwords, keys and embedded files never go either.**

How that is enforced, in layers (a word list alone would not be enough, so it is only the last layer):

1. **No path carries records to the provider.** The lookup calls no provider. The Sales actions send only the per-action field lists in section 2. Memory is a closed set of values. The Map is never sent: guidance answers call no provider.
2. **Declared sources.** Every provider request states what it is built from; the gate refuses a source the capability's rule does not list. Adding a record field, a database row or an attachment to a request therefore needs this rulebook to change first.
3. **Screening of everything that may go out** (`lib/jarvis/protected.ts`): what the person typed or pasted, and the earlier turns, on every call. If protected details are found, or the text is too long or contains an embedded file, **nothing is sent** and the person is asked for a version without those details or pointed to the screen.
4. **Screening of what comes back.** A model answer that contains protected details is withheld. Free-text fields of a lookup are screened before display and replaced by "Details hidden here. Open the record to see them."
5. **Logs are blind.** Only event names, capability ids, outcome codes and durations are logged; never text, values, provider payloads or chat.

### 3.1 An enquiry brief (the one place a long pasted text is the point)

An explicit request to create an enquiry, or a text that clearly is a client brief, is separated **locally, before any provider call** (`apps/web/src/lib/jarvis/sales/brief-outbound.ts`). The model is never relied on to remove anything.

| In the brief | What happens |
|---|---|
| Event context, venue, dates, visitor or game journey, technical requirements, equipment, deliverables, public names in the narrative | Sent in full. Nothing is summarised or cut before the model sees it |
| A labelled money line (`Budget:`, `Price:`, `Cost:` ...) and any sentence about a price, quote, budget, discount, rate or margin, **with or without a currency** ("Our final quote is 85000") | Withheld whole. A stray figure in a narrative sentence is replaced by `[amount withheld]`. Dates, quantities, sizes and durations ("12 minutes", "600 guests", "4 tables") are not amounts and stay |
| Budgets | **None is ever sent.** The review card's value, currency and budget note are filled only from a budget the words explicitly call the client's ("Client budget: ...", "the client's budget is ...", "their budget") and only when there is exactly one such figure. An unlabelled "Budget:", an internal budget, or two different client budgets leave the fields blank for the reviewer, and the card says so |
| A restriction on the **whole** brief: an NDA, confidential, internal-only, do-not-share, restricted, embargoed or privileged marking in the heading (first three lines), as a short notice line, or a sentence saying the brief itself is confidential or under NDA | **No provider call at all, in any version.** The editable preview is not offered (it cannot lift the restriction). The person is pointed to the new-enquiry form |
| Email addresses and phone numbers | Replaced by `[contact withheld]` |
| Personal or employee data, credentials, contract or client-restricted material (contract, NDA, confidential, penalties ...) | The sentence is withheld whole |
| The agency, client and end client named on labelled lines | Sent as `[AGENCY]`, `[CLIENT]`, `[END CLIENT]`; matched to organisations inside Enginious OS; put back in the returned fields |

The separated text is screened again. **If anything protected is still in it, nothing is sent**: the panel shows the text that would be sent for the person to edit, with a link to the new-enquiry form as the other way. The **original brief stays in Enginious OS**: it fills the review card's Brief field (a brief longer than the field keeps a summary there and the card says so; nothing is cut silently) and is saved only by the confirmed enquiry. The review card says what was kept inside. If the model's answer cannot be used, the card is built from what was read locally and asks only for what is missing.

**A request about protected information** ("What is Sara's salary?") is answered by `jarvis.protected.guide`: JARVIS checks the person's own access inside Enginious OS and then

| The person | Is told |
|---|---|
| Has access (Payroll: HR admin, Finance, CEO, CTO. Project budgets: a budget grant for the company. Prices: a Sales grant for the company. Own leave, claims and profile: everyone) | That JARVIS cannot show or discuss it, and which screen to open (a link) |
| Has no access | That they do not have access. **The words are the same whether or not the record or the person exists** |
| Access could not be checked | That it could not be checked, and no screen is suggested |

## 4. Memory and knowledge

| | Conversation context | Personal memory | Company knowledge |
|---|---|---|---|
| What | The last few turns of the current general conversation, and whether a lookup was just shown | A closed set of preferences: email and draft length (short, medium, detailed), English spelling (British, American), tone (formal, friendly, neutral), answer length (brief, detailed) | The published staff guidance in `docs/enginious-os/staff-guidance/` |
| Where it lives | In the open panel only. Reloading or pressing Clear removes it. The server stores none of it | The database, one row per person per preference (`jarvis_preferences`, migration `20261226000100`); the database refuses anything outside the closed set | The repository (the Map); published into `apps/web/src/lib/jarvis/knowledge/published.generated.ts` |
| Who sees it | The person | **Only the person** (the functions take no user argument). "What JARVIS remembers" in the panel lists it, and each preference can be changed or deleted | Everyone who may use JARVIS |
| How it changes | By chatting | "Remember that I prefer ...", or the panel. Never free text, business records, credentials, sensitive facts or chat | Only through the Map's normal publication: edit, review in a pull request, merge, deploy. A "Suggest a correction" from the panel is stored for review (`jarvis_knowledge_suggestions`) and changes nothing until then. No model is retrained |
| Permission | Never. A follow-up that asks for records runs under the current permissions | Never | Never |

## 5. Switches (existing controls first)

| Switch | Where | Effect |
|---|---|---|
| Main | `JARVIS_DISABLED=1`, or `jarvis_settings.enabled = false`, or the pilot list | Everything off |
| Writes | `jarvis_settings.writes_enabled = false` (existing), or `writes` in `JARVIS_PAUSE` | No review card that saves; everything else works |
| Help, lookups, chat, memory | `JARVIS_PAUSE` (server environment), a comma-separated list, for example `chat,lookups` | Each pauses independently; the person is told in words |

Requests are bounded: message length (`JARVIS_MAX_INPUT_CHARS`), at most four context turns, 25 rows per lookup, the provider timeout and output cap, one provider call per request with no retry, and the daily allowance per person.

## 6. Decisions and gaps for the owner

1. **Budgets never go to the provider, in any action.** In an enquiry brief only an explicitly identified, unambiguous client budget is read locally and shown on the review card (it is the person's own pasted text, going into the enquiry form's own value and budget-note fields, and is saved only on confirmation). The owner should confirm that showing it on that card is acceptable; the alternative is to leave those fields blank for the person to fill. Consequences for the other actions: a client conversation, a set of meeting notes or an update request that contains a price or budget figure is **refused** (fail safe) and the person removes the figure or uses the screen; the draft-reply action no longer receives the enquiry's budget note; the update action can no longer change the budget note from a figure in the request.
2. **The screen is a pattern list.** It can miss an unusual phrasing and can stop a harmless text. That is why it is the last layer and why it fails closed.
3. **What Anthropic retains** is governed by the owner's agreement with Anthropic: `Unverified` here.
4. **Reviewing suggestions** is an owner-run query (`supabase/manual-sql/jarvis_memory_30_suggestions_review_readonly.sql`); there is no review screen yet.

## 7. Next increments (not built)

In this order, each with its own rule in this document before any code:

1. **Sales summaries** of previous work and trends, each stating its dates, company scope and metric definitions (for example what counts as "won" and by which date).
2. **More creation actions** for clients and projects.
3. **Draft estimates** with scope, descriptions and quantities only. Pricing stays in the Estimate screen.

**A won enquiry is not a delivered project.** JARVIS answers delivery counts only once there is an approved Projects source and an agreed definition of "delivered". Until then it says so and links to Projects.
