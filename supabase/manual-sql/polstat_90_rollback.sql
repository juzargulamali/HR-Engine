-- WRITES (one function definition and its execute privilege; no row is touched). OWNER-RUN ROLLBACK of 20261216000700_policy_status_role_check.sql.
--
-- WHEN TO USE IT: only if the change causes a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back lets every signed-in user (and, with the default privilege, anyone) read the status and key values of the seeded DRAFT policy versions again.
--
-- It is safe to run twice. Afterwards the matching *_20_verify_readonly.sql reports the new rules as missing (that is how it tells you the old state is back), or run the
-- *_05_preservation_check_readonly.sql against your BEFORE snapshot (the changed items then say UNCHANGED / MISSING).
-- The previous definition is the one in 20261103000000_phase2b_v2_policy_drafts.sql. Execute goes back to the default (everyone).

begin;

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
  order by cc.code, pt.policy_type;
$$;

grant execute on function preflight_phase2b_v2_policy_status() to public;

commit;
