import { buildNavModules } from "@/components/nav/nav-groups";
import { GUIDANCE } from "./guidance";

/**
 * THE APPROVED CURRENT-SCREEN IDENTIFIER. The panel tells JARVIS which page the person is on (the address path only). That text comes from the browser, so it is never used
 * as it is: it is reduced to one of the route patterns the app itself knows (the navigation's own entries and the screens the published guidance is written for), with every
 * record id replaced by "[id]". Only that pattern, and the navigation's own label for it, are used, and only to choose guidance inside Enginious OS. It is a hint about WHERE
 * the person is: it carries no screen contents and no record, it grants nothing, and it is never sent to the AI provider.
 */
export interface ScreenRef { id: string; label: string; module: string | null }

/** Every destination of the navigation, as the navigation itself defines it (built once with every entry switched on: this is a list of names and addresses, not access). */
function navigationEntries(): { href: string; label: string; module: string }[] {
  const everyone = ["sys_admin", "hr_admin", "finance", "ceo", "cto", "line_manager"].map((role) => ({ role, companyId: null, countryCode: null }));
  const co = "00000000-0000-4000-8000-000000000000";
  const modules = buildNavModules(everyone as never, {
    hasPendingApprovals: true, hasDirectReports: true,
    crmGrants: [{ companyId: co, capabilities: ["founder"] }] as never,
    projects: { grants: [{ companyId: co, capabilities: ["founder", "assign_pm"] }] as never, salesLinked: true, pendingHandovers: true, managesProjects: true },
    inventory: { grants: [{ companyId: co, capabilities: ["founder", "manage_catalogue"] }] as never, managesProjects: true, isEmployee: true },
    budget: { any: true, finance: true, manageAccess: true },
  });
  const out: { href: string; label: string; module: string }[] = [];
  // The menu's own entries first (a module's row often shares its address with its first entry: the entry's name is the screen's name).
  for (const m of modules) if (!m.comingSoon) for (const s of m.sections) for (const l of s.links) if (!l.comingSoon) out.push({ href: l.href, label: l.label, module: m.label });
  for (const m of modules) if (!m.comingSoon) out.push({ href: m.href, label: m.label, module: m.label });
  return out;
}

let cache: Map<string, ScreenRef> | null = null;
/** route pattern -> its approved identity. Guidance screens first (the guide's title names the screen when the navigation has no entry for it), then the navigation. */
export function approvedScreens(): Map<string, ScreenRef> {
  if (cache) return cache;
  const map = new Map<string, ScreenRef>();
  let nav: ReturnType<typeof navigationEntries> = [];
  try { nav = navigationEntries(); } catch { nav = []; }
  for (const n of nav) {
    const path = n.href.split(/[?#]/)[0]!;
    if (!map.has(path)) map.set(path, { id: path, label: n.label, module: n.module });
  }
  const moduleOf = (path: string) => nav.find((n) => path === n.href.split(/[?#]/)[0] || path.startsWith(`${n.href.split(/[?#]/)[0]}/`))?.module ?? null;
  // A screen the guidance is written for but the menu does not list (a record's own page, a sub-page): named after the nearest menu entry above it.
  for (const g of GUIDANCE) for (const s of g.screens ?? []) {
    if (map.has(s)) continue;
    const parts = s.split("/").filter(Boolean);
    let parent: ScreenRef | undefined;
    for (let n = parts.length - 1; n > 0 && !parent; n--) parent = map.get(`/${parts.slice(0, n).join("/")}`);
    const last = parts[parts.length - 1] ?? "";
    map.set(s, { id: s, label: parent ? (last === "[id]" ? `${parent.label} (the page of one record)` : `${parent.label}: ${last.replace(/-/g, " ")}`) : g.title, module: parent?.module ?? moduleOf(s) });
  }
  cache = map;
  return map;
}

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{24,})$/i;

/** The browser's path -> an approved screen, or null. A path that is not one the app knows (or a parent of one) is nothing: it is not echoed, stored or guessed. */
export function resolveScreen(pathname: unknown): ScreenRef | null {
  if (typeof pathname !== "string" || pathname.length > 300) return null;
  const path = pathname.split(/[?#]/)[0]!;
  // Plain path segments only: no "..", no encoded characters, nothing that is not an address inside the app.
  if (!/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(path)) return null;
  const segments = path.split("/").filter(Boolean).map((s) => (ID_SEGMENT.test(s) ? "[id]" : s.toLowerCase()));
  const known = approvedScreens();
  // The screen itself, else the nearest screen above it (/sales/opportunities/[id]/handover -> the enquiry page).
  for (let n = segments.length; n >= 0; n--) {
    const hit = known.get(`/${segments.slice(0, n).join("/")}`);
    if (hit) return n === segments.length || n > 0 ? hit : null;
  }
  return null;
}

/** Navigation entries whose NAME the question uses ("where is the pipeline board?"): for a "where is it" answer when there is no written guide. Names and links only. */
export function placesNamed(question: string, limit = 3): { label: string; href: string; module: string | null }[] {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9&]+/g, " ")} `;
  const out: { label: string; href: string; module: string | null; len: number }[] = [];
  for (const [path, s] of approvedScreens()) {
    const name = s.label.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
    if (path.includes("[") || name.length < 4) continue;
    if (q.includes(` ${name} `) || (name.endsWith("s") && q.includes(` ${name.slice(0, -1)} `))) out.push({ label: s.label, href: path, module: s.module, len: name.length });
  }
  return out.sort((a, b) => b.len - a.len).slice(0, limit).map(({ len: _l, ...x }) => x);
}
