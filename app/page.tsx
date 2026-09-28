import Link from "next/link";

import { Explorer } from "@/src/ui/explorer";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const failureDemoEnabled = process.env.ENABLE_FAILURE_DEMO === "true";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-14">
        <header className="mb-8 flex flex-col gap-5 border-b border-slate-800 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <p className="mb-2 text-sm font-semibold tracking-wide text-cyan-300">
              MADLAN · EVIDENCE ASSISTANT
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
              שואלים בעברית. מקבלים תשובה שאפשר לבדוק.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              ה-AI מפרש את השאלה בלבד. כל מספר מחושב באופן דטרמיניסטי מקובץ
              העסקאות שסופק, עם גודל מדגם, חריגות ועסקאות תומכות.
            </p>
          </div>

          <Link
            href="/guide"
            className="w-fit rounded-xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
          >
            מדריך ל-CSM
          </Link>
        </header>

        <Explorer failureDemoEnabled={failureDemoEnabled} />

        <footer className="mt-10 border-t border-slate-800 pt-5 text-sm leading-6 text-slate-500">
          הנתונים באפליקציה הם קובץ מדגם בלבד. אין כאן הערכת שווי, המלצת השקעה או
          טענה לכיסוי מלא של השוק.
        </footer>
      </div>
    </main>
  );
}
