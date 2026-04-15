/**
 * Composable for exporting data to various formats
 */

/**
 * Export data to CSV
 * @param {Array} data - Array of objects to export
 * @param {Array} headers - Array of header objects {title, key}
 * @param {String} filename - Output filename
 */
export function exportToCSV(data, headers, filename = 'export.csv') {
  if (!data || data.length === 0) {
    throw new Error('لا توجد بيانات للتصدير');
  }

  // Create header row
  const headerRow = headers.map((h) => h.title).join(',');

  // Create data rows
  const dataRows = data.map((row) => {
    return headers
      .map((h) => {
        const value = h.value ? h.value(row) : row[h.key];
        // Escape commas and quotes
        const stringValue = String(value || '').replace(/"/g, '""');
        return `"${stringValue}"`;
      })
      .join(',');
  });

  // Combine all rows
  const csvContent = [headerRow, ...dataRows].join('\n');

  // Add BOM for Arabic support
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });

  // Download
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export data to Excel (XLSX) using a simple approach
 * Note: For full Excel support, consider using a library like xlsx
 * @param {Array} data - Array of objects to export
 * @param {Array} headers - Array of header objects {title, key}
 * @param {String} filename - Output filename
 */
export function exportToExcel(data, headers, filename = 'export.xlsx') {
  // For now, export as CSV with .xlsx extension
  // In production, use a library like 'xlsx' for proper Excel format
  exportToCSV(data, headers, filename.replace('.xlsx', '.csv'));
}

/**
 * Export table to PDF (basic implementation)
 * Note: For full PDF support, consider using a library like jsPDF or pdfmake
 * @param {HTMLElement} tableElement - Table element to export
 * @param {String} filename - Output filename
 */
export function exportToPDF(tableElement, _filename = 'export.pdf') {
  // This is a placeholder - in production, use a library like jsPDF
  console.warn('PDF export requires a library like jsPDF. Exporting as HTML for now.');

  const htmlContent = tableElement.outerHTML;
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url);
}

/**
 * Composable function for table export
 */
export function useExport() {
  return {
    exportToCSV,
    exportToExcel,
    exportToPDF,
  };
}
