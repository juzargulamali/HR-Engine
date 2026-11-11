/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
let path = "/sales";
let search = "";
vi.mock("next/navigation", () => ({ usePathname: () => path, useSearchParams: () => new URLSearchParams(search) }));
vi.mock("@/lib/actions/jarvis", () => ({ jarvisSend: vi.fn(), jarvisContext: vi.fn(), jarvisReview: vi.fn(), jarvisConfirm: vi.fn(), jarvisStatus: vi.fn(), jarvisAct: vi.fn(), jarvisConfirmAction: vi.fn() }));

import { JarvisLauncher, type JarvisClientApi } from "./jarvis-launcher";
import { JarvisMark } from "./jarvis-mark";
import type { ActionConfirmResult, ConfirmResult, EnquiryCard, EnquiryValues, EnquiryStageCard, EnquiryUpdateCard, MeetingCard, OrgRegisterCard, ReplyDraftCard, SendResult, StatusResult } from "@/lib/jarvis/protocol";

const CO1 = "11111111-1111-4111-8111-111111111111";
const CO2 = "22222222-2222-4222-8222-222222222222";
const companies = [{ id: CO1, name: "Fictional Enginious UAE LLC" }, { id: CO2, name: "Fictional Enginious KSA LLC" }];
const ENQ = "33333333-3333-4333-8333-333333333333";

const values = (over: Partial<EnquiryValues> = {}): EnquiryValues => ({ companyId: CO1, title: "Harbour gala LED wall", source: "whatsapp", agencyOrgId: "a1", clientOrgId: "c1", currency: "AED", value: 45000, budgetNote: null, brief: "Two LED walls.", eventStart: "2026-12-05", eventEnd: null, installStart: null, location: "Harbour Hall", technologies: [{ name: "LED wall", qty: 2 }], scope: null, waitingOn: null, nextTitle: "Call to qualify", nextDate: "2026-11-12", nextTime: "10:00", nextKind: "call", ...over });
const card = (over: Partial<EnquiryCard> = {}): EnquiryCard => ({
  kind: "enquiry.create", company: { id: CO1, name: companies[0]!.name }, values: values(),
  agency: { field: "agency", typedName: "Fictional Wave Agency", status: "matched", selectedId: "a1", selectedName: "Fictional Wave Agency", options: [], guidance: null },
  client: { field: "client", typedName: "Fictional Harbour Brands", status: "matched", selectedId: "c1", selectedName: "Fictional Harbour Brands", options: [], guidance: null },
  problems: [], questions: [], duplicates: [], valid: true, fromBrief: ["title", "agencyOrgId"], ...over,
});
const conf = (id = "conf-1") => ({ id, token: `tok-${id}`, expiresAt: new Date(Date.now() + 900_000).toISOString() });
const cardResult = (c: EnquiryCard = card(), confirmation: ReturnType<typeof conf> | null = conf()): SendResult => ({ ok: true, kind: "card", card: c, confirmation });

type Calls = Record<"send" | "review" | "confirm" | "status" | "context" | "act" | "confirmAction", unknown[][]>;
function fakeApi(over: Partial<JarvisClientApi> = {}): JarvisClientApi & { calls: Calls } {
  const calls: Calls = { send: [], review: [], confirm: [], status: [], context: [], act: [], confirmAction: [] };
  const impl = {
    send: async () => cardResult(),
    review: async () => cardResult(),
    confirm: async (): Promise<ConfirmResult> => ({ ok: true, status: "done", confirmationId: "conf-1", reference: "OPP-UAE-2026-0001", opportunityId: "o1", href: "/sales/opportunities/o1", replayed: false }),
    status: async (): Promise<StatusResult> => ({ ok: true, state: "not_recorded" }),
    context: async () => ({ ok: true as const, view: { company: null, enquiry: null } }),
    act: async () => ({ ok: false as const, code: "unknown_action" as const, message: "not used" }),
    confirmAction: async () => ({ ok: false as const, code: "unknown_action" as const, message: "not used" }),
    ...over,
  } as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const wrapped = Object.fromEntries(Object.entries(impl).map(([k, f]) => [k, (...a: unknown[]) => { calls[k as keyof Calls].push(a); return f(...a); }]));
  return { calls, ...wrapped } as never;
}

beforeEach(() => {
  path = "/sales"; search = "";
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  Element.prototype.scrollTo = (() => undefined) as never;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = (api = fakeApi(), props: Partial<React.ComponentProps<typeof JarvisLauncher>> = {}) => render(<JarvisLauncher companies={companies} writes maxInputChars={6000} api={api} {...props} />);
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: "Open JARVIS" }));
const paste = async (text = "Agency: Fictional Wave Agency\nTitle: Harbour gala") => {
  fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByTestId("jarvis-card");
};

describe("launcher and panel", () => {
  it("one launcher named 'Open JARVIS' (also by name for keyboard and screen readers) that opens a dialog with the title, subtitle, capability badge and the first action up front", () => {
    mount();
    const l = screen.getByRole("button", { name: "Open JARVIS" });
    expect(l.getAttribute("aria-expanded")).toBe("false");
    expect(l.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.getAllByRole("button", { name: "Open JARVIS" })).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(l);
    const d = screen.getByRole("dialog", { name: "JARVIS" });
    expect(within(d).getByText("Enginious OS assistant")).toBeTruthy();
    expect(within(d).getByTestId("jarvis-capability").textContent).toBe("Sales & CRM");
    expect(within(d).getByTestId("jarvis-welcome").textContent).toMatch(/^Ask me anything/);
    expect(within(d).getByTestId("jarvis-anthropic-notice").textContent).toBe("The text you submit for this task is sent to Anthropic to prepare a draft.");
    expect(l.getAttribute("aria-expanded")).toBe("true");
  });
  it("moves focus into the panel on open, closes on Escape and returns focus to the launcher; also closes with the Close button", async () => {
    mount();
    const l = screen.getByRole("button", { name: "Open JARVIS" });
    l.focus();
    openPanel();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Paste a brief or ask a question")));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(l));
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close JARVIS" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(l));
  });
  it("on a phone the panel is a modal sheet (aria-modal); on desktop it is not modal so the page stays usable", () => {
    mount();
    openPanel();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBeNull();
    cleanup();
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
    mount();
    openPanel();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  });
  it("answers 'what can you do?' with the enabled action and the others marked Not available yet", async () => {
    const api = fakeApi({ send: async () => ({ ok: true, kind: "help", help: { enabled: [{ id: "jarvis.sales.enquiry.create_from_brief", title: "Create an enquiry from a brief", description: "Paste it." }], disabled: [{ id: "jarvis.sales.email.draft_reply", title: "Draft a client email or reply", reason: "Not available yet: later." }] } }) });
    mount(api);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "What can you do?" }));
    const h = await screen.findByTestId("jarvis-help");
    expect(within(h).getByText(/Create an enquiry from a brief/)).toBeTruthy();
    expect(within(h).getByText("Draft a client email or reply")).toBeTruthy();
    expect(within(h).getByText("Not available yet", { selector: "span" })).toBeTruthy();
  });
  it("shows a refusal in words and keeps the panel usable", async () => {
    mount(fakeApi({ send: async () => ({ ok: false, code: "excluded_request", message: "JARVIS cannot help with that." }) }));
    openPanel();
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "show payroll" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByTestId("jarvis-error")).textContent).toBe("JARVIS cannot help with that.");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true); // empty box again
  });
  it("refuses an over-long paste in the panel before sending it anywhere", async () => {
    const api = fakeApi();
    mount(api, { maxInputChars: 50 });
    openPanel();
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "x".repeat(60) } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByTestId("jarvis-error")).textContent).toMatch(/too long/);
    expect(api.calls.send).toHaveLength(0);
  });
  it("stores nothing in the browser (no persistent chat history) and the conversation is gone after a remount", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    mount();
    openPanel();
    await paste();
    expect(set).not.toHaveBeenCalled();
    cleanup();
    mount();
    openPanel();
    expect(screen.queryByTestId("jarvis-card")).toBeNull();
    expect(screen.queryByTestId("jarvis-user-msg")).toBeNull();
  });
});

describe("page context is a hint, shown and never silent", () => {
  it("shows the enquiry chip from the route, switches the company visibly with a notice, and invalidates a review made for the other company", async () => {
    const api = fakeApi({ context: async () => ({ ok: true as const, view: { company: { id: CO2, name: companies[1]!.name }, enquiry: { id: ENQ, reference: "OPP-KSA-2026-0007", title: "Ksa job", companyId: CO2 } } }) });
    const { rerender } = mount(api);
    openPanel();
    await paste();
    expect((screen.getByTestId("create-enquiry") as HTMLButtonElement).disabled).toBe(false);
    path = `/sales/opportunities/${ENQ}`;
    rerender(<JarvisLauncher companies={companies} writes maxInputChars={6000} api={api} />);
    expect((await screen.findByTestId("jarvis-enquiry-chip")).textContent).toContain("OPP-KSA-2026-0007");
    expect(screen.getByTestId("jarvis-notice").textContent).toMatch(/switched to that company.*can no longer be used/);
    expect((screen.getByLabelText("Company for JARVIS") as HTMLSelectElement).value).toBe(CO2);
    expect((screen.getByTestId("create-enquiry") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/company changed after this review/i)).toBeTruthy();
    expect(api.calls.context[0]![0]).toEqual({ companyId: CO1, enquiryId: ENQ });
  });
  it("reads the side panel's ?open= enquiry too, and an unreadable enquiry shows no chip", async () => {
    path = "/sales/opportunities"; search = `open=${ENQ}`;
    const api = fakeApi({ context: async () => ({ ok: true as const, view: { company: null, enquiry: null } }) });
    mount(api);
    openPanel();
    await waitFor(() => expect(api.calls.context).toHaveLength(1));
    expect(screen.queryByTestId("jarvis-enquiry-chip")).toBeNull();
  });
  it("changing the company by hand makes the existing review unusable and says so", async () => {
    mount();
    openPanel();
    await paste();
    fireEvent.change(screen.getByLabelText("Company for JARVIS"), { target: { value: CO2 } });
    expect(screen.getByTestId("jarvis-notice").textContent).toMatch(/Company changed to Fictional Enginious KSA LLC.*can no longer be used/);
    expect((screen.getByTestId("create-enquiry") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("review card", () => {
  it("shows the exact company, the linked organisations, fields from the brief; Create is enabled only for a valid, unchanged card", async () => {
    mount();
    openPanel();
    await paste();
    expect(screen.getByTestId("card-company").textContent).toBe("Fictional Enginious UAE LLC");
    expect(screen.getByTestId("org-agency-selected").textContent).toBe("Fictional Wave Agency");
    expect(screen.getByTestId("org-client-selected").textContent).toBe("Fictional Harbour Brands");
    expect((screen.getByLabelText("What is the enquiry?") as HTMLInputElement).value).toBe("Harbour gala LED wall");
    const create = screen.getByTestId("create-enquiry") as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("What is the enquiry?"), { target: { value: "Edited title" } });
    expect(create.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Review changes" })).toBeTruthy();
    expect(screen.getByText(/review the changes first/i)).toBeTruthy();
  });
  it("an incomplete card shows what is missing, asks the question and keeps Create disabled (no confirmation)", async () => {
    const c = card({ valid: false, values: values({ source: "", nextTitle: "" }), problems: [{ field: "source", message: "Choose where the enquiry came from." }, { field: "nextTitle", message: "Say what the next action is." }], questions: [{ field: "source", text: "Where did this enquiry come from?" }] });
    mount(fakeApi({ send: async () => cardResult(c, null) }));
    openPanel();
    await paste();
    expect(screen.getByTestId("card-questions").textContent).toContain("Where did this enquiry come from?");
    expect(screen.getByTestId("card-missing").textContent).toMatch(/Choose where the enquiry came from; Say what the next action is/);
    expect((screen.getByTestId("create-enquiry") as HTMLButtonElement).disabled).toBe(true);
  });
  it("Review changes sends the edited fields and the typed names and replaces the card with the new review", async () => {
    const api = fakeApi({ review: async () => cardResult(card({ values: values({ title: "Edited title" }) }), conf("conf-2")) });
    mount(api);
    openPanel();
    await paste();
    fireEvent.change(screen.getByLabelText("What is the enquiry?"), { target: { value: "Edited title" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await waitFor(() => expect((screen.getByTestId("create-enquiry") as HTMLButtonElement).disabled).toBe(false));
    expect((api.calls.review[0]![0] as { fields: EnquiryValues }).fields.title).toBe("Edited title");
    expect((api.calls.review[0]![0] as { companyId: string }).companyId).toBe(CO1);
    expect((screen.getByLabelText("What is the enquiry?") as HTMLInputElement).value).toBe("Edited title");
  });
  it("a missing organisation shows the 'register it first' guidance and offers no way to create one", async () => {
    const c = card({ valid: false, agency: { field: "agency", typedName: "Fictional Nobody Agency", status: "not_found", selectedId: null, selectedName: null, options: [], guidance: 'No organisation called "Fictional Nobody Agency" is recorded. Register it in Clients & Agencies first; JARVIS never creates an organisation by itself.' }, values: values({ agencyOrgId: null }) });
    mount(fakeApi({ send: async () => cardResult(c, null) }));
    openPanel();
    await paste();
    expect(screen.getByTestId("guidance-agency").textContent).toMatch(/Register it in Clients & Agencies first/);
    expect(screen.queryByRole("button", { name: /create (the )?(organisation|agency)/i })).toBeNull();
  });
  it("an ambiguous organisation offers the candidates and picking one re-reviews at once", async () => {
    const amb = card({ valid: false, agency: { field: "agency", typedName: "Wave", status: "ambiguous", selectedId: null, selectedName: null, options: [{ id: "a1", name: "Wave Agency", place: "Dubai" }, { id: "a2", name: "Wave Events", place: null }], guidance: "More than one organisation could be the agency." }, values: values({ agencyOrgId: null }) });
    const api = fakeApi({ send: async () => cardResult(amb, null), review: async () => cardResult(card(), conf("conf-3")) });
    mount(api);
    openPanel();
    await paste();
    fireEvent.change(screen.getByLabelText("Choose the agency"), { target: { value: "a2" } });
    await waitFor(() => expect(api.calls.review).toHaveLength(1));
    expect((api.calls.review[0]![0] as { fields: EnquiryValues }).fields.agencyOrgId).toBe("a2");
  });
  it("a likely duplicate is shown and must be acknowledged before Create is enabled; its id goes with the confirmation", async () => {
    const c = card({ duplicates: [{ id: "d1", reference: "OPP-UAE-2026-0042", title: "Harbour gala LED wall", stage: "new", level: "likely", reasons: ["Similar title"] }] });
    const api = fakeApi({ send: async () => cardResult(c) });
    mount(api);
    openPanel();
    await paste();
    expect(screen.getByTestId("card-duplicates").textContent).toContain("OPP-UAE-2026-0042");
    const create = screen.getByTestId("create-enquiry") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("ack-duplicates"));
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await screen.findByTestId("jarvis-result");
    expect((api.calls.confirm[0]![0] as { duplicateIds: string[] }).duplicateIds).toEqual(["d1"]);
  });
  it("shows the REAL reference and a link only after the app confirms the save; the confirmation carries the REVIEWED values and token", async () => {
    const api = fakeApi();
    mount(api);
    openPanel();
    await paste();
    expect(screen.queryByTestId("jarvis-result")).toBeNull();
    fireEvent.click(screen.getByTestId("create-enquiry"));
    const r = await screen.findByTestId("jarvis-result");
    expect(r.textContent).toContain("OPP-UAE-2026-0001");
    expect(within(r).getByRole("link", { name: "Open OPP-UAE-2026-0001" }).getAttribute("href")).toBe("/sales/opportunities/o1");
    const sent = api.calls.confirm[0]![0] as { token: string; values: EnquiryValues; companyId: string };
    expect(sent).toMatchObject({ token: "tok-conf-1", companyId: CO1 });
    expect(sent.values.title).toBe("Harbour gala LED wall");
  });
  it("a double click sends ONE confirmation, and there is no second Create after the save", async () => {
    let release: (v: ConfirmResult) => void = () => undefined;
    const api = fakeApi({ confirm: () => new Promise<ConfirmResult>((res) => { release = res; }) });
    mount(api);
    openPanel();
    await paste();
    const create = screen.getByTestId("create-enquiry");
    fireEvent.click(create); fireEvent.click(create); fireEvent.click(create);
    expect(api.calls.confirm.length).toBe(1);
    await act(async () => { release({ ok: true, status: "done", confirmationId: "conf-1", reference: "OPP-UAE-2026-0001", opportunityId: "o1", href: "/sales/opportunities/o1", replayed: false }); });
    await screen.findByTestId("jarvis-result");
    expect(api.calls.confirm).toHaveLength(1);
    expect(screen.queryByTestId("create-enquiry")).toBeNull();
  });
  it("an unknown answer shows 'Checking the original result', polls the read-only status, never offers a second create, and then shows the real result", async () => {
    let n = 0;
    const api = fakeApi({
      confirm: async () => ({ ok: false, code: "ambiguous", message: "We did not get an answer to the save.", confirmationId: "conf-1" }),
      status: async (): Promise<StatusResult> => (++n < 2 ? { ok: true, state: "not_recorded" } : { ok: true, state: "done", reference: "OPP-UAE-2026-0009", opportunityId: "o9", href: "/sales/opportunities/o9" }),
    });
    mount(api);
    openPanel();
    await paste();
    fireEvent.click(screen.getByTestId("create-enquiry"));
    const c = await screen.findByTestId("jarvis-checking");
    expect(c.textContent).toContain("Checking the original result");
    expect(screen.queryByTestId("create-enquiry")).toBeNull();
    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
    const r = await screen.findByTestId("jarvis-result", {}, { timeout: 6000 });
    expect(r.textContent).toContain("OPP-UAE-2026-0009");
    expect(api.calls.confirm).toHaveLength(1);
    expect(api.calls.status[0]![0]).toBe("conf-1");
  }, 10_000);
  it("a thrown (lost) response is treated as unknown too, not as a failure that invites a retry", async () => {
    const api = fakeApi({ confirm: async () => { throw new Error("network"); } });
    mount(api);
    openPanel();
    await paste();
    fireEvent.click(screen.getByTestId("create-enquiry"));
    await screen.findByTestId("jarvis-checking");
    expect(screen.queryByTestId("create-enquiry")).toBeNull();
  });
  it("a refusal (changed values, expired review, access removed) says so in words and does not show a reference", async () => {
    const api = fakeApi({ confirm: async () => ({ ok: false, code: "token_expired", message: "This review has expired. Review the details again before creating anything." }) });
    mount(api);
    openPanel();
    await paste();
    fireEvent.click(screen.getByTestId("create-enquiry"));
    expect((await screen.findByTestId("card-failed")).textContent).toMatch(/expired/);
    expect(screen.queryByTestId("jarvis-result")).toBeNull();
  });
});

describe("the mark", () => {
  it("is an inline SVG at the requested size (20 px by default), takes its colour from the theme token and has no animation", () => {
    const { container } = render(<JarvisMark />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
    expect(svg.getAttribute("style")).toContain("var(--jarvis-mark)");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(container.innerHTML).not.toMatch(/animate|<image|href=|url\(/);
    expect(container.querySelectorAll("path").length).toBe(2);
    expect(container.querySelectorAll("rect").length).toBe(1);
  });
});

const ALL_IDS = ["jarvis.sales.enquiry.create_from_brief", "jarvis.sales.draft_reply"];
const replyCard = (over: Partial<ReplyDraftCard> = {}): ReplyDraftCard => ({
  kind: "reply.draft", enquiry: { id: ENQ, reference: "OPP-UAE-2026-0007", title: "Harbour gala LED wall", stage: "new", stageLabel: "New enquiry", companyId: CO1 },
  subject: "Re: Harbour gala LED wall", body: "Dear colleague,\n\nThank you.\n\nKind regards,\n[Your name]",
  toConfirm: [{ kind: "price", text: 'The draft mentions "AED 99,999", which is not in the enquiry or in your text. Confirm the price before sending.', origin: "check" }],
  used: [{ value: "2026-12-05", source: "enquiry" }], ...over,
});

describe("modes and the draft-reply card", () => {
  it("offers a mode for each enabled action only, and sends the chosen mode with the enquiry the page shows", async () => {
    path = `/sales/opportunities/${ENQ}`;
    const api = fakeApi({
      context: async () => ({ ok: true as const, view: { company: { id: CO1, name: companies[0]!.name }, enquiry: { id: ENQ, reference: "OPP-UAE-2026-0007", title: "Harbour gala LED wall", companyId: CO1 } } }),
      send: async () => ({ ok: true, kind: "action", actionId: "jarvis.sales.draft_reply", card: replyCard(), confirmation: null }),
    });
    mount(api, { enabledActionIds: ALL_IDS });
    openPanel();
    expect(screen.getByTestId("mode-reply")).toBeTruthy();
    expect(screen.queryByTestId("mode-update")).toBeNull();
    await screen.findByTestId("jarvis-enquiry-chip");
    fireEvent.click(screen.getByTestId("mode-reply"));
    expect(screen.getByTestId("jarvis-mode-note").textContent).toMatch(/Draft a reply.*for OPP-UAE-2026-0007/);
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "Hi, what is the price?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByTestId("jarvis-reply-card");
    expect(api.calls.send[0]![0]).toMatchObject({ companyId: CO1, text: "Hi, what is the price?", intent: "reply", enquiryId: ENQ });
  });
  it("shows what must be confirmed ABOVE the draft, offers Copy and no send button, and edits stay local", async () => {
    const api = fakeApi({ send: async () => ({ ok: true, kind: "action", actionId: "jarvis.sales.draft_reply", card: replyCard(), confirmation: null }) });
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    mount(api, { enabledActionIds: ALL_IDS });
    openPanel();
    fireEvent.click(screen.getByTestId("mode-reply"));
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const c = await screen.findByTestId("jarvis-reply-card");
    const toConfirm = within(c).getByTestId("reply-to-confirm");
    const body = within(c).getByTestId("reply-body");
    expect(toConfirm.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toConfirm.textContent).toMatch(/AED 99,999/);
    expect(within(c).queryByRole("button", { name: /send|create|save|confirm/i })).toBeNull();
    fireEvent.change(body, { target: { value: "Edited draft" } });
    fireEvent.click(within(c).getByTestId("reply-copy"));
    await waitFor(() => expect(write).toHaveBeenCalledWith("Subject: Re: Harbour gala LED wall\n\nEdited draft"));
    expect(api.calls.confirmAction).toHaveLength(0);
    expect(api.calls.act).toHaveLength(0);
  });
  it("says so when nothing needs confirming, and a changed company marks the draft", async () => {
    const api = fakeApi({ send: async () => ({ ok: true, kind: "action", actionId: "jarvis.sales.draft_reply", card: replyCard({ toConfirm: [] }), confirmation: null }) });
    mount(api, { enabledActionIds: ALL_IDS });
    openPanel();
    fireEvent.click(screen.getByTestId("mode-reply"));
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByTestId("reply-nothing-to-confirm");
    fireEvent.change(screen.getByLabelText("Company for JARVIS"), { target: { value: CO2 } });
    expect(await screen.findByText(/The company changed after this draft/)).toBeTruthy();
  });
});

describe("the help card", () => {
  it("shows the reviewed guidance with real links and the note, and no confirm button", async () => {
    const api = fakeApi({ send: async () => ({ ok: true, kind: "action", actionId: "jarvis.sales.help.answer", confirmation: null, card: { kind: "help.answer", mode: "guidance", topics: [], note: "From Enginious OS's reviewed guidance.", entries: [{ id: "sales-follow-ups", title: "See and plan follow-ups", summary: "The Follow-ups page lists what is next.", steps: ["Open Follow-ups in Sales."], links: [{ label: "Follow-ups", href: "/sales/follow-ups" }] }] } }) });
    mount(api, { enabledActionIds: [...ALL_IDS, "jarvis.sales.help.answer"] });
    openPanel();
    fireEvent.click(screen.getByTestId("mode-help"));
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "How do I log a follow-up?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const c = await screen.findByTestId("jarvis-help-card");
    expect(within(c).getByRole("link", { name: "Follow-ups" }).getAttribute("href")).toBe("/sales/follow-ups");
    expect(within(c).getByText(/Open Follow-ups in Sales/)).toBeTruthy();
    expect(within(c).queryByRole("button")).toBeNull();
    expect(api.calls.send[0]![0]).toMatchObject({ intent: "help" });
  });
});

describe("general chat, clarifying question, lookup and memory in the panel", () => {
  it("sends the address path of the current screen with a message (the server reduces it to an approved identifier), and a 'which do you mean?' card offers the guides as choices", async () => {
    path = "/sales/events";
    const choose: SendResult = { ok: true, kind: "action", actionId: "jarvis.sales.help.answer", confirmation: null, card: { kind: "help.answer", mode: "choose", entries: [], topics: [], note: "More than one guide fits. Which do you mean?", question: "How do I register a new customer?", choices: [{ id: "sales-clients-agencies", title: "Find or add a client or agency" }, { id: "sales-outreach", title: "Outreach: accounts assigned to you to approach" }] } };
    const answer: SendResult = { ok: true, kind: "action", actionId: "jarvis.sales.help.answer", confirmation: null, card: { kind: "help.answer", mode: "guidance", topics: [], note: "From the published guidance.", screen: { label: "Events & Exhibitions" }, entries: [{ id: "sales-clients-agencies", title: "Find or add a client or agency", summary: "Summary.", steps: ["Open Clients & Agencies."], links: [{ label: "Clients & Agencies", href: "/sales/accounts" }] }] } };
    const api = fakeApi({ send: async () => choose, act: async () => answer });
    mount(api, { enabledActionIds: [...ALL_IDS, "jarvis.sales.help.answer"] });
    openPanel();
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "How do I register a new customer?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const c = await screen.findByTestId("jarvis-help-card");
    expect(api.calls.send[0]![0]).toMatchObject({ screen: "/sales/events" });
    expect(within(c).getByTestId("help-choose").textContent).toMatch(/Which do you mean/);
    fireEvent.click(within(c).getByRole("button", { name: "Find or add a client or agency" }));
    await waitFor(() => expect(screen.getByTestId("help-screen").textContent).toMatch(/Events & Exhibitions/));
    expect(api.calls.act[0]![0]).toMatchObject({ actionId: "jarvis.sales.help.answer", input: { question: "How do I register a new customer?", topicId: "sales-clients-agencies" } });
  });
  const type = (text: string) => { fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: text } }); fireEvent.click(screen.getByRole("button", { name: "Send" })); };
  const chat = (text: string, draft = true): SendResult => ({ ok: true, kind: "action", actionId: "jarvis.sales.chat.reply", confirmation: null, card: { kind: "chat.reply", text, draft, applied: [] } });
  it("a draft is shown with Copy and no send button, and the NEXT message carries only the chat turns as context (never cards or lookups)", async () => {
    const replies: SendResult[] = [chat("Hello [name],\nFirst draft."), chat("Short draft.")];
    const api = fakeApi({ send: async () => replies.shift()! });
    mount(api);
    openPanel();
    type("Draft an email to a supplier");
    const first = await screen.findByTestId("jarvis-chat-reply");
    expect(within(first).getByTestId("chat-text").textContent).toContain("First draft.");
    expect(within(first).getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(within(first).queryByRole("button", { name: /send/i })).toBeNull();
    expect(screen.queryByTestId("jarvis-card")).toBeNull();
    expect((api.calls.send[0]![0] as { intent: unknown; context: { turns: unknown[] } })).toMatchObject({ intent: null, context: { turns: [] } });
    type("make it shorter");
    await waitFor(() => expect(screen.getAllByTestId("jarvis-chat-reply")).toHaveLength(2));
    expect((api.calls.send[1]![0] as { context: { turns: unknown[] } }).context.turns).toEqual([{ role: "user", text: "Draft an email to a supplier" }, { role: "jarvis", text: "Hello [name],\nFirst draft." }]);
  });
  it("a clarifying question offers choices; choosing one sends the SAME text with that choice and opens nothing by itself", async () => {
    const api = fakeApi({ send: async (a) => ((a as { intent: string | null }).intent === "chat" ? chat("An answer.", false) : { ok: true, kind: "clarify", text: "Is this a client brief you want turned into a new enquiry?", options: [{ label: "Yes, prepare an enquiry", intent: "enquiry" }, { label: "No, just answer it", intent: "chat" }] }) });
    mount(api);
    openPanel();
    type("We need screens for an event");
    const q = await screen.findByTestId("jarvis-clarify");
    expect(screen.queryByTestId("jarvis-card")).toBeNull();
    fireEvent.click(within(q).getByRole("button", { name: "No, just answer it" }));
    await screen.findByTestId("jarvis-chat-reply");
    expect(api.calls.send[1]![0]).toMatchObject({ text: "We need screens for an event", intent: "chat" });
  });
  it("a lookup shows the company, the cutoff, links to the records and 'no matching records' in words; an error is shown as an error", async () => {
    const lookup = (items: unknown[]): SendResult => ({ ok: true, kind: "action", actionId: "jarvis.sales.followups.overdue", confirmation: null, card: { kind: "lookup.followups", company: { id: "co-1", name: "Fictional Enginious UAE LLC" }, period: "all", periodLabel: "overdue now (any due date)", cutoff: new Date().toISOString(), cutoffLabel: "10 Nov 2026, 14:00 (Dubai)", total: items.length, truncated: false, items: items as never, followUpsHref: "/sales/follow-ups" } });
    const replies: SendResult[] = [lookup([{ id: "f1", title: "Call the agency", hidden: false, kindLabel: "Call", dueDate: "2026-11-07", daysOverdue: 3, enquiry: { reference: "OPP-UAE-2026-0001", title: "Fictional harbour gala", href: "/sales/opportunities/o1" } }]), lookup([]), { ok: false, code: "lookup_failed", message: "I could not load your follow-ups just now. This is a failed lookup, not an empty list." }];
    const api = fakeApi({ send: async () => replies.shift()! });
    mount(api);
    openPanel();
    type("Show my overdue Sales follow-ups");
    const c = await screen.findByTestId("jarvis-lookup");
    expect(within(c).getByTestId("lookup-scope").textContent).toMatch(/Fictional Enginious UAE LLC.*as of 10 Nov 2026, 14:00 \(Dubai\)/);
    expect(within(c).getByRole("link", { name: /OPP-UAE-2026-0001/ }).getAttribute("href")).toBe("/sales/opportunities/o1");
    type("show last month instead");
    await waitFor(() => expect(screen.getAllByTestId("jarvis-lookup")).toHaveLength(2));
    expect(api.calls.send[1]![0]).toMatchObject({ context: { lastLookup: { period: "all" } } });
    expect(screen.getByTestId("lookup-empty").textContent).toMatch(/No matching follow-ups/);
    type("show this month");
    expect((await screen.findByTestId("jarvis-error")).textContent).toMatch(/failed lookup, not an empty list/);
  });
  it("a Sales lookup shows scope, filters, time, the exact total next to what is shown, a named missing part and one question with choices; a follow-up carries the question (never rows)", async () => {
    const base = { kind: "lookup.sales" as const, company: { id: CO1, name: companies[0]!.name }, asOf: new Date().toISOString(), asOfLabel: "14 Oct 2099, 10:00 (Dubai)", unavailable: [] as string[], note: null, empty: null, choices: [], links: [{ label: "Open Enquiries", href: "/sales/opportunities" }] };
    const rows = Array.from({ length: 2 }, (_, i) => ({ id: `o${i}`, primary: `OPP-UAE-2099-000${i} · Fictional job ${i}`, secondary: "Qualified · owned by you", meta: null, href: `/sales/opportunities/o${i}` }));
    const list: SendResult = { ok: true, kind: "action", actionId: "jarvis.sales.lookup.run", confirmation: null, card: { ...base, title: "Your open enquiries", scope: "Owned by you", filters: ["open (not Won or Lost; On hold included)"], total: 41, shown: 2, sections: [{ heading: "Your open enquiries", total: 41, rows }], unavailable: ["its open follow-ups"], descriptor: { kind: "enquiries", scope: "mine", stage: null, org: null, event: null, named: null } } };
    const question: SendResult = { ok: true, kind: "action", actionId: "jarvis.sales.lookup.run", confirmation: null, card: { ...base, title: "Which one do you mean?", scope: "", filters: [], total: null, shown: 0, sections: [], note: "More than one client or agency matches that name.", choices: [{ label: "Fictional Wave Agency", descriptor: { kind: "enquiries", scope: "company", stage: null, org: { id: "33333333-3333-4333-8333-333333333333", name: null }, event: null, named: null } }], descriptor: { kind: "enquiries", scope: "company", stage: null, org: null, event: null, named: "Fictional Wave" } } };
    const chosenDescriptor = { kind: "enquiries" as const, scope: "company" as const, stage: null, org: { id: "33333333-3333-4333-8333-333333333333", name: null }, event: null, named: null };
    const chosenCard: SendResult = { ok: true, kind: "action", actionId: "jarvis.sales.lookup.run", confirmation: null, card: { ...base, title: "Open enquiries", scope: "Everyone's enquiries in this company", filters: ["client or agency: Fictional Wave Agency"], total: 2, shown: 2, sections: [{ heading: "Open enquiries", total: 2, rows }], descriptor: chosenDescriptor } };
    const replies: SendResult[] = [list, question, list, list];
    const api = fakeApi({ send: async () => replies.shift()!, act: async () => chosenCard });
    mount(api);
    openPanel();
    type("Show my open enquiries");
    const c = await screen.findByTestId("jarvis-sales-lookup");
    expect(within(c).getByTestId("lookup-scope").textContent).toMatch(/Fictional Enginious UAE LLC · Owned by you · open \(not Won or Lost; On hold included\) · as of 14 Oct 2099, 10:00 \(Dubai\)/);
    expect(within(c).getByTestId("lookup-more").textContent).toBe("Showing 2 of 41. Open the screen to see them all.");
    expect(within(c).getByTestId("lookup-partial").textContent).toMatch(/incomplete[\s\S]*its open follow-ups[\s\S]*missing, not empty/);
    expect(within(c).getByRole("link", { name: /OPP-UAE-2099-0001/ }).getAttribute("href")).toBe("/sales/opportunities/o1");
    type("Open enquiries for Fictional Wave");
    await waitFor(() => expect(screen.getAllByTestId("jarvis-sales-lookup")).toHaveLength(2));
    // the follow-up carried the QUESTION behind the first card, not its rows
    const ctx = (api.calls.send[1]![0] as { context: { lastQuery: { kind: string; descriptor: Record<string, unknown> } } }).context.lastQuery;
    expect(ctx).toEqual({ kind: "lookup", descriptor: { kind: "enquiries", scope: "mine", stage: null, org: null, event: null, named: null } });
    expect(JSON.stringify(ctx)).not.toMatch(/Fictional job|OPP-UAE/);
    fireEvent.click(within(screen.getByTestId("lookup-choices")).getByRole("button", { name: "Fictional Wave Agency" }));
    await waitFor(() => expect(api.calls.act).toHaveLength(1));
    expect(api.calls.act[0]![0]).toMatchObject({ actionId: "jarvis.sales.lookup.run", companyId: CO1, input: { kind: "enquiries", org: { id: "33333333-3333-4333-8333-333333333333" } } });
    // the card now shows the chosen client's enquiries: a typed follow-up refines THAT question (the client filter is kept), not the ambiguous one
    await waitFor(() => expect(screen.queryByTestId("lookup-choices")).toBeNull());
    type("the whole company instead");
    await waitFor(() => expect(api.calls.send).toHaveLength(3));
    expect((api.calls.send[2]![0] as { context: { lastQuery: unknown } }).context.lastQuery).toEqual({ kind: "lookup", descriptor: chosenDescriptor });
    // another company is selected: a question asked for the first company is not sent with a follow-up for the second
    fireEvent.change(screen.getByLabelText("Company for JARVIS"), { target: { value: CO2 } });
    type("only Negotiation");
    await waitFor(() => expect(api.calls.send).toHaveLength(4));
    expect(api.calls.send[3]![0]).toMatchObject({ companyId: CO2, context: { lastQuery: null } });
  });
  it("a Sales summary shows the app's figures with definitions and dates; AI wording is labelled and apart from suggestions; without wording the figures stand alone with the reason", async () => {
    const card = (over: Record<string, unknown>): SendResult => ({ ok: true, kind: "action", actionId: "jarvis.sales.summary.run", confirmation: null, card: { kind: "summary.sales", title: "Sales enquiries summary", company: { id: CO1, name: companies[0]!.name }, scope: "Everyone's enquiries in this company · counts only, no values", period: "October 2099 so far (2099-10-01 to 2099-10-14, Dubai dates)", comparedWith: null, asOfLabel: "14 Oct 2099, 10:00 (Dubai)", metrics: [{ label: "Won", value: 2, previous: 1, definition: "Enquiries that are Won now and whose closing date falls in the period." }], groups: [{ heading: "Events with the most enquiries", definition: "Per event.", rows: [{ label: "Fictional Forum", count: 2 }], more: 0 }], supporting: [], coverage: ["A won enquiry is not a delivered project: delivery is not covered here."], unavailable: [], narrative: null, narrativeBy: null, suggestions: [], narrativeNote: null, links: [{ label: "Open Sales reports", href: "/sales/reports" }], descriptor: { kind: "period", period: "this_month", compare: false, focus: "all", narrative: false }, ...over } as never });
    const replies: SendResult[] = [card({ narrative: "In October 2099 so far, 2 enquiries were won.", narrativeBy: "app", suggestions: ["Review the open follow-ups."] }), card({ narrativeNote: "The AI model could not be reached. Everything here was computed by Enginious OS and is complete without it.", descriptor: { kind: "period", period: "last_month", compare: true, focus: "all", narrative: true } })];
    const api = fakeApi({ send: async () => replies.shift()!, act: async () => card({ comparedWith: "the same days of September 2099", descriptor: { kind: "period", period: "this_month", compare: true, focus: "all", narrative: false } }) });
    mount(api);
    openPanel();
    type("Summarise this month's enquiries");
    const c = await screen.findByTestId("jarvis-sales-summary");
    expect(within(c).getByTestId("summary-scope").textContent).toMatch(/2099-10-01 to 2099-10-14, Dubai dates/);
    expect(within(c).getByTestId("summary-metrics").textContent).toMatch(/Won2 · before: 1 \(\+1\)Enquiries that are Won now/);
    expect(within(c).getByTestId("summary-narrative").textContent).toBe("In words (written by Enginious OS from the figures above)In October 2099 so far, 2 enquiries were won.");
    expect(within(c).getByTestId("summary-suggestions").textContent).toBe("Suggestions from the AI model (ideas, not recorded facts)Review the open follow-ups.");
    expect(within(c).getByTestId("summary-coverage").textContent).toMatch(/not a delivered project/);
    fireEvent.click(within(c).getByRole("button", { name: "Compare with the previous period" }));
    await waitFor(() => expect(api.calls.act[0]![0]).toMatchObject({ actionId: "jarvis.sales.summary.run", input: { kind: "period", period: "this_month", compare: true } }));
    // the card reran itself with the comparison ON: a typed refinement must carry THAT question, not the one first asked
    await waitFor(() => expect(screen.getByTestId("summary-scope").textContent).toMatch(/compared with the same days of September 2099/));
    type("show last month instead");
    await waitFor(() => expect(api.calls.send).toHaveLength(2));
    expect((api.calls.send[1]![0] as { context: { lastQuery: unknown } }).context.lastQuery).toEqual({ kind: "summary", descriptor: { kind: "period", period: "this_month", compare: true, focus: "all", narrative: false } });
    await waitFor(() => expect(screen.getAllByTestId("summary-narrative-note").some((n) => /could not be reached/.test(n.textContent ?? ""))).toBe(true));
  });
  it("scope wording for an estimate is a draft to copy: it says there are no prices and nothing is saved, and has no save button", async () => {
    const api = fakeApi({ send: async () => ({ ok: true, kind: "action", actionId: "jarvis.sales.estimate.scope_draft", confirmation: null, card: { kind: "estimate.scope", text: "- Counter software (quantity 2)\nExcluded: shipping", questions: ["Which reader model will be supplied?"], enquiry: { reference: "OPP-UAE-2099-0007", title: "Fictional counters", href: "/sales/opportunities/o7" }, note: "A draft of scope wording only. It has no prices, creates no estimate and saves nothing: copy what you need into the Estimate screen and enter the amounts there.", links: [{ label: "Proposals & quotes", href: "/sales/proposals" }] } }) });
    mount(api);
    openPanel();
    type("Draft the estimate scope for OPP-UAE-2099-0007");
    const c = await screen.findByTestId("jarvis-scope-draft");
    expect(within(c).getByTestId("scope-text").textContent).toMatch(/Counter software \(quantity 2\)/);
    expect(within(c).getByTestId("scope-questions").textContent).toMatch(/reader model/);
    expect(within(c).getByTestId("scope-note").textContent).toMatch(/no prices, creates no estimate and saves nothing/);
    expect(within(c).getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(within(c).queryByRole("button", { name: /save|create|confirm|send/i })).toBeNull();
  });
  it("a brief that could not be separated shows the text that WOULD be sent, editable, with the form as the other way; sending it carries the original text and the edited version", async () => {
    const api = fakeApi({ send: async (a) => ((a as { briefOutbound: string | null }).briefOutbound ? cardResult() : { ok: true, kind: "brief_review", text: "I have not sent anything.", outbound: "Title: Gala\nThe crew bonus is AED 5,000.", formHref: "/sales/new" }) });
    mount(api);
    openPanel();
    type("Title: Gala\nThe crew bonus is AED 5,000.");
    const r = await screen.findByTestId("jarvis-brief-review");
    expect(within(r).getByRole("link", { name: "Use the new-enquiry form instead" }).getAttribute("href")).toBe("/sales/new");
    expect(screen.queryByTestId("jarvis-card")).toBeNull();
    fireEvent.change(within(r).getByLabelText("Text that would be sent to the AI model"), { target: { value: "Title: Gala" } });
    fireEvent.click(within(r).getByTestId("brief-review-send"));
    await screen.findByTestId("jarvis-card");
    expect(api.calls.send[1]![0]).toMatchObject({ text: "Title: Gala\nThe crew bonus is AED 5,000.", intent: "enquiry", briefOutbound: "Title: Gala" });
  });
  it("What JARVIS remembers: lists the person's preferences, each can be changed or deleted, and the view is replaced (not duplicated) after a change", async () => {
    const pref = { key: "english", label: "English spelling", value: "british", valueLabel: "British English", options: [{ value: "british", label: "British English" }, { value: "american", label: "American English" }] };
    const memoryCalls: unknown[] = [];
    const api = { ...fakeApi(), memory: async (a: { op: string }) => { memoryCalls.push(a); return { ok: true as const, kind: "memory" as const, text: a.op === "delete" ? "I am not remembering anything for you." : "This is what I remember for you. Only you can see it.", preferences: a.op === "delete" ? [] : [pref] }; } } as JarvisClientApi;
    mount(api as never);
    openPanel();
    fireEvent.click(screen.getByTestId("jarvis-memory-open"));
    const v = await screen.findByTestId("jarvis-memory");
    expect((within(v).getByLabelText("English spelling") as HTMLSelectElement).value).toBe("british");
    fireEvent.change(within(v).getByLabelText("English spelling"), { target: { value: "american" } });
    await waitFor(() => expect(memoryCalls).toContainEqual({ op: "set", key: "english", value: "american" }));
    fireEvent.click(within(await screen.findByTestId("jarvis-memory")).getByRole("button", { name: "Delete English spelling" }));
    await waitFor(() => expect(screen.getByTestId("memory-text").textContent).toMatch(/not remembering anything/));
    expect(memoryCalls).toContainEqual({ op: "delete", key: "english" });
    expect(screen.getAllByTestId("jarvis-memory")).toHaveLength(1);
  });
});

const ROLES = [{ id: "agency", label: "Agency" }, { id: "direct", label: "Direct client" }, { id: "client", label: "End client" }, { id: "technology", label: "Technology company" }] as OrgRegisterCard["roleOptions"];
const orgSearch = (over: Partial<OrgRegisterCard> = {}): OrgRegisterCard => ({ kind: "org.register", stage: "search", company: { id: CO1, name: companies[0]!.name }, query: "Fictional Lantern Events", matches: [], values: { companyId: CO1, name: "Fictional Lantern Events", roles: [], country: null, website: null, place: null, note: null }, problems: [], valid: false, roleOptions: ROLES, ...over });
const orgDetails = (over: Partial<OrgRegisterCard> = {}): OrgRegisterCard => orgSearch({ stage: "details", problems: [{ field: "roles", message: "Choose what kind of organisation it is (agency, direct client, end client or technology company)." }], ...over });
const ORG_ID = "jarvis.sales.organisation.register";
const actionResult = (card: OrgRegisterCard, confirmation: ReturnType<typeof conf> | null = null): SendResult => ({ ok: true, kind: "action", actionId: ORG_ID, card, confirmation });
const IDS = [...ALL_IDS, ORG_ID];

describe("register a client or agency (two steps, its own confirmation)", () => {
  async function toSearch(api: ReturnType<typeof fakeApi>) {
    mount(api, { enabledActionIds: IDS });
    openPanel();
    fireEvent.click(screen.getByTestId("mode-organisation"));
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "Fictional Lantern Events" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByTestId("jarvis-org-card");
  }
  it("search step: shows what exists with links, offers 'register as new' (never registers), then the details step has its own button, disabled until the type is chosen", async () => {
    const existing = { id: "44444444-4444-4444-8444-444444444444", name: "Fictional Lantern Events Ltd", roles: ["agency"], place: "Dubai", country: null, website: null, reasons: ["similar name" as const], binding: false };
    const api = fakeApi({
      send: async () => actionResult(orgSearch({ matches: [existing] })),
      act: async () => actionResult(orgDetails({ matches: [existing] })),
    });
    await toSearch(api);
    const card = screen.getByTestId("jarvis-org-card");
    expect(card.getAttribute("data-stage")).toBe("search");
    expect(within(card).getByRole("link", { name: "Fictional Lantern Events Ltd" }).getAttribute("href")).toBe(`/sales/accounts/${existing.id}?company=${CO1}`);
    expect(within(card).queryByTestId("register-organisation")).toBeNull();
    fireEvent.click(within(card).getByTestId("org-new"));
    await waitFor(() => expect(screen.getByTestId("jarvis-org-card").getAttribute("data-stage")).toBe("details"));
    expect(api.calls.act[0]![0]).toMatchObject({ companyId: CO1, actionId: ORG_ID, input: { mode: "details", name: "Fictional Lantern Events" } });
    expect(api.calls.confirmAction).toHaveLength(0);
    const save = screen.getByTestId("register-organisation") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByTestId("problem-roles")).toBeTruthy();
  });
  it("details step: choosing the type and reviewing issues the confirmation; the explicit button saves once and shows the real name with a link", async () => {
    let n = 0;
    const api = fakeApi({
      send: async () => actionResult(orgDetails()),
      act: async (...a: unknown[]) => { const input = (a[0] as { input: { fields?: { roles?: string[] } } }).input; n++; return actionResult(orgDetails({ problems: [], valid: true, values: { ...orgDetails().values, roles: (input.fields?.roles ?? []) as OrgRegisterCard["values"]["roles"] } }), conf(`org-${n}`)); },
      confirmAction: async (): Promise<ActionConfirmResult> => ({ ok: true, status: "done", confirmationId: "org-1", actionId: ORG_ID, reference: "Fictional Lantern Events", href: `/sales/accounts/x?company=${CO1}`, summary: "Fictional Lantern Events was added to Clients & Agencies, and you approved it.", replayed: false }),
    });
    await toSearch(api);
    fireEvent.click(screen.getByTestId("role-agency"));
    expect(screen.getByText(/You changed something: review the changes first/)).toBeTruthy();
    expect((screen.getByTestId("register-organisation") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await waitFor(() => expect((screen.getByTestId("register-organisation") as HTMLButtonElement).disabled).toBe(false));
    const save = screen.getByTestId("register-organisation");
    fireEvent.click(save); fireEvent.click(save);
    const done = await screen.findByTestId("jarvis-result");
    expect(done.textContent).toMatch(/Fictional Lantern Events was added/);
    expect(within(done).getByRole("link", { name: /Open Fictional Lantern Events/ }).getAttribute("href")).toBe(`/sales/accounts/x?company=${CO1}`);
    expect(api.calls.confirmAction).toHaveLength(1);
    expect(api.calls.confirmAction[0]![0]).toMatchObject({ companyId: CO1, actionId: ORG_ID, token: "tok-org-1", acknowledgements: { matchIds: [] } });
  });
  it("a same-name organisation needs 'these are different organisations' ticked, and the acknowledged ids go with the save", async () => {
    const twin = { id: "55555555-5555-4555-8555-555555555555", name: "Fictional Lantern Events", roles: ["agency"], place: null, country: null, website: null, reasons: ["same name" as const], binding: true };
    const api = fakeApi({
      send: async () => actionResult(orgDetails({ problems: [], valid: true, matches: [twin], values: { ...orgDetails().values, roles: ["agency"] } }), conf("org-9")),
      confirmAction: async (): Promise<ActionConfirmResult> => ({ ok: true, status: "done", confirmationId: "org-9", actionId: ORG_ID, reference: "Fictional Lantern Events", href: null, summary: "Added.", replayed: false }),
    });
    await toSearch(api);
    const save = screen.getByTestId("register-organisation") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("ack-org"));
    expect((screen.getByTestId("register-organisation") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("register-organisation"));
    await screen.findByTestId("jarvis-result");
    expect(api.calls.confirmAction[0]![0]).toMatchObject({ acknowledgements: { matchIds: [twin.id] } });
  });
  it("an unknown answer shows 'Checking the original result' and never offers a second save; a refusal is shown in words", async () => {
    let status = 0;
    const api = fakeApi({
      send: async () => actionResult(orgDetails({ problems: [], valid: true, values: { ...orgDetails().values, roles: ["agency"] } }), conf("org-5")),
      confirmAction: async (): Promise<ActionConfirmResult> => ({ ok: false, code: "ambiguous", message: "We did not get an answer to the save.", confirmationId: "org-5" }),
      status: async (): Promise<StatusResult> => (++status < 2 ? { ok: true, state: "not_recorded" } : { ok: true, state: "done", reference: "Fictional Lantern Events", opportunityId: "o", href: "/sales/accounts/o", summary: "Saved earlier.", actionId: ORG_ID }),
    });
    await toSearch(api);
    fireEvent.click(screen.getByTestId("register-organisation"));
    await screen.findByTestId("jarvis-checking");
    expect(screen.queryByTestId("register-organisation")).toBeNull();
    expect((await screen.findByTestId("jarvis-result", {}, { timeout: 6000 })).textContent).toMatch(/Saved earlier/);
    expect(api.calls.confirmAction).toHaveLength(1);
  }, 12000);
  it("a refusal by the server is shown and the card can be reviewed again", async () => {
    const api = fakeApi({
      send: async () => actionResult(orgDetails({ problems: [], valid: true, values: { ...orgDetails().values, roles: ["agency"] } }), conf("org-6")),
      confirmAction: async (): Promise<ActionConfirmResult> => ({ ok: false, code: "not_permitted", message: "You do not have access to that module for this company." }),
    });
    await toSearch(api);
    fireEvent.click(screen.getByTestId("register-organisation"));
    expect((await screen.findByTestId("card-failed")).textContent).toMatch(/do not have access/);
  });
  it("the review card's unknown organisation offers 'Register with JARVIS' only when the action is enabled, and it starts the search step", async () => {
    const notFound = { field: "agency" as const, typedName: "Fictional Lantern Events", status: "not_found" as const, selectedId: null, selectedName: null, options: [], guidance: 'No organisation called "Fictional Lantern Events" is recorded. Register it in Clients & Agencies first; JARVIS never creates an organisation by itself.' };
    const api = fakeApi({ send: async (...a: unknown[]) => ((a[0] as { intent?: string }).intent === "organisation" ? actionResult(orgSearch()) : cardResult(card({ agency: notFound, valid: false, problems: [{ field: "agencyOrgId", message: "x" }] }), null)) });
    mount(api, { enabledActionIds: IDS });
    openPanel();
    await paste();
    fireEvent.click(screen.getByTestId("register-agency"));
    await screen.findByTestId("jarvis-org-card");
    expect(api.calls.send[1]![0]).toMatchObject({ text: "Fictional Lantern Events", intent: "organisation" });
    cleanup();
    mount(fakeApi({ send: async () => cardResult(card({ agency: notFound, valid: false, problems: [{ field: "agencyOrgId", message: "x" }] }), null) }));
    openPanel();
    await paste();
    expect(screen.queryByTestId("register-agency")).toBeNull();
  });
});

const UPD_ID = "jarvis.sales.enquiry.update";
const form = { title: "Harbour gala LED wall", brief: null, eventStart: "2026-12-05", eventEnd: null, installStart: null, location: "Harbour Hall", technologies: [{ name: "LED wall", qty: 2 }], scope: null, waitingOn: null, budgetNote: null };
const updCard = (over: Partial<EnquiryUpdateCard> = {}): EnquiryUpdateCard => ({
  kind: "enquiry.update", enquiry: { id: ENQ, reference: "OPP-UAE-2026-0007", title: "Harbour gala LED wall", stage: "new", stageLabel: "New enquiry", companyId: CO1, version: 3 },
  changes: [{ field: "location", label: "Location", before: "Harbour Hall", after: "Marina Arena" }], current: form, proposed: { ...form, location: "Marina Arena" },
  fields: [{ key: "title", label: "Title" }], values: { companyId: CO1, enquiryId: ENQ, patch: { location: "Marina Arena" } }, problems: [], valid: true, ...over,
});
const updResult = (c: EnquiryUpdateCard, confirmation: ReturnType<typeof conf> | null = conf("u-1")): SendResult => ({ ok: true, kind: "action", actionId: UPD_ID, card: c, confirmation });

describe("update an enquiry", () => {
  async function open(api: ReturnType<typeof fakeApi>) {
    mount(api, { enabledActionIds: [...IDS, UPD_ID] });
    openPanel();
    fireEvent.click(screen.getByTestId("mode-update"));
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "Location: Marina Arena" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByTestId("jarvis-update-card");
  }
  it("shows before and after, binds nothing in the browser, and saves once with the explicit button (a double click is one call)", async () => {
    const api = fakeApi({
      send: async () => updResult(updCard()),
      confirmAction: async (): Promise<ActionConfirmResult> => ({ ok: true, status: "done", confirmationId: "u-1", actionId: UPD_ID, reference: "OPP-UAE-2026-0007", href: `/sales/opportunities/${ENQ}`, summary: "OPP-UAE-2026-0007 was updated (location), and you approved it.", replayed: false }),
    });
    await open(api);
    const row = screen.getByTestId("change-location");
    expect(row.textContent).toMatch(/Location.*Harbour Hall.*Marina Arena/);
    expect(screen.getByText(/version 3 of the enquiry/)).toBeTruthy();
    const save = screen.getByTestId("save-update");
    fireEvent.click(save); fireEvent.click(save);
    expect((await screen.findByTestId("jarvis-result")).textContent).toMatch(/was updated \(location\)/);
    expect(api.calls.confirmAction).toHaveLength(1);
    expect(api.calls.confirmAction[0]![0]).toMatchObject({ actionId: UPD_ID, token: "tok-u-1", values: { patch: { location: "Marina Arena" } } });
  });
  it("editing a field needs 'Review changes' first (save disabled), and the revise call carries the whole form", async () => {
    const api = fakeApi({ send: async () => updResult(updCard()), act: async () => updResult(updCard({ proposed: { ...form, location: "Marina Arena", scope: "Everything" } }), conf("u-2")) });
    await open(api);
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "Everything" } });
    expect((screen.getByTestId("save-update") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await waitFor(() => expect(api.calls.act).toHaveLength(1));
    expect(api.calls.act[0]![0]).toMatchObject({ actionId: UPD_ID, input: { mode: "revise", enquiryId: ENQ, fields: { scope: "Everything", location: "Marina Arena" } } });
    await waitFor(() => expect((screen.getByTestId("save-update") as HTMLButtonElement).disabled).toBe(false));
  });
  it("a stale enquiry is shown in words, the card stays reviewable; nothing to change cannot be saved", async () => {
    const api = fakeApi({ send: async () => updResult(updCard()), confirmAction: async (): Promise<ActionConfirmResult> => ({ ok: false, code: "needs_review", message: "This enquiry was changed by someone else after you reviewed it. Review the details again before saving." }) });
    await open(api);
    fireEvent.click(screen.getByTestId("save-update"));
    expect((await screen.findByTestId("card-failed")).textContent).toMatch(/changed by someone else/);
    cleanup();
    const empty = fakeApi({ send: async () => updResult(updCard({ changes: [], valid: false, proposed: form, problems: [{ field: "patch", message: "Nothing would change. Say what to change." }] }), null) });
    await open(empty);
    expect(screen.getByTestId("update-nothing")).toBeTruthy();
    expect((screen.getByTestId("save-update") as HTMLButtonElement).disabled).toBe(true);
  });
});

const STG_ID = "jarvis.sales.enquiry.change_stage";
const stageCard = (over: Partial<EnquiryStageCard> = {}): EnquiryStageCard => ({
  kind: "enquiry.stage", enquiry: { id: ENQ, reference: "OPP-UAE-2026-0007", title: "Harbour gala LED wall", stage: "new", stageLabel: "New enquiry", companyId: CO1, version: 5 }, from: "new", fromLabel: "New enquiry", to: "qualified", toLabel: "Qualified",
  transitions: [{ to: "qualified", toLabel: "Qualified", direction: "forward", enabled: true, reason: null }, { to: "proposal_sent", toLabel: "Proposal sent", direction: "forward", enabled: false, reason: "That skips stages. JARVIS moves one step at a time." }],
  evidence: [{ label: "Evidence", met: true, text: "This move needs no extra evidence." }], effects: ["The enquiry moves to the new stage."], values: { companyId: CO1, enquiryId: ENQ, from: "new", to: "qualified" }, problems: [], valid: true, ...over,
});
const stageResult = (c: EnquiryStageCard, confirmation: ReturnType<typeof conf> | null = conf("s-1")): SendResult => ({ ok: true, kind: "action", actionId: STG_ID, card: c, confirmation });

describe("change status", () => {
  async function open(api: ReturnType<typeof fakeApi>) {
    mount(api, { enabledActionIds: [...IDS, STG_ID] });
    openPanel();
    fireEvent.click(screen.getByTestId("mode-stage"));
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "move to qualified" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByTestId("jarvis-stage-card");
  }
  it("shows current -> proposed, the evidence and effects, disabled moves with their reason, and moves once", async () => {
    const api = fakeApi({ send: async () => stageResult(stageCard()), confirmAction: async (): Promise<ActionConfirmResult> => ({ ok: true, status: "done", confirmationId: "s-1", actionId: STG_ID, reference: "OPP-UAE-2026-0007", href: `/sales/opportunities/${ENQ}`, summary: "OPP-UAE-2026-0007 was moved from New enquiry to Qualified, and you approved it.", replayed: false }) });
    await open(api);
    expect(screen.getByTestId("stage-from-to").textContent).toMatch(/New enquiry.*Qualified/);
    expect(screen.getByTestId("stage-disabled").textContent).toMatch(/Moves not available from here/);
    expect(screen.getByTestId("transition-proposal_sent").textContent).toMatch(/skips stages/);
    expect((within(screen.getByTestId("transition-proposal_sent")).getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("stage-evidence").textContent).toMatch(/no extra evidence/);
    expect(screen.getByText(/Won, Lost, On hold, reopening and handover are not available/)).toBeTruthy();
    const save = screen.getByTestId("save-stage");
    fireEvent.click(save); fireEvent.click(save);
    expect((await screen.findByTestId("jarvis-result")).textContent).toMatch(/moved from New enquiry to Qualified/);
    expect(api.calls.confirmAction).toHaveLength(1);
  });
  it("choosing a stage asks the server (no write); without a valid choice Move stays disabled; a stale refusal is shown", async () => {
    const api = fakeApi({
      send: async () => stageResult(stageCard({ to: null, toLabel: null, values: null, valid: false, problems: [{ field: "to", message: "Choose the stage to move it to." }] }), null),
      act: async () => stageResult(stageCard()),
      confirmAction: async (): Promise<ActionConfirmResult> => ({ ok: false, code: "needs_review", message: "This enquiry was changed by someone else after you reviewed it. Review the details again before moving it." }),
    });
    await open(api);
    expect((screen.getByTestId("save-stage") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(screen.getByTestId("transition-qualified")).getByRole("button"));
    await waitFor(() => expect(api.calls.act).toHaveLength(1));
    expect(api.calls.act[0]![0]).toMatchObject({ actionId: STG_ID, input: { mode: "propose", enquiryId: ENQ, to: "qualified" } });
    await waitFor(() => expect((screen.getByTestId("save-stage") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("save-stage"));
    expect((await screen.findByTestId("card-failed")).textContent).toMatch(/changed by someone else/);
  });
});

const MEET_ID = "jarvis.sales.meeting.record";
const meetValues = { companyId: CO1, enquiryId: ENQ, kind: "meeting" as const, body: "Met the agency about the gala.", occurredOn: null, internal: false, planFollowUp: true, followUpTitle: "Send the proposal", followUpDate: "2026-11-20", followUpTime: "10:00", followUpKind: "proposal" as const };
const meetCard = (over: Partial<MeetingCard> = {}): MeetingCard => ({ kind: "meeting.record", enquiry: { id: ENQ, reference: "OPP-UAE-2026-0007", title: "Harbour gala LED wall", stage: "qualified", stageLabel: "Qualified", companyId: CO1 }, values: meetValues, questions: [], problems: [], valid: true, ...over });
const meetResult = (c: MeetingCard, confirmation: ReturnType<typeof conf> | null = conf("m-1")): SendResult => ({ ok: true, kind: "action", actionId: MEET_ID, card: c, confirmation });

describe("meeting notes", () => {
  async function open(api: ReturnType<typeof fakeApi>) {
    mount(api, { enabledActionIds: [...IDS, MEET_ID] });
    openPanel();
    fireEvent.click(screen.getByTestId("mode-meeting"));
    fireEvent.change(screen.getByLabelText("Paste a brief or ask a question"), { target: { value: "Met the agency." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByTestId("jarvis-meeting-card");
  }
  it("shows the activity and the follow-up with ONE save button that saves both once, and says they are saved together", async () => {
    const api = fakeApi({ send: async () => meetResult(meetCard()), confirmAction: async (): Promise<ActionConfirmResult> => ({ ok: true, status: "done", confirmationId: "m-1", actionId: MEET_ID, reference: "OPP-UAE-2026-0007", href: `/sales/opportunities/${ENQ}`, summary: "OPP-UAE-2026-0007: the activity and the follow-up were recorded together, and you approved them.", replayed: false }) });
    await open(api);
    expect(screen.getByText(/saved together when you press Save, or not at all/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save update and follow-up" })).toBeTruthy();
    const save = screen.getByTestId("save-meeting");
    fireEvent.click(save); fireEvent.click(save);
    expect((await screen.findByTestId("jarvis-result")).textContent).toMatch(/recorded together/);
    expect(api.calls.confirmAction).toHaveLength(1);
    expect(api.calls.confirmAction[0]![0]).toMatchObject({ actionId: MEET_ID, token: "tok-m-1", values: { followUpTitle: "Send the proposal", followUpDate: "2026-11-20" } });
  });
  it("an unknown date is a question, not a guess: no confirmation, Save disabled until the person picks one and reviews", async () => {
    const api = fakeApi({
      send: async () => meetResult(meetCard({ valid: false, values: { ...meetValues, followUpDate: "" }, questions: [{ field: "followUpDate", text: "When is the follow-up due? The notes do not give an exact date, so JARVIS has not guessed one." }], problems: [{ field: "followUpDate", message: "Choose the date of the follow-up." }] }), null),
      act: async () => meetResult(meetCard(), conf("m-2")),
    });
    await open(api);
    expect(screen.getByTestId("card-questions").textContent).toMatch(/has not guessed one/);
    expect((screen.getByTestId("save-meeting") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Due") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-11-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await waitFor(() => expect(api.calls.act).toHaveLength(1));
    expect(api.calls.act[0]![0]).toMatchObject({ actionId: MEET_ID, input: { mode: "revise", enquiryId: ENQ, fields: { followUpDate: "2026-11-20" } } });
    await waitFor(() => expect((screen.getByTestId("save-meeting") as HTMLButtonElement).disabled).toBe(false));
  });
  it("turning the follow-up off hides its fields and a refused save is shown in words with nothing recorded", async () => {
    const api = fakeApi({ send: async () => meetResult(meetCard()), confirmAction: async (): Promise<ActionConfirmResult> => ({ ok: false, code: "save_failed", message: "A closed opportunity has no follow-ups" }) });
    await open(api);
    fireEvent.click(screen.getByTestId("plan-follow-up"));
    expect(screen.queryByLabelText("Due")).toBeNull();
    fireEvent.click(screen.getByTestId("plan-follow-up"));
    fireEvent.click(screen.getByTestId("save-meeting"));
    expect((await screen.findByTestId("card-failed")).textContent).toMatch(/closed opportunity has no follow-ups/);
  });
});
