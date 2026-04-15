/**
 * Receipt formatter utility for professional invoice printing
 * Uses table-based layout for better printer compatibility
 * Supports all paper sizes: 58mm, 80mm, 88mm, A4, A5
 * Special layout for installment sales
 */

/**
 * Format currency for receipt display
 */
const formatCurrency = (amount, currency = 'IQD') => {
  const num = Number(amount) || 0;
  if (currency === 'USD') {
    return num.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      numberingSystem: 'latn',
    });
  }
  return Math.round(num).toLocaleString('ar-IQ', {
    style: 'currency',
    currency: 'IQD',
    numberingSystem: 'latn',
  });
};

/**
 * Format date for receipt display
 */
const formatDate = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

/**
 * Format date with 12-hour system for printing
 */
const formatDate12Hour = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // الساعة 0 تصبح 12
  hours = String(hours).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
};

/**
 * Format date only (no time)
 */
const formatDateOnly = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

/**
 * Get paper size configuration based on invoice type
 */
export const getPaperSizeConfig = (invoiceType) => {
  const configs = {
    'roll-58': {
      pageSize: '58mm',
      width: '58mm',
      margin: '0',
      fontSize: 9,
      isThermal: true,
      isSmallReceipt: true, // Small receipt design
    },
    'roll-80': {
      pageSize: '80mm',
      width: '80mm',
      margin: '0',
      fontSize: 10,
      isThermal: true,
      isSmallReceipt: true, // Small receipt design
    },
    'roll-88': {
      pageSize: '88mm',
      width: '88mm',
      margin: '0',
      fontSize: 10,
      isThermal: true,
      isSmallReceipt: true, // Small receipt design
    },
    a4: {
      pageSize: 'A4',
      width: '210mm',
      margin: '10mm',
      fontSize: 12,
      isThermal: false,
      isSmallReceipt: false,
    },
    a5: {
      pageSize: 'A5',
      width: '148mm',
      margin: '8mm',
      fontSize: 11,
      isThermal: false,
      isSmallReceipt: false,
    },
  };

  return configs[invoiceType] || configs['roll-80'];
};

/**
 * Get payment type text in Arabic
 */
const getPaymentTypeText = (type) => {
  const types = {
    cash: 'نقدي',
    installment: 'تقسيط',
    mixed: 'مختلط',
  };
  return types[type] || type;
};

/**
 * Get installment status text
 */
const getInstallmentStatusText = (status) => {
  const statuses = {
    paid: 'مدفوع',
    pending: 'معلق',
    overdue: 'متأخر',
    cancelled: 'ملغي',
  };
  return statuses[status] || status;
};

/**
 * Calculate items subtotal (before invoice discount)
 */
const calculateItemsSubtotal = (items) => {
  if (!items || !Array.isArray(items)) return 0;
  return items.reduce((sum, item) => sum + (item.subtotal || 0), 0);
};

/**
 * Calculate total items discount
 */
const calculateItemsDiscount = (items) => {
  if (!items || !Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const discount = (item.discount || 0) * (item.quantity || 1);
    return sum + discount;
  }, 0);
};

/**
 * Generate receipt HTML structure using tables
 * @param {Object} sale - Sale data
 * @param {Object} company - Company info from settings
 * @returns {Object} Receipt data object with HTML structure
 */
export const formatReceiptData = (sale, company) => {
  if (!sale) {
    throw new Error('Sale data is required');
  }

  if (!company) {
    throw new Error('Company info is required');
  }

  const config = getPaperSizeConfig(company.invoiceType || 'roll-80');
  const currency = sale.currency || 'IQD';
  const isInstallment = sale.paymentType === 'installment';

  // Calculate totals
  const itemsSubtotal = calculateItemsSubtotal(sale.items);
  const itemsDiscount = calculateItemsDiscount(sale.items);
  const invoiceDiscount = sale.discount || 0;
  const totalDiscount = itemsDiscount + invoiceDiscount;

  // Build installments data if applicable
  let installmentsData = null;
  if (isInstallment && sale.installments && sale.installments.length > 0) {
    installmentsData = sale.installments.map((inst, index) => ({
      number: inst.installmentNumber || index + 1,
      dueDate: formatDateOnly(inst.dueDate),
      dueAmount: formatCurrency(inst.dueAmount, currency),
      paidAmount: formatCurrency(inst.paidAmount || 0, currency),
      remainingAmount: formatCurrency(inst.remainingAmount || inst.dueAmount, currency),
      status: getInstallmentStatusText(inst.status),
      isPaid: inst.status === 'paid',
    }));
  }

  // Build receipt data structure
  return {
    config,
    isInstallment,
    company: {
      address: [company.city, company.area, company.street].filter(Boolean).join(' | '),
      name: company.name || 'شركة',
      phones: [company.phone, company.phone2].filter(Boolean),
    },
    invoice: {
      number: sale.invoiceNumber || sale.id,
      date: formatDate(sale.createdAt),
      cashier: sale.createdBy || sale.user?.name || '',
      paymentType: getPaymentTypeText(sale.paymentType),
    },
    customer: {
      name: sale.customerName && sale.customerName !== 'زبون نقدي' ? sale.customerName : null,
      phone: sale.customer?.phone || null,
      address: sale.customer?.address || null,
    },
    items: (sale.items || []).map((item, index) => ({
      index: index + 1,
      name: item.productName || 'منتج',
      description: item.productDescription || null,
      quantity: item.quantity || 0,
      unitPrice: formatCurrency(item.unitPrice || 0, currency),
      discount: item.discount > 0 ? formatCurrency(item.discount * item.quantity, currency) : null,
      subtotal: formatCurrency(item.subtotal || 0, currency),
      notes: item.notes || null,
    })),
    totals: {
      itemsSubtotal: formatCurrency(itemsSubtotal + itemsDiscount, currency),
      itemsDiscount: itemsDiscount > 0 ? formatCurrency(itemsDiscount, currency) : null,
      invoiceDiscount: invoiceDiscount > 0 ? formatCurrency(invoiceDiscount, currency) : null,
      totalDiscount: totalDiscount > 0 ? formatCurrency(totalDiscount, currency) : null,
      // Interest amount only for installment sales
      interestAmount:
        isInstallment && sale.interestAmount > 0
          ? formatCurrency(sale.interestAmount, currency)
          : null,
      grandTotal: formatCurrency(sale.total, currency),
    },
    payment: {
      paidAmount: formatCurrency(sale.paidAmount || 0, currency),
      remainingAmount:
        sale.remainingAmount > 0 ? formatCurrency(sale.remainingAmount, currency) : null,
      installmentsCount:
        isInstallment && sale.installments?.length > 0 ? sale.installments.length : null,
    },
    installments: installmentsData,
    printDate: formatDate12Hour(new Date()),
    theme: company.invoiceTheme || 'classic',
  };
};

/**
 * Generate HTML string from receipt data (for printing)
 * @param {Object} receiptData - Formatted receipt data
 * @returns {string} HTML string
 */
export const generateReceiptHtml = (receiptData) => {
  const {
    config,
    isInstallment,
    company,
    invoice,
    customer,
    items,
    totals,
    payment,
    installments,
    printDate,
  } = receiptData;
  const isSmallReceipt = config.isSmallReceipt;

  // Check if paper width is greater than 88mm to show notes
  // Extract numeric width from config.width (e.g., "88mm" -> 88, "210mm" -> 210)
  const paperWidth = parseInt(config.width) || 80;
  const shouldShowNotes = paperWidth > 88;

  // Build items rows - different layout for small receipts
  const itemsRows = items
    .map((item) => {
      if (isSmallReceipt) {
        // Small receipt: Item & Qty & Price & Total, discount as hint under name
        // Show description and notes only if paper width > 88mm
        return `
        <tr>
          <td class="item-name">
            <div>${item.name}</div>
            ${shouldShowNotes && item.description ? `<div class="item-description">${item.description}</div>` : ''}
            ${shouldShowNotes && item.notes ? `<div class="item-note">${item.notes}</div>` : ''}
            ${item.discount ? `<div class="item-discount-hint">خصم: -${item.discount}</div>` : ''}
          </td>
          <td class="item-qty">${item.quantity}</td>
          <td class="item-price">${item.unitPrice}</td>
          <td class="item-total">${item.subtotal}</td>
        </tr>
      `;
      } else {
        // Large receipt: full layout with description and notes
        return `
        <tr>
          <td class="item-name">
            <div>${item.name}</div>
            ${item.description ? `<div class="item-description">${item.description}</div>` : ''}
            ${item.notes ? `<div class="item-note">${item.notes}</div>` : ''}
            ${item.discount ? `<div class="item-discount">خصم: -${item.discount}</div>` : ''}
          </td>
          <td class="item-qty">${item.quantity}</td>
          <td class="item-price">${item.unitPrice}</td>
          <td class="item-total">${item.subtotal}</td>
        </tr>
      `;
      }
    })
    .join('');

  // Build totals rows
  let totalsHtml = '';

  if (totals.itemsDiscount) {
    totalsHtml += `<div><span>خصم المنتجات:</span><span class="discount">-${totals.itemsDiscount}</span></div>`;
  }

  if (totals.invoiceDiscount) {
    totalsHtml += `<div><span>خصم الفاتورة:</span><span class="discount">-${totals.invoiceDiscount}</span></div>`;
  }

  // Interest amount only for installment sales
  if (isInstallment && totals.interestAmount) {
    totalsHtml += `<div><span>الفائدة المضافة:</span><span class="interest">+${totals.interestAmount}</span></div>`;
  }

  // Build customer section
  let customerHtml = '';
  if (customer.name) {
    customerHtml = `
      <div class="receipt-customer">
        <div><span>العميل:</span><span>${customer.name}</span></div>
        ${customer.phone ? `<div><span>الهاتف:</span><span>${customer.phone}</span></div>` : ''}
        ${customer.address ? `<div><span>العنوان:</span><span>${customer.address}</span></div>` : ''}
      </div>
    `;
  }

  // Build installments table for installment sales
  let installmentsHtml = '';
  if (isInstallment && installments && installments.length > 0) {
    const installmentRows = installments
      .map(
        (inst) => `
      <tr class="${inst.isPaid ? 'paid-row' : ''}">
        <td class="inst-num">${inst.number}</td>
        <td class="inst-date">${inst.dueDate}</td>
        <td class="inst-amount">${inst.dueAmount}</td>
        <td class="inst-status">${inst.status}</td>
      </tr>
    `
      )
      .join('');

    installmentsHtml = `
      <div class="divider"></div>
      
      <div class="installments-section">
        <div class="installments-title">📅 جدول الأقساط</div>
        <table class="installments-table">
          <thead>
            <tr>
              <th class="inst-num">#</th>
              <th class="inst-date">تاريخ الاستحقاق</th>
              <th class="inst-amount">المبلغ</th>
              <th class="inst-status">الحالة</th>
            </tr>
          </thead>
          <tbody>
            ${installmentRows}
          </tbody>
        </table>
      </div>
    `;
  }

  // Different title for installment sales
  const invoiceTitle = isInstallment ? '📋 عقد بيع بالتقسيط' : '🧾 فاتورة مبيعات';
  const invoiceClass = isInstallment ? 'invoice-title installment-title' : 'invoice-title';

  return `
    <div class="receipt-content ${isInstallment ? 'installment-receipt' : ''}">
      <!-- Header -->
      <div class="receipt-header">
      ${company.address ? `<div class="company-info">${company.address}</div>` : ''}
      <div class="company-name">${company.name}</div>
        ${company.phones.length > 0 ? `<div class="company-info">📞 ${company.phones.join(' | ')}</div>` : ''}
      </div>

      <div class="divider"></div>

      <!-- Invoice Title -->
      <div class="${invoiceClass}">${invoiceTitle}</div>
      
      <!-- Invoice Info -->
      <div class="receipt-meta">
        <div><span>رقم الفاتورة:</span><span>${invoice.number}</span></div>
        <div><span>التاريخ:</span><span>${invoice.date}</span></div>
        ${invoice.cashier ? `<div><span>الكاشير:</span><span>${invoice.cashier}</span></div>` : ''}
      </div>

      <div class="divider"></div>

      <!-- Customer (required for installment) -->
      ${customerHtml}
      ${customer.name ? '<div class="divider"></div>' : ''}

      <!-- Items Table -->
      <table class="receipt-items">
        <thead>
          <tr>
            <th class="item-name">المنتج</th>
            <th class="item-qty">الكمية</th>
            <th class="item-price">السعر</th>
            <th class="item-total">المجموع</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div class="divider divider-thick"></div>

      <!-- Totals -->
      <div class="receipt-totals">
        ${totalsHtml ? `<div><span>المجموع الفرعي:</span><span>${totals.itemsSubtotal}</span></div>` : ''}
        ${totalsHtml}
        ${totalsHtml ? '<div class="divider-thin"></div>' : ''}
        <div class="grand-total"><span>الإجمالي:</span><span>${totals.grandTotal}</span></div>
      </div>

      <!-- Installments Table (for installment sales) -->
      ${installmentsHtml}

      <div class="divider"></div>

      <!-- Payment Info -->
      <div class="receipt-payment">
        <div><span>المدفوع:</span><span class="paid">${payment.paidAmount}</span></div>
        ${payment.remainingAmount ? `<div><span>المتبقي:</span><span class="remaining">${payment.remainingAmount}</span></div>` : ''}
        ${payment.installmentsCount ? `<div><span>عدد الأقساط:</span><span>${payment.installmentsCount} قسط</span></div>` : ''}
      </div>

      <div class="divider"></div>

      <!-- Footer -->
      <div class="receipt-footer">
        <div class="thank-you">شكراً لتعاملكم معنا</div>
        ${isInstallment ? '<div class="installment-note">يرجى الالتزام بمواعيد سداد الأقساط</div>' : ''}
        <div class="policy">البضاعة المباعة لا ترد ولا تستبدل</div>
        <div class="print-date">${printDate}</div>
      </div>
    </div>
  `;
};
