<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getKrakenPriceService, type KrakenPrices } from '$lib/services/kraken';
	import Footer from '$lib/components/Footer.svelte';
	import AccumulationChart from '$lib/components/AccumulationChart.svelte';
	import {
		validateXPUB,
		validateAddress,
		detectInputType,
		deriveAddresses,
		singleAddressToDerivied,
		satoshisToBtc,
		formatBtc,
		formatCurrency,
		type DerivedAddress
	} from '$lib/services/xpub';
	import {
		encryptSharePayload,
		validateSharePayload,
		type SharedPortfolioPayloadV1
	} from '$lib/services/share';

	// State
	let xpubInput = $state('');
	let electrumHost = $state('electrum.blockstream.info');
	let electrumPort = $state(50002);
	let useSsl = $state(true);
	let inputType = $state<'xpub' | 'address' | 'unknown'>('unknown');

	// Reactive input type detection
	$effect(() => {
		inputType = detectInputType(xpubInput);
	});
	let addressCount = $state(50);
	let isConnected = $state(false);
	let isLoading = $state(false);
	let loadingStatus = $state('');
	let error = $state<string | null>(null);
	let showAddresses = $state(true);
	let hideEmpty = $state(true);
	let showEuro = $state(false);
	let showSats = $state(false);
	let isSharedSession = $state(false);
	let shareStatus = $state<string | null>(null);
	let shareError = $state<string | null>(null);
	let shareLink = $state<string | null>(null);
	let shareExpiresAt = $state<Date | null>(null);
	let shareLoading = $state(false);

	// Copy to clipboard function
	function copyToClipboard(text: string, label: string = 'Text') {
		navigator.clipboard
			.writeText(text)
			.then(() => {
				console.log(`${label} copied to clipboard`);
			})
			.catch((err) => {
				console.error('Failed to copy:', err);
			});
	}

	// Balance data
	let btcBalance = $state(0);
	let historyData = $state<
		{
			timestamp: number;
			date: string;
			cumulativeBtc: number;
			deltaSats: number;
			txHash: string;
			blockHeight: number;
		}[]
	>([]);
	let historyLoading = $state(false);
	let historyError = $state<string | null>(null);
	let showChart = $state(true);
	let usdPrice = $state(0);
	let plnPrice = $state(0);
	let eurPrice = $state(0);
	let lastUpdated = $state<Date | null>(null);
	let addressBalances = $state<
		{ scriptHash: string; balance: number; confirmed: number; unconfirmed: number }[]
	>([]);
	let refreshStatusLoading = $state(false);

	// Services
	let krakenService = getKrakenPriceService();
	let unsubscribePrice: (() => void) | null = null;
	let refreshInterval: ReturnType<typeof setInterval> | null = null;
	let scriptHashes: string[] = [];
	let derivedAddresses = $state<DerivedAddress[]>([]);

	// Derived values
	let usdBalance = $derived(btcBalance * usdPrice);
	let plnBalance = $derived(btcBalance * plnPrice);
	let eurBalance = $derived(btcBalance * eurPrice);
	let satsBalance = $derived(Math.round(btcBalance * 100000000));

	// Merge derived addresses with balances
	let addressesWithBalances = $derived(
		derivedAddresses.map((addr) => {
			const balanceData = addressBalances.find((b) => b.scriptHash === addr.scriptHash) || {
				balance: 0,
				confirmed: 0,
				unconfirmed: 0
			};
			const btc = satoshisToBtc(balanceData.balance);
			return {
				...addr,
				...balanceData,
				btc,
				usd: btc * usdPrice,
				pln: btc * plnPrice
			};
		})
	);

	let displayedAddresses = $derived(
		hideEmpty ? addressesWithBalances.filter((a) => a.balance > 0) : addressesWithBalances
	);

	async function connectAndLoadShared(payload: SharedPortfolioPayloadV1) {
		error = null;
		shareError = null;
		isLoading = true;
		loadingStatus = 'Loading shared portfolio...';
		isSharedSession = true;
		showAddresses = false;

		try {
			electrumHost = payload.settings.host;
			electrumPort = payload.settings.port;
			useSsl = payload.settings.useSsl;

			showEuro = payload.preferences?.showEuro ?? false;
			showSats = payload.preferences?.showSats ?? false;
			hideEmpty = payload.preferences?.hideEmpty ?? true;
			showChart = payload.preferences?.showChart ?? true;

			scriptHashes = [...new Set(payload.scriptHashes)];
			if (scriptHashes.length === 0) {
				throw new Error('Shared portfolio contains no script hashes');
			}

			// Shared sessions never include addresses/xpub, only script hashes.
			derivedAddresses = scriptHashes.map((scriptHash, index) => ({
				address: `script:${scriptHash.slice(0, 12)}...`,
				scriptHash,
				path: 'shared',
				index,
				isChange: false
			}));

			loadingStatus = `Querying balances for ${scriptHashes.length} script hashes...`;
			await fetchBalance();

			isConnected = true;

			loadingStatus = 'Loading transaction history...';
			fetchHistory();

			loadingStatus = 'Connecting to price feed...';
			await krakenService.connect();
			unsubscribePrice = krakenService.onPriceUpdate((prices: KrakenPrices) => {
				usdPrice = prices.btcUsd;
				plnPrice = prices.btcPln;
				eurPrice = prices.btcEur;
			});

			refreshInterval = setInterval(fetchBalance, 60000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load shared portfolio';
			isConnected = false;
		} finally {
			isLoading = false;
			loadingStatus = '';
		}
	}

	async function createShareLink() {
		if (!isConnected || scriptHashes.length === 0 || shareLoading) return;

		shareLoading = true;
		shareStatus = null;
		shareError = null;
		shareLink = null;
		shareExpiresAt = null;

		try {
			const payload: SharedPortfolioPayloadV1 = {
				version: 1,
				createdAt: Date.now(),
				scriptHashes: [...new Set(scriptHashes)],
				settings: {
					host: electrumHost,
					port: electrumPort,
					useSsl
				},
				preferences: {
					showEuro,
					showSats,
					hideEmpty,
					showChart
				}
			};

			const { encrypted, key } = await encryptSharePayload(payload);
			const response = await fetch('/api/share', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(encrypted)
			});
			const result = await response.json();

			if (!response.ok || !result?.id) {
				throw new Error(result?.error || 'Failed to create share link');
			}

			const link = `${window.location.origin}/share/${result.id}#k=${encodeURIComponent(key)}`;
			shareLink = link;
			shareExpiresAt = Number.isFinite(result.expiresAt) ? new Date(result.expiresAt) : null;

			try {
				await navigator.clipboard.writeText(link);
				shareStatus = 'Share link copied to clipboard';
			} catch {
				shareStatus = 'Share link created (clipboard access denied, copy manually)';
			}
		} catch (e) {
			shareError = e instanceof Error ? e.message : 'Failed to create share link';
		} finally {
			shareLoading = false;
		}
	}

	async function connectAndLoad() {
		error = null;
		shareStatus = null;
		shareError = null;
		shareLink = null;
		shareExpiresAt = null;
		isLoading = true;
		loadingStatus = 'Validating input...';
		isSharedSession = false;

		try {
			const detectedType = detectInputType(xpubInput);
			let addresses: DerivedAddress[];

			if (detectedType === 'address') {
				// Single address mode
				const validation = validateAddress(xpubInput);
				if (!validation.isValid) {
					throw new Error(validation.error);
				}
				loadingStatus = 'Processing address...';
				addresses = [singleAddressToDerivied(xpubInput)];
			} else if (detectedType === 'xpub') {
				// XPUB mode
				const validation = validateXPUB(xpubInput);
				if (!validation.isValid) {
					throw new Error(validation.error);
				}
				loadingStatus = `Deriving ${addressCount * 2} addresses...`;
				addresses = deriveAddresses(xpubInput, addressCount, true);
			} else {
				throw new Error(
					'Invalid input. Enter an XPUB/YPUB/ZPUB or a Bitcoin address (1..., 3..., bc1...)'
				);
			}

			derivedAddresses = addresses;
			scriptHashes = addresses.map((a) => a.scriptHash);

			// Initial chain balance fetch
			loadingStatus = `Querying balances for ${addresses.length} addresses...`;
			await fetchBalance();

			isConnected = true;

			// Fetch transaction history for the chart
			loadingStatus = 'Loading transaction history...';
			fetchHistory();

			// Connect to Kraken for prices after chain queries complete
			loadingStatus = 'Connecting to price feed...';
			await krakenService.connect();
			unsubscribePrice = krakenService.onPriceUpdate((prices: KrakenPrices) => {
				usdPrice = prices.btcUsd;
				plnPrice = prices.btcPln;
				eurPrice = prices.btcEur;
			});

			// Start refresh interval (every 60 seconds for Electrum)
			refreshInterval = setInterval(fetchBalance, 60000);

			// Save to localStorage
			localStorage.setItem('btc-tracker-xpub', xpubInput);
			localStorage.setItem('btc-tracker-host', electrumHost);
			localStorage.setItem('btc-tracker-port', electrumPort.toString());
			localStorage.setItem('btc-tracker-ssl', useSsl.toString());
			localStorage.setItem('btc-tracker-count', addressCount.toString());
		} catch (e) {
			error = e instanceof Error ? e.message : 'Connection failed';
			isConnected = false;
		} finally {
			isLoading = false;
			loadingStatus = '';
		}
	}

	async function fetchBalance() {
		if (scriptHashes.length === 0) return;

		try {
			// Send only script hashes to server (not XPUB or addresses)
			const response = await fetch('/api/balance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: electrumHost,
					port: electrumPort,
					scriptHashes,
					useSsl
				})
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Failed to fetch balance');
			}

			btcBalance = satoshisToBtc(data.balance);
			addressBalances = data.addresses || [];
			lastUpdated = new Date();
		} catch (e) {
			console.error('Failed to fetch balance:', e);
			if (!isConnected) {
				throw e;
			}
		}
	}

	async function fetchHistory() {
		if (scriptHashes.length === 0) {
			console.log('[History] No script hashes available');
			return;
		}
		console.log(`[History] Fetching history for ${scriptHashes.length} script hashes`);
		historyLoading = true;
		historyError = null;

		try {
			const response = await fetch('/api/history', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: electrumHost,
					port: electrumPort,
					scriptHashes,
					useSsl
				})
			});

			const data = await response.json();
			console.log('[History] Response received:', data);

			if (!response.ok) {
				throw new Error(data.error || 'Failed to fetch history');
			}

			historyData = data.history || [];
			console.log(`[History] Loaded ${historyData.length} data points`);
		} catch (e) {
			console.error('[History] Failed to fetch history:', e);
			historyError = e instanceof Error ? e.message : 'Failed to load history';
		} finally {
			historyLoading = false;
		}
	}

	async function refreshWalletStatus() {
		if (!isConnected || refreshStatusLoading) return;

		refreshStatusLoading = true;
		try {
			await fetchBalance();
			await fetchHistory();
		} finally {
			refreshStatusLoading = false;
		}
	}

	function disconnect() {
		if (refreshInterval) {
			clearInterval(refreshInterval);
			refreshInterval = null;
		}
		if (unsubscribePrice) {
			unsubscribePrice();
			unsubscribePrice = null;
		}
		krakenService.disconnect();
		isConnected = false;
		btcBalance = 0;
		addressBalances = [];
		scriptHashes = [];
		derivedAddresses = [];
		historyData = [];
		historyError = null;
		isSharedSession = false;
		shareStatus = null;
		shareError = null;
		shareLink = null;
		shareExpiresAt = null;
	}

	onMount(() => {
		const sharedPayloadRaw = sessionStorage.getItem('btc-tracker-shared-load');
		if (sharedPayloadRaw) {
			sessionStorage.removeItem('btc-tracker-shared-load');
			try {
				const parsed = JSON.parse(sharedPayloadRaw);
				if (!validateSharePayload(parsed)) {
					throw new Error('Shared payload is invalid');
				}
				connectAndLoadShared(parsed);
				return;
			} catch (e) {
				error = e instanceof Error ? e.message : 'Failed to read shared portfolio';
			}
		}

		// Load saved settings
		const savedXpub = localStorage.getItem('btc-tracker-xpub');
		const savedHost = localStorage.getItem('btc-tracker-host');
		const savedPort = localStorage.getItem('btc-tracker-port');
		const savedSsl = localStorage.getItem('btc-tracker-ssl');
		const savedCount = localStorage.getItem('btc-tracker-count');

		if (savedXpub) {
			xpubInput = savedXpub;
		}

		if (savedHost) electrumHost = savedHost;
		if (savedPort) electrumPort = parseInt(savedPort, 10);
		if (savedSsl) useSsl = savedSsl === 'true';
		if (savedCount) addressCount = parseInt(savedCount, 10);

		// Auto-connect if we have xpub
		if (savedXpub) {
			connectAndLoad();
		}
	});

	onDestroy(() => {
		disconnect();
	});
</script>

<svelte:head>
	<title>BTC Portfolio Tracker</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-black p-4 pb-28 text-white">
	{#if !isConnected}
		<!-- Setup Form -->
		<div class="w-full max-w-lg space-y-6">
			<h1 class="text-center text-3xl font-light tracking-widest text-cyan-400">BTC TRACKER</h1>

			<div class="space-y-4">
				<div>
					<label for="xpub" class="mb-2 block text-xs tracking-wider text-gray-500 uppercase"
						>Address or XPUB / YPUB / ZPUB</label
					>
					<input
						id="xpub"
						type="text"
						bind:value={xpubInput}
						placeholder="bc1..., 1..., 3..., or xpub..."
						class="w-full border border-gray-800 bg-gray-900/50 px-4 py-3 font-mono text-sm text-white placeholder-gray-600 transition-colors focus:border-cyan-500 focus:outline-none"
					/>
					{#if inputType !== 'unknown' && xpubInput}
						<p class="mt-1 text-xs {inputType === 'address' ? 'text-cyan-500' : 'text-purple-500'}">
							Detected: {inputType === 'address' ? 'Single Address' : 'Extended Public Key'}
						</p>
					{/if}
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="host" class="mb-2 block text-xs tracking-wider text-gray-500 uppercase"
							>Electrum Host</label
						>
						<input
							id="host"
							type="text"
							bind:value={electrumHost}
							class="w-full border border-gray-800 bg-gray-900/50 px-4 py-3 font-mono text-sm text-white focus:border-cyan-500 focus:outline-none"
						/>
					</div>
					<div>
						<label for="port" class="mb-2 block text-xs tracking-wider text-gray-500 uppercase"
							>Port</label
						>
						<input
							id="port"
							type="number"
							bind:value={electrumPort}
							class="w-full border border-gray-800 bg-gray-900/50 px-4 py-3 font-mono text-sm text-white focus:border-cyan-500 focus:outline-none"
						/>
					</div>
				</div>

				<div class="flex items-center gap-3">
					<input
						id="ssl"
						type="checkbox"
						bind:checked={useSsl}
						class="h-4 w-4 border-gray-800 bg-gray-900/50 text-cyan-500 focus:ring-cyan-500"
					/>
					<label for="ssl" class="cursor-pointer text-xs tracking-wider text-gray-400 uppercase">
						Use SSL/TLS
					</label>
				</div>

				{#if inputType === 'xpub'}
					<div>
						<label for="count" class="mb-2 block text-xs tracking-wider text-gray-500 uppercase"
							>Addresses per chain (Gap Limit)</label
						>
						<input
							id="count"
							type="number"
							bind:value={addressCount}
							min="1"
							max="200"
							class="w-full border border-gray-800 bg-gray-900/50 px-4 py-3 font-mono text-sm text-white focus:border-cyan-500 focus:outline-none"
						/>
						<p class="mt-1 text-xs text-gray-600">
							Will derive {addressCount * 2} total addresses (receive + change)
						</p>
					</div>
				{/if}
				{#if error}
					<p class="text-sm text-red-500">{error}</p>
				{/if}

				<button
					onclick={connectAndLoad}
					disabled={isLoading || !xpubInput}
					class="flex w-full items-center justify-center gap-3 border border-cyan-500 bg-cyan-500/10 px-6 py-3 text-sm tracking-widest text-cyan-400 transition-all hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if isLoading}
						<span
							class="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent"
						></span>
						<span>{loadingStatus || 'CONNECTING...'}</span>
					{:else}
						<span>CONNECT</span>
					{/if}
				</button>
			</div>
		</div>
	{:else}
		<!-- Balance Display -->
		<div class="w-full max-w-2xl space-y-8 text-center">
			<div class="space-y-2">
				<p class="text-xs tracking-widest text-gray-500 uppercase">Bitcoin Balance</p>
				<p
					class="font-mono text-4xl font-light tracking-wider break-all text-white sm:text-5xl md:text-6xl"
				>
					<button
						type="button"
						class="cursor-pointer transition-colors select-none hover:text-cyan-400"
						onclick={() => (showSats = !showSats)}
						aria-label="Toggle between BTC and satoshis"
					>
						{#if showSats}
							{satsBalance.toLocaleString()}
						{:else}
							{formatBtc(btcBalance)}
						{/if}
					</button><button
						type="button"
						class="ml-2 cursor-pointer border-0 bg-transparent p-0 text-lg text-cyan-400 transition-colors hover:text-cyan-300 sm:text-2xl"
						onclick={() => (showSats = !showSats)}
						aria-label="Toggle between BTC and satoshis"
					>
						{showSats ? 'sats' : 'BTC'}
					</button>
				</p>
			</div>

			<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8">
				<button
					type="button"
					class="cursor-pointer border border-gray-800 bg-gray-900/30 p-6 text-center transition-colors hover:border-gray-700"
					onclick={() => (showEuro = !showEuro)}
					aria-label="Toggle between USD and EUR"
				>
					<p class="mb-2 text-xs tracking-widest text-gray-500 uppercase">
						{showEuro ? 'EURO' : 'USD'}
					</p>
					<p
						class="font-mono text-xl {showEuro
							? 'text-yellow-400'
							: 'text-green-400'} break-words sm:text-2xl md:text-3xl"
					>
						{formatCurrency(showEuro ? eurBalance : usdBalance, showEuro ? 'EUR' : 'USD')}
					</p>
					<p class="mt-1 text-xs text-gray-600">
						@ {formatCurrency(showEuro ? eurPrice : usdPrice, showEuro ? 'EUR' : 'USD')}/BTC
					</p>
				</button>

				<div class="border border-gray-800 bg-gray-900/30 p-6 text-center">
					<p class="mb-2 text-xs tracking-widest text-gray-500 uppercase">PLN</p>
					<p class="font-mono text-xl break-words text-blue-400 sm:text-2xl md:text-3xl">
						{formatCurrency(plnBalance, 'PLN')}
					</p>
					<p class="mt-1 text-xs text-gray-600">
						@ {formatCurrency(plnPrice, 'PLN')}/BTC
					</p>
				</div>
			</div>

			<div class="flex flex-wrap justify-center gap-4">
				<button
					onclick={() => (showChart = !showChart)}
					class="border border-gray-700 px-6 py-2 text-xs tracking-widest text-gray-500 transition-all hover:border-cyan-500 hover:text-cyan-400"
				>
					{showChart ? 'HIDE' : 'SHOW'} CHART
				</button>

				{#if !isSharedSession}
					<button
						onclick={() => (showAddresses = !showAddresses)}
						class="border border-gray-700 px-6 py-2 text-xs tracking-widest text-gray-500 transition-all hover:border-cyan-500 hover:text-cyan-400"
					>
						{showAddresses ? 'HIDE' : 'SHOW'} ADDRESSES
					</button>
				{/if}

				<button
					onclick={createShareLink}
					disabled={shareLoading}
					class="border border-gray-700 px-6 py-2 text-xs tracking-widest text-gray-500 transition-all hover:border-cyan-500 hover:text-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{shareLoading ? 'CREATING LINK...' : 'SHARE LIVE'}
				</button>

				<button
					onclick={disconnect}
					class="border border-gray-700 px-6 py-2 text-xs tracking-widest text-gray-500 transition-all hover:border-red-500 hover:text-red-400"
				>
					DISCONNECT
				</button>
			</div>

			{#if isSharedSession}
				<p class="text-xs tracking-wider text-gray-500 uppercase">
					Shared session loaded. XPUB and addresses are hidden.
				</p>
			{/if}

			{#if shareError}
				<p class="text-sm text-red-400">{shareError}</p>
			{/if}

			{#if shareStatus || shareLink}
				<div class="mx-auto w-full max-w-xl border border-gray-800 bg-gray-900/30 p-3 text-left">
					{#if shareStatus}
						<p class="mb-2 text-xs tracking-wider text-cyan-400 uppercase">{shareStatus}</p>
					{/if}
					{#if shareLink}
						<button
							type="button"
							class="w-full cursor-pointer break-all border border-gray-700 px-3 py-2 text-left font-mono text-xs text-cyan-300 transition-colors hover:border-cyan-500 hover:text-cyan-200"
							onclick={() => copyToClipboard(shareLink!, 'Share link')}
							title="Click to copy share link"
						>
							{shareLink}
						</button>
						{#if shareExpiresAt}
							<p class="mt-2 text-[11px] tracking-wider text-gray-500 uppercase">
								Expires: {shareExpiresAt.toLocaleString()}
							</p>
						{/if}
					{/if}
				</div>
			{/if}

			{#if showChart}
				<div class="mt-4">
					{#if historyLoading}
						<div class="border border-gray-800 bg-gray-900/30 p-4" style="height: 300px;">
							<div class="flex h-full items-center justify-center">
								<div class="flex items-center gap-3">
									<span
										class="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent"
									></span>
									<p class="text-sm text-gray-500">Loading transaction history...</p>
								</div>
							</div>
						</div>
					{:else if historyError}
						<div class="border border-gray-800 bg-gray-900/30 p-4">
							<p class="text-center text-sm text-red-400">{historyError}</p>
						</div>
					{:else}
						<AccumulationChart
							data={historyData}
							btcPrice={showEuro ? eurPrice : usdPrice}
							currency={showEuro ? 'EUR' : 'USD'}
							{showSats}
						/>
					{/if}
				</div>
			{/if}

			{#if showAddresses}
				<div class="space-y-3">
					<div class="flex items-center justify-between">
						<p class="text-xs tracking-wider text-gray-500 uppercase">
							Addresses ({displayedAddresses.length}
							{hideEmpty ? 'with balance' : 'total'})
						</p>
						<div class="flex items-center gap-2">
							<input
								id="hideEmpty"
								type="checkbox"
								bind:checked={hideEmpty}
								class="h-3 w-3 border-gray-800 bg-gray-900/50 text-cyan-500 focus:ring-cyan-500"
							/>
							<label for="hideEmpty" class="cursor-pointer text-xs text-gray-400">
								Hide empty
							</label>
						</div>
					</div>

					<div class="max-h-96 overflow-y-auto border border-gray-800 bg-gray-900/30 p-4">
						<div class="space-y-3 font-mono text-xs">
							{#each displayedAddresses as addr}
								<div class="border-b border-gray-800/50 pb-3">
									<div class="mb-1 flex items-center justify-between">
										<div class="text-gray-500">
											m/{addr.path}
											{addr.isChange ? '(change)' : '(receive)'}
										</div>
										{#if addr.balance > 0}
											<button
												type="button"
												class="cursor-pointer font-semibold text-green-400 transition-colors select-none hover:text-green-300"
												onclick={() =>
													copyToClipboard(
														showSats ? addr.balance.toString() : formatBtc(addr.btc),
														'Balance'
													)}
												title="Click to copy balance"
											>
												{showSats ? addr.balance.toLocaleString() : formatBtc(addr.btc)}
												{showSats ? 'sats' : 'BTC'}
											</button>
										{/if}
									</div>
									<button
										type="button"
										class="mb-2 w-full cursor-pointer text-center text-cyan-400 transition-colors select-none hover:text-cyan-300"
										onclick={() => copyToClipboard(addr.address, 'Address')}
										title="Click to copy address"
									>
										{addr.address}
									</button>
									{#if addr.balance > 0}
										<div class="flex gap-4 text-xs">
											<div class="text-gray-600">
												{showEuro ? 'EUR' : 'USD'}:
												<span class={showEuro ? 'text-yellow-300' : 'text-green-300'}
													>{formatCurrency(
														showEuro ? addr.btc * eurPrice : addr.usd,
														showEuro ? 'EUR' : 'USD'
													)}</span
												>
											</div>
											<div class="text-gray-600">
												PLN: <span class="text-blue-300">{formatCurrency(addr.pln, 'PLN')}</span>
											</div>
											{#if addr.unconfirmed > 0}
												<div class="text-yellow-500">
													({satoshisToBtc(addr.unconfirmed)} unconfirmed)
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
							{#if displayedAddresses.length === 0}
								<p class="py-4 text-center text-gray-600">
									No addresses {hideEmpty ? 'with balance' : 'found'}
								</p>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Live indicator -->
	{#if isConnected}
		<div class="fixed top-3 right-3 flex items-center gap-2 sm:top-4 sm:right-4">
			<span class="h-2 w-2 -translate-y-px animate-pulse rounded-full bg-green-500"></span>
			<span class="text-[10px] leading-none text-gray-500 sm:text-xs">LIVE PRICES</span>
			<button
				type="button"
				onclick={refreshWalletStatus}
				disabled={refreshStatusLoading}
				title="Refresh wallet status"
				class="border border-gray-700 px-2 py-0.5 text-[10px] tracking-wider text-gray-500 transition-all hover:border-cyan-500 hover:text-cyan-400 disabled:cursor-not-allowed disabled:opacity-60 sm:text-xs"
			>
				{refreshStatusLoading ? 'REFRESHING' : 'REFRESH'}
			</button>
		</div>
	{/if}

	{#if isConnected && lastUpdated}
		<p class="mt-6 pb-2 text-center text-xs text-gray-600">
			Last updated: {lastUpdated.toLocaleTimeString()}
		</p>
	{/if}

	<Footer />
</div>
