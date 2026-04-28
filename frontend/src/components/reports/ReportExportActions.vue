<template>
  <div class="export-actions d-flex flex-wrap ga-2">
    <v-btn
      color="primary"
      variant="tonal"
      :loading="loading"
      :disabled="loading"
      prepend-icon="mdi-refresh"
      @click="$emit('refresh')"
    >
      تحديث
    </v-btn>
    <v-btn
      color="success"
      variant="tonal"
      :loading="exportingExcel"
      :disabled="disabled || exportingExcel"
      prepend-icon="mdi-file-excel-outline"
      @click="$emit('export-excel')"
    >
      Excel
    </v-btn>
    <v-btn
      color="error"
      variant="tonal"
      :loading="exportingPdf"
      :disabled="disabled || exportingPdf"
      prepend-icon="mdi-file-pdf-box"
      @click="$emit('export-pdf')"
    >
      PDF
    </v-btn>
  </div>
</template>

<script setup>
defineProps({
  loading: Boolean,
  exportingExcel: Boolean,
  exportingPdf: Boolean,
  disabled: Boolean,
});

defineEmits(['refresh', 'export-excel', 'export-pdf', 'print']);
</script>

<style scoped>
.export-actions {
  align-items: center;
}
@media (max-width: 600px) {
  .export-actions {
    width: 100%;
  }
  .export-actions :deep(.v-btn) {
    flex: 1 1 calc(50% - 0.5rem);
  }
}
</style>
