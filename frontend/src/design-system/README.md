# Design System v2.0

Comprehensive design system based on Microsoft Fluent Design principles, integrated with Vuetify.

## What's New in v2.0

- ✅ **Removed hover shadows from main cards** - Cleaner, more subtle hover effects
- ✅ **Grid system utilities** - Pre-built grid column classes
- ✅ **Animation keyframes** - Built-in animation definitions
- ✅ **Enhanced card variants** - `ds-card-elevated` for cards that need hover shadows
- ✅ **State utilities** - Disabled, hidden, screen-reader only classes
- ✅ **Component tokens** - Table, input focus states, button interactions
- ✅ **Better hover states** - Border color changes instead of shadow changes

## Usage

### CSS Variables

All design tokens are available as CSS variables that automatically adapt to light/dark themes:

```css
.my-element {
  padding: var(--ds-spacing-lg);
  border-radius: var(--ds-radius-xl);
  box-shadow: var(--ds-shadow-md);
  font-size: var(--ds-font-size-base);
  font-weight: var(--ds-font-weight-semibold);
  color: rgb(var(--v-theme-on-surface));
  transition: all var(--ds-transition-base);
  z-index: var(--ds-z-modal);
}
```

### Utility Classes

#### Cards
```html
<!-- Basic card (no hover shadow) -->
<div class="ds-card">
  Content
</div>

<!-- Card with hover border effect -->
<div class="ds-card ds-card-hover">
  Content - hover changes border color
</div>

<!-- Card with hover shadow (use when elevation needed) -->
<div class="ds-card ds-card-elevated">
  Content - hover adds shadow
</div>

<!-- Interactive card -->
<div class="ds-card ds-card-interactive">
  Clickable content
</div>
```

#### Typography
```html
<h1 class="ds-heading-1">Heading 1</h1>
<h2 class="ds-heading-2">Heading 2</h2>
<h3 class="ds-heading-3">Heading 3</h3>

<h2 class="ds-section-title">Section Title</h2>
<p class="ds-section-subtitle">Section subtitle</p>

<p class="ds-body-large">Large body text</p>
<p class="ds-body-base">Base body text</p>
<p class="ds-body-small">Small body text</p>
<span class="ds-caption">Caption text</span>

<div class="ds-stat-value">123</div>
<div class="ds-stat-label">Statistics Label</div>
```

#### Spacing
```html
<!-- Gap -->
<div class="ds-flex ds-gap-md">
  <div>Item 1</div>
  <div>Item 2</div>
</div>

<!-- Padding -->
<div class="ds-p-lg">Padding all sides</div>
<div class="ds-px-md ds-py-sm">Padding horizontal and vertical</div>

<!-- Margin -->
<div class="ds-mb-xl">Margin bottom</div>
<div class="ds-mt-lg">Margin top</div>
<div class="ds-mx-auto">Centered with auto margins</div>
```

#### Grid System
```html
<div class="ds-grid ds-grid-cols-3 ds-gap-lg">
  <div>Column 1</div>
  <div>Column 2</div>
  <div>Column 3</div>
</div>
```

#### Border & Shadows
```html
<div class="ds-rounded-xl ds-shadow-lg">
  Rounded with shadow
</div>
```

#### Layout
```html
<div class="ds-container">
  Centered container with max-width
</div>

<div class="ds-flex ds-items-center ds-justify-between">
  Flex layout
</div>
```

#### Animations
```html
<div class="ds-animate-fade-in">
  Fades in on mount
</div>

<div class="ds-animate-slide-up">
  Slides up on mount
</div>

<div class="ds-animate-scale-in">
  Scales in on mount
</div>
```

#### Interactive States
```html
<button class="ds-interactive ds-focus-visible">
  Interactive button
</button>

<div class="ds-disabled">
  Disabled content
</div>
```

### JavaScript API

#### Basic Usage
```javascript
import designSystem, { getThemeColor, getBreakpoint } from '@/design-system';

// Get color value
const primaryColor = getThemeColor('primary', 'light'); // '#0078D4'
const darkPrimary = getThemeColor('primary', 'dark'); // '#4CC2FF'

// Access design tokens
const spacing = designSystem.spacing.lg; // '24px'
const fontSize = designSystem.typography.fontSize.xl; // '1.25rem'
const zIndex = designSystem.zIndex.modal; // 1400

// Get breakpoint
const mdBreakpoint = getBreakpoint('md'); // '960px'

// Grid utilities
const gridColumn = getGridColumn(6, 12); // '50%'
```

#### Composable Usage
```javascript
import { useDesignSystem } from '@/composables/useDesignSystem';

const {
  isDark,
  getSpacing,
  getRadius,
  getFontSize,
  getShadow,
  getZIndex,
  getTransition,
  getTextColor,
  getBgColor,
  getBorderColor,
  createStyle,
  isBreakpoint,
} = useDesignSystem();

// Get CSS variables
const padding = getSpacing('lg'); // 'var(--ds-spacing-lg)'
const radius = getRadius('xl'); // 'var(--ds-radius-xl)'

// Generate style object
const cardStyle = createStyle({
  padding: 'lg',
  radius: 'xl',
  shadow: 'md',
  fontSize: 'base',
  fontWeight: 'semibold',
  transition: 'base',
});
// Returns: { padding: 'var(--ds-spacing-lg)', ... }

// Check breakpoint
if (isBreakpoint('md')) {
  // Do something at md breakpoint
}
```

## Design Tokens

### Spacing Scale (8px base)

- `--ds-spacing-0`: 0
- `--ds-spacing-xs`: 4px
- `--ds-spacing-sm`: 8px
- `--ds-spacing-md`: 16px
- `--ds-spacing-lg`: 24px
- `--ds-spacing-xl`: 32px
- `--ds-spacing-2xl`: 40px
- `--ds-spacing-3xl`: 48px
- `--ds-spacing-4xl`: 64px
- `--ds-spacing-5xl`: 80px
- `--ds-spacing-6xl`: 96px

### Border Radius

- `--ds-radius-none`: 0
- `--ds-radius-sm`: 4px
- `--ds-radius-md`: 8px
- `--ds-radius-lg`: 12px
- `--ds-radius-xl`: 16px
- `--ds-radius-2xl`: 20px
- `--ds-radius-3xl`: 24px
- `--ds-radius-4xl`: 32px
- `--ds-radius-full`: 9999px

### Border Width

- `--ds-border-none`: 0
- `--ds-border-thin`: 1px
- `--ds-border-base`: 2px
- `--ds-border-thick`: 4px

### Typography

#### Font Sizes
- `--ds-font-size-xs`: 0.75rem (12px)
- `--ds-font-size-sm`: 0.875rem (14px)
- `--ds-font-size-base`: 1rem (16px)
- `--ds-font-size-lg`: 1.125rem (18px)
- `--ds-font-size-xl`: 1.25rem (20px)
- `--ds-font-size-2xl`: 1.5rem (24px)
- `--ds-font-size-3xl`: 1.875rem (30px)
- `--ds-font-size-4xl`: 2.25rem (36px)
- `--ds-font-size-5xl`: 3rem (48px)

#### Font Weights
- `--ds-font-weight-light`: 300
- `--ds-font-weight-normal`: 400
- `--ds-font-weight-medium`: 500
- `--ds-font-weight-semibold`: 600
- `--ds-font-weight-bold`: 700
- `--ds-font-weight-extrabold`: 800

#### Line Heights
- `--ds-line-height-none`: 1
- `--ds-line-height-tight`: 1.2
- `--ds-line-height-snug`: 1.375
- `--ds-line-height-normal`: 1.5
- `--ds-line-height-relaxed`: 1.75
- `--ds-line-height-loose`: 2

### Shadows

- `--ds-shadow-none`: none
- `--ds-shadow-xs`: Subtle elevation
- `--ds-shadow-sm`: Small elevation
- `--ds-shadow-md`: Medium elevation
- `--ds-shadow-lg`: Large elevation
- `--ds-shadow-xl`: Extra large elevation
- `--ds-shadow-2xl`: Maximum elevation
- `--ds-shadow-inner`: Inner shadow

### Z-Index Scale

- `--ds-z-hide`: -1
- `--ds-z-base`: 0
- `--ds-z-docked`: 10
- `--ds-z-dropdown`: 1000
- `--ds-z-sticky`: 1100
- `--ds-z-banner`: 1200
- `--ds-z-overlay`: 1300
- `--ds-z-modal`: 1400
- `--ds-z-popover`: 1500
- `--ds-z-tooltip`: 1700
- `--ds-z-notification`: 1800
- `--ds-z-max`: 9999

### Transitions

- `--ds-transition-fast`: 150ms
- `--ds-transition-base`: 200ms
- `--ds-transition-slow`: 300ms
- `--ds-transition-slower`: 400ms
- `--ds-transition-ease-in`: Ease-in timing
- `--ds-transition-ease-out`: Ease-out timing
- `--ds-transition-ease-in-out`: Ease-in-out timing

### Opacity

- `--ds-opacity-0`: 0
- `--ds-opacity-25`: 0.25
- `--ds-opacity-50`: 0.5
- `--ds-opacity-75`: 0.75
- `--ds-opacity-100`: 1

## Card Hover Behavior (v2.0 Change)

**Important**: Main cards no longer have hover shadows by default. This provides a cleaner, more subtle interaction.

- **`.ds-card`**: No hover effect
- **`.ds-card-hover`**: Hover changes border color and adds subtle background tint (no shadow)
- **`.ds-card-elevated`**: Use when you specifically need hover shadow effects
- **`.ds-card-interactive`**: For clickable cards with background change

## Best Practices

1. **Always use theme-aware colors**: Use `rgb(var(--v-theme-*))` instead of hard-coded colors
2. **Use design tokens**: Prefer CSS variables over hard-coded values
3. **Responsive spacing**: Use spacing scale consistently
4. **Semantic naming**: Use descriptive class names that reflect purpose
5. **Theme compatibility**: Test components in both light and dark themes
6. **Z-index management**: Use z-index scale to prevent conflicts
7. **Accessibility**: Use focus-visible utilities for keyboard navigation
8. **Card hover**: Use `ds-card-elevated` only when elevation feedback is necessary

## Component Patterns

### Card Pattern
```vue
<template>
  <!-- Standard card -->
  <div class="ds-card">
    <h3 class="ds-heading-3 ds-mb-md">Card Title</h3>
    <p class="ds-body-base">Card content</p>
  </div>

  <!-- Card with hover (border change, no shadow) -->
  <div class="ds-card ds-card-hover">
    <h3 class="ds-heading-3 ds-mb-md">Hover Card</h3>
    <p class="ds-body-base">Hover to see border color change</p>
  </div>

  <!-- Card with elevation (for special cases) -->
  <div class="ds-card ds-card-elevated">
    <h3 class="ds-heading-3 ds-mb-md">Elevated Card</h3>
    <p class="ds-body-base">Hover to see shadow effect</p>
  </div>
</template>
```

### Section Pattern
```vue
<template>
  <section class="ds-mb-xl">
    <h2 class="ds-section-title">Section Title</h2>
    <p class="ds-section-subtitle ds-mb-lg">Section description</p>
    <!-- Section content -->
  </section>
</template>
```

### Statistics Card Pattern
```vue
<template>
  <div class="ds-card">
    <div class="ds-stat-label">Total Sales</div>
    <div class="ds-stat-value">1,234</div>
    <div class="ds-caption ds-mt-xs">Last 30 days</div>
  </div>
</template>
```

### Responsive Grid
```vue
<template>
  <div class="ds-container">
    <div class="ds-grid ds-grid-cols-1 md:ds-grid-cols-2 lg:ds-grid-cols-3 ds-gap-lg">
      <!-- Grid items -->
    </div>
  </div>
</template>
```

### Animated Components
```vue
<template>
  <div class="ds-card ds-animate-fade-in">
    <!-- Content that fades in -->
  </div>
  
  <div class="ds-card ds-animate-slide-up">
    <!-- Content that slides up -->
  </div>
</template>
```

## Migration from v1.1 to v2.0

1. **Card hover shadows removed**: Main cards no longer have hover shadows
   - If you need hover shadows, use `.ds-card-elevated` class
   - Standard `.ds-card-hover` now only changes border color

2. **New utilities available**:
   - Grid system: `.ds-grid-cols-*` classes
   - Animations: `.ds-animate-*` classes
   - State utilities: `.ds-disabled`, `.ds-hidden`, `.ds-sr-only`

3. **Enhanced component tokens**:
   - Table styles in design system
   - Input focus states
   - Button interaction states

All existing tokens remain compatible.
