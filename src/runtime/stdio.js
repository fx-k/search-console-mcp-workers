import fs from 'node:fs';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { handleMcp, err } from '../core/mcp.js';

function readServiceAccount(path) {
  if (!path) throw new Error('缺少 GOOGLE_SERVICE_ACCOUNT_FILE');
  const raw = fs.readFileSync(path, 'utf8');
  let account;
  try { account = JSON.parse(raw); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_FILE 不是有效 JSON'); }
  if (!account.client_email || !account.private_key) throw new Error('Google service account JSON 缺少 client_email/private_key');
  return raw;
}

export function createTunnelEnv(source = process.env) {
  return {
    GOOGLE_SERVICE_ACCOUNT_JSON: readServiceAccount(source.GOOGLE_SERVICE_ACCOUNT_FILE),
    BING_API_KEY: source.BING_API_KEY || '',
    INDEXNOW_KEY: source.INDEXNOW_KEY || ''
  };
}

export async function handleStdioLine(env, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return err(null, -32700, 'Parse error');
  }
  return handleMcp(env, message);
}

export async function main() {
  const env = createTunnelEnv();
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  console.error('[search-console-mcp] stdio runtime ready');

  for await (const raw of input) {
    const line = raw.trim();
    if (!line) continue;
    const result = await handleStdioLine(env, line);
    if (result !== null) process.stdout.write(JSON.stringify(result) + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('[search-console-mcp] fatal:', error.message);
    process.exitCode = 1;
  });
}
