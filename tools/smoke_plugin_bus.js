#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strBusPath = g_Path.join(g_strPackageRootPath, "plugins", "bus.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "plugins-bus.md");
const g_mapListenerCallbacks = new Map();
const g_vecSerializedPayloads = [];
const g_mapOriginalEnvelopeMetadataDescriptors = new Map();
const g_unDocumentationBlockCount = 13;
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_vecDocumentationOwners = [];

const g_DocumentationBlocks = {
	Import: 0,
	Envelope: 1,
	Prefix: 2,
	EventName: 3,
	ConfigurationReceiver: 4,
	ConfigurationPublisher: 5,
	ConfigurationCount: 6,
	RoundReceiver: 7,
	Channels: 8,
	ChannelEventName: 9,
	StatisticsReceiver: 10,
	AuditPublisher: 11,
	HealthCount: 12,
};

function CreateHeadingAnchor(strHeading) {
	return strHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function VerifyContentsAnchors(strMarkdown) {
	const vecContentsMatch = strMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "plugins/bus contents section");

	const vecDocumentedAnchors = [];
	for (const vecDocumentedAnchorMatch of vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecDocumentedAnchors.push(vecDocumentedAnchorMatch[1]);
	}

	const vecSectionAnchors = [];
	for (const vecSectionHeadingMatch of strMarkdown.matchAll(/^## (.+)$/gm)) {
		const strSectionAnchor = CreateHeadingAnchor(vecSectionHeadingMatch[1]);
		if (strSectionAnchor !== "contents") {
			vecSectionAnchors.push(strSectionAnchor);
		}
	}

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "plugins/bus contents anchors");
}

function VerifyDocumentationLinks(strMarkdown) {
	const strDocumentationWithoutCode = strMarkdown.replace(/```[\s\S]*?```/g, "");
	const vecDocumentationLinks = [];
	for (const vecDocumentationLinkMatch of strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		vecDocumentationLinks.push(vecDocumentationLinkMatch[1]);
	}

	for (const strDocumentationLink of vecDocumentationLinks) {
		if (strDocumentationLink.startsWith("#") || /^[a-z]+:/i.test(strDocumentationLink)) {
			continue;
		}

		const nFragmentIndex = strDocumentationLink.indexOf("#");
		let strDocumentationLinkPath = strDocumentationLink;
		if (nFragmentIndex !== -1) {
			strDocumentationLinkPath = strDocumentationLink.slice(0, nFragmentIndex);
		}

		const strResolvedDocumentationLinkPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strDocumentationLinkPath);
		g_Assert.ok(g_FileSystem.existsSync(strResolvedDocumentationLinkPath), `plugins/bus documentation link must exist: ${strDocumentationLink}`);
	}
}

function GetOrCreateListenerCallbacks(strEventName) {
	if (!g_mapListenerCallbacks.has(strEventName)) {
		g_mapListenerCallbacks.set(strEventName, []);
	}

	return g_mapListenerCallbacks.get(strEventName);
}

const g_NativeListeners = {
	Emit(strEventName, Payload) {
		g_vecSerializedPayloads.push(Payload);

		const vecCallbacks = GetOrCreateListenerCallbacks(strEventName).slice();
		for (const Callback of vecCallbacks) {
			Callback(strEventName, Payload);
		}

		return vecCallbacks.length;
	},

	GetListenerCount(strEventName) {
		return GetOrCreateListenerCallbacks(strEventName).length;
	},

	RemoveListener(strEventName, Callback) {
		const vecCallbacks = GetOrCreateListenerCallbacks(strEventName);
		const nCallbackIndex = vecCallbacks.indexOf(Callback);
		if (nCallbackIndex < 0) {
			return false;
		}

		vecCallbacks.splice(nCallbackIndex, 1);

		return true;
	},

	AddListener(strEventName, Callback) {
		GetOrCreateListenerCallbacks(strEventName).push(Callback);

		return true;
	},
};

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_NativeListenerDescriptors = Object.getOwnPropertyDescriptors(g_NativeListeners);
const g_mapPackageCacheDescriptors = new Map();
for (const strPath of Object.getOwnPropertyNames(require.cache)) {
	if (strPath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strPath, Object.getOwnPropertyDescriptor(require.cache, strPath));
	}
}

function RestoreEnvelopeMetadata() {
	const vecFailures = [];
	for (const [strName, Descriptor] of g_mapOriginalEnvelopeMetadataDescriptors) {
		try {
			if (Descriptor === undefined) {
				g_Assert.ok(Reflect.deleteProperty(Object.prototype, strName), "Temporary envelope metadata must be removable: " + strName);
			} else {
				Object.defineProperty(Object.prototype, strName, Descriptor);
			}

			g_mapOriginalEnvelopeMetadataDescriptors.delete(strName);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Envelope metadata restoration failed.");
	}
}

function WithEnvelopeMetadata(Metadata, Callback) {
	let PrimaryFailure = undefined;
	let bFailed = false;

	try {
		for (const [strName, Value] of Object.entries(Metadata)) {
			g_mapOriginalEnvelopeMetadataDescriptors.set(strName, Object.getOwnPropertyDescriptor(Object.prototype, strName));
			Object.defineProperty(Object.prototype, strName, { configurable: true, value: Value, writable: true });
		}

		Callback();
	} catch (Failure) {
		PrimaryFailure = Failure;
		bFailed = true;
	} finally {
		try {
			RestoreEnvelopeMetadata();
		} catch (CleanupFailure) {
			if (bFailed) {
				throw new AggregateError([PrimaryFailure, CleanupFailure], "Envelope metadata verification and restoration failed.");
			}

			throw CleanupFailure;
		}
	}

	if (bFailed) {
		throw PrimaryFailure;
	}
}

function RestoreNativeListenerFixture() {
	const vecFailures = [];
	for (const strName of Object.keys(g_NativeListenerDescriptors)) {
		try {
			Object.defineProperty(g_NativeListeners, strName, g_NativeListenerDescriptors[strName]);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Native listener fixture restoration failed.");
	}
}

function RestoreDocumentationOwners() {
	const vecFailures = [];
	for (const ModuleRecord of g_vecDocumentationOwners) {
		try {
			const ModuleExports = ModuleRecord.exports;
			if (ModuleExports && (typeof ModuleExports.Unload === "function")) {
				// Already-inactive owners may return false; ReleaseOwnedListeners verifies remaining SDK-double ownership.
				ModuleExports.Unload();
			}
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Plugin bus documentation cleanup failed.");
	}
}

function ReleaseOwnedListeners() {
	const vecFailures = [];
	for (const [strEventName, vecCallbacks] of g_mapListenerCallbacks) {
		for (const Callback of [...vecCallbacks]) {
			try {
				g_Assert.equal(g_NativeListeners.RemoveListener(strEventName, Callback), true, "Owned plugin bus listener must be removable.");
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Plugin bus listener cleanup failed.");
	}
}

function RestoreSourceJS() {
	if (g_SourceJSDescriptor === undefined) {
		g_Assert.ok(Reflect.deleteProperty(globalThis, "sourcejs"), "Temporary SourceJS global must be removable.");
		return;
	}

	Object.defineProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
}

function RestoreModuleLoader() {
	Object.defineProperty(g_Module, "_load", g_ModuleLoadDescriptor);
}

function RestorePackageCache() {
	const vecFailures = [];
	for (const strPath of Object.getOwnPropertyNames(require.cache)) {
		if (strPath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			try {
				g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Temporary plugin bus cache entry must be removable: " + strPath);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}
	}

	for (const [strPath, Descriptor] of g_mapPackageCacheDescriptors) {
		try {
			Object.defineProperty(require.cache, strPath, Descriptor);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Plugin bus package cache restoration failed.");
	}
}

function LoadBusModule() {
	g_Assert.ok(Reflect.deleteProperty(require.cache, g_strBusPath), "Previous isolated bus module cache entry must be removable.");

	return require(g_strBusPath);
}

// The same-realm deadline bounds JavaScript execution, not native IO or untrusted code.
function RunDocumentationTask(Callback, strRole) {
	return g_VM.runInNewContext("Run()", { Run: Callback }, { filename: g_strDocumentationPath + "#" + strRole, timeout: g_unDocumentationTimeoutMilliseconds });
}

function CompileDocumentationBlock(strSource, unBlockIndex) {
	return g_VM.compileFunction(strSource, ["require", "module", "exports"], { filename: g_strDocumentationPath + "#js-" + (unBlockIndex + 1) });
}

function CheckPluginBusExample() {
	const strSourcePath = g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "plugin-bus", "index.js");
	const strSource = g_FileSystem.readFileSync(strSourcePath, "utf8");
	const Script = new g_VM.Script(strSource, { filename: strSourcePath });
	const strLoggerPath = g_Path.join(g_strPackageRootPath, "loggers.js");
	const LoggerScript = new g_VM.Script(g_FileSystem.readFileSync(strLoggerPath, "utf8"), { filename: strLoggerPath });
	let unScenarioCount = 0;

	function CreateExampleLoggers(NativeLoggers) {
		const LoggerModule = { exports: {} };
		const Dependencies = {
			filesystem: {
				EnsureDirectoryExists: () => g_Assert.fail("Plugin-bus example must not create logger directories."),
				SourceFile: { OpenSourceFile: () => g_Assert.fail("Plugin-bus example must not write log files.") },
			},
			"internal/runtime": {
				GetModule(strName) {
					g_Assert.equal(strName, "loggers");

					return NativeLoggers;
				},
			},
			paths: { LOG_ROOT: "/controlled/logs" },
		};
		const RequireLoggerDependency = strName => {
			g_Assert(Object.hasOwn(Dependencies, strName), "Unexpected logger dependency: " + strName);

			return Dependencies[strName];
		};

		LoggerScript.runInNewContext({ module: LoggerModule, require: RequireLoggerDependency }, { timeout: g_unDocumentationTimeoutMilliseconds });

		return LoggerModule.exports;
	}

	function Capture(Action) {
		try {
			return { Failed: false, Value: Action() };
		} catch (ErrorValue) {
			return { Failed: true, Value: ErrorValue };
		}
	}

	function LoadExample(Profile = {}, strExampleSource = strSource) {
		const ExampleScript = (strExampleSource === strSource) ? Script : new g_VM.Script(strExampleSource, { filename: strSourcePath });
		const State = { Exports: {}, Callbacks: [], Registered: [false, false], CleanupAttempts: [0, 0], Messages: [], LogCalls: [], Deliveries: [], Profile };

		function Register(unIndex, Callback) {
			if (Profile.RegistrationFailureIndex === unIndex) {
				if (Object.hasOwn(Profile, "RegistrationError")) {
					throw Profile.RegistrationError;
				}

				return false;
			}

			State.Callbacks[unIndex] = Callback;
			State.Registered[unIndex] = true;

			if (Profile.OnRegister !== undefined) {
				Profile.OnRegister(State, unIndex);
			}

			return true;
		}

		function Unregister(unIndex, Callback) {
			g_Assert.equal(Callback, State.Callbacks[unIndex]);
			State.CleanupAttempts[unIndex]++;

			const Release = Profile.CleanupActions?.[unIndex];
			if ((Release !== undefined) && !Release(State)) {
				return false;
			}

			g_Assert.equal(State.Registered[unIndex], true, "completed cleanup must not be retried");
			State.Registered[unIndex] = false;

			return true;
		}

		const Channel = {
			On(Callback) {
				g_Assert.equal(this, Channel);

				return Register(0, Callback);
			},

			Off(Callback) {
				g_Assert.equal(this, Channel);

				return Unregister(0, Callback);
			},

			Emit(Payload, Options) {
				g_Assert.equal(this, Channel);
				State.Deliveries.push({ Payload, Options });

				if (State.Registered[0]) {
					State.Callbacks[0](Payload, { Source: "plugin-bus", Target: "" });
				}

				return State.Registered[0] ? 1 : 0;
			},
		};

		const Loggers = CreateExampleLoggers({
			LogInfo(strMessage) {
				State.Messages.push(strMessage);

				if (Profile.OnLog !== undefined) {
					Profile.OnLog(State);
				}

				if ((Profile.LogErrorIndex === (State.Messages.length - 1)) && Object.hasOwn(Profile, "LogError")) {
					throw Profile.LogError;
				}
			},
		});
		const Modules = {
			loggers: {
				LogInfo(...vecArguments) {
					State.LogCalls.push(vecArguments);

					return Loggers.LogInfo(...vecArguments);
				},
			},

			"plugins/bus": {
				CreateChannel(strName, Options) {
					g_Assert.equal(strName, "Examples:PluginBus");
					g_Assert.equal(Options.Source, "plugin-bus");

					return Channel;
				},
			},

			source: {
				RegisterCommand(strName, Callback) {
					g_Assert.equal(strName, "sjs_plugin_bus");

					return Register(1, Callback);
				},

				UnregisterCommand(strName, Callback) {
					g_Assert.equal(strName, "sjs_plugin_bus");

					return Unregister(1, Callback);
				},
			},
		};

		State.Initialization = Capture(() => ExampleScript.runInNewContext({
			exports: State.Exports,

			require(strName) {
				g_Assert.equal(Object.hasOwn(Modules, strName), true);

				return Modules[strName];
			},
		}, { timeout: g_unDocumentationTimeoutMilliseconds }));
		unScenarioCount++;

		return State;
	}

	function VerifyLiteralPluginBusLogs(strExampleSource) {
		const State = LoadExample({}, strExampleSource);
		g_Assert.equal(State.Initialization.Failed, false, "Plugin-bus literal logs must initialize successfully.");

		try {
			g_Assert.equal(State.LogCalls[0][0], "%s", "Plugin-bus literal logs must use a literal startup format.");
			g_Assert.equal(State.Messages[0], 'Loaded; run "sjs_plugin_bus <message>".');

			const Payload = { Text: "message100%%:%s:%j:$&" };
			const Envelope = { Source: "source100%%:%s:%j:$&", Target: "target100%%:%s:%j:$&" };
			State.Callbacks[0](Payload, Envelope);
			g_Assert.equal(State.Messages[1], `Message ${Envelope.Source} -> ${Envelope.Target}: ${JSON.stringify(Payload)}`, "Plugin-bus literal logs must preserve incoming metadata and payload.");
			g_Assert.equal(State.LogCalls[1][0], "%s", "Plugin-bus literal logs must use a literal message format.");

			State.Callbacks[1]({ Arguments: ["sjs_plugin_bus", "command100%%:%s:%j:$&"] });
			g_Assert.equal(State.Messages[2], 'Message plugin-bus -> *: {"Text":"command100%%:%s:%j:$&"}', "Plugin-bus literal logs must preserve command delivery.");
			g_Assert.equal(State.Deliveries.length, 1);
			g_Assert.equal(State.Deliveries[0].Options.Type, "example");

			g_Assert.equal(State.Exports.Unload(), true);

			State.Callbacks[0](null, null);
			g_Assert.equal(State.Messages.length, 3, "Plugin-bus literal logs must stay silent after unload.");
			g_Assert.deepEqual(State.CleanupAttempts, [1, 1]);
		} finally {
			State.Exports.Unload();
		}
	}

	VerifyLiteralPluginBusLogs(strSource);
	const vecLiteralLoggingCalls = [
		'LogInfo("%s", `Message ${Envelope.Source || "anonymous"} -> ${Envelope.Target || "*"}: ${JSON.stringify(Payload)}`);',
		'LogInfo("%s", `Loaded; run "${g_strCommandName} <message>".`);',
	];
	for (const strCall of vecLiteralLoggingCalls) {
		g_Assert.equal(strSource.split(strCall).length, 2, "Exactly one literal plugin-bus log call must be selected.");
		const strLegacySource = strSource.replace(strCall, () => strCall.replace('LogInfo("%s", ', "LogInfo("));
		g_Assert.throws(() => VerifyLiteralPluginBusLogs(strLegacySource), ErrorValue => (ErrorValue.code === "ERR_ASSERTION") && ErrorValue.message.includes("Plugin-bus literal logs must"));
	}

	const Normal = LoadExample();
	g_Assert.equal(Normal.Initialization.Failed, false);
	g_Assert.deepEqual(Normal.Messages, ['Loaded; run "sjs_plugin_bus <message>".']);
	Normal.Callbacks[1]({ Arguments: ["sjs_plugin_bus"] });
	Normal.Callbacks[1]({ Arguments: ["sjs_plugin_bus", "hello", "world"] });
	g_Assert.equal(Normal.Deliveries.length, 2);
	g_Assert.equal(Normal.Deliveries[0].Payload.Text, "hello from plugin-bus");
	g_Assert.equal(Normal.Deliveries[1].Payload.Text, "hello world");
	g_Assert.equal(Normal.Deliveries[1].Options.Type, "example");
	g_Assert.equal(Normal.Messages[2], 'Message plugin-bus -> *: {"Text":"hello world"}');
	g_Assert.equal(Normal.Exports.Unload(), true);
	g_Assert.deepEqual(Normal.CleanupAttempts, [1, 1]);

	const StaleCommand = {
		get Arguments() {
			throw new Error("An unloaded command must not inspect arguments.");
		},
	};
	Normal.Callbacks[0]({ Text: "stale" }, { Source: "unloaded", Target: "" });
	g_Assert.equal(Normal.Messages.length, 3);
	Normal.Callbacks[1](StaleCommand);
	g_Assert.equal(Normal.Messages.length, 3);
	g_Assert.equal(Normal.Deliveries.length, 2);
	g_Assert.equal(Normal.Exports.Unload(), true);
	g_Assert.deepEqual(Normal.CleanupAttempts, [1, 1]);

	const OpaqueError = {
		toString() {
			throw new Error("Opaque failures must not be coerced.");
		},
	};

	const vecOpaqueErrors = [
		undefined,
		null,
		false,
		0,
		new Error("controlled failure"),
		OpaqueError,
	];
	for (const unFailureIndex of [0, 1]) {
		for (const ErrorValue of vecOpaqueErrors) {
			const Profile = { CleanupActions: [] };
			Profile.CleanupActions[unFailureIndex] = () => {
				throw ErrorValue;
			};

			const State = LoadExample(Profile);
			const Failure = Capture(() => State.Exports.Unload());
			g_Assert.equal(Failure.Failed, true);
			g_Assert.equal(Failure.Value.errors.length, 1);
			g_Assert.equal(Failure.Value.errors[0], ErrorValue);
			g_Assert.deepEqual(State.CleanupAttempts, [1, 1]);
			State.Callbacks[0](null, null);
			State.Callbacks[1](StaleCommand);
			g_Assert.equal(State.Messages.length, 1);
			Profile.CleanupActions[unFailureIndex] = () => true;
			g_Assert.equal(State.Exports.Unload(), true);
			g_Assert.equal(State.Exports.Unload(), true);
			g_Assert.equal(State.CleanupAttempts[unFailureIndex], 2);
			g_Assert.equal(State.CleanupAttempts[1 - unFailureIndex], 1);
		}

		const Profile = { CleanupActions: [] };
		Profile.CleanupActions[unFailureIndex] = () => false;

		const State = LoadExample(Profile);
		const Failure = Capture(() => State.Exports.Unload());
		g_Assert.equal(Failure.Failed, true);
		g_Assert.match(Failure.Value.errors[0].message, /Unable to remove/);
		g_Assert.deepEqual(State.CleanupAttempts, [1, 1]);
		Profile.CleanupActions[unFailureIndex] = () => true;
		g_Assert.equal(State.Exports.Unload(), true);
	}

	for (const unRegistrationIndex of [0, 1]) {
		const State = LoadExample({ RegistrationFailureIndex: unRegistrationIndex });
		g_Assert.equal(State.Initialization.Failed, true);
		g_Assert.match(State.Initialization.Value.message, /Unable to register/);
		g_Assert.deepEqual(State.Registered, [false, false]);
		g_Assert.deepEqual(State.CleanupAttempts, [unRegistrationIndex, 0]);
		g_Assert.equal(State.Messages.length, 0);
	}

	for (const ErrorValue of vecOpaqueErrors) {
		for (const Profile of [
			{ RegistrationFailureIndex: 0, RegistrationError: ErrorValue },
			{ RegistrationFailureIndex: 1, RegistrationError: ErrorValue },
			{ LogErrorIndex: 0, LogError: ErrorValue },
		]) {
			const State = LoadExample(Profile);
			g_Assert.equal(State.Initialization.Failed, true);
			g_Assert.equal(State.Initialization.Value, ErrorValue);
			g_Assert.deepEqual(State.Registered, [false, false]);
			g_Assert.equal(State.Exports.Unload(), true);
		}
	}

	const Rollback = LoadExample({
		LogErrorIndex: 0,
		LogError: OpaqueError,
		CleanupActions: [
			() => {
				throw undefined;
			},
			() => {
				throw null;
			},
		],
	});
	g_Assert.equal(Rollback.Initialization.Failed, true);
	g_Assert.equal(Rollback.Initialization.Value.errors[0], OpaqueError);
	g_Assert.equal(Rollback.Initialization.Value.errors[1].errors.length, 2);
	g_Assert.equal(Rollback.Initialization.Value.errors[1].errors[0], undefined);
	g_Assert.equal(Rollback.Initialization.Value.errors[1].errors[1], null);
	g_Assert.deepEqual(Rollback.CleanupAttempts, [1, 1]);
	Rollback.Profile.CleanupActions = [];
	g_Assert.equal(Rollback.Exports.Unload(), true);

	for (const strStage of ["MESSAGE_REGISTRATION", "COMMAND_REGISTRATION", "LOG"]) {
		const State = LoadExample({
			OnRegister(Current, unIndex) {
				if (((strStage === "MESSAGE_REGISTRATION") && (unIndex === 0)) || ((strStage === "COMMAND_REGISTRATION") && (unIndex === 1))) {
					g_Assert.equal(Current.Exports.Unload(), true);
				}
			},

			OnLog(Current) {
				if (strStage === "LOG") {
					g_Assert.equal(Current.Exports.Unload(), true);
				}
			},
		});
		g_Assert.equal(State.Initialization.Failed, false);
		g_Assert.deepEqual(State.Registered, [false, false]);
		g_Assert.deepEqual(State.CleanupAttempts, (strStage === "MESSAGE_REGISTRATION") ? [1, 0] : [1, 1]);
		g_Assert.equal(State.Messages.length, (strStage === "LOG") ? 1 : 0);
		g_Assert.equal(State.Exports.Unload(), true);
	}

	const Reentrant = LoadExample({
		CleanupActions: [
			(State) => {
				g_Assert.equal(State.Exports.Unload(), false);

				return true;
			},
		],
	});
	g_Assert.equal(Reentrant.Exports.Unload(), true);
	g_Assert.deepEqual(Reentrant.CleanupAttempts, [1, 1]);

	const ArgumentsUnload = LoadExample();
	ArgumentsUnload.Callbacks[1]({
		get Arguments() {
			g_Assert.equal(ArgumentsUnload.Exports.Unload(), true);

			return ["sjs_plugin_bus", "ignored"];
		},
	});
	g_Assert.equal(ArgumentsUnload.Deliveries.length, 0);
	g_Assert.deepEqual(ArgumentsUnload.Registered, [false, false]);
	g_Assert.deepEqual(ArgumentsUnload.CleanupAttempts, [1, 1]);

	console.log(`[  OK  ] plugin-bus example ${unScenarioCount} startup, opaque-failure, cleanup and reentrancy scenarios passed (controlled bus/native-command doubles)`);
}

CheckPluginBusExample();

let g_PrimaryFailure = undefined;
let g_bFailed = false;
let g_bEnvironmentAcquired = false;

try {
	g_Assert.ok((g_SourceJSDescriptor === undefined) || g_SourceJSDescriptor.configurable, "Existing SourceJS global must be restorable.");
	g_Assert.ok(g_ModuleLoadDescriptor && Object.hasOwn(g_ModuleLoadDescriptor, "value") && (typeof g_ModuleLoadDescriptor.value === "function") && (g_ModuleLoadDescriptor.configurable || g_ModuleLoadDescriptor.writable), "Node module loader must be replaceable without invoking an accessor.");

	for (const [strPath, Descriptor] of g_mapPackageCacheDescriptors) {
		g_Assert.ok(Descriptor.configurable, "Existing package cache must be restorable: " + strPath);
	}

	g_bEnvironmentAcquired = true;
	for (const strPath of g_mapPackageCacheDescriptors.keys()) {
		g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Existing package cache must be removable: " + strPath);
	}

	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { listeners: g_NativeListeners } });

	Object.defineProperty(g_Module, "_load", {
		...g_ModuleLoadDescriptor,

		value: function LoadModule(strRequest, ParentModule, bIsMain) {
			if (strRequest === "internal/runtime") {
				return require(g_strRuntimePath);
			}

			return g_ModuleLoadDescriptor.value.call(this, strRequest, ParentModule, bIsMain);
		},
	});

	const g_ReceiverBus = LoadBusModule();
	const g_SenderBus = LoadBusModule();

	const g_vecExpectedExports = [
		"EVENT_PREFIX",
		"PluginBusChannel",
		"CreateChannel",
		"Emit",
		"GetEventName",
		"GetListenerCount",
		"Off",
		"On",
	];

	g_Assert.notEqual(g_SenderBus, g_ReceiverBus, "isolated CommonJS contexts own separate bus module state.");
	g_Assert.deepEqual(Object.keys(g_SenderBus).sort(), g_vecExpectedExports.slice().sort(), "plugins/bus exact exports");
	g_Assert.equal(g_SenderBus.EVENT_PREFIX, "SourceJS:Plugins:", "EVENT_PREFIX");
	g_Assert.equal(g_SenderBus.GetEventName(" Ready "), "SourceJS:Plugins:Ready", "GetEventName normalizes surrounding whitespace.");
	g_Assert.throws(() => g_SenderBus.GetEventName(""), /non-empty string/, "GetEventName rejects an empty channel.");
	g_Assert.throws(() => g_SenderBus.GetEventName("bad\nchannel"), /control characters/, "GetEventName rejects control characters.");
	g_Assert.throws(() => g_SenderBus.CreateChannel("Ready", { Source: 7 }), /Source must be a string/, "CreateChannel rejects a non-string source.");
	g_Assert.throws(() => g_SenderBus.Emit("Ready", {}, null), /options must be an object/, "Emit rejects null options.");
	g_Assert.throws(() => g_SenderBus.Emit("Ready", {}, { Type: null }), /Type must be a string/, "Emit rejects null metadata.");
	g_Assert.throws(() => g_SenderBus.On("Ready", null), /callback must be a function/, "On rejects a non-function callback.");
	g_Assert.throws(() => g_SenderBus.Off("Ready", null), /callback must be a function/, "Off rejects a non-function callback.");
	g_Assert.equal(Object.hasOwn(g_SenderBus, "default"), false, "plugins/bus must not expose a default alias.");
	g_Assert.equal(Object.hasOwn(g_SenderBus, "moduleName"), false, "plugins/bus must not expose moduleName.");

	const g_OriginalNativeAddListener = g_NativeListeners.AddListener;
	g_NativeListeners.AddListener = () => 1;

	g_Assert.throws(() => g_SenderBus.On("InvalidNativeOn", () => {}), /registration must return a boolean/, "On rejects non-boolean native results.");

	g_NativeListeners.AddListener = g_OriginalNativeAddListener;

	function OnInvalidNativeRemoval() {
	}

	g_Assert.equal(g_SenderBus.On("InvalidNativeOff", OnInvalidNativeRemoval), true, "native-removal fixture registration");

	const g_OriginalNativeRemoveListener = g_NativeListeners.RemoveListener;
	g_NativeListeners.RemoveListener = () => 1;

	g_Assert.throws(() => g_SenderBus.Off("InvalidNativeOff", OnInvalidNativeRemoval), /removal must return a boolean/, "Off rejects non-boolean native results.");

	g_NativeListeners.RemoveListener = g_OriginalNativeRemoveListener;

	g_Assert.equal(g_SenderBus.Off("InvalidNativeOff", OnInvalidNativeRemoval), true, "native-removal fixture cleanup");

	const g_InheritedChannelOptions = Object.create({ Source: 7, Target: 9 });
	const g_InheritedOptionsChannel = g_SenderBus.CreateChannel("InheritedOptions", g_InheritedChannelOptions);
	g_Assert.equal(g_InheritedOptionsChannel.Source, "", "channel ignores inherited source metadata");
	g_Assert.equal(g_InheritedOptionsChannel.Target, "", "channel ignores inherited target metadata");

	const g_OriginalNativeListenerEmit = g_NativeListeners.Emit;
	g_NativeListeners.Emit = () => 1.5;

	g_Assert.throws(() => g_SenderBus.Emit("InvalidNativeEmit", {}), /non-negative safe integer/, "Emit rejects invalid native listener counts.");

	g_NativeListeners.Emit = g_OriginalNativeListenerEmit;

	const g_OriginalNativeGetListenerCount = g_NativeListeners.GetListenerCount;
	g_NativeListeners.GetListenerCount = () => "1";

	g_Assert.throws(() => g_SenderBus.GetListenerCount("InvalidNativeCount"), /non-negative safe integer/, "GetListenerCount rejects invalid native results.");

	g_NativeListeners.GetListenerCount = g_OriginalNativeGetListenerCount;

	const g_SourcePayload = { Map: "c1m1_hotel", Players: [1, 2] };
	let g_ReceivedPayload = null;
	let g_ReceivedEnvelope = null;

	function OnMapLoaded(Payload, Envelope) {
		g_ReceivedPayload = Payload;
		g_ReceivedEnvelope = Envelope;
		Payload.Players.push(3);
	}

	g_Assert.equal(g_ReceiverBus.On("MapLoaded", OnMapLoaded), true, "first registration succeeds.");
	g_Assert.equal(g_ReceiverBus.On("MapLoaded", OnMapLoaded), false, "duplicate registration is rejected.");
	g_Assert.equal(g_ReceiverBus.GetListenerCount("MapLoaded"), 1, "duplicate registration must not create a native listener.");
	g_Assert.equal(g_SenderBus.Emit("MapLoaded", g_SourcePayload, { Source: "MapController", Target: "Statistics", Type: "map" }), 1, "sender reaches the receiver context.");
	g_Assert.notEqual(g_ReceivedPayload, g_SourcePayload, "receiver gets a decoded payload object.");
	g_Assert.deepEqual(g_SourcePayload.Players, [1, 2], "receiver mutation does not change sender state.");
	g_Assert.deepEqual(g_ReceivedPayload.Players, [1, 2, 3], "receiver can mutate its decoded copy.");
	g_Assert.equal(g_ReceivedEnvelope.Channel, "MapLoaded", "envelope channel");
	g_Assert.equal(g_ReceivedEnvelope.Source, "MapController", "envelope source");
	g_Assert.equal(g_ReceivedEnvelope.Target, "Statistics", "envelope target");
	g_Assert.equal(g_ReceivedEnvelope.Type, "map", "envelope type");
	g_Assert.equal(typeof g_ReceivedEnvelope.Timestamp, "number", "envelope timestamp");
	g_Assert.equal(typeof g_vecSerializedPayloads.at(-1), "string", "native listeners receive only serialized text.");
	g_Assert.equal(g_SenderBus.Off("MapLoaded", OnMapLoaded), false, "another module instance does not own the receiver wrapper.");
	g_Assert.equal(g_ReceiverBus.Off("MapLoaded", OnMapLoaded), true, "owner removes the native wrapper.");
	g_Assert.equal(g_ReceiverBus.Off("MapLoaded", OnMapLoaded), false, "second removal reports an absent callback.");
	g_Assert.equal(g_ReceiverBus.GetListenerCount("MapLoaded"), 0, "listener cleanup");

	const g_ReadyChannel = g_ReceiverBus.CreateChannel("Ready", { Source: "Alpha" });
	const g_vecReceivedMessages = [];

	function OnReady(Payload, Envelope) {
		g_vecReceivedMessages.push({ Envelope, Payload });
	}

	g_Assert.equal(g_ReadyChannel.GetEventName(), "SourceJS:Plugins:Ready", "PluginBusChannel.GetEventName");
	g_Assert.equal(g_ReadyChannel.On(OnReady), true, "PluginBusChannel.On");
	g_Assert.equal(g_ReadyChannel.GetListenerCount(), 1, "PluginBusChannel.GetListenerCount");
	g_Assert.equal(g_ReadyChannel.Emit({ Ok: true }, { Target: "Beta", Type: "status" }), 1, "PluginBusChannel.Emit");
	g_Assert.equal(g_vecReceivedMessages[0].Payload.Ok, true, "channel payload");
	g_Assert.equal(g_vecReceivedMessages[0].Envelope.Source, "Alpha", "default channel source");
	g_Assert.equal(g_vecReceivedMessages[0].Envelope.Target, "Beta", "message target override");
	g_Assert.equal(g_ReadyChannel.Off(OnReady), true, "PluginBusChannel.Off");
	g_Assert.throws(() => g_ReadyChannel.Emit({}, []), /channel emit options must be an object/, "channel Emit rejects array options.");
	g_Assert.throws(() => g_ReadyChannel.Emit({}, { Source: null }), /Source must be a string/, "channel emit rejects null source overrides.");

	const g_CyclicPayload = {};
	g_CyclicPayload.Self = g_CyclicPayload;

	g_Assert.throws(() => g_SenderBus.Emit("InvalidPayload", g_CyclicPayload), /circular|cyclic/i, "cyclic payloads cannot cross the bus.");
	g_Assert.throws(() => g_SenderBus.Emit("InvalidPayload", { Value: 1n }), /BigInt/, "BigInt payloads cannot cross the bus.");

	const g_unSerializedPayloadCountBeforeInvalidFunction = g_vecSerializedPayloads.length;
	g_Assert.throws(() => g_SenderBus.Emit("InvalidPayload", function InvalidPluginBusPayload() {}), /must contain payload/, "payloads removed by JSON serialization cannot cross the bus.");
	g_Assert.equal(g_vecSerializedPayloads.length, g_unSerializedPayloadCountBeforeInvalidFunction, "invalid serialized payloads must not reach native emit.");

	function OnMalformedEnvelope() {
	}

	g_Assert.equal(g_ReceiverBus.On("Malformed", OnMalformedEnvelope), true, "malformed-envelope listener registration");

	const g_MalformedCallback = GetOrCreateListenerCallbacks(g_ReceiverBus.GetEventName("Malformed"))[0];
	g_Assert.throws(() => g_MalformedCallback(g_ReceiverBus.GetEventName("Malformed"), "not-json"), SyntaxError, "listener rejects malformed JSON.");
	g_Assert.throws(() => g_MalformedCallback(g_ReceiverBus.GetEventName("Malformed"), JSON.stringify({ Channel: "Other", Payload: {}, Source: "", Target: "", Timestamp: Date.now() })), /listener channel/, "listener rejects a mismatched channel.");

	const g_InheritedEnvelopeMetadata = { Channel: "Malformed", Source: "InheritedSource", Target: "InheritedTarget", Timestamp: Date.now() };
	WithEnvelopeMetadata(g_InheritedEnvelopeMetadata, () => {
		g_Assert.throws(() => g_MalformedCallback(g_ReceiverBus.GetEventName("Malformed"), JSON.stringify({ Payload: {} })), /listener channel/, "listener rejects inherited envelope metadata.");
	});

	g_Assert.equal(g_ReceiverBus.Off("Malformed", OnMalformedEnvelope), true, "malformed-envelope listener cleanup");

	const g_DocumentationBus = LoadBusModule();
	g_vecSerializedPayloads.length = 0;

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecCodeBlocks = [];
	for (const vecCodeBlockMatch of g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
		g_vecCodeBlocks.push(vecCodeBlockMatch[1]);
	}

	function DocumentationRequire(strModuleName) {
		if (strModuleName === "plugins/bus") {
			return g_DocumentationBus;
		}

		throw new Error(`unexpected plugins/bus documentation module ${strModuleName}`);
	}

	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationBlockCount, "plugins/bus documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "plugins/bus documentation must be maintained by hand.");
	g_Assert.ok(g_strDocumentation.includes("decoded copy"), "plugins/bus docs must explain payload isolation.");
	g_Assert.ok(g_strDocumentation.includes("does not filter them automatically"), "plugins/bus docs must explain target routing.");
	g_Assert.match(g_strDocumentation, /duplicate `On\(\)` calls.*return `false`/i, "plugins/bus docs must explain duplicate registration.");
	g_Assert.ok(!g_strDocumentation.includes("console."), "plugins/bus documentation must not depend on console-only inspection.");
	g_Assert.ok(!/[^\x00-\x7F]/.test(g_strDocumentation), "plugins/bus documentation must remain valid ASCII.");
	VerifyContentsAnchors(g_strDocumentation);
	VerifyDocumentationLinks(g_strDocumentation);

	const g_vecDocumentationModules = [];

	function CheckPluginBusDocumentationExamples() {
		for (let unDocumentationIndex = 0; unDocumentationIndex < g_vecCodeBlocks.length; ++unDocumentationIndex) {
			const ModuleRecord = { exports: {} };
			g_vecDocumentationOwners.push(ModuleRecord);
			CompileDocumentationBlock(g_vecCodeBlocks[unDocumentationIndex], unDocumentationIndex)(DocumentationRequire, ModuleRecord, ModuleRecord.exports);
			g_vecDocumentationModules.push(ModuleRecord.exports);
		}

		for (const unReceiverBlockIndex of [g_DocumentationBlocks.ConfigurationReceiver, g_DocumentationBlocks.RoundReceiver, g_DocumentationBlocks.StatisticsReceiver]) {
			const Receiver = g_vecDocumentationModules[unReceiverBlockIndex];
			g_Assert.equal(typeof Receiver.Load, "function", "receiver exports the canonical SourceJS Load key");
			g_Assert.equal(typeof Receiver.Unload, "function", "receiver exports the canonical SourceJS Unload key");
			g_Assert.equal(Object.hasOwn(Receiver, "load"), false, "no lowercase Load alias");
			g_Assert.equal(Object.hasOwn(Receiver, "unload"), false, "no lowercase Unload alias");
		}

		let unRemainingListenerCount = 0;
		for (const vecRegisteredListenerCallbacks of g_mapListenerCallbacks.values()) {
			unRemainingListenerCount += vecRegisteredListenerCallbacks.length;
		}

		g_Assert.equal(unRemainingListenerCount, 0, "plugins/bus examples must not register listeners during block load");
		g_Assert.equal(g_vecSerializedPayloads.length, 0, "plugins/bus examples must not emit during block load");
		g_Assert.deepEqual(g_vecDocumentationModules[g_DocumentationBlocks.Prefix].InspectEventPrefix(), { EventPrefix: "SourceJS:Plugins:", InternalName: "SourceJS:Plugins:RoundReady" }, "documented event prefix");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.EventName].GetInternalEventName(" MatchState "), "SourceJS:Plugins:MatchState", "documented normalized event name");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.ConfigurationReceiver].Load(), "documented configuration subscriber load");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.ConfigurationCount].GetConfigurationListenerCount(), 1, "documented direct listener count");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.ConfigurationPublisher].PublishConfigurationChanged("FriendlyFire", false), 1, "documented direct bus emission");
		g_Assert.deepEqual(g_vecDocumentationModules[g_DocumentationBlocks.ConfigurationReceiver].GetCurrentConfiguration(), { Name: "FriendlyFire", Source: "AdminSettings", Value: false }, "documented configuration delivery");

		const ConfigurationEnvelope = JSON.parse(g_vecSerializedPayloads.at(-1));
		const InspectedEnvelope = g_vecDocumentationModules[g_DocumentationBlocks.Envelope].InspectConfigurationEnvelope(ConfigurationEnvelope.Payload, ConfigurationEnvelope);
		g_Assert.equal(InspectedEnvelope.Channel, "ConfigurationChanged", "documented envelope channel");
		g_Assert.equal(InspectedEnvelope.Target, "MatchController", "documented envelope target");
		g_Assert.equal(InspectedEnvelope.Type, "setting", "documented envelope type");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.ConfigurationReceiver].Unload(), "documented configuration subscriber unload");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.ConfigurationCount].GetConfigurationListenerCount(), 0, "documented direct listener cleanup");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.RoundReceiver].Load(), "documented round subscriber load");
		g_Assert.equal(g_DocumentationBus.Emit("RoundReady", { Round: 3 }), 1, "documented round delivery setup");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.RoundReceiver].GetReadyRound(), 3, "documented round payload");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.RoundReceiver].Unload(), "documented direct off cleanup");
		g_Assert.deepEqual(g_vecDocumentationModules[g_DocumentationBlocks.Channels].CreateBusChannels(), { Created: { Name: "PlayersRespawn", Source: "RespawnManager", Target: "Statistics" }, Direct: { Name: "RoundState", Source: "RoundController", Target: "" } }, "documented class and factory channels");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.ChannelEventName].GetMatchEventName(), "SourceJS:Plugins:MatchState", "documented channel event name");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.StatisticsReceiver].Load(), "documented channel subscriber load");
		g_Assert.equal(g_DocumentationBus.Emit("StatisticsSample", { Damage: 42, PlayerIndex: 2 }), 1, "documented channel callback delivery");
		g_Assert.deepEqual(g_vecDocumentationModules[g_DocumentationBlocks.StatisticsReceiver].GetLastSample(), { Damage: 42, PlayerIndex: 2 }, "documented channel payload");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.StatisticsReceiver].Unload(), "documented channel subscriber unload");

		let ReceivedAuditEnvelope = null;

		function OnAuditEntry(Payload, Envelope) {
			ReceivedAuditEnvelope = { Envelope, Payload };
		}

		g_Assert.ok(g_DocumentationBus.On("AuditEntry", OnAuditEntry), "documented audit receiver setup");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.AuditPublisher].PublishAuditEntry("ChangeMap", "c1m1_hotel"), 1, "documented channel emission");
		g_Assert.equal(ReceivedAuditEnvelope.Envelope.Source, "AdminTools", "documented channel default source");
		g_Assert.equal(ReceivedAuditEnvelope.Envelope.Target, "AuditLog", "documented channel default target");
		g_Assert.equal(ReceivedAuditEnvelope.Envelope.Type, "adminaction", "documented per-message type override");
		g_Assert.deepEqual(ReceivedAuditEnvelope.Payload, { Action: "ChangeMap", Map: "c1m1_hotel" }, "documented audit payload");
		g_Assert.ok(g_DocumentationBus.Off("AuditEntry", OnAuditEntry), "documented audit receiver cleanup");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.HealthCount].GetHealthListenerCount(), 0, "documented channel listener count");

		return ConfigurationEnvelope;
	}

	const g_ConfigurationEnvelope = RunDocumentationTask(CheckPluginBusDocumentationExamples, "root");

	function CheckPluginBusDocumentationScenarios() {
		// These checks execute the actual documentation blocks against the bus facade.
		// The native double models registration/removal, not V8 exception logging or ABI behavior.
		const vecReceiverWorkflows = [
			{
				ModuleExports: g_vecDocumentationModules[g_DocumentationBlocks.ConfigurationReceiver],
				Channel: "ConfigurationChanged",
				Payload: { Name: "FriendlyFire", Value: false },
				Options: { Type: "setting" },
				Read: g_vecDocumentationModules[g_DocumentationBlocks.ConfigurationReceiver].GetCurrentConfiguration,
				InvalidPayloads: [
					null,
					[],
					{},
					{ Name: 3, Value: false },
					{ Name: "FriendlyFire" },
				],
			},
			{
				ModuleExports: g_vecDocumentationModules[g_DocumentationBlocks.RoundReceiver],
				Channel: "RoundReady",
				Payload: { Round: 0 },
				Options: {},
				Read: g_vecDocumentationModules[g_DocumentationBlocks.RoundReceiver].GetReadyRound,
				InvalidPayloads: [
					null,
					[],
					{},
					{ Round: -1 },
					{ Round: 1.5 },
					{ Round: "3" },
				],
			},
			{
				ModuleExports: g_vecDocumentationModules[g_DocumentationBlocks.StatisticsReceiver],
				Channel: "StatisticsSample",
				Payload: { Damage: 42, PlayerIndex: 2 },
				Options: { Target: "Statistics" },
				Read: g_vecDocumentationModules[g_DocumentationBlocks.StatisticsReceiver].GetLastSample,
				InvalidPayloads: [
					null,
					[],
					{},
					{ Damage: "42", PlayerIndex: 2 },
					{ Damage: -1, PlayerIndex: 2 },
					{ Damage: 42, PlayerIndex: 0 },
				],
			},
		];
		for (const Workflow of vecReceiverWorkflows) {
			g_Assert.equal(Workflow.ModuleExports.Load(), true, `${Workflow.Channel} registration`);

			try {
				g_Assert.equal(g_DocumentationBus.Emit(Workflow.Channel, Workflow.Payload, Workflow.Options), 1, `${Workflow.Channel} valid delivery`);

				const InitialState = Workflow.Read();
				for (const InvalidPayload of Workflow.InvalidPayloads) {
					g_Assert.equal(g_DocumentationBus.Emit(Workflow.Channel, InvalidPayload, Workflow.Options), 1, `${Workflow.Channel} rejected payload still counts registered callback`);
					g_Assert.deepEqual(Workflow.Read(), InitialState, `${Workflow.Channel} invalid payload cannot replace receiver state`);
				}

				if (Workflow.Channel !== "RoundReady") {
					g_Assert.equal(g_DocumentationBus.Emit(Workflow.Channel, Workflow.Payload, { ...Workflow.Options, Target: "OtherPlugin" }), 1, `${Workflow.Channel} target filtering belongs to callback, not transport`);
					g_Assert.deepEqual(Workflow.Read(), InitialState, `${Workflow.Channel} ignores another target`);
				}
			} finally {
				// State and final strict listener postconditions verify release without replacing the operation failure.
				Workflow.ModuleExports.Unload();
			}

			g_Assert.equal(Workflow.Read(), null, `${Workflow.Channel} successful cleanup clears state`);
		}

		const OriginalNativeRemoveListener = g_NativeListeners.RemoveListener;
		for (const Workflow of vecReceiverWorkflows) {
			for (const strFailureMode of ["FALSE", "THROW", "NONBOOLEAN"]) {
				g_Assert.equal(Workflow.ModuleExports.Load(), true, `${Workflow.Channel} removal retry setup ${strFailureMode}`);

				try {
					g_Assert.equal(g_DocumentationBus.Emit(Workflow.Channel, Workflow.Payload, Workflow.Options), 1, Workflow.Channel + " removal retry delivery setup");

					const InitialState = Workflow.Read();
					const RemovalError = new Error("Native removal failed.");
					g_NativeListeners.RemoveListener = () => {
						if (strFailureMode === "THROW") {
							throw RemovalError;
						}

						return (strFailureMode === "FALSE") ? false : 0;
					};

					if (strFailureMode === "FALSE") {
						g_Assert.equal(Workflow.ModuleExports.Unload(), false, `${Workflow.Channel} reports failed removal`);

					} else if (strFailureMode === "THROW") {
						g_Assert.throws(() => Workflow.ModuleExports.Unload(), (Failure) => Failure === RemovalError, `${Workflow.Channel} preserves native exception`);

					} else {
						g_Assert.throws(() => Workflow.ModuleExports.Unload(), TypeError, `${Workflow.Channel} rejects non-boolean removal`);
					}

					g_Assert.deepEqual(Workflow.Read(), InitialState, `${Workflow.Channel} retains state until removal succeeds`);
					g_Assert.equal(g_DocumentationBus.GetListenerCount(Workflow.Channel), 1, `${Workflow.Channel} failed removal remains registered`);

					g_NativeListeners.RemoveListener = OriginalNativeRemoveListener;
					g_Assert.equal(Workflow.ModuleExports.Unload(), true, `${Workflow.Channel} retry uses the original callback and owner`);
					g_Assert.equal(Workflow.Read(), null, `${Workflow.Channel} retry clears state`);
					g_Assert.equal(g_DocumentationBus.GetListenerCount(Workflow.Channel), 0, `${Workflow.Channel} retry removes native listener`);
				} finally {
					g_NativeListeners.RemoveListener = OriginalNativeRemoveListener;
					// Already-unloaded receivers may return false; final strict cleanup checks any retained listeners.
					Workflow.ModuleExports.Unload();
				}
			}
		}

		const OriginalNativeAddListener = g_NativeListeners.AddListener;
		g_NativeListeners.AddListener = () => false;

		try {
			for (const Workflow of vecReceiverWorkflows) {
				g_Assert.throws(() => Workflow.ModuleExports.Load(), /could not be registered/, `${Workflow.Channel} registration failure aborts native plugin load`);
				g_Assert.equal(Workflow.Read(), null, `${Workflow.Channel} failed registration retains no receiver state`);
				g_Assert.equal(g_DocumentationBus.GetListenerCount(Workflow.Channel), 0, `${Workflow.Channel} failed registration adds no listener`);
			}
		} finally {
			g_NativeListeners.AddListener = OriginalNativeAddListener;
		}

		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.StatisticsReceiver].Load(), true, "channel registration can retry after native failure");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.StatisticsReceiver].Load(), false, "duplicate channel load preserves its original owner");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.StatisticsReceiver].Unload(), true, "retry owner is released");

		const unSerializedPayloadCount = g_vecSerializedPayloads.length;
		const CyclicDocumentationPayload = {};
		CyclicDocumentationPayload.Self = CyclicDocumentationPayload;

		g_Assert.throws(() => g_DocumentationBus.Emit("RoundReady", { Round: 1n }), TypeError, "BigInt cannot cross the JSON bus");
		g_Assert.throws(() => g_DocumentationBus.Emit("RoundReady", CyclicDocumentationPayload), TypeError, "cycles cannot cross the JSON bus");
		g_Assert.equal(g_vecSerializedPayloads.length, unSerializedPayloadCount, "serialization failures happen before native publication");

		for (const InvalidPayload of [
			null,
			[],
			{},
			{ Name: 3, Value: false },
			{ Name: "FriendlyFire" },
		]) {
			g_Assert.throws(() => g_vecDocumentationModules[g_DocumentationBlocks.Envelope].InspectConfigurationEnvelope(InvalidPayload, g_ConfigurationEnvelope), TypeError, "envelope inspector validates payload before field access");
		}

		for (const InvalidEnvelope of [
			null,
			[],
			{ ...g_ConfigurationEnvelope, Channel: "OtherChannel" },
			{ ...g_ConfigurationEnvelope, Source: "UnknownSource" },
			{ ...g_ConfigurationEnvelope, Target: "OtherPlugin" },
			{ ...g_ConfigurationEnvelope, Type: "Setting" },
			{ ...g_ConfigurationEnvelope, Timestamp: NaN },
		]) {
			g_Assert.throws(() => g_vecDocumentationModules[g_DocumentationBlocks.Envelope].InspectConfigurationEnvelope(g_ConfigurationEnvelope.Payload, InvalidEnvelope), Error, "envelope inspector rejects unexpected metadata");
		}

		function OnServiceHealthProbe() {
			return true;
		}

		const OriginalNativeGetListenerCount = g_NativeListeners.GetListenerCount;
		g_Assert.equal(g_DocumentationBus.On("ServiceHealth", OnServiceHealthProbe), true, "health count probe registration");

		try {
			g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.HealthCount].GetHealthListenerCount(), 1, "documented channel getter reads its own native count");

			for (const InvalidListenerCount of [
				"1",
				-1,
				1.5,
				NaN,
				null,
				true,
				1n,
			]) {
				g_NativeListeners.GetListenerCount = () => InvalidListenerCount;
				g_Assert.throws(() => g_vecDocumentationModules[g_DocumentationBlocks.HealthCount].GetHealthListenerCount(), TypeError, "documented count rejects native non-count results");
			}
		} finally {
			g_NativeListeners.GetListenerCount = OriginalNativeGetListenerCount;
			g_Assert.equal(g_DocumentationBus.Off("ServiceHealth", OnServiceHealthProbe), true, "health count probe cleanup");
		}

		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.HealthCount].GetHealthListenerCount(), 0, "health count returns to zero after cleanup");

		let unRemainingListenerCount = 0;
		for (const vecRegisteredListenerCallbacks of g_mapListenerCallbacks.values()) {
			unRemainingListenerCount += vecRegisteredListenerCallbacks.length;
		}

		g_Assert.equal(unRemainingListenerCount, 0, "documentation and focused workflows must release every listener.");
	}

	RunDocumentationTask(CheckPluginBusDocumentationScenarios, "scenarios");

	const g_strNativeBindings = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8");
	const g_NativeListenerCallbacks = {
		AddListener: "AddRuntimeEventListenerCallback",
		RemoveListener: "RemoveRuntimeEventListenerCallback",
		Emit: "EmitRuntimeEventCallback",
		GetListenerCount: "GetRuntimeEventListenerCountCallback",
	};
	g_Assert.deepEqual(Object.keys(g_NativeListeners).sort(), Object.keys(g_NativeListenerCallbacks).sort(), "Native listener fixture must use canonical exports without On/Off/ListenerCount aliases.");

	for (const [strExportName, strCallbackName] of Object.entries(g_NativeListenerCallbacks)) {
		g_Assert.ok(g_strNativeBindings.includes(`SetFunction(pIsolate, LocalContext, LocalListenersModule, "${strExportName}", ${strCallbackName}, LocalRuntimeData)`), `Native listener export ${strExportName} must match its actual callback.`);
	}

	const g_strPackageSource = g_FileSystem.readFileSync(g_strBusPath, "utf8");
	for (const strRequiredContract of [
		'const g_strEventPrefix = "SourceJS:Plugins:"',
		'const { GetModule } = require("internal/runtime")',
		"const g_mapCallbackWrappers = new WeakMap()",
		'const g_ListenerRuntime = GetModule("listeners")',
		"CreatePluginBusEnvelope(strChannelName, PluginBusPayload, PluginBusOptions = {})",
		"CreatePluginBusEnvelope(strNormalizedChannelName",
		"JSON.parse(strSerializedEnvelope)",
		"CallbackWrapperRecord.RegistrationActive",
		"g_mapCallbackWrappers.delete(PluginBusCallback)",
	]) {
		g_Assert.ok(g_strPackageSource.includes(strRequiredContract), `plugins/bus contract missing: ${strRequiredContract}`);
	}

	for (const strForbiddenContract of [
		"moduleName",
		"eventPrefix",
		"export default",
		"export const",
		"callbackWrappers",
	]) {
		g_Assert.ok(!g_strPackageSource.includes(strForbiddenContract), `plugins/bus contains obsolete API: ${strForbiddenContract}`);
	}
} catch (Failure) {
	g_PrimaryFailure = Failure;
	g_bFailed = true;
} finally {
	const vecCleanupFailures = [];
	const vecRestorers = [
		RestoreEnvelopeMetadata,
		RestoreNativeListenerFixture,
		RestoreDocumentationOwners,
		ReleaseOwnedListeners,
	];
	if (g_bEnvironmentAcquired) {
		vecRestorers.push(RestorePackageCache, RestoreModuleLoader, RestoreSourceJS);
	}

	for (const Restore of vecRestorers) {
		try {
			Restore();
		} catch (Failure) {
			vecCleanupFailures.push(Failure);
		}
	}

	if (vecCleanupFailures.length > 0) {
		if (g_bFailed) {
			throw new AggregateError([g_PrimaryFailure, ...vecCleanupFailures], "Plugin bus verification and restoration failed.");
		}

		throw new AggregateError(vecCleanupFailures, "Plugin bus restoration failed.");
	}
}

if (g_bFailed) {
	throw g_PrimaryFailure;
}

console.log("[  OK  ] smoke_plugin_bus");
