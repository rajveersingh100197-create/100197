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

/**
 * Conversation & State Machine Manager for "DiwaliBigdeal"
 *
 * Strictly implements:
 * - Displayed entry price: "100 Telegram Stars ⭐️" (never ₹199)
 * - Telegram Stars invoice: currency "XTR", prices: [{"label":"DiwaliBigdeal Entry","amount":100}]
 * - pre_checkout_query validation: currency === "XTR" and total_amount === 100
 * - successful_payment validation: currency === "XTR" and total_amount === 100
 * - Unique DB2026-XXXXXX ticket generated ONLY after verified successful_payment (with duplicate prevention)
 * - Zero Cancel buttons in confirmation or payment flow.
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
      'Entry Fee: 100 Telegram Stars ⭐️',
      'Win Mahindra Thar ROXX, Double-Door Refrigerator, Smart LED TV & Multiple Cash Prizes!',
      '',
      'Please choose an option below:',
    ].join('\n'),

  joinIntro: () =>
    [
      '🎟️ DIWALI BIGDEAL',
      '',
      'Entry Fee: 100 Telegram Stars ⭐️',
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
      '🎟️ Entry Fee: 100 Telegram Stars ⭐️',
      '',
      'Are these details correct?',
    ].join('\n'),

  paymentPrompt: () =>
    [
      '💳 PAYMENT',
      '',
      'Amount: 100 Telegram Stars ⭐️',
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
      '💰 Entry: 100 Telegram Stars ⭐️',
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
      '🎟️ Entry Fee: 100 Telegram Stars ⭐️',
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
 * - ✅ Confirm & Pay 100 Telegram Stars ⭐️
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
      [
        {
          text: '✅ Confirm & Pay 100 Telegram Stars ⭐️',
          callback_data: 'action_confirm_pay_199',
        },
      ],
      [{ text: '✏️ Edit Details', callback_data: 'action_edit_details' }],
    ],
  });
}

/**
 * Sends the Payment Screen with ONLY:
 * - [💰 Pay 100 Telegram Stars ⭐️]
 * (NO Cancel button)
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
              text: '💰 Pay 100 Telegram Stars ⭐️',
              url: paymentOrder.payment_url,
            }
          : {
              text: '💰 Pay 100 Telegram Stars ⭐️',
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
      inline_keyboard: [
        [{ text: '🎟️ Join Entry (100 Telegram Stars ⭐️)', callback_data: 'menu_join_199' }],
      ],
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
 * - `pre_checkout_query` (Validates currency === "XTR" and total_amount === 100)
 * - `message.successful_payment` (Validates currency === "XTR" and total_amount === 100, then issues unique ticket)
 * - `callback_query` (Inline keyboard button taps)
 * - `message.text` (Standard text messages & commands)
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<CustomerRecord | null> {
  // 0. Handle Telegram Stars `pre_checkout_query`
  if (update.pre_checkout_query) {
    const pcq = update.pre_checkout_query;
    const paymentId = pcq.invoice_payload;

    // Validate currency === "XTR" and total_amount === 100
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
      logger.warn('TelegramStars', `Rejected pre_checkout_query: unknown payload ${paymentId}`);
      await answerTelegramPreCheckoutQuery(
        pcq.id,
        false,
        'Payment session expired or not found. Please tap Confirm & Pay 100 Telegram Stars ⭐️ again.'
      );
      return null;
    }

    // Prevent double payment if customer already has a confirmed ticket
    if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
      logger.info(
        'TelegramStars',
        `Rejected pre_checkout_query: customer ${customer.telegram_user_id} already holds confirmed ticket ${customer.ticket_number}`
      );
      await answerTelegramPreCheckoutQuery(
        pcq.id,
        false,
        `You already have a confirmed entry (Ticket: ${customer.ticket_number}).`
      );
      return customer;
    }

    logger.info('TelegramStars', `Approved pre_checkout_query for ${paymentId} (100 XTR)`, {
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

    // Strictly validate currency === "XTR" and total_amount === 100
    if (sp.currency !== 'XTR' || Number(sp.total_amount) !== 100) {
      logger.security(
        'TelegramStars',
        `Rejected successful_payment due to currency/amount mismatch`,
        {
          telegram_user_id: userId,
          payment_id: paymentId,
          currency: sp.currency,
          total_amount: sp.total_amount,
        }
      );
      return db.getCustomerByUserId(userId);
    }

    logger.webhook('TelegramStars', `Received verified successful_payment (100 XTR) from Telegram`, {
      telegram_user_id: userId,
      payment_id: paymentId,
      currency: sp.currency,
      total_amount: sp.total_amount,
      charge_id: sp.telegram_payment_charge_id,
    });

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
    const chatId = String(cb.message?.chat.id || cb.from.id);
    const data = (cb.data || '').trim();

    const buttonLabelMap: Record<string, string> = {
      menu_join_199: '🎟️ Join Entry (100 Telegram Stars ⭐️)',
      action_continue_join: '🚀 Continue',
      action_confirm_pay_199: '✅ Confirm & Pay 100 Telegram Stars ⭐️',
      action_edit_details: '✏️ Edit Details',
      menu_my_ticket: '🎫 My Ticket',
      menu_prize_details: '🏆 Prize Details',
      menu_support: '🆘 Support',
    };

    const tapDisplay =
      buttonLabelMap[data] ||
      (data.startsWith('pay_link_') ? '💰 Pay 100 Telegram Stars ⭐️' : data);

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
        `Customer ${userId} clicked Pay button (${paymentId}). Dispatching 100 XTR Telegram Stars invoice if live token configured; awaiting verified successful_payment.`
      );
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

    if (
      text === '🎟️ Join Entry (100 Telegram Stars ⭐️)' ||
      text === '🎟️ Join ₹199 Entry' ||
      text === '/join'
    ) {
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
