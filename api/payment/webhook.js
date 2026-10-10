/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const {
  getConfig,
  logger,
  verifyPaymentWebhookSignature,
  processVerifiedPaymentWebhook,
} = require('../_botCore');

function readRawAndJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      const raw = JSON.stringify(req.body);
      return resolve({ rawBody: raw, body: req.body });
    }
    if (typeof req.body === 'string' && req.body.length > 0) {
      try {
        return resolve({ rawBody: req.body, body: JSON.parse(req.body) });
      } catch (e) {
        return reject(e);
      }
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!raw) return resolve({ rawBody: '{}', body: {} });
      try {
        resolve({ rawBody: raw, body: JSON.parse(raw) });
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/**
 * Direct Vercel Serverless Endpoint: `/api/payment/webhook`
 */
module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        service: 'DiwaliBigdeal Payment Verification Endpoint',
        endpoint: '/api/payment/webhook',
        status: 'READY',
        payment_provider: 'telegram_stars',
        note: 'Telegram Stars payments are verified natively via pre_checkout_query and successful_payment updates on /api/telegram/webhook, or via HMAC-SHA256 signed POST requests to /api/payment/webhook.',
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    }

    const { rawBody, body } = await readRawAndJsonBody(req);
    const signature = req.headers['x-payment-webhook-signature'];

    if (!verifyPaymentWebhookSignature(rawBody, signature)) {
      logger.security(
        'PaymentWebhook',
        'Rejected payment webhook due to invalid HMAC-SHA256 signature'
      );
      return sendJson(res, 401, {
        ok: false,
        error: 'Invalid webhook cryptographic signature (HMAC-SHA256 verification failed)',
      });
    }

    const paymentId = String(body.payment_id || body.invoice_payload || '');
    const eventStatus = body.status === 'FAILED' ? 'FAILED' : 'PAID';
    const amountInRupees = Number(body.amount || getConfig().CAMPAIGN_ENTRY_FEE);

    if (!paymentId) {
      return sendJson(res, 400, { ok: false, error: 'Missing payment_id in webhook payload' });
    }

    const result = await processVerifiedPaymentWebhook({
      paymentId,
      eventStatus,
      amountInRupees,
      telegramPaymentChargeId: body.telegram_payment_charge_id,
    });

    return sendJson(res, 200, {
      ok: true,
      ...result,
    });
  } catch (err) {
    return sendJson(res, 400, {
      ok: false,
      error: err instanceof Error ? err.message : 'Webhook processing failed',
    });
  }
};
