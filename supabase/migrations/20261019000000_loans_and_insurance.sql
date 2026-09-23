-- Outstanding loans / cash advances an employee has taken from the company —
-- same visibility tier as compensation_details (self, HR Admin, Finance;
-- deliberately no manager/CEO/CTO read access), since it's the kind of
-- financial record an end-of-service settlement needs to net against final
-- pay. Add/delete only (no update, no UI for it, and none requested) — HR
-- or Finance corrects a mistaken entry by deleting and re-adding it, same
-- as identity_documents' own add/delete-only lifecycle in the UI.
create table employee_loans (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  loan_type     text not null check (loan_type in ('loan', 'cash_advance')),
  amount        numeric(12,2) not null check (amount > 0),
  currency      text not null,
  issued_date   date not null,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid not null
);

create index idx_employee_loans_employee on employee_loans(employee_id);

alter table employee_loans enable row level security;

-- ---- employee_loans: same visibility tier as compensation_details (HR
--      Admin + Finance full within their company, employee reads own only).
--      Add/delete only, no update policy — see the table's own comment.
create policy employee_loans_select on employee_loans for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy employee_loans_insert on employee_loans for insert
  with check (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy employee_loans_delete on employee_loans for delete
  using (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create trigger audit_employee_loans after insert or delete on employee_loans
  for each row execute function write_audit_log();

-- Health/medical insurance coverage — same visibility tier as
-- identity_documents (self, HR Admin only; never manager/Finance/CEO/CTO),
-- and the same add/delete-only lifecycle (correcting an entry means
-- deleting and re-adding it, not editing in place).
create table employee_insurance_policies (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id),
  insurance_name  text not null,     -- provider/plan name
  policy_number   text not null,
  expiry_date     date,
  file_path       text,              -- storage path in `insurance-documents`
  created_at      timestamptz not null default now(),
  created_by      uuid not null
);

create index idx_insurance_policies_employee on employee_insurance_policies(employee_id);

alter table employee_insurance_policies enable row level security;

-- ---- employee_insurance_policies: same visibility tier as
--      identity_documents (HR Admin only writes, employee reads own; never
--      Finance/line managers/CEO/CTO). Add/delete only, no update policy.
create policy insurance_policies_select on employee_insurance_policies for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy insurance_policies_insert on employee_insurance_policies for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

create policy insurance_policies_delete on employee_insurance_policies for delete
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)));

create trigger audit_insurance_policies after insert or delete on employee_insurance_policies
  for each row execute function write_audit_log();

-- insurance-documents bucket + storage.objects policies, same shape as
-- identity-documents — HR Admin only for writes, owner + HR Admin for reads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('insurance-documents', 'insurance-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy insurance_documents_select on storage.objects for select
  using (
    bucket_id = 'insurance-documents'
    and (
      (storage.foldername(name))[2]::uuid = current_employee_id()
      or has_role('hr_admin', (storage.foldername(name))[1]::uuid)
    )
  );

create policy insurance_documents_write on storage.objects for insert
  with check (bucket_id = 'insurance-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

create policy insurance_documents_update on storage.objects for update
  using (bucket_id = 'insurance-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

create policy insurance_documents_delete on storage.objects for delete
  using (bucket_id = 'insurance-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));
