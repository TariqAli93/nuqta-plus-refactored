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

const DEFAULT_BASE_URL = 'https://gateway.standingtech.com/api/v5/';
const DEFAULT_TIMEOUT_MS = 15_000;

function getBaseUrl() {
  return (process.env.BULKSMSIRAQ_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function postJson(url, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer ' + body.apiKey || '',
      },
      body: JSON.stringify({
        recipient: body.phone,
        sender_id: body.senderId,
        type: body.channel === 'whatsapp' ? 'whatsapp' : 'sms',
        message: body.message,
        lang: 'ar',
      }),
      signal: controller.signal,
    });
    return { httpStatus: response.status, ok: response.ok, body: await response.json() };
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

export function createBulkSmsIraqAdapter({ apiKey, senderId } = {}) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('BulkSMSIraq adapter requires an API key');
  }

  const base = getBaseUrl();

  async function send({ phone, message, channel }) {
    const url = `${base}${channel === 'whatsapp' ? '/whatsapp/send' : '/sms/send'}`;
    const body = {
      recipient: phone,
      sender_id: senderId,
      type: channel === 'whatsapp' ? 'whatsapp' : 'plain',
      message,
      lang: 'ar',
    };

    console.log(body);
    console.log(url);
    console.log(apiKey);

    try {
      const res = await postJson(url, { apiKey, ...body });
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
      try {
        const res = await postJson(base, {
          apiKey: apiKey,
          phone: '9647824082356',
          message: 'Test message',
          senderId: 'Nuqta Plus',
          channel: 'sms',
          lang: 'ar',
        });
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
