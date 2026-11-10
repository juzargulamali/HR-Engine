# Staff guidance (approved, staff-facing): the shared knowledge JARVIS answers from

These files are part of the Enginious Map. They are the **only** Enginious OS knowledge JARVIS gives to staff: plain words, the screens people click, no code paths, SQL, migration names or permission internals (a test keeps it that way, and checks every link against the app's real pages).

| File | Area |
|---|---|
| [`sales.md`](./sales.md) | Sales & CRM (the first module with detailed guidance and live JARVIS actions) |
| [`people.md`](./people.md) | People & HR ("where to find it" only) |
| [`projects.md`](./projects.md) | Projects & Tasks ("where to find it" only) |
| [`inventory.md`](./inventory.md) | Inventory ("where to find it" only) |
| [`general.md`](./general.md) | My Day, approvals, JARVIS itself |

## Format of a topic

```
## Title people would recognise
- id: lower-case-with-hyphens        (never reuse or change an id)
- area: sales | projects | inventory | people | finance | general
- status: published | draft          (only published topics reach JARVIS)
- keywords: phrase one; phrase two   (the words people really type)
- links: Label -> /path; Label -> /path   (real screens only)

One or two sentences of summary.

1. The clicks, in order.
```

## How guidance is approved and published (no retraining)

1. Someone suggests a correction: in JARVIS, "Suggest a correction" under a guidance answer (stored for review, see `../modules/jarvis.md` section 13), or directly as a pull request.
2. A reviewer checks it against the screens and the module reference, edits the topic here (or adds one as `draft`).
3. Run `npm run build:jarvis-knowledge`. It writes `apps/web/src/lib/jarvis/knowledge/published.generated.ts` from the `published` topics.
4. Open a pull request with both files. The web tests fail if the generated file does not match these files, so an unpublished edit cannot merge half-done.
5. After review and merge, the normal deployment makes it live. JARVIS reads the generated file: nothing is retrained and no suggestion becomes shared knowledge before this.

Personal preferences ("What JARVIS remembers") are separate: they are per person, stored in the database, and never become shared knowledge.
