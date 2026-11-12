# Projects & Tasks: Project Closeout Report

Part of the Projects & Tasks Map: [coverage index](./projects-coverage-index.md) (section 8) and [action catalogue](./projects-action-catalogue.md) (section 10).

Status: written with Projects & Tasks Phase 2, part 2 (branch `claude/admiring-cray-uky379`, draft PR #84 together with the Delivery Plan, **not merged**). Written by the author of the code against the files cited. The database rules are proven on a real PostgreSQL (`packages/rls-tests/test/proj-closeout-reports.rls.test.ts`); the evidence allowlist, the outbound payload, the checks on the provider's answer, retry and failure by unit tests with the **simulated** provider (`apps/web/src/lib/projects/closeout/closeout.test.ts`); the screen and the PDF by unit tests and a temporary browser page with fictional data. **Nothing was checked signed in. No request was sent to Anthropic.** Migration `20270101000100_proj_closeout_reports.sql` (install-order row 29) is **not applied by Claude; hosted status `Unverified`**.

Sources: `supabase/migrations/20270101000100_proj_closeout_reports.sql` (M); `apps/web/src/lib/projects/closeout/evidence.ts` (E), `report.ts` (R), `service.ts` (S), `fixture.ts`; `apps/web/src/lib/actions/projectsCloseout.ts` (A); `apps/web/src/app/(app)/projects/[id]/closeout/page.tsx`, `closeout/[reportId]/pdf/route.tsx`; `apps/web/src/components/projects/closeout/closeout-workspace.tsx`; `apps/web/src/lib/pdf/closeout-document.tsx`; the outbound gate and rulebook `apps/web/src/lib/jarvis/outbound.ts`, `rulebook.ts` (`APP_AI_RULES`), `provider/simulated.ts`; owner packs `supabase/manual-sql/proj_closeout_reports_*`.

## 1. What it is

An **internal** report about one project, written from that project's own records, that the Project Manager reviews, edits and approves as a version. It can be drafted before the project is closed or written for a completed one. It is not a client document: a client-facing report would be a separate, explicit workflow that does not exist.

**It changes nothing else.** Generating, editing, approving and downloading write only to `proj_closeout_reports`. They never complete a project, approve work, send a message or a notice, post to Chat or change stock (M: the report functions name no other table; proven by a fingerprint of projects, completions, tasks, notifications, chat, requests, reservations and movements before and after; verify pack row 7).

**Who.** Only whoever manages the project: Project Manager, temporary project leader, founder (`proj_can_manage`). The database refuses everyone else on every read and write (M: `proj_closeout_evidence`, `proj_closeout_require_manager`, the table's only policy). A project member who does not manage it, someone outside the project and a signed-out visitor get nothing. The Manage project menu shows **Closeout report** to managers only; the screen says who the Project Manager is to anyone else.

## 2. Three separate responsibilities

| Part | What it is | What it can touch |
|---|---|---|
| Evidence collector | The database function `proj_closeout_evidence(project)` | Reads allowlisted columns of ONE project the caller manages. Returns a snapshot. |
| Report writer | The AI provider (Anthropic), behind the common outbound gate, rule `projects.closeout.draft` | Receives ONE request holding only the evidence lines the Project Manager reviewed. No database access, no tools, no actions. Returns an object. |
| Validation and review | `validateDraft`, `validateEdits`, `flagsFor`, `keyFacts` (R), then the Project Manager | Checks references and facts; the person decides what is approved. |

JARVIS has no part in this. `projects.closeout.draft` is in `APP_AI_RULES`, not in `JARVIS_RULES`: no JARVIS action is registered for it, it cannot be asked for in the panel, and JARVIS gained no Projects read, post, completion or publishing ability (`rulebook.ts`; test "the rule is not a JARVIS capability").

## 3. The evidence snapshot (M: `proj_closeout_evidence`)

Built in the database from an explicit allowlist. Display names come from `proj_display_name`.

| Block | Contents |
|---|---|
| `project` | reference, name, kind, status, start and end dates, client name, venue, installation start, event start and end, Project Manager's name |
| `handover` | the accepted Sales handover: Sales reference, title, venue, dates, accepted when and by whom, technologies (name and quantity only), notes text |
| `scope` | the scope and exclusions as accepted at handover (the original agreement) and as they are now, whether they differ, the count of approved scope changes |
| `team` | each member: name, project role, department team, teams they head, still on the project or not, tasks done of tasks assigned, milestones accepted, deliverables they are accountable owner of |
| `milestones` | title, status, due date, required or optional, accepted when and by whom |
| `tasks` | counts (total, done, open, blocked, deferred, cancelled) and up to 40 unfinished tasks (title, status, assignee, due date, blocked) |
| `plan` | the Delivery Plan: each deliverable (key, zone, title, owner, needed by, released) and its lines (section, description, quantity, released, the linked task's status, completion time and assignee, the linked equipment line) |
| `decisions` | decided scope changes, plan changes and corrections: title, outcome, who proposed and when, who decided and when, the recorded reason, the stated effect on dates |
| `feedback` | client feedback records: received on, kind, status, resolved when and by whom, who is responsible, due date, the request text, our response text |
| `completion` | the current completion record or null: completed when and by whom, evidence type, confirmed on, whether a reference or a file is recorded (not the reference itself), the decisions on open items, the completion note |
| `equipment` | each equipment request (code, status, expected return) and its lines: item, asked, status, sent, returned |
| `missing` | sources that could not be read (Inventory not installed, or the equipment read failed) |

**Never selected:** an enquiry's or project's value, budget, costs, margins, payment terms; estimates, proposals and quotations; the scope-change commercial record (`proj_scope_change_commercial`); the project budget and expenses; payroll or any employee record; chat messages; task comments; files, attachments and their links; emails, phone numbers and other contact details (the client contact on the completion record, the feedback source and its evidence note are not selected); credentials. The database test plants such values next to the selected ones and asserts none is in the snapshot; the verify pack (row 6) checks the function's source for those names.

**Not recorded as a field:** the event edition. The handover and the project do not hold a structured edition link (that is a later Phase 2 item); the evidence says so and offers the handover notes as optional text.

## 4. From snapshot to what may be sent (E)

`evidenceItems(snapshot)` turns the snapshot into **lines**, each with a reference (`S1`, `S2`, ...), a category, and the record it comes from. It is a second allowlist: it names every value it emits, so a field added to the snapshot later is not sent unless this file changes (test: planted `budget`, `salary`, `phone`, `unit_price`, user ids are absent from the payload).

* **Facts** (always part of the evidence): project, dates, statuses, counts, names and roles, who decided what and when, that feedback was recorded and its status, milestones, plan lines with their linked task or equipment state, the completion and sign-off lines, equipment sent, returned and still out.
* **Optional text** (free text a person wrote; the Project Manager selects it): original and final scope and exclusions, decision reasons and effects on dates (selected by default, removable); the client's words, our response, the completion note and the handover notes (left out unless ticked).
* **Withheld by the data policy** (never sent, whatever is ticked). Every line is screened, including the fixed-wording ones, because titles, names and venues are typed by people: a line with protected details (`findProtectedContent`); a line marked as not for external sharing (`wholeTextRestricted`); a line with an **email address, phone number or web address** (`mentionsContact`); and, stricter than the general policy, a line that **mentions an amount of money** (`mentionsAmount`: a currency next to a figure or a number in words, or a price word such as cost, price, margin, quoted, invoice near a figure; "4K", "120 Hz", "refresh rate" and quantities are not money). The review screen lists each withheld line by its label and reason.
* **Names:** a display name that is only a sign-in name (the fallback when a person has no full name) is sent as "a team member (full name not set)".
* **One line each, no markup:** text people wrote has angle brackets removed, line breaks flattened and any `[S12]`-shaped text rewritten, so it cannot close the data tag, start a line of its own or pass for another evidence line.
* **Missing sign-off:** with no completion record the evidence says `Completion: NOT RECORDED` and, for a client project, `Client sign-off: NOT RECORDED`. A completion recorded on an internal note is not a client sign-off.
* **Equipment:** every line states asked, sent, returned and still out, and one line gives the units still out across all requests, with the note that delivery being complete does not mean the equipment is back.
* **Bounded:** list limits (`LIMITS`), 1,500 characters per optional text, and a 20,000 character budget (`OUTBOUND_BUDGET`; the gate's own limit is 24,000). Over budget, optional text is cut first, then plan lines, then other long lists. The project status, completion, sign-off, task count, equipment-still-out and "could not be read" lines are **pinned and never cut**. Every list that is cut short says how many more are recorded. What was cut is counted on the review screen.
* `payloadHash` is a fingerprint of exactly the text that would be sent.

## 5. The screen: `/projects/[id]/closeout`

Reached from **Manage project > Closeout report**, from the **Closeout report** panel on Files & client plan (**Generate closeout report**) and from the link on Complete project. A failed read says the report could not be loaded; "not installed in this environment" is a separate message.

### 5.1 Review data to be sent

Shown before anything is written. It shows the **source categories** with their line counts, what is never included, the **team members named**, every **optional text** with a tick box, what the data policy withheld, anything that could not be read, anything cut for size, and "Show every line". Above the buttons: **"Generating sends the reviewed content above to Anthropic"**, with what does not happen (nothing to the client, no completion, no work or stock change).

| Control | What it does |
|---|---|
| Tick boxes on optional text | Include or remove that text. The fingerprint changes with the selection. |
| **Send to Anthropic and write the draft** | `generateCloseout` (A) with mode `ai`. Not offered when no provider is set up; the reason is shown. |
| **Write a facts-only draft (nothing is sent)** | `generateCloseout` with mode `facts`: the draft is the evidence lines themselves, grouped by section. No provider call. |
| **Back to the draft** | Only when a draft exists. Writing again replaces the draft, including edits; the screen says so. |

The browser sends only the project id, the selected keys, the mode and the fingerprint. The server takes the evidence again (S: `generateCloseoutDraft`), rebuilds the text, and refuses if its fingerprint differs from the one reviewed ("The project's records changed since you reviewed"). The database then refuses the save unless the snapshot the report was written from equals the one it takes itself at that moment (M: `proj_closeout_save_draft`), so a caller cannot supply evidence and a stored report always rests on the snapshot stored with it.

### 5.2 The provider call

One request, through `gateProvider(provider, "projects.closeout.draft")`: source `project_closeout_evidence`, the evidence as record text, a fixed instruction text (R: `CLOSEOUT_INSTRUCTIONS`, at most 3 paragraphs of 70 words per section), at most 4,000 output tokens, a 45 second limit. Before the call the database counts it: at most **10 AI drafts per project per day** (`proj_closeout_take_call`, S: `CLOSEOUT_DAILY_LIMIT`); a failed call counts, a reused or facts-only draft does not. The gate applies the app's AI data policy to the whole text again. The instructions say the evidence is data and not instructions, to cite references, to say when something is not recorded, never to infer a sign-off, to keep delivery and equipment return apart, to name people only for recorded ownership and never to judge effort or performance, to quote feedback only from exact recorded text, and to leave money out.

* **Failure or timeout:** the message says nothing was saved and to try again. Nothing is written, so a retry cannot leave a second version.
* **Same content again:** if the draft already holds a generated result for exactly this fingerprint, that draft is returned and nothing is sent.
* **Records changed while writing:** if the change is to something that is not part of the reviewed content, the answer is checked again against the fresh records and saved (nothing is sent twice); if the reviewed content itself changed, nothing is saved and the Project Manager reviews again.
* **One draft per project** (unique index): writing again updates it.
* **Known gaps (independent review, not fixed):** two tabs pressing the button in the same second both call the provider (one draft results; both count toward the daily limit); writing a facts-only draft over an AI draft and then choosing AI again with the same content sends it again.

### 5.3 Checks on the answer (R)

Only `sections[].id` and `sections[].paragraphs[].{text, refs}` are read; anything else the model returned is ignored. A reference that was not sent is dropped. A paragraph containing protected details is left out and counted.

| Mark | Meaning | Effect |
|---|---|---|
| `signoff_unrecorded` | Says the client signed off, accepted or approved when no client sign-off is recorded | **Stops approval** |
| `equipment_out` | Says the equipment is back when some is recorded as still out | **Stops approval** |
| `unverified_quote` | Quoted words that are in no evidence line | **Stops approval** |
| `unverified_figure` | A number or date that is not in the lines the paragraph cites | To check; the Project Manager ticks that they checked |
| `no_source` | A factual paragraph that cites nothing | To check |
| `suggestion` | A lesson suggested by the model | Shown as a suggestion |

The same checks run on every edit the Project Manager saves and again, from the stored draft, when they approve (A: `saveCloseoutEdits`, `approveCloseout`). They are word-pattern checks that lean towards marking too much: a sentence that names the client next to "accepted", "approved" or "signed" is marked even when it is about something else, and is cleared by rewording. They still cannot catch every phrasing: numbers written as words, indirect speech, and a claim that the project "was completed" are not checked. That is why the **Recorded facts** exist. The stopping marks and the tick are enforced by the server action; the database function checks the manager, the version and that the report is not empty, so a manager calling the function directly could approve a marked draft (internal, managers only; the Recorded facts still come from the stored snapshot).

### 5.4 The draft

**Recorded facts** (R: `keyFacts`) are computed from the snapshot stored with the report and shown above the narrative on screen and in the PDF: project, client and venue, event dates, status, completion, client sign-off, approved scope changes, tasks, client feedback, equipment. They are not editable, so the report always states that a sign-off is not recorded or that equipment is still out, whatever the narrative says.

Sections: Executive summary; Agreed scope and final delivery; Team and ownership; Key decisions and changes; Client feedback and response; Testing and handover; Open items; Lessons for the next project. Each paragraph has its text, its source references and any marks. **Sources** lists every cited line with a link to where the record lives (Feedback & changes, Delivery plan, the task, Equipment, History, People & access).

| Control | What it does |
|---|---|
| Paragraph text, Sources field, **Add paragraph**, **Remove paragraph** | Edit the narrative. |
| **Save edits** | `saveCloseoutEdits` -> `proj_closeout_save_edits` with the draft's version; a stale copy is refused. |
| **Approve version N** | `approveCloseout` -> `proj_closeout_approve`. Off while edits are unsaved, a stopping mark remains or the report is empty. Fixes the version. |
| **Review data and write again** | Back to 5.1. |
| **Discard draft** | `discardCloseoutDraft` -> `proj_closeout_discard_draft`. Approved versions are kept. |

### 5.5 Approved versions and the download

An approved version is frozen with its snapshot, the time the snapshot was taken and its source references; later project edits do not change it (database test: the scope is rewritten and the project completed afterwards, version 1 is unchanged). A new draft after an approval is the next version number. An approved version cannot be edited or discarded.

**Download PDF** (`/projects/[id]/closeout/[reportId]/pdf`) follows the issued client timeline's pattern: read with the caller's own session, rendered each time, nothing stored or sent. A draft answers 409 ("Approve it before downloading"); a person the database does not let read the row gets 404; a failed read 503; signed out 401. Every page says it is an internal report.

## 6. Rollout, limits and gaps

* Migration `20270101000100` after `20261231000100`; guide `docs/projects-closeout-report-deployment.md`.
* The AI draft uses the existing provider configuration (`ANTHROPIC_API_KEY`, `JARVIS_PROVIDER`, `JARVIS_DISABLED`); it does not need the JARVIS pilot list. Without a provider only the facts-only draft is offered.
* **Not built:** a client-facing report; an event-edition field.
* **Owner decision open:** the original and final scope, exclusions, decision reasons and stated effects on dates are ticked by default on the review screen (shown, and removable); client words, our response and notes are not. If every free text should start unticked, it is a one-line change (`defaultOn` in E).
* **Verification gaps:** nothing signed in; no live Anthropic call (the real model's adherence to the instructions is `Unverified`); the generation service is unit-tested against a stand-in for the database functions, which are themselves tested on PostgreSQL (the call through the hosted API layer was not exercised); the PDF was rendered in tests, not opened by a person; the PDF shows no approver name when a founder who is not on the project's team approved. An independent review (2026-11-12) found thirteen points; ten were fixed in the same PR and are covered by tests, the rest are listed in this section and 5.2, 5.3.
