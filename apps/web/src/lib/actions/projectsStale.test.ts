import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
const rpc = vi.fn();
// `held` is the version the (mocked) database holds for every record; null = no such row, so the stale check stays silent.
let held: number | null = null;
const tables: string[] = [];
const from = (t: string) => { tables.push(t); return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: held === null ? null : { version: held } }) }) }) }; };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { saveDeliverable, saveMilestone, setProjectTaskStatus, updateProjectTask } from "./projectsDelivery";
import { updateProject } from "./projectsCore";
import { saveSiteBooking, savePlanItem } from "./projectsPlans";

const P = "11111111-1111-4111-8111-111111111111";
const X = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

beforeEach(() => { held = null; tables.length = 0; rpc.mockReset().mockResolvedValue({ data: null, error: null }); });

describe("stale edits are answered in words before anything is sent", () => {
  it("task edit and task status", async () => {
    held = 5;
    expect((await updateProjectTask({ error: null }, fd({ projectId: P, taskId: X, title: "New", expectedVersion: "4" }))).error).toMatch(/This task was changed by someone else/);
    expect((await setProjectTaskStatus({ error: null }, fd({ projectId: P, taskId: X, to: "in_progress", expectedVersion: "4" }))).error).toMatch(/changed by someone else/);
    expect(rpc).not.toHaveBeenCalled();
    expect(tables).toEqual(["proj_tasks", "proj_tasks"]);
    held = 4;
    expect((await setProjectTaskStatus({ error: null }, fd({ projectId: P, taskId: X, to: "in_progress", expectedVersion: "4" }))).error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("proj_set_task_status", { p_task_id: X, p_to: "in_progress", p_note: null, p_expected_version: 4 });
  });
  it("project, milestone, deliverable, timeline item and booking saves", async () => {
    held = 9;
    expect((await updateProject({ error: null }, fd({ projectId: P, name: "Renamed", expectedVersion: "3" }))).error).toMatch(/This project was changed/);
    expect((await saveMilestone({ error: null }, fd({ projectId: P, milestoneId: X, title: "M", expectedVersion: "3" }))).error).toMatch(/This milestone was changed/);
    expect((await saveDeliverable({ error: null }, fd({ projectId: P, deliverableId: X, title: "D", expectedVersion: "3" }))).error).toMatch(/This deliverable was changed/);
    expect((await savePlanItem({ error: null }, fd({ projectId: P, itemId: X, title: "I", mode: "undated", expectedVersion: "3" }))).error).toMatch(/This timeline item was changed/);
    expect((await saveSiteBooking({ error: null }, fd({ projectId: P, bookingId: X, userId: P, location: "Hall", expectedVersion: "3" }))).error).toMatch(/This booking was changed/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("stays silent for a new record, a missing version or a version that matches", async () => {
    held = 9;
    expect((await saveMilestone({ error: null }, fd({ projectId: P, title: "New milestone" }))).error).toBeNull();
    expect((await saveMilestone({ error: null }, fd({ projectId: P, milestoneId: X, title: "M" }))).error).toBeNull();
    expect((await saveMilestone({ error: null }, fd({ projectId: P, milestoneId: X, title: "M", expectedVersion: "9" }))).error).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
