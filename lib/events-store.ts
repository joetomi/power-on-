import "server-only";

import {
  BlobPreconditionFailedError,
  get,
  put,
} from "@vercel/blob";
import type { RouterEvent, RouterEventType } from "./event-types";

const EVENTS_PATH = "events.json";
const MAX_WRITE_ATTEMPTS = 4;

const getStoreOptions = () => {
  const storeId =
    process.env.BLOB_STORE_ID ??
    process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;

  return storeId ? { storeId } : {};
};

interface EventStoreFile {
  version: 1;
  confirmedState: boolean | null;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  events: RouterEvent[];
}

interface StoreSnapshot {
  data: EventStoreFile;
  etag: string | null;
}

const createEmptyStore = (): EventStoreFile => ({
  version: 1,
  confirmedState: null,
  consecutiveSuccesses: 0,
  consecutiveFailures: 0,
  events: [],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRouterEvent(value: unknown): value is RouterEvent {
  if (!isRecord(value)) return false;

  return (
    (value.type === "online" || value.type === "offline") &&
    typeof value.timestamp === "string" &&
    Number.isFinite(Date.parse(value.timestamp)) &&
    typeof value.timestampMs === "number" &&
    Number.isFinite(value.timestampMs)
  );
}

function normalizeEvents(value: unknown): RouterEvent[] {
  if (!Array.isArray(value)) return [];

  const sorted = value
    .filter(isRouterEvent)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  return sorted.reduce<RouterEvent[]>((events, event) => {
    const previous = events.at(-1);

    if (previous?.type === event.type) return events;
    if (previous?.timestampMs === event.timestampMs) return events;

    events.push(event);
    return events;
  }, []);
}

function normalizeCounter(value: unknown, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), maximum);
}

function normalizeStore(value: unknown): EventStoreFile {
  const events = normalizeEvents(Array.isArray(value) ? value : isRecord(value) ? value.events : []);

  if (!isRecord(value) || Array.isArray(value)) {
    const latest = events.at(-1);
    return {
      ...createEmptyStore(),
      confirmedState: latest ? latest.type === "online" : null,
      events,
    };
  }

  const latest = events.at(-1);
  const confirmedState =
    typeof value.confirmedState === "boolean"
      ? value.confirmedState
      : latest
        ? latest.type === "online"
        : null;

  return {
    version: 1,
    confirmedState,
    consecutiveSuccesses: normalizeCounter(value.consecutiveSuccesses, 2),
    consecutiveFailures: normalizeCounter(value.consecutiveFailures, 3),
    events,
  };
}

async function readStore(): Promise<StoreSnapshot> {
  const result = await get(EVENTS_PATH, {
    access: "private",
    useCache: false,
    ...getStoreOptions(),
  });

  if (!result) {
    return { data: createEmptyStore(), etag: null };
  }

  if (result.statusCode !== 200) {
    throw new Error("Unable to read events.json.");
  }

  const value: unknown = await new Response(result.stream).json();
  return {
    data: normalizeStore(value),
    etag: result.blob.etag,
  };
}

async function writeStore(data: EventStoreFile, etag: string | null) {
  await put(EVENTS_PATH, JSON.stringify(data, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: etag !== null,
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
    ...getStoreOptions(),
    ...(etag ? { ifMatch: etag } : {}),
  });
}

function addTransitionEvent(
  events: RouterEvent[],
  type: RouterEventType,
  timestampMs: number,
) {
  const previous = events.at(-1);
  if (previous?.type === type) return events;

  return [
    ...events,
    {
      type,
      timestamp: new Date(timestampMs).toISOString(),
      timestampMs,
    },
  ];
}

function applySample(
  current: EventStoreFile,
  sampleOnline: boolean,
  timestampMs: number,
): EventStoreFile {
  const next: EventStoreFile = {
    ...current,
    events: [...current.events],
  };

  if (current.confirmedState === null) {
    if (sampleOnline) {
      next.consecutiveSuccesses = Math.min(current.consecutiveSuccesses + 1, 2);
      next.consecutiveFailures = 0;

      if (next.consecutiveSuccesses >= 2) {
        next.confirmedState = true;
      }
    } else {
      next.consecutiveFailures = Math.min(current.consecutiveFailures + 1, 3);
      next.consecutiveSuccesses = 0;

      if (next.consecutiveFailures >= 3) {
        next.confirmedState = false;
      }
    }

    return next;
  }

  if (current.confirmedState) {
    if (sampleOnline) {
      next.consecutiveSuccesses = 2;
      next.consecutiveFailures = 0;
      return next;
    }

    next.consecutiveSuccesses = 0;
    next.consecutiveFailures = Math.min(current.consecutiveFailures + 1, 3);

    if (next.consecutiveFailures >= 3) {
      next.confirmedState = false;
      next.events = addTransitionEvent(next.events, "offline", timestampMs);
    }

    return next;
  }

  if (!sampleOnline) {
    next.consecutiveSuccesses = 0;
    next.consecutiveFailures = 3;
    return next;
  }

  next.consecutiveFailures = 0;
  next.consecutiveSuccesses = Math.min(current.consecutiveSuccesses + 1, 2);

  if (next.consecutiveSuccesses >= 2) {
    next.confirmedState = true;
    next.events = addTransitionEvent(next.events, "online", timestampMs);
  }

  return next;
}

function storesMatch(first: EventStoreFile, second: EventStoreFile) {
  return JSON.stringify(first) === JSON.stringify(second);
}

export async function recordRouterSample(sampleOnline: boolean) {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const snapshot = await readStore();
    const next = applySample(snapshot.data, sampleOnline, Date.now());

    if (storesMatch(snapshot.data, next) && snapshot.etag) {
      return { online: next.confirmedState === true };
    }

    try {
      await writeStore(next, snapshot.etag);
      return { online: next.confirmedState === true };
    } catch (error) {
      const canRetry =
        error instanceof BlobPreconditionFailedError || snapshot.etag === null;

      if (!canRetry || attempt === MAX_WRITE_ATTEMPTS - 1) throw error;
    }
  }

  throw new Error("Unable to update events.json.");
}

export async function getRouterEvents() {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const snapshot = await readStore();

    if (!snapshot.etag) {
      try {
        await writeStore(snapshot.data, null);
      } catch (error) {
        if (attempt === MAX_WRITE_ATTEMPTS - 1) throw error;
        continue;
      }
    }

    return [...snapshot.data.events].sort((a, b) => b.timestampMs - a.timestampMs);
  }

  return [];
}
