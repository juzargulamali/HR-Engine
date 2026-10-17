-- WRITES / DESTRUCTIVE. ONLY for backing out the Sales & CRM install on "Enginious HR Engine_V2". Not part of the normal
-- deployment. It removes every CRM table, function and the crm-files bucket record, and nothing else: no HR table,
-- function, policy, grant or row is touched.
--
-- SAFETY: while any CRM business data exists (opportunities, organisations, contacts, files, proposals, follow-ups)
-- the script REFUSES to run. Export that data first, then change v_allow_data_loss to true to proceed knowingly.
-- Storage objects inside the bucket are not removed by SQL: empty the "crm-files" bucket in the Storage UI first
-- (deleting rows from storage.objects directly would leave the files behind).

do $$
declare
  v_allow_data_loss boolean := false;     -- <<< change to true only after exporting, and only if you really mean it
  v_rows bigint;
begin
  select (select count(*) from crm_opportunities) + (select count(*) from crm_organisations) + (select count(*) from crm_contacts)
       + (select count(*) from crm_files) + (select count(*) from crm_proposals) + (select count(*) from crm_follow_ups)
    into v_rows;
  if v_rows > 0 and not v_allow_data_loss then
    raise exception 'CRM data exists (% rows across opportunities, organisations, contacts, files, proposals, follow-ups). Export it first, then set v_allow_data_loss := true.', v_rows;
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'crm-files') then
    raise exception 'The crm-files bucket still contains files. Empty it in the Storage UI first.';
  end if;

  drop table if exists crm_reminders, crm_handovers, crm_approvals, crm_zoho_references, crm_proposals, crm_files,
    crm_follow_ups, crm_activities, crm_opportunity_events, crm_opportunity_contacts, crm_opportunities,
    crm_reference_counters, crm_contacts, crm_organisations, crm_company_settings, crm_audit_log, crm_company_grants cascade;

  -- Every remaining CRM function (their signatures differ, so they are discovered rather than listed).
  declare f record;
  begin
    for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'crm\_%' loop
      execute 'drop function if exists ' || f.sig || ' cascade';
    end loop;
  end;

  delete from storage.buckets where id = 'crm-files';
  raise notice 'Sales & CRM objects removed.';
end $$;

-- Afterwards run crm_00_preflight_readonly.sql: section C must show "no CRM tables or functions exist yet".
-- Also set the application back: deploy the previous version of the app (the Sales tab disappears when the tables are absent).
