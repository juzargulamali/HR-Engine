/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INV_CAPABILITIES, INV_CAPABILITY_LABELS, type InvCapability } from "@enginious-hr/domain";
import { CapabilityCheckboxes } from "./capability-checkboxes";

afterEach(() => cleanup());
const box = (cap: InvCapability) => screen.getByRole("checkbox", { name: new RegExp(`^${INV_CAPABILITY_LABELS[cap].label}`) }) as HTMLInputElement;

describe("CapabilityCheckboxes", () => {
  it("disables founder, access management and cost rights for someone who is not a founder, and says why", () => {
    render(<CapabilityCheckboxes idPrefix="t" viewerIsFounder={false} />);
    for (const cap of ["founder", "manage_access", "view_costs"] as const) expect(box(cap).disabled).toBe(true);
    for (const cap of INV_CAPABILITIES.filter((c) => !["founder", "manage_access", "view_costs"].includes(c))) expect(box(cap).disabled).toBe(false);
    expect(screen.getByText(/only a founder can give the right to see purchase costs/i)).toBeTruthy();
    expect(screen.getByText(/never part of warehouse access/i)).toBeTruthy();
    expect(screen.getByText(/can only be given by a founder/i)).toBeTruthy();
  });

  it("enables every box for a founder", () => {
    render(<CapabilityCheckboxes idPrefix="t" viewerIsFounder />);
    for (const cap of INV_CAPABILITIES) expect(box(cap).disabled).toBe(false);
  });

  it("shows the plain description of every capability", () => {
    render(<CapabilityCheckboxes idPrefix="t" viewerIsFounder />);
    for (const cap of INV_CAPABILITIES) expect(screen.getByText(INV_CAPABILITY_LABELS[cap].description)).toBeTruthy();
  });

  it("does not let a disabled box be toggled, and reports what is ticked", () => {
    const onChange = vi.fn();
    render(<CapabilityCheckboxes idPrefix="t" viewerIsFounder={false} onChange={onChange} />);
    fireEvent.click(box("view_costs"));
    expect(box("view_costs").checked).toBe(false);
    fireEvent.click(box("warehouse"));
    expect(box("warehouse").checked).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(new Set(["warehouse"]));
  });

  it("keeps the only founder's founder right locked on and still submits it", () => {
    const { container } = render(<form><CapabilityCheckboxes idPrefix="t" viewerIsFounder defaultSelected={["founder"]} lockFounder /></form>);
    expect(box("founder").checked).toBe(true);
    expect(box("founder").disabled).toBe(true);
    const sent = new FormData(container.querySelector("form")!).getAll("capabilities");
    expect(sent).toEqual(["founder"]);
  });
});
