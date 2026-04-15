<template>
  <div class="empty-state" :class="{ 'empty-state-compact': compact }">
    <div class="empty-state-content">
      <div class="empty-state-icon">
        <v-icon :size="iconSize" :color="iconColor">{{ icon }}</v-icon>
      </div>
      <h3 class="empty-state-title">{{ title }}</h3>
      <p v-if="description" class="empty-state-description">{{ description }}</p>
      <div v-if="actions && actions.length > 0" class="empty-state-actions">
        <v-btn
          v-for="(action, index) in actions"
          :key="index"
          :color="action.color || 'primary'"
          :variant="action.variant || 'elevated'"
          :to="action.to"
          :prepend-icon="action.icon"
          :aria-label="action.label || action.text"
          @click="action.onClick"
        >
          {{ action.text }}
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    default: 'لا توجد بيانات',
  },
  description: {
    type: String,
    default: '',
  },
  icon: {
    type: String,
    default: 'mdi-inbox-outline',
  },
  iconColor: {
    type: String,
    default: 'grey',
  },
  iconSize: {
    type: [String, Number],
    default: 64,
  },
  actions: {
    type: Array,
    default: () => [],
  },
  compact: {
    type: Boolean,
    default: false,
  },
});
</script>

<style scoped lang="scss">
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 3rem 1.5rem;
  text-align: center;
}

.empty-state-compact {
  min-height: 200px;
  padding: 2rem 1rem;
}

.empty-state-content {
  max-width: 400px;
  width: 100%;
}

.empty-state-icon {
  margin-bottom: 1.5rem;
  opacity: 0.6;
}

.empty-state-title {
  font-size: 1.25rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: rgb(var(--v-theme-on-surface));
}

.empty-state-description {
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-surface-variant));
  margin-bottom: 1.5rem;
  line-height: 1.5;
}

.empty-state-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

@media (max-width: 600px) {
  .empty-state {
    min-height: 300px;
    padding: 2rem 1rem;
  }

  .empty-state-icon {
    margin-bottom: 1rem;
  }

  .empty-state-title {
    font-size: 1.125rem;
  }

  .empty-state-actions {
    flex-direction: column;
    width: 100%;

    :deep(.v-btn) {
      width: 100%;
    }
  }
}
</style>
