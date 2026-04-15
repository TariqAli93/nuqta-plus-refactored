/**
 * Utility functions for formatting dates, numbers, and currencies
 */

/**
 * Format date in Arabic locale
 * @param {Date|String} date - Date to format
 * @param {Object} options - Intl.DateTimeFormat options
 */
export function formatDate(date, options = {}) {
  if (!date) return '';

  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return '';

  const defaultOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    numberingSystem: 'latn',
  };

  return new Intl.DateTimeFormat('ar', { ...defaultOptions, ...options }).format(dateObj);
}

/**
 * Format date and time in Arabic locale
 * @param {Date|String} date - Date to format
 */
export function formatDateTime(date) {
  return formatDate(date, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    numberingSystem: 'latn',
  });
}

/**
 * Format number with thousand separators
 * @param {Number} number - Number to format
 * @param {Number} decimals - Number of decimal places
 */
export function formatNumber(number, decimals = 2) {
  if (number === null || number === undefined || isNaN(number)) return '0';

  return new Intl.NumberFormat('ar', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    numberingSystem: 'latn',
  }).format(number);
}

/**
 * Format currency
 * @param {Number} amount - Amount to format
 * @param {String} currency - Currency code (IQD, USD)
 * @param {Number} decimals - Number of decimal places
 */
export function formatCurrency(amount, currency = 'IQD', decimals = 2) {
  if (amount === null || amount === undefined || isNaN(amount)) return '0';

  const symbol = currency === 'USD' ? '$' : 'د.ع';

  return `${symbol} ${formatNumber(amount, decimals)}`;
}

/**
 * Format relative time (e.g., "منذ ساعتين")
 * @param {Date|String} date - Date to format
 */
export function formatRelativeTime(date) {
  if (!date) return '';

  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return '';

  const now = new Date();
  const diffMs = now - dateObj;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  if (diffDays < 7) return `منذ ${diffDays} يوم`;

  return formatDate(dateObj);
}

/**
 * Parse number from formatted string
 * @param {String} value - Formatted number string
 */
export function parseNumber(value) {
  if (!value) return 0;
  const numStr = String(value)
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '');
  const num = parseFloat(numStr);
  return isNaN(num) ? 0 : num;
}
