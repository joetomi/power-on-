"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [online, setOnline] = useState(false);
  const [ping, setPing] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    const checkStatus = async () => {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const data: { online?: unknown; ping?: unknown } = await response.json();

        if (active) {
          const isOnline = response.ok && data.online === true;
          setOnline(isOnline);
          setPing(isOnline && typeof data.ping === "number" ? data.ping : null);
        }
      } catch {
        if (active) {
          setOnline(false);
          setPing(null);
        }
      }
    };

    void checkStatus();
    const intervalId = window.setInterval(checkStatus, 5_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <main>
      <section className="monitor" aria-live="polite">
        <p className={`power-label ${online ? "text-online" : "text-offline"}`}>
          {online ? "الطاقة تعمل" : "الطاقة لا تعمل"}
        </p>
        <div className={`status ${online ? "online" : "offline"}`} />
        <p className="ping">البنق: {ping === null ? "غير متاح" : `${ping} ms`}</p>
      </section>
    </main>
  );
}
