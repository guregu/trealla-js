export const FORMATS = {
	json: {
		query: function(_, query) {
			return `js_ask("${escapeString(query)}").`;
		},
		parse: parseJSON,
		truth: function() { return null; }
	},
	prolog: {
		query: function(_, query) { return query },
		parse: function(_, _status, stdout, stderr, opts) {
			const dec = new TextDecoder();
			if (stderr.byteLength > 0) {
				console.log(dec.decode(stderr));
			}
			if (opts?.dot === false && stdout[stdout.length-1] === 46) // '.'
				return dec.decode(stdout.subarray(0, stdout.length-1));
			return dec.decode(stdout);
		},
		truth: function(_, status, stderr, opts) {
			if (stderr.byteLength > 0) {
				console.log(new TextDecoder().decode(stderr));
			}
			return (status ? "true" : "false") +
				(opts?.dot === false ? "" : ".");
		}
	}
};

function parseJSON(_pl, _status, stdout, stderr, opts) {
	const dec = new TextDecoder();
	let start = stdout.indexOf(2); // ASCII START OF TEXT
	const end = stdout.indexOf(3); // ASCII END OF TEXT
	if (start > end) {
		start = -1;
	}
	const nl = stdout.indexOf(10, end+1); // LINE FEED
	const butt = nl >= 0 ? nl : stdout.length;
	const json = dec.decode(stdout.slice(end + 1, butt));
	const msg = JSON.parse(json, reviver(opts));
	if (start + 1 !== end) {
		msg.stdout = dec.decode(stdout.slice(start + 1, end));
	}
	if (stderr.byteLength > 0) {
		msg.stderr = dec.decode(stderr);
	}
	return msg;
}

function reviver(opts) {
	if (!opts) return undefined;
	const { atoms, strings, booleans, nulls, undefineds } = opts;
	return function(k, v) {
		if (typeof v === "object" && typeof v.functor === "string") {
			// atoms
			if (!v.args || v.args.length === 0) {
				switch (atoms) {
				case "string":
					return v.functor;
				case "object":
					return v;
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
		}
		// strings
		if (typeof v === "string" && k !== "result" && k !== "output") {
			switch (strings) {
			case "list":
				return v.split("");
			case "string":
				return v;
			}
		}
		return v;
	}
}

function escapeString(query) {
	query = query.replaceAll("\\", "\\\\");
	query = query.replaceAll(`"`, `\\"`);
	return query;
}
