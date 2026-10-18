// Phone fit: no horizontal page scroll, no bottom-bar label clipped, last control clear of the bar, at 360 and 390 px, dark + light.
// usage: node os-shell-checks/phone-fit.mjs [persona]   (local stack only)
import { chromium, BASE, psql, newPage, login } from "./lib.mjs";
const persona = process.argv[2] ?? "ceo@e2e.local";
const oppId = psql("select id from crm_opportunities order by created_at desc limit 1");
const projId = psql("select id from proj_projects where kind='client' limit 1");
const taskId = psql("select id from proj_tasks limit 1");
const PAGES = [...(projId ? ["/projects", "/projects/work", "/projects/calendar", "/projects/handovers", "/projects/new", "/projects/access", `/projects/${projId}`, `/projects/${projId}/work`, `/projects/${projId}/work/tasks/${taskId}`, `/projects/${projId}/timeline`, `/projects/${projId}/calendar`, `/projects/${projId}/people`, `/projects/${projId}/discussion`, `/projects/${projId}/changes`, `/projects/${projId}/documents`, `/projects/${projId}/history`, `/projects/${projId}/complete`] : []), "/", "/sales", "/sales/opportunities", `/sales/opportunities/${oppId}`, "/sales/pipeline", "/sales/follow-ups", "/sales/proposals", "/sales/clients", "/sales/reports", "/sales/settings", "/sales/new",
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
      const els = [...document.querySelectorAll("main a, main button, main input, main select, main textarea")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && !e.closest("[inert]") && !e.closest("details:not([open]) > :not(summary)"); });
      const lowest = els.reduce((a, e) => Math.max(a, e.getBoundingClientRect().bottom), 0);
      return { hscroll: doc.scrollWidth > iw + 1, tabs, wide, lowest: Math.round(lowest), navTop: nav ? Math.round(nav.getBoundingClientRect().top) : 9999 };
    });
    checked++;
    const problems = [r.hscroll && "horizontal page scroll", r.tabs.length && `bottom-bar label clipped: ${r.tabs.join("|")}`, r.lowest > r.navTop - 4 && `last control ${r.lowest}px under bar ${r.navTop}px`].filter(Boolean);
    if (problems.length) { bad++; console.log(`FAIL ${width}px ${theme} ${p.replace(/[0-9a-f-]{36}/g, "<id>")}: ${problems.join("; ")}${r.wide.length ? ` [wide: ${r.wide.join(", ")}]` : ""}`); }
  }
  await page.context().close();
}
await browser.close(); console.log(`\nphone fit: ${checked} page views, ${bad} with problems`); process.exit(bad ? 1 : 0);
