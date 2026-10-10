/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const {
  getPublicConfigStatus,
  logger,
  db,
  verifyTelegramWebhookSecret,
  handleTelegramUpdate,
} = require('../_botCore');

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
 * Direct Vercel Serverless Endpoint: `/api/telegram/webhook`
 *
 * - GET  /api/telegram/webhook -> Returns HTTP 200 JSON diagnostic with status: "READY"
 * - POST /api/telegram/webhook -> Processes Telegram updates (message, callback_query, pre_checkout_query)
 */
module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const status = getPublicConfigStatus();
      return sendJson(res, 200, {
        ok: true,
        service: 'DiwaliBigdeal Telegram Bot Webhook',
        endpoint: '/api/telegram/webhook',
        status: 'READY',
        supported_methods: ['POST', 'GET'],
        supported_updates: ['message', 'callback_query', 'pre_checkout_query'],
        payment_mode: 'telegram_stars (XTR)',
        entry_fee_inr: status.entryFee,
        stars_amount: status.starsAmount,
        telegram_bot_token_configured: status.telegramBotTokenConfigured,
        telegram_webhook_secret_configured: status.telegramWebhookSecretConfigured,
        instructions:
          'Send POST requests with Telegram Bot API Update JSON payloads to this endpoint. Register via https://api.telegram.org/bot<TOKEN>/setWebhook',
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    }

    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    const isInternalSimulator = req.headers['x-simulator-internal'] === 'true';

    if (
      !isInternalSimulator &&
      process.env.TELEGRAM_WEBHOOK_SECRET &&
      process.env.TELEGRAM_WEBHOOK_SECRET !== 'YOUR_TELEGRAM_WEBHOOK_SECRET'
    ) {
      if (!verifyTelegramWebhookSecret(secretHeader)) {
        logger.security(
          'TelegramWebhook',
          'Rejected unauthorized Telegram webhook request (invalid secret token)'
        );
        return sendJson(res, 401, {
          ok: false,
          error: 'Unauthorized Telegram webhook secret token',
        });
      }
    }

    const update = await readJsonBody(req);
    if (!update || typeof update.update_id !== 'number') {
      logger.warn('TelegramWebhook', 'Rejected malformed Telegram update payload');
      return sendJson(res, 400, {
        ok: false,
        error: 'Invalid Telegram Update payload (missing numeric update_id)',
      });
    }

    logger.webhook('TelegramWebhook', `Received Telegram update_id=${update.update_id}`, {
      hasMessage: Boolean(update.message),
      hasCallbackQuery: Boolean(update.callback_query),
      hasPreCheckoutQuery: Boolean(update.pre_checkout_query),
      hasSuccessfulPayment: Boolean(update.message && update.message.successful_payment),
    });

    const customer = await handleTelegramUpdate(update);
    const chatId = String(
      (update.message && update.message.chat && update.message.chat.id) ||
        (update.callback_query &&
          update.callback_query.message &&
          update.callback_query.message.chat &&
          update.callback_query.message.chat.id) ||
        (update.callback_query && update.callback_query.from && update.callback_query.from.id) ||
        (update.pre_checkout_query &&
          update.pre_checkout_query.from &&
          update.pre_checkout_query.from.id) ||
        ''
    );

    return sendJson(res, 200, {
      ok: true,
      customer,
      chatHistory: chatId ? db.getChatHistory(chatId) : [],
    });
  } catch (err) {
    logger.error('TelegramWebhook', 'Unhandled error processing Telegram update', {
      error: err instanceof Error ? err.message : String(err),
    });
    return sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
};
