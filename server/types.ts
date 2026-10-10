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

export interface CustomerRecord {
  telegram_user_id: string;
  telegram_chat_id: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  conversation_state: ConversationState;
  payment_id: string | null;
  payment_status: PaymentStatus;
  payment_amount: number;
  ticket_number: string | null;
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
