import { init, WASI } from '@wasmer/wasi';

let tpl = null;

/** Load the given Trealla binary and set it as the default module. */
export async function load(module) {
	await init();
	tpl = module;
}

/** Load the Trealla binary of the given version from WAPM and set it as the default module. */
export async function loadFromWAPM(version) {
	await load(await WebAssembly.compileStreaming(
		fetch(`https://registry-cdn.wapm.io/contents/guregu/trealla/${version}/tpl.wasm`)));
}

/** Prolog interpreter instance. */
export class Prolog {
	wasi;
	instance;
	n = 0;
	module;

	constructor() {
		this.wasi = newWASI();
	}

	/** Instantiate this interpreter, optional unless a default hasn't been set with load or loadFromWAPM.
	    Automatically called by query if necessary. */
	async init(module = tpl) {
		if (!module) {
			throw new Error("trealla: uninitialized, call load first");
		}
		this.module = module;
		const imports = this.wasi.getImports(module);
		this.instance = await WebAssembly.instantiate(module, imports);
	}

	/** Run a query. Optionally, provide Prolog program text to consult before the query is executed. */
	// FIXME: currently query instantiates a fresh instance each time
	async query(goal, script) {
		const id = ++this.n;
		if (!this.instance) {
			await this.init(this.module);
		}
		let stdin = goal + "\n";
		let filename = null;
		if (script) {
			filename = `/tmp/${id}.pl`;
			const file = this.fs.open(filename, { read: true, write: true, create: true });
			file.writeString(script);
			stdin = `consult('${filename}'),${stdin}`;
		}
		this.wasi.setStdinString(stdin);

		const _exit = this.wasi.start(this.instance);
		// TODO: throw if _exit != 0?

		if (filename) {
			this.fs.removeFile(filename);
		}
		const stdout = this.wasi.getStdoutBuffer();
		return parseOutput(stdout);
	}

	/** wasmer-js virtual filesystem.
		Unique per interpreter, Prolog can read and write from it.
		See: https://github.com/wasmerio/wasmer-js */
	get fs() {
		return this.wasi.fs;
	}
}

function parseOutput(stdout) {
	const dec = new TextDecoder();
	const start = stdout.indexOf(2); // ASCII START OF TEXT
	const end = stdout.indexOf(3);   // ASCII END OF TEXT
	if (start === -1 || end === -1 || start > end) {
		throw new Error("trealla: unexpected output: " + dec.decode(stdout));
	}
	let butt = stdout.indexOf(2, end+1);
	if (butt === -1) {
		butt = stdout.length;
	}

	const msg = JSON.parse(dec.decode(stdout.slice(end + 1, butt)));
	msg.output = dec.decode(stdout.slice(start + 1, end));
	return msg;
}

function newWASI() {
	const wasi = new WASI({
		args: ["tpl", "--ns", "-q", "-g", "use_module(library(js_toplevel)), js_toplevel"]
	});
	wasi.fs.createDir("/tmp");
	return wasi;
}
