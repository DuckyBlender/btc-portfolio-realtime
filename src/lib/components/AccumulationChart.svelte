<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		Chart,
		Filler,
		Legend,
		LineController,
		LineElement,
		LinearScale,
		PointElement,
		Tooltip
	} from 'chart.js';

	Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip, Legend);

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

	interface ChartPoint {
		x: number;
		y: number | null;
	}

	interface AccumulationSeriesPoint extends ChartPoint {
		kind: 'tx' | 'boundary';
		balanceBtc: number;
		deltaSats?: number;
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
		max: Infinity
	};

	const timeframeSamplingSeconds: Record<Timeframe, number> = {
		'1w': 6 * 60 * 60,
		'1m': 24 * 60 * 60,
		'1y': 7 * 24 * 60 * 60,
		'5y': 30 * 24 * 60 * 60,
		max: 30 * 24 * 60 * 60
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

	function getPriceSamplingInterval(
		timeframe: Timeframe,
		rangeStart: number,
		rangeEnd: number
	): { seconds: number; label: 'daily' | 'weekly' | 'monthly' | '6h' } {
		if (timeframe !== 'max') {
			const interval = timeframeSamplingSeconds[timeframe];
			if (interval === 6 * 60 * 60) return { seconds: interval, label: '6h' };
			if (interval === 24 * 60 * 60) return { seconds: interval, label: 'daily' };
			if (interval === 7 * 24 * 60 * 60) return { seconds: interval, label: 'weekly' };
			return { seconds: interval, label: 'monthly' };
		}

		const rangeDays = (rangeEnd - rangeStart) / (24 * 60 * 60);
		if (rangeDays <= 180) return { seconds: 24 * 60 * 60, label: 'daily' };
		if (rangeDays <= 3 * 365) return { seconds: 7 * 24 * 60 * 60, label: 'weekly' };
		return { seconds: 30 * 24 * 60 * 60, label: 'monthly' };
	}

	function buildRegularPriceSeries(
		prices: PricePoint[],
		timeframe: Timeframe,
		rangeStart: number,
		rangeEnd: number
	): ChartPoint[] {
		if (prices.length === 0) return [];

		const sortedPrices = [...prices].sort((a, b) => a.timestamp - b.timestamp);
		const sampling = getPriceSamplingInterval(timeframe, rangeStart, rangeEnd);
		const interval = sampling.seconds;
		if (timeframe === 'max') {
			console.log(`[Chart] MAX price sampling: ${sampling.label} (${interval}s)`);
		}
		if (
			!Number.isFinite(rangeStart) ||
			!Number.isFinite(rangeEnd) ||
			rangeStart <= 0 ||
			rangeEnd <= 0 ||
			rangeEnd < rangeStart
		) {
			return [];
		}

		const sampleTimestamps: number[] = [rangeStart];
		for (let t = Math.ceil(rangeStart / interval) * interval; t < rangeEnd; t += interval) {
			if (t > rangeStart) {
				sampleTimestamps.push(t);
			}
		}
		if (rangeEnd > rangeStart) {
			sampleTimestamps.push(rangeEnd);
		}

		let priceIndex = 0;
		let lastKnownPrice: number | null = null;
		const sampled: ChartPoint[] = [];

		for (const t of sampleTimestamps) {
			while (priceIndex < sortedPrices.length && sortedPrices[priceIndex].timestamp <= t) {
				lastKnownPrice = sortedPrices[priceIndex].price;
				priceIndex += 1;
			}

			if (lastKnownPrice === null) {
				const firstFuturePrice = sortedPrices.find((entry) => entry.timestamp >= t);
				lastKnownPrice = firstFuturePrice?.price ?? null;
			}

			sampled.push({ x: t, y: lastKnownPrice });
		}

		return sampled;
	}

	function getSelectedRangeSeconds(): { start: number; end: number } {
		const nowSec = Math.floor(Date.now() / 1000);
		const defaultStart = nowSec - 30 * 24 * 60 * 60;

		if (selectedTimeframe === 'max') {
			const firstTimestamp = data[0]?.timestamp;
			const start =
				Number.isFinite(firstTimestamp) && firstTimestamp > 0 ? firstTimestamp : defaultStart;
			const end = Math.max(nowSec, start + 1);
			return { start, end };
		}

		const durationSec = Math.floor(timeframeMs[selectedTimeframe] / 1000);
		const start = Math.max(1, nowSec - durationSec);
		return { start, end: nowSec };
	}

	function getBalanceAtOrBefore(points: AccumulationPoint[], timestamp: number): number {
		let balance = 0;
		for (const point of points) {
			if (point.timestamp > timestamp) break;
			balance = point.cumulativeBtc;
		}
		return balance;
	}

	function buildAccumulationSeries(
		points: AccumulationPoint[],
		rangeStart: number,
		rangeEnd: number
	): AccumulationSeriesPoint[] {
		const txInRange = points.filter(
			(point) => point.timestamp >= rangeStart && point.timestamp <= rangeEnd
		);
		const startBalance = getBalanceAtOrBefore(points, rangeStart);
		const endBalance =
			txInRange.length > 0 ? txInRange[txInRange.length - 1].cumulativeBtc : startBalance;

		const series: AccumulationSeriesPoint[] = [
			{
				x: rangeStart,
				y: showSats ? Math.round(startBalance * 1e8) : startBalance,
				kind: 'boundary',
				balanceBtc: startBalance
			},
			...txInRange.map((point) => ({
				x: point.timestamp,
				y: showSats ? point.cumulativeBtc * 1e8 : point.cumulativeBtc,
				kind: 'tx' as const,
				balanceBtc: point.cumulativeBtc,
				deltaSats: point.deltaSats
			})),
			{
				x: rangeEnd,
				y: showSats ? Math.round(endBalance * 1e8) : endBalance,
				kind: 'boundary',
				balanceBtc: endBalance
			}
		];

		// Keep the latest point when multiple points share the same x (e.g. tx exactly at range edges).
		const deduped: AccumulationSeriesPoint[] = [];
		for (const point of series) {
			const previous = deduped[deduped.length - 1];
			if (previous && previous.x === point.x) {
				deduped[deduped.length - 1] = point;
			} else {
				deduped.push(point);
			}
		}

		return deduped;
	}

	function buildChart() {
		if (!canvas) return;

		if (chart) {
			chart.destroy();
			chart = null;
		}

		const currencySymbol = currency === 'USD' ? '$' : '€';
		const { start: rangeStart, end: rangeEnd } = getSelectedRangeSeconds();
		const values = buildAccumulationSeries(data, rangeStart, rangeEnd);
		const regularPriceSeries = showPriceOutline
			? buildRegularPriceSeries(priceHistory, selectedTimeframe, rangeStart, rangeEnd)
			: [];
		const hasPriceValues = regularPriceSeries.some((point) => point.y !== null);
		const txCountInRange = values.filter((point) => point.kind === 'tx').length;

		const datasets: {
			label: string;
			data: (AccumulationSeriesPoint | ChartPoint)[];
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
			stepped?: boolean | 'before' | 'after' | 'middle';
			cubicInterpolationMode?: 'default' | 'monotone';
		}[] = [
			{
				label: 'BTC Balance',
				data: values,
				borderColor: '#22d3ee',
				backgroundColor: 'rgba(34, 211, 238, 0.08)',
				borderWidth: 2,
				pointRadius: txCountInRange > 50 ? 0 : 3,
				pointHoverRadius: 5,
				pointBackgroundColor: '#22d3ee',
				pointBorderColor: '#22d3ee',
				fill: true,
				tension: 0,
				stepped: 'after'
			}
		];

		if (showPriceOutline && hasPriceValues) {
			datasets.push({
				label: `BTC Price (${currency})`,
				data: regularPriceSeries,
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
								const timestamp = items[0]?.parsed?.x ?? 0;
								return new Date(timestamp * 1000).toLocaleString('en-US', {
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
								if (item.datasetIndex === 1) {
									const priceValue = item.parsed.y;
									return priceValue == null
										? ''
										: `BTC Price: ${currencySymbol}${formatPrice(priceValue)}`;
								}

								const rawPoint = item.raw as AccumulationSeriesPoint;
								const balanceBtc = rawPoint?.balanceBtc ?? 0;
								const fiatValue = (balanceBtc * btcPrice).toFixed(2);
								const balanceLabel = showSats
									? `${Math.round(balanceBtc * 1e8).toLocaleString()} sats`
									: `${balanceBtc.toFixed(8)} BTC`;
								const deltaSats = rawPoint?.deltaSats ?? 0;
								const deltaBtc = deltaSats / 1e8;
								const sign = deltaBtc >= 0 ? '+' : '';
								const changeLabel = showSats
									? `${sign}${Math.round(deltaSats).toLocaleString()} sats`
									: `${sign}${deltaBtc.toFixed(8)} BTC`;
								const changeText =
									rawPoint?.kind === 'tx'
										? `Change: ${changeLabel}`
										: 'Change: no new transactions';
								return [
									`Balance: ${balanceLabel} (${currency === 'USD' ? '$' : '€'}${fiatValue})`,
									changeText
								];
							}
						}
					}
				},
				scales: {
					x: {
						type: 'linear',
						min: rangeStart,
						max: rangeEnd,
						grace: 0,
						display: true,
						grid: {
							color: 'rgba(75, 85, 99, 0.2)'
						},
						ticks: {
							color: '#6b7280',
							font: { size: 10 },
							maxTicksLimit: 8,
							maxRotation: 0,
							callback: (value) => {
								const timestamp = typeof value === 'number' ? value : Number(value);
								if (!Number.isFinite(timestamp)) return '';
								return new Date(timestamp * 1000).toLocaleDateString('en-US', {
									month: 'short',
									day: 'numeric'
								});
							}
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

		const nowSec = Math.floor(Date.now() / 1000);
		const from = Math.max(1, Math.min(...timestamps) - 24 * 60 * 60);
		const to = Math.max(from + 1, nowSec + 60 * 60, Math.max(...timestamps) + 24 * 60 * 60);
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
							(item: PricePoint) => Number.isFinite(item?.timestamp) && Number.isFinite(item?.price)
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
		if (canvas) {
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
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="text-xs tracking-widest text-gray-500 uppercase">BTC Accumulation Over Time</p>
		{#if data.length > 0}
			<p class="text-xs text-gray-600">
				{data.length} transactions · Since {new Date(data[0].timestamp * 1000).toLocaleDateString(
					'en-US',
					{ year: 'numeric', month: 'short', day: 'numeric' }
				)}
			</p>
		{/if}
	</div>

	<!-- Timeframe selector -->
	{#if data.length > 0}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-wrap gap-2">
				{#each ['1w', '1m', '1y', '5y', 'max'] as timeframe}
					<button
						type="button"
						onclick={() => (selectedTimeframe = timeframe as Timeframe)}
						disabled={!availableTimeframes.has(timeframe as Timeframe)}
						class="px-3 py-1 text-xs tracking-wider transition-all {selectedTimeframe === timeframe
							? 'border-cyan-500 bg-cyan-500/20 text-cyan-400'
							: 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400'} border disabled:cursor-not-allowed disabled:opacity-30"
					>
						{timeframe.toUpperCase()}
					</button>
				{/each}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={() => (showPriceOutline = !showPriceOutline)}
					disabled={!showPriceOutline && (priceHistoryLoading || priceHistory.length === 0)}
					class="border px-3 py-1 text-xs tracking-wider transition-all disabled:cursor-not-allowed disabled:opacity-30 {showPriceOutline
						? 'border-amber-500 bg-amber-500/20 text-amber-400'
						: 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400'}"
				>
					BTC PRICE
				</button>
			</div>
		</div>
		{#if priceHistoryLoading}
			<p class="text-xs text-gray-600">Loading historical BTC prices...</p>
		{:else if priceHistory.length === 0}
			<p class="text-xs text-gray-600">Historical BTC price currently unavailable.</p>
		{/if}
	{/if}
	<div class="border border-gray-800 bg-gray-900/30 p-4" style="height: 300px;">
		<canvas bind:this={canvas}></canvas>
	</div>
	{#if data.length > 0 && filteredData.length === 0}
		<p class="text-xs text-gray-600">
			No new transactions in this timeframe. Balance is carried forward.
		</p>
	{/if}
</div>
