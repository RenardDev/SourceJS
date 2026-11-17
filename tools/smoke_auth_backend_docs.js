#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

function ShowUsage(unOutputDescriptor) {
	const strScriptPath = g_Path.relative(process.cwd(), __filename) || g_Path.basename(__filename);
	g_FileSystem.writeSync(unOutputDescriptor, `Usage: node "${strScriptPath}" [-h | --help]\n`);
	g_FileSystem.writeSync(unOutputDescriptor, "Run the auth backend documentation examples and argument checks.\n");
}

if (process.argv.length > 2) {
	const vecArguments = process.argv.slice(2);
	if ((vecArguments.length === 1) && ((vecArguments[0] === "-h") || (vecArguments[0] === "--help"))) {
		ShowUsage(process.stdout.fd);
		process.exit(0);
	}

	g_FileSystem.writeSync(process.stderr.fd, "[ERROR] Unsupported auth backend documentation test arguments.\n");
	ShowUsage(process.stderr.fd);
	process.exit(2);
}

const { Backend } = require("../packages/sourcejs/auth/index.js");

const g_unDocumentationTimeoutMilliseconds = 5000;
const g_strDocumentationPath = g_Path.join(__dirname, "../docs/api/auth-backend.md");
const g_strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecExamples = Array.from(g_strDocumentationSource.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);

// Only the detached parent Name is consumed here; real manager behavior is
// covered by smoke_auth_manager.js and smoke_auth_store.js, not by this double.
class DocumentationParentPermissions {
	constructor(strName) {
		this.Name = strName;
	}
}

function CreateDocumentationContext(vecLogEntries, vecErrors) {
	return g_VM.createContext({
		console: {
			log(...vecValues) {
				vecLogEntries.push(vecValues);
			},
			error(OperationError) {
				vecErrors.push(OperationError);
			},
		},
		require(strRequest) {
			if (strRequest === "auth/index") {
				return { Backend };
			}

			if (strRequest === "auth/manager") {
				return { ParentPermissions: DocumentationParentPermissions };
			}

			throw new Error(`Unexpected documentation import: ${strRequest}`);
		},
	});
}

function VerifyRejectedArguments(BackendInstance, vecMethodRecords, vecLogEntries) {
	const unInitialLogCount = vecLogEntries.length;
	let unCallbackCount = 0;
	const Callback = () => {
		unCallbackCount += 1;
	};

	const vecInvalidOptions = [undefined, null, [], false, 3, 1n, Symbol("Options"), "options", Callback];
	const vecInvalidCallbacks = [undefined, null, [], {}, false, 3, 1n, Symbol("Callback"), "callback"];
	for (const MethodRecord of vecMethodRecords) {
		for (const InvalidOptions of vecInvalidOptions) {
			g_Assert.throws(() => BackendInstance[MethodRecord.Name](...MethodRecord.Arguments, InvalidOptions, Callback), /options object/, `${MethodRecord.Name}: invalid options`);
		}

		for (const InvalidCallback of vecInvalidCallbacks) {
			g_Assert.throws(() => BackendInstance[MethodRecord.Name](...MethodRecord.Arguments, {}, InvalidCallback), /callback function/, `${MethodRecord.Name}: invalid callback`);
		}
	}

	g_Assert.equal(unCallbackCount, 0, "rejected operations do not call a callback");
	g_Assert.equal(vecLogEntries.length, unInitialLogCount, "rejected operations do not log an event");
	g_Assert.equal(BackendInstance.Loaded, false, "rejected operations leave the unloaded state unchanged");

	return (vecInvalidOptions.length + vecInvalidCallbacks.length) * vecMethodRecords.length;
}

async function RunDocumentationChecks() {
	g_Assert.equal(g_vecExamples.length, 3, "all import and standalone examples are exercised");

	let unInvalidArgumentCaseCount = 0;
	for (let unExampleIndex = 0; unExampleIndex < g_vecExamples.length; unExampleIndex += 1) {
		const vecLogEntries = [];
		const vecErrors = [];
		const Context = CreateDocumentationContext(vecLogEntries, vecErrors);
		await g_VM.runInContext(g_vecExamples[unExampleIndex], Context, { filename: g_strDocumentationPath });
		g_Assert.equal(vecErrors.length, 0, "example completion does not hide a rejected operation");

		if (unExampleIndex === 0) {
			g_Assert.equal(g_VM.runInContext("Backend", Context), Backend);
			continue;
		}

		const bAuditExample = unExampleIndex === 2;
		const BackendInstance = g_VM.runInContext(bAuditExample ? "g_Audit" : "g_BackendInstance", Context);
		g_Assert.equal(BackendInstance.Loaded, false, "the example completes Unload");
		g_Assert.equal(BackendInstance.Name, bAuditExample ? "audit" : "memory");

		const vecMethodRecords = [{ Name: "Synchronize", Arguments: [] }];
		if (bAuditExample) {
			const Parent = g_VM.runInContext("g_mapParent", Context);
			vecMethodRecords.push(
				{ Name: "PermissionAdded", Arguments: [Parent, "sourcejs.test", 1] },
				{ Name: "PermissionRemoved", Arguments: [Parent, "sourcejs.test", 1] },
				{ Name: "ParentAdded", Arguments: [Parent, "guest"] },
				{ Name: "ParentRemoved", Arguments: [Parent, "guest"] },
			);
			g_Assert.equal(vecLogEntries.length, 4, "all four notification overrides execute once");
			g_Assert(vecLogEntries.every((vecEntry) => vecEntry[0] === "moderator"));
		} else {
			g_Assert.equal(BackendInstance.Options.Label, "example");
			g_Assert.equal(vecLogEntries.length, 2, "the memory example logs its state and synchronized records");
		}

		unInvalidArgumentCaseCount += VerifyRejectedArguments(BackendInstance, vecMethodRecords, vecLogEntries);
	}

	console.log(`Auth backend documentation PASS; real base class, controlled detached-parent double, ${unInvalidArgumentCaseCount} invalid-argument cases; no native IO.`);
}

// A pending Promise alone cannot keep Node alive or prove the checks completed.
const g_DeadlineTimer = setTimeout(() => {
	console.error(new Error(`Auth backend documentation did not complete within ${g_unDocumentationTimeoutMilliseconds} ms.`));
	process.exitCode = 1;
}, g_unDocumentationTimeoutMilliseconds);

RunDocumentationChecks().catch((OperationError) => {
	console.error(OperationError);
	process.exitCode = 1;
}).finally(() => {
	clearTimeout(g_DeadlineTimer);
});
