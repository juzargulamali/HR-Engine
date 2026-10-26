import { chromium, BASE, psql } from "./lib.mjs";
const oppId = psql("select id from crm_opportunities order by created_at desc limit 1");
let fails = 0; const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const PERSONAS = { founder: "ceo@e2e.local", sales: "mgr@e2e.local", nosales: "lead@e2e.local" };
const browser = await chromium.launch();
async function session(email, vp, theme = "dark") {
  const ctx = await browser.newContext({ viewport: vp }); await ctx.addInitScript((t) => { try { if (!localStorage.getItem("theme")) localStorage.setItem("theme", t); } catch {} }, theme);
  const page = await ctx.newPage(); await page.goto(`${BASE}/login`); await page.getByLabel(/email/i).fill(email); await page.getByLabel(/password/i).first().fill("local-stack-password");
  await page.getByRole("button", { name: /sign in|log in/i }).click(); await page.waitForURL((u) => !u.pathname.startsWith("/login")); return { ctx, page };
}
const sidebarLinks = (page) => page.locator("aside[aria-label='ENGINIOUS OS modules'] a").evaluateAll((as) => as.map((a) => a.textContent.trim()));
const sideText = (page) => page.locator("aside[aria-label='ENGINIOUS OS modules']").innerText();

for (const [name, email] of Object.entries(PERSONAS)) {
  console.log(`\n=== ${name} (${email}) desktop`);
  const { ctx, page } = await session(email, { width: 1440, height: 900 });
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" }); // open the Sales module so its sub-links render
  const t = await sideText(page); const links = await sidebarLinks(page);
  const hasSales = links.includes("Sales & CRM");
  ok(name === "nosales" ? !hasSales : hasSales, `Sales & CRM in nav is ${hasSales} (expected ${name !== "nosales"})`);
  if (name === "nosales") { ok(/You do not have Sales access/i.test(await page.locator("main").innerText()), "direct /sales shows the no-access message, no data"); }
  if (name === "sales") ok(!links.includes("Settings") && !links.includes("Access"), "Sales user without capabilities sees neither Settings nor Access");
  if (name === "founder") ok(links.includes("Settings") && links.includes("Access"), "founder sees Settings and Access");
  // Inventory is a working module now (its own grants; a Project Manager sees it; every employee at least "My equipment"): every persona here is an employee, so it is never "Coming soon" for them.
  // (Changed on purpose when Inventory shipped. Per-person Inventory menus are covered by inventory-flow-5-access.mjs.) Vendors & Purchasing is still planned.
  ok(links.includes("Inventory") && !/Inventory\s*\n?\s*Coming soon/.test(t), "Inventory is a working module (not Coming soon) for an employee");
  ok(/Vendors & Purchasing\s*\n?\s*Coming soon/.test(t), "Vendors & Purchasing is shown as Coming soon");
  // Projects & Tasks is a real module now: only people with Projects access (or a Sales link) see it; nobody sees it as "coming soon".
  ok(!/Projects & Tasks\s*\n?\s*Coming soon/.test(t), "Projects & Tasks is no longer shown as Coming soon");
  await page.goto(`${BASE}/performance`, { waitUntil: "networkidle" });
  const t2 = await sideText(page); ok(/Performance reviews \(HR\)/.test(t2) && /KPIs\s*\n?\s*Coming soon/.test(t2), "KPIs & Performance: HR reviews live, KPIs Coming soon");
  // no fictional/preview artefacts anywhere on the dashboard
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" }); const body = await page.locator("body").innerText();
  ok(!/design preview|fictional|sample data|preview as|sample identity|nothing is saved/i.test(body), "no preview / fictional / role-switch text on My Day");
  ok((await page.title()) === "My Day · ENGINIOUS OS", `browser title is "${await page.title()}"`);
  await page.goto(`${BASE}/leave`, { waitUntil: "networkidle" }); ok((await page.title()) === "Leave · ENGINIOUS OS", `leave page title "${await page.title()}"`);
  ok(!/HR Engine/i.test(await page.locator("body").innerText()), "no 'HR Engine' label on the page");
  // /os-preview must still be hidden in this (non-opted-in) run
  const pv = await page.goto(`${BASE}/os-preview/my-day`); ok(pv.status() === 404, `/os-preview is blocked in the production build (HTTP ${pv.status()})`);
  await ctx.close();
}

console.log("\n=== founder mobile (390x844)");
for (const [name, email] of Object.entries(PERSONAS)) {
  const { ctx, page } = await session(email, { width: 390, height: 844 });
  const tabs = await page.locator("nav[aria-label='Primary'] a, nav[aria-label='Primary'] button").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  console.log(`  ${name} bottom bar: ${tabs.join(" | ")}`);
  ok(name === "nosales" ? !tabs.includes("Sales") : tabs.includes("Sales"), `${name}: Sales tab ${name === "nosales" ? "absent" : "present"}`);
  for (const p of ["/", "/sales", "/sales/new", `/sales/opportunities/${oppId}`, "/attendance-clock", "/leave/new", "/employees"]) {
    if (name === "nosales" && p.startsWith("/sales")) continue;
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    const m = await page.evaluate(() => {
      const sw = document.documentElement.scrollWidth, iw = window.innerWidth;
      window.scrollTo(0, document.body.scrollHeight);
      const nav = document.querySelector("nav[aria-label='Primary']").getBoundingClientRect();
      const els = [...document.querySelectorAll("main a, main button, main input, main select, main textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest("[inert]"); });
      const lowest = els.reduce((a, e) => Math.max(a, e.getBoundingClientRect().bottom), 0);
      const mainBottom = document.querySelector("main").getBoundingClientRect().bottom;
      return { hOverflow: sw > iw + 1, lowest: Math.round(lowest), navTop: Math.round(nav.top), mainBottom: Math.round(mainBottom), navH: Math.round(nav.height) };
    });
    ok(!m.hOverflow, `${name} ${p.slice(0, 28)}: no horizontal page scroll`);
    ok(m.lowest <= m.navTop - 4, `${name} ${p.slice(0, 28)}: last control (${m.lowest}px) clear of bottom bar (top ${m.navTop}px)`);
  }
  if (name === "founder") {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "More" }).click(); await page.waitForTimeout(350);
    const dlg = page.getByRole("dialog", { name: /ENGINIOUS OS menu/ }); ok(await dlg.isVisible(), "More opens the menu drawer");
    ok(await dlg.getByRole("link", { name: "People & HR" }).isVisible(), "drawer lists modules");
    await page.keyboard.press("Escape"); await page.waitForTimeout(350); ok(!(await dlg.isVisible()), "Escape closes the drawer");
    await page.getByRole("link", { name: /^Clock|Clocked in/ }).first().click(); await page.waitForURL(/attendance-clock/); ok(true, "Clock tab opens the real attendance clock page");
    await page.getByRole("button", { name: /clock in|clock out/i }).first().waitFor({ timeout: 10000 }).catch(() => {});
    ok(await page.getByRole("button", { name: /clock in|clock out/i }).first().isVisible().catch(() => false), "real Clock In/Out control is visible on that page (mobile)");
  }
  await ctx.close();
}

console.log("\n=== simplified Sales menu: Follow-ups, Enquiries, Reports; Manage only for the authorised; secondary pages by link and by search");
{
  const hasAll = (links, want) => want.every((w) => links.includes(w));
  const none = (links, bad) => bad.every((b) => !links.includes(b));
  const SECONDARY = ["Pipeline", "Pipeline board", "New enquiry", "Clients & contacts", "Proposals & quotes"];
  for (const [name, email, manage] of [["founder", PERSONAS.founder, true], ["sales", PERSONAS.sales, false]]) {
    const { ctx, page } = await session(email, { width: 1440, height: 900 });
    await page.goto(`${BASE}/sales/follow-ups`, { waitUntil: "networkidle" }); const links = await sidebarLinks(page); const t = await sideText(page);
    ok(hasAll(links, ["Follow-ups", "Enquiries", "Reports"]), `${name}: Sales menu lists Follow-ups, Enquiries, Reports`);
    ok(none(links, SECONDARY), `${name}: secondary pages (${SECONDARY.join(", ")}) are not menu items`);
    ok(manage ? hasAll(links, ["Settings", "Access"]) && /Manage/i.test(t) : none(links, ["Settings", "Access"]) && !/Manage/i.test(t.split("People & HR")[0]), `${name}: Manage menu (Settings, Access) ${manage ? "shown" : "absent"}`);
    ok((await sidebarLinks(page)).filter((l) => l === "Follow-ups").length === 1, `${name}: Follow-ups is marked once`);
    { const cur = await page.locator("aside[aria-label='ENGINIOUS OS modules'] a[aria-current='page']").allInnerTexts(); ok(cur.length === 1 && /Follow-ups/.test(cur[0]), `${name}: exactly one menu link is marked as the current page (${cur.map((c) => c.trim()).join(" | ")})`); }
    await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" }); ok(/\/sales\/follow-ups$/.test(page.url()), `${name}: /sales opens Follow-ups (${new URL(page.url()).pathname})`);
    for (const [path, expect] of [["/sales/pipeline", /\/sales\/opportunities\?.*view=board/], ["/sales/clients", /\/sales\/clients$/], ["/sales/proposals", /\/sales\/proposals$/], ["/sales/opportunities?add=1", /add=1/]]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); ok(expect.test(page.url()) && !/not found|404/i.test(await page.locator("main").innerText()), `${name}: ${path} still works (lands on ${new URL(page.url()).pathname + new URL(page.url()).search})`);
    }
    ok(await page.getByRole("dialog", { name: /add an enquiry/i }).isVisible(), `${name}: /sales/opportunities?add=1 opens Quick Add`);
    await page.goto(`${BASE}/sales/opportunities`, { waitUntil: "networkidle" }); await page.getByRole("button", { name: /shared lists/i }).click();
    ok((await page.getByRole("menuitem").allInnerTexts()).join("|").includes("Clients & contacts") && (await page.getByRole("menuitem").allInnerTexts()).join("|").includes("Proposals & quotes"), `${name}: Enquiries > Shared lists reaches Clients & contacts and Proposals & quotes`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k"); const pal = page.getByRole("dialog", { name: "Search navigation" }); await pal.waitFor(); await pal.getByRole("textbox").fill("clients");
    ok(/Clients & contacts/.test(await pal.innerText()), `${name}: the search finds Clients & contacts although it is not in the menu`); await pal.getByRole("textbox").fill("pipeline"); ok(/Pipeline/.test(await pal.innerText()), `${name}: the search finds the Pipeline board`);
    await page.keyboard.press("Escape"); await ctx.close();
  }
}

console.log("\n=== simplified Projects menu: My Work, Projects, Calendar; entry page by role; Manage only for the authorised");
{
  const WHO = [
    ["founder (ceo)", "ceo@e2e.local", { entry: "/projects", main: ["My Work", "Projects", "Calendar"], manage: true }],
    ["project manager (mgr; no handover is waiting, so no Handovers entry)", "mgr@e2e.local", { entry: "/projects", main: ["My Work", "Projects", "Calendar"], manage: false }],
    ["department head (lead)", "lead@e2e.local", { entry: "/projects/work", main: ["My Work", "Projects", "Calendar"], manage: false }],
    ["project member who is HR (hr)", "hr@e2e.local", { entry: "/projects/work", main: ["My Work", "Projects", "Calendar"], manage: false }],
    ["Sales owner linked to a project (emp)", "emp@e2e.local", { entry: "/projects", main: ["Projects"], manage: false }],
  ];
  for (const [label, email, want] of WHO) {
    const { ctx, page } = await session(email, { width: 1440, height: 900 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const href = await page.locator("aside[aria-label='ENGINIOUS OS modules'] a", { hasText: /^Projects & Tasks$/ }).first().getAttribute("href");
    ok(href === want.entry, `${label}: the Projects & Tasks module opens ${href} (expected ${want.entry})`);
    await page.locator("aside[aria-label='ENGINIOUS OS modules'] a", { hasText: /^Projects & Tasks$/ }).first().click(); await page.waitForURL((u) => u.pathname === want.entry);
    await page.waitForLoadState("networkidle"); const links = await sidebarLinks(page); const t = await sideText(page);
    ok(want.main.every((l) => links.includes(l)) && (want.main.length === 3 || !links.includes("My Work")), `${label}: menu shows ${want.main.join(", ")}`);
    ok(!links.includes("New internal project"), `${label}: 'New internal project' is a button on Projects, not a menu item`);
    ok(want.manage ? links.includes("Handovers") && /Manage/i.test(t) : !links.includes("Handovers"), `${label}: Manage > Handovers ${want.manage ? "shown" : "absent"}`);
    await ctx.close();
  }
  const { ctx, page } = await session("admin@e2e.local", { width: 1440, height: 900 }); await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  ok((await sidebarLinks(page)).every((l) => !/Projects & Tasks/.test(l)), "admin@ (no Projects access): the module is absent from the menu"); await ctx.close();
}

console.log("\n=== header user menu: mouse and keyboard");
{
  const { ctx, page } = await session(PERSONAS.founder, { width: 1440, height: 900 });
  await page.goto(`${BASE}/sales/follow-ups`, { waitUntil: "networkidle" });
  const trigger = page.locator("aside[aria-label='ENGINIOUS OS modules'] button[aria-expanded]").last(); const item = page.getByRole("menuitem", { name: /account & security/i });
  const shut = () => page.locator("aside[aria-label='ENGINIOUS OS modules'] [role=menu]").last().evaluate((m) => m.hasAttribute("inert"));
  ok(await trigger.getAttribute("aria-expanded") === "false" && (await shut()), "closed: the menu is inert (its items cannot be reached by keyboard or screen reader)");
  await trigger.click(); await item.waitFor(); ok(await trigger.getAttribute("aria-expanded") === "true", "a click opens the user menu");
  await page.keyboard.press("Escape"); await page.waitForTimeout(250); ok(await trigger.getAttribute("aria-expanded") === "false" && (await shut()), "Escape closes it again");
  await trigger.click(); await item.waitFor(); await page.mouse.click(700, 400); await page.waitForTimeout(250); ok(await trigger.getAttribute("aria-expanded") === "false", "a click elsewhere closes it");
  await trigger.focus(); await page.keyboard.press("Enter"); await item.waitFor(); ok(await trigger.getAttribute("aria-expanded") === "true", "Enter on the focused button opens it");
  await page.keyboard.press("Tab"); ok(await page.evaluate(() => document.activeElement?.textContent?.includes("Account & security") === true), "Tab moves into the menu (Account & security first)");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); const last = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""); ok(/sign out/i.test(last) || /light|dark|theme/i.test(last), `Tab reaches the rest of the menu (${last})`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(250); ok(await trigger.getAttribute("aria-expanded") === "false", "Escape closes the keyboard-opened menu");
  await trigger.click(); await item.click(); await page.waitForURL(/account\/security/); ok(true, "Account & security opens from the menu");
  await ctx.close();
}

console.log("\n=== keyboard, focus and theme persistence (founder)");
{
  const { ctx, page } = await session(PERSONAS.founder, { width: 1440, height: 900 }, "dark");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.keyboard.press("Tab"); const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
  ok(/skip to main content/i.test(first ?? ""), `first Tab stop is "${first}"`);
  await page.keyboard.press("Enter"); await page.waitForTimeout(100); ok(await page.evaluate(() => document.activeElement?.id === "main-content"), "skip link moves focus to main content");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const stops = []; let focusBad = 0;
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { label: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 30), outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2, ring: cs.boxShadow !== "none", visible: r.width > 0 && r.top >= 0 }; });
    stops.push(s.label); if (!(s.outline || s.ring)) { focusBad++; console.log("   no focus indicator on:", s.label); }
  }
  console.log("   tab order:", stops.join(" → "));
  ok(focusBad === 0, "every one of 18 keyboard stops shows a focus ring");
  // theme persists across reload and navigation
  await page.getByRole("button", { name: /light|dark/i }).first().click().catch(() => {});
  const th1 = await page.evaluate(() => document.documentElement.getAttribute("data-theme")); await page.reload({ waitUntil: "networkidle" });
  const th2 = await page.evaluate(() => document.documentElement.getAttribute("data-theme")); const stored = await page.evaluate(() => localStorage.getItem("theme"));
  ok(th1 === th2 && stored === (th2 === "light" ? "light" : "dark"), `theme choice (${th1 ?? "dark"}) survives a reload; stored key = ${stored}`);
  await ctx.close();
}

console.log("\n=== clock chip reflects a real open session (local database only)");
{
  const empId = psql("select e.id from employees e join profiles p on p.id = e.user_id where p.email = 'ceo@e2e.local' limit 1") || psql("select employee_id from profiles where email='ceo@e2e.local'");
  if (!empId) console.log("   (skipped: no employee row for ceo)");
  else {
    psql(`insert into attendance_sessions (employee_id, clock_in_at, status) values ('${empId}', now() - interval '95 minutes', 'open') on conflict do nothing`);
    const { ctx, page } = await session(PERSONAS.founder, { width: 1440, height: 900 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const chip = await page.getByRole("link", { name: /Attendance: / }).first().innerText(); ok(/Clocked in · 1h 3\dm|Clocked in · 1h 4\dm|Clocked in · 1h 3\dm/.test(chip) || /Clocked in · 1h/.test(chip), `chip says "${chip}"`);
    ok(/clocked in for 1 hour/i.test(await page.getByRole("link", { name: /Attendance: / }).first().getAttribute("aria-label")), "chip has a spoken label");
    await ctx.close(); psql(`delete from attendance_sessions where employee_id = '${empId}' and status = 'open'`);
  }
}
await browser.close(); console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : fails + " CHECK(S) FAILED"}`); process.exit(fails ? 1 : 0);
