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
	}

	/** Run a query. Optionally, provide Prolog program text to consult before the query is executed. */
	async* query(goal, script) {
		if (!this.instance) {
			await this.init();
		}

		const id = ++this.n;

		const stdin = goal + "\n";
		this.wasi.setStdinString(stdin);

		let filename = null;
		if (script) {
			filename = `/tmp/${id}.pl`;
			const file = this.fs.open(filename, { write: true, create: true });
			file.writeString(script);
			await this.consult(filename);
		}

		const realloc = this.instance.exports.canonical_abi_realloc;
		const free = this.instance.exports.canonical_abi_free;
		const pl_query = this.instance.exports.pl_query;
		const pl_redo = this.instance.exports.pl_redo;
		const pl_done = this.instance.exports.pl_redo;

		const goalstr = new CString(this.instance, escapeQuery(goal));
		const subq_size = 4; // sizeof(*void)
		const subq_ptr = realloc(0, 0, 0, subq_size); // pl_sub_query *subq;
		let subquery = 0;
		let alive = false;
		try {
			pl_query(this.ptr, goalstr.ptr, subq_ptr);
			subquery = indirect(this.instance, subq_ptr);
			do {
				const stdout = this.wasi.getStdoutBuffer();
				if (stdout.byteLength == 0) {
					// "; false."
					return;
				}
				yield parseOutput(stdout);
			} while(alive = pl_redo(subquery) === 1)
		} finally {
			if (alive && subquery !== 0) {
				pl_done(subquery);
			}
			if (filename) {
				this.fs.removeFile(filename);
			}
			goalstr.free();
			free(subq_ptr, subq_size, 1);
		}
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
	let start = stdout.indexOf(2); // ASCII START OF TEXT
	const end = stdout.indexOf(3); // ASCII END OF TEXT
	if (start > end) {
		start = -1;
	}
	const nl = stdout.indexOf(10, end+1); // LINE FEED
	const butt = nl >= 0 ? nl : stdout.length;
	const json = dec.decode(stdout.slice(end + 1, butt));
	const msg = JSON.parse(json);
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

		const buf = new TextEncoder().encode(text);
		this.size = buf.byteLength + 1;

		const ptr = realloc(0, 0, 0, this.size);
		this.ptr = ptr;
		if (ptr === 0) {
			throw new Error("could not allocate cstring: " + text);
		}

		try {
			const mem = new Uint8Array(instance.exports.memory.buffer, this.ptr, this.size);
			mem.set(buf);
			mem[buf.byteLength] = 0;
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
		free(this.ptr, this.size, 1);
		this.ptr = 0;
		this.size = 0;
	}
}

function indirect(instance, addr) {
	if (addr === 0) return 0;
	return (new Int32Array(instance.exports.memory.buffer))[addr / 4];
}

function escapeQuery(query) {
	query = query.replaceAll("\\", "\\\\");
	query = query.replaceAll(`"`, `\\"`);
	return `js_ask("${query}")`;
}