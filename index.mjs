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
	ptr; // pointer to *prolog instance
	_toplevel; // toplevel goal CString

	/**	Create a new Prolog interpreter instance.
	 *	Make sure to load the Trealla module first with load or loadFromWAPM.  */
	constructor(options = {}) {
		let { library, module } = options;
		if (!module) {
			module = tpl;
		}
		this.wasi = newWASI(library);
		this.module = module;
	}

	/**	Instantiate this interpreter. Automatically called by other methods if necessary. */
	async init() {
		if (!this.module) {
			throw new Error("trealla: uninitialized; call load first");
		}
		
		const imports = this.wasi.getImports(this.module);
		this.instance = await WebAssembly.instantiate(this.module, imports);

		// run it once it initialize the global interpreter
		const exit = this.wasi.start(this.instance);
		if (exit !== 0) {
			throw new Error("trealla: could not initialize interpreter");
		}
		const pl_global = this.instance.exports.pl_global;
		this.ptr = pl_global();

		this._toplevel = new CString(this.instance, "js_toplevel");
	}

	/** Run a query. Optionally, provide Prolog program text to consult before the query is executed. */
	async query(goal, script) {
		if (!this.instance) {
			await this.init();
		}

		const id = ++this.n;
		let stdin = goal + "\n";
		let filename = null;
		if (script) {
			filename = `/tmp/${id}.pl`;
			const file = this.fs.open(filename, { write: true, create: true });
			file.writeString(script);
			stdin = `consult('${filename}'),${stdin}`;
		}
		this.wasi.setStdinString(stdin);

		const pl_eval = this.instance.exports.pl_eval;
		pl_eval(this.ptr, this._toplevel.ptr);

		if (filename) {
			this.fs.removeFile(filename);
		}

		const stdout = this.wasi.getStdoutBuffer();
		return parseOutput(stdout);
	}

	/** Consult (load) a Prolog file with the given filename.
	 *	Use fs to manipulate the filesystem. */
	async consult(filename) {
		if (!this.instance) {
			await this.init(this.module);
		}

		if (filename === "user") {
			throw new Error("trealla: consulting from 'user' unsupported");
		}

		const pl_consult = this.instance.exports.pl_consult;
		const str = new CString(this.instance, filename);
		let ret = 0;
		try {
			ret = pl_consult(this.ptr, str.ptr);
		} finally {
			str.free();
		}
		if (ret === 0) {
			throw new Error(`trealla: failed to consult file: ${filename}`);
		}
	}

	/**	wasmer-js virtual filesystem.
	 *	Unique per interpreter, Prolog can read and write from it.
	 *	See: https://github.com/wasmerio/wasmer-js */
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

function newWASI(library) {
	const args = ["tpl", "--ns", "-q", "-g", "halt"];
	if (library) {
		args.push("--library", library);
	}

	const wasi = new WASI({
		args: args
	});
	wasi.fs.createDir("/tmp");
	return wasi;
}

class CString {
	instance;
	ptr;
	size;

	constructor(instance, text) {
		this.instance = instance;
		const realloc = instance.exports.canonical_abi_realloc;
		const memset = instance.exports.memset;

		const buf = new TextEncoder().encode(text);
		this.size = buf.byteLength + 1;
		const ptr = realloc(0, 0, 0, this.size);
		this.ptr = ptr;
		if (ptr === 0) {
			throw new Error("could not allocate cstring: " + text);
		}

		try {
			// TODO: there must be a better way than this...
			for (let i = 0; i < buf.byteLength; i++) {
				memset(ptr + i, buf[i], 1);
			}
			memset(ptr + buf.byteLength, 0, 1);
		} catch (err) {
			this.free();
			throw err;
		}
	}

	free() {
		if (this.ptr === 0) {
			return;
		}
		const free = this.instance.exports.canonical_abi_free;
		free(this.ptr, this.size, 0);
		this.ptr = 0;
		this.size = 0;
	}
}
