<script setup>
defineProps({
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  saveText: { type: String, default: 'حفظ' },
  cancelText: { type: String, default: 'إلغاء' },
  saveIcon: { type: String, default: 'mdi-content-save' },
  saveColor: { type: String, default: 'primary' },
  // When true, the save button submits a form via type="submit".
  submit: { type: Boolean, default: true },
  // Hide the cancel button entirely.
  hideCancel: { type: Boolean, default: false },
});

defineEmits(['save', 'cancel']);
</script>

<template>
  <div class="action-bar">
    <slot name="prepend" />
    <v-btn
      v-if="!hideCancel"
      variant="text"
      :disabled="loading"
      @click="$emit('cancel')"
    >
      {{ cancelText }}
    </v-btn>
    <v-btn
      :type="submit ? 'submit' : 'button'"
      :color="saveColor"
      :prepend-icon="saveIcon"
      :loading="loading"
      :disabled="disabled"
      @click="!submit && $emit('save')"
    >
      {{ saveText }}
    </v-btn>
    <slot name="append" />
  </div>
</template>
