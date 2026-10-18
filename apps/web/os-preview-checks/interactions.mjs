import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const B = "http://localhost:3100/os-preview";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const results = [];
const check = (name, ok, extra = "") => results.push([ok ? "PASS" : "FAIL", name, extra]);
const requests = [];
process.on("uncaughtException", (e) => { for (const r of results) if (r[0] === "FAIL") console.log(r.join(" | ")); console.log("CRASH after", results.length, "checks:", String(e.message).split("\n")[0], "\n", String(e.stack).split("\n").slice(1, 4).join("\n")); process.exit(1); });
async function fresh(vp = { width: 1440, height: 900 }, fakeClock = true) {
  const ctx = await browser.newContext({ viewport: vp, permissions: ["clipboard-read", "clipboard-write"] });
  // The browser's own clock is deliberately a different day: the preview must ignore it.
  if (fakeClock) await ctx.clock.install({ time: new Date("2031-03-05T12:00:00Z") });
  const page = await ctx.newPage();
  page.on("request", (r) => requests.push([r.method(), r.url()]));
  return page;
}
const text = async (p) => (await p.locator("body").innerText());
const go = async (p, path) => { await p.goto(`${B}${path}`, { waitUntil: "networkidle" }); };

// ---------- sample time ----------
let p = await fresh();
await go(p, "/my-day?role=sales");
let body = await text(p);
check("sample time is shown in the banner", /SAMPLE TIME: MON 19 OCT 2026, 9:30 AM · DUBAI TIME/i.test(body));
check("greeting uses the sample date, not the browser date", body.includes("MONDAY 19 OCTOBER 2026") || body.includes("Monday 19 October 2026"));
check("browser clock really differs (2031)", (await p.evaluate(() => new Date().getFullYear())) === 2031);

// ---------- deadlines agree everywhere ----------
await go(p, "/sales/opportunities/OPP-2026-0041?role=sales");
body = await text(p);
check("opp 41: one primary deadline format", body.includes("Due 16 Oct, 4:00 pm · Dubai time"));
check("opp 41: overdue by 3 days", body.includes("Overdue by 3 days"));
await go(p, "/sales/opportunities?role=sales");
body = await text(p);
check("list: same overdue label for opp 41", body.includes("Overdue by 3 days") && body.includes("Overdue by 2 days"));
await go(p, "/sales/follow-ups?role=sales");
body = await text(p);
check("follow-ups: Overdue tab count is 2 and shows both labels", body.includes("Overdue (2)") && body.includes("Overdue by 3 days") && body.includes("Overdue by 2 days"));
check("follow-ups: due today count is 2", body.includes("Due today (2)"));
await go(p, "/sales?role=founder");
body = await text(p);
const tileOverdue = await p.getByText("Overdue follow-ups").first().locator("xpath=..").innerText();
check("overview: overdue tile shows 2", /Overdue follow-ups\s*\n?\s*2/.test(tileOverdue.replace(/\n+/g, "\n")) || tileOverdue.includes("2"));
await go(p, "/my-day?role=founder");
body = await text(p);
check("founder: overdue 3 days and 2 days agree", body.includes("Overdue by 3 days") && body.includes("Overdue by 2 days") && body.includes("Open overdue (2)"));

// ---------- founder dashboard ----------
check("founder: four numbered priority sections in order", (() => { const i = [body.indexOf("Decisions for you"), body.indexOf("Overdue follow-ups and enquiries awaiting a response"), body.indexOf("Installations coming up without full confirmation"), body.indexOf("Project risks and blockers")]; return i.every((x) => x > -1) && i.every((x, k) => k === 0 || x > i[k - 1]); })());
check("founder: project risks labelled as future-module sample", body.includes("Future module · sample"));
check("founder: financial summary is collapsed but available", (await p.locator("details summary", { hasText: "Financial summary" }).count()) === 1);
await p.locator("details summary", { hasText: "Financial summary" }).click();
body = await text(p);
for (const h of ["Approved budget", "Committed cost", "Actual incurred cost", "Forecast final cost", "Invoiced", "Customer collections", "Supplier payments"]) check(`finance: column ${h}`, body.includes(h));
check("finance: no 'paid or reconciled'", !/paid or reconciled/i.test(body));
check("finance: advances separate from costs", /advances issued \(cash given, not yet a cost\)/i.test(body));
await p.getByRole("link", { name: "Open overdue (2)" }).click();
await p.waitForURL(/filter=overdue/);
check("founder: overdue card opens the filtered list with 2 records", (await text(p)).includes("2 of 15 opportunities"));
await go(p, "/my-day?role=founder");
await p.getByLabel("Company").selectOption("uae");
await p.waitForTimeout(200);
body = await text(p);
check("founder: company filter keeps currencies separate (AED only)", body.includes("AED ·") && !body.includes("SAR ·") && !body.includes("EUR ·"));
await p.getByRole("link", { name: /Open these/ }).click();
await p.waitForURL(/filter=install-risk/);
check("founder: company filter carried into drill-down", p.url().includes("company=uae"));
check("drill-down: install-risk list is filtered by company", !(await text(p)).includes("Interactive wall"));

// ---------- opportunity list columns, sort, filter ----------
await go(p, "/sales/opportunities?role=sales");
const heads = await p.locator("thead th").allInnerTexts();
check("list: installation, show dates, location, owner, value, next action columns", ["Installation", "Show dates", "Location", "Owner", "Value", "Next action"].every((h) => heads.includes(h)), heads.join("|"));
check("list: default sort is installation date (soonest first)", (await p.locator("tbody tr").first().innerText()).includes("OPP-2026-0044"));
await p.getByRole("button", { name: "Columns" }).click();
await p.getByLabel("Event location").uncheck();
check("list: columns are configurable", !(await p.locator("thead th").allInnerTexts()).includes("Location"));
await p.selectOption('select[aria-label="Show"]', "no-dates");
check("list: dates-not-confirmed filter", (await text(p)).includes("Dates not confirmed") && (await p.locator("tbody tr").count()) === 4);
await go(p, "/sales/opportunities/OPP-2026-0042?role=sales");
body = await text(p);
check("detail: unknown dates stay allowed and are clear", (body.match(/Dates not confirmed/g) ?? []).length >= 2);
await go(p, "/sales/opportunities/OPP-2026-0041?role=sales");
const summary = await p.getByLabel("Key dates and location").innerText();
check("detail: install, show and location directly under the title", summary.includes("23 Nov 2026") && summary.includes("26–28 Nov 2026") && summary.includes("Dubai Design District"));

// ---------- everyday actions ----------
for (const n of ["Log activity", "Complete follow-up", "Schedule next action"]) check(`detail: primary action '${n}' visible`, await p.getByRole("button", { name: n }).first().isVisible());
check("detail: Won/Lost and Reassign are not primary buttons", (await p.getByRole("link", { name: "Mark Won or Lost" }).count()) === 0 && (await p.getByRole("button", { name: "Reassign owner" }).count()) === 0);
await p.getByRole("button", { name: "More", exact: true }).click();
check("detail: Won/Lost under More for the owner", await p.getByRole("menuitem", { name: "Mark Won or Lost" }).isVisible());
check("detail: Reassign not offered to a Sales user", (await p.getByRole("menuitem", { name: "Reassign owner" }).count()) === 0);
await p.keyboard.press("Escape");

// complete follow-up
await p.getByRole("button", { name: "Complete follow-up" }).click();
await p.getByRole("dialog").getByRole("button", { name: "Complete follow-up" }).click();
let dlg = await p.getByRole("dialog").innerText();
check("complete: needs an outcome and a next action", dlg.includes("Choose what happened.") && dlg.includes("Every open opportunity needs a next action."));
check("complete: says it does not change the stage or mean won", dlg.includes("does not change the stage or mean the deal is won"));
await p.selectOption("#cf-outcome", "Left a message");
await p.locator("#cf-replied").check();
await p.getByRole("dialog").getByRole("button", { name: "Complete follow-up" }).click();
check("complete: a claimed client reply needs what they said", (await p.getByRole("dialog").innerText()).includes("Write what the client said."));
await p.locator("#cf-replied").uncheck();
await p.fill("#cf-what", "Call the producer");
await p.fill("#cf-date", "2026-10-21"); await p.fill("#cf-time", "10:00");
await p.getByRole("dialog").getByRole("button", { name: "Complete follow-up" }).click();
await p.waitForTimeout(200);
body = await text(p);
check("complete: stage is still Proposal sent (never Won)", body.includes("Proposal sent") && !/\bWon\b/.test(body.split("Next action")[0]));
check("complete: next action replaced with the new primary deadline", body.includes("Call the producer") && body.includes("Due 21 Oct, 10:00 am · Dubai time"));
await p.getByRole("tab", { name: "Activities" }).click();
body = await text(p);
check("complete: no client-response entry was invented (only the one seeded)", (body.match(/Client response/g) ?? []).length === 1);
check("complete: outcome recorded in the timeline", body.includes("Completed “Chase client on proposal v2”: Left a message."));

// schedule next action validation & on hold rule
await p.getByRole("button", { name: "Schedule next action" }).click();
await p.fill("#sn-what", "Prepare options"); await p.fill("#sn-date", "2026-10-18");
await p.getByRole("dialog").getByRole("button", { name: "Schedule" }).click();
check("schedule: a time in the past is refused", (await p.getByRole("dialog").innerText()).includes("Choose a time after the sample time"));
await p.keyboard.press("Escape");
await go(p, "/sales/opportunities/OPP-2026-0053?role=sales");
await p.getByRole("button", { name: "Complete follow-up" }).click();
await p.selectOption("#cf-outcome", "Email sent");
await p.locator("#cf-hold").check();
await p.getByRole("dialog").getByRole("button", { name: "Complete follow-up" }).click();
check("on hold: needs a review date", (await p.getByRole("dialog").innerText()).includes("Choose a review date."));
await p.fill("#cf-review", "2026-11-10");
await p.getByRole("dialog").getByRole("button", { name: "Complete follow-up" }).click();
await p.waitForTimeout(200);
check("on hold: opportunity shows On hold with its review date", (await text(p)).includes("On hold") && (await text(p)).includes("Review 10 Nov 2026"));
// non-owner cannot complete
await go(p, "/sales/opportunities/OPP-2026-0042?role=sales");
check("non-owner: Complete and Schedule are disabled, Log activity still works", (await p.getByRole("button", { name: "Complete follow-up" }).isDisabled()) && (await p.getByRole("button", { name: "Schedule next action" }).isDisabled()) && !(await p.getByRole("button", { name: "Log activity" }).first().isDisabled()));

// ---------- availability wording and recheck ----------
await go(p, "/sales/opportunities/OPP-2026-0041?role=sales");
body = await text(p);
check("availability: 'Equipment availability confirmed' not 'Confirmed by'", body.includes("Equipment availability confirmed") && !/Confirmed by/.test(body));
check("availability: separate from commercial status", body.includes("Not commercially confirmed"));
await p.getByRole("tab", { name: "Scope & Dates" }).click();
body = await text(p);
check("availability: who, when and what it covers", body.includes("Karim Saleh") && body.includes("12 Oct 2026, 10:20 am · Dubai time") && body.includes("Floor projection ×2") && body.includes("23–29 Nov") || body.includes("show 26–28 Nov 2026"));
check("availability: says it is not a stock reservation", (await p.getByRole("button", { name: "More information" }).count()) > 0);
await p.getByLabel("Quantity of Floor projection").fill("3");
await p.getByRole("button", { name: "Save changes" }).click();
body = await text(p);
check("availability: changed quantity marks it as needing a recheck", body.includes("Needs repeating") && body.includes("Equipment check needs repeating"));
await p.getByRole("button", { name: "Request equipment check" }).click();
check("availability: recheck can be requested", (await text(p)).includes("Equipment check requested"));
await go(p, "/sales/opportunities/OPP-2026-0041?role=sales&tab=scope");
await p.fill("#d-start", "2026-12-05");
await p.getByRole("button", { name: "Save changes" }).click();
check("availability: changed dates also need a recheck", (await text(p)).includes("Needs repeating"));
await p.getByLabel("Quantity of Floor projection").fill("2");
// commercial won never depends on availability
await go(p, "/sales/opportunities/OPP-2026-0048?role=sales&tab=confirmation");
body = await text(p);
check("won (email evidence) with unchecked equipment stays commercially won", body.includes("Commercially won") && body.includes("Equipment availability not checked"));

// ---------- approval states ----------
await go(p, "/sales/opportunities/OPP-2026-0041?role=sales&tab=proposals");
body = await text(p);
check("approval UAE: required, none on record, sent is not approval", body.includes("Approval required") && body.includes("No approval on record") && body.includes("Recording that it was sent is not an approval.") && !body.includes("Approved"));
check("approval: changes requested shown with instruction", body.includes("Changes requested") && body.includes("Reduce the second-tier scope"));
await p.getByRole("button", { name: "Request approval" }).click();
check("approval: owner can request approval (becomes pending)", (await text(p)).includes("Pending approval"));
await go(p, "/sales/opportunities/OPP-2026-0043?role=sales&tab=proposals");
check("approval KSA: 'Approval requirements not configured'", (await text(p)).includes("Approval requirements not configured") && !(await text(p)).includes("no approval is required"));
await go(p, "/sales/opportunities/OPP-2026-0045?role=sales&tab=proposals");
check("approval EU: explicitly no approval required", (await text(p)).includes("No approval required"));
await go(p, "/sales/opportunities/OPP-2026-0047?role=sales&tab=proposals");
check("approval: approved and locked", (await text(p)).includes("Approved") && (await text(p)).includes("locked"));
await go(p, "/sales/opportunities/OPP-2026-0044?role=sales&tab=proposals");
check("approval: pending, Sales user cannot decide", (await text(p)).includes("Pending approval") && (await p.getByRole("button", { name: "Approve" }).count()) === 0);
await go(p, "/sales/opportunities/OPP-2026-0044?role=founder&tab=proposals");
check("approval: founder can approve or request changes", (await p.getByRole("button", { name: "Approve" }).count()) === 1 && (await p.getByRole("button", { name: "Request changes" }).count()) === 1);
await p.getByRole("button", { name: "Request changes" }).click();
await p.getByRole("dialog").getByRole("button", { name: "Send back" }).click();
check("approval: changes need an instruction", (await p.getByRole("dialog").innerText()).includes("Say what needs to change."));
await go(p, "/sales/settings?role=sales");
check("settings: Sales user can edit follow-up rules but not approval", (await p.locator("#s-first").isEnabled()) && (await p.locator("#pol-uae").isDisabled()) && (await text(p)).includes("You cannot give yourself approval powers"));
await go(p, "/sales/settings?role=founder");
check("settings: founder can set approval policy", await p.locator("#pol-uae").isEnabled());
await go(p, "/sales/settings?role=employee");
check("settings: employee has no Sales access", (await text(p)).includes("don't have access to Sales"));

// ---------- contacts ----------
await go(p, "/sales/opportunities/OPP-2026-0041?role=sales");
check("contacts: name, position, relationship and role", (await text(p)).includes("Hana Verma") && (await text(p)).includes("Senior Producer") && (await text(p)).includes("Agency contact") && (await text(p)).includes("End-client contact"));
check("contacts: copy and explicit call/email links", (await p.getByRole("button", { name: /Copy number/ }).count()) >= 2 && (await p.locator('a[href^="tel:"]').count()) >= 2 && (await p.locator('a[href^="mailto:"]').count()) >= 2);
check("contacts: fictional details only", (await p.locator('a[href^="mailto:"]').evaluateAll((els) => els.every((e) => e.getAttribute("href").endsWith("@example.test")))));
await p.getByRole("button", { name: /Copy email/ }).first().click();
await p.waitForTimeout(300);
check("contacts: copy gives visible confirmation", (await p.getByText("Copied").first().isVisible()));
await go(p, "/sales/opportunities/OPP-2026-0046?role=sales");
check("contacts: missing email says Not recorded", (await text(p)).includes("Not recorded"));
await go(p, "/sales/clients?role=sales");
check("clients: contact cards have copy and call actions", (await p.getByRole("button", { name: /Copy number/ }).count()) >= 1);

// ---------- proposals: upload or link ----------
await go(p, "/sales/opportunities/OPP-2026-0041?role=sales&tab=proposals");
check("proposals: separate Upload file and Add link options", (await p.getByLabel("Upload file").count()) === 1 && (await p.getByLabel("Add link").count()) === 1);
check("proposals: latest sent and superseded are distinguished", (await text(p)).includes("Latest sent") && (await text(p)).includes("Superseded"));
await p.getByLabel("Add link").check();
await p.fill("#pv-url", "not a link");
await p.getByRole("button", { name: "Add as draft" }).click();
check("proposals: link must be a full URL", (await text(p)).includes("Paste a full link starting with https://"));
await p.getByLabel("Upload file").check();
await p.getByRole("button", { name: "Add as draft" }).click();
check("proposals: file required", (await text(p)).includes("Choose a file."));
await p.setInputFiles("#pv-file", { name: "options-v3.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-sample") });
await p.fill("#pv-note", "Added the third zone");
await p.getByRole("button", { name: "Add as draft" }).click();
body = await text(p);
check("proposals: new version listed as latest draft with filename, author, note", body.includes("options-v3.pdf") && body.includes("Latest draft") && body.includes("Added the third zone"));
check("proposals: honest about access and upload", body.includes("Not active in this preview") || (await p.getByRole("button", { name: "More information" }).count()) > 0);

// ---------- workload ----------
await go(p, "/my-day?role=head");
body = await text(p);
check("head: no double-booked / competing wording", !/double-booked|competing|unassigned days/i.test(body));
check("head: neutral wording for several projects", body.includes("Multiple project assignments"));
check("head: days without a recorded project allocation", body.includes("No allocation recorded") && body.includes("have no recorded project allocation"));
check("head: warnings come from overdue, blocked or raised concerns", body.includes("Overdue tasks") && body.includes("Blocked tasks") && body.includes("Raised by Priya Raman"));
await go(p, "/projects?role=founder");
body = await text(p);
check("projects: exactly one site booking conflict", (body.match(/Site booking conflict/g) ?? []).length === 1);
check("projects: legitimate parallel office work shown as allowed", body.includes("This is allowed: both are office work"));
check("projects: a programmer on site is protected like anyone else", body.includes("Nadia Farouk (Programmer)") && body.includes("Protected 05:30"));
check("projects: no-conflict site example", body.includes("No conflict · Ibrahim Saad"));

// ---------- permissions ----------
for (const r of ["pm", "head", "employee"]) {
  await go(p, `/sales?role=${r}`);
  check(`permissions: ${r} has no Sales access`, (await p.getByRole("region", { name: "Permission denied" }).count()) === 1);
}
await go(p, "/sales/opportunities/OPP-2026-0042?role=founder");
await p.getByRole("button", { name: "More", exact: true }).click();
check("permissions: founder can reassign owners", await p.getByRole("menuitem", { name: "Reassign owner" }).isVisible());
await go(p, "/admin?role=sales");
check("permissions: Administration denied to Sales", (await p.getByRole("region", { name: "Permission denied" }).count()) === 1);
await go(p, "/people?role=employee");
check("People & HR is a link to the live app, not redrawn", (await p.locator('a[href="https://hr-engine-web.vercel.app"]').count()) >= 1);

// ---------- original behaviours ----------
await go(p, "/sales/new?role=sales");
await p.getByRole("button", { name: "Record enquiry" }).click();
check("new enquiry: five required fields enforced", (await p.locator("#form-errors li").count()) === 5);
check("new enquiry: the company-or-contact rule is explained", (await text(p)).includes("One is enough") && (await p.getByRole("group", { name: /Who is it from/ }).count()) === 1);
await p.fill("#e-contact", "Hana Verma");
await p.getByRole("button", { name: "Record enquiry" }).click();
check("new enquiry: a contact name alone satisfies the rule", !(await p.locator("#form-errors").innerText()).includes("One is enough"));
await p.fill("#e-contact", "");
await p.fill("#e-party", "Northwind");
check("new enquiry: duplicate warning", await p.getByRole("region", { name: "Possible duplicate" }).isVisible());
await go(p, "/sales/pipeline?role=sales");
check("pipeline: cards show install date and location", (await text(p)).includes("Install 3 Nov") && (await text(p)).includes("Abu Dhabi"));
await go(p, "/sales/opportunities/OPP-2026-0041/close?role=sales");
await p.getByRole("button", { name: "Confirm as won" }).click();
check("won: evidence needed", (await p.locator("[role=alert] li").count()) === 2);
await go(p, "/guide?role=sales");
check("guide page explains sample time and words", (await text(p)).includes("Mon 19 Oct 2026, 9:30 am · Dubai time") && (await text(p)).includes("Equipment availability confirmed"));
await go(p, "/my-day?role=employee");
await p.getByRole("button", { name: /Clocked in/ }).first().click();
await p.getByRole("button", { name: "Clock out" }).click();
check("clock: header chip toggles (preview only)", await p.getByRole("button", { name: /Not clocked in/ }).first().isVisible());

// ---------- mobile ----------
const m = await fresh({ width: 390, height: 844 });
const labelsOf = async () => (await m.locator('nav[aria-label="Primary"] > *').allInnerTexts()).map((s) => s.replace(/\s*\(no access\)/, "").trim());
for (const r of ["founder", "sales", "pm", "head", "employee"]) {
  await m.goto(`${B}/my-day?role=${r}`, { waitUntil: "networkidle" });
  check(`mobile nav: same five tabs for ${r}`, JSON.stringify(await labelsOf()) === JSON.stringify(["My Day", "Sales", "Clock", "People", "More"]), JSON.stringify(await labelsOf()));
}
await m.goto(`${B}/my-day?role=pm`, { waitUntil: "networkidle" });
check("mobile nav: unavailable Sales is marked, not removed", (await m.locator('nav[aria-label="Primary"]').innerText()).includes("Sales") && (await m.locator('nav[aria-label="Primary"] .sr-only', { hasText: "no access" }).count()) === 1);
await m.getByRole("button", { name: "Clock", exact: true }).click();
check("mobile: Clock opens the preview clock, no navigation", (await m.getByRole("dialog", { name: "Attendance clock (preview)" }).isVisible()) && m.url().includes("/my-day"));
await m.getByRole("dialog").getByRole("button", { name: "Close" }).click();
await m.getByRole("button", { name: "More", exact: true }).click();
check("mobile: More holds the role's other destinations", (await m.getByRole("dialog", { name: "ENGINIOUS OS menu" }).innerText()).includes("Projects & Tasks"));
await m.keyboard.press("Escape");
await m.goto(`${B}/sales/opportunities/OPP-2026-0055?role=lena`.replace("lena", "sales"), { waitUntil: "networkidle" });
check("mobile: tabs can be reached with visible scroll controls", (await m.getByRole("button", { name: "Scroll sections right" }).count()) === 1);
await m.getByRole("button", { name: "Scroll sections right" }).click();
await m.waitForTimeout(500);
check("mobile: scrolling the tabs reveals the last tab", await m.getByRole("tab", { name: "History" }).isVisible());
for (const w of [320, 360, 390]) {
  const s = await fresh({ width: w, height: 740 });
  for (const path of ["/my-day?role=founder", "/my-day?role=head", "/sales?role=founder", "/sales/opportunities?role=sales", "/sales/opportunities/OPP-2026-0055?role=sales", "/sales/opportunities/OPP-2026-0041?role=sales&tab=scope", "/sales/opportunities/OPP-2026-0041?role=sales&tab=proposals", "/sales/follow-ups?role=sales", "/sales/clients?role=sales", "/sales/new?role=sales", "/sales/settings?role=founder", "/projects?role=founder", "/admin?role=founder", "/sales/pipeline?role=sales", "/states?role=sales", "/guide?role=sales", "/approvals?role=founder", "/sales/reports?role=founder", "/inventory?role=founder", "/vendors?role=founder", "/performance?role=founder", "/reports?role=founder", "/people?role=founder", "/my-day?role=pm", "/my-day?role=employee"]) {
    await s.goto(`${B}${path}`, { waitUntil: "networkidle" });
    const o = await s.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`mobile ${w}px: no page overflow ${path}`, o <= 1, `overflow ${o}px`);
  }
  await s.context().close();
}
// contact cards keep every button and line inside the card, desktop and narrow phones
for (const [w, h] of [[1440, 900], [390, 844], [320, 740]]) {
  const c = await fresh({ width: w, height: h });
  for (const path of ["/sales/opportunities/OPP-2026-0041?role=sales", "/sales/clients?role=sales", "/sales/opportunities/OPP-2026-0047/handover?role=sales"]) {
    await c.goto(`${B}${path}`, { waitUntil: "networkidle" });
    const out = await c.evaluate(() => {
      const cards = [...document.querySelectorAll("main div")].filter((d) => d.className.toString().includes("rounded-lg") && d.querySelector("button") && /Copy (number|email)/.test(d.innerText) && !d.querySelector("div.rounded-lg"));
      return { n: cards.length, bad: cards.flatMap((card) => { const r = card.getBoundingClientRect(); return [...card.querySelectorAll("a,button,p,dd")].filter((e) => e.getBoundingClientRect().right > r.right + 0.5).map((e) => e.innerText.slice(0, 20)); }) };
    });
    check(`contact cards fit inside their card at ${w}px on ${path.split("?")[0].split("/").pop()}`, out.n > 0 && out.bad.length === 0, JSON.stringify(out));
  }
  await c.context().close();
}

// bottom nav never covers the last action
for (const path of ["/sales/opportunities?role=sales", "/sales/follow-ups?role=sales", "/sales/new?role=sales", "/sales/settings?role=founder", "/my-day?role=founder", "/sales/opportunities/OPP-2026-0041?role=sales&tab=proposals"]) {
  await m.goto(`${B}${path}`, { waitUntil: "networkidle" });
  await m.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await m.waitForTimeout(150);
  const gap = await m.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Primary"]').getBoundingClientRect().top;
    const main = document.getElementById("main-content");
    const els = [...main.querySelectorAll("a,button,input,select,textarea,summary,p,li,td,th,dt,dd")].filter((e) => e.getBoundingClientRect().height > 0 && !(e.closest("details:not([open])") && e.tagName !== "SUMMARY" && !e.closest("summary")));
    const bottom = Math.max(...els.map((e) => e.getBoundingClientRect().bottom));
    return nav - bottom;
  });
  check(`mobile: bottom nav does not cover content on ${path}`, gap >= 0, `gap ${Math.round(gap)}px`);
}

// ---------- focus is not confused with selected ----------
const f = await fresh();
await f.goto(`${B}/sales?role=sales`, { waitUntil: "networkidle" });
const selected = f.locator('nav[aria-label="Modules"] a[aria-current="page"]').first();
const weight = await selected.evaluate((e) => getComputedStyle(e).fontWeight);
check("selected nav item is bold with a marker bar (not colour alone)", Number(weight) >= 600 && (await selected.locator("span[aria-hidden]").count()) >= 1);
await f.keyboard.press("Tab"); for (let i = 0; i < 4; i++) await f.keyboard.press("Tab");
const focusedStyle = await f.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { tag: e.tagName, shadow: s.boxShadow, outline: s.outlineStyle }; });
check("keyboard focus shows a visible ring", focusedStyle.shadow !== "none" || focusedStyle.outline !== "none", JSON.stringify(focusedStyle));

// ---------- nothing written, nothing sent ----------
const bad = requests.filter(([method, url]) => (method !== "GET" && method !== "HEAD") || !/^(http:\/\/localhost:3100|data:|blob:)/.test(url));
check("no prototype action wrote data or called an external host", bad.length === 0, JSON.stringify(bad.slice(0, 5)));

for (const r of results) console.log(r.join(" | "));
console.log("FAILS:", results.filter((r) => r[0] === "FAIL").length, "of", results.length);
await browser.close();
