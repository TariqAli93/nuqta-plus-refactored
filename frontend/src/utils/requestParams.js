/**
 * Drop empty query params before they hit the API. Sending `customer=` or
 * `search=` (empty) would either be coerced-and-rejected by the backend
 * querystring schema or treated as a real (empty) filter. Removing them lets an
 * empty search fall back to the default list (req #11) and keeps URLs clean.
 *
 * Keeps `0` and `false` (valid filter values); strips undefined, null, and
 * blank/whitespace-only strings.
 */
export function cleanParams(params = {}) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (typeof value === 'number' && Number.isNaN(value)) continue;
    out[key] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

/** True when an error is an aborted/superseded request (not a real failure). */
export function isCanceledRequest(error) {
  return error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError';
}

export default { cleanParams, isCanceledRequest };
