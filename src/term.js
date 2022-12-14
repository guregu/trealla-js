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
		if (attr?.length > 0)
			this.attr = attr;
	}
	toProlog() {
		if (this.attr?.length > 0) {
			return this.attr.map(toProlog).join(",");
		}
		return `${this.var}`;
	}
	toString() { return this.toProlog(); }
}

// TODO: this doesn't check for symbols, spaces, etc.
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

// TODO: might be nice if escapeAtom could avoid the quoting when it can,
// but it is easier to just quote everything.
export function escapeAtom(atom) {
	return `'${atom.replaceAll("\\", "\\\\").replaceAll(`'`, `\\'`)}'`;
}

export function escapeString(str) {
	return `"${str.replaceAll("\\", "\\\\").replaceAll(`"`, `\\"`)}"`;
}

export function fromJSON(json, options) {
	return JSON.parse(json, reviver(options));
};

export function toJSON(term, indent) {
	return JSON.stringify(term, function(_, v) {
		if (typeof v === "bigint")
			return {number: v.toString()};
		return v;
	}, indent)
}

export function reviver(opts = {}) {
	const { atoms, strings, booleans, nulls, undefineds } = opts;
	return function(k, v) {
		if (typeof v === "object" && typeof v.functor !== "undefined") {
			const functor = (Array.isArray(v.functor) && v.functor.length === 0) ? "" : v.functor;
			// atoms
			if (!v.args || v.args.length === 0) {
				switch (atoms) {
				case "string":
					return functor;
				default:
					return new Atom(functor);
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
			return new Compound(functor, v.args);
		}
		if (typeof v === "object" && typeof v.var === "string") {
			return new Variable(v.var, v.attr);
		}
		if (typeof v === "object" && typeof v.number === "string") {
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
