<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		CategoryScale,
		Chart,
		Filler,
		Legend,
		LineController,
		LineElement,
		LinearScale,
		PointElement,
		Tooltip
	} from 'chart.js';

	Chart.register(
		LineController,
		LineElement,
		PointElement,
		LinearScale,
		CategoryScale,
		Filler,
		Tooltip,
		Legend
	);

	interface AccumulationPoint {
		timestamp: number;
		date: string;
		cumulativeBtc: number;
		deltaSats: number;
		txHash: string;
		blockHeight: number;
	}

	interface PricePoint {
		timestamp: number;
		price: number;
	}

	interface Props {
		data: AccumulationPoint[];
		btcPrice: number;
		currency: 'USD' | 'EUR';
		showSats?: boolean;
	}

	let { data, btcPrice, currency, showSats = false }: Props = $props();

	type Timeframe = '1w' | '1m' | '1y' | '5y' | 'max';
	let selectedTimeframe = $state<Timeframe>('max');
	let showPriceOutline = $state(false);
	let priceHistory = $state<PricePoint[]>([]);
	let priceHistoryLoading = $state(false);

	const timeframeMs = {
		'1w': 7 * 24 * 60 * 60 * 1000,
		'1m': 30 * 24 * 60 * 60 * 1000,
		'1y': 365 * 24 * 60 * 60 * 1000,
		'5y': 5 * 365 * 24 * 60 * 60 * 1000,
		'max': Infinity
	};

	let filteredData = $derived(
		(() => {
			if (!data || data.length === 0) return [];
			if (selectedTimeframe === 'max') return data;

			const now = Date.now();
			const cutoff = now - timeframeMs[selectedTimeframe];

			return data.filter((point) => point.timestamp * 1000 >= cutoff);
		})()
	);

	let availableTimeframes = $derived(
		(() => {
			if (!data || data.length === 0) return new Set<Timeframe>();

			const oldestTimestamp = data[0].timestamp * 1000;
			const walletAge = Date.now() - oldestTimestamp;

			const available = new Set<Timeframe>(['max']);
			if (walletAge >= timeframeMs['1w']) available.add('1w');
			if (walletAge >= timeframeMs['1m']) available.add('1m');
			if (walletAge >= timeframeMs['1y']) available.add('1y');
			if (walletAge >= timeframeMs['5y']) available.add('5y');

			return available;
		})()
	);

	let canvas = $state<HTMLCanvasElement>(null!);
	let chart: Chart | null = null;

	function formatPrice(price: number): string {
		return price.toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});
	}

	function mapPricesToTimeline(points: AccumulationPoint[], prices: PricePoint[]): (number | null)[] {
		if (points.length === 0 || prices.length === 0) return [];

		const sortedPrices = [...prices].sort((a, b) => a.timestamp - b.timestamp);
		let priceIndex = 0;

		return points.map((point) => {
			while (
				priceIndex + 1 < sortedPrices.length &&
				sortedPrices[priceIndex + 1].timestamp <= point.timestamp
			) {
				priceIndex += 1;
			}

			const closest = sortedPrices[priceIndex] ?? sortedPrices[0];
			return closest ? closest.price : null;
		});
	}

	function buildChart() {
		if (!canvas || !filteredData || filteredData.length === 0) return;

		if (chart) {
			chart.destroy();
			chart = null;
		}

		const currencySymbol = currency === 'USD' ? '$' : '€';
		const labels = filteredData.map((p) => p.date);
		const values = filteredData.map((p) => (showSats ? p.cumulativeBtc * 1e8 : p.cumulativeBtc));
		const mappedPriceValues = showPriceOutline ? mapPricesToTimeline(filteredData, priceHistory) : [];
		const hasPriceValues = mappedPriceValues.some((price) => price !== null);

		const datasets: {
			label: string;
			data: (number | null)[];
			borderColor: string;
			backgroundColor: string;
			borderWidth: number;
			pointRadius: number;
			pointHoverRadius: number;
			pointBackgroundColor: string;
			pointBorderColor: string;
			fill: boolean;
			tension: number;
			yAxisID?: string;
			borderDash?: number[];
		}[] = [
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
				tension: 0.3
			}
		];

		if (showPriceOutline && hasPriceValues) {
			datasets.push({
				label: `BTC Price (${currency})`,
				data: mappedPriceValues,
				borderColor: '#f59e0b',
				backgroundColor: 'transparent',
				borderWidth: 1.5,
				borderDash: [5, 4],
				pointRadius: 0,
				pointHoverRadius: 0,
				pointBackgroundColor: '#f59e0b',
				pointBorderColor: '#f59e0b',
				fill: false,
				tension: 0.2,
				yAxisID: 'yPrice'
			});
		}

		chart = new Chart(canvas, {
			type: 'line',
			data: {
				labels,
				datasets
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: {
					mode: 'index',
					intersect: false
				},
				plugins: {
					legend: {
						display: false
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
								return new Date(point.timestamp * 1000).toLocaleString('en-US', {
									year: 'numeric',
									month: 'short',
									day: 'numeric',
									hour: '2-digit',
									minute: '2-digit',
									second: '2-digit',
									hour12: false
								});
							},
							label: (item) => {
								const idx = item.dataIndex;
								const point = filteredData[idx];

								if (item.datasetIndex === 1) {
									const priceValue = mappedPriceValues[idx];
									return priceValue == null
										? ''
										: `BTC Price: ${currencySymbol}${formatPrice(priceValue)}`;
								}

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
									`Change: ${changeLabel}`
								];
							}
						}
					}
				},
				scales: {
					x: {
						display: true,
						grid: {
							color: 'rgba(75, 85, 99, 0.2)'
						},
						ticks: {
							color: '#6b7280',
							font: { size: 10 },
							maxTicksLimit: 8,
							maxRotation: 0
						},
						border: {
							color: 'rgba(75, 85, 99, 0.3)'
						}
					},
					y: {
						display: true,
						grid: {
							color: 'rgba(75, 85, 99, 0.2)'
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
							}
						},
						border: {
							color: 'rgba(75, 85, 99, 0.3)'
						}
					},
					yPrice: {
						position: 'right',
						display: showPriceOutline && hasPriceValues,
						grid: {
							drawOnChartArea: false
						},
						ticks: {
							color: '#f59e0b',
							font: { size: 10 },
							callback: (value) => {
								if (typeof value !== 'number') return value;
								return `${currencySymbol}${formatPrice(value)}`;
							}
						},
						border: {
							color: 'rgba(245, 158, 11, 0.5)'
						}
					}
				}
			}
		});
	}

	$effect(() => {
		if (!data || data.length === 0) {
			priceHistory = [];
			priceHistoryLoading = false;
			return;
		}

		const timestamps = data
			.map((point) => point.timestamp)
			.filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
		if (timestamps.length === 0) {
			priceHistory = [];
			priceHistoryLoading = false;
			return;
		}

		const from = Math.max(1, Math.min(...timestamps) - 24 * 60 * 60);
		const to = Math.max(from + 1, Math.max(...timestamps) + 24 * 60 * 60);
		const controller = new AbortController();
		priceHistoryLoading = true;

		void (async () => {
			try {
				const query = new URLSearchParams({
					from: String(from),
					to: String(to),
					currency
				});
				const response = await fetch(`/api/price-history?${query.toString()}`, {
					signal: controller.signal
				});
				const payload = await response.json();
				priceHistory = Array.isArray(payload?.prices)
					? payload.prices.filter(
							(item: PricePoint) =>
								Number.isFinite(item?.timestamp) && Number.isFinite(item?.price)
						)
					: [];
			} catch (error) {
				if (!controller.signal.aborted) {
					console.error('[Chart] Failed to load historical prices:', error);
					priceHistory = [];
				}
			} finally {
				if (!controller.signal.aborted) {
					priceHistoryLoading = false;
				}
			}
		})();

		return () => {
			controller.abort();
		};
	});

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
		<div class="flex items-center justify-between gap-3 flex-wrap">
			<div class="flex gap-2 flex-wrap">
				{#each ['1w', '1m', '1y', '5y', 'max'] as timeframe}
					<button
						type="button"
						onclick={() => (selectedTimeframe = timeframe as Timeframe)}
						disabled={!availableTimeframes.has(timeframe as Timeframe)}
						class="px-3 py-1 text-xs tracking-wider transition-all {selectedTimeframe === timeframe ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400' : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400'} border disabled:opacity-30 disabled:cursor-not-allowed"
					>
						{timeframe.toUpperCase()}
					</button>
				{/each}
			</div>
			<button
				type="button"
				onclick={() => (showPriceOutline = !showPriceOutline)}
				disabled={!showPriceOutline && (priceHistoryLoading || priceHistory.length === 0)}
				class="px-3 py-1 text-xs tracking-wider transition-all border disabled:opacity-30 disabled:cursor-not-allowed {showPriceOutline ? 'bg-amber-500/20 border-amber-500 text-amber-400' : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400'}"
			>
				BTC PRICE (BETA)
			</button>
		</div>
		{#if priceHistoryLoading}
			<p class="text-xs text-gray-600">Loading historical BTC prices...</p>
		{:else if priceHistory.length === 0}
			<p class="text-xs text-gray-600">Historical BTC price currently unavailable.</p>
		{/if}
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
