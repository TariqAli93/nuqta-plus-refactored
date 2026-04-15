<template>
  <v-app>
    <v-container fluid>
      <!-- Hero Header Section -->
      <div class="d-flex align-center justify-space-between mb-4">
        <h1 class="text-h4">التقارير والتحليلات</h1>

        <v-spacer />
        <v-btn
          color="primary"
          prepend-icon="mdi-file-export"
          :disabled="!report"
          @click="exportToPDF"
        >
          تصدير التقرير
        </v-btn>
      </div>

      <!-- Main Content Layout -->
      <v-row align="start" class="mt-2">
        <!-- Left Sidebar - Filters -->
        <v-col cols="12" md="3">
          <v-card elevation="0" rounded="xl" class="mb-6">
            <v-card-title class="pb-0">
              <v-icon size="24" class="ml-2">mdi-filter</v-icon>
              <span>فلترة البيانات</span>
            </v-card-title>
            <v-divider class="mb-3"></v-divider>
            <v-card-text>
              <v-form>
                <v-row dense>
                  <v-col cols="12" class="mb-2">
                    <label class="mb-1 d-block">من تاريخ</label>
                    <v-menu
                      v-model="menus.start"
                      :close-on-content-click="false"
                      min-width="auto"
                      transition="scale-transition"
                    >
                      <template #activator="{ props }">
                        <v-text-field
                          v-model="formattedStartDate"
                          readonly
                          prepend-inner-icon="mdi-calendar-start"
                          v-bind="props"
                          variant="outlined"
                          density="comfortable"
                          hide-details
                        ></v-text-field>
                      </template>
                      <v-date-picker
                        v-model="filters.startDate"
                        elevation="4"
                        view="date"
                        color="primary"
                        @update:model-value="
                          (val) => {
                            filters.startDate = val;
                            menus.start = false;
                          }
                        "
                        show-adjacent-months
                        :show-current="true"
                      ></v-date-picker>
                    </v-menu>
                  </v-col>
                  <v-col cols="12" class="mb-2">
                    <label class="mb-1 d-block">إلى تاريخ</label>
                    <v-menu
                      v-model="menus.end"
                      :close-on-content-click="false"
                      min-width="auto"
                      transition="scale-transition"
                    >
                      <template #activator="{ props }">
                        <v-text-field
                          v-model="formattedEndDate"
                          readonly
                          prepend-inner-icon="mdi-calendar-end"
                          v-bind="props"
                          variant="outlined"
                          density="comfortable"
                          hide-details
                        ></v-text-field>
                      </template>
                      <v-date-picker
                        v-model="filters.endDate"
                        elevation="4"
                        view="date"
                        color="primary"
                        @update:model-value="
                          (val) => {
                            filters.endDate = val;
                            menus.end = false;
                          }
                        "
                        show-adjacent-months
                        :show-current="true"
                      ></v-date-picker>
                    </v-menu>
                  </v-col>
                  <v-col cols="12" class="mb-2">
                    <label class="mb-1 d-block">العملة</label>
                    <v-select
                      v-model="filters.currency"
                      :items="currencyOptions"
                      item-title="title"
                      item-value="value"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-currency-usd"
                      hide-details
                    ></v-select>
                  </v-col>
                  <v-col cols="12" class="mt-4">
                    <v-btn
                      block
                      color="primary"
                      :loading="loading"
                      @click="fetchReport"
                    >
                      <v-icon start>mdi-magnify</v-icon>
                      عرض التقرير
                    </v-btn>
                  </v-col>
                </v-row>
              </v-form>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Main Content Area -->
        <v-col cols="12" md="9">
          <!-- Loading State -->
          <v-row v-if="loading" align="center" justify="center">
            <v-col cols="12" class="text-center py-12">
              <v-progress-circular indeterminate color="primary" size="64"></v-progress-circular>
              <p class="mt-2 mb-0">جاري تحميل التقرير...</p>
            </v-col>
          </v-row>

          <!-- Report Content -->
          <div v-else-if="report">
            <!-- Key Metrics -->
            <v-card elevation="2" class="mb-4 pa-4">
              <div class="d-flex align-center mb-4">
                <v-icon size="24" class="ml-2">mdi-chart-box-outline</v-icon>
                <h1 class="mb-0 text-h5">نظرة عامة على المبيعات</h1>
              </div>
              <v-row>
                <v-col cols="12" md="4">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="36" color="primary" class="mb-2">mdi-counter</v-icon>
                    <div class="text-h6 mt-2">{{ report.count ?? 0 }}</div>
                    <div class="caption grey--text mt-1">عدد المبيعات</div>
                  </v-card>
                </v-col>
                <v-col cols="12" md="4">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="36" color="success" class="mb-2">mdi-check-circle</v-icon>
                    <div class="text-h6 mt-2">{{ report.completedSales ?? 0 }}</div>
                    <div class="caption grey--text mt-1">مبيعات مكتملة</div>
                  </v-card>
                </v-col>
                <v-col cols="12" md="4">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="36" color="warning" class="mb-2">mdi-clock-outline</v-icon>
                    <div class="text-h6 mt-2">{{ report.pendingSales ?? 0 }}</div>
                    <div class="caption grey--text mt-1">مبيعات معلقة</div>
                  </v-card>
                </v-col>
              </v-row>
            </v-card>

            <!-- Financial Metrics -->
            <v-card elevation="2" class="mb-4 pa-4">
              <div class="d-flex align-center mb-4">
                <v-icon size="24" class="ml-2">mdi-cash-multiple</v-icon>
                <h1 class="mb-0 text-h5">
                  المؤشرات المالية
                  <span class="ml-2 currency-label">{{ reportByCurrency.currencyLabel }}</span>
                </h1>
              </div>
              <v-row >
                <v-col cols="12" md="3">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="32" color="primary" class="mb-1">mdi-cash</v-icon>
                    <div class="text-h6 mt-2">
                      {{ reportByCurrency.format(reportByCurrency.sales ?? 0) }}
                    </div>
                    <div class="caption grey--text mt-1">إجمالي المبيعات</div>
                  </v-card>
                </v-col>
                <v-col cols="12" md="3">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="32" color="success" class="mb-1">mdi-cash-check</v-icon>
                    <div class="text-h6 mt-2">
                      {{ reportByCurrency.format(reportByCurrency.paid ?? 0) }}
                    </div>
                    <div class="caption grey--text mt-1">المدفوع</div>
                  </v-card>
                </v-col>
                <v-col cols="12" md="3">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="32" color="red" class="mb-1">mdi-tag-off</v-icon>
                    <div class="text-h6 mt-2">
                      {{ reportByCurrency.format(reportByCurrency.discount ?? 0) }}
                    </div>
                    <div class="caption grey--text mt-1">إجمالي الخصومات</div>
                  </v-card>
                </v-col>
                <v-col cols="12" md="3">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="32" color="orange" class="mb-1">mdi-percent</v-icon>
                    <div class="text-h6 mt-2">
                      {{ reportByCurrency.format(reportByCurrency.interest ?? 0) }}
                    </div>
                    <div class="caption grey--text mt-1">إجمالي الفائدة</div>
                  </v-card>
                </v-col>
              </v-row>
            </v-card>

            <!-- Performance Metrics -->
            <v-card elevation="2" class="pa-4">
              <div class="d-flex align-center mb-4">
                <v-icon size="24" class="ml-2">mdi-trending-up</v-icon>
                <h1 class="mb-0 text-h5">مؤشرات الأداء</h1>
              </div>
              <v-row >
                <v-col cols="12" md="3">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="32" color="info" class="mb-1">mdi-finance</v-icon>
                    <div class="text-h6 mt-2">
                      {{ reportByCurrency.format(reportByCurrency.avgSale ?? 0) }}
                    </div>
                    <div class="caption grey--text mt-1">متوسط البيع</div>
                  </v-card>
                </v-col>
                <v-col cols="12" md="3">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="32" color="teal" class="mb-1">mdi-cash-plus</v-icon>
                    <div class="text-h6 mt-2">
                      {{ reportByCurrency.format(reportByCurrency.profit ?? 0) }}
                    </div>
                    <div class="caption grey--text mt-1">الربح</div>
                  </v-card>
                </v-col>
                <v-col cols="12" md="3">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="32" color="deep-purple" class="mb-1">mdi-poll</v-icon>
                    <div class="text-h6 mt-2">
                      {{ reportByCurrency.format(reportByCurrency.avgProfit ?? 0) }}
                    </div>
                    <div class="caption grey--text mt-1">متوسط الربح</div>
                  </v-card>
                </v-col>
                <v-col cols="12" md="3">
                  <v-card flat class="pa-4 text-center">
                    <v-icon size="32" color="lime-darken-2" class="mb-1">mdi-percent-circle</v-icon>
                    <div class="text-h6 mt-2">{{ reportByCurrency.profitMargin ?? 0 }}%</div>
                    <div class="caption grey--text mt-1">هامش الربح</div>
                  </v-card>
                </v-col>
              </v-row>
            </v-card>
          </div>

          <!-- Empty State -->
          <v-card v-else elevation="2" rounded="xl">
            <div class="pa-8 text-center">
              <div class="mb-2">
                <v-icon size="80" color="grey-lighten-1">mdi-chart-line-variant</v-icon>
              </div>
              <h3 class="mb-1">لا توجد بيانات</h3>
              <p class="grey--text text--darken-1">يرجى تحديد الفترة المطلوبة وعرض التقرير</p>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </v-app>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useSaleStore } from '@/stores/sale';
import { useNotificationStore } from '@/stores/notification';
import { useSettingsStore } from '@/stores/settings';

const saleStore = useSaleStore();
const notificationStore = useNotificationStore();
const settingsStore = useSettingsStore();
const loading = ref(false);
const report = ref(null);
const menus = ref({
  start: false,
  end: false,
});
const filters = ref({
  startDate: null,
  endDate: null,
  currency: null,
});

// Use settingsStore.availableCurrencies as array (fix default and fallback)
const currencyOptions = computed(() => {
  let available = settingsStore.availableCurrencies;
  if (!Array.isArray(available) || available.length === 0) {
    available = ['IQD', 'USD'];
  }
  return available.map((currency) => ({
    title: currency === 'USD' ? 'دولار (USD)' : 'دينار عراقي (IQD)',
    value: currency,
  }));
});

// defaultCurrency fallback IQD
const defaultCurrency = computed(() => settingsStore.settings?.defaultCurrency || 'IQD');

// selectedCurrency always fallback to default if not available or selected
const selectedCurrency = computed(() => {
  let available = settingsStore.availableCurrencies;
  if (!Array.isArray(available) || available.length === 0) {
    available = ['IQD', 'USD'];
  }
  if (filters.value.currency && available.includes(filters.value.currency)) {
    return filters.value.currency;
  }
  return defaultCurrency.value;
});

const toYmd = (date) => {
  if (!date) return '';
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  const d = new Date(date);
  if (isNaN(d)) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Fix: always format a number, even if input is null/undefined
const formatUSD = (amount) =>
  `$${parseFloat(amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const formatIQD = (amount) =>
  `${parseFloat(amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} IQD`;

const reportByCurrency = computed(() => {
  const cur = selectedCurrency.value;
  const r = report.value || {};
  const isUSD = cur === 'USD';
  return {
    currency: cur,
    sales: isUSD ? r.salesUSD : r.salesIQD,
    paid: isUSD ? r.paidUSD : r.paidIQD,
    discount: isUSD ? r.discountUSD : r.discountIQD,
    interest: isUSD ? r.interestUSD : r.interestIQD,
    profit: isUSD ? r.profitUSD : r.profitIQD,
    avgSale: isUSD ? r.avgSaleUSD : r.avgSaleIQD,
    avgProfit: isUSD ? r.avgProfitUSD : r.avgProfitIQD,
    profitMargin: isUSD ? r.profitMarginUSD : r.profitMarginIQD,
    format: isUSD ? formatUSD : formatIQD,
    currencyLabel: isUSD ? 'USD' : 'IQD',
  };
});

// Makes sure toYmd always returns a string for the field
const formattedStartDate = computed({
  get: () => toYmd(filters.value.startDate),
  set: (val) => {
    // Accept yyyy-mm-dd or Date
    filters.value.startDate = val ? val : null;
  },
});
const formattedEndDate = computed({
  get: () => toYmd(filters.value.endDate),
  set: (val) => {
    filters.value.endDate = val ? val : null;
  },
});

const fetchReport = async () => {
  loading.value = true;

  try {
    // Pass string dates for API compatibility
    report.value = await saleStore.getSalesReport({
      startDate: toYmd(filters.value.startDate),
      endDate: toYmd(filters.value.endDate),
      currency: filters.value.currency || defaultCurrency.value,
    });
  } catch (e) {
    notificationStore.error('حدث خطأ أثناء تحميل التقرير');
  } finally {
    loading.value = false;
  }
};

const exportToPDF = () => {
  if (!report.value) return;

  const win = window.open('', '', 'height=800,width=1000');
  // Format date fields for the PDF
  const startDateStr = formattedStartDate.value || '---';
  const endDateStr = formattedEndDate.value || '---';

  win.document.write(`
    <html dir="rtl">
      <head>
        <title>تقرير المبيعات</title>
        <style>
          body {
            font-family: "Cairo", Arial, sans-serif;
            padding: 30px;
            direction: rtl;
            color: #333;
          }
          h1 { text-align: center; color: #333; margin-bottom: 10px; }
          .subtitle { text-align: center; color: #555; font-size: 14px; margin-bottom: 30px; }
          .info-box {
            display: flex;
            justify-content: space-between;
            margin-bottom: 20px;
            border-radius: 8px;
            padding: 12px 20px;
          }
          .info-box div { font-size: 14px; color: #333; }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 25px;
            border-radius: 8px;
            overflow: hidden;
          }
          th {
            background: #1976d2;
            color: #fff;
            padding: 12px;
            font-size: 15px;
          }
          td {
            border: 1px solid #ccc;
            padding: 10px;
            text-align: center;
          }
          .footer {
            margin-top: 40px;
            text-align: center;
            font-size: 12px;
            color: #888;
          }
          .currency-label {
            font-weight: bold;
            color: #1976d2;
          }
        </style>
      </head>
      <body>
        <h1>📊 تقرير المبيعات</h1>
        <div class="subtitle">نظرة شاملة على الأداء المالي للفترة المحددة</div>
        <div class="info-box">
          <div><strong>من:</strong> ${startDateStr}</div>
          <div><strong>إلى:</strong> ${endDateStr}</div>
        </div>
        <table>
          <tr>
            <th>المقياس</th>
            <th><span class="currency-label">${reportByCurrency.value.currencyLabel}</span></th>
          </tr>
          <tr>
            <td>إجمالي المبيعات</td>
            <td>${reportByCurrency.value.format(reportByCurrency.value.sales ?? 0)}</td>
          </tr>
          <tr>
            <td>المدفوع</td>
            <td>${reportByCurrency.value.format(reportByCurrency.value.paid ?? 0)}</td>
          </tr>
          <tr>
            <td>إجمالي الخصومات</td>
            <td>${reportByCurrency.value.format(reportByCurrency.value.discount ?? 0)}</td>
          </tr>
          <tr>
            <td>إجمالي الفائدة</td>
            <td>${reportByCurrency.value.format(reportByCurrency.value.interest ?? 0)}</td>
          </tr>
          <tr>
            <td>متوسط البيع</td>
            <td>${reportByCurrency.value.format(reportByCurrency.value.avgSale ?? 0)}</td>
          </tr>
          <tr>
            <td>إجمالي الربح</td>
            <td>${reportByCurrency.value.format(reportByCurrency.value.profit ?? 0)}</td>
          </tr>
          <tr>
            <td>متوسط الربح</td>
            <td>${reportByCurrency.value.format(reportByCurrency.value.avgProfit ?? 0)}</td>
          </tr>
          <tr>
            <td>هامش الربح %</td>
            <td>${reportByCurrency.value.profitMargin ?? 0}%</td>
          </tr>
          <tr>
            <td>عدد الفواتير</td>
            <td>${report.value.count ?? 0}</td>
          </tr>
          <tr>
            <td>مبيعات مكتملة</td>
            <td>${report.value.completedSales ?? 0}</td>
          </tr>
          <tr>
            <td>مبيعات معلقة</td>
            <td>${report.value.pendingSales ?? 0}</td>
          </tr>
          <tr>
            <td>أقساط متأخرة</td>
            <td>${report.value.overdueInstallments ?? 0}</td>
          </tr>
        </table>
        <div class="footer">
          <p>تم إنشاء هذا التقرير تلقائيًا بتاريخ ${new Date().toLocaleDateString('ar', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            numberingSystem: 'latn',
          })}</p>
        </div>
      </body>
    </html>
  `);

  win.document.close();
  win.print();

  notificationStore.success('📄 تم تجهيز تقرير PDF للطباعة');
};

onMounted(() => {
  const load = async () => {
    try {
      await settingsStore.fetchCurrencySettings();
    } catch {}

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    // set start & end as yyyy-mm-dd, as expected by our UI and API
    filters.value.startDate = start.toISOString().split('T')[0];
    filters.value.endDate = end.toISOString().split('T')[0];
    filters.value.currency = defaultCurrency.value;
    fetchReport();
  };

  load();
});
</script>
