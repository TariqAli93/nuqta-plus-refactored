<template>
  <div class="page-shell">
    <PageHeader
      title="تفاصيل الفاتورة"
      subtitle="عرض الفاتورة والمدفوعات والإرجاع"
      icon="mdi-receipt-text"
    >
      <v-btn
        color="primary"
        prepend-icon="mdi-printer"
        :loading="printing"
        :disabled="isFullyReturned || isCancelled"
        :title="isFullyReturned ? 'الطباعة معطلة — تم إرجاع جميع المنتجات' : ''"
        @click="handlePrint"
      >
        طباعة
      </v-btn>

      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-eye"
        :disabled="isFullyReturned"
        :title="isFullyReturned ? 'المعاينة معطلة — تم إرجاع جميع المنتجات' : ''"
        @click="previewPrint"
      >
        معاينة الطباعة
      </v-btn>

      <v-btn
        v-if="canReturn"
        color="warning"
        variant="tonal"
        prepend-icon="mdi-keyboard-return"
        :disabled="isFullyReturned"
        :title="isFullyReturned ? 'تم إرجاع جميع المنتجات' : ''"
        @click="openReturnDialog"
      >
        {{ isFullyReturned ? 'مُرجع كلياً' : 'إرجاع / استرداد' }}
      </v-btn>

      <select-printer />

      <v-btn variant="text" prepend-icon="mdi-arrow-right" @click="router.go(-1)"> رجوع </v-btn>
    </PageHeader>

    <v-card v-if="sale" class="mb-4">
      <v-card-title class="d-flex justify-space-between align-center">
        <div>
          <div class="text-h5">
            رقم الفاتورة:
            <v-chip>{{ sale.invoiceNumber }}</v-chip>
          </div>
          <div class="text-caption text-grey">{{ toYmdWithTime(sale.createdAt) }}</div>
        </div>
        <v-chip
          v-if="sale.paymentType === 'installment'"
          :color="getStatusColor(sale.status)"
          size="large"
        >
          {{ getStatusText(sale.status) }}
        </v-chip>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="4">
            <div class="mb-2">
              <v-icon color="primary" class="ml-2">mdi-account</v-icon>
              <strong>معلومات العميل</strong>
            </div>
            <div class="mr-8 text-body-2">
              <p class="mb-1"><strong>الاسم: </strong> {{ sale.customerName || 'زبون نقدي' }}</p>
              <p v-if="sale.customer && sale.customer.phone" class="mb-1">
                <strong>الهاتف: </strong> {{ sale.customer.phone }}
              </p>
            </div>
          </v-col>

          <v-col cols="12" md="4">
            <div class="mb-2">
              <v-icon color="primary" class="ml-2">mdi-cash-multiple</v-icon>
              <strong>معلومات الدفع</strong>
            </div>
            <div class="mr-8 text-body-2">
              <p class="mb-1">
                <strong>نوع الدفع: </strong> {{ getPaymentTypeText(sale.paymentType) }}
              </p>
              <p class="mb-1"><strong>العملة:</strong> {{ sale.currency }}</p>
              <p class="mb-1">
                <strong>المدفوع: </strong>
                <span class="text-success">{{
                  formatCurrency(sale.paidAmount, sale.currency)
                }}</span>
              </p>
              <p class="mb-1">
                <strong>المتبقي: </strong>
                <span :class="sale.remainingAmount > 0 ? 'text-error' : 'text-success'">
                  {{ formatCurrency(sale.remainingAmount, sale.currency) }}
                </span>
              </p>
              <p v-if="totalReturnedValue > 0" class="mb-0">
                <strong>قيمة الإرجاع: </strong>
                <span class="text-warning font-weight-bold">
                  {{ formatCurrency(totalReturnedValue, sale.currency) }}
                </span>
              </p>
            </div>
          </v-col>

          <v-col cols="12" md="4">
            <div class="mb-2">
              <v-icon color="primary" class="ml-2">mdi-chart-box</v-icon>
              <strong>الملخص المالي</strong>
            </div>
            <div class="mr-8 text-body-2">
              <!-- عرض المجموع الأساسي -->
              <p v-if="sale.paymentType === 'installment' && sale.interestAmount > 0" class="mb-1">
                <strong>إجمالي المنتجات: </strong>
                <span class="text-primary">{{
                  formatCurrency(sale.total - (sale.interestAmount || 0), sale.currency)
                }}</span>
              </p>
              <!-- معلومات الفائدة -->
              <p v-if="sale.paymentType === 'installment' && sale.interestRate > 0" class="mb-1">
                <strong>نسبة الفائدة: </strong>
                <span class="text-warning font-weight-bold">{{ sale.interestRate }}%</span>
              </p>
              <p v-if="sale.paymentType === 'installment' && sale.interestAmount > 0" class="mb-1">
                <strong>قيمة الفائدة: </strong>
                <span class="text-warning font-weight-bold">{{
                  formatCurrency(sale.interestAmount, sale.currency)
                }}</span>
              </p>
              <!-- عدد الأقساط للمبيعات التقسيطية -->
              <p v-if="sale.paymentType === 'installment' && hasInstallments" class="mb-1">
                <strong>عدد الأقساط: </strong>
                <span class="text-info">{{ sale.installments.length }} قسط</span>
              </p>

              <!-- الإجمالي النهائي -->
              <v-divider
                v-if="sale.paymentType === 'installment' && sale.interestAmount > 0"
                class="my-2"
              ></v-divider>
              <p class="mb-0">
                <strong>الإجمالي النهائي: </strong>
                <span class="text-h6 text-primary font-weight-bold">{{
                  formatCurrency(sale.total, sale.currency)
                }}</span>
              </p>

              <!-- Profit (manager+ only — column hidden for cashiers) -->
              <p v-if="canViewProfit && sale.totalProfit != null" class="mb-0 mt-2">
                <strong>الربح المحقق: </strong>
                <span class="text-success font-weight-bold">{{
                  formatCurrency(sale.totalProfit, sale.currency)
                }}</span>
              </p>
              <p
                v-else-if="canViewProfit && sale.profitAccurate === false"
                class="mb-0 mt-2 text-caption text-medium-emphasis"
              >
                الربح غير متاح (تكلفة بعض المنتجات غير معروفة)
              </p>
            </div>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Interest Information Card for Installment Sales -->
    <v-card
      v-if="sale && sale.paymentType === 'installment' && sale.interestAmount > 0"
      class="page-section"
    >
      <div class="section-title">
        <span class="section-title__label">
          <v-icon size="20" color="warning">mdi-calculator</v-icon>
          <span>تفاصيل حساب الفائدة</span>
        </span>
      </div>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="3">
            <div class="text-center">
              <div class="text-caption text-grey">إجمالي المنتجات</div>
              <div class="text-h6 text-primary">
                {{ formatCurrency(sale.total - (sale.interestAmount || 0), sale.currency) }}
              </div>
            </div>
          </v-col>
          <v-col cols="12" md="1" class="justify-center d-flex align-center">
            <v-icon color="warning">mdi-plus</v-icon>
          </v-col>
          <v-col cols="12" md="3">
            <div class="text-center">
              <div class="text-caption text-grey">الفائدة ({{ sale.interestRate }}%)</div>
              <div class="text-h6 text-warning">
                {{ formatCurrency(sale.interestAmount, sale.currency) }}
              </div>
            </div>
          </v-col>
          <v-col cols="12" md="1" class="justify-center d-flex align-center">
            <v-icon color="success">mdi-equal</v-icon>
          </v-col>
          <v-col cols="12" md="4">
            <div class="text-center">
              <div class="text-caption text-grey">الإجمالي النهائي</div>
              <div class="text-h5 text-success font-weight-bold">
                {{ formatCurrency(sale.total, sale.currency) }}
              </div>
              <div class="mt-1 text-caption text-grey">
                {{ sale.installments.length }} أقساط ×
                {{
                  formatCurrency(
                    sale.installments.length > 0 ? sale.total / sale.installments.length : 0,
                    sale.currency
                  )
                }}
              </div>
            </div>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Products Table -->
    <v-card v-if="sale && sale.items" class="mb-4">
      <v-card-title>
        <v-icon class="ml-2">mdi-package-variant</v-icon>
        تفاصيل المنتجات
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th class="text-center">#</th>
              <th class="text-center">المنتج</th>
              <th class="text-center">الكمية</th>
              <th v-if="hasReturns" class="text-center">المُعاد</th>
              <th v-if="hasReturns" class="text-center">الصافي</th>
              <th class="text-center">سعر الوحدة</th>
              <th class="text-center">خصم على الوحدة</th>
              <th class="text-center">الملاحظات</th>
              <th class="text-center">المجموع</th>
              <th v-if="canViewProfit" class="text-center">الربح</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, index) in sale.items"
              :key="item.id"
              :class="
                returnedQtyByItem[item.id] >= item.quantity
                  ? 'bg-warning-lighten-5'
                  : returnedQtyByItem[item.id] > 0
                    ? 'bg-warning-lighten-5'
                    : ''
              "
            >
              <td class="text-center font-weight-bold">{{ index + 1 }}</td>
              <td class="text-center">
                <div class="font-weight-bold">{{ item.productName }}</div>
                <div v-if="item.productDescription" class="text-caption text-grey mt-1">
                  {{ item.productDescription }}
                </div>
              </td>
              <td class="text-center">
                <span
                  :class="
                    returnedQtyByItem[item.id] >= item.quantity
                      ? 'text-decoration-line-through text-grey'
                      : ''
                  "
                >
                  {{ item.quantity }}
                  <span v-if="item.unitName" class="text-caption text-medium-emphasis">
                    {{ item.unitName }}
                  </span>
                </span>
              </td>
              <td v-if="hasReturns" class="text-center text-warning font-weight-bold">
                {{ returnedQtyByItem[item.id] || 0 }}
                <span v-if="item.unitName" class="text-caption text-medium-emphasis">
                  {{ item.unitName }}
                </span>
              </td>
              <td v-if="hasReturns" class="text-center font-weight-bold">
                {{ Math.max(0, item.quantity - (returnedQtyByItem[item.id] || 0)) }}
                <span v-if="item.unitName" class="text-caption text-medium-emphasis">
                  {{ item.unitName }}
                </span>
              </td>
              <td class="text-center">
                {{ formatCurrency(item.unitPrice, sale.currency) }}
                <div v-if="item.unitName" class="text-caption text-medium-emphasis">
                  / {{ item.unitName }}
                </div>
              </td>
              <td class="text-center">
                {{ item.discount ? formatCurrency(item.discount, sale.currency) : '-' }}
              </td>
              <td class="text-center">{{ item.notes || '-' }}</td>
              <td class="text-center font-weight-bold">
                {{ formatCurrency(item.subtotal, sale.currency) }}
              </td>
              <td v-if="canViewProfit" class="text-center">
                <span
                  v-if="item.profit != null"
                  :class="item.profit >= 0 ? 'text-success' : 'text-error'"
                  class="font-weight-bold"
                >
                  {{ formatCurrency(item.profit, sale.currency) }}
                </span>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
            </tr>
          </tbody>

          <!-- المجموع مع الخصم و الفائدة -->
          <tfoot>
            <tr v-if="sale.discount && sale.discount > 0">
              <td :colspan="footerLabelColspan" class="text-right font-weight-bold">
                الخصم على الفاتورة:
              </td>
              <td class="text-center font-weight-bold text-error">
                {{ formatCurrency(sale.discount, sale.currency) }}
              </td>
              <td v-if="canViewProfit"></td>
            </tr>

            <tr>
              <td :colspan="footerLabelColspan" class="text-right font-weight-bold">
                <span v-if="sale.paymentType === 'installment'"> المجموع الفرعي: </span>
                <span v-else>الإجمالي:</span>
              </td>
              <td class="text-center font-weight-bold">
                {{ formatCurrency(sale.total - (sale.interestAmount || 0), sale.currency) }}
              </td>
              <td v-if="canViewProfit"></td>
            </tr>

            <tr v-if="sale.paymentType === 'installment' && sale.interestAmount > 0">
              <td :colspan="footerLabelColspan" class="text-right font-weight-bold">الفائدة:</td>
              <td class="text-center font-weight-bold text-warning">
                + {{ formatCurrency(sale.interestAmount, sale.currency) }}
              </td>
              <td v-if="canViewProfit"></td>
            </tr>

            <tr v-if="sale.discount > 0 || sale.interestAmount > 0">
              <td :colspan="footerLabelColspan" class="text-right font-weight-bold text-primary">
                الإجمالي النهائي:
              </td>
              <td class="text-center font-weight-bold text-primary text-h6">
                {{ formatCurrency(sale.total, sale.currency) }}
              </td>
              <td v-if="canViewProfit" class="text-center font-weight-bold text-success">
                <span v-if="sale.totalProfit != null">
                  {{ formatCurrency(sale.totalProfit, sale.currency) }}
                </span>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
            </tr>

            <tr v-if="hasReturns">
              <td :colspan="footerLabelColspan" class="text-right font-weight-bold text-warning">
                إجمالي الإرجاع:
              </td>
              <td class="text-center font-weight-bold text-warning">
                - {{ formatCurrency(totalReturnedValue, sale.currency) }}
              </td>
              <td v-if="canViewProfit"></td>
            </tr>

            <tr v-if="hasReturns">
              <td :colspan="footerLabelColspan" class="text-right font-weight-bold text-success">
                الصافي بعد الإرجاع:
              </td>
              <td class="text-center font-weight-bold text-success text-h6">
                {{ formatCurrency(Math.max(0, sale.total - totalReturnedValue), sale.currency) }}
              </td>
              <td v-if="canViewProfit"></td>
            </tr>
          </tfoot>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- Installments Table -->
    <v-card v-if="sale && sale.installments && sale.installments.length > 0" class="mb-4">
      <v-card-title class="d-flex justify-space-between align-center">
        <div>
          <v-icon class="ml-2">mdi-calendar-clock</v-icon>
          جدول الأقساط
          <span
            v-if="sale.paymentType === 'installment' && sale.interestAmount > 0"
            class="text-caption text-warning d-block"
          >
            * الأقساط تشمل فائدة بنسبة {{ sale.interestRate }}%
          </span>
        </div>
        <v-chip :color="getInstallmentStatusColor()" size="small">
          {{ getInstallmentStatusText() }}
        </v-chip>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th class="text-center">رقم القسط</th>
              <th class="text-center">المبلغ المستحق</th>
              <th class="text-center">المبلغ المدفوع</th>
              <th class="text-center">المبلغ المتبقي</th>
              <th class="text-center">تاريخ الاستحقاق</th>
              <th class="text-center">تاريخ الدفع</th>
              <th class="text-center">الحالة</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="installment in sale.installments"
              :key="installment.id"
              :class="getInstallmentRowClass(installment)"
            >
              <td class="text-center font-weight-bold">{{ installment.installmentNumber }}</td>
              <td class="text-center">
                {{ formatCurrency(installment.dueAmount, sale.currency) }}
              </td>
              <td class="text-center text-success">
                {{ formatCurrency(installment.paidAmount, sale.currency) }}
              </td>
              <td class="text-center" :class="installment.remainingAmount > 0 ? 'text-error' : ''">
                {{ formatCurrency(installment.remainingAmount, sale.currency) }}
              </td>
              <td class="text-center">{{ toYmd(installment.dueDate) }}</td>
              <td class="text-center">
                {{ installment.paidDate ? toYmd(installment.paidDate) : '-' }}
              </td>
              <td class="text-center">
                <v-chip :color="getInstallmentColor(installment)" size="small">
                  {{ getInstallmentStatusLabel(installment) }}
                </v-chip>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- Payments Table -->
    <v-card v-if="sale && sale.payments && sale.payments.length > 0" class="mb-4">
      <v-card-title>
        <v-icon class="ml-2">mdi-cash-register</v-icon>
        سجل الدفعات
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th class="text-center">#</th>
              <th class="text-center">المبلغ</th>
              <th class="text-center">طريقة الدفع</th>
              <th class="text-center">التاريخ</th>
              <th class="text-center">العملة</th>
              <th class="text-center">بواسطة</th>
              <th class="text-center">رقم المرجع</th>
              <th class="text-right">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(payment, index) in sale.payments" :key="payment.id">
              <td class="text-center">{{ index + 1 }}</td>
              <td class="text-center font-weight-bold text-success">
                {{ formatCurrency(payment.amount, payment.currency) }}
              </td>
              <td class="text-center">{{ getPaymentMethodText(payment.paymentMethod) }}</td>
              <td class="text-center">{{ toYmdWithTime(payment.createdAt) }}</td>
              <td class="text-center">{{ payment.currency }}</td>
              <td class="text-center">{{ payment.createdBy || '-' }}</td>
              <td class="text-center">
                <v-chip v-if="payment.paymentReference" size="small" variant="tonal" color="info">
                  {{ payment.paymentReference }}
                </v-chip>
                <span v-else>-</span>
              </td>
              <td>{{ payment.notes || '-' }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- Returns History -->
    <v-card v-if="sale && sale.returns && sale.returns.length > 0" class="mb-4">
      <v-card-title>
        <v-icon class="ml-2">mdi-keyboard-return</v-icon>
        سجل الإرجاع
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th class="text-center">#</th>
              <th class="text-center">التاريخ</th>
              <th class="text-center">المنتجات المُعادة</th>
              <th class="text-center">قيمة الإرجاع</th>
              <th class="text-center">المسترد نقداً</th>
              <th class="text-center">خصم من الذمة</th>
              <th class="text-center">السبب</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(ret, idx) in sale.returns" :key="ret.id">
              <td class="text-center">{{ idx + 1 }}</td>
              <td class="text-center">{{ toYmdWithTime(ret.createdAt) }}</td>
              <td class="text-center">
                <div v-for="it in ret.items" :key="it.id" class="text-caption">
                  {{ it.productName }} × {{ it.quantity }}
                </div>
              </td>
              <td class="text-center">{{ formatCurrency(ret.returnedValue, ret.currency) }}</td>
              <td class="text-center text-success">
                {{ formatCurrency(ret.refundAmount, ret.currency) }}
              </td>
              <td class="text-center">
                {{ formatCurrency(ret.debtReduction, ret.currency) }}
              </td>
              <td class="text-center">{{ ret.reason || '-' }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- Return / Refund Dialog -->
    <v-dialog v-model="returnDialog" max-width="900" persistent>
      <v-card>
        <v-card-title class="dialog-title">
          <v-icon color="warning">mdi-keyboard-return</v-icon>
          <span>إرجاع / استرداد</span>
          <v-spacer />
          <v-btn icon variant="text" size="small" @click="closeReturnDialog">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>

        <v-card-text class="pt-4">
          <v-alert v-if="returnError" type="error" variant="tonal" class="mb-4" density="compact">
            {{ returnError }}
          </v-alert>

          <div class="text-body-2 text-grey mb-3">
            حدد الكمية المراد إرجاعها لكل منتج. يقتصر الإرجاع على ما لم يتم إرجاعه سابقاً.
          </div>

          <v-table density="compact">
            <thead>
              <tr>
                <th class="text-center">المنتج</th>
                <th class="text-center">المبيع</th>
                <th class="text-center">سبق إرجاعه</th>
                <th class="text-center">المتاح للإرجاع</th>
                <th class="text-center">سعر الوحدة</th>
                <th class="text-center">كمية الإرجاع</th>
                <th class="text-center">القيمة</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in returnableRows" :key="row.saleItemId" class="py-3">
                <td>
                  {{ row.productName }}
                  <span v-if="row.unitName" class="text-caption text-medium-emphasis">
                    ({{ row.unitName }})
                  </span>
                </td>
                <td class="text-center">
                  {{ row.sold }}
                  <span v-if="row.unitName" class="text-caption text-medium-emphasis">
                    {{ row.unitName }}
                  </span>
                </td>
                <td class="text-center">{{ row.alreadyReturned }}</td>
                <td class="text-center font-weight-bold">{{ row.maxReturnable }}</td>
                <td class="text-center">
                  {{ formatCurrency(row.netUnitPrice, sale.currency) }}
                  <div v-if="row.unitName" class="text-caption text-medium-emphasis">
                    / {{ row.unitName }}
                  </div>
                </td>
                <td class="text-center">
                  <v-number-input
                    v-model="row.quantity"
                    :min="0"
                    :max="row.maxReturnable"
                    :disabled="row.maxReturnable <= 0"
                    variant="outlined"
                    density="compact"
                    control-variant="split"
                    inset
                    hide-details
                  />
                </td>
                <td class="text-center">
                  {{ formatCurrency(lineValueFor(row), sale.currency) }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="6" class="text-right font-weight-bold">إجمالي الإرجاع:</td>
                <td class="text-center font-weight-bold text-warning">
                  {{ formatCurrency(returnedValue, sale.currency) }}
                </td>
              </tr>
            </tfoot>
          </v-table>

          <v-row class="mt-4">
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="returnForm.refundAmount"
                type="number"
                :label="`المبلغ المسترد نقداً (${sale.currency})`"
                :suffix="sale.currency"
                :min="0"
                :max="maxRefundable"
                :hint="`قيمة الإرجاع: ${formatCurrency(returnedValue, sale.currency)} — الحد الأقصى للاسترداد نقداً: ${formatCurrency(maxRefundable, sale.currency)}`"
                persistent-hint
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="returnForm.refundMethod"
                :items="refundMethodOptions"
                label="طريقة الاسترداد"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-if="returnForm.refundMethod === 'card'"
                v-model="returnForm.refundReference"
                label="رقم مرجع البطاقة"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="returnForm.reason" label="سبب الإرجاع" density="comfortable" />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="returnForm.notes"
                label="ملاحظات (اختياري)"
                density="comfortable"
              />
            </v-col>
          </v-row>

          <v-alert type="info" variant="tonal" density="compact" class="mt-2">
            <div class="d-flex flex-wrap" style="gap: 1.5rem">
              <div>
                <strong>قيمة البضاعة: </strong>
                {{ formatCurrency(returnedGoodsValue, sale.currency) }}
              </div>
              <div v-if="returnedInterest > 0">
                <strong>إلغاء الفائدة: </strong>
                <span class="text-warning">
                  {{ formatCurrency(returnedInterest, sale.currency) }}
                </span>
              </div>
              <div>
                <strong>إجمالي الإرجاع: </strong>
                {{ formatCurrency(returnedValue, sale.currency) }}
              </div>
              <div>
                <strong>المبلغ المسترد: </strong>
                {{ formatCurrency(refundAmountClamped, sale.currency) }}
              </div>
              <div>
                <strong>خصم من الذمة: </strong>
                {{ formatCurrency(debtReductionPreview, sale.currency) }}
              </div>
            </div>
          </v-alert>
        </v-card-text>

        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" :disabled="submittingReturn" @click="closeReturnDialog">
            إلغاء
          </v-btn>
          <v-btn
            color="warning"
            :disabled="!canSubmitReturn"
            :loading="submittingReturn"
            @click="submitReturn"
          >
            تأكيد الإرجاع
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Add Payment Form -->
    <v-card
      v-if="sale && sale.status === 'pending' && sale.remainingAmount > 0"
      class="page-section"
    >
      <div class="section-title">
        <span class="section-title__label">
          <v-icon size="20" color="warning">mdi-cash-plus</v-icon>
          <span>إضافة دفعة جديدة</span>
        </span>
      </div>
      <v-card-text class="pt-4">
        <v-form @submit.prevent="addPayment">
          <v-row>
            <v-col cols="12" md="4">
              <v-text-field
                :model-value="formatNumber(paymentData.amount)"
                label="المبلغ"
                step="0.01"
                min="0.01"
                :hint="`المتبقي: ${formatCurrency(sale.remainingAmount, sale.currency)}`"
                persistent-hint
                :rules="[
                  (v) => {
                    const num = parseNumber(v);
                    return !!num || 'المبلغ مطلوب';
                  },
                  (v) => {
                    const num = parseNumber(v);
                    return num > 0 || 'المبلغ يجب أن يكون أكبر من صفر';
                  },
                  (v) => {
                    const num = parseNumber(v);
                    return num <= sale.remainingAmount || 'المبلغ أكبر من المتبقي';
                  },
                ]"
                required
                @update:model-value="handlePaymentAmountInput($event)"
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="paymentData.paymentMethod"
                :items="paymentMethods"
                label="طريقة الدفع"
                required
              ></v-select>
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="paymentData.notes" label="ملاحظات (اختياري)"></v-text-field>
            </v-col>
          </v-row>
          <v-btn type="submit" color="primary" :loading="loadingPayment">
            <v-icon class="ml-2">mdi-check</v-icon>
            إضافة الدفعة
          </v-btn>

          <!-- add pay all button -->
          <v-btn color="secondary" class="mr-3" :loading="loadingPayment" @click="payAll">
            <v-icon class="ml-2">mdi-cash-multiple</v-icon>
            دفع المبلغ المتبقي
          </v-btn>
        </v-form>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSaleStore } from '@/stores/sale';
import { useSettingsStore } from '@/stores/settings';
import { useNotificationStore } from '@/stores/notification';
import { useAuthStore } from '@/stores/auth';
import SelectPrinter from '@/components/SelectPrinter.vue';
import PageHeader from '@/components/PageHeader.vue';
import { formatReceiptData } from '@/utils/receiptFormatter';
import {
  toYmd,
  toYmdWithTime,
  formatCurrency,
  getStatusColor,
  getStatusText,
  getPaymentTypeText,
  getPaymentMethodText,
} from '@/utils/helpers';

const { params } = useRoute();
const router = useRouter();
const saleStore = useSaleStore();
const settingsStore = useSettingsStore();
const notificationStore = useNotificationStore();
const authStore = useAuthStore();

const printing = ref(false);
const settings = ref(null);

// Profit visibility — manager and above only.
const canViewProfit = computed(() => authStore.hasPermission?.(['manage:sales']));

// ── Return / Refund dialog state ────────────────────────────────────────────
const returnDialog = ref(false);
const submittingReturn = ref(false);
const returnError = ref('');
const returnableRows = ref([]);
const returnForm = ref({
  refundAmount: 0,
  refundMethod: 'cash',
  refundReference: '',
  reason: '',
  notes: '',
});
const refundMethodOptions = [
  { title: 'نقدي', value: 'cash' },
  { title: 'بطاقة', value: 'card' },
  { title: 'خصم من الذمة فقط', value: 'credit' },
];

const canReturn = computed(() => {
  if (!sale.value) return false;
  if (sale.value.status === 'cancelled' || sale.value.status === 'draft') return false;
  // Installment invoices are excluded — refunds against an open installment
  // schedule are handled outside this flow (by adjusting/cancelling the
  // installment plan directly), so the return button is hidden for them.
  if (sale.value.paymentType === 'installment' || sale.value.paymentType === 'mixed') {
    return false;
  }
  if (sale.value.saleType === 'INSTALLMENT') return false;
  return Array.isArray(sale.value.items) && sale.value.items.length > 0;
});

// Fully returned = every line item has been entirely sent back. Once true,
// nothing more can be returned, so the action button is shown but disabled
// (clearer UX than hiding it — the user sees the operation exists but the
// state explains why it's unavailable).
const isFullyReturned = computed(() => {
  if (!sale.value || !Array.isArray(sale.value.items) || sale.value.items.length === 0) {
    return false;
  }
  const priorByItemId = {};
  for (const ret of sale.value.returns || []) {
    for (const it of ret.items || []) {
      if (!it.saleItemId) continue;
      priorByItemId[it.saleItemId] = (priorByItemId[it.saleItemId] || 0) + Number(it.quantity || 0);
    }
  }
  return sale.value.items.every(
    (item) => (priorByItemId[item.id] || 0) >= Number(item.quantity || 0)
  );
});

const isCancelled = computed(() => {
  if (!sale.value) return false;
  return sale.value.status === 'cancelled';
});

const buildReturnableRows = () => {
  if (!sale.value) return [];
  // Sum prior-returned quantity per saleItemId from the existing returns
  // history that the backend ships on the sale payload.
  const priorByItemId = {};
  for (const ret of sale.value.returns || []) {
    for (const it of ret.items || []) {
      if (!it.saleItemId) continue;
      priorByItemId[it.saleItemId] = (priorByItemId[it.saleItemId] || 0) + Number(it.quantity || 0);
    }
  }
  return sale.value.items.map((item) => {
    const sold = Number(item.quantity || 0);
    const alreadyReturned = priorByItemId[item.id] || 0;
    const maxReturnable = Math.max(0, sold - alreadyReturned);
    // Net unit price after distributing the per-item discount, mirroring
    // the backend calculation so the preview matches the persisted value.
    const netUnitPrice = sold > 0 ? Number(item.subtotal || 0) / sold : Number(item.unitPrice || 0);
    return {
      saleItemId: item.id,
      productId: item.productId,
      productName: item.productName,
      // Unit snapshot from the original sale line — drives the "X درزن" label
      // in the return form so the cashier returns in the same unit the
      // customer bought in.
      unitId: item.unitId || null,
      unitName: item.unitName || null,
      unitConversionFactor: Number(item.unitConversionFactor) || 1,
      sold,
      alreadyReturned,
      maxReturnable,
      netUnitPrice,
      quantity: 0,
    };
  });
};

// Mirror the backend's nearest-bucket rounding so the dialog preview and
// the persisted figure agree (250-bucket for IQD, 2-decimal otherwise).
const roundReturnNearest = (amount, currency) => {
  if (currency === 'IQD') return Math.round((Number(amount) || 0) / 250) * 250;
  return Math.round((Number(amount) || 0) * 100) / 100;
};

const lineValueFor = (row) => (Number(row.quantity) || 0) * row.netUnitPrice;

const priorReturnedTotal = computed(() => {
  if (!sale.value || !Array.isArray(sale.value.returns)) return 0;
  return sale.value.returns.reduce((acc, r) => acc + Number(r.returnedValue || 0), 0);
});

const maxReturnableTotal = computed(() => {
  if (!sale.value) return 0;
  return Math.max(0, Number(sale.value.total || 0) - priorReturnedTotal.value);
});

const saleGoodsTotal = computed(() => {
  if (!sale.value) return 0;
  return (sale.value.items || []).reduce((acc, it) => acc + Number(it.subtotal || 0), 0);
});

// Goods value of the items currently selected for return (no interest).
const returnedGoodsValue = computed(() =>
  returnableRows.value.reduce((acc, r) => acc + (Number(r.quantity) || 0) * r.netUnitPrice, 0)
);

// Pro-rated interest slice that gets cancelled with the returned goods on
// installment sales. Mirrors the backend formula so the dialog preview
// matches what gets persisted.
const returnedInterest = computed(() => {
  const interestAmount = Number(sale.value?.interestAmount || 0);
  const goods = saleGoodsTotal.value;
  if (interestAmount <= 0 || goods <= 0) return 0;
  return (returnedGoodsValue.value / goods) * interestAmount;
});

// Cap the raw line sum at what the sale has left to give back so the
// preview never overshoots paidAmount + remainingAmount.
const returnedValue = computed(() => {
  const currency = sale.value?.currency || 'USD';
  const raw = returnedGoodsValue.value + returnedInterest.value;
  return roundReturnNearest(Math.min(raw, maxReturnableTotal.value), currency);
});

const maxRefundable = computed(() => {
  if (!sale.value) return 0;
  return Math.min(returnedValue.value, Number(sale.value.paidAmount) || 0);
});

const refundAmountClamped = computed(() => {
  const currency = sale.value?.currency || 'USD';
  const raw = Number(returnForm.value.refundAmount) || 0;
  return roundReturnNearest(
    Math.max(0, Math.min(raw, returnedValue.value, maxRefundable.value)),
    currency
  );
});

const debtReductionPreview = computed(() => {
  const currency = sale.value?.currency || 'USD';
  return roundReturnNearest(Math.max(0, returnedValue.value - refundAmountClamped.value), currency);
});

const canSubmitReturn = computed(() => {
  if (submittingReturn.value) return false;
  if (returnedValue.value <= 0) return false;
  const tolerance = sale.value?.currency === 'IQD' ? 250 : 0.01;
  if (debtReductionPreview.value > (sale.value?.remainingAmount || 0) + tolerance) return false;
  return true;
});

const openReturnDialog = () => {
  returnError.value = '';
  returnableRows.value = buildReturnableRows();
  returnForm.value = {
    refundAmount: 0,
    refundMethod: 'cash',
    refundReference: '',
    reason: '',
    notes: '',
  };
  returnDialog.value = true;
};

const closeReturnDialog = () => {
  if (submittingReturn.value) return;
  returnDialog.value = false;
};

const submitReturn = async () => {
  returnError.value = '';
  if (!canSubmitReturn.value) return;
  // Return items in the SAME unit the customer bought in. Backend re-resolves
  // the unit from the DB and converts to base units before restoring stock,
  // so the cashier doesn't need to mentally convert "1 درزن = 12 قطعة" here.
  const items = returnableRows.value
    .filter((r) => Number(r.quantity) > 0)
    .map((r) => ({
      saleItemId: r.saleItemId,
      quantity: Number(r.quantity),
      unitId: r.unitId || null,
    }));
  if (items.length === 0) {
    returnError.value = 'حدد كمية لمنتج واحد على الأقل';
    return;
  }
  try {
    submittingReturn.value = true;
    await saleStore.createReturn(sale.value.id, {
      items,
      refundAmount: refundAmountClamped.value,
      refundMethod: returnForm.value.refundMethod,
      refundReference: returnForm.value.refundReference || null,
      reason: returnForm.value.reason || null,
      notes: returnForm.value.notes || null,
    });
    const response = await saleStore.fetchSale(params.id);
    sale.value = response.data;
    returnDialog.value = false;
  } catch (err) {
    returnError.value = err?.response?.data?.message || 'فشل تسجيل الإرجاع';
  } finally {
    submittingReturn.value = false;
  }
};

// Build a sale snapshot that excludes returned quantities so the printed
// receipt reflects what the customer is actually keeping. Items fully
// returned drop out, partials shrink to (sold − returned), and totals are
// recomputed from the net subtotals so discount/tax/interest stay consistent.
const buildSaleForPrint = () => {
  if (!sale.value) return null;
  const src = sale.value;
  if (!Array.isArray(src.returns) || src.returns.length === 0) return src;

  const returnedByItem = {};
  for (const ret of src.returns) {
    for (const it of ret.items || []) {
      if (!it.saleItemId) continue;
      returnedByItem[it.saleItemId] =
        (returnedByItem[it.saleItemId] || 0) + Number(it.quantity || 0);
    }
  }

  const netItems = (src.items || [])
    .map((item) => {
      const sold = Number(item.quantity || 0);
      const returnedQty = returnedByItem[item.id] || 0;
      const netQty = Math.max(0, sold - returnedQty);
      if (netQty <= 0) return null;
      // Preserve per-unit pricing — subtotal scales with the net qty so the
      // formatter's per-line math stays correct.
      const netUnitPrice =
        sold > 0 ? Number(item.subtotal || 0) / sold : Number(item.unitPrice || 0);
      const perUnitDiscount = sold > 0 ? Number(item.discount || 0) / sold : 0;
      return {
        ...item,
        quantity: netQty,
        subtotal: netUnitPrice * netQty,
        discount: perUnitDiscount * netQty,
      };
    })
    .filter(Boolean);

  // Pro-rate interest the same way the return service does, so the printed
  // total = original total − all returned values.
  const saleGoodsTotal = (src.items || []).reduce((acc, it) => acc + Number(it.subtotal || 0), 0);
  const netGoodsTotal = netItems.reduce((acc, it) => acc + it.subtotal, 0);
  const interestAmount = Number(src.interestAmount || 0);
  const netInterest =
    interestAmount > 0 && saleGoodsTotal > 0
      ? (netGoodsTotal / saleGoodsTotal) * interestAmount
      : 0;

  const netSubtotal = netItems.reduce((acc, it) => acc + it.subtotal + Number(it.discount || 0), 0);
  const netDiscount = netItems.reduce((acc, it) => acc + Number(it.discount || 0), 0);
  const netTotal = Math.max(0, Number(src.total || 0) - totalReturnedValue.value);

  return {
    ...src,
    items: netItems,
    subtotal: netSubtotal,
    discount: netDiscount,
    interestAmount: netInterest,
    total: netTotal,
  };
};

const previewPrint = async () => {
  if (!sale.value) {
    notificationStore.error('لا توجد بيانات فاتورة للمعاينة');
    return;
  }

  // Get company info from settings
  const companyInfo = settingsStore.companyInfo;
  if (!companyInfo || !companyInfo.invoiceType) {
    notificationStore.error('يرجى إعداد نوع الفاتورة من إعدادات الشركة');
    return;
  }

  try {
    // Format receipt data
    const receiptData = formatReceiptData(buildSaleForPrint(), companyInfo);

    // Ensure all data is serializable by creating clean copies
    const cleanReceiptData = JSON.parse(JSON.stringify(receiptData));
    const cleanCompanyInfo = JSON.parse(JSON.stringify(companyInfo));

    // Call electron API to preview
    const result = await window.electronAPI.previewReceipt({
      receiptData: cleanReceiptData,
      companyInfo: cleanCompanyInfo,
    });

    if (!result.success) {
      notificationStore.error(result.error || 'فشل في عرض المعاينة');
    }
  } catch (error) {
    console.error('Preview error:', error);
    notificationStore.error('حدث خطأ أثناء عرض المعاينة: ' + (error.message || 'خطأ غير معروف'));
  }
};

// state
const sale = ref(null);
const loadingPayment = ref(false);

const paymentData = ref({
  amount: null,
  paymentMethod: 'cash',
  currency: 'USD',
  notes: '',
});

const paymentMethods = [
  { title: 'نقدي', value: 'cash' },
  { title: 'بطاقة', value: 'card' },
  { title: 'تحويل بنكي', value: 'bank_transfer' },
];

const hasInstallments = computed(
  () => sale.value?.installments && sale.value.installments.length > 0
);

// Aggregate every prior return so the items table can show what's been
// sent back per line and the footer can display the net-after-returns total.
const returnedQtyByItem = computed(() => {
  const map = {};
  for (const ret of sale.value?.returns || []) {
    for (const it of ret.items || []) {
      if (!it.saleItemId) continue;
      map[it.saleItemId] = (map[it.saleItemId] || 0) + Number(it.quantity || 0);
    }
  }
  return map;
});

const totalReturnedValue = computed(() => {
  return (sale.value?.returns || []).reduce((acc, r) => acc + Number(r.returnedValue || 0), 0);
});

const hasReturns = computed(
  () => Array.isArray(sale.value?.returns) && sale.value.returns.length > 0
);

// The original invoice table is 7 columns (#, product, qty, unit, item-discount,
// notes, total) — its label cells span 6. When the return columns are added
// (returned + net) we span 8 instead so the totals stay right-aligned.
const footerLabelColspan = computed(() => {
  // Base label column count: 6 (or 8 with the two return columns).
  // The profit column lives to the RIGHT of the value column, so it
  // doesn't shift the label colspan — the value <td> below already spans 1.
  return hasReturns.value ? 8 : 6;
});

// helpers for installments (to avoid duplicated code)
const isInstallmentOverdue = (installment) => {
  const dueDate = new Date(installment.dueDate);
  const today = new Date();
  return dueDate < today && installment.remainingAmount > 0;
};

// installments ui helpers
const getInstallmentColor = (installment) => {
  if (installment.status === 'paid') return 'success';
  if (installment.status === 'cancelled') return 'error';
  if (isInstallmentOverdue(installment)) return 'error';
  return 'warning';
};

const getInstallmentStatusLabel = (installment) => {
  if (installment.status === 'paid') return 'مدفوع';
  if (installment.status === 'cancelled') return 'ملغي';
  if (isInstallmentOverdue(installment)) return 'متأخر';
  return 'معلق';
};

const getInstallmentRowClass = (installment) => {
  if (installment.status === 'paid') return 'bg-success-lighten-5';
  if (isInstallmentOverdue(installment)) return 'bg-error-lighten-5';
  return '';
};

const getInstallmentStatusColor = () => {
  if (!hasInstallments.value) return 'grey';

  const allPaid = sale.value.installments.every((inst) => inst.status === 'paid');
  if (allPaid) return 'success';

  const hasOverdue = sale.value.installments.some(isInstallmentOverdue);
  if (hasOverdue) return 'error';

  return 'warning';
};

const getInstallmentStatusText = () => {
  if (!hasInstallments.value) return '';
  const paid = sale.value.installments.filter((inst) => inst.status === 'paid').length;
  const total = sale.value.installments.length;
  return `${paid} من ${total} مدفوع`;
};

// actions
const addPayment = async () => {
  try {
    loadingPayment.value = true;

    // Validate amount
    if (!paymentData.value.amount || paymentData.value.amount <= 0) {
      notificationStore.error('يجب إدخال مبلغ صحيح أكبر من صفر');
      return;
    }

    if (paymentData.value.amount > sale.value.remainingAmount) {
      notificationStore.error('المبلغ المدخل أكبر من المبلغ المتبقي');
      return;
    }

    paymentData.value.currency = sale.value.currency;

    await saleStore.addPayment(paymentData.value);
    notificationStore.success('تم إضافة الدفعة بنجاح');

    const response = await saleStore.fetchSale(params.id);
    sale.value = response.data;

    paymentData.value = {
      amount: null,
      paymentMethod: 'cash',
      currency: sale.value.currency,
      notes: '',
    };
  } catch (error) {
    console.error('Failed to add payment:', error);
    notificationStore.error('فشل في إضافة الدفعة');
  } finally {
    loadingPayment.value = false;
  }
};

const handlePrint = async () => {
  if (!sale.value) {
    notificationStore.error('لا توجد بيانات فاتورة للطباعة');
    return;
  }

  // Get selected printer
  const selectedPrinter = saleStore.getPrinter();
  if (!selectedPrinter) {
    notificationStore.error('يرجى اختيار طابعة أولاً');
    return;
  }

  // Get company info from settings
  const companyInfo = settingsStore.companyInfo;
  if (!companyInfo || !companyInfo.invoiceType) {
    notificationStore.error('يرجى إعداد نوع الفاتورة من إعدادات الشركة');
    return;
  }

  try {
    printing.value = true;

    // Format receipt data
    const receiptData = formatReceiptData(buildSaleForPrint(), companyInfo);

    // Ensure all data is serializable by creating clean copies
    // This prevents "object could not be cloned" errors in Electron IPC
    const cleanReceiptData = JSON.parse(JSON.stringify(receiptData));
    const cleanCompanyInfo = JSON.parse(JSON.stringify(companyInfo));

    // Call electron API to print
    const result = await window.electronAPI.printReceipt({
      printerName: selectedPrinter.name,
      receiptData: cleanReceiptData,
      companyInfo: cleanCompanyInfo,
    });

    if (result.success) {
      notificationStore.success('تمت الطباعة بنجاح');
    } else {
      notificationStore.error(result.error || 'فشل في الطباعة');
    }
  } catch (error) {
    console.error('Print error:', error);
    notificationStore.error('حدث خطأ أثناء الطباعة: ' + (error.message || 'خطأ غير معروف'));
  } finally {
    printing.value = false;
  }
};

// إضافة دوال تنسيق الأرقام
const formatNumber = (value) => {
  if (!value && value !== 0) return '';
  const numStr = String(value).replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(numStr)) return value;
  // دعم الأرقام العشرية
  const parts = numStr.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
};

const parseNumber = (value) => {
  if (!value) return 0;
  const numStr = String(value).replace(/,/g, '');
  const num = parseFloat(numStr);
  return isNaN(num) ? 0 : num;
};

const handlePaymentAmountInput = (value) => {
  const num = parseNumber(value);
  paymentData.value.amount = num;
};

const payAll = async () => {
  try {
    loadingPayment.value = true;

    await saleStore.addPayment({
      amount: sale.value.remainingAmount,
      paymentMethod: 'cash',
      currency: sale.value.currency,
      notes: '',
    });

    notificationStore.success('تم دفع المبلغ المتبقي بنجاح');

    const response = await saleStore.fetchSale(params.id);
    sale.value = response.data;

    loadingPayment.value = false;

    paymentData.value = {
      amount: null,
      paymentMethod: 'cash',
      currency: sale.value.currency,
      notes: '',
    };
  } catch (error) {
    console.error('Failed to pay all:', error);
    notificationStore.error('فشل في دفع المبلغ المتبقي');
  } finally {
    loadingPayment.value = false;
  }
};
// lifecycle
onMounted(async () => {
  try {
    // جلب تفاصيل الفاتورة
    const response = await saleStore.fetchSale(params.id);
    sale.value = response.data;

    // جلب معلومات الشركة من الإعدادات
    await settingsStore.fetchCompanyInfo();
    settings.value = settingsStore.companyInfo;

    // تعيين العملة للدفعات
    if (sale.value) {
      paymentData.value.currency = sale.value.currency;
    }

    const autoRefundAmount = computed(() => {
      const currency = sale.value?.currency || 'USD';
      return roundReturnNearest(
        Math.max(0, Math.min(returnedValue.value, maxRefundable.value)),
        currency
      );
    });

    watch(
      autoRefundAmount,
      (amount) => {
        returnForm.value.refundAmount = amount;
      },
      { immediate: false }
    );
  } catch (error) {
    console.error('Failed to load sale details:', error);
    notificationStore.error('فشل في تحميل تفاصيل المبيع');
  }
});
</script>

<style scoped>
@media print {
  .v-btn,
  .v-select,
  select-printer {
    display: none !important;
  }

  #invoiceWrapper {
    display: block !important;
  }

  #invoiceComponent {
    display: block !important;
  }
}
</style>
