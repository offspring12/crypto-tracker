/**
 * BenchmarkToggleBar Component
 *
 * Displays benchmark toggle chips below the performance chart.
 * Allows users to:
 * - Toggle visibility of default benchmarks (SMI, S&P 500, etc.)
 * - Add custom benchmarks via Yahoo Finance ticker
 * - Remove custom benchmarks
 * - See performance comparison when benchmarks are active
 */

import React, { useState } from 'react';
import { Plus, X, Check, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import {
  BenchmarkSettings,
  BenchmarkConfig,
  ChartBenchmarkData,
} from '../types';
import {
  toggleBenchmarkVisibility,
  addCustomBenchmark,
  removeCustomBenchmark,
  validateBenchmarkTicker,
} from '../services/benchmarkService';

interface BenchmarkToggleBarProps {
  settings: BenchmarkSettings;
  onSettingsChange: (settings: BenchmarkSettings) => void;
  chartBenchmarks: ChartBenchmarkData[];  // For showing return percentages
  portfolioReturn: number;  // Portfolio return % for comparison
  isLoading: boolean;
  loadingTickers: string[];  // Tickers currently being fetched
  onRefresh: () => void;  // Force refresh visible benchmarks
}

export const BenchmarkToggleBar: React.FC<BenchmarkToggleBarProps> = ({
  settings,
  onSettingsChange,
  chartBenchmarks,
  portfolioReturn,
  isLoading,
  loadingTickers,
  onRefresh,
}) => {
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customTicker, setCustomTicker] = useState('');
  const [customName, setCustomName] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const visibleCount = settings.benchmarks.filter(b => b.visible).length;

  const handleToggle = (ticker: string) => {
    setToggleError(null);
    const result = toggleBenchmarkVisibility(settings, ticker);

    if (result.error) {
      setToggleError(result.error);
      // Clear error after 3 seconds
      setTimeout(() => setToggleError(null), 3000);
    } else {
      onSettingsChange(result.settings);
    }
  };

  const handleRemoveCustom = (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();  // Prevent toggle when clicking remove
    const updated = removeCustomBenchmark(settings, ticker);
    onSettingsChange(updated);
  };

  const handleAddCustom = async () => {
    if (!customTicker.trim()) {
      setValidationError('Please enter a ticker symbol');
      return;
    }

    setIsValidating(true);
    setValidationError(null);

    const result = await validateBenchmarkTicker(customTicker.trim().toUpperCase());

    if (result.valid) {
      const name = customName.trim() || result.name || customTicker.toUpperCase();
      const updated = addCustomBenchmark(settings, customTicker.trim(), name);
      onSettingsChange(updated);
      setCustomTicker('');
      setCustomName('');
      setShowAddCustom(false);
    } else {
      setValidationError(result.error || 'Invalid ticker');
    }

    setIsValidating(false);
  };

  // Get return data for a benchmark
  const getBenchmarkReturn = (ticker: string): number | null => {
    const benchmark = chartBenchmarks.find(b => b.ticker === ticker);
    return benchmark ? benchmark.returnPercent : null;
  };

  return (
    <div className="mt-4 space-y-3">
      {/* Toggle error message */}
      {toggleError && (
        <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-500/10 px-3 py-2 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{toggleError}</span>
        </div>
      )}

      {/* Benchmark chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-1">
          <span className="text-gray-400 text-sm">Compare with:</span>
          {/* Refresh button - only show when benchmarks are visible */}
          {visibleCount > 0 && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1 rounded hover:bg-gray-700/50 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh benchmark data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        {settings.benchmarks.map((benchmark) => {
          const isActive = benchmark.visible;
          const isLoadingThis = loadingTickers.includes(benchmark.ticker);
          const benchmarkReturn = getBenchmarkReturn(benchmark.ticker);

          return (
            <button
              key={benchmark.ticker}
              onClick={() => handleToggle(benchmark.ticker)}
              disabled={isLoadingThis}
              className={`
                relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium
                transition-all duration-200 border
                ${isActive
                  ? 'border-transparent text-white'
                  : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                }
                ${isLoadingThis ? 'opacity-70 cursor-wait' : 'cursor-pointer'}
              `}
              style={isActive ? { backgroundColor: benchmark.color + 'CC' } : undefined}
            >
              {isLoadingThis ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : isActive ? (
                <Check className="w-3 h-3" />
              ) : null}

              <span>{benchmark.name}</span>

              {/* Show return % when active */}
              {isActive && benchmarkReturn !== null && (
                <span className="text-xs opacity-80">
                  ({benchmarkReturn >= 0 ? '+' : ''}{benchmarkReturn.toFixed(1)}%)
                </span>
              )}

              {/* Remove button for custom benchmarks */}
              {benchmark.isCustom && (
                <button
                  onClick={(e) => handleRemoveCustom(benchmark.ticker, e)}
                  className="ml-1 p-0.5 rounded-full hover:bg-white/20 transition-colors"
                  title="Remove custom benchmark"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </button>
          );
        })}

        {/* Add custom button */}
        {!showAddCustom && (
          <button
            onClick={() => setShowAddCustom(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm
                       bg-gray-800/50 border border-dashed border-gray-600 text-gray-400
                       hover:text-white hover:border-gray-500 transition-all"
          >
            <Plus className="w-3 h-3" />
            <span>Add</span>
          </button>
        )}
      </div>

      {/* Add custom benchmark form */}
      {showAddCustom && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <input
            type="text"
            placeholder="Ticker (e.g., QQQ)"
            value={customTicker}
            onChange={(e) => {
              setCustomTicker(e.target.value.toUpperCase());
              setValidationError(null);
            }}
            className="px-3 py-2.5 md:py-1.5 bg-gray-900 border border-gray-600 rounded text-sm text-white
                       placeholder-gray-500 focus:border-blue-500 focus:outline-none w-full sm:w-32"
            disabled={isValidating}
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="px-3 py-2.5 md:py-1.5 bg-gray-900 border border-gray-600 rounded text-sm text-white
                       placeholder-gray-500 focus:border-blue-500 focus:outline-none w-full sm:w-40"
            disabled={isValidating}
          />
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={handleAddCustom}
              disabled={isValidating || !customTicker.trim()}
              className="flex-1 sm:flex-none px-3 py-2.5 md:py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600
                         disabled:cursor-not-allowed text-white text-sm rounded font-medium
                         transition-colors flex items-center justify-center gap-1 touch-target"
            >
              {isValidating ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Validating...</span>
                </>
              ) : (
                <>
                  <Check className="w-3 h-3" />
                  <span>Add</span>
                </>
              )}
            </button>
            <button
              onClick={() => {
                setShowAddCustom(false);
                setCustomTicker('');
                setCustomName('');
                setValidationError(null);
              }}
              className="flex-1 sm:flex-none px-3 py-2.5 md:py-1.5 text-gray-400 hover:text-white text-sm transition-colors touch-target"
            >
              Cancel
            </button>
          </div>

          {validationError && (
            <div className="w-full flex items-center gap-1 text-red-400 text-sm mt-1">
              <AlertCircle className="w-3 h-3" />
              <span>{validationError}</span>
            </div>
          )}
        </div>
      )}

      {/* Loading indicator when fetching benchmarks */}
      {isLoading && loadingTickers.length > 0 && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading benchmark data...</span>
        </div>
      )}
    </div>
  );
};
