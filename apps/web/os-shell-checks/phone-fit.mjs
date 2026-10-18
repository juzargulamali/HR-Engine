// Phone fit: no horizontal page scroll, no bottom-bar label clipped, last control clear of the bar, at 360 and 390 px, dark + light.
// usage: node os-shell-checks/phone-fit.mjs [persona]   (local stack only)
import { chromium, BASE, psql, newPage, login } from "./lib.mjs";
const persona = process.argv[2] ?? "ceo@e2e.local";
const oppId = psql("select id from crm_opportunities order by created_at desc limit 1");
const PAGES = ["/", "/sales", "/sales/opportunities", `/sales/opportunities/${oppId}`, "/sales/pipeline", "/sales/follow-ups", "/sales/proposals", "/sales/clients", "/sales/reports", "/sales/settings", "/sales/new",
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
      const els = [...document.querySelectorAll("main a, main button, main input, main select, main textarea")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && !e.closest("[inert]"); });
      const lowest = els.reduce((a, e) => Math.max(a, e.getBoundingClientRect().bottom), 0);
      return { hscroll: doc.scrollWidth > iw + 1, tabs, wide, lowest: Math.round(lowest), navTop: nav ? Math.round(nav.getBoundingClientRect().top) : 9999 };
    });
    checked++;
    const problems = [r.hscroll && "horizontal page scroll", r.tabs.length && `bottom-bar label clipped: ${r.tabs.join("|")}`, r.lowest > r.navTop - 4 && `last control ${r.lowest}px under bar ${r.navTop}px`].filter(Boolean);
    if (problems.length) { bad++; console.log(`FAIL ${width}px ${theme} ${p.slice(0, 40)}: ${problems.join("; ")}${r.wide.length ? ` [wide: ${r.wide.join(", ")}]` : ""}`); }
  }
  await page.context().close();
}
await browser.close(); console.log(`\nphone fit: ${checked} page views, ${bad} with problems`); process.exit(bad ? 1 : 0);
