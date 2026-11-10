import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const PURE_LAYER =
  'domain/ y narrative/ son puros: sin reloj del sistema, sin azar, sin navegador y sin otras capas. Recibe un reloj o un generador inyectado.'

const SCREENS =
  'Las pantallas no tocan la base de datos: importan desde «@/data» (hooks y operaciones), nunca Dexie ni archivos internos de data/.'

export default defineConfig([
  globalIgnores(['dist', 'dev-dist', 'coverage', 'playwright-report', 'test-results', 'capturas']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },

  {
    files: ['*.config.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // The interface never calculates money, and the domain never touches the outside world.
  {
    files: ['src/domain/**/*.ts', 'src/narrative/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: PURE_LAYER },
        { name: 'window', message: PURE_LAYER },
        { name: 'document', message: PURE_LAYER },
        { name: 'navigator', message: PURE_LAYER },
        { name: 'localStorage', message: PURE_LAYER },
        { name: 'indexedDB', message: PURE_LAYER },
        { name: 'crypto', message: PURE_LAYER },
        { name: 'fetch', message: PURE_LAYER },
        { name: 'performance', message: PURE_LAYER },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: PURE_LAYER },
        { object: 'Number', property: 'parseFloat', message: 'El dinero es entero: nunca decimales.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: PURE_LAYER },
            { name: 'react-dom', message: PURE_LAYER },
            { name: 'dexie', message: PURE_LAYER },
            { name: 'dexie-react-hooks', message: PURE_LAYER },
          ],
          patterns: [
            {
              group: ['**/data/**', '**/features/**', '**/ui/**', '**/app/**', '@/data/**', '@/features/**', '@/ui/**', '@/app/**'],
              message: PURE_LAYER,
            },
          ],
        },
      ],
    },
  },

  // The screens read and write through `@/data` and nothing deeper (ADR 0003): the database
  // behind it must be replaceable without touching a single screen.
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'dexie', message: SCREENS },
            { name: 'dexie-react-hooks', message: SCREENS },
            { name: 'fake-indexeddb', message: SCREENS },
          ],
          patterns: [{ group: ['@/data/*', '**/data/*', '**/data/**/*'], message: SCREENS }],
        },
      ],
    },
  },

  // The data layer serves the screens; it never depends on them.
  {
    files: ['src/data/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/**', '**/ui/**', '**/app/**', '@/features/**', '@/ui/**', '@/app/**'],
              message: 'data/ no depende de las pantallas: solo de domain/.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
])
