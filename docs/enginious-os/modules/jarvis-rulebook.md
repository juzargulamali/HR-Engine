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
7. **What the person submits for a task may go to Anthropic; what Enginious OS holds may not; genuinely restricted material stays inside even when pasted** (section 3).

## 2. The capabilities

"Sales grant" means an active Sales & CRM grant for the selected company. Every row also needs: signed in, JARVIS on, on the pilot list, company allowed. "Paused by" lists the independent switches (section 5).

| Capability (`id`) | Who | Company and records | May display | May go to Anthropic | Confirmation | Paused by |
|---|---|---|---|---|---|---|
| Greetings, thanks, one short clarifying question `jarvis.local.conversation` | Anyone who may open JARVIS | None | Fixed sentences written in the app | **Nothing** (no provider call) | None | main switch |
| General questions and writing help `jarvis.sales.chat.reply` | Sales grant | **No records.** The person's own message, at most four earlier turns of the same general conversation, their own saved preferences | The answer or draft, after it is screened; which preferences were applied | The message as written (prices and other figures the person gives are allowed); at most four earlier turns (each cut to 3,000 characters); fixed preference sentences. Screened for restricted material first. Never lookup results, cards or text submitted for a Sales task | None (nothing is saved or sent) | main switch, `chat` |
| How Enginious OS works `jarvis.sales.help.answer` | Sales grant | The published staff guidance only. No records | Guidance title, summary, steps, links to screens | **Nothing** | None | main switch, `help` |
| Show my overdue Sales follow-ups `jarvis.sales.followups.overdue` | Sales grant | The selected company; open follow-ups assigned to the signed-in person whose due time has passed; the enquiries they belong to | Follow-up title (hidden only if it contains restricted personal data), type, due date, days overdue; enquiry reference, title and link; company name; cutoff time; count | **Nothing.** Computed and shown inside Enginious OS; the results are never put into a later provider request | None (read only) | main switch, `lookups` |
| Create an enquiry from a brief `jarvis.sales.enquiry.create_from_brief` | Sales grant (the existing rules of creating an enquiry) | One new enquiry in the selected company; organisations the person can see (matched inside Enginious OS) | The proposed form fields; matching organisations (name, place); possible duplicates (reference, title, stage); the saved reference and link | **The brief as the person submitted it** (section 3.1): project and company names, client, agency and end client, venue, dates, game journey, technical requirements, quantities, quoted prices, unit rates and client budgets. Not sent: a brief restricted as a whole; genuinely restricted material; contact details. Nothing from the database | Review card, plus acknowledgement of a likely duplicate | main switch, `writes` |
| Draft a reply about an enquiry `jarvis.sales.draft_reply` | Sales grant | One enquiry of the selected company that the person can see (read to check access, label the card and check the draft locally) | The draft subject and body; what to confirm; the enquiry reference and title | **Only the text the person pasted for this reply**, as written (prices, rates and budgets included), screened for restricted material. **Nothing from the enquiry record is attached**: no title, parties, dates, venue, value, budget note, owner, estimates or proposals | None (a draft; nothing is sent) | main switch |
| Register a client or agency `jarvis.sales.organisation.register` | Sales grant (the existing rules of Clients & Agencies) | One new organisation; existing organisations the person can see | Matching organisations (name, type, place, country, website); the proposed details; the saved name and link | **Nothing** | Review card, plus acknowledgement of a same-name or same-website organisation | main switch, `writes` |
| Update an enquiry `jarvis.sales.enquiry.update` | The enquiry's owner or a Sales founder of its company | One enquiry; ten fields only: title, brief, event start and end, installation start, location, technologies, scope, waiting on, budget note | Each change, before and after (compared with the current values inside Enginious OS) | **Only the request**, screened. The enquiry's current values are not attached | Review card, bound to the record version | main switch, `writes` |
| Change an enquiry's status `jarvis.sales.enquiry.change_stage` | The enquiry's owner or a Sales founder | One enquiry; one step between the six working stages; never Won, Lost, On hold, reopen or handover | Current and proposed stage; whether the evidence is recorded | **Nothing** | Review card, bound to the record version | main switch, `writes` |
| Meeting notes to an activity and follow-up `jarvis.sales.meeting.record` | Sales grant | One enquiry; one activity and one follow-up for the signed-in person | The proposed activity and follow-up | The notes the person pasted for this task, as written, screened for restricted material | Review card (both saved together or neither) | main switch, `writes` |
| What JARVIS remembers `jarvis.memory.preferences` | Anyone who may open JARVIS; **their own preferences only** | The person's own rows of a closed set of preferences (section 4) | The person's own preferences | Nothing when saving, listing or deleting. A saved preference reaches the provider only as its fixed sentence inside a general chat request | None | main switch, `memory` (saving only; seeing and deleting stay available) |
| Suggest a correction to the guidance `jarvis.knowledge.suggest_correction` | Anyone who may open JARVIS | One suggestion row of their own, for review | That it was sent for review | **Nothing** | None | main switch, `help` |
| Requests about protected information `jarvis.protected.guide` | Anyone who may open JARVIS | **Only the person's own access** (roles and grants). Never the protected records | That JARVIS cannot show it; the screen to use when the person has access; that they have no access (without saying whether a record exists); or that access could not be checked | **Nothing** | None | main switch |
| Live requests not supported yet `jarvis.unsupported.live` | Anyone who may open JARVIS | None | What is not supported and the screen to use | **Nothing** | None | main switch |

Not in the table = not approved. In particular there is **no live record access to Projects & Tasks, Inventory, Finance, People & HR or Approvals**, no summaries or counts, and no client or project creation beyond the rows above (see section 7).

## 3. What may leave Enginious OS, and what may not

There are three kinds of information, and the rule differs for each.

| Kind | Rule |
|---|---|
| **A. What the person deliberately submits for a task** (typed or pasted): Sales context such as project and company names, the client, agency and end client, venue, dates, game journey, technical requirements, quantities, **quoted prices, unit rates and client budgets** | **Allowed** to go to Anthropic for that task, as written. A figure such as "85 per item" or "AED 50,000–65,000" is not a reason to refuse, and useful sentences are not stripped. The panel says so next to the input: "The text you submit for this task is sent to Anthropic to prepare a draft." There is no extra confirmation before a routine brief; saving an enquiry still needs the review card and its confirmation |
| **B. What Enginious OS holds** (CRM records, saved quotes, historical prices, margins, budgets, notes, lookup results) | **Never attached by the app.** Anthropic has no database access. No capability has an outbound source that carries a record: the only sources are the person's text, the bounded general-chat context and fixed preference sentences (`OutboundSource`, `lib/jarvis/rulebook.ts`). Live lookups run under the signed-in person's permissions through the app's own server code, are shown inside Enginious OS, and are not passed back through chat history. Text submitted for one Sales task is not memory and does not carry into another task |
| **C. Genuinely restricted material, even when pasted**: employee documents, salaries and payroll, reimbursements, medical and insurance records, private leave details, personal IDs and bank details, credentials, company financial statements and ledgers, internal costing (cost breakdowns, internal budgets, margins, mark-ups, and any amount the words call our own cost, such as "Our cost is 85 per item", with or without a currency), embedded files, and anything marked as not for external sharing | **Stays inside Enginious OS.** It is never sent and never shown in an answer |

How C is enforced, in layers (a word list alone would not be enough, so it is only the last layer):

1. **Declared sources.** Every provider request states what it is built from and the gate (`lib/jarvis/outbound.ts`) refuses a source the capability's rule does not list. No rule lists a record source, so adding one needs this rulebook to change first.
2. **A sharing restriction is enforced at the common boundary.** A text marked as not for external sharing ("External sharing prohibited", "Internal use only" and its variants such as "internal-only" and "for internal use", "NDA", "Confidential", "Do not forward") makes no provider call **in any capability**: the gate refuses it whichever mode was chosen (enquiry, Sales reply, update, meeting notes, general chat), whether the text was edited, and whether the marking is in the message or in the earlier context (`wholeTextRestricted`). The person is told in words and, for an enquiry, pointed to the new-enquiry form. An ordinary sentence that merely contains such a word ("parking is restricted") is not a marking.
3. **Screening of everything that goes out** (`lib/jarvis/protected.ts`): the person's text and the earlier general-chat turns, on every call. If restricted material is found, or the text is too long or contains an embedded file, **nothing is sent**.
4. **Screening of what comes back.** A model answer that contains restricted material is withheld. A lookup's free text is screened before display and restricted personal data is replaced by "Details hidden here. Open the record to see them."
5. **Logs are blind.** Only event names, capability ids, outcome codes and durations are logged; never text, values, provider payloads or chat.
6. **This release is pasted text only.** No file is uploaded to Anthropic.

### 3.1 An enquiry brief

Decided **locally, before any provider call** (`apps/web/src/lib/jarvis/sales/brief-outbound.ts`). The model is never relied on to remove anything.

| In the brief | What happens |
|---|---|
| The Sales context of kind A, including quoted prices, unit rates and client budgets | Sent as written. Nothing is summarised, stripped or cut |
| A restriction on the **whole** brief: "External sharing prohibited", "Internal use only", "NDA", "Confidential", "Do not share", "Restricted", "Embargoed", "Privileged", in the heading (first three lines), as a short notice line, or said of the brief itself | **Zero provider calls, in any version.** The editable preview is not offered and an edited text is refused: it cannot lift the restriction. The person is pointed to the new-enquiry form |
| Restricted material of kind C mixed into an otherwise usable brief | The brief is **not sent automatically**. The panel shows a clean excerpt (the brief without those sentences) for the person to check, edit and send, with the new-enquiry form as the other way. Restricted text put back into the edited version is refused again |
| Email addresses and phone numbers | Replaced by `[contact withheld]` (not needed to prepare an enquiry). A budget range such as "AED 50000-65000", an amount or a date is not a phone number and is left as written |

**What the model reads is separate from what the app saves.**

| On the review card | Comes from |
|---|---|
| Client, end client and agency | The labelled lines of the brief, read by Enginious OS and matched to organisations the person can see. "Client" next to an "End client" is the agency field; alone it is the end client. The model's answer does not override a labelled name |
| Value and currency | **Only one clearly stated client budget** ("Client budget: AED 85,000", "the client's budget is ..."). A range, an approximate figure, conflicting values, an internal figure or a budget not said to be the client's leave the numbers **blank**. The model's figures are never used |
| Budget note | The original wording of the budget, for the reviewer (an internal figure is not copied) |
| Brief | The original brief (a brief longer than the field keeps a summary there and the card says so; nothing is cut silently) |

Nothing is saved until the person confirms the card; a repeated confirmation returns the original result. If the model's answer cannot be used, the card is built from what was read locally and asks only for what is missing.

**A request to be told protected information** ("What is Sara's salary?", "What discount did we give on the last quotation?") is answered by `jarvis.protected.guide`: JARVIS does not retrieve it. It checks the person's own access inside Enginious OS and then

| The person | Is told |
|---|---|
| Has access (Payroll: HR admin, Finance, CEO, CTO. Project budgets: a budget grant for the company. Saved prices: a Sales grant for the company. Own leave, claims and profile: everyone) | That JARVIS cannot show or discuss it, and which screen to open (a link) |
| Has no access | That they do not have access. **The words are the same whether or not the record or the person exists** |
| Access could not be checked | That it could not be checked, and no screen is suggested |

Asking for a draft that mentions a price the person supplies ("draft a reply offering 85 per item") is ordinary writing, not such a request.

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

1. **Internal figures in a brief** (an "internal budget", "our cost", a margin) are treated as internal costing, kind C: the brief is not sent automatically and the person sends a clean excerpt. If the owner wants those to go as ordinary Sales context, remove them from the internal-costing list in `lib/jarvis/protected.ts`.
2. **Contact details** (email addresses, phone numbers) in a brief are replaced before sending. They are not on the restricted list; this is data minimisation and can be dropped if the owner prefers the brief untouched.
3. **Reply and update no longer receive the enquiry record.** A drafted reply is written from the pasted text only, so it does not know the enquiry's recorded dates or venue unless the person includes them; the update action must be told the new value in full.
4. **The screen is a pattern list.** It can miss an unusual phrasing and can stop a harmless text. That is why it is the last layer and why it fails closed.
5. **What Anthropic retains** is governed by the owner's agreement with Anthropic: `Unverified` here.
6. **Reviewing suggestions** is an owner-run query (`supabase/manual-sql/jarvis_memory_30_suggestions_review_readonly.sql`); there is no review screen yet.

## 7. Next increments (not built)

In this order, each with its own rule in this document before any code:

1. **Sales summaries** of previous work and trends, each stating its dates, company scope and metric definitions (for example what counts as "won" and by which date).
2. **More creation actions** for clients and projects.
3. **Draft estimates** with scope, descriptions and quantities only. Pricing stays in the Estimate screen.

**A won enquiry is not a delivered project.** JARVIS answers delivery counts only once there is an approved Projects source and an agreed definition of "delivered". Until then it says so and links to Projects.
