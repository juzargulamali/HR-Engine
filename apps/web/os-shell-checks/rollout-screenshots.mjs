// Representative screenshots of the Stage 4-7 rollout (LOCAL STACK ONLY, read-only; needs `seed/inventory.sh` or the sample scenario).
// Usage: node os-shell-checks/rollout-screenshots.mjs [out-dir]   (default docs/os-rollout-screenshots)
import { mkdirSync } from "node:fs";
import { chromium, newPage, login, BASE, psql } from "./lib.mjs";
const out = process.argv[2] ?? new URL("../../../docs/os-rollout-screenshots", import.meta.url).pathname; mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const opp = psql("select id from crm_opportunities where stage not in ('won','lost') order by created_at limit 1");
const req = psql("select id from inv_requests order by created_at limit 1");
const shots = [
  // [file, persona, path, theme, width, height, action]
  ["sales-enquiries-dark", "ceo@e2e.local", "/sales/opportunities", "dark", 1440, 900],
  ["sales-enquiries-light", "ceo@e2e.local", "/sales/opportunities", "light", 1440, 900],
  ["sales-board-dark", "ceo@e2e.local", "/sales/opportunities?view=board", "dark", 1440, 900],
  ["sales-enquiry-panel-dark", "ceo@e2e.local", `/sales/opportunities?open=${opp}`, "dark", 1440, 900],
  ["sales-enquiry-detail-light", "ceo@e2e.local", `/sales/opportunities/${opp}`, "light", 1440, 900],
  ["sales-enquiries-phone-dark", "ceo@e2e.local", "/sales/opportunities", "dark", 390, 844],
  ["sales-new-enquiry-dark", "ceo@e2e.local", "/sales/new", "dark", 1440, 900],
  ["sales-no-access-dark", "admin@e2e.local", "/sales", "dark", 1440, 700],
  ["not-found-dark", "ceo@e2e.local", "/sales/opportunities/00000000-0000-4000-8000-00000000dead", "dark", 1440, 700],
  ["inventory-items-dark", "ceo@e2e.local", "/inventory", "dark", 1440, 900],
  ["inventory-items-light", "ceo@e2e.local", "/inventory", "light", 1440, 900],
  ["inventory-requests-panel-dark", "ceo@e2e.local", req ? `/inventory/requests?open=${req}` : "/inventory/requests", "dark", 1440, 900],
  ["inventory-items-phone-dark", "ceo@e2e.local", "/inventory", "dark", 390, 844],
  ["my-equipment-dark", "emp@e2e.local", "/inventory/mine", "dark", 1440, 800],
  ["employees-dark", "ceo@e2e.local", "/employees", "dark", 1440, 900],
  ["employees-phone-dark", "ceo@e2e.local", "/employees", "dark", 390, 844],
  ["employee-profile-light", "ceo@e2e.local", "/employees/00000000-0000-4000-8000-0000000000e2", "light", 1440, 900],
  ["leave-dark", "emp@e2e.local", "/leave", "dark", 1440, 800],
  ["leave-phone-light", "emp@e2e.local", "/leave", "light", 390, 844],
  ["approvals-dark", "mgr@e2e.local", "/approvals", "dark", 1440, 800],
  ["attendance-clock-dark", "emp@e2e.local", "/attendance-clock", "dark", 1440, 800],
  ["policies-dark", "ceo@e2e.local", "/policies", "dark", 1440, 800],
  ["admin-users-light", "admin@e2e.local", "/admin/users", "light", 1440, 800],
  ["account-security-dark", "ceo@e2e.local", "/account/security", "dark", 1440, 900],
];
const sessions = new Map();
for (const [file, who, path, theme, w, h] of shots) {
  const key = `${who}|${theme}|${w}`;
  if (!sessions.has(key)) { const page = await newPage(browser, { width: w, height: h }, theme); await login(page, who); sessions.set(key, page); }
  const page = sessions.get(key); await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${file}.png` }); console.log("shot", file);
}
// the quick-add dialog
{
  const page = await newPage(browser, { width: 1440, height: 900 }, "dark"); await login(page, "ceo@e2e.local");
  await page.goto(`${BASE}/sales/opportunities`, { waitUntil: "networkidle" }); await page.getByRole("button", { name: /add enquiry/i }).first().click(); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/sales-add-enquiry-dialog-dark.png` }); console.log("shot dialog");
}
await browser.close();
