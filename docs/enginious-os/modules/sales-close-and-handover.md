# Sales: Close (Won, Lost) and handover

Status: written from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (`../README.md` stamp row "Sales & CRM app map completed"). **Code read only; nothing was run**, except what the 2026-11-08 write-rules and failed-read fixes changed (PR #68, merged as `ca3e4483ce4745e359ddb3377b52748175f3881f`; the Won date rule is in migration `20261222000100`, **applied on hosted V2 per the owner (owner-run verification, owner-reported 2026-11-09)**, guide [`../../sales-crm-write-rules-deployment.md`](../../sales-crm-write-rules-deployment.md); both were exercised on a throwaway local database and the local-stack walk-through `os-shell-checks/sales-crm-readiness-flow.mjs`). Conventions as in `../README.md`; `Unverified` marks what code reading could not confirm. The end-to-end flow (Won, handover, Project Manager, project, equipment, budget) is already mapped in [`../04-flows-sales-to-warehouse-and-others.md`](../04-flows-sales-to-warehouse-and-others.md) sections 1.2 and 1.3; this file adds the per-control tables and the exact list of rows each step writes, and links to that file instead of repeating the Projects and Inventory sides. Reopening a closed enquiry: [`sales-pipeline-and-stages.md`](./sales-pipeline-and-stages.md) section 3.5. Catalogue entries: [`sales-action-catalogue.md`](./sales-action-catalogue.md).

## 1. Close dialogs and the close page

Routes: the full page `/sales/opportunities/[id]/close?outcome=won|lost` (`opportunities/[id]/close/page.tsx`, `close-form.tsx`) and the same forms in a dialog from the side panel and the board (`CloseDialog`, `stage-actions.tsx`). The page shows "Already closed as won/lost" with the evidence and a link to the handover for a Won enquiry; "Only the owner (X) or a founder can close this opportunity" to others; otherwise the form. The page tells **four outcomes apart** (`loadOpportunityDetailResult`, `lib/crm/data.ts`): a missing (or invisible) enquiry is the not-found page; a refused read (permission error) says "You do not have access to this enquiry, so it cannot be closed from here"; a failed read says "Could not load this enquiry ... Nothing was changed" with a Try again link that returns to the Close page, and **no close form is offered**; a successful read is the form. If only the follow-ups could not be read, the form is withheld too ("Closing cancels the open follow-ups, so the close form is not offered until they load"), because the form states how many it cancels. A failed read of any other section (files, proposals...) does not block closing.

| Control | What it does | Who | Starting state | Success / failure | Behind it | Catalogue |
|---|---|---|---|---|---|---|
| Outcome radio Won / Lost | Chooses the form. Won is disabled for an enquiry On hold ("Resume it first if it has been won; it can be marked Lost directly") | Owner or founder (`canEdit`) | Open enquiry | | `CloseBody` | |
| Won: Type of confirmation | Purchase order or Authorised email (`CRM_EVIDENCE_TYPES`) | same | Won needs a working stage (New enquiry to Negotiation): "Only an open opportunity (not on hold) can be marked Won" | Required | `crm_mark_won` | `sales.enquiry.mark_won` |
| Won: PO number / Email reference (sender and subject) | Required text | same | | "Won needs evidence: a purchase order or authorised email, its reference and its date" | same | same |
| Won: Date on the document | Required date; the form blocks a future date (`max` = today in Dubai, `todayInDubai()`). **The database now refuses it too** (`crm_mark_won`, migration `20261222000100`): a date after `crm_today_dubai()` (the Dubai day, the same boundary as the form; today is accepted) is refused with SQLSTATE `22023` "The date on the purchase order or email cannot be in the future", before any write (enquiry, closures, follow-ups, handover and timeline unchanged). Before the migration is applied on a database the check is the form's only | same | | | same | same |
| Won: Note (optional) | Appended to the event text | same | | | same | same |
| Won: confirmed value | Shown read-only ("Confirmed value"). A missing value shows a warning with "Open the full page and use Edit details", the submit still goes to the database which refuses: "Set the confirmed value before marking Won" | same | `value` must be set | | same | same |
| Confirm as won (submit) | `markWon` -> `crm_mark_won`; from a dialog the person stays where they are (`after=stay`), from the page they are returned to the enquiry | same | | Stale version: reload message | `apps/web/src/lib/actions/crm.ts:markWon` | same |
| Lost: Reason | Required choice: Budget lower than scope, Went with another supplier, Event cancelled, Timeline not feasible, Technology not available, No response from client, or "Other (write the reason)" with a required note (`CRM_LOST_REASONS`, `composeReason`); an optional note is appended after a colon | same | Any open stage including On hold | "A reason is required to mark an opportunity Lost" | `markLost` -> `crm_mark_lost` | `sales.enquiry.mark_lost` |
| Lost: statement | "The opportunity becomes read-only and the reason is kept for reporting. N open follow-up(s) cancelled." | | | | | |
| Confirm as lost | Destructive-styled submit | same | | | | same |

What each close writes:

| Close | Rows and columns changed |
|---|---|
| Won (`crm_mark_won`) | `crm_opportunities`: `stage = won`, `stage_changed_at`, `evidence_type`, `evidence_reference`, `evidence_date`, `stage_before_close`, `closed_at`, `closed_by`, `version + 1`. New `crm_closures` row (`outcome won`, `closed_from_stage`, `value_at_close`, currency, evidence). Every open `crm_follow_ups` row of the enquiry becomes `cancelled`. An **empty** `crm_handovers` row (`status draft`) unless one exists from before an earlier closure (kept as it was). Event `won` with "<evidence type>: <reference> — <note>" |
| Lost (`crm_mark_lost`) | `stage = lost`, `lost_reason`, `stage_before_close` (the stage it was held from if it was On hold), hold fields cleared, `closed_at`, `closed_by`, `version + 1`; `crm_closures` row (`outcome lost`, reason); open follow-ups `cancelled`; event `lost` |

No notification, no e-mail, no project and no equipment request is created by closing. A Won enquiry is then read-only apart from the handover, files, proposal acceptance, contacts and (for a founder) the value (`editMode`, `canChangeOpportunityContacts` in `view.ts`).

Evidence files: a purchase order or authorised-email document can be attached as a file or link with that purpose (`sales-enquiries.md` section 4.4); it is not required to mark Won and its absence shows as a handover "gap" (`buildHandoverPackage`, `opportunities/[id]/helpers.ts`).

Reports count a Won enquiry as won only with evidence recorded (`isCommerciallyWon`; `sales-reports.md`).

## 2. Handover page (`/sales/opportunities/[id]/handover`, `handover/page.tsx`)

Reached from the "Handover package" button, the Won prompt (`WonHandoverPrompt`, which reads the Projects handover status and says "Prepare the handover now", "Answer it", "Handover submitted. Delivery has it.", "Handover accepted: the project exists." or "Could not check the handover."), and a Sales row on Follow-ups (`HandoverAttention`). Any Sales grant can open it; changes need the owner or a founder. **Failed reads** (same four outcomes as the Close page): the enquiry itself unreadable shows "Could not load this enquiry" and **no save, submit or process step**; a failed read of the Projects handover (`loadProjectHandover` now reports `failed`, no longer "not installed" or "nothing prepared yet") shows "Could not load the project handover" with no Save, Submit or Withdraw; the Sales-side handover row, the proposals, files, contacts and Zoho references that fail each show their own "Could not load" (the checklist of gaps is then not shown as complete).

States of the page:

| Enquiry state | What the page shows |
|---|---|
| Not Won, no handover record | "A handover package can only be prepared once the opportunity is Won, with a purchase order or authorised email on record." |
| Not Won (reopened), a handover record exists | The record is shown read-only "kept as it was" (status, Project Manager, notes) with the reopen notice; nothing can be changed until it is Won again |
| Won | Progress, "N gaps to resolve before this is complete" list, the Project handover panel (below), the package summary (accepted scope, accepted proposal, confirmation of the win, promised technologies and the availability check, dates and place, money and payment including Zoho references "entered by hand", contacts, unresolved risks) and the line "Won <date>. To correct something in this package, change it on the opportunity" |

The "gaps" list is built from facts on the enquiry (`buildHandoverPackage`): availability needs a recheck / is unavailable / not confirmed; no accepted proposal; scope not written down; payment terms not recorded; no contacts linked; no installation or show dates; no technologies listed; no purchase-order or authorised-email file or link attached. Gaps do not block saving or submitting (only an empty scope does, section 3).

### 2.1 Two handover records (current and legacy)

| Record | Table | Status values | Screen | Live? |
|---|---|---|---|---|
| Project handover (Projects & Tasks) | `proj_handovers` | `draft, submitted, pm_assigned, clarification_requested, accepted, withdrawn` (`20261120000100_proj_core_tables.sql`) | The "Project handover (Projects & Tasks)" panel on this page; assignment and acceptance on `/projects/handovers` | **The live path** when Projects & Tasks is installed (`loadProjectHandover` treats a missing table or function as "not installed") |
| Sales-side handover | `crm_handovers` | `draft, ready, handed_over` | The "Project Manager and status" form (`handover-form.tsx`, `updateHandover` -> `crm_update_handover`) | **Only when Projects & Tasks is not installed** (`!projectHandover.installed`). Otherwise the page shows it as "Earlier Sales-side handover record (kept for history)", read-only. This answers the open question in `04` section 1.2 ("whether the CRM-side row still drives any screen"): it drives only that fallback form and the history block |

`crm_update_handover` (`20261115000300_crm_proposals_files_reminders.sql`): owner or founder; enquiry must be Won ("Handover is only available once the opportunity is Won"); status `draft`, `ready` or `handed_over`; `handed_over` needs a Project Manager who is an active user; sets `prepared_by`, `prepared_at`, `handed_over_at`; event `handover`. It notifies nobody and creates no project. Catalogue `sales.handover.update_legacy` (a fallback; not part of the live handover).

### 2.2 Project handover panel (`project-handover.tsx`, `project-handover-forms.tsx`)

| Control | What it does | Who | Starting state | Failure | Behind it | Catalogue |
|---|---|---|---|---|---|---|
| Delivery brief form: Project name (max 200), Client (blank = the client or agency name from the enquiry), Location, Site time zone (a list of common zones; suggested from the location, then the company's country, not always Dubai), Installation starts, Show starts, Show ends, Scope of work, Exclusions, Risks (one per line), Notes for the Project Manager, Technologies (free-text rows with a whole-number quantity) | A **member-safe delivery brief**: it is pre-filled from the enquiry's non-commercial facts and never reads or copies price, value, payment terms or evidence | Owner or founder (`proj_save_handover`: "Only the opportunity owner or a Sales founder can prepare its project handover") | Enquiry Won ("A handover can only be prepared for a Won opportunity"); a new row if none; editable while `draft`, `submitted` or `clarification_requested` ("This handover can no longer be edited (status: ...)") | Stale version ("version check"); unknown time zone ("Unknown time zone ...") | `saveHandover` / `saveHandoverCore` (`apps/web/src/lib/actions/projectsCore.ts`) -> `proj_save_handover` (`20261120000200_proj_projects_handover_functions.sql`) | `sales.handover.save_draft` |
| Save and submit / Save and resubmit to the Project Manager / Save draft | Saves exactly as above, then (unless "Save draft") submits with `proj_submit_handover`. If the submit is refused the brief stays saved as a draft and the message says so | Submit: the preparer, the sales owner, or a Sales founder ("Only Sales can submit the handover") | `draft` or `clarification_requested`; a repeated click on `submitted`, `pm_assigned` or `accepted` is a no-op (returns without change) | "Describe the scope of work before submitting the handover"; a `withdrawn` handover cannot be submitted | `saveAndSubmitHandover` -> `proj_submit_handover` | `sales.handover.save_and_submit` |
| Withdraw handover | Reason required. Marks `withdrawn` and appends "Withdrawn: <reason>" to the notes | Sales (preparer, owner, with Sales access) or a Projects founder (`proj_is_founder`) | Not `accepted`; `withdrawn` again is a no-op | "Give a reason for withdrawing"; "An accepted handover cannot be withdrawn" | `withdrawHandover` -> `proj_withdraw_handover` | `sales.handover.withdraw` |
| Open <project reference> | Link to the project once accepted | Whoever can open the project | | | | |

The standalone `submitHandover` action exists (`projectsCore.ts`) but no Sales control calls it (the combined action is used); not catalogued as a separate tool.

## 3. What a handover creates, step by step (verified from the SQL)

| Step | Function | Rows written | Notifications (in-app `notifications` rows via `proj_notify`; nothing is e-mailed) |
|---|---|---|---|
| Save | `proj_save_handover` | `proj_handovers` (first save: `company_id`, `crm_opportunity_id`, `crm_reference`, `prepared_by`, `sales_owner_id`, title, client, location, site time zone, dates, technologies, scope, exclusions, risks, notes; later saves update and bump `version`) | none |
| Submit | `proj_submit_handover` | `proj_handovers.status = submitted` (or `pm_assigned` if a Project Manager is already named), `submitted_at`, `revision + 1`, `version + 1` | No Project Manager yet: `project_handover_submitted` to every active founder and `assign_pm` holder of the Projects company (never to the submitter). A Project Manager already named: `project_handover_resubmitted` to that person |
| Assign Project Manager (Projects) | `proj_assign_handover_pm` | status `pm_assigned`, `pm_user_id` | `project_handover_assigned` to the Project Manager. Documented in `04` section 1.2 row 10 |
| Ask a question (Projects) | `proj_request_handover_clarification` | status `clarification_requested`, note | `project_handover_clarification` to the Sales owner and the preparer. The owner sees it on the enquiry and Follow-ups |
| Accept (Projects) | `proj_accept_handover` (only the assigned Project Manager; the enquiry must still be Won; one project per enquiry) | `proj_projects` (`kind client`, `status planning`, reference from `proj_next_reference`, name = brief title, dates from the brief, `crm_opportunity_id`, `handover_id`), `proj_project_details` (client name, location, site time zone, dates, scope, exclusions, technologies, risks), `proj_project_members` (the Project Manager, role `pm`), `proj_sales_links` (the sales owner `handover_owner`, and the preparer `handover_preparer` if different), `proj_handovers.status = accepted` with `accepted_by`, `accepted_at`, `project_id` | `project_handover_accepted` to the sales owner and the preparer |
| After the project insert | trigger `inv_proj_projects_import` -> `inv_proj_after_insert` (`20261201000400_inv_planning_functions.sql`) | For a client project, a **draft equipment request** is imported from the handover's technologies (a failure is logged and never blocks acceptance, per `04` section 1.3) | none found |

What accepting does NOT create (from the function text): no tasks, no budget rows, no calendar entries, no CRM rows. The project budget is drafted later by the Project Manager (`04` section 1.3, `pbx_*` functions). Per the same file, the Sales side later sees the project through the Sales link and the Completed projects count on the account page (`sales-clients-and-agencies.md` section 4.2).

Project Manager assignment, acceptance and the Projects screens are the Projects module's: they are not catalogued in the Sales catalogue (`sales-action-catalogue.md` lists them under "Projects-side actions triggered from this flow").

## 4. Tests

`apps/web/src/app/(app)/sales/opportunities/[id]/closure-helpers.test.ts`, `close/page.test.tsx`, `section-failures.test.tsx`, `apps/web/src/lib/crm/detail-result.test.ts`, `handover/page.test.tsx`, `handover/project-handover.test.tsx`, `handover/project-handover-forms.test.tsx`, `apps/web/src/lib/crm/handover-attention.test.ts`, `handover-attention-data.test.ts`, `apps/web/src/components/sales/won-handover-prompt.test.tsx`, `apps/web/src/lib/actions/projectsHandover.test.ts`, `apps/web/src/lib/actions/crm.test.ts`; RLS `packages/rls-tests/test/crm.rls.test.ts`, `crm-sales-write-rules.rls.test.ts` (Won date, no side effects on refusal); browser flows `apps/web/os-shell-checks/sales-actions.mjs`, `sales-crm-readiness-flow.mjs` (Won with a valid PO, Sales save and submit, founder assigns, only the assigned PM accepts, one project, provoked failed reads) and the Projects flows listed in `apps/web/os-shell-checks/README.md`. None run in this pass; assertions not re-read (`Unverified`).

## 5. Observations

1. **Fixed (migration `20261222000100`, applied on hosted V2 per the owner (owner-run verification, owner-reported 2026-11-09)):** the Won "date on the document" was validated as not-future only in the form; `crm_mark_won` now refuses it too (section 1).
2. `proj_submit_handover` treats a repeat on `submitted`, `pm_assigned` or `accepted` as success without change; `proj_accept_handover` on an already accepted handover returns the same project to the assigned Project Manager. These are the only idempotent steps of the handover flow.
