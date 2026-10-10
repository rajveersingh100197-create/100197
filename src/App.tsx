/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  RotateCcw,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Search,
  Smartphone,
} from 'lucide-react';

interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

interface OutgoingBotMessage {
  id: string;
  chat_id: string;
  text: string;
  reply_markup?: {
    inline_keyboard?: InlineKeyboardButton[][];
  };
  timestamp: string;
  direction: 'bot' | 'user' | 'webhook';
}

interface CustomerRecord {
  telegram_user_id: string;
  telegram_chat_id: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  conversation_state: string;
  payment_id: string | null;
  payment_status: 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED';
  payment_amount: number;
  ticket_number: string | null;
  created_at: string;
  updated_at: string;
}

interface SystemLogEntry {
  id: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SECURITY' | 'WEBHOOK';
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

interface OverviewResponse {
  ok: boolean;
  config: {
    campaignName: string;
    entryFee: number;
    starsAmount: number;
    displayEntryPrice?: string;
    prizeAnnouncement: string;
    telegramBotTokenConfigured: boolean;
    telegramWebhookSecretConfigured: boolean;
    paymentProvider: string;
    paymentCredentialsConfigured: boolean;
    paymentWebhookSecretConfigured: boolean;
    databasePath: string;
    appUrl: string;
  };
  stats: {
    totalCustomers: number;
    confirmedTickets: number;
    pendingPayments: number;
    totalStarsCollected?: number;
  };
  customers: CustomerRecord[];
  logs: SystemLogEntry[];
  sqlSchema: string;
}

const DEFAULT_SIM_USER_ID = '9199887766';

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'database' | 'webhooks' | 'architecture'>('simulator');
  const [overview, setOverview] = useState<OverviewResponse | null>(null);

  // Simulator state
  const [simUserId, setSimUserId] = useState<string>(DEFAULT_SIM_USER_ID);
  const [simCustomer, setSimCustomer] = useState<CustomerRecord | null>(null);
  const [chatHistory, setChatHistory] = useState<OutgoingBotMessage[]>([]);
  const [messageInput, setMessageInput] = useState<string>('');
  const [sendingUpdate, setSendingUpdate] = useState<boolean>(false);
  const [webhookStatusBanner, setWebhookStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Database filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>('ALL');

  // Copy state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const fetchOverview = async () => {
    try {
      const res = await fetch('/api/admin/overview');
      const data = (await res.json()) as OverviewResponse;
      if (data.ok) {
        setOverview(data);
      }
    } catch (err) {
      console.error('Failed to load overview:', err);
    }
  };

  const fetchSimSession = async (userId: string) => {
    try {
      const res = await fetch(`/api/admin/chat/${userId}`);
      const data = await res.json();
      if (data.ok) {
        setSimCustomer(data.customer);
        setChatHistory(data.chatHistory || []);
        if (!data.chatHistory || data.chatHistory.length === 0) {
          await dispatchTelegramTextUpdate(userId, '/start');
        }
      }
    } catch (err) {
      console.error('Failed to load chat session:', err);
    }
  };

  useEffect(() => {
    fetchOverview();
    fetchSimSession(simUserId);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const dispatchTelegramTextUpdate = async (userId: string, text: string) => {
    if (!text.trim()) return;
    setSendingUpdate(true);
    setWebhookStatusBanner(null);
    try {
      const updatePayload = {
        update_id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
        message: {
          message_id: Math.floor(Math.random() * 100000),
          from: {
            id: userId,
            is_bot: false,
            first_name: 'TelegramCustomer',
          },
          chat: {
            id: userId,
            type: 'private',
          },
          date: Math.floor(Date.now() / 1000),
          text: text.trim(),
        },
      };

      const res = await fetch('/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-simulator-internal': 'true',
        },
        body: JSON.stringify(updatePayload),
      });

      const data = await res.json();
      if (data.ok) {
        setSimCustomer(data.customer);
        setChatHistory(data.chatHistory || []);
        await fetchOverview();
      }
    } finally {
      setSendingUpdate(false);
    }
  };

  const dispatchTelegramCallbackQuery = async (button: InlineKeyboardButton) => {
    setSendingUpdate(true);
    setWebhookStatusBanner(null);

    const callbackData = button.callback_data || 'noop';

    try {
      const updatePayload = {
        update_id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
        callback_query: {
          id: `sim_cb_${Date.now()}`,
          from: {
            id: userIdOrDefault(simUserId),
            is_bot: false,
            first_name: 'TelegramCustomer',
          },
          message: {
            message_id: Math.floor(Math.random() * 100000),
            chat: {
              id: userIdOrDefault(simUserId),
              type: 'private',
            },
            date: Math.floor(Date.now() / 1000),
          },
          data: callbackData,
        },
      };

      const res = await fetch('/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-simulator-internal': 'true',
        },
        body: JSON.stringify(updatePayload),
      });

      const data = await res.json();
      if (data.ok) {
        setSimCustomer(data.customer);
        setChatHistory(data.chatHistory || []);
        await fetchOverview();

        if (callbackData.startsWith('pay_link_')) {
          setWebhookStatusBanner({
            type: 'info',
            text: 'Customer tapped [💰 Pay 100 Telegram Stars ⭐️]. Per security policy, payment_status remains PENDING until Telegram delivers the verified pre_checkout_query (100 XTR) and successful_payment (100 XTR) updates.',
          });
        }
      }
    } finally {
      setSendingUpdate(false);
    }
  };

  function userIdOrDefault(id: string) {
    return id || DEFAULT_SIM_USER_ID;
  }

  /**
   * Simulates the full Telegram Stars native payment flow:
   * 1. Sends `pre_checkout_query` (currency: "XTR", total_amount: 100)
   * 2. Sends `message.successful_payment` (currency: "XTR", total_amount: 100)
   */
  const simulateTelegramStarsPayment = async (
    paymentId: string,
    currency = 'XTR',
    totalAmount = 100
  ) => {
    setSendingUpdate(true);
    setWebhookStatusBanner(null);
    try {
      // Step 1: Send pre_checkout_query to /api/telegram/webhook
      const preCheckoutUpdate = {
        update_id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
        pre_checkout_query: {
          id: `sim_pcq_${Date.now()}`,
          from: {
            id: simUserId,
            is_bot: false,
            first_name: 'TelegramCustomer',
          },
          currency,
          total_amount: totalAmount,
          invoice_payload: paymentId,
        },
      };

      const pcqRes = await fetch('/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-simulator-internal': 'true',
        },
        body: JSON.stringify(preCheckoutUpdate),
      });
      const pcqData = await pcqRes.json();

      if (currency !== 'XTR' || totalAmount !== 100) {
        setWebhookStatusBanner({
          type: 'error',
          text: `Rejected pre_checkout_query: currency="${currency}", total_amount=${totalAmount}. Bot strictly requires currency="XTR" and total_amount=100.`,
        });
        await fetchOverview();
        return;
      }

      if (!pcqRes.ok || !pcqData.ok) {
        setWebhookStatusBanner({
          type: 'error',
          text: pcqData.error || 'pre_checkout_query rejected',
        });
        return;
      }

      // Step 2: Send message.successful_payment to /api/telegram/webhook
      const chargeId = `st_charge_${paymentId}`;
      const successfulPaymentUpdate = {
        update_id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000) + 1,
        message: {
          message_id: Math.floor(Math.random() * 100000),
          from: {
            id: simUserId,
            is_bot: false,
            first_name: 'TelegramCustomer',
          },
          chat: {
            id: simUserId,
            type: 'private',
          },
          date: Math.floor(Date.now() / 1000),
          successful_payment: {
            currency: 'XTR',
            total_amount: 100,
            invoice_payload: paymentId,
            telegram_payment_charge_id: chargeId,
          },
        },
      };

      const spRes = await fetch('/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-simulator-internal': 'true',
        },
        body: JSON.stringify(successfulPaymentUpdate),
      });

      const spData = await spRes.json();
      if (spData.ok && spData.customer?.ticket_number) {
        setWebhookStatusBanner({
          type: 'success',
          text: `Verified 100 Telegram Stars ⭐️ (XTR) payment! Ticket ${spData.customer.ticket_number} confirmed for chat ${simUserId}.`,
        });
      }

      await fetchSimSession(simUserId);
      await fetchOverview();
    } finally {
      setSendingUpdate(false);
    }
  };

  const handleResetCustomer = async () => {
    setSendingUpdate(true);
    setWebhookStatusBanner(null);
    try {
      const res = await fetch('/api/admin/reset-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_user_id: simUserId }),
      });
      const data = await res.json();
      if (data.ok) {
        setSimCustomer(data.customer);
        setChatHistory(data.chatHistory || []);
        await fetchOverview();
      }
    } finally {
      setSendingUpdate(false);
    }
  };

  const handleSwitchSimUser = async (userId: string) => {
    setSimUserId(userId);
    setWebhookStatusBanner(null);
    await fetchSimSession(userId);
  };

  const copyToClipboard = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const filteredCustomers = (overview?.customers || []).filter((c) => {
    const matchesState = stateFilter === 'ALL' || c.conversation_state === stateFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesQuery =
      !q ||
      c.telegram_user_id.toLowerCase().includes(q) ||
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.toLowerCase().includes(q)) ||
      (c.ticket_number && c.ticket_number.toLowerCase().includes(q)) ||
      (c.payment_id && c.payment_id.toLowerCase().includes(q));
    return matchesState && matchesQuery;
  });

  const allStates = [
    'idle',
    'waiting_for_name',
    'waiting_for_phone',
    'waiting_for_address',
    'waiting_for_confirmation',
    'waiting_for_payment',
    'completed',
  ];

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 flex flex-col">
      {/* Top Bar Contract: Zone 1 Brand Wordmark | Zone 2 Nav Links | Zone 3 Primary Actions */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0F172A]">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('simulator');
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap"
        >
          DiwaliBigdeal Bot Engine
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`hover:text-white transition-colors whitespace-nowrap py-1 border-b-2 ${
              activeTab === 'simulator'
                ? 'text-white border-amber-500'
                : 'border-transparent'
            }`}
          >
            Telegram Simulator &amp; Flow
          </button>
          <button
            onClick={() => setActiveTab('database')}
            className={`hover:text-white transition-colors whitespace-nowrap py-1 border-b-2 ${
              activeTab === 'database'
                ? 'text-white border-amber-500'
                : 'border-transparent'
            }`}
          >
            Customer &amp; Ticket Ledger
          </button>
          <button
            onClick={() => setActiveTab('webhooks')}
            className={`hover:text-white transition-colors whitespace-nowrap py-1 border-b-2 ${
              activeTab === 'webhooks'
                ? 'text-white border-amber-500'
                : 'border-transparent'
            }`}
          >
            Webhook &amp; Security Logs
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`hover:text-white transition-colors whitespace-nowrap py-1 border-b-2 ${
              activeTab === 'architecture'
                ? 'text-white border-amber-500'
                : 'border-transparent'
            }`}
          >
            API &amp; Vercel Deployment
          </button>
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              fetchOverview();
              fetchSimSession(simUserId);
            }}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sync State
          </button>
          <button
            onClick={handleResetCustomer}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap"
          >
            Reset Active Chat
          </button>
        </div>
      </header>

      {/* Campaign Telemetry Strip */}
      <div className="border-b border-slate-800 bg-[#1E293B]/60 px-6 py-3">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">Campaign: DiwaliBigdeal</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-amber-400">
              Entry Fee: 100 Telegram Stars ⭐️ (XTR)
            </span>
            <span aria-hidden="true">·</span>
            <span>Prizes: Mahindra Thar ROXX, Double-Door Refrigerator, Smart LED TV, Cash Prizes</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">Draw: 8 November 2026 at 11:59 PM IST</span>
          </div>
          <div className="flex items-center gap-4 font-mono tabular-nums">
            <span>
              Total Users: <strong className="text-white">{overview?.stats.totalCustomers ?? 0}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Confirmed Tickets: <strong className="text-emerald-400">{overview?.stats.confirmedTickets ?? 0}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Pending Payments: <strong className="text-amber-400">{overview?.stats.pendingPayments ?? 0}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-6">
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Authentic Mobile Telegram Client Simulator (5 cols) */}
            <div className="lg:col-span-5 bg-[#1E293B] border border-slate-800 rounded-xl overflow-hidden flex flex-col h-[740px]">
              {/* Telegram Mobile Top Header */}
              <div className="bg-[#17212B] px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-bold text-sm">
                    🪔
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white leading-tight">
                      DiwaliBigdeal Official Bot
                    </div>
                    <div className="text-[11px] text-sky-400 font-mono tabular-nums">
                      bot · chat_id: {simUserId}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => dispatchTelegramTextUpdate(simUserId, '/start')}
                    title="Send /start"
                    className="px-2 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors whitespace-nowrap"
                  >
                    /start
                  </button>
                  <button
                    onClick={() => dispatchTelegramTextUpdate(simUserId, '/enter')}
                    title="Send /enter"
                    className="px-2 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors whitespace-nowrap"
                  >
                    /enter
                  </button>
                  <button
                    onClick={() => dispatchTelegramTextUpdate(simUserId, '/terms')}
                    title="Send /terms"
                    className="px-2 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors whitespace-nowrap"
                  >
                    /terms
                  </button>
                  <button
                    onClick={handleResetCustomer}
                    title="Reset Customer State"
                    className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Telegram Chat Transcript Viewport */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0E1621]">
                {chatHistory.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                    <Smartphone className="w-8 h-8 mb-2 text-slate-500" />
                    <p className="text-sm font-medium text-slate-300">No messages in this Telegram chat yet</p>
                    <p className="text-xs text-slate-500 mt-1 mb-4">
                      Tap below to start the Telegram-first DiwaliBigdeal conversation.
                    </p>
                    <button
                      onClick={() => dispatchTelegramTextUpdate(simUserId, '/start')}
                      className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                    >
                      Send /start to Bot
                    </button>
                  </div>
                ) : (
                  chatHistory.map((msg) => {
                    const isUser = msg.direction === 'user';
                    const inlineRows = msg.reply_markup?.inline_keyboard || [];

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                            isUser
                              ? 'bg-[#2B5278] text-white rounded-br-xs'
                              : 'bg-[#182533] text-slate-100 border border-slate-800/80 rounded-bl-xs'
                          }`}
                        >
                          {msg.text}
                          <div className="text-[10px] text-slate-400 text-right mt-1 font-mono tabular-nums">
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </div>
                        </div>

                        {/* Telegram Inline Keyboard Buttons */}
                        {!isUser && inlineRows.length > 0 && (
                          <div className="w-[85%] mt-1.5 space-y-1">
                            {inlineRows.map((row, rIdx) => (
                              <div
                                key={rIdx}
                                className="grid gap-1"
                                style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
                              >
                                {row.map((btn, bIdx) => (
                                  <button
                                    key={bIdx}
                                    disabled={sendingUpdate}
                                    onClick={() => dispatchTelegramCallbackQuery(btn)}
                                    className="w-full py-2 px-3 bg-[#203040] hover:bg-[#2B4055] active:scale-[0.99] text-sky-100 font-medium text-xs rounded-lg border border-slate-700/60 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap truncate"
                                  >
                                    <span className="truncate">{btn.text}</span>
                                    {btn.url && <ExternalLink className="w-3 h-3 text-sky-400 shrink-0" />}
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Persistent Main Telegram Reply Menu Bar */}
              <div className="bg-[#17212B] px-3 pt-2 pb-1 border-t border-slate-800">
                <div className="text-[10px] text-slate-400 mb-1.5 flex items-center justify-between">
                  <span>Main Telegram Menu Keyboard</span>
                  <span className="font-mono text-slate-500">State: {simCustomer?.conversation_state || 'idle'}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  <button
                    disabled={sendingUpdate}
                    onClick={() =>
                      dispatchTelegramTextUpdate(simUserId, '🎟️ Join Entry (100 Telegram Stars ⭐️)')
                    }
                    className="col-span-2 py-1.5 px-3 bg-[#242F3D] hover:bg-[#2E3C4E] text-xs font-medium text-white rounded border border-slate-700/70 transition-colors whitespace-nowrap"
                  >
                    🎟️ Join Entry (100 Telegram Stars ⭐️)
                  </button>
                  <button
                    disabled={sendingUpdate}
                    onClick={() => dispatchTelegramTextUpdate(simUserId, '🎫 My Ticket')}
                    className="py-1.5 px-2 bg-[#242F3D] hover:bg-[#2E3C4E] text-xs font-medium text-slate-200 rounded border border-slate-700/70 transition-colors whitespace-nowrap"
                  >
                    🎫 My Ticket
                  </button>
                  <button
                    disabled={sendingUpdate}
                    onClick={() => dispatchTelegramTextUpdate(simUserId, '🏆 Prize Details')}
                    className="py-1.5 px-2 bg-[#242F3D] hover:bg-[#2E3C4E] text-xs font-medium text-slate-200 rounded border border-slate-700/70 transition-colors whitespace-nowrap"
                  >
                    🏆 Prize Details
                  </button>
                  <button
                    disabled={sendingUpdate}
                    onClick={() => dispatchTelegramTextUpdate(simUserId, '🆘 Support')}
                    className="col-span-2 py-1.5 px-3 bg-[#242F3D] hover:bg-[#2E3C4E] text-xs font-medium text-slate-200 rounded border border-slate-700/70 transition-colors whitespace-nowrap"
                  >
                    🆘 Support
                  </button>
                </div>
              </div>

              {/* Telegram Message Input Box */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!messageInput.trim() || sendingUpdate) return;
                  const text = messageInput;
                  setMessageInput('');
                  dispatchTelegramTextUpdate(simUserId, text);
                }}
                className="bg-[#17212B] p-3 border-t border-slate-800 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder={
                    simCustomer?.conversation_state === 'waiting_for_name'
                      ? 'Enter your Full Name (e.g. Rajesh Verma)...'
                      : simCustomer?.conversation_state === 'waiting_for_phone'
                      ? 'Enter 10-digit Mobile Number (e.g. 9876543210)...'
                      : simCustomer?.conversation_state === 'waiting_for_address'
                      ? 'Enter Complete Address...'
                      : 'Write a message to @DiwaliBigdealBot...'
                  }
                  className="flex-1 bg-[#0E1621] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
                <button
                  type="submit"
                  disabled={!messageInput.trim() || sendingUpdate}
                  className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg transition-colors flex items-center justify-center"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>

            {/* Right Column: State Machine Inspector, Telegram Stars (100 XTR) Verifier & Quick Fill (7 cols) */}
            <div className="lg:col-span-7 space-y-6">
              {webhookStatusBanner && (
                <div
                  className={`p-4 rounded-xl border text-xs leading-relaxed flex items-start gap-3 ${
                    webhookStatusBanner.type === 'success'
                      ? 'bg-emerald-950/50 border-emerald-700 text-emerald-200'
                      : webhookStatusBanner.type === 'error'
                      ? 'bg-red-950/50 border-red-700 text-red-200'
                      : 'bg-sky-950/50 border-sky-700 text-sky-200'
                  }`}
                >
                  {webhookStatusBanner.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">{webhookStatusBanner.text}</div>
                </div>
              )}

              {/* 1. Persistent Conversation State Machine Pipeline */}
              <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-white">
                      01. Conversation State Machine &amp; Session Persistence
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Persisted in database per <code className="text-slate-200">telegram_user_id</code>. Survives Telegram app restarts.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Active User ID:</span>
                    <select
                      value={simUserId}
                      onChange={(e) => handleSwitchSimUser(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                    >
                      <option value={DEFAULT_SIM_USER_ID}>9199887766 (Interactive Sandbox)</option>
                      <option value="918820144">918820144 (Aarav Sharma — Confirmed Ticket)</option>
                      <option value="917451902">917451902 (Priya Nair — Waiting Payment)</option>
                    </select>
                  </div>
                </div>

                {/* 7-Stage State Machine Stepper */}
                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2 mb-5">
                  {allStates.map((st, idx) => {
                    const isCurrent = simCustomer?.conversation_state === st;
                    const currentIdx = allStates.indexOf(simCustomer?.conversation_state || 'idle');
                    const isPassed = idx < currentIdx;

                    return (
                      <div
                        key={st}
                        className={`p-2.5 rounded-lg border text-left transition-colors ${
                          isCurrent
                            ? 'bg-amber-500/15 border-amber-500 text-white'
                            : isPassed
                            ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-300'
                            : 'bg-slate-900/60 border-slate-800 text-slate-500'
                        }`}
                      >
                        <div className="text-[10px] font-mono tabular-nums opacity-75">
                          STEP 0{idx + 1}
                        </div>
                        <div className="text-xs font-mono font-medium mt-0.5 break-all">
                          {st}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Live Customer Database Record Inspector */}
                <div className="border-t border-slate-800 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-slate-300">
                      Live Database Record (<code className="text-amber-400">customers</code> table)
                    </span>
                    <div className="flex items-center gap-2">
                      {simCustomer?.conversation_state === 'waiting_for_name' && (
                        <button
                          onClick={() => dispatchTelegramTextUpdate(simUserId, 'Vikramaditya Rao')}
                          className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-sky-300 rounded border border-slate-700 transition-colors whitespace-nowrap"
                        >
                          Quick Fill Name
                        </button>
                      )}
                      {simCustomer?.conversation_state === 'waiting_for_phone' && (
                        <button
                          onClick={() => dispatchTelegramTextUpdate(simUserId, '9876501234')}
                          className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-sky-300 rounded border border-slate-700 transition-colors whitespace-nowrap"
                        >
                          Quick Fill Mobile
                        </button>
                      )}
                      {simCustomer?.conversation_state === 'waiting_for_address' && (
                        <button
                          onClick={() =>
                            dispatchTelegramTextUpdate(
                              simUserId,
                              '14/B Jubilee Hills, Road No 36, Hyderabad, Telangana - 500033'
                            )
                          }
                          className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-sky-300 rounded border border-slate-700 transition-colors whitespace-nowrap"
                        >
                          Quick Fill Address
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 text-xs font-mono tabular-nums">
                    <div>
                      <div className="text-slate-500 text-[11px]">telegram_user_id</div>
                      <div className="text-slate-100 mt-0.5">{simCustomer?.telegram_user_id || '-'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">telegram_chat_id</div>
                      <div className="text-slate-100 mt-0.5">{simCustomer?.telegram_chat_id || '-'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">conversation_state</div>
                      <div className="text-amber-400 font-semibold mt-0.5">
                        {simCustomer?.conversation_state || 'idle'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">name</div>
                      <div className="text-slate-100 mt-0.5 truncate">{simCustomer?.name || 'null'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">phone</div>
                      <div className="text-slate-100 mt-0.5">{simCustomer?.phone || 'null'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">payment_amount</div>
                      <div className="text-amber-400 mt-0.5">
                        {simCustomer?.payment_amount ?? 100} Telegram Stars ⭐️
                      </div>
                    </div>
                    <div className="col-span-2 sm:col-span-3">
                      <div className="text-slate-500 text-[11px]">address</div>
                      <div className="text-slate-100 mt-0.5">{simCustomer?.address || 'null'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">payment_id</div>
                      <div className="text-sky-400 mt-0.5">{simCustomer?.payment_id || 'null'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">payment_status</div>
                      <div
                        className={`mt-0.5 font-semibold ${
                          simCustomer?.payment_status === 'PAID'
                            ? 'text-emerald-400'
                            : simCustomer?.payment_status === 'PENDING'
                            ? 'text-amber-400'
                            : simCustomer?.payment_status === 'FAILED'
                            ? 'text-red-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {simCustomer?.payment_status || 'UNPAID'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">ticket_number</div>
                      <div className="text-emerald-400 font-semibold mt-0.5">
                        {simCustomer?.ticket_number || 'null'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Server-Side Telegram Stars (100 XTR) Verification Console */}
              <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h2 className="text-base font-semibold text-white">
                      02. Telegram Stars (100 XTR) Pre-Checkout &amp; Payment Verifier
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Invoices use <code className="text-amber-400">currency: &quot;XTR&quot;</code> and <code className="text-amber-400">prices: [{'{'}&quot;label&quot;:&quot;DiwaliBigdeal Entry&quot;,&quot;amount&quot;:100{'}'}]</code>. Tickets (<code className="text-emerald-400">DB2026-XXXXXX</code>) are generated strictly after verifying <code className="text-slate-200">pre_checkout_query</code> and <code className="text-slate-200">successful_payment</code> with <code className="text-emerald-400">currency === &quot;XTR&quot;</code> and <code className="text-emerald-400">total_amount === 100</code>.
                    </p>
                  </div>
                </div>

                {simCustomer?.payment_id ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                      <div>
                        <span className="text-slate-400">Invoice Payload: </span>
                        <strong className="text-sky-400">{simCustomer.payment_id}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Current Status: </span>
                        <strong
                          className={
                            simCustomer.payment_status === 'PAID'
                              ? 'text-emerald-400'
                              : simCustomer.payment_status === 'FAILED'
                              ? 'text-red-400'
                              : 'text-amber-400'
                          }
                        >
                          {simCustomer.payment_status}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Ticket Assigned: </span>
                        <strong className="text-emerald-400">
                          {simCustomer.ticket_number || 'NONE (Awaiting 100 XTR Payment)'}
                        </strong>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        disabled={sendingUpdate}
                        onClick={() => simulateTelegramStarsPayment(simCustomer.payment_id!, 'XTR', 100)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        Simulate Verified 100 Telegram Stars ⭐️ Payment (XTR)
                      </button>

                      <button
                        disabled={sendingUpdate}
                        onClick={() => simulateTelegramStarsPayment(simCustomer.payment_id!, 'XTR', 50)}
                        className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                      >
                        Test Wrong Amount (50 XTR → Reject)
                      </button>

                      <button
                        disabled={sendingUpdate}
                        onClick={() => simulateTelegramStarsPayment(simCustomer.payment_id!, 'USD', 100)}
                        className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-red-300 border border-slate-700 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                      >
                        Test Wrong Currency (USD → Reject)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 text-xs text-slate-400 flex items-center justify-between">
                    <span>
                      Complete Step 1–3 (Name, Mobile Number, Address) and tap{' '}
                      <strong className="text-slate-200">
                        ✅ Confirm &amp; Pay 100 Telegram Stars ⭐️
                      </strong>{' '}
                      in the Telegram simulator to generate a 100 XTR invoice.
                    </span>
                  </div>
                )}
              </div>

              {/* 3. Flow Invariants & Zero-Cancel Guarantee */}
              <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-5">
                <h2 className="text-base font-semibold text-white mb-2">
                  03. Enforced Telegram Stars (100 XTR) Invariants
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
                  <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-lg">
                    <div className="font-semibold text-white mb-1">Exact 100 XTR Invoice Specification</div>
                    <p className="text-slate-400 leading-relaxed">
                      Every invoice sets <code className="text-amber-400">currency: &quot;XTR&quot;</code> and <code className="text-amber-400">prices: [{'{'}&quot;label&quot;:&quot;DiwaliBigdeal Entry&quot;,&quot;amount&quot;:100{'}'}]</code> with no Cancel button.
                    </p>
                  </div>
                  <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-lg">
                    <div className="font-semibold text-white mb-1">Idempotent Unique Ticket Numbers</div>
                    <p className="text-slate-400 leading-relaxed">
                      Tickets follow <code className="text-emerald-400">DB2026-000001</code> sequential formatting and prevent duplicate issuance across repeated <code className="text-slate-200">successful_payment</code> updates.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'database' && (
          <div className="space-y-6">
            <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Customer &amp; Ticket Database Ledger
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time view of all Telegram customers, their state machine positions, payment IDs, and issued <code className="text-emerald-400">DB2026</code> tickets.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search name, phone, ticket, ID..."
                      className="bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <select
                    value={stateFilter}
                    onChange={(e) => setStateFilter(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                  >
                    <option value="ALL">All Conversation States</option>
                    {allStates.map((st) => (
                      <option key={st} value={st}>
                        State: {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 font-medium">
                      <th className="py-3 px-4">telegram_user_id</th>
                      <th className="py-3 px-4">name</th>
                      <th className="py-3 px-4">phone</th>
                      <th className="py-3 px-4">address</th>
                      <th className="py-3 px-4">conversation_state</th>
                      <th className="py-3 px-4">payment_id</th>
                      <th className="py-3 px-4">payment_status</th>
                      <th className="py-3 px-4 text-right">stars_amount</th>
                      <th className="py-3 px-4">ticket_number</th>
                      <th className="py-3 px-4 text-right">updated_at</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                    {filteredCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-8 text-center text-slate-500 font-sans">
                          No customer records match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredCustomers.map((cust) => (
                        <tr key={cust.telegram_user_id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 text-white font-medium">{cust.telegram_user_id}</td>
                          <td className="py-3 px-4 font-sans text-slate-200">{cust.name || '—'}</td>
                          <td className="py-3 px-4 text-slate-300">{cust.phone || '—'}</td>
                          <td className="py-3 px-4 font-sans text-slate-400 max-w-[200px] truncate" title={cust.address || ''}>
                            {cust.address || '—'}
                          </td>
                          <td className="py-3 px-4 text-amber-400">{cust.conversation_state}</td>
                          <td className="py-3 px-4 text-sky-400">{cust.payment_id || '—'}</td>
                          <td className="py-3 px-4">
                            <span
                              className={
                                cust.payment_status === 'PAID'
                                  ? 'text-emerald-400 font-semibold'
                                  : cust.payment_status === 'PENDING'
                                  ? 'text-amber-400'
                                  : cust.payment_status === 'FAILED'
                                  ? 'text-red-400'
                                  : 'text-slate-500'
                              }
                            >
                              {cust.payment_status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-amber-300">
                            {cust.payment_amount} ⭐️
                          </td>
                          <td className="py-3 px-4 text-emerald-400 font-semibold">
                            {cust.ticket_number || '—'}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-400">
                            {new Date(cust.updated_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </td>
                          <td className="py-3 px-4 text-right font-sans">
                            <button
                              onClick={() => {
                                handleSwitchSimUser(cust.telegram_user_id);
                                setActiveTab('simulator');
                              }}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 text-xs transition-colors whitespace-nowrap"
                            >
                              Inspect Chat
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SQL Schema Definition */}
            <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Production SQL DDL Schema</h3>
                  <p className="text-xs text-slate-400">
                    Exact table structure storing all required fields and unique constraints for <code className="text-slate-200">payment_id</code> and <code className="text-slate-200">ticket_number</code>.
                  </p>
                </div>
                <button
                  onClick={() => copyToClipboard('sql', overview?.sqlSchema || '')}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg border border-slate-700 flex items-center gap-1.5 whitespace-nowrap"
                >
                  {copiedKey === 'sql' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'sql' ? 'Copied SQL' : 'Copy SQL Schema'}
                </button>
              </div>
              <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
                {overview?.sqlSchema}
              </pre>
            </div>
          </div>
        )}

        {activeTab === 'webhooks' && (
          <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Server-Side Audit &amp; Telegram Stars Verification Logs
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Real-time structured event log capturing Telegram webhook updates, state transitions, 100 XTR pre-checkout validations, and atomic ticket issuance.
                </p>
              </div>
              <button
                onClick={fetchOverview}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg border border-slate-700 flex items-center gap-1.5 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh Logs
              </button>
            </div>

            <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950">
              <div className="max-h-[560px] overflow-y-auto divide-y divide-slate-800/60 font-mono text-xs tabular-nums">
                {(overview?.logs || []).map((log) => (
                  <div key={log.id} className="p-3 hover:bg-slate-900/60 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <span className="text-slate-500 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                    <span
                      className={`w-20 shrink-0 font-semibold ${
                        log.level === 'SECURITY' || log.level === 'ERROR'
                          ? 'text-red-400'
                          : log.level === 'WEBHOOK'
                          ? 'text-emerald-400'
                          : log.level === 'WARN'
                          ? 'text-amber-400'
                          : 'text-sky-400'
                      }`}
                    >
                      [{log.level}]
                    </span>
                    <span className="text-slate-400 w-36 shrink-0 truncate">
                      {log.component}
                    </span>
                    <span className="text-slate-200 flex-1">{log.message}</span>
                    {log.metadata && (
                      <code className="text-[11px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        {JSON.stringify(log.metadata)}
                      </code>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'architecture' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-6 space-y-4">
              <h2 className="text-base font-semibold text-white">
                01. Production Backend Endpoints (100 Telegram Stars ⭐️)
              </h2>
              <div className="space-y-3 text-xs">
                <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg">
                  <div className="font-mono font-semibold text-emerald-400">
                    POST /api/telegram/webhook
                  </div>
                  <p className="text-slate-400 mt-1 leading-relaxed">
                    Receives Telegram Bot API <code className="text-slate-200">Update</code> payloads (<code className="text-slate-200">message</code>, <code className="text-slate-200">callback_query</code>, <code className="text-slate-200">pre_checkout_query</code>, and <code className="text-slate-200">successful_payment</code>). Validates <code className="text-amber-400">currency === &quot;XTR&quot;</code> and <code className="text-amber-400">total_amount === 100</code>.
                  </p>
                </div>

                <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg">
                  <div className="font-mono font-semibold text-amber-400">
                    GET /api/telegram/status (?sync=1)
                  </div>
                  <p className="text-slate-400 mt-1 leading-relaxed">
                    Safe diagnostic endpoint that calls Telegram <code className="text-slate-200">getWebhookInfo</code> without exposing secrets, verifies registration against <code className="text-slate-200">https://100197-oqqb.vercel.app/api/telegram/webhook</code>, and automatically synchronizes <code className="text-slate-200">secret_token</code> and <code className="text-slate-200">allowed_updates</code>.
                  </p>
                </div>

                <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg">
                  <div className="font-mono font-semibold text-sky-400">
                    Invoice Payload Specification
                  </div>
                  <p className="text-slate-400 mt-1 leading-relaxed">
                    Every Telegram Stars invoice uses <code className="text-slate-200">currency: &quot;XTR&quot;</code>, <code className="text-slate-200">provider_token: &quot;&quot;</code>, and <code className="text-amber-400">prices: [{'{'}&quot;label&quot;:&quot;DiwaliBigdeal Entry&quot;,&quot;amount&quot;:100{'}'}]</code>.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-6 space-y-4">
              <h2 className="text-base font-semibold text-white">
                02. Telegram Webhook Registration Command
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Register your Telegram Bot webhook with <code className="text-slate-200">pre_checkout_query</code> enabled:
              </p>

              <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://100197-oqqb.vercel.app/api/telegram/webhook",
    "allowed_updates": ["message", "callback_query", "pre_checkout_query"]
  }'`}
              </pre>

              <div className="pt-2 border-t border-slate-800">
                <h3 className="text-xs font-semibold text-slate-200 mb-2">
                  Server-Side Environment Variable Status (Secrets Hidden)
                </h3>
                <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                  <div className="p-2.5 bg-slate-900 rounded border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400">TELEGRAM_BOT_TOKEN</span>
                    <span className={overview?.config.telegramBotTokenConfigured ? 'text-emerald-400' : 'text-amber-400'}>
                      {overview?.config.telegramBotTokenConfigured ? 'LIVE' : 'SIMULATOR MODE'}
                    </span>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400">CURRENCY</span>
                    <span className="text-amber-400">XTR</span>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400">PAYMENT_PROVIDER</span>
                    <span className="text-sky-400 uppercase">TELEGRAM_STARS</span>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400">STARS_AMOUNT</span>
                    <span className="text-emerald-400">100 Telegram Stars ⭐️</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
