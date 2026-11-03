/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildWorkToday } from "@/lib/my-day/work-today";
import { MyWorkToday } from "./my-work-today";

const t = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Task ${id}`, status: "in_progress", due_date: null, blocked_at: null, blocked_reason: null, unblock_owner_id: null, unblock_action: null, projectReference: "P-1", projectName: "Expo", ...over,
});
const work = (tasks: ReturnType<typeof t>[]) => buildWorkToday(tasks as never, "2026-11-02", () => "Omar Ali", (d) => d);

describe("MyWorkToday", () => {
  it("shows the task titles with the project, due today apart from later, and each links to the task panel", () => {
    const html = renderToStaticMarkup(<MyWorkToday work={work([t("a", { due_date: "2026-11-02" }), t("b", { due_date: "2026-11-09" })])} />);
    expect(html).toContain("Task a");
    expect(html).toContain("Task b");
    expect(html).toContain("P-1 · Expo");
    expect(html.indexOf("Due today")).toBeGreaterThan(-1);
    expect(html.indexOf("Task a")).toBeLessThan(html.indexOf("Task b"));
    expect(html).toContain('href="/projects/work?task=a"');
    expect(html).toContain("All my work (2)");
  });
  it("says what blocks a task and who can unblock it", () => {
    const html = renderToStaticMarkup(<MyWorkToday work={work([t("a", { blocked_at: "x", blocked_reason: "Waiting for the stage plan", unblock_owner_id: "u2" })])} />);
    expect(html).toContain("Blocked: Waiting for the stage plan");
    expect(html).toContain("Omar Ali can unblock it");
    expect(html).toContain("1 blocked");
  });
  it("a failed read is one error line, never the empty message", () => {
    const html = renderToStaticMarkup(<MyWorkToday work="error" />);
    expect(html).toContain("Your tasks could not be loaded");
    expect(html).not.toContain("No open tasks");
  });
  it("genuinely no tasks: says so", () => {
    expect(renderToStaticMarkup(<MyWorkToday work={work([])} />)).toContain("No open tasks assigned to you or shared with you.");
  });
});
