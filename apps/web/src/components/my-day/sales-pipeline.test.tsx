/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SalesPipeline } from "./sales-pipeline";

const data = (over: Record<string, unknown> = {}) => ({
  status: "ok" as const,
  data: { pipeline: [{ stage: "new", label: "New", count: 2 }], overdue: 1, dueToday: 3, noFirstResponse: 0, opportunityCount: 2, attention: [], ...over },
});

describe("My Day sales card follow-up links", () => {
  it("'N due today' links to the Follow-ups Today view, 'overdue' to the whole list", () => {
    const html = renderToStaticMarkup(<SalesPipeline result={data() as never} />);
    expect(html).toMatch(/href="\/sales\/follow-ups\?view=today"[^>]*>(<[^>]+>)*3 due today/);
    expect(html).toMatch(/href="\/sales\/follow-ups"[^>]*>.*?1 follow-up overdue/);
  });
});
