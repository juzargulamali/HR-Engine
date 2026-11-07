# Sales: Clients & Agencies (part 1: directory, account page, ownership)

Status: in draft PR on branch `feat/clients-agencies` (not merged). Code verified at `7d97600` by the checks listed in section 7; nothing was run against a hosted project. Conventions as in `../README.md`: every claim cites a source; `Unverified` marks what was not confirmed by code or a run.

Route: `/sales/accounts` (directory) and `/sales/accounts/[id]` (account), reached from the new Sales tab "Clients & Agencies" (`apps/web/src/components/nav/nav-groups.ts`, `apps/web/src/app/(app)/sales/layout.tsx`). The older `/sales/clients` ("Clients & contacts") is unchanged. The one migration is `supabase/migrations/20261219000100_crm_clients_agencies.sql` (deployment: `docs/clients-agencies-deployment.md`).

## 1. What the existing model could not cover (the reason for the migration)

| Gap | Evidence | What was added |
|---|---|---|
| An organisation has ONE `kind` (`agency`, `client`, `direct`); no Technology company; one company cannot be two things | `crm_organisations.kind` check, `20261115000100_crm_core_tables.sql` | `roles text[]` on the SAME record (agency, direct, client, technology). `kind` stays, derived from roles by trigger `crm_organisations_sync_kind`, so enquiry pickers and the old Clients page work unchanged. Existing rows were back-filled (`roles = [kind]`). No role recorded is allowed (name-only profile) |
| No country, no website | same | `country_code` (two letters), `website`, generated `website_domain` (for matching) |
| Organisations are shared reference data with no company, so no per-company owner or lead source | policy `crm_organisations_select ... crm_has_any_access()` | table `crm_account_profiles` (one row per organisation and company: `owner_id`, `lead_source`, `exhibition`), SELECT only, `crm_has_access(company_id)` |
| No function edits an organisation, saves a company profile, assigns an account owner or changes a follow-up's assignee | `20261115000200_crm_workflow_functions.sql` has `crm_create_organisation` only; `crm_assign_owner` moves follow-ups only as a side effect of changing an OPPORTUNITY's owner | six functions, section 3 |

Reused as they are: organisations (`crm_organisations`), contacts (`crm_contacts`, `crm_create_contact`, `crm_update_contact`), opportunities with `agency_org_id` and `client_org_id`, activities, follow-ups (`crm_create_follow_up`), proposals, Zoho references, `crm_user_has_company_access` (owner eligibility), `crm_people()` (picker), `assign_owner` capability, `LoadError`.

## 2. Control reference

Who "can use it" is what the screen offers; the database function named in the table is the real gate and repeats the check.

### 2.1 Directory (`apps/web/src/app/(app)/sales/accounts/page.tsx`)

| Control | What it does | Who | Success / failure | Behind it | Tests |
|---|---|---|---|---|---|
| Tab "Clients & Agencies" | Opens the directory | Any Sales grant | Not shown without a grant (layout shows the access notice) | `nav-groups.ts`, `sales/layout.tsx` | `nav-groups.test.ts` |
| Company (only with grants for more than one company) | Scopes the whole page and every count to one Enginious company; default is the person's first company | Own grants only | A company without a grant falls back to the first one | `selectCompany` (`lib/crm/clients-agencies/company.ts`) | `directory.test.ts` (company scoping of owner and counts) |
| Search | Name, website, place, relationship notes, exhibition, contact name/title/email/phone | Any Sales grant | No match: "Nothing matches" with Clear | `filterDirectory` | `directory.test.ts` |
| Role | Agency, Direct client, End client, Technology company, or "Role not recorded". A company with two roles appears under both | same | | `filterDirectory`, `roles` | `directory.test.ts` |
| Country | Countries present in the list | same | | `country_code` | same |
| Account owner | Anyone, Unassigned, or an eligible person of the selected company. Shows the selected company's owner only | same | | `crm_account_profiles.owner_id` | same |
| Lead source | Any, a source (the enquiry sources plus Exhibition), or Not recorded | same | | `crm_account_profiles.lead_source` | same |
| Exhibition | Contains-text on the exhibition name | same | | `crm_account_profiles.exhibition` | same |
| Apply / Clear | Submits the form as a normal GET (filters live in the address, so a link keeps them); Clear drops them | same | Unrecognised values in the address are ignored | `filtersFromParams` | `directory.test.ts` |
| Account card | Name (link to the account), role badges or "Role not recorded", country and place, website domain, owner or the "Unassigned" badge, lead source and exhibition, inquiry count (this company only), contact count | same | First 100 shown, then a notice to narrow | `buildDirectoryRows` | same |
| Add account | Dialog: only Name is required; roles (tick several), country, place, website, lead source, exhibition, relationship notes, optional first contact, and Account owner only for people with `assign_owner`. On success opens the new account | Any Sales grant; owner choice only with `assign_owner` | Refusal is shown in the dialog in words (typed values are kept); owner choice without the right is refused before any database call | `createAccount` (`lib/actions/clients-agencies.ts`) -> `createOrganisationWithContacts` -> `crm_create_organisation_profile` | `clients-agencies.test.ts` (actions), `match-write.test.ts`, RLS "roles and profile" |
| Failed load | "Could not load Clients & Agencies" with Try again; never an empty list | | | `loadDirectory` throws on any failed read | `data.test.ts` |

### 2.2 Account page (`apps/web/src/app/(app)/sales/accounts/[id]/page.tsx`)

| Control / block | What it does | Who | Success / failure | Behind it | Tests |
|---|---|---|---|---|---|
| Summary counts and "How these are counted" | Inquiries, Won inquiries, Completed projects, Direct, Through an agency, As the agency; definitions in section 4 | Any Sales grant | A failed projects read shows "Could not load" for Completed projects, never 0 | `deriveAccount`, `COUNT_DEFINITIONS` (`lib/crm/clients-agencies/account.ts`) | `account.test.ts`, `data.test.ts` |
| Edit profile | Dialog: name, roles, country, website, place, relationship notes (shared record), lead source and exhibition (this company only). Blank clears a field. This is also how an imported, incomplete profile is filled in later | Creator of the organisation, a Sales founder, or the owner of an open inquiry it is on (same rule as editing a contact). Account owner and follow-up assignee confer no edit right (section 5) | Others see: "Only the person who added this organisation, a founder, or the owner of an opportunity it is on can change it". If the shared record saves but the company profile does not, the message says which part saved | `saveAccountProfile` -> `crm_update_organisation` then `crm_save_account_profile`; guard `crm_can_edit_organisation` | `clients-agencies.test.ts`, RLS "who may edit" |
| Account owner: Assign owner / Change owner | Dialog: Unassigned or an eligible person (an active Sales grant for this company). Does not change any follow-up or inquiry owner | Holders of `assign_owner`, or a Sales founder, in THIS company | Others see no button and the line "Only a founder, or someone with the assign owners right, can change the account owner." Ineligible person: "The chosen owner has no Sales access for this company" | `assignAccountOwner` (checks the capability from the caller's own grants first) -> `crm_assign_account_owner` | `clients-agencies.test.ts`, RLS "account owner" |
| Contacts: Add contact | Adds a contact to this organisation (any number): name required; title, email, phone optional | Any Sales grant (existing rule) | Bad email is refused in words | existing `createContact` -> `crm_create_contact` | existing `crm.test.ts`; RLS "several contacts" |
| Contacts: Edit | Edits the shared contact record | Creator, a Sales founder, or owner of an open inquiry the contact is on (existing rule) | Refusal in words | existing `updateContact` -> `crm_update_contact` | existing `crm.test.ts` |
| Inquiries list | Each inquiry once: reference and title (link), how it came (Direct / Through agency: X / As the agency, for X), stage, and for won inquiries the project line | Any Sales grant | | `inquiryRoute`, `deriveAccount` | `account.test.ts` |
| Quotes | Proposals (by version) and the Zoho quote reference of this account's inquiries: plain status, or "Awaiting reply" only where recorded data supports it (section 4) | Any Sales grant | | `deriveQuotes` | `account.test.ts` |
| Last recorded activity | Newest `crm_activities` row on this account's inquiries (kind, date, inquiry link); none: "No activity recorded in CRM." | Any Sales grant | | `deriveAccount` | `account.test.ts` |
| History (no linked inquiry) | Shows exactly "No activity recorded in CRM." and a link to record an enquiry | Any Sales grant | | `hasHistory` false | `account.test.ts`; browser smoke |
| Follow-ups | Open follow-ups of this account's inquiries with person, due date and Overdue / Due today; own assignee and own date, separate from the account owner | Any Sales grant reads | | `loadAccount` | `account.test.ts` |
| Add follow-up | Dialog: pick one of the account's OPEN inquiries, what to do, date, time (Dubai), who it is for. Only offered when an open inquiry exists | Existing rule of `crm_create_follow_up`: for yourself or for the inquiry owner; for a third person you must be the inquiry owner or hold `assign_owner` | Refusal in words | existing `createFollowUp` -> `crm_create_follow_up` | existing `crm.test.ts`; RLS "follow-up reassignment" (same rule) |
| Reassign (follow-up) | Hands an open follow-up to an eligible person. Changes only the follow-up | Button shown to the current assignee, the inquiry owner, `assign_owner` holders and founders; the database applies the rule: assignee, inquiry owner or founder acts, and handing to a third person needs the inquiry owner or `assign_owner` | Refusal in words; reminders already generated for the old assignee are cleared so the new one gets their own | `reassignFollowUp` -> `crm_reassign_follow_up` | `clients-agencies.test.ts`, RLS "owner and follow-up assignee are independent" |
| Failed load / not found | "Could not load this account" with Try again; an unknown or invisible id is a 404 | | | `loadAccount` | `data.test.ts` |

An account with no open inquiry cannot take a follow-up: follow-ups belong to an inquiry (`crm_follow_ups.opportunity_id` is required). See section 6.

## 3. Database and server functions

| Function | Does | Gate |
|---|---|---|
| `crm_can_edit_organisation(org, company?)` | Edit right for an organisation (and with a company, its profile) | Creator, or a founder (any company; for a company's profile: a founder of that company), or owner of a non-lost inquiry that names it (in that company); with a company the caller also needs a grant for it |
| `crm_create_organisation_profile(name, roles, country, website, place, note, company, lead_source, exhibition, owner, contacts jsonb)` | Creates the organisation, optionally this company's profile and any number of contacts, all or nothing | Any CRM grant; owner needs `assign_owner` in that company and an eligible person |
| `crm_update_organisation(org, patch)` | Name, roles, country, website, place, notes | `crm_can_edit_organisation` |
| `crm_save_account_profile(org, company, patch)` | Lead source, exhibition (creates the profile row) | `crm_can_edit_organisation(org, company)` |
| `crm_assign_account_owner(org, company, owner|null, reason)` | Assigns, reassigns or clears the account owner | `crm_has_capability(company, 'assign_owner')`; owner must pass `crm_user_has_company_access` (active profile and grant). Touches no inquiry and no follow-up |
| `crm_reassign_follow_up(follow_up, assignee)` | Changes the assignee of an open follow-up | Existing follow-up actor rule and create-follow-up rule; assignee must have access to the inquiry's company. Touches no owner |
| `crm_create_organisation` (replaced, same signature) | Also records the role | unchanged |

Writes to `crm_account_profiles` are function-only (SELECT policy, no DML grants). The table has the `set_updated_at` and `crm_audit_trigger` triggers, so owner changes are in the Sales audit trail.

## 4. Definition of the counts

* **Inquiries**: every inquiry of the selected company that names this account as agency or end client, counted once even if the account is both. Another company's inquiries are never counted.
* **Direct** / **Through an agency** / **As the agency**: three exclusive buckets that add up to Inquiries. Direct: this account is the end client and no other agency is recorded (or the same organisation is on both sides). Through an agency: this account is the end client and a different agency is recorded (the page names it). As the agency: this account is the agency (the page names the end client, if recorded).
* **Won inquiries**: stage Won. A won inquiry is not a completed project.
* **Completed projects**: Projects (`proj_projects.crm_opportunity_id`) of those inquiries with status Completed (or a completion date), counted once per project, read through the viewer's own session. A person who cannot open a project (Projects access or a Sales link is needed; completed projects are visible to founders, members and Sales-linked people only, `proj_can_view_summary`) does not get it counted: where the handover exists (`proj_handover_for_opportunity`, readable by any Sales grantee) but the project cannot be opened, the page says "Project exists; status not visible to you" and how many were left out.
* **Avoiding double counting across views**: an inquiry shows on the agency's page and again on the end client's page, because each shows that account's own work. Each page counts it once and says so; counts of two accounts must not be added together.
* **Awaiting reply**: only for a quote recorded as sent (a proposal with status `sent` and its `sent_on`, or a Zoho `quote_sent_on`), on an inquiry that is still open (not Won, Lost or On hold), with NO `client_response` activity dated on or after the sent date. Otherwise the plain status is shown (Draft, Sent, Superseded, Accepted, Not sent; a recorded reply reads "Sent · reply recorded <date>"). A call or email of ours is not a reply. An inquiry with two awaiting quotes counts once.
* **Follow-ups due**: open follow-ups of those inquiries; overdue and due-today are by Dubai date.

## 5. What each assignment confers (verified in the SQL and by RLS tests)

| Assignment | Read | Edit / act | Source |
|---|---|---|---|
| Any active Sales grant for a company | Every inquiry, follow-up, activity, quote of that company (`crm_has_access(company_id)`), whoever owns it. Organisations and contacts of ALL companies (`crm_has_any_access()`, shared reference data, existing) | nothing by itself | `20261115000100_crm_core_tables.sql` policies |
| Inquiry owner | nothing extra | edits, moves and closes own inquiry; may assign its follow-ups to others; edits contacts linked to its open inquiries; (new) edits an organisation it is on | `crm_require_owner_or_founder`, `crm_create_follow_up`, `crm_can_edit_contact`, `crm_can_edit_organisation` |
| Follow-up assignee | nothing extra | completes, reschedules, cancels, and (new) hands over that follow-up only; no right on the inquiry or organisation | `crm_require_follow_up_actor`, `crm_reassign_follow_up` |
| **Account owner (new)** | nothing extra | **nothing.** It appears in no policy and no permission function; it is a label with an audit trail. Tests prove an account owner is still refused an organisation edit, a profile edit and an inquiry reassignment | `crm_assign_account_owner`; RLS "being account owner confers no right" |
| `assign_owner` capability / founder | nothing extra | assigns account owners (this company), reassigns inquiry owners, hands follow-ups to others | `crm_has_capability` |

Nothing was widened. Reassigning a follow-up never changes the account owner or the inquiry owner, and assigning an account owner never changes a follow-up or an inquiry owner (RLS and action tests). The older inquiry-owner reassignment `crm_assign_owner` still moves the previous owner's open follow-ups to the new owner; that existing behaviour is untouched and is about the INQUIRY, not the account.

## 6. Open points (decisions for the owner; the safe behaviour is built)

1. **Shared organisation records.** Organisations and contacts are shared reference data readable by any Sales grantee of any company (existing, `crm_organisations_select`). The directory therefore lists every shared organisation; everything company-specific (owner, lead source, exhibition, inquiries, quotes, follow-ups, projects, activity) is strictly the selected company's. Making the organisation list itself per company is a change to the existing sharing model and was not made.
2. **Account owner confers no edit right.** An imported or unassigned profile can be edited by its creator, a Sales founder, or an inquiry owner who has it on an open inquiry. Letting the account owner edit it would be a new permission and was not added.
3. **Account-level follow-ups.** Follow-ups belong to an inquiry, so an account with no open inquiry cannot take one (the page says so).
4. **Owner by e-mail (import).** `crm_people()` returns e-mail addresses only to a Sales founder, so e-mail-to-owner resolution works only for a founder; for anyone else `resolveOwnerByEmail` answers "emails_hidden".

## 7. Checks run (final code commit `7d97600`)

Lint, typecheck, root `npm test`, `cd apps/web && npx vitest run`, placeholder-env build, `npm run check:secrets`, the full RLS suite (including `packages/rls-tests/test/crm-clients-agencies.rls.test.ts`), and one local-stack browser smoke (not committed): create from a name alone, fill in later, two roles, two contacts, assign owner, filters, plain salesperson refused. Tests: `apps/web/src/lib/crm/clients-agencies/*.test.ts`, `apps/web/src/lib/actions/clients-agencies.test.ts`, `apps/web/src/components/nav/nav-groups.test.ts`.

## Import and export (part 2)

_To be written by the Part 2 work._ Reuse, do not duplicate, `apps/web/src/lib/crm/clients-agencies/` (`index.ts` lists it): `normalise.ts` (names, e-mails, countries, websites, roles), `match.ts` (`findOrganisationMatches`, `planEmptyFieldUpdate`), `write.ts` (`createOrganisationWithContacts`, `updateOrganisationEmptyFields`), `staff.ts` (`eligibleStaff`, `resolveOwnerByEmail`), `data.ts` (`loadDirectory`, `loadStaff`).
