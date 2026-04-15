<template>
  <v-container>
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h4">لوحة التحكم</h1>
    </div>

    <v-row>
      <v-col cols="12" md="3" :class="$vuetify.display.mdAndUp ? 'sticky-sidebar' : ''">
        <v-row>
          <v-col cols="12">
            <div v-if="filteredQuickActions.length > 0">
              <v-row dense>
                <v-col v-for="action in filteredQuickActions" :key="action.title" cols="6">
                  <v-card
                    :to="action.to"
                    class="d-flex flex-column align-center justify-center pa-4 h-100 text-center"
                    link
                  >
                    <v-icon size="32" class="mb-2" color="primary">{{ action.icon }}</v-icon>
                    <span class="text-subtitle-2 font-weight-bold">{{ action.title }}</span>
                  </v-card>
                </v-col>
              </v-row>
            </div>
          </v-col>
          <v-col cols="12">
            <v-card class="pa-4 mb-4" elevation="2" rounded="xl">
              <div class="d-flex align-center justify-space-between mb-2">
                <div class="d-flex align-center gap-2">
                  <v-icon color="primary" size="24">mdi-chart-box</v-icon>
                  <span class="text-h6 font-weight-bold">ملخص اليوم العملي</span>
                </div>
                <v-chip size="small" color="primary" variant="flat">
                  {{
                    new Date().toLocaleDateString('ar-EG', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })
                  }}
                </v-chip>
              </div>
              <v-divider></v-divider>
              <v-row class="mt-4" dense>
                <v-col cols="6">
                  <v-sheet elevation="0" class="pa-3 d-flex flex-column align-center">
                    <v-icon color="success" size="28">mdi-cash-plus</v-icon>
                    <span class="text-subtitle-1 font-weight-bold mt-1">
                      {{ formatTodayRevenue() }}
                    </span>
                    <span class="text-caption text-medium-emphasis">
                      مبيعات اليوم ({{ defaultCurrency === 'IQD' ? 'د.ع' : defaultCurrency }})
                    </span>
                  </v-sheet>
                </v-col>
                <v-col cols="6">
                  <v-sheet elevation="0" class="pa-3 d-flex flex-column align-center">
                    <v-icon color="warning" size="28">mdi-account-check-outline</v-icon>
                    <span class="text-subtitle-1 font-weight-bold mt-1">
                      {{
                        recentSales.filter(
                          (s) =>
                            s.createdAt &&
                            s.createdAt.startsWith(new Date().toISOString().split('T')[0]) &&
                            s.status === 'completed'
                        ).length
                      }}
                    </span>
                    <span class="text-caption text-medium-emphasis">العمليات الناجحة اليوم</span>
                  </v-sheet>
                </v-col>
                <v-col cols="12" class="mt-3">
                  <v-divider class="my-3"></v-divider>
                  <div class="text-xs text-info py-5">
                    {{ dynamicHint }}
                  </div>
                </v-col>
              </v-row>
            </v-card>
          </v-col>
          <v-col cols="12">
            <AlertsPanel />
          </v-col>
        </v-row>
      </v-col>

      <v-col cols="12" md="9">
        <!-- Statistics Cards -->
        <v-row>
          <!-- Total Sales Card -->
          <v-col cols="12" sm="6" lg="3">
            <v-card class="d-flex align-center justify-space-between pa-4">
              <div>
                <p class="text-caption text-medium-emphasis">إجمالي المبيعات</p>
                <h3 class="text-h5 font-weight-bold">{{ countSales }}</h3>
              </div>
              <v-icon size="40" color="primary">mdi-cash-multiple</v-icon>
            </v-card>
          </v-col>

          <!-- Total Customers Card -->
          <v-col cols="12" sm="6" lg="3">
            <v-card class="d-flex align-center justify-space-between pa-4">
              <div>
                <p class="text-caption text-medium-emphasis">العملاء</p>
                <h3 class="text-h5 font-weight-bold">{{ stats.totalCustomers }}</h3>
              </div>
              <v-icon size="40" color="success">mdi-account-group</v-icon>
            </v-card>
          </v-col>

          <!-- Total Products Card -->
          <v-col cols="12" sm="6" lg="3">
            <v-card class="d-flex align-center justify-space-between pa-4">
              <div>
                <p class="text-caption text-medium-emphasis">المنتجات</p>
                <h3 class="text-h5 font-weight-bold">{{ stats.totalProducts }}</h3>
              </div>
              <v-icon size="40" color="purple">mdi-package-variant</v-icon>
            </v-card>
          </v-col>

          <!-- Low Stock Card -->
          <v-col cols="12" sm="6" lg="3">
            <v-card class="d-flex align-center justify-space-between pa-4">
              <div>
                <p class="text-caption text-medium-emphasis">منتجات قليلة المخزون</p>
                <h3 class="text-h5 font-weight-bold">{{ stats.lowStock }}</h3>
              </div>
              <v-icon size="40" color="warning">mdi-alert-circle</v-icon>
            </v-card>
          </v-col>

          <v-col cols="12" md="12">
            <v-row>
              <v-col cols="12">
                <RevenueChart :sales="recentSales" :loading="loading" />
              </v-col>
              <v-col cols="12" md="8">
                <TopProductsChart :loading="loading" />
              </v-col>
              <v-col cols="12" md="4">
                <SalesStatusChart :sales="recentSales" :loading="loading" />
              </v-col>
              <v-col cols="12">
                <v-card title="أحدث المبيعات">
                  <v-table>
                    <thead>
                      <tr>
                        <th>رقم الفاتورة</th>
                        <th>العميل</th>
                        <th>المبلغ</th>
                        <th>الحالة</th>
                        <th>التاريخ</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="loading">
                        <td colspan="5" class="text-center">
                          <v-progress-circular indeterminate color="primary"></v-progress-circular>
                        </td>
                      </tr>
                      <tr v-else-if="recentSales.length === 0">
                        <td colspan="5" class="text-center">لا توجد مبيعات حديثة</td>
                      </tr>
                      <template v-else>
                        <tr v-for="sale in recentSales.slice(0, 10)" :key="sale.id">
                          <td>{{ sale.invoiceNumber }}</td>
                          <td>{{ sale.customer || 'زبون نقدي' }}</td>
                          <td>{{ formatCurrency(sale.total, sale.currency) }}</td>
                          <td>
                            <v-chip :color="getStatusColor(sale.status)" size="small" label>
                              {{ getStatusText(sale.status) }}
                            </v-chip>
                          </td>
                          <td>{{ formatDate(sale.createdAt) }}</td>
                        </tr>
                      </template>
                    </tbody>
                  </v-table>
                </v-card>
              </v-col>
            </v-row>
          </v-col>
        </v-row>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted, watchEffect, onUnmounted } from 'vue';
import { useSaleStore } from '@/stores/sale';
import { useProductStore } from '@/stores/product';
import { useCustomerStore } from '@/stores/customer';
import { useLoading } from '@/composables/useLoading';
import { useAuthStore } from '@/stores/auth';
import { useCurrency } from '@/composables/useCurrency';
import * as uiAccess from '@/auth/uiAccess.js';
import RevenueChart from '@/components/dashboard/RevenueChart.vue';
import TopProductsChart from '@/components/dashboard/TopProductsChart.vue';
import SalesStatusChart from '@/components/dashboard/SalesStatusChart.vue';
import AlertsPanel from '@/components/AlertsPanel.vue';

const saleStore = useSaleStore();
const productStore = useProductStore();
const customerStore = useCustomerStore();
const authStore = useAuthStore();
const { useAsyncData } = useLoading();
const {
  defaultCurrency,
  initialize: initCurrency,
  convertAmountSync,
  formatCurrency: formatCurrencyAmount,
} = useCurrency();

const userRole = computed(() => authStore.user?.role);

const loading = ref(false);
const stats = ref({
  totalSales: 0,
  totalCustomers: 0,
  totalProducts: 0,
  lowStock: 0,
});
const recentSales = ref([]);

const countSales = ref(0);

const quickActions = [
  { title: 'بيع جديد', icon: 'mdi-plus-circle', to: '/sales/new', permission: 'create:sales' },
  {
    title: 'عميل جديد',
    icon: 'mdi-account-plus',
    to: '/customers/new',
    permission: 'create:customers',
  },
  {
    title: 'منتج جديد',
    icon: 'mdi-package-variant-plus',
    to: '/products/new',
    permission: 'create:products',
  },
  { title: 'التقارير', icon: 'mdi-chart-box', to: '/reports', permission: 'read:reports' },
];

const isActionAllowed = (action) => {
  if (!action || !userRole.value) return false;
  const perm = action.permission;
  if (!perm) return true; // If no permission specified, allow it
  if (perm === 'create:sales') return uiAccess.canCreateSales(userRole.value);
  if (perm === 'create:customers') return uiAccess.canManageCustomers(userRole.value);
  if (perm === 'create:products') return uiAccess.canManageProducts(userRole.value);
  if (perm === 'read:reports') return uiAccess.canViewReports(userRole.value);
  return true;
};

const filteredQuickActions = computed(() => {
  return quickActions.filter((action) => isActionAllowed(action));
});

// Dynamic hint based on statistics
const dynamicHint = computed(() => {
  const today = new Date().toISOString().split('T')[0];
  const todaySalesCount = recentSales.value.filter(
    (s) => s.createdAt && s.createdAt.startsWith(today) && s.status === 'completed'
  ).length;

  const todaySales = recentSales.value.filter(
    (s) => s.createdAt && s.createdAt.startsWith(today) && s.status === 'completed'
  );

  const todayRevenue = todaySales.reduce((sum, s) => {
    const amount = parseFloat(s.total || 0);
    const currency = s.currency || 'IQD';
    const converted = convertAmountSync(amount, currency);
    return sum + converted;
  }, 0);

  // Priority 1: Low stock products
  if (stats.value.lowStock > 0) {
    return `⚠️ لديك ${stats.value.lowStock} منتج بقليل المخزون! راجع المخزون وأضف الكميات المطلوبة.`;
  }

  // Priority 2: No sales today
  if (todaySalesCount === 0 && stats.value.totalSales > 0) {
    return `📊 لم تسجل أي مبيعات اليوم. راجع منتجاتك وعروضك لجذب العملاء!`;
  }

  // Priority 3: Very low sales today (1-2 sales)
  if (todaySalesCount > 0 && todaySalesCount <= 2 && stats.value.totalSales > 10) {
    return `💡 لديك ${todaySalesCount} عملية بيع اليوم. يمكنك تحسين الأداء بإضافة عروض خاصة!`;
  }

  // Priority 4: Good sales today
  if (todaySalesCount >= 5) {
    return `🎉 أداء ممتاز! ${todaySalesCount} عملية بيع اليوم. استمر في العمل الجيد!`;
  }

  // Priority 5: Low product count
  if (stats.value.totalProducts < 10) {
    return `📦 لديك ${stats.value.totalProducts} منتج فقط. أضف المزيد من المنتجات لزيادة المبيعات!`;
  }

  // Priority 6: Low customer count
  if (stats.value.totalCustomers < 5) {
    return `👥 لديك ${stats.value.totalCustomers} عميل. أضف المزيد من العملاء لبناء قاعدة عملاء قوية!`;
  }

  // Priority 7: No sales at all
  if (stats.value.totalSales === 0) {
    return `🚀 ابدأ رحلتك! أضف منتجاتك الأولى وأنشئ عملية بيع جديدة.`;
  }

  // Priority 8: Good revenue today
  if (todayRevenue > 0 && todaySalesCount >= 3) {
    return `💰 إيرادات اليوم: ${formatCurrencyAmount(todayRevenue)}. راقب منتجاتك الأكثر مبيعاً وحدث المخزون!`;
  }

  // Default: General tip
  return `🔍 راقب منتجاتك الأكثر مبيعاً هذا الأسبوع وحدث مخزونك مبكراً!`;
});

// Format currency with dynamic conversion
const formatCurrency = (amount, curr) => {
  if (!amount && amount !== 0) return '0';

  // If currency matches default, format directly
  if (curr === defaultCurrency.value) {
    return formatCurrencyAmount(amount, curr);
  }

  // Convert to default currency and format
  const converted = convertAmountSync(amount, curr);
  return formatCurrencyAmount(converted);
};

const formatDate = (date) => {
  return new Date(date).toLocaleDateString('ar', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    numberingSystem: 'latn',
  });
};

const getStatusColor = (status) => {
  const colors = {
    completed: 'success',
    pending: 'warning',
    cancelled: 'error',
  };
  return colors[status] || 'grey';
};

const getStatusText = (status) => {
  const texts = {
    completed: 'مكتمل',
    pending: 'قيد الانتظار',
    cancelled: 'ملغي',
  };
  return texts[status] || status;
};

// استخدام نظام التحميل المتقدم للبيانات
const dashboardData = useAsyncData(async () => {
  // Fetch sales stats completed || pending
  const salesResponse = await saleStore.fetch({ limit: 100 });

  const filteredSales =
    (salesResponse?.data && Array.isArray(salesResponse.data) ? salesResponse.data : []) || [];

  // Fetch low stock products
  const lowStockProducts = await productStore.fetchLowStock({ lowStock: true });

  const products = await productStore.fetch();

  // Fetch customers
  const customers = await customerStore.fetch();

  return {
    recentSales: filteredSales, // Now passing all sales for charts to process
    stats: {
      totalSales: salesResponse?.data?.length || 0,
      totalCustomers: customers?.meta?.total || customers?.data?.length || 0,
      totalProducts: products?.meta?.total || products?.data?.length || 0,
      lowStock: lowStockProducts?.length || 0,
    },
  };
});

// Calculate today's revenue with currency conversion
const formatTodayRevenue = () => {
  const today = new Date().toISOString().split('T')[0];
  const todaySales = recentSales.value.filter(
    (s) => s.createdAt && s.createdAt.startsWith(today) && s.status === 'completed'
  );

  const total = todaySales.reduce((sum, s) => {
    const amount = parseFloat(s.total || 0);
    const currency = s.currency || 'IQD';
    const converted = convertAmountSync(amount, currency);
    return sum + converted;
  }, 0);

  return formatCurrencyAmount(total);
};

// تحديث البيانات المحلية عند تحميل البيانات
onMounted(async () => {
  // Initialize currency settings
  await initCurrency();

  // مراقبة تغيير البيانات
  const unwatch = watchEffect(() => {
    if (dashboardData.data.value) {
      recentSales.value = dashboardData.data.value.recentSales;
      stats.value = dashboardData.data.value.stats;
      countSales.value = dashboardData.data.value.recentSales.length;
    }
    loading.value = dashboardData.isLoading.value;
  });
});
</script>

<style scoped>
.sticky-sidebar {
  position: sticky;
  top: 1rem;
  align-self: start;
  z-index: 2;
}

.hover-scale {
  transition: transform 0.2s ease-in-out;
}

.hover-scale:hover {
  transform: scale(1.02);
}

.opacity-50 {
  opacity: 0.5;
}

.opacity-90 {
  opacity: 0.9;
}

@media (prefers-color-scheme: light) {
  .light\:text-gray-900 {
    color: #1a202c;
  }
}
</style>
