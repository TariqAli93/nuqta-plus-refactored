<template>
  <!-- Nothing to show when multi-branch/multi-warehouse features are off -->
  <template v-if="shouldRender">
    <!-- Global admin: switchable dropdowns -->
    <div v-if="canSwitch" class="flex items-center gap-2 ml-2">
      <v-select
        v-if="authStore.canSwitchBranch && authStore.featureFlags?.multiBranch !== false"
        :model-value="inventoryStore.selectedBranchId"
        :items="inventoryStore.branches"
        item-title="name"
        item-value="id"
        label="الفرع"
        density="compact"
        hide-details
        variant="outlined"
        style="min-width: 140px"
        :disabled="inventoryStore.branches.length === 0"
        @update:model-value="onBranchChange"
      />
      <v-select
        v-if="
          (authStore.canSwitchWarehouse || authStore.canSwitchBranch) &&
          authStore.featureFlags?.multiWarehouse !== false
        "
        :model-value="inventoryStore.selectedWarehouseId"
        :items="visibleWarehouses"
        item-title="name"
        item-value="id"
        label="المخزن"
        density="compact"
        hide-details
        variant="outlined"
        style="min-width: 160px"
        :disabled="visibleWarehouses.length === 0"
        @update:model-value="onWarehouseChange"
      />
    </div>

    <!-- Everyone else: read-only context label -->
    <div v-else class="context-banner flex items-center gap-2 px-3 py-1 rounded ml-2">
      <v-icon size="18" class="text-medium-emphasis">mdi-store</v-icon>
      <span class="text-body-2">{{ contextLabel }}</span>
    </div>
  </template>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { useAuthStore } from '@/stores/auth';

const inventoryStore = useInventoryStore();
const authStore = useAuthStore();

// Hide the whole widget when the user is on a single-branch single-warehouse
// setup — there's nothing useful to show.
const shouldRender = computed(() => {
  if (authStore.isGlobalAdmin) return true;
  const multi =
    authStore.featureFlags?.multiBranch !== false ||
    authStore.featureFlags?.multiWarehouse !== false;
  return multi;
});

const canSwitch = computed(
  () => authStore.canSwitchBranch || authStore.canSwitchWarehouse
);

const visibleWarehouses = computed(() => {
  const allowed = authStore.allowedWarehouseIds;
  if (!allowed.length) return inventoryStore.warehousesForBranch;
  return inventoryStore.warehousesForBranch.filter((w) => allowed.includes(w.id));
});

const contextLabel = computed(() => {
  const b = inventoryStore.selectedBranch?.name;
  const w = inventoryStore.selectedWarehouse?.name;
  if (b && w) return `${b} · ${w}`;
  if (b) return b;
  if (w) return w;
  return 'السياق الحالي';
});

const onBranchChange = (id) => inventoryStore.setBranch(id);
const onWarehouseChange = (id) => inventoryStore.setWarehouse(id);

onMounted(async () => {
  if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches();
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();

  // Branch-bound users: force the selection to match their assignment so the
  // Dashboard/POS always reflects the right context.
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
.context-banner {
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
}
</style>
