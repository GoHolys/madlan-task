import type { PublicAnswer, QueryPlan } from "../contracts";

type VisibleAnswer = Exclude<PublicAnswer, { status: "error" }>;
type SuccessAnswer = Extract<VisibleAnswer, { status: "ok" }>;

const number = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });

function formatMetric(value: number | null, metric: QueryPlan["metric"]): string {
  if (value === null) return "—";
  if (metric === "count") return number.format(value);
  if (metric === "median_price_sqm" || metric === "average_price_sqm") {
    return `${number.format(value)} ₪/מ״ר`;
  }
  return `${number.format(value)} ₪`;
}

function Filters({ items }: { items: string[] }) {
  if (!items.length) {
    return <span className="text-slate-500">ללא מסננים נוספים</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function Comparison({ answer }: { answer: SuccessAnswer }) {
  if (!answer.result.groups.length) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800">
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-slate-800 bg-slate-950/70 px-4 py-3 text-xs font-semibold text-slate-400">
        <span>קבוצה</span>
        <span>תוצאה</span>
        <span>n</span>
      </div>
      {answer.result.groups.map((group) => (
        <div
          key={group.key}
          className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-slate-800/70 px-4 py-3 text-sm last:border-0"
        >
          <span className="font-medium text-slate-100">{group.key}</span>
          <span className="tabular-nums text-cyan-200">
            {formatMetric(group.value, answer.plan.metric)}
          </span>
          <span className="min-w-8 text-left tabular-nums text-slate-400">
            {number.format(group.sampleSize)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Quality({ answer }: { answer: SuccessAnswer }) {
  if (answer.plan.intent !== "quality") return null;

  const cards = [
    ["שורות מקור", answer.quality.rawRows],
    ["עסקאות קנוניות", answer.quality.canonicalRows],
    ["כפילויות זהות שהוסרו", answer.quality.exactDuplicatesRemoved],
    ["מזהים סותרים", answer.quality.conflictingDealIds],
    ["תקינות למחיר", answer.quality.priceEligibleRows],
    ["תקינות למחיר למ״ר", answer.quality.priceSqmEligibleRows],
    ["מחיר חסר", answer.quality.missingPriceRows],
    ["שטח חסר", answer.quality.missingSizeRows],
    ["תאריך ברמת חודש", answer.quality.monthOnlyDateRows],
    ["מחיר חשוד", answer.quality.issueCounts.suspicious_price ?? 0],
    ["סטיית מחיר/מ״ר מעל 5%", answer.quality.issueCounts.price_per_sqm_mismatch ?? 0],
  ] as const;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
          <div className="text-xs text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-100">
            {number.format(value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Evidence({ answer }: { answer: SuccessAnswer }) {
  if (!answer.result.evidence.length) return null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-100">עסקאות תומכות</h3>
          <p className="mt-1 text-xs text-slate-500">
            אותן רשומות ואותם מסננים ששימשו לחישוב.
          </p>
        </div>
        {answer.result.evidenceTruncated ? (
          <span className="text-xs text-slate-500">
            מוצגות {answer.result.evidence.length} מתוך {number.format(answer.result.matchedCount)}
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full min-w-[850px] border-collapse text-sm">
          <thead className="bg-slate-950/80 text-xs text-slate-400">
            <tr>
              <th className="px-3 py-3 text-right font-semibold">עסקה</th>
              <th className="px-3 py-3 text-right font-semibold">מיקום</th>
              <th className="px-3 py-3 text-right font-semibold">נכס</th>
              <th className="px-3 py-3 text-right font-semibold">תאריך</th>
              <th className="px-3 py-3 text-right font-semibold">מחיר</th>
              <th className="px-3 py-3 text-right font-semibold">מחיר/מ״ר</th>
              <th className="px-3 py-3 text-right font-semibold">מקור</th>
            </tr>
          </thead>
          <tbody>
            {answer.result.evidence.map((deal) => (
              <tr key={deal.dealId} className="border-t border-slate-800/80 text-slate-300">
                <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-500">
                  {deal.dealId}
                </td>
                <td className="px-3 py-3">
                  <div className="font-medium text-slate-100">{deal.city}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {[deal.neighborhood, deal.street].filter(Boolean).join(" · ") || "—"}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div>{deal.propertyType}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {deal.rooms ?? "—"} חד׳ · {deal.sizeSqm ?? "—"} מ״ר
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  {deal.dealDateRaw ?? deal.dealDate ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                  {deal.priceNis === null ? "—" : `${number.format(deal.priceNis)} ₪`}
                </td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                  {deal.pricePerSqm === null ? "—" : `${number.format(deal.pricePerSqm)} ₪`}
                </td>
                <td className="whitespace-nowrap px-3 py-3">{deal.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ResultPanel({ answer }: { answer: VisibleAnswer }) {
  if (answer.status === "unsupported") {
    return (
      <section className="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5 sm:p-6">
        <p className="text-sm font-semibold text-amber-200">לא מרחיבים את השאלה בשקט</p>
        <h2 className="mt-2 text-xl font-bold text-white">אי אפשר לענות על הבקשה באופן נאמן</h2>
        <p className="mt-3 max-w-3xl leading-7 text-amber-50/90">{answer.message}</p>
        <p className="mt-4 text-xs text-amber-100/60">Request ID: {answer.requestId}</p>
      </section>
    );
  }

  const sources = Object.entries(answer.result.sourceBreakdown);
  const exclusions = answer.result.excluded;

  return (
    <section className="space-y-5 rounded-3xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div>
          <p className="text-xs font-semibold text-cyan-300">תשובה מבוססת נתונים</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {answer.headline}
          </h2>
          <p className="mt-3 max-w-3xl leading-7 text-slate-300">{answer.summary}</p>
          <div className="mt-4">
            <Filters items={answer.appliedFilters} />
          </div>
        </div>

        <aside className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4">
          <div className="text-xs font-semibold text-cyan-200">אמינות התשובה</div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">גודל מדגם</dt>
              <dd className="font-medium tabular-nums text-slate-100">
                {number.format(answer.result.sampleSize)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">הוחרגו</dt>
              <dd className="font-medium tabular-nums text-slate-100">
                {number.format(exclusions.total)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">גרסת נתונים</dt>
              <dd className="font-mono text-xs text-slate-300">{answer.quality.fingerprint}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <Quality answer={answer} />
      <Comparison answer={answer} />

      {answer.warnings.length ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
          <h3 className="text-sm font-semibold text-amber-200">מה חשוב לדעת</h3>
          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-amber-50/80">
            {answer.warnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Evidence answer={answer} />

      <details className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-200">
          איך חושב המספר?
        </summary>
        <div className="mt-4 grid gap-5 text-sm lg:grid-cols-3">
          <div>
            <h4 className="font-semibold text-slate-300">פירוש ה-AI</h4>
            <p className="mt-2 leading-6 text-slate-500">{answer.plan.reason}</p>
            <p className="mt-2 text-xs text-slate-600">
              ה-AI בוחר רק מתוך חוזה שאילתה סגור; הוא לא מחשב את התוצאה.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-slate-300">החרגות</h4>
            <ul className="mt-2 space-y-1 text-slate-500">
              <li>רשומות חסומות/סותרות: {exclusions.blockedRows}</li>
              <li>מחיר חסר/חשוד: {exclusions.suspiciousOrMissingPrice}</li>
              <li>שטח חסר למחיר למ״ר: {exclusions.missingSize}</li>
              <li>תאריך חודשי חופף חלקית: {exclusions.ambiguousMonthDate}</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-slate-300">מקורות במדגם</h4>
            {sources.length ? (
              <ul className="mt-2 space-y-1 text-slate-500">
                {sources.map(([source, count]) => (
                  <li key={source}>
                    {source}: {number.format(count)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-slate-500">לא רלוונטי לשאילתה הזאת.</p>
            )}
          </div>
        </div>

        <div className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-600">
          Request ID: {answer.requestId}
        </div>
      </details>
    </section>
  );
}
