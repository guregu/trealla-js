import { Prolog, JSONEncodingOptions, PrologEncodingOptions } from './prolog';
import { toProlog, escapeString, reviver, Termlike, isRational } from './term';

export interface Toplevel<T, Options> {
	/** Prepare query string, returns goal to execute. */
	query(pl: Prolog, goal: string, bind?: Record<string, Termlike>, options?: Options): string;
	/** Parse stdout and return an answer. */
	parse(pl: Prolog, status: boolean, stdout: Uint8Array, stderr: Uint8Array, options?: Options, answer?: string): T;
	/** Yield simple truth value, when output is blank.
		For queries such as `true.` and `1=2.`.
		Return null to bail early and yield no values. */
	truth(pl: Prolog, status: boolean, stderr: Uint8Array, options?: Options): T | null;
}

export const FORMATS = {
	json: {
		query: function (_: Prolog, query: string, bind: Record<string, Termlike>) {
			if (bind) query = bindVars(query, bind);
			return `wasm:js_ask(${escapeString(query)}).`;
		},
		parse: function (_pl: Prolog, _status: boolean, stdout: Uint8Array, stderr: Uint8Array, opts: JSONEncodingOptions, answer: string) {
			const dec = new TextDecoder();
			const json = answer;
			let msg;
			try {
				msg = JSON.parse(json, reviver(opts));
			} catch (ex) {
				console.error("Bad stdout:\n" + json);
				if (stderr?.length > 0) {
					console.warn("stderr:\n" + new TextDecoder().decode(stderr));
				}
				throw ex;
			}

			if (stdout?.byteLength > 0) {
				msg.stdout = dec.decode(stdout);
			}
			if (stderr?.byteLength > 0) {
				msg.stderr = dec.decode(stderr);
			}

			if (typeof msg?.answer?.__GOAL === "object") {
				msg.goal = msg.answer.__GOAL;
				delete msg.answer.__GOAL;
			}

			return msg;
		},
		truth: function () { return null; }
	},
	/*
	json_old: {
		query: function(_: Prolog, query: string, bind: Record<string, Termlike>) {
			if (bind) query = bindVars(query, bind);
			return `wasm:js_ask(${escapeString(query)}).`;
		},
		parse: function(_pl: Prolog, _status: boolean, stdout: Uint8Array, stderr: Uint8Array, opts: JSONEncodingOptions) {
			let start = stdout.indexOf(2);					// ASCII START OF TEXT
			const end = stdout.indexOf(3, start+1); 		// ASCII END OF TEXT
			const jsonStart = stdout.indexOf(123, end+1); 	// {
			let jsonEnd = stdout.indexOf(10, jsonStart+1); 	// LINE FEED
			if (jsonEnd === -1) {
				jsonEnd = stdout.lastIndexOf(125);			// }
			}

			// console.log("msg:", new TextDecoder().decode(stdout));

			const dec = new TextDecoder();
			const json = dec.decode(stdout.slice(jsonStart, jsonEnd));
			let msg;
			try {
				msg = JSON.parse(json, reviver(opts));
			} catch (ex) {
				console.error("Bad stdout:\n" + json);
				if (stderr?.length > 0) {
					console.warn("stderr:\n" + new TextDecoder().decode(stderr));
				}
				throw ex;
			}

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
			// if (typeof opts?.extra !== "undefined") {
			// 	msg.extra = opts.extra;
			// }

			return msg;
		},
		truth: function() { return null; }
	},
	*/
	prolog: {
		query: function(_: Prolog, query: string, bind: Record<string, Termlike>) {
			if (bind) query = bindVars(query, bind);
			return query;
		},
		parse: function(_: Prolog, _status: boolean, stdout: Uint8Array, stderr: Uint8Array, opts: PrologEncodingOptions) {
			const dec = new TextDecoder();
			if (stderr.byteLength > 0) {
				console.log(dec.decode(stderr));
			}
			if (opts?.dot === false && stdout[stdout.length-1] === 46) // '.'
				return dec.decode(stdout.subarray(0, stdout.length-1));
			return dec.decode(stdout);
		},
		truth: function(_: Prolog, status: boolean, stderr: Uint8Array, opts: PrologEncodingOptions) {
			if (stderr.byteLength > 0) {
				console.log(new TextDecoder().decode(stderr));
			}
			return (status ? "true" : "false") +
				(opts?.dot === false ? "" : ".");
		}
	}
};

function bindVars(query: string, bind: Record<string, Termlike>) {
	const vars = Object.entries(bind).map(([k, v]) => `${k} ${isRational(v) ? "is" : "="} ${toProlog(v)}`).join(", ");
	if (vars.length === 0) return query;
	return `${vars}, ${query}`;
}
