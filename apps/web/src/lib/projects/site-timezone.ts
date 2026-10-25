import { COMMON_TIME_ZONES } from "./format";

export interface TimezoneSuggestion {
  zone: string;
  /** Where the suggestion comes from, in words the person can check ("the location 'Riyadh'"). Empty when it is only the fallback. */
  basis: "location" | "country" | "fallback";
  because: string;
}

/**
 * Place names a Sales person is likely to write in an enquiry's Location. Only zones the handover form offers are used, so a suggestion can
 * always be selected. Matching is on whole words, lower case; the first place named wins.
 */
const PLACES: { zone: string; words: string[] }[] = [
  { zone: "Asia/Dubai", words: ["dubai", "abu dhabi", "sharjah", "ajman", "fujairah", "ras al khaimah", "umm al quwain", "al ain", "uae", "emirates"] },
  { zone: "Asia/Riyadh", words: ["riyadh", "jeddah", "dammam", "khobar", "mecca", "makkah", "medina", "neom", "al ula", "alula", "saudi", "ksa"] },
  { zone: "Europe/Warsaw", words: ["warsaw", "poznan", "krakow", "gdansk", "wroclaw", "lodz", "katowice", "poland", "polska"] },
  { zone: "Asia/Qatar", words: ["doha", "qatar"] },
  { zone: "Asia/Kuwait", words: ["kuwait"] },
  { zone: "Asia/Bahrain", words: ["manama", "bahrain"] },
  { zone: "Africa/Cairo", words: ["cairo", "giza", "alexandria", "egypt"] },
  { zone: "Europe/London", words: ["london", "manchester", "birmingham", "united kingdom"] },
  { zone: "Europe/Berlin", words: ["berlin", "munich", "frankfurt", "hamburg", "cologne", "germany"] },
  { zone: "Europe/Paris", words: ["paris", "lyon", "marseille", "france"] },
  { zone: "Europe/Istanbul", words: ["istanbul", "ankara", "turkey", "turkiye"] },
  { zone: "Asia/Kolkata", words: ["mumbai", "delhi", "bangalore", "bengaluru", "hyderabad", "chennai", "india"] },
  { zone: "America/New_York", words: ["new york", "boston", "washington", "miami", "atlanta"] },
];

/** The home time zone of each company country the system already serves. */
const COUNTRY_ZONE: Record<string, string> = { AE: "Asia/Dubai", SA: "Asia/Riyadh", PL: "Europe/Warsaw", QA: "Asia/Qatar", KW: "Asia/Kuwait", BH: "Asia/Bahrain", EG: "Africa/Cairo", GB: "Europe/London", DE: "Europe/Berlin", FR: "Europe/Paris", TR: "Europe/Istanbul", IN: "Asia/Kolkata", US: "America/New_York" };
const COUNTRY_NAME: Record<string, string> = { AE: "the UAE", SA: "Saudi Arabia", PL: "Poland", QA: "Qatar", KW: "Kuwait", BH: "Bahrain", EG: "Egypt", GB: "the UK", DE: "Germany", FR: "France", TR: "Turkey", IN: "India", US: "the USA" };

const offered = (zone: string) => COMMON_TIME_ZONES.includes(zone);

/**
 * The site time zone to suggest for a NEW handover. The enquiry's own Location wins (an event in Riyadh for the UAE company is on Riyadh
 * time); otherwise the company's country; only when neither says anything does it fall back to Dubai, the home zone. It is only a
 * suggestion: the form keeps the zone visible and editable, and an existing handover keeps the zone it was saved with.
 */
export function suggestSiteTimezone(input: { location?: string | null; countryCode?: string | null }): TimezoneSuggestion {
  const text = ` ${(input.location ?? "").toLowerCase().replace(/[^a-z0-9À-ɏ ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (text.trim() !== "") {
    // the earliest place named in the text wins, so "Riyadh, after Dubai install" reads as Riyadh
    let best: { zone: string; word: string; at: number } | null = null;
    for (const p of PLACES) {
      if (!offered(p.zone)) continue;
      for (const w of p.words) {
        const at = text.indexOf(` ${w} `);
        if (at >= 0 && (best === null || at < best.at)) best = { zone: p.zone, word: w, at };
      }
    }
    if (best) return { zone: best.zone, basis: "location", because: `the enquiry's location mentions ${titleCase(best.word)}` };
  }
  const cc = (input.countryCode ?? "").toUpperCase();
  const home = COUNTRY_ZONE[cc];
  if (home && offered(home)) return { zone: home, basis: "country", because: `the company is in ${COUNTRY_NAME[cc] ?? cc}` };
  return { zone: "Asia/Dubai", basis: "fallback", because: "no location or company country to go by" };
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bUae\b/, "UAE").replace(/\bKsa\b/, "KSA");
