<template>
  <v-data-table
    :headers="headers"
    :items="items"
    density="comfortable"
    class="report-table"
    hover
    :no-data-text="emptyText"
  />
</template>

<script setup>
defineProps({
  headers: { type: Array, required: true },
  items: { type: Array, required: true },
  emptyText: { type: String, default: 'لا توجد بيانات' },
});
</script>

<style scoped>
.report-table {
  background: transparent;
}
.report-table :deep(.v-table) {
  background: transparent;
}
</style>
