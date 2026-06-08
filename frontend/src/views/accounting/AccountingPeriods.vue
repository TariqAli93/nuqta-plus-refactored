<template>
  <div class="page-shell">
    <PageHeader
      title="القيود المحاسبية"
      subtitle="فتح وإغلاق الفترات المالية ومراجعة نتائجها"
      icon="mdi-book-clock-outline"
    >
      <v-btn
        v-if="canOpen"
        color="primary"
        prepend-icon="mdi-plus"
        @click="openDialog = true"
      >
        فتح قيد جديد
      </v-btn>
    </PageHeader>

    <v-card class="page-section">
      <v-data-table
        :headers="headers"
        :items="store.periods"
        :loading="store.loading"
        density="comfortable"
        @click:row="(_, { item }) => showDetails(item)"
      >
        <template #[`item.type`]="{ item }">{{ typeLabel(item.type) }}</template>
        <template #[`item.scope`]="{ item }">
          {{ item.branchName || (item.scopeType === 'global' ? 'النظام كامل' : '—') }}
        </template>
        <template #[`item.status`]="{ item }">
          <v-chip :color="item.status === 'open' ? 'success' : 'grey'" size="small">
            {{ item.status === 'open' ? 'مفتوح' : 'مغلق' }}
          </v-chip>
        </template>
        <template #[`item.openedAt`]="{ item }">{{ fmtDate(item.openedAt) }}</template>
        <template #[`item.closedAt`]="{ item }">{{ item.closedAt ? fmtDate(item.closedAt) : '—' }}</template>
        <template #[`item.netProfit`]="{ item }">
          <span v-if="firstCur(item)" :class="netClass(item)">
            {{ formatCurrency(firstTotals(item).netProfit, firstCur(item)) }}
          </span>
          <span v-else class="text-medium-emphasis">—</span>
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn size="small" variant="text" icon="mdi-eye" title="تفاصيل" @click.stop="showDetails(item)">
            <v-icon>mdi-eye</v-icon>
          </v-btn>
          <v-btn
            v-if="item.status === 'open' && canClose"
            size="small"
            variant="text"
            color="warning"
            icon="mdi-lock"
            title="إغلاق القيد"
            @click.stop="startClose(item)"
          >
            <v-icon>mdi-lock</v-icon>
          </v-btn>
        </template>
        <template #no-data>
          <EmptyState
            title="لا توجد قيود محاسبية"
            description="افتح قيداً محاسبياً لبدء فترة مالية جديدة."
            icon="mdi-book-clock-outline"
            compact
          />
        </template>
      </v-data-table>
    </v-card>

    <!-- Open dialog -->
    <v-dialog v-model="openDialog" max-width="480">
      <v-card>
        <v-card-title class="d-flex align-center gap-2">
          <v-icon color="primary">mdi-book-plus-outline</v-icon>
          <span>فتح قيد محاسبي جديد</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-select
            v-model="form.type"
            :items="typeOptions"
            item-title="title"
            item-value="value"
            label="نوع القيد"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />
          <v-select
            v-if="multiBranch"
            v-model="form.branchId"
            :items="branches"
            item-title="name"
            item-value="id"
            label="الفرع"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />
          <v-textarea
            v-model="form.notes"
            label="ملاحظات (اختياري)"
            variant="outlined"
            density="comfortable"
            rows="2"
            hide-details
          />
          <v-alert v-if="openWarning" type="warning" variant="tonal" density="compact" class="mt-3">
            يوجد قيد مفتوح بالفعل لهذا النطاق — أغلقه قبل فتح قيد جديد.
          </v-alert>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn variant="text" @click="openDialog = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="busy" @click="submitOpen">فتح القيد</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Close dialog with pre-close summary -->
    <v-dialog v-model="closeDialog" max-width="560">
      <v-card>
        <v-card-title class="d-flex align-center gap-2">
          <v-icon color="warning">mdi-lock</v-icon>
          <span>إغلاق القيد المحاسبي</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-alert type="info" variant="tonal" density="compact" class="mb-3">
            سيتم إغلاق جميع الورديات المفتوحة ({{ closeTarget?.openShiftCount || 0 }}) وقفل العمليات
            المالية داخل القيد. لا يمكن التراجع.
          </v-alert>
          <div v-if="closeTarget?.totals" class="summary-grid">
            <template v-for="(t, cur) in closeTarget.totals.byCurrency" :key="cur">
              <div class="summary-currency">{{ cur }}</div>
              <SummaryRow label="إجمالي المبيعات (صافي)" :value="formatCurrency(t.netSales, cur)" />
              <SummaryRow label="المرتجعات" :value="formatCurrency(t.returnedValue, cur)" />
              <SummaryRow label="تكلفة البضاعة المباعة" :value="formatCurrency(t.cogsNet, cur)" />
              <SummaryRow label="المصاريف" :value="formatCurrency(t.expenses, cur)" />
              <SummaryRow
                label="صافي الربح / الخسارة"
                :value="formatCurrency(t.netProfit, cur)"
                :emphasis="t.netProfit < 0 ? 'error' : 'success'"
              />
            </template>
          </div>
          <p v-else class="text-medium-emphasis">لا توجد حركات مالية في هذا القيد بعد.</p>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn variant="text" @click="closeDialog = false">إلغاء</v-btn>
          <v-btn color="warning" :loading="busy" @click="submitClose">تأكيد الإغلاق</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Detail dialog -->
    <v-dialog v-model="detailDialog" max-width="760" scrollable>
      <v-card v-if="detail">
        <v-card-title class="d-flex align-center gap-2">
          <v-icon>mdi-book-open-variant</v-icon>
          <span>قيد #{{ detail.id }} — {{ typeLabel(detail.type) }}</span>
          <v-chip :color="detail.status === 'open' ? 'success' : 'grey'" size="small" class="ms-2">
            {{ detail.status === 'open' ? 'مفتوح' : 'مغلق' }}
          </v-chip>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <div class="meta-line">
            <span>النطاق: {{ detail.branchName || 'النظام كامل' }}</span>
            <span>الفتح: {{ fmtDate(detail.openedAt) }}</span>
            <span v-if="detail.closedAt">الإغلاق: {{ fmtDate(detail.closedAt) }}</span>
          </div>

          <h4 class="section-title">النتائج المالية</h4>
          <div v-if="detail.totals" class="summary-grid">
            <template v-for="(t, cur) in detail.totals.byCurrency" :key="cur">
              <div class="summary-currency">{{ cur }}</div>
              <SummaryRow label="إجمالي المبيعات قبل الخصم" :value="formatCurrency(t.grossSales, cur)" />
              <SummaryRow label="الخصومات" :value="formatCurrency(t.discounts, cur)" />
              <SummaryRow label="صافي المبيعات" :value="formatCurrency(t.netSales, cur)" />
              <SummaryRow label="المحصّل نقداً" :value="formatCurrency(t.paidCash, cur)" />
              <SummaryRow label="المحصّل بطاقة" :value="formatCurrency(t.paidCard, cur)" />
              <SummaryRow label="الديون / الآجل" :value="formatCurrency(t.debt, cur)" />
              <SummaryRow label="المرتجعات" :value="formatCurrency(t.returnedValue, cur)" />
              <SummaryRow label="تكلفة البضاعة المباعة" :value="formatCurrency(t.cogsNet, cur)" />
              <SummaryRow label="المصاريف" :value="formatCurrency(t.expenses, cur)" />
              <SummaryRow label="إجمالي الربح" :value="formatCurrency(t.grossProfit, cur)" />
              <SummaryRow
                label="صافي الربح / الخسارة"
                :value="formatCurrency(t.netProfit, cur)"
                :emphasis="t.netProfit < 0 ? 'error' : 'success'"
              />
            </template>
          </div>
          <p v-else class="text-medium-emphasis">لا توجد بيانات.</p>

          <h4 class="section-title">الورديات ({{ detail.shiftCount || 0 }})</h4>
          <v-table density="compact">
            <thead>
              <tr><th>#</th><th>الكاشير</th><th>الحالة</th><th>الافتتاح</th><th>الإغلاق</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in detail.shifts" :key="s.id">
                <td>{{ s.id }}</td>
                <td>{{ s.cashierName || '—' }}</td>
                <td>{{ s.status === 'open' ? 'مفتوحة' : 'مغلقة' }}</td>
                <td>{{ fmtDate(s.openedAt) }}</td>
                <td>{{ s.closedAt ? fmtDate(s.closedAt) : '—' }}</td>
              </tr>
              <tr v-if="!detail.shifts?.length"><td colspan="5" class="text-medium-emphasis">لا توجد ورديات</td></tr>
            </tbody>
          </v-table>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn
            v-if="detail.status === 'open' && canClose"
            color="warning"
            prepend-icon="mdi-lock"
            @click="startClose(detail)"
          >
            إغلاق القيد
          </v-btn>
          <v-btn variant="text" @click="detailDialog = false">إغلاق</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, h, onMounted, ref } from 'vue';
import { useAccountingPeriodStore } from '@/stores/accountingPeriod';
import { useAuthStore } from '@/stores/auth';
import { useInventoryStore } from '@/stores/inventory';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import { formatCurrency } from '@/utils/formatters';

// Tiny inline label/value row to avoid an extra file.
const SummaryRow = (props) =>
  h('div', { class: 'summary-row' }, [
    h('span', { class: 'summary-label' }, props.label),
    h('span', { class: `summary-value ${props.emphasis ? 'text-' + props.emphasis : ''}` }, props.value),
  ]);
SummaryRow.props = ['label', 'value', 'emphasis'];

const store = useAccountingPeriodStore();
const authStore = useAuthStore();
const inventoryStore = useInventoryStore();

const multiBranch = computed(() => authStore.hasFeature?.('multiBranch') === true);
const canOpen = computed(() => authStore.hasPermission?.('accounting_periods:open') === true);
const canClose = computed(() => authStore.hasPermission?.('accounting_periods:close') === true);
const branches = computed(() => inventoryStore.branches || []);

const headers = [
  { title: 'النوع', key: 'type' },
  { title: 'النطاق', key: 'scope' },
  { title: 'الحالة', key: 'status' },
  { title: 'تاريخ الفتح', key: 'openedAt' },
  { title: 'تاريخ الإغلاق', key: 'closedAt' },
  { title: 'فتحه', key: 'openedByName' },
  { title: 'صافي الربح', key: 'netProfit', align: 'end' },
  { title: '', key: 'actions', sortable: false, align: 'end' },
];

const typeOptions = [
  { value: 'daily', title: 'يومي' },
  { value: 'weekly', title: 'أسبوعي' },
  { value: 'monthly', title: 'شهري' },
  { value: 'yearly', title: 'سنوي' },
];
const typeLabel = (t) => typeOptions.find((o) => o.value === t)?.title || t;

const fmtDate = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(d);
  }
};

const firstTotals = (item) => {
  const by = item.totalsJson?.byCurrency || {};
  const cur = Object.keys(by)[0];
  return cur ? by[cur] : null;
};
const firstCur = (item) => Object.keys(item.totalsJson?.byCurrency || {})[0] || null;
const netClass = (item) => {
  const t = firstTotals(item);
  return t && t.netProfit < 0 ? 'text-error' : 'text-success';
};

// ── Open ───────────────────────────────────────────────────────────────────
const openDialog = ref(false);
const busy = ref(false);
const form = ref({ type: 'monthly', branchId: null, notes: '' });
const openWarning = computed(() => {
  if (multiBranch.value) {
    return store.openPeriods.some((p) => p.branchId === form.value.branchId);
  }
  return store.openPeriods.some((p) => p.scopeType === 'global');
});

const submitOpen = async () => {
  busy.value = true;
  try {
    const payload = { type: form.value.type, notes: form.value.notes || undefined };
    if (multiBranch.value && form.value.branchId) payload.branchId = form.value.branchId;
    await store.open(payload);
    openDialog.value = false;
    form.value = { type: 'monthly', branchId: null, notes: '' };
  } catch {
    /* notified in store */
  } finally {
    busy.value = false;
  }
};

// ── Close ──────────────────────────────────────────────────────────────────
const closeDialog = ref(false);
const closeTarget = ref(null);
const startClose = async (item) => {
  detailDialog.value = false;
  closeTarget.value = await store.fetchById(item.id); // live preview totals
  closeDialog.value = true;
};
const submitClose = async () => {
  busy.value = true;
  try {
    await store.close(closeTarget.value.id);
    closeDialog.value = false;
    closeTarget.value = null;
  } catch {
    /* notified in store */
  } finally {
    busy.value = false;
  }
};

// ── Detail ─────────────────────────────────────────────────────────────────
const detailDialog = ref(false);
const detail = ref(null);
const showDetails = async (item) => {
  detail.value = await store.fetchById(item.id);
  detailDialog.value = true;
};

onMounted(async () => {
  await store.fetchAll();
  if (multiBranch.value && branches.value.length === 0) {
    await inventoryStore.fetchBranches().catch(() => {});
  }
});
</script>

<style scoped>
.summary-grid {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.summary-currency {
  font-weight: 700;
  margin-top: 0.5rem;
  color: rgb(var(--v-theme-primary));
}
.summary-row {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  border-bottom: 1px dashed rgba(var(--v-theme-on-surface), 0.08);
}
.summary-value {
  font-weight: 600;
}
.section-title {
  margin: 1rem 0 0.5rem;
  font-weight: 700;
}
.meta-line {
  display: flex;
  gap: 1.25rem;
  flex-wrap: wrap;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.875rem;
}
:deep(tr) { cursor: pointer; }
</style>
