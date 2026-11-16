import Link from "next/link";
import { AskForAccess } from "@/components/os/ask-for-access";
import {
  canConfirmStock, canManageCatalogue, canOperateLocation, canViewStock, hasInvCapability, isInvFounder,
} from "@enginious-hr/domain";
import { cookies } from "next/headers";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Muted, PageHeader, Panel } from "@/components/projects/parts";
import { CategoriesSection } from "@/components/inventory/setup/categories-section";
import { CompanyPicker } from "@/components/inventory/setup/company-picker";
import { CompanySettings } from "@/components/inventory/setup/company-settings";
import { CountSheet, type CountSheetData, type SheetLineView } from "@/components/inventory/setup/count-sheet";
import { CountsSection, type CountRow } from "@/components/inventory/setup/counts-section";
import { GettingStarted } from "@/components/inventory/setup/getting-started";
import { LegacyImport } from "@/components/inventory/setup/legacy-import";
import { LocationsSection, type BinView, type LocationView } from "@/components/inventory/setup/locations-section";
import { OpeningCustody, type CustodyUnit } from "@/components/inventory/setup/opening-custody";
import { TechnologyEditor, type ComponentDraft } from "@/components/inventory/setup/technology-editor";
import { TechnologiesSection, type TechnologyRow } from "@/components/inventory/setup/technologies-section";
import { LoadError } from "@/components/workspace/states";
import { withParams } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { computeChecklist, type SetupFacts } from "@/lib/inventory/setup";
import { createClient } from "@/lib/supabase/server";
import { QuickAddItem } from "@/components/inventory/stock/quick-add-item";
import { WAREHOUSE_COOKIE } from "@/lib/inventory/working-location";
import { TRACKING_WORDS } from "@/lib/inventory/words";
import { cn } from "@/lib/utils";
import type { InvLegacyAssetRow } from "@/types/inventory";

export const metadata = { title: "Inventory setup" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const itemLabel = (i: { name: string; model: string | null; specification: string | null }) => [i.name, i.model, i.specification].filter((x): x is string => !!x && x.trim() !== "").join(" · ");

export default async function InventoryManagePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const sp = await searchParams;

  // Setup is for founders and catalogue managers. People who count (warehouse operators, people who confirm stock) also reach it, for counts.
  const allowed = ctx.companies.filter((c) => canManageCatalogue(ctx.grants, c.id) || canConfirmStock(ctx.grants, c.id) || hasInvCapability(ctx.grants, c.id, "warehouse"));
  if (allowed.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="Inventory setup" />
        <Alert role="status">Setup is for founders and people who manage the catalogue. <AskForAccess module="inventory" to="give you that right if you need it" /></Alert>
      </div>
    );
  }
  // The company carries forward: the address first, then the company of the warehouse the person last worked in (the same remembered choice Today and
  // Stock use), then the first one. A company they may not set up is never taken from the address or the cookie.
  const wanted = one(sp.company);
  const cookieStore = await cookies();
  const remembered = cookieStore.get(WAREHOUSE_COOKIE)?.value ?? "";
  const rememberedLocation = ctx.locations.find((l) => l.id === remembered && l.is_active) ?? null;
  const company = allowed.find((c) => c.id === wanted) ?? allowed.find((c) => c.id === rememberedLocation?.company_id) ?? allowed[0]!;
  const companyId = company.id;
  const workingWarehouse = rememberedLocation && rememberedLocation.company_id === companyId ? rememberedLocation : (ctx.locations.filter((l) => l.company_id === companyId && l.is_active).length === 1 ? ctx.locations.find((l) => l.company_id === companyId && l.is_active)! : null);
  const wantedSection = one(sp.section);
  const section: SectionId = (SECTIONS.some(([id]) => id === wantedSection) ? wantedSection : UUID_RE.test(one(sp.count)) || one(sp.counts) === "all" ? "admin" : one(sp.tech) !== "" ? "catalogue" : "warehouses") as SectionId;

  const founder = isInvFounder(ctx.grants, companyId);
  const catalogue = canManageCatalogue(ctx.grants, companyId);
  const confirmer = canConfirmStock(ctx.grants, companyId);
  const viewStock = canViewStock(ctx.grants, companyId);

  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const [categories, items, bins, technologies, components, staff] = await Promise.all([
    supabase.from("inv_categories").select("*").eq("company_id", companyId).order("sort_order").order("name"),
    supabase.from("inv_items").select("id, name, model, specification, category_id, tracking, status, quantity_scale, unit_of_measure").eq("company_id", companyId).order("name").limit(5000),
    supabase.from("inv_bins").select("*").eq("company_id", companyId).order("code").limit(5000),
    supabase.from("inv_technologies").select("*").eq("company_id", companyId).order("name"),
    supabase.from("inv_technology_components").select("*").eq("company_id", companyId).order("sort_order").limit(10000),
    supabase.rpc("inv_staff_directory"),
  ]);
  if (categories.error || items.error || bins.error || technologies.error || components.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Inventory setup" actions={<CompanyPicker companies={allowed.map((c) => ({ id: c.id, name: c.name }))} value={companyId} />} />
        <LoadError what="Inventory setup" retryHref={`/inventory/manage?company=${companyId}`} />
      </div>
    );
  }
  const people = new Map((staff.data ?? []).map((s) => [s.user_id, s.full_name?.trim() || s.email?.split("@")[0] || "a colleague"]));
  const nameOf = (id: string | null) => (id ? (id === ctx.userId ? (ctx.fullName ?? "You") : (people.get(id) ?? "a colleague")) : null);

  const locations = ctx.locations.filter((l) => l.company_id === companyId);
  const activeLocations = locations.filter((l) => l.is_active);
  const itemRows = items.data ?? [];
  const itemById = new Map(itemRows.map((i) => [i.id, i]));
  const binRows = bins.data ?? [];

  // --- stock facts (only for people who may read stock: otherwise the steps say they cannot be shown) -----------------------------------------
  let counts: CountRow[] = [];
  let countsFailed = false;
  let facts: SetupFacts = {
    activeLocations: activeLocations.length, locationsWithStock: 0, categories: (categories.data ?? []).length, activeItems: itemRows.filter((i) => i.status === "active").length,
    draftItems: itemRows.filter((i) => i.status === "draft").length, stockKnown: viewStock, draftUnitsOnShelf: 0, draftUnitsWithPeople: 0, confirmedCustodyUnits: 0,
    totalUnits: 0, labelledUnits: 0, confirmedOpeningCounts: 0, openCounts: 0,
  };
  let custodyDrafts: CustodyUnit[] = [];
  let projectOptions: { id: string; name: string }[] = [];
  let stockFailed = false;

  if (viewStock) {
    const activeIds = new Set(activeLocations.map((l) => l.id));
    const [countRows, shelfUnits, shelfBalances, draftShelf, draftPeople, custodyLines, totalUnits, unitIds, printRows, openingConfirmed, openCounts, draftPeopleRows, projects] = await Promise.all([
      supabase.from("inv_counts").select("*").eq("company_id", companyId).order("started_at", { ascending: false }).limit(100),
      supabase.from("inv_units").select("location_id").eq("company_id", companyId).neq("lifecycle", "retired").eq("custody_kind", "warehouse").limit(10000),
      supabase.from("inv_balances").select("location_id").eq("company_id", companyId).eq("holder_kind", "warehouse").gt("qty", 0).limit(10000),
      supabase.from("inv_units").select("id", head).eq("company_id", companyId).eq("lifecycle", "draft").eq("custody_kind", "warehouse"),
      supabase.from("inv_units").select("id", head).eq("company_id", companyId).eq("lifecycle", "draft").in("custody_kind", ["employee", "project"]),
      supabase.from("inv_movement_lines").select("id", head).eq("company_id", companyId).eq("from_kind", "external").in("to_kind", ["employee", "project"]),
      supabase.from("inv_units").select("id", head).eq("company_id", companyId).neq("lifecycle", "retired"),
      supabase.from("inv_units").select("id").eq("company_id", companyId).neq("lifecycle", "retired").limit(10000),
      supabase.from("inv_label_prints").select("unit_id").eq("company_id", companyId).not("unit_id", "is", null).limit(20000),
      supabase.from("inv_counts").select("id", head).eq("company_id", companyId).eq("kind", "opening").eq("status", "confirmed"),
      supabase.from("inv_counts").select("id", head).eq("company_id", companyId).eq("status", "open"),
      supabase.from("inv_units").select("id, code, item_id, custody_kind, employee_id, project_id").eq("company_id", companyId).eq("lifecycle", "draft").in("custody_kind", ["employee", "project"]).order("code").limit(500),
      supabase.from("proj_projects").select("id, name").eq("company_id", companyId).not("status", "in", "(completed,archived)").order("name").limit(300),
    ]);
    countsFailed = !!countRows.error;
    stockFailed = [shelfUnits, shelfBalances, draftShelf, draftPeople, custodyLines, totalUnits, unitIds, printRows, openingConfirmed, openCounts, draftPeopleRows].some((r) => r.error);

    const countIds = (countRows.data ?? []).map((c) => c.id);
    const lineCounts = new Map<string, number>();
    if (countIds.length > 0) {
      const { data: lineRows } = await supabase.from("inv_count_lines").select("count_id").in("count_id", countIds).limit(20000);
      for (const l of lineRows ?? []) lineCounts.set(l.count_id, (lineCounts.get(l.count_id) ?? 0) + 1);
    }
    counts = (countRows.data ?? []).map((c) => ({
      id: c.id, code: c.code, kind: c.kind, status: c.status, locationName: ctx.locationName(c.location_id), lines: lineCounts.get(c.id) ?? 0,
      startedByName: nameOf(c.started_by) ?? "a colleague", startedAt: c.started_at, confirmedByName: nameOf(c.confirmed_by), confirmedAt: c.confirmed_at,
    }));

    const withStock = new Set<string>();
    for (const u of shelfUnits.data ?? []) if (u.location_id && activeIds.has(u.location_id)) withStock.add(u.location_id);
    for (const b of shelfBalances.data ?? []) if (b.location_id && activeIds.has(b.location_id)) withStock.add(b.location_id);
    const printed = new Set((printRows.data ?? []).map((p) => p.unit_id));
    const labelled = (unitIds.data ?? []).filter((u) => printed.has(u.id)).length;
    facts = {
      ...facts, locationsWithStock: withStock.size, draftUnitsOnShelf: draftShelf.count ?? 0, draftUnitsWithPeople: draftPeople.count ?? 0, confirmedCustodyUnits: custodyLines.count ?? 0,
      totalUnits: totalUnits.count ?? 0, labelledUnits: labelled, confirmedOpeningCounts: openingConfirmed.count ?? 0, openCounts: openCounts.count ?? 0,
    };

    // People and projects that hold registered-but-unconfirmed units (names only: what a unit's holder is called, nothing else about them).
    const draftList = draftPeopleRows.data ?? [];
    const employeeNames = new Map<string, string>();
    if (draftList.some((u) => u.custody_kind === "employee")) {
      const { data: held } = await supabase.rpc("inv_employee_outstanding", { p_company_id: companyId, p_employee_id: null, p_include_inactive: true });
      for (const h of held ?? []) if (h.unit_id) employeeNames.set(h.unit_id, h.display_name);
    }
    const projectIds = [...new Set(draftList.map((u) => u.project_id).filter((x): x is string => !!x))];
    const projectNames = new Map<string, string>();
    if (projectIds.length > 0) {
      const { data: named } = await supabase.from("proj_projects").select("id, name").in("id", projectIds);
      for (const p of named ?? []) projectNames.set(p.id, p.name);
    }
    custodyDrafts = draftList.map((u) => ({
      id: u.id, code: u.code, itemName: itemById.get(u.item_id)?.name ?? "Equipment", holderKind: u.custody_kind === "project" ? "project" : "employee",
      holderName: u.custody_kind === "employee" ? (employeeNames.get(u.id) ?? null) : (u.project_id ? (projectNames.get(u.project_id) ?? null) : null),
    }));
    projectOptions = (projects.data ?? []).map((p) => ({ id: p.id, name: p.name }));
  }
  const checklist = computeChecklist(facts);

  // --- legacy asset register (founders only) ----------------------------------------------------------------------------------------------
  let legacy: InvLegacyAssetRow[] = [];
  let legacyFailed = false;
  if (founder) {
    const r = await supabase.rpc("inv_preview_legacy_assets", { p_company_id: companyId });
    if (r.error) legacyFailed = true; else legacy = r.data ?? [];
  }

  // --- the open count sheet (side panel) ---------------------------------------------------------------------------------------------------
  const countId = one(sp.count);
  const techParam = one(sp.tech);
  const closeCount = `${withParams("/inventory/manage", sp, { count: null, section: "admin" })}#counts`;
  const closeTech = `${withParams("/inventory/manage", sp, { tech: null, section: "catalogue" })}#technologies`;
  let sheet: React.ReactNode = null;
  if (viewStock && UUID_RE.test(countId)) {
    const { data: c } = await supabase.from("inv_counts").select("*").eq("id", countId).eq("company_id", companyId).maybeSingle();
    if (!c) {
      sheet = <Alert role="status">That count was not found, or it is not available to you.</Alert>;
    } else {
      const [lineRows, balanceRows] = await Promise.all([
        supabase.from("inv_count_lines").select("*").eq("count_id", c.id).order("id"),
        supabase.from("inv_balances").select("item_id, bin_id, condition, qty").eq("company_id", companyId).eq("holder_kind", "warehouse").eq("location_id", c.location_id).is("rental_id", null).limit(5000),
      ]);
      const lines = lineRows.data ?? [];
      const unitIds = lines.map((l) => l.unit_id).filter((x): x is string => !!x);
      const unitCodes = new Map<string, string>();
      if (unitIds.length > 0) {
        const { data } = await supabase.from("inv_units").select("id, code").in("id", unitIds);
        for (const u of data ?? []) unitCodes.set(u.id, u.code);
      }
      const binCode = new Map(binRows.map((b) => [b.id, b.code]));
      const lineViews: SheetLineView[] = lines.map((l) => {
        const it = itemById.get(l.item_id);
        return {
          id: l.id, unitId: l.unit_id, unitCode: l.unit_id ? (unitCodes.get(l.unit_id) ?? null) : null, itemId: l.item_id, itemName: it ? itemLabel(it) : "Item", binId: l.bin_id,
          binCode: l.bin_id ? (binCode.get(l.bin_id) ?? null) : null, condition: l.condition, expected: l.expected_qty === null ? null : Number(l.expected_qty), counted: Number(l.counted_qty),
          reason: l.reason, note: l.note, scale: it?.quantity_scale ?? 0, unitOfMeasure: it?.unit_of_measure ?? "each",
        };
      });
      let notCounted: { id: string; code: string; itemName: string }[] = [];
      if (c.kind === "opening" && c.status === "open") {
        const { data: draftUnits } = await supabase.from("inv_units").select("id, code, item_id").eq("company_id", companyId).eq("location_id", c.location_id).eq("lifecycle", "draft").eq("custody_kind", "warehouse").order("code").limit(300);
        const counted = new Set(unitIds);
        notCounted = (draftUnits ?? []).filter((u) => !counted.has(u.id)).map((u) => ({ id: u.id, code: u.code, itemName: itemById.get(u.item_id)?.name ?? "Equipment" }));
      }
      const countable = itemRows
        .filter((i) => (i.tracking === "quantity" || i.tracking === "consumable") && (c.kind === "opening" ? i.status === "active" : i.status !== "retired"))
        .map((i) => ({ id: i.id, name: itemLabel(i), scale: i.quantity_scale, unitOfMeasure: i.unit_of_measure }));
      const data: CountSheetData = {
        id: c.id, code: c.code, kind: c.kind, status: c.status, note: c.note, locationId: c.location_id, locationName: ctx.locationName(c.location_id),
        startedByName: nameOf(c.started_by) ?? "a colleague", startedAt: c.started_at, confirmedByName: nameOf(c.confirmed_by), confirmedAt: c.confirmed_at,
      };
      sheet = (
        <CountSheet
          key={c.id} closeHref={closeCount} count={data} companyId={companyId} canEdit={canOperateLocation(ctx.grants, companyId, c.location_id, ctx.assignedLocationIds)} canConfirm={confirmer}
          lines={lineViews} items={countable} bins={binRows.filter((b) => b.location_id === c.location_id && b.is_active).map((b) => ({ id: b.id, code: b.code }))}
          balances={(balanceRows.data ?? []).map((b) => ({ itemId: b.item_id, binId: b.bin_id, condition: b.condition, qty: Number(b.qty) }))} notCounted={notCounted}
          draftItemCount={itemRows.filter((i) => (i.tracking === "quantity" || i.tracking === "consumable") && i.status === "draft").length}
        />
      );
    }
  } else if (techParam !== "") {
    const rows = technologies.data ?? [];
    const tech = techParam === "new" ? null : rows.find((t) => t.id === techParam) ?? null;
    if (techParam === "new" || tech) {
      const comps: ComponentDraft[] = tech
        ? (components.data ?? []).filter((x) => x.technology_id === tech.id).map((x) => ({ itemId: x.item_id, qty: String(Number(x.qty)), altGroup: x.alt_group ?? "", isOptional: x.is_optional, note: x.note ?? "" }))
        : [];
      sheet = (
        <TechnologyEditor
          key={tech?.id ?? "new"} closeHref={closeTech} companyId={companyId} canEdit={catalogue}
          technology={{ id: tech?.id ?? null, name: tech?.name ?? "", description: tech?.description ?? "", status: tech?.status ?? "draft", version: tech?.version ?? null }}
          components={comps} items={itemRows.filter((i) => i.status !== "retired").map((i) => ({ id: i.id, label: itemLabel(i), scale: i.quantity_scale }))}
        />
      );
    }
  }

  const technologyRows: TechnologyRow[] = (technologies.data ?? []).map((t) => ({
    id: t.id, name: t.name, description: t.description, status: t.status, updatedAt: t.updated_at, components: (components.data ?? []).filter((x) => x.technology_id === t.id).length,
  }));
  const itemCounts: Record<string, number> = {};
  for (const i of itemRows) if (i.category_id) itemCounts[i.category_id] = (itemCounts[i.category_id] ?? 0) + 1;
  const startable = activeLocations.filter((l) => canOperateLocation(ctx.grants, companyId, l.id, ctx.assignedLocationIds)).map((l) => ({ id: l.id, name: l.name }));
  const locationViews: LocationView[] = locations.map((l) => ({ id: l.id, code: l.code, name: l.name, kind: l.kind, timezone: l.timezone, address: l.address, isActive: l.is_active }));
  const binViews: BinView[] = binRows.map((b) => ({ id: b.id, locationId: b.location_id, code: b.code, label: b.label, isActive: b.is_active }));
  const qtyItems = itemRows.filter((i) => i.tracking === "quantity" && i.status === "active").map((i) => ({ id: i.id, name: itemLabel(i), scale: i.quantity_scale, unitOfMeasure: i.unit_of_measure }));

  // --- the four groups: three for routine setup, in the order it is done, and one for what is needed now and then ---------------------------------
  const base = (patch: Record<string, string | null>) => withParams("/inventory/manage", sp, { count: null, tech: null, counts: null, ...patch });
  const sectionHref = (anchor: string) => `${base({ section: ANCHOR_SECTION[anchor] ?? "warehouses" })}#${anchor}`;
  const steps = checklist.steps.map((st) => (st.href.startsWith("#") ? { ...st, href: sectionHref(st.href.slice(1)) } : st));
  const working = workingWarehouse ? { id: workingWarehouse.id, label: `${workingWarehouse.name} · ${company.name}` } : null;
  const trackingCounts = (["individual", "quantity", "kit", "consumable"] as const).map((t) => ({ t, n: itemRows.filter((i) => i.tracking === t && i.status !== "retired").length }));
  const tabCls = (active: boolean) => cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-accent font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground");

  return (
    <div className="space-y-6" data-section={section} data-company-id={companyId} data-warehouse-id={working?.id ?? ""}>
      <PageHeader
        title="Inventory setup"
        description="Set Inventory up in the order you need it: where stock is kept, what you keep, then getting it in."
        actions={<CompanyPicker companies={allowed.map((c) => ({ id: c.id, name: c.name }))} value={companyId} />}
      />
      <p className="text-sm" data-testid="setup-context">
        <span className="text-muted-foreground">Setting up </span><strong>{company.name}</strong>
        {working ? <><span className="text-muted-foreground"> · working warehouse </span><strong>{workingWarehouse!.name}</strong></> : null}
        <span className="text-muted-foreground">. {allowed.length > 1 ? "Change the company above; " : ""}the warehouse is the one chosen on Today and Stock.</span>
      </p>
      <nav aria-label="Setup sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {SECTIONS.map(([id, label]) => <Link key={id} href={base({ section: id === "warehouses" ? null : id })} scroll={false} aria-current={section === id ? "page" : undefined} className={tabCls(section === id)}>{label}</Link>)}
      </nav>
      {!company.isEnabled && company.referenceCode ? <Alert variant="warning" role="status">Inventory is switched off for {company.name}. Everything is kept and can be read, but nothing can be changed until a founder switches it on.</Alert> : null}
      {!company.referenceCode ? <Alert variant="warning" role="status">No equipment can be registered for {company.name} until a founder sets its reference code. <Link href={sectionHref("settings")} className="font-medium underline underline-offset-2">Set the reference code</Link></Alert> : null}

      {section === "warehouses" ? (
        <>
          <Panel id="locations" title="Warehouses and bins" description={`Where ${company.name} keeps equipment. A warehouse belongs to this company; its bins are inside it.`}>
            <LocationsSection companyId={companyId} locations={locationViews} bins={binViews} isFounder={founder} canEditBins={catalogue} currentId={working?.id ?? null} />
          </Panel>
          <Muted>The company itself (its legal name, reference code and the on/off switch) is a separate record under <Link href={sectionHref("settings")} className="underline underline-offset-2">Administration, Company record</Link>. Next: <Link href={base({ section: "catalogue" })} className="underline underline-offset-2">Catalogue and tracking</Link>.</Muted>
        </>
      ) : null}

      {section === "catalogue" ? (
        <>
          <Panel id="items" title="Items and how they are tracked" description="An item is tracked one way, chosen when it is added. The form asks only for what that way needs.">
            <div className="space-y-4">
              <ul className="grid gap-2 sm:grid-cols-2">
                {trackingCounts.map(({ t, n }) => (
                  <li key={t} className="rounded-md border border-border p-3 text-sm">
                    <p className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-semibold">{TRACKING_WORDS[t].label}</span><Link href={`/inventory/stock?tracking=${t}&company=${companyId}`} className="tabular-nums underline underline-offset-2">{n} item{n === 1 ? "" : "s"}</Link></p>
                    <p className="text-muted-foreground">{TRACKING_WORDS[t].help}</p>
                  </li>
                ))}
              </ul>
              {catalogue ? (
                <div className="flex flex-wrap items-center gap-3">
                  <QuickAddItem companies={[{ id: companyId, name: company.name, categories: (categories.data ?? []).filter((c) => c.is_active).map((c) => ({ id: c.id, label: c.name })) }]} />
                  <span className="text-sm text-muted-foreground">It is added to {company.name}. You are then taken to the item, where Receive stock already names it.</span>
                </div>
              ) : <Muted>Catalogue rights are needed to add or change items.</Muted>}
              {itemRows.length === 0 ? <Muted>No items yet. Add the first item, then go to Getting stock in.</Muted> : facts.draftItems > 0 ? <Muted>{facts.draftItems} item{facts.draftItems === 1 ? " is a draft" : "s are drafts"}: stock cannot be received for a draft until it is put in use from the item itself.</Muted> : null}
            </div>
          </Panel>
          <Panel id="categories" title="Categories" description="How the catalogue is grouped.">
            <CategoriesSection companyId={companyId} categories={(categories.data ?? []).map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id, sortOrder: c.sort_order, isActive: c.is_active }))} itemCounts={itemCounts} canEdit={catalogue} />
          </Panel>
          <Panel id="technologies" title="Technology templates" description="Recipes for what an installation needs: checklists, not stock.">
            <TechnologiesSection rows={technologyRows} canEdit={catalogue} />
          </Panel>
          <Muted>Next: <Link href={base({ section: "stock" })} className="underline underline-offset-2">Getting stock in</Link>.</Muted>
        </>
      ) : null}

      {section === "stock" ? (
        <>
          <Panel id="ways-in" title="Getting stock in" description="Three ways stock enters Inventory. Each one is recorded against one company and one warehouse.">
            <ul className="space-y-3 text-sm">
              <li className="rounded-md border border-border p-3">
                <p className="font-semibold">New stock arrives (bought or rented)</p>
                <p className="text-muted-foreground">Receive stock records it on the shelf and gives individual items their IDs and labels.{working ? ` It opens with ${working.label} already chosen.` : ""}</p>
                {activeLocations.length === 0 ? <p className="mt-2 text-muted-foreground">Add a warehouse first, under <Link href={sectionHref("locations")} className="underline underline-offset-2">Warehouses and bins</Link>.</p>
                  : <Link href={`/inventory/stock?action=receive${working ? `&location=${working.id}` : ""}`} className={cn(buttonVariants({ size: "sm" }), "mt-2 h-11 sm:h-8")}>Receive stock{working ? ` at ${workingWarehouse!.name}` : ""}</Link>}
              </li>
              <li className="rounded-md border border-border p-3">
                <p className="font-semibold">Stock that was already on the shelves when Inventory started</p>
                <p className="text-muted-foreground">Count it once in an opening stock count. Nothing counts as stock until a person allowed to confirm stock confirms it.</p>
                <Link href={sectionHref("counts")} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-2 h-11 sm:h-8")}>Opening stock and counts</Link>
              </li>
              <li className="rounded-md border border-border p-3">
                <p className="font-semibold">Equipment that was already with people or on projects</p>
                <p className="text-muted-foreground">Record it where it is, without bringing it back to the warehouse first.</p>
                <Link href={sectionHref("custody")} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-2 h-11 sm:h-8")}>Equipment already out</Link>
              </li>
            </ul>
          </Panel>
          <GettingStarted checklist={{ ...checklist, steps }} />
          {stockFailed ? <LoadError what="some of the stock figures in the checklist" retryHref={`/inventory/manage?company=${companyId}&section=stock`} /> : null}
        </>
      ) : null}

      {section === "admin" ? (
        <>
          <Muted>Things needed now and then. Each one says what it changes before you confirm it.</Muted>
          <Panel id="settings" title="Company record" description={`${company.name}: the company's legal record for Inventory. Warehouses and bins are set up separately.`}>
            <CompanySettings companyId={companyId} companyName={company.legalName && company.legalName !== company.name ? `${company.legalName} (shown as ${company.name})` : company.name} referenceCode={company.referenceCode} isEnabled={company.isEnabled} isFounder={founder} />
          </Panel>

          <Panel id="sharing" title="Sharing equipment between companies" description="Which other companies may hold or use this company's equipment.">
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Allowing a company lets its warehouses receive transfers of {company.name}&apos;s equipment, and lets that equipment be used there. It never changes who owns it. Stopping it blocks new transfers; equipment already sent can still be received and tracked.</p>
              <p>A founder of {company.name} allows or stops it under <Link href="/people-access" className="font-medium underline underline-offset-2">People &amp; Access, Company settings</Link>, where the companies currently allowed are listed.</p>
            </div>
          </Panel>

          <Panel id="counts" title="Opening stock and counts" description="Count a place, review it, and confirm it.">
            {countsFailed ? <LoadError what="the counts" retryHref={`/inventory/manage?company=${companyId}&section=admin`} /> : <CountsSection companyId={companyId} rows={counts} startable={startable} showAll={one(sp.counts) === "all"} canSeeCounts={viewStock} defaultLocationId={working?.id ?? null} />}
          </Panel>

          <Panel id="custody" title="Record equipment already with employees or on projects" description="Equipment that is already out when Inventory starts.">
            {viewStock ? <OpeningCustody companyId={companyId} units={custodyDrafts} items={qtyItems} projects={projectOptions} canConfirm={confirmer} /> : <Muted>You do not have stock access, so this is not shown to you.</Muted>}
          </Panel>

          <Panel id="corrections" title="Corrections" description="Putting a record right. Nothing is deleted: a correction is a new entry that names the one it corrects.">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>A counted quantity recorded by mistake: open its entry in <Link href="/inventory/history" className="underline underline-offset-2">History</Link> and use Correct this entry (people who may confirm stock).</li>
              <li>Missing, found or written-off equipment, repairs and inspections: open the item or unit in <Link href="/inventory/stock" className="underline underline-offset-2">Stock</Link> and use its actions.</li>
              <li>A difference found while counting: a cycle count above records it with a reason when it is confirmed.</li>
            </ul>
          </Panel>

          {founder ? (
            <Panel id="legacy" title="Earlier asset register" description="The HR Assets register that existed before Inventory. Founders only.">
              {legacyFailed ? <LoadError what="the HR asset register" retryHref={`/inventory/manage?company=${companyId}&section=admin#legacy`} /> : (
                <LegacyImport
                  companyId={companyId} rows={legacy} locations={activeLocations.map((l) => ({ id: l.id, label: l.name }))}
                  items={itemRows.filter((i) => i.tracking === "individual" && i.status !== "retired").map((i) => ({ id: i.id, label: itemLabel(i) }))}
                />
              )}
            </Panel>
          ) : null}
        </>
      ) : null}

      <Muted>Who can use Inventory is managed under <Link href="/people-access" className="underline underline-offset-2">People & Access</Link>.</Muted>
      {sheet}
    </div>
  );
}

const SECTIONS = [["warehouses", "Warehouses and bins"], ["catalogue", "Catalogue and tracking"], ["stock", "Getting stock in"], ["admin", "Administration"]] as const;
type SectionId = (typeof SECTIONS)[number][0];
/** Which group each part of Setup lives in (a link to `#counts` has to open Administration first). */
const ANCHOR_SECTION: Record<string, SectionId> = {
  locations: "warehouses", items: "catalogue", categories: "catalogue", technologies: "catalogue", "getting-started": "stock", "ways-in": "stock",
  settings: "admin", sharing: "admin", counts: "admin", custody: "admin", corrections: "admin", legacy: "admin",
};
