# Point vendiport.com at Render (GoDaddy DNS only)

Do **not** use GoDaddy Website Builder, Parking, or “Forwarding” as the primary site. Use **DNS records only**, then attach the domain in Render.

**Live app today:** https://vendiport-beta.onrender.com  
**Goal:** `https://vendiport.com` + `https://www.vendiport.com` → same Render service.

---

## A. In Render (first)

1. Open the **vendiport-beta** Web Service → **Settings** → **Custom Domains**.
2. Add:
   - `vendiport.com`
   - `www.vendiport.com`
3. Render shows the exact targets to use:
   - **Apex (`vendiport.com`)**: usually one or more **A** records (IP addresses), sometimes also ALIAS/ANAME guidance.
   - **`www`**: usually a **CNAME** to something like `vendiport-beta.onrender.com` (copy the value Render displays — it may include a verify hostname).
4. Leave this tab open; paste those values into GoDaddy next.
5. After DNS propagates, Render issues **HTTPS** certificates automatically. Wait until status is **Verified** / **Certificate issued**.

---

## B. In GoDaddy (DNS only)

1. GoDaddy → **My Products** → **Domains** → **vendiport.com** → **DNS** (or “Manage DNS”).
2. Remove or disable conflicting records that fight the apex/`www` (old Website Builder A/CNAME, parking, bad forwards). Do not delete unrelated email MX records unless you intend to.
3. For **apex `@` / vendiport.com**:
   - Add the **A** record(s) exactly as Render lists (host `@`, type A, value = Render IP, TTL 600 or default).
   - If GoDaddy offers “Forwarding” to Render, prefer raw **A** records instead of forwarding.
4. For **www**:
   - Add **CNAME**: host `www`, value = the Render hostname shown in Custom Domains (often `vendiport-beta.onrender.com`), TTL 600.
5. Save. Propagation is often minutes; can take up to 24–48h.

---

## C. Verify

```bash
curl -sS https://vendiport.com/health
# → {"ok":true,...}

curl -sS https://www.vendiport.com/health
```

Browser: open both hosts; padlock should be valid (Render cert).

---

## Notes

- **Never** point the domain at GoDaddy Website Builder if the app lives on Render.
- Optional later: set Render env `PUBLIC_BASE_URL=https://vendiport.com` so Stripe test Checkout return URLs use the custom domain.
- This file is a checklist — Daniel (or DNS admin) must click GoDaddy/Render; agents do not change production DNS here.
