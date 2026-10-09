/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { CONFIG } from './config.js';
import { db } from './db.js';
import { logger } from './logger.js';
import {
  InlineKeyboardMarkup,
  OutgoingBotMessage,
  ReplyKeyboardMarkup,
} from './types.js';

/**
 * Telegram Bot API Service
 *
 * Handles:
 * - Sending messages & inline keyboards via official Telegram Bot API (`https://api.telegram.org/bot<TOKEN>/sendMessage`)
 * - Answering callback queries (`answerCallbackQuery`)
 * - Validating incoming Telegram webhook secret header (`X-Telegram-Bot-Api-Secret-Token`)
 * - Recording conversation transcripts so the admin / simulator console can inspect real-time bot responses
 */

export const MAIN_MENU_INLINE_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '🎟️ Join ₹199 Entry', callback_data: 'menu_join_199' }],
    [
      { text: '🎫 My Ticket', callback_data: 'menu_my_ticket' },
      { text: '🏆 Prize Details', callback_data: 'menu_prize_details' },
    ],
    [{ text: '🆘 Support', callback_data: 'menu_support' }],
  ],
};

export const MAIN_MENU_REPLY_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: '🎟️ Join ₹199 Entry' }],
    [{ text: '🎫 My Ticket' }, { text: '🏆 Prize Details' }],
    [{ text: '🆘 Support' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export function verifyTelegramWebhookSecret(headerToken?: string): boolean {
  if (!CONFIG.TELEGRAM_WEBHOOK_SECRET) {
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

  // If real TELEGRAM_BOT_TOKEN is configured, dispatch to api.telegram.org
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
