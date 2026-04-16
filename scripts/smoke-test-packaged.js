#!/usr/bin/env node
/**
 * smoke-test-packaged.js
 *
 * Validates that the packaged backend bundle can actually boot and serve
 * traffic. Runs AFTER electron-builder completes and BEFORE the release is
 * published. This catches:
 *   - missing native deps (e.g. better-sqlite3 compiled for the wrong ABI)
 *   - broken import paths introduced by a bundler tweak
 *   - environment config issues
 *
 * Flow:
 *   1. locate release/win-unpacked/resources/backend
 *   2. spawn the bundled node.exe against src/server.js
 *   3. poll http://127.0.0.1:41731/health for up to 30 s
 *   4. also poll /version and compare to frontend/package.json#version
 *   5. kill the child, cleanup, exit 0 on success / 1 on failure
 *
 * The smoke test does NOT launch Electron itself — doing so inside GitHub
 * Actions requires a virtual display and is fragile. Booting the backend
 * in isolation is sufficient to validate the integration seam that Stage 1
 * made explicit.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ''),
  '..'
);
const UNPACKED_DIR = path.join(REPO_ROOT, 'release', 'win-unpacked');
const BACKEND_DIR = path.join(UNPACKED_DIR, 'resources', 'backend');
const SERVER_SCRIPT = path.join(BACKEND_DIR, 'src', 'server.js');
const NODE_BIN = path.join(BACKEND_DIR, 'bin', 'node.exe');

const PORT = 41731;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const VERSION_URL = `http://127.0.0.1:${PORT}/version`;

const HEALTH_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1000;
const FETCH_TIMEOUT_MS = 2000;

function assertExists(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`[smoke] ${label} not found: ${p}`);
    process.exit(1);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const body = await fetchJson(HEALTH_URL);
    if (body && (body.status === 'ok' || body.status === 'healthy')) {
      console.log(`[smoke] /health OK on attempt ${attempt}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function main() {
  assertExists(BACKEND_DIR, 'packaged backend dir');
  assertExists(SERVER_SCRIPT, 'server.js');
  assertExists(NODE_BIN, 'bundled node.exe');

  const frontendPkg = require(path.join(REPO_ROOT, 'frontend', 'package.json'));
  const expectedVersion = frontendPkg.version;
  console.log(`[smoke] expected version: ${expectedVersion}`);

  console.log(`[smoke] spawning backend from ${BACKEND_DIR}`);
  const child = spawn(NODE_BIN, [SERVER_SCRIPT], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, NODE_ENV: 'production' },
  });

  let childExited = false;
  let childExitCode = null;
  child.on('exit', (code, signal) => {
    childExited = true;
    childExitCode = code;
    console.log(`[smoke] backend exited (code=${code}, signal=${signal})`);
  });
  child.on('error', (err) => {
    console.error(`[smoke] spawn error: ${err.message}`);
  });

  const cleanup = () => {
    if (!childExited) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        if (!childExited) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
      }, 2000).unref();
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  const healthy = await waitForHealth();
  if (!healthy) {
    console.error(`[smoke] /health never came up within ${HEALTH_TIMEOUT_MS}ms`);
    cleanup();
    process.exit(1);
  }

  const versionBody = await fetchJson(VERSION_URL);
  if (!versionBody || versionBody.version !== expectedVersion) {
    console.error(
      `[smoke] /version mismatch — expected ${expectedVersion}, got ${JSON.stringify(versionBody)}`
    );
    cleanup();
    process.exit(1);
  }
  console.log(`[smoke] /version OK: ${versionBody.version}`);

  cleanup();
  // Give the child a moment to exit cleanly before reporting success.
  await new Promise((r) => setTimeout(r, 500));

  if (childExited && childExitCode !== null && childExitCode !== 0 && childExitCode !== 143) {
    // 143 = SIGTERM on POSIX; on Windows SIGTERM exits with null.
    console.error(`[smoke] backend exited non-zero after tests: ${childExitCode}`);
    process.exit(1);
  }

  console.log('[smoke] PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] unhandled error:', err);
  process.exit(1);
});
