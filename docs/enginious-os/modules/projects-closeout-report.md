# Projects & Tasks: Project Closeout Report

Part of the Projects & Tasks Map: [coverage index](./projects-coverage-index.md) (section 8) and [action catalogue](./projects-action-catalogue.md) (section 10).

Status: written with Projects & Tasks Phase 2, part 2 (branch `claude/admiring-cray-uky379`, PR #84 together with the Delivery Plan, merged; see the release status below). Written by the author of the code against the files cited. The database rules are proven on a real PostgreSQL (`packages/rls-tests/test/proj-closeout-reports.rls.test.ts`); the evidence allowlist, the outbound payload, the checks on the provider's answer, retry and failure by unit tests with the **simulated** provider (`apps/web/src/lib/projects/closeout/closeout.test.ts`); the screen and the PDF by unit tests and a temporary browser page with fictional data. **Nothing was checked signed in. No request was sent to Anthropic.** Migration `20270101000100_proj_closeout_reports.sql` (install-order row 29): applied on hosted, owner-reported.

**Release status (2026-11-12):** merged to `main` in PR #84, merge commit `e12c22f` (checked on GitHub); required CI `lint-typecheck-test` and `rls-policies` green on the exact head `4ca6da3` (read from GitHub); migrations 28 and 29 applied on the hosted database with their preflight and verify packs, and the signed-in Preview tests passed (**owner-reported**, 2026-11-12; Claude ran no hosted SQL); Production: Vercel deployed the merge commit `e12c22f` successfully and the signed-in smoke checks of the Delivery plan and the Closeout report both passed (**owner-reported**, 2026-11-12; Claude cannot see the deployment or sign in to Production). A live Anthropic call for the closeout draft remains `Unverified`. The wording above about what was verified describes the work as it was written (history).

Sources: `supabase/migrations/20270101000100_proj_closeout_reports.sql` (M); `apps/web/src/lib/projects/closeout/evidence.ts` (E), `report.ts` (R), `claims.ts` (C), `claim-cases.json`, `service.ts` (S), `fixture.ts`; `apps/web/src/lib/actions/projectsCloseout.ts` (A); `apps/web/src/app/(app)/projects/[id]/closeout/page.tsx`, `closeout/[reportId]/pdf/route.tsx`; `apps/web/src/components/projects/closeout/closeout-workspace.tsx`; `apps/web/src/lib/pdf/closeout-document.tsx`; the outbound gate and rulebook `apps/web/src/lib/jarvis/outbound.ts`, `rulebook.ts` (`APP_AI_RULES`), `provider/simulated.ts`; owner packs `supabase/manual-sql/proj_closeout_reports_*`.

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

**The event edition (changed by Projects & Tasks Phase 2B; branch `claude/projects-phase-2b-operations`, not merged; migration `20270102000100` not applied by Claude, hosted `Unverified`).** Until that migration is applied the handover and the project hold no structured edition, and the evidence says "Event edition: not recorded." Once it is applied, the function installed by `20270101000100` is kept as `proj_closeout_evidence_base` and wrapped: when the project's details hold an edition (the copy taken at the handover), the snapshot gains `project.edition` with the label, event name, venue, city and the published start and end dates, and nothing else changes; a project without an edition gets exactly the earlier snapshot, with no `edition` key (`supabase/migrations/20270102000100_ops_phase2b.sql` section 8; verify pack row 12). The evidence then carries one line of its own, "Event edition: <label>. Venue: <venue>. Published show dates: <dates>.", or "Event edition: not recorded." when the project has none, and the handover line no longer says "not recorded as a field; see the handover notes if selected" (`apps/web/src/lib/projects/closeout/evidence.ts`, `evidenceItems`; tests in `closeout.test.ts` and `ops-phase2b.rls.test.ts`). The edition is a copy: a later edit to the event in Sales does not change it. **Projects accepted before the migration stay without an edition**, so their reports keep saying it is not recorded. Reference: [`operations.md`](./operations.md) section 8.1.

## 4. From snapshot to what may be sent (E)

`evidenceItems(snapshot)` turns the snapshot into **lines**, each with a reference (`S1`, `S2`, ...), a category, and the record it comes from. It is a second allowlist: it names every value it emits, so a field added to the snapshot later is not sent unless this file changes (test: planted `budget`, `salary`, `phone`, `unit_price`, user ids are absent from the payload).

* **Facts** (always part of the evidence): project, dates, statuses, counts, names and roles, who decided what and when, that feedback was recorded and its status, milestones, plan lines with their linked task or equipment state, the completion and sign-off lines, equipment sent, returned and still out.
* **Optional text** (free text a person wrote). **Every one starts unticked** and is sent only when the Project Manager ticks it: original and final scope wording, original and final exclusions, a decision's recorded reason, a written effect on dates, the client's words, our response, the completion note and the handover notes. Without a tick the evidence still carries the structured fact (that the scope differs, that a change was approved, by whom and when, that a reason is recorded, that feedback was received and resolved).
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

Shown before anything is written. It shows the **source categories** with their line counts, what is never included, the **team members named**, every **optional text** with a tick box (all unticked to begin with), what the data policy withheld, anything that could not be read, anything cut for size, and **"Show the exact evidence that would be sent"**: the whole outbound text, line for line, which changes as boxes are ticked. Above the buttons: **"Generating sends the reviewed content above to Anthropic"**, with what does not happen (nothing to the client, no completion, no work or stock change).

| Control | What it does |
|---|---|
| Tick boxes on optional text | Opt in to that text (nothing is ticked to begin with). The fingerprint and the exact evidence shown change with the selection. Screening still applies: a ticked text with protected details, a contact detail or an amount of money stays withheld. |
| **Send to Anthropic and write the draft** | `generateCloseout` (A) with mode `ai`. Not offered when no provider is set up; the reason is shown. |
| **Write a facts-only draft (nothing is sent)** | `generateCloseout` with mode `facts`: the draft is the evidence lines themselves, grouped by section. No provider call. |
| **Back to the draft** | Only when a draft exists. Writing again replaces the draft, including edits; the screen says so. |

The browser sends only the project id, the selected keys, the mode and the fingerprint. The server takes the evidence again (S: `generateCloseoutDraft`), rebuilds the text, and refuses if its fingerprint differs from the one reviewed ("The project's records changed since you reviewed"). The database then refuses the save unless the snapshot the report was written from equals the one it takes itself at that moment (M: `proj_closeout_save_draft`), so a caller cannot supply evidence and a stored report always rests on the snapshot stored with it.

### 5.2 The provider call

One request, through `gateProvider(provider, "projects.closeout.draft")`: source `project_closeout_evidence`, the evidence as record text, a fixed instruction text (R: `CLOSEOUT_INSTRUCTIONS`, at most 3 paragraphs of 70 words per section), at most 4,000 output tokens, a 45 second limit.

**One call per project and exact reviewed content, decided in the database before anything is sent** (M: `proj_closeout_claim`, under a lock on the project row; S calls it, then `proj_closeout_finish`). For the fingerprint of the reviewed content it answers one of:

| Answer | Meaning | Sent? | Counts toward the limit? |
|---|---|---|---|
| `claimed` | This request may make the one call | Yes, once | Yes |
| `in_progress` | Another request claimed the same content less than three minutes ago and has not finished (two tabs, a double press) | No | No |
| `done` | A result for exactly this content is stored; it is checked again against the current records and saved as the draft | No | No |
| `limit` | The project has used today's calls | No | No |

**The daily limit is 10 provider calls per project per day (Dubai)** (S: `CLOSEOUT_DAILY_LIMIT`), enforced in the database. Counted: every claim that leads to a call, whether the call succeeds, fails or returns something unusable. Not counted: a stored result being reused, a request refused as in progress or over the limit, a facts-only draft, saving edits, approving, downloading.

* **Failure, timeout or an unusable answer:** the message says nothing was saved and to try again. The claim is marked failed, so the same content can be tried again (and counts again). No draft is written, so a retry cannot leave a second version.
* **Same content again:** if the current draft already holds the generated result for exactly this fingerprint it is returned untouched, edits included. Otherwise the stored result is reused: this covers writing a facts-only draft over the AI draft and then choosing AI again with identical content. What is stored is the answer reduced to its own fields (section ids, paragraph text, references), readable by the project's managers only.
* **Records changed while writing:** if the change is to something that is not part of the reviewed content, the answer is checked again against the fresh records and saved (nothing is sent twice); if the reviewed content itself changed, nothing is saved and the Project Manager reviews again.
* **One draft per project** (unique index): writing again updates it.

### 5.3 Checks on the answer (R)

Only `sections[].id` and `sections[].paragraphs[].{text, refs}` are read; anything else the model returned is ignored. A reference that was not sent is dropped. A paragraph containing protected details is left out and counted.

| Mark | Meaning | Effect |
|---|---|---|
| `signoff_unrecorded` | Says, directly or by implication, that the client signed off, accepted or approved, when no client sign-off is recorded | **Stops approval** (database) |
| `completion_unrecorded` | Says the project itself was completed or closed, when no completion record exists | **Stops approval** (database) |
| `equipment_out` | Says the equipment is back when some is recorded as still out | **Stops approval** (database) |
| `unverified_quote` | Quoted words that are nowhere in the project's recorded text (the snapshot) | **Stops approval** (database) |
| `unverified_figure` | A number or date that is not in the lines the paragraph cites | To check; the Project Manager ticks that they checked |
| `no_source` | A factual paragraph that cites nothing | To check |
| `suggestion` | A lesson suggested by the model | Shown as a suggestion |

**Where the stopping marks are enforced.** In the database: `proj_closeout_approve` computes them itself (`proj_closeout_blocks`, `proj_closeout_text_blocks`) from two things only, the paragraph text stored in the draft and the snapshot stored with it, and refuses approval while any remains. Marks and source references sent by a caller take no part, so saving a draft or an edit with an empty list of marks does not clear a block; a block clears when the sentence is reworded, or when the record exists and a new draft is taken. This holds when the function is called directly (database test: five blocked sentences saved with no marks through both the edit path and the draft-save path, each refused; the reworded draft approved). The screen shows the same marks, computed again on every load from the stored text and snapshot, and the server action refuses first with the same rule. The "to check" marks (`unverified_figure`, `no_source`) and the tick are enforced by the server action only.

**One set of patterns.** The word patterns are in `claims.ts` (C) and are installed in the database character for character (a unit test compares the migration with C). `claim-cases.json` holds 47 sentences with the marks expected for each; the app test and the database test both run it.

**Limits of the narrative checks (they are word patterns, not understanding).** They read one sentence at a time and lean towards marking too much: a sentence that names the client next to "accepted", "approved", "signed", "confirmed the handover" or "satisfied with the result" is marked even when it is about something else, and is cleared by rewording. They do not catch: a claim spread over two sentences; implication without the words ("we left on very good terms", "they shook hands and thanked the crew"); numbers written as words; a wrong figure whose digits happen to occur in a cited line; indirect speech that reports the client without quotation marks; other languages. An installation or a task being finished is not treated as the project being completed. For that reason completion, client sign-off and equipment return are never taken from the narrative: see Recorded facts.

### 5.4 The draft

**Recorded facts are the authority; the narrative is not.** Recorded facts (R: `keyFacts`, a function of the snapshot alone) are computed from the snapshot stored with the report and shown above the narrative on screen and in the PDF, with the sentence that they stand where the narrative differs: project, client and venue, event dates, status, completion, client sign-off, approved scope changes, tasks, client feedback, equipment. They are not editable, so the report always states that a sign-off is not recorded or that equipment is still out, whatever the narrative says.

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
* **Not built:** a client-facing report. (The event-edition field is built by Phase 2B, on a branch that is not merged: section 3.)
* **Owner decisions applied (2026-11-12):** every optional free text starts unticked; approval is enforced in the database; one provider call per project and reviewed content; the event edition stays explicitly not recorded until there is a structured source (Phase 2B adds that source: section 3).
* **Follow-up, not in this PR:** the PDF shows no approver name when a founder who is not on the project's team approved.
* **Verification gaps:** nothing signed in; no live Anthropic call (the real model's adherence to the instructions is `Unverified`); the generation service is unit-tested against a stand-in for the database functions, which are themselves tested on PostgreSQL (the call through the hosted API layer was not exercised); the PDF was rendered in tests, not opened by a person. An independent review (2026-11-12) found thirteen points; ten were fixed at once and the owner's four follow-up points (database-enforced approval, the atomic claim, unticked optional text, authoritative facts) in the next commit, all covered by tests.
