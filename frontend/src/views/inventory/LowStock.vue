<template>
  <div>
    <v-card class="mb-4">
      <div class="flex items-center justify-space-between pa-3">
        <div>
          <div class="font-semibold text-h6 text-primary">المخزون المنخفض</div>
          <div class="text-caption text-medium-emphasis">
            {{ inventoryStore.selectedWarehouse?.name || 'لم يتم اختيار مخزن' }}
          </div>
        </div>
        <v-chip color="error" size="large">{{ inventoryStore.lowStock.length }} منتج</v-chip>
      </div>
    </v-card>

    <v-card>
      <v-data-table
        :headers="headers"
        :items="inventoryStore.lowStock"
        :loading="loading"
        density="comfortable"
      >
        <template #[`item.quantity`]="{ item }">
          <v-chip color="error" size="small">{{ item.quantity }}</v-chip>
        </template>
        <template #no-data>
          <div class="pa-8 text-center text-medium-emphasis">
            لا توجد منتجات منخفضة المخزون 🎉
          </div>
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { useInventoryStore } from '@/stores/inventory';

const inventoryStore = useInventoryStore();
const loading = ref(false);

const headers = [
  { title: 'المنتج', key: 'name' },
  { title: 'الرمز', key: 'sku' },
  { title: 'الباركود', key: 'barcode' },
  { title: 'الكمية', key: 'quantity' },
  { title: 'الحد الأدنى', key: 'lowStockThreshold' },
];

const reload = async () => {
  if (!inventoryStore.selectedWarehouseId) return;
  loading.value = true;
  try {
    await inventoryStore.fetchLowStock();
  } finally {
    loading.value = false;
  }
};

watch(() => inventoryStore.selectedWarehouseId, reload);

onMounted(async () => {
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();
  reload();
});
</script>
