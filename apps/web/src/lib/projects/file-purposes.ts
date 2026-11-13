/**
 * The purposes a project file can have. Plain data on purpose: it is read by the Files & client plan PAGE (a server component) and by the add-file forms (a client component),
 * and a server component cannot read a constant that is exported from a "use client" module (it receives a client reference, not the array).
 */
export const FILE_PURPOSES = [
  { id: "document", label: "Document" },
  { id: "feedback_evidence", label: "Feedback evidence" },
  { id: "completion_evidence", label: "Completion evidence (Project Manager)" },
  { id: "other", label: "Other" },
] as const;

/** The purpose as a short label for a table ("Completion evidence"); an unknown purpose is shown as it is stored. */
export const filePurposeLabel = (id: string): string => FILE_PURPOSES.find((p) => p.id === id)?.label.replace(" (Project Manager)", "") ?? id;
