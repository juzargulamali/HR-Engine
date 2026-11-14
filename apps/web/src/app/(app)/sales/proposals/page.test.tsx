/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./proposal-file-link", () => ({ OpenFileButton: ({ name }: { name: string }) => <span>{name}</span> }));
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ({ userId: "u1", grants: [], companies: [{ id: "c1", name: "Fictional Beta UAE" }] }) }));

const LIMIT = 500;
let rows: unknown[] = [];
let fail = false;
vi.mock("@/lib/crm/data", () => ({ PROPOSALS_LIMIT: 500, loadProposals: async () => { if (fail) throw new Error("Sales data could not be loaded: down"); return rows; } }));

import ProposalsPage from "./page";
const render = async (sp: { status?: string } = {}) => renderToStaticMarkup(await ProposalsPage({ searchParams: Promise.resolve(sp) }));

const row = (id: string, o: { status?: string; version?: number; stage?: string; next?: { title: string; due_at: string } | null; noEnquiry?: boolean } = {}) => ({
  proposal: { id, opportunity_id: `opp-${id}`, version: o.version ?? 1, status: o.status ?? "sent", sent_on: "2026-11-01", note: null, file_id: null },
  opportunity: o.noEnquiry ? null : { opp: { id: `opp-${id}`, title: `Fictional enquiry ${id}`, reference: `OPP-${id}`, stage: o.stage ?? "proposal_sent" }, companyName: "Fictional Beta UAE", ownerName: "Fictional Sara", nextFollowUp: o.next === undefined ? { title: "Chase the reply", due_at: "2099-01-05T06:00:00Z" } : o.next },
  file: null, estimate: null,
});

beforeEach(() => { rows = [row("1")]; fail = false; });

describe("Proposals & quotes (/sales/proposals)", () => {
  it("is called what the navigation calls it", async () => {
    const html = await render();
    expect(html).toContain("<h1");
    expect(html).toMatch(/<h1[^>]*>Proposals &amp; quotes/);
    expect(html).not.toMatch(/<h1[^>]*>Proposals</);
  });

  it("a row opens the enquiry at its Proposals tab, and shows version, status and the next action together", async () => {
    rows = [row("1", { version: 3 })];
    const html = await render();
    expect(html).toContain('href="/sales/opportunities/opp-1?tab=proposals"');
    expect(html).not.toContain('href="/sales/opportunities/opp-1"');
    expect(html).toContain("Version and status");
    expect(html).toContain("v3");
    expect(html).toContain("Sent");
    expect(html).toContain("Next action");
    expect(html).toContain("Chase the reply");
  });

  it("says plainly when an open enquiry has no follow-up, and asks for nothing on a closed, held or replaced one", async () => {
    rows = [row("1", { next: null })];
    expect(await render()).toContain("No follow-up planned on the enquiry");
    rows = [row("1", { next: null, stage: "won" })];
    expect(await render()).toContain("None: the enquiry is won");
    rows = [row("1", { next: null, stage: "on_hold" })];
    expect(await render()).toContain("None: the enquiry is on hold");
    rows = [row("1", { status: "superseded" })];
    expect(await render()).toContain("None: replaced by a newer version");
    rows = [row("1", { noEnquiry: true })];
    expect(await render()).toContain("Enquiry not available");
  });

  it("says 'the latest 500' when the read came back full, and nothing below that", async () => {
    rows = Array.from({ length: LIMIT }, (_, i) => row(String(i)));
    const full = await render();
    expect(full).toContain("Showing the latest 500 versions. Older ones are not listed or counted here");
    rows = Array.from({ length: LIMIT - 1 }, (_, i) => row(String(i)));
    expect(await render()).not.toContain("Showing the latest");
  });

  it("a failed read says it could not load, never 'No proposals yet'", async () => {
    fail = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render();
    spy.mockRestore();
    expect(html).toContain("Could not load proposals and quotes");
    expect(html).not.toContain("No proposals yet");
  });

  it("an empty register says where proposals are added", async () => {
    rows = [];
    const html = await render();
    expect(html).toContain("No proposals yet");
    expect(html).toContain("Proposals &amp; files tab");
  });
});
