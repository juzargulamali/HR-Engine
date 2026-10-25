import type { EmployeeHit, MovementOutcome, StatusOutcome } from "@/lib/actions/inventoryStock";
import type { Candidate, ScanResolution } from "@/lib/inventory/stock-candidates";
import type { AdjustAction, MovementInput, MovementKind } from "@/lib/inventory/stock-movements";

/**
 * Everything a movement form needs from the outside world, in one object. The live page passes the real server actions; the tests pass
 * simple fakes. Nothing here changes stock by itself except `submit`, which the form only calls from its Confirm button.
 */
export interface MovementServices {
  submit(input: MovementInput): Promise<MovementOutcome>;
  check(companyId: string, key: string): Promise<StatusOutcome>;
  search(p: { companyId: string; locationId: string | null; kind: MovementKind; q: string; rentalId?: string | null; adjustAction?: AdjustAction }): Promise<{ error: string | null; candidates: Candidate[] }>;
  held(p: { companyId: string; employeeId?: string | null; projectId?: string | null }): Promise<{ error: string | null; candidates: Candidate[] }>;
  read(raw: string): Promise<ScanResolution>;
  employees(companyId: string, query: string): Promise<{ error: string | null; people: EmployeeHit[] }>;
}
