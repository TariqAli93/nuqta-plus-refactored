<template>
  <div v-if="helpText || tooltip" class="form-field-help">
    <v-tooltip v-if="tooltip" :text="tooltip" location="top">
      <template #activator="{ props: tooltipProps }">
        <v-icon
          v-bind="tooltipProps"
          size="16"
          color="info"
          class="help-icon"
          :aria-label="`مساعدة: ${tooltip}`"
        >
          mdi-help-circle-outline
        </v-icon>
      </template>
    </v-tooltip>
    <div v-if="helpText" :id="helpId" class="help-text">
      <v-icon size="16" color="info" class="help-icon">mdi-information</v-icon>
      <span>{{ helpText }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  helpText: {
    type: String,
    default: '',
  },
  tooltip: {
    type: String,
    default: '',
  },
  fieldId: {
    type: String,
    default: '',
  },
});

const helpId = computed(() => {
  return props.fieldId
    ? `${props.fieldId}-help`
    : `help-${Math.random().toString(36).substr(2, 9)}`;
});
</script>

<style scoped lang="scss">
.form-field-help {
  margin-top: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.help-text {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  line-height: 1.4;
}

.help-icon {
  flex-shrink: 0;
}
</style>
