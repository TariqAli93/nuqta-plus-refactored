<template>
  <v-card variant="outlined" class="mb-4 aging-panel">
    <v-card-title class="d-flex align-center justify-space-between flex-wrap ga-2">
      <span class="text-subtitle-1 font-weight-bold">
        أعمار الديون (الأقساط المتأخرة)
      </span>
      <v-chip v-if="data?.asOf" size="small" variant="tonal">
        كما في {{ data.asOf }}
      </v-chip>
    </v-card-title>
    <v-card-text>
      <div v-if="loading" class="text-center py-4">
        <v-progress-circular indeterminate size="28" />
      </div>
      <div v-else-if="!data" class="text-medium-emphasis text-center py-4">
        لا توجد بيانات.
      </div>
      <template v-else>
        <v-row dense>
          <v-col v-for="b in buckets" :key="b.key" cols="6" sm="3">
            <v-card variant="tonal" :color="b.color">
              <v-card-text class="text-center">
                <div class="text-caption">{{ b.label }}</div>
                <div class="text-h6 font-weight-bold">
                  {{ moneyFmt(data.buckets?.[b.key]) }}
                </div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
        <v-divider class="my-3" />
        <div class="d-flex flex-wrap align-center justify-space-between ga-2">
          <div class="text-body-2">
            <strong>إجمالي المتأخر:</strong>
            {{ moneyFmt(data.totalOutstanding) }}
          </div>
          <div v-if="data.byCurrency" class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="(v, cur) in data.byCurrency"
              :key="cur"
              size="small"
              variant="outlined"
            >
              {{ cur }}: {{ moneyFmt(v.totalOutstanding) }}
            </v-chip>
          </div>
        </div>
      </template>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  data: { type: Object, default: null },
  loading: { type: Boolean, default: false },
});

const buckets = computed(() => [
  { key: '0_7', label: '0–7 يوم', color: 'success' },
  { key: '8_30', label: '8–30 يوم', color: 'info' },
  { key: '31_60', label: '31–60 يوم', color: 'warning' },
  { key: '61_plus', label: '61+ يوم', color: 'error' },
]);

function moneyFmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
// Silence unused-prop warning
void props;
</script>

<style scoped>
.aging-panel { direction: rtl; }
</style>
