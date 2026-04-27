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
  const branchOn = authStore.hasFeature('multiBranch');
  const pool = branchOn
    ? inventoryStore.warehousesForBranch
    : inventoryStore.warehouses;
  const allowed = authStore.allowedWarehouseIds || [];
  const visible = !allowed.length ? pool : pool.filter((w) => allowed.includes(w.id));
  return visible.filter((w) => w.isActive !== false);
});

// Hide the whole widget when neither multi-branch nor multi-warehouse is on
// AND the user has no cross-branch capability. Capabilities are the source of
// truth here — `can('canSwitchBranch')` is already gated on the multiBranch
// flag at the backend, so we don't double-check the flag here.
const shouldRender = computed(() => {
  if (authStore.can('canSwitchBranch')) return true;
  return authStore.hasFeature('multiBranch') || authStore.hasFeature('multiWarehouse');
});

// Branch selector visibility comes straight from the backend capability.
// `canSwitchBranch` is already false when multiBranch is off OR the user
// is not a global admin, so no extra flag check is needed here.
const showBranchSelector = computed(() => authStore.can('canSwitchBranch'));

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
// fix it. `canChangeDefaultWarehouse` is supplied by the backend and is
// already gated on the multiBranch flag.
const missingDefaultWarning = computed(
  () => authStore.can('canChangeDefaultWarehouse') && inventoryStore.missingDefaultWarehouse
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
