# Sales: Events & Exhibitions, exhibitor and agency history, outreach priority

Status: **draft PR, not merged** (branch `feat/outreach-events`); migration `20261224000100_crm_events_outreach.sql` (additive, owner pack `supabase/manual-sql/crm_events_20_verify_readonly.sql` and `_90_rollback.sql`, deployment note `docs/events-outreach-deployment.md`) is **not applied anywhere** and was exercised only on a throwaway database. Conventions as in `../README.md`: every claim cites a source; the named database function is the real gate and repeats the check.

Routes: `/sales/events` (the shared list of editions) and `/sales/events/[id]` (one event: editions, exhibitors compared, outreach leads, linked enquiries). Tab and sidebar entry "Events & Exhibitions" (`components/nav/nav-groups.ts`, `app/(app)/sales/layout.tsx`), shown to anyone with a Sales grant.

## 1. The goal in one workflow
When a show is coming up a salesperson opens the event, sees which clients exhibited before, which agency built each stand in each year, and which agencies to contact, with each agency's shared **Outreach priority**, then opens the account to start outreach or a follow-up (the existing Outreach and Follow-up workflow). At the show, **Record an observation** takes the edition, the exhibitor and the agency (or "Agency unknown") on a phone, with no enquiry.

## 2. What is shared and what stays company-scoped
| Shared by every person with a Sales grant, in any company | Company-scoped (unchanged) |
|---|---|
| Accounts (organisations and contacts; `crm_organisations`, read with `crm_has_any_access()`), the **Outreach priority** (`crm_organisations.outreach_priority`), events, editions, observations | Enquiries and everything on them (`crm_opportunities`, read with `crm_has_access(company_id)`), estimates, follow-ups, outreach assignments, **per-company account fields** (account owner, lead source, exhibition: `crm_account_profiles`) |

The link between the two lives on the enquiry (`crm_opportunities.event_edition_id`), so an edition's figures are computed from the enquiries **the viewer's own session can read**. An enquiry of a company the viewer has no grant for is invisible to them and contributes nothing to a figure or a drill-down (RLS test `crm-events-outreach.rls.test.ts`, browser flow step 3).

## 3. Control reference
Who "can use it" is what the screen offers; the named function is the real gate.

### 3.1 Events list (`/sales/events`, `apps/web/src/app/(app)/sales/events/page.tsx`)
| Control | What it does | Who | Success / failure | Behind it | Tests |
|---|---|---|---|---|---|
| Filters: Event name, Country, When, From / To date, Include archived, Apply / Clear | Default **Upcoming** editions worldwide, soonest first (an edition on now counts as upcoming). When: Upcoming, **Past editions** (newest first), All. From / To override When and match any edition overlapping the range. Archived entries only when asked for | Any Sales grant | Bad dates in the address are ignored | `eventFiltersFromParams`, `filterEditions` (`lib/crm/events/model.ts`) | `model.test.ts` |
| "Enquiry figures for" (only with grants for more than one company) | Current company (default) or **All my companies**; never wider than the viewer's own grants | Own grants only | A company without a grant falls back to the first | `eventsScope` (`events/scope.ts`) | `scope.test.ts`; flow step 3 |
| Table | One row per edition: label "Event · year · city", dates, where, status (Upcoming / On now / Past, Archived), and Enquiries, Open, Closed, Won, Lost. Open = not won and not lost (On hold is open); closed = won + lost (the existing CRM rules). Computed from the linked enquiries, never typed in. Below `md` each row is a card | same | Failed read: "Could not load Events & Exhibitions" with Try again, never an empty list | `loadEvents`, `countEnquiries`, `enquiriesByEdition` | `model.test.ts`; RLS test |
| Add event | Dialog: name, kind (Exhibition / Conference / Other event), website, note. A second event with the same name (ignoring case and punctuation) is refused: "open it and add the next edition" | Any Sales grant | Refusal in words | `saveEvent` -> `crm_save_event` | `actions/events.test.ts`; RLS |
| Add edition | Dialog: event, start, end, city, country code, venue, note. Adding the next edition **never changes an earlier edition's dates**; the same event cannot have two live editions starting on one date | Any Sales grant | Dates, country and duplicates refused in words | `saveEdition` -> `crm_save_edition` | same |
| Events with no edition | A notice names them and links to each | same | | `page.tsx` | |

### 3.2 Event page (`/sales/events/[id]`)
| Block / control | What it does | Who | Notes | Behind it | Tests |
|---|---|---|---|---|---|
| Header actions | **Record an observation**, **Add next edition**, Edit event, Remove event | Record / Add: any Sales grant; Edit / Remove: the person who added the event or a founder | Remove **deletes** an unused event and its editions; with enquiries or observations it is **archived** (every link and observation stays) and the screen says which happened | `crm_save_event`, `crm_remove_event` | RLS "removal keeps what is used" |
| Editions table | The same event across years: dates, where, status and the five figures of the chosen scope; click an edition to focus it; Edit (dates, place) and Remove per edition | Edit / Remove: creator or founder | The scope line states whose enquiries are counted | `crm_save_edition`, `crm_remove_edition` | RLS; flow step 3 |
| **Who exhibited, and with which agency** | One row per exhibitor, the latest 4 editions side by side (all with "Show all N editions"); below `md` one card per exhibitor with one block per edition. **No observation** = nothing recorded (never implies they stayed away); **Did not exhibit** = recorded; **Agency unknown** = exhibited, agency not identified; several stands / agencies / roles in one edition are separate lines; **Unverified** entries are kept and marked, Confirmed ones say so. "Open the observation(s)" shows each underlying record (who recorded it, when, note) with Edit / Remove for the person who recorded it or a founder | Any Sales grant reads | A non-exhibition event needs no stand number | `buildExhibitorGrid`, `observationLine`, `crm_event_observations` | `model.test.ts`; flow step 4 |
| **Agencies to contact for <edition>** | Every agency recorded at an **earlier** edition of the event, whichever exhibitor it worked for. Agency A in 2025 and Agency B in 2026 for the same client are **both** listed; neither is treated as confirmed for the chosen edition; an unknown agency is not a lead. Highest outreach priority first (Unrated last), then latest sighting. Each lead shows its sightings (year, exhibitor, stand, role, confirmed / unverified), a priority control and "Open account · outreach & follow-up" (the account's `#outreach` section: log activity, next action, status, create an inquiry, plus the account's follow-ups) | Any Sales grant | Defaults to the next upcoming edition, else the latest | `outreachLeads`, `sortLeads` | `model.test.ts`; flow step 4 |
| Enquiries linked to <edition> | The enquiries behind the figures (reference link, title, company, stage) for the same scope | same | An enquiry of a company the viewer cannot access is not listed | `enquiriesByEdition` | RLS; flow step 3 |

### 3.3 Record an observation (dialog, built for a phone)
Fields: **Edition** (native select), **Exhibitor / client** (search-as-you-type over the shared directory), What did you see (**Exhibited** / **Did not exhibit**), **Agency** (search over accounts recorded as agencies) or tick **Agency unknown**, optional **Stand number**, **Agency role** (Stand builder, Stand design, AV / technology, Fabrication, Other), a **Confirmed** tick (unticked = Unverified) and a note. It creates no enquiry and needs none. Did not exhibit takes no agency, stand or role. Typing in a search field never selects or creates an account: choose a match, or add the account first (the empty state links to Clients & Agencies). `saveObservation` -> `crm_record_observation` / `crm_update_observation`; the shape is enforced again by the table CHECK (`crm_event_observations_shape`) and the agency must hold the Agency role (`crm_observation_check`). Tests: `actions/events.test.ts`, RLS "observations", flow step 4 (on a 390 x 844 touch viewport).

## 4. Outreach priority
One shared value per account, **1 to 5 (5 highest) or Unrated**, the team's own rating of who to approach, not a review score. It is shown in the Clients & Agencies table (column "Outreach priority", sortable, highest first, **Unrated always last**), filterable (Any, 5 only, 4 and above, 3 and above, Any rating, Unrated), set on the account page ("Outreach priority (shared)") and on each lead of an event. Setting it saves at once; who set it and when is stored. **Any Sales grant may set it** (wider than the "edit a shared organisation" rule, a decision recorded in `docs/events-outreach-deployment.md`). `setOutreachPriority` -> `crm_set_outreach_priority`; tests `directory.test.ts`, `actions/events.test.ts`, RLS "shared outreach priority".

## 5. Not covered (stated, not hidden)
- Nothing is run against a hosted project; the migration is not applied.
- Observations and events have no import and no export yet.
- An archived event or edition cannot be restored from the screen.
- The directory's per-company columns follow the working company (see `sales-clients-and-agencies.md` section 2.1); a per-company breakdown of owners is not shown.
