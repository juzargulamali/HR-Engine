# Chat (app-wide panel: Sales groups and project groups)

Status: **merged on `main` as PR #73** (merge `296b74814b8851c08b20a73b19e82d5eecea167f`, 2026-11-10; required CI `lint-typecheck-test` and `rls-policies` green on head `ab89a98846747dd0f721f52adfd9d1acbde8aeff`). Migration `20261225000100_chat_sales_groups.sql` is **applied on hosted V2 by the owner** (owner-reported: `chat_20_verify_readonly.sql` passed **7 of 7 checks**; Claude ran no hosted SQL and did not see the rows). **Vercel Production is not verified by Claude** (`docs/chat-deployment.md`, "Owner-run result"; `docs/launch-refinement-install-order.md` row 22). This release enables the three Sales groups only. Projects discussions and JARVIS are untouched and nothing is migrated. *(Corrected 2026-11-10: this line used to say "Draft PR, not merged, migration not applied anywhere".)*

**Release 2 (Projects & Tasks Phase 1, merged as PR #82 (merge `30c7895adc75f834a60b00ed3bca7015b1654282`, 2026-11-11); required CI green on head `9809cb4`):** one group per project and the Projects Discussion moved into Chat: section 9. Migration `20261230000100_chat_project_groups.sql` is **applied on the hosted Supabase project (shared by Preview and Production) by the owner, owner-reported on 2026-11-11: the preflight and the post-migration verify passed, and the signed-in Preview tests of PR #82 passed. Owner-run and owner-reported; not run, seen or independently verified by Claude.** Production is not verified. Where sections 1 to 8 say "only the three Sales groups exist" or "project groups planned", read them with section 9.

## 1. The entry point
| Control | What it does | Who | Behind it | Tests |
|---|---|---|---|---|
| **Chat button** (floating, every signed-in page; bottom-right on desktop, above the bottom bar on phones) | Opens the Chat panel over the current page: nobody leaves what they are doing. The button shows the person's **total unread** (99+ above 99; red when they were mentioned) and its spoken label carries the counts | Drawn only when the server lists at least one group for the person: **no eligible group, no button**. If the migration is not applied yet, or any read fails, the button is simply absent and nothing else on the page changes | `apps/web/src/app/(app)/layout.tsx` (`loadChatGroups`), `components/chat/chat-launcher.tsx` | `chat-launcher.test.tsx`; flow check 1 |
| **Panel** | A list of groups, each with its **own unread count**, a mention marker, the last message preview and its age. Opening a group shows the thread in the same panel (Back returns to the list). A bottom sheet (92% height, focus held inside, Escape closes) on a phone, a 26 rem card above the button on desktop | Members only | `chat-launcher.tsx`, `chat-thread.tsx` | same |
| Refresh | The group list refreshes every 30 s while the tab is visible and when the window regains focus; an open thread every 5 s. A group that is no longer listed closes its thread; no groups at all removes the button and panel | | `chat-launcher.tsx` | flow check 4 |

The panel is built around a **list of groups** so project discussions can appear in it later. **Planned, not built:** project groups, moving Projects discussion messages, removing the Discussion panel. This release adds none of them.

## 2. The three Sales groups and automatic membership
| Group | Company it is bound to | Member when |
|---|---|---|
| **Sales — UAE** | the one active company with country AE | the person holds an **active Sales & CRM grant for that company** |
| **Sales — KSA** | country SA | same, for that company |
| **Sales — Europe** | country PL (the only European company) | same, for that company |

* **No member list exists.** Membership is computed on every call from `crm_company_grants` (the Sales grant per person per company that People & Access -> Module access edits): not revoked, profile active. Someone with Sales access to all three companies is in all three groups; one company, one group. There is **no all-company Sales group**.
* **Company access alone grants nothing.** An HR role scoped to a company, an employee record or another module's grant is not Sales access. (In this system a Sales grant already is "Sales & CRM access to that specific company", so the two conditions in the request are the one grant; there is no separate company-access table that Sales does not use.)
* **Mismatch recorded, no wider access:** the group names are regions, the access rule is per company, and there is no company called "Europe". Europe is bound to the Poland company by country. A group binds only when **exactly one** active company has its country; otherwise it stays unbound with **no members** (fails closed). A second European company would not join automatically (see `docs/chat-deployment.md`).
* **Removing access takes effect on the next call:** the group leaves the person's list, its history cannot be read, posting is refused, it stops counting toward unread and they can no longer be mentioned there. Restoring the grant restores the group and its history. Deactivating the person removes every group.

## 3. What the server enforces (every call checks membership itself)
| Function (granted to signed-in users) | Rule |
|---|---|
| `chat_my_groups()` | Only the caller's groups, with unread, mention count and last-message preview. The first time a group is listed for a person their read marker starts at the newest message (no flood of "unread" for old history) |
| `chat_messages(group, before, after, limit)` | History, only for a member ("You are not a member of this group" otherwise). Each shared item is resolved **for this reader** |
| `chat_post(group, body, mentions, item type, item id, client key)` | Member only; text up to 4000 characters or a shared item; **every mention must be a current member of that group**; the **sender must be able to see the item**; a client key makes a retry idempotent (never posts twice) |
| `chat_mark_read(group, seq)` | Member only; never moves backwards; never past the newest message |
| `chat_group_members(group)` | Member only: the people who may be mentioned |

The tables themselves grant **nothing** to signed-in users or anon (RLS on, no policy, no privilege): the functions are the only way in. Details: `supabase/migrations/20261225000100_chat_sales_groups.sql`, `docs/chat-deployment.md`.

## 4. Unread and mentions
Unread for a group = messages from other people newer than the person's read marker, counted only while they are a member. Their own messages never count. A mention is counted separately (the red marker and the red button badge). The marker moves when the thread is open and the person is at the bottom (or presses "N new"); an unread message shows a **"New messages" line** on opening. In the composer, typing `@` (or the @ button, which suits a phone) lists current members; choosing one inserts `@Name`. A mention is sent only while its `@Name` is still in the text. There are no external notifications (no email, no push): the button and the panel are the notification.

## 5. Share item and restricted links
**Share item** (composer): choose Enquiry, Estimate, Client or agency, Event or Edition, then search by name or reference; the result list is the sender's own (row-level security). Only a **reference** (type + id) is stored.
* **Sender:** `chat_post` checks the sender's own current access to the item and refuses otherwise.
* **Each reader:** when a message is returned, the database checks that reader's **current** access: with access they get the title and a link (a normal page link: opening it uses the page's existing permissions); without it they get only `{"restricted": true}`, shown as a generic **"Restricted item"**. No title, type, reference or link is stored in the message, returned in the payload or put in the group preview (a message that only shares an item previews as "Shared an item"). An unknown id looks the same as a restricted one.
* **Rules reused, none widened:** enquiries and estimates follow the company Sales grant of the enquiry; clients, agencies, events and editions follow any Sales grant (the Clients & Agencies directory stays shared exactly as today).

## 6. Small additions beyond the request (all optional to keep)
Day headings and times, avatars (initials), the "New messages" line, a "N new" jump-to-latest pill while scrolled up, "Load earlier messages", a quick emoji tray, a character counter near the limit, failed sends that stay on screen with Retry and Discard, Enter to send and Shift+Enter for a new line, and an additive `onQueryChange` hook on the shared search field (the share search uses it).

## 7. Not covered (stated, not hidden)
Direct messages; an all-company Sales group; project groups and Projects-discussion migration (planned); external notifications; editing or deleting messages; live push (polling only); attachments (only references to items); nothing is applied to a hosted project.

## 8. Tests
`packages/rls-tests/test/chat-sales-groups.rls.test.ts` (membership by grant only, company access alone denied, history/post/read/members/mentions refused for a non-member, unread and mention counts, restricted placeholders with no leakage, revoke and restore), `lib/chat/model.test.ts`, `components/chat/chat-launcher.test.tsx`, and the focused browser flow `apps/web/os-shell-checks/chat-sales-groups-flow.mjs`.


## 9. Project groups and the end of the Discussion tab (release 2)
Source: `supabase/migrations/20261230000100_chat_project_groups.sql`; `apps/web/src/lib/chat/data.ts` (`loadProjectChat`, `projectChatInstalled`, `loadProjectUnread`), `lib/chat/model.ts`, `components/chat/chat-launcher.tsx`, `chat-thread.tsx`, `project-chat-button.tsx`; `app/(app)/projects/[id]/layout.tsx`, `discussion/page.tsx`; rollout in `docs/chat-deployment.md` ("Release 2").

**One group per project**, shown as `<reference> · <name>` (the project's current name, not a stored copy), listed under **Projects** in the same panel, most recent conversation first, after the Sales groups. Above eight groups the list has a search box. A project-only member (no Sales group) gets the Chat button on every signed-in page.

**Membership is active enrolment in that project, computed on every call:** a `proj_project_members` row that is not removed, an active profile, and still eligible for the project (`proj_user_eligible`, the test `proj_is_active_member` uses). Adding someone to the project adds them on the next call; removing or deactivating them, or revoking their Projects access, removes the group, its preview, its unread count, its history and the right to post or be mentioned on the next call. **A Projects grant, a founder grant, Sales access or membership of another project grants nothing.** *Difference from the old Discussion:* a company founder who is not enrolled could read a project's Discussion; they are not a member of its chat group.

| Function | Change |
|---|---|
| `chat_my_groups()` | Also lists the caller's project groups, with `gkind`, `project_id`, `read_only`. Creates a missing group for a project the caller is enrolled in. A finished project's group is listed only while it has messages |
| `chat_is_member` (internal) | Sales rule as before, or active enrolment for a project group. Every other function (`chat_messages`, `chat_post`, `chat_mark_read`, `chat_group_members`) checks it, so history, posting, read markers, the member list and mentions are refused to a non-member with the same "You are not a member of this group" |
| `chat_group_members` | For a project group: the project's current members |
| `chat_post` | A finished project (completed or archived) is read-only, as its Discussion was |
| `chat_project_group(project)` | New. The group id of one project, for a member only; anyone else, and an unknown project, get the same refusal |

**Opening a group from anywhere:** `?chat=<group id>` on any signed-in page (the launcher opens it and removes the parameter), or the project header's **Chat** button. The launcher opens a group only if the server lists it for the person; otherwise it says the conversation is not available. A group that stops being listed closes its thread on the next refresh (30 s, or on window focus) and leaves the unread total; a refused read or post shows "You no longer have access to this group".

**The Discussion tab is removed** once the migration is applied: a project has Work, Timeline, Equipment (and Budget). `/projects/[id]/discussion` (old links, old mention notices) sends a member to `/projects/[id]/work?chat=<group>`; someone who may open the project but is not on its team is told where the conversation is and shown none of it; a failed check says it could not load. On a database **without** the migration the tab and the old page still work (that is also the rollback state). Project unread counts on the Projects directory, My Work and My Day now come from Chat (`loadProjectUnread`).

**Transfer of the old messages:** every Discussion message that is not deleted is copied once, with its author, its original time and its original order; mentions are copied; a stable source id (`source = 'proj_messages'`, `source_id`) under a unique index makes a rerun copy nothing. A person's read marker starts at the newest message the first time a group is listed for them, so the history is not unread. Until the new app is live, a message posted in the old Discussion is mirrored into the group at once (trigger). **Not carried over:** deleted messages; reply threading (replies become ordinary messages in time order); editing and deleting messages (Chat has neither); the "jump to a task" picker; the per-message `project_mention` / `project_reply` notices (a mention is the red marker on the Chat button, and no message text is written to a notification).

**Unchanged:** the three Sales groups, their membership, unread behaviour and the restricted shared items (the same functions; `chat-sales-groups.rls.test.ts` still passes). Task comments stay on tasks; formal history stays in History.

Tests: `packages/rls-tests/test/chat-project-groups.rls.test.ts` (12: one group per project, verify pack, transfer once in order with authors and times, rerun and re-apply copy nothing, names follow renames, no group / preview / unread / history / post / read marker / member list for a grant holder, founder, Sales person or another project's member, mentions limited to current members, add and remove and revoke and deactivate, finished projects read-only, mirror, project deletion, Sales groups unchanged, rollback then release 1 then forward again), `components/chat/chat-launcher.test.tsx`, `lib/chat/model.test.ts`, `projects/[id]/discussion/page.test.tsx`, `lib/projects/load-errors.test.ts`.

## 10. Operations Managers in project groups, and the Archived section (Projects & Tasks Phase 2B)

Status: merged as PR #86, merge `5b75ade` (2026-11-12); migration `supabase/migrations/20270102000100_ops_phase2b.sql` (install-order row 30) **not applied by Claude; treated as applied on the shared hosted database on the owner's report of 2026-11-12 that the signed-in Preview checks of PR #86 passed, which is owner-reported by implication and `Unverified` by Claude**; code read only, nothing seen signed in by Claude. **The Archived paragraph below was re-read against commit `16d6f42`** (the change is `93ec0f2`, app only, no SQL); the rest of this section keeps its earlier stamp. Sources: that migration, section 5; `apps/web/src/lib/chat/model.ts`, `lib/chat/data.ts`, `components/chat/chat-launcher.tsx`, `chat-thread.tsx`; tests `packages/rls-tests/test/ops-phase2b.rls.test.ts`, `lib/chat/model.test.ts`, `components/chat/chat-launcher.test.tsx`. Full reference: [`operations.md`](./operations.md) section 10.

**A second, explicit path into a project group.** Section 9 says membership of a project group is active enrolment and that "a Projects grant, a founder grant ... grants nothing". From this migration one Projects capability does: a person who holds **`operations` itself** (Operations Manager) for the project's company is a member of every project group of that company, without being enrolled in the project (`chat_is_ops`). The founder shortcut is not this permission: a founder who does not hold `operations` and is not enrolled still has no path. Sales access, warehouse access and another company's Operations Manager gain nothing.

| Function | Change |
|---|---|
| `chat_is_ops(user, project)` (internal, new) | True when the user's active Projects grant for the project's company contains `operations` and their profile is active |
| `chat_is_member` (internal) | For a project group: enrolled member **or** `chat_is_ops`. Every function that checks it follows (`chat_messages`, `chat_post`, `chat_mark_read`, `chat_group_members`) |
| `chat_project_group(project)` | Also answers for an Operations Manager of the project's company |
| `chat_my_groups()` | Creates the missing group of each **live** project (not completed or archived) of the caller's Operations companies, so the conversation is listed before anyone has posted. **Two more columns:** `project_status` (the project's real status; null for a Sales group) and `via_operations` (true when the caller reads a project group through Operations and is not enrolled). The return type changed, so the function is dropped and created again in the migration's transaction |
| `chat_group_members` | For a project group: the enrolled members and, with "(Operations)" after the name, the company's Operations Managers who are not enrolled. Sales groups unchanged |

**What the person sees.**

* **Tag "Operations"** beside the group's name in the list, and a note at the top of the thread, "You are reading this as Operations Manager. You are not on this project's team.", on every group read through Operations (`viaOperations`; `OPERATIONS_READER_NOTE`).
* **"Archived (N)"**: groups of **completed and archived** projects are listed in a third section after Sales and Projects, collapsed until pressed (`aria-expanded`; a 44 px row). A search opens it, so a finished group is still found by name. While it is closed, the heading shows the section's unread count and a mention marker: nothing is dropped from the totals (`isArchivedGroup`, `groupSections`, `archivedHeading` in `lib/chat/model.ts`).
  * **Changed on 2026-11-12 (commit `93ec0f2`).** Before it, only an archived project's group was here and a completed project's group stayed under Projects. Now both sit under Archived.
  * **Read-only, as before.** The server rule is unchanged: `chat_post` refuses a post to a completed or archived project (section 9). Only the place in the list changed.
  * **Direct links still open them:** a `?chat=<group id>` link, the project's Chat button and an old Discussion link open the group whichever section it is listed in.
  * **A reopened or restored project's group is back under Projects on the next refresh** of the list.
  * **The project itself is not changed by where its chat is listed.** A completed project keeps its lifecycle (it can still be reopened or archived) and its equipment-return tracking (`operations.md` section 9.3).
  * **A database that does not send the project's status:** the group is placed by the server's read-only flag, which is set for exactly these two statuses (`projectStatus == null && readOnly === true`).
  * Tests: `lib/chat/model.test.ts` (19), `components/chat/chat-launcher.test.tsx` (17). Not seen signed in.
* **Project chat** on a Project health card of the Operations Overview (labelled "Open project chat" before the redesign of 2026-11-12) is a link with `?chat=<group id>`: the launcher opens the group only if the server lists it for the person.

**Mentions.** The @ picker is filled from `chat_group_members`, so an Operations Manager who is not enrolled is offered, marked "(Operations)", and can be mentioned. The membership line under a project group's name reads "The people on this project, and the company's Operations Managers" (`lib/chat/model.ts`).

**Revocation.** Removing the capability, the Projects grant, or deactivating the person removes the groups, their history and the right to post on the next call (test "Chat: the Operations Manager reads and posts ...").

**What did not change.** The three Sales groups and their membership; membership for enrolled members; read-only conversations for completed and archived projects; unread and mention counting; shared items and "Restricted item"; no editing or deleting of messages; no external notification; polling. An app version from before this phase reads the two new columns as absent and behaves as before (it names the columns it uses, `lib/chat/data.ts`): finished groups then stay under Projects and no tag is shown. The sentence shown when a `?chat=` link cannot be opened now reads "That conversation is not available to you. A project's chat is open to the people on that project and to the company's Operations Managers."

**Cost (known limit).** For an Operations Manager the group list covers every project group of their companies; the independent reviewer measured about 1.5 s at 3,000 groups (reported, not measured by the author of this section).

**Rollback** (`supabase/manual-sql/ops_phase2b_90_rollback.sql`): restores `chat_is_member`, `chat_project_group`, `chat_group_members` and `chat_my_groups` as installed by `20261230000100` and drops `chat_is_ops`. No group and no message is deleted.

## 11. The refusal "You are not a member of this group": what raises it and what the app asks (2026-11-12)

**Release status (four facts kept apart, reconciled 2026-11-12 after the merge).** **Merged:** yes. PR #89 merged into `main` with merge commit `62aa4fe08fe60dc5818b7145ade220e23b7a1811`, pinned to head `e0e3d0476535ecf12d0f76f12cd0191ea5aa6a3a` (checked on GitHub). That head is the branch with `main` merged in after PR #88; the conflicts were in two docs files only and the chat code is identical to `950baf1`, the head the owner tested. **Required CI on the exact head:** `lint-typecheck-test` and `rls-policies` both passed on `e0e3d04` (read on GitHub by Claude before the merge; they had also passed on `950baf1`). **Hosted database:** no migration and no SQL in this change. **Signed-in Preview (owner-reported, 2026-11-12):** the Chat Preview test passed on `950baf1` with no fresh Supabase membership errors during testing. Claude saw nothing signed in and did not read the Supabase log. **Production (owner-reported, 2026-11-12):** the owner reported that the Production smoke test for PR #89 (Chat) passed. What was opened, which commit Production was serving, and whether the Supabase log was re-read for fresh membership errors were not listed. Claude cannot read Vercel or the Supabase log. App only: no change to the membership rules. The hosted error log (35 errors in an hour) was reported by the owner and was not read by Claude.

**Where the message is raised.** Five functions, each with error code `42501`: `chat_project_group(project)`, `chat_messages(group, ...)`, `chat_group_members(group)`, `chat_post(group, ...)` and `chat_mark_read(group, seq)` (`supabase/migrations/20261225000100_chat_sales_groups.sql`, `20261230000100_chat_project_groups.sql`, and the current versions of `chat_project_group` and `chat_group_members` in `20270102000100_ops_phase2b.sql`). The database records every such refusal as an error, whether or not the app handles it.

**The two app callers that raised it in normal use** (both in `apps/web/src/lib/chat/data.ts`):

| Caller | What it did | When it ran | Who triggered it |
|---|---|---|---|
| `projectChatInstalled` | Called `chat_project_group` with the all-zero project id and read the refusal as "the function exists" | Once per page request that needs unread project chat counts: My Day (anyone with a Projects grant), `/projects`, `/projects/work`, and a project page whose chat is ready | **Everyone, members included.** In the database log these have `p_project = 00000000-0000-0000-0000-000000000000` |
| `loadProjectChat` | Called `chat_project_group` for the project being opened | Once per project page (`app/(app)/projects/[id]/layout.tsx`) and on the old Discussion address, for anyone who could open the project in full | **People who can open a project but are not on its team**: a Projects founder who is not enrolled. An Operations Manager of the company and a member are let in and raised nothing |

**What did not raise it.** A direct link to a group the person is not in (`?chat=<group id>`): the Chat panel opens only groups in the person's own list, refreshes the list once and otherwise says "That conversation is not available to you..." without calling the group (`components/chat/chat-launcher.tsx`, `openById`). Loading the chat list (`chat_my_groups` returns only the person's groups). A member opening a completed or archived project's chat (members keep read access; posting is refused with a different message, "read-only"). An open thread whose access is removed mid-conversation does raise it, but stops on the first refusal (`chat-thread.tsx`, `lost`) and the panel closes the thread on its next refresh.

**What the app asks now.**

* `projectChatInstalled` reads the answer from the person's own group list (`chat_my_groups`): a row from migration `20261230000100` carries the group's kind. Only when the list is empty does it ask for that one column (`select gkind`), which a database without the migration does not have. Neither is a refused call. One list read per request now serves the Chat button, the unread counts and this answer. The answer has three values: installed, not installed, or unknown. **"Not installed" is said only when the error names the expected Chat function (`chat_my_groups`, or `chat_project_group` for a project's own chat) or the `gkind` column as missing** (`missingChatFunction`, `missingKindColumn`). A missing column or function that is not one of those, for example one the database function uses inside, is a fault and reads "could not load". Any other failure, including a failed one-column question for a person with no groups, is unknown: unread counts then read "could not be loaded" and a non-team viewer's project page says the chat could not be checked. Nothing falls back to the old Discussion on a failure.
* `loadProjectChat(project, mayBeMember)`: the page passes what it already knows, namely that the person is on the project's team (`standing.isMember`) or holds the Operations Manager right itself for the project's company (`holdsOperationsRight` in `lib/chat/model.ts`, which mirrors `chat_is_ops`: a founder does not pass). When neither holds the database is not asked and the answer is `not_member`. When either holds the database is asked and still decides.
* A person who can open the project but is not on its team now reads, under the project's tabs: "Project chat is open to the people on this project and to the company's Operations Managers. You can open this project but are not on its team, so its chat is not shown to you." The old Discussion address keeps its own message.

**Unchanged.** Who is a member; the refusal of every read and write for a non-member; read-only access for members of completed and archived projects; the Archived (N) section.

**Tests.** `apps/web/src/lib/chat/data.test.ts` (new, 12; includes "a person with no groups whose follow-up request fails" and "an unrelated missing column or function is 'could not load'"): no call to `chat_project_group` for the installed check or for a non-member; a failed list read is not "not installed"; a database refusal for a presumed member is still `not_member`. `app/(app)/projects/[id]/discussion/page.test.tsx` (2 added): a founder is not asked about; a member and an Operations Manager of that company are. `packages/rls-tests/test/ops-phase2b.rls.test.ts` (1 added, real PostgreSQL): the old probe is refused for a member, an Operations Manager and a founder alike; the replacement is refused for nobody; the founder is refused by every group function and the member is served.

**Not verified.** The hosted log itself (timestamps, which function, the arguments). The share of the 35 errors that each caller produced is therefore an inference from the code, not a measurement. The new note on the project page has no test of its own. After deployment the owner can confirm on hosted that the message stops appearing for ordinary browsing.

