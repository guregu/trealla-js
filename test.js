import test from "node:test";
import assert from "node:assert";

import {Atom, Prolog, atom, load} from "./dist/trealla.js";

await test("load", async (t) => {
	await load();
});

test("example", async (t) => {
	const pl = new Prolog({
		library: "/lib", // optionally specify library directory ("/library" by default)
		env: {
			GREET: "greetings"
		}
	});

	await t.test("filesystem", async(t) => {
		const greeting_pl = `
			:- module(greeting, [hello/1]).
			:- dynamic(hello/1).
			hello(world).
			hello(世界).
		`;
		pl.fs.open("/greeting.pl", { write: true, create: true }).writeString(greeting_pl);

		const file = pl.fs.open("/greeting.pl", {create: false, write: false});
		assert.deepEqual(greeting_pl, file.readString());

		// custom library we can load from the use_module(library(...)) directive
		pl.fs.createDir("/lib");
		pl.fs.open("/lib/test.pl", { write: true, create: true }).writeString(`library(ok).`);
	});

	await t.test("consult", async (t) => {
		await pl.consult("greeting");
	});

	await t.test("readDir", async(t) => {
		const root = pl.fs.readDir(".").map(x => x.path);
		assert.deepEqual(["tmp", "greeting.pl", "lib"].sort(), root);

		const libdir = pl.fs.readDir("/lib").map(x => x.path);
		assert.deepEqual(["lib/test.pl"], libdir);
	});

	assert.deepEqual(
		await pl.queryOnce("user:assertz(lang(prolog)), greeting:assertz(hello('Welt'))."),
		{
			status: "success",
			answer: {},
		}
	);

	await t.test("vanilla toplevel", async (t) => {
		await expect(
			pl.query(
				`use_module(greeting), hello(Planet), lang(Lang), format("hello ~w from ~w!~n", [Planet, Lang]).`,
			),
			[
				{
					status: "success",
					answer: { Planet: atom`world`, Lang: atom`prolog` },
					stdout: "hello world from prolog!\n"
				},
				{
					status: "success",
					answer: { Planet: atom`世界`, Lang: atom`prolog` },
					stdout: "hello 世界 from prolog!\n"
				},
				{
					status: "success",
					answer: { Planet: atom`Welt`, Lang: atom`prolog` },
					stdout: "hello Welt from prolog!\n"
				},
			]
		);

		await t.test("atoms encoded to string option", async (t) => {
			await expect(
				pl.query(
					`use_module(greeting), hello(Planet), lang(Lang), format("hello ~w from ~w!~n", [Planet, Lang]).`,
					{encode: {atoms: "string"}}
				),
				[
					{
						status: "success",
						answer: { Planet: "world", Lang: "prolog" },
						stdout: "hello world from prolog!\n"
					},
					{
						status: "success",
						answer: { Planet: "世界", Lang: "prolog" },
						stdout: "hello 世界 from prolog!\n"
					},
					{
						status: "success",
						answer: { Planet: "Welt", Lang: "prolog" },
						stdout: "hello Welt from prolog!\n"
					},
				]
			);
		});
	});

	await t.test("raw prolog toplevel", async (t) => {
		await expect(
			pl.query(
				`use_module(greeting), hello(Planet), lang(Lang), format("hello ~w from ~w!~n", [Planet, Lang]).`,
				{format: "prolog"}
			),
			[
				"hello world from prolog!\nPlanet = world, Lang = prolog.",
				"hello 世界 from prolog!\nPlanet = 世界, Lang = prolog.",
				"hello Welt from prolog!\nPlanet = 'Welt', Lang = prolog.",
			]
		);
	});
});

// run q1 → q2 → q1 → q2 and ensure results are ok with interleaved iteration
test("concurrency", async (t) => {
	const pl = new Prolog();
	const q1 = pl.query("between(0,9,X).");
	const q2 = pl.query("between(10,19,N).");
	await q1.next();
	await q2.next();
	assert.deepEqual(
		(await q1.next()).value,
		{
			status: "success",
			answer: { X: 1 },
		},
	);
	assert.deepEqual(
		(await q2.next()).value,
		{
			status: "success",
			answer: { N: 11 },
		},
	);
	await q1.return();
	await q2.return();
});

test("bigint", async (t) => {
	const pl = new Prolog();
	const answer = await pl.queryOnce("X=9999999999999999, Y = -9999999999999999, Z = 123");
	assert.deepEqual(
		answer,
		{
			status: "success",
			answer: {
				X: BigInt("9999999999999999"),
				Y: BigInt("-9999999999999999"),
				Z: 123,
			}
		}
	);
});

test("library(clpz)", async (t) => {
	const pl = new Prolog();
	// Unfortunately, we need to load clpz in a separate query first to import the operators
	await pl.queryOnce("use_module(library(clpz)).");
	const answer = await pl.queryOnce("X #> 1, X #< 3.");
	assert.deepEqual(
		answer,
		{
			status: "success",
			answer: {
				X: 2
			}
		}
	);
});

test("atom template", async (t) => {
	assert.deepEqual(
		atom`hello`,
		new Atom("hello")
	);
	const planet = "world";
	assert.deepEqual(
		atom`hello ${planet}!`,
		new Atom("hello world!")
	);
});

test("json bools/null", async (t) => {
	const pl = new Prolog();
	const answer = await pl.queryOnce(`json_chars({"a": true, "b": false, "c": null, "d": []}, Cs).`);
	assert.deepEqual(
		answer,
		{
			status: "success",
			answer: {
				Cs: `{"a":true,"b":false,"c":null,"d":[]}`
			}
		}
	);
});

test("js_eval_json/2", async(t) => {
	const pl = new Prolog();
	await t.test("sync interop", async (t) => {
		await expect(
			pl.query(`use_module(library(dcgs)), use_module(library(format)), between(1,3,N), once(phrase(format_("return ~d;", [N]), JS)), js_eval_json(JS, Got)`, {format: "json"}),
			[
				{status: "success", answer: {N: 1, Got: "1", JS: "return 1;"}},
				{status: "success", answer: {N: 2, Got: "2", JS: "return 2;"}},
				{status: "success", answer: {N: 3, Got: "3", JS: "return 3;"}},
			]
		);
	});

	await t.test("async interop", async (t) => {
		await expect(
			pl.query(`use_module(library(dcgs)), use_module(library(format)), between(1,3,N), once(phrase(format_("return new Promise((resolve) => resolve(~w))", [N]), JS)), js_eval_json(JS, Got)`, {format: "json"}),
			[
				{status: "success", answer: {N: 1, Got: "1", JS: "return new Promise((resolve) => resolve(1))"}},
				{status: "success", answer: {N: 2, Got: "2", JS: "return new Promise((resolve) => resolve(2))"}},
				{status: "success", answer: {N: 3, Got: "3", JS: "return new Promise((resolve) => resolve(3))"}},
			]
		);
	})
});

test("memory usage", async(t) => {
	const pl = new Prolog();

	const work = async () => {
		for await (const ans of pl.query("write(stdout, abc), write(stderr, def), X=1 ; write(stdout, zzzzz), write(stderr, qqqqq), X=1 ; fail.")) {
			assert.equal(ans.answer.X, 1);
		}
		const size = pl.instance.exports.memory.buffer.byteLength;
		return size;
	}
	const base = await work();

	for (let i = 0; i < 1000; i++) {
		const size = await work();
		if (size > base) {
			console.log("too big", size, "vs", base);
		}
		assert.ok(size <= base);
	}
})

// @ts-ignore
async function expect(query, want) {
	const got = [];
	for await (const answer of query) {
		got.push(answer);
	}
	assert.deepEqual(got, want)
}
