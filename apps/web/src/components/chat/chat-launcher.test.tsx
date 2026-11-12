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
    // a finished project's group sits under the collapsed Archived section
    fireEvent.click(screen.getByTestId("chat-archived-toggle"));
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

  describe("archived projects", () => {
    const archived = (over: Partial<ChatGroup> = {}): ChatGroup => project({ id: "pg9", key: "project:p9", name: "UAE-P-9 · Fictional Omega stand", projectId: "p9", readOnly: true, projectStatus: "archived", ...over });
    const sectionNames = () => screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));

    it("lists Sales, Projects, then a collapsed \"Archived (N)\"; opening it lists the groups", () => {
      render(<ChatLauncher userId="u" initialGroups={[g({}), project({ projectStatus: "active" }), project({ id: "pg2", key: "project:p2", name: "UAE-P-2 · Fictional Beta", projectId: "p2", readOnly: true, projectStatus: "completed" }), archived()]} />);
      fireEvent.click(screen.getByTestId("chat-launcher"));
      expect(sectionNames()).toEqual(["Sales groups", "Projects groups", "Archived groups"]);
      // a completed project's group is finished too: it is not under Projects any more
      expect(screen.getByRole("region", { name: "Projects groups" }).textContent).not.toContain("UAE-P-2 · Fictional Beta");
      const toggle = screen.getByTestId("chat-archived-toggle");
      expect(toggle.textContent).toBe("Archived (2)");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByTestId("chat-group-project:p9")).toBeNull();
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByTestId("chat-group-project:p9").textContent).toContain("UAE-P-9 · Fictional Omega stand");
      expect(screen.getByTestId("chat-group-project:p2").textContent).toContain("UAE-P-2 · Fictional Beta");
    });
    it("opens a completed project's group from a direct link, read-only, and returns it to Projects when the project is reopened", async () => {
      const done = (over: Partial<ChatGroup> = {}) => project({ id: "pg2", key: "project:p2", name: "UAE-P-2 · Fictional Beta", projectId: "p2", readOnly: true, projectStatus: "completed", ...over });
      address = "chat=pg2";
      render(<ChatLauncher userId="u" initialGroups={[g({}), done()]} />);
      await waitFor(() => expect(screen.getByTestId("chat-thread-title").textContent).toBe("UAE-P-2 · Fictional Beta"));
      expect(screen.getByTestId("chat-read-only")).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
      cleanup();
      address = "";
      vi.mocked(chatGroups).mockResolvedValue({ ok: true, groups: [g({}), done({ projectStatus: "active", readOnly: false })] });
      render(<ChatLauncher userId="u" initialGroups={[g({}), done()]} />);
      fireEvent.click(screen.getByTestId("chat-launcher"));
      await waitFor(() => expect(screen.queryByTestId("chat-archived-toggle")).toBeNull());
      expect(screen.getByRole("region", { name: "Projects groups" }).textContent).toContain("UAE-P-2 · Fictional Beta");
    });
    it("keeps an archived group's unread and mentions: in the button total, and on the heading while collapsed", () => {
      render(<ChatLauncher userId="u" initialGroups={[g({ unread: 1 }), archived({ unread: 3, mentions: 1 })]} />);
      expect(screen.getByTestId("chat-total-unread").textContent).toBe("4");
      expect(screen.getByRole("button", { name: /Open chat, 4 unread, 1 mention of you/ })).toBeTruthy();
      fireEvent.click(screen.getByTestId("chat-launcher"));
      expect(screen.getByTestId("chat-archived-unread").textContent).toBe("3");
      expect(screen.getByTestId("chat-archived-mention")).toBeTruthy();
      fireEvent.click(screen.getByTestId("chat-archived-toggle"));
      // open: the counts are on the group's own row, not twice
      expect(screen.queryByTestId("chat-archived-unread")).toBeNull();
      expect(screen.getByTestId("chat-group-project:p9").textContent).toContain("3");
      expect(screen.getAllByTestId("chat-group-mention")).toHaveLength(1);
    });
    it("opens an archived group from a direct link, read-only", async () => {
      address = "chat=pg9";
      render(<ChatLauncher userId="u" initialGroups={[g({}), archived()]} />);
      await waitFor(() => expect(screen.getByTestId("chat-thread-title").textContent).toBe("UAE-P-9 · Fictional Omega stand"));
      expect(screen.getByTestId("chat-read-only")).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
    });
    it("a restored project's group returns to Projects on the next refresh", async () => {
      vi.mocked(chatGroups).mockResolvedValue({ ok: true, groups: [g({}), archived({ projectStatus: "active", readOnly: false })] });
      render(<ChatLauncher userId="u" initialGroups={[g({}), archived()]} />);
      fireEvent.click(screen.getByTestId("chat-launcher"));
      await waitFor(() => expect(screen.queryByTestId("chat-archived-toggle")).toBeNull());
      expect(sectionNames()).toEqual(["Sales groups", "Projects groups"]);
      expect(screen.getByRole("region", { name: "Projects groups" }).textContent).toContain("UAE-P-9 · Fictional Omega stand");
      expect(screen.queryByTestId("chat-notice")).toBeNull();
    });
    it("leaves Sales groups as they were when nothing is archived", () => {
      render(<ChatLauncher userId="u" initialGroups={[g({ unread: 2 }), g({ id: "g2", key: "sales_ksa", name: "Sales — KSA" })]} />);
      fireEvent.click(screen.getByTestId("chat-launcher"));
      expect(sectionNames()).toEqual(["Sales groups"]);
      expect(screen.queryByTestId("chat-archived-toggle")).toBeNull();
      expect(screen.getByTestId("chat-group-sales_uae").textContent).toContain("2");
    });
    it("search finds an archived group without opening the section first", () => {
      const many = Array.from({ length: 9 }, (_, i) => project({ id: `pg${i}`, key: `project:p${i}`, name: `UAE-P-${i} · Fictional job ${i}`, projectId: `p${i}` }));
      render(<ChatLauncher userId="u" initialGroups={[...many, archived()]} />);
      fireEvent.click(screen.getByTestId("chat-launcher"));
      expect(screen.queryByTestId("chat-group-project:p9")).toBeNull();
      fireEvent.change(screen.getByTestId("chat-group-search"), { target: { value: "omega" } });
      expect(screen.getByTestId("chat-group-project:p9")).toBeTruthy();
    });
  });

  describe("reading as Operations Manager", () => {
    it("tags the group and says so in the thread; a team member's group has neither", async () => {
      const both = [project({ viaOperations: true }), project({ id: "pg2", key: "project:p2", name: "UAE-P-2 · Fictional Beta", projectId: "p2" })];
      vi.mocked(chatGroups).mockResolvedValue({ ok: true, groups: both });
      render(<ChatLauncher userId="u" initialGroups={both} />);
      fireEvent.click(screen.getByTestId("chat-launcher"));
      expect(screen.getAllByTestId("chat-group-operations")).toHaveLength(1);
      expect(screen.getByTestId("chat-group-project:p1").textContent).toContain("Operations");
      fireEvent.click(screen.getByTestId("chat-group-project:p1"));
      await waitFor(() => expect(screen.getByTestId("chat-operations-note").textContent).toBe("You are reading this as Operations Manager. You are not on this project's team."));
      fireEvent.click(screen.getByRole("button", { name: "Back to groups" }));
      fireEvent.click(screen.getByTestId("chat-group-project:p2"));
      await waitFor(() => expect(screen.getByTestId("chat-thread-title").textContent).toBe("UAE-P-2 · Fictional Beta"));
      expect(screen.queryByTestId("chat-operations-note")).toBeNull();
    });
  });
});
