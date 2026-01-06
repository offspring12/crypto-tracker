import React, { useState, useMemo, useEffect } from 'react';
import { Asset, Currency, RiskAnalysis, RiskTimePeriod } from '../types';
import { calculateRiskAnalysis } from '../services/riskMetricsService';
import { TrendingUp, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

interface RiskMetricsProps {
  assets: Asset[];
  displayCurrency: Currency;
  exchangeRates: Record<string, number>;
  historicalRates: Record<string, Record<string, number>>;
}

export const RiskMetrics: React.FC<RiskMetricsProps> = ({
  assets,
  displayCurrency,
  exchangeRates,
  historicalRates
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [timePeriod, setTimePeriod] = useState<RiskTimePeriod>('1Y');
  const [riskAnalysis, setRiskAnalysis] = useState<RiskAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Calculate risk analysis when inputs change
  useEffect(() => {
    const calculateRisk = async () => {
      if (assets.length === 0) {
        setRiskAnalysis(null);
        return;
      }

      setIsLoading(true);
      try {
        const analysis = await calculateRiskAnalysis(
          assets,
          timePeriod,
          displayCurrency,
          exchangeRates,
          historicalRates
        );
        setRiskAnalysis(analysis);
      } catch (error) {
        console.error('Risk analysis failed:', error);
        setRiskAnalysis(null);
      } finally {
        setIsLoading(false);
      }
    };

    calculateRisk();
  }, [assets, timePeriod, displayCurrency, exchangeRates, historicalRates]);

  const getRiskEmoji = (rating: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME'): string => {
    switch (rating) {
      case 'LOW': return '🟢';
      case 'MODERATE': return '🟡';
      case 'HIGH': return '🟠';
      case 'EXTREME': return '🔴';
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg mb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="text-indigo-500" size={20} />
          <h2 className="text-lg font-semibold text-slate-100">Risk Analysis</h2>
          {isLoading && <Loader2 className="animate-spin text-slate-400" size={16} />}
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-slate-400 hover:text-white transition-colors"
        >
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
      </div>

      {/* Collapsed Summary */}
      {!isExpanded && riskAnalysis && (
        <div className="mt-4 flex items-center gap-4 text-sm text-slate-300">
          <span>Volatility: {(riskAnalysis.portfolio.annualizedVolatility * 100).toFixed(1)}%</span>
          <span>•</span>
          <span>Max DD: {riskAnalysis.portfolio.maxDrawdown.percent.toFixed(1)}%</span>
          <span>•</span>
          <span>Risk: {getRiskEmoji(riskAnalysis.portfolio.volatilityRating)} {riskAnalysis.portfolio.volatilityRating}</span>
        </div>
      )}

      {/* Expanded Content */}
      {isExpanded && (
        <div className="space-y-4 mt-4">
          {/* Insufficient Data Warning */}
          {!riskAnalysis && !isLoading && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <p className="text-amber-200 text-sm">
                Not enough data for risk analysis. Need at least 30 days of price history.
              </p>
            </div>
          )}

          {riskAnalysis && (
            <>
              {/* Time Period Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Analysis Period:</span>
                <div className="flex items-center bg-slate-900 rounded-lg p-1">
                  {(['30D', '90D', '1Y'] as RiskTimePeriod[]).map(p => (
                    <button
                      key={p}
                      onClick={() => setTimePeriod(p)}
                      className={`text-[10px] font-bold px-3 py-1 rounded transition-colors ${
                        timePeriod === p ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Risk Overview Cards - Phase 4 with VaR/CVaR */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Volatility Card */}
                <div className="bg-slate-900/50 rounded-lg p-4" title="Annualized volatility measures the portfolio's price fluctuations. Higher volatility means larger price swings. Calculated using standard deviation of daily returns over the selected period.">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400 uppercase">Portfolio Volatility</span>
                    <span className="text-2xl">{getRiskEmoji(riskAnalysis.portfolio.volatilityRating)}</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {(riskAnalysis.portfolio.annualizedVolatility * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {riskAnalysis.portfolio.volatilityRating} Risk • {riskAnalysis.portfolio.dataPoints} days
                  </div>
                  {riskAnalysis.portfolio.sharpeRatio !== null && (
                    <div className="text-xs text-slate-500 mt-2" title="Sharpe Ratio measures risk-adjusted returns. Higher is better. Above 1 is good, above 2 is very good, above 3 is excellent.">
                      Sharpe: {riskAnalysis.portfolio.sharpeRatio.toFixed(2)}
                    </div>
                  )}
                </div>

                {/* Max Drawdown Card */}
                <div className="bg-slate-900/50 rounded-lg p-4" title="Maximum Drawdown shows the largest peak-to-trough decline in portfolio value. It measures the worst loss from a historical high point. Duration shows how long it took to reach the bottom.">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400 uppercase">Maximum Drawdown</span>
                    <TrendingUp className="text-rose-400 rotate-180" size={20} />
                  </div>
                  <div className="text-2xl font-bold text-rose-400">
                    {riskAnalysis.portfolio.maxDrawdown.percent.toFixed(1)}%
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Duration: {riskAnalysis.portfolio.maxDrawdown.durationDays} days
                  </div>
                </div>

                {/* Concentration Card */}
                <div className="bg-slate-900/50 rounded-lg p-4" title="Herfindahl-Hirschman Index (HHI) measures portfolio concentration. 100 = fully concentrated in one asset, lower values = more diversified. Top 3 shows the combined weight of your three largest positions.">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400 uppercase">Concentration Risk</span>
                    <span className="text-2xl">{getRiskEmoji(riskAnalysis.portfolio.concentration.rating)}</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {(riskAnalysis.portfolio.concentration.herfindahlIndex * 100).toFixed(1)}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Top 3: {riskAnalysis.portfolio.concentration.top3Percent.toFixed(1)}%
                  </div>
                </div>

                {/* VaR Card */}
                <div className="bg-slate-900/50 rounded-lg p-4" title="Value at Risk (VaR) represents the maximum expected loss at 95% confidence level over one day. For example, a VaR of 1,000 means there's a 95% chance your portfolio won't lose more than 1,000 in a single day.">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400 uppercase">Value at Risk (95%)</span>
                    <span className="text-xl">📉</span>
                  </div>
                  <div className="text-2xl font-bold text-orange-400">
                    {riskAnalysis.portfolio.valueAtRisk95
                      ? `${displayCurrency} ${Math.abs(riskAnalysis.portfolio.valueAtRisk95.amount).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}`
                      : 'N/A'}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Daily loss threshold (95%)
                  </div>
                  {riskAnalysis.portfolio.conditionalVaR95 && (
                    <div className="text-xs text-slate-500 mt-2" title="Conditional VaR (CVaR) represents the average loss in the worst 5% of cases. It shows what you can expect to lose when losses exceed the VaR threshold.">
                      CVaR: {displayCurrency} {Math.abs(riskAnalysis.portfolio.conditionalVaR95.amount).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Asset Risk Breakdown - Simplified Table */}
              <div className="bg-slate-900/50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-slate-300 mb-3">Asset Risk Breakdown</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-500 border-b border-slate-700">
                      <tr>
                        <th className="text-left py-2 px-2">Asset</th>
                        <th className="text-right py-2 px-2">Weight</th>
                        <th className="text-right py-2 px-2">Beta</th>
                        <th className="text-right py-2 px-2">Volatility</th>
                        <th className="text-right py-2 px-2">Risk Contrib</th>
                        <th className="text-center py-2 px-2">Rating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                      {riskAnalysis.assets
                        .sort((a, b) => b.portfolioWeight - a.portfolioWeight)
                        .map(asset => (
                          <tr key={asset.assetId} className="text-slate-300 hover:bg-slate-800/50">
                            <td className="py-2 px-2 font-medium">{asset.name}</td>
                            <td className="text-right py-2 px-2">{asset.portfolioWeight.toFixed(1)}%</td>
                            <td className="text-right py-2 px-2">{asset.beta.toFixed(2)}</td>
                            <td className="text-right py-2 px-2">{(asset.annualizedVolatility * 100).toFixed(1)}%</td>
                            <td className="text-right py-2 px-2">{asset.riskContribution.toFixed(1)}%</td>
                            <td className="text-center py-2 px-2">
                              {getRiskEmoji(asset.riskRating)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Info Tooltip about FX Risk */}
              <div className="text-xs text-slate-500 italic border-l-2 border-indigo-500/30 pl-3">
                ℹ️ Risk metrics include currency exchange rate volatility. Calculations use {riskAnalysis.portfolio.dataPoints} days of historical data.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
