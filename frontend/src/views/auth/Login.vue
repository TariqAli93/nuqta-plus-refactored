<template>
  <div class="relative min-h-screen flex items-center justify-center overflow-hidden">
    <!-- Dynamic SVG Background -->
    <svg
      ref="svgRef"
      class="absolute inset-0 w-full h-full"
      :viewBox="`0 0 ${viewport.w} ${viewport.h}`"
      preserveAspectRatio="none"
    >
      <defs>
        <!-- خلفية متدرجة تتأقلم مع الثيم -->
        <linearGradient
          :id="ids.bg"
          x1="0"
          y1="0"
          :x2="viewport.w"
          :y2="viewport.h"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" :stop-color="bgStops[0]" />
          <stop offset="1" :stop-color="bgStops[1]" />
        </linearGradient>

        <!-- فلتر تنعيم (بدون زوايا) -->
        <filter :id="ids.soft" color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation="60" edgeMode="none" />
        </filter>
      </defs>

      <!-- خلفية -->
      <rect :width="viewport.w" :height="viewport.h" :fill="`url(#${ids.bg})`" />

      <!-- طبقة الأشكال الناعمة -->
      <g :filter="`url(#${ids.soft})`" style="mix-blend-mode: multiply">
        <circle
          v-for="(b, i) in blobs"
          :key="i"
          :cx="b.x"
          :cy="b.y"
          :r="b.r"
          :fill="b.fill"
          :opacity="b.opacity"
        />
      </g>
    </svg>

    <!-- Login Card -->
    <v-card
      elevation="12"
      rounded="xl"
      class="relative z-10 w-full max-w-md shadow-2xl backdrop-blur-md border transition-all duration-500"
      :class="isDark ? 'border-gray-700 bg-surface-dark' : 'border-blue-100 bg-white/90'"
    >
      <v-card-title class="flex flex-col items-center justify-center text-center py-8">
        <v-avatar size="80" class="mb-3" :color="isDark ? 'primary-darken-2' : 'primary-lighten-4'">
          <v-icon :color="isDark ? 'primary-lighten-3' : 'primary'" size="48"
            >mdi-account-circle</v-icon
          >
        </v-avatar>
        <h1
          class="text-2xl font-bold tracking-wide"
          :class="isDark ? 'text-primary-lighten-3' : 'text-primary'"
        >
          تسجيل الدخول
        </h1>
        <p class="text-sm mt-1" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
          مرحبًا بعودتك إلى النظام
        </p>
      </v-card-title>

      <v-divider />

      <v-card-text class="px-6 py-8">
        <v-form ref="loginForm" lazy-validation @submit.prevent="handleLogin">
          <v-text-field
            v-model="credentials.username"
            label="اسم المستخدم"
            prepend-inner-icon="mdi-account-outline"
            :rules="[rules.required]"
            variant="outlined"
            color="primary"
            density="comfortable"
            class="mb-5"
          />
          <v-text-field
            v-model="credentials.password"
            label="كلمة المرور"
            prepend-inner-icon="mdi-lock-outline"
            :type="showPassword ? 'text' : 'password'"
            :append-inner-icon="showPassword ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
            :rules="[rules.required]"
            variant="outlined"
            color="primary"
            density="comfortable"
            class="mb-4"
            @click:append-inner="showPassword = !showPassword"
          />

          <v-alert v-if="error" type="error" border="start" density="compact" class="mb-4">
            {{ error }}
          </v-alert>

          <v-btn
            type="submit"
            color="primary"
            size="large"
            block
            rounded="lg"
            class="py-3 font-semibold tracking-wide shadow-lg hover:shadow-xl transition-all duration-300"
            :loading="loading"
          >
            <v-icon class="ml-2">mdi-login</v-icon>
            دخول
          </v-btn>
        </v-form>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, watchEffect, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useTheme } from 'vuetify';

const router = useRouter();
const authStore = useAuthStore();
const theme = useTheme();

const isDark = computed(() => theme.global.current.value.dark);
const vuetifyColors = computed(() => theme.current.value.colors);

// ------------ Login logic ------------
const loginForm = ref(null);
const credentials = ref({ username: '', password: '' });
const showPassword = ref(false);
const loading = ref(false);
const error = ref('');

const rules = { required: (v) => !!v || 'هذا الحقل مطلوب' };

const handleLogin = async () => {
  await nextTick(); // Ensure DOM is updated
  if (!loginForm.value) {
    console.error('Form reference is not available');
    return;
  }

  const { valid } = await loginForm.value.validate();
  if (!valid) return;
  loading.value = true;
  error.value = '';
  try {
    await authStore.login(credentials.value);
    router.push({ name: 'Dashboard' });
  } catch (err) {
    error.value = err?.message || 'فشل تسجيل الدخول. تحقق من البيانات.';
  } finally {
    loading.value = false;
  }
};
// ------------------------------------

/**
 * SVG Background (Soft, circular shapes with dynamic colors)
 * - أشكال دائرية/عضوية ناعمة بدون زوايا حادة (دوائر غير متطابقة الأحجام)
 * - حركة لطيفة وعشوائية
 * - ألوان ديناميكية من Vuetify (primary/secondary + background/surface)
 */

const svgRef = ref(null);
const viewport = ref({ w: 1280, h: 720 });

const ids = {
  bg: 'bg-grad',
  soft: 'soften-filter',
};

const bgStops = computed(() => {
  // تدرّج الخلفية يتأقلم مع الثيم
  const c = vuetifyColors.value;
  return isDark.value ? [c.surface, c.background] : [c.background, '#ffffff'];
});

// تحويل HEX إلى rgba مع ألفا
const hexToRgba = (hex, a = 1) => {
  const h = hex.replace('#', '');
  const bigint = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((x) => x + x)
          .join('')
      : h,
    16
  );
  const r = (bigint >> 16) & 255,
    g = (bigint >> 8) & 255,
    b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const blobs = ref([]);
let rafId;

const setupBlobs = () => {
  const { w, h } = viewport.value;
  const c = vuetifyColors.value;

  // توزيع دوائر ناعمة بألوان primary/secondary متدرجة الشفافية
  const palette = [
    hexToRgba(c.primary, 0.35),
    hexToRgba(c.secondary, 0.28),
    hexToRgba(c.primary, 0.22),
    hexToRgba(c.secondary, 0.18),
    hexToRgba(c.primary, 0.26),
    hexToRgba(c.secondary, 0.2),
  ];

  blobs.value = Array.from({ length: palette.length }).map((_, i) => {
    const base = Math.min(w, h);
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: base * (0.12 + Math.random() * 0.18),
      dx: Math.random() * 0.6 - 0.3, // سرعة أفقية خفيفة
      dy: Math.random() * 0.6 - 0.3, // سرعة عمودية خفيفة
      dr: Math.random() * 0.12 - 0.06, // “تنفس” الحجم
      rMin: base * 0.1,
      rMax: base * 0.34,
      opacity: 1,
      fill: palette[i],
    };
  });
};

const tick = () => {
  const { w, h } = viewport.value;
  // تحديث مواقع وأنصاف الأقطار بحركة لطيفة + ارتداد
  blobs.value.forEach((b) => {
    b.x += b.dx;
    b.y += b.dy;
    b.r += b.dr;

    if (b.x < -b.r) b.x = w + b.r;
    if (b.x > w + b.r) b.x = -b.r;
    if (b.y < -b.r) b.y = h + b.r;
    if (b.y > h + b.r) b.y = -b.r;

    if (b.r < b.rMin || b.r > b.rMax) b.dr *= -1; // تنفس
  });

  rafId = requestAnimationFrame(tick);
};

const resize = () => {
  viewport.value = {
    w: window.innerWidth || 1280,
    h: window.innerHeight || 720,
  };
  setupBlobs();
};

onMounted(() => {
  resize();
  window.addEventListener('resize', resize);

  // اتّباع تفضيل النظام تلقائياً
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  theme.change(prefersDark ? 'dark' : 'light');

  setupBlobs();
  rafId = requestAnimationFrame(tick);
});

onUnmounted(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', resize);
});

// أعِد توليد الألوان/الأشكال عند تغيّر الثيم
watchEffect(() => {
  // يضمن التناسق اللوني الفوري مع Vuetify
  setupBlobs();
});
</script>

<style scoped>
/* لا نحتاج keyframes هنا؛ الحركة تتم عبر RAF على خواص SVG */
</style>
