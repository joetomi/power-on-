"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let active = true;

    const checkStatus = async () => {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const data: { online?: unknown } = await response.json();

        if (active) {
          setOnline(response.ok && data.online === true);
        }
      } catch {
        if (active) {
          setOnline(false);
        }
      }
    };

    void checkStatus();
    const intervalId = window.setInterval(checkStatus, 10_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <main>
      <div className={`status ${online ? "online" : "offline"}`} />
    </main>
  );
}
