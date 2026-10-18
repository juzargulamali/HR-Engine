-- Projects & Tasks (Release 2), migration 7 of 7: three small additions found in review.
--   1. Older discussion messages stay reachable: proj_messages_before pages backwards from a cursor (the page loads the latest
--      100 and offers "Show earlier messages"), with exactly the same access rule as the rest of the discussion.
--   2. A correct company label on summary-only pages: proj_company_labels returns the legal name of a company only when the caller
--      holds a Projects grant there or can already see one of its projects in summary. A name is not commercial data and is
--      never returned for a company the caller has no Projects relationship with.
--   3. A safe, listed clean-up of abandoned temporary uploads: proj_abandoned_upload_objects reports (never deletes) the
--      storage objects that belong to expired or finished upload attempts and are referenced by no stored file. The removal itself
--      is a documented manual step in the Storage UI (docs/projects-deployment.md, supabase/manual-sql/proj_85_*).
-- Additive only: no table, column, policy, trigger or existing function is changed. Nothing here is scheduled.

-- -----------------------------------------------------------------------------
-- 1. Earlier discussion messages
-- -----------------------------------------------------------------------------
-- Messages strictly older than p_before_seq (null = from the newest), newest first, at most p_limit (default 50, never above
-- 200). Same shape and same access rule as proj_messages_since: members of the project and the company's founders only.
create or replace function proj_messages_before(p_project_id uuid, p_before_seq bigint default null, p_limit integer default 50)
returns table (id uuid, seq bigint, parent_id uuid, author_id uuid, author_name text, body text, created_at timestamptz, edited_at timestamptz,
               deleted_at timestamptz, changed_at timestamptz, mention_ids uuid[])
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  if not proj_can_view_details(p_project_id) then return; end if;
  return query
    select m.id, m.seq, m.parent_id, m.author_id, proj_display_name(m.author_id), m.body, m.created_at, m.edited_at, m.deleted_at, m.changed_at,
           coalesce((select array_agg(x.user_id) from proj_message_mentions x where x.message_id = m.id), '{}'::uuid[])
    from proj_messages m
    where m.project_id = p_project_id
      and (p_before_seq is null or m.seq < p_before_seq)
    order by m.seq desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Company labels for pages the caller is allowed to open
-- -----------------------------------------------------------------------------
create or replace function proj_company_labels()
returns table (company_id uuid, name text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  return query
    select c.id, c.legal_name
    from companies c
    where proj_has_access(c.id)
       or exists (select 1 from proj_projects pr where pr.company_id = c.id and proj_can_view_summary(pr.id))
    order by c.legal_name;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Abandoned temporary uploads: a read-only report for the owner (service role / SQL Editor only)
-- -----------------------------------------------------------------------------
-- Lists objects in the two Projects buckets that can be removed, and, separately, objects nothing explains. It deletes nothing.
--   * proj-quarantine: the temporary copy of an upload whose attempt ended (registered, or expired longer ago than the grace
--     period). After a successful upload the server removes this copy itself, so a copy that is still there was abandoned.
--   * proj-files: a validated file that was never registered as a project file (the attempt expired, or was rejected) and that no
--     stored file refers to.
--   * anything else in either bucket that matches no upload attempt and no stored file is listed with safe_to_delete = false:
--     it is reported for a person to look at, never as removable.
-- An object that a stored file (proj_files) refers to is never listed as removable.
create or replace function proj_abandoned_upload_objects(p_grace interval default interval '1 day')
returns table (bucket text, object_name text, size_bytes bigint, uploaded_at timestamptz, reason text, safe_to_delete boolean, intent_id uuid, intent_status text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if p_grace is null or p_grace < interval '1 hour' then
    raise exception 'The grace period must be at least one hour' using errcode = '22023';
  end if;
  return query
    select o.bucket_id::text, o.name::text, coalesce((o.metadata ->> 'size')::bigint, 0), o.created_at,
           case when i.status = 'registered' then 'Temporary copy left behind after the file was stored'
                else 'Temporary copy of an upload that was never finished (' || i.status || ', expired ' || to_char(i.expires_at, 'YYYY-MM-DD HH24:MI') || ')' end,
           true, i.id, i.status::text
    from storage.objects o
    join proj_upload_intents i on i.quarantine_path = o.name
    where o.bucket_id = 'proj-quarantine'
      and (i.status = 'registered' or i.expires_at < now() - p_grace)
    union all
    select o.bucket_id::text, o.name::text, coalesce((o.metadata ->> 'size')::bigint, 0), o.created_at,
           'Checked file that was never added to the project (' || i.status || ', expired ' || to_char(i.expires_at, 'YYYY-MM-DD HH24:MI') || ')',
           true, i.id, i.status::text
    from storage.objects o
    join proj_upload_intents i on i.final_path = o.name
    where o.bucket_id = 'proj-files'
      and i.status <> 'registered'
      and i.expires_at < now() - p_grace
      and not exists (select 1 from proj_files f where f.storage_path = o.name)
    union all
    select o.bucket_id::text, o.name::text, coalesce((o.metadata ->> 'size')::bigint, 0), o.created_at,
           'No upload record and no stored file refers to it: look at it by hand (this procedure never removes it)',
           false, null::uuid, null::text
    from storage.objects o
    where o.bucket_id in ('proj-files', 'proj-quarantine')
      and not exists (select 1 from proj_upload_intents i where i.quarantine_path = o.name or i.final_path = o.name)
      and not exists (select 1 from proj_files f where f.storage_path = o.name)
    order by 1, 4, 2;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function proj_messages_before(uuid, bigint, integer), proj_company_labels(), proj_abandoned_upload_objects(interval)
  from public, anon, authenticated;
grant execute on function proj_messages_before(uuid, bigint, integer), proj_company_labels() to authenticated;
-- Server / owner only: the service role and the SQL Editor (never reachable from a browser session).
grant execute on function proj_abandoned_upload_objects(interval) to service_role;
