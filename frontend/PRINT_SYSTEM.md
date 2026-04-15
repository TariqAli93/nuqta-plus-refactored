# نظام الطباعة المتقدم - Nuqta Plus

تم إنشاء نظام طباعة متكامل باستخدام Electron IPC مع صفحة طباعة مستقلة.

## الملفات المهمة

### 1. صفحة الطباعة المستقلة
- **المسار**: `packages/frontend/print.html`
- **الوصف**: صفحة HTML مستقلة لعرض وطباعة الفواتير
- **الميزات**:
  - دعم جميع أحجام الفواتير (A4, A5, 58mm, 80mm, 88mm)
  - تصميم احترافي مع QR Code
  - تنسيق تلقائي حسب نوع الفاتورة
  - طباعة تلقائية عند تحميل البيانات

### 2. Preload Script للطباعة
- **المسار**: `packages/frontend/electron/preload/printPreload.js`
- **الوصف**: سكريبت الاتصال بين نافذة الطباعة و Main Process
- **الوظائف**:
  - `onPrintData()`: استقبال بيانات الفاتورة
  - `ready()`: إشعار Main Process بجاهزية النافذة
  - `close()`: إغلاق نافذة الطباعة

### 3. Main Process - معالجات IPC
- **المسار**: `packages/frontend/electron/main/main.js`
- **الوظيفة**: `createPrintWindow(printData)`
  - إنشاء نافذة طباعة جديدة
  - إرسال بيانات الفاتورة للنافذة
  - معالجة أحداث الطباعة

### 4. Composable للطباعة
- **المسار**: `packages/frontend/src/composables/usePrint.js`
- **الوظيفة**: `printInvoice(sale)`
  - تجهيز بيانات الفاتورة
  - استدعاء Electron API للطباعة
  - معالجة الأخطاء

## كيفية الاستخدام

### في Vue Component

```javascript
import { usePrint } from '@/composables/usePrint';

const { printInvoice } = usePrint();

// طباعة فاتورة
const handlePrint = async () => {
  const result = await printInvoice(saleData);

  if (result.success) {
    console.log('تم إرسال الفاتورة للطباعة');
  } else {
    console.error('فشل في الطباعة:', result.error);
  }
};
```

### تنسيقات الفواتير المدعومة

#### 1. الفواتير الحرارية (Thermal Receipts)
- **58mm**: للطابعات الحرارية الصغيرة
- **80mm**: للطابعات الحرارية القياسية
- **88mm**: للطابعات الحرارية العريضة

#### 2. الفواتير العادية
- **A4**: فاتورة كاملة (210mm × 297mm)
- **A5**: فاتورة مصغرة (148mm × 210mm)

## بنية البيانات

### PrintData Object
```javascript
{
  sale: {
    invoiceNumber: 'INV-001',
    createdAt: '2025-01-01T00:00:00.000Z',
    customerName: 'اسم العميل',
    customerPhone: '07xxxxxxxxx',
    currency: 'IQD',
    total: 100000,
    paidAmount: 50000,
    remainingAmount: 50000,
    discount: 0,
    status: 'completed',
    paymentType: 'cash',
    createdBy: 'المستخدم',
    items: [
      {
        productName: 'منتج 1',
        quantity: 2,
        unitPrice: 25000,
        netSubtotal: 50000
      }
    ]
  },
  company: {
    name: 'اسم الشركة',
    phone: '07xxxxxxxxx',
    city: 'المدينة',
    area: 'المنطقة',
    street: 'الشارع',
    invoiceType: 'roll-80'
  },
  invoiceType: 'roll-80' // a4, a5, roll-58, roll-80, roll-wide
}
```

## مميزات النظام

### 1. التحكم الكامل
- ✅ نافذة طباعة مستقلة
- ✅ تحكم كامل عبر Electron IPC
- ✅ معالجة الأخطاء المتقدمة

### 2. التصميم الاحترافي
- ✅ تصاميم مختلفة لكل حجم
- ✅ QR Code تلقائي
- ✅ تنسيق RTL للعربية
- ✅ ألوان مميزة للحالات المختلفة

### 3. الأداء
- ✅ طباعة تلقائية عند الجاهزية
- ✅ إغلاق تلقائي للنافذة بعد الطباعة
- ✅ استهلاك منخفض للموارد

### 4. التوافقية
- ✅ يعمل مع جميع الطابعات
- ✅ دعم الطابعات الحرارية
- ✅ دعم طابعات A4/A5 العادية

## الإعدادات

### تغيير نوع الفاتورة الافتراضي
يتم التحكم في نوع الفاتورة من **الإعدادات > معلومات الشركة**:
- اختر نوع الفاتورة المناسب
- سيتم حفظ الاختيار تلقائياً
- سيتم استخدامه في جميع عمليات الطباعة

## التطوير المستقبلي

### الميزات المخططة
- [ ] دعم قوالب فواتير مخصصة
- [ ] إضافة شعار الشركة
- [ ] طباعة متعددة (عدة نسخ)
- [ ] معاينة قبل الطباعة
- [ ] حفظ PDF
- [ ] إرسال عبر البريد الإلكتروني
- [ ] طباعة باركود بدلاً من QR Code

## ملاحظات مهمة

1. **الطباعة التلقائية**: النافذة تطبع تلقائياً بعد 500ms من تحميل البيانات
2. **إغلاق النافذة**: يتم إغلاق نافذة الطباعة تلقائياً بعد الطباعة
3. **معالجة الأخطاء**: جميع الأخطاء يتم تسجيلها في Logger الخاص بـ Electron
4. **الأمان**: استخدام Context Isolation و Preload Scripts

## استكشاف الأخطاء

### المشكلة: النافذة لا تفتح
- تأكد من تشغيل Electron في وضع التطوير
- تحقق من مسار `print.html` في الإنتاج

### المشكلة: البيانات لا تظهر
- تحقق من بنية كائن `sale`
- افتح DevTools في نافذة الطباعة (وضع التطوير)

### المشكلة: الطباعة لا تعمل
- تحقق من إعدادات الطابعة في النظام
- تأكد من توصيل الطابعة بشكل صحيح

## الدعم

للمزيد من المساعدة، راجع:
- [توثيق Electron IPC](https://www.electronjs.org/docs/latest/api/ipc-main)
- [توثيق Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
