/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// 1. CONFIGURATION & ENVIRONMENT VARIABLES (100 Telegram Stars ⭐️ / XTR)
// ============================================================================
const PRODUCTION_WEBHOOK_URL = 'https://100197-oqqb.vercel.app/api/telegram/webhook';

function getConfig() {
  const rawAppUrl = (process.env.APP_URL || 'https://100197-oqqb.vercel.app').trim();
  const normalizedAppUrl = rawAppUrl.replace(/\/+$/, '');
  return {
    APP_URL: normalizedAppUrl,
    PRODUCTION_WEBHOOK_URL,
    CAMPAIGN_NAME: 'DiwaliBigdeal',
    CAMPAIGN_ENTRY_FEE: 100,
    TELEGRAM_STARS_AMOUNT: 100,
    DISPLAY_ENTRY_PRICE: '100 Telegram Stars ⭐️',
    PRIZE_ANNOUNCEMENT_DATE: '8 November 2026',
    PRIZE_ANNOUNCEMENT_TIME: '11:59 PM IST',
    TELEGRAM_BOT_TOKEN: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    TELEGRAM_WEBHOOK_SECRET: (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim(),
    PAYMENT_WEBHOOK_SECRET: (process.env.PAYMENT_WEBHOOK_SECRET || 'diwali_payment_secret_2026').trim(),
    DATABASE_PATH: process.env.DATABASE_PATH || '/tmp/diwalibigdeal/diwalibigdeal_store.json',
  };
}

function getPublicConfigStatus() {
  const cfg = getConfig();
  return {
    campaignName: cfg.CAMPAIGN_NAME,
    entryFee: 100,
    starsAmount: 100,
    displayEntryPrice: cfg.DISPLAY_ENTRY_PRICE,
    prizeAnnouncement: `${cfg.PRIZE_ANNOUNCEMENT_DATE} at ${cfg.PRIZE_ANNOUNCEMENT_TIME}`,
    telegramBotTokenConfigured: Boolean(
      cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN'
    ),
    telegramWebhookSecretConfigured: Boolean(
      cfg.TELEGRAM_WEBHOOK_SECRET && cfg.TELEGRAM_WEBHOOK_SECRET !== 'YOUR_TELEGRAM_WEBHOOK_SECRET'
    ),
    paymentProvider: 'telegram_stars',
    paymentCredentialsConfigured: Boolean(
      cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN'
    ),
    paymentWebhookSecretConfigured: Boolean(cfg.PAYMENT_WEBHOOK_SECRET),
    databasePath: cfg.DATABASE_PATH,
    appUrl: cfg.APP_URL,
    expectedWebhookUrl: cfg.PRODUCTION_WEBHOOK_URL,
  };
}

// ============================================================================
// 2. STRUCTURED LOGGER (NO SECRETS OR SENSITIVE CUSTOMER DATA EXPOSED)
// ============================================================================
const MAX_LOGS = 200;
const logs = [];

const logger = {
  log(level, component, message, metadata) {
    const entry = {
      id: crypto.randomUUID(),
      level,
      component,
      message,
      metadata,
      timestamp: new Date().toISOString(),
    };
    logs.unshift(entry);
    if (logs.length > MAX_LOGS) logs.pop();
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
    console.log(`[${entry.timestamp}] [${level}] [${component}] ${message}${metaStr}`);
    return entry;
  },
  info(c, m, meta) { return this.log('INFO', c, m, meta); },
  warn(c, m, meta) { return this.log('WARN', c, m, meta); },
  error(c, m, meta) { return this.log('ERROR', c, m, meta); },
  security(c, m, meta) { return this.log('SECURITY', c, m, meta); },
  webhook(c, m, meta) { return this.log('WEBHOOK', c, m, meta); },
  getRecentLogs(limit = 80) { return logs.slice(0, limit); },
};

// ============================================================================
// 3. DATABASE LAYER (/tmp ON VERCEL SERVERLESS, ./data LOCALLY)
// ============================================================================
const ConversationState = {
  IDLE: 'idle',
  WAITING_FOR_NAME: 'waiting_for_name',
  WAITING_FOR_PHONE: 'waiting_for_phone',
  WAITING_FOR_ADDRESS: 'waiting_for_address',
  WAITING_FOR_CONFIRMATION: 'waiting_for_confirmation',
  WAITING_FOR_PAYMENT: 'waiting_for_payment',
  COMPLETED: 'completed',
};

const PaymentStatus = {
  UNPAID: 'UNPAID',
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
};

const DATA_DIR =
  process.env.VERCEL === '1' || process.env.VERCEL
    ? '/tmp/diwalibigdeal'
    : path.resolve(process.cwd(), 'data');
const JSON_DB_FILE = path.join(DATA_DIR, 'diwalibigdeal_store.json');

class DatabaseManager {
  constructor() {
    this.store = {
      customers: {},
      ticketSequence: 0,
      processedWebhooks: {},
      chatHistories: {},
    };
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(JSON_DB_FILE)) {
        const raw = fs.readFileSync(JSON_DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.store = {
          customers: parsed.customers || {},
          ticketSequence: typeof parsed.ticketSequence === 'number' ? parsed.ticketSequence : 0,
          processedWebhooks: parsed.processedWebhooks || {},
          chatHistories: parsed.chatHistories || {},
        };
      } else {
        this.seedDemoEntries();
        this.persist();
      }
    } catch (err) {
      logger.warn('Database', 'Using in-memory storage fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  seedDemoEntries() {
    const now = new Date(Date.now() - 3600 * 1000 * 5).toISOString();
    const recent = new Date(Date.now() - 1800 * 1000).toISOString();

    const demo1 = {
      telegram_user_id: '918820144',
      telegram_chat_id: '918820144',
      name: 'Aarav Sharma',
      phone: '9876543210',
      address: 'Flat 402, Lotus Enclave, Indiranagar, Bengaluru, Karnataka - 560038',
      conversation_state: ConversationState.COMPLETED,
      payment_id: 'pay_DB2026_99102A',
      payment_status: PaymentStatus.PAID,
      payment_amount: 100,
      ticket_number: 'DB2026-000001',
      created_at: now,
      updated_at: recent,
    };

    const demo2 = {
      telegram_user_id: '917451902',
      telegram_chat_id: '917451902',
      name: 'Priya Nair',
      phone: '9820112233',
      address: 'B-18, Shanti Niketan, Bandra West, Mumbai, Maharashtra - 400050',
      conversation_state: ConversationState.WAITING_FOR_PAYMENT,
      payment_id: 'pay_DB2026_88410B',
      payment_status: PaymentStatus.PENDING,
      payment_amount: 100,
      ticket_number: null,
      created_at: recent,
      updated_at: recent,
    };

    this.store.customers[demo1.telegram_user_id] = demo1;
    this.store.customers[demo2.telegram_user_id] = demo2;
    this.store.ticketSequence = 1;
    this.store.processedWebhooks[demo1.payment_id] = demo1.ticket_number;
  }

  persist() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(JSON_DB_FILE, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (_err) {
      // Safe fallback in ephemeral serverless environment
    }
  }

  getOrCreateCustomer(telegramUserId, telegramChatId) {
    const uid = String(telegramUserId);
    const cid = String(telegramChatId);
    const existing = this.store.customers[uid];
    if (existing) {
      if (existing.telegram_chat_id !== cid) {
        existing.telegram_chat_id = cid;
        existing.updated_at = new Date().toISOString();
        this.persist();
      }
      return { ...existing };
    }

    const now = new Date().toISOString();
    const record = {
      telegram_user_id: uid,
      telegram_chat_id: cid,
      name: null,
      phone: null,
      address: null,
      conversation_state: ConversationState.IDLE,
      payment_id: null,
      payment_status: PaymentStatus.UNPAID,
      payment_amount: 100,
      ticket_number: null,
      created_at: now,
      updated_at: now,
    };

    this.store.customers[uid] = record;
    this.persist();
    return { ...record };
  }

  getCustomerByUserId(telegramUserId) {
    const rec = this.store.customers[String(telegramUserId)];
    return rec ? { ...rec } : null;
  }

  getCustomerByPaymentId(paymentId) {
    for (const key of Object.keys(this.store.customers)) {
      const cust = this.store.customers[key];
      if (cust.payment_id === paymentId) {
        return { ...cust };
      }
    }
    return null;
  }

  getCustomerByTicketNumber(ticketNumber) {
    for (const key of Object.keys(this.store.customers)) {
      const cust = this.store.customers[key];
      if (cust.ticket_number === ticketNumber) {
        return { ...cust };
      }
    }
    return null;
  }

  updateCustomer(telegramUserId, updates) {
    const uid = String(telegramUserId);
    const current = this.store.customers[uid];
    if (!current) {
      throw new Error(`Customer with telegram_user_id=${uid} not found`);
    }
    const updated = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.store.customers[uid] = updated;
    this.persist();
    return { ...updated };
  }

  allocateNextTicketNumber() {
    let candidate = '';
    do {
      this.store.ticketSequence += 1;
      const padded = String(this.store.ticketSequence).padStart(6, '0');
      candidate = `DB2026-${padded}`;
    } while (this.getCustomerByTicketNumber(candidate) !== null);

    this.persist();
    return candidate;
  }

  getProcessedWebhookTicket(paymentId) {
    return this.store.processedWebhooks[paymentId] || null;
  }

  markWebhookProcessed(paymentId, ticketNumber) {
    this.store.processedWebhooks[paymentId] = ticketNumber;
    this.persist();
  }

  listAllCustomers() {
    return Object.values(this.store.customers).sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  appendChatMessage(chatId, msg) {
    const cid = String(chatId);
    if (!this.store.chatHistories[cid]) {
      this.store.chatHistories[cid] = [];
    }
    this.store.chatHistories[cid].push(msg);
    if (this.store.chatHistories[cid].length > 100) {
      this.store.chatHistories[cid].shift();
    }
    this.persist();
  }

  getChatHistory(chatId) {
    return this.store.chatHistories[String(chatId)] || [];
  }

  resetCustomerForTesting(telegramUserId) {
    const uid = String(telegramUserId);
    delete this.store.customers[uid];
    delete this.store.chatHistories[uid];
    this.persist();
  }

  getSQLSchemaDDL() {
    return `-- Production SQL Schema for DiwaliBigdeal Telegram Bot
CREATE TABLE IF NOT EXISTS customers (
  telegram_user_id VARCHAR(64) PRIMARY KEY,
  telegram_chat_id VARCHAR(64) NOT NULL,
  name VARCHAR(255),
  phone VARCHAR(32),
  address TEXT,
  conversation_state VARCHAR(64) NOT NULL DEFAULT 'idle',
  payment_id VARCHAR(128) UNIQUE,
  payment_status VARCHAR(32) NOT NULL DEFAULT 'UNPAID',
  payment_amount INTEGER NOT NULL DEFAULT 100,
  ticket_number VARCHAR(32) UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;
  }
}

const db = new DatabaseManager();

// ============================================================================
// 4. TELEGRAM BOT API & TELEGRAM STARS (100 XTR) SERVICE
// ============================================================================
const MAIN_MENU_INLINE_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🎟️ Join Entry (100 Telegram Stars ⭐️)', callback_data: 'menu_join_199' }],
    [
      { text: '🎫 My Ticket', callback_data: 'menu_my_ticket' },
      { text: '🏆 Prize Details', callback_data: 'menu_prize_details' },
    ],
    [{ text: '🆘 Support', callback_data: 'menu_support' }],
  ],
};

function sanitizeSecretToken(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '');
}

function verifyTelegramWebhookSecret(headerToken) {
  const secret = sanitizeSecretToken(getConfig().TELEGRAM_WEBHOOK_SECRET);
  if (!secret || secret === 'YOUR_TELEGRAM_WEBHOOK_SECRET') {
    return { valid: true, reason: 'no_secret_configured' };
  }
  if (!headerToken) {
    return { valid: false, reason: 'missing_header' };
  }
  try {
    const cleanHeader = String(headerToken).trim();
    const a = Buffer.from(cleanHeader);
    const b = Buffer.from(secret);
    if (a.length !== b.length) {
      return { valid: false, reason: 'length_mismatch' };
    }
    const equal = crypto.timingSafeEqual(a, b);
    return { valid: equal, reason: equal ? 'matched' : 'value_mismatch' };
  } catch {
    return { valid: false, reason: 'comparison_error' };
  }
}

async function getSafeTelegramWebhookDiagnostics() {
  const cfg = getConfig();
  const token = cfg.TELEGRAM_BOT_TOKEN;
  const expectedUrl = cfg.PRODUCTION_WEBHOOK_URL;
  const secretConfigured = Boolean(
    cfg.TELEGRAM_WEBHOOK_SECRET && cfg.TELEGRAM_WEBHOOK_SECRET !== 'YOUR_TELEGRAM_WEBHOOK_SECRET'
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

    const whData = await whResp.json();
    const meData = await meResp.json();

    const info = whData && whData.result ? whData.result : {};
    const botInfo = meData && meData.result ? meData.result : null;
    const currentUrl = String(info.url || '');
    const urlMatches = currentUrl === expectedUrl;

    return {
      ok: Boolean(whData && whData.ok),
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

async function ensureTelegramWebhookRegistered(forceSync = false) {
  const cfg = getConfig();
  const token = cfg.TELEGRAM_BOT_TOKEN;
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

    const cleanSecret = sanitizeSecretToken(cfg.TELEGRAM_WEBHOOK_SECRET);
    const setWebhookPayload = {
      url: cfg.PRODUCTION_WEBHOOK_URL,
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
    const setJson = await setRes.json();

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
      ok: Boolean(setJson && setJson.ok),
      url: cfg.PRODUCTION_WEBHOOK_URL,
      secretTokenAttached: Boolean(setWebhookPayload.secret_token),
    });

    return {
      synced: Boolean(setJson && setJson.ok),
      description: setJson ? setJson.description : undefined,
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

async function sendTelegramMessage(chatId, text, replyMarkup) {
  const cid = String(chatId);
  const token = getConfig().TELEGRAM_BOT_TOKEN;

  const outgoingRecord = {
    id: crypto.randomUUID(),
    chat_id: cid,
    text,
    reply_markup: replyMarkup,
    timestamp: new Date().toISOString(),
    direction: 'bot',
  };

  db.appendChatMessage(cid, outgoingRecord);

  if (token && token !== 'YOUR_TELEGRAM_BOT_TOKEN' && !cid.startsWith('sim_')) {
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const payload = { chat_id: cid, text };
      if (replyMarkup) payload.reply_markup = replyMarkup;

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
      logger.error('TelegramAPI', 'Failed to call Telegram sendMessage', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return outgoingRecord;
}

async function createTelegramStarsInvoiceLink(paymentId) {
  const token = getConfig().TELEGRAM_BOT_TOKEN;
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN') {
    return null;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/createInvoiceLink`;
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
      const data = await response.json();
      if (data.ok && data.result) {
        logger.info('TelegramStars', `Created Telegram Stars invoice link for ${paymentId}`, {
          currency: 'XTR',
          amount: 100,
        });
        return data.result;
      }
    }
  } catch (err) {
    logger.error('TelegramStars', 'Failed to call createInvoiceLink', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

async function sendTelegramStarsInvoice(chatId, paymentId) {
  const cid = String(chatId);
  const token = getConfig().TELEGRAM_BOT_TOKEN;
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN' || cid.startsWith('sim_')) {
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendInvoice`;
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
    return response.ok;
  } catch (err) {
    logger.error('TelegramStars', 'Failed to call sendInvoice', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function answerTelegramPreCheckoutQuery(preCheckoutQueryId, ok, errorMessage) {
  const token = getConfig().TELEGRAM_BOT_TOKEN;
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN' || String(preCheckoutQueryId).startsWith('sim_pcq_')) {
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/answerPreCheckoutQuery`;
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

async function answerTelegramCallbackQuery(callbackQueryId, text) {
  const token = getConfig().TELEGRAM_BOT_TOKEN;
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN' || String(callbackQueryId).startsWith('sim_cb_')) {
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    });
  } catch (_err) {
    // Non-fatal
  }
}

// ============================================================================
// 5. ATOMIC TICKET GENERATOR & PAYMENT VERIFICATION (100 XTR)
// ============================================================================
function issueVerifiedTicket(paymentId, verifiedStatus, verifiedStarsAmount, telegramPaymentChargeId) {
  if (verifiedStatus !== PaymentStatus.PAID) {
    throw new Error('Cannot generate a confirmed ticket for an unpaid or failed payment.');
  }
  if (Number(verifiedStarsAmount) !== 100) {
    throw new Error(`Invalid Telegram Stars amount: ${verifiedStarsAmount}. Expected exactly 100 XTR.`);
  }

  const customer = db.getCustomerByPaymentId(paymentId);
  if (!customer) {
    throw new Error(`Customer record not found for payment_id: ${paymentId}`);
  }

  if (telegramPaymentChargeId) {
    const existingChargeTicket = db.getProcessedWebhookTicket(`charge_${telegramPaymentChargeId}`);
    if (existingChargeTicket && customer.ticket_number) {
      return {
        customer,
        ticketNumber: customer.ticket_number,
        alreadyIssued: true,
      };
    }
  }

  const existingWebhookTicket = db.getProcessedWebhookTicket(paymentId);
  if (existingWebhookTicket && customer.ticket_number) {
    return {
      customer,
      ticketNumber: customer.ticket_number,
      alreadyIssued: true,
    };
  }

  if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
    db.markWebhookProcessed(paymentId, customer.ticket_number);
    if (telegramPaymentChargeId) {
      db.markWebhookProcessed(`charge_${telegramPaymentChargeId}`, customer.ticket_number);
    }
    return {
      customer,
      ticketNumber: customer.ticket_number,
      alreadyIssued: true,
    };
  }

  const newTicketNumber = db.allocateNextTicketNumber();
  const updatedCustomer = db.updateCustomer(customer.telegram_user_id, {
    payment_status: PaymentStatus.PAID,
    payment_amount: 100,
    ticket_number: newTicketNumber,
    conversation_state: ConversationState.COMPLETED,
  });

  db.markWebhookProcessed(paymentId, newTicketNumber);
  if (telegramPaymentChargeId) {
    db.markWebhookProcessed(`charge_${telegramPaymentChargeId}`, newTicketNumber);
  }

  logger.info('TicketGenerator', `Issued unique ticket ${newTicketNumber}`, {
    payment_id: paymentId,
  });

  return {
    customer: updatedCustomer,
    ticketNumber: newTicketNumber,
    alreadyIssued: false,
  };
}

async function createPaymentOrderForCustomer(customer) {
  const cfg = getConfig();
  const starsAmount = 100;

  let paymentId = customer.payment_id;
  if (!paymentId || customer.payment_status === PaymentStatus.FAILED) {
    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    paymentId = `pay_DB2026_${randomSuffix}`;
  }

  let paymentUrl = `${cfg.APP_URL}/api/payment/checkout/${paymentId}`;
  const starsInvoiceUrl = await createTelegramStarsInvoiceLink(paymentId);
  if (starsInvoiceUrl) {
    paymentUrl = starsInvoiceUrl;
  }

  db.updateCustomer(customer.telegram_user_id, {
    payment_id: paymentId,
    payment_status: PaymentStatus.PENDING,
    payment_amount: starsAmount,
    conversation_state: ConversationState.WAITING_FOR_PAYMENT,
  });

  return {
    payment_id: paymentId,
    payment_amount: starsAmount,
    stars_amount: starsAmount,
    payment_url: paymentUrl,
    provider: 'telegram_stars',
    status: PaymentStatus.PENDING,
    created_at: new Date().toISOString(),
  };
}

function computeWebhookSignature(rawBody, secret = getConfig().PAYMENT_WEBHOOK_SECRET) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function verifyPaymentWebhookSignature(rawBody, receivedSignature) {
  if (!receivedSignature) return false;
  try {
    const expectedSignature = computeWebhookSignature(rawBody);
    const a = Buffer.from(receivedSignature, 'utf8');
    const b = Buffer.from(expectedSignature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function processVerifiedPaymentWebhook({
  paymentId,
  eventStatus,
  currency = 'XTR',
  totalAmount = 100,
  telegramPaymentChargeId,
}) {
  const customer = db.getCustomerByPaymentId(paymentId);
  if (!customer) {
    throw new Error(`No customer found for payment_id: ${paymentId}`);
  }

  if (eventStatus === 'FAILED') {
    const updated = db.updateCustomer(customer.telegram_user_id, {
      payment_status: PaymentStatus.FAILED,
    });
    return {
      success: true,
      status: PaymentStatus.FAILED,
      ticket_number: null,
      already_processed: false,
      customer: updated,
    };
  }

  if (currency !== 'XTR') {
    throw new Error(`Invalid payment currency: ${currency}. Expected XTR.`);
  }

  if (Number(totalAmount) !== 100) {
    throw new Error(`Invalid payment amount: ${totalAmount}. Expected exactly 100 Telegram Stars.`);
  }

  const issuance = issueVerifiedTicket(
    paymentId,
    PaymentStatus.PAID,
    100,
    telegramPaymentChargeId
  );

  if (!issuance.alreadyIssued) {
    const successMessage = [
      '🎉 PAYMENT SUCCESSFUL!',
      '',
      'Your DiwaliBigdeal entry has been confirmed.',
      '',
      `🎫 Ticket No: ${issuance.ticketNumber}`,
      '',
      '💰 Amount Paid: 100 Telegram Stars ⭐️',
      '',
      '🏆 Good Luck!',
      '',
      '📅 Prize Announcement:',
      '8 November 2026',
      '11:59 PM IST',
    ].join('\n');

    await sendTelegramMessage(
      issuance.customer.telegram_chat_id,
      successMessage,
      MAIN_MENU_INLINE_KEYBOARD
    );

    logger.info('PaymentVerification', `Sent Telegram confirmation for ticket ${issuance.ticketNumber}`, {
      payment_id: paymentId,
    });
  }

  return {
    success: true,
    status: PaymentStatus.PAID,
    ticket_number: issuance.ticketNumber,
    already_processed: issuance.alreadyIssued,
    customer: issuance.customer,
  };
}

// ============================================================================
// 6. CONVERSATION STATE MACHINE & BOT FLOW (100 Telegram Stars ⭐️)
// ============================================================================
function validateIndianMobileNumber(input) {
  const cleaned = String(input || '').replace(/[\s\-()]/g, '');
  const match = cleaned.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  if (!match) {
    return { valid: false, normalized: String(input || '').trim() };
  }
  return { valid: true, normalized: match[1] };
}

function normalizeBotCommand(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed.startsWith('/')) {
    return trimmed;
  }
  const firstToken = trimmed.split(/\s+/)[0];
  return firstToken.split('@')[0].toLowerCase();
}

const BOT_MESSAGES = {
  mainMenuGreeting: () =>
    [
      '🪔 Welcome to DiwaliBigdeal!',
      '',
      'Entry Fee: 100 Telegram Stars ⭐️',
      'Win Mahindra Thar ROXX, Double-Door Refrigerator, Smart LED TV & Multiple Cash Prizes!',
      '',
      'Please choose an option below:',
    ].join('\n'),

  joinIntro: () =>
    [
      '🎟️ DIWALI BIGDEAL',
      '',
      'Entry Fee: 100 Telegram Stars ⭐️',
      '',
      'Join now for your chance to win exciting prizes.',
    ].join('\n'),

  askFullName: () => '👤 Please enter your Full Name:',

  nameReceivedAskMobile: () =>
    ['✅ Name received.', '', '📱 Please enter your Mobile Number:'].join('\n'),

  invalidMobilePrompt: () =>
    [
      '⚠️ Invalid Mobile Number.',
      '',
      '📱 Please enter a valid 10-digit Mobile Number:',
    ].join('\n'),

  mobileReceivedAskAddress: () =>
    ['✅ Mobile Number received.', '', '🏠 Please enter your Complete Address:'].join('\n'),

  confirmDetails: (name, phone, address) =>
    [
      '📋 PLEASE CONFIRM YOUR DETAILS',
      '',
      `👤 Name: ${name}`,
      `📱 Mobile: ${phone}`,
      `🏠 Address: ${address}`,
      '',
      '🎟️ Entry Fee: 100 Telegram Stars ⭐️',
      '',
      'Are these details correct?',
    ].join('\n'),

  paymentPrompt: () =>
    [
      '💳 PAYMENT',
      '',
      'Amount: 100 Telegram Stars ⭐️',
      '',
      'Please complete your payment to confirm your DiwaliBigdeal entry.',
    ].join('\n'),

  myTicketConfirmed: (ticketNumber, name, phone) =>
    [
      '🎫 MY TICKET',
      '',
      `Ticket No: ${ticketNumber}`,
      '',
      `👤 Name: ${name}`,
      `📱 Mobile: ${phone}`,
      '',
      '💰 Entry: 100 Telegram Stars ⭐️',
      '✅ Status: CONFIRMED',
      '',
      '📅 Prize Announcement:',
      '8 November 2026',
      '11:59 PM IST',
    ].join('\n'),

  myTicketNotFound: () => '❌ No confirmed ticket found.',

  prizeDetails: () =>
    [
      '🏆 DIWALI BIGDEAL',
      '',
      '🎟️ Entry Fee: 100 Telegram Stars ⭐️',
      '',
      '🚙 Mahindra Thar ROXX',
      '📺 Smart LED TV',
      '🧊 Double-Door Refrigerator',
      '💰 Multiple Cash Prizes',
      '',
      '📅 Prize Announcement:',
      '8 November 2026',
      '11:59 PM IST',
    ].join('\n'),

  termsDetails: () =>
    [
      '📜 DIWALI BIGDEAL — TERMS & CONDITIONS',
      '',
      '1. Entry Fee: 100 Telegram Stars ⭐️ (XTR).',
      '2. Ticket Generation: A unique ticket (DB2026-XXXXXX) is issued strictly after verified Telegram Stars payment.',
      '3. Eligibility: Participants must provide accurate Full Name, valid 10-digit Mobile Number, and Complete Address.',
      '4. Prize Draw: Official winner announcement on 8 November 2026 at 11:59 PM IST.',
      '5. Verification: Keep your confirmed ticket number safe for prize claim verification.',
    ].join('\n'),

  supportMessage: () =>
    [
      '🆘 SUPPORT',
      '',
      'For payment or ticket-related issues, please use the support system configured by the administrator.',
    ].join('\n'),
};

async function sendConfirmationScreen(customer) {
  const text = BOT_MESSAGES.confirmDetails(
    customer.name || '',
    customer.phone || '',
    customer.address || ''
  );
  // Strictly NO Cancel button
  await sendTelegramMessage(customer.telegram_chat_id, text, {
    inline_keyboard: [
      [
        {
          text: '✅ Confirm & Pay 100 Telegram Stars ⭐️',
          callback_data: 'action_confirm_pay_199',
        },
      ],
      [{ text: '✏️ Edit Details', callback_data: 'action_edit_details' }],
    ],
  });
}

async function sendPaymentScreen(customer) {
  const paymentOrder = await createPaymentOrderForCustomer(customer);
  const text = BOT_MESSAGES.paymentPrompt();
  const isNativeTelegramStarsLink = paymentOrder.payment_url.startsWith('https://t.me/$');

  // Strictly NO Cancel button
  await sendTelegramMessage(customer.telegram_chat_id, text, {
    inline_keyboard: [
      [
        isNativeTelegramStarsLink
          ? { text: '💰 Pay 100 Telegram Stars ⭐️', url: paymentOrder.payment_url }
          : {
              text: '💰 Pay 100 Telegram Stars ⭐️',
              callback_data: `pay_link_${paymentOrder.payment_id}`,
            },
      ],
    ],
  });
}

async function handleJoinEntryTrigger(customer) {
  if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
    await handleMyTicketTrigger(customer);
    return;
  }
  await sendTelegramMessage(customer.telegram_chat_id, BOT_MESSAGES.joinIntro(), {
    inline_keyboard: [[{ text: '🚀 Continue', callback_data: 'action_continue_join' }]],
  });
}

async function handleMyTicketTrigger(customer) {
  if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
    await sendTelegramMessage(
      customer.telegram_chat_id,
      BOT_MESSAGES.myTicketConfirmed(
        customer.ticket_number,
        customer.name || 'Customer',
        customer.phone || ''
      ),
      MAIN_MENU_INLINE_KEYBOARD
    );
  } else {
    await sendTelegramMessage(customer.telegram_chat_id, BOT_MESSAGES.myTicketNotFound(), {
      inline_keyboard: [
        [{ text: '🎟️ Join Entry (100 Telegram Stars ⭐️)', callback_data: 'menu_join_199' }],
      ],
    });
  }
}

async function handlePrizeDetailsTrigger(customer) {
  await sendTelegramMessage(
    customer.telegram_chat_id,
    BOT_MESSAGES.prizeDetails(),
    MAIN_MENU_INLINE_KEYBOARD
  );
}

async function handleTermsTrigger(customer) {
  await sendTelegramMessage(
    customer.telegram_chat_id,
    BOT_MESSAGES.termsDetails(),
    MAIN_MENU_INLINE_KEYBOARD
  );
}

async function handleSupportTrigger(customer) {
  await sendTelegramMessage(
    customer.telegram_chat_id,
    BOT_MESSAGES.supportMessage(),
    MAIN_MENU_INLINE_KEYBOARD
  );
}

async function handleTelegramUpdate(update) {
  // 0. Handle Telegram Stars `pre_checkout_query` (Validate currency === "XTR" and total_amount === 100)
  if (update.pre_checkout_query) {
    const pcq = update.pre_checkout_query;
    const paymentId = pcq.invoice_payload;

    if (pcq.currency !== 'XTR' || Number(pcq.total_amount) !== 100) {
      logger.security(
        'TelegramStars',
        `Rejected pre_checkout_query: invalid currency (${pcq.currency}) or amount (${pcq.total_amount})`,
        { paymentId, currency: pcq.currency, total_amount: pcq.total_amount }
      );
      await answerTelegramPreCheckoutQuery(
        pcq.id,
        false,
        'Invalid payment currency or amount. Entry requires exactly 100 Telegram Stars (XTR).'
      );
      return null;
    }

    const customer = db.getCustomerByPaymentId(paymentId);
    if (!customer) {
      await answerTelegramPreCheckoutQuery(
        pcq.id,
        false,
        'Payment session expired or not found. Please tap Confirm & Pay 100 Telegram Stars ⭐️ again.'
      );
      return null;
    }

    if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
      await answerTelegramPreCheckoutQuery(
        pcq.id,
        false,
        `You already have a confirmed entry (Ticket: ${customer.ticket_number}).`
      );
      return customer;
    }

    await answerTelegramPreCheckoutQuery(pcq.id, true);
    return customer;
  }

  // 1. Handle Telegram Stars `message.successful_payment` (Validate currency === "XTR" and total_amount === 100)
  if (update.message && update.message.successful_payment) {
    const msg = update.message;
    const sp = msg.successful_payment;
    const userId = String((msg.from && msg.from.id) || msg.chat.id);
    const chatId = String(msg.chat.id);
    const paymentId = sp.invoice_payload;

    db.getOrCreateCustomer(userId, chatId);

    if (sp.currency !== 'XTR' || Number(sp.total_amount) !== 100) {
      logger.security(
        'TelegramStars',
        'Rejected successful_payment due to currency/amount mismatch',
        {
          payment_id: paymentId,
          currency: sp.currency,
          total_amount: sp.total_amount,
        }
      );
      return db.getCustomerByUserId(userId);
    }

    const result = await processVerifiedPaymentWebhook({
      paymentId,
      eventStatus: 'PAID',
      currency: sp.currency,
      totalAmount: sp.total_amount,
      telegramPaymentChargeId: sp.telegram_payment_charge_id,
    });

    return result.customer;
  }

  // 2. Handle Inline Keyboard Callback Queries
  if (update.callback_query) {
    const cb = update.callback_query;
    const userId = String(cb.from.id);
    const chatId = String((cb.message && cb.message.chat && cb.message.chat.id) || cb.from.id);
    const data = String(cb.data || '').trim();

    const buttonLabelMap = {
      menu_join_199: '🎟️ Join Entry (100 Telegram Stars ⭐️)',
      action_continue_join: '🚀 Continue',
      action_confirm_pay_199: '✅ Confirm & Pay 100 Telegram Stars ⭐️',
      action_edit_details: '✏️ Edit Details',
      menu_my_ticket: '🎫 My Ticket',
      menu_prize_details: '🏆 Prize Details',
      menu_terms: '📜 Terms & Conditions',
      menu_support: '🆘 Support',
    };

    const tapDisplay =
      buttonLabelMap[data] ||
      (data.startsWith('pay_link_') ? '💰 Pay 100 Telegram Stars ⭐️' : data);

    db.appendChatMessage(chatId, {
      id: crypto.randomUUID(),
      chat_id: chatId,
      text: tapDisplay,
      timestamp: new Date().toISOString(),
      direction: 'user',
    });

    await answerTelegramCallbackQuery(cb.id);

    let customer = db.getOrCreateCustomer(userId, chatId);

    if (data === 'menu_join_199') {
      await handleJoinEntryTrigger(customer);
      return db.getCustomerByUserId(userId);
    }

    if (data === 'action_continue_join' || data === 'action_edit_details') {
      customer = db.updateCustomer(userId, {
        conversation_state: ConversationState.WAITING_FOR_NAME,
      });
      await sendTelegramMessage(chatId, BOT_MESSAGES.askFullName());
      return customer;
    }

    if (data === 'action_confirm_pay_199') {
      if (!customer.name || !customer.phone || !customer.address) {
        customer = db.updateCustomer(userId, {
          conversation_state: ConversationState.WAITING_FOR_NAME,
        });
        await sendTelegramMessage(chatId, BOT_MESSAGES.askFullName());
        return customer;
      }
      await sendPaymentScreen(customer);
      return db.getCustomerByUserId(userId);
    }

    if (data.startsWith('pay_link_')) {
      const paymentId = data.replace('pay_link_', '');
      await sendTelegramStarsInvoice(chatId, paymentId);
      return db.getCustomerByUserId(userId);
    }

    if (data === 'menu_my_ticket') {
      await handleMyTicketTrigger(customer);
      return customer;
    }

    if (data === 'menu_prize_details') {
      await handlePrizeDetailsTrigger(customer);
      return customer;
    }

    if (data === 'menu_terms') {
      await handleTermsTrigger(customer);
      return customer;
    }

    if (data === 'menu_support') {
      await handleSupportTrigger(customer);
      return customer;
    }

    return customer;
  }

  // 3. Handle Standard Text Messages & All Bot Commands (/start, /prizes, /ticket, /terms, /enter, /support)
  const incomingMsg = update.message || update.edited_message;
  if (incomingMsg && typeof incomingMsg.text === 'string') {
    const userId = String((incomingMsg.from && incomingMsg.from.id) || incomingMsg.chat.id);
    const chatId = String(incomingMsg.chat.id);
    const text = incomingMsg.text.trim();
    const command = normalizeBotCommand(text);

    db.appendChatMessage(chatId, {
      id: crypto.randomUUID(),
      chat_id: chatId,
      text,
      timestamp: new Date().toISOString(),
      direction: 'user',
    });

    let customer = db.getOrCreateCustomer(userId, chatId);

    if (
      command === '/start' ||
      command === '/menu' ||
      command === '/help' ||
      text.toLowerCase() === 'menu' ||
      text.toLowerCase() === 'hi' ||
      text.toLowerCase() === 'hello'
    ) {
      await sendTelegramMessage(
        chatId,
        BOT_MESSAGES.mainMenuGreeting(),
        MAIN_MENU_INLINE_KEYBOARD
      );
      return customer;
    }

    if (
      command === '/enter' ||
      command === '/join' ||
      text === '🎟️ Join Entry (100 Telegram Stars ⭐️)' ||
      text === '🎟️ Join ₹199 Entry'
    ) {
      await handleJoinEntryTrigger(customer);
      return db.getCustomerByUserId(userId);
    }

    if (command === '/ticket' || command === '/myticket' || text === '🎫 My Ticket') {
      await handleMyTicketTrigger(customer);
      return customer;
    }

    if (command === '/prizes' || command === '/prize' || text === '🏆 Prize Details') {
      await handlePrizeDetailsTrigger(customer);
      return customer;
    }

    if (command === '/terms' || command === '/rules' || text === '📜 Terms & Conditions') {
      await handleTermsTrigger(customer);
      return customer;
    }

    if (command === '/support' || text === '🆘 Support') {
      await handleSupportTrigger(customer);
      return customer;
    }

    switch (customer.conversation_state) {
      case ConversationState.WAITING_FOR_NAME: {
        if (text.length < 2) {
          await sendTelegramMessage(chatId, BOT_MESSAGES.askFullName());
          return customer;
        }
        customer = db.updateCustomer(userId, {
          name: text,
          conversation_state: ConversationState.WAITING_FOR_PHONE,
        });
        await sendTelegramMessage(chatId, BOT_MESSAGES.nameReceivedAskMobile());
        return customer;
      }

      case ConversationState.WAITING_FOR_PHONE: {
        const validation = validateIndianMobileNumber(text);
        if (!validation.valid) {
          await sendTelegramMessage(chatId, BOT_MESSAGES.invalidMobilePrompt());
          return customer;
        }
        customer = db.updateCustomer(userId, {
          phone: validation.normalized,
          conversation_state: ConversationState.WAITING_FOR_ADDRESS,
        });
        await sendTelegramMessage(chatId, BOT_MESSAGES.mobileReceivedAskAddress());
        return customer;
      }

      case ConversationState.WAITING_FOR_ADDRESS: {
        if (text.length < 5) {
          await sendTelegramMessage(chatId, '🏠 Please enter your Complete Address:');
          return customer;
        }
        customer = db.updateCustomer(userId, {
          address: text,
          conversation_state: ConversationState.WAITING_FOR_CONFIRMATION,
        });
        await sendConfirmationScreen(customer);
        return customer;
      }

      case ConversationState.WAITING_FOR_CONFIRMATION: {
        await sendConfirmationScreen(customer);
        return customer;
      }

      case ConversationState.WAITING_FOR_PAYMENT: {
        await sendPaymentScreen(customer);
        return db.getCustomerByUserId(userId);
      }

      case ConversationState.COMPLETED:
      case ConversationState.IDLE:
      default: {
        await sendTelegramMessage(
          chatId,
          BOT_MESSAGES.mainMenuGreeting(),
          MAIN_MENU_INLINE_KEYBOARD
        );
        return customer;
      }
    }
  }

  return null;
}

// ============================================================================
// 7. HTTP REQUEST / RESPONSE HELPERS
// ============================================================================
function readRawAndJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      const raw = JSON.stringify(req.body);
      return resolve({ rawBody: raw, body: req.body });
    }
    if (typeof req.body === 'string' && req.body.length > 0) {
      try {
        return resolve({ rawBody: req.body, body: JSON.parse(req.body) });
      } catch (e) {
        return reject(e);
      }
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!raw) return resolve({ rawBody: '{}', body: {} });
      try {
        resolve({ rawBody: raw, body: JSON.parse(raw) });
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

// ============================================================================
// 8. UNIFIED SELF-CONTAINED VERCEL SERVERLESS HANDLER (`/api/index.js`)
// ============================================================================
module.exports = async function handler(req, res) {
  try {
    const rawUrl = req.url || '/';
    const urlPath = rawUrl.split('?')[0];

    // 1. Health Endpoint (`GET /api/health`)
    if (urlPath === '/api/health' || urlPath === '/health') {
      const cfg = getPublicConfigStatus();
      return sendJson(res, 200, {
        ok: true,
        status: 'HEALTHY',
        endpoint: '/api/health',
        service: 'DiwaliBigdeal Telegram Bot Backend',
        runtime: process.env.VERCEL ? 'vercel-serverless' : 'node',
        payment_mode: 'telegram_stars (XTR)',
        currency: 'XTR',
        stars_amount: 100,
        display_entry_price: '100 Telegram Stars ⭐️',
        telegram_bot_token_configured: cfg.telegramBotTokenConfigured,
        timestamp: new Date().toISOString(),
      });
    }

    // 1b. Safe Diagnostic Webhook Status Endpoint (`GET` / `POST /api/telegram/status`)
    if (urlPath === '/api/telegram/status') {
      const forceSync =
        req.method === 'POST' ||
        rawUrl.includes('sync=1') ||
        rawUrl.includes('register=1') ||
        rawUrl.includes('setup=1');
      const syncResult = await ensureTelegramWebhookRegistered(forceSync);
      const diagnostics =
        syncResult && syncResult.diagnostics
          ? syncResult.diagnostics
          : await getSafeTelegramWebhookDiagnostics();
      return sendJson(res, 200, {
        ok: true,
        service: 'DiwaliBigdeal Telegram Webhook Diagnostics',
        endpoint: '/api/telegram/status',
        payment_mode: 'telegram_stars (XTR)',
        currency: 'XTR',
        stars_amount: 100,
        supported_commands: ['/start', '/enter', '/ticket', '/prizes', '/terms', '/support'],
        webhook_auto_synced: Boolean(syncResult && syncResult.synced),
        webhook_registration: diagnostics,
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Telegram Webhook Endpoint (`GET` & `POST /api/telegram/webhook` or `/api/index`)
    if (urlPath === '/api/telegram/webhook' || urlPath === '/api/index' || urlPath === '/api') {
      if (req.method === 'GET') {
        const forceSync =
          rawUrl.includes('sync=1') || rawUrl.includes('register=1') || rawUrl.includes('setup=1');
        const syncResult = await ensureTelegramWebhookRegistered(forceSync);
        const webhookDiagnostics =
          syncResult && syncResult.diagnostics
            ? syncResult.diagnostics
            : await getSafeTelegramWebhookDiagnostics();
        const status = getPublicConfigStatus();

        return sendJson(res, 200, {
          ok: true,
          service: 'DiwaliBigdeal Telegram Bot Webhook',
          endpoint: '/api/telegram/webhook',
          status: 'READY',
          supported_methods: ['POST', 'GET'],
          supported_commands: ['/start', '/enter', '/ticket', '/prizes', '/terms', '/support'],
          supported_updates: ['message', 'callback_query', 'pre_checkout_query'],
          payment_mode: 'telegram_stars (XTR)',
          currency: 'XTR',
          stars_amount: 100,
          display_entry_price: '100 Telegram Stars ⭐️',
          invoice_prices: [{ label: 'DiwaliBigdeal Entry', amount: 100 }],
          telegram_bot_token_configured: status.telegramBotTokenConfigured,
          telegram_webhook_secret_configured: status.telegramWebhookSecretConfigured,
          webhook_registration: webhookDiagnostics,
          webhook_auto_synced: Boolean(syncResult && syncResult.synced),
          instructions:
            'Send POST requests with Telegram Bot API Update JSON payloads to this endpoint. Append ?sync=1 to force re-registering the Telegram webhook with the configured secret token.',
          timestamp: new Date().toISOString(),
        });
      }

      if (req.method !== 'POST') {
        return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      }

      const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
      const isInternalSimulator = req.headers['x-simulator-internal'] === 'true';

      if (
        !isInternalSimulator &&
        process.env.TELEGRAM_WEBHOOK_SECRET &&
        process.env.TELEGRAM_WEBHOOK_SECRET !== 'YOUR_TELEGRAM_WEBHOOK_SECRET'
      ) {
        const check = verifyTelegramWebhookSecret(secretHeader);
        if (!check.valid) {
          logger.security(
            'TelegramWebhook',
            'Rejected unauthorized Telegram webhook request (secret token mismatch)',
            { reason: check.reason }
          );
          ensureTelegramWebhookRegistered(true).catch(() => {});
          return sendJson(res, 401, {
            ok: false,
            error: 'Unauthorized Telegram webhook secret token',
          });
        }
      }

      const { body: update } = await readRawAndJsonBody(req);
      if (!update || typeof update.update_id !== 'number') {
        logger.warn('TelegramWebhook', 'Rejected malformed Telegram update payload');
        return sendJson(res, 400, {
          ok: false,
          error: 'Invalid Telegram Update payload (missing numeric update_id)',
        });
      }

      logger.webhook('TelegramWebhook', `Received Telegram update_id=${update.update_id}`, {
        hasMessage: Boolean(update.message || update.edited_message),
        hasCallbackQuery: Boolean(update.callback_query),
        hasPreCheckoutQuery: Boolean(update.pre_checkout_query),
        hasSuccessfulPayment: Boolean(update.message && update.message.successful_payment),
      });

      const customer = await handleTelegramUpdate(update);
      const msgObj = update.message || update.edited_message;
      const chatId = String(
        (msgObj && msgObj.chat && msgObj.chat.id) ||
          (update.callback_query &&
            update.callback_query.message &&
            update.callback_query.message.chat &&
            update.callback_query.message.chat.id) ||
          (update.callback_query && update.callback_query.from && update.callback_query.from.id) ||
          (update.pre_checkout_query &&
            update.pre_checkout_query.from &&
            update.pre_checkout_query.from.id) ||
          ''
      );

      return sendJson(res, 200, {
        ok: true,
        customer,
        chatHistory: chatId ? db.getChatHistory(chatId) : [],
      });
    }

    // 3. Payment Webhook Endpoint (`GET` & `POST /api/payment/webhook`)
    if (urlPath === '/api/payment/webhook') {
      if (req.method === 'GET') {
        return sendJson(res, 200, {
          ok: true,
          service: 'DiwaliBigdeal Payment Verification Endpoint',
          endpoint: '/api/payment/webhook',
          status: 'READY',
          payment_provider: 'telegram_stars',
          currency: 'XTR',
          stars_amount: 100,
          display_entry_price: '100 Telegram Stars ⭐️',
          note: 'Telegram Stars payments are verified natively via pre_checkout_query and successful_payment updates on /api/telegram/webhook (validating currency=XTR and total_amount=100).',
          timestamp: new Date().toISOString(),
        });
      }

      if (req.method !== 'POST') {
        return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      }

      const { rawBody, body } = await readRawAndJsonBody(req);
      const signature = req.headers['x-payment-webhook-signature'];

      if (!verifyPaymentWebhookSignature(rawBody, signature)) {
        logger.security(
          'PaymentWebhook',
          'Rejected payment webhook due to invalid HMAC-SHA256 signature'
        );
        return sendJson(res, 401, {
          ok: false,
          error: 'Invalid webhook cryptographic signature (HMAC-SHA256 verification failed)',
        });
      }

      const paymentId = String(body.payment_id || body.invoice_payload || '');
      const eventStatus = body.status === 'FAILED' ? 'FAILED' : 'PAID';
      const currency = String(body.currency || 'XTR');
      const totalAmount = Number(body.total_amount ?? body.amount ?? 100);

      if (!paymentId) {
        return sendJson(res, 400, { ok: false, error: 'Missing payment_id in webhook payload' });
      }

      const result = await processVerifiedPaymentWebhook({
        paymentId,
        eventStatus,
        currency,
        totalAmount,
        telegramPaymentChargeId: body.telegram_payment_charge_id,
      });

      return sendJson(res, 200, {
        ok: true,
        ...result,
      });
    }

    // 4. Admin Overview (`GET /api/admin/overview`)
    if (req.method === 'GET' && urlPath === '/api/admin/overview') {
      const customers = db.listAllCustomers();
      const recentLogs = logger.getRecentLogs(80);
      const configStatus = getPublicConfigStatus();

      const stats = {
        totalCustomers: customers.length,
        confirmedTickets: customers.filter((c) => c.payment_status === 'PAID' && c.ticket_number).length,
        pendingPayments: customers.filter((c) => c.payment_status === 'PENDING').length,
        totalStarsCollected:
          customers.filter((c) => c.payment_status === 'PAID' && c.ticket_number).length * 100,
      };

      return sendJson(res, 200, {
        ok: true,
        config: configStatus,
        stats,
        customers,
        logs: recentLogs,
        sqlSchema: db.getSQLSchemaDDL(),
      });
    }

    // 5. Admin Chat Transcript (`GET /api/admin/chat/:chatId`)
    if (req.method === 'GET' && urlPath.startsWith('/api/admin/chat/')) {
      const chatId = decodeURIComponent(urlPath.replace('/api/admin/chat/', ''));
      const customer = db.getCustomerByUserId(chatId);
      const history = db.getChatHistory(chatId);
      return sendJson(res, 200, {
        ok: true,
        customer,
        chatHistory: history,
      });
    }

    // 6. Payment Order Creation (`POST /api/payment/create`)
    if (req.method === 'POST' && urlPath === '/api/payment/create') {
      const { body } = await readRawAndJsonBody(req);
      if (!body.telegram_user_id) {
        return sendJson(res, 400, { ok: false, error: 'telegram_user_id is required' });
      }
      const customer = db.getCustomerByUserId(String(body.telegram_user_id));
      if (!customer) {
        return sendJson(res, 404, { ok: false, error: 'Customer not found' });
      }
      const paymentResult = await createPaymentOrderForCustomer(customer);
      return sendJson(res, 200, {
        ok: true,
        payment: paymentResult,
        customer: db.getCustomerByUserId(String(body.telegram_user_id)),
      });
    }

    // 7. Admin Trigger Payment Webhook (`POST /api/admin/trigger-payment-webhook`)
    if (req.method === 'POST' && urlPath === '/api/admin/trigger-payment-webhook') {
      const { body } = await readRawAndJsonBody(req);
      const payment_id = body.payment_id;
      const status = body.status || 'PAID';
      const amount = Number(body.amount ?? 100);
      const currency = String(body.currency || 'XTR');
      const tamper_signature = Boolean(body.tamper_signature);

      if (!payment_id) {
        return sendJson(res, 400, { ok: false, error: 'payment_id is required' });
      }

      const webhookPayload = {
        event: status === 'PAID' ? 'telegram_stars.successful_payment' : 'telegram_stars.failed',
        payment_id,
        status,
        amount,
        currency,
        timestamp: new Date().toISOString(),
      };

      const rawBody = JSON.stringify(webhookPayload);
      const validSignature = computeWebhookSignature(rawBody);
      const signatureToUse = tamper_signature
        ? '000000000000000000000000000000000000000000000000000000000000dead'
        : validSignature;

      if (!verifyPaymentWebhookSignature(rawBody, signatureToUse)) {
        return sendJson(res, 401, {
          ok: false,
          error: 'Webhook rejected: Invalid HMAC-SHA256 signature',
          signatureUsed: signatureToUse,
        });
      }

      const result = await processVerifiedPaymentWebhook({
        paymentId: payment_id,
        eventStatus: status,
        currency,
        totalAmount: amount,
      });

      return sendJson(res, 200, {
        ok: true,
        signatureVerified: true,
        signatureUsed: signatureToUse,
        ...result,
      });
    }

    // 8. Admin Reset Customer (`POST /api/admin/reset-customer`)
    if (req.method === 'POST' && urlPath === '/api/admin/reset-customer') {
      const { body } = await readRawAndJsonBody(req);
      if (!body.telegram_user_id) {
        return sendJson(res, 400, { ok: false, error: 'telegram_user_id required' });
      }
      const uid = String(body.telegram_user_id);
      db.resetCustomerForTesting(uid);
      const customer = db.getOrCreateCustomer(uid, uid);
      await sendTelegramMessage(
        uid,
        [
          '🪔 Welcome to DiwaliBigdeal!',
          '',
          'Entry Fee: 100 Telegram Stars ⭐️',
          'Win Mahindra Thar ROXX, Double-Door Refrigerator, Smart LED TV & Multiple Cash Prizes!',
          '',
          'Please choose an option below:',
        ].join('\n'),
        MAIN_MENU_INLINE_KEYBOARD
      );
      return sendJson(res, 200, {
        ok: true,
        customer,
        chatHistory: db.getChatHistory(uid),
      });
    }

    return sendJson(res, 404, {
      ok: false,
      error: `Endpoint ${urlPath} not found`,
    });
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal Server Error',
    });
  }
};
