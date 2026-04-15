// Import Vuetify styles (will be processed by SASS)
import '@/styles/main.scss';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { ar } from 'vuetify/locale';
import '@mdi/font/css/materialdesignicons.css';
import { md3 } from 'vuetify/blueprints';
import { fluentBlueprint } from '@/blueprints/fluentBlueprint';

const lightTheme = {
  dark: false,
  colors: {
    primary: '#7B5CFF', // Violet Blue modern
    secondary: '#3A3A3D', // Soft graphite
    accent: '#9D8CFF', // Light violet accent
    error: '#FF5C5C', // Soft red (less aggressive)
    info: '#4DA3FF', // Calm info blue
    success: '#4ED48A', // Fresh green
    warning: '#FFC85C', // Amber gold
    background: '#F5F5F5',
    surface: '#FFFFFF',
  },
};

const darkTheme = {
  dark: true,
  colors: {
    primary: '#7B5CFF', // Violet Blue modern
    secondary: '#3A3A3D', // Soft graphite
    accent: '#9D8CFF', // Light violet accent
    error: '#FF5C5C', // Soft red (less aggressive)
    info: '#4DA3FF', // Calm info blue
    success: '#4ED48A', // Fresh green
    warning: '#FFC85C', // Amber gold
    background: '#0F0F12', // Deep matte dark
    surface: '#1A1A1F', // Modern elevated dark
    'surface-darken-1': '#242429',
    'surface-darken-2': '#2E2E33',
    'surface-darken-3': '#38383E',
    'surface-lighten-1': '#121216',
    'surface-lighten-2': '#141418',
    'surface-lighten-3': '#16161A',
  },
};

export default createVuetify({
  components,
  directives,
  blueprint: fluentBlueprint,
  locale: {
    locale: 'ar',
    fallback: 'ar',
    messages: { ar },
    rtl: { ar: true },
  },
  theme: {
    defaultTheme: 'dark',
    themes: {
      light: lightTheme,
      dark: darkTheme,
    },
  },
});
