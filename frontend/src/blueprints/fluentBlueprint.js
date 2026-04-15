/**
 * Fluent Design Blueprint for Vuetify
 * Based on Microsoft Fluent Design System
 */
export const fluentBlueprint = {
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        colors: {
          primary: '#0078D4',
          secondary: '#2B88D8',
          surface: '#F3F2F1',
          background: '#FAF9F8',
          error: '#D13438',
          info: '#0078D4',
          success: '#107C10',
          warning: '#FFB900',
          'on-primary': '#FFFFFF',
          'on-surface': '#323130',
          'on-background': '#323130',
          'on-error': '#FFFFFF',
          'surface-variant': '#EDEBE9',
          'surface-darken-1': '#E1DFDD',
          'surface-lighten-1': '#FAF9F8',
        },
      },
      dark: {
        colors: {
          primary: '#4CC2FF',
          secondary: '#60CDFF',
          surface: '#1F1F1F',
          background: '#141414',
          error: '#F1707B',
          info: '#4CC2FF',
          success: '#6CCB5F',
          warning: '#FCE100',
          'on-primary': '#000000',
          'on-surface': '#FFFFFF',
          'on-background': '#FFFFFF',
          'on-error': '#000000',
          'surface-variant': '#2D2D2D',
          'surface-darken-1': '#141414',
          'surface-lighten-1': '#2A2A2A',
        },
      },
    },
  },
    
    defaults: {
      VBtn: {
        rounded: 'md',
        elevation: 0,
        style: {
          textTransform: 'none',
          letterSpacing: 'normal',
          fontWeight: 600,
        },
      },
      
      VCard: {
        rounded: 'lg',
        elevation: 0,
        border: 'sm',
      },
      
      VTextField: {
        rounded: 'md',
        variant: 'outlined',
        density: 'comfortable',
        hideDetails: 'auto',
      },
      
      VSelect: {
        rounded: 'md',
        variant: 'outlined',
        density: 'comfortable',
        hideDetails: 'auto',
      },
      
      VDialog: {
        rounded: 'xl',
        elevation: 24,
      },
      
      VList: {
        rounded: 'lg',
        density: 'comfortable',
      },
      
      VListItem: {
        rounded: 'md',
      },
      
      VAppBar: {
        elevation: 0,
        border: 'b-sm',
      },
    },
  }