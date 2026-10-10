# DiwaliBigdeal — Production Telegram Bot Backend

A Telegram-first campaign bot backend for **DiwaliBigdeal** (`100 Telegram Stars ⭐️` / `XTR` Entry) with persistent conversation state machine, server-side Telegram Stars (`pre_checkout_query` & `successful_payment`) validation, and atomic unique ticket generation (`DB2026-000001`).

## Features

- **Telegram-First Customer Flow**:
  - Main Menu: `🎟️ Join Entry (100 Telegram Stars ⭐️)`, `🎫 My Ticket`, `🏆 Prize Details`, `🆘 Support`
  - Step-by-step registration: Full Name → Mobile Number (validated) → Complete Address → Confirmation (`✅ Confirm & Pay 100 Telegram Stars ⭐️` / `✏️ Edit Details`) → Payment (`💰 Pay 100 Telegram Stars ⭐️`)
  - **Zero Cancel Buttons**: No cancel buttons appear in the confirmation or payment flow.
- **Persistent State Machine**:
  - States: `idle`, `waiting_for_name`, `waiting_for_phone`, `waiting_for_address`, `waiting_for_confirmation`, `waiting_for_payment`, `completed`.
  - Remembers customer progress across sessions by `telegram_user_id`.
- **Telegram Stars (`XTR`) Payment Verification**:
  - Every invoice uses `currency: "XTR"`, `provider_token: ""`, and `prices: [{"label":"DiwaliBigdeal Entry","amount":100}]`.
  - Clicking `💰 Pay 100 Telegram Stars ⭐️` never marks an entry as paid.
  - Handles `pre_checkout_query` and validates `currency === "XTR"` and `total_amount === 100`.
  - Only after receiving a verified `successful_payment` (`currency === "XTR"`, `total_amount === 100`) does the system mark `payment_status = PAID`, generate a unique ticket (`DB2026-XXXXXX`), prevent duplicate tickets for the same payment, and send the automatic confirmation message to the user's Telegram chat.

## Environment Variables

Copy `.env.example` to `.env` (or configure in Vercel Project Settings):

```bash
cp .env.example .env
```

Required variables:
- `TELEGRAM_BOT_TOKEN`: Telegram Bot token from `@BotFather`
- `TELEGRAM_WEBHOOK_SECRET`: Optional secret token for `X-Telegram-Bot-Api-Secret-Token` validation
- `PAYMENT_PROVIDER`: `telegram_stars`
- `TELEGRAM_STARS_AMOUNT`: `100`
- `CAMPAIGN_ENTRY_FEE`: `100`
- `APP_URL`: Deployed application URL (`https://100197-oqqb.vercel.app`)

## Running Locally

```bash
npm install
npm run dev
```

## Deploying to Vercel

1. Push this repository to GitHub (`main` branch).
2. Vercel builds and deploys `/api/telegram/webhook.js`, `/api/health.js`, and `/api/index.js`.
3. Register the Telegram webhook (including `pre_checkout_query` for Telegram Stars):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://100197-oqqb.vercel.app/api/telegram/webhook",
    "allowed_updates": ["message", "callback_query", "pre_checkout_query"]
  }'
```
