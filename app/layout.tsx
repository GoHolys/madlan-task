import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Madlan Evidence Assistant",
  description: "עוזר אנליטי מבוסס ראיות לעסקאות הנדל״ן במדגם",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
