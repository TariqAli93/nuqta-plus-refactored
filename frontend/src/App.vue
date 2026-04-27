<template>
  <v-app>
    <!-- شريط التقدم أعلى الصفحة -->
    <UpdateNotification />
    <LoadingProgressBar />

    <!-- Backend lifecycle gate — transparent pass-through when backend is ready -->
    <BackendGate>
      <main id="main-content" role="main" aria-label="المحتوى الرئيسي">
        <router-view />
      </main>
      <AppSnackbar />
      <AppErrorDialog />

      <!-- مكون التحميل المركزي -->
      <LoadingSpinner />

      <!-- مكون الإعداد الأولي — لا يعمل في نافذة التفعيل -->
      <CreateFirstUser v-if="route.name !== 'Activation'" />
    </BackendGate>
  </v-app>
</template>
<script setup>
import { onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import AppSnackbar from '@/components/AppSnackbar.vue';
import AppErrorDialog from '@/components/AppErrorDialog.vue';
import LoadingSpinner from '@/components/LoadingSpinner.vue';
import LoadingProgressBar from '@/components/LoadingProgressBar.vue';
import UpdateNotification from '@/components/UpdateNotification.vue';
import CreateFirstUser from '@/components/CreateFirstUser.vue';
import BackendGate from '@/components/BackendGate.vue';

const authStore = useAuthStore();
const route = useRoute();

// Block middle-click (button 1) from opening new windows/tabs
const handleAuxClick = (e) => {
  if (e.button === 1) {
    e.preventDefault();
    e.stopPropagation();
  }
};

// Block Ctrl+click, Alt+click, Shift+click, Meta+click on links
const handleModifierClick = (e) => {
  if ((e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) && e.target.closest('a')) {
    e.preventDefault();
    e.stopPropagation();
  }
};

/**
 * Cross-tab sync: when another tab changes featureFlags/capabilities (or
 * logs out), pick up the change here so the user doesn't see stale UI in
 * the other tab. Triggered via the StorageEvent the browser fires for
 * `localStorage` writes from other tabs.
 */
const handleStorageEvent = (e) => {
  if (!e.key) {
    // Whole storage cleared — log out to be safe.
    if (authStore.isAuthenticated) authStore.logout();
    return;
  }
  if (e.key === 'token' && !e.newValue) {
    // Another tab logged out.
    if (authStore.isAuthenticated) authStore.logout();
    return;
  }
  if (e.key === 'featureFlags' || e.key === 'capabilities') {
    // Another tab toggled a flag — refresh our session so capabilities,
    // feature-flag-driven menus, and route guards re-evaluate immediately.
    if (authStore.isAuthenticated) authStore.refreshSession();
  }
};

onMounted(async () => {
  document.addEventListener('auxclick', handleAuxClick, true);
  document.addEventListener('click', handleModifierClick, true);
  window.addEventListener('storage', handleStorageEvent);

  // Skip backend-dependent checks when showing the activation window
  if (route.name === 'Activation') return;
  await authStore.checkAuth();
});

onUnmounted(() => {
  document.removeEventListener('auxclick', handleAuxClick, true);
  document.removeEventListener('click', handleModifierClick, true);
  window.removeEventListener('storage', handleStorageEvent);
});
</script>

<style>
@import './styles/tailwind.css';

.bg-glass {
  backdrop-filter: blur(8px);
  background-color: rgba(255, 255, 255, 0.2);
}
</style>
