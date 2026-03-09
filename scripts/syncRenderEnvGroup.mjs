#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RENDER_API_BASE = 'https://api.render.com/v1';
const DEFAULT_GROUP = 'netpulse-secrets';
const DEFAULT_ENV_FILE = 'backend/.env';
const REQUIRED_KEYS = [
  'DATABASE_URL',
  'FRONTEND_BASE_URL',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_CALLBACK_URL',
  'APPLE_CLIENT_ID',
  'APPLE_CLIENT_SECRET',
  'APPLE_CALLBACK_URL',
  'WECHAT_APP_ID',
  'WECHAT_APP_SECRET',
  'WECHAT_CALLBACK_URL',
  'SNAPSHOT_CRON_TOKEN',
  'FINNHUB_API_KEY',
];

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  RENDER_API_KEY=<token> node scripts/syncRenderEnvGroup.mjs [--group <name>] [--env-file <path>] [--keys <comma-separated>]

Examples:
  RENDER_API_KEY=... node scripts/syncRenderEnvGroup.mjs
  RENDER_API_KEY=... node scripts/syncRenderEnvGroup.mjs --group netpulse-secrets --env-file backend/.env
  RENDER_API_KEY=... node scripts/syncRenderEnvGroup.mjs --keys DATABASE_URL,FRONTEND_BASE_URL
`);
}

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  return String(process.argv[index + 1] || '').trim();
}

function parseDotEnv(text) {
  const env = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function apiRequest(path, { method = 'GET', apiKey, body } = {}) {
  const response = await fetch(`${RENDER_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function run() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const apiKey = String(process.env.RENDER_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Missing RENDER_API_KEY. Export it and re-run.');
  }

  const groupName = getArg('--group') || DEFAULT_GROUP;
  const envFileArg = getArg('--env-file') || DEFAULT_ENV_FILE;
  const keysArg = getArg('--keys');
  const keys = keysArg
    ? keysArg.split(',').map((item) => item.trim()).filter(Boolean)
    : REQUIRED_KEYS;

  const envFilePath = resolve(process.cwd(), envFileArg);
  const envFile = readFileSync(envFilePath, 'utf8');
  const envVars = parseDotEnv(envFile);

  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(envVars, key) || envVars[key] === '');
  if (missing.length > 0) {
    throw new Error(`Missing keys in ${envFileArg}: ${missing.join(', ')}`);
  }

  const groups = await apiRequest('/env-groups', { apiKey });
  const normalizedGroups = Array.isArray(groups)
    ? groups
      .map((item) => (item && typeof item === 'object' && item.envGroup ? item.envGroup : item))
      .filter(Boolean)
    : [];
  const group = normalizedGroups.find((item) => item?.name === groupName);
  if (!group?.id) {
    throw new Error(`Render env group "${groupName}" not found. Create it in Render first.`);
  }

  let updated = 0;
  for (const key of keys) {
    await apiRequest(`/env-groups/${encodeURIComponent(group.id)}/env-vars/${encodeURIComponent(key)}`, {
      method: 'PUT',
      apiKey,
      body: { value: String(envVars[key]) },
    });
    updated += 1;
  }

  // eslint-disable-next-line no-console
  console.log(`Synced ${updated} variables to Render env group "${groupName}" from ${envFileArg}.`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message || error);
  process.exitCode = 1;
});
