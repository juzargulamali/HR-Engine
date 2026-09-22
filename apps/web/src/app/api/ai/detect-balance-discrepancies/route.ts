import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/cron/auth";

/**
 * The one real, end-to-end AI-assisted flow docs/06-implementation-phases.md
 * (Phase 6) asks for: a service identity — never a human session — that
 * reviews leave_balances for a specific, explainable discrepancy (a
 * negative balance, which always means an approval bug or a data-import
 * error, never a legitimate state) and drafts a corrective adjustment. It
 * is deliberately a plain deterministic rule, not a call out to a
 * generative model — docs/05-automation-rules.md §5.4 only asks for the
 * draft-only BOUNDARY to be real and enforced, not for the detection
 * itself to be an LLM.
 *
 * The only thing that actually invokes this on a schedule is Vercel Cron
 * (vercel.json), which sends `Authorization: Bearer $CRON_SECRET` — same
 * as every other /api/cron/* route — so this checks that secret too, via
 * the shared helper, rather than the separate AI_SERVICE_SECRET this
 * previously checked (which nothing in the deployed config ever actually
 * sent, so the scheduled run 401'd on every firing).
 *
 * This endpoint's code has no path to leave_ledger, comp_day_ledger,
 * approvals, or any other operational table — the one thing it ever writes
 * is a row in ai_drafts (docs/04-user-journeys.md §4.11). Turning a draft
 * into a real ledger entry always goes through postLeaveLedgerAdjustment()
 * (lib/actions/ledgerAdjustments.ts), the same Server Action a human types
 * a correction into, called under HR Admin's own identity when they
 * authorize it — never from here.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: negativeBalances, error } = await admin
    .from("leave_balances")
    .select("employee_id, leave_type_code, balance_days")
    .lt("balance_days", 0);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let draftsCreated = 0;
  let skippedExisting = 0;
  const failures: string[] = [];

  for (const row of negativeBalances ?? []) {
    const correctionAmount = -Number(row.balance_days); // brings the balance back to exactly zero, never above

    const { data: existing } = await admin
      .from("ai_drafts")
      .select("id")
      .eq("entity_type", "leave_ledger")
      .eq("proposed_action", "adjust_balance")
      .eq("status", "draft")
      .contains("proposed_payload", { employee_id: row.employee_id, leave_type_code: row.leave_type_code })
      .maybeSingle();
    if (existing) {
      skippedExisting += 1;
      continue;
    }

    const { error: insertError } = await admin.from("ai_drafts").insert({
      entity_type: "leave_ledger",
      proposed_action: "adjust_balance",
      proposed_payload: {
        employee_id: row.employee_id,
        leave_type_code: row.leave_type_code,
        amount_days: correctionAmount,
        note: "Auto-detected negative balance correction",
      },
      rationale: `${row.leave_type_code} balance for this employee is ${row.balance_days} days (negative), which should never happen from normal accrual/deduction — likely an approval-routing bug or a data-import error. Proposed adjustment of +${correctionAmount} brings it back to exactly zero; review the ledger history before authorizing.`,
      created_by_agent: "balance-discrepancy-detector",
    });
    if (insertError) failures.push(`${row.employee_id}/${row.leave_type_code}: ${insertError.message}`);
    else draftsCreated += 1;
  }

  return NextResponse.json({ discrepanciesFound: (negativeBalances ?? []).length, draftsCreated, skippedExisting, failures });
}
