/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const {
  getConfig,
  getPublicConfigStatus,
  logger,
  db,
  MAIN_MENU_INLINE_KEYBOARD,
  sendTelegramMessage,
  createPaymentOrderForCustomer,
  computeWebhookSignature,
  verifyPaymentWebhookSignature,
  processVerifiedPaymentWebhook,
} = require('./_botCore');
const telegramWebhookHandler = require('./telegram/webhook');
const paymentWebhookHandler = require('./payment/webhook');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    if (typeof req.body === 'string' && req.body.length > 0) {
      try {
        return resolve(JSON.parse(req.body));
      } catch (e) {
        return reject(e);
      }
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
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
 * Catch-All Vercel Serverless Router (`/api/index.js`)
 * Routes all `/api/*` endpoints with zero external npm dependencies.
 */
module.exports = async function handler(req, res) {
  try {
    const urlPath = (req.url || '').split('?')[0];

    if (urlPath === '/api/health' || urlPath === '/health') {
      const cfg = getPublicConfigStatus();
      return sendJson(res, 200, {
        ok: true,
        status: 'HEALTHY',
        endpoint: '/api/health',
        service: 'DiwaliBigdeal Telegram Bot Backend',
        runtime: process.env.VERCEL ? 'vercel-serverless' : 'node',
        payment_mode: 'telegram_stars (XTR)',
        entry_fee_inr: cfg.entryFee,
        stars_amount: cfg.starsAmount,
        telegram_bot_token_configured: cfg.telegramBotTokenConfigured,
        timestamp: new Date().toISOString(),
      });
    }

    if (urlPath === '/api/telegram/webhook') {
      return telegramWebhookHandler(req, res);
    }

    if (urlPath === '/api/payment/webhook') {
      return paymentWebhookHandler(req, res);
    }

    if (req.method === 'GET' && urlPath === '/api/admin/overview') {
      const customers = db.listAllCustomers();
      const logs = logger.getRecentLogs(80);
      const configStatus = getPublicConfigStatus();
      const fee = getConfig().CAMPAIGN_ENTRY_FEE;

      const stats = {
        totalCustomers: customers.length,
        confirmedTickets: customers.filter((c) => c.payment_status === 'PAID' && c.ticket_number).length,
        pendingPayments: customers.filter((c) => c.payment_status === 'PENDING').length,
        totalRevenueInr:
          customers.filter((c) => c.payment_status === 'PAID' && c.ticket_number).length * fee,
      };

      return sendJson(res, 200, {
        ok: true,
        config: configStatus,
        stats,
        customers,
        logs,
        sqlSchema: db.getSQLSchemaDDL(),
      });
    }

    if (req.method === 'GET' && urlPath.startsWith('/api/admin/chat/')) {
      const chatId = decodeURIComponent(urlPath.replace('/api/admin/chat/', ''));
      const customer = db.getCustomerByUserId(chatId);
      const history = db.getChatHistory(chatId);
      return sendJson(res, 200, {
        ok: true,
        customer,
        chatHistory: history,
      });
    }

    if (req.method === 'POST' && urlPath === '/api/payment/create') {
      const body = await readJsonBody(req);
      if (!body.telegram_user_id) {
        return sendJson(res, 400, { ok: false, error: 'telegram_user_id is required' });
      }
      const customer = db.getCustomerByUserId(String(body.telegram_user_id));
      if (!customer) {
        return sendJson(res, 404, { ok: false, error: 'Customer not found' });
      }
      const paymentResult = await createPaymentOrderForCustomer(customer);
      return sendJson(res, 200, {
        ok: true,
        payment: paymentResult,
        customer: db.getCustomerByUserId(String(body.telegram_user_id)),
      });
    }

    if (req.method === 'POST' && urlPath === '/api/admin/trigger-payment-webhook') {
      const body = await readJsonBody(req);
      const payment_id = body.payment_id;
      const status = body.status || 'PAID';
      const amount = Number(body.amount || 199);
      const tamper_signature = Boolean(body.tamper_signature);

      if (!payment_id) {
        return sendJson(res, 400, { ok: false, error: 'payment_id is required' });
      }

      const webhookPayload = {
        event: status === 'PAID' ? 'telegram_stars.successful_payment' : 'telegram_stars.failed',
        payment_id,
        status,
        amount,
        currency: 'XTR',
        timestamp: new Date().toISOString(),
      };

      const rawBody = JSON.stringify(webhookPayload);
      const validSignature = computeWebhookSignature(rawBody);
      const signatureToUse = tamper_signature
        ? '000000000000000000000000000000000000000000000000000000000000dead'
        : validSignature;

      if (!verifyPaymentWebhookSignature(rawBody, signatureToUse)) {
        return sendJson(res, 401, {
          ok: false,
          error: 'Webhook rejected: Invalid HMAC-SHA256 signature',
          signatureUsed: signatureToUse,
        });
      }

      const result = await processVerifiedPaymentWebhook({
        paymentId: payment_id,
        eventStatus: status,
        amountInRupees: amount,
      });

      return sendJson(res, 200, {
        ok: true,
        signatureVerified: true,
        signatureUsed: signatureToUse,
        ...result,
      });
    }

    if (req.method === 'POST' && urlPath === '/api/admin/reset-customer') {
      const body = await readJsonBody(req);
      if (!body.telegram_user_id) {
        return sendJson(res, 400, { ok: false, error: 'telegram_user_id required' });
      }
      const uid = String(body.telegram_user_id);
      db.resetCustomerForTesting(uid);
      const customer = db.getOrCreateCustomer(uid, uid);
      await sendTelegramMessage(
        uid,
        [
          '🪔 Welcome to DiwaliBigdeal!',
          '',
          'Entry Fee: ₹199',
          'Win Mahindra Thar ROXX, Double-Door Refrigerator, Smart LED TV & Multiple Cash Prizes!',
          '',
          'Please choose an option below:',
        ].join('\n'),
        MAIN_MENU_INLINE_KEYBOARD
      );
      return sendJson(res, 200, {
        ok: true,
        customer,
        chatHistory: db.getChatHistory(uid),
      });
    }

    return sendJson(res, 404, {
      ok: false,
      error: `Endpoint ${urlPath} not found`,
    });
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal Server Error',
    });
  }
};
