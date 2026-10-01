# VendiPort — Owner Diagnostics (`/admin`)

Open `https://vendiport-beta.onrender.com/admin`. Enter the passcode (env `ADMIN_PASSCODE`, default `vendiport-admin-dev` — **set your own on Render**).
Every number is tagged **LIVE** (computed from real orders/follows in the JSON state) or **DEMO** (seeded sample data so the dashboard looks alive; flagged `demo:true`, wiped with "Reset demo data").

| Tab | What it shows | LIVE | DEMO |
|---|---|---|---|
| **Dashboard** | Orders today, revenue, active stores, open disputes, late orders list, pending shop approvals, pending content | orders, revenue, late, disputes, approvals | sample trend lines |
| **Demand** | Top wanted items + 7-day growth, demand by ZIP vs active stores, unfilled demand ("recruit a shop here"), radar alert → order conversion, zero-result searches | real radar follows & searches | 100 seeded radar entries across 16 items / ZIPs, conversion |
| **Sales & money** | Revenue per day (14d), live revenue by day, membership (members, churn), referrals, payouts owed per store, payout adjustments (claims charged to shops), refunds | live revenue/orders, real payouts owed | daily series, membership, referrals, refunds |
| **Fulfillment** | Paid → packed → ready → delivered times, late orders by store, cancel reasons, refused/failed handoffs, delivery-service calls triggered by Photo 2 (stub; own-driver shops skipped) | timings from real order timelines, real cancels, door refusals | averages, extra cancel reasons, failed handoffs |
| **Trust & safety** | Seal-not-intact reports by store, ratings by store / delivery, claim patterns by store / driver / buyer (repeat-offender badge + consequence), resolution log table, buyers on refund hold | real seal checks and ratings | sample reports and ratings |
| **Stores** | Store list (ZIP, status, SKUs, units, low stock, "I have" count, verification), fastest Wanted responders | the real shop(s) | 5 demo stores, responder times |
| **Product health** | Funnel (visit → view → cart → order), out-of-area visitors by ZIP, error counts by type | out-of-area ZIP checks, server errors | funnel, sample errors |
| **Disputes** | Judgment tools: before / sealed / at-door photo comparison, timeline + credibility hints, buyer/store/driver claim history, Recommended action + reason, one-click Refund / Replace / Request proof (24h) / Deny claim, fault selector (Shop → Charge to shop, Delivery → absorbed + driver log, Buyer → strike + refund hold), resolution log | real claims from Refuse / Report and post-acceptance claims | 9 demo claims (open, awaiting proof, denied, resolved) |
| **Shop approval** | Pending shop verification — approve / reject | real submissions | 3 pending demo shops |
| **Content queue** | Box breaks from any social platform: marketing-consent breaks, approve / reject, download package (link + hits + card), top performers by views/shares, hide/unhide any upload | real buyer breaks | 6 demo breaks |

**Reset demo data** removes only `demo:true` records; live data is untouched.
**Not real yet:** payments (Stripe test/stub), SMS (simulated, masked phone), photo storage (local disk, resets on Render free tier).

## 20-store DEMO / projected view
A toggle on **Dashboard, Demand, Sales & money and Stores** switches to a modelled 20-store SF-area network (`GET /api/admin/network`). It is **DEMO / projected only** — never mixed with LIVE numbers.
- Per store: orders/week, GMV, VendiPort take, shop payout, fill rate (one standout ≈ 2.5× the median).
- Rollup: orders/day, weekly + monthly GMV, VendiPort revenue (take + $1.99 memberships), AOV, same-day success, dispute rate (~1.4%), demand heat map by ZIP.
- **Assumptions panel** lists every input (median 3 orders/store/day, AOV $46 with 14% delivery pass-through, 15% take from `PLATFORM_TAKE`, 190 members, ramp 55→70→85→100%, fill-rate 84–96%). Take = GMV × rate; payout = GMV − take.

## Admin passcode
Default `Montana` (env `ADMIN_PASSCODE` overrides).
