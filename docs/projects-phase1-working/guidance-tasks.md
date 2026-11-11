## Add a task to a project
- id: projects-add-task
- area: projects
- status: published
- keywords: add task; new task; create a task; assign a task; give someone a task; needs review; depends on; collaborators; task for myself; who can assign tasks
- links: Projects -> /projects; My Work -> /projects/work
- screens: /projects/[id]/work

Anyone on a project can add a task for themself from the project's Work page. A department head can also give tasks to the people in their team, and the Project Manager to anyone on the project. Three fields are enough: what needs doing, the assignee and the due date. The rest (department, deliverable, milestone, priority, review, dependencies, collaborators) is under Add more details. A person given a task by someone else is told.

1. Open Projects, choose the project and stay on Work.
2. Press Add task in the task list.
3. Fill in What needs doing, choose the Assignee and set Due.
4. Open Add more details only if needed. A department head or the Project Manager can tick Needs review so that someone else accepts the work.
5. Press Add task. It appears in the list as To do.

## Report or clear a blocker on a task
- id: projects-task-blocker
- area: projects
- status: published
- keywords: blocker; blocked; report a blocker; task is stuck; clear blocker; unblock; who can unblock; cannot mark done; waiting on someone; blocked task
- links: Projects -> /projects; My Work -> /projects/work
- screens: /projects/[id]/work; /projects/[id]/work/tasks/[taskId]

When something stops a task, its assignee, the department head or the Project Manager reports a blocker on the task: what is in the way and who is responsible for unblocking it. That person is told, and the Project Manager is told as well when someone else is named. A blocked task shows Blocked in the list and cannot be marked done until the blocker is cleared. The assignee, the department head, the Project Manager or the named person can clear it.

1. Open the task from the project's Work page or from My Work.
2. Press Report a blocker.
3. Write What is blocking it and check Who is responsible for unblocking it (a person is suggested; change it if someone else can clear it).
4. Press Report blocker.
5. To clear it later, open the task, press More, choose Clear blocker, add a note if useful and press Clear blocker.

## Send a task for review and review it
- id: projects-task-review
- area: projects
- status: published
- keywords: send for review; ready for review; review a task; accept and complete; request changes; withdraw from review; waiting for your review; who reviews; needs review; sent back
- links: My Work -> /projects/work; Projects -> /projects
- screens: /projects/[id]/work; /projects/[id]/work/tasks/[taskId]

A task marked Needs review is finished by someone other than the person who did it: the head of its department or the Project Manager. The assignee starts it and sends it for review; the reviewer is told and accepts it or asks for changes with a reason; the assignee is told the result. Nobody reviews their own work. A task without Needs review is simply marked done by its owner. A blocked task cannot be accepted until the blocker is cleared.

1. Assignee: open the task, press Start, and when the work is finished press Send for review.
2. Reviewer: open the project's Work page and look under Waiting for your review, or open My Work, then press Review.
3. Press Accept and complete to finish the task.
4. Or press Request changes, write what needs changing and confirm. The task returns to In progress.
5. Assignee, before a decision: open Status on the task and choose Withdraw from review to take it back.

## Change a task's due date
- id: projects-task-due-date
- area: projects
- status: published
- keywords: change due date; move a deadline; new due date; reschedule a task; why is the date changing; dependent tasks; deadline changed; overdue task; postpone a task
- links: Projects -> /projects; My Work -> /projects/work
- screens: /projects/[id]/work; /projects/[id]/work/tasks/[taskId]

The assignee, the department head or the Project Manager can change the due date of an open task. A reason is asked for and kept in the task's history with the old and new date. Nothing else is moved for you: if other tasks depend on this one and would now start before it finishes, they are listed so you can review them with their owners. When the assignee moves the date, the Project Manager and the department head are told; when one of them moves it, the assignee is told.

1. Open the project's Work page (or My Work) and find the task.
2. Press the pencil beside its due date, in the list or on the task.
3. Choose the new Due date and fill in Why is the date changing?
4. If dependent tasks are listed, read them and tick I have seen this and will review them.
5. Press Save due date.

## Milestones and deliverables
- id: projects-milestones-deliverables
- area: projects
- status: published
- keywords: milestone; add milestone; accept milestone; deliverable; add deliverable; department deliverable; change status; progress; required milestone; reopen milestone; manage milestones
- links: Projects -> /projects
- screens: /projects/[id]/work

Milestones are the points a project is accepted against; deliverables are pieces of work given to one department. The Project Manager adds and changes both. The head of the responsible department can update a deliverable's description, date and status and gives its work out as tasks. Progress counts accepted required milestones only. A milestone is accepted once its deliverables are closed, and a deliverable once its tasks are. Deferring, cancelling or reopening needs a reason.

1. Open the project's Work page and open Milestones & deliverables at the bottom (or press Manage milestones).
2. Project Manager: press Plan in the task list and choose Add milestone or Add deliverable; for a deliverable choose the Department team and the Milestone.
3. Press Edit to change one. A changed date asks why.
4. Press Change status, choose the New status, give the reason if asked and press Change status.
5. To accept, first close what belongs to it: a deliverable's tasks, a milestone's deliverables.
