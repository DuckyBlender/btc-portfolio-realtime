import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ElectrumConnection } from '$lib/server/electrum-connection';

/**
 * Balance API endpoint
 *
 * Privacy: This endpoint only receives SCRIPT HASHES (SHA256 hashes of Bitcoin scripts),
 * NOT the actual addresses or XPUBs. Script hashes cannot be reversed to reveal addresses.
 *
 * The client derives addresses from XPUB locally, then generates script hashes
 * before sending them here for balance queries.
 */

interface BalanceRequest {
	host: string;
	port: number;
	scriptHashes: string[];
	useSsl?: boolean;
}

interface AddressBalance {
	scriptHash: string;
	balance: number;
	confirmed: number;
	unconfirmed: number;
}

export const POST: RequestHandler = async ({ request }) => {
	let connection: ElectrumConnection | null = null;

	try {
		const body: BalanceRequest = await request.json();
		const { host, port, scriptHashes, useSsl = false } = body;

		if (!host || !port || !scriptHashes?.length) {
			return json({ error: 'Missing required fields' }, { status: 400 });
		}

		// Create persistent connection
		connection = new ElectrumConnection(host, port, useSsl);
		await connection.connect();

		// Negotiate version
		try {
			await connection.request('server.version', ['btc-tracker', '1.4']);
		} catch (e) {
			throw new Error(`Cannot connect to Electrum server at ${host}:${port}. ${useSsl ? 'Try disabling SSL' : 'Try enabling SSL'}`);
		}

		// Batch requests - send all at once, then collect responses
		const balancePromises = scriptHashes.map(async (scriptHash): Promise<AddressBalance> => {
			try {
				const result = await connection!.request('blockchain.scripthash.get_balance', [scriptHash]) as { confirmed: number; unconfirmed: number };
				return {
					scriptHash,
					balance: result.confirmed + result.unconfirmed,
					confirmed: result.confirmed,
					unconfirmed: result.unconfirmed
				};
			} catch (e) {
				return {
					scriptHash,
					balance: 0,
					confirmed: 0,
					unconfirmed: 0
				};
			}
		});

		// Process in batches of 20 to avoid overwhelming the server
		const batchSize = 20;
		const addressBalances: AddressBalance[] = [];
		
		for (let i = 0; i < balancePromises.length; i += batchSize) {
			const batch = balancePromises.slice(i, i + batchSize);
			const results = await Promise.all(batch);
			addressBalances.push(...results);
			
			// Small delay between batches
			if (i + batchSize < balancePromises.length) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}

		const totalSatoshis = addressBalances.reduce((sum, addr) => sum + addr.balance, 0);

		return json({
			balance: totalSatoshis,
			addresses: addressBalances,
			timestamp: Date.now()
		});
	} catch (error) {
		console.error('[Balance API] Error:', error instanceof Error ? error.message : 'Unknown error');
		return json(
			{
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	} finally {
		if (connection) {
			connection.close();
		}
	}
};
