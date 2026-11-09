import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const jarvis = { send: vi.fn(), review: vi.fn(), confirm: vi.fn(), status: vi.fn(), context: vi.fn(), act: vi.fn(), confirmAction: vi.fn() };
vi.mock("@/lib/jarvis/runtime", () => ({ getJarvis: () => jarvis }));

import { jarvisAct, jarvisConfirm, jarvisConfirmAction, jarvisContext, jarvisReview, jarvisSend, jarvisStatus } from "./jarvis";

const CO = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { for (const f of Object.values(jarvis)) f.mockReset(); });

describe("JARVIS server actions (the only endpoints the panel calls)", () => {
  it("reject malformed input before reaching the assistant (company id, size, token, duplicate ids)", async () => {
    expect(await jarvisSend({ companyId: "nope", text: "hi" })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await jarvisSend({ companyId: CO, text: "x".repeat(60_001) })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await jarvisReview({ companyId: CO, fields: "no" as never })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await jarvisConfirm({ companyId: CO, token: "t".repeat(2001), values: {} })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await jarvisConfirm({ companyId: CO, token: "t", values: {}, duplicateIds: ["x"] })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await jarvisContext({ companyId: "x", enquiryId: null })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(Object.values(jarvis).every((f) => f.mock.calls.length === 0)).toBe(true);
  });
  it("pass only validated fields through: no user id, no flag and nothing else the browser adds", async () => {
    jarvis.confirm.mockResolvedValue({ ok: true });
    await jarvisConfirm({ companyId: CO, token: "tok", values: { a: 1 }, duplicateIds: [], userId: "attacker", admin: true } as never);
    expect(jarvis.confirm).toHaveBeenCalledWith({ companyId: CO, token: "tok", values: { a: 1 }, duplicateIds: [] });
    jarvis.send.mockResolvedValue({ ok: true });
    await jarvisSend({ companyId: CO, text: "brief", userId: "attacker" } as never);
    expect(jarvis.send).toHaveBeenCalledWith({ companyId: CO, text: "brief" });
  });
  it("turn an unexpected failure into a plain refusal that leaks nothing, and an unknown save answer into 'ambiguous' (never 'failed')", async () => {
    jarvis.send.mockRejectedValue(new Error("secret internal detail ANTHROPIC_API_KEY=abc"));
    const s = await jarvisSend({ companyId: CO, text: "brief" });
    expect(s).toMatchObject({ ok: false, code: "unavailable" });
    expect(JSON.stringify(s)).not.toMatch(/secret|ANTHROPIC/);
    jarvis.confirm.mockRejectedValue(new Error("boom"));
    expect(await jarvisConfirm({ companyId: CO, token: "tok", values: {} })).toMatchObject({ ok: false, code: "ambiguous" });
    jarvis.status.mockRejectedValue(new Error("boom"));
    expect(await jarvisStatus(CO)).toMatchObject({ ok: false, code: "unavailable" });
  });
  it("the generic action endpoints validate their input and pass on only what they validated", async () => {
    expect(await jarvisAct({ companyId: "nope", actionId: "jarvis.sales.draft_reply", input: {} })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await jarvisConfirmAction({ companyId: CO, actionId: "a", token: "t".repeat(2001), values: {} })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await jarvisConfirmAction({ companyId: CO, actionId: "a", token: "t", values: {}, acknowledgements: "no" as never })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(jarvis.act.mock.calls.length + jarvis.confirmAction.mock.calls.length).toBe(0);
    jarvis.confirmAction.mockResolvedValue({ ok: true });
    await jarvisConfirmAction({ companyId: CO, actionId: "jarvis.sales.x.y", token: "tok", values: { a: 1 }, acknowledgements: { ids: [] }, userId: "attacker" } as never);
    expect(jarvis.confirmAction).toHaveBeenCalledWith({ companyId: CO, actionId: "jarvis.sales.x.y", token: "tok", values: { a: 1 }, acknowledgements: { ids: [] } });
    jarvis.send.mockResolvedValue({ ok: true });
    await jarvisSend({ companyId: CO, text: "x", intent: "reply", enquiryId: "11111111-1111-4111-8111-111111111112", userId: "attacker" } as never);
    expect(jarvis.send).toHaveBeenLastCalledWith({ companyId: CO, text: "x", intent: "reply", enquiryId: "11111111-1111-4111-8111-111111111112" });
    jarvis.confirmAction.mockRejectedValue(new Error("boom"));
    expect(await jarvisConfirmAction({ companyId: CO, actionId: "a", token: "tok", values: {} })).toMatchObject({ ok: false, code: "ambiguous" });
    jarvis.act.mockRejectedValue(new Error("boom"));
    expect(await jarvisAct({ companyId: CO, actionId: "a", input: {} })).toMatchObject({ ok: false, code: "unavailable" });
  });
});
