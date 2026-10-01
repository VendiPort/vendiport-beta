# VendiPort — Owner Diagnostics (`/admin`)

Open `https://vendiport-beta.onrender.com/admin`. Enter the passcode (env `ADMIN_PASSCODE`, default `Montana` — **set your own on Render**).
Every number is tagged **LIVE** (computed from real orders/follows in the JSON state) or **DEMO** (seeded sample data so the dashboard looks alive; flagged `demo:true`, wiped with "Reset demo data").

| Tab | What it shows | LIVE | DEMO |
|---|---|---|---|
| **Dashboard** | Orders today, revenue, active stores, open disputes, late orders list, pending shop approvals, pending content | orders, revenue, late, disputes, approvals | sample trend lines |
| **Demand** | Top wanted items + 7-day growth, demand by ZIP vs active stores, unfilled demand ("recruit a shop here"), radar alert → order conversion, zero-result searches | real radar follows & searches | 100 seeded radar entries across 16 items / ZIPs, conversion |
| **Sales & money** | Revenue per day (14d), live revenue by day, membership (members, churn), referrals, payouts owed per store, refunds | live revenue/orders, real payouts owed | daily series, membership, referrals, refunds |
| **Fulfillment** | Paid → packed → ready → delivered times, late orders by store, cancel reasons, refused/failed handoffs | timings from real order timelines, real cancels, door refusals | averages, extra cancel reasons, failed handoffs |
| **Trust & safety** | Seal-not-intact reports by store, ratings by store / delivery | real seal checks and ratings | sample reports and ratings |
| **Stores** | Store list (ZIP, status, SKUs, units, low stock, "I have" count, verification), fastest Wanted responders | the real shop(s) | 5 demo stores, responder times |
| **Product health** | Funnel (visit → view → cart → order), out-of-area visitors by ZIP, error counts by type | out-of-area ZIP checks, server errors | funnel, sample errors |
| **Disputes** | Open/resolved disputes (seal broken at the door, etc.) with resolve actions | real disputes opened from the seal check | 2 demo disputes |
| **Shop approval** | Pending shop verification — approve / reject | real submissions | 3 pending demo shops |
| **Content queue** | Box breaks from any social platform: marketing-consent breaks, approve / reject, download package (link + hits + card), top performers by views/shares, hide/unhide any upload | real buyer breaks | 6 demo breaks |

**Reset demo data** removes only `demo:true` records; live data is untouched.
**Not real yet:** payments (Stripe test/stub), SMS (simulated, masked phone), photo storage (local disk, resets on Render free tier).
