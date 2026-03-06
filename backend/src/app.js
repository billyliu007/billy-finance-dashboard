import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';

const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DEFAULT_SHEET_RANGE = 'Sheet1!A1:Z100';
const FETCH_ERROR_MESSAGE =
  'Failed to fetch Google Sheets data. Check backend environment configuration and sheet permissions.';

function mapSheetValues(values = []) {
  if (values.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...rows] = values;
  return { headers, rows };
}

function getGoogleCredentials() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in environment.');
  }

  return {
    email: clientEmail,
    key: privateKey,
  };
}

function getSheetConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE || DEFAULT_SHEET_RANGE;

  if (!spreadsheetId) {
    throw new Error('Missing GOOGLE_SHEETS_SPREADSHEET_ID in environment.');
  }

  return { spreadsheetId, defaultRange: range };
}

function createSheetsClient() {
  const credentials = getGoogleCredentials();
  const { spreadsheetId, defaultRange } = getSheetConfig();

  const auth = new google.auth.JWT({
    email: credentials.email,
    key: credentials.key,
    scopes: [SHEETS_READONLY_SCOPE],
  });

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    spreadsheetId,
    defaultRange,
  };
}

function parseRangesParam(rawValue) {
  if (typeof rawValue !== 'string') {
    return [];
  }

  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function fetchSheetRows(rangeOverride) {
  const { sheets, spreadsheetId, defaultRange } = createSheetsClient();
  const range = rangeOverride || defaultRange;

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return mapSheetValues(response.data.values);
}

async function fetchMultipleSheetRows(ranges) {
  const { sheets, spreadsheetId } = createSheetsClient();
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
  });

  const valueRanges = response.data.valueRanges || [];
  return ranges.map((range, index) => {
    const values = valueRanges[index]?.values;
    return { range, ...mapSheetValues(values) };
  });
}

export default function createApp() {
  const app = express();
  app.use(cors());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/sheet', async (req, res) => {
    try {
      const rangeOverride = typeof req.query.range === 'string' ? req.query.range : undefined;
      const data = await fetchSheetRows(rangeOverride);
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({
        message: FETCH_ERROR_MESSAGE,
      });
    }
  });

  app.get('/api/sheets', async (req, res) => {
    try {
      const ranges = parseRangesParam(req.query.ranges);

      if (ranges.length === 0) {
        return res.status(400).json({ message: 'Missing required query parameter: ranges' });
      }

      const sheetsData = await fetchMultipleSheetRows(ranges);
      return res.json({ sheets: sheetsData });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: FETCH_ERROR_MESSAGE,
      });
    }
  });

  return app;
}
