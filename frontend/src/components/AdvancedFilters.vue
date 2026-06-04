<script setup>
import { ref } from 'vue';

// Collapsible advanced-filters panel (reqs #14–16). Visually separated from the
// search input, shows active-filter chips with a "مسح الفلاتر" button, and
// houses the per-page filter controls in its default slot.
const props = defineProps({
  // Active filters as [{ key, label }] — rendered as closable chips.
  chips: { type: Array, default: () => [] },
  // Start expanded?
  defaultOpen: { type: Boolean, default: false },
});

const emit = defineEmits(['clear', 'remove']);
const open = ref(props.defaultOpen);
const toggle = () => (open.value = !open.value);
</script>

<template>
  <div class="advanced-filters">
    <div class="advanced-filters__bar">
      <v-btn
        variant="tonal"
        color="primary"
        prepend-icon="mdi-tune-variant"
        :append-icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'"
        class="advanced-filters__toggle"
        :aria-expanded="open"
        @click="toggle"
      >
        الفلاتر
        <v-badge
          v-if="chips.length"
          :content="chips.length"
          color="error"
          inline
          class="ms-1"
        />
      </v-btn>

      <div v-if="chips.length" class="advanced-filters__chips">
        <v-chip
          v-for="chip in chips"
          :key="chip.key"
          size="small"
          variant="tonal"
          closable
          close-icon="mdi-close"
          @click:close="emit('remove', chip.key)"
        >
          {{ chip.label }}
        </v-chip>
        <v-btn
          variant="text"
          size="small"
          color="error"
          prepend-icon="mdi-filter-remove-outline"
          @click="emit('clear')"
        >
          مسح الفلاتر
        </v-btn>
      </div>
    </div>

    <v-expand-transition>
      <div v-show="open" class="advanced-filters__panel">
        <slot />
      </div>
    </v-expand-transition>
  </div>
</template>

<style scoped lang="scss">
.advanced-filters {
  width: 100%;
}

.advanced-filters__bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.advanced-filters__chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.advanced-filters__panel {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

@media (max-width: 600px) {
  .advanced-filters__toggle {
    width: 100%;
  }
}
</style>
