# ENGINIOUS OS: the real application shell

This integrates the approved ENGINIOUS OS interface into the authenticated application (the HR pages and Sales & CRM), and makes
both themes easier to read. It is an interface change only: no migration, no change to any HR calculation, approval route,
permission or scheduled job. `/os-preview` stays what it was, a separate fictional preview that is hidden in Production.

## What changed

| Area | Change |
|---|---|
| Branding | Browser title `<page> · ENGINIOUS OS` (default `ENGINIOUS OS`), sidebar, sign-in, set-password and the global error page now say ENGINIOUS OS. Page-specific titles are kept and extended to the main pages (e.g. `Leave · ENGINIOUS OS`). URLs, authentication, the repository, the Supabase project and all technical identifiers keep their names. Email bodies were not touched. |
| Navigation | Module sidebar: **My Day**, **Approvals** (only for people who can decide or have something waiting), **Sales & CRM** (only with a Sales grant, with Overview, Opportunities, Pipeline, New enquiry, Follow-ups, Proposals & quotes, Clients & contacts, Reports, and Settings / Access only for people who can use them), **People & HR** (every existing HR link, same permission checks, grouped Me / People / Workflow / Organisation / Insights / System), **Projects & Tasks**, **Inventory**, **Vendors & Purchasing** (each shown as "Coming soon", not a link) and **KPIs & Performance** (the existing HR appraisals and goals stay reachable as "Performance reviews (HR)"; "KPIs" is marked Coming soon). The collapsible icon rail still works. `nav-groups.ts` builds all of this from the person's real HR roles and Sales grants, and `nav-groups.test.ts` proves no link is lost and none is granted. |
| Header | Breadcrumb (`Sales & CRM / Opportunities`), search (the existing Ctrl/Cmd+K jump, which lists only pages the person can reach), a compact attendance status for employees (`Clocked in · 1h 28m` or `Not clocked in`, text not colour, one tap to the real clock page where Clock In / Clock Out remain), alerts for people who may see them, and the theme toggle. |
| Phones | A menu button (drawer with the full module navigation) and a bottom bar: My Day, Sales (only with a Sales grant), Clock (employees only; reads "Clocked in" while clocked in), People, More. The old floating Clock button is gone, so nothing floats over a page's own buttons; pages reserve space under the bar. |
| My Day | The old dashboard, reorganised and extended with real data only: greeting, date/time/weather, "Needs you today" (approvals waiting on you, HR alerts for people allowed to see them, and for people with a Sales grant their overdue and due-today follow-ups and enquiries awaiting a first response, using the same loaders and rules as the Sales overview), the attendance clock (first on a phone), a "Sales follow-ups" list, a "Coming soon" note naming the unbuilt modules, and the existing People & HR summaries. Working modules with nothing to show say so; nothing is invented. |
| Sales pages | They already shared the approved components; they now sit in the new shell with the same sidebar sub-navigation (the old tab strip remains on phones, where the sidebar is a drawer). The opportunity list now stacks reference/agency/company under the title so the table fits instead of clipping its last column, and a grid overflow on the Sales overview on phones is fixed. Every form, server action, validation, ownership rule and database permission is unchanged. |
| Readability | See `docs/os-theme-contrast.md`: lighter, clearly separated surfaces in both themes, stronger secondary text, a 12 px minimum, no decorative grid or glow in the app, one visible keyboard focus ring, and Tailwind's `dark:` classes now follow the app's own theme switch. |
| Checks | `src/app/theme-contrast.test.ts` (tokens, in CI) and `apps/web/os-shell-checks/` (browser checks against the local stack). |

## What is deliberately not here

The preview's fictional data, role switcher, fixed sample date and prototype dialogs are not in the live app. Preview-only
daily actions that do not exist in the real implementation (for example "Log activity" and "Schedule next action" as separate
buttons, a "Columns" menu, a financial summary, project risks) were not recreated: every button in the live pages performs a real
operation that already existed. Future modules show their name and "Coming soon" only.

## Preserved

HR: attendance and Recovery Leave, calendars and time zones, policy versions, approval routing, leave balances and ledgers, payroll,
reimbursements, access rules, scheduled jobs and email settings are untouched (no HR source other than presentation was edited).
Sales: ownership rules, closure and reopen history, private file handling, and the separate wording for "Not configured",
"Not required" and "Approved" are untouched. Access: navigation only shapes what is offered; row-level security and each page's own
checks remain the enforcement, and a Sales grant adds no HR link while an HR role adds no Sales link.

## Verification

See the pull request for results. Everything was run against the repository's local full stack (throwaway Postgres + PostgREST +
a local sign-in stand-in), never a hosted database. Not verifiable there: hosted Supabase Auth and Storage, Vercel cron, Microsoft 365
delivery, real accounts, and the large-file upload (the local stack has no Storage service; unchanged by this work).

## Preview deployments and the Supabase settings

The signed-in application needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in whichever Vercel environment it runs in
(`NEXT_PUBLIC_*` values are read when the build runs, so enabling one for Preview needs a new Preview build, not just a reload).
The authentication proxy runs before every page and API route and builds its Supabase client from them. In an environment where they
are missing, every request used to end in a bare `Internal Server Error` (the real reason, "Your project's URL and Key are required to
create a Supabase client!", only in the runtime log). The proxy now fails closed with a clear page, HTTP 503, naming the missing
settings (never their values) and logging the same line; it never skips the sign-in check. Only `/os-preview`, which has no database,
is served without them (as before). Covered by `src/proxy-config.test.ts`.

The Stage A roadmap (`docs/14`) already recorded that Vercel previews may have no Supabase settings; `docs/recovery-windows-deployment.md`
describes the intended arrangement as Production and Preview both carrying them, with Preview pointing at the same database as Production.
Which is true for this project is visible only in Vercel (Settings → Environment Variables, names and environment tags only).
