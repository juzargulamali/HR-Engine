/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/actions/crm", () => ({ saveCrmSettings: vi.fn() }));
vi.mock("@/lib/actions/quotations", () => ({ saveVatChoice: vi.fn() }));

// Fictional companies. "Enginious Europe" is first by name; the person is employed by Enginious UAE.
const EU = "11111111-1111-4111-8111-111111111111";
const UAE = "22222222-2222-4222-8222-222222222222";
const SAVED = { reference_code: "UAE", default_quote_currency: "AED", response_target_hours: 4, working_calendar: { workdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", holidays: [] }, duplicate_window_days: 180, owner_email_enabled: false, approval_policy: "required", approval_note: null, updated_at: "2026-10-01T08:00:00Z", updated_by: "u1" };
type Grant = { companyId: string; capabilities: string[] };
const ctx: { userId: string; grants: Grant[]; homeCompanyId: string | null; personName: () => string; companies: { id: string; name: string; settings: unknown }[] } = {
  userId: "u1", grants: [], homeCompanyId: UAE, personName: () => "Fictional Founder",
  companies: [{ id: EU, name: "Enginious Europe", settings: null }, { id: UAE, name: "Enginious UAE", settings: SAVED }],
};
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));

let vatRows: { id: string; company_id: string; label: string; kind: string; rate: number | null; active: boolean }[] = [];
let vatError: { message: string } | null = null;
const asked: { table: string; company: unknown }[] = [];
const table = (name: string) => {
  const b: Record<string, unknown> = {};
  let company: unknown;
  b.select = () => b;
  b.in = (_k: string, v: unknown[]) => { company = v[0]; asked.push({ table: name, company }); return name === "companies" ? Promise.resolve({ data: [{ id: company, default_currency: "AED" }], error: null }) : b; };
  b.eq = (_k: string, v: unknown) => { company = v; asked.push({ table: name, company }); return b; };
  b.order = async () => (vatError ? { data: null, error: vatError } : { data: vatRows.filter((r) => r.company_id === company), error: null });
  return b;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: table }) }));

import SalesSettingsPage from "./page";
const show = async (sp: Record<string, string> = {}) => render(<>{await SalesSettingsPage({ searchParams: Promise.resolve(sp) })}</>);
const founder = (...companies: string[]) => { ctx.grants = companies.map((companyId) => ({ companyId, capabilities: ["founder"] })); };

beforeEach(() => {
  asked.length = 0; vatError = null; ctx.homeCompanyId = UAE; founder(EU, UAE);
  ctx.companies[0]!.settings = null; ctx.companies[1]!.settings = SAVED;
  vatRows = [{ id: "v1", company_id: UAE, label: "5%", kind: "rate", rate: 5, active: true }, { id: "v2", company_id: EU, label: "23%", kind: "rate", rate: 23, active: true }];
});
afterEach(() => cleanup());

describe("Sales settings page", () => {
  it("shows ONE company: the person's own, not every company stacked and not the first by name", async () => {
    await show();
    expect(screen.getByTestId("sales-company").getAttribute("data-company-id")).toBe(UAE);
    expect(screen.getAllByRole("form").filter((f) => f.getAttribute("aria-label")?.startsWith("Sales settings for"))).toHaveLength(1);
    expect(screen.getByRole("form", { name: "Sales settings for Enginious UAE" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Sales settings for Enginious Europe" })).toBeNull();
    expect(screen.getByRole("heading", { name: "VAT choices for Enginious UAE" })).toBeTruthy();
    expect(screen.getByText("5%")).toBeTruthy();
    expect(screen.queryByText("23%")).toBeNull();
    // Only that company's rows were asked for.
    expect(asked.every((a) => a.company === UAE)).toBe(true);
    // No "All my companies" here: settings belong to one company.
    expect(screen.queryByRole("link", { name: "All my companies" })).toBeNull();
    expect(screen.getByTestId("sales-company").querySelector(`a[href="/sales/settings?company=${EU}"]`)?.textContent).toBe("Enginious Europe");
  });

  it("the company in the address wins (a link from Reports or an enquiry form names it)", async () => {
    await show({ company: EU });
    expect(screen.getByRole("form", { name: "Sales settings for Enginious Europe" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Set up Sales for Enginious Europe" }).length).toBeGreaterThan(0);
  });

  it("lists what is not set AND blocks work first, above every setting, each with a jump link to its group", async () => {
    await show({ company: EU });
    const block = screen.getByTestId("settings-blockers");
    expect(block.textContent).toContain("Not set for Enginious Europe, and blocking work");
    expect(block.textContent).toContain("Enquiries cannot be recorded and estimates cannot be numbered");
    expect(block.textContent).toContain("Nobody can request or give a commercial approval");
    const jumps = Array.from(block.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(jumps).toEqual(["#estimates-vat", "#commercial-approval"]);
    for (const j of jumps) expect(document.querySelector(j!)).not.toBeNull();
    const form = screen.getByRole("form", { name: "Sales settings for Enginious Europe" });
    expect(block.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a company with everything set shows no blocking list; a missing response target is said on its own group, not as a blocker", async () => {
    ctx.companies[1]!.settings = { ...SAVED, response_target_hours: null };
    await show();
    expect(screen.queryByTestId("settings-blockers")).toBeNull();
    expect(screen.getByText("No target yet")).toBeTruthy();
  });

  it("no VAT choice in use is a blocker (an estimate cannot be issued); a failed read of the choices says it could not load and claims nothing", async () => {
    vatRows = [{ id: "v1", company_id: UAE, label: "5%", kind: "rate", rate: 5, active: false }];
    await show();
    expect(screen.getByTestId("settings-blockers").textContent).toContain("No VAT choice is in use");
    cleanup();
    vatError = { message: "timeout" };
    await show();
    expect(screen.queryByTestId("settings-blockers")).toBeNull();
    expect(screen.getByText(/Could not load the VAT choices/)).toBeTruthy();
  });

  it("names the other companies that cannot take enquiries yet, with the way to each", async () => {
    await show();
    const note = screen.getByTestId("settings-other-companies");
    expect(note.textContent).toContain("One other company has no Sales settings yet");
    expect(note.querySelector("a")!.getAttribute("href")).toBe(`/sales/settings?company=${EU}#estimates-vat`);
  });

  it("several companies and nothing to go on: asks which company, shows no settings", async () => {
    ctx.homeCompanyId = null;
    await show();
    expect(screen.getByTestId("sales-choose-company").textContent).toContain("Choose a company above to see its Sales settings");
    expect(screen.queryByRole("form")).toBeNull();
    expect(asked).toEqual([]);
  });

  it("someone who may read but not change the settings gets the read-only list, no form, no Save and no Add VAT choice", async () => {
    ctx.grants = [{ companyId: UAE, capabilities: [] }, { companyId: EU, capabilities: [] }];
    await show();
    expect(screen.getByTestId("settings-access").textContent).toBe("You can read these settings but not change them. Ask a founder, or someone allowed to manage Sales settings, to change them.");
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Save|^Set up|^Add VAT/ })).toBeNull();
    expect(screen.getByText("Reference code")).toBeTruthy();
    expect(screen.getByText("4 working hours")).toBeTruthy();
    expect(screen.getByText("Last changed")).toBeTruthy();
    expect(document.querySelector("#response-targets")).not.toBeNull();   // the address Reports links to still lands on the page
  });
});
