<template>
  <div>
    <v-card class="mb-4">
      <div class="flex items-center justify-center">
        <div class="flex items-center pa-3">
          <div class="font-semibold text-h6 text-primary">تفاصيل الفاتورة</div>
        </div>

        <v-spacer />

        <v-btn color="primary" prepend-icon="mdi-printer" :loading="printing" @click="handlePrint">
          طباعة
        </v-btn>

        <v-btn class="mr-3" color="secondary" prepend-icon="mdi-eye" @click="previewPrint">
          معاينة الطباعة
        </v-btn>

        <select-printer class="mr-3" />

        <v-btn color="primary" class="mx-3" @click="router.go(-1)">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </div>
    </v-card>

    <v-card v-if="sale" class="mb-4">
      <v-card-title class="d-flex justify-space-between align-center">
        <div>
          <div class="text-h5">
            رقم الفاتورة:
            <v-chip>{{ sale.invoiceNumber }}</v-chip>
          </div>
          <div class="text-caption text-grey">{{ toYmdWithTime(sale.createdAt) }}</div>
        </div>
        <v-chip
          v-if="sale.paymentType === 'installment'"
          :color="getStatusColor(sale.status)"
          size="large"
        >
          {{ getStatusText(sale.status) }}
        </v-chip>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="4">
            <div class="mb-2">
              <v-icon color="primary" class="ml-2">mdi-account</v-icon>
              <strong>معلومات العميل</strong>
            </div>
            <div class="mr-8 text-body-2">
              <p class="mb-1"><strong>الاسم: </strong> {{ sale.customerName || 'زبون نقدي' }}</p>
              <p v-if="sale.customer && sale.customer.phone" class="mb-1">
                <strong>الهاتف: </strong> {{ sale.customer.phone }}
              </p>
            </div>
          </v-col>

          <v-col cols="12" md="4">
            <div class="mb-2">
              <v-icon color="primary" class="ml-2">mdi-cash-multiple</v-icon>
              <strong>معلومات الدفع</strong>
            </div>
            <div class="mr-8 text-body-2">
              <p class="mb-1">
                <strong>نوع الدفع: </strong> {{ getPaymentTypeText(sale.paymentType) }}
              </p>
              <p class="mb-1"><strong>العملة:</strong> {{ sale.currency }}</p>
              <p class="mb-1">
                <strong>المدفوع: </strong>
                <span class="text-success">{{
                  formatCurrency(sale.paidAmount, sale.currency)
                }}</span>
              </p>
              <p class="mb-0">
                <strong>المتبقي: </strong>
                <span :class="sale.remainingAmount > 0 ? 'text-error' : 'text-success'">
                  {{ formatCurrency(sale.remainingAmount, sale.currency) }}
                </span>
              </p>
            </div>
          </v-col>

          <v-col cols="12" md="4">
            <div class="mb-2">
              <v-icon color="primary" class="ml-2">mdi-chart-box</v-icon>
              <strong>الملخص المالي</strong>
            </div>
            <div class="mr-8 text-body-2">
              <!-- عرض المجموع الأساسي -->
              <p v-if="sale.paymentType === 'installment' && sale.interestAmount > 0" class="mb-1">
                <strong>إجمالي المنتجات: </strong>
                <span class="text-primary">{{
                  formatCurrency(sale.total - (sale.interestAmount || 0), sale.currency)
                }}</span>
              </p>
              <!-- معلومات الفائدة -->
              <p v-if="sale.paymentType === 'installment' && sale.interestRate > 0" class="mb-1">
                <strong>نسبة الفائدة: </strong>
                <span class="text-warning font-weight-bold">{{ sale.interestRate }}%</span>
              </p>
              <p v-if="sale.paymentType === 'installment' && sale.interestAmount > 0" class="mb-1">
                <strong>قيمة الفائدة: </strong>
                <span class="text-warning font-weight-bold">{{
                  formatCurrency(sale.interestAmount, sale.currency)
                }}</span>
              </p>
              <!-- عدد الأقساط للمبيعات التقسيطية -->
              <p v-if="sale.paymentType === 'installment' && hasInstallments" class="mb-1">
                <strong>عدد الأقساط: </strong>
                <span class="text-info">{{ sale.installments.length }} قسط</span>
              </p>
              <!-- الإجمالي النهائي -->
              <v-divider
                v-if="sale.paymentType === 'installment' && sale.interestAmount > 0"
                class="my-2"
              ></v-divider>
              <p class="mb-0">
                <strong>الإجمالي النهائي: </strong>
                <span class="text-h6 text-primary font-weight-bold">{{
                  formatCurrency(sale.total, sale.currency)
                }}</span>
              </p>
            </div>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Interest Information Card for Installment Sales -->
    <v-card
      v-if="sale && sale.paymentType === 'installment' && sale.interestAmount > 0"
      class="mb-4 border-warning"
    >
      <v-card-title class="bg-warning-lighten-4 text-warning-darken-2">
        <v-icon class="ml-2">mdi-calculator</v-icon>
        تفاصيل حساب الفائدة
      </v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="3">
            <div class="text-center">
              <div class="text-caption text-grey">إجمالي المنتجات</div>
              <div class="text-h6 text-primary">
                {{ formatCurrency(sale.total - (sale.interestAmount || 0), sale.currency) }}
              </div>
            </div>
          </v-col>
          <v-col cols="12" md="1" class="justify-center d-flex align-center">
            <v-icon color="warning">mdi-plus</v-icon>
          </v-col>
          <v-col cols="12" md="3">
            <div class="text-center">
              <div class="text-caption text-grey">الفائدة ({{ sale.interestRate }}%)</div>
              <div class="text-h6 text-warning">
                {{ formatCurrency(sale.interestAmount, sale.currency) }}
              </div>
            </div>
          </v-col>
          <v-col cols="12" md="1" class="justify-center d-flex align-center">
            <v-icon color="success">mdi-equal</v-icon>
          </v-col>
          <v-col cols="12" md="4">
            <div class="text-center">
              <div class="text-caption text-grey">الإجمالي النهائي</div>
              <div class="text-h5 text-success font-weight-bold">
                {{ formatCurrency(sale.total, sale.currency) }}
              </div>
              <div class="mt-1 text-caption text-grey">
                {{ sale.installments.length }} أقساط ×
                {{
                  formatCurrency(
                    sale.installments.length > 0 ? sale.total / sale.installments.length : 0,
                    sale.currency
                  )
                }}
              </div>
            </div>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Products Table -->
    <v-card v-if="sale && sale.items" class="mb-4">
      <v-card-title>
        <v-icon class="ml-2">mdi-package-variant</v-icon>
        تفاصيل المنتجات
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th class="text-center">#</th>
              <th class="text-center">المنتج</th>
              <th class="text-center">الكمية</th>
              <th class="text-center">سعر الوحدة</th>
              <th class="text-center">خصم على الوحدة</th>
              <th class="text-center">الملاحظات</th>
              <th class="text-center">المجموع</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in sale.items" :key="item.id">
              <td class="text-center font-weight-bold">{{ index + 1 }}</td>
              <td class="text-center">
                <div class="font-weight-bold">{{ item.productName }}</div>
                <div v-if="item.productDescription" class="text-caption text-grey mt-1">
                  {{ item.productDescription }}
                </div>
              </td>
              <td class="text-center">{{ item.quantity }}</td>
              <td class="text-center">
                {{ formatCurrency(item.unitPrice, sale.currency) }}
              </td>
              <td class="text-center">
                {{ item.discount ? formatCurrency(item.discount, sale.currency) : '-' }}
              </td>
              <td class="text-center">{{ item.notes || '-' }}</td>
              <td class="text-center font-weight-bold">
                {{ formatCurrency(item.subtotal, sale.currency) }}
              </td>
            </tr>
          </tbody>

          <!-- المجموع مع الخصم و الفائدة -->
          <tfoot>
            <tr v-if="sale.discount && sale.discount > 0">
              <td colspan="6" class="text-right font-weight-bold">الخصم على الفاتورة:</td>
              <td class="text-center font-weight-bold text-error">
                {{ formatCurrency(sale.discount, sale.currency) }}
              </td>
            </tr>

            <tr>
              <td colspan="6" class="text-right font-weight-bold">
                <span v-if="sale.paymentType === 'installment'"> المجموع الفرعي: </span>
                <span v-else>الإجمالي:</span>
              </td>
              <td class="text-center font-weight-bold">
                {{ formatCurrency(sale.total - (sale.interestAmount || 0), sale.currency) }}
              </td>
            </tr>

            <tr v-if="sale.paymentType === 'installment' && sale.interestAmount > 0">
              <td colspan="6" class="text-right font-weight-bold">الفائدة:</td>
              <td class="text-center font-weight-bold text-warning">
                + {{ formatCurrency(sale.interestAmount, sale.currency) }}
              </td>
            </tr>

            <tr v-if="sale.discount > 0 || sale.interestAmount > 0">
              <td colspan="6" class="text-right font-weight-bold text-primary">
                الإجمالي النهائي:
              </td>
              <td class="text-center font-weight-bold text-primary text-h6">
                {{ formatCurrency(sale.total, sale.currency) }}
              </td>
            </tr>
          </tfoot>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- Installments Table -->
    <v-card v-if="sale && sale.installments && sale.installments.length > 0" class="mb-4">
      <v-card-title class="d-flex justify-space-between align-center">
        <div>
          <v-icon class="ml-2">mdi-calendar-clock</v-icon>
          جدول الأقساط
          <span
            v-if="sale.paymentType === 'installment' && sale.interestAmount > 0"
            class="text-caption text-warning d-block"
          >
            * الأقساط تشمل فائدة بنسبة {{ sale.interestRate }}%
          </span>
        </div>
        <v-chip :color="getInstallmentStatusColor()" size="small">
          {{ getInstallmentStatusText() }}
        </v-chip>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th class="text-center">رقم القسط</th>
              <th class="text-center">المبلغ المستحق</th>
              <th class="text-center">المبلغ المدفوع</th>
              <th class="text-center">المبلغ المتبقي</th>
              <th class="text-center">تاريخ الاستحقاق</th>
              <th class="text-center">تاريخ الدفع</th>
              <th class="text-center">الحالة</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="installment in sale.installments"
              :key="installment.id"
              :class="getInstallmentRowClass(installment)"
            >
              <td class="text-center font-weight-bold">{{ installment.installmentNumber }}</td>
              <td class="text-center">
                {{ formatCurrency(installment.dueAmount, sale.currency) }}
              </td>
              <td class="text-center text-success">
                {{ formatCurrency(installment.paidAmount, sale.currency) }}
              </td>
              <td class="text-center" :class="installment.remainingAmount > 0 ? 'text-error' : ''">
                {{ formatCurrency(installment.remainingAmount, sale.currency) }}
              </td>
              <td class="text-center">{{ toYmd(installment.dueDate) }}</td>
              <td class="text-center">
                {{ installment.paidDate ? toYmd(installment.paidDate) : '-' }}
              </td>
              <td class="text-center">
                <v-chip :color="getInstallmentColor(installment)" size="small">
                  {{ getInstallmentStatusLabel(installment) }}
                </v-chip>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- Payments Table -->
    <v-card v-if="sale && sale.payments && sale.payments.length > 0" class="mb-4">
      <v-card-title>
        <v-icon class="ml-2">mdi-cash-register</v-icon>
        سجل الدفعات
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th class="text-center">#</th>
              <th class="text-center">المبلغ</th>
              <th class="text-center">طريقة الدفع</th>
              <th class="text-center">التاريخ</th>
              <th class="text-center">العملة</th>
              <th class="text-center">بواسطة</th>
              <th class="text-center">رقم المرجع</th>
              <th class="text-right">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(payment, index) in sale.payments" :key="payment.id">
              <td class="text-center">{{ index + 1 }}</td>
              <td class="text-center font-weight-bold text-success">
                {{ formatCurrency(payment.amount, payment.currency) }}
              </td>
              <td class="text-center">{{ getPaymentMethodText(payment.paymentMethod) }}</td>
              <td class="text-center">{{ toYmdWithTime(payment.createdAt) }}</td>
              <td class="text-center">{{ payment.currency }}</td>
              <td class="text-center">{{ payment.createdBy || '-' }}</td>
              <td class="text-center">
                <v-chip v-if="payment.paymentReference" size="small" variant="tonal" color="info">
                  {{ payment.paymentReference }}
                </v-chip>
                <span v-else>-</span>
              </td>
              <td>{{ payment.notes || '-' }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- Add Payment Form -->
    <v-card v-if="sale && sale.status === 'pending' && sale.remainingAmount > 0" class="mb-4">
      <v-card-title class="bg-warning-lighten-4">
        <v-icon class="ml-2">mdi-cash-plus</v-icon>
        إضافة دفعة جديدة
      </v-card-title>
      <v-card-text class="pt-4">
        <v-form @submit.prevent="addPayment">
          <v-row>
            <v-col cols="12" md="4">
              <v-text-field
                :model-value="formatNumber(paymentData.amount)"
                label="المبلغ"
                step="0.01"
                min="0.01"
                :hint="`المتبقي: ${formatCurrency(sale.remainingAmount, sale.currency)}`"
                persistent-hint
                :rules="[
                  (v) => {
                    const num = parseNumber(v);
                    return !!num || 'المبلغ مطلوب';
                  },
                  (v) => {
                    const num = parseNumber(v);
                    return num > 0 || 'المبلغ يجب أن يكون أكبر من صفر';
                  },
                  (v) => {
                    const num = parseNumber(v);
                    return num <= sale.remainingAmount || 'المبلغ أكبر من المتبقي';
                  },
                ]"
                required
                @update:model-value="handlePaymentAmountInput($event)"
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="paymentData.paymentMethod"
                :items="paymentMethods"
                label="طريقة الدفع"
                required
              ></v-select>
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="paymentData.notes" label="ملاحظات (اختياري)"></v-text-field>
            </v-col>
          </v-row>
          <v-btn type="submit" color="primary" :loading="loadingPayment">
            <v-icon class="ml-2">mdi-check</v-icon>
            إضافة الدفعة
          </v-btn>
        </v-form>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSaleStore } from '@/stores/sale';
import { useSettingsStore } from '@/stores/settings';
import { useNotificationStore } from '@/stores/notification';
import SelectPrinter from '@/components/SelectPrinter.vue';
import { formatReceiptData } from '@/utils/receiptFormatter';
import {
  toYmd,
  toYmdWithTime,
  formatCurrency,
  getStatusColor,
  getStatusText,
  getPaymentTypeText,
  getPaymentMethodText,
} from '@/utils/helpers';

const { params } = useRoute();
const router = useRouter();
const saleStore = useSaleStore();
const settingsStore = useSettingsStore();
const notificationStore = useNotificationStore();

const printing = ref(false);
const settings = ref(null);

const previewPrint = async () => {
  if (!sale.value) {
    notificationStore.error('لا توجد بيانات فاتورة للمعاينة');
    return;
  }

  // Get company info from settings
  const companyInfo = settingsStore.companyInfo;
  if (!companyInfo || !companyInfo.invoiceType) {
    notificationStore.error('يرجى إعداد نوع الفاتورة من إعدادات الشركة');
    return;
  }

  try {
    // Format receipt data
    const receiptData = formatReceiptData(sale.value, companyInfo);

    // Ensure all data is serializable by creating clean copies
    const cleanReceiptData = JSON.parse(JSON.stringify(receiptData));
    const cleanCompanyInfo = JSON.parse(JSON.stringify(companyInfo));

    // Call electron API to preview
    const result = await window.electronAPI.previewReceipt({
      receiptData: cleanReceiptData,
      companyInfo: cleanCompanyInfo,
    });

    if (!result.success) {
      notificationStore.error(result.error || 'فشل في عرض المعاينة');
    }
  } catch (error) {
    console.error('Preview error:', error);
    notificationStore.error('حدث خطأ أثناء عرض المعاينة: ' + (error.message || 'خطأ غير معروف'));
  }
};

// state
const sale = ref(null);
const loadingPayment = ref(false);

const paymentData = ref({
  amount: null,
  paymentMethod: 'cash',
  currency: 'USD',
  notes: '',
});

const paymentMethods = [
  { title: 'نقدي', value: 'cash' },
  { title: 'بطاقة', value: 'card' },
  { title: 'تحويل بنكي', value: 'bank_transfer' },
];

const hasInstallments = computed(
  () => sale.value?.installments && sale.value.installments.length > 0
);

// helpers for installments (to avoid duplicated code)
const isInstallmentOverdue = (installment) => {
  const dueDate = new Date(installment.dueDate);
  const today = new Date();
  return dueDate < today && installment.remainingAmount > 0;
};

// installments ui helpers
const getInstallmentColor = (installment) => {
  if (installment.status === 'paid') return 'success';
  if (installment.status === 'cancelled') return 'error';
  if (isInstallmentOverdue(installment)) return 'error';
  return 'warning';
};

const getInstallmentStatusLabel = (installment) => {
  if (installment.status === 'paid') return 'مدفوع';
  if (installment.status === 'cancelled') return 'ملغي';
  if (isInstallmentOverdue(installment)) return 'متأخر';
  return 'معلق';
};

const getInstallmentRowClass = (installment) => {
  if (installment.status === 'paid') return 'bg-success-lighten-5';
  if (isInstallmentOverdue(installment)) return 'bg-error-lighten-5';
  return '';
};

const getInstallmentStatusColor = () => {
  if (!hasInstallments.value) return 'grey';

  const allPaid = sale.value.installments.every((inst) => inst.status === 'paid');
  if (allPaid) return 'success';

  const hasOverdue = sale.value.installments.some(isInstallmentOverdue);
  if (hasOverdue) return 'error';

  return 'warning';
};

const getInstallmentStatusText = () => {
  if (!hasInstallments.value) return '';
  const paid = sale.value.installments.filter((inst) => inst.status === 'paid').length;
  const total = sale.value.installments.length;
  return `${paid} من ${total} مدفوع`;
};

// actions
const addPayment = async () => {
  try {
    loadingPayment.value = true;

    // Validate amount
    if (!paymentData.value.amount || paymentData.value.amount <= 0) {
      notificationStore.error('يجب إدخال مبلغ صحيح أكبر من صفر');
      return;
    }

    if (paymentData.value.amount > sale.value.remainingAmount) {
      notificationStore.error('المبلغ المدخل أكبر من المبلغ المتبقي');
      return;
    }

    paymentData.value.currency = sale.value.currency;

    await saleStore.addPayment(paymentData.value);
    notificationStore.success('تم إضافة الدفعة بنجاح');

    const response = await saleStore.fetchSale(params.id);
    sale.value = response.data;

    paymentData.value = {
      amount: null,
      paymentMethod: 'cash',
      currency: sale.value.currency,
      notes: '',
    };
  } catch (error) {
    console.error('Failed to add payment:', error);
    notificationStore.error('فشل في إضافة الدفعة');
  } finally {
    loadingPayment.value = false;
  }
};

const handlePrint = async () => {
  if (!sale.value) {
    notificationStore.error('لا توجد بيانات فاتورة للطباعة');
    return;
  }

  // Get selected printer
  const selectedPrinter = saleStore.getPrinter();
  if (!selectedPrinter) {
    notificationStore.error('يرجى اختيار طابعة أولاً');
    return;
  }

  // Get company info from settings
  const companyInfo = settingsStore.companyInfo;
  if (!companyInfo || !companyInfo.invoiceType) {
    notificationStore.error('يرجى إعداد نوع الفاتورة من إعدادات الشركة');
    return;
  }

  try {
    printing.value = true;

    // Format receipt data
    const receiptData = formatReceiptData(sale.value, companyInfo);

    // Ensure all data is serializable by creating clean copies
    // This prevents "object could not be cloned" errors in Electron IPC
    const cleanReceiptData = JSON.parse(JSON.stringify(receiptData));
    const cleanCompanyInfo = JSON.parse(JSON.stringify(companyInfo));

    // Call electron API to print
    const result = await window.electronAPI.printReceipt({
      printerName: selectedPrinter.name,
      receiptData: cleanReceiptData,
      companyInfo: cleanCompanyInfo,
    });

    if (result.success) {
      notificationStore.success('تمت الطباعة بنجاح');
    } else {
      notificationStore.error(result.error || 'فشل في الطباعة');
    }
  } catch (error) {
    console.error('Print error:', error);
    notificationStore.error('حدث خطأ أثناء الطباعة: ' + (error.message || 'خطأ غير معروف'));
  } finally {
    printing.value = false;
  }
};

// إضافة دوال تنسيق الأرقام
const formatNumber = (value) => {
  if (!value && value !== 0) return '';
  const numStr = String(value).replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(numStr)) return value;
  // دعم الأرقام العشرية
  const parts = numStr.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
};

const parseNumber = (value) => {
  if (!value) return 0;
  const numStr = String(value).replace(/,/g, '');
  const num = parseFloat(numStr);
  return isNaN(num) ? 0 : num;
};

const handlePaymentAmountInput = (value) => {
  const num = parseNumber(value);
  paymentData.value.amount = num;
};

// lifecycle
onMounted(async () => {
  try {
    // جلب تفاصيل الفاتورة
    const response = await saleStore.fetchSale(params.id);
    sale.value = response.data;

    // جلب معلومات الشركة من الإعدادات
    await settingsStore.fetchCompanyInfo();
    settings.value = settingsStore.companyInfo;

    // تعيين العملة للدفعات
    if (sale.value) {
      paymentData.value.currency = sale.value.currency;
    }
  } catch (error) {
    console.error('Failed to load sale details:', error);
    notificationStore.error('فشل في تحميل تفاصيل المبيع');
  }
});
</script>

<style scoped>
@media print {
  .v-btn,
  .v-select,
  select-printer {
    display: none !important;
  }

  #invoiceWrapper {
    display: block !important;
  }

  #invoiceComponent {
    display: block !important;
  }
}
</style>
