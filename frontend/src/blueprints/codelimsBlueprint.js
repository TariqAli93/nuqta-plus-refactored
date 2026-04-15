// src/blueprints/minimalistBlueprint.js
export default {
  name: 'Minimalist Clean Blueprint',

  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#2563EB', // Blue 600 - Bold primary
          secondary: '#64748B', // Slate 500 - Neutral secondary
          accent: '#6366F1', // Indigo 500 - Modern accent
          info: '#3B82F6', // Blue 500
          success: '#10B981', // Emerald 500
          warning: '#F59E0B', // Amber 500
          error: '#EF4444', // Red 500
          background: '#F9FAFB', // Gray 50 - Clean background
          surface: '#FFFFFF', // Pure white cards
          'surface-variant': '#F3F4F6', // Gray 100
          'on-surface': '#1F2937', // Gray 800 - Strong text
          'on-background': '#111827', // Gray 900 - Darker text
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#3B82F6', // Blue 500 - Softer for dark
          secondary: '#64748B', // Slate 500
          accent: '#818CF8', // Indigo 400
          info: '#60A5FA', // Blue 400
          success: '#34D399', // Emerald 400
          warning: '#FBBF24', // Amber 400
          error: '#F87171', // Red 400
          background: '#0F172A', // Slate 900 - Deep background
          surface: '#1E293B', // Slate 800 - Card surface
          'surface-variant': '#334155', // Slate 700
          'on-surface': '#F1F5F9', // Slate 100 - Light text
          'on-background': '#F8FAFC', // Slate 50 - Lighter text
        },
      },
    },
  },

  typography: {
    fontFamily: '"Roboto", "Noto Sans Arabic", "Segoe UI", "Helvetica Neue", sans-serif',
    h1: {
      fontSize: '3.75rem',
      fontWeight: 700,
      letterSpacing: '-0.02em',
      lineHeight: 1.2,
    },
    h2: {
      fontSize: '2.5rem',
      fontWeight: 700,
      letterSpacing: '-0.01em',
      lineHeight: 1.3,
    },
    h3: {
      fontSize: '2rem',
      fontWeight: 600,
      letterSpacing: '0',
      lineHeight: 1.4,
    },
    h4: {
      fontSize: '1.5rem',
      fontWeight: 600,
      lineHeight: 1.4,
    },
    h5: {
      fontSize: '1.25rem',
      fontWeight: 600,
      lineHeight: 1.5,
    },
    h6: {
      fontSize: '1.125rem',
      fontWeight: 600,
      lineHeight: 1.5,
    },
    subtitle1: {
      fontSize: '1rem',
      fontWeight: 500,
      lineHeight: 1.6,
      color: '#6B7280',
    },
    subtitle2: {
      fontSize: '0.875rem',
      fontWeight: 500,
      lineHeight: 1.5,
      color: '#6B7280',
    },
    body1: {
      fontSize: '1rem',
      fontWeight: 400,
      lineHeight: 1.6,
    },
    body2: {
      fontSize: '0.875rem',
      fontWeight: 400,
      lineHeight: 1.5,
    },
    caption: {
      fontSize: '0.75rem',
      fontWeight: 500,
      letterSpacing: '0.5px',
      textTransform: 'uppercase',
    },
  },

  componentDefaults: {
    // Global defaults
    global: {
      ripple: true,
      rounded: 'lg',
    },

    // Buttons - Bold & Clean
    VBtn: {
      rounded: 'lg',
      elevation: 0,
      size: 'default',
      variant: 'flat',
      ripple: true,
      class: 'text-none font-weight-medium',
      style: 'letter-spacing: 0;',
    },

    // Cards - Minimal elevation
    VCard: {
      flat: true,
      elevation: 0,
      rounded: 'lg',
      border: true,
      class: 'pa-6',
    },

    // Text Fields - Clean outline
    VTextField: {
      variant: 'outlined',
      density: 'comfortable',
      color: 'primary',
      hideDetails: 'auto',
      bgColor: 'surface',
      rounded: 'lg',
    },

    VTextarea: {
      variant: 'outlined',
      density: 'comfortable',
      color: 'primary',
      hideDetails: 'auto',
      bgColor: 'surface',
      rounded: 'lg',
    },

    // Selects
    VSelect: {
      variant: 'outlined',
      density: 'comfortable',
      color: 'primary',
      hideDetails: 'auto',
      bgColor: 'surface',
      rounded: 'lg',
    },

    VAutocomplete: {
      variant: 'outlined',
      density: 'comfortable',
      color: 'primary',
      hideDetails: 'auto',
      bgColor: 'surface',
      rounded: 'lg',
    },

    VCombobox: {
      variant: 'outlined',
      density: 'comfortable',
      color: 'primary',
      hideDetails: 'auto',
      bgColor: 'surface',
      rounded: 'lg',
    },

    // Chips - Rounded minimal
    VChip: {
      rounded: 'lg',
      elevation: 0,
      variant: 'flat',
      size: 'small',
      class: 'font-weight-medium',
    },

    // Data Tables - Clean
    VDataTable: {
      hover: true,
      density: 'comfortable',
      class: 'minimal-table',
    },

    // Lists - Comfortable spacing
    VList: {
      density: 'comfortable',
      rounded: 'lg',
      nav: true,
    },

    VListItem: {
      rounded: 'lg',
      class: 'mb-1 mx-3',
    },

    // App Bar - Flat minimal
    VAppBar: {
      flat: true,
      elevation: 0,
      border: 'b',
      height: 72,
      color: 'surface',
    },

    // Navigation Drawer
    VNavigationDrawer: {
      elevation: 0,
      border: 'e',
      width: 280,
      color: 'surface-variant',
    },

    // Dialogs - Clean rounded
    VDialog: {
      rounded: 'lg',
      elevation: 0,
      maxWidth: 500,
    },

    // Snackbars
    VSnackbar: {
      rounded: 'lg',
      elevation: 0,
      location: 'top',
      timeout: 3000,
    },

    // Tooltips
    VTooltip: {
      location: 'top',
      transition: 'fade-transition',
    },

    // Menus
    VMenu: {
      rounded: 'lg',
      elevation: 2,
      transition: 'scale-transition',
    },

    // Tabs
    VTabs: {
      color: 'primary',
      density: 'comfortable',
      hideSlider: false,
      sliderColor: 'primary',
    },

    VTab: {
      class: 'text-none font-weight-medium',
      ripple: true,
    },

    // Progress indicators
    VProgressCircular: {
      color: 'primary',
      width: 3,
    },

    VProgressLinear: {
      color: 'primary',
      height: 4,
      rounded: true,
    },

    // Dividers
    VDivider: {
      thickness: 1,
      opacity: 1,
    },

    // Badges
    VBadge: {
      color: 'error',
      dot: false,
      inline: false,
    },

    // Avatars
    VAvatar: {
      rounded: 'circle',
      size: 'default',
    },

    // Icons
    VIcon: {
      size: 'default',
    },

    // Switches
    VSwitch: {
      color: 'primary',
      hideDetails: 'auto',
      inset: false,
    },

    // Checkboxes
    VCheckbox: {
      color: 'primary',
      hideDetails: 'auto',
    },

    // Radio buttons
    VRadio: {
      color: 'primary',
      hideDetails: 'auto',
    },

    // Sliders
    VSlider: {
      color: 'primary',
      thumbLabel: false,
      hideDetails: 'auto',
    },

    // File inputs
    VFileInput: {
      variant: 'outlined',
      density: 'comfortable',
      color: 'primary',
      hideDetails: 'auto',
      rounded: 'lg',
    },

    // Expansion panels
    VExpansionPanel: {
      elevation: 0,
      rounded: 'lg',
    },

    VExpansionPanels: {
      variant: 'default',
    },

    // Alerts
    VAlert: {
      variant: 'flat',
      border: 'start',
      borderColor: 'currentColor',
      rounded: 'lg',
      elevation: 0,
    },

    // Banners
    VBanner: {
      elevation: 0,
      rounded: 'lg',
      border: true,
    },

    // Bottom sheets
    VBottomSheet: {
      rounded: 't-lg',
      elevation: 8,
    },

    // Steppers
    VStepper: {
      elevation: 0,
      flat: true,
      rounded: 'lg',
    },

    // Timelines
    VTimeline: {
      density: 'comfortable',
      side: 'end',
    },

    // Toolbars
    VToolbar: {
      flat: true,
      elevation: 0,
      density: 'comfortable',
    },
  },

  density: 'comfortable',

  spacing: {
    base: 8,
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },

  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
  },

  elevation: {
    none: 0,
    sm: 1,
    md: 2,
    lg: 4,
    xl: 8,
  },

  // Custom utilities and helpers
  utilities: {
    // Shadow system
    shadows: {
      none: 'none',
      sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
      md: '0 2px 8px rgba(0, 0, 0, 0.08)',
      lg: '0 4px 16px rgba(0, 0, 0, 0.1)',
      xl: '0 8px 24px rgba(0, 0, 0, 0.12)',
    },

    // Transition system
    transitions: {
      fast: '0.15s cubic-bezier(0.4, 0, 0.2, 1)',
      base: '0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      slow: '0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    },
  },

  // RTL support for Arabic
  rtl: true,

  // Display breakpoints
  display: {
    mobileBreakpoint: 'sm',
    thresholds: {
      xs: 0,
      sm: 600,
      md: 960,
      lg: 1280,
      xl: 1920,
    },
  },

  // Icons configuration
  icons: {
    defaultSet: 'mdi',
    aliases: {
      // Custom icon aliases
      add: 'mdi-plus',
      edit: 'mdi-pencil',
      delete: 'mdi-delete',
      save: 'mdi-content-save',
      cancel: 'mdi-close',
      search: 'mdi-magnify',
      filter: 'mdi-filter',
      sort: 'mdi-sort',
      menu: 'mdi-menu',
      close: 'mdi-close',
      check: 'mdi-check',
      error: 'mdi-alert-circle',
      warning: 'mdi-alert',
      info: 'mdi-information',
      success: 'mdi-check-circle',
    },
  },

  // Locale configuration
  locale: {
    defaultLocale: 'ar',
    fallbackLocale: 'en',
  },
};
