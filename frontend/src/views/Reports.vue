<template>
  <div class="page-shell reports-page">
    <PageHeader
      title="التقارير المحاسبية"
      subtitle="ملخص المبيعات، المخزون والمحاسبة"
      icon="mdi-chart-box"
    />

    <ReportHeader
      :report="report"
      report-type="dashboard"
      :date-from="filters.dateFrom"
      :date-to="filters.dateTo"
      :currency="filters.currency"
      :branch-label="currentBranchLabel"
      :user-name="currentUserName"
      :generated-at="report?.meta?.generatedAt || ''"
      :can-view-profit="canViewProfit"
      :loading="loading"
      @refresh="load"
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

    <!-- Accounting-period scoping (القيد المحاسبي). When the feature is on, the
         live report follows the open period; if none is open it reads zero. -->
    <v-alert
      v-if="accountingPeriodsEnabled && report?.meta?.noOpenPeriod"
      type="info"
      variant="tonal"
      density="comfortable"
      border="start"
      class="mb-4"
    >
      <div class="text-subtitle-2 font-weight-bold mb-1">لا يوجد قيد محاسبي مفتوح</div>
      <div class="text-body-2">
        التقارير الحالية تعرض صفراً حتى يتم فتح قيد محاسبي جديد. افتح قيداً محاسبياً لبدء فترة مالية جديدة،
        أو اطّلع على لقطة أحد القيود المغلقة بالأسفل.
      </div>
    </v-alert>

    <!-- Closed-period snapshot viewer — reads the FROZEN snapshot, never live. -->
    <v-card
      v-if="accountingPeriodsEnabled && closedPeriods.length"
      class="page-section mb-4"
      variant="tonal"
    >
      <v-card-text class="d-flex flex-wrap align-center gap-3">
        <v-icon color="primary">mdi-book-lock-outline</v-icon>
        <span class="text-subtitle-2">عرض تقرير قيد محاسبي مغلق (لقطة مجمّدة)</span>
        <v-select
          v-model="selectedClosedPeriodId"
          :items="closedPeriodOptions"
          item-title="title"
          item-value="value"
          label="اختر قيداً مغلقاً"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          style="max-width: 320px"
          @update:model-value="loadClosedSnapshot"
        />
      </v-card-text>
      <template v-if="closedSnapshot">
        <v-divider />
        <v-card-text>
          <div class="text-caption text-medium-emphasis mb-2">
            هذه لقطة مجمّدة وقت الإغلاق — لا تتغير حتى لو تغيّرت الأسعار أو المنتجات لاحقاً.
          </div>
          <div
            v-for="(t, cur) in (closedSnapshot.byCurrency || {})"
            :key="cur"
            class="snapshot-block"
          >
            <div class="snapshot-cur">{{ cur }}</div>
            <div class="snapshot-grid">
              <div><span>صافي المبيعات</span><b>{{ formatCurrency(t.netSalesAfterReturns ?? t.netSales, cur) }}</b></div>
              <div><span>المرتجعات</span><b>{{ formatCurrency(t.returnedValue, cur) }}</b></div>
              <div><span>تكلفة البضاعة المباعة</span><b>{{ formatCurrency(t.cogsNet, cur) }}</b></div>
              <div><span>المصاريف</span><b>{{ formatCurrency(t.expenses, cur) }}</b></div>
              <div><span>إجمالي الربح</span><b>{{ formatCurrency(t.grossProfit, cur) }}</b></div>
              <div>
                <span>صافي الربح / الخسارة</span>
                <b :class="t.netProfit < 0 ? 'text-error' : 'text-success'">
                  {{ formatCurrency(t.netProfit, cur) }}
                </b>
              </div>
            </div>
          </div>
        </v-card-text>
      </template>
    </v-card>

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

      <AgingPanel :data="aging" :loading="agingLoading" />

      <ReportTables
        :kpis-by-currency="report.kpisByCurrency || {}"
        :installments-summary="report.installmentsSummary || {}"
        :expenses-summary="report.expensesSummary || {}"
        :inventory="report.inventory || {}"
        :customers-debt="report.customersDebt || {}"
        :can-view-profit="canViewProfit"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useReportStore } from '@/stores/report';
import { useInventoryStore } from '@/stores/inventory';
import { useSettingsStore } from '@/stores/settings';
import { useAccountingPeriodStore } from '@/stores/accountingPeriod';
import { formatCurrency } from '@/utils/formatters';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import ReportHeader from '@/components/reports/ReportHeader.vue';
import ReportFilters from '@/components/reports/ReportFilters.vue';
import ReportKpiCards from '@/components/reports/ReportKpiCards.vue';
import ReportCharts from '@/components/reports/ReportCharts.vue';
import ReportTables from '@/components/reports/ReportTables.vue';
import AgingPanel from '@/components/reports/AgingPanel.vue';

const authStore = useAuthStore();
const reportStore = useReportStore();
const inventoryStore = useInventoryStore();
const settingsStore = useSettingsStore();
const accountingPeriodStore = useAccountingPeriodStore();

const loading = computed(() => reportStore.loading);
const report = computed(() => reportStore.data);
const aging = computed(() => reportStore.aging);
const agingLoading = ref(false);
const error = ref('');

// ── Accounting periods (القيد المحاسبي) ─────────────────────────────────────
const accountingPeriodsEnabled = computed(
  () => authStore.hasFeature?.('accountingPeriods') === true,
);
const closedPeriods = computed(() => accountingPeriodStore.closedPeriods || []);
const closedPeriodOptions = computed(() =>
  closedPeriods.value.map((p) => ({
    value: p.id,
    title: `قيد #${p.id} — ${typeLabelMap[p.type] || p.type}${p.branchName ? ' — ' + p.branchName : ''} (${fmtShort(p.closedAt)})`,
  })),
);
const selectedClosedPeriodId = ref(null);
const closedSnapshot = ref(null);

const typeLabelMap = { daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', yearly: 'سنوي' };
function fmtShort(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('ar', { dateStyle: 'medium' });
  } catch {
    return String(d);
  }
}

async function loadClosedSnapshot(id) {
  if (!id) {
    closedSnapshot.value = null;
    return;
  }
  // Read the frozen snapshot from the period detail (totals_json) — never the
  // live report endpoint, so closed-period figures stay fixed.
  const detail = await accountingPeriodStore.fetchById(id).catch(() => null);
  closedSnapshot.value = detail?.totals || detail?.totalsJson || null;
}

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

const currentUserName = computed(
  () => authStore.user?.fullName || authStore.user?.username || '',
);

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
  };
  return map[note] || note;
}

async function load() {
  error.value = '';
  try {
    if (!showBranchFilter.value) filters.value.branchId = null;
    agingLoading.value = true;
    await Promise.all([
      reportStore.fetchDashboard({
        ...filters.value,
        reportType: 'dashboard',
      }),
      reportStore.fetchAging({
        branchId: filters.value.branchId || undefined,
        currency: filters.value.currency,
      }),
    ]);
    localStorage.setItem('reports.filters', JSON.stringify(filters.value));
  } catch (e) {
    error.value = e?.message || e?.error || 'تعذّر تحميل التقرير';
  } finally {
    agingLoading.value = false;
  }
}

onMounted(async () => {
  await Promise.allSettled([
    settingsStore.fetchCurrencySettings(),
    showBranchFilter.value ? inventoryStore.fetchBranches() : Promise.resolve(),
    accountingPeriodsEnabled.value
      ? accountingPeriodStore.fetchAll({ status: 'closed' })
      : Promise.resolve(),
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
.snapshot-block { margin-bottom: 0.75rem; }
.snapshot-cur {
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  margin-bottom: 0.25rem;
}
.snapshot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.5rem 1.5rem;
  div {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px dashed rgba(var(--v-theme-on-surface), 0.08);
    padding: 0.2rem 0;
  }
}

@media print {
  .reports-page :deep(.v-tabs),
  .reports-page :deep(.export-actions),
  .reports-page :deep(.report-filters) {
    display: none !important;
  }
}
</style>
