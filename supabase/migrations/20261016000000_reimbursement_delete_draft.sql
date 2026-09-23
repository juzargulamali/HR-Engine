-- Lets an employee delete their OWN reimbursement claim while it's still a
-- draft (never submitted, so there's nothing to preserve) — matches the
-- request that there was no way to remove an unsubmitted claim at all.
-- Once submitted, "Cancel claim" is the only way out, same as
-- leave_requests never getting a delete policy either.
create policy reimbursement_delete_draft on reimbursement_claims for delete
  using (employee_id = current_employee_id() and status = 'draft');
