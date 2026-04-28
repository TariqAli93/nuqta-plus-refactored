import crypto from 'crypto';
import config from '../../config.js';

/**
 * Light AES-256-GCM helper used to keep provider API keys at rest.
 *
 * The key is derived from the JWT secret + a fixed namespace string, so:
 *   - We don't need a new env variable to enable the feature.
 *   - Rotating the JWT secret invalidates stored API keys (operator must
 *     re-enter them) — fail-secure.
 *
 * Format: <iv-base64>:<tag-base64>:<cipher-base64>.
 */

const NAMESPACE = 'nuqtaplus:notifications:v1';

function getKey() {
  return crypto
    .createHash('sha256')
    .update(`${NAMESPACE}:${config.jwt.secret}`)
    .digest();
}

export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const enc = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

/** Show only the last 4 chars: "************1234". */
export function mask(plaintext) {
  if (!plaintext) return '';
  const str = String(plaintext);
  if (str.length <= 4) return '*'.repeat(str.length);
  return '*'.repeat(Math.max(4, str.length - 4)) + str.slice(-4);
}
