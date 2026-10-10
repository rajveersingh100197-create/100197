/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { CONFIG } from './config';
import { db } from './db';
import { logger } from './logger';
import {
  ConversationState,
  CustomerRecord,
  PaymentCreationResult,
  PaymentStatus,
} from './types';
import { issueVerifiedTicket } from './ticketGenerator';
import {
  createTelegramStarsInvoiceLink,
  MAIN_MENU_INLINE_KEYBOARD,
  sendTelegramMessage,
} from './telegramService';

/**
 * Payment Service & Telegram Stars Verification
 *
 * Rules Enforced:
 * 1. Create a ₹199 payment request (using Telegram Stars XTR invoice) when customer taps "✅ Confirm & Pay ₹199".
 * 2. Do NOT mark the entry as paid merely because the customer clicked the payment button.
 * 3. Verify payment via Telegram's server-side `pre_checkout_query` + `message.successful_payment` update
 *    (or signed server-side `/api/payment/webhook`).
 * 4. Only after receiving a verified successful payment:
 *    - payment_status = PAID
 *    - generate a unique ticket number (DB2026-000001...)
 *    - send the exact automatic Telegram confirmation message to the same Telegram chat.
 */

export async function createPaymentOrderForCustomer(
  customer: CustomerRecord
): Promise<PaymentCreationResult> {
  const amountInRupees = CONFIG.CAMPAIGN_ENTRY_FEE; // 199
  const starsAmount = CONFIG.TELEGRAM_STARS_AMOUNT; // 199 XTR Stars

  // Reuse existing PENDING payment_id if already in waiting_for_payment state and unpaid
  let paymentId = customer.payment_id;
  if (!paymentId || customer.payment_status === PaymentStatus.FAILED) {
    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    paymentId = `pay_DB2026_${randomSuffix}`;
  }

  let paymentUrl = `${CONFIG.APP_URL}/api/payment/checkout/${paymentId}`;

  // Attempt to create a native Telegram Stars invoice link (currency: "XTR", provider_token: "")
  // When TELEGRAM_BOT_TOKEN is configured, this returns a native `https://t.me/$...` invoice link
  // that opens the Telegram Stars payment sheet right inside the Telegram app!
  const starsInvoiceUrl = await createTelegramStarsInvoiceLink(paymentId, starsAmount);
  if (starsInvoiceUrl) {
    paymentUrl = starsInvoiceUrl;
  }

  // Persist payment_id and set status to PENDING (never PAID on creation)
  db.updateCustomer(customer.telegram_user_id, {
    payment_id: paymentId,
    payment_status: PaymentStatus.PENDING,
    payment_amount: amountInRupees,
    conversation_state: ConversationState.WAITING_FOR_PAYMENT,
  });

  logger.info('PaymentService', `Telegram Stars payment request created for ₹${amountInRupees}`, {
    telegram_user_id: customer.telegram_user_id,
    payment_id: paymentId,
    stars_amount: starsAmount,
    hasNativeStarsUrl: Boolean(starsInvoiceUrl),
    payment_status: PaymentStatus.PENDING,
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

/**
 * Generates an HMAC-SHA256 signature for a raw webhook payload using PAYMENT_WEBHOOK_SECRET.
 */
export function computeWebhookSignature(
  rawBody: string,
  secret = CONFIG.PAYMENT_WEBHOOK_SECRET
): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Verifies the incoming payment webhook HMAC-SHA256 signature using constant-time comparison.
 */
export function verifyPaymentWebhookSignature(
  rawBody: string,
  receivedSignature?: string
): boolean {
  if (!receivedSignature) {
    return false;
  }
  try {
    const expectedSignature = computeWebhookSignature(rawBody, CONFIG.PAYMENT_WEBHOOK_SECRET);
    const a = Buffer.from(receivedSignature, 'utf8');
    const b = Buffer.from(expectedSignature, 'utf8');
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface WebhookProcessInput {
  paymentId: string;
  eventStatus: 'PAID' | 'FAILED';
  amountInRupees: number;
  telegramPaymentChargeId?: string;
}

/**
 * Processes a verified payment event (from Telegram `successful_payment` update or verified webhook):
 * - If FAILED: marks payment_status = FAILED, never issues a ticket.
 * - If PAID: atomically marks payment_status = PAID, generates unique ticket DB2026-XXXXXX (idempotent),
 *   sets conversation_state = completed, and sends the exact automatic Telegram confirmation message.
 */
export async function processVerifiedPaymentWebhook(input: WebhookProcessInput) {
  const { paymentId, eventStatus, amountInRupees, telegramPaymentChargeId } = input;

  const customer = db.getCustomerByPaymentId(paymentId);
  if (!customer) {
    throw new Error(`No customer found for payment_id: ${paymentId}`);
  }

  if (eventStatus === 'FAILED') {
    const updated = db.updateCustomer(customer.telegram_user_id, {
      payment_status: PaymentStatus.FAILED,
    });
    logger.warn('PaymentVerification', `Payment marked as FAILED for payment_id=${paymentId}`, {
      telegram_user_id: customer.telegram_user_id,
    });
    return {
      success: true,
      status: PaymentStatus.FAILED,
      ticket_number: null,
      already_processed: false,
      customer: updated,
    };
  }

  // Verified successful payment -> Issue unique ticket atomically & idempotently
  const issuance = issueVerifiedTicket(paymentId, PaymentStatus.PAID, amountInRupees);

  // Only send the Telegram success confirmation message on first verified webhook processing
  // (Prevents duplicate messages if a webhook is retried)
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
      telegram_payment_charge_id: telegramPaymentChargeId || 'webhook',
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
