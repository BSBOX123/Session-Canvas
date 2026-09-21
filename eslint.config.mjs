import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  // `**/dist` 처럼 쓰면 디렉터리 자체만 무시하고 안쪽은 계속 훑는다.
  // 패키징 산출물(.app)이 들어가면 `eslint .`가 수만 개 파일을 스캔한다.
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      'build/**',
      '.dev-userdata/**',
      'coverage/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      // SPEC 0.5: TypeScript strict, `any` is forbidden.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error'
    }
  },
  {
    // Plain JS tooling scripts: the TypeScript-only rules do not apply.
    files: ['scripts/**/*.mjs', '*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
