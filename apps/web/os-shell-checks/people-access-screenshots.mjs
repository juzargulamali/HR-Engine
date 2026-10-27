// Representative screenshots of People & Access (LOCAL STACK ONLY). Seed with `seed/budget.sh` first. usage: node people-access-screenshots.mjs <out-dir>
import { chromium, newPage, login, BASE } from "./lib.mjs";
import { mkdirSync } from "node:fs";
const out = process.argv[2] ?? "/tmp/people-access-shots"; mkdirSync(out, { recursive: true });
const U = (n) => `00000000-0000-4000-8000-0000000000a${n}`;
const browser = await chromium.launch();
async function shoot(email, theme, viewport, path, name, act) {
  const page = await newPage(browser, viewport, theme); await login(page, `${email}@e2e.local`);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  if (act) await act(page);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); await page.context().close(); console.log("wrote", name);
}
const preset = (heading, label) => async (page) => {
  const c = page.locator('section[aria-labelledby^="pa-"]', { has: page.getByRole("heading", { name: heading, exact: true, level: 3 }) });
  const select = c.locator("select").first(); const o = (await select.locator("option").allInnerTexts()).find((x) => x.startsWith(label));
  await select.selectOption({ label: o }); await c.getByRole("button", { name: "Add preset" }).click(); await page.waitForTimeout(500);
};
const D = { width: 1280, height: 900 }, M = { width: 390, height: 844 };
await shoot("admin", "light", D, `/people-access?person=u:${U(1)}&tab=roles`, "01-admin-hr-roles-light");
await shoot("admin", "dark", D, `/people-access?person=u:${U(4)}&tab=account`, "02-admin-account-dark");
await shoot("ceo", "dark", D, `/people-access?person=u:${U(4)}&tab=modules`, "03-founder-module-access-review-dark", preset("Sales & CRM", "Sales lead"));
await shoot("hr1", "light", D, `/people-access?person=u:${U(5)}&tab=job`, "04-hr-admin-job-and-department-light");
await shoot("hr1", "dark", D, `/people-access?person=u:${U(5)}&tab=modules`, "05-budget-manager-presets-dark", preset("Project budgets", "Finance"));
await shoot("ceo", "dark", M, `/people-access?person=u:${U(4)}&tab=modules`, "06-phone-module-access-dark", preset("Sales & CRM", "Sales lead"));
await shoot("ceo", "light", D, "/people-access?view=company", "07-company-settings-light");
await shoot("mgr", "light", D, "/people-access", "08-nothing-to-manage-light");
await browser.close();
