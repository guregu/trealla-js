declare module 'trealla' {
	function load(module: WebAssembly.Module): Promise<void>;
	function loadFromWAPM(version: string): Promise<void>;

	class Prolog {
		constructor();
		
		public init(module?: WebAssembly.Module): Promise<void>;
		public query(goal: string, script?: string): Promise<Answer>;

		public readonly fs: any;
	}

	interface Answer {
		result: "success" | "failure" | "error";
		answers?: Solution[];
		error?: Term;
		output: string; // stdout text
	}

	type Solution = Record<string, Term>;

	type Term = Compound | string | number;

	interface Compound {
		functor: string;
		args: Term[];
	}
}