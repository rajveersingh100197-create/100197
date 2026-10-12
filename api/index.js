/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webhookHandler = require('./telegram/webhook.js');

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

function buildReferrerSummaries(store) {
  const cfg = getConfig();
  const allCustomers = Object.values(store.customers || {});
  const allWithdrawals = Object.values(store.withdrawalRequests || {});
  const bonusPerVerified = cfg.REFERRAL_PROGRAM_ENABLED
    ? cfg.REFERRAL_BONUS_PER_VERIFIED_PAYMENT
    : 0;

  return allCustomers
    .map((cust) => {
      const uid = cust.telegram_user_id;
      const referralCode =
        normalizeReferralCode(cust.referral_code) || generateReferralCode(uid);
      const referralLink = formatReferralLink(referralCode);

      const referredCustomers = allCustomers
        .filter(
          (rc) =>
            rc.telegram_user_id !== uid &&
            rc.referred_by &&
            normalizeReferralCode(rc.referred_by) === referralCode
        )
        .sort(
          (a, b) =>
            new Date(b.referred_at || b.created_at).getTime() -
            new Date(a.referred_at || a.created_at).getTime()
        );

      const totalReferredUsers = referredCustomers.length;
      const registeredReferredUsers = referredCustomers.filter((rc) =>
        Boolean(rc.name && rc.phone && rc.address)
      ).length;
      const verifiedReferredPayments = referredCustomers.filter(
        (rc) => rc.payment_status === 'PAID' && Boolean(rc.ticket_number)
      ).length;
      const pendingReferredPayments = referredCustomers.filter(
        (rc) => rc.payment_status !== 'PAID' || !rc.ticket_number
      ).length;

      const totalVerifiedBonus = verifiedReferredPayments * bonusPerVerified;

      const userWithdrawals = allWithdrawals
        .filter((w) => w.telegram_user_id === uid)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const pendingWithdrawalAmount = userWithdrawals
        .filter((w) => w.status === 'PENDING_APPROVAL')
        .reduce((sum, w) => sum + Number(w.amount || 0), 0);

      const approvedWithdrawalAmount = userWithdrawals
        .filter((w) => w.status === 'APPROVED_PENDING_PAYOUT')
        .reduce((sum, w) => sum + Number(w.amount || 0), 0);

      const paidWithdrawalAmount = userWithdrawals
        .filter((w) => w.status === 'PAID')
        .reduce((sum, w) => sum + Number(w.amount || 0), 0);

      const lockedOrPaidAmount =
        pendingWithdrawalAmount + approvedWithdrawalAmount + paidWithdrawalAmount;

      const availableWithdrawalBalance = Math.max(0, totalVerifiedBonus - lockedOrPaidAmount);

      let remainingPaidPool = paidWithdrawalAmount;

      const referredUsers = referredCustomers.map((rc) => {
        const regDone = Boolean(rc.name && rc.phone && rc.address);
        const isVerifiedPaid = rc.payment_status === 'PAID' && Boolean(rc.ticket_number);
        const paymentStatusLabel = isVerifiedPaid
          ? 'Verified'
          : rc.payment_status === 'FAILED'
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
          referred_telegram_user_id: rc.telegram_user_id,
          referred_username: rc.username || null,
          referred_name: rc.name || null,
          masked_identifier: maskCustomerIdentifier(rc),
          referred_at: rc.referred_at || rc.created_at,
          registration_completed: regDone,
          payment_status_label: paymentStatusLabel,
          ticket_number: rc.ticket_number || null,
          bonus_status_label: bonusStatusLabel,
          bonus_amount: isVerifiedPaid ? bonusPerVerified : 0,
        };
      });

      return {
        telegram_user_id: uid,
        username: cust.username || null,
        display_name: cust.name || cust.username || `User ${uid}`,
        referral_code: referralCode,
        referral_link: referralLink,
        total_referred_users: totalReferredUsers,
        registered_referred_users: registeredReferredUsers,
        verified_referred_payments: verifiedReferredPayments,
        pending_referred_payments: pendingReferredPayments,
        total_verified_bonus: totalVerifiedBonus,
        available_withdrawal_balance: availableWithdrawalBalance,
        pending_withdrawal_amount: pendingWithdrawalAmount,
        approved_withdrawal_amount: approvedWithdrawalAmount,
        paid_withdrawal_amount: paidWithdrawalAmount,
        withdrawal_requests: userWithdrawals,
        referred_users: referredUsers,
        updated_at: cust.updated_at,
      };
    })
    .sort((a, b) => {
      if (b.total_referred_users !== a.total_referred_users) {
        return b.total_referred_users - a.total_referred_users;
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
}

const DATA_DIR =
  process.env.VERCEL === '1' || process.env.VERCEL
    ? '/tmp/diwalibigdeal'
    : path.resolve(process.cwd(), 'data');
const JSON_DB_FILE = path.join(DATA_DIR, 'diwalibigdeal_store.json');

function loadStoreSnapshot() {
  try {
    if (fs.existsSync(JSON_DB_FILE)) {
      return JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8'));
    }
  } catch (_err) {
    // fallback
  }
  return {
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
    webhookTelemetry: {},
  };
}

function saveStoreSnapshot(store) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(JSON_DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (_err) {
    // ignore
  }
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
        telegram_webhook_secret_configured: cfg.telegramWebhookSecretConfigured,
        telegram_admin_chat_configured: cfg.telegramAdminChatConfigured,
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Delegate `/api/telegram/webhook`, `/api/telegram/status`, `/api/index`, `/api` to webhookHandler
    if (
      urlPath === '/api/telegram/webhook' ||
      urlPath === '/api/telegram/status' ||
      urlPath === '/api/index' ||
      urlPath === '/api'
    ) {
      return webhookHandler(req, res);
    }

    // 3. Admin Overview (`GET /api/admin/overview`)
    if (req.method === 'GET' && urlPath === '/api/admin/overview') {
      const store = loadStoreSnapshot();
      const customers = Object.values(store.customers || {}).sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      const withdrawalRequests = Object.values(store.withdrawalRequests || {}).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const referrerSummaries = buildReferrerSummaries(store);
      const configStatus = getPublicConfigStatus();
      const cfg = getConfig();
      const validAdminChat =
        cfg.TELEGRAM_ADMIN_CHAT_ID &&
        cfg.TELEGRAM_ADMIN_CHAT_ID !== 'YOUR_PRIVATE_ADMIN_GROUP_CHAT_ID' &&
        /^-\d+$/.test(cfg.TELEGRAM_ADMIN_CHAT_ID);

      const stats = {
        totalCustomers: customers.length,
        confirmedTickets: customers.filter((c) => c.payment_status === 'PAID' && c.ticket_number).length,
        pendingPayments: customers.filter((c) => c.payment_status === 'PENDING').length,
        totalReferrals: customers.reduce((sum, c) => sum + (c.referral_count || 0), 0),
        pendingWithdrawals: withdrawalRequests.filter(
          (w) => w.status === 'PENDING_APPROVAL' || w.status === 'APPROVED_PENDING_PAYOUT'
        ).length,
        totalStarsCollected:
          customers.filter((c) => c.payment_status === 'PAID' && c.ticket_number).length * 100,
      };

      return sendJson(res, 200, {
        ok: true,
        config: {
          ...configStatus,
          adminGroupValidationMessage: validAdminChat
            ? 'Configured & Valid'
            : 'TELEGRAM_ADMIN_CHAT_ID is not configured or not a negative group ID (e.g. -1001234567890).',
        },
        stats,
        customers,
        referrerSummaries,
        withdrawalRequests,
        adminNotifications: (store.adminNotifications || []).slice(0, 50),
        logs: (store.systemLogs || []).slice(0, 80),
        telemetry: store.webhookTelemetry || {},
        sqlSchema: `-- Production SQL Schema for DiwaliBigdeal Telegram Bot`,
      });
    }

    // 3b. Admin Referrals List (`GET /api/admin/referrals`)
    if (req.method === 'GET' && urlPath === '/api/admin/referrals') {
      const store = loadStoreSnapshot();
      return sendJson(res, 200, {
        ok: true,
        referrerSummaries: buildReferrerSummaries(store),
        withdrawalRequests: Object.values(store.withdrawalRequests || {}),
      });
    }

    // 4. Admin Chat Transcript (`GET /api/admin/chat/:chatId`)
    if (req.method === 'GET' && urlPath.startsWith('/api/admin/chat/')) {
      const chatId = decodeURIComponent(urlPath.replace('/api/admin/chat/', ''));
      const store = loadStoreSnapshot();
      const customer = (store.customers && store.customers[chatId]) || null;
      const history = (store.chatHistories && store.chatHistories[chatId]) || [];
      return sendJson(res, 200, {
        ok: true,
        customer,
        chatHistory: history,
      });
    }

    // 5. Admin Withdrawal Status Update (`POST /api/admin/withdrawal/:id/status`)
    if (
      req.method === 'POST' &&
      urlPath.startsWith('/api/admin/withdrawal/') &&
      urlPath.endsWith('/status')
    ) {
      const id = decodeURIComponent(
        urlPath.replace('/api/admin/withdrawal/', '').replace(/\/status$/, '')
      );
      const { body } = await readRawAndJsonBody(req);
      const allowed = ['PENDING_APPROVAL', 'APPROVED_PENDING_PAYOUT', 'PAID', 'REJECTED'];
      if (!body.status || !allowed.includes(body.status)) {
        return sendJson(res, 400, { ok: false, error: 'Invalid status' });
      }
      const store = loadStoreSnapshot();
      const existing = store.withdrawalRequests && store.withdrawalRequests[id];
      if (!existing) {
        return sendJson(res, 404, { ok: false, error: 'Withdrawal request not found' });
      }
      existing.status = body.status;
      if (body.payout_reference !== undefined) {
        existing.payout_reference = body.payout_reference;
      }
      existing.updated_at = new Date().toISOString();

      // Send admin group notification for withdrawal status update
      const cfg = getConfig();
      const validAdminChat =
        cfg.TELEGRAM_ADMIN_CHAT_ID &&
        cfg.TELEGRAM_ADMIN_CHAT_ID !== 'YOUR_PRIVATE_ADMIN_GROUP_CHAT_ID' &&
        /^-\d+$/.test(cfg.TELEGRAM_ADMIN_CHAT_ID);
      const notifText = [
        '🔄 WITHDRAWAL STATUS UPDATED — DiwaliBigdeal',
        '',
        `🆔 Request ID: ${existing.id}`,
        `👤 User ID: ${existing.telegram_user_id}`,
        `🔗 Referral Code: ${existing.referral_code}`,
        `💰 Amount: ${existing.amount} Stars`,
        `📌 New Status: ${existing.status}`,
        existing.payout_reference ? `🧾 Payout Ref: ${existing.payout_reference}` : null,
        `🕒 Updated At: ${existing.updated_at}`,
      ]
        .filter(Boolean)
        .join('\n');

      let delivered = false;
      let deliveryStatus = 'NOT_CONFIGURED';
      if (validAdminChat && cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN') {
        try {
          const resp = await fetch(`https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cfg.TELEGRAM_ADMIN_CHAT_ID,
              text: notifText,
              disable_web_page_preview: true,
            }),
          });
          delivered = resp.ok;
          deliveryStatus = resp.ok ? 'DELIVERED_TO_ADMIN_GROUP' : `TELEGRAM_HTTP_${resp.status}`;
        } catch (_e) {
          deliveryStatus = 'NETWORK_ERROR';
        }
      }

      const notifEntry = {
        id: crypto.randomUUID(),
        dedup_key: `withdrawal_status_${existing.id}_${existing.status}_${existing.updated_at}`,
        event_type: 'WITHDRAWAL_STATUS_CHANGED',
        text: notifText,
        delivered_to_telegram: delivered,
        telegram_status: deliveryStatus,
        created_at: new Date().toISOString(),
      };
      store.adminNotifications = [notifEntry, ...(store.adminNotifications || [])].slice(0, 100);
      saveStoreSnapshot(store);

      return sendJson(res, 200, {
        ok: true,
        withdrawal: existing,
        withdrawalRequests: Object.values(store.withdrawalRequests || {}),
        referrerSummaries: buildReferrerSummaries(store),
      });
    }

    // 6. Admin Test Notification (`POST /api/admin/test-notification`)
    if (req.method === 'POST' && urlPath === '/api/admin/test-notification') {
      const { body } = await readRawAndJsonBody(req);
      const cfg = getConfig();
      const validAdminChat =
        cfg.TELEGRAM_ADMIN_CHAT_ID &&
        cfg.TELEGRAM_ADMIN_CHAT_ID !== 'YOUR_PRIVATE_ADMIN_GROUP_CHAT_ID' &&
        /^-\d+$/.test(cfg.TELEGRAM_ADMIN_CHAT_ID);

      let delivered = false;
      let status = 'NOT_CONFIGURED';
      const testText = [
        '🔔 DIWALI BIGDEAL — ADMIN GROUP TEST NOTIFICATION',
        '',
        '✅ Server-side admin notification channel is active.',
        `🌐 Service: DiwaliBigdeal Telegram Bot (100197-oqqb)`,
        `🕒 Timestamp: ${new Date().toISOString()}`,
        body && body.note ? `📝 Note: ${String(body.note).slice(0, 120)}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      if (validAdminChat && cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN') {
        try {
          const resp = await fetch(`https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cfg.TELEGRAM_ADMIN_CHAT_ID,
              text: testText,
              disable_web_page_preview: true,
            }),
          });
          delivered = resp.ok;
          status = resp.ok ? 'DELIVERED_TO_ADMIN_GROUP' : `TELEGRAM_HTTP_${resp.status}`;
        } catch (_e) {
          status = 'NETWORK_ERROR';
        }
      }

      const store = loadStoreSnapshot();
      const entry = {
        id: crypto.randomUUID(),
        dedup_key: `admin_test_${Date.now()}`,
        event_type: 'ADMIN_TEST',
        text: testText,
        delivered_to_telegram: delivered,
        telegram_status: status,
        created_at: new Date().toISOString(),
      };
      store.adminNotifications = [entry, ...(store.adminNotifications || [])].slice(0, 100);
      saveStoreSnapshot(store);

      return sendJson(res, 200, {
        ok: delivered,
        admin_chat_configured: Boolean(validAdminChat),
        delivery_status: status,
        notification: entry,
        adminNotifications: store.adminNotifications.slice(0, 50),
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
