<template>
  <div class="page-shell">
    <PageHeader
      title="التحصيل — الأقساط المتأخرة"
      subtitle="متابعة الأقساط المتأخرة عن موعد الاستحقاق"
      icon="mdi-alert-circle-outline"
      icon-color="error"
    >
      <v-btn
        variant="tonal"
        color="primary"
        size="default"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="reload"
      >
        تحديث
      </v-btn>
    </PageHeader>

    <v-card class="page-section filter-toolbar">
      <v-row dense>
        <v-col cols="12" sm="6" md="3">
          <v-select
            v-model="filters.agingBucket"
            :items="agingBuckets"
            label="فترة التأخر"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-clock-alert-outline"
            hide-details
            clearable
            @update:model-value="reload"
          />
        </v-col>
        <v-col cols="6" sm="6" md="3">
          <v-text-field
            v-model="filters.startDate"
            type="date"
            label="من تاريخ"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-calendar-start"
            hide-details
            clearable
            @update:model-value="reload"
          />
        </v-col>
        <v-col cols="6" sm="6" md="3">
          <v-text-field
            v-model="filters.endDate"
            type="date"
            label="إلى تاريخ"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-calendar-end"
            hide-details
            clearable
            @update:model-value="reload"
          />
        </v-col>
        <v-col v-if="canPickBranch" cols="12" sm="6" md="3">
          <v-text-field
            v-model.number="filters.branchId"
            type="number"
            label="رقم الفرع (اختياري)"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-source-branch"
            hide-details
            clearable
            @update:model-value="reload"
          />
        </v-col>
      </v-row>
    </v-card>

    <v-card class="page-section">
      <v-card-text class="pa-0">
        <div v-if="loading" class="loading-state">
          <v-progress-circular indeterminate color="primary" size="48" />
          <div class="text-body-2 text-medium-emphasis">جاري تحميل البيانات…</div>
        </div>
        <div v-else-if="!items.length" class="pa-4">
          <EmptyState
            title="لا توجد أقساط متأخرة"
            description="جميع الأقساط ضمن نطاقك مدفوعة أو مستحقة بعد اليوم."
            icon="mdi-check-circle"
            icon-color="success"
            compact
          />
        </div>
        <v-data-table
          v-else
          :headers="headers"
          :items="items"
          :items-per-page="pagination.limit"
          :page="pagination.page"
          :items-length="pagination.total"
          :server-items-length="pagination.total"
          :loading="loading"
          density="comfortable"
        >
          <template #[`item.customerName`]="{ item }">
            <RouterLink
              :to="`/customers/${item.customerId}`"
              class="text-primary text-decoration-none"
            >
              {{ item.customerName || '—' }}
            </RouterLink>
          </template>
          <template #[`item.invoiceNumber`]="{ item }">
            <RouterLink
              v-if="item.saleId"
              :to="`/sales/${item.saleId}`"
              class="text-primary text-decoration-none"
            >
              {{ item.invoiceNumber || `#${item.saleId}` }}
            </RouterLink>
          </template>
          <template #[`item.dueAmount`]="{ item }">
            {{ formatCurrency(item.dueAmount, item.currency) }}
          </template>
          <template #[`item.remainingAmount`]="{ item }">
            <span class="text-error font-weight-bold">
              {{ formatCurrency(item.remainingAmount, item.currency) }}
            </span>
          </template>
          <template #[`item.overdueDays`]="{ item }">
            <v-chip :color="agingColor(item.overdueDays)" size="x-small">
              {{ item.overdueDays }} يوم
            </v-chip>
          </template>
          <template #[`item.actions`]="{ item }">
            <v-btn
              size="x-small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-account-arrow-left"
              :to="`/customers/${item.customerId}`"
            >
              فتح الملف
            </v-btn>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useCollectionsStore } from '@/stores/collections';
import { useAuthStore } from '@/stores/auth';
import * as uiAccess from '@/auth/uiAccess.js';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { formatCurrency } from '@/utils/helpers';

const collectionsStore = useCollectionsStore();
const authStore = useAuthStore();

const loading = ref(false);
const items = ref([]);
const pagination = reactive({ page: 1, limit: 50, total: 0, totalPages: 0 });
const filters = reactive({
  agingBucket: null,
  startDate: null,
  endDate: null,
  branchId: null,
});

const userRole = computed(() => authStore.user?.role);
const canPickBranch = computed(() => uiAccess.isGlobalAdmin(userRole.value));

const agingBuckets = [
  { title: '1–7 أيام', value: '1-7' },
  { title: '8–30 يوم', value: '8-30' },
  { title: '31–60 يوم', value: '31-60' },
  { title: 'أكثر من 60 يوم', value: '60+' },
];

const headers = [
  { title: 'العميل', key: 'customerName' },
  { title: 'الهاتف', key: 'customerPhone' },
  { title: 'الفاتورة', key: 'invoiceNumber' },
  { title: 'الفرع', key: 'branchName' },
  { title: 'القسط', key: 'installmentNumber' },
  { title: 'الاستحقاق', key: 'dueDate' },
  { title: 'المبلغ', key: 'dueAmount', align: 'end' },
  { title: 'المتبقي', key: 'remainingAmount', align: 'end' },
  { title: 'تأخر', key: 'overdueDays' },
  { title: '', key: 'actions', sortable: false },
];

const agingColor = (days) => {
  if (days > 60) return 'error';
  if (days > 30) return 'warning';
  if (days > 7) return 'orange';
  return 'amber';
};

const reload = async () => {
  loading.value = true;
  try {
    const params = { page: pagination.page, limit: pagination.limit };
    if (filters.agingBucket) params.agingBucket = filters.agingBucket;
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    if (filters.branchId) params.branchId = filters.branchId;
    const res = await collectionsStore.overdue(params);
    items.value = res.data;
    Object.assign(pagination, res.meta);
  } catch {
    items.value = [];
  } finally {
    loading.value = false;
  }
};

onMounted(reload);
</script>
