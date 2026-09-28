import type { QueryPlan } from "./contracts";
import { canonicalCategory } from "./normalization";

function mentionedCities(question: string, cities: string[]): string[] {
  const normalized = canonicalCategory(question);

  const matches = cities.filter((city) => {
    const name = canonicalCategory(city);

    if (name === "תל אביב יפו") {
      return normalized.includes("תל אביב") || /ת[״"]א/.test(question);
    }
    if (name === "באר שבע") {
      return normalized.includes("באר שבע") || /ב[״"]ש/.test(question);
    }
    if (name === "ירושלים") {
      return normalized.includes("ירושלים") || normalized.includes("jerusalem");
    }

    return normalized.includes(name);
  });

  // "מודיעין" must not win over the more specific "מודיעין מכבים רעות".
  return matches.filter((city) => {
    const name = canonicalCategory(city);
    return !matches.some((other) => {
      const otherName = canonicalCategory(other);
      return otherName.length > name.length && otherName.includes(name);
    });
  });
}

function requestedMetric(question: string): QueryPlan["metric"] | null {
  const perSqm = /למ[״"'׳]?ר|למטר\s+רבוע/.test(question);

  if (question.includes("חציון")) {
    return perSqm ? "median_price_sqm" : "median_price";
  }
  if (question.includes("ממוצע")) {
    return perSqm ? "average_price_sqm" : "average_price";
  }
  if (/כמה\s+עסקאות|מספר\s+עסקאות|כמות\s+עסקאות/.test(question)) {
    return "count";
  }

  return null;
}

function requestedRooms(
  question: string,
): { value: number; mode: "exact" | "min" | "max" } | null {
  const values = [
    ...question.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:חדרים?|חד[׳'"״]?)/g),
  ].map((match) => Number(match[1].replace(",", ".")));

  const unique = [...new Set(values.filter(Number.isFinite))];
  if (unique.length !== 1) return null;

  const value = unique[0];
  if (question.includes("לפחות") || question.includes("ומעלה")) {
    return { value, mode: "min" };
  }
  if (/עד\s+\d/.test(question) || question.includes("לכל היותר")) {
    return { value, mode: "max" };
  }

  return { value, mode: "exact" };
}

function requestedYear(question: string): number | null {
  const matches = [
    ...question.matchAll(/בשנת\s+(20\d{2})/g),
    ...question.matchAll(/(?:^|\s)ב-\s*(20\d{2})(?=\s|[?.!,]|$)/g),
  ];
  const years = [...new Set(matches.map((match) => Number(match[1])))];
  return years.length === 1 ? years[0] : null;
}

export function planDriftReason(
  question: string,
  plan: QueryPlan,
  cities: string[],
): string | null {
  if (plan.intent === "quality" || plan.intent === "unsupported") return null;

  const plannedCities = plan.filters.cities.map(canonicalCategory);
  if (
    mentionedCities(question, cities).some(
      (city) => !plannedCities.includes(canonicalCategory(city)),
    )
  ) {
    return "פירוש ה-AI לא שמר על העיר שביקשת, ולכן לא הרצתי חישוב.";
  }

  const metric = requestedMetric(question);
  if (metric && plan.metric !== metric) {
    return "פירוש ה-AI שינה את המדד שביקשת, ולכן לא הרצתי חישוב.";
  }

  const rooms = requestedRooms(question);
  if (rooms) {
    const { roomsMin, roomsMax } = plan.filters;
    const preserved =
      rooms.mode === "exact"
        ? roomsMin === rooms.value && roomsMax === rooms.value
        : rooms.mode === "min"
          ? roomsMin === rooms.value
          : roomsMax === rooms.value;

    if (!preserved) {
      return "פירוש ה-AI לא שמר על מספר החדרים שביקשת, ולכן לא הרצתי חישוב.";
    }
  }

  const year = requestedYear(question);
  if (
    year &&
    (plan.filters.dateFrom !== `${year}-01-01` ||
      plan.filters.dateTo !== `${year}-12-31`)
  ) {
    return "פירוש ה-AI לא שמר על שנת העסקה שביקשת, ולכן לא הרצתי חישוב.";
  }

  return null;
}
