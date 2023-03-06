declare module 'trealla' {
	/** Call this first to load the runtime.
		Must be called before any interpreters are constructed. */
	function load(): Promise<void>;

	/** Prolog interpreter.
		Each interpreter is independent, having its own knowledgebase and virtual filesystem.
		Multiple queries can be run against one interpreter simultaneously. */
	class Prolog {
		constructor(options?: PrologOptions);

		/** Run a query. This is an asynchronous generator function.
			Use a `for await` loop to easily iterate through results.
			Exiting the loop will automatically destroy the query and reclaim memory.
			If manually iterating with `next()`, call the `return()` method of the generator to kill it early.
			Runtimes that support finalizers will make a best effort attempt to kill live but garbage-collected queries. */
		public query<T = Answer>(goal: string, options?: QueryOptions): AsyncGenerator<T, void, void>;
		/** Runs a query and returns a single solution, ignoring others. */
		public queryOnce<T = Answer>(goal: string, options?: QueryOptions): Promise<T>;

		/** Consult (load) a Prolog file with the given filename. */
		public consult(filename: string): Promise<void>;
		/** Consult (load) a Prolog file with the given text content. */
		public consultText(text: string | Uint8Array): Promise<void>;

		/** Use fs to manipulate the virtual filesystem. */
		public readonly fs: any; /** wasmer-js filesystem */
	}

	interface PrologOptions {
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

	interface QueryOptions {
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

	type EncodingOptions = JSONEncodingOptions | PrologEncodingOptions | Record<string, unknown>;

	interface JSONEncodingOptions {
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

	interface PrologEncodingOptions {
		/** Include the fullstop "." in results. */
		/** True by default. */
		dot?: boolean;
	}

	/** Answer for the "json" format. */
	interface Answer {
		result: "success" | "failure" | "error";
		answer?: Substitution;
		error?: Term;
		/** Standard output text (`user_output` stream in Prolog) */
		stdout?: string;
		/** Standard error text (`user_error` stream in Prolog) */
		stderr?: string;
	}

	/** Mapping of variable name → Term substitutions. */
	type Substitution = Record<string, Term>;

	/** Prolog term.
		Default encoding (in order of priority):
	```
		string(X) 	→ string
		is_list(X)	→ List
		atom(X)		→ Atom
		compound(X)	→ Compound
		integer(X)	→ BigInt if necessary
		number(X) 	→ number
		var(X) 		→ Variable
	```
	*/
	type Term = Atom | Compound | Variable | List | string | number | BigInt;

	type List = Term[];

	class Atom {
		constructor(functor: string);
		functor: string;
		/** Predicate indicator (example: `"foo/0"`) */
		readonly pi: string;
		toProlog(): string;
	}

	/** String template literal for making atoms: atom`foo` = 'foo'. */
	function atom([functor]): Atom;

	class Compound {
		constructor(functor: string, args: List);
		functor: string;
		args: List;
		/** Predicate indicator (in `"foo/N"` format) */
		readonly pi: string;
		toProlog(): string;
	}

	class Variable {
		constructor(name: string, attr: List);
		/** Variable name. */
		var: string;
		/** Residual goals. */
		attr?: List;
		toProlog(): string;
	}

	/** Convert Term objects to their Prolog text representation. */
	function toProlog(object: Term): string;

	/** Parse JSON representations of terms. */
	function fromJSON(json: string, options?: JSONEncodingOptions): Term;

	/** Convert Term objects to JSON text. */
	function toJSON(term: Term, indent?: string): string;

	const FORMATS: {
		json: Toplevel<Answer, JSONEncodingOptions>,
		prolog: Toplevel<string, PrologEncodingOptions>,
		// add your own!
		// [name: string]: Toplevel<any, any>
	};

	interface Toplevel<T, Options> {
		/** Prepare query string, returns goal to execute. */
		query(pl: Prolog, goal: string, bind?: Substitution, options?: Options): string;
		/** Parse stdout and return an answer. */
		parse(pl: Prolog, status: boolean, stdout: Uint8Array, stderr: Uint8Array, options?: Options): T;
		/** Yield simple truth value, when output is blank.
			For queries such as `true.` and `1=2.`.
			Return null to bail early and yield no values. */
		truth(pl: Prolog, status: boolean, stderr: Uint8Array, options?: Options): T | null;
	}
}
