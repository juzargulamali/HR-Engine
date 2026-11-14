import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

/**
 * A stand-in for the database that keeps the SAME rules the handover functions keep (20261120000200_proj_projects_handover_functions.sql), so a repeated call can be
 * followed to its end: one open handover per enquiry (uq_proj_handovers_open), a repeated submit returns quietly, a repeated accept returns the same project, one
 * project per enquiry (uq_proj_projects_opportunity). Fictional data only.
 */
interface Handover { id: string; opportunityId: string; status: string; version: number; scope: string | null; technologies: unknown; pm: string | null; projectId: string | null; revision: number }
let handovers: Handover[] = [];
let projects: { id: string; opportunityId: string; scope: string | null; technologies: unknown }[] = [];
let notifications: string[] = [];
let failNext: { message: string } | null = null;
const O = "22222222-2222-4222-8222-222222222222";
const H1 = "11111111-1111-4111-8111-000000000001";

const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
  if (failNext) { const error = failNext; failNext = null; return { data: null, error }; }
  if (name === "proj_save_handover") {
    const fields = args.p_fields as Record<string, unknown>;
    const h = handovers.find((x) => x.opportunityId === args.p_opportunity_id && x.status !== "withdrawn");
    if (!h) {
      const created: Handover = { id: `11111111-1111-4111-8111-00000000000${handovers.length + 1}`, opportunityId: String(args.p_opportunity_id), status: "draft", version: 1, scope: (fields.scope as string) ?? null, technologies: fields.technologies ?? [], pm: null, projectId: null, revision: 0 };
      handovers.push(created);
      return { data: created.id, error: null };
    }
    if (args.p_expected_version != null && args.p_expected_version !== h.version) return { data: null, error: { message: "This was changed by someone else. Reload and try again" } };
    if (!["draft", "submitted", "clarification_requested"].includes(h.status)) return { data: null, error: { message: `This handover can no longer be edited (status: ${h.status})` } };
    if ("scope" in fields) h.scope = (fields.scope as string) ?? null;
    if (fields.technologies) h.technologies = fields.technologies;
    h.version += 1;
    return { data: h.id, error: null };
  }
  const h = handovers.find((x) => x.id === args.p_handover_id);
  if (!h) return { data: null, error: { message: "Handover not found" } };
  if (name === "proj_submit_handover") {
    if (["submitted", "pm_assigned", "accepted"].includes(h.status)) return { data: null, error: null };          // repeated click: nothing more to do
    if (!h.scope?.trim()) return { data: null, error: { message: "Describe the scope of work before submitting the handover" } };
    h.status = h.pm ? "pm_assigned" : "submitted"; h.revision += 1; h.version += 1;
    notifications.push(`submitted:${h.id}:rev:${h.revision}`);
    return { data: null, error: null };
  }
  if (name === "proj_accept_handover") {
    if (h.status === "accepted") return { data: h.projectId, error: null };                                       // repeated click: same project
    if (h.status !== "pm_assigned") return { data: null, error: { message: `This handover is not waiting for acceptance (status: ${h.status})` } };
    if (projects.some((p) => p.opportunityId === h.opportunityId)) return { data: null, error: { message: "A project already exists for this opportunity" } };
    const project = { id: `p${projects.length + 1}`, opportunityId: h.opportunityId, scope: h.scope, technologies: h.technologies };
    projects.push(project);
    h.status = "accepted"; h.projectId = project.id; h.version += 1;
    notifications.push(`accepted:${h.id}`);
    return { data: project.id, error: null };
  }
  throw new Error(`unexpected rpc ${name}`);
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { acceptHandover, saveAndSubmitHandover } from "./projectsCore";

const idle = { error: null };
const brief = (over: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ opportunityId: O, expectedVersion: "", title: "Fictional Expo stand", siteTimezone: "Asia/Dubai", scope: "Two LED walls, installed and run", technologies: JSON.stringify([{ name: "LED wall", qty: 2 }]), ...over })) f.append(k, v);
  return f;
};
const accept = async (id: string) => { const f = new FormData(); f.append("handoverId", id); try { return await acceptHandover(idle, f); } catch (e) { return (e as Error).message; } };

beforeEach(() => { handovers = []; projects = []; notifications = []; failNext = null; rpc.mockClear(); redirect.mockClear(); });

describe("submitting a handover twice", () => {
  it("a double click or a retry creates ONE handover, submits it once and tells people once", async () => {
    const first = await saveAndSubmitHandover(idle, brief());
    const again = await saveAndSubmitHandover(idle, brief());                       // the same form sent again (the page had not refreshed: still no version)
    expect(first).toEqual({ error: null, id: H1 });
    expect(again).toEqual({ error: null, id: H1 });                               // the existing handover, not a second one
    expect(handovers).toHaveLength(1);
    expect(handovers[0]!.status).toBe("submitted");
    expect(handovers[0]!.revision).toBe(1);
    expect(handovers[0]!.technologies).toEqual([{ name: "LED wall", qty: 2 }]);     // the scope and equipment are replaced by the same values, never appended
    expect(notifications).toEqual([`submitted:${H1}:rev:1`]);
  });

  it("a retry from a page that still holds the old version is refused in words and changes nothing", async () => {
    await saveAndSubmitHandover(idle, brief());
    const stale = await saveAndSubmitHandover(idle, brief({ expectedVersion: "1" }));   // the brief is at version 3 by now (saved, then submitted)
    expect(stale.error).toMatch(/changed by someone else/);
    expect(handovers).toHaveLength(1);
    expect(notifications).toHaveLength(1);
  });

  it("two first saves at the same moment: the second is told one was just saved, and no second handover exists", async () => {
    await saveAndSubmitHandover(idle, brief());
    failNext = { message: 'duplicate key value violates unique constraint "uq_proj_handovers_open"' };
    const r = await saveAndSubmitHandover(idle, brief());
    expect(r.error).toBe("A handover for this enquiry was saved a moment ago, so a second one was not created. Reload the page to see it and carry on from there.");
    expect(handovers).toHaveLength(1);
  });

  it("a refused submission keeps the draft and says so (the scope is still required)", async () => {
    const r = await saveAndSubmitHandover(idle, brief({ scope: "" }));
    expect(r.error).toBe("Your changes are saved as a draft, but it was not submitted: Describe the scope of work before submitting the handover");
    expect(handovers).toHaveLength(1);
    expect(handovers[0]!.status).toBe("draft");
    expect(notifications).toEqual([]);
  });
});

describe("accepting a handover twice", () => {
  const assigned = async () => { await saveAndSubmitHandover(idle, brief()); handovers[0]!.status = "pm_assigned"; handovers[0]!.pm = "u-pm"; };

  it("a double click or a retry after a timeout opens the SAME project: one project, the scope copied once", async () => {
    await assigned();
    const first = await accept(H1);
    const again = await accept(H1);
    expect(first).toBe("REDIRECT:/projects/p1/delivery?from=handover");
    expect(again).toBe("REDIRECT:/projects/p1/delivery?from=handover");            // the existing project is what the second attempt shows
    expect(projects).toHaveLength(1);
    expect(projects[0]!.technologies).toEqual([{ name: "LED wall", qty: 2 }]);
    expect(notifications.filter((n) => n.startsWith("accepted"))).toEqual([`accepted:${H1}`]);
  });

  it("if the database says a project already exists, it says no second one was made and where to open it", async () => {
    await assigned();
    failNext = { message: "A project already exists for this opportunity" };
    const r = await accept(H1);
    expect(r).toEqual({ error: "A project already exists for this enquiry, so a second one was not created. Reload Handovers and open the project from the accepted handover." });
    expect(redirect).not.toHaveBeenCalled();
    expect(projects).toHaveLength(0);
  });

  it("never opens '/projects/null' when no project id comes back", async () => {
    await assigned();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await accept(H1);
    expect(r).toMatchObject({ error: expect.stringMatching(/accepted, but the project could not be opened/) });
    expect(redirect).not.toHaveBeenCalled();
  });
});
