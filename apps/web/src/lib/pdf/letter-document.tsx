import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";

/**
 * Recreates the company's actual LetterHead_Enginious.docx pixel-for-pixel:
 * logo top-left, registration/address block top-right, a faint circuit
 * watermark behind the body, and the solid teal contact bar at the very
 * bottom of the page — all traced from the docx's own XML (positions,
 * colors, image assets) rather than approximated, per the exact-copy ask.
 * Applies to every letter template_type for now — a template type that
 * turns out to need a genuinely different layout gets its own component.
 */

// react-pdf's default hyphenation engine dynamically requires a
// locale-specific dictionary (@react-pdf/hyphenate/en-us) at render time —
// a pattern Vercel's serverless bundler doesn't always trace correctly,
// which can turn into a MODULE_NOT_FOUND at runtime that never shows up in
// a local `next build`. A no-op callback (never split a word) sidesteps
// that path entirely, and reads better for a formal letter anyway — no
// mid-word breaks.
Font.registerHyphenationCallback((word) => [word]);

const BRAND_DIR = path.join(process.cwd(), "public", "brand");
const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");

function dataUri(fileName: string, mime: string): string {
  const buffer = readFileSync(path.join(BRAND_DIR, fileName));
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

const LOGO = dataUri("enginious-logo.png", "image/png");
const WATERMARK = dataUri("letterhead-watermark.png", "image/png");
const ICON_PHONE = dataUri("letterhead-icon-phone.png", "image/png");
const ICON_EMAIL = dataUri("letterhead-icon-email.png", "image/png");
const ICON_GLOBE = dataUri("letterhead-icon-globe.png", "image/png");

// Carlito is metric-compatible with Calibri (the docx's actual theme
// font) and OFL-licensed, so it renders the original's line breaks and
// spacing correctly instead of substituting Helvetica.
Font.register({
  family: "Carlito",
  fonts: [
    { src: path.join(FONT_DIR, "Carlito-Regular.ttf"), fontWeight: "normal" },
    { src: path.join(FONT_DIR, "Carlito-Bold.ttf"), fontWeight: "bold" },
  ],
});

// Exact colors read off the docx XML runs, not eyeballed off a render.
const COLORS = {
  brand: "#1C5C6B",
  address: "#0A202A",
  contactText: "#EDECDE",
  contactTextAlt: "#FFFFFF",
  body: "#0A202A",
};

const styles = StyleSheet.create({
  page: {
    // Clears the header's real height (logo ~93pt tall) and the bottom
    // bar (52pt) — measured from the docx's own EMU coordinates, not
    // guessed.
    paddingTop: 132,
    paddingBottom: 76,
    paddingHorizontal: 36,
    fontSize: 11,
    fontFamily: "Carlito",
    color: COLORS.body,
  },
  headerLogo: {
    position: "absolute",
    top: 24,
    left: 36,
    width: 150,
    height: 93.4,
  },
  headerAddress: {
    position: "absolute",
    top: 28,
    right: 36,
    width: 230,
    textAlign: "right",
  },
  addressBrand: {
    fontFamily: "Carlito",
    fontWeight: "bold",
    fontSize: 11,
    color: COLORS.brand,
    marginBottom: 3,
  },
  addressLine: {
    fontSize: 8.5,
    lineHeight: 1.3,
    color: COLORS.address,
  },
  watermark: {
    position: "absolute",
    top: 138,
    left: "50%",
    marginLeft: -210,
    width: 420,
    height: 319.4,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 52,
    backgroundColor: COLORS.brand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 40,
  },
  contactItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  contactIcon: {
    width: 14,
    height: 14,
    marginRight: 6,
  },
  contactText: {
    fontSize: 8,
    color: COLORS.contactText,
    lineHeight: 1.3,
  },
  contactTextAlt: {
    fontSize: 8,
    color: COLORS.contactTextAlt,
    lineHeight: 1.3,
  },
  pageNumber: {
    position: "absolute",
    bottom: 58,
    right: 36,
    fontSize: 8,
    color: COLORS.address,
  },
  paragraph: {
    marginBottom: 10,
    lineHeight: 1.5,
    textAlign: "justify",
  },
});

function LetterHeader() {
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive (renders into a PDF, not the DOM); it has no alt prop. */}
      <Image src={LOGO} style={styles.headerLogo} fixed />
      <View style={styles.headerAddress} fixed>
        <Text style={styles.addressBrand}>ENGINIOUS LLC-FZ</Text>
        <Text style={styles.addressLine}>License Number: 210020301</Text>
        <Text style={styles.addressLine}>Business Center 1, M Floor,</Text>
        <Text style={styles.addressLine}>The Meydan Hotel, Nad Al Sheba,</Text>
        <Text style={styles.addressLine}>Dubai, U.A.E.</Text>
      </View>
    </>
  );
}

function LetterWatermark() {
  return (
    // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive, no alt prop.
    <Image src={WATERMARK} style={styles.watermark} fixed />
  );
}

function LetterBottomBar() {
  return (
    <View style={styles.bottomBar} fixed>
      <View style={styles.contactItem}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive, no alt prop. */}
        <Image src={ICON_PHONE} style={styles.contactIcon} />
        <Text style={styles.contactText}>(+971) 04 251 5127</Text>
      </View>
      <View style={styles.contactItem}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive, no alt prop. */}
        <Image src={ICON_EMAIL} style={styles.contactIcon} />
        <View>
          <Text style={styles.contactText}>info@enginious.ae</Text>
          <Text style={styles.contactTextAlt}>Meydan - Free Zone</Text>
        </View>
      </View>
      <View style={styles.contactItem}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive, no alt prop. */}
        <Image src={ICON_GLOBE} style={styles.contactIcon} />
        <Text style={styles.contactText}>www.enginious.ae</Text>
      </View>
    </View>
  );
}

export function LetterDocument({ bodyText }: { bodyText: string }) {
  const paragraphs = bodyText.split(/\n+/).filter((line) => line.trim().length > 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <LetterHeader />
        <LetterWatermark />
        {paragraphs.map((paragraph, index) => (
          <Text key={index} style={styles.paragraph}>
            {paragraph.trim()}
          </Text>
        ))}
        <LetterBottomBar />
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
