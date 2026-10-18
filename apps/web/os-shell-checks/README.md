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
node os-shell-checks/shell-checks.mjs                        # navigation per persona, Coming soon, titles, mobile bar/drawer, keyboard, theme persistence,
                                                             # clock status, /os-preview blocked
node os-shell-checks/contrast-audit.mjs out.json ceo@e2e.local desktop   # rendered WCAG contrast of every text node on ~35 pages x 2 themes
node os-shell-checks/screenshots.mjs out-dir                 # dashboard, Sales opportunity, attendance, Sales list, mobile menu; dark + light
```

`contrast-audit.mjs` walks every visible text node, resolves its real foreground and the real background behind it (compositing
translucent layers), and fails anything under 4.5:1 (3:1 for large text). It also records how strongly input borders stand out.
The token-level guard that runs in CI is `src/app/theme-contrast.test.ts`.
