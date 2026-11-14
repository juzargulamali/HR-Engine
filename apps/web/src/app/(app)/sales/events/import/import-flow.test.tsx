// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/** The import preview: where the rows go (the shared calendar, no company) and what confirming creates and skips. Fictional data only. */
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
import { ImportFlow } from "./import-flow";

const row = (n: number, status: string, over: Record<string, unknown> = {}) => ({ row: n, status, reason: null, note: null, event: "Fictional Import Expo", start: "2099-02-01", end: "2099-02-04", country: "SA", city: "Riyadh", venue: "Fictional Centre", eventIsNew: false, ...over });
const respond = (body: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status < 400, status, json: async () => body })));
const upload = async () => {
  const file = new File(["x"], "calendar.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("Excel or CSV file"), { target: { files: [file] } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check file and preview" })); });
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Import events: the preview", () => {
  it("says the rows go into the one shared calendar (no company) and lists what is created, skipped and blocking", async () => {
    respond({ ok: true, mode: "preview", summary: { fileRows: 3, newEvents: 1, newEditions: 2, present: 1, needsCorrection: 0 }, rows: [row(2, "new_event"), row(3, "new_edition", { eventIsNew: true }), row(4, "present")], ignoredColumns: [], canConfirm: true });
    render(<ImportFlow listHref="/sales/events?company=c1&when=all" />);
    await upload();
    expect(screen.getByTestId("import-scope").textContent).toContain("goes into the one shared calendar: every Enginious company sees the same events, so no company is chosen");
    expect(screen.getByTestId("import-scope").textContent).toContain("no enquiry, account or observation is created or changed");
    const plan = screen.getByTestId("import-plan").textContent;
    expect(plan).toContain("Created: 1 new event and 2 editions.");
    expect(plan).toContain("Skipped: 1 row already in the calendar with the same dates.");
    expect(plan).toContain("Blocking: 0 rows to correct.");
    expect(screen.getByRole("button", { name: "Confirm: add 2 editions" })).toBeTruthy();
  });

  it("a row that needs correcting blocks the whole save, and the preview says so", async () => {
    respond({ ok: true, mode: "preview", summary: { fileRows: 2, newEvents: 0, newEditions: 1, present: 0, needsCorrection: 1 }, rows: [row(2, "new_edition"), row(3, "invalid", { reason: "The end date is before the start date." })], ignoredColumns: [], canConfirm: false });
    render(<ImportFlow />);
    await upload();
    expect(screen.getByTestId("import-plan").textContent).toContain("Blocking: 1 row to correct. Nothing can be saved until the file is corrected.");
    expect((screen.getByRole("button", { name: "Nothing to save yet" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("The end date is before the start date.")).toBeTruthy();
  });

  it("after the import, the way back to the list keeps the company the person came from", async () => {
    respond({ ok: true, mode: "preview", summary: { fileRows: 1, newEvents: 1, newEditions: 1, present: 0, needsCorrection: 0 }, rows: [row(2, "new_event")], ignoredColumns: [], canConfirm: true });
    render(<ImportFlow listHref="/sales/events?company=c1&when=all" />);
    await upload();
    respond({ ok: true, mode: "confirm", summary: { fileRows: 1, newEvents: 1, newEditions: 1, present: 0, needsCorrection: 0 }, added: { events: 1, editions: 1 }, skipped: 0, rows: [] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm: add 1 edition" })); });
    expect(screen.getByRole("link", { name: "View Events & Exhibitions" }).getAttribute("href")).toBe("/sales/events?company=c1&when=all");
  });
});
