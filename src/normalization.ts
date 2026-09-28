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

const MONTHS: Record<string, number> = {
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

const CITY_ALIASES: Record<string, string> = {
  תא: "תל אביב-יפו",
  "תל אביב": "תל אביב-יפו",
  "תל אביב יפו": "תל אביב-יפו",
  "tel aviv yafo": "תל אביב-יפו",
  בש: "באר שבע",
  "באר שבע": "באר שבע",
  jerusalem: "ירושלים",
  ירושלים: "ירושלים",
};

const text = (value?: string) => (value ?? "").replace(/\s+/g, " ").trim();

export function canonicalCategory(value: string): string {
  return text(value)
    .replace(/[־–—-]+/g, " ")
    .replace(/[״"'׳]/g, "")
    .toLocaleLowerCase("he");
}

export function normalizeCity(value: string): string {
  const cleaned = text(value).replace(/[־–—-]+/g, " ");
  return CITY_ALIASES[canonicalCategory(cleaned)] ?? cleaned;
}

export function parseNumber(value: string): number | null {
  const cleaned = text(value).replace(/[,₪]/g, "");
  if (!cleaned) return null;

  const direct = Number(cleaned);
  if (Number.isFinite(direct)) return direct;

  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match && Number.isFinite(Number(match[0])) ? Number(match[0]) : null;
}

const iso = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function exactDate(year: number, month: number, day: number): ParsedDate | null {
  if (!validDate(year, month, day)) return null;
  const value = iso(year, month, day);
  return { start: value, end: value, precision: "day" };
}

export function parseDate(value: string): ParsedDate | null {
  const raw = text(value);
  if (!raw) return null;

  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) {
    return exactDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) {
    return exactDate(Number(match[3]), Number(match[2]), Number(match[1]));
  }

  match = raw.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!match) return null;

  const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
  const year = Number(match[2]);
  if (!month || year < 1900 || year > 2100) return null;

  return {
    start: iso(year, month, 1),
    end: iso(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()),
    precision: "month",
  };
}

export function normalizeRawRow(raw: RawDeal, sourceRow: number): NormalizedDeal {
  const issues: DataIssueCode[] = [];
  const dealId = text(raw.deal_id);
  const rooms = parseNumber(raw.rooms);
  const sizeSqm = parseNumber(raw.size_sqm);
  const date = parseDate(raw.deal_date);
  const priceNis = parseNumber(raw.price_nis);
  const suppliedPricePerSqm = parseNumber(raw.price_per_sqm);

  if (!dealId) issues.push("missing_deal_id");
  if (text(raw.rooms) && (rooms === null || rooms <= 0)) {
    issues.push("invalid_rooms");
  }
  if (text(raw.size_sqm) && (sizeSqm === null || sizeSqm <= 0)) {
    issues.push("invalid_size");
  }
  if (text(raw.deal_date) && !date) issues.push("invalid_date");
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
    Math.abs(suppliedPricePerSqm - calculatedPricePerSqm) /
      calculatedPricePerSqm >
      0.05
  ) {
    issues.push("price_per_sqm_mismatch");
  }

  return {
    dealId: dealId || `__missing_${sourceRow}`,
    city: normalizeCity(raw.city),
    neighborhood: text(raw.neighborhood) || null,
    street: text(raw.street) || null,
    propertyType: text(raw.property_type),
    rooms: rooms !== null && rooms > 0 ? rooms : null,
    sizeSqm: sizeSqm !== null && sizeSqm > 0 ? sizeSqm : null,
    dealDateStart: date?.start ?? null,
    dealDateEnd: date?.end ?? null,
    dealDateRaw: text(raw.deal_date) || null,
    datePrecision: date?.precision ?? null,
    dealYear: date ? Number(date.start.slice(0, 4)) : null,
    priceNis,
    calculatedPricePerSqm,
    source: text(raw.source) || "לא ידוע",
    analyticsBlocked: !dealId,
    suspiciousPrice,
    issues,
  };
}

export function materialSignature(deal: NormalizedDeal): string {
  const category = (value: string | null) =>
    value ? canonicalCategory(value) : null;

  return JSON.stringify({
    city: category(deal.city),
    neighborhood: category(deal.neighborhood),
    street: category(deal.street),
    propertyType: category(deal.propertyType),
    rooms: deal.rooms,
    sizeSqm: deal.sizeSqm,
    dealDateStart: deal.dealDateStart,
    dealDateEnd: deal.dealDateEnd,
    priceNis: deal.priceNis,
    source: category(deal.source),
  });
}
