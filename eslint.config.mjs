import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * Flat config. eslint-config-next 16 ships native flat configs, so no
 * FlatCompat shim is needed.
 */
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'contracts/out/**',
      'scripts/**',
      'next-env.d.ts',
    ],
  },
  {
    rules: {
      // Wire payloads and third-party browser globals are legitimately untyped
      // at the boundary; they are narrowed immediately after.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // The rules below assume the React Compiler, which this project does not
      // use. They flag two patterns that are correct and deliberate here:
      //   * fetching room state on mount and on an interval — the documented
      //     "synchronise with an external system" case;
      //   * reading the wall clock during render in `useCountdown`, which is
      //     what a live timer is.
      // Kept as warnings so genuinely accidental cases still surface in review.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  {
    // Tests exercise server modules directly and need dynamic re-imports.
    files: ['tests/**/*.ts'],
    rules: { '@next/next/no-assign-module-variable': 'off' },
  },
];

export default config;
