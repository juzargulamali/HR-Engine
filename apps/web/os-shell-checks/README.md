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
node os-shell-checks/projects-flow.mjs                      # Projects & Tasks end to end (needs the Projects seed: see below): Sales handover, PM acceptance, team, milestones, tasks and review,
                                                             # timelines, site bookings and overlaps, calendars, discussion, scope change, client timeline PDF, completion and reopening, internal project
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

`phone-fit.mjs` and `contrast-audit.mjs` cover the list, board, side panel, Quick Add and menu states of the new Sales and Projects workspaces
(and skip a panel only where the signed-in person legitimately has no access, for example Sales for a Projects-only user).
