-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the seven Projects & Tasks migrations, whenever you want to
-- know whether abandoned temporary uploads have piled up (once a month is plenty; nothing breaks if you never do). It changes
-- nothing and deletes nothing: it only LISTS files. Run the WHOLE file; it returns ONE result table.
--
-- WHAT IS AN ABANDONED UPLOAD? A person starts to add a file; the browser sends it to a private "quarantine" folder; the server
-- checks it and then stores the checked copy in the project's private folder and removes the quarantine copy. If the person
-- closes the tab, loses the connection or is refused (wrong type, too large), a file can stay behind. It is private (no signed-in
-- user can read it) and harmless, but it takes space. The list below is exactly those files:
--   REMOVE            a temporary copy of an upload that ended, or a checked file that was never added to a project, and that no
--                     project file refers to. Safe to remove.
--   LOOK AT BY HAND   a file in a Projects folder that no upload record and no project file explains. NEVER remove it on this
--                     list's say-so: find out where it came from first.
--
-- HOW TO CLEAN UP (nothing is automatic, nothing is scheduled):
--   1. Run this file. If there are no REMOVE rows, stop.
--   2. Open Supabase > Storage > the bucket named in the "bucket" column (proj-quarantine or proj-files), open the folders named in
--      "object_name" (company / project / file) and delete ONLY the REMOVE files listed. The Storage page and its Delete button
--      are the safe way. Do NOT delete rows from storage.objects with SQL: that removes the record but leaves the file stored.
--   3. Run this file again: the REMOVE rows are gone. (Optional bookkeeping, which deletes no file: running
--      `select * from proj_expire_upload_intents();` in the SQL Editor marks the finished upload records as expired.)
-- A file a project refers to is never listed as REMOVE; if you are unsure about one, leave it.
--
-- To use a longer safety margin, change the interval on the next line (never less than one hour; the default of one day keeps an
-- upload that is still being finished from ever being listed).

with settings as (select interval '1 day' as grace),
found as (select * from proj_abandoned_upload_objects((select grace from settings)))
select kind, bucket, object_name, size_kb, uploaded_at, why
from (
  select 0 as ord, 'SUMMARY' as kind, null::text as bucket, null::text as object_name, null::numeric as size_kb, null::timestamptz as uploaded_at,
         (select count(*) filter (where safe_to_delete) from found)::text || ' file(s) can be removed (' ||
         coalesce((select round(sum(size_bytes) filter (where safe_to_delete) / 1024.0, 1) from found), 0)::text || ' KB); ' ||
         (select count(*) filter (where not safe_to_delete) from found)::text || ' file(s) need a look by hand. Nothing was changed.' as why
  union all
  select 1, case when safe_to_delete then 'REMOVE' else 'LOOK AT BY HAND' end, f.bucket, f.object_name, round(f.size_bytes / 1024.0, 1), f.uploaded_at, f.reason
  from found f
) x
order by ord, kind desc, bucket, uploaded_at, object_name;
