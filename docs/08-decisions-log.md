# 8. Decisions Log

Six judgment calls were flagged in the design review (§ Decisions needed) as reasonable defaults
that were genuinely the business's to confirm. All six were reviewed and decided on 2026-09-22.
Recorded here so the rationale survives past the conversation that produced it — the same
traceability principle applied to every approval and balance change in the product itself.

| # | Question | Decision | Rationale | Design impact |
|---|---|---|---|---|
| 1 | Can employees see their own bank account/IBAN? | **Yes, read-only.** HR Admin/Finance remain the only roles that can write it. | Lets employees self-verify the details on file before payday without any write risk. | Matches the schema/RLS as already designed (`docs/02-database-schema.md` §2.3, `compensation_select` policy) — no change required. |
| 2 | Does the CEO authorize every payroll-variable export, or only above a threshold? | **Every export, unconditionally.** | Enginious wants executive sign-off on every payroll run regardless of size, not just exceptions. | **Changed the design.** `payroll_export_run` is now the one approval workflow with no conditional steps — Finance (step 1) then CEO (step 2) are both mandatory every time. Updated `docs/03-permission-matrix.md` §3.6, `docs/04-user-journeys.md` §4.8–4.9, `docs/05-automation-rules.md` §5.3. |
| 3 | Does Polish/EU employee data need to stay in a separate region from UAE/KSA data? | **No special requirement.** | No client/contract currently demands in-region EU storage; a single Supabase project keeps operations simple for a small team. | Matches the architecture as already designed (`docs/01-architecture.md` §1.4, single project/database). Revisit if a future contract requires EU data residency — see `docs/07-risk-register.md` risk 10. |
| 4 | Is "anonymize personal details, keep payroll/audit numbers" acceptable for GDPR erasure requests? | **Yes.** | Compliant under GDPR's legal-obligation exception for payroll/labor records; avoids destroying the numeric ledger/audit history the rest of the design depends on. | Matches the mitigation already documented for `docs/07-risk-register.md` risk 9 — no change required. Still a manual, jointly-authorized procedure (HR Admin + Sys Admin), never a self-service delete. |
| 5 | Which country pilots first? | **UAE** — confirmed as headquarters, with Saudi Arabia and Poland as smaller satellite offices today. | UAE has the fullest role coverage and headcount, making it the strongest validation of the whole system before extending to the other two countries. | Updated `docs/06-implementation-phases.md` (new "Company context" section, Phase 7 rollout note) to reflect UAE as the primary build target rather than an equal third of initial scope. |
| 6 | Direct-to-main or PR-reviewed workflow once implementation starts? | **Direct to main for now.** | Matches how the design package itself was delivered; fastest iteration while it's a small team. | No design change. Revisit once more than one person is committing code — a PR-based workflow can be adopted at any point without any structural rework. |

## What this means going into Phase 0

- The only structural change from this round is decision 2 (mandatory two-step payroll
  authorization) — already reflected in the documents above.
- Decisions 1, 3, 4, and 6 confirm defaults that required no design change.
- Decision 5 sets delivery sequencing, not architecture: the schema and policy engine remain
  identical for all three countries; UAE simply goes first end-to-end.

Proceed to Phase 0 per [06-implementation-phases.md](./06-implementation-phases.md).
