import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BINARY_NAME = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

function pushIf(arr, p) {
  if (!p) return;
  const abs = path.isAbsolute(p) ? p : path.resolve(p);
  if (!arr.includes(abs)) arr.push(abs);
}

/**
 * Build the ordered list of candidate paths for the cloudflared binary.
 *
 * Production layout (NuqtaPlus Server installed at e.g.
 * "C:\Program Files\NuqtaPlus Server\"):
 *
 *   resources\
 *     cloudflared.exe                              ← binary placed here by electron-builder extraResources
 *     backend\
 *       src\utils\cloudflaredPath.js               ← this file in production
 *
 * Development layout:
 *
 *   <repo-root>\
 *     tools\cloudflared\cloudflared.exe            ← binary in source tree
 *     backend\src\utils\cloudflaredPath.js         ← this file in dev
 *
 * Resolution order:
 *   1. CLOUDFLARED_PATH env override (exclusive).
 *   2. process.resourcesPath\cloudflared.exe          — Electron-spawned backend.
 *   3. process.resourcesPath\resources\cloudflared.exe — defensive fallback.
 *   4. <__dirname>\..\..\..\cloudflared.exe           — production WinSW/standalone
 *      (process.resourcesPath isn't set when the backend runs as a Windows
 *      Service; anchor on __dirname instead).
 *   5. <__dirname>\..\..\..\tools\cloudflared\cloudflared.exe — dev source tree.
 *   6. <cwd>\tools\cloudflared\cloudflared.exe        — cwd fallback (dev).
 *   7. <cwd>\cloudflared.exe                          — cwd fallback (prod).
 */
function buildCandidates() {
  const envOverride = process.env.CLOUDFLARED_PATH;
  if (envOverride) {
    return [path.isAbsolute(envOverride) ? envOverride : path.resolve(envOverride)];
  }

  const candidates = [];

  // 1. Electron-spawned backend (process.resourcesPath is set by Electron).
  if (process.resourcesPath && typeof process.resourcesPath === 'string') {
    pushIf(candidates, path.join(process.resourcesPath, BINARY_NAME));
    // Defensive: in case process.resourcesPath points one level higher than expected.
    pushIf(candidates, path.join(process.resourcesPath, 'resources', BINARY_NAME));
  }

  // 2. Production Windows-Service / standalone backend.
  // From "resources\backend\src\utils\cloudflaredPath.js" three levels up == "resources\".
  pushIf(candidates, path.join(__dirname, '..', '..', '..', BINARY_NAME));

  // 3. Dev source tree — repo-root\tools\cloudflared\cloudflared.exe.
  // From "backend\src\utils\" three levels up == repo root.
  pushIf(
    candidates,
    path.join(__dirname, '..', '..', '..', 'tools', 'cloudflared', BINARY_NAME)
  );

  // 4. cwd-anchored last-resort fallbacks.
  pushIf(candidates, path.resolve(process.cwd(), 'tools', 'cloudflared', BINARY_NAME));
  pushIf(candidates, path.resolve(process.cwd(), BINARY_NAME));

  return candidates;
}

/**
 * Resolve the cloudflared binary. Returns:
 *   { path, status: 'found' | 'missing', candidates, checked }
 * Where `checked` is an annotated list of every candidate tried with a
 * boolean `exists` flag — useful for surfacing the full search trace to
 * the user when nothing is found.
 *
 * Does NOT throw — the caller decides how to handle a miss.
 */
export function resolveCloudflaredPath({ log } = {}) {
  const candidates = buildCandidates();
  const checked = [];
  const logger = log && typeof log.info === 'function' ? log : null;

  if (logger) {
    logger.info(`[cloudflaredPath] checking ${candidates.length} candidate path(s)`);
    logger.info(
      `[cloudflaredPath] process.resourcesPath=${process.resourcesPath ?? '(unset)'}`
    );
    logger.info(`[cloudflaredPath] __dirname=${__dirname}`);
    logger.info(`[cloudflaredPath] cwd=${process.cwd()}`);
  }

  let resolved = null;
  for (const p of candidates) {
    const exists = existsSync(p);
    let valid = false;
    let note = exists ? 'exists' : 'missing';
    if (exists) {
      try {
        const st = statSync(p);
        if (st.isFile() && st.size > 0) {
          valid = true;
        } else if (!st.isFile()) {
          note = 'not a regular file';
        } else {
          note = 'empty file';
        }
      } catch (err) {
        note = `stat failed: ${err.message}`;
      }
    }

    checked.push({ path: p, exists, valid, note });
    if (logger) {
      const tag = valid ? 'FOUND' : exists ? 'skip ' : 'miss ';
      logger.info(`[cloudflaredPath] ${tag} ${p}${valid ? '' : ` (${note})`}`);
    }

    if (valid && !resolved) {
      resolved = p;
      // keep walking the list so the `checked` trace is complete in logs,
      // but we already have our answer.
      break;
    }
  }

  if (resolved) {
    return { path: resolved, status: 'found', candidates, checked };
  }
  return { path: null, status: 'missing', candidates, checked };
}
