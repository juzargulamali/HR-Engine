import type { PersonId } from "./data";

export const BASE = "/os-preview";

export type ModuleId = "my-day" | "sales" | "projects" | "people" | "inventory" | "vendors" | "performance" | "approvals" | "reports" | "admin";
export type ModuleStatus = "designed" | "existing" | "coming";
export type IconKey = "day" | "sales" | "projects" | "people" | "inventory" | "vendors" | "performance" | "approvals" | "reports" | "admin";

export interface SubLink { label: string; href: string }
export interface ModuleDef {
  id: ModuleId; label: string; icon: IconKey; href: string; status: ModuleStatus; blurb: string; sub?: SubLink[];
}

export const MODULES: ModuleDef[] = [
  { id: "my-day", label: "My Day", icon: "day", href: `${BASE}/my-day`, status: "designed", blurb: "Your home: what needs you today." },
  {
    id: "sales", label: "Sales & CRM", icon: "sales", href: `${BASE}/sales`, status: "designed", blurb: "Enquiries, pipeline, follow-ups, proposals, confirmation, handover.",
    sub: [
      { label: "Overview", href: `${BASE}/sales` },
      { label: "Opportunities", href: `${BASE}/sales/opportunities` },
      { label: "Pipeline", href: `${BASE}/sales/pipeline` },
      { label: "New enquiry", href: `${BASE}/sales/new` },
      { label: "Clients & contacts", href: `${BASE}/sales/clients` },
      { label: "Follow-ups", href: `${BASE}/sales/follow-ups` },
      { label: "Proposals & quotes", href: `${BASE}/sales/proposals` },
      { label: "Reports", href: `${BASE}/sales/reports` },
      { label: "Settings", href: `${BASE}/sales/settings` },
    ],
  },
  { id: "projects", label: "Projects & Tasks", icon: "projects", href: `${BASE}/projects`, status: "coming", blurb: "Projects, PM, department heads, milestones, tasks, site reservations." },
  { id: "people", label: "People & HR", icon: "people", href: `${BASE}/people`, status: "existing", blurb: "Attendance, leave, expenses, payroll, appraisals: the existing HR app." },
  { id: "inventory", label: "Inventory", icon: "inventory", href: `${BASE}/inventory`, status: "coming", blurb: "Technology stock, components, dispatch, return, condition." },
  { id: "vendors", label: "Vendors & Purchasing", icon: "vendors", href: `${BASE}/vendors`, status: "coming", blurb: "Vendors, purchase and rental requests." },
  { id: "performance", label: "Performance & KPIs", icon: "performance", href: `${BASE}/performance`, status: "coming", blurb: "Appraisals (existing) and KPIs." },
  { id: "approvals", label: "Approvals", icon: "approvals", href: `${BASE}/approvals`, status: "designed", blurb: "One inbox of decisions." },
  { id: "reports", label: "Reports", icon: "reports", href: `${BASE}/reports`, status: "coming", blurb: "Cross-module reporting." },
  { id: "admin", label: "Administration", icon: "admin", href: `${BASE}/admin`, status: "designed", blurb: "Users, roles, module access, settings, audit." },
];

export type RoleId = "founder" | "sales" | "pm" | "head" | "employee";
export interface RoleDef {
  id: RoleId; label: string; short: string; person: PersonId; personLabel: string; modules: ModuleId[];
  salesAccess: boolean; canAssignOwner: boolean; canConfigureSales: boolean; crossCompany: boolean; description: string;
}
export const ROLES: Record<RoleId, RoleDef> = {
  founder: {
    id: "founder", label: "Founder (Juzar / Rafi)", short: "Founder", person: "juzar", personLabel: "Juzar (Founder)",
    modules: ["my-day", "sales", "projects", "people", "inventory", "vendors", "performance", "approvals", "reports", "admin"],
    salesAccess: true, canAssignOwner: true, canConfigureSales: true, crossCompany: true,
    description: "Company overview; assigns Sales owners; sees every Sales record in scope.",
  },
  sales: {
    id: "sales", label: "Sales", short: "Sales", person: "amira", personLabel: "Amira Nasser (Sales)",
    modules: ["my-day", "sales", "people", "performance"],
    salesAccess: true, canAssignOwner: false, canConfigureSales: false, crossCompany: false,
    description: "Sees all opportunities in scope; owns what they create; cannot reassign.",
  },
  pm: {
    id: "pm", label: "Project Manager", short: "PM", person: "priya", personLabel: "Priya Raman (Project Manager)",
    modules: ["my-day", "projects", "inventory", "people", "approvals", "performance"],
    salesAccess: false, canAssignOwner: false, canConfigureSales: false, crossCompany: false,
    description: "Coordinates delivery; no Sales access unless granted.",
  },
  head: {
    id: "head", label: "Department head", short: "Dept head", person: "omar", personLabel: "Omar Haddad (Head of Programming)",
    modules: ["my-day", "projects", "inventory", "people", "approvals", "performance"],
    salesAccess: false, canAssignOwner: false, canConfigureSales: false, crossCompany: false,
    description: "Plans their team's days across competing project deadlines.",
  },
  employee: {
    id: "employee", label: "Employee", short: "Employee", person: "tariq", personLabel: "Tariq Aziz (Content Designer)",
    modules: ["my-day", "projects", "people", "performance"],
    salesAccess: false, canAssignOwner: false, canConfigureSales: false, crossCompany: false,
    description: "My tasks, clock, requests; nothing else.",
  },
};
export const ROLE_IDS = Object.keys(ROLES) as RoleId[];
export const parseRole = (v: string | null | undefined): RoleId => (v && v in ROLES ? (v as RoleId) : "sales");

export const PREVIEW_STATES = ["default", "loading", "empty", "error", "denied", "overdue"] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];
export const parseState = (v: string | null | undefined): PreviewState => (PREVIEW_STATES as readonly string[]).includes(v ?? "") ? (v as PreviewState) : "default";
