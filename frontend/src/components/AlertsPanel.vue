<template>
  <div class="alerts-panel">
    <h2 class="mb-4 text-xl font-bold">التنبيهات</h2>

    <!-- Overdue Installments -->
    <v-card v-if="alertStore.overdueCount > 0" class="mb-4" color="error" variant="tonal">
      <v-card-title class="d-flex align-center">
        <v-icon class="ml-2" color="error">mdi-alert-circle</v-icon>
        <span>أقساط متأخرة ({{ alertStore.overdueCount }})</span>
      </v-card-title>
      <v-card-text>
        <v-list density="compact">
          <v-list-item
            v-for="installment in alertStore.overdueInstallments.slice(0, 5)"
            :key="installment.id"
            :to="{ name: 'SaleDetails', params: { id: installment.saleId } }"
          >
            <template #prepend>
              <v-icon color="error">mdi-calendar-alert</v-icon>
            </template>
            <v-list-item-title>
              {{ installment.customerName || 'عميل غير محدد' }}
            </v-list-item-title>
            <v-list-item-subtitle>
              فاتورة: {{ installment.invoiceNumber }} | القسط #{{ installment.installmentNumber }}
              <br />
              المبلغ: {{ formatCurrency(installment.remainingAmount, installment.currency) }} |
              الاستحقاق: {{ formatDate(installment.dueDate) }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
        <v-btn
          v-if="alertStore.overdueCount > 5"
          variant="text"
          color="error"
          size="small"
          class="mt-2"
          to="/sales"
        >
          عرض الكل ({{ alertStore.overdueCount }})
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Out of Stock Products -->
    <v-card
      v-if="alertStore.outOfStockCount > 0"
      class="mb-4"
      color="red-lighten-1"
      variant="tonal"
    >
      <v-card-title class="d-flex align-center">
        <v-icon class="ml-2" color="red">mdi-package-variant-remove</v-icon>
        <span>منتجات منعدمة المخزون ({{ alertStore.outOfStockCount }})</span>
      </v-card-title>
      <v-card-text>
        <v-list density="compact">
          <v-list-item
            v-for="product in alertStore.outOfStockProducts.slice(0, 5)"
            :key="product.id"
            :to="`/products/${product.id}/edit`"
          >
            <template #prepend>
              <v-icon color="red">mdi-alert</v-icon>
            </template>
            <v-list-item-title>{{ product.name }}</v-list-item-title>
            <v-list-item-subtitle>
              SKU: {{ product.sku || 'غير محدد' }} | المخزون: 0
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
        <v-btn
          v-if="alertStore.outOfStockCount > 5"
          variant="text"
          color="red"
          size="small"
          class="mt-2"
          to="/products"
        >
          عرض الكل ({{ alertStore.outOfStockCount }})
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Low Stock Products -->
    <v-card v-if="alertStore.lowStockCount > 0" class="mb-4" color="orange" variant="tonal">
      <v-card-title class="d-flex align-center">
        <v-icon class="ml-2" color="orange">mdi-alert</v-icon>
        <span>منتجات قليلة المخزون ({{ alertStore.lowStockCount }})</span>
      </v-card-title>
      <v-card-text>
        <v-list density="compact">
          <v-list-item
            v-for="product in alertStore.lowStockProducts.slice(0, 5)"
            :key="product.id"
            :to="`/products/${product.id}/edit`"
          >
            <template #prepend>
              <v-icon color="orange">mdi-package-variant</v-icon>
            </template>
            <v-list-item-title>{{ product.name }}</v-list-item-title>
            <v-list-item-subtitle>
              SKU: {{ product.sku || 'غير محدد' }} | المخزون: {{ product.stock }} | الحد الأدنى:
              {{ product.minStock }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
        <v-btn
          v-if="alertStore.lowStockCount > 5"
          variant="text"
          color="orange"
          size="small"
          class="mt-2"
          to="/products"
        >
          عرض الكل ({{ alertStore.lowStockCount }})
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- No Alerts -->
    <v-card v-if="!alertStore.hasAlerts" class="text-center pa-4" color="success" variant="tonal">
      <v-icon size="48" color="success" class="mb-2">mdi-check-circle</v-icon>
      <div class="text-h6">لا توجد تنبيهات</div>
      <div class="text-body-2 mt-2">كل شيء على ما يرام!</div>
    </v-card>
  </div>
</template>

<script setup>
import { useAlertStore } from '@/stores/alert';

const alertStore = useAlertStore();

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
</script>

<style scoped>
.alerts-panel {
  width: 100%;
}
</style>
