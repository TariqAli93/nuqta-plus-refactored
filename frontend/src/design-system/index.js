/**
 * Design System v2.0
 * Enhanced comprehensive design tokens and utilities based on Fluent Design principles
 * @see fluentBlueprint.js
 */

export const designSystem = {
  // ============================================
  // Colors - Based on Fluent Design
  // ============================================
  colors: {
    light: {
      primary: '#0078D4',
      secondary: '#2B88D8',
      surface: '#F3F2F1',
      background: '#FAF9F8',
      error: '#D13438',
      info: '#0078D4',
      success: '#107C10',
      warning: '#FFB900',
      onPrimary: '#FFFFFF',
      onSurface: '#323130',
      onBackground: '#323130',
      onError: '#FFFFFF',
      accent: '#0078D4',
      neutral: '#605E5C',
    },
    dark: {
      primary: '#4CC2FF',
      secondary: '#60CDFF',
      surface: '#1F1F1F',
      background: '#141414',
      error: '#F1707B',
      info: '#4CC2FF',
      success: '#6CCB5F',
      warning: '#FCE100',
      onPrimary: '#000000',
      onSurface: '#FFFFFF',
      onBackground: '#FFFFFF',
      onError: '#000000',
      accent: '#4CC2FF',
      neutral: '#A19F9D',
    },
  },

  // ============================================
  // Spacing Scale (8px base unit)
  // ============================================
  spacing: {
    0: '0',
    xs: '4px',    // 0.5 * 8
    sm: '8px',    // 1 * 8
    md: '16px',   // 2 * 8
    lg: '24px',   // 3 * 8
    xl: '32px',   // 4 * 8
    '2xl': '40px', // 5 * 8
    '3xl': '48px', // 6 * 8
    '4xl': '64px', // 8 * 8
    '5xl': '80px', // 10 * 8
    '6xl': '96px', // 12 * 8
  },

  // ============================================
  // Border Radius
  // ============================================
  borderRadius: {
    none: '0',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '20px',
    '3xl': '24px',
    '4xl': '32px',
    full: '9999px',
  },

  // ============================================
  // Border Width
  // ============================================
  borderWidth: {
    none: '0',
    thin: '1px',
    base: '2px',
    thick: '4px',
  },

  // ============================================
  // Typography Scale
  // ============================================
  typography: {
    fontFamily: {
      base: '"Segoe UI", "Roboto", "Cairo", sans-serif',
      mono: '"Cascadia Code", "Roboto Mono", monospace',
      heading: '"Segoe UI", "Cairo", sans-serif',
    },
    fontSize: {
      xs: '0.75rem',    // 12px
      sm: '0.875rem',   // 14px
      base: '1rem',     // 16px
      lg: '1.125rem',   // 18px
      xl: '1.25rem',    // 20px
      '2xl': '1.5rem',  // 24px
      '3xl': '1.875rem', // 30px
      '4xl': '2.25rem', // 36px
      '5xl': '3rem',    // 48px
    },
    fontWeight: {
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
    },
    lineHeight: {
      none: 1,
      tight: 1.2,
      snug: 1.375,
      normal: 1.5,
      relaxed: 1.75,
      loose: 2,
    },
    letterSpacing: {
      tighter: '-0.05em',
      tight: '-0.025em',
      normal: '0',
      wide: '0.025em',
      wider: '0.05em',
      widest: '0.1em',
    },
  },

  // ============================================
  // Shadows / Elevation
  // ============================================
  shadows: {
    none: 'none',
    xs: '0 1px 1px rgba(0, 0, 0, 0.05)',
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px rgba(0, 0, 0, 0.1)',
    '2xl': '0 25px 50px rgba(0, 0, 0, 0.15)',
    inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
  },

  // ============================================
  // Z-Index Scale
  // ============================================
  zIndex: {
    hide: -1,
    base: 0,
    docked: 10,
    dropdown: 1000,
    sticky: 1100,
    banner: 1200,
    overlay: 1300,
    modal: 1400,
    popover: 1500,
    skipLink: 1600,
    tooltip: 1700,
    notification: 1800,
    max: 9999,
  },

  // ============================================
  // Breakpoints
  // ============================================
  breakpoints: {
    xs: '0px',
    sm: '600px',
    md: '960px',
    lg: '1264px',
    xl: '1904px',
  },

  // ============================================
  // Transitions & Animations
  // ============================================
  transitions: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    base: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    slower: '400ms cubic-bezier(0.4, 0, 0.2, 1)',
    easeIn: '150ms cubic-bezier(0.4, 0, 1, 1)',
    easeOut: '150ms cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  },

  animations: {
    duration: {
      fast: '150ms',
      base: '200ms',
      slow: '300ms',
      slower: '500ms',
    },
    timing: {
      linear: 'linear',
      ease: 'ease',
      easeIn: 'ease-in',
      easeOut: 'ease-out',
      easeInOut: 'ease-in-out',
    },
    keyframes: {
      fadeIn: '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }',
      fadeOut: '@keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }',
      slideUp: '@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }',
      slideDown: '@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }',
      scaleIn: '@keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }',
    },
  },

  // ============================================
  // Opacity Scale
  // ============================================
  opacity: {
    0: '0',
    25: '0.25',
    50: '0.5',
    75: '0.75',
    100: '1',
  },

  // ============================================
  // Component Styles
  // ============================================
  components: {
    card: {
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid rgba(var(--v-theme-on-surface), 0.12)',
      background: 'rgb(var(--v-theme-surface))',
      shadow: '0 2px 4px rgba(var(--v-theme-on-surface), 0.05)',
      hoverShadow: 'none', // Removed hover shadow in v2
      hoverBorder: 'rgba(var(--v-theme-primary), 0.3)',
    },
    button: {
      borderRadius: '8px',
      fontWeight: 600,
      textTransform: 'none',
      minHeight: '40px',
      padding: '0 16px',
      hoverScale: '1.02',
      activeScale: '0.98',
    },
    input: {
      borderRadius: '8px',
      borderWidth: '1px',
      minHeight: '40px',
      focusBorder: 'rgb(var(--v-theme-primary))',
    },
    chip: {
      borderRadius: '16px',
      height: '32px',
    },
    avatar: {
      borderRadius: '50%',
      sizes: {
        sm: '32px',
        md: '40px',
        lg: '56px',
        xl: '72px',
      },
    },
    table: {
      headerBg: 'rgba(var(--v-theme-on-surface), 0.04)',
      rowHover: 'rgba(var(--v-theme-primary), 0.04)',
      border: 'rgba(var(--v-theme-on-surface), 0.08)',
    },
  },

  // ============================================
  // Layout Tokens
  // ============================================
  layout: {
    container: {
      maxWidth: '1280px',
      padding: '16px',
    },
    sidebar: {
      width: '280px',
      collapsedWidth: '64px',
    },
    header: {
      height: '64px',
    },
    section: {
      spacing: '32px',
    },
  },

  // ============================================
  // Grid System
  // ============================================
  grid: {
    columns: 12,
    gutter: '16px',
    breakpoints: {
      xs: { columns: 4, gutter: '8px' },
      sm: { columns: 8, gutter: '12px' },
      md: { columns: 12, gutter: '16px' },
      lg: { columns: 12, gutter: '24px' },
    },
  },
};

/**
 * Get theme-aware color value
 */
export const getThemeColor = (colorName, theme = 'light') => {
  return designSystem.colors[theme]?.[colorName] || designSystem.colors.light[colorName];
};

/**
 * Get color with opacity
 */
export const getColorWithOpacity = (colorName, opacity = 1, theme = 'light') => {
  const color = getThemeColor(colorName, theme);
  // Convert hex to rgb for opacity
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

/**
 * CSS Variables generator for theme
 */
export const generateThemeVariables = (theme = 'light') => {
  const colors = designSystem.colors[theme];
  const vars = {};
  
  Object.entries(colors).forEach(([key, value]) => {
    vars[`--ds-color-${key}`] = value;
  });

  Object.entries(designSystem.spacing).forEach(([key, value]) => {
    vars[`--ds-spacing-${key}`] = value;
  });

  Object.entries(designSystem.borderRadius).forEach(([key, value]) => {
    vars[`--ds-radius-${key}`] = value;
  });

  Object.entries(designSystem.zIndex).forEach(([key, value]) => {
    vars[`--ds-z-${key}`] = value;
  });

  return vars;
};

/**
 * Get responsive breakpoint value
 */
export const getBreakpoint = (name) => {
  return designSystem.breakpoints[name] || designSystem.breakpoints.md;
};

/**
 * Generate grid column class
 */
export const getGridColumn = (columns, total = 12) => {
  return `${(columns / total) * 100}%`;
};

export default designSystem;
