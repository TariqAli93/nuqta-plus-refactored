<template>
  <v-dialog
    v-model="dialog"
    :max-width="maxWidth"
    :persistent="persistent"
    role="alertdialog"
    :aria-labelledby="titleId"
    :aria-describedby="messageId"
    @update:model-value="onUpdate"
  >
    <v-card>
      <v-card-title
        :id="titleId"
        :class="['text-white', `bg-${type}`]"
        class="d-flex align-center gap-2"
      >
        <v-icon>{{ typeIcon }}</v-icon>
        {{ title }}
      </v-card-title>

      <v-divider></v-divider>

      <v-card-text class="pt-4">
        <p :id="messageId" class="text-body-1 mb-2">{{ message }}</p>
        <p v-if="details" class="text-body-2 text-medium-emphasis">{{ details }}</p>
        <div v-if="showInput" class="mt-4">
          <v-text-field
            v-model="inputValue"
            :label="inputLabel"
            :type="inputType"
            :rules="inputRules"
            variant="outlined"
            density="comfortable"
            autofocus
            @keyup.enter="handleConfirm"
          />
        </div>
      </v-card-text>

      <v-divider></v-divider>

      <v-card-actions class="justify-end gap-2 pa-3">
        <v-btn variant="outlined" size="default" :aria-label="cancelLabel" @click="handleCancel">
          {{ cancelText }}
        </v-btn>
        <v-btn
          :color="type"
          variant="elevated"
          size="default"
          :loading="loading"
          :disabled="showInput && !isInputValid"
          :aria-label="confirmLabel"
          @click="handleConfirm"
        >
          {{ confirmText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, watch, onMounted, onUnmounted } from 'vue';
import { focusFirstElement, trapFocus } from '@/utils/accessibility';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: 'تأكيد',
  },
  message: {
    type: String,
    required: true,
  },
  details: {
    type: String,
    default: '',
  },
  type: {
    type: String,
    default: 'warning', // warning, error, info
    validator: (value) => ['warning', 'error', 'info', 'success'].includes(value),
  },
  confirmText: {
    type: String,
    default: 'تأكيد',
  },
  cancelText: {
    type: String,
    default: 'إلغاء',
  },
  maxWidth: {
    type: [String, Number],
    default: 500,
  },
  persistent: {
    type: Boolean,
    default: false,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  showInput: {
    type: Boolean,
    default: false,
  },
  inputLabel: {
    type: String,
    default: 'أدخل القيمة',
  },
  inputType: {
    type: String,
    default: 'text',
  },
  inputRules: {
    type: Array,
    default: () => [],
  },
  inputValue: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel', 'update:inputValue']);

const dialog = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const inputValue = computed({
  get: () => props.inputValue,
  set: (value) => emit('update:inputValue', value),
});

const titleId = `confirm-dialog-title-${Math.random().toString(36).substr(2, 9)}`;
const messageId = `confirm-dialog-message-${Math.random().toString(36).substr(2, 9)}`;

const typeIcon = computed(() => {
  const icons = {
    warning: 'mdi-alert',
    error: 'mdi-alert-circle',
    info: 'mdi-information',
    success: 'mdi-check-circle',
  };
  return icons[props.type] || 'mdi-alert';
});

const isInputValid = computed(() => {
  if (!props.showInput || !props.inputRules.length) return true;
  return props.inputRules.every((rule) => {
    const result = rule(inputValue.value);
    return result === true;
  });
});

const confirmLabel = computed(() => `تأكيد: ${props.confirmText}`);
const cancelLabel = computed(() => `إلغاء: ${props.cancelText}`);

const handleConfirm = () => {
  if (props.showInput && !isInputValid.value) return;
  emit('confirm', inputValue.value);
  dialog.value = false;
};

const handleCancel = () => {
  emit('cancel');
  dialog.value = false;
};

const onUpdate = (value) => {
  if (!value) {
    emit('cancel');
  }
};

let cleanupFocusTrap = null;

onMounted(() => {
  if (dialog.value) {
    // Focus first element when dialog opens
    const dialogElement = document.querySelector('[role="alertdialog"]');
    if (dialogElement) {
      focusFirstElement(dialogElement);
      cleanupFocusTrap = trapFocus(dialogElement);
    }
  }
});

onUnmounted(() => {
  if (cleanupFocusTrap) {
    cleanupFocusTrap();
  }
});

watch(dialog, (isOpen) => {
  if (isOpen) {
    // Focus first element when dialog opens
    setTimeout(() => {
      const dialogElement = document.querySelector('[role="alertdialog"]');
      if (dialogElement) {
        focusFirstElement(dialogElement);
        cleanupFocusTrap = trapFocus(dialogElement);
      }
    }, 100);
  } else {
    if (cleanupFocusTrap) {
      cleanupFocusTrap();
      cleanupFocusTrap = null;
    }
  }
});
</script>

<style scoped lang="scss">
.v-card-title {
  padding: 1rem 1.5rem;
}
</style>
