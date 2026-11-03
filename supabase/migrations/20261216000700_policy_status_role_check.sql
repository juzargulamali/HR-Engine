-- A16 / D-22. preflight_phase2b_v2_policy_status() answers only the people who may read those drafts. ADDITIVE: replaces one function in place (create or replace) and
-- changes who may CALL it; no table, policy or data change.
--
-- WHY (reproduced on a local copy before the fix: packages/rls-tests/test/policy_status_role_check.rls.test.ts). The function is SECURITY DEFINER and had no role check and no
-- privilege restriction, and the Policies page called it for every viewer, so any signed-in employee (or, because execute was never revoked, any caller) could read the
-- status, effective date and key values of the seeded DRAFT leave, notice and probation policy versions, which policy_versions_select hides from them.
--
-- WHAT. A slot (country, policy type) is returned only to a person who may read that country's drafts: the same test as policy_versions_select and the draft-creation
-- function (has_role('hr_admin' | 'ceo' | 'cto', null, country): a grant not limited to one company). HR Admin sees the same rows as before; everyone else gets none.
-- Execute is also taken away from anonymous callers. The Policies page now calls it only for people who may draft.
--
-- WHAT DOES NOT CHANGE. The columns, the 12 slots, seed_phase2b_policy_drafts(), policy_versions' policies, every leave rule and calculation.
-- ROLLBACK: supabase/manual-sql/polstat_90_rollback.sql (re-installs the previous definition; the exposure returns).

create or replace function preflight_phase2b_v2_policy_status()
returns table(
  country_code text,
  policy_type text,
  version_no int,
  status text,
  effective_from date,
  critical_values jsonb,
  runtime_can_resolve_unambiguously boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cc.code,
    pt.policy_type,
    pv.version_no,
    coalesce(pv.status::text, 'not_created'),
    pv.effective_from,
    case
      when pv.id is null then null
      when pt.policy_type = 'leave_rules' then (
        select jsonb_object_agg(plt.leave_type_code, jsonb_build_object(
          'accrual_method', plt.accrual_method,
          'accrual_rate_per_period', plt.accrual_rate_per_period,
          'max_balance_days', plt.max_balance_days,
          'carryover_max_days', plt.carryover_max_days,
          'min_service_days_to_accrue', plt.min_service_days_to_accrue
        ))
        from policy_leave_types plt where plt.policy_version_id = pv.id
      )
      else pv.payload - 'phase2b_seed_marker'
    end,
    pv.id is not null and not exists (
      select 1 from policy_versions other
      where other.country_code = pv.country_code
        and other.policy_type = pv.policy_type
        and other.status = 'active'
        and other.id <> pv.id
        and other.effective_from <= coalesce(pv.effective_to, 'infinity'::date)
        and coalesce(other.effective_to, 'infinity'::date) >= pv.effective_from
    )
  from (values ('AE'), ('SA'), ('PL')) as cc(code)
  cross join (values ('leave_rules'), ('overtime_rules'), ('notice_period'), ('probation_rules')) as pt(policy_type)
  left join policy_versions pv
    on pv.country_code = cc.code
    and pv.policy_type::text = pt.policy_type
    and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
  where has_role('hr_admin', null, cc.code) or has_role('ceo', null, cc.code) or has_role('cto', null, cc.code)
  order by cc.code, pt.policy_type;
$$;

revoke all on function preflight_phase2b_v2_policy_status() from public, anon;
grant execute on function preflight_phase2b_v2_policy_status() to authenticated;
