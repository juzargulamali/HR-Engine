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
import type { ActionConfirmResult, ConfirmResult, EnquiryCard, EnquiryValues, EnquiryUpdateCard, OrgRegisterCard, ReplyDraftCard, SendResult, StatusResult } from "@/lib/jarvis/protocol";

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
    expect(within(d).getByTestId("jarvis-welcome").textContent).toBe("Paste a brief and I'll turn it into an enquiry for you to review.");
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
    const api = fakeApi({ send: async () => ({ ok: true, kind: "action", actionId: "jarvis.sales.help.answer", confirmation: null, card: { kind: "help.answer", mode: "guidance", answer: null, topics: [], note: "From Enginious OS's reviewed guidance.", entries: [{ id: "sales-follow-ups", title: "See and plan follow-ups", summary: "The Follow-ups page lists what is next.", steps: ["Open Follow-ups in Sales."], links: [{ label: "Follow-ups", href: "/sales/follow-ups" }] }] } }) });
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
