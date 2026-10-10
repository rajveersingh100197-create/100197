/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from './db';
import { ConversationState, CustomerRecord, PaymentStatus } from './types';
import { logger } from './logger';

/**
 * Ticket Generator Service
 *
 * Strictly enforces:
 * 1. Generate a unique ticket number ONLY after verified successful payment.
 * 2. Format: DB2026-000001, DB2026-000002, DB2026-000003...
 * 3. Ticket numbers must never be duplicated.
 * 4. Prevent duplicate ticket generation if the payment webhook is received more than once (idempotency).
 * 5. Never generate a confirmed ticket for an unpaid or failed payment.
 */
export interface TicketIssuanceResult {
  customer: CustomerRecord;
  ticketNumber: string;
  alreadyIssued: boolean;
}

export function issueVerifiedTicket(
  paymentId: string,
  verifiedStatus: PaymentStatus,
  verifiedAmount: number
): TicketIssuanceResult {
  if (verifiedStatus !== PaymentStatus.PAID) {
    logger.security(
      'TicketGenerator',
      `Blocked ticket generation attempt for non-PAID status (${verifiedStatus})`,
      { paymentId, verifiedStatus }
    );
    throw new Error('Cannot generate a confirmed ticket for an unpaid or failed payment.');
  }

  if (verifiedAmount < 199) {
    logger.security(
      'TicketGenerator',
      `Blocked ticket generation due to insufficient amount paid: ₹${verifiedAmount}`,
      { paymentId, verifiedAmount }
    );
    throw new Error(`Invalid payment amount ₹${verifiedAmount}. Expected ₹199.`);
  }

  const customer = db.getCustomerByPaymentId(paymentId);
  if (!customer) {
    logger.error('TicketGenerator', `No customer found matching payment_id=${paymentId}`);
    throw new Error(`Customer record not found for payment_id: ${paymentId}`);
  }

  // Idempotency Check 1: Already processed webhook for this payment_id
  const existingWebhookTicket = db.getProcessedWebhookTicket(paymentId);
  if (existingWebhookTicket && customer.ticket_number) {
    logger.info(
      'TicketGenerator',
      `Idempotent webhook hit for payment_id=${paymentId}. Returning existing ticket ${customer.ticket_number}`,
      { telegram_user_id: customer.telegram_user_id, ticket_number: customer.ticket_number }
    );
    return {
      customer,
      ticketNumber: customer.ticket_number,
      alreadyIssued: true,
    };
  }

  // Idempotency Check 2: Customer already has a confirmed ticket_number and PAID status
  if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
    db.markWebhookProcessed(paymentId, customer.ticket_number);
    logger.info(
      'TicketGenerator',
      `Customer ${customer.telegram_user_id} already has ticket ${customer.ticket_number}. Skipping duplicate generation.`
    );
    return {
      customer,
      ticketNumber: customer.ticket_number,
      alreadyIssued: true,
    };
  }

  // Allocate a unique sequential ticket number (e.g. DB2026-000001)
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
    ticket_number: newTicketNumber,
  });

  return {
    customer: updatedCustomer,
    ticketNumber: newTicketNumber,
    alreadyIssued: false,
  };
}
