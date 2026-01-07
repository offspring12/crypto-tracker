import React, { useMemo, useState } from 'react';
import { Asset, Currency, TagPerformance } from '../types';
import { convertCurrencySync } from '../services/currencyService';
import { BarChart3, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Tag } from 'lucide-react';

interface TagAnalyticsProps {
  assets: Asset[];
  displayCurrency: Currency;
  exchangeRates: Record<string, number>;
}

// Helper function to detect currency from ticker
const detectCurrencyFromTicker = (ticker: string): string => {
  const upper = ticker.toUpperCase();
  
  // Cash currencies
  if (upper === 'CHF' || upper === 'EUR' || upper === 'GBP' || 
      upper === 'JPY' || upper === 'CAD' || upper === 'AUD') {
    return upper;
  }
  
  // Stock exchanges
  if (upper.endsWith('.SW')) return 'CHF'; // Swiss stocks
  if (upper.endsWith('.DE') || upper.endsWith('.F')) return 'EUR'; // German stocks
  if (upper.endsWith('.L')) return 'GBP'; // London stocks
  if (upper.endsWith('.T')) return 'JPY'; // Tokyo stocks
  if (upper.endsWith('.TO')) return 'CAD'; // Toronto stocks
  if (upper.endsWith('.AX')) return 'AUD'; // Australian stocks
  
  // Default to USD for crypto and US stocks
  return 'USD';
};

// Color thresholds for performance
const getPerformanceColor = (pnlPercent: number): string => {
  if (pnlPercent >= 50) return 'bg-emerald-500';
  if (pnlPercent >= 20) return 'bg-emerald-600';
  if (pnlPercent >= 1) return 'bg-emerald-700';
  if (pnlPercent >= -1) return 'bg-slate-600';
  if (pnlPercent >= -20) return 'bg-rose-700';
  if (pnlPercent >= -50) return 'bg-rose-600';
  return 'bg-rose-500';
};

const getPerformanceTextColor = (pnlPercent: number): string => {
  if (pnlPercent >= 1) return 'text-emerald-400';
  if (pnlPercent >= -1) return 'text-slate-400';
  return 'text-rose-400';
};

export const TagAnalytics: React.FC<TagAnalyticsProps> = ({ assets, displayCurrency, exchangeRates }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());

  // Calculate tag performance
  const tagPerformance = useMemo<TagPerformance[]>(() => {
    if (Object.keys(exchangeRates).length === 0) {
      return []; // Wait for exchange rates to load
    }

    const tagMap = new Map<string, TagPerformance>();
    
    // Iterate through all assets
    for (const asset of assets) {
      const assetCurrency = asset.currency || detectCurrencyFromTicker(asset.ticker);

      // P2: Only include BUY transactions (exclude SELL transactions from strategy performance)
      const buyTransactions = asset.transactions.filter(tx => tx.type === 'BUY');

      // Iterate through all BUY transactions in each asset
      for (const tx of buyTransactions) {
        const tag = tx.tag || 'Untagged';

        // P1.1B CHANGE: Calculate FX-adjusted cost basis
        // Convert cost from purchase currency directly to display currency using HISTORICAL rates
        let investedInDisplay: number;

        if (tx.exchangeRateAtPurchase && tx.purchaseCurrency) {
          // Use historical rates from the transaction's purchase date
          investedInDisplay = convertCurrencySync(
            tx.totalCost,
            tx.purchaseCurrency,
            displayCurrency,
            tx.exchangeRateAtPurchase
          );
        } else {
          // Fallback: convert using current rates (backward compatible)
          investedInDisplay = convertCurrencySync(
            tx.totalCost,
            assetCurrency,
            displayCurrency,
            exchangeRates
          );
        }

        // Calculate current value from this transaction and convert using current rates
        const currentValueFromTx = asset.currentPrice * tx.quantity;
        const currentValueInDisplay = convertCurrencySync(
          currentValueFromTx,
          assetCurrency,
          displayCurrency,
          exchangeRates
        );
        
        // Initialize tag data if needed
        if (!tagMap.has(tag)) {
          tagMap.set(tag, {
            tag,
            totalInvested: 0,
            currentValue: 0,
            pnl: 0,
            pnlPercent: 0,
            transactionCount: 0,
            assetBreakdown: []
          });
        }
        
        const tagData = tagMap.get(tag)!;
        tagData.totalInvested += investedInDisplay;
        tagData.currentValue += currentValueInDisplay;
        tagData.transactionCount++;
        
        // Update or add asset breakdown
        let assetEntry = tagData.assetBreakdown.find(a => a.ticker === asset.ticker);
        if (!assetEntry) {
          assetEntry = {
            ticker: asset.ticker,
            name: asset.name || asset.ticker,
            invested: 0,
            currentValue: 0,
            pnl: 0,
            pnlPercent: 0
          };
          tagData.assetBreakdown.push(assetEntry);
        }
        
        assetEntry.invested += investedInDisplay;
        assetEntry.currentValue += currentValueInDisplay;
      }
    }
    
    // Calculate P&L for each tag
    for (const tagData of tagMap.values()) {
      tagData.pnl = tagData.currentValue - tagData.totalInvested;
      tagData.pnlPercent = tagData.totalInvested > 0 
        ? (tagData.pnl / tagData.totalInvested) * 100 
        : 0;
      
      // Calculate P&L for each asset in breakdown
      for (const asset of tagData.assetBreakdown) {
        asset.pnl = asset.currentValue - asset.invested;
        asset.pnlPercent = asset.invested > 0 
          ? (asset.pnl / asset.invested) * 100 
          : 0;
      }
      
      // Sort asset breakdown by P&L percent (best first)
      tagData.assetBreakdown.sort((a, b) => b.pnlPercent - a.pnlPercent);
    }
    
    // Convert to array and sort by performance (best first)
    return Array.from(tagMap.values()).sort((a, b) => b.pnlPercent - a.pnlPercent);
  }, [assets, displayCurrency, exchangeRates]);

  // Find best and worst performers
  const bestPerformer = tagPerformance[0];
  const worstPerformer = tagPerformance[tagPerformance.length - 1];
  const totalTransactions = tagPerformance.reduce((sum, t) => sum + t.transactionCount, 0);

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: displayCurrency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });

  // Empty state
  if (tagPerformance.length === 0 && assets.length > 0) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg mb-8">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="text-indigo-500" size={20} />
          <h2 className="text-lg font-semibold text-slate-100">Strategy Performance</h2>
        </div>
        
        <div className="text-center py-8">
          <div className="text-6xl mb-4">🏷️</div>
          <h3 className="text-xl font-semibold text-slate-200 mb-2">No Tagged Transactions Yet</h3>
          <p className="text-slate-400 mb-2">
            Start tagging your transactions to unlock powerful strategy performance analytics!
          </p>
          <p className="text-sm text-slate-500">
            💡 Tags help you track which entry strategies work best for your portfolio.
          </p>
        </div>
      </div>
    );
  }

  if (tagPerformance.length === 0) {
    return null; // Don't show anything if no assets at all
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="text-indigo-500" size={20} />
          <h2 className="text-lg font-semibold text-slate-100">Strategy Performance</h2>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition-colors"
        >
          {isExpanded ? (
            <>
              Hide Details <ChevronUp size={14} />
            </>
          ) : (
            <>
              Show Details <ChevronDown size={14} />
            </>
          )}
        </button>
      </div>

      {/* Collapsed State - Summary */}
      {!isExpanded && (
        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              {bestPerformer && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">🏆 Best:</span>
                  <span className="text-emerald-400 font-medium">
                    {bestPerformer.tag} {bestPerformer.pnlPercent >= 0 ? '+' : ''}
                    {bestPerformer.pnlPercent.toFixed(1)}%
                  </span>
                  <span className="text-slate-500">
                    ({currencyFormatter.format(bestPerformer.pnl)})
                  </span>
                </div>
              )}
              
              {worstPerformer && worstPerformer !== bestPerformer && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">💀 Worst:</span>
                  <span className="text-rose-400 font-medium">
                    {worstPerformer.tag} {worstPerformer.pnlPercent >= 0 ? '+' : ''}
                    {worstPerformer.pnlPercent.toFixed(1)}%
                  </span>
                  <span className="text-slate-500">
                    ({currencyFormatter.format(worstPerformer.pnl)})
                  </span>
                </div>
              )}
            </div>
            
            <div className="text-slate-500 text-xs">
              {tagPerformance.length} {tagPerformance.length === 1 ? 'strategy' : 'strategies'} · {totalTransactions} transactions
            </div>
          </div>
        </div>
      )}

      {/* Expanded State - Full Breakdown */}
      {isExpanded && (
        <div className="space-y-3 mt-4">
          {tagPerformance.map((tag) => {
            const isTagExpanded = expandedTags.has(tag.tag);
            const maxPnlPercent = Math.max(...tagPerformance.map(t => Math.abs(t.pnlPercent)));
            const barWidth = maxPnlPercent > 0 ? (Math.abs(tag.pnlPercent) / maxPnlPercent) * 100 : 0;

            return (
              <div key={tag.tag} className="bg-slate-900/50 rounded-lg p-3">
                {/* Bar Chart Row */}
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-24 text-sm font-medium text-slate-300 flex-shrink-0">
                    <Tag size={12} className="inline mr-1" />
                    {tag.tag}
                  </div>
                  
                  <div className="flex-1 relative h-6 bg-slate-800 rounded overflow-hidden">
                    <div
                      className={`h-full ${getPerformanceColor(tag.pnlPercent)} transition-all duration-300`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  
                  <div className="w-32 text-right flex-shrink-0">
                    <span className={`text-sm font-bold ${getPerformanceTextColor(tag.pnlPercent)}`}>
                      {tag.pnlPercent >= 0 ? '+' : ''}{tag.pnlPercent.toFixed(1)}%
                    </span>
                    <span className="text-xs text-slate-500 ml-2">
                      ({currencyFormatter.format(tag.pnl)})
                    </span>
                  </div>
                  
                  <button
                    onClick={() => {
                      const newExpanded = new Set(expandedTags);
                      if (isTagExpanded) {
                        newExpanded.delete(tag.tag);
                      } else {
                        newExpanded.add(tag.tag);
                      }
                      setExpandedTags(newExpanded);
                    }}
                    className="text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    {isTagExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                {/* Asset Breakdown Table */}
                {isTagExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-700/50">
                    <div className="text-xs font-medium text-slate-400 mb-2">
                      {tag.tag} Strategy Breakdown
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-slate-500 border-b border-slate-700/50">
                          <tr>
                            <th className="text-left py-2">Asset</th>
                            <th className="text-right py-2">Invested</th>
                            <th className="text-right py-2">Current</th>
                            <th className="text-right py-2">P&L</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/30">
                          {tag.assetBreakdown.map((asset) => (
                            <tr key={asset.ticker} className="text-slate-300">
                              <td className="py-2 font-medium">{asset.name}</td>
                              <td className="text-right text-slate-400">
                                {currencyFormatter.format(asset.invested)}
                              </td>
                              <td className="text-right text-slate-400">
                                {currencyFormatter.format(asset.currentValue)}
                              </td>
                              <td className={`text-right font-medium ${getPerformanceTextColor(asset.pnlPercent)}`}>
                                {asset.pnlPercent >= 0 ? '+' : ''}{asset.pnlPercent.toFixed(1)}% 
                                {asset.pnlPercent >= 1 ? ' 🟢' : asset.pnlPercent <= -1 ? ' 🔴' : ''}
                              </td>
                            </tr>
                          ))}
                          <tr className="font-bold text-slate-200 border-t-2 border-slate-600">
                            <td className="py-2">Total</td>
                            <td className="text-right">{currencyFormatter.format(tag.totalInvested)}</td>
                            <td className="text-right">{currencyFormatter.format(tag.currentValue)}</td>
                            <td className={`text-right ${getPerformanceTextColor(tag.pnlPercent)}`}>
                              {tag.pnlPercent >= 0 ? '+' : ''}{tag.pnlPercent.toFixed(1)}% 
                              {tag.pnlPercent >= 1 ? ' 🟢' : tag.pnlPercent <= -1 ? ' 🔴' : ''}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};