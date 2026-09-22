-- appraisals had select/insert/update policies but no delete at all — a
-- draft created against the wrong employee or cycle (a real, easy mistake:
-- appraisals_insert only checks the appraiser is that employee's manager or
-- HR Admin, not that the pairing is otherwise correct) could never be
-- removed. Scoped to drafts only — same restriction
-- appraisals_update_appraiser already applies to editing — so a
-- submitted/acknowledged appraisal (real history) can never be deleted,
-- only a not-yet-submitted one.
create policy appraisals_delete on appraisals for delete
  using (
    status = 'draft'
    and (appraiser_id = auth.uid() or has_role('hr_admin', (select company_id from employees where id = employee_id)))
  );

-- policy_versions had insert/update but no delete — same "draft only"
-- restriction its own update policy already applies (an active version is
-- real, in-effect policy and stays append-only forever), so this only
-- lets a mis-drafted version that was never activated be removed.
create policy policy_versions_delete on policy_versions for delete
  using (
    status = 'draft'
    and (has_role('hr_admin', null, country_code) or has_role('ceo', null, country_code))
  );
