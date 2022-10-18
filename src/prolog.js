import { init as initWasmer, WASI } from '@wasmer/wasi';

import { CString, indirect, readString, writeUint32,
	PTRSIZE, ALIGN, NULL, FALSE, TRUE } from './c';
import { FORMATS } from './toplevel';
import tpl_wasm from '../libtpl.wasm';

let tpl = undefined; // default Trealla module

let initRuntime = false;
async function initInternal() {
	await initWasmer();
	tpl = await WebAssembly.compile(tpl_wasm);
	initRuntime = true;
}

/** Load the Trealla and wasmer-js runtimes. */
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
		const {
			library,
			env,
			quiet
		} = options;
		this.wasi = newWASI(library, env, quiet);
		if ("FinalizationRegistry" in globalThis) {
			this.finalizers = new FinalizationRegistry((task) => {
				if (task.alive) {
					task.alive = false;
					this.instance.exports.pl_done(task.subquery);
					delete this.yielding[task.subquery];
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
	 *  Exiting the loop will automatically destroy the query and reclaim memory.
	 *  Call the `return()` method of the generator to kill it early if manually iterating with `next()`.
	 *  Runtimes that support finalizers will make a best effort attempt to kill live but garbage-collected queries.
	 **/
	async* query(goal, options = {}) {
		if (!this.instance) await this.init();
		const {
			bind,
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
			subquery: NULL,
			alive: false
		};

		if (program) {
			await this.consultText(program);
		}

		// standard WASI exports (from wasi.c)
		const realloc = this.instance.exports.canonical_abi_realloc;
		const free = this.instance.exports.canonical_abi_free;
		// exports from trealla.h
		const pl_query = this.instance.exports.pl_query;
		const pl_redo = this.instance.exports.pl_redo;
		const pl_done = this.instance.exports.pl_done;
		const get_status = this.instance.exports.get_status;
		const query_did_yield = this.instance.exports.query_did_yield;

		const goalstr = new CString(this.instance, toplevel.query(this, goal, bind, encode));
		const subqptr = realloc(NULL, 0, ALIGN, PTRSIZE); // pl_sub_query**
		let finalizing = false;

		try {
			const ok = pl_query(this.ptr, goalstr.ptr, subqptr);
			goalstr.free();
			task.subquery = indirect(this.instance, subqptr); // pl_sub_query*
			free(subqptr, PTRSIZE, 1);
			do {
				if (this.finalizers && task.alive && !finalizing) {
					this.finalizers.register(token, task);
					finalizing = true;
				}
				// if the guest yielded, run the yielded promise and redo
				// upon redo, the guest can call '$host_continue'/1 to grab the promise's return value
				if (query_did_yield(task.subquery) === TRUE) {
					const thunk = this.yielding[task.subquery];
					if (!thunk) {
						// guest yielded without having called '$host_call'/2
						// TODO: is it useful to attempt to process the output here?
						continue
					}
					try {
						thunk.value = await thunk.promise;
					} catch (err) {
						// TODO: better format for this
						thunk.value = {"$error": `${err}`};
					}
					thunk.done = true;
					continue;
				}
				// otherwise, pass to toplevel
				const status = get_status(this.ptr) === TRUE;
				const stdout = this.wasi.getStdoutBuffer();
				const stderr = this.wasi.getStderrBuffer();
				if (stdout.byteLength === 0) {
					const truth = toplevel.truth(this, status, stderr, encode);
					if (truth === null) return;
					yield truth;
				} else {
					yield toplevel.parse(this, status, stdout, stderr, encode);
				}
				if (ok === FALSE) {
					return;
				}
			} while(task.alive = pl_redo(task.subquery) === TRUE)
		} finally {
			if (finalizing) {
				this.finalizers.unregister(token);
			}
			if (task.alive && task.subquery !== NULL) {
				task.alive = false;
				pl_done(task.subquery);
				delete this.yielding[task.subquery];
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

	/** Consult (load) a Prolog file with the given text content.
	 *	Use fs to manipulate the filesystem. */
	async consult(filename) {
		if (!this.instance) await this.init()

		if (filename === "user") {
			throw new Error("trealla: consulting from 'user' unsupported");
		}

		const pl_consult = this.instance.exports.pl_consult;
		const str = new CString(this.instance, filename);
		let ret = FALSE;
		try {
			ret = pl_consult(this.ptr, str.ptr);
		} finally {
			str.free();
		}
		if (ret === FALSE) {
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
			result = JSON.stringify({"$error": `${error}`});
		}
		const reply = new CString(this.instance, result);
		writeUint32(this.instance, replysizeptr, reply.size-1);
		writeUint32(this.instance, replyptrptr, reply.ptr);
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
		delete this.yielding[subquery];
		let result;
		try {
			const x = task.value;
			result = replyMsg(x);
		} catch(error) {
			console.error(error);
			result = JSON.stringify({"$error": `${error}`});
		}
		const reply = new CString(this.instance, result);
		writeUint32(this.instance, replysizeptr, reply.size-1);
		writeUint32(this.instance, replyptrptr, reply.ptr);
		return WASM_HOST_CALL_OK;
	}
}

// From -DWASM_IMPORTS
const WASM_HOST_CALL_ERROR = 0;
const WASM_HOST_CALL_OK = 1;
const WASM_HOST_CALL_YIELD = 2;

function replyMsg(x) {
	if (x instanceof Uint8Array) {
		return new TextDecoder().decode(x);
	}
	return typeof x !== "undefined" ? JSON.stringify(x) : "null";
}

function newWASI(library, env, quiet) {
	const args = ["tpl", "--ns", "-g", "use_module(user), halt"];
	if (library) args.push("--library", library);
	if (quiet) args.push("-q");

	const wasi = new WASI({
		args: args,
		env: env
	});
	wasi.fs.createDir("/tmp");

	return wasi;
}
