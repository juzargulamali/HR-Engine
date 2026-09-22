-- =============================================================================
-- Neither leave_ledger nor comp_day_ledger had a uniqueness constraint
-- backing the "have I already processed this?" checks in the leave-accrual
-- and comp-day-expiry crons — both checks were pure application-level reads
-- before the insert, so two overlapping invocations (a Vercel Cron retry
-- racing the original request, or a manual re-trigger while a run is still
-- in flight) could both pass the check before either had written anything,
-- and both post: double accrual, or double expiry of the same earned
-- comp-day entry.
--
-- Fix: a nullable, plain (non-partial) unique `idempotency_key` column on
-- each table, populated only by these two crons, so the database itself
-- rejects the second of two racing inserts — the crons upsert with
-- ignoreDuplicates instead of a plain insert, so a rejected duplicate is
-- silently dropped rather than failing the whole batch.
-- =============================================================================

alter table leave_ledger add column idempotency_key text unique;
alter table comp_day_ledger add column idempotency_key text unique;
