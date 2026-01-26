/**
 * Currency Hook
 *
 * Manages display currency state and exchange rates.
 * Loads exchange rates on mount and provides currency switching.
 *
 * Extracted from App.tsx for better code organization.
 */

import { useState, useEffect } from 'react';
import { Currency } from '../types';
import { fetchExchangeRates } from '../services/currencyService';

export interface UseCurrencyResult {
  /** Current display currency (e.g., 'USD', 'CHF', 'EUR') */
  displayCurrency: Currency;
  /** Set the display currency */
  setDisplayCurrency: (currency: Currency) => void;
  /** Current exchange rates (base: USD) */
  exchangeRates: Record<string, number>;
  /** Whether exchange rates are still loading */
  isLoadingRates: boolean;
}

/**
 * Hook for managing display currency and exchange rates
 *
 * @param initialCurrency - Initial display currency (default: 'USD')
 * @returns Currency state and exchange rates
 *
 * @example
 * ```tsx
 * const { displayCurrency, setDisplayCurrency, exchangeRates } = useCurrency('USD');
 * ```
 */
export const useCurrency = (initialCurrency: Currency = 'USD'): UseCurrencyResult => {
  const [displayCurrency, setDisplayCurrency] = useState<Currency>(initialCurrency);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  const [isLoadingRates, setIsLoadingRates] = useState(true);

  // Load exchange rates on mount
  useEffect(() => {
    const loadRates = async () => {
      setIsLoadingRates(true);
      try {
        const rates = await fetchExchangeRates();
        setExchangeRates(rates);
        console.log('💱 useCurrency: Exchange rates loaded:', rates);
      } catch (error) {
        console.error('❌ useCurrency: Failed to load exchange rates:', error);
      } finally {
        setIsLoadingRates(false);
      }
    };
    loadRates();
  }, []);

  return {
    displayCurrency,
    setDisplayCurrency,
    exchangeRates,
    isLoadingRates,
  };
};
