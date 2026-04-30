<template>
  <div class="page-shell">
    <!-- Loading state ---------------------------------------------------- -->
    <div v-if="loading" class="loading-state">
      <v-progress-circular indeterminate color="primary" size="56" />
      <div class="text-body-2 text-medium-emphasis">جاري تحميل بيانات العميل…</div>
    </div>

    <!-- Error / not-found state ------------------------------------------ -->
    <v-card v-else-if="error" class="pa-6">
      <EmptyState
        :title="errorTitle"
        :description="errorDescription"
        icon="mdi-alert-circle-outline"
        icon-color="error"
        :actions="[
          { text: 'العودة للعملاء', icon: 'mdi-arrow-right', to: '/customers', color: 'primary' },
        ]"
      />
    </v-card>

    <template v-else-if="profile">
      <!-- 1. Header ------------------------------------------------------- -->
      <v-card class="mb-4">
        <div class="pa-4 d-flex flex-wrap align-center gap-4">
          <v-avatar size="56" color="primary" class="text-white">
            <v-icon size="32">mdi-account</v-icon>
          </v-avatar>

          <div class="flex-grow-1">
            <div class="d-flex align-center flex-wrap gap-2">
              <div class="text-h5 font-weight-bold text-primary">
                {{ profile.customer.name }}
              </div>
              <v-chip
                size="small"
                :color="profile.customer.isActive ? 'success' : 'grey'"
                variant="tonal"
              >
                {{ profile.customer.isActive ? 'نشط' : 'غير نشط' }}
              </v-chip>
              <v-chip
                v-if="profile.customer.branch?.name"
                size="small"
                variant="tonal"
                color="info"
              >
                <v-icon start size="16">mdi-store</v-icon>
                {{ profile.customer.branch.name }}
              </v-chip>
            </div>
            <div class="text-caption text-grey mt-1 d-flex flex-wrap gap-3">
              <span v-if="profile.customer.phone">
                <v-icon size="14">mdi-phone</v-icon>
                {{ profile.customer.phone }}
              </span>
              <span v-if="profile.customer.address">
                <v-icon size="14">mdi-map-marker</v-icon>
                {{ profile.customer.address }}
              </span>
              <span v-if="profile.customer.createdAt">
                <v-icon size="14">mdi-calendar</v-icon>
                عميل منذ {{ formatDate(profile.customer.createdAt) }}
              </span>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-2">
            <v-btn
              v-if="profile.customer.phone"
              prepend-icon="mdi-phone"
              variant="tonal"
              color="success"
              size="small"
              @click="showCustomerPhoneNumber = true"
            >
              اضهار رقم الهاتف
            </v-btn>

            <!-- WhatsApp message button — gated by notification settings ---- -->
            <v-tooltip
              v-if="canSendCustomerMessages"
              location="bottom"
              :text="whatsAppDisabledReason"
              :disabled="canSendWhatsApp"
            >
              <template #activator="{ props: tooltipProps }">
                <span v-bind="tooltipProps">
                  <v-btn
                    prepend-icon="mdi-whatsapp"
                    variant="tonal"
                    color="success"
                    size="small"
                    :disabled="!canSendWhatsApp"
                    :loading="messagingSettingsLoading"
                    @click="openWhatsAppDialog"
                  >
                    رسالة واتساب
                  </v-btn>
                </span>
              </template>
              <span>{{ whatsAppDisabledReason }}</span>
            </v-tooltip>

            <v-btn
              v-if="canEdit"
              :to="`/customers/${profile.customer.id}/edit`"
              prepend-icon="mdi-pencil"
              variant="tonal"
              size="small"
            >
              تعديل
            </v-btn>
          </div>
        </div>
      </v-card>

      <!-- Multi-currency / conversion warnings ---------------------------- -->
      <v-alert
        v-for="warning in profile.meta?.warnings || []"
        :key="warning.code"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
        :icon="warning.code === 'MULTI_CURRENCY' ? 'mdi-currency-usd' : 'mdi-information'"
      >
        {{ warningText(warning) }}
      </v-alert>

      <!-- 2. KPI cards ---------------------------------------------------- -->
      <v-row class="mb-1">
        <v-col v-for="kpi in kpiCards" :key="kpi.key" cols="6" md="4" lg="2">
          <v-card class="pa-3 h-100" variant="tonal" :color="kpi.color">
            <div class="text-caption text-grey-darken-1">{{ kpi.label }}</div>
            <div class="text-h6 font-weight-bold mt-1">{{ kpi.value }}</div>
            <div v-if="kpi.hint" class="text-caption text-grey mt-1">{{ kpi.hint }}</div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Per-currency breakdown when more than one currency is in play --- -->
      <v-card v-if="profile.meta?.multiCurrency" class="mb-4" variant="outlined">
        <v-card-title class="text-subtitle-1"> الأرصدة حسب العملة </v-card-title>
        <v-divider />
        <v-table density="compact">
          <thead>
            <tr>
              <th>العملة</th>
              <th class="text-end">إجمالي المشتريات</th>
              <th class="text-end">المدفوع</th>
              <th class="text-end">المتبقي</th>
              <th class="text-end">عدد الفواتير</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in profile.summary.byCurrency" :key="row.currency">
              <td>
                <v-chip size="x-small">{{ row.currency }}</v-chip>
              </td>
              <td class="text-end">{{ formatCurrency(row.totalPurchases, row.currency) }}</td>
              <td class="text-end text-success">
                {{ formatCurrency(row.totalPaid, row.currency) }}
              </td>
              <td class="text-end" :class="row.totalRemaining > 0 ? 'text-error' : ''">
                {{ formatCurrency(row.totalRemaining, row.currency) }}
              </td>
              <td class="text-end">{{ row.salesCount }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card>

      <!-- Aging buckets for this customer's overdue installments -->
      <AgingPanel :data="customerAging" :loading="agingLoading" class="mb-4" />

      <!-- 3. Tabs --------------------------------------------------------- -->
      <v-card>
        <v-tabs v-model="activeTab" color="primary" align-tabs="start" show-arrows>
          <v-tab value="overview">نظرة عامة</v-tab>
          <v-tab value="purchases">
            المشتريات
            <v-chip v-if="profile.sales.length" size="x-small" class="ms-2">
              {{ profile.sales.length }}
            </v-chip>
          </v-tab>
          <v-tab value="installments">
            الأقساط
            <v-chip v-if="profile.installments.length" size="x-small" class="ms-2">
              {{ profile.installments.length }}
            </v-chip>
          </v-tab>
          <v-tab value="payments">
            الدفعات
            <v-chip v-if="profile.payments.length" size="x-small" class="ms-2">
              {{ profile.payments.length }}
            </v-chip>
          </v-tab>
          <v-tab v-if="canCollect" value="collections">
            التحصيل
            <v-chip v-if="overdueInstallments.length" size="x-small" color="error" class="ms-2">
              {{ overdueInstallments.length }}
            </v-chip>
          </v-tab>
          <v-tab value="timeline">سجل الديون</v-tab>
        </v-tabs>

        <v-divider />

        <v-window v-model="activeTab">
          <!-- Overview ---------------------------------------------------- -->
          <v-window-item value="overview">
            <div class="pa-4">
              <v-row>
                <v-col cols="12" md="6">
                  <div class="text-subtitle-2 mb-2">معلومات الاتصال</div>
                  <div class="text-body-2">
                    <p><strong>الاسم:</strong> {{ profile.customer.name }}</p>
                    <p><strong>الهاتف:</strong> {{ profile.customer.phone || '—' }}</p>
                    <p><strong>المدينة:</strong> {{ profile.customer.city || '—' }}</p>
                    <p><strong>العنوان:</strong> {{ profile.customer.address || '—' }}</p>
                    <p v-if="profile.customer.notes">
                      <strong>ملاحظات:</strong> {{ profile.customer.notes }}
                    </p>
                  </div>
                </v-col>
                <v-col cols="12" md="6">
                  <div class="text-subtitle-2 mb-2">الملخص</div>
                  <div class="text-body-2">
                    <p>
                      <strong>عدد الفواتير:</strong>
                      {{ profile.summary.salesCount }}
                      <span v-if="profile.summary.cancelledSales" class="text-grey">
                        (ملغاة: {{ profile.summary.cancelledSales }})
                      </span>
                    </p>
                    <p>
                      <strong>أقساط نشطة:</strong>
                      {{ profile.summary.activeInstallments }}
                    </p>
                    <p>
                      <strong>أقساط مكتملة:</strong>
                      {{ profile.summary.completedInstallments }}
                    </p>
                    <p v-if="profile.customer.creditScore != null">
                      <strong>التصنيف الائتماني:</strong>
                      {{ profile.customer.creditScore }}
                    </p>
                  </div>
                </v-col>
              </v-row>
            </div>
          </v-window-item>

          <!-- Purchases --------------------------------------------------- -->
          <v-window-item value="purchases">
            <div v-if="!profile.sales.length" class="pa-6">
              <EmptyState
                title="لا توجد مشتريات"
                description="لم يقم العميل بأي شراء بعد"
                icon="mdi-receipt-text-outline"
                compact
              />
            </div>
            <v-data-table
              v-else
              :headers="salesHeaders"
              :items="profile.sales"
              :items-per-page="10"
              density="comfortable"
            >
              <template #[`item.invoiceNumber`]="{ item }">
                <RouterLink :to="`/sales/${item.id}`" class="text-primary text-decoration-none">
                  {{ item.invoiceNumber }}
                </RouterLink>
              </template>
              <template #[`item.date`]="{ item }">
                {{ formatDate(item.date) }}
              </template>
              <template #[`item.type`]="{ item }">
                {{ saleTypeLabel(item) }}
              </template>
              <template #[`item.total`]="{ item }">
                {{ formatCurrency(item.total, item.currency) }}
              </template>
              <template #[`item.paid`]="{ item }">
                <span class="text-success">
                  {{ formatCurrency(item.paid, item.currency) }}
                </span>
              </template>
              <template #[`item.remaining`]="{ item }">
                <span :class="item.remaining > 0 ? 'text-error' : ''">
                  {{ formatCurrency(item.remaining, item.currency) }}
                </span>
              </template>
              <template #[`item.status`]="{ item }">
                <v-chip :color="statusColor(item.status)" size="x-small">
                  {{ statusLabel(item.status) }}
                </v-chip>
              </template>
              <template #[`item.actions`]="{ item }">
                <v-btn
                  icon="mdi-eye"
                  size="x-small"
                  variant="text"
                  :to="`/sales/${item.id}`"
                  aria-label="عرض الفاتورة"
                />
              </template>
            </v-data-table>
          </v-window-item>

          <!-- Installments ----------------------------------------------- -->
          <v-window-item value="installments">
            <div v-if="!profile.installments.length" class="pa-6">
              <EmptyState
                title="لا توجد أقساط"
                description="ليس على هذا العميل أي أقساط"
                icon="mdi-calendar-clock"
                compact
              />
            </div>
            <v-data-table
              v-else
              :headers="installmentHeaders"
              :items="profile.installments"
              :items-per-page="10"
              density="comfortable"
            >
              <template #[`item.invoiceNumber`]="{ item }">
                <RouterLink
                  v-if="item.saleId"
                  :to="`/sales/${item.saleId}`"
                  class="text-primary text-decoration-none"
                >
                  {{ item.invoiceNumber || `#${item.saleId}` }}
                </RouterLink>
                <span v-else>—</span>
              </template>
              <template #[`item.dueDate`]="{ item }">
                {{ item.dueDate || '—' }}
              </template>
              <template #[`item.dueAmount`]="{ item }">
                {{ formatCurrency(item.dueAmount, item.currency) }}
              </template>
              <template #[`item.paidAmount`]="{ item }">
                {{ formatCurrency(item.paidAmount, item.currency) }}
              </template>
              <template #[`item.remainingAmount`]="{ item }">
                <span :class="item.remainingAmount > 0 ? 'text-error' : ''">
                  {{ formatCurrency(item.remainingAmount, item.currency) }}
                </span>
              </template>
              <template #[`item.overdueDays`]="{ item }">
                <span v-if="item.overdueDays > 0" class="text-error font-weight-bold">
                  {{ item.overdueDays }} يوم
                </span>
                <span v-else>—</span>
              </template>
              <template #[`item.status`]="{ item }">
                <v-chip :color="installmentColor(item)" size="x-small">
                  {{ installmentLabel(item) }}
                </v-chip>
              </template>
              <template #[`item.actions`]="{ item }">
                <v-btn
                  v-if="canCollect && item.status !== 'cancelled'"
                  icon="mdi-clipboard-text-clock-outline"
                  size="x-small"
                  variant="text"
                  color="primary"
                  aria-label="إجراء تحصيل"
                  @click="openActionDialog(item)"
                />
              </template>
            </v-data-table>
          </v-window-item>

          <!-- Collections -------------------------------------------------- -->
          <v-window-item v-if="canCollect" value="collections">
            <div class="pa-4">
              <!-- Overdue summary --------------------------------------- -->
              <div class="text-subtitle-1 font-weight-bold mb-2">
                المتأخرات ({{ overdueInstallments.length }})
              </div>
              <v-card v-if="!overdueInstallments.length" variant="tonal" class="pa-4 mb-4">
                <div class="text-body-2 text-success">
                  <v-icon start size="20" color="success">mdi-check-circle</v-icon>
                  لا توجد أقساط متأخرة على هذا العميل
                </div>
              </v-card>
              <v-data-table
                v-else
                :headers="collectionsInstallmentHeaders"
                :items="overdueInstallments"
                :items-per-page="5"
                density="comfortable"
                class="mb-4"
              >
                <template #[`item.invoiceNumber`]="{ item }">
                  <RouterLink
                    v-if="item.saleId"
                    :to="`/sales/${item.saleId}`"
                    class="text-primary text-decoration-none"
                  >
                    {{ item.invoiceNumber || `#${item.saleId}` }}
                  </RouterLink>
                </template>
                <template #[`item.dueAmount`]="{ item }">
                  {{ formatCurrency(item.dueAmount, item.currency) }}
                </template>
                <template #[`item.remainingAmount`]="{ item }">
                  <span class="text-error font-weight-bold">
                    {{ formatCurrency(item.remainingAmount, item.currency) }}
                  </span>
                </template>
                <template #[`item.overdueDays`]="{ item }">
                  <span class="text-error font-weight-bold">{{ item.overdueDays }} يوم</span>
                </template>
                <template #[`item.actions`]="{ item }">
                  <v-btn
                    size="x-small"
                    color="primary"
                    variant="tonal"
                    prepend-icon="mdi-clipboard-text-clock-outline"
                    @click="openActionDialog(item)"
                  >
                    إجراء
                  </v-btn>
                </template>
              </v-data-table>

              <!-- Upcoming summary -------------------------------------- -->
              <div class="text-subtitle-1 font-weight-bold mb-2">
                القادمة ({{ upcomingInstallments.length }})
              </div>
              <v-data-table
                v-if="upcomingInstallments.length"
                :headers="collectionsInstallmentHeaders"
                :items="upcomingInstallments"
                :items-per-page="5"
                density="comfortable"
                class="mb-4"
              >
                <template #[`item.invoiceNumber`]="{ item }">
                  <RouterLink
                    v-if="item.saleId"
                    :to="`/sales/${item.saleId}`"
                    class="text-primary text-decoration-none"
                  >
                    {{ item.invoiceNumber || `#${item.saleId}` }}
                  </RouterLink>
                </template>
                <template #[`item.dueAmount`]="{ item }">
                  {{ formatCurrency(item.dueAmount, item.currency) }}
                </template>
                <template #[`item.remainingAmount`]="{ item }">
                  {{ formatCurrency(item.remainingAmount, item.currency) }}
                </template>
                <template #[`item.overdueDays`]>—</template>
                <template #[`item.actions`]="{ item }">
                  <v-btn
                    size="x-small"
                    variant="text"
                    prepend-icon="mdi-clipboard-text-clock-outline"
                    @click="openActionDialog(item)"
                  >
                    إجراء
                  </v-btn>
                </template>
              </v-data-table>
              <v-card
                v-else
                variant="tonal"
                color="grey-lighten-3"
                class="pa-4 mb-4 text-body-2 text-grey"
              >
                لا توجد أقساط قادمة
              </v-card>

              <!-- Action history ---------------------------------------- -->
              <div class="text-subtitle-1 font-weight-bold mb-2">
                سجل الإجراءات ({{ collectionHistory.length }})
              </div>
              <v-card v-if="collectionsLoading" variant="outlined" class="pa-4 text-center">
                <v-progress-circular indeterminate size="24" />
              </v-card>
              <v-card v-else-if="!collectionHistory.length" variant="tonal" class="pa-4">
                <div class="text-body-2 text-grey">
                  لم يتم تسجيل أي إجراء تحصيل لهذا العميل بعد.
                </div>
              </v-card>
              <v-table v-else density="comfortable">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>النوع</th>
                    <th>القسط</th>
                    <th>التفاصيل</th>
                    <th>المستخدم</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in collectionHistory" :key="row.id">
                    <td>{{ formatDate(row.createdAt) }}</td>
                    <td>
                      <v-chip size="x-small" :color="actionTypeColor(row.actionType)">
                        {{ actionTypeLabel(row.actionType) }}
                      </v-chip>
                    </td>
                    <td>
                      <RouterLink
                        v-if="row.saleId"
                        :to="`/sales/${row.saleId}`"
                        class="text-primary text-decoration-none"
                      >
                        {{ row.invoiceNumber || `#${row.saleId}` }}
                      </RouterLink>
                      <span v-if="row.installmentNumber" class="text-grey ms-1">
                        / قسط {{ row.installmentNumber }}
                      </span>
                    </td>
                    <td class="text-body-2">
                      <div v-if="row.actionType === 'promise_to_pay'">
                        وعد بدفع
                        {{ formatCurrency(row.promisedAmount, row.installmentCurrency) }}
                        بتاريخ {{ row.promisedDate || '—' }}
                      </div>
                      <div v-else-if="row.actionType === 'reschedule'">
                        تأجيل من {{ row.oldDueDate || '—' }} إلى {{ row.newDueDate || '—' }}
                      </div>
                      <div v-else-if="row.actionType === 'payment'">
                        تم تسجيل دفعة (#{{ row.paymentId || '—' }})
                      </div>
                      <div v-if="row.note" class="text-caption text-grey">{{ row.note }}</div>
                      <span
                        v-if="
                          !row.note &&
                          !['promise_to_pay', 'reschedule', 'payment'].includes(row.actionType)
                        "
                        >—</span
                      >
                    </td>
                    <td>{{ row.username || '—' }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </v-window-item>

          <!-- Payments --------------------------------------------------- -->
          <v-window-item value="payments">
            <div v-if="!profile.payments.length" class="pa-6">
              <EmptyState
                title="لا توجد دفعات"
                description="لم يسجل أي دفعة لهذا العميل بعد"
                icon="mdi-cash-multiple"
                compact
              />
            </div>
            <v-data-table
              v-else
              :headers="paymentHeaders"
              :items="profile.payments"
              :items-per-page="10"
              density="comfortable"
            >
              <template #[`item.date`]="{ item }">
                {{ formatDate(item.date) }}
              </template>
              <template #[`item.amount`]="{ item }">
                <span class="text-success font-weight-bold">
                  {{ formatCurrency(item.amount, item.currency) }}
                </span>
              </template>
              <template #[`item.method`]="{ item }">
                {{ paymentMethodLabel(item.method) }}
              </template>
              <template #[`item.invoiceNumber`]="{ item }">
                <RouterLink
                  v-if="item.saleId"
                  :to="`/sales/${item.saleId}`"
                  class="text-primary text-decoration-none"
                >
                  {{ item.invoiceNumber || `#${item.saleId}` }}
                </RouterLink>
                <span v-else>—</span>
              </template>
            </v-data-table>
          </v-window-item>

          <!-- Debt timeline ---------------------------------------------- -->
          <v-window-item value="timeline">
            <div v-if="!profile.timeline.length" class="pa-6">
              <EmptyState
                title="لا توجد حركات"
                description="لا يوجد سجل ديون لهذا العميل"
                icon="mdi-format-list-bulleted-square"
                compact
              />
            </div>
            <v-table v-else density="comfortable">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th>الوصف</th>
                  <th class="text-end">مدين</th>
                  <th class="text-end">دائن</th>
                  <th class="text-end">الرصيد</th>
                  <th>العملة</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in profile.timeline" :key="idx">
                  <td>{{ formatDate(row.date) }}</td>
                  <td>
                    <v-chip
                      size="x-small"
                      :color="row.type === 'sale' ? 'warning' : 'success'"
                      variant="tonal"
                    >
                      {{ row.type === 'sale' ? 'فاتورة' : 'دفعة' }}
                    </v-chip>
                  </td>
                  <td>{{ row.description }}</td>
                  <td class="text-end">
                    <span v-if="row.debit" class="text-warning">
                      {{ formatCurrency(row.debit, row.currency) }}
                    </span>
                  </td>
                  <td class="text-end">
                    <span v-if="row.credit" class="text-success">
                      {{ formatCurrency(row.credit, row.currency) }}
                    </span>
                  </td>
                  <td
                    class="text-end font-weight-bold"
                    :class="row.balance > 0 ? 'text-error' : 'text-success'"
                  >
                    {{ formatCurrency(row.balance, row.currency) }}
                  </td>
                  <td>
                    <v-chip size="x-small">{{ row.currency }}</v-chip>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-window-item>
        </v-window>
      </v-card>
    </template>

    <!-- WhatsApp message dialog ---------------------------------------- -->
    <v-dialog v-model="whatsAppDialog" max-width="560" persistent>
      <v-card>
        <v-card-title class="d-flex align-center gap-2">
          <v-icon color="success">mdi-whatsapp</v-icon>
          <span>إرسال رسالة واتساب</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <div class="text-body-2 mb-3">
            <p class="mb-1"><strong>العميل:</strong> {{ profile?.customer?.name }}</p>
            <p class="mb-0"><strong>الهاتف:</strong> {{ profile?.customer?.phone }}</p>
          </div>
          <v-textarea
            v-model="messageBody"
            label="نص الرسالة"
            rows="5"
            counter="1600"
            :max-length="1600"
            :rules="[
              (v) => !!(v && v.trim()) || 'النص مطلوب',
              (v) => (v && v.length <= 1600) || 'النص أطول من الحد المسموح',
            ]"
            auto-grow
            persistent-counter
          />

          <div class="text-caption text-grey mb-1">معاينة</div>
          <v-card variant="tonal" color="success" class="pa-3 message-preview">
            <pre class="ma-0">{{ messagePreview }}</pre>
          </v-card>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="sendingMessage" @click="whatsAppDialog = false">
            إلغاء
          </v-btn>
          <v-btn
            color="success"
            prepend-icon="mdi-send"
            :loading="sendingMessage"
            :disabled="!canSubmitMessage"
            @click="sendWhatsAppMessage"
          >
            إرسال
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Collection action dialog --------------------------------------- -->
    <v-dialog v-model="actionDialog" max-width="560" persistent>
      <v-card v-if="actionTarget">
        <v-card-title class="d-flex align-center gap-2">
          <v-icon color="primary">mdi-clipboard-text-clock-outline</v-icon>
          <span>إجراء تحصيل</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <div class="text-body-2 mb-3">
            <p class="mb-1">
              <strong>الفاتورة:</strong>
              {{ actionTarget.invoiceNumber || `#${actionTarget.saleId}` }}
              / قسط {{ actionTarget.installmentNumber }}
            </p>
            <p class="mb-1"><strong>الاستحقاق:</strong> {{ actionTarget.dueDate || '—' }}</p>
            <p class="mb-0">
              <strong>المتبقي:</strong>
              <span :class="actionTarget.remainingAmount > 0 ? 'text-error' : ''">
                {{ formatCurrency(actionTarget.remainingAmount, actionTarget.currency) }}
              </span>
            </p>
          </div>

          <v-select
            v-model="actionForm.actionType"
            :items="actionTypeOptions"
            label="نوع الإجراء"
            variant="outlined"
            density="comfortable"
            class="mb-4"
          />

          <!-- promise_to_pay fields -->
          <template v-if="actionForm.actionType === 'promise_to_pay'">
            <v-text-field
              v-model.number="actionForm.promisedAmount"
              type="number"
              label="المبلغ الموعود"
              variant="outlined"
              density="comfortable"
              :prefix="actionTarget.currency"
              class="mb-4"
            />
            <v-text-field
              v-model="actionForm.promisedDate"
              type="date"
              label="تاريخ الوعد"
              variant="outlined"
              density="comfortable"
              class="mb-4"
            />
          </template>

          <!-- reschedule field -->
          <template v-if="actionForm.actionType === 'reschedule'">
            <v-text-field
              v-model="actionForm.newDueDate"
              type="date"
              label="تاريخ الاستحقاق الجديد"
              variant="outlined"
              density="comfortable"
              class="mb-4"
            />
          </template>

          <!-- payment fields -->
          <template v-if="actionForm.actionType === 'payment'">
            <v-text-field
              v-model.number="actionForm.amount"
              type="number"
              label="مبلغ الدفعة"
              variant="outlined"
              density="comfortable"
              :prefix="actionTarget.currency"
              :hint="`المتبقي: ${formatCurrency(actionTarget.remainingAmount, actionTarget.currency)}`"
              persistent-hint
              class="mb-4"
            />
            <v-select
              v-model="actionForm.paymentMethod"
              :items="[
                { title: 'نقد', value: 'cash' },
                { title: 'بطاقة', value: 'card' },
              ]"
              label="طريقة الدفع"
              variant="outlined"
              density="comfortable"
              class="mb-4"
            />
            <v-text-field
              v-if="actionForm.paymentMethod === 'card'"
              v-model="actionForm.paymentReference"
              label="مرجع البطاقة"
              variant="outlined"
              density="comfortable"
              class="mb-4"
            />
          </template>

          <v-textarea
            v-model="actionForm.note"
            label="ملاحظة (اختياري)"
            rows="3"
            variant="outlined"
            density="comfortable"
            counter="2000"
            :max-length="2000"
            auto-grow
            class="mb-4"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="actionSubmitting" @click="actionDialog = false">
            إلغاء
          </v-btn>
          <v-btn
            color="primary"
            prepend-icon="mdi-content-save"
            :loading="actionSubmitting"
            :disabled="!canSubmitAction"
            @click="submitAction"
          >
            حفظ
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- show customer phone number -->
    <v-dialog v-model="showCustomerPhoneNumber" max-width="560" persistent>
      <v-card>
        <v-card-title class="d-flex align-center gap-2">
          <v-spacer />
          <v-btn
            variant="text"
            icon="mdi-close"
            size="small"
            color="error"
            @click="showCustomerPhoneNumber = false"
          >
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text class="pt-4 text-center">
          <v-btn block color="success" size="large" variant="tonal" @click="copyPhoneNumber">
            <span>{{ profile?.customer?.phone }}</span>
          </v-btn>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { useCustomerStore } from '@/stores/customer';
import { useAuthStore } from '@/stores/auth';
import { useNotificationSettingsStore } from '@/stores/notificationSettings';
import { useNotificationStore } from '@/stores/notification';
import { useCollectionsStore } from '@/stores/collections';
import * as uiAccess from '@/auth/uiAccess.js';
import EmptyState from '@/components/EmptyState.vue';
import AgingPanel from '@/components/reports/AgingPanel.vue';
import api from '@/plugins/axios';
import {
  formatCurrency,
  toYmdWithTime,
  getStatusColor,
  getStatusText,
  getPaymentMethodText,
} from '@/utils/helpers';

const route = useRoute();
const customerStore = useCustomerStore();
const authStore = useAuthStore();
const notificationSettingsStore = useNotificationSettingsStore();
const toastStore = useNotificationStore();
const collectionsStore = useCollectionsStore();

const loading = ref(true);
const error = ref(null);
const profile = ref(null);
const activeTab = ref('overview');
const showCustomerPhoneNumber = ref(false);
const customerAging = ref(null);
const agingLoading = ref(false);

async function loadCustomerAging(customerId) {
  if (!customerId) {
    customerAging.value = null;
    return;
  }
  agingLoading.value = true;
  try {
    const res = await api.get(`/customers/${customerId}/aging`);
    customerAging.value = res?.data || null;
  } catch {
    customerAging.value = null;
  } finally {
    agingLoading.value = false;
  }
}

const userRole = computed(() => authStore.user?.role);
const canEdit = computed(() => uiAccess.canManageCustomers(userRole.value));
const canAddPayment = computed(() => uiAccess.canAddPayments(userRole.value));
// Collections actions reuse the sales:update permission gate (same backend
// rule as adding a payment), so the UI surfaces the workflow exactly when
// the user could already record a payment elsewhere.
const canCollect = computed(() => uiAccess.canAddPayments(userRole.value));
// Only admins / managers with settings:manage can read messaging settings,
// so only they can know whether the WhatsApp gate is satisfied. Hide the
// button for everyone else.
const canSendCustomerMessages = computed(() => uiAccess.canManageSettings(userRole.value));

const copyPhoneNumber = () => {
  navigator.clipboard.writeText(profile.value?.customer?.phone);
  toastStore.success('تم النسخ بنجاح');
  showCustomerPhoneNumber.value = false;
};

const errorTitle = computed(() => {
  if (error.value?.statusCode === 404) return 'العميل غير موجود';
  return 'تعذر تحميل ملف العميل';
});
const errorDescription = computed(() => {
  if (error.value?.statusCode === 404) {
    return 'قد يكون العميل محذوفاً أو خارج نطاق الفرع المتاح لك.';
  }
  return error.value?.message || 'حدث خطأ غير متوقع. حاول إعادة المحاولة لاحقاً.';
});

// ── WhatsApp messaging (uses notification system) ──────────────────────
const whatsAppDialog = ref(false);
const sendingMessage = ref(false);
const messageBody = ref('');
const messagingSettingsLoading = ref(false);

const messagingSettings = computed(() => notificationSettingsStore.settings);

const hasValidPhone = computed(() => {
  const phone = profile.value?.customer?.phone || '';
  // Loose pre-check: the backend re-validates with normalizeIraqPhone.
  return /\d{6,}/.test(phone.replace(/[^\d]/g, ''));
});

const canSendWhatsApp = computed(() => {
  if (!canSendCustomerMessages.value) return false;
  if (!hasValidPhone.value) return false;
  const s = messagingSettings.value;
  if (!s) return false;
  return (
    s.enabled === true &&
    s.whatsappEnabled === true &&
    s.singleCustomerMessagingEnabled === true &&
    s.apiKeyConfigured === true
  );
});

const whatsAppDisabledReason = computed(() => {
  if (!canSendCustomerMessages.value) return 'تحتاج صلاحية إدارة الإعدادات لإرسال الرسائل';
  if (!hasValidPhone.value) return 'لا يوجد رقم هاتف صالح لهذا العميل';
  const s = messagingSettings.value;
  if (!s || messagingSettingsLoading.value) return 'جاري تحميل إعدادات المراسلة…';
  if (!s.enabled) return 'نظام المراسلة معطّل من الإعدادات';
  if (!s.whatsappEnabled) return 'قناة واتساب معطلة من الإعدادات';
  if (!s.singleCustomerMessagingEnabled) return 'إرسال الرسائل الفردية للعملاء معطل';
  if (!s.apiKeyConfigured) return 'لم يتم ضبط مفتاح API لمزود الرسائل';
  return '';
});

const messagePreview = computed(() => {
  const txt = (messageBody.value || '').trim();
  return txt || '— الرسالة فارغة —';
});

const canSubmitMessage = computed(
  () => canSendWhatsApp.value && messageBody.value.trim().length > 0 && !sendingMessage.value
);

const ensureMessagingSettings = async () => {
  if (!canSendCustomerMessages.value) return;
  // Refresh on every dialog open so an admin who just toggled a flag in
  // another tab sees the current state immediately.
  messagingSettingsLoading.value = true;
  try {
    await notificationSettingsStore.fetchSettings();
  } catch {
    // The store already toasts on failure — swallow so we don't double-toast.
  } finally {
    messagingSettingsLoading.value = false;
  }
};

const openWhatsAppDialog = async () => {
  await ensureMessagingSettings();
  if (!canSendWhatsApp.value) {
    if (whatsAppDisabledReason.value) {
      toastStore.warning(whatsAppDisabledReason.value);
    }
    return;
  }
  messageBody.value = '';
  whatsAppDialog.value = true;
};

const sendWhatsAppMessage = async () => {
  if (!canSubmitMessage.value || !profile.value?.customer?.id) return;
  sendingMessage.value = true;
  try {
    const res = await notificationSettingsStore.sendCustomerMessage({
      customerId: profile.value.customer.id,
      // Force WhatsApp; never let the dialog fall back to SMS silently.
      channel: 'whatsapp',
      message: messageBody.value.trim(),
    });
    if (res?.success) {
      whatsAppDialog.value = false;
      messageBody.value = '';
      // Refresh logs filtered to this customer when the admin already has
      // the notifications view open elsewhere — silently swallow if the
      // logs endpoint isn't reachable for this user.
      try {
        await notificationSettingsStore.fetchLogs({
          customerId: profile.value.customer.id,
          limit: 20,
        });
      } catch {
        /* non-fatal */
      }
    }
  } catch {
    // Store already surfaces an error toast.
  } finally {
    sendingMessage.value = false;
  }
};

// ── KPI cards ────────────────────────────────────────────────────────────
// We deliberately avoid summing across currencies. The KPI uses the
// "primary" currency — the one with the most sales. Multi-currency users
// see the full per-currency breakdown table just below the cards.
const primaryCurrency = computed(() => {
  const list = profile.value?.summary?.byCurrency || [];
  if (!list.length) return 'USD';
  const sorted = [...list].sort((a, b) => b.salesCount - a.salesCount);
  return sorted[0].currency;
});

const primarySummary = computed(() => {
  const list = profile.value?.summary?.byCurrency || [];
  return list.find((r) => r.currency === primaryCurrency.value) || null;
});

const kpiCards = computed(() => {
  if (!profile.value) return [];
  const summary = profile.value.summary;
  const cur = primaryCurrency.value;
  const ps = primarySummary.value;
  return [
    {
      key: 'purchases',
      label: 'إجمالي المشتريات',
      value: formatCurrency(ps?.totalPurchases ?? 0, cur),
      color: 'primary',
      hint: profile.value.meta?.multiCurrency ? `بالعملة ${cur}` : null,
    },
    {
      key: 'paid',
      label: 'المدفوع',
      value: formatCurrency(ps?.totalPaid ?? 0, cur),
      color: 'success',
    },
    {
      key: 'remaining',
      label: 'المتبقي (الديون)',
      value: formatCurrency(ps?.totalRemaining ?? 0, cur),
      color: ps?.totalRemaining > 0 ? 'error' : 'success',
    },
    {
      key: 'overdue',
      label: 'المتأخر',
      value: formatCurrency(summary.overdueAmount, cur),
      color: summary.overdueAmount > 0 ? 'error' : 'success',
    },
    {
      key: 'activeInst',
      label: 'أقساط نشطة',
      value: summary.activeInstallments,
      color: 'warning',
    },
    {
      key: 'completedInst',
      label: 'أقساط مكتملة',
      value: summary.completedInstallments,
      color: 'success',
    },
  ];
});

// ── Tables ──────────────────────────────────────────────────────────────
const salesHeaders = [
  { title: 'رقم الفاتورة', key: 'invoiceNumber' },
  { title: 'التاريخ', key: 'date' },
  { title: 'النوع', key: 'type' },
  { title: 'الإجمالي', key: 'total', align: 'end' },
  { title: 'المدفوع', key: 'paid', align: 'end' },
  { title: 'المتبقي', key: 'remaining', align: 'end' },
  { title: 'الحالة', key: 'status' },
  { title: '', key: 'actions', sortable: false },
];

const installmentHeaders = [
  { title: 'الفاتورة', key: 'invoiceNumber' },
  { title: 'تاريخ الاستحقاق', key: 'dueDate' },
  { title: 'المبلغ', key: 'dueAmount', align: 'end' },
  { title: 'المدفوع', key: 'paidAmount', align: 'end' },
  { title: 'المتبقي', key: 'remainingAmount', align: 'end' },
  { title: 'تأخر', key: 'overdueDays' },
  { title: 'الحالة', key: 'status' },
  { title: '', key: 'actions', sortable: false },
];

const collectionsInstallmentHeaders = [
  { title: 'الفاتورة', key: 'invoiceNumber' },
  { title: 'الاستحقاق', key: 'dueDate' },
  { title: 'المبلغ', key: 'dueAmount', align: 'end' },
  { title: 'المتبقي', key: 'remainingAmount', align: 'end' },
  { title: 'تأخر', key: 'overdueDays' },
  { title: '', key: 'actions', sortable: false },
];

const paymentHeaders = [
  { title: 'التاريخ', key: 'date' },
  { title: 'المبلغ', key: 'amount', align: 'end' },
  { title: 'العملة', key: 'currency' },
  { title: 'طريقة الدفع', key: 'method' },
  { title: 'الفاتورة', key: 'invoiceNumber' },
];

// ── Helpers ─────────────────────────────────────────────────────────────
const statusColor = (s) => getStatusColor(s);
const statusLabel = (s) => getStatusText(s);
const paymentMethodLabel = (m) => getPaymentMethodText(m);

const saleTypeLabel = (sale) => {
  const t = (sale.saleType || sale.paymentType || sale.type || '').toLowerCase();
  if (t === 'cash') return 'نقدي';
  if (t === 'installment') return 'تقسيط';
  if (t === 'mixed') return 'مختلط';
  return t || '—';
};

const installmentColor = (i) => {
  if (i.status === 'paid') return 'success';
  if (i.status === 'cancelled') return 'grey';
  if (i.overdueDays > 0) return 'error';
  return 'warning';
};
const installmentLabel = (i) => {
  if (i.status === 'paid') return 'مدفوع';
  if (i.status === 'cancelled') return 'ملغي';
  if (i.overdueDays > 0) return 'متأخر';
  return 'قيد الانتظار';
};

const formatDate = (val) => {
  if (!val) return '—';
  try {
    return toYmdWithTime(val);
  } catch {
    return String(val);
  }
};

const warningText = (warning) => {
  if (warning.code === 'MULTI_CURRENCY') {
    return 'هذا العميل لديه معاملات بأكثر من عملة. يتم عرض الإجماليات لكل عملة على حدة دون جمعها.';
  }
  if (warning.code === 'CONVERSION_UNAVAILABLE') {
    return 'لا توجد عملة أساسية مفعّلة، لذا تحويل العملات غير متاح حالياً.';
  }
  return warning.message;
};

// ── Collections workflow ────────────────────────────────────────────────
const collectionsLoading = ref(false);
const collectionHistory = ref([]);
const actionDialog = ref(false);
const actionTarget = ref(null);
const actionSubmitting = ref(false);
const actionForm = ref({
  actionType: 'call',
  note: '',
  promisedAmount: null,
  promisedDate: null,
  newDueDate: null,
  amount: null,
  paymentMethod: 'cash',
  paymentReference: '',
});

const overdueInstallments = computed(() =>
  (profile.value?.installments || []).filter(
    (i) => i.status === 'pending' && (i.overdueDays || 0) > 0
  )
);

const upcomingInstallments = computed(() =>
  (profile.value?.installments || []).filter(
    (i) => i.status === 'pending' && (i.overdueDays || 0) === 0
  )
);

const actionTypeOptions = [
  { title: 'مكالمة', value: 'call' },
  { title: 'زيارة', value: 'visit' },
  { title: 'وعد بالدفع', value: 'promise_to_pay' },
  { title: 'تأجيل الاستحقاق', value: 'reschedule' },
  { title: 'ملاحظة', value: 'note' },
  { title: 'تسجيل دفعة', value: 'payment' },
];

const actionTypeLabel = (type) => actionTypeOptions.find((o) => o.value === type)?.title || type;

const actionTypeColor = (type) => {
  switch (type) {
    case 'payment':
      return 'success';
    case 'promise_to_pay':
      return 'info';
    case 'reschedule':
      return 'warning';
    case 'visit':
      return 'primary';
    default:
      return 'grey';
  }
};

const resetActionForm = () => {
  actionForm.value = {
    actionType: 'call',
    note: '',
    promisedAmount: null,
    promisedDate: null,
    newDueDate: null,
    amount: actionTarget.value?.remainingAmount || null,
    paymentMethod: 'cash',
    paymentReference: '',
  };
};

const openActionDialog = (installment) => {
  if (!canCollect.value) return;
  actionTarget.value = installment;
  resetActionForm();
  actionDialog.value = true;
};

const canSubmitAction = computed(() => {
  if (actionSubmitting.value) return false;
  const f = actionForm.value;
  if (f.actionType === 'promise_to_pay') {
    return Number(f.promisedAmount) > 0 && !!f.promisedDate;
  }
  if (f.actionType === 'reschedule') {
    return !!f.newDueDate && f.newDueDate !== actionTarget.value?.dueDate;
  }
  if (f.actionType === 'payment') {
    if (!(Number(f.amount) > 0) || !f.paymentMethod) return false;
    if (f.paymentMethod === 'card' && !f.paymentReference?.trim()) return false;
    return true;
  }
  return true;
});

const buildActionPayload = () => {
  const f = actionForm.value;
  const payload = { actionType: f.actionType };
  if (f.note?.trim()) payload.note = f.note.trim();
  if (f.actionType === 'promise_to_pay') {
    payload.promisedAmount = Number(f.promisedAmount);
    payload.promisedDate = f.promisedDate;
  }
  if (f.actionType === 'reschedule') {
    payload.newDueDate = f.newDueDate;
  }
  if (f.actionType === 'payment') {
    payload.amount = Number(f.amount);
    payload.paymentMethod = f.paymentMethod;
    payload.currency = actionTarget.value?.currency;
    if (f.paymentMethod === 'card' && f.paymentReference?.trim()) {
      payload.paymentReference = f.paymentReference.trim();
    }
  }
  return payload;
};

const submitAction = async () => {
  if (!canSubmitAction.value || !actionTarget.value) return;
  actionSubmitting.value = true;
  try {
    await collectionsStore.recordAction(actionTarget.value.id, buildActionPayload());
    actionDialog.value = false;
    // Reload profile (for updated installment / due date / payment) and history.
    await Promise.allSettled([loadProfile(), loadCollections()]);
  } catch {
    // store already toasts the error
  } finally {
    actionSubmitting.value = false;
  }
};

const loadCollections = async () => {
  if (!profile.value?.customer?.id || !canCollect.value) return;
  collectionsLoading.value = true;
  try {
    collectionHistory.value = await collectionsStore.customerHistory(profile.value.customer.id);
  } catch {
    collectionHistory.value = [];
  } finally {
    collectionsLoading.value = false;
  }
};

watch(activeTab, (tab) => {
  if (tab === 'collections') loadCollections();
});

// ── Lifecycle ───────────────────────────────────────────────────────────
const loadProfile = async () => {
  loading.value = true;
  error.value = null;
  try {
    profile.value = await customerStore.fetchCustomerProfile(route.params.id);
    if (profile.value?.customer?.id) {
      // Aging is optional — failures should not break the profile page.
      loadCustomerAging(profile.value.customer.id);
    }
  } catch (err) {
    error.value = err || { message: 'تعذر تحميل ملف العميل' };
    profile.value = null;
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  // Profile is the primary payload; messaging settings only matter when
  // the current user has settings:manage. Fetch in parallel and never let
  // a settings failure block the page render.
  const tasks = [loadProfile()];
  if (canSendCustomerMessages.value) {
    tasks.push(ensureMessagingSettings());
  }
  await Promise.allSettled(tasks);
});
</script>

<style scoped>
.message-preview pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1.5;
}
</style>
