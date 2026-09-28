import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { __test, getDataset } from "../src/data";
import { normalizeCity, parseDate, parseNumber } from "../src/normalization";

describe("data normalization", () => {
  it("parses the mixed numeric formats present in the CSV", () => {
    expect(parseNumber("4,331,000")).toBe(4_331_000);
    expect(parseNumber("2 חדרים")).toBe(2);
    expect(parseNumber(" 5.5 ")).toBe(5.5);
    expect(parseNumber("")).toBeNull();
  });

  it("preserves month-only date precision instead of inventing a day", () => {
    expect(parseDate("Aug 2025")).toEqual({
      start: "2025-08-01",
      end: "2025-08-31",
      precision: "month",
    });
  });

  it("accepts the day-level date formats observed in the sample", () => {
    expect(parseDate("17.07.2026")?.start).toBe("2026-07-17");
    expect(parseDate("15/06/2025")?.start).toBe("2025-06-15");
    expect(parseDate("2025-09-07")?.start).toBe("2025-09-07");
  });

  it("merges city aliases observed in the supplied CSV", () => {
    expect(normalizeCity('ת"א')).toBe("תל אביב-יפו");
    expect(normalizeCity("תל אביב")).toBe("תל אביב-יפו");
    expect(normalizeCity("Tel Aviv Yafo")).toBe("תל אביב-יפו");
    expect(normalizeCity('ב"ש')).toBe("באר שבע");
    expect(normalizeCity("Jerusalem")).toBe("ירושלים");
  });

  it("keeps the data fingerprint stable across line endings", async () => {
    const raw = await readFile(
      path.join(process.cwd(), "madlan_deals_sample.csv"),
      "utf8",
    );
    const lf = raw.replace(/\r\n?/g, "\n");
    const crlf = lf.replace(/\n/g, "\r\n");

    expect(__test.buildDataset(lf).quality.fingerprint).toBe(
      __test.buildDataset(crlf).quality.fingerprint,
    );
  });

  it("loads the real sample and produces a canonical quality summary", async () => {
    const dataset = await getDataset();

    expect(dataset.quality.rawRows).toBeGreaterThan(400);
    expect(dataset.quality.canonicalRows).toBeLessThanOrEqual(dataset.quality.rawRows);
    expect(dataset.quality.fingerprint).toMatch(/^[a-f0-9]{12}$/);
    expect(dataset.categories.cities.length).toBeGreaterThan(5);
    expect(dataset.categories.cities).not.toContain('ת"א');
    expect(dataset.categories.cities).not.toContain("Tel Aviv Yafo");
    expect(dataset.categories.cities).not.toContain("Jerusalem");
    expect(dataset.categories.cities).toContain("תל אביב-יפו");
    expect(dataset.categories.propertyTypes.length).toBeGreaterThan(1);
  });
});
