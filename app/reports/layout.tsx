import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "تقارير انقطاع الطاقة",
  description: "سجل أوقات انقطاع وعودة اتصال الراوتر.",
};

export default function ReportsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
