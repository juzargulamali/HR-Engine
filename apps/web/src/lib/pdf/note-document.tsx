import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import {
  NOTE_KIND_WORDS, capacityWord, conditionWord, contentId, eventText, formatNoteInstant, lineIdentity, lineQtyText, lineTitle, outcomeWord, replacesNo, supersededByNo,
  totalQtyText, type NoteView,
} from "@/lib/inventory/project-notes";

/**
 * The dispatch note / return checklist PDF. It renders ONLY the frozen content of the note (what the warehouse recorded, snapshotted when it was recorded) plus
 * its acknowledgement history as of now: renaming an item, editing a serial or changing the destination afterwards cannot change the lines. There is no signature
 * image and no claim of a legal signature: an acknowledgement is an authenticated account saying "I acknowledge this recorded list". Original ENGINIOUS logo and
 * fonts, exactly as the plan PDF and the letters use them.
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
const BAND = {
  pending: { bg: "#FFF3D6", fg: "#7A4B00" },
  acknowledged: { bg: "#E3F4EA", fg: "#1B5E3B" },
  difference: { bg: "#FBE4E4", fg: "#8A1C1C" },
  superseded: { bg: "#E8ECEE", fg: "#33454D" },
} as const;

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 64, paddingHorizontal: 40, fontSize: 10.5, fontFamily: "Carlito", color: C.ink },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  logo: { width: 120, height: 74.7 },
  headRight: { alignItems: "flex-end", maxWidth: 320 },
  kicker: { fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 20, fontWeight: "bold", color: C.brand, marginTop: 2 },
  number: { fontSize: 13, fontWeight: "bold", marginTop: 2 },
  issue: { fontSize: 10, color: C.muted, marginTop: 1 },
  band: { paddingVertical: 6, paddingHorizontal: 10, marginBottom: 10, borderRadius: 2 },
  bandText: { fontSize: 11.5, fontWeight: "bold", letterSpacing: 0.6 },
  meta: { marginBottom: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 8 },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaLabel: { width: 118, color: C.muted },
  metaValue: { flex: 1 },
  sectionTitle: { fontSize: 12.5, fontWeight: "bold", color: C.brand, marginTop: 10, marginBottom: 4 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: C.line },
  th: { flexDirection: "row", backgroundColor: C.band, borderBottomWidth: 1, borderColor: C.line },
  cNo: { width: 22, padding: 4 },
  cItem: { flex: 4, padding: 4 },
  cId: { flex: 3, padding: 4 },
  cQty: { width: 54, padding: 4, textAlign: "right" },
  cCond: { flex: 2, padding: 4 },
  cNum: { width: 66, padding: 4, textAlign: "right" },
  bold: { fontWeight: "bold" },
  small: { fontSize: 9.5, color: C.muted, marginTop: 3 },
  ack: { marginTop: 12, borderTopWidth: 1, borderColor: C.line, paddingTop: 6 },
  ackLine: { marginBottom: 2 },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 9, color: C.muted, borderTopWidth: 0.5, borderColor: C.line, paddingTop: 6 },
});

export interface NoteDocumentProps { view: NoteView; generatedAt: Date }

/** The one band under the title: what the printed copy must never hide. */
export function noteBand(v: NoteView): { text: string; tone: keyof typeof BAND } {
  const st = v.status;
  const returnNote = v.note.kind === "return";
  if (st.state === "superseded") return { text: `SUPERSEDED BY ${supersededByNo(v) ?? "A NEWER NOTE"}`, tone: "superseded" };
  if (st.state === "difference_open") return { text: "DIFFERENCE REPORTED, WAITING FOR THE WAREHOUSE", tone: "difference" };
  if (st.state === "acknowledged") return { text: `${returnNote ? "CONFIRMED" : "ACKNOWLEDGED"} BY ${(st.acknowledged_by_name ?? "").toUpperCase()}`, tone: "acknowledged" };
  return { text: returnNote ? "CONFIRMATION PENDING" : "ACKNOWLEDGEMENT PENDING", tone: "pending" };
}

/** "Pending: the Project Manager has not yet acknowledged this list." or the acknowledgement as recorded. No claim of a legal signature. */
export function acknowledgementLines(v: NoteView): string[] {
  const n = v.note;
  const st = v.status;
  const word = n.kind === "return" ? "confirmed" : "acknowledged";
  const out: string[] = [];
  if (st.acknowledged_at) {
    out.push(`${word === "confirmed" ? "Confirmed" : "Acknowledged"} in ENGINIOUS OS by ${st.acknowledged_by_name ?? "Unknown"} (${capacityWord(st.acknowledged_capacity)}) on ${formatNoteInstant(st.acknowledged_at, n.location_timezone)}, using an authenticated account. This is an internal acknowledgement of the recorded list.`);
  } else {
    out.push(`Pending: the Project Manager has not yet ${word === "confirmed" ? "confirmed" : "acknowledged"} this list.`);
  }
  for (const e of v.events) if (e.event !== "acknowledged") out.push(`${formatNoteInstant(e.at, n.location_timezone)}: ${eventText(e, n.kind, v.noteNos)}`);
  return out;
}

export function NoteDocument({ view, generatedAt }: NoteDocumentProps) {
  const n = view.note;
  const tz = n.location_timezone;
  const isReturn = n.kind === "return";
  const band = noteBand(view);
  const replaces = replacesNo(view);
  const title = NOTE_KIND_WORDS[n.kind];
  const meta: [string, string | null][] = [
    ["Project", `${n.project_ref} · ${n.project_name}`],
    [isReturn ? "Returned from" : "Destination", n.destination ?? (isReturn ? null : "Not recorded") ],
    [isReturn ? "Received at" : "From", n.location_name],
    [isReturn ? "Received" : "Dispatched", formatNoteInstant(n.occurred_at, tz)],
    ...(n.expected_return_at ? ([["Expected back", formatNoteInstant(n.expected_return_at, tz)]] as [string, string][]) : []),
    [isReturn ? "Received by" : "Recorded by", `${n.recorded_by_name}${n.recorded_by_role ? ` (${n.recorded_by_role})` : ""}`],
    ["Ledger reference", n.movement_code],
    ...(n.request_code ? ([["Request", n.request_code]] as [string, string][]) : []),
    ["Project Manager then", n.pm_name_at_time],
  ];
  return (
    <Document title={`${title} ${n.note_no}`} author="Enginious">
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive (renders into a PDF, not the DOM); it has no alt prop. */}
          <Image src={LOGO} style={s.logo} />
          <View style={s.headRight}>
            <Text style={s.kicker}>{title}</Text>
            <Text style={s.title}>{n.note_no}</Text>
            <Text style={s.issue}>{replaces ? `Replaces ${replaces}` : "Issue: original"}</Text>
          </View>
        </View>
        <View style={[s.band, { backgroundColor: BAND[band.tone].bg }]}>
          <Text style={[s.bandText, { color: BAND[band.tone].fg }]}>{band.text}</Text>
        </View>
        <View style={s.meta}>
          {meta.filter(([, v]) => v).map(([k, v]) => (
            <View key={k} style={s.metaRow}>
              <Text style={s.metaLabel}>{k}</Text>
              <Text style={s.metaValue}>{v}</Text>
            </View>
          ))}
        </View>

        <Text style={s.sectionTitle}>{isReturn ? "This return (what the warehouse recorded as received)" : "What was dispatched"}</Text>
        <View style={s.th}>
          <Text style={[s.cNo, s.bold]}>#</Text>
          <Text style={[s.cItem, s.bold]}>Item</Text>
          <Text style={[s.cId, s.bold]}>Equipment ID / serial</Text>
          <Text style={[s.cQty, s.bold]}>Qty</Text>
          <Text style={[s.cCond, s.bold]}>{isReturn ? "Recorded outcome" : "Condition"}</Text>
        </View>
        {view.payload.lines.map((l) => (
          <View key={l.n} style={s.tr} wrap={false}>
            <Text style={s.cNo}>{l.n}</Text>
            <Text style={s.cItem}>{lineTitle(l)}</Text>
            <Text style={s.cId}>{lineIdentity(l)}</Text>
            <Text style={s.cQty}>{lineQtyText(l)}</Text>
            <Text style={s.cCond}>{isReturn ? `${outcomeWord(l.outcome)}${l.outcome === "held" ? `: ${conditionWord(l.condition).toLowerCase()}` : ""}` : conditionWord(l.condition)}</Text>
          </View>
        ))}

        {isReturn && view.payload.totals.length > 0 ? (
          <View wrap>
            <Text style={s.sectionTitle}>Project totals after this return</Text>
            <View style={s.th}>
              <Text style={[s.cItem, s.bold]}>Item</Text>
              <Text style={[s.cNum, s.bold]}>Sent</Text>
              <Text style={[s.cNum, s.bold]}>Back before</Text>
              <Text style={[s.cNum, s.bold]}>Back now</Text>
              <Text style={[s.cNum, s.bold]}>Still out</Text>
            </View>
            {view.payload.totals.map((t, i) => (
              <View key={`${t.itemName}-${i}`} style={s.tr} wrap={false}>
                <Text style={s.cItem}>{t.itemName}{t.individual ? "" : " (project level)"}</Text>
                <Text style={s.cNum}>{totalQtyText(t.sent, t)}</Text>
                <Text style={s.cNum}>{totalQtyText(t.returnedBefore, t)}</Text>
                <Text style={s.cNum}>{totalQtyText(t.receivedNow, t)}</Text>
                <Text style={s.cNum}>{totalQtyText(t.stillOut, t)}</Text>
              </View>
            ))}
            <Text style={s.small}>Units are exact. Counted stock is shown for the whole project, not per request: the system does not guess which request it belongs to.</Text>
          </View>
        ) : null}

        <View style={s.ack} wrap={false}>
          <Text style={[s.bold, { marginBottom: 3 }]}>{isReturn ? "Confirmation" : "Acknowledgement"}</Text>
          {acknowledgementLines(view).map((t, i) => <Text key={i} style={s.ackLine}>{t}</Text>)}
        </View>

        <View style={s.footer} fixed>
          <Text>Content ID {contentId(n.payload_hash)} (matches the recorded list) · Generated {formatNoteInstant(generatedAt.toISOString(), tz)} · Status as of generation</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
