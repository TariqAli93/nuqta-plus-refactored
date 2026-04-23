<template>
  <div>
    <v-card class="mb-4">
      <div class="flex items-center justify-space-between pa-3">
        <div class="font-semibold text-h6 text-primary">حركات المخزون</div>
        <v-btn color="primary" @click="router.back()">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </div>
    </v-card>

    <v-card>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-select
              v-model="filters.warehouseId"
              :items="inventoryStore.warehouses"
              item-title="name"
              item-value="id"
              label="المخزن"
              density="comfortable"
              clearable
              hide-details
              @update:model-value="reload"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="filters.movementType"
              :items="movementTypes"
              label="نوع الحركة"
              density="comfortable"
              clearable
              hide-details
              @update:model-value="reload"
            />
          </v-col>
        </v-row>
      </v-card-text>

      <v-data-table
        :headers="headers"
        :items="inventoryStore.movements"
        :items-per-page="inventoryStore.movementsPagination.limit"
        :items-length="inventoryStore.movementsPagination.total"
        :loading="inventoryStore.loading"
        server-items-length
        density="comfortable"
        hide-default-footer
      >
        <template #[`item.movementType`]="{ item }">
          <v-chip :color="typeColor(item.movementType)" size="small">
            {{ typeLabel(item.movementType) }}
          </v-chip>
        </template>
        <template #[`item.quantityChange`]="{ item }">
          <span :class="item.quantityChange > 0 ? 'text-success' : 'text-error'">
            {{ item.quantityChange > 0 ? '+' : '' }}{{ item.quantityChange }}
          </span>
        </template>
        <template #[`item.createdAt`]="{ item }">
          {{ formatDate(item.createdAt) }}
        </template>
      </v-data-table>

      <PaginationControls
        :pagination="inventoryStore.movementsPagination"
        @update:page="changePage"
      />
    </v-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useInventoryStore } from '@/stores/inventory';
import PaginationControls from '@/components/PaginationControls.vue';

const router = useRouter();
const inventoryStore = useInventoryStore();

const filters = reactive({
  warehouseId: inventoryStore.selectedWarehouseId || null,
  movementType: null,
});

const movementTypes = [
  { title: 'بيع', value: 'sale' },
  { title: 'إلغاء بيع', value: 'sale_cancel' },
  { title: 'استرجاع', value: 'sale_return' },
  { title: 'نقل وارد', value: 'transfer_in' },
  { title: 'نقل صادر', value: 'transfer_out' },
  { title: 'إدخال يدوي', value: 'manual_adjustment_in' },
  { title: 'خصم يدوي', value: 'manual_adjustment_out' },
  { title: 'رصيد افتتاحي', value: 'opening_balance' },
];

const typeLabel = (t) => movementTypes.find((x) => x.value === t)?.title || t;
const typeColor = (t) =>
  ({
    sale: 'error',
    sale_cancel: 'warning',
    sale_return: 'warning',
    transfer_in: 'success',
    transfer_out: 'error',
    manual_adjustment_in: 'primary',
    manual_adjustment_out: 'error',
    opening_balance: 'info',
  })[t] || 'grey';

const headers = [
  { title: 'المنتج', key: 'productName' },
  { title: 'المخزن', key: 'warehouseName' },
  { title: 'النوع', key: 'movementType' },
  { title: 'الكمية', key: 'quantityChange' },
  { title: 'قبل', key: 'quantityBefore' },
  { title: 'بعد', key: 'quantityAfter' },
  { title: 'ملاحظات', key: 'notes' },
  { title: 'المستخدم', key: 'createdByName' },
  { title: 'التاريخ', key: 'createdAt' },
];

const formatDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return d.toLocaleString('ar-IQ', { numberingSystem: 'latn' });
};

const reload = async () => {
  await inventoryStore.fetchMovements({
    warehouseId: filters.warehouseId || undefined,
    movementType: filters.movementType || undefined,
    page: inventoryStore.movementsPagination.page,
    limit: inventoryStore.movementsPagination.limit,
  });
};

const changePage = (page) => {
  inventoryStore.movementsPagination.page = Number(page);
  reload();
};

watch(() => inventoryStore.selectedWarehouseId, (v) => {
  filters.warehouseId = v || null;
  reload();
});

onMounted(async () => {
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();
  reload();
});
</script>
