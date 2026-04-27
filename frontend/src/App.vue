<template>
  <v-app>
    <!-- شريط التقدم أعلى الصفحة -->
    <UpdateNotification />
    <LoadingProgressBar />
    <div v-if="authStore.hydrationError">
      <ErrorState
        title="خطأ في الاتصال"
        message="لا يمكن تحميل الجلسة"
        @retry="authStore.refreshSession({ force: true })"
      />
    </div>

    <!-- Backend lifecycle gate — transparent pass-through when backend is ready -->
    <BackendGate>
      <main id="main-content" role="main" aria-label="المحتوى الرئيسي">
        <!-- Hydration shell. While we're fetching /auth/session for the
             first time on a protected route, render a neutral placeholder
             instead of `<router-view />` so feature-gated buttons/menus
             cannot flash their unauthorized state before the backend has
             told us what the user can see.
             Public routes (Login, ServerSetup, Activation) skip the gate. -->
        <div
          v-if="showHydrationShell"
          class="auth-hydration-shell"
          role="status"
          aria-live="polite"
          aria-label="جاري تحميل الجلسة"
        >
          <v-progress-circular indeterminate size="48" color="primary" />
        </div>
        <router-view v-else />
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
import { computed, onMounted, onUnmounted } from 'vue';
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

/**
 * Show the hydration shell ONLY on protected routes that haven't finished
 * their first /auth/session load. Once `isHydrated` flips true we render
 * `<router-view />` and never gate again — subsequent refreshes happen in
 * the background and don't unmount the active page.
 */
const showHydrationShell = computed(() => {
  if (!route.meta?.requiresAuth) return false;
  if (authStore.isHydrated) return false;
  // No token → router guard will redirect to Login; render router-view so
  // it can mount the Login layout.
  if (!authStore.token) return false;
  return authStore.isHydrating || !authStore.isHydrated;
});

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
 *
 * Concurrent refreshes are de-duped inside `refreshSession()` so spamming
 * this handler (e.g. the user toggling a flag rapidly) never stacks up
 * parallel /auth/session requests.
 */
const handleStorageEvent = (e) => {
  if (!e.key) {
    // Whole storage cleared — log out to be safe.
    if (authStore.isAuthenticated) authStore.clearSessionState();
    return;
  }
  if (e.key === 'token' && !e.newValue) {
    // Another tab logged out.
    if (authStore.isAuthenticated) authStore.clearSessionState();
    return;
  }
  if (e.key === 'featureFlags' || e.key === 'capabilities') {
    // Another tab toggled a flag — refresh our session so capabilities,
    // feature-flag-driven menus, and route guards re-evaluate immediately.
    // `force: true` bypasses the in-flight de-dupe ONLY when no refresh is
    // currently running; otherwise the in-flight one already covers us.
    if (authStore.isAuthenticated && !authStore.isHydrating) {
      authStore.refreshSession({ force: true });
    }
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

/* Neutral placeholder shown while /auth/session is loading. Centered so the
   spinner is visible regardless of the eventual layout's chrome. */
.auth-hydration-shell {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  width: 100%;
}
</style>
