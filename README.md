# VendiPort beta

Phone-first **virtual vending machine** for sealed trading cards + same-day local tote delivery.

**Live beta:** https://vendiport-beta.onrender.com  
(Auto-deploys from `main` · free-tier disk may reset · Pay **stub** by default · optional Stripe **TEST** keys · no live courier)

Buyer UI is **one anonymous machine** — never shows shop name. Membership is top-right (`/account`) before checkout. Tote bags have **pre-printed QR**; buyers scan that tote QR at the door.

## Run locally

```bash
npm start
# → http://127.0.0.1:3847/health → {"ok":true}
```

| Role | URL |
|------|-----|
| Buyer machine | http://localhost:3847/ |
| Track order | http://localhost:3847/track/&lt;orderId&gt; |
| Shop Jobs / Stats | http://localhost:3847/shop |
| Account / membership | http://localhost:3847/account |
| Handoff | http://localhost:3847/handoff/&lt;orderId&gt; |
| Live | https://vendiport-beta.onrender.com |

## Happy path

1. Buyer → push slot → checkout → Pay stub → **Track** `/track/<id>` (Paid → Packing → Ready → Out → Arrive → Scan tote QR)
2. Shop Jobs → pack photo (product + tote QR in frame) → seal zip+VOID → READY → pickup → arrive
3. Handoff → scan/upload **QR on tote bag** to accept

Shop tabs: **Jobs · Inventory · Windows · Stats** (orders today by status, units listed, own-driver).

Product photos: shops should upload the sealed box on a **white / light** background — VendiPort white-keys the subject onto a shared galaxy frame automatically.

## Deploy

See **[DEPLOY.md](./DEPLOY.md)** (Render free + GoDaddy DNS for vendiport.com later).


## Payments (stub vs Stripe TEST)

Runs **without any Stripe keys** (Pay stub). To enable **test-mode** Checkout later on Render:

1. Stripe Dashboard → Developers → API keys → copy **test** `sk_test_…` and `pk_test_…` (never `sk_live_` / `pk_live_`).
2. Render → Environment → add:
   - `STRIPE_SECRET_KEY` = `sk_test_…`
   - `STRIPE_PUBLISHABLE_KEY` = `pk_test_…`
   - Optional: `PUBLIC_BASE_URL` = `https://vendiport-beta.onrender.com` (or custom domain)
   - Optional: `STRIPE_WEBHOOK_SECRET` (webhook scaffold only)
3. Redeploy. Buyer Pay redirects to Stripe Checkout (test card `4242 4242 4242 4242`).
4. **Never commit secrets.** See **DEPLOY.md** + **DNS.md**.

`GET /api/payments/config` → `{ mode: "stub" | "stripe_test" }`.
