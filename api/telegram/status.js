/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const mainHandler = require('../index.js');

/**
 * Safe Diagnostic Endpoint: `/api/telegram/status`
 * Reports Telegram `getWebhookInfo` registration status and auto-synchronizes
 * the production webhook (`https://100197-oqqb.vercel.app/api/telegram/webhook`)
 * without exposing the bot token or webhook secret.
 */
module.exports = function handler(req, res) {
  const qs = req.url && req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  req.url = `/api/telegram/status${qs}`;
  return mainHandler(req, res);
};
