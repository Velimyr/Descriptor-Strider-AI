import { google, sheets_v4 } from 'googleapis';
import { telegramBotConfig } from '../../src/telegram-bot/config';

let cachedSheets: sheets_v4.Sheets | null = null;

export function getSpreadsheetId(): string {
  const id = process.env[telegramBotConfig.google.spreadsheetIdEnv];
  if (!id) throw new Error(`Missing env ${telegramBotConfig.google.spreadsheetIdEnv}`);
  return id;
}

function loadServiceAccountCredentials(): { client_email: string; private_key: string } {
  const raw = process.env[telegramBotConfig.google.serviceAccountJsonEnv];
  if (!raw) {
    throw new Error(`Missing env ${telegramBotConfig.google.serviceAccountJsonEnv}`);
  }
  // Підтримуємо чистий JSON або base64-пакований JSON.
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e: any) {
    throw new Error(`${telegramBotConfig.google.serviceAccountJsonEnv} is not valid JSON: ${e.message}`);
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(`${telegramBotConfig.google.serviceAccountJsonEnv} missing client_email or private_key`);
  }
  // Vercel зберігає \n у private_key як літерал — нормалізуємо.
  const private_key = String(parsed.private_key).replace(/\\n/g, '\n');
  return { client_email: parsed.client_email, private_key };
}

export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (cachedSheets) return cachedSheets;
  const { client_email, private_key } = loadServiceAccountCredentials();
  const auth = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  cachedSheets = google.sheets({ version: 'v4', auth });
  return cachedSheets;
}

export async function readSheet(sheetName: string): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}`,
  });
  return (res.data.values as string[][]) || [];
}

export async function appendRows(sheetName: string, rows: (string | number)[][]) {
  if (rows.length === 0) return;
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

export async function updateRange(
  sheetName: string,
  range: string,
  values: (string | number)[][]
) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!${range}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

export async function clearSheet(sheetName: string) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: getSpreadsheetId(),
    range: sheetName,
  });
}

export async function getSpreadsheet(): Promise<sheets_v4.Schema$Spreadsheet> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
  return res.data;
}

export async function ensureSheet(sheetName: string) {
  const sheets = await getSheetsClient();
  const meta = await getSpreadsheet();
  const exists = meta.sheets?.some(s => s.properties?.title === sheetName);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
  });
}

export async function deleteRowByMatch(
  sheetName: string,
  matcher: (row: string[]) => boolean
): Promise<boolean> {
  const sheets = await getSheetsClient();
  const meta = await getSpreadsheet();
  const sheet = meta.sheets?.find(s => s.properties?.title === sheetName);
  if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) return false;
  const sheetId = sheet.properties.sheetId;

  const rows = await readSheet(sheetName);
  const indices: number[] = [];
  rows.forEach((row, idx) => {
    if (matcher(row)) indices.push(idx);
  });
  if (indices.length === 0) return false;

  const requests = indices
    .sort((a, b) => b - a)
    .map(rowIndex => ({
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
      },
    }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: { requests },
  });
  return true;
}

export function colLetter(index: number): string {
  let column = '';
  let i = index;
  while (i >= 0) {
    column = String.fromCharCode((i % 26) + 65) + column;
    i = Math.floor(i / 26) - 1;
  }
  return column;
}
