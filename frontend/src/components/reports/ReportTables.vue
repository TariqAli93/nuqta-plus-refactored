<template>
  <v-card rounded="xl" elevation="0" class="report-tables mb-4">
    <v-card-text class="pa-0">
      <v-tabs
        v-model="activeTab"
        color="primary"
        align-tabs="start"
        show-arrows
        density="comfortable"
        class="px-2 pt-2"
      >
        <v-tab v-for="tab in tabs" :key="tab.value" :value="tab.value">
          <v-icon size="18" class="me-2">{{ tab.icon }}</v-icon>
          {{ tab.label }}
        </v-tab>
      </v-tabs>

      <v-divider />

      <v-window v-model="activeTab" class="pa-3 pa-sm-4">
        <!-- Sales -->
        <v-window-item value="sales">
          <CurrencyTable
            :items="salesByCurrency"
            :headers="salesHeaders"
            empty-text="لا توجد بيانات مبيعات"
          />
        </v-window-item>

        <!-- Payments -->
        <v-window-item value="payments">
          <CurrencyTable
            :items="paymentsByCurrency"
            :headers="paymentsHeaders"
            empty-text="لا توجد دفعات"
          />
        </v-window-item>

        <!-- Installments -->
        <v-window-item value="installments">
          <CurrencyTable
            :items="installmentsByCurrency"
            :headers="installmentsHeaders"
            empty-text="لا توجد أقساط"
          />
          <v-divider class="my-3" />
          <div class="text-subtitle-2 font-weight-bold mb-2">
            <v-icon size="18" color="warning" class="me-1">mdi-clock-alert-outline</v-icon>
            متوسط تأخير العملاء
          </div>
          <v-data-table
            :headers="delayHeaders"
            :items="delayStats"
            :no-data-text="'لا توجد بيانات تأخير'"
            density="comfortable"
            class="report-table"
            hover
          />
        </v-window-item>

        <!-- Expenses -->
        <v-window-item value="expenses">
          <div v-if="expensesSummary?.supported">
            <v-data-table
              :headers="expenseHeaders"
              :items="expensesSummary.byCategory || []"
              density="comfortable"
              class="report-table"
              hover
              no-data-text="لا توجد مصاريف"
            />
          </div>
          <EmptyState
            v-else
            compact
            title="وحدة المصاريف غير متوفرة"
            description="لم يتم تفعيل وحدة المصاريف في المخطط الحالي."
            icon="mdi-cash-minus"
          />
        </v-window-item>

        <!-- Inventory -->
        <v-window-item value="inventory">
          <div class="text-subtitle-2 font-weight-bold mb-2">
            <v-icon size="18" color="warning" class="me-1">mdi-package-variant-closed-remove</v-icon>
            منتجات منخفضة المخزون
          </div>
          <v-data-table
            :headers="lowStockHeaders"
            :items="inventory?.lowStockProducts || []"
            density="comfortable"
            class="report-table mb-4"
            hover
            no-data-text="لا توجد منتجات منخفضة المخزون"
            :search="inventorySearch"
          >
            <template #top>
              <v-text-field
                v-model="inventorySearch"
                density="compact"
                hide-details
                clearable
                variant="outlined"
                placeholder="بحث..."
                prepend-inner-icon="mdi-magnify"
                class="mb-3"
                style="max-width: 320px"
              />
            </template>
          </v-data-table>

          <div class="text-subtitle-2 font-weight-bold mb-2">
            <v-icon size="18" color="error" class="me-1">mdi-package-variant-remove</v-icon>
            منتجات نفدت من المخزون
          </div>
          <v-data-table
            :headers="lowStockHeaders"
            :items="inventory?.outOfStockProducts || []"
            density="comfortable"
            class="report-table"
            hover
            no-data-text="لا توجد منتجات نافدة"
          />
        </v-window-item>

        <!-- Customers -->
        <v-window-item value="customers">
          <div class="text-subtitle-2 font-weight-bold mb-2">
            <v-icon size="18" color="error" class="me-1">mdi-account-cash-outline</v-icon>
            أعلى العملاء مديونية
          </div>
          <v-data-table
            :headers="debtHeaders"
            :items="customersDebt?.topDebtCustomers || []"
            density="comfortable"
            class="report-table mb-4"
            hover
            no-data-text="لا توجد ديون"
          >
            <template #item.customerName="{ item }">
              <RouterLink
                v-if="item.customerId"
                :to="`/customers/${item.customerId}`"
                class="customer-link"
              >
                {{ item.customerName }}
              </RouterLink>
              <span v-else>{{ item.customerName || '—' }}</span>
            </template>
            <template #item.totalDebt="{ item }">
              {{ formatNumber(item.totalDebt) }}
            </template>
          </v-data-table>

          <div class="text-subtitle-2 font-weight-bold mb-2">
            <v-icon size="18" color="success" class="me-1">mdi-cash-check</v-icon>
            أعلى العملاء تسديدًا
          </div>
          <v-data-table
            :headers="payingHeaders"
            :items="customersDebt?.topPayingCustomers || []"
            density="comfortable"
            class="report-table"
            hover
            no-data-text="لا توجد عمليات تسديد"
          >
            <template #item.customerName="{ item }">
              <RouterLink
                v-if="item.customerId"
                :to="`/customers/${item.customerId}`"
                class="customer-link"
              >
                {{ item.customerName }}
              </RouterLink>
              <span v-else>{{ item.customerName || '—' }}</span>
            </template>
            <template #item.paid="{ item }">
              {{ formatNumber(item.paid) }}
            </template>
          </v-data-table>
        </v-window-item>

        <!-- Multi-currency summary -->
        <v-window-item value="multi-currency">
          <v-alert
            type="info"
            variant="tonal"
            density="compact"
            class="mb-3"
            border="start"
          >
            تُعرض الإجماليات مفصولة لكل عملة لتجنّب الخلط بين العملات.
          </v-alert>
          <v-data-table
            :headers="multiCurrencyHeaders"
            :items="multiCurrencyRows"
            density="comfortable"
            class="report-table"
            hover
            no-data-text="لا توجد بيانات"
          />
        </v-window-item>
      </v-window>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import EmptyState from '@/components/EmptyState.vue';
import CurrencyTable from './CurrencyTable.vue';

const props = defineProps({
  kpisByCurrency: { type: Object, default: () => ({}) },
  installmentsSummary: { type: Object, default: () => ({}) },
  expensesSummary: { type: Object, default: () => ({}) },
  inventory: { type: Object, default: () => ({}) },
  customersDebt: { type: Object, default: () => ({}) },
  canViewProfit: { type: Boolean, default: true },
});

const activeTab = ref('sales');
const inventorySearch = ref('');

const tabs = [
  { value: 'sales', label: 'المبيعات', icon: 'mdi-cart-arrow-right' },
  { value: 'payments', label: 'الدفعات', icon: 'mdi-cash-multiple' },
  { value: 'installments', label: 'الأقساط', icon: 'mdi-calendar-clock' },
  { value: 'expenses', label: 'المصاريف', icon: 'mdi-cash-minus' },
  { value: 'inventory', label: 'المخزون', icon: 'mdi-package-variant' },
  { value: 'customers', label: 'العملاء', icon: 'mdi-account-group-outline' },
  { value: 'multi-currency', label: 'متعدد العملات', icon: 'mdi-currency-usd' },
];

const formatNumber = (n) =>
  Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

// ---- Sales by currency ----
const salesByCurrency = computed(() =>
  Object.entries(props.kpisByCurrency || {}).map(([cur, k]) => ({
    currency: cur,
    sales: formatNumber(k.sales),
    cashSales: formatNumber(k.cashSales),
    installmentSales: formatNumber(k.installmentSales),
    discounts: formatNumber(k.discounts),
    netSales: formatNumber(k.netSales),
    returnedCancelled: formatNumber(k.returnedCancelled),
  })),
);

const salesHeaders = [
  { title: 'العملة', key: 'currency', sortable: true },
  { title: 'إجمالي المبيعات', key: 'sales', sortable: true, align: 'end' },
  { title: 'نقدًا', key: 'cashSales', sortable: true, align: 'end' },
  { title: 'بالأقساط', key: 'installmentSales', sortable: true, align: 'end' },
  { title: 'الخصومات', key: 'discounts', sortable: true, align: 'end' },
  { title: 'صافي المبيعات', key: 'netSales', sortable: true, align: 'end' },
  { title: 'الملغاة/المرتجعة', key: 'returnedCancelled', sortable: true, align: 'end' },
];

// ---- Payments by currency ----
const paymentsByCurrency = computed(() =>
  Object.entries(props.kpisByCurrency || {}).map(([cur, k]) => ({
    currency: cur,
    totalPaid: formatNumber(k.totalPaid),
    cashPayments: formatNumber(k.cashPayments),
    cardPayments: formatNumber(k.cardPayments),
    transferPayments: formatNumber(k.transferPayments),
    installmentCollections: formatNumber(k.installmentCollections),
  })),
);

const paymentsHeaders = [
  { title: 'العملة', key: 'currency', sortable: true },
  { title: 'الإجمالي المحصّل', key: 'totalPaid', sortable: true, align: 'end' },
  { title: 'نقدًا', key: 'cashPayments', sortable: true, align: 'end' },
  { title: 'بطاقة', key: 'cardPayments', sortable: true, align: 'end' },
  { title: 'تحويل', key: 'transferPayments', sortable: true, align: 'end' },
  { title: 'تحصيل أقساط', key: 'installmentCollections', sortable: true, align: 'end' },
];

// ---- Installments by currency ----
const installmentsByCurrency = computed(() =>
  Object.entries(props.kpisByCurrency || {}).map(([cur, k]) => ({
    currency: cur,
    dueInstallments: k.dueInstallments || 0,
    overdueInstallments: k.overdueInstallments || 0,
    paidInstallments: k.paidInstallments || 0,
    expectedCollections: formatNumber(k.expectedCollections),
    lateAmounts: formatNumber(k.lateAmounts),
  })),
);

const installmentsHeaders = [
  { title: 'العملة', key: 'currency', sortable: true },
  { title: 'مستحقة', key: 'dueInstallments', sortable: true, align: 'end' },
  { title: 'متأخرة', key: 'overdueInstallments', sortable: true, align: 'end' },
  { title: 'مدفوعة', key: 'paidInstallments', sortable: true, align: 'end' },
  { title: 'المتوقع تحصيله', key: 'expectedCollections', sortable: true, align: 'end' },
  { title: 'مبالغ متأخرة', key: 'lateAmounts', sortable: true, align: 'end' },
];

const delayStats = computed(
  () => props.installmentsSummary?.customerDelayStats || [],
);

const delayHeaders = [
  { title: 'العميل', key: 'customerName', sortable: true },
  {
    title: 'متوسط أيام التأخير',
    key: 'avgDelayDays',
    sortable: true,
    align: 'end',
    value: (item) => Number(item.avgDelayDays || 0).toFixed(1),
  },
  { title: 'عدد التأخيرات', key: 'lateCount', sortable: true, align: 'end' },
];

// ---- Expenses ----
const expenseHeaders = [
  { title: 'الفئة', key: 'category', sortable: true },
  { title: 'العملة', key: 'currency', sortable: true },
  { title: 'الإجمالي', key: 'total', sortable: true, align: 'end' },
];

// ---- Inventory ----
const lowStockHeaders = [
  { title: 'المنتج', key: 'productName', sortable: true },
  { title: 'المخزن', key: 'warehouseName', sortable: true },
  { title: 'الكمية', key: 'quantity', sortable: true, align: 'end' },
  { title: 'الحد الأدنى', key: 'minStock', sortable: true, align: 'end' },
];

// ---- Customers ----
const debtHeaders = [
  { title: 'العميل', key: 'customerName', sortable: true },
  { title: 'إجمالي المديونية', key: 'totalDebt', sortable: true, align: 'end' },
  { title: 'إجمالي المشتريات', key: 'totalPurchases', sortable: true, align: 'end' },
];

const payingHeaders = [
  { title: 'العميل', key: 'customerName', sortable: true },
  { title: 'المبلغ المسدد', key: 'paid', sortable: true, align: 'end' },
  { title: 'العملة', key: 'currency', sortable: true },
];

// ---- Multi-currency summary ----
const multiCurrencyRows = computed(() =>
  Object.entries(props.kpisByCurrency || {}).map(([cur, k]) => {
    const row = {
      currency: cur,
      sales: formatNumber(k.sales),
      collected: formatNumber(k.totalPaid),
      unpaid: formatNumber(k.unpaidBalances),
      overdueAmount: formatNumber(k.lateAmounts),
    };
    if (props.canViewProfit) {
      row.netProfit =
        k.netProfit === null || k.netProfit === undefined
          ? '—'
          : formatNumber(k.netProfit);
    }
    return row;
  }),
);

const multiCurrencyHeaders = computed(() => {
  const base = [
    { title: 'العملة', key: 'currency', sortable: true },
    { title: 'المبيعات', key: 'sales', sortable: true, align: 'end' },
    { title: 'المحصّل', key: 'collected', sortable: true, align: 'end' },
    { title: 'الديون المتبقية', key: 'unpaid', sortable: true, align: 'end' },
    { title: 'مبالغ متأخرة', key: 'overdueAmount', sortable: true, align: 'end' },
  ];
  if (props.canViewProfit) {
    base.push({ title: 'صافي الربح', key: 'netProfit', sortable: true, align: 'end' });
  }
  return base;
});
</script>

<style scoped lang="scss">
.report-tables {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden;
}

.report-table {
  background: transparent;
}

.report-table :deep(.v-table) {
  background: transparent;
}

.customer-link {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
  font-weight: 500;
}
.customer-link:hover {
  text-decoration: underline;
}

@media (max-width: 600px) {
  .report-table :deep(.v-table) {
    overflow-x: auto;
  }
}
</style>
