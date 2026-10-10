/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stateless Health-Check Route (`GET /api/health`)
 * Zero external dependencies, does not require Telegram secrets or a database.
 */
module.exports = function handler(_req, res) {
  const botTokenConfigured = Boolean(
    process.env.TELEGRAM_BOT_TOKEN &&
      process.env.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN'
  );

  const payload = JSON.stringify({
    ok: true,
    status: 'HEALTHY',
    endpoint: '/api/health',
    service: 'DiwaliBigdeal Telegram Bot Backend',
    runtime: process.env.VERCEL ? 'vercel-serverless' : 'node',
    payment_mode: 'telegram_stars (XTR)',
    entry_fee_inr: Number(process.env.CAMPAIGN_ENTRY_FEE) || 199,
    stars_amount: Number(process.env.TELEGRAM_STARS_AMOUNT) || 199,
    telegram_bot_token_configured: botTokenConfigured,
    timestamp: new Date().toISOString(),
  });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(payload);
};
