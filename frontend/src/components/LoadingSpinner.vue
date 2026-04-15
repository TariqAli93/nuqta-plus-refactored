<template>
  <transition name="loading-fade">
    <div
      v-if="loadingStore.isLoading"
      class="loading-overlay"
      :class="{ transparent: transparent }"
    >
      <div class="loading-container">
        <!-- Spinner مخصص -->
        <div class="loading-spinner" :class="spinnerSize">
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
        </div>

        <!-- نص التحميل -->
        <div v-if="showText" class="loading-text">
          {{ loadingText }}
        </div>

        <!-- شريط التقدم (اختياري) -->
        <div v-if="showProgressBar" class="progress-container">
          <div class="progress-bar" :style="{ width: `${progress}%` }"></div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { useLoadingStore } from '@/stores/loading';
import { computed } from 'vue';

// Props
const props = defineProps({
  // نص التحميل المخصص
  loadingText: {
    type: String,
    default: 'جاري التحميل...',
  },

  // إظهار النص
  showText: {
    type: Boolean,
    default: true,
  },

  // حجم الـ spinner
  size: {
    type: String,
    default: 'medium', // small, medium, large
    validator: (value) => ['small', 'medium', 'large'].includes(value),
  },

  // جعل الخلفية شفافة
  transparent: {
    type: Boolean,
    default: false,
  },

  // إظهار شريط التقدم
  showProgressBar: {
    type: Boolean,
    default: false,
  },

  // نسبة التقدم (0-100)
  progress: {
    type: Number,
    default: 0,
    validator: (value) => value >= 0 && value <= 100,
  },
});

// استخدام المتجر
const loadingStore = useLoadingStore();

// حساب حجم الـ spinner
const spinnerSize = computed(() => `spinner-${props.size}`);
</script>

<style scoped>
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
  transition: all 0.3s ease;
}

.loading-overlay.transparent {
  background: rgba(255, 255, 255, 0.3);
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem;
  border-radius: 12px;
  background: white;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  max-width: 300px;
  text-align: center;
}

/* Spinner Styles */
.loading-spinner {
  position: relative;
  display: inline-block;
  margin-bottom: 1rem;
}

.spinner-ring {
  position: absolute;
  border: 3px solid transparent;
  border-radius: 50%;
  animation: spin 1.5s linear infinite;
}

.spinner-ring:nth-child(1) {
  border-top-color: #1976d2;
  animation-delay: 0s;
}

.spinner-ring:nth-child(2) {
  border-top-color: #42a5f5;
  animation-delay: 0.3s;
}

.spinner-ring:nth-child(3) {
  border-top-color: #90caf9;
  animation-delay: 0.6s;
}

/* أحجام مختلفة للـ spinner */
.spinner-small .spinner-ring {
  width: 24px;
  height: 24px;
  border-width: 2px;
}

.spinner-medium .spinner-ring {
  width: 40px;
  height: 40px;
  border-width: 3px;
}

.spinner-large .spinner-ring {
  width: 60px;
  height: 60px;
  border-width: 4px;
}

/* نص التحميل */
.loading-text {
  font-size: 0.95rem;
  font-weight: 500;
  color: #424242;
  margin-bottom: 1rem;
  font-family: 'Cairo', 'Roboto', sans-serif;
}

/* شريط التقدم */
.progress-container {
  width: 200px;
  height: 4px;
  background: #e0e0e0;
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #1976d2, #42a5f5);
  border-radius: 2px;
  transition: width 0.3s ease;
  position: relative;
}

.progress-bar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
  animation: shimmer 2s infinite;
}

/* الانتقالات */
.loading-fade-enter-active,
.loading-fade-leave-active {
  transition: all 0.3s ease;
}

.loading-fade-enter-from,
.loading-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* الحركات */
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

/* تحسينات للشاشات الصغيرة */
@media (max-width: 480px) {
  .loading-container {
    padding: 1.5rem;
    max-width: 250px;
  }

  .loading-text {
    font-size: 0.9rem;
  }

  .progress-container {
    width: 150px;
  }
}

/* وضع داكن */
@media (prefers-color-scheme: dark) {
  .loading-overlay {
    background: rgba(0, 0, 0, 0.8);
  }

  .loading-container {
    background: #333;
    color: white;
  }

  .loading-text {
    color: #e0e0e0;
  }

  .progress-container {
    background: #555;
  }
}
</style>
