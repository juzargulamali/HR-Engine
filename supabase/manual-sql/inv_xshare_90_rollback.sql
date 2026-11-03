-- WRITES (function definitions are dropped; no table, row, policy or other privilege is touched). OWNER-RUN ROLLBACK of 20261218000100_inv_cross_company_receiving.sql.
--
-- WHEN TO USE IT: only if the new functions cause a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back means the receiving company's warehouse operators can no longer see a unit or a transfer that another company sent them
-- (they cannot receive it from the screen; the existing database function inv_transfer_receive itself is unchanged), the Send form offers only
-- warehouses of the sender's own companies again, and the owner no longer sees the receipt of a cross-company transfer. The application treats a missing
-- function as "could not load" for those parts, never as an empty list. Stock, transfers, movements and sharing authorisations are untouched.
--
-- It is safe to run twice. Afterwards inv_xshare_20_verify_readonly.sql reports the functions as missing (that is how it tells you the old state is back).

begin;

drop function if exists inv_xshare_availability(uuid, uuid);
drop function if exists inv_xshare_units(uuid, text);
drop function if exists inv_xshare_transfer_trace(uuid);
drop function if exists inv_xshare_transfers();
drop function if exists inv_xshare_destinations();
drop function if exists inv_xshare_sees(uuid, uuid, uuid);
drop function if exists inv_xshare_may_handle(uuid, uuid);
drop function if exists inv_xshare_active(uuid, uuid);

commit;
