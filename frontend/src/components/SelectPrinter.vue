<template>
  <div class="printer-selector">
    <v-dialog v-model="dialog" max-width="500">
      <template #activator="{ props }">
        <v-btn v-bind="props" color="primary">اختر طابعة</v-btn>
      </template>
      <v-card>
        <v-card-title>اختر طابعة للطباعة</v-card-title>
        <v-divider />
        <v-card-text>
          <div v-if="availablePrinters.length === 0" class="text-center pa-4">
            <v-icon color="warning" size="48" class="mb-2">mdi-printer-off</v-icon>
            <p class="text-body-1">لم يتم العثور على أي طابعات</p>
            <p class="text-caption text-grey">يرجى التأكد من توصيل الطابعة وإعدادات النظام</p>
            <v-btn color="primary" class="mt-2" @click="refreshPrinters">إعادة المحاولة</v-btn>
          </div>
          <v-radio-group v-else v-model="selectedPrinter">
            <v-radio
              v-for="printer in availablePrinters"
              :key="printer.name"
              :label="printer.displayName || printer.name"
              :value="printer"
            >
              <template v-if="printer.isDefault" #label>
                <span
                  >{{ printer.displayName || printer.name }}
                  <v-chip size="x-small" color="primary">افتراضي</v-chip></span
                >
              </template>
            </v-radio>
          </v-radio-group>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-btn color="primary" variant="elevated" @click="confirmSelection">تأكيد</v-btn>
          <v-spacer></v-spacer>
          <v-btn text @click="dialog = false">إلغاء</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useNotificationStore } from '../stores/notification';
import { useSaleStore } from '../stores/sale';

const { error, success } = useNotificationStore();
const { setPrinter, getPrinter } = useSaleStore();

const availablePrinters = ref([]);
const selectedPrinter = ref(getPrinter() || null);

const dialog = ref(false);

const confirmSelection = () => {
  if (selectedPrinter.value) {
    setPrinter(selectedPrinter.value);
    success(
      `تم اختيار الطابعة: ${selectedPrinter.value.displayName || selectedPrinter.value.name}`
    );
    dialog.value = false;
  } else {
    error('يرجى اختيار طابعة قبل التأكيد');
  }
};

const refreshPrinters = async () => {
  try {
    const printers = await window.electronAPI.getPrinters();

    if (!printers || printers.length === 0) {
      availablePrinters.value = [];
      error('لم يتم العثور على أي طابعات');
      return;
    }

    availablePrinters.value = printers;
    success(`تم جلب ${printers.length} طابعة بنجاح`);
  } catch (err) {
    console.error('خطأ في تحديث الطابعات:', err);
    error('خطأ في تحديث الطابعات: ' + (err.message || 'خطأ غير معروف'));
  }
};

onMounted(async () => {
  try {
    const printers = await window.electronAPI.getPrinters();

    if (!printers || printers.length === 0) {
      availablePrinters.value = [];
      error('لم يتم العثور على أي طابعات. يرجى التأكد من توصيل الطابعة وإعدادات النظام.');
      return;
    }

    availablePrinters.value = printers;
    success(`تم جلب ${printers.length} طابعة بنجاح`);
  } catch (err) {
    console.error('خطأ في جلب الطابعات:', err);
    error('خطأ في جلب الطابعات: ' + (err.message || 'خطأ غير معروف'));
  }
});
</script>
