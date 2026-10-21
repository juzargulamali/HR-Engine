// The simplified Sales workspace (Follow-ups, Enquiries table + board, side panel, Quick Add) in a real browser. LOCAL STACK ONLY.
// Needs the shared sample scenario in the throwaway database (see README: "Sample scenario"): emp@ owns five enquiries, ceo@ is a
// founder, mgr@ a plain Sales user, admin@ has no Sales access. The script writes to the database it drives (it completes follow-ups,
// moves and closes enquiries), so reseed before every run.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const browser = await chromium.launch();
let fails = 0; let page;
const step = async (name, fn) => {
  try { await fn(); console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `${SHOTS}/wfail-${name.replace(/\W+/g, "_").slice(0, 60)}.png`, fullPage: true }).catch(() => {});
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 12000) { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(150); } throw new Error(`timed out waiting for ${what}`); }
const idOf = (title) => sql(`select id from crm_opportunities where title like '${title}%'`);
const stageOf = (title) => sql(`select stage from crm_opportunities where title like '${title}%'`);
const T = { atrium: "Atrium LED wall", hotel: "Hotel lobby mirror", museum: "Museum interactive table", roadshow: "Roadshow immersive room", won: "Floor projection for the Orbit launch" };
for (const t of Object.values(T)) if (sql(`select count(*) from crm_opportunities where title like '${t}%'`) !== "1") throw new Error(`the sample scenario is not loaded (missing "${t}")`);
// A follow-up due late today (Dubai), so "Today" does not depend on the time of day the script runs.
sql(`update crm_follow_ups set due_at = date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai' + interval '23 hours 59 minutes' where status='open' and opportunity_id = (select id from crm_opportunities where title like 'Museum%')`);

// Browser dialogs (the unsaved-changes question is a window.confirm): answer as the test says, always leave a page that is closing.
let policy = "accept"; const asked = [];
const watch = (p) => p.on("dialog", async (d) => { if (d.type() === "beforeunload") return d.accept(); asked.push(d.message()); return policy === "accept" ? d.accept() : d.dismiss(); });
const main = async (p = page) => (await p.locator("main").innerText()).replace(/\s+/g, " ");
const panel = (p = page) => p.locator("aside[role=dialog]");
const rowTitles = async (p = page) => (await p.locator("main tbody tr").evaluateAll((trs) => trs.map((r) => r.querySelector("a")?.textContent?.trim() ?? ""))).filter(Boolean);
const goList = async (qs = "", p = page) => { await p.goto(`${BASE}/sales/opportunities${qs}`, { waitUntil: "networkidle" }); await p.getByRole("heading", { name: "Enquiries", level: 1 }).waitFor(); };
const urlParam = (k) => new URL(page.url()).searchParams.get(k);

// ----------------------------------------------------------------------------------------------------------------------------
// Follow-ups (emp@ owns every enquiry of the scenario)
// ----------------------------------------------------------------------------------------------------------------------------
page = await newPage(browser); watch(page); await login(page, "emp@e2e.local");
await step("Sales opens on Follow-ups and groups them Overdue / Today / Upcoming", async () => {
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" }); if (!/\/sales\/follow-ups$/.test(page.url())) throw new Error("landed on " + page.url());
  const sec = async (name) => page.locator("section", { has: page.getByRole("heading", { name: new RegExp(`^${name}`, "i") }) }).first();
  const o = await (await sec("Overdue")).innerText(), t = await (await sec("Today")).innerText(), u = await (await sec("Upcoming")).innerText();
  if (!/Hotel lobby mirror/.test(o) || /Museum|Atrium/.test(o)) throw new Error("overdue group wrong: " + o.slice(0, 120));
  if (!/Museum interactive table/.test(t) || /Hotel|Atrium/.test(t)) throw new Error("today group wrong: " + t.slice(0, 120));
  if (!/Atrium LED wall/.test(u) || !/Roadshow/.test(u) || /Hotel|Museum/.test(u)) throw new Error("upcoming group wrong: " + u.slice(0, 160));
});
await step("Complete follow-up: refused without the next action, then done; the enquiry is NOT marked Won", async () => {
  const row = page.locator("tr", { hasText: "Museum interactive table" }).first();
  await row.getByRole("button", { name: /^Complete follow-up: / }).click();
  const d = page.getByRole("dialog").filter({ hasText: /what happened/i }); await d.waitFor();
  await d.getByLabel(/what happened/i).fill("Confirmed the table size with the museum.");
  await d.getByRole("button", { name: /^complete$/i }).click(); // next action left empty: the form must refuse
  await sleep(700); if (!(await d.isVisible())) throw new Error("dialog closed without a next action");
  if (sql(`select status from crm_follow_ups where title='Confirm the table dimensions'`) !== "open") throw new Error("follow-up completed without a next action");
  await d.getByLabel(/^next action/i).fill("Send the table render"); await d.getByLabel(/^date/i).fill("2026-10-28");
  await d.getByRole("button", { name: /^complete$/i }).click(); await d.waitFor({ state: "hidden", timeout: 12000 });
  const st = sql(`select status || '|' || coalesce(outcome,'') from crm_follow_ups where title='Confirm the table dimensions'`); if (st !== "done|Confirmed the table size with the museum.") throw new Error("completed follow-up not saved: " + st);
  if (stageOf(T.museum) !== "new") throw new Error("stage changed to " + stageOf(T.museum)); if (sql(`select count(*) from crm_closures where opportunity_id='${idOf(T.museum)}'`) !== "0") throw new Error("a closure was recorded");
  if (sql(`select count(*) from crm_follow_ups where opportunity_id='${idOf(T.museum)}' and status='open' and title='Send the table render'`) !== "1") throw new Error("next follow-up missing");
  await until(async () => /Send the table render/.test(await main()), "the new follow-up in the list");
});
await step("Complete follow-up with a hold reason + review date puts the enquiry on hold, never Won", async () => {
  const row = page.locator("tr", { hasText: "Hotel lobby mirror" }).first();
  await row.getByRole("button", { name: /^Complete follow-up: / }).click(); const d = page.getByRole("dialog").filter({ hasText: /what happened/i }); await d.waitFor();
  await d.getByLabel(/what happened/i).fill("Hotel is closed for refurbishment.");
  await d.getByLabel(/put the opportunity on hold/i).check(); await d.getByLabel(/^reason/i).fill("Hotel closed for refurbishment"); await d.getByLabel(/review date/i).fill("2026-12-01");
  await d.getByRole("button", { name: /^complete$/i }).click(); await d.waitFor({ state: "hidden", timeout: 12000 });
  if (stageOf(T.hotel) !== "on_hold") throw new Error("stage is " + stageOf(T.hotel));
  if (sql(`select hold_review_date from crm_opportunities where title like 'Hotel%'`) !== "2026-12-01") throw new Error("review date not saved");
});
await step("Recently completed lists what happened", async () => {
  await page.goto(`${BASE}/sales/follow-ups?view=done`, { waitUntil: "networkidle" });
  const m = await main(); if (!/Confirmed the table size with the museum\./.test(m) || !/Hotel is closed for refurbishment\./.test(m)) throw new Error("outcomes not listed");
});
await step("Everyone / Mine toggle shows the whole team's follow-ups without changing the grouping", async () => {
  await page.goto(`${BASE}/sales/follow-ups?who=all`, { waitUntil: "networkidle" }); const m = await main();
  if (!/Upcoming/.test(m) || !/Atrium LED wall/.test(m)) throw new Error("Everyone view empty");
});
await page.context().close();

// ----------------------------------------------------------------------------------------------------------------------------
// Enquiries table (ceo@ is a founder: sees everything)
// ----------------------------------------------------------------------------------------------------------------------------
page = await newPage(browser, { width: 1280, height: 420 }); watch(page); await login(page, "ceo@e2e.local");
await step("Enquiries opens as a table with the working columns and the open enquiries", async () => {
  await goList();
  const heads = (await page.locator("main thead th").allInnerTexts()).map((t) => t.trim().toLowerCase());
  for (const h of ["enquiry", "agency / client", "owner", "stage", "next action", "due"]) if (!heads.some((x) => x.startsWith(h))) throw new Error(`missing column ${h}; have ${heads.join(" | ")}`);
  if (!heads.some((x) => /install|show/.test(x))) throw new Error("no installation/show date column");
  const t = await rowTitles(); if (t.length !== 4) throw new Error("expected the 4 open enquiries, got " + t.join(", "));
  if (!/4 of 5 enquiries/.test(await main())) throw new Error("count text: " + (await main()).slice(0, 200));
});
await step("search by title, by reference and by agency; no match says so; Clear restores", async () => {
  const q = page.getByRole("searchbox"); await q.fill("museum"); await page.waitForURL((u) => u.searchParams.get("q") === "museum"); await until(async () => (await rowTitles()).length === 1, "one row");
  if ((await rowTitles())[0] !== "Museum interactive table") throw new Error("wrong row");
  const ref = sql("select reference from crm_opportunities where title like 'Roadshow%'"); await q.fill(ref); await until(async () => (await rowTitles()).join() === "Roadshow immersive room", "reference match");
  await q.fill("zeta"); await until(async () => (await rowTitles()).length === 4, "agency match");
  await q.fill("zzzzzz"); await until(async () => /Nothing matches/.test(await main()), "no-match text");
  await page.getByRole("link", { name: /clear filters/i }).first().click(); await until(async () => (await rowTitles()).length === 4 && !urlParam("q"), "cleared");
});
await step("stage, owner and status filters (and a stage the URL invents is ignored)", async () => {
  await page.locator("#lt-stage").selectOption("qualified"); await until(async () => (await rowTitles()).join() === "Atrium LED wall for the mall launch", "stage filter");
  await page.locator("#lt-stage").selectOption(""); await until(async () => (await rowTitles()).length === 4, "stage cleared");
  await page.locator("#lt-owner").selectOption("me"); await until(async () => /Nothing matches/.test(await main()), "ceo owns none");
  await page.locator("#lt-owner").selectOption({ index: 2 }); await until(async () => (await rowTitles()).length === 4, "emp owns the four open ones");
  await page.locator("#lt-status").selectOption("closed"); await until(async () => (await rowTitles()).join() === "Floor projection for the Orbit launch", "won only");
  await page.locator("#lt-status").selectOption("all"); await until(async () => (await rowTitles()).length === 5, "everything");
  await goList("?stage=not_a_stage&owner=not-a-person&status=weird"); if ((await rowTitles()).length !== 4) throw new Error("invented filters were not ignored");
});
await step("header sorting toggles asc/desc with aria-sort; an invented sort key is ignored", async () => {
  await goList("?sort=enquiry"); let t = await rowTitles(); if (t.join() !== [...t].sort().join()) throw new Error("not ascending: " + t.join(" | "));
  if ((await page.locator("main thead th[aria-sort=ascending]").count()) !== 1) throw new Error("aria-sort not ascending");
  await page.locator("main thead").getByRole("link", { name: /^Enquiry/ }).click(); await page.waitForURL((u) => u.searchParams.get("sort") === "enquiry:desc");
  await until(async () => { const x = await rowTitles(); return x.join() === [...x].sort().reverse().join(); }, "descending");
  await goList("?sort=%27%3Bdrop%20table&q="); if ((await rowTitles()).length !== 4) throw new Error("bogus sort broke the list");
  await goList("?sort=password:desc"); if ((await rowTitles()).length !== 4) throw new Error("bogus sort key broke the list");
});
await step("Columns menu: Value is not in the page until chosen (not hidden in the HTML), shows when chosen, gone when unchosen", async () => {
  await goList("?status=all"); let html = await page.content();
  if (/250,000/.test(html) || /BUDGET-SECRET/.test(html)) throw new Error("value text is in the default page HTML");
  await page.getByRole("button", { name: /columns/i }).click(); await page.getByLabel("Value", { exact: true }).check();
  await page.waitForURL((u) => /value/.test(u.searchParams.get("cols") ?? "")); await until(async () => /250,000/.test(await main()), "value shown");
  await page.getByLabel("Value", { exact: true }).uncheck(); // the menu stays open while columns are chosen
  await until(async () => !/250,000/.test(await main()), "value hidden again"); html = await page.content(); if (/250,000/.test(html)) throw new Error("value text still in the HTML after unchecking");
  await goList("?cols=bogus,value,../x"); if (!/value/i.test(await page.locator("main thead").innerText())) throw new Error("valid column from a mixed list was dropped");
});
await step("Table to Board keeps every record and the filters; Board back to Table", async () => {
  await goList("?status=all&owner=" + sql("select id from auth.users where email='emp@e2e.local'"));
  const tableCount = (await rowTitles()).length;
  await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: /board/i }).click(); await page.waitForURL((u) => u.searchParams.get("view") === "board");
  await until(async () => (await page.locator("main li[draggable]").count()) + (await page.locator("main section ul li").count()) > 0, "cards");
  const cards = await page.locator("main section ul > li").count(); if (cards !== tableCount) throw new Error(`board shows ${cards} cards, table showed ${tableCount}`);
  if (!/owner=/.test(page.url())) throw new Error("filter lost on the switch");
  await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: /table/i }).click(); await until(async () => (await rowTitles()).length === tableCount, "table again");
});

// ----------------------------------------------------------------------------------------------------------------------------
// Side panel
// ----------------------------------------------------------------------------------------------------------------------------
await step("a row opens the record in a side panel with the list kept behind it (filters, scroll)", async () => {
  await goList("?status=all&sort=enquiry"); const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const link = page.locator("main tbody").getByRole("link", { name: "Roadshow immersive room" }); await link.scrollIntoViewIfNeeded(); const before = await page.evaluate(() => window.scrollY); // (a click would scroll it into view itself)
  await link.click();
  await page.waitForURL((u) => u.searchParams.get("open") === idOf(T.roadshow)); await panel().waitFor();
  const p = await panel().innerText(); if (!/Roadshow immersive room/.test(p) || !/next action/i.test(p)) throw new Error("panel content: " + p.slice(0, 200));
  if (urlParam("status") !== "all" || urlParam("sort") !== "enquiry") throw new Error("list state lost from the address");
  if ((await rowTitles()).length !== 5) throw new Error("the list behind the panel changed");
  if (scrollable > 130 && before > 0) { const after = await page.evaluate(() => window.scrollY); if (Math.abs(after - before) > 10) throw new Error(`scroll moved ${before} -> ${after}`); }
});
await step("Back closes the panel and leaves the list as it was; Back again leaves the page normally", async () => {
  await page.goBack(); await panel().waitFor({ state: "detached", timeout: 8000 }); if (urlParam("open")) throw new Error("open still in the address");
  if (urlParam("status") !== "all") throw new Error("filter lost on Back"); if ((await rowTitles()).length !== 5) throw new Error("list lost on Back");
});
await step("the record's own address works directly, shows Full page, and the full page opens", async () => {
  await page.goto(`${BASE}/sales/opportunities?open=${idOf(T.atrium)}`, { waitUntil: "networkidle" }); await panel().waitFor();
  if (!/Atrium LED wall/.test(await panel().innerText())) throw new Error("direct address did not show the record");
  await panel().getByRole("link", { name: /full page/i }).click(); await page.waitForURL(new RegExp(`/sales/opportunities/${idOf(T.atrium)}$`));
  await until(async () => /Atrium LED wall/.test(await main()), "the full page content");
  await page.goBack(); await panel().waitFor();
});
await step("Escape and the close button close the panel; a made-up or foreign open id shows a plain message, not data", async () => {
  await page.keyboard.press("Escape"); await panel().waitFor({ state: "detached" }); if (urlParam("open")) throw new Error("Escape did not remove open");
  await page.goto(`${BASE}/sales/opportunities?open=${idOf(T.atrium)}`, { waitUntil: "networkidle" }); await panel().getByRole("button", { name: /close details/i }).click(); await panel().waitFor({ state: "detached" });
  await page.goto(`${BASE}/sales/opportunities?open=not-an-id`, { waitUntil: "networkidle" }); if ((await panel().count()) !== 0 || (await rowTitles()).length !== 4) throw new Error("a malformed open id should be ignored and the list shown");
  await page.goto(`${BASE}/sales/opportunities?open=00000000-0000-4000-8000-0000000000ff`, { waitUntil: "networkidle" }); if (!/does not exist, or you do not have access/i.test(await panel().innerText())) throw new Error("unknown id message");
});
await step("unsaved edits in the panel: switching rows and Close both ask first; Stay keeps them, Leave discards", async () => {
  await goList("?sort=enquiry"); await page.locator("main tbody").getByRole("link", { name: "Atrium LED wall for the mall launch" }).click(); await panel().waitFor();
  await panel().getByRole("tab", { name: "Commercial" }).click(); await panel().getByLabel(/quote reference/i).fill("QT-UNSAVED"); asked.length = 0;
  policy = "dismiss"; await page.locator("main tbody").getByRole("link", { name: "Museum interactive table" }).click(); await sleep(600);
  if (asked.length !== 1) throw new Error("no unsaved-changes question when switching rows"); if (urlParam("open") !== idOf(T.atrium)) throw new Error("switched although the person chose to stay");
  if ((await panel().getByLabel(/quote reference/i).inputValue()) !== "QT-UNSAVED") throw new Error("typed text lost after staying");
  await panel().getByRole("button", { name: /close details/i }).click(); await sleep(600); if (asked.length !== 2 || !urlParam("open")) throw new Error("Close did not ask / closed anyway");
  policy = "accept"; await page.locator("main tbody").getByRole("link", { name: "Museum interactive table" }).click(); await page.waitForURL((u) => u.searchParams.get("open") === idOf(T.museum)); await panel().waitFor();
  if (asked.length !== 3) throw new Error("agreeing to leave did not go through the question");
  if (sql("select count(*) from crm_zoho_references where quote_ref='QT-UNSAVED'") !== "0") throw new Error("unsaved text was saved");
});
await step("a stale edit is refused (two sessions), the second person keeps what they typed, nothing is overwritten", async () => {
  const id = idOf(T.roadshow); const a = await newPage(browser); watch(a); await login(a, "ceo@e2e.local"); const b = await newPage(browser); watch(b); await login(b, "ceo@e2e.local");
  for (const p of [a, b]) { await p.goto(`${BASE}/sales/opportunities?open=${id}`, { waitUntil: "networkidle" }); await panel(p).waitFor(); await panel(p).getByRole("button", { name: /more actions/i }).click(); await p.getByRole("menuitem", { name: /edit details/i }).click(); await p.getByRole("dialog", { name: /edit/i }).waitFor(); }
  await a.getByLabel("Location").fill("Expo City, Hall A"); await a.getByRole("button", { name: /save changes/i }).click(); await until(() => sql(`select location from crm_opportunities where id='${id}'`) === "Expo City, Hall A", "first save");
  await b.getByLabel("Location").fill("Dubai Festival City"); await b.getByRole("button", { name: /save changes/i }).click();
  await until(async () => /changed by someone else/i.test(await b.getByRole("dialog", { name: /edit/i }).innerText()), "a stale-edit message", 8000);
  if (sql(`select location from crm_opportunities where id='${id}'`) !== "Expo City, Hall A") throw new Error("the first person's edit was overwritten");
  if ((await b.getByLabel("Location").inputValue()) !== "Dubai Festival City") throw new Error("typed value lost after the refusal");
  await a.context().close(); await b.context().close();
});

// ----------------------------------------------------------------------------------------------------------------------------
// Board
// ----------------------------------------------------------------------------------------------------------------------------
const card = (title) => page.locator("main section ul > li", { hasText: title });
const moveTo = async (title, label) => page.getByLabel(`Move ${title} to`).selectOption({ label });
const column = (label) => page.locator("main section", { has: page.getByRole("heading", { name: new RegExp(`^${label}`, "i") }) }).first();
await step("Board: an ordinary move through the 'Move to' control (no drag needed) changes the stage and the column", async () => {
  await goList("?view=board"); await moveTo("Atrium LED wall for the mall launch", "Proposal preparation");
  await until(() => stageOf(T.atrium) === "proposal_prep", "stage saved"); await until(async () => (await column("Proposal preparation").innerText()).includes("Atrium LED wall"), "card in the new column");
  if ((await column("Qualified").innerText()).includes("Atrium LED wall")) throw new Error("card still in the old column");
});
await step("Board: a refused move leaves the card where it was and says why (Quote sent needs the Zoho reference; Proposal sent needs a sent proposal)", async () => {
  await moveTo("Roadshow immersive room", "Quote sent"); await until(async () => /Zoho/i.test(await card("Roadshow immersive room").innerText()), "refusal reason");
  if (stageOf(T.roadshow) !== "proposal_prep" || !(await column("Proposal preparation").innerText()).includes("Roadshow")) throw new Error("card moved although refused");
  await moveTo("Roadshow immersive room", "Proposal sent"); await until(async () => /proposal as sent/i.test(await card("Roadshow immersive room").innerText()), "second refusal"); if (stageOf(T.roadshow) !== "proposal_prep") throw new Error("moved");
});
await step("Board: Won opens the evidence form (nothing moves until it is filled in); Cancel changes nothing", async () => {
  await moveTo("Museum interactive table", "Won"); const d = page.getByRole("dialog").filter({ hasText: /PO number|confirmation/i }); await d.waitFor();
  if (stageOf(T.museum) !== "new") throw new Error("moved before the form"); await d.getByRole("button", { name: /confirm as won/i }).click(); await sleep(600);
  if (!(await d.isVisible()) || stageOf(T.museum) !== "new") throw new Error("Won accepted without evidence"); await d.getByRole("button", { name: /^cancel$/i }).click(); await d.waitFor({ state: "hidden" });
});
await step("Board: Hold needs a reason and a review date; Lost needs a reason; both then move the card", async () => {
  await moveTo("Museum interactive table", "On hold"); let d = page.getByRole("dialog").filter({ hasText: /review date/i }); await d.waitFor();
  await d.getByRole("button", { name: /put on hold/i }).click(); await sleep(600); if (stageOf(T.museum) !== "new") throw new Error("hold accepted without review date");
  const reason = d.getByLabel(/^reason/i); if ((await reason.evaluate((e) => e.tagName)) === "SELECT") await reason.selectOption({ index: 1 }); else await reason.fill("Venue not confirmed");
  await d.getByLabel(/review date/i).fill("2026-12-05"); await d.getByRole("button", { name: /put on hold/i }).click(); await d.waitFor({ state: "hidden", timeout: 12000 });
  await until(() => stageOf(T.museum) === "on_hold", "held"); await until(async () => (await column("On hold").innerText()).includes("Museum interactive table"), "card in On hold");
  await moveTo("Roadshow immersive room", "Lost"); d = page.getByRole("dialog").filter({ hasText: /reason/i }); await d.waitFor();
  const lostBtn = d.getByRole("button", { name: /confirm as lost/i }); await lostBtn.click(); await sleep(600); if (stageOf(T.roadshow) !== "proposal_prep") throw new Error("Lost accepted without a reason");
  const lr = d.getByLabel(/^reason/i); if ((await lr.evaluate((e) => e.tagName)) === "SELECT") await lr.selectOption({ index: 1 }); else await lr.fill("Budget lower than scope");
  await lostBtn.click(); await d.waitFor({ state: "hidden", timeout: 12000 }); await until(() => stageOf(T.roadshow) === "lost", "lost");
  if (!sql(`select lost_reason from crm_opportunities where title like 'Roadshow%'`)) throw new Error("no lost reason stored");
});
await step("Board: closed cards cannot be dragged or moved and say a founder reopens them", async () => {
  await goList("?view=board&status=all"); const c = card("Roadshow immersive room"); if ((await c.getByLabel(/^Move .* to$/).count()) !== 0) throw new Error("a closed card offers a move");
  if (!/reopen/i.test(await c.innerText())) throw new Error("no explanation: " + (await c.innerText()).slice(0, 120));
  if ((await c.getAttribute("draggable")) === "true") throw new Error("a closed card is draggable");
});
await step("Board: the drag path goes through the same request (Atrium back one step by drag)", async () => {
  await page.setViewportSize({ width: 1700, height: 900 }); await goList("?view=board"); await card("Atrium LED wall for the mall launch").dragTo(column("Qualified"));
  await until(() => stageOf(T.atrium) === "qualified", "drag-drop move saved (HTML5 drag)", 8000);
});

// ----------------------------------------------------------------------------------------------------------------------------
// Quick Add
// ----------------------------------------------------------------------------------------------------------------------------
const openQuickAdd = async (url = `${BASE}/sales/opportunities`) => { await page.goto(url, { waitUntil: "networkidle" }); await page.getByRole("button", { name: /^add enquiry$/i }).first().click(); const d = page.getByRole("dialog", { name: /add an enquiry/i }); await d.waitFor(); return d; };
await step("Quick Add: 'one is enough' - no agency and no client is refused in words, and everything typed stays", async () => {
  const d = await openQuickAdd(); const before = sql("select count(*) from crm_opportunities");
  await d.getByLabel("What is the enquiry?").fill("Refusal check enquiry"); await d.getByLabel("Where did it come from?").selectOption("referral"); await d.getByLabel("Next action").fill("Ring the referrer");
  await d.getByText("Add more details").click(); await d.getByLabel("Location").fill("Sharjah Expo"); await d.getByLabel("Brief").fill("Typed before the refusal");
  await d.getByRole("button", { name: /^add enquiry$/i }).click(); await until(async () => (await d.locator("[role=alert]").count()) > 0, "an error message", 8000);
  const msg = await d.locator("[role=alert]").first().innerText(); if (!/agency|client|organisation/i.test(msg)) throw new Error("unclear refusal: " + msg);
  if (sql("select count(*) from crm_opportunities") !== before) throw new Error("an enquiry was created anyway");
  const kept = [await d.getByLabel("What is the enquiry?").inputValue(), await d.getByLabel("Next action").inputValue(), await d.getByLabel("Location").inputValue(), await d.getByLabel("Brief").inputValue()];
  if (kept.join("|") !== "Refusal check enquiry|Ring the referrer|Sharjah Expo|Typed before the refusal") throw new Error("typed values lost: " + kept.join("|"));
  if ((await d.getByLabel("Where did it come from?").inputValue()) !== "referral") throw new Error("source lost");
  await d.getByLabel("Agency", { exact: true }).selectOption({ label: "Zeta Media LLC (Dubai)" });
  await d.getByRole("button", { name: /^add enquiry$/i }).click(); await page.waitForURL(/open=[0-9a-f-]{36}/, { timeout: 15000 });
  if (sql("select count(*) from crm_opportunities where title='Refusal check enquiry'") !== "1") throw new Error("not created after fixing the form");
  if (sql("select location from crm_opportunities where title='Refusal check enquiry'") !== "Sharjah Expo") throw new Error("details typed in 'more' not saved");
});
await step("Quick Add: a double click creates exactly one enquiry and the panel shows it", async () => {
  const d = await openQuickAdd(); await d.getByLabel("What is the enquiry?").fill("Double click enquiry"); await d.getByLabel("Where did it come from?").selectOption("website");
  await d.getByLabel("End client", { exact: true }).selectOption({ label: "Orbit Motors (Riyadh)" }); await d.getByLabel("Next action").fill("Send intro");
  await d.getByRole("button", { name: /^add enquiry$/i }).dblclick(); await page.waitForURL(/open=[0-9a-f-]{36}/, { timeout: 15000 }); await sleep(1200);
  if (sql("select count(*) from crm_opportunities where title='Double click enquiry'") !== "1") throw new Error("duplicates: " + sql("select count(*) from crm_opportunities where title='Double click enquiry'"));
  await panel().waitFor(); if (!/Double click enquiry/.test(await panel().innerText())) throw new Error("new enquiry not shown in the panel"); if (await page.getByRole("dialog", { name: /add an enquiry/i }).count()) throw new Error("the Quick Add dialog stayed open");
  if (sql("select owner_id from crm_opportunities where title='Double click enquiry'") !== sql("select id from auth.users where email='ceo@e2e.local'")) throw new Error("owner is not the person who added it");
});
await step("Quick Add: the owner picker exists for a founder (as on the full form) and the new enquiry gets the chosen owner", async () => {
  const d = await openQuickAdd(); await d.getByText("Add more details").click(); const owner = d.getByLabel("Owner", { exact: true }); await owner.waitFor();
  await d.getByLabel("What is the enquiry?").fill("Owner picker enquiry"); await d.getByLabel("Where did it come from?").selectOption("linkedin"); await d.getByLabel("Agency", { exact: true }).selectOption({ label: "Zeta Media LLC (Dubai)" }); await d.getByLabel("Next action").fill("Intro call");
  const empOption = (await owner.locator("option").allInnerTexts()).find((t) => /emp/i.test(t)); if (!empOption) throw new Error("no emp@ in the owner list"); await owner.selectOption({ label: empOption });
  await d.getByRole("button", { name: /^add enquiry$/i }).click(); await page.waitForURL(/open=[0-9a-f-]{36}/, { timeout: 15000 });
  if (sql("select owner_id from crm_opportunities where title='Owner picker enquiry'") !== sql("select id from auth.users where email='emp@e2e.local'")) throw new Error("owner not applied");
});
await page.context().close();
await step("Quick Add and the full form agree: a plain Sales user (mgr@) cannot assign an owner in either", async () => {
  const p = await newPage(browser); watch(p); await login(p, "mgr@e2e.local"); page = p;
  await p.goto(`${BASE}/sales/opportunities`, { waitUntil: "networkidle" }); await p.getByRole("button", { name: /^add enquiry$/i }).first().click(); const d = p.getByRole("dialog", { name: /add an enquiry/i }); await d.waitFor(); await d.getByText("Add more details").click();
  if ((await d.getByLabel("Owner", { exact: true }).count()) !== 0) throw new Error("Quick Add offers an owner picker to mgr@"); if (!/Owner: you/.test(await d.innerText())) throw new Error("no 'Owner: you' text");
  await p.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" }); if ((await p.getByLabel(/^owner/i).count()) !== 0) throw new Error("the full form offers an owner picker to mgr@");
});

// ----------------------------------------------------------------------------------------------------------------------------
// Authorisation
// ----------------------------------------------------------------------------------------------------------------------------
await page.context().close();
await step("a colleague who does not own the enquiry (emp@): no edit/move/close actions, but can add an update", async () => {
  const target = sql("select id from crm_opportunities where title='Refusal check enquiry'"); // created by ceo@, so owned by ceo@
  page = await newPage(browser); watch(page); await login(page, "emp@e2e.local");
  await page.goto(`${BASE}/sales/opportunities?open=${target}`, { waitUntil: "networkidle" }); await panel().waitFor();
  const p = await panel().innerText(); if (!/Only the owner .* or a founder can move, edit or close this/i.test(p)) throw new Error("missing the explanation: " + p.slice(0, 200));
  const more = panel().getByRole("button", { name: /more actions/i });
  if (await more.count()) { await more.click(); const items = (await page.getByRole("menuitem").allInnerTexts()).join("|"); if (/edit|move|hold|close|reassign|reopen/i.test(items)) throw new Error("edit actions offered: " + items); await page.keyboard.press("Escape"); }
  await panel().getByRole("button", { name: /^add update$/i }).click(); const d = page.getByRole("dialog", { name: /add update/i }); await d.waitFor();
  await d.getByLabel(/what happened|details|note/i).first().fill("Colleague note: saw the brief."); await d.getByRole("button", { name: /add|save/i }).last().click(); await d.waitFor({ state: "hidden", timeout: 12000 });
  if (sql(`select count(*) from crm_activities where opportunity_id='${target}' and body like 'Colleague note%'`) !== "1") throw new Error("note not saved");
  await goList("?view=board&status=all"); const c = page.locator("main section ul > li", { hasText: "Refusal check enquiry" }); if ((await c.getByLabel(/^Move .* to$/).count()) !== 0) throw new Error("the board offers emp@ a move on someone else's enquiry"); if (!/Only the owner/.test(await c.innerText())) throw new Error("no reason shown on the card");
});
await step("a user with no Sales access (admin@) gets the no-access page and none of the data, by list or by direct address", async () => {
  await page.context().close(); page = await newPage(browser); watch(page); await login(page, "admin@e2e.local"); const id = idOf(T.atrium);
  for (const path of ["/sales/follow-ups", "/sales/opportunities", `/sales/opportunities?open=${id}`, `/sales/opportunities/${id}`, "/sales/opportunities?view=board"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    if (/Atrium LED|Museum interactive|Floor projection|Hotel lobby|Roadshow immersive|OPP-UAE/.test(body)) throw new Error(`${path} leaked enquiry data`);
    if (!/access|not have|no sales|ask/i.test(body)) throw new Error(`${path} did not explain the missing access: ` + body.slice(0, 160));
  }
  if (await page.getByRole("link", { name: /^Sales$/ }).count()) throw new Error("Sales is still in the menu for a user without access");
});
await step("value stays company-scoped: the founder's Value column shows each enquiry's own currency, no mixed total", async () => {
  await page.context().close(); page = await newPage(browser); watch(page); await login(page, "ceo@e2e.local");
  await goList("?status=all&cols=enquiry,value"); const cells = await page.locator("main tbody td:last-child").allInnerTexts(); if (!cells.some((c) => /AED/.test(c))) throw new Error("no currency in value cells: " + cells.join("|"));
});
console.log("client console/page errors:", page.errors.filter((e) => !/Failed to load resource.*(40[34])/.test(e)).slice(0, 5));
await browser.close(); console.log(fails === 0 ? "\nALL SALES WORKSPACE CHECKS PASSED" : `\n${fails} FAILED`); process.exit(fails ? 1 : 0);
