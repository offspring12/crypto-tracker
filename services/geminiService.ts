import { GoogleGenAI } from "@google/genai";
import { SourceLink } from "../types";

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PriceResult {
  price: number;
  sources: SourceLink[];
  rawText: string;
  name?: string;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const isContractAddress = (input: string): boolean => {
  return input.startsWith("0x") && input.length >= 40;
};

// -----------------------------------------------------------------------------
// DEX price via Dexscreener (REKT/WETH → WETH/USD)
// -----------------------------------------------------------------------------

export const fetchTokenPriceFromDex = async (
  contractAddress: string
): Promise<PriceResult> => {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`
    );

    if (!res.ok) {
      throw new Error("DEXScreener API failed");
    }

    const data = await res.json();

    if (!data.pairs || data.pairs.length === 0) {
      throw new Error("No trading pairs found for this token");
    }

    const tokenAddress = contractAddress.toLowerCase();

    // -------------------------------------------------------------------------
    // 1) Enforce REKT/WETH pair (base = token, quote = WETH)
    // -------------------------------------------------------------------------

    const rektWethPairs = data.pairs.filter((pair: any) =>
      pair.baseToken?.address?.toLowerCase() === tokenAddress &&
      pair.quoteToken?.symbol === "WETH" &&
      pair.priceNative &&
      pair.liquidity?.usd > 1000
    );

    if (rektWethPairs.length === 0) {
      throw new Error("No REKT/WETH pair with sufficient liquidity found");
    }

    const bestPair = rektWethPairs.sort(
      (a: any, b: any) => b.liquidity.usd - a.liquidity.usd
    )[0];

    // -------------------------------------------------------------------------
    // 2) Fetch current WETH/USD
    // -------------------------------------------------------------------------

    const wethRes = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=weth&vs_currencies=usd"
    );

    if (!wethRes.ok) {
      throw new Error("Failed to fetch WETH price");
    }

    const wethData = await wethRes.json();
    const wethUsd = wethData?.weth?.usd;

    if (!wethUsd || wethUsd <= 0) {
      throw new Error("Invalid WETH/USD price");
    }

    // -------------------------------------------------------------------------
    // 3) Compute final USD price
    // -------------------------------------------------------------------------

    const priceNative = parseFloat(bestPair.priceNative);

    if (isNaN(priceNative) || priceNative <= 0) {
      throw new Error("Invalid priceNative from REKT/WETH pair");
    }

    const price = priceNative * wethUsd;

    // -------------------------------------------------------------------------
    // 4) Return
    // -------------------------------------------------------------------------

    return {
      price,
      name: bestPair.baseToken?.name || "Unknown Token",
      sources: [
        {
          title: `${bestPair.dexId} (${bestPair.chainId}) REKT/WETH`,
          url:
            bestPair.url ||
            `https://dexscreener.com/${bestPair.chainId}/${bestPair.pairAddress}`,
        },
      ],
      rawText: "Computed from REKT/WETH × WETH/USD",
    };
  } catch (error: any) {
    throw new Error(error.message || "Failed to fetch price from DEXScreener");
  }
};

// -----------------------------------------------------------------------------
// Unified price entry point
// -----------------------------------------------------------------------------

export const fetchCryptoPrice = async (
  ticker: string
): Promise<PriceResult> => {
  if (isContractAddress(ticker)) {
    return fetchTokenPriceFromDex(ticker);
  }

  // ---------------------------------------------------------------------------
  // Gemini AI for tickers (BTC, ETH, etc.)
  // ---------------------------------------------------------------------------

  try {
    const apiKey = localStorage.getItem("gemini_api_key") || "";

    if (!apiKey) {
      throw new Error(
        "API key not configured. Please add your API key in settings."
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Find the current live market price of the '${ticker}' cryptocurrency token in USD from a reliable source like CoinGecko, CoinMarketCap, or DEXScreener.
Return ONLY the numeric USD price.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "";
    const cleanText = text.replace(/[$,]/g, "").trim();
    const priceMatch = cleanText.match(/[\d]*[.]{0,1}[\d]+/);

    const price = priceMatch ? parseFloat(priceMatch[0]) : 0;

    if (!price || price <= 0) {
      throw new Error("Could not extract valid price from AI response");
    }

    const sources: SourceLink[] =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks
        ?.filter((c: any) => c.web && c.web.uri)
        .map((c: any) => ({
          title: c.web.title || "Source",
          url: c.web.uri,
        })) || [];

    return {
      price,
      sources,
      rawText: text,
    };
  } catch (error: any) {
    throw new Error(error.message || "Failed to fetch price");
  }
};

// -----------------------------------------------------------------------------
// Historical prices (unchanged)
// -----------------------------------------------------------------------------

export const fetchAssetHistory = async (
  ticker: string
): Promise<number[][] | undefined> => {
  if (isContractAddress(ticker)) {
    return undefined;
  }

  try {
    const res = await fetch(
      `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${ticker.toUpperCase()}&tsym=USD&limit=2000`
    );

    if (res.ok) {
      const json = await res.json();
      if (json.Response === "Success") {
        return json.Data.Data
          .map((d: any) => [d.time * 1000, d.close])
          .filter((p: any) => p[1] > 0);
      }
    }
  } catch {
    /* noop */
  }

  return undefined;
};
