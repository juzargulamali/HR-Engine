import { describe, expect, it } from "vitest";
import { suggestSiteTimezone } from "./site-timezone";
import { COMMON_TIME_ZONES } from "./format";

describe("suggestSiteTimezone", () => {
  it("follows the place named in the enquiry's location, whatever company it belongs to", () => {
    expect(suggestSiteTimezone({ location: "Expo Hall 3, Riyadh", countryCode: "AE" })).toMatchObject({ zone: "Asia/Riyadh", basis: "location" });
    expect(suggestSiteTimezone({ location: "Poznań Congress Centre, Poznan", countryCode: "AE" }).zone).toBe("Europe/Warsaw");
    expect(suggestSiteTimezone({ location: "Dubai World Trade Centre", countryCode: "PL" }).zone).toBe("Asia/Dubai");
    expect(suggestSiteTimezone({ location: "ADIPEC, Abu Dhabi", countryCode: null }).zone).toBe("Asia/Dubai");
    expect(suggestSiteTimezone({ location: "Doha Exhibition", countryCode: "AE" }).zone).toBe("Asia/Qatar");
  });

  it("uses the first place named when several are", () => {
    expect(suggestSiteTimezone({ location: "Riyadh, then ship from Dubai", countryCode: "AE" }).zone).toBe("Asia/Riyadh");
    expect(suggestSiteTimezone({ location: "Dubai install, show in Riyadh", countryCode: "SA" }).zone).toBe("Asia/Dubai");
  });

  it("falls back to the company's country when the location says nothing useful", () => {
    expect(suggestSiteTimezone({ location: "Hall 4, stand B12", countryCode: "SA" })).toMatchObject({ zone: "Asia/Riyadh", basis: "country" });
    expect(suggestSiteTimezone({ location: null, countryCode: "PL" })).toMatchObject({ zone: "Europe/Warsaw", basis: "country" });
    expect(suggestSiteTimezone({ location: "", countryCode: "ae" }).zone).toBe("Asia/Dubai");
  });

  it("only falls back to Dubai when nothing says otherwise, and says so", () => {
    expect(suggestSiteTimezone({ location: "Hall 4", countryCode: "XX" })).toMatchObject({ zone: "Asia/Dubai", basis: "fallback" });
    expect(suggestSiteTimezone({})).toMatchObject({ basis: "fallback" });
  });

  it("matches whole words only", () => {
    expect(suggestSiteTimezone({ location: "Dubaiwala Warehouse 7", countryCode: "SA" }).basis).toBe("country");
    expect(suggestSiteTimezone({ location: "Parisian Lounge", countryCode: "PL" }).zone).toBe("Europe/Warsaw");
  });

  it("only ever suggests a zone the form offers, and explains itself", () => {
    for (const loc of ["Dubai", "Riyadh", "Poznan", "Doha", "London", "Berlin", "Paris", "Istanbul", "Mumbai", "New York", "Cairo", "Kuwait", "Manama"]) {
      const s = suggestSiteTimezone({ location: loc });
      expect(COMMON_TIME_ZONES).toContain(s.zone);
      expect(s.because.length).toBeGreaterThan(5);
    }
    expect(suggestSiteTimezone({ location: "riyadh" }).because).toBe("the enquiry's location mentions Riyadh");
    expect(suggestSiteTimezone({ countryCode: "SA" }).because).toBe("the company is in Saudi Arabia");
  });
});
