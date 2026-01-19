import React, { useState, useMemo } from 'react';
import {
  X,
  Scale,
  TrendingUp,
  TrendingDown,
  Target,
  ArrowRight,
  Settings2,
  Info,
  CheckCircle2,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { Asset, Currency, RebalancingSettings, RebalancingSuggestion } from '../types';
import {
  generateRebalancingSuggestions,
  DEFAULT_REBALANCING_SETTINGS,
  formatCurrencyAmount
} from '../services/rebalancingService';

interface RebalancingModalProps {
  assets: Asset[];
  displayCurrency: Currency;
  exchangeRates: Record<string, number>;
  portfolioId: string;
  onClose: () => void;
}

export const RebalancingModal: React.FC<RebalancingModalProps> = ({
  assets,
  displayCurrency,
  exchangeRates,
  portfolioId,
  onClose,
}) => {
  // Settings state (persisted in component, could be moved to portfolio settings later)
  const [settings, setSettings] = useState<RebalancingSettings>({
    ...DEFAULT_REBALANCING_SETTINGS,
  });
  const [showSettings, setShowSettings] = useState(false);

  // Calculate suggestions
  const suggestion = useMemo<RebalancingSuggestion>(() => {
    return generateRebalancingSuggestions(
      portfolioId,
      assets,
      displayCurrency,
      exchangeRates,
      settings
    );
  }, [portfolioId, assets, displayCurrency, exchangeRates, settings]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Status icon and color helpers
  const getStatusIcon = (status: 'overweight' | 'underweight' | 'on-target') => {
    switch (status) {
      case 'overweight':
        return <TrendingUp size={14} className="text-red-400" />;
      case 'underweight':
        return <TrendingDown size={14} className="text-blue-400" />;
      case 'on-target':
        return <CheckCircle2 size={14} className="text-green-400" />;
    }
  };

  const getStatusColor = (status: 'overweight' | 'underweight' | 'on-target') => {
    switch (status) {
      case 'overweight':
        return 'text-red-400';
      case 'underweight':
        return 'text-blue-400';
      case 'on-target':
        return 'text-green-400';
    }
  };

  const getStatusBg = (status: 'overweight' | 'underweight' | 'on-target') => {
    switch (status) {
      case 'overweight':
        return 'bg-red-500/10 border-red-500/30';
      case 'underweight':
        return 'bg-blue-500/10 border-blue-500/30';
      case 'on-target':
        return 'bg-green-500/10 border-green-500/30';
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-slate-800 rounded-xl max-w-4xl w-full shadow-2xl border border-slate-700 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/20">
              <Scale size={24} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Portfolio Rebalancing</h2>
              <p className="text-sm text-slate-400">
                Total Value: {formatCurrencyAmount(suggestion.totalPortfolioValue, displayCurrency)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg transition-colors ${
                showSettings
                  ? 'bg-indigo-500/20 text-indigo-400'
                  : 'hover:bg-slate-700 text-slate-400'
              }`}
              title="Settings"
            >
              <Settings2 size={20} />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Settings Panel (collapsible) */}
        {showSettings && (
          <div className="p-4 bg-slate-900/50 border-b border-slate-700">
            <div className="flex flex-wrap gap-6">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-slate-400 mb-1">
                  Deviation Threshold (%)
                </label>
                <p className="text-[10px] text-slate-500 mb-2">
                  Assets within this % of target are considered "on-target"
                </p>
                <input
                  type="number"
                  value={settings.deviationThreshold}
                  onChange={(e) => setSettings(s => ({
                    ...s,
                    deviationThreshold: Math.max(0, parseFloat(e.target.value) || 0)
                  }))}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  min="0"
                  step="0.5"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-slate-400 mb-1">
                  Minimum Trade Amount ({displayCurrency})
                </label>
                <p className="text-[10px] text-slate-500 mb-2">
                  Trades below this amount will be ignored
                </p>
                <input
                  type="number"
                  value={settings.minTradeAmount}
                  onChange={(e) => setSettings(s => ({
                    ...s,
                    minTradeAmount: Math.max(0, parseFloat(e.target.value) || 0)
                  }))}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  min="0"
                  step="10"
                />
              </div>
            </div>
          </div>
        )}

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Info banner for assets without target */}
          {suggestion.assetsWithoutTarget > 0 && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <Info size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-200">
                {suggestion.assetsWithoutTarget} asset{suggestion.assetsWithoutTarget > 1 ? 's have' : ' has'} no target allocation set and {suggestion.assetsWithoutTarget > 1 ? 'are' : 'is'} excluded from rebalancing calculations.
              </p>
            </div>
          )}

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp size={16} className="text-red-400" />
                <span className="text-xs text-red-400 uppercase tracking-wider">Overweight</span>
              </div>
              <p className="text-2xl font-bold text-red-400">{suggestion.overweightCount}</p>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown size={16} className="text-blue-400" />
                <span className="text-xs text-blue-400 uppercase tracking-wider">Underweight</span>
              </div>
              <p className="text-2xl font-bold text-blue-400">{suggestion.underweightCount}</p>
            </div>
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={16} className="text-green-400" />
                <span className="text-xs text-green-400 uppercase tracking-wider">On Target</span>
              </div>
              <p className="text-2xl font-bold text-green-400">{suggestion.onTargetCount}</p>
            </div>
          </div>

          {/* Current vs Target Allocation Table */}
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <Target size={16} />
              Current vs Target Allocation
            </h3>
            {suggestion.deviations.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <p>No assets with target allocations found.</p>
                <p className="text-sm mt-1">Set target allocations on your assets to see rebalancing suggestions.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-xs uppercase tracking-wider">
                      <th className="text-left pb-3 font-medium">Asset</th>
                      <th className="text-right pb-3 font-medium">Value</th>
                      <th className="text-right pb-3 font-medium">Current %</th>
                      <th className="text-right pb-3 font-medium">Target %</th>
                      <th className="text-right pb-3 font-medium">Deviation</th>
                      <th className="text-center pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {suggestion.deviations.map((d) => (
                      <tr key={d.assetId} className="hover:bg-slate-700/30">
                        <td className="py-3">
                          <span className="font-medium text-white">{d.ticker}</span>
                          {d.name !== d.ticker && (
                            <span className="text-slate-400 text-xs ml-2">{d.name}</span>
                          )}
                        </td>
                        <td className="py-3 text-right text-slate-300">
                          {formatCurrencyAmount(d.currentValue, displayCurrency)}
                        </td>
                        <td className="py-3 text-right text-white font-medium">
                          {d.currentAllocation.toFixed(1)}%
                        </td>
                        <td className="py-3 text-right text-slate-400">
                          {d.targetAllocation.toFixed(1)}%
                        </td>
                        <td className={`py-3 text-right font-medium ${getStatusColor(d.status)}`}>
                          {d.deviation >= 0 ? '+' : ''}{d.deviation.toFixed(1)}%
                          <span className="text-xs ml-1 opacity-70">
                            ({d.deviationAmount >= 0 ? '+' : ''}{formatCurrencyAmount(d.deviationAmount, displayCurrency)})
                          </span>
                        </td>
                        <td className="py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${getStatusBg(d.status)}`}>
                            {getStatusIcon(d.status)}
                            <span className={getStatusColor(d.status)}>
                              {d.status === 'on-target' ? 'On Target' : d.status === 'overweight' ? 'Over' : 'Under'}
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Suggested Trades */}
          {suggestion.trades.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <RefreshCw size={16} />
                Suggested Rebalancing Trades
                <span className="text-xs font-normal text-slate-400">
                  (Total: {formatCurrencyAmount(suggestion.totalRebalanceAmount, displayCurrency)})
                </span>
              </h3>
              <div className="space-y-3">
                {suggestion.trades.map((trade, index) => (
                  <div
                    key={trade.id}
                    className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                        #{index + 1}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatCurrencyAmount(trade.sellAmount, displayCurrency)}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      {/* Sell Side */}
                      <div className="flex-1 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                        <div className="text-xs text-red-400 uppercase tracking-wider mb-1">Sell</div>
                        <div className="font-semibold text-white">{trade.sellTicker}</div>
                        <div className="text-sm text-slate-300 mt-1">
                          {trade.sellQuantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} units
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          @ {formatCurrencyAmount(trade.sellCurrentPrice, displayCurrency)}/unit
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex-shrink-0">
                        <ArrowRight size={24} className="text-slate-500" />
                      </div>

                      {/* Buy Side */}
                      <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                        <div className="text-xs text-blue-400 uppercase tracking-wider mb-1">Buy</div>
                        <div className="font-semibold text-white">{trade.buyTicker}</div>
                        <div className="text-sm text-slate-300 mt-1">
                          {trade.buyQuantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} units
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          @ {formatCurrencyAmount(trade.buyCurrentPrice, displayCurrency)}/unit
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Transaction costs note */}
              <div className="flex items-start gap-2 mt-3 text-xs text-slate-500">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <p>
                  These are suggested trades only. Actual execution will incur transaction costs,
                  spreads, and may be subject to minimum trade sizes on your exchange.
                </p>
              </div>
            </div>
          )}

          {/* No trades needed message */}
          {suggestion.trades.length === 0 && suggestion.deviations.length > 0 && (
            <div className="text-center py-8 bg-green-500/10 border border-green-500/30 rounded-lg">
              <CheckCircle2 size={48} className="text-green-400 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-green-400 mb-1">Portfolio is Balanced!</h3>
              <p className="text-sm text-slate-400">
                All assets are within your {settings.deviationThreshold}% deviation threshold.
                <br />
                No rebalancing trades are needed at this time.
              </p>
            </div>
          )}

          {/* Projected Allocations After Rebalancing */}
          {suggestion.trades.length > 0 && suggestion.projectedAllocations.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <Target size={16} />
                Projected Allocation After Rebalancing
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-xs uppercase tracking-wider">
                      <th className="text-left pb-3 font-medium">Asset</th>
                      <th className="text-right pb-3 font-medium">Before</th>
                      <th className="text-center pb-3 font-medium"></th>
                      <th className="text-right pb-3 font-medium">After</th>
                      <th className="text-right pb-3 font-medium">Target</th>
                      <th className="text-center pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {suggestion.projectedAllocations.map((p) => {
                      const afterDeviation = Math.abs(p.afterAllocation - p.targetAllocation);
                      const isOnTarget = afterDeviation <= settings.deviationThreshold;
                      return (
                        <tr key={p.ticker} className="hover:bg-slate-700/30">
                          <td className="py-3">
                            <span className="font-medium text-white">{p.ticker}</span>
                          </td>
                          <td className="py-3 text-right text-slate-400">
                            {p.beforeAllocation.toFixed(1)}%
                          </td>
                          <td className="py-3 text-center">
                            <ArrowRight size={14} className="text-slate-500 inline" />
                          </td>
                          <td className="py-3 text-right text-white font-medium">
                            {p.afterAllocation.toFixed(1)}%
                          </td>
                          <td className="py-3 text-right text-slate-400">
                            {p.targetAllocation.toFixed(1)}%
                          </td>
                          <td className="py-3 text-center">
                            {isOnTarget ? (
                              <span className="inline-flex items-center gap-1 text-green-400 text-xs">
                                <CheckCircle2 size={14} />
                                On Target
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-400 text-xs">
                                <AlertTriangle size={14} />
                                {(p.afterAllocation - p.targetAllocation).toFixed(1)}% off
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 bg-slate-900/50">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Last calculated: {new Date(suggestion.calculatedAt).toLocaleTimeString()}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
