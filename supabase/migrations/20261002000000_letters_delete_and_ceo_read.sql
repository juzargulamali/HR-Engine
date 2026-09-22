-- Two gaps found while wiring up delete/download for issued letters:
--
-- 1. generated_letters had select/insert/update policies but no DELETE
--    policy at all, so even an HR Admin's own company's letters could
--    never be deleted — RLS denies any operation with no matching policy.
create policy generated_letters_delete on generated_letters for delete
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- 2. The storage.objects policies for the 'letters' bucket only covered
--    select/insert — no delete, and select didn't include CEO even though
--    generated_letters_select does (a CEO deciding a letter's approval
--    needs to read the actual file, not just the row).
create policy letters_select_ceo on storage.objects for select
  using (bucket_id = 'letters' and has_role('ceo', (storage.foldername(name))[1]::uuid));

create policy letters_delete on storage.objects for delete
  using (bucket_id = 'letters' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));
