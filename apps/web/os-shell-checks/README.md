# ENGINIOUS OS shell: browser checks (local stack only)

Scripts that drive the real, signed-in application in a real browser. They are **not** part of CI and they **write** to the
database of the app they drive (they create an enquiry, move it through its stages, close and reopen it), so they refuse to run
against anything but `http://127.0.0.1` / `localhost`. Run them against the repository's local full stack
(`packages/e2e-tests/local-stack`, a throwaway Postgres + PostgREST + local sign-in), never against Production or any hosted project.

```bash
# 1. local stack + CRM test grants (founder ceo@, Sales mgr@ and emp@) and company settings, then the app
packages/e2e-tests/local-stack/reset.sh        # see its README for POSTGREST_BIN etc.
#   insert crm_company_grants / crm_company_settings rows for the seeded UAE company (local test data only)
cd apps/web && VERCEL_ENV=production npx next build && VERCEL_ENV=production npx next start -p 3000 -H 127.0.0.1

# 2. checks (each prints PASS/FAIL lines and a verdict)
node os-shell-checks/sales-actions.mjs                       # the real Sales operations end to end (create, stages, hold, availability, links,
                                                             # proposal, Zoho reference, contacts, Won + handover, founder reopen, reports)
node os-shell-checks/sales-workspace.mjs                     # the simplified Sales workspace (needs the sample scenario below, reseed before each run): Follow-ups groups, completing a
                                                             # follow-up never marks Won, Enquiries table (search, filters, sort, Columns), Table/Board, side panel (?open=, Back, unsaved
                                                             # prompt, stale edit), Board moves and refusals, Quick Add, owner picker, authorisation boundaries
node os-shell-checks/sales-crm-readiness-flow.mjs           # Sales & CRM staff-readiness walk-through (needs `seed/sales-readiness.sh`, reseed before each run; writes to the database it drives; fictional data, nothing sent, no Zoho; SHOTS_DIR, light, 1440x900):
                                                             # ONE enquiry from creation to a project with SEPARATE accounts: emp@ creates it, My Day's "due today" link lands on the Follow-ups Today view; an estimate is built and finalised (freezes only);
                                                             # an ordinary proposal is recorded as sent (an estimate cannot, EST01), replacement and the superseded starting statuses; the Zoho form with two people saving DIFFERENT fields at once
                                                             # (both kept), a stale edit of the SAME field refused, an intentional clear, Quote sent refused without the reference and allowed with it, then (decision B) emptying the quote reference at Quote sent refused in words and a correction accepted, and with the save function renamed away the form says saving is temporarily unavailable and writes nothing; Mark Won (the date limit is the Dubai day, the database
                                                             # refuses a future date with no side effect); handover: emp@ saves and submits, the founder assigns, a colleague and even the founder cannot accept, only mgr@ (the assigned PM) accepts, ONE project
                                                             # after a double click and a repeat call; Reports (readable source names); then failed reads provoked on the local database (a read policy that raises, a revoked read) on the Enquiry, Close and
                                                             # Handover pages, one enquiry section and one Reports card: "Could not load", no dependent action, and normal again afterwards
node os-shell-checks/jarvis-flow.mjs                        # JARVIS part 1 (the assistant) on the isolated stack with the SIMULATED provider (no AI provider is called; needs `seed/jarvis.sh`, reseed before each run; writes to the database it drives; fictional data; SHOTS_DIR, desktop 1440x900 and phone 390x844, light and dark):
                                                             # default OFF = no launcher and ordinary Sales works; the owner's documented SQL switches the pilot on; the launcher only for pilot people with a Sales grant; open, Escape, focus return, keyboard;
                                                             # "what can you do?"; a fictional agency brief -> review card -> a clarification answered -> a field edited -> explicit confirmation with a double click -> the real reference and the enquiry page (timeline says created through JARVIS);
                                                             # a lost answer after the save -> "Checking the original result" -> exactly one enquiry; a likely duplicate needs acknowledging; refusals in words (payroll text, company moved out of the pilot after the review, grant revoked after the review, write kill switch);
                                                             # JARVIS switched off and ordinary Sales & CRM unchanged, a direct database call refused, a DIRECT call to the platform API by an eligible pilot person with an invented proof refused for every write wrapper (nothing created, no confirmed ledger row), and the REVIEW TOKENS lifted from the browser session's own proposal responses used against every wrapper as the MAC, with their own fields, a fresh confirmation id or their body as the payload (90 direct calls, all refused, nothing created: the browser holds no database proof); screenshots and the 20 px mark in both themes. Start the app with the simulated provider (a production build needs the explicit local-stack switch):
                                                             #   export JARVIS_PROVIDER=simulated JARVIS_ALLOW_SIMULATED_ON_LOCAL_STACK=1 JARVIS_CONFIRMATION_SECRET=<32+ characters>; os-shell-checks/seed/jarvis.sh (it gives the database the SAME value, which derives and stores only the proof key: the owner step of the confirmation boundary); os-shell-checks/stack.sh build; os-shell-checks/stack.sh start
node os-shell-checks/jarvis-sales-flow.mjs                  # JARVIS part 2 (the other Sales actions) on the isolated stack with the SIMULATED provider (needs `seed/jarvis.sh`, reseed before each run; writes to the database it drives; fictional data; SHOTS_DIR, desktop 1440x900 and phone 390x844):
                                                             # draft a reply (unconfirmed price, date and availability listed above the draft; nothing written), help from reviewed guidance, register a client or agency (search, then a separate typed confirmation, a
                                                             # same-name organisation needs a tick), update an enquiry (before/after, one save changes only those fields, a stale review refused), change status (evidence and effects shown, Won/Lost/hold never offered, a
                                                             # non-owner and a stale card refused), meeting notes (activity and follow-up saved together, a vague date asked for not guessed, a Won enquiry takes no follow-up), access revoked and the write switch, JARVIS off
                                                             # and ordinary Sales & CRM unchanged, every wrapper refused when called directly with JARVIS off; same environment variables as jarvis-flow.mjs
node os-shell-checks/projects-flow.mjs                      # Projects & Tasks end to end through the simplified screens (needs the Projects seed: see below; reseed before each run): Sales handover,
                                                             # PM acceptance, team, milestones (Plan menu), Add task, in-place status and review rules, due-date change with dependents, Plan (Delivery / Site,
                                                             # List / Calendar / Timeline, legacy addresses), site bookings and overlaps, Quick Add internal project, calendars, summary-only access,
                                                             # discussion, scope change, client timeline PDF, completion, reopening (Manage menu)
node os-shell-checks/projects-workspace.mjs                  # the simplified Projects workspace (needs the sample scenario below, reseed before each run): directory table (search, filters, sort), Board and its status
                                                             # form, summary panel, Next milestone only for members and founders (also absent from the page HTML), My Work (filters, Board, columns, My projects),
                                                             # quick changes by role, task panel (Back, direct address, unsaved text, stale edit), Work grouping, review queue, Jump to task, Manage menu,
                                                             # cross-company isolation, revoked grant and membership, HR tables unchanged
node os-shell-checks/my-day-checks.mjs                       # the new My Day (needs `seed/my-day.sh`, reseed before each run; read-only): one greeting, People & HR below with no figure shown twice, each figure equals what that person's own session can read (counted in the database as that person), live clock count vs recorded attendance, widgets only for people whose access allows them, company boundary, phone order and no sideways scroll
node os-shell-checks/rollout-checks.mjs                     # Stage 4-7 interaction rules across modules (needs `seed/my-day.sh`, which builds the sample scenario plus Inventory; read-only): rows and cards open
                                                             # their record from the empty part (Sales enquiries, board, follow-ups; Inventory items, requests, movements; Employees, Policies; phone cards),
                                                             # controls inside a row do only their job, Ctrl-click opens a new tab, status words carry a colour cue, back links keep the filters and the
                                                             # place in the list, stacked phone tables carry their column names, and the no-access / not-found cards
node os-shell-checks/page-survey.mjs                        # visits every signed-in page as one person (PERSONA, THEME, WIDTH, OUT env vars), records status, console errors, sideways scroll and a screenshot of each
node os-shell-checks/rollout-screenshots.mjs                # the representative screenshots of the Stage 4-7 pull request (docs/os-rollout-screenshots)
node os-shell-checks/people-access-flow.mjs                  # People & Access (seed with `seed/budget.sh`, reseed before each run): the System Administrator sees accounts and HR roles but no Module access tab; a Sales and Projects founder gives presets
                                                             # on top of what a person has (shown first, nothing removed), a stale form is stopped, the database's own refusal is shown, removal asks first; a budget
                                                             # access manager gives and adds budget rights and meets the last-manager protection; an HR Admin edits job title, department and reporting line (audited,
                                                             # reporting circles refused) and sees no addresses, accounts or roles; everyone else has no menu entry and is told there is nothing to manage; old addresses redirect
node os-shell-checks/people-access-screenshots.mjs out-dir   # the representative screenshots of People & Access (docs/people-access-screenshots)
node os-shell-checks/inventory-workspace-flow.mjs           # the simplified warehouse day on the REAL screens (needs seed/inventory.sh; RESEED=1 reseeds; writes to the database it drives): Today (one row per job, the warehouse named),
                                                             # the request workspace Prepare -> Send out -> Receive back (reserving sends nothing; a partial dispatch is flagged and recorded against the request; a partial return needs a
                                                             # condition and is recorded against the project, counted stock is never attributed to a request line), Owned/Rented when receiving, the item panel's actions and the
                                                             # unplanned-dispatch wording, the warehouse switcher, old addresses redirecting, and what a Project Manager, a plain employee, a custody reader and a person with no access get
node os-shell-checks/inventory-returns-and-links-flow.mjs # focused follow-up check (needs seed/inventory.sh; RESEED=1 reseeds; writes to the database it drives): the request panel and Project -> Equipment say the same honest thing about returns as the workspace (counted stock sent for two requests listed ONCE for the project, a single-request item keeps its figures, units untouched), for the founder (can read stock) and the Project Manager (cannot);
                                                             # and old labels/QR codes/bookmarks (/inventory/scan?c=, /inventory?unit|open|action|codes|project|q|tracking=, /inventory/employees, /inventory/movements) keep every parameter and open the right record, also after signing in from signed out, without recording a movement
node os-shell-checks/inventory-transfer-location-flow.mjs   # physical location versus ownership (needs seed/inventory.sh; RESEED=1 reseeds; writes to the database it drives): equipment owned by one company, kept in another company's warehouse, moved Dubai to Riyadh through Send, In transit, Receive: same barcode, serial and owner; source stops showing it as available at send, destination shows it (Owned by ...) only after receipt; scan resolves the same unit before and after; a person without the owner's grant reads nothing of it; PART 2 across companies (needs migration 20261218000100): equipment owned by one company sent Dubai to a warehouse run by another company with sharing authorised, seen as incoming by a person who works there only (minimum fields, 'Owned by', no cost, none of the owner's other units), received through the screen, traced by both sides through dispatch and receipt, and refused to everyone else; revoking the authorisation AFTER dispatch strands nothing (counted cards sent, sharing revoked, the receiving operator still sees them and the laptop with "Sharing revoked—contact owner", receives them, reads "N × item · Owned by ... · at the hub"; new dispatches refused; authorising again clears the flag)
node os-shell-checks/inventory-live-screenshots.mjs out-dir   # the representative screenshots of those real screens (docs/inventory-simplification-screenshots/live), desktop and phone, dark and light
node os-shell-checks/inventory-concept-checks.mjs out-dir       # the Inventory simplification CONCEPT (fictional data, no sign-in, no database; run against `next dev` with OS_PREVIEW_ENABLED=1, BASE_URL=http://127.0.0.1:3100): Today (groups, row click, switcher, failed source, single warehouse), Prepare, Send out (flags before confirmation), Receive back (condition required), Stock and Receive stock, Scan, History, Manage; axe, phone overflow, console errors; dark + light, desktop + phone
node os-shell-checks/nav-smoke.mjs                          # small navigation smoke check of the shared shell (read-only): every module is reachable by clicking, every link the shell offers renders (founder, employee, Sales manager; desktop and phone)
node os-shell-checks/a11y-states.mjs                         # keyboard and focus (Tab reach, focus ring, dialog focus and Escape, panel focus and return, Board Move to, My Work status),
                                                             # axe (WCAG 2.1 A/AA + best practice, serious/critical) on 13 pages x desktop/phone x dark/light, and "an error is not an empty list":
                                                             # with OUTAGE_STOP_CMD / OUTAGE_START_CMD set it stops the data service while pages load (needs the sample scenario)
node os-shell-checks/shell-checks.mjs                        # navigation per persona, Coming soon, titles, mobile bar/drawer, keyboard, theme persistence,
                                                             # clock status, /os-preview blocked
node os-shell-checks/phone-fit.mjs                           # 360 and 390 px, dark + light, 26 pages: no horizontal scroll, no clipped bottom-bar label, nothing under the bar
node os-shell-checks/contrast-audit.mjs out.json ceo@e2e.local desktop   # rendered WCAG contrast of every text node on ~35 pages x 2 themes
node os-shell-checks/screenshots.mjs out-dir                 # dashboard, Sales opportunity, attendance, Sales list, mobile menu; dark + light
```

`contrast-audit.mjs` walks every visible text node, resolves its real foreground and the real background behind it (compositing
translucent layers), and fails anything under 4.5:1 (3:1 for large text). It also records how strongly input borders stand out.
The token-level guard that runs in CI is `src/app/theme-contrast.test.ts`.

## Projects & Tasks seed (local stack only)

`projects-flow.mjs` expects, in the throwaway local database: the Sales grants of the CRM seed (ceo@ founder; mgr@ and emp@ plain), a Sales
reference code, Projects access (`proj_company_grants`: ceo@ founder; mgr@ = the Project Manager, lead@ = a department head, hr@ = a project
member who is also an HR admin, hr1@ = directory only; admin@ none), `proj_company_settings` (UAE), and one **Won** opportunity owned by emp@. It then
does everything else through the real screens. `phone-fit.mjs` and `contrast-audit.mjs` include the Projects pages when a project exists.

## Sample scenario (local stack only)

`sales-workspace.mjs`, `workflow-steps.mjs` and the Projects checks expect the shared sample scenario: the Projects seed above plus four open
enquiries owned by emp@ (one overdue, one due today, two upcoming), a Won enquiry with an accepted handover, one client project with a
Programming team, tasks (one overdue, one waiting for review) and a short discussion. `sales-actions.mjs` instead starts from the Sales grants
only (an empty Sales database). Both write to the database they drive: reseed before every run.

`seed/jarvis.sh` is the start of `jarvis-flow.mjs` (Sales settings for the UAE and the Polish company, Sales grants for emp@ (both companies), mgr@ and ceo@, one fictional agency and one fictional end client, no enquiry, JARVIS left OFF). `seed/sales-readiness.sh` is the start of `sales-crm-readiness-flow.mjs` (Sales and Projects grants for separate people, one fictional client, no enquiry). `seed/sales.sh` is the Sales-only start of `sales-actions.mjs` (grants for ceo@, mgr@, emp@ and the UAE settings). `seed/base.sh` is the Projects seed (Sales and Projects grants and one Won
enquiry). `seed/scenario.sh` builds the whole sample scenario above through the real functions as the real people (it runs `seed/base.sh` first). `seed/inventory.sh` is the Inventory
scenario (it also runs `seed/base.sh`). Each of them resets the database, so run exactly one before a check.

`phone-fit.mjs` and `contrast-audit.mjs` cover the list, board, side panel, Quick Add and menu states of the new Sales and Projects workspaces
(and skip a panel only where the signed-in person legitimately has no access, for example Sales for a Projects-only user).

## Inventory workflow checks (local stack only)

Real-browser workflows of the Inventory module, each driven as the real people and confirmed in the database. They need the Inventory seed
(`seed/inventory.sh`, which also builds the Won opportunity of `seed/base.sh`) and **write** to the database they drive, so each one reseeds
itself first when run with `RESEED=1` (the app keeps running: it holds no database state). Screenshots go to `docs/inventory-screenshots/`
(`SHOTS_DIR` overrides). Shared plumbing is in `inventory-flow-lib.mjs`.

```bash
node os-shell-checks/inventory-smoke.mjs                                 # every Inventory screen opens without errors
RESEED=1 node os-shell-checks/inventory-flow-1-stock-to-reconcile.mjs    # opening count, labels (QR decoded), project request, reserve, partial dispatch,
                                                                         # partial return (good + damaged), outstanding, final reconciliation, ledger check
RESEED=1 node os-shell-checks/inventory-flow-2-employee.mjs              # employee request, issue, My equipment, HR view, reserve refusal, return, reassign, leaver, no private data
RESEED=1 node os-shell-checks/inventory-flow-3-sales.mjs                 # Sales check card, template, out of date, no cost/custody in Sales, winning, handover import once
```

Each prints PASS/FAIL per step and a verdict, and exits non-zero on a failure. `stack.sh reset|build|start|stop|all` rebuilds the stack after code changes.

### Inventory workflow checks 4 and 5 (transfers, conflicts, access)

```bash
RESEED=1 node os-shell-checks/inventory-flow-4-transfer-and-conflicts.mjs   # ONLY=A1,A2,A3,A4 runs sections
                                                                           # A1 project A -> project B in one movement (UI), a third project's reservation never displaced, destination rule
                                                                           # A2 overlapping reservations refused in words, extension that collides displaces nobody, two sessions race for the last unit / last quantity
                                                                           # A3 Dubai -> Riyadh: in transit, not reservable at Riyadh, Dubai-only operator cannot receive, partial receipt, overdue never ready
                                                                           # A4 Poznan time zone across the last Sunday of March / October (browser clock deliberately New York), UTC stored
RESEED=1 node os-shell-checks/inventory-project-notes-flow.mjs            # dispatch notes and return checklists (notes switched on for the AE company with the founder function inv_set_project_notes): Send out -> success panel with the
                                                                           # numbered PDF (downloaded, read with pdftotext / pdffonts / pdfimages) -> PM pending on My Day and Project -> Equipment -> acknowledge -> warehouse sees the status
                                                                           # in History and the PDF names the PM -> return checklist -> PM reports a difference -> Today row -> warehouse answers ("the record stands", then "Corrected": a NEW note cites the old one, the old note and its events unchanged); custody unchanged throughout; who may read
                                                                           # the PDF; light/dark, phone width, axe; switch OFF: nothing new shows. OUTAGE_STOP_CMD / OUTAGE_START_CMD add the "could not load" section.
RESEED=1 node os-shell-checks/inventory-flow-5-access.mjs                   # ONLY=B1..B9 runs sections
                                                                           # menu entries per person, pages and page HTML, direct PostgREST calls with each person's real token (functions, tables, read-only),
                                                                           # costs (founder only, explicit view_costs grant on the Access page), locations, another company and the sharing row,
                                                                           # access revoked while a page is open, direct addresses and the signed-out scan address, no automatic grants
```

`inventory-flow-lib.mjs` also exports `rpc` / `rest` / `tokenFor` (sign in through the local gateway as the app does, then call `/rest/v1/...` with that token): this is how the
checks prove that the DATABASE, not the page, refuses a wrong-role action.

### Inventory accessibility, scanning and screenshots

```bash
node os-shell-checks/inventory-a11y.mjs            # keyboard + focus, axe (serious/critical) on 22 Inventory pages x desktop/phone x dark/light, and the outage check:
                                                   # it stops PostgREST, expects "Could not load" (never "no items" / "no access"), then starts PostgREST again with the same
                                                   # settings as local-stack/start.sh and REWRITES /tmp/inv-stack/postgrest.pid so a later stack.sh reset can stop it
node os-shell-checks/inventory-scan-camera.mjs     # scanning with a SIMULATED camera (see the warning below)
RESEED=1 node os-shell-checks/inventory-screenshots.mjs   # dark-*, light-* (1280 px) and mobile-* (390 px) PNGs of every Inventory screen into docs/inventory-screenshots/
```

**The scan check uses a synthetic camera inside Chromium** (a QR video generated by ffmpeg from the label payload, fed with
`--use-fake-device-for-media-stream --use-file-for-fake-video-capture`). It is NOT a phone camera. Real iPhone Safari and Android Chrome scanning (focus, glare, small
printed labels, the browsers' own permission prompts) is not verified by any script here and still needs a real phone.


node os-shell-checks/project-phase2-finish-flow.mjs         # Finish Phase 2, role by role (needs `seed/project-plan.sh`, reseed before each run; writes to the database it drives; fictional data; SHOTS_DIR): the Project Manager's Preview briefing equals the technician's phone view; a passed date never reads as started and only an explicit record does; the provisional note names who to contact; call time is not the activity start; a confirmed date or venue move notifies only the affected crew with previous and new values; Operations lists each dated activity once with its exact link, keeps the company visible, links the equipment request and shows both commitments of a staffing overlap; Files & client plan chooser with a frozen issued version that still opens
node os-shell-checks/project-phase2-queues-flow.mjs         # Finish Phase 2 queues (needs `seed/project-plan.sh`, reseed before each run; writes to the database it drives; fictional data): a Project Manager's output waits on Operations with the exact version link, the author side cannot self-review, the assigned reviewer reaches the exact version from My Day, Operations and My Work, changes requested follows across views, the Projects list next commitment and Manage team, and the Projects list and Calendar Agenda on a phone

node os-shell-checks/project-main-compat-flow.mjs        # compatibility smoke test of a PREVIOUSLY DEPLOYED build (for example main in a separate checkout) against a database built from ALL current migrations (needs `seed/project-plan.sh` from this checkout, reseed before each run; writes to the database it drives; fictional data): pages open, an ordinary project edit that fires the new crew-notice trigger saves, what the crew would see on that build
