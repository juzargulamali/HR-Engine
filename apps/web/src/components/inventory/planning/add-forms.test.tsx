/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addRequestLine = vi.fn();
vi.mock("@/lib/actions/inventoryPlanning", () => ({
  addRequestLine: (...a: unknown[]) => addRequestLine(...a),
  expandTechnology: vi.fn(),
  searchItems: vi.fn(async () => ({ error: null, items: [] })),
  lookupEmployees: vi.fn(async () => ({ error: null, people: [] })),
}));

import { InvForm } from "./inv-form";
import { AddLineForm } from "./add-forms";

afterEach(() => cleanup());
beforeEach(() => { addRequestLine.mockReset(); addRequestLine.mockImplementation(() => Promise.resolve({ error: null })); });

const slow = (result: Record<string, unknown> = { error: null }) => () => new Promise((resolve) => setTimeout(() => resolve(result), 30));

describe("the request lines editor sends one request", () => {
  it("on a double click of Add line", async () => {
    addRequestLine.mockImplementation(slow());
    render(<AddLineForm requestId="r1" companyId="c1" />);
    const button = screen.getByRole("button", { name: "Add line" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add line" })).toBeTruthy());
    expect(addRequestLine).toHaveBeenCalledTimes(1);
  });

  it("when the form is submitted twice in the same moment (Enter, then a click), even before the button can be disabled", async () => {
    addRequestLine.mockImplementation(slow());
    const { container } = render(<AddLineForm requestId="r1" companyId="c1" />);
    const form = container.querySelector("form")!;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add line" })).toBeTruthy());
    expect(addRequestLine).toHaveBeenCalledTimes(1);
  });

  it("but a later, deliberate second add is sent: the lock lasts only while the first answer is pending", async () => {
    addRequestLine.mockImplementation(slow());
    render(<AddLineForm requestId="r1" companyId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add line" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    await waitFor(() => expect(addRequestLine).toHaveBeenCalledTimes(2));
  });

  it("sends what was typed, and keeps it when the server refuses", async () => {
    addRequestLine.mockImplementation(slow({ error: "That item is retired and cannot be requested" }));
    render(<AddLineForm requestId="r1" companyId="c1" projectId="p1" />);
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "for the stage left" } });
    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    await screen.findByText("That item is retired and cannot be requested");
    const sent = addRequestLine.mock.calls[0]![1] as FormData;
    expect(sent.get("requestId")).toBe("r1");
    expect(sent.get("projectId")).toBe("p1");
    expect(sent.get("qty")).toBe("7");
    expect(sent.get("note")).toBe("for the stage left");
    expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("7");
    expect((screen.getByLabelText("Note (optional)") as HTMLInputElement).value).toBe("for the stage left");
  });

  it("says so, in words, when the request never reached the server", async () => {
    addRequestLine.mockImplementation(() => Promise.reject(new Error("fetch failed")));
    render(<AddLineForm requestId="r1" companyId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect((await screen.findByRole("alert")).textContent).toContain("nobody knows whether it was saved");
  });
});

describe("InvForm", () => {
  it("shows what the server had to say after a save and closes only when it has been read", async () => {
    const onDone = vi.fn();
    const action = vi.fn(async () => ({ error: null, warning: "3 already dispatched stay outstanding until they are returned." }));
    render(<InvForm action={action} submitLabel="Cancel the line" onDone={onDone}><input name="x" defaultValue="1" /></InvForm>);
    fireEvent.click(screen.getByRole("button", { name: "Cancel the line" }));
    expect(await screen.findByText(/stay outstanding until they are returned/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls onDone at once when there is nothing more to say", async () => {
    const onDone = vi.fn();
    render(<InvForm action={async () => ({ error: null })} submitLabel="Save" onDone={onDone}><input name="x" /></InvForm>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("does not report success, or close, when the server refuses", async () => {
    const onDone = vi.fn();
    render(<InvForm action={async () => ({ error: "You cannot change this request." })} submitLabel="Save" onDone={onDone}><input name="x" /></InvForm>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("You cannot change this request.");
    expect(onDone).not.toHaveBeenCalled();
  });
});
