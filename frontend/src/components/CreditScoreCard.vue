<template>
  <v-card v-if="customerId" class="credit-card mb-4" :class="cardClass" elevation="2" rounded="lg">
    <v-card-text class="pa-5">
      <!-- Header -->
      <div class="d-flex align-center justify-space-between mb-4">
        <div class="d-flex align-center ga-3">
          <div class="credit-icon-wrap" :class="`credit-icon-wrap--${tier}`">
            <v-icon size="20" color="white">mdi-chart-line-variant</v-icon>
          </div>
          <div>
            <div class="text-subtitle-1 font-weight-bold">التصنيف الائتماني</div>
            <div v-if="hasScore" class="text-caption text-medium-emphasis d-flex align-center ga-1 flex-wrap">
              <span>آخر تحديث: {{ formatDate(snapshot.creditScoreUpdatedAt) }}</span>
              <v-chip
                v-if="snapshot.modelSource"
                :color="snapshot.modelSource === 'onnx' ? 'info' : 'primary'"
                variant="outlined"
                label
                density="compact"
              >
                {{ snapshot.modelSource === 'onnx' ? 'ذكاء اصطناعي' : 'تقليدي' }}
              </v-chip>
            </div>
          </div>
        </div>
        <div class="d-flex align-center ga-2">
          <v-chip
            v-if="hasScore"
            :color="tierColor"
            size="small"
            variant="flat"
            class="font-weight-bold credit-chip"
          >
            <v-icon start size="14">{{ tierIcon }}</v-icon>
            {{ tierLabel }}
          </v-chip>
          <v-btn
            size="x-small"
            variant="text"
            icon="mdi-refresh"
            :loading="recalculating"
            :disabled="loading"
            :class="{ 'credit-spin': recalculating }"
            aria-label="تحديث التصنيف الائتماني"
            @click="recalculate"
          />
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="credit-loading text-center pa-6">
        <v-progress-circular indeterminate :size="40" :width="3" color="primary" />
        <div class="text-body-2 text-medium-emphasis mt-3">جاري تحميل البيانات...</div>
      </div>

      <!-- No snapshot -->
      <div v-else-if="!snapshot" class="credit-empty text-center pa-6">
        <v-icon size="48" color="grey-lighten-1" class="mb-3">mdi-account-credit-card-outline</v-icon>
        <div class="text-body-1 font-weight-medium mb-1">لا توجد بيانات ائتمانية</div>
        <div class="text-caption text-medium-emphasis">لم يتم تسجيل أي معاملات لهذا العميل بعد</div>
      </div>

      <!-- Not scored yet -->
      <div v-else-if="!hasScore" class="credit-pending text-center pa-6">
        <div class="credit-pending-icon mb-3">
          <v-icon size="36" color="primary">mdi-timer-sand</v-icon>
        </div>
        <div class="text-body-1 font-weight-medium mb-1">بانتظار الحساب</div>
        <div class="text-caption text-medium-emphasis mb-4">
          لم يتم حساب التصنيف الائتماني لهذا العميل بعد
        </div>
        <v-btn
          color="primary"
          size="small"
          variant="elevated"
          :loading="recalculating"
          prepend-icon="mdi-calculator-variant"
          rounded="pill"
          @click="recalculate"
        >
          احسب الآن
        </v-btn>
      </div>

      <!-- Scored -->
      <div v-else>
        <!-- Score gauge -->
        <div class="credit-gauge d-flex align-center ga-5 mb-4">
          <div class="credit-score-ring" :class="`credit-score-ring--${tier}`">
            <svg viewBox="0 0 80 80" class="credit-ring-svg">
              <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" stroke-width="6" opacity="0.12" />
              <circle
                cx="40" cy="40" r="34"
                fill="none"
                stroke="currentColor"
                stroke-width="6"
                stroke-linecap="round"
                :stroke-dasharray="ringCircumference"
                :stroke-dashoffset="ringOffset"
                class="credit-ring-progress"
              />
            </svg>
            <div class="credit-score-value">
              <span class="text-h5 font-weight-black">{{ snapshot.creditScore }}</span>
            </div>
          </div>

          <div class="flex-grow-1">
            <div class="d-flex align-center justify-space-between mb-1">
              <span class="text-caption text-medium-emphasis">الدرجة الائتمانية</span>
              <span class="text-caption font-weight-bold" :class="`text-${tierColor}`">
                {{ snapshot.creditScore }} / 100
              </span>
            </div>
            <v-progress-linear
              :model-value="snapshot.creditScore"
              :color="tierColor"
              height="8"
              rounded
              class="credit-bar"
            />

            <div v-if="hasValidLimit" class="mt-3">
              <div class="d-flex align-center justify-space-between mb-1">
                <span class="text-caption text-medium-emphasis">الحد الائتماني الموصى به</span>
              </div>
              <div class="text-h6 font-weight-bold">
                {{ formatCurrency(snapshot.recommendedLimit) }}
              </div>
            </div>
            <div v-else class="mt-3">
              <div class="text-caption text-medium-emphasis">
                <v-icon size="14" class="me-1">mdi-information-outline</v-icon>
                لم يتم تحديد حد ائتماني بعد
              </div>
            </div>
          </div>
        </div>

        <!-- Exceeds limit warning -->
        <v-alert
          v-if="exceedsLimit"
          type="warning"
          density="compact"
          variant="tonal"
          class="credit-alert"
          rounded="lg"
          role="alert"
        >
          <template #prepend>
            <v-icon size="20">mdi-alert-circle-outline</v-icon>
          </template>
          <div class="text-body-2">
            <strong>تنبيه:</strong>
            قيمة البيع
            <strong>{{ formatCurrency(saleTotal) }}</strong>
            تتجاوز الحد الموصى به
            <strong>{{ formatCurrency(snapshot.recommendedLimit) }}</strong>
          </div>
          <div class="text-caption text-medium-emphasis mt-1">
            يلزم صلاحية تجاوز الحد لإتمام هذا البيع
          </div>
        </v-alert>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

const props = defineProps({
  customerId: { type: [Number, String, null], default: null },
  saleTotal: { type: Number, default: 0 },
  currency: { type: String, default: 'IQD' },
});

const notify = useNotificationStore();

const snapshot = ref(null);
const loading = ref(false);
const recalculating = ref(false);

const unwrap = (res) => res?.data ?? res ?? null;

const fetchSnapshot = async (id) => {
  if (!id) {
    snapshot.value = null;
    return;
  }
  loading.value = true;
  try {
    const res = await api.get(`/customers/${id}/credit`);
    snapshot.value = unwrap(res);
  } catch {
    snapshot.value = null;
  } finally {
    loading.value = false;
  }
};

const recalculate = async () => {
  if (!props.customerId || recalculating.value) return;
  recalculating.value = true;
  try {
    await api.post(`/customers/${props.customerId}/credit/recalculate`);
    await fetchSnapshot(props.customerId);
    notify.success('تم تحديث التصنيف الائتماني');
  } catch (err) {
    console.error('credit recalc failed:', err);
  } finally {
    recalculating.value = false;
  }
};

watch(() => props.customerId, fetchSnapshot, { immediate: true });

const hasScore = computed(() => snapshot.value?.creditScore != null);

const tier = computed(() => {
  const s = snapshot.value?.creditScore;
  if (s == null) return 'unknown';
  if (s >= 85) return 'excellent';
  if (s >= 70) return 'good';
  if (s >= 50) return 'fair';
  return 'poor';
});

const tierColor = computed(() => {
  const colors = { excellent: 'success', good: 'info', fair: 'warning', poor: 'error' };
  return colors[tier.value] ?? 'grey';
});

const tierIcon = computed(() => {
  const icons = {
    excellent: 'mdi-shield-check',
    good: 'mdi-thumb-up',
    fair: 'mdi-alert-circle-outline',
    poor: 'mdi-shield-alert',
  };
  return icons[tier.value] ?? 'mdi-help-circle-outline';
});

const tierLabel = computed(() => {
  const labels = { excellent: 'ممتاز', good: 'جيد', fair: 'متوسط', poor: 'ضعيف' };
  return labels[tier.value] ?? 'غير محدد';
});

const cardClass = computed(() => {
  if (exceedsLimit.value) return 'credit-card--warn';
  if (hasScore.value) return `credit-card--${tier.value}`;
  return '';
});

// SVG ring calculations
const ringCircumference = computed(() => 2 * Math.PI * 34);
const ringOffset = computed(() => {
  const score = snapshot.value?.creditScore ?? 0;
  return ringCircumference.value * (1 - score / 100);
});

// limit = 0 means "not set" — don't treat it as a real limit
const hasValidLimit = computed(() => {
  const limit = snapshot.value?.recommendedLimit;
  return limit != null && Number(limit) > 0;
});

const exceedsLimit = computed(() => {
  if (!hasValidLimit.value) return false;
  return Number(props.saleTotal || 0) > Number(snapshot.value.recommendedLimit);
});

defineExpose({ exceedsLimit, snapshot, recalculate });

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

<style scoped>
.credit-card {
  border: 1px solid rgba(var(--v-border-color), 0.08);
  transition: box-shadow 0.3s ease, border-color 0.3s ease;
}
.credit-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08) !important;
}
.credit-card--warn {
  border-color: rgb(var(--v-theme-warning));
  border-width: 1.5px;
}

/* Icon badge */
.credit-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--v-theme-primary));
  transition: transform 0.2s ease;
}
.credit-icon-wrap:hover {
  transform: scale(1.08);
}
.credit-icon-wrap--excellent { background: rgb(var(--v-theme-success)); }
.credit-icon-wrap--good      { background: rgb(var(--v-theme-info)); }
.credit-icon-wrap--fair       { background: rgb(var(--v-theme-warning)); }
.credit-icon-wrap--poor       { background: rgb(var(--v-theme-error)); }

/* Chip */
.credit-chip {
  letter-spacing: 0.02em;
}

/* Score ring */
.credit-score-ring {
  position: relative;
  width: 80px;
  height: 80px;
  flex-shrink: 0;
  color: rgb(var(--v-theme-primary));
}
.credit-score-ring--excellent { color: rgb(var(--v-theme-success)); }
.credit-score-ring--good      { color: rgb(var(--v-theme-info)); }
.credit-score-ring--fair      { color: rgb(var(--v-theme-warning)); }
.credit-score-ring--poor      { color: rgb(var(--v-theme-error)); }

.credit-ring-svg {
  transform: rotate(-90deg);
  width: 100%;
  height: 100%;
}
.credit-ring-progress {
  transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}
.credit-score-value {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Progress bar */
.credit-bar {
  border-radius: 4px;
}

/* Alert */
.credit-alert {
  border-inline-start: 3px solid rgb(var(--v-theme-warning));
}

/* Loading animation */
.credit-loading,
.credit-empty,
.credit-pending {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* Pending pulse */
.credit-pending-icon {
  animation: credit-pulse 2s ease-in-out infinite;
}
@keyframes credit-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.6; transform: scale(0.92); }
}

/* Refresh spin */
.credit-spin .v-icon {
  animation: credit-rotate 1s linear infinite;
}
@keyframes credit-rotate {
  to { transform: rotate(360deg); }
}
</style>
