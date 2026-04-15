<template>
  <v-dialog
    v-model="store.open"
    max-width="640"
    role="alertdialog"
    aria-labelledby="error-dialog-title"
    aria-describedby="error-dialog-message"
  >
    <v-card>
      <v-card-title id="error-dialog-title" class="text-h6">
        <v-icon color="error" class="mr-2" aria-hidden="true">mdi-alert-circle</v-icon>
        {{ store.title || 'حدث خطأ' }}
      </v-card-title>
      <v-card-text>
        <div v-if="store.message" id="error-dialog-message" class="mb-3">
          {{ store.message }}
        </div>
        <div v-if="store.details?.length">
          <v-list density="compact" role="list">
            <v-list-item
              v-for="(d, i) in store.details"
              :key="i"
              role="listitem"
              :aria-label="`تفاصيل الخطأ ${i + 1}: ${d}`"
            >
              <v-list-item-title>{{ d }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </div>
        <div v-if="store.helpLink" class="mt-3">
          <v-btn
            :href="store.helpLink.url"
            target="_blank"
            variant="text"
            prepend-icon="mdi-help-circle"
            size="small"
            :aria-label="`مساعدة: ${store.helpLink.text}`"
          >
            {{ store.helpLink.text }}
          </v-btn>
        </div>
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn color="primary" aria-label="حسناً" @click="store.hide()">حسناً</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { useErrorDialogStore } from '@/stores/errorDialog';
const store = useErrorDialogStore();
</script>
