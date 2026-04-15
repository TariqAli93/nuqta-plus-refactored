import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { fileURLToPath, URL } from 'node:url';
import electron from 'vite-plugin-electron/simple';
import VueDevTools from 'vite-plugin-vue-devtools';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

/** Recursively copy a directory (src → dest). */
function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

const isDev = process.env.NODE_ENV !== 'production';
// Directory containing this config (frontend/). Do NOT use dirname(URL('.', import.meta.url)) — that resolves to repo root and breaks electron/licenseSystem paths.
const __root = dirname(fileURLToPath(import.meta.url));

// NEW: target switch
// IMPORTANT: Set VITE_TARGET=electron when building for Electron (e.g., in build:win script)
const target = process.env.VITE_TARGET || 'web';
const isElectronTarget = target === 'electron';

// Plugin to copy static assets with fixed names
const copyStaticAssets = () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  return {
    name: 'copy-static-assets',
    // Copy licenseSystem next to the main-process bundle so that
    // createRequire('../licenseSystem/...') resolves correctly at runtime.
    // Runs in both dev and production whenever the electron main is built.
    buildStart() {
      if (isElectronTarget) {
        const srcLicense = join(__dirname, 'electron', 'licenseSystem');
        const destLicense = join(__dirname, 'dist-electron', 'licenseSystem');
        try {
          copyDirSync(srcLicense, destLicense);
        } catch (err) {
          console.warn('Failed to copy licenseSystem:', err.message);
        }
      }
    },
    writeBundle() {
      // Copy only for electron production build
      if (!isDev && isElectronTarget) {
        const outDir = join(__dirname, 'dist-electron', 'dist');
        const buildIcon = join(__dirname, 'build', 'icon.png');
        const srcSplash = join(__dirname, 'src', 'assets', 'splash-mockup.png');
        const outAssetsDir = join(outDir, 'assets');

        try {
          if (existsSync(buildIcon)) {
            copyFileSync(buildIcon, join(outDir, 'icon.png'));
          }
          if (existsSync(srcSplash) && existsSync(outAssetsDir)) {
            copyFileSync(srcSplash, join(outAssetsDir, 'splash-mockup.png'));
          }
        } catch (err) {
          console.warn('Failed to copy static assets:', err.message);
        }
      }
    },
  };
};

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),

    ...(isDev ? [VueDevTools()] : []),

    // Copy assets only when building electron target
    ...(isElectronTarget ? [copyStaticAssets()] : []),

    // IMPORTANT: Electron plugin only for electron target
    ...(isElectronTarget
      ? [
          electron({
            main: {
              entry: 'electron/main/main.js',
              vite: {
                plugins: [
                  // Copy licenseSystem into dist-electron/licenseSystem/ so that
                  // createRequire('../licenseSystem/...') in the bundled main.js
                  // resolves to the correct directory at runtime.
                  {
                    name: 'copy-license-system',
                    buildStart() {
                      const src = join(__root, 'electron', 'licenseSystem');
                      const dest = join(__root, 'dist-electron', 'licenseSystem');
                      try {
                        copyDirSync(src, dest);
                      } catch (e) {
                        console.warn('copy-license-system:', e.message);
                      }
                    },
                  },
                ],
                build: {
                  outDir: 'dist-electron/main',
                  minify: true,
                  sourcemap: false,
                  rollupOptions: {
                    external: ['electron'],
                  },
                },
              },
            },
            preload: {
              input: 'electron/preload/preload.mjs',
              vite: {
                build: {
                  outDir: 'dist-electron/preload',
                  rollupOptions: {
                    external: ['electron'],
                  },
                },
              },
            },
          }),
        ]
      : []),
  ],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    // Web builds to dist, Electron builds to dist-electron/dist
    outDir: isElectronTarget ? 'dist-electron/dist' : 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        splash: 'splash.html',
      },
    },
  },

  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },

  define: {
    'process.env.EDITOR': JSON.stringify('cursor'),
  },

  // IMPORTANT: base must be '/' for web dev, './' for electron packaging
  base: isElectronTarget ? './' : '/',
});
