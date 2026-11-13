// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const reorder = vi.fn();
vi.mock("@/lib/actions/projectsDeliveryPlan", () => ({ reorderPlanLines: (...a: unknown[]) => reorder(...a) }));
import { ReorderableLines } from "./reorderable-lines";

beforeEach(() => { reorder.mockReset(); reorder.mockResolvedValue({ error: null, notice: "Order saved." }); });
afterEach(cleanup);
const ROWS = ["L0001", "L0002", "L0003", "L0004"].map((k, n) => ({ id: `id-${n + 1}`, label: k, node: <p>{k} row</p> }));
const labels = () => within(screen.getByTestId("reorder-list")).getAllByRole("listitem").map((li) => li.getAttribute("data-testid")!.replace("reorder-row-", ""));
const sent = (call = 0) => (reorder.mock.calls[call]![1] as FormData).getAll("lineId");
const show = (over: Partial<React.ComponentProps<typeof ReorderableLines>> = {}) => render(<ReorderableLines projectId="p1" itemId="i1" sectionLabel="Hardware" rows={ROWS} enabled {...over} />);

describe("ReorderableLines", () => {
  it("shows no controls when the person cannot edit the section or there is a single row", () => {
    show({ enabled: false });
    expect(screen.queryByTestId("reorder-list")).toBeNull();
    expect(screen.queryByRole("button", { name: /Move L0001/ })).toBeNull();
    cleanup();
    show({ rows: ROWS.slice(0, 1) });
    expect(screen.queryByTestId("grip-L0001")).toBeNull();
  });

  it("the keyboard alternative: Tab to a labelled button and press Enter; the row moves, the whole new order is saved once, and focus stays on the control", async () => {
    show();
    const down = screen.getByRole("button", { name: "Move L0001 down" });
    expect((screen.getByRole("button", { name: "Move L0001 up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move L0004 down" }) as HTMLButtonElement).disabled).toBe(true);
    down.focus();
    fireEvent.click(down);
    expect(labels()).toEqual(["L0002", "L0001", "L0003", "L0004"]);
    await waitFor(() => expect(reorder).toHaveBeenCalledTimes(1));
    const fd = reorder.mock.calls[0]![1] as FormData;
    expect([fd.get("projectId"), fd.get("itemId")]).toEqual(["p1", "i1"]);
    expect(sent()).toEqual(["id-2", "id-1", "id-3", "id-4"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move L0001 down" }));
    expect(screen.getByTestId("reorder-announce").textContent).toBe("L0001 moved to position 2 of 4.");
    await waitFor(() => expect(screen.getByTestId("reorder-status").textContent).toBe("Order saved."));
  });

  it("arrow keys on the grip move the row too", async () => {
    show();
    const grip = screen.getByTestId("grip-L0003");
    grip.focus();
    fireEvent.keyDown(grip, { key: "ArrowUp" });
    expect(labels()).toEqual(["L0001", "L0003", "L0002", "L0004"]);
    expect(document.activeElement).toBe(screen.getByTestId("grip-L0003"));
    fireEvent.keyDown(screen.getByTestId("grip-L0003"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByTestId("grip-L0003"), { key: "ArrowUp" });          // already first: nothing moves, nothing is saved
    await waitFor(() => expect(reorder).toHaveBeenCalledTimes(2));
    expect(labels()).toEqual(["L0003", "L0001", "L0002", "L0004"]);
    expect(sent(1)).toEqual(["id-3", "id-1", "id-2", "id-4"]);
  });

  it("dragging the grip of one row onto another moves it there and saves the new order", async () => {
    show();
    const li = (k: string) => screen.getByTestId(`reorder-row-${k}`);
    fireEvent.dragStart(screen.getByTestId("grip-L0001"), { dataTransfer: { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" } });
    fireEvent.dragOver(li("L0003"));
    fireEvent.drop(li("L0003"));
    expect(labels()).toEqual(["L0002", "L0003", "L0001", "L0004"]);
    await waitFor(() => expect(reorder).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual(["id-2", "id-3", "id-1", "id-4"]);
    // dropping a row on itself changes nothing
    fireEvent.dragStart(screen.getByTestId("grip-L0004"), { dataTransfer: { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" } });
    fireEvent.drop(li("L0004"));
    expect(reorder).toHaveBeenCalledTimes(1);
  });

  it("quick successive moves are saved one after the other, each with the full order at that moment, never overlapping", async () => {
    let release!: () => void;
    reorder.mockImplementationOnce(() => new Promise((r) => { release = () => r({ error: null, notice: "Order saved." }); }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Move L0001 down" }));
    fireEvent.click(screen.getByRole("button", { name: "Move L0004 up" }));
    await waitFor(() => expect(reorder).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("reorder-status").textContent).toBe("Saving the order…");
    await act(async () => { release(); });
    await waitFor(() => expect(reorder).toHaveBeenCalledTimes(2));
    expect(sent(0)).toEqual(["id-2", "id-1", "id-3", "id-4"]);
    expect(sent(1)).toEqual(["id-2", "id-1", "id-4", "id-3"]);
    expect(labels()).toEqual(["L0002", "L0001", "L0004", "L0003"]);
  });

  it("a refused save says so and puts the saved order back", async () => {
    reorder.mockResolvedValue({ error: "Only the Project Manager, or the person this section was delegated to, can change this section" });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Move L0002 up" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Only the Project Manager/));
    expect(labels()).toEqual(["L0001", "L0002", "L0003", "L0004"]);
  });

  it("a new order from the server (after a save, or another person's change) is what is drawn", () => {
    const { rerender } = show();
    rerender(<ReorderableLines projectId="p1" itemId="i1" sectionLabel="Hardware" enabled rows={[ROWS[3]!, ROWS[0]!, ROWS[1]!, ROWS[2]!]} />);
    expect(labels()).toEqual(["L0004", "L0001", "L0002", "L0003"]);
  });
});
