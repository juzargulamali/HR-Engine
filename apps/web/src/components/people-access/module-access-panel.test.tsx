/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ applyModuleAccess: vi.fn(), revokeModuleAccess: vi.fn() }));
vi.mock("@/lib/actions/peopleAccess", () => actions);

import { ModuleAccessPanel, defaultAccessCompany, type ModuleAccessPanelProps } from "./module-access-panel";
import type { PaGrant, PaModuleContext } from "@/lib/people-access/data";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  actions.applyModuleAccess.mockReset().mockResolvedValue({ error: null });
  actions.revokeModuleAccess.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => cleanup());

const UAE = { id: "c1", name: "Enginious UAE" }, PL = { id: "c2", name: "Enginious Poland" };
const locations = [{ id: "l1", name: "Dubai", isActive: true }, { id: "l2", name: "Riyadh", isActive: true }];
const ctx = (module: PaModuleContext["module"], company = UAE, over: Partial<PaModuleContext> = {}): PaModuleContext =>
  ({ module, company, viewerCapabilities: ["manage_access"], isFounder: false, holders: [{ userId: "m", capabilities: ["manage_access"] }], locations: module === "inventory" ? locations : [], readFailed: false, ...over });
const grant = (module: PaGrant["module"], capabilities: string[], companyId = "c1"): PaGrant => ({ module, companyId, userId: "u1", capabilities, grantedAt: "2026-10-01T00:00:00Z", grantedByName: "Rafi", note: null });
const props = (over: Partial<ModuleAccessPanelProps> = {}): ModuleAccessPanelProps => ({
  person: { userId: "u1", name: "Amina", isSelf: false, employeeCompanyId: "c1" },
  contexts: [ctx("sales"), ctx("inventory"), ctx("budget")], grants: [], operatorLocations: {}, retryHref: "/people-access?person=u:u1&tab=modules", ...over,
});
const card = (name: RegExp) => screen.getByRole("region", { name });
const edit = (module: RegExp) => fireEvent.click(within(card(module)).getByRole("button", { name: /edit access|give access/i }));
const posted = () => [...document.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="capabilities"]')].map((i) => i.value);
const save = () => screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;

describe("one explicit company context", () => {
  it("defaults to the employment company when the viewer is authorised for it, else the first managed company", () => {
    expect(defaultAccessCompany("c2", [UAE, PL])).toBe("c2");
    expect(defaultAccessCompany("c9", [UAE, PL])).toBe("c1");
    expect(defaultAccessCompany(null, [])).toBeNull();
    render(<ModuleAccessPanel {...props({ person: { userId: "u1", name: "Amina", isSelf: false, employeeCompanyId: "c2" }, contexts: [ctx("sales"), ctx("sales", PL)], grants: [grant("sales", ["assign_owner", "reopen_closed"], "c2")] })} />);
    expect((screen.getByLabelText("Access for company") as HTMLSelectElement).value).toBe("c2");
    expect(within(card(/sales & crm access/i)).getByText("Sales lead")).toBeTruthy();
  });

  it("switching company shows only that company's modules and saves nothing", () => {
    render(<ModuleAccessPanel {...props({ contexts: [ctx("sales"), ctx("sales", PL)], grants: [grant("sales", ["assign_owner", "reopen_closed"], "c1")] })} />);
    expect(within(card(/sales & crm access/i)).getByText("Sales lead")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Access for company"), { target: { value: "c2" } });
    expect(within(card(/sales & crm access/i)).getByText(/no access to sales & crm in enginious poland/i)).toBeTruthy();
    expect(actions.applyModuleAccess).not.toHaveBeenCalled();
    expect(actions.revokeModuleAccess).not.toHaveBeenCalled();
  });

  it("warns before discarding unsaved edits, and keeps them when the person keeps editing", () => {
    render(<ModuleAccessPanel {...props({ contexts: [ctx("sales"), ctx("sales", PL)] })} />);
    edit(/sales & crm access/i);
    fireEvent.click(screen.getByRole("radio", { name: /^sales lead/i }));
    fireEvent.change(screen.getByLabelText("Access for company"), { target: { value: "c2" } });
    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /keep editing/i }));
    expect((screen.getByLabelText("Access for company") as HTMLSelectElement).value).toBe("c1");
    expect(screen.getByRole("region", { name: /edit sales & crm access/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Access for company"), { target: { value: "c2" } });
    fireEvent.click(screen.getByRole("button", { name: /discard and switch/i }));
    expect((screen.getByLabelText("Access for company") as HTMLSelectElement).value).toBe("c2");
    expect(actions.applyModuleAccess).not.toHaveBeenCalled();
  });

  it("does not ask when nothing was changed", () => {
    render(<ModuleAccessPanel {...props({ contexts: [ctx("sales"), ctx("sales", PL)] })} />);
    edit(/sales & crm access/i);
    fireEvent.change(screen.getByLabelText("Access for company"), { target: { value: "c2" } });
    expect((screen.getByLabelText("Access for company") as HTMLSelectElement).value).toBe("c2");
  });
});

describe("No access, could not load, and can't manage are different", () => {
  it("says No access only after a successful read", () => {
    render(<ModuleAccessPanel {...props()} />);
    expect(within(card(/sales & crm access/i)).getByText(/no access to sales & crm/i)).toBeTruthy();
  });
  it("says could not load, with a retry, when the read failed", () => {
    render(<ModuleAccessPanel {...props({ contexts: [ctx("sales", UAE, { readFailed: true })] })} />);
    const c = card(/sales & crm access/i);
    expect(within(c).getByText(/could not load sales & crm access/i)).toBeTruthy();
    expect(within(c).queryByText(/no access to/i)).toBeNull();
    expect(within(c).getByRole("link", { name: /try again/i }).getAttribute("href")).toContain("/people-access");
    expect(within(c).queryByRole("button")).toBeNull();
  });
  it("says You can't manage this module, and claims nothing about access, for a module the viewer does not manage", () => {
    render(<ModuleAccessPanel {...props({ contexts: [ctx("sales")] })} />);
    const c = card(/inventory access/i);
    expect(within(c).getByText(/you can't manage this module/i)).toBeTruthy();
    expect(within(c).queryByText(/no access to/i)).toBeNull();
    expect(within(c).queryByRole("button")).toBeNull();
  });
});

describe("overview cards recognise access from capabilities", () => {
  it("shows the profile, extras, assigned warehouses and Custom access", () => {
    render(<ModuleAccessPanel {...props({ grants: [grant("inventory", ["warehouse", "view_audit"]), grant("sales", ["manage_settings"])], operatorLocations: { c1: ["l2"] } })} />);
    const inv = card(/inventory access/i);
    expect(within(inv).getByText("Warehouse operator")).toBeTruthy();
    expect(within(inv).getByText(/\+ Read the Inventory audit trail/)).toBeTruthy();
    expect(within(inv).getByText(/works at: riyadh/i)).toBeTruthy();
    expect(within(card(/sales & crm access/i)).getByText("Custom access")).toBeTruthy();
  });
});

describe("editing is predictable", () => {
  it("opening the editor changes nothing and Save stays off; Cancel closes without saving", () => {
    render(<ModuleAccessPanel {...props({ grants: [grant("sales", ["assign_owner", "reopen_closed"])] })} />);
    edit(/sales & crm access/i);
    expect(save().disabled).toBe(true);
    expect(screen.getByText(/no change yet/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(actions.applyModuleAccess).not.toHaveBeenCalled();
  });

  it("switching profile replaces only the previous bundle, keeps custom rights listed, and removals need explicit confirmation", () => {
    render(<ModuleAccessPanel {...props({ grants: [grant("sales", ["assign_owner", "reopen_closed", "view_audit"])] })} />);
    edit(/sales & crm access/i);
    fireEvent.click(screen.getByRole("radio", { name: /^sales colleague/i }));
    expect(posted()).toEqual(["view_audit"]);
    const review = screen.getByText(/review before saving/i).parentElement!;
    expect(within(review).getByText("Rights removed")).toBeTruthy();
    expect(within(review).getByText("Custom rights kept")).toBeTruthy();
    expect(within(review).getAllByText("Read the Sales audit trail").length).toBeGreaterThan(0);
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/i confirm these rights are removed/i));
    expect(save().disabled).toBe(false);
    // going back to the original profile leaves nothing to save
    fireEvent.click(screen.getByRole("radio", { name: /^sales lead/i }));
    expect(posted().sort()).toEqual(["assign_owner", "reopen_closed", "view_audit"]);
    expect(save().disabled).toBe(true);
  });

  it("a new profile is only a draft: choosing it saves nothing, and Save sends exactly the reviewed capabilities with the stale-edit token", () => {
    render(<ModuleAccessPanel {...props({ grants: [grant("budget", ["view"])] })} />);
    edit(/project budgets access/i);
    fireEvent.click(screen.getByRole("radio", { name: /^finance/i }));
    expect(actions.applyModuleAccess).not.toHaveBeenCalled();
    expect(posted()).toEqual(["finance"]);
    expect((document.querySelector('input[name="before"]') as HTMLInputElement).value).toBe("view");
    fireEvent.click(screen.getByLabelText(/i confirm these rights are removed/i));
    expect(save().disabled).toBe(false);
    fireEvent.submit(save().closest("form")!);
    expect(actions.applyModuleAccess).toHaveBeenCalledTimes(1);
    const fd = actions.applyModuleAccess.mock.calls[0]![1] as FormData;
    expect(fd.getAll("capabilities")).toEqual(["finance"]);
    expect(fd.get("module")).toBe("budget");
    expect(fd.get("companyId")).toBe("c1");
  });

  it("revocation is a separate, clearly labelled action", () => {
    render(<ModuleAccessPanel {...props({ grants: [grant("sales", [])] })} />);
    edit(/sales & crm access/i);
    expect(screen.getByRole("button", { name: /remove all access to this module/i })).toBeTruthy();
  });

  it("Projects shows the PM sentence and offers no PM or founder profile", () => {
    render(<ModuleAccessPanel {...props({ contexts: [ctx("projects")], grants: [grant("projects", [])] })} />);
    edit(/projects & tasks access/i);
    expect(screen.getByText("PM assignment and project team membership are managed on the project or handover.")).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /^project directory viewer/i })).toBeTruthy();
  });
});

describe("Inventory warehouse scope is an explicit choice", () => {
  it("Warehouse lead needs the scope chosen before save and never grants all locations silently", () => {
    render(<ModuleAccessPanel {...props()} />);
    edit(/inventory access/i);
    fireEvent.click(screen.getByRole("radio", { name: /^warehouse lead/i }));
    expect(screen.getByText(/choose a warehouse scope before saving/i)).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/all locations of this company/i));
    expect(posted()).toEqual(["warehouse", "cross_location"]);
    expect(save().disabled).toBe(false);
    fireEvent.click(screen.getByLabelText(/chosen warehouses only/i));
    expect(posted()).toEqual(["warehouse"]);
    expect(screen.getByText(/tick at least one warehouse/i)).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Riyadh"));
    expect(save().disabled).toBe(false);
    expect([...document.querySelectorAll<HTMLInputElement>('input[name="locationIds"]')].map((i) => i.value)).toEqual(["l2"]);
  });
});

describe("Advanced access and who may grant what", () => {
  it("keeps every right under four groups, collapsed by default", () => {
    render(<ModuleAccessPanel {...props({ grants: [grant("inventory", ["warehouse"])] })} />);
    edit(/inventory access/i);
    const details = screen.getByText("Advanced access").closest("details")!;
    expect(details.hasAttribute("open")).toBe(false);
    for (const g of [/specialist operational rights/i, /sensitive visibility/i, /^configuration$/i, /access administration and founder powers/i]) expect(within(details).getByText(g)).toBeTruthy();
    expect(within(details).getAllByRole("checkbox")).toHaveLength(11);
  });

  it("an access manager who is not a founder cannot tick founder-only rights", () => {
    render(<ModuleAccessPanel {...props({ grants: [grant("inventory", ["warehouse"])], operatorLocations: { c1: ["l1"] } })} />);
    edit(/inventory access/i);
    for (const name of [/see purchase costs/i, /^founder/i, /manage inventory access/i]) expect((screen.getByRole("checkbox", { name }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /confirm stock counts/i }) as HTMLInputElement).disabled).toBe(false);
  });

  it("the approver profile is not available to a budget manager who is not an approver", () => {
    render(<ModuleAccessPanel {...props({ grants: [grant("budget", ["view"])] })} />);
    edit(/project budgets access/i);
    expect((screen.getByRole("radio", { name: /^executive approver/i }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /^finance/i }) as HTMLInputElement).disabled).toBe(false);
  });

  it("a person who cannot grant a right cannot reach Save with it", () => {
    render(<ModuleAccessPanel {...props({ grants: [grant("inventory", ["warehouse"])], operatorLocations: { c1: ["l1"] } })} />);
    edit(/inventory access/i);
    fireEvent.click(screen.getByRole("checkbox", { name: /confirm stock counts/i }));
    expect(save().disabled).toBe(false);
    expect(posted()).toEqual(["warehouse", "confirm_stock"]);
  });
});
