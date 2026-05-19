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

function buildCandidates() {
  const envOverride = process.env.CLOUDFLARED_PATH;
  if (envOverride) {
    return [path.isAbsolute(envOverride) ? envOverride : path.resolve(envOverride)];
  }

  const candidates = [];

  // Packaged Electron — resources/cloudflared.exe (matches extraResources `to:` value).
  // Guard against process.resourcesPath in dev pointing at Electron's framework resources.
  if (process.resourcesPath && typeof process.resourcesPath === 'string') {
    pushIf(candidates, path.join(process.resourcesPath, BINARY_NAME));
  }

  // Dev source tree — backend/src/utils/ → up 3 levels → repo root → tools/cloudflared/
  pushIf(candidates, path.join(__dirname, '..', '..', '..', 'tools', 'cloudflared', BINARY_NAME));

  // Last-resort cwd fallback
  pushIf(candidates, path.join(process.cwd(), 'tools', 'cloudflared', BINARY_NAME));
  pushIf(candidates, path.join(process.cwd(), BINARY_NAME));

  return candidates;
}

export function resolveCloudflaredPath() {
  const candidates = buildCandidates();
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const st = statSync(p);
      if (st.isFile() && st.size > 0) {
        return { path: p, status: 'found', candidates };
      }
    } catch {
      // ignore and try next
    }
  }
  return { path: null, status: 'missing', candidates };
}
