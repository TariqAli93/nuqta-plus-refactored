<template>
  <v-card rounded="xl" elevation="0" class="report-filters mb-4">
    <v-card-text class="pa-4 pa-sm-5">
      <div class="filters-header d-flex align-center justify-space-between mb-3">
        <div class="d-flex align-center ga-2">
          <v-icon color="primary">mdi-filter-variant</v-icon>
          <span class="text-subtitle-1 font-weight-bold">الفلاتر</span>
        </div>
        <v-btn
          variant="text"
          color="primary"
          size="small"
          prepend-icon="mdi-close-circle-outline"
          @click="clearAll"
        >
          مسح الفلاتر
        </v-btn>
      </div>

      <v-row dense>
        <v-col cols="12" sm="6" md="3">
          <v-select
            v-model="model.period"
            :items="periodOptions"
            label="الفترة"
            density="comfortable"
            variant="outlined"
            hide-details
            prepend-inner-icon="mdi-calendar-range"
            @update:model-value="onPresetChange"
          />
        </v-col>
        <v-col cols="6" sm="6" md="2">
          <v-text-field
            v-model="model.dateFrom"
            type="date"
            label="من تاريخ"
            density="comfortable"
            variant="outlined"
            hide-details
            :disabled="model.period !== 'custom'"
          />
        </v-col>
        <v-col cols="6" sm="6" md="2">
          <v-text-field
            v-model="model.dateTo"
            type="date"
            label="إلى تاريخ"
            density="comfortable"
            variant="outlined"
            hide-details
            :disabled="model.period !== 'custom'"
          />
        </v-col>
        <v-col cols="6" sm="6" md="2">
          <v-select
            v-model="model.currency"
            :items="currencyOptions"
            label="العملة"
            density="comfortable"
            variant="outlined"
            hide-details
            prepend-inner-icon="mdi-cash"
          />
        </v-col>
        <v-col v-if="showBranchFilter" cols="6" sm="6" md="2">
          <v-select
            v-model="model.branchId"
            :items="branchOptions"
            label="الفرع"
            density="comfortable"
            variant="outlined"
            clearable
            hide-details
            prepend-inner-icon="mdi-source-branch"
          />
        </v-col>
        <v-col cols="12" :md="showBranchFilter ? 1 : 3" class="d-flex align-stretch">
          <v-btn
            block
            color="primary"
            variant="flat"
            size="large"
            :loading="loading"
            prepend-icon="mdi-check"
            @click="$emit('apply')"
          >
            تطبيق
          </v-btn>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
  branches: {
    type: Array,
    default: () => [],
  },
  availableCurrencies: {
    type: Array,
    default: () => ['USD', 'IQD'],
  },
  showBranchFilter: Boolean,
  loading: Boolean,
});

const emit = defineEmits(['update:modelValue', 'apply', 'preset-change', 'clear']);

const model = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const periodOptions = [
  { title: 'اليوم', value: 'today' },
  { title: 'أمس', value: 'yesterday' },
  { title: 'هذا الأسبوع', value: 'this_week' },
  { title: 'هذا الشهر', value: 'this_month' },
  { title: 'هذه السنة', value: 'this_year' },
  { title: 'مخصص', value: 'custom' },
];

const currencyOptions = computed(() => [
  { title: 'كل العملات', value: 'ALL' },
  ...props.availableCurrencies.map((c) => ({ title: c, value: c })),
]);

const branchOptions = computed(() => [
  { title: 'كل الفروع', value: null },
  ...props.branches.map((b) => ({ title: b.name, value: b.id })),
]);

function onPresetChange(value) {
  emit('preset-change', value);
}

function clearAll() {
  emit('clear');
}
</script>

<style scoped>
.report-filters {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
</style>
