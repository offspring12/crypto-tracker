import { GoogleGenAI } from "@google/genai";
import { SourceLink, Currency, AssetType } from "../types";

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PriceResult {
  price: number;
  sources: SourceLink[];
  rawText: string;
  name?: string;
  symbol?: string;
  assetType?: AssetType;
  currency?: Currency; // NEW: Currency for the asset (USD, CHF, EUR, etc.)
}

const isContractAddress = (input: string): boolean => {
  const lowerInput = input.toLowerCase();
  const result = lowerInput.startsWith('0x') && input.length >= 40;
  console.log('🔍 isContractAddress check:', { input, lowerInput, startsWithOx: lowerInput.startsWith('0x'), length: input.length, result });
  return result;
};

// CORRECTED: Proper asset type detection with crypto list FIRST
const detectAssetType = (ticker: string): AssetType => {
  const upperTicker = ticker.toUpperCase();
  
  // CASH: Fiat currency codes (3-letter ISO codes) + stablecoins
  const cashCurrencies = ['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'USDT', 'USDC'];
  if (cashCurrencies.includes(upperTicker)) {
    console.log(`✅ Cash/Currency detected: ${ticker}`);
    return 'CASH';
  }
  
  // German stocks (Frankfurt/X exchange)
  if (upperTicker.endsWith('.DE')) {
    console.log(`✅ German stock detected: ${ticker}`);
    return 'STOCK_DE';
  }
  
  // Swiss stocks (SIX exchange)
  if (upperTicker.endsWith('.SW')) {
    console.log(`✅ Swiss stock detected: ${ticker}`);
    return 'STOCK_CH';
  }
  
  // UK stocks (London exchange)
  if (upperTicker.endsWith('.L')) {
    console.log(`✅ UK stock detected: ${ticker}`);
    return 'STOCK_UK';
  }
  
  // Japan stocks (Tokyo exchange)
  if (upperTicker.endsWith('.T')) {
    console.log(`✅ Japan stock detected: ${ticker}`);
    return 'STOCK_JP';
  }
  
  // PRIORITY 1: Known crypto tickers (check BEFORE stock patterns!)
  const cryptoTickers = [
    'BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI', 'ATOM',
    'XRP', 'DOGE', 'SHIB', 'PEPE', 'ARB', 'OP', 'LTC', 'BCH', 'XLM', 'ALGO',
    'DAI', 'BNB', 'BUSD', 'FTM', 'NEAR', 'ICP', 'APT', 'SUI'
  ];
  
  if (cryptoTickers.includes(upperTicker)) {
    console.log(`✅ Known crypto detected: ${ticker}`);
    return 'CRYPTO';
  }
  
  // PRIORITY 2: Known major US stocks
  const knownStocks = [
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'TSLA', 'META', 'NVDA', 'AMD', 
    'NFLX', 'DIS', 'V', 'MA', 'JPM', 'BAC', 'WMT', 'PG', 'JNJ', 'UNH', 'HD',
    'CVX', 'XOM', 'PFE', 'KO', 'PEP', 'ABBV', 'MRK', 'COST', 'TMO', 'ABT',
    'PYPL', 'ADBE', 'INTC', 'CSCO', 'AVGO', 'TXN', 'QCOM', 'AMGN',
    'SBUX', 'MCD', 'NKE', 'BA', 'CAT', 'MMM', 'GE', 'IBM', 'F', 'GM'
  ];
  
  if (knownStocks.includes(upperTicker)) {
    console.log(`✅ Known US stock detected: ${ticker}`);
    return 'STOCK_US';
  }
  
  // PRIORITY 3: Pattern matching (1-4 letters could be stock)
  // BUT only if not already identified as crypto above
  if (/^[A-Z]{1,4}$/.test(upperTicker)) {
    console.log(`🔍 Auto-detected type: STOCK_US for ticker: ${ticker}`);
    return 'STOCK_US';
  }
  
  // Default to crypto for longer tickers
  console.log(`🔍 Defaulting to crypto: ${ticker}`);
  return 'CRYPTO';
};

// Save price snapshot to localStorage
const savePriceSnapshot = (ticker: string, price: number, currency: Currency = 'USD') => {
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
      console.log(`💾 Saved price snapshot for ${ticker}: ${price} ${currency}`);
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

// Fetch stock price AND history from Yahoo Finance
const fetchYahooStock = async (ticker: string, assetType: 'STOCK_US' | 'STOCK_CH' | 'STOCK_DE' | 'STOCK_UK' | 'STOCK_JP'): Promise<PriceResult> => {
  console.log(`📈 Fetching stock from Yahoo Finance: ${ticker} (${assetType})`);
  
  const yahooUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;
  
  // Try multiple CORS proxies
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
        continue;
      }
      
      let data;
      
      // allorigins.win wraps response
      if (proxyName === 'allorigins.win') {
        const proxyData = await res.json();
        data = JSON.parse(proxyData.contents);
      } else {
        data = await res.json();
      }
      
      if (!data.chart?.result?.[0]) {
        console.warn(`⚠️ Invalid response from ${proxyName}`);
        continue;
      }
      
      const result = data.chart.result[0];
      const price = result.meta?.regularMarketPrice;
      
      if (!price || price <= 0) {
        console.warn(`⚠️ Invalid price from ${proxyName}`);
        continue;
      }
      
      // Get company name
      let companyName = ticker;
      if (result.meta?.longName) {
        companyName = result.meta.longName;
      } else if (result.meta?.shortName) {
        companyName = result.meta.shortName;
      }
      
      // Determine currency based on asset type
      let currency: Currency = 'USD'; // Default for STOCK_US
      if (assetType === 'STOCK_CH') {
        currency = 'CHF';
      } else if (assetType === 'STOCK_DE') {
        currency = 'EUR';
      } else if (assetType === 'STOCK_UK') {
        currency = 'GBP';
      } else if (assetType === 'STOCK_JP') {
        currency = 'JPY';
      }
      
      console.log(`✅ Yahoo Finance SUCCESS (via ${proxyName}): ${companyName} = ${price} ${currency}`);
      
      savePriceSnapshot(ticker, price, currency);
      
      // Extract historical data
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      
      if (timestamps.length > 0 && closes.length > 0) {
        const historyData: [number, number][] = [];
        
        for (let i = 0; i < timestamps.length; i++) {
          const timestamp = timestamps[i] * 1000;
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
        currency, // ✅ NEW: Currency field based on stock exchange
        sources: [{
          title: 'Yahoo Finance',
          url: `https://finance.yahoo.com/quote/${ticker}`
        }],
        rawText: `${companyName} (${ticker}) - ${price} ${currency}`
      };
      
    } catch (error: any) {
      console.warn(`❌ Proxy ${proxyName} failed:`, error.message);
      if (i === corsProxies.length - 1) {
        throw new Error(`All CORS proxies failed. Last error: ${error.message}`);
      }
    }
  }
  
  throw new Error('All CORS proxies failed to fetch Yahoo Finance data');
};

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
    
    savePriceSnapshot(contractAddress, price, 'USD');
    
    const liquidityUsdFormatted = (parseFloat(bestPair.liquidity?.usd || 0) / 1000000).toFixed(2);
    
    const result = {
      price,
      name: tokenName,
      symbol: tokenSymbol,
      currency: 'USD' as Currency, // DEX prices are always in USD
      sources: [{
        title: `${bestPair.dexId} (${bestPair.chainId}) - Liq: $${liquidityUsdFormatted}M`,
        url: bestPair.url || `https://dexscreener.com/${bestPair.chainId}/${bestPair.pairAddress}`
      }],
      rawText: `${tokenName} (${tokenSymbol}) - $${price} from ${bestPair.dexId} on ${bestPair.chainId}`
    };
    
    console.log('✅ fetchTokenPriceFromDex SUCCESS:', result);
    return result;
    
  } catch (error: any) {
    console.error('❌ fetchTokenPriceFromDex ERROR:', error);
    throw new Error(error.message || "Failed to fetch price from DEXScreener");
  }
};

export const fetchCryptoPrice = async (ticker: string): Promise<PriceResult> => {
  console.log('🔵 ========================================');
  console.log('🔵 fetchCryptoPrice START:', ticker);
  console.log('🔵 ========================================');
  
  // Contract addresses → DEXScreener
  if (isContractAddress(ticker)) {
    console.log('✅ Detected as contract address, using DEXScreener');
    return fetchTokenPriceFromDex(ticker);
  }
  
  // Detect asset type
  const assetType = detectAssetType(ticker);
  
  // CASH → Return 1.0 (cash is always 1:1 in its own currency)
  if (assetType === 'CASH') {
    console.log('💵 Cash asset detected, returning price = 1.0');
    const currencyNames: Record<string, string> = {
      'USD': 'US Dollar',
      'EUR': 'Euro',
      'CHF': 'Swiss Franc',
      'GBP': 'British Pound',
      'JPY': 'Japanese Yen',
      'CAD': 'Canadian Dollar',
      'AUD': 'Australian Dollar',
      'NZD': 'New Zealand Dollar',
      'SEK': 'Swedish Krona',
      'NOK': 'Norwegian Krone',
      'DKK': 'Danish Krone',
      'USDT': 'Tether USD',
      'USDC': 'USD Coin'
    };
    
    const tickerUpper = ticker.toUpperCase();
    
    return {
      price: 1.0,
      name: currencyNames[tickerUpper] || tickerUpper,
      symbol: tickerUpper,
      assetType: 'CASH',
      currency: tickerUpper as Currency, // ✅ NEW: Cash currency is the ticker itself
      sources: [{
        title: 'Cash/Currency',
        url: '#'
      }],
      rawText: `${currencyNames[tickerUpper] || ticker} - Cash Asset`
    };
  }
  
  // Stocks → Yahoo Finance
  if (assetType === 'STOCK_US' || assetType === 'STOCK_CH' || assetType === 'STOCK_DE' || assetType === 'STOCK_UK' || assetType === 'STOCK_JP') {
    console.log('📈 Routing to Yahoo Finance (stocks)...');
    return fetchYahooStock(ticker, assetType);
  }
  
  // Crypto → Gemini AI
  console.log('📍 Routing to Gemini AI (crypto)...');
  
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
    
    savePriceSnapshot(ticker, price, 'USD');
    
    const sources: SourceLink[] = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
      .filter(c => c.web && c.web.uri)
      .map(c => ({ title: c.web.title || 'Source', url: c.web.uri }));

    return { 
      price, 
      sources, 
      rawText: text, 
      assetType: 'CRYPTO',
      currency: 'USD' // Crypto prices are in USD
    };
  } catch (error: any) {
    throw new Error(error.message || "Failed to fetch price");
  }
};

export const fetchAssetHistory = async (ticker: string, currentPrice?: number, tokenSymbol?: string, assetType?: string): Promise<number[][] | undefined> => {
  // For stocks, history was already fetched with price!
  if (assetType === 'STOCK_US' || assetType === 'STOCK_CH' || assetType === 'STOCK_DE' || assetType === 'STOCK_UK' || assetType === 'STOCK_JP') {
    console.log(`📦 Stock history already saved for ${ticker}, loading from localStorage`);
    return loadPriceSnapshots(ticker);
  }
  
  // For crypto, continue with existing logic
  const oneDayMs = 24 * 60 * 60 * 1000;
  const daysThreshold = 365;
  
  // For contract addresses with known symbol, try CryptoCompare first
  if (isContractAddress(ticker) && tokenSymbol) {
    try {
      console.log(`📈 Trying CryptoCompare for DEX token symbol: ${tokenSymbol}`);
      
      const res = await fetch(`https://min-api.cryptocompare.com/data/v2/histoday?fsym=${tokenSymbol.toUpperCase()}&tsym=USD&limit=2000`);
      
      if (res.ok) {
        const json = await res.json();
        
        if (json.Response === 'Success' && json.Data?.Data?.length > 0) {
          const historyData = json.Data.Data
            .map((d: any) => [d.time * 1000, d.close])
            .filter((p: any) => p[1] > 0);
          
          console.log(`📊 CryptoCompare returned ${historyData.length} data points`);
          
          if (historyData.length >= daysThreshold) {
            if (currentPrice && historyData.length > 0) {
              const latestHistoricalPrice = historyData[historyData.length - 1][1];
              const priceRatio = latestHistoricalPrice / currentPrice;
              
              console.log(`🔍 Price verification: Historical=${latestHistoricalPrice}, Current=${currentPrice}, Ratio=${priceRatio}`);
              
              if (priceRatio >= 0.5 && priceRatio <= 2.0) {
                console.log(`✅ CryptoCompare has ${historyData.length} days - using it!`);
                const localSnapshots = loadPriceSnapshots(ticker);
                const merged = mergeHistoryWithSnapshots(historyData, localSnapshots);
                saveHistoricalData(ticker, merged);
                return merged;
              } else {
                console.warn(`⚠️ Price mismatch - trying CoinGecko instead`);
              }
            } else {
              console.log(`✅ CryptoCompare has ${historyData.length} days - using it`);
              const localSnapshots = loadPriceSnapshots(ticker);
              const merged = mergeHistoryWithSnapshots(historyData, localSnapshots);
              saveHistoricalData(ticker, merged);
              return merged;
            }
          } else {
            console.log(`⚠️ CryptoCompare only has ${historyData.length} days`);
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ CryptoCompare fetch failed:', e);
    }
  }
  
  // For contract addresses, try CoinGecko
  if (isContractAddress(ticker)) {
    try {
      const normalizedAddress = ticker.toLowerCase();
      console.log('📈 Fetching history from CoinGecko (365 days):', normalizedAddress);
      
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/ethereum/contract/${normalizedAddress}/market_chart/?vs_currency=usd&days=365`
      );
      
      if (res.ok) {
        const json = await res.json();
        console.log('✅ CoinGecko history received:', json.prices?.length, 'data points');
        
        if (json.prices && json.prices.length > 0) {
          const apiHistory = json.prices.filter((p: any) => p[1] > 0);
          const localSnapshots = loadPriceSnapshots(ticker);
          const merged = mergeHistoryWithSnapshots(apiHistory, localSnapshots);
          saveHistoricalData(ticker, merged);
          return merged;
        }
      } else {
        console.warn('⚠️ CoinGecko API returned status:', res.status);
      }
    } catch (e) {
      console.warn('⚠️ CoinGecko history fetch failed:', e);
    }
    
    // Fallback to local snapshots
    const localSnapshots = loadPriceSnapshots(ticker);
    if (localSnapshots.length > 0) {
      console.log(`📦 Using ${localSnapshots.length} local snapshots only`);
      return localSnapshots;
    }
    
    return undefined;
  }
  
  // For regular crypto tickers, use CryptoCompare
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
  } catch (e) { console.warn(e); }
  return undefined;
};