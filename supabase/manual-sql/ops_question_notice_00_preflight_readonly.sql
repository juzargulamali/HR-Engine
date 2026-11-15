-- READ ONLY. Run BEFORE applying 20270113000200_ops_question_notice.sql. Changes nothing.
-- Expect: row 1 'OK'; row 2 'not installed yet' (or 'already installed' on a second run). Rows 3 to 5 are numbers for information.
--   Row 3: questions from Operations that Sales has not answered. The migration sends NOTHING for these (no backfill): tell the owners yourself, or ask Operations to
--          save the question again with a changed wording after the migration (a changed question notifies once).
--   Row 4: of those, how many are on an enquiry whose owner is inactive or no longer holds Sales access. For a NEW question on such an enquiry the company's Sales
--          founders are told instead of the owner.
--   Row 5: companies with at least one flagged enquiry and NO active Sales founder. There, a question on an enquiry whose owner cannot act (row 4) would tell nobody.
select item, result from (
  select 1 as ord, 'the Operations planning table, the notice function and the Sales grants this migration reads exist' as item,
         case when to_regclass('public.ops_enquiry_planning') is not null and to_regclass('public.notifications') is not null and to_regclass('public.crm_company_grants') is not null
                   and to_regprocedure('public.proj_notify(uuid, uuid, text, jsonb, text, boolean)') is not null
                   and to_regprocedure('public.ops_set_enquiry_planning(uuid, jsonb)') is not null then 'OK'
              else 'STOP - apply 20270102000100_ops_phase2b.sql first' end as result
  union all select 2, 'this migration is not installed yet',
         case when to_regprocedure('public.ops_question_notify()') is not null then 'already installed' else 'not installed yet' end
  union all select 3, 'information: questions from Operations not answered by Sales (nothing is sent for these)',
         (select count(*) from ops_enquiry_planning pl join crm_opportunities o on o.id = pl.opportunity_id where pl.question is not null and pl.answered_at is null and o.stage <> 'lost')::text
  union all select 4, 'information: of those, on an enquiry whose owner is inactive or without Sales access',
         (select count(*) from ops_enquiry_planning pl join crm_opportunities o on o.id = pl.opportunity_id
           where pl.question is not null and pl.answered_at is null and o.stage <> 'lost'
             and not exists (select 1 from crm_company_grants g join profiles p on p.id = g.user_id and p.is_active
                              where g.user_id = o.owner_id and g.company_id = o.company_id and g.revoked_at is null))::text
  union all select 5, 'information: companies with a flagged enquiry and no active Sales founder',
         (select count(distinct o.company_id) from crm_opportunities o where o.ops_flagged_at is not null and o.stage <> 'lost'
             and not exists (select 1 from crm_company_grants g join profiles p on p.id = g.user_id and p.is_active
                              where g.company_id = o.company_id and g.revoked_at is null and 'founder' = any (g.capabilities)))::text
) x order by ord;
