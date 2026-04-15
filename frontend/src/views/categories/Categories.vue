<template>
  <div>
    <v-card class="mb-4">
      <div class="flex items-center justify-space-between pa-3">
        <div class="font-semibold text-h6 text-primary">إدارة التصنيفات</div>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="openDialog()"
          >تصنيف جديد
        </v-btn>
      </div>
    </v-card>

    <v-card>
      <v-data-table
        :headers="headers"
        :items="categoryStore.categories"
        :loading="categoryStore.loading"
        :items-per-page="categoryStore.pagination.limit"
        :page="categoryStore.pagination.page"
        :items-length="categoryStore.pagination.total"
        server-items-length
        density="comfortable"
        hide-default-footer
        @update:items-per-page="changeItemsPerPage"
      >
        <template #[`item.actions`]="{ item }">
          <v-btn icon="mdi-pencil" size="small" variant="text" @click="openDialog(item)"></v-btn>
          <v-btn
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            @click="confirmDelete(item)"
          ></v-btn>
        </template>
      </v-data-table>
      
      <PaginationControls
        :pagination="categoryStore.pagination"
        @update:page="changePage"
        @update:items-per-page="changeItemsPerPage"
      />
    </v-card>

    <v-dialog v-model="dialog" max-width="500">
      <v-card>
        <v-card-title class="text-white bg-secondary">{{
          isEdit ? 'تعديل تصنيف' : 'تصنيف جديد'
        }}</v-card-title>
        <v-card-text>
          <v-form ref="form">
            <v-text-field
              v-model="formData.name"
              label="اسم التصنيف"
              :rules="[rules.required]"
              variant="outlined"
            ></v-text-field>
            <v-textarea v-model="formData.description" variant="outlined" class="mt-4" label="الوصف" rows="2"></v-textarea>
          </v-form>
        </v-card-text>

        <v-divider></v-divider>

        <v-card-actions>
          <v-btn color="primary" variant="elevated" :loading="saving" @click="handleSubmit"
            >حفظ</v-btn
          >
          <v-spacer />
          <v-btn @click="dialog = false">إلغاء</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ConfirmDialog
      v-model="deleteDialog"
      title="تأكيد الحذف"
      message="هل أنت متأكد من حذف التصنيف؟"
      :details="selectedCategory ? `التصنيف: ${selectedCategory.name}` : ''"
      type="error"
      confirm-text="حذف"
      cancel-text="إلغاء"
      @confirm="handleDelete"
      @cancel="deleteDialog = false"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useCategoryStore } from '@/stores/category';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PaginationControls from '@/components/PaginationControls.vue';

const categoryStore = useCategoryStore();

const dialog = ref(false);
const deleteDialog = ref(false);
const form = ref(null);
const saving = ref(false);
const selectedCategory = ref(null);
const formData = ref({
  name: '',
  description: '',
});

const headers = [
  { title: 'الاسم', key: 'name' },
  { title: 'الوصف', key: 'description' },
  { title: 'إجراءات', key: 'actions', sortable: false },
];

const isEdit = computed(() => !!selectedCategory.value);

const rules = {
  required: (v) => !!v || 'هذا الحقل مطلوب',
};

const openDialog = (category = null) => {
  if (category) {
    selectedCategory.value = category;
    formData.value = { ...category };
  } else {
    selectedCategory.value = null;
    formData.value = { name: '', description: '' };
  }
  dialog.value = true;
};

const handleSubmit = async () => {
  const { valid } = await form.value.validate();
  if (!valid) return;

  saving.value = true;
  try {
    if (isEdit.value) {
      await categoryStore.updateCategory(selectedCategory.value.id, formData.value);
    } else {
      await categoryStore.createCategory(formData.value);
    }
    dialog.value = false;
  } catch {
    // Error handled by notification
  } finally {
    saving.value = false;
  }
};

const confirmDelete = (category) => {
  selectedCategory.value = category;
  deleteDialog.value = true;
};

const handleDelete = async () => {
  try {
    await categoryStore.deleteCategory(selectedCategory.value.id);
    deleteDialog.value = false;
  } catch {
    // Error handled by notification
  }
};

const changePage = (page) => {
  const pageNum = Number(page);
  if (isNaN(pageNum) || pageNum < 1) return;
  if (pageNum === categoryStore.pagination.page) return;
  categoryStore.pagination.page = pageNum;
  categoryStore.fetchCategories({
    page: pageNum,
    limit: categoryStore.pagination.limit,
  });
};

const changeItemsPerPage = (limit) => {
  const limitNum = Number(limit);
  categoryStore.pagination.limit = limitNum;
  categoryStore.pagination.page = 1;
  categoryStore.fetchCategories({
    page: 1,
    limit: limitNum,
  });
};

onMounted(() => {
  categoryStore.fetchCategories({
    page: 1,
    limit: categoryStore.pagination.limit,
  });
});
</script>
