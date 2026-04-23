<template>
  <div>
    <v-card class="mb-4">
      <div class="flex items-center justify-space-between pa-3 flex-wrap gap-2">
        <div>
          <div class="font-semibold text-h6 text-primary">إدارة المخزون</div>
          <div class="text-caption text-medium-emphasis">
            {{ inventoryStore.selectedWarehouse?.name || 'لم يتم اختيار مخزن' }}
          </div>
        </div>
        <div class="flex gap-2 flex-wrap">
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-transfer"
            size="default"
            :to="{ name: 'StockTransfer' }"
          >
            نقل مخزون
          </v-btn>
          <v-btn
            color="warning"
            variant="tonal"
            prepend-icon="mdi-tune"
            size="default"
            :disabled="!inventoryStore.selectedWarehouseId"
            @click="openAdjustDialog(null)"
          >
            تعديل يدوي
          </v-btn>
          <v-btn
            color="secondary"
            variant="tonal"
            prepend-icon="mdi-history"
            size="default"
            :to="{ name: 'StockMovements' }"
          >
            حركات المخزون
          </v-btn>
          <v-btn
            color="error"
            variant="tonal"
            prepend-icon="mdi-alert"
            size="default"
            :to="{ name: 'LowStock' }"
          >
            منخفض المخزون
          </v-btn>
        </div>
      </div>
    </v-card>

    <v-card>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="8">
            <v-text-field
              v-model="search"
              prepend-inner-icon="mdi-magnify"
              label="البحث عن منتج"
              hide-details
              density="comfortable"
              clearable
              @input="reload"
              @click:clear="reload"
            />
          </v-col>
          <v-col cols="12" md="4" class="flex items-center">
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
      </v-card-text>

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
        <template #[`item.actions`]="{ item }">
          <v-btn
            icon="mdi-tune"
            size="small"
            variant="text"
            title="تعديل يدوي"
            @click="openAdjustDialog(item)"
          >
            <v-icon size="20">mdi-tune</v-icon>
          </v-btn>
          <v-btn
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
          <div class="pa-8 text-center text-medium-emphasis">
            لا توجد بيانات لعرضها
          </div>
        </template>
      </v-data-table>
    </v-card>

    <!-- Adjust dialog -->
    <v-dialog v-model="adjustDialog" max-width="520">
      <v-card>
        <v-card-title>تعديل يدوي للمخزون</v-card-title>
        <v-card-text>
          <v-autocomplete
            v-model="adjustForm.productId"
            :items="inventoryStore.stock"
            item-title="name"
            item-value="productId"
            label="المنتج"
            density="comfortable"
            variant="outlined"
            :disabled="!!preselectedProduct"
          />
          <v-row>
            <v-col cols="6">
              <v-select
                v-model="adjustForm.direction"
                :items="[
                  { title: 'إضافة', value: 'in' },
                  { title: 'خصم', value: 'out' },
                ]"
                label="الحركة"
                density="comfortable"
                class="mb-2"
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model.number="adjustForm.quantity"
                label="الكمية"
                type="number"
                min="1"
                density="comfortable"
                class="mb-2"
              />
            </v-col>
          </v-row>
          <v-textarea
            v-model="adjustForm.reason"
            label="سبب التعديل (إلزامي)"
            rows="2"
            auto-grow
            density="comfortable"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="adjustDialog = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="adjusting" @click="submitAdjust">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useInventoryStore } from '@/stores/inventory';
import { useNotificationStore } from '@/stores/notification';

const inventoryStore = useInventoryStore();
const notificationStore = useNotificationStore();
const router = useRouter();

const search = ref('');
const lowStockOnly = ref(false);

const headers = [
  { title: 'المنتج', key: 'name' },
  { title: 'الرمز', key: 'sku' },
  { title: 'السعر', key: 'sellingPrice' },
  { title: 'الكمية', key: 'quantity' },
  { title: 'الحد الأدنى', key: 'lowStockThreshold' },
  { title: 'إجراءات', key: 'actions', sortable: false },
];

const filteredStock = computed(() => inventoryStore.stock);

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
};

watch(() => inventoryStore.selectedWarehouseId, reload);

onMounted(async () => {
  if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches();
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();
  await reload();
});

// Adjust dialog state
const adjustDialog = ref(false);
const adjusting = ref(false);
const preselectedProduct = ref(null);
const adjustForm = ref({ productId: null, quantity: 1, direction: 'in', reason: '' });

const openAdjustDialog = (row) => {
  preselectedProduct.value = row;
  adjustForm.value = {
    productId: row ? row.productId : null,
    quantity: 1,
    direction: 'in',
    reason: '',
  };
  adjustDialog.value = true;
};

const submitAdjust = async () => {
  const { productId, quantity, direction, reason } = adjustForm.value;
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
