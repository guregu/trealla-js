const path = require('path');
const esbuild = require('esbuild');
const plugin = require('node-stdlib-browser/helpers/esbuild/plugin');
const stdLibBrowser = require('node-stdlib-browser');

(async () => {
	await esbuild.build({
		entryPoints: ['src/index.js'],
		bundle: true,
		outfile: 'trealla.js',
		format: 'esm',
		loader: {'.wasm': 'binary'},
		target: ['firefox78', 'safari15'],
		minify: true,
		keepNames: true,
		sourcemap: true,
		inject: [require.resolve('node-stdlib-browser/helpers/esbuild/shim')],
		define: {
			Buffer: 'Buffer'
		},
		plugins: [plugin(stdLibBrowser)]
	});
})();