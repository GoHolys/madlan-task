"use client";

import { FormEvent, useState } from "react";

import type { AskApiResponse } from "../contracts";
import { ResultPanel } from "./result";

type VisibleAnswer = Exclude<AskApiResponse, { status: "error" }>;

const EXAMPLES = [
  "מה חציון המחיר לדירות 4 חדרים בתל אביב?",
  "השווה חציון מחיר למ״ר בין הערים במדגם",
  "כמה עסקאות היו בחיפה בשנת 2024?",
  "הצג 5 עסקאות אחרונות של דירות 3 חדרים בירושלים",
  "אילו בעיות איכות יש בקובץ?",
];

export function Explorer({
  failureDemoEnabled,
}: {
  failureDemoEnabled: boolean;
}) {
  const [question, setQuestion] = useState(EXAMPLES[0]);
  const [answer, setAnswer] = useState<VisibleAnswer | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runQuestion(nextQuestion = question, simulateModelFailure = false) {
    const value = nextQuestion.trim();
    if (value.length < 2) {
      setNotice("כתבו שאלה קצרה על עסקאות המדגם.");
      return;
    }

    setQuestion(value);
    setLoading(true);
    setNotice(null);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: value,
          simulateModelFailure,
        }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as AskApiResponse;

      if (payload.status === "error") {
        setNotice(payload.message);
        return;
      }

      setAnswer(payload);
    } catch (error) {
      setNotice(
        error instanceof DOMException && error.name === "AbortError"
          ? "הבקשה ארכה יותר מדי זמן והופסקה. התוצאה הקודמת נשמרה."
          : "לא הצלחנו להגיע לשירות כרגע. התוצאה הקודמת נשמרה.",
      );
    } finally {
      window.clearTimeout(timer);
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runQuestion();
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-cyan-950/10 sm:p-6">
        <form onSubmit={submit} className="space-y-4">
          <label htmlFor="question" className="block text-sm font-semibold text-slate-200">
            מה תרצו לבדוק?
          </label>
          <textarea
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={3}
            maxLength={500}
            disabled={loading}
            className="w-full resize-none rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-base leading-7 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/10 disabled:opacity-60"
            placeholder="לדוגמה: מה חציון המחיר לדירות 4 חדרים בחיפה בשנת 2025?"
          />

          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                type="button"
                key={example}
                disabled={loading}
                onClick={() => void runQuestion(example)}
                className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-cyan-300 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "מפרש ומחשב…" : "בדוק את הנתונים"}
            </button>

            {failureDemoEnabled ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => void runQuestion(question, true)}
                className="rounded-xl border border-rose-500/50 px-4 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:opacity-50"
              >
                הדגם כשל מודל
              </button>
            ) : null}

            <p className="text-xs text-slate-500">
              ה-LLM מפרש. DuckDB מחשב. הראיות מגיעות מאותם מסננים.
            </p>
          </div>
        </form>
      </div>

      {notice ? (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100"
        >
          {notice}
        </div>
      ) : null}

      {answer ? <ResultPanel answer={answer} /> : null}
    </section>
  );
}
