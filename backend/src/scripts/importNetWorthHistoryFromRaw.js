import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listUsersForSnapshots } from '../repositories/userRepository.js';
import { replaceNetWorthHistory } from '../repositories/financeRepository.js';
const SOURCE_UTC_OFFSET_HOURS = 8;

function parseUtcTimestampFromUtcPlus8(rawDateTime) {
  const value = String(rawDateTime || '').trim();
  if (!value) return '';
  const [datePart, timePartRaw = '00:00:00'] = value.split(/\s+/);
  const [month, day, year] = datePart.split('/').map((part) => Number(part));
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year) || year < 1900) {
    return '';
  }
  const [hourRaw, minuteRaw, secondRaw] = timePartRaw.split(':');
  const hour = Number(hourRaw || 0);
  const minute = Number(minuteRaw || 0);
  const second = Number(secondRaw || 0);
  if (
    !Number.isFinite(hour)
    || !Number.isFinite(minute)
    || !Number.isFinite(second)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    return '';
  }
  const utcMillis = Date.UTC(year, month - 1, day, hour - SOURCE_UTC_OFFSET_HOURS, minute, second);
  return new Date(utcMillis).toISOString();
}

function parseAmount(rawAmount) {
  const numeric = String(rawAmount || '')
    .replace(/[^\d.-]/g, '')
    .trim();
  const value = Number(numeric);
  return Number.isFinite(value) ? value : NaN;
}

function parseRows(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const latestByTimestamp = new Map();

  function upsert(recordedAtUtc, netWorth) {
    if (!recordedAtUtc || !Number.isFinite(netWorth)) {
      return;
    }
    const dateUtc = recordedAtUtc.slice(0, 10);
    latestByTimestamp.set(recordedAtUtc, { date: dateUtc, recordedAtUtc, netWorth });
  }

  for (const line of lines) {
    const cols = line.split('\t').map((item) => item.trim()).filter(Boolean);
    if (cols.length >= 2) {
      upsert(parseUtcTimestampFromUtcPlus8(cols[0]), parseAmount(cols[1]));
    }
  }

  if (latestByTimestamp.size === 0) {
    // Fallback format: alternating lines "datetime", "amount".
    for (let i = 0; i < lines.length - 1; i += 2) {
      upsert(parseUtcTimestampFromUtcPlus8(lines[i]), parseAmount(lines[i + 1]));
    }
  }

  return Array.from(latestByTimestamp.values()).sort((a, b) => a.recordedAtUtc.localeCompare(b.recordedAtUtc));
}

async function run() {
  const filePathArg = process.argv[2];
  const userEmailArg = String(process.argv[3] || '').trim().toLowerCase();
  if (!filePathArg) {
    throw new Error('Usage: npm run db:import-history --prefix backend -- <path-to-raw-tsv.txt> [user-email]');
  }

  const absolutePath = resolve(process.cwd(), filePathArg);
  const rawText = readFileSync(absolutePath, 'utf8');
  const historyRows = parseRows(rawText);
  if (historyRows.length === 0) {
    throw new Error('No valid history rows were parsed from the input file.');
  }

  const users = await listUsersForSnapshots();
  const user = userEmailArg
    ? users.find((item) => String(item?.email || '').toLowerCase() === userEmailArg)
    : users[0];
  if (!user) {
    throw new Error(userEmailArg
      ? `User not found for email: ${userEmailArg}`
      : 'No onboarded users found. Pass a target email as second argument.');
  }

  await replaceNetWorthHistory(user.id, historyRows);
  // eslint-disable-next-line no-console
  console.log(`Imported ${historyRows.length} net worth rows for ${String(user.email || user.id)}.`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
