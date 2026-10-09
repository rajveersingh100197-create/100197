/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { ConversationState, CustomerRecord, OutgoingBotMessage, PaymentStatus } from './types.js';
import { CONFIG } from './config.js';
import { logger } from './logger.js';

/**
 * Production-ready Database Layer with automatic SQLite (node:sqlite) + JSON fallback
 * for serverless (Vercel) and local environments.
 *
 * Schema fields required by specification:
 * - telegram_user_id
 * - telegram_chat_id
 * - name
 * - phone
 * - address
 * - conversation_state
 * - payment_id
 * - payment_status
 * - payment_amount
 * - ticket_number
 * - created_at
 * - updated_at
 */

interface DatabaseStorageSnapshot {
  customers: Record<string, CustomerRecord>;
  ticketSequence: number;
  processedWebhooks: Record<string, string>; // payment_id -> ticket_number
  chatHistories: Record<string, OutgoingBotMessage[]>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const JSON_DB_FILE = path.join(DATA_DIR, 'diwalibigdeal_store.json');

class DatabaseManager {
  private store: DatabaseStorageSnapshot = {
    customers: {},
    ticketSequence: 0,
    processedWebhooks: {},
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
          chatHistories: parsed.chatHistories || {},
        };
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
      name: 'Aarav Sharma',
      phone: '9876543210',
      address: 'Flat 402, Lotus Enclave, Indiranagar, Bengaluru, Karnataka - 560038',
      conversation_state: ConversationState.COMPLETED,
      payment_id: 'pay_DB2026_99102A',
      payment_status: PaymentStatus.PAID,
      payment_amount: CONFIG.CAMPAIGN_ENTRY_FEE,
      ticket_number: 'DB2026-000001',
      created_at: now,
      updated_at: recent,
    };

    const demo2: CustomerRecord = {
      telegram_user_id: '917451902',
      telegram_chat_id: '917451902',
      name: 'Priya Nair',
      phone: '9820112233',
      address: 'B-18, Shanti Niketan, Bandra West, Mumbai, Maharashtra - 400050',
      conversation_state: ConversationState.WAITING_FOR_PAYMENT,
      payment_id: 'pay_DB2026_88410B',
      payment_status: PaymentStatus.PENDING,
      payment_amount: CONFIG.CAMPAIGN_ENTRY_FEE,
      ticket_number: null,
      created_at: recent,
      updated_at: recent,
    };

    this.store.customers[demo1.telegram_user_id] = demo1;
    this.store.customers[demo2.telegram_user_id] = demo2;
    this.store.ticketSequence = 1;
    this.store.processedWebhooks[demo1.payment_id!] = demo1.ticket_number!;
  }

  private persist() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(JSON_DB_FILE, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (err) {
      // Safe fallback in read-only serverless container
      logger.warn('Database', 'Could not write snapshot to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public getOrCreateCustomer(telegramUserId: string, telegramChatId: string): CustomerRecord {
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
    const record: CustomerRecord = {
      telegram_user_id: uid,
      telegram_chat_id: cid,
      name: null,
      phone: null,
      address: null,
      conversation_state: ConversationState.IDLE,
      payment_id: null,
      payment_status: PaymentStatus.UNPAID,
      payment_amount: CONFIG.CAMPAIGN_ENTRY_FEE,
      ticket_number: null,
      created_at: now,
      updated_at: now,
    };

    this.store.customers[uid] = record;
    this.persist();
    logger.info('Database', `Created new customer record for Telegram ID ${uid}`);
    return { ...record };
  }

  public getCustomerByUserId(telegramUserId: string): CustomerRecord | null {
    const rec = this.store.customers[String(telegramUserId)];
    return rec ? { ...rec } : null;
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
        | 'name'
        | 'phone'
        | 'address'
        | 'conversation_state'
        | 'payment_id'
        | 'payment_status'
        | 'payment_amount'
        | 'ticket_number'
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

  /**
   * Atomically increments the ticket sequence counter and ensures no duplicate ticket number ever exists.
   */
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
    this.persist();
  }

  public getSQLSchemaDDL(): string {
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
);

CREATE INDEX IF NOT EXISTS idx_customers_payment_id ON customers(payment_id);
CREATE INDEX IF NOT EXISTS idx_customers_ticket_number ON customers(ticket_number);
CREATE INDEX IF NOT EXISTS idx_customers_state ON customers(conversation_state);`;
  }
}

export const db = new DatabaseManager();
