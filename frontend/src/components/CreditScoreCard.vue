<template>
  <v-card v-if="customerId" class="mb-4" elevation="1" :color="cardColor" variant="tonal">
    <v-card-text class="pa-4">
      <div class="d-flex align-center justify-space-between mb-2">
        <div class="d-flex align-center ga-2">
          <v-icon :color="iconColor">mdi-chart-line</v-icon>
          <span class="text-subtitle-1 font-weight-medium">التصنيف الائتماني للعميل</span>
        </div>
        <v-chip v-if="snapshot" :color="iconColor" size="small" variant="flat">
          {{ tierLabel }}
        </v-chip>
      </div>

      <div v-if="loading" class="text-caption text-medium-emphasis">جاري تحميل البيانات...</div>

      <div v-else-if="!snapshot" class="text-caption text-medium-emphasis">
        لا توجد بيانات ائتمانية لهذا العميل بعد
      </div>

      <div v-else>
        <v-row dense>
          <v-col cols="6">
            <div class="text-caption text-medium-emphasis">الدرجة</div>
            <div class="text-h5 font-weight-bold" :class="`text-${iconColor}`">
              {{ snapshot.creditScore ?? '—' }} / 100
            </div>
          </v-col>
          <v-col cols="6">
            <div class="text-caption text-medium-emphasis">الحد الموصى به</div>
            <div class="text-h6 font-weight-bold">
              {{ formatCurrency(snapshot.recommendedLimit) }}
            </div>
          </v-col>
        </v-row>

        <v-progress-linear
          :model-value="snapshot.creditScore ?? 0"
          :color="iconColor"
          height="6"
          rounded
          class="mt-2"
        />

        <v-alert
          v-if="exceedsLimit"
          type="warning"
          density="compact"
          variant="tonal"
          class="mt-3"
          role="alert"
        >
          <template #prepend>
            <v-icon>mdi-alert-circle</v-icon>
          </template>
          قيمة البيع ({{ formatCurrency(saleTotal) }}) تتجاوز الحد الموصى به
          ({{ formatCurrency(snapshot.recommendedLimit) }}). يلزم صلاحية تجاوز الحد لإتمام البيع.
        </v-alert>

        <div
          v-if="snapshot.creditScoreUpdatedAt"
          class="text-caption text-medium-emphasis mt-2"
        >
          آخر تحديث: {{ formatDate(snapshot.creditScoreUpdatedAt) }}
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import api from '@/plugins/axios';

const props = defineProps({
  customerId: { type: [Number, String, null], default: null },
  saleTotal: { type: Number, default: 0 },
  currency: { type: String, default: 'IQD' },
});

const snapshot = ref(null);
const loading = ref(false);

const fetchSnapshot = async (id) => {
  if (!id) {
    snapshot.value = null;
    return;
  }
  loading.value = true;
  try {
    const res = await api.get(`/customers/${id}/credit`);
    snapshot.value = res?.data || res?.data?.data || null;
  } catch {
    snapshot.value = null;
  } finally {
    loading.value = false;
  }
};

watch(() => props.customerId, fetchSnapshot, { immediate: true });

const tier = computed(() => {
  const s = snapshot.value?.creditScore;
  if (s == null) return 'unknown';
  if (s >= 85) return 'excellent';
  if (s >= 70) return 'good';
  if (s >= 50) return 'fair';
  return 'poor';
});

const iconColor = computed(() => {
  switch (tier.value) {
    case 'excellent':
      return 'success';
    case 'good':
      return 'primary';
    case 'fair':
      return 'warning';
    case 'poor':
      return 'error';
    default:
      return 'grey';
  }
});

const cardColor = computed(() => (exceedsLimit.value ? 'warning' : undefined));

const tierLabel = computed(() => {
  switch (tier.value) {
    case 'excellent':
      return 'ممتاز';
    case 'good':
      return 'جيد';
    case 'fair':
      return 'متوسط';
    case 'poor':
      return 'ضعيف';
    default:
      return 'غير محدد';
  }
});

const exceedsLimit = computed(() => {
  const limit = snapshot.value?.recommendedLimit;
  if (limit == null) return false;
  return Number(props.saleTotal || 0) > Number(limit);
});

defineExpose({ exceedsLimit, snapshot });

const formatCurrency = (amount) =>
  new Intl.NumberFormat('ar', {
    style: 'currency',
    currency: props.currency || 'IQD',
    maximumFractionDigits: props.currency === 'USD' ? 2 : 0,
  }).format(Number(amount) || 0);

const formatDate = (ts) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('ar');
  } catch {
    return String(ts);
  }
};
</script>
