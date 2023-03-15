const esbuild = require('esbuild');
// @ts-ignore
const plugin = require('node-stdlib-browser/helpers/esbuild/plugin');
const stdLibBrowser = require('node-stdlib-browser');

(async () => {
	await esbuild.build({
		entryPoints: ['src/index.ts'],
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