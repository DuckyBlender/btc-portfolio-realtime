// Client-side Electrum WebSocket connection
export interface ElectrumBalance {
	scriptHash: string;
	balance: number;
	confirmed: number;
	unconfirmed: number;
}

interface ElectrumRequest {
	id: number;
	method: string;
	params: unknown[];
}

interface ElectrumResponse {
	id: number;
	result?: any;
	error?: { message: string };
}

export class ElectrumClient {
	private ws: WebSocket | null = null;
	private requestId = 0;
	private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	private host: string;
	private port: number;
	private useSsl: boolean;

	constructor(host: string, port: number, useSsl: boolean = true) {
		this.host = host;
		this.port = port;
		this.useSsl = useSsl;
	}

	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			// WebSocket connections for Electrum servers
			// Most Electrum servers support WSS on their SSL port
			const protocol = this.useSsl ? 'wss' : 'ws';
			const wsUrl = `${protocol}://${this.host}:${this.port}`;

			this.ws = new WebSocket(wsUrl);

			this.ws.onopen = () => {
				resolve();
			};

			this.ws.onerror = (error) => {
				reject(new Error(`WebSocket connection failed to ${wsUrl}`));
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

			this.ws.onclose = () => {
				// Reject all pending requests
				this.pendingRequests.forEach((pending) => 
					pending.reject(new Error('Connection closed'))
				);
				this.pendingRequests.clear();
			};
		});
	}

	private async request(method: string, params: unknown[]): Promise<unknown> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new Error('WebSocket not connected');
		}

		return new Promise((resolve, reject) => {
			const id = ++this.requestId;
			const request: ElectrumRequest = { id, method, params };

			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error('Request timeout'));
			}, 10000);

			this.pendingRequests.set(id, {
				resolve: (value) => {
					clearTimeout(timeout);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				}
			});

			this.ws!.send(JSON.stringify(request) + '\n');
		});
	}

	async getScriptHashBalance(scriptHash: string): Promise<ElectrumBalance> {
		const result: any = await this.request('blockchain.scripthash.get_balance', [scriptHash]);
		return {
			scriptHash,
			confirmed: result.confirmed || 0,
			unconfirmed: result.unconfirmed || 0,
			balance: (result.confirmed || 0) + (result.unconfirmed || 0)
		};
	}

	async getBatchBalances(scriptHashes: string[]): Promise<ElectrumBalance[]> {
		const promises = scriptHashes.map(sh => this.getScriptHashBalance(sh));
		return Promise.all(promises);
	}

	disconnect(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.pendingRequests.clear();
	}

	isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}
}
