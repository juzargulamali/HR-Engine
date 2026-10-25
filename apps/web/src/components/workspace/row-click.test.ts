import { describe, expect, it } from "vitest";
import { ROW_INTERACTIVE, shouldOpenRow } from "./row-click";

/** A tiny stand-in for a DOM node: `closest` finds the nearest ancestor (or itself) whose tag/role is in `kinds`. */
const node = (kinds: string[] = []) => ({ closest: (sel: string) => (kinds.some((k) => sel.includes(k)) ? { kind: kinds[0] } : null) });
const row = (containsHit = true) => ({ contains: () => containsHit });
const left = { defaultPrevented: false, button: 0 };

describe("which clicks open a row", () => {
  it("opens from the empty part of the row", () => {
    expect(shouldOpenRow(node(), row(), left, "")).toBe(true);
  });
  it("never opens from a control that has its own job", () => {
    for (const k of ["a[href]", "button", "input", "select", "textarea", "label", "summary", '[role="menu"]', '[role="menuitem"]', "dialog", "[data-row-ignore]"]) {
      expect(ROW_INTERACTIVE).toContain(k);
      expect(shouldOpenRow(node([k]), row(), left, "")).toBe(false);
    }
  });
  it("does not open after the user selected text, with another mouse button, or when something already handled the click", () => {
    expect(shouldOpenRow(node(), row(), left, "some words")).toBe(false);
    expect(shouldOpenRow(node(), row(), { defaultPrevented: false, button: 1 }, "")).toBe(false);
    expect(shouldOpenRow(node(), row(), { defaultPrevented: true, button: 0 }, "")).toBe(false);
    expect(shouldOpenRow(null, row(), left, "")).toBe(false);
  });
  it("ignores an interactive ancestor that is outside the row", () => {
    expect(shouldOpenRow(node(["button"]), row(false), left, "")).toBe(true);
  });
});
