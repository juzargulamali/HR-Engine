// Opens every Inventory screen as the roles that use it, in a real browser (LOCAL stack only; needs seed/inventory.sh), and fails on a crash,
// a console error or an error page. Optionally saves screenshots: SHOTS_DIR=/some/dir node inventory-smoke.mjs
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
const SHOTS = process.env.SHOTS_DIR ?? "";
const browser = await chromium.launch();
const ITEM = sql("select id from inv_items where name='Laptop 14 inch'");
const UNIT = sql("select id from inv_units order by code limit 1");
const CODE = sql("select code from inv_units order by code limit 1");
const BAL = sql("select label_code from inv_balances where label_code is not null limit 1") || "";
const PRJ = sql("select id from proj_projects where name='Showroom refresh'");
const pages = [
  ["ceo@e2e.local", "/inventory", "founder: stock table"], ["ceo@e2e.local", `/inventory?open=${ITEM}`, "founder: item panel"],
  ["ceo@e2e.local", `/inventory?unit=${UNIT}`, "founder: unit panel"], ["ceo@e2e.local", "/inventory?action=receive", "founder: receive stock"],
  ["ceo@e2e.local", "/inventory?action=issue", "founder: issue"], ["ceo@e2e.local", "/inventory?action=dispatch", "founder: dispatch"],
  ["ceo@e2e.local", "/inventory?action=return", "founder: return"], ["ceo@e2e.local", "/inventory?action=transfer", "founder: transfer"],
  ["ceo@e2e.local", "/inventory?action=scan", "founder: scan panel"], ["ceo@e2e.local", "/inventory/requests", "founder: requests"],
  ["ceo@e2e.local", "/inventory/movements", "founder: movements"], ["ceo@e2e.local", "/inventory/manage", "founder: setup"],
  ["ceo@e2e.local", "/inventory/access", "founder: access"], ["ceo@e2e.local", "/inventory/scan", "founder: scan page"],
  ["ceo@e2e.local", `/inventory/labels?item=${ITEM}`, "founder: labels"], ["ceo@e2e.local", "/inventory/mine", "founder: my equipment"],
  ["ceo@e2e.local", "/inventory/employees", "founder: employees' equipment"], ["ceo@e2e.local", `/projects/${PRJ}/equipment`, "founder: project equipment"],
  ["hr1@e2e.local", "/inventory", "operator: stock table"], ["hr1@e2e.local", "/inventory/movements", "operator: movements"],
  ["hr1@e2e.local", "/inventory?action=receive", "operator: receive"], ["hr1@e2e.local", "/inventory/manage", "operator: setup (read only)"],
  ["mgr@e2e.local", "/inventory", "project manager: catalogue summary"], ["mgr@e2e.local", "/inventory/requests", "project manager: requests"],
  ["mgr@e2e.local", `/projects/${PRJ}/equipment`, "project manager: project equipment"],
  ["lead@e2e.local", "/inventory/requests", "department head: requests"], ["hr@e2e.local", "/inventory/employees", "HR: employees' equipment"],
  ["emp@e2e.local", "/inventory/mine", "employee: my equipment"], ["admin@e2e.local", "/inventory", "no access"],
];
if (CODE) pages.push(["ceo@e2e.local", `/inventory/scan?c=${CODE}`, "founder: label address opens the record"]);
let fails = 0;
const sessions = new Map();
for (const [email, path, label] of pages) {
  if (!sessions.has(email)) { const p = await newPage(browser); await login(p, email); sessions.set(email, p); }
  const page = sessions.get(email); page.errors.length = 0;
  let status = 0;
  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 }); status = res?.status() ?? 0;
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const problems = [];
    if (status >= 400) problems.push(`HTTP ${status}`);
    if (/Application error|Internal Server Error|This page couldn.t load|Something went wrong/i.test(text)) problems.push("error page: " + text.slice(0, 120));
    const errs = page.errors.filter((e) => !/favicon|Failed to load resource.*(401|403)/i.test(e));
    if (errs.length) problems.push("browser errors: " + errs.slice(0, 2).join(" | ").slice(0, 300));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replace(/\W+/g, "-")}.png`, fullPage: false });
    if (problems.length) { fails++; console.log("FAIL", label, path, "::", problems.join("; ")); } else console.log("PASS", label, "|", text.slice(0, 90));
  } catch (e) { fails++; console.log("FAIL", label, path, "::", String(e.message).split("\n")[0]); }
}
for (const p of sessions.values()) await p.context().close();
await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL INVENTORY SCREENS OPEN WITHOUT ERRORS");
process.exit(fails ? 1 : 0);
