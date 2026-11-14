// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/projects/p1/closeout", useSearchParams: () => new URLSearchParams() }));
const actions = vi.hoisted(() => ({ generateCloseout: vi.fn(), saveCloseoutEdits: vi.fn(), approveCloseout: vi.fn(), discardCloseoutDraft: vi.fn() }));
vi.mock("@/lib/actions/projectsCloseout", () => actions);

import { buildOutbound, evidenceItems, payloadHash } from "@/lib/projects/closeout/evidence";
import { fixtureSnapshot, ID } from "@/lib/projects/closeout/fixture";
import { factsOnlyDraft, keyFacts, toSourceRefs, validateDraft, type ReportView } from "@/lib/projects/closeout/report";
import { CloseoutWorkspace } from "./closeout-workspace";

const s = fixtureSnapshot();
const items = evidenceItems(s);
const defaults = items.filter((x) => x.optional?.defaultOn).map((x) => x.optional!.key);   // nothing: every optional text starts unticked
const ticked = items.filter((x) => x.optional && /^(scope-|decision-)/.test(x.optional.key)).map((x) => x.optional!.key);
const sent = buildOutbound(items, { include: ticked }).sent;
const view = (over: Partial<ReportView> = {}): ReportView => ({
  id: "r1", versionNo: 1, status: "draft", version: 3, generation: "generated", snapshotAt: "2027-03-06T10:00:00Z", approvedAt: null, approvedBy: null, facts: keyFacts(s), missing: [],
  sections: factsOnlyDraft(sent), refs: toSourceRefs(sent), include: ticked, ...over,
});
const props = (over: Partial<Parameters<typeof CloseoutWorkspace>[0]> = {}) => ({
  projectId: "p1", items, team: s.team.map((m) => ({ name: m.name })), missing: [] as string[], defaultInclude: defaults, draft: null, approved: [] as ReportView[],
  provider: { available: true, kind: "anthropic" as const, note: null }, ...over,
});
const formData = (mock: ReturnType<typeof vi.fn>) => Object.fromEntries((mock.mock.calls.at(-1)![1] as FormData).entries());

beforeEach(() => { for (const a of Object.values(actions)) a.mockReset().mockResolvedValue({ error: null, notice: "Done." }); });
afterEach(cleanup);

describe("Closeout report: review data to be sent", () => {
  it("shows the source categories, the team names and each optional text, and says plainly that generating sends the reviewed content to Anthropic", () => {
    render(<CloseoutWorkspace {...props()} />);
    const review = screen.getByTestId("closeout-review");
    expect(within(review).getByTestId("closeout-categories").textContent).toMatch(/Project, venue and dates.*Agreed scope and approved changes.*Team, roles.*Decisions.*Client feedback.*Handover and sign-off.*Equipment sent, returned and still out/);
    expect(within(review).getByTestId("closeout-team").textContent).toBe("Pat Manager, Casey Content, Eli Engineer, Pri Programmer");
    expect(within(review).getByTestId("closeout-anthropic-note").textContent).toMatch(/Generating sends the reviewed content above to Anthropic/);
    expect(review.textContent).toMatch(/Never included: prices, costs, margins, budgets, payroll, project chat, task comments, files and attachments, contact details/);
    // every optional text is shown, and NONE is selected until the PM ticks it: scope wording, exclusions, reasons, date effects, client words, response, notes
    expect(defaults).toEqual([]);
    const boxes = within(review).getByTestId("closeout-optional").querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(9);
    expect([...boxes].every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    expect(within(review).getByTestId("closeout-optional").textContent).toContain("Please make the welcome loop brighter");
    expect(review.textContent).toMatch(/Optional text \(0 of 9 included\)/);
    expect(review.textContent).toMatch(/None of it is included unless you tick it/);
    // the exact outbound evidence is there to read, and holds none of the optional text yet
    const exact = within(review).getByTestId("closeout-lines").textContent!;
    expect(exact).toBe(buildOutbound(items, { include: [] }).text);
    expect(exact).toContain("Client sign-off: NOT RECORDED");
    for (const t of ["LED welcome wall 6 x 4 m", "Agreed with the client", "One extra install day", "Please make the welcome loop brighter"]) expect(exact).not.toContain(t);
    expect(screen.getByRole("button", { name: "Send to Anthropic and write the draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write a facts-only draft (nothing is sent)" })).toBeTruthy();
    expect(actions.generateCloseout).not.toHaveBeenCalled();                            // nothing is sent by opening the screen
  });

  it("sends the selection the PM left ticked, with the fingerprint of exactly that content", async () => {
    render(<CloseoutWorkspace {...props()} />);
    fireEvent.click(screen.getByTestId("closeout-opt-scope-original"));                 // opt in to the original scope wording
    fireEvent.click(screen.getByTestId("closeout-opt-scope-current"));
    fireEvent.click(screen.getByTestId("closeout-opt-scope-current"));                  // ticked, then removed again
    fireEvent.click(screen.getByTestId(`closeout-opt-feedback-request:${ID.feedback}`)); // opt in to the client's words
    expect(screen.getByTestId("closeout-lines").textContent).toContain("ORIGINAL scope, as agreed at handover (as written): LED welcome wall 6 x 4 m");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send to Anthropic and write the draft" })); });
    await waitFor(() => expect(actions.generateCloseout).toHaveBeenCalledTimes(1));
    const fd = formData(actions.generateCloseout);
    const include = JSON.parse(String(fd.include)) as string[];
    expect(include.sort()).toEqual([`feedback-request:${ID.feedback}`, "scope-original"].sort());
    expect(fd).toMatchObject({ projectId: "p1", mode: "ai", reviewedHash: payloadHash(buildOutbound(items, { include }).text) });
    expect(Object.keys(fd).sort()).toEqual(["include", "mode", "projectId", "reviewedHash"]);   // the browser sends no evidence, only what was selected
  });

  it("says when records could not be read, lists what the data policy keeps back, and offers only the facts-only draft when there is no provider", async () => {
    const risky = evidenceItems(fixtureSnapshot({ decisions: [{ ...s.decisions[0]!, reason: "Margin stays at 40% after the change" }] }));
    render(<CloseoutWorkspace {...props({ items: risky, missing: ["Equipment: the equipment records could not be read"], provider: { available: false, kind: "none", note: "The AI provider is not set up in this environment." } })} />);
    expect(screen.getByTestId("closeout-missing").textContent).toMatch(/Some records could not be read.*Equipment: the equipment records could not be read/);
    expect(screen.getByTestId("closeout-withheld").textContent).toMatch(/Kept inside Enginious OS by the data policy \(1\).*mentions an amount of money/);
    expect(screen.getByTestId("closeout-review").textContent).not.toContain("40%");
    expect(screen.getByTestId("closeout-no-provider").textContent).toMatch(/not set up/);
    expect(screen.queryByRole("button", { name: "Send to Anthropic and write the draft" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Write a facts-only draft (nothing is sent)" })); });
    await waitFor(() => expect(formData(actions.generateCloseout).mode).toBe("facts"));
  });

  it("a failure is shown and the review stays, so the PM can retry", async () => {
    actions.generateCloseout.mockResolvedValue({ error: "The AI provider did not answer in time. Nothing was saved. You can try again." });
    render(<CloseoutWorkspace {...props()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send to Anthropic and write the draft" })); });
    await waitFor(() => expect(screen.getByText(/did not answer in time\. Nothing was saved\. You can try again\./)).toBeTruthy());
    expect(screen.getByTestId("closeout-review")).toBeTruthy();
  });
});

describe("Closeout report: the draft, approval and approved versions", () => {
  it("shows the recorded facts (sign-off not recorded, equipment still out) above the narrative, with sources linked to their records", () => {
    render(<CloseoutWorkspace {...props({ draft: view() })} />);
    const facts = screen.getByTestId("closeout-facts").textContent!;
    expect(facts).toMatch(/Client sign-offNot recorded/);
    expect(facts).toMatch(/Equipment3 units still out, due back 2027-03-08/);
    expect(facts).toMatch(/CompletionNot recorded/);
    const sources = screen.getByTestId("closeout-sources");
    expect(sources.querySelector('a[href="/projects/p1/changes"]')).toBeTruthy();       // the decision and the feedback
    expect(sources.querySelector('a[href="/projects/p1/equipment"]')).toBeTruthy();
    expect(sources.querySelector('a[href="/projects/p1/delivery"]')).toBeTruthy();
    expect(screen.queryByText("Download PDF")).toBeNull();                              // a draft cannot be downloaded
    expect(screen.getByText(/No version approved yet/)).toBeTruthy();
  });

  it("statements that contradict the records are marked and approval is not offered until they are changed", () => {
    const bad = validateDraft({ sections: [{ id: "handover", paragraphs: [{ text: "The client signed off and all equipment was returned.", refs: [sent[0]!.ref] }] }, { id: "team", paragraphs: [{ text: "Everyone worked hard.", refs: [] }] }] }, sent, s)!.sections;
    render(<CloseoutWorkspace {...props({ draft: view({ sections: bad }) })} />);
    expect(screen.getByTestId("closeout-blocking").textContent).toMatch(/2 statements contradict the project's records/);
    expect(screen.getByTestId("closeout-section-handover").textContent).toMatch(/no client sign-off is recorded/);
    expect(screen.getByTestId("closeout-section-handover").textContent).toMatch(/some is recorded as still out/);
    expect(screen.getByTestId("closeout-section-team").textContent).toMatch(/No source reference/);
    expect((screen.getByRole("button", { name: "Approve version 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits are saved first; approving is its own step and asks for the PM's tick when statements are marked to check", async () => {
    const withCheck = validateDraft({ sections: [{ id: "team", paragraphs: [{ text: "Everyone delivered their part.", refs: [] }] }] }, sent, s)!.sections;
    render(<CloseoutWorkspace {...props({ draft: view({ sections: withCheck }) })} />);
    const approve = screen.getByRole("button", { name: "Approve version 1" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    expect(screen.getByTestId("closeout-checked")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Team and ownership, paragraph 1"), { target: { value: "Eli Engineer owned D001." } });
    expect(approve.disabled).toBe(true);                                                // unsaved edits cannot be approved
    expect(screen.getByText("Save your edits before approving.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save edits" })); });
    await waitFor(() => expect(actions.saveCloseoutEdits).toHaveBeenCalledTimes(1));
    const fd = formData(actions.saveCloseoutEdits);
    expect(fd).toMatchObject({ reportId: "r1", expectedVersion: "3" });
    expect(JSON.parse(String(fd.sections)).find((x: { id: string }) => x.id === "team").paragraphs[0].text).toBe("Eli Engineer owned D001.");
    expect(actions.approveCloseout).not.toHaveBeenCalled();
  });

  it("an approved version is listed with its download and can be read; it is not editable", () => {
    render(<CloseoutWorkspace {...props({ approved: [view({ id: "r0", status: "approved", approvedAt: "2027-03-07T09:00:00Z", approvedBy: "Pat Manager" })] })} />);
    const list = screen.getByTestId("closeout-approved");
    expect(list.textContent).toMatch(/Version 1.*approved.*by Pat Manager.*evidence taken/);
    expect(list.querySelector('a[href="/projects/p1/closeout/r0/pdf"]')!.textContent).toContain("Download PDF");
    expect(list.querySelectorAll("textarea")).toHaveLength(0);
    expect(list.textContent).toContain("Client sign-off: NOT RECORDED");
  });
});
