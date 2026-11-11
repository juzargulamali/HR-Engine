// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { CHAT_OPEN_EVENT, type ChatGroup } from "@/lib/chat/model";

const replace = vi.fn();
let address = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/projects/p1/work", useSearchParams: () => new URLSearchParams(address) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));

vi.mock("@/lib/actions/chat", () => ({
  chatGroups: vi.fn(async () => ({ ok: true, groups: [] })), chatMessages: vi.fn(async () => ({ ok: true, messages: [], hasMore: false, lastRead: 0 })),
  chatMembers: vi.fn(async () => ({ ok: true, members: [] })), chatPost: vi.fn(), chatMarkRead: vi.fn(async () => ({ ok: true })), chatSearchItems: vi.fn(async () => ({ ok: true, hits: [] })),
}));
import { chatGroups } from "@/lib/actions/chat";
import { ChatLauncher } from "./chat-launcher";

const g = (over: Partial<ChatGroup>): ChatGroup => ({ id: "g1", key: "sales_uae", name: "Sales — UAE", unread: 0, mentions: 0, lastAt: null, lastSender: null, lastPreview: null, ...over });
const project = (over: Partial<ChatGroup> = {}): ChatGroup => g({ id: "pg1", key: "project:p1", name: "UAE-P-1 · Fictional Alpha stand", kind: "project", projectId: "p1", ...over });
beforeEach(() => { address = ""; replace.mockClear(); vi.mocked(chatGroups).mockResolvedValue({ ok: true, groups: [] }); Element.prototype.scrollIntoView = vi.fn(); window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never; });
afterEach(cleanup);

describe("the floating Chat button", () => {
  it("is not drawn without an eligible group", () => {
    const { container } = render(<ChatLauncher userId="u" initialGroups={[]} />);
    expect(container.innerHTML).toBe("");
  });
  it("shows the total unread on the button and each group's count in the panel", () => {
    render(<ChatLauncher userId="u" initialGroups={[g({ unread: 2 }), g({ id: "g2", key: "sales_ksa", name: "Sales — KSA", unread: 3, mentions: 1 }), g({ id: "g3", key: "sales_europe", name: "Sales — Europe" })]} />);
    expect(screen.getByTestId("chat-total-unread").textContent).toBe("5");
    expect(screen.getByRole("button", { name: /Open chat, 5 unread, 1 mention of you/ })).toBeTruthy();
    fireEvent.click(screen.getByTestId("chat-launcher"));
    expect(screen.getByTestId("chat-group-sales_uae").textContent).toContain("2");
    expect(screen.getByTestId("chat-group-sales_ksa").textContent).toContain("3");
    expect(screen.getByTestId("chat-group-sales_europe").textContent).not.toMatch(/\d/);
    expect(screen.getAllByTestId("chat-group-mention")).toHaveLength(1);
  });

  it("lists Sales groups and project groups in their own sections; a project-only member sees just Projects", () => {
    const { unmount } = render(<ChatLauncher userId="u" initialGroups={[g({}), project({ unread: 4 })]} />);
    fireEvent.click(screen.getByTestId("chat-launcher"));
    expect(screen.getByRole("region", { name: "Sales groups" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Projects groups" }).textContent).toContain("UAE-P-1 · Fictional Alpha stand");
    expect(screen.getByTestId("chat-total-unread").textContent).toBe("4");
    unmount();
    render(<ChatLauncher userId="u" initialGroups={[project()]} />);
    fireEvent.click(screen.getByTestId("chat-launcher"));
    expect(screen.queryByRole("region", { name: "Sales groups" })).toBeNull();
    expect(screen.getByTestId("chat-group-project:p1")).toBeTruthy();
  });
  it("opens the group named in the address (an old Discussion link) and takes the parameter out", async () => {
    address = "chat=pg1&view=board";
    render(<ChatLauncher userId="u" initialGroups={[g({}), project()]} />);
    await waitFor(() => expect(screen.getByTestId("chat-thread-title").textContent).toBe("UAE-P-1 · Fictional Alpha stand"));
    expect(replace).toHaveBeenCalledWith("/projects/p1/work?view=board", { scroll: false });
    expect(screen.getByTestId("chat-open-project").getAttribute("href")).toBe("/projects/p1/work");
  });
  it("opens a group when a project page asks for it, from any page", async () => {
    render(<ChatLauncher userId="u" initialGroups={[project()]} />);
    act(() => { window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail: { groupId: "pg1" } })); });
    await waitFor(() => expect(screen.getByTestId("chat-thread-title")).toBeTruthy());
  });
  it("never opens a group the server does not list for this person: it says the conversation is not available", async () => {
    address = "chat=someone-elses-group";
    vi.mocked(chatGroups).mockResolvedValue({ ok: true, groups: [g({})] });
    render(<ChatLauncher userId="u" initialGroups={[g({})]} />);
    await waitFor(() => expect(screen.getByTestId("chat-notice").textContent).toMatch(/not available to you/));
    expect(screen.queryByTestId("chat-thread-title")).toBeNull();
  });
  it("a group that stops being listed (removed from the project) closes its thread and leaves the unread total", async () => {
    const both = [g({}), project({ unread: 3 })];
    vi.mocked(chatGroups).mockResolvedValue({ ok: true, groups: both });
    render(<ChatLauncher userId="u" initialGroups={both} />);
    fireEvent.click(screen.getByTestId("chat-launcher"));
    fireEvent.click(screen.getByTestId("chat-group-project:p1"));
    await waitFor(() => expect(screen.getByTestId("chat-thread-title")).toBeTruthy());
    vi.mocked(chatGroups).mockResolvedValue({ ok: true, groups: [g({})] });
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByTestId("chat-thread-title")).toBeNull());
    expect(screen.getByTestId("chat-notice").textContent).toContain("UAE-P-1 · Fictional Alpha stand");
    expect(screen.queryByTestId("chat-total-unread")).toBeNull();
    expect(screen.queryByTestId("chat-group-project:p1")).toBeNull();
  });
  it("a finished project's group shows no composer, only a read-only note", async () => {
    render(<ChatLauncher userId="u" initialGroups={[project({ readOnly: true })]} />);
    fireEvent.click(screen.getByTestId("chat-launcher"));
    fireEvent.click(screen.getByTestId("chat-group-project:p1"));
    await waitFor(() => expect(screen.getByTestId("chat-read-only")).toBeTruthy());
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("offers a search box once there are many groups", () => {
    const many = Array.from({ length: 9 }, (_, i) => project({ id: `pg${i}`, key: `project:p${i}`, name: `UAE-P-${i} · Fictional job ${i}`, projectId: `p${i}` }));
    render(<ChatLauncher userId="u" initialGroups={many} />);
    fireEvent.click(screen.getByTestId("chat-launcher"));
    fireEvent.change(screen.getByTestId("chat-group-search"), { target: { value: "job 7" } });
    expect(screen.getAllByTestId(/^chat-group-project:/)).toHaveLength(1);
  });
});
