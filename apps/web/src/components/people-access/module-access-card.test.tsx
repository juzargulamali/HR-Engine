/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ applyModuleAccess: vi.fn(), revokeModuleAccess: vi.fn() }));
vi.mock("@/lib/actions/peopleAccess", () => actions);

import { ModuleAccessCard, worksAtWords, type ModuleAccessCardProps } from "./module-access-card";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  actions.applyModuleAccess.mockReset().mockResolvedValue({ error: null });
  actions.revokeModuleAccess.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => cleanup());

const locations = [{ id: "l1", name: "Dubai", isActive: true }, { id: "l2", name: "Riyadh", isActive: true }];
const props = (over: Partial<ModuleAccessCardProps> = {}): ModuleAccessCardProps => ({
  module: "inventory", company: { id: "c1", name: "Enginious UAE" }, viewerCapabilities: ["manage_access"], person: { userId: "u1", name: "Amina", isSelf: false },
  grant: null, accessManagerCount: 2, founderCount: 1, locations, assignedLocationIds: [], ...over,
});
const held = (capabilities: string[]) => ({ capabilities, grantedAt: "2026-10-01T00:00:00Z", grantedByName: "Rafi", note: null });
const choosePreset = (label: RegExp | string) => {
  const select = screen.getByLabelText(/give access|add to their access/i) as HTMLSelectElement;
  const option = within(select).getByRole("option", { name: label }) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: option.value } });
  fireEvent.click(screen.getByRole("button", { name: /add preset/i }));
};

describe("presets preserve what the person has", () => {
  it("adds a preset on top of existing rights and says exactly what is added, and that nothing is removed", () => {
    render(<ModuleAccessCard {...props({ grant: held(["view_audit"]) })} />);
    choosePreset("Storekeeper");
    const box = screen.getByText(/what this change does/i).parentElement!;
    expect(within(box).getByText("Adds")).toBeTruthy();
    expect(within(box).getByText("Warehouse operator")).toBeTruthy();
    expect(within(box).queryByText("Removes")).toBeNull();
    expect(within(box).getByText(/everything else they have stays as it is/i)).toBeTruthy();
    const posted = [...document.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="capabilities"]')].map((i) => i.value);
    expect(posted).toEqual(["warehouse", "view_audit"]);
  });

  it("shows removals only when a right is unticked, and names them", () => {
    render(<ModuleAccessCard {...props({ grant: held(["warehouse", "view_audit"]) })} />);
    fireEvent.click(screen.getByText(/choose rights one by one/i));
    fireEvent.click(screen.getByLabelText(/read the inventory audit trail/i));
    const box = screen.getByText(/what this change does/i).parentElement!;
    expect(within(box).getByText("Removes")).toBeTruthy();
    expect(within(box).getByText("Read the Inventory audit trail")).toBeTruthy();
  });

  it("keeps the save button off while nothing would change", () => {
    render(<ModuleAccessCard {...props({ grant: held(["warehouse"]) })} />);
    expect((screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/no change\. they keep everything they have now/i)).toBeTruthy();
  });

  it("sends what the person held when the page was loaded, so a stale form is stopped", () => {
    render(<ModuleAccessCard {...props({ grant: held(["warehouse", "view_audit"]) })} />);
    expect((document.querySelector('input[name="before"]') as HTMLInputElement).value).toBe("warehouse,view_audit");
    cleanup();
    render(<ModuleAccessCard {...props({ grant: held([]) })} />);
    expect((document.querySelector('input[name="before"]') as HTMLInputElement).value).toBe("-");
    cleanup();
    render(<ModuleAccessCard {...props()} />);
    expect((document.querySelector('input[name="before"]') as HTMLInputElement).value).toBe("");
  });
});

describe("who may give what (exactly the old screens' rules)", () => {
  it("an access manager who is not a founder cannot pick founder-only presets or tick founder-only rights", () => {
    render(<ModuleAccessCard {...props()} />);
    const select = screen.getByLabelText(/give access/i);
    expect((within(select).getByRole("option", { name: /cost reader/i }) as HTMLOptionElement).disabled).toBe(true);
    expect((within(select).getByRole("option", { name: /inventory founder/i }) as HTMLOptionElement).disabled).toBe(true);
    expect((within(select).getByRole("option", { name: /inventory access manager/i }) as HTMLOptionElement).disabled).toBe(true);
    expect((within(select).getByRole("option", { name: /storekeeper/i }) as HTMLOptionElement).disabled).toBe(false);
    fireEvent.click(screen.getByText(/choose rights one by one/i));
    expect((screen.getByLabelText(/see purchase costs/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/warehouse operator/i) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getAllByText(/only an inventory founder can give founder, access-management or cost rights/i).length).toBeGreaterThan(0);
  });

  it("a founder can pick everything", () => {
    render(<ModuleAccessCard {...props({ viewerCapabilities: ["founder"] })} />);
    const select = screen.getByLabelText(/give access/i);
    for (const name of [/cost reader/i, /inventory founder/i, /inventory access manager/i]) expect((within(select).getByRole("option", { name }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("a non-founder cannot change a person who holds a founder-only right, and is told why", () => {
    render(<ModuleAccessCard {...props({ grant: held(["view_costs"]) })} />);
    expect(screen.getByText(/only a founder can change this person's access/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove access/i })).toBeNull();
  });

  it("Budget has no founder tier: a budget access manager may give any budget right except the approver right (rule R1)", () => {
    render(<ModuleAccessCard {...props({ module: "budget", viewerCapabilities: ["manage_access"] })} />);
    const select = screen.getByLabelText(/give access/i);
    for (const name of [/finance/i, /read only/i, /budget access manager/i]) expect((within(select).getByRole("option", { name }) as HTMLOptionElement).disabled).toBe(false);
    expect((within(select).getByRole("option", { name: /ceo \/ cto approver/i }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getAllByText(/only a ceo \/ cto approver of this company can give or remove the approver right/i).length).toBeGreaterThan(0);
  });

  it("R1: a CEO / CTO approver may give the approver right", () => {
    render(<ModuleAccessCard {...props({ module: "budget", viewerCapabilities: ["manage_access", "executive_approver"] })} />);
    const select = screen.getByLabelText(/give access/i);
    expect((within(select).getByRole("option", { name: /ceo \/ cto approver/i }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("R1: a Finance access manager cannot remove an approver's right, or the approver's access, and is told why", () => {
    render(<ModuleAccessCard {...props({ module: "budget", viewerCapabilities: ["manage_access", "finance"], grant: held(["executive_approver", "view"]) })} />);
    fireEvent.click(screen.getByText(/choose rights one by one/i));
    expect((screen.getByRole("checkbox", { name: /^ceo \/ cto approver/i }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /^read only/i }) as HTMLInputElement).disabled).toBe(false); // other rights of an approver can still be changed
    expect(screen.queryByRole("button", { name: /remove access/i })).toBeNull();
    expect(screen.getByText(/access cannot be removed here\. only a ceo \/ cto approver of this company can withdraw an approver/i)).toBeTruthy();
  });

  it("R2: nobody can add a right to their own access: presets and ticks that would add are disabled, removing is allowed", () => {
    render(<ModuleAccessCard {...props({ module: "budget", viewerCapabilities: ["manage_access", "finance"], person: { userId: "me", name: "Me", isSelf: true }, grant: held(["manage_access", "finance"]) })} />);
    const select = screen.getByLabelText(/add to their access/i);
    expect((within(select).getByRole("option", { name: /read only/i }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getAllByText(/you cannot add rights to your own access/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/choose rights one by one/i));
    expect((screen.getByRole("checkbox", { name: /^read only/i }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /^finance/i }) as HTMLInputElement).disabled).toBe(false); // already held: it may be unticked
  });

  it("R2 in Sales: a founder may still tick anything on their own row (they already hold every right)", () => {
    render(<ModuleAccessCard {...props({ module: "sales", viewerCapabilities: ["founder"], person: { userId: "me", name: "Me", isSelf: true }, grant: held(["founder"]) })} />);
    const select = screen.getByLabelText(/add to their access/i);
    expect((within(select).getByRole("option", { name: /sales lead/i }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("R3 in Sales: an access manager cannot change or withdraw another access manager, but can step down themselves", () => {
    const { unmount } = render(<ModuleAccessCard {...props({ module: "sales", viewerCapabilities: ["manage_access"], grant: held(["manage_access", "assign_owner"]) })} />);
    expect(screen.getByText(/only a founder can change this person's access/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove access/i })).toBeNull();
    unmount();
    render(<ModuleAccessCard {...props({ module: "sales", viewerCapabilities: ["manage_access"], person: { userId: "me", name: "Me", isSelf: true }, grant: held(["manage_access", "assign_owner"]) })} />);
    expect(screen.queryByText(/only a founder can change this person's access/i)).toBeNull();
    expect(screen.getByRole("button", { name: /remove access/i })).toBeTruthy();
  });

  it("warns before the last eligible approver would be removed", () => {
    render(<ModuleAccessCard {...props({ module: "budget", viewerCapabilities: ["manage_access", "executive_approver"], person: { userId: "me", name: "Me", isSelf: true }, grant: held(["manage_access", "executive_approver"]), approverCount: 1, accessManagerCount: 2 })} />);
    fireEvent.click(screen.getByText(/choose rights one by one/i));
    fireEvent.click(screen.getByRole("checkbox", { name: /^ceo \/ cto approver/i }));
    expect(screen.getByText(/only ceo \/ cto approver of/i)).toBeTruthy();
  });

  it("Budget cannot be given with nothing chosen", () => {
    render(<ModuleAccessCard {...props({ module: "budget" })} />);
    expect((screen.getByRole("button", { name: /give access/i }) as HTMLButtonElement).disabled).toBe(true);
    choosePreset("Read only");
    expect((screen.getByRole("button", { name: /give access/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("basic access (no extra rights) can be given in the modules that have it", () => {
    render(<ModuleAccessCard {...props({ module: "sales" })} />);
    expect((screen.getByRole("button", { name: /give access/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/basic access only, with no extra rights/i)).toBeTruthy();
  });
});

describe("last access administrator", () => {
  it("warns before removing the last access manager's right, and before removing their access altogether", () => {
    render(<ModuleAccessCard {...props({ module: "budget", grant: held(["finance", "manage_access"]), accessManagerCount: 1 })} />);
    fireEvent.click(screen.getByText(/choose rights one by one/i));
    fireEvent.click(screen.getByLabelText(/manage budget access/i));
    expect(screen.getByText(/last person who manages this access/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /remove access/i }));
    expect(screen.getAllByText(/last person who manages this access/i).length).toBeGreaterThan(1);
  });

  it("does not warn when another access manager exists", () => {
    render(<ModuleAccessCard {...props({ module: "budget", grant: held(["finance", "manage_access"]), accessManagerCount: 2 })} />);
    fireEvent.click(screen.getByText(/choose rights one by one/i));
    fireEvent.click(screen.getByLabelText(/manage budget access/i));
    expect(screen.queryByText(/last person who manages this access/i)).toBeNull();
  });

  it("warns about the only founder", () => {
    render(<ModuleAccessCard {...props({ module: "projects", viewerCapabilities: ["founder"], grant: held(["founder"]), founderCount: 1 })} />);
    fireEvent.click(screen.getByText(/choose rights one by one/i));
    fireEvent.click(screen.getByLabelText(/^founder/i));
    expect(screen.getByText(/only founder of enginious uae/i)).toBeTruthy();
  });
});

describe("warehouse operators and their locations", () => {
  it("asks for locations when a warehouse operator is chosen, and not when they cover every location", () => {
    render(<ModuleAccessCard {...props()} />);
    expect(screen.queryByText(/locations this person works at/i)).toBeNull();
    choosePreset("Storekeeper");
    expect(screen.getByText(/locations this person works at/i)).toBeTruthy();
    expect(screen.getByText(/cannot operate stock anywhere yet/i)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Dubai"));
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="locationIds"]')].map((i) => i.value)).toEqual(["l1"]);
    expect((document.querySelector('input[name="withLocations"]') as HTMLInputElement).value).toBe("1");
    choosePreset(/stock lead/i);
    expect(screen.queryByText(/locations this person works at/i)).toBeNull();
  });

  it("says in words where the person works", () => {
    expect(worksAtWords(["founder"], [], locations)).toMatch(/all locations/i);
    expect(worksAtWords(["warehouse", "cross_location"], [], locations)).toBe("All locations");
    expect(worksAtWords(["warehouse"], ["l1", "l2"], locations)).toBe("Dubai, Riyadh");
    expect(worksAtWords(["warehouse"], [], locations)).toMatch(/no location yet/i);
    expect(worksAtWords(["view_stock"], ["l1"], locations)).toBe("—");
  });
});

describe("removing access", () => {
  it("asks first, and removes through the module's own revoke action", async () => {
    render(<ModuleAccessCard {...props({ grant: held(["warehouse"]) })} />);
    fireEvent.click(screen.getByRole("button", { name: /remove access to inventory for amina/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/will lose access to inventory for enginious uae straight away/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /^remove access$/i }));
    await vi.waitFor(() => expect(actions.revokeModuleAccess).toHaveBeenCalledTimes(1));
    const sent = actions.revokeModuleAccess.mock.calls[0]![1] as FormData;
    expect([sent.get("module"), sent.get("userId"), sent.get("companyId")]).toEqual(["inventory", "u1", "c1"]);
  });

  it("says so when a person is changing their own access", () => {
    render(<ModuleAccessCard {...props({ module: "sales", grant: held(["assign_owner"]), person: { userId: "me", name: "Me", isSelf: true } })} />);
    fireEvent.click(screen.getByText(/choose rights one by one/i));
    fireEvent.click(screen.getByRole("checkbox", { name: /^assign owners/i }));
    expect(screen.getByText(/you are changing your own access/i)).toBeTruthy();
  });
});
