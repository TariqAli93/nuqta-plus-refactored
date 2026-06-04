<script setup>
import { ref } from 'vue';

// Reusable, consistent search input used across products / invoices /
// customers / reports (req #13). Dumb & controlled: the page owns the value and
// wires events to a useServerSearch instance.
//   @update:modelValue  -> page calls search.onQueryChange(value)  (debounced)
//   @search (Enter)      -> page calls search.runNow()             (immediate)
//   @clear (Esc / X)     -> page calls search.clear()
defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'ابحث بالاسم، الرقم، الباركود، الهاتف...' },
  // Inline loading indicator (the debounced request is in flight).
  loading: { type: Boolean, default: false },
  ariaLabel: { type: String, default: 'بحث' },
  autofocus: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'search', 'clear']);
const field = ref(null);

function onEscape() {
  emit('clear');
  // blur is intentionally avoided so the user can keep typing a new query.
}
</script>

<template>
  <div class="search-bar">
    <v-text-field
      ref="field"
      :model-value="modelValue"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
      :loading="loading"
      :autofocus="autofocus"
      prepend-inner-icon="mdi-magnify"
      variant="outlined"
      density="comfortable"
      hide-details
      clearable
      rounded="lg"
      color="primary"
      class="search-bar__field"
      @update:model-value="emit('update:modelValue', $event ?? '')"
      @keydown.enter.prevent="emit('search')"
      @keydown.esc.prevent="onEscape"
      @click:clear="emit('clear')"
    />
  </div>
</template>

<style scoped lang="scss">
.search-bar {
  width: 100%;
  max-width: 520px;
}

// Full width on small screens (req #13 — mobile takes full width).
@media (max-width: 600px) {
  .search-bar {
    max-width: 100%;
  }
}

.search-bar__field {
  // Visible, accessible focus ring so the active field is unmistakable.
  :deep(.v-field.v-field--focused) {
    box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.18);
  }

  :deep(.v-field) {
    transition: box-shadow 0.15s ease;
  }

  :deep(.v-field:hover) {
    box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.08);
  }
}
</style>
