<template>
  <div class="page-shell">
    <PageHeader
      title="المخزون المنخفض"
      :subtitle="inventoryStore.selectedWarehouse?.name || 'لم يتم اختيار مخزن'"
      icon="mdi-alert-circle-outline"
      icon-color="error"
    >
      <v-chip color="error" size="default" prepend-icon="mdi-alert">
        {{ inventoryStore.lowStock.length }} منتج
      </v-chip>
    </PageHeader>

    <v-alert
      v-if="!inventoryStore.selectedWarehouseId && !loading"
      type="info"
      variant="tonal"
      border="start"
      class="mb-4"
    >
      لم يتم إعداد أي مخزن بعد. أنشئ فرعاً ومخزناً من "الفروع والمخازن" ثم عد إلى هذه الصفحة.
    </v-alert>

    <v-card class="page-section">
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
            <template v-if="inventoryStore.selectedWarehouseId">
              لا توجد منتجات منخفضة المخزون 🎉
            </template>
            <template v-else>اختر مخزناً لعرض قائمة المنخفض.</template>
          </div>
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';

const inventoryStore = useInventoryStore();
const authStore = useAuthStore();
const loading = ref(false);

const headers = [
  { title: 'المنتج', key: 'name' },
  { title: 'الرمز', key: 'sku' },
  { title: 'الباركود', key: 'barcode' },
  { title: 'الكمية', key: 'quantity' },
  { title: 'الحد الأدنى', key: 'lowStockThreshold' },
];

/**
 * Pick a warehouse when the global selector hasn't (yet) picked one — e.g.
 * the user is branch-bound and the selector component hasn't mounted, or the
 * localStorage value was cleared. Without this fallback the page silently
 * shows nothing because `selectedWarehouseId` is null.
 */
const ensureWarehouse = () => {
  if (inventoryStore.selectedWarehouseId) return inventoryStore.selectedWarehouseId;

  const allowed = authStore.allowedWarehouseIds || [];
  const assigned = authStore.assignedBranchId;

  let candidate = null;
  if (authStore.user?.assignedWarehouseId) {
    candidate = authStore.user.assignedWarehouseId;
  } else if (allowed.length > 0) {
    candidate = allowed[0];
  } else {
    // Global admin / fresh install: fall back to any active warehouse,
    // preferring one in the currently-selected branch if set.
    const pool = inventoryStore.warehouses.filter((w) => w.isActive);
    const inBranch = assigned
      ? pool.find((w) => w.branchId === assigned)
      : null;
    candidate = inBranch?.id || pool[0]?.id || null;
  }

  if (candidate) inventoryStore.setWarehouse(candidate);
  return candidate;
};

const reload = async () => {
  const warehouseId = ensureWarehouse();
  if (!warehouseId) {
    inventoryStore.lowStock = [];
    return;
  }
  loading.value = true;
  try {
    await inventoryStore.fetchLowStock(warehouseId);
  } finally {
    loading.value = false;
  }
};

watch(() => inventoryStore.selectedWarehouseId, reload);

onMounted(async () => {
  // Hydrate branches/warehouses so ensureWarehouse() has data to choose from.
  if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches();
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();
  reload();
});
</script>
