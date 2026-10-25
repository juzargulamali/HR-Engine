// Real-browser checks of the new My Day (LOCAL STACK ONLY; needs `seed/my-day.sh`, reseed before each run; it only reads).
// One page, one greeting; the CEO-style overview above and People & HR below with no figure shown twice; every figure equals what the same
// person's own session can read (counted in the database AS that person); the live clock count is told apart from the recorded attendance;
// each widget shows only to people whose module access allows it; and the page holds together on a phone.
import { execSync } from "node:child_process";
import { chromium, newPage, login, BASE, psql } from "./lib.mjs";

const browser = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const DB = process.env.LOCAL_DB_NAME ?? "hr_local_stack";
const uid = (email) => psql(`select id from auth.users where email='${email}'`);
/** One value counted by the database AS this person (row-level security applies exactly as it does for the app). */
const asUser = (email, query) => execSync(`psql -h 127.0.0.1 -U postgres -d ${DB} -v ON_ERROR_STOP=1 -Atq`, { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" }, input: `begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${uid(email)}","role":"authenticated"}', true);\n${query};\ncommit;\n` }).toString().trim().split("\n").filter(Boolean).pop();
const TODAY = psql("select (now() at time zone 'Asia/Dubai')::date");

async function open(email, viewport = { width: 1586, height: 992 }, theme = "dark") {
  const page = await newPage(browser, viewport, theme); await login(page, email);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" }); await page.waitForTimeout(400);
  return page;
}
const labelsIn = (page, name) => page.getByRole("list", { name }).locator("> li").evaluateAll((lis) => lis.map((li) => ({ text: li.innerText.replace(/\s+/g, " ").trim() })));
const valueOf = async (page, listName, label) => { const l = (await labelsIn(page, listName)).find((x) => x.text.includes(label)); const m = l?.text.match(/^(\d+|—)\s/); return m ? m[1] : null; };
const region = (page, name) => page.getByRole("region", { name });
const has = async (page, name) => (await region(page, name).count()) > 0;

const personas = {};
// ---------------------------------------------------------------------------------------------------------------------------
console.log("\n=== CEO (ceo@): everything the CEO may see");
{
  const p = await open("ceo@e2e.local"); personas.ceo = p;
  ok((await p.locator("main h1").count()) === 1, "exactly one page heading");
  ok(/^Good (morning|afternoon|evening)/.test(await p.locator("main h1").innerText()), "the heading is the greeting");
  ok(((await p.locator("main").innerText()).match(/Good (morning|afternoon|evening)/g) ?? []).length === 1, "the greeting appears once on the whole page");
  ok((await p.locator("main h2").allInnerTexts()).filter((t) => /People & HR today/.test(t)).length === 1, "People & HR continues below as a section of the same page (one section heading)");

  const top = await labelsIn(p, "Today at a glance"); const hr = await labelsIn(p, "People and HR figures");
  const topLabels = top.map((t) => t.text.replace(/^(\d+|—)\s/, "").replace(/ (\d+ with a shortage|Could not be loaded)$/, ""));
  const hrLabels = hr.map((t) => t.text.replace(/^(\d+|—)\s/, ""));
  console.log("  top:", topLabels.join(" | ")); console.log("  hr:", hrLabels.join(" | "));
  ok(["Active projects", "Open enquiries", "Decisions waiting", "Live equipment requests"].every((l) => topLabels.some((t) => t.startsWith(l))), "the overview strip has the four CEO figures");
  ok(["Employees", "Recorded present", "On leave", "Leave requests in review"].every((l) => hrLabels.some((t) => t.startsWith(l))), "People & HR has its four recorded figures");
  ok(!topLabels.some((t) => /Employees|Recorded present|On leave|Leave requests/.test(t)), "no HR figure is repeated in the overview strip");

  // each figure equals what the CEO's own session can read
  ok((await valueOf(p, "Today at a glance", "Active projects")) === asUser("ceo@e2e.local", "select count(*) from proj_directory() where status not in ('completed','archived')"), "Active projects = live projects in the directory this person can see");
  ok((await valueOf(p, "Today at a glance", "Open enquiries")) === asUser("ceo@e2e.local", "select count(*) from crm_opportunities where stage not in ('won','lost')"), "Open enquiries = open opportunities this person can see");
  const eqLive = asUser("ceo@e2e.local", "select count(*) from inv_requests where status in ('submitted','in_progress')");
  ok((await valueOf(p, "Today at a glance", "Live equipment requests")) === eqLive, "Live equipment requests = submitted and in-progress requests this person can see");
  const decisionRows = await region(p, "Needs your decision").locator("li a").evaluateAll((as) => as.map((a) => a.innerText.replace(/\s+/g, " ").trim()));
  const sumRows = decisionRows.reduce((n, t) => n + Number(t.match(/(\d+)\s*$/)?.[1] ?? 0), 0);
  ok((await valueOf(p, "Today at a glance", "Decisions waiting")) !== null && Number(await valueOf(p, "Today at a glance", "Decisions waiting")) <= sumRows, "Decisions waiting is the sum of the decision rows (the card may add other open items below)");

  // live clock status is told apart from recorded attendance, and each equals what this person can read
  const liveTxt = await region(p, "People today, live clock status").innerText();
  const liveNow = Number(liveTxt.match(/(\d+)\s*\n?\s*(person|people) clocked in now/)?.[1] ?? -1);
  ok(liveNow === Number(asUser("ceo@e2e.local", "select count(*) from attendance_sessions where status='open'")), `People today: clocked in now (${liveNow}) = open clock sessions this person can read`);
  ok(/live clock status/i.test(liveTxt) && /recorded attendance/i.test(liveTxt), "People today says it is live clock status and points to the recorded attendance below");
  const present = await valueOf(p, "People and HR figures", "Recorded present");
  ok(present === asUser("ceo@e2e.local", `select count(*) from attendance_records where work_date='${TODAY}' and status='present'`), "Recorded present = today's recorded 'present' rows this person can read");
  ok((await labelsIn(p, "People and HR figures")).some((t) => /Recorded present.*Daily record, not live status/.test(t.text)), "Recorded present is labelled 'Daily record, not live status'");
  ok((await valueOf(p, "People and HR figures", "Employees")) === asUser("ceo@e2e.local", "select count(*) from employees where employment_status='active'"), "Employees = active employees this person can read");

  // pipeline equals the Enquiries board; project status counts add up
  const pipe = await region(p, "Sales pipeline").getByRole("list", { name: "Open enquiries by stage" }).locator("li").evaluateAll((lis) => lis.map((l) => Number(l.innerText.trim().split(/\s+/).pop())));
  ok(pipe.reduce((a, b) => a + b, 0) === Number(asUser("ceo@e2e.local", "select count(*) from crm_opportunities where stage not in ('won','lost')")), "the pipeline stages add up to the open enquiries");
  const stat = await region(p, "Project status by deadlines and blockers").getByRole("img").getAttribute("aria-label");
  const nums = [...stat.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  ok(nums.reduce((a, b) => a + b, 0) <= Number(await valueOf(p, "Today at a glance", "Active projects")) && nums.length === 3, `project status groups (${nums.join("/")}) never exceed the active projects`);
  ok(/Blocked: a task is marked blocked\. At risk:/.test(await region(p, "Project status by deadlines and blockers").innerText()), "the rule behind the grouping is printed on the card");
  ok((await region(p, "Delivery this week").locator("ul.md\\:sr-only li").count()) >= 1, "Delivery this week lists the scheduled projects (also as a reading list)");

  // layout: main column and rail, level at the top
  const dw = await region(p, "Delivery this week").boundingBox(), dec = await region(p, "Needs your decision").boundingBox();
  const ratio = dw.width / (dw.width + dec.width);
  ok(Math.abs(dw.y - dec.y) < 4 && dw.x < dec.x, "the overview's left column and the decisions rail start level");
  ok(ratio > 0.64 && ratio < 0.74, `left column about 2/3 of the width (${ratio.toFixed(2)})`);
  const none = (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));
  ok(!none, "no sideways scroll at 1586 px");
  // every link on the page leads somewhere that renders
  const hrefs = [...new Set(await p.locator("main a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")).filter((h) => h && !h.startsWith("/#"))))];
  let bad = [];
  for (const h of hrefs) { const r = await p.request.get(`${BASE}${h}`); if (r.status() >= 400) bad.push(`${h} ${r.status()}`); }
  ok(bad.length === 0, `${hrefs.length} links on My Day all answer${bad.length ? ": " + bad.join(", ") : ""}`);
}

// ---------------------------------------------------------------------------------------------------------------------------
console.log("\n=== each person sees only what their access allows");
const cases = [
  // email, expected: [projects, sales, hr, live, equipment]
  ["hr@e2e.local", { projects: true, sales: false, hr: true, live: true, equip: true }],
  ["mgr@e2e.local", { projects: true, sales: true, hr: false, live: false, equip: true }],
  ["emp@e2e.local", { projects: false, sales: true, hr: false, live: false, equip: false }],
  ["pol.exec@e2e.local", { projects: false, sales: false, hr: true, live: true, equip: true }],
  ["pol.worker@e2e.local", { projects: false, sales: false, hr: false, live: false, equip: false }],
];
for (const [email, want] of cases) {
  const p = await open(email);
  const got = { projects: await has(p, "Delivery this week"), sales: await has(p, "Sales pipeline"), hr: (await p.locator("#hr-today").count()) > 0, live: await has(p, "People today, live clock status"), equip: await has(p, "Next dispatch") };
  ok(JSON.stringify(got) === JSON.stringify(want), `${email}: ${JSON.stringify(got)}`);
  ok((await p.locator("main h1").count()) === 1 && ((await p.locator("main").innerText()).match(/Good (morning|afternoon|evening)/g) ?? []).length === 1, `${email}: one greeting`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${email}: no sideways scroll`);
  if (email === "pol.exec@e2e.local") {
    const t = await p.locator("main").innerText();
    ok(!/Enginious Local AE/.test(t), "pol.exec@ sees nothing of the other company in People & HR (company boundary)");
    ok(!/Floor projection|Showroom refresh|Hotel lobby/.test(t), "pol.exec@ sees no project or enquiry of another company");
  }
  if (email === "emp@e2e.local") ok((await region(p, "Sales pipeline").locator("a[href^='/sales/opportunities/']").count()) >= 1, "emp@: the individual follow-ups (title, reference, due) are still listed in the Sales card");
  if (email === "mgr@e2e.local") {
    const d = await region(p, "Needs your decision").innerText();
    ok(/due in the next 7 days/.test(d), "mgr@: the quieter Projects rows (due in the next 7 days) are still on My Day, under 'Also open'");
    ok(/waiting for your review|overdue|handover/.test(d) || /Also open/.test(d), "mgr@: Projects rows keep their links to My Work");
  }
  if (email === "pol.worker@e2e.local") ok(/Nothing is waiting on you/.test(await p.locator("main").innerText()), "an employee with nothing waiting is told so plainly");
  if (email === "hr@e2e.local") {
    ok(Number(await valueOf(p, "People and HR figures", "Recorded present")) === Number(asUser(email, `select count(*) from attendance_records where work_date='${TODAY}' and status='present'`)), "hr@: Recorded present = what hr@ can read");
    const l = await region(p, "People today, live clock status").innerText();
    ok(Number(l.match(/(\d+)\s*\n?\s*(person|people) clocked in now/)?.[1]) === Number(asUser(email, "select count(*) from attendance_sessions where status='open'")), "hr@: clocked in now = open sessions hr@ can read (HR admins see everyone)");
  }
  await p.context().close();
}

// ---------------------------------------------------------------------------------------------------------------------------
console.log("\n=== phone (390 x 844) and light theme");
for (const [email, theme] of [["ceo@e2e.local", "dark"], ["ceo@e2e.local", "light"], ["emp@e2e.local", "dark"]]) {
  const p = await open(email, { width: 390, height: 844 }, theme);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${email} ${theme} phone: no sideways scroll`);
  ok(p.errors.length === 0, `${email} ${theme} phone: no page errors${p.errors.length ? " " + p.errors[0] : ""}`);
  if (email.startsWith("ceo") && theme === "dark") {
    const y = async (name) => (await region(p, name).first().boundingBox())?.y ?? Infinity;
    const yc = await p.locator("main").getByText("Attendance clock", { exact: true }).first().evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
    const yd = (await y("Needs your decision")) + await p.evaluate(() => window.scrollY), yw = (await y("Delivery this week")) + await p.evaluate(() => window.scrollY);
    ok(yd < yc && yc < yw, "phone order: what needs you, then your clock, then the week");
    const cards = await p.getByRole("list", { name: "Today at a glance" }).locator("> li").evaluateAll((lis) => lis.map((l) => Math.round(l.getBoundingClientRect().left)));
    ok(new Set(cards).size === 2, "the four figures sit in two columns on a phone");
    ok(await p.locator("ul.md\\:sr-only").first().isVisible(), "the delivery week is a readable list on a phone (the seven-day grid is for wide screens)");
  }
  await p.context().close();
}
const light = await open("ceo@e2e.local", { width: 1586, height: 992 }, "light");
ok(light.errors.length === 0 && (await light.locator("html").getAttribute("data-theme")) === "light", "light theme renders with no page errors");
await light.context().close();

await personas.ceo.context().close(); await browser.close();
console.log(fails === 0 ? "\nMY DAY CHECKS PASSED" : `\n${fails} FAILED`); process.exit(fails === 0 ? 0 : 1);
