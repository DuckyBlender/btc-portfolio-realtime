<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Footer from '$lib/components/Footer.svelte';
	import {
		decryptSharePayload,
		parseShareKeyFromHash,
		type EncryptedSharePayloadV1
	} from '$lib/services/share';

	interface Props {
		data: {
			shareId: string;
		};
	}

	let { data }: Props = $props();
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			const key = parseShareKeyFromHash(window.location.hash);
			if (!key) {
				throw new Error('Missing decryption key in URL fragment');
			}

			const response = await fetch(`/api/share/${encodeURIComponent(data.shareId)}`);
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload.error || 'Share not found or expired');
			}

			const decrypted = await decryptSharePayload(payload as EncryptedSharePayloadV1, key);
			sessionStorage.setItem('btc-tracker-shared-load', JSON.stringify(decrypted));

			// Remove the decryption key from browser history before redirecting.
			history.replaceState(null, '', `/share/${data.shareId}`);
			await goto('/', { replaceState: true });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load shared portfolio';
		} finally {
			isLoading = false;
		}
	});
</script>

<svelte:head>
	<title>Open Shared Portfolio | BTC Portfolio Tracker</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-black p-4 pb-28 text-white">
	<main class="mx-auto flex w-full max-w-xl flex-1 items-center">
		<section class="w-full border border-gray-800 bg-gray-900/20 p-5 sm:p-6">
			<h1 class="mb-4 text-xl font-light tracking-widest text-cyan-400 sm:text-2xl">OPEN SHARE</h1>

			{#if isLoading}
				<div class="flex items-center gap-3 text-sm text-gray-400">
					<span class="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent"></span>
					<span>Decrypting shared portfolio...</span>
				</div>
			{:else if error}
				<p class="text-sm text-red-400">{error}</p>
				<a
					href="/"
					class="mt-4 inline-block border border-gray-700 px-4 py-2 text-xs tracking-widest text-gray-400 transition-all hover:border-cyan-500 hover:text-cyan-400"
				>
					BACK TO TRACKER
				</a>
			{/if}
		</section>
	</main>

	<Footer />
</div>
