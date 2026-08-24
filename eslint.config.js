// ESLint — the codebase-shape contract of ADR-0004 (docs/adr/0004-codebase-shape.md), enforced.
//
// Layers:  app → pages → shared.   Inside shared:  ui → lib;  lib → (nothing);  data → lib;
//          auth → ui, lib, data;  domain → ui, lib, data, auth.   Pages never import other pages.
// Data access (the Supabase client and table repos) only from shared/data, shared/domain/*Service.js,
// shared/auth/{authService,sessionStore}.js and pages/*/*Service.js. Tests (*.test.*) may import anything.
//
// Every import uses the `@/` alias, so the rules match on the specifier itself — no resolver needed.
// ESLint does not merge a rule's options across configs, so each file group below lists its full
// pattern set. Run: `npm run lint` (also part of `npm run build`). Sizes: scripts/check-sizes.mjs.
import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import { readdirSync } from 'node:fs'

const TESTS = ['src/**/*.test.{js,mjs}']
const pages = readdirSync('src/pages', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

const rule = (group, message) => ({ group, message })
const NO_APP = rule(['@/app/**'], 'Nothing imports the app shell (ADR-0004 §1).')
const NO_PAGES = rule(['@/pages/**'], 'shared/ never imports pages/ (ADR-0004 §1) — move what both need into shared/.')
const NO_DATA_ACCESS = rule(
  ['@/shared/data/supabase', '@/shared/data/repos/**'],
  'The Supabase client and repos are used only by shared/data, shared/domain/*Service.js, shared/auth/{authService,sessionStore}.js and pages/*/*Service.js (ADR-0004 §3) — go through a service.',
)
const UI_ONLY_LIB = rule(['@/shared/domain/**', '@/shared/data/**', '@/shared/auth/**'], 'shared/ui is domain-free: it may import shared/lib only (ADR-0004 §2).')
const LIB_PURE = rule(['@/shared/ui/**', '@/shared/domain/**', '@/shared/data/**', '@/shared/auth/**'], 'shared/lib is pure: no imports from other shared layers (ADR-0004 §2).')
const DATA_VUE_FREE = rule(['vue', '@/shared/ui/**', '@/shared/domain/**', '@/shared/auth/**'], 'shared/data is Vue-free and imports only libraries and shared/lib (ADR-0004 §2).')
const AUTH_NO_DOMAIN = rule(['@/shared/domain/**'], 'shared/auth may import ui, lib and data — not domain (ADR-0004 §2).')

const boundary = (files, patterns, ignores = []) => ({
  files,
  ignores: [...TESTS, ...ignores],
  rules: { 'no-restricted-imports': ['error', { patterns }] },
})
const otherPages = (p) => rule(
  pages.filter((q) => q !== p).map((q) => `@/pages/${q}/**`),
  `pages/${p} must not import another page (ADR-0004 §1) — move the shared piece into shared/.`,
)

export default [
  { ignores: ['dist/**', 'node_modules/**', 'supabase/**', 'example-kml-exports/**', '**/*.ts'] },

  js.configs.recommended,
  ...vue.configs['flat/essential'],

  {
    files: ['src/**/*.{js,mjs,vue}', 'scripts/**/*.mjs', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Style/legacy noise is out of scope for this config — it exists for the boundaries below.
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-prototype-builtins': 'off',
      'no-cond-assign': 'off',
      'no-control-regex': 'off',
      'no-async-promise-executor': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-mutating-props': 'off',
    },
  },

  // ---- pages: no app, no other page; data access only in <name>Service.js -------
  ...pages.flatMap((p) => [
    boundary([`src/pages/${p}/**/*.{js,vue}`], [NO_APP, otherPages(p), NO_DATA_ACCESS], [`src/pages/${p}/*Service.js`]),
    boundary([`src/pages/${p}/*Service.js`], [NO_APP, otherPages(p)]),
  ]),

  // ---- shared: layer rules + data access only in services --------------------------
  boundary(['src/shared/ui/**/*.{js,vue}'], [NO_APP, NO_PAGES, UI_ONLY_LIB, NO_DATA_ACCESS]),
  boundary(['src/shared/lib/**/*.{js,vue}'], [NO_APP, NO_PAGES, LIB_PURE, NO_DATA_ACCESS]),
  boundary(['src/shared/data/**/*.{js,vue}'], [NO_APP, NO_PAGES, DATA_VUE_FREE]),
  boundary(['src/shared/auth/**/*.{js,vue}'], [NO_APP, NO_PAGES, AUTH_NO_DOMAIN, NO_DATA_ACCESS], ['src/shared/auth/authService.js', 'src/shared/auth/sessionStore.js']),
  boundary(['src/shared/auth/authService.js', 'src/shared/auth/sessionStore.js'], [NO_APP, NO_PAGES, AUTH_NO_DOMAIN]),
  boundary(['src/shared/domain/**/*.{js,vue}'], [NO_APP, NO_PAGES, NO_DATA_ACCESS], ['src/shared/domain/*Service.js']),
  boundary(['src/shared/domain/*Service.js'], [NO_APP, NO_PAGES]),
]
