import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";

/**
 * The Enginious letterhead — logo + contact/registration footer — recreated
 * from the company's own LetterHead_Enginious.docx (header2.xml's logo +
 * contact bar, footer's blank). Applies to every letter template_type for
 * now (offer_letter, experience_letter, noc, salary_certificate all
 * confirmed to share this design); a template type that turns out to need
 * a genuinely different layout gets its own component and a lookup by
 * type here, not a rewrite of this one.
 */

// react-pdf's default hyphenation engine dynamically requires a
// locale-specific dictionary (@react-pdf/hyphenate/en-us) at render time —
// a pattern Vercel's serverless bundler doesn't always trace correctly,
// which can turn into a MODULE_NOT_FOUND at runtime that never shows up in
// a local `next build`. A no-op callback (never split a word) sidesteps
// that path entirely, and reads better for a formal letter anyway — no
// mid-word breaks.
Font.registerHyphenationCallback((word) => [word]);

const LOGO_DATA_URI = (() => {
  const filePath = path.join(process.cwd(), "public", "brand", "enginious-logo.png");
  const buffer = readFileSync(filePath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
})();

const COLORS = {
  heading: "#0F6E70",
  body: "#1F2933",
  muted: "#5B6B74",
  rule: "#BFE3E1",
};

const styles = StyleSheet.create({
  page: {
    // Comfortably clears the header/footer's real rendered height (measured
    // from an actual generated PDF, not guessed) — a mismatch here silently
    // overlaps body text under the logo instead of erroring.
    paddingTop: 150,
    paddingBottom: 100,
    paddingHorizontal: 56,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: COLORS.body,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 28,
    paddingHorizontal: 56,
    paddingBottom: 14,
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.rule,
  },
  logo: {
    width: 130,
    height: undefined,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 56,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: COLORS.rule,
  },
  footerLine: {
    fontSize: 8,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 2,
  },
  pageNumber: {
    position: "absolute",
    bottom: 12,
    right: 56,
    fontSize: 8,
    color: COLORS.muted,
  },
  paragraph: {
    marginBottom: 10,
    lineHeight: 1.5,
    textAlign: "justify",
  },
});

function LetterHeader() {
  return (
    <View style={styles.header} fixed>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive (renders into a PDF, not the DOM); it has no alt prop. */}
      <Image src={LOGO_DATA_URI} style={styles.logo} />
    </View>
  );
}

function LetterFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerLine}>ENGINIOUS LLC-FZ · License Number: 210020301</Text>
      <Text style={styles.footerLine}>Business Center 1, M Floor, The Meydan Hotel, Nad Al Sheba, Dubai, U.A.E.</Text>
      <Text style={styles.footerLine}>Tel: +971 04 251 5127 · Email: info@enginious.ae · Web: www.enginious.ae</Text>
      <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
    </View>
  );
}

export function LetterDocument({ bodyText }: { bodyText: string }) {
  const paragraphs = bodyText.split(/\n+/).filter((line) => line.trim().length > 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <LetterHeader />
        {paragraphs.map((paragraph, index) => (
          <Text key={index} style={styles.paragraph}>
            {paragraph.trim()}
          </Text>
        ))}
        <LetterFooter />
      </Page>
    </Document>
  );
}
