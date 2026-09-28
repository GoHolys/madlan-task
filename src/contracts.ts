import { z } from "zod/v4";

export const METRICS = [
  "count",
  "median_price",
  "average_price",
  "median_price_sqm",
  "average_price_sqm",
] as const;

export const GROUPS = ["city", "neighborhood", "property_type", "year"] as const;

export const QueryFiltersSchema = z.object({
  cities: z.array(z.string()).max(8),
  neighborhoods: z.array(z.string()).max(8),
  propertyTypes: z.array(z.string()).max(8),
  roomsMin: z.number().nullable(),
  roomsMax: z.number().nullable(),
  dateFrom: z.string().nullable(),
  dateTo: z.string().nullable(),
});

export const QueryPlanSchema = z.object({
  intent: z.enum(["aggregate", "compare", "list", "quality", "unsupported"]),
  metric: z.enum(METRICS).nullable(),
  groupBy: z.enum(GROUPS).nullable(),
  filters: QueryFiltersSchema,
  limit: z.number().int().min(1).max(20).nullable(),
  reason: z.string(),
});

export const AskRequestSchema = z.object({
  question: z.string().trim().min(2).max(500),
  simulateModelFailure: z.boolean().optional().default(false),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;
export type Metric = NonNullable<QueryPlan["metric"]>;
export type GroupBy = NonNullable<QueryPlan["groupBy"]>;

export type DataIssueCode =
  | "missing_deal_id"
  | "invalid_rooms"
  | "invalid_size"
  | "invalid_date"
  | "missing_price"
  | "suspicious_price"
  | "price_per_sqm_mismatch"
  | "duplicate_conflict";

export type DealEvidence = {
  dealId: string;
  city: string;
  neighborhood: string | null;
  street: string | null;
  propertyType: string;
  rooms: number | null;
  sizeSqm: number | null;
  dealDate: string | null;
  dealDateRaw: string | null;
  priceNis: number | null;
  pricePerSqm: number | null;
  source: string;
  issues: DataIssueCode[];
};

export type QueryGroup = {
  key: string;
  value: number | null;
  sampleSize: number;
};

export type QueryResult = {
  intent: Exclude<QueryPlan["intent"], "unsupported">;
  metric: QueryPlan["metric"];
  value: number | null;
  sampleSize: number;
  matchedCount: number;
  groups: QueryGroup[];
  evidence: DealEvidence[];
  evidenceTruncated: boolean;
  sourceBreakdown: Record<string, number>;
  excluded: {
    total: number;
    blockedRows: number;
    suspiciousOrMissingPrice: number;
    missingSize: number;
    ambiguousMonthDate: number;
  };
};

export type QualitySummary = {
  rawRows: number;
  canonicalRows: number;
  exactDuplicatesRemoved: number;
  conflictingDealIds: number;
  priceEligibleRows: number;
  priceSqmEligibleRows: number;
  missingPriceRows: number;
  missingSizeRows: number;
  monthOnlyDateRows: number;
  dateMin: string | null;
  dateMax: string | null;
  issueCounts: Partial<Record<DataIssueCode, number>>;
  fingerprint: string;
};

export type PublicAnswer =
  | {
      status: "ok";
      requestId: string;
      question: string;
      plan: QueryPlan;
      headline: string;
      summary: string;
      appliedFilters: string[];
      warnings: string[];
      result: QueryResult;
      quality: QualitySummary;
    }
  | {
      status: "unsupported";
      requestId: string;
      question: string;
      message: string;
    }
  | {
      status: "error";
      requestId: string;
      question: string;
      code: "MODEL_UNAVAILABLE" | "DATA_UNAVAILABLE" | "QUERY_FAILED";
      message: string;
    };

export type AskApiResponse =
  | PublicAnswer
  | {
      status: "error";
      requestId: string;
      code: "BAD_REQUEST" | "RATE_LIMITED";
      message: string;
    };
