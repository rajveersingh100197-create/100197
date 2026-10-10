/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response, NextFunction } from 'express';
import { CONFIG, getPublicConfigStatus } from './config';
import { db } from './db';
import { logger } from './logger';
import { handleTelegramUpdate } from './stateManager';
import {
  MAIN_MENU_INLINE_KEYBOARD,
  sendTelegramMessage,
  verifyTelegramWebhookSecret,
} from './telegramService';
import {
  computeWebhookSignature,
  createPaymentOrderForCustomer,
  processVerifiedPaymentWebhook,
  verifyPaymentWebhookSignature,
} from './paymentService';
import { TelegramUpdate } from './types';

export const app = express();

// Capture rawBody for cryptographic webhook signature verification
app.use(
  express.json({
    verify: (req: Request & { rawBody?: string }, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

// ============================================================================
// 0. STATELESS HEALTH-CHECK ENDPOINT (No Telegram Secrets or Database Required)
// GET /api/health
// ============================================================================
app.get('/api/health', (_req: Request, res: Response) => {
  const status = getPublicConfigStatus();
  return res.status(200).json({
    ok: true,
    status: 'HEALTHY',
    endpoint: '/api/health',
    service: 'DiwaliBigdeal Telegram Bot Backend',
    runtime: process.env.VERCEL ? 'vercel-serverless' : 'node',
    payment_mode: 'telegram_stars (XTR)',
    entry_fee_inr: status.entryFee,
    stars_amount: status.starsAmount,
    telegram_bot_token_configured: status.telegramBotTokenConfigured,
    telegram_webhook_secret_configured: status.telegramWebhookSecretConfigured,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// 1. PRODUCTION TELEGRAM WEBHOOK ENDPOINT
// POST /api/telegram/webhook
// GET  /api/telegram/webhook (Diagnostic Health Response)
// ============================================================================
app.get('/api/telegram/webhook', (_req: Request, res: Response) => {
  const status = getPublicConfigStatus();
  return res.status(200).json({
    ok: true,
    service: 'DiwaliBigdeal Telegram Bot Webhook',
    endpoint: '/api/telegram/webhook',
    status: 'READY',
    supported_methods: ['POST', 'GET'],
    supported_updates: ['message', 'callback_query', 'pre_checkout_query'],
    payment_mode: 'telegram_stars (XTR)',
    entry_fee_inr: status.entryFee,
    stars_amount: status.starsAmount,
    telegram_bot_token_configured: status.telegramBotTokenConfigured,
    telegram_webhook_secret_configured: status.telegramWebhookSecretConfigured,
    instructions:
      'Send POST requests with Telegram Bot API Update JSON payloads to this endpoint. Register via https://api.telegram.org/bot<TOKEN>/setWebhook',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
  try {
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    const isInternalSimulator = req.headers['x-simulator-internal'] === 'true';

    // Validate Telegram secret token ONLY when the user explicitly sets TELEGRAM_WEBHOOK_SECRET in env
    if (
      !isInternalSimulator &&
      process.env.TELEGRAM_WEBHOOK_SECRET &&
      process.env.TELEGRAM_WEBHOOK_SECRET !== 'YOUR_TELEGRAM_WEBHOOK_SECRET'
    ) {
      if (!verifyTelegramWebhookSecret(secretHeader)) {
        logger.security(
          'TelegramWebhook',
          'Rejected unauthorized Telegram webhook request (invalid secret token)'
        );
        return res
          .status(401)
          .json({ ok: false, error: 'Unauthorized Telegram webhook secret token' });
      }
    }

    const update = req.body as TelegramUpdate;
    if (!update || typeof update.update_id !== 'number') {
      logger.warn('TelegramWebhook', 'Rejected malformed Telegram update payload');
      return res.status(400).json({ ok: false, error: 'Invalid Telegram Update payload' });
    }

    logger.webhook('TelegramWebhook', `Received Telegram update_id=${update.update_id}`, {
      hasMessage: Boolean(update.message),
      hasCallbackQuery: Boolean(update.callback_query),
      hasPreCheckoutQuery: Boolean(update.pre_checkout_query),
      hasSuccessfulPayment: Boolean(update.message?.successful_payment),
    });

    const customer = await handleTelegramUpdate(update);
    const chatId = String(
      update.message?.chat.id ||
        update.callback_query?.message?.chat.id ||
        update.callback_query?.from.id ||
        update.pre_checkout_query?.from.id ||
        ''
    );

    return res.status(200).json({
      ok: true,
      customer,
      chatHistory: chatId ? db.getChatHistory(chatId) : [],
    });
  } catch (err) {
    logger.error('TelegramWebhook', 'Unhandled error processing Telegram update', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
});

// ============================================================================
// 2. PAYMENT CREATION ENDPOINT (SERVER-SIDE)
// POST /api/payment/create
// ============================================================================
app.post('/api/payment/create', async (req: Request, res: Response) => {
  try {
    const { telegram_user_id } = req.body as { telegram_user_id?: string };
    if (!telegram_user_id) {
      return res.status(400).json({ ok: false, error: 'telegram_user_id is required' });
    }

    const customer = db.getCustomerByUserId(String(telegram_user_id));
    if (!customer) {
      return res.status(404).json({ ok: false, error: 'Customer not found' });
    }

    const paymentResult = await createPaymentOrderForCustomer(customer);
    return res.status(200).json({
      ok: true,
      payment: paymentResult,
      customer: db.getCustomerByUserId(String(telegram_user_id)),
    });
  } catch (err) {
    logger.error('PaymentAPI', 'Failed to create payment request', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Payment creation error',
    });
  }
});

// ============================================================================
// 3. SERVER-SIDE PAYMENT WEBHOOK ENDPOINT
// GET  /api/payment/webhook (Diagnostic Status)
// POST /api/payment/webhook (Signed Webhook Verification)
// ============================================================================
app.get('/api/payment/webhook', (_req: Request, res: Response) => {
  return res.status(200).json({
    ok: true,
    service: 'DiwaliBigdeal Payment Verification Endpoint',
    endpoint: '/api/payment/webhook',
    payment_provider: 'telegram_stars',
    note: 'Telegram Stars payments are verified natively via pre_checkout_query and successful_payment updates on /api/telegram/webhook, or via HMAC-SHA256 signed POST requests to /api/payment/webhook.',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/payment/webhook', async (req: Request & { rawBody?: string }, res: Response) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const signature = req.headers['x-payment-webhook-signature'] as string | undefined;

    if (!verifyPaymentWebhookSignature(rawBody, signature)) {
      logger.security(
        'PaymentWebhook',
        'Rejected payment webhook due to invalid HMAC-SHA256 signature',
        { providedSignature: signature || 'missing' }
      );
      return res.status(401).json({
        ok: false,
        error: 'Invalid webhook cryptographic signature (HMAC-SHA256 verification failed)',
      });
    }

    const body = req.body as Record<string, any>;
    const paymentId = String(body.payment_id || body.invoice_payload || '');
    const eventStatus: 'PAID' | 'FAILED' = body.status === 'FAILED' ? 'FAILED' : 'PAID';
    const amountInRupees = Number(body.amount || CONFIG.CAMPAIGN_ENTRY_FEE);

    if (!paymentId) {
      return res.status(400).json({ ok: false, error: 'Missing payment_id in webhook payload' });
    }

    logger.webhook('PaymentWebhook', `Verified payment webhook for ${paymentId}`, {
      eventStatus,
      amountInRupees,
    });

    const result = await processVerifiedPaymentWebhook({
      paymentId,
      eventStatus,
      amountInRupees,
      telegramPaymentChargeId: body.telegram_payment_charge_id,
    });

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err) {
    logger.error('PaymentWebhook', 'Error processing verified payment webhook', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Webhook processing failed',
    });
  }
});

// ============================================================================
// 4. HOSTED PAYMENT CHECKOUT INFO PAGE
// GET /api/payment/checkout/:paymentId
// ============================================================================
app.get('/api/payment/checkout/:paymentId', (req: Request, res: Response) => {
  const { paymentId } = req.params;
  const customer = db.getCustomerByPaymentId(paymentId);
  if (!customer) {
    return res.status(404).send('Payment session not found.');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DiwaliBigdeal — Telegram Stars Payment</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; max-width: 420px; width: 100%; padding: 24px; box-sizing: border-box; }
    .title { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
    .sub { font-size: 13px; color: #94a3b8; margin-bottom: 20px; }
    .row { display: flex; justify-content: space-between; font-size: 14px; padding: 8px 0; border-bottom: 1px solid #334155; }
    .amount { font-size: 24px; font-weight: 700; color: #fbbf24; margin: 16px 0; }
    .note { font-size: 12px; color: #94a3b8; margin-top: 16px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">DiwaliBigdeal — Telegram Stars (XTR)</div>
    <div class="sub">Invoice Payload: ${paymentId}</div>
    <div class="row"><span>Customer</span><strong>${customer.name || '-'}</strong></div>
    <div class="row"><span>Mobile</span><strong>${customer.phone || '-'}</strong></div>
    <div class="row"><span>Campaign</span><strong>DiwaliBigdeal Entry</strong></div>
    <div class="amount">⭐ ${CONFIG.TELEGRAM_STARS_AMOUNT} Stars (₹${customer.payment_amount})</div>
    <div class="note">
      In live Telegram, tapping Pay opens the native Telegram Stars (XTR) checkout sheet directly inside Telegram. Your ticket is generated only after Telegram delivers the verified successful_payment update.
    </div>
  </div>
</body>
</html>`);
});

// ============================================================================
// 5. ADMIN & TELEMETRY / SIMULATOR INSPECTION ENDPOINTS
// ============================================================================
app.get('/api/admin/overview', (_req: Request, res: Response) => {
  const customers = db.listAllCustomers();
  const logs = logger.getRecentLogs(80);
  const configStatus = getPublicConfigStatus();

  const stats = {
    totalCustomers: customers.length,
    confirmedTickets: customers.filter((c) => c.payment_status === 'PAID' && c.ticket_number).length,
    pendingPayments: customers.filter((c) => c.payment_status === 'PENDING').length,
    totalRevenueInr:
      customers.filter((c) => c.payment_status === 'PAID' && c.ticket_number).length *
      CONFIG.CAMPAIGN_ENTRY_FEE,
  };

  return res.json({
    ok: true,
    config: configStatus,
    stats,
    customers,
    logs,
    sqlSchema: db.getSQLSchemaDDL(),
  });
});

app.get('/api/admin/chat/:chatId', (req: Request, res: Response) => {
  const { chatId } = req.params;
  const customer = db.getCustomerByUserId(chatId);
  const history = db.getChatHistory(chatId);
  return res.json({
    ok: true,
    customer,
    chatHistory: history,
  });
});

app.post('/api/admin/trigger-payment-webhook', async (req: Request, res: Response) => {
  try {
    const {
      payment_id,
      status = 'PAID',
      amount = 199,
      tamper_signature = false,
    } = req.body as {
      payment_id: string;
      status?: 'PAID' | 'FAILED';
      amount?: number;
      tamper_signature?: boolean;
    };

    if (!payment_id) {
      return res.status(400).json({ ok: false, error: 'payment_id is required' });
    }

    const webhookPayload = {
      event: status === 'PAID' ? 'telegram_stars.successful_payment' : 'telegram_stars.failed',
      payment_id,
      status,
      amount,
      currency: 'XTR',
      timestamp: new Date().toISOString(),
    };

    const rawBody = JSON.stringify(webhookPayload);
    const validSignature = computeWebhookSignature(rawBody);
    const signatureToUse = tamper_signature
      ? '000000000000000000000000000000000000000000000000000000000000dead'
      : validSignature;

    if (!verifyPaymentWebhookSignature(rawBody, signatureToUse)) {
      logger.security(
        'PaymentWebhook',
        `Rejected tampered webhook signature for payment_id=${payment_id}`,
        { signatureToUse }
      );
      return res.status(401).json({
        ok: false,
        error: 'Webhook rejected: Invalid HMAC-SHA256 signature',
        signatureUsed: signatureToUse,
      });
    }

    const result = await processVerifiedPaymentWebhook({
      paymentId: payment_id,
      eventStatus: status,
      amountInRupees: Number(amount),
    });

    return res.status(200).json({
      ok: true,
      signatureVerified: true,
      signatureUsed: signatureToUse,
      ...result,
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to trigger webhook',
    });
  }
});

app.post('/api/admin/reset-customer', async (req: Request, res: Response) => {
  const { telegram_user_id } = req.body as { telegram_user_id?: string };
  if (!telegram_user_id) {
    return res.status(400).json({ ok: false, error: 'telegram_user_id required' });
  }
  db.resetCustomerForTesting(String(telegram_user_id));
  const customer = db.getOrCreateCustomer(String(telegram_user_id), String(telegram_user_id));
  await sendTelegramMessage(
    String(telegram_user_id),
    [
      '🪔 Welcome to DiwaliBigdeal!',
      '',
      'Entry Fee: ₹199',
      'Win Mahindra Thar ROXX, Double-Door Refrigerator, Smart LED TV & Multiple Cash Prizes!',
      '',
      'Please choose an option below:',
    ].join('\n'),
    MAIN_MENU_INLINE_KEYBOARD
  );
  return res.json({
    ok: true,
    customer,
    chatHistory: db.getChatHistory(String(telegram_user_id)),
  });
});

// Centralized Error Handling Middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('ExpressServer', 'Unhandled request error', {
    message: err.message,
  });
  res.status(500).json({ ok: false, error: 'Internal Server Error' });
});

export default app;
