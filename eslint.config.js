import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'artifacts/**', '.playwright-mcp/**', '.capture/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='require']", message: 'ESM only: use import instead of require().' },
        { selector: "MemberExpression[object.name='module'][property.name='exports']", message: 'ESM only: use export instead of module.exports.' },
      ],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'test', property: 'only', message: 'Do not commit test.only.' },
        { object: 'page', property: 'waitForTimeout', message: 'Use web-first assertions instead of hard waits.' },
      ],
    },
  },
  {
    // Specs keep locators in Page Objects so they remain healable.
    files: ['tests/specs/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='expect'] > CallExpression[callee.object.name='page'][callee.property.name=/^(locator|getBy)/]",
          message: 'Define locators in a Page Object; inline page locators inside expect() cannot be healed.',
        },
      ],
    },
  },
];
