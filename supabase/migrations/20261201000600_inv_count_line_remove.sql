-- Inventory, migration 7: a mistaken count line can be taken out of an OPEN count.
-- inv_save_count_line only replaces the line for the same unit or item, and the confirm step tells the person to "remove it from the
-- count and check it again", so the removal has to exist. A count line is a worksheet entry, not stock: nothing in the books changes.
-- Additive: one function.

create or replace function inv_remove_count_line(p_count_id uuid, p_line_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare c inv_counts; n integer;
begin
  perform inv_require_user();
  select * into c from inv_counts where id = p_count_id;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform inv_ctx(c.company_id);
  perform inv_loc(c.company_id, c.location_id);          -- needs operate rights at the count's location, like saving a line
  select * into c from inv_counts where id = p_count_id for update;
  if c.status <> 'open' then raise exception 'This count is already % and can no longer be changed', c.status using errcode = '23514'; end if;
  delete from inv_count_lines where id = p_line_id and count_id = p_count_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That line is not on this count' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function inv_remove_count_line(uuid, uuid) from public, anon, authenticated;
grant execute on function inv_remove_count_line(uuid, uuid) to authenticated;

-- ROLLBACK (only before any Inventory data exists):
--   drop function if exists inv_remove_count_line(uuid, uuid);
