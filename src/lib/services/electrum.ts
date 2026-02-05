import type { ElectrumXBalance } from '../../types/btc-tracker';

interface ElectrumRequest {
	id: number;
	method: string;
	params: unknown[];
}

interface ElectrumResponse {
	id: number;
	result?: unknown;
	error?: { code: number; message: string };
}

export class ElectrumClient {
	private ws: WebSocket | null = null;
	private requestId = 0;
	private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private connected = false;
	private url: string;

	constructor(host: string = 'localhost', port: number = 50001) {
		this.url = `ws://${host}:${port}`;
	}

	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(this.url);

				this.ws.onopen = () => {
					this.connected = true;
					resolve();
				};

				this.ws.onerror = (error) => {
					reject(new Error(`WebSocket error: ${error}`));
				};

				this.ws.onclose = () => {
					this.connected = false;
				};

				this.ws.onmessage = (event) => {
					try {
						const response: ElectrumResponse = JSON.parse(event.data);
						const pending = this.pendingRequests.get(response.id);
						if (pending) {
							this.pendingRequests.delete(response.id);
							if (response.error) {
								pending.reject(new Error(response.error.message));
							} else {
								pending.resolve(response.result);
							}
						}
					} catch (e) {
						console.error('Failed to parse Electrum response:', e);
					}
				};
			} catch (error) {
				reject(error);
			}
		});
	}

	disconnect(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
			this.connected = false;
		}
	}

	isConnected(): boolean {
		return this.connected;
	}

	private async request(method: string, params: unknown[] = []): Promise<unknown> {
		if (!this.ws || !this.connected) {
			throw new Error('Not connected to Electrum server');
		}

		const id = ++this.requestId;
		const request: ElectrumRequest = { id, method, params };

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });

			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error('Request timeout'));
			}, 10000);

			this.ws!.send(JSON.stringify(request) + '\n');

			const originalResolve = this.pendingRequests.get(id)!.resolve;
			this.pendingRequests.set(id, {
				resolve: (value) => {
					clearTimeout(timeout);
					originalResolve(value);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				}
			});
		});
	}

	async getBalance(scriptHash: string): Promise<ElectrumXBalance> {
		const result = await this.request('blockchain.scripthash.get_balance', [scriptHash]);
		const balance = result as { confirmed: number; unconfirmed: number };
		return {
			total_received: 0,
			total_sent: 0,
			balance: balance.confirmed + balance.unconfirmed
		};
	}

	async getServerVersion(): Promise<string[]> {
		const result = await this.request('server.version', ['btc-tracker', '1.4']);
		return result as string[];
	}
}

// Singleton instance
let client: ElectrumClient | null = null;

export function getElectrumClient(host?: string, port?: number): ElectrumClient {
	if (!client || (host && port)) {
		client = new ElectrumClient(host, port);
	}
	return client;
}
