import { GoogleGenAI } from "@google/genai";
import { SourceLink } from "../types";

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PriceResult {
  price: number;
  sources: SourceLink[];
  rawText: string;
  name?: string;
  symbol?: string;
  assetType?: 'CRYPTO' | 'STOCK' | 'ETF' | 'CASH';
  currency?: 'USD' | 'CHF' | 'EUR';
}

interface ExchangeRates {
  CHF_USD: number;
  EUR_USD: number;
}

// Exchange rate cache (1 hour)
let exchangeRateCache: { rates: ExchangeRates; timestamp: number } | null = null;
const CACHE_DURATION = 60 * 60 * 1000;

const isContractAddress = (input: string): boolean => {
  const lowerInput = input.toLowerCase();
  return lowerInput.startsWith('0x') && input.length >= 40;
};

const KNOWN_CRYPTOS = [
  'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'SOL', 'DOT', 'MATIC', 'LTC',
  'AVAX', 'LINK', 'UNI', 'ATOM', 'XLM', 'ALGO', 'VET', 'ICP', 'FIL', 'HBAR'
];

const STABLECOINS_USD = ['USD', 'USDT', 'USDC', 'DAI', 'BUSD', 'UST', 'TUSD', 'USDP'];
const FIAT_CURRENCIES = ['CHF', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];

export const detectAssetType = (ticker: string): { assetType: 'CRYPTO' | 'STOCK' | 'CASH'; currency: 'USD' | 'CHF' | 'EUR' } => {
  const upperTicker = ticker.toUpperCase();
  
  if (isContractAddress(ticker)) return { assetType: 'CRYPTO', currency: 'USD' };
  if (upperTicker.endsWith('.SW')) return { assetType: 'STOCK', currency: 'CHF' };
  if (upperTicker.endsWith('.DE')) return { assetType: 'STOCK', currency: 'EUR' };
  if (STABLECOINS_USD.includes(upperTicker)) return { assetType: 'CASH', currency: 'USD' };
  if (upperTicker === 'CHF') return { assetType: 'CASH', currency: 'CHF' };
  if (upperTicker === 'EUR') return { assetType: 'CASH', currency: 'EUR' };
  if (KNOWN_CRYPTOS.includes(upperTicker)) return { assetType: 'CRYPTO', currency: 'USD' };
  
  return { assetType: 'STOCK', currency: 'USD' };
};

export const fetchExchangeRates = async (): Promise<ExchangeRates> => {
  const now = Date.now();
  
  if (exchangeRateCache && (now - exchangeRateCache.timestamp) < CACHE_DURATION) {
    console.log('💱 Using cached exchange rates:', exchangeRateCache.rates);
    return exchangeRateCache.rates;
  }
  
  try {
    console.log('💱 Fetching fresh exchange rates...');
    const response = await fetch('https://api.exchangerate-api.io/v4/latest/USD');
    
    if (!response.ok) throw new Error('Exchange rate API failed');
    
    const data = await response.json();
    const rates: ExchangeRates = {
      CHF_USD: data.rates.CHF || 0.88,
      EUR_USD: data.rates.EUR || 0.92
    };
    
    exchangeRateCache = { rates, timestamp: now };
    console.log('💱 Fresh exchange rates fetched:', rates);
    return rates;
  } catch (error) {
    console.error('⚠️ Failed to fetch exchange rates, using fallback:', error);
    return { CHF_USD: 0.88, EUR_USD: 0.92 };
  }
};

export const convertCurrency = async (amount: number, fromCurrency: 'USD' | 'CHF' | 'EUR'): Promise<number> => {
  if (fromCurrency === 'USD') return amount;
  
  const rates = await fetchExchangeRates();
  
  if (fromCurrency === 'CHF') {
    const usdAmount = amount / rates.CHF_USD;
    console.log(`💱 Converted ${amount} CHF to ${usdAmount.toFixed(2)} USD (rate: ${rates.CHF_USD})`);
    return usdAmount;
  }
  
  if (fromCurrency === 'EUR') {
    const usdAmount = amount / rates.EUR_USD;
    console.log(`💱 Converted ${amount} EUR to ${usdAmount.toFixed(2)} USD (rate: ${rates.EUR_USD})`);
    return usdAmount;
  }
  
  return amount;
};

const savePriceSnapshot = (ticker: string, price: number) => {
  try {
    const key = `price_snapshots_${ticker}`;
    const existing = localStorage.getItem(key);
    const snapshots: [number, number][] = existing ? JSON.parse(existing) : [];
    const now = Date.now();
    const lastSnapshot = snapshots[snapshots.length - 1];
    
    if (!lastSnapshot || (now - lastSnapshot[0]) > 24 * 60 * 60 * 1000) {
      snapshots.push([now, price]);
      if (snapshots.length > 2000) snapshots.shift();
      localStorage.setItem(key, JSON.stringify(snapshots));
    }
  } catch (e) {}
};

const loadPriceSnapshots = (ticker: string): [number, number][] => {
  try {
    const key = `price_snapshots_${ticker}`;
    const existing = localStorage.getItem(key);
    return existing ? JSON.parse(existing) : [];
  } catch (e) {
    return [];
  }
};

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

const saveHistoricalData = (ticker: string, historyData: [number, number][]) => {
  try {
    const key = `price_snapshots_${ticker}`;
    localStorage.setItem(key, JSON.stringify(historyData));
  } catch (e) {}
};

export const fetchStockPrice = async (ticker: string): Promise<PriceResult> => {
  console.log('📈 fetchStockPrice called with:', ticker);
  
  try {
    // Try Yahoo Finance with CORS proxy
    const corsProxy = 'https://api.allorigins.win/raw?url=';
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const url = corsProxy + encodeURIComponent(yahooUrl);
    
    console.log('📡 Fetching from Yahoo Finance (via CORS proxy):', ticker);
    
    const response = await fetch(url);
    console.log('📥 Yahoo Finance response status:', response.status, response.ok);
    
    if (!response.ok) {
      throw new Error(`Yahoo Finance returned status ${response.status}`);
    }
    
    const data = await response.json();
    console.log('📊 Yahoo Finance raw data:', data);
    
    if (!data.chart?.result?.[0]?.meta) {
      console.error('❌ Invalid Yahoo Finance response structure');
      throw new Error('Invalid Yahoo Finance response');
    }
    
    const meta = data.chart.result[0].meta;
    const price = meta.regularMarketPrice;
    const currency = meta.currency || 'USD';
    const symbol = meta.symbol || ticker;
    const name = meta.longName || meta.shortName || ticker;
    
    console.log('💰 Stock data extracted:', { ticker, price, currency, name, symbol });
    
    if (!price || price <= 0 || isNaN(price)) {
      throw new Error('Invalid price from Yahoo Finance');
    }
    
    const detected = detectAssetType(ticker);
    console.log('🔍 Detected asset type:', detected);
    
    let priceInUSD = price;
    let conversionNote = '';
    
    if (currency === 'CHF' || detected.currency === 'CHF') {
      console.log(`💱 Converting ${price} CHF to USD...`);
      priceInUSD = await convertCurrency(price, 'CHF');
      conversionNote = ` (converted from ${price.toFixed(2)} CHF)`;
      console.log(`✅ Converted: ${price} CHF → ${priceInUSD.toFixed(2)} USD`);
    } else if (currency === 'EUR' || detected.currency === 'EUR') {
      console.log(`💱 Converting ${price} EUR to USD...`);
      priceInUSD = await convertCurrency(price, 'EUR');
      conversionNote = ` (converted from ${price.toFixed(2)} EUR)`;
      console.log(`✅ Converted: ${price} EUR → ${priceInUSD.toFixed(2)} USD`);
    }
    
    savePriceSnapshot(ticker, priceInUSD);
    
    const result = {
      price: priceInUSD,
      name,
      symbol,
      assetType: 'STOCK' as const,
      currency: detected.currency,
      sources: [{ 
        title: `Yahoo Finance (${currency})${conversionNote}`, 
        url: `https://finance.yahoo.com/quote/${ticker}` 
      }],
      rawText: `${name} - $${priceInUSD.toFixed(2)} from ${currency}${conversionNote}`
    };
    
    console.log('✅ fetchStockPrice SUCCESS:', result);
    return result;
    
  } catch (error: any) {
    console.error('❌ Yahoo Finance failed, trying Gemini AI fallback...', error.message);
    
    // Fallback to Gemini AI for stock prices
    try {
      const apiKey = localStorage.getItem('gemini_api_key') || '';
      if (!apiKey) {
        throw new Error("API key not configured. Cannot fetch stock price.");
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const detected = detectAssetType(ticker);
      const currencyInfo = detected.currency !== 'USD' ? ` in ${detected.currency}` : '';
      
      const prompt = `Find the current live stock price for ${ticker}${currencyInfo}. Return ONLY the numeric price value. No symbols, no explanations.`;

      console.log('🤖 Asking Gemini AI:', prompt);
      
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
      
      if (price <= 0 || isNaN(price)) {
        throw new Error("Could not extract valid price from AI response");
      }
      
      console.log(`🤖 Gemini AI returned price: ${price} ${detected.currency}`);
      
      // Convert to USD if needed
      let priceInUSD = price;
      if (detected.currency === 'CHF') {
        priceInUSD = await convertCurrency(price, 'CHF');
        console.log(`✅ Converted: ${price} CHF → ${priceInUSD.toFixed(2)} USD`);
      } else if (detected.currency === 'EUR') {
        priceInUSD = await convertCurrency(price, 'EUR');
        console.log(`✅ Converted: ${price} EUR → ${priceInUSD.toFixed(2)} USD`);
      }
      
      savePriceSnapshot(ticker, priceInUSD);
      
      const sources: SourceLink[] = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
        .filter(c => c.web && c.web.uri)
        .map(c => ({ title: c.web.title || 'Source', url: c.web.uri }));

      return { 
        price: priceInUSD, 
        sources, 
        rawText: text,
        assetType: 'STOCK',
        currency: detected.currency,
        name: ticker,
        symbol: ticker
      };
      
    } catch (aiError: any) {
      console.error('❌ Gemini AI also failed:', aiError.message);
      throw new Error(`Failed to fetch stock price: ${aiError.message}`);
    }
  }
};

export const fetchTokenPriceFromDex = async (contractAddress: string): Promise<PriceResult> => {
  const normalizedAddress = contractAddress.toLowerCase();
  
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${normalizedAddress}`;
    const res = await fetch(url);
    
    if (!res.ok) throw new Error(`DEXScreener API failed`);
    
    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) throw new Error('No trading pairs found');
    
    const sortedPairs = data.pairs
      .filter((pair: any) => pair.priceUsd && parseFloat(pair.priceUsd) > 0)
      .sort((a: any, b: any) => parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0));
    
    if (sortedPairs.length === 0) throw new Error('No valid trading pairs');
    
    const bestPair = sortedPairs[0];
    const price = parseFloat(bestPair.priceUsd);
    
    if (isNaN(price) || price <= 0) throw new Error('Invalid price data');
    
    const tokenName = bestPair.baseToken?.name || 'Unknown Token';
    const tokenSymbol = bestPair.baseToken?.symbol || contractAddress.slice(0, 8);
    
    savePriceSnapshot(contractAddress, price);
    
    const liquidityUsdFormatted = (parseFloat(bestPair.liquidity?.usd || 0) / 1000000).toFixed(2);
    
    return {
      price,
      name: tokenName,
      symbol: tokenSymbol,
      assetType: 'CRYPTO',
      currency: 'USD',
      sources: [{
        title: `${bestPair.dexId} (${bestPair.chainId}) - Liq: $${liquidityUsdFormatted}M`,
        url: bestPair.url || `https://dexscreener.com/${bestPair.chainId}/${bestPair.pairAddress}`
      }],
      rawText: `${tokenName} (${tokenSymbol}) - $${price}`
    };
  } catch (error: any) {
    throw new Error(error.message || "Failed to fetch from DEXScreener");
  }
};

export const fetchCryptoPrice = async (ticker: string): Promise<PriceResult> => {
  const detected = detectAssetType(ticker);
  
  if (detected.assetType === 'CASH') {
    if (detected.currency === 'USD' || STABLECOINS_USD.includes(ticker.toUpperCase())) {
      savePriceSnapshot(ticker, 1.0);
      return {
        price: 1.0,
        name: ticker.toUpperCase(),
        symbol: ticker.toUpperCase(),
        assetType: 'CASH',
        currency: 'USD',
        sources: [{ title: 'Fixed Price', url: '#' }],
        rawText: `${ticker} - Fixed at $1.00`
      };
    } else if (detected.currency === 'CHF') {
      const rates = await fetchExchangeRates();
      const chfInUSD = 1 / rates.CHF_USD;
      savePriceSnapshot(ticker, chfInUSD);
      return {
        price: chfInUSD,
        name: 'Swiss Franc',
        symbol: 'CHF',
        assetType: 'CASH',
        currency: 'CHF',
        sources: [{ title: 'Exchange Rate', url: '#' }],
        rawText: `CHF - $${chfInUSD.toFixed(4)} (live rate)`
      };
    } else if (detected.currency === 'EUR') {
      const rates = await fetchExchangeRates();
      const eurInUSD = 1 / rates.EUR_USD;
      savePriceSnapshot(ticker, eurInUSD);
      return {
        price: eurInUSD,
        name: 'Euro',
        symbol: 'EUR',
        assetType: 'CASH',
        currency: 'EUR',
        sources: [{ title: 'Exchange Rate', url: '#' }],
        rawText: `EUR - $${eurInUSD.toFixed(4)} (live rate)`
      };
    }
  }
  
  if (isContractAddress(ticker)) return fetchTokenPriceFromDex(ticker);
  if (detected.assetType === 'STOCK') return fetchStockPrice(ticker);
  
  try {
    const apiKey = localStorage.getItem('gemini_api_key') || '';
    if (!apiKey) throw new Error("API key not configured");

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Find the current live market price of the '${ticker}' cryptocurrency token in USD. Return ONLY the numeric price value.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    });

    const text = response.text || "";
    const cleanText = text.replace(/[$,]/g, '').trim();
    const priceMatch = cleanText.match(/[\d]*[.]{0,1}[\d]+/);
    let price = priceMatch ? parseFloat(priceMatch[0]) : 0;
    
    if (price <= 0) throw new Error("Could not extract valid price");
    
    savePriceSnapshot(ticker, price);
    
    const sources: SourceLink[] = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
      .filter(c => c.web && c.web.uri)
      .map(c => ({ title: c.web.title || 'Source', url: c.web.uri }));

    return { price, sources, rawText: text, assetType: 'CRYPTO', currency: 'USD' };
  } catch (error: any) {
    throw new Error(error.message || "Failed to fetch price");
  }
};

export const fetchAssetHistory = async (ticker: string, currentPrice?: number, tokenSymbol?: string): Promise<number[][] | undefined> => {
  const detected = detectAssetType(ticker);
  
  if (detected.assetType === 'STOCK') {
    try {
      const now = Math.floor(Date.now() / 1000);
      const oneYearAgo = now - (365 * 24 * 60 * 60);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${oneYearAgo}&period2=${now}&interval=1d`;
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        const timestamps = data.chart?.result?.[0]?.timestamp || [];
        const prices = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        
        if (timestamps.length > 0 && prices.length > 0) {
          const historyData: [number, number][] = timestamps
            .map((ts: number, i: number) => [ts * 1000, prices[i]])
            .filter((p: [number, number]) => p[1] > 0);
          
          const localSnapshots = loadPriceSnapshots(ticker);
          const merged = mergeHistoryWithSnapshots(historyData, localSnapshots);
          saveHistoricalData(ticker, merged);
          return merged;
        }
      }
    } catch (e) {}
  }
  
  if (isContractAddress(ticker) && tokenSymbol) {
    try {
      const res = await fetch(`https://min-api.cryptocompare.com/data/v2/histoday?fsym=${tokenSymbol.toUpperCase()}&tsym=USD&limit=2000`);
      if (res.ok) {
        const json = await res.json();
        if (json.Response === 'Success' && json.Data?.Data?.length > 0) {
          const historyData = json.Data.Data.map((d: any) => [d.time * 1000, d.close]).filter((p: any) => p[1] > 0);
          const localSnapshots = loadPriceSnapshots(ticker);
          const merged = mergeHistoryWithSnapshots(historyData, localSnapshots);
          saveHistoricalData(ticker, merged);
          return merged;
        }
      }
    } catch (e) {}
  }
  
  if (isContractAddress(ticker)) {
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${ticker.toLowerCase()}/market_chart/?vs_currency=usd&days=365`);
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
    } catch (e) {}
  }
  
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
  } catch (e) {}
  
  return undefined;
};