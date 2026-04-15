<template>
  <div class="table-skeleton">
    <div v-for="row in rows" :key="row" class="skeleton-row">
      <div
        v-for="col in columns"
        :key="col"
        class="skeleton-cell"
        :style="{ width: colWidths[col - 1] || '100%' }"
      >
        <v-skeleton-loader type="text" :width="colWidths[col - 1] || '100%'" />
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  rows: {
    type: Number,
    default: 5,
  },
  columns: {
    type: Number,
    default: 5,
  },
  colWidths: {
    type: Array,
    default: () => [],
  },
});
</script>

<style scoped lang="scss">
.table-skeleton {
  width: 100%;
}

.skeleton-row {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid rgb(var(--v-theme-surface-variant));
}

.skeleton-cell {
  flex: 1;
  min-width: 0;
}

:deep(.v-skeleton-loader__text) {
  height: 20px;
}
</style>
