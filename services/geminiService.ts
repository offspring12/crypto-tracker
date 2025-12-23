import { GoogleGenAI } from "@google/genai";
import { SourceLink } from "../types";

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PriceResult {
  price: number;
  sources: SourceLink[];
  rawText: string;
  name?: string;
  symbol?: string;
}

const isContractAddress = (input: string): boolean => {
  const lowerInput = input.toLowerCase();
  const result = lowerInput.startsWith('0x') && input.length >= 40;
  console.log('🔍 isContractAddress check:', { input, lowerInput, startsWithOx: lowerInput.startsWith('0x'), length: input.length, result });
  return result;
};

export const fetchTokenPriceFromDex = async (contractAddress: string): Promise<PriceResult> => {
  console.log('🚀 fetchTokenPriceFromDex called with:', contractAddress);
  
  // Normalize to lowercase for API call
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
    
    // Sort by liquidity USD (highest first)
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
    
    // Parse price - the API returns it as a string
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
    
    const liquidityUsdFormatted = (parseFloat(bestPair.liquidity?.usd || 0) / 1000000).toFixed(2);
    
    const result = {
      price,
      name: tokenName,
      symbol: tokenSymbol,
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
  console.log('🔵 fetchCryptoPrice called with ticker:', ticker);
  console.log('🔵 Ticker type:', typeof ticker, 'Length:', ticker.length);
  
  if (isContractAddress(ticker)) {
    console.log('✅ Detected as contract address, using DEXScreener');
    return fetchTokenPriceFromDex(ticker);
  }
  
  console.log('📍 Detected as ticker symbol, using Gemini AI');
  
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
    
    const sources: SourceLink[] = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
      .filter(c => c.web && c.web.uri)
      .map(c => ({ title: c.web.title || 'Source', url: c.web.uri }));

    return { price, sources, rawText: text };
  } catch (error: any) {
    throw new Error(error.message || "Failed to fetch price");
  }
};

export const fetchAssetHistory = async (ticker: string, currentPrice?: number, tokenSymbol?: string): Promise<number[][] | undefined> => {
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
          
          // Verify the latest price is reasonably close to current price (within 50% either way)
          if (currentPrice && historyData.length > 0) {
            const latestHistoricalPrice = historyData[historyData.length - 1][1];
            const priceRatio = latestHistoricalPrice / currentPrice;
            
            console.log(`🔍 Price verification: Historical=${latestHistoricalPrice}, Current=${currentPrice}, Ratio=${priceRatio}`);
            
            // If prices are within reasonable range (0.5x to 2x), it's likely the right token
            if (priceRatio >= 0.5 && priceRatio <= 2.0) {
              console.log(`✅ CryptoCompare history validated for ${tokenSymbol}`);
              return historyData;
            } else {
              console.warn(`⚠️ Price mismatch - probably different token with same symbol`);
            }
          } else {
            // No current price to verify, use data anyway
            console.log(`✅ CryptoCompare history found for ${tokenSymbol} (no price verification)`);
            return historyData;
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ CryptoCompare fetch failed:', e);
    }
  }
  
  // For contract addresses, try CoinGecko as fallback
  if (isContractAddress(ticker)) {
    try {
      const normalizedAddress = ticker.toLowerCase();
      console.log('📈 Fetching history for contract address from CoinGecko:', normalizedAddress);
      
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/ethereum/contract/${normalizedAddress}/market_chart/?vs_currency=usd&days=365`
      );
      
      if (res.ok) {
        const json = await res.json();
        console.log('✅ CoinGecko history received:', json.prices?.length, 'data points');
        
        if (json.prices && json.prices.length > 0) {
          return json.prices.filter((p: any) => p[1] > 0);
        }
      } else {
        console.warn('⚠️ CoinGecko API returned status:', res.status);
      }
    } catch (e) {
      console.warn('⚠️ CoinGecko history fetch failed:', e);
    }
    
    return undefined;
  }
  
  // For regular tickers, use CryptoCompare directly
  try {
     const res = await fetch(`https://min-api.cryptocompare.com/data/v2/histoday?fsym=${ticker.toUpperCase()}&tsym=USD&limit=2000`);
     if (res.ok) {
        const json = await res.json();
        if (json.Response === 'Success') {
           return json.Data.Data.map((d: any) => [d.time * 1000, d.close]).filter((p: any) => p[1] > 0);
        }
     }
  } catch (e) { console.warn(e); }
  return undefined;
};