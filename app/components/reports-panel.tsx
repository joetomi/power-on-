"use client";

import { useMemo } from "react";
import type { RouterEvent, RouterEventType } from "@/lib/event-types";
import styles from "../reports/reports.module.css";

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

const numberFormatter = new Intl.NumberFormat("ar-LY", { useGrouping: false });

interface PowerInterval {
  type: RouterEventType;
  startedAt: number;
  endedAt: number | null;
}

interface ReportsPanelProps {
  events: RouterEvent[];
  loading: boolean;
  error: boolean;
  connectionOnline: boolean | null;
  lastRefresh: number | null;
  now: number;
}

function buildIntervals(events: RouterEvent[]) {
  const chronological = [...events].sort((a, b) => a.timestampMs - b.timestampMs);

  return chronological
    .map<PowerInterval>((event, index) => ({
      type: event.type,
      startedAt: event.timestampMs,
      endedAt: chronological[index + 1]?.timestampMs ?? null,
    }))
    .reverse();
}

function intervalDuration(interval: PowerInterval, now: number) {
  return Math.max(0, (interval.endedAt ?? now) - interval.startedAt);
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

function excelIntervalRows(intervals: PowerInterval[], now: number) {
  return intervals
    .map((interval) => {
      const ongoing = interval.endedAt === null;
      return `<Row>${dateCell(interval.startedAt)}${dateCell(interval.endedAt)}${numberCell(
        intervalDuration(interval, now) / 86_400_000,
        "Duration",
      )}${textCell(ongoing ? "مستمرة" : "انتهت", ongoing ? "Ongoing" : "Resolved")}</Row>`;
    })
    .join("\n   ");
}

function downloadBlob(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ReportsPanel({
  events,
  loading,
  error,
  connectionOnline,
  lastRefresh,
  now,
}: ReportsPanelProps) {
  const intervals = useMemo(() => buildIntervals(events), [events]);
  const outageIntervals = intervals.filter((interval) => interval.type === "offline");
  const uptimeIntervals = intervals.filter((interval) => interval.type === "online");
  const outageDurations = outageIntervals.map((interval) => intervalDuration(interval, now));
  const uptimeDurations = uptimeIntervals.map((interval) => intervalDuration(interval, now));
  const totalOutage = outageDurations.reduce((total, duration) => total + duration, 0);
  const totalUptime = uptimeDurations.reduce((total, duration) => total + duration, 0);
  const longestOutage = outageDurations.length ? Math.max(...outageDurations) : 0;
  const longestUptime = uptimeDurations.length ? Math.max(...uptimeDurations) : 0;
  const currentInterval = intervals.find((interval) => interval.endedAt === null) ?? null;
  const lastOffline = events.find((event) => event.type === "offline") ?? null;
  const lastOnline = events.find((event) => event.type === "online") ?? null;

  const downloadCsv = () => {
    const header = ["الحالة", "وقت البداية", "وقت النهاية", "المدة", "الوضع"];
    const rows = intervals.map((interval) => [
      interval.type === "online" ? "الكهرباء موجودة" : "انقطاع الكهرباء",
      formatDate(interval.startedAt),
      formatDate(interval.endedAt),
      formatDuration(intervalDuration(interval, now)),
      interval.endedAt === null ? "مستمرة" : "انتهت",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => escapeCsv(value)).join(","))
      .join("\r\n");

    downloadBlob(`\uFEFF${csv}`, "text/csv;charset=utf-8", "power-history.csv");
  };

  const downloadExcel = () => {
    const summaryRows = [
      `${textCell("البيان", "Header")}${textCell("القيمة", "Header")}`,
      `${textCell("إجمالي الانقطاعات")}${numberCell(outageIntervals.length)}`,
      `${textCell("إجمالي مدة الانقطاع")}${numberCell(totalOutage / 86_400_000, "Duration")}`,
      `${textCell("أطول مدة انقطاع")}${numberCell(longestOutage / 86_400_000, "Duration")}`,
      `${textCell("إجمالي مدة توفر الكهرباء")}${numberCell(totalUptime / 86_400_000, "Duration")}`,
      `${textCell("أطول مدة توفر للكهرباء")}${numberCell(longestUptime / 86_400_000, "Duration")}`,
      `${textCell("آخر انقطاع")}${dateCell(lastOffline?.timestampMs ?? null)}`,
      `${textCell("آخر عودة للكهرباء")}${dateCell(lastOnline?.timestampMs ?? null)}`,
      `${textCell("المنطقة الزمنية")}${textCell(TRIPOLI_TIME_ZONE)}`,
    ].map((cells) => `<Row>${cells}</Row>`);

    const worksheet = (name: string, rows: string) => `
 <Worksheet ss:Name="${name}">
  <Table>
   <Column ss:Width="155"/><Column ss:Width="155"/><Column ss:Width="100"/><Column ss:Width="80"/>
   <Row>${textCell("وقت البداية", "Header")}${textCell("وقت النهاية", "Header")}${textCell("المدة", "Header")}${textCell("الوضع", "Header")}</Row>
   ${rows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>
 </Worksheet>`;

    const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="11"/></Style>
  <Style ss:ID="Title"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="16" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#00A847" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Header"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#20262C" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Text"><Alignment ss:Horizontal="Right"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9DDE1"/></Borders></Style>
  <Style ss:ID="Number"><NumberFormat ss:Format="0"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9DDE1"/></Borders></Style>
  <Style ss:ID="Date"><NumberFormat ss:Format="yyyy-mm-dd hh:mm:ss"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9DDE1"/></Borders></Style>
  <Style ss:ID="Duration"><NumberFormat ss:Format="[h]:mm:ss"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9DDE1"/></Borders></Style>
  <Style ss:ID="Resolved"><Alignment ss:Horizontal="Center"/><Font ss:Color="#087A3D" ss:Bold="1"/><Interior ss:Color="#E1F6EA" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Ongoing"><Alignment ss:Horizontal="Center"/><Font ss:Color="#B51F34" ss:Bold="1"/><Interior ss:Color="#FCE5E8" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="الملخص"><Table><Column ss:Width="190"/><Column ss:Width="190"/><Row ss:Height="32"><Cell ss:MergeAcross="1" ss:StyleID="Title"><Data ss:Type="String">تقرير حالة الكهرباء</Data></Cell></Row>${summaryRows.join("")}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions></Worksheet>
 ${worksheet("توفر الكهرباء", excelIntervalRows(uptimeIntervals, now))}
 ${worksheet("الانقطاعات", excelIntervalRows(outageIntervals, now))}
</Workbook>`;

    downloadBlob(
      `\uFEFF${workbook}`,
      "application/vnd.ms-excel;charset=utf-8",
      "power-report.xls",
    );
  };

  return (
    <section id="reports" className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>التقارير المباشرة</span>
            <h2>سجل حالة الكهرباء</h2>
            <p>فترات توفر الكهرباء والانقطاع بتوقيت طرابلس</p>
          </div>
          <div className={`${styles.actions} ${styles.printHidden}`}>
            <button type="button" className={styles.excelButton} onClick={downloadExcel}>تصدير Excel</button>
            <button type="button" className={styles.secondaryButton} onClick={downloadCsv}>تنزيل CSV</button>
            <button type="button" className={styles.primaryButton} onClick={() => window.print()}>طباعة التقرير</button>
          </div>
        </header>

        <section className={`${styles.liveStatus} ${connectionOnline === null ? styles.liveChecking : connectionOnline ? styles.liveOnline : styles.liveOffline}`} aria-live="polite">
          <span className={styles.livePulse} aria-hidden="true" />
          <div className={styles.liveCopy}>
            <span>حالة الكهرباء الآن</span>
            <strong>{connectionOnline === null ? "جارٍ الفحص" : connectionOnline ? "الكهرباء موجودة" : "الكهرباء غير موجودة"}</strong>
          </div>
          <div className={styles.refreshTime}>
            <span>آخر تحديث</span>
            <strong>{lastRefresh ? formatDate(lastRefresh) : "—"}</strong>
          </div>
        </section>

        {error && <div className={styles.errorBanner} role="alert">تعذّر قراءة السجل. جارٍ إعادة المحاولة تلقائيًا.</div>}

        <section className={styles.stats} aria-label="ملخص حالة الكهرباء">
          <article className={styles.statCard}><span>إجمالي الانقطاعات</span><strong>{numberFormatter.format(outageIntervals.length)}</strong></article>
          <article className={styles.statCard}><span>إجمالي مدة الانقطاع</span><strong>{formatDuration(totalOutage)}</strong></article>
          <article className={styles.statCard}><span>أطول مدة انقطاع</span><strong>{formatDuration(longestOutage)}</strong></article>
          <article className={`${styles.statCard} ${styles.uptimeStat}`}><span>إجمالي توفر الكهرباء</span><strong>{formatDuration(totalUptime)}</strong></article>
          <article className={`${styles.statCard} ${styles.uptimeStat}`}><span>أطول فترة كهرباء</span><strong>{formatDuration(longestUptime)}</strong></article>
          <article className={styles.statCard}><span>مدة الحالة الحالية</span><strong>{formatDuration(currentInterval ? intervalDuration(currentInterval, now) : 0)}</strong></article>
          <article className={styles.statCard}><span>آخر انقطاع</span><strong>{formatDate(lastOffline?.timestampMs ?? null)}</strong></article>
          <article className={styles.statCard}><span>آخر عودة للكهرباء</span><strong>{formatDate(lastOnline?.timestampMs ?? null)}</strong></article>
        </section>

        <section className={styles.tableCard}>
          <div className={styles.tableHeading}>
            <div><h3>السجل الزمني</h3><p>{loading ? "جارٍ تحميل السجل…" : `${numberFormatter.format(intervals.length)} فترة مسجلة`}</p></div>
            <span className={styles.liveBadge}>تحديث مباشر</span>
          </div>
          <div className={styles.tableWrapper}>
            <table>
              <thead><tr><th>الحالة</th><th>وقت البداية</th><th>وقت النهاية</th><th>المدة</th><th>الوضع</th></tr></thead>
              <tbody>
                {!loading && intervals.length === 0 ? (
                  <tr><td colSpan={5} className={styles.emptyState}>سيظهر أول سجل بعد تأكيد الحالة الحالية</td></tr>
                ) : intervals.map((interval) => {
                  const ongoing = interval.endedAt === null;
                  const online = interval.type === "online";
                  return (
                    <tr key={`${interval.type}-${interval.startedAt}`}>
                      <td><span className={online ? styles.powerAvailable : styles.powerUnavailable}>{online ? "كهرباء موجودة" : "انقطاع"}</span></td>
                      <td>{formatDate(interval.startedAt)}</td>
                      <td>{formatDate(interval.endedAt)}</td>
                      <td className={styles.durationCell}>{formatDuration(intervalDuration(interval, now))}</td>
                      <td><span className={ongoing ? styles.ongoing : styles.resolved}>{ongoing ? "مستمرة" : "انتهت"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}
