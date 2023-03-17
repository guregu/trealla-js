import { init as initWasmer, WASI } from '@wasmer/wasi';

import { CString, indirect, readString, writeUint32,
	PTRSIZE, ALIGN, NULL, FALSE, TRUE, Ptr, WASI as CanonicalInstance, ABI, int_t, char_t, bool_t, size_t } from './c';
import { FORMATS, Toplevel } from './toplevel';
import { Atom, Compound, fromJSON, toProlog, piTerm, Goal, Term, isTerm, Args } from './term';
import { Predicate, LIBRARY, system_error, sys_missing_n, throwTerm, Continuation } from './interop';
// @ts-ignore
import tpl_wasm from '../libtpl.wasm';

let tpl: WebAssembly.Module = undefined!; // default Trealla module

let initRuntime = false;
async function initInternal() {
	await initWasmer();
	tpl = await WebAssembly.compile(tpl_wasm as Uint8Array);
	initRuntime = true;
}

/** Load the Trealla and wasmer-js runtimes. */
export async function load() {
	if (!initRuntime) await initInternal();
}

export interface PrologOptions {
    /** Library files path (default: "/library")
        This is to set the search path for use_module(library(...)). */
    library?: string;
    /** Environment variables.
        Accessible with the predicate getenv/2. */
    env?: Record<string, string>;
    /** Quiet mode. Disables warnings printed to stderr if true. */
    quiet?: boolean;
    /** Manually specify module instead of the default. */
    module?: WebAssembly.Module;
}

export interface QueryOptions {
    /** Mapping of variables to bind in the query. */
    bind?: Substitution;
    /** Prolog program text to evaluate before the query. */
    program?: string | Uint8Array;
    /** Answer format. This changes the return type of the query generator.
        `"json"` (default) returns Javascript objects.
        `"prolog"` returns the standard Prolog toplevel output as strings.
        You can add custom formats to the global `FORMATS` object.
        You can also pass in a `Toplevel` object directly. */
    format?: keyof typeof FORMATS | Toplevel<any, any>;
    /** Encoding options for "json" or custom formats. */
    encode?: EncodingOptions;
    /** Automatic yield interval in milliseconds. Default is 20ms. */
    autoyield?: number;
}

export type EncodingOptions = JSONEncodingOptions | PrologEncodingOptions | Record<string, unknown>;

export interface JSONEncodingOptions {
    /** Encoding for Prolog atoms. Default is "object". */
    atoms?: "string" | "object";
    /** Encoding for Prolog strings. Default is "string". */
    strings?: "string" | "list";

    /** Functor for compounds of arity 1 to be converted to booleans.
        For example, `"{}"` to turn the Prolog term `{true}` into true ala Tau,
        or `"@"` for SWI-ish behavior that uses `@(true)`. */
    booleans?: string;
    /** Functor for compounds of arity 1 to be converted to null.
        For example, `"{}"` to turn the Prolog term `{null}` into null`. */
    nulls?: string;
    /** Functor for compounds of arity 1 to be converted to undefined.
        For example, `"{}"` to turn the Prolog term `{undefined}` into undefined`. */
    undefineds?: string;
}

export interface PrologEncodingOptions {
    /** Include the fullstop "." in results. */
    /** True by default. */
    dot?: boolean;
}

/** Answer for the "json" format. */
export type Answer = {
    /** Standard output text (`user_output` stream in Prolog) */
    stdout?: string;
    /** Standard error text (`user_error` stream in Prolog) */
    stderr?: string;
} & (Success | Failure | ErrorReply)

export interface Success {
	status: "success";
	answer: Substitution;
	/** Standard output text (`user_output` stream in Prolog) */
	stdout?: string;
	/** Standard error text (`user_error` stream in Prolog) */
	stderr?: string;
	goal?: Goal;
}

export interface Failure {
	status: "failure";
}

export interface ErrorReply {
	status: "error";
	error: Term;
}

/** Mapping of variable name → Term substitutions. */
export type Substitution = Record<string, Term>;

export type prolog_t = never;
export type subquery_t = never;

export type Ctrl = {
	subq: Ptr<subquery_t>,
	get subquery(): Ptr<subquery_t>,
	alive: boolean,
	stdout: (str: string) => void,
	stderr: (str: string) => void,
}

interface Instance extends CanonicalInstance {
    exports: Trealla;
}

interface Trealla extends ABI {
    pl_query(pl: Ptr<prolog_t>, goal: Ptr<char_t>, subqptr: Ptr<Ptr<subquery_t>>, autoyield: int_t): bool_t;
    pl_redo(pl: Ptr<prolog_t>): bool_t;
    pl_done(pl: Ptr<prolog_t>): void;
    get_status(pl: Ptr<prolog_t>): bool_t;
    pl_did_yield(subquery: Ptr<subquery_t>): bool_t;
    pl_yield_at(subquery: Ptr<subquery_t>, msec: int_t): void;
    pl_consult(pl: Ptr<prolog_t>, str: Ptr<char_t>): bool_t;
}

export interface Thunk {
    cont?: AsyncGenerator<Continuation<Goal>, Continuation<Goal>, void>;
    value?: Goal | boolean;
    done: boolean;
}

export interface Task {
	id: number;
	promise: Promise<Tick | undefined> | null;
	cancel: (() => void) | null;
	query: AsyncGenerator<Tick, void, undefined>
}

export type Tick = {
    task_id: number,
    answer: Answer & {goal: Goal} | undefined,
    time: number,
    depth: number
}

/** Prolog interpreter instance. */
export class Prolog {
	wasi;
	instance!: Instance;
	ptr: Ptr<prolog_t> = 0; // pointer to *prolog instance
	n = 0;
	taskcount = 0;
	scratch = 0;
	finalizers;
	yielding: Record<Ptr<subquery_t>, Thunk> = {};		// *subq → maybe promise
	procs: Record<string, Predicate<any>> = {};			// pi → predicate
	tasks = new Map<number, Task>();		            // id → task
	subqs = new Map<Ptr<subquery_t>, Ctrl>(); 		    // *subq → ctrl
	spawning = new Map<Ptr<Ptr<subquery_t>>, Ctrl>();   // **subq → ctrl

	/**	Create a new Prolog interpreter instance. */
	constructor(options: Partial<PrologOptions> = {}) {
		const {
			library,
			env,
			quiet
		} = options;
		this.wasi = newWASI(library, env, quiet);
		if ("FinalizationRegistry" in globalThis) {
			this.finalizers = new FinalizationRegistry((task: Ctrl) => {
				if (task.alive) {
					task.alive = false;
					const pl_done = this.instance.exports.pl_done;
					pl_done(task.subquery);
					delete this.yielding[task.subquery];
				}
			})
		}
	}

	/**	Instantiate this interpreter. Automatically called by other methods if necessary. */
	async init() {
		if (!initRuntime) await initInternal();

		const imports = this.wasi.getImports(tpl) as WebAssembly.Imports;
		imports.trealla = {
			"host-call": this._host_call.bind(this),
			"host-resume": this._host_resume.bind(this)
		};
		this.instance = await WebAssembly.instantiate(tpl, imports) as Instance;

		// run it once it initialize the global interpreter
		const exit = this.wasi.start(this.instance);
		if (exit !== 0) {
			throw new Error("trealla: could not initialize interpreter");
		}
		const pl_global = this.instance.exports.pl_global as Function;
		this.ptr = pl_global();

		await this.registerPredicates(LIBRARY, "builtin");
	}

	/** Run a query. This is an asynchronous generator function.
	 *  Use a `for await` loop to easily iterate through results.
	 *  Exiting the loop will automatically destroy the query and reclaim memory.
	 *  Call the `return()` method of the generator to kill it early if manually iterating with `next()`.
	 *  Runtimes that support finalizers will make a best effort attempt to kill live but garbage-collected queries.
	 **/
	async* query(goal: string, options: QueryOptions = {}) {
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
		
		let stdoutbufs: Uint8Array[] = [];
		let stderrbufs: Uint8Array[] = [];
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

		let subqptr: Ptr<Ptr<subquery_t>> = realloc(NULL, 0, ALIGN, PTRSIZE); // pl_sub_query**
		let readSubqPtr = () => {
			const subq = subqptr ? indirect<Ptr<subquery_t>>(this.instance, subqptr) : NULL;
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
			stdout: function(str: string) {
				if (!str) return;
				stdoutbufs.push(new TextEncoder().encode(str));	
			},
			stderr: function(str: string) {
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
						if (thunk.cont) {
							const {value, done} = await thunk.cont.next();
							readOutput();
							thunk.value = value ?? undefined;
							thunk.done = done ?? true;
						} else {
							thunk.value = undefined;
							thunk.done = true;
						}
					} catch (error) {
						console.error(error);
						thunk.value = throwTerm(system_error("js_exception", `${error}`, piTerm("$host_resume", 1)));
					}
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
				this.finalizers!.unregister(token);
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
	async queryOnce(goal: string, options?: QueryOptions) {
		const q = this.query(goal, options);
		try {
			return (await q.next()).value;
		} finally {
			q.return();
		}
	}

	/** Consult (load) a Prolog file with the given text content.
	 *	Use fs to manipulate the filesystem. */
	async consult(filename: string) {
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

	/** Consult (load) Prolog text. */
	async consultText(code: string | Uint8Array) {
		if (!this.instance) {
			await this.init();
		}
		const filename = await this.writeScratchFile(code);
		await this.consult(filename);
		this.fs.removeFile(filename);
	}

	async consultTextInto(code: string, module = "user") {
		if (!this.instance) {
			await this.init();
		}
		// Module:'$load_chars'(Code)
		const goal = new Compound(":", [new Atom(module), new Compound("$load_chars", [code])]);
		const reply = await this.queryOnce(goal.toProlog());
		if (reply.result !== "success") {
			throw new Error("trealla: consult text failed");
		}
		// console.log("loaded:", module, code);
	}

	async register<G extends Goal>(pred: Predicate<G> | Predicate<Goal>[], module = "user") {
        if (Array.isArray(pred))
            return this.registerPredicates(pred, module);
		if (!(pred instanceof Predicate))
			throw new Error("trealla: predicate is not type Predicate");

		this.procs[pred.pi.toString()] = pred;
		const shim = pred.shim();
		await this.consultTextInto(shim, module);
	}

	async registerPredicates(predicates: (Predicate<Goal>)[], module = "user") {
		let shim = "";
		for (const pred of predicates) {
			this.procs[pred.pi.toString()] = pred;
			shim += pred.shim(); + " ";
		}
		await this.consultTextInto(shim, module);
	}

	async writeScratchFile(code: string | Uint8Array) {
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

	addTask(query: AsyncGenerator<Answer & {goal: Goal}, void, unknown>) {
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

	async* runTask(id: number, query: AsyncGenerator<Answer & {goal: Goal}, void, unknown>): AsyncGenerator<Tick, void, unknown> {
		let choice = 0;
		try {
			for await (const x of query) {
				yield {task_id: id, answer: x, time: Date.now(), depth: choice++};
			}
		} finally {
			this.tasks.delete(id);
		}
	}

	tickTask(task: Task) {
		if (!task.promise) {
			task.promise = new Promise(async (resolve) => {
				task.cancel = () => {
					task.query.return();
					resolve(Promise.resolve(undefined));
				};
				const {value} = await task.query.next();
				resolve(value ?? undefined);
				task.promise = null;
				task.cancel = null;
			});
		}
		return task.promise;
	}

	/**	wasmer-js virtual filesystem.
	 *	Unique per interpreter, Prolog can read and write from it.
	 *	See: https://github.com/wasmerio/wasmer-js */
	get fs() {
		return this.wasi.fs;
	}

	ctrl(subquery: Ptr<subquery_t>) {
		const ctrl = this.subqs.get(subquery);
		if (ctrl)
			return ctrl;
		for (const [_, ctrl] of this.spawning) {
			if (ctrl.subquery === subquery)
				return ctrl;
		}
		throw new Error("trealla: internal error, couldn't find ctrl for subquery");
	}

	_host_call(subquery: Ptr<subquery_t>, ptr: Ptr<char_t>, msgsize: size_t, replyptrptr: Ptr<Ptr<char_t>>, replysizeptr: size_t): HostCallReply {
		const raw = readString(this.instance, ptr, msgsize);
		const goal = fromJSON(raw) as Goal;
		const ctrl = this.ctrl(subquery);
		let result = "fail";
		let cont: AsyncGenerator<Continuation<Goal>, Continuation<Goal>, void> | undefined;
		try {
			const pred = this.procs[goal.pi.toProlog()];
			if (!pred) {
				sys_missing_n(this, subquery, goal); // throws
			} else if (!pred.async) {
				const value = pred.proc(this, subquery, goal, ctrl);
				if (value instanceof Promise) {
					cont = async function* () { return await value; }();
					result = "true";
				} else {
					if (isTerm(value))
						result = toProlog(value);
					else
						result = value;
				}
			} else {
				cont = pred.eval(this, subquery, goal, ctrl);
				result = "true";
			}
		} catch(error) {
			console.error(error);
			result = throwTerm(system_error("js_exception", `${error}`, goal.pi)).toProlog();
		}

		if (cont) {
			this.yielding[subquery] = {
				cont: cont,
				done: false
			};
		}

		let reply: CString;
		if (typeof result === "string") {
			reply = new CString(this.instance, result);
		} else {
			console.warn("invalid return value from native predicate: " + goal.pi + " value: " + result)
			return WASM_HOST_CALL_ERROR;
		}

		writeUint32(this.instance, replysizeptr, reply.size-1);
		writeUint32(this.instance, replyptrptr, reply.ptr);

		if (!cont)
			return WASM_HOST_CALL_OK;
		
		return WASM_HOST_CALL_YIELD;
	}

	_host_resume(subquery: Ptr<subquery_t>, replyptrptr: Ptr<Ptr<char_t>>, replysizeptr: Ptr<size_t>): HostCallReply {
		const task = this.yielding[subquery];
		if (!task) {
			return WASM_HOST_CALL_ERROR;
		}
		// console.log("get thunk:", task, subquery);

		if (task.done)
			delete this.yielding[subquery];

		let result;
		try {
			const x = task.value;
			if (!x) {
				result = "fail"
			} else if (x === true) {
				result = "true";
			} else {
				result = toProlog(x);
			}
		} catch(error) {
			console.error(error);
			result = throwTerm(system_error("js_exception", `${error}`, piTerm("host_rpc", 2))).toProlog();
		}
		const reply = new CString(this.instance, result);
		writeUint32(this.instance, replysizeptr, reply.size-1);
		writeUint32(this.instance, replyptrptr, reply.ptr);

		if (!task.done)
			return WASM_HOST_CALL_CHOICE;

		if (result === "fail")
			return WASM_HOST_CALL_FAIL;

		return WASM_HOST_CALL_OK;
	}
}

// From -DWASM_IMPORTS
const WASM_HOST_CALL_ERROR	= 0;
const WASM_HOST_CALL_OK		= 1;
const WASM_HOST_CALL_YIELD	= 2;
const WASM_HOST_CALL_CHOICE	= 3;
const WASM_HOST_CALL_FAIL	= 4;

type HostCallReply = typeof WASM_HOST_CALL_ERROR | typeof WASM_HOST_CALL_OK |
	typeof WASM_HOST_CALL_YIELD | typeof WASM_HOST_CALL_CHOICE | typeof WASM_HOST_CALL_FAIL;


function newWASI(library?: string, env?: Record<string, string>, quiet?: boolean) {
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

function joinBuffers(bufs: Uint8Array[]) {
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