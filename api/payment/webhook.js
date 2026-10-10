/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const mainHandler = require('../index.js');

/**
 * Direct Vercel Serverless Endpoint: `/api/payment/webhook`
 * Delegates directly to the self-contained `/api/index.js` handler.
 */
module.exports = function handler(req, res) {
  if (!req.url || !req.url.startsWith('/api/payment/webhook')) {
    req.url = '/api/payment/webhook';
  }
  return mainHandler(req, res);
};
