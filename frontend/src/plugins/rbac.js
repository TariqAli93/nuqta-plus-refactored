import { useAuthStore } from '@/stores/auth';

function normalizePermissions(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function applyState(el, allowed, modifiers) {
  const hide = modifiers?.hide === true;
  if (hide) {
    el.style.display = allowed ? '' : 'none';
    return;
  }
  // Disable interaction and give visual cue
  if ('disabled' in el) {
    el.disabled = !allowed;
  }
  el.style.pointerEvents = allowed ? '' : 'none';
  el.style.opacity = allowed ? '' : '0.5';
  el.style.cursor = allowed ? '' : 'not-allowed';
}

function evaluate(store, required, mode = 'some') {
  const list = normalizePermissions(required);
  // Filter out invalid permissions before evaluation
  const validList = list.filter((p) => p && typeof p === 'string');
  if (validList.length === 0) return false;

  if (mode === 'every') return store.hasAllPermissions(validList);
  return store.hasPermission(validList);
}

function setupDirective(el, binding, vnode, mode) {
  const store = useAuthStore();
  const update = () => {
    const allowed = evaluate(store, binding.value, mode);
    applyState(el, allowed, binding.modifiers || {});
  };

  // Initial
  update();

  // React to auth store changes dynamically
  const unsubscribe = store.$subscribe(() => update());

  // Cleanup on unmount
  el.__rbac_cleanup__ = unsubscribe;
}

export default {
  install(app) {
    app.directive('can', {
      mounted(el, binding, vnode) {
        setupDirective(el, binding, vnode, 'some');
      },
      updated(el, binding, vnode) {
        setupDirective(el, binding, vnode, 'some');
      },
      unmounted(el) {
        if (el.__rbac_cleanup__) el.__rbac_cleanup__();
      },
    });

    app.directive('canAll', {
      mounted(el, binding, vnode) {
        setupDirective(el, binding, vnode, 'every');
      },
      updated(el, binding, vnode) {
        setupDirective(el, binding, vnode, 'every');
      },
      unmounted(el) {
        if (el.__rbac_cleanup__) el.__rbac_cleanup__();
      },
    });

    // Global helper: this.$can('create:sales') or this.$can(['read:products'])
    app.config.globalProperties.$can = (perm) => {
      const store = useAuthStore();
      return store.hasPermission(perm);
    };
  },
};
