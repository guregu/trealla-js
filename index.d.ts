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
	}

	interface Answer {
		result: "success" | "failure" | "error";
		answer?: Solution;
		error?: Term;
		output: string; // stdout text
	}

	type Solution = Record<string, Term>;

	type Term = Compound | Variable | List | string | number;

	interface Compound {
		functor: string;
		args: Term[];
	}

	interface Variable {
		var: string;
	}

	type List = Term[];
}