import Link from "next/link";

export default function GuidePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <article className="mx-auto max-w-3xl px-5 py-10 sm:py-16">
        <Link href="/" className="text-sm font-medium text-cyan-300 hover:text-cyan-200">
          ← חזרה לכלי
        </Link>

        <p className="mt-8 text-sm font-semibold text-cyan-300">מדריך CSM · עמוד אחד</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          איך להשתמש בתשובה — ומה להגיד כשהלקוח חולק עליה
        </h1>

        <div className="mt-8 space-y-8 leading-7 text-slate-300">
          <section>
            <h2 className="text-xl font-bold text-white">מה הכלי עושה</h2>
            <p className="mt-2">
              הכלי עונה על שאלות אנליטיות לגבי קובץ העסקאות שסופק. ה-AI מפרש את
              השאלה, אבל כל מספר מחושב בנפרד מהנתונים ומגיע עם גודל מדגם, מסננים,
              החרגות ועסקאות תומכות.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white">מה הוא לא עושה</h2>
            <ul className="mt-2 list-disc space-y-1 pr-5">
              <li>לא טוען שקובץ המדגם מייצג את כל השוק.</li>
              <li>לא נותן הערכת שווי, תחזית או המלצת השקעה.</li>
              <li>לא משלים מידע חסר ולא מתקן רשומה כשאין דרך לדעת מה נכון.</li>
              <li>לא משמיט תנאי לא נתמך בשקט — הוא עוצר ואומר זאת.</li>
              <li>
                כרגע אין סינון לפי רחוב, קומה, שנת בנייה, מצב, מקור או מאפייני
                בניין/דירה.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white">איך לבדוק תשובה</h2>
            <ol className="mt-2 list-decimal space-y-1 pr-5">
              <li>בדקו שהמסננים תואמים למה שהלקוח ביקש.</li>
              <li>בדקו את n — כמה עסקאות באמת נכנסו לחישוב.</li>
              <li>קראו את האזהרות וההחרגות.</li>
              <li>פתחו את העסקאות התומכות ואת פירוט המקורות.</li>
              <li>שמרו את Request ID וגרסת הנתונים אם צריך להעביר ל-R&D.</li>
            </ol>
          </section>

          <section className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5">
            <h2 className="text-xl font-bold text-white">
              כשהלקוח אומר: “המספר הזה לא נכון”
            </h2>
            <p className="mt-3">
              “תודה שהצפת את זה. המספר שמוצג מחושב רק מקובץ העסקאות והמסננים
              שמופיעים לצד התוצאה, ולא מכלל השוק. אני בודק/ת עכשיו את החיתוך,
              גודל המדגם והרשומות שנכללו או הוחרגו. אם תשלח/י את העיר/שכונה,
              התקופה והמספר שציפית לראות, נוכל להשוות בדיוק ולזהות אם מדובר
              בהבדל בסינון, באיכות הנתונים או בטעות שדורשת תיקון.”
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white">מה להעביר ל-R&D</h2>
            <ul className="mt-2 list-disc space-y-1 pr-5">
              <li>השאלה המדויקת.</li>
              <li>Request ID וגרסת הנתונים.</li>
              <li>המסננים שהוצגו.</li>
              <li>המספר שהלקוח ציפה לקבל ולמה.</li>
              <li>עסקה ספציפית שחסרה או לא צריכה להיכלל, אם יש.</li>
            </ul>
          </section>

          <p className="border-t border-slate-800 pt-5 text-sm text-slate-500">
            אם שירות ה-AI נכשל, האפליקציה אינה מציגה מספר חלופי. זו התנהגות
            מכוונת כדי לא לערבב ניחוש עם נתונים.
          </p>
        </div>
      </article>
    </main>
  );
}
