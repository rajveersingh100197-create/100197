/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { app } from './app';
import { getPublicConfigStatus } from './config';

/**
 * Primary Vercel Serverless Function Handler (Bundled into `/api/index.js`)
 *
 * Uses standard Node `IncomingMessage` and `ServerResponse` methods (`res.statusCode`, `res.end`)
 * in the outer wrapper, and delegates `/api/*` routing to Express `app(req, res)`.
 */
function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const urlPath = (req.url || '').split('?')[0];

    // Stateless health check that does not require Telegram secrets or database
    if (req.method === 'GET' && (urlPath === '/api/health' || urlPath === '/health')) {
      const config = getPublicConfigStatus();
      const payload = JSON.stringify({
        ok: true,
        status: 'HEALTHY',
        endpoint: '/api/health',
        service: 'DiwaliBigdeal Serverless Backend',
        runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-server',
        payment_mode: 'telegram_stars (XTR)',
        entry_fee_inr: config.entryFee,
        stars_amount: config.starsAmount,
        telegram_bot_token_configured: config.telegramBotTokenConfigured,
        telegram_webhook_secret_configured: config.telegramWebhookSecretConfigured,
        timestamp: new Date().toISOString(),
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(payload);
      return;
    }

    return (app as any)(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: false,
        error: 'Serverless function invocation error',
        details: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

export default handler;
module.exports = handler;
