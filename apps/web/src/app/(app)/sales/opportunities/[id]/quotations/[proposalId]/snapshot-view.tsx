import { NOTE_HEADINGS, estimateFormatVersion, reviewPricingSentence, type QuotationSnapshot } from "@enginious-hr/domain";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import { modelFromSnapshot } from "@/lib/crm/quotations/export/doc-model";
import { money } from "./money";

/**
 * The frozen, client-facing copy of a finalised estimate, exactly as stored. Read-only: nothing here can be edited. An estimate is shown from the same document
 * model as its PDF and Excel file (so the screen cannot disagree with them); a quotation issued before the estimates-only change is shown as it was frozen.
 */
export function SnapshotView({ s }: { s: QuotationSnapshot }) {
  return estimateFormatVersion(s.terms?.label) !== null ? <EstimateSnapshot s={s} /> : <LegacySnapshot s={s} />;
}

function EstimateSnapshot({ s }: { s: QuotationSnapshot }) {
  const m = modelFromSnapshot(s);
  const cur = s.currency;
  return (
    <div className="space-y-5 text-sm" data-testid="issued-snapshot">
      <div className="rounded-md border border-[#C7A24B] bg-[#FBF5E3] p-3 text-[#2b2412] dark:bg-[#3a3015] dark:text-[#f5ecd0]" data-testid="notice-preview">
        <p className="text-xs font-semibold uppercase tracking-wide">Budgetary estimate</p>
        <p className="mt-1">{m.notice}</p>
      </div>
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Prepared by</dt><dd className="font-medium">{s.issuer.legal_name}</dd>
          <dd className="text-muted-foreground">{[s.issuer.trn ? `TRN ${s.issuer.trn}` : null, s.issuer.address, s.issuer.phone, s.issuer.email, s.issuer.website].filter(Boolean).join(" · ") || "No further company details recorded"}</dd></div>
        <div><dt className="text-muted-foreground">Prepared for</dt><dd className="font-medium">{s.bill_to.name}</dd>
          <dd className="text-muted-foreground">{[s.bill_to.address, s.bill_to.country_code ? countryLabel(s.bill_to.country_code) : null, s.bill_to.vat_trn ? `VAT / TRN ${s.bill_to.vat_trn}` : null, s.bill_to.trade_licence_no ? `Trade licence ${s.bill_to.trade_licence_no}` : null].filter(Boolean).join(" · ")}</dd></div>
        <div><dt className="text-muted-foreground">Reference</dt><dd>{s.reference} · revision {s.revision}</dd></div>
        <div><dt className="text-muted-foreground">Finalised on</dt><dd>{s.issue_date}{s.validity_date ? ` · ${reviewPricingSentence(s.validity_date)}` : ""}</dd></div>
        <div><dt className="text-muted-foreground">Currency / VAT</dt><dd>{cur} · {s.vat.label}</dd></div>
      </dl>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-left">
          <thead className="text-muted-foreground"><tr><th className="px-3 py-1.5">#</th><th>Description</th><th>Unit</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Excl. VAT</th><th className="text-right">VAT</th><th className="px-3 text-right">Incl. VAT</th></tr></thead>
          <tbody>
            {m.sections.map((sec, si) => (
              <SectionRows key={si} sec={sec} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-right text-base font-semibold tabular-nums">Total {money(s.totals.gross, cur)} <span className="text-sm font-normal text-muted-foreground">({money(s.totals.net)} excl. VAT + {money(s.totals.vat)} VAT)</span></p>
      {m.milestones.length ? (
        <div><h3 className="font-semibold">Indicative payment schedule</h3>
          <ul className="mt-1 space-y-0.5">{m.milestones.map((x) => <li key={x.label}>{x.label}: {x.kind === "percent" ? `${x.value}% = ` : ""}{money(x.amount, cur)}{x.due ? ` · ${x.due}` : ""}</li>)}</ul></div>
      ) : null}
      {m.clientNotes.assumptions.length ? <div><h3 className="font-semibold">{NOTE_HEADINGS.assumptions}</h3>{m.clientNotes.assumptions.map((p, i) => <p key={i} className="mt-1 whitespace-pre-wrap">{p}</p>)}</div> : null}
      {m.exclusions.length ? (
        <div><h3 className="font-semibold">{NOTE_HEADINGS.exclusions}</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5">{m.exclusions.map((c) => <li key={c.title}><strong>{c.title}.</strong> {c.body}</li>)}</ol></div>
      ) : null}
      {m.clientNotes.nextSteps.length ? <div><h3 className="font-semibold">{NOTE_HEADINGS.nextSteps}</h3>{m.clientNotes.nextSteps.map((p, i) => <p key={i} className="mt-1 whitespace-pre-wrap">{p}</p>)}</div> : null}
    </div>
  );
}

function SectionRows({ sec }: { sec: ReturnType<typeof modelFromSnapshot>["sections"][number] }) {
  return (
    <>
      {sec.title !== null ? <tr className="border-t border-border bg-secondary/40 font-semibold"><td colSpan={8} className="px-3 py-1.5">{sec.number} {sec.title}</td></tr> : null}
      {sec.lines.map((l) => (
        <tr key={l.number} className="border-t border-border/70 align-top">
          <td className="px-3 py-1.5 tabular-nums">{l.number}</td>
          <td className="whitespace-pre-wrap break-words py-1.5 pr-2">{l.description}{l.image ? <span className="block text-muted-foreground">Photo attached</span> : null}</td>
          <td>{l.unit ?? ""}</td>
          <td className="text-right tabular-nums">{l.quantity}</td>
          <td className="text-right tabular-nums">{money(l.unitPrice)}</td>
          <td className="text-right tabular-nums">{money(l.net)}</td>
          <td className="text-right tabular-nums">{money(l.vatAmount)} <span className="text-muted-foreground">({l.vatLabel})</span></td>
          <td className="px-3 text-right tabular-nums">{money(l.gross)}</td>
        </tr>
      ))}
      {sec.title !== null ? <tr className="border-t border-border font-medium"><td colSpan={5} className="px-3 py-1.5 text-right">Subtotal</td><td className="text-right tabular-nums">{money(sec.subtotalNet)}</td><td className="text-right tabular-nums">{money(sec.subtotalVat)}</td><td className="px-3 text-right tabular-nums">{money(sec.subtotalGross)}</td></tr> : null}
    </>
  );
}

/** A quotation frozen before the estimates-only change, shown exactly as it was frozen. */
function LegacySnapshot({ s }: { s: QuotationSnapshot }) {
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
