-- A17 / D-23. An employee reads the stored file of their own letter only once it is ISSUED. ADDITIVE: replaces one storage read policy (drop + create, same name, same
-- role, narrower for one branch); no table, no data, no other policy changes. Nothing already issued becomes unreadable by its owner.
--
-- WHY (reproduced on a local copy before the fix: packages/rls-tests/test/letters_pending_storage.rls.test.ts). The application renders the letter PDF and stores it BEFORE
-- the approval is routed, so a letter that needs CEO / CTO sign-off has a file while it is "pending approval". The letters_select policy let the owning employee read any
-- file under their own folder, whatever the letter's status, so the file was in the employee's hands before sign-off (and stayed there after a rejection or a void).
--
-- WHAT. The employee branch of letters_select now also requires a generated_letters row for that exact file with status = 'issued'. A file with no letter row is not
-- readable by the employee. The HR Admin branch is unchanged (HR reviews drafts before they are signed), and so are the CEO / CTO read policy (letters_select_ceo: the
-- executive needs the file to decide), uploads and deletes. The Letters page offers Download to an employee only for issued letters (interface change in the same change).
--
-- WHAT DOES NOT CHANGE. generated_letters' own policies (the employee still sees their letter row, so the page can say "pending approval"), approvals, templates.
-- ROLLBACK: supabase/manual-sql/letters_90_rollback.sql (re-creates the previous policy: the exposure returns).

drop policy if exists letters_select on storage.objects;
create policy letters_select on storage.objects for select
  using (
    bucket_id = 'letters'
    and (
      (
        (storage.foldername(name))[2]::uuid = current_employee_id()
        and exists (
          select 1 from generated_letters gl
          where gl.file_path = name and gl.employee_id = current_employee_id() and gl.status = 'issued'
        )
      )
      or has_role('hr_admin', (storage.foldername(name))[1]::uuid)
    )
  );
