import { describe, expect, it } from "vitest";
import { displayMayReach, isDisplayUser } from "./gate";

describe("display identity gate", () => {
  it("is a display only with app_metadata.ops_tv exactly true", () => {
    expect(isDisplayUser({ app_metadata: { ops_tv: true } })).toBe(true);
    for (const u of [null, undefined, {}, { app_metadata: {} }, { app_metadata: { ops_tv: "true" } }, { app_metadata: { ops_tv: 1 } }]) expect(isDisplayUser(u as never)).toBe(false);
  });
  it("reaches the board, its refresh and sign-in only", () => {
    for (const p of ["/tv", "/tv/", "/api/tv/board", "/login"]) expect(displayMayReach(p)).toBe(true);
    for (const p of ["/", "/projects", "/operations", "/operations/tv", "/api/chat", "/api/tv-evil", "/tvx", "/inventory/scan", "/people-access", "/api/cron/crm-reminders"]) expect(displayMayReach(p)).toBe(false);
  });
});
