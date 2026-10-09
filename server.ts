/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { CONFIG, getPublicConfigStatus } from './server/config.js';
import { db } from './server/db.js';
import { logger } from './server/logger.js';
import { handleTelegramUpdate } from './server/stateManager.js';
import {
  MAIN_MENU_INLINE_KEYBOARD,
  sendTelegramMessage,
  verifyTelegramWebhookSecret,
} from './server/telegramService.js';
import {
  computeWebhookSignature,
  createPaymentOrderForCustomer,
  processVerifiedPaymentWebhook,
  verifyPaymentWebhookSignature,
} from './server/paymentService.js';
import { TelegramUpdate } from './server/types.js';

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
// 1. PRODUCTION TELEGRAM WEBHOOK ENDPOINT
// POST /api/telegram/webhook
// ============================================================================
app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
  try {
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    const isInternalSimulator = req.headers['x-simulator-internal'] === 'true';

    if (!isInternalSimulator && CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN') {
      if (!verifyTelegramWebhookSecret(secretHeader)) {
        logger.security('TelegramWebhook', 'Rejected unauthorized Telegram webhook request (invalid secret token)');
        return res.status(401).json({ ok: false, error: 'Unauthorized Telegram webhook secret token' });
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
    });

    const customer = await handleTelegramUpdate(update);
    const chatId = String(
      update.message?.chat.id ||
        update.callback_query?.message?.chat.id ||
        update.callback_query?.from.id ||
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
// POST /api/payment/webhook
// Verifies HMAC-SHA256 signature before marking payment_status = PAID
// and generating a unique ticket DB2026-XXXXXX.
// ============================================================================
app.post('/api/payment/webhook', async (req: Request & { rawBody?: string }, res: Response) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const signature =
      (req.headers['x-razorpay-signature'] as string | undefined) ||
      (req.headers['x-payment-webhook-signature'] as string | undefined);

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

    // Parse standard Razorpay payload or unified payment webhook format
    const body = req.body as Record<string, any>;
    let paymentId = '';
    let eventStatus: 'PAID' | 'FAILED' = 'PAID';
    let amountInRupees = CONFIG.CAMPAIGN_ENTRY_FEE;

    if (body.payload?.payment_link?.entity) {
      // Razorpay payment_link.paid event
      const entity = body.payload.payment_link.entity;
      paymentId = entity.id;
      amountInRupees = Math.round(Number(entity.amount || 19900) / 100);
      eventStatus = body.event === 'payment_link.paid' ? 'PAID' : 'FAILED';
    } else if (body.payload?.payment?.entity) {
      // Razorpay payment.captured / payment.failed event
      const entity = body.payload.payment.entity;
      paymentId = entity.order_id || entity.id;
      amountInRupees = Math.round(Number(entity.amount || 19900) / 100);
      eventStatus = body.event === 'payment.failed' ? 'FAILED' : 'PAID';
    } else {
      // Direct / Custom webhook payload
      paymentId = String(body.payment_id || '');
      eventStatus = body.status === 'FAILED' ? 'FAILED' : 'PAID';
      amountInRupees = Number(body.amount || CONFIG.CAMPAIGN_ENTRY_FEE);
    }

    if (!paymentId) {
      return res.status(400).json({ ok: false, error: 'Missing payment_id in webhook payload' });
    }

    logger.webhook('PaymentWebhook', `Verified HMAC-SHA256 payment webhook for ${paymentId}`, {
      eventStatus,
      amountInRupees,
    });

    const result = await processVerifiedPaymentWebhook({
      paymentId,
      eventStatus,
      amountInRupees,
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
// 4. HOSTED PAYMENT CHECKOUT REDIRECT / SIMULATION HELPER
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
  <title>DiwaliBigdeal — ₹199 Payment Gateway</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; max-width: 420px; width: 100%; padding: 24px; box-sizing: border-box; }
    .title { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
    .sub { font-size: 13px; color: #94a3b8; margin-bottom: 20px; }
    .row { display: flex; justify-content: space-between; font-size: 14px; padding: 8px 0; border-bottom: 1px solid #334155; }
    .amount { font-size: 24px; font-weight: 700; color: #38bdf8; margin: 16px 0; }
    .btn { display: block; width: 100%; padding: 12px; border: none; border-radius: 8px; background: #16a34a; color: white; font-weight: 600; font-size: 14px; cursor: pointer; margin-top: 12px; }
    .note { font-size: 12px; color: #94a3b8; margin-top: 16px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">DiwaliBigdeal Payment Gateway</div>
    <div class="sub">Order ID: ${paymentId}</div>
    <div class="row"><span>Customer</span><strong>${customer.name || '-'}</strong></div>
    <div class="row"><span>Mobile</span><strong>${customer.phone || '-'}</strong></div>
    <div class="row"><span>Campaign</span><strong>DiwaliBigdeal Entry</strong></div>
    <div class="amount">₹${customer.payment_amount}</div>
    <div class="note">
      Note: Clicking Pay on Telegram opens this gateway. In accordance with security rules, your ticket is ONLY generated when the server-side payment webhook is cryptographically verified.
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

/**
 * Helper endpoint for the interactive Webhook Dispatcher to sign and fire a real server-side
 * webhook request to /api/payment/webhook (or test invalid signature rejection).
 */
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
      event: status === 'PAID' ? 'payment_link.paid' : 'payment.failed',
      payment_id,
      status,
      amount,
      timestamp: new Date().toISOString(),
    };

    const rawBody = JSON.stringify(webhookPayload);
    const validSignature = computeWebhookSignature(rawBody);
    const signatureToUse = tamper_signature
      ? '000000000000000000000000000000000000000000000000000000000000dead'
      : validSignature;

    // Verify using the exact same verification logic as POST /api/payment/webhook
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

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(CONFIG.PORT, '0.0.0.0', () => {
    logger.info(
      'Server',
      `DiwaliBigdeal Telegram Bot Backend running on http://0.0.0.0:${CONFIG.PORT}`
    );
  });
}

// Start the server when executed directly
if (process.env.VERCEL !== '1') {
  startServer();
}

export default app;
