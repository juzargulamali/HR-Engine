-- Adds the CTO role as a full peer of CEO (see the next migration for the
-- actual parity grants). Postgres requires a new enum value to be added in
-- its own transaction, separate from anything that references it, so this
-- is deliberately its own migration file applied before
-- 20261018000000_cto_role_parity.sql.
alter type app_role add value 'cto';
