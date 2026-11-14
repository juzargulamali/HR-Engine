/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/actions/crm", () => ({}));
// The forms themselves are tested where they live: here only which one each button opens.
const { dialog } = vi.hoisted(() => ({ dialog: (name: string) => ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label={name} /> : null) }));
vi.mock("@/components/sales/follow-up-dialogs", () => ({ CompleteFollowUpDialog: dialog("complete"), RescheduleFollowUpDialog: dialog("reschedule"), NewFollowUpButton: ({ label }: { label: string }) => <button type="button">{label}</button> }));
vi.mock("./assign-owner", () => ({ AssignOwnerDialog: dialog("assign") }));
vi.mock("./edit-details", () => ({ EditDetailsDialog: dialog("edit"), EditDetailsButton: () => null }));
vi.mock("./reopen-dialog", () => ({ ReopenDialog: dialog("reopen") }));
vi.mock("./log-activity-button", () => ({ LogActivityDialog: dialog("log") }));
vi.mock("./stage-actions", () => ({ HoldDialog: dialog("hold"), ResumeDialog: dialog("resume"), MoveStageDialog: ({ open, options }: { open: boolean; options: { label: string }[] }) => (open ? <div role="dialog" aria-label="move">{options.map((o) => o.label).join(",")}</div> : null) }));

import type { DetailSection } from "@/lib/crm/data";
import type { PrimaryAction } from "./primary-action";
import { SummaryActions } from "./summary-actions";
import { buildSummaryActions, MOVES_NOT_OFFERED, REOPEN_NOT_OFFERED } from "./summary-props";
import { buildOppView } from "./view";

afterEach(() => cleanup());

// Fictional data only.
const baseOpp = {
  id: "o1", company_id: "c1", owner_id: "u1", reference: "OPP-QA-2026-0001", title: "Fictional launch", stage: "qualified", currency: "AED", version: 3, stage_before_hold: null, stage_before_close: null,
  technologies: [], risks: [], event_edition_id: null,
};
const founder = { userId: "u1", grants: [{ companyId: "c1", capabilities: ["founder"] }], companies: [{ id: "c1", name: "Fictional Co", settings: null }], people: [{ id: "u1", name: "Fictional Fiona", companyIds: ["c1"] }, { id: "u2", name: "Fictional Sami", companyIds: ["c1"] }], personName: () => "Fictional Fiona", companyName: () => "Fictional Co" };
const colleague = { ...founder, userId: "u2", grants: [{ companyId: "c1", capabilities: [] }] };
const fu = (o: Record<string, unknown> = {}) => ({ id: "f1", opportunity_id: "o1", title: "Call the client", due_at: "2030-01-01T06:00:00Z", status: "open", assigned_to: "u1", kind: "call", ...o });
const view = (o: { stage?: string; ctx?: unknown; followUps?: unknown[]; failed?: DetailSection[]; opp?: Record<string, unknown> } = {}) => {
  const followUps = o.followUps ?? [fu()];
  const opp = { ...baseOpp, stage: o.stage ?? "qualified", ...o.opp };
  const detail = {
    item: { opp, value: 100, companyName: "Fictional Co", ownerName: "Fictional Fiona", agency: null, client: null, nextFollowUp: followUps[0] ?? null, openFollowUps: followUps.length, availability: "unverified" },
    contacts: [], activities: [], followUps, events: [], files: [], proposals: [], zoho: null, approvals: [], handover: null, closures: [], estimateSends: [], estimateSendsInstalled: true,
  };
  return buildOppView((o.ctx ?? founder) as never, detail as never, new Set(o.failed ?? []));
};
const complete: PrimaryAction = { kind: "complete_follow_up", label: "Complete follow-up", why: "The next action is planned." };
const menu = () => { fireEvent.click(screen.getByRole("button", { name: /More/ })); return screen.getAllByRole("menuitem").map((m) => m.textContent ?? ""); };
const names = (items: string[]) => items.map((t) => ["Complete follow-up", "Reschedule follow-up", "Edit details", "Edit value", "Assign owner", "Move to another stage", "Put on hold", "Resume", "Close as won", "Close as lost", "Reopen", "Handover package"].find((n) => t.startsWith(n)) ?? t);

describe("what the summary offers follows the same permission view as the tabs", () => {
  it("owner or founder of an active enquiry: everything the old button row had, and nothing is dropped", () => {
    const p = buildSummaryActions(view(), complete);
    expect(p.followUp).toMatchObject({ id: "f1", isOnlyOpen: true });
    expect(p.move && "options" in p.move && p.move.options.map((o) => o.id)).toEqual(["new", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation"]);
    expect(p).toMatchObject({ canHold: true, resume: null, close: { won: true, lost: true }, edit: { mode: "full" }, assign: { currentOwnerId: "u1" }, reopen: null, handoverHref: null });
    expect(p.log).not.toBeNull();
    expect(p.newFollowUp).toMatchObject({ canAssign: true, currentUserId: "u1" });
  });
  it("a colleague who is neither owner nor founder: no stage, hold, close, edit or assign; they can still log and add a follow-up, and act on a follow-up assigned to them", () => {
    const p = buildSummaryActions(view({ ctx: colleague }), null);
    expect(p).toMatchObject({ move: null, canHold: false, close: null, edit: null, assign: null, reopen: null, followUp: null });
    expect(p.log).not.toBeNull();
    expect(p.newFollowUp).not.toBeNull();
    expect(buildSummaryActions(view({ ctx: colleague, followUps: [fu({ assigned_to: "u2" })] }), null).followUp).toMatchObject({ id: "f1" });
  });
  it("failed proposals, Zoho references or estimate records: the stage move is shown as not offered, with why; hold and close stay", () => {
    for (const s of ["proposals", "zoho", "estimateSends"] as const) {
      const p = buildSummaryActions(view({ failed: [s] }), null);
      expect(p.move, s).toEqual({ unavailable: MOVES_NOT_OFFERED });
      expect(p, s).toMatchObject({ canHold: true, close: { won: true, lost: true } });
    }
  });
  it("failed follow-ups: nothing that depends on them (complete, reschedule, add, log) is offered", () => {
    expect(buildSummaryActions(view({ failed: ["followUps"] }), null)).toMatchObject({ followUp: null, newFollowUp: null, log: null });
  });
  it("on hold: Resume and Close as lost only (not Won); won: Reopen and the handover package, value-only edit; a failed handover read withholds Reopen and says why; lost: read-only", () => {
    expect(buildSummaryActions(view({ stage: "on_hold", followUps: [], opp: { stage_before_hold: "qualified" } }), null)).toMatchObject({ move: null, canHold: false, resume: { returnsTo: "qualified" }, close: { won: false, lost: true } });
    expect(buildSummaryActions(view({ stage: "won", followUps: [] }), null)).toMatchObject({ move: null, close: null, edit: { mode: "value" }, reopen: { outcome: "won", hasHandover: false }, handoverHref: "/sales/opportunities/o1/handover", newFollowUp: null });
    expect(buildSummaryActions(view({ stage: "won", followUps: [], failed: ["handover"] }), null).reopen).toEqual({ unavailable: REOPEN_NOT_OFFERED });
    expect(buildSummaryActions(view({ stage: "lost", followUps: [] }), null)).toMatchObject({ edit: null, log: null, newFollowUp: null, close: null, reopen: { outcome: "lost" } });
  });
});

describe("one main button, Log activity, and one More menu in a stable order", () => {
  it("shows exactly one main button for the next action and opens its form; the rest is under More in the fixed order", () => {
    render(<SummaryActions {...buildSummaryActions(view({ followUps: [fu(), fu({ id: "f2", title: "Send the deck" })] }), complete)} />);
    const group = screen.getByRole("group", { name: "Enquiry actions" });
    expect([...group.querySelectorAll(":scope > button, :scope > a")].map((b) => b.textContent?.trim())).toEqual(["Complete follow-up", "Log activity"]);
    fireEvent.click(screen.getByRole("button", { name: "Complete follow-up: Call the client" }));
    expect(screen.getByRole("dialog", { name: "complete" })).toBeTruthy();
    expect(names(menu())).toEqual(["Reschedule follow-up", "Edit details", "Assign owner", "Move to another stage", "Put on hold", "Close as won", "Close as lost"]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Put on hold/ }));
    expect(screen.getByRole("dialog", { name: "hold" })).toBeTruthy();
  });
  it("when the main button is something else, Complete follow-up moves into More, first; Close as won and lost stay links to the close page", () => {
    render(<SummaryActions {...buildSummaryActions(view(), { kind: "record_estimate_sent", label: "Record estimate as sent", why: "", tab: "quotations" })} />);
    expect(screen.getByRole("link", { name: "Record estimate as sent" }).getAttribute("href")).toBe("/sales/opportunities/o1?tab=quotations");
    expect(names(menu()).slice(0, 2)).toEqual(["Complete follow-up", "Reschedule follow-up"]);
    expect(screen.getByRole("menuitem", { name: /Close as won/ }).getAttribute("href")).toBe("/sales/opportunities/o1/close?outcome=won");
    expect(screen.getByRole("menuitem", { name: /Close as lost/ }).getAttribute("href")).toBe("/sales/opportunities/o1/close?outcome=lost");
  });
  it("Move to <stage> opens the usual stage form with that stage first", () => {
    render(<SummaryActions {...buildSummaryActions(view(), { kind: "move_stage", label: "Move to Quote sent", why: "", stage: "quote_sent" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Quote sent" }));
    expect(screen.getByRole("dialog", { name: "move" }).textContent).toMatch(/^Quote sent,/);
  });
  it("Add next action and Log first response are main buttons too; Log activity is not shown twice", () => {
    render(<SummaryActions {...buildSummaryActions(view({ followUps: [] }), { kind: "add_next_action", label: "Add next action", why: "" })} />);
    expect(screen.getByRole("button", { name: "Add next action" })).toBeTruthy();
    cleanup();
    render(<SummaryActions {...buildSummaryActions(view(), { kind: "log_first_response", label: "Log first response", why: "", tab: "activity" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Log first response" }));
    expect(screen.getByRole("dialog", { name: "log" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log activity" })).toBeNull();
  });
  it("an action that cannot be offered right now stays in its place, disabled, with the reason", () => {
    render(<SummaryActions {...buildSummaryActions(view({ failed: ["zoho"] }), complete)} />);
    menu();
    const move = screen.getByRole("menuitem", { name: /Move to another stage/ }) as HTMLButtonElement;
    expect(move.disabled).toBe(true);
    expect(move.textContent).toContain(MOVES_NOT_OFFERED);
  });
  it("won: the handover is the main button and is not repeated under More; Reopen and Edit value are there", () => {
    render(<SummaryActions {...buildSummaryActions(view({ stage: "won", followUps: [] }), { kind: "handover", label: "Prepare the handover", why: "", href: "/sales/opportunities/o1/handover" })} />);
    expect(screen.getByRole("link", { name: "Prepare the handover" }).getAttribute("href")).toBe("/sales/opportunities/o1/handover");
    expect(names(menu())).toEqual(["Edit value", "Reopen"]);
  });
  it("a colleague with nothing to change still has Log activity; an empty More menu is not shown", () => {
    render(<SummaryActions {...buildSummaryActions(view({ ctx: colleague }), { kind: "log_activity", label: "Log activity", why: "", tab: "activity" })} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Log activity"]);
  });
});
