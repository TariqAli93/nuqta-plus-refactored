<template>
  <div class="page-shell">
    <PageHeader
      title="طلبات نقل المخزون"
      subtitle="إدارة طلبات النقل بين المخازن"
      icon="mdi-transfer"
    >
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        :to="{ name: 'StockTransfer' }"
      >
        طلب نقل جديد
      </v-btn>
    </PageHeader>

    <v-card class="page-section filter-toolbar">
      <div class="d-flex align-center gap-3 flex-wrap">
        <v-select
          v-model="statusFilter"
          :items="statusFilters"
          label="الحالة"
          variant="outlined"
          density="comfortable"
          prepend-inner-icon="mdi-filter-variant"
          hide-details
          style="max-width: 240px; min-width: 200px;"
          @update:model-value="reload"
        />
        <v-spacer />
        <v-btn variant="text" prepend-icon="mdi-refresh" @click="reload">
          تحديث
        </v-btn>
      </div>
    </v-card>

    <v-card class="page-section">
      <v-data-table
        :headers="headers"
        :items="transfers"
        :loading="loading"
        density="comfortable"
      >
        <template #[`item.status`]="{ item }">
          <v-chip :color="statusColor(item.status)" size="small">
            {{ statusLabel(item.status) }}
          </v-chip>
        </template>
        <template #[`item.createdAt`]="{ item }">
          {{ formatDate(item.createdAt) }}
        </template>
        <template #[`item.actions`]="{ item }">
          <template v-if="item.status === 'pending' && canApprove">
            <v-btn
              icon="mdi-check"
              size="small"
              color="success"
              variant="text"
              title="موافقة"
              @click="confirmApprove(item)"
            >
              <v-icon size="20">mdi-check</v-icon>
            </v-btn>
            <v-btn
              icon="mdi-close"
              size="small"
              color="error"
              variant="text"
              title="رفض"
              @click="openReject(item)"
            >
              <v-icon size="20">mdi-close</v-icon>
            </v-btn>
          </template>
          <span v-else class="text-caption text-medium-emphasis">—</span>
        </template>
        <template #no-data>
          <div class="pa-8 text-center text-medium-emphasis">لا توجد طلبات</div>
        </template>
      </v-data-table>
    </v-card>

    <!-- Reject dialog -->
    <v-dialog v-model="rejectDialog" max-width="480">
      <v-card>
        <v-card-title>رفض الطلب</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="rejectReason"
            label="سبب الرفض"
            rows="3"
            auto-grow
            density="comfortable"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="rejectDialog = false">إلغاء</v-btn>
          <v-btn color="error" :loading="acting" @click="submitReject">رفض</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';

const inventoryStore = useInventoryStore();
const authStore = useAuthStore();

const transfers = ref([]);
const loading = ref(false);
const statusFilter = ref(null);

const statusFilters = [
  { title: 'الكل', value: null },
  { title: 'قيد الموافقة', value: 'pending' },
  { title: 'تمت الموافقة', value: 'approved' },
  { title: 'مرفوض', value: 'rejected' },
];

const headers = [
  { title: 'الفرع', key: 'branchName' },
  { title: 'المنتج', key: 'productName' },
  { title: 'من', key: 'fromWarehouseName' },
  { title: 'إلى', key: 'toWarehouseName' },
  { title: 'الكمية', key: 'quantity' },
  { title: 'الحالة', key: 'status' },
  { title: 'الطالب', key: 'requestedByName' },
  { title: 'التاريخ', key: 'createdAt' },
  { title: 'إجراءات', key: 'actions', sortable: false },
];

const canApprove = computed(() =>
  authStore.hasPermission('approve_warehouse_transfer')
);

const statusLabel = (s) =>
  ({ pending: 'قيد الموافقة', approved: 'معتمد', rejected: 'مرفوض' })[s] || s;
const statusColor = (s) =>
  ({ pending: 'warning', approved: 'success', rejected: 'error' })[s] || 'grey';

const formatDate = (v) => {
  if (!v) return '';
  return new Date(v).toLocaleString('ar-IQ', { numberingSystem: 'latn' });
};

const reload = async () => {
  loading.value = true;
  try {
    transfers.value = await inventoryStore.fetchTransfers({
      status: statusFilter.value || undefined,
    });
  } finally {
    loading.value = false;
  }
};

const acting = ref(false);
const confirmApprove = async (row) => {
  acting.value = true;
  try {
    await inventoryStore.approveTransfer(row.id);
    await reload();
  } finally {
    acting.value = false;
  }
};

const rejectDialog = ref(false);
const rejectTarget = ref(null);
const rejectReason = ref('');

const openReject = (row) => {
  rejectTarget.value = row;
  rejectReason.value = '';
  rejectDialog.value = true;
};

const submitReject = async () => {
  acting.value = true;
  try {
    await inventoryStore.rejectTransfer(rejectTarget.value.id, rejectReason.value);
    rejectDialog.value = false;
    await reload();
  } finally {
    acting.value = false;
  }
};

onMounted(reload);
</script>
