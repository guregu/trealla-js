import { init as initWasmer, WASI } from '@wasmer/wasi';
import tpl_wasm from './libtpl.wasm';

let tpl = undefined; // default Trealla module

let initRuntime = false;
async function initInternal() {
	await initWasmer();
	tpl = await WebAssembly.compile(tpl_wasm);
	initRuntime = true;
}

/** Load the given Trealla binary and set it as the default module. */
export async function load() {
	if (!initRuntime) await initInternal();
}

/** Prolog interpreter instance. */
export class Prolog {
	wasi;
	instance;
	ptr; // pointer to *prolog instance
	n = 0;
	scratch = 0;
	finalizers;
	yielding = {};

	/**	Create a new Prolog interpreter instance. */
	constructor(options = {}) {
		let {
			library,
			env
		} = options;
		this.wasi = newWASI(library, env);
		if ("FinalizationRegistry" in globalThis) {
			this.finalizers = new FinalizationRegistry((task) => {
				if (task.alive) {
					task.alive = false;
					this.instance.exports.pl_done(task.subquery);
				}
			})
		}
	}

	/**	Instantiate this interpreter. Automatically called by other methods if necessary. */
	async init() {
		if (!initRuntime) await initInternal();

		const imports = this.wasi.getImports(tpl);
		imports.trealla = {
			"host-call": this._host_call.bind(this),
			"host-resume": this._host_resume.bind(this)
		};
		this.instance = await WebAssembly.instantiate(tpl, imports);

		// run it once it initialize the global interpreter
		const exit = this.wasi.start(this.instance);
		if (exit !== 0) {
			throw new Error("trealla: could not initialize interpreter");
		}
		const pl_global = this.instance.exports.pl_global;
		this.ptr = pl_global();
	}

	/** Run a query. This is an asynchronous generator function.
	 *  Use a `for await` loop to easily iterate through results.
	 *  Call the return() method of the generator to kill it early. */
	async* query(goal, options = {}) {
		if (!this.instance) await this.init()
		const { 
			program, 			// Prolog text to consult before running query
			format = "json", 	// Format (toplevel) selector
			encode				// Options passed to toplevel
		} = options;

		goal = goal.replaceAll("\n", " ");

		const toplevel =
			typeof format === "string" ? FORMATS[format] : format;
		if (!toplevel) {
			throw new Error(`trealla: unknown format: ${format}`);
		}

		const _id = ++this.n;
		const token = {};
		const task = {
			subquery: 0,
			alive: false
		};

		if (program) {
			await this.consultText(program);
		}

		const realloc = this.instance.exports.canonical_abi_realloc;
		const free = this.instance.exports.canonical_abi_free;
		const pl_query = this.instance.exports.pl_query;
		const pl_redo = this.instance.exports.pl_redo;
		const pl_done = this.instance.exports.pl_done;
		const get_status = this.instance.exports.get_status;
		const query_did_yield = this.instance.exports.query_did_yield;

		const goalstr = new CString(this.instance, toplevel.query(this, goal, encode));
		const subq_size = 4; // sizeof(void*)
		const subq_ptr = realloc(0, 0, 1, subq_size); // pl_sub_query**
		let finalizing = false;

		try {
			pl_query(this.ptr, goalstr.ptr, subq_ptr);
			goalstr.free();
			task.subquery = indirect(this.instance, subq_ptr); // pl_sub_query*
			free(subq_ptr, subq_size, 1);
			do {
				if (this.finalizers && task.alive && !finalizing) {
					this.finalizers.register(token, task);
					finalizing = true;
				}
				const stdout = this.wasi.getStdoutBuffer();
				const status = get_status(this.ptr) === 1;
				if (stdout.byteLength === 0) {
					const truth = toplevel.truth(this, status, encode);
					if (truth === null) return;
					yield truth;
				} else {
					// if the guest yielded, run the yielded promise and redo
					// upon redo, the guest can call '$host_continue'/1 to grab the promise's return value
					if (query_did_yield(task.subquery)) {
						const thunk = this.yielding[task.subquery];
						if (!thunk || !thunk.promise) {
							console.warn("trealla: query yielded but no promise found", task, thunk);
							thunk.done = true;
							continue;
						}
						try {
							thunk.value = await thunk.promise;
						} catch (err) {
							// TODO: better format for this
							thunk.value = {error: `${err}`};
						}
						thunk.done = true;
						continue;
					}

					// otherwise, pass to toplevel
					yield toplevel.parse(this, status, stdout, encode);
				}
			} while(task.alive = pl_redo(task.subquery) === 1)
		} finally {
			if (finalizing) {
				this.finalizers.unregister(token);
			}
			if (task.alive && task.subquery !== 0) {
				task.alive = false;
				pl_done(task.subquery);
			}
		}
	}

	/** Runs a query and returns a single solution, ignoring others. */
	async queryOnce(goal, options) {
		const q = this.query(goal, options);
		try {
			return (await q.next()).value;
		} finally {
			q.return();
		}
	}

	/** Consult (load) a Prolog file with the given filename.
	 *	Use fs to manipulate the filesystem. */
	async consult(filename) {
		if (!this.instance) await this.init()

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

	/** Consult (load) Prolog text.
	 *  Takes a string or Uint8Array. */
	async consultText(code) {
		if (!this.instance) {
			await this.init();
		}
		const filename = await this.writeScratchFile(code);
		await this.consult(filename);
		this.fs.removeFile(filename);
	}

	async writeScratchFile(code) {
		const id = ++this.scratch;
		const filename = `/tmp/scratch${id}.pl`;
		const file = this.fs.open(filename, { write: true, create: true });

		if (typeof code === "string") {
			file.writeString(code);
		} else if (code instanceof Uint8Array) {
			file.write(code)
		} else {
			throw new Error("trealla: invalid parameter for consulting: " + code);
		}

		return filename;
	}

	/**	wasmer-js virtual filesystem.
	 *	Unique per interpreter, Prolog can read and write from it.
	 *	See: https://github.com/wasmerio/wasmer-js */
	get fs() {
		return this.wasi.fs;
	}

	_host_call(subquery, ptr, msgsize, replyptrptr, replysizeptr) {
		const expr = readString(this.instance, ptr, msgsize);
		let result;
		try {
			const fn = new Function(expr);
			const x = fn();
			if (x instanceof Promise) {
				this.yielding[subquery] = {promise: x, done: false};
				return WASM_HOST_CALL_YIELD;
			}
			result = replyMsg(x);
		} catch(error) {
			console.error(error);
			result = JSON.stringify({error: `${error}`});
		}
		const reply = new CString(this.instance, result);
		writeInt32(this.instance, replysizeptr, reply.size-1);
		writeInt32(this.instance, replyptrptr, reply.ptr);
		return WASM_HOST_CALL_OK;
	}

	_host_resume(subquery, replyptrptr, replysizeptr) {
		const task = this.yielding[subquery];
		if (!task) {
			return WASM_HOST_CALL_ERROR;
		}
		if (!task.done) {
			throw new Error("trealla: async task didn't complete: " + task);
		}
		let result;
		try {
			const x = task.value;
			result = replyMsg(x);
		} catch(error) {
			console.error(error);
			result = JSON.stringify({error: `${error}`});
		}
		const reply = new CString(this.instance, result);
		writeInt32(this.instance, replysizeptr, reply.size-1);
		writeInt32(this.instance, replyptrptr, reply.ptr);
		return WASM_HOST_CALL_OK;
	}
}

const WASM_HOST_CALL_ERROR = 0;
const WASM_HOST_CALL_OK    = 1;
const WASM_HOST_CALL_YIELD = 2;

function replyMsg(x) {
	if (x instanceof Uint8Array) {
		return new TextDecoder().decode(x);
	}
	return typeof x !== "undefined" ? JSON.stringify(x) : "null";
}

export const FORMATS = {
	json: {
		query: function(_, query) {
			return `js_ask("${escapeString(query)}")`;
		},
		parse: parseOutput,
		truth: function() { return null; }
	},
	prolog: {
		query: function(_, query) { return query },
		parse: function(_, _status, stdout, opts) {
			const dec = new TextDecoder();
			if (opts?.dot === false && stdout[stdout.length-1] === 46) // '.'
				return dec.decode(stdout.subarray(0, stdout.length-1));
			return dec.decode(stdout);
		},
		truth: function(_, status, opts) {
			return (status ? "true" : "false") +
				(opts?.dot === false ? "" : ".");
		}
	}
};

function parseOutput(_pl, _status, stdout, opts) {
	const dec = new TextDecoder();
	let start = stdout.indexOf(2); // ASCII START OF TEXT
	const end = stdout.indexOf(3); // ASCII END OF TEXT
	if (start > end) {
		start = -1;
	}
	const nl = stdout.indexOf(10, end+1); // LINE FEED
	const butt = nl >= 0 ? nl : stdout.length;
	const json = dec.decode(stdout.slice(end + 1, butt));
	const msg = JSON.parse(json, reviver(opts));
	msg.output = dec.decode(stdout.slice(start + 1, end));
	return msg;
}

function reviver(opts) {
	if (!opts) return undefined;
	const { atoms, strings } = opts;
	return function(k, v) {
		// atoms
		if (typeof v === "object" && typeof v.functor === "string" && (!v.args || v.args.length === 0)) {
			switch (atoms) {
			case "string":
				return v.functor;
			case "object":
				return v;
			}
		}
		// strings
		if (typeof v === "string" && k !== "result" && k !== "output") {
			switch (strings) {
			case "list":
				return v.split("");
			case "string":
				return v;
			}
		}
		return v;
	}
}

function escapeString(query) {
	query = query.replaceAll("\\", "\\\\");
	query = query.replaceAll(`"`, `\\"`);
	return query;
}

function newWASI(library, env) {
	const args = ["tpl", "--ns", "-q", "-g", "halt"];
	if (library) {
		args.push("--library", library);
	}

	const wasi = new WASI({
		args: args,
		env: env
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

		this.ptr = realloc(0, 0, 1, this.size);
		if (this.ptr === 0) {
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

function readString(instance, ptr, size) {
	const mem = new Uint8Array(instance.exports.memory.buffer);
	const idx = size ? ptr+size :  mem.indexOf(0, ptr);
	if (idx === 1) {
		throw new Error(`unterminated string at address ${ptr}`)
	}
	return new TextDecoder().decode(mem.subarray(ptr, idx));
}

function indirect(instance, addr) {
	if (addr === 0) return 0;
	return (new Int32Array(instance.exports.memory.buffer))[addr / 4];
}

function writeInt32(instance, addr, int) {
	new Int32Array(instance.exports.memory.buffer)[addr / 4] = int;
}