// SCANNING IN A REAL BROWSER WITH A SIMULATED CAMERA (LOCAL STACK ONLY; needs seed/inventory.sh).
//
// IMPORTANT, read this before trusting it: the camera here is a SYNTHETIC one inside Chromium (a video file generated with ffmpeg that shows a QR
// code, fed to Chromium with --use-fake-device-for-media-stream --use-file-for-fake-video-capture). It proves the app's camera plumbing, the decoder on
// real video frames, de-duplication, safe messages and camera release in Chromium. It is NOT a phone camera: real iPhone Safari and Android Chrome
// scanning (focus, exposure, glare, printed label size, permission prompts of those browsers) remains UNVERIFIED and still needs a real phone.
//
//   D1  /inventory/scan: the label's QR (labelPayload of packages/domain) held in front of the camera for many seconds: one lookup, one card, listed once
//   D2  /inventory?action=scan (the panel): the record opens once; nothing is dispatched, issued or received by a scan
//   D3  the camera is released: Stop camera, closing the panel, leaving by link, leaving the page (the track is stopped, recorded by a getUserMedia wrapper)
//   D4  unknown code and non-Inventory QR (another web address) give the safe messages, the record is never confirmed to someone without access
//   D5  typing the code instead works (found, unknown, not an Inventory code)
//   D6  camera permission denied, no camera device, no mediaDevices at all, no getUserMedia: each says so in words and typing still works
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, BASE, psql as sql, PASSWORD } from "./lib.mjs";

const rootRequire = createRequire(new URL("../../../package.json", import.meta.url));
const QRCode = rootRequire("qrcode");
const { labelPayload } = await import("../../../packages/domain/src/inventoryCodes.ts");
const { chromium: pw } = createRequire(new URL("../../../packages/e2e-tests/package.json", import.meta.url))("@playwright/test");
const SYSTEM_CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const launch = (args = []) => pw.launch({ ...(SYSTEM_CHROMIUM ? { executablePath: SYSTEM_CHROMIUM } : {}), args: ["--no-sandbox", ...args] });

let fails = 0, passes = 0;
const step = async (name, fn) => { try { await fn(); passes++; console.log("PASS", name); } catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0].slice(0, 600)); } };
const check = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, w) => { if (String(a) !== String(b)) throw new Error(`${w}: expected ${b}, got ${a}`); };
const s1 = (q) => sql(q).split("\n")[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the synthetic camera: QR image -> padded 640x480 -> y4m video --------------------------------------------------------------------
const DIR = path.join(os.tmpdir(), "inv-scan-media"); mkdirSync(DIR, { recursive: true });
const CODE = s1("select code from inv_units order by code limit 1");
const UNIT_ID = s1(`select id from inv_units where code='${CODE}'`);
const BIN = s1("select label_code from inv_balances where label_code is not null limit 1");
async function video(name, text) {
  const png = path.join(DIR, `${name}.png`), y4m = path.join(DIR, `${name}.y4m`);
  if (text === null) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=640x480:r=15", "-t", "2", "-pix_fmt", "yuv420p", y4m]);
  else {
    await QRCode.toFile(png, text, { margin: 4, width: 400, errorCorrectionLevel: "M" });
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-framerate", "15", "-i", png, "-t", "2", "-vf", "pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p", "-pix_fmt", "yuv420p", y4m]);
  }
  return y4m;
}
const FILES = {
  unit: await video("unit", labelPayload(BASE, CODE)),
  bin: BIN ? await video("bin", labelPayload(BASE, BIN)) : null,
  unknown: await video("unknown", labelPayload(BASE, "ENG-E-99999")),
  other: await video("other", "https://example.com/not-ours?c=1"),
  blank: await video("blank", null),
};
console.log("synthetic camera files:", Object.entries(FILES).filter(([, v]) => v).map(([k]) => k).join(", "), "in", DIR);
console.log("label payload of", CODE, "=", labelPayload(BASE, CODE));

const fakeCam = (file) => ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${file}`];
async function session(browser, email, { init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
  // records what the page does with the camera: streams requested and every track stop
  await ctx.addInitScript(() => {
    window.__cam = { requested: [], stops: 0, tracks: [] };
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = async (c) => {
        window.__cam.requested.push(JSON.stringify(c));
        const s = await orig(c);
        for (const t of s.getTracks()) { window.__cam.tracks.push(t); const st = t.stop.bind(t); t.stop = () => { window.__cam.stops++; try { window.__camStopped?.(window.__cam.stops); } catch {} return st(); }; }
        return s;
      };
    }
  });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(); page.errors = []; page.posts = 0;
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) page.posts++; });
  await page.exposeFunction("__camStopped", (n) => { page.lastStop = n; });
  await page.goto(`${BASE}/login`); await page.getByLabel(/email/i).fill(email); await page.getByLabel(/password/i).first().fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click(); await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  page.posts = 0;   // the sign-in itself is a server action: count only what happens after it
  return { ctx, page };
}
const live = (page) => page.evaluate(() => (window.__cam?.tracks ?? []).filter((t) => t.readyState === "live").length);
const ended = (page) => page.evaluate(() => (window.__cam?.tracks ?? []).filter((t) => t.readyState === "ended").length);
const state = () => `${s1("select count(*) from inv_movements")}|${s1("select string_agg(custody_kind||coalesce(location_id::text,'')||coalesce(project_id::text,'')||coalesce(employee_id::text,''), ',' order by code) from inv_units")}|${s1("select coalesce(sum(qty),0) from inv_balances")}`;
const main = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");

// ===== D1. scan page, code stays in view =================================================================================================
{
  const b = await launch(fakeCam(FILES.unit)); const { ctx, page } = await session(b, "ceo@e2e.local");
  const before = state();
  await step("D1 /inventory/scan: the camera starts only when the button is pressed (no camera before), and asks for the rear camera without audio", async () => {
    await page.goto(`${BASE}/inventory/scan`, { waitUntil: "networkidle" }); await sleep(800);
    eq(await page.evaluate(() => window.__cam.requested.length), 0, "camera requests before pressing the button");
    await page.getByRole("button", { name: /Use the camera/ }).click();
    await page.getByText(/Point the camera at the label/).waitFor({ timeout: 15000 });
    const req = JSON.parse(await page.evaluate(() => window.__cam.requested[0]));
    eq(req.audio, false, "audio"); check(req.video && req.video.facingMode, "rear camera requested: " + JSON.stringify(req));
    eq(await live(page), 1, "one live camera track");
  });
  await step("D1 the code held in view for 9 seconds: ONE lookup, ONE card, and adding it to the list twice lists it once", async () => {
    await page.getByLabel(`Scanned ${CODE}`).waitFor({ timeout: 20000 });
    const posts0 = page.posts;
    await sleep(9000);
    eq(page.posts, posts0, "no further lookup while the same code stays in view");
    check(page.posts <= 1, `lookups so far: ${page.posts}`);
    const t = await main(page);
    check(new RegExp(CODE).test(t) && /Scanning only finds the record/.test(t), "the card names the unit and says scanning moves nothing: " + t.slice(0, 200));
    await page.getByRole("button", { name: /Add to a list/ }).click();
    await page.getByRole("button", { name: /Add to a list/ }).click();
    const listText = (await page.locator("aside[aria-labelledby='scan-list-title']").innerText()).replace(/\s+/g, " ");
    check(/Your list \(1\)/.test(listText), "listed once: " + listText.slice(0, 160));
    eq(await page.locator("ul[aria-label='Scanned codes'] li").count(), 1, "one list row");
    check(/already on the list/.test(await page.locator("aside[aria-labelledby='scan-list-title']").innerText()), "says it is already listed");
    await page.screenshot({ path: path.join(DIR, "d1-scanned.png") });
  });
  await step("D1 nothing was dispatched, issued, received or moved by the scan (movements, custody and balances identical)", async () => { eq(state(), before, "database state"); eq(page.errors.length, 0, "page errors: " + page.errors.join(" | ")); });
  await step("D1 Stop camera releases the camera (track ended)", async () => {
    await page.getByRole("button", { name: /Stop camera/ }).click();
    await page.waitForFunction(() => window.__cam.tracks.length > 0 && window.__cam.tracks.every((t) => t.readyState === "ended"), null, { timeout: 5000 });
    eq(await live(page), 0, "live tracks");
  });
  await step("D1 'Open' on the card goes to the record, which opens read-only", async () => {
    await page.getByRole("link", { name: "Open", exact: true }).click();
    await page.waitForURL(/unit=/, { timeout: 15000 });
    await page.locator("aside[role=dialog]").getByText(CODE).first().waitFor({ timeout: 15000 });
  });
  await ctx.close(); await b.close();
}

// ===== D2/D3. panel on the stock page ====================================================================================================
{
  const b = await launch(fakeCam(FILES.unit)); const { ctx, page } = await session(b, "ceo@e2e.local");
  const before = state();
  await step("D2 /inventory?action=scan: pressing the camera button opens the scanned unit's record, once, and records nothing", async () => {
    await page.goto(`${BASE}/inventory?action=scan`, { waitUntil: "networkidle" });
    const panel = page.locator("aside[role=dialog]"); await panel.waitFor();
    await panel.getByRole("button", { name: /Use the camera/ }).click();
    await page.waitForURL(new RegExp(`unit=${UNIT_ID}`), { timeout: 20000 });
    await sleep(2500);
    check(page.url().includes(`unit=${UNIT_ID}`) && !page.url().includes("action=scan"), "the unit panel replaced the scan panel: " + page.url());
    await page.locator("aside[role=dialog]").getByText(CODE).first().waitFor({ timeout: 15000 });   // the panel is the unit's record
    check(page.posts <= 1, "one lookup only: " + page.posts);
    eq(state(), before, "nothing moved");
  });
  await step("D3 the camera is released when the scan panel is replaced by the record (the track ended; no live track left)", async () => {
    await page.waitForFunction(() => window.__cam.tracks.length > 0 && window.__cam.tracks.every((t) => t.readyState === "ended"), null, { timeout: 5000 });
    eq(await live(page), 0, "live tracks");
  });
  await step("D3 closing the scan panel with Escape while the camera is on releases it", async () => {
    await page.goto(`${BASE}/inventory?action=scan`, { waitUntil: "networkidle" });
    const panel = page.locator("aside[role=dialog]"); await panel.waitFor();
    // use the BLANK picture so the panel stays open: switch is not possible mid-session, so start the camera and close before the code is read
    await panel.getByRole("button", { name: /Use the camera/ }).click();
    await page.waitForFunction(() => window.__cam.tracks.length > 0, null, { timeout: 15000 });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__cam.tracks.every((t) => t.readyState === "ended"), null, { timeout: 5000 });
  });
  await step("D3 leaving the scan page by a link releases the camera", async () => {
    await page.goto(`${BASE}/inventory/scan`, { waitUntil: "networkidle" });
    const before2 = await page.evaluate(() => window.__cam.tracks.length);
    await page.getByRole("button", { name: /Use the camera/ }).click();
    await page.getByText(/Point the camera at the label|Looking it up/).first().waitFor({ timeout: 15000 });
    await page.locator("nav a[href='/inventory/requests'], a[href='/inventory/requests']").first().click();
    await page.waitForURL(/\/inventory\/requests/);
    await page.waitForFunction((n) => window.__cam.tracks.length > n && window.__cam.tracks.slice(n).every((t) => t.readyState === "ended"), before2, { timeout: 5000 });
  });
  await step("D3 leaving the page altogether (address typed) stops the track too (pagehide); reported honestly if the browser cannot confirm it", async () => {
    await page.goto(`${BASE}/inventory/scan`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Use the camera/ }).click();
    await page.getByText(/Point the camera at the label|Looking it up/).first().waitFor({ timeout: 15000 });
    page.lastStop = 0;
    const stops0 = await page.evaluate(() => window.__cam.stops);
    await page.goto(`${BASE}/inventory/requests`, { waitUntil: "load" });
    await sleep(500);
    console.log("   stop() calls seen from the leaving page:", page.lastStop ?? 0, "(before:", stops0, ")");
    check((page.lastStop ?? 0) > stops0, "no track.stop() was seen when the page was left");
  });
  await ctx.close(); await b.close();
}

// ===== D4. unknown code, other QR, no access ==============================================================================================
for (const [label, file, re] of [
  ["an unknown Inventory code", FILES.unknown, /This code is not available to you or does not exist\./],
  ["a QR that is another web address (not an Inventory code)", FILES.other, /That is not an Enginious Inventory code/],
]) {
  const b = await launch(fakeCam(file)); const { ctx, page } = await session(b, "ceo@e2e.local");
  const before = state();
  await step(`D4 scan page: ${label} gives the safe message, shows no record and moves nothing`, async () => {
    await page.goto(`${BASE}/inventory/scan`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Use the camera/ }).click();
    await page.getByText(re).first().waitFor({ timeout: 20000 });
    await sleep(3000);
    check(page.posts <= 1, "one lookup while it stays in view: " + page.posts);
    eq(await page.getByLabel(/^Scanned /).count(), 0, "no record card");
    eq(state(), before, "nothing moved");
    await page.screenshot({ path: path.join(DIR, `d4-${file.includes("unknown") ? "unknown" : "other"}.png`) });
  });
  await step(`D4 stock-page panel: ${label} says so in the panel and the panel stays on the scanner`, async () => {
    await page.goto(`${BASE}/inventory?action=scan`, { waitUntil: "networkidle" });
    const panel = page.locator("aside[role=dialog]"); await panel.waitFor();
    await panel.getByRole("button", { name: /Use the camera/ }).click();
    await panel.locator("[role=status], [role=alert]").filter({ hasText: /not an (Enginious )?Inventory|not available|does not exist|could not|no equipment|not found/i }).first().waitFor({ timeout: 20000 });
    console.log("   panel says:", (await panel.locator("[role=status], [role=alert]").filter({ hasText: /not an (Enginious )?Inventory|not available|does not exist|could not|no equipment|not found/i }).first().innerText()).replace(/\s+/g, " "));
    check(page.url().includes("action=scan"), "still on the scanner: " + page.url());
  });
  await ctx.close(); await b.close();
}
{
  const b = await launch(fakeCam(FILES.unit)); const { ctx, page } = await session(b, "emp@e2e.local");   // an employee: no stock access
  await step("D4 a signed-in person WITHOUT stock access scanning a real label gets the neutral message, never a confirmation that the code exists", async () => {
    await page.goto(`${BASE}/inventory/scan`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Use the camera/ }).click();
    await page.getByText(/This code is not available to you or does not exist\./).first().waitFor({ timeout: 20000 });
    const t = await main(page); const html = await page.content();
    check(!/Laptop 14 inch|Motor|Holofan|In the warehouse/.test(html), "no record data in the page: " + t.slice(0, 160));
    eq(await page.getByLabel(/^Scanned /).count(), 0, "no card");
  });
  await ctx.close(); await b.close();
}

// ===== D5. typing instead =================================================================================================================
{
  const b = await launch([]); const { ctx, page } = await session(b, "ceo@e2e.local");
  const type = async (text) => { const box = page.getByLabel("Or type the code on the label"); await box.fill(text); await page.getByRole("button", { name: "Look up" }).click(); };
  await step("D5 typing a code (lower case, spaces) finds the record; an unknown code and a web address give the safe messages", async () => {
    await page.goto(`${BASE}/inventory/scan`, { waitUntil: "networkidle" });
    await type(` ${CODE.toLowerCase()} `);
    await page.getByLabel(`Scanned ${CODE}`).waitFor({ timeout: 15000 });
    await type("ENG-E-99999");
    await page.getByText(/This code is not available to you or does not exist\./).first().waitFor({ timeout: 15000 });
    await type("https://example.com/x");
    await page.getByText(/That is not an Enginious Inventory code/).first().waitFor({ timeout: 15000 });
    await page.getByLabel("Or type the code on the label").fill("   ");
    check(await page.getByRole("button", { name: "Look up" }).isDisabled(), "empty text cannot be looked up");
  });
  if (BIN) await step("D5 a bin label code finds the item in that bin (typed)", async () => {
    await type(BIN);
    await page.getByLabel(`Scanned ${BIN}`).waitFor({ timeout: 15000 });
    check(/Item in a bin/.test(await main(page)), "described as an item in a bin");
  });
  await ctx.close(); await b.close();
}

// ===== D6. camera problems =================================================================================================================
const problemCases = [
  ["permission denied (the browser refuses the camera)", [], () => { if (!navigator.mediaDevices) return; Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => { throw new DOMException("Permission denied", "NotAllowedError"); }, configurable: true }); }, /camera is blocked for this site/i],
  ["no camera device on this computer (NotFoundError)", [], () => { if (!navigator.mediaDevices) return; Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => { throw new DOMException("Requested device not found", "NotFoundError"); }, configurable: true }); }, /No camera was found on this device/i],
  ["no navigator.mediaDevices at all", [], () => { Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }); }, /cannot use the camera/i],
  ["mediaDevices without getUserMedia (what an insecure or old browser has)", [], () => { Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true }); }, /cannot use the camera/i],
  ["the camera starts but fails (NotReadableError: in use by another app)", [], () => { if (!navigator.mediaDevices) return; Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => { throw new DOMException("Could not start video source", "NotReadableError"); }, configurable: true }); }, /camera could not be started/i],
];
for (const [label, flags, init, re] of problemCases) {
  const b = await launch(flags); const { ctx, page } = await session(b, "hr1@e2e.local", { init });
  for (const where of ["/inventory/scan", "/inventory?action=scan"]) {
    await step(`D6 ${label} on ${where}: it says so in words, no crash, and typing the code still opens the record`, async () => {
      await page.goto(`${BASE}${where}`, { waitUntil: "networkidle" });
      const scope = where.includes("action") ? page.locator("aside[role=dialog]") : page.locator("main");
      await scope.waitFor();
      await scope.getByRole("button", { name: /Use the camera/ }).click();
      await scope.getByText(re).first().waitFor({ timeout: 10000 });
      check(page.errors.length === 0, "page errors: " + page.errors.join(" | "));
      await scope.getByRole("button", { name: /Try the camera again/ }).waitFor();
      const box = scope.getByLabel("Or type the code on the label"); await box.fill(CODE); await scope.getByRole("button", { name: "Look up" }).click();
      if (where.includes("action")) await page.waitForURL(/unit=/, { timeout: 15000 });
      else await page.getByLabel(`Scanned ${CODE}`).waitFor({ timeout: 15000 });
      if (where === "/inventory/scan") await page.screenshot({ path: path.join(DIR, `d6-${label.split(" ")[0]}.png`) });
    });
  }
  await ctx.close(); await b.close();
}
{
  // The real browser without any fake device and without the auto-accept flag: what Chromium itself does (headless: no camera, no prompt).
  const b = await launch([]); const { ctx, page } = await session(b, "hr1@e2e.local");
  await step("D6 plain Chromium with NO camera device and no permission prompt (nothing simulated): the page shows a camera message, not a crash", async () => {
    await page.goto(`${BASE}/inventory/scan`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Use the camera/ }).click();
    const t = await page.getByText(/camera is blocked|No camera was found|cannot use the camera|camera could not be started/i).first().innerText({ timeout: 15000 });
    console.log("   real Chromium said:", t.replace(/\s+/g, " ").slice(0, 120));
    eq(page.errors.length, 0, "page errors");
  });
  await ctx.close(); await b.close();
}

console.log(`\n${passes} passed, ${fails} failed`);
console.log("REMINDER: synthetic camera in Chromium only. Real iPhone Safari / Android Chrome scanning is NOT verified by this script.");
console.log(fails ? "VERDICT: FAIL" : "VERDICT: PASS");
process.exit(fails ? 1 : 0);
