-- WRITES (one storage policy; no row is touched). OWNER-RUN ROLLBACK of 20261216000800_letters_storage_issued_only.sql.
--
-- WHEN TO USE IT: only if the change causes a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back lets an employee fetch the stored file of their own letter while it is still pending approval (or after rejection or void) again.
--
-- It is safe to run twice. Afterwards the matching *_20_verify_readonly.sql reports the new rules as missing (that is how it tells you the old state is back), or run the
-- *_05_preservation_check_readonly.sql against your BEFORE snapshot (the changed items then say UNCHANGED / MISSING).
-- The previous policy is the one in 20260929000000_phase6_letters_payroll_audit_ai_drafts.sql.

begin;

drop policy if exists letters_select on storage.objects;
create policy letters_select on storage.objects for select
  using (
    bucket_id = 'letters'
    and (
      (storage.foldername(name))[2]::uuid = current_employee_id()
      or has_role('hr_admin', (storage.foldername(name))[1]::uuid)
    )
  );

commit;
