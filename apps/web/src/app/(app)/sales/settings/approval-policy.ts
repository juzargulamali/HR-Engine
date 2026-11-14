/*
 * The words for a company's commercial approval policy. A plain module (not the client form) because the server page reads them too, for the read-only
 * summary non-founders see: values exported from a client file cannot be read while rendering on the server.
 */
export type ApprovalPolicyValue = "not_configured" | "not_required" | "required";

export const APPROVAL_POLICY_LABEL: Record<ApprovalPolicyValue, string> = {
  not_configured: "Not configured (nobody has decided yet)",
  not_required: "Not required",
  required: "Required",
};

export const APPROVAL_POLICY_EXPLANATION: Record<ApprovalPolicyValue, string> = {
  not_configured: "Nobody has decided yet. Until a policy is set, nothing can be approved, and no proposal will show as approved.",
  not_required: "A founder has decided proposals do not need internal approval before they are sent.",
  required: "Proposals need a founder's recorded approval before they are treated as approved.",
};
