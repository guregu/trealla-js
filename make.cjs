const esbuild = require('esbuild');

(async () => {
	await esbuild.build({
		entryPoints: ['src/trealla.ts'],
		bundle: true,
		outdir: 'dist',
		format: 'esm',
		loader: {'.wasm': 'binary'},
		target: ['es2022'],
		minify: false,
		keepNames: true,
		sourcemap: false,
		plugins: []
	});
})();

(async () => {
	await esbuild.build({
		entryPoints: ['src/trealla.ts'],
		bundle: true,
		outdir: 'dist-unbundled',
		format: 'esm',
		loader: {'.wasm': 'copy'},
		target: ['es2022'],
		minify: false,
		keepNames: true,
		sourcemap: false,
		plugins: []
	});
})();
