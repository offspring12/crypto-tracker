import { Asset, Currency } from '../types';

// ============================================================================
// P3: CASH FLOW VALIDATION SERVICE
// ============================================================================

/**
 * Check if a ticker is a cash/fiat currency
 */
export function isFiatCurrency(ticker: string): boolean {
  const fiatCurrencies = ['USD', 'CHF', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];
  return fiatCurrencies.includes(ticker.toUpperCase());
}

/**
 * Check if a ticker is a stablecoin
 */
export function isStablecoin(ticker: string): boolean {
  const stablecoins = ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD'];
  return stablecoins.includes(ticker.toUpperCase());
}

/**
 * Check if a ticker is a cash asset (fiat or stablecoin)
 */
export function isCashAsset(ticker: string): boolean {
  return isFiatCurrency(ticker) || isStablecoin(ticker);
}

/**
 * Check if a ticker is a stock
 */
export function isStock(ticker: string): boolean {
  const upper = ticker.toUpperCase();

  // Stock exchange suffixes
  const stockSuffixes = ['.SW', '.L', '.T', '.TO', '.AX', '.DE', '.F'];

  return stockSuffixes.some(suffix => upper.endsWith(suffix));
}

/**
 * Detect the native currency of a stock based on its ticker
 */
export function detectStockCurrency(ticker: string): Currency {
  const upper = ticker.toUpperCase();

  // Swiss stocks
  if (upper.endsWith('.SW')) return 'CHF';

  // London stocks
  if (upper.endsWith('.L')) return 'GBP';

  // Tokyo stocks
  if (upper.endsWith('.T')) return 'JPY';

  // Toronto stocks
  if (upper.endsWith('.TO')) return 'CAD';

  // Australian stocks
  if (upper.endsWith('.AX')) return 'AUD';

  // German/Frankfurt stocks
  if (upper.endsWith('.DE') || upper.endsWith('.F')) return 'EUR';

  // Default to USD for US stocks
  return 'USD';
}

/**
 * Calculate available balance at a specific date
 * Used for chronological validation
 */
export function getBalanceAtDate(asset: Asset, atDate: string): number {
  const targetDate = new Date(atDate).getTime();

  let balance = 0;

  // Sort transactions chronologically
  const sortedTxs = [...asset.transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (const tx of sortedTxs) {
    const txDate = new Date(tx.date).getTime();

    // Only count transactions before or on the target date
    if (txDate > targetDate) break;

    if (tx.type === 'DEPOSIT' || tx.type === 'INCOME') {
      balance += tx.quantity;
    } else if (tx.type === 'BUY') {
      balance += tx.quantity;
    } else if (tx.type === 'SELL') {
      balance -= tx.quantity;
    } else if (tx.type === 'WITHDRAWAL') {
      balance -= tx.quantity;
    } else if (tx.type === 'TRANSFER') {
      balance -= tx.quantity; // TRANSFER removes quantity from source portfolio
    }
  }

  return balance;
}

/**
 * Validate a BUY transaction
 *
 * Checks:
 * 1. Source asset exists
 * 2. Sufficient balance
 * 3. Chronological validity (has deposit before buy date)
 * 4. Currency compatibility for stocks
 *
 * @returns Object with valid flag and optional error message
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateBuyTransaction(
  assets: Asset[],
  sourceTicker: string,
  sourceQuantity: number,
  destinationTicker: string,
  buyDate: string
): ValidationResult {
  // 1. Check if source asset exists
  const sourceAsset = assets.find(a => a.ticker.toUpperCase() === sourceTicker.toUpperCase());

  if (!sourceAsset) {
    return {
      valid: false,
      error: `No ${sourceTicker} available.\n\nPlease make a DEPOSIT of ${sourceTicker} before buying ${destinationTicker}.`
    };
  }

  // 2. Check sufficient balance at the buy date (chronological validation)
  const availableBalance = getBalanceAtDate(sourceAsset, buyDate);

  if (availableBalance < sourceQuantity) {
    return {
      valid: false,
      error: `Insufficient ${sourceTicker} on ${new Date(buyDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })}\n\nAvailable: ${availableBalance.toLocaleString('en-US', { maximumFractionDigits: 8 })}\nRequired: ${sourceQuantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}`
    };
  }

  // 3. Check if there's an acquisition (deposit/income/buy) before or on the buy date
  // Compare dates only (ignore time component to avoid timezone issues)
  const buyDateOnly = new Date(buyDate).toISOString().split('T')[0];

  const hasAcquisitionBefore = sourceAsset.transactions.some(
    tx => {
      // Any acquisition type counts (DEPOSIT, INCOME, or BUY from another asset)
      if (tx.type !== 'DEPOSIT' && tx.type !== 'INCOME' && tx.type !== 'BUY') return false;
      const txDateOnly = new Date(tx.date).toISOString().split('T')[0];
      return txDateOnly <= buyDateOnly;
    }
  );

  if (!hasAcquisitionBefore) {
    return {
      valid: false,
      error: `No ${sourceTicker} deposit exists before ${new Date(buyDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })}\n\nPlease add a DEPOSIT transaction for ${sourceTicker} with an earlier date.`
    };
  }

  // 4. Stock currency compatibility check
  if (isStock(destinationTicker)) {
    const requiredCurrency = detectStockCurrency(destinationTicker);

    if (sourceTicker.toUpperCase() !== requiredCurrency) {
      return {
        valid: false,
        error: `Currency Mismatch\n\n${destinationTicker} requires ${requiredCurrency}\n\nYou selected ${sourceTicker}.\n\nPlease deposit ${requiredCurrency} first, or swap your ${sourceTicker} to ${requiredCurrency}.`
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a SELL transaction
 *
 * Checks:
 * 1. Asset exists
 * 2. Sufficient quantity to sell
 * 3. Has BUY transactions before sell date (chronological)
 */
export function validateSellTransaction(
  assets: Asset[],
  ticker: string,
  quantity: number,
  sellDate: string
): ValidationResult {
  const asset = assets.find(a => a.ticker.toUpperCase() === ticker.toUpperCase());

  if (!asset) {
    return {
      valid: false,
      error: `No ${ticker} position found.\n\nYou cannot sell ${ticker} because you don't own any.`
    };
  }

  // Check available balance at sell date
  const availableBalance = getBalanceAtDate(asset, sellDate);

  if (availableBalance < quantity) {
    return {
      valid: false,
      error: `Insufficient ${ticker} on ${new Date(sellDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })}\n\nAvailable: ${availableBalance.toLocaleString('en-US', { maximumFractionDigits: 8 })}\nAttempting to sell: ${quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}`
    };
  }

  // Check if there are BUY/DEPOSIT/INCOME transactions before the sell date
  const hasAcquisitionBefore = asset.transactions.some(
    tx => (tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME') &&
          new Date(tx.date) <= new Date(sellDate)
  );

  if (!hasAcquisitionBefore) {
    return {
      valid: false,
      error: `No ${ticker} acquisition exists before ${new Date(sellDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })}\n\nYou must acquire ${ticker} (via DEPOSIT, BUY, or INCOME) before selling.`
    };
  }

  return { valid: true };
}

/**
 * Validate a WITHDRAWAL transaction
 *
 * Checks:
 * 1. Asset exists
 * 2. Sufficient quantity to withdraw
 */
export function validateWithdrawal(
  assets: Asset[],
  ticker: string,
  quantity: number,
  withdrawalDate: string
): ValidationResult {
  const asset = assets.find(a => a.ticker.toUpperCase() === ticker.toUpperCase());

  if (!asset) {
    return {
      valid: false,
      error: `No ${ticker} available to withdraw.\n\nYou don't have any ${ticker} in this portfolio.`
    };
  }

  // Check available balance at withdrawal date
  const availableBalance = getBalanceAtDate(asset, withdrawalDate);

  if (availableBalance < quantity) {
    return {
      valid: false,
      error: `Insufficient ${ticker} on ${new Date(withdrawalDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })}\n\nAvailable: ${availableBalance.toLocaleString('en-US', { maximumFractionDigits: 8 })}\nAttempting to withdraw: ${quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}`
    };
  }

  return { valid: true };
}

/**
 * Validate portfolio state before deletion
 * Checks if deleting a transaction would break cash flow logic
 */
export function validateTransactionDeletion(
  asset: Asset,
  transactionId: string
): ValidationResult {
  const tx = asset.transactions.find(t => t.id === transactionId);

  if (!tx) {
    return { valid: true }; // Transaction doesn't exist, nothing to check
  }

  // Sort transactions chronologically
  const sortedTxs = [...asset.transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Find the index of the transaction to delete
  const txIndex = sortedTxs.findIndex(t => t.id === transactionId);

  if (txIndex === -1) {
    return { valid: true };
  }

  // Simulate deletion and check if subsequent transactions would still be valid
  const simulatedTxs = sortedTxs.filter(t => t.id !== transactionId);

  let balance = 0;
  const txDate = new Date(tx.date).getTime();

  // Calculate balance at each point after deletion
  for (const t of simulatedTxs) {
    const currentDate = new Date(t.date).getTime();

    if (t.type === 'DEPOSIT' || t.type === 'INCOME') {
      balance += t.quantity;
    } else if (t.type === 'BUY') {
      balance += t.quantity;
    } else if (t.type === 'SELL') {
      balance -= t.quantity;

      // Check if we go negative after this transaction
      if (balance < 0 && currentDate >= txDate) {
        return {
          valid: false,
          error: `Cannot delete this transaction.\n\nDeleting would cause insufficient balance for subsequent transactions.\n\nTransaction on ${new Date(t.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })} would have negative balance.`
        };
      }
    } else if (t.type === 'WITHDRAWAL') {
      balance -= t.quantity;

      // Check if we go negative after this transaction
      if (balance < 0 && currentDate >= txDate) {
        return {
          valid: false,
          error: `Cannot delete this transaction.\n\nDeleting would cause insufficient balance for subsequent transactions.\n\nWithdrawal on ${new Date(t.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })} would exceed available balance.`
        };
      }
    } else if (t.type === 'TRANSFER') {
      balance -= t.quantity;

      // Check if we go negative after this transaction
      if (balance < 0 && currentDate >= txDate) {
        return {
          valid: false,
          error: `Cannot delete this transaction.\n\nDeleting would cause insufficient balance for subsequent transactions.\n\nTransfer on ${new Date(t.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })} would exceed available balance.`
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Check if portfolio has any deposits
 * Used to show empty state banner
 */
export function hasAnyDeposits(assets: Asset[]): boolean {
  return assets.some(asset =>
    asset.transactions.some(tx => tx.type === 'DEPOSIT')
  );
}
