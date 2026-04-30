<template>
  <div class="page-shell">
    <PageHeader title="تنبيهات الصلاحية" subtitle="متابعة الكميات المنتهية أو القريبة من الانتهاء" icon="mdi-calendar-alert" />
    <v-card class="page-section pa-3">
      <v-row dense>
        <v-col cols="12" md="4"><v-select v-model="filters.branchId" :items="branchOptions" label="الفرع" clearable /></v-col>
        <v-col cols="12" md="4"><v-select v-model="filters.warehouseId" :items="warehouseOptions" label="المخزن" clearable /></v-col>
        <v-col cols="12" md="4"><v-select v-model="filters.status" :items="statuses" label="الحالة" clearable /></v-col>
      </v-row>
      <div class="d-flex justify-end">
        <v-btn color="primary" prepend-icon="mdi-refresh" @click="load">تحديث</v-btn>
      </div>
    </v-card>
    <v-card class="page-section">
      <v-data-table :headers="headers" :items="rows" :loading="loading">
        <template #[`item.expiryDate`]="{ item }">{{ item.expiryDate || '—' }}</template>
        <template #no-data>
          <EmptyState
            title="لا توجد بيانات صلاحية"
            description="لا توجد كميات مطابقة للفلاتر الحالية."
            icon="mdi-calendar-alert"
            compact
          />
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>
<script setup>
import { ref, computed, onMounted } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
const inventoryStore = useInventoryStore();
const loading = ref(false);
const rows = ref([]);
const filters = ref({ branchId: null, warehouseId: null, status: null });
const statuses = ['منتهي', 'ينتهي خلال 7 أيام', 'ينتهي خلال 30 يوم', 'ينتهي خلال 60 يوم', 'صالح', 'بدون تاريخ انتهاء'];
const headers = [
  { title: 'المنتج', key: 'productName' },
  { title: 'الفرع', key: 'branchName' },
  { title: 'المخزن', key: 'warehouseName' },
  { title: 'الكمية المتبقية', key: 'remainingQuantity' },
  { title: 'تاريخ الانتهاء', key: 'expiryDate' },
  { title: 'الحالة', key: 'status' },
];
const branchOptions = computed(() => (inventoryStore.branches || []).map((b) => ({ title: b.name, value: b.id })));
const warehouseOptions = computed(() => (inventoryStore.warehouses || []).filter((w) => !filters.value.branchId || w.branchId === filters.value.branchId).map((w) => ({ title: w.name, value: w.id })));
const load = async () => {
  loading.value = true;
  try {
    const result = await inventoryStore.fetchExpiryAlerts({
      warehouseId: filters.value.warehouseId || undefined,
      status: filters.value.status || undefined,
    });
    rows.value = (result || []).filter(
      (r) => !filters.value.branchId || r.branchId === filters.value.branchId
    );
  } finally { loading.value = false; }
};
onMounted(async () => { if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches(); if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses(); await load(); });
</script>
