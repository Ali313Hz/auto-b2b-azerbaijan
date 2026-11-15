import "server-only";

import { deflateRawSync } from "node:zlib";

// A small .xlsx (Office Open XML) writer: several sheets of text and
// numbers, a bold header row and column widths. No package needed - an
// .xlsx file is a zip of a few XML files, built here with Node's zlib.
//
// Text is always written as inline text (never as a formula), so a value
// such as "=HYPERLINK(...)" typed by a customer stays plain text in Excel.

export type XlsxCell = string | number | null | undefined;

export type XlsxColumn = {
  header: string;
  width?: number;
  // "money" = 2 decimals with thousands separator, "int" = whole number.
  format?: "text" | "money" | "int";
};

export type XlsxSheet = {
  name: string;
  columns: XlsxColumn[];
  rows: XlsxCell[][];
};

const STYLE = { text: 0, header: 1, money: 2, int: 3 } as const;

function xmlText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number) {
  let name = "";
  let n = index + 1;

  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }

  return name;
}

function cellXml(ref: string, value: XlsxCell, style: number) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : "";
  }

  // Keep leading/trailing spaces as typed.
  return `<c r="${ref}" t="inlineStr" s="${style === STYLE.header ? STYLE.header : STYLE.text}"><is><t xml:space="preserve">${xmlText(
    String(value).slice(0, 32000)
  )}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet) {
  const cols = sheet.columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 14}" customWidth="1"/>`)
    .join("");
  const header = `<row r="1">${sheet.columns
    .map((column, index) => cellXml(`${columnName(index)}1`, column.header, STYLE.header))
    .join("")}</row>`;
  const body = sheet.rows
    .map((row, rowIndex) => {
      const r = rowIndex + 2;
      const cells = row
        .map((value, index) => {
          const format = sheet.columns[index]?.format ?? "text";
          return cellXml(`${columnName(index)}${r}`, value, STYLE[format]);
        })
        .join("");

      return `<row r="${r}">${cells}</row>`;
    })
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols><sheetData>${header}${body}</sheetData></worksheet>`
  );
}

function workbookFiles(sheets: XlsxSheet[]): [string, string][] {
  const safeName = (name: string, index: number) =>
    xmlText(name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Sheet${index + 1}`);

  return [
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (_, index) =>
              `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join("") +
        "</Types>",
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    ],
    [
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        "<sheets>" +
        sheets
          .map((sheet, index) => `<sheet name="${safeName(sheet.name, index)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
          .join("") +
        "</sheets></workbook>",
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, index) =>
              `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
          )
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        "</Relationships>",
    ],
    [
      "xl/styles.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="4">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        "</cellXfs>" +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        "</styleSheet>",
    ],
    ...sheets.map((sheet, index): [string, string] => [`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet)]),
  ];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }

  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;

  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);

  return (crc ^ 0xffffffff) >>> 0;
}

// Zip (deflate) of the given files.
function zip(files: [string, string][]) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  // 2026-01-01 00:00 (DOS date/time); Excel does not use it.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const raw = Buffer.from(content, "utf8");
    const packed = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);

    parts.push(local, nameBytes, packed);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, ...central, end]);
}

export function buildXlsx(sheets: XlsxSheet[]) {
  return zip(workbookFiles(sheets));
}
