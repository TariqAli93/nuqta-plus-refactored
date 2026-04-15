<template>
  <v-dialog
    v-model="isOpen"
    max-width="700"
    role="dialog"
    aria-labelledby="quick-search-title"
    @update:model-value="onDialogUpdate"
    @keydown.escape="close"
  >
    <v-card>
      <v-card-title id="quick-search-title" class="d-flex align-center gap-2">
        <v-icon>mdi-magnify</v-icon>
        <span>بحث سريع</span>
        <v-spacer />
        <v-chip size="small" variant="outlined">Ctrl+K</v-chip>
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-0">
        <v-text-field
          v-model="query"
          placeholder="ابحث عن منتجات، عملاء، مبيعات، أو صفحات..."
          prepend-inner-icon="mdi-magnify"
          variant="solo"
          flat
          hide-details
          autofocus
          class="search-input"
          :aria-label="'بحث سريع'"
          @input="handleSearch"
          @keydown.down.prevent="navigateResults(1)"
          @keydown.up.prevent="navigateResults(-1)"
          @keydown.enter.prevent="selectCurrent"
        />

        <v-divider />

        <div class="search-results" style="max-height: 400px; overflow-y: auto">
          <div v-if="isLoading" class="pa-4 text-center">
            <v-progress-circular indeterminate color="primary" size="32" />
            <p class="mt-2 text-body-2">جاري البحث...</p>
          </div>

          <div v-else-if="!query.trim()" class="pa-4">
            <p class="text-body-2 text-medium-emphasis mb-2">ابدأ الكتابة للبحث...</p>
            <div class="quick-actions">
              <v-chip
                v-for="page in searchResults.pages"
                :key="page.to"
                :prepend-icon="page.icon"
                variant="outlined"
                class="ma-1"
                @click="selectResult(page)"
              >
                {{ page.title }}
              </v-chip>
            </div>
          </div>

          <div v-else-if="hasResults" class="pa-2">
            <!-- Pages -->
            <div v-if="searchResults.pages.length > 0" class="result-section">
              <div class="result-section-title">صفحات</div>
              <v-list density="compact">
                <v-list-item
                  v-for="(item, index) in searchResults.pages"
                  :key="`page-${index}`"
                  :class="{ 'bg-primary-lighten-5': selectedIndex === `page-${index}` }"
                  @click="selectResult(item)"
                >
                  <template #prepend>
                    <v-icon>{{ item.icon }}</v-icon>
                  </template>
                  <v-list-item-title>{{ item.title }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </div>

            <!-- Products -->
            <div v-if="searchResults.products.length > 0" class="result-section">
              <div class="result-section-title">منتجات</div>
              <v-list density="compact">
                <v-list-item
                  v-for="item in searchResults.products"
                  :key="`product-${item.id}`"
                  :class="{ 'bg-primary-lighten-5': selectedIndex === `product-${item.id}` }"
                  @click="selectResult(item)"
                >
                  <template #prepend>
                    <v-icon>{{ item.icon }}</v-icon>
                  </template>
                  <v-list-item-title>{{ item.title }}</v-list-item-title>
                  <v-list-item-subtitle>{{ item.subtitle }}</v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </div>

            <!-- Customers -->
            <div v-if="searchResults.customers.length > 0" class="result-section">
              <div class="result-section-title">عملاء</div>
              <v-list density="compact">
                <v-list-item
                  v-for="item in searchResults.customers"
                  :key="`customer-${item.id}`"
                  :class="{ 'bg-primary-lighten-5': selectedIndex === `customer-${item.id}` }"
                  @click="selectResult(item)"
                >
                  <template #prepend>
                    <v-icon>{{ item.icon }}</v-icon>
                  </template>
                  <v-list-item-title>{{ item.title }}</v-list-item-title>
                  <v-list-item-subtitle>{{ item.subtitle }}</v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </div>

            <!-- Sales -->
            <div v-if="searchResults.sales.length > 0" class="result-section">
              <div class="result-section-title">مبيعات</div>
              <v-list density="compact">
                <v-list-item
                  v-for="item in searchResults.sales"
                  :key="`sale-${item.id}`"
                  :class="{ 'bg-primary-lighten-5': selectedIndex === `sale-${item.id}` }"
                  @click="selectResult(item)"
                >
                  <template #prepend>
                    <v-icon>{{ item.icon }}</v-icon>
                  </template>
                  <v-list-item-title>{{ item.title }}</v-list-item-title>
                  <v-list-item-subtitle>{{ item.subtitle }}</v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </div>
          </div>

          <div v-else class="pa-4 text-center text-medium-emphasis">
            <v-icon size="48" color="grey">mdi-magnify</v-icon>
            <p class="mt-2">لا توجد نتائج</p>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useQuickSearch } from '@/composables/useQuickSearch';

const { query, isOpen, isLoading, searchResults, performSearch, open, close, selectResult } =
  useQuickSearch();

const selectedIndex = ref(null);

const hasResults = computed(() => {
  return (
    searchResults.value.pages.length > 0 ||
    searchResults.value.products.length > 0 ||
    searchResults.value.customers.length > 0 ||
    searchResults.value.sales.length > 0
  );
});

const handleSearch = () => {
  performSearch();
  selectedIndex.value = null;
};

const navigateResults = (direction) => {
  const allResults = [
    ...searchResults.value.pages.map((r, i) => ({ ...r, key: `page-${i}` })),
    ...searchResults.value.products.map((r) => ({ ...r, key: `product-${r.id}` })),
    ...searchResults.value.customers.map((r) => ({ ...r, key: `customer-${r.id}` })),
    ...searchResults.value.sales.map((r) => ({ ...r, key: `sale-${r.id}` })),
  ];

  if (allResults.length === 0) return;

  const currentIdx = selectedIndex.value
    ? allResults.findIndex((r) => r.key === selectedIndex.value)
    : -1;

  let newIdx = currentIdx + direction;
  if (newIdx < 0) newIdx = allResults.length - 1;
  if (newIdx >= allResults.length) newIdx = 0;

  selectedIndex.value = allResults[newIdx].key;
};

const selectCurrent = () => {
  if (!selectedIndex.value) {
    const firstResult =
      searchResults.value.pages[0] ||
      searchResults.value.products[0] ||
      searchResults.value.customers[0] ||
      searchResults.value.sales[0];
    if (firstResult) {
      selectResult(firstResult);
    }
    return;
  }

  const allResults = [
      ...searchResults.value.pages.map((r, i) => ({ ...r, key: `page-${i}` })),
      ...searchResults.value.products.map((r) => ({ ...r, key: `product-${r.id}` })),
      ...searchResults.value.customers.map((r) => ({ ...r, key: `customer-${r.id}` })),
      ...searchResults.value.sales.map((r) => ({ ...r, key: `sale-${r.id}` })),
    ],
    result = allResults.find((r) => r.key === selectedIndex.value);

  if (result) {
    selectResult(result);
  }
};

const onDialogUpdate = (value) => {
  if (!value) {
    close();
  }
};

const handleOpenEvent = () => {
  open();
};

onMounted(() => {
  window.addEventListener('open-quick-search', handleOpenEvent);
});

onUnmounted(() => {
  window.removeEventListener('open-quick-search', handleOpenEvent);
});
</script>

<style scoped lang="scss">
.search-input {
  :deep(.v-field__input) {
    padding: 1rem;
    font-size: 1rem;
  }
}

.search-results {
  .result-section {
    margin-bottom: 0.5rem;
  }

  .result-section-title {
    padding: 0.5rem 1rem;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    color: rgb(var(--v-theme-on-surface-variant));
    background-color: rgb(var(--v-theme-surface-variant));
  }
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
