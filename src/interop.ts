import { Compound, Atom, Variable, toProlog, fromJSON, piTerm, Goal, Term, Atomic,
	isCompound, isList, isCallable, isNumber, isTerm, PredicateIndicator, Functor } from './term';
import { Ptr } from './c';
import { Answer, Ctrl, Prolog, subquery_t, Task, Tick } from './prolog';

export type PredicateFunction<G extends Goal> =
	(pl: Prolog, subq: Ptr<subquery_t>, goal: G, ctrl: Ctrl) =>
		Continuation<G> | Promise<Continuation<G>> | AsyncIterable<Continuation<G>>;

export type Continuation<G extends Goal> = G | boolean;

export class Predicate<G extends Goal> {
	name;
	arity;
	proc;
	async;
	constructor(name: string, arity: number, fn: PredicateFunction<G>, async = true) {
		this.name = name;
		this.arity = arity;
		this.proc = fn;
		this.async = async;
	}

	async* eval(pl: Prolog, subquery: number, goal: G, ctrl: Ctrl) {
		const x = this.proc(pl, subquery, goal, ctrl);
		try {
			if (typeof x === "object" && Symbol.asyncIterator in x) {
				yield yield* x;
			} else {
				if (x instanceof Promise) {
					yield await x;
				} else {
					yield x;
				}
			}
		} catch (error) {
			if (isTerm(error))
				return new Compound("throw", [error]);
			return system_error("js_exception", `${error}`, goal.pi)
		}
		return false;
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
		return piTerm(this.name, this.arity);
	}
}

type PromiseTerm = Compound<"$promise", [number, Goal]>;

export const sleep_1 = new Predicate<Compound<"sleep", [number]>>(
	"sleep", 1,
	async function(_pl, _subquery, goal) {
		const time = goal.args[0];
		if (typeof time !== "number")
			throw type_error("number", time, goal.pi);
		if (time < 0)
			throw domain_error("not_less_than_zero", time, goal.pi);

		await new Promise(resolve => setTimeout(resolve, time * 1000));
		return true;
	});

export const delay_1 = new Predicate<Compound<"delay", [number]>>(
	"delay", 1,
	async function(_pl, _subquery, goal) {
		const time = goal.args[0];
		if (typeof time !== "number")
			throw type_error("number", time, goal.pi);
		if (time < 0)
			throw domain_error("not_less_than_zero", time, goal.pi);
	
		await new Promise(resolve => setTimeout(resolve, time));
		return true;
	}
);

export const console_log_1 = new Predicate<Compound<"console_log", [string]>>(
	"console_log", 1,
	function(_pl, _subquery, goal) {
		console.log(goal.args[0]);
		return true;
	},
	false
);

export const js_eval_2 = new Predicate<Compound<"js_eval", [string, Term]>>(
	"js_eval", 2,
	async function(pl, subquery, goal) {
		const expr = goal.args[0];
		if (typeof expr !== "string")
			throw type_error("chars", expr, goal.pi);

		let value;
		try {
			value = await js_eval(pl, subquery, goal, expr);
		} catch (error) {
			console.error(error);
			throw system_error("js_exception", `${error}`, goal.pi);
		}

		if (!value)
			return true;

		return new Compound(goal.functor, [goal.args[0], value]);
	}
);

export const js_eval_json_2 = new Predicate<Compound<"js_eval_json", [string, Term]>>(
	"js_eval_json", 2,
	async function(pl, subquery, goal) {
		const expr = goal.args[0];
		if (typeof expr !== "string")
			throw type_error("chars", expr, goal.pi);

		let value;
		try {
			value = await js_eval(pl, subquery, goal, expr);
		} catch (error) {
			console.error(error);
			throw system_error("js_exception", `${error}`, goal.pi);
		}

		if (!value)
			return true;

		const term = JSON.stringify(value);
		return new Compound(goal.functor, [goal.args[0], term]);
	}
);

async function js_eval(pl: Prolog, subquery: Ptr<subquery_t>, goal: Goal, expr: Term) {
	if (typeof expr !== "string")
		throw type_error("chars", expr, goal.pi);

	let value = new Function('pl', 'subquery', 'goal', 'trealla', expr)(pl, subquery, goal, EVAL_BINDINGS);

	if (value instanceof Promise)
		value = await value;

	return value;
}

export const future_2 = new Predicate<Compound<"future", [Goal, PromiseTerm]>>(
	"future", 2,
	function(pl, _subq, goal) {
		const call = goal.args[0];
		if (!isCallable(call))
			throw type_error("callable", call, goal.pi);

		const goalvar = new Variable("__GOAL");
		const ask = new Compound(",", [new Compound("=", [goalvar, goal.args[0]]), goalvar]);
		const task = pl.query(ask.toProlog()) as AsyncGenerator<Answer & {goal: Goal}>;
		const id = pl.addTask(task);
		const promise = new Compound("$promise", [id, goal.args[0]]);
		return new Compound(goal.functor, [goal.args[0], promise]);
	}
);

export const sys_await_1 = new Predicate<Compound<"$await", [PromiseTerm]>>(
	"$await", 1,
	async function(pl, _subq, goal, ctrl) {
		const token: Term = goal.args[0];
		if (!isCompound(token, "$promise", 2)) {
			throw type_error("promise", token, goal.pi);
		}
		const id = token.args[0];
		if (!isNumber(id)) {
			throw type_error("integer", token, goal.pi);
		}
		const task: Task | undefined = pl.tasks.get(id);
		if (!task) {
			return false;
		}

		const tick: Tick | undefined = await pl.tickTask(task);
		if (!tick || !tick.answer) {
			return false;
		}

		if (tick.answer.stdout)
			ctrl.stdout(tick.answer.stdout);
		if (tick.answer.stderr)
			ctrl.stderr(tick.answer.stderr);

		if (tick.answer.status === "failure" || !tick.answer.goal)
			return false;
		if (tick.answer.status === "error")
			throw tick.answer.error;

		token.args[1] = tick.answer.goal;
		return goal;
	}
);

export const await_any_3 = new Predicate<Compound<"await_any", [PromiseTerm[], Variable|PromiseTerm, Variable|PromiseTerm[]]>>(
	// '$await_any'(Ps, Winner, Rest)
	"await_any", 3,
	async function(pl, _subq, goal, ctrl) {
		const tokens = goal.args[0];
		if (!isList(tokens)) {
			throw type_error("list", tokens, goal.pi);
		}
		const ticks = tokens.map(token => {
			if (!isCompound(token, "$promise")) {
				return {
					result: {
						status: "error",
						error: type_error("promise", token, goal.pi)
					}
				};
			}
			const id = token.args[0];
			if (!isNumber(id)) {
				return {
					result: {
						status: "error",
						error: type_error("integer", id, goal.pi)
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
		const tick = await Promise.any(ps) as Tick;
		if (!tick)
			return false;
		
		const win = tokens.find(x => x.args[0] === tick.task_id) as PromiseTerm;
		const rest = tokens.filter(x => x.args[0] !== tick.task_id);

		if (tick.answer?.stdout)
			ctrl.stdout(tick.answer.stdout);
		if (tick.answer?.stderr)
			ctrl.stderr(tick.answer.stderr);

		if (!tick.answer || tick.answer.status === "failure")
			return false;
		if (tick.answer.status === "error")
			throw tick.answer.error;

		win.args[1] = tick.answer.goal;
		// tokens[i].args[2] = new Variable("_");
		goal.args[1] = win;
		goal.args[2] = rest;
		return goal;
	}
);

export const future_cancel_1 = new Predicate<Compound<Functor, [PromiseTerm]>>(
	"future_cancel", 1,
	function(pl, _subq, goal, _ctrl) {
		const token = goal.args[0];
		if (!isCompound(token, "$promise")) {
			throw type_error("promise", token, goal.pi);
		}
		const id = token.args[0];
		if (!isNumber(id)) {
			throw type_error("integer", token, goal.pi);
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

export const sys_await_all_1 = new Predicate<Compound<Functor, [PromiseTerm[]]>>(
	"$await_all", 1,
	async function(pl, _subq, goal, ctrl) {
		const tokens = goal.args[0];
		if (!isList(tokens)) {
			throw type_error("list", tokens, goal.pi);
		}
		for (const token of tokens) {
			if (!isCompound(token, "$promise")) {
				throw type_error("promise", token, goal.pi);
			}
			if (!isNumber(token.args[0])) {
				throw type_error("integer", token.args[0], goal.pi);
			}
		}
		const ps = tokens.map(token => {
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

			if (reply.answer?.stdout)
				ctrl.stdout(reply.answer.stdout);
			if (reply.answer?.stderr)
				ctrl.stderr(reply.answer.stderr);

			if (!reply.answer || reply.answer.status === "failure")
				return false;
			if (reply.answer.status === "error")
				throw reply.answer.error;

			tokens[i].args[1] = reply.answer.goal;
		}

		return goal;
	}
);
	
// TODO: let predicates be async generators?
// '$await_some'(Fs, Fs_OK, Fs_Done)
export const sys_await_some_3 = new Predicate<Compound<Functor, [PromiseTerm[], Variable|PromiseTerm[], PromiseTerm[]]>>(
	"$await_some", 3,
	async function(pl, _subq, goal, ctrl) {
		const tokens = goal.args[0];
		if (!isList(tokens)) {
			throw type_error("list", tokens, goal.pi);
		}
		for (const token of tokens) {
			if (!isCompound(token, "$promise")) {
				throw type_error("promise", token, goal.pi);
			}
			if (!isNumber(token.args[0])) {
				throw type_error("integer", token.args[0], goal.pi);
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
			const result = replies[i]?.answer;
			if (!reply) {
				done.push(tokens[i]);
				continue;
			}

			if (result?.status === "error") {
				throw result.error;
			} else if (!result || result?.status === "failure") {
				done.push(tokens[i]);
			} else if (result?.goal) {
				tokens[i].args[1] = result.goal;
				ok.push(tokens[i]);
			}

			if (reply.answer?.stdout)
				ctrl.stdout(reply.answer.stdout);
			if (reply.answer?.stderr)
				ctrl.stderr(reply.answer.stderr);
		}

		if (ok.length === 0)
			return false;
		
		goal.args[1] = ok;
		goal.args[2] = done;
		return goal;
	});

export function sys_missing_n(_pl: Prolog, _subq: Ptr<subquery_t>, goal: Goal) {
	throw existence_error("procedure", goal.pi, piTerm("host_rpc", 1));
}

export function throwTerm(ball: Term) {
	return new Compound("throw", [ball]);
}

export function type_error(type: string, value: Term, context: PredicateIndicator) {
	return new Compound("error", [new Compound("type_error", [type, value]), context]);
}

export function domain_error(type: string, value: Term, context: PredicateIndicator) {
	return new Compound("error", [new Compound("domain_error", [type, value]), context]);
}

export function existence_error(type: string, value: Term, context: PredicateIndicator) {
	return new Compound("error", [new Compound("existence_error", [type, value]), context]);
}

export function system_error(type: string, value: Term, context: PredicateIndicator) {
	return new Compound("error", [new Compound("system_error", [type, value]), context]);
}

export const LIBRARY: Predicate<any>[] = [
	sleep_1,
	delay_1,
	console_log_1,
	js_eval_2,
	js_eval_json_2,
	sys_await_some_3,
	future_2,
	sys_await_1,
	sys_await_all_1,
	await_any_3,
	future_cancel_1,
	// betwixt_3,
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
