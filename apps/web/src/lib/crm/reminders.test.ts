import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sendMailAsUser = vi.fn();
vi.mock("@/lib/email/graph", () => ({ sendMailAsUser: (...a: unknown[]) => sendMailAsUser(...a) }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { generateRemindersThrottled, reminderEmailsEnabled, runCrmReminders } from "./reminders";

const claim = (id: string, over: Record<string, unknown> = {}) => ({
  reminder_id: id, recipient_email: "amira@enginious.ae", recipient_name: "Amira <b>", title: "Chase <script>", kind: "follow_up_due",
  opportunity_reference: "OPP-UAE-2026-0001", opportunity_title: "Floor projection", due_at: null, attempt: 1, ...over,
});

describe("CRM reminder runner", () => {
  const env = { ...process.env };
  beforeEach(() => {
    rpc.mockReset();
    sendMailAsUser.mockReset();
    delete process.env.CRM_REMINDER_EMAILS;
    delete process.env.CRM_REMINDER_FROM_EMAIL;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("keeps owner emails off unless BOTH the switch and the sender are set", () => {
    expect(reminderEmailsEnabled().enabled).toBe(false);
    process.env.CRM_REMINDER_EMAILS = "on";
    expect(reminderEmailsEnabled().enabled).toBe(false); // no sender mailbox
    process.env.CRM_REMINDER_FROM_EMAIL = "sales@enginious.ae";
    expect(reminderEmailsEnabled()).toEqual({ enabled: true, from: "sales@enginious.ae" });
    process.env.CRM_REMINDER_EMAILS = "true";
    expect(reminderEmailsEnabled().enabled).toBe(false); // only the exact word "on"
  });

  it("creates in-app reminders and never claims or sends email while emails are off", async () => {
    rpc.mockResolvedValueOnce({ data: 3, error: null });
    const r = await runCrmReminders(new Date("2026-10-19T04:00:00Z"));
    expect(r).toMatchObject({ generated: 3, emailsEnabled: false, emailsAttempted: 0, emailsSent: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("crm_generate_reminders", { p_now: "2026-10-19T04:00:00.000Z" });
    expect(sendMailAsUser).not.toHaveBeenCalled();
  });

  it("surfaces a failed generation instead of hiding it", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(runCrmReminders()).rejects.toThrow(/boom/);
  });

  it("sends each claimed email once to the owner, escapes the content and records success", async () => {
    process.env.CRM_REMINDER_EMAILS = "on";
    process.env.CRM_REMINDER_FROM_EMAIL = "sales@enginious.ae";
    rpc.mockResolvedValueOnce({ data: 1, error: null }).mockResolvedValueOnce({ data: [claim("r1")], error: null }).mockResolvedValue({ data: null, error: null });
    sendMailAsUser.mockResolvedValue(undefined);
    const r = await runCrmReminders();
    expect(r).toMatchObject({ emailsEnabled: true, emailsAttempted: 1, emailsSent: 1, emailsFailed: 0 });
    expect(sendMailAsUser).toHaveBeenCalledTimes(1);
    const mail = sendMailAsUser.mock.calls[0]![0] as { to: string[]; html: string; subject: string; fromEmail: string };
    expect(mail.to).toEqual(["amira@enginious.ae"]);
    expect(mail.fromEmail).toBe("sales@enginious.ae");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("not sent to clients");
    expect(rpc).toHaveBeenCalledWith("crm_finish_reminder_email", { p_reminder_id: "r1", p_ok: true });
  });

  it("records a failed send for retry and carries on with the rest", async () => {
    process.env.CRM_REMINDER_EMAILS = "on";
    process.env.CRM_REMINDER_FROM_EMAIL = "sales@enginious.ae";
    rpc.mockResolvedValueOnce({ data: 2, error: null }).mockResolvedValueOnce({ data: [claim("r1"), claim("r2")], error: null }).mockResolvedValue({ data: null, error: null });
    sendMailAsUser.mockRejectedValueOnce(new Error("mailbox not found")).mockResolvedValueOnce(undefined);
    const r = await runCrmReminders();
    expect(r).toMatchObject({ emailsAttempted: 2, emailsSent: 1, emailsFailed: 1 });
    expect(rpc).toHaveBeenCalledWith("crm_finish_reminder_email", { p_reminder_id: "r1", p_ok: false, p_error: "mailbox not found" });
    expect(rpc).toHaveBeenCalledWith("crm_finish_reminder_email", { p_reminder_id: "r2", p_ok: true });
  });

  it("only ever addresses the reminder's own recipient (never a client address)", async () => {
    process.env.CRM_REMINDER_EMAILS = "on";
    process.env.CRM_REMINDER_FROM_EMAIL = "sales@enginious.ae";
    rpc.mockResolvedValueOnce({ data: 0, error: null }).mockResolvedValueOnce({ data: [claim("r1")], error: null }).mockResolvedValue({ data: null, error: null });
    await runCrmReminders();
    for (const call of sendMailAsUser.mock.calls) expect((call[0] as { to: string[] }).to).toEqual(["amira@enginious.ae"]);
  });

  it("throttles on-demand generation and never throws", async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 0, error: null });
    await generateRemindersThrottled(60_000_000);
    await generateRemindersThrottled(60_000_000);
    expect(rpc.mock.calls.length).toBeLessThanOrEqual(1);
    rpc.mockRejectedValue(new Error("down"));
    await expect(generateRemindersThrottled(0)).resolves.toBeUndefined();
  });
});
