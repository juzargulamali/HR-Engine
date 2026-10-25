"use client";

import { checkTransaction, loadHeldItems, lookupEmployees, readCode, recordMovement, searchStock } from "@/lib/actions/inventoryStock";
import type { MovementServices } from "./movement-services";

/** The real thing: each call goes to a server action, which calls the database function and lets it decide. */
export const liveServices: MovementServices = {
  submit: recordMovement,
  check: checkTransaction,
  search: searchStock,
  held: loadHeldItems,
  read: readCode,
  employees: lookupEmployees,
};
