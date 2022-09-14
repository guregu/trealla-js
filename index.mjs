import { init, WASI } from '@wasmer/wasi';

let tpl = null;

export async function load(module) {
	await init();
	tpl = module;
}

export async function loadFromWAPM(version) {
	await load(await WebAssembly.compileStreaming(
		fetch(`https://registry-cdn.wapm.io/contents/guregu/trealla/${version}/tpl.wasm`)));
}

export class Prolog {
	wasi;
	instance;
	n = 0;

	constructor() {
		this.wasi = newWASI();
	}

	async init(module = tpl) {
		if (!module) {
			throw new Error("trealla: uninitialized, call load first");
		}
		const imports = this.wasi.getImports(module);
		this.instance = await WebAssembly.instantiate(module, imports);
	}

	async query(goal, script) {
		const id = ++this.n;
		if (!this.instance) {
			await this.init();
		}
		let stdin = goal + "\n";
		let filename = null;
		if (script) {
			filename = `/lib/${id}.pl`;
			const file = this.fs.open(filename, { read: true, write: true, create: true });
			file.writeString(script);
			stdin = `consult('${filename}'),${stdin}`;
		}
		this.wasi.setStdinString(stdin);
		const _exit = this.wasi.start(this.instance);
		if (filename) {
			this.fs.removeFile(filename);
		}
		const stdout = this.wasi.getStdoutBuffer();
		const result = parseOutput(stdout);
		return result;
	}

	get fs() {
		return this.wasi.fs;
	}
}


function parseOutput(stdout) {
	const dec = new TextDecoder();
	const start = stdout.indexOf(2); // ASCII START OF TEXT
	const end = stdout.indexOf(3);   // ASCII END OF TEXT
	if (start === -1 || end === -1 || start > end) {
		throw Error("trealla: unexpected output: " + dec.decode(stdout));
	}
	let butt = stdout.indexOf(2, end+1);
	if (butt === -1) {
		butt = stdout.length;
	}

	const msg = JSON.parse(dec.decode(stdout.slice(end + 1, butt)));
	const result = {
		output: dec.decode(stdout.slice(start + 1, end)),
		...msg
	};

	return result;
}

const toplevel = `
:- module(js_toplevel, [js_toplevel/0, js_ask/1]).

:- use_module(library(lists)).
:- use_module(library(dcgs)).
:- use_module(library(json)).

js_toplevel :-
	getline(Line),
	js_ask(Line).

js_ask(Input) :-
	catch(
		read_term_from_chars(Input, Query, [variable_names(Vars)]),
		Error,
		(
			write('\\x2\\\\x3\\'),
			write_result(error, Error),
			flush_output
		)
	),
	query(Query, Vars, Status, Solutions),
	write_result(Status, Solutions),
	flush_output.

write_result(success, Solutions0) :-
	maplist(solution_json, Solutions0, Solutions),
	once(phrase(json_chars(pairs([
		string("result")-string("success"),
		string("answers")-list(Solutions)
	])), JSON)),
	maplist(write, JSON), nl.

write_result(failure, _) :-
	once(phrase(json_chars(pairs([
		string("result")-string("failure")
	])), JSON)),
	maplist(write, JSON), nl.

write_result(error, Error0) :-
	term_json(Error0, Error),
	once(phrase(json_chars(pairs([
		string("result")-string("error"),
		string("error")-Error
	])), JSON)),
	maplist(write, JSON), nl.

query(Query, Vars, Status, Solutions) :-
	( setup_call_cleanup(
		write('\\x2\\'), % START OF TEXT
		catch(bagof(Vars, call(Query), Solutions), Error, true),
		write('\\x3\\')  % END OF TEXT
	) -> OK = true
	  ;  OK = false
	),  
	query_status(OK, Error, Status),
	(  nonvar(Error)
	-> Solutions = Error
	;  true
	).

query_status(_OK, Error, error) :- nonvar(Error), !.
query_status(true, _, success).
query_status(false, _, failure).

solution_json(Vars0, pairs(Vars)) :- maplist(var_json, Vars0, Vars).

var_json(Var0=Value0, string(Var)-Value) :-
	atom_chars(Var0, Var),
	term_json(Value0, Value).

term_json(Value0, string(Value)) :-
	atom(Value0),
	atom_chars(Value0, Value),
	!.
term_json(Value, string(Value)) :-
	string(Value),
	!.
term_json(Value, number(Value)) :-
	number(Value),
	!.
term_json(Value0, list(Value)) :-
	is_list(Value0),
	maplist(term_json, Value0, Value),
	!.
term_json(Value, pairs([string("functor")-string(Functor), string("args")-list(Args)])) :-
	compound(Value),
	Value =.. [Functor0|Args0],
	atom_chars(Functor0, Functor),
	maplist(term_json, Args0, Args),
	!.
term_json(Value, pairs([string("var")-string("_")])) :-
	var(Value),
	!.
`;

function newWASI() {
	const wasi = new WASI({
		args: ["tpl", "--library", "/lib", "--ns", "-q", "-g", "use_module(library(toplevel)), js_toplevel"]
	});

	wasi.fs.createDir("/lib");
	const file = wasi.fs.open("/lib/toplevel.pl", { read: true, write: true, create: true });
	file.writeString(toplevel);

	return wasi;
}

