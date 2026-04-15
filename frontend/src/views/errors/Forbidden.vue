<template>
  <v-container class="fill-height d-flex align-center justify-center" fluid>
    <v-row align="center" justify="center">
      <v-col cols="12" sm="8" md="6" lg="4">
        <v-card class="text-center pa-8 rounded-xl" elevation="10">
          <v-icon icon="mdi-lock-alert" size="120" color="error" class="mb-6" />

          <h1 class="text-h2 font-weight-bold mb-2">403</h1>

          <h2 class="text-h5 mb-3 font-weight-medium">غير مسموح بالوصول</h2>

          <p class="text-body-1 text-medium-emphasis mb-6">
            ليس لديك الصلاحية للوصول إلى هذه الصفحة. إذا كنت تعتقد أن هذا خطأ، الرجاء التواصل مع
            المسؤول عن النظام.
          </p>

          <v-divider class="my-6" />

          <div class="d-flex flex-column flex-sm-row gap-3 justify-center">
            <v-btn color="primary" variant="flat" prepend-icon="mdi-arrow-right" @click="goBack">
              العودة للخلف
            </v-btn>

            <v-btn color="primary" variant="outlined" prepend-icon="mdi-home" @click="goHome">
              الذهاب للوحة التحكم
            </v-btn>
          </div>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { useRouter } from 'vue-router';
const router = useRouter();

const goBack = () => router.go(-1);
const goHome = () => router.push('/');
</script>

<style scoped>
.fill-height {
  min-height: 100vh;
}

.gap-3 {
  gap: 12px;
}

/* لمسة جمالية للبطاقة */
.v-card {
  backdrop-filter: blur(10px);
}
</style>
