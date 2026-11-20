import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { importAttendanceFile, ImportError, rowsToRecord } from "./recordImport";

/** A minimal .xlsx: one sheet of inline-string cells, zipped with deflate. */
function xlsx(rows: string[][]): Uint8Array {
  const col = (i: number) => String.fromCharCode(65 + i);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const sheet =
    `<?xml version="1.0"?><worksheet><sheetData>` +
    rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">` +
          r.map((v, ci) => (v ? `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>` : "")).join("") +
          `</row>`,
      )
      .join("") +
    `</sheetData></worksheet>`;
  const files: [string, Buffer][] = [["xl/worksheets/sheet1.xml", Buffer.from(sheet)]];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const comp = deflateRawSync(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, comp);
    centrals.push(central, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const HEADER = ["Dates", "hour 1", "hour 2", "hour 3", "hour 4", "hour 5", "hour 6", "hour 7", "hour 8"];

describe("importing the Daily Attendance export", () => {
  it("reads days, codes and holidays from an .xlsx", async () => {
    const result = await importAttendanceFile(
      xlsx([
        ["Daily Attendance"],
        HEADER,
        ["05-08-2026", "P", "P", "P", "P", "", "P"], // Wed, old timetable: 1-4, 6
        ["06-08-2026", "P", "A", "DL", "DL", "", "B", "P", "SUS"], // Thu: 1-4, 6, 7-8
        ["15-08-2026", "Independence day"],
      ]),
      "2026-11-20T10:00:00Z",
    );
    expect(result.record.days).toEqual([
      ["2026-08-05", "PPPP.P.."],
      ["2026-08-06", "PADD.SPS"],
    ]);
    expect(result.record.holidays).toEqual([["2026-08-15", "Independence day"]]);
    expect(result.record.uploadedAt).toBe("2026-11-20T10:00:00Z");
    expect([result.from, result.to, result.classDays]).toEqual(["2026-08-05", "2026-08-15", 2]);
    expect(result.mismatches).toEqual([]);
  });

  it("flags days that do not fit the timetable", () => {
    const r = rowsToRecord(
      [
        HEADER,
        ["05-08-2026", "P", "P", "P", "P", "", "P", "P"], // a Wednesday has no hour 7
        ["07-08-2026", "P", "P", "P", "P", "", "P"], // a Friday (old) also has hour 7
      ],
      "t",
    );
    expect(r.mismatches).toEqual([
      { date: "2026-08-05", message: "Hour 7 recorded but not in the timetable" },
      { date: "2026-08-07", message: "No entry for hour 7" },
    ]);
  });

  it("rejects files that are not the export", async () => {
    await expect(importAttendanceFile(new Uint8Array([1, 2, 3]), "t")).rejects.toBeInstanceOf(ImportError);
    expect(() => rowsToRecord([["Name", "Marks"]], "t")).toThrow(ImportError);
    expect(() => rowsToRecord([HEADER, ["05-08-2026", "P", "X", "P", "P", "", "P"]], "t")).toThrow(ImportError);
  });
});
