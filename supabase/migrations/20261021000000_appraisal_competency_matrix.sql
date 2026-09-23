-- Competency matrix for appraisals: five fixed 1-5 competency ratings,
-- replacing the single freeform "overall rating" as the thing appraisers
-- actually fill in. overall_rating stays as a real column (existing pages
-- read it directly) but becomes fully derived — a before-insert-or-update
-- trigger recomputes it as the rounded average of whichever of the five
-- competency ratings are non-null (all-null -> null), overwriting whatever
-- the statement itself tried to put there. No new RLS policy is needed:
-- appraisals_update_appraiser/appraisals_update_hr already allow the
-- appraiser/HR to update these rows generally, and these five columns are
-- the same trust tier as strengths/areas_for_improvement, which those
-- policies already let them edit.

alter table appraisals
  add column quality_of_work_rating int check (quality_of_work_rating between 1 and 5),
  add column productivity_rating     int check (productivity_rating between 1 and 5),
  add column initiative_rating       int check (initiative_rating between 1 and 5),
  add column teamwork_rating         int check (teamwork_rating between 1 and 5),
  add column punctuality_rating      int check (punctuality_rating between 1 and 5);

-- Re-defined (not just the two new trigger objects below): the existing
-- guard_appraisal_acknowledge() only compared overall_rating/strengths/etc,
-- so without adding the five new columns here too, an employee acknowledging
-- their appraisal could tamper with an individual competency score as long
-- as the rounded overall_rating happened to land unchanged — comparing the
-- derived average alone isn't equivalent to comparing its inputs.
create or replace function guard_appraisal_acknowledge()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if auth.uid() = (select user_id from employees where id = old.employee_id) then
    if new.overall_rating is distinct from old.overall_rating
      or new.quality_of_work_rating is distinct from old.quality_of_work_rating
      or new.productivity_rating is distinct from old.productivity_rating
      or new.initiative_rating is distinct from old.initiative_rating
      or new.teamwork_rating is distinct from old.teamwork_rating
      or new.punctuality_rating is distinct from old.punctuality_rating
      or new.strengths is distinct from old.strengths
      or new.areas_for_improvement is distinct from old.areas_for_improvement
      or new.cycle_id is distinct from old.cycle_id
      or new.appraiser_id is distinct from old.appraiser_id
      or new.submitted_at is distinct from old.submitted_at
    then
      raise exception 'An employee may only acknowledge their appraisal, not edit its content';
    end if;
  end if;

  if auth.uid() = old.appraiser_id and new.employee_id is distinct from old.employee_id then
    raise exception 'An appraisal cannot be reassigned to a different employee';
  end if;

  return new;
end;
$$;

create or replace function compute_appraisal_overall_rating()
returns trigger
language plpgsql
as $$
begin
  new.overall_rating := round((
    select avg(v) from (values
      (new.quality_of_work_rating),
      (new.productivity_rating),
      (new.initiative_rating),
      (new.teamwork_rating),
      (new.punctuality_rating)
    ) as t(v)
    where v is not null
  ));
  return new;
end;
$$;

-- Trigger name sorts before "appraisals_guard_self_update" so it runs first
-- on update, meaning guard_appraisal_acknowledge() (which compares
-- new.overall_rating to old.overall_rating to block an employee editing
-- content during acknowledge) sees the freshly-recomputed value rather than
-- whatever the client attempted to send.
create trigger appraisals_compute_overall
  before insert or update on appraisals
  for each row execute function compute_appraisal_overall_rating();
