#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

function ShowUsage(unOutputDescriptor) {
	const strScriptPath = g_Path.relative(process.cwd(), __filename) || g_Path.basename(__filename);
	g_FileSystem.writeSync(unOutputDescriptor, `Usage: node "${strScriptPath}" [-h | --help]\n`);
	g_FileSystem.writeSync(unOutputDescriptor, "Run the bitbuffers documentation examples and local-link checks.\n");
}

if (process.argv.length > 2) {
	const vecArguments = process.argv.slice(2);
	if ((vecArguments.length === 1) && ((vecArguments[0] === "-h") || (vecArguments[0] === "--help"))) {
		ShowUsage(process.stdout.fd);
		process.exit(0);
	}

	g_FileSystem.writeSync(process.stderr.fd, "[ERROR] Unsupported bitbuffers documentation test arguments.\n");
	ShowUsage(process.stderr.fd);
	process.exit(2);
}

// Reuse the real mathlib fixture and TF2 native double without native memory access.
require("./smoke_bitbuffer_mathlib.js");

const g_unExpectedExampleCount = 83;
const g_unExpectedOutputCount = 91;
const g_unExampleTimeoutMilliseconds = 5000;
const g_strDocumentationPath = g_Path.resolve(__dirname, "../docs/api/bitbuffers.md");
const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecExamples = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)];
g_Assert.equal(g_vecExamples.length, g_unExpectedExampleCount);

let g_unOutputCount = 0;
for (let unExampleIndex = 0; unExampleIndex < g_vecExamples.length; unExampleIndex += 1) {
	const vecExample = g_vecExamples[unExampleIndex];
	let unExampleOutputCount = 0;
	const Context = g_VM.createContext({
		require,
		ArrayBuffer,
		Uint8Array,
		console: {
			log(...vecValues) {
				g_Assert.ok(vecValues.length > 0);
				unExampleOutputCount += 1;
			},
		},
	});
	const Script = new g_VM.Script(vecExample[1], { filename: `bitbuffers-doc-example-${unExampleIndex + 1}` });
	Script.runInContext(Context, { timeout: g_unExampleTimeoutMilliseconds });
	g_Assert.ok(unExampleOutputCount > 0, `Example must produce output: ${unExampleIndex + 1}`);
	g_unOutputCount += unExampleOutputCount;
}

g_Assert.equal(g_unOutputCount, g_unExpectedOutputCount);

const g_vecLinks = [...g_strDocumentation.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)];
for (const vecLink of g_vecLinks) {
	const strLink = vecLink[1].split("#")[0];
	if (!strLink || /^[a-z]+:/i.test(strLink)) {
		continue;
	}

	g_Assert.ok(g_FileSystem.existsSync(g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strLink)), `Missing file link: ${strLink}`);
}

console.log(`Bitbuffers documentation passed: ${g_vecExamples.length} examples, ${g_unOutputCount} output calls, and valid local file links; real wrappers/mathlib with a controlled TF2 native double, not native execution.`);
