<template>
  <div class="flex items-center gap-2">
    <v-select
      :model-value="inventoryStore.selectedBranchId"
      :items="inventoryStore.branches"
      item-title="name"
      item-value="id"
      label="الفرع"
      density="compact"
      hide-details
      variant="outlined"
      class="branch-select"
      style="min-width: 140px"
      :disabled="inventoryStore.branches.length === 0"
      @update:model-value="onBranchChange"
    />
    <v-select
      :model-value="inventoryStore.selectedWarehouseId"
      :items="inventoryStore.warehousesForBranch"
      item-title="name"
      item-value="id"
      label="المخزن"
      density="compact"
      hide-details
      variant="outlined"
      class="warehouse-select"
      style="min-width: 160px"
      :disabled="inventoryStore.warehousesForBranch.length === 0"
      @update:model-value="onWarehouseChange"
    />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useInventoryStore } from '@/stores/inventory';

const inventoryStore = useInventoryStore();

const onBranchChange = (id) => {
  inventoryStore.setBranch(id);
};

const onWarehouseChange = (id) => {
  inventoryStore.setWarehouse(id);
};

onMounted(async () => {
  if (inventoryStore.branches.length === 0) {
    await inventoryStore.fetchBranches();
  }
  if (inventoryStore.warehouses.length === 0) {
    await inventoryStore.fetchWarehouses();
  }
});
</script>

<style scoped>
.branch-select :deep(.v-field),
.warehouse-select :deep(.v-field) {
  --v-field-padding-top: 2px;
}
</style>
