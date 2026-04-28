<template>
  <v-card rounded="xl" elevation="0" class="chart-card h-100">
    <v-card-title class="d-flex align-center ga-2 px-4 pt-4 pb-2">
      <v-icon v-if="icon" color="primary" size="20">{{ icon }}</v-icon>
      <span class="text-subtitle-1 font-weight-bold">{{ title }}</span>
      <v-spacer />
      <slot name="actions" />
    </v-card-title>

    <v-divider />

    <v-card-text class="pa-3">
      <div v-if="hasData" class="chart-wrapper">
        <slot />
      </div>
      <div v-else class="chart-empty">
        <v-icon size="48" class="mb-2 text-medium-emphasis">
          mdi-chart-bell-curve-cumulative
        </v-icon>
        <div class="text-body-2 text-medium-emphasis">
          {{ emptyMessage }}
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  icon: { type: String, default: '' },
  hasData: { type: Boolean, default: true },
  emptyMessage: { type: String, default: 'لا توجد بيانات للعرض' },
});
</script>

<style scoped>
.chart-card {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.chart-wrapper {
  width: 100%;
}
.chart-empty {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 1rem;
}
</style>
