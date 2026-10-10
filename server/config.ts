/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  PORT: Number(process.env.PORT) || 3000,
  APP_URL: process.env.APP_URL || 'https://100197-oqqb.vercel.app',
  CAMPAIGN_NAME: 'DiwaliBigdeal',
  CAMPAIGN_ENTRY_FEE: Number(process.env.CAMPAIGN_ENTRY_FEE) || 199,
  TELEGRAM_STARS_AMOUNT: Number(process.env.TELEGRAM_STARS_AMOUNT) || 199,
  PRIZE_ANNOUNCEMENT_DATE: '8 November 2026',
  PRIZE_ANNOUNCEMENT_TIME: '11:59 PM IST',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER || 'telegram_stars',
  PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET || 'diwali_payment_secret_2026',
  DATABASE_PATH: process.env.DATABASE_PATH || './data/diwalibigdeal.sqlite',
  DATABASE_URL: process.env.DATABASE_URL || '',
  ADMIN_API_SECRET: process.env.ADMIN_API_SECRET || '',
};

export function getPublicConfigStatus() {
  return {
    campaignName: CONFIG.CAMPAIGN_NAME,
    entryFee: CONFIG.CAMPAIGN_ENTRY_FEE,
    starsAmount: CONFIG.TELEGRAM_STARS_AMOUNT,
    prizeAnnouncement: `${CONFIG.PRIZE_ANNOUNCEMENT_DATE} at ${CONFIG.PRIZE_ANNOUNCEMENT_TIME}`,
    telegramBotTokenConfigured: Boolean(
      CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN'
    ),
    telegramWebhookSecretConfigured: Boolean(
      CONFIG.TELEGRAM_WEBHOOK_SECRET &&
        CONFIG.TELEGRAM_WEBHOOK_SECRET !== 'YOUR_TELEGRAM_WEBHOOK_SECRET'
    ),
    paymentProvider: 'telegram_stars',
    paymentCredentialsConfigured: Boolean(
      CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN'
    ),
    paymentWebhookSecretConfigured: Boolean(CONFIG.PAYMENT_WEBHOOK_SECRET),
    databasePath: CONFIG.DATABASE_PATH,
    appUrl: CONFIG.APP_URL,
  };
}
