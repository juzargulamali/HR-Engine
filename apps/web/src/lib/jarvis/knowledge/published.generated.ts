// GENERATED from docs/enginious-os/staff-guidance/*.md by scripts/build-jarvis-knowledge.mjs. Do not edit: change the Map and run `npm run build:jarvis-knowledge`.
// Only topics marked "published" are here.
import type { GuidanceEntry } from "../help/guidance";

export const PUBLISHED_GUIDANCE: GuidanceEntry[] = [
  {
    "id": "my-day",
    "area": "general",
    "title": "My Day",
    "keywords": [
      "my day",
      "home page",
      "homepage",
      "what is waiting for me",
      "what do i need to do",
      "dashboard",
      "start page",
      "today"
    ],
    "summary": "My Day is the home page. It shows what needs you today, according to what you have access to.",
    "steps": [
      "Open the home page of Enginious OS (My Day)."
    ],
    "links": [
      {
        "label": "My Day",
        "href": "/"
      }
    ],
    "screens": [
      "/"
    ]
  },
  {
    "id": "approvals",
    "area": "general",
    "title": "Decisions waiting for you",
    "keywords": [
      "approval",
      "approvals",
      "approve",
      "decision",
      "decisions waiting",
      "waiting for my approval",
      "waiting on me",
      "needs me"
    ],
    "summary": "Decisions that are waiting for you are listed on the Approvals page. The page is empty when nothing is waiting.",
    "steps": [
      "Open Approvals from the menu or from My Day."
    ],
    "links": [
      {
        "label": "Approvals",
        "href": "/approvals"
      }
    ],
    "screens": [
      "/approvals"
    ]
  },
  {
    "id": "jarvis-about",
    "area": "general",
    "title": "What JARVIS can and cannot do",
    "keywords": [
      "jarvis",
      "assistant",
      "what can you do",
      "what can jarvis do",
      "what are you",
      "can jarvis",
      "ai assistant",
      "chatbot",
      "who are you"
    ],
    "summary": "JARVIS is the Enginious OS assistant. Ask a question, ask for a draft to copy, ask how something works, or ask about your Sales work: follow-ups, open enquiries, what needs your attention, counts for a period. In Sales & CRM it prepares enquiries, updates and meeting notes for you to review; nothing is saved until you confirm, and it never sends messages. It does not read or show saved prices, values or budgets, and does not handle pay, personal or medical details: use the screens.",
    "steps": [
      "Open JARVIS from the button on the right edge.",
      "Type what you need in plain words, or use one of the shortcuts.",
      "Press What can you do? to see the full list."
    ],
    "links": [
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      },
      {
        "label": "Follow-ups",
        "href": "/sales/follow-ups"
      }
    ],
    "screens": []
  },
  {
    "id": "jarvis-memory",
    "area": "general",
    "title": "What JARVIS remembers",
    "keywords": [
      "jarvis remember",
      "what do you remember",
      "jarvis memory",
      "forget",
      "saved preferences",
      "jarvis preferences",
      "remember that"
    ],
    "summary": "JARVIS can remember a few writing preferences for you, such as short emails or British English. It does not keep your conversations, and it never remembers business records, passwords or personal details. Only you can see your preferences.",
    "steps": [
      "Say, for example, \"Remember that I prefer short emails in British English\".",
      "Open What JARVIS remembers in the JARVIS panel to see, change or delete a preference."
    ],
    "links": [
      {
        "label": "My Day",
        "href": "/"
      }
    ],
    "screens": []
  },
  {
    "id": "jarvis-data-sent",
    "area": "general",
    "title": "What JARVIS sends to Anthropic, and what stays here",
    "keywords": [
      "what does jarvis send",
      "anthropic",
      "data sent",
      "is it private",
      "privacy",
      "does jarvis share",
      "can i paste prices",
      "can i paste a budget",
      "confidential",
      "what stays inside"
    ],
    "summary": "Lookups and plain period counts run inside Enginious OS. Text you type for a draft goes to Anthropic, with any working prices or costs you supply. Explain & suggest on a period summary sends selected Sales facts: the company, the period, the counts and the breakdown labels, which can include recorded lost reasons. An enquiry summary or scope wording sends that enquiry's brief, scope and notes as written, figures included. Never sent: value, budget and payment-terms fields, estimates, files.",
    "steps": [
      "Type working figures yourself when a draft needs them: JARVIS uses them as your assumptions.",
      "For an enquiry's value, budget or estimate, open the enquiry or Proposals & quotes: JARVIS does not read those fields.",
      "Before you press Explain & suggest, read the line above it: it says what that button sends.",
      "Text marked confidential, NDA or internal only is not sent: use the screen instead.",
      "Press What gets shared under the message box in JARVIS to read the full list."
    ],
    "links": [
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      },
      {
        "label": "Proposals & quotes",
        "href": "/sales/proposals"
      }
    ],
    "screens": []
  },
  {
    "id": "inventory-where",
    "area": "inventory",
    "title": "Warehouse and equipment",
    "keywords": [
      "inventory",
      "warehouse",
      "equipment",
      "stock",
      "request equipment",
      "equipment request",
      "scan",
      "qr",
      "transfer",
      "my equipment",
      "book equipment",
      "return equipment"
    ],
    "summary": "Inventory is where equipment is requested, sent out and received back. The equipment assigned to you is under My equipment. JARVIS cannot read or change inventory: use the screens.",
    "steps": [
      "Open Today in Inventory for the warehouse's jobs.",
      "Open Requests to prepare, send out and receive back equipment.",
      "Open My equipment to see what is assigned to you."
    ],
    "links": [
      {
        "label": "Inventory",
        "href": "/inventory"
      },
      {
        "label": "Equipment requests",
        "href": "/inventory/requests"
      },
      {
        "label": "My equipment",
        "href": "/inventory/mine"
      }
    ],
    "screens": [
      "/inventory",
      "/inventory/requests",
      "/inventory/mine",
      "/inventory/stock"
    ]
  },
  {
    "id": "people-leave",
    "area": "people",
    "title": "Ask for leave and see your balance",
    "keywords": [
      "leave",
      "request leave",
      "annual leave",
      "holiday request",
      "time off",
      "leave balance",
      "sick leave",
      "new leave request",
      "day off"
    ],
    "summary": "Your own leave balances and requests are on the My Leave page, and a new request starts from there. JARVIS cannot read or change leave: use the screens.",
    "steps": [
      "Open My Leave.",
      "Press the button for a new request and fill it in."
    ],
    "links": [
      {
        "label": "My Leave",
        "href": "/leave"
      },
      {
        "label": "New leave request",
        "href": "/leave/new"
      }
    ],
    "screens": [
      "/leave",
      "/leave/new"
    ]
  },
  {
    "id": "people-clock",
    "area": "people",
    "title": "Clock in and out",
    "keywords": [
      "clock in",
      "clock out",
      "attendance",
      "check in",
      "check-in",
      "check out",
      "timesheet",
      "working hours"
    ],
    "summary": "Your own clock in and clock out are on My Attendance Clock; your own attendance record is on My Attendance.",
    "steps": [
      "Open My Attendance Clock to clock in or out.",
      "Open My Attendance to see your record."
    ],
    "links": [
      {
        "label": "My Attendance Clock",
        "href": "/attendance-clock"
      },
      {
        "label": "My Attendance",
        "href": "/attendance"
      }
    ],
    "screens": [
      "/attendance-clock",
      "/attendance"
    ]
  },
  {
    "id": "people-claims",
    "area": "people",
    "title": "Expense claims",
    "keywords": [
      "expense",
      "expenses",
      "reimbursement",
      "reimbursements",
      "claim",
      "claims",
      "receipt",
      "expense claim",
      "refund"
    ],
    "summary": "Your own expense claims are on the My Reimbursements page, and each claim opens for its details.",
    "steps": [
      "Open My Reimbursements and choose a claim, or start a new one there."
    ],
    "links": [
      {
        "label": "My Reimbursements",
        "href": "/reimbursements"
      }
    ],
    "screens": [
      "/reimbursements"
    ]
  },
  {
    "id": "people-access",
    "area": "people",
    "title": "Getting access to a module",
    "keywords": [
      "access",
      "no access",
      "permission",
      "can't see",
      "cannot see",
      "give me access",
      "who can give access",
      "module access",
      "grant access",
      "why can't i",
      "not allowed"
    ],
    "summary": "Access to a module (Sales, Projects, Inventory and so on) is given by the people who manage People & Access: a System Administrator, an HR Admin, or a module access manager. If a screen says you do not have access, ask one of them. JARVIS cannot change anyone's access.",
    "steps": [
      "Open People & Access if you manage access, or ask the person who does."
    ],
    "links": [
      {
        "label": "People & Access",
        "href": "/people-access"
      }
    ],
    "screens": [
      "/people-access"
    ]
  },
  {
    "id": "projects-where",
    "area": "projects",
    "title": "Projects and tasks",
    "keywords": [
      "project",
      "projects",
      "task",
      "tasks",
      "my work",
      "my tasks",
      "milestone",
      "project calendar",
      "project plan",
      "handovers",
      "new project"
    ],
    "summary": "Your own tasks are under My Work; the Projects page lists the projects you can see. A project opens on Work, with Timeline and Equipment beside it; the rest is under Manage project. The project's conversation is its group in Chat. JARVIS cannot read or change projects yet: use the screens.",
    "steps": [
      "Open My Work for your tasks, the reviews waiting for you and the blockers you can clear.",
      "Open Projects for the directory and choose a project. It opens on Work.",
      "Read What needs doing at the top of Work: it lists what needs you and what is waiting on someone else."
    ],
    "links": [
      {
        "label": "My Work",
        "href": "/projects/work"
      },
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "Project calendar",
        "href": "/projects/calendar"
      }
    ],
    "screens": [
      "/projects",
      "/projects/work",
      "/projects/calendar"
    ]
  },
  {
    "id": "projects-my-work",
    "area": "projects",
    "title": "My tasks in projects: My Work",
    "keywords": [
      "my work",
      "my tasks",
      "waiting for my review",
      "review queue",
      "blockers",
      "blocked task",
      "who can unblock",
      "sent for review",
      "overdue task",
      "start a task",
      "submit for review",
      "mark done"
    ],
    "summary": "My Work keeps three things apart: My tasks (work you must do), Waiting for my review (work others sent you to accept or send back) and Blockers I can help clear (blocked tasks that name you, or that nobody is named on in a project you manage). Work you sent for review is listed separately as waiting on someone else. A task opens in a panel beside the list, so your search, filters and view stay.",
    "steps": [
      "Open My Work and choose My tasks, Waiting for my review or Blockers I can help clear.",
      "Open a task. The top says where it stands, when it is due, what blocks it and who can unblock it.",
      "Use the main button: Start, Send for review or Mark done on your own task; Accept and complete or Request changes on a review.",
      "Add a comment on the task if something needs saying about that task.",
      "Close the panel to return to the same list."
    ],
    "links": [
      {
        "label": "My Work",
        "href": "/projects/work"
      }
    ],
    "screens": [
      "/projects/work"
    ]
  },
  {
    "id": "projects-work-page",
    "area": "projects",
    "title": "A project's Work page",
    "keywords": [
      "work page",
      "what needs doing",
      "next action",
      "needs you",
      "waiting on someone else",
      "delivery summary",
      "next milestone",
      "site booking",
      "equipment draft",
      "import failed",
      "waiting for warehouse",
      "recent activity",
      "project manager"
    ],
    "summary": "Work is where a project starts. What needs doing is first: under Needs you are blockers you can clear, reviews, your overdue tasks and, for the Project Manager, overdue milestones and equipment decisions; under Waiting on someone else is everything that is another person's step. Each line shows its owner and due date, or says that none is recorded. The Project Manager also gets a delivery summary: next milestone, next site booking and equipment.",
    "steps": [
      "Open the project. Work is the first tab.",
      "Read Needs you and open a line to go to that task or record.",
      "For equipment, the Project Manager opens Equipment to review a draft and submit it; nothing is submitted for you.",
      "If the line says Import failed, press Import the handover equipment to try again, or open Equipment.",
      "Use Recent activity and Go to for the timeline, files, dependencies and site bookings."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/work"
    ]
  },
  {
    "id": "projects-chat",
    "area": "projects",
    "title": "Project chat",
    "keywords": [
      "project chat",
      "project discussion",
      "discussion tab",
      "message the project team",
      "chat group",
      "mention",
      "unread messages",
      "reply to the team",
      "discussion moved to chat"
    ],
    "summary": "Each project has one group in Chat, named by the project's reference and name. It replaces the Discussion tab: the earlier messages are in the group. Everyone on the project's team is in it and can read and reply from any page with the Chat button; people who are not on the team do not see it. Type @ to mention a team member: they see a red marker on the Chat button. A finished project's conversation can be read but not added to. Comments about one task stay on that task.",
    "steps": [
      "Press the Chat button at the corner of any page and choose the project under Projects.",
      "Or open the project and press Chat in its header.",
      "Write your message; type @ and choose a name to mention someone.",
      "An old Discussion link opens the same group."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/work",
      "/projects/[id]/discussion"
    ]
  },
  {
    "id": "projects-handover",
    "area": "projects",
    "title": "Accept a Sales handover",
    "keywords": [
      "handover",
      "accept handover",
      "ask sales a question",
      "clarification",
      "delivery brief",
      "project manager",
      "assign project manager",
      "new project from sales",
      "handovers waiting"
    ],
    "summary": "When Sales wins a job, the handover comes to Projects. Handovers waiting on you are listed first, the longest wait at the top, however many older finished ones there are. My Day opens the exact brief. The brief starts with the agreed scope, the site and dates, the equipment, the dependencies and risks, and any question you already asked Sales.",
    "steps": [
      "Open the handover from My Day, or open Handovers.",
      "Read the brief.",
      "Press Accept handover to create the project with you as Project Manager; it opens on the project's Work page.",
      "Or press Ask Sales a question; the handover goes back to Sales and you are told when they resubmit.",
      "If you press Accept twice, the same project opens: a second one is never created."
    ],
    "links": [
      {
        "label": "Handovers",
        "href": "/projects/handovers"
      },
      {
        "label": "My Work",
        "href": "/projects/work"
      }
    ],
    "screens": [
      "/projects/handovers"
    ]
  },
  {
    "id": "projects-list-overview",
    "area": "projects",
    "title": "The Projects page: every project you can open",
    "keywords": [
      "project directory",
      "all projects",
      "completed projects",
      "archived projects",
      "next milestone of a project",
      "summary only",
      "who is the project manager"
    ],
    "summary": "The Projects page lists every project you can see, with its Project Manager, status and key dates. Needs you at the top links to what waits for you across projects. A project you work on opens in full; any other project opens a short summary beside the list, because its plans, chat and files are for its team. The Next milestone column is filled only for projects you are part of.",
    "steps": [
      "Open Projects & Tasks, then Projects.",
      "Type in the search box to find a project by name, reference or Project Manager.",
      "Use Show to switch between Ongoing and Completed and archived, and Kind, Status or Company to narrow the list. Press Clear to remove the filters.",
      "Click a column heading such as Key dates or Status to sort, or choose Board to see the ongoing projects by status.",
      "Click a project to open it. All projects on the project brings you back to the same list."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "My Work",
        "href": "/projects/work"
      }
    ],
    "screens": [
      "/projects"
    ]
  },
  {
    "id": "projects-new-internal",
    "area": "projects",
    "title": "Start an internal project",
    "keywords": [
      "new internal project",
      "create a project",
      "add a project",
      "internal project",
      "accountable owner",
      "project reference code",
      "set code",
      "ongoing work",
      "showroom project",
      "no client project"
    ],
    "summary": "An internal project is for work with no client and no Sales enquiry, such as showroom technology or maintenance. Only a founder, or someone a founder allowed to assign Project Managers, can create one; everyone else does not see the button. The person you name as accountable owner becomes its Project Manager. Client projects are never created here: they start when a Project Manager accepts a Sales handover. Pressing Create project twice makes two projects, so press it once.",
    "steps": [
      "Open Projects and press New internal project.",
      "Enter the Project name and choose the Accountable owner. With more than one company, choose the Company first.",
      "Open Add more details if you want a Start date, End date, Ongoing work or a Brief.",
      "If the form says the company has no project reference code yet, a founder sets it with Set code first.",
      "Press Create project. The new project opens in Planning."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "New internal project",
        "href": "/projects/new"
      }
    ],
    "screens": [
      "/projects/new",
      "/projects"
    ]
  },
  {
    "id": "projects-status",
    "area": "projects",
    "title": "Put a project on hold, resume it or reopen it",
    "keywords": [
      "put a project on hold",
      "hold a project",
      "resume a project",
      "review date",
      "archive a project",
      "reopen a project",
      "edit project details",
      "manage project"
    ],
    "summary": "The Project Manager, a temporary project leader or a founder moves a project on, holds it or resumes it from Manage project in the project header. The Project Manager or a founder can also drag the project in the Projects card view. One step forward needs nothing more; going back or skipping a step needs a reason; a hold needs a reason and a review date. Completing has its own page, Complete project. Reopening a completed project is only for founders and people a founder allowed to reopen.",
    "steps": [
      "Open the project, press Manage project and choose Change status. Or on Projects choose Board and use Move to on the card.",
      "Choose where it moves under Move to, fill in the Reason, or Why is it on hold? and Review date, and press Save status.",
      "To bring a held project back, choose Resume: it returns to the stage it was held from.",
      "To change the name, dates, location or priority, choose Manage project, then Edit details, and press Save details.",
      "To reopen a completed project, choose Manage project, then Reopen project, say why, and press Reopen."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects",
      "/projects/[id]/work"
    ]
  },
  {
    "id": "projects-calendar",
    "area": "projects",
    "title": "The project calendar",
    "keywords": [
      "project calendar",
      "my calendar",
      "company calendar",
      "task deadlines",
      "review requests",
      "milestones",
      "site bookings",
      "month view",
      "week view",
      "agenda",
      "time zone",
      "project dates",
      "project spans"
    ],
    "summary": "Calendar has two views. My calendar shows your own task deadlines, the reviews waiting for you, the milestones of projects you are on and the site bookings made for you. Company calendar shows only each project's reference, name, status and start and end dates, never its tasks or bookings. Nothing can be changed here: click an entry to open the project and change it there. Deadlines are plain dates; timed site bookings show the site's own time first.",
    "steps": [
      "Open Projects & Tasks, then Calendar.",
      "Choose My calendar or Company calendar.",
      "Choose Month, Week or Agenda, and use the arrows or Today to move through time.",
      "On My calendar, tick what to show under Show only, choose a zone under Show times in, and press Apply.",
      "Click an entry to open its project."
    ],
    "links": [
      {
        "label": "Calendar",
        "href": "/projects/calendar"
      },
      {
        "label": "My Work",
        "href": "/projects/work"
      }
    ],
    "screens": [
      "/projects/calendar"
    ]
  },
  {
    "id": "projects-add-task",
    "area": "projects",
    "title": "Add a task to a project",
    "keywords": [
      "add task",
      "new task",
      "create a task",
      "assign a task",
      "give someone a task",
      "needs review",
      "depends on",
      "collaborators",
      "task for myself",
      "who can assign tasks"
    ],
    "summary": "Anyone on a project can add a task for themself from the project's Work page. A department head can also give tasks to the people in their team, and the Project Manager to anyone on the project. Three fields are enough: what needs doing, the assignee and the due date. The rest (department, deliverable, milestone, priority, review, dependencies, collaborators) is under Add more details. A person given a task by someone else is told.",
    "steps": [
      "Open Projects, choose the project and stay on Work.",
      "Press Add task in the task list.",
      "Fill in What needs doing, choose the Assignee and set Due.",
      "Open Add more details only if needed. A department head or the Project Manager can tick Needs review so that someone else accepts the work.",
      "Press Add task. It appears in the list as To do."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "My Work",
        "href": "/projects/work"
      }
    ],
    "screens": [
      "/projects/[id]/work"
    ]
  },
  {
    "id": "projects-task-blocker",
    "area": "projects",
    "title": "Report or clear a blocker on a task",
    "keywords": [
      "blocker",
      "blocked",
      "report a blocker",
      "task is stuck",
      "clear blocker",
      "unblock",
      "who can unblock",
      "cannot mark done",
      "waiting on someone",
      "blocked task"
    ],
    "summary": "When something stops a task, its assignee, the department head or the Project Manager reports a blocker on the task: what is in the way and who is responsible for unblocking it. That person is told, and the Project Manager is told as well when someone else is named. A blocked task shows Blocked in the list and cannot be marked done until the blocker is cleared. The assignee, the department head, the Project Manager or the named person can clear it.",
    "steps": [
      "Open the task from the project's Work page or from My Work.",
      "Press Report a blocker.",
      "Write What is blocking it and check Who is responsible for unblocking it (a person is suggested; change it if someone else can clear it).",
      "Press Report blocker.",
      "To clear it later, open the task, press More, choose Clear blocker, add a note if useful and press Clear blocker."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "My Work",
        "href": "/projects/work"
      }
    ],
    "screens": [
      "/projects/[id]/work",
      "/projects/[id]/work/tasks/[taskId]"
    ]
  },
  {
    "id": "projects-task-review",
    "area": "projects",
    "title": "Send a task for review and review it",
    "keywords": [
      "send for review",
      "ready for review",
      "review a task",
      "accept and complete",
      "request changes",
      "withdraw from review",
      "waiting for your review",
      "who reviews",
      "needs review",
      "sent back"
    ],
    "summary": "A task marked Needs review is finished by someone other than the person who did it: the head of its department or the Project Manager. The assignee starts it and sends it for review; the reviewer is told and accepts it or asks for changes with a reason; the assignee is told the result. Nobody reviews their own work. A task without Needs review is simply marked done by its owner. A blocked task cannot be accepted until the blocker is cleared.",
    "steps": [
      "Assignee: open the task, press Start, and when the work is finished press Send for review.",
      "Reviewer: open the project's Work page and look under Waiting for your review, or open My Work, then press Review.",
      "Press Accept and complete to finish the task.",
      "Or press Request changes, write what needs changing and confirm. The task returns to In progress.",
      "Assignee, before a decision: open Status on the task and choose Withdraw from review to take it back."
    ],
    "links": [
      {
        "label": "My Work",
        "href": "/projects/work"
      },
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/work",
      "/projects/[id]/work/tasks/[taskId]"
    ]
  },
  {
    "id": "projects-task-due-date",
    "area": "projects",
    "title": "Change a task's due date",
    "keywords": [
      "change due date",
      "move a deadline",
      "new due date",
      "reschedule a task",
      "why is the date changing",
      "dependent tasks",
      "deadline changed",
      "overdue task",
      "postpone a task"
    ],
    "summary": "The assignee, the department head or the Project Manager can change the due date of an open task. A reason is asked for and kept in the task's history with the old and new date. Nothing else is moved for you: if other tasks depend on this one and would now start before it finishes, they are listed so you can review them with their owners. When the assignee moves the date, the Project Manager and the department head are told; when one of them moves it, the assignee is told.",
    "steps": [
      "Open the project's Work page (or My Work) and find the task.",
      "Press the pencil beside its due date, in the list or on the task.",
      "Choose the new Due date and fill in Why is the date changing?",
      "If dependent tasks are listed, read them and tick I have seen this and will review them.",
      "Press Save due date."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "My Work",
        "href": "/projects/work"
      }
    ],
    "screens": [
      "/projects/[id]/work",
      "/projects/[id]/work/tasks/[taskId]"
    ]
  },
  {
    "id": "projects-milestones-deliverables",
    "area": "projects",
    "title": "Milestones and deliverables",
    "keywords": [
      "milestone",
      "add milestone",
      "accept milestone",
      "deliverable",
      "add deliverable",
      "department deliverable",
      "change status",
      "progress",
      "required milestone",
      "reopen milestone",
      "manage milestones"
    ],
    "summary": "Milestones are the points a project is accepted against; deliverables are pieces of work given to one department. The Project Manager adds and changes both. The head of the responsible department can update a deliverable's description, date and status and gives its work out as tasks. Progress counts accepted required milestones only. A milestone is accepted once its deliverables are closed, and a deliverable once its tasks are. Deferring, cancelling or reopening needs a reason.",
    "steps": [
      "Open the project's Work page and open Milestones & deliverables at the bottom (or press Manage milestones).",
      "Project Manager: press Plan in the task list and choose Add milestone or Add deliverable; for a deliverable choose the Department team and the Milestone.",
      "Press Edit to change one. A changed date asks why.",
      "Press Change status, choose the New status, give the reason if asked and press Change status.",
      "To accept, first close what belongs to it: a deliverable's tasks, a milestone's deliverables."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/work"
    ]
  },
  {
    "id": "projects-timeline",
    "area": "projects",
    "title": "The project timeline: Delivery and Site",
    "keywords": [
      "timeline",
      "project timeline",
      "delivery timeline",
      "site timeline",
      "site production timeline",
      "project plan",
      "add timeline item",
      "suggested stages",
      "change a date",
      "timeline bars",
      "plan calendar",
      "project calendar view"
    ],
    "summary": "Timeline is the project's plan. Choose Delivery (the build) or Site (what happens on site) and show it as a List, a Calendar or a Timeline of bars; switching the view never changes a date. The Project Manager, a temporary project leader or a founder changes the plan; everyone else on the project reads it. Nothing reaches the client unless an item is ticked for the client timeline and a version is issued from Files & client plan. A finished project's plan is read-only.",
    "steps": [
      "Open the project and choose Timeline.",
      "Choose Delivery or Site, then List, Calendar or Timeline.",
      "On an empty plan press Create suggested stages to start from the suggestion, or press Add item.",
      "In Add item fill What and choose When: Dates, Date and time at the site, or Not scheduled yet. Then press Add item.",
      "Use Edit to change an item (give a reason when the dates change) or Delete to remove it. An item that a site booking uses cannot be deleted until the booking is cancelled."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "Project calendar",
        "href": "/projects/calendar"
      }
    ],
    "screens": [
      "/projects/[id]/plan"
    ]
  },
  {
    "id": "projects-site-bookings",
    "area": "projects",
    "title": "Book people on site",
    "keywords": [
      "site booking",
      "book someone on site",
      "book a person",
      "on site",
      "double booking",
      "overlap",
      "conflict",
      "check conflicts",
      "confirm booking",
      "tentative booking",
      "cancel booking",
      "travel time",
      "preparation time",
      "who can book"
    ],
    "summary": "A site booking reserves one person at a site, in the site's own time, with preparation and travel time. The Project Manager books anyone on the project; a department head books the people of their own team. A booking starts as tentative. Confirming compares it with the person's confirmed site bookings on every project: an overlap stops it, unless a founder or someone a founder gave site-conflict authority to confirms it with a reason. The person is told when they are booked, changed or cancelled.",
    "steps": [
      "Open the project, choose Timeline, then Site.",
      "Under Site bookings press Add booking. Choose Who is booked, the Site / location, the time zone of the site, Starts and Ends, then press Add booking (tentative).",
      "Press Check conflicts to see the person's overlapping bookings. Projects you cannot see are only counted.",
      "Press Confirm booking. If it is refused for an overlap, change the time or the person, or ask someone with site-conflict authority to use Confirm even if it overlaps (needs a reason).",
      "Use Edit to change a booking (changing who, when or the travel time makes it tentative again) or Cancel booking to cancel it."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "Project calendar",
        "href": "/projects/calendar"
      }
    ],
    "screens": [
      "/projects/[id]/plan"
    ]
  },
  {
    "id": "projects-dependencies",
    "area": "projects",
    "title": "Dependencies on others",
    "keywords": [
      "dependency",
      "dependencies on others",
      "waiting for",
      "standbuilder",
      "power and network",
      "structure ready",
      "site access",
      "access permitted",
      "confirm a dependency",
      "not yet confirmed",
      "expected date",
      "responsible organisation"
    ],
    "summary": "Dependencies on others are things outside the team that must happen first: structure ready, power and network, access, the standbuilder's work. They are on the Site plan and are a record for the team only: nothing is sent to anyone. The Project Manager adds and updates them; everyone on the project can read them. A new dependency always starts as Not yet confirmed: set Confirmed or Not possible with Edit.",
    "steps": [
      "Open the project, choose Timeline, then Site.",
      "Under Dependencies on others press Add dependency.",
      "Fill What are you waiting for, choose the Kind, and add the Expected date and the Responsible organisation. Then press Add dependency.",
      "When the other party confirms, press Edit, set Confirmation to Confirmed and press Save dependency.",
      "Tick Offer this on the client timeline only if the client should see it in the next issued version."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/plan"
    ]
  },
  {
    "id": "projects-files-client-plan",
    "area": "projects",
    "title": "Files and the client plan",
    "keywords": [
      "project files",
      "upload a file",
      "add a link",
      "documents",
      "completion evidence",
      "restricted file",
      "remove a file",
      "client timeline",
      "client plan",
      "issue the timeline",
      "issue a new version",
      "download pdf",
      "record as sent",
      "client acceptance",
      "outdated timeline",
      "out of date"
    ],
    "summary": "Files & client plan holds the project's files and links and the client timeline. Anyone on the project can add and open files and links, and remove what they added; the Project Manager can remove any. The client timeline shows only what was ticked for the client. Issuing freezes a numbered version and sends nothing; sent and accepted are recorded separately by the Project Manager. If the plan changes later, the latest version is marked Outdated until a new one is issued.",
    "steps": [
      "Open the project, press Manage project and choose Files & client plan.",
      "To add a file choose Upload a file, pick the file, choose What is it and press Upload file. For a link choose Add a link and press Add link.",
      "Project Manager: check What would be issued now, then press Issue this timeline (later, Issue a new version).",
      "Press Download PDF and send it to the client yourself. Then press Record as sent and say how and to whom.",
      "When the client agrees, press Record client acceptance and give the date and who accepted."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/documents"
    ]
  },
  {
    "id": "projects-people-access",
    "area": "projects",
    "title": "Add or remove people on a project",
    "keywords": [
      "add someone to a project",
      "remove from project",
      "project members",
      "people and access",
      "department team",
      "department head",
      "temporary leader",
      "acting project manager",
      "change project manager",
      "who is on the project",
      "sales link",
      "project team"
    ],
    "summary": "People & access lists everyone on a project, their role and their department team. The Project Manager, a temporary leader or a founder adds and removes people. Only people who already have Projects access can be added. A removed person loses the project's details, files, notices and Chat group straight away. The Project Manager and a department head cannot be removed until someone else takes that role.",
    "steps": [
      "Open the project, press Manage project and choose People & access.",
      "To add someone, choose them under Add a person, pick a department if you want one, and press Add to project.",
      "To remove someone, press Remove on their row, choose who takes over their open tasks if asked, and press Remove.",
      "For a department, press Add department team, name it and choose its head; use Department on a row to move a person.",
      "The Project Manager or a founder can hand over while away: under Temporary project leadership choose a member and a last day, then press Appoint. End now stops it early."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "My Work",
        "href": "/projects/work"
      }
    ],
    "screens": [
      "/projects/[id]/people"
    ]
  },
  {
    "id": "projects-feedback-scope",
    "area": "projects",
    "title": "Feedback and scope changes on a project",
    "keywords": [
      "project feedback",
      "add feedback",
      "correction",
      "scope change",
      "propose a scope change",
      "approve scope",
      "reject scope change",
      "decide scope",
      "withdraw proposal",
      "change request",
      "extra work"
    ],
    "summary": "Feedback & changes keeps what was asked for after the job was agreed, and every change to the agreed scope. The Project Manager adds feedback as a correction or as a proposed change. Something outside the agreed scope needs a scope change proposal, and only a person with scope approval can approve or reject it, with a reason. Approving replaces the current scope; the original stays on record. No date or cost moves by itself, and a chat message never approves anything.",
    "steps": [
      "Open the project, press Manage project and choose Feedback & changes.",
      "Project Manager: press Record feedback, say who gave it, what was asked and whether it is a correction or a proposed change, then Save feedback.",
      "The person responsible presses Update on the entry to set its status and say how it was resolved, declined or deferred.",
      "Project Manager: press Propose a scope change, write the whole scope as it would read and the effect on dates, then Record proposal.",
      "Scope approver: open the proposal from My Day or on this page, press Decide, choose Approve or Reject, give the reason and press Record decision."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "My Day",
        "href": "/"
      }
    ],
    "screens": [
      "/projects/[id]/changes",
      "/projects/scope-decisions/[scopeChangeId]"
    ]
  },
  {
    "id": "projects-complete",
    "area": "projects",
    "title": "Complete a project",
    "keywords": [
      "complete project",
      "close a project",
      "finish project",
      "completion",
      "client confirmation",
      "completion evidence",
      "unfinished tasks",
      "cancel or defer",
      "completion note",
      "signed handover",
      "equipment still out"
    ],
    "summary": "Only the Project Manager, a temporary leader or a founder can complete a project. Nothing is marked done for you: every unfinished task, deliverable, milestone, piece of client feedback and upcoming site booking needs your decision and a reason. A client project also needs the client's confirmation. Completing does not return equipment: anything still out stays outstanding until the warehouse records its return. If the page says something could not load, press Retry; what you typed is kept.",
    "steps": [
      "Open the project, press Manage project and choose Complete project.",
      "Under Unfinished work choose Cancel, Defer, Resolve or Decline for each item and write the reason. Apply to all sets a whole group at once.",
      "For a client project choose the Kind of confirmation (E-mail reference, Signed handover or Uploaded confirmation), the date the client confirmed and who confirmed.",
      "Write the completion note.",
      "Press Complete project. The list under Before you can complete the project shows anything still missing."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/complete"
    ]
  },
  {
    "id": "projects-history-reopen",
    "area": "projects",
    "title": "Project history and reopening a project",
    "keywords": [
      "project history",
      "change log",
      "who changed the date",
      "sales handover snapshot",
      "completion record",
      "reopen project",
      "reopen a completed project",
      "closed too early",
      "what was agreed",
      "history tab"
    ],
    "summary": "History shows three things: the Sales handover as it was accepted, every completion with its evidence and the decisions taken, and the change log of dates, status, the Project Manager and people (the latest 100 changes). It is read-only. A founder, or someone a founder allowed to reopen projects, can reopen a finished project with a reason. The earlier completion stays in History, and anything cancelled or deferred at completion stays that way until the Project Manager reinstates it.",
    "steps": [
      "Open the project, press Manage project and choose History.",
      "Read Sales handover for what was agreed, Completion and reopening for each completion, and Change log for who changed what and why.",
      "To reopen a finished project, press Manage project and choose Reopen project. It is offered only to the people who may reopen.",
      "Write why it is being reopened and press Reopen. The project returns to In progress.",
      "The Project Manager then reinstates the cancelled or deferred items that still matter."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/history"
    ]
  },
  {
    "id": "projects-assign-project-manager",
    "area": "projects",
    "title": "Name the Project Manager for a handover",
    "keywords": [
      "assign project manager",
      "name the project manager",
      "change project manager",
      "who assigns the PM",
      "handover waiting for a project manager",
      "founder",
      "PM assignment",
      "choose a PM",
      "handover submitted by sales"
    ],
    "summary": "When Sales submits a handover, a founder, or someone a founder gave PM assignment to, names the Project Manager. Those handovers are listed under Waiting for a Project Manager to be named, the longest wait first. Only people with Projects access in that company can be chosen. The person you name is told, and then accepts the handover or asks Sales a question. You can change the Project Manager until the handover is accepted.",
    "steps": [
      "Open Handovers under Projects, or open the handover from My Day.",
      "Read the brief: agreed scope, site and dates, equipment, dependencies and risks.",
      "Choose a person under Project Manager and press Assign Project Manager.",
      "To name someone else later, choose them and press Change Project Manager.",
      "If the person is not in the list, a founder gives them Projects access first."
    ],
    "links": [
      {
        "label": "Handovers",
        "href": "/projects/handovers"
      },
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/handovers"
    ]
  },
  {
    "id": "projects-equipment-request",
    "area": "projects",
    "title": "The Equipment tab of a project",
    "keywords": [
      "equipment for a project",
      "project equipment tab",
      "equipment draft",
      "imported from the sales handover",
      "technology template",
      "substitute",
      "still out"
    ],
    "summary": "The Project Manager asks the warehouse for equipment on the project's Equipment tab. A project that came from Sales starts with a draft marked Imported from the Sales handover. A request is a Draft until you press Submit to the warehouse; submitting sets nothing aside; the warehouse does that next. Then it reads Waiting for the warehouse, Being prepared, All dispatched and Closed. Other team members can read the tab but not change it.",
    "steps": [
      "Open the project, then Equipment. Open the draft, or press New equipment request and Create draft.",
      "Under Planning dates set at least a start and an end, then press Save the dates.",
      "Use Add an item or Add from a technology template; change a line under More.",
      "Press Submit to the warehouse. If something is missing, the page says what.",
      "Afterwards watch Reserved and Not covered yet; use Accept or decline for a proposed substitute, and Need to buy or rent for a shortage."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "My Work",
        "href": "/projects/work"
      }
    ],
    "screens": [
      "/projects/[id]/equipment"
    ]
  },
  {
    "id": "projects-equipment-notes",
    "area": "projects",
    "title": "Dispatch and return notes on a project",
    "keywords": [
      "dispatch note",
      "return checklist",
      "return note",
      "acknowledge",
      "confirm this list",
      "report a difference",
      "dispatch waiting for you",
      "returned please confirm",
      "equipment still out",
      "download PDF",
      "equipment not returned",
      "finished project equipment"
    ],
    "summary": "Where your company uses dispatch notes, each time the warehouse sends equipment to a project or receives it back, a numbered note appears under Dispatch & return notes on the Equipment tab. The Project Manager acknowledges it or reports a difference; nothing waits for the answer and no equipment moves because of it. Equipment still out lists what has not come back. Completing a project does not return equipment: only the warehouse records a return.",
    "steps": [
      "Open the note from My Day, or open the project, then Equipment.",
      "Read the lines. Press Acknowledge for a dispatch, or Confirm this list for a return.",
      "If something differs, press Report a difference, tick the lines, choose what is different and press Send to the warehouse.",
      "The warehouse answers it. Withdraw the report takes your report back.",
      "Use Download PDF or Open to print for a copy of the note."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "My Work",
        "href": "/projects/work"
      }
    ],
    "screens": [
      "/projects/[id]/equipment"
    ]
  },
  {
    "id": "projects-won-job-to-finished",
    "area": "projects",
    "title": "From a won job to a finished project: who does what",
    "keywords": [
      "who does what",
      "won job",
      "handover to project",
      "project workflow",
      "next step",
      "sales to projects",
      "warehouse",
      "dispatch",
      "returns",
      "complete project",
      "start to finish",
      "whose turn"
    ],
    "summary": "A won job passes from Sales to a founder, to the Project Manager, to the warehouse and back. Sales submits the handover. A founder names the Project Manager, who accepts it: that creates the project and opens its Work page. The Project Manager adds the team, plans the tasks and submits the equipment request. The warehouse reserves, sends out and later records what came back. Completing the project does not return equipment.",
    "steps": [
      "Sales: confirm the enquiry as won, then prepare and submit the handover.",
      "Founder: open Handovers and press Assign Project Manager.",
      "Project Manager: press Accept handover, add people under Manage project, People & access, and add tasks on Work. Everyone added is in the project's Chat.",
      "Project Manager: on Equipment, check the draft and press Submit to the warehouse; acknowledge the dispatch note when it comes.",
      "Project Manager: use Manage project, Complete project when the work is done. Warehouse: record the returns; the Project Manager confirms the return list."
    ],
    "links": [
      {
        "label": "Handovers",
        "href": "/projects/handovers"
      },
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "My Work",
        "href": "/projects/work"
      },
      {
        "label": "Requests",
        "href": "/inventory/requests"
      }
    ],
    "screens": [
      "/projects/handovers",
      "/projects/[id]/work",
      "/projects/[id]/equipment"
    ]
  },
  {
    "id": "projects-delivery-plan",
    "area": "projects",
    "title": "The Delivery plan of a project",
    "keywords": [
      "delivery plan",
      "deliverables by zone",
      "breakdown lines",
      "release the plan",
      "release work to the teams",
      "delegate a section",
      "accountable owner",
      "raise a correction",
      "proposed change to released work"
    ],
    "summary": "The Delivery plan lists what the project delivers, zone by zone. Each deliverable has one accountable owner and a needed-by date, and only the breakdown it needs: Hardware, Content, Programming, Installation, Testing. Everyone on the project can read all of it. The Project Manager adds deliverables and releases the work; a person a section was delegated to fills in that section. Release creates the tasks and adds the hardware to the draft equipment request, once.",
    "steps": [
      "Open the project and choose the Delivery plan tab.",
      "Project Manager: press Add deliverable, then Add line for each part it needs. Use Who defines each section to hand a section to Engineering, Content or Programming.",
      "Project Manager: press Release plan. Tasks go to their people; hardware goes on the draft equipment request, which you still submit on the Equipment tab.",
      "Anyone: press Correction on a deliverable or line if something is wrong. The lead decides and you see the decision under Decisions.",
      "After release a change is a proposal: press Edit, then Propose change. The Project Manager approves or rejects it."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/delivery"
    ]
  },
  {
    "id": "projects-delivery-plan-excel",
    "area": "projects",
    "title": "Fill the Delivery plan from Excel",
    "keywords": [
      "delivery plan excel",
      "download template",
      "import excel",
      "export excel",
      "delivery plan workbook",
      "deliverables sheet",
      "breakdown sheet",
      "reimport the plan"
    ],
    "summary": "You can prepare the Delivery plan in Excel. Download template gives a workbook with a Deliverables sheet and an optional Breakdown sheet; a simple job needs only Deliverables. Export Excel gives the current plan with its IDs, so you can edit and import it again without making duplicates. Importing shows a preview first and saves nothing until you confirm. Blank cells and missing rows never delete anything, and importing never releases work.",
    "steps": [
      "On the Delivery plan press Download template, or Export Excel to edit the current plan.",
      "Fill one row per deliverable. Keep the ID columns as they are; leave them empty for new rows.",
      "Press Import Excel and upload the file. Read the preview: Add, Update, Unchanged, Needs attention.",
      "Answer anything under Needs attention, such as a name that matches two people, then press Import.",
      "Back on the Delivery plan, the Project Manager presses Release plan when the work should go to the teams."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/delivery/import"
    ]
  },
  {
    "id": "sales-overview",
    "area": "sales",
    "title": "How Sales & CRM works",
    "keywords": [
      "sales crm",
      "sales and crm",
      "how does sales work",
      "how sales works",
      "sales module",
      "sales process",
      "sales overview",
      "explain sales",
      "what is sales",
      "sales workflow",
      "enquiry process",
      "enquiry to handover",
      "how does the crm work"
    ],
    "summary": "Sales & CRM follows each enquiry from the first message to the handover. An enquiry moves through the stages New enquiry, Qualified, Proposal preparation, Proposal sent or Estimate sent, Quote sent and Negotiation, and ends as Won or Lost. Every open enquiry keeps one next action, so Follow-ups always shows what to do next. A won enquiry is handed over to the project team; winning it does not by itself mean the project was delivered.",
    "steps": [
      "Add the enquiry in Enquiries (title, source, agency or end client, and the next action with its date).",
      "Work it from Follow-ups: log each call, email or meeting on the enquiry and plan the next step.",
      "Move it to the next stage as it progresses. Proposal sent needs a proposal recorded as sent; Estimate sent needs an estimate recorded as sent; Quote sent needs the Zoho Books quote reference.",
      "Build the estimate from the enquiry when a price is needed. Prices stay in the Estimate screen. After you send it to the client, record it as sent on the Estimates tab.",
      "Mark it Won or Lost from the enquiry page, then complete the handover for a won enquiry. Reports shows the pipeline and results for your company."
    ],
    "links": [
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      },
      {
        "label": "Follow-ups",
        "href": "/sales/follow-ups"
      },
      {
        "label": "Clients & Agencies",
        "href": "/sales/accounts"
      },
      {
        "label": "Reports",
        "href": "/sales/reports"
      }
    ],
    "screens": [
      "/sales"
    ]
  },
  {
    "id": "sales-overdue-follow-ups",
    "area": "sales",
    "title": "See your overdue follow-ups",
    "keywords": [
      "overdue follow-ups",
      "overdue follow ups",
      "overdue followups",
      "my overdue",
      "late follow-ups",
      "what is overdue",
      "overdue actions"
    ],
    "summary": "A follow-up is overdue once its due time has passed and it is still open. The Follow-ups page groups them at the top. In JARVIS you can also type \"Show my overdue Sales follow-ups\" to list your own for the selected company, or \"What needs my attention today?\" for everything.",
    "steps": [
      "Open Follow-ups in Sales. Overdue items are listed first.",
      "Open the enquiry from the item, do the work, then complete or reschedule the follow-up."
    ],
    "links": [
      {
        "label": "Follow-ups",
        "href": "/sales/follow-ups"
      }
    ],
    "screens": [
      "/sales/follow-ups"
    ]
  },
  {
    "id": "sales-jarvis-lookups",
    "area": "sales",
    "title": "Ask JARVIS about your follow-ups and enquiries",
    "keywords": [
      "what needs my attention",
      "attention today",
      "my priorities",
      "follow-ups due today",
      "upcoming follow-ups",
      "my open enquiries",
      "open enquiries for a client",
      "enquiries with no activity",
      "quiet enquiries",
      "status of an enquiry",
      "ask jarvis about enquiries"
    ],
    "summary": "In JARVIS you can ask about your Sales work for the selected company: what needs your attention today, follow-ups due today or coming up, your open enquiries (or everyone's), open enquiries for a client, agency or event, enquiries with no recorded activity, and the status of one enquiry. The answer shows whose records, the filters, the time and the exact total. It stays inside Enginious OS and never shows values or budgets.",
    "steps": [
      "Open JARVIS and choose the company at the top of the panel.",
      "Type the question, for example \"What needs my attention today?\" or \"Open enquiries for\" and the client's name.",
      "Refine it in a few words: \"the whole company instead\", \"only Negotiation\", \"make it 30 days\".",
      "Open a record from its link to act on it."
    ],
    "links": [
      {
        "label": "Follow-ups",
        "href": "/sales/follow-ups"
      },
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      }
    ],
    "screens": []
  },
  {
    "id": "sales-jarvis-summaries",
    "area": "sales",
    "title": "Ask JARVIS for a Sales summary",
    "keywords": [
      "summarise enquiries",
      "summary of this month",
      "how many enquiries",
      "how many did we win",
      "won and lost",
      "win rate",
      "which events have the most enquiries",
      "compare with last month",
      "what changed",
      "summarise this enquiry",
      "next steps for an enquiry",
      "trends"
    ],
    "summary": "JARVIS counts enquiries for a period inside Enginious OS: created, won, lost, share won, by event, by source and recorded lost reasons. Counts only, no values. Explain & suggest sends the company, the period, the counts and the breakdown labels (lost reasons included) to Anthropic: Enginious OS writes the factual sentences and Anthropic adds suggestions. For one enquiry, the AI model summarises its notes; check it against the record. A won enquiry is not a delivered project.",
    "steps": [
      "Ask, for example, \"How many enquiries did we win or lose last month?\" or \"Summarise this month's enquiries\".",
      "Change it in a few words (\"show last month instead\") or press Compare periods.",
      "Press Explain & suggest, or ask it to \"summarise\", only if you want suggestions from Anthropic; a plain count stays inside Enginious OS.",
      "For one enquiry, ask \"Summarise\" with its reference to get its facts and suggested next steps.",
      "Open Reports for values and the full report."
    ],
    "links": [
      {
        "label": "Reports",
        "href": "/sales/reports"
      },
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      }
    ],
    "screens": []
  },
  {
    "id": "sales-jarvis-scope-draft",
    "area": "sales",
    "title": "Draft the scope wording for an estimate with JARVIS",
    "keywords": [
      "estimate scope",
      "scope of work",
      "draft estimate lines",
      "line descriptions",
      "estimate wording",
      "deliverables for an estimate",
      "quotation scope",
      "help with an estimate"
    ],
    "summary": "JARVIS can draft the scope wording for an estimate: line descriptions, quantities, what the client supplies, dependencies, exclusions and questions to ask. It is a draft to copy. It has no prices, reads no saved estimate or price, and does not create, approve or send an estimate: you enter amounts in the Estimate screen.",
    "steps": [
      "Ask \"Draft the estimate scope for\" and the enquiry's reference, or paste the requirements.",
      "Check the draft and the questions, then press Copy.",
      "Open the enquiry's estimate and paste the lines you want.",
      "Enter quantities and prices there and finish the estimate as usual."
    ],
    "links": [
      {
        "label": "Proposals & quotes",
        "href": "/sales/proposals"
      },
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      }
    ],
    "screens": []
  },
  {
    "id": "sales-add-enquiry",
    "area": "sales",
    "title": "Add an enquiry",
    "keywords": [
      "add enquiry",
      "new enquiry",
      "create enquiry",
      "add an enquiry",
      "create an enquiry",
      "log an enquiry",
      "new inquiry",
      "add inquiry",
      "create inquiry",
      "quick add",
      "enter a lead",
      "new lead",
      "event not listed",
      "create event or edition",
      "add a missing event"
    ],
    "summary": "Enquiries live in Sales. The quick form needs a title, where it came from, an agency or an end client (or both) and the next action with its date. Search finds any enquiry by reference, title, agency or client, however old. The list shows 100 at a time (Previous and Next). The chips above it show My open enquiries, Overdue, Due today, Awaiting first response and No next action; each number is how many enquiries that chip will show.",
    "steps": [
      "Open Enquiries in Sales.",
      "Press Add enquiry.",
      "Fill in the title, the source, the agency and/or end client, and what happens next and when.",
      "If the enquiry is for a show, choose it in Event / Exhibition: the event start and end are filled from that edition and you can still change them. Dates you typed first are kept. If the show or its edition is not listed, press Create event or edition under the field; what you have typed stays as it is.",
      "Save. The enquiry opens so you can add more details."
    ],
    "links": [
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      },
      {
        "label": "Full new-enquiry form",
        "href": "/sales/new"
      }
    ],
    "screens": [
      "/sales/opportunities",
      "/sales/new"
    ]
  },
  {
    "id": "sales-follow-ups",
    "area": "sales",
    "title": "See and plan follow-ups",
    "keywords": [
      "follow-up",
      "follow up",
      "followup",
      "next action",
      "to-do",
      "todo",
      "reminder",
      "overdue",
      "due today",
      "schedule next action",
      "add follow-up",
      "add a follow-up",
      "log a follow-up"
    ],
    "summary": "The Follow-ups page lists what you need to do next on your enquiries. Every enquiry that is still being worked needs one open next action, so planning the next step is part of finishing the current one. On an enquiry, the Next action card at the top shows the action, who owns it and when it is due; if none is recorded it says so and offers Add follow-up.",
    "steps": [
      "Open Follow-ups in Sales to see what is due.",
      "To add one, open the enquiry and use Add follow-up (or Schedule next action in the side panel).",
      "Choose what to do, the date and who it is for."
    ],
    "links": [
      {
        "label": "Follow-ups",
        "href": "/sales/follow-ups"
      },
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      }
    ],
    "screens": [
      "/sales/follow-ups"
    ]
  },
  {
    "id": "sales-log-update",
    "area": "sales",
    "title": "Log a call, email or meeting on an enquiry",
    "keywords": [
      "log a call",
      "log call",
      "log an email",
      "log a meeting",
      "add update",
      "add an update",
      "activity",
      "record a call",
      "note on an enquiry",
      "meeting notes",
      "add a note",
      "timeline",
      "log activity",
      "history",
      "comments",
      "comment history",
      "what happened",
      "first response",
      "pick up an enquiry",
      "where does it stand"
    ],
    "summary": "Updates are the enquiry's diary. Add one after a call, an email or a meeting; you can plan the next step in the same box. The first call, email or meeting you log is recorded as the first response. To pick up someone else's enquiry, read the three cards at the top: Next action, Where it stands and Latest activity.",
    "steps": [
      "Open the enquiry.",
      "Press Add update.",
      "Choose the type (call, email, meeting, note or client response) and write what happened.",
      "Turn on Plan the next step if you want a follow-up created at the same time.",
      "To read what happened, open Activity & history. All activity shows everything in order; Comments and notes shows only what people wrote. Lines the app recorded (stage changes, follow-ups, estimates recorded as sent, handover) are marked as such."
    ],
    "links": [
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      }
    ],
    "screens": [
      "/sales/opportunities/[id]"
    ]
  },
  {
    "id": "sales-edit-details",
    "area": "sales",
    "title": "Edit an enquiry's details",
    "keywords": [
      "edit enquiry",
      "edit an enquiry",
      "change enquiry",
      "edit details",
      "change the title",
      "change the location",
      "change the dates",
      "update enquiry",
      "amend enquiry",
      "change the event date"
    ],
    "summary": "The enquiry's owner, or a Sales founder, can edit its details while it is open. Once it is Won only a founder can change the value, and a Lost enquiry cannot be edited.",
    "steps": [
      "Open the enquiry.",
      "Press Edit details.",
      "Change what you need and save. If someone else changed it first you will be asked to reload.",
      "Choosing a different Event / Exhibition fills a show date that is empty; a date already on the enquiry is kept, and Use edition dates replaces it if you want. A date you empty on purpose stays empty. Create event or edition is under that field here too."
    ],
    "links": [
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      }
    ],
    "screens": [
      "/sales/opportunities/[id]"
    ]
  },
  {
    "id": "sales-move-stage",
    "area": "sales",
    "title": "Change an enquiry's stage",
    "keywords": [
      "change stage",
      "move stage",
      "change status",
      "move to",
      "stage",
      "status of an enquiry",
      "pipeline",
      "board",
      "qualified",
      "negotiation",
      "proposal sent",
      "estimate sent",
      "quote sent",
      "on hold",
      "put on hold",
      "resume"
    ],
    "summary": "The enquiry's owner or a Sales founder moves it: one step back, or any step forward. Proposal sent and Estimate sent sit side by side: an enquiry can reach either, or both. Proposal sent needs a proposal recorded as sent, Estimate sent needs an estimate recorded as sent (Estimates tab), and Quote sent needs the Zoho Books quote reference. Won, Lost and On hold have their own forms.",
    "steps": [
      "Open the enquiry (or use the Board view of Enquiries).",
      "Choose Move to another stage and pick the stage.",
      "If the stage needs something first, the screen says what."
    ],
    "links": [
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      },
      {
        "label": "Board view",
        "href": "/sales/opportunities?view=board"
      }
    ],
    "screens": [
      "/sales/opportunities/[id]",
      "/sales/pipeline"
    ]
  },
  {
    "id": "sales-close-handover",
    "area": "sales",
    "title": "Mark an enquiry won or lost, and hand it over",
    "keywords": [
      "mark won",
      "mark as won",
      "won",
      "lost",
      "mark lost",
      "close an enquiry",
      "close enquiry",
      "handover",
      "hand over",
      "hand-over",
      "reopen",
      "re-open",
      "track a handover",
      "handover status",
      "project created",
      "open project",
      "pm asked a question"
    ],
    "summary": "Won and Lost are closed on their own form, which asks for the evidence or the reason. After Won, the enquiry shows a Delivery handover card: Handover needed, Waiting for PM assignment, Waiting for PM acceptance, PM asked a question, or Project created, with who has it next. JARVIS does not close, reopen or hand over enquiries: do those on the enquiry page.",
    "steps": [
      "Open the enquiry.",
      "Choose the Won or Lost action and fill in the form.",
      "After Won, use the button on the Delivery handover card: prepare and submit it, or answer the Project Manager's question and resubmit. A new brief starts with the linked event in Notes for the Project Manager, because the Project Manager cannot see Sales events; keep or edit it.",
      "When it says Project created, Open project takes you to the delivery project if you have access to it.",
      "The chip My won: handover open on the Enquiries list finds your won enquiries whose handover is not accepted yet."
    ],
    "links": [
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      }
    ],
    "screens": [
      "/sales/opportunities/[id]"
    ]
  },
  {
    "id": "sales-clients-agencies",
    "area": "sales",
    "title": "Find or add a client or agency",
    "keywords": [
      "add a client",
      "add client",
      "new client",
      "add an agency",
      "add agency",
      "new agency",
      "register",
      "client or agency",
      "clients and agencies",
      "organisation",
      "organization",
      "account",
      "duplicate client",
      "import clients",
      "excel import"
    ],
    "summary": "Clients & Agencies holds every organisation. Search first so you do not add the same one twice. An organisation can be an agency, a direct client, an end client or a technology company, and an enquiry's agency and end-client boxes offer only organisations with the matching role.",
    "steps": [
      "Open Clients & Agencies and search by name. The search and the filters apply as you type or choose; More filters holds country, lead source and exhibition.",
      "If it is not there, add it with its roles (and country and website if you know them).",
      "To add many at once, use Import from Excel."
    ],
    "links": [
      {
        "label": "Clients & Agencies",
        "href": "/sales/accounts"
      },
      {
        "label": "Import from Excel",
        "href": "/sales/accounts/import"
      }
    ],
    "screens": [
      "/sales/accounts",
      "/sales/accounts/import",
      "/sales/clients"
    ]
  },
  {
    "id": "sales-estimates",
    "area": "sales",
    "title": "Build an estimate",
    "keywords": [
      "estimate",
      "estimates",
      "quotation",
      "quote",
      "boq",
      "price an enquiry",
      "pricing",
      "vat",
      "revision",
      "pdf of the estimate",
      "excel of the estimate",
      "record estimate as sent",
      "estimate sent",
      "sent the estimate"
    ],
    "summary": "Estimates are built on the enquiry's Estimates tab in three steps: details, items, then preview and finalise. An estimate is budgetary; official quotations go through the Zoho Books workflow. Finalising or downloading an estimate does not send it and does not record it as sent: you send it yourself, then record that here.",
    "steps": [
      "Open the enquiry and go to the Estimates tab.",
      "Create an estimate and fill in the details and the items.",
      "Preview, then finalise. A finalised estimate is frozen; make a revision to change it.",
      "After you have sent it to the client, press Record estimate as sent on that revision, confirm the date it went out, and choose whether to move the enquiry to Estimate sent.",
      "If the enquiry is already at Quote sent or Negotiation, the estimate is recorded and the stage stays where it is."
    ],
    "links": [
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      }
    ],
    "screens": [
      "/sales/proposals"
    ]
  },
  {
    "id": "sales-events",
    "area": "sales",
    "title": "Events & Exhibitions",
    "keywords": [
      "events and exhibitions",
      "exhibitions",
      "trade shows",
      "trade fair",
      "expo",
      "upcoming shows",
      "event calendar",
      "calendar view",
      "month view",
      "add an event",
      "add an edition",
      "first edition",
      "which shows are coming",
      "conference"
    ],
    "summary": "Events & Exhibitions is the shared calendar of shows, one row per edition, with how many enquiries are linked to each. It opens on upcoming editions; you can filter by name, country and dates, or switch to past editions. Everyone in Sales sees the same calendar; the enquiry figures count only the enquiries you can see. It helps you see which shows are coming up, how much business each one has brought, and which to prepare for.",
    "steps": [
      "Open Events & Exhibitions in Sales.",
      "Search or choose a filter to find a show: the list changes as soon as you choose, and Clear removes the filters. Open a show to see its editions, who exhibited and the agencies to contact.",
      "Press Add event for a show that is not listed. One form takes the name, the type and the first edition's dates and place, and one save adds both. If the name already exists, the form shows that event and offers to add the edition to it instead.",
      "Press Add edition for the next year of a show that is already listed.",
      "Switch from List to Calendar to see the shows by month (Previous, Next and Today move between months; a show's name is on each of its days and opens that edition). To add many shows at once, use Import events with the template."
    ],
    "links": [
      {
        "label": "Events & Exhibitions",
        "href": "/sales/events"
      },
      {
        "label": "Import events",
        "href": "/sales/events/import"
      }
    ],
    "screens": [
      "/sales/events"
    ]
  },
  {
    "id": "sales-event-page",
    "area": "sales",
    "title": "Work one event: who exhibited, agencies to contact, observations",
    "keywords": [
      "record an observation",
      "who exhibited",
      "which agency built the stand",
      "agencies to contact",
      "exhibitor history",
      "stand builder",
      "event page",
      "add first edition",
      "add next edition",
      "archive an event",
      "outreach priority"
    ],
    "summary": "An event page shows the same show across its editions: who exhibited each year and with which agency, the agencies worth contacting for the next edition (highest outreach priority first), and the enquiries linked to it. At the show you can record what you see on your phone without creating an enquiry.",
    "steps": [
      "Press Record an observation, choose the edition and the exhibitor, then the agency (or Agency unknown).",
      "Read Who exhibited, and with which agency to compare the years.",
      "Under Agencies to contact, set the outreach priority and open the account to start outreach or a follow-up.",
      "Press Add first edition on an event that has none yet, or Add next edition when the next dates are known. Archive keeps the history; nothing is deleted."
    ],
    "links": [
      {
        "label": "Events & Exhibitions",
        "href": "/sales/events"
      },
      {
        "label": "Clients & Agencies",
        "href": "/sales/accounts"
      }
    ],
    "screens": [
      "/sales/events/[id]"
    ]
  },
  {
    "id": "sales-events-import",
    "area": "sales",
    "title": "Import events from a spreadsheet",
    "keywords": [
      "import events",
      "upload events",
      "bulk add events",
      "events spreadsheet",
      "events template",
      "excel events",
      "csv events"
    ],
    "summary": "Import events adds many shows and editions to the shared calendar from one file. Each row is one edition and needs the event name, country, start date and end date. Nothing is saved until you confirm the preview.",
    "steps": [
      "Download the template and fill one row per edition (dates as YYYY-MM-DD).",
      "Upload the file and read the preview: each row is marked new, adds an edition, already present or needs correction.",
      "Correct any row that needs it and upload again.",
      "Press Confirm. All rows are saved together or none."
    ],
    "links": [
      {
        "label": "Import events",
        "href": "/sales/events/import"
      },
      {
        "label": "Events & Exhibitions",
        "href": "/sales/events"
      }
    ],
    "screens": [
      "/sales/events/import"
    ]
  },
  {
    "id": "sales-outreach",
    "area": "sales",
    "title": "Outreach: accounts assigned to you to approach",
    "keywords": [
      "outreach",
      "my outreach",
      "prospects",
      "prospecting",
      "accounts to approach",
      "assigned accounts",
      "log outreach",
      "cold approach",
      "re-engage a client",
      "assign outreach"
    ],
    "summary": "Outreach is your list of accounts to approach before any enquiry exists. Each card shows the objective, the target date, the last contact and the next action, with overdue ones marked. It never creates an enquiry by itself; you create one from the account when the client is ready.",
    "steps": [
      "Open Outreach in Sales to see what is assigned to you.",
      "Open an account from its card to log what you did and set the next action.",
      "Choose a status or tick Overdue only to decide what to do first: the list changes as soon as you choose, and Clear removes the filters.",
      "Accounts are assigned from Clients & Agencies by the people who manage Sales assignments."
    ],
    "links": [
      {
        "label": "Outreach",
        "href": "/sales/outreach"
      },
      {
        "label": "Clients & Agencies",
        "href": "/sales/accounts"
      }
    ],
    "screens": [
      "/sales/outreach"
    ]
  },
  {
    "id": "sales-reports",
    "area": "sales",
    "title": "Sales reports",
    "keywords": [
      "report",
      "reports",
      "sales report",
      "enquiries by source",
      "pipeline value",
      "kpi",
      "response time",
      "statistics"
    ],
    "summary": "Sales reports are read-only pages of figures with their definitions. If a card cannot be loaded it says so instead of showing zero.",
    "steps": [
      "Open Reports in Sales.",
      "Choose the period, and the company if you have access to more than one."
    ],
    "links": [
      {
        "label": "Sales reports",
        "href": "/sales/reports"
      }
    ],
    "screens": [
      "/sales/reports"
    ]
  },
  {
    "id": "sales-settings",
    "area": "sales",
    "title": "Sales settings",
    "keywords": [
      "sales settings",
      "reference code",
      "response target",
      "working calendar",
      "duplicate window",
      "approval policy",
      "vat choices",
      "settings"
    ],
    "summary": "Each company's Sales settings (reference code, currency, response target, working calendar, duplicate window, owner e-mail, approval policy and the estimate VAT choices) are kept on one page, for people who manage Sales settings or are founders.",
    "steps": [
      "Open Settings in Sales (under Manage in the menu)."
    ],
    "links": [
      {
        "label": "Sales settings",
        "href": "/sales/settings"
      }
    ],
    "screens": [
      "/sales/settings"
    ]
  }
];
