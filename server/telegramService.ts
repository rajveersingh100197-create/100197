/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { CONFIG } from './config';
import { db, AdminNotificationEntry } from './db';
import { logger } from './logger';
import {
  CustomerRecord,
  InlineKeyboardMarkup,
  OutgoingBotMessage,
  ReplyKeyboardMarkup,
  WithdrawalRequest,
} from './types';

export const MAIN_MENU_INLINE_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '🎟️ अभी जुड़ें | Join Now (₹199)', callback_data: 'menu_join_199' }],
    [
      { text: '🎁 इनाम देखें | View Prizes', callback_data: 'menu_prize_details' },
      { text: '🎫 मेरा टिकट | My Ticket', callback_data: 'menu_my_ticket' },
    ],
    [{ text: '🎁 Refer & Earn', callback_data: 'menu_refer_earn' }],
    [
      { text: '📜 नियम और शर्तें | Terms & Conditions', callback_data: 'menu_terms' },
      { text: '📞 सहायता | Support', callback_data: 'menu_support' },
    ],
  ],
};

export const MAIN_MENU_REPLY_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: '🎟️ अभी जुड़ें | Join Now' }],
    [{ text: '🎁 इनाम देखें | View Prizes' }, { text: '🎫 मेरा टिकट | My Ticket' }],
    [{ text: '🎁 Refer & Earn' }],
    [{ text: '📜 नियम और शर्तें | Terms & Conditions' }, { text: '📞 सहायता | Support' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export function sanitizeSecretToken(raw?: string): string {
  return String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * Validates that TELEGRAM_ADMIN_CHAT_ID is a configured private group / supergroup ID
 * (negative integer, e.g. -1001234567890) and NOT a placeholder or customer's positive ID.
 */
export function validateAdminGroupChatId(rawChatId = CONFIG.TELEGRAM_ADMIN_CHAT_ID): {
  valid: boolean;
  chatId: string;
  reason?: string;
} {
  const cleaned = String(rawChatId || '').trim();
  if (!cleaned || cleaned === 'YOUR_PRIVATE_ADMIN_GROUP_CHAT_ID') {
    return {
      valid: false,
      chatId: '',
      reason: 'TELEGRAM_ADMIN_CHAT_ID is not configured in environment variables.',
    };
  }
  if (!/^-\d+$/.test(cleaned)) {
    return {
      valid: false,
      chatId: '',
      reason:
        'TELEGRAM_ADMIN_CHAT_ID must be a negative numeric Telegram group/supergroup ID (e.g. -1001234567890). Never use a positive customer ID.',
    };
  }
  return { valid: true, chatId: cleaned };
}

function maskPhoneNumberForAdmin(phone?: string | null): string {
  const clean = String(phone || '').replace(/\D/g, '');
  if (clean.length < 4) return 'Not provided';
  const last4 = clean.slice(-4);
  return `+91-XXXXXX${last4}`;
}

function summarizeAddressForAdmin(address?: string | null): string {
  const clean = String(address || '').trim();
  if (!clean) return 'Not provided';
  // Extract PIN code if present, and last locality/city segment without exposing full street/house numbers
  const pinMatch = clean.match(/\b([1-9]\d{5})\b/);
  const parts = clean
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const tail = parts.slice(-2).join(', ');
  const summary = tail.length > 48 ? `${tail.slice(0, 48)}...` : tail;
  if (pinMatch && !summary.includes(pinMatch[1])) {
    return `${summary} (${pinMatch[1]})`;
  }
  return summary || 'Provided (Verified)';
}

/**
 * Sends a deduplicated admin activity notification to the configured private Telegram admin group.
 * Never exposes bot tokens, secrets, or unnecessary sensitive personal data.
 */
export async function sendAdminGroupNotification(params: {
  eventType: AdminNotificationEntry['event_type'];
  dedupKey: string;
  text: string;
  allowDuplicate?: boolean;
}): Promise<{
  ok: boolean;
  skipped_duplicate?: boolean;
  delivered_to_telegram: boolean;
  status: string;
  entry?: AdminNotificationEntry;
}> {
  const { eventType, dedupKey, text, allowDuplicate = false } = params;

  if (!allowDuplicate && db.hasAdminNotificationBeenSent(dedupKey)) {
    return {
      ok: true,
      skipped_duplicate: true,
      delivered_to_telegram: false,
      status: 'SKIPPED_DUPLICATE',
    };
  }

  const adminChatValidation = validateAdminGroupChatId();
  const token = CONFIG.TELEGRAM_BOT_TOKEN;
  let delivered = false;
  let status = 'LOGGED_LOCALLY';

  if (!adminChatValidation.valid) {
    status = `NOT_CONFIGURED (${adminChatValidation.reason})`;
  } else if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN') {
    status = 'BOT_TOKEN_NOT_CONFIGURED';
  } else {
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminChatValidation.chatId,
          text,
          disable_web_page_preview: true,
        }),
      });

      if (response.ok) {
        delivered = true;
        status = 'DELIVERED_TO_ADMIN_GROUP';
      } else {
        const errBody = await response.text();
        status = `TELEGRAM_HTTP_${response.status}`;
        logger.warn('AdminNotifier', `Failed to send admin group message (${status})`, {
          eventType,
          status: response.status,
          description: errBody.slice(0, 160),
        });
      }
    } catch (err) {
      status = 'NETWORK_ERROR';
      logger.error('AdminNotifier', 'Network error sending admin group notification', {
        eventType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const entry: AdminNotificationEntry = {
    id: crypto.randomUUID(),
    dedup_key: dedupKey,
    event_type: eventType,
    text,
    delivered_to_telegram: delivered,
    telegram_status: status,
    created_at: new Date().toISOString(),
  };

  db.markAdminNotificationSent(entry);

  logger.info('AdminNotifier', `Admin activity notification recorded (${eventType})`, {
    dedupKey,
    delivered,
    status,
  });

  return {
    ok: delivered || !adminChatValidation.valid,
    delivered_to_telegram: delivered,
    status,
    entry,
  };
}

/**
 * Server-side function to send a test message to the configured Telegram admin group.
 */
export async function sendTestMessageToAdminGroup(customNote?: string) {
  const adminCheck = validateAdminGroupChatId();
  const timestamp = new Date().toISOString();
  const testText = [
    '🔔 DIWALI BIGDEAL — ADMIN GROUP TEST NOTIFICATION',
    '',
    '✅ Server-side admin notification channel is active.',
    `🌐 Service: DiwaliBigdeal Telegram Bot (100197-oqqb)`,
    `🕒 Timestamp: ${timestamp}`,
    customNote ? `📝 Note: ${String(customNote).slice(0, 120)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const result = await sendAdminGroupNotification({
    eventType: 'ADMIN_TEST',
    dedupKey: `admin_test_${Date.now()}`,
    text: testText,
    allowDuplicate: true,
  });

  return {
    ok: result.delivered_to_telegram,
    admin_chat_configured: adminCheck.valid,
    validation_message: adminCheck.reason || 'Valid private group chat ID format.',
    delivery_status: result.status,
    notification: result.entry,
  };
}

export async function notifyAdminNewBotStart(params: {
  customer: CustomerRecord;
  username?: string | null;
  referralApplied?: boolean;
  referrer?: CustomerRecord | null;
}) {
  const { customer, username, referralApplied, referrer } = params;
  const dedupKey = `bot_start_${customer.telegram_user_id}`;
  const handle = username ? `@${username.replace(/^@/, '')}` : 'No username';

  const lines = [
    '🚀 NEW BOT START — DiwaliBigdeal',
    '',
    `👤 User ID: ${customer.telegram_user_id} (${handle})`,
    `🔗 User Referral Code: ${customer.referral_code}`,
    customer.referred_by
      ? `🤝 Referred By Code: ${customer.referred_by}${
          referralApplied && referrer
            ? ` (Referrer Total Referrals: ${referrer.referral_count})`
            : ''
        }`
      : '🤝 Referred By: Direct / Organic',
    `🕒 Started At: ${new Date().toISOString()}`,
  ];

  return sendAdminGroupNotification({
    eventType: 'BOT_START',
    dedupKey,
    text: lines.join('\n'),
  });
}

export async function notifyAdminReferralJoined(params: {
  referredCustomer: CustomerRecord;
  referrer: CustomerRecord;
}) {
  const { referredCustomer, referrer } = params;
  const dedupKey = `ref_join_${referredCustomer.telegram_user_id}_${referrer.referral_code}`;
  const handle = referredCustomer.username
    ? `@${referredCustomer.username.replace(/^@/, '')}`
    : 'No username';

  const lines = [
    '🤝 NEW REFERRAL LINK JOIN — DiwaliBigdeal',
    '',
    `👤 Referred User ID: ${referredCustomer.telegram_user_id} (${handle})`,
    `🔑 Used Referral Code: ${referrer.referral_code}`,
    `🎯 Referrer User ID: ${referrer.telegram_user_id}${
      referrer.name ? ` (${referrer.name})` : ''
    }`,
    `📊 Referrer Total Joined Users: ${referrer.referral_count}`,
    `🕒 Joined At: ${new Date().toISOString()}`,
  ];

  return sendAdminGroupNotification({
    eventType: 'BOT_START',
    dedupKey,
    text: lines.join('\n'),
  });
}

export async function notifyAdminRegistrationSubmitted(customer: CustomerRecord) {
  // Deduplicate based on user + normalized registration fingerprint so edits only notify if changed
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${customer.name || ''}|${customer.phone || ''}|${customer.address || ''}`)
    .digest('hex')
    .slice(0, 10);
  const dedupKey = `reg_submit_${customer.telegram_user_id}_${fingerprint}`;

  const lines = [
    '📝 REGISTRATION DETAILS SUBMITTED — DiwaliBigdeal',
    '',
    `👤 Customer Name: ${customer.name || 'Not provided'}`,
    `🆔 Telegram User ID: ${customer.telegram_user_id}`,
    `📱 Mobile (Masked): ${maskPhoneNumberForAdmin(customer.phone)}`,
    `📍 Location Summary: ${summarizeAddressForAdmin(customer.address)}`,
    `🔗 Referral Code: ${customer.referral_code}`,
    customer.referred_by ? `🤝 Referred By: ${customer.referred_by}` : null,
    `🕒 Submitted At: ${new Date().toISOString()}`,
  ].filter(Boolean);

  return sendAdminGroupNotification({
    eventType: 'REGISTRATION_SUBMITTED',
    dedupKey,
    text: lines.join('\n'),
  });
}

export async function notifyAdminVerifiedPayment(params: {
  customer: CustomerRecord;
  ticketNumber: string;
  paymentId: string;
  chargeId?: string;
  referralBonusCredited?: boolean;
  referrer?: CustomerRecord | null;
  bonusAdded?: number;
}) {
  const {
    customer,
    ticketNumber,
    paymentId,
    chargeId,
    referralBonusCredited,
    referrer,
    bonusAdded,
  } = params;
  const dedupKey = `verified_payment_${paymentId}_${ticketNumber}`;

  const lines = [
    '💰 VERIFIED PAYMENT & TICKET ISSUED — DiwaliBigdeal',
    '',
    `🎫 Ticket ID: ${ticketNumber}`,
    `✅ Payment Status: PAID (Server-Verified)`,
    `💳 Payment ID: ${paymentId}`,
    chargeId ? `🧾 Charge Ref: ${chargeId}` : null,
    `👤 Customer Name: ${customer.name || 'Customer'}`,
    `🆔 Telegram User ID: ${customer.telegram_user_id}`,
    `📱 Mobile (Masked): ${maskPhoneNumberForAdmin(customer.phone)}`,
    `🔗 Customer Referral Code: ${customer.referral_code} (Referrals: ${customer.referral_count || 0})`,
    customer.referred_by
      ? `🤝 Referred By: ${customer.referred_by}${
          referralBonusCredited && referrer
            ? ` (Credited +${bonusAdded || 0} Stars to ${referrer.telegram_user_id})`
            : ''
        }`
      : null,
    `🕒 Confirmed At: ${new Date().toISOString()}`,
  ].filter(Boolean);

  return sendAdminGroupNotification({
    eventType: 'PAYMENT_VERIFIED',
    dedupKey,
    text: lines.join('\n'),
  });
}

export async function notifyAdminWithdrawalRequested(params: {
  customer: CustomerRecord;
  request: WithdrawalRequest;
}) {
  const { customer, request } = params;
  const dedupKey = `withdrawal_req_${request.id}`;
  const lines = [
    '🏦 NEW WITHDRAWAL REQUEST — DiwaliBigdeal',
    '',
    `🆔 Request ID: ${request.id}`,
    `👤 User ID: ${customer.telegram_user_id} (${customer.name || 'Customer'})`,
    `🔗 Referral Code: ${request.referral_code}`,
    `💰 Requested Amount: ${request.amount} Stars`,
    `📌 Status: ${request.status}`,
    `🕒 Requested At: ${request.created_at}`,
  ];

  return sendAdminGroupNotification({
    eventType: 'WITHDRAWAL_REQUESTED',
    dedupKey,
    text: lines.join('\n'),
  });
}

export async function notifyAdminWithdrawalStatusChanged(params: {
  request: WithdrawalRequest;
}) {
  const { request } = params;
  const dedupKey = `withdrawal_status_${request.id}_${request.status}_${request.updated_at}`;
  const lines = [
    '🔄 WITHDRAWAL STATUS UPDATED — DiwaliBigdeal',
    '',
    `🆔 Request ID: ${request.id}`,
    `👤 User ID: ${request.telegram_user_id}`,
    `🔗 Referral Code: ${request.referral_code}`,
    `💰 Amount: ${request.amount} Stars`,
    `📌 New Status: ${request.status}`,
    request.payout_reference ? `🧾 Payout Ref: ${request.payout_reference}` : null,
    `🕒 Updated At: ${request.updated_at}`,
  ].filter(Boolean);

  return sendAdminGroupNotification({
    eventType: 'WITHDRAWAL_STATUS_CHANGED',
    dedupKey,
    text: lines.join('\n'),
  });
}

function timingSafeCompareStrings(aStr: string, bStr: string): boolean {
  try {
    const a = Buffer.from(aStr);
    const b = Buffer.from(bStr);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyTelegramWebhookSecret(headerToken?: string): boolean {
  const rawSecret = CONFIG.TELEGRAM_WEBHOOK_SECRET;
  const sanitizedSecret = sanitizeSecretToken(rawSecret);

  if (!rawSecret || rawSecret === 'YOUR_TELEGRAM_WEBHOOK_SECRET') {
    return true;
  }
  if (!headerToken) {
    return false;
  }
  const cleanHeader = headerToken.trim();
  if (timingSafeCompareStrings(cleanHeader, rawSecret)) {
    return true;
  }
  if (sanitizedSecret && timingSafeCompareStrings(cleanHeader, sanitizedSecret)) {
    return true;
  }
  return false;
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
  const adminGroupCheck = validateAdminGroupChatId();

  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN') {
    return {
      ok: false,
      telegram_bot_token_configured: false,
      telegram_webhook_secret_configured: secretConfigured,
      telegram_admin_chat_configured: adminGroupCheck.valid,
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
      telegram_admin_chat_configured: adminGroupCheck.valid,
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
      allowed_updates: info.allowed_updates || [
        'message',
        'edited_message',
        'channel_post',
        'edited_channel_post',
        'my_chat_member',
        'callback_query',
        'pre_checkout_query',
      ],
      ip_address: info.ip_address || null,
      telemetry: db.getTelemetry(),
    };
  } catch (err) {
    return {
      ok: false,
      telegram_bot_token_configured: true,
      telegram_webhook_secret_configured: secretConfigured,
      telegram_admin_chat_configured: adminGroupCheck.valid,
      expected_webhook_url: expectedUrl,
      webhook_registered: false,
      url_matches_production: false,
      error: err instanceof Error ? err.message : 'Failed to reach Telegram Bot API',
      telemetry: db.getTelemetry(),
    };
  }
}

const REQUIRED_ALLOWED_UPDATES = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'my_chat_member',
  'callback_query',
  'pre_checkout_query',
];

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

    const currentAllowed = Array.isArray(currentDiag.allowed_updates)
      ? currentDiag.allowed_updates
      : [];
    const missingAllowedUpdates = REQUIRED_ALLOWED_UPDATES.some(
      (u) => !currentAllowed.includes(u)
    );

    const needsRegistration =
      forceSync ||
      !currentDiag.webhook_registered ||
      !currentDiag.url_matches_production ||
      hasSecretMismatchError ||
      missingAllowedUpdates;

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
      allowed_updates: REQUIRED_ALLOWED_UPDATES,
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
          { command: 'start', description: 'DiwaliBigdeal शुरू करें | Main Menu' },
          { command: 'enter', description: 'अभी जुड़ें | Join Entry (₹199)' },
          { command: 'prizes', description: 'इनाम देखें | View Prizes' },
          { command: 'ticket', description: 'मेरा टिकट देखें | View My Ticket' },
          { command: 'refer', description: '🎁 Refer & Earn Dashboard' },
          { command: 'terms', description: 'नियम और शर्तें | Terms & Conditions' },
          { command: 'support', description: 'सहायता | Customer Support' },
          { command: 'test_group', description: 'Admin Group Chat ID Diagnostic' },
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
): Promise<OutgoingBotMessage & { delivered?: boolean }> {
  const cid = String(chatId);
  let delivered = false;

  const outgoingRecord: OutgoingBotMessage & { delivered?: boolean } = {
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
        db.updateTelemetry({
          last_send_message_status: `HTTP_${response.status}`,
          last_send_message_at: new Date().toISOString(),
          last_send_message_error: errBody.slice(0, 200),
        });
        logger.warn('TelegramAPI', `Telegram sendMessage returned HTTP ${response.status}`, {
          status: response.status,
          description: errBody.slice(0, 200),
        });
      } else {
        delivered = true;
        db.updateTelemetry({
          last_send_message_status: 'OK_200',
          last_send_message_at: new Date().toISOString(),
          last_send_message_error: null,
        });
        logger.info('TelegramAPI', 'Delivered outgoing Telegram reply message');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      db.updateTelemetry({
        last_send_message_status: 'NETWORK_ERROR',
        last_send_message_at: new Date().toISOString(),
        last_send_message_error: errMsg,
      });
      logger.error('TelegramAPI', 'Failed to call Telegram Bot API sendMessage', {
        error: errMsg,
      });
    }
  } else {
    delivered = true;
    logger.info('TelegramBot', 'Prepared bot reply message', {
      preview: text.split('\n')[0],
      hasButtons: Boolean(replyMarkup),
    });
  }

  outgoingRecord.delivered = delivered;
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

/**
 * Verifies whether a Telegram user is a group administrator or creator
 * before allowing `/test_group` setup commands inside a group/supergroup.
 */
export async function verifyTelegramGroupAdmin(
  chatId: string | number,
  userId?: string | number | null,
  senderChatId?: string | number | null
): Promise<boolean> {
  const cid = String(chatId);
  const uid = userId !== undefined && userId !== null ? String(userId) : '';
  const scid = senderChatId !== undefined && senderChatId !== null ? String(senderChatId) : '';

  if (!/^-\d+$/.test(cid)) {
    return false;
  }

  // Anonymous Group Admin or Channel Post: Telegram sets sender_chat.id or from.id === 1087968824 (@GroupAnonymousBot)
  if (scid && scid.startsWith('-')) {
    return true;
  }
  if (uid === '1087968824' || uid === cid) {
    return true;
  }

  const token = CONFIG.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN' || cid.startsWith('sim_')) {
    return true;
  }

  if (!uid || !/^\d+$/.test(uid)) {
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/getChatMember`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cid,
        user_id: Number(uid),
      }),
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      logger.warn('AdminGroupDiagnostic', `Telegram getChatMember returned HTTP ${response.status}`, {
        status: response.status,
        description: errBody.slice(0, 200),
      });
      return false;
    }
    const data = (await response.json()) as {
      ok: boolean;
      result?: { status?: string };
    };
    const memberStatus = data?.result?.status;
    return memberStatus === 'creator' || memberStatus === 'administrator';
  } catch (err) {
    logger.warn('AdminGroupDiagnostic', 'Failed to call Telegram getChatMember', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
