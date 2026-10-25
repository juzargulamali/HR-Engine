/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

import { SidePanel } from "./side-panel";

beforeEach(() => push.mockClear());
afterEach(() => cleanup());

const esc = () => fireEvent.keyDown(document, { key: "Escape" });

describe("SidePanel Escape", () => {
  it("closes the panel", () => {
    render(<SidePanel title="Record" closeHref="/list"><p>body</p></SidePanel>);
    esc();
    expect(push).toHaveBeenCalledWith("/list", { scroll: false });
  });

  it("does not close the panel while a ... menu inside it is open (Escape closes the menu first)", () => {
    render(<SidePanel title="Record" closeHref="/list"><div role="menu"><button role="menuitem">Add unit</button></div></SidePanel>);
    esc();
    expect(push).not.toHaveBeenCalled();
  });

  it("closes the panel when the only menu in it is closed (hidden, inert)", () => {
    render(<SidePanel title="Record" closeHref="/list"><div role="menu" {...{ inert: true }}><button role="menuitem">Add unit</button></div></SidePanel>);
    esc();
    expect(push).toHaveBeenCalledWith("/list", { scroll: false });
  });
});
