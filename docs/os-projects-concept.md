# ENGINIOUS OS: Projects & Tasks redesign concept

A reviewable concept, not a change to the signed-in app. It lives at `/os-preview/concept` and uses invented data only.

- **Where:** `apps/web/src/app/os-preview/concept/`. It sits under the existing `/os-preview` gate: hidden in Production (`VERCEL_ENV=production` → 404), shown on Vercel previews and in development. Verified by building with `VERCEL_ENV=production` and requesting the routes (all 404).
- **Label:** every screen carries "Design concept: sample data".
- **Data:** `_lib/sample.ts` (fictional clients, people and equipment; no sales values, no real stock). Changes are held in memory (`_lib/store.tsx`), shown as Saving → Saved, and reset on reload. There are no database calls, server actions, migrations, permissions, jobs or emails. The browser check fails if any request is not a GET to localhost, and the existing preview hygiene test scans this folder too.
- **Reused as they are:** SidePanel, PanelLink, Board, ViewSwitch, InlineSelect, MoreMenu, MoreDetails, Modal, Button, Input, Select, url-state. No new framework. The only edit outside the folder: `PreviewShell` steps aside for this route.

## Screens

The layout, surfaces and colours follow the approved dark and light renders (sidebar and top bar stay dark in both themes).

1. **Projects** (`/os-preview/concept`): header graphic, search, Stage, Manager and "Needs attention" filters, "More filters", Table (default) or Board. Columns: reference and name, client or internal, manager, stage, next milestone with date, **Attention needed**. Filters, view and scroll position survive opening a project and coming back.
2. **Project** (`/os-preview/concept/aurora`): header graphic with team, stage and dates; four sections only (Work, Timeline, Discussion, Equipment). Work has three summary cards that are also filters (Open tasks, Need attention, In review; the same counts as the tab badge and the list), a task table or board, a "Next" card, "Next on site", "Team activity" and a milestone strip. Every figure is counted from the sample records.
3. **Click-to-edit:** the Owner and Status pills in a row (and in the task panel) open a menu of choices. A choice that is not allowed is listed with its reason. Saving shows "Saving…", then "Saved" or a clear failure with "Try again".
4. **Task panel** (`?task=t7`): fields first, then checklist, comments and activity; blocker and review states; rare items under "More details". The address holds the task, so Back and Escape close it.
5. **Phone**: compact header, summary cards in one row, task cards, full-height panel, "Move to" instead of dragging.

Open `?as=directory` for the summary-only view, `?as=member` for a team member, `?as=founder` for both companies. The avatar menu ("Preview options") switches who you preview as, the theme, and shows loading, error and failed-save states.

## Brand and fonts

The repository has the logo and icon files but no brand guide or company profile. The colours extend the app's existing tokens (teal and cyan taken from the logo) and the fonts are the app's existing ones (Manrope, Sora). They are an interpretation, not an official palette. The full logo file is used unchanged (height set, width automatic) on a light plate in the sidebar, so its dark-teal lettering stays legible. The product name "ENGINIOUS OS" is plain text in the top bar, not a second wordmark. On a phone the logo mark (icon file, unchanged) sits beside it. Fine lines appear only in the header graphic, which keeps its words on a plain area to the left.

## Checks

`node os-preview-checks/concept.mjs` (66 interaction checks, desktop and phone) and `node os-preview-checks/concept-axe.mjs` (axe-core, both themes, every screen and panel; no contrast findings). Unit tests: `concept/_lib/logic.test.ts`.

## Known limitations

- The sidebar items other than Projects open the existing design-preview pages of those modules (they are not part of this concept).
- Add project, settings, people and access, files, history, completion, date changes and sending a request only explain that they are outside the concept.
- Axe reports one minor finding on the panels: the shared SidePanel uses `role="dialog"` on an `<aside>`. It is the same in the live app and was left alone.
- The Board component (shared) scrolls sideways inside its own region when five stage columns do not fit.
- Tested in Chromium only.
