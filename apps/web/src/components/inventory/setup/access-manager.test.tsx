/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ grantInventoryAccess: vi.fn(), revokeInventoryAccess: vi.fn(), setInventoryCompanySharing: vi.fn() }));
vi.mock("@/lib/actions/inventorySetup", () => actions);

import { GiveAccessForm, PeopleList, worksAtWords, type AccessLocation, type AccessPersonRow } from "./access-manager";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
});
afterEach(() => cleanup());

const locations: AccessLocation[] = [{ id: "l1", name: "Dubai", isActive: true }, { id: "l2", name: "Riyadh", isActive: true }];
const person = (over: Partial<AccessPersonRow>): AccessPersonRow => ({ userId: "u1", name: "Amina", email: null, capabilities: [], grantedAt: "2026-10-01T00:00:00Z", grantedByName: null, note: null, locationIds: [], ...over });

describe("worksAtWords", () => {
  it("says where a person works", () => {
    expect(worksAtWords({ capabilities: ["founder"], locationIds: [] }, locations)).toMatch(/all locations/i);
    expect(worksAtWords({ capabilities: ["warehouse", "cross_location"], locationIds: [] }, locations)).toBe("All locations");
    expect(worksAtWords({ capabilities: ["warehouse"], locationIds: ["l1", "l2"] }, locations)).toBe("Dubai, Riyadh");
    expect(worksAtWords({ capabilities: ["warehouse"], locationIds: [] }, locations)).toMatch(/no location yet/i);
    expect(worksAtWords({ capabilities: ["view_stock"], locationIds: ["l1"] }, locations)).toBe("—");
  });
});

describe("people with access", () => {
  const list = (viewerIsFounder: boolean, people: AccessPersonRow[]) => render(<PeopleList people={people} companyId="c1" viewerIsFounder={viewerIsFounder} locations={locations} currentUserId="me" />);

  it("lets a non-founder change a warehouse operator but not someone who holds cost or founder rights", () => {
    list(false, [person({ userId: "a", name: "Amina", capabilities: ["warehouse"] }), person({ userId: "b", name: "Omar", capabilities: ["view_costs"] }), person({ userId: "c", name: "Sara", capabilities: ["founder"] })]);
    expect(screen.getByRole("button", { name: /change.*amina/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /change.*omar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /change.*sara/i })).toBeNull();
    expect(screen.getAllByText(/only a founder can change this/i)).toHaveLength(2);
  });

  it("lets a founder change anyone", () => {
    list(true, [person({ userId: "b", name: "Omar", capabilities: ["view_costs"] })]);
    expect(screen.getByRole("button", { name: /change.*omar/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /revoke.*omar/i })).toBeTruthy();
  });

  it("explains an empty list instead of showing nothing", () => {
    list(true, []);
    expect(screen.getByText(/nobody has inventory access/i)).toBeTruthy();
  });

  it("shows the capabilities of a person as plain words", () => {
    list(true, [person({ capabilities: ["warehouse", "confirm_stock"] })]);
    expect(screen.getByText("Warehouse operator")).toBeTruthy();
    expect(screen.getByText("Confirm stock counts")).toBeTruthy();
  });
});

describe("give access", () => {
  it("shows the location list only once a warehouse operator without all-locations is chosen", () => {
    render(<GiveAccessForm companyId="c1" viewerIsFounder={false} staff={[{ id: "u1", name: "Amina", email: null }]} locations={locations} />);
    expect(screen.queryByText(/locations this person works at/i)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Warehouse operator/ }));
    expect(screen.getByText(/locations this person works at/i)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Dubai" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /^All locations/ }));
    expect(screen.queryByText(/locations this person works at/i)).toBeNull();
  });

  it("does not give anyone access by itself", () => {
    render(<GiveAccessForm companyId="c1" viewerIsFounder staff={[{ id: "u1", name: "Amina", email: null }]} locations={locations} />);
    expect(actions.grantInventoryAccess).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Person") as HTMLSelectElement).value).toBe("");
  });
});
