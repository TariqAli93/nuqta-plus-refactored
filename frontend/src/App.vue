<template>
  <v-app>
    <!-- شريط التقدم أعلى الصفحة -->
    <UpdateNotification />
    <LoadingProgressBar />

    <main id="main-content" role="main" aria-label="المحتوى الرئيسي">
      <router-view />
    </main>
    <AppSnackbar />
    <AppErrorDialog />

    <!-- مكون التحميل المركزي -->
    <LoadingSpinner />

    <!-- مكون الإعداد الأولي — لا يعمل في نافذة التفعيل -->
    <CreateFirstUser v-if="route.name !== 'Activation'" />
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

onMounted(async () => {
  document.addEventListener('auxclick', handleAuxClick, true);
  document.addEventListener('click', handleModifierClick, true);

  // Skip backend-dependent checks when showing the activation window
  if (route.name === 'Activation') return;
  await authStore.checkAuth();
});

onUnmounted(() => {
  document.removeEventListener('auxclick', handleAuxClick, true);
  document.removeEventListener('click', handleModifierClick, true);
});
</script>

<style>
@import './styles/tailwind.css';
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.bg-glass {
  backdrop-filter: blur(8px);
  background-color: rgba(255, 255, 255, 0.2);
}
</style>
