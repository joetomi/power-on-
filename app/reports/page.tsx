"use client";

import { useEffect, useMemo, useState } from "react";
import type { RouterEvent } from "@/lib/event-types";
import styles from "./reports.module.css";

const TRIPOLI_TIME_ZONE = "Africa/Tripoli";

const dateFormatter = new Intl.DateTimeFormat("ar-LY", {
  timeZone: TRIPOLI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const excelDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TRIPOLI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const numberFormatter = new Intl.NumberFormat("ar-LY", {
  useGrouping: false,
});

interface Outage {
  offlineAt: RouterEvent;
  onlineAt: RouterEvent | null;
}

function isRouterEvent(value: unknown): value is RouterEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<RouterEvent>;

  return (
    (event.type === "online" || event.type === "offline") &&
    typeof event.timestamp === "string" &&
    typeof event.timestampMs === "number" &&
    Number.isFinite(event.timestampMs)
  );
}

function pairOutages(events: RouterEvent[]) {
  const chronological = [...events].sort((a, b) => a.timestampMs - b.timestampMs);
  const outages: Outage[] = [];
  let pendingOffline: RouterEvent | null = null;

  for (const event of chronological) {
    if (event.type === "offline" && !pendingOffline) {
      pendingOffline = event;
    } else if (event.type === "online" && pendingOffline) {
      outages.push({ offlineAt: pendingOffline, onlineAt: event });
      pendingOffline = null;
    }
  }

  if (pendingOffline) outages.push({ offlineAt: pendingOffline, onlineAt: null });
  return outages.reverse();
}

function outageDuration(outage: Outage, now: number) {
  return Math.max(0, (outage.onlineAt?.timestampMs ?? now) - outage.offlineAt.timestampMs);
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return `${numberFormatter.format(hours)} س ${numberFormatter.format(minutes)} د ${numberFormatter.format(seconds)} ث`;
}

function formatDate(timestampMs: number | null) {
  return timestampMs === null ? "—" : dateFormatter.format(new Date(timestampMs));
}

function escapeCsv(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeXml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatExcelDate(timestampMs: number) {
  const parts = Object.fromEntries(
    excelDateFormatter
      .formatToParts(new Date(timestampMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000`;
}

function textCell(value: string, style = "Text") {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function numberCell(value: number, style = "Number") {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${value}</Data></Cell>`;
}

function dateCell(timestampMs: number | null) {
  if (timestampMs === null) return textCell("—");
  return `<Cell ss:StyleID="Date"><Data ss:Type="DateTime">${formatExcelDate(timestampMs)}</Data></Cell>`;
}

export default function ReportsPage() {
  const [events, setEvents] = useState<RouterEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [connectionOnline, setConnectionOnline] = useState<boolean | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    let monitorId: number | undefined;
    const requestController = new AbortController();

    const refresh = async () => {
      try {
        const statusResponse = await fetch("/api/status", {
          cache: "no-store",
          signal: requestController.signal,
        });
        const statusData: { online?: unknown } = await statusResponse.json();

        if (active) {
          setConnectionOnline(statusResponse.ok && statusData.online === true);
          setLastRefresh(Date.now());
        }

        const response = await fetch("/api/history", {
          cache: "no-store",
          signal: requestController.signal,
        });
        const data: { events?: unknown } = await response.json();

        if (!response.ok) throw new Error("History is unavailable.");

        if (active) {
          setEvents(Array.isArray(data.events) ? data.events.filter(isRouterEvent) : []);
          setError(false);
          setLoading(false);
        }
      } catch {
        if (active) {
          setError(true);
          setLoading(false);
        }
      } finally {
        if (active) monitorId = window.setTimeout(refresh, 5_000);
      }
    };

    void refresh();
    const clockId = window.setInterval(() => setNow(Date.now()), 1_000);

    return () => {
      active = false;
      requestController.abort();
      window.clearInterval(clockId);
      if (monitorId !== undefined) window.clearTimeout(monitorId);
    };
  }, []);

  const outages = useMemo(() => pairOutages(events), [events]);
  const durations = outages.map((outage) => outageDuration(outage, now));
  const totalDuration = durations.reduce((total, duration) => total + duration, 0);
  const longestDuration = durations.length > 0 ? Math.max(...durations) : 0;
  const lastOffline = events.find((event) => event.type === "offline") ?? null;
  const lastOnline = events.find((event) => event.type === "online") ?? null;

  const downloadCsv = () => {
    const header = ["تاريخ ووقت الانقطاع", "تاريخ ووقت العودة", "مدة الانقطاع", "الحالة"];
    const rows = outages.map((outage) => [
      formatDate(outage.offlineAt.timestampMs),
      formatDate(outage.onlineAt?.timestampMs ?? null),
      formatDuration(outageDuration(outage, now)),
      outage.onlineAt ? "انتهى" : "مستمر",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => escapeCsv(value)).join(","))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "router-outages-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadExcel = () => {
    const summaryRows = [
      `${textCell("البيان", "Header")}${textCell("القيمة", "Header")}`,
      `${textCell("إجمالي الانقطاعات")}${numberCell(outages.length)}`,
      `${textCell("إجمالي مدة الانقطاع")}${numberCell(totalDuration / 86_400_000, "Duration")}`,
      `${textCell("أطول مدة انقطاع")}${numberCell(longestDuration / 86_400_000, "Duration")}`,
      `${textCell("آخر انقطاع")}${dateCell(lastOffline?.timestampMs ?? null)}`,
      `${textCell("آخر عودة للاتصال")}${dateCell(lastOnline?.timestampMs ?? null)}`,
      `${textCell("المنطقة الزمنية")}${textCell(TRIPOLI_TIME_ZONE)}`,
    ].map((cells) => `<Row>${cells}</Row>`);

    const outageRows = outages.map((outage) => {
      const duration = outageDuration(outage, now) / 86_400_000;
      const status = outage.onlineAt ? "انتهى" : "مستمر";
      const statusStyle = outage.onlineAt ? "Resolved" : "Ongoing";

      return `<Row>${dateCell(outage.offlineAt.timestampMs)}${dateCell(
        outage.onlineAt?.timestampMs ?? null,
      )}${numberCell(duration, "Duration")}${textCell(status, statusStyle)}</Row>`;
    });

    const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="11"/></Style>
  <Style ss:ID="Title"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="16" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#00A847" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Header"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#20262C" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#59616A"/></Borders></Style>
  <Style ss:ID="Text"><Alignment ss:Horizontal="Right"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9DDE1"/></Borders></Style>
  <Style ss:ID="Number"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="0"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9DDE1"/></Borders></Style>
  <Style ss:ID="Date"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="yyyy-mm-dd hh:mm:ss"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9DDE1"/></Borders></Style>
  <Style ss:ID="Duration"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="[h]:mm:ss"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9DDE1"/></Borders></Style>
  <Style ss:ID="Resolved"><Alignment ss:Horizontal="Center"/><Font ss:Color="#087A3D" ss:Bold="1"/><Interior ss:Color="#E1F6EA" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Ongoing"><Alignment ss:Horizontal="Center"/><Font ss:Color="#B51F34" ss:Bold="1"/><Interior ss:Color="#FCE5E8" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="الملخص">
  <Table>
   <Column ss:Width="190"/><Column ss:Width="190"/>
   <Row ss:Height="32"><Cell ss:MergeAcross="1" ss:StyleID="Title"><Data ss:Type="String">تقرير انقطاع اتصال الراوتر</Data></Cell></Row>
   ${summaryRows.join("\n   ")}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions>
 </Worksheet>
 <Worksheet ss:Name="الانقطاعات">
  <Table>
   <Column ss:Width="155"/><Column ss:Width="155"/><Column ss:Width="100"/><Column ss:Width="80"/>
   <Row>${textCell("وقت الانقطاع", "Header")}${textCell("وقت عودة الاتصال", "Header")}${textCell("المدة", "Header")}${textCell("الحالة", "Header")}</Row>
   ${outageRows.join("\n   ")}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([`\uFEFF${workbook}`], {
      type: "application/vnd.ms-excel;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "router-outages-report.xls";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>سجل الاتصال</span>
            <h1>تقارير الانقطاع</h1>
            <p>جميع التواريخ معروضة بتوقيت طرابلس</p>
          </div>
          <div className={`${styles.actions} ${styles.printHidden}`}>
            <button type="button" className={styles.excelButton} onClick={downloadExcel}>
              تصدير Excel
            </button>
            <button type="button" className={styles.secondaryButton} onClick={downloadCsv}>
              تنزيل CSV
            </button>
            <button type="button" className={styles.primaryButton} onClick={() => window.print()}>
              طباعة التقرير
            </button>
          </div>
        </header>

        <section
          className={`${styles.liveStatus} ${
            connectionOnline === null
              ? styles.liveChecking
              : connectionOnline
                ? styles.liveOnline
                : styles.liveOffline
          }`}
          aria-live="polite"
        >
          <span className={styles.livePulse} aria-hidden="true" />
          <div className={styles.liveCopy}>
            <span>حالة الاتصال الآن</span>
            <strong>
              {connectionOnline === null
                ? "جارٍ الفحص"
                : connectionOnline
                  ? "الراوتر متصل"
                  : "الراوتر غير متصل"}
            </strong>
          </div>
          <div className={styles.refreshTime}>
            <span>آخر تحديث</span>
            <strong>{lastRefresh ? formatDate(lastRefresh) : "—"}</strong>
          </div>
        </section>

        {error && (
          <div className={styles.errorBanner} role="alert">
            تعذّر قراءة السجل. تأكد من ربط Vercel Blob وإضافة متغير البيئة.
          </div>
        )}

        <section className={styles.stats} aria-label="ملخص الانقطاعات">
          <article className={styles.statCard}>
            <span>إجمالي الانقطاعات</span>
            <strong>{numberFormatter.format(outages.length)}</strong>
          </article>
          <article className={styles.statCard}>
            <span>إجمالي مدة الانقطاع</span>
            <strong>{formatDuration(totalDuration)}</strong>
          </article>
          <article className={styles.statCard}>
            <span>أطول مدة انقطاع</span>
            <strong>{formatDuration(longestDuration)}</strong>
          </article>
          <article className={styles.statCard}>
            <span>آخر انقطاع</span>
            <strong>{formatDate(lastOffline?.timestampMs ?? null)}</strong>
          </article>
          <article className={styles.statCard}>
            <span>آخر عودة للاتصال</span>
            <strong>{formatDate(lastOnline?.timestampMs ?? null)}</strong>
          </article>
        </section>

        <section className={styles.tableCard}>
          <div className={styles.tableHeading}>
            <div>
              <h2>سجل الانقطاعات</h2>
              <p>{loading ? "جارٍ تحميل السجل…" : `${numberFormatter.format(outages.length)} انقطاع مسجل`}</p>
            </div>
            <span className={styles.liveBadge}>تحديث مباشر</span>
          </div>

          <div className={styles.tableWrapper}>
            <table>
              <thead>
                <tr>
                  <th>وقت الانقطاع</th>
                  <th>وقت عودة الاتصال</th>
                  <th>المدة</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {!loading && outages.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={styles.emptyState}>
                      لا توجد انقطاعات مسجلة حتى الآن
                    </td>
                  </tr>
                ) : (
                  outages.map((outage) => {
                    const ongoing = outage.onlineAt === null;
                    return (
                      <tr key={outage.offlineAt.timestampMs}>
                        <td>{formatDate(outage.offlineAt.timestampMs)}</td>
                        <td>{formatDate(outage.onlineAt?.timestampMs ?? null)}</td>
                        <td className={styles.durationCell}>
                          {formatDuration(outageDuration(outage, now))}
                        </td>
                        <td>
                          <span className={ongoing ? styles.ongoing : styles.resolved}>
                            {ongoing ? "مستمر" : "انتهى"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
