<!-- UpdateNotification.vue
     Update dialog + floating alert for the full-app (electron-updater) flow.

     Behaviour (reqs #1-#6, #9):
       - Silent startup check OR manual check that finds an update → dialog with
         "تحديث الآن" (Update now) / "تذكيرني لاحقاً" (Remind me later).
       - Remind me later → dialog hides, a persistent floating alert remains.
       - Closing the floating alert → it reappears after 30 minutes.
       - Update now → download (progress) → "إعادة التشغيل والتثبيت"
         (Restart and Install). The update is NEVER installed until this click. -->
<template>
  <!-- Update dialog -->
  <v-dialog v-model="dialogOpen" max-width="520" persistent>
    <v-card class="pa-4">
      <header class="mb-3 d-flex align-center justify-space-between">
        <div class="text-h6 font-weight-bold">
          <template v-if="stage === 'checking'">جارٍ التحقق من وجود تحديثات…</template>
          <template v-else-if="stage === 'noupdate'">لا يوجد تحديث متاح</template>
          <template v-else-if="stage === 'available'">يتوفر تحديث جديد</template>
          <template v-else-if="stage === 'downloading'">جارٍ تنزيل التحديث…</template>
          <template v-else-if="stage === 'ready'">التحديث جاهز للتثبيت</template>
          <template v-else-if="stage === 'installing'">جارٍ التثبيت…</template>
          <template v-else-if="stage === 'error'">تعذّر التحديث</template>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          :disabled="stage === 'installing'"
          @click="onHeaderClose"
        />
      </header>

      <!-- Available: version + changelog -->
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

      <!-- Download progress -->
      <section v-if="stage === 'downloading'" class="mb-4">
        <v-progress-linear :model-value="progress" height="10" color="primary" rounded />
        <div class="mt-1 text-caption">
          {{ formatBytes(transferred) }} / {{ formatBytes(total) }} ({{ progress }}%)
        </div>
      </section>

      <!-- Installing -->
      <section v-if="stage === 'installing'" class="mb-4 d-flex align-center ga-3">
        <v-progress-circular indeterminate size="22" color="primary" />
        <span class="text-caption">
          سيُعاد تشغيل التطبيق تلقائياً بعد التثبيت. قد تظهر نافذة طلب صلاحيات المدير.
        </span>
      </section>

      <!-- Error -->
      <section v-if="stage === 'error'" class="mb-4 text-red">
        {{ errorMessage }}
      </section>

      <!-- Ready -->
      <section v-if="stage === 'ready'" class="mb-4 text-green">
        تم تنزيل التحديث (الإصدار {{ version }}) — جاهز للتثبيت.
      </section>

      <footer class="justify-end d-flex ga-2">
        <v-btn v-if="stage === 'available'" variant="text" @click="remindLater">
          تذكيرني لاحقاً
        </v-btn>
        <v-btn v-if="stage === 'available'" color="primary" variant="flat" @click="startDownload">
          تحديث الآن
        </v-btn>

        <v-btn v-if="stage === 'error'" color="primary" variant="flat" @click="startDownload">
          إعادة المحاولة
        </v-btn>

        <v-btn v-if="stage === 'ready'" variant="text" @click="remindLater">
          لاحقاً
        </v-btn>
        <v-btn v-if="stage === 'ready'" color="primary" variant="flat" @click="installUpdate">
          إعادة التشغيل والتثبيت
        </v-btn>
      </footer>
    </v-card>
  </v-dialog>

  <!-- Floating update alert: stays after "تذكيرني لاحقاً"; reappears 30 min
       after the user closes it (reqs #3, #4) -->
  <div v-if="alertOpen" class="nuqta-update-alert">
    <v-card elevation="8" color="primary" theme="dark" class="pa-3 d-flex align-center ga-3">
      <v-icon :icon="stage === 'ready' ? 'mdi-cloud-check-outline' : 'mdi-cloud-download-outline'" />
      <div class="flex-grow-1">
        <div class="text-body-2 font-weight-bold">
          {{ stage === 'ready' ? 'التحديث جاهز للتثبيت' : 'يتوفر تحديث جديد' }}
        </div>
        <div v-if="version" class="text-caption">الإصدار {{ version }}</div>
      </div>
      <v-btn size="small" variant="flat" color="white" class="text-primary" @click="openFromAlert">
        {{ stage === 'ready' ? 'تثبيت' : 'تحديث' }}
      </v-btn>
      <v-btn icon="mdi-close" size="x-small" variant="text" @click="closeAlert" />
    </v-card>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';

const REMIND_DELAY_MS = 30 * 60 * 1000; // 30 minutes (req #4)

const dialogOpen = ref(false);
const alertOpen = ref(false);
const stage = ref('idle');

const version = ref('');
const changelog = ref('');
const progress = ref(0);
const transferred = ref(0);
const total = ref(0);
const errorMessage = ref('');

let remindTimer = null;
const offFns = [];

function clearRemindTimer() {
  if (remindTimer) {
    clearTimeout(remindTimer);
    remindTimer = null;
  }
}

function showAlert() {
  clearRemindTimer();
  alertOpen.value = true;
}

function closeAlert() {
  alertOpen.value = false;
  // Re-show the floating alert after 30 minutes (req #4).
  clearRemindTimer();
  remindTimer = setTimeout(showAlert, REMIND_DELAY_MS);
}

function openFromAlert() {
  alertOpen.value = false;
  clearRemindTimer();
  dialogOpen.value = true; // reopen the dialog at the current stage (available / ready)
}

function remindLater() {
  dialogOpen.value = false;
  showAlert(); // keep a persistent floating alert (req #3)
}

function onHeaderClose() {
  // If an update is pending or ready, closing the dialog keeps the floating
  // alert available; otherwise just dismiss the dialog.
  if (stage.value === 'available' || stage.value === 'ready') {
    remindLater();
  } else {
    dialogOpen.value = false;
  }
}

const startDownload = () => {
  window?.electronAPI?.invoke('update:download');
  stage.value = 'downloading';
  progress.value = 0;
  dialogOpen.value = true;
};

const installUpdate = () => {
  window?.electronAPI?.invoke('update:install');
  stage.value = 'installing';
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

function on(channel, handler) {
  const off = window?.electronAPI?.on?.(channel, handler);
  if (typeof off === 'function') offFns.push(off);
}

onMounted(() => {
  // 1. Checking — manual checks only (don't nag on the silent startup check).
  on('update-checking', (data) => {
    if (!data?.manual) return;
    dialogOpen.value = true;
    stage.value = 'checking';
  });

  // 2. No update — manual checks only.
  on('update-not-available', (data) => {
    if (!data?.manual) return;
    stage.value = 'noupdate';
    setTimeout(() => {
      if (stage.value === 'noupdate') dialogOpen.value = false;
    }, 2000);
  });

  // 3. Update available — shown for BOTH the silent startup check AND a manual
  //    check (reqs #1, #2). This is the key fix: the old component ignored every
  //    non-manual event, so the silent check never surfaced a dialog.
  on('update-available', (data) => {
    const p = data?.payload || {};
    version.value = p.version || '';
    changelog.value = p.releaseNotes || '';
    stage.value = 'available';
    clearRemindTimer();
    alertOpen.value = false;
    dialogOpen.value = true;
  });

  // 4. Download started.
  on('update-downloading', () => {
    stage.value = 'downloading';
    progress.value = 0;
    dialogOpen.value = true;
  });

  // 5. Download progress.
  on('update-progress', (data) => {
    const p = data?.payload || {};
    progress.value = p.percent || 0;
    transferred.value = p.transferred || 0;
    total.value = p.total || 0;
    if (stage.value !== 'installing') stage.value = 'downloading';
  });

  // 6. Download complete — ready to install on user request.
  on('update-ready', (data) => {
    const p = data?.payload || {};
    if (p.version) version.value = p.version;
    stage.value = 'ready';
    dialogOpen.value = true; // ensure the "Restart and Install" button is visible
  });

  // 7. Error — only surfaced when the user is in an active flow (dialog open).
  //    Silent background-check failures are ignored so they don't pop a modal.
  on('update-error', (data) => {
    const p = data?.payload || {};
    if (!dialogOpen.value) return;
    stage.value = 'error';
    errorMessage.value = p.error || 'حدث خطأ غير معروف أثناء التحديث';
  });
});

onUnmounted(() => {
  clearRemindTimer();
  offFns.forEach((off) => {
    try {
      off();
    } catch {
      /* noop */
    }
  });
  if (window?.electronAPI?.removeUpdateListeners) {
    window.electronAPI.removeUpdateListeners();
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
/* Floating update alert — bottom inline-end (RTL-aware). */
.nuqta-update-alert {
  position: fixed;
  bottom: 16px;
  inset-inline-end: 16px;
  z-index: 2400;
  max-width: 360px;
}
</style>
