-- employee_checklist_items_select/_complete branch on assignee_role for
-- line_manager/finance/sys_admin, but app_role has a 'ceo' value too and
-- nothing stops a checklist_template_items row from being created with
-- assignee_role='ceo' (no CHECK constraint restricts it) — if one ever is,
-- the CEO could never see or complete that item; only HR Admin could act on
-- their behalf. No onboarding/offboarding checklist UI exists yet, so this
-- is latent rather than live, but it's the same missing-enum-branch shape
-- as the is_entity_owner() bug already fixed twice — closing it now, before
-- checklist management ships.
drop policy employee_checklist_items_select on employee_checklist_items;

create policy employee_checklist_items_select on employee_checklist_items for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'line_manager')
      and is_manager_of(employee_id)
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'finance')
      and has_role('finance', (select company_id from employees where id = employee_id))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'ceo')
      and has_role('ceo', (select company_id from employees where id = employee_id))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'sys_admin')
      and has_role('sys_admin')
    )
  );

drop policy employee_checklist_items_complete on employee_checklist_items;

create policy employee_checklist_items_complete on employee_checklist_items for update
  using (
    employee_id = current_employee_id()
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'line_manager')
      and is_manager_of(employee_id)
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'finance')
      and has_role('finance', (select company_id from employees where id = employee_id))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'ceo')
      and has_role('ceo', (select company_id from employees where id = employee_id))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'sys_admin')
      and has_role('sys_admin')
    )
  );
