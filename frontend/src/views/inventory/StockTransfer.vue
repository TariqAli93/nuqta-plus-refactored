<template>
  <div>
    <v-card class="mb-4">
      <div class="flex items-center justify-space-between pa-3">
        <div class="font-semibold text-h6 text-primary">نقل مخزون بين المخازن</div>
        <v-btn variant="text" prepend-icon="mdi-arrow-right" :to="{ name: 'Inventory' }">
          رجوع
        </v-btn>
      </div>
    </v-card>

    <v-card max-width="720" class="mx-auto">
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-select
              v-model="form.fromWarehouseId"
              :items="activeWarehouses"
              item-title="name"
              item-value="id"
              label="من المخزن"
              density="comfortable"
              :rules="[(v) => !!v || 'مطلوب']"
              @update:model-value="loadFromStock"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="form.toWarehouseId"
              :items="activeWarehouses.filter((w) => w.id !== form.fromWarehouseId)"
              item-title="name"
              item-value="id"
              label="إلى المخزن"
              density="comfortable"
              :rules="[(v) => !!v || 'مطلوب']"
            />
          </v-col>
          <v-col cols="12">
            <v-autocomplete
              v-model="form.productId"
              :items="fromStock"
              item-title="label"
              item-value="productId"
              label="المنتج"
              density="comfortable"
              :disabled="!form.fromWarehouseId"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model.number="form.quantity"
              type="number"
              min="1"
              label="الكمية"
              density="comfortable"
              :max="maxQuantity"
              :hint="form.productId ? `المتاح: ${maxQuantity}` : ''"
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.notes"
              label="ملاحظات (اختياري)"
              density="comfortable"
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :to="{ name: 'Inventory' }">إلغاء</v-btn>
        <v-btn color="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
          تأكيد النقل
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useInventoryStore } from '@/stores/inventory';
import { useNotificationStore } from '@/stores/notification';
import api from '@/plugins/axios';

const inventoryStore = useInventoryStore();
const notificationStore = useNotificationStore();
const router = useRouter();
const route = useRoute();

const form = reactive({
  fromWarehouseId: inventoryStore.selectedWarehouseId || null,
  toWarehouseId: null,
  productId: route.query.productId ? Number(route.query.productId) : null,
  quantity: 1,
  notes: '',
});

const submitting = ref(false);
const fromStock = ref([]);

const activeWarehouses = computed(() => inventoryStore.warehouses.filter((w) => w.isActive));
const maxQuantity = computed(() => {
  const row = fromStock.value.find((r) => r.productId === form.productId);
  return row?.quantity || 0;
});

const canSubmit = computed(
  () =>
    form.fromWarehouseId &&
    form.toWarehouseId &&
    form.productId &&
    form.quantity > 0 &&
    form.quantity <= maxQuantity.value &&
    form.fromWarehouseId !== form.toWarehouseId
);

const loadFromStock = async () => {
  if (!form.fromWarehouseId) {
    fromStock.value = [];
    return;
  }
  const response = await api.get(`/inventory/warehouses/${form.fromWarehouseId}/stock`);
  fromStock.value = (response?.data || []).map((r) => ({
    ...r,
    label: `${r.name} — متاح: ${r.quantity}`,
  }));
};

const submit = async () => {
  submitting.value = true;
  try {
    await inventoryStore.transferStock({
      fromWarehouseId: form.fromWarehouseId,
      toWarehouseId: form.toWarehouseId,
      productId: form.productId,
      quantity: form.quantity,
      notes: form.notes || undefined,
    });
    router.push({ name: 'Inventory' });
  } catch {
    /* notification already handled */
  } finally {
    submitting.value = false;
  }
};

watch(
  () => form.fromWarehouseId,
  () => {
    form.productId = null;
    loadFromStock();
  }
);

onMounted(async () => {
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();
  if (form.fromWarehouseId) await loadFromStock();
});
</script>
