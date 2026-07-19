export type RouterEventType = "offline" | "online";

export interface RouterEvent {
  type: RouterEventType;
  timestamp: string;
  timestampMs: number;
}
