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
2. Shop Jobs → pack photo (product + tote QR in frame) → confirm bag sealed → READY → pickup → arrive
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

**Buyer** — ZIP/area check with saved address; ★ **Radar** (follow a wanted card/box, alerts when a shop lists it; also on the member page); "On your radar" badges; order **status timeline** (Paid → Packing → Ready → Out → Arrived) with simulated masked-phone text log, delivery code, one-tap cancel with reason, rating; **accept-or-refuse at the door** (see below); **? key** = "How VendiPort works"; **My Collection** (`/collection`) and **box breaks**.

**Box breaks** — paste a link from *any* social platform (YouTube, TikTok, Instagram, Vimeo, Twitch embed inline; Facebook, X, others show a "Watch on <platform>" card). Photos optional. Marketing-consent checkbox (default off), public/private toggle, public gallery `/breaks`, permalink `/breaks/<id>`, share link + branded SVG share card.

**Shop** — Wanted feed (ranked by ZIP demand, "I have this"), Earnings tab, pause switch, packing checklist with sealed-box photo (required before READY), low-stock / sold-out flags and "Someone wants this" badges.

**Admin / owner** — `/admin` (passcode): Dashboard, Demand, Sales & money, Fulfillment, Trust & safety, Stores, Product health, Disputes, Shop approval, Content queue. See `VendiPort-Owner-Diagnostics.md`.

**Pages:** `/admin` `/collection` `/my-collection` `/my-breaks` `/radar` `/breaks` `/breaks/<id>`
**API (under `/api`):** `area`, `buyer/:id`, `search`, `events`, `radar`, `wanted`, `wanted/have`, `shop/{status,pause,earnings,verify}`, `orders/:id/{buyer,notify,arrive-proof,pack-checklist,dispute,rate}`, `collection`, `breaks` (+`/public`, `/mine`, `/:id`, `/:id/card.svg`, `/:id/share`, `/:id/view`), `admin/*`.

**Env vars:** `ADMIN_PASSCODE` (default `Montana`), `SERVICE_ZIPS` (comma list overriding the demo Bay Area service ZIPs), `REQUIRE_PACK_CHECKLIST` (`0` to not require the checklist before READY).

**Tests:** `npm test` (smoke tests on a temp data dir).
**Demo data:** seeded into `extras.json` in `DATA_DIR` on first run (tagged `demo:true`; "Reset demo data" in `/admin`). Render's free disk resets, so it reseeds.
**Stubs:** SMS (simulated), payments, photo storage (local disk).


## Packing, acceptance and claims (round 3)

**Acceptance rule (shown at checkout, in membership terms, on the handoff screen next to Accept, on the track page, in shop onboarding and the packing step):**
"Inspect your sealed bag before accepting. If the tear strip is pulled, the seal is lifted, or the bag looks opened, do not accept it — choose Refuse / Report and you'll be refunded in full. By accepting, you acknowledge receipt of the order in sealed condition and that the sale is final."
There is no mandatory Yes/No seal question. At the door the buyer scans the tote QR and taps **Accept**, or taps **"Bag looks tampered — don't accept"** (Refuse / Report): full refund immediately, and a dispute record opens with an optional note and photo (`POST /api/orders/:id/refuse`).

**Two shop photos drive the order flow (both tied to the original bag QR scan):**
1. **Photo 1 — before sealing:** product placed on/over the bag's QR, QR visible (`POST /api/orders/:id/pack-photo`). Starts PACKING and links the bag QR to the order; stored with the QR payload and timestamp.
2. **Photo 2 — after sealing:** the sealed bag with QR-in-V and seal strip visible (`POST /api/orders/:id/pack-sealed`; needs the packing checklist ticked and the same QR as Photo 1). Marks the order **READY** and **automatically calls delivery**: a dispatch request is created, logged in the order timeline and text log, and listed in admin → Fulfillment. If the shop uses **its own driver** (own-driver toggle), no courier is requested and the shop is notified instead (shown on the shop Earnings tab). **This is a stub — no real courier API.**
`/ready` and the old `/seal` step are superseded (`/seal` returns 410).

**Evidence record** (buyer order/handoff page, and admin dispute screen): Photo 1 · Photo 2 · door photo, with the QR chain (Photo 1 = Photo 2, door scan matched), arrival/acceptance timestamps. It is the supporting record, not the headline: the acceptance rule leads.

**Admin dispute screen (`/admin` → Disputes, summary in Trust & safety):** side-by-side before / sealed / at-door comparison; timeline with credibility hints (report within ~30 min of arrival = credible; no Arrived event or long after = weak; **an accepted order with a later seal claim is weak by default**); buyer / store / driver claim history (30 days) with repeat flags; a computed **Recommended action** with a one-line reason (Refund/Replace, Request more proof, or Deny claim). Actions: **Refund buyer** (no return), **Replace box**, **Request more proof** (24 h deadline, status "Awaiting proof", simulated text + in-app message, buyer adds a photo/note on the track page), **Deny claim**. Fault selector: **Shop** (optional **Charge to shop** deducts the order amount from that shop's payout — a payout adjustment shown on the shop Earnings tab and in admin Stores/Sales), **Delivery** (absorbed by VendiPort, logged against the driver), **Buyer** (adds a strike; refunds auto-hold for review after 2 claims in 30 days, release with an explicit override), **Unclear**. Every action is written to a **resolution log** (who/when/outcome/amount/fault) on the dispute and in a Trust & safety table, with a pattern view of claims by store/driver/buyer, a "repeat offender" badge and a recommended consequence (rating hit / listing review).

**Deny claim** sends the buyer, in-app and as a simulated text, this standard message (status wording: **"Claim denied"**), with an optional owner note appended:
"We have completed our review of your claim based on the records for this order, including the packaging photos, the delivery photo, and the QR scan records. Based on that review, we are unable to approve your claim, and no refund or replacement will be issued for this order. This decision is based on the information available to us and does not waive any of VendiPort's rights or any provision of the Terms of Service. If you have additional information, you may submit it within 7 days and we will consider it."

**20-store DEMO / projected view (`/admin`, "20-store demo view" toggle on Dashboard, Demand, Sales & money and Stores; `GET /api/admin/network`):** 20 seeded stores across SF-area neighborhoods/ZIPs with modest, varied sizes (one realistic standout ≈2.5× the median), per-store orders/week, GMV, VendiPort take, shop payout and fill rate; a network rollup (orders/day, weekly/monthly GMV, VendiPort revenue = take + $1.99 memberships, AOV, same-day success, ~1.4% dispute rate), a ZIP demand heat map and a visible **Assumptions** panel. Everything is labelled DEMO / projected and is computed from the assumptions in `lib/network.js`; the take rate comes from `PLATFORM_TAKE` in code (15%). Real LIVE numbers stay on the normal view.

**Legal review needed:** the acceptance, denial and terms wording above is a product draft. Have a **California attorney** review the terms and dispute wording before launch — in particular arbitration, limitation of liability and record retention (how long photos, QR scans and timestamps are kept).

**Tests:** `npm test` covers the two-photo flow, dispatch (own-driver vs courier), refuse/report, recommend, request-proof, deny wording, charge-to-shop payout adjustment, buyer strike hold, patterns/log and the 20-store model.
