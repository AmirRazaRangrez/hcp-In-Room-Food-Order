# Hotel City Park - In-Room Food & Dining Portal

Official Guest In-Room Dining & Room Service web interface for Hotel City Park, Solapur.
Designed for guests to view the live restaurant menu and place food orders directly from their mobile phones over 4G/5G or WiFi.

## Live Deployment
- **URL**: `https://hcprso.vercel.app`
- **Platform**: Vercel

## How It Works
1. Guests receive an automated WhatsApp link upon check-in or via front desk request (e.g. `https://hcprso.vercel.app/?token=...` or `?room=409`).
2. The guest views live categories, dishes, prices, and veg/non-veg tags directly synchronized from the hotel's cloud system.
3. The guest selects dishes, customizes instructions per item, and taps **"SEND ORDER TO KITCHEN"**.
4. The order transmits in real time via Supabase Cloud to:
   - **Local Hotel CRM POS & Kitchen Printer** (triggers KOT automatically).
   - **Admin APK** (triggers mobile push notification).
   - Billed automatically to the guest's room folio upon checkout.

## Local Development
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```
Outputs static bundle to `dist/`, fully configured for Vercel deployment with `vercel.json` SPA rewrites.
