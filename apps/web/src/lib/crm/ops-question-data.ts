import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CrmContext } from "./context";
import { OPS_QUESTION_TYPE, opsQuestionRows, type OpsQuestionCheck } from "./ops-question";

/**
 * The signed-in person's unread "Operations asked a question" notices, with the enquiry each is about. Read through the person's own session: the notifications
 * table shows a person their own rows only, and the enquiry's title is read under the same Sales rules as everywhere else (an enquiry the person can no longer
 * read is listed by its reference alone, from the notice). A failed read is "error", never an empty list. Nothing is written.
 */
export async function loadOpsQuestionNotices(ctx: CrmContext): Promise<OpsQuestionCheck> {
  if (ctx.grants.length === 0) return { status: "none" };
  try {
    const supabase = await createClient();
    const n = await supabase.from("notifications").select("id, payload, created_at").eq("user_id", ctx.userId).eq("type", OPS_QUESTION_TYPE).is("read_at", null).order("created_at", { ascending: true }).limit(200);
    if (n.error) { console.error("[crm] operations question notices read failed", n.error.message); return { status: "error" }; }
    const notices = (n.data ?? []) as { id: string; payload: unknown; created_at: string }[];
    if (notices.length === 0) return { status: "ok", rows: [] };
    const ids = [...new Set(notices.map((x) => (x.payload as { opportunity_id?: unknown } | null)?.opportunity_id).filter((v): v is string => typeof v === "string"))];
    const enquiries = new Map<string, { reference: string; title: string }>();
    if (ids.length > 0) {
      const o = await supabase.from("crm_opportunities").select("id, reference, title").in("id", ids);
      if (o.error) { console.error("[crm] operations question enquiries read failed", o.error.message); return { status: "error" }; }
      for (const r of o.data ?? []) enquiries.set(r.id, { reference: r.reference, title: r.title });
    }
    return { status: "ok", rows: opsQuestionRows(notices, enquiries) };
  } catch (e) {
    console.error("[crm] operations question notices failed", e);
    return { status: "error" };
  }
}
