-- =====================================================================================================================================================================
-- Operations asks Sales a question on a flagged enquiry: Sales is told, once.
--
-- Before this migration ops_set_enquiry_planning (20270102000100_ops_phase2b.sql) saved the question and wrote a line in the enquiry's history, and sent nothing
-- ("No notice is sent: Sales has no notice list of its own"). Sales found the question only by opening the enquiry.
--
-- What this adds (additive: one trigger on ops_enquiry_planning and its two helper functions; no existing function is replaced and no existing row is changed):
--   * A NEW or CHANGED question sends ONE in-app notice (notifications, type 'project_ops_question') through the existing proj_notify, with the de-duplication key
--     'ops_question:<enquiry id>'. proj_notify never tells the person who asked, never tells an inactive account, and does not repeat a notice that is still unread
--     with the same key. So: saving the same question again, saving other planning fields, a retry and a double click send nothing more; a question that changes
--     while the earlier notice is still unread keeps that ONE notice (it links to the enquiry, which shows the current question); a question that changes after
--     the notice was read sends a new one.
--   * Who is told: the enquiry's owner, when that person is active and still holds Sales access to the company. Otherwise (the owner has left, lost Sales access,
--     or IS the person who asked) the company's active Sales founders are told instead, never the person who asked. An enquiry always has an owner
--     (crm_opportunities.owner_id is NOT NULL), so "no owner" means "the owner can no longer act on it".
--   * The notice carries the enquiry's id and reference only, never the question's text (the same rule as the other Operations notices).
--   * When Sales answers, or Operations withdraws the question, the unread notices about it are marked read: nothing keeps asking for something already done.
--
-- The type starts with "project_" on purpose: the existing proj_my_notifications / proj_mark_notifications_read (the Project notices list and "Dismiss") then work
-- for it unchanged, as they do for the two existing Operations notices.
--
-- Compatibility with the app that is deployed today: it calls ops_set_enquiry_planning and crm_set_ops_planning exactly as before and neither is replaced. Its
-- Project notices list shows a type it does not know as "A project update." with no link; the new app words it and links to the question. Apply this BEFORE or
-- AFTER the new app (the new app reads notices of a type that simply does not exist yet).
--
-- Existing questions: nothing is sent for a question asked before this migration (no backfill: the preflight counts the unanswered ones for the owner).
-- Safe to run twice. Rollback: supabase/manual-sql/ops_question_notice_90_rollback.sql.
-- =====================================================================================================================================================================

-- The people told about a question on one enquiry (see the header). Never the caller.
create or replace function ops_question_recipients(p_opportunity_id uuid)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare o crm_opportunities; v_owner_ok boolean;
begin
  select * into o from crm_opportunities where id = p_opportunity_id;
  if not found then return; end if;
  select exists (
    select 1 from crm_company_grants g join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = o.owner_id and g.company_id = o.company_id and g.revoked_at is null) into v_owner_ok;
  if v_owner_ok and o.owner_id is distinct from auth.uid() then
    return next o.owner_id;
    return;
  end if;
  return query
    select g.user_id from crm_company_grants g join profiles p on p.id = g.user_id and p.is_active
    where g.company_id = o.company_id and g.revoked_at is null and 'founder' = any (g.capabilities) and g.user_id is distinct from auth.uid();
end;
$$;

create or replace function ops_question_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref text; r record;
begin
  if new.question is not null and (tg_op = 'INSERT' or new.question is distinct from old.question) then
    select o.reference into v_ref from crm_opportunities o where o.id = new.opportunity_id;
    for r in select u from ops_question_recipients(new.opportunity_id) as u loop
      perform proj_notify(null, r.u, 'project_ops_question',
        jsonb_build_object('opportunity_id', new.opportunity_id, 'reference', v_ref), 'ops_question:' || new.opportunity_id::text, false);
    end loop;
  elsif tg_op = 'UPDATE' and ((new.question is null and old.question is not null) or (new.answered_at is not null and new.answered_at is distinct from old.answered_at)) then
    -- answered, or withdrawn: the notice has done its work
    update notifications set read_at = now()
     where type = 'project_ops_question' and read_at is null and payload ->> 'opportunity_id' = new.opportunity_id::text;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ops_question_notify on ops_enquiry_planning;
create trigger trg_ops_question_notify after insert or update on ops_enquiry_planning for each row execute function ops_question_notify();

revoke all on function ops_question_recipients(uuid), ops_question_notify() from public, anon, authenticated;
