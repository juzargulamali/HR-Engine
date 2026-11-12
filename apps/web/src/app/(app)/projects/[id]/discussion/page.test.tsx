// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/** The old Discussion address after the cutover: a member goes to the project's group in Chat; nobody else is shown a conversation; a failed check says so. */
const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); });
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
let grants: { companyId: string; capabilities: string[] }[] = [];
vi.mock("@/lib/projects/context", () => ({ getProjectsContext: async () => ({ userId: "u1", grants }) }));
let isMember = true;
let level: "details" | "summary" = "details";
vi.mock("@/lib/projects/data", () => ({ loadProjectView: async () => ({ level, canManage: false, project: { status: "in_progress", company_id: "c1" }, standing: { isMember }, people: [], nameOf: () => "x" }) }));
let chat: { state: string; groupId?: string } = { state: "ready", groupId: "g-1" };
const asked: boolean[] = [];
vi.mock("@/lib/chat/data", () => ({ loadProjectChat: async (_id: string, mayBeMember: boolean) => { asked.push(mayBeMember); return mayBeMember ? chat : { state: "not_member" }; } }));
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));
vi.mock("./discussion-client", () => ({ DiscussionClient: () => <div data-testid="old-discussion" /> }));
vi.mock("@/components/projects/jump-to-task", () => ({ JumpToTask: () => null }));

import DiscussionPage from "./page";
const open = () => DiscussionPage({ params: Promise.resolve({ id: "p1" }) });

beforeEach(() => { level = "details"; chat = { state: "ready", groupId: "g-1" }; isMember = true; grants = []; asked.length = 0; redirect.mockClear(); from.mockReset(); });
afterEach(cleanup);

describe("the old Discussion address", () => {
  it("sends an enrolled member to the project's Work page with its group open in Chat, without reading the old messages", async () => {
    await expect(open()).rejects.toThrow("REDIRECT /projects/p1/work?chat=g-1");
    expect(from).not.toHaveBeenCalled();
  });
  it("shows someone who is not on the project where the conversation is, and nothing of it", async () => {
    chat = { state: "not_member" };
    render(<>{await open()}</>);
    expect(screen.getByTestId("project-chat-not-member").textContent).toMatch(/open to the people on this project/);
    expect(screen.queryByTestId("old-discussion")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
  it("someone who can open the project but is not on its team (a founder) is told so without the database being asked to refuse them", async () => {
    isMember = false; grants = [{ companyId: "c1", capabilities: ["founder"] }];
    chat = { state: "ready", groupId: "g-1" };                                        // even if a group exists, a person who is not on the team is not sent to it
    render(<>{await open()}</>);
    expect(asked).toEqual([false]);
    expect(screen.getByTestId("project-chat-not-member").textContent).toMatch(/you are not on its team, so its chat is not shown to you/);
    expect(redirect).not.toHaveBeenCalled();
  });
  it("an Operations Manager of the project's company, and a member, are checked with the database, which decides", async () => {
    isMember = false; grants = [{ companyId: "c1", capabilities: ["operations"] }];
    await expect(open()).rejects.toThrow("REDIRECT /projects/p1/work?chat=g-1");
    isMember = true; grants = [];
    await expect(open()).rejects.toThrow("REDIRECT /projects/p1/work?chat=g-1");
    expect(asked).toEqual([true, true]);
    // an Operations Manager of another company is not asked
    asked.length = 0; isMember = false; grants = [{ companyId: "c2", capabilities: ["operations"] }];
    render(<>{await open()}</>);
    expect(asked).toEqual([false]);
  });
  it("says the chat could not be checked when the check fails (never an empty conversation)", async () => {
    chat = { state: "error" };
    render(<>{await open()}</>);
    expect(screen.getByRole("alert").textContent).toMatch(/Could not load the project chat/i);
  });
  it("a person with the summary only is sent back to the project", async () => {
    level = "summary";
    await expect(open()).rejects.toThrow("REDIRECT /projects/p1");
  });
});
