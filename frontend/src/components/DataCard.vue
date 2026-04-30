<script setup>
import { computed, useSlots } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';

defineProps({
  // Section header
  title: { type: String, default: '' },
  icon: { type: String, default: 'mdi-format-list-bulleted' },
  iconColor: { type: String, default: 'primary' },
  // Data-table inputs
  headers: { type: Array, required: true },
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  itemsPerPage: { type: [Number, String], default: 25 },
  page: { type: [Number, String], default: 1 },
  itemsLength: { type: [Number, String], default: undefined },
  serverItemsLength: { type: Boolean, default: false },
  hideDefaultFooter: { type: Boolean, default: true },
  density: { type: String, default: 'comfortable' },
  rowClickable: { type: Boolean, default: false },
  // Empty state
  emptyTitle: { type: String, default: 'لا توجد بيانات' },
  emptyDescription: { type: String, default: '' },
  emptyIcon: { type: String, default: 'mdi-inbox-outline' },
  emptyActions: { type: Array, default: () => [] },
});

defineEmits([
  'update:items-per-page',
  'update:page',
  'click:row',
]);

const slots = useSlots();
// Forward only data-table cell/group slots to v-data-table; the host
// component handles `loading`, `no-data`, `title`, `actions`, `footer`.
const reserved = new Set(['default', 'title', 'actions', 'footer', 'empty', 'loading', 'no-data']);
const passthroughSlots = computed(() =>
  Object.keys(slots).filter((name) => !reserved.has(name))
);
</script>

<template>
  <v-card class="page-section">
    <div
      v-if="title || $slots.title || $slots.actions"
      class="section-title"
    >
      <span class="section-title__label">
        <slot name="title">
          <v-icon v-if="icon" size="20" :color="iconColor">{{ icon }}</v-icon>
          <span>{{ title }}</span>
        </slot>
      </span>
      <span v-if="$slots.actions" class="section-title__actions">
        <slot name="actions" />
      </span>
    </div>

    <v-data-table
      :headers="headers"
      :items="items"
      :loading="loading"
      :items-per-page="Number(itemsPerPage)"
      :page="Number(page)"
      :items-length="itemsLength"
      :server-items-length="serverItemsLength"
      :hide-default-footer="hideDefaultFooter"
      :density="density"
      :class="{ 'cursor-pointer': rowClickable }"
      v-bind="$attrs"
      @update:items-per-page="$emit('update:items-per-page', $event)"
      @update:page="$emit('update:page', $event)"
      @click:row="(...args) => $emit('click:row', ...args)"
    >
      <template #loading>
        <slot name="loading">
          <TableSkeleton :rows="5" :columns="headers.length" />
        </slot>
      </template>

      <template #no-data>
        <slot name="no-data">
          <slot name="empty">
            <EmptyState
              :title="emptyTitle"
              :description="emptyDescription"
              :icon="emptyIcon"
              :actions="emptyActions"
              compact
            />
          </slot>
        </slot>
      </template>

      <template
        v-for="slotName in passthroughSlots"
        :key="slotName"
        #[slotName]="scope"
      >
        <slot :name="slotName" v-bind="scope" />
      </template>
    </v-data-table>

    <slot name="footer" />
  </v-card>
</template>
