// Real-browser check of Project Plan > Start from a sequence (LOCAL STACK ONLY; see README.md). Seed first with `seed/project-plan.sh`, then run against the production build.
// It checks the form at desktop and phone widths with a LONG owner name: the dialog is wide, every step has a full-width name and Owner / Start date / Due date on a second row
// with visible labels (stacked on a phone), a chosen owner is readable at once and stays selected when dates are edited or another step is removed, the saved requirements carry the
// owner, and after Release the tasks have the right assignee. Fictional data; writes to the local database only.
import { chromium, newPage, login, BASE, psql as sql, choose } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/seq-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const LONG = "Fictional Alexandria Konstantinopoulos-Wickramasinghe, Senior Interactive Content Designer";
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email, viewport) => { if (page) await page.context().close(); page = await newPage(browser, viewport); await login(page, `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {}); }
};
const db = (q) => sql(q);
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${fn}`); await new Promise((r) => setTimeout(r, 250)); } };
const dayIso = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const dialog = () => page.getByRole("dialog");
const selectedText = (loc) => loc.evaluate((e) => e.options[e.selectedIndex].text);
const ownerBox = (n) => dialog().getByLabel(`Step ${n} owner`);
const noOverflow = async (what) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) throw new Error(`${what}: horizontal overflow of ${o}px`); };

let PRJ = ""; let ITEM = "";
const NAMES = ["Moodboard", "Storyboard", "First draft", "Client review", "Final export", "On-device test"];
// The sequence starts blank (nothing is prefilled); the check types its own six steps.
const openForm = async () => {
  await page.goto(`${BASE}/projects/${PRJ}/delivery?open=D001`, { waitUntil: "networkidle" });
  const c = page.getByTestId("dp-activation-D001"); if (!(await c.evaluate((e) => e.open))) await c.locator("summary").click();
  await c.getByRole("button", { name: "Start from a sequence" }).click();
  await dialog().waitFor();
  if ((await dialog().getByLabel("Step 1 name").inputValue()) !== "") throw new Error("the sequence starts prefilled");
  if (!(await dialog().getByTestId("seq-hint").isVisible())) throw new Error("no hint that tasks are already tracked");
  for (let n = 2; n < NAMES.length; n++) await dialog().getByRole("button", { name: "Add a step" }).click();
  for (let n = 0; n < NAMES.length; n++) await dialog().getByLabel(`Step ${n + 1} name`).fill(NAMES[n]);
};

await as("mgr");
// accept the handover through the screen, add people (one with a very long name), bring in the scope through the real functions
await step("setup: handover accepted, a long-named designer on the project, the technologies brought in", async () => {
  await page.goto(`${BASE}/projects/handovers`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^accept handover/i }).first().click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/delivery/, { timeout: 30000 });
  PRJ = page.url().match(/projects\/([0-9a-f-]{36})\//)[1];
  db(`update profiles set full_name = '${LONG}' where id = '${U}2'`);
  asDb(4, `select proj_add_member('${PRJ}', '${U}2', null)`); asDb(4, `select proj_add_member('${PRJ}', '${U}7', null)`);
  asDb(4, `select proj_dp_seed_scope('${PRJ}')`);
  ITEM = db(`select id from proj_dp_items where project_id='${PRJ}' and item_key='D001'`);
  asDb(4, `select proj_dp_save_item('${PRJ}', '${ITEM}', '{"owner_id":"${U}4","needed_by":"${dayIso(20)}"}'::jsonb)`);
});

for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  await step(`${label}: wide dialog, full-width name, Owner / Start / Due with visible labels, readable default owner`, async () => {
    await as("mgr", viewport); await openForm();
    const box = await dialog().boundingBox();
    if (label === "desktop" && box.width < 900) throw new Error(`desktop dialog is only ${Math.round(box.width)}px wide`);
    if (label === "phone" && box.width > viewport.width) throw new Error("phone dialog is wider than the screen");
    const s0 = dialog().getByTestId("seq-step-0");
    const name = await s0.getByLabel("Step 1 name").boundingBox(), sbox = await s0.boundingBox();
    if (name.width < sbox.width * 0.85) throw new Error(`the name field is ${Math.round(name.width)}px of a ${Math.round(sbox.width)}px step`);
    for (const l of ["Owner", "Start date", "Due date"]) if (!(await s0.locator("label", { hasText: new RegExp(`^${l}$`) }).isVisible())) throw new Error(`no visible ${l} label`);
    const o = await s0.getByLabel("Step 1 owner").boundingBox(), st = await s0.getByLabel("Step 1 start").boundingBox(), du = await s0.getByLabel("Step 1 due").boundingBox();
    if (label === "desktop") {
      if (!(Math.abs(o.y - st.y) < 4 && Math.abs(st.y - du.y) < 4)) throw new Error("Owner, Start and Due are not on one row at desktop width");
      if (o.width < 330) throw new Error(`the owner box is only ${Math.round(o.width)}px wide`);
      if (!(o.y > name.y + name.height)) throw new Error("the second row is not below the name");
    } else if (!(o.y + o.height <= st.y + 2 && st.y + st.height <= du.y + 2)) throw new Error("the fields do not stack on a phone");
    if (o.width < (label === "phone" ? 250 : 330)) throw new Error(`owner box ${Math.round(o.width)}px`);
    const def = await selectedText(s0.getByLabel("Step 1 owner"));
    if (def !== "Use activation owner (mgr)") throw new Error(`default owner reads "${def}"`);
    await noOverflow(label);
    await page.screenshot({ path: `${SHOTS}/sequence-dialog-${label}.png` });
  });
  await step(`${label}: a long owner name is readable at once, stays when dates are edited or another step is removed`, async () => {
    await choose(ownerBox(2), /Konstantinopoulos/);
    const shown = await selectedText(ownerBox(2));
    if (shown !== LONG) throw new Error(`the select shows "${shown}"`);
    const written = await dialog().getByTestId("seq-owner-name-1").innerText();
    if (written !== `Assigned to ${LONG}`) throw new Error(`the name is not written out: "${written}"`);
    const wbox = await dialog().getByTestId("seq-owner-name-1").boundingBox();
    if (label === "phone" && wbox.x + wbox.width > 390) throw new Error("the long name runs off the phone screen");
    await choose(ownerBox(4), /^lead/i);
    await dialog().getByLabel("Step 2 start").fill(dayIso(3)); await dialog().getByLabel("Step 2 due").fill(dayIso(6));
    if ((await selectedText(ownerBox(2))) !== LONG) throw new Error("editing dates changed the owner");
    await dialog().getByRole("button", { name: "Remove step 1" }).click();
    if ((await dialog().getByLabel("Step 1 name").inputValue()) !== "Storyboard") throw new Error("step 1 is not Storyboard after removing Moodboard");
    if ((await selectedText(ownerBox(1))) !== LONG) throw new Error("removing another step changed the owner");
    if ((await dialog().getByLabel("Step 1 start").inputValue()) !== dayIso(3)) throw new Error("the date moved to another step");
    if (!/^lead/i.test(await selectedText(ownerBox(3)))) throw new Error("the other chosen owner moved");
    await noOverflow(label);
    await page.screenshot({ path: `${SHOTS}/sequence-owner-${label}.png` });
  });
}

await step("saved: the steps appear as requirements with the chosen owners; the default owner is the activation owner", async () => {
  await as("mgr", { width: 1280, height: 900 }); await openForm();
  const names = NAMES;
  for (let n = 0; n < 6; n++) {
    if ((await dialog().getByLabel(`Step ${n + 1} name`).inputValue()) !== names[n]) throw new Error(`step ${n + 1}`);
    await dialog().getByLabel(`Step ${n + 1} start`).fill(dayIso(1 + n * 2)); await dialog().getByLabel(`Step ${n + 1} due`).fill(dayIso(2 + n * 2));
  }
  await choose(ownerBox(2), /Konstantinopoulos/); await choose(ownerBox(5), /^lead/i);        // steps 1, 3, 4, 6 keep the default
  await dialog().getByRole("button", { name: "Add the steps" }).click();
  await until(() => db(`select count(*) from proj_dp_lines where project_id='${PRJ}' and section='content' and removed_at is null`) === "6");
  const owners = db(`select string_agg(description || '=' || coalesce(assignee_id::text, 'none'), ',' order by sort_order) from proj_dp_lines where project_id='${PRJ}' and section='content'`);
  const want = `Moodboard=none,Storyboard=${U}2,First draft=none,Client review=none,Final export=${U}7,On-device test=none`;
  if (owners !== want) throw new Error(`saved owners ${owners}`);
  await page.goto(`${BASE}/projects/${PRJ}/delivery?open=D001`, { waitUntil: "networkidle" });
  const t = (await page.getByTestId("dp-activation-D001").innerText()).replace(/\s+/g, " ");
  if (!t.includes(LONG)) throw new Error("the long owner name is not on the saved Storyboard requirement");
  if (!/Moodboard.*mgr \(accountable owner\)/.test(t)) throw new Error("the default owner is not shown as the accountable owner");
  await page.screenshot({ path: `${SHOTS}/sequence-saved.png`, fullPage: true });
});

await step("released: each task has the right assignee (the chosen person, or the activation owner)", async () => {
  await page.getByTestId("dp-release").click();
  await page.getByRole("dialog").getByRole("button", { name: "Release", exact: true }).click();
  await until(() => db(`select count(*) from proj_tasks where project_id='${PRJ}'`) === "6");
  const got = db(`select string_agg(replace(t.title, 'Photobooth: ', '') || '=' || t.assignee_id::text, ',' order by l.sort_order) from proj_tasks t join proj_dp_lines l on l.task_id = t.id where t.project_id='${PRJ}'`);
  const want = `Moodboard=${U}4,Storyboard=${U}2,First draft=${U}4,Client review=${U}4,Final export=${U}7,On-device test=${U}4`;
  if (got !== want) throw new Error(`task assignees ${got}`);
  const dates = db(`select string_agg(t.start_date::text || '>' || t.due_date::text, ',' order by l.sort_order) from proj_tasks t join proj_dp_lines l on l.task_id = t.id where t.project_id='${PRJ}'`);
  if (dates.split(",")[1] !== `${dayIso(3)}>${dayIso(4)}`) throw new Error(`task dates ${dates}`);
  await page.goto(`${BASE}/projects/${PRJ}/delivery?open=D001`, { waitUntil: "networkidle" });
  const t = (await page.getByTestId("dp-activation-D001").innerText()).replace(/\s+/g, " ");
  if (!/Storyboard.*Konstantinopoulos/.test(t)) throw new Error("the plan does not show the task's assignee");
});

await browser.close();
console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
process.exit(fails ? 1 : 0);
