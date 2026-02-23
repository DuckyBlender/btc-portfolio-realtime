<script lang="ts">
	import { onDestroy } from 'svelte';
	import Footer from '$lib/components/Footer.svelte';

	const donationMethods = [
		{
			name: 'Bitcoin',
			value: 'bc1q3dqnaygpaqkwm20hjq73g3kcc534cnt47wjlmu'
		},
		{
			name: 'Bitcoin Lightning (LN)',
			value: 'duckyblender@strike.me'
		},
		{
			name: 'Ethereum (or any ERC20 token)',
			value: '0x87d03a9DADd7927c1f058725307a1645BC406195'
		},
		{
			name: 'Nano (XNO)',
			value: 'nano_3ociqkh6taqqu7q7h99oiyuasnkugm7bss87r1r4eph7dym3tmp3cebtosc5'
		},
		{
			name: 'Monero (XMR)',
			value:
				'84SdAF7JmMfQS3P1sSKasJHo8sQPjR3Xp58Vp1QWG4vMYdW26iZw6XuCMqL5FbtSQnUSKsGu6WtvXNMDEkwBtrE2VgKtNSK'
		}
	];

	let copiedMethod = $state<string | null>(null);
	let copyResetTimeout: ReturnType<typeof setTimeout> | null = null;

	function copyToClipboard(text: string, methodName: string) {
		navigator.clipboard
			.writeText(text)
			.then(() => {
				copiedMethod = methodName;
				if (copyResetTimeout) clearTimeout(copyResetTimeout);
				copyResetTimeout = setTimeout(() => {
					copiedMethod = null;
					copyResetTimeout = null;
				}, 1200);
			})
			.catch((error) => {
				console.error('Failed to copy donation address:', error);
			});
	}

	onDestroy(() => {
		if (copyResetTimeout) clearTimeout(copyResetTimeout);
	});
</script>

<svelte:head>
	<title>Donate | BTC Portfolio Tracker</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-black p-4 pb-28 text-white">
	<main class="mx-auto flex w-full max-w-2xl flex-1 items-center">
		<section class="w-full border border-gray-800 bg-gray-900/20 p-5 sm:p-6">
			<div class="mb-5 flex items-center justify-between gap-4">
				<h1 class="text-xl font-light tracking-widest text-cyan-400 sm:text-2xl">DONATE</h1>
				<a
					href="/"
					class="border border-gray-700 px-3 py-1.5 text-xs tracking-widest text-gray-400 transition-all hover:border-cyan-500 hover:text-cyan-400"
				>
					BACK
				</a>
			</div>

			<p class="mb-5 text-sm text-gray-500">
				If this tracker is useful, you can support development with any of the addresses below.
			</p>

			<div class="space-y-3">
				{#each donationMethods as method}
					<div
						class="border p-3 transition-all duration-200 {copiedMethod === method.name
							? 'border-green-500/70 bg-green-500/10'
							: 'border-gray-800 bg-gray-900/30'}"
					>
						<div class="mb-2 flex items-center justify-between gap-3">
							<p class="text-xs tracking-widest text-gray-500 uppercase">{method.name}</p>
							{#if copiedMethod === method.name}
								<span class="text-[10px] tracking-widest text-green-400 uppercase">Copied</span>
							{/if}
						</div>
						<button
							type="button"
							onclick={() => copyToClipboard(method.value, method.name)}
							class="w-full cursor-pointer text-left font-mono text-sm break-all transition-colors {copiedMethod ===
							method.name
								? 'text-green-300'
								: 'text-cyan-400 hover:text-cyan-300'}"
							title="Click to copy"
						>
							{method.value}
						</button>
					</div>
				{/each}
			</div>
		</section>
	</main>

	<Footer />
</div>
