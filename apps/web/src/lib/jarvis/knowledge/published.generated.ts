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
      "today",
      "needs me",
      "operations summary",
      "waiting for a decision",
      "most urgent issue",
      "operations on my day"
    ],
    "summary": "My Day is the home page. It shows what needs you today, according to what you have access to. Needs me is one list of what waits for you. A Project Manager sees Review equipment booking there, one line per project. An Operations Manager also sees an Operations card with the number of situations waiting for a decision, the next three installations and the most urgent issue, and a line in Needs me when Sales answers their question. If a part cannot be loaded, the page says so and never shows zero.",
    "steps": [
      "Open the home page of Enginious OS (My Day).",
      "Read Needs me first. Each line opens the screen where you act.",
      "Operations Managers: on the Operations card, press the number under Waiting for a decision to open that list in Operations.",
      "Press an installation or the most urgent issue to open that project or record."
    ],
    "links": [
      {
        "label": "My Day",
        "href": "/"
      },
      {
        "label": "Operations Overview",
        "href": "/operations"
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
    "summary": "Inventory is where equipment is requested, sent out and received back. On Today a request reads ready to send in part while any line is still to reserve, buy or rent; those lines are counted apart and never as reserved. The equipment assigned to you is under My equipment. JARVIS cannot read or change inventory: use the screens.",
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
    "id": "people-add-department",
    "area": "people",
    "title": "Add a department and give it to someone",
    "keywords": [
      "department",
      "add department",
      "create department",
      "new department",
      "department list empty",
      "no departments",
      "assign department",
      "change department",
      "job and department",
      "reporting manager"
    ],
    "summary": "An HR Admin adds departments for their own company in People & Access, on a person's Job & department tab. A new department joins that company's list and is selected for the person on screen; it is given to them only when Save job details is pressed. A name already used in the company is refused. If the screen says departments could not be loaded, reload the page; that is not the same as having none. Departments cannot be renamed or removed here yet.",
    "steps": [
      "Open People & Access and choose an employee of your company.",
      "Open the Job & department tab.",
      "Under Add a department, type the name and press Add department.",
      "Check the Department list shows it selected, then press Save job details.",
      "For the next person, choose the department from the list and press Save job details."
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
    "id": "people-operations-manager-access",
    "area": "people",
    "title": "Make someone an Operations Manager, or stop it",
    "keywords": [
      "operations manager access",
      "make someone operations manager",
      "who can open operations",
      "remove operations manager",
      "take away operations access",
      "operations manager profile"
    ],
    "summary": "Operations Manager is given per company, inside a person's Projects access, by a Projects founder or someone who manages Projects access. It opens Operations for that company, lets the person assign Project Managers, read every project of the company and use its project chats. It gives nothing in Sales, Finance, HR or the warehouse, and they cannot manage a project or its tasks.",
    "steps": [
      "Open People & Access, find the person and open their Projects access; check Access for company.",
      "Under Working profile choose Operations Manager.",
      "Read Review before saving, then press Save changes. They see Operations on their next page.",
      "To stop it, choose another profile such as Project directory viewer, review and press Save changes.",
      "It ends on their next page: Operations and the company's project chats close for them."
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
    "summary": "Each project has one group in Chat, named by the project's reference and name. It replaces the Discussion tab: the earlier messages are in the group. Everyone on the project's team is in it, and so are the company's Operations Managers, shown with Operations beside their name; nobody else sees it; the project says so. Type @ to mention a team member: they see a red marker on the Chat button. A finished project's conversation can be read but not added to. Comments about one task stay on that task.",
    "steps": [
      "Press the Chat button at the corner of any page and choose the project under Projects.",
      "Or open the project and press Chat in its header.",
      "Write your message; type @ and choose a name to mention someone.",
      "An old Discussion link opens the same group. A completed or archived project's group is under Archived."
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
      "Use Show to switch between Ongoing and Completed and archived, and Kind, Status, Company or Event edition to narrow the list. Press Clear to remove the filters.",
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
    "summary": "Files & client plan holds the project's files and links and the client timeline. Anyone on the project can add and open files and links, and remove what they added; the Project Manager can remove any, and alone sees files marked Restricted. The client timeline shows only what was ticked for the client. Issuing freezes a numbered version and sends nothing; sent and accepted are recorded separately by the Project Manager. If the plan changes later, the latest version is marked Outdated until a new one is issued.",
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
    "summary": "When Sales submits a handover, a founder, an Operations Manager, or someone a founder gave PM assignment to, names the Project Manager. Those handovers are listed under Waiting for a Project Manager to be named, the longest wait first. Only people with Projects access in that company can be chosen. The person you name is told, and then accepts the handover or asks Sales a question. You can change the Project Manager until the handover is accepted.",
    "steps": [
      "Open Handovers under Projects, or open the handover from My Day.",
      "Read the brief: agreed scope, site and dates, equipment, dependencies and risks.",
      "Choose a person under Project Manager and press Assign Project Manager.",
      "To name someone else later, press Change Project Manager. On a live project it is under People & access and asks for a reason; both Project Managers are told.",
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
    "summary": "The Project Manager asks the warehouse for equipment on the project's Equipment tab. A project that came from Sales starts with a draft marked Imported from the Sales handover. A request is a Draft until you press Submit to the warehouse; submitting sets nothing aside; the warehouse does that next. Then it reads Waiting for the warehouse, Being prepared, All dispatched and Closed. Each request has a Readiness line: Reserved, Partly ready, Short, Dispatched and so on. Others can read the tab but not change it.",
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
    "summary": "A won job passes from Sales to a founder or Operations Manager, to the Project Manager, to the warehouse and back. Sales submits the handover. A founder or Operations Manager names the Project Manager, who accepts it: that creates the project and opens its Project Plan (the Work page is one click away). The Project Manager adds the team, plans the tasks and submits the equipment request. The warehouse reserves, sends out and later records what came back. Completing the project does not return equipment.",
    "steps": [
      "Sales: confirm the enquiry as won, then prepare and submit the handover.",
      "Founder or Operations Manager: open Handovers and press Assign Project Manager.",
      "Project Manager: press Accept handover (it opens the Project Plan, where you press Bring in accepted technologies), add people under Manage project, People & access, and add tasks on Work. Everyone added is in the project's Chat.",
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
    "title": "The Project Plan of a project",
    "keywords": [
      "project plan",
      "delivery plan",
      "plan the project",
      "break a technology into requirements",
      "technologies and activations",
      "requirements",
      "summary of what needs attention",
      "next site date",
      "delegate a section",
      "accountable owner",
      "start from a sequence",
      "bring in accepted technologies",
      "raise a correction"
    ],
    "summary": "The Project Plan is where the Project Manager breaks each technology of an accepted job into what it needs, gives each piece an owner and dates, and sees what holds up delivery. Everyone on the project can read it. Sections: Hardware, Content, Apps, Engineering & integration, Site work; a simple job may use only Hardware and Site work.",
    "steps": [
      "Open the project and choose the Project Plan tab (also the card at the top of Work, and where Accept handover takes you).",
      "Read the strip at the top: the next site date, what needs attention (blockers first, then missing owners, late dependencies, hardware to source, equipment drafts to send) and the next action. Each item opens its row.",
      "Project Manager: accepting a handover does not add anything to the plan. Press Bring in accepted technologies in the highlighted Next step panel at the top to add what the handover accepted (a manual step; pressing it again never duplicates or overwrites your edits), or press Add technology / activation with a quantity, an accountable owner and a ready-by date.",
      "Open a technology and press Add requirement, or Start from a sequence (Moodboard, Storyboard, First draft and so on, each waiting for the one before; rename, add or remove steps, give each an owner and dates).",
      "Use Who defines each section to hand a section to Engineering, Content, Programming or the Site Lead. Anyone can press Correction if something is wrong."
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
    "id": "projects-plan-hardware-and-release",
    "area": "projects",
    "title": "Hardware and releasing the Project Plan",
    "keywords": [
      "release the plan",
      "release work to the teams",
      "hardware in the plan",
      "supply route",
      "manual hardware line",
      "needs stock match",
      "specification pending",
      "needs sourcing",
      "rent",
      "buy",
      "client supplied",
      "review and send to warehouse",
      "draft equipment request"
    ],
    "summary": "Release gives the work to the teams: each work requirement becomes one task for its owner, and each hardware line matched to Inventory goes on the project's draft equipment request. Releasing again, or at the same time, never creates anything twice.",
    "steps": [
      "Hardware: choose the stock item from Inventory. If it is not there, save it as a manual line: it stays in the plan as Needs stock match or Specification pending while everything else is released.",
      "Bought, rented or client-supplied hardware is followed in the plan with its owner and expected date and is never sent to the warehouse.",
      "Project Manager: press Release plan. Read what it will create first, then confirm.",
      "Press Review and send to Warehouse on a hardware line to open the draft request, and submit it on the Equipment tab.",
      "Later, match a manual line to a stock item and release again: it is added once."
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
    "id": "projects-plan-after-release",
    "area": "projects",
    "title": "Follow the Project Plan after release",
    "keywords": [
      "timeline of the plan",
      "breakdown and timeline",
      "milestone n of m complete",
      "ready for mockup",
      "propose change to released work",
      "task update pending",
      "resolve task update",
      "late dependency",
      "unscheduled work"
    ],
    "summary": "After release the task is the record: the person doing it updates it once in My Work, and the Project Plan, its Timeline and the milestone show the same status. Dates and owners change by proposal.",
    "steps": [
      "Press Timeline beside Breakdown to see the same work with dates across; work with no dates is listed under the chart and a late predecessor is shown against the work that waits for it.",
      "A milestone shows how many of its tasks are complete and which are outstanding. All tasks complete means ready to confirm; confirming the milestone is a separate step on Work.",
      "To change something released, press Edit, then Propose change. The Project Manager approves or rejects it.",
      "When a new owner, date or milestone is approved, or an old one is cleared, the task is updated to match. If the task cannot take it, the requirement says Task update pending.",
      "Project Manager: press Resolve, then Retry the update, or Keep the task as it is."
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
      "/projects/[id]/delivery"
    ]
  },
  {
    "id": "projects-delivery-plan-excel",
    "area": "projects",
    "title": "Fill the Project Plan from Excel",
    "keywords": [
      "project plan excel",
      "delivery plan excel",
      "download template",
      "import excel",
      "export excel",
      "project plan workbook",
      "deliverables sheet",
      "breakdown sheet",
      "reimport the plan"
    ],
    "summary": "You can prepare the Project Plan in Excel. Download template gives a workbook with a Deliverables sheet and an optional Breakdown sheet; a simple job needs only Deliverables. Export Excel gives the current plan with its IDs, so you can edit and import it again without making duplicates. Importing shows a preview first and changes nothing until you confirm; it never releases anything. Planned start dates, supply routes, details, milestones and waits-for are set on screen, not in the workbook.",
    "steps": [
      "On the Project Plan press Download template, or Export Excel to edit the current plan.",
      "Fill one row per technology. Keep the ID columns as they are; leave them empty for new rows.",
      "Press Import Excel and upload the file. Read the preview: Add, Update, Unchanged, Needs attention.",
      "Answer anything under Needs attention, such as a name that matches two people, then press Import.",
      "Back on the Project Plan, the Project Manager presses Release plan when the work should go to the teams."
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
    "id": "projects-closeout-report",
    "area": "projects",
    "title": "The closeout report of a project",
    "keywords": [
      "closeout report",
      "generate closeout report",
      "project closeout",
      "review data to be sent",
      "facts-only draft",
      "approve the report",
      "download the closeout report",
      "lessons for the next project",
      "client sign-off not recorded"
    ],
    "summary": "The closeout report is an internal report about one project, prepared by its Project Manager from the project's own records. You first see exactly what would be used; written text such as scope wording and client words is left out unless you tick it. Writing with the AI model sends only that reviewed content to Anthropic; a facts-only draft sends nothing. The report always states recorded facts such as client sign-off and equipment still out. Nothing goes to the client, and the project is not completed by it.",
    "steps": [
      "Open the project, press Manage project and choose Closeout report.",
      "Read Review data to be sent. Tick only the written text you want included.",
      "Press Send to Anthropic and write the draft, or Write a facts-only draft.",
      "Check each paragraph against its sources, edit it, then press Save edits.",
      "Press Approve version, then Download PDF on the approved version."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/closeout"
    ]
  },
  {
    "id": "operations-upcoming-work",
    "area": "projects",
    "title": "Operations: Upcoming Work",
    "keywords": [
      "upcoming work",
      "flagged enquiries",
      "operations planning",
      "provisional project manager",
      "capacity conflict",
      "ask sales to confirm",
      "next step with",
      "tentative job",
      "plan a job before it is won",
      "next unresolved item",
      "expected decision",
      "tentative dates"
    ],
    "summary": "Upcoming Work is for Operations Managers. It lists the enquiries Sales flagged for one company. Each card is headed by the event and venue and shows four things: the dates (installation, show and dismantling, marked tentative until confirmed), the expected decision, the provisional Project Manager and the next unresolved item. Press More for teams, equipment, risk and questions. It never shows prices, quotes or Sales notes. Nothing is booked until the enquiry is won and its handover is accepted.",
    "steps": [
      "Open Operations, then Upcoming Work. Choose the company if you have more than one.",
      "Use the search, Stage and Next step with to narrow the list.",
      "Press Plan on an enquiry. Choose a Provisional Project Manager, set Operational risk, tick Capacity conflict if it clashes, or write under Ask Sales to confirm.",
      "Press Save planning. Sales reads it on the enquiry; no separate notice is sent.",
      "Once the handover is submitted, press Assign a Project Manager."
    ],
    "links": [
      {
        "label": "Upcoming Work",
        "href": "/operations/upcoming"
      },
      {
        "label": "Overview",
        "href": "/operations"
      }
    ],
    "screens": [
      "/operations/upcoming"
    ]
  },
  {
    "id": "operations-overview-decisions",
    "area": "projects",
    "title": "Operations Overview: what needs you first",
    "keywords": [
      "operations overview",
      "needs my decision",
      "handover stalled",
      "installation at risk",
      "blocker not resolved",
      "summary cards",
      "delivery timeline",
      "next installations",
      "equipment issues",
      "partly dispatched",
      "event edition",
      "delivery by week",
      "equipment lines ready",
      "team pressure"
    ],
    "summary": "The Overview is for Operations Managers. Four cards at the top give the counts and open their lists: Needs my decision, Installations in the next 14 days, Equipment issues and Upcoming Sales work. Needs my decision names who each item is with, since when and why, with one button. Beside it is the delivery timeline for the next 30 days; enquiry dates are marked Tentative until won. Below are delivery by week, equipment issues and project health. Operations changes no task, booking or stock.",
    "steps": [
      "Open Operations, then Overview. Choose the company if you have more than one.",
      "Press a card at the top to jump to its list.",
      "Start with Needs my decision. For Project Manager not assigned press Assign a Project Manager, choose the person and press Assign Project Manager. They accept it; you cannot accept for them.",
      "For other items press the button on the item and speak to the person named under With.",
      "Under Next installations read the label, the event edition and how many equipment lines are ready. Under Equipment issues, Partly dispatched shows how many lines have gone out; press the project to open its Equipment tab."
    ],
    "links": [
      {
        "label": "Overview",
        "href": "/operations"
      },
      {
        "label": "Handovers",
        "href": "/projects/handovers"
      }
    ],
    "screens": [
      "/operations"
    ]
  },
  {
    "id": "operations-project-health",
    "area": "projects",
    "title": "Project health labels in Operations",
    "keywords": [
      "project health",
      "health label",
      "on track",
      "needs attention",
      "at risk",
      "not enough information",
      "how the label is decided",
      "is a project at risk",
      "why is a project at risk"
    ],
    "summary": "Each live project on the Operations Overview has one label, taken from the records. At risk: it starts within 14 days or is under way and has a shortage, an unsent equipment list, a blocked or overdue task, an overdue milestone or unreleased Delivery plan lines; or equipment is overdue back. Needs attention: a blocked or overdue task or a shortage further ahead, no Project Manager, or a booking to review. Not enough information: no date recorded. On track: dates recorded and nothing against it. It is not a score.",
    "steps": [
      "Open Operations, then Overview, and scroll to Project health.",
      "Read the reasons under the label. Each one opens the screen where it is dealt with.",
      "Open the ⓘ beside Project health to read how the label is decided.",
      "The label follows the records. To change it, speak to the Project Manager or the warehouse named on the item."
    ],
    "links": [
      {
        "label": "Overview",
        "href": "/operations"
      }
    ],
    "screens": [
      "/operations"
    ]
  },
  {
    "id": "projects-equipment-booking-review",
    "area": "projects",
    "title": "After a date change: mark as reviewed",
    "keywords": [
      "project date changed",
      "installation date brought forward",
      "mark as reviewed",
      "date change review",
      "reviewed after a date change"
    ],
    "summary": "When a project's installation or event dates change after its list was sent to the warehouse, Review equipment booking appears on the project's Equipment tab, on its Work page and, for the warehouse, on the same list in Inventory. It shows what the date was and is, and who changed it. Nothing is moved for you: the warehouse changes the dates itself, where clashes are checked. If the date is changed back, the review closes by itself.",
    "steps": [
      "Project Manager: open the project, then Equipment, and read Review equipment booking.",
      "Agree with the warehouse whether the dates must move.",
      "Warehouse: press the Open request link in the review and change the planning dates there if needed.",
      "Project Manager or warehouse: add a note if useful and press Mark as reviewed.",
      "Mark as reviewed only records that someone looked. It moves nothing."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/equipment"
    ]
  },
  {
    "id": "projects-chat-archived",
    "area": "projects",
    "title": "Archived conversations in Chat",
    "keywords": [
      "archived chats",
      "archived project chat",
      "old project conversation",
      "where did the project chat go",
      "chat missing after archive",
      "archived section in chat",
      "completed project chat",
      "finished project chat",
      "chat gone after completing a project"
    ],
    "summary": "When a project is completed or archived, its group moves in Chat to a closed section called Archived, below Sales and Projects, with the number of groups beside it. Nothing is lost: the messages can be read but not added to, and unread messages still count on the heading. A link to the conversation still opens it. If the project is reopened or restored, its group returns to Projects. The project itself is not changed by this.",
    "steps": [
      "Press the Chat button at the corner of any page.",
      "Scroll to Archived at the bottom of the list and press it to open the section.",
      "Choose the project to read its conversation.",
      "Or type the project's name or reference in the search box, if you have one: it finds finished groups too."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects"
    ]
  },
  {
    "id": "projects-plan-quick-add-and-order",
    "area": "projects",
    "title": "Add several requirements at once and put them in order",
    "keywords": [
      "quick add",
      "add several requirements",
      "paste a list",
      "reorder requirements"
    ],
    "summary": "Quick add saves a whole list of requirements for one technology in one go, and saving it again never adds a row twice. Rows can be put in order by dragging or with the arrow buttons; the order is saved.",
    "steps": [
      "Open the technology on the Project Plan and press Quick add. Choose the section if you are offered more than one.",
      "Type the rows, or press Paste a list, put one requirement on each line (a quantity can follow a tab, or be written like Batak unit x 4), and press Put these in the rows below. Add an owner and dates to any row.",
      "Press Add rows. Rows that are already in the plan are left as they are and the message says so. If a row is refused, nothing is added and the message names the row.",
      "To change the order, drag the grip at the start of a row, or press the up or down arrow beside it (Tab to the button, then Enter). The order is saved as you go and is the same for everyone.",
      "Only the Project Manager, or the person a section is delegated to, sees these controls for that section."
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
    "id": "projects-task-expected-output",
    "area": "projects",
    "title": "Say what a task must produce",
    "keywords": [
      "expected output",
      "what a task must produce",
      "required output",
      "deliverable on a task"
    ],
    "summary": "A task can name the thing it must produce, for example a moodboard, and say whether it is required. A required output stops the task being sent for review or finished until it is added.",
    "steps": [
      "Open the task from the project's Work page.",
      "Press Set expected output (or Edit expected output). Type the name, a quantity if there is more than one, and tick Required if the task cannot be finished without it.",
      "The person doing the task sees what is expected and what is missing right beside their action.",
      "Only the Project Manager, or the head of the task's team, can set or change this."
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
    "id": "projects-task-submit-output",
    "area": "projects",
    "title": "Hand in a version of a task's output",
    "keywords": [
      "submit output",
      "add a version",
      "attach a file to a task",
      "version 2",
      "hand in work"
    ],
    "summary": "Each time you hand work in, it becomes a new version. Earlier versions and the feedback on them stay available.",
    "steps": [
      "Open your task and press Submit output (or Submit version 2, and so on).",
      "Choose Upload a file, Choose a project file, or Add a link, and add a note for the reviewer if you like.",
      "A link to a document that can change later is marked so; add a snapshot or a link to one exact version if the reviewer needs it.",
      "Press the submit button once. Pressing it again by mistake does not make a second version.",
      "A file marked as restricted can only be chosen by the Project Manager."
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
    "id": "projects-task-review-output",
    "area": "projects",
    "title": "Review one version of a task's output",
    "keywords": [
      "review output",
      "approve a version",
      "request changes on a version",
      "changes requested"
    ],
    "summary": "Your decision applies to the one version you are looking at. If a newer version arrives while your screen is open, you are told and nothing is approved by mistake.",
    "steps": [
      "Open the task and press Review.",
      "Choose Approve, or Request changes and write what needs changing.",
      "If you are told a newer version exists, reload and review that one.",
      "The time it was handed in and the time it was approved appear separately, in the project's time zone.",
      "You cannot review your own work."
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
    "id": "projects-deliverables-register",
    "area": "projects",
    "title": "Deliverables view and register export",
    "keywords": [
      "deliverables view",
      "register of outputs",
      "export deliverables",
      "missing outputs"
    ],
    "summary": "The Deliverables view on the Project Plan gathers the expected outputs of a project, grouped by activation, with the current version, status and times.",
    "steps": [
      "Open the project, go to Project Plan, then Deliverables.",
      "Use Missing, Awaiting review, Changes requested or Approved to narrow the list.",
      "Open a row's Version history to see earlier versions and decisions.",
      "Press Export register (CSV) for a spreadsheet. It holds only what you can see on the screen: a restricted file appears as restricted."
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
    "id": "projects-site-schedule",
    "area": "projects",
    "title": "Plan the installation and dismantling on site",
    "keywords": [
      "site schedule",
      "installation and dismantling",
      "second installation",
      "tentative or confirmed",
      "run on site"
    ],
    "summary": "The Site schedule is what happens at the venue. It is separate from the Project Plan's work schedule, which is the tasks. A plan with gaps still saves, and the gaps are listed with a link to fix each.",
    "steps": [
      "Open the project, go to Project Plan, then Site.",
      "Press Add activity, or Quick add to enter several runs in one go (for example installation 11 Nov, the live days 12 to 13 Nov, dismantling).",
      "Give each run an owner, a place, the date or time window and its time zone, and mark it Tentative or Confirmed.",
      "Changing the date of a Confirmed run asks you for a reason. Only the Project Manager can add or change site activities."
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
    "id": "projects-site-crew-shipments",
    "area": "projects",
    "title": "Add crew and shipments to the site schedule",
    "keywords": [
      "site crew",
      "standby crew",
      "shipment arrival",
      "equipment arriving late"
    ],
    "summary": "Each run can have a crew by role. A shipment records when it leaves, when it should arrive and when it comes back, and warns you if it arrives after the installation it is for.",
    "steps": [
      "On the Site schedule press Assign crew on a run and add people as installation, standby, backup or dismantling.",
      "Press Add shipment, enter each leg with its own time zone, and say which installation it supports.",
      "If the shipment is linked to an equipment request, its reservation, dispatch and return state comes from Inventory. Change that in Inventory, not here.",
      "A red warning means the shipment arrives after the installation starts.",
      "Under each run, Still missing from the briefing lists what the crew still lacks (see the crew card topic)."
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
    "id": "projects-crew-card-briefing",
    "area": "projects",
    "title": "Make the crew card complete: venue, date, call time and readiness",
    "keywords": [
      "crew card",
      "call time",
      "use the activity start",
      "project date",
      "which run",
      "hardware ready",
      "not applicable",
      "not recorded",
      "my site assignment is empty",
      "venue missing",
      "briefing"
    ],
    "summary": "The crew card says where, when and what is ready, from the project's own records, so nothing is typed twice. The venue is the activity's own, else the project's, and says so. The date is the activity's own, else the project's installation or event date, only when the project has exactly one activity of that kind; with several runs nothing is guessed. A call time is personal: until the Project Manager sets it, the card says Not set yet.",
    "steps": [
      "Project Manager: open Project Plan, Site and read Still missing from the briefing under each run.",
      "If it says to choose which run a project date belongs to, press This run on the right one. Only that run gets the date.",
      "Press Crew (or Set call times), and beside a person's call time press Use the activity start. It needs a start time on the activity.",
      "Press Brief to set Hardware, Content and App by hand. Leave Not recorded to use the Project Plan; choose Not applicable when it does not apply.",
      "Anyone assigned opens My site assignments to read their card. Not applicable and Not recorded mean different things."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "My site assignments",
        "href": "/site-assignments"
      }
    ],
    "screens": [
      "/projects/[id]/plan",
      "/site-assignments"
    ]
  },
  {
    "id": "projects-help-buttons",
    "area": "projects",
    "title": "The ⓘ help buttons",
    "keywords": [
      "info button",
      "help icon",
      "ⓘ",
      "explanation",
      "where did the explanation go",
      "hover help",
      "more about"
    ],
    "summary": "Longer explanations, examples and rules sit behind a small ⓘ next to the heading or field they explain. Warnings, errors, what blocks you, who acts next and what submitting, approving or publishing will do stay on the page.",
    "steps": [
      "Move the pointer over the ⓘ, or tab to it, or tap it on a phone.",
      "Read the note. Press Escape, move away or tap elsewhere to close it."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "Operations",
        "href": "/operations"
      }
    ],
    "screens": [
      "/projects",
      "/operations"
    ]
  },
  {
    "id": "projects-work-overview",
    "area": "projects",
    "title": "What is next on site and what needs attention",
    "keywords": [
      "work overview",
      "next on site",
      "needs attention",
      "recent changes on a project"
    ],
    "summary": "The top of a project's Work page lists the next thing happening on site, what is missing or waiting, who can act on it, and the latest changes.",
    "steps": [
      "Open the project's Work page.",
      "Next on site gives the next activity with its time, place, owner and whether it is confirmed.",
      "Needs attention lists missing outputs, changes requested, reviews waiting, gaps in the site plan and late shipments. Press a line to go to the record that fixes it.",
      "Recent changes links to the full History."
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
    "id": "projects-team-setup",
    "area": "projects",
    "title": "Choose the project teams and their leads",
    "keywords": [
      "project team",
      "project teams",
      "team lead",
      "lead needed",
      "manage team",
      "programming lead",
      "content team",
      "engineering team",
      "installation team",
      "add custom team",
      "who leads"
    ],
    "summary": "A new project's Work page opens with Set up your project team. Choose teams from Content, Programming, Engineering and Site / Installation, or Add custom team, and pick a lead for each. You can save before every lead is known: that team is flagged Lead needed. A lead new to the project is added to it, so you confirm that first. Saving twice never duplicates a team or replaces a lead. Site / Installation never enrols technicians. Manage team reopens it.",
    "steps": [
      "Open the project's Work page and press Set up your project team.",
      "Tick the teams you need, or press Add custom team and type a name.",
      "Choose a lead for each team, or leave it for later.",
      "Read which people will be added to the project and tick the confirmation.",
      "Press save. Press Manage team on Work to name a missing lead later."
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
    "id": "projects-site-only-technicians",
    "area": "projects",
    "title": "Assign technicians who are not on the project",
    "keywords": [
      "site only technician",
      "my site assignments",
      "call time",
      "crew instructions",
      "technician assignment",
      "installation crew",
      "readiness",
      "hardware ready",
      "content ready",
      "app ready"
    ],
    "summary": "The Project Manager can put a company employee on an installation activity without adding them to the project; they are labelled site-only. In Assign crew choose the role, call time and instructions; Brief records hardware, content and app readiness. A site-only technician sees only their own assignment under My site assignments: activity, role, venue, call time and instructions. They cannot open Project Chat, tasks, files or exports. Access ends when they are removed, or the activity or project ends.",
    "steps": [
      "Open Project Plan and choose Site schedule.",
      "Press Assign crew on the activity and choose people, roles, call times and instructions.",
      "Press Brief to record Hardware, Content and App readiness.",
      "Read the warning if a person is already committed at that time, or give the reason for the override.",
      "Technicians open My site assignments to read their own assignment."
    ],
    "links": [
      {
        "label": "My site assignments",
        "href": "/site-assignments"
      },
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/plan",
      "/site-assignments"
    ]
  },
  {
    "id": "projects-operations-review",
    "area": "projects",
    "title": "Output the Project Manager hands in: Operations review",
    "keywords": [
      "operations review",
      "awaiting operations review",
      "needs an operations reviewer",
      "assign reviewer",
      "operations manager review",
      "project manager output",
      "review of my own output"
    ],
    "summary": "When the Project Manager hands in a version of a task's output, even on someone else's task, an Operations Manager reviews it, not the team lead. It says Awaiting Operations review with the reviewer's name. The person who handed it in and the task's assignee can never approve it, even with the Operations role. With no eligible reviewer it says Needs an Operations reviewer, and the Project Manager or an Operations Manager presses Assign reviewer. Each new version gets its own review.",
    "steps": [
      "Open the task from the link on Operations or My Day.",
      "Check the version number and read the evidence within the files you may open.",
      "Press Approve this version or Request changes.",
      "If the version says Needs an Operations reviewer, press Assign reviewer and choose an Operations Manager.",
      "A version the Project Manager handed in before this rule, still waiting for the team, shows Send to Operations review for the Project Manager and Operations. Press it: nothing is uploaded again. A restricted file must be made unrestricted first."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "Operations",
        "href": "/operations"
      }
    ],
    "screens": [
      "/projects/[id]/work",
      "/operations"
    ]
  },
  {
    "id": "projects-work-schedule",
    "area": "projects",
    "title": "The Work schedule chart",
    "keywords": [
      "work schedule",
      "timeline renamed",
      "project plan chart",
      "day view",
      "week view",
      "today marker",
      "chart scroll",
      "chart tooltip",
      "schedule bars"
    ],
    "summary": "The Project Plan view once called Timeline is now Work schedule: each activation and requirement as a bar by its dates. Installation, dismantling, crew and shipments stay under Site schedule. A week fits a normal desktop window; nine or thirty days scroll sideways inside the chart while the page stays still. Names and the date header stay pinned, Today is marked and rows print exact dates. Choose Day or Week, press Today, and hover, focus or tap a bar for details. Bars are read only.",
    "steps": [
      "Open the project and choose Project Plan, then Work schedule.",
      "Scroll the chart sideways, or press Today.",
      "Choose Day or Week.",
      "Hover, focus or tap a bar for its details."
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
    "id": "projects-work-summary",
    "area": "projects",
    "title": "Work packages and the Work page summary",
    "keywords": [
      "work packages",
      "milestones summary",
      "task outputs summary",
      "deliverables renamed",
      "activation removed",
      "feedback link"
    ],
    "summary": "Work lists the real task outputs with their review state and a link to each version, and shows milestone progress: accepted of total, next, overdue. With no milestones the Project Manager sees a small Add milestone button; tasks never need one. The older team-level deliverables are now Work packages, in a collapsed section that appears only when some exist. Feedback linked to a removed activation says Activation removed.",
    "steps": [
      "Open the project's Work page and read Milestones and Task outputs.",
      "Press a count to open the matching Deliverables list.",
      "Open the collapsed Work packages section, when it is there, to see what each team was given."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/projects/[id]/work",
      "/projects/[id]/changes"
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
      "log a follow-up",
      "dismiss handover accepted",
      "handover accepted notice",
      "remove handover accepted"
    ],
    "summary": "The Follow-ups page lists what you need to do next on your enquiries. Every enquiry that is still being worked needs one open next action, so planning the next step is part of finishing the current one. On an enquiry, the Next action card at the top shows the action, who owns it and when it is due; if none is recorded it says so and offers Add follow-up. The Handover card on the page also tells you when a Project Manager has accepted your handover.",
    "steps": [
      "Open Follow-ups in Sales to see what is due.",
      "To add one, open the enquiry and use Add follow-up (or Schedule next action in the side panel).",
      "Choose what to do, the date and who it is for.",
      "A Handover accepted line is news only. Press Dismiss to take it off your own list and off My Day; nobody else's list changes. If you leave it, it goes after seven days."
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
  },
  {
    "id": "sales-operations-planning",
    "area": "sales",
    "title": "Flag an enquiry for Operations planning",
    "keywords": [
      "flag for operations planning",
      "operations planning",
      "tentative dates",
      "dates are tentative",
      "tell operations about a job",
      "provisional project manager",
      "question from operations",
      "answer operations",
      "remove from operations planning",
      "dismantling date"
    ],
    "summary": "The owner of an enquiry, or a Sales founder, can flag it so Operations can plan early. Operations then sees its dates, place, technologies, event and your planning notes, never prices, quotes or Sales notes. Tentative means the client has not confirmed the dates; once the enquiry is won it reads as confirmed. Nothing is booked, and a provisional Project Manager named by Operations is only a note. You are not sent a notice: look at From Operations on the enquiry.",
    "steps": [
      "Open the enquiry. On Overview find Operations planning and press Flag for Operations planning.",
      "Fill Expected decision date, Dismantling date, Expected teams, Still to confirm and Note for Operations. Leave Dates are tentative ticked until the client confirms.",
      "Press Flag for Operations planning. Use Edit planning details to change it later.",
      "Read From Operations. If there is a question, write Your answer and press Send answer to Operations.",
      "Remove from Operations planning hides the enquiry from Operations again."
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
  }
];
