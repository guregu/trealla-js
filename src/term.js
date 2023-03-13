/** Prolog atom term. */
export class Atom {
	functor;
	constructor(functor) {
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

export function piTerm(name, arity) {
	return new Compound("/", [new Atom(name), arity]);
}

/** Converts the given term object into Prolog text. */
export function toProlog(obj) {
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
	}
	
	if (typeof obj?.toProlog === "function")
		return obj.toProlog();

	if (obj === null)
		return "{null}";

	if (Array.isArray(obj))
		return `[${obj.map(toProlog).join(",")}]`;

	throw new Error("trealla: can't convert object to Prolog term: " + obj);
}

// TODO: might be nice if escapeAtom could avoid the quoting when it can,
// but it is easier to just quote everything.
export function escapeAtom(atom) {
	return `'${atom
		.replaceAll("\\", "\\\\")
		.replaceAll(`'`, `\\'`)
		.replaceAll("\n", "\\n")
		.replaceAll("\t", "\\t")
	}'`;
}

export function escapeString(str) {
	return `"${str
		.replaceAll("\\", "\\\\")
		.replaceAll(`"`, `\\"`)
		.replaceAll("\n", "\\n")
		.replaceAll("\t", "\\t")
	}"`;
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
