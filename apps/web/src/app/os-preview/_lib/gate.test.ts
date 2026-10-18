import { describe, expect, it } from "vitest";
import { isOsPreviewEnabled } from "./gate";

describe("isOsPreviewEnabled", () => {
  it("is hidden on Vercel production, even if opted in", () => {
    expect(isOsPreviewEnabled({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
    expect(isOsPreviewEnabled({ VERCEL_ENV: "production", NODE_ENV: "production", OS_PREVIEW_ENABLED: "1" })).toBe(false);
  });
  it("is shown on Vercel preview deployments", () => {
    expect(isOsPreviewEnabled({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(true);
  });
  it("is shown in local development and tests", () => {
    expect(isOsPreviewEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isOsPreviewEnabled({ NODE_ENV: "test" })).toBe(true);
  });
  it("fails closed for an unknown production environment unless opted in", () => {
    expect(isOsPreviewEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isOsPreviewEnabled({})).toBe(false);
    expect(isOsPreviewEnabled({ NODE_ENV: "production", OS_PREVIEW_ENABLED: "1" })).toBe(true);
  });
});
