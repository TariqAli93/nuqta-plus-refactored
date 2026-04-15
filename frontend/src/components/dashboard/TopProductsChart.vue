<template>
  <v-card class="top-products-card" elevation="2" rounded="xl">
    <!-- Header -->
    <v-card-title class="d-flex align-center justify-space-between pa-6 pb-4">
      <div class="d-flex align-center gap-3">
        <v-icon color="primary">mdi-package-variant-closed</v-icon>
        <div>
          <h3 class="text-h6 font-weight-bold mb-1">المنتجات الأكثر مبيعاً</h3>
          <p class="text-caption text-medium-emphasis mb-0">
            أفضل {{ topProducts.length }} منتج حسب الكمية المباعة
          </p>
        </div>
      </div>
      <v-btn
        icon
        variant="text"
        size="small"
        :loading="loadingProducts"
        :disabled="loadingProducts"
        @click="fetchTopProducts"
      >
        <v-icon>mdi-refresh</v-icon>
      </v-btn>
    </v-card-title>

    <v-divider></v-divider>

    <!-- Content -->
    <v-card-text class="pa-0">
      <!-- Loading State -->
      <div
        v-if="loading || loadingProducts"
        class="d-flex flex-column align-center justify-center pa-8"
        style="min-height: 350px"
      >
        <v-progress-circular
          indeterminate
          color="primary"
          size="56"
          width="4"
        ></v-progress-circular>
        <p class="text-body-2 text-medium-emphasis mt-4">جاري تحميل البيانات...</p>
      </div>

      <!-- Empty State -->
      <div
        v-else-if="!hasData"
        class="d-flex flex-column align-center justify-center pa-8"
        style="min-height: 350px"
      >
        <v-icon size="80" color="grey-lighten-1" class="mb-4">mdi-package-variant-closed</v-icon>
        <p class="text-h6 text-medium-emphasis mb-2">لا توجد بيانات</p>
        <p class="text-body-2 text-medium-emphasis">لم يتم بيع أي منتجات بعد</p>
      </div>

      <!-- Chart and List -->
      <div v-else class="d-flex flex-column">
        <!-- Chart Section -->
        <div class="pa-4" style="height: 280px">
          <apexchart
            width="100%"
            height="100%"
            type="bar"
            :options="chartOptions"
            :series="chartSeries"
          />
        </div>
      </div>
    </v-card-text>
  </v-card>

  <v-card class="top-products-card mt-5 d-none" elevation="2" rounded="xl">
    <div class="pa-4">
      <div class="d-flex flex-column gap-2">
        <div
          v-for="(product, index) in topProducts"
          :key="product.productId"
          class="product-item d-flex align-center justify-space-between pa-3 rounded-lg"
          :class="`rank-${index + 1}`"
        >
          <div class="d-flex align-center gap-3 flex-grow-1">
            <!-- Rank Badge -->
            <v-avatar
              size="36"
              :color="getRankColor(index + 1)"
              class="font-weight-bold text-white"
            >
              {{ index + 1 }}
            </v-avatar>

            <!-- Product Info -->
            <div class="flex-grow-1">
              <p class="text-body-1 font-weight-medium mb-1">
                {{ product.productName }}
              </p>
              <div class="d-flex align-center gap-4">
                <div class="d-flex align-center gap-1">
                  <v-icon size="16" color="primary">mdi-cube-outline</v-icon>
                  <span class="text-caption text-medium-emphasis">
                    {{ formatNumber(product.totalQuantity) }} قطعة
                  </span>
                </div>
                 <div class="d-flex align-center gap-1">
                   <v-icon size="16" color="success">mdi-currency-usd</v-icon>
                   <span class="text-caption text-medium-emphasis">
                     {{ formatCurrency(convertRevenue(product.totalRevenue)) }}
                   </span>
                 </div>
              </div>
            </div>
          </div>

          <!-- Progress Indicator -->
          <div class="ml-4">
            <v-progress-circular
              :model-value="getProgressPercentage(product.totalQuantity)"
              :color="getRankColor(index + 1)"
              size="40"
              width="4"
            >
              <span class="text-caption font-weight-bold">
                {{ getProgressPercentage(product.totalQuantity) }}%
              </span>
            </v-progress-circular>
          </div>
        </div>
      </div>
    </div>
  </v-card>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import api from '@/plugins/axios';
import { useTheme } from 'vuetify';
import { useCurrency } from '@/composables/useCurrency';

const theme = useTheme();

const {
  initialize: initCurrency,
  convertAmountSync,
  formatCurrency: formatCurrencyAmount,
} = useCurrency();

defineProps({
  loading: {
    type: Boolean,
    default: false,
  },
});

const topProducts = ref([]);
const loadingProducts = ref(false);

const hasData = computed(() => topProducts.value && topProducts.value.length > 0);

const maxQuantity = computed(() => {
  if (!hasData.value) return 1;
  return Math.max(...topProducts.value.map((p) => p.totalQuantity));
});

const processData = computed(() => {
  if (!hasData.value) return { categories: [], data: [] };

  return {
    categories: topProducts.value.map((p) =>
      p.productName.length > 20 ? p.productName.substring(0, 20) + '...' : p.productName
    ),
    data: topProducts.value.map((p) => p.totalQuantity),
  };
});

const chartSeries = computed(() => [
  {
    name: 'الكمية المباعة',
    data: processData.value.data,
  },
]);

const chartOptions = computed(() => ({
  chart: {
    type: 'bar',
    fontFamily: 'inherit',
    toolbar: { show: false },
    animations: {
      enabled: true,
      easing: 'easeinout',
      speed: 800,
    },
  },
  colors: ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981'],
  plotOptions: {
    bar: {
      borderRadius: 8,
      horizontal: false,
      distributed: true,
      barHeight: '75%',
      dataLabels: {
        position: 'top center',
        style: {
          colors: [theme.global.current.value.colors['on-background']],
          fontSize: '12px',
          fontWeight: 600,
          fontFamily: 'inherit',
          textAlign: 'center',
          textBaseline: 'middle',
          textAnchor: 'middle',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
    },
  },
  dataLabels: {
    enabled: true,
    formatter: (val) => `${formatNumber(val)} قطعة`,
    style: {
      fontSize: '12px',
      fontWeight: 600,
      colors: [theme.global.current.value.colors['on-background']],
    },
    offsetX: 0,
    offsetY: 20,
  },
  xaxis: {
    categories: processData.value.categories,
    labels: {
      style: {
        fontFamily: 'inherit',
        fontSize: '12px',
        colors: theme.global.current.value.colors['on-background'],
      },
    },
    axisBorder: {
      show: false,
    },
    axisTicks: {
      show: false,
    },
  },
  yaxis: {
    labels: {
      style: {
        fontFamily: 'inherit',
        fontSize: '12px',
        colors: theme.global.current.value.colors['on-background'],
      },
      padding: 10,
    },
  },
  legend: { show: false },
  grid: {
    borderColor: theme.global.current.value.colors['surface-variant'],
    xaxis: { lines: { show: false } },
    yaxis: { lines: { show: false } },
    padding: {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
  },
  tooltip: {
    theme: theme.name.value,
    y: {
      formatter: (val, { dataPointIndex }) => {
        const product = topProducts.value[dataPointIndex];
        return `
          <div style="padding: 8px;">
            <div style="font-weight: 600; margin-bottom: 4px;">${product.productName}</div>
            <div>الكمية: <strong>${formatNumber(val)} قطعة</strong></div>
            <div>الإيرادات: <strong>${formatCurrency(convertRevenue(product.totalRevenue))}</strong></div>
          </div>
        `;
      },
    },
  },
}));

const getRankColor = (rank) => {
  const colors = {
    1: 'primary',
    2: 'purple',
    3: 'pink',
    4: 'orange',
    5: 'success',
  };
  return colors[rank] || 'grey';
};

const getProgressPercentage = (quantity) => {
  if (maxQuantity.value === 0) return 0;
  return Math.round((quantity / maxQuantity.value) * 100);
};

const formatNumber = (num) => {
  return new Intl.NumberFormat('ar-EG', {
    numberingSystem: 'latn',
  }).format(num);
};

// Convert revenue to default currency (backend returns in IQD, but we convert to default)
const convertRevenue = (amount) => {
  // Backend returns revenue in IQD, convert to default currency
  return convertAmountSync(amount, 'IQD');
};

const formatCurrency = (amount) => {
  return formatCurrencyAmount(amount);
};

const fetchTopProducts = async () => {
  loadingProducts.value = true;
  try {
    const response = await api.get('/sales/top-products', {
      params: { limit: 5 },
    });
    topProducts.value = response?.data || [];
  } catch (error) {
    console.error('Error fetching top products:', error);
    topProducts.value = [];
  } finally {
    loadingProducts.value = false;
  }
};

onMounted(async () => {
  await initCurrency();
  fetchTopProducts();
});
</script>

<style scoped>
.top-products-card {
  transition: all 0.3s ease;
}



.product-item {
  transition: all 0.2s ease;
  border: 1px solid rgba(0, 0, 0, 0.05);
  background: rgba(0, 0, 0, 0.01);
}

.product-item:hover {
  background: rgba(0, 0, 0, 0.03);
  transform: translateX(-4px);
  border-color: rgba(0, 0, 0, 0.1);
}

.product-item.rank-1 {
  border-left: 4px solid rgb(99, 102, 241);
}

.product-item.rank-2 {
  border-left: 4px solid rgb(139, 92, 246);
}

.product-item.rank-3 {
  border-left: 4px solid rgb(236, 72, 153);
}

.product-item.rank-4 {
  border-left: 4px solid rgb(245, 158, 11);
}

.product-item.rank-5 {
  border-left: 4px solid rgb(16, 185, 129);
}
</style>
