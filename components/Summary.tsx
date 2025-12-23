import React, { useMemo, useState, useRef } from 'react';
import { PortfolioSummary, Asset } from '../types';
import { TrendingUp, PieChart, Clock, RefreshCw, TrendingDown, AlertTriangle } from 'lucide-react';

interface SummaryProps {
  summary: PortfolioSummary;
  assets: Asset[];
  onRefreshAll: () => void;
  isGlobalLoading: boolean;
}

const CHART_COLORS = [
  '#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#f43f5e', '#a855f7', '#ec4899', '#06b6d4'
];

type TimeRange = '24H' | '1W' | '1M' | 'ALL' | 'CUSTOM';

interface ChartDataPoint {
  timestamp: number;
  costBasis: number;
  marketValue: number;
  stack: Record<string, number>;
  costStack: Record<string, number>; // New: Track cost basis per asset per point
}

export const Summary: React.FC<SummaryProps> = ({ summary, assets, onRefreshAll, isGlobalLoading }) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('ALL');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [hoverData, setHoverData] = useState<{ x: number, y: number, data: ChartDataPoint } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const formattedTotal = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(summary.totalValue);

  const formattedPnL = new Intl.NumberFormat('en-US', {
     style: 'currency',
     currency: 'USD',
     maximumFractionDigits: 0,
     signDisplay: "always"
  }).format(summary.totalPnL);
  
  const formattedPnLPct = new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 2,
    signDisplay: "always"
  }).format(summary.totalPnLPercent / 100);

  const isProfit = summary.totalPnL >= 0;

  // --- Stacked Area Chart Logic (Hybrid: Real History + Interpolation) ---
  const { Chart, xAxisLabels, yAxisLabels, chartData, maxY } = useMemo(() => {
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

    // If no transactions, default to 24h ago
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
      // Add a tiny buffer before the first tx so it doesn't start exactly on the axis edge
      minTime = minTime - (minTime * 0.00001); 
    } else if (timeRange === 'CUSTOM' && customStart) {
      minTime = new Date(customStart).getTime();
      maxTime = customEnd ? new Date(customEnd).getTime() : now;
    }

    // Ensure minTime is strictly less than maxTime
    if (minTime >= maxTime) minTime = maxTime - (24 * 60 * 60 * 1000);

    // 2. Build Price Anchors for each Asset (Fallback if no history)
    const priceAnchors: Record<string, { time: number, price: number }[]> = {};
    
    assets.forEach(asset => {
      // If we DON'T have real history, build simple anchors
      if (!asset.priceHistory || asset.priceHistory.length === 0) {
        const anchors = asset.transactions.map(tx => ({
          time: new Date(tx.date).getTime(),
          price: tx.pricePerCoin
        }));
        anchors.push({ time: now, price: asset.currentPrice });
        anchors.sort((a, b) => a.time - b.time);
        
        const uniqueAnchors = [];
        if (anchors.length > 0) {
          uniqueAnchors.push(anchors[0]);
          for (let i = 1; i < anchors.length; i++) {
            if (anchors[i].time > anchors[i-1].time) {
              uniqueAnchors.push(anchors[i]);
            }
          }
        }
        priceAnchors[asset.id] = uniqueAnchors;
      }
    });

    // 3. Generate Time Steps
    const steps = 150; // Resolution
    const stepSize = (maxTime - minTime) / steps;
    const generatedData: ChartDataPoint[] = [];

    for (let i = 0; i <= steps; i++) {
        const t = minTime + (stepSize * i);
        
        let totalCost = 0;
        let totalVal = 0;
        const stack: Record<string, number> = {};
        const costStack: Record<string, number> = {};
        
        assets.forEach(asset => {
            // A. Calculate Cumulative Quantity at time t
            let qtyAtTime = 0;
            let costAtTime = 0;
            
            asset.transactions.forEach(tx => {
               const txTime = new Date(tx.date).getTime();
               if (txTime <= t) {
                   qtyAtTime += tx.quantity;
                   costAtTime += tx.totalCost;
               }
            });

            // If we didn't own it yet, value is 0
            if (qtyAtTime <= 0) {
                stack[asset.id] = 0;
                costStack[asset.id] = 0;
                return;
            }

            costStack[asset.id] = costAtTime;

            // B. Find Price at time t
            let estimatedPrice = asset.currentPrice;

            if (asset.priceHistory && asset.priceHistory.length > 0) {
                // --- STRATEGY 1: REAL HISTORY ---
                const assetHistory = asset.priceHistory; // Renamed to avoid shadowing prop
                const idx = assetHistory.findIndex(p => p[0] >= t);
                
                if (idx === 0) {
                   estimatedPrice = assetHistory[0][1];
                } else if (idx === -1) {
                   // t is newer than last history point, use last known
                   estimatedPrice = assetHistory[assetHistory.length - 1][1];
                } else {
                   // Interpolate between idx-1 and idx
                   const p1 = assetHistory[idx-1];
                   const p2 = assetHistory[idx];
                   const span = p2[0] - p1[0];
                   if (span > 0) {
                      const progress = (t - p1[0]) / span;
                      estimatedPrice = p1[1] + (p2[1] - p1[1]) * progress;
                   } else {
                      estimatedPrice = p1[1];
                   }
                }

            } else {
                // --- STRATEGY 2: ANCHOR FALLBACK ---
                const anchors = priceAnchors[asset.id] || [];
                if (anchors.length > 0) {
                   if (t <= anchors[0].time) estimatedPrice = anchors[0].price;
                   else if (t >= anchors[anchors.length - 1].time) estimatedPrice = anchors[anchors.length - 1].price;
                   else {
                     for (let k = 0; k < anchors.length - 1; k++) {
                        if (t >= anchors[k].time && t <= anchors[k+1].time) {
                           const prev = anchors[k];
                           const next = anchors[k+1];
                           const timeSpan = next.time - prev.time;
                           if (timeSpan > 0) {
                              const progress = (t - prev.time) / timeSpan;
                              estimatedPrice = prev.price + (next.price - prev.price) * progress;
                           } else {
                              estimatedPrice = prev.price;
                           }
                           break;
                        }
                     }
                   }
                }
            }

            const val = qtyAtTime * estimatedPrice;
            stack[asset.id] = val;
            totalVal += val;
            totalCost += costAtTime;
        });

        generatedData.push({
            timestamp: t,
            costBasis: totalCost,
            marketValue: totalVal,
            stack, // breakdown of value
            costStack // breakdown of cost
        });
    }

    // 4. Render SVG
    const width = 100;
    const height = 100;

    let computedMaxY = 0;
    generatedData.forEach(d => {
        if (d.marketValue > computedMaxY) computedMaxY = d.marketValue;
        if (d.costBasis > computedMaxY) computedMaxY = d.costBasis;
    });
    if (computedMaxY === 0) computedMaxY = 100;
    computedMaxY = computedMaxY * 1.1; // 10% padding

    const getX = (ts: number) => ((ts - minTime) / (maxTime - minTime)) * width;
    const getY = (val: number) => height - ((val / computedMaxY) * height);

    // -- Create Stacked Paths --
    const stackedPaths: React.ReactNode[] = [];
    const currentBaselines = new Array(generatedData.length).fill(0);

    assets.forEach((asset, idx) => {
        const color = CHART_COLORS[idx % CHART_COLORS.length];
        
        // Check if asset actually has value in this window
        const hasValue = generatedData.some(d => (d.stack[asset.id] || 0) > 0);
        if (!hasValue) return;

        // Top line points
        const topPoints = generatedData.map((d, i) => {
            const val = d.stack[asset.id] || 0;
            const yTop = currentBaselines[i] + val;
            return { x: getX(d.timestamp), y: getY(yTop), val: yTop };
        });

        // Bottom line points (reverse)
        const bottomPoints = generatedData.map((d, i) => {
            const yBottom = currentBaselines[i];
            return { x: getX(d.timestamp), y: getY(yBottom) };
        }).reverse();

        // Update baselines
        topPoints.forEach((p, i) => {
            currentBaselines[i] = p.val; 
        });

        // Construct Path D
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
         {/* Grid */}
         {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <line key={p} x1="0" y1={height * p} x2={width} y2={height * p} stroke="#334155" strokeWidth="0.2" strokeDasharray="2 2" />
         ))}

         {/* Stacked Areas */}
         {stackedPaths}

         {/* Cost Basis Line (Dashed White) */}
         <path d={costPathD} fill="none" stroke="white" strokeWidth="0.8" strokeDasharray="2 1" strokeOpacity={0.9} vectorEffect="non-scaling-stroke" />
      </svg>
    );

    // Labels
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
          text: new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(val)
       };
    });

    return { Chart: FinalChart, xAxisLabels: xLabels, yAxisLabels: yLabels, chartData: generatedData, minTime, maxTime, maxY: computedMaxY };

  }, [assets, timeRange, customStart, customEnd]);

  // --- Hover Logic ---
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
    
    // Find index directly from ratio
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


  // --- Pie Chart Logic ---
  const pieChartData = useMemo(() => {
    if (summary.totalValue === 0) return { gradient: `conic-gradient(#334155 0% 100%)`, sortedAssets: [] };
    
    const sorted = [...assets]
      .map(asset => ({ ...asset, value: asset.quantity * asset.currentPrice }))
      .sort((a, b) => b.value - a.value);

    let cumulative = 0;
    const segs: string[] = [];
    sorted.forEach((a, i) => {
        const pct = (a.value / summary.totalValue) * 100;
        const color = CHART_COLORS[i % CHART_COLORS.length];
        segs.push(`${color} ${cumulative}% ${cumulative + pct}%`);
        cumulative += pct;
    });

    return {
        gradient: `conic-gradient(${segs.join(', ')})`,
        sortedAssets: sorted
    };
  }, [summary.totalValue, assets]);


  return (
    <div className="space-y-4 mb-8">
      
      {/* Top Row */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        
        {/* Net Worth Card */}
        <div className="col-span-1 md:col-span-4 bg-gradient-to-br from-indigo-600 to-indigo-900 rounded-xl p-6 shadow-lg text-white flex flex-col justify-between min-h-[180px]">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-indigo-200">
                    <TrendingUp size={20} />
                    <span className="text-sm font-medium">Net Worth</span>
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

        {/* Allocation Card */}
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

            <div className="flex-1 w-full grid grid-cols-2 gap-x-6 gap-y-2">
                 <div className="col-span-2 text-xs font-medium text-slate-400 mb-1 border-b border-slate-700 pb-1 flex justify-between">
                    <span>Asset Allocation</span>
                    <span className="text-slate-500">Target Dev.</span>
                 </div>
                 {pieChartData.sortedAssets.slice(0, 6).map((asset, index) => {
                    const currentPct = (asset.value / summary.totalValue) * 100;
                    const target = asset.targetAllocation || 0;
                    const deviation = target > 0 ? currentPct - target : 0;
                    const isSignificant = Math.abs(deviation) >= 5;

                    return (
                        <div key={asset.id} className="flex items-center justify-between text-xs">
                             <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART_COLORS[index % CHART_COLORS.length]}}></div>
                                <span className="text-slate-200 font-medium">{asset.name || asset.ticker}</span>
                             </div>
                             <div className="flex items-center gap-3">
                                <span className="text-slate-400">{currentPct.toFixed(1)}%</span>
                                {target > 0 && isSignificant && (
                                    <span className={`flex items-center gap-0.5 text-[10px] ${deviation > 0 ? 'text-amber-500' : 'text-blue-400'}`} title={`Target: ${target}%`}>
                                        <AlertTriangle size={10} />
                                        {deviation > 0 ? '+' : ''}{deviation.toFixed(1)}%
                                    </span>
                                )}
                             </div>
                        </div>
                    );
                 })}
            </div>
        </div>
      </div>

      {/* Bottom Row: History Graph */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
              <div className="text-sm font-medium text-slate-300">Portfolio History</div>
              
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
          
          {/* Graph Area */}
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
                <div className="absolute inset-0 p-2 pointer-events-none">
                    {Chart}
                </div>

                {/* Hover Tooltip */}
                {hoverData && (
                   <>
                      <div className="absolute top-0 bottom-0 w-px bg-white/40 pointer-events-none z-20" style={{ left: hoverData.x }} />
                      <div 
                        className="absolute bg-slate-800/95 border border-slate-600 rounded p-4 shadow-2xl z-30 min-w-[280px] backdrop-blur tooltip-container"
                        style={{ 
                          left: hoverData.x > ((chartContainerRef.current?.offsetWidth || 300) / 2) 
                            ? Math.max(0, hoverData.x - 280 - 20)  // Right side: show tooltip on left
                            : Math.min(hoverData.x + 20, (chartContainerRef.current?.offsetWidth || 300) - 280), // Left side: show tooltip on right
                          top: 20,
                          pointerEvents: 'none'
                        }}
                      >
                         <div className="text-xs text-slate-400 mb-2 border-b border-slate-700 pb-1 font-mono">
                            {new Date(hoverData.data.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                         </div>
                         
                         <div className="grid grid-cols-2 gap-x-4 mb-3 border-b border-slate-700/50 pb-2">
                            <div>
                                <span className="text-[10px] text-slate-400 uppercase">Value</span>
                                <div className="text-sm font-bold text-white">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(hoverData.data.marketValue || 0)}
                                </div>
                            </div>
                            <div className="text-right">
                                <span className="text-[10px] text-slate-400 uppercase">P&L</span>
                                <div className={`text-sm font-bold ${hoverData.data.marketValue >= hoverData.data.costBasis ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {((hoverData.data.marketValue - hoverData.data.costBasis) / (hoverData.data.costBasis || 1) * 100).toFixed(2)}%
                                </div>
                            </div>
                         </div>

                         {/* Breakdown of Top Assets at this timestamp */}
                         <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Holding Breakdown</div>
                         <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                            {assets
                                .map((a, i) => {
                                    const val = hoverData.data.stack[a.id] || 0;
                                    const cost = hoverData.data.costStack[a.id] || 0;
                                    const pl = val - cost;
                                    const plPct = cost > 0 ? (pl / cost) * 100 : 0;
                                    
                                    return { 
                                        ticker: a.name || a.ticker, 
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
                                            <span className="text-slate-300 font-medium">{item.ticker}</span>
                                        </div>
                                        <div className="text-right text-slate-400 col-span-1">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' }).format(item.val)}
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
                
                {/* X-Axis Labels */}
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
             <div className="h-6"></div>
          </div>
      </div>

    </div>
  );
};