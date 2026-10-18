# Projects & Tasks (Release 2): schema, access design and decisions

Status: Release 2 draft. Nothing in this release is applied to Production; the owner applies migrations by hand
(`docs/projects-deployment.md`). HR and Sales & CRM keep working exactly as before.

## 1. What was inspected before designing, and what it means

| Existing thing | Finding | Consequence for this release |
|---|---|---|
| `projects`, `project_allocations` (Phase 4) | `projects` is readable by **every signed-in user in any company** (client name, code); written by HR admin. Referenced by `reimbursement_claim_lines.project_id` and timesheets; `project_allocations` is a percentage per employee. | Left **completely untouched** (no column added, no policy changed). The new module has its own `proj_` tables. Nothing new and confidential is ever stored in the legacy tables. No automatic link between old and new projects. |
| Attendance `project_name`, `project_lead_employee_id`, Recovery Leave project fields | Free text; drives the Recovery Leave *project lead* approval step. | Independent. Project membership, department responsibility and temporary project leadership are separate permissions and never create attendance, Recovery Leave, a manager, or HR access. No `proj_` function writes to an HR table. |
| `employees.manager_id`, HR roles (`user_roles`) | Reporting line and HR approvals. | Never read to decide project access; never written. |
| `departments` | Table has no head column and is empty on V2. | Department responsibility lives in `proj_teams` (a named team inside one project with its own head), optionally pointing at a `departments` row. HR departments are not used for authorisation. |
| `crm_company_grants` and `crm_*` helper functions | Company-scoped capability grants, SECURITY DEFINER stable helpers, writes only through functions, own audit log, sequences/functions revoked from default Supabase grants, `crm_lock_opportunity` row lock, idempotent functions. | Mirrored as `proj_company_grants`, `proj_has_capability`, `proj_audit_log`, `proj_*` functions. A CRM grant never confers Projects access and the reverse. Only one narrow, explicit exception is documented in §3 (Sales link). |
| `crm_handovers`, `crm_update_handover` | Sales owner/founder sets the PM and marks the handover "handed over" on a Won opportunity. | Unchanged and still works. The Projects handover is a **separate record** (`proj_handovers`) created from a Won opportunity; it never writes to CRM tables. The CRM handover page gains a read-only "Projects handover status" line. |
| `notifications` (user_id, type, payload, read_at) | Recipient reads/marks own; only server/definer code inserts. | Reused. Only `proj_notify()` inserts project notifications (types `project_*`), after re-checking the recipient is still eligible. No email, no scheduled job. |
| Storage buckets | Private buckets, path-based policies for HR; CRM uses quarantine + signed upload + server validation + service-role-only access. | Project files reuse the CRM quarantine pattern (`proj-quarantine` → `proj-files`, no client policies). Downloads go through a route that first reads the file row with the caller's own RLS, then signs a short-lived URL. Client timeline PDFs are generated on demand from the immutable issued payload (no stored copy to leak). |
| `@react-pdf/renderer` | Already a dependency. | Used for the client timeline PDF. No new dependency. |
| Scheduled jobs | Recovery Leave and CRM routes exist, flagged. | None added. Overdue/deadline notifications are deliberately **not** scheduled; documented as a later, separately authorised step. |
| Nav | `Projects & Tasks` is a "Coming soon" non-link module. | Becomes a real module, shown only to people with a Projects grant or a Sales link. |

### Compatibility risks identified (and how each is avoided)

1. **Re-using legacy `projects`** would expose confidential delivery data to all signed-in users → avoided (separate tables).
2. **Privilege defaults**: Supabase grants anon/authenticated broad DML + sequence rights on new objects → every new table/sequence/function is revoked explicitly and re-granted narrowly; a test asserts no DML grants remain for `anon`/`authenticated`.
3. **RLS recursion** between membership, project and task policies → membership checks are SECURITY DEFINER stable helpers; policies call helpers only.
4. **Directory leakage**: row-level security cannot hide columns → summary, member-only and restricted data live in **different tables**.
5. **Commercial leakage**: no Sales value, budget, PO or evidence reference is copied into any Projects table. The handover stores only the opportunity id and reference; commercial reading remains a CRM right. Scope-change cost notes live in a restricted table.
6. **Concurrency**: handover acceptance, booking confirmation, completion take row locks / per-person advisory locks and are idempotent.
7. **Shared HR approval engine** is not touched.
8. **Notifications table is shared with HR** → only additive inserts of new `project_*` types; no schema change.
9. **Hosted previews use live V2 data** → this release adds new tables that do not exist on V2 until the owner applies the migrations; until then the module renders a clear "not installed" notice instead of an error (the nav entry only appears when the Projects tables exist and the person has access).

## 2. Access model

Capabilities live in `proj_company_grants` (user, company, `capabilities text[]`, granted/revoked audit). A grant with an
empty capability list means "Projects access": basic directory only.

| Capability | Meaning |
|---|---|
| `founder` | Implies all. View/manage every project in the company; assign/reassign PMs; delegate capabilities; read audit; see restricted commercial notes; override site conflicts; reopen completed projects. |
| `assign_pm` | Assign/reassign a Project Manager or internal owner; create internal projects. |
| `manage_access` | Grant/revoke Projects access (cannot hand out `founder`/`manage_access`). |
| `approve_scope` | Decide proposed scope changes. |
| `view_commercial` | Read restricted commercial effect notes on scope changes. |
| `view_audit` | Read the Projects audit trail. |
| `reopen_project` | Reopen a completed project (with a reason). |
| `override_site_conflict` | Confirm a site booking that overlaps another, with a recorded reason. |

Founders are *grants*, never hard-coded people. The first founders are bootstrapped by the owner with
`supabase/manual-sql/proj_30_bootstrap_founders.sql` (not run by this release).

### Who can see what

| Data (table) | Founder (company) | PM / acting PM | Department head | Member | Employee with Projects access only | Sales (linked, no member row) |
|---|---|---|---|---|---|---|
| Summary: reference, name, company, kind, status, PM, start/end (`proj_projects`) | all | every ongoing project of the company, and their own at any status | every ongoing project of the company, and their own at any status | every ongoing project of the company, and their own at any status | every ongoing project of the company | only linked projects (any status) |
| Details: client name, location, scope, site timezone, key install/event dates (`proj_project_details`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Members, teams, milestones, deliverables, tasks, discussion, timelines, bookings, feedback | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Handover (member-safe brief, status) | ✓ | the PM it is assigned to | ✗ until project exists, then via details | ✗ | ✗ | own handover |
| Audit | `view_audit` / founder | ✗ | ✗ | ✗ | ✗ | ✗ |
| Restricted scope-change cost notes | `view_commercial` / founder | ✗ | ✗ | ✗ | ✗ | ✗ |

Everyone who holds an active Projects grant in a company sees the **summary** of that company's *ongoing* projects (planning, in
progress, ready for installation, on site, on hold) whether or not they are on the project, and only that: the detail, member-only and
restricted tables stay closed to them (`proj_can_view_summary` versus `proj_can_view_details`, proved in the "review follow-ups" tests for a
PM of another project, a department head, an employee member of another project and a directory-only user). Completed and archived
projects drop out of everyone's summary except founders, members and linked Sales people. Another company's projects never appear.

**Company label.** The company shown on a summary-only page comes from `proj_company_labels()`, which returns a company's legal name only where the
caller holds a Projects grant or can already open one of its projects in summary (so a linked Sales colleague with no Projects grant sees it too, and
only while the link works). It returns the name and nothing else of the company record.

**Discussion history.** The discussion page opens on the latest 100 messages; `proj_messages_before(project, cursor, limit)` pages backwards (50 at
a time, capped at 200) with the same access rule as the live feed, so the oldest message is always reachable and a removed member gets nothing. The
live polling cursor only ever moves on what the live feed returns, never on older pages loaded by hand.

Membership is revocable: setting `removed_at` removes access in the same transaction because every policy and function
evaluates *active* membership (`removed_at is null`) at read time. Notifications for a project are filtered by active
membership when listed, and file/export downloads re-check access each time, so a revoked member loses all of it
consistently.

### Roles inside a project (`proj_project_members.role`)

* `pm` – the accountable Project Manager (or internal owner). Exactly one per project (`proj_projects.pm_user_id`).
* `acting_pm` – temporary project leadership: same project powers as `pm` while `acting_until` (required date) has not passed. No HR meaning.
* `department_head` – head of one `proj_teams` row. Manages that team's deliverables and tasks, accepts its deliverables.
* `member` – reads the workspace and discussion; updates own assigned tasks; creates own tasks; comments.

Members never gain unrestricted edit rights: every write function checks the specific role it needs.

### Sales link

`proj_sales_links (project_id, user_id)` records the Sales relationship **at handover**: the opportunity owner
and the person who prepared the handover. A link gives only the summary row and the handover status; it never gives
membership, discussion, plans or files. It is effective only while that user still holds an active CRM grant for the
company (`crm_has_access`). Later CRM owner reassignment does **not** move or delete links (the project's agreed
history stays intact); a founder or the PM can add/remove a link explicitly. A PM may add a linked Sales user as a
member with the `member` role to let them take part.

### Eligibility to be added to a project

A user can be added as member/department head/PM only if they hold an active Projects grant in that company, or are
an active Sales link for that project. Nothing is inferred from HR role, e-mail domain or employment.

## 3. Data model (all `proj_` prefixed; clients have SELECT only, writes via SECURITY DEFINER functions)

Summary-safe: `proj_projects`. Member-only: everything else about a project. Commercial-restricted:
`proj_scope_change_commercial`.

* Access: `proj_company_grants`, `proj_audit_log`, `proj_company_settings` (reference code), `proj_reference_counters`.
* Projects: `proj_projects`, `proj_project_details`, `proj_project_members`, `proj_teams`, `proj_sales_links`.
* Handover: `proj_handovers` (frozen once accepted).
* Delivery: `proj_milestones`, `proj_deliverables`, `proj_tasks`, `proj_task_collaborators`, `proj_task_dependencies`,
  `proj_task_events`, `proj_task_comments`.
* Plans and site: `proj_plan_items` (delivery/site timeline items, editable templates), `proj_site_bookings`,
  `proj_external_dependencies`.
* Feedback/scope: `proj_feedback`, `proj_scope_changes`, `proj_scope_change_commercial`.
* Discussion: `proj_messages`, `proj_message_mentions`, `proj_read_state`.
* Output/evidence: `proj_issued_plans`, `proj_files`, `proj_upload_intents`, `proj_completions`.

### Dates and time zones

* Task, deliverable, milestone and plan deadlines are **date columns** (no time zone, never shifted).
* Timed events (site bookings, timed site activities) are `timestamptz` plus `tz` (IANA name of the site/event). Display shows the source time zone; "my" views also show the viewer's own time zone. DST and overnight/multi-day events fall out of `timestamptz` + named zone. Allowances (`lead_minutes`, `trail_minutes`) extend the booking range for conflict checks.

### Lifecycle

Client: `planning → in_progress → ready_for_installation → on_site → completed → archived`, plus `on_hold` (reason +
review date, returns to the previous state). Internal: `planning → in_progress → completed → archived` (+ `on_hold`),
with an `is_ongoing` flag for continuing work that is never forced through install/show states. Progress is shown only
as "N of M required milestones accepted"; nothing is computed from elapsed time.

### Workload

Several assignments in one day is never a warning. Only **physical site bookings** are checked for overlap, by booking
type not job title, including preparation/travel allowances, across all projects.

## 4. Key decisions (also recorded in `docs/08-decisions-log.md`)

1. Separate `proj_` tables; legacy `projects` untouched and unlinked.
2. Own grants/capabilities table, mirroring CRM; no hard-coded founders.
3. No commercial data copied into Projects. Commercial reading remains in Sales & CRM.
4. Sales sees only linked projects (recorded at handover); CRM reassignment does not silently change that.
5. Handover acceptance creates exactly one project; the accepted handover is an immutable snapshot.
6. Conflict messages for hidden projects say "another booking you cannot see" and name the resolution path.
7. In-app notifications only. No new e-mail, no new scheduled jobs.
8. Client timeline PDFs: immutable issued payload, rendered on demand; "issued", "sent" and "client accepted" are separate recorded facts; generating a PDF sends nothing.
9. Completion requires evidence; unfinished work must be explicitly cancelled, deferred or resolved; reopening keeps the earlier completion record.

## 5. Not in this release

Inventory, procurement, project accounting/costing, client or vendor portals, e-mail/WhatsApp integrations,
automatic reminders, hourly timesheets, any change to attendance, Recovery Leave or payroll.
