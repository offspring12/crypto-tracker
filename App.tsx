import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Asset, Portfolio, PortfolioSummary, Transaction, HistorySnapshot, TransactionTag, Currency, BenchmarkSettings, BenchmarkData, TransactionType } from './types';
import { fetchCryptoPrice, fetchAssetHistory, delay } from './services/geminiService';
import { fetchHistoricalExchangeRates } from './services/currencyService';
import { AssetCard } from './components/AssetCard';
import { AddAssetForm } from './components/AddAssetForm';
import { TransactionModal } from './components/TransactionModal'; // P3: Cash Flow Management
import { Summary } from './components/Summary';
import { TagAnalytics } from './components/TagAnalytics';
import { RiskMetrics } from './components/RiskMetrics';
import { ApiKeySettings } from './components/ApiKeySettings';
import { PortfolioManager } from './components/PortfolioManager';
import { SellModal } from './components/SellModal';
import { ClosedPositionsPanel } from './components/ClosedPositionsPanel';
import { TransactionHistoryPage } from './components/TransactionHistory';
import { calculateRealizedPnL, detectAssetNativeCurrency, getHistoricalPrice, isCashAsset } from './services/portfolioService';
import { validateBuyTransaction } from './services/cashFlowValidation'; // P3: Cash Flow Validation
import { Wallet, Download, Upload, Settings, Key, FolderOpen, Plus, Check, History } from 'lucide-react';
import { testPhase1 } from './services/riskMetricsService'; // P1.2 TEST IMPORT
import { createDefaultBenchmarkSettings, fetchMultipleBenchmarks, BenchmarkTimeRange } from './services/benchmarkService'; // Benchmark comparison
import { PORTFOLIO_COLORS, migrateToPortfolios, migrateTransactionTags } from './services/portfolioMigration'; // Portfolio migration
import { useCurrency } from './hooks/useCurrency'; // Currency state management
import { useBenchmarks } from './hooks/useBenchmarks'; // Benchmark comparison state
import { usePortfolios } from './hooks/usePortfolios'; // Portfolio state management
import { useAssetHandlers } from './hooks/useAssetHandlers'; // Asset CRUD operations
import { useTransactionHandlers } from './hooks/useTransactionHandlers'; // Transaction handlers
import { useTransactionModifiers } from './hooks/useTransactionModifiers'; // Transaction removal/editing
import { useAssetNotes } from './hooks/useAssetNotes'; // Asset notes management
import { NoteModal } from './components/NoteModal'; // Asset notes modal

const App: React.FC = () => {
  // Portfolio state management (extracted to usePortfolios hook)
  const {
    portfolios,
    setPortfolios,
    activePortfolioId,
    setActivePortfolioId,
    activePortfolio,
    assets,
    history,
    updateActivePortfolio,
    handleCreatePortfolio,
    handleRenamePortfolio,
    handleDeletePortfolio,
  } = usePortfolios();

  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPortfolioManagerOpen, setIsPortfolioManagerOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [sellModalAsset, setSellModalAsset] = useState<Asset | null>(null); // P2: Sell modal state
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false); // P3: Transaction modal state
  const [showTransactionHistory, setShowTransactionHistory] = useState(false); // Transaction History view toggle
  // Quick transaction pre-selection state (for opening modal from position card icons)
  const [quickTransactionAsset, setQuickTransactionAsset] = useState<string | undefined>(undefined);
  const [quickTransactionType, setQuickTransactionType] = useState<'DEPOSIT' | 'BUY' | 'SELL' | 'WITHDRAW' | 'TRANSFER' | 'INCOME' | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Asset notes modal state
  const [noteModalAsset, setNoteModalAsset] = useState<Asset | null>(null);

  // Currency state management (extracted to useCurrency hook)
  const { displayCurrency, setDisplayCurrency, exchangeRates } = useCurrency('USD');

  // P1.2 NEW: Historical exchange rates for risk metrics
  const [historicalRates, setHistoricalRates] = useState<Record<string, Record<string, number>>>({});

  // Benchmark comparison state (extracted to useBenchmarks hook)
  const {
    benchmarkSettings,
    benchmarkDataMap,
    isBenchmarkLoading,
    benchmarkLoadingTickers,
    benchmarkTimeRange,
    handleBenchmarkSettingsChange,
    handleBenchmarkRefresh,
    handleTimeRangeChange,
  } = useBenchmarks({
    portfolioBenchmarkSettings: activePortfolio?.benchmarkSettings,
    onSettingsChange: useCallback((newSettings: BenchmarkSettings) => {
      setPortfolios(prev => prev.map(p => {
        if (p.id === activePortfolioId) {
          return { ...p, benchmarkSettings: newSettings };
        }
        return p;
      }));
    }, [activePortfolioId]),
  });

  // Asset CRUD operations (extracted to useAssetHandlers hook)
  const {
    handleUpdateAsset,
    handleRefreshAsset,
    handleAddAsset,
    handleRemoveAsset,
  } = useAssetHandlers({
    assets,
    portfolios,
    activePortfolioId,
    updateActivePortfolio,
  });

  // Transaction handlers (extracted to useTransactionHandlers hook)
  const {
    handleDeposit,
    handleIncome,
    handleWithdrawal,
    handleBuyWithValidation,
    handlePortfolioTransfer,
  } = useTransactionHandlers({
    assets,
    portfolios,
    activePortfolioId,
    activePortfolio,
    updateActivePortfolio,
    setPortfolios,
    displayCurrency,
    exchangeRates,
    handleAddAsset,
  });

  // Transaction removal/editing (extracted to useTransactionModifiers hook)
  const {
    handleRemoveTransaction,
    handleEditTransaction,
  } = useTransactionModifiers({
    assets,
    portfolios,
    activePortfolioId,
    activePortfolio,
    updateActivePortfolio,
    setPortfolios,
    displayCurrency,
    handleRemoveAsset,
  });

  // Asset notes management (extracted to useAssetNotes hook)
  const {
    getNote,
    saveNote,
    deleteNote,
    hasNote,
  } = useAssetNotes({
    activePortfolio,
    updateActivePortfolio,
  });

  // Calculate summary - values are aggregated by Summary.tsx with currency conversion
  const summary: PortfolioSummary = useMemo(() => {
    // Don't convert currencies here - Summary.tsx handles display currency conversion
    // Just aggregate the raw values in their native currencies
    const assetData = assets.map(asset => ({
      value: asset.quantity * asset.currentPrice,
      costBasis: asset.totalCostBasis,
      currency: asset.currency || 'USD'
    }));

    // For a multi-currency portfolio, we can't accurately calculate totals here
    // Summary.tsx will convert each asset to display currency and sum them
    // For now, return placeholder values that Summary.tsx will override
    return {
      totalValue: 0, // Will be calculated in Summary.tsx
      totalCostBasis: 0, // Will be calculated in Summary.tsx
      totalPnL: 0, // Will be calculated in Summary.tsx
      totalPnLPercent: 0, // Will be calculated in Summary.tsx
      // P2: Trading Lifecycle - Split P&L (calculated in Summary.tsx)
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0,
      realizedPnL: 0,
      realizedPnLPercent: 0,
      assetCount: assets.length,
      closedPositionCount: activePortfolio?.closedPositions?.length || 0,
      lastGlobalUpdate: assets.reduce((latest, a) =>
        a.lastUpdated > latest ? a.lastUpdated : latest,
        assets[0]?.lastUpdated || null
      )
    };
  }, [assets, activePortfolio?.closedPositions]);

  useEffect(() => {
    const checkApiKey = () => {
      const key = localStorage.getItem('gemini_api_key');
      setHasApiKey(!!key);
    };
    checkApiKey();
    window.addEventListener('storage', checkApiKey);
    return () => window.removeEventListener('storage', checkApiKey);
  }, [isSettingsOpen]);

  // P1.2: Load historical exchange rates for risk metrics
  useEffect(() => {
    if (assets.length > 0 && Object.keys(exchangeRates).length > 0) {
      const loadHistoricalRates = async () => {
        // Find earliest transaction for historical rates
        let earliestDate = new Date();
        assets.forEach(asset => {
          asset.transactions.forEach(tx => {
            const txDate = new Date(tx.date);
            if (txDate < earliestDate) earliestDate = txDate;
          });
        });

        const rates = await fetchHistoricalExchangeRates(earliestDate, new Date());
        setHistoricalRates(rates);

        // P1.2 TEST: Expose test function to browser console (temporary)
        (window as any).testRiskMetrics = () => {
          testPhase1(assets, displayCurrency, exchangeRates, rates);
        };

        // P1.2 DEBUG: Expose price history inspector
        (window as any).inspectPrices = (ticker: string) => {
          const asset = assets.find(a => a.ticker.toUpperCase() === ticker.toUpperCase());
          if (!asset) {
            console.error(`❌ Asset ${ticker} not found`);
            return;
          }

          console.log(`📊 Price History for ${ticker}:`);
          console.log(`   Current Price: ${asset.currentPrice} ${asset.currency}`);
          console.log(`   History Length: ${asset.priceHistory?.length || 0} data points`);

          if (asset.priceHistory && asset.priceHistory.length > 0) {
            // Show first 10 and last 10 data points
            console.log('\n📈 First 10 data points:');
            console.table(asset.priceHistory.slice(0, 10).map(([ts, price]) => ({
              date: new Date(ts).toISOString().split('T')[0],
              timestamp: ts,
              price: price.toFixed(2)
            })));

            console.log('\n📈 Last 10 data points:');
            console.table(asset.priceHistory.slice(-10).map(([ts, price]) => ({
              date: new Date(ts).toISOString().split('T')[0],
              timestamp: ts,
              price: price.toFixed(2)
            })));

            // Export full data for manual calculation
            console.log('\n💾 Full price history (copy this for Excel/manual calculation):');
            const csvData = asset.priceHistory.map(([ts, price]) => {
              const d = new Date(ts);
              const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              return `${dateStr},${price}`;
            }).join('\n');
            console.log('Date,Price');
            console.log(csvData);

            // Calculate basic statistics
            const prices = asset.priceHistory.map(([_, p]) => p);
            const returns = [];
            for (let i = 1; i < prices.length; i++) {
              returns.push((prices[i] - prices[i-1]) / prices[i-1]);
            }
            const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
            const stdDev = Math.sqrt(variance);
            const annualizedVol = stdDev * Math.sqrt(252); // 252 trading days for stocks

            console.log('\n📊 Quick Statistics:');
            console.log(`   Daily returns: ${returns.length} days`);
            console.log(`   Avg daily return: ${(avgReturn * 100).toFixed(4)}%`);
            console.log(`   Daily volatility (std dev): ${(stdDev * 100).toFixed(4)}%`);
            console.log(`   Annualized volatility: ${(annualizedVol * 100).toFixed(2)}%`);
          }

          return asset.priceHistory;
        };

        console.log('🧪 P1.2 TEST: Type testRiskMetrics() in console to test Phase 1 implementation');
        console.log('📊 DEBUG: Type inspectPrices("NESN.SW") to see price history and calculate volatility');
      };
      loadHistoricalRates();
    }
  }, [assets, exchangeRates, displayCurrency]);

  const recordHistorySnapshot = useCallback((currentAssets: Asset[]) => {
    const totalValue = currentAssets.reduce((sum, a) => sum + (a.quantity * a.currentPrice), 0);
    if (totalValue === 0) return;
    const snapshot: HistorySnapshot = {
      timestamp: Date.now(),
      totalValue,
      assetValues: currentAssets.reduce((acc, a) => ({ ...acc, [a.ticker]: a.quantity * a.currentPrice }), {})
    };
    updateActivePortfolio(portfolio => ({
      ...portfolio,
      history: [...portfolio.history, snapshot].slice(-200) // Keep last 200
    }));
  }, [activePortfolioId]);

  // handleRemoveTransaction and handleEditTransaction extracted to useTransactionModifiers hook
  // See hooks/useTransactionModifiers.ts

  const handleRefreshAll = async () => {
    if (isLoading) return;
    setIsLoading(true);
    const updated = [...assets];
    for (let i = 0; i < updated.length; i++) {
      try {
        const res = await fetchCryptoPrice(updated[i].ticker);
        updated[i] = { ...updated[i], currentPrice: res.price, lastUpdated: new Date().toISOString(), name: res.name || res.symbol || updated[i].name };
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: [...updated]
        }));
        await delay(300);
      } catch (e) {}
    }
    recordHistorySnapshot(updated);
    setIsLoading(false);

    // Also refresh visible benchmarks when refreshing portfolio
    handleBenchmarkRefresh();
  };

  // Quick transaction handler - opens TransactionModal with pre-selected asset and type
  // Note: TransactionType from types.ts uses 'WITHDRAWAL', but TransactionModal uses 'WITHDRAW'
  const handleQuickTransaction = (asset: Asset, transactionType: TransactionType) => {
    setQuickTransactionAsset(asset.ticker);
    // Map WITHDRAWAL -> WITHDRAW for TransactionModal compatibility
    const modalType = transactionType === 'WITHDRAWAL' ? 'WITHDRAW' : transactionType;
    setQuickTransactionType(modalType as 'DEPOSIT' | 'BUY' | 'SELL' | 'WITHDRAW' | 'TRANSFER' | 'INCOME');
    setIsTransactionModalOpen(true);
  };

  const exportPortfolio = () => {
    // Export ALL portfolios + price snapshots + deleted portfolios
    const snapshots: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('price_snapshots_')) {
        const ticker = key.replace('price_snapshots_', '');
        const data = localStorage.getItem(key);
        if (data) snapshots[ticker] = JSON.parse(data);
      }
    }
    
    const deletedPortfolios = JSON.parse(localStorage.getItem('deleted_portfolios') || '[]');
    
    const dataStr = JSON.stringify({ 
      portfolios, 
      deletedPortfolios,
      priceSnapshots: snapshots 
    }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `portfolio-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  };

  const importPortfolio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        
        if (parsed.portfolios) {
          setPortfolios(parsed.portfolios);
          setActivePortfolioId(parsed.portfolios[0]?.id || '');
        } else if (parsed.assets) {
          // Old format - migrate
          const migratedPortfolios = migrateToPortfolios();
          setPortfolios(migratedPortfolios);
          setActivePortfolioId(migratedPortfolios[0].id);
        }
        
        if (parsed.priceSnapshots) {
          Object.entries(parsed.priceSnapshots).forEach(([ticker, snapshots]) => {
            localStorage.setItem(`price_snapshots_${ticker}`, JSON.stringify(snapshots));
          });
        }
        
        alert("Portfolio imported successfully!");
      } catch (err) {
        alert("Invalid portfolio file.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-20">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg"><Wallet className="text-white" size={24} /></div>
            <h1 className="text-xl font-bold text-white">Portfolio Tracker</h1>
            {activePortfolio && (
              <div className="relative group">
                <button 
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 transition-colors"
                  style={{ borderLeftColor: activePortfolio.color, borderLeftWidth: '3px' }}
                >
                  <FolderOpen size={16} style={{ color: activePortfolio.color }} />
                  <span className="text-sm font-medium" style={{ color: activePortfolio.color }}>
                    {activePortfolio.name}
                  </span>
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {/* Dropdown Menu */}
                <div className="absolute top-full left-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <div className="p-2 max-h-80 overflow-y-auto">
                    {portfolios.map(portfolio => (
                      <button
                        key={portfolio.id}
                        onClick={() => setActivePortfolioId(portfolio.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                          portfolio.id === activePortfolioId
                            ? 'bg-indigo-600/20 text-indigo-400'
                            : 'hover:bg-slate-700/50 text-slate-300'
                        }`}
                      >
                        <div 
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: portfolio.color }}
                        />
                        <span className="flex-1 text-sm font-medium">{portfolio.name}</span>
                        {portfolio.id === activePortfolioId && (
                          <Check size={14} className="text-indigo-400" />
                        )}
                      </button>
                    ))}
                    <div className="border-t border-slate-700 mt-2 pt-2">
                      <button
                        onClick={() => setIsPortfolioManagerOpen(true)}
                        className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-700/50 transition-colors"
                      >
                        <Plus size={14} />
                        <span className="text-sm font-medium">New Portfolio</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* View Toggle Tabs */}
            <div className="flex items-center gap-1 ml-4 bg-slate-800/50 rounded-lg p-1 border border-slate-700">
              <button
                onClick={() => setShowTransactionHistory(false)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  !showTransactionHistory
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setShowTransactionHistory(true)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  showTransactionHistory
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                <History size={14} />
                Transactions
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPortfolioManagerOpen(true)}
              className="p-2 text-slate-400 hover:text-white transition-colors"
              title="Manage Portfolios"
            >
              <FolderOpen size={20} />
            </button>
            <button 
              onClick={() => setIsSettingsOpen(true)} 
              className={`p-2 rounded-lg transition-colors ${hasApiKey ? 'text-emerald-400 hover:text-emerald-300' : 'text-amber-400 hover:text-amber-300 animate-pulse'}`}
              title={hasApiKey ? "API Key Configured" : "Configure API Key"}
            >
              {hasApiKey ? <Key size={20} /> : <Settings size={20} />}
            </button>
            <input type="file" ref={fileInputRef} onChange={importPortfolio} accept=".json" className="hidden" />
            <button onClick={exportPortfolio} className="p-2 text-slate-400 hover:text-white" title="Export Data"><Upload size={20} /></button>
            <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-white" title="Import Data"><Download size={20} /></button>
          </div>
        </div>
      </header>

      {!hasApiKey && (
        <div className="max-w-screen-2xl mx-auto px-8 pt-4">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-start gap-3">
            <Key className="text-amber-400 flex-shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <p className="text-amber-200 font-medium mb-1">API Key Required</p>
              <p className="text-amber-200/80 text-sm mb-3">
                To fetch cryptocurrency prices, you need to configure your Gemini API key.
              </p>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Configure API Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conditional rendering: Dashboard or Transaction History */}
      {showTransactionHistory ? (
        <TransactionHistoryPage
          portfolios={portfolios}
          displayCurrency={displayCurrency}
          exchangeRates={exchangeRates}
          activePortfolioId={activePortfolio?.id || ''}
          activePortfolioName={activePortfolio?.name || 'Portfolio'}
        />
      ) : (
        <main className="max-w-screen-2xl mx-auto px-8 py-8">
          {/* P1.1 CHANGE: Pass displayCurrency, setDisplayCurrency, and exchangeRates to Summary */}
          {/* P2: Pass closedPositions for realized P&L */}
          <Summary
            summary={summary}
            assets={assets}
            closedPositions={activePortfolio?.closedPositions || []}
            onRefreshAll={handleRefreshAll}
            isGlobalLoading={isLoading}
            displayCurrency={displayCurrency}
            setDisplayCurrency={setDisplayCurrency}
            exchangeRates={exchangeRates}
            portfolioId={activePortfolio?.id || ''}
            portfolioName={activePortfolio?.name || 'Portfolio'}
            benchmarkSettings={benchmarkSettings}
            onBenchmarkSettingsChange={handleBenchmarkSettingsChange}
            benchmarkDataMap={benchmarkDataMap}
            isBenchmarkLoading={isBenchmarkLoading}
            benchmarkLoadingTickers={benchmarkLoadingTickers}
            onBenchmarkRefresh={handleBenchmarkRefresh}
            onTimeRangeChange={handleTimeRangeChange}
            onNewTransaction={() => setIsTransactionModalOpen(true)}
            assetNotes={activePortfolio?.assetNotes}
          />

          {/* P1.1 NEW: Add TagAnalytics component */}
          <TagAnalytics
            assets={assets}
            displayCurrency={displayCurrency}
            exchangeRates={exchangeRates}
          />

          {/* P1.2 NEW: Add RiskMetrics component */}
          <RiskMetrics
            assets={assets}
            displayCurrency={displayCurrency}
            exchangeRates={exchangeRates}
            historicalRates={historicalRates}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assets.map(asset => (
              <AssetCard
                key={asset.id}
                asset={asset}
                totalPortfolioValue={summary.totalValue}
                onRemoveTransaction={handleRemoveTransaction}
                onEditTransaction={handleEditTransaction}
                onRefresh={handleRefreshAsset}
                onRemove={() => handleRemoveAsset(asset.id)}
                onUpdate={handleUpdateAsset}
                onRetryHistory={() => {}}
                onSell={(asset) => setSellModalAsset(asset)}
                onQuickTransaction={handleQuickTransaction}
                closedPositions={activePortfolio?.closedPositions || []}
                note={getNote(asset.ticker)}
                onNoteClick={(asset) => setNoteModalAsset(asset)}
              />
            ))}
          </div>

          {/* P2: Closed Positions Panel - placed at bottom after open positions */}
          <div className="mt-4">
            <ClosedPositionsPanel
              closedPositions={activePortfolio?.closedPositions || []}
              displayCurrency={displayCurrency}
            />
          </div>
        </main>
      )}

      <ApiKeySettings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <PortfolioManager
        isOpen={isPortfolioManagerOpen}
        onClose={() => setIsPortfolioManagerOpen(false)}
        portfolios={portfolios}
        activePortfolioId={activePortfolioId}
        onSelectPortfolio={setActivePortfolioId}
        onCreatePortfolio={handleCreatePortfolio}
        onRenamePortfolio={handleRenamePortfolio}
        onDeletePortfolio={handleDeletePortfolio}
      />

      {/* P2: Sell Modal - Now routes through unified buy transaction logic */}
      {sellModalAsset && (
        <SellModal
          asset={sellModalAsset}
          onSell={async (qty, priceOrQtyReceived, date, proceedsCurrency, tag, isCryptoToCrypto) => {
            // Transform SELL into BUY: "Sell X of A for B" = "Buy B with X of A"
            // sourceTicker = asset being sold
            // sourceQuantity = quantity being sold
            // destinationTicker = proceeds currency (what we're receiving)
            // destinationQuantity = how much we receive

            let destinationQuantity: number;

            if (isCryptoToCrypto) {
              // For crypto-to-crypto, priceOrQtyReceived IS the quantity received
              destinationQuantity = priceOrQtyReceived;
            } else {
              // For stablecoin/fiat, priceOrQtyReceived is price per unit
              // Total proceeds = qty * price, and for fiat/stablecoins, proceeds = quantity
              destinationQuantity = qty * priceOrQtyReceived;
            }

            // Route through unified buy transaction logic
            await handleBuyWithValidation(
              sellModalAsset.ticker,  // sourceTicker (what we're spending)
              qty,                     // sourceQuantity (how much we're spending)
              proceedsCurrency,        // destinationTicker (what we're receiving)
              destinationQuantity,     // destinationQuantity (how much we receive)
              date,
              tag
            );

            // Close modal on success
            setSellModalAsset(null);
          }}
          onClose={() => setSellModalAsset(null)}
          displayCurrency={displayCurrency}
          exchangeRates={exchangeRates}
        />
      )}

      {/* P3: Transaction Modal */}
      {isTransactionModalOpen && (
        <TransactionModal
          onClose={() => {
            setIsTransactionModalOpen(false);
            setQuickTransactionAsset(undefined);
            setQuickTransactionType(undefined);
          }}
          onDeposit={handleDeposit}
          onBuy={handleBuyWithValidation}
          onSell={handleBuyWithValidation}  // Unified: sell now routes through buy logic
          onWithdraw={handleWithdrawal}
          onTransfer={handlePortfolioTransfer}
          onIncome={handleIncome}
          assets={assets}
          portfolios={portfolios}
          currentPortfolioId={activePortfolioId}
          displayCurrency={displayCurrency}
          exchangeRates={exchangeRates}
          initialTab={quickTransactionType}
          initialAssetTicker={quickTransactionAsset}
        />
      )}

      {/* Asset Notes Modal */}
      <NoteModal
        isOpen={noteModalAsset !== null}
        assetSymbol={noteModalAsset?.ticker || ''}
        assetName={noteModalAsset?.name || noteModalAsset?.ticker || ''}
        portfolioName={activePortfolio?.name || 'Portfolio'}
        existingNote={noteModalAsset ? getNote(noteModalAsset.ticker) : undefined}
        onSave={(noteText) => {
          if (!noteModalAsset) return { success: false, error: 'No asset selected' };
          return saveNote(noteModalAsset.ticker, noteText);
        }}
        onDelete={() => {
          if (noteModalAsset) {
            deleteNote(noteModalAsset.ticker);
          }
        }}
        onClose={() => setNoteModalAsset(null)}
      />

    </div>
  );
};

export default App;