export const toYmd = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// toYmd with time
export const toYmdWithTime = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

export const formatCurrency = (amount, currency) =>
  new Intl.NumberFormat('ar', {
    style: 'currency',
    currency: currency || 'IQD',
    maximumFractionDigits: (currency || 'IQD') === 'USD' ? 2 : 0,
  }).format(amount || 0);

// Short currency format for thermal receipts
export const formatCurrencyShort = (val, currency = 'IQD') => {
  const amount = currency === 'USD' ? val?.toFixed(2) : Math.round(val || 0);
  const result = new Intl.NumberFormat('ar', {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: (currency || 'IQD') === 'USD' ? 2 : 0,
  }).format(amount);

  return result.replace(/\s+/g, ' '); // Remove extra spaces
};

// Short date format
export const formatDateShort = (d) => {
  const date = new Date(d);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

// status / labels for sale
export const getStatusColor = (status) => {
  const colors = {
    completed: 'success',
    pending: 'warning',
    cancelled: 'error',
  };
  return colors[status] || 'grey';
};

export const getStatusText = (status) => {
  const texts = {
    completed: 'مكتمل',
    pending: 'قيد الانتظار',
    cancelled: 'ملغي',
  };
  return texts[status] || status;
};

export const getPaymentTypeText = (type) => {
  const types = {
    cash: 'نقدي',
    installment: 'تقسيط',
    mixed: 'مختلط',
  };
  return types[type] || type;
};

export const getPaymentMethodText = (method) => {
  const methods = {
    cash: 'نقدي',
    card: 'بطاقة',
    bank_transfer: 'تحويل بنكي',
  };
  return methods[method] || method;
};

export const getInstallmentStatusLabel = (i) =>
  i.status === 'paid' ? 'مدفوع' : new Date(i.dueDate) < new Date() ? 'متأخر' : 'قيد الانتظار';

export const buildHtmlInvoice = (invoiceContent, css = '') => `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>فاتورة</title>
  <style>
  ${css}
  </style>
</head>
<body>
  <div class="invoice-container">
    ${invoiceContent}
  </div>
</body>
</html>
`;
