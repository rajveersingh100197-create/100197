/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// 1. CONFIGURATION & ENVIRONMENT VARIABLES
// ============================================================================
function getConfig() {
  return {
    APP_URL: process.env.APP_URL || 'https://100197-oqqb.vercel.app',
    CAMPAIGN_NAME: 'DiwaliBigdeal',
    CAMPAIGN_ENTRY_FEE: Number(process.env.CAMPAIGN_ENTRY_FEE) || 199,
    TELEGRAM_STARS_AMOUNT: Number(process.env.TELEGRAM_STARS_AMOUNT) || 199,
    PRIZE_ANNOUNCEMENT_DATE: '8 November 2026',
    PRIZE_ANNOUNCEMENT_TIME: '11:59 PM IST',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET || 'diwali_payment_secret_2026',
    DATABASE_PATH: process.env.DATABASE_PATH || '/tmp/diwalibigdeal/diwalibigdeal_store.json',
  };
}

function getPublicConfigStatus() {
  const cfg = getConfig();
  return {
    campaignName: cfg.CAMPAIGN_NAME,
    entryFee: cfg.CAMPAIGN_ENTRY_FEE,
    starsAmount: cfg.TELEGRAM_STARS_AMOUNT,
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
  };
}

// ============================================================================
// 2. STRUCTURED LOGGER (NO SECRETS EXPOSED)
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
    const fee = getConfig().CAMPAIGN_ENTRY_FEE;

    const demo1 = {
      telegram_user_id: '918820144',
      telegram_chat_id: '918820144',
      name: 'Aarav Sharma',
      phone: '9876543210',
      address: 'Flat 402, Lotus Enclave, Indiranagar, Bengaluru, Karnataka - 560038',
      conversation_state: ConversationState.COMPLETED,
      payment_id: 'pay_DB2026_99102A',
      payment_status: PaymentStatus.PAID,
      payment_amount: fee,
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
      payment_amount: fee,
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
      payment_amount: getConfig().CAMPAIGN_ENTRY_FEE,
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
  payment_amount INTEGER NOT NULL DEFAULT 199,
  ticket_number VARCHAR(32) UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;
  }
}

const db = new DatabaseManager();

// ============================================================================
// 4. TELEGRAM BOT API & TELEGRAM STARS (XTR) SERVICE
// ============================================================================
const MAIN_MENU_INLINE_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🎟️ Join ₹199 Entry', callback_data: 'menu_join_199' }],
    [
      { text: '🎫 My Ticket', callback_data: 'menu_my_ticket' },
      { text: '🏆 Prize Details', callback_data: 'menu_prize_details' },
    ],
    [{ text: '🆘 Support', callback_data: 'menu_support' }],
  ],
};

function verifyTelegramWebhookSecret(headerToken) {
  const secret = getConfig().TELEGRAM_WEBHOOK_SECRET;
  if (!secret || secret === 'YOUR_TELEGRAM_WEBHOOK_SECRET') {
    return true;
  }
  if (!headerToken) return false;
  try {
    const a = Buffer.from(headerToken);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
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
          chat_id: cid,
          response: errBody,
        });
      } else {
        logger.info('TelegramAPI', `Delivered Telegram message to chat_id=${cid}`);
      }
    } catch (err) {
      logger.error('TelegramAPI', 'Failed to call Telegram sendMessage', {
        chat_id: cid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return outgoingRecord;
}

async function createTelegramStarsInvoiceLink(paymentId, starsAmount) {
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
        description: 'Confirm your DiwaliBigdeal ₹199 campaign entry.',
        payload: paymentId,
        provider_token: '', // Empty string for Telegram Stars (XTR)
        currency: 'XTR',
        prices: [{ label: 'DiwaliBigdeal Entry (₹199)', amount: starsAmount }],
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.result) {
        logger.info('TelegramStars', `Created Telegram Stars invoice link for ${paymentId}`, {
          starsAmount,
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

async function sendTelegramStarsInvoice(chatId, paymentId, starsAmount) {
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
        provider_token: '', // Empty string for Telegram Stars (XTR)
        currency: 'XTR',
        prices: [{ label: 'DiwaliBigdeal Entry (₹199)', amount: starsAmount }],
        reply_markup: {
          // Strictly NO Cancel button
          inline_keyboard: [[{ text: '💰 PAY ₹199', pay: true }]],
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
// 5. ATOMIC TICKET GENERATOR & PAYMENT VERIFICATION
// ============================================================================
function issueVerifiedTicket(paymentId, verifiedStatus, verifiedAmount) {
  if (verifiedStatus !== PaymentStatus.PAID) {
    throw new Error('Cannot generate a confirmed ticket for an unpaid or failed payment.');
  }
  if (verifiedAmount < 199) {
    throw new Error(`Invalid payment amount ₹${verifiedAmount}. Expected ₹199.`);
  }

  const customer = db.getCustomerByPaymentId(paymentId);
  if (!customer) {
    throw new Error(`Customer record not found for payment_id: ${paymentId}`);
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
    return {
      customer,
      ticketNumber: customer.ticket_number,
      alreadyIssued: true,
    };
  }

  const newTicketNumber = db.allocateNextTicketNumber();
  const updatedCustomer = db.updateCustomer(customer.telegram_user_id, {
    payment_status: PaymentStatus.PAID,
    payment_amount: verifiedAmount,
    ticket_number: newTicketNumber,
    conversation_state: ConversationState.COMPLETED,
  });

  db.markWebhookProcessed(paymentId, newTicketNumber);
  logger.info('TicketGenerator', `Issued unique ticket ${newTicketNumber}`, {
    telegram_user_id: updatedCustomer.telegram_user_id,
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
  const amountInRupees = cfg.CAMPAIGN_ENTRY_FEE;
  const starsAmount = cfg.TELEGRAM_STARS_AMOUNT;

  let paymentId = customer.payment_id;
  if (!paymentId || customer.payment_status === PaymentStatus.FAILED) {
    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    paymentId = `pay_DB2026_${randomSuffix}`;
  }

  let paymentUrl = `${cfg.APP_URL}/api/payment/checkout/${paymentId}`;
  const starsInvoiceUrl = await createTelegramStarsInvoiceLink(paymentId, starsAmount);
  if (starsInvoiceUrl) {
    paymentUrl = starsInvoiceUrl;
  }

  db.updateCustomer(customer.telegram_user_id, {
    payment_id: paymentId,
    payment_status: PaymentStatus.PENDING,
    payment_amount: amountInRupees,
    conversation_state: ConversationState.WAITING_FOR_PAYMENT,
  });

  return {
    payment_id: paymentId,
    payment_amount: amountInRupees,
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

async function processVerifiedPaymentWebhook({ paymentId, eventStatus, amountInRupees, telegramPaymentChargeId }) {
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

  const issuance = issueVerifiedTicket(paymentId, PaymentStatus.PAID, amountInRupees);

  if (!issuance.alreadyIssued) {
    const successMessage = [
      '🎉 PAYMENT SUCCESSFUL!',
      '',
      'Your DiwaliBigdeal entry has been confirmed.',
      '',
      `🎫 Ticket No: ${issuance.ticketNumber}`,
      '',
      '💰 Amount Paid: ₹199',
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
      telegram_user_id: issuance.customer.telegram_user_id,
      payment_id: paymentId,
      charge_id: telegramPaymentChargeId || 'webhook',
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
// 6. CONVERSATION STATE MACHINE & BOT FLOW
// ============================================================================
function validateIndianMobileNumber(input) {
  const cleaned = String(input || '').replace(/[\s\-()]/g, '');
  const match = cleaned.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  if (!match) {
    return { valid: false, normalized: String(input || '').trim() };
  }
  return { valid: true, normalized: match[1] };
}

const BOT_MESSAGES = {
  mainMenuGreeting: () =>
    [
      '🪔 Welcome to DiwaliBigdeal!',
      '',
      'Entry Fee: ₹199',
      'Win Mahindra Thar ROXX, Double-Door Refrigerator, Smart LED TV & Multiple Cash Prizes!',
      '',
      'Please choose an option below:',
    ].join('\n'),

  joinIntro: () =>
    [
      '🎟️ DIWALI BIGDEAL',
      '',
      'Entry Fee: ₹199',
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
      '🎟️ Entry Fee: ₹199',
      '',
      'Are these details correct?',
    ].join('\n'),

  paymentPrompt: () =>
    [
      '💳 PAYMENT',
      '',
      'Amount: ₹199',
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
      '💰 Entry: ₹199',
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
      '🎟️ Entry Fee: ₹199',
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
      [{ text: '✅ Confirm & Pay ₹199', callback_data: 'action_confirm_pay_199' }],
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
          ? { text: '💰 PAY ₹199', url: paymentOrder.payment_url }
          : { text: '💰 PAY ₹199', callback_data: `pay_link_${paymentOrder.payment_id}` },
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
      inline_keyboard: [[{ text: '🎟️ Join ₹199 Entry', callback_data: 'menu_join_199' }]],
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

async function handleSupportTrigger(customer) {
  await sendTelegramMessage(
    customer.telegram_chat_id,
    BOT_MESSAGES.supportMessage(),
    MAIN_MENU_INLINE_KEYBOARD
  );
}

async function handleTelegramUpdate(update) {
  // 0. Handle Telegram Stars `pre_checkout_query`
  if (update.pre_checkout_query) {
    const pcq = update.pre_checkout_query;
    const paymentId = pcq.invoice_payload;
    const customer = db.getCustomerByPaymentId(paymentId);

    if (!customer) {
      await answerTelegramPreCheckoutQuery(
        pcq.id,
        false,
        'Payment session expired or not found. Please tap Confirm & Pay ₹199 again.'
      );
      return null;
    }

    await answerTelegramPreCheckoutQuery(pcq.id, true);
    return customer;
  }

  // 1. Handle Telegram Stars `message.successful_payment`
  if (update.message && update.message.successful_payment) {
    const msg = update.message;
    const sp = msg.successful_payment;
    const userId = String((msg.from && msg.from.id) || msg.chat.id);
    const chatId = String(msg.chat.id);
    const paymentId = sp.invoice_payload;

    db.getOrCreateCustomer(userId, chatId);

    const result = await processVerifiedPaymentWebhook({
      paymentId,
      eventStatus: 'PAID',
      amountInRupees: getConfig().CAMPAIGN_ENTRY_FEE,
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
      menu_join_199: '🎟️ Join ₹199 Entry',
      action_continue_join: '🚀 Continue',
      action_confirm_pay_199: '✅ Confirm & Pay ₹199',
      action_edit_details: '✏️ Edit Details',
      menu_my_ticket: '🎫 My Ticket',
      menu_prize_details: '🏆 Prize Details',
      menu_support: '🆘 Support',
    };

    const tapDisplay = buttonLabelMap[data] || (data.startsWith('pay_link_') ? '💰 PAY ₹199' : data);
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
      await sendTelegramStarsInvoice(chatId, paymentId, getConfig().TELEGRAM_STARS_AMOUNT);
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

    if (data === 'menu_support') {
      await handleSupportTrigger(customer);
      return customer;
    }

    return customer;
  }

  // 3. Handle Text Messages
  if (update.message && typeof update.message.text === 'string') {
    const msg = update.message;
    const userId = String((msg.from && msg.from.id) || msg.chat.id);
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();

    db.appendChatMessage(chatId, {
      id: crypto.randomUUID(),
      chat_id: chatId,
      text,
      timestamp: new Date().toISOString(),
      direction: 'user',
    });

    let customer = db.getOrCreateCustomer(userId, chatId);

    if (
      text === '/start' ||
      text === '/menu' ||
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

    if (text === '🎟️ Join ₹199 Entry' || text === '/join') {
      await handleJoinEntryTrigger(customer);
      return db.getCustomerByUserId(userId);
    }

    if (text === '🎫 My Ticket' || text === '/ticket') {
      await handleMyTicketTrigger(customer);
      return customer;
    }

    if (text === '🏆 Prize Details' || text === '/prizes') {
      await handlePrizeDetailsTrigger(customer);
      return customer;
    }

    if (text === '🆘 Support' || text === '/support') {
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

module.exports = {
  getConfig,
  getPublicConfigStatus,
  logger,
  db,
  ConversationState,
  PaymentStatus,
  MAIN_MENU_INLINE_KEYBOARD,
  verifyTelegramWebhookSecret,
  sendTelegramMessage,
  createPaymentOrderForCustomer,
  computeWebhookSignature,
  verifyPaymentWebhookSignature,
  processVerifiedPaymentWebhook,
  handleTelegramUpdate,
};
