<template>
  <header class="page-header" :class="{ 'page-header--compact': compact }">
    <div class="page-header__main">
      <div v-if="$slots.icon || icon" class="page-header__icon">
        <slot name="icon">
          <v-icon :color="iconColor" :size="iconSize">{{ icon }}</v-icon>
        </slot>
      </div>
      <div class="page-header__text">
        <h1 class="page-header__title">{{ title }}</h1>
        <p v-if="subtitle || $slots.subtitle" class="page-header__subtitle">
          <slot name="subtitle">{{ subtitle }}</slot>
        </p>
      </div>
    </div>

    <div v-if="$slots.actions || $slots.default" class="page-header__actions">
      <slot name="actions" />
      <slot />
    </div>
  </header>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    default: '',
  },
  icon: {
    type: String,
    default: '',
  },
  iconColor: {
    type: String,
    default: 'primary',
  },
  iconSize: {
    type: [String, Number],
    default: 28,
  },
  compact: {
    type: Boolean,
    default: false,
  },
});
</script>

<style scoped lang="scss">
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
  background-color: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
  box-shadow:
    0 1px 2px 0 rgba(0, 0, 0, 0.04),
    0 1px 3px 0 rgba(0, 0, 0, 0.06);

  &--compact {
    padding: 0.75rem 1rem;
    margin-bottom: 0.75rem;
  }

  &__main {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  &__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background-color: rgba(var(--v-theme-primary), 0.1);
    color: rgb(var(--v-theme-primary));
    flex-shrink: 0;
  }

  &__text {
    min-width: 0;
  }

  &__title {
    font-size: 1.125rem;
    font-weight: 700;
    line-height: 1.3;
    color: rgb(var(--v-theme-primary));
    margin: 0;
  }

  &__subtitle {
    margin: 0.15rem 0 0;
    font-size: 0.8125rem;
    color: rgba(var(--v-theme-on-surface), 0.65);
    line-height: 1.4;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
}

@media (max-width: 600px) {
  .page-header {
    padding: 0.85rem 1rem;

    &__title {
      font-size: 1rem;
    }

    &__actions {
      width: 100%;

      :deep(.v-btn) {
        flex: 1 1 auto;
      }
    }
  }
}
</style>
