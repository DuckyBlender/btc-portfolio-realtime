import { randomBytes } from 'crypto';

export interface StoredShareRecord {
	id: string;
	v: 1;
	iv: string;
	ciphertext: string;
	createdAt: number;
	expiresAt: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 5000;

const shareStore = new Map<string, StoredShareRecord>();

function cleanupExpired(now: number = Date.now()): void {
	for (const [id, record] of shareStore.entries()) {
		if (record.expiresAt <= now) {
			shareStore.delete(id);
		}
	}
}

function pruneIfNeeded(): void {
	if (shareStore.size <= MAX_RECORDS) return;

	const recordsByExpiry = [...shareStore.values()].sort((a, b) => a.expiresAt - b.expiresAt);
	while (shareStore.size > MAX_RECORDS) {
		const oldest = recordsByExpiry.shift();
		if (!oldest) break;
		shareStore.delete(oldest.id);
	}
}

function generateId(): string {
	return randomBytes(18).toString('base64url');
}

export function createShareRecord(payload: {
	v: 1;
	iv: string;
	ciphertext: string;
	ttlMs?: number;
}): StoredShareRecord {
	cleanupExpired();

	const now = Date.now();
	const ttlMs = payload.ttlMs && payload.ttlMs > 0 ? payload.ttlMs : DEFAULT_TTL_MS;
	const expiresAt = now + Math.min(ttlMs, DEFAULT_TTL_MS);

	let id = generateId();
	let attempts = 0;
	while (shareStore.has(id) && attempts < 5) {
		id = generateId();
		attempts += 1;
	}

	if (shareStore.has(id)) {
		throw new Error('Failed to allocate share id');
	}

	const record: StoredShareRecord = {
		id,
		v: payload.v,
		iv: payload.iv,
		ciphertext: payload.ciphertext,
		createdAt: now,
		expiresAt
	};

	shareStore.set(id, record);
	pruneIfNeeded();
	return record;
}

export function getShareRecord(id: string): StoredShareRecord | null {
	cleanupExpired();
	const record = shareStore.get(id);
	if (!record) return null;
	if (record.expiresAt <= Date.now()) {
		shareStore.delete(id);
		return null;
	}
	return record;
}

export function getDefaultShareTtlMs(): number {
	return DEFAULT_TTL_MS;
}
