import { NextResponse } from "next/server";
import { recordRouterSample } from "@/lib/events-store";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);
  const startedAt = performance.now();
  let sampleOnline = false;
  let ping: number | null = null;

  try {
    await fetch("http://41.242.17.31", {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });

    sampleOnline = true;
    ping = Math.round(performance.now() - startedAt);
  } catch {
    sampleOnline = false;
  } finally {
    clearTimeout(timeoutId);
  }

  let confirmedOnline = sampleOnline;

  try {
    const confirmedState = await recordRouterSample(sampleOnline);
    confirmedOnline = confirmedState.online;
  } catch {
    // Keep the live indicator operational if Blob is not configured or unavailable.
  }

  return NextResponse.json(
    { online: confirmedOnline, ping: confirmedOnline ? ping : null },
    { headers: NO_CACHE_HEADERS },
  );
}
