// Browser checks for the Projects & Tasks redesign concept (/os-preview/concept). Not part of CI: needs a running preview.
//   cd apps/web && OS_PREVIEW_ENABLED=1 npx next build && OS_PREVIEW_ENABLED=1 npx next start -p 3100
//   node os-preview-checks/concept.mjs
// It also fails if any request is not a GET to localhost: the concept must never write data or call an outside host.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const B = "http://localhost:3100/os-preview/concept";
import { existsSync } from "fs";
// A system Chromium (CHROMIUM_PATH, or the sandbox image's) is used when present, so no separate browser download is needed.
const system = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ args: ["--no-sandbox"], ...(system ? { executablePath: system } : {}) });
const results = [];
const requests = [];
const check = (name, ok, extra = "") => results.push([ok ? "PASS" : "FAIL", name, extra]);
const done = async () => {
  await browser.close();
  const bad = requests.filter(([m, u]) => m !== "GET" || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u));
  check("no request is a write or leaves localhost", bad.length === 0, bad.map((r) => r.join(" ")).join("; "));
  for (const r of results) if (r[0] === "FAIL") console.log(r.join(" | "));
  console.log(`${results.filter((r) => r[0] === "PASS").length} passed, ${results.filter((r) => r[0] === "FAIL").length} failed of ${results.length}`);
  process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
};
process.on("uncaughtException", async (e) => { check("script ran to the end", false, String(e.message).split("\n").slice(0, 4).join(" | ")); await done(); });

async function fresh(vp = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.errors = [];
  page.on("request", (r) => requests.push([r.method(), r.url()]));
  page.on("pageerror", (e) => page.errors.push(e.message));
  return page;
}
const go = async (p, path) => {
  await p.goto(`${B}${path}`, { waitUntil: "load" });
  await p.waitForFunction(() => { const el = document.querySelector("button"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); });
};
const body = (p) => p.locator("body").innerText();
const rows = (p) => p.locator(".cx-table tbody tr").count();
const toast = (p, re) => p.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 4000 }).then(() => true, () => false);
// The same control exists in the table and in the phone cards; only the one on screen counts.
const vis = (loc) => loc.locator("visible=true");
// Click-to-edit: the row's status or assignee pill opens a menu of choices (scoped to the row, since every row has one).
const rowOf = (p, text) => vis(p.locator("tr, li", { hasText: text })).first();
const pick = async (p, rowText, field, option) => {
  const row = rowOf(p, rowText);
  await row.getByRole("button", { name: new RegExp(`^${field}:`) }).click();
  await row.getByRole("menuitem", { name: new RegExp(`^${option}`) }).click();
};
const pillOf = (p, rowText, field) => rowOf(p, rowText).getByRole("button", { name: new RegExp(`^${field}:`) });
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ---- 1, 2 projects: search, filters, Table / Board
let p = await fresh();
await go(p, "");
check("concept is labelled as a design concept with sample data", /Design concept: sample data/.test(await body(p)));
check("title and one primary action", (await p.getByRole("heading", { name: "Projects", level: 1 }).count()) === 1 && (await p.getByRole("button", { name: "Add project" }).count()) === 1);
check("ongoing projects listed, completed hidden", (await rows(p)) === 10);
await p.getByLabel(/Search projects by/).fill("aurora");
await p.waitForURL(/q=aurora/);
check("search narrows the list and is kept in the address", (await rows(p)) === 1);
await p.getByRole("link", { name: "Clear filters" }).click();
await p.waitForFunction(() => !location.search.includes("q="));
check("clear filters restores the list and empties the box", (await rows(p)) === 10 && (await p.getByLabel(/Search projects by/).inputValue()) === "");
await p.getByRole("checkbox", { name: "Needs attention" }).click();
await p.waitForURL(/attn=1/);
check("needs-attention filter", (await rows(p)) > 0 && (await rows(p)) < 10);
await p.getByRole("link", { name: "Board", exact: true }).click();
await p.waitForURL(/view=board/);
check("board shows the same filtered projects grouped by stage", (await p.getByRole("region", { name: /Projects by stage/ }).count()) === 1 && /Aurora Pavilion/.test(await body(p)));
await p.getByRole("link", { name: "Table" }).click();
await p.waitForFunction(() => !location.search.includes("view=board"));
check("table view is back with filters kept", (await rows(p)) > 0 && p.url().includes("attn=1"));
check("no horizontal page scroll (desktop list)", await overflow(p));

// ---- 3 open a project and return without losing place
await p.setViewportSize({ width: 1280, height: 560 });
await go(p, "?kind=client");
const before = await rows(p);
await p.evaluate(() => window.scrollTo(0, 120));
await p.getByRole("link", { name: "Aurora Pavilion: interactive LED floor" }).click();
await p.waitForURL(/concept\/aurora/);
check("project workspace shows its name, reference and four sections only", /ENG-P-0007/.test(await body(p)) && (await p.getByRole("navigation", { name: "Project sections" }).getByRole("link").count()) === 4 && !/Overview/.test(await p.getByRole("navigation", { name: "Project sections" }).innerText()));
await p.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Projects" }).click();
await p.waitForURL(/concept\?kind=client/);
await p.waitForTimeout(300);
check("returning keeps the filter, the row count and the scroll position", (await rows(p)) === before && (await p.evaluate(() => window.scrollY)) > 60);
check("the project just left is marked", (await p.locator('.cx-table tr[data-selected="true"]').count()) === 1);

// ---- 4 .. 7 work: add, panel, status, assignee, blocker, review
await go(p, "/aurora");
check("next action is offered first (the blocked task)", /Resolve a blocker/.test(await body(p)));
{
  await p.setViewportSize({ width: 1586, height: 992 });
  await p.waitForTimeout(200);
  const m = await p.getByRole("region", { name: "Delivery milestones" }).boundingBox();
  const t = await p.getByRole("region", { name: "Tasks" }).boundingBox();
  const stats = await p.getByRole("group", { name: "Task summary" }).boundingBox();
  const rail = await p.getByRole("region", { name: "Next action" }).boundingBox();
  check("desktop: the milestone strip sits under the task list and is on the first screen", !!m && !!t && m.y > t.y && m.y + m.height <= 992, JSON.stringify([m?.y, m?.height, t?.y]));
  check("desktop: the right rail starts beside the summary cards", !!stats && !!rail && Math.abs(stats.y - rail.y) <= 4 && rail.x > stats.x + stats.width, JSON.stringify([stats, rail]));
  check("desktop: the default list is labelled This week, says how many it shows, and offers View all tasks", (await p.getByRole("heading", { name: "This week" }).count()) === 1 && /showing 5 of 10/.test(await body(p)) && (await p.getByRole("link", { name: /View all tasks \(13\)/ }).count()) === 1);
  check("desktop: the counts agree (Open tasks card, Work tab badge)", /12\s*Open tasks/.test((await p.getByRole("group", { name: "Task summary" }).innerText()).replace(/\n+/g, " ")) && /Work\s*12/.test((await p.getByRole("navigation", { name: "Project sections" }).innerText()).replace(/\n+/g, " ")));
  const hero = await p.locator(".cx-hero").boundingBox();
  check("desktop: the header is compact", !!hero && hero.height <= 140, String(hero?.height));
const h1 = await p.locator(".cx-hero h1").boundingBox();
  check("desktop: the header title stays in the left half, clear of the drawing", !!hero && !!h1 && h1.x + h1.width <= hero.x + hero.width * 0.5, JSON.stringify([hero?.x, hero?.width, h1?.x, h1?.width]));
}
check("a blocked task and a review task are visible in the list", /Two of the six motor controllers/.test(await body(p)) && (await p.getByText("In review").count()) > 0);
await p.getByRole("button", { name: "Add task" }).first().click();
await p.locator("dialog").getByLabel("Title").fill("Check cable labels");
await p.locator("dialog").getByRole("button", { name: "Add task" }).click();
await p.waitForURL(/task=n/);
check("a sample task is added and opens in the panel", (await p.getByRole("dialog", { name: "Check cable labels" }).count()) === 1);
check("the panel says the data is sample", /Sample data: changes to this task stay in this browser tab/.test(await body(p)));
await p.keyboard.press("Escape");
await p.waitForFunction(() => !location.search.includes("task="));
check("Escape closes the panel and the This week list is still there", (await p.getByRole("dialog").count()) === 0 && (await rows(p)) === 5 && /showing 5 of 11/.test(await body(p)));
await p.getByRole("link", { name: /View all tasks \(14\)/ }).click();
await p.waitForURL(/tasks=all/);
check("View all tasks shows every task, labelled All tasks", (await rows(p)) === 14 && (await p.getByRole("heading", { name: "All tasks" }).count()) === 1);
await p.getByRole("link", { name: "Scene switching API" }).focus();
await p.keyboard.press("Enter");
await p.waitForURL(/task=t6/);
check("keyboard opens the panel and focus moves to its heading", await p.waitForFunction(() => document.activeElement?.tagName === "H2", null, { timeout: 4000 }).then(() => true, () => false));
check("the open task's row is highlighted as selected", (await p.locator('.cx-table tr[data-selected="true"]').count()) === 1);
await p.keyboard.press("Escape");
await p.waitForFunction(() => !location.search.includes("task="));
check("focus returns to the task link after closing", await p.evaluate(() => document.activeElement?.textContent?.includes("Scene switching API")));
check("keyboard focus is a solid outline and the row is not shown as selected", await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle === "solid") && (await p.locator('.cx-table tr[data-selected="true"]').count()) === 0);
await pick(p, "Scene switching API", "Status", "In progress");
check("status change shows saving then saved", await toast(p, /Saved/));
check("the new status is in the row", /In progress/.test(await pillOf(p, "Scene switching API", "Status").getAttribute("aria-label")));
await pick(p, "Final render: scene 3", "Assignee", "Ravi");
check("assignee change is saved", await toast(p, /Saved the assignee/));
check("assigning removes that task's unassigned state (only the task added above is still unassigned)", (await vis(p.getByRole("button", { name: /^Assignee: Unassigned/ })).count()) === 1);
await rowOf(p, "Motor controller firmware").getByRole("button", { name: /^Status:/ }).click();
check("a blocked task offers no move and says why", /blocked/i.test(await rowOf(p, "Motor controller firmware").innerText()) && (await rowOf(p, "Motor controller firmware").getByRole("menuitem", { name: /^In progress/ }).isDisabled()));
await p.keyboard.press("Escape");
// simulated failure
await p.getByRole("button", { name: "Preview options" }).click();
await p.getByLabel("Make the next save fail").check();
await p.keyboard.press("Escape");
await pick(p, "Sensor and cable layout", "Status", "To do");
check("a failed save says so and offers Try again", await toast(p, /was not saved/) && (await p.getByRole("button", { name: "Try again" }).count()) > 0);
await p.getByRole("button", { name: "Try again" }).click();
check("Try again saves", await toast(p, /Saved/));

// review as someone who may accept
await go(p, "/aurora?task=t2");
check("review state is clear with accept and ask for changes", (await p.getByRole("button", { name: "Accept" }).count()) === 1 && (await p.getByRole("button", { name: "Ask for changes" }).count()) === 1);
await p.getByRole("button", { name: "Accept" }).click();
check("accepting moves the task to Done", await toast(p, /Saved/) && /Done/.test(await p.getByRole("dialog").innerText()));
await go(p, "/aurora?task=t2&as=member");
check("a team member cannot accept a review", (await p.getByRole("button", { name: "Accept" }).count()) === 0);

// ---- 8 timeline
await go(p, "/aurora?tab=timeline");
check("timeline lists milestones, deliverables and timed site bookings", /Hardware demo/.test(await body(p)) && /Installation & testing/.test(await body(p)) && /08:00–18:00/.test(await body(p)));
check("timezone is shown for timed events", /GST \(Dubai, UTC\+4\)/.test(await body(p)));
check("client-facing and internal are distinct", (await p.getByText("Client-facing", { exact: true }).count()) > 1 && (await p.getByText("Internal", { exact: true }).count()) > 1);
check("one overdue milestone is marked", (await p.getByText(/Overdue by 2 days/).count()) === 1);
check("a genuine site overlap is called out", /Overlapping site booking/.test(await body(p)));
check("ordinary same-day tasks produce no warning", !/too many tasks|overbooked|double.booked/i.test(await body(p)));
await p.getByRole("link", { name: "Application demo" }).click();
await p.waitForURL(/ms=m5/);
check("a milestone opens in a panel with its tasks and the no-auto-move rule", (await p.getByRole("dialog", { name: "Application demo" }).count()) === 1 && /never moves dependent tasks/.test(await p.getByRole("dialog").innerText() + (await body(p))) || /Dependent tasks keep their own dates/.test(await body(p)));

// ---- 9 discussion
await go(p, "/aurora?tab=discussion");
await p.locator("#cx-compose").fill("Checking in @sa");
check("typing @ offers colleagues", (await p.getByRole("button", { name: "@Sara Nasser" }).count()) === 1);
await p.getByRole("button", { name: "@Sara Nasser" }).click();
await p.getByLabel("Link to a task").selectOption("t5");
await p.getByRole("button", { name: "Send" }).click();
check("message is added locally and linked to a task", await toast(p, /Saved your message/) && /Checking in/.test(await body(p)) && (await p.getByRole("link", { name: /Touch-floor interaction/ }).count()) >= 2);
await p.getByRole("button", { name: "Reply" }).first().click();
check("reply shows who is being answered", /Replying to/.test(await body(p)));
await go(p, "/harbour?tab=discussion&as=member");
check("discussion is restricted to project members", /for the people working on the project/.test(await body(p)) && (await p.locator("#cx-compose").count()) === 0);

// ---- 10 equipment
await go(p, "/aurora?tab=equipment");
const termsText = (await p.getByRole("term").allInnerTexts()).join(" ");
check("equipment summary has the five counts", ["Requested", "Reserved", "Dispatched", "Returned", "Short"].every((w) => (termsText).includes(w)));
check("shortage is shown in words", /Short by 2/.test(await body(p)));
check("one request action", (await p.getByRole("button", { name: "Request equipment" }).count()) === 1);
await p.getByRole("link", { name: "ENG-R-00012" }).click();
await p.waitForURL(/eq=request/);
check("request details open in a panel and say who decides the shortage", /Someone decides whether to buy, rent or move stock/.test(await body(p)));
await p.keyboard.press("Escape");
await p.getByRole("button", { name: "Request equipment" }).click();
await p.locator("dialog").getByRole("button", { name: "Add draft line" }).click();
check("a draft request line is added locally and labelled not sent", await toast(p, /Saved the equipment request draft/) && /Draft: not sent/.test(await body(p)));

// ---- 11 restricted summary-only
await go(p, "?as=directory");
check("directory colleague sees a summary-only list", (await p.locator(".cx-table thead th").count()) === 4 && /Summary view/.test(await body(p)));
await p.getByRole("link", { name: "Aurora Pavilion: interactive LED floor" }).click();
await p.waitForURL(/concept\/aurora/);
check("a project is summary-only for them", /Summary only/.test(await body(p)) && (await p.getByRole("navigation", { name: "Project sections" }).count()) === 0);
await go(p, "?as=founder");
check("founder sees both companies", (await rows(p)) === 11);

// ---- states
await go(p, "");
await p.getByRole("button", { name: "Preview options" }).click();
await p.getByLabel("Show a state").selectOption("loading");
await p.keyboard.press("Escape");
check("loading shows placeholders, not a page spinner", (await p.getByRole("status", { name: "Loading projects" }).count()) === 1);
await p.getByRole("button", { name: "Preview options" }).click();
await p.getByLabel("Show a state").selectOption("error");
await p.keyboard.press("Escape");
check("error state says what failed and offers Try again", /could not be loaded/.test(await body(p)));
await p.getByRole("button", { name: "Try again" }).click();
check("Try again returns to the list", (await rows(p)) === 10);
await go(p, "?q=zzzz");
check("empty state offers to clear filters", /No projects match/.test(await body(p)));

// ---- 12 phone
p = await fresh({ width: 390, height: 844 });
await go(p, "");
check("phone: no horizontal scroll on the list", await overflow(p));
check("phone: cards instead of a table", (await p.locator(".cx-table").first().isVisible()) === false && (await p.getByRole("list", { name: "Projects" }).count()) === 1);
await p.getByRole("link", { name: "Aurora Pavilion: interactive LED floor" }).click();
await p.waitForURL(/concept\/aurora/);
check("phone: project opens, no horizontal scroll", await overflow(p));
{
  const bars = await p.locator("header.cx-topbar").boundingBox();
  const strip = await p.getByRole("complementary", { name: "Concept notice" }).boundingBox();
  check("phone: the top bar and notice take little height", !!bars && !!strip && bars.height <= 52 && bars.height + strip.height <= 80, JSON.stringify([bars?.height, strip?.height]));
  const hero = await p.locator(".cx-hero").boundingBox();
  check("phone: the project header is compact", !!hero && hero.height <= 250, String(hero?.height));
  const h1 = await p.locator(".cx-hero h1").boundingBox();
  check("phone: the title starts below the drawing's corner", !!hero && !!h1 && h1.y - hero.y >= 36, JSON.stringify([hero?.y, h1?.y]));
  const tabs = p.getByRole("navigation", { name: "Project sections" }).getByRole("link");
  const boxes = await tabs.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top)]; }));
  check("phone: all four tabs are visible without sideways scrolling", boxes.length === 4 && boxes.every(([l, r, t]) => l >= 0 && r <= 391 && t < 844), JSON.stringify(boxes));
  const m = await p.getByRole("region", { name: "Delivery milestones" }).boundingBox();
  check("phone: upcoming milestones start on the first screen", !!m && m.y < 844, JSON.stringify(m));
  const t = await p.getByRole("region", { name: "Tasks" }).boundingBox();
  check("phone: milestones sit above the tasks", !!m && !!t && m.y < t.y, JSON.stringify([m?.y, t?.y]));
  check("phone: supporting cards are folded until opened", (await p.getByRole("button", { name: "Team activity", expanded: false }).count()) === 1 && (await p.getByRole("button", { name: "Next on site", expanded: false }).count()) === 1);
  await p.getByRole("button", { name: "Team activity" }).click();
  check("phone: a folded card opens", (await p.getByRole("button", { name: "Team activity", expanded: true }).count()) === 1 && (await p.getByText(/submitted storyboard/).first().isVisible()));
}
await p.getByRole("link", { name: "Motor controller firmware" }).click();
await p.waitForURL(/task=t7/);
const panel = await p.getByRole("dialog", { name: "Motor controller firmware" }).boundingBox();
check("phone: the task panel is full screen", !!panel && panel.width >= 388 && panel.height >= 840, JSON.stringify(panel));
check("phone: blocker is visible in the panel", /Blocked since/.test(await body(p)));
const h = await p.getByRole("button", { name: "Close details" }).boundingBox();
check("phone: close button is a comfortable tap target", !!h && h.height >= 32 && h.width >= 32, JSON.stringify(h));
await p.getByRole("button", { name: "Close details" }).click();
await p.waitForFunction(() => !location.search.includes("task="));
await p.getByRole("link", { name: /View all tasks/ }).click();
await p.waitForURL(/tasks=all/);
await pick(p, "Scene switching API", "Status", "In progress");
check("phone: status can be changed from the list", await toast(p, /Saved/));
await p.getByRole("link", { name: "Board", exact: true }).click();
await p.waitForURL(/view=board/);
check("phone: board has a Move to control instead of dragging", (await p.getByLabel(/^Move .* to$/).count()) > 0);
check("phone: no horizontal page scroll on the board", await overflow(p));
await p.getByRole("link", { name: "Timeline", exact: true }).click();
await p.waitForURL(/tab=timeline/);
check("phone: timeline readable without sideways scroll", await overflow(p));
await p.getByRole("link", { name: /^Discussion/ }).click();
await p.locator("#cx-compose").fill("From my phone");
await p.getByRole("button", { name: "Send" }).click();
check("phone: a message can be sent", await toast(p, /Saved your message/));
await p.getByRole("link", { name: /^Equipment/ }).click();
await p.waitForURL(/tab=equipment/);
check("phone: equipment cards show the shortage", /Short by 2/.test(await body(p)) && (await overflow(p)));
check("no script errors", p.errors.length === 0, p.errors.join("; "));
await done();
