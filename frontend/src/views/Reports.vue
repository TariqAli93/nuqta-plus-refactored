<template>
  <v-container fluid class="reports-page pa-3 pa-sm-4">
    <ReportHeader
      :date-from="filters.dateFrom"
      :date-to="filters.dateTo"
      :currency="filters.currency"
      :branch-label="currentBranchLabel"
      :generated-at="report?.meta?.generatedAt || ''"
      :loading="loading"
      :exporting-excel="exportingExcel"
      :exporting-pdf="exportingPdf"
      :has-data="!!report"
      @refresh="load"
      @export-excel="downloadExcel"
      @export-pdf="downloadPdf"
      @print="printArabicPdf"
    />

    <ReportFilters
      v-model="filters"
      :branches="inventoryStore.branches || []"
      :available-currencies="settingsStore.availableCurrencies || ['USD', 'IQD']"
      :show-branch-filter="showBranchFilter"
      :loading="loading"
      @apply="load"
      @preset-change="onPresetChange"
      @clear="clearFilters"
    />

    <v-alert
      v-if="report?.meta?.notes?.length"
      type="warning"
      variant="tonal"
      density="comfortable"
      border="start"
      class="mb-4"
      closable
    >
      <div class="text-subtitle-2 font-weight-bold mb-1">
        تنبيهات على البيانات
      </div>
      <ul class="ms-4 mb-0">
        <li v-for="note in report.meta.notes" :key="note" class="text-body-2">
          {{ translateNote(note) }}
        </li>
      </ul>
    </v-alert>

    <!-- Loading -->
    <div v-if="loading && !report" class="loading-state">
      <v-progress-circular indeterminate color="primary" size="48" />
      <div class="text-body-2 text-medium-emphasis mt-3">
        جاري تحميل بيانات التقرير...
      </div>
    </div>

    <!-- Error -->
    <v-alert
      v-else-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      border="start"
      closable
    >
      <div class="text-subtitle-2 font-weight-bold mb-1">
        تعذّر تحميل التقرير
      </div>
      <div class="text-body-2">{{ error }}</div>
      <template #append>
        <v-btn
          variant="text"
          size="small"
          color="error"
          prepend-icon="mdi-refresh"
          @click="load"
        >
          إعادة المحاولة
        </v-btn>
      </template>
    </v-alert>

    <!-- Empty -->
    <EmptyState
      v-else-if="!report"
      title="لا توجد بيانات للعرض"
      description="جرّب تعديل الفلاتر أو الضغط على تطبيق لاستعراض التقرير."
      icon="mdi-file-search-outline"
      :actions="[
        { text: 'تطبيق الفلاتر', icon: 'mdi-check', onClick: load },
      ]"
    />

    <!-- Data -->
    <template v-else>
      <ReportKpiCards
        :kpis-by-currency="report.kpisByCurrency || {}"
        :inventory="report.inventory || {}"
        :expenses-summary="report.expensesSummary || {}"
        :can-view-profit="canViewProfit"
      />

      <ReportCharts
        :trends="report.trends || {}"
        :profit-loss="report.profitLoss || {}"
        :expenses-summary="report.expensesSummary || {}"
        :can-view-profit="canViewProfit"
      />

      <ReportTables
        :kpis-by-currency="report.kpisByCurrency || {}"
        :installments-summary="report.installmentsSummary || {}"
        :expenses-summary="report.expensesSummary || {}"
        :inventory="report.inventory || {}"
        :customers-debt="report.customersDebt || {}"
        :can-view-profit="canViewProfit"
      />
    </template>
  </v-container>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useReportStore } from '@/stores/report';
import { useInventoryStore } from '@/stores/inventory';
import { useSettingsStore } from '@/stores/settings';
import EmptyState from '@/components/EmptyState.vue';
import ReportHeader from '@/components/reports/ReportHeader.vue';
import ReportFilters from '@/components/reports/ReportFilters.vue';
import ReportKpiCards from '@/components/reports/ReportKpiCards.vue';
import ReportCharts from '@/components/reports/ReportCharts.vue';
import ReportTables from '@/components/reports/ReportTables.vue';

const authStore = useAuthStore();
const reportStore = useReportStore();
const inventoryStore = useInventoryStore();
const settingsStore = useSettingsStore();

const loading = computed(() => reportStore.loading);
const report = computed(() => reportStore.data);
const error = ref('');
const exportingExcel = ref(false);
const exportingPdf = ref(false);

const defaultFilters = () => ({
  branchId: null,
  currency: 'ALL',
  period: 'this_month',
  dateFrom: '',
  dateTo: '',
});

const filters = ref(defaultFilters());

const showBranchFilter = computed(() => authStore.isGlobalAdmin);

// Profit-sensitive sections require manager-level role.
const canViewProfit = computed(() => {
  return (
    authStore.hasPermission &&
    authStore.hasPermission(['manage:sales'])
  );
});

const currentBranchLabel = computed(() => {
  const id = filters.value.branchId;
  if (!id) return 'كل الفروع';
  const branch = (inventoryStore.branches || []).find((b) => b.id === id);
  return branch?.name || `فرع #${id}`;
});

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function presetDates(period) {
  const now = new Date();
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

function onPresetChange(period) {
  if (period === 'custom') return;
  Object.assign(filters.value, presetDates(period));
}

function clearFilters() {
  filters.value = defaultFilters();
  Object.assign(filters.value, presetDates(filters.value.period));
}

function translateNote(note) {
  const map = {
    'Currency conversion unavailable: totals are grouped by currency only.':
      'تحويل العملات غير متاح: يتم تجميع الإجماليات حسب كل عملة على حدة.',
    'Expenses module is not available in current schema; expenses shown as 0.':
      'وحدة المصاريف غير متوفرة في المخطط الحالي، يتم عرض المصاريف كـ 0.',
  };
  return map[note] || note;
}

async function load() {
  error.value = '';
  try {
    if (!showBranchFilter.value) filters.value.branchId = null;
    await reportStore.fetchDashboard({
      ...filters.value,
      reportType: 'dashboard',
    });
    localStorage.setItem('reports.filters', JSON.stringify(filters.value));
  } catch (e) {
    error.value = e?.message || e?.error || 'تعذّر تحميل التقرير';
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
    const blob = await reportStore.exportExcel({
      ...filters.value,
      reportType: 'accounting-report',
    });
    saveBlob(blob, 'تقرير-محاسبي.xls');
  } catch (e) {
    error.value = e?.message || e?.error || 'تعذّر تصدير ملف Excel';
  } finally {
    exportingExcel.value = false;
  }
}

async function downloadPdf() {
  exportingPdf.value = true;
  try {
    const blob = await reportStore.exportPdf({
      ...filters.value,
      reportType: 'accounting-report',
    });
    saveBlob(blob, 'تقرير-محاسبي.pdf');
  } catch (e) {
    error.value = e?.message || e?.error || 'تعذّر تصدير ملف PDF';
  } finally {
    exportingPdf.value = false;
  }
}

const moneyFmt = (n) =>
  Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const nullableMoney = (n) =>
  n === null || n === undefined ? 'غير متاح' : moneyFmt(n);

function printArabicPdf() {
  const d = report.value;
  if (!d) return;
  const rows = Object.entries(d.kpisByCurrency || {})
    .map(
      ([cur, k]) => `
      <tr>
        <td>${cur}</td>
        <td>${moneyFmt(k.sales)}</td>
        <td>${moneyFmt(k.totalPaid)}</td>
        <td>${moneyFmt(k.unpaidBalances)}</td>
        <td>${canViewProfit.value ? nullableMoney(k.netProfit) : '—'}</td>
      </tr>`,
    )
    .join('');

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
      <div class="meta">
        الفلاتر: من ${filters.value.dateFrom} إلى ${filters.value.dateTo}
        | العملة: ${filters.value.currency}
        | الفرع: ${currentBranchLabel.value}
      </div>
      <div class="card">
        <h3>ملخص المؤشرات</h3>
        <table>
          <thead>
            <tr>
              <th>العملة</th>
              <th>إجمالي المبيعات</th>
              <th>المدفوع</th>
              <th>المتبقي</th>
              <th>صافي الربح</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="card">
        <h3>ملاحظات</h3>
        ${(d.meta?.notes || []).map((n) => `<div>- ${translateNote(n)}</div>`).join('')}
      </div>
      <div class="footer">تم إنشاء التقرير بتاريخ ${new Date().toLocaleString('ar-IQ')}</div>
    </body>
    </html>`;

  const win = window.open('', '_blank', 'width=1200,height=900');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

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
  if (filters.value.period !== 'custom') {
    Object.assign(filters.value, presetDates(filters.value.period));
  }
  await load();
});
</script>

<style scoped lang="scss">
.reports-page {
  direction: rtl;
  max-width: 1600px;
  margin: 0 auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  text-align: center;
}

@media print {
  .reports-page :deep(.v-tabs),
  .reports-page :deep(.export-actions),
  .reports-page :deep(.report-filters) {
    display: none !important;
  }
}
</style>
