/**
 * ============================================
 * Font Loading Plugin
 * إضافة Vue لإدارة تحميل الخطوط بشكل ذكي
 * ============================================
 *
 * هذا الملف يوفر:
 * 1. تحميل الخطوط بشكل تدريجي (Progressive Loading)
 * 2. كشف تحميل الخطوط باستخدام Font Loading API
 * 3. Fallback للمتصفحات القديمة
 * 4. تحسين الأداء وتجربة المستخدم
 */

import { ref, onMounted } from 'vue'; /**
 * قائمة الخطوط المطلوب تحميلها
 */
const FONTS_TO_LOAD = [
  {
    family: 'Roboto',
    weights: [300, 400, 500, 700],
    styles: ['normal', 'italic'],
    lang: 'en',
  },
  {
    family: 'Cairo',
    weights: [300, 400, 500, 600, 700, 800],
    styles: ['normal'],
    lang: 'ar',
  },
  {
    family: 'Tajawal',
    weights: [300, 400, 500, 700],
    styles: ['normal'],
    lang: 'ar',
  },
];

/**
 * تحميل خط واحد باستخدام Font Loading API
 * @param {string} family - اسم عائلة الخط
 * @param {number} weight - وزن الخط
 * @param {string} style - نمط الخط
 * @returns {Promise}
 */
const loadFont = (family, weight, style = 'normal') => {
  // التحقق من دعم Font Loading API
  if (!('fonts' in document)) {
    return Promise.resolve();
  }

  const fontString = `${style} ${weight} 1rem ${family}`;

  return document.fonts.load(fontString).catch(() => {
    return Promise.resolve(); // عدم إيقاف التطبيق في حالة الفشل
  });
};

/**
 * تحميل جميع الخطوط المطلوبة
 * @returns {Promise}
 */
const loadAllFonts = async () => {
  const loadingPromises = [];

  FONTS_TO_LOAD.forEach((font) => {
    font.weights.forEach((weight) => {
      font.styles.forEach((style) => {
        loadingPromises.push(loadFont(font.family, weight, style));
      });
    });
  });

  try {
    await Promise.all(loadingPromises);
    return true;
  } catch {
    // تجاهل أخطاء تحميل الخطوط
    return false;
  }
};

/**
 * إضافة فئات CSS لإدارة حالة تحميل الخطوط
 * @param {boolean} loaded - هل تم تحميل الخطوط
 */
const updateFontLoadingClass = (loaded) => {
  const htmlElement = document.documentElement;

  if (loaded) {
    htmlElement.classList.remove('fonts-loading');
    htmlElement.classList.add('fonts-loaded');

    // حفظ الحالة في localStorage
    try {
      localStorage.setItem('fonts-loaded', 'true');
      localStorage.setItem('fonts-loaded-timestamp', Date.now().toString());
    } catch {
      // تجاهل أخطاء localStorage
    }
  } else {
    htmlElement.classList.add('fonts-loading');
    htmlElement.classList.remove('fonts-loaded');
  }
};

/**
 * التحقق من تحميل الخطوط مسبقاً
 * @returns {boolean}
 */
const checkCachedFonts = () => {
  try {
    const cached = localStorage.getItem('fonts-loaded');
    const timestamp = localStorage.getItem('fonts-loaded-timestamp');

    if (!cached || !timestamp) {
      return false;
    }

    // إعادة تحميل الخطوط بعد 7 أيام
    const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 أيام
    const cachedTime = parseInt(timestamp, 10);
    const now = Date.now();

    return now - cachedTime < CACHE_DURATION;
  } catch {
    return false;
  }
};

/**
 * تحميل الخطوط الحرجة أولاً (Critical Fonts)
 * @returns {Promise}
 */
const loadCriticalFonts = async () => {
  const criticalFonts = [
    { family: 'Roboto', weight: 400, style: 'normal' },
    { family: 'Cairo', weight: 400, style: 'normal' },
  ];

  const promises = criticalFonts.map(({ family, weight, style }) =>
    loadFont(family, weight, style)
  );

  try {
    await Promise.all(promises);
    return true;
  } catch {
    // تجاهل أخطاء تحميل الخطوط الحرجة
    return false;
  }
};

/**
 * Composable لاستخدام حالة تحميل الخطوط
 * @returns {Object}
 */
export const useFontLoading = () => {
  const fontsLoaded = ref(false);
  const fontsLoading = ref(true);

  onMounted(() => {
    const htmlElement = document.documentElement;
    fontsLoaded.value = htmlElement.classList.contains('fonts-loaded');
    fontsLoading.value = htmlElement.classList.contains('fonts-loading');
  });

  return {
    fontsLoaded,
    fontsLoading,
  };
};

/**
 * الإضافة الرئيسية لـ Vue
 */
export default {
  install(app) {
    // تعيين حالة التحميل الأولية
    updateFontLoadingClass(false);

    // التحقق من الخطوط المحفوظة مسبقاً
    const hasCachedFonts = checkCachedFonts();

    if (hasCachedFonts) {
      // الخطوط محفوظة مسبقاً، تحديث الحالة فوراً
      updateFontLoadingClass(true);

      // تحميل الخطوط في الخلفية للتحقق
      loadAllFonts().catch(() => {
        // تجاهل الأخطاء في التحميل الخلفي
      });
    } else {
      // تحميل الخطوط الحرجة أولاً
      loadCriticalFonts()
        .then(() => {
          updateFontLoadingClass(true);

          // تحميل باقي الخطوط في الخلفية
          return loadAllFonts();
        })
        .catch(() => {
          // عرض الخطوط الاحتياطية
          updateFontLoadingClass(false);
        });
    }

    // مراقبة تحميل الخطوط باستخدام Font Loading API
    if ('fonts' in document) {
      document.fonts.ready
        .then(() => {
          updateFontLoadingClass(true);
        })
        .catch(() => {
          // تجاهل أخطاء Font Loading API
        });
    }

    // إضافة خاصية عامة للتطبيق
    app.config.globalProperties.$fontsLoaded = () => {
      return document.documentElement.classList.contains('fonts-loaded');
    };

    // توفير دالة لإعادة تحميل الخطوط
    app.config.globalProperties.$reloadFonts = async () => {
      updateFontLoadingClass(false);
      const loaded = await loadAllFonts();
      updateFontLoadingClass(loaded);
      return loaded;
    };
  },
};

/**
 * تصدير الدوال المساعدة
 */
export { loadAllFonts, loadFont, updateFontLoadingClass, checkCachedFonts };
