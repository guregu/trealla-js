/** Prolog atom term. */
export class Atom {
	functor;
	constructor(functor) {
		this.functor = functor;
	}
	get pi() { return `${this.functor}/0` };
	toProlog() {
		return escapeAtom(this.functor);
	}
	toString() { return this.toProlog(); }
}

/** Template string tag for making atoms. */
export function atom([functor]) {
	return new Atom(functor);
}

/** Prolog compound term. */
export class Compound {
	functor;
	args;
	constructor(functor, args) {
		this.functor = functor;
		this.args = args;
	}
	get pi() { return `${this.functor}/${this.args.length}` }
	toProlog() {
		return `${escapeAtom(this.functor)}(${this.args.map(toProlog).join(",")})`
	}
	toString() { return this.toProlog(); }
}

/** Prolog variable term. */
export class Variable {
	var;
	attr;
	constructor(name, attr) {
		this.var = name;
		this.attr = attr?.length > 0 ? attr : undefined;
	}
	toProlog() {
		if (this.attr?.length > 0) {
			return this.attr.map(x => x.toProlog()).join(",");
		}
		return `${this.var}`;
	}
	toString() { return this.toProlog(); }
}

/** Converts the given term object into Prolog text. */
export function toProlog(obj) {
	if (typeof obj === "number") return obj.toString();
	if (typeof obj === "bigint") return obj.toString();
	if (typeof obj === "string") return escapeString(obj);
	if (typeof obj?.toProlog === "function") return obj.toProlog();
	if (Array.isArray(obj)) {
		return `[${obj.map(toProlog).join(",")}]`;
	}
	throw new Error("trealla: can't convert object to Prolog term: " + obj);
}

export function escapeAtom(atom) {
	atom = atom.replaceAll("\\", "\\\\");
	atom = atom.replaceAll(`'`, `\\'`);
	return `'${atom}'`;
}

export function escapeString(str) {
	str = str.replaceAll("\\", "\\\\");
	str = str.replaceAll(`"`, `\\"`);
	return `"${str}"`;
}
