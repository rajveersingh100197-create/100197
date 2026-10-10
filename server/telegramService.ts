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

/**
 * Telegram Bot API Service
 *
 * Handles:
 * - Sending messages & inline keyboards via official Telegram Bot API (`sendMessage`)
 * - Creating Telegram Stars invoice links (`createInvoiceLink` with currency="XTR", amount=100)
 * - Sending native Telegram Stars invoices (`sendInvoice` with currency="XTR", amount=100)
 * - Answering pre-checkout queries (`answerPreCheckoutQuery`)
 * - Answering callback queries (`answerCallbackQuery`)
 * - Validating incoming Telegram webhook secret header (`X-Telegram-Bot-Api-Secret-Token`)
 */

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

export function verifyTelegramWebhookSecret(headerToken?: string): boolean {
  if (
    !CONFIG.TELEGRAM_WEBHOOK_SECRET ||
    CONFIG.TELEGRAM_WEBHOOK_SECRET === 'YOUR_TELEGRAM_WEBHOOK_SECRET'
  ) {
    return true;
  }
  if (!headerToken) {
    return false;
  }
  try {
    const a = Buffer.from(headerToken);
    const b = Buffer.from(CONFIG.TELEGRAM_WEBHOOK_SECRET);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
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
          chat_id: cid,
          response: errBody,
        });
      } else {
        logger.info('TelegramAPI', `Delivered Telegram message to chat_id=${cid}`);
      }
    } catch (err) {
      logger.error('TelegramAPI', 'Failed to call Telegram Bot API sendMessage', {
        chat_id: cid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.info('TelegramBot', `Prepared message for chat_id=${cid}`, {
      preview: text.split('\n')[0],
      hasButtons: Boolean(replyMarkup),
    });
  }

  return outgoingRecord;
}

/**
 * Creates a native Telegram Stars invoice URL via `createInvoiceLink`:
 * - currency: "XTR"
 * - provider_token: ""
 * - prices: [{"label":"DiwaliBigdeal Entry","amount":100}]
 */
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

/**
 * Sends a native Telegram Stars invoice directly to the chat via `sendInvoice`:
 * - currency: "XTR"
 * - provider_token: ""
 * - prices: [{"label":"DiwaliBigdeal Entry","amount":100}]
 * - No Cancel button
 */
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
      logger.info('TelegramStars', `Sent native Telegram Stars invoice to chat_id=${cid}`, {
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

/**
 * Answers a Telegram Stars `pre_checkout_query` within 10 seconds as required by Telegram Bot API.
 */
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
