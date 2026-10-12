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
    TELEGRAM_ADMIN_CHAT_ID: (process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim(),
    TELEGRAM_BOT_USERNAME: (process.env.TELEGRAM_BOT_USERNAME || 'DiwaliDhamaka2026Bot')
      .trim()
      .replace(/^@/, ''),
    REFERRAL_PROGRAM_ENABLED:
      String(process.env.REFERRAL_PROGRAM_ENABLED || 'false').toLowerCase() === 'true',
    REFERRAL_WITHDRAWALS_ENABLED:
      String(process.env.REFERRAL_WITHDRAWALS_ENABLED || 'false').toLowerCase() === 'true',
    REFERRAL_BONUS_PER_VERIFIED_PAYMENT: 100,
    REFERRAL_MIN_WITHDRAWAL_AMOUNT: 1000,
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
    telegramAdminChatConfigured: Boolean(
      cfg.TELEGRAM_ADMIN_CHAT_ID &&
        cfg.TELEGRAM_ADMIN_CHAT_ID !== 'YOUR_PRIVATE_ADMIN_GROUP_CHAT_ID' &&
        /^-\d+$/.test(cfg.TELEGRAM_ADMIN_CHAT_ID)
    ),
    botUsername: cfg.TELEGRAM_BOT_USERNAME,
    referralProgramEnabled: cfg.REFERRAL_PROGRAM_ENABLED,
    referralWithdrawalsEnabled: cfg.REFERRAL_WITHDRAWALS_ENABLED,
    referralBonusAmount: cfg.REFERRAL_BONUS_PER_VERIFIED_PAYMENT,
    referralMinWithdrawal: cfg.REFERRAL_MIN_WITHDRAWAL_AMOUNT,
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
// 2. STRUCTURED LOGGER + PERSISTENT TELEMETRY (NO SECRETS OR PII EXPOSED)
// ============================================================================
const MAX_LOGS = 200;
const logs = [];

const DATA_DIR =
  process.env.VERCEL === '1' || process.env.VERCEL
    ? '/tmp/diwalibigdeal'
    : path.resolve(process.cwd(), 'data');
const JSON_DB_FILE = path.join(DATA_DIR, 'diwalibigdeal_store.json');

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

function generateReferralCode(telegramUserId) {
  return crypto
    .createHash('sha256')
    .update(`diwalibigdeal_ref_${telegramUserId}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
}

function normalizeReferralCode(raw) {
  return String(raw || '')
    .trim()
    .replace(/^(ref_|ref-)/i, '')
    .toUpperCase();
}

function formatReferralLink(referralCode) {
  const code = normalizeReferralCode(referralCode);
  return `https://t.me/${getConfig().TELEGRAM_BOT_USERNAME}?start=ref_${code}`;
}

function maskCustomerIdentifier(customer) {
  if (customer && customer.name && customer.name.trim().length >= 2) {
    const parts = customer.name.trim().split(/\s+/);
    const first = parts[0];
    const maskedFirst =
      first.length <= 2
        ? `${first[0]}*`
        : `${first.slice(0, 2)}${'*'.repeat(Math.min(4, first.length - 2))}`;
    const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : '';
    return `${maskedFirst}${lastInitial} (ID: ***${String(customer.telegram_user_id).slice(-4)})`;
  }
  if (customer && customer.username) {
    const clean = String(customer.username).replace(/^@/, '');
    const prefix = clean.slice(0, 2);
    return `@${prefix}*** (ID: ***${String(customer.telegram_user_id).slice(-4)})`;
  }
  return `User ***${String((customer && customer.telegram_user_id) || '0000').slice(-4)}`;
}

class DatabaseManager {
  constructor() {
    this.store = {
      customers: {},
      ticketSequence: 0,
      processedWebhooks: {},
      processedAdminNotifications: {},
      processedReferrals: {},
      processedReferralBonuses: {},
      withdrawalRequests: {},
      adminNotifications: [],
      chatHistories: {},
      systemLogs: [],
      webhookTelemetry: {
        last_update_received_at: null,
        last_update_id: null,
        last_update_type: null,
        last_send_message_status: null,
        last_send_message_at: null,
        last_send_message_error: null,
        last_auth_failure_at: null,
        last_auth_failure_reason: null,
        total_updates_received: 0,
      },
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
          processedAdminNotifications: parsed.processedAdminNotifications || {},
          processedReferrals: parsed.processedReferrals || {},
          processedReferralBonuses: parsed.processedReferralBonuses || {},
          withdrawalRequests: parsed.withdrawalRequests || {},
          adminNotifications: Array.isArray(parsed.adminNotifications)
            ? parsed.adminNotifications
            : [],
          chatHistories: parsed.chatHistories || {},
          systemLogs: Array.isArray(parsed.systemLogs) ? parsed.systemLogs : [],
          webhookTelemetry: parsed.webhookTelemetry || {
            last_update_received_at: null,
            last_update_id: null,
            last_update_type: null,
            last_send_message_status: null,
            last_send_message_at: null,
            last_send_message_error: null,
            last_auth_failure_at: null,
            last_auth_failure_reason: null,
            total_updates_received: 0,
          },
        };
        for (const uid of Object.keys(this.store.customers)) {
          const c = this.store.customers[uid];
          c.referral_code = normalizeReferralCode(c.referral_code) || generateReferralCode(uid);
          c.referred_by = c.referred_by ? normalizeReferralCode(c.referred_by) : null;
          if (typeof c.referral_count !== 'number') c.referral_count = 0;
          if (typeof c.verified_referral_count !== 'number') c.verified_referral_count = 0;
          if (typeof c.verified_referral_bonus !== 'number') c.verified_referral_bonus = 0;
        }
      } else {
        this.seedDemoEntries();
        this.persist();
      }
    } catch (_err) {
      // Safe fallback in ephemeral serverless environment
    }
  }

  reloadFromDisk() {
    try {
      if (fs.existsSync(JSON_DB_FILE)) {
        const raw = fs.readFileSync(JSON_DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.store.customers = parsed.customers || this.store.customers;
        this.store.ticketSequence =
          typeof parsed.ticketSequence === 'number'
            ? parsed.ticketSequence
            : this.store.ticketSequence;
        this.store.processedWebhooks = parsed.processedWebhooks || this.store.processedWebhooks;
        this.store.processedAdminNotifications =
          parsed.processedAdminNotifications || this.store.processedAdminNotifications || {};
        this.store.processedReferrals =
          parsed.processedReferrals || this.store.processedReferrals || {};
        this.store.processedReferralBonuses =
          parsed.processedReferralBonuses || this.store.processedReferralBonuses || {};
        this.store.withdrawalRequests =
          parsed.withdrawalRequests || this.store.withdrawalRequests || {};
        this.store.adminNotifications = Array.isArray(parsed.adminNotifications)
          ? parsed.adminNotifications
          : this.store.adminNotifications || [];
        this.store.chatHistories = parsed.chatHistories || this.store.chatHistories;
        this.store.systemLogs = Array.isArray(parsed.systemLogs)
          ? parsed.systemLogs
          : this.store.systemLogs;
        this.store.webhookTelemetry = parsed.webhookTelemetry || this.store.webhookTelemetry;
        for (const uid of Object.keys(this.store.customers)) {
          const c = this.store.customers[uid];
          c.referral_code = normalizeReferralCode(c.referral_code) || generateReferralCode(uid);
          c.referred_by = c.referred_by ? normalizeReferralCode(c.referred_by) : null;
          if (typeof c.referral_count !== 'number') c.referral_count = 0;
          if (typeof c.verified_referral_count !== 'number') c.verified_referral_count = 0;
          if (typeof c.verified_referral_bonus !== 'number') c.verified_referral_bonus = 0;
        }
      }
    } catch (_err) {
      // Ignore read errors
    }
  }

  seedDemoEntries() {
    const now = new Date(Date.now() - 3600 * 1000 * 5).toISOString();
    const recent = new Date(Date.now() - 1800 * 1000).toISOString();

    const demo1Code = generateReferralCode('918820144');
    const demo2Code = generateReferralCode('917451902');

    const demo1 = {
      telegram_user_id: '918820144',
      telegram_chat_id: '918820144',
      username: 'aarav_sharma',
      name: 'Aarav Sharma',
      phone: '9876543210',
      address: 'Flat 402, Lotus Enclave, Indiranagar, Bengaluru, Karnataka - 560038',
      conversation_state: ConversationState.COMPLETED,
      payment_id: 'pay_DB2026_99102A',
      payment_status: PaymentStatus.PAID,
      payment_amount: 100,
      ticket_number: 'DB2026-000001',
      referral_code: demo1Code,
      referred_by: null,
      referred_by_user_id: null,
      referred_at: null,
      referral_count: 1,
      verified_referral_count: 0,
      verified_referral_bonus: 0,
      created_at: now,
      updated_at: recent,
    };

    const demo2 = {
      telegram_user_id: '917451902',
      telegram_chat_id: '917451902',
      username: 'priya_nair',
      name: 'Priya Nair',
      phone: '9820112233',
      address: 'B-18, Shanti Niketan, Bandra West, Mumbai, Maharashtra - 400050',
      conversation_state: ConversationState.WAITING_FOR_PAYMENT,
      payment_id: 'pay_DB2026_88410B',
      payment_status: PaymentStatus.PENDING,
      payment_amount: 100,
      ticket_number: null,
      referral_code: demo2Code,
      referred_by: demo1Code,
      referred_by_user_id: demo1.telegram_user_id,
      referred_at: recent,
      referral_count: 0,
      verified_referral_count: 0,
      verified_referral_bonus: 0,
      created_at: recent,
      updated_at: recent,
    };

    this.store.customers[demo1.telegram_user_id] = demo1;
    this.store.customers[demo2.telegram_user_id] = demo2;
    this.store.ticketSequence = 1;
    this.store.processedWebhooks[demo1.payment_id] = demo1.ticket_number;
    this.store.processedReferrals[demo2.telegram_user_id] = demo1.referral_code;
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

  appendSystemLog(entry) {
    this.reloadFromDisk();
    if (!Array.isArray(this.store.systemLogs)) {
      this.store.systemLogs = [];
    }
    this.store.systemLogs.unshift(entry);
    if (this.store.systemLogs.length > 100) {
      this.store.systemLogs = this.store.systemLogs.slice(0, 100);
    }
    this.persist();
  }

  getRecentSystemLogs(limit = 80) {
    this.reloadFromDisk();
    return (this.store.systemLogs || []).slice(0, limit);
  }

  updateTelemetry(patch) {
    this.reloadFromDisk();
    this.store.webhookTelemetry = {
      ...(this.store.webhookTelemetry || {}),
      ...patch,
    };
    this.persist();
  }

  getTelemetry() {
    this.reloadFromDisk();
    return this.store.webhookTelemetry || {};
  }

  getOrCreateCustomer(telegramUserId, telegramChatId, username) {
    this.reloadFromDisk();
    const uid = String(telegramUserId);
    const cid = String(telegramChatId);
    const existing = this.store.customers[uid];
    if (existing) {
      let changed = false;
      if (existing.telegram_chat_id !== cid) {
        existing.telegram_chat_id = cid;
        changed = true;
      }
      if (username && existing.username !== username) {
        existing.username = username;
        changed = true;
      }
      const canonicalCode = normalizeReferralCode(existing.referral_code) || generateReferralCode(uid);
      if (existing.referral_code !== canonicalCode) {
        existing.referral_code = canonicalCode;
        changed = true;
      }
      if (changed) {
        existing.updated_at = new Date().toISOString();
        this.persist();
      }
      return { ...existing };
    }

    const now = new Date().toISOString();
    const record = {
      telegram_user_id: uid,
      telegram_chat_id: cid,
      username: username || null,
      name: null,
      phone: null,
      address: null,
      conversation_state: ConversationState.IDLE,
      payment_id: null,
      payment_status: PaymentStatus.UNPAID,
      payment_amount: 100,
      ticket_number: null,
      referral_code: generateReferralCode(uid),
      referred_by: null,
      referred_by_user_id: null,
      referred_at: null,
      referral_count: 0,
      verified_referral_count: 0,
      verified_referral_bonus: 0,
      created_at: now,
      updated_at: now,
    };

    this.store.customers[uid] = record;
    this.persist();
    return { ...record };
  }

  getCustomerByUserId(telegramUserId) {
    this.reloadFromDisk();
    const rec = this.store.customers[String(telegramUserId)];
    return rec ? { ...rec } : null;
  }

  getCustomerByReferralCode(referralCode) {
    this.reloadFromDisk();
    const clean = normalizeReferralCode(referralCode);
    if (!clean) return null;
    for (const key of Object.keys(this.store.customers)) {
      const cust = this.store.customers[key];
      if (cust.referral_code && normalizeReferralCode(cust.referral_code) === clean) {
        return { ...cust };
      }
    }
    return null;
  }

  applyReferralCodeOnce(referredUserId, rawReferralCode) {
    this.reloadFromDisk();
    const uid = String(referredUserId);
    const code = normalizeReferralCode(rawReferralCode);
    if (!code) {
      return { applied: false, referrer: null, reason: 'empty_code' };
    }

    if (!this.store.processedReferrals) {
      this.store.processedReferrals = {};
    }
    if (this.store.processedReferrals[uid]) {
      return { applied: false, referrer: null, reason: 'already_referred' };
    }

    const referredCustomer = this.store.customers[uid];
    if (!referredCustomer) {
      return { applied: false, referrer: null, reason: 'user_not_found' };
    }

    if (referredCustomer.referred_by) {
      return { applied: false, referrer: null, reason: 'already_has_referrer' };
    }

    const referrer = this.getCustomerByReferralCode(code);
    if (!referrer) {
      return { applied: false, referrer: null, reason: 'invalid_referral_code' };
    }

    if (referrer.telegram_user_id === uid) {
      return { applied: false, referrer: null, reason: 'self_referral_not_allowed' };
    }

    const now = new Date().toISOString();
    const targetCustomer = this.store.customers[uid];
    targetCustomer.referred_by = referrer.referral_code;
    targetCustomer.referred_by_user_id = referrer.telegram_user_id;
    targetCustomer.referred_at = now;
    targetCustomer.updated_at = now;

    const referrerRecord = this.store.customers[referrer.telegram_user_id];
    referrerRecord.referral_count = (referrerRecord.referral_count || 0) + 1;
    referrerRecord.updated_at = now;

    this.store.processedReferrals[uid] = referrer.referral_code;
    this.persist();

    return { applied: true, referrer: { ...referrerRecord } };
  }

  creditVerifiedReferralOnPayment(referredUserId, paymentId) {
    this.reloadFromDisk();
    const uid = String(referredUserId);
    const pid = String(paymentId || '').trim();
    if (!pid) {
      return { credited: false, referrer: null, bonusAdded: 0 };
    }
    if (!this.store.processedReferralBonuses) {
      this.store.processedReferralBonuses = {};
    }
    if (this.store.processedReferralBonuses[pid]) {
      const existingRefId = this.store.processedReferralBonuses[pid];
      return {
        credited: false,
        referrer: this.getCustomerByUserId(existingRefId),
        bonusAdded: 0,
      };
    }

    const referredCustomer = this.store.customers[uid];
    if (!referredCustomer || !referredCustomer.referred_by) {
      return { credited: false, referrer: null, bonusAdded: 0 };
    }

    const referrer = this.getCustomerByReferralCode(referredCustomer.referred_by);
    if (!referrer || referrer.telegram_user_id === uid) {
      return { credited: false, referrer: null, bonusAdded: 0 };
    }

    const referrerRecord = this.store.customers[referrer.telegram_user_id];
    if (!referrerRecord) {
      return { credited: false, referrer: null, bonusAdded: 0 };
    }

    const cfg = getConfig();
    const bonusPerVerified = cfg.REFERRAL_PROGRAM_ENABLED
      ? cfg.REFERRAL_BONUS_PER_VERIFIED_PAYMENT
      : 0;

    referrerRecord.verified_referral_count = (referrerRecord.verified_referral_count || 0) + 1;
    referrerRecord.verified_referral_bonus =
      (referrerRecord.verified_referral_bonus || 0) + bonusPerVerified;
    referrerRecord.updated_at = new Date().toISOString();

    this.store.processedReferralBonuses[pid] = referrerRecord.telegram_user_id;
    this.persist();

    return {
      credited: true,
      referrer: { ...referrerRecord },
      bonusAdded: bonusPerVerified,
    };
  }

  getCustomerReferralDashboard(telegramUserId) {
    this.reloadFromDisk();
    const cfg = getConfig();
    const uid = String(telegramUserId);
    const customer = this.store.customers[uid];
    const referralCode = customer
      ? normalizeReferralCode(customer.referral_code) || generateReferralCode(uid)
      : generateReferralCode(uid);
    const referralLink = formatReferralLink(referralCode);

    const referredCustomers = Object.values(this.store.customers)
      .filter(
        (c) =>
          c.telegram_user_id !== uid &&
          c.referred_by &&
          normalizeReferralCode(c.referred_by) === referralCode
      )
      .sort(
        (a, b) =>
          new Date(b.referred_at || b.created_at).getTime() -
          new Date(a.referred_at || a.created_at).getTime()
      );

    const totalReferredUsers = referredCustomers.length;
    const registeredReferredUsers = referredCustomers.filter((c) =>
      Boolean(c.name && c.phone && c.address)
    ).length;
    const verifiedReferredPayments = referredCustomers.filter(
      (c) => c.payment_status === PaymentStatus.PAID && Boolean(c.ticket_number)
    ).length;
    const pendingReferredPayments = referredCustomers.filter(
      (c) => c.payment_status !== PaymentStatus.PAID || !c.ticket_number
    ).length;

    const bonusPerVerified = cfg.REFERRAL_PROGRAM_ENABLED
      ? cfg.REFERRAL_BONUS_PER_VERIFIED_PAYMENT
      : 0;
    const totalVerifiedBonus = verifiedReferredPayments * bonusPerVerified;

    if (this.store.customers[uid]) {
      this.store.customers[uid].referral_count = totalReferredUsers;
      this.store.customers[uid].verified_referral_count = verifiedReferredPayments;
      this.store.customers[uid].verified_referral_bonus = totalVerifiedBonus;
    }

    const userWithdrawals = Object.values(this.store.withdrawalRequests || {})
      .filter((w) => w.telegram_user_id === uid)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const lockedOrPaidWithdrawalAmount = userWithdrawals
      .filter((w) => w.status !== 'REJECTED')
      .reduce((sum, w) => sum + Number(w.amount || 0), 0);

    const availableWithdrawalBalance = Math.max(
      0,
      totalVerifiedBonus - lockedOrPaidWithdrawalAmount
    );

    const hasActivePendingWithdrawal = userWithdrawals.some(
      (w) => w.status === 'PENDING_APPROVAL' || w.status === 'APPROVED_PENDING_PAYOUT'
    );

    const canRequestWithdrawal =
      cfg.REFERRAL_PROGRAM_ENABLED &&
      cfg.REFERRAL_WITHDRAWALS_ENABLED &&
      availableWithdrawalBalance >= cfg.REFERRAL_MIN_WITHDRAWAL_AMOUNT &&
      !hasActivePendingWithdrawal;

    const paidWithdrawalsTotal = userWithdrawals
      .filter((w) => w.status === 'PAID')
      .reduce((sum, w) => sum + Number(w.amount || 0), 0);

    let remainingPaidPool = paidWithdrawalsTotal;

    const history = referredCustomers.map((rc) => {
      const regDone = Boolean(rc.name && rc.phone && rc.address);
      const isVerifiedPaid =
        rc.payment_status === PaymentStatus.PAID && Boolean(rc.ticket_number);
      const paymentStatusLabel = isVerifiedPaid
        ? 'Verified'
        : rc.payment_status === PaymentStatus.FAILED
        ? 'Failed'
        : 'Pending';

      let bonusStatusLabel = 'Pending';
      if (isVerifiedPaid && cfg.REFERRAL_PROGRAM_ENABLED) {
        if (remainingPaidPool >= bonusPerVerified && bonusPerVerified > 0) {
          bonusStatusLabel = 'Paid';
          remainingPaidPool -= bonusPerVerified;
        } else {
          bonusStatusLabel = 'Eligible';
        }
      }

      return {
        masked_identifier: maskCustomerIdentifier(rc),
        referred_at: rc.referred_at || rc.created_at,
        registration_completed: regDone,
        payment_status_label: paymentStatusLabel,
        bonus_status_label: bonusStatusLabel,
        bonus_amount: isVerifiedPaid ? bonusPerVerified : 0,
      };
    });

    return {
      referral_code: referralCode,
      referral_link: referralLink,
      referred_by: (customer && customer.referred_by) || null,
      referral_program_enabled: cfg.REFERRAL_PROGRAM_ENABLED,
      withdrawals_enabled: cfg.REFERRAL_WITHDRAWALS_ENABLED,
      total_referred_users: totalReferredUsers,
      registered_referred_users: registeredReferredUsers,
      verified_referred_payments: verifiedReferredPayments,
      pending_referred_payments: pendingReferredPayments,
      total_verified_bonus: totalVerifiedBonus,
      locked_or_paid_withdrawal_amount: lockedOrPaidWithdrawalAmount,
      available_withdrawal_balance: availableWithdrawalBalance,
      can_request_withdrawal: canRequestWithdrawal,
      min_withdrawal_amount: cfg.REFERRAL_MIN_WITHDRAWAL_AMOUNT,
      withdrawal_requests: userWithdrawals,
      history,
    };
  }

  createWithdrawalRequest(telegramUserId) {
    this.reloadFromDisk();
    const cfg = getConfig();
    const uid = String(telegramUserId);
    if (!cfg.REFERRAL_PROGRAM_ENABLED || !cfg.REFERRAL_WITHDRAWALS_ENABLED) {
      return {
        ok: false,
        reason: 'Referral withdrawals are currently disabled by campaign configuration.',
      };
    }

    const dashboard = this.getCustomerReferralDashboard(uid);
    const activePending = dashboard.withdrawal_requests.find(
      (w) => w.status === 'PENDING_APPROVAL' || w.status === 'APPROVED_PENDING_PAYOUT'
    );
    if (activePending) {
      return {
        ok: false,
        request: activePending,
        reason: `You already have an active withdrawal request (${activePending.id}) in status ${activePending.status}.`,
      };
    }

    if (dashboard.available_withdrawal_balance < cfg.REFERRAL_MIN_WITHDRAWAL_AMOUNT) {
      return {
        ok: false,
        reason: `Minimum eligible balance of ${cfg.REFERRAL_MIN_WITHDRAWAL_AMOUNT} Stars is required to request withdrawal (Available: ${dashboard.available_withdrawal_balance} Stars).`,
      };
    }

    const now = new Date().toISOString();
    const reqId = `WD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const withdrawal = {
      id: reqId,
      telegram_user_id: uid,
      referral_code: dashboard.referral_code,
      amount: dashboard.available_withdrawal_balance,
      status: 'PENDING_APPROVAL',
      payout_reference: null,
      created_at: now,
      updated_at: now,
    };

    if (!this.store.withdrawalRequests) {
      this.store.withdrawalRequests = {};
    }
    this.store.withdrawalRequests[reqId] = withdrawal;
    this.persist();

    return { ok: true, request: { ...withdrawal } };
  }

  hasAdminNotificationBeenSent(dedupKey) {
    this.reloadFromDisk();
    return Boolean(
      this.store.processedAdminNotifications && this.store.processedAdminNotifications[dedupKey]
    );
  }

  markAdminNotificationSent(entry) {
    this.reloadFromDisk();
    if (!this.store.processedAdminNotifications) {
      this.store.processedAdminNotifications = {};
    }
    if (!Array.isArray(this.store.adminNotifications)) {
      this.store.adminNotifications = [];
    }
    this.store.processedAdminNotifications[entry.dedup_key] = entry.created_at;
    this.store.adminNotifications.unshift(entry);
    if (this.store.adminNotifications.length > 100) {
      this.store.adminNotifications = this.store.adminNotifications.slice(0, 100);
    }
    this.persist();
  }

  getRecentAdminNotifications(limit = 50) {
    this.reloadFromDisk();
    return (this.store.adminNotifications || []).slice(0, limit);
  }

  getCustomerByPaymentId(paymentId) {
    this.reloadFromDisk();
    for (const key of Object.keys(this.store.customers)) {
      const cust = this.store.customers[key];
      if (cust.payment_id === paymentId) {
        return { ...cust };
      }
    }
    return null;
  }

  getCustomerByTicketNumber(ticketNumber) {
    this.reloadFromDisk();
    for (const key of Object.keys(this.store.customers)) {
      const cust = this.store.customers[key];
      if (cust.ticket_number === ticketNumber) {
        return { ...cust };
      }
    }
    return null;
  }

  updateCustomer(telegramUserId, updates) {
    this.reloadFromDisk();
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
    this.reloadFromDisk();
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
    this.reloadFromDisk();
    return this.store.processedWebhooks[paymentId] || null;
  }

  markWebhookProcessed(paymentId, ticketNumber) {
    this.reloadFromDisk();
    this.store.processedWebhooks[paymentId] = ticketNumber;
    this.persist();
  }

  listAllCustomers() {
    this.reloadFromDisk();
    return Object.values(this.store.customers).sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  appendChatMessage(chatId, msg) {
    this.reloadFromDisk();
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
    this.reloadFromDisk();
    return this.store.chatHistories[String(chatId)] || [];
  }

  resetCustomerForTesting(telegramUserId) {
    this.reloadFromDisk();
    const uid = String(telegramUserId);
    delete this.store.customers[uid];
    delete this.store.chatHistories[uid];
    if (this.store.processedReferrals) {
      delete this.store.processedReferrals[uid];
    }
    if (this.store.withdrawalRequests) {
      for (const wid of Object.keys(this.store.withdrawalRequests)) {
        if (this.store.withdrawalRequests[wid].telegram_user_id === uid) {
          delete this.store.withdrawalRequests[wid];
        }
      }
    }
    if (this.store.processedAdminNotifications) {
      for (const k of Object.keys(this.store.processedAdminNotifications)) {
        if (k.includes(uid)) {
          delete this.store.processedAdminNotifications[k];
        }
      }
    }
    this.persist();
  }
}

const db = new DatabaseManager();

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
    db.appendSystemLog(entry);
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
    console.log(`[${entry.timestamp}] [${level}] [${component}] ${message}${metaStr}`);
    return entry;
  },
  info(c, m, meta) { return this.log('INFO', c, m, meta); },
  warn(c, m, meta) { return this.log('WARN', c, m, meta); },
  error(c, m, meta) { return this.log('ERROR', c, m, meta); },
  security(c, m, meta) { return this.log('SECURITY', c, m, meta); },
  webhook(c, m, meta) { return this.log('WEBHOOK', c, m, meta); },
  getRecentLogs(limit = 80) { return db.getRecentSystemLogs(limit); },
};

// ============================================================================
// 4. TELEGRAM BOT API, ADMIN GROUP NOTIFICATIONS & TELEGRAM STARS (100 XTR)
// ============================================================================
const MAIN_MENU_INLINE_KEYBOARD = {
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

function sanitizeSecretToken(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '');
}

function validateAdminGroupChatId(rawChatId = getConfig().TELEGRAM_ADMIN_CHAT_ID) {
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

function maskPhoneNumberForAdmin(phone) {
  const clean = String(phone || '').replace(/\D/g, '');
  if (clean.length < 4) return 'Not provided';
  const last4 = clean.slice(-4);
  return `+91-XXXXXX${last4}`;
}

function summarizeAddressForAdmin(address) {
  const clean = String(address || '').trim();
  if (!clean) return 'Not provided';
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

async function sendAdminGroupNotification({ eventType, dedupKey, text, allowDuplicate = false }) {
  if (!allowDuplicate && db.hasAdminNotificationBeenSent(dedupKey)) {
    return {
      ok: true,
      skipped_duplicate: true,
      delivered_to_telegram: false,
      status: 'SKIPPED_DUPLICATE',
    };
  }

  const adminChatValidation = validateAdminGroupChatId();
  const token = getConfig().TELEGRAM_BOT_TOKEN;
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
        status = `TELEGRAM_HTTP_${response.status}`;
      }
    } catch (_err) {
      status = 'NETWORK_ERROR';
    }
  }

  const entry = {
    id: crypto.randomUUID(),
    dedup_key: dedupKey,
    event_type: eventType,
    text,
    delivered_to_telegram: delivered,
    telegram_status: status,
    created_at: new Date().toISOString(),
  };

  db.markAdminNotificationSent(entry);
  return {
    ok: delivered || !adminChatValidation.valid,
    delivered_to_telegram: delivered,
    status,
    entry,
  };
}

async function notifyAdminNewBotStart({ customer, username, referralApplied, referrer }) {
  const dedupKey = `bot_start_${customer.telegram_user_id}`;
  const handle = username ? `@${String(username).replace(/^@/, '')}` : 'No username';
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

async function notifyAdminRegistrationSubmitted(customer) {
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

async function notifyAdminVerifiedPayment({
  customer,
  ticketNumber,
  paymentId,
  chargeId,
  referralBonusCredited,
  referrer,
  bonusAdded,
}) {
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

async function notifyAdminWithdrawalRequested({ customer, request }) {
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

function timingSafeCompareStrings(aStr, bStr) {
  try {
    const a = Buffer.from(String(aStr));
    const b = Buffer.from(String(bStr));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyTelegramWebhookSecret(headerToken) {
  const rawSecret = getConfig().TELEGRAM_WEBHOOK_SECRET;
  const sanitizedSecret = sanitizeSecretToken(rawSecret);

  if (!rawSecret || rawSecret === 'YOUR_TELEGRAM_WEBHOOK_SECRET') {
    return { valid: true, reason: 'no_secret_configured' };
  }
  if (!headerToken) {
    return { valid: false, reason: 'missing_header' };
  }

  const cleanHeader = String(headerToken).trim();
  if (timingSafeCompareStrings(cleanHeader, rawSecret)) {
    return { valid: true, reason: 'matched_raw' };
  }
  if (sanitizedSecret && timingSafeCompareStrings(cleanHeader, sanitizedSecret)) {
    return { valid: true, reason: 'matched_sanitized' };
  }
  return { valid: false, reason: 'value_mismatch' };
}

async function getSafeTelegramWebhookDiagnostics() {
  const cfg = getConfig();
  const token = cfg.TELEGRAM_BOT_TOKEN;
  const expectedUrl = cfg.PRODUCTION_WEBHOOK_URL;
  const secretConfigured = Boolean(
    cfg.TELEGRAM_WEBHOOK_SECRET && cfg.TELEGRAM_WEBHOOK_SECRET !== 'YOUR_TELEGRAM_WEBHOOK_SECRET'
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
      telemetry: db.getTelemetry(),
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
      allowed_updates: info.allowed_updates || ['message', 'callback_query', 'pre_checkout_query'],
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
    const hasDeliveryError =
      currentDiag.last_error_message &&
      (currentDiag.last_error_message.includes('401') ||
        currentDiag.last_error_message.includes('404') ||
        currentDiag.last_error_message.includes('500') ||
        currentDiag.last_error_message.includes('Wrong response'));

    const needsRegistration =
      forceSync ||
      !currentDiag.webhook_registered ||
      !currentDiag.url_matches_production ||
      hasDeliveryError;

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
          { command: 'start', description: 'DiwaliBigdeal शुरू करें | Main Menu' },
          { command: 'enter', description: 'अभी जुड़ें | Join Entry (₹199)' },
          { command: 'prizes', description: 'इनाम देखें | View Prizes' },
          { command: 'ticket', description: 'मेरा टिकट देखें | View My Ticket' },
          { command: 'refer', description: '🎁 Refer & Earn Dashboard' },
          { command: 'terms', description: 'नियम और शर्तें | Terms & Conditions' },
          { command: 'support', description: 'सहायता | Customer Support' },
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
      logger.error('TelegramAPI', 'Failed to call Telegram sendMessage', {
        error: errMsg,
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

  const referralCredit = db.creditVerifiedReferralOnPayment(
    issuance.customer.telegram_user_id,
    paymentId
  );

  if (!issuance.alreadyIssued) {
    const successMessage = [
      '🎉 बधाई हो! आपका Payment सफल रहा!',
      '✅ आपकी DiwaliBigdeal Entry सफलतापूर्वक Confirm हो गई है।',
      '',
      `🎫 Ticket Number: ${issuance.ticketNumber}`,
      '🎟️ Entry Fee: ₹199',
      '✅ Status: CONFIRMED',
      '',
      '🏆 पहला इनाम: Mahindra Thar ROXX',
      '🥈 दूसरा इनाम: Double-Door Refrigerator',
      '🥉 तीसरा इनाम: Smart LED TV',
      '💰 इसके अलावा जीतें Multiple Cash Prizes!',
      '',
      '📅 Winner Announcement: 8 November 2026',
      '⏰ Time: रात 11:59 बजे (IST)',
      '',
      '🙏 शुभकामनाएँ! कृपया अपना Ticket Number सुरक्षित रखें।',
    ].join('\n');

    await sendTelegramMessage(
      issuance.customer.telegram_chat_id,
      successMessage,
      MAIN_MENU_INLINE_KEYBOARD
    );

    await notifyAdminVerifiedPayment({
      customer: issuance.customer,
      ticketNumber: issuance.ticketNumber,
      paymentId,
      chargeId: telegramPaymentChargeId,
      referralBonusCredited: referralCredit.credited,
      referrer: referralCredit.referrer,
      bonusAdded: referralCredit.bonusAdded,
    });

    logger.info('PaymentVerification', `Sent Telegram confirmation for ticket ${issuance.ticketNumber}`, {
      payment_id: paymentId,
      referral_credited: referralCredit.credited,
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
function extractReferralCodeFromText(rawText) {
  const trimmed = String(rawText || '').trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const cmd = parts[0].split('@')[0].toLowerCase();
    if (cmd === '/start' || cmd === '/join' || cmd === '/enter') {
      const arg = parts[1].trim();
      if (/^(ref_|ref-)?[A-Z0-9]{4,12}$/i.test(arg)) {
        return normalizeReferralCode(arg);
      }
    }
  }
  if (/^(ref_|ref-)[A-Z0-9]{4,12}$/i.test(trimmed)) {
    return normalizeReferralCode(trimmed);
  }
  return null;
}

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
      '🪔 स्वागत है DiwaliBigdeal में!',
      '',
      '🎉 इस दिवाली DiwaliBigdeal से जुड़ें और शानदार इनाम जीतने का मौका पाएँ!',
      '',
      '🏆 पहला इनाम: Mahindra Thar ROXX',
      '🥈 दूसरा इनाम: Double-Door Refrigerator',
      '🥉 तीसरा इनाम: Smart LED TV',
      '💰 इसके अलावा जीतें Multiple Cash Prizes!',
      '',
      '🎟️ Entry Fee: ₹199',
      '📅 Winner Announcement: 8 November 2026',
      '⏰ Time: रात 11:59 बजे (IST)',
      '',
      '👇 आगे बढ़ने के लिए नीचे दिए गए विकल्प चुनें:',
    ].join('\n'),

  joinIntro: () =>
    [
      '🎟️ DIWALI BIGDEAL — CAMPAIGN ENTRY',
      '',
      '🎉 इस दिवाली DiwaliBigdeal से जुड़ें और शानदार इनाम जीतने का मौका पाएँ!',
      '',
      '🏆 पहला इनाम: Mahindra Thar ROXX',
      '🥈 दूसरा इनाम: Double-Door Refrigerator',
      '🥉 तीसरा इनाम: Smart LED TV',
      '💰 इसके अलावा जीतें Multiple Cash Prizes!',
      '',
      '🎟️ Entry Fee: ₹199',
      '📅 Winner Announcement: 8 November 2026',
      '⏰ Time: रात 11:59 बजे (IST)',
      '',
      '👇 अपनी Entry दर्ज करने के लिए नीचे क्लिक करें:',
    ].join('\n'),

  askFullName: () => '👤 कृपया अपना पूरा नाम (Full Name) दर्ज करें:',

  nameReceivedAskMobile: () =>
    [
      '✅ आपका नाम दर्ज कर लिया गया है।',
      '',
      '📱 कृपया अपना 10 अंकों का Mobile Number दर्ज करें:',
    ].join('\n'),

  invalidMobilePrompt: () =>
    [
      '⚠️ यह Mobile Number मान्य नहीं है।',
      '',
      '📱 कृपया अपना सही 10 अंकों का Indian Mobile Number दर्ज करें:',
    ].join('\n'),

  mobileReceivedAskAddress: () =>
    [
      '✅ आपका Mobile Number दर्ज कर लिया गया है।',
      '',
      '🏠 कृपया अपना पूरा पता (Complete Address) दर्ज करें:',
    ].join('\n'),

  confirmDetails: (name, phone, address) =>
    [
      '📋 कृपया अपनी जानकारी की पुष्टि करें (Confirm Details)',
      '',
      `👤 नाम (Name): ${name}`,
      `📱 मोबाइल (Mobile): ${phone}`,
      `🏠 पता (Address): ${address}`,
      '',
      '🎟️ Entry Fee: ₹199',
      '',
      'क्या आपकी यह जानकारी बिल्कुल सही है?',
    ].join('\n'),

  paymentPrompt: () =>
    [
      '💳 अब Payment करें',
      '',
      '🎟️ Entry Fee: ₹199',
      '',
      'अपनी DiwaliBigdeal Entry पक्की (Confirm) करने के लिए कृपया नीचे दिए गए बटन से Payment पूरा करें।',
      '✅ Payment सफल होते ही आपका Unique Ticket Number तुरंत जारी कर दिया जाएगा।',
    ].join('\n'),

  myTicketConfirmed: (ticketNumber, name, phone, referralCode, referralCount) =>
    [
      '🎫 मेरा टिकट | MY CONFIRMED TICKET',
      '',
      `🎟️ Ticket No: ${ticketNumber}`,
      '',
      `👤 नाम (Name): ${name}`,
      `📱 मोबाइल (Mobile): ${phone}`,
      referralCode ? `🔗 Referral Code: ${referralCode} (Referrals: ${referralCount ?? 0})` : null,
      '',
      '🎟️ Entry Fee: ₹199',
      '✅ Status: CONFIRMED (पक्का)',
      '',
      '📅 Winner Announcement: 8 November 2026',
      '⏰ Time: रात 11:59 बजे (IST)',
    ]
      .filter((line) => line !== null)
      .join('\n'),

  myTicketNotFound: () =>
    [
      '❌ अभी तक आपका कोई Confirmed Ticket नहीं मिला है।',
      '',
      '🎉 इस दिवाली DiwaliBigdeal से जुड़ें और शानदार इनाम जीतने का मौका पाएँ!',
      '🎟️ Entry Fee: ₹199',
      '',
      '👇 अपनी Entry पक्की करने के लिए नीचे बटन दबाएँ:',
    ].join('\n'),

  prizeDetails: () =>
    [
      '🎁 DIWALI BIGDEAL — इनामों की जानकारी (Prize Details)',
      '',
      '🏆 पहला इनाम: Mahindra Thar ROXX',
      '🥈 दूसरा इनाम: Double-Door Refrigerator',
      '🥉 तीसरा इनाम: Smart LED TV',
      '💰 इसके अलावा जीतें Multiple Cash Prizes!',
      '',
      '🎉 इस दिवाली DiwaliBigdeal से जुड़ें और शानदार इनाम जीतने का मौका पाएँ!',
      '',
      '🎟️ Entry Fee: ₹199',
      '📅 Winner Announcement: 8 November 2026',
      '⏰ Time: रात 11:59 बजे (IST)',
    ].join('\n'),

  termsDetails: () =>
    [
      '📜 DIWALI BIGDEAL — नियम और शर्तें (Terms & Conditions)',
      '',
      '1. आयु सीमा (Age Eligibility):',
      'इस Campaign में भाग लेने के लिए आपकी उम्र कम से कम 18 वर्ष या उससे अधिक होनी चाहिए। 18 वर्ष से कम आयु के व्यक्ति पात्र (Eligible) नहीं हैं।',
      '',
      '2. सही जानकारी (Accurate Information):',
      'प्रतिभागियों को अपना सही कानूनी नाम (Full Legal Name), चालू 10 अंकों का Indian Mobile Number और पूरा आवासीय पता (Complete Residential Address) देना अनिवार्य है। कृपया Submit करने से पहले अपनी सभी जानकारी ध्यान से जाँच लें।',
      '',
      '3. पहचान सत्यापन (Identity Verification):',
      'यदि आप विजेता (Winner) के रूप में चुने जाते हैं, तो पहचान और उम्र की पुष्टि के लिए मान्य सरकारी पहचान पत्र (Valid Government-issued ID) दिखाना आवश्यक होगा। आपकी ID पर दिया गया नाम आपके द्वारा दर्ज किए गए पूरे नाम से मेल खाना चाहिए। इनाम देने से पहले अतिरिक्त Verification किया जा सकता है।',
      '',
      '4. गलत या अधूरी जानकारी (Incorrect Information):',
      'यदि दर्ज किया गया नाम, पता, आयु या अन्य विवरण गलत, अधूरा या भ्रामक पाया जाता है या उसकी पुष्टि नहीं हो पाती है, तो Campaign नियमों के अनुसार आपकी Entry रद्द (Disqualify) की जा सकती है।',
      '',
      '5. विजेता की घोषणा (Winner Announcement):',
      'आधिकारिक Winner Announcement 8 November 2026 को रात 11:59 बजे (IST) किया जाएगा।',
      '',
      '6. टिकट सुरक्षा (Ticket Safety):',
      'सभी प्रतिभागी इनाम Claim और Verification के लिए अपना Confirmed Ticket Number (DB2026-XXXXXX) सुरक्षित रखें। केवल Ticket होना निश्चित इनाम की गारंटी नहीं है।',
      '',
      '7. सत्यापन और इनाम प्राप्ति (Verification & Prize Claim):',
      'चयनित विजेताओं को निर्धारित समय-सीमा के भीतर आवश्यक Verification पूरा करना होगा और दिए गए Prize-Claim निर्देशों का पालन करना होगा।',
      '',
      '8. गोपनीयता और सुरक्षा (Privacy):',
      'आपकी व्यक्तिगत जानकारी और Government ID दस्तावेज़ केवल आवश्यक Verification के लिए सुरक्षित रूप से लिए जाएँगे। कृपया अपनी कोई भी Government ID सार्वजनिक रूप से Telegram Chat में पोस्ट न करें।',
      '',
      '9. अभियान के नियम (Campaign Rules):',
      'इस Campaign में भागीदारी और इनाम वितरण लागू कानूनों तथा आधिकारिक Campaign Rules के अधीन है।',
    ].join('\n'),

  supportMessage: () =>
    [
      '📞 सहायता केंद्र | CUSTOMER SUPPORT',
      '',
      'यदि आपको अपनी Entry, Payment या Ticket से जुड़ी कोई भी सहायता चाहिए, तो कृपया हमें Email करें:',
      '',
      '📧 Support Email: diwalideal2026@gmail.com',
    ].join('\n'),

  referralDashboard: (data) => {
    const pendingWithdrawals = (data.withdrawal_requests || []).filter(
      (w) => w.status === 'PENDING_APPROVAL' || w.status === 'APPROVED_PENDING_PAYOUT'
    );
    const withdrawalLines =
      !data.withdrawal_requests || data.withdrawal_requests.length === 0
        ? ['• कोई Pending या पिछला Withdrawal Request नहीं है (None)']
        : data.withdrawal_requests.slice(0, 5).map((w) => {
            const refStr = w.payout_reference ? ` [Ref: ${w.payout_reference}]` : '';
            return `• ${w.id}: ${w.amount} Stars — Status: ${w.status}${refStr}`;
          });

    const historyLines =
      !data.history || data.history.length === 0
        ? ['• अभी तक कोई Referred User नहीं है (0 Referrals recorded in DB)']
        : data.history.slice(0, 10).map((item, idx) => {
            const dateStr = String(item.referred_at || '').slice(0, 10);
            const regStr = item.registration_completed ? 'Complete' : 'Incomplete';
            return `${idx + 1}. ${item.masked_identifier} | Date: ${dateStr} | Reg: ${regStr} | Payment: ${item.payment_status_label} | Bonus: ${item.bonus_status_label}`;
          });

    const programStatusLine = data.referral_program_enabled
      ? `✅ Referral Bonus Active (Min Withdrawal: ${data.min_withdrawal_amount} Stars)`
      : 'ℹ️ Referral Tracking Active (Bonus & Withdrawals disabled until campaign policy activation)';

    return [
      '🎁 DIWALI BIGDEAL — REFER & EARN DASHBOARD',
      '',
      `🔑 Permanent Referral Code: ${data.referral_code}`,
      `🔗 Personal Referral Link:\n${data.referral_link}`,
      '📋 (ऊपर दिए गए Link को Tap करके Copy या Share करें)',
      '',
      '📊 LIVE REFERRAL STATS (Database Records):',
      `• Total Referred Users: ${data.total_referred_users}`,
      `• Successfully Registered Referred Users: ${data.registered_referred_users}`,
      `• Successfully Verified Referred Payments: ${data.verified_referred_payments}`,
      `• Pending Payments: ${data.pending_referred_payments}`,
      `• Total Verified Referral Bonus: ${data.total_verified_bonus} Stars`,
      `• Available Withdrawal Balance: ${data.available_withdrawal_balance} Stars`,
      `• Pending Withdrawal Requests: ${pendingWithdrawals.length}`,
      `• Program Status: ${programStatusLine}`,
      '',
      '🏦 WITHDRAWAL REQUESTS & STATUS:',
      ...withdrawalLines,
      '',
      '📜 REFERRAL HISTORY (Privacy-Masked):',
      ...historyLines,
    ].join('\n');
  },
};

function buildReferralDashboardKeyboard(data) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(
    data.referral_link
  )}&text=${encodeURIComponent(
    '🪔 DiwaliBigdeal से जुड़ें और Mahindra Thar ROXX, Refrigerator, Smart LED TV व Cash Prizes जीतने का मौका पाएँ!'
  )}`;

  const rows = [
    [
      { text: '📤 Share Referral Link', url: shareUrl },
      { text: '📋 Copy Link / Code', callback_data: 'action_copy_referral_link' },
    ],
  ];

  if (data.can_request_withdrawal) {
    rows.push([
      {
        text: `💸 Request Withdrawal (${data.available_withdrawal_balance} Stars)`,
        callback_data: 'action_request_withdrawal',
      },
    ]);
  }

  rows.push([
    { text: '🔄 Refresh Stats', callback_data: 'menu_refer_earn' },
    { text: '🏠 Main Menu', callback_data: 'action_back_main_menu' },
  ]);

  return { inline_keyboard: rows };
}

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
          text: '✅ पुष्टि करें और ₹199 Payment करें | Confirm & Pay',
          callback_data: 'action_confirm_pay_199',
        },
      ],
      [{ text: '✏️ जानकारी बदलें | Edit Details', callback_data: 'action_edit_details' }],
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
          ? { text: '💳 अभी Payment करें | Pay Now (₹199)', url: paymentOrder.payment_url }
          : {
              text: '💳 अभी Payment करें | Pay Now (₹199)',
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
    inline_keyboard: [[{ text: '🚀 आगे बढ़ें | Continue', callback_data: 'action_continue_join' }]],
  });
}

async function handleMyTicketTrigger(customer) {
  if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
    await sendTelegramMessage(
      customer.telegram_chat_id,
      BOT_MESSAGES.myTicketConfirmed(
        customer.ticket_number,
        customer.name || 'Customer',
        customer.phone || '',
        customer.referral_code,
        customer.referral_count
      ),
      MAIN_MENU_INLINE_KEYBOARD
    );
  } else {
    await sendTelegramMessage(customer.telegram_chat_id, BOT_MESSAGES.myTicketNotFound(), {
      inline_keyboard: [
        [{ text: '🎟️ अभी जुड़ें | Join Now (₹199)', callback_data: 'menu_join_199' }],
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

async function handleReferAndEarnTrigger(customer) {
  const dashboardData = db.getCustomerReferralDashboard(customer.telegram_user_id);
  const text = BOT_MESSAGES.referralDashboard(dashboardData);
  const keyboard = buildReferralDashboardKeyboard(dashboardData);
  await sendTelegramMessage(customer.telegram_chat_id, text, keyboard);
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
    const username = (msg.from && msg.from.username) || null;
    const paymentId = sp.invoice_payload;

    db.getOrCreateCustomer(userId, chatId, username);

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
      menu_join_199: '🎟️ अभी जुड़ें | Join Now (₹199)',
      action_continue_join: '🚀 आगे बढ़ें | Continue',
      action_confirm_pay_199: '✅ पुष्टि करें और ₹199 Payment करें | Confirm & Pay',
      action_edit_details: '✏️ जानकारी बदलें | Edit Details',
      menu_my_ticket: '🎫 मेरा टिकट | My Ticket',
      menu_prize_details: '🎁 इनाम देखें | View Prizes',
      menu_refer_earn: '🎁 Refer & Earn',
      action_copy_referral_link: '📋 Copy Link / Code',
      action_request_withdrawal: '💸 Request Withdrawal',
      action_back_main_menu: '🏠 Main Menu',
      menu_terms: '📜 नियम और शर्तें | Terms & Conditions',
      menu_support: '📞 सहायता | Support',
    };

    const tapDisplay =
      buttonLabelMap[data] ||
      (data.startsWith('pay_link_') ? '💳 अभी Payment करें | Pay Now (₹199)' : data);

    db.appendChatMessage(chatId, {
      id: crypto.randomUUID(),
      chat_id: chatId,
      text: tapDisplay,
      timestamp: new Date().toISOString(),
      direction: 'user',
    });

    await answerTelegramCallbackQuery(cb.id);

    let customer = db.getOrCreateCustomer(userId, chatId, (cb.from && cb.from.username) || null);

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

    if (data === 'menu_refer_earn') {
      await handleReferAndEarnTrigger(customer);
      return customer;
    }

    if (data === 'action_copy_referral_link') {
      const dash = db.getCustomerReferralDashboard(userId);
      await sendTelegramMessage(
        chatId,
        [
          '📋 आपका Permanent Referral Code और Link:',
          '',
          `🔑 Referral Code: ${dash.referral_code}`,
          `🔗 Referral Link:\n${dash.referral_link}`,
          '',
          'इस संदेश को Copy या Forward करके अपने दोस्तों के साथ साझा करें!',
        ].join('\n'),
        buildReferralDashboardKeyboard(dash)
      );
      return customer;
    }

    if (data === 'action_request_withdrawal') {
      const reqResult = db.createWithdrawalRequest(userId);
      const updatedDash = db.getCustomerReferralDashboard(userId);
      if (reqResult.ok && reqResult.request) {
        await notifyAdminWithdrawalRequested({
          customer,
          request: reqResult.request,
        });
        await sendTelegramMessage(
          chatId,
          [
            '✅ आपका Withdrawal Request सफलतापूर्वक दर्ज कर लिया गया है!',
            '',
            `🆔 Request ID: ${reqResult.request.id}`,
            `💰 Amount: ${reqResult.request.amount} Stars`,
            `📌 Status: ${reqResult.request.status} (Awaiting Admin Review)`,
            '',
            '⚠️ ध्यान दें: प्रत्येक Withdrawal Request की Admin द्वारा जाँच की जाती है।',
          ].join('\n'),
          buildReferralDashboardKeyboard(updatedDash)
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `⚠️ Withdrawal Request उपलब्ध नहीं है: ${reqResult.reason || 'Not eligible'}`,
          buildReferralDashboardKeyboard(updatedDash)
        );
      }
      return customer;
    }

    if (data === 'action_back_main_menu') {
      await sendTelegramMessage(
        chatId,
        BOT_MESSAGES.mainMenuGreeting(),
        MAIN_MENU_INLINE_KEYBOARD
      );
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

  // 3. Handle Standard Text Messages & All Bot Commands (/start, /prizes, /ticket, /refer, /terms, /enter, /support)
  const incomingMsg = update.message || update.edited_message;
  if (incomingMsg && typeof incomingMsg.text === 'string') {
    const userId = String((incomingMsg.from && incomingMsg.from.id) || incomingMsg.chat.id);
    const chatId = String(incomingMsg.chat.id);
    const username = (incomingMsg.from && incomingMsg.from.username) || null;
    const text = incomingMsg.text.trim();
    const command = normalizeBotCommand(text);

    db.appendChatMessage(chatId, {
      id: crypto.randomUUID(),
      chat_id: chatId,
      text,
      timestamp: new Date().toISOString(),
      direction: 'user',
    });

    let customer = db.getOrCreateCustomer(userId, chatId, username);

    const referralCodeCandidate = extractReferralCodeFromText(text);
    let referralResult = { applied: false, referrer: null };
    if (referralCodeCandidate) {
      referralResult = db.applyReferralCodeOnce(userId, referralCodeCandidate);
      customer = db.getCustomerByUserId(userId) || customer;
    }

    // Command: /start, /menu, /help, hi, hello
    if (
      command === '/start' ||
      command === '/menu' ||
      command === '/help' ||
      text.toLowerCase() === 'menu' ||
      text.toLowerCase() === 'hi' ||
      text.toLowerCase() === 'hello'
    ) {
      if (command === '/start') {
        await notifyAdminNewBotStart({
          customer,
          username,
          referralApplied: referralResult.applied,
          referrer: referralResult.referrer,
        });
      }
      await sendTelegramMessage(
        chatId,
        BOT_MESSAGES.mainMenuGreeting(),
        MAIN_MENU_INLINE_KEYBOARD
      );
      return customer;
    }

    // Command: /enter, /join, or Join button text
    if (
      command === '/enter' ||
      command === '/join' ||
      text === '🎟️ अभी जुड़ें | Join Now' ||
      text === '🎟️ अभी जुड़ें | Join Now (₹199)' ||
      text === '🎟️ Join Entry (100 Telegram Stars ⭐️)' ||
      text === '🎟️ Join ₹199 Entry'
    ) {
      await handleJoinEntryTrigger(customer);
      return db.getCustomerByUserId(userId);
    }

    // Command: /ticket or My Ticket button text
    if (
      command === '/ticket' ||
      command === '/myticket' ||
      text === '🎫 मेरा टिकट | My Ticket' ||
      text === '🎫 My Ticket'
    ) {
      await handleMyTicketTrigger(customer);
      return customer;
    }

    // Command: /prizes or Prize Details button text
    if (
      command === '/prizes' ||
      command === '/prize' ||
      text === '🎁 इनाम देखें | View Prizes' ||
      text === '🏆 Prize Details'
    ) {
      await handlePrizeDetailsTrigger(customer);
      return customer;
    }

    // Command: /refer or 🎁 Refer & Earn button text
    if (
      command === '/refer' ||
      command === '/referral' ||
      text === '🎁 Refer & Earn'
    ) {
      await handleReferAndEarnTrigger(customer);
      return customer;
    }

    // Command: /terms or Terms button text
    if (
      command === '/terms' ||
      command === '/rules' ||
      text === '📜 नियम और शर्तें | Terms & Conditions' ||
      text === '📜 Terms & Conditions'
    ) {
      await handleTermsTrigger(customer);
      return customer;
    }

    // Command: /support or Support button text
    if (
      command === '/support' ||
      text === '📞 सहायता | Support' ||
      text === '🆘 Support'
    ) {
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
          await sendTelegramMessage(
            chatId,
            '🏠 कृपया अपना पूरा पता (Complete Address) दर्ज करें:'
          );
          return customer;
        }
        customer = db.updateCustomer(userId, {
          address: text,
          conversation_state: ConversationState.WAITING_FOR_CONFIRMATION,
        });
        await notifyAdminRegistrationSubmitted(customer);
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
// STANDALONE VERCEL SERVERLESS FUNCTION (`/api/telegram/webhook.js`)
// ============================================================================
module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const rawUrl = req.url || '';
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
        supported_commands: ['/start', '/enter', '/ticket', '/prizes', '/refer', '/terms', '/support'],
        supported_updates: ['message', 'callback_query', 'pre_checkout_query'],
        payment_mode: 'telegram_stars (XTR)',
        currency: 'XTR',
        stars_amount: 100,
        display_entry_price: '100 Telegram Stars ⭐️',
        invoice_prices: [{ label: 'DiwaliBigdeal Entry', amount: 100 }],
        telegram_bot_token_configured: status.telegramBotTokenConfigured,
        telegram_webhook_secret_configured: status.telegramWebhookSecretConfigured,
        telegram_admin_chat_configured: status.telegramAdminChatConfigured,
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
        db.updateTelemetry({
          last_auth_failure_at: new Date().toISOString(),
          last_auth_failure_reason: check.reason,
        });
        logger.security(
          'TelegramWebhook',
          'Rejected unauthorized Telegram webhook request (secret token mismatch)',
          { reason: check.reason }
        );
        await ensureTelegramWebhookRegistered(true).catch(() => {});
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

    const updateType = update.pre_checkout_query
      ? 'pre_checkout_query'
      : update.callback_query
      ? 'callback_query'
      : update.message && update.message.successful_payment
      ? 'successful_payment'
      : update.message || update.edited_message
      ? 'message'
      : 'unknown';

    const prevTelemetry = db.getTelemetry();
    db.updateTelemetry({
      last_update_received_at: new Date().toISOString(),
      last_update_id: update.update_id,
      last_update_type: updateType,
      total_updates_received: (prevTelemetry.total_updates_received || 0) + 1,
    });

    logger.webhook('TelegramWebhook', `Received Telegram update_id=${update.update_id}`, {
      updateType,
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
  } catch (err) {
    logger.error('TelegramWebhook', 'Unhandled error processing Telegram update', {
      error: err instanceof Error ? err.message : String(err),
    });
    return sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
};
