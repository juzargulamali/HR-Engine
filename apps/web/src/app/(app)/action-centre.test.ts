import { describe, expect, it } from "vitest";
import { attentionSentence, buildActionItems } from "./action-centre";

describe("My Day action centre when the approvals count could not be loaded", () => {
  it("keeps an error row instead of dropping the zero, and never says nothing needs attention", () => {
    const items = buildActionItems({ myPendingApprovals: "error" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "approvals", error: true, label: "Approvals could not be loaded" });
    const sentence = attentionSentence(items);
    expect(sentence).not.toMatch(/Nothing needs your attention/);
    expect(sentence).toMatch(/could not be loaded/);
  });
  it("still counts the items that did load next to the failed one", () => {
    const items = buildActionItems({ myPendingApprovals: "error", contractsEndingCount: 2 });
    expect(attentionSentence(items)).toMatch(/2 items need your attention/);
    expect(attentionSentence(items)).toMatch(/Approvals could not be loaded/);
  });
  it("a real zero is still dropped, and a healthy list is unchanged", () => {
    expect(buildActionItems({ myPendingApprovals: 0 })).toEqual([]);
    expect(attentionSentence([])).toBe("Nothing needs your attention right now.");
    expect(attentionSentence(buildActionItems({ myPendingApprovals: 3 }))).toBe("Your updates for today: 3 items need your attention.");
  });
});
