declare module 'trealla' {
	function load(module: WebAssembly.Module): Promise<void>;
	function loadFromWAPM(version: string): Promise<void>;

	class Prolog {
		constructor(options?: PrologOptions);
		
		public init(): Promise<void>;
		public query(goal: string, script?: string): Promise<Answer>;
		public consult(filename: string): Promise<void>;

		public readonly fs: any;
	}

	interface PrologOptions {
		library?: string;
		module?: WebAssembly.Module;
	}

	interface Answer {
		result: "success" | "failure" | "error";
		answers?: Solution[];
		error?: Term;
		output: string; // stdout text
	}

	type Solution = Record<string, Term>;

	type Term = Compound | Variable | string | number;

	interface Compound {
		functor: string;
		args: Term[];
	}

	interface Variable {
		var: string;
	}
}