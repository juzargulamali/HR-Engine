# ENGINIOUS OS: Projects & Tasks redesign concept

A reviewable concept, not a change to the signed-in app. It lives at `/os-preview/concept` and uses invented data only.

- **Where:** `apps/web/src/app/os-preview/concept/`. It sits under the existing `/os-preview` gate: hidden in Production (`VERCEL_ENV=production` → 404), shown on Vercel previews and in development. Verified by building with `VERCEL_ENV=production` and requesting the routes (all 404).
- **Label:** every screen carries "Design concept: sample data".
- **Data:** `_lib/sample.ts` (fictional clients, people and equipment; no sales values, no real stock). Changes are held in memory (`_lib/store.tsx`), shown as Saving → Saved, and reset on reload. There are no database calls, server actions, migrations, permissions, jobs or emails. The browser check fails if any request is not a GET to localhost, and the existing preview hygiene test scans this folder too.
- **Reused as they are:** SidePanel, PanelLink, Board, ViewSwitch, InlineSelect, MoreMenu, MoreDetails, Modal, Button, Input, Select, url-state. No new framework. The only edit outside the folder: `PreviewShell` steps aside for this route.

## Screens

1. **Projects** (`/os-preview/concept`): Table (default) or Board of the same records; search; Stage, Manager and "Needs attention" filters; "More filters" for client/internal, company (founder only) and completed. Columns: reference and name, client or internal, manager, stage, next milestone with date, attention needed. Filters, view and scroll position survive opening a project and coming back.
2. **Project** (`/os-preview/concept/aurora`): compact header, one "Next" action, four sections (Work, Timeline, Discussion, Equipment), and a "More" menu for settings, people, files, history and completion.
3. **Task panel** (`?task=t7`): fields first, then checklist, comments and activity; blocker and review states; rare items under "More details". The address holds the task, so Back and Escape close it.
4. **Phone**: cards instead of tables, full-height panel, "Move to" instead of dragging, filters behind one button.

Open `?as=directory` for the summary-only view, `?as=member` for a team member, `?as=founder` for both companies. "Preview options" also switches theme and shows loading, error and failed-save states.

## Brand and fonts

The repository has the logo and icon files but no brand guide or company profile. The colours extend the app's existing tokens (teal and cyan taken from the logo) and the fonts are the app's existing ones (Manrope, Sora). They are an interpretation, not an official palette. The icon is used unmodified (height set, width automatic) beside the plain words "ENGINIOUS OS". Circuit lines appear only in the top bar and the empty page background.

## Checks

`node os-preview-checks/concept.mjs` (66 interaction checks, desktop and phone) and `node os-preview-checks/concept-axe.mjs` (axe-core, both themes, every screen and panel; no contrast findings). Unit tests: `concept/_lib/logic.test.ts`.

## Known limitations

- Add project, settings, people and access, files, history, completion, date changes and sending a request only explain that they are outside the concept.
- Axe reports one minor finding on the panels: the shared SidePanel uses `role="dialog"` on an `<aside>`. It is the same in the live app and was left alone.
- The Board component (shared) scrolls sideways inside its own region when five stage columns do not fit.
- Tested in Chromium only.
