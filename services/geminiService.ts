import { GoogleGenAI } from "@google/genai";
import { SourceLink } from "../types";

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PriceResult {
  price: number;
  sources: SourceLink[];
  rawText: string;
  name?: string;
  symbol?: string;
  assetType?: 'CRYPTO' | 'STOCK_US' | 'STOCK_CH' | 'ETF';
}

const isContractAddress = (input: string): boolean => {
  const lowerInput = input.toLowerCase();
  const result = lowerInput.startsWith('0x') && input.length >= 40;
  return result;
};

// FIXED: Better stock detection with known tickers
const detectAssetType = (ticker: string): 'CRYPTO' | 'STOCK_US' | 'STOCK_CH' | 'ETF' => {
  const upperTicker = ticker.toUpperCase();
  
  // Swiss stocks (SIX exchange)
  if (upperTicker.endsWith('.SW')) {
    console.log(`✅ Swiss stock detected: ${ticker}`);
    return 'STOCK_CH';
  }
  
  // Known major US stocks (expand this list as needed)
  const knownStocks = [
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'TSLA', 'META', 'NVDA', 'AMD', 
    'NFLX', 'DIS', 'V', 'MA', 'JPM', 'BAC', 'WMT', 'PG', 'JNJ', 'UNH', 'HD',
    'CVX', 'XOM', 'PFE', 'KO', 'PEP', 'ABBV', 'MRK', 'COST', 'TMO', 'ABT'
  ];
  
  if (knownStocks.includes(upperTicker)) {
    console.log(`✅ Known US stock detected: ${ticker}`);
    return 'STOCK_US';
  }
  
  // Known crypto tickers
  const cryptoTickers = [
    'BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI', 'ATOM',
    'XRP', 'DOGE', 'SHIB', 'PEPE', 'ARB', 'OP', 'LTC', 'BCH', 'XLM', 'ALGO'
  ];
  
  if (cryptoTickers.includes(upperTicker)) {
    console.log(`✅ Crypto detected: ${ticker}`);
    return 'CRYPTO';
  }
  
  // Pattern: 1-4 uppercase letters = likely stock, 5+ = likely crypto
  if (/^[A-Z]{1,4}$/.test(upperTicker)) {
    console.log(`🔍 Pattern suggests US stock: ${ticker}`);
    return 'STOCK_US';
  }
  
  // Everything else is crypto
  console.log(`🔍 Defaulting to crypto: ${ticker}`);
  return 'CRYPTO';
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

export const fetchTokenPriceFromDex = async (contractAddress: string): Promise<PriceResult> => {
  console.log('🚀 DEXScreener fetch:', contractAddress);
  
  const normalizedAddress = contractAddress.toLowerCase();
  
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${normalizedAddress}`;
    const res = await fetch(url);
    
    if (!res.ok) throw new Error(`DEXScreener API failed with status ${res.status}`);
    
    const data = await res.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      throw new Error('No trading pairs found for this token');
    }
    
    const sortedPairs = data.pairs
      .filter((pair: any) => pair.priceUsd && parseFloat(pair.priceUsd) > 0)
      .sort((a: any, b: any) => {
        const liquidityA = parseFloat(a.liquidity?.usd || 0);
        const liquidityB = parseFloat(b.liquidity?.usd || 0);
        return liquidityB - liquidityA;
      });
    
    if (sortedPairs.length === 0) {
      throw new Error('No valid trading pairs with price data found');
    }
    
    const bestPair = sortedPairs[0];
    const price = parseFloat(String(bestPair.priceUsd));
    
    if (isNaN(price) || price <= 0) {
      throw new Error(`Invalid price data: ${bestPair.priceUsd}`);
    }
    
    const tokenName = bestPair.baseToken?.name || 'Unknown Token';
    const tokenSymbol = bestPair.baseToken?.symbol || contractAddress.slice(0, 8);
    
    savePriceSnapshot(contractAddress, price);
    
    const liquidityUsdFormatted = (parseFloat(bestPair.liquidity?.usd || 0) / 1000000).toFixed(2);
    
    return {
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
    
  } catch (error: any) {
    console.error('❌ DEXScreener error:', error);
    throw new Error(error.message || "Failed to fetch price from DEXScreener");
  }
};

// FIXED: Fetch stock price with CORS-friendly approach
const fetchStockPrice = async (ticker: string, assetType: 'STOCK_US' | 'STOCK_CH'): Promise<PriceResult> => {
  console.log(`📈 Fetching stock: ${ticker} (${assetType})`);
  
  // Try Alpha Vantage FIRST (more reliable, no CORS issues)
  try {
    const apiKey = 'EVGJOHH32QUQXK2X';
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${apiKey}`;
    
    console.log('📡 Fetching from Alpha Vantage:', url);
    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error(`Alpha Vantage returned status ${res.status}`);
    }
    
    const data = await res.json();
    console.log('📊 Alpha Vantage response:', data);
    console.log('📊 Global Quote keys:', Object.keys(data['Global Quote'] || {}));
    
    // Check for rate limit message
    if (data.Note || data['Information']) {
      const msg = data.Note || data['Information'];
      console.error('❌ Alpha Vantage limit/info:', msg);
      throw new Error(`Alpha Vantage: ${msg}`);
    }
    
    // Check for error message
    if (data['Error Message']) {
      console.error('❌ Alpha Vantage error:', data['Error Message']);
      throw new Error(`Alpha Vantage: ${data['Error Message']}`);
    }
    
    if (data['Global Quote'] && data['Global Quote']['05. price']) {
      const price = parseFloat(data['Global Quote']['05. price']);
      
      if (!price || price <= 0) {
        throw new Error('Invalid price from Alpha Vantage');
      }
      
      // Alpha Vantage doesn't provide company name in GLOBAL_QUOTE
      // We need to fetch it from OVERVIEW endpoint
      let companyName = ticker; // Default to ticker
      
      try {
        console.log('📡 Fetching company name from Alpha Vantage OVERVIEW...');
        const overviewUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${apiKey}`;
        const overviewRes = await fetch(overviewUrl);
        
        if (overviewRes.ok) {
          const overviewData = await overviewRes.json();
          console.log('📊 Overview response keys:', Object.keys(overviewData));
          
          if (overviewData.Name) {
            companyName = overviewData.Name;
            console.log(`✅ Got company name: ${companyName}`);
          } else if (overviewData.Note || overviewData['Information']) {
            console.warn('⚠️ OVERVIEW rate limited, keeping ticker name');
          } else {
            console.warn('⚠️ No Name in OVERVIEW response');
          }
        }
      } catch (nameError) {
        console.warn('⚠️ Failed to fetch company name, using ticker:', nameError);
      }
      
      savePriceSnapshot(ticker, price);
      
      console.log(`✅ Alpha Vantage SUCCESS: ${ticker} = $${price} (${companyName})`);
      
      return {
        price,
        name: companyName,
        symbol: ticker,
        assetType,
        sources: [{
          title: 'Alpha Vantage',
          url: `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}`
        }],
        rawText: `${companyName} (${ticker}) - $${price}`
      };
    } else if (data.Note) {
      // API rate limit hit
      console.error('❌ Alpha Vantage rate limit:', data.Note);
      throw new Error('Alpha Vantage rate limit exceeded - please wait a minute');
    } else {
      throw new Error('Invalid Alpha Vantage response structure');
    }
  } catch (avError: any) {
    console.error('❌ Alpha Vantage failed:', avError);
    
    // Fallback to Yahoo Finance with CORS proxy
    try {
      console.log('⚠️ Trying Yahoo Finance as fallback...');
      
      // CORS PROXY: Use allorigins.win to bypass CORS restrictions
      const yahooUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}`;
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(yahooUrl)}`;
      
      console.log('📡 Using CORS proxy for Yahoo Finance...');
      const res = await fetch(proxyUrl);
      
      if (!res.ok) {
        throw new Error(`CORS proxy returned status ${res.status}`);
      }
      
      const proxyData = await res.json();
      const data = JSON.parse(proxyData.contents);
      
      if (data.chart?.result?.[0]) {
        const result = data.chart.result[0];
        const price = result.meta?.regularMarketPrice;
        
        let companyName = ticker;
        
        if (result.meta?.longName) {
          companyName = result.meta.longName;
        } else if (result.meta?.shortName) {
          companyName = result.meta.shortName;
        }
        
        if (price && price > 0) {
          savePriceSnapshot(ticker, price);
          
          console.log(`✅ Yahoo Finance SUCCESS (via CORS proxy): ${companyName} = $${price}`);
          
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
        }
      }
      
      throw new Error('Invalid Yahoo Finance response');
    } catch (yahooError: any) {
      console.error('❌ Yahoo Finance also failed:', yahooError);
      throw new Error(`Failed to fetch stock price: ${avError.message}. Please check ticker symbol.`);
    }
  }
};

export const fetchCryptoPrice = async (ticker: string): Promise<PriceResult> => {
  console.log('🔵 ========================================');
  console.log('🔵 fetchCryptoPrice START:', ticker);
  console.log('🔵 ========================================');
  
  // Contract addresses go to DEXScreener
  if (isContractAddress(ticker)) {
    console.log('✅ Contract address detected → DEXScreener');
    return fetchTokenPriceFromDex(ticker);
  }
  
  // Auto-detect asset type
  const assetType = detectAssetType(ticker);
  console.log(`🔍 Auto-detected type: ${assetType} for ticker: ${ticker}`);
  
  // Stocks use Yahoo Finance / Alpha Vantage
  if (assetType === 'STOCK_US' || assetType === 'STOCK_CH') {
    console.log(`📈 Routing to stock API...`);
    const result = await fetchStockPrice(ticker, assetType);
    console.log('✅ Stock price result:', result);
    return result;
  }
  
  // Crypto uses Gemini AI with grounding
  console.log(`🪙 Routing to crypto API (Gemini AI)...`);
  try {
    const apiKey = localStorage.getItem('gemini_api_key') || '';
    
    if (!apiKey) {
      throw new Error("API key not configured");
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `What is the current USD price of ${ticker} cryptocurrency? Return only the numeric price, no currency symbols.`;

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
      throw new Error("Could not extract valid price");
    }
    
    savePriceSnapshot(ticker, price);
    
    const sources: SourceLink[] = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
      .filter(c => c.web && c.web.uri)
      .map(c => ({ title: c.web.title || 'Source', url: c.web.uri }));

    const result = { 
      price, 
      name: ticker, // Just use ticker for crypto
      symbol: ticker,
      assetType: 'CRYPTO' as const,
      sources, 
      rawText: text 
    };
    
    console.log('✅ Crypto price result:', result);
    return result;
  } catch (error: any) {
    console.error('❌ Crypto fetch error:', error);
    throw new Error(error.message || "Failed to fetch crypto price");
  }
};

// Fetch historical data for stocks
const fetchStockHistory = async (ticker: string): Promise<number[][] | undefined> => {
  console.log(`📈 Fetching stock history: ${ticker}`);
  
  try {
    const apiKey = 'EVGJOHH32QUQXK2X';
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=full&apikey=${apiKey}`;
    
    console.log('📡 Calling Alpha Vantage for historical data...');
    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error(`Alpha Vantage returned ${res.status}`);
    }
    
    const data = await res.json();
    console.log('📊 History API response keys:', Object.keys(data));
    
    // Check for rate limit
    if (data.Note || data['Information']) {
      console.warn('⚠️ Alpha Vantage rate limit (history):', data.Note || data['Information']);
      return undefined;
    }
    
    // Check for error
    if (data['Error Message']) {
      console.warn('⚠️ Alpha Vantage error (history):', data['Error Message']);
      return undefined;
    }
    
    if (data['Time Series (Daily)']) {
      const timeSeries = data['Time Series (Daily)'];
      const historyData: [number, number][] = [];
      
      for (const [dateStr, values] of Object.entries(timeSeries)) {
        const timestamp = new Date(dateStr).getTime();
        const close = parseFloat((values as any)['4. close']);
        
        if (!isNaN(close) && close > 0) {
          historyData.push([timestamp, close]);
        }
      }
      
      historyData.sort((a, b) => a[0] - b[0]);
      
      console.log(`✅ Fetched ${historyData.length} days of history`);
      
      const localSnapshots = loadPriceSnapshots(ticker);
      const merged = mergeHistoryWithSnapshots(historyData, localSnapshots);
      saveHistoricalData(ticker, merged);
      
      console.log(`✅ Saved ${merged.length} total data points to localStorage`);
      
      return merged;
    } else {
      console.warn('⚠️ No "Time Series (Daily)" in response');
      return undefined;
    }
    
  } catch (error) {
    console.error('❌ Stock history fetch failed:', error);
    return undefined;
  }
};

export const fetchAssetHistory = async (ticker: string, currentPrice?: number, tokenSymbol?: string): Promise<number[][] | undefined> => {
  // Detect asset type
  const assetType = detectAssetType(ticker);
  
  // Stocks use Alpha Vantage
  if (assetType === 'STOCK_US' || assetType === 'STOCK_CH') {
    return fetchStockHistory(ticker);
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
      console.warn('CryptoCompare failed:', e);
    }
  }
  
  // Contract addresses: CoinGecko fallback
  if (isContractAddress(ticker)) {
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
      console.warn('CoinGecko failed:', e);
    }
    
    // Return local snapshots if we have them
    const localSnapshots = loadPriceSnapshots(ticker);
    if (localSnapshots.length > 0) {
      return localSnapshots;
    }
    
    return undefined;
  }
  
  // Regular crypto: CryptoCompare
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
    console.warn('Crypto history failed:', e);
  }
  
  return undefined;
};