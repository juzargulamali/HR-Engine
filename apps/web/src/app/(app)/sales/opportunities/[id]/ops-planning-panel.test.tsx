/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
const actions = vi.hoisted(() => ({ setOpsPlanning: vi.fn(), removeOpsPlanning: vi.fn(), answerOpsQuestion: vi.fn() }));
vi.mock("@/lib/actions/crmOps", () => actions);
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { OPS_NOT_FLAGGED, OPS_NOTE_HINT, OPS_PROVISIONAL_NOTE, OPS_READ_FAILED, OPS_READS_FROM_ENQUIRY, type OpsPlanningFromOperations, type OpsPlanningRead } from "@/lib/crm/ops-planning";
import { OpsPlanningPanel, OpsPlanningSection } from "./ops-planning-panel";

// Fictional enquiry.
const O = "22222222-2222-4222-8222-222222222222";
const base = { id: O, version: 7, stage: "proposal_sent" as const };
const flaggedOpp = {
  ...base, ops_flagged_at: "2026-11-03T08:00:00Z", ops_decision_date: "2026-12-01", ops_dates_tentative: true, ops_dismantle_date: "2027-02-14",
  ops_teams: ["engineering", "installation"], ops_to_confirm: "Stand size and the floor plan", ops_note: "Night build only, access from 22:00",
};
const fromOps = (over: Partial<OpsPlanningFromOperations> = {}): OpsPlanningRead => ({
  kind: "ok",
  planning: { provisionalPm: "Layla Haddad", risk: "medium", riskNote: "Tight build window", capacityConflict: true, capacityNote: "Overlaps the Riyadh install", question: null, questionAt: null, questionBy: null, answer: null, answeredAt: null, ...over },
});
const NOTHING: OpsPlanningRead = { kind: "ok", planning: null };
const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  for (const a of Object.values(actions)) a.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset();
});
afterEach(() => cleanup());

describe("Operations planning: not flagged", () => {
  it("says Operations cannot see the enquiry, that prices, quotes and notes are never shown, and offers the owner the flag button", () => {
    render(<OpsPlanningPanel opp={base} canEdit read={null} />);
    expect(screen.getByRole("heading", { name: "Operations planning" })).toBeTruthy();
    expect(screen.getByText(OPS_NOT_FLAGGED)).toBeTruthy();
    expect(OPS_NOT_FLAGGED).toBe("Operations cannot see this enquiry until it is flagged. Prices, quotes and notes are never shown to Operations.");
    expect(buttons()).toEqual(["Flag for Operations planning"]);
    expect(screen.queryByText("From Operations")).toBeNull();
  });

  it("someone who is not the owner or a Sales founder sees the same state and no button", () => {
    render(<OpsPlanningPanel opp={base} canEdit={false} read={null} />);
    expect(screen.getByText(OPS_NOT_FLAGGED)).toBeTruthy();
    expect(screen.getByText("Only the owner of this enquiry or a Sales founder can flag it.")).toBeTruthy();
    expect(buttons()).toEqual([]);
  });

  it("a lost enquiry cannot be flagged: the reason is said and no button is offered, even to the owner", () => {
    render(<OpsPlanningPanel opp={{ ...base, stage: "lost" }} canEdit read={null} />);
    expect(screen.getByText("A lost enquiry cannot be flagged for Operations planning.")).toBeTruthy();
    expect(buttons()).toEqual([]);
  });

  it("the flag dialog has the planning fields with their labels, says what Operations reads from the enquiry itself, and saves through setOpsPlanning", async () => {
    render(<OpsPlanningPanel opp={base} canEdit read={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Flag for Operations planning" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(OPS_READS_FROM_ENQUIRY)).toBeTruthy();
    for (const word of ["location", "installation and event dates", "technologies", "linked event edition"]) expect(OPS_READS_FROM_ENQUIRY).toContain(word);
    expect(within(dialog).getByLabelText("Expected decision date")).toBeTruthy();
    expect((within(dialog).getByLabelText("Dates are tentative") as HTMLInputElement).checked).toBe(true); // the database default
    expect(within(dialog).getByLabelText("Dismantling date")).toBeTruthy();
    expect(within(dialog).getByRole("group", { name: "Expected teams" })).toBeTruthy();
    for (const team of ["Engineering", "Content", "Programming", "Installation", "Warehouse"]) expect((within(dialog).getByLabelText(team) as HTMLInputElement).checked).toBe(false);
    expect(within(dialog).getByLabelText("Still to confirm")).toBeTruthy();
    expect(within(dialog).getByLabelText("Note for Operations")).toBeTruthy();
    expect(within(dialog).getByText(OPS_NOTE_HINT)).toBeTruthy();
    expect(OPS_NOTE_HINT).toBe("Operations can read this note. Do not put prices or commercial terms here.");

    fireEvent.change(within(dialog).getByLabelText("Expected decision date"), { target: { value: "2026-12-05" } });
    fireEvent.click(within(dialog).getByLabelText("Warehouse"));
    fireEvent.click(within(dialog).getByLabelText("Content"));
    fireEvent.change(within(dialog).getByLabelText("Note for Operations"), { target: { value: "Ceiling rig needed" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Flag for Operations planning" }).closest("form")!);
    await waitFor(() => expect(actions.setOpsPlanning).toHaveBeenCalledTimes(1));
    const sent = actions.setOpsPlanning.mock.calls[0]![1] as FormData;
    expect(sent.get("id")).toBe(O);
    expect(sent.get("expectedVersion")).toBe("7");
    expect(sent.get("decisionDate")).toBe("2026-12-05");
    expect(sent.get("datesTentative")).toBe("on");
    expect(sent.getAll("teams")).toEqual(["content", "warehouse"]);
    expect(sent.get("note")).toBe("Ceiling rig needed");
    // the dialog closes after a successful save
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Operations planning: flagged", () => {
  it("shows what Sales told Operations, with tentative dates, and the two buttons for the owner", () => {
    render(<OpsPlanningPanel opp={flaggedOpp} canEdit read={NOTHING} />);
    expect(screen.getByText("Flagged on").nextElementSibling?.textContent).toMatch(/2026/);
    expect(screen.getByText("Expected decision date").nextElementSibling?.textContent).toMatch(/2026/);
    expect(screen.getByText("Dates are tentative")).toBeTruthy();
    expect(screen.queryByText("Dates confirmed")).toBeNull();
    expect(screen.getByText("Dismantling date").nextElementSibling?.textContent).toMatch(/2027/);
    expect(screen.getByText("Expected teams").nextElementSibling?.textContent).toBe("Engineering, Installation");
    expect(screen.getByText("Still to confirm").nextElementSibling?.textContent).toBe("Stand size and the floor plan");
    expect(screen.getByText("Note for Operations").nextElementSibling?.textContent).toBe("Night build only, access from 22:00");
    expect(buttons()).toEqual(["Edit planning details", "Remove from Operations planning"]);
    // A successful read with nothing in it is its own, plain statement.
    expect(screen.getByText("From Operations")).toBeTruthy();
    expect(screen.getByText("Operations has not recorded anything for this enquiry yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads 'Dates confirmed' once Sales has unticked tentative", () => {
    render(<OpsPlanningPanel opp={{ ...flaggedOpp, ops_dates_tentative: false }} canEdit read={NOTHING} />);
    expect(screen.getByText("Dates confirmed")).toBeTruthy();
    expect(screen.queryByText("Dates are tentative")).toBeNull();
  });

  it("a won enquiry reads 'Confirmed: this enquiry is won' whatever the tick says", () => {
    for (const tentative of [true, false]) {
      render(<OpsPlanningPanel opp={{ ...flaggedOpp, stage: "won", ops_dates_tentative: tentative }} canEdit read={NOTHING} />);
      expect(screen.getByText("Confirmed: this enquiry is won")).toBeTruthy();
      expect(screen.queryByText("Dates are tentative")).toBeNull();
      expect(screen.queryByText("Dates confirmed")).toBeNull();
      cleanup();
    }
  });

  it("shows what Operations recorded: the provisional Project Manager with its warning, risk and capacity conflict with their notes", () => {
    render(<OpsPlanningPanel opp={flaggedOpp} canEdit read={fromOps()} />);
    const pm = screen.getByText("Provisional Project Manager").nextElementSibling!;
    expect(pm.textContent).toContain("Layla Haddad");
    expect(pm.textContent).toContain(OPS_PROVISIONAL_NOTE);
    expect(OPS_PROVISIONAL_NOTE).toBe("Provisional. No project, crew or stock is booked by this.");
    const risk = screen.getByText("Risk").nextElementSibling!;
    expect(risk.textContent).toContain("Medium");
    expect(risk.textContent).toContain("Tight build window");
    const capacity = screen.getAllByText("Capacity conflict")[0]!.nextElementSibling!;
    expect(capacity.textContent).toContain("Overlaps the Riyadh install");
    expect(screen.getByText("Operations has not asked anything.")).toBeTruthy();
    expect(screen.queryByLabelText("Your answer")).toBeNull();
  });

  it("shows Operations' question with an answer box, and posting it calls answerOpsQuestion with the answer and the version", async () => {
    render(<OpsPlanningPanel opp={flaggedOpp} canEdit read={fromOps({ question: "Is the venue ceiling rigged?", questionBy: "Omar Nasser", questionAt: "2026-11-04T09:30:00Z" })} />);
    expect(screen.getByText("Is the venue ceiling rigged?")).toBeTruthy();
    expect(screen.getByText(/Asked by Omar Nasser on /)).toBeTruthy();
    expect(screen.getByText("Not answered yet.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Yes, three points at 500 kg" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer to Operations" }));
    await waitFor(() => expect(actions.answerOpsQuestion).toHaveBeenCalledTimes(1));
    const sent = actions.answerOpsQuestion.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(sent)).toEqual({ id: O, expectedVersion: "7", answer: "Yes, three points at 500 kg" });
    expect(actions.setOpsPlanning).not.toHaveBeenCalled();
  });

  it("an answered question shows the answer, and the owner can replace it", () => {
    render(<OpsPlanningPanel opp={flaggedOpp} canEdit read={fromOps({ question: "Is the venue ceiling rigged?", answer: "Yes, three points", answeredAt: "2026-11-05T10:00:00Z" })} />);
    expect(screen.getByText(/^Answer from Sales, /)).toBeTruthy();
    expect(screen.getByText(/^Answer from Sales, /).nextElementSibling?.textContent).toBe("Yes, three points");
    expect(screen.queryByText("Not answered yet.")).toBeNull();
    expect((screen.getByLabelText("Change your answer") as HTMLTextAreaElement).value).toBe("Yes, three points");
    expect(screen.getByRole("button", { name: "Replace the answer" })).toBeTruthy();
  });

  it("someone who is not the owner or a Sales founder sees everything and has no button and no answer box", () => {
    render(<OpsPlanningPanel opp={flaggedOpp} canEdit={false} read={fromOps({ question: "Is the venue ceiling rigged?" })} />);
    expect(screen.getByText("Dates are tentative")).toBeTruthy();
    expect(screen.getByText("Layla Haddad")).toBeTruthy();
    expect(screen.getByText("Is the venue ceiling rigged?")).toBeTruthy();
    expect(buttons()).toEqual([]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("a failed read of Operations' half says it could not be loaded: never 'nothing recorded', and no answer box", () => {
    render(<OpsPlanningPanel opp={flaggedOpp} canEdit read={{ kind: "failed" }} />);
    expect(screen.getByRole("alert").textContent).toBe(OPS_READ_FAILED);
    expect(OPS_READ_FAILED).toMatch(/could not be loaded/);
    expect(screen.queryByText("Operations has not recorded anything for this enquiry yet.")).toBeNull();
    expect(screen.queryByText("Operations has not asked anything.")).toBeNull();
    expect(screen.queryByText("Nobody named yet")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    // What Sales entered is the enquiry's own data and is still shown, and can still be edited.
    expect(screen.getByText("Night build only, access from 22:00")).toBeTruthy();
    expect(buttons()).toEqual(["Edit planning details", "Remove from Operations planning"]);
  });

  it("the edit dialog opens with what is stored, and Remove asks first and then calls removeOpsPlanning", async () => {
    render(<OpsPlanningPanel opp={flaggedOpp} canEdit read={NOTHING} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit planning details" }));
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByLabelText("Expected decision date") as HTMLInputElement).value).toBe("2026-12-01");
    expect((within(dialog).getByLabelText("Dismantling date") as HTMLInputElement).value).toBe("2027-02-14");
    expect((within(dialog).getByLabelText("Engineering") as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText("Content") as HTMLInputElement).checked).toBe(false);
    expect((within(dialog).getByLabelText("Still to confirm") as HTMLTextAreaElement).value).toBe("Stand size and the floor plan");
    // unticking "tentative" is sent as an absent tick, which the action saves as false
    fireEvent.click(within(dialog).getByLabelText("Dates are tentative"));
    fireEvent.submit(within(dialog).getByRole("button", { name: "Save planning details" }).closest("form")!);
    await waitFor(() => expect(actions.setOpsPlanning).toHaveBeenCalledTimes(1));
    expect((actions.setOpsPlanning.mock.calls[0]![1] as FormData).get("datesTentative")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Remove from Operations planning" }));
    expect(actions.removeOpsPlanning).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog");
    fireEvent.submit(within(confirm).getByRole("button", { name: "Remove from Operations planning" }).closest("form")!);
    await waitFor(() => expect(actions.removeOpsPlanning).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(actions.removeOpsPlanning.mock.calls[0]![1] as FormData)).toEqual({ id: O, expectedVersion: "7" });
  });

  it("a lost enquiry that is still flagged can only be removed", () => {
    render(<OpsPlanningPanel opp={{ ...flaggedOpp, stage: "lost" }} canEdit read={fromOps({ question: "Is the venue ceiling rigged?" })} />);
    expect(buttons()).toEqual(["Remove from Operations planning"]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("Operations planning: reading Operations' half", () => {
  const view = (opp: object, canEdit = true) => ({ opp, canEdit }) as never;

  it("reads nothing for an enquiry that is not flagged, including one from a database without the planning columns", async () => {
    render(await OpsPlanningSection({ view: view(base) }));
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.getByText(OPS_NOT_FLAGGED)).toBeTruthy();
  });

  it("reads crm_ops_planning for a flagged enquiry and shows it", async () => {
    rpc.mockResolvedValue({ data: { provisional_pm: "Layla Haddad", risk: "high", risk_note: null, capacity_conflict: false, capacity_note: null, question: "Which hall?", question_at: "2026-11-04T09:30:00Z", question_by: "Omar Nasser", answer: null, answered_at: null }, error: null });
    render(await OpsPlanningSection({ view: view(flaggedOpp) }));
    expect(rpc).toHaveBeenCalledWith("crm_ops_planning", { p_opportunity_id: O });
    expect(screen.getByText("Layla Haddad")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("None flagged")).toBeTruthy();
    expect(screen.getByText("Which hall?")).toBeTruthy();
  });

  it("a null answer from the function is 'nothing recorded yet', a successful read", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    render(await OpsPlanningSection({ view: view(flaggedOpp) }));
    expect(screen.getByText("Operations has not recorded anything for this enquiry yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an error from the function, or a thrown one, is 'could not be loaded' and never 'nothing recorded'", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.crm_ops_planning in the schema cache" } });
    render(await OpsPlanningSection({ view: view(flaggedOpp) }));
    expect(screen.getByRole("alert").textContent).toBe(OPS_READ_FAILED);
    expect(screen.queryByText("Operations has not recorded anything for this enquiry yet.")).toBeNull();
    cleanup();
    rpc.mockRejectedValue(new Error("fetch failed"));
    render(await OpsPlanningSection({ view: view(flaggedOpp) }));
    expect(screen.getByRole("alert").textContent).toBe(OPS_READ_FAILED);
    quiet.mockRestore();
  });
});
