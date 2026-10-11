/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ConversationState, CustomerRecord, OutgoingBotMessage, PaymentStatus } from './types';
import { CONFIG } from './config';
import { logger } from './logger';

export interface AdminNotificationEntry {
  id: string;
  dedup_key: string;
  event_type: 'BOT_START' | 'REGISTRATION_SUBMITTED' | 'PAYMENT_VERIFIED' | 'ADMIN_TEST';
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
  adminNotifications: AdminNotificationEntry[];
  chatHistories: Record<string, OutgoingBotMessage[]>;
}

const DATA_DIR =
  process.env.VERCEL === '1'
    ? '/tmp/diwalibigdeal'
    : path.resolve(process.cwd(), 'data');
const JSON_DB_FILE = path.join(DATA_DIR, 'diwalibigdeal_store.json');

export function generateReferralCode(telegramUserId: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(`diwalibigdeal_ref_${telegramUserId}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  return `REF-${hash}`;
}

class DatabaseManager {
  private store: DatabaseStorageSnapshot = {
    customers: {},
    ticketSequence: 0,
    processedWebhooks: {},
    processedAdminNotifications: {},
    processedReferrals: {},
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
          adminNotifications: Array.isArray(parsed.adminNotifications)
            ? parsed.adminNotifications
            : [],
          chatHistories: parsed.chatHistories || {},
        };
        // Ensure existing customer records have referral_code populated
        for (const uid of Object.keys(this.store.customers)) {
          const c = this.store.customers[uid];
          if (!c.referral_code) {
            c.referral_code = generateReferralCode(uid);
          }
          if (typeof c.referral_count !== 'number') {
            c.referral_count = 0;
          }
          if (c.referred_by === undefined) {
            c.referred_by = null;
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
      referral_code: generateReferralCode('918820144'),
      referred_by: null,
      referral_count: 1,
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
      referral_code: generateReferralCode('917451902'),
      referred_by: demo1.referral_code,
      referral_count: 0,
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
      if (!existing.referral_code) {
        existing.referral_code = generateReferralCode(uid);
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
      referral_count: 0,
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
    const clean = String(referralCode || '').trim().toUpperCase();
    if (!clean) return null;
    for (const key of Object.keys(this.store.customers)) {
      const cust = this.store.customers[key];
      if (cust.referral_code && cust.referral_code.toUpperCase() === clean) {
        return { ...cust };
      }
    }
    return null;
  }

  /**
   * Atomically applies a referral code to a user once and prevents self-referrals
   * and duplicate referral counts.
   */
  public applyReferralCodeOnce(
    referredUserId: string,
    rawReferralCode?: string | null
  ): { applied: boolean; referrer: CustomerRecord | null; reason?: string } {
    const uid = String(referredUserId);
    const code = String(rawReferralCode || '').trim().toUpperCase();
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
    referredCustomer.updated_at = now;

    const referrerRecord = this.store.customers[referrer.telegram_user_id];
    referrerRecord.referral_count = (referrerRecord.referral_count || 0) + 1;
    referrerRecord.updated_at = now;

    this.store.processedReferrals[uid] = referrer.referral_code;
    this.persist();

    return { applied: true, referrer: { ...referrerRecord } };
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
        | 'referral_count'
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
  referral_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_payment_id ON customers(payment_id);
CREATE INDEX IF NOT EXISTS idx_customers_ticket_number ON customers(ticket_number);
CREATE INDEX IF NOT EXISTS idx_customers_referral_code ON customers(referral_code);
CREATE INDEX IF NOT EXISTS idx_customers_state ON customers(conversation_state);`;
  }
}

export const db = new DatabaseManager();
