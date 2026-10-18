import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MODULES = ["Projects & Tasks", "Inventory", "Vendors & Purchasing", "KPIs"] as const;

/** Honest roadmap note. These modules have no data and no pages yet, so nothing about them is shown but their names. */
export function ComingSoonCard() {
  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="text-base">Coming soon</CardTitle>
        <CardDescription>These ENGINIOUS OS modules are not built yet. Nothing is shown for them until they are.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {MODULES.map((m) => (
            <li key={m} className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border px-3 py-2">
              <span>{m}</span>
              <span className="text-xs">Coming soon</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
