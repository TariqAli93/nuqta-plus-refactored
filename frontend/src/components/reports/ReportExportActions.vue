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
      :disabled="exportDisabled || exportingExcel"
      prepend-icon="mdi-file-excel-outline"
      @click="onExportExcel"
    >
      Excel
    </v-btn>
    <v-btn
      color="error"
      variant="tonal"
      :loading="exportingPdf"
      :disabled="exportDisabled || exportingPdf"
      prepend-icon="mdi-file-pdf-box"
      @click="onExportPdf"
    >
      PDF
    </v-btn>

    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      :timeout="3500"
      location="top"
    >
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { buildExportRows, totalRowCount } from '@/utils/reportExport.js';
import { exportToExcel, exportToPdf, NO_DATA } from '@/utils/reportExporters.js';

const props = defineProps({
  report: { type: Object, default: null },
  reportType: { type: String, default: 'dashboard' },
  dateFrom: { type: String, default: '' },
  dateTo: { type: String, default: '' },
  currency: { type: String, default: 'ALL' },
  branchLabel: { type: String, default: 'كل الفروع' },
  userName: { type: String, default: '' },
  generatedAt: { type: String, default: '' },
  canViewProfit: { type: Boolean, default: true },
  loading: Boolean,
});

defineEmits(['refresh']);

const exportingExcel = ref(false);
const exportingPdf = ref(false);
const snackbar = ref({ show: false, color: 'success', text: '' });

const notify = (text, color = 'success') => {
  snackbar.value = { show: true, color, text };
};

// Build export-ready rows from the (reactive) report. buildExportRows maps the
// data into brand-new plain objects, so we never hand a reactive proxy to the
// xlsx/jsPDF writers.
const built = computed(() =>
  buildExportRows(props.reportType, props.report, {
    canViewProfit: props.canViewProfit,
    dateFrom: props.dateFrom,
    dateTo: props.dateTo,
    currency: props.currency,
    branchLabel: props.branchLabel,
    userName: props.userName,
    generatedAt: props.generatedAt,
  }),
);

const rowCount = computed(() => totalRowCount(built.value));
const exportDisabled = computed(() => props.loading || !props.report || rowCount.value === 0);

const buildFilename = (ext) => {
  const range = [props.dateFrom, props.dateTo].filter(Boolean).join('_');
  const base = range ? `التقرير-المحاسبي-${range}` : 'التقرير-المحاسبي';
  return `${base}.${ext}`;
};

// Pre-export inspection (stripped from production builds).
const inspect = () => {
  if (!import.meta.env.DEV) return;
  const b = built.value;
  console.debug('[report-export]', {
    reportType: b.reportType,
    sections: b.sections.map((s) => ({ id: s.id, rows: s.rows.length })),
    totalRows: rowCount.value,
    firstRow: b.sections[0]?.rows[0],
  });
};

async function onExportExcel() {
  if (rowCount.value === 0) {
    notify(NO_DATA, 'warning');
    return;
  }
  exportingExcel.value = true;
  try {
    inspect();
    await exportToExcel(built.value, buildFilename('xlsx'));
    notify('تم تصدير ملف Excel بنجاح');
  } catch (err) {
    const msg = err?.message === NO_DATA ? NO_DATA : 'تعذر تصدير التقرير، حاول مرة أخرى.';
    notify(msg, 'error');
  } finally {
    exportingExcel.value = false;
  }
}

async function onExportPdf() {
  if (rowCount.value === 0) {
    notify(NO_DATA, 'warning');
    return;
  }
  exportingPdf.value = true;
  try {
    inspect();
    await exportToPdf(built.value, buildFilename('pdf'));
    notify('تم تصدير ملف PDF بنجاح');
  } catch (err) {
    const msg = err?.message === NO_DATA ? NO_DATA : 'تعذر تصدير التقرير، حاول مرة أخرى.';
    notify(msg, 'error');
  } finally {
    exportingPdf.value = false;
  }
}
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
