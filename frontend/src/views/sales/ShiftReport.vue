<template>
  <div class="shift-report pa-4">
    <header class="d-flex align-center gap-3 mb-4">
      <v-icon size="28" color="primary">mdi-cash-register</v-icon>
      <div>
        <h1 class="text-h6 mb-0">تقرير الورديات</h1>
        <div class="text-caption text-medium-emphasis">
          ملخص نقدية الكاشير لكل وردية
        </div>
      </div>
      <v-spacer />
      <v-select
        v-model="statusFilter"
        :items="statusOptions"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 180px"
        @update:model-value="reload"
      />
      <v-btn variant="text" :loading="loading" @click="reload">
        <v-icon>mdi-refresh</v-icon>
      </v-btn>
    </header>

    <v-card class="mb-4 bg-surface-soft rounded-lg" elevation="0">
      <v-card-text class="pa-0">
        <v-table density="comfortable">
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
            <tr v-if="loading && sessions.length === 0">
              <td colspan="11" class="text-center py-6 text-medium-emphasis">جاري التحميل…</td>
            </tr>
            <tr v-else-if="sessions.length === 0">
              <td colspan="11" class="text-center py-6 text-medium-emphasis">
                لا توجد ورديات
              </td>
            </tr>
            <tr v-for="s in sessions" v-else :key="s.id">
              <td>#{{ s.id }}</td>
              <td>{{ s.cashierName || s.cashierUsername || '-' }}</td>
              <td>{{ s.branchName || '-' }}</td>
              <td class="text-end">{{ formatMoney(s.openingCash, s.currency) }}</td>
              <td class="text-end">
                {{ s.expectedCash != null ? formatMoney(s.expectedCash, s.currency) : '—' }}
              </td>
              <td class="text-end">
                {{ s.closingCash != null ? formatMoney(s.closingCash, s.currency) : '—' }}
              </td>
              <td class="text-end" :class="varianceClass(s.variance)">
                {{ s.variance != null ? formatMoney(s.variance, s.currency) : '—' }}
              </td>
              <td>
                <v-chip
                  :color="s.status === 'open' ? 'success' : 'default'"
                  size="small"
                  variant="flat"
                >
                  {{ s.status === 'open' ? 'مفتوحة' : 'مغلقة' }}
                </v-chip>
              </td>
              <td>{{ formatDate(s.openedAt) }}</td>
              <td>{{ s.closedAt ? formatDate(s.closedAt) : '—' }}</td>
              <td>
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
      </v-card-text>
    </v-card>

    <PaginationControls
      v-if="pagination.total > 0"
      :pagination="pagination"
      @update:page="onPageChange"
      @update:items-per-page="onLimitChange"
    />

    <!-- Detail dialog -->
    <v-dialog v-model="detailOpen" max-width="520">
      <v-card v-if="detail" class="bg-surface-soft rounded-lg">
        <v-card-title class="d-flex align-center gap-2">
          <v-icon color="primary">mdi-cash-register</v-icon>
          <span>وردية #{{ detail.id }}</span>
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
          <div class="detail-grid">
            <div><span>الكاشير</span><b>{{ detail.cashierName || detail.cashierUsername || '-' }}</b></div>
            <div><span>الفرع</span><b>{{ detail.branchName || '-' }}</b></div>
            <div><span>العملة</span><b>{{ detail.currency }}</b></div>
            <div><span>عدد المبيعات النقدية</span><b>{{ detail.cashSalesCount ?? 0 }}</b></div>
            <div>
              <span>النقد الافتتاحي</span>
              <b>{{ formatMoney(detail.openingCash, detail.currency) }}</b>
            </div>
            <div>
              <span>النقد الوارد</span>
              <b>{{ formatMoney(detail.cashIn, detail.currency) }}</b>
            </div>
            <div v-if="(detail.cashOut || 0) > 0">
              <span>المرتجعات النقدية</span>
              <b>− {{ formatMoney(detail.cashOut, detail.currency) }}</b>
            </div>
            <div>
              <span>المتوقع</span>
              <b>{{ formatMoney(detail.expectedCash, detail.currency) }}</b>
            </div>
            <div>
              <span>المعدود</span>
              <b>
                {{ detail.closingCash != null ? formatMoney(detail.closingCash, detail.currency) : '—' }}
              </b>
            </div>
            <div :class="varianceClass(detail.variance)">
              <span>الفرق</span>
              <b>
                {{ detail.variance != null ? formatMoney(detail.variance, detail.currency) : '—' }}
              </b>
            </div>
            <div><span>وقت الفتح</span><b>{{ formatDate(detail.openedAt) }}</b></div>
            <div>
              <span>وقت الإغلاق</span>
              <b>{{ detail.closedAt ? formatDate(detail.closedAt) : '—' }}</b>
            </div>
          </div>
          <div v-if="detail.notes" class="mt-3">
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
import { ref, onMounted, computed } from 'vue';
import { useCashSessionStore } from '@/stores/cashSession';
import PaginationControls from '@/components/PaginationControls.vue';

const store = useCashSessionStore();

const sessions = computed(() => store.sessions);
const pagination = computed(() => store.pagination);
const loading = computed(() => store.loading);

const statusFilter = ref(null);
const statusOptions = [
  { title: 'الكل', value: null },
  { title: 'مفتوحة', value: 'open' },
  { title: 'مغلقة', value: 'closed' },
];

const detailOpen = ref(false);
const detail = ref(null);
const loadingId = ref(null);

const reload = async () => {
  const params = { page: pagination.value.page, limit: pagination.value.limit };
  if (statusFilter.value) params.status = statusFilter.value;
  await store.fetchList(params);
};

const onPageChange = async (page) => {
  const params = { page, limit: pagination.value.limit };
  if (statusFilter.value) params.status = statusFilter.value;
  await store.fetchList(params);
};

const onLimitChange = async (limit) => {
  const params = { page: 1, limit };
  if (statusFilter.value) params.status = statusFilter.value;
  await store.fetchList(params);
};

const openDetails = async (id) => {
  loadingId.value = id;
  try {
    detail.value = await store.fetchById(id);
    detailOpen.value = true;
  } finally {
    loadingId.value = null;
  }
};

const formatMoney = (v, cur = 'USD') => {
  const num = Number(v) || 0;
  if (cur === 'IQD') return `${Math.round(num).toLocaleString('en-US')} د.ع`;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

const varianceClass = (v) => {
  if (v === null || v === undefined) return '';
  const num = Number(v);
  if (Math.abs(num) < 0.0001) return 'text-success';
  return num > 0 ? 'text-info' : 'text-error';
};

onMounted(() => {
  reload();
});
</script>

<style scoped lang="scss">
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem 1.2rem;
  > div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    span {
      color: rgba(var(--v-theme-on-surface), 0.7);
    }
    b {
      font-variant-numeric: tabular-nums;
    }
  }
}
</style>
