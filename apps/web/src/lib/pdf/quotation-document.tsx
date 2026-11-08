import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, Link, StyleSheet, Font } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { NOTE_HEADINGS, reviewPricingSentence } from "@enginious-hr/domain";
import { docTitle, groupMoney, issuerHeaderLines, milestoneValueText, vatRateText, type DocLine, type QuotationDocModel } from "@/lib/crm/quotations/export/doc-model";
import type { ExportAssets } from "@/lib/crm/quotations/export/images";

/**
 * The client-facing quotation PDF. It renders ONLY a `QuotationDocModel`: an issued revision's frozen snapshot, or a draft marked DRAFT on every page. Same
 * ENGINIOUS logo, Carlito fonts and colours as the plan, letter and dispatch-note PDFs (read through process.cwd() so the build traces them). It cannot print
 * internal notes, costs or margin: the model has no such field.
 */
Font.registerHyphenationCallback((word) => [word]);

const BRAND_DIR = path.join(process.cwd(), "public", "brand");
const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");
const BRAND_LOGO = `data:image/png;base64,${readFileSync(path.join(BRAND_DIR, "enginious-logo.png")).toString("base64")}`;

Font.register({
  family: "Carlito",
  fonts: [
    { src: path.join(FONT_DIR, "Carlito-Regular.ttf"), fontWeight: "normal" },
    { src: path.join(FONT_DIR, "Carlito-Bold.ttf"), fontWeight: "bold" },
  ],
});

/** Photo area of an estimate row, in PDF points (1 pt = 0.3528 mm): 120 x 88 pt = 42.3 x 31.0 mm, above the 40 x 30 mm target, inside a 128 pt column. */
export const ESTIMATE_PHOTO = { column: 128, width: 120, height: 88, row: 96 } as const;
const C = { brand: "#1C5C6B", ink: "#0A202A", muted: "#4A5D66", line: "#C9D3D7", band: "#EEF3F4", section: "#DCE8EB", draft: "#B42318" };
const W = { no: 30, image: 56, unit: 38, qty: 40, price: 64, net: 68, rate: 46, vat: 62, gross: 72 };

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 46, paddingHorizontal: 30, fontSize: 9, fontFamily: "Carlito", color: C.ink },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  logo: { width: 110, height: 68, objectFit: "contain", marginBottom: 4 },
  issuer: { maxWidth: 330 },
  issuerName: { fontSize: 11, fontWeight: "bold" },
  muted: { color: C.muted },
  headRight: { alignItems: "flex-end" },
  title: { fontSize: 22, fontWeight: "bold", color: C.brand },
  ref: { fontSize: 12, fontWeight: "bold", marginTop: 2 },
  boxes: { flexDirection: "row", marginBottom: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 7 },
  box: { flex: 1, paddingRight: 12 },
  boxTitle: { fontSize: 8.5, color: C.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 },
  boxName: { fontSize: 11, fontWeight: "bold", marginBottom: 1 },
  th: { flexDirection: "row", backgroundColor: C.brand, color: "#FFFFFF", fontWeight: "bold", fontSize: 8.5 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: C.line, minHeight: 20 },
  secRow: { flexDirection: "row", backgroundColor: C.section, borderBottomWidth: 0.5, borderColor: C.line },
  subRow: { flexDirection: "row", backgroundColor: C.band, borderBottomWidth: 0.5, borderColor: C.line },
  cNo: { width: W.no, padding: 3 },
  cDesc: { flex: 1, padding: 3 },
  cImg: { width: W.image, padding: 3, alignItems: "center", justifyContent: "center" },
  cUnit: { width: W.unit, padding: 3 },
  cQty: { width: W.qty, padding: 3, textAlign: "right" },
  cPrice: { width: W.price, padding: 3, textAlign: "right" },
  cNet: { width: W.net, padding: 3, textAlign: "right" },
  cRate: { width: W.rate, padding: 3, textAlign: "right" },
  cVat: { width: W.vat, padding: 3, textAlign: "right" },
  cGross: { width: W.gross, padding: 3, textAlign: "right" },
  thumb: { width: 46, height: 46, objectFit: "contain" },
  bold: { fontWeight: "bold" },
  totals: { alignSelf: "flex-end", width: 260, marginTop: 8, borderTopWidth: 1, borderColor: C.line, paddingTop: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  totalBig: { fontSize: 11.5, fontWeight: "bold", color: C.brand },
  h2: { fontSize: 12, fontWeight: "bold", color: C.brand, marginTop: 12, marginBottom: 4 },
  clauseTitle: { fontWeight: "bold", marginTop: 5 },
  clauseBody: { marginTop: 1, lineHeight: 1.25 },
  note: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  banner: { position: "absolute", top: 10, left: 30, right: 30, textAlign: "center", fontSize: 9, fontWeight: "bold", color: C.draft },
  watermark: { position: "absolute", top: 190, left: 150, width: 560, textAlign: "center", fontSize: 130, fontWeight: "bold", color: "#E9B5B0", opacity: 0.35, transform: "rotate(-24deg)" },
  footer: { position: "absolute", bottom: 18, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", fontSize: 8.5, color: C.muted, borderTopWidth: 0.5, borderColor: C.line, paddingTop: 5 },
});

/** Issuer branding layout (estimate-format:2 and drafts): logo left, issuer block right-aligned with the estimate title block under it; one footer band with a rule. */
const B = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  logo: { width: 150, height: 74, objectFit: "contain", objectPosition: "left top" },
  right: { alignItems: "flex-end", maxWidth: 420 },
  name: { fontSize: 12, fontWeight: "bold", textAlign: "right" },
  addr: { fontSize: 9, color: C.muted, textAlign: "right" },
  trn: { fontSize: 8.5, textAlign: "right" },
  titleBlock: { alignItems: "flex-end", marginTop: 6 },
  title: { fontSize: 18, fontWeight: "bold", color: C.brand },
  footer: { position: "absolute", bottom: 18, left: 30, right: 30, flexDirection: "row", alignItems: "flex-start", fontSize: 8, color: C.muted, borderTopWidth: 0.5, borderColor: C.line, paddingTop: 5 },
  fLeft: { width: 235 },
  fMid: { flex: 1, textAlign: "center" },
  fRight: { width: 70, textAlign: "right" },
  link: { color: C.brand, textDecoration: "underline" },
});

const money = (v: string) => groupMoney(v);
const qty = (v: string) => v;

function Marks({ model }: { model: QuotationDocModel }): ReactNode {
  return (
    <>
      {model.draft ? <Text style={s.banner} fixed>DRAFT, NOT ISSUED. This estimate has not been issued and must not be sent to the client as a quotation.</Text> : null}
      {model.draft ? <Text style={s.watermark} fixed>DRAFT</Text> : null}
      <View style={s.footer} fixed>
        <Text>{model.issuer.legalName} · {model.reference} · Revision {model.revision}{model.draft ? " · DRAFT" : ""}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </>
  );
}

function IssuerBlock({ model, assets }: { model: QuotationDocModel; assets: ExportAssets }) {
  const i = model.issuer;
  const logo = assets.logo ? { data: assets.logo.data, format: assets.logo.format } : BRAND_LOGO;
  const contact = [i.phone, i.email, i.website].filter(Boolean).join("  ·  ");
  return (
    <View style={s.issuer}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive (renders into a PDF, not the DOM); it has no alt prop. */}
      <Image src={logo} style={s.logo} />
      <Text style={s.issuerName}>{i.legalName}</Text>
      {i.trn ? <Text>TRN {i.trn}</Text> : null}
      {i.address ? <Text style={s.muted}>{i.address}</Text> : null}
      {contact ? <Text style={s.muted}>{contact}</Text> : null}
    </View>
  );
}

function Row({ l, images }: { l: DocLine; images: ExportAssets["images"] }) {
  const img = l.image ? images.get(l.image.key) : undefined;
  return (
    <View style={s.tr} wrap={false}>
      <Text style={s.cNo}>{l.number}</Text>
      <Text style={s.cDesc}>{l.description}</Text>
      <View style={s.cImg}>
        {img ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive (renders into a PDF, not the DOM); it has no alt prop.
          <Image src={{ data: img.data, format: img.format }} style={s.thumb} />
        ) : null}
      </View>
      <Text style={s.cUnit}>{l.unit ?? ""}</Text>
      <Text style={s.cQty}>{qty(l.quantity)}</Text>
      <Text style={s.cPrice}>{money(l.unitPrice)}</Text>
      <Text style={s.cNet}>{money(l.net)}</Text>
      <Text style={s.cRate}>{vatRateText(l)}</Text>
      <Text style={s.cVat}>{money(l.vatAmount)}</Text>
      <Text style={s.cGross}>{money(l.gross)}</Text>
    </View>
  );
}

export interface QuotationDocumentProps { model: QuotationDocModel; assets: ExportAssets }

/** A legacy (pre-estimates) snapshot renders exactly as it was issued; everything else is an estimate. */
export function QuotationDocument({ model, assets }: QuotationDocumentProps) {
  return model.format === "legacy" ? <LegacyDocument model={model} assets={assets} /> : <EstimateDocument model={model} assets={assets} />;
}

function LegacyDocument({ model, assets }: QuotationDocumentProps) {
  const cur = model.currency;
  const b = model.billTo;
  const hasBack = model.milestones.length > 0 || model.terms.clauses.length > 0 || model.exclusions.length > 0;
  return (
    <Document title={docTitle(model)} author={model.issuer.legalName} subject={model.enquiryTitle}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Marks model={model} />
        <View style={s.head}>
          <IssuerBlock model={model} assets={assets} />
          <View style={s.headRight}>
            <Text style={s.title}>{model.draft ? "Quotation (DRAFT)" : "Quotation"}</Text>
            <Text style={s.ref}>{model.reference}</Text>
            <Text>Revision {model.revision}</Text>
            <Text style={s.muted}>{model.issueDate ? `Issue date: ${model.issueDate}` : "Issue date: not issued yet"}</Text>
            <Text style={s.muted}>{model.validityDate ? `Valid until: ${model.validityDate}` : "Validity: not set"}</Text>
          </View>
        </View>
        <View style={s.boxes}>
          <View style={s.box}>
            <Text style={s.boxTitle}>Bill to</Text>
            <Text style={s.boxName}>{b.name}</Text>
            {[b.place, b.country].filter(Boolean).length ? <Text style={s.muted}>{[b.place, b.country].filter(Boolean).join(", ")}</Text> : null}
            {b.vatTrn ? <Text>VAT registration number / TRN: {b.vatTrn}</Text> : null}
            {b.tradeLicence ? <Text>Trade licence number: {b.tradeLicence}</Text> : null}
          </View>
          <View style={s.box}>
            <Text style={s.boxTitle}>Project / enquiry</Text>
            <Text style={s.boxName}>{model.enquiryTitle}</Text>
            <Text style={s.muted}>Enquiry {model.enquiryReference}</Text>
            <Text style={s.muted}>{cur ? `All amounts in ${cur}` : "Currency not chosen yet"}</Text>
          </View>
        </View>

        {/* The header row is `fixed`: react-pdf repeats it at the top of every page of this (the BOQ) page group. The terms are in a separate Page so it does not repeat there. */}
        <View style={s.th} fixed>
          <Text style={s.cNo}>#</Text>
          <Text style={s.cDesc}>Description</Text>
          <Text style={[s.cImg, { alignItems: "center" }]}>Image</Text>
          <Text style={s.cUnit}>Unit</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cPrice}>Unit price</Text>
          <Text style={s.cNet}>Excl. VAT</Text>
          <Text style={s.cRate}>VAT rate</Text>
          <Text style={s.cVat}>VAT amount</Text>
          <Text style={s.cGross}>Incl. VAT</Text>
        </View>
        {model.sections.map((sec, si) => (
          <View key={si}>
            <View style={s.secRow} wrap={false} minPresenceAhead={60}>
              <Text style={[s.cDesc, s.bold, { paddingLeft: 6 }]}>{sec.number} {sec.title}</Text>
            </View>
            {sec.lines.map((l) => <Row key={l.number} l={l} images={assets.images} />)}
            <View style={s.subRow} wrap={false}>
              <Text style={[s.cDesc, s.bold, { textAlign: "right" }]}>Subtotal: {sec.number} {sec.title}</Text>
              <Text style={[s.cNet, s.bold]}>{money(sec.subtotalNet)}</Text>
              <Text style={s.cRate}></Text>
              <Text style={[s.cVat, s.bold]}>{money(sec.subtotalVat)}</Text>
              <Text style={[s.cGross, s.bold]}>{money(sec.subtotalGross)}</Text>
            </View>
          </View>
        ))}
        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}><Text>Total excl. VAT</Text><Text>{cur ? `${cur} ` : ""}{money(model.totals.net)}</Text></View>
          <View style={s.totalRow}><Text>VAT</Text><Text>{cur ? `${cur} ` : ""}{money(model.totals.vat)}</Text></View>
          <View style={[s.totalRow, { borderTopWidth: 1, borderColor: C.line, marginTop: 2, paddingTop: 3 }]}><Text style={s.totalBig}>Total incl. VAT</Text><Text style={s.totalBig}>{cur ? `${cur} ` : ""}{money(model.totals.gross)}</Text></View>
        </View>
        <Text style={s.note}>{model.validityDate ? `This quotation is valid until ${model.validityDate}.` : ""}</Text>
      </Page>

      {hasBack ? (
        <Page size="A4" orientation="landscape" style={s.page}>
          <Marks model={model} />
          {model.milestones.length > 0 ? (
            <View wrap={false}>
              <Text style={s.h2}>Payment milestones</Text>
              <View style={[s.th, { width: 560 }]}>
                <Text style={[s.cDesc, { flex: 3 }]}>Milestone</Text><Text style={[s.cDesc, { flex: 2 }]}>Due</Text><Text style={[s.cNet, { width: 80 }]}>Share</Text><Text style={[s.cGross, { width: 110 }]}>Amount incl. VAT</Text>
              </View>
              {model.milestones.map((m, i) => (
                <View key={i} style={[s.tr, { width: 560 }]} wrap={false}>
                  <Text style={[s.cDesc, { flex: 3 }]}>{m.label}</Text><Text style={[s.cDesc, { flex: 2 }]}>{m.due ?? ""}</Text>
                  <Text style={[s.cNet, { width: 80 }]}>{m.kind === "percent" ? milestoneValueText(m, cur) : ""}</Text>
                  <Text style={[s.cGross, { width: 110 }]}>{cur ? `${cur} ` : ""}{money(m.amount)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {model.exclusions.length > 0 ? (
            <View>
              <Text style={s.h2}>Exclusions</Text>
              {model.exclusions.map((c, i) => (
                <View key={i} minPresenceAhead={40}>
                  <Text style={s.clauseTitle}>{i + 1}. {c.title}</Text>
                  <Text style={s.clauseBody}>{c.body}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {model.terms.clauses.length > 0 ? (
            <View>
              <Text style={s.h2}>Terms and conditions</Text>
              {model.terms.label ? <Text style={s.note}>{model.terms.label}</Text> : null}
              {model.terms.clauses.map((c, i) => (
                <View key={i} minPresenceAhead={40}>
                  <Text style={s.clauseTitle}>{i + 1}. {c.title}</Text>
                  <Text style={s.clauseBody}>{c.body}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Page>
      ) : null}
    </Document>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Estimate format
// ---------------------------------------------------------------------------------------------------------------------------------
const E = StyleSheet.create({
  notice: { borderWidth: 1, borderColor: "#C7A24B", backgroundColor: "#FBF5E3", padding: 7, marginBottom: 9 },
  noticeTitle: { fontSize: 9, fontWeight: "bold", color: "#6B4F0A", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
  noticeText: { fontSize: 9.5, lineHeight: 1.3 },
  cImg: { width: ESTIMATE_PHOTO.column, padding: 4, alignItems: "center", justifyContent: "center" },
  photo: { width: ESTIMATE_PHOTO.width, height: ESTIMATE_PHOTO.height, objectFit: "contain" },
  totalsBox: { alignSelf: "flex-end", width: 290, marginTop: 10, borderWidth: 1, borderColor: C.brand, backgroundColor: C.band, paddingHorizontal: 9, paddingVertical: 6 },
  review: { fontSize: 9, color: C.muted, marginTop: 5, alignSelf: "flex-end" },
  para: { fontSize: 9.5, lineHeight: 1.3, marginBottom: 4 },
});

function EstimateMarks({ model }: { model: QuotationDocModel }): ReactNode {
  return (
    <>
      {model.draft ? <Text style={s.banner} fixed>DRAFT, NOT FINALISED. This estimate has not been finalised and must not be sent to the client.</Text> : null}
      {model.draft ? <Text style={s.watermark} fixed>DRAFT</Text> : null}
      <View style={s.footer} fixed>
        <Text>{model.issuer.legalName} · Estimate {model.reference} · Revision {model.revision}{model.draft ? " · DRAFT" : ""}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </>
  );
}

/** The sales enquiries line: the fixed label, then phone, email and website as stored; the website is a real link only when it normalises to an https URL. */
function SalesLine({ model }: { model: QuotationDocModel }): ReactNode {
  const c = model.salesContact;
  if (!c) return null;
  return (
    <Text style={B.fMid}>
      {c.label}{" "}
      {c.parts.map((p, i) => (
        <Text key={p.kind}>
          {i > 0 ? " · " : ""}
          {p.href ? <Link src={p.href} style={B.link}>{p.text}</Link> : p.text}
        </Text>
      ))}
    </Text>
  );
}

function BrandedMarks({ model }: { model: QuotationDocModel }): ReactNode {
  return (
    <>
      {model.draft ? <Text style={s.banner} fixed>DRAFT, NOT FINALISED. This estimate has not been finalised and must not be sent to the client.</Text> : null}
      {model.draft ? <Text style={s.watermark} fixed>DRAFT</Text> : null}
      <View style={B.footer} fixed>
        <Text style={B.fLeft}>{model.issuer.legalName} · Estimate {model.reference} · Revision {model.revision}{model.draft ? " · DRAFT" : ""}</Text>
        {model.salesContact ? <SalesLine model={model} /> : <Text style={B.fMid}> </Text>}
        <Text style={B.fRight} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </>
  );
}

/** The top band of a branded estimate: the profile's logo on the left (nothing when the profile has none), the issuer block right-aligned, the estimate title block under it. */
function BrandedHead({ model, assets }: QuotationDocumentProps) {
  const h = issuerHeaderLines(model);
  return (
    <View style={B.head}>
      <View>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive (renders into a PDF, not the DOM); it has no alt prop. */}
        {assets.logo ? <Image src={{ data: assets.logo.data, format: assets.logo.format }} style={B.logo} /> : null}
      </View>
      <View style={B.right}>
        <Text style={B.name}>{h.name}</Text>
        {h.address.map((l, i) => <Text key={i} style={B.addr}>{l}</Text>)}
        {h.trn ? <Text style={B.trn}>{h.trn}</Text> : null}
        <View style={B.titleBlock}>
          <Text style={B.title}>{model.draft ? "Estimate (DRAFT)" : "Estimate"}</Text>
          <Text style={s.ref}>{model.reference}</Text>
          <Text>Revision {model.revision}</Text>
          <Text style={s.muted}>{model.issueDate ? `Finalised on: ${model.issueDate}` : "Not finalised yet"}</Text>
          {model.validityDate ? <Text style={s.muted}>Review pricing after: {model.validityDate}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function EstimateRow({ l, images }: { l: DocLine; images: ExportAssets["images"] }) {
  const img = l.image ? images.get(l.image.key) : undefined;
  return (
    <View style={[s.tr, img ? { minHeight: ESTIMATE_PHOTO.row } : {}]} wrap={false}>
      <Text style={s.cNo}>{l.number}</Text>
      <Text style={s.cDesc}>{l.description}</Text>
      <View style={E.cImg}>
        {img ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive (renders into a PDF, not the DOM); it has no alt prop.
          <Image src={{ data: img.data, format: img.format }} style={E.photo} />
        ) : null}
      </View>
      <Text style={s.cUnit}>{l.unit ?? ""}</Text>
      <Text style={s.cQty}>{qty(l.quantity)}</Text>
      <Text style={s.cPrice}>{money(l.unitPrice)}</Text>
      <Text style={s.cNet}>{money(l.net)}</Text>
      <Text style={s.cRate}>{vatRateText(l)}</Text>
      <Text style={s.cVat}>{money(l.vatAmount)}</Text>
      <Text style={s.cGross}>{money(l.gross)}</Text>
    </View>
  );
}

/**
 * A heading with its text: the heading and the FIRST paragraph are one unbreakable group, so a heading never ends a page; the other paragraphs wrap naturally
 * (orphans and widows kept at two lines). An empty block prints nothing, not even its heading.
 */
function NoteBlock({ heading, paragraphs }: { heading: string; paragraphs: string[] }): ReactNode {
  const [first, ...rest] = paragraphs;
  if (first === undefined) return null;
  return (
    <View>
      <View wrap={false}>
        <Text style={s.h2}>{heading}</Text>
        <Text style={E.para} orphans={2} widows={2}>{first}</Text>
      </View>
      {rest.map((p, i) => <Text key={i} style={E.para} orphans={2} widows={2}>{p}</Text>)}
    </View>
  );
}

function EstimateDocument({ model, assets }: QuotationDocumentProps) {
  const cur = model.currency;
  const b = model.billTo;
  return (
    <Document title={docTitle(model)} author={model.issuer.legalName} subject={model.enquiryTitle}>
      <Page size="A4" orientation="landscape" style={s.page}>
        {model.branded ? <BrandedMarks model={model} /> : <EstimateMarks model={model} />}
        {model.branded ? <BrandedHead model={model} assets={assets} /> : (
          <View style={s.head}>
            <IssuerBlock model={model} assets={assets} />
            <View style={s.headRight}>
              <Text style={s.title}>{model.draft ? "Estimate (DRAFT)" : "Estimate"}</Text>
              <Text style={s.ref}>{model.reference}</Text>
              <Text>Revision {model.revision}</Text>
              <Text style={s.muted}>{model.issueDate ? `Finalised on: ${model.issueDate}` : "Not finalised yet"}</Text>
              {model.validityDate ? <Text style={s.muted}>Review pricing after: {model.validityDate}</Text> : null}
            </View>
          </View>
        )}
        <View style={s.boxes}>
          <View style={s.box}>
            <Text style={s.boxTitle}>Prepared for</Text>
            <Text style={s.boxName}>{b.name}</Text>
            {[b.place, b.country].filter(Boolean).length ? <Text style={s.muted}>{[b.place, b.country].filter(Boolean).join(", ")}</Text> : null}
            {b.vatTrn ? <Text>VAT registration number / TRN: {b.vatTrn}</Text> : null}
            {b.tradeLicence ? <Text>Trade licence number: {b.tradeLicence}</Text> : null}
          </View>
          <View style={s.box}>
            <Text style={s.boxTitle}>Project / enquiry</Text>
            <Text style={s.boxName}>{model.enquiryTitle}</Text>
            <Text style={s.muted}>Enquiry {model.enquiryReference}</Text>
            <Text style={s.muted}>{cur ? `All amounts in ${cur}` : "Currency not chosen yet"}</Text>
          </View>
        </View>

        {/* The mandatory notice: a constant of the domain package, in the page flow BEFORE the BOQ, so it is on page one however long the BOQ is. No editor can remove it. */}
        <View style={E.notice} wrap={false}>
          <Text style={E.noticeTitle}>Budgetary estimate</Text>
          <Text style={E.noticeText}>{model.notice}</Text>
        </View>

        {/* The header row is `fixed` inside the table's own View, so it repeats on every page the BOQ spans and nowhere else. */}
        <View>
          <View style={s.th} fixed>
            <Text style={s.cNo}>#</Text>
            <Text style={s.cDesc}>Description</Text>
            <Text style={[E.cImg, { textAlign: "center" }]}>Photo</Text>
            <Text style={s.cUnit}>Unit</Text>
            <Text style={s.cQty}>Qty</Text>
            <Text style={s.cPrice}>Unit price</Text>
            <Text style={s.cNet}>Excl. VAT</Text>
            <Text style={s.cRate}>VAT rate</Text>
            <Text style={s.cVat}>VAT amount</Text>
            <Text style={s.cGross}>Incl. VAT</Text>
          </View>
          {model.sections.map((sec, si) => (
            <View key={si}>
              {sec.title !== null ? (
                <View style={s.secRow} wrap={false} minPresenceAhead={60}>
                  <Text style={[s.cDesc, s.bold, { paddingLeft: 6 }]}>{sec.number} {sec.title}</Text>
                </View>
              ) : null}
              {sec.lines.map((l) => <EstimateRow key={l.number} l={l} images={assets.images} />)}
              {sec.title !== null ? (
                <View style={s.subRow} wrap={false}>
                  <Text style={[s.cDesc, s.bold, { textAlign: "right" }]}>Subtotal: {sec.number} {sec.title}</Text>
                  <Text style={[s.cNet, s.bold]}>{money(sec.subtotalNet)}</Text>
                  <Text style={s.cRate}></Text>
                  <Text style={[s.cVat, s.bold]}>{money(sec.subtotalVat)}</Text>
                  <Text style={[s.cGross, s.bold]}>{money(sec.subtotalGross)}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>

        {/* The totals: boxed, directly after the BOQ, kept together on one page. */}
        <View style={E.totalsBox} wrap={false}>
          <View style={s.totalRow}><Text>Total excl. VAT</Text><Text>{cur ? `${cur} ` : ""}{money(model.totals.net)}</Text></View>
          <View style={s.totalRow}><Text>VAT</Text><Text>{cur ? `${cur} ` : ""}{money(model.totals.vat)}</Text></View>
          <View style={[s.totalRow, { borderTopWidth: 1, borderColor: C.brand, marginTop: 3, paddingTop: 4 }]}><Text style={s.totalBig}>Total incl. VAT</Text><Text style={s.totalBig}>{cur ? `${cur} ` : ""}{money(model.totals.gross)}</Text></View>
        </View>
        {model.validityDate ? <Text style={E.review}>{reviewPricingSentence(model.validityDate)}</Text> : null}

        {model.milestones.length > 0 ? (
          <View wrap={false}>
            <Text style={s.h2}>Indicative payment schedule</Text>
            <View style={[s.th, { width: 560 }]}>
              <Text style={[s.cDesc, { flex: 3 }]}>Item</Text><Text style={[s.cDesc, { flex: 2 }]}>Timing</Text><Text style={[s.cNet, { width: 80 }]}>Share</Text><Text style={[s.cGross, { width: 110 }]}>Amount incl. VAT</Text>
            </View>
            {model.milestones.map((m, i) => (
              <View key={i} style={[s.tr, { width: 560 }]} wrap={false}>
                <Text style={[s.cDesc, { flex: 3 }]}>{m.label}</Text><Text style={[s.cDesc, { flex: 2 }]}>{m.due ?? ""}</Text>
                <Text style={[s.cNet, { width: 80 }]}>{m.kind === "percent" ? milestoneValueText(m, cur) : ""}</Text>
                <Text style={[s.cGross, { width: 110 }]}>{cur ? `${cur} ` : ""}{money(m.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <NoteBlock heading={NOTE_HEADINGS.assumptions} paragraphs={model.clientNotes.assumptions} />
        {model.exclusions.length > 0 ? (
          <View>
            {model.exclusions.map((c, i) => (
              <View key={i} wrap={false}>
                {i === 0 ? <Text style={s.h2}>{NOTE_HEADINGS.exclusions}</Text> : null}
                <Text style={s.clauseTitle}>{i + 1}. {c.title}</Text>
                <Text style={s.clauseBody} orphans={2} widows={2}>{c.body}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <NoteBlock heading={NOTE_HEADINGS.nextSteps} paragraphs={model.clientNotes.nextSteps} />
      </Page>
    </Document>
  );
}
