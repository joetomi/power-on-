"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [online, setOnline] = useState(false);

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
        const data: { online?: unknown } = await response.json();

        if (active) setOnline(response.ok && data.online === true);
      } catch {
        if (active) setOnline(false);
      } finally {
        if (active) timeoutId = window.setTimeout(checkStatus, 5_000);
      }
    };

    void checkStatus();

    return () => {
      active = false;
      requestController?.abort();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <main className="home-page">
      <div
        className={`status-circle ${online ? "status-online" : "status-offline"}`}
        role="status"
        aria-label={online ? "الراوتر متصل" : "الراوتر غير متصل"}
      />
    </main>
  );
}
