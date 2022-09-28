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
		library?: string;            // library files path (default: "/library")
		module?: WebAssembly.Module; // manually specify module instead of the default (make sure wasmer-js is initialized first)
	}

	interface QueryOptions {
		script?: string;
	}

	interface Answer {
		result: "success" | "failure" | "error";
		answer?: Solution;
		error?: Term;
		output: string; // stdout text
	}

	type Solution = Record<string, Term>;

	type Term = Compound | Variable | string | number | Term[];

	interface Compound {
		functor: string;
		args: Term[];
	}

	interface Variable {
		var: string;
	}
}