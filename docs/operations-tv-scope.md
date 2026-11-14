# Phase 3: Operations TV (the office board)

**Status:** draft PR from `feat/operations-tv` into `main` (after PR #94, merge `491dccf`). One dedicated URL, `/tv`, one company-scoped display. Read-only: nothing on the board writes anything.

**The three questions it answers at a glance:** What is happening on site next? Who is going? What could hold it up?

## 1. Where the facts already live (traced before building; nothing here is a new record)

| Board area | Existing record or read | Notes |
|---|---|---|
| Next on site | `proj_plan_items` (plan = `site`: `activity_kind`, `run_label`, `location`, `start_date`/`end_date`, `starts_at`/`ends_at`, `tz`, `activity_state`, `actual_started_at`), read through `proj_site_activities_read` and the phase function `proj_site_phase_json` (Phase 2) | Started only from the explicit start record; a passed date with no record is "start unconfirmed"; header-date fallback is labelled; separate runs stay separate rows (the TV shows a project's next three runs and counts the rest; laptop, tablet and phone show every run) |
| Who is going | `proj_site_crew` (role, personal `call_at`/`call_tz`), activity owner as the site lead, names via `proj_display_name` | Names and roles only. No phone, e-mail or HR detail |
| Active projects | `proj_projects` (status not completed, archived or cancelled), PM name, Project Plan activations (`proj_dp_items` titles) | Titles only; no values, files or comments |
| Readiness | `proj_activity_readiness_effective` (run-specific, PM value or linked evidence, Not recorded or Not applicable) and the project-wide counts, labelled as such | A completed task alone never makes an output approved or equipment ready |
| Equipment and shipments | `proj_site_shipments` (label, linked activity, departs, arrives, returns, state) and the Inventory request it carries through `inv_request_state` (draft, reserved, partially ready, short, dispatched, still out, returned, with the request code) | Inventory's own states; arrival after setup is computed from the two dates |
| Handovers | `proj_handovers` with status `submitted`, `pm_assigned` or `clarification_requested` | Compact separate group; title, reference, location, install date, named PM or "PM not named yet" |
| Site notes | No existing field is an approved-for-display flag (`proj_plan_items.notes` is private to the team; `crew_instructions` is for crew) | **Gap.** Notes stay off the board. Proposal: a `display_note` text with an explicit "show on the office board" tick on the site activity, agreed before building |

## 2. Access model (the database decides; the screen only mirrors it)

* **Display identity.** A normal sign-in account created for one display, registered in a new table `ops_tv_displays (user_id, company_id, label, office_tz, created_by, created_at, revoked_at, revoked_by, last_seen_at)`. It has no employee record, no Projects grant and no other permission, so every existing read and API refuses it through its own checks. The account carries `app_metadata.ops_tv = true` (set only by the service role at creation) so the app's proxy can restrict it to the board without a database call.
* **Who else may open the board:** an Operations Manager or founder of that company (they already see all of it in Operations Overview). Nobody else: the board is wider than a project member's own view.
* **One database read, `ops_tv_board(company)`,** returns an allowlist of display fields (section 3). It checks on every call that the caller is an un-revoked display of that company, or holds the `operations` capability for it. Revoking a display (`ops_tv_revoke_display`) makes the next call fail with `42501`; the app also bans the auth account and ends its sessions.
* **App routes:** `/tv` (the board), `/api/tv/board` (the refresh, `Cache-Control: no-store`, one bounded read), plus `/login` and sign-out. The proxy sends a display identity anywhere else back to `/tv`.
* **Not in scope:** several displays per company, per-display field choices, anything writable.

## 3. The display allowlist (what `ops_tv_board` may return, and nothing else)

`generated_at`, `access` (`display` or `operations`), `company {id, name}`, `office_tz`, `display {id, label}` (display identities only), `truncated {activities, projects, shipments}`;
`activities[]` {id, project_id, project_ref, project_name, title, kind, run_label, state (tentative or confirmed), phase {phase, basis, first_day, last_day, started_at, choice_pending}, venue, venue_source, start_date, end_date, starts_at, ends_at, tz, lead (name only), crew [{name, role}] (at most 12), crew_total, call_missing, readiness {hardware, content, app} (states only)};
`shipments[]` {id, project_id, project_ref, project_name, label, activity_id, activity_title, run_label, departs_at, arrives_at, returns_at, tz, state, request {code, state, units_short, expected_return_at, return_overdue}};
`projects[]` {id, ref, name, status, kind, pm_name, activations [{title}] (at most 4), next_activity_id, dated_activities, project_readiness {hardware, content, app} (project-wide), equipment {requests, worst_state}};
`handovers[]` {id, reference, title, status, pm_name, install_start, location, submitted_at};
`notes[]` always empty until a display-note mechanism is agreed.

**Never returned:** comments, messages, task text, output and file links, commercial values, budget, HR details, phone numbers, e-mail addresses, any other company's rows.

Bounds: 300 activities, 100 shipments, 40 projects, 20 handovers per read.

## 4. Rules the board reuses (Phase 2)

* **Started** needs an explicit start record. A passed scheduled date alone reads **Start unconfirmed** ("Scheduled installation date passed · start unconfirmed").
* **Tentative**, **Confirmed** and a **project-date fallback** ("from the project header") stay distinguishable. Separate runs of one project are separate rows.
* Unknown crew, call time or readiness says what is missing: **Crew missing**, **Call time pending**, **Readiness not recorded**. **Shipment arrival after setup** is raised when a shipment's arrival is later than the start of the setup it supports.
* Site times carry their zone when it differs from the office's (default `Asia/Dubai`).

## 5. Behaviour of the board

* 1920×1080: dark Enginious header (name, company, Last updated) and a **pinned schedule rail** beside the light project board. Rail: what and when, then where and who, then the blocker or next action. The rail lists the next four items whole (with a soft fade at its foot and a "+n more later" count) and does not rotate. The TV shows each project's next three runs and counts the rest; laptop, tablet and phone show all runs of a project. Project pages rotate every ~25 seconds with a page indicator and a short transition (none under reduced motion); one page stays still. 4K uses the room for larger type, not more rows.
* Laptop and tablet: the rail moves above the board. Phone: a vertical agenda and compact project cards, no horizontal scrolling, no rotation (people scroll at their own pace).
* Refresh about every 60 seconds while visible, independent of rotation, one request at a time. A transient failure keeps the last good board with a **Stale** warning and its time. Session expiry, sign-out, access loss or revocation clears the board at once and says why.
* States: loading, empty (no scheduled site work), stale, access denied, revoked, not installed.

## 6. Install, verification and rollback (SQL)

Migration `20270110000100_ops_tv_display.sql` (additive: one table, six functions, five callable). Packs under `supabase/manual-sql/ops_tv_display_*`. Order: preflight, migration, verify, deploy. Rollback drops the functions and the table (the display accounts themselves are removed in the app or the Supabase dashboard). Display account setup and revocation: see the staff guidance topic "Office board" and section 7 of the Operations module reference.

## 7. What is verified where

**Local isolated stack (throwaway database, fictional data; run by Claude on the final code of the draft PR):**

* Database: the full suite, 84 files and 2,085 tests, passes, including `ops-tv-display.rls.test.ts` (17 tests: revoked and wrong-company displays are refused, a display reads nothing through the existing project reads, the allowlist, a display cannot register or revoke).
* Web: type check and lint clean; 322 files and 3,637 tests pass; JARVIS guidance tests pass after the published guidance was regenerated.
* Browser: `os-shell-checks/project-ops-tv-flow.mjs` on the fixture `seed/ops-tv.sh`, 14 of 14: the founder adds a display through the real Office board screen; the display signs in and lands on the board; the live response holds only allowlisted keys and is `no-store, private`; the RAF-style project keeps four runs apart; Crew missing, Call time pending, Shipment arrival after setup, Start unconfirmed (a passed date never reads Started) and a recorded start read from the source records; Inventory's request code and state appear; one edit by the Project Manager (the Dismantle date and one call time, in the Site schedule and Crew dialogs) appears under the right run after one refresh and nothing else moves; the rail and column widths do not move while pages rotate and one page stays still; layouts at 1920×1080, 3840×2160, 1440×900, 820×1180 and 390×844 have no horizontal scroll and the long project name never hides the time or blocker; a failed refresh keeps the last good board with a Stale bar and its time, and the next good refresh clears it; a display is sent back to the board from every other page, existing APIs answer 403, a display reads no project rows and cannot revoke itself, and another company's board is refused; revoking clears the board and the account cannot sign in again; an Operations Manager opens the same board with no writable control.
* Regression: `project-phase2-finish-flow` 12 of 12 and `project-phase2-queues-flow` 10 of 10 pass on the same build (the proxy and sign-in action changed).
* Screenshots (fictional data): `docs/operations-tv-screenshots/`: the busy 1920×1080 board (two pages, after the Project Manager's edit, Stale, revoked), 4K, desktop, tablet, phone (agenda and projects), and the Office board screens.

**Not verified by Claude (owner steps):** hosted SQL (preflight, migration, verify); signed-in Preview with a real display account; Production; the 65-inch office TV from the normal viewing distance. The steps are in `docs/enginious-os/modules/operations-office-board.md` section 10 and the PR description. The local sign-in stand-in now keeps `app_metadata` the way the hosted service does; how the hosted service behaves for a banned account's already-issued session is **Unverified** by Claude (the board itself refuses a revoked display on its very next read).
