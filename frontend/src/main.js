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

import { initAxiosBaseUrl } from './plugins/axios';
import { useConnectionStore } from './stores/connection';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(vuetify);
app.use(fontLoader);
app.use(loadingPlugin);
app.use(rbacPlugin);
app.use(VueApexCharts);

// Initialize server connection and sync axios baseURL
const connectionStore = useConnectionStore();
connectionStore.loadSavedConnection();
initAxiosBaseUrl(connectionStore);

app.mount('#app');
