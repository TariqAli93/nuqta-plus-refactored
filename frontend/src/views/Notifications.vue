<template>
  <div class="page-shell">
    <PageHeader
      title="التنبيهات"
      subtitle="أقساط متأخرة، منتجات قليلة المخزون، تنبيهات النظام"
      icon="mdi-bell"
    >
      <v-btn
        v-if="hasUnreadAlerts"
        color="primary"
        variant="tonal"
        prepend-icon="mdi-check-all"
        @click="markAllAsRead"
      >
        تحديد الكل كمقروء
      </v-btn>
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-refresh"
        :loading="alertStore.loading"
        @click="refreshAlerts"
      >
        تحديث
      </v-btn>
    </PageHeader>

    <!-- Loading State -->
    <div v-if="alertStore.loading && !alertStore.lastUpdated" class="loading-state">
      <v-progress-circular indeterminate color="primary" size="48" />
      <div class="text-body-2 text-medium-emphasis">جاري تحميل التنبيهات…</div>
    </div>

    <!-- No Alerts -->
    <v-card v-else-if="!alertStore.hasAlerts" class="page-section">
      <EmptyState
        title="لا توجد تنبيهات"
        description="كل شيء على ما يرام"
        icon="mdi-check-circle"
        icon-color="success"
        compact
      />
    </v-card>

    <!-- Alerts Content -->
    <div v-else>
      <!-- Overdue Installments -->
      <v-card v-if="alertStore.overdueCount > 0" class="page-section">
        <div class="section-title">
          <span class="section-title__label">
            <v-icon size="20" color="error">mdi-calendar-alert</v-icon>
            <span>أقساط متأخرة ({{ alertStore.overdueCount }})</span>
          </span>
        </div>
        <v-card-text class="pa-0">
          <v-list>
            <v-list-item
              v-for="installment in alertStore.overdueInstallments"
              :key="`installment-${installment.id}`"
              :class="{ 'bg-grey-lighten-4': isRead(`installment-${installment.id}`) }"
              :to="{ name: 'SaleDetails', params: { id: installment.saleId } }"
            >
              <template #prepend>
                <v-checkbox
                  :model-value="isRead(`installment-${installment.id}`)"
                  color="error"
                  hide-details
                  class="mr-2"
                  @click.stop="toggleRead(`installment-${installment.id}`)"
                ></v-checkbox>
                <v-icon :color="isRead(`installment-${installment.id}`) ? 'grey' : 'error'">
                  mdi-calendar-alert
                </v-icon>
              </template>
              <v-list-item-title>
                <span
                  :class="{
                    'text-decoration-line-through': isRead(`installment-${installment.id}`),
                  }"
                >
                  {{ installment.customerName || 'عميل غير محدد' }}
                </span>
              </v-list-item-title>
              <v-list-item-subtitle>
                فاتورة: {{ installment.invoiceNumber }} | القسط #{{ installment.installmentNumber }}
                <br />
                المبلغ: {{ formatCurrency(installment.remainingAmount, installment.currency) }} |
                الاستحقاق: {{ formatDate(installment.dueDate) }}
              </v-list-item-subtitle>
              <template #append>
                <v-chip
                  :color="isRead(`installment-${installment.id}`) ? 'grey' : 'error'"
                  size="small"
                  variant="flat"
                >
                  {{ isRead(`installment-${installment.id}`) ? 'مقروء' : 'غير مقروء' }}
                </v-chip>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>

      <!-- Out of Stock Products -->
      <v-card v-if="alertStore.outOfStockCount > 0" class="page-section">
        <div class="section-title">
          <span class="section-title__label">
            <v-icon size="20" color="error">mdi-package-variant-remove</v-icon>
            <span>منتجات منعدمة المخزون ({{ alertStore.outOfStockCount }})</span>
          </span>
        </div>
        <v-card-text class="pa-0">
          <v-list>
            <v-list-item
              v-for="product in alertStore.outOfStockProducts"
              :key="`outofstock-${product.id}`"
              :class="{ 'bg-grey-lighten-4': isRead(`outofstock-${product.id}`) }"
              :to="{ name: 'EditProduct', params: { id: product.id } }"
            >
              <template #prepend>
                <v-checkbox
                  :model-value="isRead(`outofstock-${product.id}`)"
                  color="red"
                  hide-details
                  class="mr-2"
                  @click.stop="toggleRead(`outofstock-${product.id}`)"
                ></v-checkbox>
                <v-icon :color="isRead(`outofstock-${product.id}`) ? 'grey' : 'red'">
                  mdi-package-variant-remove
                </v-icon>
              </template>
              <v-list-item-title>
                <span
                  :class="{ 'text-decoration-line-through': isRead(`outofstock-${product.id}`) }"
                >
                  {{ product.name }}
                </span>
              </v-list-item-title>
              <v-list-item-subtitle>
                SKU: {{ product.sku || 'غير محدد' }} | المخزون: 0
              </v-list-item-subtitle>
              <template #append>
                <v-chip
                  :color="isRead(`outofstock-${product.id}`) ? 'grey' : 'red'"
                  size="small"
                  variant="flat"
                >
                  {{ isRead(`outofstock-${product.id}`) ? 'مقروء' : 'غير مقروء' }}
                </v-chip>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>

      <!-- Low Stock Products -->
      <v-card v-if="alertStore.lowStockCount > 0" class="page-section">
        <div class="section-title">
          <span class="section-title__label">
            <v-icon size="20" color="warning">mdi-alert</v-icon>
            <span>منتجات قليلة المخزون ({{ alertStore.lowStockCount }})</span>
          </span>
        </div>
        <v-card-text class="pa-0">
          <v-list>
            <v-list-item
              v-for="product in alertStore.lowStockProducts"
              :key="`lowstock-${product.id}`"
              :class="{ 'bg-grey-lighten-4': isRead(`lowstock-${product.id}`) }"
              :to="{ name: 'EditProduct', params: { id: product.id } }"
            >
              <template #prepend>
                <v-checkbox
                  :model-value="isRead(`lowstock-${product.id}`)"
                  color="orange"
                  hide-details
                  class="mr-2"
                  @click.stop="toggleRead(`lowstock-${product.id}`)"
                ></v-checkbox>
                <v-icon :color="isRead(`lowstock-${product.id}`) ? 'grey' : 'orange'">
                  mdi-alert
                </v-icon>
              </template>
              <v-list-item-title>
                <span :class="{ 'text-decoration-line-through': isRead(`lowstock-${product.id}`) }">
                  {{ product.name }}
                </span>
              </v-list-item-title>
              <v-list-item-subtitle>
                SKU: {{ product.sku || 'غير محدد' }} | المخزون: {{ product.stock }} | الحد الأدنى:
                {{ product.minStock }}
              </v-list-item-subtitle>
              <template #append>
                <v-chip
                  :color="isRead(`lowstock-${product.id}`) ? 'grey' : 'orange'"
                  size="small"
                  variant="flat"
                >
                  {{ isRead(`lowstock-${product.id}`) ? 'مقروء' : 'غير مقروء' }}
                </v-chip>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </div>

    <!-- Outbound notification failures (admin only) -->
    <NotificationFailures v-if="authStore.isGlobalAdmin" class="mt-4" />
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useAlertStore } from '@/stores/alert';
import { useNotificationStore } from '@/stores/notification';
import { useAuthStore } from '@/stores/auth';
import NotificationFailures from '@/components/notifications/NotificationFailures.vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';

const alertStore = useAlertStore();
const notificationStore = useNotificationStore();
const authStore = useAuthStore();

const hasUnreadAlerts = computed(() => {
  let hasUnread = false;

  // Check overdue installments
  alertStore.overdueInstallments.forEach((inst) => {
    if (!alertStore.isRead(`installment-${inst.id}`)) {
      hasUnread = true;
    }
  });

  // Check out of stock
  alertStore.outOfStockProducts.forEach((prod) => {
    if (!alertStore.isRead(`outofstock-${prod.id}`)) {
      hasUnread = true;
    }
  });

  // Check low stock
  alertStore.lowStockProducts.forEach((prod) => {
    if (!alertStore.isRead(`lowstock-${prod.id}`)) {
      hasUnread = true;
    }
  });

  return hasUnread;
});

const isRead = (alertId) => {
  return alertStore.isRead(alertId);
};

const toggleRead = (alertId) => {
  alertStore.toggleRead(alertId);
};

const markAllAsRead = () => {
  const allIds = [];

  alertStore.overdueInstallments.forEach((inst) => {
    allIds.push(`installment-${inst.id}`);
  });

  alertStore.outOfStockProducts.forEach((prod) => {
    allIds.push(`outofstock-${prod.id}`);
  });

  alertStore.lowStockProducts.forEach((prod) => {
    allIds.push(`lowstock-${prod.id}`);
  });

  alertStore.markAsRead(allIds);
  notificationStore.success('تم تحديد جميع التنبيهات كمقروءة');
};

const refreshAlerts = async () => {
  await alertStore.fetchAlerts();
  notificationStore.success('تم تحديث التنبيهات');
};

const formatCurrency = (amount, currency = 'IQD') => {
  const symbol = currency === 'USD' ? '$' : 'د.ع';
  return `${symbol} ${parseFloat(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (dateString) => {
  if (!dateString) return 'غير محدد';
  const date = new Date(dateString);
  return date.toLocaleDateString('ar', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

onMounted(() => {
  // Fetch alerts if not already loaded
  if (!alertStore.lastUpdated) {
    alertStore.fetchAlerts();
  }
});
</script>

<style scoped>
.text-decoration-line-through {
  text-decoration: line-through;
}
</style>
