import { GoogleGenAI } from "@google/genai";
import { SourceLink } from "../types";

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PriceResult {
  price: number;
  sources: SourceLink[];
  rawText: string;
}

export const fetchCryptoPrice = async (ticker: string): Promise<PriceResult> => {
  try {
    // Get API key from environment variable (set in vite.config.ts)
    const apiKey = import.meta.env.VITE_API_KEY || process.env.API_KEY || '';
    
    if (!apiKey) {
      throw new Error("API key not configured");
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `Find the current market price of '${ticker}' cryptocurrency in USD. 
    Return ONLY the numeric price value. No symbols.`;

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
    const sources: SourceLink[] = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
      .filter(c => c.web && c.web.uri)
      .map(c => ({ title: c.web.title || 'Source', url: c.web.uri }));

    return { price, sources, rawText: text };
  } catch (error: any) {
    throw new Error(error.message || "Failed to fetch price");
  }
};

export const fetchAssetHistory = async (ticker: string): Promise<number[][] | undefined> => {
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