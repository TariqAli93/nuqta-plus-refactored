<template>
  <div class="messaging-settings">
    <!-- Header -->
    <v-card class="mb-4" elevation="2">
      <v-card-text class="pa-4">
        <div class="d-flex justify-space-between align-center flex-wrap ga-2">
          <div class="d-flex align-center">
            <v-icon color="primary" size="28" class="me-3">mdi-message-text</v-icon>
            <div>
              <h2 class="text-h5 font-weight-bold text-primary">الرسائل والإشعارات</h2>
              <div class="text-caption text-medium-emphasis">
                إرسال الرسائل النصية وواتساب عبر BulkSMSIraq
              </div>
            </div>
          </div>
          <v-switch
            v-model="form.enabled"
            color="primary"
            density="comfortable"
            hide-details
            inset
            :loading="store.isSaving"
            :label="form.enabled ? 'النظام مفعّل' : 'النظام معطّل'"
            @update:model-value="onToggleEnabled"
          />
        </div>
      </v-card-text>
    </v-card>

    <v-alert
      v-if="store.error"
      type="error"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="store.error = null"
    >
      {{ store.error }}
    </v-alert>

    <v-alert
      v-if="!form.enabled"
      type="info"
      variant="tonal"
      class="mb-4"
      icon="mdi-power-off"
    >
      نظام الرسائل معطّل. فعّله من الزر أعلاه لعرض إعدادات المزوّد والقنوات والميزات.
    </v-alert>

    <template v-if="form.enabled">
      <!-- Provider section -->
      <v-card class="mb-4" elevation="1">
        <v-card-title class="d-flex align-center">
          <v-icon class="me-2" color="primary">mdi-server-network</v-icon>
          مزوّد الخدمة
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-select
                v-model="form.provider"
                :items="providerItems"
                item-title="text"
                item-value="value"
                label="المزوّد"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-cloud"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="form.senderId"
                label="معرّف المرسل (اختياري)"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-account-tag"
                placeholder="مثال: NuqtaPlus"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="form.phoneFormat"
                :items="phoneFormatItems"
                item-title="text"
                item-value="value"
                label="تنسيق رقم الهاتف عند الإرسال"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-phone-dial"
                hint="جرّب التنسيق الذي يقبله مزوّدك إذا فشلت الرسائل بسبب رفض الرقم"
                persistent-hint
              />
            </v-col>
            <v-col cols="12">
              <v-text-field
                v-model="apiKeyInput"
                :label="apiKeyLabel"
                :placeholder="apiKeyPlaceholder"
                :type="showApiKey ? 'text' : 'password'"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-key"
                :append-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
                @click:append-inner="showApiKey = !showApiKey"
              />
              <div class="text-caption text-medium-emphasis mt-1">
                المفتاح يُحفظ مشفّراً، ولن يظهر مرة أخرى — اتركه فارغاً للإبقاء على القيمة الحالية.
              </div>
            </v-col>
          </v-row>

          <div class="d-flex flex-wrap ga-2 mt-2">
            <v-btn
              color="primary"
              prepend-icon="mdi-content-save"
              :loading="store.isSaving"
              @click="saveAll"
            >
              حفظ
            </v-btn>
            <v-btn
              variant="outlined"
              color="primary"
              prepend-icon="mdi-connection"
              :loading="store.isTesting"
              :disabled="!canTest"
              @click="testConnection"
            >
              اختبار الاتصال
            </v-btn>
            <v-chip
              v-if="store.settings.lastTestStatus"
              :color="store.settings.lastTestStatus === 'ok' ? 'success' : 'error'"
              size="small"
            >
              <v-icon start size="16">
                {{ store.settings.lastTestStatus === 'ok' ? 'mdi-check' : 'mdi-alert' }}
              </v-icon>
              آخر اختبار:
              {{ store.settings.lastTestStatus === 'ok' ? 'نجاح' : 'فشل' }}
              <span v-if="store.settings.lastTestAt" class="ms-1">
                ({{ formatDate(store.settings.lastTestAt) }})
              </span>
            </v-chip>
          </div>
        </v-card-text>
      </v-card>

      <!-- Channels -->
      <v-card class="mb-4" elevation="1">
        <v-card-title class="d-flex align-center">
          <v-icon class="me-2" color="primary">mdi-swap-horizontal</v-icon>
          القنوات
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="4">
              <v-switch
                v-model="form.smsEnabled"
                label="تفعيل الرسائل النصية SMS"
                color="primary"
                density="comfortable"
                hide-details
                inset
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-switch
                v-model="form.whatsappEnabled"
                label="تفعيل WhatsApp"
                color="primary"
                density="comfortable"
                hide-details
                inset
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-switch
                v-model="form.autoFallbackEnabled"
                label="التحويل التلقائي عند الفشل"
                color="primary"
                density="comfortable"
                hide-details
                inset
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="form.defaultChannel"
                :items="channelItems"
                item-title="text"
                item-value="value"
                label="القناة الافتراضية"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-arrow-decision"
              />
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- Feature toggles -->
      <v-card class="mb-4" elevation="1">
        <v-card-title class="d-flex align-center">
          <v-icon class="me-2" color="primary">mdi-toggle-switch</v-icon>
          المزايا
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-switch
                v-model="form.overdueReminderEnabled"
                label="تذكيرات الأقساط المتأخرة"
                color="primary"
                density="comfortable"
                hide-details
                inset
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-switch
                v-model="form.paymentConfirmationEnabled"
                label="تأكيد استلام الدفعات"
                color="primary"
                density="comfortable"
                hide-details
                inset
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-switch
                v-model="form.singleCustomerMessagingEnabled"
                label="السماح بإرسال رسالة لعميل واحد"
                color="primary"
                density="comfortable"
                hide-details
                inset
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-switch
                v-model="form.bulkMessagingEnabled"
                label="السماح بالإرسال الجماعي"
                color="primary"
                density="comfortable"
                hide-details
                inset
              />
            </v-col>
          </v-row>
          <div class="d-flex justify-end mt-2">
            <v-btn color="primary" prepend-icon="mdi-content-save" :loading="store.isSaving" @click="saveAll">
              حفظ التغييرات
            </v-btn>
          </div>
        </v-card-text>
      </v-card>

      <!-- Manual sending -->
      <v-card class="mb-4" elevation="1">
        <v-card-title class="d-flex align-center">
          <v-icon class="me-2" color="primary">mdi-send</v-icon>
          إرسال يدوي
        </v-card-title>
        <v-card-text>
          <v-tabs v-model="manualTab" color="primary" density="compact">
            <v-tab value="single" :disabled="!form.singleCustomerMessagingEnabled">
              <v-icon start>mdi-account</v-icon>
              عميل واحد
            </v-tab>
            <v-tab value="bulk" :disabled="!form.bulkMessagingEnabled">
              <v-icon start>mdi-account-group</v-icon>
              جميع العملاء
            </v-tab>
          </v-tabs>

          <v-window v-model="manualTab" class="mt-3">
            <v-window-item value="single">
              <v-row>
                <v-col cols="12" md="6">
                  <v-autocomplete
                    v-model="manual.customerId"
                    :items="customerItems"
                    item-title="label"
                    item-value="id"
                    label="العميل *"
                    variant="outlined"
                    density="comfortable"
                    prepend-inner-icon="mdi-account"
                    :loading="customerStore.loading"
                    no-data-text="لا يوجد عميل مطابق"
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-select
                    v-model="manual.channel"
                    :items="channelItems"
                    item-title="text"
                    item-value="value"
                    label="القناة"
                    variant="outlined"
                    density="comfortable"
                    prepend-inner-icon="mdi-arrow-decision"
                  />
                </v-col>
                <v-col cols="12">
                  <v-textarea
                    v-model="manual.message"
                    label="الرسالة *"
                    variant="outlined"
                    density="comfortable"
                    rows="3"
                    auto-grow
                    counter="1600"
                    :rules="[(v) => !!v || 'الرسالة مطلوبة']"
                  />
                </v-col>
              </v-row>
              <div class="d-flex flex-wrap ga-2 justify-end">
                <v-btn variant="outlined" color="info" :disabled="!manual.message" prepend-icon="mdi-eye" @click="previewVisible = true">
                  معاينة
                </v-btn>
                <v-btn
                  color="primary"
                  prepend-icon="mdi-send"
                  :disabled="!manual.customerId || !manual.message"
                  :loading="sending"
                  @click="sendSingle"
                >
                  إرسال
                </v-btn>
              </div>
            </v-window-item>

            <v-window-item value="bulk">
              <v-row>
                <v-col cols="12" md="6">
                  <v-select
                    v-model="manual.channel"
                    :items="channelItems"
                    item-title="text"
                    item-value="value"
                    label="القناة"
                    variant="outlined"
                    density="comfortable"
                    prepend-inner-icon="mdi-arrow-decision"
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-checkbox
                    v-model="manual.all"
                    label="إرسال إلى جميع العملاء النشطين"
                    color="primary"
                    density="comfortable"
                    hide-details
                  />
                </v-col>
                <v-col cols="12">
                  <v-textarea
                    v-model="manual.message"
                    label="الرسالة *"
                    variant="outlined"
                    density="comfortable"
                    rows="3"
                    auto-grow
                    counter="1600"
                  />
                </v-col>
              </v-row>
              <div class="d-flex flex-wrap ga-2 justify-end">
                <v-btn variant="outlined" color="info" :disabled="!manual.message" prepend-icon="mdi-eye" @click="previewVisible = true">
                  معاينة
                </v-btn>
                <v-btn
                  color="primary"
                  prepend-icon="mdi-send-circle"
                  :disabled="!manual.message || !manual.all"
                  :loading="sending"
                  @click="sendBulk"
                >
                  إرسال للجميع
                </v-btn>
              </div>
            </v-window-item>
          </v-window>
        </v-card-text>
      </v-card>

      <!-- Logs -->
      <v-card class="mb-4" elevation="1">
        <v-card-title class="d-flex align-center justify-space-between">
          <div class="d-flex align-center">
            <v-icon class="me-2" color="primary">mdi-history</v-icon>
            سجل الرسائل
          </div>
          <div class="d-flex ga-1">
            <v-btn
              size="small"
              variant="outlined"
              prepend-icon="mdi-refresh"
              :loading="store.isLoading"
              @click="store.fetchLogs()"
            >
              تحديث
            </v-btn>
            <v-btn
              size="small"
              variant="outlined"
              color="info"
              prepend-icon="mdi-clock-alert"
              @click="store.scanOverdue()"
            >
              فحص الأقساط المتأخرة
            </v-btn>
            <v-btn
              size="small"
              variant="outlined"
              color="warning"
              prepend-icon="mdi-play"
              @click="store.processNow()"
            >
              تشغيل المعالج
            </v-btn>
          </div>
        </v-card-title>
        <v-card-text>
          <v-table density="compact">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>القناة</th>
                <th>المستلم</th>
                <th>الحالة</th>
                <th>الخطأ</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in store.logs" :key="row.id">
                <tr>
                  <td>{{ formatDate(row.createdAt) }}</td>
                  <td>{{ typeLabel(row.type) }}</td>
                  <td>
                    <v-chip size="x-small">
                      {{ row.resolvedChannel || row.channel }}
                    </v-chip>
                  </td>
                  <td dir="ltr" class="text-mono">{{ row.recipientPhone }}</td>
                  <td>
                    <v-chip :color="statusColor(row.status)" size="x-small">
                      {{ statusLabel(row.status) }}
                    </v-chip>
                  </td>
                  <td class="text-error" style="max-width: 240px">
                    <span class="text-caption">{{ row.error || '' }}</span>
                  </td>
                  <td>
                    <div class="d-flex ga-1">
                      <v-btn
                        size="x-small"
                        variant="text"
                        :color="expandedLogs[row.id] ? 'primary' : 'default'"
                        :prepend-icon="expandedLogs[row.id] ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                        @click="toggleLogDetails(row.id)"
                      >
                        تفاصيل
                      </v-btn>
                      <v-btn
                        v-if="row.status === 'failed'"
                        size="x-small"
                        variant="text"
                        color="primary"
                        prepend-icon="mdi-replay"
                        @click="store.retryNotification(row.id)"
                      >
                        إعادة
                      </v-btn>
                    </div>
                  </td>
                </tr>
                <tr v-if="expandedLogs[row.id]">
                  <td colspan="7" class="bg-grey-lighten-4">
                    <div v-if="logDetailsLoading[row.id]" class="text-center py-2">
                      <v-progress-circular indeterminate size="20" width="2" />
                    </div>
                    <div v-else-if="!logDetails[row.id] || !logDetails[row.id].length" class="text-medium-emphasis text-caption py-2">
                      لا توجد محاولات مسجّلة لهذه الرسالة بعد.
                    </div>
                    <div v-else class="py-2">
                      <div
                        v-for="entry in logDetails[row.id]"
                        :key="entry.id"
                        class="mb-3 pa-2 border rounded"
                      >
                        <div class="text-caption text-medium-emphasis mb-1">
                          {{ formatDate(entry.createdAt) }} ·
                          {{ entry.provider }} · {{ entry.channel }} ·
                          <v-chip :color="entry.status === 'ok' ? 'success' : 'error'" size="x-small">
                            {{ entry.status }}
                          </v-chip>
                        </div>
                        <div v-if="entry.error" class="text-error text-caption mb-1">
                          خطأ المزوّد: <span dir="ltr">{{ entry.error }}</span>
                        </div>
                        <div v-if="entry.requestPayload" class="text-caption">
                          <strong>الطلب (to):</strong>
                          <span dir="ltr" class="text-mono">{{ entry.requestPayload?.to ?? '—' }}</span>
                        </div>
                        <pre
                          v-if="entry.responsePayload"
                          class="text-caption text-mono mt-1"
                          dir="ltr"
                          style="white-space: pre-wrap; word-break: break-all"
                        >{{ formatJson(entry.responsePayload) }}</pre>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-if="!store.logs.length && !store.isLoading">
                <td colspan="7" class="text-center text-medium-emphasis py-6">
                  لا توجد رسائل في السجل بعد.
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>
    </template>

    <!-- Preview dialog -->
    <v-dialog v-model="previewVisible" max-width="500">
      <v-card>
        <v-card-title>معاينة الرسالة</v-card-title>
        <v-card-text>
          <div class="text-body-1" style="white-space: pre-wrap">{{ manual.message }}</div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="previewVisible = false">إغلاق</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useNotificationSettingsStore } from '@/stores/notificationSettings';
import { useCustomerStore } from '@/stores/customer';

const store = useNotificationSettingsStore();
const customerStore = useCustomerStore();

const form = reactive({
  enabled: false,
  provider: 'bulksmsiraq',
  senderId: '',
  smsEnabled: true,
  whatsappEnabled: false,
  autoFallbackEnabled: true,
  defaultChannel: 'auto',
  phoneFormat: 'e164',
  overdueReminderEnabled: true,
  paymentConfirmationEnabled: true,
  bulkMessagingEnabled: false,
  singleCustomerMessagingEnabled: true,
});

const apiKeyInput = ref('');
const showApiKey = ref(false);
const previewVisible = ref(false);
const sending = ref(false);

const expandedLogs = reactive({});
const logDetails = reactive({});
const logDetailsLoading = reactive({});

const manualTab = ref('single');
const manual = reactive({
  customerId: null,
  all: false,
  channel: 'auto',
  message: '',
});

const apiKeyLabel = computed(() =>
  store.settings.apiKeyConfigured ? 'مفتاح API الجديد (اتركه فارغاً للإبقاء)' : 'مفتاح API *'
);
const apiKeyPlaceholder = computed(() =>
  store.settings.apiKeyConfigured ? store.settings.apiKeyMasked || '••••••••' : 'أدخل مفتاح BulkSMSIraq'
);

const canTest = computed(
  () => !!apiKeyInput.value || store.settings.apiKeyConfigured
);

const providerItems = computed(() =>
  store.availableProviders.map((p) => ({ text: providerLabel(p), value: p }))
);

const channelItems = [
  { text: 'تلقائي', value: 'auto' },
  { text: 'SMS', value: 'sms' },
  { text: 'WhatsApp', value: 'whatsapp' },
];

const phoneFormatItems = [
  { text: 'دولي مع + (E.164، الافتراضي)', value: 'e164' },
  { text: 'دولي بدون + (مثل 9647...)', value: 'international' },
  { text: 'محلي (مثل 0790...)', value: 'local' },
];

const customerItems = computed(() =>
  (customerStore.customers || []).map((c) => ({
    id: c.id,
    label: `${c.name}${c.phone ? ' — ' + c.phone : ''}`,
  }))
);

function providerLabel(p) {
  if (p === 'bulksmsiraq') return 'BulkSMSIraq';
  return p;
}

function typeLabel(t) {
  switch (t) {
    case 'overdue_reminder':
      return 'تذكير قسط';
    case 'payment_confirmation':
      return 'تأكيد دفعة';
    case 'customer_message':
      return 'رسالة عميل';
    case 'bulk_message':
      return 'إرسال جماعي';
    default:
      return t;
  }
}

function statusLabel(s) {
  switch (s) {
    case 'pending':
      return 'بانتظار';
    case 'processing':
      return 'قيد المعالجة';
    case 'sent':
      return 'تم';
    case 'failed':
      return 'فشل';
    case 'cancelled':
      return 'ملغى';
    default:
      return s;
  }
}

function statusColor(s) {
  switch (s) {
    case 'sent':
      return 'success';
    case 'failed':
      return 'error';
    case 'processing':
      return 'info';
    case 'cancelled':
      return 'grey';
    default:
      return 'warning';
  }
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('ar-IQ');
  } catch {
    return String(value);
  }
}

function formatJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function toggleLogDetails(id) {
  if (expandedLogs[id]) {
    expandedLogs[id] = false;
    return;
  }
  expandedLogs[id] = true;
  if (!logDetails[id]) {
    logDetailsLoading[id] = true;
    try {
      logDetails[id] = await store.fetchLogDetails(id);
    } finally {
      logDetailsLoading[id] = false;
    }
  }
}

function applyFromStore() {
  const s = store.settings;
  form.enabled = !!s.enabled;
  form.provider = s.provider || 'bulksmsiraq';
  form.senderId = s.senderId || '';
  form.smsEnabled = !!s.smsEnabled;
  form.whatsappEnabled = !!s.whatsappEnabled;
  form.autoFallbackEnabled = !!s.autoFallbackEnabled;
  form.defaultChannel = s.defaultChannel || 'auto';
  form.phoneFormat = s.phoneFormat || 'e164';
  form.overdueReminderEnabled = !!s.overdueReminderEnabled;
  form.paymentConfirmationEnabled = !!s.paymentConfirmationEnabled;
  form.bulkMessagingEnabled = !!s.bulkMessagingEnabled;
  form.singleCustomerMessagingEnabled = !!s.singleCustomerMessagingEnabled;
}

function buildPatch() {
  const patch = { ...form };
  if (apiKeyInput.value && apiKeyInput.value.trim()) {
    patch.apiKey = apiKeyInput.value.trim();
  }
  return patch;
}

async function saveAll() {
  try {
    await store.saveSettings(buildPatch());
    apiKeyInput.value = '';
  } catch {
    /* handled by store */
  }
}

async function onToggleEnabled(value) {
  // Persist immediately so the user sees the effect on the rest of the form
  // (the conditional sections appear/hide based on the store state).
  try {
    await store.saveSettings({ enabled: !!value });
  } catch {
    // Revert UI on failure
    form.enabled = !value;
  }
}

async function testConnection() {
  try {
    await store.testConnection(apiKeyInput.value || null);
  } catch {
    /* handled by store */
  }
}

async function sendSingle() {
  sending.value = true;
  try {
    await store.sendCustomerMessage({
      customerId: manual.customerId,
      channel: manual.channel,
      message: manual.message,
    });
    manual.message = '';
    await store.fetchLogs();
  } catch {
    /* handled */
  } finally {
    sending.value = false;
  }
}

async function sendBulk() {
  sending.value = true;
  try {
    await store.sendBulkMessage({
      all: manual.all,
      channel: manual.channel,
      message: manual.message,
    });
    manual.message = '';
    await store.fetchLogs();
  } catch {
    /* handled */
  } finally {
    sending.value = false;
  }
}

watch(() => store.settings, applyFromStore, { deep: true });

onMounted(async () => {
  try {
    await store.fetchSettings();
    applyFromStore();
  } catch {
    /* handled */
  }
  try {
    await store.fetchLogs();
  } catch {
    /* handled */
  }
  if (!customerStore.customers || customerStore.customers.length === 0) {
    try {
      await customerStore.fetch({ limit: 200 });
    } catch {
      /* ignore — customer store will surface its own errors */
    }
  }
});
</script>

<style scoped>
.text-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
}
.messaging-settings {
  width: 100%;
}
</style>
