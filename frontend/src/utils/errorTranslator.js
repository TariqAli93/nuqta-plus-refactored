// Centralized Arabic error message builder for Axios responses

function translateErrorName(name = '') {
  const map = {
    ValidationError: 'خطأ في التحقق من البيانات',
    AuthenticationError: 'خطأ في المصادقة',
    AuthorizationError: 'صلاحيات غير كافية',
    NotFoundError: 'العنصر غير موجود',
    ConflictError: 'تعارض في البيانات',
    'Internal Server Error': 'خطأ داخلي في الخادم',
    Unauthorized: 'غير مصرح',
    Forbidden: 'ممنوع',
    'Not Found': 'غير موجود',
  };
  return map[name] || name;
}

function translateGenericMessage(message = '') {
  if (!message) return '';
  const patterns = [
    [/Invalid request data/i, 'بيانات غير صالحة'],
    [/already exists/i, 'القيمة موجودة مسبقًا'],
    [/not found/i, 'غير موجود'],
    [/Invalid username or password/i, 'اسم المستخدم أو كلمة المرور غير صحيحة'],
    [/User not found or inactive/i, 'المستخدم غير موجود أو غير مُفعل'],
    [/Permission denied:?\s*/i, 'تم رفض الإذن: '],
    [/Authentication required/i, 'يتطلب تسجيل الدخول'],
    [/An unexpected error occurred/i, 'حدث خطأ غير متوقع'],
    [/Route (GET|POST|PUT|DELETE):.* not found/i, 'المسار المطلوب غير موجود'],
  ];
  for (const [re, ar] of patterns) {
    if (re.test(message)) return message.replace(re, ar);
  }
  return message;
}

function translateZodDetailMessage(msg = '') {
  if (!msg) return '';
  const patterns = [
    [/Required/i, 'مطلوب'],
    [/Invalid type/i, 'نوع غير صالح'],
    [/Too short/i, 'قصير جدًا'],
    [/Too long/i, 'طويل جدًا'],
    [/Must be positive/i, 'يجب أن يكون موجبًا'],
    [/Number must be greater than or equal to\s*(\d+)/i, 'الرقم يجب أن يكون أكبر أو يساوي $1'],
    [/Number must be less than or equal to\s*(\d+)/i, 'الرقم يجب أن يكون أقل أو يساوي $1'],
    [/Expected number/i, 'قيمة رقمية مطلوبة'],
    [/Expected string/i, 'قيمة نصية مطلوبة'],
    [/Expected array/i, 'قائمة (Array) مطلوبة'],
    [/Invalid email/i, 'بريد إلكتروني غير صالح'],
    [/Invalid date/i, 'تاريخ غير صالح'],
    [/Invalid enum value/i, 'قيمة غير مسموحة'],
  ];
  for (const [re, ar] of patterns) {
    if (re.test(msg)) return msg.replace(re, ar);
  }
  return msg;
}

function translateHttpStatus(status) {
  const map = {
    400: 'طلب غير صالح',
    401: 'غير مصرح – يرجى تسجيل الدخول',
    403: 'صلاحيات غير كافية للوصول',
    404: 'المورد المطلوب غير موجود',
    409: 'تعارض في البيانات',
    422: 'تعذر معالجة البيانات',
    429: 'تم تجاوز حدّ الطلبات',
    500: 'خطأ في الخادم',
  };
  return map[status] || '';
}

function translateFieldName(field = '') {
  const map = {
    // Common auth/user
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    fullName: 'الاسم الكامل',
    phone: 'رقم الهاتف',
    role: 'الدور',
    permissions: 'الصلاحيات',

    // category: handled once above if needed
    // Products
    name: 'الاسم',
    sku: 'رمز التخزين (SKU)',
    barcode: 'الباركود',
    categoryId: 'التصنيف',
    description: 'الوصف',
    costPrice: 'سعر التكلفة',
    sellingPrice: 'سعر البيع',
    currency: 'العملة',
    productId: 'المنتج',
    stock: 'المخزون',
    minStock: 'حد المخزون الأدنى',
    unit: 'الوحدة',
    supplier: 'المورّد',
    status: 'الحالة',

    // Sales
    saleId: 'رقم المبيعة',
    invoiceNumber: 'رقم الفاتورة',
    customerId: 'المشتري',
    subtotal: 'المجموع الفرعي',
    discount: 'الخصم',
    tax: 'الضريبة',
    total: 'الإجمالي',
    exchangeRate: 'سعر الصرف',
    interestRate: 'نسبة الفائدة',
    currencyCode: 'رمز العملة',
    currencyName: 'اسم العملة',
    interestAmount: 'قيمة الفائدة',
    paymentType: 'نوع الدفع',
    paidAmount: 'المبلغ المدفوع',
    remainingAmount: 'المبلغ المتبقي',
    notes: 'ملاحظات',

    // Payments
    paymentId: 'رقم الدفعة',
    amount: 'المبلغ',
    paymentMethod: 'طريقة الدفع',
    paymentDate: 'تاريخ الدفع',

    // Installments
    installmentNumber: 'رقم القسط',
    dueAmount: 'المبلغ المستحق',
    dueDate: 'تاريخ الاستحقاق',
    address: 'العنوان',
    city: 'المدينة',
    paidDate: 'تاريخ السداد',

    // Categories/Customers
    customer: 'العميل',
    category: 'التصنيف',

    defaultCurrency: 'العملة الافتراضية',
    usdRate: 'سعر الدولار',
    iqdRate: 'سعر الدينار',
    companyName: 'اسم الشركة',
    area: 'المنطقة',
    street: 'الشارع',
    phones: 'أرقام الهواتف',
    logoUrl: 'شعار الشركة',
    invoiceType: 'نوع الفاتورة',
    destinationDir: 'مسار الحفظ',
    // Settings/Company
    key: 'المفتاح',
    value: 'القيمة',
    updatedAt: 'تاريخ التحديث',
    createdAt: 'تاريخ الإنشاء',
  };
  return map[field] || field;
}

function translateResourceName(resource = '') {
  const map = {
    users: 'المستخدمين',
    permissions: 'الصلاحيات',
    roles: 'الأدوار',
    customers: 'العملاء',
    products: 'المنتجات',
    sales: 'المبيعات',
    categories: 'التصنيفات',
    reports: 'التقارير',
    dashboard: 'لوحة التحكم',
    settings: 'الإعدادات',
  };
  return map[resource] || resource;
}

function translateActionName(action = '') {
  const map = {
    create: 'إنشاء',
    read: 'قراءة',
    view: 'عرض',
    update: 'تعديل',
    delete: 'حذف',
    manage: 'إدارة',
  };
  return map[action] || action;
}

export function buildArabicErrorMessage(error) {
  const data = error?.response?.data || {};
  const status = error?.response?.status;

  // Prefer backend-provided message/error
  const baseName = translateErrorName(data.error);
  let baseMessage = translateGenericMessage(data.message) || translateHttpStatus(status);

  // If permission token exists in message, localize action/resource
  if (baseMessage && baseMessage.startsWith('تم رفض الإذن:')) {
    const token = (data.message || '').split(':').slice(1).join(':').trim();
    // token may be in form "products:delete" (resource:action)
    if (token && token.includes(':')) {
      const [resource, action] = token.split(':');
      const arAction = translateActionName(action);
      const arResource = translateResourceName(resource);
      const pretty = [arAction, arResource].filter(Boolean).join(' ');
      baseMessage = `تم رفض الإذن: ${pretty || token}`;
    }
  }

  // Aggregate Zod validation details if present
  const details = Array.isArray(data.details)
    ? data.details
        .map((d) => {
          const arField = d?.field ? translateFieldName(d.field) : '';
          const field = arField ? `${arField}: ` : '';
          const msg = translateZodDetailMessage(d?.message || '');
          return (field + msg).trim();
        })
        .filter(Boolean)
        .join('، ')
    : '';

  const parts = [baseName, baseMessage].filter(Boolean);
  const combined = parts.length ? parts.join(' - ') : 'حدث خطأ غير متوقع';

  return details ? `${combined} — ${details}` : combined;
}

export function extractArabicDetails(error) {
  const data = error?.response?.data || {};
  if (!Array.isArray(data.details)) return [];
  return data.details
    .map((d) => {
      const arField = d?.field ? translateFieldName(d.field) : '';
      const field = arField ? `${arField}: ` : '';
      const msg = translateZodDetailMessage(d?.message || '');
      return (field + msg).trim();
    })
    .filter(Boolean);
}
