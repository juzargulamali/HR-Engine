# Sales & CRM coverage index

Status: built from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (`../README.md` stamp row "Sales & CRM app map completed"). It lists every reachable Sales & CRM screen, tab, dialog, redirect and download, who can reach it, where its detailed reference is, and which action-catalogue entries belong to it ([`sales-action-catalogue.md`](./sales-action-catalogue.md)). **Status values:** `Documented` = a per-control reference exists and was checked against the code at the stamped commit (code read; no screen was run, nothing hosted was touched); `Documented, with named verification gap: <gap>` = documented, plus one thing that code reading cannot confirm. Completion check: every reachable Sales & CRM screen has a detailed reference or a named gap (section 2). Reachability was reconciled against the route files under `apps/web/src/app/(app)/sales/**` and `apps/web/src/app/api/sales/**`, `apps/web/src/app/api/cron/crm-reminders/route.ts`, `apps/web/src/components/nav/nav-groups.ts`, `apps/web/src/app/(app)/sales/layout.tsx`, `apps/web/next.config.ts` and `apps/web/src/proxy.ts`.

Reference files (all under `docs/enginious-os/modules/`): [`sales-enquiries.md`](./sales-enquiries.md) (E), [`sales-followups.md`](./sales-followups.md) (F), [`sales-pipeline-and-stages.md`](./sales-pipeline-and-stages.md) (P), [`sales-proposals-and-zoho.md`](./sales-proposals-and-zoho.md) (Z), [`sales-close-and-handover.md`](./sales-close-and-handover.md) (H), [`sales-reports.md`](./sales-reports.md) (R), [`sales-settings.md`](./sales-settings.md) (S), plus the two earlier references [`sales-clients-and-agencies.md`](./sales-clients-and-agencies.md) (C: accounts, import and export, outreach) and [`sales-estimates-and-quotations.md`](./sales-estimates-and-quotations.md) (Q). Flows across modules: [`../04-flows-sales-to-warehouse-and-others.md`](../04-flows-sales-to-warehouse-and-others.md).

Who can reach: "Sales grant" = any active `crm_company_grants` row (`sales/layout.tsx`; no grant shows the access notice; unreadable grants show "Sales & CRM could not load"). "Owner or founder" = the enquiry's owner or a Sales founder of that company. Capabilities are `packages/domain/src/permissions/crm.ts`.

## 1. Menu and shell

| # | Screen / trigger | URL or trigger | Who can reach it | Reference | Catalogue | Status |
|---|---|---|---|---|---|---|
| 1 | Sales shell: access notice, load-failure notice, tab strip on small screens | every `/sales/*` page (`sales/layout.tsx`) | Signed-in people; data only with a Sales grant | [E section 1](./sales-enquiries.md#1-who-sees-what) | none | Documented |
| 2 | Sidebar entries Follow-ups, Enquiries, Clients & Agencies, Outreach, Events & Exhibitions, Reports; Manage: Settings; secondary (search only): New enquiry, Clients & contacts, Proposals & quotes, Pipeline board | `nav-groups.ts` | Sales grant; Settings: `manage_settings` or founder | [Settings S section 1](./sales-settings.md#1-reaching-the-screen-and-who-may-change-what); this index | none | Documented |
| 3 | Phone bottom bar "Sales" (to Follow-ups) | `shell-chrome.tsx` | Sales grant | [F section 1](./sales-followups.md#1-route-and-who-sees-what) | none | Documented |
| 4 | Landing: `/sales` redirects to `/sales/follow-ups` | `/sales` | Sales grant | section 3 below; [F section 1](./sales-followups.md#1-route-and-who-sees-what) | none | Documented |

## 2. Screens, dialogs and downloads

### 2.1 Follow-ups

| # | Screen / trigger | URL or trigger | Who can reach it | Reference | Catalogue | Status |
|---|---|---|---|---|---|---|
| 5 | Follow-ups page (To do: Overdue, Today, Upcoming; Mine / Everyone) | `/sales/follow-ups` | Sales grant | [F section 2](./sales-followups.md#2-page-controls) | read-only | Documented |
| 6 | Recently completed view | `?view=done` | Sales grant | [F section 2](./sales-followups.md#2-page-controls) | read-only | Documented |
| 7 | Reminders card, Dismiss, Mark all read | on `/sales/follow-ups` | Own reminders | [F sections 2 and 5](./sales-followups.md#5-reminders-who-creates-them-and-what-leaves-the-system) | `sales.reminder.mark_read` | Documented |
| 8 | Handover card (Won, not submitted; PM question) | on `/sales/follow-ups` | Sales grant (rows per `lib/crm/handover-attention.ts`) | [F section 2](./sales-followups.md#2-page-controls), [H section 2](./sales-close-and-handover.md#2-handover-page-salesopportunitiesidhandover-handoverpagetsx) | read-only | Documented |
| 9 | Needs attention card | on `/sales/follow-ups` | Sales grant | [F section 2](./sales-followups.md#2-page-controls) | read-only | Documented |
| 10 | Complete follow-up dialog | follow-up row, side panel, enquiry page | Assignee, enquiry owner or founder (account follow-up: assignee, creator or founder) | [F section 3](./sales-followups.md#3-rules-and-failures-of-each-action) | `sales.followup.complete` | Documented |
| 11 | Reschedule dialog; Cancel follow-up dialog (not offered for the only open follow-up of an active enquiry) | row "More" menu | same | [F section 3](./sales-followups.md#3-rules-and-failures-of-each-action) | `sales.followup.reschedule`, `sales.followup.cancel` | Documented |
| 12 | Add follow-up dialog (on an enquiry) | enquiry page Overview, "No next action" warning, panel "Schedule next action" | Sales grant (assigning to others needs owner or `assign_owner`) | [F section 3](./sales-followups.md#3-rules-and-failures-of-each-action) | `sales.followup.create` | Documented |
| 13 | Add follow-up on an account with no enquiry; Reassign follow-up | account page | Sales grant; reassign per rule | [C sections 2.2 and 9.3](./sales-clients-and-agencies.md#22-account-page-appswebsrcappappsalesaccountsidpagetsx) | `sales.followup.create_on_account`, `sales.followup.reassign` | Documented |

### 2.2 Enquiries: list, create, page, panel

| # | Screen / trigger | URL or trigger | Who can reach it | Reference | Catalogue | Status |
|---|---|---|---|---|---|---|
| 14 | Enquiry list (table, filters, sort, columns) | `/sales/opportunities` | Sales grant | [E section 2](./sales-enquiries.md#2-enquiry-list-salesopportunities-appswebsrcappappsalesopportunitiespagetsx) | read-only | Documented |
| 15 | Board view | `/sales/opportunities?view=board` (also the target of `/sales/pipeline`) | Sales grant; moves by owner or founder | [P section 2.2](./sales-pipeline-and-stages.md#22-board-salesopportunitiesviewboard-enquiry-boardtsx-componentsworkspaceboardtsx) | `sales.enquiry.move_stage`, `.hold`, `.resume`, `.mark_won`, `.mark_lost` | Documented |
| 16 | Quick add dialog ("Add enquiry"; also opened by `?add=1`) | button on Follow-ups and Enquiries; `/sales/opportunities?add=1` (`components/workspace/quick-add.tsx`) | Sales grant with a company | [E section 3.1](./sales-enquiries.md#31-quick-add-dialog-componentssalesquick-add-enquiry-formtsx) | `sales.enquiry.create` | Documented |
| 17 | New enquiry page | `/sales/new` (also `?company=&org=&outreach=` from Outreach) | Sales grant with a company | [E section 3.2](./sales-enquiries.md#32-full-page-salesnew-appswebsrcappappsalesnewpagetsx-new-enquiry-formtsx) | `sales.enquiry.create`, `sales.organisation.create_simple`, `sales.contact.create` | Documented |
| 18 | Enquiry page header and notices | `/sales/opportunities/[id]` | Sales grant for the enquiry's company (else 404) | [E section 4](./sales-enquiries.md#4-enquiry-page-salesopportunitiesid-pagetsx) | read-only | Documented |
| 19 | Tab Overview (brief, who is involved, follow-ups, where it stands, key facts) | `?tab=overview` | same | [E section 4](./sales-enquiries.md#4-enquiry-page-salesopportunitiesid-pagetsx) | read-only | Documented |
| 20 | Tab Scope & dates | `?tab=scope` | same | [E sections 4 and 4.1](./sales-enquiries.md#41-edit-details-dialog-edit-detailstsx-updateopportunity---crm_update_opportunity) | read-only | Documented |
| 21 | Tab Activity & history (log an activity, closure history, timeline) | `?tab=activity` | same | [E section 4.3](./sales-enquiries.md#43-activity-and-timeline-add-activity-formtsx-activity-paneltsx-helpersts) | `sales.enquiry.add_activity` | Documented |
| 22 | Tab Proposals & files | `?tab=proposals` | same | [Z section 1](./sales-proposals-and-zoho.md#1-proposal-versions-enquiry-page--proposals--files-proposals-paneltsx-proposal-formstsx), [E section 4.4](./sales-enquiries.md#44-files-and-links-proposals--files-tab-files-paneltsx-file-formstsx-libactionscrmfilests) | files: `sales.enquiry.add_link`, `.upload_file`, `.remove_file`; proposals: `sales.proposal.*` (see the proposal rows below) | Documented |
| 23 | Tab Estimates | `?tab=quotations` | same | [Q section 2.1](./sales-estimates-and-quotations.md#21-enquiry-page-tab-estimates-appswebsrcappappsalesopportunitiesidquotations-paneltsx) | `sales.estimate.create` | Documented |
| 24 | Tab Commercial (availability, approval, Zoho references) | `?tab=commercial` | same | [Z section 2](./sales-proposals-and-zoho.md#2-commercial-tab-commercial-paneltsx-commercial-formstsx-quick-actionstsx) | `sales.availability.*`, `sales.approval.*`, `sales.zoho.save_references` (see the commercial rows below) | Documented |
| 25 | Edit details / Edit value dialog | header button, Scope tab, panel More menu | Owner or founder (full); founder only for value on Won; none on Lost | [E section 4.1](./sales-enquiries.md#41-edit-details-dialog-edit-detailstsx-updateopportunity---crm_update_opportunity) | `sales.enquiry.edit_details` | Documented |
| 26 | Assign owner dialog | header button, panel More menu | `assign_owner` (founder implies) | [E section 4.5](./sales-enquiries.md#45-assign-owner-assign-ownertsx) | `sales.enquiry.assign_owner` | Documented |
| 27 | Contacts: Add a contact (pick or create), Change role, Edit contact details, Remove from this opportunity | Overview tab | Owner or founder (edit record: creator, founder or owner of a not-lost enquiry it is on) | [E section 4.2](./sales-enquiries.md#42-contacts-overview-tab-contacts-paneltsx-contact-formstsx-contact-helpersts) | `sales.enquiry.contact_link`, `.contact_create_and_link`, `.contact_unlink`, `sales.contact.update_shared` | Documented |
| 28 | Files: Add link, Upload file, Open, Remove | Proposals & files tab | Sales grant (remove: uploader, owner or founder) | [E section 4.4](./sales-enquiries.md#44-files-and-links-proposals--files-tab-files-paneltsx-file-formstsx-libactionscrmfilests) | `sales.enquiry.add_link`, `.upload_file`, `.remove_file`; open: read-only | Documented |
| 29 | Enquiry side panel | `?open=<id>` on `/sales/opportunities` and `/sales/follow-ups` | Sales grant | [E section 5](./sales-enquiries.md#5-side-panel-openid-on-follow-ups-and-enquiries-appswebsrcappappsales_panel) | as the actions it hosts | Documented |
| 30 | Warehouse stock check card in the side panel | in the panel | Per Inventory rules | [E section 5](./sales-enquiries.md#5-side-panel-openid-on-follow-ups-and-enquiries-appswebsrcappappsales_panel); [04 section 1.1 row 4](../04-flows-sales-to-warehouse-and-others.md) | none (Inventory's) | Documented, with named verification gap: the card and its ask and record actions belong to Inventory (no per-control reference yet); not traced here |

### 2.3 Stages, proposals, commercial controls

| # | Screen / trigger | URL or trigger | Who can reach it | Reference | Catalogue | Status |
|---|---|---|---|---|---|---|
| 31 | Move stage dialog and the two gates | header button, panel menu, board | Owner or founder | [P sections 3.1 and 3.2](./sales-pipeline-and-stages.md#31-move-stage-dialog-stage-actionstsx-movestagedialog-side-panel-move-to-another-stage) | `sales.enquiry.move_stage` | Documented |
| 32 | Put on hold dialog; Resume dialog | header, panel, board | Owner or founder | [P sections 3.3 and 3.4](./sales-pipeline-and-stages.md#33-put-on-hold-holddialog) | `sales.enquiry.hold`, `sales.enquiry.resume` | Documented |
| 33 | Proposal versions list; Add version | Proposals & files tab | Read: Sales grant; add: owner or founder, open enquiry | [Z section 1](./sales-proposals-and-zoho.md#1-proposal-versions-enquiry-page--proposals--files-proposals-paneltsx-proposal-formstsx) | `sales.proposal.add_version` | Documented |
| 34 | Record as sent / accepted / Mark superseded dialogs (estimates have no Record as sent; database guard) | proposal row buttons | Owner or founder | [Z sections 1 and 1.2](./sales-proposals-and-zoho.md#12-estimates-in-the-proposal-list-and-the-database-guard) | `sales.proposal.record_sent`, `.record_accepted`, `.supersede` | Documented |
| 35 | Proposals list across enquiries | `/sales/proposals` | Sales grant (secondary menu entry) | [Z section 1.1](./sales-proposals-and-zoho.md#11-the-cross-page-list-salesproposals-appswebsrcappappsalesproposalspagetsx) | open file: read-only | Documented |
| 36 | Equipment availability: Request check, Record the check | Commercial tab | Request: owner or founder; record: `confirm_availability` | [Z section 2.1](./sales-proposals-and-zoho.md#21-equipment-availability) | `sales.availability.request`, `sales.availability.record_result` | Documented |
| 37 | Commercial approval: Request, Decide | Commercial tab | Request: owner or founder; decide: Sales founder; policy must be Required | [Z section 2.2](./sales-proposals-and-zoho.md#22-commercial-approval) | `sales.approval.request`, `sales.approval.decide` | Documented |
| 38 | Zoho Books references form (manual references; Quote sent gate) | Commercial tab | Owner or founder; read-only to others | [Z section 2.3](./sales-proposals-and-zoho.md#23-zoho-books-references-zohosection-zohoform) | `sales.zoho.save_references` | Documented, with named verification gap: the Zoho Books side (whether the quote or invoice exists) is hosted and outside the app, not verifiable here |

### 2.4 Close, reopen, handover

| # | Screen / trigger | URL or trigger | Who can reach it | Reference | Catalogue | Status |
|---|---|---|---|---|---|---|
| 39 | Close page (Won or Lost) | `/sales/opportunities/[id]/close?outcome=won|lost` | Page: Sales grant; form: owner or founder | [H section 1](./sales-close-and-handover.md#1-close-dialogs-and-the-close-page) | `sales.enquiry.mark_won`, `sales.enquiry.mark_lost` | Documented |
| 40 | Close dialog (panel, board) | More menu, board drop into Won or Lost | Owner or founder | [H section 1](./sales-close-and-handover.md#1-close-dialogs-and-the-close-page) | same | Documented |
| 41 | Reopen dialog | header, panel More menu | `reopen_closed` (founder implies) | [P section 3.5](./sales-pipeline-and-stages.md#35-reopen-a-won-or-lost-enquiry-reopen-dialogtsx) | `sales.enquiry.reopen` | Documented |
| 42 | Handover page and package summary | `/sales/opportunities/[id]/handover` | Sales grant opens it; changes by owner or founder | [H section 2](./sales-close-and-handover.md#2-handover-page-salesopportunitiesidhandover-handoverpagetsx) | read-only | Documented |
| 43 | Project handover brief: Save, Save and submit, Save draft, Withdraw | handover page | Owner or founder (submit: preparer, owner or founder; withdraw: Sales or Projects founder) | [H section 2.2](./sales-close-and-handover.md#22-project-handover-panel-project-handovertsx-project-handover-formstsx) | `sales.handover.save_draft`, `.save_and_submit`, `.withdraw` | Documented, with named verification gap: assigning the Project Manager, asking a question and accepting (which creates the project) are Projects screens, mapped only in `04` section 1.2 (no per-control Projects reference yet) |
| 44 | Sales-side handover form (only when Projects & Tasks is not installed) | handover page fallback | Owner or founder | [H section 2.1](./sales-close-and-handover.md#21-two-handover-records-current-and-legacy) | `sales.handover.update_legacy` | Documented |
| 45 | Won handover prompt | under Won on the enquiry page and panel | Sales grant | [H section 2](./sales-close-and-handover.md#2-handover-page-salesopportunitiesidhandover-handoverpagetsx) | read-only | Documented |

### 2.5 Estimates (documented earlier; verified against current main for routes and who can reach them)

| # | Screen / trigger | URL or trigger | Who can reach it | Reference | Catalogue | Status |
|---|---|---|---|---|---|---|
| 46 | Estimate builder, three steps (Details, BOQ, Preview & finalise) | `/sales/opportunities/[id]/quotations/[proposalId]` | Sales grant reads; edit: owner or founder, unfinalised, open enquiry | [Q section 2.2](./sales-estimates-and-quotations.md#22-estimate-page-three-steps-quotationsproposalidpagetsx-editortsx-libcrmquotationsbuilder-statets) | `sales.estimate.create`, `.save_draft`, `.save_section`, `.delete_section`, `.delete_line`, `.set_line_image`, `.reorder`, `.request_approval`, `.decide_approval`, `.finalise`, `.create_revision` | Documented, with named verification gap: photo upload and storage-backed export were not re-verified for the estimates-only and branding changes (per the README stamp rows); hosted behaviour not verified |
| 47 | Download PDF | `GET /api/sales/quotations/[proposalId]/pdf` | Sales grant for that company; draft marked DRAFT; issued from the frozen snapshot | [Q Export](./sales-estimates-and-quotations.md#export-pdf-and-excel) | read-only export | Documented |
| 48 | Download Excel | `GET /api/sales/quotations/[proposalId]/xlsx` | same | [Q Export](./sales-estimates-and-quotations.md#export-pdf-and-excel) | read-only export | Documented |

### 2.6 Accounts, import and export, outreach (documented earlier)

| # | Screen / trigger | URL or trigger | Who can reach it | Reference | Catalogue | Status |
|---|---|---|---|---|---|---|
| 49 | Clients & Agencies directory (search, role, country, owner, lead source, exhibition, relationship chips, sort) | `/sales/accounts` | Sales grant | [C section 2.1](./sales-clients-and-agencies.md#21-directory-appswebsrcappappsalesaccountspagetsx) | read-only | Documented |
| 50 | Account page (summary, contacts, enquiries, quotes, follow-ups, activity) | `/sales/accounts/[id]` | Sales grant | [C section 2.2](./sales-clients-and-agencies.md#22-account-page-appswebsrcappappsalesaccountsidpagetsx) | read-only | Documented |
| 51 | Add account; Edit profile; Assign / Change account owner; Add and edit contact | dialogs on directory and account page | Sales grant; owner choice `assign_owner`; edit per `crm_can_edit_organisation` | [C sections 2.1, 2.2 and 5](./sales-clients-and-agencies.md#22-account-page-appswebsrcappappsalesaccountsidpagetsx) | `sales.account.create`, `sales.account.save_profile`, `sales.account.assign_owner`, `sales.contact.create`, `sales.contact.update_shared` | Documented |
| 52 | Guided Excel import (Upload, Preview, Confirm, Result) | `/sales/accounts/import` | Sales grant for the company | [C sections 8.1 and 9.1](./sales-clients-and-agencies.md#81-control-reference) | `sales.import.apply` | Documented |
| 53 | Import preview and confirm endpoint | `POST /api/sales/accounts/import` | Sales grant for the company | [C section 8.1](./sales-clients-and-agencies.md#81-control-reference) | preview: read-only; confirm: `sales.import.apply` | Documented |
| 54 | Import template download | `GET /api/sales/accounts/import/template` | Sales grant | [C section 8.1](./sales-clients-and-agencies.md#81-control-reference) | read-only export | Documented |
| 55 | Export filtered results / Export all accounts | `GET /api/sales/accounts/export?scope=filtered|all` | Sales grant for the company | [C section 8.1](./sales-clients-and-agencies.md#81-control-reference) | read-only export | Documented |
| 56 | Outreach worklist: My outreach, All outreach | `/sales/outreach` | Sales grant (All: `assign_owner` or founder) | [C section 10.1](./sales-clients-and-agencies.md#101-control-reference) | read-only | Documented |
| 57 | Outreach section on the account page: Log activity, Next action, Status, Create inquiry, Link an inquiry | `/sales/accounts/[id]#outreach` | Assignee or lead | [C section 10.1](./sales-clients-and-agencies.md#101-control-reference) | `sales.outreach.log_activity`, `.set_next_action`, `.set_status`, `.link_inquiry` | Documented |
| 58 | Bulk selection and Assign outreach dialog | directory (checkboxes and bar) | `assign_owner` or founder | [C sections 4.2 and 10.1](./sales-clients-and-agencies.md#101-control-reference) | `sales.outreach.assign` | Documented |

### 2.7 Reports, settings, company

| # | Screen / trigger | URL or trigger | Who can reach it | Reference | Catalogue | Status |
|---|---|---|---|---|---|---|
| 59 | Sales reports (pipeline by stage and owner, follow-ups, timeliness, won and lost, lost reasons, source, won value, invoice and payment references) with period and company filters | `/sales/reports` | Sales grant | [R sections 2 and 3](./sales-reports.md#3-report-cards-definitions-and-sources) | read-only | Documented |
| 60 | Sales settings, company settings form | `/sales/settings` | Reach: anyone with a grant by address (menu: `manage_settings` or founder); change: `manage_settings` (policy: `manage_approval_rules`) | [S section 2](./sales-settings.md#2-company-settings-form-savecrmsettings---crm_upsert_settings) | `sales.settings.save_company` | Documented |
| 61 | VAT choices (Add VAT choice) | `/sales/settings`, Estimates card | `manage_settings` or founder | [S section 3](./sales-settings.md#3-estimates-card-vat-choices-quotation-defaultstsx-savevatchoice---crm_save_vat_choice) | `sales.settings.save_vat_choice` | Documented |
| 62 | Estimate issuer details and logo (Admin, Companies) | `/admin/companies` | System Administrator | [Q sections 2.4](./sales-estimates-and-quotations.md#24-admin-companies-appswebsrcappappadmincompanies) | `sales.company.save_issuer_details`, `sales.company.upload_logo` | Documented, with named verification gap: the Admin Companies screen itself has no per-control reference (Admin module not written); only the two estimate-related controls are documented |

## 3. Older and redirecting routes (current behaviour, verified in code)

| # | Old route | Current behaviour | Evidence |
|---|---|---|---|
| 63 | `/sales` | Redirects to `/sales/follow-ups` (a bookmark still works) | `apps/web/src/app/(app)/sales/page.tsx` (`redirect`) |
| 64 | `/sales/pipeline` | Redirects to `/sales/opportunities?view=board`, keeping a `company` id only if it is a valid UUID | `sales/pipeline/page.tsx` |
| 65 | `/sales/clients` ("Clients & contacts") | **Still a working page, not redirected or retired.** Lists organisations (agency, end client, direct client) with search and a Type filter (first 100 shown), their contacts, and "Contacts without an organisation"; dialogs Add organisation and Add contact (`sales.organisation.create_simple`, `sales.contact.create`). Not in the menu (secondary: found by search; also from Enquiries "Shared lists"). It is superseded in the menu by Clients & Agencies (`/sales/accounts`) but is untouched and used by the existing browser flow `os-shell-checks/sales-actions.mjs`. It shows organisations of every company (shared reference data) | `sales/clients/page.tsx`, `clients/entity-dialogs.tsx`, `nav-groups.ts` (`secondary: true`); no entry for it in `next.config.ts` redirects |
| 66 | `/sales/contacts` | **Does not exist.** There is no route, redirect or rewrite for it anywhere in the repository (search for the string finds nothing). A signed-in person gets the app's not-found page (`(app)/not-found.tsx`); a signed-out person is sent to the login page first (`proxy.ts`). Contacts are reached on the enquiry page, the account page, and the contact list inside `/sales/clients` | file list under `sales/`, `next.config.ts`, repo-wide search |
| 67 | `/sales/access` | Temporary (non-permanent) redirect to `/people-access` | `apps/web/next.config.ts` `redirects()` |
| 68 | `/sales/opportunities?mine=1` | Still accepted: treated as Owner = Mine | `EnquiriesPage` (`ownerRaw`) |
| 69 | `/sales/follow-ups?view=today` | The link target used by My Day ("N due today"). **Fixed 2026-11-08**: the page now honours it and shows the Today group only, with "Show all to-do" (it used to ignore the value and show To do) | `follow-ups/page.tsx` (`todayOnly`), `follow-ups/page.test.tsx`, `components/my-day/sales-pipeline.test.tsx`, `os-shell-checks/sales-crm-readiness-flow.mjs` |

The Sales overview that `/sales` used to show is gone; its parts live on Follow-ups, the Enquiries board and Reports (comment in `sales/page.tsx`).

## 4. Scheduled and non-screen routes

| # | Route | What it does | Who / how | Reference | Catalogue | Status |
|---|---|---|---|---|---|---|
| 70 | `GET /api/cron/crm-reminders` | Daily reminder sweep and upload clean-up (internal; may send owner e-mails to staff only when switched on) | Bearer `CRON_SECRET` (`lib/cron/auth.ts`); the only cron path the sign-in proxy lets through (`proxy.ts`); Vercel schedule `0 4 * * *` (`vercel.json`) | [F section 5](./sales-followups.md#5-reminders-who-creates-them-and-what-leaves-the-system) | internal list | Documented, with named verification gap: whether the schedule is active and the e-mail switch is on in hosted environments is owner-controlled and `Unverified` |

## 5. Summary and completion check

**70 rows** are the reachable surface: menu and shell (4), follow-ups (9), enquiries (17), stages, proposals and commercial controls (8), close, reopen and handover (7), estimates (3), accounts, import, export and outreach (10), reports, settings and company (4), older and redirecting routes (7) and the scheduled route (1). Of these, **64 are `Documented`** and **6 are `Documented, with named verification gap`**: rows 30 (Inventory's stock-check card), 38 (the Zoho Books side), 43 (Projects-side handover steps), 46 (estimate photo upload and storage-backed export not re-verified), 62 (Admin Companies screen beyond the two estimate controls) and 70 (hosted cron schedule and e-mail switch). **Every reachable Sales & CRM screen has a detailed reference or a named gap; none is undocumented.** Row counts and gaps are repeated in `../README.md`, `../06-change-log.md` and the pass report.

**Not Sales screens and not covered here**: People & Access grants (`../03-roles-access-and-approvals.md`), the Projects pages reached after acceptance, Inventory pages, My Day.

## 4. Gaps fixed since the baseline (2026-11-08, PR #68, merged as `ca3e4483ce4745e359ddb3377b52748175f3881f`; migration applied on hosted V2 per the owner, owner-run verification 2026-11-09; Vercel Production not verified by Claude)

The six named verification gaps (rows 30, 38, 43, 46, 62 and 70, see the count under section 3) are **unchanged**: row 38's gap is the Zoho Books side, which is still outside the app and unverifiable here. These reported code observations are fixed, each with a test, and recorded in `../06-change-log.md`:

| Row | What was wrong | Now |
|---|---|---|
| 18, 39, 42 (enquiry, close, handover pages) | A failed detail read landed on the generic error page | "Could not load this enquiry" with Try again, distinct from not found, no access and an empty result; no dependent action is offered; per-section "Could not load" ([E section 4](./sales-enquiries.md), [H sections 1 and 2](./sales-close-and-handover.md)) |
| 38 (Zoho references) | The save overwrote every field | Field-level merge, intentional clear, row lock, stale-field refusal, Lost read-only, and owner decision B (the quote reference cannot be cleared from Quote sent; the new app has no write fallback) (migration `20261222000100`, [Z section 2.3](./sales-proposals-and-zoho.md)) |
| 34 (Mark superseded) | The database accepted any starting status | Only draft or sent (same migration) |
| 39 (Won date) | The no-future-date rule was only in the form | `crm_mark_won` refuses a date after the Dubai day (same migration) |
| 59 (Reports) | Stored source ids shown; a failed closures read ignored; failed reads looked like zeros | Readable names; per-card "Could not load" and an "incomplete" notice ([R sections 3, 4 and 6](./sales-reports.md)) |
| 65 (`/sales/clients`) | The loose-contacts read error was ignored | "Could not load the contacts without an organisation"; the route and the successful page are unchanged (still no redirect) |
| 69 (`?view=today`) | The page ignored the value My Day links to | The Today view ([F section 2](./sales-followups.md)) |
| 60 (Settings) | The reference-code hint omitted `OPP-` | Hint names the prefix; the generator is unchanged ([S section 6](./sales-settings.md)) |

## Events & Exhibitions (draft PR `feat/outreach-events`; not merged, migration not applied)

| # | Screen / control | Route | Who | Reference |
|---|---|---|---|---|
| 70 | Events list (filters, figures, Add event, Add edition) | `/sales/events` | Sales grant | [X section 3.1](./sales-events-and-exhibitions.md) |
| 71 | Event page (editions, exhibitors compared, agencies to contact, linked enquiries) | `/sales/events/[id]` | Sales grant | [X section 3.2](./sales-events-and-exhibitions.md) |
| 72 | Record an observation (phone-first dialog) | event page | Sales grant | [X section 3.3](./sales-events-and-exhibitions.md) |
| 73 | Outreach priority (directory column, filter, sort; account card; lead control) | `/sales/accounts`, `/sales/accounts/[id]`, event page | Sales grant | [X section 4](./sales-events-and-exhibitions.md) |
| 74 | Import events (template, preview, confirm; archive on events and editions) | `/sales/events/import`, `/sales/events`, event page | Sales grant | [X sections 3.2, 3.4](./sales-events-and-exhibitions.md) |
| 74 | Event / Exhibition field on New enquiry, Quick add and Edit details; event line on Scope & dates | `/sales/new`, quick add, enquiry page | Sales grant; link: owner or founder | [E section 3.4](./sales-enquiries.md) |
