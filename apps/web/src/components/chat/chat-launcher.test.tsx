// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatGroup } from "@/lib/chat/model";

vi.mock("@/lib/actions/chat", () => ({
  chatGroups: vi.fn(async () => ({ ok: true, groups: [] })), chatMessages: vi.fn(async () => ({ ok: true, messages: [], hasMore: false, lastRead: 0 })),
  chatMembers: vi.fn(async () => ({ ok: true, members: [] })), chatPost: vi.fn(), chatMarkRead: vi.fn(async () => ({ ok: true })), chatSearchItems: vi.fn(async () => ({ ok: true, hits: [] })),
}));
import { ChatLauncher } from "./chat-launcher";

const g = (over: Partial<ChatGroup>): ChatGroup => ({ id: "g1", key: "sales_uae", name: "Sales — UAE", unread: 0, mentions: 0, lastAt: null, lastSender: null, lastPreview: null, ...over });
beforeEach(() => { window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never; });
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
});
