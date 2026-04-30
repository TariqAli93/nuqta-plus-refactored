<script setup>
defineProps({
  label: { type: String, default: '' },
  value: { type: [String, Number], default: '' },
  icon: { type: String, default: '' },
  iconColor: { type: String, default: 'primary' },
  hint: { type: String, default: '' },
  to: { type: [String, Object], default: null },
});
</script>

<template>
  <v-card :to="to" :link="!!to" class="stat-card">
    <v-card-text>
      <div class="stat-card__row">
        <div>
          <div v-if="label" class="stat-card__label">{{ label }}</div>
          <div class="stat-card__value">
            <slot name="value">{{ value }}</slot>
          </div>
          <div v-if="hint || $slots.hint" class="stat-card__hint">
            <slot name="hint">{{ hint }}</slot>
          </div>
        </div>
        <div v-if="icon || $slots.icon" class="stat-card__icon">
          <slot name="icon">
            <v-icon :color="iconColor" size="24">{{ icon }}</v-icon>
          </slot>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>
