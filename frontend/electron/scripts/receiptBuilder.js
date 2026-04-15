/**
 * Receipt Builder for Electron printing
 * Generates HTML for receipt printing and preview
 */

/**
 * Get receipt styles based on paper type and size
 * @param {boolean} isThermal - Whether it's a thermal printer
 * @param {string} paperWidth - Paper width (e.g., '80mm', '210mm')
 * @returns {string} CSS styles
 */
export const getReceiptStyles = (isThermal, paperWidth) => {
  const baseStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
      direction: rtl;
      text-align: right;
      background: white;
      color: #000;
      line-height: 1.6;
    }
    
    .receipt-content {
      width: ${paperWidth};
      max-width: 100%;
      margin: 0 auto;
      padding: ${isThermal ? '5px' : '15px'};
      background: white;
    }
    
    /* Header */
    .receipt-header {
      text-align: center;
      margin-bottom: ${isThermal ? '8px' : '15px'};
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    
    .company-name {
      font-size: ${isThermal ? '14px' : '18px'};
      font-weight: 700;
      margin-bottom: ${isThermal ? '4px' : '8px'};
      color: #000;
      order: 1;
    }
    
    .company-info {
      font-size: ${isThermal ? '9px' : '11px'};
      color: #333;
      order: 2;
      margin: ${isThermal ? '2px 0' : '4px 0'};
    }
    
    /* Dividers */
    .divider {
      border-top: 1px dashed #000;
      margin: ${isThermal ? '6px 0' : '10px 0'};
    }
    
    .divider-thick {
      border-top: 2px solid #000;
      margin: ${isThermal ? '8px 0' : '12px 0'};
    }
    
    .divider-thin {
      border-top: 1px solid #ccc;
      margin: ${isThermal ? '4px 0' : '6px 0'};
    }
    
    /* Invoice Title */
    .invoice-title {
      text-align: center;
      font-size: ${isThermal ? '12px' : '16px'};
      font-weight: 700;
      margin: ${isThermal ? '6px 0' : '10px 0'};
      color: #000;
    }
    
    .installment-title {
      color: #1976d2;
    }
    
    /* Meta Info */
    .receipt-meta {
      font-size: ${isThermal ? '9px' : '11px'};
      margin: ${isThermal ? '6px 0' : '10px 0'};
    }
    
    .receipt-meta > div {
      display: flex;
      justify-content: space-between;
      margin: ${isThermal ? '3px 0' : '5px 0'};
    }
    
    /* Customer */
    .receipt-customer {
      font-size: ${isThermal ? '9px' : '11px'};
      margin: ${isThermal ? '6px 0' : '10px 0'};
      padding: ${isThermal ? '4px' : '8px'};
      background: #f5f5f5;
      border-radius: 4px;
    }
    
    .receipt-customer > div {
      display: flex;
      justify-content: space-between;
      margin: ${isThermal ? '3px 0' : '5px 0'};
    }
    
    /* Items Table */
    .receipt-items {
      width: 100%;
      border-collapse: collapse;
      margin: ${isThermal ? '6px 0' : '10px 0'};
      font-size: ${isThermal ? '9px' : '11px'};
    }
    
    .receipt-items thead {
      border-bottom: 2px solid #000;
    }
    
    .receipt-items th {
      padding: ${isThermal ? '4px 2px' : '6px 4px'};
      text-align: right;
      font-weight: 700;
      border-bottom: 1px solid #000;
    }
    
    .receipt-items td {
      padding: ${isThermal ? '3px 2px' : '5px 4px'};
      text-align: right;
      border-bottom: 1px dotted #ccc;
    }
    
    .item-name {
      text-align: right;
    }
    
    .item-discount-hint {
      font-size: ${isThermal ? '7px' : '9px'};
      color: #666;
      margin-top: 2px;
    }
    
    .item-discount {
      font-size: ${isThermal ? '8px' : '10px'};
      color: #d32f2f;
      margin-top: 2px;
    }
    
    .item-description {
      font-size: ${isThermal ? '8px' : '10px'};
      color: #555;
      margin-top: 2px;
      font-style: normal;
    }
    
    .item-note {
      font-size: ${isThermal ? '8px' : '10px'};
      color: #666;
      font-style: italic;
      margin-top: 2px;
    }
    
    /* Totals */
    .receipt-totals {
      font-size: ${isThermal ? '10px' : '12px'};
      margin: ${isThermal ? '8px 0' : '12px 0'};
    }
    
    .receipt-totals > div {
      display: flex;
      justify-content: space-between;
      margin: ${isThermal ? '4px 0' : '6px 0'};
    }
    
    .receipt-totals .discount {
      color: #d32f2f;
    }
    
    .receipt-totals .interest {
      color: #1976d2;
    }
    
    .grand-total {
      font-size: ${isThermal ? '12px' : '16px'};
      font-weight: 700;
      margin-top: ${isThermal ? '6px' : '10px'};
      padding-top: ${isThermal ? '6px' : '10px'};
      border-top: 2px solid #000;
    }
    
    /* Payment Info */
    .receipt-payment {
      font-size: ${isThermal ? '10px' : '12px'};
      margin: ${isThermal ? '8px 0' : '12px 0'};
    }
    
    .receipt-payment > div {
      display: flex;
      justify-content: space-between;
      margin: ${isThermal ? '4px 0' : '6px 0'};
    }
    
    .receipt-payment .paid {
      color: #2e7d32;
      font-weight: 600;
    }
    
    .receipt-payment .remaining {
      color: #d32f2f;
      font-weight: 600;
    }
    
    /* Installments */
    .installments-section {
      margin: ${isThermal ? '8px 0' : '12px 0'};
    }
    
    .installments-title {
      font-size: ${isThermal ? '10px' : '12px'};
      font-weight: 700;
      text-align: center;
      margin-bottom: ${isThermal ? '6px' : '8px'};
    }
    
    .installments-table {
      width: 100%;
      border-collapse: collapse;
      font-size: ${isThermal ? '8px' : '10px'};
      margin-top: ${isThermal ? '4px' : '6px'};
    }
    
    .installments-table th {
      padding: ${isThermal ? '3px 2px' : '5px 4px'};
      text-align: center;
      font-weight: 700;
      border: 1px solid #000;
      background: #f5f5f5;
    }
    
    .installments-table td {
      padding: ${isThermal ? '3px 2px' : '5px 4px'};
      text-align: center;
      border: 1px solid #ccc;
    }
    
    .installments-table .paid-row {
      background: #e8f5e9;
    }
    
    .inst-num {
      width: 10%;
    }
    
    .inst-date {
      width: 30%;
    }
    
    .inst-amount {
      width: 30%;
    }
    
    .inst-status {
      width: 30%;
    }
    
    /* Footer */
    .receipt-footer {
      text-align: center;
      font-size: ${isThermal ? '9px' : '11px'};
      margin-top: ${isThermal ? '8px' : '12px'};
      color: #666;
    }
    
    .thank-you {
      font-size: ${isThermal ? '10px' : '12px'};
      font-weight: 600;
      margin: ${isThermal ? '6px 0' : '8px 0'};
      color: #000;
    }
    
    .installment-note {
      color: #d32f2f;
      font-weight: 600;
      margin: ${isThermal ? '4px 0' : '6px 0'};
    }
    
    .policy {
      margin: ${isThermal ? '4px 0' : '6px 0'};
    }
    
    .print-date {
      margin-top: ${isThermal ? '6px' : '8px'};
      font-size: ${isThermal ? '8px' : '10px'};
    }
    
    .watermark-text {
      font-size: ${isThermal ? '10px' : '12px'};
      font-weight: 700;
      color: #d32f2f;
      background: #ffebee;
      border: 2px dashed #d32f2f;
      padding: ${isThermal ? '4px' : '6px'};
      margin-bottom: ${isThermal ? '6px' : '8px'};
      text-align: center;
      border-radius: 4px;
    }
    
    /* Print Styles */
    @media print {
      body {
        background: white;
      }
      
      .receipt-content {
        width: 100%;
        padding: 25px;
      }
      
      @page {
        margin: 0;
        size: ${paperWidth} auto;
      }
    }
  `;

  return baseStyles;
};

/**
 * Get receipt styles based on theme
 * @param {boolean} isThermal - Whether it's a thermal printer
 * @param {string} paperWidth - Paper width (e.g., '80mm', '210mm')
 * @param {string} theme - Theme name ('classic', 'modern', 'minimal', 'professional', 'colorful')
 * @returns {string} CSS styles
 */
export const getReceiptStylesByTheme = (isThermal, paperWidth, theme = 'classic') => {
  const baseStyles = getReceiptStyles(isThermal, paperWidth);

  // Calculate spacing based on paper width (58mm, 80mm, 88mm, A5, A4)
  const paperWidthNum = parseInt(paperWidth) || 80;
  let headerPadding,
    headerMargin,
    dividerMargin,
    titlePadding,
    metaPadding,
    itemPadding,
    totalsPadding,
    paymentPadding,
    titleFontSize,
    nameFontSize,
    metaFontSize;

  if (paperWidthNum <= 58) {
    // 58mm - Very compact
    headerPadding = '4px';
    headerMargin = '4px';
    dividerMargin = '3px 0';
    titlePadding = '2px';
    metaPadding = '3px';
    itemPadding = '3px 2px';
    totalsPadding = '4px';
    paymentPadding = '4px';
    titleFontSize = '10px';
    nameFontSize = '12px';
    metaFontSize = '8px';
  } else if (paperWidthNum <= 80) {
    // 80mm - Compact
    headerPadding = '6px';
    headerMargin = '6px';
    dividerMargin = '4px 0';
    titlePadding = '3px';
    metaPadding = '4px';
    itemPadding = '4px 3px';
    totalsPadding = '6px';
    paymentPadding = '6px';
    titleFontSize = '11px';
    nameFontSize = '13px';
    metaFontSize = '9px';
  } else if (paperWidthNum <= 88) {
    // 88mm - Medium
    headerPadding = '8px';
    headerMargin = '8px';
    dividerMargin = '5px 0';
    titlePadding = '4px';
    metaPadding = '5px';
    itemPadding = '5px 4px';
    totalsPadding = '8px';
    paymentPadding = '8px';
    titleFontSize = '12px';
    nameFontSize = '14px';
    metaFontSize = '9px';
  } else if (paperWidthNum <= 148) {
    // A5 - Medium-Large
    headerPadding = '10px';
    headerMargin = '10px';
    dividerMargin = '6px 0';
    titlePadding = '5px';
    metaPadding = '6px';
    itemPadding = '6px 5px';
    totalsPadding = '10px';
    paymentPadding = '10px';
    titleFontSize = '14px';
    nameFontSize = '16px';
    metaFontSize = '10px';
  } else {
    // A4 - Large
    headerPadding = '12px';
    headerMargin = '12px';
    dividerMargin = '8px 0';
    titlePadding = '6px';
    metaPadding = '8px';
    itemPadding = '8px 6px';
    totalsPadding = '12px';
    paymentPadding = '12px';
    titleFontSize = '16px';
    nameFontSize = '18px';
    metaFontSize = '11px';
  }

  // Theme-specific overrides - 3 Professional Templates (No shadows, muted colors, optimized spacing)
  const themeStyles = {
    classic: `
      /* Classic Traditional Theme - Clean and Professional */
      .receipt-header {
        background: #f8f9fa;
        padding: ${headerPadding};
        border: 1px solid #dee2e6;
        margin-bottom: ${headerMargin};
      }
      .company-name {
        font-weight: 700;
        color: #212529;
        font-size: ${nameFontSize};
      }
      .company-info {
        color: #495057;
        font-size: ${metaFontSize};
      }
      .divider {
        border-top: 1px solid #495057;
        border-bottom: 1px solid #dee2e6;
        margin: ${dividerMargin};
      }
      .divider-thick {
        border-top: 2px solid #495057;
      }
      .invoice-title {
        font-weight: 700;
        color: #212529;
        border-bottom: 2px solid #495057;
        padding-bottom: ${titlePadding};
        font-size: ${titleFontSize};
      }
      .receipt-meta {
        font-size: ${metaFontSize};
        color: #495057;
        padding: ${metaPadding};
      }
      .receipt-items th {
        background: #e9ecef;
        border: 1px solid #ced4da;
        font-weight: 700;
        color: #212529;
        padding: ${itemPadding};
        font-size: ${metaFontSize};
      }
      .receipt-items td {
        border: 1px solid #dee2e6;
        color: #212529;
        padding: ${itemPadding};
      }
      .receipt-items tr:nth-child(even) {
        background: #f8f9fa;
      }
      .receipt-totals {
        background: #e9ecef;
        padding: ${totalsPadding};
        border: 1px solid #ced4da;
      }
      .receipt-payment {
        background: #f8f9fa;
        padding: ${paymentPadding};
        border: 1px solid #dee2e6;
      }
      .receipt-payment .paid {
        color: #198754;
        font-weight: 700;
      }
      .receipt-payment .remaining {
        color: #dc3545;
        font-weight: 700;
      }
    `,
    modern: `
      /* Modern Elegant Theme - Contemporary Professional */
      .receipt-header {
        background: #5a6c7d;
        color: #ffffff;
        padding: ${headerPadding};
        border: 1px solid #495057;
        margin-bottom: ${headerMargin};
      }
      .company-name {
        font-weight: 700;
        color: #ffffff;
        letter-spacing: 0.5px;
        font-size: ${nameFontSize};
      }
      .company-info {
        color: #e9ecef;
        font-size: ${metaFontSize};
      }
      .divider {
        border-top: 2px solid #5a6c7d;
        border-bottom: none;
        margin: ${dividerMargin};
      }
      .divider-thick {
        border-top: 3px solid #5a6c7d;
      }
      .invoice-title {
        color: #5a6c7d;
        font-weight: 700;
        font-size: ${titleFontSize};
        letter-spacing: 0.5px;
      }
      .receipt-meta {
        font-size: ${metaFontSize};
        color: #495057;
        padding: ${metaPadding};
      }
      .receipt-items th {
        background: #5a6c7d;
        color: #ffffff;
        border: 1px solid #495057;
        font-weight: 700;
        padding: ${itemPadding};
        font-size: ${metaFontSize};
      }
      .receipt-items td {
        border-bottom: 1px solid #dee2e6;
        color: #212529;
        padding: ${itemPadding};
      }
      .receipt-items tr:nth-child(even) {
        background: #f8f9fa;
      }
      .receipt-totals {
        background: #e9ecef;
        border: 2px solid #5a6c7d;
        padding: ${totalsPadding};
      }
      .receipt-payment {
        background: #f8f9fa;
        border: 1px solid #5a6c7d;
        padding: ${paymentPadding};
      }
      .receipt-payment .paid {
        color: #198754;
        font-weight: 700;
      }
      .receipt-payment .remaining {
        color: #dc3545;
        font-weight: 700;
      }
    `,
    professional: `
      /* Professional Corporate Theme - Business Style */
      .receipt-header {
        background: #2c3e50;
        color: #ffffff;
        padding: ${headerPadding};
        border: 2px solid #1a252f;
        margin-bottom: ${headerMargin};
      }
      .company-name {
        font-weight: 800;
        color: #ffffff;
        text-transform: uppercase;
        letter-spacing: 1px;
        font-size: ${nameFontSize};
        border-bottom: 2px solid #ffffff;
        padding-bottom: ${titlePadding};
        margin-bottom: ${titlePadding};
      }
      .company-info {
        color: #ecf0f1;
        font-weight: 500;
        font-size: ${metaFontSize};
      }
      .divider {
        border-top: 2px solid #2c3e50;
        border-bottom: 1px solid #bdc3c7;
        margin: ${dividerMargin};
      }
      .divider-thick {
        border-top: 3px solid #2c3e50;
      }
      .invoice-title {
        font-weight: 800;
        text-transform: uppercase;
        color: #2c3e50;
        font-size: ${titleFontSize};
        letter-spacing: 0.5px;
        border: 2px solid #2c3e50;
        padding: ${titlePadding};
        background: #ecf0f1;
      }
      .receipt-meta {
        background: #ecf0f1;
        padding: ${metaPadding};
        border: 1px solid #bdc3c7;
        font-weight: 600;
        font-size: ${metaFontSize};
        color: #2c3e50;
      }
      .receipt-items th {
        background: #2c3e50;
        color: #ffffff;
        border: 1px solid #1a252f;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: ${itemPadding};
        font-size: ${metaFontSize};
      }
      .receipt-items td {
        border: 1px solid #bdc3c7;
        font-weight: 500;
        color: #2c3e50;
        padding: ${itemPadding};
      }
      .receipt-items tr:nth-child(even) {
        background: #ecf0f1;
      }
      .receipt-totals {
        background: #2c3e50;
        color: #ffffff;
        border: 2px solid #1a252f;
        padding: ${totalsPadding};
        font-weight: 700;
      }
      .receipt-totals span {
        color: #ffffff;
      }
      .receipt-payment {
        background: #ecf0f1;
        padding: ${paymentPadding};
        border: 2px solid #2c3e50;
        font-weight: 700;
      }
      .receipt-payment .paid {
        color: #27ae60;
        font-weight: 700;
      }
      .receipt-payment .remaining {
        color: #e74c3c;
        font-weight: 700;
      }
    `,
  };

  return baseStyles + (themeStyles[theme] || themeStyles.classic);
};

/**
 * Generate receipt body HTML from formatted receipt data
 * @param {Object} receiptData - Formatted receipt data from formatReceiptData()
 * @returns {string} HTML body content
 */
export const generateReceiptBodyHtml = (receiptData) => {
  const {
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
  const isSmallReceipt = receiptData.config?.isSmallReceipt || false;

  // Check if paper width is greater than 88mm to show notes
  // Extract numeric width from config.width (e.g., "88mm" -> 88, "210mm" -> 210)
  const paperWidth = parseInt(receiptData.config?.width) || 80;
  const shouldShowNotes = paperWidth > 88;

  // Build items rows
  const itemsRows = items
    .map((item) => {
      if (isSmallReceipt) {
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
        return `
        <tr>
          <td class="item-name">
            <div>${item.name}</div>
            ${item.description ? `<div class="item-description">${item.description}</div>` : ''}
            ${item.discount ? `<div class="item-discount">خصم: -${item.discount}</div>` : '<div class="item-discount">خصم: 0</div>'}
          </td>
          <td class="item-qty">${item.quantity}</td>
          <td class="item-notes">${item.notes ? `<div class="item-note">${item.notes}</div>` : 'لا يوجد ملاحظات'}</td>
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

  // Build installments table
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

  const invoiceTitle = isInstallment ? 'عقد بيع بالتقسيط' : 'فاتورة مبيعات';
  const invoiceClass = isInstallment ? 'invoice-title installment-title' : 'invoice-title';

  return `
    <div class="receipt-content ${isInstallment ? 'installment-receipt' : ''}">
      <!-- Header -->
      <div class="receipt-header">
      ${company.address ? `<div class="company-info">${company.address}</div>` : ''}
      <div class="company-name">${company.name}</div>
        ${company.phones.length > 0 ? `<div class="company-info">${company.phones.join(' | ')}</div>` : ''}
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

      <!-- Customer -->
      ${customerHtml}
      ${customer.name ? '<div class="divider"></div>' : ''}

      <!-- Items Table -->
      <table class="receipt-items">
        <thead>
          <tr>
            <th class="item-name">المنتج</th>
            <th class="item-qty">الكمية</th>
            ${shouldShowNotes ? '<th class="item-notes">الملاحظات</th>' : ''}
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

      <!-- Installments Table -->
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

/**
 * Generate complete HTML document for printing
 * @param {Object} receiptData - Formatted receipt data from formatReceiptData()
 * @param {string} invoiceType - Invoice type (roll-58, roll-80, roll-88, a4, a5)
 * @param {string} invoiceTheme - Invoice theme (classic, modern, minimal, professional, colorful)
 * @returns {string} Complete HTML document
 */
export const generateReceiptHtml = (receiptData, invoiceType, invoiceTheme = 'classic') => {
  const isThermal = invoiceType.startsWith('roll-');

  // Get paper width based on invoice type
  const paperWidths = {
    'roll-58': '58mm',
    'roll-80': '80mm',
    'roll-88': '88mm',
    a4: '210mm',
    a5: '148mm',
  };

  const paperWidth = paperWidths[invoiceType] || '80mm';

  // Use theme from receiptData if available, otherwise use parameter
  const theme = receiptData?.theme || invoiceTheme || 'classic';
  const receiptStyles = getReceiptStylesByTheme(isThermal, paperWidth, theme);
  const receiptBody = generateReceiptBodyHtml(receiptData);

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>فاتورة مبيعات</title>
  <style>
    ${receiptStyles}
  </style>
</head>
<body>
  ${receiptBody}
</body>
</html>`;
};
