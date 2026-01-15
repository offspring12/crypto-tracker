import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Asset, Portfolio, PortfolioSummary, Transaction, HistorySnapshot, TransactionTag, Currency } from './types';
import { fetchCryptoPrice, fetchAssetHistory, delay } from './services/geminiService';
import { fetchExchangeRates, fetchHistoricalExchangeRatesForDate, fetchHistoricalExchangeRates, convertCurrencySync } from './services/currencyService'; // P1.1B CHANGE: Added fetchHistoricalExchangeRatesForDate
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
import { calculateRealizedPnL, createOrUpdateCashPosition, detectAssetNativeCurrency, getHistoricalPrice, isCashAsset } from './services/portfolioService';
import { validateBuyTransaction, validateSellTransaction, validateWithdrawal, validateTransactionDeletion, getBalanceAtDate } from './services/cashFlowValidation'; // P3: Cash Flow Validation
import { Wallet, Download, Upload, Settings, Key, FolderOpen, Plus, Check } from 'lucide-react';
import { testPhase1 } from './services/riskMetricsService'; // P1.2 TEST IMPORT

// Portfolio colors for visual distinction
const PORTFOLIO_COLORS = [
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#f43f5e', // Rose
  '#14b8a6', // Teal
];

// Migration: Convert old structure to new portfolio structure
const migrateToPortfolios = (): Portfolio[] => {
  const oldAssets = localStorage.getItem('portfolio_assets');
  const oldHistory = localStorage.getItem('portfolio_history');
  
  if (!oldAssets && !oldHistory) {
    // No old data, return default empty portfolio
    return [{
      id: Math.random().toString(36).substr(2, 9),
      name: 'Main Portfolio',
      color: PORTFOLIO_COLORS[0],
      assets: [],
      closedPositions: [], // P2: Trading Lifecycle
      history: [],
      settings: {},
      createdAt: new Date().toISOString()
    }];
  }
  
  // Migrate old data to new structure
  const assets: Asset[] = oldAssets ? JSON.parse(oldAssets) : [];
  const history: HistorySnapshot[] = oldHistory ? JSON.parse(oldHistory) : [];
  
  const migratedPortfolio: Portfolio = {
    id: Math.random().toString(36).substr(2, 9),
    name: 'Main Portfolio',
    color: PORTFOLIO_COLORS[0],
    assets,
    closedPositions: [], // P2: Trading Lifecycle
    history,
    settings: {},
    createdAt: new Date().toISOString()
  };
  
  // Clean up old keys
  localStorage.removeItem('portfolio_assets');
  localStorage.removeItem('portfolio_history');
  
  console.log('✅ Migrated old portfolio data to new structure');
  return [migratedPortfolio];
};

// Migrate transactions to include required tags and currency
const migrateTransactionTags = (portfolios: Portfolio[]): Portfolio[] => {
  return portfolios.map(portfolio => ({
    ...portfolio,
    closedPositions: portfolio.closedPositions || [], // P2: Add closedPositions if missing
    assets: portfolio.assets.map(asset => ({
      ...asset,
      assetType: asset.assetType || 'CRYPTO', // Default to CRYPTO
      currency: asset.currency || 'USD', // Default to USD
      transactions: asset.transactions.map(tx => ({
        ...tx,
        tag: tx.tag || 'DCA', // Default untagged transactions to DCA
        createdAt: tx.createdAt || tx.date || new Date().toISOString() // Use transaction date as createdAt if missing
      }))
    }))
  }));
};

const App: React.FC = () => {
  const [portfolios, setPortfolios] = useState<Portfolio[]>(() => {
    const saved = localStorage.getItem('portfolios');
    if (saved) {
      const parsed = JSON.parse(saved);
      return migrateTransactionTags(parsed); // Migrate old data
    }
    // Migration or first load
    return migrateToPortfolios();
  });

  const [activePortfolioId, setActivePortfolioId] = useState<string>(() => {
    const saved = localStorage.getItem('active_portfolio_id');
    return saved || portfolios[0]?.id || '';
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPortfolioManagerOpen, setIsPortfolioManagerOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [sellModalAsset, setSellModalAsset] = useState<Asset | null>(null); // P2: Sell modal state
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false); // P3: Transaction modal state
  const fileInputRef = useRef<HTMLInputElement>(null);

  // P1.1 CHANGE: Lift displayCurrency and exchangeRates to App level
  const [displayCurrency, setDisplayCurrency] = useState<Currency>('USD');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});

  // P1.2 NEW: Historical exchange rates for risk metrics
  const [historicalRates, setHistoricalRates] = useState<Record<string, Record<string, number>>>({});

  // Get active portfolio
  const activePortfolio = portfolios.find(p => p.id === activePortfolioId) || portfolios[0];
  const assets = activePortfolio?.assets || [];
  const history = activePortfolio?.history || [];

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

  // P1.1 CHANGE: Load exchange rates on mount
  useEffect(() => {
    const loadRates = async () => {
      const rates = await fetchExchangeRates();
      setExchangeRates(rates);
      console.log('💱 App: Exchange rates loaded:', rates);
    };
    loadRates();
  }, []);

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

  // Save portfolios to localStorage
  useEffect(() => {
    localStorage.setItem('portfolios', JSON.stringify(portfolios));
  }, [portfolios]);

  // Save active portfolio ID
  useEffect(() => {
    localStorage.setItem('active_portfolio_id', activePortfolioId);
  }, [activePortfolioId]);

  const updateActivePortfolio = (updater: (portfolio: Portfolio) => Portfolio) => {
    setPortfolios(prev => prev.map(p => 
      p.id === activePortfolioId ? updater(p) : p
    ));
  };

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

  const handleUpdateAsset = (id: string, updates: Partial<Asset>) => {
    updateActivePortfolio(portfolio => ({
      ...portfolio,
      assets: portfolio.assets.map(a => a.id === id ? { ...a, ...updates } : a)
    }));
  };

  const handleRefreshAsset = async (id: string) => {
    const asset = assets.find(a => a.id === id);
    if (!asset) return;
    
    updateActivePortfolio(portfolio => ({
      ...portfolio,
      assets: portfolio.assets.map(a => a.id === id ? { ...a, isUpdating: true } : a)
    }));
    
    try {
      const result = await fetchCryptoPrice(asset.ticker);
      updateActivePortfolio(portfolio => ({
        ...portfolio,
        assets: portfolio.assets.map(a => a.id === id ? { 
          ...a, 
          currentPrice: result.price, 
          sources: result.sources, 
          lastUpdated: new Date().toISOString(),
          isUpdating: false,
          error: undefined,
          name: result.name || result.symbol || a.name,
          currency: result.currency || 'USD' // ✅ Store currency from API
        } : a)
      }));
    } catch (error: any) {
      updateActivePortfolio(portfolio => ({
        ...portfolio,
        assets: portfolio.assets.map(a => a.id === id ? { ...a, isUpdating: false, error: error.message || 'Failed' } : a)
      }));
    }
  };

  // P1.1B CHANGE: Updated handleAddAsset to fetch and store historical FX rates
  const handleAddAsset = async (ticker: string, quantity: number, pricePerCoin: number, date: string, currency: Currency = 'USD', tag?: string) => {
    const totalCost = quantity * pricePerCoin;

    // P1.2 FIX: Parse date in local timezone to avoid timezone conversion issues
    // Input date format: "YYYY-MM-DD" (e.g., "2025-01-05")
    // Problem: new Date("2025-01-05") creates UTC midnight, which becomes previous day in UTC+ timezones
    // Solution: Parse components and create local midnight explicitly
    const [year, month, day] = date.split('-').map(Number);
    const localDate = new Date(year, month - 1, day); // month is 0-indexed in JavaScript Date

    // P1.1B NEW: Fetch historical FX rates for the purchase date
    let historicalRates: Record<Currency, number> | undefined;
    try {
      console.log(`💱 Fetching historical FX rates for purchase date: ${date}`);
      historicalRates = await fetchHistoricalExchangeRatesForDate(localDate);
      console.log(`✅ Historical FX rates fetched for ${date}:`, historicalRates);
    } catch (error) {
      console.warn(`⚠️ Failed to fetch historical FX rates for ${date}, transaction will proceed without them:`, error);
    }

    const newTx: Transaction = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'BUY',
      quantity,
      pricePerCoin,
      date,
      totalCost,
      tag: tag || 'DCA', // Use provided tag or default to DCA
      createdAt: new Date().toISOString(),
      purchaseCurrency: currency, // P1.1B NEW: Store purchase currency
      exchangeRateAtPurchase: historicalRates // P1.1B NEW: Store FX rates at purchase time
    };
    const existingAsset = assets.find(a => a.ticker === ticker);
    
    if (existingAsset) {
      const updatedTransactions = [...existingAsset.transactions, newTx];
      const newTotalQty = existingAsset.quantity + quantity;
      const newTotalCostBasis = existingAsset.totalCostBasis + totalCost;
      updateActivePortfolio(portfolio => ({
        ...portfolio,
        assets: portfolio.assets.map(a => a.id === existingAsset.id ? { 
          ...a, 
          quantity: newTotalQty, 
          transactions: updatedTransactions, 
          totalCostBasis: newTotalCostBasis, 
          avgBuyPrice: newTotalCostBasis / newTotalQty 
        } : a)
      }));
    } else {
      const newId = Math.random().toString(36).substr(2, 9);
      
      const tempAsset: Asset = { 
        id: newId, 
        ticker, 
        name: undefined,
        quantity, 
        currentPrice: 0, 
        lastUpdated: new Date().toISOString(), 
        sources: [], 
        isUpdating: true, 
        transactions: [newTx], 
        avgBuyPrice: pricePerCoin, 
        totalCostBasis: totalCost,
        assetType: undefined, // Will be auto-detected by API
        currency: currency // Store the currency
      };
      
      updateActivePortfolio(portfolio => ({
        ...portfolio,
        assets: [...portfolio.assets, tempAsset]
      }));
      
      try {
        const result = await fetchCryptoPrice(ticker);
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: portfolio.assets.map(a => a.id === newId ? { 
            ...a, 
            currentPrice: result.price, 
            sources: result.sources, 
            isUpdating: false,
            name: result.name || result.symbol || a.name,
            assetType: result.assetType || 'CRYPTO', // Auto-detect from API
            currency: result.currency || 'USD' // ✅ Store currency from API
          } : a)
        }));
        
        const historyData = await fetchAssetHistory(ticker, result.price, result.symbol, result.assetType);
        if (historyData) {
          updateActivePortfolio(portfolio => ({
            ...portfolio,
            assets: portfolio.assets.map(a => a.id === newId ? { ...a, priceHistory: historyData } : a)
          }));
        }
      } catch (error: any) {
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: portfolio.assets.map(a => a.id === newId ? { ...a, isUpdating: false, error: error.message || 'Failed' } : a)
        }));
      }
    }
  };

  // P2 HELPER: Recursively find all assets in the transaction chain
  const findTransactionChain = (ticker: string, visited = new Set<string>()): Array<{ ticker: string; soldFor: string; asset: Asset; tx: Transaction }> => {
    if (visited.has(ticker)) return []; // Prevent infinite loops
    visited.add(ticker);

    const chain: Array<{ ticker: string; soldFor: string; asset: Asset; tx: Transaction }> = [];

    // Find all SELL transactions FROM this ticker
    assets.forEach(asset => {
      const assetTicker = asset.ticker.toUpperCase().split(' ')[0];
      if (assetTicker === ticker.toUpperCase()) {
        const sellTxs = asset.transactions.filter(tx => tx.type === 'SELL');
        sellTxs.forEach(tx => {
          if (tx.proceedsCurrency) {
            const proceedsTicker = tx.proceedsCurrency.toUpperCase().split(' ')[0];
            chain.push({ ticker: asset.ticker, soldFor: tx.proceedsCurrency, asset, tx });

            // Recursively find subsequent sales
            const subChain = findTransactionChain(proceedsTicker, visited);
            chain.push(...subChain);
          }
        });
      }
    });

    return chain;
  };

  // P2: Handle deleting an entire asset (check if it's proceeds from a sell)
  const handleRemoveAsset = (assetId: string) => {
    const assetToDelete = assets.find(a => a.id === assetId);
    if (!assetToDelete) return;

    console.log('🗑️ Attempting to delete asset:', assetToDelete.ticker, 'ID:', assetId);

    // P2: Check if this asset is proceeds from a sell transaction
    // Look for SELL transactions in other assets where proceedsCurrency matches this asset's ticker
    const sellTransactionsForThisAsset: Array<{ asset: Asset; tx: Transaction }> = [];

    assets.forEach(asset => {
      asset.transactions.forEach(tx => {
        if (tx.type === 'SELL' && tx.proceedsCurrency) {
          console.log('  Found SELL tx:', tx.proceedsCurrency, 'vs', assetToDelete.ticker);
          // Match by ticker (handle cases like "USDT" vs "USDT (STABLECOIN)")
          const proceedsTicker = tx.proceedsCurrency.toUpperCase().split(' ')[0]; // Get first part
          const assetTicker = assetToDelete.ticker.toUpperCase().split(' ')[0];

          if (proceedsTicker === assetTicker) {
            console.log('  ✅ MATCH! Adding to sellTransactionsForThisAsset');
            sellTransactionsForThisAsset.push({ asset, tx });
          }
        }
      });
    });

    console.log('📊 Found', sellTransactionsForThisAsset.length, 'sell transactions for this asset');

    if (sellTransactionsForThisAsset.length > 0) {
      // This asset came from sell transactions - check if it's been used in subsequent sales
      const sellList = sellTransactionsForThisAsset
        .map(({ asset, tx }) => `  • ${tx.quantity} ${asset.ticker} sold on ${new Date(tx.date).toLocaleDateString()}`)
        .join('\n');

      // P2 FIX: Check for FULL transaction chain (e.g., BTC→ETH→SOL)
      const assetTickerBase = assetToDelete.ticker.toUpperCase().split(' ')[0];
      const fullChain = findTransactionChain(assetTickerBase);

      console.log('🔍 Checking for transaction chain from', assetToDelete.ticker);
      console.log('  Found chain of length:', fullChain.length);
      if (fullChain.length > 0) {
        console.log('  ⚠️ Full chain:', fullChain.map(c => `${c.ticker}→${c.soldFor}`).join(', '));
      }

      if (fullChain.length > 0) {
        // Can't reverse - this position has been used in subsequent sales
        let errorMessage = `❌ Cannot Delete: "${assetToDelete.ticker}" is part of a transaction chain:\n\n`;

        // Build the chain visualization
        const chainVisualization = [assetToDelete.ticker];
        fullChain.forEach(c => {
          chainVisualization.push(c.soldFor);
        });
        errorMessage += `  ${chainVisualization.join(' → ')}\n\n`;

        errorMessage += `Transactions in this chain:\n`;
        fullChain.forEach(c => {
          errorMessage += `  • ${c.tx.quantity} ${c.ticker} sold for ${c.soldFor} on ${new Date(c.tx.date).toLocaleDateString()}\n`;
        });

        errorMessage += `\n⚠️ Deleting this position would corrupt your P&L calculations and transaction history.\n\n`;
        errorMessage += `To delete "${assetToDelete.ticker}", you must first reverse the sales in ORDER:\n`;

        // Show the order of deletions (reverse order)
        for (let i = fullChain.length - 1; i >= 0; i--) {
          const step = fullChain.length - i;
          const proceedsTicker = fullChain[i].soldFor.split(' ')[0];
          errorMessage += `${step}. Delete or reverse the ${fullChain[i].ticker}→${proceedsTicker} sale\n`;
        }
        errorMessage += `${fullChain.length + 1}. Then you can delete "${assetToDelete.ticker}"\n\n`;
        errorMessage += `This ensures your transaction history remains consistent.`;

        alert(errorMessage);
        return;
      }

      // No subsequent sales - safe to reverse
      const confirmed = window.confirm(
        `⚠️ Warning: "${assetToDelete.ticker}" is proceeds from the following sell transaction(s):\n\n` +
        `${sellList}\n\n` +
        `Deleting this position will REVERSE these sales:\n` +
        `- The sell transactions will be deleted\n` +
        `- The sold assets will be restored to your holdings\n` +
        `- Closed positions will be removed\n` +
        `- P&L calculations will be recalculated\n\n` +
        `Do you want to continue and reverse these sales?`
      );

      if (!confirmed) return;

      // Reverse all the sell transactions
      updateActivePortfolio(portfolio => {
        console.log('🔄 Starting reversal process');
        console.log('  Portfolio has', portfolio.assets.length, 'assets');
        console.log('  Deleting asset:', assetId);

        let updatedAssets = portfolio.assets.filter(a => a.id !== assetId);
        console.log('  After filtering, have', updatedAssets.length, 'assets');

        let updatedClosedPositions = [...(portfolio.closedPositions || [])];

        sellTransactionsForThisAsset.forEach(({ asset, tx }) => {
          console.log('  🔄 Reversing SELL transaction:', tx.id, 'from', asset.ticker);
          console.log('     Sold quantity:', tx.quantity, asset.ticker);

          // Check if the asset still exists
          const assetStillExists = updatedAssets.find(a => a.id === asset.id);
          console.log('     Asset still in portfolio?', !!assetStillExists);

          // Remove the SELL transaction
          let filteredTxs = asset.transactions.filter(t => t.id !== tx.id);
          console.log('     Transactions before:', asset.transactions.length, '-> after:', filteredTxs.length);

          // P2: When reversing a SELL, we need to restore both quantity AND cost basis
          // Find the closed positions for this sell to get the original BUY transactions
          const relatedClosedPositions = (portfolio.closedPositions || []).filter(
            cp => cp.sellTransactionId === tx.id
          );

          console.log('     Found', relatedClosedPositions.length, 'closed positions to reverse');

          // Recreate the BUY transactions that were consumed by FIFO
          relatedClosedPositions.forEach(cp => {
            // Check if this BUY transaction was partially consumed or fully consumed
            const existingBuyTx = filteredTxs.find(t => t.id === cp.buyTransactionId);

            if (existingBuyTx) {
              // Partial consumption - add back the consumed quantity
              console.log('       Restoring partial BUY:', cp.entryQuantity, 'to tx', cp.buyTransactionId);
              filteredTxs = filteredTxs.map(t =>
                t.id === cp.buyTransactionId
                  ? {
                      ...t,
                      quantity: t.quantity + cp.entryQuantity,
                      totalCost: t.totalCost + cp.entryCostBasis
                    }
                  : t
              );
            } else {
              // Full consumption - recreate the BUY transaction
              console.log('       Recreating full BUY:', cp.entryQuantity, '@', cp.entryPrice);
              const recreatedBuyTx: Transaction = {
                id: cp.buyTransactionId,
                type: 'BUY',
                quantity: cp.entryQuantity,
                pricePerCoin: cp.entryPrice,
                date: cp.entryDate,
                totalCost: cp.entryCostBasis,
                tag: cp.entryTag || 'DCA',
                createdAt: new Date().toISOString(),
                purchaseCurrency: cp.entryCurrency as Currency,
                exchangeRateAtPurchase: undefined
              };
              filteredTxs.push(recreatedBuyTx);
            }
          });

          // Recalculate from the restored transactions
          const buyTxs = filteredTxs.filter(t => t.type === 'BUY');
          const newQty = buyTxs.reduce((sum, t) => sum + t.quantity, 0);
          const newCost = buyTxs.reduce((sum, t) => sum + t.totalCost, 0);

          console.log('     Restored quantity:', newQty, '(from', buyTxs.length, 'BUY transactions)');
          console.log('     Restored cost basis:', newCost);

          // Update the asset
          const assetFound = updatedAssets.some(a => a.id === asset.id);
          console.log('     Can find asset to update?', assetFound);

          updatedAssets = updatedAssets.map(a =>
            a.id === asset.id
              ? {
                  ...a,
                  transactions: filteredTxs,
                  quantity: newQty,
                  totalCostBasis: newCost,
                  avgBuyPrice: newQty > 0 ? newCost / newQty : 0
                }
              : a
          );

          // Remove closed positions related to this sell transaction
          updatedClosedPositions = updatedClosedPositions.filter(
            cp => cp.sellTransactionId !== tx.id
          );
          console.log('     ✅ Reversal complete for', asset.ticker);
        });

        console.log('🏁 Reversal complete. Final asset count:', updatedAssets.length);

        // P2 FIX: Clean up orphaned closed positions from the deleted asset
        // If the deleted asset was sold (e.g., ETH→SOL), remove those closed positions too
        const deletedAssetTicker = assetToDelete.ticker.toUpperCase().split(' ')[0];
        const orphanedClosedPositions = updatedClosedPositions.filter(cp => {
          const cpTicker = cp.ticker.toUpperCase().split(' ')[0];
          return cpTicker === deletedAssetTicker;
        });

        if (orphanedClosedPositions.length > 0) {
          console.log('🧹 Cleaning up', orphanedClosedPositions.length, 'orphaned closed positions for', deletedAssetTicker);
          updatedClosedPositions = updatedClosedPositions.filter(cp => {
            const cpTicker = cp.ticker.toUpperCase().split(' ')[0];
            return cpTicker !== deletedAssetTicker;
          });
        }

        // Log the final state we're about to return
        updatedAssets.forEach(a => {
          console.log(`  📦 Final state for ${a.ticker}: quantity=${a.quantity}, transactions=${a.transactions.length}`);
        });

        const finalPortfolio = {
          ...portfolio,
          assets: updatedAssets,
          closedPositions: updatedClosedPositions
        };

        console.log('📤 Returning updated portfolio with', finalPortfolio.assets.length, 'assets');
        console.log('📤 Closed positions count:', updatedClosedPositions.length);
        return finalPortfolio;
      });

      // Log the state AFTER the update
      console.log('🔍 After updateActivePortfolio call, checking current assets state:');
      setTimeout(() => {
        const currentAssets = portfolios.find(p => p.id === activePortfolioId)?.assets || [];
        console.log('  Current portfolio has', currentAssets.length, 'assets');
        currentAssets.forEach(a => {
          console.log(`  ${a.ticker}: quantity=${a.quantity}, transactions=${a.transactions.length}`);
        });
      }, 100);
    } else {
      // Normal asset deletion - just confirm
      const confirmed = window.confirm(
        `Are you sure you want to delete ${assetToDelete.ticker}?\n\n` +
        `This will remove all ${assetToDelete.quantity.toLocaleString()} units and transaction history.`
      );

      if (!confirmed) return;

      updateActivePortfolio(portfolio => ({
        ...portfolio,
        assets: portfolio.assets.filter(a => a.id !== assetId)
      }));
    }
  };

  const handleRemoveTransaction = (assetId: string, txId: string) => {
    // P3: Validate transaction deletion for cash flow integrity
    const asset = assets.find(a => a.id === assetId);
    if (!asset) return;

    const txToDelete = asset.transactions.find(tx => tx.id === txId);
    if (!txToDelete) return;

    // P3: Check if this is a transferred transaction (copied from another portfolio)
    if (txToDelete.transferredFrom) {
      const sourcePortfolio = portfolios.find(p => p.id === txToDelete.transferredFrom);
      const sourcePortfolioName = sourcePortfolio ? sourcePortfolio.name : 'the source portfolio';

      alert(
        `⚠️ Cannot Delete Transferred Transaction\n\n` +
        `This transaction was transferred from "${sourcePortfolioName}".\n\n` +
        `To delete it, go to "${sourcePortfolioName}" and delete the TRANSFER transaction there.\n\n` +
        `Deleting the TRANSFER in the source portfolio will automatically remove this copied transaction.`
      );
      return;
    }

    // P3: Check if deleting this transaction would break cash flow logic
    const validation = validateTransactionDeletion(asset, txId);
    if (!validation.valid) {
      alert(`⚠️ Cannot Delete Transaction\n\n${validation.error}`);
      return;
    }

    // P3: Handle WITHDRAWAL transaction deletion
    if (txToDelete.type === 'WITHDRAWAL') {
      const confirmed = window.confirm(
        `⚠️ Delete Withdrawal Transaction?\n\n` +
        `This will increase your position by ${txToDelete.quantity.toLocaleString()} ${asset.ticker}.\n\n` +
        `Destination: ${txToDelete.withdrawalDestination}\n` +
        `Date: ${new Date(txToDelete.date).toLocaleDateString()}\n\n` +
        `Do you want to continue?`
      );

      if (!confirmed) return;

      updateActivePortfolio(portfolio => {
        const assetToUpdate = portfolio.assets.find(a => a.id === assetId);
        if (!assetToUpdate) return portfolio;

        // Simply remove the WITHDRAWAL transaction
        // The quantity/cost will be recalculated from remaining acquisition transactions
        const updatedTxs = assetToUpdate.transactions.filter(tx => tx.id !== txId);

        // Recalculate quantity and cost basis from acquisition transactions
        const acquisitionTxs = updatedTxs.filter(tx =>
          tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
        );
        const newQty = acquisitionTxs.reduce((sum, tx) => sum + tx.quantity, 0);
        const newCost = acquisitionTxs.reduce((sum, tx) => sum + tx.totalCost, 0);

        if (newQty === 0) {
          // If no acquisitions left, remove the asset entirely
          return {
            ...portfolio,
            assets: portfolio.assets.filter(a => a.id !== assetId)
          };
        }

        return {
          ...portfolio,
          assets: portfolio.assets.map(a =>
            a.id === assetId
              ? {
                  ...a,
                  transactions: updatedTxs,
                  quantity: newQty,
                  totalCostBasis: newCost,
                  avgBuyPrice: newQty > 0 ? newCost / newQty : 0
                }
              : a
          )
        };
      });

      return;
    }

    // P3: Handle TRANSFER transaction deletion (Immutable Architecture)
    if (txToDelete.type === 'TRANSFER') {
      const destinationPortfolioId = txToDelete.destinationPortfolioId;
      if (!destinationPortfolioId) {
        alert('❌ Cannot delete this TRANSFER transaction: Missing destination portfolio information.');
        return;
      }

      const destinationPortfolio = portfolios.find(p => p.id === destinationPortfolioId);
      if (!destinationPortfolio) {
        alert(
          `❌ Cannot delete this TRANSFER transaction.\n\n` +
          `The destination portfolio no longer exists.\n\n` +
          `This transfer cannot be reversed.`
        );
        return;
      }

      // Check if the asset still exists in destination portfolio with sufficient quantity
      const destinationAsset = destinationPortfolio.assets.find(a => a.ticker === asset.ticker);

      if (!destinationAsset) {
        alert(
          `❌ Cannot delete this TRANSFER transaction.\n\n` +
          `${asset.ticker} no longer exists in "${destinationPortfolio.name}".\n\n` +
          `The asset may have been sold or withdrawn. Please resolve the transaction chain first.`
        );
        return;
      }

      // P3: Chronological validation using getBalanceAtDate
      const availableBalanceInDest = getBalanceAtDate(destinationAsset, new Date().toISOString());

      if (availableBalanceInDest < txToDelete.quantity) {
        alert(
          `❌ Cannot delete this TRANSFER transaction.\n\n` +
          `Insufficient quantity in "${destinationPortfolio.name}":\n` +
          `  Required: ${txToDelete.quantity.toLocaleString()} ${asset.ticker}\n` +
          `  Available: ${availableBalanceInDest.toLocaleString()} ${asset.ticker}\n\n` +
          `Some of the transferred assets may have been sold or withdrawn.\n` +
          `Please resolve those transactions first.`
        );
        return;
      }

      // All validations passed - show confirmation
      const confirmed = window.confirm(
        `⚠️ Delete Transfer Transaction?\n\n` +
        `This will:\n` +
        `  • Restore ${txToDelete.quantity.toLocaleString()} ${asset.ticker} to this portfolio\n` +
        `  • Remove ${txToDelete.quantity.toLocaleString()} ${asset.ticker} from "${destinationPortfolio.name}"\n\n` +
        `Date: ${new Date(txToDelete.date).toLocaleDateString()}\n` +
        `Cost Basis: ${txToDelete.totalCost.toLocaleString()} ${activePortfolio.settings?.displayCurrency || 'USD'}\n\n` +
        `Do you want to continue?`
      );

      if (!confirmed) return;

      // P3 FIX: Simply remove TRANSFER transaction from source and recalculate
      // No need to add restoration transaction - removing TRANSFER increases position automatically
      updateActivePortfolio(sourcePortfolio => {
        const assetToUpdate = sourcePortfolio.assets.find(a => a.id === assetId);
        if (!assetToUpdate) {
          // Asset doesn't exist in source - need to recreate it with restored transactions
          // This happens when the transfer was for the full amount

          // Calculate which acquisition transactions to restore using FIFO
          const sortedDestAcquisitions = [...destinationAsset.transactions]
            .filter(tx => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

          let remainingToRestore = txToDelete.quantity;
          const restoredTxs: Transaction[] = [];

          for (const tx of sortedDestAcquisitions) {
            if (remainingToRestore <= 0) break;

            const qtyFromThisTx = Math.min(remainingToRestore, tx.quantity);
            const costFromThisTx = (qtyFromThisTx / tx.quantity) * tx.totalCost;

            restoredTxs.push({
              ...tx,
              id: Math.random().toString(36).substr(2, 9), // New ID for source
              quantity: qtyFromThisTx,
              totalCost: costFromThisTx
            });

            remainingToRestore -= qtyFromThisTx;
          }

          // Recreate the asset in source portfolio
          const restoredAsset: Asset = {
            id: assetId, // Use original asset ID
            ticker: asset.ticker,
            name: asset.name,
            quantity: txToDelete.quantity,
            currentPrice: asset.currentPrice,
            lastUpdated: new Date().toISOString(),
            sources: asset.sources,
            isUpdating: false,
            transactions: restoredTxs,
            avgBuyPrice: txToDelete.totalCost / txToDelete.quantity,
            totalCostBasis: txToDelete.totalCost,
            coinGeckoId: asset.coinGeckoId,
            assetType: asset.assetType,
            currency: asset.currency
          };

          return {
            ...sourcePortfolio,
            assets: [...sourcePortfolio.assets, restoredAsset]
          };
        }

        // Asset exists in source - simply remove TRANSFER transaction
        const updatedTxs = assetToUpdate.transactions.filter(tx => tx.id !== txId);

        // Recalculate position: acquisitions - disposals
        const acquisitions = updatedTxs.filter(tx =>
          tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
        );
        const disposals = updatedTxs.filter(tx =>
          tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
        );

        const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
        const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
        const newQty = totalAcquired - totalDisposed;

        const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
        const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
        const newCost = totalCostAcquired - totalCostDisposed;

        return {
          ...sourcePortfolio,
          assets: sourcePortfolio.assets.map(a =>
            a.id === assetId
              ? {
                  ...a,
                  transactions: updatedTxs,
                  quantity: newQty,
                  totalCostBasis: newCost,
                  avgBuyPrice: newQty > 0 ? newCost / newQty : 0
                }
              : a
          )
        };
      });

      // P3 FIX: Remove the copied acquisition transactions from destination portfolio
      // Find and remove transactions that match the transfer date and amount
      setPortfolios(prevPortfolios =>
        prevPortfolios.map(p => {
          if (p.id !== destinationPortfolioId) return p;

          const destAsset = p.assets.find(a => a.ticker === asset.ticker);
          if (!destAsset) return p;

          // P3: Remove transactions that were added during the transfer
          // Prioritize transactions marked with transferredFrom matching current portfolio
          const sortedAcquisitions = [...destAsset.transactions]
            .filter(tx => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
            .sort((a, b) => {
              // Sort by transferredFrom marker first (matching active portfolio ID comes first)
              const aIsTransferred = a.transferredFrom === activePortfolio.id ? 0 : 1;
              const bIsTransferred = b.transferredFrom === activePortfolio.id ? 0 : 1;
              if (aIsTransferred !== bIsTransferred) return aIsTransferred - bIsTransferred;
              // Then sort by date (FIFO)
              return new Date(a.date).getTime() - new Date(b.date).getTime();
            });

          let remainingToRemove = txToDelete.quantity;
          const txsToKeep: Transaction[] = [];

          // Use FIFO to identify which transactions to remove (prioritizing marked ones)
          for (const tx of sortedAcquisitions) {
            if (remainingToRemove <= 0) {
              txsToKeep.push(tx);
              continue;
            }

            if (tx.quantity <= remainingToRemove) {
              // Fully consume this transaction
              remainingToRemove -= tx.quantity;
              // Don't add to txsToKeep (remove it)
            } else {
              // Partial consumption - split the transaction
              const qtyToRemove = remainingToRemove;
              const costToRemove = (qtyToRemove / tx.quantity) * tx.totalCost;

              txsToKeep.push({
                ...tx,
                quantity: tx.quantity - qtyToRemove,
                totalCost: tx.totalCost - costToRemove
              });

              remainingToRemove = 0;
            }
          }

          // Keep all non-acquisition transactions
          const nonAcquisitions = destAsset.transactions.filter(tx =>
            tx.type !== 'BUY' && tx.type !== 'DEPOSIT' && tx.type !== 'INCOME'
          );

          const finalTxs = [...txsToKeep, ...nonAcquisitions];

          // Recalculate destination position
          const destAcquisitions = finalTxs.filter(tx =>
            tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
          );
          const destDisposals = finalTxs.filter(tx =>
            tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
          );

          const destTotalAcquired = destAcquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
          const destTotalDisposed = destDisposals.reduce((sum, tx) => sum + tx.quantity, 0);
          const newDestQty = destTotalAcquired - destTotalDisposed;

          const destTotalCostAcquired = destAcquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
          const destTotalCostDisposed = destDisposals.reduce((sum, tx) => sum + tx.totalCost, 0);
          const newDestCost = destTotalCostAcquired - destTotalCostDisposed;

          if (newDestQty === 0) {
            // Remove asset from destination portfolio
            return {
              ...p,
              assets: p.assets.filter(a => a.id !== destAsset.id)
            };
          } else {
            // Update asset in destination portfolio
            return {
              ...p,
              assets: p.assets.map(a =>
                a.id === destAsset.id
                  ? {
                      ...a,
                      transactions: finalTxs,
                      quantity: newDestQty,
                      totalCostBasis: newDestCost,
                      avgBuyPrice: newDestQty > 0 ? newDestCost / newDestQty : 0
                    }
                  : a
              )
            };
          }
        })
      );

      return;
    }

    // P3: Handle BUY transaction deletion with reversal logic
    if (txToDelete.type === 'BUY') {
      // P4: Check if this BUY transaction has a linked SELL transaction
      if (txToDelete.linkedBuySellTransactionId) {
        // Find the linked SELL transaction across all assets
        const linkedTxData = assets
          .flatMap(a => a.transactions.map(tx => ({ asset: a, tx })))
          .find(({ tx }) => tx.id === txToDelete.linkedBuySellTransactionId);

        if (!linkedTxData) {
          // Linked transaction not found - possibly old transaction before linking was implemented
          const confirmed = window.confirm(
            `⚠️ Warning: Cannot find the linked source transaction.\n\n` +
            `This BUY transaction was created before transaction linking was implemented, or the source transaction has been deleted.\n\n` +
            `Deleting it will NOT restore the source asset.\n\n` +
            `Do you want to continue?`
          );
          if (!confirmed) return;
          // Proceed with simple deletion (handled at end of function)
        } else {
          // Found linked SELL transaction - show comprehensive warning
          const sourceTicker = linkedTxData.asset.ticker;
          const sourceQuantity = txToDelete.sourceQuantity || 0;

          const confirmed = window.confirm(
            `⚠️ Delete Buy Transaction?\n\n` +
            `This will delete BOTH transactions:\n` +
            `  • BUY: ${txToDelete.quantity.toLocaleString()} ${asset.ticker}\n` +
            `  • SELL: ${sourceQuantity.toLocaleString()} ${sourceTicker}\n\n` +
            `The ${sourceTicker} will be restored to your portfolio.\n\n` +
            `Date: ${new Date(txToDelete.date).toLocaleDateString()}\n\n` +
            `Do you want to continue?`
          );

          if (!confirmed) return;

          // Delete both transactions atomically
          updateActivePortfolio(portfolio => {
            let updatedAssets = [...portfolio.assets];
            let updatedClosedPositions = [...(portfolio.closedPositions || [])];

            // Remove closed positions created by the linked SELL transaction
            const linkedSellTxId = txToDelete.linkedBuySellTransactionId;
            const closedPositionsToRemove = updatedClosedPositions.filter(
              cp => cp.sellTransactionId === linkedSellTxId
            );

            if (closedPositionsToRemove.length > 0) {
              console.log(`🧹 Removing ${closedPositionsToRemove.length} closed positions from reversed BUY/SELL pair`);
              updatedClosedPositions = updatedClosedPositions.filter(
                cp => cp.sellTransactionId !== linkedSellTxId
              );
            }

            // 1. Remove BUY transaction from destination asset
            updatedAssets = updatedAssets.map(a => {
              if (a.id !== assetId) return a;
              const updatedTxs = a.transactions.filter(tx => tx.id !== txId);

              // Recalculate position
              const acquisitions = updatedTxs.filter(tx =>
                tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
              );
              const disposals = updatedTxs.filter(tx =>
                tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
              );

              const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
              const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
              const newQty = totalAcquired - totalDisposed;

              const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
              const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
              const newCost = totalCostAcquired - totalCostDisposed;

              if (newQty === 0 && updatedTxs.length === 0) {
                return null; // Remove asset if no transactions remain
              }

              return {
                ...a,
                transactions: updatedTxs,
                quantity: newQty,
                totalCostBasis: newCost,
                avgBuyPrice: newQty > 0 ? newCost / newQty : 0
              };
            }).filter(a => a !== null) as Asset[];

            // 2. Remove SELL transaction from source asset (this automatically restores the quantity)
            updatedAssets = updatedAssets.map(a => {
              if (a.id !== linkedTxData.asset.id) return a;
              const updatedTxs = a.transactions.filter(tx => tx.id !== txToDelete.linkedBuySellTransactionId);

              // Recalculate position
              const acquisitions = updatedTxs.filter(tx =>
                tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
              );
              const disposals = updatedTxs.filter(tx =>
                tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
              );

              const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
              const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
              const newQty = totalAcquired - totalDisposed;

              const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
              const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
              const newCost = totalCostAcquired - totalCostDisposed;

              return {
                ...a,
                transactions: updatedTxs,
                quantity: newQty,
                totalCostBasis: newCost,
                avgBuyPrice: newQty > 0 ? newCost / newQty : 0
              };
            });

            return {
              ...portfolio,
              assets: updatedAssets,
              closedPositions: updatedClosedPositions
            };
          });

          return;
        }
      }

      // Fallback for old BUY transactions without linking OR if linked transaction not found
      // Check if this BUY transaction has source information (what was paid with)
      if (txToDelete.sourceTicker && txToDelete.sourceQuantity) {
        // This is a BUY transaction where user paid with another asset
        // We need to restore the source asset (reverse the payment)
        const sourceTicker = txToDelete.sourceTicker.toUpperCase();
        const sourceQuantity = txToDelete.sourceQuantity;
        const sourceValue = txToDelete.totalCost; // The cost basis of what was purchased

        const confirmed = window.confirm(
          `⚠️ Delete Buy Transaction?\n\n` +
          `This will:\n` +
          `  • Remove ${txToDelete.quantity.toLocaleString()} ${asset.ticker}\n` +
          `  • Restore ${sourceQuantity.toLocaleString()} ${sourceTicker}\n\n` +
          `Date: ${new Date(txToDelete.date).toLocaleDateString()}\n` +
          `Cost: ${sourceValue.toLocaleString()} ${displayCurrency}\n\n` +
          `Do you want to continue?`
        );

        if (!confirmed) return;

        updateActivePortfolio(portfolio => {
          // 1. Remove the BUY transaction from the destination asset
          let updatedAssets = portfolio.assets.map(assetItem => {
            if (assetItem.id !== assetId) return assetItem;
            const updatedTxs = assetItem.transactions.filter(tx => tx.id !== txId);

            // Recalculate position
            const acquisitions = updatedTxs.filter(tx =>
              tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
            );
            const disposals = updatedTxs.filter(tx =>
              tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
            );

            const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
            const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
            const newQty = totalAcquired - totalDisposed;

            const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
            const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
            const newCost = totalCostAcquired - totalCostDisposed;

            if (newQty === 0 && updatedTxs.length === 0) {
              // Remove asset if no transactions remain
              return null;
            }

            return {
              ...assetItem,
              transactions: updatedTxs,
              quantity: newQty,
              totalCostBasis: newCost,
              avgBuyPrice: newQty > 0 ? newCost / newQty : 0
            };
          }).filter(a => a !== null) as Asset[];

          // 2. Restore the source asset (add back what was paid)
          const sourceAsset = updatedAssets.find(a => a.ticker.toUpperCase() === sourceTicker);

          if (sourceAsset) {
            // Source asset exists - add back the quantity
            updatedAssets = updatedAssets.map(a => {
              if (a.ticker.toUpperCase() !== sourceTicker) return a;

              // Create a restoration transaction
              const restorationTx: Transaction = {
                id: Math.random().toString(36).substr(2, 9),
                type: 'DEPOSIT',
                quantity: sourceQuantity,
                pricePerCoin: sourceValue / sourceQuantity,
                date: txToDelete.date,
                totalCost: sourceValue,
                tag: txToDelete.tag || 'DCA',
                createdAt: new Date().toISOString(),
                depositSource: `Restored from deleted BUY of ${asset.ticker}`
              };

              const updatedTxs = [...a.transactions, restorationTx];

              // Recalculate
              const acquisitions = updatedTxs.filter(tx =>
                tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
              );
              const disposals = updatedTxs.filter(tx =>
                tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
              );

              const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
              const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
              const newQty = totalAcquired - totalDisposed;

              const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
              const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
              const newCost = totalCostAcquired - totalCostDisposed;

              return {
                ...a,
                transactions: updatedTxs,
                quantity: newQty,
                totalCostBasis: newCost,
                avgBuyPrice: newQty > 0 ? newCost / newQty : 0,
                lastUpdated: new Date().toISOString()
              };
            });
          } else {
            // Source asset doesn't exist - recreate it
            const newSourceAsset: Asset = {
              id: Math.random().toString(36).substr(2, 9),
              ticker: sourceTicker,
              name: sourceTicker,
              quantity: sourceQuantity,
              currentPrice: sourceValue / sourceQuantity,
              lastUpdated: new Date().toISOString(),
              sources: [],
              isUpdating: false,
              transactions: [{
                id: Math.random().toString(36).substr(2, 9),
                type: 'DEPOSIT',
                quantity: sourceQuantity,
                pricePerCoin: sourceValue / sourceQuantity,
                date: txToDelete.date,
                totalCost: sourceValue,
                tag: txToDelete.tag || 'DCA',
                createdAt: new Date().toISOString(),
                depositSource: `Restored from deleted BUY of ${asset.ticker}`
              }],
              avgBuyPrice: sourceValue / sourceQuantity,
              totalCostBasis: sourceValue,
              assetType: 'CASH',
              currency: sourceTicker as Currency
            };

            updatedAssets = [...updatedAssets, newSourceAsset];
          }

          return {
            ...portfolio,
            assets: updatedAssets
          };
        });

        return;
      }

      // BUY transaction without source info - check if it's proceeds from a SELL
      // (handled below in SELL logic)
    }

    // P2: Check if this is a SELL transaction and validate

    // P2: If deleting a SELL transaction, check for proceeds and warn user
    if (txToDelete.type === 'SELL' && txToDelete.proceedsCurrency) {
      // P4: Check if this SELL has a linked BUY transaction (from BUY with another asset)
      if (txToDelete.linkedBuySellTransactionId) {
        // Find the linked BUY transaction
        const linkedBuyTxData = assets
          .flatMap(a => a.transactions.map(tx => ({ asset: a, tx })))
          .find(({ tx }) => tx.id === txToDelete.linkedBuySellTransactionId);

        if (linkedBuyTxData) {
          // Show warning that both will be deleted
          const confirmed = window.confirm(
            `⚠️ Delete Sell Transaction?\n\n` +
            `This SELL is part of a BUY transaction pair.\n\n` +
            `Deleting it will also delete:\n` +
            `  • BUY: ${linkedBuyTxData.tx.quantity.toLocaleString()} ${linkedBuyTxData.asset.ticker}\n\n` +
            `Your ${asset.ticker} position will be restored.\n\n` +
            `Do you want to continue?`
          );

          if (!confirmed) return;

          // Delete both transactions atomically (same logic as BUY deletion)
          updateActivePortfolio(portfolio => {
            let updatedAssets = [...portfolio.assets];
            let updatedClosedPositions = [...(portfolio.closedPositions || [])];

            // Remove closed positions created by this SELL transaction
            const closedPositionsToRemove = updatedClosedPositions.filter(
              cp => cp.sellTransactionId === txId
            );

            if (closedPositionsToRemove.length > 0) {
              console.log(`🧹 Removing ${closedPositionsToRemove.length} closed positions from reversed BUY/SELL pair`);
              updatedClosedPositions = updatedClosedPositions.filter(
                cp => cp.sellTransactionId !== txId
              );
            }

            // 1. Remove SELL transaction from source asset (this restores the quantity)
            updatedAssets = updatedAssets.map(a => {
              if (a.id !== assetId) return a;
              const updatedTxs = a.transactions.filter(tx => tx.id !== txId);

              // Recalculate position
              const acquisitions = updatedTxs.filter(tx =>
                tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
              );
              const disposals = updatedTxs.filter(tx =>
                tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
              );

              const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
              const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
              const newQty = totalAcquired - totalDisposed;

              const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
              const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
              const newCost = totalCostAcquired - totalCostDisposed;

              return {
                ...a,
                transactions: updatedTxs,
                quantity: newQty,
                totalCostBasis: newCost,
                avgBuyPrice: newQty > 0 ? newCost / newQty : 0
              };
            });

            // 2. Remove BUY transaction from destination asset
            updatedAssets = updatedAssets.map(a => {
              if (a.id !== linkedBuyTxData.asset.id) return a;
              const updatedTxs = a.transactions.filter(tx => tx.id !== txToDelete.linkedBuySellTransactionId);

              // Recalculate position
              const acquisitions = updatedTxs.filter(tx =>
                tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
              );
              const disposals = updatedTxs.filter(tx =>
                tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
              );

              const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
              const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
              const newQty = totalAcquired - totalDisposed;

              const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
              const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
              const newCost = totalCostAcquired - totalCostDisposed;

              if (newQty === 0 && updatedTxs.length === 0) {
                return null; // Remove asset if no transactions remain
              }

              return {
                ...a,
                transactions: updatedTxs,
                quantity: newQty,
                totalCostBasis: newCost,
                avgBuyPrice: newQty > 0 ? newCost / newQty : 0
              };
            }).filter(a => a !== null) as Asset[];

            return {
              ...portfolio,
              assets: updatedAssets,
              closedPositions: updatedClosedPositions
            };
          });

          return;
        }
      }

      // Fallback: Old logic for SELL transactions without linking
      // SKIP this block if SELL has linkedBuySellTransactionId (already handled above)
      if (!txToDelete.linkedBuySellTransactionId) {
        const proceedsTicker = txToDelete.proceedsCurrency;
        const proceedsAsset = assets.find(a => a.ticker === proceedsTicker);

        if (proceedsAsset) {
        // P2 FIX: Check for FULL transaction chain before allowing deletion
        const proceedsTickerBase = proceedsAsset.ticker.toUpperCase().split(' ')[0];
        const fullChain = findTransactionChain(proceedsTickerBase);

        console.log('🔍 Checking for transaction chain from proceeds', proceedsAsset.ticker);
        console.log('  Found chain of length:', fullChain.length);

        if (fullChain.length > 0) {
          // Can't reverse - proceeds have been used in subsequent sales
          let errorMessage = `❌ Cannot Delete: The proceeds "${proceedsAsset.ticker}" have been sold in a transaction chain:\n\n`;

          // Build the chain visualization
          const chainVisualization = [asset.ticker, proceedsAsset.ticker];
          fullChain.forEach(c => {
            chainVisualization.push(c.soldFor);
          });
          errorMessage += `  ${chainVisualization.join(' → ')}\n\n`;

          errorMessage += `Transactions in this chain:\n`;
          errorMessage += `  • ${txToDelete.quantity} ${asset.ticker} sold for ${proceedsAsset.ticker} on ${new Date(txToDelete.date).toLocaleDateString()}\n`;
          fullChain.forEach(c => {
            errorMessage += `  • ${c.tx.quantity} ${c.ticker} sold for ${c.soldFor} on ${new Date(c.tx.date).toLocaleDateString()}\n`;
          });

          errorMessage += `\n⚠️ Deleting this SELL transaction would corrupt your P&L calculations.\n\n`;
          errorMessage += `To delete this transaction, you must first reverse the sales in ORDER:\n`;

          // Show the order of deletions (reverse order)
          for (let i = fullChain.length - 1; i >= 0; i--) {
            const step = fullChain.length - i;
            const proceedsTicker2 = fullChain[i].soldFor.split(' ')[0];
            errorMessage += `${step}. Delete or reverse the ${fullChain[i].ticker}→${proceedsTicker2} sale\n`;
          }
          errorMessage += `${fullChain.length + 1}. Then you can delete this ${asset.ticker}→${proceedsAsset.ticker} transaction\n\n`;
          errorMessage += `This ensures your transaction history remains consistent.`;

          alert(errorMessage);
          return;
        }

        // No subsequent sales - show confirmation and proceed
        const confirmed = window.confirm(
          `⚠️ Warning: Deleting this SELL transaction will also remove the proceeds position:\n\n` +
          `${proceedsAsset.ticker}: ${proceedsAsset.quantity.toLocaleString()} units\n\n` +
          `This will affect your portfolio value and P&L calculations.\n\n` +
          `Do you want to continue?`
        );
        if (!confirmed) return;

        // Delete both the transaction and the proceeds asset
        updateActivePortfolio(portfolio => {
          // Remove the proceeds asset
          let updatedAssets = portfolio.assets.filter(a => a.id !== proceedsAsset.id);

          // P2 FIX: Restore the sold asset using closed positions (same logic as handleRemoveAsset)
          const assetToRestore = portfolio.assets.find(a => a.id === assetId);
          if (assetToRestore) {
            // Remove the SELL transaction
            let filteredTxs = assetToRestore.transactions.filter(tx => tx.id !== txId);

            // Find closed positions for this sell to restore BUY transactions
            const relatedClosedPositions = (portfolio.closedPositions || []).filter(
              cp => cp.sellTransactionId === txId
            );

            console.log('🔄 Restoring', relatedClosedPositions.length, 'closed positions for', assetToRestore.ticker);

            // Recreate consumed BUY transactions
            relatedClosedPositions.forEach(cp => {
              const existingBuyTx = filteredTxs.find(t => t.id === cp.buyTransactionId);

              if (existingBuyTx) {
                // Partial consumption - add back the consumed quantity
                filteredTxs = filteredTxs.map(t =>
                  t.id === cp.buyTransactionId
                    ? {
                        ...t,
                        quantity: t.quantity + cp.entryQuantity,
                        totalCost: t.totalCost + cp.entryCostBasis
                      }
                    : t
                );
              } else {
                // Full consumption - recreate the BUY transaction
                const recreatedBuyTx: Transaction = {
                  id: cp.buyTransactionId,
                  type: 'BUY',
                  quantity: cp.entryQuantity,
                  pricePerCoin: cp.entryPrice,
                  date: cp.entryDate,
                  totalCost: cp.entryCostBasis,
                  tag: cp.entryTag || 'DCA',
                  createdAt: new Date().toISOString(),
                  purchaseCurrency: cp.entryCurrency as Currency,
                  exchangeRateAtPurchase: undefined
                };
                filteredTxs.push(recreatedBuyTx);
              }
            });

            // Recalculate from restored transactions
            const buyTxs = filteredTxs.filter(t => t.type === 'BUY');
            const newQty = buyTxs.reduce((sum, t) => sum + t.quantity, 0);
            const newCost = buyTxs.reduce((sum, t) => sum + t.totalCost, 0);

            updatedAssets = updatedAssets.map(a =>
              a.id === assetId
                ? {
                    ...a,
                    transactions: filteredTxs,
                    quantity: newQty,
                    totalCostBasis: newCost,
                    avgBuyPrice: newQty > 0 ? newCost / newQty : 0
                  }
                : a
            );
          }

          // Remove from closed positions
          let updatedClosedPositions = (portfolio.closedPositions || []).filter(
            cp => cp.sellTransactionId !== txId
          );

          // P2 FIX: Clean up orphaned closed positions from the deleted proceeds asset
          const deletedAssetTicker = proceedsAsset.ticker.toUpperCase().split(' ')[0];
          const orphanedClosedPositions = updatedClosedPositions.filter(cp => {
            const cpTicker = cp.ticker.toUpperCase().split(' ')[0];
            return cpTicker === deletedAssetTicker;
          });

          if (orphanedClosedPositions.length > 0) {
            console.log('🧹 Cleaning up', orphanedClosedPositions.length, 'orphaned closed positions for', deletedAssetTicker);
            updatedClosedPositions = updatedClosedPositions.filter(cp => {
              const cpTicker = cp.ticker.toUpperCase().split(' ')[0];
              return cpTicker !== deletedAssetTicker;
            });
          }

          return {
            ...portfolio,
            assets: updatedAssets,
            closedPositions: updatedClosedPositions
          };
        });
      } else {
        // Proceeds don't exist - warn about P&L impact
        const confirmed = window.confirm(
          `⚠️ Warning: The proceeds from this SELL transaction no longer exist in your portfolio.\n\n` +
          `Deleting this transaction may cause incorrect P&L calculations and affect your closed positions.\n\n` +
          `It's recommended to keep this transaction for accurate records.\n\n` +
          `Do you still want to delete it?`
        );
        if (!confirmed) return;

        // Delete transaction and update closed positions
        updateActivePortfolio(portfolio => {
          // P2 FIX: Use the same restoration logic even when proceeds don't exist
          const assetToRestore = portfolio.assets.find(a => a.id === assetId);
          let updatedAssets = [...portfolio.assets];

          if (assetToRestore) {
            // Remove the SELL transaction
            let filteredTxs = assetToRestore.transactions.filter(tx => tx.id !== txId);

            // Find closed positions for this sell to restore BUY transactions
            const relatedClosedPositions = (portfolio.closedPositions || []).filter(
              cp => cp.sellTransactionId === txId
            );

            console.log('🔄 Restoring', relatedClosedPositions.length, 'closed positions (proceeds gone) for', assetToRestore.ticker);

            // Recreate consumed BUY transactions
            relatedClosedPositions.forEach(cp => {
              const existingBuyTx = filteredTxs.find(t => t.id === cp.buyTransactionId);

              if (existingBuyTx) {
                // Partial consumption - add back the consumed quantity
                filteredTxs = filteredTxs.map(t =>
                  t.id === cp.buyTransactionId
                    ? {
                        ...t,
                        quantity: t.quantity + cp.entryQuantity,
                        totalCost: t.totalCost + cp.entryCostBasis
                      }
                    : t
                );
              } else {
                // Full consumption - recreate the BUY transaction
                const recreatedBuyTx: Transaction = {
                  id: cp.buyTransactionId,
                  type: 'BUY',
                  quantity: cp.entryQuantity,
                  pricePerCoin: cp.entryPrice,
                  date: cp.entryDate,
                  totalCost: cp.entryCostBasis,
                  tag: cp.entryTag || 'DCA',
                  createdAt: new Date().toISOString(),
                  purchaseCurrency: cp.entryCurrency as Currency,
                  exchangeRateAtPurchase: undefined
                };
                filteredTxs.push(recreatedBuyTx);
              }
            });

            // Recalculate from restored transactions
            const buyTxs = filteredTxs.filter(t => t.type === 'BUY');
            const newQty = buyTxs.reduce((sum, t) => sum + t.quantity, 0);
            const newCost = buyTxs.reduce((sum, t) => sum + t.totalCost, 0);

            if (filteredTxs.length === 0) {
              // If no transactions left, remove the asset
              updatedAssets = updatedAssets.filter(a => a.id !== assetId);
            } else {
              updatedAssets = updatedAssets.map(a =>
                a.id === assetId
                  ? {
                      ...a,
                      transactions: filteredTxs,
                      quantity: newQty,
                      totalCostBasis: newCost,
                      avgBuyPrice: newQty > 0 ? newCost / newQty : 0
                    }
                  : a
              );
            }
          }

          // Remove from closed positions
          const updatedClosedPositions = (portfolio.closedPositions || []).filter(
            cp => cp.sellTransactionId !== txId
          );

          return {
            ...portfolio,
            assets: updatedAssets,
            closedPositions: updatedClosedPositions
          };
        });
      }
      } // End of if (!txToDelete.linkedBuySellTransactionId) check
    } else {
      // P2 FIX: Check if this BUY transaction is proceeds from a SELL
      // Look for SELL transactions that created this asset
      const assetTickerBase = asset.ticker.toUpperCase().split(' ')[0];
      const sellTransactionsForThisAsset: Array<{ asset: Asset; tx: Transaction }> = [];

      assets.forEach(a => {
        a.transactions.forEach(tx => {
          if (tx.type === 'SELL' && tx.proceedsCurrency) {
            const proceedsTicker = tx.proceedsCurrency.toUpperCase().split(' ')[0];
            if (proceedsTicker === assetTickerBase) {
              sellTransactionsForThisAsset.push({ asset: a, tx });
            }
          }
        });
      });

      if (sellTransactionsForThisAsset.length > 0) {
        // P2 FIX: Check if this specific transaction's date matches a sell transaction
        // This identifies if THIS particular BUY was created from proceeds
        const matchingSellTx = sellTransactionsForThisAsset.find(({ tx }) => {
          // Check if the dates are close (same day)
          const sellDate = new Date(tx.date).toDateString();
          const buyDate = new Date(txToDelete.date).toDateString();
          return sellDate === buyDate;
        });

        if (matchingSellTx) {
          // This specific BUY transaction is proceeds from a SELL
          if (asset.transactions.length === 1) {
            // Only one transaction - deleting will remove entire asset
            const confirmed = window.confirm(
              `⚠️ Warning: "${asset.ticker}" is proceeds from a sell transaction.\n\n` +
              `Deleting this transaction will remove the entire position and REVERSE the original sale.\n\n` +
              `Do you want to continue?`
            );

            if (!confirmed) return;

            // Use the same logic as handleRemoveAsset for proceeds
            handleRemoveAsset(assetId);
            return;
          } else {
            // Multiple transactions - warn that we can't partially delete proceeds
            alert(
              `❌ Cannot delete this transaction.\n\n` +
              `This "${asset.ticker}" purchase is proceeds from selling ${matchingSellTx.asset.ticker}.\n\n` +
              `To reverse this, you must delete the entire "${asset.ticker}" position using the delete button (trash icon next to refresh).`
            );
            return;
          }
        }
      }

      // Normal BUY transaction deletion (no source information, not proceeds from SELL)
      updateActivePortfolio(portfolio => ({
        ...portfolio,
        assets: portfolio.assets.map(assetItem => {
          if (assetItem.id !== assetId) return assetItem;
          const updatedTxs = assetItem.transactions.filter(tx => tx.id !== txId);
          if (updatedTxs.length === 0) return null;
          const newQty = updatedTxs.reduce((sum, tx) => sum + tx.quantity, 0);
          const newCost = updatedTxs.reduce((sum, tx) => sum + tx.totalCost, 0);
          return { ...assetItem, transactions: updatedTxs, quantity: newQty, totalCostBasis: newCost, avgBuyPrice: newCost / newQty };
        }).filter(a => a !== null) as Asset[]
      }));
    }
  };

  const handleEditTransaction = (assetId: string, txId: string, updates: { quantity: number; pricePerCoin: number; date: string; tag: TransactionTag; customTag?: string }) => {
    updateActivePortfolio(portfolio => ({
      ...portfolio,
      assets: portfolio.assets.map(asset => {
        if (asset.id !== assetId) return asset;

        const updatedTransactions = asset.transactions.map(tx => {
          if (tx.id !== txId) return tx;

          return {
            ...tx,
            quantity: updates.quantity,
            pricePerCoin: updates.pricePerCoin,
            date: updates.date,
            totalCost: updates.quantity * updates.pricePerCoin,
            tag: updates.tag,
            customTag: updates.customTag,
            lastEdited: new Date().toISOString()
          };
        });

        const newQty = updatedTransactions.reduce((sum, tx) => sum + tx.quantity, 0);
        const newCost = updatedTransactions.reduce((sum, tx) => sum + tx.totalCost, 0);

        return {
          ...asset,
          transactions: updatedTransactions,
          quantity: newQty,
          totalCostBasis: newCost,
          avgBuyPrice: newCost / newQty
        };
      })
    }));
  };

  // P2: Trading Lifecycle - Sell Asset Handler
  const handleSellAsset = async (
    asset: Asset,
    quantity: number,
    pricePerCoinOrQtyReceived: number,
    date: string,
    proceedsCurrency: string,
    isCryptoToCrypto: boolean,
    tag?: TransactionTag
  ) => {
    try {
      const sellTransactionId = Math.random().toString(36).substr(2, 9);

      // Parse date in local timezone (same as handleAddAsset)
      const [year, month, day] = date.split('-').map(Number);
      const localDate = new Date(year, month - 1, day);

      // Fetch historical FX rates for the sell date
      let historicalRates: Record<Currency, number> | undefined;
      try {
        historicalRates = await fetchHistoricalExchangeRatesForDate(localDate);
      } catch (error) {
        console.warn(`⚠️ Failed to fetch historical FX rates for ${date}:`, error);
      }

      // P2: For crypto-to-crypto, we need to calculate the USD value at trade time
      let pricePerCoin: number;
      let proceedsValueUSD: number | undefined;

      if (isCryptoToCrypto) {
        const quantityReceived = pricePerCoinOrQtyReceived;

        // P2 FIX: For crypto-to-crypto, the proceeds value should be the MARKET VALUE of what we're selling
        // NOT the cost basis. We need to use the current price of the asset being sold.
        const soldAssetCurrency = asset.currency || detectAssetNativeCurrency(asset.ticker);

        // Get the market value of what we're selling in USD
        const marketValueInSoldCurrency = quantity * asset.currentPrice;
        const marketValueUSD = soldAssetCurrency === 'USD'
          ? marketValueInSoldCurrency
          : convertCurrencySync(marketValueInSoldCurrency, soldAssetCurrency, 'USD', exchangeRates);

        console.log('🔄 Crypto-to-crypto trade - using MARKET VALUE:');
        console.log('  Selling:', quantity, asset.ticker, '@ market price', asset.currentPrice);
        console.log('  Market value in', soldAssetCurrency, ':', marketValueInSoldCurrency);
        console.log('  Market value in USD:', marketValueUSD);
        console.log('  Receiving:', quantityReceived, proceedsCurrency);

        // The price per received coin should be based on the market value we're giving up
        pricePerCoin = marketValueUSD / quantityReceived;

        // For P&L calculation, the proceeds value IS the market value (no gain/loss on the trade itself)
        proceedsValueUSD = marketValueUSD;

        console.log('  Price per received coin (market-based cost basis):', pricePerCoin);
        console.log('  This means ETH should have zero P&L immediately after trade');
      } else {
        pricePerCoin = pricePerCoinOrQtyReceived;
        proceedsValueUSD = undefined; // Will be calculated from pricePerCoin in the function
      }

      // Calculate realized P&L using FIFO
      const result = calculateRealizedPnL(
        asset,
        quantity,
        pricePerCoin,
        proceedsCurrency,
        date,
        displayCurrency,
        exchangeRates,
        tag,
        sellTransactionId,
        proceedsValueUSD // P2: Pass USD value for crypto-to-crypto
      );

      // Create SELL transaction
      const sellTx: Transaction = {
        id: sellTransactionId,
        type: 'SELL',
        quantity,
        pricePerCoin,
        date,
        totalCost: quantity * pricePerCoin, // Total proceeds
        tag: tag || 'Profit-Taking',
        proceedsCurrency,
        createdAt: new Date().toISOString(),
        purchaseCurrency: detectAssetNativeCurrency(asset.ticker),
        exchangeRateAtPurchase: historicalRates
      };

      // Calculate updated asset values
      const newQuantity = asset.quantity - quantity;
      const isFullSell = newQuantity === 0;

      // Recalculate cost basis from remaining BUY transactions
      const remainingBuyTxs = result.remainingTransactions.filter(tx => tx.type === 'BUY');
      const newTotalCostBasis = remainingBuyTxs.reduce((sum, tx) => sum + tx.totalCost, 0);
      const newAvgBuyPrice = newQuantity > 0 ? newTotalCostBasis / newQuantity : 0;

      const updatedAsset: Asset = {
        ...asset,
        transactions: [...result.remainingTransactions, sellTx],
        quantity: newQuantity,
        totalCostBasis: newTotalCostBasis,
        avgBuyPrice: newAvgBuyPrice,
        lastUpdated: new Date().toISOString()
      };

      // P2: Update portfolio with sold asset and add proceeds
      updateActivePortfolio(portfolio => {
        let updatedAssets = portfolio.assets;

        if (isFullSell) {
          // Remove asset from active assets
          updatedAssets = updatedAssets.filter(a => a.id !== asset.id);
        } else {
          // Update asset with new values
          updatedAssets = updatedAssets.map(a => a.id === asset.id ? updatedAsset : a);
        }

        // P2: Handle proceeds - either crypto or cash position
        if (isCryptoToCrypto) {
          // For crypto-to-crypto, we'll add the crypto position after this update
          // (needs to be done separately to trigger price fetch)
        } else {
          // Add or update cash position (stablecoins or fiat)
          const totalProceeds = quantity * pricePerCoin;
          const cashAsset = createOrUpdateCashPosition(
            updatedAssets,
            totalProceeds,
            proceedsCurrency,
            date,
            tag
          );

          const existingCashIndex = updatedAssets.findIndex(a => a.ticker === cashAsset.ticker);
          if (existingCashIndex >= 0) {
            updatedAssets[existingCashIndex] = cashAsset;
          } else {
            updatedAssets.push(cashAsset);
          }
        }

        return {
          ...portfolio,
          assets: updatedAssets,
          closedPositions: [...(portfolio.closedPositions || []), ...result.closedPositions]
        };
      });

      // P2: If crypto-to-crypto, add the received crypto as a new position
      if (isCryptoToCrypto) {
        const quantityReceived = pricePerCoinOrQtyReceived;

        // P2 FIX: pricePerCoin was already calculated above using market value
        // It represents the cost basis per received coin in USD
        await handleAddAsset(
          proceedsCurrency, // ticker (e.g., 'ETH')
          quantityReceived, // quantity received (e.g., 2.76)
          pricePerCoin, // cost basis per coin in USD (based on market value of sold asset)
          date,
          'USD', // Crypto cost basis in USD
          tag || 'Profit-Taking'
        );
      }

      // Close modal
      setSellModalAsset(null);

      // Show success message
      const totalProceeds = quantity * pricePerCoin;
      console.log(`✅ Sold ${quantity} ${asset.ticker} for ${proceedsCurrency} ${isCryptoToCrypto ? pricePerCoinOrQtyReceived.toFixed(8) : totalProceeds.toFixed(2)}`);
      console.log(`💰 Realized P&L: ${displayCurrency} ${result.realizedPnL.toFixed(2)} (${result.realizedPnLPercent.toFixed(2)}%)`);

    } catch (error) {
      console.error('❌ Sell transaction failed:', error);
      throw error;
    }
  };

  // ============================================================================
  // P3: CASH FLOW MANAGEMENT HANDLERS
  // ============================================================================

  /**
   * Handle DEPOSIT transaction
   * Creates or updates an asset with a DEPOSIT transaction
   */
  const handleDeposit = async (
    ticker: string,
    quantity: number,
    costBasis: number, // User-provided cost basis (for crypto/stocks deposited from elsewhere)
    date: string,
    depositSource: string,
    tag?: TransactionTag,
    costBasisCurrency?: Currency
  ) => {
    try {
      // Parse date in local timezone
      const [year, month, day] = date.split('-').map(Number);
      const localDate = new Date(year, month - 1, day);

      // Fetch historical FX rates for the deposit date
      let historicalRates: Record<Currency, number> | undefined;
      try {
        historicalRates = await fetchHistoricalExchangeRatesForDate(localDate);
      } catch (error) {
        console.warn(`⚠️ Failed to fetch historical FX rates for ${date}:`, error);
      }

      // Detect asset currency
      const assetCurrency = detectAssetNativeCurrency(ticker);

      // Use provided currency for cost basis, fallback to detected asset currency
      const purchaseCurrency = costBasisCurrency || assetCurrency;

      // Create DEPOSIT transaction
      const depositTx: Transaction = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'DEPOSIT',
        quantity,
        pricePerCoin: costBasis / quantity, // Cost basis per unit
        date,
        totalCost: costBasis,
        tag: tag || 'DCA',
        createdAt: new Date().toISOString(),
        purchaseCurrency: purchaseCurrency,
        exchangeRateAtPurchase: historicalRates,
        costBasis,
        depositSource
      };

      // Find existing asset or create new one
      const existingAsset = assets.find(a => a.ticker.toUpperCase() === ticker.toUpperCase());

      if (existingAsset) {
        // Update existing asset
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: portfolio.assets.map(a =>
            a.id === existingAsset.id
              ? {
                  ...a,
                  quantity: a.quantity + quantity,
                  transactions: [...a.transactions, depositTx],
                  totalCostBasis: a.totalCostBasis + costBasis,
                  avgBuyPrice: (a.totalCostBasis + costBasis) / (a.quantity + quantity),
                  lastUpdated: new Date().toISOString()
                }
              : a
          )
        }));

        console.log(`✅ Deposited ${quantity} ${ticker} to existing position`);
      } else {
        // Create new asset - this will fetch price
        await handleAddAsset(ticker, quantity, costBasis / quantity, date, assetCurrency, tag || 'DCA');

        // Update the transaction type to DEPOSIT and set correct purchaseCurrency
        // Match by the most recent transaction (should be the one we just added)
        updateActivePortfolio(portfolio => {
          const updatedPortfolio = {
            ...portfolio,
            assets: portfolio.assets.map(a => {
              if (a.ticker.toUpperCase() === ticker.toUpperCase()) {
                // Find the most recent transaction (the one we just added)
                const sortedTxs = [...a.transactions].sort((a, b) =>
                  new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
                );

                const updatedTxs = a.transactions.map((tx): Transaction => {
                  // Update the most recent transaction to be a DEPOSIT with correct currency
                  if (tx.id === sortedTxs[0]?.id) {
                    return {
                      ...tx,
                      type: 'DEPOSIT' as const,
                      depositSource,
                      costBasis,
                      purchaseCurrency: purchaseCurrency,
                      exchangeRateAtPurchase: historicalRates
                    };
                  }
                  return tx;
                });

                return {
                  ...a,
                  transactions: updatedTxs
                };
              }
              return a;
            })
          };
          return updatedPortfolio;
        });

        console.log(`✅ Created new position with ${quantity} ${ticker} deposit`);
      }
    } catch (error) {
      console.error('❌ Deposit transaction failed:', error);
      throw error;
    }
  };

  /**
   * Handle INCOME transaction
   * Records income with $0 cost basis (dividends, staking, airdrops)
   */
  const handleIncome = async (
    ticker: string,
    quantity: number,
    date: string,
    incomeType: 'dividend' | 'staking' | 'airdrop' | 'interest',
    incomeSource: string,
    tag?: TransactionTag,
    costBasis?: number,
    costBasisCurrency?: Currency
  ) => {
    try {
      // Parse date in local timezone
      const [year, month, day] = date.split('-').map(Number);
      const localDate = new Date(year, month - 1, day);

      // Fetch historical FX rates for the income date
      let historicalRates: Record<Currency, number> | undefined;
      try {
        historicalRates = await fetchHistoricalExchangeRatesForDate(localDate);
      } catch (error) {
        console.warn(`⚠️ Failed to fetch historical FX rates for ${date}:`, error);
      }

      // Detect asset currency
      const assetCurrency = detectAssetNativeCurrency(ticker);

      // Use provided currency for cost basis, fallback to detected asset currency
      const purchaseCurrency = costBasisCurrency || assetCurrency;

      // Use provided cost basis or default to $0
      const finalCostBasis = costBasis ?? 0;
      const pricePerUnit = quantity > 0 ? finalCostBasis / quantity : 0;

      // Create INCOME transaction
      const incomeTx: Transaction = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'INCOME',
        quantity,
        pricePerCoin: pricePerUnit,
        date,
        totalCost: finalCostBasis,
        tag: tag || 'Research',
        createdAt: new Date().toISOString(),
        purchaseCurrency: purchaseCurrency,
        exchangeRateAtPurchase: historicalRates,
        incomeType,
        incomeSource,
        costBasis: finalCostBasis
      };

      // Find existing asset or create new one
      const existingAsset = assets.find(a => a.ticker.toUpperCase() === ticker.toUpperCase());

      if (existingAsset) {
        // Update existing asset - add quantity and cost basis
        const newTotalCostBasis = existingAsset.totalCostBasis + finalCostBasis;
        const newQuantity = existingAsset.quantity + quantity;

        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: portfolio.assets.map(a =>
            a.id === existingAsset.id
              ? {
                  ...a,
                  quantity: newQuantity,
                  totalCostBasis: newTotalCostBasis,
                  transactions: [...a.transactions, incomeTx],
                  avgBuyPrice: newQuantity > 0 ? newTotalCostBasis / newQuantity : 0,
                  lastUpdated: new Date().toISOString()
                }
              : a
          )
        }));

        console.log(`✅ Received ${quantity} ${ticker} as ${incomeType} income (cost basis: ${finalCostBasis > 0 ? `$${finalCostBasis}` : '$0'})`);
      } else {
        // Create new asset with provided cost basis
        await handleAddAsset(ticker, quantity, finalCostBasis, date, assetCurrency, tag || 'Research');

        // Update the transaction type to INCOME
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: portfolio.assets.map(a => {
            if (a.ticker.toUpperCase() === ticker.toUpperCase()) {
              return {
                ...a,
                transactions: a.transactions.map(tx =>
                  tx.createdAt === incomeTx.createdAt
                    ? { ...tx, type: 'INCOME', incomeType, incomeSource }
                    : tx
                )
              };
            }
            return a;
          })
        }));

        console.log(`✅ Created new position with ${quantity} ${ticker} income (${incomeType})`);
      }
    } catch (error) {
      console.error('❌ Income transaction failed:', error);
      throw error;
    }
  };

  /**
   * Handle WITHDRAWAL transaction (to external destination, not portfolio transfer)
   * Removes quantity from asset and records transaction with P&L = 0
   */
  const handleWithdrawal = (
    asset: Asset,
    quantity: number,
    date: string,
    withdrawalDestination: string,
    tag?: TransactionTag
  ) => {
    try {
      // P3 FIX: Use FIFO to calculate cost basis but DON'T modify acquisition transactions
      // This allows proper restoration when deleting withdrawals
      const sortedAcquisitionTxs = [...asset.transactions]
        .filter(tx => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let remainingToWithdraw = quantity;
      let costBasisWithdrawn = 0;

      // Calculate cost basis using FIFO (without modifying transactions)
      for (const tx of sortedAcquisitionTxs) {
        if (remainingToWithdraw <= 0) break;

        const qtyFromThisTx = Math.min(remainingToWithdraw, tx.quantity);
        const costFromThisTx = (qtyFromThisTx / tx.quantity) * tx.totalCost;

        remainingToWithdraw -= qtyFromThisTx;
        costBasisWithdrawn += costFromThisTx;
      }

      // Calculate average price for withdrawn quantity
      const avgPriceWithdrawn = quantity > 0 ? costBasisWithdrawn / quantity : 0;

      // Create WITHDRAWAL transaction (shows cost basis, but P&L = 0)
      const withdrawalTx: Transaction = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'WITHDRAWAL',
        quantity,
        pricePerCoin: avgPriceWithdrawn,
        date,
        totalCost: costBasisWithdrawn,
        tag: tag || 'Profit-Taking',
        createdAt: new Date().toISOString(),
        withdrawalDestination
      };

      // Add withdrawal transaction to history (keep all existing transactions intact)
      const updatedTxs = [...asset.transactions, withdrawalTx];

      // Recalculate position: acquisitions - (sells + withdrawals + transfers)
      const acquisitions = updatedTxs.filter(tx =>
        tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
      );
      const disposals = updatedTxs.filter(tx =>
        tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
      );

      const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
      const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
      const newQty = totalAcquired - totalDisposed;

      // Cost basis calculation using FIFO
      const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
      const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
      const newCost = totalCostAcquired - totalCostDisposed;

      const isFullWithdrawal = newQty === 0;

      if (isFullWithdrawal) {
        // Remove asset entirely
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: portfolio.assets.filter(a => a.id !== asset.id)
        }));

        console.log(`✅ Withdrew all ${asset.ticker} (full withdrawal, cost basis: $${costBasisWithdrawn.toFixed(2)})`);
      } else {
        // Partial withdrawal - update asset
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: portfolio.assets.map(a =>
            a.id === asset.id
              ? {
                  ...a,
                  quantity: newQty,
                  transactions: updatedTxs,
                  totalCostBasis: newCost,
                  avgBuyPrice: newQty > 0 ? newCost / newQty : 0,
                  lastUpdated: new Date().toISOString()
                }
              : a
          )
        }));

        console.log(`✅ Withdrew ${quantity} ${asset.ticker} (partial withdrawal, cost basis: $${costBasisWithdrawn.toFixed(2)})`);
      }
    } catch (error) {
      console.error('❌ Withdrawal transaction failed:', error);
      throw error;
    }
  };

  /**
   * P3: Handle BUY transaction with validation (Immutable Architecture)
   * Validates sufficient balance before purchase
   *
   * KEY: Does NOT modify acquisition transactions - keeps them immutable
   * Creates SELL transaction in source, BUY transaction in destination
   */
  const handleBuyWithValidation = async (
    sourceTicker: string,
    sourceQuantity: number,
    destinationTicker: string,
    destinationQuantity: number,
    date: string,
    tag?: TransactionTag
  ) => {
    try {
      // Validate the transaction
      const validation = validateBuyTransaction(
        assets,
        sourceTicker,
        sourceQuantity,
        destinationTicker,
        date
      );

      if (!validation.valid) {
        // Show warning popup
        const proceed = window.confirm(
          `⚠️ Validation Warning\n\n${validation.error}\n\nDo you want to proceed anyway?`
        );

        if (!proceed) {
          return; // User cancelled
        }
      }

      // Parse date in local timezone
      const [year, month, day] = date.split('-').map(Number);
      const localDate = new Date(year, month - 1, day);

      // Fetch historical FX rates for the buy date
      let historicalRates: Record<Currency, number> | undefined;
      try {
        historicalRates = await fetchHistoricalExchangeRatesForDate(localDate);
      } catch (error) {
        console.warn(`⚠️ Failed to fetch historical FX rates for ${date}:`, error);
      }

      // Calculate price per coin for destination asset
      const pricePerDestinationCoin = sourceQuantity / destinationQuantity;

      // Detect currencies
      const sourceCurrency = detectAssetNativeCurrency(sourceTicker);
      const destCurrency = detectAssetNativeCurrency(destinationTicker);

      // P4: Generate transaction pair ID for linking BUY and SELL
      const transactionPairId = Math.random().toString(36).substr(2, 9);
      const buyTxId = Math.random().toString(36).substr(2, 9);
      const sellTxId = Math.random().toString(36).substr(2, 9);

      // P1 FIX: Calculate market-value-based cost basis BEFORE creating buyTx
      // Get source asset's market price on transaction date
      const sourceAsset = assets.find(a => a.ticker.toUpperCase() === sourceTicker.toUpperCase());

      // Default values
      let costBasisSpentUSD = sourceQuantity; // Fallback: assume 1:1 USD
      let costBasisFIFOinUSD = 0; // FIFO cost basis converted to USD for P&L calculation
      let sourceMarketPriceOnDate = 1.0; // Default for cash/stablecoins

      // FIX: Declare pnlResult here so it's accessible in both if blocks below
      let pnlResult: ReturnType<typeof calculateRealizedPnL> | null = null;

      if (sourceAsset) {
        // FIX 3: Validate we have the correct asset and log price
        if (sourceAsset.ticker.toUpperCase() !== sourceTicker.toUpperCase()) {
          throw new Error(`Asset mismatch: expected ${sourceTicker} but got ${sourceAsset.ticker}`);
        }

        console.log(`🔍 Source asset: ${sourceAsset.ticker}, currentPrice: $${sourceAsset.currentPrice}`);

        // P1 FIX: Get market price of source asset on transaction date
        sourceMarketPriceOnDate = getHistoricalPrice(sourceAsset, date);

        // Market value = quantity * price on that date
        costBasisSpentUSD = sourceQuantity * sourceMarketPriceOnDate;

        console.log(`💰 BUY cost basis: ${sourceQuantity} ${sourceTicker} @ $${sourceMarketPriceOnDate} = $${costBasisSpentUSD} USD`);

        // Calculate FIFO cost basis in USD for the SELL transaction's realized P&L
        const sortedAcquisitionTxs = [...sourceAsset.transactions]
          .filter(tx => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let remainingToSpend = sourceQuantity;

        // Calculate FIFO cost basis with FX conversion to USD
        for (const tx of sortedAcquisitionTxs) {
          if (remainingToSpend <= 0) break;

          const qtyFromThisTx = Math.min(remainingToSpend, tx.quantity);
          const costFromThisTxOriginal = (qtyFromThisTx / tx.quantity) * tx.totalCost;

          // Convert to USD using transaction's historical FX rate
          let costFromThisTxUSD = costFromThisTxOriginal;
          if (tx.exchangeRateAtPurchase && tx.purchaseCurrency && tx.purchaseCurrency !== 'USD') {
            costFromThisTxUSD = convertCurrencySync(
              costFromThisTxOriginal,
              tx.purchaseCurrency,
              'USD',
              tx.exchangeRateAtPurchase
            );
          }

          remainingToSpend -= qtyFromThisTx;
          costBasisFIFOinUSD += costFromThisTxUSD;
        }

        console.log(`📊 SELL realized P&L: Proceeds=$${costBasisSpentUSD} - FIFO Cost=$${costBasisFIFOinUSD} = $${costBasisSpentUSD - costBasisFIFOinUSD}`);
      }

      // P3 FIX: Calculate closed positions for the source asset being sold
      let closedPositionsFromSell: any[] = [];
      if (sourceAsset) {
        pnlResult = calculateRealizedPnL(
          sourceAsset,
          sourceQuantity,
          sourceMarketPriceOnDate, // Market price per coin on transaction date
          'USD', // Proceeds currency
          date,
          displayCurrency,
          historicalRates || exchangeRates,
          tag,
          sellTxId,
          costBasisSpentUSD // USD value of what's being sold (market value)
        );
        closedPositionsFromSell = pnlResult.closedPositions;
        console.log(`📊 Created ${closedPositionsFromSell.length} closed positions for BUY transaction`);
      }

      // Create BUY transaction for destination asset
      // Store ORIGINAL source currency values for display (e.g., 70 CHF)
      // The USD conversion is only used internally for P&L calculations
      const buyTx: Transaction = {
        id: buyTxId,
        type: 'BUY',
        quantity: destinationQuantity,
        pricePerCoin: destinationQuantity > 0 ? sourceQuantity / destinationQuantity : 0, // Original: 70 CHF / 1 = 70 CHF per unit
        date,
        totalCost: sourceQuantity, // Original amount paid (e.g., 70 CHF)
        tag: tag || 'DCA',
        createdAt: new Date().toISOString(),
        purchaseCurrency: sourceCurrency, // Original currency (CHF, not USD)
        exchangeRateAtPurchase: historicalRates,
        sourceTicker,
        sourceQuantity,
        linkedBuySellTransactionId: sellTxId, // P4: Link to SELL transaction
        transactionPairId: transactionPairId // P4: Pair ID
      };

      // Create SELL transaction for source asset (already calculated avgPriceSpent above)
      if (sourceAsset) {

        // Create SELL transaction for source asset (disposal)
        // For cash assets, pricePerCoin should always be 1.00 and totalCost = qty × price
        const isCash = isCashAsset(sourceTicker);
        const sellPricePerCoin = isCash ? 1.00 : sourceMarketPriceOnDate;
        const sellTotalCost = isCash ? (sourceQuantity * 1.00) : costBasisFIFOinUSD;

        const sellTx: Transaction = {
          id: sellTxId,
          type: 'SELL',
          quantity: sourceQuantity,
          pricePerCoin: sellPricePerCoin, // 1.00 for cash, market price for crypto/stocks
          date,
          totalCost: sellTotalCost, // For cash: qty × 1.00, for crypto: FIFO cost basis
          proceeds: costBasisSpentUSD, // P1 FIX: Proceeds = market value in USD
          proceedsCurrency: 'USD', // P1 FIX: Use USD as common currency
          tag: tag || 'DCA',
          createdAt: new Date().toISOString(),
          destinationTicker,
          destinationQuantity,
          linkedBuySellTransactionId: buyTxId, // P4: Link to BUY transaction
          transactionPairId: transactionPairId // P4: Pair ID
        };

        // Add SELL transaction to source (keep ALL existing transactions for display)
        // Balance is calculated correctly below by summing acquisitions - disposals
        const updatedSourceTxs = [...sourceAsset.transactions, sellTx];

        // Recalculate source position: acquisitions - disposals
        const acquisitions = updatedSourceTxs.filter(tx =>
          tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
        );
        const disposals = updatedSourceTxs.filter(tx =>
          tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
        );

        const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
        const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
        const newSourceQty = totalAcquired - totalDisposed;

        const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
        const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
        const newSourceCost = totalCostAcquired - totalCostDisposed;

        // Update source asset
        updateActivePortfolio(portfolio => {
          if (newSourceQty === 0) {
            // If fully spent, remove the asset
            return {
              ...portfolio,
              assets: portfolio.assets.filter(a => a.id !== sourceAsset.id),
              closedPositions: [...(portfolio.closedPositions || []), ...closedPositionsFromSell] // P3 FIX
            };
          }

          return {
            ...portfolio,
            assets: portfolio.assets.map(a =>
              a.id === sourceAsset.id
                ? {
                    ...a,
                    quantity: newSourceQty,
                    transactions: updatedSourceTxs,
                    totalCostBasis: newSourceCost,
                    avgBuyPrice: newSourceQty > 0 ? newSourceCost / newSourceQty : 0,
                    lastUpdated: new Date().toISOString()
                  }
                : a
            ),
            closedPositions: [...(portfolio.closedPositions || []), ...closedPositionsFromSell] // P3 FIX
          };
        });
      }

      // Add destination asset
      const existingDest = assets.find(a => a.ticker.toUpperCase() === destinationTicker.toUpperCase());
      if (existingDest) {
        // P3 FIX: Update existing destination asset - just add BUY transaction and recalculate
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: portfolio.assets.map(a => {
            if (a.id === existingDest.id) {
              const updatedDestTxs = [...a.transactions, buyTx];

              // Recalculate destination position
              const destAcquisitions = updatedDestTxs.filter(tx =>
                tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
              );
              const destDisposals = updatedDestTxs.filter(tx =>
                tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
              );

              const destTotalAcquired = destAcquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
              const destTotalDisposed = destDisposals.reduce((sum, tx) => sum + tx.quantity, 0);
              const newDestQty = destTotalAcquired - destTotalDisposed;

              const destTotalCostAcquired = destAcquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
              const destTotalCostDisposed = destDisposals.reduce((sum, tx) => sum + tx.totalCost, 0);
              const newDestCost = destTotalCostAcquired - destTotalCostDisposed;

              return {
                ...a,
                quantity: newDestQty,
                transactions: updatedDestTxs,
                totalCostBasis: newDestCost,
                avgBuyPrice: newDestQty > 0 ? newDestCost / newDestQty : 0,
                lastUpdated: new Date().toISOString()
              };
            }
            return a;
          })
        }));

        console.log(`✅ Bought ${destinationQuantity} ${destinationTicker} with ${sourceQuantity} ${sourceTicker}`);
      } else {
        // Create new destination asset directly with our buyTx (preserves linking)
        const newDestAssetId = Math.random().toString(36).substr(2, 9);

        // First create the asset with the properly linked buyTx
        const newDestAsset: Asset = {
          id: newDestAssetId,
          ticker: destinationTicker,
          name: undefined, // Will be fetched
          quantity: destinationQuantity,
          currentPrice: 0, // Will be fetched
          lastUpdated: new Date().toISOString(),
          sources: [],
          isUpdating: true,
          transactions: [buyTx], // Use our buyTx with linking intact!
          avgBuyPrice: buyTx.pricePerCoin,
          totalCostBasis: buyTx.totalCost,
          assetType: undefined, // Will be auto-detected by API
          currency: destCurrency
        };

        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: [...portfolio.assets, newDestAsset]
        }));

        // Now fetch price and history for the new asset
        try {
          const result = await fetchCryptoPrice(destinationTicker);
          updateActivePortfolio(portfolio => ({
            ...portfolio,
            assets: portfolio.assets.map(a => a.id === newDestAssetId ? {
              ...a,
              currentPrice: result.price,
              sources: result.sources,
              isUpdating: false,
              name: result.name || result.symbol || a.name,
              assetType: result.assetType || 'CRYPTO',
              currency: result.currency || destCurrency
            } : a)
          }));

          const historyData = await fetchAssetHistory(destinationTicker, result.price, result.symbol, result.assetType);
          if (historyData) {
            updateActivePortfolio(portfolio => ({
              ...portfolio,
              assets: portfolio.assets.map(a => a.id === newDestAssetId ? { ...a, priceHistory: historyData } : a)
            }));
          }
        } catch (error: any) {
          updateActivePortfolio(portfolio => ({
            ...portfolio,
            assets: portfolio.assets.map(a => a.id === newDestAssetId ? { ...a, isUpdating: false, error: error.message || 'Failed' } : a)
          }));
        }

        console.log(`✅ Created new position: ${destinationQuantity} ${destinationTicker} with ${sourceQuantity} ${sourceTicker} (buyTxId: ${buyTx.id})`);
      }
    } catch (error) {
      console.error('❌ Buy transaction failed:', error);
      throw error;
    }
  };

  /**
   * P3: Handle Portfolio Transfer (Immutable Architecture)
   * Transfers an asset from current portfolio to another portfolio
   * Preserves all cost basis and transaction history
   *
   * KEY: Does NOT modify acquisition transactions - keeps them immutable
   * Creates TRANSFER transaction in source, copies acquisition history to destination
   */
  const handlePortfolioTransfer = (
    asset: Asset,
    quantity: number,
    date: string,
    destinationPortfolioId: string,
    tag?: TransactionTag
  ) => {
    try {
      const transferTxId = Math.random().toString(36).substr(2, 9);
      const destinationPortfolio = portfolios.find(p => p.id === destinationPortfolioId);

      if (!destinationPortfolio) {
        throw new Error('Destination portfolio not found');
      }

      // P3 FIX: Use FIFO to calculate cost basis but DON'T modify acquisition transactions
      const sortedAcquisitionTxs = [...asset.transactions]
        .filter(tx => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let remainingToTransfer = quantity;
      let totalCostBasisTransferred = 0;
      const transferredTxCopies: Transaction[] = [];

      // Calculate cost basis using FIFO (without modifying transactions)
      for (const tx of sortedAcquisitionTxs) {
        if (remainingToTransfer <= 0) break;

        const qtyFromThisTx = Math.min(remainingToTransfer, tx.quantity);
        const costFromThisTx = (qtyFromThisTx / tx.quantity) * tx.totalCost;

        // Create a copy of the transaction for destination portfolio history
        // P3: Mark with transferredFrom to prevent deletion in destination
        transferredTxCopies.push({
          ...tx,
          id: Math.random().toString(36).substr(2, 9), // New ID for destination
          quantity: qtyFromThisTx,
          totalCost: costFromThisTx,
          pricePerCoin: tx.pricePerCoin,
          transferredFrom: activePortfolio.id // Mark as transferred from source portfolio
        });

        remainingToTransfer -= qtyFromThisTx;
        totalCostBasisTransferred += costFromThisTx;
      }

      // Calculate average price for transferred quantity
      const avgPriceTransferred = quantity > 0 ? totalCostBasisTransferred / quantity : 0;

      // Create TRANSFER transaction in source portfolio (shows cost basis, but P&L = 0)
      const transferTx: Transaction = {
        id: transferTxId,
        type: 'TRANSFER',
        quantity,
        pricePerCoin: avgPriceTransferred,
        date,
        totalCost: totalCostBasisTransferred,
        tag: tag || 'Strategic',
        createdAt: new Date().toISOString(),
        destinationPortfolioId: destinationPortfolioId,
        linkedTransactionId: transferTxId
      };

      // Add transfer transaction to source (keep all existing transactions intact)
      const updatedSourceTxs = [...asset.transactions, transferTx];

      // Recalculate source position: acquisitions - (sells + withdrawals + transfers)
      const sourceAcquisitions = updatedSourceTxs.filter(tx =>
        tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
      );
      const sourceDisposals = updatedSourceTxs.filter(tx =>
        tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
      );

      const totalAcquired = sourceAcquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
      const totalDisposed = sourceDisposals.reduce((sum, tx) => sum + tx.quantity, 0);
      const newSourceQty = totalAcquired - totalDisposed;

      // Cost basis calculation using FIFO
      const totalCostAcquired = sourceAcquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
      const totalCostDisposed = sourceDisposals.reduce((sum, tx) => sum + tx.totalCost, 0);
      const newSourceCost = totalCostAcquired - totalCostDisposed;

      // Update source portfolio
      updateActivePortfolio(portfolio => {
        if (newSourceQty === 0) {
          // If fully transferred, remove asset from source
          return {
            ...portfolio,
            assets: portfolio.assets.filter(a => a.id !== asset.id)
          };
        } else {
          // Update asset in source with new position
          return {
            ...portfolio,
            assets: portfolio.assets.map(a =>
              a.id === asset.id
                ? {
                    ...a,
                    quantity: newSourceQty,
                    transactions: updatedSourceTxs,
                    totalCostBasis: newSourceCost,
                    avgBuyPrice: newSourceQty > 0 ? newSourceCost / newSourceQty : 0,
                    lastUpdated: new Date().toISOString()
                  }
                : a
            )
          };
        }
      });

      // Add to destination portfolio
      setPortfolios(prevPortfolios =>
        prevPortfolios.map(p => {
          if (p.id === destinationPortfolioId) {
            const existingAsset = p.assets.find(a => a.ticker === asset.ticker);

            if (existingAsset) {
              // Merge with existing asset - add transaction copies to history
              const updatedDestTxs = [...existingAsset.transactions, ...transferredTxCopies];

              // Recalculate destination position
              const destAcquisitions = updatedDestTxs.filter(tx =>
                tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
              );
              const destDisposals = updatedDestTxs.filter(tx =>
                tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
              );

              const destTotalAcquired = destAcquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
              const destTotalDisposed = destDisposals.reduce((sum, tx) => sum + tx.quantity, 0);
              const newDestQty = destTotalAcquired - destTotalDisposed;

              const destTotalCostAcquired = destAcquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
              const destTotalCostDisposed = destDisposals.reduce((sum, tx) => sum + tx.totalCost, 0);
              const newDestCost = destTotalCostAcquired - destTotalCostDisposed;

              return {
                ...p,
                assets: p.assets.map(a =>
                  a.id === existingAsset.id
                    ? {
                        ...a,
                        quantity: newDestQty,
                        transactions: updatedDestTxs,
                        totalCostBasis: newDestCost,
                        avgBuyPrice: newDestQty > 0 ? newDestCost / newDestQty : 0,
                        lastUpdated: new Date().toISOString()
                      }
                    : a
                )
              };
            } else {
              // Create new asset in destination with transaction copies
              const newAsset: Asset = {
                id: Math.random().toString(36).substr(2, 9),
                ticker: asset.ticker,
                name: asset.name,
                quantity,
                currentPrice: asset.currentPrice,
                lastUpdated: new Date().toISOString(),
                sources: asset.sources,
                isUpdating: false,
                transactions: transferredTxCopies,
                avgBuyPrice: totalCostBasisTransferred / quantity,
                totalCostBasis: totalCostBasisTransferred,
                coinGeckoId: asset.coinGeckoId,
                assetType: asset.assetType,
                currency: asset.currency
              };

              return {
                ...p,
                assets: [...p.assets, newAsset]
              };
            }
          }
          return p;
        })
      );

      console.log(`✅ Transferred ${quantity} ${asset.ticker} to ${destinationPortfolio.name}`);
      console.log(`   Cost basis transferred: ${displayCurrency} ${totalCostBasisTransferred.toFixed(2)}`);
    } catch (error) {
      console.error('❌ Portfolio transfer failed:', error);
      throw error;
    }
  };

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

  // Portfolio management functions
  const handleCreatePortfolio = (name: string) => {
    const newPortfolio: Portfolio = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      color: PORTFOLIO_COLORS[portfolios.length % PORTFOLIO_COLORS.length],
      assets: [],
      closedPositions: [], // P2: Trading Lifecycle
      history: [],
      settings: {},
      createdAt: new Date().toISOString()
    };
    setPortfolios([...portfolios, newPortfolio]);
    setActivePortfolioId(newPortfolio.id);
  };

  const handleRenamePortfolio = (id: string, newName: string) => {
    setPortfolios(prev => prev.map(p => 
      p.id === id ? { ...p, name: newName } : p
    ));
  };

  const handleDeletePortfolio = (id: string) => {
    if (portfolios.length === 1) {
      alert("Cannot delete the last portfolio!");
      return;
    }
    
    const portfolio = portfolios.find(p => p.id === id);
    if (portfolio && portfolio.assets.length > 0) {
      const confirmed = window.confirm(
        `"${portfolio.name}" contains ${portfolio.assets.length} asset(s). Are you sure you want to delete it? It will be saved in deleted portfolios (can be restored from export).`
      );
      if (!confirmed) return;
    }
    
    // Save to deleted portfolios before removing
    if (portfolio) {
      const deletedPortfolios = JSON.parse(localStorage.getItem('deleted_portfolios') || '[]');
      deletedPortfolios.push({
        ...portfolio,
        deletedAt: new Date().toISOString()
      });
      localStorage.setItem('deleted_portfolios', JSON.stringify(deletedPortfolios));
      console.log(`💾 Saved deleted portfolio "${portfolio.name}" to backup`);
    }
    
    setPortfolios(prev => prev.filter(p => p.id !== id));
    if (activePortfolioId === id) {
      setActivePortfolioId(portfolios.find(p => p.id !== id)?.id || '');
    }
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

        {/* P3: New Transaction Button - Primary Entry Point */}
        <div className="mb-6">
          <button
            onClick={() => setIsTransactionModalOpen(true)}
            className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-lg font-semibold rounded-xl transition-all shadow-xl hover:shadow-2xl hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus size={24} strokeWidth={2.5} />
            New Transaction
          </button>
          <p className="text-center text-slate-400 text-sm mt-2">
            Deposit, Buy, Withdraw, or Record Income
          </p>
        </div>

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
              closedPositions={activePortfolio?.closedPositions || []}
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

      {/* P2: Sell Modal */}
      {sellModalAsset && (
        <SellModal
          asset={sellModalAsset}
          onSell={(qty, price, date, currency, tag, isCryptoToCrypto) =>
            handleSellAsset(sellModalAsset, qty, price, date, currency, isCryptoToCrypto || false, tag)
          }
          onClose={() => setSellModalAsset(null)}
          displayCurrency={displayCurrency}
          exchangeRates={exchangeRates}
        />
      )}

      {/* P3: Transaction Modal */}
      {isTransactionModalOpen && (
        <TransactionModal
          onClose={() => setIsTransactionModalOpen(false)}
          onDeposit={handleDeposit}
          onBuy={handleBuyWithValidation}
          onSell={handleSellAsset}
          onWithdraw={handleWithdrawal}
          onTransfer={handlePortfolioTransfer}
          onIncome={handleIncome}
          assets={assets}
          portfolios={portfolios}
          currentPortfolioId={activePortfolioId}
          displayCurrency={displayCurrency}
          exchangeRates={exchangeRates}
        />
      )}

    </div>
  );
};

export default App;