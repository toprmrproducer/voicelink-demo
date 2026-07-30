import type { CampaignNumber } from "@voiceplatform/shared";

/**
 * Minimal CSV parser tuned for outbound-dialing imports. Tenants upload
 * a file like:
 *
 *   phone,name,lead_score
 *   +919999999999,Asha,87
 *   +919811111111,Bharat,72
 *
 * The "phone" column is mandatory (case-insensitive). Every other
 * column lands in `customData` so agents can reference {{name}}, etc.
 *
 * Handles quoted fields, escaped quotes (""), \r\n + \n line endings,
 * and trailing blank lines. Throws CSVImportError with a useful
 * message when the input is malformed.
 */

export class CSVImportError extends Error {
  constructor(message: string, public line?: number) {
    super(line !== undefined ? `line ${line}: ${message}` : message);
    this.name = "CSVImportError";
  }
}

export interface CSVImportResult {
  numbers: CampaignNumber[];
  rejected: Array<{ line: number; reason: string }>;
}

export function parseCSV(input: string): CSVImportResult {
  const rows = tokenize(input);
  if (rows.length === 0) {
    throw new CSVImportError("CSV is empty");
  }
  const header = rows[0].map((c) => c.trim().toLowerCase());
  const phoneIdx = header.findIndex((h) => h === "phone" || h === "phone_number");
  if (phoneIdx === -1) {
    throw new CSVImportError("missing required 'phone' column");
  }

  const numbers: CampaignNumber[] = [];
  const rejected: Array<{ line: number; reason: string }> = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === "") continue; // blank line
    const phone = (row[phoneIdx] ?? "").trim();
    if (!isValidPhone(phone)) {
      rejected.push({ line: i + 1, reason: `invalid phone "${phone}"` });
      continue;
    }
    const customData: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      if (c === phoneIdx) continue;
      const key = header[c];
      if (!key) continue;
      const val = row[c]?.trim() ?? "";
      if (val) customData[key] = val;
    }
    numbers.push({ phone, customData });
  }
  return { numbers, rejected };
}

function isValidPhone(s: string): boolean {
  // E.164-ish: optional +, 7-15 digits. We accept the leading + because
  // Voicelink wants E.164, and lenient digit count because Indian DIDs
  // sometimes omit the country prefix in CSVs.
  return /^\+?\d{7,15}$/.test(s);
}

/** Tokenize CSV into rows of cells. Handles quoted commas + embedded quotes. */
function tokenize(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  const len = input.length;

  while (i < len) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          // Escaped quote
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\r") {
      // Skip — handled by \n below or trailing.
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  // Trailing cell / row
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
