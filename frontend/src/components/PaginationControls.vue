<template>
  <v-card-actions v-if="pagination.total > 0" class="pagination-controls">
    <div class="pagination-controls__info text-body-2 text-medium-emphasis">
      عرض {{ (pagination.page - 1) * pagination.limit + 1 }} -
      {{ Math.min(pagination.page * pagination.limit, pagination.total) }}
      من أصل {{ pagination.total }}
    </div>
    <v-pagination
      :model-value="pagination.page"
      :length="pagination.totalPages"
      :total-visible="7"
      density="comfortable"
      class="pagination-controls__pages"
      @update:model-value="handlePageChange"
    />
    <v-select
      :model-value="pagination.limit"
      :items="itemsPerPageOptions"
      label="عناصر لكل صفحة"
      density="compact"
      variant="outlined"
      hide-details
      class="pagination-controls__limit"
      @update:model-value="handleItemsPerPageChange"
    />
  </v-card-actions>
</template>

<script setup>
const props = defineProps({
  pagination: {
    type: Object,
    required: true,
    default: () => ({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    }),
  },
  itemsPerPageOptions: {
    type: Array,
    default: () => [10, 25, 50, 100],
  },
});

const emit = defineEmits(['update:page', 'update:items-per-page']);

const handlePageChange = (page) => {
  emit('update:page', page);
};

const handleItemsPerPageChange = (limit) => {
  emit('update:items-per-page', limit);
};
</script>

<style scoped lang="scss">
.pagination-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
  flex-wrap: wrap;

  &__info {
    flex: 1 1 auto;
    min-width: 120px;
  }

  &__pages {
    flex: 0 1 auto;
  }

  &__limit {
    max-width: 150px;
    flex: 0 0 auto;
  }
}

@media (max-width: 600px) {
  .pagination-controls {
    justify-content: center;

    &__info {
      width: 100%;
      text-align: center;
      flex: 1 1 100%;
    }

    &__limit {
      max-width: 100%;
      flex: 1 1 100%;
    }
  }
}
</style>
