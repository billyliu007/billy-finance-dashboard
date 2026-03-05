import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';

function getGoogleCredentials() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in environment.');
  }

  return { clientEmail, privateKey };
}

function getSheetConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE || 'Sheet1!A1:Z100';

  if (!spreadsheetId) {
    throw new Error('Missing GOOGLE_SHEETS_SPREADSHEET_ID in environment.');
  }

  return { spreadsheetId, range };
}

async function fetchSheetRows(rangeOverride) {
  const { clientEmail, privateKey } = getGoogleCredentials();
  const { spreadsheetId, range: defaultRange } = getSheetConfig();
  const range = rangeOverride || defaultRange;

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = response.data.values || [];

  if (values.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...rows] = values;
  return { headers, rows };
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
        message: 'Failed to fetch Google Sheets data. Check backend environment configuration and sheet permissions.',
      });
    }
  });

  return app;
}
