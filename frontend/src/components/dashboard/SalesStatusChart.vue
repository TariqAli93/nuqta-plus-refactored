<template>
  <v-card class="h-full rounded-2xl" elevation="0">
    <v-card-title class="flex items-center gap-2 p-6 pb-2">
      <v-icon color="info" icon="mdi-chart-donut" />
      <span class="text-xl font-bold">حالة المبيعات</span>
    </v-card-title>

    <v-card-text class="p-4 flex items-center justify-center" style="height: 300px">
      <div v-if="loading" class="flex flex-col items-center justify-center h-full">
        <v-progress-circular indeterminate color="info" size="40" />
      </div>

      <div v-else-if="!hasData" class="flex flex-col items-center justify-center h-full text-gray-400">
        <v-icon size="48" class="mb-2 opacity-50">mdi-chart-donut</v-icon>
        <p>لا توجد بيانات</p>
      </div>

      <apexchart 
        v-else 
        width="100%" 
        height="100%" 
        type="donut" 
        :options="chartOptions" 
        :series="chartSeries" 
      />
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  sales: {
    type: Array,
    default: () => []
  },
  loading: Boolean
});

const hasData = computed(() => props.sales && props.sales.length > 0);

const processData = computed(() => {
  if (!hasData.value) return { labels: [], series: [] };

  const counts = {
    completed: 0,
    pending: 0,
    cancelled: 0
  };

  props.sales.forEach(sale => {
    if (counts[sale.status] !== undefined) {
      counts[sale.status]++;
    }
  });

  return {
    labels: ['مكتمل', 'قيد الانتظار', 'ملغي'],
    series: [counts.completed, counts.pending, counts.cancelled]
  };
});

const chartSeries = computed(() => processData.value.series);

const chartOptions = computed(() => ({
  chart: {
    type: 'donut',
    fontFamily: 'inherit',
  },
  labels: processData.value.labels,
  colors: ['#10B981', '#F59E0B', '#EF4444'], // Success, Warning, Error
  plotOptions: {
    pie: {
      donut: {
        size: '70%',
        labels: {
          show: true,
          total: {
            show: true,
            label: 'الإجمالي',
            formatter: function (w) {
              return w.globals.seriesTotals.reduce((a, b) => a + b, 0);
            }
          }
        }
      }
    }
  },
  dataLabels: { enabled: false },
  legend: { position: 'bottom' },
  stroke: { show: false }
}));
</script>
