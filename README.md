# BTC Portfolio Tracker

Real-time Bitcoin portfolio tracker. Check your balance with an XPUB or single address, get live prices, toggle between BTC/sats and USD/EUR.

Privacy-first: your XPUB stays in your browser. Addresses never leave your device.

## Features

- Private XPUB handling - address derivation is 100% client-side
- Live BTC prices (USD, EUR, PLN)
- Support for XPUB/YPUB/ZPUB or single addresses (bc1, 1, 3)
- Real-time balance via Electrum
- Toggle BTC ↔ sats, USD ↔ EUR
- BTC Accumulation Chart
- Timeframe filters (1w, 1m, 1y, 5y, max)
- BTC price overlay chart (USD/EUR) with adaptive sampling on MAX (daily/weekly/monthly)
- Flat carry-forward accumulation view when there are no new transactions in a timeframe
- Donate page (`/donate`) with one-click copy
- Auto-reconnect on page refresh

## Dev

```bash
pnpm install
pnpm dev
```

Visit `http://localhost:5173`

## How It Works

- Enter XPUB or address
- App derives addresses from XPUB in your browser (never sent anywhere)
- Generates script hashes (can't be reversed to reveal addresses)
- Queries Electrum for balances using only script hashes
- Gets prices from Kraken WebSocket

Server only sees script hashes. Your XPUB is safe.

## Live Share Links (Encrypted)

You can share a live, refreshing portfolio view without sharing your XPUB.

### What gets shared

- Script hashes (for Electrum balance/history lookups)
- Electrum connection settings (host, port, SSL)
- UI preferences (BTC/sats, USD/EUR toggle, chart visibility)

### What never gets shared

- XPUB/YPUB/ZPUB
- Derived addresses
- Private keys or seed phrases (you never even enter these in the app)

### How sharing works

1. App builds a share payload locally in your browser.
2. Payload is encrypted client-side with `AES-GCM` using a random 256-bit key.
3. Server stores only encrypted ciphertext + IV with a random share ID.
4. Share URL is generated as `/share/<id>#k=<key>`.
5. The decryption key is in the URL fragment (`#...`), so it is not sent in HTTP requests.
6. Receiver decrypts in their browser, then app loads using script hashes only.

### Link expiry and storage

- Share records currently expire after 7 days.
- Current implementation uses in-memory storage, so links can disappear earlier on server restart/redeploy.

## Defaults

- Electrum: electrum.blockstream.info:50002 (SSL on)
- Change this in the UI if you want a different server

## Privacy Model

This app is privacy-focused, but not a full anonymity solution.

### Strong protections

- XPUB derivation stays in-browser.
- Backend/API routes operate on script hashes only.
- Shared links are encrypted end-to-end from sender browser to receiver browser.

### Important caveats

- Script hashes are still wallet metadata. An Electrum server can correlate queried script hashes.
- If someone gets the full share URL (including `#k=...`), they can open the shared portfolio until expiry.
- XPUB is currently saved in browser `localStorage` for auto-reconnect convenience.
- WebSocket/API providers can still see IP-level network metadata.

## Todo

- [x] BTC Accumulation Chart
- [x] BTC Price Chart
- [x] Export/Share Portfolio (without revealing XPUB)

## Tech

SvelteKit 5, TypeScript, TailwindCSS, Kraken API, bitcoinjs-lib, Chart.js
