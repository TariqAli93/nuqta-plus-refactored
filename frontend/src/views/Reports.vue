<template>
  <v-container fluid>
    <div class="d-flex align-center justify-space-between mb-4 flex-wrap ga-2">
      <h1 class="text-h5">Accounting Reports</h1>
      <div class="d-flex ga-2">
        <v-btn color="primary" variant="tonal" :loading="exportingExcel" @click="downloadExcel">Excel</v-btn>
        <v-btn color="primary" :loading="exportingPdf" @click="downloadPdf">PDF</v-btn>
      </div>
    </div>

    <v-card class="mb-4" rounded="lg">
      <v-card-text>
        <v-row>
          <v-col cols="12" md="2" v-if="showBranchFilter">
            <v-select v-model="filters.branchId" :items="branchOptions" label="Branch" clearable/>
          </v-col>
          <v-col cols="12" md="2">
            <v-select v-model="filters.currency" :items="currencyOptions" label="Currency"/>
          </v-col>
          <v-col cols="12" md="2">
            <v-select v-model="filters.period" :items="periodOptions" label="Range" @update:model-value="applyPreset"/>
          </v-col>
          <v-col cols="12" md="2">
            <v-text-field v-model="filters.dateFrom" type="date" label="From" :disabled="filters.period !== 'custom'"/>
          </v-col>
          <v-col cols="12" md="2">
            <v-text-field v-model="filters.dateTo" type="date" label="To" :disabled="filters.period !== 'custom'"/>
          </v-col>
          <v-col cols="12" md="2" class="d-flex align-end ga-2">
            <v-btn color="primary" :loading="loading" @click="load">Apply</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-alert v-if="report?.meta?.notes?.length" type="warning" class="mb-4" density="comfortable">
      <div v-for="note in report.meta.notes" :key="note">{{ note }}</div>
    </v-alert>

    <v-row v-if="loading"><v-col cols="12" class="text-center"><v-progress-circular indeterminate/></v-col></v-row>
    <v-alert v-else-if="error" type="error">{{ error }}</v-alert>
    <v-alert v-else-if="!report" type="info">No data yet.</v-alert>

    <template v-else>
      <v-row>
        <v-col cols="12" md="3" v-for="(kpi, cur) in report.kpisByCurrency" :key="cur">
          <v-card><v-card-text>
            <div class="text-caption">{{ cur }}</div>
            <div class="text-body-2">Sales: {{ money(kpi.sales) }}</div>
            <div class="text-body-2">Paid: {{ money(kpi.totalPaid) }}</div>
            <div class="text-body-2">Unpaid: {{ money(kpi.unpaidBalances) }}</div>
            <div class="text-body-2">Net Profit: {{ nullableMoney(kpi.netProfit) }}</div>
          </v-card-text></v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6"><v-card><v-card-title>Sales Trend</v-card-title><v-card-text><apexchart type="line" height="260" :options="salesTrend.options" :series="salesTrend.series"/></v-card-text></v-card></v-col>
        <v-col cols="12" md="6"><v-card><v-card-title>Payments by Method</v-card-title><v-card-text><apexchart type="bar" height="260" :options="paymentsChart.options" :series="paymentsChart.series"/></v-card-text></v-card></v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6"><v-card><v-card-title>Installments (Overdue)</v-card-title><v-card-text><apexchart type="area" height="260" :options="overdueChart.options" :series="overdueChart.series"/></v-card-text></v-card></v-col>
        <v-col cols="12" md="6"><v-card><v-card-title>Low Stock</v-card-title>
          <v-data-table :headers="lowStockHeaders" :items="report.inventory.lowStockProducts" density="compact"/>
        </v-card></v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-card><v-card-title>Top Debt Customers</v-card-title>
            <v-data-table :headers="debtHeaders" :items="report.customersDebt.topDebtCustomers" density="compact"/>
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card><v-card-title>Top Paying Customers</v-card-title>
            <v-data-table :headers="payingHeaders" :items="report.customersDebt.topPayingCustomers" density="compact"/>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useReportStore } from '@/stores/report';
import { useInventoryStore } from '@/stores/inventory';
import { useSettingsStore } from '@/stores/settings';

const authStore = useAuthStore();
const reportStore = useReportStore();
const inventoryStore = useInventoryStore();
const settingsStore = useSettingsStore();

const loading = computed(() => reportStore.loading);
const report = computed(() => reportStore.data);
const error = ref('');
const exportingExcel = ref(false);
const exportingPdf = ref(false);

const filters = ref({ branchId: null, currency: 'ALL', period: 'this_month', dateFrom: '', dateTo: '' });
const periodOptions = [
  { title: 'Today', value: 'today' }, { title: 'Yesterday', value: 'yesterday' },
  { title: 'This week', value: 'this_week' }, { title: 'This month', value: 'this_month' },
  { title: 'This year', value: 'this_year' }, { title: 'Custom', value: 'custom' },
];

const showBranchFilter = computed(() => authStore.isGlobalAdmin);
const branchOptions = computed(() => [{ title: 'All branches', value: null }, ...(inventoryStore.branches || []).map((b) => ({ title: b.name, value: b.id }))]);
const currencyOptions = computed(() => [{ title: 'All currencies', value: 'ALL' }, ...((settingsStore.availableCurrencies || ['USD', 'IQD']).map((c) => ({ title: c, value: c }))) ]);

const money = (n) => Number(n || 0).toLocaleString();
const nullableMoney = (n) => (n === null || n === undefined ? 'N/A' : money(n));

function presetDates(period) {
  const now = new Date();
  const ymd = (d) => d.toISOString().slice(0, 10);
  const start = new Date(now);
  const end = new Date(now);
  if (period === 'today') return { dateFrom: ymd(start), dateTo: ymd(end) };
  if (period === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); return { dateFrom: ymd(start), dateTo: ymd(end) }; }
  if (period === 'this_week') { start.setDate(start.getDate() - start.getDay()); return { dateFrom: ymd(start), dateTo: ymd(end) }; }
  if (period === 'this_month') { start.setDate(1); return { dateFrom: ymd(start), dateTo: ymd(end) }; }
  if (period === 'this_year') { start.setMonth(0, 1); return { dateFrom: ymd(start), dateTo: ymd(end) }; }
  return { dateFrom: filters.value.dateFrom, dateTo: filters.value.dateTo };
}

function applyPreset() {
  if (filters.value.period === 'custom') return;
  Object.assign(filters.value, presetDates(filters.value.period));
}

async function load() {
  error.value = '';
  try {
    if (!showBranchFilter.value) filters.value.branchId = null;
    await reportStore.fetchDashboard({ ...filters.value, reportType: 'dashboard' });
    localStorage.setItem('reports.filters', JSON.stringify(filters.value));
  } catch (e) {
    error.value = e?.message || 'Failed to load report';
  }
}

function saveBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

async function downloadExcel() {
  exportingExcel.value = true;
  try {
    const blob = await reportStore.exportExcel({ ...filters.value, reportType: 'accounting' });
    saveBlob(blob, 'accounting-report.xls');
  } finally { exportingExcel.value = false; }
}

async function downloadPdf() {
  exportingPdf.value = true;
  try {
    const blob = await reportStore.exportPdf({ ...filters.value, reportType: 'accounting' });
    saveBlob(blob, 'accounting-report.pdf');
  } finally { exportingPdf.value = false; }
}

const lowStockHeaders = [
  { title: 'Product', key: 'productName' }, { title: 'Warehouse', key: 'warehouseName' }, { title: 'Qty', key: 'quantity' },
];
const debtHeaders = [
  { title: 'Customer', key: 'customerName' }, { title: 'Debt', key: 'totalDebt' },
];
const payingHeaders = [
  { title: 'Customer', key: 'customerName' }, { title: 'Paid', key: 'paid' }, { title: 'Currency', key: 'currency' },
];

const salesTrend = computed(() => ({
  options: { xaxis: { categories: (report.value?.trends?.salesOverTime || []).map((r) => r.day) } },
  series: [{ name: 'Sales', data: (report.value?.trends?.salesOverTime || []).map((r) => Number(r.total || 0)) }],
}));

const paymentsChart = computed(() => ({
  options: { xaxis: { categories: (report.value?.trends?.paymentsByMethod || []).map((r) => `${r.method}-${r.currency}`) } },
  series: [{ name: 'Payments', data: (report.value?.trends?.paymentsByMethod || []).map((r) => Number(r.total || 0)) }],
}));

const overdueChart = computed(() => ({
  options: { xaxis: { categories: (report.value?.trends?.overdueInstallmentsTrend || []).map((r) => r.day) } },
  series: [{ name: 'Overdue', data: (report.value?.trends?.overdueInstallmentsTrend || []).map((r) => Number(r.overdueCount || 0)) }],
}));

onMounted(async () => {
  await Promise.allSettled([settingsStore.fetchCurrencySettings(), showBranchFilter.value ? inventoryStore.fetchBranches() : Promise.resolve()]);
  const cached = localStorage.getItem('reports.filters');
  if (cached) {
    try { filters.value = { ...filters.value, ...JSON.parse(cached) }; } catch {}
  }
  applyPreset();
  await load();
});
</script>
