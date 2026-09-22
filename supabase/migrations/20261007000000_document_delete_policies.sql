-- identity_documents had select/insert/update policies but no delete at
-- all — HR Admin could add or correct a document but never remove one
-- (e.g. uploaded to the wrong employee, or a duplicate), and the row would
-- outlive its own storage object forever with no way to clean either up.
-- Scoped identically to the existing insert/update policies.
create policy identity_docs_delete on identity_documents for delete
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- employee_documents already carries deleted_at (soft-delete, same pattern
-- as employees) and its existing _table_update policy already lets HR
-- Admin set arbitrary columns including deleted_at — so no new policy is
-- needed there, just the application code to use it (see
-- lib/actions/employees.ts).
