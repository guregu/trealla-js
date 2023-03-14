import { Compound, Atom, Variable, toProlog, fromJSON, piTerm } from './term';

export class Predicate {
	name;
	arity;
	fn;
	constructor(name, arity, fn) {
		this.name = name;
		this.arity = arity;
		this.fn = fn;
	}

	call(pl, subquery, goal) {
		return this.fn(pl, subquery, goal);
	}

	shim() {
		const args = [];
		for (let i = 0; i < this.arity; i++) {
			args.push(new Variable(`_${i}`));
		}
		const head = new Compound(this.name, args);
		return `${head.toProlog()} :- host_rpc(${head.toProlog()}). `;
	}

	get pi() {
		return `${this.name}/${this.arity}`;
	}
	get piTerm() {
		return piTerm(this.name, this.arity);
	}
}

export const sleep_1 = new Predicate(
	"sleep", 1,
	async function(_pl, _subquery, goal) {
		const time = goal.args[0];
		if (typeof time !== "number")
			return throwTerm(type_error("number", time, goal.piTerm));
		if (time < 0)
			return throwTerm(domain_error("not_less_than_zero", time, goal.piTerm));

		await new Promise(resolve => setTimeout(resolve, time * 1000));
		return true_0;
	});

export const delay_1 = new Predicate(
	"delay", 1,
	async function(_pl, _subquery, goal) {
		const time = goal.args[0];
		if (typeof time !== "number")
			return throwTerm(type_error("number", time, goal.piTerm));
		if (time < 0)
			return throwTerm(domain_error("not_less_than_zero", time, goal.piTerm));
	
		await new Promise(resolve => setTimeout(resolve, time));
		return true_0;
	});

export const console_log_1 = new Predicate(
	"console_log", 1,
	function(_pl, _subquery, goal) {
		console.log(goal.args[0]);
		return true_0;
	});

export const js_eval_2 = new Predicate(
	"js_eval", 2,
	async function(pl, subquery, goal) {
		const expr = goal.args[0];
		if (typeof expr !== "string")
			return throwTerm(type_error("chars", expr, goal.piTerm));

		let value;
		try {
			value = await js_eval(pl, subquery, goal, expr);
		} catch (error) {
			console.error(error);
			return throwTerm(system_error("js_exception", error.toString(), goal.piTerm)).toProlog();
		}

		if (!value)
			return true_0;

		return new Compound(goal.functor, [goal.args[0], value]);
	});

async function js_eval(pl, subquery, goal, expr) {
	if (typeof expr !== "string")
		return throwTerm(type_error("chars", expr, goal.piTerm));

	let value = new Function('pl', 'subquery', 'goal', 'trealla', expr)(pl, subquery, goal, EVAL_BINDINGS);

	if (value instanceof Promise)
		value = await value;

	return value;
}

// export const task_1 = new Predicate(
// 	"task", 1,
// 	function(pl, subq, goal) {
// 		const call = goal.args[0];
// 		if (!isCallable(call))
// 			return throwTerm(type_error("callable", call, goal.piTerm));

// 		const task = pl.query(goal.args[0].toProlog());
// 		pl.addTask(task);
// 		return true_0;
// 	});

export const future_2 = new Predicate(
	"future", 2,
	function(pl, subq, goal) {
		const call = goal.args[0];
		if (!isCallable(call))
			return throwTerm(type_error("callable", call, goal.piTerm));

		const goalvar = new Variable("__GOAL");
		const ask = new Compound(",", [new Compound("=", [goalvar, goal.args[0]]), goalvar]);
		const task = pl.query(ask.toProlog(), {wrap: true});
		const id = pl.addTask(task);
		const promise = new Compound("$promise", [id, goal.args[0]]);
		return new Compound(goal.functor, [goal.args[0], promise]);
	}
);

export const sys_await_1 = new Predicate(
	"$await", 1,
	async function(pl, subq, goal, ctrl) {
		const token = goal.args[0];
		if (token.functor !== "$promise") {
			return throwTerm(type_error("promise", token, goal.piTerm));
		}
		const id = token.args[0];
		const task = pl.tasks.get(id);
		if (!task) {
			return fail_0;
		}

		const reply = await pl.tickTask(task);
		if (!reply) {
			return fail_0;
		}

		if (reply.result.stdout)
			ctrl.stdout(reply.result.stdout);
		if (reply.result.stderr)
			ctrl.stderr(reply.result.stderr);

		// TODO: change to .status...
		if (reply.result.result === "failure")
			return fail_0;
		if (reply.result.result === "error")
			return throwTerm(reply.result.error);

		goal.args[0].args[1] = reply.result.goal;
		return goal;
	}
);

export const await_any_3 = new Predicate(
	// '$await_any'(Ps, Winner, Rest)
	"await_any", 3,
	async function(pl, subq, goal, ctrl) {
		const tokens = goal.args[0];
		const ticks = tokens.map(token => {
			if (token.functor !== "$promise") {
				return {
					result: {
						result: "error",
						error: type_error("promise", token, goal.piTerm)
					}
				};
			}
			const id = token.args[0];
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
		const reply = await Promise.any(ps);
		if (!reply)
			return fail_0;
		
		const win = tokens.find(x => x.args[0] === reply.task_id);
		const rest = tokens.filter(x => x.args[0] !== reply.task_id);

		if (reply.result.stdout)
			ctrl.stdout(reply.result.stdout);
		if (reply.result.stderr)
			ctrl.stderr(reply.result.stderr);

		if (reply.result.result === "failure")
			return fail_0;
		if (reply.result.result === "error")
			return throwTerm(reply.result.error);

		win.args[1] = reply.result.goal;
		// tokens[i].args[2] = new Variable("_");
		goal.args[1] = win;
		goal.args[2] = rest;
		return goal;
	}
);

/*
	'$promise'(ID, Tmpl, Goal)
*/

export const promise_cancel_1 = new Predicate(
	"promise_cancel", 1,
	function(pl, subq, goal, ctrl) {
		const token = goal.args[0];
		if (token.functor !== "$promise") {
			return throwTerm(type_error("promise", token, goal.piTerm));
		}
		const id = token.args[0];
		const task = pl.tasks.get(id);
		if (!task) {
			return true_0;
		}
		if (task.cancel === null && task.promise === null) {
			task.query.return();
			return true_0;
		}
		task.cancel();
		// TODO: interrupt canceled task interpreter
		return true_0;
	}
);

export const sys_await_all_1 = new Predicate(
	"$await_all", 1,
	async function(pl, subq, goal, ctrl) {
		const tokens = goal.args[0];
		const ps = tokens.map(token => {
			if (token.functor !== "$promise") {
				return {result: {
					result: "error",
					error: type_error("promise", token, goal.piTerm)
				}};
			}
			const id = token.args[0];
			const task = pl.tasks.get(id);
			if (!task) return;
			return pl.tickTask(task);
		});
		const replies = await Promise.all(ps);
		for (let i = 0; i < replies.length; i++) {
			const reply = replies[i];
			if (!reply)
				return fail_0;

			if (reply.result.stdout)
				ctrl.stdout(reply.result.stdout);
			if (reply.result.stderr)
				ctrl.stderr(reply.result.stderr);

			if (reply.result.result === "failure")
				return fail_0;
			if (reply.result.result === "error")
				return throwTerm(reply.result.error);

			tokens[i].args[1] = reply.result.goal;
		}

		return goal;
	}
);
	
// TODO: let predicates be async generators?
// '$await_some'(Fs, Fs_OK, Fs_Done)
export const sys_await_some_3 = new Predicate(
		"$await_some", 3,
		async function(pl, subq, goal, ctrl) {
			const tokens = goal.args[0];
			const ps = tokens.map(token => {
				if (token.functor !== "$promise") {
					return {result: {
						result: "error",
						error: type_error("promise", token, goal.piTerm)
					}};
				}
				const id = token.args[0];
				const task = pl.tasks.get(id);
				if (!task) return;
				return pl.tickTask(task);
			});
			const replies = await Promise.all(ps);

			if (replies.length === 0)
				return fail_0;

			const ok = [];
			const done = [];
			for (let i = 0; i < replies.length; i++) {
				const reply = replies[i];
				const result = replies[i]?.result;
				if (!reply) {
					done.push(goal.args[0][i]);
					continue;
				}

				if (result?.result === "error") {
					return throwTerm(result.error);
				} else if (result?.result === "failure") {
					done.push(goal.args[0][i]);
				} else {
					ok.push(goal.args[0][i]);
					goal.args[0][i].args[1] = result.goal;
				}

				if (reply.result.stdout)
					ctrl.stdout(reply.result.stdout);
				if (reply.result.stderr)
					ctrl.stderr(reply.result.stderr);
			}

			if (ok.length === 0)
				return fail_0;
			
			goal.args[1] = ok;
			goal.args[2] = done;
			return goal;
		});

export function sys_missing_n(_pl, _subq, goal) {
	return throwTerm(existence_error("procedure", goal.piTerm, piTerm("host_rpc", 1)))
}

export function throwTerm(ball) {
	return new Compound("throw", [ball]);
}

export function type_error(type, value, context) {
	return new Compound("error", [new Compound("type_error", [type, value]), context]);
}

export function domain_error(type, value, context) {
	return new Compound("error", [new Compound("domain_error", [type, value]), context]);
}

export function existence_error(type, value, context) {
	return new Compound("error", [new Compound("existence_error", [type, value]), context]);
}

export function system_error(type, value, context) {
	return new Compound("error", [new Compound("system_error", [type, value]), context]);
}

function isCallable(term) {
	return (term instanceof Atom || term instanceof Compound);
}

export const LIBRARY = [
	sleep_1,
	delay_1,
	console_log_1,
	js_eval_2,
	// task_1,
	sys_await_some_3,
	future_2,
	sys_await_1,
	sys_await_all_1,
	await_any_3,
	promise_cancel_1
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
