import { HDKey } from '@scure/bip32';
import { base58check, bech32 } from '@scure/base';
import * as bitcoin from 'bitcoinjs-lib';
import { sha256 } from '@noble/hashes/sha2.js';
import type { XPUBValidation } from '../../types/btc-tracker';

// Utility to convert Uint8Array to hex string
function uint8ArrayToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// Version bytes for different extended key types
const VERSION_BYTES: Record<string, { public: number; private: number; network: bitcoin.Network }> = {
	// Mainnet
	xpub: { public: 0x0488b21e, private: 0x0488ade4, network: bitcoin.networks.bitcoin },
	xprv: { public: 0x0488b21e, private: 0x0488ade4, network: bitcoin.networks.bitcoin },
	ypub: { public: 0x049d7cb2, private: 0x049d7878, network: bitcoin.networks.bitcoin },
	yprv: { public: 0x049d7cb2, private: 0x049d7878, network: bitcoin.networks.bitcoin },
	zpub: { public: 0x04b24746, private: 0x04b2430c, network: bitcoin.networks.bitcoin },
	zprv: { public: 0x04b24746, private: 0x04b2430c, network: bitcoin.networks.bitcoin },
	// Testnet
	tpub: { public: 0x043587cf, private: 0x04358394, network: bitcoin.networks.testnet },
	tprv: { public: 0x043587cf, private: 0x04358394, network: bitcoin.networks.testnet },
	upub: { public: 0x044a5262, private: 0x044a4e28, network: bitcoin.networks.testnet },
	uprv: { public: 0x044a5262, private: 0x044a4e28, network: bitcoin.networks.testnet },
	vpub: { public: 0x045f1cf6, private: 0x045f18bc, network: bitcoin.networks.testnet },
	vprv: { public: 0x045f1cf6, private: 0x045f18bc, network: bitcoin.networks.testnet }
};

export type AddressType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh';

export interface DerivedAddress {
	address: string;
	scriptHash: string;
	path: string;
	index: number;
	isChange: boolean;
}

function getAddressType(prefix: string): AddressType {
	const lowerPrefix = prefix.toLowerCase();
	if (lowerPrefix.startsWith('x') || lowerPrefix.startsWith('t')) return 'p2pkh';
	if (lowerPrefix.startsWith('y') || lowerPrefix.startsWith('u')) return 'p2sh-p2wpkh';
	if (lowerPrefix.startsWith('z') || lowerPrefix.startsWith('v')) return 'p2wpkh';
	return 'p2wpkh';
}

function convertToXpub(extendedKey: string): { xpub: string; network: bitcoin.Network; addressType: AddressType } {
	const prefix = extendedKey.substring(0, 4);
	const versionInfo = VERSION_BYTES[prefix];

	if (!versionInfo) {
		throw new Error(`Unknown extended key prefix: ${prefix}`);
	}

	const addressType = getAddressType(prefix);
	const decoded = base58check(sha256).decode(extendedKey);
	const data = decoded.slice(4);

	// Convert to standard xpub format for HDKey
	const xpubVersion = new Uint8Array(4);
	const view = new DataView(xpubVersion.buffer);
	view.setUint32(0, 0x0488b21e);

	const newData = new Uint8Array(78);
	newData.set(xpubVersion);
	newData.set(data, 4);

	const xpub = base58check(sha256).encode(newData);
	return { xpub, network: versionInfo.network, addressType };
}

export function validateXPUB(xpub: string): XPUBValidation {
	try {
		if (!xpub || xpub.trim().length === 0) {
			return { isValid: false, error: 'XPUB is required' };
		}

		const prefix = xpub.substring(0, 4);
		if (!VERSION_BYTES[prefix]) {
			return { isValid: false, error: `Invalid prefix: ${prefix}. Expected xpub, ypub, zpub, etc.` };
		}

		const { xpub: convertedXpub } = convertToXpub(xpub);
		HDKey.fromExtendedKey(convertedXpub);

		return { isValid: true };
	} catch (error) {
		return { isValid: false, error: `Invalid XPUB: ${error instanceof Error ? error.message : 'Unknown error'}` };
	}
}

// Detect input type: 'xpub', 'address', or 'unknown'
export function detectInputType(input: string): 'xpub' | 'address' | 'unknown' {
	if (!input || input.trim().length === 0) return 'unknown';
	
	const trimmed = input.trim();
	const prefix = trimmed.substring(0, 4).toLowerCase();
	
	// Check for xpub/ypub/zpub etc
	if (VERSION_BYTES[prefix]) {
		return 'xpub';
	}
	
	// Check for single addresses
	// P2PKH (Legacy): starts with 1
	if (trimmed.startsWith('1')) return 'address';
	// P2SH (SegWit compatible): starts with 3
	if (trimmed.startsWith('3')) return 'address';
	// Bech32 (Native SegWit): starts with bc1
	if (trimmed.toLowerCase().startsWith('bc1')) return 'address';
	// Testnet addresses
	if (trimmed.startsWith('m') || trimmed.startsWith('n')) return 'address';
	if (trimmed.startsWith('2')) return 'address';
	if (trimmed.toLowerCase().startsWith('tb1')) return 'address';
	
	return 'unknown';
}

// Validate a single Bitcoin address
export function validateAddress(address: string): XPUBValidation {
	try {
		if (!address || address.trim().length === 0) {
			return { isValid: false, error: 'Address is required' };
		}
		
		const trimmed = address.trim();
		
		// Try to decode the address to validate it
		try {
			bitcoin.address.toOutputScript(trimmed, bitcoin.networks.bitcoin);
			return { isValid: true };
		} catch {
			// Try testnet
			try {
				bitcoin.address.toOutputScript(trimmed, bitcoin.networks.testnet);
				return { isValid: true };
			} catch {
				return { isValid: false, error: 'Invalid Bitcoin address format' };
			}
		}
	} catch (error) {
		return { isValid: false, error: `Invalid address: ${error instanceof Error ? error.message : 'Unknown error'}` };
	}
}

// Convert a single address to script hash for Electrum
export function addressToScriptHash(address: string): string {
	const trimmed = address.trim();
	
	// Determine network
	let network = bitcoin.networks.bitcoin;
	if (trimmed.startsWith('m') || trimmed.startsWith('n') || 
	    trimmed.startsWith('2') || trimmed.toLowerCase().startsWith('tb1')) {
		network = bitcoin.networks.testnet;
	}
	
	const script = bitcoin.address.toOutputScript(trimmed, network);
	return scriptToScriptHash(script);
}

// Get derived address info for a single address
export function singleAddressToDerivied(address: string): DerivedAddress {
	const trimmed = address.trim();
	const scriptHash = addressToScriptHash(trimmed);
	
	return {
		address: trimmed,
		scriptHash,
		path: 'single',
		index: 0,
		isChange: false
	};
}

function scriptToScriptHash(script: Uint8Array): string {
	const hash = sha256(script);
	// Electrum uses reversed hash
	const reversed = new Uint8Array(hash.length);
	for (let i = 0; i < hash.length; i++) {
		reversed[i] = hash[hash.length - 1 - i];
	}
	return uint8ArrayToHex(reversed);
}

export function deriveAddresses(xpub: string, count: number = 20, includeChange: boolean = true): DerivedAddress[] {
	const { xpub: convertedXpub, network, addressType } = convertToXpub(xpub);
	const hdkey = HDKey.fromExtendedKey(convertedXpub);

	const addresses: DerivedAddress[] = [];

	const chains = includeChange ? [0, 1] : [0];

	for (const chain of chains) {
		for (let i = 0; i < count; i++) {
			const child = hdkey.deriveChild(chain).deriveChild(i);
			const pubkey = child.publicKey;

			if (!pubkey) {
				throw new Error('Failed to derive public key');
			}

			let address: string;
			let script: Uint8Array;

			if (addressType === 'p2pkh') {
				const payment = bitcoin.payments.p2pkh({ pubkey, network });
				address = payment.address!;
				script = payment.output!;
			} else if (addressType === 'p2sh-p2wpkh') {
				const payment = bitcoin.payments.p2sh({
					redeem: bitcoin.payments.p2wpkh({ pubkey, network }),
					network
				});
				address = payment.address!;
				script = payment.output!;
			} else {
				const payment = bitcoin.payments.p2wpkh({ pubkey, network });
				address = payment.address!;
				script = payment.output!;
			}

			const scriptHash = scriptToScriptHash(script);

			addresses.push({
				address,
				scriptHash,
				path: `${chain}/${i}`,
				index: i,
				isChange: chain === 1
			});
		}
	}

	return addresses;
}

export function satoshisToBtc(satoshis: number): number {
	return satoshis / 100_000_000;
}

export function formatBtc(btc: number): string {
	return btc.toFixed(8);
}

export function formatCurrency(amount: number, currency: string): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	}).format(amount);
}
