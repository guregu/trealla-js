declare module 'trealla' {
  // Call this first to load the runtime.
	function load(): Promise<void>;

	class Prolog {
		constructor(options?: PrologOptions);

		public query<T = Answer>(goal: string, options?: QueryOptions): AsyncGenerator<T, void, void>;
		public queryOnce<T = Answer>(goal: string, options?: QueryOptions): Promise<T>;

		public consult(filename: string): Promise<void>;
		public consultText(text: string | Uint8Array): Promise<void>;
		
		public readonly fs: any; // wasmer-js filesystem
	}

	interface PrologOptions {
		// Library files path (default: "/library")
		// This is for use_module(library(...)).
		library?: string;
		// Environment variables.
		// Accessible with the predicate getenv/2.
		env?: Record<string, string>;
		// Manually specify module instead of the default.
		module?: WebAssembly.Module;
	}

	interface QueryOptions {
		// Prolog program text to evaluate before the query.
		program?: string | Uint8Array;
		// Answer format. This changes the return type of the query generator.
		// "json" (default) returns Javascript objects.
		// "prolog" returns the standard Prolog toplevel output as strings.
		// You can add custom formats to the global FORMATS object.
		// You can also pass in a Toplevel object directly.
		format?: keyof typeof FORMATS | Toplevel<any, any>;
		// Encoding options for "json" or custom formats.
		encode?: EncodingOptions;
	}

	type EncodingOptions = JSONEncodingOptions | PrologEncodingOptions | Record<string, unknown>;

	interface JSONEncodingOptions {
		// Encoding for Prolog atoms. Default is "object".
		atoms?: "string" | "object";
		// Encoding for Prolog strings. Default is "string".
		strings?: "string" | "list";
		// Functor for compounds of arity 1 to be converted to booleans/null/undefined.
		// e.g. "{}" to turn {true} into true ala Tau, "@" for SWI-ish behavior.
		booleans?: string;
		nulls?: string;
		undefineds?: string;
	}

	interface PrologEncodingOptions {
		// Include the fullstop "." in results.
		// True by default.
		dot?: boolean;
	}

	// Answer for the "json" format.
	interface Answer {
		result: "success" | "failure" | "error";
		answer?: Solution;
		error?: Term;
		output: string; // stdout text
	}

	// Mapping of variable name → Term substitutions.
	type Solution = Record<string, Term>;

	/*
		Default encoding (in order of priority):
		string(X) 	→ string
		is_list(X)	→ List
		atom(X) 	→ Atom
		compound(X) → Compound
		number(X) 	→ number
		var(X) 		→ Variable
	*/
	type Term = Atom | Compound | Variable | List | string | number;

	interface Atom {
		functor: string;
	}

	interface Compound {
		functor: string;
		args: List;
	}

	interface Variable {
		var: string; // variable name
		attr?: List; // residual goals
	}

	type List = Term[];

	const FORMATS: {
		json: Toplevel<Answer, JSONEncodingOptions>,
		prolog: Toplevel<string, PrologEncodingOptions>,
		// add your own!
		// [name: string]: Toplevel<any, any>
	};

	interface Toplevel<T, Options> {
		// Prepare query string, returns goal to execute.
		query(pl: Prolog, goal: string, options?: Options): string;
		// Parse stdout and return an answer.
		parse(pl: Prolog, stdout: Uint8Array, stderr: Uint8Array, options?: Options): T;
		// Yield simple truth value, when output is blank.
		// For queries such as `true.` and `1=2.`.
		// Return null to bail early and yield no values.
		truth(pl: Prolog, status: boolean, options?: Options): T | null;
	}
}