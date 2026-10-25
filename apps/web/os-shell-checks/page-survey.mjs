// Visits every signed-in page of the app as one person and records: HTTP status, console/page errors, sideways scroll, and a screenshot.
// LOCAL STACK ONLY. Usage: PERSONA=ceo@e2e.local THEME=dark WIDTH=1440 OUT=/tmp/shots node os-shell-checks/page-survey.mjs [filter-regex]
// The routes (with ids read from the seeded database) are the page coverage list of the rollout: docs/os-rollout-4-7.md.
import { mkdirSync } from "node:fs";
import { chromium, newPage, login, BASE, psql } from "./lib.mjs";
const persona = process.env.PERSONA ?? "ceo@e2e.local", theme = process.env.THEME ?? "dark", width = Number(process.env.WIDTH ?? 1440), height = Number(process.env.HEIGHT ?? 900);
const out = process.env.OUT ?? "/tmp/claude-0/shots"; mkdirSync(out, { recursive: true });
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const one = (q) => { try { return psql(q).split("\n")[0] || null; } catch { return null; } };
export const ROUTES = () => {
  const proj = one("select id from proj_projects where kind='client' order by created_at limit 1");
  const task = proj ? one(`select id from proj_tasks where project_id='${proj}' limit 1`) : null;
  const opp = one("select id from crm_opportunities where stage not in ('won','lost') order by created_at limit 1");
  const won = one("select id from crm_opportunities where stage='won' limit 1");
  const emp = "00000000-0000-4000-8000-0000000000e2";
  const pol = one("select id from policy_versions limit 1");
  const pay = one("select id from payroll_export_runs limit 1"), reimb = one("select id from reimbursement_claims limit 1");
  const ts = one("select id from timesheets limit 1"), appr = one("select id from appraisals limit 1");
  const r = [
    "/", "/approvals", "/alerts", "/ai-suggestions",
    "/sales", "/sales/opportunities", "/sales/pipeline", "/sales/follow-ups", "/sales/proposals", "/sales/clients", "/sales/reports", "/sales/new", "/sales/settings", "/sales/access",
    opp && `/sales/opportunities/${opp}`, opp && `/sales/opportunities/${opp}/handover`, won && `/sales/opportunities/${won}/close`, opp && `/sales/opportunities/${opp}/close`,
    "/inventory", "/inventory/requests", "/inventory/movements", "/inventory/mine", "/inventory/employees", "/inventory/labels", "/inventory/manage", "/inventory/access", "/inventory/scan",
    "/projects", "/projects/work", "/projects/calendar", "/projects/handovers", "/projects/access", "/projects/new",
    proj && `/projects/${proj}/work`, proj && `/projects/${proj}/plan`, proj && `/projects/${proj}/discussion`, proj && `/projects/${proj}/equipment`, proj && `/projects/${proj}/people`, proj && `/projects/${proj}/documents`, proj && `/projects/${proj}/changes`, proj && `/projects/${proj}/history`, proj && `/projects/${proj}/complete`,
    proj && task && `/projects/${proj}/work/tasks/${task}`,
    "/employees", "/employees/new", `/employees/${emp}`, "/leave", "/leave/new", "/attendance", "/attendance-clock", "/timesheets", ts && `/timesheets/${ts}`,
    "/payroll", pay && `/payroll/${pay}`, "/reimbursements", reimb && `/reimbursements/${reimb}`, "/letters", "/assets", "/holidays",
    "/performance", "/performance/cycles", appr && `/performance/appraisals/${appr}`,
    "/policies", "/policies/new", pol && `/policies/${pol}`,
    "/audit-log", "/admin/users", "/admin/companies", "/profile", "/account/security",
  ].filter(Boolean);
  return r;
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.launch(); const page = await newPage(browser, { width, height }, theme); await login(page, persona);
  const rows = [];
  for (const path of ROUTES()) {
    if (only && !only.test(path)) continue;
    page.errors.length = 0;
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch((e) => ({ status: () => 0, err: e.message }));
    await page.waitForTimeout(250);
    const status = res.status();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const where = new URL(page.url()).pathname;
    const errs = page.errors.filter((e) => !/favicon/.test(e));
    const name = path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "ID").replace(/^\//, "").replace(/\//g, "_") || "home";
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
    rows.push({ path, status, redirected: where !== path.split("?")[0] ? where : "", overflow, errs: errs.length });
    console.log(`${status} ${overflow ? "OVERFLOW " : ""}${errs.length ? `ERR(${errs.length}) ` : ""}${where !== path ? `-> ${where} ` : ""}${path}`);
  }
  await browser.close();
}
