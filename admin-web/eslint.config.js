// admin-web ESLint flat config (ESLint v9+, Vue 3)
// 抓真 bug 为主：未定义变量、未使用变量、Vue 模板常见错误。
// 不做强制格式化（Prettier 单独负责，非 CI 阻断项）。
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  {
    ignores: ['dist/**', 'node_modules/**']
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser
      }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // 组件名多为单文件页面，关闭多词命名强制
      'vue/multi-word-component-names': 'off',
      // 格式类规则全部降级/关闭，避免海量噪音
      'vue/html-indent': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/attributes-order': 'warn',
      'vue/require-default-prop': 'off'
    }
  }
]
