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

`seed/sales.sh` is the Sales-only start of `sales-actions.mjs` (grants for ceo@, mgr@, emp@ and the UAE settings). `seed/base.sh` is the Projects seed (Sales and Projects grants and one Won
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

