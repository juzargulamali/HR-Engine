import Link from "next/link";
import { notFound } from "next/navigation";
import { ACCESS_MODULES, ACCESS_MODULE_LABELS, ACCESS_PRESETS, ROLES, ROLE_LABELS } from "@enginious-hr/domain";
import { AccessNotice } from "@/components/os/access-notice";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "@/components/ui/info-hint";
import { loadOnboarding } from "@/lib/hr/onboarding-data";
import { PRIVILEGED_ROLES, type OnboardingStatus } from "@/lib/hr/onboarding";
import { ApplyForm } from "./apply-form";
import { InviteForm } from "./invite-form";
import { OnboardingPlanForm } from "./plan-form";

export const metadata = { title: "Onboarding" };

const STATUS: Record<OnboardingStatus, { label: string; variant: "success" | "warning" | "secondary" | "outline" | "brand" }> = {
  done: { label: "Done", variant: "success" },
  ready: { label: "Ready for you", variant: "brand" },
  blocked: { label: "Needs someone else", variant: "warning" },
  waiting: { label: "Waiting", variant: "secondary" },
  optional: { label: "Optional", variant: "outline" },
};
const humanise = (c: string) => c.replace(/_/g, " ");

export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const load = await loadOnboarding(id);
  if (load.kind === "signed-out") return null;
  if (load.kind === "not-found") notFound();
  if (load.kind === "denied") return <AccessNotice title="Onboarding">Onboarding is for an HR Admin of the employee&apos;s company and for System Administrators.</AccessNotice>;

  const { employee, model, plan, companies, viewer, failed } = load;
  const created = sp.created === "1";
  const accountStep = model.steps.find((s) => s.key === "account")!;
  const createdNotice = typeof sp.notice === "string" ? sp.notice.slice(0, 300) : "";
  const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r], privileged: PRIVILEGED_ROLES.includes(r) }));
  const moduleOptions = ACCESS_MODULES.map((m) => ({ value: m, label: ACCESS_MODULE_LABELS[m], presets: ACCESS_PRESETS[m].map((p) => ({ id: p.id, label: p.label, summary: p.summary, capabilities: [...p.capabilities] })) }));
  const profileHref = `/employees/${employee.id}`;

  return (
    <div className="space-y-6" data-testid="onboarding-page">
      <div>
        <Link href={profileHref} className="text-sm text-muted-foreground underline">Back to {employee.fullName}&apos;s profile</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Onboarding: {employee.fullName}</h1>
          <InfoHint label="How onboarding works" testId="info-hint-onboarding">
            <p>One flow for one person: the employee, the company and the account stay the same in every step. Add employee, complete the profile, invite, HR roles, module access, then a review.</p>
            <p className="mt-2">What is done comes from the real records, so you can leave and come back, on any device, and nothing is applied twice. The plan only records what is intended: each line is applied by the person who is allowed to apply it.</p>
            <p className="mt-2">Inviting a login and assigning HR roles belong to a System Administrator. Module access belongs to each module&apos;s founder or access manager. HR Admins add the employee, complete the profile and prepare the plan.</p>
          </InfoHint>
        </div>
        <p className="text-muted-foreground">{employee.companyName} · employee number {employee.employeeNumber}{employee.jobTitle ? ` · ${employee.jobTitle}` : ""}</p>
      </div>

      {created ? <Alert variant={createdNotice ? "warning" : "success"} data-testid="employee-created-notice">Employee created. Finish onboarding below.{createdNotice ? ` ${createdNotice}` : ""}</Alert> : null}
      {failed.length > 0 ? <Alert variant="warning" data-testid="onboarding-failed">Could not read: {failed.join(", ")}. Reload to try again; nothing below should be read as &quot;nothing to do&quot; for those parts.</Alert> : null}

      <section aria-label="Progress" className="rounded-md border border-border p-4">
        <p className="text-sm" data-testid="onboarding-progress"><span className="font-medium">{model.progress.done} of {model.progress.total} steps done.</span>{model.next ? <> Next: <span className="font-medium">{model.next.label}</span>{model.next.nextAction ? ` (${model.next.nextAction})` : ""}. Who can finish it: {model.next.viewerCan ? "you" : model.next.who}.</> : " Everything is in place."}</p>
      </section>

      <ol className="space-y-3" data-testid="onboarding-steps">
        {model.steps.map((s, idx) => (
          <li key={s.key} className="rounded-md border border-border p-4" data-testid={`onboarding-step-${s.key}`} data-status={s.status}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Step {idx + 1}</span>
              <h2 className="text-base font-semibold">{s.label}</h2>
              <Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge>
            </div>
            <p className="mt-1 text-sm">{s.detail}</p>
            {s.status !== "done" && s.status !== "optional" ? <p className="mt-1 text-sm text-muted-foreground">Who can finish it: {s.viewerCan ? "you" : s.who}.</p> : null}
            {s.key === "profile" && s.status === "ready" ? <p className="mt-2"><Link href={profileHref} className="text-sm font-medium underline">Open the profile to {s.nextAction?.toLowerCase() ?? "finish it"}</Link></p> : null}
            {s.key === "account" && s.status === "ready" ? <div className="mt-2"><InviteForm employeeId={employee.id} label={s.nextAction ?? "Invite and link"} /></div> : null}
            {s.key === "account" && s.status === "blocked" && accountStep.viewerCan && viewer.isSysAdmin ? <p className="mt-2"><Link href={`/people-access?person=${employee.linkedUserId ? `u:${employee.linkedUserId}` : `e:${employee.id}`}&tab=account`} className="text-sm font-medium underline">Open People &amp; Access</Link></p> : null}
          </li>
        ))}
      </ol>

      <section className="space-y-3 rounded-md border border-border p-4" aria-labelledby="plan-heading">
        <h2 id="plan-heading" className="text-base font-semibold">Plan: address, HR roles and module access</h2>
        <p className="text-sm text-muted-foreground">Choose what this person needs, company by company. Saving the plan grants nothing; the review below shows exactly what would be applied and by whom.</p>
        <OnboardingPlanForm employeeId={employee.id} companies={companies} roles={roleOptions} modules={moduleOptions} plan={plan} />
      </section>

      <section className="space-y-3 rounded-md border border-border p-4" aria-labelledby="review-heading" data-testid="onboarding-review">
        <h2 id="review-heading" className="text-base font-semibold">Review: exactly what will be applied</h2>
        {!model.planned ? <p className="text-sm text-muted-foreground">Nothing is planned yet. Save a plan above to see the list here.</p> : (
          <>
            <ul className="space-y-2 text-sm">
              {model.roles.map((r) => (
                <li key={r.key} data-testid={`review-role-${r.key}`} className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">HR role</Badge>
                  <span className="font-medium">{r.label}</span>
                  {r.privileged ? <Badge variant="warning">wide access</Badge> : null}
                  <span className="text-muted-foreground">{r.applied ? "Already in place." : r.canApply ? "You can apply this." : `Needs: ${r.who}.`}</span>
                </li>
              ))}
              {model.modules.map((m) => (
                <li key={m.key} data-testid={`review-module-${m.key}`} className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Module access</Badge>
                  <span className="font-medium">{m.label}</span>
                  <span>{m.capabilities.length === 0 ? "basic access" : m.capabilities.map(humanise).join(", ")}</span>
                  <span className="text-muted-foreground">{m.applied ? "Already in place." : m.canApply ? "You can apply this." : `${m.reason ? `${m.reason} ` : ""}Needs: ${m.who}.`}</span>
                </li>
              ))}
            </ul>
            <ApplyForm employeeId={employee.id} canApply={model.canApplyAny} />
          </>
        )}
      </section>
    </div>
  );
}
