import { createConnection } from 'net';
import { connect as tlsConnect } from 'tls';
import type { Socket } from 'net';

interface ElectrumRequest {
	id: number;
	method: string;
	params: unknown[];
}

export class ElectrumConnection {
	private socket: Socket;
	private requestId = 0;
	private pendingRequests = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	private buffer = '';

	constructor(host: string, port: number, useSsl: boolean) {
		this.socket = useSsl
			? tlsConnect({ host, port, rejectUnauthorized: false })
			: createConnection({ host, port });

		this.socket.on('data', (chunk: Buffer) => {
			this.buffer += chunk.toString();
			const lines = this.buffer.split('\n');
			this.buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const response = JSON.parse(line);
					const pending = this.pendingRequests.get(response.id);
					if (pending) {
						this.pendingRequests.delete(response.id);
						if (response.error) {
							pending.reject(new Error(response.error.message));
						} else {
							pending.resolve(response.result);
						}
					}
				} catch {
					// Malformed JSON line - ignore
				}
			}
		});

		this.socket.on('error', (err: Error) => {
			console.error('Socket error:', err.message);
			for (const pending of this.pendingRequests.values()) {
				pending.reject(err);
			}
			this.pendingRequests.clear();
		});
	}

	async request(method: string, params: unknown[] = [], timeoutMs = 5000): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = ++this.requestId;
			const request: ElectrumRequest = { id, method, params };

			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request timeout: ${method}`));
			}, timeoutMs);

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

			this.socket.write(JSON.stringify(request) + '\n');
		});
	}

	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const onConnect = () => {
				cleanup();
				resolve();
			};
			const onError = (err: Error) => {
				cleanup();
				reject(err);
			};
			const cleanup = () => {
				this.socket.removeListener('connect', onConnect);
				this.socket.removeListener('secureConnect', onConnect);
				this.socket.removeListener('error', onError);
			};

			if (this.socket.connecting) {
				this.socket.once('connect', onConnect);
				this.socket.once('secureConnect', onConnect);
				this.socket.once('error', onError);
			} else if (this.socket.writable) {
				resolve();
			} else {
				reject(new Error('Socket not connectable'));
			}
		});
	}

	close(): void {
		this.socket.destroy();
	}
}
