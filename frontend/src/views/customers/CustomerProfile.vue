<template>
  <div>
    <!-- Loading state ---------------------------------------------------- -->
    <div v-if="loading" class="d-flex justify-center align-center" style="min-height: 240px">
      <v-progress-circular indeterminate color="primary" size="56" />
    </div>

    <!-- Error / not-found state ------------------------------------------ -->
    <v-card v-else-if="error" class="pa-6">
      <EmptyState
        :title="errorTitle"
        :description="errorDescription"
        icon="mdi-alert-circle-outline"
        icon-color="error"
        :actions="[
          { text: 'العودة للعملاء', icon: 'mdi-arrow-right', to: '/customers', color: 'primary' },
        ]"
      />
    </v-card>

    <template v-else-if="profile">
      <!-- 1. Header ------------------------------------------------------- -->
      <v-card class="mb-4">
        <div class="pa-4 d-flex flex-wrap align-center gap-4">
          <v-avatar size="56" color="primary" class="text-white">
            <v-icon size="32">mdi-account</v-icon>
          </v-avatar>

          <div class="flex-grow-1">
            <div class="d-flex align-center flex-wrap gap-2">
              <div class="text-h5 font-weight-bold text-primary">
                {{ profile.customer.name }}
              </div>
              <v-chip
                size="small"
                :color="profile.customer.isActive ? 'success' : 'grey'"
                variant="tonal"
              >
                {{ profile.customer.isActive ? 'نشط' : 'غير نشط' }}
              </v-chip>
              <v-chip
                v-if="profile.customer.branch?.name"
                size="small"
                variant="tonal"
                color="info"
              >
                <v-icon start size="16">mdi-store</v-icon>
                {{ profile.customer.branch.name }}
              </v-chip>
            </div>
            <div class="text-caption text-grey mt-1 d-flex flex-wrap gap-3">
              <span v-if="profile.customer.phone">
                <v-icon size="14">mdi-phone</v-icon>
                {{ profile.customer.phone }}
              </span>
              <span v-if="profile.customer.address">
                <v-icon size="14">mdi-map-marker</v-icon>
                {{ profile.customer.address }}
              </span>
              <span v-if="profile.customer.createdAt">
                <v-icon size="14">mdi-calendar</v-icon>
                عميل منذ {{ formatDate(profile.customer.createdAt) }}
              </span>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-2">
            <v-btn
              v-if="profile.customer.phone"
              :href="`tel:${profile.customer.phone}`"
              prepend-icon="mdi-phone"
              variant="tonal"
              color="success"
              size="small"
            >
              اتصال
            </v-btn>
            <v-btn
              v-if="profile.customer.phone"
              :href="`https://wa.me/${normalizedPhone}`"
              target="_blank"
              rel="noopener"
              prepend-icon="mdi-whatsapp"
              variant="tonal"
              color="success"
              size="small"
            >
              واتساب
            </v-btn>
            <v-btn
              v-if="canEdit"
              :to="`/customers/${profile.customer.id}/edit`"
              prepend-icon="mdi-pencil"
              variant="tonal"
              size="small"
            >
              تعديل
            </v-btn>
            <v-btn
              v-if="canCreateNewSale"
              :to="`/sales/new?customerId=${profile.customer.id}`"
              prepend-icon="mdi-cart-plus"
              variant="elevated"
              color="primary"
              size="small"
            >
              فاتورة جديدة
            </v-btn>
          </div>
        </div>
      </v-card>

      <!-- Multi-currency / conversion warnings ---------------------------- -->
      <v-alert
        v-for="warning in profile.meta?.warnings || []"
        :key="warning.code"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
        :icon="warning.code === 'MULTI_CURRENCY' ? 'mdi-currency-usd' : 'mdi-information'"
      >
        {{ warningText(warning) }}
      </v-alert>

      <!-- 2. KPI cards ---------------------------------------------------- -->
      <v-row class="mb-1">
        <v-col v-for="kpi in kpiCards" :key="kpi.key" cols="6" md="4" lg="2">
          <v-card class="pa-3 h-100" variant="tonal" :color="kpi.color">
            <div class="text-caption text-grey-darken-1">{{ kpi.label }}</div>
            <div class="text-h6 font-weight-bold mt-1">{{ kpi.value }}</div>
            <div v-if="kpi.hint" class="text-caption text-grey mt-1">{{ kpi.hint }}</div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Per-currency breakdown when more than one currency is in play --- -->
      <v-card v-if="profile.meta?.multiCurrency" class="mb-4" variant="outlined">
        <v-card-title class="text-subtitle-1">
          الأرصدة حسب العملة
        </v-card-title>
        <v-divider />
        <v-table density="compact">
          <thead>
            <tr>
              <th>العملة</th>
              <th class="text-end">إجمالي المشتريات</th>
              <th class="text-end">المدفوع</th>
              <th class="text-end">المتبقي</th>
              <th class="text-end">عدد الفواتير</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in profile.summary.byCurrency" :key="row.currency">
              <td><v-chip size="x-small">{{ row.currency }}</v-chip></td>
              <td class="text-end">{{ formatCurrency(row.totalPurchases, row.currency) }}</td>
              <td class="text-end text-success">
                {{ formatCurrency(row.totalPaid, row.currency) }}
              </td>
              <td class="text-end" :class="row.totalRemaining > 0 ? 'text-error' : ''">
                {{ formatCurrency(row.totalRemaining, row.currency) }}
              </td>
              <td class="text-end">{{ row.salesCount }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card>

      <!-- 3. Tabs --------------------------------------------------------- -->
      <v-card>
        <v-tabs v-model="activeTab" color="primary" align-tabs="start" show-arrows>
          <v-tab value="overview">نظرة عامة</v-tab>
          <v-tab value="purchases">
            المشتريات
            <v-chip v-if="profile.sales.length" size="x-small" class="ms-2">
              {{ profile.sales.length }}
            </v-chip>
          </v-tab>
          <v-tab value="installments">
            الأقساط
            <v-chip v-if="profile.installments.length" size="x-small" class="ms-2">
              {{ profile.installments.length }}
            </v-chip>
          </v-tab>
          <v-tab value="payments">
            الدفعات
            <v-chip v-if="profile.payments.length" size="x-small" class="ms-2">
              {{ profile.payments.length }}
            </v-chip>
          </v-tab>
          <v-tab value="timeline">سجل الديون</v-tab>
        </v-tabs>

        <v-divider />

        <v-window v-model="activeTab">
          <!-- Overview ---------------------------------------------------- -->
          <v-window-item value="overview">
            <div class="pa-4">
              <v-row>
                <v-col cols="12" md="6">
                  <div class="text-subtitle-2 mb-2">معلومات الاتصال</div>
                  <div class="text-body-2">
                    <p><strong>الاسم:</strong> {{ profile.customer.name }}</p>
                    <p><strong>الهاتف:</strong> {{ profile.customer.phone || '—' }}</p>
                    <p><strong>المدينة:</strong> {{ profile.customer.city || '—' }}</p>
                    <p><strong>العنوان:</strong> {{ profile.customer.address || '—' }}</p>
                    <p v-if="profile.customer.notes">
                      <strong>ملاحظات:</strong> {{ profile.customer.notes }}
                    </p>
                  </div>
                </v-col>
                <v-col cols="12" md="6">
                  <div class="text-subtitle-2 mb-2">الملخص</div>
                  <div class="text-body-2">
                    <p>
                      <strong>عدد الفواتير:</strong>
                      {{ profile.summary.salesCount }}
                      <span v-if="profile.summary.cancelledSales" class="text-grey">
                        (ملغاة: {{ profile.summary.cancelledSales }})
                      </span>
                    </p>
                    <p>
                      <strong>أقساط نشطة:</strong>
                      {{ profile.summary.activeInstallments }}
                    </p>
                    <p>
                      <strong>أقساط مكتملة:</strong>
                      {{ profile.summary.completedInstallments }}
                    </p>
                    <p v-if="profile.customer.creditScore != null">
                      <strong>التصنيف الائتماني:</strong>
                      {{ profile.customer.creditScore }}
                    </p>
                  </div>
                </v-col>
              </v-row>
            </div>
          </v-window-item>

          <!-- Purchases --------------------------------------------------- -->
          <v-window-item value="purchases">
            <div v-if="!profile.sales.length" class="pa-6">
              <EmptyState
                title="لا توجد مشتريات"
                description="لم يقم العميل بأي شراء بعد"
                icon="mdi-receipt-text-outline"
                compact
              />
            </div>
            <v-data-table
              v-else
              :headers="salesHeaders"
              :items="profile.sales"
              :items-per-page="10"
              density="comfortable"
            >
              <template #[`item.invoiceNumber`]="{ item }">
                <RouterLink :to="`/sales/${item.id}`" class="text-primary text-decoration-none">
                  {{ item.invoiceNumber }}
                </RouterLink>
              </template>
              <template #[`item.date`]="{ item }">
                {{ formatDate(item.date) }}
              </template>
              <template #[`item.type`]="{ item }">
                {{ saleTypeLabel(item) }}
              </template>
              <template #[`item.total`]="{ item }">
                {{ formatCurrency(item.total, item.currency) }}
              </template>
              <template #[`item.paid`]="{ item }">
                <span class="text-success">
                  {{ formatCurrency(item.paid, item.currency) }}
                </span>
              </template>
              <template #[`item.remaining`]="{ item }">
                <span :class="item.remaining > 0 ? 'text-error' : ''">
                  {{ formatCurrency(item.remaining, item.currency) }}
                </span>
              </template>
              <template #[`item.status`]="{ item }">
                <v-chip :color="statusColor(item.status)" size="x-small">
                  {{ statusLabel(item.status) }}
                </v-chip>
              </template>
              <template #[`item.actions`]="{ item }">
                <v-btn
                  icon="mdi-eye"
                  size="x-small"
                  variant="text"
                  :to="`/sales/${item.id}`"
                  aria-label="عرض الفاتورة"
                />
              </template>
            </v-data-table>
          </v-window-item>

          <!-- Installments ----------------------------------------------- -->
          <v-window-item value="installments">
            <div v-if="!profile.installments.length" class="pa-6">
              <EmptyState
                title="لا توجد أقساط"
                description="ليس على هذا العميل أي أقساط"
                icon="mdi-calendar-clock"
                compact
              />
            </div>
            <v-data-table
              v-else
              :headers="installmentHeaders"
              :items="profile.installments"
              :items-per-page="10"
              density="comfortable"
            >
              <template #[`item.invoiceNumber`]="{ item }">
                <RouterLink
                  v-if="item.saleId"
                  :to="`/sales/${item.saleId}`"
                  class="text-primary text-decoration-none"
                >
                  {{ item.invoiceNumber || `#${item.saleId}` }}
                </RouterLink>
                <span v-else>—</span>
              </template>
              <template #[`item.dueDate`]="{ item }">
                {{ item.dueDate || '—' }}
              </template>
              <template #[`item.dueAmount`]="{ item }">
                {{ formatCurrency(item.dueAmount, item.currency) }}
              </template>
              <template #[`item.paidAmount`]="{ item }">
                {{ formatCurrency(item.paidAmount, item.currency) }}
              </template>
              <template #[`item.remainingAmount`]="{ item }">
                <span :class="item.remainingAmount > 0 ? 'text-error' : ''">
                  {{ formatCurrency(item.remainingAmount, item.currency) }}
                </span>
              </template>
              <template #[`item.overdueDays`]="{ item }">
                <span v-if="item.overdueDays > 0" class="text-error font-weight-bold">
                  {{ item.overdueDays }} يوم
                </span>
                <span v-else>—</span>
              </template>
              <template #[`item.status`]="{ item }">
                <v-chip :color="installmentColor(item)" size="x-small">
                  {{ installmentLabel(item) }}
                </v-chip>
              </template>
              <template #[`item.actions`]="{ item }">
                <v-btn
                  v-if="item.saleId && canAddPayment && item.remainingAmount > 0"
                  size="x-small"
                  variant="tonal"
                  color="primary"
                  :to="`/sales/${item.saleId}`"
                >
                  تسجيل دفعة
                </v-btn>
              </template>
            </v-data-table>
          </v-window-item>

          <!-- Payments --------------------------------------------------- -->
          <v-window-item value="payments">
            <div v-if="!profile.payments.length" class="pa-6">
              <EmptyState
                title="لا توجد دفعات"
                description="لم يسجل أي دفعة لهذا العميل بعد"
                icon="mdi-cash-multiple"
                compact
              />
            </div>
            <v-data-table
              v-else
              :headers="paymentHeaders"
              :items="profile.payments"
              :items-per-page="10"
              density="comfortable"
            >
              <template #[`item.date`]="{ item }">
                {{ formatDate(item.date) }}
              </template>
              <template #[`item.amount`]="{ item }">
                <span class="text-success font-weight-bold">
                  {{ formatCurrency(item.amount, item.currency) }}
                </span>
              </template>
              <template #[`item.method`]="{ item }">
                {{ paymentMethodLabel(item.method) }}
              </template>
              <template #[`item.invoiceNumber`]="{ item }">
                <RouterLink
                  v-if="item.saleId"
                  :to="`/sales/${item.saleId}`"
                  class="text-primary text-decoration-none"
                >
                  {{ item.invoiceNumber || `#${item.saleId}` }}
                </RouterLink>
                <span v-else>—</span>
              </template>
            </v-data-table>
          </v-window-item>

          <!-- Debt timeline ---------------------------------------------- -->
          <v-window-item value="timeline">
            <div v-if="!profile.timeline.length" class="pa-6">
              <EmptyState
                title="لا توجد حركات"
                description="لا يوجد سجل ديون لهذا العميل"
                icon="mdi-format-list-bulleted-square"
                compact
              />
            </div>
            <v-table v-else density="comfortable">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th>الوصف</th>
                  <th class="text-end">مدين</th>
                  <th class="text-end">دائن</th>
                  <th class="text-end">الرصيد</th>
                  <th>العملة</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in profile.timeline" :key="idx">
                  <td>{{ formatDate(row.date) }}</td>
                  <td>
                    <v-chip
                      size="x-small"
                      :color="row.type === 'sale' ? 'warning' : 'success'"
                      variant="tonal"
                    >
                      {{ row.type === 'sale' ? 'فاتورة' : 'دفعة' }}
                    </v-chip>
                  </td>
                  <td>{{ row.description }}</td>
                  <td class="text-end">
                    <span v-if="row.debit" class="text-warning">
                      {{ formatCurrency(row.debit, row.currency) }}
                    </span>
                  </td>
                  <td class="text-end">
                    <span v-if="row.credit" class="text-success">
                      {{ formatCurrency(row.credit, row.currency) }}
                    </span>
                  </td>
                  <td class="text-end font-weight-bold" :class="row.balance > 0 ? 'text-error' : 'text-success'">
                    {{ formatCurrency(row.balance, row.currency) }}
                  </td>
                  <td><v-chip size="x-small">{{ row.currency }}</v-chip></td>
                </tr>
              </tbody>
            </v-table>
          </v-window-item>
        </v-window>
      </v-card>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { useCustomerStore } from '@/stores/customer';
import { useAuthStore } from '@/stores/auth';
import * as uiAccess from '@/auth/uiAccess.js';
import EmptyState from '@/components/EmptyState.vue';
import {
  formatCurrency,
  toYmdWithTime,
  getStatusColor,
  getStatusText,
  getPaymentMethodText,
} from '@/utils/helpers';

const route = useRoute();
const customerStore = useCustomerStore();
const authStore = useAuthStore();

const loading = ref(true);
const error = ref(null);
const profile = ref(null);
const activeTab = ref('overview');

const userRole = computed(() => authStore.user?.role);
const canEdit = computed(() => uiAccess.canManageCustomers(userRole.value));
const canCreateNewSale = computed(() => uiAccess.canCreateSales(userRole.value));
const canAddPayment = computed(() => uiAccess.canAddPayments(userRole.value));

const errorTitle = computed(() => {
  if (error.value?.statusCode === 404) return 'العميل غير موجود';
  return 'تعذر تحميل ملف العميل';
});
const errorDescription = computed(() => {
  if (error.value?.statusCode === 404) {
    return 'قد يكون العميل محذوفاً أو خارج نطاق الفرع المتاح لك.';
  }
  return error.value?.message || 'حدث خطأ غير متوقع. حاول إعادة المحاولة لاحقاً.';
});

const normalizedPhone = computed(() => {
  const phone = profile.value?.customer?.phone || '';
  return phone.replace(/[^\d+]/g, '');
});

// ── KPI cards ────────────────────────────────────────────────────────────
// We deliberately avoid summing across currencies. The KPI uses the
// "primary" currency — the one with the most sales. Multi-currency users
// see the full per-currency breakdown table just below the cards.
const primaryCurrency = computed(() => {
  const list = profile.value?.summary?.byCurrency || [];
  if (!list.length) return 'USD';
  const sorted = [...list].sort((a, b) => b.salesCount - a.salesCount);
  return sorted[0].currency;
});

const primarySummary = computed(() => {
  const list = profile.value?.summary?.byCurrency || [];
  return list.find((r) => r.currency === primaryCurrency.value) || null;
});

const kpiCards = computed(() => {
  if (!profile.value) return [];
  const summary = profile.value.summary;
  const cur = primaryCurrency.value;
  const ps = primarySummary.value;
  return [
    {
      key: 'purchases',
      label: 'إجمالي المشتريات',
      value: formatCurrency(ps?.totalPurchases ?? 0, cur),
      color: 'primary',
      hint: profile.value.meta?.multiCurrency ? `بالعملة ${cur}` : null,
    },
    {
      key: 'paid',
      label: 'المدفوع',
      value: formatCurrency(ps?.totalPaid ?? 0, cur),
      color: 'success',
    },
    {
      key: 'remaining',
      label: 'المتبقي (الديون)',
      value: formatCurrency(ps?.totalRemaining ?? 0, cur),
      color: ps?.totalRemaining > 0 ? 'error' : 'success',
    },
    {
      key: 'overdue',
      label: 'المتأخر',
      value: formatCurrency(summary.overdueAmount, cur),
      color: summary.overdueAmount > 0 ? 'error' : 'success',
    },
    {
      key: 'activeInst',
      label: 'أقساط نشطة',
      value: summary.activeInstallments,
      color: 'warning',
    },
    {
      key: 'completedInst',
      label: 'أقساط مكتملة',
      value: summary.completedInstallments,
      color: 'success',
    },
  ];
});

// ── Tables ──────────────────────────────────────────────────────────────
const salesHeaders = [
  { title: 'رقم الفاتورة', key: 'invoiceNumber' },
  { title: 'التاريخ', key: 'date' },
  { title: 'النوع', key: 'type' },
  { title: 'الإجمالي', key: 'total', align: 'end' },
  { title: 'المدفوع', key: 'paid', align: 'end' },
  { title: 'المتبقي', key: 'remaining', align: 'end' },
  { title: 'الحالة', key: 'status' },
  { title: '', key: 'actions', sortable: false },
];

const installmentHeaders = [
  { title: 'الفاتورة', key: 'invoiceNumber' },
  { title: 'تاريخ الاستحقاق', key: 'dueDate' },
  { title: 'المبلغ', key: 'dueAmount', align: 'end' },
  { title: 'المدفوع', key: 'paidAmount', align: 'end' },
  { title: 'المتبقي', key: 'remainingAmount', align: 'end' },
  { title: 'تأخر', key: 'overdueDays' },
  { title: 'الحالة', key: 'status' },
  { title: '', key: 'actions', sortable: false },
];

const paymentHeaders = [
  { title: 'التاريخ', key: 'date' },
  { title: 'المبلغ', key: 'amount', align: 'end' },
  { title: 'العملة', key: 'currency' },
  { title: 'طريقة الدفع', key: 'method' },
  { title: 'الفاتورة', key: 'invoiceNumber' },
];

// ── Helpers ─────────────────────────────────────────────────────────────
const statusColor = (s) => getStatusColor(s);
const statusLabel = (s) => getStatusText(s);
const paymentMethodLabel = (m) => getPaymentMethodText(m);

const saleTypeLabel = (sale) => {
  const t = (sale.saleType || sale.paymentType || sale.type || '').toLowerCase();
  if (t === 'cash') return 'نقدي';
  if (t === 'installment') return 'تقسيط';
  if (t === 'mixed') return 'مختلط';
  return t || '—';
};

const installmentColor = (i) => {
  if (i.status === 'paid') return 'success';
  if (i.status === 'cancelled') return 'grey';
  if (i.overdueDays > 0) return 'error';
  return 'warning';
};
const installmentLabel = (i) => {
  if (i.status === 'paid') return 'مدفوع';
  if (i.status === 'cancelled') return 'ملغي';
  if (i.overdueDays > 0) return 'متأخر';
  return 'قيد الانتظار';
};

const formatDate = (val) => {
  if (!val) return '—';
  try {
    return toYmdWithTime(val);
  } catch {
    return String(val);
  }
};

const warningText = (warning) => {
  if (warning.code === 'MULTI_CURRENCY') {
    return 'هذا العميل لديه معاملات بأكثر من عملة. يتم عرض الإجماليات لكل عملة على حدة دون جمعها.';
  }
  if (warning.code === 'CONVERSION_UNAVAILABLE') {
    return 'لا توجد عملة أساسية مفعّلة، لذا تحويل العملات غير متاح حالياً.';
  }
  return warning.message;
};

// ── Lifecycle ───────────────────────────────────────────────────────────
const loadProfile = async () => {
  loading.value = true;
  error.value = null;
  try {
    profile.value = await customerStore.fetchCustomerProfile(route.params.id);
  } catch (err) {
    error.value = err || { message: 'تعذر تحميل ملف العميل' };
    profile.value = null;
  } finally {
    loading.value = false;
  }
};

onMounted(loadProfile);
</script>
