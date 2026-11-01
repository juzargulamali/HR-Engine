// The representative screenshots of the REAL simplified Inventory screens (LOCAL STACK ONLY, throwaway database), desktop and phone, dark and light.
// usage: RESEED=1 node os-shell-checks/inventory-live-screenshots.mjs <outdir>
// Sets the scene through the real functions (a project request with laptops and cables, reserved by the warehouse, part of it sent), then captures
// Today, the three steps of the workspace, Stock, the receive form with its owned/rented choice, and With people.
import { mkdirSync } from "node:fs";
import { chromium, newPage, login, BASE } from "./lib.mjs";
import { maybeReseed, sql, asDb, requestAs, dayAt, PERSONA } from "./inventory-flow-lib.mjs";

maybeReseed();
const out = process.argv[2] ?? "inventory-live-screenshots";
mkdirSync(out, { recursive: true });
const s1 = (q) => sql(q).split("\n")[0];
const AE = "00000000-0000-4000-8000-00000000a001";
const item = (name) => s1(`select id from inv_items where name='${name}'`);
const PRJ = s1("select id from proj_projects where name='Showroom refresh'");
const LAPTOP = item("Laptop 14 inch"); const HDMI = item("HDMI cable");
const DXB = s1("select id from inv_locations where code='DXB'");

// Scene: request A (3 laptops, 8 cables) reserved and partly sent; request B (3 cables) also sent, so cables are shown at project level.
const A = requestAs(4, PRJ, LAPTOP, 3, 1, 4, { title: "Showroom set-up", submit: false });
asDb(4, `select inv_add_request_line('${A.request}', '${HDMI}', 8, null, null)`);
asDb(4, `select inv_submit_request('${A.request}', null)`);
const B = requestAs(4, PRJ, HDMI, 3, 2, 5, { title: "Showroom extras", submit: true });
for (const r of [A.request, B.request]) for (const l of sql(`select id from inv_request_lines where request_id='${r}'`).split("\n").filter(Boolean)) asDb(1, `select inv_reserve('${l}', '${DXB}', null, null, null, null)`);
const units = sql(`select id from inv_units where item_id='${LAPTOP}' order by code limit 2`).split("\n").filter(Boolean);
asDb(1, `select inv_dispatch_to_project('${AE}', '${DXB}', '${PRJ}', 'shots-a-1', '[{"unit_id":"${units[0]}"},{"unit_id":"${units[1]}"},{"item_id":"${HDMI}","qty":5}]'::jsonb, '${A.request}', null, null)`);
asDb(1, `select inv_dispatch_to_project('${AE}', '${DXB}', '${PRJ}', 'shots-b-1', '[{"item_id":"${HDMI}","qty":3}]'::jsonb, '${B.request}', null, null)`);
// Also one request still to prepare (nothing reserved), so Today shows a Prepare row next to a Send row.
requestAs(4, PRJ, item("VR headset"), 2, 3, 6, { title: "Launch demo", submit: true });

const browser = await chromium.launch();
let n = 0;
for (const theme of ["dark", "light"]) {
  for (const [vp, vpName] of [[{ width: 1280, height: 900 }, "desktop"], [{ width: 390, height: 844 }, "phone"]]) {
    const page = await newPage(browser, vp, theme);
    await login(page, PERSONA.hr1[0]);
    const tag = `${vpName}-${theme}`;
    const shot = async (name, path, prep) => {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      if (prep) await prep();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: vpName === "desktop" });
      n++;
    };
    await shot("01-today", "/inventory");
    await shot("02-prepare", `/inventory/requests/${A.request}?step=prepare`);
    await shot("03-send-out", `/inventory/requests/${A.request}?step=send`, async () => {
      const boxes = page.locator("section", { hasText: "Laptop 14 inch" }).locator("input[type=checkbox]");
      if (await boxes.count()) await boxes.first().check();
      await page.getByLabel(/counted quantity/i).first().fill("2").catch(() => {});
      await page.getByLabel(/scan or type a code/i).fill("ENG-E-99999").catch(() => {});
      await page.getByRole("button", { name: "Add", exact: true }).click().catch(() => {});
    });
    await shot("04-receive-back", `/inventory/requests/${A.request}?step=back`, async () => {
      const first = page.getByLabel(/Laptop 14 inch · /).first();
      if (await first.count()) { await first.check(); await page.locator("select").filter({ hasText: "Choose condition" }).first().selectOption("good"); }
    });
    await shot("05-stock", "/inventory/stock");
    await shot("06-receive-stock", "/inventory/stock?action=receive", async () => {
      const panel = page.locator("aside[role=dialog]");
      await panel.getByLabel("Search for an item or unit to add").fill("HDMI");
      await panel.getByRole("list", { name: "Search results" }).getByRole("button", { name: /Add HDMI cable/ }).first().click();
      await panel.getByLabel(/Quantity of HDMI cable/).fill("10");
    });
    await shot("07-with-people", "/inventory/stock?view=people");
    await page.context().close();
  }
}
await browser.close();
console.log("done", n, "screenshots in", out);
