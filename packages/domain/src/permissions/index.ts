/**
 * One file per module's permission checks, re-exported here. Adding a new
 * module (e.g. leave requests in Phase 3) means adding `permissions/leave.ts`
 * and one line here — nothing existing changes. See
 * docs/09-extending-the-system.md.
 */
export * from "./core";
export * from "./companies";
export * from "./users";
export * from "./employees";
export * from "./policies";
export * from "./leave";
export * from "./projects";
export * from "./documents";
export * from "./payroll";
export * from "./aiDrafts";
export * from "./alerts";
