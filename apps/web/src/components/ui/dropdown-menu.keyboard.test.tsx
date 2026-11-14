/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DropdownMenu } from "./dropdown-menu";

afterEach(cleanup);

const Menu = () => (
  <DropdownMenu keyboardNav trigger={({ open, toggle }) => <button type="button" aria-expanded={open} onClick={toggle}>More</button>}>
    <button type="button" role="menuitem">First action</button>
    <button type="button" role="menuitem">Second action</button>
  </DropdownMenu>
);

describe("DropdownMenu: keyboard", () => {
  it("opening puts the focus on the first item; Escape closes the list and returns the focus to the button that opened it", () => {
    render(<Menu />);
    const opener = screen.getByRole("button", { name: "More" });
    fireEvent.click(opener);
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByText("First action"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(opener);
  });
  it("Escape does not move the focus of someone who is not inside the list", () => {
    render(<><Menu /><input aria-label="elsewhere" /></>);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const other = screen.getByLabelText("elsewhere"); other.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(other);
  });
});
