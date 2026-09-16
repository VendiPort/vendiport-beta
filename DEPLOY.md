**Live:** https://vendiport-beta.onrender.com · Repo: [VendiPort/vendiport-beta](https://github.com/VendiPort/vendiport-beta) · auto-deploy from `main`.

# Deploy VendiPort beta (free)

Zero runtime deps. Binds `0.0.0.0`, respects `PORT`, health at `/health`.

> **Data limitation:** Free hosts (Render free, Railway trial, etc.) often use **ephemeral disk**.  
> `data/*.json` (orders, products, shops, uploads under `public/img/…`) **may wipe** on restart/redeploy.  
> Atomic writes are used (`*.tmp` → rename). For durable data later: paid disk, external DB, or `DATA_DIR` on a mounted volume — not required for beta launch.

---

## A. Deploy on Render (free) — recommended

1. Push this folder to a GitHub/GitLab repo (or connect the monorepo and set **Root Directory** to `vendiport-beta` / `card-vender/vendiport-beta`).
2. Go to [https://dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint** (uses `render.yaml`)  
   **or** **New Web Service** → connect repo:
   - **Runtime:** Node
   - **Build:** `npm install --omit=dev`
   - **Start:** `npm start`  (`node server.js`)
   - **Health Check Path:** `/health`
   - **Plan:** Free
3. Deploy. Open `https://vendiport-beta.onrender.com/health` → `{"ok":true}`.
4. Smoke: `/` (machine), `/track/<orderId>`, `/shop` (incl. Stats), `/account`, `/handoff/<orderId>`.

Cold starts on free tier can take ~30–60s after idle.

**Docker alternative on Render:** New Web Service → Docker → uses `Dockerfile` (`EXPOSE` + `CMD node server.js`).

---

## B. Railway (optional)

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub.
2. Root = this app folder. Start command: `npm start`.
3. Railway sets `PORT`. Confirm `/health`.

---

## C. Point **vendiport.com** later (GoDaddy DNS only)

Full checklist: **[DNS.md](./DNS.md)**. Summary below.

Do **not** use GoDaddy Website Builder. DNS only:

1. In Render (or Railway), copy the service hostname, e.g. `vendiport-beta.onrender.com`.
2. GoDaddy → **DNS** for `vendiport.com`:
   - **Apex (`@`):** either Render’s **A** records (from Render → Custom Domains), **or** a temporary **CNAME flattening** if your DNS supports it. Render usually gives A records for apex.
   - **`www`:** **CNAME** → `vendiport-beta.onrender.com` (or the host Render shows).
3. In Render → **Custom Domains** → add `vendiport.com` + `www.vendiport.com` → wait for TLS.
4. TTL 600 is fine while testing.

Exact A/CNAME values come from the host’s “Custom Domain” panel after you add the domain — paste those into GoDaddy.

---

## D. Local / Docker smoke

```bash
cd vendiport-beta
npm start
# → http://127.0.0.1:3847/health

docker build -t vendiport-beta .
docker run --rm -p 3847:3847 vendiport-beta
```

Optional durable local volume:

```bash
docker run --rm -p 3847:3847 -e DATA_DIR=/data -v vendiport-data:/data vendiport-beta
```

---

## Env vars

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `3847` | Listen port (Render/Railway set this) |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | JSON store path (mount a volume here if you add paid disk later) |

No Stripe / Origin / paid APIs required for this beta.


---

## E. Stripe TEST keys on Render (optional)

App works with **no keys** (Pay stub). For test Checkout only:

| Env var | Value |
|---------|--------|
| `STRIPE_SECRET_KEY` | `sk_test_…` from Stripe (Test mode) |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` |
| `PUBLIC_BASE_URL` | `https://vendiport-beta.onrender.com` (or custom domain) |
| `STRIPE_WEBHOOK_SECRET` | optional; beta mainly uses `/pay/success` → `/api/payments/complete` |

**Do not** set live keys. Reject path: server only enables Stripe when both keys are `*_test_*`.

After keys are set, open machine → checkout → Pay → Stripe hosted test page → returns to `/pay/success` → track page.

DNS for **vendiport.com**: see **[DNS.md](./DNS.md)**.
