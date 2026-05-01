<template>
  <div class="page-shell">
    <PageHeader
      title="إدارة المخزون"
      :subtitle="inventoryStore.selectedWarehouse?.name || 'لم يتم اختيار مخزن'"
      icon="mdi-warehouse"
    >
      <v-btn
        v-if="canRequestTransfer"
        color="primary"
        prepend-icon="mdi-transfer"
        size="default"
        :to="{ name: 'StockTransfer' }"
      >
        نقل مخزون
      </v-btn>
      <v-btn
        v-if="canAdjust"
        color="warning"
        variant="tonal"
        prepend-icon="mdi-tune"
        size="default"
        :disabled="!inventoryStore.selectedWarehouseId"
        @click="openAdjustDialog(null)"
      >
        إضافة / تعديل مخزون
      </v-btn>
      <v-btn
        color="primary"
        variant="text"
        prepend-icon="mdi-history"
        size="default"
        :to="{ name: 'StockMovements' }"
      >
        حركات المخزون
      </v-btn>
    </PageHeader>

    <v-card class="page-section filter-toolbar pa-3">
      <v-row dense>
        <v-col cols="12" md="8">
          <v-text-field
            v-model="search"
            prepend-inner-icon="mdi-magnify"
            label="البحث عن منتج بالاسم أو الرمز"
            hide-details
            density="comfortable"
            variant="outlined"
            clearable
            @input="reload"
            @click:clear="reload"
          />
        </v-col>
        <v-col cols="12" md="4" class="d-flex align-center">
          <v-switch
            v-model="lowStockOnly"
            color="error"
            density="comfortable"
            hide-details
            label="عرض المنخفض فقط"
            @update:model-value="reload"
          />
        </v-col>
      </v-row>
    </v-card>

    <v-card class="page-section">
      <v-data-table
        :headers="headers"
        :items="filteredStock"
        :loading="inventoryStore.loading"
        :items-per-page="25"
        density="comfortable"
      >
        <template #[`item.quantity`]="{ item }">
          <v-chip :color="item.isLowStock ? 'error' : 'success'" size="small">
            {{ item.quantity }}
          </v-chip>
        </template>
        <template #[`item.sellingPrice`]="{ item }">
          {{ formatMoney(item.sellingPrice, item.currency) }}
        </template>
        <template #[`item.nearestExpiry`]="{ item }">
          {{ item.nearestExpiry || '—' }}
        </template>
        <template #[`item.expiryStatus`]="{ item }">
          <v-chip
            size="small"
            variant="tonal"
            :color="
              item.expiryStatus === 'منتهي'
                ? 'error'
                : item.expiryStatus?.includes('7')
                  ? 'warning'
                  : item.expiryStatus === 'بدون تاريخ انتهاء'
                    ? 'grey'
                    : 'success'
            "
          >
            {{ item.expiryStatus }}
          </v-chip>
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            v-if="canAdjust"
            icon="mdi-tune"
            size="small"
            variant="text"
            title="إضافة / تعديل مخزون"
            @click="openAdjustDialog(item)"
          >
            <v-icon size="20">mdi-tune</v-icon>
          </v-btn>
          <v-btn
            v-if="canRequestTransfer"
            icon="mdi-transfer"
            size="small"
            variant="text"
            title="نقل"
            @click="openTransferFor(item)"
          >
            <v-icon size="20">mdi-transfer</v-icon>
          </v-btn>
        </template>
        <template #no-data>
          <EmptyState
            title="لا توجد بيانات لعرضها"
            :description="
              inventoryStore.selectedWarehouseId
                ? 'لا توجد منتجات تطابق هذا الفلتر — جرّب تعديل البحث.'
                : 'اختر مخزنًا من شريط الأدوات لعرض المخزون.'
            "
            icon="mdi-warehouse"
            compact
          />
        </template>
      </v-data-table>
    </v-card>

    <!-- Adjust dialog -->
    <v-dialog v-model="adjustDialog" max-width="520">
      <v-card>
        <v-card-title class="d-flex align-center gap-2">
          <v-icon color="warning">mdi-tune</v-icon>
          <span>تعديل يدوي للمخزون</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-autocomplete
            v-model="adjustForm.productId"
            :items="inventoryStore.stock"
            item-title="name"
            item-value="productId"
            label="المنتج"
            density="comfortable"
            variant="outlined"
            :disabled="!!preselectedProduct"
            class="mb-3"
          />
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-select
                v-model="adjustForm.direction"
                :items="[
                  { title: 'إضافة', value: 'in' },
                  { title: 'خصم', value: 'out' },
                ]"
                label="الحركة"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model.number="adjustForm.quantity"
                label="الكمية"
                type="number"
                min="1"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
          </v-row>
          <v-textarea
            v-model="adjustForm.reason"
            label="سبب التعديل (إلزامي)"
            rows="2"
            auto-grow
            variant="outlined"
            density="comfortable"
          />
          <v-text-field
            v-if="selectedProductTracksExpiry"
            v-model="adjustForm.expiryDate"
            label="تاريخ الانتهاء"
            type="date"
            variant="outlined"
            density="comfortable"
            class="mt-2"
          />
          <v-text-field
            v-model.number="adjustForm.costPrice"
            label="سعر الكلفة (اختياري)"
            type="number"
            min="0"
            variant="outlined"
            density="comfortable"
            class="mt-2"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn variant="text" @click="adjustDialog = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="adjusting" @click="submitAdjust">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useInventoryStore } from '@/stores/inventory';
import { useNotificationStore } from '@/stores/notification';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';

const inventoryStore = useInventoryStore();
const notificationStore = useNotificationStore();
const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

const canAdjust = computed(() => authStore.hasPermission?.('inventory:adjust') === true);
const canRequestTransfer = computed(() => authStore.hasPermission?.('inventory:transfer') === true);

const search = ref('');
const lowStockOnly = ref(false);

const headers = [
  { title: 'المنتج', key: 'name' },
  { title: 'الرمز', key: 'sku' },
  { title: 'السعر', key: 'sellingPrice' },
  { title: 'الكمية', key: 'quantity' },
  { title: 'الحد الأدنى', key: 'lowStockThreshold' },
  { title: 'أقرب تاريخ انتهاء', key: 'nearestExpiry' },
  { title: 'حالة الصلاحية', key: 'expiryStatus' },
  { title: 'إجراءات', key: 'actions', sortable: false },
];

const expiryMap = ref(new Map());
const filteredStock = computed(() =>
  (inventoryStore.stock || []).map((row) => {
    const key = `${row.productId}:${row.warehouseId || inventoryStore.selectedWarehouseId}`;
    const ex = expiryMap.value.get(key);
    return {
      ...row,
      nearestExpiry: ex?.nearestExpiry || null,
      expiryStatus: ex?.status || (row.tracksExpiry ? 'صالح' : 'بدون تاريخ انتهاء'),
    };
  })
);

const formatMoney = (value, currency = 'IQD') => {
  const n = Number(value || 0);
  return `${n.toLocaleString('en-US')} ${currency}`;
};

const reload = async () => {
  if (!inventoryStore.selectedWarehouseId) return;
  await inventoryStore.fetchWarehouseStock(inventoryStore.selectedWarehouseId, {
    search: search.value || undefined,
    lowStockOnly: lowStockOnly.value || undefined,
  });
  const alerts = await inventoryStore.fetchExpiryAlerts({
    warehouseId: inventoryStore.selectedWarehouseId,
  });
  const map = new Map();
  for (const row of alerts || []) {
    const key = `${row.productId}:${row.warehouseId}`;
    const cur = map.get(key);
    if (!cur || (row.expiryDate && (!cur.nearestExpiry || row.expiryDate < cur.nearestExpiry))) {
      map.set(key, { nearestExpiry: row.expiryDate, status: row.status });
    }
  }
  expiryMap.value = map;
};

watch(() => inventoryStore.selectedWarehouseId, reload);

onMounted(async () => {
  if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches();
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();
  await reload();
  await maybeOpenAdjustFromRoute();
});

// Allow other screens (e.g. ProductForm) to deep-link into the adjust flow:
//   /inventory?productId=42&action=adjust
// Resolves the row from the loaded warehouse stock and pre-fills the dialog.
const maybeOpenAdjustFromRoute = async () => {
  if (route.query.action !== 'adjust') return;
  const productId = Number(route.query.productId);
  if (!productId || !canAdjust.value) return;
  if (!inventoryStore.selectedWarehouseId) {
    notificationStore.error('اختر مخزناً قبل إضافة كمية افتتاحية');
    return;
  }
  await nextTick();
  const row = (inventoryStore.stock || []).find((r) => Number(r.productId) === productId);
  openAdjustDialog(row || { productId });
  // Clear the query so a refresh doesn't re-open the dialog unexpectedly.
  router.replace({ name: 'Inventory' });
};

// Adjust dialog state
const adjustDialog = ref(false);
const adjusting = ref(false);
const preselectedProduct = ref(null);
const adjustForm = ref({ productId: null, quantity: 1, direction: 'in', reason: '', expiryDate: '', costPrice: null });
const selectedProductTracksExpiry = computed(() => {
  const pid = Number(adjustForm.value.productId);
  const row = (inventoryStore.stock || []).find((r) => Number(r.productId) === pid);
  return !!row?.tracksExpiry;
});

const openAdjustDialog = (row) => {
  preselectedProduct.value = row;
  adjustForm.value = {
    productId: row ? row.productId : null,
    quantity: 1,
    direction: 'in',
    reason: '',
    expiryDate: '',
    costPrice: null,
  };
  adjustDialog.value = true;
};

const submitAdjust = async () => {
  const { productId, quantity, direction, reason, expiryDate, costPrice } = adjustForm.value;
  if (!productId || !quantity || !reason.trim()) {
    notificationStore.error('أكمل بيانات التعديل قبل الحفظ');
    return;
  }
  adjusting.value = true;
  try {
    await inventoryStore.adjustStock({
      productId,
      warehouseId: inventoryStore.selectedWarehouseId,
      quantityChange: direction === 'in' ? quantity : -quantity,
      reason: reason.trim(),
      expiryDate: selectedProductTracksExpiry.value && expiryDate ? expiryDate : null,
      costPrice: costPrice === '' || costPrice === null || costPrice === undefined ? undefined : costPrice,
    });
    adjustDialog.value = false;
    await reload();
  } catch {
    /* notification already handled */
  } finally {
    adjusting.value = false;
  }
};

const openTransferFor = (item) => {
  router.push({ name: 'StockTransfer', query: { productId: item.productId } });
};
</script>
