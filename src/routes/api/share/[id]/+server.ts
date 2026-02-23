import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getShareRecord } from '$lib/server/share-store';

const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const GET: RequestHandler = async ({ params }) => {
	const id = params.id;
	if (!id || !ID_PATTERN.test(id)) {
		return json({ error: 'Invalid share id' }, { status: 400 });
	}

	const record = getShareRecord(id);
	if (!record) {
		return json({ error: 'Share not found or expired' }, { status: 404 });
	}

	return json(
		{
			v: record.v,
			iv: record.iv,
			ciphertext: record.ciphertext,
			expiresAt: record.expiresAt
		},
		{
			headers: {
				'cache-control': 'no-store'
			}
		}
	);
};
