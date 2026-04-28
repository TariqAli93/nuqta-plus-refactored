<template>
  <v-card
    rounded="xl"
    elevation="0"
    class="kpi-card pa-4 h-100"
    :class="{ 'kpi-card--unavailable': unavailable }"
  >
    <div class="d-flex align-start justify-space-between mb-2">
      <div class="kpi-icon" :style="iconBg">
        <v-icon :color="color" size="22">{{ icon }}</v-icon>
      </div>
      <v-tooltip v-if="warning" location="top">
        <template #activator="{ props: tooltipProps }">
          <v-icon
            v-bind="tooltipProps"
            color="warning"
            size="18"
            class="warning-badge"
          >
            mdi-alert-outline
          </v-icon>
        </template>
        <span>{{ warning }}</span>
      </v-tooltip>
    </div>

    <div class="text-caption text-medium-emphasis mb-1">{{ label }}</div>
    <div class="kpi-value text-h6 font-weight-bold">{{ value }}</div>
    <div v-if="note" class="text-caption text-medium-emphasis mt-1">
      {{ note }}
    </div>
  </v-card>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: '0' },
  icon: { type: String, default: 'mdi-chart-box-outline' },
  color: { type: String, default: 'primary' },
  note: { type: String, default: '' },
  warning: { type: String, default: '' },
  unavailable: { type: Boolean, default: false },
});

const iconBg = computed(() => ({
  background: `rgba(var(--v-theme-${props.color}), 0.12)`,
}));
</script>

<style scoped lang="scss">
.kpi-card {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  transition: border-color 0.2s ease, transform 0.2s ease;
}
.kpi-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
}
.kpi-card--unavailable .kpi-value {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-weight: 500;
}

.kpi-icon {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
}

.kpi-value {
  word-break: break-word;
}

.warning-badge {
  flex-shrink: 0;
}
</style>
