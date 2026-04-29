<template>
  <v-card>
    <v-card-title class="d-flex align-center justify-space-between bg-error text-white">
      <div class="d-flex align-center">
        <v-icon class="ml-2">mdi-message-alert</v-icon>
        <span>رسائل فشلت بالإرسال ({{ rows.length }})</span>
      </div>
      <v-btn
        size="small"
        variant="outlined"
        color="white"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="refresh"
      >
        تحديث
      </v-btn>
    </v-card-title>

    <v-card-text class="pa-0">
      <div v-if="loading && !rows.length" class="text-center pa-6">
        <v-progress-circular indeterminate color="error" size="40" />
      </div>

      <div
        v-else-if="!rows.length"
        class="text-center pa-6 text-medium-emphasis"
      >
        لا توجد رسائل فشلت أو معلقة.
      </div>

      <v-table v-else density="compact">
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>النوع</th>
            <th>المستلم</th>
            <th>الحالة</th>
            <th>المحاولات</th>
            <th>الخطأ</th>
            <th>إجراء</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ formatDate(row.createdAt) }}</td>
            <td>{{ typeLabel(row.type) }}</td>
            <td dir="ltr" class="text-mono">{{ row.recipientPhone }}</td>
            <td>
              <v-chip :color="statusColor(row.status)" size="x-small">
                {{ statusLabel(row.status) }}
              </v-chip>
            </td>
            <td>{{ row.attempts || 0 }} / {{ row.maxAttempts || 5 }}</td>
            <td class="text-error" style="max-width: 280px">
              <span class="text-caption">{{ row.error || '—' }}</span>
            </td>
            <td>
              <v-btn
                size="x-small"
                variant="text"
                color="primary"
                prepend-icon="mdi-replay"
                :loading="retryingId === row.id"
                :disabled="row.status === 'sent'"
                @click="retry(row)"
              >
                إعادة المحاولة
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

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
