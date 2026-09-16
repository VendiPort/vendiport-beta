# VendiPort beta

Phone-first **virtual vending machine** for sealed trading cards + same-day local tote delivery.

**Live beta:** https://vendiport-beta.onrender.com  
(Auto-deploys from `main` · free-tier disk may reset · no live Stripe/courier)

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

## Deploy

See **[DEPLOY.md](./DEPLOY.md)** (Render free + GoDaddy DNS for vendiport.com later).
