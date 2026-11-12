import type { AuditPack } from '../services/auditPackService';

// One field per row. The CSV and the PDF are both built from the same rows, so they always
// hold the same figures. Values are written as the API returned them: no rounding, no locale.
export interface AuditRow {
  section: string;
  field: string;
  value: string;
}

function isMap(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value: unknown) {
  return value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value);
}

function scalarText(value: unknown) {
  return value === null || value === undefined ? '' : String(value);
}

// Maps become dotted field names; a list of plain values becomes one "; " joined row; a list
// of maps gets one numbered entry per item.
function flatten(section: string, value: unknown, field: string, rows: AuditRow[]) {
  if (isMap(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      rows.push({ section, field, value: '' });
    }
    for (const [key, item] of entries) {
      flatten(section, item, field ? `${field}.${key}` : key, rows);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      rows.push({ section, field, value: value.map(scalarText).join('; ') });
      return;
    }
    value.forEach((item, index) => flatten(section, item, `${field}.${index + 1}`, rows));
    return;
  }
  rows.push({ section, field, value: scalarText(value) });
}

function storedMap(section: string, value: Record<string, unknown> | null, rows: AuditRow[]) {
  if (value === null) {
    rows.push({ section, field: 'stored', value: 'Not stored' });
    return;
  }
  flatten(section, value, '', rows);
}

export function auditPackRows(pack: AuditPack): AuditRow[] {
  const rows: AuditRow[] = [];

  rows.push({ section: 'pack', field: 'application_id', value: pack.application_id });
  rows.push({ section: 'pack', field: 'audit_hash', value: pack.audit_hash });
  rows.push({ section: 'pack', field: 'audit_tx_hash', value: pack.audit_tx_hash ?? 'Not recorded' });
  flatten('verification', pack.verification, '', rows);
  flatten('application', pack.application, '', rows);
  storedMap('valuation', pack.valuation, rows);
  storedMap('affordability', pack.affordability, rows);
  storedMap('policy_gate', pack.policy_gate, rows);
  flatten('record', pack.record, '', rows);
  pack.agent_calls.forEach((call, index) => flatten('agent_call', call, String(index + 1), rows));

  return rows;
}

// A text cell that starts like a formula (=, +, -, @, tab or carriage return) would run as one when
// the CSV is opened in Excel, so it gets a leading apostrophe. Plain numbers such as -1300 are left
// alone so they stay numbers.
function neutraliseFormula(value: string) {
  return /^[=+\-@\t\r]/.test(value) && !/^[+-]?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
}

function csvCell(value: string) {
  const safe = neutraliseFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// RFC 4180: CRLF line endings, quoted cells for commas, quotes and line breaks. The byte order
// mark lets Excel read the file as UTF-8.
export function toCsv(rows: AuditRow[]): string {
  const lines = ['section,field,value', ...rows.map(({ section, field, value }) => [section, field, value].map(csvCell).join(','))];

  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---- PDF -------------------------------------------------------------------------------
// A small PDF 1.4 writer: Helvetica (built into every PDF reader), A4 pages, the rows as text
// lines. No library is needed and the file stays plain ASCII, so byte offsets are string lengths.

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const FONT_SIZE = 9;
const LEADING = 12;
const LINE_CHARS = 95;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN - 30) / LEADING);

// WinAnsi bytes for the few characters outside Latin-1 that the pack may hold.
const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
};

function pdfString(text: string) {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    let byte: number;
    if (char === '−') {
      byte = 0x2d; // a minus sign is written as a hyphen
    } else if (code < 0x20) {
      byte = 0x20;
    } else if (code < 0x7f || (code >= 0xa0 && code <= 0xff)) {
      byte = code;
    } else {
      byte = WIN_ANSI[char] ?? 0x3f; // anything else becomes "?" rather than a broken file
    }
    if (byte === 0x5c || byte === 0x28 || byte === 0x29) {
      out += `\\${String.fromCharCode(byte)}`;
    } else if (byte > 0x7e) {
      out += `\\${byte.toString(8).padStart(3, '0')}`;
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return `(${out})`;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      let rest = word;
      while (rest.length > width) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (!line) {
        line = rest;
      } else if (line.length + 1 + rest.length <= width) {
        line += ` ${rest}`;
      } else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

function rowLines(rows: AuditRow[]) {
  return rows.flatMap(({ section, field, value }) => {
    const [first, ...rest] = wrap(`${section} / ${field}: ${value}`, LINE_CHARS);
    return [first, ...rest.map((line) => `    ${line}`)];
  });
}

export function toPdf(rows: AuditRow[], title: string): Uint8Array {
  const lines = rowLines(rows);
  const pages: string[][] = [];
  for (let start = 0; start < Math.max(lines.length, 1); start += LINES_PER_PAGE) {
    pages.push(lines.slice(start, start + LINES_PER_PAGE));
  }

  // Objects 1 to 4 are fixed; each page then takes two: the page and its content stream.
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  pages.forEach((pageLines, index) => {
    const top = PAGE_HEIGHT - MARGIN;
    const body = pageLines
      .map((line, row) => `BT /F1 ${FONT_SIZE} Tf ${MARGIN} ${top - 30 - row * LEADING} Td ${pdfString(line)} Tj ET`)
      .join('\n');
    const content = [
      `BT /F2 14 Tf ${MARGIN} ${top} Td ${pdfString(title)} Tj ET`,
      body,
      `BT /F1 8 Tf ${MARGIN} ${MARGIN - 20} Td ${pdfString(`Page ${index + 1} of ${pages.length}`)} Tj ET`,
    ].join('\n');
    const pageId = pageIds[index];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

export function auditPackFileName(applicationId: string, format: 'csv' | 'pdf') {
  return `audit-pack-${applicationId.replace(/[^A-Za-z0-9_-]/g, '_')}.${format}`;
}
