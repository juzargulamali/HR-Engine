"use client";

import { useActionState } from "react";
import { createAsset } from "@/lib/actions/assets";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function NewAssetForm({ companies }: { companies: { id: string; legal_name: string }[] }) {
  const [state, formAction, pending] = useActionState(createAsset, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {companies.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="companyId">Company</Label>
          <Select id="companyId" name="companyId" defaultValue={companies[0]?.id} required>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legal_name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <input type="hidden" name="companyId" value={companies[0]?.id} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="assetTag">Asset tag</Label>
          <Input id="assetTag" name="assetTag" placeholder="LAP-014" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <Input id="category" name="category" placeholder="Laptop" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Input id="description" name="description" placeholder="MacBook Pro 14&quot;, 2024" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="purchaseDate">Purchase date (optional)</Label>
          <Input id="purchaseDate" name="purchaseDate" type="date" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="value">Value (optional)</Label>
          <Input id="value" name="value" type="number" min={0} step="0.01" />
        </div>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add asset"}
      </Button>
    </form>
  );
}
