-- OPTIONAL. WRITES DATA (profiles.is_active only, for accounts ALREADY shown as deactivated). Run in the SQL Editor of "Enginious HR Engine_V2" ONLY after
-- 20261216000300_account_deactivation_inactive_people.sql is applied and deact_20_verify_readonly.sql says OK, and only if you decide to.
--
-- WHY. Before the migration, deactivating an account did not set profiles.is_active, so accounts deactivated earlier are shown as Deactivated (and are blocked from signing in)
-- but are still flagged active: they would still be resolved as approvers for NEW requests and still be pickable as project manager, team head or approver. From now on
-- set_account_status() sets the flag, so only accounts deactivated BEFORE the migration need this one-off alignment. deact_00_preflight_readonly.sql lists them (section D).
--
-- WHAT IT DOES. Step 1 lists the accounts it would change (read-only). Step 2 sets is_active = false on exactly those accounts and returns their ids: KEEP THAT RESULT, it is
-- your undo list. It touches nothing else: no approval is moved, no role or module grant is changed, nobody is signed out or deleted, no account is reactivated.
-- It does NOT skip the safety rules: if one of the accounts is the only CEO / CTO approver or CEO / CTO of a company, step 1 flags it (column "note") and step 2 leaves
-- it alone; resolve that first (give the role or right to another active person) and run the file again.
--
-- UNDO. Paste the ids from step 2 into:  update profiles set is_active = true where id in ('<id>', '<id>');
-- It is safe to run twice (a second run finds nothing to change).

-- STEP 1 (read-only): run this on its own first.
select p.id, p.email, p.account_status::text as account_status, p.is_active,
       case when exists (select 1 from user_roles ur where ur.user_id = p.id and ur.role in ('ceo', 'cto') and ur.revoked_at is null)
              or exists (select 1 from pbx_company_grants g where g.user_id = p.id and g.revoked_at is null and 'executive_approver' = any (g.capabilities))
            then 'holds a CEO / CTO role or the budget approver right: check another active person holds it before aligning' else '' end as note
from profiles p
where p.account_status = 'deactivated' and p.is_active
order by p.email;

-- STEP 2 (writes): run once step 1 looks right.
-- Only accounts that are not the sole CEO / CTO / budget approver of a company are changed; the rest stay as they are and are reported by step 1 next time.
begin;

with candidates as (
  select p.id from profiles p
  where p.account_status = 'deactivated' and p.is_active
    and not exists (
      select 1 from companies co
      where co.is_active and co.deleted_at is null
        and exists (select 1 from user_roles ur where ur.user_id = p.id and ur.role in ('ceo', 'cto') and ur.revoked_at is null and (ur.company_id is null or ur.company_id = co.id))
        and not exists (select 1 from user_roles ur2 join profiles p2 on p2.id = ur2.user_id and p2.is_active
                         where ur2.role in ('ceo', 'cto') and ur2.revoked_at is null and (ur2.company_id is null or ur2.company_id = co.id) and ur2.user_id <> p.id))
    and not exists (
      select 1 from pbx_company_grants g
      where g.user_id = p.id and g.revoked_at is null and 'executive_approver' = any (g.capabilities)
        and not exists (select 1 from pbx_company_grants g2 join profiles p2 on p2.id = g2.user_id and p2.is_active
                         where g2.company_id = g.company_id and g2.revoked_at is null and g2.user_id <> p.id and 'executive_approver' = any (g2.capabilities)))
)
update profiles set is_active = false
where id in (select id from candidates)
returning id, email;

commit;
