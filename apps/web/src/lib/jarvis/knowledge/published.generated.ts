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
      "Press an installation or the most urgent issue to open that project or record.",
      "The Task & milestone health card counts your live projects as Blocked, At risk or On track from their tasks and milestones only. Press the i beside its title for the rule."
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
      "return equipment",
      "book inventory",
      "find equipment requests",
      "equipment requests",
      "stock levels"
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
    "id": "inventory-today-jobs",
    "area": "inventory",
    "title": "Today in the warehouse: Do now, Coming up, Waiting on someone else",
    "keywords": [
      "warehouse today",
      "do now",
      "coming up",
      "waiting on someone else",
      "what do I do next",
      "shortage",
      "how many are missing",
      "who acts",
      "choose company",
      "choose warehouse",
      "all companies",
      "held for checking",
      "sales check"
    ],
    "summary": "Today shows the company and the warehouse you are working in, then three lists. Do now is work this warehouse can act on today. Coming up is the same work with a date that has not come. Waiting on someone else is work the warehouse cannot move on by itself: each row says how many are missing and who has to act. Each row is one job, and its button opens the next step.",
    "steps": [
      "Check the company and the warehouse at the top. With more than one company, choose the company first, then its warehouse. All companies only changes what you see.",
      "Under Do now press the button on a job: Prepare equipment, Pick items, Send equipment, Receive return, Receive transfer, Check availability or Inspect.",
      "Read Waiting on someone else: a shortage says how many are missing and who acts; a transfer you sent says which warehouse has to receive it.",
      "Use Scan a label to look a unit up. Scanning never changes stock."
    ],
    "links": [
      {
        "label": "Today",
        "href": "/inventory"
      }
    ],
    "screens": [
      "/inventory"
    ]
  },
  {
    "id": "inventory-job-pick-send",
    "area": "inventory",
    "title": "Prepare, pick and send a job",
    "keywords": [
      "pick items",
      "picking",
      "send equipment",
      "dispatch",
      "reserve",
      "short",
      "partly reserved",
      "bin",
      "scan a code",
      "wrong item",
      "already scanned",
      "requested reserved picked sent",
      "partial dispatch",
      "check whether it went through"
    ],
    "summary": "The same job is open at every step: Prepare, Pick, Send, Receive. Each item shows Requested, Reserved, Picked and Sent. Reserving holds equipment for the dates; picking records that it was taken off the shelf and moves no stock; sending is what makes it leave. A line that is not fully reserved stays short and is never counted as done.",
    "steps": [
      "Prepare: press Reserve on each line. If not everything is free, choose Need to buy or Need to rent for the rest.",
      "Pick: scan or type each code, or tick the units, using the bin shown; count the picked quantity of counted items. Press Pick items.",
      "A wrong or repeated code is said beside the scan box and is not added. Take a wrong code off the list to continue.",
      "Send: what was picked is already ticked. Correct it if needed, press Send equipment, check the list and confirm.",
      "If a save does not finish in time, press Check whether it went through before trying again. Your list is kept."
    ],
    "links": [
      {
        "label": "Today",
        "href": "/inventory"
      }
    ],
    "screens": [
      "/inventory/requests/[id]"
    ]
  },
  {
    "id": "inventory-job-receive",
    "area": "inventory",
    "title": "Receive a return and inspect it",
    "keywords": [
      "receive return",
      "return equipment",
      "partial return",
      "damaged",
      "held for inspection",
      "still out",
      "condition",
      "available again",
      "inspect",
      "clear a damaged unit",
      "check condition",
      "inspection"
    ],
    "summary": "Receive starts from what was sent and is still out, so nothing is typed again. You record what came back and its condition; what you leave unticked stays out. Good equipment is available again at once. Damaged equipment, or equipment needing a check, is held and cannot be reserved until warehouse staff at that warehouse inspect it and record the check.",
    "steps": [
      "Open the job from Today with Receive return, or open the job and choose Receive.",
      "Tick each unit that is back and choose its condition; type how many counted items came back.",
      "Read the line beside the button, for example 2 returned, 1 available, 1 held for inspection, 1 still out.",
      "Press Receive return, check the list and confirm.",
      "To clear a held unit, open it from Today under Do now with Inspect, press Inspect on the unit, and record its condition."
    ],
    "links": [
      {
        "label": "Today",
        "href": "/inventory"
      },
      {
        "label": "Stock",
        "href": "/inventory/stock"
      }
    ],
    "screens": [
      "/inventory/requests/[id]"
    ]
  },
  {
    "id": "inventory-transfer-send",
    "area": "inventory",
    "title": "Send a transfer to another place",
    "keywords": [
      "transfer stock",
      "send to another warehouse",
      "move stock",
      "move equipment between warehouses",
      "transfer to another company",
      "in transit",
      "send to riyadh",
      "send to dubai",
      "which dubai",
      "shipping details",
      "who acts next"
    ],
    "summary": "A transfer moves stock from one warehouse to another. It is in transit, and available at neither warehouse, until the other warehouse receives it. Every warehouse is named with its company, for example Dubai · Enginious UAE, because two companies can each have a warehouse in the same city. A transfer never changes who owns the equipment.",
    "steps": [
      "Open the unit or the item in Stock and press Transfer stock, or press Transfer stock above the list. The warehouse you are working in is already filled in.",
      "Choose Send to. Read the company beside the warehouse name before you choose.",
      "Add what is going: scan or search for units; type the quantity of counted items.",
      "Press Review. Check From, To and Who acts next, then press Confirm and send.",
      "On Today the transfer waits under Waiting on someone else until the other warehouse receives it."
    ],
    "links": [
      {
        "label": "Stock",
        "href": "/inventory/stock"
      },
      {
        "label": "Today",
        "href": "/inventory"
      }
    ],
    "screens": [
      "/inventory/stock"
    ]
  },
  {
    "id": "inventory-transfer-receive",
    "area": "inventory",
    "title": "Receive a transfer",
    "keywords": [
      "receive transfer",
      "transfer arrived",
      "partial receipt",
      "only some arrived",
      "still in transit",
      "outstanding",
      "damaged in transit",
      "transfer from another company",
      "owned by",
      "receive against transfer",
      "open the transfer"
    ],
    "summary": "You receive against the transfer that was sent, so nothing is typed again. The form shows where it came from, where it is received, how many lines were sent, how many were already received and what is still in transit. Nothing is assumed to have arrived: you say whether everything came or only some of it. What you do not receive stays in transit and the transfer stays open.",
    "steps": [
      "On Today press Receive transfer on the row, or open the transfer and press Receive this transfer.",
      "Choose Everything still in transit arrived, or Only some of it arrived.",
      "For only some, add each line that came, type the quantity of counted items and choose the condition. Damaged is held for inspection.",
      "Press Review, then Confirm arrival. Read the result, for example 3 received, 1 held for inspection, 2 lines still in transit.",
      "Open the transfer to see what was sent, received and is still in transit, and who acts next."
    ],
    "links": [
      {
        "label": "Today",
        "href": "/inventory"
      },
      {
        "label": "Stock",
        "href": "/inventory/stock"
      }
    ],
    "screens": [
      "/inventory/transfers/[id]"
    ]
  },
  {
    "id": "inventory-receive-stock",
    "area": "inventory",
    "title": "Receive a new delivery, owned or rented",
    "keywords": [
      "receive stock",
      "new stock",
      "delivery arrived",
      "bought equipment",
      "rented equipment",
      "rental",
      "owned or rented",
      "serial numbers",
      "goods in",
      "supplier"
    ],
    "summary": "Receive stock records new equipment on the shelf at one warehouse of one company. Items tracked one by one get their own ID and label; counted items get a quantity. You always say whether it is owned or rented: rented stock goes back to its supplier and never adds to what the company owns.",
    "steps": [
      "Open the item in Stock and press Receive stock: the item and your warehouse are already filled in. Or press Receive stock above the list and search for the item.",
      "Choose Owned or Rented. For rented, add the supplier, its reference and the date it has to go back.",
      "Type how many arrived. Serial numbers, condition and cost are under More details.",
      "Press Review, check the list and confirm. Print the new labels from the item.",
      "If the item is not in the list yet, add the item first, then receive it."
    ],
    "links": [
      {
        "label": "Stock",
        "href": "/inventory/stock"
      }
    ],
    "screens": [
      "/inventory/stock"
    ]
  },
  {
    "id": "inventory-give-return",
    "area": "inventory",
    "title": "With people: give out and receive back",
    "keywords": [
      "give equipment",
      "issue equipment",
      "issue to employee",
      "with people",
      "who has it",
      "receive return from employee",
      "return my equipment",
      "my equipment",
      "equipment assigned to me",
      "employee equipment request",
      "hand back",
      "left the company"
    ],
    "summary": "The warehouse gives equipment to an employee and receives it back; the employee sees it under My equipment. Start from what already knows the most: the unit, the employee's request, or the person's row under With people. A return lists what the person still holds; you add what came back and choose its condition. What you do not add stays with them.",
    "steps": [
      "To give: open the unit in Stock and press Give equipment, or open the employee's request and press Give equipment. Choose the person once.",
      "To receive: open Stock, With people, and press Receive return on the person's row.",
      "Add each item that came back and choose its condition. Damaged is held for inspection.",
      "Press Review and confirm. Read the result, for example 2 returned, 1 available, 1 held for inspection, 1 still out.",
      "Employees: to return something, hand it to the warehouse. It leaves My equipment when the warehouse records it."
    ],
    "links": [
      {
        "label": "Stock",
        "href": "/inventory/stock"
      },
      {
        "label": "My equipment",
        "href": "/inventory/mine"
      },
      {
        "label": "Equipment requests",
        "href": "/inventory/requests"
      }
    ],
    "screens": [
      "/inventory/mine"
    ]
  },
  {
    "id": "inventory-find-equipment",
    "area": "inventory",
    "title": "Where is it, who has it, is it available",
    "keywords": [
      "where is it",
      "who has it",
      "is it available",
      "find a unit",
      "stock list",
      "available here",
      "not available",
      "held or damaged",
      "in transit",
      "out for repair",
      "missing",
      "mark missing",
      "send for repair",
      "kit",
      "pack a kit",
      "unit history"
    ],
    "summary": "Stock lists every item with how many are available at the warehouse you chose. Open an item for its units, or scan a label. A unit says where it is now, who has it, whether it is available and what to do next. Damaged equipment and equipment held for inspection are not available until a warehouse operator inspects them.",
    "steps": [
      "Open Stock and check the company and warehouse at the top.",
      "Search by name, model, serial number or ID, or press Scan a label.",
      "Open the item, then a unit. Read Where is it now, Who has it, Is it available and What to do next.",
      "Use the first button for the next step. Repairs, missing or found equipment, kits and write-offs are under More actions.",
      "A row that says not available: held or damaged has units waiting for Inspect."
    ],
    "links": [
      {
        "label": "Stock",
        "href": "/inventory/stock"
      },
      {
        "label": "Scan",
        "href": "/inventory/scan"
      }
    ],
    "screens": [
      "/inventory/stock"
    ]
  },
  {
    "id": "inventory-history",
    "area": "inventory",
    "title": "History: read what happened and when",
    "keywords": [
      "history",
      "movements",
      "what happened",
      "who moved it",
      "when was it sent",
      "correct a mistake",
      "correction",
      "check a transaction",
      "transfer sent",
      "transfer received",
      "reconcile"
    ],
    "summary": "History lists every movement of stock, newest first: when, what happened, how much, from where to where, who recorded it, and the project, person or request it was for. A transfer shows both warehouses with their companies and links to the transfer. Nothing in History is deleted: a mistake is put right by a new entry that names the one it corrects.",
    "steps": [
      "Open History. Filter by what happened, location, company or dates.",
      "Open a row for its lines, its note and the related request or transfer.",
      "On a transfer row press Open the transfer to see what was sent, received and is still in transit.",
      "To put right a counted quantity recorded by mistake, open its entry and use Correct this entry. People who may confirm stock can do this.",
      "Use Check a transaction when a save may not have gone through."
    ],
    "links": [
      {
        "label": "History",
        "href": "/inventory/history"
      }
    ],
    "screens": [
      "/inventory/history"
    ]
  },
  {
    "id": "inventory-setup",
    "area": "inventory",
    "title": "Warehouses and bins, tracking and getting stock in",
    "keywords": [
      "warehouses and bins",
      "bins",
      "bin",
      "locations",
      "how is it tracked",
      "individual",
      "counted",
      "consumable",
      "categories",
      "opening count",
      "cycle count",
      "sharing between companies",
      "reference code",
      "earlier asset register",
      "administration"
    ],
    "summary": "This screen has four parts, in the order you need them: Warehouses and bins, Items and tracking, Getting stock in, and Administration for things needed now and then. It opens on the company of the warehouse you last worked in. Founders add warehouses; people who manage items add items, categories and bins.",
    "steps": [
      "Warehouses and bins: add a warehouse, then press Add bins on its row.",
      "Items and tracking: press Add item, name it and choose how it is tracked. Only the fields that way needs are shown.",
      "Getting stock in: press Receive stock for new deliveries. It opens with your warehouse filled in.",
      "Administration: the company record, sharing between companies, opening stock and counts, corrections and the earlier asset register.",
      "Each change says what it does before you confirm it."
    ],
    "links": [
      {
        "label": "Setup",
        "href": "/inventory/manage"
      },
      {
        "label": "Stock",
        "href": "/inventory/stock"
      },
      {
        "label": "People & Access",
        "href": "/people-access"
      }
    ],
    "screens": [
      "/inventory/manage"
    ]
  },
  {
    "id": "inventory-labels-scan",
    "area": "inventory",
    "title": "Labels and QR codes",
    "keywords": [
      "print labels",
      "qr label",
      "qr code",
      "scan a label",
      "scan",
      "camera",
      "type the code",
      "bin label",
      "label not found",
      "wrong label",
      "scan several"
    ],
    "summary": "Every unit has a permanent ID and a QR label; counted items can have a label for a bin. Scanning only finds the record: it never changes stock. You can always type the code instead of using the camera. A code that is not an Inventory label, or that is not available to you, is said so and nothing is added.",
    "steps": [
      "Press Scan a label on Today or Stock, or open Scan.",
      "Point the camera at the QR code, or type the code printed on the label.",
      "To handle several, add each code to your list on Scan, then continue to one form for all of them.",
      "To print, open the item or unit in Stock and choose Print label, or Print labels for all units.",
      "Inside a form, scanning adds the item to the list. Counted items still need their quantity typed."
    ],
    "links": [
      {
        "label": "Scan",
        "href": "/inventory/scan"
      },
      {
        "label": "Stock",
        "href": "/inventory/stock"
      }
    ],
    "screens": [
      "/inventory/scan",
      "/inventory/labels"
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
    "id": "people-add-employee",
    "area": "people",
    "title": "Add an employee",
    "keywords": [
      "add employee",
      "new employee",
      "create employee",
      "new hire",
      "add a person",
      "onboard employee",
      "onboarding",
      "hire",
      "employee number",
      "add staff"
    ],
    "summary": "An HR Admin adds an employee from the Employees list. Choose the company first: its country and currency are used for the new person, so you do not type them. You enter the name and hire date once; the employee number is given automatically when you save (the next one in a single series shared by every company, such as E007, and it stays with the person). You may add the contract, salary and opening leave balances now or later. Pressing the button twice never creates a second person.",
    "steps": [
      "Open Employees and press Add employee.",
      "Choose the company, then fill in the name and hire date. Do not look for an employee number field: it is assigned when you save.",
      "Add the job, department, manager, contract and salary if you have them; leave the rest for later.",
      "Press the button at the bottom. The Onboarding page for that person opens (see Finish onboarding a new employee below)."
    ],
    "links": [
      {
        "label": "Employees",
        "href": "/employees"
      },
      {
        "label": "Add employee",
        "href": "/employees/new"
      }
    ],
    "screens": [
      "/employees/new"
    ]
  },
  {
    "id": "people-employee-remaining-steps",
    "area": "people",
    "title": "Finish a new employee's remaining steps",
    "keywords": [
      "finish onboarding",
      "remaining steps",
      "what is left",
      "incomplete employee",
      "resume onboarding",
      "continue adding employee",
      "contract missing",
      "salary missing",
      "opening balances",
      "needs attention",
      "what is missing for employee"
    ],
    "summary": "A new employee's profile lists what is still to do: contract, salary, documents, opening leave balances (optional) and the account invitation. The list is worked out from what is already saved, so you can leave at any point and come back, on any device, to the same person. The Employees list flags the same people under Needs attention.",
    "steps": [
      "Open Employees, find the person by name or employee number, and open them. Rows marked Needs attention are the ones with steps left.",
      "On the Overview, press the button beside a step. The form opens with the person and company already filled in.",
      "Save it; the step is marked done when you return to the Overview.",
      "A step that does not apply to this person says Not applicable."
    ],
    "links": [
      {
        "label": "Employees",
        "href": "/employees"
      }
    ],
    "screens": [
      "/employees/[id]"
    ]
  },
  {
    "id": "people-change-job-or-pay",
    "area": "people",
    "title": "Change someone's job title or pay",
    "keywords": [
      "change salary",
      "raise",
      "pay rise",
      "salary increase",
      "promotion",
      "change job title",
      "new job title",
      "schedule a salary change",
      "change pay",
      "effective date",
      "pay history",
      "scheduled change"
    ],
    "summary": "A job title and pay change is made in one form on the person's Employment tab, and the Compensation tab's Change salary button opens the same form. You choose the date it takes effect. A date of today or earlier, by the employee's own country calendar, applies now; a later date is scheduled and changes nothing until that day. The job title and pay are saved together or not at all, and allowances you do not edit are kept.",
    "steps": [
      "Open the person and go to the Employment tab, or press Change salary on the Compensation tab.",
      "Enter the new job title and/or the new pay, and the date it takes effect.",
      "Read the line beside the button, which says what will happen on save, then save.",
      "Check the Current terms, Scheduled changes and History lists. After the date, the change should be in Current terms.",
      "If the pay you entered was a mistake, do not record a raise: use Correct pay record (see Correct a mistaken pay record below). If a scheduled change says Held for review, pay was changed after it was scheduled and nothing was applied: read the reason, cancel it (HR Admin) and record the change again from the current pay. If it is still under Scheduled changes after its date with no such label, tell your System Administrator."
    ],
    "links": [
      {
        "label": "Employees",
        "href": "/employees"
      }
    ],
    "screens": [
      "/employees/[id]"
    ]
  },
  {
    "id": "people-renew-document",
    "area": "people",
    "title": "Add or renew a document",
    "keywords": [
      "add document",
      "renew document",
      "passport expired",
      "visa expiring",
      "document expiry",
      "emirates id",
      "iqama",
      "labor card",
      "upload document",
      "renew passport",
      "expired document",
      "identity document"
    ],
    "summary": "All documents are added in one form on the person's Documents tab. The type you choose decides what is asked: an identity document needs its number, a visa or labor card needs a file and an expiry date. To renew, press Renew beside the expired or expiring document: the form opens with the person and type filled in and the earlier number copied, and the earlier document stays in the history.",
    "steps": [
      "Open the person and go to the Documents tab.",
      "Press Add document (or Renew beside an existing one) and choose the type.",
      "Fill in what the type asks for and attach the file if it is required. A file can be a PDF, JPEG, PNG or WebP of up to 10 MB; the form refuses another type or a bigger file beside the field before anything is sent.",
      "Save. Identity documents are visible only to the person and their HR Admin. If saving fails, read the message under the file field and press the button again: it never creates a second document.",
      "If an identity document shows No file attached, an HR Admin presses Attach file on that row and chooses the scan. It is added to the same document; the number and dates do not change, and a document that already has a file cannot be replaced this way."
    ],
    "links": [
      {
        "label": "Employees",
        "href": "/employees"
      }
    ],
    "screens": [
      "/employees/[id]"
    ]
  },
  {
    "id": "people-find-access-record",
    "area": "people",
    "title": "Find someone's account and module access",
    "keywords": [
      "invite employee",
      "employee login",
      "account invitation",
      "no login",
      "link account",
      "give module access",
      "employee access",
      "where do I give access",
      "people and access from profile"
    ],
    "summary": "Employment details and access are kept apart: saving an employee never changes an invitation or what they can open. From the person's profile, the Account, HR roles and module access card opens People & Access on that person, and says which company and modules a change would affect. Only a System Administrator sends invitations; an HR Admin links an account that already exists.",
    "steps": [
      "Open the employee's profile and find Account, HR roles and module access on the Overview.",
      "Press Open People & Access. The person is already chosen.",
      "Read the company and module named on the screen before changing anything, then save there."
    ],
    "links": [
      {
        "label": "People & Access",
        "href": "/people-access"
      },
      {
        "label": "Employees",
        "href": "/employees"
      }
    ],
    "screens": [
      "/people-access"
    ]
  },
  {
    "id": "people-hr-alerts-queue",
    "area": "people",
    "title": "Work through the HR Alerts queue",
    "keywords": [
      "alerts",
      "hr alerts",
      "hr queue",
      "needs action",
      "due soon",
      "acknowledged",
      "mark as seen",
      "probation due",
      "contract ending",
      "document expiring",
      "document expired",
      "expiry",
      "renew passport",
      "attendance exception"
    ],
    "summary": "Alerts is the HR work queue: contracts ending, probation reviews, document expiries, attendance exceptions, Recovery Leave alerts and AI suggestions waiting for a decision, in three groups: Needs action, Due soon and Acknowledged. Each row names the employee and company, what is wrong, its date and who acts next, with one button that opens the exact record. Mark as seen only records that you looked; the item stays until the record itself is fixed.",
    "steps": [
      "Open Alerts and narrow it by company or type if you need to.",
      "Press the button on a row. It opens the exact record: the renewal form, the Employment tab, or the register on that day.",
      "Fix the record there (renew the document, record the contract change, correct the attendance day), then use the link at the top of the page to return to the same company and filters.",
      "If it cannot be fixed yet, an HR Admin presses Mark as seen. The item moves to Acknowledged and stays listed, with its link, until the record is fixed."
    ],
    "links": [
      {
        "label": "Alerts",
        "href": "/alerts"
      }
    ],
    "screens": [
      "/alerts"
    ]
  },
  {
    "id": "people-attendance-review",
    "area": "people",
    "title": "Review an attendance day that needs review",
    "keywords": [
      "attendance register",
      "needs review",
      "no record",
      "rest day",
      "absent",
      "attendance exception",
      "recovery window",
      "verify recovery window",
      "clock records differ",
      "manual entry differs"
    ],
    "summary": "The attendance register leads with Needs review: days where a manual entry and the clock records differ, a recovery window waits for HR to verify it, or an HR alert is open. A day with nothing recorded says No record on a working day and Rest day on a weekly rest day or public holiday. It says Absent only when the day was recorded as absent. Clock status (Clocked in, Clocked out, Not started) is a separate fact.",
    "steps": [
      "Open the Attendance register, or the Attendance tab on the person's profile.",
      "Choose Open this day on a Needs review row. The register opens on that company and date with the person's row open.",
      "Read the sessions behind the day and use Edit to correct the original record.",
      "Reload the page. A corrected day leaves Needs review, and leaves Alerts too."
    ],
    "links": [
      {
        "label": "Attendance register",
        "href": "/attendance"
      }
    ],
    "screens": [
      "/attendance",
      "/employees/[id]"
    ]
  },
  {
    "id": "people-onboarding",
    "area": "people",
    "title": "Finish onboarding a new employee",
    "keywords": [
      "onboarding",
      "invite employee",
      "send invitation",
      "give access",
      "hr role",
      "assign role",
      "employee role",
      "reporting manager role",
      "module access",
      "review access",
      "resume onboarding",
      "new hire access",
      "who can finish",
      "employee login"
    ],
    "summary": "Onboarding is one page for one person, opened when you add an employee. It lists six steps: Add employee, Complete profile, Invite, HR roles, Module access and Review. Each says if it is done, blocked or waiting, who can finish it and what to do next. An HR Admin of the employee's company can invite the login and give the Employee and Reporting Manager roles. You can leave and come back: nothing is repeated.",
    "steps": [
      "Open the employee's Onboarding page and read the next action at the top.",
      "Enter the work email in the plan and press Invite and link. An existing account is linked; no second invitation is sent.",
      "Choose the roles (Employee, Reporting Manager, or both) and the module access, and save the plan. Saving gives no access by itself.",
      "Open Review, tick the confirmation and apply what you are allowed to apply. HR Admin, Finance, CEO, CTO and System Administrator roles, and module access, are shown with who can apply them.",
      "Come back any time: the employee, invitation, roles and access already given are reused."
    ],
    "links": [
      {
        "label": "Employees",
        "href": "/employees"
      }
    ],
    "screens": [
      "/employees/[id]/onboarding",
      "/employees/[id]"
    ]
  },
  {
    "id": "people-correct-pay",
    "area": "people",
    "title": "Correct a mistaken pay record",
    "keywords": [
      "correct pay record",
      "wrong salary",
      "salary entered by mistake",
      "joining date salary",
      "fix opening salary",
      "correct effective date",
      "pay history correction",
      "mistaken pay"
    ],
    "summary": "Use Correct pay record on the Compensation tab's history when an entry was wrong, for example the current salary entered with the joining date. Use Update pay for real raises, promotions and scheduled changes. The correction changes that entry in place; the original values stay in the audit trail with your reason and the date. HR Admin or Finance of the employee's company can correct a record.",
    "steps": [
      "Open the person's Compensation tab and find the entry in the history.",
      "Press Correct pay record on that entry and change the amount, the allowances or the effective date.",
      "Read the old and new values, the pay in force today before and after, and any warnings, then enter the reason (5 to 500 characters).",
      "Save. If a scheduled pay change is based on the entry, cancel it first; the page says so.",
      "If the page says an approved payroll run or a final settlement is affected, tell Finance: nothing in payroll was changed and it needs a review."
    ],
    "links": [
      {
        "label": "Employees",
        "href": "/employees"
      }
    ],
    "screens": [
      "/employees/[id]"
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
      "Use Recent activity and Go to for the timeline, files, dependencies and site bookings. Project details shows, from the accepted handover, the agency, the notes for the Project Manager and, for the Project Manager and Operations, the site contact."
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
    "summary": "When Sales wins a job, the handover comes to Projects. Handovers waiting on you are listed first, the longest wait at the top, however many older finished ones there are. My Day opens the exact brief. The brief starts with the agreed scope, the site and dates with the agency, the equipment, the dependencies and risks, the site contact Sales chose, and any question you already asked Sales.",
    "steps": [
      "Open the handover from My Day, or open Handovers.",
      "Read the brief.",
      "Press Accept handover to create the project with you as Project Manager; it opens on the project's Project Plan, and Sales is told in the app.",
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
      "Click a project to open it. All projects on the project brings you back to the same list. A project with work packages shows a small count under its name, such as 1/3 work packages, with review beside it when one waits for review. Press it to open them."
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
      "Click an entry to open its project. Press Back to Calendar there to return to the same date, view and filters. A site activity reads the same in Month, Week and Agenda as on the Site schedule: Started only after the Project Manager recorded the start, Finished once it is marked done."
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
      "Project Manager: tick what the client sees (individual tasks only one by one), check What would be issued now, then press Issue this timeline (later, Issue a new version).",
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
    "summary": "The Project Manager asks the warehouse for equipment on the project's Equipment tab. A project that came from Sales starts with a draft marked Imported from the Sales handover. A request is a Draft until you press Send to Warehouse; sending sets nothing aside; the warehouse does that next. Availability check from Sales shows what the warehouse found before the job was won, and says when the project has changed since. Equipment by site run shows each run with its request.",
    "steps": [
      "Open the project, then Equipment. Open the draft, or press New equipment request and Create draft.",
      "Tick the site runs the request serves. Press Use these dates to take the suggested Leaves warehouse and Due back, or type them, then press Save the dates and site runs.",
      "Use Add an item or Add from a technology template; change a line under More.",
      "Press Send to Warehouse. If something is missing, the page says what.",
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
      "Project Manager: on Equipment, check the draft, tick its site runs and press Send to Warehouse; acknowledge the dispatch note when it comes.",
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
      "Hardware: choose how it is supplied: From stock, Buy, Rent or Client supplied. For From stock choose the stock item. If it is not there yet, save the line: it stays in the plan as Needs stock match or Specification pending while everything else is released.",
      "Bought, rented or client-supplied hardware is followed in the plan with its owner and expected date and is never sent to the warehouse.",
      "Project Manager: press Release plan. Read what it will create first, then confirm.",
      "Press Review and send to Warehouse on a hardware line to open the draft request, and submit it on the Equipment tab.",
      "Later, press Match to stock on that line, choose the stock item and release again: it is added once, and its description and quantity are not typed again."
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
      "booked twice",
      "crew overlap",
      "double booked",
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
    "summary": "The Overview is for Operations Managers. Four cards at the top give the counts and open their lists: Needs my decision, Installations in the next 14 days, Equipment issues and Upcoming Sales work. Needs my decision names who each item is with, since when and why, with one button. Beside it is the delivery timeline for the next 30 days; enquiry dates are marked Tentative until won. Below are delivery by week, equipment issues, equipment by site run and project health. Operations changes no task, booking or stock.",
    "steps": [
      "Open Operations, then Overview. Choose the company if you have more than one.",
      "Press a card at the top to jump to its list.",
      "Start with Needs my decision. For Project Manager not assigned press Assign a Project Manager, choose the person and press Assign Project Manager. They accept it; you cannot accept for them.",
      "For other items press the button on the item and speak to the person named under With.",
      "Under Next installations read the label, the event edition and how many equipment lines are ready. Under Equipment issues, Partly dispatched shows how many lines have gone out; press the project to open its Equipment tab. Decisions assigned to me and follow-ups (with the person each waits on) come first, then Next on site. Each dated site activity appears once, with a link to its row on the Site schedule; a date from the project header is labelled, and a date from Sales before handover is labelled tentative. A date that has passed reads start unconfirmed until the Project Manager records the start. Press a request code to open that equipment request and its next action. Under Team pressure read who is booked on two confirmed site assignments that overlap: both assignments are listed with their times at each site and a link to each. An assignment in a company you do not manage shows its time only."
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
      "recent changes on a project",
      "recent activity on a project",
      "handover brief",
      "sales enquiry of a project"
    ],
    "summary": "The top of a project's Work page lists the next thing happening on site and what is missing or waiting, with who can act on it. The latest changes are in one Recent activity list beside the tasks.",
    "steps": [
      "Open the project's Work page.",
      "Next on site gives the next activity with its time, place, owner and whether it is confirmed.",
      "Needs attention lists missing outputs, changes requested, reviews waiting, gaps in the site plan and late shipments. Press a line to go to the record that fixes it.",
      "Recent activity lists the latest changes to dates, status and people together with new output versions, review decisions and site changes, newest first. Full history opens History."
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
      "Scroll the chart sideways, or press Today. On a phone the chart scrolls inside itself and the page stays still.",
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
    "id": "projects-site-started",
    "area": "projects",
    "title": "Say whether work on site has started",
    "keywords": [
      "record started",
      "clear start record",
      "installation started",
      "date passed",
      "start unconfirmed",
      "tentative date",
      "project header date",
      "no date",
      "choose which run",
      "site phase"
    ],
    "summary": "Every screen words a site activity the same way. A date from the project header reads Tentative, from the project header: a suggestion. A passed date with no recorded start reads Scheduled installation date passed, start unconfirmed. Started appears only when the Project Manager recorded it; a passed date never means the work began.",
    "steps": [
      "Project Manager: open Project Plan, Site schedule and find the activity.",
      "When the crew actually begin, press Record started, add a note if useful, and press Record that work began.",
      "If it was recorded by mistake, press Clear start record. The activity goes back to its schedule wording.",
      "Technicians, Work, Calendar and Operations all read the same wording from that one record."
    ],
    "links": [
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
    "id": "projects-preview-briefing",
    "area": "projects",
    "title": "Preview a crew briefing before the crew read it",
    "keywords": [
      "preview briefing",
      "as the technician sees it",
      "crew briefing",
      "missing date",
      "missing venue",
      "call time",
      "provisional date passed",
      "phone view"
    ],
    "summary": "Preview briefing lets the Project Manager read exactly what one crew member will read, in a phone-sized frame: reporting status, call time, venue and the named contact first, then instructions and readiness. Anything missing is listed with a shortcut. The call time belongs to each person and is not the activity start.",
    "steps": [
      "Open Project Plan, Site schedule and press Preview briefing beside Crew on the activity.",
      "Choose the crew member at the top of the preview.",
      "Use the shortcuts to add the date, the venue or a call time, then press Refresh in the preview.",
      "Readiness appears for this run and, on its own line, as Project-wide readiness from the Project Plan. A finished task alone never marks an output approved or equipment ready."
    ],
    "links": [
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
    "id": "projects-crew-change-notices",
    "area": "projects",
    "title": "What crew are told when a date, venue or call time changes",
    "keywords": [
      "crew notice",
      "date changed",
      "venue changed",
      "call time changed",
      "changed briefing",
      "notification",
      "site assignment changed"
    ],
    "summary": "When a confirmed activity moves to another date or venue, or a person's own call time or its zone changes, the people assigned get one notice with the previous and new values and a link to their briefing. The same happens when the project's own venue, dates or zone change under an activity that uses them. Only affected assignments are told. My Day shows the change on On site next, and opening the briefing does not mark the notice read.",
    "steps": [
      "Open the notice, My Day (On site next) or My site assignments.",
      "Find the card with Changed: the field, the old value and the new value.",
      "Check call time, venue and the named contact, and ask the contact if anything is unclear."
    ],
    "links": [
      {
        "label": "My site assignments",
        "href": "/site-assignments"
      }
    ],
    "screens": [
      "/site-assignments"
    ]
  },
  {
    "id": "projects-review-waiting",
    "area": "projects",
    "title": "See who a review is waiting on",
    "keywords": [
      "waiting on someone else",
      "needs you",
      "outputs awaiting approval",
      "tasks in review",
      "operations review",
      "reviewer",
      "changes requested",
      "do next",
      "waiting for my review",
      "exact version"
    ],
    "summary": "On a project's Work page, Needs you, Waiting on someone else and Next on site come first. An output waiting for Operations review names its reviewer (or Operations) and links the exact version. The person who submitted or owns the work cannot review it. Counters read Tasks in review and Outputs awaiting approval.",
    "steps": [
      "Open the project's Work page and read the three blocks at the top.",
      "Press the version link on a line to open that exact version.",
      "Reviewers: open My Work, press Waiting for my review, open the version and decide.",
      "After changes are requested, the assignee finds it under Changes requested and Do next in My Work, with the earlier feedback beside the new version."
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
      "/projects/work",
      "/projects/[id]/work",
      "/projects/[id]/delivery"
    ]
  },
  {
    "id": "projects-client-timeline-choice",
    "area": "projects",
    "title": "Choose what the client sees on the timeline",
    "keywords": [
      "client timeline",
      "choose what the client sees",
      "client facing",
      "issue preview",
      "issued versions",
      "milestones",
      "project files",
      "tasks on the client timeline",
      "show a task to the client",
      "title the client sees"
    ],
    "summary": "Files and client plan reads in three steps: Choose what the client sees, Preview, and Issued versions. Tick the milestones and timeline activities for the next issued client timeline. The Project Manager can also add individual tasks, one by one; of a task the client sees only the title you give it, its dates and its status in plain words. Issued versions are frozen: changing the ticks never alters one already issued.",
    "steps": [
      "Open the project's Files and client plan.",
      "Tick or untick items under Choose what the client sees and press Save what the client sees.",
      "Under Individual tasks tick each task the client should see, check or reword Title the client sees, and press Save the chosen tasks.",
      "Read the Preview: it is exactly what would be issued. Then issue a version when it is right. If something changed after you opened the page, nothing is issued and you are asked to check the Preview again.",
      "Open any earlier issued version from the list; it stays as it was issued."
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
    "id": "projects-office-board-add-display",
    "area": "projects",
    "title": "Add an office TV display",
    "keywords": [
      "office screen",
      "office tv",
      "operations screen",
      "add a display",
      "tv sign-in",
      "display password",
      "wall screen",
      "operations tv"
    ],
    "summary": "The office screen is a read-only screen for the office TV. It needs its own sign-in, made by an Operations Manager (or a founder) for one company. The sign-in can open the screen and nothing else.",
    "steps": [
      "Open Operations, then Office board, and choose the company.",
      "Press Add a display. Enter a name such as Office TV, an e-mail address that nobody else uses for signing in, and the office time zone.",
      "Press Create display. The e-mail and a long password appear once. Copy the password now: it cannot be looked up later, and it must not be pasted into chat or a ticket.",
      "On the TV's browser, open the app's sign-in page and sign in with that e-mail and password. It goes straight to the screen. Bookmark the screen and set the browser to open it when it starts.",
      "Back on Office board, the display is listed as Active with the time it was last seen."
    ],
    "links": [
      {
        "label": "Office board",
        "href": "/operations/office-board"
      },
      {
        "label": "Operations Overview",
        "href": "/operations"
      }
    ],
    "screens": [
      "/operations"
    ]
  },
  {
    "id": "projects-office-board-revoke-display",
    "area": "projects",
    "title": "Take an office TV display out of service",
    "keywords": [
      "revoke display",
      "office screen",
      "office tv lost",
      "stop the tv",
      "display password reset",
      "remove tv sign-in",
      "operations tv"
    ],
    "summary": "Revoking a display stops it at once. The screen clears on the TV within about a minute and says why. A revoked display cannot be switched back on.",
    "steps": [
      "Open Operations, then Office board, and go to the display's row.",
      "Press Revoke and confirm. The row now reads Revoked.",
      "If the page says the sign-in could not be blocked, press Retry sign-in block. The screen is already refused in the meantime.",
      "For a new password, or a new TV, revoke the old display and add a new one: there is no password reset for a display."
    ],
    "links": [
      {
        "label": "Office board",
        "href": "/operations/office-board"
      }
    ],
    "screens": [
      "/operations"
    ]
  },
  {
    "id": "projects-office-board-read",
    "area": "projects",
    "title": "Read the office TV screen",
    "keywords": [
      "office tv",
      "operations tv",
      "wall screen",
      "next on site",
      "who is going",
      "what could hold it up",
      "crew missing",
      "call time pending",
      "shipment arrival after setup",
      "start unconfirmed",
      "stale"
    ],
    "summary": "The office screen answers three questions at a glance: what is happening on site next, who is going, and what could hold it up. It only reads what the team already recorded; nothing on it can be changed.",
    "steps": [
      "The dark column on the left, Next on site, covers installation, event and dismantle days and key shipments in date order: the date and time first, then the venue and who is going, then what could hold it up. It stays in place while the projects rotate.",
      "The light table, Active projects, has a row for each project with its next runs (Run 1, Run 2 and so on), the venue and the people going, and the most important blocker. A project with nothing booked says No scheduled site work. Handovers waiting for a Project Manager to accept sit in a small group underneath.",
      "Amber with words means attention: Crew missing (nobody is assigned to the run), Call time pending (someone has no call time), Shipment arrival after setup (the equipment arrives after setup starts), Start unconfirmed (the date passed and nobody recorded that work began), Not ready, Readiness not recorded. Teal marks the next activity. Started appears only when the Project Manager recorded the start.",
      "Last updated gives the time the screen was read. If it could not refresh, a Stale bar keeps the last good screen and says as of when. If the sign-in ends or is revoked, the screen clears and says why.",
      "On a phone the same information is a vertical agenda with project cards, and it scrolls at your own pace; the pages do not rotate."
    ],
    "links": [
      {
        "label": "Operations Overview",
        "href": "/operations"
      },
      {
        "label": "Projects",
        "href": "/projects"
      }
    ],
    "screens": [
      "/operations"
    ]
  },
  {
    "id": "projects-office-board-change",
    "area": "projects",
    "title": "Change something that appears on the office TV screen",
    "keywords": [
      "office screen",
      "update the screen",
      "change a date",
      "crew assignment",
      "equipment request",
      "refresh",
      "tv not updated"
    ],
    "summary": "Nothing is typed into the screen. A Project Manager changes the date, the crew or the equipment request once, in the place they already use, and the screen picks it up on its next refresh, within about a minute.",
    "steps": [
      "Open the project and its Site schedule. Change the date or time with Edit, or press Crew to assign people and set each call time.",
      "To record that work began, press Record started on the activity. Until then a passed date reads Start unconfirmed.",
      "For equipment, open the project's Equipment tab and progress the request there. The screen reports the request's own state.",
      "Wait about a minute. Last updated on the screen advances and the change appears under the same run.",
      "If it does not appear, make sure that the screen is not marked Stale, and that the change was saved on the project."
    ],
    "links": [
      {
        "label": "Projects",
        "href": "/projects"
      },
      {
        "label": "Operations Overview",
        "href": "/operations"
      }
    ],
    "screens": [
      "/operations"
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
    "summary": "Sales & CRM follows each enquiry from the first message to the handover. An enquiry moves through the stages New enquiry, Qualified, Proposal preparation, Proposal sent, Quote sent and Negotiation, and ends as Won or Lost. Sending an estimate is recorded on the enquiry and is not a stage. Every open enquiry keeps one next action, so Follow-ups always shows what to do next. A won enquiry is handed over to the project team; winning it does not by itself mean the project was delivered.",
    "steps": [
      "Add the enquiry in Enquiries (title, source, agency or end client, and the next action with its date).",
      "Work it from Follow-ups: log each call, email or meeting on the enquiry and plan the next step.",
      "Move it to the next stage as it progresses. Proposal sent needs a proposal recorded as sent; Quote sent needs the Zoho Books quote reference. An estimate recorded as sent counts for neither.",
      "Build the estimate from the enquiry when a price is needed. Prices stay in the Estimate screen. After you send it to the client, record it as sent on the Estimates tab. That records the revision and the date; the stage stays where it is.",
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
    "summary": "A follow-up is overdue once its due time has passed and it is still open. The Follow-ups page counts them on the Overdue card and lists them first. Due times are on the clock of the company the follow-up belongs to, with the place written after the time. In JARVIS you can also type \"Show my overdue Sales follow-ups\" to list your own for the selected company, or \"What needs my attention today?\" for everything.",
    "steps": [
      "Open Follow-ups in Sales and press the Overdue card to see only what is overdue. Show all to-do brings the whole list back.",
      "Do the work, then press Complete on the row to record what happened and plan the next action.",
      "If it only needs a new date, press Reschedule and choose Tomorrow, In 2 days, Next week or your own date. The new due date is shown before you save."
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
    "summary": "Enquiries live in Sales. The quick form needs the company, What is the enquiry?, where it came from, an agency or an end client (or both) and the next action with its date. It starts in the company you are working in; if you have several and none can be assumed, choose one first. The line Saving to shows the company and currency before you save. If a save seems to hang, press it again: the same form never makes a second enquiry, it opens the one already saved and says so.",
    "steps": [
      "Open Enquiries in Sales.",
      "Press Add enquiry and check the company.",
      "Fill in What is the enquiry?, the source, the agency and/or end client, and what happens next and when. Open the full form keeps what you typed.",
      "If the enquiry is for a show, choose it in Event / Exhibition: the event start and end are filled from that edition and you can still change them. Dates you typed first are kept. If the show or its edition is not listed, press Create event or edition under the field; what you have typed stays as it is.",
      "Save. You return to the list you started from with the new enquiry open beside it; the full form opens the enquiry's own page."
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
    "summary": "The Follow-ups page lists what you need to do next. The Overdue, Today and Upcoming cards narrow the list when pressed. Every enquiry still being worked needs one open next action, so the only one cannot be cancelled: complete it with a new one, or put the enquiry on hold. Dismiss clears a reminder. Times are on the clock of the follow-up's company (Dubai, Riyadh or Warsaw), with the place after them,. Today is that company's day. Older deadlines keep their moment: 10:00 Dubai reads 07:00 (Warsaw) in winter.",
    "steps": [
      "Open Follow-ups in Sales. Press a card to see one group, or Everyone to see the team's.",
      "Press Complete to record what happened and plan the next action, or Reschedule to move the due time.",
      "To add one, open the enquiry and use Add follow-up, then choose what to do, the date and who it is for.",
      "A Handover accepted line is news only: Dismiss takes it off your own list and My Day. A line under Questions from Operations opens the question on the enquiry; it goes when you answer.",
      "Still on Dubai time for every company: the reminder for a hold's review date, the daily reminder for an enquiry with no next action, the dates in Sales reports, and anything JARVIS saves or lists."
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
      "log activity button",
      "main button on an enquiry",
      "more menu",
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
    "summary": "Activities are the enquiry's diary. Log one after a call, an email or a meeting; you can plan the next step in the same box. The first call, email or meeting you log is recorded as the first response. Logging only records it: nothing is sent to the client. To pick up someone else's enquiry, read the summary at the top: the next action, the one main button, what is in the way, and where it stands.",
    "steps": [
      "Open the enquiry.",
      "Press Log activity at the top.",
      "Choose the kind (call, email, meeting, note or client response) and write what happened. If it was one of the planned follow-ups, choose it and your words become its outcome.",
      "Turn on Plan the next step if you want a follow-up created at the same time.",
      "To read what happened, open Activity & history. All shows everything; People's updates shows what people wrote; System shows what the app recorded. A completed follow-up appears once."
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
      "Open More at the top and choose Edit details, or use Edit details on the Scope & dates tab.",
      "Change what you need and save. If someone else changed it first you will be asked to reload. Changing the dates, technologies or quantities means the equipment availability check must be repeated. A recorded check reads Availability checked, stock not reserved, with the warehouse and the dates it covered.",
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
    "summary": "The enquiry's owner or a Sales founder moves it: one step back, or any step forward. Proposal sent needs a proposal recorded as sent, and Quote sent needs the Zoho Books quote reference. Estimate sent is no longer a stage: record an estimate as sent on the Estimates tab, and the stage stays where it is. If an enquiry still shows \"Estimate sent (stage no longer used)\", its owner or a founder chooses its stage with Move stage. Won, Lost and On hold have their own forms.",
    "steps": [
      "Open the enquiry (or use the Board view of Enquiries).",
      "Open More at the top, choose Move to another stage and pick the stage. Put on hold, Resume and Reopen are in the same menu.",
      "If the stage needs something first, the screen says what. On the Board the card stays where it was and shows a link to the tab where you record it."
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
    "summary": "Won and Lost are closed on their own form, which asks for the evidence or the reason. After Won, the top of the enquiry shows where the delivery handover stands and who has it next. The handover page says Ready for handover or Not ready, what the project will receive and what is not copied. The project receives the agency (or that the job is direct), the site contact you choose and your notes. Prices, files and other contacts stay in Sales. JARVIS does not close, reopen or hand over enquiries.",
    "steps": [
      "Open the enquiry.",
      "Open More at the top, choose Close as won or Close as lost, and fill in the form.",
      "After Won, press the main button to prepare the handover. Write the scope of work: the brief cannot be submitted without it. Check the agency, and choose the Site contact from the enquiry's contacts (add the person under Contacts first if needed).",
      "Submit it, or answer the Project Manager's question and resubmit. When the project exists, Open project takes you to it if you have access.",
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
      "Open Clients & Agencies and check the company named above the list: owners and enquiry figures are shown for that company. Search by name; More filters holds country, lead source and exhibition.",
      "The list shows 100 accounts a page; use Next page for more.",
      "If it is not there, press Add account and give its roles (and country and website if you know them).",
      "To add many at once, open Import and export and choose Import from Excel. The preview says what will be created, updated and skipped before you confirm."
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
      "After you have sent it to the client, press Record estimate as sent on that revision and confirm the date it went out. The row then shows the sent date, when it was recorded and by whom. The enquiry's stage does not change.",
      "A revision of a quotation issued before estimates replaced quotations shows the terms it carried over. Read them, then press Replace with the current estimate format and confirm. Until you do, that draft cannot be finalised or sent for approval; if you try, you are told to replace the terms carried over into the draft first. The earlier revision and its files stay as issued."
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
      "Press Add first edition on an event that has none yet, or Add next edition when the next dates are known: it starts with the last place and you enter the dates. Edit and Archive are under More; archiving keeps the history and deletes nothing."
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
    "summary": "Outreach is your list of accounts to approach before any enquiry exists. Each row shows the account, its contact, the owner, the next action with its due date, and where it stands in words: overdue, due today, waiting for reply or enquiry raised. Logging an activity only records it; nothing is sent to the client. It never creates an enquiry by itself.",
    "steps": [
      "Open Outreach in Sales and check the company named above the list.",
      "Press the button on a row: Log activity after a call, email or meeting, or Set next action when nothing is planned.",
      "Choose a status or tick Overdue only to decide what to do first.",
      "On the account, choose the Contact for this outreach. When the client is ready, press Create enquiry: the form opens with the account, that contact, the source Outreach and your notes; check it and save. One outreach raises one enquiry: a second try opens the first.",
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
    "summary": "Sales reports are read-only figures in two groups. Current pipeline and follow-ups is as of now and does not change with the dates. Results for the selected period counts only what was logged or closed between the dates. Under each title a line says how many records, which company and which period the figure rests on. If a card cannot be loaded it says so instead of showing zero.",
    "steps": [
      "Open Reports in Sales.",
      "Choose the company above the report (or All my companies), then the period.",
      "Press the i beside a title for its definition. A number that is a link opens exactly those enquiries."
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
    "summary": "Sales settings are shown for one company at a time: Response targets, Commercial approval, Estimates & VAT with the VAT choices, and the Follow-up time zone, the clock that company's follow-up times are typed and shown on. Anything that stops work is listed first, for example a missing reference code and currency, which stops enquiries being recorded. Founders and people who manage Sales settings can change them; others can read them.",
    "steps": [
      "Open Settings in Sales (under Manage in the menu) and choose the company above the page.",
      "Follow a link in the list at the top to the setting that needs filling in.",
      "Change a part and press its save button. Parts with changes say Changes not saved yet, and the page asks before you leave with unsaved changes.",
      "To change the Follow-up time zone, choose the zone by name and press Save time zone. No existing follow-up moves: each keeps its exact moment and is then shown on the new clock, so tell the team first.",
      "The UAE company uses Dubai time, the Saudi company Riyadh time and the Polish company Warsaw time. Hold review reminders, the no next action reminder, report dates and JARVIS stay on Dubai time for every company."
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
    "summary": "The owner of an enquiry, or a Sales founder, can flag it so Operations can plan early. Operations then sees its dates, place, technologies, event and your planning notes, never prices, quotes or Sales notes. Tentative means the client has not confirmed the dates; once the enquiry is won it reads as confirmed. Nothing is booked, and a provisional Project Manager named by Operations is only a note. When Operations asks a question, the enquiry's owner gets one notice on Follow-ups and My Day that opens the question.",
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
  },
  {
    "id": "sales-company",
    "area": "sales",
    "title": "The company you are working in, in Sales",
    "keywords": [
      "which company",
      "wrong company",
      "change company in sales",
      "choose a company",
      "all my companies",
      "company bar",
      "sales company",
      "switch company",
      "why this company"
    ],
    "summary": "Sales pages and the Add enquiry forms work in one company, named above each page. It is the company of what you have open, else the one you used last in Sales, else the company you are employed by. If you have several and none of these applies, the page asks you to choose and shows nothing until you do. Follow-ups, Enquiries, Events and Reports can also show All my companies.",
    "steps": [
      "Look at Company above the list. Press the i beside it to see why that company is shown.",
      "Press another company to change it. The next Sales page and Add enquiry open in the company you chose.",
      "If the page says Choose a company, press one to see its records."
    ],
    "links": [
      {
        "label": "Enquiries",
        "href": "/sales/opportunities"
      },
      {
        "label": "Reports",
        "href": "/sales/reports"
      }
    ],
    "screens": [
      "/sales/reports"
    ]
  },
  {
    "id": "sales-proposal-version",
    "area": "sales",
    "title": "Add a proposal version",
    "keywords": [
      "add proposal",
      "proposal version",
      "upload a proposal",
      "proposal document",
      "record proposal as sent",
      "proposal accepted",
      "proposals and quotes",
      "proposal register",
      "new version of a proposal"
    ],
    "summary": "A proposal is made outside Enginious OS and kept on the enquiry as a file or link, one version at a time. The owner of the enquiry or a Sales founder adds versions. Sent is a date you record after sending it yourself; it is not an approval, and Accepted is not a win. Proposals & quotes lists every version across enquiries with its next action.",
    "steps": [
      "Open the enquiry and go to Proposals & files.",
      "Under Add version, write what changed and choose Upload a new file, Use a file already added or No document yet.",
      "Press Add version as a draft. If the file went up but the version did not, press Retry: the file is not uploaded again.",
      "After you send it to the client, press Record as sent on that version; record it as accepted when the client accepts it."
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
    "screens": [
      "/sales/proposals"
    ]
  }
];
