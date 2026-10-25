#!/usr/bin/env bash
# LOCAL throwaway database only. The Sales-only start of sales-actions.mjs (README step 1): fresh database, Sales grants (ceo@ founder, mgr@ and emp@
# plain) and the company settings of the UAE company; no Projects access, no enquiries. Usage: seed/sales.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/../stack.sh" reset
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
CO=00000000-0000-4000-8000-00000000a001; U=00000000-0000-4000-8000
$P -c "insert into crm_company_grants (user_id, company_id, capabilities) values ('$U-0000000000a3','$CO','{founder}'),('$U-0000000000a4','$CO','{}'),('$U-0000000000a5','$CO','{}')"
$P -c "insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('$CO','UAE','AED')"
echo "sales seeded"
