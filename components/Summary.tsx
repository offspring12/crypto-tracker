import React, { useMemo, useState, useRef, useEffect } from 'react';
import { PortfolioSummary, Asset, Currency } from '../types';
import { fetchExchangeRates, convertCurrencySync, fetchHistoricalExchangeRates, convertCurrencySyncHistorical } from '../services/currencyService';
import { TrendingUp, PieChart, Clock, RefreshCw, TrendingDown, AlertTriangle } from 'lucide-react';

// P1.1 CHANGE: Updated interface to receive displayCurrency and exchangeRates as props
interface SummaryProps {
  summary: PortfolioSummary;
  assets: Asset[];
  onRefreshAll: () => void;
  isGlobalLoading: boolean;
  displayCurrency: Currency;
  setDisplayCurrency: (currency: Currency) => void;
  exchangeRates: Record<string, number>;
}

const CHART_COLORS = [
  '#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#f43f5e', '#a855f7', '#ec4899', '#06b6d4'
];

// Helper function to detect currency from ticker when asset.currency is missing
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

type TimeRange = '24H' | '1W' | '1M' | 'ALL' | 'CUSTOM';

interface ChartDataPoint {
  timestamp: number;
  costBasis: number;
  marketValue: number;
  stack: Record<string, number>;
  costStack: Record<string, number>;
}

// P1.1 CHANGE: Destructure displayCurrency, setDisplayCurrency, and exchangeRates from props
export const Summary: React.FC<SummaryProps> = ({ 
  summary, 
  assets, 
  onRefreshAll, 
  isGlobalLoading,
  displayCurrency,
  setDisplayCurrency,
  exchangeRates 
}) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('ALL');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [hoverData, setHoverData] = useState<{ x: number, y: number, data: ChartDataPoint } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [showAllAssets, setShowAllAssets] = useState(false);
  
  // P1.1 CHANGE: Remove local displayCurrency and exchangeRates state - now using props
  // P1.1 CHANGE: Keep ratesLoaded based on whether exchangeRates has data
  const ratesLoaded = Object.keys(exchangeRates).length > 0;
  
  const [historicalRates, setHistoricalRates] = useState<Record<string, Record<string, number>>>({});
  const [historicalRatesLoaded, setHistoricalRatesLoaded] = useState(false);

  // P1.1 CHANGE: Remove exchange rates loading useEffect - now handled in App.tsx

  // Load historical exchange rates when time range or assets change
  useEffect(() => {
    const loadHistoricalRates = async () => {
      if (assets.length === 0) {
        setHistoricalRatesLoaded(true);
        return;
      }

      // Find the earliest transaction date
      let earliestDate = new Date();
      assets.forEach(asset => {
        asset.transactions.forEach(tx => {
          const txDate = new Date(tx.date);
          if (txDate < earliestDate) {
            earliestDate = txDate;
          }
        });
      });

      // Fetch historical rates from earliest transaction to today
      console.log(`💱 Loading historical FX rates from ${earliestDate.toISOString().split('T')[0]} to today...`);
      const historical = await fetchHistoricalExchangeRates(earliestDate, new Date());
      setHistoricalRates(historical);
      setHistoricalRatesLoaded(true);
      console.log(`✅ Historical FX rates loaded: ${Object.keys(historical).length} days`);
    };

    loadHistoricalRates();
  }, [assets, timeRange]); // Re-load when assets or timeRange changes

  // 🔍 DEBUG: Log assets to see what currency field contains
  useEffect(() => {
    console.log('🔍 DEBUG - Assets in Summary:', assets.map(a => ({
      ticker: a.ticker,
      currency: a.currency,
      currentPrice: a.currentPrice,
      hasHistory: !!a.priceHistory,
      historyLength: a.priceHistory?.length || 0
    })));
  }, [assets]);

  // Convert any currency to display currency using dynamic rates
  // This is a wrapper around convertCurrencySync that uses the loaded exchange rates
  const convertToDisplayCurrency = (value: number, fromCurrency: string, toCurrency: string = 'USD'): number => {
    if (!ratesLoaded) {
      console.warn('⚠️ convertToDisplayCurrency called before rates loaded - returning original value');
      return value; // Return original value as fallback (better than 0)
    }
    return convertCurrencySync(value, fromCurrency, toCurrency, exchangeRates);
  };

  // P1.1B CHANGE: Calculate FX-adjusted totals from assets
  const { convertedTotalValue, convertedCostBasis, convertedPnL, formattedTotal, formattedPnL, pnlPercent } = useMemo(() => {
    if (!ratesLoaded) {
      // Return placeholder values while rates are loading
      return {
        convertedTotalValue: 0,
        convertedCostBasis: 0,
        convertedPnL: 0,
        formattedTotal: '...',
        formattedPnL: '...',
        pnlPercent: 0
      };
    }

    // Calculate totals by converting each asset to display currency
    let totalValue = 0;
    let totalCostBasis = 0;

    for (const asset of assets) {
      const assetCurrency = asset.currency || detectCurrencyFromTicker(asset.ticker);
      
      // Current value (simple)
      const assetValue = asset.quantity * asset.currentPrice;
      
      // P1.1B CHANGE: FX-adjusted cost basis
      // Sum up FX-adjusted costs from each transaction
      let assetFxAdjustedCost = 0;
      
      for (const tx of asset.transactions) {
        // If transaction has historical FX rates, use them
        if (tx.exchangeRateAtPurchase && tx.purchaseCurrency && tx.exchangeRateAtPurchase[assetCurrency]) {
          // Convert cost from purchase currency to asset currency using historical rate
          const costInAssetCurrency = tx.totalCost * tx.exchangeRateAtPurchase[assetCurrency];
          assetFxAdjustedCost += costInAssetCurrency;
        } else {
          // Fallback: use transaction cost as-is (backward compatible)
          assetFxAdjustedCost += tx.totalCost;
        }
      }

      // Convert both to display currency
      const valueInDisplay = convertToDisplayCurrency(assetValue, assetCurrency, displayCurrency);
      const costInDisplay = convertToDisplayCurrency(assetFxAdjustedCost, assetCurrency, displayCurrency);

      totalValue += valueInDisplay;
      totalCostBasis += costInDisplay;
    }

    const pnl = totalValue - totalCostBasis;
    const pnlPct = totalCostBasis > 0 ? (pnl / totalCostBasis) * 100 : 0;

    return {
      convertedTotalValue: totalValue,
      convertedCostBasis: totalCostBasis,
      convertedPnL: pnl,
      formattedTotal: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: displayCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(totalValue),
      formattedPnL: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: displayCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        signDisplay: "always"
      }).format(pnl),
      pnlPercent: pnlPct
    };
  }, [ratesLoaded, assets, displayCurrency, exchangeRates]);
  
  const formattedPnLPct = new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 2,
    signDisplay: "always"
  }).format(pnlPercent / 100);

  const isProfit = convertedPnL >= 0;

  // --- Stacked Area Chart Logic ---
  const { Chart, xAxisLabels, yAxisLabels, chartData, maxY } = useMemo(() => {
    // Helper: Detect currency from ticker
    const detectCurrencyFromTicker = (ticker: string): string => {
      // Cash/Currency codes
      if (['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'].includes(ticker.toUpperCase())) {
        return ticker.toUpperCase();
      }
      // Swiss stocks (.SW suffix)
      if (ticker.endsWith('.SW')) {
        return 'CHF';
      }
      // UK stocks (.L suffix)
      if (ticker.endsWith('.L')) {
        return 'GBP';
      }
      // Tokyo stocks (.T suffix)
      if (ticker.endsWith('.T')) {
        return 'JPY';
      }
      // Default to USD (US stocks, crypto, etc.)
      return 'USD';
    };

    // Early return if exchange rates not loaded yet
    if (!ratesLoaded || !historicalRatesLoaded) {
      return { 
        Chart: null, 
        xAxisLabels: [], 
        yAxisLabels: [], 
        chartData: [], 
        maxY: 0 
      };
    }

    const now = Date.now();
    let minTime = now;
    let maxTime = now;

    // 1. Determine Time Window
    let firstTxTimestamp = now;
    assets.forEach(a => {
      a.transactions.forEach(tx => {
        const t = new Date(tx.date).getTime();
        if (t < firstTxTimestamp) firstTxTimestamp = t;
      });
    });

    if (assets.length === 0 || firstTxTimestamp === now) {
      firstTxTimestamp = now - (24 * 60 * 60 * 1000);
    }

    if (timeRange === '24H') {
      minTime = now - (24 * 60 * 60 * 1000);
    } else if (timeRange === '1W') {
      minTime = now - (7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === '1M') {
      minTime = now - (30 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'ALL') {
      minTime = firstTxTimestamp;
      minTime = minTime - (minTime * 0.00001); 
    } else if (timeRange === 'CUSTOM' && customStart) {
      minTime = new Date(customStart).getTime();
      maxTime = customEnd ? new Date(customEnd).getTime() : now;
    }

    if (minTime >= maxTime) minTime = maxTime - (24 * 60 * 60 * 1000);

    // 2. Generate Time Steps
    const steps = 150;
    const stepSize = (maxTime - minTime) / steps;
    const generatedData: ChartDataPoint[] = [];

    for (let i = 0; i <= steps; i++) {
        const t = minTime + (stepSize * i);
        
        let totalCost = 0;
        let totalVal = 0;
        const stack: Record<string, number> = {};
        const costStack: Record<string, number> = {};
        
        assets.forEach(asset => {
            // A. Calculate Cumulative Quantity and FX-Adjusted Cost at time t
            let qtyAtTime = 0;
            let fxAdjustedCostAtTime = 0;
            
            asset.transactions.forEach(tx => {
               const txTime = new Date(tx.date).getTime();
               if (txTime <= t) {
                   qtyAtTime += tx.quantity;
                   
                   // P1.1B CHANGE: Use FX-adjusted cost if available
                   const assetCurrency = asset.currency || detectCurrencyFromTicker(asset.ticker);
                   if (tx.exchangeRateAtPurchase && tx.purchaseCurrency && tx.exchangeRateAtPurchase[assetCurrency]) {
                     // Convert from purchase currency to asset currency using historical rate
                     fxAdjustedCostAtTime += tx.totalCost * tx.exchangeRateAtPurchase[assetCurrency];
                   } else {
                     // Fallback: use transaction cost as-is
                     fxAdjustedCostAtTime += tx.totalCost;
                   }
               }
            });

            // If we didn't own it yet, value is 0
            if (qtyAtTime <= 0) {
                stack[asset.id] = 0;
                costStack[asset.id] = 0;
                return;
            }

            // Detect currency from ticker/asset
            const assetCurrency = asset.currency || detectCurrencyFromTicker(asset.ticker);
            
            // P1.1B CHANGE: Convert FX-adjusted cost to display currency using HISTORICAL rate for date t
            const costDate = new Date(t);
            const costInDisplay = convertCurrencySyncHistorical(
              fxAdjustedCostAtTime,
              assetCurrency,
              displayCurrency,
              costDate,
              historicalRates,
              exchangeRates
            );
            costStack[asset.id] = costInDisplay;

            // 🔧 FIX: Check if this is a cash asset (ticker is a currency code)
            const isCashAsset = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'].includes(asset.ticker.toUpperCase());

            let valInDisplay: number;

            if (isCashAsset) {
                // For cash: quantity is already the amount in native currency
                // Just convert quantity directly to display currency using historical rate
                const valDate = new Date(t);
                valInDisplay = convertCurrencySyncHistorical(
                  qtyAtTime,
                  assetCurrency,
                  displayCurrency,
                  valDate,
                  historicalRates,
                  exchangeRates
                );
            } else {
                // For stocks/crypto: use price history logic
                let estimatedPrice = asset.currentPrice;

                if (asset.priceHistory && asset.priceHistory.length > 0) {
                    const history = asset.priceHistory;
                    
                    // BEFORE first historical data point - use first purchase price
                    if (t < history[0][0]) {
                        const sortedTxs = asset.transactions
                            .slice()
                            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                        estimatedPrice = sortedTxs[0]?.pricePerCoin || asset.avgBuyPrice;
                    }
                    // AFTER last historical data point - use current price
                    else if (t >= history[history.length - 1][0]) {
                        estimatedPrice = asset.currentPrice;
                    }
                    // BETWEEN data points - interpolate
                    else {
                        const idx = history.findIndex(p => p[0] >= t);
                        
                        if (idx === 0) {
                            estimatedPrice = history[0][1];
                        } else if (idx === -1) {
                            estimatedPrice = history[history.length - 1][1];
                        } else {
                            const p1 = history[idx - 1];
                            const p2 = history[idx];
                            const span = p2[0] - p1[0];
                            if (span > 0) {
                                const progress = (t - p1[0]) / span;
                                estimatedPrice = p1[1] + (p2[1] - p1[1]) * progress;
                            } else {
                                estimatedPrice = p1[1];
                            }
                        }
                    }
                } else {
                    // No historical data - use purchase price before now, current price after
                    const sortedTxs = asset.transactions
                        .slice()
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                    const firstPurchaseTime = new Date(sortedTxs[0]?.date || now).getTime();
                    
                    if (t < firstPurchaseTime) {
                        estimatedPrice = sortedTxs[0]?.pricePerCoin || asset.avgBuyPrice;
                    } else {
                        estimatedPrice = asset.currentPrice;
                    }
                }

                const valInNativeCurrency = qtyAtTime * estimatedPrice;
                // Convert to display currency using HISTORICAL rate for date t
                const valDate = new Date(t);
                valInDisplay = convertCurrencySyncHistorical(
                  valInNativeCurrency,
                  assetCurrency,
                  displayCurrency,
                  valDate,
                  historicalRates,
                  exchangeRates
                );
            }
            
            stack[asset.id] = valInDisplay;
            totalVal += valInDisplay;
            totalCost += costInDisplay;
        });

        generatedData.push({
            timestamp: t,
            costBasis: totalCost,
            marketValue: totalVal,
            stack,
            costStack
        });
    }

    // 3. Render SVG
    const width = 100;
    const height = 100;

    let computedMaxY = 0;
    generatedData.forEach(d => {
        if (d.marketValue > computedMaxY) computedMaxY = d.marketValue;
        if (d.costBasis > computedMaxY) computedMaxY = d.costBasis;
    });
    if (computedMaxY === 0) computedMaxY = 100;
    computedMaxY = computedMaxY * 1.1;

    const getX = (ts: number) => ((ts - minTime) / (maxTime - minTime)) * width;
    const getY = (val: number) => height - ((val / computedMaxY) * height);

    // -- Create Stacked Paths --
    const stackedPaths: React.ReactNode[] = [];
    const currentBaselines = new Array(generatedData.length).fill(0);

    assets.forEach((asset, idx) => {
        const color = CHART_COLORS[idx % CHART_COLORS.length];
        
        const hasValue = generatedData.some(d => (d.stack[asset.id] || 0) > 0);
        if (!hasValue) return;

        const topPoints = generatedData.map((d, i) => {
            const val = d.stack[asset.id] || 0;
            const yTop = currentBaselines[i] + val;
            return { x: getX(d.timestamp), y: getY(yTop), val: yTop };
        });

        const bottomPoints = generatedData.map((d, i) => {
            const yBottom = currentBaselines[i];
            return { x: getX(d.timestamp), y: getY(yBottom) };
        }).reverse();

        topPoints.forEach((p, i) => {
            currentBaselines[i] = p.val; 
        });

        if (topPoints.length > 1) {
             let d = `M ${topPoints[0].x.toFixed(2)},${topPoints[0].y.toFixed(2)}`;
             for (let i = 1; i < topPoints.length; i++) d += ` L ${topPoints[i].x.toFixed(2)},${topPoints[i].y.toFixed(2)}`;
             for (let i = 0; i < bottomPoints.length; i++) d += ` L ${bottomPoints[i].x.toFixed(2)},${bottomPoints[i].y.toFixed(2)}`;
             d += " Z";
             
             stackedPaths.push(
                <path 
                    key={asset.id} 
                    d={d} 
                    fill={color} 
                    fillOpacity={0.7} 
                    stroke={color} 
                    strokeWidth={0.2}
                />
             );
        }
    });

    // -- Cost Basis Line --
    const costPathPoints = generatedData.map(d => `${getX(d.timestamp).toFixed(2)},${getY(d.costBasis).toFixed(2)}`);
    const costPathD = `M ${costPathPoints.join(' L ')}`;

    const FinalChart = (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
         {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <line key={p} x1="0" y1={height * p} x2={width} y2={height * p} stroke="#334155" strokeWidth="0.2" strokeDasharray="2 2" />
         ))}
         {stackedPaths}
         <path d={costPathD} fill="none" stroke="white" strokeWidth="0.8" strokeDasharray="2 1" strokeOpacity={0.9} vectorEffect="non-scaling-stroke" />
      </svg>
    );

    const xLabels = [0, 0.5, 1].map(p => {
        const t = minTime + ((maxTime - minTime) * p);
        const date = new Date(t);
        return {
           x: p * 100,
           text: timeRange === '24H' ? date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : date.toLocaleDateString([], {month:'short', day:'numeric', year: timeRange === 'ALL' ? '2-digit' : undefined})
        };
    });

    const yLabels = [0, 0.5, 1].map(p => {
       const val = computedMaxY * (1 - p);
       return {
          y: p * 100,
          text: new Intl.NumberFormat('en-US', { 
            notation: "compact", 
            minimumFractionDigits: 2,
            maximumFractionDigits: 2 
          }).format(val)
       };
    });

    return { Chart: FinalChart, xAxisLabels: xLabels, yAxisLabels: yLabels, chartData: generatedData, maxY: computedMaxY };

  }, [assets, timeRange, customStart, customEnd, displayCurrency, ratesLoaded, historicalRatesLoaded, exchangeRates, historicalRates]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!chartContainerRef.current || chartData.length === 0) return;
    
    const rect = chartContainerRef.current.getBoundingClientRect();
    let clientX;
    if ('touches' in e) clientX = e.touches[0].clientX;
    else clientX = (e as React.MouseEvent).clientX;

    const x = clientX - rect.left;
    const width = rect.width;
    const height = rect.height;
    
    if (width === 0) return;

    const ratio = Math.max(0, Math.min(1, x / width));
    const index = Math.floor(ratio * (chartData.length - 1));
    const dataPoint = chartData[index];

    if (dataPoint) {
        setHoverData({
            x: x,
            y: height - ((dataPoint.marketValue / maxY) * height),
            data: dataPoint
        });
    }
  };

  const handleMouseLeave = () => setHoverData(null);

  const pieChartData = useMemo(() => {
    if (!ratesLoaded || convertedTotalValue === 0) return { gradient: `conic-gradient(#334155 0% 100%)`, sortedAssets: [] };
    
    const sorted = [...assets]
      .map(asset => {
        // Convert asset value to display currency
        const assetCurrency = asset.currency || detectCurrencyFromTicker(asset.ticker);
        const valueInNativeCurrency = asset.quantity * asset.currentPrice;
        const valueInDisplay = convertToDisplayCurrency(valueInNativeCurrency, assetCurrency, displayCurrency);
        return { ...asset, value: valueInDisplay };
      })
      .sort((a, b) => b.value - a.value);

    let cumulative = 0;
    const segs: string[] = [];
    sorted.forEach((a, i) => {
        const pct = (a.value / convertedTotalValue) * 100;
        const color = CHART_COLORS[i % CHART_COLORS.length];
        segs.push(`${color} ${cumulative}% ${cumulative + pct}%`);
        cumulative += pct;
    });

    return {
        gradient: `conic-gradient(${segs.join(', ')})`,
        sortedAssets: sorted
    };
  }, [convertedTotalValue, assets, ratesLoaded, displayCurrency, exchangeRates]);

  return (
    <div className="space-y-4 mb-8">
      
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        
        <div className="col-span-1 md:col-span-4 bg-gradient-to-br from-indigo-600 to-indigo-900 rounded-xl p-6 shadow-lg text-white flex flex-col justify-between min-h-[180px]">
            <div>
              <div className="flex items-center justify-between mb-4">
                {/* P4 CHANGE: Add currency selector dropdown */}
                <div className="flex items-center gap-2 text-indigo-200">
                    <TrendingUp size={20} />
                    <span className="text-sm font-medium">Net Worth</span>
                    <select
                      value={displayCurrency}
                      onChange={(e) => setDisplayCurrency(e.target.value as 'USD' | 'CHF' | 'EUR')}
                      className="bg-white/10 border border-white/20 rounded px-2 py-0.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/40 cursor-pointer"
                    >
                      <option value="USD">USD</option>
                      <option value="CHF">CHF</option>
                      <option value="EUR">EUR</option>
                    </select>
                </div>
                <button 
                    onClick={onRefreshAll} 
                    disabled={isGlobalLoading}
                    className="p-1.5 bg-white/10 rounded hover:bg-white/20 transition-colors disabled:opacity-50"
                    title="Refresh All Prices"
                >
                    <RefreshCw size={16} className={isGlobalLoading ? "animate-spin" : ""} />
                </button>
              </div>
              <div className="text-3xl font-bold tracking-tight mb-1">{formattedTotal}</div>
              
              <div className={`inline-flex items-center gap-1 text-sm font-medium px-2 py-1 rounded ${isProfit ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'}`}>
                {isProfit ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                <span>{formattedPnL} ({formattedPnLPct})</span>
              </div>
            </div>
            <div className="text-xs text-indigo-300/80 mt-4 flex items-center gap-1">
              <Clock size={12} />
              Updated: {summary.lastGlobalUpdate ? new Date(summary.lastGlobalUpdate).toLocaleTimeString() : 'Never'}
            </div>
        </div>

        <div className="col-span-1 md:col-span-8 bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg flex flex-col md:flex-row items-center gap-6 min-h-[180px]">
            <div className="relative w-32 h-32 flex-shrink-0">
                <div 
                    className="w-full h-full rounded-full shadow-lg"
                    style={{ background: pieChartData.gradient }}
                ></div>
                <div className="absolute inset-0 m-auto w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700">
                    <PieChart size={24} className="text-slate-500" />
                </div>
            </div>

            <div className="flex-1 w-full">
                 {/* Dynamic layout: 1 column for ≤3 assets, 2 columns for 4+ assets */}
                 <div className={`grid gap-x-8 gap-y-2 ${pieChartData.sortedAssets.slice(0, 6).length <= 3 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
                    {/* Column headers - repeated for each column in 2-col layout */}
                    {pieChartData.sortedAssets.slice(0, 6).length <= 3 ? (
                        <div className="text-xs font-medium text-slate-400 mb-1 border-b border-slate-700 pb-2 grid grid-cols-4 gap-4">
                            <span className="col-span-1">Asset</span>
                            <span className="text-center">Allocation</span>
                            <span className="text-center">Target</span>
                            <span className="text-center">Delta</span>
                        </div>
                    ) : (
                        <>
                            <div className="text-xs font-medium text-slate-400 mb-1 border-b border-slate-700 pb-2 grid grid-cols-4 gap-4">
                                <span className="col-span-1">Asset</span>
                                <span className="text-center">Allocation</span>
                                <span className="text-center">Target</span>
                                <span className="text-center">Delta</span>
                            </div>
                            <div className="text-xs font-medium text-slate-400 mb-1 border-b border-slate-700 pb-2 grid grid-cols-4 gap-4 hidden lg:grid">
                                <span className="col-span-1">Asset</span>
                                <span className="text-center">Allocation</span>
                                <span className="text-center">Target</span>
                                <span className="text-center">Delta</span>
                            </div>
                        </>
                    )}
                    
                    {pieChartData.sortedAssets.slice(0, 6).map((asset, index) => {
                        const currentPct = (asset.value / convertedTotalValue) * 100;
                        const target = asset.targetAllocation || 0;
                        const deviation = target > 0 ? currentPct - target : 0;
                        const isSignificant = Math.abs(deviation) >= 5;

                        return (
                            <div key={asset.id} className="grid grid-cols-4 gap-4 items-center text-xs py-1">
                                 <div className="flex items-center gap-2 col-span-1 min-w-0">
                                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: CHART_COLORS[index % CHART_COLORS.length]}}></div>
                                    <span className="text-slate-200 font-medium truncate">
                                      {asset.name || asset.ticker}
                                      {asset.currency && asset.currency !== 'USD' && (
                                        <span className="ml-1 text-[9px] text-amber-400">({asset.currency})</span>
                                      )}
                                    </span>
                                 </div>
                                 <div className="text-center">
                                    <span className="text-slate-300 font-medium">{currentPct.toFixed(1)}%</span>
                                 </div>
                                 <div className="text-center">
                                    {target > 0 ? (
                                        <span className="text-slate-400">{target}%</span>
                                    ) : (
                                        <span className="text-slate-600">—</span>
                                    )}
                                 </div>
                                 <div className="text-center">
                                    {target > 0 ? (
                                        <span className={`inline-flex items-center justify-center gap-1 ${
                                            isSignificant 
                                                ? (deviation > 0 ? 'text-amber-500' : 'text-blue-400')
                                                : 'text-slate-500'
                                        }`}>
                                            {isSignificant && <AlertTriangle size={10} />}
                                            {deviation > 0 ? '+' : ''}{deviation.toFixed(1)}%
                                        </span>
                                    ) : (
                                        <span className="text-slate-600">—</span>
                                    )}
                                 </div>
                            </div>
                        );
                    })}
                 </div>
                 {/* Show All Button - Only display if more than 6 assets */}
                 {pieChartData.sortedAssets.length > 6 && (
                   <div className="mt-3 text-center">
                     <button
                       onClick={() => setShowAllAssets(!showAllAssets)}
                       className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors flex items-center gap-1 mx-auto"
                     >
                       {showAllAssets ? (
                         <>Show less ▲</>
                       ) : (
                         <>Show {pieChartData.sortedAssets.length - 6} more ▼</>
                       )}
                     </button>
                   </div>
                 )}
            </div>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
              {/* P4 CHANGE: Show selected currency in title */}
              <div className="text-sm font-medium text-slate-300">Portfolio History ({displayCurrency})</div>
              
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {timeRange === 'CUSTOM' && (
                  <div className="flex items-center gap-2 mr-2">
                     <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white" />
                     <span className="text-slate-500">-</span>
                     <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white" />
                  </div>
                )}
                <div className="flex items-center bg-slate-900 rounded-lg p-1">
                  {(['24H', '1W', '1M', 'ALL', 'CUSTOM'] as TimeRange[]).map(range => (
                      <button
                          key={range}
                          onClick={() => setTimeRange(range)}
                          className={`text-[10px] font-bold px-3 py-1 rounded transition-colors ${timeRange === range ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                          {range}
                      </button>
                  ))}
                </div>
              </div>
          </div>
          
          <div className="relative">
             <div className="absolute left-0 top-0 bottom-6 w-10 flex flex-col justify-between text-[9px] text-slate-500 pointer-events-none py-2 text-right pr-1 z-10">
                {yAxisLabels.map((lbl, i) => (
                   <span key={i}>{lbl.text}</span>
                ))}
             </div>

             <div 
                ref={chartContainerRef}
                className="h-64 bg-slate-900/30 rounded-lg relative ml-10 w-[calc(100%-40px)] cursor-crosshair touch-none"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onTouchMove={handleMouseMove}
             >
                {!ratesLoaded || !historicalRatesLoaded ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-slate-500 text-sm flex items-center gap-2">
                      <RefreshCw className="animate-spin" size={16} />
                      Loading exchange rates...
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 p-2 pointer-events-none">
                      {Chart}
                  </div>
                )}

                {hoverData && ratesLoaded && historicalRatesLoaded && (
                   <>
                      <div className="absolute top-0 bottom-0 w-px bg-white/40 pointer-events-none z-20" style={{ left: hoverData.x }} />
                      <div 
                        className="absolute bg-slate-800/95 border border-slate-600 rounded p-4 shadow-2xl z-30 min-w-[280px] backdrop-blur tooltip-container"
                        style={{ 
                          left: hoverData.x > ((chartContainerRef.current?.offsetWidth || 300) / 2) 
                            ? Math.max(0, hoverData.x - 280 - 20)
                            : Math.min(hoverData.x + 20, (chartContainerRef.current?.offsetWidth || 300) - 280),
                          top: 20,
                          pointerEvents: 'none'
                        }}
                      >
                         <div className="text-xs text-slate-400 mb-2 border-b border-slate-700 pb-1 font-mono">
                            {new Date(hoverData.data.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                         </div>
                         
                         <div className="grid grid-cols-2 gap-x-4 mb-3 border-b border-slate-700/50 pb-2">
                            <div>
                                <span className="text-[10px] text-slate-400 uppercase">Value ({displayCurrency})</span>
                                <div className="text-sm font-bold text-white">
                                    {new Intl.NumberFormat('en-US', { 
                                      style: 'currency', 
                                      currency: displayCurrency,
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2
                                    }).format(hoverData.data.marketValue || 0)}
                                </div>
                            </div>
                            <div className="text-right">
                                <span className="text-[10px] text-slate-400 uppercase">P&L</span>
                                <div className={`text-sm font-bold ${hoverData.data.marketValue >= hoverData.data.costBasis ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {((hoverData.data.marketValue - hoverData.data.costBasis) / (hoverData.data.costBasis || 1) * 100).toFixed(2)}%
                                </div>
                            </div>
                         </div>

                         <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Holding Breakdown</div>
                         <div className={`space-y-1.5 ${assets.length > 6 ? 'max-h-[300px] overflow-y-auto' : 'max-h-[400px]'} custom-scrollbar`}>
                            {assets
                                .map((a, i) => {
                                    const val = hoverData.data.stack[a.id] || 0;
                                    const cost = hoverData.data.costStack[a.id] || 0;
                                    const pl = val - cost;
                                    const plPct = cost > 0 ? (pl / cost) * 100 : 0;
                                    
                                    return { 
                                        ticker: a.name || a.ticker,
                                        currency: a.currency,
                                        val,
                                        pl,
                                        plPct,
                                        color: CHART_COLORS[i % CHART_COLORS.length]
                                    };
                                })
                                .filter(item => item.val > 0)
                                .sort((a, b) => b.val - a.val)
                                .map((item) => (
                                    <div key={item.ticker} className="grid grid-cols-3 items-center text-xs">
                                        <div className="flex items-center gap-1.5 col-span-1">
                                            <div className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                                            <span className="text-slate-300 font-medium">
                                              {item.ticker}
                                              {item.currency && item.currency !== 'USD' && (
                                                <span className="ml-1 text-[9px] text-amber-400">({item.currency})</span>
                                              )}
                                            </span>
                                        </div>
                                        <div className="text-right text-slate-400 col-span-1">
                                            {new Intl.NumberFormat('en-US', { 
                                              style: 'currency', 
                                              currency: displayCurrency, 
                                              notation: 'compact' 
                                            }).format(item.val)}
                                        </div>
                                        <div className={`text-right col-span-1 ${item.pl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {item.pl >= 0 ? '+' : ''}{item.plPct.toFixed(1)}%
                                        </div>
                                    </div>
                                ))
                            }
                         </div>
                      </div>
                   </>
                )}
                
                <div className="absolute bottom-0 left-0 right-0 h-6 flex justify-between px-2 pointer-events-none">
                    {xAxisLabels.map((lbl, i) => (
                        <span 
                            key={i} 
                            className="text-[10px] text-slate-500 whitespace-nowrap"
                            style={{ position: 'absolute', left: `${lbl.x}%`, transform: 'translateX(-50%)', bottom: '-20px' }}
                        >
                            {lbl.text}
                        </span>
                    ))}
                </div>
             </div>
             
             {/* 📊 CHART LEGEND - ONLY CHANGE */}
             <div className="flex items-center justify-center gap-6 mt-6 text-xs text-slate-400">
               <div className="flex items-center gap-2">
                 <div className="w-8 h-0.5 border-t-2 border-dashed border-white opacity-90"></div>
                 <span>Cost Basis (Total Invested)</span>
               </div>
               <div className="flex items-center gap-2">
                 <div className="w-8 h-3 bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-sm opacity-70"></div>
                 <span>Market Value (Current Holdings)</span>
               </div>
             </div>
          </div>
      </div>

    </div>
  );
};