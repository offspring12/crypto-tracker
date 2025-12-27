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
  console.log('🔍 isContractAddress check:', { input, lowerInput, startsWithOx: lowerInput.startsWith('0x'), length: input.length, result });
  return result;
};

// Detect if ticker is a stock (ends with .SW for Swiss, or is a known stock ticker)
const detectAssetType = (ticker: string): 'CRYPTO' | 'STOCK_US' | 'STOCK_CH' | 'ETF' => {
  const upperTicker = ticker.toUpperCase();
  
  // Swiss stocks (SIX exchange)
  if (upperTicker.endsWith('.SW')) {
    return 'STOCK_CH';
  }
  
  // Common stock patterns (4 or fewer letters, no numbers)
  if (/^[A-Z]{1,5}$/.test(upperTicker)) {
    // Common crypto tickers to exclude
    const cryptoTickers = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI', 'ATOM'];
    if (cryptoTickers.includes(upperTicker)) {
      return 'CRYPTO';
    }
    
    // Otherwise assume it's a US stock
    return 'STOCK_US';
  }
  
  // Default to crypto for everything else
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
      rawText: `${tokenName} (${tokenSymbol}) - $${price} from ${bestPair.dexId} on ${bestPair.chainId}`
    };
    
    console.log('✅ fetchTokenPriceFromDex SUCCESS:', result);
    return result;
    
  } catch (error: any) {
    console.error('❌ fetchTokenPriceFromDex ERROR:', error);
    throw new Error(error.message || "Failed to fetch price from DEXScreener");
  }
};

// Fetch stock price and company name using Alpha Vantage (free tier: 25 requests/day)
const fetchStockPrice = async (ticker: string, assetType: 'STOCK_US' | 'STOCK_CH'): Promise<PriceResult> => {
  console.log(`📈 Fetching stock price for ${ticker} (${assetType})`);
  
  // For Swiss stocks, use the .SW ticker directly
  const searchTicker = ticker;
  
  try {
    // Alpha Vantage API - Free tier: 25 requests/day, 500 requests/month
    const apiKey = 'EVGJOHH32QUQXK2X'; // User's API key
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${searchTicker}&apikey=${apiKey}`;
    
    console.log('📡 Fetching from Alpha Vantage:', url);
    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error(`Alpha Vantage API failed with status ${res.status}`);
    }
    
    const data = await res.json();
    console.log('✅ Alpha Vantage response:', data);
    
    if (data['Global Quote'] && data['Global Quote']['05. price']) {
      const price = parseFloat(data['Global Quote']['05. price']);
      const companyName = data['Global Quote']['01. symbol'] || ticker;
      
      savePriceSnapshot(ticker, price);
      
      return {
        price,
        name: companyName,
        symbol: ticker,
        assetType,
        sources: [{
          title: 'Alpha Vantage',
          url: `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${searchTicker}&apikey=${apiKey}`
        }],
        rawText: `${companyName} (${ticker}) - $${price}`
      };
    } else {
      throw new Error('Invalid response from Alpha Vantage');
    }
  } catch (error) {
    console.warn('⚠️ Alpha Vantage failed, falling back to Gemini AI:', error);
    // Fallback to Gemini AI for stocks
    return fetchCryptoPriceViaGemini(ticker, assetType);
  }
};

// Fallback: Use Gemini AI for stocks (original method)
const fetchCryptoPriceViaGemini = async (ticker: string, assetType?: 'CRYPTO' | 'STOCK_US' | 'STOCK_CH' | 'ETF'): Promise<PriceResult> => {
  console.log('📍 Using Gemini AI for:', ticker);
  
  try {
    const apiKey = localStorage.getItem('gemini_api_key') || '';
    
    if (!apiKey) {
      throw new Error("API key not configured. Please add your API key in settings.");
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const assetTypeHint = assetType === 'STOCK_US' || assetType === 'STOCK_CH' 
      ? `stock ticker ${ticker}` 
      : `cryptocurrency token '${ticker}'`;
    
    const prompt = `Find the current live market price of the ${assetTypeHint} in USD from a reliable source like CoinGecko, CoinMarketCap, Yahoo Finance, or Google Finance.
${assetType === 'STOCK_US' || assetType === 'STOCK_CH' ? 'Also provide the full company name.' : ''}
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

    // Extract company name from grounding metadata if available
    let companyName = ticker;
    if (assetType === 'STOCK_US' || assetType === 'STOCK_CH') {
      const nameMatch = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Inc|Corp|Ltd|S\.A\.|AG|plc)\.?)?)/);
      if (nameMatch) {
        companyName = nameMatch[0];
      }
    }

    return { 
      price, 
      name: companyName,
      symbol: ticker,
      assetType: assetType || 'CRYPTO',
      sources, 
      rawText: text 
    };
  } catch (error: any) {
    throw new Error(error.message || "Failed to fetch price");
  }
};

export const fetchCryptoPrice = async (ticker: string): Promise<PriceResult> => {
  console.log('🔵 fetchCryptoPrice called with ticker:', ticker);
  
  if (isContractAddress(ticker)) {
    console.log('✅ Detected as contract address, using DEXScreener');
    return fetchTokenPriceFromDex(ticker);
  }
  
  // Auto-detect asset type
  const assetType = detectAssetType(ticker);
  console.log(`🔍 Detected asset type: ${assetType}`);
  
  // Use Alpha Vantage for stocks (better historical data support)
  if (assetType === 'STOCK_US' || assetType === 'STOCK_CH') {
    return fetchStockPrice(ticker, assetType);
  }
  
  // Use Gemini AI for crypto
  return fetchCryptoPriceViaGemini(ticker, assetType);
};

// Fetch historical data for stocks using Alpha Vantage
const fetchStockHistory = async (ticker: string): Promise<number[][] | undefined> => {
  console.log(`📈 Fetching stock history for ${ticker}`);
  
  try {
    const apiKey = 'EVGJOHH32QUQXK2X'; // User's API key
    // outputsize=full returns 20+ years of data (vs compact = 100 days only)
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=full&apikey=${apiKey}`;
    
    console.log('📡 Fetching full stock history from Alpha Vantage...');
    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error(`Alpha Vantage API returned status ${res.status}`);
    }
    
    const data = await res.json();
    
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
      
      // Sort by timestamp ascending
      historyData.sort((a, b) => a[0] - b[0]);
      
      console.log(`✅ Fetched ${historyData.length} days of stock history`);
      
      const localSnapshots = loadPriceSnapshots(ticker);
      const merged = mergeHistoryWithSnapshots(historyData, localSnapshots);
      saveHistoricalData(ticker, merged);
      
      return merged;
    } else {
      console.warn('⚠️ No time series data in Alpha Vantage response');
      return undefined;
    }
  } catch (error) {
    console.warn('⚠️ Failed to fetch stock history from Alpha Vantage:', error);
    return undefined;
  }
};

export const fetchAssetHistory = async (ticker: string, currentPrice?: number, tokenSymbol?: string): Promise<number[][] | undefined> => {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const daysThreshold = 365;
  
  // Detect asset type
  const assetType = detectAssetType(ticker);
  
  // For stocks, use Alpha Vantage
  if (assetType === 'STOCK_US' || assetType === 'STOCK_CH') {
    return fetchStockHistory(ticker);
  }
  
  // For contract addresses with a known symbol, try CryptoCompare first
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
              console.log(`✅ CryptoCompare has ${historyData.length} days - using it (no price verification)`);
              const localSnapshots = loadPriceSnapshots(ticker);
              const merged = mergeHistoryWithSnapshots(historyData, localSnapshots);
              saveHistoricalData(ticker, merged);
              return merged;
            }
          } else {
            console.log(`⚠️ CryptoCompare only has ${historyData.length} days (< 365) - trying CoinGecko for better coverage`);
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
    
    const localSnapshots = loadPriceSnapshots(ticker);
    if (localSnapshots.length > 0) {
      console.log(`📦 Using ${localSnapshots.length} local snapshots only`);
      return localSnapshots;
    }
    
    return undefined;
  }
  
  // For regular crypto tickers, use CryptoCompare directly
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