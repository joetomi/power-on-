"use client";

import { useEffect, useState } from "react";

type ConnectionState = "checking" | "online" | "offline";

const STATUS_COPY = {
  checking: {
    eyebrow: "جاري فحص الاتصال",
    title: "لحظة واحدة",
    description: "نتحقق من وصول الطاقة إلى الراوتر",
  },
  online: {
    eyebrow: "النظام متصل",
    title: "الطاقة تعمل",
    description: "الراوتر متاح ويستجيب بشكل طبيعي",
  },
  offline: {
    eyebrow: "الاتصال منقطع",
    title: "الطاقة متوقفة",
    description: "تعذّر الوصول إلى الراوتر في آخر فحص",
  },
} as const;

function getPingDetails(ping: number | null) {
  if (ping === null) return { quality: "غير متاح", strength: 0 };
  if (ping <= 150) return { quality: "ممتاز", strength: 4 };
  if (ping <= 300) return { quality: "جيد", strength: 3 };
  if (ping <= 600) return { quality: "مرتفع", strength: 2 };
  return { quality: "بطيء", strength: 1 };
}

export default function Home() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [ping, setPing] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let nextCheckId: number | undefined;
    let currentRequest: AbortController | undefined;

    const checkStatus = async () => {
      currentRequest = new AbortController();

      try {
        const response = await fetch("/api/status", {
          cache: "no-store",
          signal: currentRequest.signal,
        });
        const data: { online?: unknown; ping?: unknown } = await response.json();

        if (!active) return;

        const isOnline = response.ok && data.online === true;
        setConnectionState(isOnline ? "online" : "offline");
        setPing(isOnline && typeof data.ping === "number" ? data.ping : null);
      } catch {
        if (!active) return;
        setConnectionState("offline");
        setPing(null);
      } finally {
        if (active) {
          setLastChecked(
            new Intl.DateTimeFormat("ar-LY", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(new Date()),
          );
          nextCheckId = window.setTimeout(checkStatus, 5_000);
        }
      }
    };

    void checkStatus();

    return () => {
      active = false;
      currentRequest?.abort();
      if (nextCheckId !== undefined) window.clearTimeout(nextCheckId);
    };
  }, []);

  const copy = STATUS_COPY[connectionState];
  const { quality, strength } = getPingDetails(ping);

  return (
    <main className={`status-page is-${connectionState}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="monitor" aria-live="polite" aria-atomic="true">
        <header className="status-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            {copy.eyebrow}
          </div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </header>

        <div className="power-stage" role="img" aria-label={copy.title}>
          <div className="orbit orbit-outer" />
          <div className="orbit orbit-inner" />
          <div className="power-core">
            <div className="power-symbol" aria-hidden="true">
              <span className="power-stem" />
              <span className="power-ring" />
            </div>
          </div>
        </div>

        <div className="metrics-card">
          <div className="ping-reading">
            <div className="metric-heading">
              <span>البنق</span>
              <span className="http-label">HTTP</span>
            </div>
            <div className="ping-value">
              <strong>{ping ?? "—"}</strong>
              <span>ms</span>
            </div>
          </div>

          <div className="metric-divider" />

          <div className="quality-reading">
            <div className={`signal-bars strength-${strength}`} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div>
              <span className="quality-label">جودة الاستجابة</span>
              <strong>{quality}</strong>
            </div>
          </div>
        </div>

        <footer className="last-check">
          <span className="refresh-indicator" aria-hidden="true" />
          {lastChecked ? `آخر فحص ${lastChecked}` : "الفحص الأول قيد التنفيذ"}
          <span className="separator">•</span>
          تحديث كل 5 ثوانٍ
        </footer>
      </section>
    </main>
  );
}
