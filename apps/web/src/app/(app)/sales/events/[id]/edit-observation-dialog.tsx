"use client";

import { useRouter } from "next/navigation";
import { saveObservation } from "@/lib/actions/events";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { ObservationFields, type ObservationValues, type OrgChoice } from "../observation-form";

/** The one edit dialog of the page, opened by the address (`?edit=<observation>`) so an edit link on any cell needs no copy of the account list. Closing returns to `closeHref`. */
export function EditObservationDialog({ values, orgs, closeHref }: { values: ObservationValues; orgs: OrgChoice[]; closeHref: string }) {
  const router = useRouter();
  const close = () => router.replace(closeHref, { scroll: false });
  return (
    <Modal open onClose={close} title="Edit observation" description="Only the person who recorded it, or a founder, can change it.">
      <ActionForm action={saveObservation} submitLabel="Save changes" onDone={close} secondary={<Button type="button" variant="ghost" onClick={close}>Cancel</Button>}>
        <input type="hidden" name="id" value={values.id} />
        <ObservationFields editions={[]} orgs={orgs} initial={values} />
      </ActionForm>
    </Modal>
  );
}
