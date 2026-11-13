// Real-browser check: the "Files & client plan" shortcut on Work, as the Project Manager and as a member. LOCAL STACK ONLY; seed first with `seed/budget.sh` (it creates the fictional client
// project "Floor projection delivery" with mgr@ as Project Manager). The link must open THAT project's Files & client plan page (not bounce back), and a person without access must not get it.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
const browser = await chromium.launch();
const P = sql(`select id from proj_projects where kind='client' order by created_at limit 1`);
let fails = 0, passes = 0;
const step = async (name, fn) => { try { await fn(); passes++; console.log("PASS", name); } catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); } };
for (const [who, label] of [["mgr", "the Project Manager"], ["lead", "a project member"]]) {
  await step(`${label}: the Work shortcut opens this project's Files & client plan and stays there`, async () => {
    const page = await newPage(browser, { width: 1280, height: 900 }, "dark"); await login(page, `${who}@e2e.local`);
    await page.goto(`${BASE}/projects/${P}/work`, { waitUntil: "networkidle" });
    const link = page.getByTestId("work-shortcuts").getByRole("link", { name: /Files & client plan/ });
    if ((await link.count()) !== 1) throw new Error("the shortcut is not on the Work page");
    if ((await link.getAttribute("href")) !== `/projects/${P}/documents`) throw new Error(`wrong target: ${await link.getAttribute("href")}`);
    await link.click();
    await page.waitForURL(`**/projects/${P}/documents`, { timeout: 10000 });
    await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
    if (!page.url().endsWith(`/projects/${P}/documents`)) throw new Error(`bounced to ${page.url()}`);
    if (!/Files and links/.test(await page.locator("main").innerText())) throw new Error("the Files page did not render");
    await page.context().close();
  });
}
await step("a person with no access to the project gets neither the shortcut nor the page", async () => {
  const page = await newPage(browser, { width: 1280, height: 900 }, "dark"); await login(page, "emp@e2e.local");
  await page.goto(`${BASE}/projects/${P}/documents`, { waitUntil: "networkidle" });
  if (/Files and links/.test(await page.locator("main").innerText())) throw new Error("the Files page opened for someone without access");
  await page.context().close();
});
console.log(`${passes} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
