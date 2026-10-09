/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { CONFIG } from './config.js';
import { db } from './db.js';
import { logger } from './logger.js';
import {
  ConversationState,
  CustomerRecord,
  PaymentCreationResult,
  PaymentStatus,
} from './types.js';
import { issueVerifiedTicket } from './ticketGenerator.js';
import { MAIN_MENU_INLINE_KEYBOARD, sendTelegramMessage } from './telegramService.js';

/**
 * Payment Service & Webhook Verification
 *
 * Rules Enforced:
 * 1. Create a ₹199 payment request when customer taps "✅ Confirm & Pay ₹199".
 * 2. Do NOT mark the entry as paid merely because the customer clicked the payment button.
 * 3. Verify payment using the payment provider's server-side webhook/API (HMAC-SHA256 signature validation).
 * 4. Only after receiving a verified successful payment:
 *    - payment_status = PAID
 *    - generate a unique ticket number (DB2026-000001...)
 *    - send the exact automatic Telegram confirmation message to the same Telegram chat.
 */

export async function createPaymentOrderForCustomer(
  customer: CustomerRecord
): Promise<PaymentCreationResult> {
  const amountInRupees = CONFIG.CAMPAIGN_ENTRY_FEE; // 199

  // Reuse existing PENDING payment_id if already in waiting_for_payment state and unpaid
  let paymentId = customer.payment_id;
  if (!paymentId || customer.payment_status === PaymentStatus.FAILED) {
    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    paymentId = `pay_DB2026_${randomSuffix}`;
  }

  let paymentUrl = `${CONFIG.APP_URL}/api/payment/checkout/${paymentId}`;

  // If live Razorpay credentials are configured, create a real Razorpay Payment Link via server-side API
  if (
    CONFIG.PAYMENT_PROVIDER === 'razorpay' &&
    CONFIG.PAYMENT_KEY_ID &&
    CONFIG.PAYMENT_KEY_ID !== 'YOUR_PAYMENT_KEY_ID' &&
    CONFIG.PAYMENT_KEY_SECRET &&
    CONFIG.PAYMENT_KEY_SECRET !== 'YOUR_PAYMENT_KEY_SECRET'
  ) {
    try {
      const authHeader = Buffer.from(
        `${CONFIG.PAYMENT_KEY_ID}:${CONFIG.PAYMENT_KEY_SECRET}`
      ).toString('base64');

      const response = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountInRupees * 100, // Razorpay expects paise (19900)
          currency: 'INR',
          accept_partial: false,
          description: 'DiwaliBigdeal ₹199 Campaign Entry',
          customer: {
            name: customer.name || 'DiwaliBigdeal Participant',
            contact: customer.phone ? `+91${customer.phone.replace(/^\+?91/, '')}` : undefined,
          },
          notify: {
            sms: false,
            email: false,
          },
          reminder_enable: false,
          notes: {
            telegram_user_id: customer.telegram_user_id,
            telegram_chat_id: customer.telegram_chat_id,
            campaign: 'DiwaliBigdeal',
          },
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { id: string; short_url: string };
        paymentId = data.id;
        paymentUrl = data.short_url;
        logger.info('PaymentService', `Created live Razorpay payment link ${paymentId}`, {
          telegram_user_id: customer.telegram_user_id,
          short_url: paymentUrl,
        });
      } else {
        const errText = await response.text();
        logger.warn('PaymentService', 'Razorpay API returned non-200; using internal payment link', {
          status: response.status,
          body: errText,
        });
      }
    } catch (err) {
      logger.error('PaymentService', 'Error calling Razorpay API; falling back to hosted link', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Persist payment_id and set status to PENDING (never PAID on creation)
  db.updateCustomer(customer.telegram_user_id, {
    payment_id: paymentId,
    payment_status: PaymentStatus.PENDING,
    payment_amount: amountInRupees,
    conversation_state: ConversationState.WAITING_FOR_PAYMENT,
  });

  logger.info('PaymentService', `Payment request created for ₹${amountInRupees}`, {
    telegram_user_id: customer.telegram_user_id,
    payment_id: paymentId,
    payment_status: PaymentStatus.PENDING,
  });

  return {
    payment_id: paymentId,
    payment_amount: amountInRupees,
    payment_url: paymentUrl,
    provider: CONFIG.PAYMENT_PROVIDER,
    status: PaymentStatus.PENDING,
    created_at: new Date().toISOString(),
  };
}

/**
 * Generates an HMAC-SHA256 signature for a raw webhook payload using PAYMENT_WEBHOOK_SECRET.
 */
export function computeWebhookSignature(rawBody: string, secret = CONFIG.PAYMENT_WEBHOOK_SECRET): string {
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
  providerEventId?: string;
}

/**
 * Processes a verified payment webhook event:
 * - If FAILED: marks payment_status = FAILED, never issues a ticket.
 * - If PAID: atomically marks payment_status = PAID, generates unique ticket DB2026-XXXXXX (idempotent),
 *   sets conversation_state = completed, and sends the exact automatic Telegram confirmation message.
 */
export async function processVerifiedPaymentWebhook(input: WebhookProcessInput) {
  const { paymentId, eventStatus, amountInRupees } = input;

  const customer = db.getCustomerByPaymentId(paymentId);
  if (!customer) {
    throw new Error(`No customer found for payment_id: ${paymentId}`);
  }

  if (eventStatus === 'FAILED') {
    const updated = db.updateCustomer(customer.telegram_user_id, {
      payment_status: PaymentStatus.FAILED,
    });
    logger.warn('PaymentWebhook', `Payment marked as FAILED for payment_id=${paymentId}`, {
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
  // (Prevents duplicate messages if the payment provider retries the webhook)
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
  }

  return {
    success: true,
    status: PaymentStatus.PAID,
    ticket_number: issuance.ticketNumber,
    already_processed: issuance.alreadyIssued,
    customer: issuance.customer,
  };
}
