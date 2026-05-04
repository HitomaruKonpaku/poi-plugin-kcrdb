import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

export default defineConfig([
  {
    extends: compat.extends(
      'eslint:recommended',
      'plugin:@typescript-eslint/eslint-recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:prettier/recommended',
      'prettier',
    ),

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },

      parser: tsParser,
    },

    ignores: ['dist/**'],

    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 0,
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/no-require-imports': 0,
      '@typescript-eslint/no-unused-vars': 0,
      complexity: ['error', 30],
      'max-depth': ['error', 5],
      'max-lines-per-function': ['error', 100],
      'max-nested-callbacks': ['error', 5],
      'max-params': ['error', 10],
      'max-statements': ['error', 50],
      'no-console': 0,
    },
  },
])
