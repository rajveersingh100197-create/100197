/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { CONFIG } from './config';
import { db } from './db';
import { logger } from './logger';
import {
  InlineKeyboardMarkup,
  OutgoingBotMessage,
  ReplyKeyboardMarkup,
} from './types';

export const MAIN_MENU_INLINE_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '🎟️ Join Entry (100 Telegram Stars ⭐️)', callback_data: 'menu_join_199' }],
    [
      { text: '🎫 My Ticket', callback_data: 'menu_my_ticket' },
      { text: '🏆 Prize Details', callback_data: 'menu_prize_details' },
    ],
    [{ text: '🆘 Support', callback_data: 'menu_support' }],
  ],
};

export const MAIN_MENU_REPLY_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: '🎟️ Join Entry (100 Telegram Stars ⭐️)' }],
    [{ text: '🎫 My Ticket' }, { text: '🏆 Prize Details' }],
    [{ text: '🆘 Support' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export function sanitizeSecretToken(raw?: string): string {
  return String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '');
}

export function verifyTelegramWebhookSecret(headerToken?: string): boolean {
  const secret = sanitizeSecretToken(CONFIG.TELEGRAM_WEBHOOK_SECRET);
  if (!secret || secret === 'YOUR_TELEGRAM_WEBHOOK_SECRET') {
    return true;
  }
  if (!headerToken) {
    return false;
  }
  try {
    const a = Buffer.from(headerToken.trim());
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Fetches live Telegram `getWebhookInfo` and `getMe` safely without exposing any token or secret.
 */
export async function getSafeTelegramWebhookDiagnostics() {
  const token = CONFIG.TELEGRAM_BOT_TOKEN;
  const expectedUrl = CONFIG.PRODUCTION_WEBHOOK_URL;
  const secretConfigured = Boolean(
    CONFIG.TELEGRAM_WEBHOOK_SECRET &&
      CONFIG.TELEGRAM_WEBHOOK_SECRET !== 'YOUR_TELEGRAM_WEBHOOK_SECRET'
  );

  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN') {
    return {
      ok: false,
      telegram_bot_token_configured: false,
      telegram_webhook_secret_configured: secretConfigured,
      expected_webhook_url: expectedUrl,
      webhook_registered: false,
      url_matches_production: false,
      error: 'TELEGRAM_BOT_TOKEN is not configured in environment variables.',
    };
  }

  try {
    const [whResp, meResp] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { method: 'GET' }),
      fetch(`https://api.telegram.org/bot${token}/getMe`, { method: 'GET' }),
    ]);

    const whData = (await whResp.json()) as { ok: boolean; result?: Record<string, any> };
    const meData = (await meResp.json()) as { ok: boolean; result?: Record<string, any> };

    const info = whData?.result || {};
    const botInfo = meData?.result || null;
    const currentUrl = String(info.url || '');
    const urlMatches = currentUrl === expectedUrl;

    return {
      ok: Boolean(whData?.ok),
      telegram_bot_token_configured: true,
      telegram_webhook_secret_configured: secretConfigured,
      bot: botInfo
        ? {
            id: botInfo.id,
            username: botInfo.username,
            first_name: botInfo.first_name,
          }
        : null,
      expected_webhook_url: expectedUrl,
      current_webhook_url: currentUrl,
      webhook_registered: Boolean(currentUrl),
      url_matches_production: urlMatches,
      pending_update_count: info.pending_update_count ?? 0,
      last_error_date: info.last_error_date
        ? new Date(info.last_error_date * 1000).toISOString()
        : null,
      last_error_message: info.last_error_message || null,
      max_connections: info.max_connections ?? null,
      allowed_updates: info.allowed_updates || ['message', 'callback_query', 'pre_checkout_query'],
      ip_address: info.ip_address || null,
    };
  } catch (err) {
    return {
      ok: false,
      telegram_bot_token_configured: true,
      telegram_webhook_secret_configured: secretConfigured,
      expected_webhook_url: expectedUrl,
      webhook_registered: false,
      url_matches_production: false,
      error: err instanceof Error ? err.message : 'Failed to reach Telegram Bot API',
    };
  }
}

/**
 * Registers the production webhook URL (`https://100197-oqqb.vercel.app/api/telegram/webhook`),
 * allowed_updates (`message`, `callback_query`, `pre_checkout_query`), and bot commands with Telegram.
 */
export async function ensureTelegramWebhookRegistered(forceSync = false) {
  const token = CONFIG.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN') {
    return {
      synced: false,
      reason: 'TELEGRAM_BOT_TOKEN not configured',
    };
  }

  try {
    const currentDiag = await getSafeTelegramWebhookDiagnostics();
    const hasSecretMismatchError =
      currentDiag.last_error_message &&
      (currentDiag.last_error_message.includes('401') ||
        currentDiag.last_error_message.includes('404') ||
        currentDiag.last_error_message.includes('500') ||
        currentDiag.last_error_message.includes('Wrong response'));

    const needsRegistration =
      forceSync ||
      !currentDiag.webhook_registered ||
      !currentDiag.url_matches_production ||
      hasSecretMismatchError;

    if (!needsRegistration) {
      return {
        synced: false,
        already_valid: true,
        diagnostics: currentDiag,
      };
    }

    const cleanSecret = sanitizeSecretToken(CONFIG.TELEGRAM_WEBHOOK_SECRET);
    const setWebhookPayload: Record<string, unknown> = {
      url: CONFIG.PRODUCTION_WEBHOOK_URL,
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      drop_pending_updates: false,
    };

    if (cleanSecret && cleanSecret !== 'YOUR_TELEGRAM_WEBHOOK_SECRET') {
      setWebhookPayload.secret_token = cleanSecret;
    }

    const setRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setWebhookPayload),
    });
    const setJson = (await setRes.json()) as { ok: boolean; description?: string };

    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: 'Start DiwaliBigdeal & view main menu' },
          { command: 'enter', description: 'Join DiwaliBigdeal (100 Telegram Stars ⭐️)' },
          { command: 'ticket', description: 'View your confirmed DB2026 ticket' },
          { command: 'prizes', description: 'View Mahindra Thar ROXX & prize details' },
          { command: 'terms', description: 'View campaign rules & terms' },
          { command: 'support', description: 'Get customer support' },
        ],
      }),
    }).catch(() => {});

    const updatedDiag = await getSafeTelegramWebhookDiagnostics();

    logger.info('TelegramWebhook', 'Synchronized Telegram Bot webhook registration', {
      ok: Boolean(setJson?.ok),
      url: CONFIG.PRODUCTION_WEBHOOK_URL,
      secretTokenAttached: Boolean(setWebhookPayload.secret_token),
    });

    return {
      synced: Boolean(setJson?.ok),
      description: setJson?.description,
      diagnostics: updatedDiag,
    };
  } catch (err) {
    logger.error('TelegramWebhook', 'Failed to synchronize Telegram webhook', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      synced: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup | ReplyKeyboardMarkup
): Promise<OutgoingBotMessage> {
  const cid = String(chatId);

  const outgoingRecord: OutgoingBotMessage = {
    id: crypto.randomUUID(),
    chat_id: cid,
    text,
    reply_markup: replyMarkup,
    timestamp: new Date().toISOString(),
    direction: 'bot',
  };

  db.appendChatMessage(cid, outgoingRecord);

  if (
    CONFIG.TELEGRAM_BOT_TOKEN &&
    CONFIG.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN' &&
    !cid.startsWith('sim_')
  ) {
    try {
      const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
      const payload: Record<string, unknown> = {
        chat_id: cid,
        text,
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errBody = await response.text();
        logger.warn('TelegramAPI', `Telegram sendMessage returned HTTP ${response.status}`, {
          status: response.status,
          description: errBody.slice(0, 200),
        });
      } else {
        logger.info('TelegramAPI', 'Delivered outgoing Telegram reply message');
      }
    } catch (err) {
      logger.error('TelegramAPI', 'Failed to call Telegram Bot API sendMessage', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.info('TelegramBot', 'Prepared bot reply message', {
      preview: text.split('\n')[0],
      hasButtons: Boolean(replyMarkup),
    });
  }

  return outgoingRecord;
}

export async function createTelegramStarsInvoiceLink(
  paymentId: string
): Promise<string | null> {
  if (
    !CONFIG.TELEGRAM_BOT_TOKEN ||
    CONFIG.TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN'
  ) {
    return null;
  }

  try {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/createInvoiceLink`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'DiwaliBigdeal Entry',
        description: 'Confirm your DiwaliBigdeal campaign entry (100 Telegram Stars ⭐️).',
        payload: paymentId,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: 'DiwaliBigdeal Entry', amount: 100 }],
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as { ok: boolean; result?: string };
      if (data.ok && data.result) {
        logger.info('TelegramStars', `Created Telegram Stars invoice link for ${paymentId}`, {
          currency: 'XTR',
          amount: 100,
        });
        return data.result;
      }
    } else {
      const errText = await response.text();
      logger.warn('TelegramStars', 'Telegram createInvoiceLink returned error', {
        status: response.status,
        response: errText,
      });
    }
  } catch (err) {
    logger.error('TelegramStars', 'Failed to call createInvoiceLink', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
}

export async function sendTelegramStarsInvoice(
  chatId: string | number,
  paymentId: string
): Promise<boolean> {
  const cid = String(chatId);
  if (
    !CONFIG.TELEGRAM_BOT_TOKEN ||
    CONFIG.TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN' ||
    cid.startsWith('sim_')
  ) {
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendInvoice`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cid,
        title: 'DiwaliBigdeal Entry',
        description: 'Please complete your payment to confirm your DiwaliBigdeal entry.',
        payload: paymentId,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: 'DiwaliBigdeal Entry', amount: 100 }],
        reply_markup: {
          // Strictly NO Cancel button
          inline_keyboard: [[{ text: '💰 Pay 100 Telegram Stars ⭐️', pay: true }]],
        },
      }),
    });

    if (response.ok) {
      logger.info('TelegramStars', 'Sent native Telegram Stars invoice', {
        paymentId,
        currency: 'XTR',
        amount: 100,
      });
      return true;
    } else {
      const errText = await response.text();
      logger.warn('TelegramStars', 'Telegram sendInvoice returned error', {
        status: response.status,
        response: errText,
      });
    }
  } catch (err) {
    logger.error('TelegramStars', 'Failed to call sendInvoice', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return false;
}

export async function answerTelegramPreCheckoutQuery(
  preCheckoutQueryId: string,
  ok: boolean,
  errorMessage?: string
): Promise<void> {
  if (
    !CONFIG.TELEGRAM_BOT_TOKEN ||
    CONFIG.TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN' ||
    preCheckoutQueryId.startsWith('sim_pcq_')
  ) {
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/answerPreCheckoutQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pre_checkout_query_id: preCheckoutQueryId,
        ok,
        error_message: errorMessage,
      }),
    });
  } catch (err) {
    logger.error('TelegramStars', 'Failed to answer pre_checkout_query', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  if (
    !CONFIG.TELEGRAM_BOT_TOKEN ||
    CONFIG.TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN' ||
    callbackQueryId.startsWith('sim_cb_')
  ) {
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    });
  } catch (err) {
    logger.warn('TelegramAPI', 'Failed to answer callback_query', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
