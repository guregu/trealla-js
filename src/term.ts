import { JSONEncodingOptions } from "./prolog";

export type Term = Atom | Compound<Functor, Args> | Variable | List | string | Numeric | Rational;
export type Numeric = number | bigint;
export type List = Term[];
export type Functor = string;

export type Args = [Term, ...Term[]];
export type Goal = Atom | Compound<Functor, Args>;
export type PredicateIndicator = Compound<"/", [Atom, number]>;

/** Terms or objects that encode into terms. Uint8Array becomes a Prolog string. */
export type Termlike = | Term | Literal | Uint8Array | { toProlog: () => string };

/** Prolog atom term. */
export class Atom<Text extends string = string> {
	/** Value of the atom. */
	functor: Text;
	args: [] = [];
	constructor(functor: Text) {
		this.functor = functor;
	}
	/** Value of the atom. */
	// TODO: change `functor` to just `value`, here is for backwards compatibility
	get value() { return this.functor; }
	set value(v: Text) { this.functor = v; }
	get pi() { return piTerm(this.functor, 0) }
	toProlog() {
		return escapeAtom(this.functor);
	}
	toString() { return this.toProlog(); }
}

/** Template string tag for making atoms. */
export function atom(text: TemplateStringsArray, ...values: (string|number|bigint)[]) {
	let functor = "";
	for (let i = 0; i < text.length; i++){
		functor += text[i];
		if (i < values.length){
			functor += values[i];
		}
	}
	return new Atom(functor);
}

/** Template literal function for escaping Prolog text. `${values}` will be interpreted as Prolog terms. */
export function prolog(text: TemplateStringsArray, ...values: Termlike[]) {
	let str = "";
	for (let i = 0; i < text.length; i++) {
		str += text[i];
		if (values[i]) str += toProlog(values[i]);
	}
	return str;
}

export function Atomic(functor: string, args: Term[]): typeof args extends Args ? Compound<typeof functor, typeof args> : Atom;
export function Atomic(functor: string, args: []): Atom;
export function Atomic(functor: string, args: Term[]) {
	if (!args || args.length === 0)
		return new Atom(functor);
	return new Compound(functor, args as Args);
}

/** Prolog compound term. */
export class Compound<Functor extends string, Arguments extends Args> {
	functor: Functor;
	args: Arguments;
	constructor(functor: Functor, args: Arguments) {
		this.functor = functor;
		this.args = args;
		if (typeof args?.length === "undefined")
			throw new Error("bad compound, not a list: " + functor);
	}
	get pi() {
		return piTerm(this.functor, this.args.length)
	}
	toProlog() {
		if (this.args.length === 0)
			return escapeAtom(this.functor);

		if (this.args.length === 2 && (this.functor === ":" || this.functor === "/"))
			return `${toProlog(this.args[0])}${this.functor}${toProlog(this.args[1])}`;

		return `${escapeAtom(this.functor)}(${this.args.map(toProlog).join(",")})`
	}
	toString() { return this.toProlog(); }
}

/** Prolog rational term. */
export class Rational {
	numerator: Numeric;
	denominator: Numeric;
	constructor(numerator: Numeric, denominator: Numeric) {
		this.numerator = numerator;
		this.denominator = denominator;
	}
	toProlog() {
		return `${this.numerator} rdiv ${this.denominator}`;
	}
	toString() {
		return `${this.numerator}/${this.denominator}`;
	}
}

export function isAtom(x: unknown, name?: string): x is Atom {
	return x instanceof Atom &&
		(typeof name == "undefined" || x.functor == name) &&
		(!x.args?.length);
}

export function isCompound<F extends string>(x: unknown, name?: F, arity?: number): x is Compound<F, Args> {
	return x instanceof Compound &&
		(typeof name === "undefined" || x.functor === name) &&
		(typeof arity === "undefined" || x.args.length === arity);
}

export function isList(x: unknown): x is List {
	return Array.isArray(x) && x.every(isTerm);
}

export function isNumber(x: unknown): x is Numeric {
	return typeof x === "number" || typeof x === "bigint";
}

export function isRational(x: unknown): x is Rational {
	return x instanceof Rational;
}

export function isString(x: unknown): x is string {
	return typeof x === "string";
}

export function isCallable(term: unknown): term is Goal {
	return isAtom(term) || isCompound(term);
}

export function isVariable(term: unknown): term is Variable {
	return term instanceof Variable;
}

export function isTerm(term: unknown): term is Term {
	switch (typeof term) {
	case "number":
	case "bigint":
	case "string":
		return true;
	}
	return isAtom(term) || isCompound(term) || isList(term) || isVariable(term) || isRational(term);
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

export function piTerm<const P extends string, const N extends number>(name: P, arity: N): Compound<'/', [Atom<P>, N]> {
	return new Compound("/", [new Atom(name), arity]);
}

/** Converts the given term object into Prolog text. */
export function toProlog(obj: unknown): string {
	switch (typeof obj) {
	case "number":
		const str = obj.toString();
		const eidx = str.indexOf("e");
		if (eidx === -1 || str.includes(".")) {
			return str;
		}
		// Prolog won't accept numbers like "1e100", wants "1.0e100" instead
		// See: https://github.com/guregu/trealla-js/issues/44
		return `${str.slice(0, eidx)}.0${str.slice(eidx)}`;
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

	if (obj instanceof Uint8Array)
		return escapeString(new TextDecoder().decode(obj));

	if (Array.isArray(obj))
		return `[${obj.map(toProlog).join(",")}]`;

	throw new Error("trealla: can't convert object to Prolog term: " + obj);
}

function needsEscape(atom: string) {
	if (atom.length === 0) {
		return true;
	}
	let code = atom.charCodeAt(0);
	if (!(code >= 97 && code <= 122)) {
		return true;
	}
	for (let i = 1; i < atom.length; i++) {
		code = atom.charCodeAt(i);
		if ((code >= 97 && code <= 122)	/* a-z */ ||
				(code >= 65 && code <= 90)	/* A-Z */ ||
				(code >= 48 && code <= 57)	/* 0-9 */ ||
				code === 95) /* _ */ {
				continue;
		}
		return true;
	}
	return false;
}

export function escapeAtom(atom: string) {
	if (!needsEscape(atom))
		return atom;

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
			return new Compound(functor, (v as Compound<Functor, Args>).args);
		}
		if (typeof v === "object" && ("var" in v) && typeof v.var === "string") {
			return new Variable(v.var, (v as Variable).attr);
		}
		if (typeof v === "object" && ("numerator" in v) && ("denominator" in v)) {
			if (!isNumber(v.numerator) || !isNumber(v.denominator)) {
				throw new Error(`invalid rational: ${JSON.stringify(v)}`);
			}
			return new Rational(v.numerator, v.denominator);
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
