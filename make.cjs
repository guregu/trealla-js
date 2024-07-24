const esbuild = require('esbuild');
const { dtsPlugin } = require('esbuild-plugin-d.ts');

(async () => {
	await esbuild.build({
		entryPoints: ['src/trealla.ts'],
		bundle: true,
		outfile: 'trealla.js',
		format: 'esm',
		loader: {'.wasm': 'binary'},
		target: ['es2022'],
		minify: false,
		keepNames: true,
		sourcemap: false,
		plugins: [dtsPlugin()]
	});
})();
