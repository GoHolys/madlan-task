import type {
  Metric,
  QueryPlan,
  QueryResult,
  QualitySummary,
} from "./contracts";

const format = new Intl.NumberFormat("he-IL", {
  maximumFractionDigits: 0,
}).format;

const METRIC_LABEL: Record<Metric, string> = {
  count: "מספר עסקאות",
  median_price: "חציון מחיר",
  average_price: "מחיר ממוצע",
  median_price_sqm: "חציון מחיר למ״ר",
  average_price_sqm: "מחיר ממוצע למ״ר",
};

const GROUP_LABEL: Record<NonNullable<QueryPlan["groupBy"]>, string> = {
  city: "עיר",
  neighborhood: "שכונה",
  property_type: "סוג נכס",
  year: "שנת עסקה",
};

export function appliedFilters(plan: QueryPlan): string[] {
  const f = plan.filters;
  const filters: string[] = [];

  if (f.cities.length) filters.push(`עיר: ${f.cities.join(", ")}`);
  if (f.neighborhoods.length) {
    filters.push(`שכונה: ${f.neighborhoods.join(", ")}`);
  }
  if (f.propertyTypes.length) {
    filters.push(`סוג נכס: ${f.propertyTypes.join(", ")}`);
  }

  if (f.roomsMin !== null && f.roomsMax !== null) {
    filters.push(
      f.roomsMin === f.roomsMax
        ? `${f.roomsMin} חדרים`
        : `${f.roomsMin}–${f.roomsMax} חדרים`,
    );
  } else if (f.roomsMin !== null) {
    filters.push(`לפחות ${f.roomsMin} חדרים`);
  } else if (f.roomsMax !== null) {
    filters.push(`עד ${f.roomsMax} חדרים`);
  }

  if (f.dateFrom !== null || f.dateTo !== null) {
    filters.push(
      `תאריך עסקה: ${f.dateFrom ?? "התחלה"} עד ${f.dateTo ?? "סוף"}`,
    );
  }

  return filters;
}

export function warnings(
  plan: QueryPlan,
  result: QueryResult,
  quality: QualitySummary,
): string[] {
  const items = [
    "המספרים מתארים רק את קובץ המדגם שסופק ואינם טענה על כלל השוק.",
  ];

  if (result.sampleSize > 0 && result.sampleSize < 5) {
    items.push("המדגם קטן מ-5 עסקאות, ולכן כדאי לפרש את התוצאה בזהירות.");
  }

  if (result.excluded.total > 0) {
    items.push(
      `${result.excluded.total} רשומות בתחום הבקשה הוחרגו בגלל איכות נתונים, סתירה או דיוק תאריך.`,
    );
  }

  if (result.excluded.ambiguousMonthDate > 0) {
    items.push(
      `${result.excluded.ambiguousMonthDate} רשומות עם תאריך ברמת חודש חפפו חלקית לטווח שביקשת והוחרגו במקום להמציא יום עסקה.`,
    );
  }

  if (
    plan.metric === "median_price_sqm" ||
    plan.metric === "average_price_sqm"
  ) {
    items.push(
      "מחיר למ״ר מחושב מחדש כמחיר ÷ שטח; הערך שסופק בקובץ נשמר רק לבקרת איכות.",
    );
  }

  if (
    plan.filters.dateFrom &&
    quality.dateMin &&
    plan.filters.dateFrom < quality.dateMin
  ) {
    items.push(
      `טווח הבקשה מתחיל לפני תאריך העסקה המוקדם במדגם (${quality.dateMin}).`,
    );
  }

  if (
    plan.filters.dateTo &&
    quality.dateMax &&
    plan.filters.dateTo > quality.dateMax
  ) {
    items.push(
      `טווח הבקשה מסתיים אחרי תאריך העסקה המאוחר במדגם (${quality.dateMax}).`,
    );
  }

  if (result.matchedCount === 0 && plan.intent !== "quality") {
    items.push("לא נמצאו עסקאות שעומדות בכל התנאים לאחר בדיקות האיכות.");
  }

  return items;
}

export function presentation(
  plan: QueryPlan,
  result: QueryResult,
  quality: QualitySummary,
): { headline: string; summary: string } {
  if (plan.intent === "quality") {
    return {
      headline: "איכות קובץ המדגם",
      summary: `${quality.rawRows} שורות מקור, ${quality.canonicalRows} עסקאות קנוניות לאחר טיפול בכפילויות; ${quality.conflictingDealIds} מזהי עסקה סותרים נחסמו מחישובים.`,
    };
  }

  if (plan.intent === "list") {
    return {
      headline: `${format(result.matchedCount)} עסקאות תואמות`,
      summary: result.evidenceTruncated
        ? `מוצגות ${result.evidence.length} העסקאות האחרונות מתוך ${format(result.matchedCount)}.`
        : "כל העסקאות התואמות במדגם מוצגות.",
    };
  }

  if (plan.intent === "compare") {
    return {
      headline: `${METRIC_LABEL[plan.metric!]} לפי ${GROUP_LABEL[plan.groupBy!]}`,
      summary: `ההשוואה מבוססת על ${format(result.sampleSize)} עסקאות ב-${result.groups.length} קבוצות.`,
    };
  }

  if (result.value === null) {
    return {
      headline: "אין מספיק נתונים לחישוב",
      summary: "לא נמצא ערך תקף שעומד בכל התנאים ובכללי איכות הנתונים.",
    };
  }

  if (plan.metric === "count") {
    return {
      headline: `${format(result.value)} עסקאות`,
      summary: "הספירה מתבצעת ישירות על הרשומות שעומדות בכל המסננים.",
    };
  }

  const suffix =
    plan.metric === "median_price_sqm" ||
    plan.metric === "average_price_sqm"
      ? " ₪ למ״ר"
      : " ₪";

  return {
    headline: `${METRIC_LABEL[plan.metric!]}: ${format(result.value)}${suffix}`,
    summary: `החישוב מבוסס על ${format(result.sampleSize)} עסקאות תקינות במדגם.`,
  };
}
