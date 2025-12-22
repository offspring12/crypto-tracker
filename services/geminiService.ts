import { GoogleGenAI } from "@google/genai";
import { SourceLink } from "../types";

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PriceResult {
  price: number;
  sources: SourceLink[];
  rawText: string;
  name?: string; // Optional: token name from DEX
}

// Helper function to check if input is a contract address
const isContractAddress = (input: string): boolean => {
  return input.startsWith('0x') && input.length >= 40;
};

// Fetch price from DEXScreener for contract addresses
export const fetchTokenPriceFromDex = async (contractAddress: string): Promise<PriceResult> => {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`);
    if (!res.ok) throw new Error('DEXScreener API failed');
    
    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) {
      throw new Error('No trading pairs found for this token');
    }
    
    // Filter for pairs with liquidity and sort by liquidity (most liquid = most reliable price)
    const validPairs = data.pairs
      .filter((pair: any) => pair.liquidity?.usd > 1000) // At least $1k liquidity
      .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    
    if (validPairs.length === 0) {
      throw new Error('No liquid trading pairs found');
    }
    
    const bestPair = validPairs[0];
    const price = parseFloat(bestPair.priceUsd);
    
    if (isNaN(price) || price <= 0) {
      throw new Error('Invalid price data from DEXScreener');
    }
    
    return {
      price,
      name: bestPair.baseToken?.name || 'Unknown Token',
      sources: [{
        title: `${bestPair.dexId} (${bestPair.chainId})`,
        url: bestPair.url || `https://dexscreener.com/${bestPair.chainId}/${bestPair.pairAddress}`
      }],
      rawText: `Price from ${bestPair.dexId} on ${bestPair.chainId}`
    };
  } catch (error: any) {
    throw new Error(error.message || "Failed to fetch price from DEXScreener");
  }
};

export const fetchCryptoPrice = async (ticker: string): Promise<PriceResult> => {
  // Check if input is a contract address
  if (isContractAddress(ticker)) {
    return fetchTokenPriceFromDex(ticker);
  }
  
  // Otherwise, use Gemini AI for ticker symbols
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

export const fetchAssetHistory = async (ticker: string): Promise<number[][] | undefined> => {
  // Skip history for contract addresses (DEX tokens typically don't have long history via this API)
  if (isContractAddress(ticker)) {
    return undefined;
  }
  
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