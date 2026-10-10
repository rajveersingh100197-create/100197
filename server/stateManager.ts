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

/**
 * Normalizes Telegram slash commands by stripping @BotUsername suffixes and lowercasing.
 */
export function normalizeBotCommand(rawText: string): string {
  const trimmed = String(rawText || '').trim();
  if (!trimmed.startsWith('/')) {
    return trimmed;
  }
  const firstToken = trimmed.split(/\s+/)[0];
  return firstToken.split('@')[0].toLowerCase();
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

  termsDetails: () =>
    [
      '📜 DIWALI BIGDEAL — TERMS & CONDITIONS',
      '',
      '1. Entry Fee: 100 Telegram Stars ⭐️ (XTR).',
      '2. Ticket Generation: A unique ticket (DB2026-XXXXXX) is issued strictly after verified Telegram Stars payment.',
      '3. Eligibility: Participants must provide accurate Full Name, valid 10-digit Mobile Number, and Complete Address.',
      '4. Prize Draw: Official winner announcement on 8 November 2026 at 11:59 PM IST.',
      '5. Verification: Keep your confirmed ticket number safe for prize claim verification.',
    ].join('\n'),

  supportMessage: () =>
    [
      '🆘 SUPPORT',
      '',
      'For payment or ticket-related issues, please use the support system configured by the administrator.',
    ].join('\n'),
};

async function sendConfirmationScreen(customer: CustomerRecord) {
  const text = BOT_MESSAGES.confirmDetails(
    customer.name || '',
    customer.phone || '',
    customer.address || ''
  );

  // Strictly NO Cancel button
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

async function sendPaymentScreen(customer: CustomerRecord) {
  const paymentOrder = await createPaymentOrderForCustomer(customer);
  const text = BOT_MESSAGES.paymentPrompt();

  const isNativeTelegramStarsLink = paymentOrder.payment_url.startsWith('https://t.me/$');

  // Strictly NO Cancel button
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

async function handleTermsTrigger(customer: CustomerRecord) {
  await sendTelegramMessage(
    customer.telegram_chat_id,
    BOT_MESSAGES.termsDetails(),
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

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<CustomerRecord | null> {
  // 0. Handle Telegram Stars `pre_checkout_query`
  if (update.pre_checkout_query) {
    const pcq = update.pre_checkout_query;
    const paymentId = pcq.invoice_payload;

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

    if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
      await answerTelegramPreCheckoutQuery(
        pcq.id,
        false,
        `You already have a confirmed entry (Ticket: ${customer.ticket_number}).`
      );
      return customer;
    }

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

    if (sp.currency !== 'XTR' || Number(sp.total_amount) !== 100) {
      logger.security(
        'TelegramStars',
        'Rejected successful_payment due to currency/amount mismatch',
        {
          payment_id: paymentId,
          currency: sp.currency,
          total_amount: sp.total_amount,
        }
      );
      return db.getCustomerByUserId(userId);
    }

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
      menu_terms: '📜 Terms & Conditions',
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

    if (data === 'menu_join_199') {
      await handleJoinEntryTrigger(customer);
      return db.getCustomerByUserId(userId);
    }

    if (data === 'action_continue_join' || data === 'action_edit_details') {
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
      const paymentId = data.replace('pay_link_', '');
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

    if (data === 'menu_terms') {
      await handleTermsTrigger(customer);
      return customer;
    }

    if (data === 'menu_support') {
      await handleSupportTrigger(customer);
      return customer;
    }

    return customer;
  }

  // 3. Handle Standard Text Messages & All Bot Commands (/start, /prizes, /ticket, /terms, /enter, /support)
  if (update.message && typeof update.message.text === 'string') {
    const msg = update.message;
    const userId = String(msg.from?.id || msg.chat.id);
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    const command = normalizeBotCommand(text);

    db.appendChatMessage(chatId, {
      id: crypto.randomUUID(),
      chat_id: chatId,
      text,
      timestamp: new Date().toISOString(),
      direction: 'user',
    });

    let customer = db.getOrCreateCustomer(userId, chatId);

    if (
      command === '/start' ||
      command === '/menu' ||
      command === '/help' ||
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
      command === '/enter' ||
      command === '/join' ||
      text === '🎟️ Join Entry (100 Telegram Stars ⭐️)' ||
      text === '🎟️ Join ₹199 Entry'
    ) {
      await handleJoinEntryTrigger(customer);
      return db.getCustomerByUserId(userId);
    }

    if (command === '/ticket' || command === '/myticket' || text === '🎫 My Ticket') {
      await handleMyTicketTrigger(customer);
      return customer;
    }

    if (command === '/prizes' || command === '/prize' || text === '🏆 Prize Details') {
      await handlePrizeDetailsTrigger(customer);
      return customer;
    }

    if (command === '/terms' || command === '/rules' || text === '📜 Terms & Conditions') {
      await handleTermsTrigger(customer);
      return customer;
    }

    if (command === '/support' || text === '🆘 Support') {
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
