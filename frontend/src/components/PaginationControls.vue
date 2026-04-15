<template>
  <v-card-actions v-if="pagination.total > 0" class="d-flex justify-space-between align-center pa-4">
    <div class="text-body-2 text-medium-emphasis">
      عرض {{ (pagination.page - 1) * pagination.limit + 1 }} - 
      {{ Math.min(pagination.page * pagination.limit, pagination.total) }} 
      من أصل {{ pagination.total }}
    </div>
    <v-pagination
      :model-value="pagination.page"
      :length="pagination.totalPages"
      :total-visible="7"
      density="comfortable"
      @update:model-value="handlePageChange"
    />
    <v-select
      :model-value="pagination.limit"
      :items="itemsPerPageOptions"
      label="عناصر لكل صفحة"
      density="compact"
      variant="outlined"
      hide-details
      style="max-width: 150px"
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

