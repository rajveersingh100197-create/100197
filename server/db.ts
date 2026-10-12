/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ConversationState,
  CustomerRecord,
  CustomerReferralDashboardData,
  OutgoingBotMessage,
  PaymentStatus,
  ReferralHistoryItem,
  WithdrawalRequest,
  WithdrawalStatus,
} from './types';
import { CONFIG } from './config';
import { logger } from './logger';

export interface AdminNotificationEntry {
  id: string;
  dedup_key: string;
  event_type:
    | 'BOT_START'
    | 'REGISTRATION_SUBMITTED'
    | 'PAYMENT_VERIFIED'
    | 'REFERRAL_BONUS_CREDITED'
    | 'WITHDRAWAL_REQUESTED'
    | 'WITHDRAWAL_STATUS_CHANGED'
    | 'ADMIN_TEST';
  text: string;
  delivered_to_telegram: boolean;
  telegram_status: string;
  created_at: string;
}

interface DatabaseStorageSnapshot {
  customers: Record<string, CustomerRecord>;
  ticketSequence: number;
  processedWebhooks: Record<string, string>; // payment_id -> ticket_number
  processedAdminNotifications: Record<string, string>; // dedup_key -> ISO timestamp
  processedReferrals: Record<string, string>; // referred_user_id -> referrer_code
  processedReferralBonuses: Record<string, string>; // payment_id -> referrer_user_id
  withdrawalRequests: Record<string, WithdrawalRequest>; // withdrawal_id -> WithdrawalRequest
  adminNotifications: AdminNotificationEntry[];
  chatHistories: Record<string, OutgoingBotMessage[]>;
}

const DATA_DIR =
  process.env.VERCEL === '1'
    ? '/tmp/diwalibigdeal'
    : path.resolve(process.cwd(), 'data');
const JSON_DB_FILE = path.join(DATA_DIR, 'diwalibigdeal_store.json');

/**
 * Generates a permanent, deterministic 6-character alphanumeric referral code
 * for a Telegram user ID (never changes on repeated visits).
 * Link format: https://t.me/DiwaliDhamaka2026Bot?start=ref_CODE
 */
export function generateReferralCode(telegramUserId: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(`diwalibigdeal_ref_${telegramUserId}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  return hash;
}

/**
 * Normalizes any raw referral code input (`ref_ABC123`, `REF-ABC123`, `ABC123`)
 * to the canonical 6-character uppercase code `ABC123`.
 */
export function normalizeReferralCode(raw?: string | null): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^(ref_|ref-)/i, '')
    .toUpperCase();
  return cleaned;
}

export function formatReferralLink(referralCode: string): string {
  const code = normalizeReferralCode(referralCode);
  return `https://t.me/${CONFIG.TELEGRAM_BOT_USERNAME}?start=ref_${code}`;
}

export function maskCustomerIdentifier(customer: CustomerRecord): string {
  if (customer.name && customer.name.trim().length >= 2) {
    const parts = customer.name.trim().split(/\s+/);
    const first = parts[0];
    const maskedFirst =
      first.length <= 2 ? `${first[0]}*` : `${first.slice(0, 2)}${'*'.repeat(Math.min(4, first.length - 2))}`;
    const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : '';
    return `${maskedFirst}${lastInitial} (ID: ***${String(customer.telegram_user_id).slice(-4)})`;
  }
  if (customer.username) {
    const clean = customer.username.replace(/^@/, '');
    const prefix = clean.slice(0, 2);
    return `@${prefix}*** (ID: ***${String(customer.telegram_user_id).slice(-4)})`;
  }
  return `User ***${String(customer.telegram_user_id).slice(-4)}`;
}

class DatabaseManager {
  private store: DatabaseStorageSnapshot = {
    customers: {},
    ticketSequence: 0,
    processedWebhooks: {},
    processedAdminNotifications: {},
    processedReferrals: {},
    processedReferralBonuses: {},
    withdrawalRequests: {},
    adminNotifications: [],
    chatHistories: {},
  };

  constructor() {
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(JSON_DB_FILE)) {
        const raw = fs.readFileSync(JSON_DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<DatabaseStorageSnapshot>;
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
        };
        for (const uid of Object.keys(this.store.customers)) {
          const c = this.store.customers[uid];
          c.referral_code = normalizeReferralCode(c.referral_code) || generateReferralCode(uid);
          if (c.referred_by) {
            c.referred_by = normalizeReferralCode(c.referred_by);
          } else {
            c.referred_by = null;
          }
          if (typeof c.referral_count !== 'number') {
            c.referral_count = 0;
          }
          if (typeof c.verified_referral_count !== 'number') {
            c.verified_referral_count = 0;
          }
          if (typeof c.verified_referral_bonus !== 'number') {
            c.verified_referral_bonus = 0;
          }
        }
        logger.info('Database', 'Loaded persistent database snapshot from disk', {
          customerCount: Object.keys(this.store.customers).length,
          ticketSequence: this.store.ticketSequence,
        });
      } else {
        this.seedDemoEntries();
        this.persist();
        logger.info('Database', 'Initialized new persistent database store with sample records');
      }
    } catch (err) {
      logger.warn('Database', 'Using in-memory fallback storage (ephemeral filesystem)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private seedDemoEntries() {
    const now = new Date(Date.now() - 3600 * 1000 * 5).toISOString();
    const recent = new Date(Date.now() - 1800 * 1000).toISOString();

    const demo1Code = generateReferralCode('918820144');
    const demo2Code = generateReferralCode('917451902');

    const demo1: CustomerRecord = {
      telegram_user_id: '918820144',
      telegram_chat_id: '918820144',
      username: 'aarav_sharma',
      name: 'Aarav Sharma',
      phone: '9876543210',
      address: 'Flat 402, Lotus Enclave, Indiranagar, Bengaluru, Karnataka - 560038',
      conversation_state: ConversationState.COMPLETED,
      payment_id: 'pay_DB2026_99102A',
      payment_status: PaymentStatus.PAID,
      payment_amount: CONFIG.CAMPAIGN_ENTRY_FEE,
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

    const demo2: CustomerRecord = {
      telegram_user_id: '917451902',
      telegram_chat_id: '917451902',
      username: 'priya_nair',
      name: 'Priya Nair',
      phone: '9820112233',
      address: 'B-18, Shanti Niketan, Bandra West, Mumbai, Maharashtra - 400050',
      conversation_state: ConversationState.WAITING_FOR_PAYMENT,
      payment_id: 'pay_DB2026_88410B',
      payment_status: PaymentStatus.PENDING,
      payment_amount: CONFIG.CAMPAIGN_ENTRY_FEE,
      ticket_number: null,
      referral_code: demo2Code,
      referred_by: demo1.referral_code,
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
    this.store.processedWebhooks[demo1.payment_id!] = demo1.ticket_number!;
    this.store.processedReferrals[demo2.telegram_user_id] = demo1.referral_code;
  }

  private persist() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(JSON_DB_FILE, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('Database', 'Could not write snapshot to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public getOrCreateCustomer(
    telegramUserId: string,
    telegramChatId: string,
    username?: string | null
  ): { customer: CustomerRecord; isNew: boolean } {
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
      return { customer: { ...existing }, isNew: false };
    }

    const now = new Date().toISOString();
    const record: CustomerRecord = {
      telegram_user_id: uid,
      telegram_chat_id: cid,
      username: username || null,
      name: null,
      phone: null,
      address: null,
      conversation_state: ConversationState.IDLE,
      payment_id: null,
      payment_status: PaymentStatus.UNPAID,
      payment_amount: CONFIG.CAMPAIGN_ENTRY_FEE,
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
    logger.info('Database', `Created new customer record for Telegram ID ${uid}`);
    return { customer: { ...record }, isNew: true };
  }

  public getCustomerByUserId(telegramUserId: string): CustomerRecord | null {
    const rec = this.store.customers[String(telegramUserId)];
    return rec ? { ...rec } : null;
  }

  public getCustomerByReferralCode(referralCode: string): CustomerRecord | null {
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

  /**
   * Atomically attributes a referred user to a referrer's permanent code once.
   * Prevents self-referrals, duplicate attribution, and overwriting an existing referrer.
   */
  public applyReferralCodeOnce(
    referredUserId: string,
    rawReferralCode?: string | null
  ): { applied: boolean; referrer: CustomerRecord | null; reason?: string } {
    const uid = String(referredUserId);
    const code = normalizeReferralCode(rawReferralCode);
    if (!code) {
      return { applied: false, referrer: null, reason: 'empty_code' };
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
    referredCustomer.referred_by = referrer.referral_code;
    referredCustomer.referred_by_user_id = referrer.telegram_user_id;
    referredCustomer.referred_at = now;
    referredCustomer.updated_at = now;

    const referrerRecord = this.store.customers[referrer.telegram_user_id];
    referrerRecord.referral_count = (referrerRecord.referral_count || 0) + 1;
    referrerRecord.updated_at = now;

    this.store.processedReferrals[uid] = referrer.referral_code;
    this.persist();

    return { applied: true, referrer: { ...referrerRecord } };
  }

  /**
   * Credits verified referral bonus to the referrer strictly once per verified payment_id,
   * and only if REFERRAL_PROGRAM_ENABLED is true (or tracks verified count accurately).
   */
  public creditVerifiedReferralOnPayment(
    referredUserId: string,
    paymentId: string
  ): {
    credited: boolean;
    referrer: CustomerRecord | null;
    bonusAdded: number;
  } {
    const uid = String(referredUserId);
    const pid = String(paymentId || '').trim();
    if (!pid) {
      return { credited: false, referrer: null, bonusAdded: 0 };
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

    const bonusPerVerified = CONFIG.REFERRAL_PROGRAM_ENABLED
      ? CONFIG.REFERRAL_BONUS_PER_VERIFIED_PAYMENT
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

  /**
   * Computes the complete live Referral & Withdrawal Dashboard for a customer
   * strictly from persistent database records (never sample numbers).
   */
  public getCustomerReferralDashboard(telegramUserId: string): CustomerReferralDashboardData {
    const uid = String(telegramUserId);
    const customer = this.store.customers[uid];
    const referralCode = customer
      ? normalizeReferralCode(customer.referral_code) || generateReferralCode(uid)
      : generateReferralCode(uid);
    const referralLink = formatReferralLink(referralCode);

    // Find all customers referred by this user's referral_code
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

    const bonusPerVerified = CONFIG.REFERRAL_PROGRAM_ENABLED
      ? CONFIG.REFERRAL_BONUS_PER_VERIFIED_PAYMENT
      : 0;
    const totalVerifiedBonus = verifiedReferredPayments * bonusPerVerified;

    // Sync customer's summary counters if needed
    if (customer) {
      customer.referral_count = totalReferredUsers;
      customer.verified_referral_count = verifiedReferredPayments;
      customer.verified_referral_bonus = totalVerifiedBonus;
    }

    const userWithdrawals = Object.values(this.store.withdrawalRequests)
      .filter((w) => w.telegram_user_id === uid)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Locked or paid withdrawals: PENDING_APPROVAL, APPROVED_PENDING_PAYOUT, or PAID (REJECTED does not deduct balance)
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
      CONFIG.REFERRAL_PROGRAM_ENABLED &&
      CONFIG.REFERRAL_WITHDRAWALS_ENABLED &&
      availableWithdrawalBalance >= CONFIG.REFERRAL_MIN_WITHDRAWAL_AMOUNT &&
      !hasActivePendingWithdrawal;

    const PaidWithdrawalsTotal = userWithdrawals
      .filter((w) => w.status === 'PAID')
      .reduce((sum, w) => sum + Number(w.amount || 0), 0);

    let remainingPaidPool = PaidWithdrawalsTotal;

    const history: ReferralHistoryItem[] = referredCustomers.map((rc) => {
      const regDone = Boolean(rc.name && rc.phone && rc.address);
      const isVerifiedPaid =
        rc.payment_status === PaymentStatus.PAID && Boolean(rc.ticket_number);
      const paymentStatusLabel: 'Pending' | 'Verified' | 'Failed' = isVerifiedPaid
        ? 'Verified'
        : rc.payment_status === PaymentStatus.FAILED
        ? 'Failed'
        : 'Pending';

      let bonusStatusLabel: 'Pending' | 'Eligible' | 'Paid' = 'Pending';
      if (isVerifiedPaid && CONFIG.REFERRAL_PROGRAM_ENABLED) {
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
      referred_by: customer?.referred_by || null,
      referral_program_enabled: CONFIG.REFERRAL_PROGRAM_ENABLED,
      withdrawals_enabled: CONFIG.REFERRAL_WITHDRAWALS_ENABLED,
      total_referred_users: totalReferredUsers,
      registered_referred_users: registeredReferredUsers,
      verified_referred_payments: verifiedReferredPayments,
      pending_referred_payments: pendingReferredPayments,
      total_verified_bonus: totalVerifiedBonus,
      locked_or_paid_withdrawal_amount: lockedOrPaidWithdrawalAmount,
      available_withdrawal_balance: availableWithdrawalBalance,
      can_request_withdrawal: canRequestWithdrawal,
      min_withdrawal_amount: CONFIG.REFERRAL_MIN_WITHDRAWAL_AMOUNT,
      withdrawal_requests: userWithdrawals,
      history,
    };
  }

  /**
   * Creates a withdrawal request with initial status PENDING_APPROVAL.
   * Never marks a withdrawal as paid automatically.
   */
  public createWithdrawalRequest(telegramUserId: string): {
    ok: boolean;
    request?: WithdrawalRequest;
    reason?: string;
  } {
    const uid = String(telegramUserId);
    if (!CONFIG.REFERRAL_PROGRAM_ENABLED || !CONFIG.REFERRAL_WITHDRAWALS_ENABLED) {
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

    if (dashboard.available_withdrawal_balance < CONFIG.REFERRAL_MIN_WITHDRAWAL_AMOUNT) {
      return {
        ok: false,
        reason: `Minimum eligible balance of ${CONFIG.REFERRAL_MIN_WITHDRAWAL_AMOUNT} Stars is required to request withdrawal (Available: ${dashboard.available_withdrawal_balance} Stars).`,
      };
    }

    const now = new Date().toISOString();
    const reqId = `WD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const withdrawal: WithdrawalRequest = {
      id: reqId,
      telegram_user_id: uid,
      referral_code: dashboard.referral_code,
      amount: dashboard.available_withdrawal_balance,
      status: 'PENDING_APPROVAL',
      payout_reference: null,
      created_at: now,
      updated_at: now,
    };

    this.store.withdrawalRequests[reqId] = withdrawal;
    this.persist();

    return { ok: true, request: { ...withdrawal } };
  }

  public updateWithdrawalStatus(
    withdrawalId: string,
    status: WithdrawalStatus,
    payoutReference?: string | null
  ): WithdrawalRequest | null {
    const existing = this.store.withdrawalRequests[String(withdrawalId)];
    if (!existing) return null;
    existing.status = status;
    if (payoutReference !== undefined) {
      existing.payout_reference = payoutReference;
    }
    existing.updated_at = new Date().toISOString();
    this.persist();
    return { ...existing };
  }

  public listAllWithdrawalRequests(): WithdrawalRequest[] {
    return Object.values(this.store.withdrawalRequests).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  public hasAdminNotificationBeenSent(dedupKey: string): boolean {
    return Boolean(this.store.processedAdminNotifications[dedupKey]);
  }

  public markAdminNotificationSent(entry: AdminNotificationEntry) {
    this.store.processedAdminNotifications[entry.dedup_key] = entry.created_at;
    this.store.adminNotifications.unshift(entry);
    if (this.store.adminNotifications.length > 100) {
      this.store.adminNotifications = this.store.adminNotifications.slice(0, 100);
    }
    this.persist();
  }

  public getRecentAdminNotifications(limit = 50): AdminNotificationEntry[] {
    return (this.store.adminNotifications || []).slice(0, limit);
  }

  public getCustomerByPaymentId(paymentId: string): CustomerRecord | null {
    for (const key of Object.keys(this.store.customers)) {
      const cust = this.store.customers[key];
      if (cust.payment_id === paymentId) {
        return { ...cust };
      }
    }
    return null;
  }

  public getCustomerByTicketNumber(ticketNumber: string): CustomerRecord | null {
    for (const key of Object.keys(this.store.customers)) {
      const cust = this.store.customers[key];
      if (cust.ticket_number === ticketNumber) {
        return { ...cust };
      }
    }
    return null;
  }

  public updateCustomer(
    telegramUserId: string,
    updates: Partial<
      Pick<
        CustomerRecord,
        | 'telegram_chat_id'
        | 'username'
        | 'name'
        | 'phone'
        | 'address'
        | 'conversation_state'
        | 'payment_id'
        | 'payment_status'
        | 'payment_amount'
        | 'ticket_number'
        | 'referral_code'
        | 'referred_by'
        | 'referred_by_user_id'
        | 'referred_at'
        | 'referral_count'
        | 'verified_referral_count'
        | 'verified_referral_bonus'
      >
    >
  ): CustomerRecord {
    const uid = String(telegramUserId);
    const current = this.store.customers[uid];
    if (!current) {
      throw new Error(`Customer with telegram_user_id=${uid} not found`);
    }

    const updated: CustomerRecord = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    this.store.customers[uid] = updated;
    this.persist();
    return { ...updated };
  }

  public allocateNextTicketNumber(): string {
    let candidate = '';
    do {
      this.store.ticketSequence += 1;
      const padded = String(this.store.ticketSequence).padStart(6, '0');
      candidate = `DB2026-${padded}`;
    } while (this.getCustomerByTicketNumber(candidate) !== null);

    this.persist();
    return candidate;
  }

  public getProcessedWebhookTicket(paymentId: string): string | null {
    return this.store.processedWebhooks[paymentId] || null;
  }

  public markWebhookProcessed(paymentId: string, ticketNumber: string) {
    this.store.processedWebhooks[paymentId] = ticketNumber;
    this.persist();
  }

  public listAllCustomers(): CustomerRecord[] {
    return Object.values(this.store.customers).sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  public appendChatMessage(chatId: string, msg: OutgoingBotMessage) {
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

  public getChatHistory(chatId: string): OutgoingBotMessage[] {
    return this.store.chatHistories[String(chatId)] || [];
  }

  public clearChatHistory(chatId: string) {
    delete this.store.chatHistories[String(chatId)];
    this.persist();
  }

  public resetCustomerForTesting(telegramUserId: string) {
    const uid = String(telegramUserId);
    delete this.store.customers[uid];
    delete this.store.chatHistories[uid];
    delete this.store.processedReferrals[uid];
    for (const wid of Object.keys(this.store.withdrawalRequests)) {
      if (this.store.withdrawalRequests[wid].telegram_user_id === uid) {
        delete this.store.withdrawalRequests[wid];
      }
    }
    for (const k of Object.keys(this.store.processedAdminNotifications)) {
      if (k.includes(uid)) {
        delete this.store.processedAdminNotifications[k];
      }
    }
    this.persist();
  }

  public getSQLSchemaDDL(): string {
    return `-- Production SQL Schema for DiwaliBigdeal Telegram Bot
CREATE TABLE IF NOT EXISTS customers (
  telegram_user_id VARCHAR(64) PRIMARY KEY,
  telegram_chat_id VARCHAR(64) NOT NULL,
  username VARCHAR(128),
  name VARCHAR(255),
  phone VARCHAR(32),
  address TEXT,
  conversation_state VARCHAR(64) NOT NULL DEFAULT 'idle',
  payment_id VARCHAR(128) UNIQUE,
  payment_status VARCHAR(32) NOT NULL DEFAULT 'UNPAID',
  payment_amount INTEGER NOT NULL DEFAULT 100,
  ticket_number VARCHAR(32) UNIQUE,
  referral_code VARCHAR(32) UNIQUE NOT NULL,
  referred_by VARCHAR(32),
  referred_by_user_id VARCHAR(64),
  referred_at TIMESTAMP WITH TIME ZONE,
  referral_count INTEGER NOT NULL DEFAULT 0,
  verified_referral_count INTEGER NOT NULL DEFAULT 0,
  verified_referral_bonus INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id VARCHAR(32) PRIMARY KEY,
  telegram_user_id VARCHAR(64) NOT NULL REFERENCES customers(telegram_user_id),
  referral_code VARCHAR(32) NOT NULL,
  amount INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL',
  payout_reference VARCHAR(128),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_payment_id ON customers(payment_id);
CREATE INDEX IF NOT EXISTS idx_customers_ticket_number ON customers(ticket_number);
CREATE INDEX IF NOT EXISTS idx_customers_referral_code ON customers(referral_code);
CREATE INDEX IF NOT EXISTS idx_customers_referred_by ON customers(referred_by);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawal_requests(telegram_user_id);`;
  }
}

export const db = new DatabaseManager();
