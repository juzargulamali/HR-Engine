import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
type Answer = { data?: unknown; error?: { code?: string; message: string } | null };
let answers: Record<string, Answer | ((args: unknown, columns: string | null) => Answer)> = {};
const calls: { fn: string; args: unknown; columns: string | null }[] = [];
/** rpc(fn, args) is awaitable, and rpc(fn).select(cols).limit(n) is too; every call is recorded so a test can prove a function was NOT called. */
function rpc(fn: string, args?: unknown) {
  let columns: string | null = null;
  const answer = () => { calls.push({ fn, args: args ?? null, columns }); const a = answers[fn]; const r = typeof a === "function" ? a(args, columns) : a; return { data: r?.data ?? null, error: r?.error ?? null }; };
  const q = { select: (c: string) => { columns = c; return q; }, limit: () => q, then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(answer).then(resolve, reject) };
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { loadChatGroups, loadProjectChat, loadProjectUnread, projectChatInstalled } from "./data";

const REFUSED: Answer = { error: { code: "42501", message: "You are not a member of this group" } };
const MISSING: Answer = { error: { code: "PGRST202", message: "Could not find the function chat_my_groups in the schema cache" } };
const group = (project: string | null, unread = 0, over: Record<string, unknown> = {}) => ({ gid: `g-${project ?? "s"}`, gkey: project ? `project:${project}` : "sales_uae", gname: "x", unread, mentions: 0, last_at: null, last_sender: null, last_preview: null,
  gkind: project ? "project" : "sales", project_id: project, read_only: false, project_status: project ? "in_progress" : null, via_operations: false, ...over });
const called = (fn: string) => calls.filter((c) => c.fn === fn);

beforeEach(() => { answers = { chat_project_group: REFUSED }; calls.length = 0; });

describe("whether project chat groups exist: never asked with a call the database must refuse", () => {
  it("reads it from the person's own group list when they have a group", async () => {
    answers.chat_my_groups = { data: [group("p1", 2)] };
    expect(await projectChatInstalled()).toBe("yes");
    expect(called("chat_project_group")).toEqual([]);
  });
  it("with no group at all it asks for the one column that only that migration returns", async () => {
    answers.chat_my_groups = () => ({ data: [] });
    expect(await projectChatInstalled()).toBe("yes");
    expect(called("chat_my_groups").map((c) => c.columns)).toContain("gkind");
    answers.chat_my_groups = (_a, columns) => (columns === "gkind" ? { error: { code: "42703", message: "column \"gkind\" does not exist" } } : { data: [] });
    expect(await projectChatInstalled()).toBe("no");
    expect(called("chat_project_group")).toEqual([]);
  });
  it("a list from before project groups (no kind on its rows), and a database without Chat, are both 'not installed'", async () => {
    const { gkind: _k, project_id: _p, read_only: _r, project_status: _s, via_operations: _v, ...old } = group(null, 1);
    answers.chat_my_groups = { data: [old] };
    expect(await projectChatInstalled()).toBe("no");
    answers.chat_my_groups = MISSING;
    expect(await projectChatInstalled()).toBe("no");
    expect(called("chat_project_group")).toEqual([]);
  });
  it("a person with no groups whose follow-up request fails: unknown, not 'not installed', and nothing falls back to the old Discussion", async () => {
    // the list reads fine and is empty; the one-column question then fails for a reason that is not a missing column or function
    for (const failure of [{ message: "the data service did not answer" }, { code: "57014", message: "canceling statement due to statement timeout" }, { code: "PGRST301", message: "JWT expired" }]) {
      calls.length = 0;
      answers.chat_my_groups = (_a, columns) => (columns === "gkind" ? { error: failure } : { data: [] });
      answers.proj_unread_counts = { data: [{ project_id: "stale", unread: 50 }] };
      expect(await projectChatInstalled()).toBe("error");
      expect(await loadProjectUnread()).toBeNull();                                               // "could not be loaded", never zero and never the old counts
      expect(called("proj_unread_counts")).toEqual([]);
      expect(await loadProjectChat("p1", false)).toEqual({ state: "error" });                      // not the old Discussion, and not "not a member"
      expect(called("chat_project_group")).toEqual([]);
    }
    // only a confirmed missing column, or a missing function, is "not installed": then, and only then, the old Discussion's counts are used
    calls.length = 0;
    answers.chat_my_groups = (_a, columns) => (columns === "gkind" ? { error: { code: "42703", message: 'column chat_my_groups.gkind does not exist' } } : { data: [] });
    expect(await projectChatInstalled()).toBe("no");
    expect([...(await loadProjectUnread())!]).toEqual([["stale", 50]]);
    expect(await loadProjectChat("p1", false)).toEqual({ state: "not_installed" });
    answers.chat_my_groups = (_a, columns) => (columns === "gkind" ? MISSING : { data: [] });
    expect(await projectChatInstalled()).toBe("no");
  });
  it("a failed list read is not mistaken for 'not installed': unread counts then say they could not be loaded", async () => {
    answers.chat_my_groups = { error: { message: "the data service did not answer" } };
    expect(await projectChatInstalled()).toBe("error");
    expect(await loadProjectChat("p1", false)).toEqual({ state: "error" });
    expect(await loadProjectUnread()).toBeNull();
    expect(called("proj_unread_counts")).toEqual([]);                                             // no fall back to the old Discussion's counts
  });
  it("unread counts for a member come from the list, with no refused call anywhere", async () => {
    answers.chat_my_groups = { data: [group(null, 4), group("p1", 2), group("p2", 0), group("p3", 5, { read_only: true, project_status: "completed" })] };
    expect([...(await loadProjectUnread())!]).toEqual([["p1", 2], ["p3", 5]]);                    // a finished project a member still reads keeps its count
    expect(calls.every((c) => c.fn === "chat_my_groups")).toBe(true);
  });
});

describe("a project's chat: the database is asked only about someone it could let in", () => {
  it("a member (or an Operations Manager) is checked by the database, which decides", async () => {
    answers.chat_project_group = { data: "g-p1" };
    expect(await loadProjectChat("p1", true)).toEqual({ state: "ready", groupId: "g-p1" });
    answers.chat_project_group = REFUSED;                                                        // the app thought so, the database says no: still refused
    expect(await loadProjectChat("p1", true)).toEqual({ state: "not_member" });
    expect(called("chat_project_group")).toHaveLength(2);
  });
  it("someone who is not on the team is told so without a call the database would refuse", async () => {
    answers.chat_my_groups = { data: [group("p2")] };
    expect(await loadProjectChat("p1", false)).toEqual({ state: "not_member" });
    expect(called("chat_project_group")).toEqual([]);
  });
  it("on a database without project groups a non-member still gets the old Discussion, not 'not a member'", async () => {
    answers.chat_my_groups = MISSING;
    expect(await loadProjectChat("p1", false)).toEqual({ state: "not_installed" });
    expect(called("chat_project_group")).toEqual([]);
  });
  it("a failed check is an error, never 'not a member'", async () => {
    answers.chat_project_group = { error: { message: "the data service did not answer" } };
    expect(await loadProjectChat("p1", true)).toEqual({ state: "error" });
  });
});

describe("the group list", () => {
  it("keeps a completed or archived project's group for a member, read-only", async () => {
    answers.chat_my_groups = { data: [group("p1", 0, { read_only: true, project_status: "archived" })] };
    expect(await loadChatGroups()).toMatchObject({ state: "ok", groups: [{ projectId: "p1", readOnly: true, projectStatus: "archived" }] });
  });
});
