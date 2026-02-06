<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		Chart,
		LineController,
		LineElement,
		PointElement,
		LinearScale,
		CategoryScale,
		Filler,
		Tooltip,
		Legend,
	} from 'chart.js';

	Chart.register(
		LineController,
		LineElement,
		PointElement,
		LinearScale,
		CategoryScale,
		Filler,
		Tooltip,
		Legend,
	);

	interface AccumulationPoint {
		timestamp: number;
		date: string;
		cumulativeBtc: number;
		deltaSats: number;
		txHash: string;
		blockHeight: number;
	}

	interface Props {
		data: AccumulationPoint[];
		btcPrice: number;
		currency: 'USD' | 'EUR';
		showSats?: boolean;
	}

	let { data, btcPrice, currency, showSats = false }: Props = $props();

	type Timeframe = '1h' | '1d' | '1w' | '1m' | '1y' | '5y' | 'max';
	let selectedTimeframe = $state<Timeframe>('max');

	const timeframeMs = {
		'1h': 60 * 60 * 1000,
		'1d': 24 * 60 * 60 * 1000,
		'1w': 7 * 24 * 60 * 60 * 1000,
		'1m': 30 * 24 * 60 * 60 * 1000,
		'1y': 365 * 24 * 60 * 60 * 1000,
		'5y': 5 * 365 * 24 * 60 * 60 * 1000,
		'max': Infinity
	};

	// Filter data based on selected timeframe
	let filteredData = $derived((() => {
		if (!data || data.length === 0) return [];
		if (selectedTimeframe === 'max') return data;
		
		const now = Date.now();
		const cutoff = now - timeframeMs[selectedTimeframe];
		
		return data.filter(point => point.timestamp * 1000 >= cutoff);
	})());

	// Check which timeframes are available based on wallet age
	let availableTimeframes = $derived((() => {
		if (!data || data.length === 0) return new Set<Timeframe>();
		
		const oldestTimestamp = data[0].timestamp * 1000;
		const walletAge = Date.now() - oldestTimestamp;
		
		const available = new Set<Timeframe>(['max']);
		if (walletAge >= timeframeMs['1h']) available.add('1h');
		if (walletAge >= timeframeMs['1d']) available.add('1d');
		if (walletAge >= timeframeMs['1w']) available.add('1w');
		if (walletAge >= timeframeMs['1m']) available.add('1m');
		if (walletAge >= timeframeMs['1y']) available.add('1y');
		if (walletAge >= timeframeMs['5y']) available.add('5y');
		
		return available;
	})());

	let canvas = $state<HTMLCanvasElement>(null!);
	let chart: Chart | null = null;

	function buildChart() {
		if (!canvas || !filteredData || filteredData.length === 0) return;

		if (chart) {
			chart.destroy();
			chart = null;
		}

		const labels = filteredData.map((p) => p.date);
		const values = filteredData.map((p) => (showSats ? p.cumulativeBtc * 1e8 : p.cumulativeBtc));

		chart = new Chart(canvas, {
			type: 'line',
			data: {
				labels,
				datasets: [
					{
						label: 'BTC Balance',
						data: values,
						borderColor: '#22d3ee',
						backgroundColor: 'rgba(34, 211, 238, 0.08)',
						borderWidth: 2,
					pointRadius: filteredData.length > 50 ? 0 : 3,
						pointHoverRadius: 5,
						pointBackgroundColor: '#22d3ee',
						pointBorderColor: '#22d3ee',
						fill: true,
						tension: 0.3,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: {
					mode: 'index',
					intersect: false,
				},
				plugins: {
					legend: {
						display: false,
					},
					tooltip: {
						backgroundColor: 'rgba(17, 24, 39, 0.95)',
						titleColor: '#9ca3af',
						bodyColor: '#22d3ee',
						borderColor: '#374151',
						borderWidth: 1,
						padding: 12,
						displayColors: false,
						callbacks: {
							title: (items) => {
								const idx = items[0].dataIndex;
							const point = filteredData[idx];
							return new Date(point.timestamp * 1000).toLocaleDateString('en-US', {
								year: 'numeric',
								month: 'short',
								day: 'numeric',
							});
						},
							label: (item) => {
							const idx = item.dataIndex;
							const point = filteredData[idx];
								const deltaBtc = point.deltaSats / 1e8;
								const sign = deltaBtc >= 0 ? '+' : '';
							const fiatValue = (point.cumulativeBtc * btcPrice).toFixed(2);
								const balanceLabel = showSats
									? `${Math.round(point.cumulativeBtc * 1e8).toLocaleString()} sats`
									: `${point.cumulativeBtc.toFixed(8)} BTC`;
								const changeLabel = showSats
									? `${sign}${Math.round(point.deltaSats).toLocaleString()} sats`
									: `${sign}${deltaBtc.toFixed(8)} BTC`;
							return [
									`Balance: ${balanceLabel} (${currency === 'USD' ? '$' : '€'}${fiatValue})`,
									`Change: ${changeLabel}`,
								];
							},
						},
					},
				},
				scales: {
					x: {
						display: true,
						grid: {
							color: 'rgba(75, 85, 99, 0.2)',
						},
						ticks: {
							color: '#6b7280',
							font: { size: 10 },
							maxTicksLimit: 8,
							maxRotation: 0,
						},
						border: {
							color: 'rgba(75, 85, 99, 0.3)',
						},
					},
					y: {
						display: true,
						grid: {
							color: 'rgba(75, 85, 99, 0.2)',
						},
						ticks: {
							color: '#6b7280',
							font: { size: 10 },
							callback: (value) => {
								if (typeof value !== 'number') return value;
								if (showSats) {
									return Math.round(value).toLocaleString();
								}
								return value.toFixed(value < 0.01 ? 6 : 4);
							},
						},
						border: {
							color: 'rgba(75, 85, 99, 0.3)',
						},
					},
				},
			},
		});
	}

	$effect(() => {
		if (filteredData && canvas) {
			buildChart();
		}
	});

	onDestroy(() => {
		if (chart) {
			chart.destroy();
		}
	});
</script>

<div class="w-full space-y-3">
	<div class="flex items-center justify-between flex-wrap gap-2">
		<p class="text-xs tracking-widest text-gray-500 uppercase">BTC Accumulation Over Time</p>
		{#if data.length > 0}
			<p class="text-xs text-gray-600">
				{data.length} transactions · Since {new Date(data[0].timestamp * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
			</p>
		{/if}
	</div>
	
	<!-- Timeframe selector -->
	{#if data.length > 0}
		<div class="flex gap-2 flex-wrap">
			{#each ['1h', '1d', '1w', '1m', '1y', '5y', 'max'] as timeframe}
				<button
					type="button"
					onclick={() => selectedTimeframe = timeframe as Timeframe}
					disabled={!availableTimeframes.has(timeframe as Timeframe)}
					class="px-3 py-1 text-xs tracking-wider transition-all {selectedTimeframe === timeframe ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400' : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400'} border disabled:opacity-30 disabled:cursor-not-allowed"
				>
					{timeframe.toUpperCase()}
				</button>
			{/each}
		</div>
	{/if}
	<div class="border border-gray-800 bg-gray-900/30 p-4" style="height: 300px;">
		{#if data.length === 0}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-gray-600">No transaction history available</p>
			</div>
		{:else if filteredData.length === 0}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-gray-600">No transactions in this timeframe</p>
			</div>
		{:else}
			<canvas bind:this={canvas}></canvas>
		{/if}
	</div>
</div>
