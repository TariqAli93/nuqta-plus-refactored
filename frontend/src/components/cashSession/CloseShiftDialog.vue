<template>
  <v-dialog v-model="dialog" max-width="520" persistent>
    <v-card class="bg-surface-soft rounded-lg">
      <v-card-title class="d-flex align-center gap-2">
        <v-icon color="warning">mdi-cash-lock</v-icon>
        <span>إغلاق الوردية</span>
      </v-card-title>
      <v-divider />
      <v-card-text class="pt-4">
        <div class="shift-summary">
          <div class="row">
            <span class="label">النقد الافتتاحي</span>
            <span class="value">{{ formatCurrency(session?.openingCash, currency) }}</span>
          </div>
          <div class="row">
            <span class="label">النقد الوارد (بيع)</span>
            <span class="value">{{ formatCurrency(session?.cashIn, currency) }}</span>
          </div>
          <div v-if="(session?.cashOut || 0) > 0" class="row">
            <span class="label">المرتجعات النقدية</span>
            <span class="value">− {{ formatCurrency(session?.cashOut, currency) }}</span>
          </div>
          <div class="row row--strong">
            <span class="label">المتوقع</span>
            <span class="value">{{ formatCurrency(session?.expectedCash, currency) }}</span>
          </div>
        </div>

        <v-divider class="my-3" />

        <v-text-field
          v-model.number="closingCash"
          label="النقد المعدود"
          type="number"
          min="0"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
          autofocus
          :error-messages="error ? [error] : []"
          @keyup.enter="onConfirm"
        />

        <v-textarea
          v-model="notes"
          label="ملاحظات (اختياري)"
          rows="2"
          auto-grow
          variant="outlined"
          density="comfortable"
          hide-details
          class="mt-3"
        />

        <div
          v-if="closingCash !== '' && Number.isFinite(Number(closingCash))"
          class="variance"
          :class="varianceClass"
        >
          <v-icon size="18">{{ varianceIcon }}</v-icon>
          <span class="variance__label">الفرق</span>
          <span class="variance__value">{{ formatCurrency(variance, currency) }}</span>
        </div>
      </v-card-text>
      <v-divider />
      <v-card-actions class="justify-end gap-2 pa-3">
        <v-btn variant="outlined" :disabled="loading" @click="onCancel">
          إلغاء
        </v-btn>
        <v-btn
          color="warning"
          variant="elevated"
          :loading="loading"
          :disabled="!isValid"
          @click="onConfirm"
        >
          إغلاق الوردية
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  session: { type: Object, default: null },
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel']);

const dialog = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const closingCash = ref('');
const notes = ref('');
const error = ref('');

const currency = computed(() => props.session?.currency || 'USD');

const variance = computed(() => {
  const counted = Number(closingCash.value);
  if (!Number.isFinite(counted)) return 0;
  return counted - Number(props.session?.expectedCash || 0);
});

const varianceClass = computed(() => {
  const v = variance.value;
  if (Math.abs(v) < 0.0001) return 'variance--ok';
  return v > 0 ? 'variance--over' : 'variance--short';
});

const varianceIcon = computed(() => {
  const v = variance.value;
  if (Math.abs(v) < 0.0001) return 'mdi-check-circle-outline';
  return v > 0 ? 'mdi-arrow-up-bold-circle-outline' : 'mdi-arrow-down-bold-circle-outline';
});

const isValid = computed(() => {
  const n = Number(closingCash.value);
  return Number.isFinite(n) && n >= 0;
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      closingCash.value = '';
      notes.value = '';
      error.value = '';
    }
  }
);

const formatCurrency = (val, cur = 'USD') => {
  const num = Number(val) || 0;
  if (cur === 'IQD') return `${num.toLocaleString('en-US')} د.ع`;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const onConfirm = () => {
  if (!isValid.value) {
    error.value = 'أدخل مبلغ صحيح';
    return;
  }
  emit('confirm', {
    closingCash: Number(closingCash.value) || 0,
    notes: notes.value?.trim() || null,
  });
};

const onCancel = () => {
  emit('cancel');
  dialog.value = false;
};
</script>

<style scoped lang="scss">
.shift-summary {
  display: grid;
  gap: 0.4rem;
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.95rem;
    .label {
      color: rgba(var(--v-theme-on-surface), 0.7);
    }
    &--strong {
      font-weight: 700;
      .label,
      .value {
        font-size: 1.05rem;
      }
    }
  }
}

.variance {
  margin-top: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  border-radius: 0.5rem;
  font-weight: 600;

  &__label {
    flex: 1;
  }
  &__value {
    font-variant-numeric: tabular-nums;
  }

  &--ok {
    background: rgba(var(--v-theme-success), 0.12);
    color: rgb(var(--v-theme-success));
  }
  &--over {
    background: rgba(var(--v-theme-info), 0.12);
    color: rgb(var(--v-theme-info));
  }
  &--short {
    background: rgba(var(--v-theme-error), 0.12);
    color: rgb(var(--v-theme-error));
  }
}
</style>
