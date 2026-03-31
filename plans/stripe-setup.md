# Stripe Setup Guide

## 1. Create Products & Prices

In [Stripe Dashboard > Products](https://dashboard.stripe.com/products):

1. **Create product** "Veradic Pro Monthly"
   - Price: $9.99 / month (recurring)
   - Copy the Price ID (starts with `price_`)

2. **Create product** "Veradic Pro Yearly"
   - Price: $59.99 / year (recurring)
   - Copy the Price ID (starts with `price_`)

## 2. Configure Customer Portal

In [Stripe Dashboard > Settings > Billing > Customer Portal](https://dashboard.stripe.com/settings/billing/portal):

- Enable: Cancel subscription, Update payment method, View invoices
- Enable: Switch between plans (monthly ↔ yearly)
- Set cancellation behavior: Cancel at end of billing period

## 3. Set Up Webhook

In [Stripe Dashboard > Developers > Webhooks](https://dashboard.stripe.com/webhooks):

1. **Add endpoint**: `https://math-teacher-api.up.railway.app/v1/webhooks/stripe`
2. **Select events**:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.paid`
3. Copy the **Signing secret** (starts with `whsec_`)

## 4. Get API Keys

In [Stripe Dashboard > Developers > API Keys](https://dashboard.stripe.com/apikeys):

- Copy the **Secret key** (starts with `sk_test_` or `sk_live_`)

## 5. Set Environment Variables

### Railway (backend)
```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_MONTHLY=price_...
STRIPE_PRICE_ID_YEARLY=price_...
```

### Vercel (web frontend)
```
NEXT_PUBLIC_STRIPE_PRICE_MONTHLY=price_...
NEXT_PUBLIC_STRIPE_PRICE_YEARLY=price_...
```

## 6. Run Database Migration

```bash
alembic upgrade head
```

## 7. Test with Stripe CLI (local dev)

```bash
stripe listen --forward-to localhost:8000/v1/webhooks/stripe
stripe trigger checkout.session.completed
```

Test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0002` (decline)
