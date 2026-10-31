// Inventory simplification concept (Stage A): screenshots and checks of the FICTIONAL-DATA preview pages. Nothing here signs in or touches a database.
// usage: BASE_URL=http://127.0.0.1:3100 node os-shell-checks/inventory-concept-checks.mjs <outdir>
// needs the app running with OS_PREVIEW_ENABLED=1 (or `next dev`). Prints PASS/FAIL lines and a verdict.
import { createRequire } from "node:module";
import fs from "node:fs";
import { chromium, BASE } from "./lib.mjs";

const out = process.argv[2] ?? "inventory-concept-screenshots";
fs.mkdirSync(out, { recursive: true });
const rootRequire = createRequire(new URL("../../../package.json", import.meta.url));
const axeSrc = fs.readFileSync(rootRequire.resolve("axe-core/axe.min.js"), "utf8");
const browser = await chromium.launch();
let fails = 0;
const step = async (name, fn) => { try { await fn(); console.log("PASS", name); } catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); } };
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const P = "/os-preview/inventory";

async function open(theme, vp) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${String(e)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${page.url()} :: ${m.text().replace(/\s+/g, " ").slice(0, 400)}`); });
  return { ctx, page, errors };
}
const settle = (page) => page.waitForLoadState("networkidle").then(() => page.waitForTimeout(250));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const axe = async (page) => {
  await page.evaluate(axeSrc);
  const r = await page.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }));
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length})`);
};

for (const theme of ["dark", "light"]) {
  for (const [vpName, vp] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const { ctx, page, errors } = await open(theme, vp);
    const tag = `${vpName}-${theme}`;
    const shot = async (name, full = vpName === "desktop") => page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: full });
    const go = async (path) => { await page.goto(`${BASE}${path}`); await settle(page); };

    // ---- Today
    await go(P);
    await shot("01-today");
    await step(`${tag} Today: three sections, warehouse shown, switcher present`, async () => {
      // wide screens use the sidebar's Inventory entries; narrow ones use the in-page strip (the same four destinations)
      for (const n of ["Today", "Stock", "History", "Manage"]) must(await page.getByRole("link", { name: n, exact: true }).locator("visible=true").count() >= 1, `${n} missing`);
      must((await page.getByLabel("Warehouse").inputValue()) === "dxb", "default warehouse not Dubai");
      must(await page.getByText("You are working in").isVisible(), "no 'working in' label");
    });
    await step(`${tag} Today: every row names the job, who, when and one button`, async () => {
      const rows = page.locator("ul.divide-y > li");
      const n = await rows.count();
      must(n === 8, `expected 8 rows at Dubai, got ${n}`);
      for (let i = 0; i < n; i++) { const r = rows.nth(i); must((await r.getByRole("button").or(r.getByRole("link").nth(1)).count()) > 0, `row ${i} has no action`); }
      const text = await page.locator("main, body").first().innerText();
      for (const verb of ["Prepare equipment", "Send equipment", "Receive returns", "Receive transfer", "Check availability"]) must(text.includes(verb), `no '${verb}' button`);
    });
    await step(`${tag} Today: Late group comes first and carries the overdue project`, async () => {
      const h = await page.locator("section h2").allInnerTexts();
      must(/^Late/.test(h[0] ?? ""), `first group is ${h[0]}`);
    });
    await step(`${tag} Today: clicking the empty part of a row opens it; the button inside works on its own`, async () => {
      const row = page.locator("li", { hasText: "Gulf Bank Summit needs its equipment prepared" });
      await row.scrollIntoViewIfNeeded();
      const box = await row.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6);
      await page.waitForURL(/project\/gulf/);
      await go(P);
      await page.locator("li", { hasText: "Sara Khan has 2 items" }).getByRole("button", { name: "Receive returns" }).click();
      must(await page.getByRole("dialog", { name: /Receive returns from Sara Khan/ }).isVisible(), "employee sheet not open");
      await page.keyboard.press("Escape");
    });
    await step(`${tag} Today: Sales check shows only reference, dates, equipment; no client or value`, async () => {
      const t = await page.locator("li", { hasText: "ENQ-0188" }).innerText();
      must(!/client|value|AED|agency/i.test(t), "restricted wording present");
      must(/Nothing is reserved/.test(t), "no 'nothing is reserved'");
    });
    if (vpName === "phone") await step(`${tag} Today: no sideways scroll, action buttons are large`, async () => {
      must((await overflow(page)) <= 0, `overflow ${await overflow(page)}`);
      const b = await page.locator("li", { hasText: "Gulf Bank Summit" }).getByRole("link", { name: "Prepare equipment" }).boundingBox();
      must(b.height >= 44, `button height ${b.height}`);
    });
    await step(`${tag} Today: axe finds nothing serious`, async () => { const v = await axe(page); must(v.length === 0, v.join(", ")); });

    // switch warehouse (empty-ish queue), failed source, single warehouse
    await step(`${tag} Today: Abu Dhabi shows only what is its own or unplaced`, async () => {
      await page.getByLabel("Warehouse").selectOption("auh");
      await page.waitForTimeout(300);
      must((await page.locator("ul.divide-y > li").count()) === 1, "expected one row at Abu Dhabi");
      await shot("02-today-abu-dhabi");
    });
    await go(`${P}?fail=transfers`);
    await step(`${tag} Today: a failed source is an error, not an empty queue`, async () => {
      must(await page.getByRole("alert").filter({ hasText: "Incoming transfers could not be loaded" }).isVisible(), "no error banner");
      await shot("03-today-load-failure");
    });
    await go(`${P}?single=1`);
    await step(`${tag} Today: one warehouse is a plain label with no switcher`, async () => {
      must((await page.getByLabel("Warehouse").count()) === 0, "switcher shown");
      must(await page.getByTestId("warehouse-label").isVisible(), "label missing");
    });

    // ---- Prepare
    await go(`${P}/project/gulf?step=prepare`);
    await shot("10-prepare");
    await step(`${tag} Prepare: booking window, dispatch and due-back visible; planning dates under More dates`, async () => {
      for (const t of ["Booking window", "Dispatch", "Due back"]) must(await page.getByText(t, { exact: true }).first().isVisible(), `${t} missing`);
      must(!(await page.getByText("Installation starts").isVisible()), "full schedule shown by default");
      await page.getByText("More dates").click();
      must(await page.getByText("Inspection ends").isVisible(), "More dates did not open");
      await page.getByText("More dates").click();
    });
    await step(`${tag} Prepare: needed, reserved, short per line; shortage is flagged`, async () => {
      must(await page.getByText("66 of 84").isVisible(), "totals missing");
      must(await page.getByText("18 short").isVisible(), "short total missing");
    });
    await step(`${tag} Prepare: reserving the mic takes the one free unit and says 1 stays short`, async () => {
      await page.locator("li", { hasText: "Wireless handheld mic" }).getByRole("button", { name: "Reserve" }).click();
      const d = page.getByRole("dialog");
      must(await d.getByText("Choose free units for me").isVisible(), "no automatic option");
      must(await d.getByText("Let me choose specific units").isVisible(), "no specific option");
      must(await d.getByText(/Will reserve\s*1/).isVisible(), "wrong reserve count");
      await shot("11-reserve-sheet", false);
      await d.getByLabel("Let me choose specific units").check();
      must(await d.getByText("WM-0015").isVisible(), "free unit not listed");
      must(await d.getByText(/WM-0016 is in repair/).isVisible(), "unusable unit not explained");
      await d.getByLabel("Choose free units for me").check();
      await d.getByRole("button", { name: /^Reserve 1$/ }).click();
      must(await page.getByText("67 of 84").isVisible(), "total did not move");
    });
    await step(`${tag} Prepare: bulk reserve is shown as proposed and disabled`, async () => {
      must(await page.getByRole("button", { name: "Reserve all open lines" }).isDisabled(), "bulk button enabled");
      must(await page.getByText("Proposed, needs a backend change").isVisible(), "no backend tag");
    });
    await step(`${tag} Prepare: substitute and buy/rent are offered only on short lines`, async () => {
      await page.locator("li", { hasText: "Wireless handheld mic" }).getByRole("button", { name: "More" }).click();
      must(await page.getByRole("menuitem", { name: /Suggest Handheld mic, Model B/ }).isVisible(), "no substitute");
      must(await page.getByRole("menuitem", { name: /need to buy/ }).isVisible(), "no buy");
      await page.keyboard.press("Escape");
      must((await page.locator("li", { hasText: "LED wall panel" }).getByRole("button", { name: "More" }).count()) === 0, "More on a covered line");
    });
    if (vpName === "phone") await step(`${tag} Prepare: no sideways scroll`, async () => { must((await overflow(page)) <= 0, `overflow ${await overflow(page)}`); });
    await step(`${tag} Prepare: axe`, async () => { const v = await axe(page); must(v.length === 0, v.join(", ")); });

    // ---- Send out
    await go(`${P}/project/alkhail?step=send`);
    await shot("20-send");
    await step(`${tag} Send: project, warehouse and expected return carried forward; nothing pre-ticked`, async () => {
      const t = await page.locator("body").innerText();
      must(/Al Khail Roadshow/.test(t) && /Dubai: Al Quoz/.test(t) && /expected back/.test(t), "context missing");
      must((await page.locator("input[type=checkbox]:checked").count()) === 0, "something pre-ticked");
      must(await page.getByText("Sent 2").first().isVisible().catch(() => false) || /Sent 2/.test(t), "already-sent not shown");
    });
    await step(`${tag} Send: a code that is not reserved is flagged before confirmation and blocks`, async () => {
      await page.getByLabel(/Scan or type a code/).fill("WM-0099");
      await page.keyboard.press("Enter");
      must(await page.getByRole("alert").filter({ hasText: "WM-0099 is not reserved" }).isVisible(), "no block");
      await page.getByLabel(/Scan or type a code/).fill("pj-0403");
      await page.keyboard.press("Enter");
      must(await page.getByLabel("PJ-0403 reserved for this request").or(page.locator("label", { hasText: "PJ-0403" }).locator("input")).first().isChecked(), "scan did not tick");
      await page.getByRole("button", { name: /^Review/ }).click();
      must(await page.getByRole("button", { name: /Confirm: send/ }).isDisabled(), "confirm enabled despite block");
      await shot("21-send-blocked", false);
    });
    await step(`${tag} Send: partial dispatch warns and can be confirmed once the stray code is removed`, async () => {
      await page.getByRole("button", { name: "Back to edit" }).click();
      // remove the unreserved code by reloading the list (a fresh draft)
      await go(`${P}/project/alkhail?step=send`);
      await page.locator("label", { hasText: "PJ-0403" }).locator("input").check();
      await page.getByRole("button", { name: /^Review/ }).click();
      must(await page.getByText(/sending 1 of 2/).isVisible(), "no partial warning");
      await shot("22-send-partial-review", false);
      await page.getByRole("button", { name: /Confirm: send 1/ }).click();
      must(await page.getByText(/Recorded: 1 item sent/).isVisible(), "no confirmation");
    });
    await step(`${tag} Send: unplanned dispatch is a labelled exception`, async () => {
      await page.getByRole("button", { name: /not on this request/ }).click();
      must(await page.getByRole("dialog").getByText("This is an exception.").isVisible(), "exception not labelled");
      await page.keyboard.press("Escape");
    });
    if (vpName === "phone") await step(`${tag} Send: no sideways scroll`, async () => { must((await overflow(page)) <= 0, `overflow ${await overflow(page)}`); });
    await step(`${tag} Send: axe`, async () => { const v = await axe(page); must(v.length === 0, v.join(", ")); });

    // ---- Receive back
    await go(`${P}/project/expo?step=back`);
    await shot("30-back");
    await step(`${tag} Back: Sent / Returned / Still out; nothing assumed back`, async () => {
      must(await page.getByText("Sent 30 · Returned 14 · Still out 16").isVisible(), "totals wrong");
      must((await page.locator("input[type=checkbox]:checked").count()) === 0, "something pre-ticked");
      must(await page.getByText(/Due back/).first().isVisible(), "no due date");
      must(await page.getByText(/· late/).first().isVisible(), "overdue not shown");
    });
    await step(`${tag} Back: a condition is required; good becomes available, damaged is held; the rest stay out`, async () => {
      await page.getByLabel("LED wall panel 500 × 500 mm · LED-0007").check();
      await page.getByLabel("LED wall panel 500 × 500 mm · LED-0008").check();
      await page.getByRole("button", { name: /^Review/ }).click();
      must(await page.getByRole("alert").filter({ hasText: "Choose a condition" }).first().isVisible(), "no condition prompt");
      await page.getByLabel("Condition of LED wall panel 500 × 500 mm · LED-0007").selectOption("good");
      await page.getByLabel("Condition of LED wall panel 500 × 500 mm · LED-0008").selectOption("damaged");
      await shot("31-back-conditions", false);
      await page.getByRole("button", { name: /^Review/ }).click();
      must(await page.getByText("Available again").first().isVisible() && await page.getByText("Held, not available").isVisible(), "outcomes missing");
      must(await page.getByText(/not in this entry and stay out/).isVisible(), "no 'stay out' line");
      await shot("32-back-review", false);
      await page.getByRole("button", { name: /Confirm: record returns/ }).click();
      must(await page.getByText("Sent 30 · Returned 16 · Still out 14").isVisible(), "totals not updated");
    });
    if (vpName === "phone") await step(`${tag} Back: no sideways scroll`, async () => { must((await overflow(page)) <= 0, `overflow ${await overflow(page)}`); });
    await step(`${tag} Back: axe`, async () => { const v = await axe(page); must(v.length === 0, v.join(", ")); });

    // ---- Stock, History, Manage
    await go(`${P}/stock`);
    await shot("40-stock");
    await step(`${tag} Stock: compact columns; counted stock Out shows a dash with a reason`, async () => {
      const t = await page.locator("body").innerText();
      for (const c of ["Available here", "Out", "Reserved", "Action"]) must(t.includes(c) || vpName === "phone", `${c} column missing`);
      must((await page.getByLabel("Not split by warehouse").count()) >= 3, "dash explanations missing");
    });
    await step(`${tag} Stock: receive flow is item, how many, where, review, confirm`, async () => {
      await page.getByRole("button", { name: "Receive stock" }).click();
      const d = page.getByRole("dialog");
      await d.getByRole("button", { name: /Truss section/ }).click();
      await d.getByRole("button", { name: "Next" }).click();
      must(await d.getByRole("button", { name: "Next" }).isDisabled(), "Next enabled without a quantity");
      await d.getByLabel(/How many/).fill("12");
      await d.getByRole("button", { name: "Next" }).click();
      await d.getByLabel("Shelf or bin").selectOption("B1");
      await shot("41-receive-where", false);
      await d.getByRole("button", { name: "Next" }).click();
      must(await d.getByText("Check before you confirm").isVisible(), "no review");
      await shot("42-receive-review", false);
      await d.getByRole("button", { name: /Confirm: receive 12/ }).click();
      must(await d.getByText(/Recorded: 12 × Truss section/).isVisible(), "no done");
    });
    await step(`${tag} Scan: finding a code changes nothing and offers only allowed actions`, async () => {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Scan a label" }).click();
      await page.getByLabel("Equipment code").fill("WM-0016");
      await page.getByRole("button", { name: "Find" }).click();
      const d = page.getByRole("dialog");
      must(await d.getByText(/cannot be sent while it is in repair/).isVisible(), "repair not explained");
      must((await d.getByRole("button", { name: "Send out" }).count()) === 0, "send offered for repair unit");
      await shot("43-scan-result", false);
      await page.keyboard.press("Escape");
    });
    await step(`${tag} Stock: axe`, async () => { const v = await axe(page); must(v.length === 0, v.join(", ")); });
    await go(`${P}/history`); await shot("50-history");
    await step(`${tag} History: axe`, async () => { const v = await axe(page); must(v.length === 0, v.join(", ")); });
    await go(`${P}/manage`); await shot("60-manage");
    await step(`${tag} Manage: axe`, async () => { const v = await axe(page); must(v.length === 0, v.join(", ")); });
    await step(`${tag} no console or page errors`, async () => { must(errors.length === 0, errors.slice(0, 2).join(" | ")); });
    await ctx.close();
  }
}
await browser.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
