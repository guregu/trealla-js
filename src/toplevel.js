import { toProlog, escapeString, reviver } from './term';

export const FORMATS = {
	json: {
		query: function(_, query, bind) {
			if (bind) query = bindVars(query, bind);
			return `js_ask(${escapeString(query)}).`;
		},
		parse: function(_pl, _status, stdout, stderr, opts) {
			let start = stdout.indexOf(2);					// ASCII START OF TEXT
			const end = stdout.indexOf(3, start+1); 		// ASCII END OF TEXT
			const jsonStart = stdout.indexOf(123, end+1); 	// {
			let jsonEnd = stdout.indexOf(10, jsonStart+1); 	// LINE FEED
			if (jsonEnd === -1) {
				jsonEnd = stdout.lastIndexOf(125);			// }
			}

			const dec = new TextDecoder();
			const json = dec.decode(stdout.slice(jsonStart, jsonEnd));
			const msg = JSON.parse(json, reviver(opts));

			if (start + 1 !== end) {
				msg.stdout = dec.decode(stdout.slice(start + 1, end));
			}

			if (stderr.byteLength > 0) {
				msg.stderr = dec.decode(stderr);
			}

			if (typeof msg?.answer?.__GOAL === "object") {
				msg.goal = msg.answer.__GOAL;
				delete msg.answer.__GOAL;
			}
			if (typeof opts?.extra !== "undefined") {
				msg.extra = opts.extra;
			}

			return msg;
		},
		truth: function() { return null; }
	},
	prolog: {
		query: function(_, query, bind) {
			if (bind) query = bindVars(query, bind);
			return query;
		},
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

function bindVars(query, bind) {
	const vars = Object.entries(bind).map(([k, v]) => `${k} = ${toProlog(v)}`).join(", ");
	if (vars.length === 0) return query;
	return `${vars}, ${query}`;
}
