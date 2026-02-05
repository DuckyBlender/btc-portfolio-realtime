# BTC Portfolio Tracker

Real-time Bitcoin portfolio tracker. Check your balance with an XPUB or single address, get live prices, toggle between BTC/sats and USD/EUR.

Privacy-first: your XPUB stays in your browser. Addresses never leave your device.

## Features

- Private XPUB handling - address derivation is 100% client-side
- Live BTC prices (USD, EUR, PLN)
- Support for XPUB/YPUB/ZPUB or single addresses (bc1, 1, 3)
- Real-time balance via Electrum
- Toggle BTC ↔ sats, USD ↔ EUR
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

## Defaults

- Electrum: electrum.blockstream.info:50002 (SSL on)
- Change this in the UI if you want a different server

## Tech

SvelteKit 5, TypeScript, TailwindCSS, Kraken API, bitcoinjs-lib

