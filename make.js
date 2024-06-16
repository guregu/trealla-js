import esbuild from 'esbuild';
// @ts-ignore
import plugin from 'node-stdlib-browser/helpers/esbuild/plugin';
import { dtsPlugin } from 'esbuild-plugin-d.ts';
import stdLibBrowser from 'node-stdlib-browser';

(async () => {
	const shim = typeof import.meta?.resolve !== "undefined" ?
		await import.meta.resolve('node-stdlib-browser/helpers/esbuild/shim') :
		'./node_modules/node-stdlib-browser/helpers/esbuild/shim.js';
	await esbuild.build({
		entryPoints: ['src/trealla.ts'],
		bundle: true,
		outfile: 'trealla.js',
		format: 'esm',
		loader: {'.wasm': 'binary'},
		target: ['es2021', 'safari15'],
		minify: true,
		keepNames: true,
		sourcemap: true,
		inject: [shim],
		define: {
			Buffer: 'Buffer'
		},
		plugins: [plugin(stdLibBrowser), dtsPlugin()]
	});
})();
