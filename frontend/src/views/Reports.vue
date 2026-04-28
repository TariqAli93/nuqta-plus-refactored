<template>
  <v-container fluid class="reports-page">
    <v-card rounded="xl" class="mb-4">
      <v-card-text class="d-flex align-center justify-space-between flex-wrap ga-3">
        <div>
          <h1 class="text-h5 mb-1">التقارير المحاسبية</h1>
          <div class="text-medium-emphasis">لوحة تفاعلية موحّدة للمبيعات والتحصيل والمخزون والديون</div>
        </div>
        <div class="d-flex ga-2">
          <v-btn color="success" variant="tonal" :loading="exportingExcel" @click="downloadExcel">
            تصدير Excel
          </v-btn>
          <v-btn color="primary" :loading="exportingPdf" @click="printArabicPdf">
            طباعة / PDF
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <v-card rounded="xl" class="mb-4">
      <v-card-title>الفلاتر</v-card-title>
      <v-divider />
      <v-card-text>
        <v-row>
          <v-col cols="12" md="2" v-if="showBranchFilter">
            <v-select v-model="filters.branchId" :items="branchOptions" label="الفرع" clearable />
          </v-col>
          <v-col cols="12" md="2">
            <v-select v-model="filters.currency" :items="currencyOptions" label="العملة" />
          </v-col>
          <v-col cols="12" md="2">
            <v-select v-model="filters.period" :items="periodOptions" label="الفترة" @update:model-value="applyPreset" />
          </v-col>
          <v-col cols="12" md="2">
            <v-text-field v-model="filters.dateFrom" type="date" label="من تاريخ" :disabled="filters.period !== 'custom'" />
          </v-col>
          <v-col cols="12" md="2">
            <v-text-field v-model="filters.dateTo" type="date" label="إلى تاريخ" :disabled="filters.period !== 'custom'" />
          </v-col>
          <v-col cols="12" md="2" class="d-flex align-end">
            <v-btn block color="primary" :loading="loading" @click="load">تحديث التقرير</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-alert v-if="report?.meta?.notes?.length" type="warning" class="mb-4" variant="tonal">
      <div v-for="note in report.meta.notes" :key="note">{{ note }}</div>
    </v-alert>

    <v-row v-if="loading"><v-col cols="12" class="text-center py-8"><v-progress-circular indeterminate color="primary" /></v-col></v-row>
    <v-alert v-else-if="error" type="error" class="mb-4">{{ error }}</v-alert>
    <v-alert v-else-if="!report" type="info">لا توجد بيانات ضمن الفلاتر الحالية.</v-alert>

    <template v-else>
      <v-row class="mb-2">
        <v-col cols="12" md="3" v-for="(kpi, cur) in report.kpisByCurrency" :key="cur">
          <v-card rounded="xl" class="kpi-card">
            <v-card-text>
              <div class="text-overline">{{ cur }}</div>
              <div class="text-body-2">إجمالي المبيعات: {{ money(kpi.sales) }}</div>
              <div class="text-body-2">المدفوع: {{ money(kpi.totalPaid) }}</div>
              <div class="text-body-2">المتبقي: {{ money(kpi.unpaidBalances) }}</div>
              <div class="text-body-2">صافي الربح: {{ nullableMoney(kpi.netProfit) }}</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-card rounded="xl">
            <v-card-title>اتجاه المبيعات</v-card-title>
            <v-card-text>
              <apexchart type="line" height="280" :options="salesTrend.options" :series="salesTrend.series" />
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card rounded="xl">
            <v-card-title>التحصيل حسب طريقة الدفع</v-card-title>
            <v-card-text>
              <apexchart type="bar" height="280" :options="paymentsChart.options" :series="paymentsChart.series" />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row class="mt-1">
        <v-col cols="12" md="6">
          <v-card rounded="xl">
            <v-card-title>اتجاه الأقساط المتأخرة</v-card-title>
            <v-card-text>
              <apexchart type="area" height="280" :options="overdueChart.options" :series="overdueChart.series" />
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card rounded="xl">
            <v-card-title>المنتجات منخفضة المخزون</v-card-title>
            <v-data-table :headers="lowStockHeaders" :items="report.inventory.lowStockProducts" density="comfortable" />
          </v-card>
        </v-col>
      </v-row>

      <v-row class="mt-1">
        <v-col cols="12" md="6">
          <v-card rounded="xl">
            <v-card-title>أعلى العملاء مديونية</v-card-title>
            <v-data-table :headers="debtHeaders" :items="report.customersDebt.topDebtCustomers" density="comfortable" />
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card rounded="xl">
            <v-card-title>أعلى العملاء تسديدًا</v-card-title>
            <v-data-table :headers="payingHeaders" :items="report.customersDebt.topPayingCustomers" density="comfortable" />
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
  { title: 'اليوم', value: 'today' },
  { title: 'أمس', value: 'yesterday' },
  { title: 'هذا الأسبوع', value: 'this_week' },
  { title: 'هذا الشهر', value: 'this_month' },
  { title: 'هذه السنة', value: 'this_year' },
  { title: 'مخصص', value: 'custom' },
];

const showBranchFilter = computed(() => authStore.isGlobalAdmin);
const branchOptions = computed(() => [
  { title: 'كل الفروع', value: null },
  ...(inventoryStore.branches || []).map((b) => ({ title: b.name, value: b.id })),
]);
const currencyOptions = computed(() => [
  { title: 'كل العملات', value: 'ALL' },
  ...((settingsStore.availableCurrencies || ['USD', 'IQD']).map((c) => ({ title: c, value: c }))),
]);

const money = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const nullableMoney = (n) => (n === null || n === undefined ? 'غير متاح' : money(n));

function presetDates(period) {
  const now = new Date();
  const ymd = (d) => d.toISOString().slice(0, 10);
  const start = new Date(now);
  const end = new Date(now);
  if (period === 'today') return { dateFrom: ymd(start), dateTo: ymd(end) };
  if (period === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
    return { dateFrom: ymd(start), dateTo: ymd(end) };
  }
  if (period === 'this_week') {
    start.setDate(start.getDate() - start.getDay());
    return { dateFrom: ymd(start), dateTo: ymd(end) };
  }
  if (period === 'this_month') {
    start.setDate(1);
    return { dateFrom: ymd(start), dateTo: ymd(end) };
  }
  if (period === 'this_year') {
    start.setMonth(0, 1);
    return { dateFrom: ymd(start), dateTo: ymd(end) };
  }
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
    error.value = e?.message || 'تعذّر تحميل التقرير';
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
    const blob = await reportStore.exportExcel({ ...filters.value, reportType: 'accounting-report' });
    saveBlob(blob, 'تقرير-محاسبي.xls');
  } finally {
    exportingExcel.value = false;
  }
}

function printArabicPdf() {
  exportingPdf.value = true;
  try {
    const d = report.value;
    if (!d) return;
    const rows = Object.entries(d.kpisByCurrency || {}).map(([cur, k]) => `
      <tr>
        <td>${cur}</td>
        <td>${money(k.sales)}</td>
        <td>${money(k.totalPaid)}</td>
        <td>${money(k.unpaidBalances)}</td>
        <td>${nullableMoney(k.netProfit)}</td>
      </tr>`).join('');

    const html = `
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>تقرير محاسبي</title>
        <style>
          body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#1f2937}
          h1{margin:0 0 8px}
          .meta{margin-bottom:18px;color:#4b5563}
          .card{border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin-bottom:14px}
          table{width:100%;border-collapse:collapse}
          th,td{border:1px solid #e5e7eb;padding:10px;text-align:center}
          th{background:#f3f4f6}
          .footer{margin-top:16px;color:#6b7280;font-size:12px}
        </style>
      </head>
      <body>
        <h1>التقرير المحاسبي</h1>
        <div class="meta">الفلاتر: من ${filters.value.dateFrom} إلى ${filters.value.dateTo} | العملة: ${filters.value.currency}</div>
        <div class="card">
          <h3>ملخص المؤشرات</h3>
          <table>
            <thead>
              <tr><th>العملة</th><th>إجمالي المبيعات</th><th>المدفوع</th><th>المتبقي</th><th>صافي الربح</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="card">
          <h3>ملاحظات</h3>
          ${(d.meta?.notes || []).map((n) => `<div>- ${n}</div>`).join('')}
        </div>
        <div class="footer">تم إنشاء التقرير بتاريخ ${new Date().toLocaleString('ar-IQ')}</div>
      </body>
      </html>`;

    const win = window.open('', '_blank', 'width=1200,height=900');
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  } finally {
    exportingPdf.value = false;
  }
}

const lowStockHeaders = [
  { title: 'المنتج', key: 'productName' },
  { title: 'المخزن', key: 'warehouseName' },
  { title: 'الكمية', key: 'quantity' },
];
const debtHeaders = [
  { title: 'العميل', key: 'customerName' },
  { title: 'المديونية', key: 'totalDebt' },
];
const payingHeaders = [
  { title: 'العميل', key: 'customerName' },
  { title: 'المدفوع', key: 'paid' },
  { title: 'العملة', key: 'currency' },
];

const salesTrend = computed(() => ({
  chart: { toolbar: { show: false } },
  options: { xaxis: { categories: (report.value?.trends?.salesOverTime || []).map((r) => r.day) } },
  series: [
    { name: 'المبيعات', data: (report.value?.trends?.salesOverTime || []).map((r) => Number(r.total || 0)) },
  ],
}));

const paymentsChart = computed(() => ({
  options: { xaxis: { categories: (report.value?.trends?.paymentsByMethod || []).map((r) => `${r.method}-${r.currency}`) } },
  series: [
    { name: 'التحصيل', data: (report.value?.trends?.paymentsByMethod || []).map((r) => Number(r.total || 0)) },
  ],
}));

const overdueChart = computed(() => ({
  options: { xaxis: { categories: (report.value?.trends?.overdueInstallmentsTrend || []).map((r) => r.day) } },
  series: [
    { name: 'الأقساط المتأخرة', data: (report.value?.trends?.overdueInstallmentsTrend || []).map((r) => Number(r.overdueCount || 0)) },
  ],
}));

onMounted(async () => {
  await Promise.allSettled([
    settingsStore.fetchCurrencySettings(),
    showBranchFilter.value ? inventoryStore.fetchBranches() : Promise.resolve(),
  ]);
  const cached = localStorage.getItem('reports.filters');
  if (cached) {
    try {
      filters.value = { ...filters.value, ...JSON.parse(cached) };
    } catch {
      // ignore broken cache
    }
  }
  applyPreset();
  await load();
});
</script>

<style scoped>
.reports-page {
  direction: rtl;
}
.kpi-card {
  border: 1px solid rgba(25, 118, 210, 0.2);
}
</style>
