<template>
  <div v-if="showSwitcher" class="flex items-center gap-2">
    <v-select
      v-if="authStore.canSwitchBranch"
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
      v-if="authStore.canSwitchWarehouse || authStore.canSwitchBranch"
      :model-value="inventoryStore.selectedWarehouseId"
      :items="visibleWarehouses"
      item-title="name"
      item-value="id"
      label="المخزن"
      density="compact"
      hide-details
      variant="outlined"
      class="warehouse-select"
      style="min-width: 160px"
      :disabled="visibleWarehouses.length === 0"
      @update:model-value="onWarehouseChange"
    />
  </div>
  <!-- Branch-bound users: show a read-only label instead -->
  <div
    v-else-if="inventoryStore.selectedWarehouse || inventoryStore.selectedBranch"
    class="flex items-center gap-1 text-body-2 text-medium-emphasis"
  >
    <v-icon size="18">mdi-store</v-icon>
    <span>{{ inventoryStore.selectedBranch?.name }}</span>
    <span v-if="inventoryStore.selectedWarehouse">
      · {{ inventoryStore.selectedWarehouse.name }}
    </span>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { useAuthStore } from '@/stores/auth';

const inventoryStore = useInventoryStore();
const authStore = useAuthStore();

// The switcher (dropdowns) is only shown to global admins. Branch-bound users
// see a read-only context label instead.
const showSwitcher = computed(
  () => authStore.canSwitchBranch || authStore.canSwitchWarehouse
);

const visibleWarehouses = computed(() => {
  const allowed = authStore.allowedWarehouseIds;
  if (!allowed.length) return inventoryStore.warehousesForBranch;
  return inventoryStore.warehousesForBranch.filter((w) => allowed.includes(w.id));
});

const onBranchChange = (id) => {
  inventoryStore.setBranch(id);
};

const onWarehouseChange = (id) => {
  inventoryStore.setWarehouse(id);
};

onMounted(async () => {
  // Hydrate branch/warehouse lists for whichever user is logged in.
  if (inventoryStore.branches.length === 0) {
    await inventoryStore.fetchBranches();
  }
  if (inventoryStore.warehouses.length === 0) {
    await inventoryStore.fetchWarehouses();
  }

  // For branch-bound users, force the selection to match their assignment
  // and block any saved local-storage selection from leaking context.
  if (!authStore.canSwitchBranch && authStore.assignedBranchId) {
    inventoryStore.setBranch(authStore.assignedBranchId);
  }
  if (!authStore.canSwitchWarehouse) {
    const allowed = authStore.allowedWarehouseIds;
    if (allowed.length === 1) {
      inventoryStore.setWarehouse(allowed[0]);
    } else if (
      inventoryStore.selectedWarehouseId &&
      allowed.length > 0 &&
      !allowed.includes(inventoryStore.selectedWarehouseId)
    ) {
      inventoryStore.setWarehouse(allowed[0]);
    }
  }
});
</script>

<style scoped>
.branch-select :deep(.v-field),
.warehouse-select :deep(.v-field) {
  --v-field-padding-top: 2px;
}
</style>
