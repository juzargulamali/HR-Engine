# Staff guidance (approved, staff-facing): the shared knowledge JARVIS answers from

These files are part of the Enginious Map. They are the **only** Enginious OS knowledge JARVIS gives to staff: plain words, the screens people click, no code paths, SQL, migration names or permission internals (a test keeps it that way, and checks every link against the app's real pages).

| File | Area |
|---|---|
| [`sales.md`](./sales.md) | Sales & CRM (the first module with detailed guidance and live JARVIS actions), including Events & Exhibitions and Outreach |
| [`people.md`](./people.md) | People & HR ("where to find it" only) |
| [`projects.md`](./projects.md) | Projects & Tasks and Operations: 56 topics by role and screen (Operations Overview, project health labels and Upcoming Work for Operations Managers, the equipment booking review, finished projects' chats under Archived, My Work, the Work page, the Project Plan and its Excel import, tasks, blockers, review, timeline, site bookings, files, people, feedback and scope, equipment, handovers, completion, project chat). Guidance only: JARVIS reads no Projects record and has no Projects action |
| [`inventory.md`](./inventory.md) | Inventory ("where to find it" only) |
| [`general.md`](./general.md) | My Day (with the Operations card for Operations Managers), approvals, JARVIS itself |

## Format of a topic

```
## Title people would recognise
- id: lower-case-with-hyphens        (never reuse or change an id)
- area: sales | projects | inventory | people | finance | general
- status: published | draft          (only published topics reach JARVIS)
- keywords: phrase one; phrase two   (the words people really type)
- links: Label -> /path; Label -> /path   (real screens only)
- screens: /path; /path/[id]             (the screens this topic is the guide FOR, as the app's routes; a record's own page is written with [id])

One or two sentences of summary.

1. The clicks, in order.
```

## How guidance is approved and published (no retraining)

1. Someone suggests a correction: in JARVIS, "Suggest a correction" under a guidance answer (stored for review, see `../modules/jarvis.md` section 13), or directly as a pull request.
2. A reviewer checks it against the screens and the module reference, edits the topic here (or adds one as `draft`).
3. Run `npm run build:jarvis-knowledge`. It writes `apps/web/src/lib/jarvis/knowledge/published.generated.ts` from the `published` topics.
4. Open a pull request with both files. The web tests fail if the generated file does not match these files, so an unpublished edit cannot merge half-done.
5. After review and merge, the normal deployment makes it live. JARVIS reads the generated file: nothing is retrained and no suggestion becomes shared knowledge before this.

**How a topic is found.** JARVIS matches a question to these topics by meaning (the title, the keywords, the summary and the menu's name for the topic's screens all count), and uses `screens` to answer "What can I do here?" for the page the person is on. Write the title and keywords in the words people use; list every screen the topic explains. A screen with no topic gets an honest "no approved guidance yet".

Personal preferences ("What JARVIS remembers") are separate: they are per person, stored in the database, and never become shared knowledge.
