// @vitest-environment node
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";

vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, row: null as unknown, error: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row, error: db.error }) }) }) }) }),
  }),
}));

import { buildOutbound, evidenceItems } from "@/lib/projects/closeout/evidence";
import { fixtureSnapshot, ID } from "@/lib/projects/closeout/fixture";
import { factsOnlyDraft, keyFacts, toSourceRefs, type ReportView } from "@/lib/projects/closeout/report";

const s = fixtureSnapshot();
const sent = buildOutbound(evidenceItems(s), null).sent;
const report: ReportView = { id: "r1", versionNo: 2, status: "approved", version: 4, generation: "generated", snapshotAt: "2027-03-06T10:00:00Z", approvedAt: "2027-03-07T09:00:00Z", approvedBy: "Pat Manager", facts: keyFacts(s), missing: [], sections: factsOnlyDraft(sent), refs: toSourceRefs(sent), include: [] };
const REPORT = "12121212-1212-4212-8212-121212121212";
const row = (over: Record<string, unknown> = {}) => ({ id: REPORT, project_id: ID.project, version_no: 2, status: "approved", version: 4, generation: "generated", snapshot: s, snapshot_at: "2027-03-06T10:00:00Z", approved_at: "2027-03-07T09:00:00Z", approved_by: ID.pm, sections: report.sections, source_refs: report.refs, selection: {}, ...over });
const get = async (project = ID.project, id = REPORT) => (await import("@/app/(app)/projects/[id]/closeout/[reportId]/pdf/route")).GET(new Request("http://x"), { params: Promise.resolve({ id: project, reportId: id }) });

describe("closeout report PDF", () => {
  it("renders a real PDF from an approved version, and an empty one without failing", async () => {
    const { CloseoutDocument, closeoutPdfFileName } = await import("./closeout-document");
    const buf = await renderToBuffer(createElement(CloseoutDocument, { report, projectName: s.project.name, reference: s.project.reference }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(3000);
    const empty = await renderToBuffer(createElement(CloseoutDocument, { report: { ...report, sections: report.sections.map((x) => ({ ...x, paragraphs: [] })), refs: [], missing: ["Equipment: not read"] }, projectName: "T", reference: "X" }) as Parameters<typeof renderToBuffer>[0]);
    expect(empty.subarray(0, 5).toString()).toBe("%PDF-");
    expect(closeoutPdfFileName("UAE-P-2027-0001", 2)).toBe("UAE-P-2027-0001-closeout-v2.pdf");
  });

  it("the download: an approved version only, for whoever the database lets read it; a draft, a stranger, a signed-out visitor and a failed read each get their own answer", async () => {
    db.user = { id: "u1" }; db.error = null; db.row = row();
    const ok = await get();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("application/pdf");
    expect(ok.headers.get("Content-Disposition")).toBe('inline; filename="UAE-P-2027-0001-closeout-v2.pdf"');
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    db.row = row({ status: "draft", approved_at: null, approved_by: null });
    const draft = await get();
    expect(draft.status).toBe(409);
    expect(await draft.text()).toMatch(/still a draft\. Approve it before downloading/);
    db.row = null;                                             // row-level security returned nothing: not a manager, or no such report
    expect((await get()).status).toBe(404);
    db.error = { message: "boom" };
    const failed = await get();
    expect(failed.status).toBe(503);
    expect(await failed.text()).toMatch(/could not be loaded/);
    db.error = null; db.user = null; db.row = row();
    expect((await get()).status).toBe(401);
    db.user = { id: "u1" };
    expect((await get("not-a-uuid")).status).toBe(404);
  });
});
