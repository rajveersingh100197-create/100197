/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  PORT: Number(process.env.PORT) || 3000,
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  CAMPAIGN_NAME: 'DiwaliBigdeal',
  CAMPAIGN_ENTRY_FEE: Number(process.env.CAMPAIGN_ENTRY_FEE) || 199,
  PRIZE_ANNOUNCEMENT_DATE: '8 November 2026',
  PRIZE_ANNOUNCEMENT_TIME: '11:59 PM IST',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || 'diwali_webhook_secret_2026',
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER || 'razorpay',
  PAYMENT_KEY_ID: process.env.PAYMENT_KEY_ID || '',
  PAYMENT_KEY_SECRET: process.env.PAYMENT_KEY_SECRET || '',
  PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET || 'diwali_payment_secret_2026',
  DATABASE_PATH: process.env.DATABASE_PATH || './data/diwalibigdeal.sqlite',
  DATABASE_URL: process.env.DATABASE_URL || '',
  ADMIN_API_SECRET: process.env.ADMIN_API_SECRET || '',
};

export function getPublicConfigStatus() {
  return {
    campaignName: CONFIG.CAMPAIGN_NAME,
    entryFee: CONFIG.CAMPAIGN_ENTRY_FEE,
    prizeAnnouncement: `${CONFIG.PRIZE_ANNOUNCEMENT_DATE} at ${CONFIG.PRIZE_ANNOUNCEMENT_TIME}`,
    telegramBotTokenConfigured: Boolean(
      CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN'
    ),
    telegramWebhookSecretConfigured: Boolean(CONFIG.TELEGRAM_WEBHOOK_SECRET),
    paymentProvider: CONFIG.PAYMENT_PROVIDER,
    paymentCredentialsConfigured: Boolean(
      CONFIG.PAYMENT_KEY_ID &&
        CONFIG.PAYMENT_KEY_ID !== 'YOUR_PAYMENT_KEY_ID' &&
        CONFIG.PAYMENT_KEY_SECRET &&
        CONFIG.PAYMENT_KEY_SECRET !== 'YOUR_PAYMENT_KEY_SECRET'
    ),
    paymentWebhookSecretConfigured: Boolean(CONFIG.PAYMENT_WEBHOOK_SECRET),
    databasePath: CONFIG.DATABASE_PATH,
    appUrl: CONFIG.APP_URL,
  };
}
