import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface CoingeckoRangeResponse {
	prices?: [number, number][];
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const fromRaw = url.searchParams.get('from');
	const toRaw = url.searchParams.get('to');
	const currencyRaw = url.searchParams.get('currency');

	const from = Number.parseInt(fromRaw ?? '', 10);
	const to = Number.parseInt(toRaw ?? '', 10);
	const currency = (currencyRaw ?? 'USD').toUpperCase();

	if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0 || from >= to) {
		return json({ error: 'Invalid from/to range' }, { status: 400 });
	}

	if (currency !== 'USD' && currency !== 'EUR') {
		return json({ error: 'Unsupported currency' }, { status: 400 });
	}

	const safeTo = Math.max(to, from + 1);
	const marketRangeUrl = new URL(
		'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range'
	);
	marketRangeUrl.searchParams.set('vs_currency', currency.toLowerCase());
	marketRangeUrl.searchParams.set('from', String(from));
	marketRangeUrl.searchParams.set('to', String(safeTo));

	try {
		const response = await fetch(marketRangeUrl.toString(), {
			headers: {
				accept: 'application/json'
			}
		});

		if (!response.ok) {
			console.error(
				`[PriceHistory API] CoinGecko error ${response.status} for ${currency} ${from}-${safeTo}`
			);
			return json({ prices: [] });
		}

		const payload = (await response.json()) as CoingeckoRangeResponse;
		const prices = Array.isArray(payload.prices)
			? payload.prices
					.filter((entry) => Array.isArray(entry) && Number.isFinite(entry[0]) && Number.isFinite(entry[1]))
					.map(([timestampMs, price]) => ({
						timestamp: Math.floor(timestampMs / 1000),
						price
					}))
			: [];

		return json({ prices, timestamp: Date.now() });
	} catch (error) {
		console.error('[PriceHistory API] Failed to fetch historical prices:', error);
		return json({ prices: [] });
	}
};
