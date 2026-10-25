// Real-browser check of the Stage 4-7 interaction rules across modules (LOCAL STACK ONLY; read-only; needs the sample scenario + inventory, e.g.
// `seed/inventory.sh`, which also builds the Won enquiry; the open enquiries come from `seed/scenario.sh`, so run the scenario first and then
// `seed/inventory.sh` only if you need stock). Covers: rows and cards open their record from the empty part (Sales, Inventory, People & HR,
// desktop and phone); controls inside a row do only their own job; the title stays a real link; Ctrl-click opens a new tab; coming back from a
// record keeps the filters and the place in the list; status words carry a colour cue; stacked phone tables carry their labels; no-access,
// not-found and permission pages use the shared cards.
import { chromium, newPage, login, BASE, psql } from "./lib.mjs";
const browser = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const edge = { position: { x: 3, y: 3 } };
const path = (page) => new URL(page.url()).pathname + new URL(page.url()).search;
const waitPath = (page, re) => page.waitForURL((u) => re.test(u.pathname + u.search), { timeout: 10000 }).then(() => true, () => false);
const settle = (page) => page.waitForLoadState("networkidle").catch(() => {});

async function sales() {
  const page = await newPage(browser, { width: 1440, height: 900 }); await login(page, "ceo@e2e.local");
  await page.goto(`${BASE}/sales/opportunities`, { waitUntil: "networkidle" });
  const rows = page.locator("main tbody tr[data-clickable]");
  ok((await rows.count()) >= 4, `Enquiries: ${await rows.count()} rows are clickable`);
  const title = rows.first().locator("a[href*='open=']").first();
  ok(((await title.getAttribute("href")) ?? "").includes("open="), "Enquiries: the title is still a real link to the panel");
  await rows.first().locator("td").nth(2).click(edge); ok(await waitPath(page, /open=/), "Enquiries: clicking the empty part of a row opens its side panel");
  ok((await page.locator("aside[role=dialog]").count()) === 1 && (await rows.first().getAttribute("data-selected")) === "true", "Enquiries: the panel is open and its row is marked selected");
  const [tab] = await Promise.all([page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null), rows.nth(1).locator("td").nth(2).click({ ...edge, modifiers: ["Control"] })]);
  ok(!!tab && /open=/.test(tab.url()), "Enquiries: Ctrl-click opens the record in a new tab"); if (tab) await tab.close();
  // a status colour cue on the stage words
  await page.goto(`${BASE}/sales/opportunities`, { waitUntil: "networkidle" });
  const tones = await page.locator("main tbody tr[data-clickable] .os-badge").evaluateAll((els) => els.map((e) => `${e.textContent.trim()}:${e.getAttribute("data-tone")}`));
  ok(tones.some((t) => /New enquiry:neutral/.test(t)) && tones.some((t) => /Qualified:cyan/.test(t)) && tones.some((t) => /Proposal preparation:blue/.test(t)), `Enquiries: stage words carry a tone (${tones.join(", ")})`);
  // board: the card body opens the panel, the Move to control does not
  await page.goto(`${BASE}/sales/opportunities?view=board`, { waitUntil: "networkidle" });
  const card = page.locator("li[data-clickable]").first(); await card.locator("select").click({ force: true }).catch(() => {}); await page.waitForTimeout(300);
  ok(!/open=/.test(path(page)), "Board: using the Move to control does not open the card"); await page.keyboard.press("Escape");
  await card.click({ position: { x: 4, y: 4 } }); ok(await waitPath(page, /open=/), "Board: clicking the empty part of a card opens its panel");
  ok((await page.locator("[data-board-col]").count()) >= 6, "Board: lanes carry a coloured top edge attribute");
  // follow-ups (Everyone): a row opens the panel, its own buttons do not
  await page.goto(`${BASE}/sales/follow-ups?who=all`, { waitUntil: "networkidle" });
  const frow = page.locator("main tbody tr[data-clickable]").first();
  if ((await frow.count()) === 0) ok(false, "Follow-ups: no row to test"); else {
    const btn = frow.getByRole("button").first();
    if ((await btn.count()) > 0) { await btn.click(); await page.waitForTimeout(400); ok(!/open=/.test(path(page)), "Follow-ups: a button inside the row does only its own job"); await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
    await frow.locator("td").first().click(edge); ok(await waitPath(page, /open=/), "Follow-ups: clicking the empty part of a row opens the enquiry panel");
  }
  // record page: back link goes to the list as it was left
  await page.goto(`${BASE}/sales/opportunities?stage=qualified`, { waitUntil: "networkidle" });
  const oppId = psql("select id from crm_opportunities where stage='qualified' limit 1");
  await page.goto(`${BASE}/sales/opportunities/${oppId}`, { waitUntil: "networkidle" });
  const back = page.locator("main").getByRole("link", { name: /^\s*Enquiries/ }).first(); await page.waitForTimeout(300);
  ok(((await back.getAttribute("href")) ?? "") === "/sales/opportunities?stage=qualified", `Record: the back link returns to the filtered list (${await back.getAttribute("href")})`);
  await back.click(); ok(await waitPath(page, /stage=qualified/), "Record: following it shows the same filter again");
  await page.locator("main tbody tr[data-clickable]", { hasText: "Atrium LED wall" }).first().waitFor({ timeout: 8000 }).catch(() => {});
  ok((await page.locator("main tbody tr[data-clickable]").count()) === 1 && (await page.locator("main").innerText()).includes("Atrium LED wall"), "Record: and the same rows (only the qualified enquiry)");
  // no sideways scroll on the record page
  await page.goto(`${BASE}/sales/opportunities/${oppId}`, { waitUntil: "networkidle" });
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "Record: no sideways scroll at 1440 px");
  await page.context().close();
}

async function inventory() {
  const page = await newPage(browser, { width: 1440, height: 900 }); await login(page, "ceo@e2e.local");
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  const rows = page.locator("main tbody tr[data-clickable]");
  ok((await rows.count()) >= 5, `Inventory: ${await rows.count()} item rows are clickable`);
  await rows.nth(1).locator("td").nth(2).click(edge); ok(await waitPath(page, /open=/), "Inventory: clicking the empty part of an item row opens its panel");
  await page.goto(`${BASE}/inventory/requests`, { waitUntil: "networkidle" });
  const rr = page.locator("main tbody tr[data-clickable]").first();
  if ((await rr.count()) === 0) ok(false, "Inventory requests: no row to test"); else { await rr.locator("td").nth(3).click(edge); ok(await waitPath(page, /open=/), "Inventory requests: clicking a row opens the request"); }
  await page.goto(`${BASE}/inventory/movements`, { waitUntil: "networkidle" });
  const mr = page.locator("main tbody tr[data-clickable]").first();
  if ((await mr.count()) > 0) { await mr.locator("td").nth(4).click(edge); ok(await waitPath(page, /open=/), "Inventory movements: clicking a row opens the entry"); } else console.log("  (no movements in this data)");
  await page.context().close();
  // My equipment: summary cards are figures, not links
  const emp = await newPage(browser, { width: 1440, height: 800 }); await login(emp, "emp@e2e.local");
  await emp.goto(`${BASE}/inventory/mine`, { waitUntil: "networkidle" });
  const t = await emp.locator("main").innerText(); ok(/Equipment assigned to me/.test(t), "My equipment renders");
  ok((await emp.locator("main a.os-stat").count()) === 0, "My equipment: summary figures are not fake links");
  await emp.context().close();
}

async function people() {
  const page = await newPage(browser, { width: 1440, height: 420 }); await login(page, "ceo@e2e.local");
  await page.goto(`${BASE}/employees?status=active`, { waitUntil: "networkidle" });
  const rows = page.locator("main tbody tr[data-clickable]");
  ok((await rows.count()) >= 5, `Employees: ${await rows.count()} rows are clickable`);
  const tones = await page.locator("main tbody .os-badge").evaluateAll((els) => els.map((e) => e.getAttribute("data-tone")));
  ok(tones.length > 0 && tones.every((x) => x === "green"), "Employees: active status carries the green cue");
  // list position: scroll down, open the last employee, come back
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400);
  const y = await page.evaluate(() => window.scrollY); ok(y > 50, `Employees: the list was scrolled (${y})`);
  await rows.last().locator("td").nth(2).click(edge); ok(await waitPath(page, /^\/employees\/[0-9a-f-]{36}/), "Employees: clicking the empty part of a row opens the profile");
  const back = page.locator("main").getByRole("link", { name: /^\s*Employees/ }).first(); await page.waitForTimeout(300);
  ok(((await back.getAttribute("href")) ?? "") === "/employees?status=active", `Profile: the back link keeps the filter (${await back.getAttribute("href")})`);
  await back.click(); ok(await waitPath(page, /^\/employees\?status=active/), "Profile: Back to Employees returns to the filtered list");
  await page.waitForTimeout(1200); const y2 = await page.evaluate(() => window.scrollY); ok(Math.abs(y2 - y) < 60, `Employees: the place in the list is restored (${y} -> ${y2})`);
  // search chip behaviour: the list toolbar applies at once and keeps the address
  await page.goto(`${BASE}/employees`, { waitUntil: "networkidle" }); await page.getByLabel("Search employees").fill("Eve"); await page.waitForURL((u) => u.searchParams.get("q") === "Eve", { timeout: 8000 }).catch(() => {});
  ok((await page.locator("main tbody tr[data-clickable]").count()) === 1, "Employees: search applies as it is typed");
  await page.context().close();
  // phone: stacked cards open from their empty part and carry labels
  const ph = await newPage(browser, { width: 390, height: 844 }); await login(ph, "ceo@e2e.local");
  await ph.goto(`${BASE}/employees`, { waitUntil: "networkidle" }); await ph.waitForTimeout(400);
  const card = ph.locator("main tbody tr[data-clickable]").first();
  ok((await card.evaluate((e) => getComputedStyle(e).display)) === "block", "Phone: an employee row is a card");
  const labels = await card.locator("td[data-label]").evaluateAll((els) => els.map((e) => e.getAttribute("data-label")));
  ok(labels.join("|") === "Job title|Company|Status", `Phone: card cells carry their column names (${labels.join("|")})`);
  ok(!(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "Phone: no sideways scroll on Employees");
  await card.locator("td").first().click({ position: { x: 3, y: 3 } }); ok(await waitPath(ph, /^\/employees\/[0-9a-f-]{36}/), "Phone: tapping the empty part of a card opens the profile");
  await ph.context().close();
  // policies rows open the policy
  const pol = await newPage(browser, { width: 1440, height: 900 }); await login(pol, "ceo@e2e.local");
  await pol.goto(`${BASE}/policies`, { waitUntil: "networkidle" });
  const pr = pol.locator("main tbody tr[data-clickable]").first();
  if ((await pr.count()) > 0) { await pr.locator("td").nth(2).click(edge); ok(await waitPath(pol, /^\/policies\/[0-9a-f-]{36}/), "Policies: clicking a row opens the policy"); const b = pol.getByRole("link", { name: /Back to policies/ }); ok((await b.count()) === 1, "Policies: the record has a back link"); }
  await pol.context().close();
}

async function states() {
  const adm = await newPage(browser, { width: 1440, height: 800 }); await login(adm, "admin@e2e.local");
  await adm.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  ok(/You do not have Sales access/.test(await adm.locator("main").innerText()) && (await adm.locator("main .os-card[role=status]").count()) === 1, "No Sales access: the shared no-access card");
  await adm.context().close();
  const ceo = await newPage(browser, { width: 1440, height: 800 }); await login(ceo, "emp@e2e.local");
  await ceo.goto(`${BASE}/audit-log`, { waitUntil: "networkidle" });
  ok(/restricted to HR Admin/.test(await ceo.locator("main").innerText()) && (await ceo.locator("main .os-card[role=status]").count()) === 1, "Audit log without the role: the shared no-access card");
  await ceo.goto(`${BASE}/sales/opportunities/00000000-0000-4000-8000-00000000dead`, { waitUntil: "networkidle" });
  await ceo.context().close();
  const founder = await newPage(browser, { width: 1440, height: 800 }); await login(founder, "ceo@e2e.local");
  await founder.goto(`${BASE}/sales/opportunities/00000000-0000-4000-8000-00000000dead`, { waitUntil: "networkidle" });
  const txt = await founder.locator("main").innerText();
  ok(/couldn.t find that|not found/i.test(txt) && (await founder.locator("#main-content").count()) === 1, "A record that does not exist: a calm not-found card inside the shell");
  await founder.context().close();
}

await sales(); await inventory(); await people(); await states();
await browser.close();
console.log(fails === 0 ? "\nROLLOUT CHECKS PASSED" : `\n${fails} FAILED`); process.exit(fails === 0 ? 0 : 1);
