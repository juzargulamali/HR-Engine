# Operations TV: the office board (Phase 3)

Status: **draft PR from `feat/operations-tv` into `main`** (branched from `main` at `491dccf`, the merge of PR #94). Migration `20270110000100_ops_tv_display.sql` is **not applied anywhere by Claude**. Written from the code and the local isolated checks on the same branch; nothing signed in on Preview or on the office TV was seen by Claude. The contract the build followed is `docs/operations-tv-scope.md`.

**What it is.** One dedicated read-only screen, `/tv`, for the office TV. It answers three questions at a glance: **What is happening on site next? Who is going? What could hold it up?** It shows only facts that already live in Projects, the Site schedule, crew, handovers and Inventory. Nothing on the board writes anything, and a Project Manager changes a date, a crew assignment or an equipment request **once**, in the workflow they already use; the board shows it on its next refresh.

## 1. Routes and menu

| Route | What | Who |
|---|---|---|
| `/tv` | The board. `?company=<id>` (Operations Managers of several companies), `?page=<n>` (start page), `?rotate=0` (hold one page) | An un-revoked display of that company; an Operations Manager or founder of that company |
| `/api/tv/board` | The refresh: one bounded read, `Cache-Control: no-store, private, max-age=0`, `Vary: Cookie`. 200 board, 401 signed out, 403 denied or revoked, 503 not installed, 502 transient | Same |
| `/operations/office-board` | **Office board** (Operations menu): add a display, see its state, revoke it | Operations Managers of the company, and founders |
| `/login` | The display signs in here; a display lands on `/tv` | Anyone |

Everything else is closed to a display identity: the proxy (`apps/web/src/proxy.ts`, helper `lib/operations-tv/gate.ts`) sends it back to `/tv`, and the database refuses it on every existing read (below).

## 2. Who may see it, and what the database decides

* **Display identity.** An ordinary sign-in account created for one TV. The service role creates it with `app_metadata.ops_tv = true` (only the service role can set that) and the database registers it in `ops_tv_displays` (user, company, label, office time zone, created by, revoked at, revoked by, last seen). It has **no employee record, no Projects, Sales, Inventory or Phone-system grant and no role**, so every existing read, write and API refuses it through its own check. Row level security is on with no policy and nothing is granted on the table.
* **One read.** `ops_tv_board(company)` returns the allowlist (section 3). It checks on **every** call that the caller is an un-revoked display of that company or holds the `operations` capability of it (a founder counts). Revoking makes the next call fail with `42501` (`revoked`).
* **Other functions** (Operations Managers of the company only): `ops_tv_register_display`, `ops_tv_revoke_display`, `ops_tv_list_displays`; `ops_tv_my_display` tells the page that the caller is a display (so it can say "revoked" instead of "no access"); `ops_tv_person_name` is internal and callable by nobody. All six run as owner with a pinned search path; nothing is callable by `anon`.
* **Company scope.** A display names its own company; a `?company=` that names another is ignored by the page and refused by the database. An ordinary employee, a Projects member without Operations, and another company's Operations Manager are refused.
* **Not cached.** The page and the refresh answer are `no-store`; no shared cache can hold a display response.

## 3. What the board may show (the allowlist)

`generated_at`, `access`, `company {id, name}`, `office_tz`, `display {id, label}`, `truncated`;
`activities[]` (id, project id, reference and name, title, kind, run label, Tentative or Confirmed, phase, venue and where the venue came from, dates and times, zone, lead name, crew names and roles (at most 12), crew total, `call_missing`, run readiness states);
`shipments[]` (label, linked activity and run, departs, arrives, returns, zone, state, and the Inventory request code and state, units short, expected return, overdue);
`projects[]` (reference, name, status, kind, Project Manager name, up to four Project Plan activation titles, next activity, dated activities, project-wide readiness states, equipment summary);
`handovers[]` (reference, title, status, Project Manager name, install start, location, submitted at);
`notes[]` always empty.

**Never returned:** comments, messages, task text, output and file links, commercial values, budgets, HR details, phone numbers, e-mail addresses, any other company's rows. Bounds per read: 300 activities, 100 shipments, 40 projects, 20 handovers; the board says when it is showing the first rows only. The browser flow compares every key in the live response with this list.

**Site notes are off.** No existing field is an approved-for-display flag (`proj_plan_items.notes` is the team's private note; `crew_instructions` is for crew). The gap is stated; notes stay off. Proposal for a later change, **not built:** a `display_note` text on the site activity with an explicit "Show on the office board" tick.

## 4. What the board shows, and the rules it reuses

* **Header:** ENGINIOUS OS lockup, the scoped company, the office clock with its zone, **Last updated**, and Sign out.
* **Next on site (the rail):** setup, show, dismantle and the key shipment movements in date order. Each item reads what and when first (date, then the large time window or "time not set"), then the run and activity, the venue, who is going, then the blocker with the action. Separate runs are separate items ("Run 1 · Setup", "Run 2 · Dismantle").
* **Active projects:** reference and name, Project Manager, the next activities with their runs, where and who, and the most actionable blocker of each run. A project with no dated site work says **No scheduled site work**. Project Plan activations are shown as titles. Submitted handovers awaiting acceptance sit in their own compact group below, with the named Project Manager or "PM not named yet".
* **Readiness and equipment:** run-specific readiness where recorded; project-wide readiness is labelled **Project-wide**; Inventory's own request state with its code (draft, reserved, partially ready, short, dispatched, still out, returned, return overdue); shipment timing conflicts.
* **Phase 2 rules, unchanged:** **Started** needs the explicit start record; a passed date alone reads "Scheduled installation date passed · start unconfirmed"; Tentative, Confirmed and a project-date fallback stay distinguishable; a completed task alone never makes equipment or an output ready. Site times show their zone when it differs from the office's.
* **Blockers, in priority order** (what is missing is said in words, never a decorative badge): **Crew missing**, **Shipment arrival after setup**, **Start unconfirmed**, **Call time pending**, Equipment short or Return overdue, **Not ready**, **Readiness not recorded**. Teal marks the next activity, amber marks what needs attention, always with a text label.

## 5. How it behaves in the room

* **1920×1080 (and wider than 1536 px):** a dark header and a **pinned schedule rail** (a third of the width, four whole items with a soft fade) beside the light project table. Project pages of five projects rotate every **25 s** with a "Page n of m" indicator and a short transition (none under reduced motion); one page stays still. The rail, header and column widths do not move between pages. A pointer resting on the project list holds the page. **4K** uses the room for larger type (the type scales with the width), not more rows. A project shows its next three runs on the TV ("+n more run later").
* **Laptop and tablet:** the rail moves above the board; all runs of a project show; the page scrolls.
* **Phone:** a vertical agenda, then compact project cards, no horizontal scrolling, no rotation.
* **Refresh:** every **60 s** while the page is visible, independent of rotation, one request at a time, one bounded read. A refresh that fails keeps the last good board and shows a **Stale** bar with the last successful time and "Trying again every minute"; the board is also marked stale if nothing succeeded for 150 s. When the display's session ends, its access is revoked or lost, the board is **cleared at once** and says why (Signed out, Revoked, No access, Not installed). A hidden tab refreshes as soon as it is shown again if its board is old.
* **States:** loading, empty ("No scheduled site work", "No active projects"), stale, signed out, access denied, revoked, not installed.

## 6. Set up a display, and revoke it

Set up (an Operations Manager or founder):
1. Open **Operations > Office board** and choose the company.
2. Press **Add a display**. Enter a display name (for example "Office TV"), a sign-in e-mail that nobody else uses and the office time zone.
3. Press **Create display**. The sign-in e-mail and a long random password are shown **once**. Copy the password now; it cannot be looked up later.
4. On the TV's browser open the app's `/login` address and sign in with that e-mail and password. It lands on the board. Bookmark `/tv` and set the browser to open it on start.
5. The page lists the display as Active with "Last seen" once it has loaded the board.

Revoke (to take a TV out of service, or if it is lost): press **Revoke** on the display's row and confirm. The display row is marked revoked in the database first (the board read refuses it on its very next call), the sign-in is blocked (the app's session check then fails for any session already issued). The TV clears within a minute. If blocking the sign-in fails, the page says so and offers **Retry sign-in block**; the board is already refused. A revoked display cannot be un-revoked: add a new one. A **password reset** is done the same way: revoke the old display and add a new one.

## 7. Install order (owner steps; Claude applies nothing on hosted)

1. Run `supabase/manual-sql/ops_tv_display_00_preflight_readonly.sql` and confirm every row is OK.
2. Apply `supabase/migrations/20270110000100_ops_tv_display.sql` (additive: one table, six functions; nothing existing is changed).
3. Run `supabase/manual-sql/ops_tv_display_20_verify_readonly.sql`: rows 1 to 5 must be `OK`; rows 6 and 7 are counts (registered displays; display accounts that also hold a grant, role or employee record, which must be 0).
4. Deploy the build. (Until the SQL is applied the board and the Office board page say "not installed" and nothing else changes.)
5. Create the display on the **Office board** page, and sign the TV in.
6. Rollback: `supabase/manual-sql/ops_tv_display_90_rollback.sql` (stops while a display is active; revoke first). Remove the display accounts in the app or the Supabase dashboard.

## 8. Limits and known gaps

* **Held sessions.** Revocation is enforced by the database on every board read and by blocking the account; a session that was already issued cannot be ended by id, and the other pages are closed to it anyway.
* **One screen, one company.** Several displays per company work; per-display field choices, a combined multi-company screen and anything writable are out of scope.
* **Site notes** are off until a display-note field is agreed (section 3).
* **Run limit on the TV.** The TV shows a project's next three runs and counts the rest; the rail lists the next four items and counts the rest.
* **The local sign-in stand-in** (`packages/e2e-tests/local-stack/local-auth.mjs`) now keeps `app_metadata` the way the hosted service does, because the display account depends on it. It is test infrastructure only.

## 9. Where it lives in the code

`apps/web/src/app/tv/*` (page, client board, styles), `app/api/tv/board/route.ts`, `lib/operations-tv/*` (types, model, refresh states, loader, gate, accounts, fixtures), `app/(app)/operations/office-board/page.tsx`, `components/operations/office-board-forms.tsx`, `lib/actions/operationsTv.ts` (`createDisplayAccount`, `revokeDisplayAccount`), `lib/actions/auth.ts` (a display lands on `/tv`), `proxy.ts`. SQL: `supabase/migrations/20270110000100_ops_tv_display.sql`, packs `supabase/manual-sql/ops_tv_display_*`. Tests: `packages/rls-tests/test/ops-tv-display.rls.test.ts`; web unit tests beside each file; browser flow `apps/web/os-shell-checks/project-ops-tv-flow.mjs` on the fixture `seed/ops-tv.sh`.

## 10. Standing the board up on the 65-inch office TV (checks from normal viewing distance)

1. On the TV's browser, sign in as the display and open `/tv`. Use the browser's full-screen or kiosk mode; make sure the TV is set to 1920×1080 (or 3840×2160) with no overscan and that the browser zoom is 100%.
2. From the usual viewing distance (about 3 metres), read aloud, without leaning in: the date and time of the next activity, its venue, who is going, and the first blocker. If any needs leaning in, note which and its size.
3. Watch one full rotation (about 25 s per page with five projects per page): the left rail must not move; the page indicator must change; no text may be cut off at the bottom edge.
4. Change a date in the Project's Site schedule from a laptop; within about a minute the board must show the new date under the same run, and **Last updated** must advance.
5. Unplug the TV's network for two minutes: the board must keep the last good view with a **Stale** bar showing the last successful time; reconnect and the bar must clear within a minute.
6. Revoke the display from **Operations > Office board**: the TV must clear within a minute and say why.
7. Note any glare or contrast problems (amber on the light table, teal on dark) and the brightness setting used.
