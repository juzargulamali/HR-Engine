# Projects & Tasks Phase 1: work in progress (handoff note)

Saved on 2026-11-11 so the work survives the session. Delete this folder when the steps below are done.

## Done and pushed (branch `claude/admiring-cray-uky379`)
* Project Chat: migration `supabase/migrations/20261230000100_chat_project_groups.sql`, owner packs `supabase/manual-sql/chat_project_groups_*`, database tests `packages/rls-tests/test/chat-project-groups.rls.test.ts`, app cutover (Discussion tab removed once the migration exists; `/projects/[id]/discussion` redirects a member to the group).
* Work page (What needs doing, Delivery summary, equipment states, Recent activity, Go to), My Work (My tasks / Waiting for my review / Blockers I can help clear / Sent for review), task detail (next step first), Handovers (open ones read separately from history, `?handover=<id>`, Accept opens Work), Completion (failed reads, Retry).
* Docs: `docs/enginious-os/modules/app-chat.md` section 9, `docs/chat-deployment.md` "Release 2", install-order row 27, compact `modules/projects-coverage-index.md`, staff guidance `staff-guidance/projects.md` (5 topics, republished), screenshots `docs/projects-phase1-screenshots/`.
* Module references written by parallel readers from the code (code read only, NOT yet spot-checked): `modules/projects-directory-and-my-work.md`, `projects-work-and-tasks.md`, `projects-timeline-site-and-files.md`, `projects-people-changes-history-completion.md`. Each ends with `## Coverage rows` and `## Actions` tables.
* Local results at `15c0f7f`: lint and typecheck pass; web 267 files / 3,072 tests; domain 43 / 516; database 73 files / 1,942. Later commits are small text and failed-read fixes plus docs; the suite was not rerun after them.

## Still to do
1. `modules/projects-handovers-equipment-and-workflow.md` (fifth reference, with the end-to-end workflow trace) and its guidance proposals: being written when this note was saved. Commit it when present.
2. Assemble from the five references' `## Coverage rows` and `## Actions` tables: the full `modules/projects-coverage-index.md` (replace the compact one; unique numbers, totals equal to entries) and a new `modules/projects-action-catalogue.md`.
3. Spot-check the references against the code (labels, permissions, functions) and correct them.
4. Merge the guidance proposals in this folder (`guidance-*.md`) into `docs/enginious-os/staff-guidance/projects.md`, run `npm run build:jarvis-knowledge`, then `npx vitest run src/lib/jarvis` in `apps/web`.
5. Link the Projects index, catalogue and references from `docs/enginious-os/README.md` (files table, the "Not written" line, a stamp row) and `CLAUDE.md` item 5; add the 05 ledger bullet and the 06 change-log entry for Phase 1 (migration row 27, not applied by Claude, hosted `Unverified`); update the staff-guidance README row for Projects.
6. Rerun lint, typecheck, `npm test` and the database tests; push; complete the draft PR description (head SHA, CI, migration and rollout order, which scenarios were verified locally and which need a signed-in Preview).

## Findings from the readers that are NOT fixed (pre-existing; candidates for a follow-up)
* Failed secondary reads shown as empty on People, Feedback & changes, History, Files & client plan, the Calendar, and parts of Work (milestone progress, feedback, plan outdated, bookings for a non-manager); a failed booking-conflict check reads as "no overlap".
* `proj_comment_task` has no finished-project check; several member, team and scope functions rely on the page to hide controls on a finished project.
* No version check on project status change, reassign, block, unblock, milestone and deliverable status. "Create project" has no retry key.
* A new dependency is always saved as "Not yet confirmed" although the Add form offers Confirmation.
* Booking notices link to the legacy `/timeline` address. Wording "Projects, then Access" and "A founder can reopen it there" (History) is stale: Reopen is in Manage project.
* The Work "View all tasks (N)" count includes finished tasks while the list it opens shows open ones.
