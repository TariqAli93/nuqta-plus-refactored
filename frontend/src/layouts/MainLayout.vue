<template>
  <v-app>
    <v-navigation-drawer
      v-model="drawer"
      app
      :permanent="!isMobile"
      :temporary="isMobile"
      width="250"
      rail
      rail-width="120"
      :touchless="false"
      @update:model-value="onDrawerUpdate"
    >
      <!-- Logo -->
      <router-link
        to="/"
        class="flex justify-center align-center pa-1 absolute top-0 left-0 w-full border-b z-50"
        style="background-color: rgba(var(--v-theme-background), 1)"
        aria-label="الرئيسية"
      >
        <img
          id="navigationDrawerLogo"
          src="@/assets/logo.png"
          :src-dark="'@/assets/logo.png'"
          alt="Nuqta Plus Logo"
          loading="lazy"
        />
      </router-link>

      <v-list :lines="false" density="comfortable" nav style="margin-top: 65px">
        <!-- Main Menu Items -->
        <template v-for="item in filteredMenu" :key="item.title">
          <!-- Non-group items -->
          <v-list-item
            v-if="!item.group"
            :to="item.to"
            :exact="item.to === '/'"
            :disabled="item.disabled"
            rounded="xl"
            active-class="active-nav-item"
            variant="plain"
            :ripple="false"
            :aria-label="item.title"
          >
            <div class="flex items-center justify-center flex-col mb-2">
              <div class="v-list-item-icon">
                <v-icon>{{ item.icon }}</v-icon>
              </div>
              <div class="v-list-item-title">{{ item.title }}</div>
            </div>
          </v-list-item>

          <!-- Group items -->
          <v-list-group
            v-else
            v-model:open="navigationDrawerSubItemsOpen"
            :value="navigationDrawerSubItemsOpen"
            :ripple="false"
            fluid
            class="custom-group"
          >
            <!-- Group activator -->
            <template #activator="{ props }">
              <v-list-item v-bind="props" variant="plain" :aria-label="item.title">
                <div class="flex items-center justify-center flex-col mb-2">
                  <div class="v-list-item-icon">
                    <v-icon>{{ item.icon }}</v-icon>
                  </div>
                  <div class="v-list-item-title">{{ item.title }}</div>
                </div>
              </v-list-item>
            </template>

            <!-- Sub-items -->
            <v-list-item
              v-for="sub in item.group.items"
              :key="sub.title"
              :to="sub.to"
              active-class="active-nav-item"
              variant="plain"
              :value="sub.to"
              :aria-label="sub.title"
            >
              <div class="flex items-center justify-center flex-col gap-2 mb-2 in-group-title">
                <div class="v-list-item-icon">
                  <v-icon size="20">{{ sub.icon }}</v-icon>
                </div>
                <div class="v-list-item-title">{{ sub.title }}</div>
              </div>
            </v-list-item>
          </v-list-group>
        </template>
      </v-list>
    </v-navigation-drawer>

    <v-app-bar app elevation="0" dark class="border-b" color="background">
      <v-container class="flex align-center">
        <v-app-bar-nav-icon
          :aria-label="drawer ? 'إخفاء القائمة الجانبية' : 'إظهار القائمة الجانبية'"
          @click="toggleDrawer"
        ></v-app-bar-nav-icon>
        <v-toolbar-title class="text-truncate">{{ currentPageTitle }}</v-toolbar-title>

        <v-spacer></v-spacer>

        <v-text-field
          v-if="!isMobile"
          class="cursor-pointer ml-3"
          variant="outlined"
          hide-details
          density="comfortable"
          aria-label="بحث سريع (Ctrl+K)"
          placeholder="بحث سريع"
          readonly
          @click="openQuickSearch"
          @keydown.enter="openQuickSearch"
          @keydown.space.prevent="openQuickSearch"
        >
          <template #prepend-inner>
            <v-icon>mdi-magnify</v-icon>
          </template>

          <template #append-inner>
            <v-locale-provider locale="en" :rtl="false">
              <v-hotkey keys="ctrl+k" variant="flat" platform="pc" />
            </v-locale-provider>
          </template>
        </v-text-field>

        <v-btn
          v-else
          icon
          variant="text"
          aria-label="بحث سريع"
          @click="openQuickSearch"
        >
          <v-icon>mdi-magnify</v-icon>
        </v-btn>

        <!-- Alerts Badge -->
        <v-badge
          :content="alertStore.unreadCount"
          :model-value="alertStore.unreadCount > 0"
          color="error"
          overlap
        >
          <v-btn
            icon
            :to="{ name: 'Notifications' }"
            aria-label="التنبيهات"
            :aria-describedby="alertStore.unreadCount > 0 ? 'unread-alerts-count' : undefined"
          >
            <v-icon>mdi-bell</v-icon>
            <span v-if="alertStore.unreadCount > 0" id="unread-alerts-count" class="sr-only">
              {{ alertStore.unreadCount }} تنبيه غير مقروء
            </span>
          </v-btn>
        </v-badge>

        <v-btn
          icon
          :aria-label="isDark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'"
          @click="toggleTheme"
        >
          <v-icon>{{ isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night' }}</v-icon>
        </v-btn>

        <v-menu>
          <template #activator="{ props }">
            <v-btn
              icon
              v-bind="props"
              aria-label="قائمة المستخدم"
              :aria-describedby="`user-menu-${authStore.user?.username}`"
            >
              <v-icon>mdi-account-circle</v-icon>
              <span :id="`user-menu-${authStore.user?.username}`" class="sr-only">
                {{ authStore.user?.username }} - {{ authStore.user?.role?.name }}
              </span>
            </v-btn>
          </template>
          <v-list>
            <v-list-item>
              <v-list-item-title>{{ authStore.user?.username }}</v-list-item-title>
              <v-list-item-subtitle>{{ authStore.user?.role?.name }}</v-list-item-subtitle>
            </v-list-item>
            <v-divider></v-divider>
            <v-list-item prepend-icon="mdi-account-circle" to="/profile" aria-label="الملف الشخصي">
              <v-list-item-title>الملف الشخصي</v-list-item-title>
            </v-list-item>
            <v-list-item prepend-icon="mdi-logout" aria-label="تسجيل خروج" @click="handleLogout">
              <v-list-item-title>تسجيل خروج</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </v-container>
    </v-app-bar>

    <v-main>
      <v-container fluid>
        <router-view v-slot="{ Component, route: routeData }">
          <transition :name="transitionName" mode="out-in">
            <component :is="Component" :key="routeData.path" />
          </transition>
        </router-view>
      </v-container>
    </v-main>

    <!-- Footer -->
    <v-footer color="background" app>
      <v-container>
        <v-row align="center" no-gutters>
          <v-col cols="12" md="12" class="flex justify-between items-center flex-wrap gap-2">
            <div class="text-body-2">
              <strong>نقطة بلس</strong> - نظام إدارة المبيعات
            </div>
            <div class="text-body-2">كودل للحلول التقنية</div>
          </v-col>
        </v-row>
      </v-container>
    </v-footer>

    <!-- Quick Search -->
    <QuickSearch />
  </v-app>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTheme, useDisplay } from 'vuetify';
import { useAuthStore } from '@/stores/auth';
import { useAlertStore } from '@/stores/alert';
import QuickSearch from '@/components/QuickSearch.vue';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import { useNavigationMenu } from '@/composables/useNavigationMenu';

const router = useRouter();
const route = useRoute();
const theme = useTheme();
const { mobile: isMobile } = useDisplay();
const authStore = useAuthStore();
const alertStore = useAlertStore();
const { filteredMenu, getPageTitle } = useNavigationMenu();

const transitionName = ref('fade');

// Drawer state with persistence
const DRAWER_STORAGE_KEY = 'nuqta-drawer-state';
const getInitialDrawerState = () => {
  try {
    const saved = localStorage.getItem(DRAWER_STORAGE_KEY);
    return saved !== null ? JSON.parse(saved) : true;
  } catch {
    return true;
  }
};

const drawer = ref(getInitialDrawerState());
const isDark = computed(() => theme.global.current.value.dark);

// Navigation drawer sub-items open state
const navigationDrawerSubItemsOpen = ref(['/users']);

// Quick Search - use event to open search dialog
const openQuickSearch = () => {
  window.dispatchEvent(new CustomEvent('open-quick-search'));
};

// Toggle drawer and persist state
const toggleDrawer = () => {
  drawer.value = !drawer.value;
  saveDrawerState();
};

// Handle drawer update (from v-model)
const onDrawerUpdate = (value) => {
  drawer.value = value;
  saveDrawerState();
};

// Save drawer state to localStorage
const saveDrawerState = () => {
  try {
    localStorage.setItem(DRAWER_STORAGE_KEY, JSON.stringify(drawer.value));
  } catch (error) {
    console.warn('Failed to save drawer state:', error);
  }
};

// Theme management
const THEME_STORAGE_KEY = 'nuqta-theme';
const savedTheme = (() => {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || 'light';
  } catch {
    return 'light';
  }
})();

// Apply color-scheme to HTML
const applyColorScheme = (themeName) => {
  document.documentElement.style.colorScheme = themeName === 'dark' ? 'dark' : 'light';
};

// Initialize theme
theme.change(savedTheme);
applyColorScheme(savedTheme);

// Current page title
const currentPageTitle = computed(() => getPageTitle(route.path));

const toggleTheme = () => {
  const newTheme = isDark.value ? 'light' : 'dark';
  theme.change(newTheme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
  } catch (error) {
    console.warn('Failed to save theme preference:', error);
  }
  applyColorScheme(newTheme);
};

const handleLogout = () => {
  alertStore.stopPolling();
  authStore.logout();
  router.push({ name: 'Login' });
};

// Define route hierarchy levels for transitions
const getRouteLevel = (path) => {
  if (!path) return 1;

  // Auth routes
  if (path.startsWith('/auth')) return 0;

  // Main layout base routes
  const mainRoutes = [
    '/',
    '/customers',
    '/products',
    '/categories',
    '/sales',
    '/reports',
    '/notifications',
    '/users',
    '/profile',
    '/settings',
    '/about',
    '/forbidden',
  ];

  if (mainRoutes.includes(path) || path === '') return 1;

  // Child routes (new, edit, details)
  if (
    path.includes('/new') ||
    path.includes('/edit') ||
    path.match(/\/\d+$/) ||
    path.match(/[^/]+\/[^/]+/)
  ) {
    return 2;
  }

  return 1;
};

// Watch route changes for transitions
watch(
  () => route.path,
  (newPath, oldPath) => {
    if (!oldPath) {
      transitionName.value = 'fade';
      return;
    }

    const newLevel = getRouteLevel(newPath);
    const oldLevel = getRouteLevel(oldPath);

    if (newLevel > oldLevel) {
      transitionName.value = 'slide-up'; // Going deeper (parent → child)
    } else if (newLevel < oldLevel) {
      transitionName.value = 'slide-down'; // Going back (child → parent)
    } else {
      transitionName.value = 'slide-up'; // Same level
    }

    // Close drawer on mobile when navigating
    if (isMobile.value && drawer.value) {
      drawer.value = false;
    }
  },
  { immediate: true }
);

// Watch for mobile changes and adjust drawer
watch(
  () => isMobile.value,
  (mobile) => {
    if (mobile) {
      // Close drawer on mobile by default
      drawer.value = false;
    } else {
      // Restore saved state on desktop
      drawer.value = getInitialDrawerState();
    }
  },
  { immediate: true }
);

// Keyboard shortcuts
useKeyboardShortcuts();

// Lifecycle hooks
onMounted(() => {
  // Start polling for alerts when authenticated
  if (authStore.isAuthenticated) {
    alertStore.startPolling();
  }

  // Update navigation drawer sub-items open state based on current route
  if (route.path.startsWith('/users') || route.path.startsWith('/settings')) {
    navigationDrawerSubItemsOpen.value = [route.path];
  }
});

onUnmounted(() => {
  // Stop polling when component unmounts
  alertStore.stopPolling();
});
</script>

<style scoped lang="scss">
#navigationDrawerLogo {
  max-width: 100px;
  height: 56px;
  object-fit: contain;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

/* Ultra-fast transitions for snappy desktop feel */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active,
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from {
  transform: translateY(12px);
  opacity: 0;
}

.slide-up-leave-to {
  transform: translateY(-6px);
  opacity: 0;
}

.slide-down-enter-from {
  transform: translateY(-12px);
  opacity: 0;
}

.slide-down-leave-to {
  transform: translateY(6px);
  opacity: 0;
}
</style>
