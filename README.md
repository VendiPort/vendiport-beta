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


## New features (beta round 2)

**Buyer** — ZIP/area check with saved address; ★ **Radar** (follow a wanted card/box, alerts when a shop lists it; also on the member page); "On your radar" badges; order **status timeline** (Paid → Packing → Ready → Out → Arrived) with simulated masked-phone text log, delivery code, one-tap cancel with reason, rating; **seal check** at the door ("No" opens a dispute); **? key** = "How VendiPort works"; **My Collection** (`/collection`) and **box breaks**.

**Box breaks** — paste a link from *any* social platform (YouTube, TikTok, Instagram, Vimeo, Twitch embed inline; Facebook, X, others show a "Watch on <platform>" card). Photos optional. Marketing-consent checkbox (default off), public/private toggle, public gallery `/breaks`, permalink `/breaks/<id>`, share link + branded SVG share card.

**Shop** — Wanted feed (ranked by ZIP demand, "I have this"), Earnings tab, pause switch, packing checklist with sealed-box photo (required before READY), low-stock / sold-out flags and "Someone wants this" badges.

**Admin / owner** — `/admin` (passcode): Dashboard, Demand, Sales & money, Fulfillment, Trust & safety, Stores, Product health, Disputes, Shop approval, Content queue. See `VendiPort-Owner-Diagnostics.md`.

**Pages:** `/admin` `/collection` `/my-collection` `/my-breaks` `/radar` `/breaks` `/breaks/<id>`
**API (under `/api`):** `area`, `buyer/:id`, `search`, `events`, `radar`, `wanted`, `wanted/have`, `shop/{status,pause,earnings,verify}`, `orders/:id/{buyer,notify,arrive-proof,pack-checklist,dispute,rate}`, `collection`, `breaks` (+`/public`, `/mine`, `/:id`, `/:id/card.svg`, `/:id/share`, `/:id/view`), `admin/*`.

**Env vars:** `ADMIN_PASSCODE` (default `vendiport-admin-dev`), `SERVICE_ZIPS` (comma list overriding the demo Bay Area service ZIPs), `REQUIRE_PACK_CHECKLIST` (`0` to not require the checklist before READY).

**Tests:** `npm test` (smoke tests on a temp data dir).
**Demo data:** seeded into `extras.json` in `DATA_DIR` on first run (tagged `demo:true`; "Reset demo data" in `/admin`). Render's free disk resets, so it reseeds.
**Stubs:** SMS (simulated), payments, photo storage (local disk).
