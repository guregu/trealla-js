import { init as initWasmer, WASI } from '@wasmer/wasi';

import { CString, indirect, readString, writeUint32,
	PTRSIZE, ALIGN, NULL, FALSE, TRUE } from './c';
import { FORMATS } from './toplevel';
import { Atom, Compound, fromJSON, toProlog, piTerm } from './term';
import { Predicate, LIBRARY, system_error, sys_missing_n, throwTerm } from './interop';
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
	taskcount = 0;
	scratch = 0;
	finalizers;
	yielding = {};
	procs = {};
	tasks = new Map();
	subqs = new Map();
	spawning = new Map(); // **subq -> ctrl

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

		await this.registerPredicates(LIBRARY, "builtin");
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
			encode,				// Options passed to toplevel
			autoyield = 20,		// Yield interval, milliseconds. Set to 0 to disable.
		} = options;

		goal = goal.replaceAll("\n", " ").replaceAll("\t", " ");

		const toplevel =
			typeof format === "string" ? FORMATS[format] : format;
		if (!toplevel) {
			throw new Error(`trealla: unknown format: ${format}`);
		}

		const _id = ++this.n;
		const token = {};
		
		let stdoutbufs = [];
		let stderrbufs = [];
		const readOutput = () => {
			const stdout = this.wasi.getStdoutBuffer();
			const stderr = this.wasi.getStderrBuffer();
			if (stdout.length > 0)
				stdoutbufs.push(stdout);
			if (stderr.length > 0)
				stderrbufs.push(stderr);
		}

		// standard WASI exports (from wasi.c)
		const realloc = this.instance.exports.canonical_abi_realloc;
		const free = this.instance.exports.canonical_abi_free;
		// exports from trealla.h
		const pl_query = this.instance.exports.pl_query;
		const pl_redo = this.instance.exports.pl_redo;
		const pl_done = this.instance.exports.pl_done;
		const get_status = this.instance.exports.get_status;
		const pl_did_yield = this.instance.exports.pl_did_yield;
		const pl_yield_at = this.instance.exports.pl_yield_at;

		let subqptr = realloc(NULL, 0, ALIGN, PTRSIZE); // pl_sub_query**
		let readSubqPtr = () => {
			const subq = subqptr ? indirect(this.instance, subqptr, autoyield) : NULL;
			if (subq !== NULL) {
				this.subqs.set(subq, ctrl);
				this.spawning.delete(subqptr);
			}
			return subq;
		}
		const ctrl = {
			subq: NULL,
			get subquery() {
				if (this.subq === NULL)
					this.subq = readSubqPtr();
				return this.subq;
			},
			alive: false,
			stdout: function(str) {
				if (!str) return;
				stdoutbufs.push(new TextEncoder().encode(str));	
			},
			stderr: function(str) {
				if (!str) return;
				stderrbufs.push(new TextEncoder().encode(str));
			}
		};
		this.spawning.set(subqptr, ctrl);

		if (program) {
			await this.consultText(program);
		}

		const goalstr = new CString(this.instance, toplevel.query(this, goal, bind, encode));
		let finalizing = false;
		let lastYield = 0;

		try {
			const ok = pl_query(this.ptr, goalstr.ptr, subqptr, autoyield);
			goalstr.free();
			
			const subq = readSubqPtr(); // pl_sub_query*
			ctrl.subq = subq;
			readSubqPtr = function() { return subq };
			free(subqptr, PTRSIZE, 1);
			subqptr = NULL;

			do {
				if (this.finalizers && ctrl.alive && !finalizing) {
					this.finalizers.register(token, ctrl);
					finalizing = true;
				}
				
				// need to eagerly read buffers in case we await or come from a yield
				readOutput();

				// if the guest yielded, run the yielded promise and redo
				// upon redo, the guest can call '$host_continue'/1 to grab the promise's return value
				if (pl_did_yield(ctrl.subq) === TRUE) {
					const thunk = this.yielding[ctrl.subq];
					if (!thunk) {
						// guest yielded without having called '$host_call'/2
						let now;
						if (autoyield > 0 && (now = Date.now()) - lastYield > autoyield) {
							lastYield = now;
							await new Promise(resolve => setTimeout(resolve, 0));
							pl_yield_at(ctrl.subq, autoyield);
							readOutput();
						}
						continue
					}
					try {
						thunk.value = await thunk.promise;
						readOutput();
					} catch (err) {
						// TODO: better format for this
						console.error(err);
						thunk.value = throwTerm(system_error("js_exception", err.toString(), piTerm("$host_resume", 1)));
					}
					thunk.done = true;
					lastYield = Date.now();
					continue;
				}
				// otherwise, pass to toplevel
				const status = get_status(this.ptr) === TRUE;
				const stdout = joinBuffers(stdoutbufs);
				const stderr = joinBuffers(stderrbufs);
				stdoutbufs = [];
				stderrbufs = [];
				if (stdout.byteLength === 0) {
					const truth = toplevel.truth(this, status, stderr, encode);
					if (truth === null) return;
					yield truth;
				} else {
					const solution = toplevel.parse(this, status, stdout, stderr, encode);
					if (solution === null) return;
					yield solution;
				}
				if (ok === FALSE) {
					return;
				}
			} while(ctrl.alive = pl_redo(ctrl.subq) === TRUE)
		} finally {
			if (finalizing) {
				this.finalizers.unregister(token);
			}

			if (ctrl.subq !== NULL) {
				this.subqs.delete(ctrl.subq);

				if (ctrl.alive) {
					ctrl.alive = false;
					pl_done(ctrl.subq);
					delete this.yielding[ctrl.subq];
				}
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

	async consultTextInto(code, module = "user") {
		if (!this.instance) {
			await this.init();
		}
		// Module:'$load_chars'(Code)
		const goal = new Compound(":", [new Atom(module), new Compound("$load_chars", [code])]);
		const reply = await this.queryOnce(goal.toProlog());
		if (reply.result !== "success") {
			throw new Error("trealla: consult text failed");
		}
		console.log("loaded", module, code);
	}

	async register(name, arity, func, module = "user") {
		if (typeof func !== "function")
			throw new Error("trealla: register predicate argument is not a function");

		return await this.registerPredicate(module, new Predicate(name, arity, func));
	}

	async registerPredicate(pred, module = "user") {
		if (!(pred instanceof Predicate))
			throw new Error("trealla: predicate is not type Predicate");

		this.procs[pred.pi] = pred.fn;
		await this.consultTextInto(shim, module);
	}

	async registerPredicates(predicates, module = "user") {
		let shim = "";
		for (const pred of predicates) {
			this.procs[pred.pi] = pred.fn;
			shim += pred.shim(); + " ";
		}
		await this.consultTextInto(shim, module);
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

	addTask(query) {
		const id = this.taskcount++;
		const q = this.runTask(id, query);
		this.tasks.set(id, {
			id: id,
			promise: null,
			cancel: null,
			query: q
		});
		return id;
	}

	async* runTask(id, query) {
		let choice = 0;
		try {
			for await (const x of query) {
				yield {task_id: id, result: x, time: Date.now(), depth: choice++};
			}
		} finally {
			this.tasks.delete(id);
		}
	}

	tickTask(task) {
		if (!task.promise) {
			task.promise = new Promise(async (resolve) => {
				task.cancel = () => {
					task.query.return();
					resolve();
				};
				const {value} = await task.query.next();
				resolve(value);
				task.promise = null;
				task.cancel = null;
			});
		}
		return task.promise;
	}

	async tick() {
		const ps = Array.from(this.tasks.values()).
			map(task => this.tickTask(task));

		if (ps.length === 0)
			return null;

		try {
			let next = await Promise.any(ps);
			return next;
		} catch (err) {
			console.error(err);
			return null;
		}
	}

	/**	wasmer-js virtual filesystem.
	 *	Unique per interpreter, Prolog can read and write from it.
	 *	See: https://github.com/wasmerio/wasmer-js */
	get fs() {
		return this.wasi.fs;
	}

	ctrl(subquery) {
		const ctrl = this.subqs.get(subquery);
		if (ctrl)
			return ctrl;
		for (const [_, ctrl] of this.spawning) {
			if (ctrl.subquery === subquery)
				return ctrl;
		}
	}

	_host_call(subquery, ptr, msgsize, replyptrptr, replysizeptr) {
		const raw = readString(this.instance, ptr, msgsize);
		const goal = fromJSON(raw);
		const ctrl = this.ctrl(subquery);
		let result;
		try {
			const fn = this.procs[goal.pi] ?? sys_missing_n;
			const x = fn(this, subquery, goal, ctrl);
			if (x instanceof Promise) {
				this.yielding[subquery] = {promise: x, done: false};
				return WASM_HOST_CALL_YIELD;
			}
			result = x ? toProlog(x) : "true";
		} catch(error) {
			console.error(error);
			result = throwTerm(system_error("js_exception", error.toString(), goal.piTerm)).toProlog();
		}
		console.log("hostcall result:", result);
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
			result = x ? toProlog(x) : "true";
		} catch(error) {
			console.error(error);
			result = throwTerm(system_error("js_exception", error.toString(), goal.piTerm)).toProlog();
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

function joinBuffers(bufs) {
	if (bufs.length === 0) {
		return new Uint8Array(0);
	}
	if (bufs.length === 1) {
		return bufs[0];
	}
	let size = 0;
	for (const buf of bufs) {
		size += buf.length;
	}
	const ret = new Uint8Array(size);
	let i = 0;
	for (const buf of bufs) {
		ret.set(buf, i);
		i += buf.length;
	}
	return ret;
}