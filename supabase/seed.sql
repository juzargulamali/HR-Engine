-- Local/dev seed data only — never run against a production project by hand;
-- production country/company rows are created through the Sys Admin UI so
-- they go through the normal audit trail once it exists (Phase 6).

insert into countries (code, name, default_currency, week_start_day) values
  ('AE', 'United Arab Emirates', 'AED', 0),  -- work week starts Sunday
  ('SA', 'Saudi Arabia',        'SAR', 0),
  ('PL', 'Poland',              'PLN', 1)    -- work week starts Monday
on conflict (code) do nothing;
