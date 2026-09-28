import type { DataIssueCode } from "./contracts";

export const EXPECTED_HEADERS = [
  "deal_id",
  "city",
  "neighborhood",
  "street",
  "property_type",
  "rooms",
  "size_sqm",
  "floor",
  "total_floors",
  "year_built",
  "condition",
  "has_elevator",
  "has_parking",
  "has_balcony",
  "has_safe_room",
  "deal_date",
  "price_nis",
  "price_per_sqm",
  "source",
] as const;

export type RawDeal = Record<(typeof EXPECTED_HEADERS)[number], string>;

export type NormalizedDeal = {
  dealId: string;
  city: string;
  neighborhood: string | null;
  street: string | null;
  propertyType: string;
  rooms: number | null;
  sizeSqm: number | null;
  dealDateStart: string | null;
  dealDateEnd: string | null;
  dealDateRaw: string | null;
  datePrecision: "day" | "month" | null;
  dealYear: number | null;
  priceNis: number | null;
  calculatedPricePerSqm: number | null;
  source: string;
  analyticsBlocked: boolean;
  suspiciousPrice: boolean;
  issues: DataIssueCode[];
};

type ParsedDate = {
  start: string;
  end: string;
  precision: "day" | "month";
};

const ENGLISH_MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function cleanText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function canonicalCategory(value: string): string {
  return cleanText(value)
    .replace(/[־–—-]+/g, " ")
    .replace(/[״"'׳]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("he");
}

const CITY_ALIASES: Record<string, string> = {
  "תא": "תל אביב-יפו",
  "תל אביב": "תל אביב-יפו",
  "תל אביב יפו": "תל אביב-יפו",
  "tel aviv yafo": "תל אביב-יפו",
  "בש": "באר שבע",
  "באר שבע": "באר שבע",
  jerusalem: "ירושלים",
  "ירושלים": "ירושלים",
};

export function normalizeCity(value: string): string {
  const cleaned = cleanText(value)
    .replace(/[־–—-]+/g, " ")
    .replace(/\s+/g, " ");
  return CITY_ALIASES[canonicalCategory(cleaned)] ?? cleaned;
}

export function parseNumber(value: string): number | null {
  const cleaned = cleanText(value).replace(/[,₪]/g, "");
  if (!cleaned) return null;

  const direct = Number(cleaned);
  if (Number.isFinite(direct)) return direct;

  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function parseDate(value: string): ParsedDate | null {
  const raw = cleanText(value);
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    return validDateParts(year, month, day)
      ? {
          start: isoDate(year, month, day),
          end: isoDate(year, month, day),
          precision: "day",
        }
      : null;
  }

  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const year = Number(dmy[3]);
    const month = Number(dmy[2]);
    const day = Number(dmy[1]);
    return validDateParts(year, month, day)
      ? {
          start: isoDate(year, month, day),
          end: isoDate(year, month, day),
          precision: "day",
        }
      : null;
  }

  const monthYear = raw.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!monthYear) return null;

  const month = ENGLISH_MONTHS[monthYear[1].slice(0, 3).toLowerCase()];
  const year = Number(monthYear[2]);
  if (!month || year < 1900 || year > 2100) return null;

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: isoDate(year, month, 1),
    end: isoDate(year, month, lastDay),
    precision: "month",
  };
}

export function normalizeRawRow(raw: RawDeal, sourceRow: number): NormalizedDeal {
  const issues: DataIssueCode[] = [];
  const dealId = cleanText(raw.deal_id);
  const city = normalizeCity(raw.city);
  const neighborhood = cleanText(raw.neighborhood) || null;
  const street = cleanText(raw.street) || null;
  const propertyType = cleanText(raw.property_type);
  const rooms = parseNumber(raw.rooms);
  const sizeSqm = parseNumber(raw.size_sqm);
  const parsedDate = parseDate(raw.deal_date);
  const priceNis = parseNumber(raw.price_nis);
  const suppliedPricePerSqm = parseNumber(raw.price_per_sqm);

  if (!dealId) issues.push("missing_deal_id");
  if (cleanText(raw.rooms) && (rooms === null || rooms <= 0)) issues.push("invalid_rooms");
  if (cleanText(raw.size_sqm) && (sizeSqm === null || sizeSqm <= 0)) {
    issues.push("invalid_size");
  }
  if (cleanText(raw.deal_date) && !parsedDate) issues.push("invalid_date");
  if (priceNis === null) issues.push("missing_price");

  const suspiciousPrice = priceNis !== null && priceNis < 100_000;
  if (suspiciousPrice) issues.push("suspicious_price");

  const calculatedPricePerSqm =
    priceNis !== null && priceNis > 0 && sizeSqm !== null && sizeSqm > 0
      ? priceNis / sizeSqm
      : null;

  if (
    calculatedPricePerSqm !== null &&
    suppliedPricePerSqm !== null &&
    Math.abs(suppliedPricePerSqm - calculatedPricePerSqm) / calculatedPricePerSqm > 0.05
  ) {
    issues.push("price_per_sqm_mismatch");
  }

  return {
    dealId: dealId || `__missing_${sourceRow}`,
    city,
    neighborhood,
    street,
    propertyType,
    rooms: rooms !== null && rooms > 0 ? rooms : null,
    sizeSqm: sizeSqm !== null && sizeSqm > 0 ? sizeSqm : null,
    dealDateStart: parsedDate?.start ?? null,
    dealDateEnd: parsedDate?.end ?? null,
    dealDateRaw: cleanText(raw.deal_date) || null,
    datePrecision: parsedDate?.precision ?? null,
    dealYear: parsedDate ? Number(parsedDate.start.slice(0, 4)) : null,
    priceNis,
    calculatedPricePerSqm,
    source: cleanText(raw.source) || "לא ידוע",
    analyticsBlocked: !dealId,
    suspiciousPrice,
    issues,
  };
}

export function materialSignature(deal: NormalizedDeal): string {
  return JSON.stringify({
    city: canonicalCategory(deal.city),
    neighborhood: deal.neighborhood ? canonicalCategory(deal.neighborhood) : null,
    street: deal.street ? canonicalCategory(deal.street) : null,
    propertyType: canonicalCategory(deal.propertyType),
    rooms: deal.rooms,
    sizeSqm: deal.sizeSqm,
    dealDateStart: deal.dealDateStart,
    dealDateEnd: deal.dealDateEnd,
    priceNis: deal.priceNis,
    source: canonicalCategory(deal.source),
  });
}
