#!/usr/bin/env bash
# LOCAL throwaway database only. Fresh database + Sales grants/settings + Projects grants/settings + one Won opportunity owned by emp@.
# (The same base the Sales and Projects browser checks start from.) Usage: seed/base.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/../stack.sh" reset
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
CO=00000000-0000-4000-8000-00000000a001; U=00000000-0000-4000-8000
$P -c "insert into crm_company_grants (user_id, company_id, capabilities) values ('$U-0000000000a3','$CO','{founder}'),('$U-0000000000a4','$CO','{}'),('$U-0000000000a5','$CO','{}')"
$P -c "insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('$CO','UAE','AED')"
$P -c "insert into proj_company_settings (company_id, reference_code) values ('$CO','UAE')"
# Projects access: a3 ceo = founder, a4 mgr = PM, a7 lead = department head, a2 hr = member, a1 hr1 = directory only; a6 admin and a9 none
$P -c "insert into proj_company_grants (user_id, company_id, capabilities) values ('$U-0000000000a3','$CO','{founder}'),('$U-0000000000a4','$CO','{}'),('$U-0000000000a7','$CO','{}'),('$U-0000000000a2','$CO','{}'),('$U-0000000000a1','$CO','{}')"
$P <<SQL >/dev/null
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a5","role":"authenticated"}', true);
select crm_create_organisation('Orbit Motors', 'client', 'Riyadh');
commit;
SQL
ORG=$($P -c "select id from crm_organisations where name='Orbit Motors'")
$P <<SQL >/dev/null
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a5","role":"authenticated"}', true);
select crm_create_opportunity(p_company_id => '$CO', p_title => 'Floor projection for the Orbit launch', p_source => 'direct_client', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '$ORG', p_currency => 'AED', p_value => 250000, p_location => 'Expo Hall 3', p_scope => 'LED floor and sensors, 6x4 m', p_technologies => '[{"name":"Interactive floor","qty":1}]'::jsonb);
commit;
SQL
$P -c "update crm_opportunities set stage='won', evidence_type='purchase_order', evidence_reference='PO-LOCAL-1', evidence_date=current_date, closed_at=now(), closed_by='$U-0000000000a5', event_start=current_date+60, event_end=current_date+64, install_start=current_date+55"
echo "base seeded"
