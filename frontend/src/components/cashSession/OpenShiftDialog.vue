<template>
  <v-dialog v-model="dialog" max-width="460">
    <v-card class="bg-surface-soft rounded-lg">
      <v-card-title class="d-flex align-center gap-2">
        <v-icon color="primary">mdi-cash-register</v-icon>
        <span>فتح وردية</span>
      </v-card-title>
      <v-divider />
      <v-card-text class="pt-4">
        <p class="text-body-2 text-medium-emphasis mb-3">
          أدخل المبلغ النقدي الموجود في الدُرج عند بداية الوردية.
        </p>
        <v-text-field
          v-model.number="openingCash"
          label="النقد الافتتاحي"
          type="number"
          min="0"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
          autofocus
          :error-messages="error ? [error] : []"
          @keyup.enter="onConfirm"
        />
        <v-select
          v-model="currency"
          :items="currencies"
          label="العملة"
          variant="outlined"
          density="comfortable"
          hide-details
          class="mt-3"
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
      </v-card-text>
      <v-divider />
      <v-card-actions class="justify-end gap-2 pa-3">
        <v-btn variant="outlined" :disabled="loading || !cancelable" @click="onCancel">
          إلغاء
        </v-btn>
        <v-btn
          color="primary"
          variant="elevated"
          :loading="loading"
          :disabled="!isValid"
          @click="onConfirm"
        >
          فتح الوردية
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
  defaultCurrency: { type: String, default: 'USD' },
  cancelable: { type: Boolean, default: true },
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel']);

const dialog = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const openingCash = ref(0);
const currency = ref(props.defaultCurrency);
const notes = ref('');
const error = ref('');
const currencies = [
  { title: 'USD', value: 'USD' },
  { title: 'IQD', value: 'IQD' },
];

const isValid = computed(
  () => Number.isFinite(Number(openingCash.value)) && Number(openingCash.value) >= 0
);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      openingCash.value = 0;
      currency.value = props.defaultCurrency;
      notes.value = '';
      error.value = '';
    }
  }
);

const onConfirm = () => {
  if (!isValid.value) {
    error.value = 'يجب إدخال مبلغ صفر أو أكثر';
    return;
  }
  emit('confirm', {
    openingCash: Number(openingCash.value) || 0,
    currency: currency.value,
    notes: notes.value?.trim() || null,
  });
};

const onCancel = () => {
  if (!props.cancelable) return;
  emit('cancel');
  dialog.value = false;
};
</script>
