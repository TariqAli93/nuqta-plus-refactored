<script setup>
defineProps({
  // When true, renders the slot as a `.filter-toolbar__row` grid (auto-fit).
  // When false, the slot is laid out as-is so callers can use v-row/v-col.
  grid: { type: Boolean, default: false },
});
</script>

<template>
  <v-card class="page-section filter-toolbar">
    <div :class="grid ? 'filter-toolbar__row' : ''">
      <slot />
    </div>
    <div v-if="$slots.actions" class="filter-toolbar__actions mt-3">
      <slot name="actions" />
    </div>
  </v-card>
</template>
