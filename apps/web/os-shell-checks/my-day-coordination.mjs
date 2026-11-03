// Real-browser check of the coordination cues on My Day, Approvals and the access denials (LOCAL STACK ONLY; reseeds nothing itself).
// Needs: `STAGE=submitted bash seed/budget.sh` (a budget submitted by the Project Manager, waiting for Finance), then the script writes one pending leave request of emp@ (see below). Personas: employee (emp@), line manager (mgr@), Finance-only (pol.exec@), CEO (ceo@), and a person with no Sales access (lead@).
// Checks: how long each waits and who it is with (a person, or the Finance queue named as a queue), who can grant access named for a person with none, light and dark, 390px with no
// sideways scroll. Screenshots go to OUT (default /tmp/claude-0/coordination-shots). Usage: node os-shell-checks/my-day-coordination.mjs
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, newPage, login, BASE, psql } from "./lib.mjs";

const OUT = process.env.OUT ?? "/tmp/claude-0/coordination-shots"; mkdirSync(OUT, { recursive: true });
const DB = process.env.LOCAL_DB_NAME ?? "hr_local_stack";
const U = "00000000-0000-4000-8000";
let fails = 0; const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const asUser = (suffix, sql) => execSync(`psql -h 127.0.0.1 -U postgres -d ${DB} -v ON_ERROR_STOP=1 -Atq`, { env: { ...process.env, PGPASSWORD: "postgres" }, input: `begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${U}-0000000000a${suffix}","role":"authenticated"}', true);\n${sql};\ncommit;\n` }).toString().trim().split("\n").pop();

// One pending leave request by emp@ waiting on the line manager. The local database has no leave policy for the sample country, so the real function refuses (no policy for the type);
// the rows are written directly, as the My Day seed does for attendance (fictional values, local stack only, triggers off for this one insert).
if (Number(psql("select count(*) from leave_requests where status in ('submitted','pending_approval')")) === 0) {
  const sql = `begin; set local session_replication_role = replica;
    with r as (insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days, reason, status, submitted_at)
      select e.id, 'annual', (now() + interval '30 days')::date, (now() + interval '30 days')::date, 1, 'Browser check', 'pending_approval', now() from employees e where e.user_id = '${U}-0000000000a5' returning id)
    insert into approvals (entity_type, entity_id, step_order, approver_id) select 'leave_request', r.id, 1, '${U}-0000000000a4' from r; commit;`;
  execSync(`psql -h 127.0.0.1 -U postgres -d ${DB} -v ON_ERROR_STOP=1 -q`, { env: { ...process.env, PGPASSWORD: "postgres" }, input: sql });
}
const managerName = psql("select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) from employees e join employees m on m.id = e.manager_id left join profiles p on p.id = m.user_id where e.user_id = '" + U + "-0000000000a5'");
const grantNames = psql(`select string_agg(n, ',' order by n) from (select coalesce(nullif(btrim(p.full_name), ''), e.first_name || ' ' || e.last_name) n from crm_company_grants g join profiles p on p.id = g.user_id left join employees e on e.user_id = g.user_id where g.revoked_at is null and ('founder' = any (g.capabilities) or 'manage_access' = any (g.capabilities)) and g.company_id = (select company_id from employees where user_id = '${U}-0000000000a7')) x`).split(",").filter(Boolean);
console.log(`  expected: emp@'s approver "${managerName}"; Sales access managers of lead@'s company: ${grantNames.join(", ") || "none"}`);

const browser = await chromium.launch();
const main = (p) => p.locator("main").innerText();
async function visit(email, path, viewport, theme, shot) {
  const page = await newPage(browser, viewport, theme); await login(page, email);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(400);
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  return { page, text: await main(page), overflow, errors: page.errors };
}
const DESKTOP = { width: 1440, height: 900 }, PHONE = { width: 390, height: 844 };

console.log("\n=== employee (emp@): own request waits, with whom");
{
  const { page, text, errors } = await visit("emp@e2e.local", "/", DESKTOP, "light", "emp-light");
  ok(/Waiting on others/i.test(text) && /Leave request you submitted, waiting for a decision/.test(text), "the leave request is under Waiting on others");
  ok(/Oldest (submitted today|waiting \d+ days?)/.test(text), "how long it has waited is shown");
  ok(managerName && text.includes(`with ${managerName}`), `who it is with is named (${managerName})`);
  ok(!/Needs me[\s\S]*Leave request you submitted/.test(text.split(/waiting on others/i)[0]), "it is not in the decision list");
  ok(errors.length === 0, `no console errors ${errors.join(" | ")}`); await page.context().close();
}

console.log("\n=== line manager (mgr@): decision waiting with its age; own budget waiting on the Finance queue; Approvals shows the wait");
for (const [theme, vp, tag] of [["dark", DESKTOP, "mgr-dark"], ["light", PHONE, "mgr-phone-light"]]) {
  const { page, text, overflow } = await visit("mgr@e2e.local", "/", vp, theme, tag);
  ok(/Waiting on your decision/.test(text) && /Oldest (submitted today|waiting \d+ days?)/.test(text.split(/waiting on others/i)[0]), `${tag}: Needs me shows the approval with its age`);
  ok(/Project budgets you submitted, waiting on others/.test(text) && /with the Finance queue/.test(text), `${tag}: the budget waits with the Finance queue (a queue, not a person)`);
  ok(!overflow, `${tag}: no sideways scroll`); await page.context().close();
}
{
  const { page, text } = await visit("mgr@e2e.local", "/approvals", DESKTOP, "dark", "mgr-approvals");
  ok(/Waiting (since today|\d+ days?)/.test(text), "the Approvals row says how long it has waited on the manager"); await page.context().close();
}

console.log("\n=== Finance-only (pol.exec@): the budget waits for them, with its age");
for (const [theme, vp, tag] of [["light", DESKTOP, "fin-light"], ["dark", PHONE, "fin-phone-dark"]]) {
  const { page, text, overflow } = await visit("pol.exec@e2e.local", "/", vp, theme, tag);
  ok(/Project budgets waiting for you/.test(text) && /Oldest (submitted today|waiting \d+ days?)/.test(text), `${tag}: the decision shows its age`);
  ok(!overflow, `${tag}: no sideways scroll`); await page.context().close();
}

console.log("\n=== CEO (ceo@): My Day holds together");
{
  const { page, text, overflow, errors } = await visit("ceo@e2e.local", "/", DESKTOP, "dark", "ceo-dark");
  ok(/Needs me/.test(text) && !overflow && errors.length === 0, "Needs me present, no sideways scroll, no console errors"); await page.context().close();
}

console.log("\n=== a person with no Sales access is told whom to ask");
for (const [theme, vp, tag] of [["light", PHONE, "noaccess-phone-light"], ["dark", DESKTOP, "noaccess-dark"]]) {
  const { page, text, overflow } = await visit("lead@e2e.local", "/sales", vp, theme, tag);
  ok(/You do not have Sales access/.test(text), `${tag}: the denial is shown`);
  ok(grantNames.length > 0 ? grantNames.every((n) => text.includes(n)) && /Ask .+ to give you access\./.test(text) : /Ask a founder to give you access\./.test(text), `${tag}: the names (${grantNames.join(", ") || "generic wording: none listed"}) are in the sentence`);
  ok(!/could not load who can grant/i.test(text), `${tag}: no false failure`);
  ok(!overflow, `${tag}: no sideways scroll`); await page.context().close();
}
await browser.close();
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}  (screenshots in ${OUT})`);
process.exit(fails === 0 ? 0 : 1);
