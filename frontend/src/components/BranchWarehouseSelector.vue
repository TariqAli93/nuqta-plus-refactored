<template>
  <!-- Nothing to show when multi-branch/multi-warehouse features are off -->
  <template v-if="shouldRender">
    <!-- Switchable dropdowns when the user has something to switch -->
    <div v-if="hasAnySwitcher" class="flex items-center gap-2 ml-2">
      <v-select
        v-if="showBranchSelector"
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
        v-if="showWarehouseSelector"
        :model-value="inventoryStore.selectedWarehouseId"
        :items="warehouseOptions"
        item-title="name"
        item-value="id"
        label="المخزن"
        density="compact"
        hide-details
        variant="outlined"
        style="min-width: 160px"
        @update:model-value="onWarehouseChange"
      />
    </div>

    <!-- Read-only context label when there's nothing to switch -->
    <div v-else class="context-banner flex items-center gap-2 px-3 py-1 rounded ml-2">
      <v-icon size="18" class="text-medium-emphasis">mdi-store</v-icon>
      <span class="text-body-2">{{ contextLabel }}</span>
    </div>

    <!-- Admin-only warning when the active branch has no default warehouse -->
    <v-tooltip
      v-if="missingDefaultWarning"
      location="bottom"
      text="لم يتم ضبط مخزن افتراضي لهذا الفرع — يُرجى ضبطه من إعدادات الفرع"
    >
      <template #activator="{ props }">
        <v-icon v-bind="props" color="warning" size="18" class="ml-1">
          mdi-alert
        </v-icon>
      </template>
    </v-tooltip>
  </template>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { useAuthStore } from '@/stores/auth';

const inventoryStore = useInventoryStore();
const authStore = useAuthStore();

// When branches are off, show every active warehouse globally; when branches
// are on, show only warehouses for the active branch. Backend already
// filters the inventory store by user scope, so we just need to apply the
// branch view.
const warehouseOptions = computed(() => {
  const branchOn = authStore.featureFlags?.multiBranch !== false;
  const pool = branchOn
    ? inventoryStore.warehousesForBranch
    : inventoryStore.warehouses;
  const allowed = authStore.allowedWarehouseIds || [];
  const visible = !allowed.length ? pool : pool.filter((w) => allowed.includes(w.id));
  return visible.filter((w) => w.isActive !== false);
});

// Hide the whole widget when the user is on a single-branch single-warehouse
// setup — there's nothing useful to show.
const shouldRender = computed(() => {
  if (authStore.isGlobalAdmin) return true;
  const multi =
    authStore.featureFlags?.multiBranch !== false ||
    authStore.featureFlags?.multiWarehouse !== false;
  return multi;
});

// Branch selector is admin-only and only visible when multi-branch is on.
// Driven by the backend-issued `canSwitchBranch` scope flag (global admin only).
const showBranchSelector = computed(
  () =>
    authStore.canSwitchBranch &&
    authStore.featureFlags?.multiBranch !== false
);

// Warehouse selector shows whenever the user actually has more than one
// option to pick from — regardless of the `multiWarehouse` feature flag.
// Branch admins with multiple warehouses in their branch get the dropdown
// even when `multiWarehouse` is off, because the dropdown is driven by what
// the backend authorized for them, not the org-level toggle.
const showWarehouseSelector = computed(() => warehouseOptions.value.length > 1);

const hasAnySwitcher = computed(
  () => showBranchSelector.value || showWarehouseSelector.value
);

const contextLabel = computed(() => {
  const b = inventoryStore.selectedBranch?.name;
  const w = inventoryStore.selectedWarehouse?.name;
  if (b && w) return `${b} · ${w}`;
  if (b) return b;
  if (w) return w;
  return 'السياق الحالي';
});

// Only show the "no default warehouse" warning to users who can actually
// fix it. `canChangeDefaultWarehouse` is supplied by the backend.
const missingDefaultWarning = computed(
  () =>
    (authStore.capabilities?.canChangeDefaultWarehouse === true) &&
    authStore.featureFlags?.multiBranch !== false &&
    inventoryStore.missingDefaultWarehouse
);

const onBranchChange = (id) => inventoryStore.setBranch(id);
const onWarehouseChange = (id) => inventoryStore.setWarehouse(id);

onMounted(async () => {
  // The auth store already runs `initialize` on login/checkAuth. This is a
  // safety net for hot-reloads or routes mounted before auth completes.
  if (!inventoryStore.initialized) {
    await inventoryStore.initialize();
  }
});
</script>

<style scoped>
.context-banner {
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
}
</style>
