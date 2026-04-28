<template>
  <section class="report-charts mb-4">
    <v-row dense>
      <v-col cols="12" lg="6">
        <ChartCard
          title="اتجاه المبيعات"
          icon="mdi-chart-line"
          :has-data="hasSalesTrend"
          empty-message="لا توجد بيانات مبيعات في هذه الفترة"
        >
          <apexchart
            type="area"
            height="300"
            :options="salesTrendOptions"
            :series="salesTrendSeries"
          />
        </ChartCard>
      </v-col>

      <v-col cols="12" lg="6">
        <ChartCard
          title="التحصيل حسب طريقة الدفع"
          icon="mdi-cash-multiple"
          :has-data="hasPayments"
          empty-message="لا توجد دفعات مسجّلة"
        >
          <apexchart
            type="bar"
            height="300"
            :options="paymentsOptions"
            :series="paymentsSeries"
          />
        </ChartCard>
      </v-col>

      <v-col v-if="canViewProfit" cols="12" lg="6">
        <ChartCard
          title="اتجاه الربح"
          icon="mdi-finance"
          :has-data="hasProfitTrend"
          empty-message="بيانات الربح غير متاحة بدقة"
        >
          <apexchart
            type="line"
            height="300"
            :options="profitOptions"
            :series="profitSeries"
          />
        </ChartCard>
      </v-col>

      <v-col cols="12" :lg="canViewProfit ? 6 : 12">
        <ChartCard
          title="اتجاه الأقساط المتأخرة"
          icon="mdi-alert-circle-outline"
          :has-data="hasOverdueTrend"
          empty-message="لا توجد أقساط متأخرة"
        >
          <apexchart
            type="area"
            height="300"
            :options="overdueOptions"
            :series="overdueSeries"
          />
        </ChartCard>
      </v-col>

      <v-col v-if="expensesSummary?.supported" cols="12" lg="6">
        <ChartCard
          title="المصاريف حسب الفئة"
          icon="mdi-cash-minus"
          :has-data="hasExpenseCategories"
          empty-message="لا توجد مصاريف مسجّلة"
        >
          <apexchart
            type="bar"
            height="300"
            :options="expensesOptions"
            :series="expensesSeries"
          />
        </ChartCard>
      </v-col>
    </v-row>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { useTheme } from 'vuetify';
import ChartCard from './ChartCard.vue';

const props = defineProps({
  trends: { type: Object, default: () => ({}) },
  profitLoss: { type: Object, default: () => ({}) },
  expensesSummary: { type: Object, default: () => ({}) },
  canViewProfit: Boolean,
});

const theme = useTheme();
const themeMode = computed(() => theme.global.current.value.dark ? 'dark' : 'light');

const baseChart = computed(() => ({
  fontFamily: 'inherit',
  toolbar: { show: false },
  animations: { enabled: true, speed: 300 },
  zoom: { enabled: false },
}));

const baseGrid = computed(() => ({
  borderColor: 'rgba(127,127,127,0.15)',
  strokeDashArray: 4,
  yaxis: { lines: { show: true } },
}));

const axisStyle = computed(() => ({
  style: {
    colors: themeMode.value === 'dark' ? '#9ca3af' : '#6b7280',
    fontFamily: 'inherit',
  },
}));

// ---- Sales trend ----
const salesByDay = computed(() => {
  const list = props.trends?.salesOverTime || [];
  const map = new Map();
  for (const r of list) {
    const day = r.day;
    map.set(day, (map.get(day) || 0) + Number(r.total || 0));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, total]) => ({ day, total }));
});

const hasSalesTrend = computed(() => salesByDay.value.length > 0);

const salesTrendSeries = computed(() => [
  { name: 'المبيعات', data: salesByDay.value.map((r) => r.total) },
]);

const salesTrendOptions = computed(() => ({
  chart: { type: 'area', ...baseChart.value },
  colors: ['#0078D4'],
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 3 },
  fill: {
    type: 'gradient',
    gradient: { opacityFrom: 0.4, opacityTo: 0.05 },
  },
  xaxis: {
    categories: salesByDay.value.map((r) => r.day),
    labels: axisStyle.value,
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    labels: {
      ...axisStyle.value,
      formatter: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v),
    },
  },
  grid: baseGrid.value,
  theme: { mode: themeMode.value },
  tooltip: { theme: themeMode.value },
}));

// ---- Payments by method ----
const paymentsByMethod = computed(() => props.trends?.paymentsByMethod || []);
const hasPayments = computed(() => paymentsByMethod.value.length > 0);

const paymentsSeries = computed(() => [
  {
    name: 'التحصيل',
    data: paymentsByMethod.value.map((r) => Number(r.total || 0)),
  },
]);

const methodLabels = {
  cash: 'نقدًا',
  card: 'بطاقة',
  transfer: 'تحويل',
  installment: 'قسط',
};

const paymentsOptions = computed(() => ({
  chart: { type: 'bar', ...baseChart.value },
  colors: ['#107C10'],
  dataLabels: { enabled: false },
  plotOptions: {
    bar: { borderRadius: 6, columnWidth: '55%' },
  },
  xaxis: {
    categories: paymentsByMethod.value.map(
      (r) => `${methodLabels[r.method] || r.method} (${r.currency})`,
    ),
    labels: axisStyle.value,
  },
  yaxis: {
    labels: {
      ...axisStyle.value,
      formatter: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v),
    },
  },
  grid: baseGrid.value,
  theme: { mode: themeMode.value },
  tooltip: { theme: themeMode.value },
}));

// ---- Overdue installments trend ----
const overdueByDay = computed(() => {
  const list = props.trends?.overdueInstallmentsTrend || [];
  return [...list]
    .map((r) => ({
      day: r.day ? String(r.day).slice(0, 10) : '',
      count: Number(r.overdueCount || 0),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
});

const hasOverdueTrend = computed(() => overdueByDay.value.length > 0);

const overdueSeries = computed(() => [
  { name: 'أقساط متأخرة', data: overdueByDay.value.map((r) => r.count) },
]);

const overdueOptions = computed(() => ({
  chart: { type: 'area', ...baseChart.value },
  colors: ['#D13438'],
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 2 },
  fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0.05 } },
  xaxis: {
    categories: overdueByDay.value.map((r) => r.day),
    labels: axisStyle.value,
  },
  yaxis: { labels: axisStyle.value },
  grid: baseGrid.value,
  theme: { mode: themeMode.value },
  tooltip: { theme: themeMode.value },
}));

// ---- Profit trend (per currency from profitLoss) ----
const profitData = computed(() => {
  const byCur = props.profitLoss?.byCurrency || {};
  return Object.entries(byCur)
    .filter(([, v]) => v?.netProfit !== null && v?.netProfit !== undefined)
    .map(([cur, v]) => ({ cur, value: Number(v.netProfit || 0) }));
});

const hasProfitTrend = computed(() => profitData.value.length > 0);

const profitSeries = computed(() => [
  { name: 'صافي الربح', data: profitData.value.map((r) => r.value) },
]);

const profitOptions = computed(() => ({
  chart: { type: 'line', ...baseChart.value },
  colors: ['#7B5CFF'],
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 3 },
  markers: { size: 5 },
  xaxis: {
    categories: profitData.value.map((r) => r.cur),
    labels: axisStyle.value,
  },
  yaxis: { labels: axisStyle.value },
  grid: baseGrid.value,
  theme: { mode: themeMode.value },
  tooltip: { theme: themeMode.value },
}));

// ---- Expenses by category (only when supported) ----
const expenseCategories = computed(
  () => props.expensesSummary?.byCategory || [],
);
const hasExpenseCategories = computed(() => expenseCategories.value.length > 0);

const expensesSeries = computed(() => [
  {
    name: 'المصاريف',
    data: expenseCategories.value.map((r) => Number(r.total || 0)),
  },
]);

const expensesOptions = computed(() => ({
  chart: { type: 'bar', ...baseChart.value },
  colors: ['#FFB900'],
  dataLabels: { enabled: false },
  plotOptions: { bar: { borderRadius: 6, columnWidth: '55%' } },
  xaxis: {
    categories: expenseCategories.value.map((r) => r.category || r.name || '—'),
    labels: axisStyle.value,
  },
  yaxis: { labels: axisStyle.value },
  grid: baseGrid.value,
  theme: { mode: themeMode.value },
  tooltip: { theme: themeMode.value },
}));
</script>
