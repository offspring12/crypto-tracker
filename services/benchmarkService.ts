/**
 * Benchmark Service
 *
 * Fetches and caches benchmark index data from Yahoo Finance for portfolio comparison.
 * Supports SMI, S&P 500, MSCI World, Bitcoin, and custom tickers.
 */

import {
  BenchmarkData,
  BenchmarkConfig,
  BenchmarkSettings,
  ChartBenchmarkData,
  NormalizedBenchmarkPoint,
  DEFAULT_BENCHMARKS
} from '../types';

// Cache TTL: 24 hours in milliseconds
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// LocalStorage key prefix for benchmark data
const BENCHMARK_CACHE_PREFIX = 'benchmark_data_';

// CORS proxies (same as geminiService)
const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
];

/**
 * Determine currency based on ticker format
 */
const getCurrencyForTicker = (ticker: string): string => {
  if (ticker.endsWith('.SW')) return 'CHF';
  if (ticker.endsWith('.DE') || ticker.endsWith('.F')) return 'EUR';
  if (ticker.endsWith('.L')) return 'GBP';
  if (ticker.endsWith('.T')) return 'JPY';
  if (ticker === '^SSMI') return 'CHF';  // Swiss Market Index
  return 'USD';  // Default for US indices and most benchmarks
};

/**
 * Load cached benchmark data from localStorage
 */
const loadCachedBenchmark = (ticker: string): BenchmarkData | null => {
  try {
    const key = `${BENCHMARK_CACHE_PREFIX}${ticker}`;
    const cached = localStorage.getItem(key);

    if (!cached) return null;

    const data: BenchmarkData = JSON.parse(cached);

    // Check if cache is still valid (within TTL)
    const now = Date.now();
    if (now - data.lastUpdated > CACHE_TTL_MS) {
      console.log(`📊 Benchmark cache expired for ${ticker}`);
      return null;  // Cache expired, but still return it as fallback is handled elsewhere
    }

    console.log(`📊 Loaded cached benchmark data for ${ticker} (${data.priceHistory.length} points)`);
    return data;
  } catch (error) {
    console.warn(`⚠️ Failed to load cached benchmark for ${ticker}:`, error);
    return null;
  }
};

/**
 * Save benchmark data to localStorage cache
 */
const saveBenchmarkCache = (data: BenchmarkData): void => {
  try {
    const key = `${BENCHMARK_CACHE_PREFIX}${data.ticker}`;
    localStorage.setItem(key, JSON.stringify(data));
    console.log(`💾 Cached benchmark data for ${data.ticker}`);
  } catch (error) {
    console.warn(`⚠️ Failed to cache benchmark data:`, error);
  }
};

/**
 * Fetch benchmark data from Yahoo Finance
 * Uses multiple CORS proxies with fallback
 */
export const fetchBenchmarkData = async (
  ticker: string,
  name: string,
  forceRefresh: boolean = false
): Promise<BenchmarkData | null> => {
  console.log(`📈 Fetching benchmark: ${name} (${ticker})`);

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = loadCachedBenchmark(ticker);
    if (cached) {
      // Check if cache is fresh (within TTL)
      const now = Date.now();
      if (now - cached.lastUpdated <= CACHE_TTL_MS) {
        return cached;
      }
      // Cache expired but exists - we'll try to fetch fresh data
      // If fetch fails, we can still use stale cache as fallback
    }
  }

  // Build Yahoo Finance URL - request 5 years of data for maximum flexibility
  const yahooUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?range=5y&interval=1d`;

  let lastError: Error | null = null;

  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyUrl = CORS_PROXIES[i](yahooUrl);
    const proxyName = i === 0 ? 'corsproxy.io' : 'allorigins.win';

    try {
      console.log(`📡 Trying CORS proxy #${i + 1} (${proxyName}) for ${ticker}...`);

      const res = await fetch(proxyUrl);

      if (!res.ok) {
        console.warn(`⚠️ Proxy ${proxyName} returned status ${res.status}`);
        continue;
      }

      let data;

      // allorigins.win wraps response differently
      if (proxyName === 'allorigins.win') {
        const proxyData = await res.json();
        data = JSON.parse(proxyData.contents);
      } else {
        data = await res.json();
      }

      if (!data.chart?.result?.[0]) {
        console.warn(`⚠️ Invalid response from ${proxyName} for ${ticker}`);
        continue;
      }

      const result = data.chart.result[0];
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];

      if (timestamps.length === 0 || closes.length === 0) {
        console.warn(`⚠️ No price history from ${proxyName} for ${ticker}`);
        continue;
      }

      // Build price history array
      const priceHistory: number[][] = [];

      for (let j = 0; j < timestamps.length; j++) {
        const timestamp = timestamps[j] * 1000;  // Convert to milliseconds
        const close = closes[j];

        if (close && close > 0 && !isNaN(close)) {
          priceHistory.push([timestamp, close]);
        }
      }

      if (priceHistory.length === 0) {
        console.warn(`⚠️ No valid price points from ${proxyName} for ${ticker}`);
        continue;
      }

      // Get actual name from Yahoo if available
      let benchmarkName = name;
      if (result.meta?.longName) {
        benchmarkName = result.meta.longName;
      } else if (result.meta?.shortName) {
        benchmarkName = result.meta.shortName;
      }

      const benchmarkData: BenchmarkData = {
        ticker,
        name: benchmarkName,
        priceHistory,
        lastUpdated: Date.now(),
        currency: getCurrencyForTicker(ticker),
      };

      // Cache the data
      saveBenchmarkCache(benchmarkData);

      console.log(`✅ Fetched ${priceHistory.length} data points for ${benchmarkName} (${ticker})`);
      return benchmarkData;

    } catch (error: any) {
      console.warn(`❌ Proxy ${proxyName} failed for ${ticker}:`, error.message);
      lastError = error;
    }
  }

  // All proxies failed - try to return stale cache as fallback
  const staleCache = loadCachedBenchmark(ticker);
  if (staleCache) {
    console.warn(`⚠️ Using stale cache for ${ticker} (all proxies failed)`);
    return staleCache;
  }

  console.error(`❌ Failed to fetch benchmark ${ticker}: ${lastError?.message}`);
  return null;
};

/**
 * Fetch multiple benchmarks in parallel
 */
export const fetchMultipleBenchmarks = async (
  configs: BenchmarkConfig[],
  forceRefresh: boolean = false
): Promise<Map<string, BenchmarkData>> => {
  const results = new Map<string, BenchmarkData>();

  // Fetch all benchmarks in parallel
  const promises = configs.map(async (config) => {
    const data = await fetchBenchmarkData(config.ticker, config.name, forceRefresh);
    if (data) {
      results.set(config.ticker, data);
    }
  });

  await Promise.all(promises);

  return results;
};

/**
 * Normalize benchmark data to percentage change from a starting point
 * Aligns data points with portfolio chart timestamps
 */
export const normalizeBenchmarkData = (
  benchmarkData: BenchmarkData,
  chartTimestamps: number[]
): NormalizedBenchmarkPoint[] => {
  if (!benchmarkData.priceHistory.length || !chartTimestamps.length) {
    return [];
  }

  const priceHistory = benchmarkData.priceHistory;
  const chartStart = chartTimestamps[0];
  const chartEnd = chartTimestamps[chartTimestamps.length - 1];

  // Find the starting price (closest to chart start)
  let startPrice: number | null = null;

  for (const [timestamp, price] of priceHistory) {
    if (timestamp <= chartStart) {
      startPrice = price;
    } else {
      break;
    }
  }

  // If no price before chart start, use the first available price
  if (startPrice === null && priceHistory.length > 0) {
    startPrice = priceHistory[0][1];
  }

  if (!startPrice) {
    return [];
  }

  // Create normalized points for each chart timestamp
  const normalizedPoints: NormalizedBenchmarkPoint[] = [];

  for (const chartTimestamp of chartTimestamps) {
    // Find the closest benchmark price for this timestamp
    let closestPrice = startPrice;

    for (const [timestamp, price] of priceHistory) {
      if (timestamp <= chartTimestamp) {
        closestPrice = price;
      } else {
        break;
      }
    }

    // If chartTimestamp is after all benchmark data, use the last price
    if (chartTimestamp > priceHistory[priceHistory.length - 1][0]) {
      closestPrice = priceHistory[priceHistory.length - 1][1];
    }

    // Calculate percentage change from start
    const percentChange = ((closestPrice - startPrice) / startPrice) * 100;

    normalizedPoints.push({
      timestamp: chartTimestamp,
      percentChange,
    });
  }

  return normalizedPoints;
};

/**
 * Prepare benchmark data for chart rendering
 * Returns data for all visible benchmarks, normalized to chart timestamps
 */
export const prepareBenchmarksForChart = (
  benchmarkDataMap: Map<string, BenchmarkData>,
  benchmarkConfigs: BenchmarkConfig[],
  chartTimestamps: number[]
): ChartBenchmarkData[] => {
  const chartBenchmarks: ChartBenchmarkData[] = [];

  for (const config of benchmarkConfigs) {
    if (!config.visible) continue;

    const data = benchmarkDataMap.get(config.ticker);
    if (!data) continue;

    const normalizedData = normalizeBenchmarkData(data, chartTimestamps);

    if (normalizedData.length === 0) continue;

    // Calculate total return for the period
    const returnPercent = normalizedData.length > 0
      ? normalizedData[normalizedData.length - 1].percentChange
      : 0;

    chartBenchmarks.push({
      ticker: config.ticker,
      name: config.name,
      color: config.color,
      data: normalizedData,
      returnPercent,
    });
  }

  return chartBenchmarks;
};

/**
 * Create initial benchmark settings for a portfolio
 * All benchmarks are hidden by default
 */
export const createDefaultBenchmarkSettings = (): BenchmarkSettings => {
  return {
    benchmarks: DEFAULT_BENCHMARKS.map(b => ({
      ...b,
      visible: false,  // Hidden by default per user requirement
    })),
    maxVisibleBenchmarks: 3,
  };
};

/**
 * Add a custom benchmark to settings
 */
export const addCustomBenchmark = (
  settings: BenchmarkSettings,
  ticker: string,
  name: string
): BenchmarkSettings => {
  // Check if benchmark already exists
  if (settings.benchmarks.some(b => b.ticker.toUpperCase() === ticker.toUpperCase())) {
    console.warn(`Benchmark ${ticker} already exists`);
    return settings;
  }

  // Generate a color for the custom benchmark
  const customColors = ['#EC4899', '#06B6D4', '#84CC16', '#F43F5E', '#8B5CF6'];
  const customCount = settings.benchmarks.filter(b => b.isCustom).length;
  const color = customColors[customCount % customColors.length];

  return {
    ...settings,
    benchmarks: [
      ...settings.benchmarks,
      {
        ticker: ticker.toUpperCase(),
        name,
        color,
        visible: false,  // New benchmarks start hidden
        isCustom: true,
      },
    ],
  };
};

/**
 * Remove a custom benchmark from settings
 */
export const removeCustomBenchmark = (
  settings: BenchmarkSettings,
  ticker: string
): BenchmarkSettings => {
  return {
    ...settings,
    benchmarks: settings.benchmarks.filter(
      b => !(b.ticker.toUpperCase() === ticker.toUpperCase() && b.isCustom)
    ),
  };
};

/**
 * Toggle benchmark visibility
 * Respects maxVisibleBenchmarks limit
 */
export const toggleBenchmarkVisibility = (
  settings: BenchmarkSettings,
  ticker: string
): { settings: BenchmarkSettings; error?: string } => {
  const benchmarkIndex = settings.benchmarks.findIndex(
    b => b.ticker.toUpperCase() === ticker.toUpperCase()
  );

  if (benchmarkIndex === -1) {
    return { settings, error: `Benchmark ${ticker} not found` };
  }

  const benchmark = settings.benchmarks[benchmarkIndex];
  const currentVisibleCount = settings.benchmarks.filter(b => b.visible).length;

  // If turning on and at max, return error
  if (!benchmark.visible && currentVisibleCount >= settings.maxVisibleBenchmarks) {
    return {
      settings,
      error: `Maximum ${settings.maxVisibleBenchmarks} benchmarks can be visible at once. Turn off another benchmark first.`
    };
  }

  // Toggle visibility
  const updatedBenchmarks = [...settings.benchmarks];
  updatedBenchmarks[benchmarkIndex] = {
    ...benchmark,
    visible: !benchmark.visible,
  };

  return {
    settings: {
      ...settings,
      benchmarks: updatedBenchmarks,
    },
  };
};

/**
 * Validate if a ticker is a valid Yahoo Finance symbol
 * Returns the benchmark data if valid, null if invalid
 */
export const validateBenchmarkTicker = async (ticker: string): Promise<{
  valid: boolean;
  name?: string;
  error?: string;
}> => {
  try {
    const data = await fetchBenchmarkData(ticker, ticker, true);

    if (data && data.priceHistory.length > 0) {
      return {
        valid: true,
        name: data.name,
      };
    }

    return {
      valid: false,
      error: `No data found for ticker "${ticker}". Make sure it's a valid Yahoo Finance symbol.`,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: `Failed to validate ticker: ${error.message}`,
    };
  }
};

/**
 * Clear all benchmark caches
 */
export const clearBenchmarkCache = (): void => {
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(BENCHMARK_CACHE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach(key => localStorage.removeItem(key));
  console.log(`🗑️ Cleared ${keysToRemove.length} benchmark caches`);
};
