// Currency Exchange Rate Service
// Uses exchangerate-api.com free tier (1500 requests/month)

interface ExchangeRatesResponse {
  provider?: string;
  WARNING_UPGRADE_TO_V6?: string;
  terms?: string;
  base: string;
  date: string;
  time_last_updated?: number;
  rates: Record<string, number>;
}

const EXCHANGE_RATE_CACHE_KEY = 'fx_rates_cache';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Fallback rates (updated manually as backup - last updated Dec 28, 2024)
// These are only used if the API fails completely
const FALLBACK_RATES: Record<string, number> = {
  'USD': 1.00,
  'CHF': 0.789,  // Updated from live API
  'EUR': 0.849,  // Updated from live API
  'GBP': 0.741,  // Updated from live API
  'JPY': 156.5,  // Updated from live API
  'CAD': 1.37,   // Updated from live API
  'AUD': 1.49,   // Updated from live API
};

interface CachedRates {
  rates: Record<string, number>;
  timestamp: number;
  baseCurrency: string;
}

export const fetchExchangeRates = async (): Promise<Record<string, number>> => {
  try {
    // Check cache first
    const cached = localStorage.getItem(EXCHANGE_RATE_CACHE_KEY);
    if (cached) {
      const parsedCache: CachedRates = JSON.parse(cached);
      const age = Date.now() - parsedCache.timestamp;
      
      // Use cache if less than 24 hours old
      if (age < CACHE_DURATION) {
        console.log('📊 Using cached exchange rates (age: ' + Math.floor(age / 1000 / 60) + ' minutes)');
        return parsedCache.rates;
      }
    }

    // Fetch fresh rates from API
    console.log('🌐 Fetching fresh exchange rates from API...');
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    
    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }
    
    const data: ExchangeRatesResponse = await response.json();
    
    if (data.rates) {
      const rates = data.rates;
      
      // Cache the fresh rates
      const cacheData: CachedRates = {
        rates,
        timestamp: Date.now(),
        baseCurrency: 'USD'
      };
      localStorage.setItem(EXCHANGE_RATE_CACHE_KEY, JSON.stringify(cacheData));
      
      console.log('✅ Exchange rates updated successfully');
      return rates;
    } else {
      throw new Error('Invalid API response format');
    }
  } catch (error) {
    console.warn('⚠️ Failed to fetch exchange rates, using fallback:', error);
    return FALLBACK_RATES;
  }
};

// Convert amount from one currency to another
export const convertCurrency = async (
  amount: number,
  fromCurrency: string,
  toCurrency: string = 'USD'
): Promise<number> => {
  if (fromCurrency === toCurrency) return amount;
  
  const rates = await fetchExchangeRates();
  
  // Convert to USD first (all rates are relative to USD)
  const amountInUSD = amount / rates[fromCurrency];
  
  // Then convert to target currency
  return amountInUSD * rates[toCurrency];
};

// SYNCHRONOUS conversion using pre-loaded rates (for use in useMemo/render loops)
// This avoids async/await issues in React rendering
export const convertCurrencySync = (
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, number>
): number => {
  if (fromCurrency === toCurrency) return amount;
  
  // Safety check: ensure we have the required rates
  if (!rates[fromCurrency] || !rates[toCurrency]) {
    console.error('❌ Missing exchange rate for', fromCurrency, 'or', toCurrency);
    return amount; // Fallback to original value to prevent NaN
  }
  
  // Convert to USD first (all rates are relative to USD)
  const amountInUSD = amount / rates[fromCurrency];
  
  // Then convert to target currency
  return amountInUSD * rates[toCurrency];
};

// Get single exchange rate
export const getExchangeRate = async (fromCurrency: string, toCurrency: string = 'USD'): Promise<number> => {
  if (fromCurrency === toCurrency) return 1;
  
  const rates = await fetchExchangeRates();
  const rate = rates[toCurrency] / rates[fromCurrency];
  return rate;
};

// Supported currencies list
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', flag: '🇨🇭' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', flag: '🇨🇦' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺' },
] as const;

// Clear cache manually if needed
export const clearExchangeRateCache = () => {
  localStorage.removeItem(EXCHANGE_RATE_CACHE_KEY);
  console.log('🗑️ Exchange rate cache cleared');
};

// ============================================
// HISTORICAL EXCHANGE RATES (for chart fix)
// ============================================

const HISTORICAL_RATES_CACHE_KEY = 'fx_rates_historical';

/**
 * Fetch historical exchange rates for a date range
 * Uses frankfurter.app (free, unlimited, supports time-series)
 * Returns: Map of date (YYYY-MM-DD) -> rates
 */
export const fetchHistoricalExchangeRates = async (
  fromDate: Date,
  toDate: Date = new Date()
): Promise<Record<string, Record<string, number>>> => {
  
  const cacheKey = HISTORICAL_RATES_CACHE_KEY;
  const cached = localStorage.getItem(cacheKey);
  let cachedData: Record<string, Record<string, number>> = {};
  
  if (cached) {
    try {
      cachedData = JSON.parse(cached);
      console.log(`📦 Loaded ${Object.keys(cachedData).length} cached historical FX rate days`);
    } catch (e) {
      console.warn('⚠️ Failed to parse cached historical FX rates');
    }
  }
  
  const fromDateStr = fromDate.toISOString().split('T')[0];
  const toDateStr = toDate.toISOString().split('T')[0];
  
  // Check if we already have all dates in cache
  const hasAllDates = checkIfAllDatesAreCached(fromDateStr, toDateStr, cachedData);
  
  if (hasAllDates) {
    console.log(`✅ All historical FX rates for ${fromDateStr} to ${toDateStr} found in cache`);
    return cachedData;
  }
  
  console.log(`💱 Fetching historical FX rates for ${fromDateStr} to ${toDateStr}...`);
  
  try {
    // Frankfurter.app supports time-series endpoint
    const url = `https://api.frankfurter.app/${fromDateStr}..${toDateStr}?from=USD`;
    console.log(`📡 Fetching from: ${url}`);
    
    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error(`frankfurter.app returned status ${res.status}`);
    }
    
    const data = await res.json();
    console.log(`✅ Received historical data from frankfurter.app:`, Object.keys(data.rates || {}).length, 'days');
    
    // Convert to our format: { "2025-12-01": { USD: 1.0, CHF: 0.88, ... }, ... }
    const historicalRates: Record<string, Record<string, number>> = {};
    
    for (const [dateStr, rates] of Object.entries(data.rates || {})) {
      const ratesObj = rates as Record<string, number>;
      
      historicalRates[dateStr] = {
        USD: 1.0, // USD to USD is always 1
        ...ratesObj
      };
    }
    
    // Merge with cache
    const merged = { ...cachedData, ...historicalRates };
    
    // Save to cache
    localStorage.setItem(cacheKey, JSON.stringify(merged));
    console.log(`💾 Saved ${Object.keys(merged).length} total historical FX rate days to cache`);
    
    return merged;
    
  } catch (error) {
    console.error('❌ Failed to fetch historical FX rates:', error);
    
    // Return cached data if available
    if (Object.keys(cachedData).length > 0) {
      console.log('📦 Falling back to cached historical FX rates');
      return cachedData;
    }
    
    // Ultimate fallback: return empty (will use current rates as fallback)
    return {};
  }
};

/**
 * P1.1B NEW: Fetch historical exchange rates for a SINGLE date
 * Returns rates relative to USD for that specific date
 * Uses frankfurter.app API which is free and supports historical data
 *
 * P1.2 FIX: Format date in local timezone to avoid UTC conversion shifting the date
 */
export const fetchHistoricalExchangeRatesForDate = async (date: Date): Promise<Record<string, number>> => {
  try {
    // P1.2 FIX: Format date in local timezone (not UTC) to avoid date shift
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    console.log(`💱 Fetching historical FX rates for ${dateStr}...`);

    // frankfurter.app provides historical rates with USD as base
    const response = await fetch(`https://api.frankfurter.app/${dateStr}?from=USD`);
    
    if (!response.ok) {
      console.warn(`⚠️ Historical FX API returned ${response.status} for ${dateStr}`);
      
      // If weekend/holiday, try previous business day
      if (response.status === 404 || response.status === 400) {
        const previousDay = new Date(date);
        previousDay.setDate(previousDay.getDate() - 1);
        return fetchHistoricalExchangeRatesForDate(previousDay);
      }
      
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();
    const rates: Record<string, number> = {
      USD: 1.0, // Base currency
      ...data.rates
    };
    
    console.log(`✅ Historical FX rates for ${dateStr}:`, rates);
    return rates;
  } catch (error) {
    console.warn(`⚠️ Failed to fetch historical rates for ${date.toISOString()}, using fallback:`, error);
    return FALLBACK_RATES;
  }
};

/**
 * Check if all dates in range are cached
 */
const checkIfAllDatesAreCached = (
  fromDateStr: string,
  toDateStr: string,
  cache: Record<string, Record<string, number>>
): boolean => {
  const from = new Date(fromDateStr);
  const to = new Date(toDateStr);
  
  // Check every day in range
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    if (!cache[dateStr]) {
      return false; // Missing this date
    }
  }
  
  return true;
};

/**
 * 🔧 FIXED: Convert currency using historical rates with intelligent inverse rate calculation
 * Used for chart calculations with date-specific exchange rates
 * 
 * Rates from frankfurter.app are in "USD to X" format:
 * Example: { USD: 1.0, CHF: 0.88, EUR: 0.95 }
 * This means: 1 USD = 0.88 CHF (NOT 1 CHF = 0.88 USD!)
 * 
 * Handles 3 conversion cases:
 * 1. USD → Target (direct multiplication)
 * 2. Source → USD (inverse rate calculation)
 * 3. Cross-currency via USD (combine inverse + direct)
 */
// P1.2: Suppress repetitive fallback warnings (weekly FX data causes noise)
let fallbackWarningShown = false;

export const convertCurrencySyncHistorical = (
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  date: Date,
  historicalRates: Record<string, Record<string, number>>,
  fallbackCurrentRates: Record<string, number>
): number => {
  if (fromCurrency === toCurrency) {
    return amount; // P1.2: Removed verbose logging for same-currency
  }

  const dateStr = date.toISOString().split('T')[0];
  let ratesForDate = historicalRates[dateStr];

  // 🔧 FIX: Weekend/Holiday fallback - use previous day's rate
  if (!ratesForDate) {
    // P1.2: Only show warning once per session to reduce console noise
    if (!fallbackWarningShown) {
      console.log(`ℹ️ Historical FX data is weekly - using nearest available rate (within 7 days)`);
      fallbackWarningShown = true;
    }

    // Try up to 7 days back (to handle long weekends and weekly data)
    for (let daysBack = 1; daysBack <= 7; daysBack++) {
      const prevDate = new Date(date);
      prevDate.setDate(prevDate.getDate() - daysBack);
      const prevDateStr = prevDate.toISOString().split('T')[0];

      if (historicalRates[prevDateStr]) {
        ratesForDate = historicalRates[prevDateStr];
        break;
      }
    }

    // If still no rates, use current rates
    if (!ratesForDate) {
      console.warn(`⚠️ No historical rates found for ${dateStr}, using current rates as fallback`);
      return convertCurrencySync(amount, fromCurrency, toCurrency, fallbackCurrentRates);
    }
  }

  // P1.2: Removed verbose conversion logging - only log errors

  // Case 1: USD → Target currency (direct multiplication)
  if (fromCurrency === 'USD' && ratesForDate[toCurrency] !== undefined) {
    return amount * ratesForDate[toCurrency];
  }

  // Case 2: Source → USD (inverse rate)
  if (toCurrency === 'USD' && ratesForDate[fromCurrency] !== undefined) {
    const inverseRate = 1 / ratesForDate[fromCurrency];
    return amount * inverseRate;
  }

  // Case 3: Cross-currency via USD (e.g., CHF → EUR)
  if (ratesForDate[fromCurrency] !== undefined && ratesForDate[toCurrency] !== undefined) {
    // Step 1: Source → USD (inverse)
    const sourceToUsd = 1 / ratesForDate[fromCurrency];
    const amountInUSD = amount * sourceToUsd;

    // Step 2: USD → Target (direct)
    return amountInUSD * ratesForDate[toCurrency];
  }

  // Fallback to current rates if no historical path found
  console.warn(`⚠️ [${dateStr}] No valid conversion path for ${fromCurrency}→${toCurrency}, using current rates`);
  return convertCurrencySync(amount, fromCurrency, toCurrency, fallbackCurrentRates);
};