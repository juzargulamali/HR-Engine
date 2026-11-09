/**
 * REVIEWED, staff-facing guidance for "How do I ...?" questions. This is the ONLY app knowledge JARVIS answers from. It is written for people (plain words, the screens they
 * click), it is short on purpose, and every statement in it was checked against how the screens behave (docs/enginious-os/02-screens-and-navigation.md and the Sales references);
 * where something is not certain it is simply not said. It is NOT the internal map, the action catalogue or any code: it contains no code paths, SQL, migration names or
 * permission internals, and a test keeps it that way. Links are real screen paths; a test checks each one against the app's routes.
 *
 * Adding a topic: write it for a colleague, keep `summary` to a couple of sentences, put the clicks in `steps`, link only to screens that exist, add keywords people really use.
 * Modules that JARVIS cannot act in yet (Projects, Inventory, People & HR) get "where to find it" guidance only: JARVIS never reads their records.
 */
export interface GuidanceLink { label: string; href: string }
export interface GuidanceEntry {
  id: string;
  area: "sales" | "projects" | "inventory" | "people" | "general";
  title: string;
  /** Words and short phrases people use for this (matched in lower case). */
  keywords: string[];
  summary: string;
  steps: string[];
  links: GuidanceLink[];
}

export const GUIDANCE: GuidanceEntry[] = [
  {
    id: "sales-add-enquiry", area: "sales", title: "Add an enquiry",
    keywords: ["add enquiry", "new enquiry", "create enquiry", "add an enquiry", "create an enquiry", "log an enquiry", "new inquiry", "add inquiry", "create inquiry", "quick add", "enter a lead", "new lead"],
    summary: "Enquiries live in Sales. The quick form needs a title, where it came from, an agency or an end client (or both) and the next action with its date.",
    steps: ["Open Enquiries in Sales.", "Press Add enquiry.", "Fill in the title, the source, the agency and/or end client, and what happens next and when.", "Save. The enquiry opens so you can add more details."],
    links: [{ label: "Enquiries", href: "/sales/opportunities" }, { label: "Full new-enquiry form", href: "/sales/new" }],
  },
  {
    id: "sales-follow-ups", area: "sales", title: "See and plan follow-ups",
    keywords: ["follow-up", "follow up", "followup", "next action", "to-do", "todo", "reminder", "overdue", "due today", "schedule next action", "add follow-up", "add a follow-up", "log a follow-up"],
    summary: "The Follow-ups page lists what you need to do next on your enquiries. Every enquiry that is still being worked needs one open next action, so planning the next step is part of finishing the current one.",
    steps: ["Open Follow-ups in Sales to see what is due.", "To add one, open the enquiry and use Add follow-up (or Schedule next action in the side panel).", "Choose what to do, the date and who it is for."],
    links: [{ label: "Follow-ups", href: "/sales/follow-ups" }, { label: "Enquiries", href: "/sales/opportunities" }],
  },
  {
    id: "sales-log-update", area: "sales", title: "Log a call, email or meeting on an enquiry",
    keywords: ["log a call", "log call", "log an email", "log a meeting", "add update", "add an update", "activity", "record a call", "note on an enquiry", "meeting notes", "add a note", "timeline", "log activity"],
    summary: "Updates are the enquiry's diary. Add one after a call, an email or a meeting; you can plan the next step in the same box.",
    steps: ["Open the enquiry.", "Press Add update.", "Choose the type (call, email, meeting, note or client response) and write what happened.", "Turn on Plan the next step if you want a follow-up created at the same time."],
    links: [{ label: "Enquiries", href: "/sales/opportunities" }],
  },
  {
    id: "sales-edit-details", area: "sales", title: "Edit an enquiry's details",
    keywords: ["edit enquiry", "edit an enquiry", "change enquiry", "edit details", "change the title", "change the location", "change the dates", "update enquiry", "amend enquiry", "change the event date"],
    summary: "The enquiry's owner, or a Sales founder, can edit its details while it is open. Once it is Won only a founder can change the value, and a Lost enquiry cannot be edited.",
    steps: ["Open the enquiry.", "Press Edit details.", "Change what you need and save. If someone else changed it first you will be asked to reload."],
    links: [{ label: "Enquiries", href: "/sales/opportunities" }],
  },
  {
    id: "sales-move-stage", area: "sales", title: "Change an enquiry's stage",
    keywords: ["change stage", "move stage", "change status", "move to", "stage", "status of an enquiry", "pipeline", "board", "qualified", "negotiation", "proposal sent", "quote sent", "on hold", "put on hold", "resume"],
    summary: "The enquiry's owner or a Sales founder moves it: one step back, or any step forward. Proposal sent needs a proposal recorded as sent first, and Quote sent needs the Zoho Books quote reference. Won, Lost and On hold have their own forms.",
    steps: ["Open the enquiry (or use the Board view of Enquiries).", "Choose Move to another stage and pick the stage.", "If the stage needs something first, the screen says what."],
    links: [{ label: "Enquiries", href: "/sales/opportunities" }, { label: "Board view", href: "/sales/opportunities?view=board" }],
  },
  {
    id: "sales-close-handover", area: "sales", title: "Mark an enquiry won or lost, and hand it over",
    keywords: ["mark won", "mark as won", "won", "lost", "mark lost", "close an enquiry", "close enquiry", "handover", "hand over", "hand-over", "reopen", "re-open"],
    summary: "Won and Lost are closed on their own form, which asks for the evidence or the reason. After Won, the handover to Projects is prepared from the enquiry. JARVIS does not close, reopen or hand over enquiries: do those on the enquiry page.",
    steps: ["Open the enquiry.", "Choose the Won or Lost action and fill in the form.", "After Won, open the handover from the enquiry."],
    links: [{ label: "Enquiries", href: "/sales/opportunities" }],
  },
  {
    id: "sales-clients-agencies", area: "sales", title: "Find or add a client or agency",
    keywords: ["add a client", "add client", "new client", "add an agency", "add agency", "new agency", "register", "client or agency", "clients and agencies", "organisation", "organization", "account", "duplicate client", "import clients", "excel import"],
    summary: "Clients & Agencies holds every organisation. Search first so you do not add the same one twice. An organisation can be an agency, a direct client, an end client or a technology company, and an enquiry's agency and end-client boxes offer only organisations with the matching role.",
    steps: ["Open Clients & Agencies and search by name.", "If it is not there, add it with its roles (and country and website if you know them).", "To add many at once, use Import from Excel."],
    links: [{ label: "Clients & Agencies", href: "/sales/accounts" }, { label: "Import from Excel", href: "/sales/accounts/import" }],
  },
  {
    id: "sales-estimates", area: "sales", title: "Build an estimate",
    keywords: ["estimate", "estimates", "quotation", "quote", "boq", "price an enquiry", "pricing", "vat", "revision", "pdf of the estimate", "excel of the estimate"],
    summary: "Estimates are built on the enquiry's Estimates tab in three steps: details, items, then preview and finalise. An estimate is budgetary: it cannot be recorded as sent. Official quotations go through the Zoho Books workflow.",
    steps: ["Open the enquiry and go to the Estimates tab.", "Create an estimate and fill in the details and the items.", "Preview, then finalise. A finalised estimate is frozen; make a revision to change it."],
    links: [{ label: "Enquiries", href: "/sales/opportunities" }],
  },
  {
    id: "sales-reports", area: "sales", title: "Sales reports",
    keywords: ["report", "reports", "sales report", "enquiries by source", "pipeline value", "kpi", "response time", "statistics"],
    summary: "Sales reports are read-only pages of figures with their definitions. If a card cannot be loaded it says so instead of showing zero.",
    steps: ["Open Reports in Sales.", "Choose the period, and the company if you have access to more than one."],
    links: [{ label: "Sales reports", href: "/sales/reports" }],
  },
  {
    id: "sales-settings", area: "sales", title: "Sales settings",
    keywords: ["sales settings", "reference code", "response target", "working calendar", "duplicate window", "approval policy", "vat choices", "settings"],
    summary: "Each company's Sales settings (reference code, currency, response target, working calendar, duplicate window, owner e-mail, approval policy and the estimate VAT choices) are kept on one page, for people who manage Sales settings or are founders.",
    steps: ["Open Settings in Sales (under Manage in the menu)."],
    links: [{ label: "Sales settings", href: "/sales/settings" }],
  },
  {
    id: "my-day", area: "general", title: "My Day",
    keywords: ["my day", "home page", "homepage", "what is waiting for me", "what do i need to do", "dashboard", "start page", "today"],
    summary: "My Day is the home page. It shows what needs you today, according to what you have access to.",
    steps: ["Open the home page of Enginious OS (My Day)."],
    links: [{ label: "My Day", href: "/" }],
  },
  {
    id: "approvals", area: "general", title: "Decisions waiting for you",
    keywords: ["approval", "approvals", "approve", "decision", "decisions waiting", "waiting for my approval", "waiting on me", "needs me"],
    summary: "Decisions that are waiting for you are listed on the Approvals page. The page is empty when nothing is waiting.",
    steps: ["Open Approvals from the menu or from My Day."],
    links: [{ label: "Approvals", href: "/approvals" }],
  },
  {
    id: "people-leave", area: "people", title: "Ask for leave and see your balance",
    keywords: ["leave", "request leave", "annual leave", "holiday request", "time off", "leave balance", "sick leave", "new leave request", "day off"],
    summary: "Your own leave balances and requests are on the My Leave page, and a new request starts from there. JARVIS cannot read or change leave: use the screens.",
    steps: ["Open My Leave.", "Press the button for a new request and fill it in."],
    links: [{ label: "My Leave", href: "/leave" }, { label: "New leave request", href: "/leave/new" }],
  },
  {
    id: "people-clock", area: "people", title: "Clock in and out",
    keywords: ["clock in", "clock out", "attendance", "check in", "check-in", "check out", "timesheet", "working hours"],
    summary: "Your own clock in and clock out are on My Attendance Clock; your own attendance record is on My Attendance.",
    steps: ["Open My Attendance Clock to clock in or out.", "Open My Attendance to see your record."],
    links: [{ label: "My Attendance Clock", href: "/attendance-clock" }, { label: "My Attendance", href: "/attendance" }],
  },
  {
    id: "people-claims", area: "people", title: "Expense claims",
    keywords: ["expense", "expenses", "reimbursement", "reimbursements", "claim", "claims", "receipt", "expense claim", "refund"],
    summary: "Your own expense claims are on the My Reimbursements page, and each claim opens for its details.",
    steps: ["Open My Reimbursements and choose a claim, or start a new one there."],
    links: [{ label: "My Reimbursements", href: "/reimbursements" }],
  },
  {
    id: "people-access", area: "people", title: "Getting access to a module",
    keywords: ["access", "no access", "permission", "can't see", "cannot see", "give me access", "who can give access", "module access", "grant access", "why can't i", "not allowed"],
    summary: "Access to a module (Sales, Projects, Inventory and so on) is given by the people who manage People & Access: a System Administrator, an HR Admin, or a module access manager. If a screen says you do not have access, ask one of them. JARVIS cannot change anyone's access.",
    steps: ["Open People & Access if you manage access, or ask the person who does."],
    links: [{ label: "People & Access", href: "/people-access" }],
  },
  {
    id: "projects-where", area: "projects", title: "Projects and tasks",
    keywords: ["project", "projects", "task", "tasks", "my work", "my tasks", "milestone", "project calendar", "project plan", "handovers", "new project"],
    summary: "Your own tasks are under My Work; the Projects page lists the projects you can see, and each project has its tabs (work, plan, calendar, equipment, budget and more). JARVIS cannot read or change projects yet: use the screens.",
    steps: ["Open My Work for your tasks.", "Open Projects for the directory and choose a project."],
    links: [{ label: "My Work", href: "/projects/work" }, { label: "Projects", href: "/projects" }, { label: "Project calendar", href: "/projects/calendar" }],
  },
  {
    id: "inventory-where", area: "inventory", title: "Warehouse and equipment",
    keywords: ["inventory", "warehouse", "equipment", "stock", "request equipment", "equipment request", "scan", "qr", "transfer", "my equipment", "book equipment", "return equipment"],
    summary: "Inventory is where equipment is requested, sent out and received back. The equipment assigned to you is under My equipment. JARVIS cannot read or change inventory: use the screens.",
    steps: ["Open Today in Inventory for the warehouse's jobs.", "Open Requests to prepare, send out and receive back equipment.", "Open My equipment to see what is assigned to you."],
    links: [{ label: "Inventory", href: "/inventory" }, { label: "Equipment requests", href: "/inventory/requests" }, { label: "My equipment", href: "/inventory/mine" }],
  },
  {
    id: "jarvis-about", area: "general", title: "What JARVIS can and cannot do",
    keywords: ["jarvis", "assistant", "what can you do", "what can jarvis do", "what are you", "can jarvis", "ai assistant", "chatbot", "who are you"],
    summary: "JARVIS is the assistant for Sales & CRM. Press What can you do? in its panel to see exactly what it can do for you right now. It always shows you what it will do first and saves nothing until you press the confirm button on its card. It never sends email, never reads salaries, leave, payroll or other modules' records, and never changes anyone's access.",
    steps: ["Open JARVIS from the button on the right edge.", "Choose what you want to do, or press What can you do?."],
    links: [{ label: "Enquiries", href: "/sales/opportunities" }],
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();

/** Deterministic matching: the entries whose keywords appear in the question, best first (no model involved, so no invented answers). */
export function matchGuidance(question: string, limit = 2): GuidanceEntry[] {
  const q = ` ${norm(question)} `;
  const scored = GUIDANCE.map((g) => {
    let score = 0;
    for (const k of g.keywords) {
      const kw = norm(k);
      if (kw.length >= 3 && q.includes(` ${kw} `)) score += kw.includes(" ") ? 3 : 2;
      else if (kw.length >= 5 && q.includes(` ${kw}`)) score += 1;
    }
    return { g, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length === 0) return [];
  const best = scored[0]!.score;
  return scored.filter((x) => x.score >= Math.max(2, best * 0.5)).slice(0, limit).map((x) => x.g);
}

/** Words that mean the question is about Enginious OS or its areas (so an unmatched one says "no reviewed guidance" instead of being sent to a general model). */
export const APP_QUESTION = /\b(?:enginious|jarvis|this app|the app|the system|sales|crm|enquir\w*|inquir\w*|follow-?ups?|stages?|pipeline|clients?|agenc\w*|accounts?|estimates?|quotations?|proposals?|zoho|inventory|warehouse|equipment|stock|projects?|tasks?|milestones?|leave|payroll|attendance|approvals?|my day|reimburse\w*|expenses?|clock|timesheets?|employees?|policies|people|handover|menu|screen|page|button|login|sign in|password)\b/i;
