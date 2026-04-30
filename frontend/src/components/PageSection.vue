<script setup>
defineProps({
  title: { type: String, default: '' },
  icon: { type: String, default: '' },
  iconColor: { type: String, default: 'primary' },
  hint: { type: String, default: '' },
  flush: { type: Boolean, default: false },
  noPadding: { type: Boolean, default: false },
});
</script>

<template>
  <v-card class="page-section">
    <div
      v-if="title || icon || $slots.title || $slots.actions"
      class="section-title"
      :class="{ 'section-title--flush': flush }"
    >
      <span class="section-title__label">
        <slot name="title">
          <v-icon v-if="icon" size="20" :color="iconColor">{{ icon }}</v-icon>
          <span>{{ title }}</span>
        </slot>
        <span v-if="hint" class="section-title__hint">{{ hint }}</span>
      </span>
      <span v-if="$slots.actions" class="section-title__actions">
        <slot name="actions" />
      </span>
    </div>

    <div :class="{ 'pa-4': !noPadding }">
      <slot />
    </div>
  </v-card>
</template>
