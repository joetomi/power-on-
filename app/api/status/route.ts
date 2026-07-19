import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);

  try {
    await fetch("http://41.242.17.31", {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });

    return NextResponse.json({ online: true }, { headers: NO_CACHE_HEADERS });
  } catch {
    return NextResponse.json({ online: false }, { headers: NO_CACHE_HEADERS });
  } finally {
    clearTimeout(timeoutId);
  }
}
