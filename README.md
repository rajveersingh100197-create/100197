# DiwaliBigdeal — Production Telegram Bot Backend

A Telegram-first campaign bot backend for **DiwaliBigdeal** (₹199 Entry) with persistent conversation state machine, server-side payment webhook verification (`HMAC-SHA256`), and atomic unique ticket generation (`DB2026-000001`).

## Features

- **Telegram-First Customer Flow**:
  - Main Menu: `🎟️ Join ₹199 Entry`, `🎫 My Ticket`, `🏆 Prize Details`, `🆘 Support`
  - Step-by-step registration: Full Name → Mobile Number (validated) → Complete Address → Confirmation (`✅ Confirm & Pay ₹199` / `✏️ Edit Details`) → Payment (`💰 PAY ₹199`)
  - **Zero Cancel Buttons**: No cancel buttons appear in the confirmation or payment flow.
- **Persistent State Machine**:
  - States: `idle`, `waiting_for_name`, `waiting_for_phone`, `waiting_for_address`, `waiting_for_confirmation`, `waiting_for_payment`, `completed`.
  - Remembers customer progress across sessions by `telegram_user_id`.
- **Cryptographic Payment Webhook Verification**:
  - Clicking `💰 PAY ₹199` never marks an entry as paid.
  - `POST /api/payment/webhook` validates the `HMAC-SHA256` signature using `PAYMENT_WEBHOOK_SECRET`.
  - Only after a verified `PAID` webhook is received does the system mark `payment_status = PAID`, generate a unique ticket (`DB2026-000001`), and send the automatic confirmation message to the user's Telegram chat.

## Environment Variables

Copy `.env.example` to `.env` (or configure in Vercel Project Settings):

```bash
cp .env.example .env
```

Required variables:
- `TELEGRAM_BOT_TOKEN`: Telegram Bot token from `@BotFather`
- `TELEGRAM_WEBHOOK_SECRET`: Secret token for `X-Telegram-Bot-Api-Secret-Token` validation
- `PAYMENT_PROVIDER`: `razorpay` (default)
- `PAYMENT_KEY_ID`: Payment gateway API key ID
- `PAYMENT_KEY_SECRET`: Payment gateway API key secret
- `PAYMENT_WEBHOOK_SECRET`: Webhook secret for HMAC-SHA256 verification
- `CAMPAIGN_ENTRY_FEE`: `199`
- `APP_URL`: Deployed application URL

## Running Locally

```bash
npm install
npm run dev
```

## Deploying to Vercel

1. Push this repository to GitHub.
2. Import the repository into Vercel.
3. Configure the environment variables from `.env.example` in Vercel Settings.
4. Register the Telegram webhook:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<YOUR_VERCEL_DOMAIN>/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```
