/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { db } from './db.js';
import { logger } from './logger.js';
import {
  ConversationState,
  CustomerRecord,
  PaymentStatus,
  TelegramUpdate,
} from './types.js';
import {
  answerTelegramCallbackQuery,
  MAIN_MENU_INLINE_KEYBOARD,
  sendTelegramMessage,
} from './telegramService.js';
import { createPaymentOrderForCustomer } from './paymentService.js';

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
 * - Zero Cancel buttons in confirmation or payment flow.
 * - Remembers customer's current state across sessions.
 */

export function validateIndianMobileNumber(input: string): {
  valid: boolean;
  normalized: string;
} {
  // Strip spaces, dashes, parentheses
  const cleaned = input.replace(/[\s\-()]/g, '');
  // Accept optional +91 or 91 or 0 prefix followed by 10 digits starting with 6-9
  const match = cleaned.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  if (!match) {
    return { valid: false, normalized: input.trim() };
  }
  return { valid: true, normalized: match[1] };
}

/**
 *Exact message templates from user specification
 */
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

  // Notice: Strictly NO Cancel button
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
 */
async function sendPaymentScreen(customer: CustomerRecord) {
  const paymentOrder = await createPaymentOrderForCustomer(customer);
  const text = BOT_MESSAGES.paymentPrompt();

  // Strictly NO Cancel button after Pay Now/payment step.
  await sendTelegramMessage(customer.telegram_chat_id, text, {
    inline_keyboard: [
      [
        {
          text: '💰 PAY ₹199',
          url: paymentOrder.payment_url,
          callback_data: `pay_link_${paymentOrder.payment_id}`,
        },
      ],
    ],
  });
}

/**
 * Handles the "🎟️ Join ₹199 Entry" trigger
 */
async function handleJoinEntryTrigger(customer: CustomerRecord) {
  // If customer already has a confirmed paid ticket, show their ticket or allow viewing
  if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
    await handleMyTicketTrigger(customer);
    return;
  }

  await sendTelegramMessage(customer.telegram_chat_id, BOT_MESSAGES.joinIntro(), {
    inline_keyboard: [[{ text: '🚀 Continue', callback_data: 'action_continue_join' }]],
  });
}

/**
 * Handles the "🎫 My Ticket" trigger
 */
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

/**
 * Handles the "🏆 Prize Details" trigger
 */
async function handlePrizeDetailsTrigger(customer: CustomerRecord) {
  await sendTelegramMessage(
    customer.telegram_chat_id,
    BOT_MESSAGES.prizeDetails(),
    MAIN_MENU_INLINE_KEYBOARD
  );
}

/**
 * Handles the "🆘 Support" trigger
 */
async function handleSupportTrigger(customer: CustomerRecord) {
  await sendTelegramMessage(
    customer.telegram_chat_id,
    BOT_MESSAGES.supportMessage(),
    MAIN_MENU_INLINE_KEYBOARD
  );
}

/**
 * Main entry point for processing any incoming Telegram Update (`message` or `callback_query`).
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<CustomerRecord | null> {
  // 1. Handle Inline Keyboard Callback Queries
  if (update.callback_query) {
    const cb = update.callback_query;
    const userId = String(cb.from.id);
    const chatId = String(cb.message?.chat.id || cb.from.id);
    const data = (cb.data || '').trim();

    // Record user button tap in chat transcript for clear visibility
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
      // Allow customer to update their information and then show confirmation screen again
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
      logger.info(
        'StateManager',
        `Customer ${userId} clicked Pay button (${data}). Waiting for verified server-side payment webhook.`
      );
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

  // 2. Handle Standard Text Messages
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

    // Global Menu / Command Triggers
    if (text === '/start' || text === '/menu' || text.toLowerCase() === 'menu' || text.toLowerCase() === 'hi' || text.toLowerCase() === 'hello') {
      // Note: Do not wipe customer's saved progress; show main menu buttons.
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

    // Handle State Machine Transitions
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
        // Re-display confirmation screen if customer sends free text while in waiting_for_confirmation
        await sendConfirmationScreen(customer);
        return customer;
      }

      case ConversationState.WAITING_FOR_PAYMENT: {
        // Re-display payment screen (without Cancel button) if customer returns and messages the bot
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
