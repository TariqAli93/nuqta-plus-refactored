import { onMounted, onUnmounted } from 'vue';

/**
 * Composable for handling keyboard shortcuts
 * @param {Object} shortcuts - Object mapping key combinations to handlers
 * @param {Boolean} enabled - Whether shortcuts are enabled
 */
export function useKeyboardShortcuts(shortcuts = {}, enabled = true) {
  const defaultShortcuts = {
    'ctrl+k': (e) => {
      e.preventDefault();
      // Will be handled by QuickSearch component
      window.dispatchEvent(new CustomEvent('open-quick-search'));
    },
    escape: (_e) => {
      // Close modals/dialogs
      const dialogs = document.querySelectorAll('.v-dialog--active');
      if (dialogs.length > 0) {
        const lastDialog = dialogs[dialogs.length - 1];
        const closeBtn = lastDialog.querySelector('[aria-label*="إغلاق"], [aria-label*="close"]');
        if (closeBtn) closeBtn.click();
      }
    },
  };

  const allShortcuts = { ...defaultShortcuts, ...shortcuts };

  const normalizeKey = (key) => {
    return key.toLowerCase().replace(/\s+/g, '').replace('command', 'ctrl').replace('cmd', 'ctrl');
  };

  // Helper to get key code from event (works with any keyboard layout)
  const getKeyFromEvent = (event) => {
    // Use event.code for physical key position (works with any language)
    // Fallback to event.key for special keys like Escape
    if (event.code) {
      // Convert KeyboardEvent.code to simple key name
      // e.g., "KeyK" -> "k", "Digit1" -> "1", "Escape" -> "escape"
      const code = event.code;
      if (code.startsWith('Key')) {
        return code.replace('Key', '').toLowerCase();
      }
      if (code.startsWith('Digit')) {
        return code.replace('Digit', '');
      }
      if (code.startsWith('Numpad')) {
        return code.replace('Numpad', 'numpad').toLowerCase();
      }
      // Special keys
      const specialKeys = {
        Escape: 'escape',
        Enter: 'enter',
        Space: 'space',
        Tab: 'tab',
        Backspace: 'backspace',
        Delete: 'delete',
        ArrowUp: 'arrowup',
        ArrowDown: 'arrowdown',
        ArrowLeft: 'arrowleft',
        ArrowRight: 'arrowright',
        Home: 'home',
        End: 'end',
        PageUp: 'pageup',
        PageDown: 'pagedown',
      };
      if (specialKeys[code]) {
        return specialKeys[code];
      }
      return code.toLowerCase();
    }
    // Fallback to event.key for older browsers
    return event.key.toLowerCase();
  };

  const handleKeyDown = (event) => {
    if (!enabled) return;

    // Don't trigger shortcuts when typing in inputs
    // const target = event.target;
    // if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
    //   // Allow Escape and Ctrl+K even in inputs
    //   const key = getKeyFromEvent(event);
    //   if (key !== 'escape' && !(event.ctrlKey && key === 'k')) {
    //     return;
    //   }
    // }

    const modifiers = [];
    if (event.ctrlKey || event.metaKey) modifiers.push('ctrl');
    if (event.shiftKey) modifiers.push('shift');
    if (event.altKey) modifiers.push('alt');

    const key = getKeyFromEvent(event);
    const keyCombo = modifiers.length ? `${modifiers.join('+')}+${key}` : key;

    const normalizedCombo = normalizeKey(keyCombo);

    // Find matching shortcut
    for (const [shortcut, handler] of Object.entries(allShortcuts)) {
      if (normalizeKey(shortcut) === normalizedCombo) {
        event.preventDefault();
        handler(event);
        return;
      }
    }
  };

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  return {
    handleKeyDown,
  };
}

/**
 * Helper to create page-specific shortcuts
 */
export function createPageShortcuts(config) {
  const shortcuts = {};

  if (config.create) {
    shortcuts['ctrl+n'] = (e) => {
      e.preventDefault();
      config.create();
    };
  }

  if (config.save) {
    shortcuts['ctrl+s'] = (e) => {
      e.preventDefault();
      config.save();
    };
  }

  if (config.cancel) {
    shortcuts['escape'] = (_e) => {
      if (!document.querySelector('.v-dialog--active')) {
        config.cancel();
      }
    };
  }

  return shortcuts;
}
