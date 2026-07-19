import { NextResponse } from "next/server";
import { getRouterEvents } from "@/lib/events-store";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET() {
  try {
    const events = await getRouterEvents();
    return NextResponse.json({ events }, { headers: NO_CACHE_HEADERS });
  } catch {
    return NextResponse.json(
      { events: [], error: "History storage is unavailable." },
      { status: 503, headers: NO_CACHE_HEADERS },
    );
  }
}
