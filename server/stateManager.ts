/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { db, normalizeReferralCode } from './db';
import { logger } from './logger';
import {
  ConversationState,
  CustomerRecord,
  CustomerReferralDashboardData,
  InlineKeyboardButton,
  PaymentStatus,
  TelegramUpdate,
} from './types';
import {
  answerTelegramCallbackQuery,
  answerTelegramPreCheckoutQuery,
  MAIN_MENU_INLINE_KEYBOARD,
  notifyAdminNewBotStart,
  notifyAdminReferralJoined,
  notifyAdminRegistrationSubmitted,
  notifyAdminWithdrawalRequested,
  sendTelegramMessage,
  sendTelegramStarsInvoice,
  validateAdminGroupChatId,
  verifyTelegramGroupAdmin,
} from './telegramService';
import {
  createPaymentOrderForCustomer,
  processVerifiedPaymentWebhook,
} from './paymentService';

/**
 * Extracts a referral code from `/start ref_CODE`, `/start REF-CODE`, or standalone `ref_CODE`.
 * Link format: https://t.me/DiwaliDhamaka2026Bot?start=ref_CODE
 */
export function extractReferralCodeFromText(rawText: string): string | null {
  const trimmed = String(rawText || '').trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const cmd = parts[0].split('@')[0].toLowerCase();
    if (cmd === '/start' || cmd === '/join' || cmd === '/enter') {
      const arg = parts[1].trim();
      if (/^(ref_|ref-)?[A-Z0-9]{4,12}$/i.test(arg)) {
        return normalizeReferralCode(arg);
      }
    }
  }
  if (/^(ref_|ref-)[A-Z0-9]{4,12}$/i.test(trimmed)) {
    return normalizeReferralCode(trimmed);
  }
  return null;
}

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
      '🪔 स्वागत है DiwaliBigdeal में!',
      '',
      '🎉 इस दिवाली DiwaliBigdeal से जुड़ें और शानदार इनाम जीतने का मौका पाएँ!',
      '',
      '🏆 पहला इनाम: Mahindra Thar ROXX',
      '🥈 दूसरा इनाम: Double-Door Refrigerator',
      '🥉 तीसरा इनाम: Smart LED TV',
      '💰 इसके अलावा जीतें Multiple Cash Prizes!',
      '',
      '🎟️ Entry Fee: ₹199',
      '📅 Winner Announcement: 8 November 2026',
      '⏰ Time: रात 11:59 बजे (IST)',
      '',
      '👇 आगे बढ़ने के लिए नीचे दिए गए विकल्प चुनें:',
    ].join('\n'),

  joinIntro: () =>
    [
      '🎟️ DIWALI BIGDEAL — CAMPAIGN ENTRY',
      '',
      '🎉 इस दिवाली DiwaliBigdeal से जुड़ें और शानदार इनाम जीतने का मौका पाएँ!',
      '',
      '🏆 पहला इनाम: Mahindra Thar ROXX',
      '🥈 दूसरा इनाम: Double-Door Refrigerator',
      '🥉 तीसरा इनाम: Smart LED TV',
      '💰 इसके अलावा जीतें Multiple Cash Prizes!',
      '',
      '🎟️ Entry Fee: ₹199',
      '📅 Winner Announcement: 8 November 2026',
      '⏰ Time: रात 11:59 बजे (IST)',
      '',
      '👇 अपनी Entry दर्ज करने के लिए नीचे क्लिक करें:',
    ].join('\n'),

  askFullName: () => '👤 कृपया अपना पूरा नाम (Full Name) दर्ज करें:',

  nameReceivedAskMobile: () =>
    [
      '✅ आपका नाम दर्ज कर लिया गया है।',
      '',
      '📱 कृपया अपना 10 अंकों का Mobile Number दर्ज करें:',
    ].join('\n'),

  invalidMobilePrompt: () =>
    [
      '⚠️ यह Mobile Number मान्य नहीं है।',
      '',
      '📱 कृपया अपना सही 10 अंकों का Indian Mobile Number दर्ज करें:',
    ].join('\n'),

  mobileReceivedAskAddress: () =>
    [
      '✅ आपका Mobile Number दर्ज कर लिया गया है।',
      '',
      '🏠 कृपया अपना पूरा पता (Complete Address) दर्ज करें:',
    ].join('\n'),

  confirmDetails: (name: string, phone: string, address: string) =>
    [
      '📋 कृपया अपनी जानकारी की पुष्टि करें (Confirm Details)',
      '',
      `👤 नाम (Name): ${name}`,
      `📱 मोबाइल (Mobile): ${phone}`,
      `🏠 पता (Address): ${address}`,
      '',
      '🎟️ Entry Fee: ₹199',
      '',
      'क्या आपकी यह जानकारी बिल्कुल सही है?',
    ].join('\n'),

  paymentPrompt: () =>
    [
      '💳 अब Payment करें',
      '',
      '🎟️ Entry Fee: ₹199',
      '',
      'अपनी DiwaliBigdeal Entry पक्की (Confirm) करने के लिए कृपया नीचे दिए गए बटन से Payment पूरा करें।',
      '✅ Payment सफल होते ही आपका Unique Ticket Number तुरंत जारी कर दिया जाएगा।',
    ].join('\n'),

  myTicketConfirmed: (
    ticketNumber: string,
    name: string,
    phone: string,
    referralCode?: string,
    referralCount?: number
  ) =>
    [
      '🎫 मेरा टिकट | MY CONFIRMED TICKET',
      '',
      `🎟️ Ticket No: ${ticketNumber}`,
      '',
      `👤 नाम (Name): ${name}`,
      `📱 मोबाइल (Mobile): ${phone}`,
      referralCode ? `🔗 Referral Code: ${referralCode} (Referrals: ${referralCount ?? 0})` : null,
      '',
      '🎟️ Entry Fee: ₹199',
      '✅ Status: CONFIRMED (पक्का)',
      '',
      '📅 Winner Announcement: 8 November 2026',
      '⏰ Time: रात 11:59 बजे (IST)',
    ]
      .filter((line) => line !== null)
      .join('\n'),

  myTicketNotFound: () =>
    [
      '❌ अभी तक आपका कोई Confirmed Ticket नहीं मिला है।',
      '',
      '🎉 इस दिवाली DiwaliBigdeal से जुड़ें और शानदार इनाम जीतने का मौका पाएँ!',
      '🎟️ Entry Fee: ₹199',
      '',
      '👇 अपनी Entry पक्की करने के लिए नीचे बटन दबाएँ:',
    ].join('\n'),

  prizeDetails: () =>
    [
      '🎁 DIWALI BIGDEAL — इनामों की जानकारी (Prize Details)',
      '',
      '🏆 पहला इनाम: Mahindra Thar ROXX',
      '🥈 दूसरा इनाम: Double-Door Refrigerator',
      '🥉 तीसरा इनाम: Smart LED TV',
      '💰 इसके अलावा जीतें Multiple Cash Prizes!',
      '',
      '🎉 इस दिवाली DiwaliBigdeal से जुड़ें और शानदार इनाम जीतने का मौका पाएँ!',
      '',
      '🎟️ Entry Fee: ₹199',
      '📅 Winner Announcement: 8 November 2026',
      '⏰ Time: रात 11:59 बजे (IST)',
    ].join('\n'),

  termsDetails: () =>
    [
      '📜 DIWALI BIGDEAL — नियम और शर्तें (Terms & Conditions)',
      '',
      '1. आयु सीमा (Age Eligibility):',
      'इस Campaign में भाग लेने के लिए आपकी उम्र कम से कम 18 वर्ष या उससे अधिक होनी चाहिए। 18 वर्ष से कम आयु के व्यक्ति पात्र (Eligible) नहीं हैं।',
      '',
      '2. सही जानकारी (Accurate Information):',
      'प्रतिभागियों को अपना सही कानूनी नाम (Full Legal Name), चालू 10 अंकों का Indian Mobile Number और पूरा आवासीय पता (Complete Residential Address) देना अनिवार्य है। कृपया Submit करने से पहले अपनी सभी जानकारी ध्यान से जाँच लें।',
      '',
      '3. पहचान सत्यापन (Identity Verification):',
      'यदि आप विजेता (Winner) के रूप में चुने जाते हैं, तो पहचान और उम्र की पुष्टि के लिए मान्य सरकारी पहचान पत्र (Valid Government-issued ID) दिखाना आवश्यक होगा। आपकी ID पर दिया गया नाम आपके द्वारा दर्ज किए गए पूरे नाम से मेल खाना चाहिए। इनाम देने से पहले अतिरिक्त Verification किया जा सकता है।',
      '',
      '4. गलत या अधूरी जानकारी (Incorrect Information):',
      'यदि दर्ज किया गया नाम, पता, आयु या अन्य विवरण गलत, अधूरा या भ्रामक पाया जाता है या उसकी पुष्टि नहीं हो पाती है, तो Campaign नियमों के अनुसार आपकी Entry रद्द (Disqualify) की जा सकती है।',
      '',
      '5. विजेता की घोषणा (Winner Announcement):',
      'आधिकारिक Winner Announcement 8 November 2026 को रात 11:59 बजे (IST) किया जाएगा।',
      '',
      '6. टिकट सुरक्षा (Ticket Safety):',
      'सभी प्रतिभागी इनाम Claim और Verification के लिए अपना Confirmed Ticket Number (DB2026-XXXXXX) सुरक्षित रखें। केवल Ticket होना निश्चित इनाम की गारंटी नहीं है।',
      '',
      '7. सत्यापन और इनाम प्राप्ति (Verification & Prize Claim):',
      'चयनित विजेताओं को निर्धारित समय-सीमा के भीतर आवश्यक Verification पूरा करना होगा और दिए गए Prize-Claim निर्देशों का पालन करना होगा।',
      '',
      '8. गोपनीयता और सुरक्षा (Privacy):',
      'आपकी व्यक्तिगत जानकारी और Government ID दस्तावेज़ केवल आवश्यक Verification के लिए सुरक्षित रूप से लिए जाएँगे। कृपया अपनी कोई भी Government ID सार्वजनिक रूप से Telegram Chat में पोस्ट न करें।',
      '',
      '9. अभियान के नियम (Campaign Rules):',
      'इस Campaign में भागीदारी और इनाम वितरण लागू कानूनों तथा आधिकारिक Campaign Rules के अधीन है।',
    ].join('\n'),

  supportMessage: () =>
    [
      '📞 सहायता केंद्र | CUSTOMER SUPPORT',
      '',
      'यदि आपको अपनी Entry, Payment या Ticket से जुड़ी कोई भी सहायता चाहिए, तो कृपया हमें Email करें:',
      '',
      '📧 Support Email: diwalideal2026@gmail.com',
    ].join('\n'),

  /**
   * Unified single-message Referral Dashboard showing all required stats,
   * referral link, withdrawal status, and masked referral history.
   */
  referralDashboard: (data: CustomerReferralDashboardData) => {
    const pendingWithdrawals = data.withdrawal_requests.filter(
      (w) => w.status === 'PENDING_APPROVAL' || w.status === 'APPROVED_PENDING_PAYOUT'
    );
    const withdrawalLines =
      data.withdrawal_requests.length === 0
        ? ['• कोई Pending या पिछला Withdrawal Request नहीं है (None)']
        : data.withdrawal_requests.slice(0, 5).map((w) => {
            const refStr = w.payout_reference ? ` [Ref: ${w.payout_reference}]` : '';
            return `• ${w.id}: ${w.amount} Stars — Status: ${w.status}${refStr}`;
          });

    const historyLines =
      data.history.length === 0
        ? ['• अभी तक कोई Referred User नहीं है (0 Referrals recorded in DB)']
        : data.history.slice(0, 10).map((item, idx) => {
            const dateStr = item.referred_at.slice(0, 10);
            const regStr = item.registration_completed ? 'Complete' : 'Incomplete';
            return `${idx + 1}. ${item.masked_identifier} | Date: ${dateStr} | Reg: ${regStr} | Payment: ${item.payment_status_label} | Bonus: ${item.bonus_status_label}`;
          });

    const programStatusLine = data.referral_program_enabled
      ? `✅ Referral Bonus Active (Min Withdrawal: ${data.min_withdrawal_amount} Stars)`
      : 'ℹ️ Referral Tracking Active (Bonus & Withdrawals disabled until campaign policy activation)';

    return [
      '🎁 DIWALI BIGDEAL — REFER & EARN DASHBOARD',
      '',
      `🔑 Permanent Referral Code: ${data.referral_code}`,
      `🔗 Personal Referral Link:\n${data.referral_link}`,
      '📋 (ऊपर दिए गए Link को Tap करके Copy या Share करें)',
      '',
      '📊 LIVE REFERRAL STATS (Database Records):',
      `• Total Referred Users: ${data.total_referred_users}`,
      `• Successfully Registered Referred Users: ${data.registered_referred_users}`,
      `• Successfully Verified Referred Payments: ${data.verified_referred_payments}`,
      `• Pending Payments: ${data.pending_referred_payments}`,
      `• Total Verified Referral Bonus: ${data.total_verified_bonus} Stars`,
      `• Available Withdrawal Balance: ${data.available_withdrawal_balance} Stars`,
      `• Pending Withdrawal Requests: ${pendingWithdrawals.length}`,
      `• Program Status: ${programStatusLine}`,
      '',
      '🏦 WITHDRAWAL REQUESTS & STATUS:',
      ...withdrawalLines,
      '',
      '📜 REFERRAL HISTORY (Privacy-Masked):',
      ...historyLines,
    ].join('\n');
  },
};

export function buildReferralDashboardKeyboard(data: CustomerReferralDashboardData) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(
    data.referral_link
  )}&text=${encodeURIComponent(
    '🪔 DiwaliBigdeal से जुड़ें और Mahindra Thar ROXX, Refrigerator, Smart LED TV व Cash Prizes जीतने का मौका पाएँ!'
  )}`;

  const rows: InlineKeyboardButton[][] = [
    [
      { text: '📤 Share Referral Link', url: shareUrl },
      { text: '📋 Copy Link / Code', callback_data: 'action_copy_referral_link' },
    ],
  ];

  // Show Request Withdrawal button inside the Refer & Earn view ONLY when user has eligible available balance
  if (data.can_request_withdrawal) {
    rows.push([
      {
        text: `💸 Request Withdrawal (${data.available_withdrawal_balance} Stars)`,
        callback_data: 'action_request_withdrawal',
      },
    ]);
  }

  rows.push([
    { text: '🔄 Refresh Stats', callback_data: 'menu_refer_earn' },
    { text: '🏠 Main Menu', callback_data: 'action_back_main_menu' },
  ]);

  return { inline_keyboard: rows };
}

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
          text: '✅ पुष्टि करें और ₹199 Payment करें | Confirm & Pay',
          callback_data: 'action_confirm_pay_199',
        },
      ],
      [{ text: '✏️ जानकारी बदलें | Edit Details', callback_data: 'action_edit_details' }],
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
              text: '💳 अभी Payment करें | Pay Now (₹199)',
              url: paymentOrder.payment_url,
            }
          : {
              text: '💳 अभी Payment करें | Pay Now (₹199)',
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
    inline_keyboard: [[{ text: '🚀 आगे बढ़ें | Continue', callback_data: 'action_continue_join' }]],
  });
}

async function handleMyTicketTrigger(customer: CustomerRecord) {
  if (customer.payment_status === PaymentStatus.PAID && customer.ticket_number) {
    await sendTelegramMessage(
      customer.telegram_chat_id,
      BOT_MESSAGES.myTicketConfirmed(
        customer.ticket_number,
        customer.name || 'Customer',
        customer.phone || '',
        customer.referral_code,
        customer.referral_count
      ),
      MAIN_MENU_INLINE_KEYBOARD
    );
  } else {
    await sendTelegramMessage(customer.telegram_chat_id, BOT_MESSAGES.myTicketNotFound(), {
      inline_keyboard: [
        [{ text: '🎟️ अभी जुड़ें | Join Now (₹199)', callback_data: 'menu_join_199' }],
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

async function handleReferAndEarnTrigger(customer: CustomerRecord) {
  const dashboardData = db.getCustomerReferralDashboard(customer.telegram_user_id);
  const text = BOT_MESSAGES.referralDashboard(dashboardData);
  const keyboard = buildReferralDashboardKeyboard(dashboardData);
  await sendTelegramMessage(customer.telegram_chat_id, text, keyboard);
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
    const username = msg.from?.username || null;
    const paymentId = sp.invoice_payload;

    db.getOrCreateCustomer(userId, chatId, username);

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
      menu_join_199: '🎟️ अभी जुड़ें | Join Now (₹199)',
      action_continue_join: '🚀 आगे बढ़ें | Continue',
      action_confirm_pay_199: '✅ पुष्टि करें और ₹199 Payment करें | Confirm & Pay',
      action_edit_details: '✏️ जानकारी बदलें | Edit Details',
      menu_my_ticket: '🎫 मेरा टिकट | My Ticket',
      menu_prize_details: '🎁 इनाम देखें | View Prizes',
      menu_refer_earn: '🎁 Refer & Earn',
      action_copy_referral_link: '📋 Copy Link / Code',
      action_request_withdrawal: '💸 Request Withdrawal',
      action_back_main_menu: '🏠 Main Menu',
      menu_terms: '📜 नियम और शर्तें | Terms & Conditions',
      menu_support: '📞 सहायता | Support',
    };

    const tapDisplay =
      buttonLabelMap[data] ||
      (data.startsWith('pay_link_') ? '💳 अभी Payment करें | Pay Now (₹199)' : data);

    db.appendChatMessage(chatId, {
      id: crypto.randomUUID(),
      chat_id: chatId,
      text: tapDisplay,
      timestamp: new Date().toISOString(),
      direction: 'user',
    });

    await answerTelegramCallbackQuery(cb.id);

    let { customer } = db.getOrCreateCustomer(userId, chatId, cb.from?.username || null);

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

    if (data === 'menu_refer_earn') {
      await handleReferAndEarnTrigger(customer);
      return customer;
    }

    if (data === 'action_copy_referral_link') {
      const dash = db.getCustomerReferralDashboard(userId);
      await sendTelegramMessage(
        chatId,
        [
          '📋 आपका Permanent Referral Code और Link:',
          '',
          `🔑 Referral Code: ${dash.referral_code}`,
          `🔗 Referral Link:\n${dash.referral_link}`,
          '',
          'इस संदेश को Copy या Forward करके अपने दोस्तों के साथ साझा करें!',
        ].join('\n'),
        buildReferralDashboardKeyboard(dash)
      );
      return customer;
    }

    if (data === 'action_request_withdrawal') {
      const reqResult = db.createWithdrawalRequest(userId);
      const updatedDash = db.getCustomerReferralDashboard(userId);
      if (reqResult.ok && reqResult.request) {
        await notifyAdminWithdrawalRequested({
          customer,
          request: reqResult.request,
        });
        await sendTelegramMessage(
          chatId,
          [
            '✅ आपका Withdrawal Request सफलतापूर्वक दर्ज कर लिया गया है!',
            '',
            `🆔 Request ID: ${reqResult.request.id}`,
            `💰 Amount: ${reqResult.request.amount} Stars`,
            `📌 Status: ${reqResult.request.status} (Awaiting Admin Review)`,
            '',
            '⚠️ ध्यान दें: प्रत्येक Withdrawal Request की Admin द्वारा जाँच की जाती है।',
          ].join('\n'),
          buildReferralDashboardKeyboard(updatedDash)
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `⚠️ Withdrawal Request उपलब्ध नहीं है: ${reqResult.reason || 'Not eligible'}`,
          buildReferralDashboardKeyboard(updatedDash)
        );
      }
      return customer;
    }

    if (data === 'action_back_main_menu') {
      await sendTelegramMessage(
        chatId,
        BOT_MESSAGES.mainMenuGreeting(),
        MAIN_MENU_INLINE_KEYBOARD
      );
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

  // 3. Handle Standard Text Messages & All Bot Commands (/start, /prizes, /ticket, /refer, /terms, /enter, /support, /test_group)
  const incomingMsg =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.edited_channel_post;
  const rawMessageText =
    typeof incomingMsg?.text === 'string'
      ? incomingMsg.text
      : typeof incomingMsg?.caption === 'string'
      ? incomingMsg.caption
      : null;

  if (incomingMsg && typeof rawMessageText === 'string') {
    const msg = incomingMsg;
    const chatType = msg.chat?.type || 'private';
    const userId = String(msg.from?.id || msg.chat.id);
    const senderChatId = msg.sender_chat?.id ? String(msg.sender_chat.id) : null;
    const chatId = String(msg.chat.id);
    const text = rawMessageText.trim();
    const command = normalizeBotCommand(text);
    const isTestGroupCmd =
      command === '/test_group' || /(?:^|\s)\/test_group(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text);

    // Group / Supergroup / Channel Isolation: ONLY process designated `/test_group` setup message from a group
    if (
      chatType === 'group' ||
      chatType === 'supergroup' ||
      chatType === 'channel' ||
      chatId.startsWith('-')
    ) {
      const effectiveUpdateType = update.channel_post
        ? 'channel_post'
        : update.edited_channel_post
        ? 'edited_channel_post'
        : update.edited_message
        ? 'edited_message'
        : 'message';

      db.updateTelemetry({
        last_group_update_at: new Date().toISOString(),
        last_group_update_type: effectiveUpdateType,
        last_test_group_detected: isTestGroupCmd,
      });

      logger.info('AdminGroupDiagnostic', 'Group update inspected', {
        updateReceived: true,
        updateType: effectiveUpdateType,
        testGroupDetected: isTestGroupCmd,
      });

      if (!isTestGroupCmd) {
        return null;
      }

      const isAuthorizedAdmin =
        chatType === 'channel'
          ? true
          : await verifyTelegramGroupAdmin(chatId, userId, senderChatId);

      const configuredAdminCheck = validateAdminGroupChatId();
      const matchesConfiguredEnv =
        configuredAdminCheck.valid && configuredAdminCheck.chatId === chatId;
      const groupKindLabel =
        chatType === 'channel'
          ? 'channel (Telegram Channel)'
          : chatType === 'supergroup' || chatId.startsWith('-100')
          ? 'supergroup (Telegram Supergroup)'
          : 'group (Regular Telegram Group)';

      const setupReply = [
        '🔐 DIWALI BIGDEAL — ADMIN GROUP DIAGNOSTIC (/test_group)',
        '',
        '✅ Group webhook delivery verified.',
        `🆔 Actual Numeric Chat ID: ${chatId}`,
        `📌 Group Type: ${groupKindLabel}`,
        `👤 Sender Admin Verified: ${isAuthorizedAdmin ? 'YES (Administrator/Creator)' : 'UNVERIFIED (Group Member)'}`,
        `⚙️ TELEGRAM_ADMIN_CHAT_ID Status: ${
          matchesConfiguredEnv
            ? 'CONFIGURED & MATCHED'
            : 'NOT MATCHED YET — Copy the Actual Numeric Chat ID above into Vercel as TELEGRAM_ADMIN_CHAT_ID'
        }`,
      ].join('\n');

      const sentMsg = await sendTelegramMessage(chatId, setupReply);
      db.updateTelemetry({
        last_test_group_at: new Date().toISOString(),
        last_test_group_admin_verified: isAuthorizedAdmin,
        last_test_group_reply_delivered: Boolean(sentMsg.delivered),
      });

      logger.info('AdminGroupDiagnostic', 'Completed /test_group diagnostic reply', {
        updateReceived: true,
        updateType: effectiveUpdateType,
        testGroupDetected: true,
        adminVerified: isAuthorizedAdmin,
        replySucceeded: Boolean(sentMsg.delivered),
      });
      return null;
    }

    if (isTestGroupCmd) {
      const sentMsg = await sendTelegramMessage(
        chatId,
        'ℹ️ /test_group command केवल आपके Private Telegram Admin Group के अंदर काम करता है जहाँ @DiwaliDhamaka2026Bot Administrator है। कृपया इसे अपने Admin Group में भेजें।'
      );
      logger.info('AdminGroupDiagnostic', 'Informed user to run /test_group inside a group chat', {
        updateReceived: true,
        updateType: 'message',
        testGroupDetected: true,
        replySucceeded: Boolean(sentMsg.delivered),
      });
      return null;
    }

    db.appendChatMessage(chatId, {
      id: crypto.randomUUID(),
      chat_id: chatId,
      text,
      timestamp: new Date().toISOString(),
      direction: 'user',
    });

    const username = msg.from?.username || null;
    let { customer } = db.getOrCreateCustomer(userId, chatId, username);

    const referralCodeCandidate = extractReferralCodeFromText(text);
    let referralResult: { applied: boolean; referrer: CustomerRecord | null } = {
      applied: false,
      referrer: null,
    };
    if (referralCodeCandidate) {
      referralResult = db.applyReferralCodeOnce(userId, referralCodeCandidate);
      customer = db.getCustomerByUserId(userId) || customer;
      if (referralResult.applied && referralResult.referrer) {
        await notifyAdminReferralJoined({
          referredCustomer: customer,
          referrer: referralResult.referrer,
        });
      }
    }

    if (
      command === '/start' ||
      command === '/menu' ||
      command === '/help' ||
      text.toLowerCase() === 'menu' ||
      text.toLowerCase() === 'hi' ||
      text.toLowerCase() === 'hello'
    ) {
      if (command === '/start') {
        await notifyAdminNewBotStart({
          customer,
          username,
          referralApplied: referralResult.applied,
          referrer: referralResult.referrer,
        });
      }
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
      text === '🎟️ अभी जुड़ें | Join Now' ||
      text === '🎟️ अभी जुड़ें | Join Now (₹199)' ||
      text === '🎟️ Join Entry (100 Telegram Stars ⭐️)' ||
      text === '🎟️ Join ₹199 Entry'
    ) {
      await handleJoinEntryTrigger(customer);
      return db.getCustomerByUserId(userId);
    }

    if (
      command === '/ticket' ||
      command === '/myticket' ||
      text === '🎫 मेरा टिकट | My Ticket' ||
      text === '🎫 My Ticket'
    ) {
      await handleMyTicketTrigger(customer);
      return customer;
    }

    if (
      command === '/prizes' ||
      command === '/prize' ||
      text === '🎁 इनाम देखें | View Prizes' ||
      text === '🏆 Prize Details'
    ) {
      await handlePrizeDetailsTrigger(customer);
      return customer;
    }

    if (
      command === '/refer' ||
      command === '/referral' ||
      text === '🎁 Refer & Earn'
    ) {
      await handleReferAndEarnTrigger(customer);
      return customer;
    }

    if (
      command === '/terms' ||
      command === '/rules' ||
      text === '📜 नियम और शर्तें | Terms & Conditions' ||
      text === '📜 Terms & Conditions'
    ) {
      await handleTermsTrigger(customer);
      return customer;
    }

    if (
      command === '/support' ||
      text === '📞 सहायता | Support' ||
      text === '🆘 Support'
    ) {
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
          await sendTelegramMessage(
            chatId,
            '🏠 कृपया अपना पूरा पता (Complete Address) दर्ज करें:'
          );
          return customer;
        }
        customer = db.updateCustomer(userId, {
          address: text,
          conversation_state: ConversationState.WAITING_FOR_CONFIRMATION,
        });
        await notifyAdminRegistrationSubmitted(customer);
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
