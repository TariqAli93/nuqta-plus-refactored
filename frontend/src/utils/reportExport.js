/**
 * Shared export mapping for accounting reports.
 *
 * `buildExportRows(reportType, data, options)` is the SINGLE source of truth
 * consumed by both the Excel and the PDF exporters, so the two formats can
 * never drift apart or export different / empty data.
 *
 * It returns plain JS objects/arrays (never reactive Vue proxies), with:
 *   - Arabic column headers
 *   - numbers kept as numbers (so Excel totals/prices stay numeric)
 *   - fallback values for null/undefined fields
 *   - nested report data flattened into row arrays
 */

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const text = (v, fallback = '—') => {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
};

/** Format an ISO/Date value as a localised date string (for display/meta). */
export function formatDate(value, withTime = false) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('ar-IQ', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      numberingSystem: 'latn',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(d);
  } catch {
    return String(value);
  }
}

/** Format a number for human display (PDF / fallbacks). */
export function formatNumber(value) {
  return toNumber(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const NULLABLE = '__nullable__';

function dashboardSections(data, options) {
  const { canViewProfit = true } = options;
  const kpis = Object.entries(data.kpisByCurrency || {});
  const inventory = data.inventory || {};
  const customers = data.customersDebt || {};
  const installments = data.installmentsSummary || {};
  const expenses = data.expensesSummary || {};

  const sections = [];

  // --- Multi-currency summary ---------------------------------------------
  const summaryColumns = [
    { key: 'currency', header: 'العملة', type: 'text' },
    { key: 'sales', header: 'إجمالي المبيعات', type: 'number' },
    { key: 'collected', header: 'المبالغ المحصّلة', type: 'number' },
    { key: 'refunded', header: 'المبالغ المرجعة', type: 'number' },
    { key: 'netCollected', header: 'صافي التحصيل', type: 'number' },
    { key: 'unpaid', header: 'الديون المتبقية', type: 'number' },
    { key: 'overdueAmount', header: 'مبالغ متأخرة', type: 'number' },
  ];
  if (canViewProfit) {
    summaryColumns.push({ key: 'netProfit', header: 'صافي الربح', type: 'number', nullable: true });
  }
  sections.push({
    id: 'summary',
    title: 'الملخص متعدد العملات',
    columns: summaryColumns,
    rows: kpis.map(([cur, k]) => {
      const refunded = toNumber(k.refundedAmount);
      return {
        currency: text(cur),
        sales: toNumber(k.sales),
        collected: toNumber(k.totalPaid),
        refunded,
        netCollected:
          k.netCollected !== undefined ? toNumber(k.netCollected) : toNumber(k.totalPaid) - refunded,
        unpaid: toNumber(k.unpaidBalances),
        overdueAmount: toNumber(k.lateAmounts),
        netProfit:
          k.netProfit === null || k.netProfit === undefined ? NULLABLE : toNumber(k.netProfit),
      };
    }),
  });

  // --- Sales by currency ---------------------------------------------------
  sections.push({
    id: 'sales',
    title: 'المبيعات حسب العملة',
    columns: [
      { key: 'currency', header: 'العملة', type: 'text' },
      { key: 'sales', header: 'إجمالي المبيعات', type: 'number' },
      { key: 'cashSales', header: 'نقدًا', type: 'number' },
      { key: 'installmentSales', header: 'بالأقساط', type: 'number' },
      { key: 'discounts', header: 'الخصومات', type: 'number' },
      { key: 'netSales', header: 'صافي المبيعات', type: 'number' },
      { key: 'returnedCancelled', header: 'الملغاة/المرتجعة', type: 'number' },
    ],
    rows: kpis.map(([cur, k]) => ({
      currency: text(cur),
      sales: toNumber(k.sales),
      cashSales: toNumber(k.cashSales),
      installmentSales: toNumber(k.installmentSales),
      discounts: toNumber(k.discounts),
      netSales: toNumber(k.netSales),
      returnedCancelled: toNumber(k.returnedCancelled),
    })),
  });

  // --- Payments by currency -----------------------------------------------
  sections.push({
    id: 'payments',
    title: 'الدفعات حسب العملة',
    columns: [
      { key: 'currency', header: 'العملة', type: 'text' },
      { key: 'totalPaid', header: 'المبالغ المحصّلة', type: 'number' },
      { key: 'refundedAmount', header: 'المبالغ المرجعة', type: 'number' },
      { key: 'netCollected', header: 'صافي التحصيل', type: 'number' },
      { key: 'cashPayments', header: 'نقدًا', type: 'number' },
      { key: 'cardPayments', header: 'بطاقة', type: 'number' },
      { key: 'transferPayments', header: 'تحويل', type: 'number' },
      { key: 'installmentCollections', header: 'تحصيل أقساط', type: 'number' },
    ],
    rows: kpis.map(([cur, k]) => {
      const refunded = toNumber(k.refundedAmount);
      return {
        currency: text(cur),
        totalPaid: toNumber(k.totalPaid),
        refundedAmount: refunded,
        netCollected:
          k.netCollected !== undefined ? toNumber(k.netCollected) : toNumber(k.totalPaid) - refunded,
        cashPayments: toNumber(k.cashPayments),
        cardPayments: toNumber(k.cardPayments),
        transferPayments: toNumber(k.transferPayments),
        installmentCollections: toNumber(k.installmentCollections),
      };
    }),
  });

  // --- Installments by currency -------------------------------------------
  sections.push({
    id: 'installments',
    title: 'الأقساط حسب العملة',
    columns: [
      { key: 'currency', header: 'العملة', type: 'text' },
      { key: 'dueInstallments', header: 'مستحقة', type: 'int' },
      { key: 'overdueInstallments', header: 'متأخرة', type: 'int' },
      { key: 'paidInstallments', header: 'مدفوعة', type: 'int' },
      { key: 'expectedCollections', header: 'المتوقع تحصيله', type: 'number' },
      { key: 'lateAmounts', header: 'مبالغ متأخرة', type: 'number' },
    ],
    rows: kpis.map(([cur, k]) => ({
      currency: text(cur),
      dueInstallments: toNumber(k.dueInstallments),
      overdueInstallments: toNumber(k.overdueInstallments),
      paidInstallments: toNumber(k.paidInstallments),
      expectedCollections: toNumber(k.expectedCollections),
      lateAmounts: toNumber(k.lateAmounts),
    })),
  });

  // --- Customer delay stats ------------------------------------------------
  const delay = installments.customerDelayStats || [];
  if (delay.length) {
    sections.push({
      id: 'delay',
      title: 'متوسط تأخير العملاء',
      columns: [
        { key: 'customerName', header: 'العميل', type: 'text' },
        { key: 'avgDelayDays', header: 'متوسط أيام التأخير', type: 'number' },
        { key: 'lateCount', header: 'عدد التأخيرات', type: 'int', total: true },
      ],
      rows: delay.map((r) => ({
        customerName: text(r.customerName),
        avgDelayDays: Number(toNumber(r.avgDelayDays).toFixed(1)),
        lateCount: toNumber(r.lateCount),
      })),
    });
  }

  // --- Expenses ------------------------------------------------------------
  if (expenses.supported && (expenses.byCategory || []).length) {
    sections.push({
      id: 'expenses',
      title: 'المصاريف حسب الفئة',
      columns: [
        { key: 'category', header: 'الفئة', type: 'text' },
        { key: 'currency', header: 'العملة', type: 'text' },
        { key: 'total', header: 'الإجمالي', type: 'number' },
      ],
      rows: (expenses.byCategory || []).map((r) => ({
        category: text(r.category),
        currency: text(r.currency),
        total: toNumber(r.total),
      })),
    });
  }

  // --- Inventory: low / out of stock --------------------------------------
  const stockColumns = [
    { key: 'productName', header: 'المنتج', type: 'text' },
    { key: 'warehouseName', header: 'المخزن', type: 'text' },
    { key: 'quantity', header: 'الكمية', type: 'number', total: true },
    { key: 'minStock', header: 'الحد الأدنى', type: 'number' },
  ];
  const mapStock = (list) =>
    (list || []).map((p) => ({
      productName: text(p.productName),
      warehouseName: text(p.warehouseName),
      quantity: toNumber(p.quantity),
      minStock: toNumber(p.minStock),
    }));
  sections.push({
    id: 'lowStock',
    title: 'منتجات منخفضة المخزون',
    columns: stockColumns,
    rows: mapStock(inventory.lowStockProducts),
  });
  sections.push({
    id: 'outOfStock',
    title: 'منتجات نفدت من المخزون',
    columns: stockColumns,
    rows: mapStock(inventory.outOfStockProducts),
  });

  // --- Customers: debt / paying -------------------------------------------
  sections.push({
    id: 'topDebt',
    title: 'أعلى العملاء مديونية',
    columns: [
      { key: 'customerName', header: 'العميل', type: 'text' },
      { key: 'totalDebt', header: 'إجمالي المديونية', type: 'number' },
      { key: 'totalPurchases', header: 'إجمالي المشتريات', type: 'number' },
    ],
    rows: (customers.topDebtCustomers || []).map((c) => ({
      customerName: text(c.customerName),
      totalDebt: toNumber(c.totalDebt),
      totalPurchases: toNumber(c.totalPurchases),
    })),
  });
  sections.push({
    id: 'topPaying',
    title: 'أعلى العملاء تسديدًا',
    columns: [
      { key: 'customerName', header: 'العميل', type: 'text' },
      { key: 'paid', header: 'المبلغ المسدد', type: 'number' },
      { key: 'currency', header: 'العملة', type: 'text' },
    ],
    rows: (customers.topPayingCustomers || []).map((c) => ({
      customerName: text(c.customerName),
      paid: toNumber(c.paid),
      currency: text(c.currency),
    })),
  });

  return sections;
}

/**
 * Map raw report data into export-ready sections.
 * @returns {{ reportType, title, meta, sections }} where each section is
 *   { id, title, columns:[{key,header,type,nullable?,total?}], rows:[{...}] }
 */
export function buildExportRows(reportType, data, options = {}) {
  const safeData = data || {};
  let sections = [];

  switch (reportType) {
    case 'dashboard':
    case 'accounting-report':
    default:
      sections = dashboardSections(safeData, options);
      break;
  }

  // Drop empty sections so we never export blank placeholder tables.
  sections = sections.filter((s) => Array.isArray(s.rows) && s.rows.length > 0);

  return {
    reportType,
    title: options.title || 'التقرير المحاسبي',
    meta: {
      dateFrom: options.dateFrom || '',
      dateTo: options.dateTo || '',
      currency: options.currency || 'ALL',
      branchLabel: options.branchLabel || 'كل الفروع',
      userName: options.userName || '',
      generatedAt: options.generatedAt || safeData?.meta?.generatedAt || '',
    },
    sections,
  };
}

/** Total row count across all sections (used to disable export when empty). */
export function totalRowCount(built) {
  if (!built || !Array.isArray(built.sections)) return 0;
  return built.sections.reduce((sum, s) => sum + (s.rows?.length || 0), 0);
}

/** Display string for a single cell value, honouring its column type. */
export function displayCell(value, type) {
  if (value === NULLABLE) return 'غير متاح';
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'number') return formatNumber(value);
  if (type === 'int') return String(toNumber(value));
  if (type === 'date') return formatDate(value);
  return String(value);
}

/** Raw value for Excel cells: numbers stay numeric, nullable -> blank. */
export function excelCell(value, type) {
  if (value === NULLABLE) return null;
  if (value === null || value === undefined) return type === 'text' ? '' : null;
  if (type === 'number' || type === 'int') return toNumber(value);
  if (type === 'date') return formatDate(value);
  return String(value);
}

/** Compute summed totals for columns flagged `total: true`. */
export function sectionTotals(section) {
  const totalCols = (section.columns || []).filter((c) => c.total);
  if (!totalCols.length) return null;
  const totals = {};
  for (const col of totalCols) {
    totals[col.key] = section.rows.reduce((sum, r) => sum + toNumber(r[col.key]), 0);
  }
  return totals;
}

export { NULLABLE };
