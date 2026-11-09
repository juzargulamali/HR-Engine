#!/usr/bin/env bash
# LOCAL throwaway database only. Start of sales-crm-readiness-flow.mjs: fresh database; Sales grants (ceo@ founder, mgr@ and emp@ plain) and the UAE settings;
# Projects grants (ceo@ founder, mgr@ the Project Manager, lead@ a colleague with Projects access who is NOT the assigned PM, hr@ and hr1@) and settings;
# one fictional client organisation; NO enquiry (the flow creates it through the screens). Usage: seed/sales-readiness.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/../stack.sh" reset
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
CO=00000000-0000-4000-8000-00000000a001; U=00000000-0000-4000-8000
$P -c "insert into crm_company_grants (user_id, company_id, capabilities) values ('$U-0000000000a3','$CO','{founder}'),('$U-0000000000a4','$CO','{}'),('$U-0000000000a5','$CO','{}')"
$P -c "insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('$CO','UAE','AED')"
$P -c "insert into proj_company_settings (company_id, reference_code) values ('$CO','UAE')"
$P -c "insert into proj_company_grants (user_id, company_id, capabilities) values ('$U-0000000000a3','$CO','{founder}'),('$U-0000000000a4','$CO','{}'),('$U-0000000000a7','$CO','{}'),('$U-0000000000a2','$CO','{}'),('$U-0000000000a1','$CO','{}')"
$P <<SQL >/dev/null
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a5","role":"authenticated"}', true);
select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE');
commit;
SQL
$P -c "update companies set legal_name='Fictional Enginious UAE LLC', trn='100000000000003', address='Fictional Tower, Dubai' where id='$CO'"
echo "sales readiness seeded"
