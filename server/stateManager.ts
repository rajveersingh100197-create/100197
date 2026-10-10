/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { db } from './db';
import { logger } from './logger';
import {
  ConversationState,
  CustomerRecord,
  PaymentStatus,
  TelegramUpdate,
} from './types';
import {
  answerTelegramCallbackQuery,
  answerTelegramPreCheckoutQuery,
  MAIN_MENU_INLINE_KEYBOARD,
  sendTelegramMessage,
  sendTelegramStarsInvoice,
} from './telegramService';
import {
  createPaymentOrderForCustomer,
  processVerifiedPaymentWebhook,
} from './paymentService';
import { CONFIG } from './config';

/**
 * Conversation & State Machine Manager for "DiwaliBigdeal"
 *
 * Strictly implements all required flows, messages, buttons, and state transitions:
 * - States:
 *   idle
 *   waiting_for_name
 *   waiting_for_phone
 *   waiting_for_address
 *   waiting_for_confirmation
 *   waiting_for_payment
 *   completed
 *
 * - Supports native Telegram Stars (`pre_checkout_query` & `message.successful_payment`).
 * - Zero Cancel buttons in confirmation or payment flow.
 * - Remembers customer's current state across sessions.
 */

export function validateIndianMobileNumber(input: string): {
  valid: boolean;
  normalized: string;
} {
  const cleaned = input.replace(/[\s\-()]/g, '');
  const match = cleaned.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  if (!match) {
    return { valid: false, normalized: input.trim() };
  }
  return { valid: true, normalized: match[1] };
}

export const BOT_MESSAGES = {
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

  confirmDetails: (name: string, phone: string, address: string) =>
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

  myTicketConfirmed: (ticketNumber: string, name: string, phone: string) =>
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

/**
 * Sends the Confirmation Screen with ONLY:
 * - ✅ Confirm & Pay ₹199
 * - ✏️ Edit Details
 * (NO Cancel button)
 */
async function sendConfirmationScreen(customer: CustomerRecord) {
  const text = BOT_MESSAGES.confirmDetails(
    customer.name || '',
    customer.phone || '',
    customer.address || ''
  );

  await sendTelegramMessage(customer.telegram_chat_id, text, {
    inline_keyboard: [
      [{ text: '✅ Confirm & Pay ₹199', callback_data: 'action_confirm_pay_199' }],
      [{ text: '✏️ Edit Details', callback_data: 'action_edit_details' }],
    ],
  });
}

/**
 * Sends the Payment Screen with ONLY:
 * - [💰 PAY ₹199]
 * (NO Cancel button)
 *
 * Uses a native Telegram Stars invoice URL (`t.me/$...`) when created via `createInvoiceLink`,
 * or triggers `sendInvoice` via callback `pay_link_<payment_id>` if `createInvoiceLink` was not available.
 */
async function sendPaymentScreen(customer: CustomerRecord) {
  const paymentOrder = await createPaymentOrderForCustomer(customer);
  const text = BOT_MESSAGES.paymentPrompt();

  const isNativeTelegramStarsLink = paymentOrder.payment_url.startsWith('https://t.me/$');

  await sendTelegramMessage(customer.telegram_chat_id, text, {
    inline_keyboard: [
      [
        isNativeTelegramStarsLink
          ? {
              text: '💰 PAY ₹199',
              url: paymentOrder.payment_url,
            }
          : {
              text: '💰 PAY ₹199',
              callback_data: `pay_link_${paymentOrder.payment_id}`,
            },
      ],
    ],
  });
}

async function handleJoinEntryTrigger(customer: CustomerRecord) {
  if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
    await handleMyTicketTrigger(customer);
    return;
  }

  await sendTelegramMessage(customer.telegram_chat_id, BOT_MESSAGES.joinIntro(), {
    inline_keyboard: [[{ text: '🚀 Continue', callback_data: 'action_continue_join' }]],
  });
}

async function handleMyTicketTrigger(customer: CustomerRecord) {
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

async function handlePrizeDetailsTrigger(customer: CustomerRecord) {
  await sendTelegramMessage(
    customer.telegram_chat_id,
    BOT_MESSAGES.prizeDetails(),
    MAIN_MENU_INLINE_KEYBOARD
  );
}

async function handleSupportTrigger(customer: CustomerRecord) {
  await sendTelegramMessage(
    customer.telegram_chat_id,
    BOT_MESSAGES.supportMessage(),
    MAIN_MENU_INLINE_KEYBOARD
  );
}

/**
 * Main entry point for processing any incoming Telegram Update:
 * - `pre_checkout_query` (Telegram Stars pre-checkout verification)
 * - `message.successful_payment` (Telegram Stars verified payment confirmation)
 * - `callback_query` (Inline keyboard button taps)
 * - `message.text` (Standard text messages & commands)
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<CustomerRecord | null> {
  // 0. Handle Telegram Stars `pre_checkout_query`
  if (update.pre_checkout_query) {
    const pcq = update.pre_checkout_query;
    const paymentId = pcq.invoice_payload;
    const customer = db.getCustomerByPaymentId(paymentId);

    if (!customer) {
      logger.warn('TelegramStars', `Rejected pre_checkout_query: unknown payload ${paymentId}`);
      await answerTelegramPreCheckoutQuery(
        pcq.id,
        false,
        'Payment session expired or not found. Please tap Confirm & Pay ₹199 again.'
      );
      return null;
    }

    logger.info('TelegramStars', `Approved pre_checkout_query for ${paymentId}`, {
      telegram_user_id: customer.telegram_user_id,
      currency: pcq.currency,
      total_amount: pcq.total_amount,
    });
    await answerTelegramPreCheckoutQuery(pcq.id, true);
    return customer;
  }

  // 1. Handle Telegram Stars `message.successful_payment`
  if (update.message?.successful_payment) {
    const msg = update.message;
    const sp = msg.successful_payment!;
    const userId = String(msg.from?.id || msg.chat.id);
    const chatId = String(msg.chat.id);
    const paymentId = sp.invoice_payload;

    db.getOrCreateCustomer(userId, chatId);

    logger.webhook('TelegramStars', `Received verified successful_payment from Telegram`, {
      telegram_user_id: userId,
      payment_id: paymentId,
      currency: sp.currency,
      total_amount: sp.total_amount,
      charge_id: sp.telegram_payment_charge_id,
    });

    const result = await processVerifiedPaymentWebhook({
      paymentId,
      eventStatus: 'PAID',
      amountInRupees: CONFIG.CAMPAIGN_ENTRY_FEE,
      telegramPaymentChargeId: sp.telegram_payment_charge_id,
    });

    return result.customer;
  }

  // 2. Handle Inline Keyboard Callback Queries
  if (update.callback_query) {
    const cb = update.callback_query;
    const userId = String(cb.from.id);
    const chatId = String(cb.message?.chat.id || cb.from.id);
    const data = (cb.data || '').trim();

    const buttonLabelMap: Record<string, string> = {
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
    logger.info('StateManager', `Callback query "${data}" from user ${userId}`, {
      currentState: customer.conversation_state,
    });

    if (data === 'menu_join_199') {
      await handleJoinEntryTrigger(customer);
      return db.getCustomerByUserId(userId);
    }

    if (data === 'action_continue_join') {
      customer = db.updateCustomer(userId, {
        conversation_state: ConversationState.WAITING_FOR_NAME,
      });
      await sendTelegramMessage(chatId, BOT_MESSAGES.askFullName());
      return customer;
    }

    if (data === 'action_edit_details') {
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
      // IMPORTANT: Do NOT mark the entry as paid merely because the customer clicked the payment button.
      const paymentId = data.replace('pay_link_', '');
      logger.info(
        'StateManager',
        `Customer ${userId} clicked Pay button (${paymentId}). Dispatching Telegram Stars invoice if live token configured; awaiting verified payment.`
      );
      await sendTelegramStarsInvoice(chatId, paymentId, CONFIG.TELEGRAM_STARS_AMOUNT);
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

  // 3. Handle Standard Text Messages
  if (update.message && typeof update.message.text === 'string') {
    const msg = update.message;
    const userId = String(msg.from?.id || msg.chat.id);
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
    logger.info('StateManager', `Message from user ${userId} in state=${customer.conversation_state}`, {
      text,
    });

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
