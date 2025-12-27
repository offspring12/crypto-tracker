import { GoogleGenAI } from "@google/genai";
import { SourceLink } from "../types";

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PriceResult {
  price: number;
  sources: SourceLink[];
  rawText: string;
  name?: string;
  symbol?: string;
  assetType?: 'CRYPTO' | 'STOCK_US' | 'STOCK_CH';
}

// Detect asset type from ticker
const detectAssetType = (ticker: string): 'CRYPTO' | 'STOCK_US' | 'STOCK_CH' => {
  const upperTicker = ticker.toUpperCase();
  
  // Swiss stocks end with .SW
  if (upperTicker.endsWith('.SW')) {
    console.log(`✅ Swiss stock detected: ${ticker}`);
    return 'STOCK_CH';
  }
  
  // Known major stocks
  const knownStocks = [
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'TSLA', 'META', 'NVDA', 'AMD', 'NFLX',
    'DIS', 'PYPL', 'ADBE', 'INTC', 'CSCO', 'AVGO', 'TXN', 'QCOM', 'AMGN', 'COST',
    'SBUX', 'MCD', 'NKE', 'BA', 'CAT', 'MMM', 'JNJ', 'PFE', 'MRK', 'UNH'
  ];
  
  if (knownStocks.includes(upperTicker)) {
    console.log(`✅ Known US stock detected: ${ticker}`);
    return 'STOCK_US';
  }
  
  // Pattern matching: 1-4 letter tickers are likely stocks
  if (/^[A-Z]{1,4}$/.test(upperTicker)) {
    console.log(`🔍 Pattern suggests US stock: ${ticker}`);
    return 'STOCK_US';
  }
  
  // Everything else is crypto
  console.log(`🔍 Detected as crypto: ${ticker}`);
  return 'CRYPTO';
};

const isContractAddress = (input: string): boolean => {
  const lowerInput = input.toLowerCase();
  return lowerInput.startsWith('0x') && input.length >= 40;
};

// Save price snapshot to localStorage
const savePriceSnapshot = (ticker: string, price: number) => {
  try {
    const key = `price_snapshots_${ticker}`;
    const existing = localStorage.getItem(key);
    const snapshots: [number, number][] = existing ? JSON.parse(existing) : [];
    
    const now = Date.now();
    const lastSnapshot = snapshots[snapshots.length - 1];
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    if (!lastSnapshot || (now - lastSnapshot[0]) > oneDayMs) {
      snapshots.push([now, price]);
      if (snapshots.length > 2000) {
        snapshots.shift();
      }
      localStorage.setItem(key, JSON.stringify(snapshots));
      console.log(`💾 Saved price snapshot for ${ticker}: $${price}`);
    }
  } catch (e) {
    console.warn('Failed to save price snapshot:', e);
  }
};

// Load price snapshots from localStorage
const loadPriceSnapshots = (ticker: string): [number, number][] => {
  try {
    const key = `price_snapshots_${ticker}`;
    const existing = localStorage.getItem(key);
    return existing ? JSON.parse(existing) : [];
  } catch (e) {
    console.warn('Failed to load price snapshots:', e);
    return [];
  }
};

// Merge API history with local snapshots
const mergeHistoryWithSnapshots = (apiHistory: [number, number][], localSnapshots: [number, number][]): [number, number][] => {
  if (localSnapshots.length === 0) return apiHistory;
  if (apiHistory.length === 0) return localSnapshots;
  
  const combined = [...apiHistory, ...localSnapshots];
  combined.sort((a, b) => a[0] - b[0]);
  
  const deduped: [number, number][] = [];
  const seenDates = new Set<string>();
  
  for (const [timestamp, price] of combined) {
    const dateKey = new Date(timestamp).toDateString();
    if (!seenDates.has(dateKey)) {
      seenDates.add(dateKey);
      deduped.push([timestamp, price]);
    }
  }
  
  return deduped;
};

// Save historical data to localStorage
const saveHistoricalData = (ticker: string, historyData: [number, number][]) => {
  try {
    const key = `price_snapshots_${ticker}`;
    localStorage.setItem(key, JSON.stringify(historyData));
    console.log(`💾 Saved ${historyData.length} historical data points for ${ticker}`);
  } catch (e) {
    console.warn('Failed to save historical data:', e);
  }
};

// SIMPLIFIED: Fetch stock price AND history from Yahoo Finance (no rate limits!)
const fetchYahooStock = async (ticker: string, assetType: 'STOCK_US' | 'STOCK_CH'): Promise<PriceResult> => {
  console.log(`📈 Fetching stock from Yahoo Finance: ${ticker} (${assetType})`);
  
  const yahooUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;
  
  // Try multiple CORS proxies (allorigins.win is often down)
  const corsProxies = [
    `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(yahooUrl)}`,
    `https://cors-anywhere.herokuapp.com/${yahooUrl}`
  ];
  
  for (let i = 0; i < corsProxies.length; i++) {
    const proxyUrl = corsProxies[i];
    const proxyName = proxyUrl.includes('corsproxy.io') ? 'corsproxy.io' : 
                      proxyUrl.includes('allorigins') ? 'allorigins.win' : 
                      'cors-anywhere';
    
    try {
      console.log(`📡 Trying CORS proxy #${i + 1} (${proxyName})...`);
      
      const res = await fetch(proxyUrl);
      
      if (!res.ok) {
        console.warn(`⚠️ Proxy ${proxyName} returned status ${res.status}`);
        continue; // Try next proxy
      }
      
      let data;
      
      // allorigins.win wraps response in {contents: "..."}
      if (proxyName === 'allorigins.win') {
        const proxyData = await res.json();
        data = JSON.parse(proxyData.contents);
      } else {
        // Other proxies return data directly
        data = await res.json();
      }
      
      if (!data.chart?.result?.[0]) {
        console.warn(`⚠️ Invalid response structure from ${proxyName}`);
        continue; // Try next proxy
      }
      
      const result = data.chart.result[0];
      const price = result.meta?.regularMarketPrice;
      
      if (!price || price <= 0) {
        console.warn(`⚠️ Invalid price from ${proxyName}`);
        continue; // Try next proxy
      }
      
      // Get company name
      let companyName = ticker;
      if (result.meta?.longName) {
        companyName = result.meta.longName;
      } else if (result.meta?.shortName) {
        companyName = result.meta.shortName;
      }
      
      console.log(`✅ Yahoo Finance SUCCESS (via ${proxyName}): ${companyName} = $${price}`);
      
      // Save current price
      savePriceSnapshot(ticker, price);
      
      // Extract historical data (timestamps and closes)
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      
      if (timestamps.length > 0 && closes.length > 0) {
        const historyData: [number, number][] = [];
        
        for (let i = 0; i < timestamps.length; i++) {
          const timestamp = timestamps[i] * 1000; // Convert to milliseconds
          const close = closes[i];
          
          if (close && close > 0 && !isNaN(close)) {
            historyData.push([timestamp, close]);
          }
        }
        
        if (historyData.length > 0) {
          console.log(`✅ Got ${historyData.length} days of history from Yahoo Finance`);
          
          const localSnapshots = loadPriceSnapshots(ticker);
          const merged = mergeHistoryWithSnapshots(historyData, localSnapshots);
          saveHistoricalData(ticker, merged);
          
          console.log(`💾 Saved ${merged.length} total historical data points`);
        }
      }
      
      return {
        price,
        name: companyName,
        symbol: ticker,
        assetType,
        sources: [{
          title: 'Yahoo Finance',
          url: `https://finance.yahoo.com/quote/${ticker}`
        }],
        rawText: `${companyName} (${ticker}) - $${price}`
      };
      
    } catch (error: any) {
      console.warn(`❌ Proxy ${proxyName} failed:`, error.message);
      if (i === corsProxies.length - 1) {
        // Last proxy failed, throw error
        throw new Error(`All CORS proxies failed. Last error: ${error.message}`);
      }
      // Otherwise continue to next proxy
    }
  }
  
  throw new Error('All CORS proxies failed to fetch Yahoo Finance data');
};

// Fetch DEX token price
export const fetchTokenPriceFromDex = async (contractAddress: string): Promise<PriceResult> => {
  console.log('🚀 fetchTokenPriceFromDex called with:', contractAddress);
  
  const normalizedAddress = contractAddress.toLowerCase();
  
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${normalizedAddress}`;
    console.log('📡 Fetching from URL:', url);
    
    const res = await fetch(url);
    console.log('📥 Fetch response status:', res.status, res.ok);
    
    if (!res.ok) throw new Error(`DEXScreener API failed with status ${res.status}`);
    
    const data = await res.json();
    console.log('✅ DEXScreener response received:', data);
    
    if (!data.pairs || data.pairs.length === 0) {
      console.error('❌ No pairs found in response');
      throw new Error('No trading pairs found for this token');
    }
    
    console.log(`📊 Found ${data.pairs.length} pairs`);
    
    const sortedPairs = data.pairs
      .filter((pair: any) => {
        const hasPrice = pair.priceUsd && parseFloat(pair.priceUsd) > 0;
        const liquidityUsd = parseFloat(pair.liquidity?.usd || 0);
        console.log(`  Pair: ${pair.baseToken?.symbol} on ${pair.dexId} - Price: ${pair.priceUsd}, Liquidity: $${liquidityUsd}`);
        return hasPrice;
      })
      .sort((a: any, b: any) => {
        const liquidityA = parseFloat(a.liquidity?.usd || 0);
        const liquidityB = parseFloat(b.liquidity?.usd || 0);
        return liquidityB - liquidityA;
      });
    
    console.log(`✅ ${sortedPairs.length} valid pairs after filtering`);
    
    if (sortedPairs.length === 0) {
      console.error('❌ No valid pairs after filtering');
      throw new Error('No valid trading pairs with price data found');
    }
    
    const bestPair = sortedPairs[0];
    console.log('🎯 Selected best pair:', {
      dex: bestPair.dexId,
      chain: bestPair.chainId,
      symbol: bestPair.baseToken?.symbol,
      priceUsd: bestPair.priceUsd,
      liquidity: bestPair.liquidity?.usd
    });
    
    const priceStr = String(bestPair.priceUsd);
    const price = parseFloat(priceStr);
    
    console.log('💰 Price parsing:', { 
      priceString: priceStr, 
      parsedNumber: price,
      isValid: !isNaN(price) && price > 0
    });
    
    if (isNaN(price) || price <= 0) {
      console.error('❌ Invalid price:', { priceStr, price });
      throw new Error(`Invalid price data: ${priceStr}`);
    }
    
    const tokenName = bestPair.baseToken?.name || 'Unknown Token';
    const tokenSymbol = bestPair.baseToken?.symbol || contractAddress.slice(0, 8);
    
    console.log('🏷️ Token info:', { name: tokenName, symbol: tokenSymbol });
    
    savePriceSnapshot(contractAddress, price);
    
    const liquidityUsdFormatted = (parseFloat(bestPair.liquidity?.usd || 0) / 1000000).toFixed(2);
    
    const result = {
      price,
      name: tokenName,
      symbol: tokenSymbol,
      assetType: 'CRYPTO' as const,
      sources: [{
        title: `${bestPair.dexId} (${bestPair.chainId}) - Liq: $${liquidityUsdFormatted}M`,
        url: bestPair.url || `https://dexscreener.com/${bestPair.chainId}/${bestPair.pairAddress}`
      }],
      rawText: `${tokenName} (${tokenSymbol}) - $${price}`
    };
    
    console.log('✅ fetchTokenPriceFromDex SUCCESS:', result);
    return result;
    
  } catch (error: any) {
    console.error('❌ fetchTokenPriceFromDex ERROR:', error);
    throw new Error(error.message || "Failed to fetch price from DEXScreener");
  }
};

// Main fetch function - routes to appropriate API
export const fetchCryptoPrice = async (ticker: string): Promise<PriceResult> => {
  console.log('🔵 ========================================');
  console.log('🔵 fetchCryptoPrice START:', ticker);
  console.log('🔵 ========================================');
  
  // Contract addresses → DEXScreener
  if (isContractAddress(ticker)) {
    console.log('✅ Detected as contract address, using DEXScreener');
    return fetchTokenPriceFromDex(ticker);
  }
  
  // Auto-detect asset type
  const assetType = detectAssetType(ticker);
  console.log('🔍 Auto-detected type:', assetType, 'for ticker:', ticker);
  
  // Stocks → Yahoo Finance
  if (assetType === 'STOCK_US' || assetType === 'STOCK_CH') {
    console.log('📈 Routing to Yahoo Finance (stocks)...');
    return fetchYahooStock(ticker, assetType);
  }
  
  // Crypto → Gemini AI
  console.log('🪙 Routing to Gemini AI (crypto)...');
  
  try {
    const apiKey = localStorage.getItem('gemini_api_key') || '';
    
    if (!apiKey) {
      throw new Error("API key not configured. Please add your API key in settings.");
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `Find the current live market price of the '${ticker}' cryptocurrency token in USD from a reliable source like CoinGecko, CoinMarketCap, or DEXScreener. 
For tokens on Ethereum, verify the contract address if needed.
Return ONLY the current numeric price value in USD. No symbols, no explanations.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "";
    const cleanText = text.replace(/[$,]/g, '').trim();
    const priceMatch = cleanText.match(/[\d]*[.]{0,1}[\d]+/);
    
    let price = priceMatch ? parseFloat(priceMatch[0]) : 0;
    
    if (price <= 0) {
      throw new Error("Could not extract valid price from AI response");
    }
    
    savePriceSnapshot(ticker, price);
    
    const sources: SourceLink[] = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
      .filter(c => c.web && c.web.uri)
      .map(c => ({ title: c.web.title || 'Source', url: c.web.uri }));

    return { 
      price, 
      sources, 
      rawText: text,
      name: ticker,
      symbol: ticker,
      assetType: 'CRYPTO'
    };
  } catch (error: any) {
    console.error('❌ Crypto fetch error:', error);
    throw new Error(error.message || "Failed to fetch crypto price");
  }
};

// Fetch historical data
export const fetchAssetHistory = async (ticker: string, currentPrice?: number, tokenSymbol?: string): Promise<number[][] | undefined> => {
  const assetType = detectAssetType(ticker);
  
  // For stocks, Yahoo Finance already fetched history in fetchYahooStock
  // Just return what's in localStorage
  if (assetType === 'STOCK_US' || assetType === 'STOCK_CH') {
    console.log('📈 Stock history already fetched by Yahoo Finance');
    return loadPriceSnapshots(ticker);
  }
  
  // Contract addresses: try CryptoCompare with symbol, then CoinGecko
  if (isContractAddress(ticker) && tokenSymbol) {
    try {
      const res = await fetch(`https://min-api.cryptocompare.com/data/v2/histoday?fsym=${tokenSymbol.toUpperCase()}&tsym=USD&limit=2000`);
      
      if (res.ok) {
        const json = await res.json();
        
        if (json.Response === 'Success' && json.Data?.Data?.length > 0) {
          const historyData = json.Data.Data
            .map((d: any) => [d.time * 1000, d.close])
            .filter((p: any) => p[1] > 0);
          
          if (historyData.length >= 365) {
            const localSnapshots = loadPriceSnapshots(ticker);
            const merged = mergeHistoryWithSnapshots(historyData, localSnapshots);
            saveHistoricalData(ticker, merged);
            return merged;
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ CryptoCompare fetch failed:', e);
    }
    
    // Try CoinGecko
    try {
      const normalizedAddress = ticker.toLowerCase();
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/ethereum/contract/${normalizedAddress}/market_chart/?vs_currency=usd&days=365`
      );
      
      if (res.ok) {
        const json = await res.json();
        
        if (json.prices && json.prices.length > 0) {
          const apiHistory = json.prices.filter((p: any) => p[1] > 0);
          const localSnapshots = loadPriceSnapshots(ticker);
          const merged = mergeHistoryWithSnapshots(apiHistory, localSnapshots);
          saveHistoricalData(ticker, merged);
          return merged;
        }
      }
    } catch (e) {
      console.warn('⚠️ CoinGecko history fetch failed:', e);
    }
    
    const localSnapshots = loadPriceSnapshots(ticker);
    if (localSnapshots.length > 0) {
      return localSnapshots;
    }
    
    return undefined;
  }
  
  // Regular crypto tickers: use CryptoCompare
  try {
     const res = await fetch(`https://min-api.cryptocompare.com/data/v2/histoday?fsym=${ticker.toUpperCase()}&tsym=USD&limit=2000`);
     if (res.ok) {
        const json = await res.json();
        if (json.Response === 'Success') {
           const apiHistory = json.Data.Data.map((d: any) => [d.time * 1000, d.close]).filter((p: any) => p[1] > 0);
           const localSnapshots = loadPriceSnapshots(ticker);
           const merged = mergeHistoryWithSnapshots(apiHistory, localSnapshots);
           saveHistoricalData(ticker, merged);
           return merged;
        }
     }
  } catch (e) { 
    console.warn(e); 
  }
  
  return undefined;
};