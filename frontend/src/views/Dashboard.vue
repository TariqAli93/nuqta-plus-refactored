<template>
  <div class="page-shell">
    <PageHeader
      title="لوحة التحكم"
      subtitle="ملخص العمليات اليومية والأداء"
      icon="mdi-view-dashboard"
    />

    <RoleHero class="mb-4" />

    <v-row>
      <!-- Side column: quick actions, today summary, alerts -->
      <v-col cols="12" md="3" :class="$vuetify.display.mdAndUp ? 'sticky-sidebar' : ''">
        <PageSection
          v-if="filteredQuickActions.length > 0"
          icon="mdi-flash"
          title="إجراءات سريعة"
          no-padding
        >
          <div class="quick-actions">
            <v-card
              v-for="action in filteredQuickActions"
              :key="action.title"
              :to="action.to"
              class="quick-actions__item"
              variant="flat"
              link
            >
              <v-icon size="28" color="primary" class="mb-2">{{ action.icon }}</v-icon>
              <span class="text-body-2 font-weight-bold">{{ action.title }}</span>
            </v-card>
          </div>
        </PageSection>

        <PageSection
          icon="mdi-chart-box"
          title="ملخص اليوم"
          no-padding
        >
          <template #actions>
            <v-chip size="small" color="primary" variant="tonal">
              {{ todayLabel }}
            </v-chip>
          </template>
          <div class="pa-4">
            <div class="summary-grid">
              <div class="today-stat">
                <v-icon color="success" size="24">mdi-cash-plus</v-icon>
                <div>
                  <div class="text-subtitle-1 font-weight-bold">{{ formatTodayRevenue() }}</div>
                  <div class="text-caption text-medium-emphasis">
                    مبيعات اليوم ({{ defaultCurrency === 'IQD' ? 'د.ع' : defaultCurrency }})
                  </div>
                </div>
              </div>
              <div class="today-stat">
                <v-icon color="warning" size="24">mdi-account-check-outline</v-icon>
                <div>
                  <div class="text-subtitle-1 font-weight-bold">{{ todayCompletedCount }}</div>
                  <div class="text-caption text-medium-emphasis">العمليات الناجحة</div>
                </div>
              </div>
            </div>
            <v-divider class="my-3" />
            <div class="text-body-2 text-info">{{ dynamicHint }}</div>
          </div>
        </PageSection>

        <div class="page-section">
          <AlertsPanel />
        </div>
      </v-col>

      <!-- Main column: stats, charts, recent sales -->
      <v-col cols="12" md="9">
        <div class="summary-grid mb-4">
          <StatCard
            label="إجمالي المبيعات"
            :value="countSales"
            icon="mdi-cash-multiple"
            icon-color="primary"
          />
          <StatCard
            label="العملاء"
            :value="stats.totalCustomers"
            icon="mdi-account-group"
            icon-color="success"
          />
          <StatCard
            label="المنتجات"
            :value="stats.totalProducts"
            icon="mdi-package-variant"
            icon-color="info"
          />
          <StatCard
            label="منتجات قليلة المخزون"
            :value="stats.lowStock"
            icon="mdi-alert-circle"
            icon-color="warning"
          />
        </div>

        <v-row dense>
          <v-col cols="12">
            <RevenueChart :sales="recentSales" :loading="loading" />
          </v-col>
          <v-col cols="12" md="8">
            <TopProductsChart :loading="loading" />
          </v-col>
          <v-col cols="12" md="4">
            <SalesStatusChart :sales="recentSales" :loading="loading" />
          </v-col>
        </v-row>

        <PageSection
          class="mt-4"
          icon="mdi-history"
          title="أحدث المبيعات"
          no-padding
        >
          <v-data-table
            :headers="recentSalesHeaders"
            :items="recentSales.slice(0, 10)"
            :loading="loading"
            density="comfortable"
            hide-default-footer
            items-per-page="10"
          >
            <template #loading>
              <TableSkeleton :rows="5" :columns="recentSalesHeaders.length" />
            </template>
            <template #no-data>
              <EmptyState
                title="لا توجد مبيعات حديثة"
                description="ستظهر هنا أحدث الفواتير عند بدء العمل"
                icon="mdi-receipt-text-outline"
                compact
              />
            </template>
            <template #[`item.customer`]="{ item }">
              {{ item.customer || 'زبون نقدي' }}
            </template>
            <template #[`item.total`]="{ item }">
              {{ formatCurrency(item.total, item.currency) }}
            </template>
            <template #[`item.status`]="{ item }">
              <v-chip :color="getStatusColor(item.status)" size="small">
                {{ getStatusText(item.status) }}
              </v-chip>
            </template>
            <template #[`item.createdAt`]="{ item }">
              {{ formatDate(item.createdAt) }}
            </template>
          </v-data-table>
        </PageSection>
      </v-col>
    </v-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watchEffect } from 'vue';
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
import RoleHero from '@/components/dashboard/RoleHero.vue';
import PageHeader from '@/components/PageHeader.vue';
import PageSection from '@/components/PageSection.vue';
import StatCard from '@/components/StatCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';

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

const todayLabel = computed(() =>
  new Date().toLocaleDateString('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
);

const todayCompletedCount = computed(() => {
  const today = new Date().toISOString().split('T')[0];
  return recentSales.value.filter(
    (s) => s.createdAt && s.createdAt.startsWith(today) && s.status === 'completed'
  ).length;
});

const recentSalesHeaders = [
  { title: 'رقم الفاتورة', key: 'invoiceNumber' },
  { title: 'العميل', key: 'customer' },
  { title: 'المبلغ', key: 'total' },
  { title: 'الحالة', key: 'status' },
  { title: 'التاريخ', key: 'createdAt' },
];

const quickActions = [
  {
    title: 'بطاقة الاقساط',
    icon: 'mdi-plus-circle',
    to: '/sales/new',
    permission: 'create:sales',
    feature: 'installments',
    capability: 'canUseInstallments',
  },
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
  if (action.feature && !authStore.hasFeature(action.feature)) return false;
  if (action.capability && !authStore.can(action.capability)) return false;
  const perm = action.permission;
  if (!perm) return true;
  if (perm === 'create:sales') return uiAccess.canCreateSales(userRole.value);
  if (perm === 'create:customers') return uiAccess.canManageCustomers(userRole.value);
  if (perm === 'create:products') return uiAccess.canManageProducts(userRole.value);
  if (perm === 'read:reports') return uiAccess.canViewReports(userRole.value);
  return true;
};

const filteredQuickActions = computed(() =>
  quickActions.filter((action) => isActionAllowed(action))
);

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

  if (stats.value.lowStock > 0) {
    return `لديك ${stats.value.lowStock} منتج بقليل المخزون. راجع المخزون وأضف الكميات المطلوبة.`;
  }
  if (todaySalesCount === 0 && stats.value.totalSales > 0) {
    return `لم تسجل أي مبيعات اليوم. راجع منتجاتك وعروضك لجذب العملاء.`;
  }
  if (todaySalesCount > 0 && todaySalesCount <= 2 && stats.value.totalSales > 10) {
    return `لديك ${todaySalesCount} عملية بيع اليوم. يمكنك تحسين الأداء بإضافة عروض خاصة.`;
  }
  if (todaySalesCount >= 5) {
    return `أداء ممتاز: ${todaySalesCount} عملية بيع اليوم. استمر في العمل الجيد.`;
  }
  if (stats.value.totalProducts < 10) {
    return `لديك ${stats.value.totalProducts} منتج فقط. أضف المزيد لزيادة المبيعات.`;
  }
  if (stats.value.totalCustomers < 5) {
    return `لديك ${stats.value.totalCustomers} عميل. أضف المزيد لبناء قاعدة عملاء قوية.`;
  }
  if (stats.value.totalSales === 0) {
    return `ابدأ رحلتك: أضف منتجاتك الأولى وأنشئ عملية بيع جديدة.`;
  }
  if (todayRevenue > 0 && todaySalesCount >= 3) {
    return `إيرادات اليوم: ${formatCurrencyAmount(todayRevenue)}. راقب منتجاتك الأكثر مبيعاً.`;
  }
  return `راقب منتجاتك الأكثر مبيعاً هذا الأسبوع وحدّث مخزونك مبكراً.`;
});

const formatCurrency = (amount, curr) => {
  if (!amount && amount !== 0) return '0';
  if (curr === defaultCurrency.value) return formatCurrencyAmount(amount, curr);
  const converted = convertAmountSync(amount, curr);
  return formatCurrencyAmount(converted);
};

const formatDate = (date) =>
  new Date(date).toLocaleDateString('ar', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    numberingSystem: 'latn',
  });

const getStatusColor = (status) =>
  ({ completed: 'success', pending: 'warning', cancelled: 'error' }[status] || 'grey');

const getStatusText = (status) =>
  ({ completed: 'مكتمل', pending: 'قيد الانتظار', cancelled: 'ملغي' }[status] || status);

const dashboardData = useAsyncData(async () => {
  const salesResponse = await saleStore.fetch({ limit: 100 });
  const filteredSales =
    (salesResponse?.data && Array.isArray(salesResponse.data) ? salesResponse.data : []) || [];
  const lowStockProducts = await productStore.fetchLowStock({ lowStock: true });
  const products = await productStore.fetch();
  const customers = await customerStore.fetch();
  return {
    recentSales: filteredSales,
    stats: {
      totalSales: salesResponse?.data?.length || 0,
      totalCustomers: customers?.meta?.total || customers?.data?.length || 0,
      totalProducts: products?.meta?.total || products?.data?.length || 0,
      lowStock: lowStockProducts?.length || 0,
    },
  };
});

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

onMounted(async () => {
  await initCurrency();
  watchEffect(() => {
    if (dashboardData.data.value) {
      recentSales.value = dashboardData.data.value.recentSales;
      stats.value = dashboardData.data.value.stats;
      countSales.value = dashboardData.data.value.recentSales.length;
    }
    loading.value = dashboardData.isLoading.value;
  });
});
</script>

<style scoped lang="scss">
.sticky-sidebar {
  position: sticky;
  top: 1rem;
  align-self: start;
  z-index: 2;
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  padding: 0.75rem;

  &__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1rem 0.75rem;
    min-height: 96px;
    border-radius: 12px;
    background-color: rgba(var(--v-theme-primary), 0.04);
    transition: background-color 0.18s ease, transform 0.18s ease;

    &:hover {
      background-color: rgba(var(--v-theme-primary), 0.08);
      transform: translateY(-1px);
    }
  }
}

.today-stat {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 0;
}
</style>
