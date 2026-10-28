import { FlatCompat } from '@eslint/eslintrc'
import drizzle from 'eslint-plugin-drizzle'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const baseDirectory = dirname(fileURLToPath(import.meta.url))
const compat = new FlatCompat({ baseDirectory })

export default [
  { ignores: ['.next/**', 'node_modules/**', '.local/**', '.impeccable/**', 'playwright-report/**', 'test-results/**'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    plugins: { drizzle },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'drizzle/enforce-delete-with-where': ['error', { drizzleObjectName: ['db', 'ctx.db'] }],
      'drizzle/enforce-update-with-where': ['error', { drizzleObjectName: ['db', 'ctx.db'] }],
    },
  },
]
