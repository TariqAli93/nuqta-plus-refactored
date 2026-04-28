<template>
  <v-card rounded="xl" class="report-header mb-4" elevation="0">
    <v-card-text class="pa-4 pa-sm-5">
      <div class="header-row">
        <div class="header-titles">
          <div class="d-flex align-center ga-3 flex-wrap">
            <div class="header-icon">
              <v-icon size="28" color="primary">mdi-file-chart-outline</v-icon>
            </div>
            <div>
              <h1 class="text-h5 font-weight-bold mb-1">التقارير المحاسبية</h1>
              <div class="text-body-2 text-medium-emphasis">
                لوحة تفاعلية موحّدة للمبيعات والتحصيل والمخزون والديون
              </div>
            </div>
          </div>

          <div class="meta-chips mt-3 d-flex flex-wrap ga-2">
            <v-chip
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-calendar-range"
            >
              {{ formattedDateRange }}
            </v-chip>
            <v-chip
              size="small"
              variant="tonal"
              color="info"
              prepend-icon="mdi-source-branch"
            >
              {{ branchLabel }}
            </v-chip>
            <v-chip
              size="small"
              variant="tonal"
              color="success"
              prepend-icon="mdi-cash-multiple"
            >
              {{ currencyLabel }}
            </v-chip>
            <v-chip
              v-if="generatedAt"
              size="small"
              variant="text"
              prepend-icon="mdi-clock-outline"
            >
              {{ formattedGeneratedAt }}
            </v-chip>
          </div>
        </div>

        <ReportExportActions
          :loading="loading"
          :exporting-excel="exportingExcel"
          :exporting-pdf="exportingPdf"
          :disabled="!hasData"
          @refresh="$emit('refresh')"
          @export-excel="$emit('export-excel')"
          @export-pdf="$emit('export-pdf')"
          @print="$emit('print')"
        />
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed } from 'vue';
import ReportExportActions from './ReportExportActions.vue';

const props = defineProps({
  dateFrom: { type: String, default: '' },
  dateTo: { type: String, default: '' },
  currency: { type: String, default: 'ALL' },
  branchLabel: { type: String, default: 'كل الفروع' },
  generatedAt: { type: String, default: '' },
  loading: Boolean,
  exportingExcel: Boolean,
  exportingPdf: Boolean,
  hasData: Boolean,
});

defineEmits(['refresh', 'export-excel', 'export-pdf', 'print']);

const formatDate = (s) => {
  if (!s) return '—';
  try {
    return new Intl.DateTimeFormat('ar-IQ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(s));
  } catch {
    return s;
  }
};

const formattedDateRange = computed(() => {
  if (!props.dateFrom && !props.dateTo) return 'كل الفترات';
  return `${formatDate(props.dateFrom)} — ${formatDate(props.dateTo)}`;
});

const currencyLabel = computed(() =>
  props.currency === 'ALL' ? 'كل العملات' : props.currency,
);

const formattedGeneratedAt = computed(() => {
  if (!props.generatedAt) return '';
  try {
    return new Intl.DateTimeFormat('ar-IQ', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    }).format(new Date(props.generatedAt));
  } catch {
    return '';
  }
});
</script>

<style scoped lang="scss">
.report-header {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: linear-gradient(
    180deg,
    rgba(var(--v-theme-primary), 0.04) 0%,
    rgba(var(--v-theme-surface), 1) 100%
  );
}

.header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.header-titles {
  flex: 1 1 320px;
  min-width: 0;
}

.header-icon {
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.1);
}

@media (max-width: 600px) {
  .header-row {
    flex-direction: column;
  }
}
</style>
