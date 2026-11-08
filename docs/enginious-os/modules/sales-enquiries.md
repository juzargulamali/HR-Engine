# Sales: Enquiries (list, quick add, new enquiry, enquiry page and side panel)

Status: written from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (see `../README.md` stamp row "Sales & CRM app map completed"). **Code read only; nothing was run** (no app, no database, no hosted project). Conventions as in `../README.md`: every claim cites a source; `Unverified` marks what code reading could not confirm. The database function named in each row is the real gate and repeats the check; "Who" is what the screen offers. Every data-changing control has an entry in [`sales-action-catalogue.md`](./sales-action-catalogue.md) (action name in the "Catalogue" column). Coverage of every route: [`sales-coverage-index.md`](./sales-coverage-index.md).

Related references: stage moves, hold, resume and reopen: [`sales-pipeline-and-stages.md`](./sales-pipeline-and-stages.md). Follow-ups: [`sales-followups.md`](./sales-followups.md). Proposals, availability, approval and Zoho: [`sales-proposals-and-zoho.md`](./sales-proposals-and-zoho.md). Won, Lost and handover: [`sales-close-and-handover.md`](./sales-close-and-handover.md). Estimates tab: [`sales-estimates-and-quotations.md`](./sales-estimates-and-quotations.md). Accounts, contacts of an account, import and outreach: [`sales-clients-and-agencies.md`](./sales-clients-and-agencies.md).

## 1. Who sees what

* Access is a company-scoped Sales grant (`crm_company_grants`), never an HR role: `getCrmContext` (`apps/web/src/lib/crm/context.ts`), the shell `apps/web/src/app/(app)/sales/layout.tsx`. No grant: an access notice (no data). Grants unreadable: "Sales & CRM could not load" (`ctx.loadFailed`), never "no access".
* A person with any grant for a company reads every enquiry of that company, whoever owns it (`crm_has_access(company_id)` policies in `20261115000100_crm_core_tables.sql`; confirmed in `sales-clients-and-agencies.md` section 5). The owner or a Sales founder changes it (`crm_require_owner_or_founder`, `20261115000200_crm_workflow_functions.sql`; UI mirror `canEditOpportunity`, `packages/domain/src/permissions/crm.ts`).
* Capabilities (`CRM_CAPABILITIES`, same file): `founder`, `assign_owner`, `confirm_availability`, `manage_settings`, `manage_approval_rules`, `manage_access`, `view_audit`, `reopen_closed`. `founder` implies every other one (`hasCrmCapability`).
* Optimistic concurrency: every enquiry write that carries `expectedVersion` is first compared by the app (`staleMessage`, `apps/web/src/lib/actions/crm.ts`: "This enquiry was changed by someone else. Reload the page ...") and again by the database (`crm_check_version`, errcode `40001`).

## 2. Enquiry list (`/sales/opportunities`, `apps/web/src/app/(app)/sales/opportunities/page.tsx`)

Data: `loadOpportunities` (`apps/web/src/lib/crm/data.ts`): the newest 2000 `crm_opportunities` the person can read, their agencies and clients (`crm_organisations`), and every open `crm_follow_ups` row (next action = earliest due). Filtering, sorting and columns are done in the app on that list (`filterOpportunities` in `lib/crm/reports.ts`; `sortEnquiries` in `lib/crm/enquiry-list.ts`). Everything lives in the address, so a link keeps it; unknown values in the address are ignored.

| Control | What it does | Who | Success / failure | Behind it | Tests |
|---|---|---|---|---|---|
| Page | Title "Enquiries"; toolbar; table or board | Any Sales grant (the page renders nothing without one; the layout shows the notice) | Failed read: "Could not load the enquiries" with Try again (never an empty list). No enquiry at all: "No enquiries yet" (toolbar hidden) | `EnquiriesPage`, `loadOpportunities`, `LoadError` | `apps/web/src/lib/crm/enquiry-list.test.ts` (helpers); page itself `Unverified` (needs a running app) |
| Add enquiry (button) | Opens the quick-add dialog (section 3.1) | Any Sales grant with a company | Organisations unreadable: the button is replaced by "Could not load organisations ... Reload the page" (so empty pickers never invite duplicates) | `QuickAddEnquiry` (`components/sales/quick-add-enquiry.tsx`) | |
| More menu "Shared lists" | Two links: "Clients & contacts" (`/sales/clients`, the older page, still working: see the coverage index section 3) and "Proposals & quotes" (`/sales/proposals`) | Any Sales grant | | `MoreMenu` in `page.tsx` | |
| Search | Matches reference, title, agency name and client name (case-insensitive contains), first 100 characters | same | No match: "Nothing matches" with Clear filters | `filterOpportunities` | `reports.test.ts` (`apps/web/src/lib/crm/reports.test.ts`) |
| Stage filter (table view only) | Any stage, or one of the 9 stages: New enquiry, Qualified, Proposal preparation, Proposal sent, Quote sent, Negotiation, On hold, Won, Lost (`CRM_STAGES`, `packages/domain/src/crmStages.ts`). **A chosen stage overrides the Show filter** (asking for "Won" is never emptied by the default "open") | same | In board view the stage filter is not offered and is ignored (the board's lanes are the stages) | `filterOpportunities` | `reports.test.ts` |
| Owner filter | Anyone (default), Mine (`owner=me`, or the older `mine=1`), or any person with a Sales grant in the person's companies (`ctx.people`) | same | An id that is not one of those people is ignored | `EnquiriesPage` | |
| Show (secondary filter) | "Open (includes on hold)" (default), "Won and lost" (`closed`), "Everything" (`all`). Open = every stage except Won and Lost | same | | `OppStatusFilter` | `reports.test.ts` |
| Company (only with grants for more than one company) | "All companies" or one company | same | A company the person has no grant for is ignored | `ctx.companies` | |
| Clear / Clear filters | Removes search, stage, owner, show and company (keeps view, columns and sort) | same | | `here({ q: null, ... })` | |
| View switch Table / Board | `view=board` shows the board (section 2.2 of `sales-pipeline-and-stages.md`); default is the table | same | | `ViewSwitch`, `parseView` | |
| Columns menu (table view) | Chooses columns, kept in `cols=`. Options: Enquiry (always shown), Agency / client, Owner, Stage, Next action, Due, Installation / show, Value, Source, Equipment availability, Created, Company (offered only with more than one company). Default: Enquiry, Agency / client, Owner, Stage, Next action, Due, Installation / show | same | | `ENQUIRY_COLUMNS`, `ENQUIRY_DEFAULT_COLUMNS`, `parseColumns` | `enquiry-list.test.ts` |
| Table | One row per enquiry; click the title or row opens the side panel (`?open=<id>`, section 5). Cells: Enquiry (title + reference), Agency / client ("Agency for Client", or "None recorded"), Owner, Stage badge, Next action (or "Closed: won/lost", "On hold", "None planned"), Due (relative text), Installation / show (installation date, else show start, with the label), Value (formatted in its own currency), Source (label of the source, section 3.3), Equipment availability badge (not shown for closed enquiries), Created (date), Company | same | | `TableView`, `Cell` | `enquiry-list.test.ts` |
| Sort (column headings) | Sortable: Enquiry, Agency / client, Owner, Stage (pipeline order), Due, Installation / show, Value, Created. Default Due ascending. Missing values always sort last; ties fall back to reference. Value sorts by currency first: amounts in different currencies are never compared | same | | `sortEnquiries`, `ENQUIRY_SORT_KEYS`, `parseSort` | `enquiry-list.test.ts` |
| Row count line | "N of M enquiries" (+ " match" when a filter is active). At most **300 rows** are shown ("showing the first 300. Narrow the filters"). There is **no paging control and no bulk action** on this list | same | | `MAX_ROWS = 300` | |
| Saved or quick filters | None are stored. The address holds the filters; `RememberList` keeps the last list address and scroll position in `sessionStorage` (this tab only) so the enquiry page's back link returns to the same list | same | Storage blocked: the back link goes to the plain list | `components/workspace/list-memory.tsx` | `Unverified` (browser behaviour) |
| Empty after filtering | "Nothing matches" with a Clear filters link | same | | | |

Not on this list: export, import, bulk owner change, bulk stage move. (Bulk assignment exists only for Outreach on the accounts directory: `sales-clients-and-agencies.md` section 10.)

## 3. Creating an enquiry

Two doors, one action: the quick-add dialog (list pages) and the full page `/sales/new` (secondary in the menu, also reached from a link in the quick-add dialog and from an account's Outreach "Create inquiry"). Both post to `createOpportunity` (`apps/web/src/lib/actions/crm.ts`) which calls `crm_create_opportunity` (`20261115000200_crm_workflow_functions.sql`). Catalogue: `sales.enquiry.create`.

### 3.1 Quick add (dialog, `components/sales/quick-add-enquiry-form.tsx`)

| Field / control | Notes | Required | Behind it |
|---|---|---|---|
| Company | Only the person's companies; shown only with more than one company. A company with no Sales settings is labelled "(no Sales settings yet)" and the database refuses it ("CRM settings (reference code and currency) are not configured for this company yet") | yes | `crm_create_opportunity` (reads `crm_company_settings`) |
| What is the enquiry? (title) | Up to 200 characters | yes | `createOpportunitySchema` |
| Agency, End client | Role-aware pickers (section 3.4); at least one of the two | one of two | `crm_create_opportunity`, trigger `crm_opportunities_party_roles` (`20261219000100_crm_clients_agencies.sql`) |
| Where did it come from? | Fixed list, section 3.3 | yes | `crm_opportunities.source` check |
| Next action, Due date | The first follow-up; date not before today (Dubai); time is fixed 10:00 and type fixed Call in this dialog | yes | creates a `crm_follow_ups` row |
| Optional block: Event start, Event end, Installation, Location, Technologies, Budget or value, Currency | As the full page (section 3.2); the dialog's own copy of these fields | no | same |
| Duplicate warning | Appears while typing (agency, client, dates, location): "This may be the same enquiry" with links and "Not the same". **Never blocks saving.** A failed check says "Could not check for duplicates. Look at the existing enquiries before you save this one." | n/a | `checkDuplicates` -> `crm_find_duplicate_candidates`, scored by `findLikelyDuplicates` (`packages/domain/src/crmDuplicates.ts`); window `crm_company_settings.duplicate_window_days` (default 180) |
| Add enquiry (submit) | On success lands on `/sales/opportunities?open=<new id>` (side panel open) | | `redirect` in `createOpportunity` |

### 3.2 Full page (`/sales/new`, `apps/web/src/app/(app)/sales/new/page.tsx`, `new-enquiry-form.tsx`)

| Section / field | What it is | Required | Notes |
|---|---|---|---|
| Company | As above | yes | No company at all: "You do not have Sales access to any company yet" with Ask for access |
| Requirement (title) | One-line brief | yes | max 200 |
| Where did it come from? | Source | yes | section 3.3 |
| Agency / End client | Search box + select + "Add organisation" | at least one | Role-aware (3.4); a prefill from an account's Outreach picks the picker the account's role fits |
| Contacts | Tick contacts of the chosen organisations; "Add contact" dialog (`AddContactDialog`) | no | Linked through `crm_opportunity_contacts` |
| Next action, Date, Time (Dubai, default 10:00), Type | Type options: Call, Email, Meeting, Proposal work, Other | action and date required | `nextKind` enum `call, email, meeting, proposal, other` |
| Owner | Defaults to the person; other choices (people with Sales access to the company) only for holders of `assign_owner` (founders included) | no | Another owner without the capability: "Only a founder (or someone they delegated) can assign another owner"; an owner without a company grant: "The chosen owner has no Sales access for this company" (`crm_create_opportunity`) |
| Event start / end, Installation date, Location | Dates and venue | no | `eventEnd` offered not before start |
| Technologies requested | Rows of free-text name and a whole-number quantity of at least 1 (**no fixed list**); an untouched blank row is ignored; a quantity with no name is an error | no | `technologies.ts` (`parseTechnologyRows`), `crm_validate_technologies`; tests `technologies.test.ts` (`apps/web/src/app/(app)/sales/new/technologies.test.ts`) |
| Waiting on | Nobody, The client, Our own team (`""`, `client`, `internal`) | no | `crm_opportunities.waiting_on` |
| Brief, Scope | Free text | no | |
| Budget or value, Currency, Budget note | Value is zero or more; currency three letters, defaults to the company's default quote currency (Sales settings); the datalist suggests common codes | no | A won enquiry later needs a value (`crm_mark_won`) |
| Record enquiry / Cancel | Saves; Cancel returns to the list | | On success lands on `/sales/opportunities/<id>` (full page) |

What a successful create writes (`crm_create_opportunity`): one `crm_opportunities` row (stage `new`, owner = chosen owner or the creator, `created_by`), a reference `OPP-<reference code>-<year>-<4-digit counter>` from `crm_reference_counters` (year in Dubai time), `crm_opportunity_contacts` rows for ticked contacts, one open `crm_follow_ups` row (assigned to the owner, created by the creator), and a `crm_opportunity_events` row kind `created`. If it came from Outreach ("Create inquiry") the app then calls `crm_outreach_link_inquiry`; a refusal there leaves the enquiry in place and redirects to the account with `outreach_link=failed`.

### 3.3 Dropdown options and where they come from

| List | Options | Source |
|---|---|---|
| Source | Agency call (outbound) `agency_call`, LinkedIn, Direct client, WhatsApp, Instagram, Website enquiry, Referral, Other | `CRM_SOURCES` (`packages/domain/src/crmStages.ts`); database check on `crm_opportunities.source` (`20261115000100_crm_core_tables.sql`). **Fixed in code; not editable in Sales settings** |
| Stage | New enquiry, Qualified, Proposal preparation, Proposal sent, Quote sent, Negotiation, On hold, Won, Lost | `CRM_STAGES`; database check (same migration); `crm_stage_index` |
| Next action type | Call, Email, Meeting, Proposal work, Other | zod enum in `crm.ts`; `crm_follow_ups.kind` check |
| Waiting on | Nobody, The client, Our own team | form options; column `waiting_on` |
| Currency | Free 3-letter code; company default from Sales settings | `crm_company_settings.default_quote_currency` |
| Owner | People holding an active Sales grant for the company | `crm_people()` via `getCrmContext` |
| Agency / End client | Organisations holding that role | section 3.4 |

### 3.4 Role-aware organisation pickers

The Agency picker offers organisations with the agency role; the End client picker offers end-client or direct-client roles; an organisation with no roles recorded reads as its legacy `kind`; one organisation can appear in both (`apps/web/src/lib/crm/organisation-roles.ts`, `offeredFor`). Saving a role the organisation lacks is refused by trigger `crm_opportunities_party_roles` / `crm_opportunities_check_party_roles` (`20261219000100_crm_clients_agencies.sql`; checked on create and whenever agency or client changes). Documented in detail in `sales-clients-and-agencies.md` section 9.2. "Add organisation" in these pickers uses `createOrganisation` -> `crm_create_organisation` (name and one of Agency, End client, Direct client; place; note): catalogue `sales.organisation.create_simple`. Tests: `inquiry-organisation-pickers.test.tsx` (`apps/web/src/app/(app)/sales/new/`), `organisation-roles.test.ts`.

## 4. Enquiry page (`/sales/opportunities/[id]`, `page.tsx`)

A malformed id or an enquiry the person cannot read is a 404 (`notFound`). A failed read of the detail throws into the segment error boundary `apps/web/src/app/(app)/error.tsx` (a generic "something went wrong" page with Try again; it does **not** say "could not load this enquiry": see section 8, observation 1).

Header: reference, company, title, stage badge, Agency or Client line ("Client via Agency"), Owner, Value, Next action (with due text). Notices: On hold (reason, review date, "date has passed" when it has, returns to the earlier stage, Resume button for owner/founder); Won (date, evidence, handover prompt, reopen note); Lost (read-only note, reopen note); "handover kept after reopen" warning; "No next action is scheduled" warning with Add follow-up (active stage only); "Only the owner (X) or a founder can change the stage, edit the details or close this opportunity. You can add notes, files and follow-ups." for everyone else.

Header buttons (what shows when):

| Button | Shown when | Who | Opens | Catalogue |
|---|---|---|---|---|
| Move stage | Owner or founder, stage is a working stage (not On hold, Won, Lost) | owner / founder | section 3 of `sales-pipeline-and-stages.md` | `sales.enquiry.move_stage` |
| Put on hold | same | same | hold dialog | `sales.enquiry.hold` |
| Close as won / Close as lost | Owner or founder, enquiry open (Won only from a working stage) | same | `/sales/opportunities/[id]/close?outcome=won|lost` | `sales.enquiry.mark_won`, `sales.enquiry.mark_lost` |
| Edit details / Edit value | `editMode`: open stage and owner/founder = "Edit details" (full); Won and a Sales founder = "Edit value" (money only); Lost = none | owner/founder; founder only on Won | section 4.1 | `sales.enquiry.edit_details` |
| Assign owner | Open enquiry and `assign_owner` capability (founder implies it) | `assign_owner` | section 4.5 | `sales.enquiry.assign_owner` |
| Reopen | Won or Lost and `reopen_closed` capability (founder implies it) | `reopen_closed` | section 3.5 of `sales-pipeline-and-stages.md` | `sales.enquiry.reopen` |
| Handover package | Won | any Sales grant sees the page; changes by owner/founder | `/sales/opportunities/[id]/handover` | see `sales-close-and-handover.md` |

Tabs (`detail-tabs.tsx`, accessible tablist; `?tab=` selects the first tab: `overview`, `scope`, `activity`, `proposals`, `quotations`, `commercial`): all tabs stay mounted so a half-filled form survives switching.

| Tab | Shows | Reference |
|---|---|---|
| Overview | Brief; Who is involved (agency, end client, contacts with Add contact / Change role / Edit contact details / Remove); Follow-ups; "Where it stands" (commercial confirmation, equipment availability, commercial approval); Key facts (value, budget as stated, source, owner, created and by whom, first response, in this stage since, next action) | this file 4.2 to 4.4; `sales-followups.md` |
| Scope & dates | Scope, Exclusions, Risks, Technologies and quantities; Dates and place; Money and terms (budget note, payment terms, waiting on); Equipment availability; Edit details button | 4.1 |
| Activity & history | Log an activity form, closure history, Timeline (activities and changes together, newest first) | 4.3 |
| Proposals & files | Proposal versions and Files | `sales-proposals-and-zoho.md`; 4.4 |
| Estimates | Estimates built in the app | `sales-estimates-and-quotations.md` section 2.1 |
| Commercial | Equipment availability, Commercial approval, Zoho Books references | `sales-proposals-and-zoho.md` |

### 4.1 Edit details dialog (`edit-details.tsx`, `updateOpportunity` -> `crm_update_opportunity`)

Catalogue: `sales.enquiry.edit_details`. Rules (`crm_update_opportunity`): owner or founder; refused on Lost ("A lost opportunity can no longer be edited"); value or currency of a Won enquiry only by a Sales founder; only the listed keys are accepted (`title, brief, agency_org_id, client_org_id, source, currency, value, budget_note, payment_terms, event_start, event_end, install_start, location, technologies, scope, exclusions, risks, waiting_on`). A missing field is left alone; an empty one clears it. Each save bumps `version` and logs events: `value_changed` (from / to) and `details_changed` (names of the changed fields). Changing dates or technologies makes a recorded equipment check show "needs repeating" (`crm_availability_needs_recheck`, `20261115000100_crm_core_tables.sql`; the dialog warns first).

| Field | Notes |
|---|---|
| Agency, End client | Role-aware pickers (3.4); posted **only when changed** so saving other fields never rewrites or logs them; a failed organisation load shows "Could not load the organisations. Close this and try again." |
| Title (max 200), Brief | Full mode only |
| Currency (3 letters), Value (zero or more), Budget as the client stated it | Both modes; "Visible to everyone with Sales access" |
| Payment terms, Installation starts, Show starts, Show ends, Location | Full mode |
| Technologies and quantities | Free-text rows, whole-number quantity 1 or more (`crm_validate_technologies`) |
| Scope, Exclusions, Risks (one per line) | Full mode; `risks` is a list |
| Waiting on | Nobody, The client, Our own team |

Failures in words: stale version (above), "Nothing to save", value below zero, database refusals through `friendlyCrmError` (`apps/web/src/lib/crm/errors.ts`).

### 4.2 Contacts (Overview tab; `contacts-panel.tsx`, `contact-forms.tsx`, `contact-helpers.ts`)

| Control | What it does | Who | Failure | Behind it | Catalogue |
|---|---|---|---|---|---|
| Add a contact -> pick an existing person | Links a shared contact to this enquiry; search by name, organisation, job title or email; people already on it are not listed; optional role on this enquiry | Owner or founder, and the enquiry is not Lost (`canChangeOpportunityContacts`) | Refusals in words | `linkContact` -> `crm_link_contact` (upserts the role if already linked); event `contact` | `sales.enquiry.contact_link` |
| Add a contact -> create a new person | Creates a shared contact (organisation optional, name required, job title, email (validated), phone) and links it with an optional role. Two calls: `crm_create_contact` then `crm_link_contact`; if the link is refused the contact still exists | same | The answer says which part failed | `createAndLinkContact` | `sales.enquiry.contact_create_and_link` |
| Change role | Changes the role on this enquiry only | same | | `linkContact` | `sales.enquiry.contact_link` |
| Edit contact details ("Save for everyone") | Edits the SHARED record (name, job title, email, phone); one timeline line on every enquiry the person is on that the editor can see | Contact's creator, any Sales founder, or the owner of a not-lost enquiry it is on (`crm_can_edit_contact`). The button is offered only when this enquiry makes that true | "Only the person who added this contact, a founder, or the owner of an opportunity it is on can change it" | `updateContact` -> `crm_update_contact` | `sales.contact.update_shared` |
| Remove from this opportunity | Deletes the link only; the person stays | Owner or founder, not Lost | | `unlinkContact` -> `crm_unlink_contact` | `sales.enquiry.contact_unlink` |

### 4.3 Activity and timeline (`add-activity-form.tsx`, `activity-panel.tsx`, `helpers.ts`)

| Control | What it does | Who | Failure | Behind it | Catalogue |
|---|---|---|---|---|---|
| Log an activity: What kind (Note, Call, Email, Meeting, Client response), What happened (required), Internal note tick | Adds a `crm_activities` row; date is now (an activity cannot be dated in the future). The first call, email or meeting sets `first_response_at` (the first-response figure in Reports) | **Any Sales grant** (not only the owner); refused on Lost | "A lost opportunity can no longer be updated" | `addActivity` -> `crm_add_activity` | `sales.enquiry.add_activity` |
| "This was one of the planned follow-ups" | Completes that follow-up with this text as its outcome (`crm_complete_follow_up`, which also logs a note "Follow-up done: ...") before logging the activity | The person who may act on that follow-up (assignee, owner, founder) | If the activity itself then fails the answer says the follow-up was completed but the update was not added | `addActivity` | same |
| Plan the next step (title, date, time, type) | Creates the next follow-up (assigned to the person logging it) after the activity; required when the update completes the only open follow-up of an active enquiry | same | If the follow-up is refused after the activity was saved the answer says exactly which part was not saved | `crm_create_follow_up` | same |
| Timeline | Activities and `crm_opportunity_events` together, newest first; plain-sentence wording per event kind (`describeEvent`) | Any Sales grant | | `buildTimeline` | `helpers.test.ts` |
| Closure history | Every Won / Lost the enquiry has had; a reopened one is kept with who reopened it and why | Any Sales grant | | `closure-history.tsx`, `crm_closures` | `closure-helpers.test.ts` |

### 4.4 Files and links (Proposals & files tab; `files-panel.tsx`, `file-forms.tsx`, `lib/actions/crmFiles.ts`)

| Control | What it does | Who | Failure | Behind it | Catalogue |
|---|---|---|---|---|---|
| Add link | A https web address, with purpose (Proposal, Purchase order, Authorised email, Client brief, Other) and optional label. Only secure links are accepted | Any Sales grant for the company | "Only secure (https) links can be added." / "That does not look like a web address." | `addLink` -> `crm_register_file` (kind `link`); `validateCrmLink` (`packages/domain/src/crmFiles.ts`) | `sales.enquiry.add_link` |
| Upload file | Stores a file privately: PDF, JPEG, PNG, WebP, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), text or CSV, up to 20 MB; executables and macro-enabled files refused. Steps: declare (`prepareCrmUpload` -> `crm_create_upload_intent`, a signed upload URL into a quarantine bucket), upload from the browser, then `finalizeCrmUpload` re-reads the object, checks its real size and leading bytes, copies it to the final bucket and registers it (`crm_register_uploaded_file`) | same | Any rejection removes the quarantined file and the answer says why; a validated but unregistered file is deleted | `apps/web/src/lib/actions/crmFiles.ts` | `sales.enquiry.upload_file` |
| Open | Asks the server for a 60-second signed link and opens it; the link is never stored or shown | same | "File not found." / "The file could not be opened." | `getCrmFileUrl` (service client after the person's own session read the row) | read-only (catalogue read-only list) |
| Remove | A link is removed from the enquiry; a file is deleted from storage; the history keeps that it was added; a proposal that pointed at it loses the file link | The uploader, the owner or a founder (`canRemoveFile`, `crm_remove_file`) | A line used on an issued estimate cannot be removed (`crm_remove_file`, `20261220000100_crm_estimates_quotations.sql`) | `removeCrmFile` | `sales.enquiry.remove_file` |

Tests: `apps/web/src/lib/actions/crmFiles.test.ts`, `upload-cleanup.test.ts` (`apps/web/src/lib/crm/`).

### 4.5 Assign owner (`assign-owner.tsx`)

Dialog: New owner (people with Sales access to the company), Reason (kept in the history). `assignOwner` -> `crm_assign_owner`: needs `assign_owner` (founder implies it); refused on Won / Lost ("A closed opportunity cannot be reassigned"); the new owner must hold an active grant; open follow-ups that belonged to the previous owner move to the new owner (`assigned_to`); event `owner_changed`; the reassignment bumps `version`. It does not change the account owner. Catalogue: `sales.enquiry.assign_owner`.

## 5. Side panel (`?open=<id>` on Follow-ups and Enquiries; `apps/web/src/app/(app)/sales/_panel/`)

The same data as the full page, through the person's own session, in compact form: tabs Overview, Updates, Proposals & files, Scope & dates, Commercial; the Next action card (Complete follow-up, Schedule next action); the Warehouse stock check card (Inventory's, see below); "Add update" and one "More actions" menu (Edit, Move to another stage, Put on hold, Resume, Reassign owner, Handover package, Close as won / lost, Reopen: each opens the same dialog as the full page). An unreadable or unknown id: "Enquiry not found ... or you do not have access". Failed read: "Could not load this enquiry" with Try again. The Estimates tab is full-page only.

The "Warehouse stock check" card (`components/inventory/planning/sales-availability-card.tsx`) belongs to the Inventory module (reads `inv_opportunity_availability`; its ask and record actions are Inventory functions): **Unverified here** and not catalogued; they are for the Inventory reference when it is written (`04-flows-sales-to-warehouse-and-others.md` section 1.1 row 4 describes the flow).

## 6. Failed-read behaviour (summary)

List, side panel, follow-ups, reports, settings and accounts show "Could not load ..." with Try again (`LoadError`, `components/workspace/states.tsx`). Exceptions found: the enquiry page and the handover and close pages (section 8, observation 1).

## 7. Tests and browser flows (existing, not run in this pass)

`apps/web/src/lib/actions/crm.test.ts`, `apps/web/src/lib/crm/enquiry-list.test.ts`, `reports.test.ts`, `apps/web/src/app/(app)/sales/opportunities/[id]/helpers.test.ts`, `contact-helpers.test.ts`, `closure-helpers.test.ts`, `add-activity-form.test.tsx`; RLS contract `packages/rls-tests/test/crm.rls.test.ts`; browser flows `apps/web/os-shell-checks/sales-actions.mjs`, `sales-workspace.mjs`, `README.md` there. None were run in this pass (no servers); what each asserts was not re-read, so the table rows above do not claim test coverage beyond the helper names.

## 8. Observations (reported, not changed)

1. `OpportunityPage`, the close page and the handover page call `loadOpportunityDetail` without a try/catch (`apps/web/src/app/(app)/sales/opportunities/[id]/page.tsx`, `close/page.tsx`, `handover/page.tsx`). A failed read lands on the generic segment error page rather than the convention "Could not load this enquiry" (`CLAUDE.md`, failed-read rule). The side panel does it correctly (`_panel/enquiry-panel.tsx`).
2. The enquiry list cannot show more than 2000 enquiries (`.limit(2000)` in `loadOpportunities`) or 300 table rows, and the list says so only for the 300 cap. Reports say so for the 2000 cap (`reports/page.tsx`); the list does not. Board view shows every filtered row up to the 2000.
3. `loadOrganisations` throws on failure but the `/sales/clients` page also ignores the error of its separate "contacts without an organisation" read (`clients/page.tsx`), which would show none rather than "could not load".
