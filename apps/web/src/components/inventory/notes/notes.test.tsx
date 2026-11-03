/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { eventRow, noteRow, noteView, returnNoteRow, statusRow } from "@/test/note-fixtures";

vi.mock("@/lib/actions/inventoryNotes", () => ({ answerNote: vi.fn(), resolveDifference: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { NotesLoadError, NotesSection } from "./notes-section";

const now = new Date("2026-11-16T09:00:00Z");
const render = (notes: ReturnType<typeof noteView>[], opts: { canAnswer?: boolean; canResolve?: boolean } = {}) =>
  renderToStaticMarkup(<NotesSection notes={notes} canAnswer={opts.canAnswer ?? false} canResolveFor={() => opts.canResolve ?? false} now={now} />);

describe("Dispatch & return notes on Project -> Equipment", () => {
  it("draws nothing when the project has no notes (for example the company has not switched notes on)", () => {
    expect(render([])).toBe("");
  });

  it("offers the Project Manager 'Dispatch waiting for you' with Acknowledge, Report a difference and the PDF", () => {
    const html = render([noteView()], { canAnswer: true });
    expect(html).toContain("Dispatch waiting for you");
    expect(html).toContain("ENG-D-00017");
    expect(html).toContain(">Acknowledge<");
    expect(html).toContain("Report a difference");
    expect(html).toContain('href="/projects/p1/equipment/notes/n1/pdf"');
    expect(html).toContain("Download PDF");
    expect(html).toContain("waiting 2 days");
    // what was recorded, in the frozen words
    expect(html).toContain("Laptop 14 inch · Dell · XPS");
    expect(html).toContain("ENG-E-00012 / SN-88123");
    expect(html).toContain("15.25 m");
  });

  it("shows other members the same pending note, without any control to answer", () => {
    const html = render([noteView()], { canAnswer: false });
    expect(html).toContain("Dispatch waiting for the Project Manager");
    expect(html).not.toContain(">Acknowledge<");
    expect(html).not.toContain("Report a difference");
    expect(html).toContain("Download PDF");
  });

  it("returns are 'Returned, please confirm', with the recorded outcome per line and the project totals", () => {
    const html = render([noteView(returnNoteRow(), statusRow({ note_id: "n2", kind: "return", note_no: "ENG-RT-00005" }))], { canAnswer: true });
    expect(html).toContain("Returned, please confirm");
    expect(html).toContain("Confirm this list");
    expect(html).toContain("Back, held for checking: damaged");
    expect(html).toContain("Back, available");
    expect(html).toContain("Project totals after this return");
    expect(html).toContain("Project level");
    expect(html).toMatch(/Sent 12 · back before 0 · back now 10 · still out <strong[^>]*>2<\/strong>/);
    // nothing is attributed to a request line and the PM cannot change a condition
    expect(html).toContain("not per request");
    expect(html).toContain("released only by a warehouse condition check");
  });

  it("an acknowledged note shows who, in what capacity and when, and offers no second acknowledge", () => {
    const s = statusRow({ state: "acknowledged", awaiting: null, acknowledged_at: "2026-11-14T05:10:00Z", acknowledged_by_name: "M. Manager", acknowledged_capacity: "pm" });
    const html = render([noteView(noteRow(), s, [eventRow()])], { canAnswer: true });
    expect(html).toContain("Acknowledged by M. Manager (Project Manager)");
    expect(html).toContain("14 Nov 2026, 09:10 (Asia/Dubai)");
    expect(html).not.toContain(">Acknowledge<");
    expect(html).toContain("Report a difference");
    expect(html).not.toMatch(/signature|signed/i);
  });

  it("an open difference is waiting for the warehouse: the PM can withdraw it, the warehouse can answer it, nobody can acknowledge over it", () => {
    const s = statusRow({ state: "difference_open", awaiting: "warehouse", difference_state: "open", difference_reason: "quantity_differs", difference_lines: [2], difference_reported_at: "2026-11-15T08:00:00Z" });
    const events = [eventRow({ event: "difference_reported", reason: "quantity_differs", lines: [2], comment: "Only 10 arrived" })];
    const pm = render([noteView(noteRow(), s, events)], { canAnswer: true });
    expect(pm).toContain("Difference reported, waiting for the warehouse");
    expect(pm).toContain("Withdraw the report");
    expect(pm).not.toContain(">Acknowledge<");
    expect(pm).not.toContain("Answer the difference");
    expect(pm).toContain("Only 10 arrived");
    const wh = render([noteView(noteRow(), s, events)], { canAnswer: false, canResolve: true });
    expect(wh).toContain("Answer the difference");
    expect(wh).not.toContain("Withdraw the report");
  });

  it("a superseded note keeps its history and points to the note that replaced it", () => {
    const old = noteRow({ id: "n0", note_no: "ENG-D-00016" });
    const nw = noteRow({ replaces_note_id: "n0" });
    const html = renderToStaticMarkup(
      <NotesSection
        notes={[noteView(old, statusRow({ note_id: "n0", note_no: "ENG-D-00016", state: "superseded", superseded_by_note_id: "n1", awaiting: null }), [eventRow({ note_id: "n0" })]), noteView(nw, statusRow({ replaces_note_id: "n0" }))].map((v) => ({ ...v, noteNos: new Map([["n0", "ENG-D-00016"], ["n1", "ENG-D-00017"]]) }))}
        canAnswer canResolveFor={() => false} now={now}
      />,
    );
    expect(html).toContain("Superseded by ENG-D-00017");
    expect(html).toContain("Replaces </dt><dd class=\"inline font-mono\">ENG-D-00016");
    expect(html).toContain("Acknowledged by M. Manager");
  });

  it("a failed read says it could not load and is never an empty section", () => {
    const html = renderToStaticMarkup(<NotesLoadError projectId="p1" />);
    expect(html).toContain("Could not load the dispatch and return notes of this project");
    expect(html).toContain("not an empty list");
    expect(html).toContain('href="/projects/p1/equipment"');
  });
});
