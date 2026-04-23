<template>
  <v-card v-if="shouldRender" class="role-hero pa-4 mb-4" rounded="xl" elevation="0">
    <div class="flex items-start justify-space-between flex-wrap gap-3">
      <div>
        <div class="text-h5 font-weight-bold">{{ greeting }}</div>
        <div class="text-body-2 text-medium-emphasis mt-1">{{ subtitle }}</div>
      </div>
      <v-chip v-if="contextLabel" color="primary" variant="tonal" size="small">
        <v-icon start size="16">mdi-store</v-icon>
        {{ contextLabel }}
      </v-chip>
    </div>

    <v-row class="mt-4" dense>
      <v-col v-for="kpi in kpis" :key="kpi.title" cols="6" md="3">
        <v-card variant="tonal" :color="kpi.color" class="pa-3 h-full" rounded="lg">
          <div class="flex items-center gap-2 mb-1">
            <v-icon size="20">{{ kpi.icon }}</v-icon>
            <span class="text-caption font-weight-medium">{{ kpi.title }}</span>
          </div>
          <div class="text-h6 font-weight-bold">{{ kpi.value }}</div>
          <div v-if="kpi.hint" class="text-caption text-medium-emphasis">{{ kpi.hint }}</div>
        </v-card>
      </v-col>
    </v-row>

    <div v-if="shortcuts.length" class="flex gap-2 mt-4 flex-wrap">
      <v-btn
        v-for="s in shortcuts"
        :key="s.title"
        :to="s.to"
        :color="s.color || 'primary'"
        :variant="s.variant || 'tonal'"
        :prepend-icon="s.icon"
        size="default"
      >
        {{ s.title }}
      </v-btn>
    </div>
  </v-card>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useInventoryStore } from '@/stores/inventory';
import api from '@/plugins/axios';

const authStore = useAuthStore();
const inventoryStore = useInventoryStore();

const pendingTransfers = ref(0);
const lowStockCount = ref(0);

const role = computed(() => authStore.user?.role);
const fullName = computed(() => authStore.user?.fullName || authStore.user?.username || '');

/**
 * Hide the hero entirely when the whole multi-branch / multi-warehouse /
 * transfers trio is off. On a simple single-branch POS setup its KPIs and
 * shortcuts add no value, so the Dashboard renders without it.
 */
const shouldRender = computed(() => {
  const f = authStore.featureFlags || {};
  return (
    f.multiBranch !== false ||
    f.multiWarehouse !== false ||
    f.warehouseTransfers !== false
  );
});

const greeting = computed(() => {
  if (authStore.isGlobalAdmin) return `مرحباً ${fullName.value} — إدارة عامة`;
  if (role.value === 'branch_admin') return `مرحباً ${fullName.value} — مدير الفرع`;
  if (role.value === 'viewer') return `مرحباً ${fullName.value} — وضع المشاهدة`;
  return `مرحباً ${fullName.value}`;
});

const subtitle = computed(() => {
  if (authStore.isGlobalAdmin) return 'عرض لكل الفروع والعمليات في الوقت الحقيقي.';
  if (role.value === 'branch_admin') return 'إدارة عمليات فرعك، الموافقات، والتقارير.';
  if (role.value === 'cashier') return 'ابدأ بيعاً جديداً أو تابع الأقساط والعملاء.';
  if (role.value === 'manager') return 'إدارة المبيعات والمنتجات والعملاء في فرعك.';
  return 'ابدأ يومك بشكل سريع.';
});

const contextLabel = computed(() => {
  const b = inventoryStore.selectedBranch?.name;
  const w = inventoryStore.selectedWarehouse?.name;
  if (b && w) return `${b} · ${w}`;
  if (b) return b;
  return '';
});

// ── KPIs per role ──────────────────────────────────────────────────────────
const kpis = computed(() => {
  if (authStore.isGlobalAdmin) {
    return [
      {
        title: 'الفروع النشطة',
        value: inventoryStore.branches.filter((b) => b.isActive).length,
        icon: 'mdi-store',
        color: 'primary',
      },
      {
        title: 'المخازن النشطة',
        value: inventoryStore.warehouses.filter((w) => w.isActive).length,
        icon: 'mdi-warehouse',
        color: 'secondary',
      },
      {
        title: 'طلبات نقل معلّقة',
        value: pendingTransfers.value,
        icon: 'mdi-transfer',
        color: pendingTransfers.value ? 'warning' : 'success',
      },
      {
        title: 'منخفض المخزون',
        value: lowStockCount.value,
        icon: 'mdi-alert',
        color: lowStockCount.value ? 'error' : 'success',
      },
    ];
  }

  if (role.value === 'branch_admin') {
    return [
      {
        title: 'الفرع الحالي',
        value: inventoryStore.selectedBranch?.name || '—',
        icon: 'mdi-store',
        color: 'primary',
      },
      {
        title: 'طلبات معلّقة',
        value: pendingTransfers.value,
        icon: 'mdi-check-decagram',
        color: pendingTransfers.value ? 'warning' : 'success',
        hint: pendingTransfers.value ? 'تحتاج مراجعتك' : 'لا يوجد طلبات',
      },
      {
        title: 'منخفض المخزون',
        value: lowStockCount.value,
        icon: 'mdi-alert',
        color: lowStockCount.value ? 'error' : 'success',
      },
    ];
  }

  // Staff (cashier / manager / viewer)
  return [
    {
      title: 'المخزن الحالي',
      value: inventoryStore.selectedWarehouse?.name || '—',
      icon: 'mdi-warehouse',
      color: 'primary',
    },
  ];
});

// ── Shortcuts per role ─────────────────────────────────────────────────────
const shortcuts = computed(() => {
  const list = [];
  if (authStore.hasPermission('create:sales')) {
    list.push({ title: 'بيع جديد', icon: 'mdi-plus-circle', to: '/sales/new', color: 'primary' });
  }
  if (authStore.hasPermission('create:customers')) {
    list.push({ title: 'عميل جديد', icon: 'mdi-account-plus', to: '/customers/new', variant: 'outlined' });
  }
  if (
    authStore.hasPermission('approve_warehouse_transfer') &&
    authStore.featureFlags?.warehouseTransfers !== false
  ) {
    list.push({
      title: 'طلبات النقل',
      icon: 'mdi-check-decagram',
      to: '/inventory/transfers',
      variant: 'outlined',
      color: pendingTransfers.value ? 'warning' : undefined,
    });
  }
  if (authStore.isGlobalAdmin) {
    list.push({
      title: 'إعدادات الميزات',
      icon: 'mdi-toggle-switch',
      to: '/settings/feature-flags',
      variant: 'text',
    });
  }
  return list;
});

// ── Data loads ─────────────────────────────────────────────────────────────
const loadPendingTransfers = async () => {
  if (authStore.featureFlags?.warehouseTransfers === false) return;
  if (!authStore.hasPermission('inventory:read')) return;
  try {
    const response = await api.get('/warehouse-transfers', {
      params: { status: 'pending', limit: 1, page: 1 },
    });
    pendingTransfers.value = Number(response?.meta?.total || 0);
  } catch {
    pendingTransfers.value = 0;
  }
};

const loadLowStock = async () => {
  if (authStore.featureFlags?.inventory === false) return;
  const warehouseId = inventoryStore.selectedWarehouseId;
  if (!warehouseId) return;
  try {
    const response = await api.get(`/inventory/warehouses/${warehouseId}/low-stock`);
    lowStockCount.value = (response?.data || []).length;
  } catch {
    lowStockCount.value = 0;
  }
};

onMounted(async () => {
  if (!shouldRender.value) return; // hero is hidden — skip the lookups entirely
  if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches();
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();
  loadPendingTransfers();
  loadLowStock();
});
</script>

<style scoped>
.role-hero {
  background: linear-gradient(
    135deg,
    rgba(var(--v-theme-primary), 0.06),
    rgba(var(--v-theme-secondary), 0.04)
  );
  border: 1px solid rgba(var(--v-theme-primary), 0.12);
}
</style>
