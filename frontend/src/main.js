import { createApp } from 'vue';
import { createPinia } from 'pinia';
import vuetify from './plugins/vuetify';
import router from './router';
import fontLoader from './plugins/fontLoader';
import loadingPlugin from './plugins/loading';
import rbacPlugin from './plugins/rbac';
import VueApexCharts from 'vue3-apexcharts';
import App from './App.vue';
import '@/styles/main.scss';

// استيراد نظام الخطوط
import './styles/fonts.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(vuetify);
app.use(fontLoader); // تفعيل نظام تحميل الخطوط الذكي
app.use(loadingPlugin); // تفعيل نظام التحميل المتقدم
app.use(rbacPlugin); // تفعيل توجيهات RBAC لتعطيل/إخفاء العناصر حسب الصلاحيات
app.use(VueApexCharts);

app.mount('#app');
