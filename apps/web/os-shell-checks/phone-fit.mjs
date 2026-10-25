// Phone fit: no horizontal page scroll, no bottom-bar label clipped, last control clear of the bar, at 360 and 390 px, dark + light.
// usage: node os-shell-checks/phone-fit.mjs [persona]   (local stack only)
import { chromium, BASE, psql, newPage, login } from "./lib.mjs";
const persona = process.argv[2] ?? "ceo@e2e.local";
const oppId = psql("select id from crm_opportunities order by created_at desc limit 1");
const projId = psql("select id from proj_projects where kind='client' limit 1");
const taskId = psql("select id from proj_tasks limit 1");
const P = projId ? `/projects/${projId}` : "";
// Inventory (when the Inventory seed is loaded): stock table, item/unit panels, every movement form, requests, setup, access, labels, scan, my equipment, and the project's Equipment page.
const invItem = psql("select id from inv_items order by name limit 1"), invUnit = psql("select id from inv_units order by code limit 1"), invReq = psql("select id from inv_requests order by code limit 1");
const INV = invItem ? ["/inventory", `/inventory?open=${invItem}`, ...(invUnit ? [`/inventory?unit=${invUnit}`] : []), "/inventory?action=receive", "/inventory?action=issue", "/inventory?action=dispatch", "/inventory?action=return", "/inventory?action=transfer", "/inventory?action=scan",
  "/inventory/requests", ...(invReq ? [`/inventory/requests?open=${invReq}`] : []), "/inventory/movements", "/inventory/manage", "/inventory/access", "/inventory/scan", `/inventory/labels?item=${invItem}`, "/inventory/mine", "/inventory/employees", ...(projId ? [`${P}/equipment`] : [])] : [];
// Pages and the states that matter on a phone: lists, boards, the open side panel, Quick Add, and the project workspace (Overview, Work, Plan, Discussion).
const PAGES = [
  ...(projId ? ["/projects", "/projects?view=board", "/projects?show=finished", `/projects?open=${projId}`, "/projects/work", "/projects/work?view=board", "/projects/work?show=overdue", `/projects/work?task=${taskId}`, "/projects/calendar", "/projects/handovers", "/projects/new", "/projects/access",
    P, `${P}/work`, `${P}/work?view=board`, `${P}/work?group=status`, `${P}/work?task=${taskId}`, `${P}/work/tasks/${taskId}`, `${P}/plan`, `${P}/plan?plan=site`, `${P}/plan?mode=calendar`, `${P}/plan?mode=timeline`, `${P}/plan?plan=site&mode=timeline`, `${P}/discussion`,
    `${P}/people`, `${P}/changes`, `${P}/documents`, `${P}/history`, `${P}/complete`, `${P}/timeline`, `${P}/calendar`] : []),
  ...INV,
  "/", "/sales", "/sales/follow-ups", "/sales/follow-ups?view=done&who=all", `/sales/follow-ups?open=${oppId}`, "/sales/opportunities", "/sales/opportunities?status=all", "/sales/opportunities?view=board&status=all", `/sales/opportunities?open=${oppId}`, `/sales/opportunities?view=board&open=${oppId}`, "/sales/opportunities?add=1", `/sales/opportunities/${oppId}`, "/sales/pipeline",
  "/sales/proposals", "/sales/clients", "/sales/reports", "/sales/settings", "/sales/new",
  "/attendance", "/attendance-clock", "/employees", "/leave", "/leave/new", "/approvals", "/alerts", "/payroll", "/reimbursements", "/performance", "/policies", "/holidays", "/profile", "/letters", "/admin/users"];
const browser = await chromium.launch(); let bad = 0, checked = 0;
for (const width of [360, 390]) for (const theme of ["dark", "light"]) {
  const page = await newPage(browser, { width, height: 780 }, theme); await login(page, persona);
  for (const p of PAGES) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" }).catch(() => {});
    const r = await page.evaluate(() => {
      const iw = window.innerWidth; const doc = document.documentElement;
      const nav = document.querySelector("nav[aria-label='Primary']");
      const tabs = nav ? [...nav.querySelectorAll("a, button")].filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent.trim()) : [];
      const wide = [...document.querySelectorAll("main *")].filter((e) => { const b = e.getBoundingClientRect(); return b.right > iw + 1 && b.width > 0 && !e.closest("[inert]") && !e.closest(".overflow-x-auto") && getComputedStyle(e).position !== "fixed"; }).slice(0, 3).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`);
      window.scrollTo(0, document.body.scrollHeight);
      const els = [...document.querySelectorAll("main a, main button, main input, main select, main textarea")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && !e.closest("[inert]") && !e.closest("aside[role=dialog], dialog") && !e.closest("details:not([open]) > :not(summary)"); });
      const lowest = els.reduce((a, e) => Math.max(a, e.getBoundingClientRect().bottom), 0);
      // A side panel (phone: the whole screen) or a Quick Add dialog: it must fit, its close control and first actions must be on screen.
      const layer = document.querySelector("aside[role=dialog]") ?? document.querySelector("dialog[open]");
      let panel = null;
      if (layer) {
        const ih = window.innerHeight; const lr = layer.getBoundingClientRect();
        const close = layer.querySelector("[aria-label='Close details'], [aria-label='Close']"); const cr = close?.getBoundingClientRect();
        const body = layer.querySelector(".overflow-y-auto") ?? layer;
        const sideways = [...layer.querySelectorAll("*")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > iw + 1 && !e.closest(".overflow-x-auto") && !e.closest("[inert]") && getComputedStyle(e).position !== "fixed"; }).length;
        const actions = [...layer.querySelectorAll("button, a, select")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && !e.closest("[inert]") && e !== close; });
        const firstAction = actions[0]?.getBoundingClientRect();
        panel = { fits: lr.left >= -1 && lr.right <= iw + 1 && lr.top >= -1 && lr.bottom <= ih + 1, closeOk: !!cr && cr.left >= 0 && cr.right <= iw && cr.top >= 0 && cr.bottom <= ih && cr.width >= 24 && cr.height >= 24, sideways, firstActionVisible: !!firstAction && firstAction.top >= 0 && firstAction.bottom <= ih, bodyScrollsSideways: body.scrollWidth > body.clientWidth + 1 && !["hidden", "clip"].includes(getComputedStyle(body).overflowX) };
      }
      const limited = /summary only|no tasks for you|do not have|not have access|no sales access|ask a founder|not available to you|no equipment|not found/i.test(document.querySelector("main")?.innerText ?? "");
      return { hscroll: doc.scrollWidth > iw + 1, tabs, wide, lowest: Math.round(lowest), navTop: nav ? Math.round(nav.getBoundingClientRect().top) : 9999, panel, limited };
    });
    checked++;
    const wantsLayer = /[?&](open|task|add|unit|action)=/.test(p);
    const pn = r.panel;
    const problems = [r.hscroll && "horizontal page scroll", r.tabs.length && `bottom-bar label clipped: ${r.tabs.join("|")}`, r.lowest > r.navTop - 4 && `last control ${r.lowest}px under bar ${r.navTop}px`,
      wantsLayer && !pn && !r.limited && "the panel/dialog did not open",
      pn && !pn.fits && "panel/dialog does not fit the screen", pn && !pn.closeOk && "close control missing or off screen", pn && pn.sideways > 0 && `panel content sideways overflow (${pn.sideways} elements)`, pn && pn.bodyScrollsSideways && "panel body scrolls sideways", pn && !pn.firstActionVisible && "first action not on screen without scrolling"].filter(Boolean);
    if (problems.length) { bad++; console.log(`FAIL ${width}px ${theme} ${p.replace(/[0-9a-f-]{36}/g, "<id>")}: ${problems.join("; ")}${r.wide.length ? ` [wide: ${r.wide.join(", ")}]` : ""}`); }
  }
  await page.context().close();
}
await browser.close(); console.log(`\nphone fit: ${checked} page views, ${bad} with problems`); process.exit(bad ? 1 : 0);
