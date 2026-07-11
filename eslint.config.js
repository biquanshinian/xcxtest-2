// ESLint flat config (ESLint v9+)
// 目标：抓真 bug（未定义变量 / 重复 key / 不可达代码 / await 误用），
// 不做强制格式化（格式交给 Prettier，且不作为 CI fail 项）。
const js = require('@eslint/js')
const globals = require('globals')

// 抓 bug 为主、降噪为辅的共享规则
const sharedRules = {
  // 真错误：保持 error
  'no-undef': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-unreachable': 'error',
  'no-cond-assign': ['error', 'always'],
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-async-promise-executor': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  // await 误用相关：提示但不阻断
  'require-await': 'warn',
  'no-return-await': 'warn',
  // 容易海量但非致命：降级为 warn，CI 不因 warning 失败
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-useless-escape': 'warn',
  // 这些在本仓库属常见写法，关掉避免噪音
  'no-prototype-builtins': 'off',
  'no-control-regex': 'off'
}

module.exports = [
  // 全局忽略：依赖、构建产物、子项目（admin-web 有独立配置）、小程序内置 npm
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/miniprogram_npm/**',
      '**/*.min.js',
      'admin-web/**',
      'workers/**'
    ]
  },
  js.configs.recommended,
  // 小程序客户端（CommonJS + 小程序全局对象）
  {
    files: ['**/*.js'],
    ignores: ['cloudfunctions/**', 'test/**', 'eslint.config.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        wx: 'readonly',
        App: 'readonly',
        Page: 'readonly',
        Component: 'readonly',
        Behavior: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
        requirePlugin: 'readonly',
        __wxConfig: 'readonly',
        WeixinJSBridge: 'readonly'
      }
    },
    rules: sharedRules
  },
  // 云函数（Node.js / CommonJS）
  {
    files: ['cloudfunctions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: sharedRules
  },
  // 测试与工具脚本（Node + node:test）
  {
    files: ['test/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: sharedRules
  }
]
