<template>
  <div class="new-sale-page">
    <!-- Header -->
    <v-card class="mb-4" elevation="2">
      <v-card-title class="d-flex align-center justify-space-between pa-4">
        <div class="d-flex align-center gap-3">
          <v-icon size="28" color="primary">mdi-cart-plus</v-icon>
          <span class="text-h5 font-weight-bold">بطاقة بيع جديدة</span>
        </div>
        <v-btn color="primary" @click="handleCancel">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </v-card-title>
    </v-card>

    <v-row>
      <!-- Main Content Column -->
      <v-col cols="12" lg="8">
        <v-form ref="form">
          <!-- Customer & Currency Section -->
          <v-card class="mb-4" elevation="1">
            <v-card-title class="d-flex align-center ga-2 pa-4">
              <v-icon color="primary">mdi-account-circle</v-icon>
              <span class="text-h6 font-weight-medium">معلومات العميل والعملة</span>
            </v-card-title>
            <v-card-text class="pa-4">
              <v-row>
                <v-col cols="12" md="6">
                  <CustomerSelector v-model="sale.customerId" :required="false" />
                  <FormFieldHelp help-text="اختياري - يمكنك إتمام البيع بدون تحديد عميل" />
                </v-col>
                <v-col cols="12" md="6">
                  <v-select
                    v-model="sale.currency"
                    :items="availableCurrencies"
                    label="العملة"
                    :rules="[rules.required]"
                    density="comfortable"
                    variant="outlined"
                  >
                    <template #prepend-inner>
                      <v-icon>mdi-currency-usd</v-icon>
                    </template>
                  </v-select>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          <!-- Products Section -->
          <v-card class="mb-4" elevation="1">
            <v-card-title class="d-flex align-center justify-space-between pa-4">
              <div class="d-flex align-center ga-2">
                <v-icon color="primary">mdi-package-variant</v-icon>
                <span class="text-h6 font-weight-medium">المنتجات</span>
              </div>
              <v-chip v-if="sale.items.length > 0" color="primary" variant="tonal">
                {{ sale.items.length }} منتج
              </v-chip>
            </v-card-title>
            <v-card-text class="pa-4">
              <!-- Barcode Scanner -->
              <v-text-field
                v-model="barcode"
                label="قراءة الباركود"
                prepend-inner-icon="mdi-barcode-scan"
                append-inner-icon="mdi-information-outline"
                clearable
                autofocus
                variant="outlined"
                density="comfortable"
                class="mb-4"
                aria-label="قراءة الباركود - اضغط Enter لإضافة المنتج"
                @keyup.enter="handleBarcodeScan"
              >
                <template #append-inner>
                  <FormFieldHelp
                    tooltip="امسح الباركود أو اكتبه واضغط Enter لإضافة المنتج تلقائياً"
                  />
                </template>
              </v-text-field>

              <!-- Product Items -->
              <v-card
                v-for="(item, index) in sale.items"
                :key="index"
                variant="outlined"
                class="mb-3"
                :class="{ 'border-primary': item.productId }"
              >
                <v-card-text class="pa-4">
                  <div class="d-flex align-center justify-space-between mb-3">
                    <v-chip size="small" color="primary" variant="tonal">
                      منتج #{{ index + 1 }}
                    </v-chip>
                    <v-btn
                      icon="mdi-delete"
                      size="small"
                      color="error"
                      variant="text"
                      :aria-label="`حذف المنتج ${index + 1}`"
                      @click="removeItem(index)"
                    />
                  </div>

                  <v-row dense>
                    <v-col cols="12" md="6">
                      <v-autocomplete
                        v-model="item.productId"
                        :items="products"
                        item-title="name"
                        item-value="id"
                        label="المنتج"
                        :rules="[rules.required]"
                        density="comfortable"
                        variant="outlined"
                        :search="productSearchQueries[index]"
                        autocomplete="off"
                        :custom-filter="customProductFilter"
                        @update:model-value="updateProductDetails(item)"
                        @update:search="(val) => (productSearchQueries[index] = val)"
                      >
                        <template #item="{ props, item: productItem }">
                          <v-list-item
                            v-bind="{
                              ...props,
                              disabled: (productItem?.raw?.stock ?? 0) <= 0,
                            }"
                          >
                            <template #title>
                              {{ productItem.raw.name }}
                            </template>
                            <template #subtitle>
                              السعر:
                              {{
                                formatCurrency(
                                  productItem.raw.sellingPrice,
                                  productItem.raw.currency
                                )
                              }}
                              | المخزون: {{ productItem.raw.stock }}
                            </template>
                          </v-list-item>
                        </template>
                      </v-autocomplete>
                    </v-col>

                    <v-col cols="12" md="3">
                      <v-text-field
                        v-model.number="item.quantity"
                        label="الكمية"
                        type="number"
                        min="1"
                        :rules="[
                          rules.required,
                          (v) => rules.positive(v),
                          (v) => {
                            if (!products.value || !Array.isArray(products.value)) return true;
                            const product = products.value.find((p) => p.id === item.productId);
                            return product ? rules.minStock(v, product.stock) : true;
                          },
                        ]"
                        density="comfortable"
                        variant="outlined"
                        :error-messages="getQuantityError(item)"
                      />
                    </v-col>

                    <v-col cols="12" md="3">
                      <v-text-field
                        :model-value="formatCurrency(item.unitPrice)"
                        :suffix="sale.currency"
                        label="سعر الوحدة"
                        readonly
                        density="comfortable"
                        variant="outlined"
                      />
                    </v-col>

                    <v-col cols="12" md="6">
                      <v-text-field
                        :model-value="formatNumber(item.discount)"
                        :suffix="sale.currency"
                        label="الخصم على الوحدة"
                        hint="اختياري"
                        persistent-hint
                        density="comfortable"
                        variant="outlined"
                        @input="(e) => handleItemDiscountInput(item, e.target.value)"
                      />
                    </v-col>

                    <v-col cols="12" md="6">
                      <v-text-field
                        :model-value="
                          formatCurrency(
                            item.quantity * item.unitPrice - (item.discount || 0) * item.quantity
                          )
                        "
                        :suffix="sale.currency"
                        label="صافي السعر"
                        readonly
                        hint="بعد الخصم"
                        persistent-hint
                        density="comfortable"
                        variant="outlined"
                        color="primary"
                      />
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>

              <!-- Add Product Button -->
              <v-btn
                color="primary"
                prepend-icon="mdi-plus"
                size="large"
                variant="outlined"
                block
                class="mt-2"
                aria-label="إضافة منتج جديد (F1)"
                @click="addItem"
              >
                إضافة منتج جديد
                <v-chip size="x-small" class="mr-2" variant="flat" color="primary">F1</v-chip>
              </v-btn>
            </v-card-text>
          </v-card>

          <!-- Credit Score (shown for installment sales with a selected customer) -->
          <CreditScoreCard
            v-if="sale.paymentType === 'installment' && sale.customerId"
            :customer-id="sale.customerId"
            :sale-total="totalWithInterest"
            :currency="sale.currency"
          />

          <!-- Payment Section -->
          <v-card class="mb-4" elevation="1">
            <v-card-title class="d-flex align-center ga-2 pa-4">
              <v-icon color="primary">mdi-credit-card</v-icon>
              <span class="text-h6 font-weight-medium">معلومات الدفع</span>
            </v-card-title>
            <v-card-text class="pa-4">
              <v-row>
                <v-col cols="12" md="4">
                  <v-select
                    v-if="paymentTypes.length > 1"
                    v-model="sale.paymentType"
                    :items="paymentTypes"
                    item-title="label"
                    item-value="value"
                    label="نوع الفاتورة"
                    density="comfortable"
                    variant="outlined"
                  />
                  <v-text-field
                    v-else
                    model-value="نقدي"
                    label="نوع الفاتورة"
                    readonly
                    density="comfortable"
                    variant="outlined"
                  />
                  <v-alert
                    v-if="sale.paymentType === 'installment' && !sale.customerId"
                    type="warning"
                    variant="tonal"
                    density="compact"
                    class="mt-2"
                    role="alert"
                    aria-live="polite"
                  >
                    <v-icon size="16" class="ml-1" aria-hidden="true">mdi-alert</v-icon>
                    يجب تحديد عميل للبيع بالتقسيط
                  </v-alert>
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field
                    :model-value="formatNumber(sale.discount)"
                    label="الخصم الإضافي"
                    :suffix="sale.currency"
                    density="comfortable"
                    variant="outlined"
                    @input="(e) => handleSaleDiscountInput(e.target.value)"
                  />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field
                    :model-value="formatNumber(sale.paidAmount)"
                    label="المبلغ المدفوع"
                    :suffix="sale.currency"
                    :hint="sale.paymentType === 'installment' ? 'الدفعة الأولى' : 'المبلغ الكامل'"
                    persistent-hint
                    density="comfortable"
                    variant="outlined"
                    @input="(e) => handlePaidAmountInput(e.target.value)"
                  />
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          

          <!-- Installment Details -->
          <v-expand-transition>
            <v-card v-if="sale.paymentType === 'installment'" class="mb-4" elevation="1">
              <v-card-title class="d-flex align-center ga-2 pa-4">
                <v-icon color="primary">mdi-calendar-clock</v-icon>
                <span class="text-h6 font-weight-medium">تفاصيل التقسيط</span>
              </v-card-title>
              <v-card-text class="pa-4">
                <v-row>
                  <v-col cols="12" md="4">
                    <v-text-field
                      v-model.number="sale.installmentCount"
                      label="عدد الأقساط"
                      type="number"
                      min="1"
                      density="comfortable"
                      variant="outlined"
                    />
                  </v-col>
                  <v-col cols="12" md="4">
                    <v-text-field
                      v-model.number="sale.interestRate"
                      label="نسبة الفائدة (%)"
                      type="number"
                      min="0"
                      max="100"
                      hint="أدخل النسبة المئوية"
                      persistent-hint
                      density="comfortable"
                      variant="outlined"
                      @update:model-value="handleInterestRateChange"
                    />
                  </v-col>
                  <v-col cols="12" md="4">
                    <v-text-field
                      :model-value="formatNumber(sale.interestAmount)"
                      :suffix="sale.currency"
                      label="مبلغ الفائدة"
                      hint="أدخل المبلغ مباشرة"
                      persistent-hint
                      density="comfortable"
                      variant="outlined"
                      @input="(e) => handleInterestAmountChange(e.target.value)"
                    />
                  </v-col>
                </v-row>

                <!-- Installment Summary -->
                <v-card variant="tonal" color="info" class="mt-4">
                  <v-card-text>
                    <v-row dense>
                      <v-col cols="6" md="3">
                        <div class="text-caption text-medium-emphasis">المبلغ بعد الفائدة</div>
                        <div class="text-h6 font-weight-bold">
                          {{ formatCurrency(totalWithInterest) }}
                        </div>
                      </v-col>
                      <v-col cols="6" md="3">
                        <div class="text-caption text-medium-emphasis">قيمة القسط الواحد</div>
                        <div class="text-h6 font-weight-bold">
                          {{ formatCurrency(installmentAmount) }}
                        </div>
                      </v-col>
                      <v-col cols="6" md="3">
                        <div class="text-caption text-medium-emphasis">النسبة الفعلية</div>
                        <div class="text-h6 font-weight-bold">
                          {{ actualInterestRate.toFixed(2) }}%
                        </div>
                      </v-col>
                      <v-col cols="6" md="3">
                        <div class="text-caption text-medium-emphasis">المبلغ المتبقي</div>
                        <div class="text-h6 font-weight-bold text-error">
                          {{ formatCurrency(remainingAmount) }}
                        </div>
                      </v-col>
                    </v-row>
                  </v-card-text>
                </v-card>

                <!-- Installment Schedule Table -->
                <v-card variant="outlined" class="mt-4">
                  <v-card-title class="text-h6 pa-3">جدول الأقساط</v-card-title>
                  <v-divider />
                  <v-table density="comfortable">
                    <thead>
                      <tr>
                        <th class="text-right">رقم القسط</th>
                        <th class="text-right">المبلغ</th>
                        <th class="text-right">المتبقي بعد القسط</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="installment in installmentSchedule" :key="installment.number">
                        <td>{{ installment.number }}</td>
                        <td class="font-weight-bold">
                          {{ formatCurrency(installment.amount) }}
                        </td>
                        <td>
                          <v-chip
                            :color="installment.remaining === 0 ? 'success' : 'default'"
                            :variant="installment.remaining === 0 ? 'flat' : 'tonal'"
                            size="small"
                          >
                            {{ formatCurrency(installment.remaining) }}
                          </v-chip>
                        </td>
                      </tr>
                    </tbody>
                    <tfoot v-if="installmentSchedule.length > 0">
                      <tr>
                        <td class="text-right font-weight-bold">الإجمالي</td>
                        <td class="font-weight-bold text-primary">
                          {{ formatCurrency(totalWithInterest) }}
                        </td>
                        <td>
                          <v-chip color="error" variant="tonal" size="small">
                            {{ formatCurrency(remainingAmount) }}
                          </v-chip>
                        </td>
                      </tr>
                    </tfoot>
                  </v-table>
                </v-card>
              </v-card-text>
            </v-card>
          </v-expand-transition>

          <!-- Notes Section -->
          <v-card class="mb-4" elevation="1">
            <v-card-title class="d-flex align-center ga-2 pa-4">
              <v-icon color="primary">mdi-note-text</v-icon>
              <span class="text-h6 font-weight-medium">ملاحظات</span>
            </v-card-title>
            <v-card-text class="pa-4">
              <v-textarea
                v-model="sale.notes"
                label="ملاحظات إضافية"
                rows="3"
                auto-grow
                variant="outlined"
                density="comfortable"
                placeholder="أضف أي ملاحظات متعلقة بهذا البيع..."
              />
            </v-card-text>
          </v-card>
        </v-form>
      </v-col>

      <!-- Summary Sidebar -->
      <v-col cols="12" lg="4">
        <v-card class="sticky-summary" elevation="2" style="position: sticky; top: 20px">
          <v-card-title class="d-flex align-center ga-2 pa-4 bg-primary">
            <v-icon color="white">mdi-calculator</v-icon>
            <span class="text-h6 font-weight-bold text-white">ملخص البيع</span>
          </v-card-title>
          <v-card-text class="pa-4">
            <div class="summary-list">
              <div
                v-for="(summary, idx) in saleSummary"
                :key="summary.label"
                class="summary-item"
                :class="{ 'summary-item-highlight': idx === saleSummary.length - 1 }"
              >
                <div class="d-flex align-center justify-space-between py-2">
                  <span class="text-body-2 text-medium-emphasis">{{ summary.label }}</span>
                  <span class="text-body-1 font-weight-bold">{{ summary.value }}</span>
                </div>
                <v-divider v-if="idx < saleSummary.length - 1" class="my-1" />
              </div>
            </div>

            <!-- Action Buttons -->

            <v-btn
              :loading="loading"
              class="flex items-center justify-between mt-3"
              block
              color="primary"
              aria-label="حفظ البيع (F2)"
              @click="submitSale"
            >
              <template #prepend>
                <span>حفظ البيع</span>
              </template>
              <template #append>
                <v-hotkey keys="F2" variant="contained" />
              </template>
            </v-btn>
            <v-btn
              class="flex items-center justify-between mt-3"
              block
              color="error"
              aria-label="إلغاء (F3)"
              @click="handleCancel"
            >
              <template #prepend>
                <span>إلغاء</span>
              </template>
              <template #append>
                <v-hotkey keys="F3" variant="contained" />
              </template>
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter, useRoute, onBeforeRouteLeave } from 'vue-router';
import {
  useSaleStore,
  useProductStore,
  useNotificationStore,
  useSettingsStore,
  useInventoryStore,
} from '@/stores';
import { useAuthStore } from '@/stores/auth';
import CustomerSelector from '@/components/CustomerSelector.vue';
import CreditScoreCard from '@/components/CreditScoreCard.vue';
import { useKeyboardShortcuts, createPageShortcuts } from '@/composables/useKeyboardShortcuts';
import FormFieldHelp from '@/components/FormFieldHelp.vue';

const router = useRouter();
const route = useRoute();
const saleStore = useSaleStore();
const productStore = useProductStore();
const settingsStore = useSettingsStore();
const notify = useNotificationStore();
const inventoryStore = useInventoryStore();
const authStore = useAuthStore();

/** Honour the `installments` feature flag: when it's off, only cash sales are allowed. */
const installmentsEnabled = computed(() => authStore.isFeatureEnabled('installments'));

const form = ref(null);
const barcode = ref('');
const loading = ref(false);
const productSearchQueries = ref({});

const rules = {
  required: (value) => !!value || 'هذا الحقل مطلوب',
  positive: (value) => (value && value > 0) || 'يجب أن تكون القيمة أكبر من صفر',
  minStock: (value, maxStock) => {
    if (!value) return 'هذا الحقل مطلوب';
    if (value > maxStock) return `الكمية المتاحة: ${maxStock}`;
    return true;
  },
};

const sale = ref({
  customerId: null,
  currency: settingsStore.settings?.defaultCurrency || 'IQD',
  items: [],
  discount: 0,
  paymentType: 'cash',
  paidAmount: 0,
  installmentCount: 3,
  interestRate: 25,
  interestAmount: 0,
  interestInputType: 'rate', // 'rate' أو 'amount' لتحديد نوع الإدخال
  notes: '',
});

const products = ref([]);
const currencySettings = ref({
  defaultCurrency: 'IQD',
  usdRate: 1500,
  iqdRate: 1,
});

// Computed property for available currencies
const availableCurrencies = computed(() => settingsStore.availableCurrencies);

// تحويل سعر بين عملتين بناءً على إعدادات الصرف
const convertPrice = (amount, from, to) => {
  const num = Number(amount) || 0;
  if (!num || from === to) return num;
  const usdRate = Number(currencySettings.value.usdRate) || 1500;
  // لدينا عملتان IQD و USD
  if (from === 'USD' && to === 'IQD') return num * usdRate;
  if (from === 'IQD' && to === 'USD') return num / usdRate;
  return num; // fallback
};

// تطبيق تحويل العملة على كل عناصر السلة عند تغيير عملة البيع
const applySaleCurrencyToItems = () => {
  sale.value.items = sale.value.items.map((i) => {
    const original = i.unitPriceOriginal ?? i.unitPrice;
    const originalCur = i.originalCurrency ?? sale.value.currency;
    return {
      ...i,
      unitPrice: convertPrice(original, originalCur, sale.value.currency),
    };
  });
};

/* 💳 خيارات نوع الدفع */
const paymentTypes = computed(() => {
  const types = [{ label: 'نقدي', value: 'cash' }];
  if (installmentsEnabled.value) {
    types.push({ label: 'تقسيط', value: 'installment' });
  }
  return types;
});

/** If a user lands on NewSale with a stored draft/preference of `installment`
 *  after installments got disabled, silently downgrade to cash. */
watch(
  installmentsEnabled,
  (on) => {
    if (!on && sale.value.paymentType === 'installment') {
      sale.value.paymentType = 'cash';
    }
  },
  { immediate: true }
);

/* �� حسابات البيع محسّنة */
const subtotal = computed(() =>
  sale.value.items.reduce((s, i) => {
    const itemTotal = i.quantity * i.unitPrice;
    const itemDiscount = (i.discount || 0) * i.quantity;
    return s + (itemTotal - itemDiscount);
  }, 0)
);

const total = computed(() => {
  const result = subtotal.value - (sale.value.discount || 0);
  return Math.max(0, result); // التأكد من عدم وجود قيم سالبة
});

// ✅ حساب الفائدة بشكل بسيط
const interestValue = computed(() => {
  if (sale.value.paymentType !== 'installment') return 0;

  const baseAmount = total.value;

  // إذا كان الإدخال عن طريق المبلغ، استخدم المبلغ مباشرة
  if (sale.value.interestInputType === 'amount') {
    return Math.max(0, sale.value.interestAmount || 0);
  }

  // فائدة بسيطة: الفائدة = المبلغ × النسبة
  const rate = sale.value.interestRate || 0;
  return baseAmount * (rate / 100);
});

// ✅ حساب الإجمالي بعد الفائدة مع التقريب
const totalWithInterest = computed(() => {
  const result = total.value + interestValue.value;
  return Math.round(result * 100) / 100; // تقريب إلى رقمين عشريين
});

// ✅ حساب قيمة القسط الواحد بشكل دقيق
const installmentAmount = computed(() => {
  if (sale.value.installmentCount <= 0) return 0;

  const amount = totalWithInterest.value / sale.value.installmentCount;

  // تقريب إلى رقمين عشريين
  return Math.round(amount * 100) / 100;
});

// ✅ حساب المبلغ المتبقي بدقة
const remainingAmount = computed(() => {
  const finalTotal =
    sale.value.paymentType === 'installment' ? totalWithInterest.value : total.value;

  const paid = sale.value.paidAmount || 0;
  const remaining = finalTotal - paid;

  return Math.max(0, Math.round(remaining * 100) / 100);
});

// ✅ جدول الأقساط التفصيلي (مصحح ومحسّن)
const installmentSchedule = computed(() => {
  if (sale.value.paymentType !== 'installment') return [];

  const schedule = [];
  const totalAmount = totalWithInterest.value;
  const paidAmount = sale.value.paidAmount || 0;
  let remaining = Math.round((totalAmount - paidAmount) * 100) / 100;

  if (remaining <= 0 || sale.value.installmentCount <= 0) return [];

  // حساب قيمة القسط الواحد (بدون تقريب)
  const baseInstallment = remaining / sale.value.installmentCount;

  // مجموع الأقساط المقرّبة (للتأكد من عدم وجود فارق)
  let totalDistributed = 0;

  for (let i = 1; i <= sale.value.installmentCount; i++) {
    const isLast = i === sale.value.installmentCount;

    let installment;
    if (isLast) {
      // آخر قسط = المتبقي بالضبط (لضمان عدم وجود فارق)
      installment = Math.round((remaining - totalDistributed) * 100) / 100;
      // التأكد من أن آخر قسط ليس صفراً أو سالباً
      if (installment <= 0) {
        // إذا كان المتبقي صفراً أو سالباً بسبب التقريب، استخدم القيمة الأساسية
        installment = Math.max(0.01, Math.round(baseInstallment * 100) / 100);
      }
    } else {
      // باقي الأقساط: تقريب إلى رقمين عشريين
      installment = Math.round(baseInstallment * 100) / 100;
      // التأكد من أن القسط ليس صفراً
      if (installment <= 0) {
        installment = 0.01;
      }
      totalDistributed += installment;
    }

    // تحديث المتبقي قبل إضافة القسط
    remaining = Math.round((remaining - installment) * 100) / 100;

    schedule.push({
      number: i,
      amount: installment,
      remaining: Math.max(0, remaining),
    });
  }

  return schedule;
});

// ✅ إجمالي الفائدة الفعلية (للعرض)
const actualInterestRate = computed(() => {
  if (sale.value.paymentType !== 'installment' || total.value === 0) return 0;

  if (sale.value.interestInputType === 'amount') {
    return (interestValue.value / total.value) * 100;
  }

  return sale.value.interestRate || 0;
});

// ✅ تحديث المبلغ المدفوع تلقائياً عند تغيير نوع الدفع (محسّن)
watch(
  () => sale.value.paymentType,
  (newType) => {
    if (newType === 'cash') {
      sale.value.paidAmount = Math.round(total.value * 100) / 100;
    } else {
      // في حالة التقسيط، المبلغ المدفوع = قيمة القسط الأول
      sale.value.paidAmount = Math.round(installmentAmount.value * 100) / 100;
    }
  }
);

// مراقبة تغيير العملة في نموذج البيع وتحديث أسعار المنتجات
watch(
  () => sale.value.currency,
  () => {
    applySaleCurrencyToItems();
  }
);

// مراقبة تغيير الكمية للتحقق من توفرها في المخزون
watch(
  () => sale.value.items.map((item) => ({ id: item.productId, qty: item.quantity })),
  (newItems) => {
    if (!products.value || !Array.isArray(products.value)) return;
    newItems.forEach((item, index) => {
      if (!item.id) return;
      const product = products.value.find((p) => p.id === item.id);
      if (product && item.qty > product.stock) {
        notify.error(
          `❌ الكمية المطلوبة من "${product.name}" (${item.qty}) أكبر من المتوفر في المخزون (${product.stock})`
        );
        sale.value.items[index].quantity = product.stock;
      }
    });
  },
  { deep: true }
);

// ✅ تحديث المبلغ المدفوع عند تغيير الإجمالي (محسّن)
watch(
  () => [total.value, totalWithInterest.value, installmentAmount.value],
  () => {
    if (sale.value.paymentType === 'cash') {
      sale.value.paidAmount = Math.round(total.value * 100) / 100;
    } else {
      sale.value.paidAmount = Math.round(installmentAmount.value * 100) / 100;
    }
  }
);

// ✅ تحديث المبلغ عند تغيير النسبة (مبسّط)
watch(
  () => [total.value, sale.value.interestRate],
  () => {
    if (
      sale.value.paymentType === 'installment' &&
      sale.value.interestInputType === 'rate' &&
      total.value > 0
    ) {
      // فائدة بسيطة: الفائدة = المبلغ × النسبة
      const rate = sale.value.interestRate || 0;
      const calculatedInterest = total.value * (rate / 100);
      sale.value.interestAmount = Math.round(calculatedInterest * 100) / 100;
    }
  }
);

// ✅ تحديث النسبة عند تغيير المبلغ (مبسّط)
watch(
  () => [total.value, sale.value.interestAmount],
  () => {
    if (
      sale.value.paymentType === 'installment' &&
      sale.value.interestInputType === 'amount' &&
      total.value > 0
    ) {
      // فائدة بسيطة: النسبة = (الفائدة / المبلغ) × 100
      const interest = sale.value.interestAmount || 0;
      const calculatedRate = (interest / total.value) * 100;
      sale.value.interestRate = Math.round(calculatedRate * 100) / 100;
    }
  }
);

/* 🧾 الملخص */
const itemsTotal = computed(() =>
  sale.value.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
);
const itemsDiscount = computed(
  () => sale.value.items.reduce((s, i) => s + (i.discount || 0) * i.quantity, 0) // Multiply by quantity
);

const saleSummary = computed(() => [
  { label: 'إجمالي المنتجات', value: formatCurrency(itemsTotal.value) },
  { label: 'خصم المنتجات', value: formatCurrency(itemsDiscount.value) },
  { label: 'المجموع الفرعي', value: formatCurrency(subtotal.value) },
  { label: 'خصم إضافي', value: formatCurrency(sale.value.discount) },
  { label: 'الإجمالي بعد الخصم', value: formatCurrency(total.value) },
  ...(sale.value.paymentType === 'installment'
    ? [
        { label: 'الفائدة المضافة', value: formatCurrency(interestValue.value) },
        { label: 'الإجمالي بعد الفائدة', value: formatCurrency(totalWithInterest.value) },
        { label: 'قيمة القسط', value: formatCurrency(installmentAmount.value) },
      ]
    : []),
  { label: 'المبلغ المدفوع', value: formatCurrency(sale.value.paidAmount) },
  { label: 'المبلغ المتبقي', value: formatCurrency(remainingAmount.value) },
]);

/* 📦 إدارة المنتجات */
const addItem = () =>
  sale.value.items.push({ productId: null, quantity: 1, unitPrice: 0, discount: 0 });
const removeItem = (index) => sale.value.items.splice(index, 1);
const updateProductDetails = (item) => {
  if (!products.value || !Array.isArray(products.value)) return;
  const p = products.value.find((prod) => prod.id === item.productId);
  if (!p) return;

  const available = availableStockOf(p);

  if (available <= 0) {
    notify.error('❌ المنتج غير متوفر في المخزون');
    item.productId = null;
    return;
  }

  if (item.quantity > available) {
    notify.error(`❌ الكمية المطلوبة (${item.quantity}) أكبر من المتوفر في المخزون (${available})`);
    item.quantity = available;
  }

  item.unitPriceOriginal = p.sellingPrice;
  item.originalCurrency = p.currency || 'USD';
  item.unitPrice = convertPrice(p.sellingPrice, item.originalCurrency, sale.value.currency);
  item.discount = item.discount || 0;
  item.availableStock = available;
};

/* 🔍 التحقق من الكمية */
const getQuantityError = (item) => {
  if (!item.productId) return [];
  if (!products.value || !Array.isArray(products.value)) return [];
  const product = products.value.find((p) => p.id === item.productId);
  if (!product) return [];
  const available = availableStockOf(product);
  if (item.quantity > available) {
    return [`الكمية المتاحة: ${available}`];
  }
  return [];
};

/* 🔍 فلترة المنتجات */
const customProductFilter = (itemText, queryText, item) => {
  if (!queryText) return true;
  const query = queryText.toLowerCase();
  const name = item.raw.name?.toLowerCase() || '';
  const sku = item.raw.sku?.toLowerCase() || '';
  const barcode = item.raw.barcode?.toLowerCase() || '';
  return name.includes(query) || sku.includes(query) || barcode.includes(query);
};

/* 🔍 قراءة الباركود */
const handleBarcodeScan = () => {
  const code = barcode.value.trim();
  if (!code) return;
  if (!products.value || !Array.isArray(products.value)) {
    return notify.error('❌ قائمة المنتجات غير متاحة');
  }
  const product = products.value.find((p) => p.barcode === code);
  if (!product) return notify.error('❌ المنتج غير موجود');
  const available = availableStockOf(product);
  if (available <= 0) return notify.error('❌ المنتج غير متوفر في المخزون');

  const existing = sale.value.items.find((i) => i.productId === product.id);

  if (existing) {
    const newQuantity = existing.quantity + 1;
    if (newQuantity > available) {
      return notify.error(
        `❌ الكمية المطلوبة (${newQuantity}) أكبر من المتوفر في المخزون (${available})`
      );
    }
    existing.quantity = newQuantity;
  } else {
    sale.value.items.push({
      productId: product.id,
      quantity: 1,
      unitPriceOriginal: product.sellingPrice,
      originalCurrency: product.currency || 'USD',
      unitPrice: convertPrice(product.sellingPrice, product.currency || 'USD', sale.value.currency),
      discount: 0,
      availableStock: available,
    });
  }

  barcode.value = '';
};

/* 💾 حفظ البيع */
const submitSale = async () => {
  // التحقق من أن العميل مطلوب فقط للبيع بالتقسيط
  if (sale.value.paymentType === 'installment' && !sale.value.customerId) {
    notify.error('يجب تحديد عميل للبيع بالتقسيط');
    return;
  }
  const { valid } = await form.value.validate();
  if (!valid) return notify.error('يرجى تعبئة جميع الحقول');

  if (!sale.value.items.length) return notify.error('يجب إضافة منتج واحد على الأقل');

  // التحقق من توفر الكميات في المخزون
  if (!products.value || !Array.isArray(products.value)) {
    notify.error('❌ قائمة المنتجات غير متاحة');
    return;
  }
  for (const item of sale.value.items) {
    const product = products.value.find((p) => p.id === item.productId);
    if (!product) {
      notify.error(`❌ المنتج غير موجود`);
      return;
    }
    const available = availableStockOf(product);
    if (available < item.quantity) {
      notify.error(
        `❌ الكمية المطلوبة من "${product.name}" (${item.quantity}) أكبر من المتوفر في المخزون (${available})`
      );
      return;
    }
  }

  loading.value = true;
  try {
    let saleResponse;

    // Attach the currently selected branch + warehouse to the sale payload.
    // Falls back silently on the backend if the user hasn't picked one yet.
    const payload = {
      ...sale.value,
      branchId: inventoryStore.selectedBranchId || undefined,
      warehouseId: inventoryStore.selectedWarehouseId || undefined,
    };

    // إذا كانت هناك مسودة، أكملها بدلاً من إنشاء بيع جديد
    if (currentDraftId.value) {
      saleResponse = await saleStore.completeDraft(currentDraftId.value, payload);
    } else {
      saleResponse = await saleStore.createSale(payload);
    }

    saleCompleted.value = true; // تم حفظ البيع بنجاح
    notify.success('تم حفظ البيع بنجاح ✅');

    const saleId = saleResponse.data?.data?.id || saleResponse.data?.id;
    router.push({ name: 'SaleDetails', params: { id: saleId } });
  } catch (error) {
    notify.error('حدث خطأ أثناء حفظ البيع. يرجى المحاولة مرة أخرى.');
    console.error('Sale submission error:', error);
  } finally {
    loading.value = false;
  }
};

// متغيرات لتتبع حالة العملية
const saleCompleted = ref(false);
const isCancelled = ref(false);
const draftSaved = ref(false);
const currentDraftId = ref(null);

// دالة للإلغاء مع حذف المسودة إن وجدت
const handleCancel = async () => {
  isCancelled.value = true;

  // إذا كانت هناك مسودة محفوظة، احذفها
  if (currentDraftId.value) {
    try {
      await saleStore.removeSale(currentDraftId.value);
    } catch (error) {
      console.error('Failed to delete draft:', error);
    }
  }

  router.back();
};

// متغير لمنع التكرار
const isSavingDraft = ref(false);

// حفظ المسودة عند الخروج من الصفحة
const saveDraft = async () => {
  // لا نحفظ المسودة إذا:
  // 1. تم حفظ البيع بنجاح
  // 2. تم الضغط على زر الإلغاء
  // 3. لا توجد منتجات في القائمة
  // 4. تم حفظ المسودة بالفعل
  // 5. جاري حفظ المسودة حالياً
  if (
    saleCompleted.value ||
    isCancelled.value ||
    !sale.value.items ||
    sale.value.items.length === 0 ||
    draftSaved.value ||
    isSavingDraft.value
  ) {
    return;
  }

  isSavingDraft.value = true;
  try {
    // التأكد من إرسال customerId إذا كان موجوداً
    const draftData = {
      ...sale.value,
      customerId: sale.value.customerId || null,
      branchId: inventoryStore.selectedBranchId || undefined,
      warehouseId: inventoryStore.selectedWarehouseId || undefined,
    };

    const response = await saleStore.createDraft(draftData);
    if (response?.data?.data?.id) {
      currentDraftId.value = response.data.data.id;
      draftSaved.value = true;
    }
    // لا نعرض إشعار للمستخدم عند حفظ المسودة تلقائياً
  } catch (error) {
    // فشل حفظ المسودة - لا نعرض خطأ للمستخدم
    console.error('Failed to save draft:', error);
  } finally {
    isSavingDraft.value = false;
  }
};

// حفظ المسودة قبل مغادرة الصفحة (مرة واحدة فقط)
onBeforeRouteLeave(async (to, from, next) => {
  // إذا كان الانتقال إلى صفحة أخرى (ليس إلغاء)، احفظ المسودة
  if (!saleCompleted.value && !isCancelled.value && !draftSaved.value && !isSavingDraft.value) {
    await saveDraft();
  }
  next();
});

// حفظ المسودة عند إغلاق/إعادة تحميل الصفحة (فقط إذا لم يتم الانتقال)
// نستخدم window.addEventListener بدلاً من onBeforeUnmount لتجنب التكرار
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (!saleCompleted.value && !isCancelled.value && !draftSaved.value && !isSavingDraft.value) {
      // حفظ متزامن (لا يمكن استخدام async في beforeunload)
      saveDraft().catch(() => {
        // تجاهل الأخطاء في beforeunload
      });
    }
  });
}

// Keyboard shortcuts
const shortcuts = createPageShortcuts({
  create: () => addItem(),
  save: () => submitSale(),
  cancel: () => handleCancel(),
});

// Additional shortcuts
shortcuts['f1'] = (e) => {
  e.preventDefault();
  addItem();
};
shortcuts['f2'] = (e) => {
  e.preventDefault();
  submitSale();
};
shortcuts['f3'] = (e) => {
  e.preventDefault();
  handleCancel();
};

useKeyboardShortcuts(shortcuts);

/* ⚙️ تحميل البيانات */

/** Active warehouse the sale will deduct from. Drives the product stock
 *  column returned from the backend so the UI never shows stock from another
 *  warehouse while a cashier is ringing up a sale. */
const activeWarehouseId = computed(() => inventoryStore.selectedWarehouseId);

/** Normalised stock for availability checks. Uses per-warehouse stock when
 *  a warehouse is selected; falls back to total across warehouses otherwise. */
const availableStockOf = (product) => {
  if (!product) return 0;
  if (activeWarehouseId.value && product.warehouseStock != null) {
    return Number(product.warehouseStock) || 0;
  }
  return Number(product.totalStock ?? product.stock ?? 0);
};

const loadProducts = async () => {
  const p = await productStore.fetch({
    limit: 1000,
    warehouseId: activeWarehouseId.value || undefined,
  });
  products.value = p.data;
};

// Re-fetch products whenever the global admin switches warehouse, so every
// availability check always reflects the warehouse the sale will land in.
watch(activeWarehouseId, loadProducts);

onMounted(async () => {
  // Ensure the inventory store is hydrated so the warehouse id is available
  if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches();
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();
  await loadProducts();

  // تحميل إعدادات العملة
  try {
    const settings = await settingsStore.fetchCurrencySettings();
    if (settings) {
      currencySettings.value = {
        ...settings,
      };
      // استخدام العملة الافتراضية أو أول عملة متاحة
      const defaultCurrency = settings.defaultCurrency || 'IQD';
      sale.value.currency = availableCurrencies.value.includes(defaultCurrency)
        ? defaultCurrency
        : availableCurrencies.value[0] || defaultCurrency;
    }
  } catch {
    // استخدام القيم الافتراضية
    sale.value.currency = availableCurrencies.value[0] || 'IQD';
  }

  // تحميل بيانات المسودة إذا كان هناك draftId في query
  const draftId = route.query.draftId;
  if (draftId) {
    try {
      loading.value = true;
      const draftResponse = await saleStore.fetchSale(Number(draftId));
      const draftData = draftResponse.data?.data || draftResponse.data;

      if (draftData && draftData.status === 'draft') {
        currentDraftId.value = draftData.id;
        draftSaved.value = true;

        // ملء النموذج ببيانات المسودة
        sale.value.customerId = draftData.customerId || null;
        sale.value.currency = draftData.currency || 'IQD';
        sale.value.paymentType = draftData.paymentType || 'cash';
        sale.value.discount = draftData.discount || 0;
        sale.value.tax = draftData.tax || 0;
        sale.value.notes = draftData.notes || '';

        // تحميل عناصر المسودة
        if (draftData.items && draftData.items.length > 0) {
          sale.value.items = draftData.items.map((item) => {
            const product =
              products.value && Array.isArray(products.value)
                ? products.value.find((p) => p.id === item.productId)
                : null;
            return {
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount || 0,
              unitPriceOriginal: product?.sellingPrice || item.unitPrice,
              originalCurrency: product?.currency || sale.value.currency,
              availableStock: availableStockOf(product),
            };
          });
        }

        notify.info('تم تحميل المسودة');
      }
    } catch (error) {
      notify.error('فشل تحميل المسودة');
      console.error('Failed to load draft:', error);
    } finally {
      loading.value = false;
    }
  }
});

/* 💱 تنسيق العملة */
const formatCurrency = (amount, currency = null) => {
  const cur = currency || sale.value.currency;
  return new Intl.NumberFormat('ar', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: cur === 'USD' ? 2 : 0,
  }).format(amount || 0);
};

// إضافة دوال تنسيق الأرقام
const formatNumber = (value) => {
  if (!value && value !== 0) return '';
  const numStr = String(value).replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(numStr)) return value;
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

// معالجة الخصم على الوحدة
const handleItemDiscountInput = (item, value) => {
  const num = parseNumber(value);
  item.discount = num;
};

// معالجة الخصم الإضافي
const handleSaleDiscountInput = (value) => {
  const num = parseNumber(value);
  sale.value.discount = num;
};

// معالجة المبلغ المدفوع
const handlePaidAmountInput = (value) => {
  const num = parseNumber(value);
  sale.value.paidAmount = num;
};

// معالجة تغيير النسبة المئوية
const handleInterestRateChange = (value) => {
  if (value === null || value === undefined || isNaN(value)) {
    sale.value.interestRate = 0;
    return;
  }
  sale.value.interestRate = Number(value);
  sale.value.interestInputType = 'rate';
  // تحديث المبلغ تلقائياً
  if (total.value > 0) {
    sale.value.interestAmount = total.value * (Number(value) / 100);
  }
};

// معالجة تغيير مبلغ الفائدة
const handleInterestAmountChange = (value) => {
  const num = parseNumber(value);
  sale.value.interestAmount = num;
  sale.value.interestInputType = 'amount';
  // تحديث النسبة تلقائياً
  if (total.value > 0) {
    sale.value.interestRate = (num / total.value) * 100;
  }
};
</script>

<style scoped>
.new-sale-page {
  padding-bottom: 2rem;
}

.bg-surface-variant {
  background-color: rgba(var(--v-theme-surface-variant), 0.1);
}

.summary-list {
  background-color: rgba(var(--v-theme-surface), 1);
  border-radius: 8px;
}

.summary-item {
  transition: background-color 0.2s ease;
}

.summary-item-highlight {
  background-color: rgba(var(--v-theme-primary), 0.1);
  border-radius: 4px;
  padding: 0.5rem;
  margin-top: 0.5rem;
}

.summary-item-highlight .text-body-1 {
  color: rgb(var(--v-theme-primary));
  font-size: 1.1rem;
}

.sticky-summary {
  max-height: calc(100vh - 40px);
  overflow-y: auto;
}

/* Responsive adjustments */
@media (max-width: 960px) {
  .sticky-summary {
    position: relative !important;
    top: 0 !important;
  }
}

/* Smooth transitions */
.v-card {
  transition: box-shadow 0.2s ease;
}

.v-card:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.12);
}
</style>
