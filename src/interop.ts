import { Compound, Atom, Variable, Literal, toProlog, fromJSON, piTerm, Goal, Term, Atomic, isCompound, isList, isCallable, isNumber } from './term';
import { Ptr } from './c';
import { Ctrl, Prolog, subquery_t, Task, Tick } from './prolog';

export type PredicateFunction<G extends Goal> =
	((pl: Prolog, subq: Ptr<subquery_t>, goal: G, ctrl: Ctrl) => Continuation<G>) | AsyncIterable<G | boolean>;

export type Continuation<G extends Goal> = G | boolean | AsyncContinuation<G>;
export type AsyncContinuation<G extends Goal> = Promise<G | boolean>;

export class Predicate<G extends Goal> {
	name;
	arity;
	proc;

	constructor(name: string, arity: number, fn: PredicateFunction<G>) {
		this.name = name;
		this.arity = arity;
		this.proc = fn;
	}

	// call(pl: Prolog, subquery: number, goal: G, ctrl: any) {
	// 	return this.fn(pl, subquery, goal, ctrl);
	// }

	async* eval(pl: Prolog, subquery: number, goal: G, ctrl: Ctrl) {
		if (Symbol.asyncIterator in this.proc)
			yield* this.proc;
		else
			yield this.proc(pl, subquery, goal, ctrl);
	}

	shim() {
		const args = [];
		for (let i = 0; i < this.arity; i++) {
			args.push(new Variable(`_${i}`));
		}
		const head = Atomic(this.name, args);
		return `${head.toProlog()} :- host_rpc(${head.toProlog()}). `;
	}

	get pi() {
		return `${this.name}/${this.arity}`;
	}
	get piTerm() {
		return piTerm(this.name, this.arity);
	}
	get sync() {
		return typeof this.proc == "function" && !(Symbol.asyncIterator in this.proc);
	}
}

type PromiseTerm = Compound & {functor: "$promise", args: [number, Goal]};

export const sleep_1 = new Predicate<Compound>(
	"sleep", 1,
	async function(_pl, _subquery, goal) {
		const time = goal?.args[0];
		if (typeof time !== "number")
			return throwTerm(type_error("number", time, goal.piTerm));
		if (time < 0)
			return throwTerm(domain_error("not_less_than_zero", time, goal.piTerm));

		await new Promise(resolve => setTimeout(resolve, time * 1000));
		return true;
	});

export const delay_1 = new Predicate<Compound>(
	"delay", 1,
	async function(_pl, _subquery, goal) {
		const time = goal.args[0];
		if (typeof time !== "number")
			return throwTerm(type_error("number", time, goal.piTerm));
		if (time < 0)
			return throwTerm(domain_error("not_less_than_zero", time, goal.piTerm));
	
		await new Promise(resolve => setTimeout(resolve, time));
		return true;
	}
);

export const console_log_1 = new Predicate<Compound>(
	"console_log", 1,
	function(_pl, _subquery, goal) {
		console.log(goal.args[0]);
		return true;
	}
);

export const js_eval_2 = new Predicate<Compound>(
	"js_eval", 2,
	async function(pl, subquery, goal): Promise<Compound | true> {
		const expr = goal.args[0];
		if (typeof expr !== "string")
			return throwTerm(type_error("chars", expr, goal.piTerm));

		let value;
		try {
			value = await js_eval(pl, subquery, goal, expr);
		} catch (error) {
			console.error(error);
			return throwTerm(system_error("js_exception", `${error}`, goal.piTerm));
		}

		if (!value)
			return true;

		return new Compound(goal.functor, [goal.args[0], value]);
	}
);

export const js_eval_json_2 = new Predicate<Compound>(
	"js_eval_json", 2,
	async function(pl, subquery, goal) {
		const expr = goal.args[0];
		if (typeof expr !== "string")
			return throwTerm(type_error("chars", expr, goal.piTerm));

		let value;
		try {
			value = await js_eval(pl, subquery, goal, expr);
		} catch (error) {
			console.error(error);
			return throwTerm(system_error("js_exception", `${error}`, goal.piTerm));
		}

		if (!value)
			return true;

		const term = JSON.stringify(value);
		return new Compound(goal.functor, [goal.args[0], term]);
	}
);

async function js_eval(pl: Prolog, subquery: Ptr<subquery_t>, goal: Compound, expr: Term) {
	if (typeof expr !== "string")
		return throwTerm(type_error("chars", expr, goal.piTerm));

	let value = new Function('pl', 'subquery', 'goal', 'trealla', expr)(pl, subquery, goal, EVAL_BINDINGS);

	if (value instanceof Promise)
		value = await value;

	return value;
}

export const future_2 = new Predicate<Compound>(
	"future", 2,
	function(pl, _subq, goal) {
		const call = goal.args[0];
		if (!isCallable(call))
			return throwTerm(type_error("callable", call, goal.piTerm));

		const goalvar = new Variable("__GOAL");
		const ask = new Compound(",", [new Compound("=", [goalvar, goal.args[0]]), goalvar]);
		const task = pl.query(ask.toProlog());
		const id = pl.addTask(task);
		const promise = new Compound("$promise", [id, goal.args[0]]);
		return new Compound(goal.functor, [goal.args[0], promise]);
	}
);

export const sys_await_1 = new Predicate<Compound>(
	"$await", 1,
	async function(pl, _subq, goal, ctrl) {
		const token: Term = goal.args[0];
		if (!isCompound(token, "$promise")) {
			return throwTerm(type_error("promise", token, goal.piTerm));
		}
		const id = token.args[0];
		if (!isNumber(id)) {
			return throwTerm(type_error("integer", token, goal.piTerm));
		}
		const task: Task | undefined = pl.tasks.get(id);
		if (!task) {
			return false;
		}

		const reply: Tick | undefined = await pl.tickTask(task);
		if (!reply || !reply.result) {
			return false;
		}

		if (reply.result.stdout)
			ctrl.stdout(reply.result.stdout);
		if (reply.result.stderr)
			ctrl.stderr(reply.result.stderr);

		// TODO: change to .status...
		if (reply.result.result === "failure" || !reply.result.goal)
			return false;
		if (reply.result.result === "error")
			return throwTerm(reply.result.error);

		token.args[1] = reply.result.goal;
		return goal;
	}
);

export const await_any_3 = new Predicate<Compound>(
	// '$await_any'(Ps, Winner, Rest)
	"await_any", 3,
	async function(pl, _subq, goal, ctrl) {
		const tokens = goal.args[0];
		if (!isList(tokens)) {
			return throwTerm(type_error("list", tokens, goal.piTerm));
		}
		const ticks = tokens.map(token => {
			if (!isCompound(token, "$promise")) {
				return {
					result: {
						result: "error",
						error: type_error("promise", token, goal.piTerm)
					}
				};
			}
			const id = token.args[0];
			if (!isNumber(id)) {
				return {
					result: {
						result: "error",
						error: type_error("integer", id, goal.piTerm)
					}
				};
			}
			const task = pl.tasks.get(id);
			if (!task) return;
			return pl.tickTask(task);
		});
		const ps = ticks.map(p => new Promise(async (resolve, reject) => {
			const x = await p;
			if (!x) {
				reject();
			} else {
				resolve(x);
			}
		}));
		const reply = await Promise.any(ps) as Tick;
		if (!reply)
			return false;
		
		const win = (tokens as PromiseTerm[]).find(x => x.args[0] === reply.task_id) as PromiseTerm;
		const rest = (tokens as PromiseTerm[]).filter(x => x.args[0] !== reply.task_id);

		if (reply.result?.stdout)
			ctrl.stdout(reply.result.stdout);
		if (reply.result?.stderr)
			ctrl.stderr(reply.result.stderr);

		if (!reply.result || reply.result.result === "failure")
			return false;
		if (reply.result.result === "error")
			return throwTerm(reply.result.error);

		win.args[1] = reply.result.goal;
		// tokens[i].args[2] = new Variable("_");
		goal.args[1] = win;
		goal.args[2] = rest;
		return goal;
	}
);

export const future_cancel_1 = new Predicate<Compound>(
	"future_cancel", 1,
	function(pl, _subq, goal, _ctrl) {
		const token = goal.args[0];
		if (!isCompound(token, "$promise")) {
			return throwTerm(type_error("promise", token, goal.piTerm));
		}
		const id = token.args[0];
		if (!isNumber(id)) {
			return throwTerm(type_error("integer", token, goal.piTerm));
		}
		const task = pl.tasks.get(id);
		if (!task) {
			return true;
		}
		if (task.cancel === null && task.promise === null) {
			task.query.return();
			return true;
		}
		if (typeof task.cancel === "function") {
			task.cancel();
			return true;
		}
		// TODO: interrupt canceled task interpreter
		return true;
	}
);

export const sys_await_all_1 = new Predicate<Compound>(
	"$await_all", 1,
	async function(pl, _subq, goal, ctrl) {
		const tokens = goal.args[0];
		if (!isList(tokens)) {
			return throwTerm(type_error("list", tokens, goal.piTerm));
		}
		for (const token of tokens) {
			if (!isCompound(token, "$promise")) {
				return throwTerm(type_error("promise", token, goal.piTerm));
			}
			if (!isNumber(token.args[0])) {
				return throwTerm(type_error("integer", token.args[0], goal.piTerm));
			}
		}
		const ps = (tokens as Compound[]).map(token => {
			const id = token.args[0] as number;
			const task = pl.tasks.get(id);
			if (!task) return;
			return pl.tickTask(task);
		});
		const replies = await Promise.all(ps);
		for (let i = 0; i < replies.length; i++) {
			const reply = replies[i];
			if (!reply)
				return false;

			if (reply.result?.stdout)
				ctrl.stdout(reply.result.stdout);
			if (reply.result?.stderr)
				ctrl.stderr(reply.result.stderr);

			if (!reply.result || reply.result.result === "failure")
				return false;
			if (reply.result.result === "error")
				return throwTerm(reply.result.error);

			(tokens as Compound[])[i].args[1] = reply.result.goal;
		}

		return goal;
	}
);
	
// TODO: let predicates be async generators?
// '$await_some'(Fs, Fs_OK, Fs_Done)
export const sys_await_some_3 = new Predicate<Compound>(
	"$await_some", 3,
	async function(pl, _subq, goal, ctrl) {
		const tokens = goal.args[0];
		if (!isList(tokens)) {
			return throwTerm(type_error("list", tokens, goal.piTerm));
		}
		for (const token of tokens) {
			if (!isCompound(token, "$promise")) {
				return throwTerm(type_error("promise", token, goal.piTerm));
			}
			if (!isNumber(token.args[0])) {
				return throwTerm(type_error("integer", token.args[0], goal.piTerm));
			}
		}
		const ps = (tokens as PromiseTerm[]).map(token => {
			const id = token.args[0];
			const task = pl.tasks.get(id);
			if (!task) return;
			return pl.tickTask(task);
		});
		const replies = await Promise.all(ps);

		if (replies.length === 0)
			return false;

		const ok = [];
		const done = [];
		for (let i = 0; i < replies.length; i++) {
			const reply = replies[i];
			const result = replies[i]?.result;
			if (!reply) {
				done.push(tokens[i]);
				continue;
			}

			if (result?.result === "error") {
				return throwTerm(result.error);
			} else if (!result || result?.result === "failure") {
				done.push(tokens[i]);
			} else if (result?.goal) {
				(tokens as Compound[])[i].args[1] = result.goal;
				ok.push(tokens[i]);
			}

			if (reply.result?.stdout)
				ctrl.stdout(reply.result.stdout);
			if (reply.result?.stderr)
				ctrl.stderr(reply.result.stderr);
		}

		if (ok.length === 0)
			return false;
		
		goal.args[1] = ok;
		goal.args[2] = done;
		return goal;
	});

export function sys_missing_n(_pl: Prolog, _subq: Ptr<subquery_t>, goal: Goal) {
	return throwTerm(existence_error("procedure", goal.piTerm, piTerm("host_rpc", 1)))
}

export function throwTerm(ball: Term) {
	return new Compound("throw", [ball]);
}

export function type_error(type: string, value: Term, context: Compound) {
	return new Compound("error", [new Compound("type_error", [type, value]), context]);
}

export function domain_error(type: string, value: Term, context: Compound) {
	return new Compound("error", [new Compound("domain_error", [type, value]), context]);
}

export function existence_error(type: string, value: Term, context: Compound) {
	return new Compound("error", [new Compound("existence_error", [type, value]), context]);
}

export function system_error(type: string, value: Term, context: Compound) {
	return new Compound("error", [new Compound("system_error", [type, value]), context]);
}

export const LIBRARY: Predicate<any>[] = [
	sleep_1,
	delay_1,
	console_log_1,
	js_eval_2,
	js_eval_json_2,
	// task_1,
	sys_await_some_3,
	future_2,
	sys_await_1,
	sys_await_all_1,
	await_any_3,
	future_cancel_1
];

const EVAL_BINDINGS = {
	Atom: Atom,
	Compound: Compound,
	Variable: Variable,
	Predicate: Predicate,
	toProlog: toProlog,
	fromJSON: fromJSON,
	piTerm: piTerm
};

const true_0 = new Atom("true");
const fail_0 = new Atom("fail");
