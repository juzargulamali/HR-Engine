# Known issue: People & Access says "You cannot manage people or access" when the data service is down

**Status:** open, not fixed. **Not part of the Inventory simplification (PR #52)**, which does not touch People & Access. Recorded here so it is neither lost nor mixed into that PR. It came to light because the Inventory outage check (`apps/web/os-shell-checks/inventory-a11y.mjs`) also visits `/people-access`; that one visit fails and the Inventory pages pass.

## What happens

When the data service cannot be reached, a signed-in System Administrator or founder who opens `/people-access` sees:

> People & Access — You cannot manage people or access. This page is for System Administrators, HR Admins and people who manage access to Sales, Projects, Inventory or project budgets.

That reads as a missing right. Inventory, in the same situation, says *"Could not load Inventory. This is a problem loading the information, not an empty list."* People & Access should say the same kind of thing. (Seen in the local verification stack with the data service stopped, as the founder `ceo@e2e.local`; the page text above was read back from the real screen.)

## Why

`loadPeopleAccess` (`apps/web/src/lib/people-access/data.ts`) reads the person's own module grants and, on **any** read error, treats the result as "no grants" (`return { module, rows: error ? [] : … }`, with the comment that a module that is not installed "or any failure simply means no access to manage there"). With no grants, `canUsePeopleAccess` is false and the page returns `kind: "denied"`. An outage and a missing right therefore look the same. The shell's own role lookup also fails during an outage, which is why the sidebar shows "No role assigned" at the same moment.

## Impact

* Misleading only. It **fails closed**: nobody gains access, nothing is changed, and every change still goes through the same database-checked actions.
* A founder could be told they have no access during a short outage and not know to retry.

## Suggested fix (not implemented, needs its own change)

* Tell "the read failed" apart from "the read succeeded and there are no grants": keep treating a table that is *not installed* as "none", but treat any other error as a load failure and return a `kind: "error"` result.
* Render the shared `LoadError` for it (as the Inventory pages do) with a retry link, instead of the "You cannot manage…" notice.
* Add a unit test for the loader (error is not denied) and let the outage check in `inventory-a11y.mjs` pass for `/people-access`.

## How to reproduce

`node apps/web/os-shell-checks/inventory-a11y.mjs` on the local stack: the step "While the data service is down, /people-access (ceo) says it could not load" fails; every Inventory step in the same section passes.
