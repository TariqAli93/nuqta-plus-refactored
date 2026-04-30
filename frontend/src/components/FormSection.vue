<script setup>
defineProps({
  title: { type: String, default: '' },
  icon: { type: String, default: '' },
  iconColor: { type: String, default: 'primary' },
  hint: { type: String, default: '' },
});
</script>

<template>
  <section class="form-section">
    <div v-if="title || icon || $slots.title" class="form-section__title">
      <slot name="title">
        <v-icon v-if="icon" size="20" :color="iconColor">{{ icon }}</v-icon>
        <span>{{ title }}</span>
      </slot>
    </div>
    <div v-if="hint" class="form-section__hint">{{ hint }}</div>
    <slot />
  </section>
</template>
