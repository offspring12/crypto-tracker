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