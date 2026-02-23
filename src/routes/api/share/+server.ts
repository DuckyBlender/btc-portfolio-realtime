import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createShareRecord, getDefaultShareTtlMs } from '$lib/server/share-store';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CIPHERTEXT_LENGTH = 200_000;

interface CreateShareRequestBody {
	v: number;
	iv: string;
	ciphertext: string;
}

function decodeBase64Url(value: string): Buffer {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
	return Buffer.from(normalized + padding, 'base64');
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as Partial<CreateShareRequestBody>;
		const v = body.v;
		const iv = body.iv;
		const ciphertext = body.ciphertext;

		if (v !== 1 || typeof iv !== 'string' || typeof ciphertext !== 'string') {
			return json({ error: 'Invalid share payload' }, { status: 400 });
		}

		if (!BASE64URL_PATTERN.test(iv) || !BASE64URL_PATTERN.test(ciphertext)) {
			return json({ error: 'Invalid encoding' }, { status: 400 });
		}

		if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
			return json({ error: 'Encrypted payload is too large' }, { status: 400 });
		}

		const ivBytes = decodeBase64Url(iv);
		if (ivBytes.length !== 12) {
			return json({ error: 'Invalid IV length' }, { status: 400 });
		}

		const record = createShareRecord({
			v: 1,
			iv,
			ciphertext
		});

		return json(
			{
				id: record.id,
				expiresAt: record.expiresAt,
				ttlMs: getDefaultShareTtlMs()
			},
			{
				headers: {
					'cache-control': 'no-store'
				}
			}
		);
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}
};
