<template>
  <section class="report-kpis mb-4">
    <div v-if="kpiCurrencies.length === 0" class="kpi-empty">
      <EmptyState
        compact
        title="لا توجد مؤشرات"
        description="لم يتم العثور على بيانات للمؤشرات الرئيسية ضمن الفلاتر الحالية."
        icon="mdi-chart-box-outline"
      />
    </div>

    <template v-else>
      <div
        v-for="cur in kpiCurrencies"
        :key="cur"
        class="currency-group mb-4"
      >
        <div class="currency-label d-flex align-center ga-2 mb-2">
          <v-icon size="18" color="primary">mdi-cash-multiple</v-icon>
          <span class="text-subtitle-2 font-weight-bold">
            مؤشرات بعملة {{ cur }}
          </span>
          <v-chip v-if="kpiCurrencies.length > 1" size="x-small" variant="tonal">
            {{ cur }}
          </v-chip>
        </div>

        <div class="kpi-grid">
          <KpiCard
            v-for="kpi in cardsFor(cur)"
            :key="kpi.key"
            :label="kpi.label"
            :value="kpi.value"
            :icon="kpi.icon"
            :color="kpi.color"
            :note="kpi.note"
            :warning="kpi.warning"
            :unavailable="kpi.unavailable"
          />
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import KpiCard from './KpiCard.vue';
import { formatCurrency } from '@/utils/formatters';

const props = defineProps({
  kpisByCurrency: {
    type: Object,
    default: () => ({}),
  },
  inventory: {
    type: Object,
    default: () => ({}),
  },
  expensesSummary: {
    type: Object,
    default: () => ({}),
  },
  canViewProfit: {
    type: Boolean,
    default: true,
  },
});

const kpiCurrencies = computed(() => Object.keys(props.kpisByCurrency || {}));

const lowStockCount = computed(
  () => (props.inventory?.lowStockProducts || []).length,
);
const outOfStockCount = computed(
  () => (props.inventory?.outOfStockProducts || []).length,
);

function cardsFor(cur) {
  const k = props.kpisByCurrency[cur] || {};
  const cards = [
    {
      key: 'sales',
      label: 'إجمالي المبيعات',
      value: formatCurrency(k.sales, cur),
      icon: 'mdi-cart-arrow-right',
      color: 'primary',
      note: 'صافي قبل الضرائب والخصومات',
    },
    {
      key: 'paid',
      label: 'المبالغ المحصّلة',
      value: formatCurrency(k.totalPaid, cur),
      icon: 'mdi-cash-check',
      color: 'success',
      note: 'من جميع طرق الدفع (قبل الإرجاع)',
    },
    {
      key: 'refunded',
      label: 'المبالغ المرجعة',
      value: formatCurrency(k.refundedAmount || 0, cur),
      icon: 'mdi-cash-refund',
      color: (k.refundedAmount || 0) > 0 ? 'error' : 'success',
      note: 'المبالغ المعادة للعملاء عن المرتجعات والإلغاءات',
    },
    {
      key: 'netCollected',
      label: 'صافي التحصيل',
      value: formatCurrency(
        k.netCollected !== undefined ? k.netCollected : (k.totalPaid || 0) - (k.refundedAmount || 0),
        cur,
      ),
      icon: 'mdi-cash-100',
      color: ((k.netCollected !== undefined ? k.netCollected : (k.totalPaid || 0) - (k.refundedAmount || 0)) < 0)
        ? 'error'
        : 'success',
      note: 'المحصّل − المرجع',
    },
    {
      key: 'expenses',
      label: 'المصاريف',
      value: props.expensesSummary?.supported
        ? formatCurrency(props.expensesSummary.totalExpenses, cur)
        : 'غير متاح',
      icon: 'mdi-cash-minus',
      color: 'warning',
      note: 'وحدة المصاريف',
      unavailable: !props.expensesSummary?.supported,
      warning: !props.expensesSummary?.supported
        ? 'وحدة المصاريف غير متوفرة في المخطط الحالي'
        : '',
    },
  ];

  if (props.canViewProfit) {
    const np = k.netProfit;
    cards.push({
      key: 'netProfit',
      label: 'صافي الربح',
      value: np === null || np === undefined ? 'غير متاح' : formatCurrency(np, cur),
      icon: 'mdi-chart-line',
      color: np !== null && np !== undefined && np < 0 ? 'error' : 'success',
      note: 'الإيرادات − تكلفة البضاعة − المصاريف',
      unavailable: np === null || np === undefined,
      warning: np === null || np === undefined ? 'تعذّر حساب الربح بدقة من البيانات الحالية' : '',
    });
  }

  cards.push(
    {
      key: 'unpaid',
      label: 'الديون المستحقة',
      value: formatCurrency(k.unpaidBalances, cur),
      icon: 'mdi-account-cash-outline',
      color: 'info',
      note: 'الأرصدة غير المدفوعة من المبيعات',
    },
    {
      key: 'overdue',
      label: 'الأقساط المتأخرة',
      value: `${k.overdueInstallments || 0}`,
      icon: 'mdi-alert-circle-outline',
      color: (k.overdueInstallments || 0) > 0 ? 'error' : 'success',
      note: `بقيمة ${formatCurrency(k.lateAmounts, cur)}`,
      warning: (k.overdueInstallments || 0) > 0 ? 'يوجد أقساط فائتة الموعد' : '',
    },
    {
      key: 'lowStock',
      label: 'منتجات منخفضة المخزون',
      value: `${lowStockCount.value}`,
      icon: 'mdi-package-variant-closed-remove',
      color: lowStockCount.value > 0 ? 'warning' : 'success',
      note: outOfStockCount.value > 0
        ? `${outOfStockCount.value} نفد من المخزون`
        : 'كل المنتجات ضمن الحد الآمن',
    },
  );

  return cards;
}
</script>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.875rem;
}

@media (max-width: 1264px) {
  .kpi-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 960px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }
}
</style>
