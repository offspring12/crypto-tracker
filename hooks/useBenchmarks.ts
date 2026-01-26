/**
 * Benchmarks Hook
 *
 * Manages benchmark comparison state and data fetching.
 * Handles benchmark visibility, time range selection, and data loading.
 *
 * Extracted from App.tsx for better code organization.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { BenchmarkSettings, BenchmarkData } from '../types';
import {
  createDefaultBenchmarkSettings,
  fetchMultipleBenchmarks,
  BenchmarkTimeRange,
} from '../services/benchmarkService';

export interface UseBenchmarksProps {
  /** Current portfolio's benchmark settings (undefined if not set) */
  portfolioBenchmarkSettings?: BenchmarkSettings;
  /** Callback when benchmark settings change (to persist to portfolio) */
  onSettingsChange: (settings: BenchmarkSettings) => void;
}

export interface UseBenchmarksResult {
  /** Benchmark settings (with defaults applied) */
  benchmarkSettings: BenchmarkSettings;
  /** Map of ticker -> benchmark data */
  benchmarkDataMap: Map<string, BenchmarkData>;
  /** Whether benchmarks are currently loading */
  isBenchmarkLoading: boolean;
  /** Which benchmark tickers are currently loading */
  benchmarkLoadingTickers: string[];
  /** Current time range for benchmark comparison */
  benchmarkTimeRange: BenchmarkTimeRange;
  /** Update benchmark settings */
  handleBenchmarkSettingsChange: (settings: BenchmarkSettings) => void;
  /** Force refresh benchmark data */
  handleBenchmarkRefresh: () => Promise<void>;
  /** Change the time range */
  handleTimeRangeChange: (timeRange: BenchmarkTimeRange) => void;
}

/**
 * Hook for managing benchmark comparison state
 *
 * @param props - Portfolio benchmark settings and change callback
 * @returns Benchmark state and handlers
 *
 * @example
 * ```tsx
 * const {
 *   benchmarkSettings,
 *   benchmarkDataMap,
 *   isBenchmarkLoading,
 *   handleBenchmarkRefresh,
 * } = useBenchmarks({
 *   portfolioBenchmarkSettings: activePortfolio?.benchmarkSettings,
 *   onSettingsChange: (settings) => updatePortfolio({ benchmarkSettings: settings }),
 * });
 * ```
 */
export const useBenchmarks = ({
  portfolioBenchmarkSettings,
  onSettingsChange,
}: UseBenchmarksProps): UseBenchmarksResult => {
  // Benchmark data state
  const [benchmarkDataMap, setBenchmarkDataMap] = useState<Map<string, BenchmarkData>>(new Map());
  const [isBenchmarkLoading, setIsBenchmarkLoading] = useState(false);
  const [benchmarkLoadingTickers, setBenchmarkLoadingTickers] = useState<string[]>([]);
  const [benchmarkTimeRange, setBenchmarkTimeRange] = useState<BenchmarkTimeRange>('ALL');

  // Get benchmark settings with defaults
  const benchmarkSettings = useMemo((): BenchmarkSettings => {
    if (portfolioBenchmarkSettings) {
      return portfolioBenchmarkSettings;
    }
    return createDefaultBenchmarkSettings();
  }, [portfolioBenchmarkSettings]);

  // Handle benchmark settings change
  const handleBenchmarkSettingsChange = useCallback(
    (newSettings: BenchmarkSettings) => {
      onSettingsChange(newSettings);
    },
    [onSettingsChange]
  );

  // Fetch benchmark data when visible benchmarks or timeRange change
  useEffect(() => {
    const visibleBenchmarks = benchmarkSettings.benchmarks.filter((b) => b.visible);

    if (visibleBenchmarks.length === 0) {
      return; // No benchmarks to fetch
    }

    const fetchBenchmarks = async () => {
      const tickersToFetch = visibleBenchmarks.map((b) => b.ticker);
      setBenchmarkLoadingTickers(tickersToFetch);
      setIsBenchmarkLoading(true);

      try {
        // Pass benchmarkTimeRange to get appropriate data granularity
        const dataMap = await fetchMultipleBenchmarks(visibleBenchmarks, benchmarkTimeRange, false);
        setBenchmarkDataMap(dataMap);
        console.log(`📊 Fetched ${dataMap.size} benchmark(s) for timeRange: ${benchmarkTimeRange}`);
      } catch (error) {
        console.error('❌ Failed to fetch benchmarks:', error);
      } finally {
        setIsBenchmarkLoading(false);
        setBenchmarkLoadingTickers([]);
      }
    };

    fetchBenchmarks();
  }, [benchmarkSettings.benchmarks, benchmarkTimeRange]);

  // Force refresh visible benchmark data
  const handleBenchmarkRefresh = useCallback(async () => {
    const visibleBenchmarks = benchmarkSettings.benchmarks.filter((b) => b.visible);
    if (visibleBenchmarks.length === 0) return;

    const tickersToFetch = visibleBenchmarks.map((b) => b.ticker);
    setBenchmarkLoadingTickers(tickersToFetch);
    setIsBenchmarkLoading(true);

    try {
      // Force refresh with current timeRange
      const dataMap = await fetchMultipleBenchmarks(visibleBenchmarks, benchmarkTimeRange, true);
      setBenchmarkDataMap(dataMap);
      console.log(`📊 Refreshed ${dataMap.size} benchmark(s) for timeRange: ${benchmarkTimeRange}`);
    } catch (error) {
      console.error('Failed to refresh benchmarks:', error);
    } finally {
      setIsBenchmarkLoading(false);
      setBenchmarkLoadingTickers([]);
    }
  }, [benchmarkSettings.benchmarks, benchmarkTimeRange]);

  // Handle time range change
  const handleTimeRangeChange = useCallback((timeRange: BenchmarkTimeRange) => {
    console.log(`📊 Time range changed to: ${timeRange}`);
    setBenchmarkTimeRange(timeRange);
  }, []);

  return {
    benchmarkSettings,
    benchmarkDataMap,
    isBenchmarkLoading,
    benchmarkLoadingTickers,
    benchmarkTimeRange,
    handleBenchmarkSettingsChange,
    handleBenchmarkRefresh,
    handleTimeRangeChange,
  };
};
