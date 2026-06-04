import { ref, reactive, onScopeDispose } from 'vue';
import { isCanceledRequest } from '@/utils/requestParams';

/**
 * useServerSearch — reusable server-side search orchestration shared by the
 * products / invoices / customers list pages. It owns the search UX concerns so
 * the pages don't each reinvent them (req #6, #7, #17):
 *
 *   - 300ms debounce on typing (configurable)
 *   - cancels the previous in-flight request when a newer one starts
 *     (AbortController) so a slow response can't clobber a newer query
 *   - de-dupes: identical consecutive (query + filters + page) is a no-op
 *   - small LRU cache of recent results, re-applied without a network call
 *   - keeps previous results visible while loading (never blanks the table)
 *   - inline loading / error state (no global toast — see axios meta.silent)
 *   - Enter = search now (bypass debounce), Escape/X = clear
 *
 * The page supplies `load(params, { signal })` (usually `store.fetch`) which is
 * responsible for applying results to its store on success, and optionally
 * `apply(response)` used to re-apply a cached response to the store on a cache
 * hit. If `apply` is omitted, caching is disabled (every dispatch hits load).
 *
 * @param {Object}   opts
 * @param {Function} opts.load    (params, { signal }) => Promise<response>
 * @param {Function} [opts.apply] (response) => void   re-apply cached response
 * @param {number}   [opts.limit=10]
 * @param {number}   [opts.debounceMs=300]
 * @param {number}   [opts.cacheSize=20]
 * @param {Object}   [opts.initialFilters={}]
 */
export function useServerSearch({
  load,
  apply,
  limit = 10,
  debounceMs = 300,
  cacheSize = 20,
  initialFilters = {},
} = {}) {
  const query = ref('');
  const page = ref(1);
  const pageSize = ref(limit);
  const filters = reactive({ ...initialFilters });

  const isSearching = ref(false);
  const error = ref(null);

  const cache = new Map(); // key -> response (insertion order = LRU)
  let timer = null;
  let controller = null;
  let seq = 0; // monotonic dispatch id — only the latest may flip isSearching off
  let lastKey = null;

  const cachingEnabled = typeof apply === 'function';

  function buildParams() {
    const params = { page: page.value, limit: pageSize.value };
    const q = query.value?.trim();
    if (q) params.search = q;
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== '') params[k] = v;
    }
    return params;
  }

  const keyOf = (params) => JSON.stringify(params);

  function cachePut(key, value) {
    if (!cachingEnabled) return;
    cache.set(key, value);
    if (cache.size > cacheSize) {
      // evict oldest
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  async function run({ immediate = false, force = false } = {}) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const exec = async () => {
      const params = buildParams();
      const key = keyOf(params);
      if (!force && key === lastKey) return; // de-dupe identical consecutive
      lastKey = key;

      // Cancel any previous in-flight request.
      if (controller) controller.abort();
      controller = new AbortController();
      const myReq = ++seq;
      error.value = null;
      isSearching.value = true;

      try {
        if (cachingEnabled && cache.has(key)) {
          apply(cache.get(key));
        } else {
          const res = await load(params, { signal: controller.signal });
          cachePut(key, res);
        }
      } catch (err) {
        // A superseded request was aborted — a newer one owns the UI now.
        if (isCanceledRequest(err)) return;
        error.value = err;
      } finally {
        // Only the most recent dispatch may clear the spinner, so cancelled
        // requests don't prematurely hide loading for the live one.
        if (myReq === seq) isSearching.value = false;
      }
    };

    if (immediate) {
      await exec();
    } else {
      timer = setTimeout(exec, debounceMs);
    }
  }

  /** Called on every keystroke (debounced). Resets to page 1. */
  function onQueryChange(value) {
    if (value !== undefined) query.value = value;
    page.value = 1;
    run({ immediate: false });
  }

  /** Enter — search immediately, bypassing the debounce and the dedupe guard. */
  function runNow() {
    page.value = 1;
    run({ immediate: true, force: true });
  }

  /** Escape / clear button — empty the query and reload the default list. */
  function clear() {
    query.value = '';
    page.value = 1;
    run({ immediate: true });
  }

  /** Merge filter values; resets to page 1 (req #15). */
  function setFilters(partial = {}) {
    Object.assign(filters, partial);
    page.value = 1;
    run({ immediate: true });
  }

  /** Clear all filters (the "مسح الفلاتر" button), keeping the search query. */
  function clearFilters() {
    for (const k of Object.keys(filters)) delete filters[k];
    page.value = 1;
    run({ immediate: true });
  }

  function setPage(n) {
    const next = Number(n);
    if (!Number.isFinite(next) || next < 1 || next === page.value) return;
    page.value = next;
    run({ immediate: true });
  }

  function setPageSize(n) {
    const next = Number(n);
    if (!Number.isFinite(next) || next < 1) return;
    pageSize.value = next;
    page.value = 1;
    run({ immediate: true });
  }

  /** Force a fresh load (after create/update/delete) — busts the cache. */
  function refresh() {
    cache.clear();
    run({ immediate: true, force: true });
  }

  /** Count of active (non-empty) filters — for the active-filters badge. */
  function activeFilterCount() {
    return Object.values(filters).filter((v) => v !== undefined && v !== null && v !== '').length;
  }

  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
    if (controller) controller.abort();
  });

  return {
    query,
    page,
    pageSize,
    filters,
    isSearching,
    error,
    onQueryChange,
    runNow,
    clear,
    setFilters,
    clearFilters,
    setPage,
    setPageSize,
    refresh,
    activeFilterCount,
    buildParams,
  };
}

export default useServerSearch;
