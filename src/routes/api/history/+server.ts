import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createConnection } from 'net';
import { connect as tlsConnect } from 'tls';
import { createHash } from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';

interface ElectrumRequest {
	id: number;
	method: string;
	params: unknown[];
}

interface HistoryRequest {
	host: string;
	port: number;
	scriptHashes: string[];
	useSsl?: boolean;
}

interface HistoryItem {
	tx_hash: string;
	height: number;
	fee?: number;
}

class ElectrumConnection {
	private socket: any;
	private requestId = 0;
	private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
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
				} catch (e) {
					console.error('Failed to parse response:', e);
				}
			}
		});

		this.socket.on('error', (err: Error) => {
			console.error('Socket error:', err);
			this.pendingRequests.forEach((pending) => pending.reject(err));
			this.pendingRequests.clear();
		});
	}

	async request(method: string, params: unknown[]): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = ++this.requestId;
			const request: ElectrumRequest = { id, method, params };

			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error('Request timeout'));
			}, 15000);

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
			if (this.socket.connecting) {
				this.socket.once('connect', resolve);
				this.socket.once('secureConnect', resolve);
				this.socket.once('error', reject);
			} else if (this.socket.writable) {
				resolve();
			} else {
				reject(new Error('Socket not connectable'));
			}
		});
	}

	close() {
		this.socket.destroy();
	}
}

export interface AccumulationPoint {
	timestamp: number;
	date: string;
	cumulativeBtc: number;
	deltaSats: number;
	txHash: string;
	blockHeight: number;
}

export const POST: RequestHandler = async ({ request }) => {
	let connection: ElectrumConnection | null = null;

	try {
		const body: HistoryRequest = await request.json();
		const { host, port, scriptHashes, useSsl = false } = body;

		console.log(`[History API] Received request for ${scriptHashes?.length || 0} script hashes`);

		if (!host || !port || !scriptHashes?.length) {
			return json({ error: 'Missing required fields' }, { status: 400 });
		}

		connection = new ElectrumConnection(host, port, useSsl);
		await connection.connect();

		try {
			await connection.request('server.version', ['btc-tracker', '1.4']);
			console.log('[History API] Connected to Electrum server');
		} catch (e) {
			throw new Error(`Cannot connect to Electrum server at ${host}:${port}`);
		}

		// Create a set of all our script hashes for quick lookup
		const ourScriptHashes = new Set(scriptHashes);

		// Step 1: Get history for all script hashes
		const allHistoryItems: HistoryItem[] = [];
		const seenTxids = new Set<string>();

		const batchSize = 20;
		let totalHistoryItems = 0;
		let confirmedItems = 0;
		let unconfirmedItems = 0;
		for (let i = 0; i < scriptHashes.length; i += batchSize) {
			const batch = scriptHashes.slice(i, i + batchSize);
			const historyPromises = batch.map(async (scriptHash) => {
				try {
					const history = await connection!.request('blockchain.scripthash.get_history', [scriptHash]) as HistoryItem[];
					return { scriptHash, history: history || [] };
				} catch (err) {
					console.error(`[History API] Error fetching history for ${scriptHash}:`, err);
					return { scriptHash, history: [] };
				}
			});
			const results = await Promise.all(historyPromises);
			for (const { scriptHash, history } of results) {
				if (history.length > 0) {
					console.log(`[History API] ScriptHash ${scriptHash.substring(0, 10)}... has ${history.length} transactions`);
				}
				totalHistoryItems += history.length;
				for (const item of history) {
					if (item.height > 0) {
						confirmedItems++;
					} else {
						unconfirmedItems++;
					}
					if (!seenTxids.has(item.tx_hash) && item.height > 0) {
						seenTxids.add(item.tx_hash);
						allHistoryItems.push(item);
					}
				}
			}
			if (i + batchSize < scriptHashes.length) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}

		console.log(`[History API] Total history items from Electrum: ${totalHistoryItems} (${confirmedItems} confirmed, ${unconfirmedItems} unconfirmed)`);

		console.log(`[History API] Found ${allHistoryItems.length} confirmed transactions`);

		if (allHistoryItems.length === 0) {
			console.log('[History API] No transaction history found, returning empty array');
			return json({ history: [], timestamp: Date.now() });
		}

		// Step 2: Get unique block heights and fetch their headers for timestamps
		const uniqueHeights = [...new Set(allHistoryItems.map(item => item.height))];
		const heightToTimestamp = new Map<number, number>();

		for (let i = 0; i < uniqueHeights.length; i += batchSize) {
			const batch = uniqueHeights.slice(i, i + batchSize);
			const headerPromises = batch.map(async (height) => {
				try {
					const headerHex = await connection!.request('blockchain.block.header', [height]) as string;
					// Timestamp is at bytes 68-72 (positions 136-144 in hex), little-endian uint32
					const timestampHex = headerHex.substring(136, 144);
					const timestamp = parseInt(
						timestampHex.match(/../g)!.reverse().join(''),
						16
					);
					return { height, timestamp };
				} catch {
					return { height, timestamp: 0 };
				}
			});
			const results = await Promise.all(headerPromises);
			for (const { height, timestamp } of results) {
				heightToTimestamp.set(height, timestamp);
			}
			if (i + batchSize < uniqueHeights.length) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}

		// Step 3: Get transaction details to compute net satoshi flow
		// We need to know which outputs go TO our addresses and which inputs come FROM our addresses
		const txDetails = new Map<string, { deltaSats: number; height: number }>();
		const txCache = new Map<string, bitcoin.Transaction>();
		const txHashes = allHistoryItems.map(item => item.tx_hash);

		console.log(`[History API] Fetching details for ${txHashes.length} transactions...`);

		for (let i = 0; i < txHashes.length; i += batchSize) {
			const batch = txHashes.slice(i, i + batchSize);
			const txPromises = batch.map(async (txHash) => {
				try {
					// Fetch raw transaction hex (not verbose)
					const txHex = await connection!.request('blockchain.transaction.get', [txHash, false]) as string;
					if (!txHex || typeof txHex !== 'string') {
						console.error(`[History API] Invalid tx hex for ${txHash}`);
						return { txHash, tx: null };
					}
					// Decode transaction using bitcoinjs-lib
					const tx = bitcoin.Transaction.fromHex(txHex);
					return { txHash, tx };
				} catch (err) {
					console.error(`[History API] Error fetching/decoding tx ${txHash}:`, err);
					return { txHash, tx: null };
				}
			});
			const results = await Promise.all(txPromises);

			for (const { txHash, tx } of results) {
				if (!tx) {
					console.log(`[History API] Skipping null tx: ${txHash}`);
					continue;
				}
				
				// Debug: check tx structure
				if (i === 0 && results.indexOf({ txHash, tx }) === 0) {
					console.log('[History API] Sample decoded tx - ins:', tx.ins.length, 'outs:', tx.outs.length);
				}
				
				txCache.set(txHash, tx);

				// Sum outputs that go to our addresses (incoming sats)
				let incomingSats = 0;
				for (const vout of tx.outs) {
					// Get script from output
					const scriptHex = Buffer.from(vout.script).toString('hex');
					const scriptHashForOutput = computeScriptHash(scriptHex);
					if (ourScriptHashes.has(scriptHashForOutput)) {
						incomingSats += Number(vout.value);
					}
				}

				const historyItem = allHistoryItems.find(h => h.tx_hash === txHash);
				txDetails.set(txHash, {
					deltaSats: incomingSats, // We'll subtract outgoing later
					height: historyItem?.height || 0
				});
			}

			if (i + batchSize < txHashes.length) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}

		console.log(`[History API] Cached ${txCache.size} transactions, txDetails has ${txDetails.size} entries`);

		// Step 4: For inputs, we need to check if the spent outputs belong to our addresses
		// Collect all prevout references from cached transactions
		const prevoutRefs: { txHash: string; spentInTx: string; voutIndex: number }[] = [];

		for (const [txHash, tx] of txCache.entries()) {
			for (let i = 0; i < tx.ins.length; i++) {
				const vin = tx.ins[i];
				// Skip coinbase transactions (they don't have a previous output)
				const hashHex = Buffer.from(vin.hash).toString('hex');
				if (hashHex === '0000000000000000000000000000000000000000000000000000000000000000') {
					continue;
				}
				prevoutRefs.push({
					txHash: Buffer.from(vin.hash).reverse().toString('hex'), // Bitcoin uses reverse byte order
					spentInTx: txHash,
					voutIndex: vin.index
				});
			}
		}

		// Fetch unique prevout transactions to check if spent outputs are ours
		// Only fetch those not already in the cache
		const uniquePrevoutTxids = [...new Set(prevoutRefs.map(r => r.txHash))].filter(id => !txCache.has(id));
		const prevoutTxCache = new Map<string, bitcoin.Transaction>(txCache);

		console.log(`[History API] Fetching ${uniquePrevoutTxids.length} prevout transactions...`);

		for (let i = 0; i < uniquePrevoutTxids.length; i += batchSize) {
			const batch = uniquePrevoutTxids.slice(i, i + batchSize);
			const txPromises = batch.map(async (txHash) => {
				try {
					const txHex = await connection!.request('blockchain.transaction.get', [txHash, false]) as string;
					if (!txHex || typeof txHex !== 'string') return { txHash, tx: null };
					const tx = bitcoin.Transaction.fromHex(txHex);
					return { txHash, tx };
				} catch {
					return { txHash, tx: null };
				}
			});
			const results = await Promise.all(txPromises);

			for (const { txHash, tx } of results) {
				if (tx) prevoutTxCache.set(txHash, tx);
			}

			if (i + batchSize < uniquePrevoutTxids.length) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}

		// Now subtract outgoing amounts
		for (const ref of prevoutRefs) {
			const prevTx = prevoutTxCache.get(ref.txHash);
			if (!prevTx) continue;
			if (ref.voutIndex >= prevTx.outs.length) continue;
			const output = prevTx.outs[ref.voutIndex];
			if (!output) continue;

			const scriptHex = Buffer.from(output.script).toString('hex');
			const scriptHashForOutput = computeScriptHash(scriptHex);
			if (ourScriptHashes.has(scriptHashForOutput)) {
				const detail = txDetails.get(ref.spentInTx);
				if (detail) {
					detail.deltaSats -= Number(output.value);
				}
			}
		}

		// Step 5: Build the accumulation timeline
		const timeline: AccumulationPoint[] = [];

		// Sort transactions by block height (chronological)
		const sortedTxHashes = [...txDetails.entries()]
			.sort((a, b) => a[1].height - b[1].height);

		let cumulativeSats = 0;
		for (const [txHash, detail] of sortedTxHashes) {
			cumulativeSats += detail.deltaSats;
			const timestamp = heightToTimestamp.get(detail.height) || 0;
			timeline.push({
				timestamp,
				date: new Date(timestamp * 1000).toISOString().split('T')[0],
				cumulativeBtc: cumulativeSats / 1e8,
				deltaSats: detail.deltaSats,
				txHash,
				blockHeight: detail.height
			});
		}

		console.log(`[History API] Built timeline with ${timeline.length} points`);

		return json({
			history: timeline,
			timestamp: Date.now()
		});
	} catch (error) {
		console.error('[History API] Error:', error);
		console.error('[History API] Stack:', error instanceof Error ? error.stack : 'No stack trace');
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	} finally {
		if (connection) {
			connection.close();
		}
	}
};

function computeScriptHash(scriptHex: string): string {
	// SHA256 hash of the script, then reverse byte order (Electrum format)
	const scriptBuffer = Buffer.from(scriptHex, 'hex');
	const hash = createHash('sha256').update(scriptBuffer).digest();
	return Buffer.from(hash).reverse().toString('hex');
}
