<template>
  <transition name="progress-fade">
    <div
      v-if="loadingStore.isLoading"
      class="loading-progress-container"
      :class="{ 'progress-fixed': fixed }"
    >
      <div
        class="loading-progress-bar"
        :class="[`progress-${color}`, { 'progress-animated': animated }]"
        :style="progressStyle"
      >
        <div v-if="animated" class="progress-shimmer"></div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue';
import { useLoadingStore } from '@/stores/loading';

// Props
const props = defineProps({
  // لون شريط التقدم
  color: {
    type: String,
    default: 'primary', // primary, success, warning, error, info
    validator: (value) => ['primary', 'success', 'warning', 'error', 'info'].includes(value),
  },

  // ارتفاع الشريط
  height: {
    type: Number,
    default: 3,
  },

  // موضع ثابت أعلى الصفحة
  fixed: {
    type: Boolean,
    default: true,
  },

  // تأثير متحرك
  animated: {
    type: Boolean,
    default: true,
  },

  // سرعة التقدم (بطيء، متوسط، سريع)
  speed: {
    type: String,
    default: 'medium',
    validator: (value) => ['slow', 'medium', 'fast'].includes(value),
  },

  // نسبة التقدم اليدوية (اختيارية)
  progress: {
    type: Number,
    default: null,
    validator: (value) => value === null || (value >= 0 && value <= 100),
  },
});

// State
const loadingStore = useLoadingStore();
const currentProgress = ref(0);
const progressInterval = ref(null);

// Computed
const progressStyle = computed(() => {
  const actualProgress = props.progress !== null ? props.progress : currentProgress.value;

  return {
    width: `${actualProgress}%`,
    height: `${props.height}px`,
    transition: props.animated ? getTransitionDuration() : 'none',
  };
});

/**
 * الحصول على مدة الانتقال حسب السرعة
 */
const getTransitionDuration = () => {
  const speeds = {
    slow: '0.8s',
    medium: '0.4s',
    fast: '0.2s',
  };

  return `width ${speeds[props.speed]} ease`;
};

/**
 * محاكاة تقدم التحميل
 */
const simulateProgress = () => {
  if (props.progress !== null) return; // لا نحاكي إذا كان التقدم يدوياً

  currentProgress.value = 0;

  progressInterval.value = setInterval(() => {
    if (currentProgress.value < 85) {
      // تقدم سريع في البداية
      const increment = Math.random() * 15 + 5;
      currentProgress.value = Math.min(currentProgress.value + increment, 85);
    } else if (currentProgress.value < 95) {
      // تقدم بطيء قرب النهاية
      const increment = Math.random() * 2 + 1;
      currentProgress.value = Math.min(currentProgress.value + increment, 95);
    }
    // نتوقف عند 95% وننتظر انتهاء التحميل الفعلي
  }, 200);
};

/**
 * إنهاء شريط التقدم
 */
const finishProgress = () => {
  if (progressInterval.value) {
    clearInterval(progressInterval.value);
    progressInterval.value = null;
  }

  if (props.progress === null) {
    currentProgress.value = 100;

    // إخفاء الشريط بعد فترة قصيرة
    setTimeout(() => {
      currentProgress.value = 0;
    }, 300);
  }
};

/**
 * إعادة تعيين التقدم
 */
const resetProgress = () => {
  if (progressInterval.value) {
    clearInterval(progressInterval.value);
    progressInterval.value = null;
  }

  currentProgress.value = 0;
};

// Watchers
watch(
  () => loadingStore.isLoading,
  (isLoading) => {
    if (isLoading) {
      simulateProgress();
    } else {
      finishProgress();
    }
  }
);

// Cleanup
onMounted(() => {
  return () => {
    if (progressInterval.value) {
      clearInterval(progressInterval.value);
    }
  };
});

// Expose methods
defineExpose({
  resetProgress,
  finishProgress,
});
</script>

<style scoped>
.loading-progress-container {
  position: relative;
  width: 100%;
  background: rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.loading-progress-container.progress-fixed {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9998;
}

.loading-progress-bar {
  height: 100%;
  border-radius: 0 2px 2px 0;
  position: relative;
  overflow: hidden;
}

/* ألوان مختلفة */
.progress-primary {
  background: linear-gradient(90deg, #1976d2, #42a5f5);
}

.progress-success {
  background: linear-gradient(90deg, #388e3c, #66bb6a);
}

.progress-warning {
  background: linear-gradient(90deg, #f57c00, #ffb74d);
}

.progress-error {
  background: linear-gradient(90deg, #d32f2f, #ef5350);
}

.progress-info {
  background: linear-gradient(90deg, #0288d1, #4fc3f7);
}

/* تأثير اللمعة المتحركة */
.progress-shimmer {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
  animation: shimmer 2s infinite;
}

.progress-animated .progress-shimmer {
  animation: shimmer 1.5s infinite;
}

/* الانتقالات */
.progress-fade-enter-active,
.progress-fade-leave-active {
  transition: all 0.3s ease;
}

.progress-fade-enter-from {
  opacity: 0;
  transform: translateY(-100%);
}

.progress-fade-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}

/* الحركات */
@keyframes shimmer {
  0% {
    left: -100%;
  }
  100% {
    left: 100%;
  }
}

/* تحسين للشاشات الصغيرة */
@media (max-width: 768px) {
  .loading-progress-bar {
    border-radius: 0;
  }
}

/* وضع داكن */
@media (prefers-color-scheme: dark) {
  .loading-progress-container {
    background: rgba(255, 255, 255, 0.1);
  }
}
</style>
