<template>
  <v-card>
    <v-card-title class="flex items-center justify-between p-6 pb-2">
      <div class="flex items-center gap-2">
        <v-icon color="primary" icon="mdi-chart-line" />
        <span class="text-xl font-bold">تحليل الإيرادات</span>
      </div>
      
      <!-- Time Range Selector could go here -->
      <v-chip-group v-model="selectedRange" mandatory variant="outlined" color="primary">
        <v-chip value="7d" size="small" label>7 أيام</v-chip>
        <v-chip value="30d" size="small" label>30 يوم</v-chip>
      </v-chip-group>
    </v-card-title>

    <v-card-text class="p-4" style="height: 350px">
      <div v-if="loading" class="flex flex-col items-center justify-center h-full">
        <v-progress-circular indeterminate color="primary" size="48" />
        <p class="mt-4 text-gray-500">جاري تحليل البيانات...</p>
      </div>
      
      <div v-else-if="!hasData" class="flex flex-col items-center justify-center h-full text-gray-400">
        <v-icon size="64" class="mb-2 opacity-50">mdi-chart-timeline-variant</v-icon>
        <p>لا توجد بيانات كافية للعرض</p>
      </div>

      <apexchart 
        v-else 
        width="100%" 
        height="100%" 
        type="area" 
        :options="chartOptions" 
        :series="chartSeries" 
      />
    </v-card-text>
  </v-card>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useTheme } from 'vuetify';
import { useCurrency } from '@/composables/useCurrency';

const theme = useTheme();

const props = defineProps({
  sales: {
    type: Array,
    default: () => []
  },
  loading: Boolean
});

const {
  defaultCurrency,
  initialize: initCurrency,
  convertAmountSync,
  formatCurrency: formatCurrencyAmount,
} = useCurrency();

const selectedRange = ref('7d');

const hasData = computed(() => {
  return props.sales && props.sales.length > 0;
});

const processData = computed(() => {
  if (!hasData.value) return { categories: [], data: [] };

  const days = selectedRange.value === '7d' ? 7 : 30;
  const dataMap = new Map();
  const today = new Date();
  
  // Initialize last N days with 0
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    dataMap.set(dateStr, 0);
  }

  // Aggregate sales with currency conversion
  props.sales.forEach(sale => {
    if (sale.createdAt && (sale.status === 'completed' || sale.status === 'pending')) {
      const date = new Date(sale.createdAt).toISOString().split('T')[0];
      if (dataMap.has(date)) {
        const amount = parseFloat(sale.total || 0);
        const currency = sale.currency || 'IQD';
        const converted = convertAmountSync(amount, currency);
        dataMap.set(date, dataMap.get(date) + converted);
      }
    }
  });

  return {
    categories: Array.from(dataMap.keys()).map(date => {
       // Format date for display (e.g., "25 Oct")
       const d = new Date(date);
       return new Intl.DateTimeFormat('ar-IQ', { day: 'numeric', month: 'short' }).format(d);
    }),
    data: Array.from(dataMap.values())
  };
});

const chartSeries = computed(() => ([{
  name: 'الإيرادات',
  data: processData.value.data
}]));

const chartOptions = computed(() => ({
  chart: {
    type: 'area',
    fontFamily: 'inherit',
    toolbar: { show: false },
    animations: { enabled: true }
  },
  colors: ['#7B5CFF'], // Matches primary color
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.45,
      opacityTo: 0.05,
      stops: [20, 100]
    }
  },
  dataLabels: { enabled: false },
  stroke: {
    curve: 'smooth',
    width: 3
  },
  xaxis: {
    categories: processData.value.categories,
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: {
      style: { colors: '#9ca3af', fontFamily: 'inherit' }
    }
  },
  yaxis: {
    labels: {
      style: { colors: '#9ca3af', fontFamily: 'inherit' },
      formatter: (value) => {
        return value >= 1000 ? `${(value/1000).toFixed(1)}k` : value;
      }
    }
  },
  grid: {
    borderColor: '#f3f4f6', 
    strokeDashArray: 4,
    yaxis: { lines: { show: true } }
  },
  theme: {
    mode: theme.name.value
  },
  tooltip: {
    theme: theme.name.value,
    y: {
      formatter: (val) => {
        return formatCurrencyAmount(val);
      }
    }
  }
}));

onMounted(async () => {
  await initCurrency();
});
</script>
