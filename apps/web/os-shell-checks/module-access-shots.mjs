// Focused screenshots of People & Access -> Module access (LOCAL STACK ONLY; seed with seed/budget.sh). usage: node module-access-shots.mjs before|after out-dir
import { chromium, newPage, login, BASE } from "./lib.mjs";
import { mkdirSync } from "node:fs";
const [mode = "before", out = "/tmp/module-access-shots"] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const U = (n) => `00000000-0000-4000-8000-0000000000a${n}`;
const D = { width: 1400, height: 900 }, M = { width: 390, height: 844 };
const browser = await chromium.launch();
async function shoot(viewport, name, act) {
  const page = await newPage(browser, viewport, "light"); await login(page, "ceo@e2e.local");
  await page.goto(`${BASE}/people-access?person=u:${U(4)}&tab=modules`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  if (act) await act(page);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); await page.context().close(); console.log("wrote", name);
}
await shoot(D, `${mode}-1-overview-desktop`);
await shoot(M, `${mode}-2-overview-phone`);
if (mode === "after") {
  await shoot(D, "after-3-edit-review-desktop", async (page) => {
    await page.getByRole("button", { name: /edit access/i }).first().click();
    await page.getByRole("radio", { name: /sales lead/i }).check(); await page.waitForTimeout(400);
  });
  await shoot(M, "after-4-advanced-phone", async (page) => {
    await page.getByRole("button", { name: /edit access/i }).first().click();
    await page.getByRole("radio", { name: /sales lead/i }).check();
    await page.getByText(/advanced access/i).first().click(); await page.waitForTimeout(400);
  });
}
await browser.close();
