<template>
  <div class="page-shell">
    <PageHeader
      title="نقل مخزون بين المخازن"
      subtitle="إنشاء طلب نقل بضاعة من مخزن إلى آخر"
      icon="mdi-transfer"
    >
      <v-btn variant="text" prepend-icon="mdi-arrow-right" @click="router.back()"> رجوع </v-btn>
    </PageHeader>

    <v-card class="page-section mx-auto">
      <v-card-text>
        <v-row>
          <v-col cols="12">
            <v-autocomplete
              v-model="form.productId"
              :items="fromStock"
              item-title="label"
              item-value="productId"
              label="المنتج"
              density="comfortable"
              variant="outlined"
              :disabled="!form.fromWarehouseId"
            />
          </v-col>

          <v-col cols="12" md="6">
            <v-select
              v-model="form.fromWarehouseId"
              :items="sourceOptions"
              item-title="name"
              item-value="id"
              label="من المخزن"
              density="comfortable"
              :rules="[(v) => !!v || 'مطلوب']"
              :readonly="!canChangeSource"
              :hint="!canChangeSource ? 'مقيّد بمخزنك الحالي' : ''"
              persistent-hint
              @update:model-value="onSourceChange"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="form.toWarehouseId"
              :items="destinationOptions"
              item-title="name"
              item-value="id"
              label="إلى المخزن"
              density="comfortable"
              :rules="[(v) => !!v || 'مطلوب']"
              :loading="loadingTargets"
              :no-data-text="noDestinationsText"
            />
            <div
              v-if="!loadingTargets && destinationOptions.length === 0 && form.fromWarehouseId"
              class="text-caption text-warning mt-1"
            >
              {{ noDestinationsText }}
            </div>
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
            <v-text-field v-model="form.notes" label="ملاحظات (اختياري)" density="comfortable" />
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
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notification';
import api from '@/plugins/axios';
import PageHeader from '@/components/PageHeader.vue';

const inventoryStore = useInventoryStore();
const notificationStore = useNotificationStore();
const authStore = useAuthStore();
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
const loadingTargets = ref(false);
const fromStock = ref([]);
// Destinations are loaded from the dedicated transfer-targets endpoint so the
// dropdown isn't constrained by the user's POS/inventory scope (which only
// exposes their active warehouse).
const destinationOptions = ref([]);

// Source dropdown options come from the inventory store, which only contains
// the warehouses the backend authorized for the current user. We just keep
// active rows here — no role-based filtering on the frontend.
const sourceOptions = computed(() => inventoryStore.warehouses.filter((w) => w.isActive));

// User can change source iff the backend gave them more than one warehouse.
// No role check needed.
const canChangeSource = computed(() => sourceOptions.value.length > 1);

const maxQuantity = computed(() => {
  const row = fromStock.value.find((r) => r.productId === form.productId);
  return row?.quantity || 0;
});

const noDestinationsText = computed(() =>
  authStore.hasFeature('multiBranch')
    ? 'لا يوجد مخازن متاحة للنقل في فرعك الحالي.'
    : 'لا يوجد مخازن متاحة للنقل.'
);

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

/**
 * Pulls valid transfer destinations for the current source.
 * Server enforces same-branch restriction for non-admin users so the list is
 * already correct for the caller's permissions.
 */
const loadTransferTargets = async () => {
  if (!form.fromWarehouseId) {
    destinationOptions.value = [];
    return;
  }
  loadingTargets.value = true;
  try {
    const response = await api.get('/warehouses/transfer-targets', {
      params: { sourceWarehouseId: form.fromWarehouseId },
    });
    destinationOptions.value = response?.data || [];
    // Drop a stale destination if it isn't in the new target list.
    if (form.toWarehouseId && !destinationOptions.value.some((w) => w.id === form.toWarehouseId)) {
      form.toWarehouseId = null;
    }
  } catch (error) {
    destinationOptions.value = [];
    notificationStore.error(error?.message || 'فشل تحميل مخازن النقل');
  } finally {
    loadingTargets.value = false;
  }
};

const onSourceChange = () => {
  form.productId = null;
  form.toWarehouseId = null;
  loadFromStock();
  loadTransferTargets();
};

const submit = async () => {
  submitting.value = true;
  try {
    const payload = {
      fromWarehouseId: form.fromWarehouseId,
      toWarehouseId: form.toWarehouseId,
      productId: form.productId,
      quantity: form.quantity,
      notes: form.notes || undefined,
    };

    // canApproveTransfer is true for users who can move stock immediately
    // (global admin / branch admin); everyone else submits a request to the
    // approval queue. This replaces a hardcoded role check.
    if (authStore.can('canApproveTransfer')) {
      await inventoryStore.transferStock(payload);
      router.push({ name: 'Inventory' });
    } else {
      await inventoryStore.requestTransfer(payload);
      router.push({ name: 'TransferRequests' });
    }
  } catch {
    /* notification already handled */
  } finally {
    submitting.value = false;
  }
};

watch(
  () => form.fromWarehouseId,
  (next, prev) => {
    if (next === prev) return;
    onSourceChange();
  }
);

onMounted(async () => {
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();

  // Default the source to the user's active warehouse when nothing was
  // pre-selected — non-admins can't change it anyway.
  if (!form.fromWarehouseId && inventoryStore.selectedWarehouseId) {
    form.fromWarehouseId = inventoryStore.selectedWarehouseId;
  }

  if (form.fromWarehouseId) {
    await Promise.all([loadFromStock(), loadTransferTargets()]);
  }
});
</script>
