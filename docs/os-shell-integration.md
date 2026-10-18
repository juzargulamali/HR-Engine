# ENGINIOUS OS: the real application shell

This integrates the approved ENGINIOUS OS interface into the authenticated application (the HR pages and Sales & CRM), and makes
both themes easier to read. It is an interface change only: no migration, no change to any HR calculation, approval route,
permission or scheduled job. `/os-preview` stays what it was, a separate fictional preview that is hidden in Production.

## What changed

| Area | Change |
|---|---|
| Branding | Browser title `<page> · ENGINIOUS OS` (default `ENGINIOUS OS`), sidebar, sign-in, set-password and the global error page now say ENGINIOUS OS. Page-specific titles are kept and extended to the main pages (e.g. `Leave · ENGINIOUS OS`). URLs, authentication, the repository, the Supabase project and all technical identifiers keep their names. Email bodies were not touched. |
| Navigation | Module sidebar: **My Day**, **Approvals** (only for people who can decide or have something waiting), **Sales & CRM** (only with a Sales grant, with Overview, Opportunities, Pipeline, New enquiry, Follow-ups, Proposals & quotes, Clients & contacts, Reports, and Settings / Access only for people who can use them), **People & HR** (every existing HR link, same permission checks, grouped Me / People / Workflow / Organisation / Insights / System), **Projects & Tasks** (since Release 2: only with Projects access or a Sales link to a project; see `projects-deployment.md`), **Inventory**, **Vendors & Purchasing** (each shown as "Coming soon", not a link) and **KPIs & Performance** (the existing HR appraisals and goals stay reachable as "Performance reviews (HR)"; "KPIs" is marked Coming soon). The collapsible icon rail still works. `nav-groups.ts` builds all of this from the person's real HR roles and Sales grants, and `nav-groups.test.ts` proves no link is lost and none is granted. |
| Header | Breadcrumb (`Sales & CRM / Enquiries`), search (the existing Ctrl/Cmd+K jump, which lists only pages the person can reach), a compact attendance status for employees (`Clocked in · 1h 28m` or `Not clocked in`, text not colour, one tap to the real clock page where Clock In / Clock Out remain), alerts for people who may see them, and the theme toggle. |
| Phones | A menu button (drawer with the full module navigation) and a bottom bar: My Day, Sales (only with a Sales grant), Clock (employees only; reads "Clocked in" while clocked in), People, More. The old floating Clock button is gone, so nothing floats over a page's own buttons; pages reserve space under the bar. |
| My Day | The old dashboard, reorganised and extended with real data only: greeting, date/time/weather, "Needs you today" (approvals waiting on you, HR alerts for people allowed to see them, and for people with a Sales grant their overdue and due-today follow-ups and enquiries awaiting a first response, using the same loaders and rules as the Sales overview), the attendance clock (first on a phone), a "Sales follow-ups" list, today's attendance completion and upcoming holidays / recorded leave for people allowed to see them, a one-line "Coming soon" note at the bottom (Inventory, Vendors & Purchasing, KPIs), and for people with Projects access a compact Projects block (overdue and due tasks, reviews waiting, a handover waiting on them, unread discussion), and the existing People & HR summaries. Working modules with nothing to show say so; nothing is invented. |
| Sales pages | They already shared the approved components; they now sit in the new shell with the same sidebar sub-navigation (the old tab strip remains on phones, where the sidebar is a drawer). The opportunity list now stacks reference/agency/company under the title so the table fits instead of clipping its last column, and a grid overflow on the Sales overview on phones is fixed. Every form, server action, validation, ownership rule and database permission is unchanged. |
| Readability | See `docs/os-theme-contrast.md`: lighter, clearly separated surfaces in both themes, stronger secondary text, about 14 px for the text people read (labels, table contents, navigation, descriptions) and 12 px kept for genuinely minor details (badges, shortcuts, tooltips, footnotes), no decorative grid or glow in the app, one visible keyboard focus ring, and Tailwind's `dark:` classes now follow the app's own theme switch. |
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

## Finishing pass: text size, My Day wording, rest days and holidays

- **Text size:** the text people actually read (labels, table contents, navigation, descriptions, hints, metric labels, small buttons) is now 14 px; uppercase column and section labels are 13 px; 12 px is kept for badges' companions, keyboard-shortcut chips, tooltips and one-line footnotes. Checked at 360 and 390 px, dark and light, over 26 pages (`os-shell-checks/phone-fit.mjs`): no horizontal page scroll, no clipped bottom-bar label, no control under the bar.
- **Coming soon:** the large card is gone (the sidebar lists the unbuilt modules); a single quiet line at the foot of My Day remains. Its space now holds attendance completion and, for people who can see them, upcoming holidays and recorded leave.
- **One source for "what needs attention":** `buildActionItems` in `action-centre.tsx` produces the rows once; the card renders them and `attentionSentence` derives the sentence under the greeting from the same rows, Sales follow-ups included. The sentence says "Nothing needs your attention right now." only when the card has no rows, and otherwise "Your updates for today: N items need your attention."
- **Leave wording:** "Everyone's in today" is replaced by "No one is recorded on leave today. This lists recorded leave only. It does not show who is present or clocked in." Present (an attendance record), on leave (a leave record) and clocked in (a live clock session) stay three separate facts; "Present today" says "Recorded as present (not live clock status)".
- **Rest days and holidays:** "Missing record" is now "No attendance recorded" and counts only people who were **scheduled to work**. For each employee the dashboard uses their own country's local date, workweek (`countries.working_weekdays`, else the five days from `week_start_day`) and public holidays (`public_holidays` for that country), the same rule the attendance register and `record_attendance_and_recovery` use, via `classifyScheduledDay` in `packages/domain/src/scheduledDay.ts`. People with no record on their weekly rest day or a public holiday are counted separately ("no attendance expected"); anyone whose country workweek cannot be read is counted as "not classified", never as a gap and never guessed. The total of people without a record is unchanged; it is only split into the three groups. Anyone who did record attendance on a rest day or holiday still shows as present. The dashboard says so in a line under "People & HR today": expectations follow each employee's country calendar, not individual rosters or shifts. Not modelled by the system and therefore not claimed: individual rosters, shifts or part-time patterns ("scheduled" means a scheduled day of the country workweek). No database change was needed.
- **Tests:** `scheduledDay.test.ts` (domain), `dashboard-data.test.ts` (per-employee country, date, rest day, holiday, unknown calendar, worked-on-a-rest-day), `attendance-summary.test.ts` (the wording, and card/sentence consistency).

> **Update:** the Sales & CRM and Projects & Tasks menus were later simplified (Sales: Follow-ups, Enquiries, Reports; Projects: My Work, Projects, Calendar; specialist pages under Manage). See [os-workflow-simplification.md](./os-workflow-simplification.md).
