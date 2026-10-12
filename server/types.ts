/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum ConversationState {
  IDLE = 'idle',
  WAITING_FOR_NAME = 'waiting_for_name',
  WAITING_FOR_PHONE = 'waiting_for_phone',
  WAITING_FOR_ADDRESS = 'waiting_for_address',
  WAITING_FOR_CONFIRMATION = 'waiting_for_confirmation',
  WAITING_FOR_PAYMENT = 'waiting_for_payment',
  COMPLETED = 'completed',
}

export enum PaymentStatus {
  UNPAID = 'UNPAID',
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
}

export type WithdrawalStatus = 'PENDING_APPROVAL' | 'APPROVED_PENDING_PAYOUT' | 'PAID' | 'REJECTED';

export interface WithdrawalRequest {
  id: string;
  telegram_user_id: string;
  referral_code: string;
  amount: number;
  status: WithdrawalStatus;
  payout_reference: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferralHistoryItem {
  masked_identifier: string;
  referred_at: string;
  registration_completed: boolean;
  payment_status_label: 'Pending' | 'Verified' | 'Failed';
  bonus_status_label: 'Pending' | 'Eligible' | 'Paid';
  bonus_amount: number;
}

export interface AdminReferralHistoryRecord {
  referred_telegram_user_id: string;
  referred_username: string | null;
  referred_name: string | null;
  masked_identifier: string;
  referred_at: string;
  registration_completed: boolean;
  payment_status_label: 'Pending' | 'Verified' | 'Failed';
  ticket_number: string | null;
  bonus_status_label: 'Pending' | 'Eligible' | 'Paid';
  bonus_amount: number;
}

export interface AdminReferrerSummary {
  telegram_user_id: string;
  username: string | null;
  display_name: string | null;
  referral_code: string;
  referral_link: string;
  total_referred_users: number;
  registered_referred_users: number;
  verified_referred_payments: number;
  pending_referred_payments: number;
  total_verified_bonus: number;
  available_withdrawal_balance: number;
  pending_withdrawal_amount: number;
  approved_withdrawal_amount: number;
  paid_withdrawal_amount: number;
  withdrawal_requests: WithdrawalRequest[];
  referred_users: AdminReferralHistoryRecord[];
  updated_at: string;
}

export interface CustomerReferralDashboardData {
  referral_code: string;
  referral_link: string;
  referred_by: string | null;
  referral_program_enabled: boolean;
  withdrawals_enabled: boolean;
  total_referred_users: number;
  registered_referred_users: number;
  verified_referred_payments: number;
  pending_referred_payments: number;
  total_verified_bonus: number;
  locked_or_paid_withdrawal_amount: number;
  available_withdrawal_balance: number;
  can_request_withdrawal: boolean;
  min_withdrawal_amount: number;
  withdrawal_requests: WithdrawalRequest[];
  history: ReferralHistoryItem[];
}

export interface CustomerRecord {
  telegram_user_id: string;
  telegram_chat_id: string;
  username?: string | null;
  name: string | null;
  phone: string | null;
  address: string | null;
  conversation_state: ConversationState;
  payment_id: string | null;
  payment_status: PaymentStatus;
  payment_amount: number;
  ticket_number: string | null;
  referral_code: string;
  referred_by: string | null;
  referred_by_user_id?: string | null;
  referred_at?: string | null;
  referral_count: number;
  verified_referral_count?: number;
  verified_referral_bonus?: number;
  created_at: string;
  updated_at: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  pay?: boolean;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface ReplyKeyboardButton {
  text: string;
}

export interface ReplyKeyboardMarkup {
  keyboard: ReplyKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  is_persistent?: boolean;
}

export interface TelegramUser {
  id: number | string;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number | string;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  username?: string;
}

export interface TelegramSuccessfulPayment {
  currency: string; // 'XTR' for Telegram Stars
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
}

export interface TelegramPreCheckoutQuery {
  id: string;
  from: TelegramUser;
  currency: string; // 'XTR' for Telegram Stars
  total_amount: number;
  invoice_payload: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  chat: TelegramChat;
  date: number;
  text?: string;
  successful_payment?: TelegramSuccessfulPayment;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  pre_checkout_query?: TelegramPreCheckoutQuery;
}

export interface OutgoingBotMessage {
  id: string;
  chat_id: string;
  text: string;
  reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup;
  timestamp: string;
  direction: 'bot' | 'user' | 'webhook';
}

export interface SystemLogEntry {
  id: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SECURITY' | 'WEBHOOK';
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface PaymentCreationResult {
  payment_id: string;
  payment_amount: number;
  stars_amount: number;
  payment_url: string;
  provider: string;
  status: PaymentStatus;
  created_at: string;
}
