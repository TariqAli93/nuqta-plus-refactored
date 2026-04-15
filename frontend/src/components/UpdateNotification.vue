<!-- filepath: packages/frontend/src/components/UpdateDialog.vue -->
<template>
  <v-dialog v-model="show" max-width="520" persistent>
    <v-card class="pa-4">
      <!-- Header -->
      <header class="mb-3 d-flex align-center justify-space-between">
        <div class="text-h6 font-weight-bold">
          <span>
            <template v-if="stage === 'checking'">جارٍ التحقق من وجود تحديثات…</template>
            <template v-else-if="stage === 'noupdate'">لا يوجد تحديث متاح.</template>
          </span>
        </div>
        <v-btn icon="mdi-close" variant="text" @click="closeDialog" />
      </header>

      <!-- Version Info -->
      <section v-if="stage === 'available'" class="mb-4">
        <div class="text-subtitle-2 opacity-80">
          الإصدار الجديد: <strong>{{ version }}</strong>
        </div>

        <div v-if="changelog" class="mt-2 text-caption changelog">
          <div class="mb-1 text-h6">ما الجديد؟</div>
          <div v-for="(line, li) in parsedChangelog" :key="li">
            <template v-for="(seg, si) in line" :key="si">
              <strong v-if="seg.type === 'bold'">{{ seg.text }}</strong>
              <em v-else-if="seg.type === 'italic'">{{ seg.text }}</em>
              <span v-else>{{ seg.text }}</span>
            </template>
          </div>
        </div>
      </section>

      <!-- Download Progress -->
      <section v-if="stage === 'downloading'" class="mb-4">
        <v-progress-linear :model-value="progress" height="10" color="primary" rounded />
        <div class="mt-1 text-caption">
          {{ formatBytes(transferred) }} / {{ formatBytes(total) }} ({{ progress }}%)
        </div>

        <!-- checking -->
        <div class="text-h6 font-weight-bold">
          {{
            stage === 'checking'
              ? 'التحقق من التحديثات'
              : stage === 'noupdate'
                ? 'لا يوجد تحديث'
                : 'تحديث جديد متاح'
          }}
        </div>
      </section>

      <!-- Error Message -->
      <section v-if="stage === 'error'" class="mb-4 text-red">
        {{ errorMessage }}
      </section>

      <!-- Ready Message -->
      <section v-if="stage === 'ready'" class="mb-4 text-green">
        تم تنزيل التحديث — جاهز للتثبيت.
      </section>

      <!-- Actions -->
      <footer class="justify-end d-flex ga-2">
        <!-- Later -->
        <v-btn v-if="stage === 'available'" variant="text" @click="closeDialog"> لاحقاً </v-btn>

        <!-- Download -->
        <v-btn v-if="stage === 'available'" color="primary" variant="flat" @click="startDownload">
          تنزيل الآن
        </v-btn>

        <!-- Retry -->
        <v-btn v-if="stage === 'error'" color="primary" variant="flat" @click="startDownload">
          إعادة المحاولة
        </v-btn>

        <!-- Install -->
        <v-btn v-if="stage === 'ready'" color="primary" variant="flat" @click="installUpdate">
          تثبيت الآن
        </v-btn>
      </footer>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';

const show = ref(false);
const stage = ref('idle');

const version = ref('');
const changelog = ref('');

const progress = ref(0);
const transferred = ref(0);
const total = ref(0);
const errorMessage = ref('');

const startDownload = () => {
  window?.electronAPI?.invoke('update:download');
  stage.value = 'downloading';
};

const installUpdate = () => {
  window?.electronAPI?.invoke('update:install');
};

const formatBytes = (x) => (!x ? '0 B' : `${(x / 1024 / 1024).toFixed(2)} MB`);

// Parse changelog into lines / segments for safe rendering without v-html
function parseChangelog(text = '') {
  if (!text) return [];

  const lines = text.split('\n');
  const parsed = lines.map((line) => {
    const tokens = [];
    let cursor = 0;
    const inlineRegex = /\*\*(.*?)\*\*|\*(.*?)\*/g;
    let match;
    while ((match = inlineRegex.exec(line)) !== null) {
      const index = match.index;
      if (index > cursor) {
        tokens.push({ type: 'text', text: line.slice(cursor, index) });
      }
      const bold = match[1];
      const italic = match[2];
      if (bold !== undefined) tokens.push({ type: 'bold', text: bold });
      else if (italic !== undefined) tokens.push({ type: 'italic', text: italic });
      cursor = index + match[0].length;
    }
    if (cursor < line.length) tokens.push({ type: 'text', text: line.slice(cursor) });
    return tokens;
  });
  return parsed;
}

const parsedChangelog = computed(() => parseChangelog(changelog.value));

const closeDialog = () => {
  show.value = false;
};

onMounted(() => {
  // 🔵 1. بدأ الفحص
  window?.electronAPI?.on('update-checking', (data) => {
    const payload = data.payload || {};
    if (!payload.manual) return; // ⛔ تجاهل الفحص التلقائي

    show.value = true;
    stage.value = 'checking';
  });

  // 🔵 2. لا يوجد تحديث
  window?.electronAPI?.on('update-not-available', (data) => {
    const payload = data.payload || {};
    if (!payload.manual) return;

    stage.value = 'noupdate';

    setTimeout(() => {
      show.value = false;
    }, 2000);
  });

  // 🔵 3. وجد تحديث
  window?.electronAPI?.on('update-available', (data) => {
    const payload = data.payload || data || {};
    if (!payload.manual) return;

    stage.value = 'available';
    version.value = payload.version || '';
    changelog.value = payload.releaseNotes || '';
  });

  // 🔵 4. بدأ التحميل
  window?.electronAPI?.on('update-downloading', () => {
    stage.value = 'downloading';
    progress.value = 0;
  });

  // 🔵 5. تقدم التحميل
  window?.electronAPI?.on('update-progress', (data) => {
    const p = data.payload || data || {};
    progress.value = p.percent || 0;
    transferred.value = p.transferred || 0;
    total.value = p.total || 0;
  });

  // 🔵 6. اكتمل التحميل
  window?.electronAPI?.on('update-ready', () => {
    stage.value = 'ready';
  });

  // 🔵 7. خطأ
  window?.electronAPI?.on('update-error', (data) => {
    const payload = data.payload || {};
    if (!payload.manual) return; // ⛔ تجاهل الأخطاء التلقائية

    stage.value = 'error';
    errorMessage.value = payload.error || data.payload?.error || 'حدث خطأ غير معروف';
  });
});

onUnmounted(() => {
  if (window?.electronAPI?.removeUpdateListeners) {
    window?.electronAPI?.removeUpdateListeners();
  }
});
</script>

<style scoped>
.changelog {
  background: rgba(0, 0, 0, 0.04);
  padding: 10px;
  border-radius: 6px;
  max-height: 150px;
  overflow-y: auto;
  line-height: 1.5;
}
.text-red {
  color: #e53935;
}
.text-green {
  color: #43a047;
}
</style>
