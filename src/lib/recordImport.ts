// Read the portal's "Daily Attendance" export (.xlsx) into an AttendanceRecord,
// in the browser, with no library: an .xlsx is a zip of XML files, unzipped
// with the built-in DecompressionStream and read with a few regular
// expressions (the export is a plain grid of text cells).
//
// The sheet: a "Dates | hour 1 ... hour 8" header row, then one row per day:
// a date (dd-mm-yyyy) and a code per hour (P, A, DL, SUS, B), or a holiday
// name across the row. Every day is then checked against the timetable it ran.

import type { AttendanceRecord } from "./config";
import { isValidDate } from "./dates";
import { slotsForHistoryDay } from "./history";

export interface ImportIssue {
  date: string;
  message: string;
}

export interface ImportResult {
  record: AttendanceRecord;
  /** First and last date in the file. */
  from: string;
  to: string;
  classDays: number;
  /** Days whose recorded hours do not match the timetable that day ran. */
  mismatches: ImportIssue[];
}

export class ImportError extends Error {}

// ---- zip ---------------------------------------------------------------------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files in a zip, by name (only the ones \`want\` accepts are inflated). */
export async function unzip(bytes: Uint8Array, want: (name: string) => boolean): Promise<Map<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportError("This is not an .xlsx file (it is not a zip).");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new ImportError("The file's zip directory is damaged.");
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    if (method === 0) out.set(name, decoder.decode(raw));
    else if (method === 8) out.set(name, decoder.decode(await inflateRaw(raw)));
    else throw new ImportError("The file uses a compression this reader does not know.");
  }
  return out;
}

// ---- sheet -------------------------------------------------------------------

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function textOf(xml: string): string {
  return decodeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first worksheet as rows of cell text. */
export function sheetRows(sheetXml: string, sharedXml: string | undefined): string[][] {
  const shared = sharedXml ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const rows: string[][] = [];
  for (const row of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (v !== undefined) value = decodeXml(v);
      cells[ref ? columnIndex(ref) : cells.length] = value;
    }
    rows.push(Array.from(cells, (x) => x ?? ""));
  }
  return rows;
}

// ---- record ------------------------------------------------------------------

const CODE: Record<string, string> = { P: "P", A: "A", DL: "D", OD: "D", SUS: "S", B: "S", "": "." };

function isoDate(dmy: string): string | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(dmy.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isValidDate(iso) ? iso : null;
}

/** Turn the sheet's rows into a record. Throws ImportError with a readable message. */
export function rowsToRecord(rows: string[][], uploadedAt: string): ImportResult {
  const headerAt = rows.findIndex(
    (r) => r[0]?.trim().toLowerCase() === "dates" && r.slice(1, 9).some((c) => /hour\s*1/i.test(c)),
  );
  if (headerAt < 0) {
    throw new ImportError('This does not look like the portal\'s Daily Attendance export (no "Dates | hour 1 ..." row).');
  }
  const days: [string, string][] = [];
  const holidays: [string, string][] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(headerAt + 1)) {
    const date = isoDate(row[0] ?? "");
    if (!date) continue;
    if (seen.has(date)) throw new ImportError(`${row[0]} appears twice in the file.`);
    seen.add(date);
    const cells = Array.from({ length: 8 }, (_, i) => (row[i + 1] ?? "").trim().toUpperCase());
    const codes = cells.map((c) => CODE[c]);
    if (codes.every((c) => c === ".")) continue; // an empty row
    if (codes.some((c) => c === undefined)) {
      // A holiday row: its name runs across the cells (one merged cell in the export).
      const name = row.slice(1).map((c) => c.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").replace(/�/g, " ");
      if (cells.some((c) => c in CODE && c !== "")) unknown.push(`${row[0]}: ${cells.join(" ")}`);
      else holidays.push([date, name.slice(0, 120)]);
      continue;
    }
    days.push([date, codes.join("")]);
  }
  if (unknown.length > 0) throw new ImportError(`Some cells have codes this reader does not know: ${unknown.slice(0, 3).join("; ")}.`);
  if (days.length === 0) throw new ImportError("The file has no class days.");
  days.sort((a, b) => a[0].localeCompare(b[0]));
  holidays.sort((a, b) => a[0].localeCompare(b[0]));

  // Check each day against the timetable it ran (old until 16 Sep, swap days, current after).
  const mismatches: ImportIssue[] = [];
  for (const [date, codes] of days) {
    const expected = new Set(slotsForHistoryDay(date).slots.flatMap((s) => Array.from({ length: s.span }, (_, k) => s.startPeriod + k)));
    const recorded = [...codes].map((c, i) => (c === "." ? 0 : i + 1)).filter(Boolean);
    const extra = recorded.filter((h) => !expected.has(h));
    const missing = [...expected].filter((h) => codes[h - 1] === ".");
    if (expected.size === 0) mismatches.push({ date, message: "Classes recorded on a day with no timetable (a weekend?)" });
    else if (extra.length > 0) mismatches.push({ date, message: `Hour ${extra.join(", ")} recorded but not in the timetable` });
    else if (missing.length > 0) mismatches.push({ date, message: `No entry for hour ${missing.sort((a, b) => a - b).join(", ")}` });
  }

  const all = [...days.map((d) => d[0]), ...holidays.map((h) => h[0])].sort();
  return {
    record: { days, holidays, uploadedAt },
    from: all[0],
    to: all[all.length - 1],
    classDays: days.length,
    mismatches,
  };
}

/** Read an uploaded .xlsx file. */
export async function importAttendanceFile(bytes: Uint8Array, uploadedAt: string): Promise<ImportResult> {
  const files = await unzip(bytes, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const sheetName = [...files.keys()].filter((n) => n.startsWith("xl/worksheets/")).sort()[0];
  if (!sheetName) throw new ImportError("The file has no worksheet.");
  return rowsToRecord(sheetRows(files.get(sheetName)!, files.get("xl/sharedStrings.xml")), uploadedAt);
}
