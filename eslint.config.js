import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.output*', '.wxt', 'extension', 'node_modules', 'test-results'] },
  ...tseslint.configs.recommended,
);
