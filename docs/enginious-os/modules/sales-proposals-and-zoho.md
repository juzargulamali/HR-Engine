# Sales: Proposals, commercial controls and Zoho Books references

Status: written from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (`../README.md` stamp row "Sales & CRM app map completed"). **Code read only; nothing was run.** Conventions as in `../README.md`; `Unverified` marks what code reading could not confirm. Estimates (the in-app builder, finalise, PDF and Excel) are NOT repeated here: see [`sales-estimates-and-quotations.md`](./sales-estimates-and-quotations.md). Stage gates that use proposals and Zoho references: [`sales-pipeline-and-stages.md`](./sales-pipeline-and-stages.md) section 3.2. Catalogue entries: [`sales-action-catalogue.md`](./sales-action-catalogue.md).

Three separate facts are kept apart on purpose and the screens say so: a proposal **sent** (a dated fact entered by the owner), **commercial approval** (an internal founder decision), and **won** (a purchase order or authorised e-mail). None implies another (`proposals-panel.tsx`, `commercial-panel.tsx`, `overview-panel.tsx`). **This system sends nothing to a client** from any of these controls (text in `proposal-forms.tsx`: "This system does not send anything").

## 1. Proposal versions (enquiry page > Proposals & files, `proposals-panel.tsx`, `proposal-forms.tsx`)

A proposal here is a `crm_proposals` row (`version` assigned by the database, `note`, optional `file_id`, `status`, `sent_on`). There are two kinds: the note-and-file version of this section (legacy proposals built elsewhere, for example Canva or Word, and kept as a recorded file or link) and **estimates** built in the app, which appear in the same list but are labelled and restricted (section 1.2).

| Control | What it does | Who | Starting state | Success / failure | Behind it | Catalogue |
|---|---|---|---|---|---|---|
| Proposal versions list | Newest first: "Version N", badge (Draft, Sent, Accepted, Superseded; for an estimate "Estimate, draft" or "Estimate, finalised"), "Latest sent" badge, note, document line, added by and date, "recorded as sent on" | Any Sales grant reads | Failed read of the estimate marks: "Could not load the proposal versions" with Try again (never a list that hides which rows are estimates) | `loadEstimateMarks` (`lib/crm/data.ts`) throws on error | | |
| Add version N as a draft (What changed, Proposal document) | Records the next version as a draft. The document is chosen from files or links already added under Files (offered if not yet linked to another version; Proposal-purpose files first). Nothing is sent | Owner or founder of the enquiry; shown only while the enquiry is open | Enquiry not Won/Lost ("A closed opportunity cannot get new proposals") | The file must belong to this enquiry ("That file does not belong to this opportunity") | `addProposal` -> `crm_add_proposal` (`20261115000300_crm_proposals_files_reminders.sql`); event `proposal` "vN draft" | `sales.proposal.add_version` |
| Record as sent | Dialog: Date it was sent (required, not in the future; default today in Dubai). Becomes `sent` with `sent_on`; **any earlier version that was `sent` becomes `superseded`**. "It is not an approval and not a win" | Owner or founder | Version must be `draft` (or already `sent`); a closed enquiry is refused; **never offered for an estimate** | "Give the date it was actually sent (not in the future)"; "Only a draft proposal can be recorded as sent" | `setProposalStatus` -> `crm_set_proposal_status` | `sales.proposal.record_sent` |
| Record as accepted | The client said they accept this version. Does not make the enquiry Won | Owner or founder | Version must be `sent`; allowed even on a Won enquiry (the only change a closed enquiry accepts); not on Lost | "Only a sent proposal can be recorded as accepted" | same | `sales.proposal.record_accepted` |
| Mark superseded | A newer version replaces this one; stays as history | Owner or founder | Any non-closed enquiry; offered for draft or sent versions. The database does not check the starting status of a `superseded` change | | same | `sales.proposal.supersede` |
| Warning line | "No founder approval on record for this opportunity. Recording a proposal as sent is not an approval." shown on the latest sent version when the company policy is `required` and the latest approval is not `approved` | | | | `proposalActions` (`helpers.ts`) | |
| Non-owner note | "Only the owner (X) or a founder can add or change proposal versions." | | | | | |

`proposalActions(p, stage)` (`opportunities/[id]/helpers.ts`) is the UI mirror of what the function allows: Lost: nothing; Won: only Accept for a `sent` version; open: Send for `draft`, Accept for `sent`, Supersede for `draft` or `sent`. `helpers.test.ts` (same folder) is the related test.

### 1.1 The cross-page list `/sales/proposals` (`apps/web/src/app/(app)/sales/proposals/page.tsx`)

Secondary (search only, reached from the Enquiries "Shared lists" menu): every proposal version across the enquiries the person can read (newest 500), with filter chips All, Draft, Sent, Accepted, Superseded and counts; columns Opportunity (link, reference, company if several), Version, Status (estimates labelled "Estimate, draft/finalised"), Sent ("Estimates are not recorded as sent" for an estimate), File or link (https link opens in a new tab; a stored file opens through a 60-second signed link, `proposal-file-link.tsx` -> `getCrmFileUrl`), Owner. Read-only: no action on this page. A failed read throws (`loadProposals` uses `ok()`), landing on the generic segment error page rather than "Could not load" (see `sales-enquiries.md` section 8, observation 1).

### 1.2 Estimates in the proposal list and the database guard

* An estimate is a proposal row with an extension row in `crm_quotations` (every estimate and every legacy quotation). It is labelled "Estimate" (draft or finalised) and has **no "Record as sent"** (`proposals-panel.tsx`: `actions = { ...base, send: false }`).
* The app refuses first: `setProposalStatus` checks `crm_quotations` and refuses with "This version is an estimate. An estimate is never recorded as sent. Record the proposal you actually sent to the client instead."; if the check itself fails: "Could not check whether this version is an estimate, so nothing was recorded. Try again." (fails closed).
* The database refuses second: trigger `crm_proposals_estimate_sent_guard` calls `crm_estimate_sent_guard()` (`20261221000100_crm_estimates_only_guards.sql`, errcode `EST01`: "An estimate cannot be marked as sent. Send official quotations from the Zoho Books workflow."), including a direct call of `crm_set_proposal_status` and a direct table update. Because the call is one transaction, the refusal also rolls back the side effect of superseding the proposal really sent, so an estimate cannot unlock the Proposal sent stage. Not blocked: draft to superseded, an update that leaves `sent` as it is (legacy quotations recorded as sent earlier), updates that do not touch status. **`accepted` is not guarded** (owner decision still open: `sales-estimates-and-quotations.md` section 4). Test: `packages/rls-tests/test/crm-estimates-only-guards.rls.test.ts`.
* Approval of an estimate is requested and decided on the estimate page and is bound to its exact content hash (`crm_quote_request_approval`, `crm_quote_decide_approval`, trigger `crm_approvals_quote_guard`); a quotation approval cannot become `approved` through the generic decide function. Catalogue `sales.estimate.*`; builder detail in the Estimates reference.

## 2. Commercial tab (`commercial-panel.tsx`, `commercial-forms.tsx`, `quick-actions.tsx`)

Three sections that are never merged into one "confirmed".

### 2.1 Equipment availability

A dated check that the technology is free for these dates and quantities. **Not** a stock reservation and **not** the client's confirmation. States: not checked, awaiting, available, unavailable, needs repeating (`availabilityDisplay`, `packages/domain`; `crm_availability_needs_recheck`). The check stores what it covered (installation, show dates, technologies) in `availability_covers`; changing any of them afterwards shows "Needs repeating".

| Control | What it does | Who | Starting state | Failure | Behind it | Catalogue |
|---|---|---|---|---|---|---|
| Request availability check / Request a new availability check | Sets `availability_state = awaiting`, requester and time; event `availability` | Owner or founder (`crm_require_owner_or_founder`); hidden while already requested ("Already requested.") | Enquiry open | "A closed opportunity needs no availability check" | `requestAvailability` -> `crm_request_availability` | `sales.availability.request` |
| Record the check / Record a new check | Dialog: Result (Available for these dates and quantities / Not available), Note (required: what was checked or the alternative). Stores state, who, when, note and what it covered | `confirm_availability` capability (founder implies it). **The owner cannot on their own** ("Only a founder, or someone they gave the permission to, can record the result") | Enquiry open | "Add a note: what was checked, or the alternative if unavailable" | `confirmAvailability` -> `crm_confirm_availability` | `sales.availability.record_result` |

Warehouse side: the enquiry side panel also shows a "Warehouse stock check" card (Inventory's; `04-flows-sales-to-warehouse-and-others.md` section 1.1 row 4). **Unverified here**: whether the warehouse's `inv_record_opportunity_check` writes the same columns; it belongs to the Inventory reference (not yet written).

### 2.2 Commercial approval

| Policy (`crm_company_settings.approval_policy`) | What the screen says | What the database allows |
|---|---|---|
| `not_configured` (default) | "The founders have not set a commercial approval rule ... so nothing can be requested or approved." | Request and decide both refuse ("Commercial approval rules are not configured for this company. Nothing can be approved yet.") |
| `not_required` | "The founders decided commercial approval is not required ... Nothing here counts as approved." | Request refuses ("The founders decided commercial approval is not required for this company"); decide refuses |
| `required` | Request button, pending box, history of requests | As below |

| Control | What it does | Who | Starting state | Failure | Behind it | Catalogue |
|---|---|---|---|---|---|---|
| Request approval from a founder / Request approval again | Creates a `crm_approvals` row `pending`, bound to the newest proposal version if there is one; event `approval` "requested" | Owner or founder | Policy `required`; no other pending request ("An approval request is already waiting for a decision"); a proposal passed must belong to the enquiry | as listed | `requestApproval` -> `crm_request_approval` | `sales.approval.request` |
| Decide (Approve / Ask for changes) | Records the decision under the founder's name and time; "Ask for changes" needs the instruction | **A Sales founder only** (`crm_is_founder`; `canDecideApproval`); everyone else sees "Only a founder can decide." | Request is `pending` ("This request has already been decided") | "Say what needs to change"; policy no longer `required` | `decideApproval` -> `crm_decide_approval` | `sales.approval.decide` |
| Requests so far | List with state badge (Waiting for a founder's decision, Approved, Changes requested), proposal version, who and when, instruction | Any Sales grant | | | | |

The same approvals appear for founders on My Day ("Commercial approval waiting for your decision", `lib/my-day/attention.ts` `commercialApprovalCandidates`, per `04-flows-sales-to-warehouse-and-others.md` section 1.1 row 6). Notifications to the requester or e-mail: none found in these functions (`Unverified` beyond the functions read).

### 2.3 Zoho Books references (`ZohoSection`, `ZohoForm`)

**Zoho Books is not connected to this system.** The panel says so: "References entered by hand. Zoho Books remains the accounting record: this system does not read from it or write to it." No Zoho API host (`zoho.com`, `zohoapis`) and no `ZOHO_` setting appears anywhere under `apps`, `packages` or `supabase` (grep at this commit); the code mentions Zoho only as table, column and label names (`crm_zoho_references`, `apps/web/src/types/crm.ts`, the panels). The earlier map said the same (`04-flows-sales-to-warehouse-and-others.md` section 1.1 row 5). Whether the **hosted Zoho Books** account has a matching quote or invoice: `Unverified` (hosted and outside the app).

| Field (`crm_zoho_references`, one row per enquiry) | Meaning | Validation |
|---|---|---|
| Quote reference (Zoho Books) | The quote number typed in. **A non-blank value is the only thing that unlocks the move to Quote sent** (`crm_move_stage`) | Free text, trimmed; blank clears it |
| Quote sent on | Date | `YYYY-MM-DD` |
| Invoice reference, Invoice issued on | Typed from Zoho Books | same |
| Payment received on, Amount paid (in the enquiry's currency) | Typed from Zoho Books; amount zero or more | `optionalNumber`, `numeric` |

| Control | What it does | Who | Starting state | Behind it | Catalogue |
|---|---|---|---|---|---|
| Save references | Upserts the whole row: **every field is overwritten by what is in the form** (a blank field clears the stored value). Updated by and time shown | Owner or founder (`crm_require_owner_or_founder`) | The form is hidden on a Lost enquiry (read-only list) but the function itself has **no stage check** (a direct call works on any stage, including Lost and Won) | `saveZohoReference` -> `crm_upsert_zoho_reference` | `sales.zoho.save_references` |
| Read-only view | Three numbered facts: Quote sent, Invoice issued, Payment received, "Not recorded" when blank | Anyone else with a grant | | | |

Where else the references show: Reports "Won value against invoice and payment references" and the account page Quotes block (`reports/page.tsx`, `lib/crm/clients-agencies/account.ts`), always as manual references.

What the Quote sent gate does NOT check: that the quote exists in Zoho, that its number is well formed, or that a proposal was recorded as sent (those are different gates). Saving the references changes no stage; the stage move is a separate action.

## 3. Tests and browser flows (existing, not run in this pass)

`apps/web/src/lib/actions/crm.test.ts`, `proposal-estimate.test.ts` (`apps/web/src/lib/actions/`), `helpers.test.ts` (opportunity folder), `packages/rls-tests/test/crm.rls.test.ts`, `crm-estimates-only-guards.rls.test.ts`, `crm-quotations.rls.test.ts`; browser flows `apps/web/os-shell-checks/sales-actions.mjs`, `quotations-flow.mjs`. What each asserts was not re-read in this pass (`Unverified`).

## 4. Observations (reported, not changed)

1. `crm_upsert_zoho_reference` has no stage check and overwrites all fields; the UI hides the form only on Lost. A worker or direct call could clear the quote reference of an enquiry already past Quote sent without moving the stage back.
2. `crm_set_proposal_status` for `superseded` does not check the starting status (any proposal of an open enquiry, including an already accepted one, can be marked superseded by the owner or a founder). The UI offers it only for draft and sent versions.
3. The Zoho quote reference gate is satisfied by any non-blank text.
