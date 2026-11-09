#!/usr/bin/env bash
# LOCAL throwaway database only. Start of jarvis-flow.mjs: fresh database; Sales settings for the UAE and the Polish company; Sales grants (emp@ for BOTH companies, mgr@ for the UAE only,
# ceo@ founder of the UAE); two fictional organisations (one agency, one end client) registered by emp@; NO enquiry and JARVIS left OFF (the migration's default): the flow switches the
# pilot on with the documented SQL. Usage: seed/jarvis.sh   (then start the app with JARVIS_PROVIDER=simulated, JARVIS_ALLOW_SIMULATED_ON_LOCAL_STACK=1 and JARVIS_CONFIRMATION_SECRET set: see README)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/../stack.sh" reset
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
UAE=00000000-0000-4000-8000-00000000a001; PL=00000000-0000-4000-8000-00000000a002; U=00000000-0000-4000-8000
$P -c "insert into crm_company_grants (user_id, company_id, capabilities) values ('$U-0000000000a3','$UAE','{founder}'),('$U-0000000000a4','$UAE','{}'),('$U-0000000000a5','$UAE','{}'),('$U-0000000000a5','$PL','{}')"
$P -c "insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('$UAE','UAE','AED'),('$PL','PLX','PLN')"
$P -c "update companies set legal_name='Fictional Enginious UAE LLC' where id='$UAE'" -c "update companies set legal_name='Fictional Enginious PL Sp. z o.o.' where id='$PL'"
$P <<SQL >/dev/null
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a5","role":"authenticated"}', true);
select crm_create_organisation_profile(p_name => 'Fictional Wave Agency', p_roles => '{agency}', p_country_code => 'AE');
select crm_create_organisation_profile(p_name => 'Fictional Harbour Brands', p_roles => '{client}', p_country_code => 'AE');
commit;
SQL
echo "jarvis seeded (JARVIS is OFF: enabled=false, no pilot users)"
