import type { QuotationSnapshot } from "@enginious-hr/domain";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import { money } from "./money";

/** The frozen, client-facing copy of an issued quotation, exactly as stored. Read-only: nothing here can be edited. */
export function SnapshotView({ s }: { s: QuotationSnapshot }) {
  const cur = s.currency;
  return (
    <div className="space-y-5 text-sm" data-testid="issued-snapshot">
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Issued by</dt><dd className="font-medium">{s.issuer.legal_name}</dd>
          <dd className="text-muted-foreground">{[s.issuer.trn ? `TRN ${s.issuer.trn}` : null, s.issuer.address, s.issuer.phone, s.issuer.email, s.issuer.website].filter(Boolean).join(" · ") || "No further company details recorded"}</dd></div>
        <div><dt className="text-muted-foreground">Billed to</dt><dd className="font-medium">{s.bill_to.name}</dd>
          <dd className="text-muted-foreground">{[s.bill_to.address, s.bill_to.country_code ? countryLabel(s.bill_to.country_code) : null, s.bill_to.vat_trn ? `VAT / TRN ${s.bill_to.vat_trn}` : null, s.bill_to.trade_licence_no ? `Trade licence ${s.bill_to.trade_licence_no}` : null].filter(Boolean).join(" · ")}</dd></div>
        <div><dt className="text-muted-foreground">Reference</dt><dd>{s.reference} · revision {s.revision}</dd></div>
        <div><dt className="text-muted-foreground">Issue date / valid until</dt><dd>{s.issue_date}{s.validity_date ? ` · valid until ${s.validity_date}` : ""}</dd></div>
        <div><dt className="text-muted-foreground">Currency / VAT</dt><dd>{cur} · {s.vat.label}</dd></div>
      </dl>
      {s.sections.map((sec) => (
        <section key={sec.title} aria-label={sec.title} className="overflow-x-auto rounded-lg border border-border">
          <h3 className="border-b border-border bg-secondary/40 px-3 py-2 font-semibold">{sec.number} {sec.title}</h3>
          <table className="w-full min-w-[40rem] text-left">
            <thead className="text-muted-foreground"><tr><th className="px-3 py-1.5">#</th><th>Description</th><th>Unit</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Excl. VAT</th><th className="text-right">VAT</th><th className="px-3 text-right">Incl. VAT</th></tr></thead>
            <tbody>
              {sec.lines.map((l) => (
                <tr key={l.number} className="border-t border-border/70 align-top">
                  <td className="px-3 py-1.5 tabular-nums">{l.number}</td>
                  <td className="whitespace-pre-wrap break-words py-1.5 pr-2">{l.description}{l.image ? <span className="block text-muted-foreground">Picture: {l.image.original_name}</span> : null}</td>
                  <td>{l.unit ?? ""}</td>
                  <td className="text-right tabular-nums">{l.quantity}</td>
                  <td className="text-right tabular-nums">{money(l.unit_price)}</td>
                  <td className="text-right tabular-nums">{money(l.amount_net)}</td>
                  <td className="text-right tabular-nums">{money(l.vat_amount)} <span className="text-muted-foreground">({l.vat.label})</span></td>
                  <td className="px-3 text-right tabular-nums">{money(l.amount_gross)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-medium"><td colSpan={5} className="px-3 py-1.5 text-right">Subtotal</td><td className="text-right tabular-nums">{money(sec.subtotal_net)}</td><td className="text-right tabular-nums">{money(sec.subtotal_vat)}</td><td className="px-3 text-right tabular-nums">{money(sec.subtotal_gross)}</td></tr>
            </tbody>
          </table>
        </section>
      ))}
      <p className="text-right text-base font-semibold tabular-nums">Total {money(s.totals.gross, cur)} <span className="text-sm font-normal text-muted-foreground">({money(s.totals.net)} excl. VAT + {money(s.totals.vat)} VAT)</span></p>
      {s.milestones.length ? (
        <div><h3 className="font-semibold">Payment milestones</h3>
          <ul className="mt-1 space-y-0.5">{s.milestones.map((m) => <li key={m.label}>{m.label}: {m.kind === "percent" ? `${m.value}% = ` : ""}{money(m.amount, cur)}{m.due ? ` · ${m.due}` : ""}</li>)}</ul></div>
      ) : null}
      {s.exclusions?.length ? (
        <div><h3 className="font-semibold">Exclusions</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5">{s.exclusions.map((c) => <li key={c.title}><strong>{c.title}.</strong> {c.body}</li>)}</ol></div>
      ) : null}
      {s.terms.clauses.length ? (
        <div><h3 className="font-semibold">{s.terms.label ?? "Terms and conditions"}</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5">{s.terms.clauses.map((c) => <li key={c.title}><strong>{c.title}.</strong> {c.body}</li>)}</ol></div>
      ) : null}
    </div>
  );
}
