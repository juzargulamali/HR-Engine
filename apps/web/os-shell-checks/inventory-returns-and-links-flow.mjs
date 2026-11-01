// FOCUSED CHECK (LOCAL STACK ONLY): (1) the existing request panel and Project -> Equipment say the same honest thing about returns as the request workspace,
// for a person who can read stock (the founder) and for one who cannot (the Project Manager); (2) old QR/label addresses and bookmarks keep their parameters
// and open the right stock record, including after signing in, and never change stock.
// NEEDS the Inventory seed (seed/inventory.sh). Usage: RESEED=1 node os-shell-checks/inventory-returns-and-links-flow.mjs
import { makeRunner, maybeReseed, sql, asDb, requestAs, BASE } from "./inventory-flow-lib.mjs";
import { chromium, newPage, PASSWORD } from "./lib.mjs";

maybeReseed();
const R = makeRunner("returns-links", { shots: process.env.SHOTS_DIR ?? new URL("../../../docs/inventory-simplification-screenshots/live", import.meta.url).pathname });
await R.start();
const { step, check, eq } = R;
const s1 = (q) => sql(q).split("\n")[0];
const AE = "00000000-0000-4000-8000-00000000a001";
const item = (name) => s1(`select id from inv_items where name='${name}'`);
const PRJ = s1("select id from proj_projects where name='Showroom refresh'");
const LAPTOP = item("Laptop 14 inch"); const HDMI = item("HDMI cable"); const CARD = item("Sending card");
const DXB = s1("select id from inv_locations where code='DXB'");
const reserveAll = (req) => { for (const l of sql(`select id from inv_request_lines where request_id='${req}'`).split("\n").filter(Boolean)) asDb(1, `select inv_reserve('${l}', '${DXB}', null, null, null, null)`); };
const codeOf = (req) => s1(`select code from inv_requests where id='${req}'`);
const movements = () => Number(s1("select count(*) from inv_movements"));

// Scene. A: 3 laptops + 8 cables; B: 3 cables (same project, same item); C: 4 sending cards (a counted item only ONE request sent).
const A = requestAs(4, PRJ, LAPTOP, 3, 0, 3, { title: "Showroom set-up", submit: false });
asDb(4, `select inv_add_request_line('${A.request}', '${HDMI}', 8, null, null)`); asDb(4, `select inv_submit_request('${A.request}', null)`);
const B = requestAs(4, PRJ, HDMI, 3, 1, 4, { title: "Showroom extras", submit: true });
const C = requestAs(4, PRJ, CARD, 4, 0, 3, { title: "Showroom cards", submit: true });
for (const r of [A.request, B.request, C.request]) reserveAll(r);
const units = sql(`select id from inv_units where item_id='${LAPTOP}' order by code limit 2`).split("\n").filter(Boolean);
asDb(1, `select inv_dispatch_to_project('${AE}', '${DXB}', '${PRJ}', 'returns-links-a-1', '[{"unit_id":"${units[0]}"},{"unit_id":"${units[1]}"},{"item_id":"${HDMI}","qty":5}]'::jsonb, '${A.request}', null, null)`);
asDb(1, `select inv_dispatch_to_project('${AE}', '${DXB}', '${PRJ}', 'returns-links-b-1', '[{"item_id":"${HDMI}","qty":3}]'::jsonb, '${B.request}', null, null)`);
asDb(1, `select inv_dispatch_to_project('${AE}', '${DXB}', '${PRJ}', 'returns-links-c-1', '[{"item_id":"${CARD}","qty":4}]'::jsonb, '${C.request}', null, null)`);
// Two cables and one sending card come back (a return names the project and the item, never a request).
asDb(1, `select inv_return_from_project('${AE}', '${DXB}', '${PRJ}', 'returns-links-ret-1', '[{"item_id":"${HDMI}","qty":2,"condition":"good"},{"item_id":"${CARD}","qty":1,"condition":"good"}]'::jsonb, null)`);
const CA = codeOf(A.request), CB = codeOf(B.request), CC = codeOf(C.request);

const projectPage = (req) => `/projects/${PRJ}/equipment?request=${req}`;
const rowText = async (page, hasText) => (await page.locator("li, tr", { hasText }).first().innerText()).replace(/\s+/g, " ");

async function checkProjectEquipment(who) {
  await step(`${who}: Project -> Equipment lists cable ONCE for the project (not split per request), with where it was sent for; units and the single-request item keep their request`, async () => {
    await R.go(projectPage(A.request));
    await R.seen(/Equipment still out/);
    const panel = (await R.page.getByRole("heading", { name: "Equipment still out", exact: true }).locator("xpath=ancestor::div[contains(@class,'border-b')]/..").innerText()).replace(/\s+/g, " ");
    check(/HDMI cable\s*Project level/.test(panel), `no project-level HDMI row: ${panel}`);
    check(/6 out · held by the project/.test(panel), `held figure missing: ${panel}`);
    check(new RegExp(`sent for requests (${CA}, ${CB}|${CB}, ${CA})`).test(panel), `where it was sent for: ${panel}`);
    check(!new RegExp(`HDMI cable[^·]*\\d+ out · request`).test(panel), `HDMI still attributed to one request: ${panel}`);
    check(new RegExp(`Sending card[^·]*3 out · request ${CC}`).test(panel), `single-request item lost its request: ${panel}`);
    check(/Laptop 14 inch[^·]*· ENG-E-\d+.*out · request/.test(panel) || /Laptop 14 inch.*out · request/.test(panel), `laptop units missing: ${panel}`);
    eq((panel.match(/HDMI cable/g) ?? []).length, 1, "HDMI listed once");
  });
  await step(`${who}: request A on the project page has a Sent / Returned / Still out table with HDMI at project level, and no per-line split`, async () => {
    const t = (await R.page.getByRole("region", { name: "Sent, returned and still out" }).first().innerText()).replace(/\s+/g, " ");
    check(/HDMI cable\s*Project level/.test(t), `table: ${t}`);
    check(/more than one request or line/.test(t), `reason missing: ${t}`);
    const main = await R.mainText();
    check(!/returned 2/i.test(main), "a per-reservation 'returned 2' is still printed for counted stock");
    const hdmiRow = R.page.locator("tbody tr", { hasText: "HDMI cable" }).first();
    eq(await hdmiRow.locator('[aria-label="Shown for the project, not for this line"]').count(), 2, "dashes for Returned and Outstanding on the HDMI line");
    check(/Laptop 14 inch/.test(await R.mainText()), "laptop line missing");
    await R.shot(`returns-project-${who.toLowerCase().replace(/ /g, "-")}`);
  });
  await step(`${who}: the single-request item (sending card) shows its own Returned and Still out, and is NOT marked project level`, async () => {
    await R.go(projectPage(C.request));
    const t = (await R.page.getByRole("region", { name: "Sent, returned and still out" }).first().innerText()).replace(/\s+/g, " ");
    check(/Sending card/.test(t) && !/Project level/.test(t), `table: ${t}`);
    check(/Sending card\s*4\s*1\s*3/.test(t), `figures sent 4 returned 1 still out 3: ${t}`);
  });
}

await R.as("ceo");
await checkProjectEquipment("Founder (can read stock)");
await step("Founder: the Requests side panel says the same as the project page (HDMI at project level for request A; cards exact for request C)", async () => {
  await R.go(`/inventory/requests?open=${A.request}`);
  await R.seen(/Sent and returned|SENT AND RETURNED/, 15000, "aside[role=dialog]");
  let t = (await R.page.locator("aside[role=dialog]").getByRole("region", { name: "Sent, returned and still out" }).innerText()).replace(/\s+/g, " ");
  check(/HDMI cable\s*Project level/.test(t) && /more than one request or line/.test(t), `panel A: ${t}`);
  check(!/returned 2/i.test(await R.page.locator("aside[role=dialog]").innerText()), "per-reservation returned figure printed in the panel");
  await R.shot("returns-panel-a");
  await R.go(`/inventory/requests?open=${C.request}`);
  await R.seen(/Sent and returned|SENT AND RETURNED/, 15000, "aside[role=dialog]");
  t = (await R.page.locator("aside[role=dialog]").getByRole("region", { name: "Sent, returned and still out" }).innerText()).replace(/\s+/g, " ");
  check(/Sending card\s*4\s*1\s*3/.test(t) && !/Project level/.test(t), `panel C: ${t}`);
});
await step("Founder: the request workspace (Receive back) agrees with both", async () => {
  await R.go(`/inventory/requests/${A.request}?step=back`);
  await R.seen(/What is actually here now/);
  const t = (await R.page.getByRole("region", { name: "Sent, returned and still out" }).innerText()).replace(/\s+/g, " ");
  check(/HDMI cable\s*Project level/.test(t), `workspace: ${t}`);
});

await R.as("mgr");
await checkProjectEquipment("Project Manager (cannot read stock)");
await step("Project Manager: the Requests side panel, built from the project equipment answer alone, gives the same figures", async () => {
  await R.go(`/inventory/requests?open=${C.request}`);
  const bodyHasPanel = await R.page.locator("aside[role=dialog]").count();
  if (bodyHasPanel) {
    await R.seen(/Sent and returned|SENT AND RETURNED/, 15000, "aside[role=dialog]");
    const t = (await R.page.locator("aside[role=dialog]").getByRole("region", { name: "Sent, returned and still out" }).innerText()).replace(/\s+/g, " ");
    check(/Sending card\s*4\s*1\s*3/.test(t), `PM panel C: ${t}`);
  }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------
// Old links, labels and bookmarks
// ----------------------------------------------------------------------------------------------------------------------------------------------------------
const before = movements();
const UNIT = sql(`select id||'|'||code from inv_units where item_id='${LAPTOP}' order by code limit 1`).split("|");
// A printed bin label, made the way the warehouse makes one (the function that issues the permanent code).
asDb(1, `select inv_ensure_bin_label('${AE}', '${HDMI}', '${DXB}', null)`);
const SHELF = sql("select code from inv_units where custody_kind='warehouse' and lifecycle='active' order by code limit 2").split("\n");
const BIN = sql("select label_code||'|'||item_id from inv_balances where label_code is not null limit 1").split("|");
const BIN_ITEM = s1(`select name from inv_items where id='${BIN[1]}'`);
await R.as("ceo");
// "load", not "networkidle": the app prefetches every navigation link, and Chromium can hold one of those streams open on a busy first load; the record itself is awaited by text below.
// The app redirects an old address after the page shell has streamed, so the browser's address changes a moment after "load": wait for it.
const landed = async (path) => {
  await R.page.goto(`${BASE}${path}`, { waitUntil: "load" });
  const from = new URL(`${BASE}${path}`).pathname;
  await R.page.waitForURL((u) => u.pathname !== from, { timeout: 20000 });
  return new URL(R.page.url());
};
await step("Old bookmark /inventory?unit=<id> opens THAT unit's record on Stock, parameter kept", async () => {
  const u = await landed(`/inventory?unit=${UNIT[0]}`);
  check(u.pathname === "/inventory/stock" && u.searchParams.get("unit") === UNIT[0], `landed ${u}`);
  await R.seen(new RegExp(UNIT[1]), 15000, "aside[role=dialog]");
});
await step("Printed label (unit): /inventory/scan?c=<equipment id> lands on that unit's record", async () => {
  const u = await landed(`/inventory/scan?c=${UNIT[1]}`);
  check(u.pathname === "/inventory/stock" && u.searchParams.get("unit") === UNIT[0], `landed ${u}`);
  await R.seen(new RegExp(UNIT[1]), 15000, "aside[role=dialog]");
});
await step("Printed label (bin): /inventory/scan?c=<bin label> lands on the item the bin holds", async () => {
  const u = await landed(`/inventory/scan?c=${BIN[0]}`);
  check(u.pathname === "/inventory/stock" && u.searchParams.get("open") === BIN[1], `landed ${u}`);
  await R.seen(new RegExp(BIN_ITEM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), 15000, "aside[role=dialog]");
});
await step("Old bookmark /inventory?open=<item id> opens that item's record", async () => {
  const u = await landed(`/inventory?open=${BIN[1]}`);
  check(u.pathname === "/inventory/stock" && u.searchParams.get("open") === BIN[1], `landed ${u}`);
  await R.seen(new RegExp(BIN_ITEM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), 15000, "aside[role=dialog]");
});
await step("Old action links keep EVERY parameter: ?action=issue&codes=A,B opens the form with both units listed; ?action=return&project=<id> opens the return for that project", async () => {
  const u = await landed(`/inventory?action=issue&codes=${SHELF[0]},${SHELF[1]}`);
  check(u.pathname === "/inventory/stock" && u.searchParams.get("action") === "issue" && u.searchParams.get("codes") === `${SHELF[0]},${SHELF[1]}`, `landed ${u}`);
  await R.seen(new RegExp(SHELF[0]), 15000, "aside[role=dialog]");
  check(new RegExp(SHELF[1]).test(await R.page.locator("aside[role=dialog]").innerText()), "second code not listed");
  check(!/not on the shelf/.test(await R.page.locator("aside[role=dialog]").innerText()), "a shelf unit was refused");
  const r = await landed(`/inventory?action=return&project=${PRJ}`);
  check(r.pathname === "/inventory/stock" && r.searchParams.get("action") === "return" && r.searchParams.get("project") === PRJ, `landed ${r}`);
  await R.seen(/Showroom refresh/, 15000, "aside[role=dialog]");
});
await step("Old search/filter bookmark /inventory?q=HDMI%20cable&tracking=quantity keeps the search and the filter", async () => {
  const u = await landed("/inventory?q=HDMI%20cable&tracking=quantity");
  check(u.pathname === "/inventory/stock" && u.searchParams.get("q") === "HDMI cable" && u.searchParams.get("tracking") === "quantity", `landed ${u}`);
  eq(await R.page.getByRole("searchbox").first().inputValue().catch(async () => R.page.locator('input[type=search], input[name=q]').first().inputValue()), "HDMI cable", "search box");
});
await step("Old /inventory/employees?employee=<id> and /inventory/movements?kind=… keep their parameters", async () => {
  const emp = s1("select id from employees limit 1");
  const e = await landed(`/inventory/employees?employee=${emp}`);
  check(e.pathname === "/inventory/stock" && e.searchParams.get("view") === "people" && e.searchParams.get("employee") === emp, `employees: ${e}`);
  const m = await landed("/inventory/movements?kind=dispatch");
  check(m.pathname === "/inventory/history" && m.searchParams.get("kind") === "dispatch", `movements: ${m}`);
});
await step("Signed OUT: an old bookmark and a printed label go to sign-in and, after signing in, open the right record (query string kept)", async () => {
  const b = await chromium.launch();
  try {
    for (const [path, wantPath, wantParam, wantValue, wantText] of [
      [`/inventory?unit=${UNIT[0]}`, "/inventory/stock", "unit", UNIT[0], UNIT[1]],
      [`/inventory/scan?c=${UNIT[1]}`, "/inventory/stock", "unit", UNIT[0], UNIT[1]],
    ]) {
      const page = await newPage(b, { width: 1280, height: 900 }, "dark");
      await page.goto(`${BASE}${path}`);
      await page.waitForURL(/\/login/);
      const next = new URL(page.url()).searchParams.get("next");
      check(next === path, `sign-in remembers the address: next=${next}`);
      await page.getByLabel(/email/i).fill("ceo@e2e.local"); await page.getByLabel(/password/i).first().fill(PASSWORD);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      await page.waitForURL((u) => u.pathname === wantPath, { timeout: 20000 });
      const u = new URL(page.url());
      check(u.searchParams.get(wantParam) === wantValue, `after sign-in landed ${u}`);
      await page.waitForFunction((re) => new RegExp(re).test((document.querySelector("aside[role=dialog]") ?? document.body).innerText), wantText, { timeout: 15000 });
      await page.context().close();
    }
  } finally { await b.close(); }
});
await step("None of the old links changed stock: no movement was recorded by opening them", async () => {
  eq(movements(), before, "movements before/after opening old links");
});

const code = R.verdict("Returns display and old links");
await R.stop();
process.exit(code);
