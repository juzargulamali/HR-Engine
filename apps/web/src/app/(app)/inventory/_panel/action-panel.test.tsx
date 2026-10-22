/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvCapability } from "@enginious-hr/domain";
import { candidateBase, type FormContext } from "@/lib/inventory/stock-candidates";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/inventory", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/actions/inventoryStock", () => ({ recordMovement: vi.fn(), checkTransaction: vi.fn(), loadHeldItems: vi.fn(), lookupEmployees: vi.fn(), readCode: vi.fn(), searchStock: vi.fn() }));
const C1 = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";
const R1 = "44444444-4444-4444-8444-444444444444";
const E1 = "55555555-5555-4555-8555-555555555555";
let grants: { companyId: string; capabilities: InvCapability[] }[] = [];
vi.mock("@/lib/inventory/context", () => ({ getInventoryContext: async () => ({ userId: "u", grants }) }));
let form: FormContext;
const resolveCodes = vi.fn(async () => [candidateBase({ key: "u1", type: "unit", unitId: "u1", code: "UAE-E-00042", itemId: "i1", itemName: "Laptop X1", lifecycle: "active", custody: "warehouse", locationId: L1, where: "On the shelf" })]);
vi.mock("@/lib/inventory/stock", () => ({
  loadFormContext: async () => form, resolveCodes: (...a: unknown[]) => (resolveCodes as (...x: unknown[]) => unknown)(...a), employeeNameFor: async () => "Sara Ali",
}));

import { ActionSidePanel, parseAction } from "./action-panel";

const params = { employee: "", project: "", request: "", codes: "", transfer: "", mode: "" };
const render = async (action: Parameters<typeof ActionSidePanel>[0]["action"], over: Partial<typeof params> = {}) =>
  renderToStaticMarkup((await ActionSidePanel({ action, params: { ...params, ...over }, closeHref: "/inventory" })) as React.ReactElement);

beforeEach(() => {
  grants = [{ companyId: C1, capabilities: ["warehouse"] }];
  resolveCodes.mockClear();
  form = {
    locations: [{ id: L1, companyId: C1, companyName: "Enginious", name: "Dubai warehouse", timezone: "Asia/Dubai", bins: [] }], destinations: [],
    projects: [{ id: P1, companyId: C1, reference: "P-7", name: "Mall", status: "active" }],
    requests: [{ id: R1, companyId: C1, code: "REQ-1", kind: "project", projectId: P1, employeeId: null, title: "LED wall", status: "submitted", expectedReturnAt: "2030-01-01T00:00:00Z" }],
    transfers: [], rentals: [], canSeeCostsByCompany: {},
  };
});

describe("parseAction", () => {
  it("accepts only the known panels", () => {
    expect(parseAction("receive")).toBe("receive");
    expect(parseAction("scan")).toBe("scan");
    expect(parseAction("evil")).toBeNull();
    expect(parseAction("")).toBeNull();
  });
});

describe("ActionSidePanel", () => {
  it("opens the scanner for anyone, even someone who cannot operate stock", async () => {
    grants = [{ companyId: C1, capabilities: ["view_stock"] }];
    const html = await render("scan");
    expect(html).toContain("Scan a label");
    expect(html).toContain("Scanning never changes any stock");
  });
  it("tells someone who cannot operate stock that, instead of showing a form", async () => {
    grants = [{ companyId: C1, capabilities: ["view_stock"] }];
    const html = await render("receive");
    expect(html).toContain("for warehouse operators and Inventory founders");
    expect(html).not.toContain("Review");
  });
  it("tells an operator with no location what to do", async () => {
    form = { ...form, locations: [] };
    expect(await render("issue")).toContain("not set up to work at any location");
  });
  it("opens each movement form with its own heading", async () => {
    expect(await render("receive")).toContain("Receive stock");
    expect(await render("issue")).toContain("Issue to a person");
    expect(await render("dispatch")).toContain("Dispatch to a project");
    expect(await render("return")).toContain("Return");
    const transfer = await render("transfer");
    expect(transfer).toContain("Send stock");
    expect(transfer).toContain("Receive a transfer");
  });
  it("prefills a dispatch from the project and request in the address, and the employee for an issue", async () => {
    const dispatch = await render("dispatch", { project: P1, request: R1 });
    expect(dispatch).toContain("REQ-1");
    expect(dispatch).toContain("P-7");
    const issue = await render("issue", { employee: E1 });
    expect(issue).toContain("Sara Ali");
  });
  it("puts a scanned code on the list but never fills in anything that moves stock", async () => {
    const html = await render("issue", { codes: "UAE-E-00042" });
    expect(resolveCodes).toHaveBeenCalled();
    expect(html).toContain("UAE-E-00042");
    expect(html).toContain("Laptop X1");
    expect(html).toContain("Review"); // still has to be reviewed and confirmed
    expect(html).not.toContain("Recorded");
  });
  it("does not use codes to prefill a receipt", async () => {
    await render("receive", { codes: "UAE-E-00042" });
    expect(resolveCodes).not.toHaveBeenCalled();
  });
  it("ignores an id in the address that is not an id", async () => {
    const html = await render("dispatch", { project: "nonsense", request: "nonsense", employee: "nonsense" });
    expect(html).toContain("Dispatch to a project");
  });
});
