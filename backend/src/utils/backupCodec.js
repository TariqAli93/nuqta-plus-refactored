/**
 * Backup encoding/decoding codec.
 *
 * Keeps the encode/decode step isolated from the rest of the backup pipeline
 * so a stronger scheme (e.g. AES encryption) can replace base64 later WITHOUT
 * touching the service, API, or UI. The only contract is:
 *
 *   encodeBackup(buffer: Buffer) -> string   (text written to the .nqbackup file)
 *   decodeBackup(encoded: string|Buffer) -> Buffer   (original ZIP bytes)
 *
 * The on-disk format is a short ASCII header followed by the payload:
 *
 *   NQBKP|1|base64|<base64-encoded-zip-bytes>
 *
 * The header records the codec version and scheme so decodeBackup can refuse
 * files it does not understand and a future version can branch on the scheme.
 */

import { createHash } from 'crypto';

const MAGIC = 'NQBKP';
const CODEC_VERSION = 1;
const SCHEME = 'base64';
const SEPARATOR = '|';

/**
 * Encode a raw ZIP buffer into the .nqbackup text representation.
 * @param {Buffer} buffer Raw ZIP bytes.
 * @returns {string} Encoded file content.
 */
export function encodeBackup(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('encodeBackup expects a Buffer');
  }
  const payload = buffer.toString('base64');
  return [MAGIC, CODEC_VERSION, SCHEME, payload].join(SEPARATOR);
}

/**
 * Decode a .nqbackup file (string or Buffer) back into the raw ZIP buffer.
 * Throws a descriptive error if the header is missing or unsupported so the
 * restore layer can surface a friendly "invalid backup file" message.
 * @param {string|Buffer} encoded
 * @returns {Buffer} Raw ZIP bytes.
 */
export function decodeBackup(encoded) {
  const text = (Buffer.isBuffer(encoded) ? encoded.toString('utf8') : String(encoded)).trim();

  // header has exactly 3 separators before the payload; split with a limit so
  // a payload that (impossibly) contained '|' is still kept intact.
  const firstSep = text.indexOf(SEPARATOR);
  if (firstSep === -1 || text.slice(0, firstSep) !== MAGIC) {
    throw new Error('Unrecognized backup file: missing NuqtaPlus backup header');
  }

  const rest = text.slice(firstSep + 1);
  const secondSep = rest.indexOf(SEPARATOR);
  const version = Number(rest.slice(0, secondSep));
  const afterVersion = rest.slice(secondSep + 1);
  const thirdSep = afterVersion.indexOf(SEPARATOR);
  const scheme = afterVersion.slice(0, thirdSep);
  const payload = afterVersion.slice(thirdSep + 1);

  if (!Number.isInteger(version) || version > CODEC_VERSION) {
    throw new Error(`Unsupported backup codec version: ${rest.slice(0, secondSep)}`);
  }
  if (scheme !== 'base64') {
    throw new Error(`Unsupported backup encoding scheme: ${scheme}`);
  }
  if (!payload) {
    throw new Error('Backup file is empty or corrupt');
  }

  const buffer = Buffer.from(payload, 'base64');
  if (buffer.length === 0) {
    throw new Error('Backup file is empty or corrupt');
  }
  return buffer;
}

/**
 * Compute a SHA-256 hex checksum of a buffer or string. Used for the
 * per-file integrity hashes stored in the manifest.
 * @param {Buffer|string} data
 * @returns {string} hex digest
 */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}
