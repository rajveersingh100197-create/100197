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
 * Payment Service & Telegram Stars (100 XTR) Verification
 *
 * Rules Enforced:
 * 1. Create a 100 Telegram Stars ⭐️ payment request (currency="XTR", prices=[{"label":"DiwaliBigdeal Entry","amount":100}]).
 * 2. Do NOT mark the entry as paid merely because the customer clicked the payment button.
 * 3. Validate `pre_checkout_query` (currency === "XTR" and total_amount === 100) and `message.successful_payment`
 *    (currency === "XTR" and total_amount === 100).
 * 4. Only after receiving a verified successful payment:
 *    - payment_status = PAID
 *    - generate a unique ticket number (DB2026-000001...)
 *    - prevent duplicate tickets for the same payment
 *    - send the automatic Telegram confirmation message to the same Telegram chat.
 */

export async function createPaymentOrderForCustomer(
  customer: CustomerRecord
): Promise<PaymentCreationResult> {
  const starsAmount = 100;

  let paymentId = customer.payment_id;
  if (!paymentId || customer.payment_status === PaymentStatus.FAILED) {
    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    paymentId = `pay_DB2026_${randomSuffix}`;
  }

  let paymentUrl = `${CONFIG.APP_URL}/api/payment/checkout/${paymentId}`;

  const starsInvoiceUrl = await createTelegramStarsInvoiceLink(paymentId);
  if (starsInvoiceUrl) {
    paymentUrl = starsInvoiceUrl;
  }

  // Persist payment_id and set status to PENDING (never PAID on creation)
  db.updateCustomer(customer.telegram_user_id, {
    payment_id: paymentId,
    payment_status: PaymentStatus.PENDING,
    payment_amount: starsAmount,
    conversation_state: ConversationState.WAITING_FOR_PAYMENT,
  });

  logger.info('PaymentService', `Telegram Stars payment request created for 100 Telegram Stars ⭐️`, {
    telegram_user_id: customer.telegram_user_id,
    payment_id: paymentId,
    currency: 'XTR',
    stars_amount: starsAmount,
    hasNativeStarsUrl: Boolean(starsInvoiceUrl),
    payment_status: PaymentStatus.PENDING,
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

export function computeWebhookSignature(
  rawBody: string,
  secret = CONFIG.PAYMENT_WEBHOOK_SECRET
): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

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
  currency?: string;
  totalAmount?: number;
  telegramPaymentChargeId?: string;
}

/**
 * Processes a verified Telegram Stars payment event:
 * - Validates currency === "XTR" and totalAmount === 100
 * - If FAILED: marks payment_status = FAILED, never issues a ticket.
 * - If PAID: atomically marks payment_status = PAID, generates unique ticket DB2026-XXXXXX (idempotent),
 *   sets conversation_state = completed, and sends the automatic Telegram confirmation message.
 */
export async function processVerifiedPaymentWebhook(input: WebhookProcessInput) {
  const {
    paymentId,
    eventStatus,
    currency = 'XTR',
    totalAmount = 100,
    telegramPaymentChargeId,
  } = input;

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

  if (currency !== 'XTR') {
    logger.security('PaymentVerification', `Rejected payment with invalid currency: ${currency}`, {
      paymentId,
      currency,
    });
    throw new Error(`Invalid payment currency: ${currency}. Expected XTR.`);
  }

  if (Number(totalAmount) !== 100) {
    logger.security(
      'PaymentVerification',
      `Rejected payment with invalid total_amount: ${totalAmount}`,
      { paymentId, totalAmount }
    );
    throw new Error(`Invalid payment amount: ${totalAmount}. Expected exactly 100 Telegram Stars.`);
  }

  // Verified successful payment -> Issue unique ticket atomically & idempotently
  const issuance = issueVerifiedTicket(
    paymentId,
    PaymentStatus.PAID,
    100,
    telegramPaymentChargeId
  );

  // Only send the Telegram success confirmation message on first verified payment processing
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
