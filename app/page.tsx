"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PowerState = "checking" | "online" | "offline";

const STATE_CONTENT = {
  checking: {
    label: "فحص النظام",
    title: "نقوم بالفحص",
    description: "نتحقق الآن من حالة الكهرباء واتصال الراوتر.",
  },
  online: {
    label: "النظام يعمل بصورة طبيعية",
    title: "الكهرباء موجودة",
    description: "الراوتر متصل ويستجيب لطلبات الفحص.",
  },
  offline: {
    label: "تم رصد انقطاع",
    title: "الكهرباء غير موجودة",
    description: "تعذّر الوصول إلى الراوتر بعد تأكيد حالة الانقطاع.",
  },
} as const;

export default function Home() {
  const [powerState, setPowerState] = useState<PowerState>("checking");
  const [ping, setPing] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    let active = true;
    let timeoutId: number | undefined;
    let requestController: AbortController | undefined;

    const checkStatus = async () => {
      requestController = new AbortController();

      try {
        const response = await fetch("/api/status", {
          cache: "no-store",
          signal: requestController.signal,
        });
        const data: { online?: unknown; ping?: unknown } = await response.json();

        if (!active) return;

        const isOnline = response.ok && data.online === true;
        setPowerState(isOnline ? "online" : "offline");
        setPing(isOnline && typeof data.ping === "number" ? data.ping : null);
      } catch {
        if (!active) return;
        setPowerState("offline");
        setPing(null);
      } finally {
        if (active) {
          setLastChecked(
            new Intl.DateTimeFormat("ar-LY", {
              timeZone: "Africa/Tripoli",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(new Date()),
          );
          setCycle((current) => current + 1);
          timeoutId = window.setTimeout(checkStatus, 5_000);
        }
      }
    };

    void checkStatus();

    return () => {
      active = false;
      requestController?.abort();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  const content = STATE_CONTENT[powerState];

  return (
    <main className={`control-page control-${powerState}`}>
      <div className="control-grid" aria-hidden="true" />
      <div className="control-glow" aria-hidden="true" />

      <div className="control-shell">
        <header className="control-header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <div>
              <strong>لوحة الطاقة</strong>
              <span>POWER CONTROL</span>
            </div>
          </div>

          <Link className="reports-link" href="/reports">
            <span>عرض التقارير</span>
            <span className="link-arrow" aria-hidden="true">←</span>
          </Link>
        </header>

        <section className="power-console" aria-live="polite" aria-atomic="true">
          <div className="console-copy">
            <div className="system-label">
              <span className="system-dot" aria-hidden="true" />
              {content.label}
            </div>

            <div className="title-block">
              <span>حالة الكهرباء الآن</span>
              <h1>{content.title}</h1>
              <p>{content.description}</p>
            </div>

            <div className="telemetry" aria-label="معلومات الفحص">
              <div className="telemetry-item">
                <span>زمن الاستجابة</span>
                <strong className="ping-number">
                  {ping ?? "—"}
                  <small>ms</small>
                </strong>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item">
                <span>آخر فحص</span>
                <strong>{lastChecked ?? "جارٍ الفحص"}</strong>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item">
                <span>دورة التحديث</span>
                <strong>5 ثوانٍ</strong>
              </div>
            </div>
          </div>

          <div className="power-display" role="img" aria-label={content.title}>
            <div className="display-halo" />
            <div className="display-ring ring-one" />
            <div className="display-ring ring-two" />
            <div className="power-button">
              <div className="power-icon" aria-hidden="true">
                <span className="icon-stem" />
                <span className="icon-ring" />
              </div>
            </div>
            <span className="display-caption">POWER</span>
          </div>

          <div className="scan-status">
            <div className="scan-copy">
              <span className="scan-icon" aria-hidden="true" />
              <span>الفحص التلقائي نشط</span>
            </div>
            <div className="scan-track" aria-hidden="true">
              <span key={cycle} />
            </div>
          </div>
        </section>

        <footer className="control-footer">
          <span>مراقبة مباشرة عبر خادم Vercel</span>
          <span className="footer-separator">•</span>
          <span>توقيت طرابلس</span>
        </footer>
      </div>
    </main>
  );
}
