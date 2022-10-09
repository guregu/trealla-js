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
		if (!validVar(name))
			throw new Error("trealla: invalid variable name: " + name);
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

function validVar(name) {
	if (typeof name !== "string" || name.length === 0)
		return false;
	if (name[0] === "_")
		return true;
	if (name[0].toLowerCase() !== name[0])
		return true;
	return false;
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
	return `'${atom.replaceAll("\\", "\\\\").replaceAll(`'`, `\\'`)}'`;
}

export function escapeString(str) {
	return `"${str.replaceAll("\\", "\\\\").replaceAll(`"`, `\\"`)}"`;
}

export function fromJSON(json, options) {
	return JSON.parse(json, reviver(options));
};

export function reviver(opts = {}) {
	const { atoms, strings, booleans, nulls, undefineds } = opts;
	return function(k, v) {
		if (typeof v === "object" && typeof v.functor === "string") {
			// atoms
			if (!v.args || v.args.length === 0) {
				switch (atoms) {
				case "string":
					return v.functor;
				default:
					return new Atom(v.functor);
				}
			}
			if ((booleans || nulls || undefineds) &&  typeof v === "object" && v.args?.length === 1) {
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
			return new Compound(v.functor, v.args);
		}
		if (typeof v === "object" && typeof v.var === "string") {
			return new Variable(v.var, v.attr);
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
