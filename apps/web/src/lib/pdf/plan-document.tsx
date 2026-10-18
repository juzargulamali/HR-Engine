import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import { planTableRows, type IssuedPlanPayload } from "@enginious-hr/domain";
import { groupPlanRows, issuedDateText, timeZoneNote } from "./plan-layout";

/**
 * The client timeline PDF. It renders ONLY the immutable issued payload (built by the database from items the Project Manager marked
 * client-facing): no internal tasks, discussion, staff notes, commercial figures or attachments can reach it. Original Enginious
 * logo and fonts, exactly as the letters use them.
 */
Font.registerHyphenationCallback((word) => [word]);

const BRAND_DIR = path.join(process.cwd(), "public", "brand");
const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");
const LOGO = `data:image/png;base64,${readFileSync(path.join(BRAND_DIR, "enginious-logo.png")).toString("base64")}`;

Font.register({
  family: "Carlito",
  fonts: [
    { src: path.join(FONT_DIR, "Carlito-Regular.ttf"), fontWeight: "normal" },
    { src: path.join(FONT_DIR, "Carlito-Bold.ttf"), fontWeight: "bold" },
  ],
});

const C = { brand: "#1C5C6B", ink: "#0A202A", muted: "#4A5D66", line: "#C9D3D7", band: "#EEF3F4" };

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 60, paddingHorizontal: 40, fontSize: 10.5, fontFamily: "Carlito", color: C.ink },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  logo: { width: 120, height: 74.7 },
  headRight: { alignItems: "flex-end", maxWidth: 300 },
  kicker: { fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 20, fontWeight: "bold", color: C.brand, marginTop: 2 },
  meta: { marginBottom: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 8 },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaLabel: { width: 110, color: C.muted },
  metaValue: { flex: 1 },
  note: { fontSize: 10, color: C.muted, marginBottom: 10 },
  sectionTitle: { fontSize: 13, fontWeight: "bold", color: C.brand, marginTop: 10, marginBottom: 4 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: C.line },
  th: { flexDirection: "row", backgroundColor: C.band, borderBottomWidth: 1, borderColor: C.line },
  cTitle: { flex: 3, padding: 4 },
  cWhen: { flex: 3, padding: 4 },
  cDetail: { flex: 3, padding: 4 },
  bold: { fontWeight: "bold" },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 9, color: C.muted, borderTopWidth: 0.5, borderColor: C.line, paddingTop: 6 },
});

export interface PlanDocumentProps {
  payload: IssuedPlanPayload;
  version: number;
  clientReference: string;
  title: string;
  tz: string;
  issuedAt: string;
}

export function PlanDocument({ payload, version, clientReference, title, tz, issuedAt }: PlanDocumentProps) {
  const sections = groupPlanRows(planTableRows(payload));
  const p = payload.project;
  const meta: [string, string | null][] = [
    ["Project", title],
    ["Client", p.client_name],
    ["Location", p.location],
    ["Reference", clientReference],
    ["Version", `${version}`],
    ["Issued", `${issuedDateText(issuedAt, tz)} (site time zone ${tz})`],
  ];
  return (
    <Document title={`${title} timeline, version ${version}`} author="Enginious">
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive (renders into a PDF, not the DOM); it has no alt prop. */}
          <Image src={LOGO} style={s.logo} />
          <View style={s.headRight}>
            <Text style={s.kicker}>Project timeline</Text>
            <Text style={s.title}>{title}</Text>
          </View>
        </View>
        <View style={s.meta}>
          {meta.filter(([, v]) => v).map(([k, v]) => (
            <View key={k} style={s.metaRow}>
              <Text style={s.metaLabel}>{k}</Text>
              <Text style={s.metaValue}>{v}</Text>
            </View>
          ))}
        </View>
        <Text style={s.note}>{timeZoneNote(tz)}</Text>
        {sections.length === 0 ? <Text>This issued version has no items.</Text> : null}
        {sections.map((sec) => (
          <View key={sec.title} wrap>
            <Text style={s.sectionTitle}>{sec.title}</Text>
            <View style={s.th} fixed={false}>
              <Text style={[s.cTitle, s.bold]}>Item</Text>
              <Text style={[s.cWhen, s.bold]}>When</Text>
              <Text style={[s.cDetail, s.bold]}>Details</Text>
            </View>
            {sec.rows.map((r, i) => (
              <View key={`${r.title}-${i}`} style={s.tr} wrap={false}>
                <Text style={s.cTitle}>{r.title}</Text>
                <Text style={s.cWhen}>{r.when}</Text>
                <Text style={s.cDetail}>{r.detail}</Text>
              </View>
            ))}
          </View>
        ))}
        <View style={s.footer} fixed>
          <Text>Issued plan version {version} · {clientReference}. Later changes appear in a newer version.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
