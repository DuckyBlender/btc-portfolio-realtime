export interface KrakenPrices {
	btcUsd: number;
	btcPln: number;
	btcEur: number;
	lastUpdated: Date;
}

type PriceCallback = (prices: KrakenPrices) => void;

export class KrakenPriceService {
	private ws: WebSocket | null = null;
	private prices: KrakenPrices = {
		btcUsd: 0,
		btcPln: 0,
		btcEur: 0,
		lastUpdated: new Date()
	};
	private callbacks: PriceCallback[] = [];
	private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	private isConnecting = false;
	private usdPlnRate = 4.0; // Default fallback rate
	private usdEurRate = 0.95; // Default fallback rate
	private rateRefreshInterval: ReturnType<typeof setInterval> | null = null;

	async connect(): Promise<void> {
		if (this.isConnecting) return;
		this.isConnecting = true;

		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket('wss://ws.kraken.com');

				this.ws.onopen = () => {
					this.isConnecting = false;
					// Subscribe to BTC/USD ticker
					const subscribeMsg = {
						event: 'subscribe',
						pair: ['XBT/USD'],
						subscription: { name: 'ticker' }
					};
					this.ws!.send(JSON.stringify(subscribeMsg));
					
					// Fetch initial PLN exchange rate
					this.fetchUsdPlnRate();
					
					// Refresh USD/PLN rate every 60 seconds
					this.rateRefreshInterval = setInterval(() => {
						this.fetchUsdPlnRate();
					}, 60000);
					
					resolve();
				};

				this.ws.onerror = (error) => {
					this.isConnecting = false;
					console.error('Kraken WebSocket error:', error);
					this.scheduleReconnect();
					reject(error);
				};

				this.ws.onclose = () => {
					this.isConnecting = false;
					this.scheduleReconnect();
				};

				this.ws.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data);
						this.handleMessage(data);
					} catch (e) {
						console.error('Failed to parse Kraken message:', e);
					}
				};
			} catch (error) {
				this.isConnecting = false;
				reject(error);
			}
		});
	}

	private async fetchUsdPlnRate(): Promise<void> {
		try {
			// Using exchangerate-api.com for USD exchange rates
			const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
			const data = await response.json();
			if (data.rates) {
				if (data.rates.PLN) {
					this.usdPlnRate = data.rates.PLN as number;
					this.prices.btcPln = this.prices.btcUsd * this.usdPlnRate;
				}
				if (data.rates.EUR) {
					this.usdEurRate = data.rates.EUR as number;
					this.prices.btcEur = this.prices.btcUsd * this.usdEurRate;
				}
				this.notifyCallbacks();
			}
		} catch (e) {
			console.error('Failed to fetch exchange rates:', e);
			// Keep using the last known rate or fallback
		}
	}

	private handleMessage(data: unknown): void {
		// Kraken ticker format: [channelID, tickerData, "ticker", "XBT/USD"]
		if (Array.isArray(data) && data.length >= 4) {
			const pair = data[3] as string;
			const tickerData = data[1] as { c?: [string, string] };

			if (tickerData && tickerData.c) {
				const price = parseFloat(tickerData.c[0]);

				if (pair === 'XBT/USD' || pair.includes('XBT')) {
					this.prices.btcUsd = price;
					// Calculate PLN and EUR prices using the exchange rates
					this.prices.btcPln = price * this.usdPlnRate;
					this.prices.btcEur = price * this.usdEurRate;
				}

				this.prices.lastUpdated = new Date();
				this.notifyCallbacks();
			}
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimeout) return;

		this.reconnectTimeout = setTimeout(() => {
			this.reconnectTimeout = null;
			this.connect().catch(console.error);
		}, 3000);
	}

	private notifyCallbacks(): void {
		this.callbacks.forEach((cb) => cb({ ...this.prices }));
	}

	onPriceUpdate(callback: PriceCallback): () => void {
		this.callbacks.push(callback);
		// Immediately call with current prices if available
		if (this.prices.btcUsd > 0) {
			callback({ ...this.prices });
		}
		return () => {
			const idx = this.callbacks.indexOf(callback);
			if (idx >= 0) this.callbacks.splice(idx, 1);
		};
	}

	getPrices(): KrakenPrices {
		return { ...this.prices };
	}

	disconnect(): void {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}
		if (this.rateRefreshInterval) {
			clearInterval(this.rateRefreshInterval);
			this.rateRefreshInterval = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
}

// Singleton instance
let service: KrakenPriceService | null = null;

export function getKrakenPriceService(): KrakenPriceService {
	if (!service) {
		service = new KrakenPriceService();
	}
	return service;
}
