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
    "summary": "Your own tasks are under My Work; the Projects page lists the projects you can see, and each project has its tabs (work, plan, calendar, equipment, budget and more). JARVIS cannot read or change projects yet: use the screens.",
    "steps": [
      "Open My Work for your tasks.",
      "Open Projects for the directory and choose a project."
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
    "summary": "Enquiries live in Sales. The quick form needs a title, where it came from, an agency or an end client (or both) and the next action with its date. Search finds any enquiry by reference, title, agency or client, however old. The chips above the list show My open enquiries, Overdue, Due today, Awaiting first response and No next action.",
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
      "Choosing a different Event / Exhibition fills a show date that is empty; a date already on the enquiry is kept, and Use edition dates replaces it if you want. Create event or edition is under that field here too."
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
      "After Won, use the button on the Delivery handover card: prepare and submit it, or answer the Project Manager's question and resubmit.",
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
      "Open Clients & Agencies and search by name.",
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
      "Use the filters to find a show, then open it to see its editions, who exhibited and the agencies to contact.",
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
      "Filter by status or Overdue only to choose what to do first.",
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
