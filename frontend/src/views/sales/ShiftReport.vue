<template>
  <div class="page-shell shift-report">
    <PageHeader
      title="تقرير الورديات"
      subtitle="متابعة نقدية الكاشير لكل وردية مع الفروع والفروقات"
      icon="mdi-cash-register"
    >
      <v-btn
        variant="tonal"
        color="primary"
        :loading="loading"
        prepend-icon="mdi-refresh"
        @click="reload"
      >
        تحديث
      </v-btn>
    </PageHeader>

    <!-- ── KPI cards ──────────────────────────────────────────────────── -->
    <div class="summary-grid page-section">
      <StatCard
        label="إجمالي الورديات"
        :value="summary.total"
        icon="mdi-clipboard-text-clock-outline"
        icon-color="primary"
        :hint="`مفتوحة: ${summary.open} · مغلقة: ${summary.closed}`"
      />
      <StatCard
        label="إجمالي المعدود"
        :value="formatMoney(summary.totalCounted)"
        icon="mdi-cash-plus"
        icon-color="success"
        hint="من الورديات المغلقة فقط"
      />
      <StatCard
        label="إجمالي المتوقع"
        :value="formatMoney(summary.totalExpected)"
        icon="mdi-scale-balance"
        icon-color="info"
        hint="افتتاحي + النقد الوارد"
      />
      <StatCard
        label="إجمالي الفروقات"
        :value="formatMoney(summary.totalVariance)"
        icon="mdi-swap-vertical-bold"
        :icon-color="varianceColor(summary.totalVariance)"
        :hint="`عجز: ${summary.shortCount} · زيادة: ${summary.overCount}`"
      />
    </div>

    <!-- ── Filters ────────────────────────────────────────────────────── -->
    <v-card class="page-section filter-toolbar pa-3">
      <v-row dense align="center">
        <v-col v-if="showBranchFilter" cols="12" sm="6" md="3">
          <v-select
            v-model="filters.branchId"
            :items="branchOptions"
            label="الفرع"
            density="comfortable"
            variant="outlined"
            hide-details
            clearable
            prepend-inner-icon="mdi-domain"
            @update:model-value="applyFilters"
          />
        </v-col>
        <v-col cols="12" sm="6" md="3">
          <v-select
            v-model="filters.status"
            :items="statusOptions"
            label="الحالة"
            density="comfortable"
            variant="outlined"
            hide-details
            clearable
            prepend-inner-icon="mdi-filter-variant"
            @update:model-value="applyFilters"
          />
        </v-col>
        <v-col cols="12" sm="6" md="3">
          <v-text-field
            v-model="filters.startDate"
            label="من تاريخ"
            type="date"
            density="comfortable"
            variant="outlined"
            hide-details
            prepend-inner-icon="mdi-calendar-start"
            @change="applyFilters"
          />
        </v-col>
        <v-col cols="12" sm="6" md="3">
          <v-text-field
            v-model="filters.endDate"
            label="إلى تاريخ"
            type="date"
            density="comfortable"
            variant="outlined"
            hide-details
            prepend-inner-icon="mdi-calendar-end"
            @change="applyFilters"
          />
        </v-col>
      </v-row>
      <v-row v-if="hasActiveFilter" dense class="mt-2">
        <v-col cols="12" class="d-flex justify-end">
          <v-btn
            size="small"
            variant="text"
            color="primary"
            prepend-icon="mdi-filter-remove-outline"
            @click="clearFilters"
          >
            مسح الفلاتر
          </v-btn>
        </v-col>
      </v-row>
    </v-card>

    <!-- ── Table ──────────────────────────────────────────────────────── -->
    <v-card class="page-section">
      <div class="section-title">
        <span class="section-title__label">
          <v-icon size="20" color="primary">mdi-format-list-bulleted</v-icon>
          <span>قائمة الورديات</span>
        </span>
        <span class="section-title__hint">{{ pagination.total }} وردية مطابقة</span>
      </div>

      <div class="sessions-card__table">
        <div v-if="loading && sessions.length === 0" class="loading-state loading-state--compact">
          <v-progress-circular indeterminate color="primary" size="40" />
          <div class="text-body-2 text-medium-emphasis">جاري التحميل…</div>
        </div>
        <EmptyState
          v-else-if="sessions.length === 0"
          title="لا توجد ورديات مطابقة"
          description="جرّب تعديل الفلاتر أو الفترة الزمنية."
          icon="mdi-tray-remove"
          compact
        />
        <v-table v-else density="comfortable" hover>
          <thead>
            <tr>
              <th class="text-start">#</th>
              <th class="text-start">الكاشير</th>
              <th class="text-start">الفرع</th>
              <th class="text-end">الافتتاحي</th>
              <th class="text-end">المتوقع</th>
              <th class="text-end">المعدود</th>
              <th class="text-end">الفرق</th>
              <th class="text-start">الحالة</th>
              <th class="text-start">الفتح</th>
              <th class="text-start">الإغلاق</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in sessions" :key="s.id" @click="openDetails(s.id)">
              <td class="font-weight-medium">#{{ s.id }}</td>
              <td>
                <div class="cashier-cell">
                  <v-avatar size="28" color="primary" variant="tonal">
                    <span class="cashier-cell__avatar">
                      {{ initials(s.cashierName || s.cashierUsername) }}
                    </span>
                  </v-avatar>
                  <div class="cashier-cell__info">
                    <div class="cashier-cell__name">
                      {{ s.cashierName || s.cashierUsername || '—' }}
                    </div>
                    <div v-if="s.cashierUsername && s.cashierName" class="cashier-cell__username">
                      @{{ s.cashierUsername }}
                    </div>
                  </div>
                </div>
              </td>
              <td>
                <v-chip
                  v-if="s.branchName"
                  size="x-small"
                  variant="tonal"
                  color="primary"
                  prepend-icon="mdi-domain"
                >
                  {{ s.branchName }}
                </v-chip>
                <span v-else class="text-medium-emphasis text-caption"> بدون فرع </span>
              </td>
              <td class="text-end mono">
                {{ formatMoney(s.openingCash, s.currency) }}
              </td>
              <td class="text-end mono">
                {{ s.expectedCash != null ? formatMoney(s.expectedCash, s.currency) : '—' }}
              </td>
              <td class="text-end mono">
                {{ s.closingCash != null ? formatMoney(s.closingCash, s.currency) : '—' }}
              </td>
              <td class="text-end mono" :class="varianceTextClass(s.variance)">
                <span
                  v-if="s.variance != null"
                  class="variance-pill"
                  :class="variancePillClass(s.variance)"
                >
                  <v-icon size="14">{{ varianceIcon(s.variance) }}</v-icon>
                  {{ formatMoney(s.variance, s.currency) }}
                </span>
                <span v-else>—</span>
              </td>
              <td>
                <v-chip
                  :color="s.status === 'open' ? 'success' : 'default'"
                  size="x-small"
                  variant="flat"
                >
                  {{ s.status === 'open' ? 'مفتوحة' : 'مغلقة' }}
                </v-chip>
              </td>
              <td class="text-caption text-medium-emphasis">
                {{ formatDate(s.openedAt) }}
              </td>
              <td class="text-caption text-medium-emphasis">
                {{ s.closedAt ? formatDate(s.closedAt) : '—' }}
              </td>
              <td class="text-end" @click.stop>
                <v-btn
                  variant="text"
                  size="small"
                  :loading="loadingId === s.id"
                  @click="openDetails(s.id)"
                >
                  تفاصيل
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>

      <PaginationControls
        v-if="pagination.total > 0"
        :pagination="pagination"
        @update:page="onPageChange"
        @update:items-per-page="onLimitChange"
      />
    </v-card>

    <!-- ── Detail dialog ──────────────────────────────────────────────── -->
    <v-dialog v-model="detailOpen" max-width="640" scrollable>
      <v-card v-if="detail" rounded="xl" class="detail-card">
        <v-card-title class="d-flex align-center gap-2 pa-4">
          <v-icon color="primary">mdi-cash-register</v-icon>
          <div>
            <div class="text-subtitle-1 font-weight-bold">وردية #{{ detail.id }}</div>
            <div class="text-caption text-medium-emphasis">
              {{ detail.cashierName || detail.cashierUsername || '—' }}
              <span v-if="detail.branchName"> · {{ detail.branchName }}</span>
            </div>
          </div>
          <v-spacer />
          <v-chip
            :color="detail.status === 'open' ? 'success' : 'default'"
            size="small"
            variant="flat"
          >
            {{ detail.status === 'open' ? 'مفتوحة' : 'مغلقة' }}
          </v-chip>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-row dense>
            <v-col cols="6">
              <div class="detail-stat">
                <span class="detail-stat__label">النقد الافتتاحي</span>
                <span class="detail-stat__value">
                  {{ formatMoney(detail.openingCash, detail.currency) }}
                </span>
              </div>
            </v-col>
            <v-col cols="6">
              <div class="detail-stat">
                <span class="detail-stat__label">النقد الوارد</span>
                <span class="detail-stat__value">
                  {{ formatMoney(detail.cashIn, detail.currency) }}
                </span>
              </div>
            </v-col>
            <v-col v-if="(detail.cashOut || 0) > 0" cols="6">
              <div class="detail-stat">
                <span class="detail-stat__label">المرتجعات النقدية</span>
                <span class="detail-stat__value">
                  − {{ formatMoney(detail.cashOut, detail.currency) }}
                </span>
              </div>
            </v-col>
            <v-col cols="6">
              <div class="detail-stat detail-stat--strong">
                <span class="detail-stat__label">المتوقع</span>
                <span class="detail-stat__value">
                  {{ formatMoney(detail.expectedCash, detail.currency) }}
                </span>
              </div>
            </v-col>
            <v-col cols="6">
              <div class="detail-stat detail-stat--strong">
                <span class="detail-stat__label">المعدود</span>
                <span class="detail-stat__value">
                  {{
                    detail.closingCash != null
                      ? formatMoney(detail.closingCash, detail.currency)
                      : '—'
                  }}
                </span>
              </div>
            </v-col>
            <v-col cols="6">
              <div class="detail-stat" :class="varianceCardClass(detail.variance)">
                <span class="detail-stat__label">الفرق</span>
                <span class="detail-stat__value">
                  {{
                    detail.variance != null ? formatMoney(detail.variance, detail.currency) : '—'
                  }}
                </span>
              </div>
            </v-col>
            <v-col cols="6">
              <div class="detail-stat">
                <span class="detail-stat__label">عدد المبيعات النقدية</span>
                <span class="detail-stat__value">{{ detail.cashSalesCount ?? 0 }}</span>
              </div>
            </v-col>
            <v-col cols="6">
              <div class="detail-stat">
                <span class="detail-stat__label">العملة</span>
                <span class="detail-stat__value">{{ detail.currency }}</span>
              </div>
            </v-col>
            <v-col cols="6">
              <div class="detail-stat">
                <span class="detail-stat__label">وقت الفتح</span>
                <span class="detail-stat__value">{{ formatDate(detail.openedAt) }}</span>
              </div>
            </v-col>
            <v-col cols="6">
              <div class="detail-stat">
                <span class="detail-stat__label">وقت الإغلاق</span>
                <span class="detail-stat__value">
                  {{ detail.closedAt ? formatDate(detail.closedAt) : '—' }}
                </span>
              </div>
            </v-col>
          </v-row>
          <div v-if="detail.notes" class="detail-notes mt-3">
            <div class="text-caption text-medium-emphasis">ملاحظات</div>
            <div class="text-body-2">{{ detail.notes }}</div>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="justify-end pa-3">
          <v-btn variant="text" @click="detailOpen = false">إغلاق</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useCashSessionStore } from '@/stores/cashSession';
import { useInventoryStore } from '@/stores/inventory';
import PaginationControls from '@/components/PaginationControls.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import EmptyState from '@/components/EmptyState.vue';

const store = useCashSessionStore();
const inventoryStore = useInventoryStore();

const sessions = computed(() => store.sessions);
const pagination = computed(() => store.pagination);
const loading = computed(() => store.loading);

const detailOpen = ref(false);
const detail = ref(null);
const loadingId = ref(null);

// ── Filters ───────────────────────────────────────────────────────────────
const filters = reactive({
  status: null,
  branchId: null,
  startDate: '',
  endDate: '',
});

const statusOptions = [
  { title: 'مفتوحة', value: 'open' },
  { title: 'مغلقة', value: 'closed' },
];

const branchOptions = computed(() =>
  (inventoryStore.branches || []).map((b) => ({ title: b.name, value: b.id }))
);

// Branch filter shows whenever there is more than one branch in scope —
// non-global users still get it when they're authorised on multiple branches,
// e.g. a regional manager with cross-branch read access.
const showBranchFilter = computed(() => (inventoryStore.branches?.length || 0) > 1);

const hasActiveFilter = computed(
  () => !!filters.status || !!filters.branchId || !!filters.startDate || !!filters.endDate
);

// ── Summary KPIs (computed from the loaded page) ──────────────────────────
const summary = computed(() => {
  const list = sessions.value || [];
  const closed = list.filter((s) => s.status === 'closed');
  const totalCounted = closed.reduce((sum, s) => sum + (Number(s.closingCash) || 0), 0);
  const totalExpected = closed.reduce((sum, s) => sum + (Number(s.expectedCash) || 0), 0);
  const totalVariance = closed.reduce((sum, s) => sum + (Number(s.variance) || 0), 0);
  const shortCount = closed.filter((s) => Number(s.variance) < -0.0001).length;
  const overCount = closed.filter((s) => Number(s.variance) > 0.0001).length;
  return {
    total: pagination.value.total || list.length,
    open: list.filter((s) => s.status === 'open').length,
    closed: closed.length,
    totalCounted,
    totalExpected,
    totalVariance,
    shortCount,
    overCount,
  };
});

// ── Loaders ───────────────────────────────────────────────────────────────
const buildParams = (overrides = {}) => {
  const params = {
    page: pagination.value.page,
    limit: pagination.value.limit,
    ...overrides,
  };
  if (filters.status) params.status = filters.status;
  if (filters.branchId) params.branchId = filters.branchId;
  if (filters.startDate) params.startDate = filters.startDate;
  if (filters.endDate) params.endDate = filters.endDate;
  return params;
};

const reload = () => store.fetchList(buildParams());
const applyFilters = () => store.fetchList(buildParams({ page: 1 }));
const clearFilters = () => {
  filters.status = null;
  filters.branchId = null;
  filters.startDate = '';
  filters.endDate = '';
  applyFilters();
};

const onPageChange = (page) => store.fetchList(buildParams({ page }));
const onLimitChange = (limit) => store.fetchList(buildParams({ page: 1, limit }));

const openDetails = async (id) => {
  loadingId.value = id;
  try {
    detail.value = await store.fetchById(id);
    detailOpen.value = true;
  } finally {
    loadingId.value = null;
  }
};

// ── Formatting helpers ────────────────────────────────────────────────────
const formatMoney = (v, cur = 'USD') => {
  const num = Number(v) || 0;
  if (cur === 'IQD') return `${Math.round(num).toLocaleString('en-US')} د.ع`;
  return `$${num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const initials = (name) => {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
};

const varianceColor = (v) => {
  if (v === null || v === undefined) return 'medium-emphasis';
  const num = Number(v);
  if (Math.abs(num) < 0.0001) return 'success';
  return num > 0 ? 'info' : 'error';
};

const varianceIcon = (v) => {
  const num = Number(v);
  if (Math.abs(num) < 0.0001) return 'mdi-check-circle-outline';
  return num > 0 ? 'mdi-arrow-up-bold' : 'mdi-arrow-down-bold';
};

const varianceTextClass = (v) => {
  if (v === null || v === undefined) return '';
  const num = Number(v);
  if (Math.abs(num) < 0.0001) return 'text-success';
  return num > 0 ? 'text-info' : 'text-error';
};

const variancePillClass = (v) => {
  const num = Number(v);
  if (Math.abs(num) < 0.0001) return 'variance-pill--ok';
  return num > 0 ? 'variance-pill--over' : 'variance-pill--short';
};

const varianceCardClass = (v) => {
  if (v === null || v === undefined) return '';
  const num = Number(v);
  if (Math.abs(num) < 0.0001) return 'detail-stat--ok';
  return num > 0 ? 'detail-stat--over' : 'detail-stat--short';
};

// ── Lifecycle ────────────────────────────────────────────────────────────
watch(
  () => filters.branchId,
  () => applyFilters()
);

onMounted(async () => {
  if ((inventoryStore.branches || []).length === 0) {
    try {
      await inventoryStore.fetchBranches();
    } catch {
      /* non-fatal */
    }
  }
  reload();
});
</script>

<style scoped lang="scss">
.sessions-card__table {
  overflow-x: auto;

  tbody tr {
    cursor: pointer;
    transition: background 0.15s ease;
  }
}

.cashier-cell {
  display: flex;
  align-items: center;
  gap: 0.6rem;

  &__avatar {
    font-size: 0.78rem;
    font-weight: 700;
  }
  &__info {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }
  &__name {
    font-weight: 500;
  }
  &__username {
    font-size: 0.72rem;
    color: rgba(var(--v-theme-on-surface), 0.55);
  }
}

.mono {
  font-variant-numeric: tabular-nums;
}

.variance-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;

  &--ok {
    color: rgb(var(--v-theme-success));
    background: rgba(var(--v-theme-success), 0.12);
  }
  &--over {
    color: rgb(var(--v-theme-info));
    background: rgba(var(--v-theme-info), 0.12);
  }
  &--short {
    color: rgb(var(--v-theme-error));
    background: rgba(var(--v-theme-error), 0.12);
  }
}

.detail-card {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

.detail-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0.6rem 0.8rem;
  border-radius: 0.5rem;
  background: rgba(var(--v-theme-on-surface), 0.04);

  &__label {
    font-size: 0.75rem;
    color: rgba(var(--v-theme-on-surface), 0.65);
  }
  &__value {
    font-size: 1rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  &--strong {
    background: rgba(var(--v-theme-primary), 0.08);
  }
  &--ok {
    background: rgba(var(--v-theme-success), 0.1);
  }
  &--over {
    background: rgba(var(--v-theme-info), 0.1);
  }
  &--short {
    background: rgba(var(--v-theme-error), 0.1);
  }
}

.detail-notes {
  padding: 0.6rem 0.8rem;
  border-radius: 0.5rem;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
</style>
