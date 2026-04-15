import { ref, computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import api from '@/plugins/axios';

/**
 * Composable for currency conversion and formatting
 * Handles dynamic currency conversion based on default currency and exchange rates
 */
export function useCurrency() {
  const settingsStore = useSettingsStore();
  const defaultCurrency = ref(null);
  const currencySettings = ref(null);
  const loading = ref(false);

  // Fetch currency settings
  const fetchCurrencySettings = async () => {
    if (currencySettings.value) return currencySettings.value;
    
    loading.value = true;
    try {
      const settings = await settingsStore.fetchCurrencySettings();
      defaultCurrency.value = settings.defaultCurrency || 'IQD';
      currencySettings.value = settings;
      return settings;
    } catch (error) {
      console.error('Error fetching currency settings:', error);
      // Fallback to default
      defaultCurrency.value = 'IQD';
      return { defaultCurrency: 'IQD', usdRate: 1500, iqdRate: 1 };
    } finally {
      loading.value = false;
    }
  };

  // Initialize currency settings
  const initialize = async () => {
    if (!currencySettings.value) {
      await fetchCurrencySettings();
    }
  };

  /**
   * Convert amount from one currency to another using API
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrency - Source currency code
   * @param {string} toCurrency - Target currency code (defaults to defaultCurrency)
   * @returns {Promise<number>} Converted amount
   */
  const convertAmount = async (amount, fromCurrency, toCurrency = null) => {
    if (!amount || amount === 0) return 0;
    if (!fromCurrency) return amount;

    await initialize();
    const targetCurrency = toCurrency || defaultCurrency.value;

    // Same currency, no conversion needed
    if (fromCurrency === targetCurrency) {
      return parseFloat(amount);
    }

    try {
      const response = await api.post('/sales/currency/convert', {
        amount: parseFloat(amount),
        fromCurrency,
        toCurrency: targetCurrency,
      });

      return parseFloat(response.data.data.convertedAmount || amount);
    } catch (error) {
      console.error('Error converting currency:', error);
      // Fallback to simple calculation if API fails
      return fallbackConvert(amount, fromCurrency, targetCurrency);
    }
  };

  /**
   * Fallback conversion using local rates
   */
  const fallbackConvert = (amount, fromCurrency, toCurrency) => {
    if (!currencySettings.value) return amount;
    
    const { usdRate = 1500, iqdRate = 1 } = currencySettings.value;
    
    // Convert to IQD first, then to target
    let inIQD = amount;
    if (fromCurrency === 'USD') {
      inIQD = amount * usdRate;
    } else if (fromCurrency === 'IQD') {
      inIQD = amount;
    }

    // Convert from IQD to target
    if (toCurrency === 'USD') {
      return inIQD / usdRate;
    } else if (toCurrency === 'IQD') {
      return inIQD;
    }

    return amount;
  };

  /**
   * Convert amount synchronously (uses cached rates, may be less accurate)
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrency - Source currency code
   * @param {string} toCurrency - Target currency code (defaults to defaultCurrency)
   * @returns {number} Converted amount
   */
  const convertAmountSync = (amount, fromCurrency, toCurrency = null) => {
    if (!amount || amount === 0) return 0;
    if (!fromCurrency) return amount;

    const targetCurrency = toCurrency || defaultCurrency.value;
    if (fromCurrency === targetCurrency) {
      return parseFloat(amount);
    }

    return fallbackConvert(amount, fromCurrency, targetCurrency);
  };

  /**
   * Format currency amount with symbol
   * @param {number} amount - Amount to format
   * @param {string} currency - Currency code (defaults to defaultCurrency)
   * @returns {string} Formatted currency string
   */
  const formatCurrency = (amount, currency = null) => {
    const targetCurrency = currency || defaultCurrency.value;
    const symbol = getCurrencySymbol(targetCurrency);
    const formatted = parseFloat(amount || 0).toLocaleString('en-US', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
      numberingSystem: 'latn',
    });
    return `${formatted} ${symbol}`;
  };

  /**
   * Get currency symbol
   * @param {string} currency - Currency code
   * @returns {string} Currency symbol
   */
  const getCurrencySymbol = (currency) => {
    const symbols = {
      IQD: 'د.ع',
      USD: '$',
      EUR: '€',
      GBP: '£',
    };
    return symbols[currency] || currency;
  };

  /**
   * Convert and format amount to default currency
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrency - Source currency code
   * @returns {Promise<string>} Formatted converted amount
   */
  const convertAndFormat = async (amount, fromCurrency) => {
    const converted = await convertAmount(amount, fromCurrency);
    return formatCurrency(converted);
  };

  /**
   * Convert and format amount synchronously
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrency - Source currency code
   * @returns {string} Formatted converted amount
   */
  const convertAndFormatSync = (amount, fromCurrency) => {
    const converted = convertAmountSync(amount, fromCurrency);
    return formatCurrency(converted);
  };

  return {
    defaultCurrency: computed(() => defaultCurrency.value),
    currencySettings: computed(() => currencySettings.value),
    loading: computed(() => loading.value),
    fetchCurrencySettings,
    initialize,
    convertAmount,
    convertAmountSync,
    formatCurrency,
    getCurrencySymbol,
    convertAndFormat,
    convertAndFormatSync,
  };
}

