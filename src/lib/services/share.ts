export interface SharedPortfolioPayloadV1 {
	version: 1;
	createdAt: number;
	scriptHashes: string[];
	settings: {
		host: string;
		port: number;
		useSsl: boolean;
	};
	preferences?: {
		showEuro?: boolean;
		showSats?: boolean;
		hideEmpty?: boolean;
		showChart?: boolean;
	};
}

export interface EncryptedSharePayloadV1 {
	v: 1;
	iv: string;
	ciphertext: string;
}

const SCRIPT_HASH_PATTERN = /^[0-9a-f]{64}$/i;

export function validateSharePayload(value: unknown): value is SharedPortfolioPayloadV1 {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as SharedPortfolioPayloadV1;

	if (candidate.version !== 1) return false;
	if (!Number.isFinite(candidate.createdAt) || candidate.createdAt <= 0) return false;

	if (!Array.isArray(candidate.scriptHashes) || candidate.scriptHashes.length === 0) return false;
	if (!candidate.scriptHashes.every((hash) => typeof hash === 'string' && SCRIPT_HASH_PATTERN.test(hash))) {
		return false;
	}

	if (!candidate.settings || typeof candidate.settings !== 'object') return false;
	if (typeof candidate.settings.host !== 'string' || candidate.settings.host.trim().length === 0) {
		return false;
	}
	if (!Number.isInteger(candidate.settings.port) || candidate.settings.port < 1 || candidate.settings.port > 65535) {
		return false;
	}
	if (typeof candidate.settings.useSsl !== 'boolean') return false;

	if (candidate.preferences !== undefined) {
		if (!candidate.preferences || typeof candidate.preferences !== 'object') return false;
		if (
			candidate.preferences.showEuro !== undefined &&
			typeof candidate.preferences.showEuro !== 'boolean'
		) {
			return false;
		}
		if (
			candidate.preferences.showSats !== undefined &&
			typeof candidate.preferences.showSats !== 'boolean'
		) {
			return false;
		}
		if (
			candidate.preferences.hideEmpty !== undefined &&
			typeof candidate.preferences.hideEmpty !== 'boolean'
		) {
			return false;
		}
		if (
			candidate.preferences.showChart !== undefined &&
			typeof candidate.preferences.showChart !== 'boolean'
		) {
			return false;
		}
	}

	return true;
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;

	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(base64Url: string): Uint8Array {
	const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
	const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
	const binary = atob(normalized + padding);
	const output = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) {
		output[i] = binary.charCodeAt(i);
	}

	return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function parseShareKeyFromHash(hash: string): string | null {
	const value = hash.startsWith('#') ? hash.slice(1) : hash;
	const params = new URLSearchParams(value);
	const key = params.get('k');
	return key && key.length > 0 ? key : null;
}

export async function encryptSharePayload(payload: SharedPortfolioPayloadV1): Promise<{
	encrypted: EncryptedSharePayloadV1;
	key: string;
}> {
	if (!validateSharePayload(payload)) {
		throw new Error('Invalid share payload');
	}

	const keyBytes = crypto.getRandomValues(new Uint8Array(32));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
		'encrypt'
	]);

	const plaintext = new TextEncoder().encode(JSON.stringify(payload));
	const ciphertextBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

	return {
		encrypted: {
			v: 1,
			iv: toBase64Url(iv),
			ciphertext: toBase64Url(new Uint8Array(ciphertextBuffer))
		},
		key: toBase64Url(keyBytes)
	};
}

export async function decryptSharePayload(
	encrypted: EncryptedSharePayloadV1,
	base64UrlKey: string
): Promise<SharedPortfolioPayloadV1> {
	if (!encrypted || encrypted.v !== 1 || typeof encrypted.iv !== 'string' || typeof encrypted.ciphertext !== 'string') {
		throw new Error('Invalid encrypted payload');
	}

	const keyBytes = fromBase64Url(base64UrlKey);
	if (keyBytes.length !== 32) {
		throw new Error('Invalid share key');
	}

	const iv = fromBase64Url(encrypted.iv);
	if (iv.length !== 12) {
		throw new Error('Invalid IV length');
	}

	const ciphertext = fromBase64Url(encrypted.ciphertext);
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		toArrayBuffer(keyBytes),
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);

	const plaintextBuffer = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: toArrayBuffer(iv) },
		cryptoKey,
		toArrayBuffer(ciphertext)
	);
	const parsed = JSON.parse(new TextDecoder().decode(plaintextBuffer));

	if (!validateSharePayload(parsed)) {
		throw new Error('Decrypted payload is invalid');
	}

	return parsed;
}
