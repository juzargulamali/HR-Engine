# Projects & Tasks — staff acceptance checklist

Do this with **test people and a test client name**, after the owner has installed the migrations and made founders (see
[projects-deployment.md](./projects-deployment.md)). It walks the whole life of one client project and one internal project. Tick
a box only when you actually saw the result. Anything unexpected: write down what you did and what you saw.

Suggested people: **Founder** (Juzar or Rafi), **Sales** (an opportunity owner), **PM**, **Head** (a department head, e.g. Programming), **Member**, and **Outsider** (someone with no Projects access).

## A. Access
- [ ] Outsider: no "Projects & Tasks" in the menu; opening `/projects` explains they have no access.
- [ ] Founder: Projects → Access: give PM, Head and Member plain access; give one person *Assign Project Managers* only.
- [ ] A person with plain access can open the directory and see ongoing projects (name, status, PM, dates) but not open any tab.
- [ ] HR admin (no Projects grant) sees nothing; giving a project role does not change their HR pages or leave/attendance.

## B. Sales → PM handover (client project)
- [ ] Sales: on a Won opportunity, Handover page → fill the delivery brief (no prices!) → Submit. Status: waiting for a Project Manager.
- [ ] Founder: Projects → Handovers → choose the PM. The PM sees a notification in My Work.
- [ ] PM: Request clarification with a note → Sales sees it, edits, resubmits → PM accepts.
- [ ] Accepting twice (double click, or two tabs) creates **one** project. Its reference looks like `UAE-P-2026-0001`.
- [ ] Sales now sees that project's summary and handover status only (no tabs, no discussion, no tasks).
- [ ] Change the opportunity in Sales afterwards: the accepted handover and project scope do **not** change.
- [ ] No price, budget, PO number or payment terms appears anywhere in the project, the handover, or its History tab.

## C. Team and structure
- [ ] PM: People → add the Member and the Head; create the "Programming" team with the Head; appoint a temporary leader until a date.
- [ ] Member cannot add people, edit milestones or change status (the screen refuses, in words).
- [ ] Remove a member who still has open tasks: it asks who takes them over. Removed person: the project and its discussion disappear for them at once.

## D. Milestones, deliverables, tasks
- [ ] PM: add milestones (one required, one optional) and a deliverable for the Programming team.
- [ ] Head: create a task for the Member; the Member creates one for themself; the Member cannot assign to others.
- [ ] A task that "needs review": the Member sends it for review; the **Member cannot complete it**; the Head accepts it.
- [ ] Block a task: it needs a reason and who/what unblocks it; the person named gets a notification; unblock it.
- [ ] Change a due date: the page lists dependent tasks affected; nothing moves by itself; the history shows from → to and the reason.
- [ ] Try a circular dependency (A needs B, B needs A): refused.
- [ ] Accept the deliverable and the milestone; progress reads "N of M required milestones accepted" (never a percentage from dates).

## E. Calendars and timelines
- [ ] My Calendar shows only my tasks, reviews waiting for me, my projects' milestones and my site bookings.
- [ ] Company calendar shows project spans only; the Sales person sees only their own project there.
- [ ] Project calendar (members only) shows milestones, deliverables, deadlines, timelines and bookings; month, week and agenda views.
- [ ] A deadline date stays the same date when you switch the viewing time zone.
- [ ] Use the suggested delivery and site timelines; edit one item; nothing becomes client-visible until marked.

## F. Site bookings
- [ ] Book the Member on site 09:00–17:00 with 60 min preparation and 60 min travel; confirm it.
- [ ] Book the same person on **another project** 17:30–20:00: confirming is refused as an overlap (allowances count).
- [ ] The refusal never names a project you cannot see; only a person with site-conflict authority can confirm anyway, with a reason.
- [ ] Two tasks due the same day for one person are **not** flagged as a conflict.
- [ ] Times show the site's time zone first; a booking over a clock-change night has the right length.

## G. Discussion and notifications
- [ ] Post, reply, @mention: the mentioned person gets one notification; the notification contains no message text.
- [ ] Leave the page open on a second device: new messages appear without refreshing; "N new messages" appears if you scrolled up.
- [ ] Edit your message (shows "edited"); delete one (shows "Message deleted").
- [ ] Outsider and the Sales person (not a member) cannot read or post.

## H. Feedback, scope, client timeline
- [ ] Record client feedback against a task (correction) and a proposed change; resolve the correction with evidence.
- [ ] Propose a scope change with an effect on dates and a cost note; the PM and members cannot read the cost back; the original scope stays visible.
- [ ] Only a person with scope-approval rights can approve; approving changes the current scope but never moves dates.
- [ ] Mark milestones/activities client-facing; Issue the client timeline; download the PDF: Enginious branding, only the marked items, the site time zone stated, no internal tasks, names, chat or money.
- [ ] Edit a client-facing item after issuing: the issued version shows **outdated**. Issue again: version 2; version 1 is kept.
- [ ] Record "sent" and "client accepted" separately; neither is ever set by generating the PDF.

## I. Completion and reopening
- [ ] Complete project without client confirmation: refused. With unfinished tasks: you must cancel, defer or resolve each with a reason (nothing becomes Done).
- [ ] Complete with the client's e-mail reference, date, contact and a note. The project becomes read-only but stays readable.
- [ ] A person without the reopen right cannot reopen; a founder reopens with a reason; the earlier completion stays in History; deferred/cancelled items stay as they were.

## J. Internal project
- [ ] Founder creates an internal project (no opportunity, no PO) with an owner; mark it ongoing; it never offers "On site".
- [ ] Complete it with the owner's note (no client evidence needed).

## K. Phones
- [ ] On a phone: the project tabs scroll sideways, tables become readable, forms are usable, nothing hides under the bottom bar, dark and light themes are readable.

## L. Nothing else changed
- [ ] Attendance, leave, reimbursements, Recovery Leave, approvals and Sales work exactly as before.
