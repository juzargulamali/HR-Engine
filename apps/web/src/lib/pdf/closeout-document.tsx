import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import type { ReportView } from "@/lib/projects/closeout/report";

/**
 * The approved Project Closeout Report as a PDF. It renders ONLY a stored, approved version: its recorded facts (from the snapshot frozen with it), the narrative the
 * Project Manager approved and the sources it cites. It is an internal document and says so on every page. Same logo and fonts as the client timeline.
 */
Font.registerHyphenationCallback((word) => [word]);
const BRAND_DIR = path.join(process.cwd(), "public", "brand");
const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");
const LOGO = `data:image/png;base64,${readFileSync(path.join(BRAND_DIR, "enginious-logo.png")).toString("base64")}`;
Font.register({ family: "Carlito", fonts: [{ src: path.join(FONT_DIR, "Carlito-Regular.ttf"), fontWeight: "normal" }, { src: path.join(FONT_DIR, "Carlito-Bold.ttf"), fontWeight: "bold" }] });

const C = { brand: "#1C5C6B", ink: "#0A202A", muted: "#4A5D66", line: "#C9D3D7" };
const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 60, paddingHorizontal: 40, fontSize: 10.5, fontFamily: "Carlito", color: C.ink },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  logo: { width: 120, height: 74.7 },
  headRight: { alignItems: "flex-end", maxWidth: 300 },
  kicker: { fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 18, fontWeight: "bold", color: C.brand, marginTop: 2, textAlign: "right" },
  meta: { marginBottom: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 8 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 130, color: C.muted },
  value: { flex: 1 },
  bold: { fontWeight: "bold" },
  note: { fontSize: 9.5, color: C.muted, marginBottom: 8 },
  h: { fontSize: 13, fontWeight: "bold", color: C.brand, marginTop: 12, marginBottom: 4 },
  p: { marginBottom: 5, lineHeight: 1.35 },
  ref: { fontSize: 8.5, color: C.muted },
  src: { fontSize: 8.5, marginBottom: 2, color: C.ink },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 9, color: C.muted, borderTopWidth: 0.5, borderColor: C.line, paddingTop: 6 },
});
const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso)) : "");

export function CloseoutDocument({ report, projectName, reference }: { report: ReportView; projectName: string; reference: string }) {
  const cited = new Set(report.sections.flatMap((x) => x.paragraphs.flatMap((p) => p.refs)));
  const sources = report.refs.filter((r) => cited.has(r.ref));
  return (
    <Document title={`${projectName} closeout report, version ${report.versionNo}`} author="Enginious">
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive (renders into a PDF, not the DOM); it has no alt prop. */}
          <Image src={LOGO} style={s.logo} />
          <View style={s.headRight}>
            <Text style={s.kicker}>Project closeout report · Internal</Text>
            <Text style={s.title}>{projectName}</Text>
          </View>
        </View>
        <View style={s.meta}>
          {report.facts.map((f) => (
            <View key={f.label} style={s.row}>
              <Text style={s.label}>{f.label}</Text>
              <Text style={f.attention ? [s.value, s.bold] : s.value}>{f.value}</Text>
            </View>
          ))}
        </View>
        <Text style={s.note}>
          Recorded facts above are taken from the project&apos;s records as they were on {day(report.snapshotAt)}; completion, client sign-off and equipment return are stated there from the records only, and stand where the narrative differs. Version {report.versionNo}, approved {day(report.approvedAt)}{report.approvedBy ? ` by ${report.approvedBy}` : ""}.
          {report.missing.length > 0 ? ` Could not be read when this was written: ${report.missing.join("; ")}.` : ""}
        </Text>
        {report.sections.map((sec) => (
          <View key={sec.id}>
            <Text style={s.h} minPresenceAhead={40}>{sec.title}</Text>
            {sec.paragraphs.length === 0 ? <Text style={[s.p, { color: C.muted }]}>Nothing written.</Text> : sec.paragraphs.map((p, i) => (
              <Text key={i} style={s.p}>{p.text}{p.refs.length > 0 ? <Text style={s.ref}>  [{p.refs.join(", ")}]</Text> : null}</Text>
            ))}
          </View>
        ))}
        {sources.length > 0 ? (
          <View>
            <Text style={s.h} minPresenceAhead={40}>Sources</Text>
            {sources.map((r) => <Text key={r.ref} style={s.src}>[{r.ref}] {r.label}: {r.text}</Text>)}
          </View>
        ) : null}
        <View style={s.footer} fixed>
          <Text>Internal report · {reference} · closeout version {report.versionNo}. Not a client document.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export const closeoutPdfFileName = (reference: string, version: number) => `${reference.replace(/[^A-Za-z0-9-]+/g, "-")}-closeout-v${version}.pdf`;
