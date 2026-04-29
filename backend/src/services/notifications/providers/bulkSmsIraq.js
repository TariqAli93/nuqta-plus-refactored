/**
 * BulkSMSIraq provider adapter.
 *
 * Conforms to the ProviderAdapter contract:
 *   - sendSms({ phone, message }) → { ok, response, error }
 *   - sendWhatsapp({ phone, message }) → { ok, response, error }
 *   - testConnection() → { ok, response, error }
 *
 * BulkSMSIraq exposes a simple HTTPS REST endpoint that takes the API key as
 * a query/body parameter. Their docs publish a couple of slightly different
 * URL shapes over time; we send a single canonical request and normalise the
 * response. The exact endpoint can be overridden via the env var
 * BULKSMSIRAQ_BASE_URL for self-hosted gateways or staging environments.
 *
 * The adapter never persists logs itself — the caller (queue worker) is
 * responsible for writing notification_logs rows so we always log even when
 * the network call throws.
 */

const DEFAULT_BASE_URL = 'https://api.bulksmsiraq.com';
const DEFAULT_TIMEOUT_MS = 15_000;

function getBaseUrl() {
  return (process.env.BULKSMSIRAQ_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function postJson(url, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    return { httpStatus: res.status, ok: res.ok, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * BulkSMSIraq returns success in several shapes (`{success:true}`,
 * `{status:"OK"}`, `{code:200}`...). We accept any of them as success and
 * fall back to HTTP 2xx when the body is empty.
 */
function isSuccessBody(body, httpOk) {
  if (!body || typeof body !== 'object') return httpOk;
  if (body.success === true) return true;
  if (body.error === false) return true;
  if (typeof body.status === 'string' && /^(ok|success|sent|queued)$/i.test(body.status)) {
    return true;
  }
  if (typeof body.code === 'number' && body.code >= 200 && body.code < 300) return true;
  return httpOk;
}

function extractError(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.error === 'string') return body.error;
  if (typeof body.message === 'string') return body.message;
  if (body.error && typeof body.error === 'object' && typeof body.error.message === 'string') {
    return body.error.message;
  }
  return null;
}

/**
 * Translate the canonical "digits only, with country code" phone produced by
 * `normalizeIraqPhone` into the wire format BulkSMSIraq expects.
 *
 *   e164          → '+9647901234567'  (default — what the published docs use)
 *   international → '9647901234567'   (no plus, original 0006 behaviour)
 *   local         → '07901234567'     (Iraq local format; some accounts need this)
 *
 * Inputs that don't start with the Iraq country code are returned as-is so we
 * don't accidentally mangle a legitimate non-Iraq number.
 */
function formatPhone(phone, mode) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (!digits) return phone;
  switch (mode) {
    case 'international':
      return digits;
    case 'local':
      if (digits.startsWith('964')) return '0' + digits.slice(3);
      return digits;
    case 'e164':
    default:
      return '+' + digits;
  }
}

const ALLOWED_PHONE_FORMATS = new Set(['e164', 'international', 'local']);

export function createBulkSmsIraqAdapter({ apiKey, senderId, phoneFormat } = {}) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('BulkSMSIraq adapter requires an API key');
  }

  const base = getBaseUrl();
  const mode = ALLOWED_PHONE_FORMATS.has(phoneFormat) ? phoneFormat : 'e164';

  async function send({ phone, message, channel }) {
    const path = channel === 'whatsapp' ? '/whatsapp/send' : '/sms/send';
    const url = `${base}${path}`;
    const body = {
      api_key: apiKey,
      to: formatPhone(phone, mode),
      message,
      ...(senderId ? { sender: senderId } : {}),
    };

    try {
      const res = await postJson(url, body);
      const ok = isSuccessBody(res.body, res.ok);
      return {
        ok,
        response: { httpStatus: res.httpStatus, body: res.body },
        error: ok ? null : extractError(res.body) || `HTTP ${res.httpStatus}`,
      };
    } catch (err) {
      return {
        ok: false,
        response: null,
        error: err.name === 'AbortError' ? 'Request timed out' : err.message,
      };
    }
  }

  return {
    name: 'bulksmsiraq',

    sendSms({ phone, message }) {
      return send({ phone, message, channel: 'sms' });
    },

    sendWhatsapp({ phone, message }) {
      return send({ phone, message, channel: 'whatsapp' });
    },

    /**
     * Light-weight credential probe. BulkSMSIraq doesn't publish a dedicated
     * /me endpoint, so we hit /account/balance which fails fast with an auth
     * error on bad keys and succeeds cheaply on good ones.
     */
    async testConnection() {
      const url = `${base}/account/balance`;
      try {
        const res = await postJson(url, { api_key: apiKey });
        const ok = isSuccessBody(res.body, res.ok);
        return {
          ok,
          response: { httpStatus: res.httpStatus, body: res.body },
          error: ok ? null : extractError(res.body) || `HTTP ${res.httpStatus}`,
        };
      } catch (err) {
        return {
          ok: false,
          response: null,
          error: err.name === 'AbortError' ? 'Request timed out' : err.message,
        };
      }
    },
  };
}
