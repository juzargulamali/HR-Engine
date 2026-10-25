// Look-and-feel screenshots of the Inventory module (LOCAL STACK ONLY): dark-*, light-* (1280 px) and mobile-* (390 px, dark) of every kind of
// screen, written to docs/inventory-screenshots/ (SHOTS_DIR overrides). Viewport screenshots, not full page.
// It builds a small, realistic state through the real functions first (a request, a reservation, a dispatch, an issued laptop, a Sales
// enquiry), so the screens are not empty. Run on the Inventory seed:   RESEED=1 node os-shell-checks/inventory-screenshots.mjs
// It also reports, per screen and mode, horizontal page scroll at 390 px and text clipped by its container.
import { makeRunner, maybeReseed, sql, asDb, sleep, requestAs, SHOTS, U } from "./inventory-flow-lib.mjs";

maybeReseed();
const R = makeRunner("shots");
await R.start();
const s1 = (q) => sql(q).split("\n")[0];
const AE = "00000000-0000-4000-8000-00000000a001";
const DXB = s1("select id from inv_locations where name='Dubai'");
const LAP = s1("select id from inv_items where name='Laptop 14 inch'"); const HDMI = s1("select id from inv_items where name='HDMI cable'");
const PRJ = s1("select id from proj_projects where name='Showroom refresh'");
const ITEM = LAP;
const EMP_E5 = "00000000-0000-4000-8000-0000000000e5";

// ---- state ---------------------------------------------------------------------------------------------------------------------------
let REQ = s1("select id from inv_requests order by code limit 1");
if (!REQ) {
  const a = requestAs(4, PRJ, LAP, 2, 3, 12, { title: "Showroom laptops", location: DXB });
  const b = (() => { const c = asDb(4, `select inv_add_request_line('${a.request}', '${HDMI}', 6, null, null)`); return c; })();
  REQ = a.request;
  asDb(1, `select inv_reserve('${a.line}', '${DXB}', null, 2, null, null)`);
  const unit = s1(`select u.id from inv_units u join inv_reservations r on r.unit_id=u.id where r.request_line_id='${a.line}' limit 1`);
  asDb(1, `select inv_dispatch_to_project('${AE}', '${DXB}', '${PRJ}', 'shots-dispatch-1', '[{"unit_id":"${unit}"}]'::jsonb, '${a.request}', now() + interval '10 days', null)`);
  void b;
}
const issuedUnit = s1(`select id from inv_units where item_id='${LAP}' and custody_kind='warehouse' order by code desc limit 1`);
if (issuedUnit) asDb(1, `select inv_issue_to_employee('${AE}', '${DXB}', '${EMP_E5}', 'shots-issue-1', '[{"unit_id":"${issuedUnit}"}]'::jsonb, now() + interval '30 days', 'for the showroom', null)`);
let OPP = s1("select id from crm_opportunities where title like 'Interactive floor for the shots%'");
if (!OPP) {
  const org = s1("select id from crm_organisations limit 1");
  OPP = asDb(5, `select crm_create_opportunity(p_company_id => '${AE}', p_title => 'Interactive floor for the shots', p_source => 'direct_client', p_next_title => 'Send layout', p_next_due => now() + interval '3 days', p_client_org_id => '${org}', p_currency => 'AED', p_value => 90000, p_location => 'Expo Hall 3', p_scope => 'LED floor', p_technologies => '[{"name":"Interactive floor","qty":2}]'::jsonb)`);
}
const UNIT = s1("select id from inv_units order by code limit 1");
console.log("state ready: request", REQ, "| unit", UNIT, "| enquiry", OPP);

const MODES = [["dark", { width: 1280, height: 800 }, "dark"], ["light", { width: 1280, height: 800 }, "light"], ["mobile", { width: 390, height: 844 }, "dark"]];
const problems = [];
const screens = [
  { name: "inventory-table", who: "ceo", path: "/inventory" },
  { name: "item-panel", who: "ceo", path: `/inventory?open=${ITEM}` },
  { name: "unit-panel", who: "ceo", path: `/inventory?unit=${UNIT}` },
  { name: "receive-review", who: "hr1", path: "/inventory?action=receive", prepare: async (p) => {
    const panel = p.locator("aside[role=dialog]"); await panel.waitFor();
    await panel.getByLabel("Receive into", { exact: true }).selectOption({ label: "Dubai" });
    await panel.getByLabel("Search for an item or unit to add").fill("HDMI");
    const res = panel.getByRole("list", { name: "Search results" }); await res.waitFor();
    await res.getByRole("button", { name: /^Add HDMI cable/ }).first().click();
    await panel.getByLabel("Quantity of HDMI cable", { exact: true }).fill("4");
    await panel.getByRole("button", { name: "Review", exact: true }).click();
    await panel.getByText("Check before you confirm").waitFor();
  } },
  { name: "request-panel", who: "hr1", path: `/inventory/requests?open=${REQ}` },
  { name: "requests-list", who: "hr1", path: "/inventory/requests" },
  { name: "project-equipment", who: "mgr", path: `/projects/${PRJ}/equipment` },
  { name: "setup", who: "ceo", path: "/inventory/manage" },
  { name: "access", who: "ceo", path: "/inventory/access" },
  { name: "labels", who: "ceo", path: `/inventory/labels?item=${ITEM}` },
  { name: "scan-page", who: "ceo", path: "/inventory/scan" },
  { name: "scan-denied", who: "ceo", path: "/inventory/scan", init: () => { if (!navigator.mediaDevices) return; Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => { throw new DOMException("Permission denied", "NotAllowedError"); }, configurable: true }); }, prepare: async (p) => { await p.getByRole("button", { name: /Use the camera/ }).click(); await p.getByText(/camera is blocked/i).waitFor(); } },
  { name: "scan-unavailable", who: "ceo", path: "/inventory/scan", init: () => { Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }); }, prepare: async (p) => { await p.getByRole("button", { name: /Use the camera/ }).click(); await p.getByText(/cannot use the camera/i).waitFor(); } },
  { name: "my-equipment", who: "emp", path: "/inventory/mine" },
  { name: "held-by-employees", who: "hr", path: "/inventory/employees" },
  { name: "movements", who: "ceo", path: "/inventory/movements" },
  { name: "sales-card", who: "emp", path: `/sales/opportunities?open=${OPP}`, prepare: async (p) => { await p.locator("section[aria-label='Warehouse stock check']").first().scrollIntoViewIfNeeded().catch(() => {}); } },
];

for (const [mode, viewport, theme] of MODES) {
  for (const sc of screens) {
    try {
      const ctxOpts = {};
      const page = await R.as(sc.who, viewport, theme, ctxOpts);
      if (sc.init) await page.context().addInitScript(sc.init);
      await page.goto(`${process.env.BASE_URL ?? "http://127.0.0.1:3000"}${sc.path}`, { waitUntil: "networkidle" });
      if (sc.prepare) await sc.prepare(page);
      await sleep(400);
      await page.screenshot({ path: `${SHOTS}/${mode}-${sc.name}.png`, fullPage: false });
      const r = await page.evaluate(() => {
        const iw = window.innerWidth;
        const hscroll = document.documentElement.scrollWidth > iw + 1;
        const clipped = [...document.querySelectorAll("main *, aside[role=dialog] *")].filter((e) => {
          if (!(e instanceof HTMLElement) || e.children.length > 0) return false;
          const cs = getComputedStyle(e);
          return e.scrollWidth > e.clientWidth + 2 && (cs.overflow === "hidden" || cs.overflowX === "hidden") && cs.textOverflow !== "ellipsis" && (e.textContent ?? "").trim().length > 2 && !e.closest(".overflow-x-auto");
        }).slice(0, 3).map((e) => (e.textContent ?? "").trim().slice(0, 30));
        return { hscroll, clipped };
      });
      const flag = [r.hscroll && mode === "mobile" && "horizontal scroll", r.clipped.length && `clipped text: ${r.clipped.join(" / ")}`].filter(Boolean);
      if (flag.length) problems.push(`${mode}-${sc.name}: ${flag.join("; ")}`);
      console.log("shot", `${mode}-${sc.name}`, flag.length ? "!! " + flag.join("; ") : "");
    } catch (e) { problems.push(`${mode}-${sc.name}: ${String(e.message).split("\n")[0].slice(0, 200)}`); console.log("FAIL shot", `${mode}-${sc.name}`, String(e.message).split("\n")[0].slice(0, 200)); }
  }
}
await R.stop();
console.log(problems.length ? `\n${problems.length} screens need a look:\n` + problems.join("\n") : "\nall screens captured with no horizontal scroll or clipped text");
process.exit(problems.some((p) => /FAIL|: (locator|page|Timeout)/.test(p)) ? 1 : 0);
