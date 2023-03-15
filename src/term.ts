import { JSONEncodingOptions } from "./prolog";

export type Term = Atom | Compound | Variable | List | string | number | BigInt;

export type List = Term[];

export type Goal = Atom | Compound

/** Prolog atom term. */
export class Atom {
	functor: string;
	args: [] = [];
	constructor(functor: string) {
		this.functor = functor;
	}
	get pi() { return `${this.functor}/0` }
	get piTerm() { return piTerm(this.functor, 0) }
	toProlog() {
		return escapeAtom(this.functor);
	}
	toString() { return this.toProlog(); }
}

/** Template string tag for making atoms. */
export function atom([functor]:[string]) {
	return new Atom(functor);
}

export function Atomic(functor: string, args: Term[]) {
	if (args.length === 0)
		return new Atom(functor);
	return new Compound(functor, args as [Term, ...Term[]]);
}

/** Prolog compound term. */
export class Compound {
	functor: string;
	args: [Term, ...Term[]];
	constructor(functor: string, args: [Term, ...Term[]]) {
		this.functor = functor;
		this.args = args;
		if (typeof args?.length === "undefined")
			throw new Error("bad compound, not a list: " + functor);
	}
	get pi() { return `${this.functor}/${this.args.length}` }
	get piTerm() { return new Compound("/", [this.functor, this.args.length]) }
	toProlog() {
		if (this.args.length === 0)
			return escapeAtom(this.functor);
	
		if (this.args.length === 2 && (this.functor === ":" || this.functor === "/"))
			return `${toProlog(this.args[0])}${this.functor}${toProlog(this.args[1])}`;
	
		return `${escapeAtom(this.functor)}(${this.args.map(toProlog).join(",")})`
	}
	toString() { return this.toProlog(); }
}


export function isAtom(x: Term, name?: string): x is Atom {
	return x instanceof Atom &&
		(typeof name == "undefined" || x.functor == name) &&
		(!x.args?.length);
}

export function isCompound(x: Term, name?: string, arity?: number): x is Compound {
	return x instanceof Compound &&
		(typeof name == "undefined" || x.functor == name) &&
		(typeof arity == "undefined" || x.args.length == arity);
}

export function isList(x: Term): x is List {
	return Array.isArray(x);
}

export function isNumber(x: Term): x is number {
	return typeof x === "number";
}

export function isCallable(term: Term): term is Goal {
	return isAtom(term) || isCompound(term);
}

/** Prolog variable term. */
export class Variable {
	var: string;
	attr?: Term[];
	constructor(name: string, attr?: Term[]) {
		if (!validVar(name))
			throw new Error("trealla: invalid variable name: " + name);
		this.var = name;
		if (attr && attr?.length > 0)
			this.attr = attr;
	}
	toProlog() {
		if (this.attr?.length) {
			return this.attr.map(toProlog).join(",");
		}
		return `${this.var}`;
	}
	toString() { return this.toProlog(); }
}

export class Literal {
	value;
	constructor(value: string) {
		this.value = value;
	}
	toProlog() {
		return this.value;
	}
}

// TODO: this doesn't check for symbols, spaces, etc.
function validVar(name: unknown) {
	if (typeof name !== "string" || name.length === 0)
		return false;
	if (name[0] === "_")
		return true;
	if (name[0].toLowerCase() !== name[0])
		return true;
	return false;
}

export function piTerm(name: string, arity: number): Compound {
	return new Compound("/", [new Atom(name), arity]);
}

/** Converts the given term object into Prolog text. */
export function toProlog(obj: unknown): string {
	switch (typeof obj) {
	case "number":
		return obj.toString();
	case "bigint":
		return obj.toString();
	case "string":
		return escapeString(obj);
	case "boolean":
		return obj ? "{true}" : "{false}";
	case "undefined":
		return "{undefined}";
	case "object":
		break;
	default:
		throw new Error("trealla: can't convert object to Prolog term: " + obj);
	}

	if (obj === null)
		return "{null}";
	
	if ("toProlog" in obj && typeof obj.toProlog === "function")
		return obj.toProlog(); 

	if (Array.isArray(obj))
		return `[${obj.map(toProlog).join(",")}]`;

	throw new Error("trealla: can't convert object to Prolog term: " + obj);
}

// TODO: might be nice if escapeAtom could avoid the quoting when it can,
// but it is easier to just quote everything.
export function escapeAtom(atom: string) {
	return `'${atom
		.replaceAll("\\", "\\\\")
		.replaceAll(`'`, `\\'`)
		.replaceAll("\n", "\\n")
		.replaceAll("\t", "\\t")
	}'`;
}

export function escapeString(str: string) {
	return `"${str
		.replaceAll("\\", "\\\\")
		.replaceAll(`"`, `\\"`)
		.replaceAll("\n", "\\n")
		.replaceAll("\t", "\\t")
	}"`;
}

export function fromJSON(json: string, options: JSONEncodingOptions = {}): Term {
	return JSON.parse(json, reviver(options));
};

export function toJSON(term: Term, indent: string) {
	return JSON.stringify(term, function(_, v) {
		if (typeof v === "bigint")
			return {number: v.toString()};
		return v;
	}, indent)
}

export function reviver(opts: JSONEncodingOptions = {}) {
	const { atoms, strings, booleans, nulls, undefineds } = opts;
	return function(k: string, v: unknown) {
		if (v === null)
			return new Compound("{}", [new Atom("null")]);

		if (v && typeof v === "object" && "functor" in v) {
			const functor = (Array.isArray(v.functor) && v.functor.length === 0) ? "" : v.functor as string;
			// atoms
			if (!("args" in v) || !(v.args as Term[]).length) {
				switch (atoms) {
				case "string":
					return functor;
				default:
					return new Atom(functor);
				}
			}
			if ((booleans || nulls || undefineds) && typeof v === "object" && ("args" in v) &&
				Array.isArray(v.args) && v.args.length === 1) {
				const atom = typeof v.args[0] === "string" ? v.args[0] : v.args[0].functor;
				// booleans
				if (v.functor === booleans) {
					switch (atom) {
					case "true":
						return true;
					case "false":
						return false;
					}
				}
				// nulls
				if (v.functor === nulls && atom === "null") {
					return null;
				}
				// undefineds
				if (v.functor === undefineds && atom === "undefined") {
					return undefined;
				}
			}
			// compounds
			return new Compound(functor, (v as Compound).args);
		}
		if (typeof v === "object" && ("var" in v) && typeof v.var === "string") {
			return new Variable(v.var, (v as Variable).attr);
		}
		if (typeof v === "object" && ("number" in v) && typeof v.number === "string") {
			return BigInt(v.number);
		}
		// strings
		if (typeof v === "string" && k !== "result" && k !== "stdin" && k !== "stdout") {
			switch (strings) {
			case "list":
				return v.split("").map(char => new Atom(char));
			case "string":
				return v;
			}
		}
		return v;
	}
}
