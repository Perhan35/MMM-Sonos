import js from '@eslint/js';

const shared = {
	console: 'readonly',
	setTimeout: 'readonly',
	clearTimeout: 'readonly',
	setInterval: 'readonly'
};

export default [
	js.configs.recommended,
	{
		files: ['MMM-Sonos.js'],
		languageOptions: {
			sourceType: 'script',
			globals: { ...shared, Module: 'readonly', Log: 'readonly', document: 'readonly' }
		}
	},
	{
		files: ['node_helper.js', 'test/**/*.js'],
		languageOptions: {
			sourceType: 'commonjs',
			globals: { ...shared, require: 'readonly', module: 'writable', fetch: 'readonly', AbortSignal: 'readonly', URL: 'readonly', Buffer: 'readonly', __dirname: 'readonly' }
		}
	},
	{
		rules: {
			indent: ['error', 'tab', { SwitchCase: 1 }],
			quotes: ['error', 'single', { avoidEscape: true }],
			semi: ['error', 'always'],
			'prefer-const': 'error',
			'no-var': 'error'
		}
	}
];
