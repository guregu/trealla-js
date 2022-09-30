declare module 'trealla' {
	function load(module: WebAssembly.Module): Promise<void>;
	function loadFromWAPM(version: string): Promise<void>;

	class Prolog {
		constructor(options?: PrologOptions);

		public query(goal: string, options?: QueryOptions): AsyncGenerator<Answer, void, void>;
		public queryOnce(goal: string, options?: QueryOptions): Promise<Answer>;

		public consult(filename: string): Promise<void>;
		public consultText(text: string | Uint8Array): Promise<void>;
		
		public readonly fs: any; // wasmer-js filesystem
	}

	interface PrologOptions {
		// library files path (default: "/library")
		// used by use_module(library(...))
		library?: string;
		// manually specify module instead of the default
		module?: WebAssembly.Module;
	}

	interface QueryOptions {
		// Prolog program text to evaluate before the query
		program?: string | Uint8Array;
		// Answer format. This changes the return type of the query generator.
		// "js" (default) returns Javascript objects.
		// "prolog" returns the standard Prolog toplevel output as strings.
		format?: "js" | "prolog" | keyof typeof FORMATS | Toplevel<any>;
		// Encoding options for "js" or custom formats.
		encode?: EncodingOptions;
	}

	interface EncodingOptions {
		// Encoding for Prolog atoms. Default is "object".
		atoms?: "string" | "object";
		// Encoding for Prolog strings. Default is "string".
		strings?: "string" | "list";
	}

	interface Answer {
		result: "success" | "failure" | "error";
		answer?: Solution;
		error?: Term;
		output: string; // stdout text
	}

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
		args: Term[];
	}

	interface Variable {
		var: string;   // variable name
		attr?: Term[]; // residual goals
	}

	type List = Term[];

	const FORMATS: {
		js: Toplevel<Answer>,
		prolog: Toplevel<string>,
		// add your own!
		[name: string]: Toplevel<any>
	};

	interface Toplevel<T> {
		query(goal: string, options?: EncodingOptions): string;
		parse(stdout: Uint8Array, options?: EncodingOptions): T;
	}
}