<template>
  <v-card class="page-section">
    <div class="section-title">
      <span class="section-title__label">
        <v-icon size="20" color="error">mdi-message-alert</v-icon>
        <span>رسائل فشلت بالإرسال ({{ rows.length }})</span>
      </span>
      <span class="section-title__actions">
        <v-btn
          size="small"
          variant="text"
          color="primary"
          prepend-icon="mdi-refresh"
          :loading="loading"
          @click="refresh"
        >
          تحديث
        </v-btn>
      </span>
    </div>

    <v-data-table
      :headers="headers"
      :items="rows"
      :loading="loading"
      density="comfortable"
      hide-default-footer
      items-per-page="50"
    >
      <template #loading>
        <TableSkeleton :rows="3" :columns="headers.length" />
      </template>
      <template #no-data>
        <EmptyState
          title="لا توجد رسائل فشلت أو معلقة"
          description="ستظهر هنا الرسائل التي فشلت بالإرسال أو علقت في قائمة الانتظار."
          icon="mdi-message-check-outline"
          icon-color="success"
          compact
        />
      </template>
      <template #[`item.createdAt`]="{ item }">
        {{ formatDate(item.createdAt) }}
      </template>
      <template #[`item.type`]="{ item }">
        {{ typeLabel(item.type) }}
      </template>
      <template #[`item.recipientPhone`]="{ item }">
        <span dir="ltr" class="text-mono">{{ item.recipientPhone }}</span>
      </template>
      <template #[`item.status`]="{ item }">
        <v-chip :color="statusColor(item.status)" variant="tonal" size="small">
          {{ statusLabel(item.status) }}
        </v-chip>
      </template>
      <template #[`item.attempts`]="{ item }">
        {{ item.attempts || 0 }} / {{ item.maxAttempts || 5 }}
      </template>
      <template #[`item.error`]="{ item }">
        <span class="text-caption text-error">{{ item.error || '—' }}</span>
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn
          size="small"
          variant="text"
          color="primary"
          prepend-icon="mdi-replay"
          :loading="retryingId === item.id"
          :disabled="item.status === 'sent'"
          @click="retry(item)"
        >
          إعادة المحاولة
        </v-btn>
      </template>
    </v-data-table>
  </v-card>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';
import EmptyState from '@/components/EmptyState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';

const headers = [
  { title: 'التاريخ', key: 'createdAt' },
  { title: 'النوع', key: 'type' },
  { title: 'المستلم', key: 'recipientPhone' },
  { title: 'الحالة', key: 'status' },
  { title: 'المحاولات', key: 'attempts' },
  { title: 'الخطأ', key: 'error' },
  { title: 'إجراء', key: 'actions', sortable: false },
];

// "Stuck" = stayed in `processing` status for longer than this. Matches the
// queue worker's PROCESSING_LOCK_TIMEOUT_MS — anything older has effectively
// been abandoned and should be replayable.
const STUCK_AFTER_MS = 60_000;

const notificationStore = useNotificationStore();
const failed = ref([]);
const processing = ref([]);
const loading = ref(false);
const retryingId = ref(null);

const rows = computed(() => {
  const cutoff = Date.now() - STUCK_AFTER_MS;
  const stuck = processing.value.filter((r) => {
    const t = new Date(r.updatedAt || r.createdAt).getTime();
    return Number.isFinite(t) && t < cutoff;
  });
  return [...failed.value, ...stuck].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
});

async function fetchByStatus(status) {
  const res = await api.get('/notifications', { params: { status, limit: 50 } });
  return Array.isArray(res?.data) ? res.data : [];
}

async function refresh() {
  loading.value = true;
  try {
    const [f, p] = await Promise.all([
      fetchByStatus('failed'),
      fetchByStatus('processing'),
    ]);
    failed.value = f;
    processing.value = p;
  } catch (err) {
    notificationStore.error(err.response?.data?.message || 'تعذر تحميل الرسائل الفاشلة');
  } finally {
    loading.value = false;
  }
}

async function retry(row) {
  retryingId.value = row.id;
  try {
    await api.post(`/notifications/${row.id}/retry`);
    notificationStore.success('سيتم إعادة محاولة الإرسال');
    await refresh();
  } catch (err) {
    notificationStore.error(err.response?.data?.message || 'تعذر إعادة المحاولة');
  } finally {
    retryingId.value = null;
  }
}

function statusColor(status) {
  switch (status) {
    case 'failed':
      return 'error';
    case 'processing':
      return 'warning';
    case 'pending':
      return 'info';
    case 'sent':
      return 'success';
    case 'cancelled':
      return 'grey';
    default:
      return 'grey';
  }
}

function statusLabel(status) {
  switch (status) {
    case 'failed':
      return 'فشل';
    case 'processing':
      return 'عالق';
    case 'pending':
      return 'بالانتظار';
    case 'sent':
      return 'تم الإرسال';
    case 'cancelled':
      return 'ملغي';
    default:
      return status;
  }
}

function typeLabel(type) {
  switch (type) {
    case 'overdue_reminder':
      return 'تذكير قسط متأخر';
    case 'payment_confirmation':
      return 'تأكيد دفعة';
    case 'customer_message':
      return 'رسالة عميل';
    case 'bulk_message':
      return 'رسالة جماعية';
    default:
      return type || '—';
  }
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

onMounted(refresh);
</script>
