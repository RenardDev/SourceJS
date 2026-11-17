#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRootPath, "packages", "sourcejs");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strListenersPath = g_Path.join(g_strPackageRootPath, "listeners.js");
const g_strOutputsPath = g_Path.join(g_strPackageRootPath, "entities", "outputs.js");
const g_strExampleLoggerPath = g_Path.join(g_strPackageRootPath, "loggers.js");
const g_ExampleLoggerScript = new g_VM.Script(g_FileSystem.readFileSync(g_strExampleLoggerPath, "utf8"), { filename: g_strExampleLoggerPath });
const g_unExpectedExportCount = 91;
const g_unExpectedManagerCount = 41;
const g_unExecutionTimeoutMilliseconds = 1000;
const g_mapNativeEvents = new Map();
const g_vecNativeCallbackFailures = [];
let g_bRejectNextRegistration = false;
let g_bDocumentationEntityOutputFixtureEnabled = false;
let g_DocumentationEntityOutputCallback = null;

const g_NativeListeners = {
	AddListener(strEventName, Callback) {
		g_Assert.strictEqual(this, g_NativeListeners);

		if (g_bRejectNextRegistration) {
			g_bRejectNextRegistration = false;
			return false;
		}

		let vecCallbacks = g_mapNativeEvents.get(strEventName);
		if (vecCallbacks === undefined) {
			vecCallbacks = [];
			g_mapNativeEvents.set(strEventName, vecCallbacks);
		}

		vecCallbacks.push(Callback);

		return true;
	},

	RemoveListener(strEventName, Callback) {
		g_Assert.strictEqual(this, g_NativeListeners);
		const vecCallbacks = g_mapNativeEvents.get(strEventName);
		const nCallbackIndex = vecCallbacks?.indexOf(Callback) ?? -1;
		if (nCallbackIndex === -1) {
			return false;
		}

		vecCallbacks.splice(nCallbackIndex, 1);

		if (vecCallbacks.length === 0) {
			g_mapNativeEvents.delete(strEventName);
		}

		return true;
	},

	Emit(strEventName, strPayload) {
		g_Assert.strictEqual(this, g_NativeListeners);
		const vecCallbacks = [...(g_mapNativeEvents.get(strEventName) ?? [])];
		for (const Callback of vecCallbacks) {
			try {
				Callback(strEventName, strPayload);
			} catch (ErrorValue) {
				// Native dispatch logs an exception and continues its low-level snapshot.
				g_vecNativeCallbackFailures.push(ErrorValue);
			}
		}

		return vecCallbacks.length;
	},

	GetListenerCount(strEventName) {
		g_Assert.strictEqual(this, g_NativeListeners);

		return g_mapNativeEvents.get(strEventName)?.length ?? 0;
	},
};

function CreateExampleTickFixture(ListenerAPI) {
	const TickModule = { exports: {} };
	const strTickPath = g_Path.join(g_strRootPath, "packages/sourcejs/listeners/tick.js");
	let unTimeMilliseconds = 1000;
	const RuntimeDependency = {
		GetModule(strName) {
			g_Assert.equal(strName, "listeners/tick");

			return { GetMonotonicTimeSeconds: () => unTimeMilliseconds / 1000 };
		},
	};
	const ExceptionHooks = {
		PrintException(ErrorValue) {
			throw ErrorValue;
		},
	};
	const mapDependencies = new Map([
		["internal/runtime", RuntimeDependency],
		["listeners", ListenerAPI],
		["memory/hooks/exceptions", { EXCEPTION_HOOKS: ExceptionHooks }],
	]);
	g_VM.runInNewContext(g_FileSystem.readFileSync(strTickPath, "utf8"), {
		module: TickModule,
		Date: { now: () => unTimeMilliseconds },

		require(strName) {
			g_Assert.ok(mapDependencies.has(strName));

			return mapDependencies.get(strName);
		},
	}, { filename: strTickPath, timeout: g_unExecutionTimeoutMilliseconds });

	return {
		API: TickModule.exports,

		Advance() {
			unTimeMilliseconds += 2000;
		},
	};
}

function CheckHookExampleOwnership(Context, Controls, TickFixture, CommandCallback, Exports, ListenerAPI) {
	let unScenarioCount = 0;
	let unForeignTimerCalls = 0;
	const ForeignTimer = new TickFixture.API.TickDelay(1, () => {
		unForeignTimerCalls += 1;
	});
	const TickInformation = Context.InspectTickAPI();
	g_Assert.equal(TickInformation.Running, true);
	g_Assert.equal(ForeignTimer.Running, true);
	TickFixture.Advance();
	ListenerAPI.EmitListenerEvent("Tick");
	g_Assert.equal(unForeignTimerCalls, 1, "The example must leave other timers and the shared bridge running");
	unScenarioCount += 1;

	for (const vecArguments of [
		["call", "4096", "8192", "confirm", "extra"],
		["call"],
		["pre", "4096", "garbage", "confirm"],
		["pre", "4096", "trampoline", "confirm", "extra"],
		["post", "4096", "trampoline", "confirm"],
		["remove", "1", "extra"],
		["binary", "server", "extra"],
		["symbol", "server", "symbol", "extra"],
		["scan", "server"],
		["unknown"],
	]) {
		const unCallCount = Controls.Calls.length;
		g_Assert.doesNotThrow(() => CommandCallback({ Arguments: ["sjs_api_hooks", ...vecArguments] }));
		g_Assert.equal(Controls.Calls.length, unCallCount, "Malformed syntax must not invoke native operations");
		unScenarioCount += 1;
	}

	let unNextHookID = 1;
	Controls.CreateHook = () => {
		const unHookID = unNextHookID++;
		const Hook = {
			ID: unHookID,
			Callback: null,

			Pre(Callback) {
				this.Callback = Callback;

				return Controls.RegisterCallback();
			},

			Post(Callback) {
				this.Callback = Callback;

				return Controls.RegisterCallback();
			},
		};
		Controls.Hooks.set(unHookID, Hook);

		return Hook;
	};
	Controls.RemoveHook = unHookID => Controls.Hooks.delete(unHookID);
	Controls.RegisterCallback = () => true;
	Controls.CallFunction = Options => {
		g_Assert.equal(Options.Address, 4096n);
		g_Assert.equal(Options.ThisObject, 8192n);
		g_Assert.ok(Object.values(Options.Registers).includes(8192n));

		return { ReturnValue: 7, Registers: { RDX: 2n, EDX: 2n } };
	};
	CommandCallback({ Arguments: ["sjs_api_hooks", "call", "4096", "8192", "confirm"] });
	unScenarioCount += 1;

	for (const vecArguments of [
		["pre", "4096", "confirm"],
		["post", "4096", "confirm"],
		["pre", "4096", "trampoline", "confirm"],
	]) {
		CommandCallback({ Arguments: ["sjs_api_hooks", ...vecArguments] });
		const Hook = Controls.Hooks.get(unNextHookID - 1);
		let unTrampolineCalls = 0;
		const HookContext = {
			Arguments: [7, "value"],
			Registers: { RDX: 2n, EDX: 2n },

			CallHookTrampoline(Options) {
				g_Assert.notEqual(Options.Arguments, this.Arguments);
				g_Assert.notEqual(Options.Registers, this.Registers);
				unTrampolineCalls += 1;

				return { ReturnValue: 7, Registers: { RDX: 2n, EDX: 2n } };
			},
		};
		Hook.Callback(HookContext);
		g_Assert.equal(unTrampolineCalls, vecArguments.includes("trampoline") ? 1 : 0);
		CommandCallback({ Arguments: ["sjs_api_hooks", "remove", String(Hook.ID)] });
		g_Assert.equal(Controls.Hooks.size, 0);
		unScenarioCount += 1;
	}

	CommandCallback({ Arguments: ["sjs_api_hooks", "pre", "4096", "confirm"] });
	const RemovedHook = Controls.Hooks.get(unNextHookID - 1);
	const LogErrorValue = new Error("removal logging");
	Controls.LogInfo = () => {
		throw LogErrorValue;
	};
	g_Assert.throws(() => CommandCallback({ Arguments: ["sjs_api_hooks", "remove", String(RemovedHook.ID)] }), ErrorValue => ErrorValue === LogErrorValue);
	g_Assert.equal(Controls.Hooks.size, 0, "Commit ownership release before logging can throw");
	Controls.LogInfo = () => true;
	unScenarioCount += 1;

	const CreateOwnedHook = Controls.CreateHook;
	Controls.Hooks.set(99, { ID: 99 });
	Controls.CreateHook = () => Controls.Hooks.get(99);
	const unCallsBefore = Controls.Calls.length;
	g_Assert.throws(() => CommandCallback({ Arguments: ["sjs_api_hooks", "pre", "4096", "confirm"] }), /will not take ownership/);
	g_Assert.equal(Controls.Calls.slice(unCallsBefore).includes("RemoveHook"), false);
	g_Assert.equal(Controls.Hooks.has(99), true);
	Controls.Hooks.delete(99);
	Controls.CreateHook = CreateOwnedHook;
	unScenarioCount += 1;

	const RemoveOwnedHook = Controls.RemoveHook;
	for (const strMode of ["FALSE", "THROW"]) {
		for (const strCleanupMode of ["FALSE", "THROW"]) {
			const PrimaryError = new Error("registration");
			const CleanupError = new Error("removal");
			Controls.RegisterCallback = () => {
				if (strMode === "THROW") {
					throw PrimaryError;
				}

				return false;
			};
			Controls.RemoveHook = () => {
				if (strCleanupMode === "THROW") {
					throw CleanupError;
				}

				return false;
			};
			g_Assert.throws(() => CommandCallback({ Arguments: ["sjs_api_hooks", "pre", "4096", "confirm"] }), ErrorValue => {
				g_Assert.equal(ErrorValue.name, "AggregateError");
				g_Assert.equal(ErrorValue.errors.length, 2);

				if (strMode === "THROW") {
					g_Assert.equal(ErrorValue.errors[0], PrimaryError);
				}

				if (strCleanupMode === "THROW") {
					g_Assert.equal(ErrorValue.errors[1], CleanupError);
				}

				return true;
			});
			g_Assert.equal(Controls.Hooks.has(unNextHookID - 1), true, "Retain ownership when registration rollback cannot remove the hook");
			unScenarioCount += 1;
		}
	}

	Controls.RemoveHook = RemoveOwnedHook;
	Controls.RegisterCallback = () => true;
	CommandCallback({ Arguments: ["sjs_api_hooks", "pre", "4096", "confirm"] });
	const RetainedHook = Controls.Hooks.get(unNextHookID - 1);
	Controls.RemoveHook = () => false;
	CommandCallback({ Arguments: ["sjs_api_hooks", "remove", String(RetainedHook.ID)] });
	g_Assert.equal(Controls.Hooks.has(RetainedHook.ID), true);
	Controls.RemoveHook = RemoveOwnedHook;
	unScenarioCount += 1;

	const vecReleaseCounts = [];
	for (const PrimaryError of [
		new Error("primary"),
		null,
		undefined,
		false,
		0,
		"failure",
	]) {
		const CleanupError = new Error("secondary");
		const Counter = { Count: 0 };
		vecReleaseCounts.push(Counter);
		g_Assert.throws(() => Context.UseResource("controlled demo", () => {
			Counter.Count += 1;
			if (Counter.Count === 1) {
				throw CleanupError;
			}

			return true;
		}, () => {
			throw PrimaryError;
		}), ErrorValue => (ErrorValue.name === "AggregateError") && (ErrorValue.errors[0] === PrimaryError) && (ErrorValue.errors[1] === CleanupError));
		unScenarioCount += 1;
	}

	function RunDemoCallback(strName) {
		const OriginalLogResult = Context.LogResult;
		let unMatchCount = 0;
		Context.LogResult = (strLabel, Callback) => {
			if (strLabel === strName) {
				unMatchCount += 1;
				return Callback();
			}

			return undefined;
		};

		try {
			return Context.InspectEventAndHookAPI();
		} finally {
			Context.LogResult = OriginalLogResult;
			g_Assert.equal(unMatchCount, 1, "Execute the selected current example callback exactly once");
		}
	}

	const strResourcePath = "fixture/demo-events.res";
	const FileError = new Error("partial resource write");
	const RemoveError = new Error("resource removal");
	let unRemoveAttempts = 0;
	Controls.ResourceFile = {
		FullEventResourceFilePath: strResourcePath,

		WriteEventResourceFile() {
			Controls.Files.add(strResourcePath);
			throw FileError;
		},
	};
	Controls.Files.add(strResourcePath);
	g_Assert.throws(() => RunDemoCallback("events/resource.EventResourceFile"), /Refusing to overwrite/);
	g_Assert.equal(Controls.Files.has(strResourcePath), true);
	Controls.Files.delete(strResourcePath);
	unScenarioCount += 1;
	Controls.RemoveFile = strPath => {
		unRemoveAttempts += 1;
		if (unRemoveAttempts === 1) {
			throw RemoveError;
		}

		return Controls.Files.delete(strPath);
	};
	g_Assert.throws(() => RunDemoCallback("events/resource.EventResourceFile"), ErrorValue => (ErrorValue.errors[0] === FileError) && (ErrorValue.errors[1] === RemoveError));
	g_Assert.equal(Controls.Files.has(strResourcePath), true);
	unScenarioCount += 1;

	const vecKeyValues = [];
	const KeyValuesError = new Error("KeyValues inspection");

	function CreateOwnedKeyValues() {
		const Value = {
			Handle: {},
			ReleaseAttempts: 0,

			DestroyKeyValues() {
				this.ReleaseAttempts += 1;
				if (this.ReleaseAttempts === 1) {
					throw new Error("KeyValues release");
				}

				this.Handle = null;

				return true;
			},

			SetKeyValuesFloat() {
				throw KeyValuesError;
			},

			ConvertKeyValuesToString: () => "fixture",

			ConvertKeyValuesToObject() {
				throw KeyValuesError;
			},
		};
		vecKeyValues.push(Value);

		return Value;
	}

	Controls.CreateKeyValues = CreateOwnedKeyValues;
	g_Assert.throws(() => RunDemoCallback("keyvalues.KeyValues object"), ErrorValue => ErrorValue.errors[0] === KeyValuesError);
	unScenarioCount += 1;
	Controls.ParseKeyValues = CreateOwnedKeyValues;
	g_Assert.throws(() => RunDemoCallback("keyvalues.VDF roundtrip"), ErrorValue => ErrorValue.errors[0].errors[0] === KeyValuesError);
	g_Assert.equal(vecKeyValues.length, 3);
	unScenarioCount += 1;

	const vecChildKeyValues = [];
	const ChildReleaseError = new Error("child release");
	for (const bFailChildRelease of [false, true]) {
		const Root = {
			Handle: {},

			DestroyKeyValues() {
				this.Handle = null;

				return true;
			},

			CreateChild(strName) {
				const Child = {
					Handle: {},
					ReleaseAttempts: 0,

					DestroyKeyValues() {
						this.ReleaseAttempts += 1;
						if (bFailChildRelease && (this.ReleaseAttempts === 1)) {
							throw ChildReleaseError;
						}

						this.Handle = null;

						return Root.Handle !== null;
					},
				};
				vecChildKeyValues.push({ Name: strName, Child });

				return Child;
			},

			SetKeyValuesFloat(strName) {
				return this.CreateChild(strName);
			},

			SetKeyValuesColor(strName) {
				return this.CreateChild(strName);
			},

			SetKeyValuesAddress(strName, unAddress) {
				g_Assert.equal(unAddress, 0x1234n);

				return this.CreateChild(strName);
			},

			GetKeyValuesColor: () => ({ Alpha: 255, Red: 64, Green: 192, Blue: 255, ConvertColorToHexString: () => "40C0FF" }),
			ConvertKeyValuesToObject: () => ({ Nested: { Label: "events-hooks" } }),
			GetKeyValuesBoolean: () => true,
			GetKeyValuesAddress: () => 0x1234n,

			*[Symbol.iterator]() {
				yield "Scale";
			},
		};
		Controls.CreateKeyValues = () => Root;

		if (bFailChildRelease) {
			g_Assert.throws(() => RunDemoCallback("keyvalues.KeyValues object"), ErrorValue => ErrorValue === ChildReleaseError);

		} else {
			RunDemoCallback("keyvalues.KeyValues object");
			g_Assert.deepEqual(vecChildKeyValues.map(Entry => Entry.Name), ["Scale", "Color", "Address"]);
			g_Assert.ok(vecChildKeyValues.every(Entry => (Entry.Child.Handle === null) && (Entry.Child.ReleaseAttempts === 1)));
		}

		g_Assert.equal(Root.Handle, null);
		unScenarioCount += 1;
	}

	const TemporaryEntityError = new Error("template inspection");
	let unTemporaryEntityReleaseAttempts = 0;
	Controls.TemporaryEntityHook = {
		Phase: "PreCreate",
		Callback: null,
		Template: {
			get Name() {
				throw TemporaryEntityError;
			},
		},

		RegisterTemporaryEntityHook(Callback) {
			this.Callback = Callback;

			return Callback;
		},

		UnregisterTemporaryEntityHook() {
			unTemporaryEntityReleaseAttempts += 1;
			if (unTemporaryEntityReleaseAttempts === 1) {
				return false;
			}

			this.Callback = null;

			return true;
		},
	};
	g_Assert.throws(() => RunDemoCallback("effects/hooks.TempEntityPreHook"), ErrorValue => ErrorValue.errors[0] === TemporaryEntityError);
	unScenarioCount += 1;

	let unReentrantCalls = 0;
	let unDeferredCalls = 0;
	Context.TrackResource("reentrant cleanup", () => {
		unReentrantCalls += 1;
		Exports.Unload();
		Context.TrackResource("deferred cleanup", () => {
			unDeferredCalls += 1;

			return true;
		});

		return true;
	});

	const ReleaseError = new Error("first cleanup fails");
	let unReleaseAttempts = 0;
	Context.TrackResource("retry cleanup", () => {
		unReleaseAttempts += 1;
		if (unReleaseAttempts === 1) {
			throw ReleaseError;
		}

		return true;
	});
	g_Assert.throws(Exports.Unload, ErrorValue => ErrorValue === ReleaseError);
	g_Assert.equal(Controls.Hooks.size, 0, "A failed resource must not prevent independent hook cleanup");
	g_Assert.equal(unReentrantCalls, 1);
	g_Assert.equal(unDeferredCalls, 0, "New resources wait for the next cleanup snapshot");
	g_Assert.ok(vecReleaseCounts.every(Counter => Counter.Count === 2));
	g_Assert.equal(Controls.Files.has(strResourcePath), false);
	g_Assert.equal(unRemoveAttempts, 2);
	g_Assert.ok(vecKeyValues.every(Value => (Value.Handle === null) && (Value.ReleaseAttempts === 2)));
	g_Assert.equal(unTemporaryEntityReleaseAttempts, 2);
	g_Assert.equal(Controls.TemporaryEntityHook.Callback, null);
	g_Assert.ok(vecChildKeyValues.every(Entry => Entry.Child.Handle === null));
	g_Assert.equal(vecChildKeyValues.at(-1).Child.ReleaseAttempts, 2, "Release an invalidated child wrapper after its root was destroyed");
	Exports.Unload();
	g_Assert.equal(unReleaseAttempts, 2);
	g_Assert.equal(unDeferredCalls, 1);
	unScenarioCount += 1;

	console.log(`[hooks example] ${unScenarioCount} lifecycle/CLI/BigInt/timer scenarios; actual example and tick scheduler with controlled native dependencies, not native ABI execution`);
}

function CreateExampleLoggers(NativeLoggers) {
	const LoggerModule = { exports: {} };
	const Dependencies = {
		filesystem: {
			EnsureDirectoryExists: () => g_Assert.fail("Listener examples must not create logger directories."),
			SourceFile: { OpenSourceFile: () => g_Assert.fail("Listener examples must not write log files.") },
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

	g_ExampleLoggerScript.runInNewContext({ module: LoggerModule, require: RequireLoggerDependency }, { timeout: g_unExecutionTimeoutMilliseconds });

	return LoggerModule.exports;
}

function CheckHookExampleListeners(ListenerAPI) {
	const strExamplePath = g_Path.join(g_strRootPath, "examples", "plugins", "disabled", "api-events-hooks", "index.js");
	const strExampleSource = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecImports = [...strExampleSource.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\("listeners"\);/g)];
	g_Assert.equal(vecImports.length, 1);
	for (const strBinding of vecImports[0][1].split(",").map((strValue) => strValue.trim()).filter(Boolean)) {
		const strExportName = strBinding.split(":")[0].trim();
		g_Assert.ok(Object.hasOwn(ListenerAPI, strExportName), `Hook example imports absent listeners.${strExportName}`);
	}

	function VerifyLiteralHookLogs(strSource) {
		const strStart = "function OnLevelInitialize(";
		const strEnd = "function InspectTickAPI(";
		g_Assert.equal(strSource.split(strStart).length, 2);
		g_Assert.equal(strSource.split(strEnd).length, 2);
		const unStart = strSource.indexOf(strStart);
		const unEnd = strSource.indexOf(strEnd);
		g_Assert(unEnd > unStart);

		const strData = "100%% %s %d %j $&";
		const vecLogs = [];
		let unCallbackCalls = 0;
		const Loggers = CreateExampleLoggers({
			LogInfo: strMessage => vecLogs.push({ Severity: "INFO", Message: strMessage }),
			LogWarning: strMessage => vecLogs.push({ Severity: "WARNING", Message: strMessage }),
			LogError: strMessage => vecLogs.push({ Severity: "ERROR", Message: strMessage }),
		});
		const Context = g_VM.createContext({
			...Loggers,
			InputText: strData,
			Event: {
				EventName: strData,
				Address: 0x1234n,
				GetEventInteger(strKey, nDefaultValue) {
					g_Assert.equal(strKey, "userid");
					g_Assert.equal(nDefaultValue, 0);

					return 73;
				},
			},
			PreContext: { Name: strData, Address: 0x1234n },
			WarningRecord: { Category: strData, Message: strData },
			Exception: { Name: strData, Message: strData },
			Callback() {
				unCallbackCalls += 1;

				return strData;
			},
			GetInt(unAddress, strKey, nDefaultValue) {
				g_Assert.equal(unAddress, 0x1234n);
				g_Assert.equal(strKey, "userid");
				g_Assert.equal(nDefaultValue, 0);

				return 7;
			},
			SetInt(unAddress, strKey, nValue) {
				g_Assert.equal(unAddress, 0x1234n);
				g_Assert.equal(strKey, "userid");
				g_Assert.equal(nValue, 7);

				return true;
			},
			EventAction: { Continue: 0 },
		});
		new g_VM.Script(strSource.slice(unStart, unEnd), { filename: strExamplePath + ":C1Logging" }).runInContext(Context, { timeout: g_unExecutionTimeoutMilliseconds });

		const vecCases = [
			{ Program: "OnLevelInitialize(InputText)", Severity: "INFO", Message: "Level initialization: " + strData, ReturnValue: undefined },
			{ Program: "OnPlayerDeath(Event)", Severity: "INFO", Message: strData + ": Address=4660, UserID=73", ReturnValue: undefined },
			{ Program: "OnPrePlayerDeath(PreContext)", Severity: "INFO", Message: "Pre-event " + strData + ": Address=4660, UserID=7", ReturnValue: 0 },
			{ Program: "OnWarning(WarningRecord)", Severity: "WARNING", Message: "Warning event: " + strData + ": " + strData, ReturnValue: undefined },
			{ Program: "OnException(Exception)", Severity: "ERROR", Message: "Exception event: " + strData + ": " + strData, ReturnValue: undefined },
			{ Program: "LogResult(InputText, Callback)", Severity: "INFO", Message: strData + ": " + strData, ReturnValue: strData },
		];
		for (const Case of vecCases) {
			const ReturnValue = g_VM.runInContext(Case.Program, Context, { timeout: g_unExecutionTimeoutMilliseconds });
			g_Assert.strictEqual(ReturnValue, Case.ReturnValue);
			g_Assert.deepEqual(vecLogs.at(-1), { Severity: Case.Severity, Message: Case.Message }, "Hook log data must remain literal through actual JavaScript formatter");
		}

		g_Assert.equal(unCallbackCalls, 1, "LogResult evaluates its callback exactly once");
		g_Assert.equal(vecLogs.length, 6);

		return 6;
	}

	for (const Profile of [
		{ AddressSize: 4, RejectRegistration: false },
		{ AddressSize: 4, RejectRegistration: true },
		{ AddressSize: 8, RejectRegistration: false },
		{ AddressSize: 8, RejectRegistration: true },
	]) {
		const bRejectRegistration = Profile.RejectRegistration;
		const unNativeEventCountBefore = g_mapNativeEvents.size;
		const unLevelListenerCountBefore = ListenerAPI.LevelInitManager.ListenerCount;
		const unPluginListenerCountBefore = ListenerAPI.PluginUnloadingManager.ListenerCount;
		const vecMessages = [];
		const vecErrors = [];
		const vecFunctionAddresses = [];
		const TickFixture = CreateExampleTickFixture(ListenerAPI);
		const Controls = {
			Calls: [],
			Hooks: new Map(),
			Files: new Set(),
			LogInfo: () => true,
			CreateHook: () => null,

			RemoveHook() {
				throw new Error("Unexpected native removal");
			},

			CallFunction() {
				throw new Error("Unexpected native call");
			},
		};
		let CommandCallback = null;
		let unUnregisterCount = 0;

		class EventVariable {
		}

		// These scenarios execute lifecycle/address paths only; import-only modules are not functional doubles.
		const ImportOnlyModule = Object.freeze({});
		const Modules = {
			bitbuffers: ImportOnlyModule,
			colors: {
				Color: function Color(unRed, unGreen, unBlue) {
					return { Red: unRed, Green: unGreen, Blue: unBlue, Alpha: 255 };
				},
			},
			"effects/hooks": {
				TempEntityPreHook: function TemporaryEntityPreHook(strName) {
					g_Assert.equal(strName, "BeamPoints");

					return Controls.TemporaryEntityHook;
				},
			},
			events: ImportOnlyModule,
			"events/custom": ImportOnlyModule,
			"events/manager": ImportOnlyModule,
			"events/resource": {
				EventResourceFile: function EventResourceFile(strPath, Options) {
					g_Assert.equal(strPath, "sourcejs/api-events-hooks");
					g_Assert.equal(Options.EventName, "SourceJSAPIExample");

					return Controls.ResourceFile;
				},
			},
			"events/variable": { BoolVariable: EventVariable, ShortVariable: EventVariable, StringVariable: EventVariable },
			filesystem: { DoesFileExist: strPath => Controls.Files.has(strPath), RemoveFile: strPath => Controls.RemoveFile(strPath) },
			keyvalues: {
				CreateKeyValues: () => Controls.CreateKeyValues(),
				KeyValues: { CreateKeyValuesFromBuffer: () => Controls.ParseKeyValues() },
			},
			listeners: ListenerAPI,
			"listeners/tick": TickFixture.API,
			memory: {
				Convention: { Fastcall: "fastcall" },
				DataType: { Address: "address", Int: "int", String: "string" },
				Register: { RCX: "RCX", ECX: "ECX" },
			},
			"memory/helpers": { ADDRESS_SIZE: Profile.AddressSize },
			"memory/hooks": {
				GetHookList: () => [...Controls.Hooks.values()],

				CreateFunctionHook: (Options) => {
					g_Assert.equal(typeof Options.Address, "bigint");
					vecFunctionAddresses.push(Options.Address);
					Controls.Calls.push("CreateHook");

					return Controls.CreateHook(Options);
				},

				RemoveHook(unHookID) {
					Controls.Calls.push("RemoveHook");

					return Controls.RemoveHook(unHookID);
				},

				CallFunction(Options) {
					Controls.Calls.push("CallFunction");

					return Controls.CallFunction(Options);
				},
			},
			source: {
				RegisterCommand: (strName, Callback) => {
					g_Assert.equal(strName, "sjs_api_hooks");
					CommandCallback = Callback;

					return true;
				},

				UnregisterCommand: (strName, Callback) => {
					g_Assert.equal(strName, "sjs_api_hooks");
					g_Assert.equal(Callback, CommandCallback);
					unUnregisterCount += 1;

					return true;
				},
			},
			"events/listener": { RegisterEventListener: () => true, UnregisterEventListener: () => true },
			"memory/hooks/entities": ImportOnlyModule,
			"memory/hooks/events": { OnPre: () => true, OffPre: () => true },
			"memory/hooks/exceptions": { On: () => true, Off: () => true },
			"memory/hooks/messages": ImportOnlyModule,
			"memory/hooks/warnings": { On: () => true, Off: () => true },
			"memory/manager": {
				GetBinary() {
					throw new Error("Unexpected binary lookup");
				},

				GetBinarySymbol() {
					throw new Error("Unexpected symbol lookup");
				},

				ScanBinary() {
					throw new Error("Unexpected binary scan");
				},
			},
			loggers: CreateExampleLoggers({
				LogInfo(strMessage) {
					vecMessages.push(strMessage);

					return Controls.LogInfo(strMessage);
				},

				LogWarning: () => undefined,
				LogError: strMessage => vecErrors.push(strMessage),
			}),
		};
		const Exports = {};
		const Context = g_VM.createContext({
			exports: Exports,

			require(strName) {
				if (!Object.hasOwn(Modules, strName)) {
					throw new Error(`Unexpected hook example module: ${strName}`);
				}

				return Modules[strName];
			},
		});
		const Load = () => g_VM.runInContext(strExampleSource, Context, { filename: strExamplePath, timeout: g_unExecutionTimeoutMilliseconds });
		g_bRejectNextRegistration = bRejectRegistration;
		try {
			if (bRejectRegistration) {
				g_Assert.throws(Load, /register|listener|bridge/i);

			} else {
				Load();
				g_Assert.equal(typeof Exports.Unload, "function");
				g_Assert.equal(Object.hasOwn(Exports, "unload"), false, "No lowercase lifecycle alias");
				g_Assert.equal(ListenerAPI.LevelInitManager.ListenerCount, unLevelListenerCountBefore + 1);
				g_Assert.equal(ListenerAPI.PluginUnloadingManager.ListenerCount, unPluginListenerCountBefore + 1);

				const unMaximumAddress = (1n << BigInt(Profile.AddressSize * 8)) - 1n;
				for (const strAddress of ["4096", String(unMaximumAddress)]) {
					g_Assert.throws(() => CommandCallback({ Arguments: ["sjs_api_hooks", "pre", strAddress, "confirm"] }), /Unable to create the native function hook/);
				}

				g_Assert.deepEqual(vecFunctionAddresses, [4096n, unMaximumAddress]);
				for (const strAddress of [
					"0",
					"-1",
					"1.5",
					"NaN",
					"Infinity",
					String(unMaximumAddress + 1n),
				]) {
					g_Assert.doesNotThrow(() => CommandCallback({ Arguments: ["sjs_api_hooks", "pre", strAddress, "confirm"] }));
				}

				g_Assert.equal(vecFunctionAddresses.length, 2);

				ListenerAPI.LevelInitManager.EmitListenerEvent("fixture_map");
				g_Assert.ok(vecMessages.some((strMessage) => strMessage.includes("Level initialization: fixture_map")));
				ListenerAPI.PluginUnloadingManager.EmitListenerEvent("another-plugin");
				g_Assert.equal(unUnregisterCount, 0);
				CheckHookExampleOwnership(Context, Controls, TickFixture, CommandCallback, Exports, ListenerAPI);
				ListenerAPI.PluginUnloadingManager.EmitListenerEvent("api-events-hooks");
				Exports.Unload();
			}
		} finally {
			g_bRejectNextRegistration = false;
			try {
				Exports.Unload?.();
			} finally {
				TickFixture.API.DisposeTickListeners();
			}
		}

		g_Assert.equal(unUnregisterCount, 1);
		g_Assert.equal(ListenerAPI.LevelInitManager.ListenerCount, unLevelListenerCountBefore);
		g_Assert.equal(ListenerAPI.PluginUnloadingManager.ListenerCount, unPluginListenerCountBefore);
		g_Assert.equal(g_mapNativeEvents.size, unNativeEventCountBefore);
		g_Assert.deepEqual(vecErrors, []);
	}

	g_Assert.equal(VerifyLiteralHookLogs(strExampleSource), 6);

	const vecLiteralLogCalls = [
		'LogInfo("%s", `Level initialization: ${strMapName}`);',
		'LogInfo("%s", `${Event.EventName}: Address=${Event.Address}, UserID=${Event.GetEventInteger("userid", 0)}`);',
		'LogInfo("%s", `Pre-event ${Context.Name}: Address=${Context.Address}, UserID=${nUserID}`);',
		'LogWarning("%s", `Warning event: ${WarningRecord.Category}: ${WarningRecord.Message}`);',
		'LogError("%s", `Exception event: ${Exception.Name}: ${Exception.Message}`);',
		'LogInfo("%s", `${strLabel}: ${String(Value)}`);',
	];
	for (const strLiteralCall of vecLiteralLogCalls) {
		g_Assert.equal(strExampleSource.split(strLiteralCall).length, 2, "Unique literal-data hook logger call");
		const strLegacySource = strExampleSource.replace(strLiteralCall, () => strLiteralCall.replace('("%s", ', "("));
		g_Assert.throws(() => VerifyLiteralHookLogs(strLegacySource), Failure => (Failure instanceof g_Assert.AssertionError) && Failure.message.includes("Hook log data must remain literal"), "Each restored format-string call must fail for changed data, not an unrelated error");
	}

	const strManagerPath = g_Path.join(g_strPackageRootPath, "events", "manager.js");
	const ManagerModule = { exports: {} };
	const RequireManagerDependency = strName => {
		if (strName === "internal/runtime") {
			return {
				GetModule(strModuleName) {
					g_Assert.equal(strModuleName, "events/manager");

					return { FireEvent: () => g_Assert.fail("Local event-dispatch example must not call native FireEvent.") };
				},
			};
		}

		if (strName === "memory/hooks/exceptions") {
			return {
				EXCEPTION_HOOKS: {
					PrintException(ErrorValue) {
						throw ErrorValue;
					},
				},
			};
		}

		throw new Error("Unexpected local event-manager dependency: " + strName);
	};
	new g_VM.Script(g_FileSystem.readFileSync(strManagerPath, "utf8"), { filename: strManagerPath }).runInNewContext({ module: ManagerModule, require: RequireManagerDependency }, { timeout: g_unExecutionTimeoutMilliseconds });

	const strHelperStart = "function TrackResource(";
	const strHelperEnd = "function ReleaseKeyValuesResource(";
	const strDispatchStart = '\tLogResult("events/manager local dispatch",';
	const strDispatchEnd = '\tLogResult("keyvalues.KeyValues object",';
	for (const strMarker of [strHelperStart, strHelperEnd, strDispatchStart, strDispatchEnd]) {
		g_Assert.equal(strExampleSource.split(strMarker).length, 2, "Unique current-chunk local event-dispatch marker");
	}

	const strLocalDispatch = strExampleSource.slice(strExampleSource.indexOf(strHelperStart), strExampleSource.indexOf(strHelperEnd)) + strExampleSource.slice(strExampleSource.indexOf(strDispatchStart), strExampleSource.indexOf(strDispatchEnd));
	const setResources = new Set();
	let LocalDispatchResult = null;
	let unDispatchInspections = 0;
	new g_VM.Script(strLocalDispatch, { filename: strExamplePath + ":C1LocalDispatch" }).runInNewContext({
		EventListener: ManagerModule.exports.EventListener,
		EventManager: ManagerModule.exports.EventManager,
		g_setPendingResources: setResources,
		LogResult(strLabel, Callback) {
			g_Assert.equal(strLabel, "events/manager local dispatch");
			unDispatchInspections += 1;
			LocalDispatchResult = Callback();
		},
	}, { timeout: g_unExecutionTimeoutMilliseconds });
	g_Assert.equal(unDispatchInspections, 1);
	g_Assert.equal(LocalDispatchResult.Dispatched, true);
	g_Assert.equal(LocalDispatchResult.EmptyManagerDispatch, false);
	g_Assert.equal(LocalDispatchResult.ObservedValue, 11);
	g_Assert.equal(setResources.size, 0, "Local callback removed from actual Array-backed listener");

	function VerifyHookCallbackSummary(strSource) {
		const strSummaryStart = "function SummarizeValue(";
		const strSummaryEnd = "function RunHookExample(";
		const strCallbackStart = "\t\tconst Callback = (HookContext) => {";
		const strCallbackEnd = "\t\tconst Hook = CreateFunctionHook(HookOptions);";
		for (const strMarker of [strSummaryStart, strSummaryEnd, strCallbackStart, strCallbackEnd]) {
			g_Assert.equal(strSource.split(strMarker).length, 2, "Unique current C2 hook-callback marker");
		}

		const strCallbackProgram = strSource.slice(strSource.indexOf(strSummaryStart), strSource.indexOf(strSummaryEnd)) + strSource.slice(strSource.indexOf(strCallbackStart), strSource.indexOf(strCallbackEnd)) + "\nCallback;";
		for (const [unAddressByteCount, strPhase, bUseTrampoline] of [
			[4, "pre", false],
			[4, "post", false],
			[4, "pre", true],
			[8, "pre", false],
			[8, "post", false],
			[8, "pre", true],
		]) {
			const vecMessages = [];
			const Loggers = CreateExampleLoggers({
				LogInfo: strMessage => vecMessages.push(strMessage),
				LogWarning: () => g_Assert.fail("Unexpected hook-callback warning."),
				LogError: () => g_Assert.fail("Unexpected hook-callback error."),
			});
			const Callback = new g_VM.Script(strCallbackProgram, { filename: strExamplePath + ":C2Callback" }).runInNewContext({ ...Loggers, vecCommandArguments: [strPhase], bUseTrampoline, ADDRESS_SIZE: unAddressByteCount, g_unPreviewEntryLimit: 8 }, { timeout: g_unExecutionTimeoutMilliseconds });
			let unTrampolineCalls = 0;
			const HookContext = {
				Arguments: [7, "value"],
				Registers: { RDX: 2n, EDX: 2n },
				CallHookTrampoline(Options) {
					g_Assert.notEqual(Options.Arguments, this.Arguments);
					g_Assert.notEqual(Options.Registers, this.Registers);
					unTrampolineCalls += 1;

					return { ReturnValue: 7, Registers: { RDX: 2n, EDX: 2n } };
				},
			};
			// Deliberately noncanonical extra metadata is malformed data, never a logger format.
			Object.defineProperty(HookContext, "Extra100%%", { enumerable: true, value: true });
			g_Assert.equal(Callback(HookContext), bUseTrampoline ? 7 : undefined);
			g_Assert.equal(unTrampolineCalls, bUseTrampoline ? 1 : 0);
			g_Assert.equal(vecMessages[0], strPhase + " hook fired: { Arguments, Registers, CallHookTrampoline, Extra100%% }", "Hook callback summary metadata must remain literal through actual logger formatter");
			g_Assert.equal(vecMessages.length, bUseTrampoline ? 3 : 1);
		}

		return 6;
	}

	g_Assert.equal(VerifyHookCallbackSummary(strExampleSource), 6);

	const strLiteralCallbackLog = 'LogInfo("%s", `${vecCommandArguments[0]} hook fired: ${SummarizeValue(HookContext)}`);';
	g_Assert.equal(strExampleSource.split(strLiteralCallbackLog).length, 2);
	const strLegacyCallbackSource = strExampleSource.replace(strLiteralCallbackLog, () => strLiteralCallbackLog.replace('LogInfo("%s", ', "LogInfo("));
	g_Assert.throws(() => VerifyHookCallbackSummary(strLegacyCallbackSource), Failure => (Failure instanceof g_Assert.AssertionError) && Failure.message.includes("Hook callback summary metadata must remain literal"), "Restored callback format string must fail for changed summary data, not an unrelated error");

	console.log("[hooks example] callback summary: six x86/x64 pre/post/trampoline profiles and one restored-source control passed; actual JavaScript callback/formatter, controlled native trampoline.");

	console.log("[hooks example] literal logging: six source-function profiles and six restored-source regressions passed; actual JavaScript formatter, controlled native sinks.");
	console.log("[hooks example] local dispatch: actual Array-backed EventListener and Map-backed EventManager with copied current example/resource helpers; no native event IO.");
}

function CheckManagerEnvelopeOwnArguments(ListenerModule) {
	const OriginalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "Arguments");
	const Manager = new ListenerModule.ListenerManager("OwnArguments", { AutoBridge: false });
	const vecReceivedArguments = [];
	const RecordArguments = (...vecArguments) => vecReceivedArguments.push(vecArguments);
	let unInheritedReadCount = 0;
	Manager.RegisterListener(RecordArguments);
	try {
		const vecInheritedDescriptors = [
			{ configurable: true, value: [17], writable: true },
			{
				configurable: true,
				get() {
					unInheritedReadCount += 1;

					return [17];
				},
			},
			{
				configurable: true,
				get() {
					unInheritedReadCount += 1;
					throw new Error("Inherited Arguments getter must not run.");
				},
			},
		];
		for (const Descriptor of vecInheritedDescriptors) {
			Object.defineProperty(Object.prototype, "Arguments", Descriptor);
			g_Assert.equal(Manager.RuntimeCallback("OtherEvent", "not-json"), 0);
			const unReceivedCount = vecReceivedArguments.length;
			for (const strInvalidEnvelope of ["{}", '{"Other":1}', '{"__proto__":{"Arguments":[17]}}']) {
				g_Assert.throws(() => Manager.RuntimeCallback("OwnArguments", strInvalidEnvelope), TypeError);
			}

			g_Assert.equal(vecReceivedArguments.length, unReceivedCount, "Inherited Arguments must not dispatch callbacks");
			g_Assert.equal(Manager.RuntimeCallback("OwnArguments", '{"Arguments":[73]}'), 1);
			g_Assert.deepEqual(vecReceivedArguments.at(-1), [73]);
			g_Assert.equal(unInheritedReadCount, 0, "Envelope validation must not invoke inherited getters");
		}
	} finally {
		if (OriginalDescriptor === undefined) {
			delete Object.prototype.Arguments;
		} else {
			Object.defineProperty(Object.prototype, "Arguments", OriginalDescriptor);
		}

		Manager.ClearListeners();
	}
}

function CheckManagerFieldsAndOptions(ListenerModule) {
	CheckManagerEnvelopeOwnArguments(ListenerModule);

	for (const InvalidOptions of [
		null,
		[],
		true,
		"options",
		() => undefined,
	]) {
		g_Assert.throws(() => new ListenerModule.ListenerManager("InvalidOptions", InvalidOptions), TypeError);
	}

	g_Assert.throws(() => new ListenerModule.ListenerManager("UnknownOption", { Unknown: true }), TypeError);
	g_Assert.throws(() => new ListenerModule.ListenerManager("SymbolOption", { [Symbol("Unknown")]: true }), TypeError);
	g_Assert.throws(() => new ListenerModule.ListenerManager("UndefinedOption", { AutoBridge: undefined }), TypeError);
	const InheritedOptions = Object.create({ AutoBridge: false, Unknown: true });
	const InheritedManager = new ListenerModule.ListenerManager("InheritedOptions", InheritedOptions);
	g_Assert.equal(InheritedManager.AutoBridge, true);

	const Manager = new ListenerModule.ListenerManager("FieldContract", { AutoBridge: false });
	for (const strFieldName of [
		"EventName",
		"ListenerCallbacks",
		"AutoBridge",
		"RuntimeCallback",
		"Initialized",
	]) {
		const Descriptor = Object.getOwnPropertyDescriptor(Manager, strFieldName);
		g_Assert.equal(Descriptor.writable, true, strFieldName);
	}

	for (const strGetterName of ["ListenerCount", "Empty"]) {
		const Descriptor = Object.getOwnPropertyDescriptor(ListenerModule.ListenerManager.prototype, strGetterName);
		g_Assert.equal(typeof Descriptor.get, "function", strGetterName);
		g_Assert.equal(Descriptor.set, undefined, strGetterName);
	}

	g_Assert.throws(() => {
		Manager.ListenerCount = 2;
	}, TypeError);
	g_Assert.equal(Manager.RuntimeCallback("OtherEvent", "not-json"), 0);

	for (const strInvalidEnvelope of [
		"",
		"plain",
		"null",
		"[]",
		"1",
		"{}",
		'{"Arguments":{}}',
	]) {
		g_Assert.throws(() => Manager.RuntimeCallback("FieldContract", strInvalidEnvelope), TypeError);
	}

	const vecReceivedArguments = [];
	const RecordArguments = (...vecArguments) => {
		vecReceivedArguments.push(vecArguments);
	};
	Manager.RegisterListener(RecordArguments);
	g_Assert.equal(Manager.RuntimeCallback("FieldContract", '{"Arguments":[{"$SourceJSBigInt":"18446744073709551615"},{"$SourceJSBigInt":"-9223372036854775808"}]}'), 1);
	g_Assert.deepEqual(vecReceivedArguments[0], [0xFFFFFFFFFFFFFFFFn, -0x8000000000000000n]);
	g_Assert.equal(Manager.RuntimeCallback("FieldContract", '{"Arguments":[{"Address":{"$SourceJSBigInt":"1"}},[{"$SourceJSBigInt":"2"}],{"$SourceJSBigInt":"3","Extra":true},{"$SourceJSBigInt":4}]}'), 1);
	g_Assert.deepEqual(vecReceivedArguments[1], [
		{ Address: { $SourceJSBigInt: "1" } },
		[{ $SourceJSBigInt: "2" }],
		{ $SourceJSBigInt: "3", Extra: true },
		{ $SourceJSBigInt: 4 },
	]);
	g_Assert.throws(() => Manager.RuntimeCallback("FieldContract", '{"Arguments":[{"$SourceJSBigInt":"not-an-integer"}]}'), TypeError);
	g_Assert.equal(vecReceivedArguments.length, 2);
	g_Assert.strictEqual(Manager.ClearListeners(), Manager);
	g_Assert.equal(Manager.Empty, true);

	const InitializationError = new Error("Injected partial initializer failure.");
	const PartialManager = new ListenerModule.ListenerManager("PartialInitializer");
	let bFinalizerCalled = false;
	PartialManager.InitializeListenerManager = () => {
		throw InitializationError;
	};
	PartialManager.FinalizeListenerManager = () => {
		bFinalizerCalled = true;
	};
	g_Assert.throws(() => PartialManager.RegisterListener(RecordArguments), ErrorValue => ErrorValue === InitializationError);
	g_Assert.equal(bFinalizerCalled, false, "an incomplete initializer owns its partial cleanup");
	g_Assert.equal(PartialManager.Empty, true);
	g_Assert.equal(PartialManager.Initialized, false);
}

function CheckManagerLifecycleReentrancy(ListenerModule) {
	let unScenarioCount = 0;
	for (const bAutoBridge of [true, false]) {
		for (const strPhase of ["Initialize", "Finalize", "Rollback"]) {
			if ((strPhase === "Rollback") && !bAutoBridge) {
				continue;
			}

			for (const strOperation of ["Register", "Unregister", "Clear"]) {
				const strEventName = `LifecycleGuard${unScenarioCount}`;
				const Manager = new ListenerModule.ListenerManager(strEventName, { AutoBridge: bAutoBridge });
				const PrimaryCallback = () => undefined;
				const SecondaryCallback = () => undefined;
				const Mutations = {
					Register: () => Manager.RegisterListener(SecondaryCallback),
					Unregister: () => Manager.UnregisterListener(PrimaryCallback),
					Clear: () => Manager.ClearListeners(),
				};
				let unInitializeCalls = 0;
				let unFinalizeCalls = 0;
				const CheckNestedMutation = () => {
					g_Assert.throws(Mutations[strOperation], Failure => (Failure instanceof Error) && Failure.message.includes("cannot change during a lifecycle transition"), "ListenerManager lifecycle transition must reject nested mutation.");
				};
				Manager.InitializeListenerManager = () => {
					++unInitializeCalls;
					if ((strPhase === "Initialize") && (unInitializeCalls === 1)) {
						CheckNestedMutation();
					}
				};
				Manager.FinalizeListenerManager = () => {
					++unFinalizeCalls;
					if ((strPhase !== "Initialize") && (unFinalizeCalls === 1)) {
						CheckNestedMutation();
					}
				};

				if (strPhase === "Rollback") {
					g_bRejectNextRegistration = true;
					g_Assert.throws(() => Manager.RegisterListener(PrimaryCallback), /runtime bridge registration was rejected/);
					g_Assert.equal(Manager.Empty, true);
					g_Assert.equal(Manager.Initialized, false);

				} else {
					g_Assert.strictEqual(Manager.RegisterListener(PrimaryCallback), PrimaryCallback);
					g_Assert.equal(Manager.ListenerCount, 1);
					g_Assert.equal(Manager.Initialized, true);
					g_Assert.equal(ListenerModule.GetListenerCount(strEventName), bAutoBridge ? 1 : 0);
					g_Assert.equal(Manager.UnregisterListener(PrimaryCallback), true);
				}

				delete Manager.InitializeListenerManager;
				delete Manager.FinalizeListenerManager;
				g_Assert.strictEqual(Manager.RegisterListener(SecondaryCallback), SecondaryCallback);
				g_Assert.equal(Manager.UnregisterListener(SecondaryCallback), true);
				g_Assert.equal(Manager.Empty, true);
				g_Assert.equal(Manager.Initialized, false);
				g_Assert.equal(ListenerModule.GetListenerCount(strEventName), 0);
				++unScenarioCount;
			}
		}
	}

	const vecFailures = [
		undefined,
		null,
		false,
		0,
		0n,
		"",
		NaN,
		Symbol("lifecycle"),
		new Error("Controlled lifecycle failure."),
	];
	for (const bAutoBridge of [true, false]) {
		for (const strPhase of ["Initialize", "Finalize"]) {
			for (const bGetterFailure of [false, true]) {
				for (const Failure of vecFailures) {
					const strEventName = `LifecycleFailureReset${unScenarioCount}`;
					const Manager = new ListenerModule.ListenerManager(strEventName, { AutoBridge: bAutoBridge });
					const PrimaryCallback = () => undefined;
					const SecondaryCallback = () => undefined;
					const strHookName = (strPhase === "Initialize") ? "InitializeListenerManager" : "FinalizeListenerManager";

					if (strPhase === "Finalize") {
						Manager.RegisterListener(PrimaryCallback);
					}

					if (bGetterFailure) {
						Object.defineProperty(Manager, strHookName, {
							configurable: true,

							get() {
								throw Failure;
							},
						});

					} else {
						Manager[strHookName] = () => {
							throw Failure;
						};
					}

					const Mutate = (strPhase === "Initialize") ? () => Manager.RegisterListener(PrimaryCallback) : () => Manager.UnregisterListener(PrimaryCallback);
					g_Assert.throws(Mutate, ActualFailure => Object.is(ActualFailure, Failure));
					g_Assert.equal(Manager.Initialized, strPhase === "Finalize");
					g_Assert.equal(Manager.ListenerCount, (strPhase === "Finalize") ? 1 : 0);
					delete Manager[strHookName];

					if (strPhase === "Initialize") {
						Manager.RegisterListener(PrimaryCallback);
					}

					Manager.RegisterListener(SecondaryCallback);
					g_Assert.equal(Manager.UnregisterListener(SecondaryCallback), true);
					g_Assert.equal(Manager.UnregisterListener(PrimaryCallback), true);
					g_Assert.equal(Manager.Empty, true);
					g_Assert.equal(ListenerModule.GetListenerCount(strEventName), 0);
					++unScenarioCount;
				}
			}
		}
	}

	g_Assert.equal(unScenarioCount, 87);
	console.log("[  OK  ] ListenerManager lifecycle guards: 87 reentrancy and failure-reset scenarios passed");
}

function CheckPayloadSerialization(ListenerModule) {
	const vecPayloads = [];
	const ReceivePayload = (strEventName, strPayload) => {
		g_Assert.equal(strEventName, "SerializationContract");
		vecPayloads.push(strPayload);
	};
	g_Assert.equal(ListenerModule.RegisterListener("SerializationContract", ReceivePayload), true);

	try {
		for (const Payload of [null, undefined, "raw\0payload", { Value: 2 }]) {
			g_Assert.equal(ListenerModule.EmitListenerEvent("SerializationContract", Payload), 1);
		}

		g_Assert.deepEqual(vecPayloads, ["", "", "raw\0payload", '{"Value":2}']);
		const CyclicRecord = {};
		CyclicRecord.Self = CyclicRecord;

		for (const InvalidPayload of [
			CyclicRecord,
			1n,
			{ Address: 1n },
			Symbol("payload"),
			() => undefined,
			{ toJSON: () => undefined },
		]) {
			g_Assert.throws(() => ListenerModule.EmitListenerEvent("SerializationContract", InvalidPayload), TypeError);
		}

		g_Assert.equal(vecPayloads.length, 4, "failed serialization must not dispatch");
	} finally {
		g_Assert.equal(ListenerModule.UnregisterListener("SerializationContract", ReceivePayload), true);
	}
}

function CheckNativeDispatchSnapshot(ListenerModule) {
	const vecInvocations = [];
	let bChangedSubscriptions = false;
	const AddedCallback = () => vecInvocations.push("Added");
	const RemovedCallback = () => vecInvocations.push("Removed");
	const FirstCallback = () => {
		vecInvocations.push("First");

		if (!bChangedSubscriptions) {
			bChangedSubscriptions = true;
			g_Assert.equal(ListenerModule.UnregisterListener("NativeSnapshot", RemovedCallback), true);
			g_Assert.equal(ListenerModule.RegisterListener("NativeSnapshot", AddedCallback), true);
		}
	};
	try {
		g_Assert.equal(ListenerModule.RegisterListener("NativeSnapshot", FirstCallback), true);
		g_Assert.equal(ListenerModule.RegisterListener("NativeSnapshot", RemovedCallback), true);
		g_Assert.equal(ListenerModule.EmitListenerEvent("NativeSnapshot", {}), 2);
		g_Assert.deepEqual(vecInvocations, ["First", "Removed"], "native dispatch uses a snapshot despite subscription mutation");
		g_Assert.equal(ListenerModule.EmitListenerEvent("NativeSnapshot", {}), 2);
		g_Assert.deepEqual(vecInvocations, ["First", "Removed", "First", "Added"]);
	} finally {
		// A failed or mutating scenario can already have removed a callback; removal is idempotent.
		for (const Callback of [FirstCallback, RemovedCallback, AddedCallback]) {
			ListenerModule.UnregisterListener("NativeSnapshot", Callback);
		}
	}
}

function CheckDispatchAndCleanup(ListenerModule) {
	const Manager = new ListenerModule.ListenerManager("SnapshotContract", { AutoBridge: false });
	const vecInvocations = [];
	let bChangedSubscriptions = false;
	const AddedCallback = () => {
		vecInvocations.push("Added");
	};
	const RemovedCallback = () => {
		vecInvocations.push("Removed");
	};
	const FirstCallback = () => {
		vecInvocations.push("First");

		if (!bChangedSubscriptions) {
			bChangedSubscriptions = true;
			Manager.UnregisterListener(RemovedCallback);
			Manager.RegisterListener(AddedCallback);
		}
	};
	Manager.RegisterListener(FirstCallback);
	Manager.RegisterListener(RemovedCallback);
	g_Assert.equal(Manager.NotifyListeners(), 2);
	g_Assert.deepEqual(vecInvocations, ["First", "Removed"]);
	g_Assert.equal(Manager.NotifyListeners(), 2);
	g_Assert.deepEqual(vecInvocations, ["First", "Removed", "First", "Added"]);
	Manager.ClearListeners();

	const CallbackError = new Error("Injected callback failure.");
	const ThrowingCallback = () => {
		throw CallbackError;
	};
	let unFollowingCallbackCount = 0;
	const FollowingCallback = () => {
		unFollowingCallbackCount += 1;
	};
	Manager.RegisterListener(ThrowingCallback);
	Manager.RegisterListener(FollowingCallback);
	g_Assert.throws(() => Manager.NotifyListeners(), ErrorValue => ErrorValue === CallbackError);
	g_Assert.equal(unFollowingCallbackCount, 0, "local dispatch stops at the throwing callback");
	Manager.ClearListeners();

	g_Assert.equal(ListenerModule.RegisterListener("NativeSnapshotFailure", ThrowingCallback), true);
	g_Assert.equal(ListenerModule.RegisterListener("NativeSnapshotFailure", FollowingCallback), true);

	try {
		g_Assert.equal(ListenerModule.EmitListenerEvent("NativeSnapshotFailure", { Arguments: [] }), 2);
		g_Assert.equal(unFollowingCallbackCount, 1, "native dispatch continues after a low-level exception");
		g_Assert.deepEqual(g_vecNativeCallbackFailures.splice(0), [CallbackError]);
	} finally {
		g_Assert.equal(ListenerModule.UnregisterListener("NativeSnapshotFailure", ThrowingCallback), true);
		g_Assert.equal(ListenerModule.UnregisterListener("NativeSnapshotFailure", FollowingCallback), true);
	}

	const PromiseValue = Promise.resolve(3);
	Manager.RegisterListener(() => PromiseValue);
	Manager.RegisterListener(FollowingCallback);
	g_Assert.equal(Manager.NotifyListeners(), 2, "local dispatch does not adopt a callback promise");
	g_Assert.equal(unFollowingCallbackCount, 2);
	Manager.ClearListeners();

	const ReadReceiver = function() {
		return this;
	};
	const Subscription = new ListenerModule.ListenerManagerDecorator(Manager, ReadReceiver);
	g_Assert.strictEqual(Subscription.InvokeListenerCallback(), Subscription);
	g_Assert.equal(Subscription.DisposeListener(), true);
	g_Assert.strictEqual(Subscription.InvokeListenerCallback(), Subscription, "direct invocation has no disposed-state guard");

	const PartialCleanupManager = new ListenerModule.ListenerManager("PartialCleanup");
	const FinalizationError = new Error("Injected last-listener finalization failure.");
	const RemainingCallback = () => undefined;
	PartialCleanupManager.RegisterListener(FirstCallback);
	PartialCleanupManager.RegisterListener(FollowingCallback);
	PartialCleanupManager.RegisterListener(RemainingCallback);
	PartialCleanupManager.FinalizeListenerManager = () => {
		throw FinalizationError;
	};
	g_Assert.throws(() => PartialCleanupManager.ClearListeners(), ErrorValue => ErrorValue === FinalizationError);
	g_Assert.deepEqual(PartialCleanupManager.GetAllListeners(), [RemainingCallback]);
	g_Assert.equal(PartialCleanupManager.Initialized, true);
	g_Assert.equal(ListenerModule.GetListenerCount("PartialCleanup"), 1, "last-listener rollback restores the bridge");

	delete PartialCleanupManager.FinalizeListenerManager;
	g_Assert.strictEqual(PartialCleanupManager.ClearListeners(), PartialCleanupManager);
	g_Assert.equal(PartialCleanupManager.Empty, true);
}

function CheckSpecializedDecisions(ListenerModule) {
	const ClientManager = ListenerModule.ClientConnectManager;
	const ServerManager = ListenerModule.ServerOutputManager;
	const strClientPayload = JSON.stringify({ Arguments: [-1, "FixturePlayer", "192.0.2.1", 64] });
	const strOutputPayload = JSON.stringify({ Arguments: [1, "FixtureOutput"] });
	g_Assert.equal(ClientManager.RuntimeCallback("OtherEvent", "invalid-json"), true);
	g_Assert.equal(ServerManager.RuntimeCallback("OtherEvent", "invalid-json"), 1);

	for (const Decision of [
		false,
		0,
		"",
		"Denied",
		{ Allowed: false },
		{ Allowed: true, RejectMessage: "" },
	]) {
		const Decide = () => Decision;
		ClientManager.RegisterListener(Decide);

		try {
			const Result = ClientManager.RuntimeCallback("ClientConnect", strClientPayload);
			g_Assert.equal((Result === false) || (typeof Result === "string"), true, "documented rejection forms must reject");
		} finally {
			ClientManager.UnregisterListener(Decide);
		}
	}

	for (const Decision of [
		true,
		1,
		0n,
		null,
		undefined,
		{ Allowed: 0 },
		{ Allowed: "false" },
		{ allowed: false },
		{ Reason: "ignored" },
		Promise.resolve(false),
	]) {
		const Decide = () => Decision;
		ClientManager.RegisterListener(Decide);

		try {
			g_Assert.equal(ClientManager.RuntimeCallback("ClientConnect", strClientPayload), true, "unsupported result forms and promises do not reject");
		} finally {
			ClientManager.UnregisterListener(Decide);
		}
	}

	let SharedContext = null;
	const Reject = ClientConnectContext => {
		SharedContext = ClientConnectContext;
		g_Assert.equal(ClientConnectContext.ClientIndex, -1, "signed sentinel acceptance is preserved");
		g_Assert.equal(ClientConnectContext.MaximumRejectLength, 64);

		return ClientConnectContext.RejectClientConnection("First reason");
	};
	const Accept = ClientConnectContext => {
		g_Assert.strictEqual(ClientConnectContext, SharedContext);

		return ClientConnectContext.AcceptClientConnection();
	};
	const RejectEmpty = ClientConnectContext => ClientConnectContext.RejectClientConnection();
	ClientManager.RegisterListener(Reject);
	ClientManager.RegisterListener(Accept);
	ClientManager.RegisterListener(RejectEmpty);

	try {
		g_Assert.equal(ClientManager.RuntimeCallback("ClientConnect", strClientPayload), "First reason", "later acceptance/empty message cannot undo prior rejection");
		g_Assert.equal(SharedContext.Allowed, false);
		g_Assert.equal(SharedContext.RejectMessage, "First reason");
		g_Assert.throws(() => SharedContext.RejectClientConnection(3), TypeError);
		g_Assert.throws(() => ClientManager.RuntimeCallback("ClientConnect", '{"Arguments":[1,"name","address",-1]}'), TypeError);
		g_Assert.throws(() => ClientManager.RuntimeCallback("ClientConnect", '{"Arguments":[1.5,"name","address",64]}'), TypeError);
	} finally {
		ClientManager.ClearListeners();
	}

	for (const Decision of [
		false,
		0,
		true,
		1,
		0.5,
		"0",
		0n,
		null,
		undefined,
		Promise.resolve(false),
	]) {
		const Decide = () => Decision;
		ServerManager.RegisterListener(Decide);

		try {
			g_Assert.equal(ServerManager.RuntimeCallback("ServerOutput", strOutputPayload), ((Decision === false) || (Decision === 0)) ? 0 : 1);
		} finally {
			ServerManager.UnregisterListener(Decide);
		}
	}

	const Block = () => false;
	const Allow = () => true;
	ServerManager.RegisterListener(Block);
	ServerManager.RegisterListener(Allow);

	try {
		g_Assert.equal(ServerManager.RuntimeCallback("ServerOutput", strOutputPayload), 0);
		g_Assert.equal(ServerManager.NotifyListeners(1, "FixtureOutput"), 2, "ordinary NotifyListeners returns a count, not suppression status");
	} finally {
		ServerManager.ClearListeners();
	}
}

function RunListenerDocumentationResourceScenario(ListenerModule, strSource, Scenario) {
	g_Assert.equal(g_mapNativeEvents.size, 0);
	const strForeignEventName = {
		HEALTH: "SourceJS:HealthChanged",
		ROUND: "SourceJS:RoundReady",
		LOCAL: "LocalPlayerChanged",
		CACHE: "SourceJS:CacheInvalidated",
		CLIENT: "ClientPutInServer",
	}[Scenario.Kind];
	const ForeignCallback = () => undefined;
	g_Assert.equal(ListenerModule.RegisterListener(strForeignEventName, ForeignCallback), true);
	const ForeignSubscription = (Scenario.Kind === "CLIENT") ? ListenerModule.RegisterClientPutInServerListener(ForeignCallback) : null;
	const mapBefore = new Map([...g_mapNativeEvents].map(([strName, vecCallbacks]) => [strName, [...vecCallbacks]]));
	const vecManagers = [];
	const vecSubscriptions = [];
	const vecRawCallbacks = [];
	let bPrimaryInjected = false;
	let bCleanupInjected = false;
	let unCleanupAttempts = 0;
	let unLogCount = 0;
	const CleanupFailure = new Error("Controlled listener example cleanup failed.");
	const FailOperation = strPhase => {
		if (Scenario.PrimaryActive && !bPrimaryInjected && (Scenario.Phase === strPhase)) {
			bPrimaryInjected = true;
			throw Scenario.PrimaryFailure;
		}
	};
	const CompleteCleanup = Result => {
		if (!Result || bCleanupInjected || (Scenario.CleanupMode === "NONE")) {
			return Result;
		}

		// The real JS owner/native double commits removal before this reporting fault.
		bCleanupInjected = true;

		if (Scenario.CleanupMode === "THROW") {
			throw CleanupFailure;
		}

		return false;
	};

	function CreateControlledListenerManager(...vecArguments) {
		const Manager = new ListenerModule.ListenerManager(...vecArguments);
		vecManagers.push(Manager);
		const Register = Manager.RegisterListener;
		Manager.RegisterListener = function RegisterControlledListener(Callback) {
			FailOperation("REGISTER");

			return Reflect.apply(Register, this, [Callback]);
		};
		const Emit = Manager.EmitListenerEvent;
		Manager.EmitListenerEvent = function EmitControlledListenerEvent(...vecValues) {
			FailOperation("EMIT");

			return Reflect.apply(Emit, this, vecValues);
		};
		const Notify = Manager.NotifyListeners;
		Manager.NotifyListeners = function NotifyControlledListeners(...vecValues) {
			const unResult = Reflect.apply(Notify, this, vecValues);
			FailOperation("NOTIFY");

			return unResult;
		};
		const Clear = Manager.ClearListeners;
		Manager.ClearListeners = function ClearControlledListeners() {
			++unCleanupAttempts;

			return CompleteCleanup(Reflect.apply(Clear, this, []));
		};

		return Manager;
	}

	function CaptureListenerSubscription(Subscription) {
		vecSubscriptions.push(Subscription);
		const Dispose = Subscription.DisposeListener;
		Subscription.DisposeListener = function DisposeControlledListener() {
			++unCleanupAttempts;

			return CompleteCleanup(Reflect.apply(Dispose, this, []));
		};
		const Invoke = Subscription.InvokeListenerCallback;
		Subscription.InvokeListenerCallback = function InvokeControlledListener(...vecValues) {
			const Result = Reflect.apply(Invoke, this, vecValues);
			FailOperation("DIRECT");

			return Result;
		};

		return Subscription;
	}

	function CreateControlledListenerSubscription(...vecArguments) {
		return CaptureListenerSubscription(new ListenerModule.ListenerManagerDecorator(...vecArguments));
	}

	const Facade = {
		...ListenerModule,
		ListenerManager: CreateControlledListenerManager,
		ListenerManagerDecorator: CreateControlledListenerSubscription,

		RegisterClientPutInServerListener(Callback) {
			FailOperation("REGISTER");

			return CaptureListenerSubscription(ListenerModule.RegisterClientPutInServerListener(Callback));
		},

		RegisterListener(strEventName, Callback) {
			FailOperation("REGISTER");

			if (Scenario.Phase === "REGISTER_FALSE") {
				return false;
			}

			const bRegistered = ListenerModule.RegisterListener(strEventName, Callback);
			vecRawCallbacks.push({ EventName: strEventName, Callback });

			return bRegistered;
		},

		UnregisterListener(strEventName, Callback) {
			++unCleanupAttempts;

			return CompleteCleanup(ListenerModule.UnregisterListener(strEventName, Callback));
		},

		EmitListenerEvent(...vecArguments) {
			FailOperation("EMIT");

			return ListenerModule.EmitListenerEvent(...vecArguments);
		},

		GetListenerCount(strEventName) {
			FailOperation("COUNT");

			return ListenerModule.GetListenerCount(strEventName);
		},
	};
	const PlayerRecord = {
		Index: 1,
		UserID: 42,
		Name: "FixturePlayer",

		get Health() {
			FailOperation("HEALTH");

			return 73;
		},

		Say() {
			FailOperation("SAY");

			return true;
		},
	};
	const mapModules = new Map([
		["listeners", Facade],
		["core/logger", {
			LogInfo() {
				++unLogCount;
				if (unLogCount === 1) {
					FailOperation("LOG_FIRST");
				}

				if (unLogCount === 2) {
					FailOperation("LOG_FINAL");
				}
			},
		}],
		["filters/players", { GetAllPlayers: () => [PlayerRecord] }],
		["players/entity", { Player: () => PlayerRecord }],
		["globals", {
			GetGlobalVariables() {
				FailOperation("GLOBALS");

				return { MapName: "FixtureMap" };
			},
		}],
	]);
	const Context = g_VM.createContext({
		require(strModuleName) {
			g_Assert.ok(mapModules.has(strModuleName), strModuleName);

			return mapModules.get(strModuleName);
		},
		module: { exports: {} },
	});
	let ObservedFailure = undefined;
	let bThrew = false;
	try {
		try {
			new g_VM.Script(`"use strict";\n${strSource}`).runInContext(Context, { timeout: g_unExecutionTimeoutMilliseconds });
		} catch (Failure) {
			ObservedFailure = Failure;
			bThrew = true;
		}

		g_Assert.equal(bPrimaryInjected, Scenario.PrimaryActive);
		const vecExpected = [];
		if (bPrimaryInjected) {
			vecExpected.push({ Failure: Scenario.PrimaryFailure });
		}

		if (Scenario.Phase === "REGISTER_FALSE") {
			vecExpected.push({ Message: "Health-channel callback registration failed." });
		}

		if (bCleanupInjected) {
			vecExpected.push((Scenario.CleanupMode === "THROW") ? { Failure: CleanupFailure } : { Message: Scenario.CleanupMessage });
		}

		g_Assert.equal(bThrew, vecExpected.length > 0);
		let vecObserved = bThrew ? [ObservedFailure] : [];
		if (vecExpected.length > 1) {
			g_Assert.equal(ObservedFailure?.name, "AggregateError");
			g_Assert.ok(Array.isArray(ObservedFailure.errors));
			vecObserved = Array.from(ObservedFailure.errors);
		}

		g_Assert.equal(vecObserved.length, vecExpected.length);
		for (const [unIndex, Expected] of vecExpected.entries()) {
			if (Object.hasOwn(Expected, "Message")) {
				g_Assert.equal(vecObserved[unIndex]?.name, "Error");
				g_Assert.equal(vecObserved[unIndex].message, Expected.Message);

			} else {
				g_Assert.equal(vecObserved[unIndex], Expected.Failure, "Preserve exact failures, including null/undefined/zero.");
			}
		}

		g_Assert.deepEqual(g_mapNativeEvents, mapBefore, "Release only the exact owned callback/bridge; preserve the foreign callback on the same channel.");
		g_Assert.ok(vecManagers.every(Manager => Manager.Empty && !Manager.Initialized));
		g_Assert.ok(vecSubscriptions.every(Subscription => Subscription.Disposed));

		if (ForeignSubscription !== null) {
			g_Assert.equal(ForeignSubscription.Disposed, false);
			g_Assert.equal(ForeignSubscription.ListenerManager.ListenerCount, 1);
			g_Assert.equal(ForeignSubscription.ListenerManager.HasListener(ForeignCallback), true);
		}

		if (Scenario.Phase.startsWith("REGISTER")) {
			g_Assert.equal(unCleanupAttempts, 0, "Rejected registration owns no callback to remove.");
		}
	} finally {
		for (const Subscription of vecSubscriptions) {
			if (!Subscription.Disposed && Subscription.ListenerManager.HasListener(Subscription.ListenerCallback)) {
				ListenerModule.ListenerManagerDecorator.prototype.DisposeListener.call(Subscription);
			}
		}

		for (const Manager of vecManagers) {
			ListenerModule.ListenerManager.prototype.ClearListeners.call(Manager);
		}

		for (const Record of vecRawCallbacks) {
			ListenerModule.UnregisterListener(Record.EventName, Record.Callback);
		}

		if ((ForeignSubscription !== null) && !ForeignSubscription.Disposed && ForeignSubscription.ListenerManager.HasListener(ForeignCallback)) {
			g_Assert.equal(ForeignSubscription.DisposeListener(), true);
		}

		ListenerModule.UnregisterListener(strForeignEventName, ForeignCallback);
	}

	g_Assert.equal(g_mapNativeEvents.size, 0);
}

function CheckListenerDocumentationResources(ListenerModule, vecExamples) {
	const vecCases = [
		{
			Kind: "HEALTH",
			Marker: "const g_RunHealthChannelExample =",
			Phases: ["REGISTER", "HEALTH", "EMIT", "COUNT", "LOG_FINAL"],
			CleanupMessage: "Health-channel callback cleanup failed.",
		},
		{
			Kind: "ROUND",
			Marker: "const g_RunRoundReadyExample =",
			Phases: ["REGISTER", "GLOBALS", "EMIT"],
			CleanupMessage: "Round-ready subscription cleanup failed.",
		},
		{
			Kind: "LOCAL",
			Marker: "const g_RunLocalPlayerListenerExample =",
			Phases: ["REGISTER", "SAY", "NOTIFY"],
			CleanupMessage: "Local-player listener cleanup failed.",
		},
		{
			Kind: "CACHE",
			Marker: "const g_RunCacheInvalidationExample =",
			Phases: ["REGISTER", "DIRECT", "EMIT"],
			CleanupMessage: "Cache-invalidation subscription cleanup failed.",
		},
		{
			Kind: "CLIENT",
			Marker: "const g_RunClientPutInServerExample =",
			Phases: ["REGISTER", "LOG_FIRST"],
			CleanupMessage: "Client-put-in-server subscription cleanup failed.",
		},
	];
	let unCaseCount = 0;
	for (const Case of vecCases) {
		const vecMatches = vecExamples.filter(strSource => strSource.includes(Case.Marker));
		g_Assert.equal(vecMatches.length, 1);
		const strSource = vecMatches[0];
		for (const strMode of ["NONE", "THROW", "FALSE"]) {
			RunListenerDocumentationResourceScenario(ListenerModule, strSource, { ...Case, PrimaryActive: false, Phase: "NORMAL", CleanupMode: strMode });
			++unCaseCount;
			for (const strPhase of Case.Phases) {
				for (const PrimaryFailure of [
					new Error("Controlled listener operation failed."),
					null,
					undefined,
					0,
				]) {
					RunListenerDocumentationResourceScenario(ListenerModule, strSource, { ...Case, PrimaryActive: true, Phase: strPhase, PrimaryFailure, CleanupMode: strMode });
					++unCaseCount;
				}
			}
		}

		if (Case.Kind === "HEALTH") {
			RunListenerDocumentationResourceScenario(ListenerModule, strSource, { ...Case, PrimaryActive: false, Phase: "REGISTER_FALSE", CleanupMode: "NONE" });
			++unCaseCount;
		}
	}

	g_Assert.equal(unCaseCount, 208);
}

function CheckListenerDocumentationContracts(ListenerModule, strDocumentation) {
	const vecCoreRows = [...strDocumentation.matchAll(/^\| (?:\[)?`([A-Za-z]+)`(?:\]\(#[^)]*\))? \| (?:frozen object|class|function) \|/gm)];
	g_Assert.equal(vecCoreRows.length, 9);
	const setExports = new Set(vecCoreRows.map(vecMatch => vecMatch[1]));
	const vecManagerRows = [...strDocumentation.matchAll(/^\| (?:\[)?`(Register[A-Za-z]+Listener)`(?:\]\(#[^)]*\))? \| `([A-Za-z]+Manager)` \| `([A-Za-z]+)` \| .+ \|$/gm)];
	g_Assert.equal(vecManagerRows.length, g_unExpectedManagerCount);
	for (const vecMatch of vecManagerRows) {
		const strFactoryName = vecMatch[1];
		const strManagerName = vecMatch[2];
		g_Assert.equal(setExports.has(strFactoryName), false);
		g_Assert.equal(setExports.has(strManagerName), false);
		setExports.add(strFactoryName);
		setExports.add(strManagerName);
		g_Assert.equal(typeof ListenerModule[strFactoryName], "function");
		const Descriptor = Object.getOwnPropertyDescriptor(ListenerModule, strManagerName);
		g_Assert.equal(typeof Descriptor?.get, "function");
		g_Assert.equal(Descriptor.set, undefined);
		g_Assert.equal(Descriptor.enumerable, true);
		g_Assert.equal(Descriptor.configurable, true);
		g_Assert.equal(ListenerModule[strManagerName].EventName, vecMatch[3]);
	}

	g_Assert.deepEqual([...setExports].sort(), Object.keys(ListenerModule).sort());
	const vecReceived = [];
	const Subscription = ListenerModule.RegisterServerOutputListener((...vecValues) => {
		vecReceived.push(vecValues);

		return 1;
	});
	const vecManualArguments = [
		[],
		[null],
		["manual", { Kind: "Unvalidated" }],
		[1, "manual", "extra"],
	];
	try {
		for (const vecArguments of vecManualArguments) {
			g_Assert.equal(ListenerModule.ServerOutputManager.RuntimeCallback("ServerOutput", JSON.stringify({ Arguments: vecArguments })), 1);
		}

		g_Assert.deepEqual(vecReceived, vecManualArguments, "Manual output envelopes forward positional arguments without count/type validation.");
	} finally {
		g_Assert.equal(Subscription.DisposeListener(), true);
	}

	g_Assert.equal(g_mapNativeEvents.size, 0);
}

function CheckDocumentationExamples(ListenerModule, strDocumentation, unExpectedExampleCount, bCheckCompleteDocumentation = true) {
	const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)];
	g_Assert.equal(vecExamples.length, unExpectedExampleCount);

	if (bCheckCompleteDocumentation) {
		CheckListenerDocumentationContracts(ListenerModule, strDocumentation);
		CheckListenerDocumentationResources(ListenerModule, vecExamples.map(vecMatch => vecMatch[1]));
	}

	const PlayerRecord = {
		Index: 1,
		UserID: 42,
		Name: "FixturePlayer",
		Health: 73,
		Say: () => true,
	};
	const mapModules = new Map([
		["listeners", ListenerModule],
		["core/logger", { LogInfo: () => undefined }],
		["filters/players", { GetAllPlayers: () => [PlayerRecord] }],
		["players/entity", { Player: nPlayerIndex => (nPlayerIndex === PlayerRecord.Index) ? PlayerRecord : null }],
		["globals", { GetGlobalVariables: () => ({ MapName: "FixtureMap" }) }],
		["cvars", { GetConVar: () => "fixture-password" }],
		["core", { OutputReturn: Object.freeze({ BLOCK: 0, CONTINUE: 1 }) }],
		["players/constants", { PlayerButtons: Object.freeze({ Jump: 2, Attack: 1 }) }],
	]);

	for (const vecExampleMatch of vecExamples) {
		const Exports = { exports: {} };
		const Context = g_VM.createContext({
			require(strModuleName) {
				g_Assert.ok(mapModules.has(strModuleName), `Unsupported listener documentation module: ${strModuleName}`);

				return mapModules.get(strModuleName);
			},
			module: Exports,
		});
		g_bDocumentationEntityOutputFixtureEnabled = vecExampleMatch[1].includes('const { RegisterEntityOutputListener } = require("listeners");');

		try {
			new g_VM.Script(`"use strict";\n${vecExampleMatch[1]}`).runInContext(Context, { timeout: g_unExecutionTimeoutMilliseconds });
			const mapAutomaticArguments = new Map([
				["LevelInit", ["FixtureMap"]],
				["ServerActivate", [[0, 1], 2, 1]],
				["ClientActive", [1]],
				["ClientDisconnect", [1]],
				["LevelEnd", []],
				["EdictAllocated", [1]],
				["EdictFreed", [{ $SourceJSBigInt: "7405568" }]],
				["NetworkIDValidated", ["FixturePlayer", "STEAM_0:1:42"]],
				["QueryCVarValueFinished", [1, 1, 0, "name", "FixturePlayer"]],
				["PluginUnloading", ["FixturePlugin"]],
			]);
			for (const vecEventEntry of mapAutomaticArguments) {
				g_NativeListeners.Emit(vecEventEntry[0], JSON.stringify({ Arguments: vecEventEntry[1] }));
			}

			if (!ListenerModule.ClientConnectManager.Empty) {
				g_Assert.equal(ListenerModule.ClientConnectManager.RuntimeCallback("ClientConnect", '{"Arguments":[1,"FixturePlayer","198.51.100.1",64]}'), true);
				g_Assert.equal(typeof ListenerModule.ClientConnectManager.RuntimeCallback("ClientConnect", '{"Arguments":[1,"","198.51.100.1",64]}'), "string");
				g_Assert.equal(ListenerModule.ClientConnectManager.RuntimeCallback("ClientConnect", '{"Arguments":[1,"FixturePlayer","192.0.2.1",64]}'), "This test network is not allowed.");
			}

			if (!ListenerModule.ServerOutputManager.Empty) {
				g_Assert.equal(ListenerModule.ServerOutputManager.RuntimeCallback("ServerOutput", '{"Arguments":[1,"Unknown command: sourcejs_internal_fixture"]}'), 0);
				g_Assert.equal(ListenerModule.ServerOutputManager.RuntimeCallback("ServerOutput", '{"Arguments":[1,"ordinary output"]}'), 1);
			}

			if (!ListenerModule.NetworkedEntityCreatedManager.Empty) {
				g_Assert.equal(ListenerModule.NetworkedEntityCreatedManager.NotifyListeners(PlayerRecord), 1);
				g_Assert.equal(ListenerModule.NetworkedEntityDeletedManager.NotifyListeners(PlayerRecord), 1);
			}

			if (!ListenerModule.ButtonStateChangedManager.Empty) {
				g_Assert.equal(ListenerModule.ButtonStateChangedManager.NotifyListeners(PlayerRecord, 0, 3), 1);
				g_Assert.equal(ListenerModule.ButtonStateChangedManager.NotifyListeners(PlayerRecord, 3, 0), 1);
			}

			if (g_DocumentationEntityOutputCallback !== null) {
				const EntityOutputContext = {
					OutputName: "OnTrigger",
					OutputAddress: 0x710000n,
					ValueAddress: 0x710010n,
					ActivatorAddress: 0x710020n,
					CallerAddress: 0x710030n,
					Activator: PlayerRecord,
					Caller: { Index: 2, ClassName: "trigger_once" },
					Value: { Address: 0x710010n, TypeID: 2, Type: "string", Value: "FixtureValue" },
					Delay: 2.5,
					Arguments: [0x710000n, 0x710010n, 0x710020n, 0x710030n, 2.5],
				};
				g_DocumentationEntityOutputCallback({ Context: EntityOutputContext });
				g_DocumentationEntityOutputCallback({ Context: { ...EntityOutputContext, Caller: null, OutputName: null } });
			}
		} finally {
			try {
				Exports.exports.UnloadPlugin?.();
			} finally {
				g_bDocumentationEntityOutputFixtureEnabled = false;
			}
		}

		g_Assert.equal(g_mapNativeEvents.size, 0, "each documentation example releases its subscriptions");
		g_Assert.equal(g_DocumentationEntityOutputCallback, null, "documented entity-output owner releases its model hook");
		g_Assert.equal(g_vecNativeCallbackFailures.length, 0, "documentation callbacks must complete without native dispatch errors");
	}
}

function CheckDocumentationContractSelection(ListenerModule, strDocumentation) {
	const OriginalRunScenario = RunListenerDocumentationResourceScenario;
	let unScenarioCount = 0;
	RunListenerDocumentationResourceScenario = function RunCountedDocumentationResourceScenario(...vecArguments) {
		++unScenarioCount;

		return Reflect.apply(OriginalRunScenario, this, vecArguments);
	};

	try {
		const strExtendedDocumentation = strDocumentation + "\n```js\n// An unrelated block must not disable complete-document checks.\n```\n";
		const unExpectedExampleCount = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)].length + 1;
		CheckDocumentationExamples(ListenerModule, strExtendedDocumentation, unExpectedExampleCount);
		g_Assert.equal(unScenarioCount, 208, "Adding an unrelated example must preserve all listener resource checks.");
	} finally {
		RunListenerDocumentationResourceScenario = OriginalRunScenario;
	}
}

function CheckDocumentationRegistrationFailure(ListenerModule, strDocumentation) {
	const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)];
	const vecScenarios = [
		[0, "ClientDisconnect"],
		[5, "ServerActivate"],
		[6, "EdictFreed"],
		[10, "NetworkedEntityDeleted"],
	];
	const NativeListeners = g_NativeListeners;
	const OriginalRegisterListener = NativeListeners.AddListener;

	for (const vecScenario of vecScenarios) {
		const vecExampleMatch = vecExamples[vecScenario[0]];
		g_Assert.ok(vecExampleMatch, "registration rollback scenario must select a completed example");
		NativeListeners.AddListener = function AddListener(strEventName, Callback) {
			if (strEventName === vecScenario[1]) {
				return false;
			}

			return OriginalRegisterListener.call(this, strEventName, Callback);
		};

		try {
			g_Assert.throws(() => CheckDocumentationExamples(ListenerModule, vecExampleMatch[0], 1, false), /runtime bridge registration was rejected/);
			g_Assert.equal(g_mapNativeEvents.size, 0, "failed second registration must release the first subscription");
		} finally {
			NativeListeners.AddListener = OriginalRegisterListener;

			for (const strExportName of Object.keys(ListenerModule)) {
				if (strExportName.endsWith("Manager") && (ListenerModule[strExportName] instanceof ListenerModule.ListenerManager)) {
					ListenerModule[strExportName].ClearListeners();
				}
			}
		}
	}
}

function RejectEntityOutputHookAccess() {
	throw new Error("Listener strict smoke must not install or invoke an engine output hook.");
}

function CreateDocumentationEntityOutputHook(Callback) {
	if (!g_bDocumentationEntityOutputFixtureEnabled) {
		RejectEntityOutputHookAccess();
	}

	g_Assert.equal(g_DocumentationEntityOutputCallback, null);
	g_DocumentationEntityOutputCallback = Callback;

	return { DocumentationFixture: true };
}

function RemoveDocumentationEntityOutputHook() {
	if (!g_bDocumentationEntityOutputFixtureEnabled) {
		RejectEntityOutputHookAccess();
	}

	if (g_DocumentationEntityOutputCallback === null) {
		return false;
	}

	g_DocumentationEntityOutputCallback = null;

	return true;
}

function GetDocumentationEntityOutputContext(Payload) {
	if (!g_bDocumentationEntityOutputFixtureEnabled) {
		RejectEntityOutputHookAccess();
	}

	return Payload.Context;
}

// The facade captures this fixture; the caller's global, loader and caches must not remain replaced.
function LoadListeners(NativeListeners = undefined) {
	const BridgeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const vecCacheSnapshots = [g_strListenersPath, g_strOutputsPath, g_strRuntimePath].map((strPath) => ({ Path: strPath, Descriptor: Object.getOwnPropertyDescriptor(require.cache, strPath) }));
	const OriginalModuleLoad = g_Module._load;
	try {
		for (const CacheSnapshot of vecCacheSnapshots) {
			delete require.cache[CacheSnapshot.Path];
		}

		if (NativeListeners === undefined) {
			delete globalThis.sourcejs;

		} else {
			Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { listeners: NativeListeners } });
		}

		require.cache[g_strOutputsPath] = {
			exports: {
				CreateEntityFireOutputHook: CreateDocumentationEntityOutputHook,
				RemoveEntityFireOutputHook: RemoveDocumentationEntityOutputHook,
				GetEntityFireOutputContext: GetDocumentationEntityOutputContext,
			},
			filename: g_strOutputsPath,
			id: g_strOutputsPath,
			loaded: true,
		};
		g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return OriginalModuleLoad.call(this, g_strRuntimePath, ParentModule, bIsMain);
			}

			if (strRequestName === "entities/outputs") {
				return OriginalModuleLoad.call(this, g_strOutputsPath, ParentModule, bIsMain);
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		};

		return require(g_strListenersPath);
	} finally {
		g_Module._load = OriginalModuleLoad;

		if (BridgeDescriptor === undefined) {
			delete globalThis.sourcejs;

		} else {
			Object.defineProperty(globalThis, "sourcejs", BridgeDescriptor);
		}

		for (const CacheSnapshot of vecCacheSnapshots.reverse()) {
			if (CacheSnapshot.Descriptor === undefined) {
				delete require.cache[CacheSnapshot.Path];

			} else {
				Object.defineProperty(require.cache, CacheSnapshot.Path, CacheSnapshot.Descriptor);
			}
		}
	}
}

function CheckHelloExample() {
	const strSourcePath = g_Path.join(g_strRootPath, "examples", "plugins", "disabled", "hello", "index.js");
	const strSource = g_FileSystem.readFileSync(strSourcePath, "utf8");
	const Script = new g_VM.Script(strSource, { filename: strSourcePath });
	let unScenarioCount = 0;

	function Capture(Action) {
		try {
			return { Failed: false, Value: Action() };
		} catch (ErrorValue) {
			return { Failed: true, Value: ErrorValue };
		}
	}

	function LoadExample(Profile = {}, strExampleSource = strSource) {
		const ExampleScript = (strExampleSource === strSource) ? Script : new g_VM.Script(strExampleSource, { filename: strSourcePath });
		const State = {
			Exports: {},
			Callbacks: [],
			Subscriptions: [],
			DisposalAttempts: [0, 0],
			Messages: [],
			Profile,
		};

		function Register(unIndex, Callback) {
			if (Profile.RegistrationFailureIndex === unIndex) {
				if (Object.hasOwn(Profile, "RegistrationError")) {
					throw Profile.RegistrationError;
				}

				return false;
			}

			const Subscription = {
				Disposed: false,

				DisposeListener() {
					g_Assert.equal(this, Subscription);
					State.DisposalAttempts[unIndex]++;

					const Dispose = Profile.DisposalActions?.[unIndex];
					if ((Dispose !== undefined) && !Dispose(State)) {
						return false;
					}

					g_Assert.equal(this.Disposed, false, "an already disposed subscription must not be retried");
					this.Disposed = true;

					return true;
				},
			};
			State.Callbacks[unIndex] = Callback;
			State.Subscriptions.push(Subscription);

			if (Profile.OnRegister !== undefined) {
				Profile.OnRegister(State, unIndex);
			}

			return Subscription;
		}

		const Modules = {
			core: {
				GetSourceJSVersion() {
					if (Profile.OnVersion !== undefined) {
						Profile.OnVersion(State);
					}

					if (Object.hasOwn(Profile, "VersionError")) {
						throw Profile.VersionError;
					}

					return Object.hasOwn(Profile, "Version") ? Profile.Version : "test-version";
				},
			},
			listeners: {
				RegisterLevelInitializeListener(Callback) {
					return Register(0, Callback);
				},

				RegisterPluginUnloadingListener(Callback) {
					return Register(1, Callback);
				},
			},
			loggers: CreateExampleLoggers({
				LogInfo(strMessage) {
					State.Messages.push(strMessage);

					if (Profile.OnLog !== undefined) {
						Profile.OnLog(State);
					}

					if ((Profile.LogErrorIndex === (State.Messages.length - 1)) && Object.hasOwn(Profile, "LogError")) {
						throw Profile.LogError;
					}
				},
			}),
		};
		State.Initialization = Capture(() => ExampleScript.runInNewContext({
			exports: State.Exports,

			require(strName) {
				g_Assert.equal(Object.hasOwn(Modules, strName), true);

				return Modules[strName];
			},
		}, { timeout: g_unExecutionTimeoutMilliseconds }));
		unScenarioCount++;

		return State;
	}

	function VerifyLiteralHelloLogs(strExampleSource = strSource) {
		const strVersion = "Version 100%% %s %j $&";
		const strMapName = "Map 100%% %d %s $&";
		let unVersionCalls = 0;
		const State = LoadExample({
			Version: strVersion,
			OnVersion() {
				unVersionCalls += 1;
			},
		}, strExampleSource);
		try {
			g_Assert.equal(State.Initialization.Failed, false);
			g_Assert.equal(unVersionCalls, 1);
			g_Assert.deepEqual(State.Messages, [`hello plugin loaded on SourceJS ${strVersion}`], "Hello literal logging must preserve version data");
			State.Callbacks[0](strMapName);
			State.Callbacks[1]("hello");
			g_Assert.deepEqual(State.Messages, [`hello plugin loaded on SourceJS ${strVersion}`, `LevelInitialize: ${strMapName}`, "PluginUnloading: hello plugin unloading"], "Hello literal logging must preserve map data");
			State.Callbacks[0]("stale 100%% %s");
			g_Assert.equal(State.Messages.length, 3);
			g_Assert.deepEqual(State.DisposalAttempts, [1, 1]);
		} finally {
			State.Exports.Unload();
			g_Assert(State.Subscriptions.every(Subscription => Subscription.Disposed));
		}
	}

	VerifyLiteralHelloLogs();

	const vecLiteralCalls = [
		'LogInfo("%s", `LevelInitialize: ${strMapName}`);',
		'LogInfo("%s", `hello plugin loaded on SourceJS ${strVersion}`);',
	];
	for (const strLiteralCall of vecLiteralCalls) {
		g_Assert.equal(strSource.split(strLiteralCall).length, 2);
		const strRestoredSource = strSource.replace(strLiteralCall, () => strLiteralCall.replace('("%s", ', "("));
		g_Assert.throws(() => VerifyLiteralHelloLogs(strRestoredSource), Failure => (Failure instanceof g_Assert.AssertionError) && Failure.message.includes("Hello literal logging must preserve"), "Each restored call must fail for data corruption, not unrelated lifecycle failures");
	}

	console.log("[hello literal logging] actual formatter preserved version/map percent sequences, startup call count and unload silence; 2 restored-source controls passed, controlled native/listener sinks only.");

	const Normal = LoadExample();
	g_Assert.equal(Normal.Initialization.Failed, false);
	g_Assert.deepEqual(Normal.Messages, ["hello plugin loaded on SourceJS test-version"]);
	Normal.Callbacks[0]("test-map");
	Normal.Callbacks[1]("another-plugin");
	g_Assert.deepEqual(Normal.DisposalAttempts, [0, 0]);
	Normal.Callbacks[1]("hello");
	g_Assert.deepEqual(Normal.DisposalAttempts, [1, 1]);
	g_Assert.deepEqual(Normal.Messages, ["hello plugin loaded on SourceJS test-version", "LevelInitialize: test-map", "PluginUnloading: hello plugin unloading"]);
	Normal.Callbacks[0]("stale-map");
	Normal.Callbacks[1]("hello");
	g_Assert.equal(Normal.Messages.length, 3);
	g_Assert.equal(Normal.Exports.Unload(), true);
	g_Assert.deepEqual(Normal.DisposalAttempts, [1, 1]);

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
			const Profile = { DisposalActions: [] };
			Profile.DisposalActions[unFailureIndex] = () => {
				throw ErrorValue;
			};

			const State = LoadExample(Profile);
			const Failure = Capture(() => State.Exports.Unload());
			g_Assert.equal(Failure.Failed, true);
			g_Assert.equal(Failure.Value.errors.length, 1);
			g_Assert.equal(Failure.Value.errors[0], ErrorValue);
			g_Assert.deepEqual(State.DisposalAttempts, [1, 1], "independent subscriptions must still be attempted");
			State.Callbacks[0]("stale-map");
			State.Callbacks[1]("hello");
			g_Assert.equal(State.Messages.length, 1);
			Profile.DisposalActions[unFailureIndex] = () => true;
			g_Assert.equal(State.Exports.Unload(), true);
			g_Assert.equal(State.Exports.Unload(), true);
			g_Assert.equal(State.DisposalAttempts[unFailureIndex], 2);
			g_Assert.equal(State.DisposalAttempts[1 - unFailureIndex], 1);
		}

		const Profile = { DisposalActions: [] };
		Profile.DisposalActions[unFailureIndex] = () => false;

		const State = LoadExample(Profile);
		const Failure = Capture(() => State.Exports.Unload());
		g_Assert.equal(Failure.Failed, true);
		g_Assert.match(Failure.Value.errors[0].message, /Unable to dispose the .* listener/);
		g_Assert.deepEqual(State.DisposalAttempts, [1, 1]);
		Profile.DisposalActions[unFailureIndex] = () => true;
		g_Assert.equal(State.Exports.Unload(), true);
	}

	for (const unRegistrationIndex of [0, 1]) {
		const State = LoadExample({ RegistrationFailureIndex: unRegistrationIndex });
		g_Assert.equal(State.Initialization.Failed, true);
		g_Assert.match(State.Initialization.Value.message, /Unable to register/);
		g_Assert.deepEqual(State.DisposalAttempts, [unRegistrationIndex, 0]);
		g_Assert.equal(State.Messages.length, 0);
	}

	for (const ErrorValue of vecOpaqueErrors) {
		for (const Profile of [
			{ RegistrationFailureIndex: 1, RegistrationError: ErrorValue },
			{ VersionError: ErrorValue },
			{ LogErrorIndex: 0, LogError: ErrorValue },
		]) {
			const State = LoadExample(Profile);
			g_Assert.equal(State.Initialization.Failed, true);
			g_Assert.equal(State.Initialization.Value, ErrorValue);
			g_Assert.equal(State.Subscriptions.every(Subscription => Subscription.Disposed), true);
			g_Assert.equal(State.Exports.Unload(), true);
		}
	}

	const Rollback = LoadExample({
		VersionError: OpaqueError,
		DisposalActions: [
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
	g_Assert.deepEqual(Rollback.DisposalAttempts, [1, 1]);
	Rollback.Profile.DisposalActions = [];
	g_Assert.equal(Rollback.Exports.Unload(), true);

	for (const strStage of ["FirstRegistration", "SecondRegistration", "Version", "Log"]) {
		const State = LoadExample({
			OnRegister(Current, unIndex) {
				if (((strStage === "FirstRegistration") && (unIndex === 0)) || ((strStage === "SecondRegistration") && (unIndex === 1))) {
					g_Assert.equal(Current.Exports.Unload(), true);
				}
			},

			OnVersion(Current) {
				if (strStage === "Version") {
					g_Assert.equal(Current.Exports.Unload(), true);
				}
			},

			OnLog(Current) {
				if (strStage === "Log") {
					g_Assert.equal(Current.Exports.Unload(), true);
				}
			},
		});
		g_Assert.equal(State.Initialization.Failed, false);
		g_Assert.equal(State.Subscriptions.every(Subscription => Subscription.Disposed), true);
		g_Assert.equal(State.Messages.length, (strStage === "Log") ? 1 : 0);
		g_Assert.equal(State.Exports.Unload(), true);
		g_Assert.deepEqual(State.DisposalAttempts, (strStage === "FirstRegistration") ? [1, 0] : [1, 1]);
	}

	const Reentrant = LoadExample({
		DisposalActions: [
			State => {
				g_Assert.equal(State.Exports.Unload(), false);

				return true;
			},
		],
	});
	g_Assert.equal(Reentrant.Exports.Unload(), true);
	g_Assert.deepEqual(Reentrant.DisposalAttempts, [1, 1]);

	const AlreadyDisposed = LoadExample();
	g_Assert.equal(AlreadyDisposed.Subscriptions[0].DisposeListener(), true);
	g_Assert.equal(AlreadyDisposed.Exports.Unload(), true);
	g_Assert.deepEqual(AlreadyDisposed.DisposalAttempts, [1, 1]);

	const LogFailure = LoadExample({ LogErrorIndex: 1, LogError: OpaqueError });
	const Failure = Capture(() => LogFailure.Callbacks[1]("hello"));
	g_Assert.equal(Failure.Failed, true);
	g_Assert.equal(Failure.Value, OpaqueError);
	g_Assert.deepEqual(LogFailure.DisposalAttempts, [1, 1], "an unload logger failure must not prevent disposal");

	console.log(`[  OK  ] hello example ${unScenarioCount} startup, opaque-failure, cleanup and reentrancy scenarios passed (controlled listener/runtime doubles)`);
}

const g_Listeners = LoadListeners(g_NativeListeners);
CheckHookExampleListeners(g_Listeners);

g_Assert.equal(typeof g_Listeners.RegisterListener, "function");
g_Assert.equal(typeof g_Listeners.UnregisterListener, "function");
g_Assert.equal(typeof g_Listeners.EmitListenerEvent, "function");
g_Assert.equal(typeof g_Listeners.ListenerManager, "function");
g_Assert.equal(typeof g_Listeners.ListenerManagerDecorator, "function");
g_Assert.equal(Object.hasOwn(g_Listeners, "On"), false);
g_Assert.equal(Object.hasOwn(g_Listeners, "Off"), false);
g_Assert.equal(Object.hasOwn(g_Listeners, "Emit"), false);

let g_unEventCount = 0;
const g_EventCallback = () => {
	g_unEventCount += 1;
};
g_Assert.equal(g_Listeners.RegisterListener("RoundReady", g_EventCallback), true);
g_Assert.equal(g_Listeners.EmitListenerEvent("RoundReady", { Source: "smoke" }), 1);
g_Assert.equal(g_unEventCount, 1);
g_Assert.equal(g_Listeners.UnregisterListener("RoundReady", g_EventCallback), true);
g_Assert.equal(g_Listeners.EmitListenerEvent("RoundReady", { Source: "smoke" }), 0);

g_Assert.equal(g_Listeners.RegisterListener("RoundReady", g_EventCallback), true);
g_Assert.equal(g_Listeners.RegisterListener("RoundReady", g_EventCallback), true);
g_Assert.equal(g_Listeners.GetListenerCount("RoundReady"), 2);
g_Assert.equal(g_Listeners.EmitListenerEvent("RoundReady", "duplicate registration"), 2);
g_Assert.equal(g_unEventCount, 3);
g_Assert.equal(g_Listeners.UnregisterListener("RoundReady", g_EventCallback), true);
g_Assert.equal(g_Listeners.GetListenerCount("RoundReady"), 1);
g_Assert.equal(g_Listeners.EmitListenerEvent("RoundReady", "remaining registration"), 1);
g_Assert.equal(g_unEventCount, 4);
g_Assert.equal(g_Listeners.UnregisterListener("RoundReady", g_EventCallback), true);
g_Assert.equal(g_Listeners.UnregisterListener("RoundReady", g_EventCallback), false);

g_Assert.equal(Object.keys(g_Listeners).length, g_unExpectedExportCount);
let g_unManagerCount = 0;
for (const strExportName of Object.keys(g_Listeners)) {
	const Descriptor = Object.getOwnPropertyDescriptor(g_Listeners, strExportName);
	if (typeof Descriptor.get !== "function") {
		continue;
	}

	g_Assert.equal(strExportName.endsWith("Manager"), true);
	g_Assert.equal(Descriptor.set, undefined);
	g_Assert.equal(Descriptor.enumerable, true);
	g_Assert.equal(Descriptor.configurable, true);
	g_Assert.equal(g_Listeners[strExportName] instanceof g_Listeners.ListenerManager, true);
	g_Assert.strictEqual(g_Listeners[strExportName], g_Listeners[strExportName]);
	g_unManagerCount += 1;
}

g_Assert.equal(g_unManagerCount, g_unExpectedManagerCount);

g_Assert.equal(g_Listeners.GetButtonCombinationStatus(0, 3, 3), g_Listeners.ButtonStatus.PRESSED);
g_Assert.equal(g_Listeners.GetButtonCombinationStatus(3, 1, 3), g_Listeners.ButtonStatus.RELEASED);
g_Assert.equal(g_Listeners.GetButtonCombinationStatus(3, 3, 3), null);
g_Assert.equal(g_Listeners.GetButtonCombinationStatus(0, 1 << 31, 1 << 31), g_Listeners.ButtonStatus.PRESSED);
g_Assert.equal(g_Listeners.GetButtonCombinationStatus(1 << 31, 0, 1 << 31), g_Listeners.ButtonStatus.RELEASED);
g_Assert.equal(g_Listeners.GetButtonCombinationStatus(0, 1 << 31, 0x80000000), null);

for (const InvalidInteger of [
	NaN,
	Infinity,
	1.5,
	"1",
	1n,
]) {
	g_Assert.throws(() => g_Listeners.GetButtonCombinationStatus(InvalidInteger, 0, 1), TypeError);
	g_Assert.throws(() => g_Listeners.GetButtonCombinationStatus(0, InvalidInteger, 1), TypeError);
	g_Assert.throws(() => g_Listeners.GetButtonCombinationStatus(0, 0, InvalidInteger), TypeError);
}

const g_Manager = new g_Listeners.ListenerManager("RoundReady");
g_Assert.equal(g_Manager.RegisterListener(g_EventCallback), g_EventCallback);
const g_vecCallbackArguments = [];
const g_RecordArguments = (...vecArguments) => {
	g_vecCallbackArguments.push(vecArguments);
};
g_Manager.RegisterListener(g_RecordArguments);
g_Assert.equal(g_Manager.EmitListenerEvent("map", 2), 1, "native emission counts manager bridges, not high-level callbacks");
g_Assert.deepEqual(g_vecCallbackArguments, [["map", 2]]);
g_Assert.equal(g_Listeners.EmitListenerEvent("RoundReady", { Arguments: [{ $SourceJSBigInt: "18446744073709551615" }] }), 1);
g_Assert.deepEqual(g_vecCallbackArguments[1], [0xFFFFFFFFFFFFFFFFn]);
g_Assert.throws(() => g_Manager.EmitListenerEvent(1n), TypeError, "programmatic manager emission preserves the documented JSON-only input contract");
g_Assert.equal(g_vecCallbackArguments.length, 2, "serialization failures must not dispatch callbacks");
g_Assert.equal(g_Manager.UnregisterListener(g_RecordArguments), true);
g_Assert.equal(g_Manager.UnregisterListener(g_EventCallback), true);

const g_RejectedManager = new g_Listeners.ListenerManager("RejectedBridge");
const g_vecLifecycleCalls = [];
g_RejectedManager.InitializeListenerManager = () => {
	g_vecLifecycleCalls.push("Initialize");
};
g_RejectedManager.FinalizeListenerManager = () => {
	g_vecLifecycleCalls.push("Finalize");
};
g_bRejectNextRegistration = true;
g_Assert.throws(() => g_RejectedManager.RegisterListener(g_EventCallback), /runtime bridge registration was rejected/);
g_Assert.deepEqual(g_vecLifecycleCalls, ["Initialize", "Finalize"], "rejected bridge registration must roll back initialized resources");
g_Assert.equal(g_RejectedManager.Initialized, false);
g_Assert.equal(g_RejectedManager.ListenerCount, 0);
g_Assert.equal(g_Listeners.GetListenerCount("RejectedBridge"), 0);
g_Assert.equal(g_RejectedManager.RegisterListener(g_EventCallback), g_EventCallback, "a rolled-back manager remains retryable");
g_Assert.equal(g_RejectedManager.UnregisterListener(g_EventCallback), true);
g_Assert.deepEqual(g_vecLifecycleCalls, ["Initialize", "Finalize", "Initialize", "Finalize"]);

const g_CleanupFailure = new Error("Injected initialization cleanup failure.");
const g_CleanupFailureManager = new g_Listeners.ListenerManager("CleanupFailure");
g_CleanupFailureManager.InitializeListenerManager = () => true;
g_CleanupFailureManager.FinalizeListenerManager = () => {
	throw g_CleanupFailure;
};
g_bRejectNextRegistration = true;
g_Assert.throws(() => g_CleanupFailureManager.RegisterListener(g_EventCallback), (ErrorValue) => {
	g_Assert.equal(ErrorValue instanceof AggregateError, true);
	g_Assert.equal(ErrorValue.errors.length, 2);
	g_Assert.match(ErrorValue.errors[0].message, /runtime bridge registration was rejected/);
	g_Assert.strictEqual(ErrorValue.errors[1], g_CleanupFailure);

	return true;
});
g_Assert.equal(g_CleanupFailureManager.ListenerCount, 0);
g_Assert.equal(g_CleanupFailureManager.Initialized, false);
g_Assert.equal(g_Listeners.GetListenerCount("CleanupFailure"), 0);

const g_FinalizationFailure = new Error("Injected manager finalization failure.");
const g_RestorationFailureManager = new g_Listeners.ListenerManager("RestorationFailure");
g_RestorationFailureManager.FinalizeListenerManager = () => {
	g_bRejectNextRegistration = true;
	throw g_FinalizationFailure;
};
g_Assert.equal(g_RestorationFailureManager.RegisterListener(g_EventCallback), g_EventCallback);
g_Assert.throws(() => g_RestorationFailureManager.UnregisterListener(g_EventCallback), (ErrorValue) => {
	g_Assert.equal(ErrorValue instanceof AggregateError, true);
	g_Assert.equal(ErrorValue.errors.length, 2);
	g_Assert.strictEqual(ErrorValue.errors[0], g_FinalizationFailure);
	g_Assert.match(ErrorValue.errors[1].message, /runtime bridge restoration was rejected/);

	return true;
});
g_Assert.equal(g_RestorationFailureManager.ListenerCount, 1);
g_Assert.equal(g_Listeners.GetListenerCount("RestorationFailure"), 0);
delete g_RestorationFailureManager.FinalizeListenerManager;
g_Assert.equal(g_RestorationFailureManager.UnregisterListener(g_EventCallback), true);
g_Assert.equal(g_RestorationFailureManager.ListenerCount, 0);
g_Assert.equal(g_RestorationFailureManager.Initialized, false);

const g_Decorator = new g_Listeners.ListenerManagerDecorator(g_Manager, g_EventCallback);
g_Assert.equal(g_Decorator.DisposeListener(), true);
g_Assert.equal(Object.hasOwn(g_Decorator, "ListenerManager"), true);
g_Assert.equal(Object.hasOwn(g_Decorator, "ListenerCallback"), true);
g_Assert.equal(Object.hasOwn(g_Decorator, "Disposed"), true);
g_Assert.equal(Object.hasOwn(g_Decorator, "m_objListenerManager"), false);
g_Assert.equal(Object.hasOwn(g_Decorator, "m_ListenerCallBack"), false);
g_Assert.equal(Object.hasOwn(g_Decorator, "m_objManager"), false);
g_Assert.equal(Object.hasOwn(g_Decorator, "m_Callback"), false);

CheckHelloExample();
CheckManagerFieldsAndOptions(g_Listeners);
CheckManagerLifecycleReentrancy(g_Listeners);
CheckPayloadSerialization(g_Listeners);
CheckNativeDispatchSnapshot(g_Listeners);
CheckDispatchAndCleanup(g_Listeners);
CheckSpecializedDecisions(g_Listeners);
g_Assert.equal(g_vecNativeCallbackFailures.length, 0, "all expected native callback failures are accounted for");

const g_strDocumentation = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "docs", "api", "listeners.md"), "utf8");
g_Assert.equal(g_strDocumentation.includes("ListenerManager"), true);
g_Assert.equal(/(^|[^A-Za-z])registerListener\b/.test(g_strDocumentation), false);
g_Assert.equal(/(^|[^A-Za-z])unregisterListener\b/.test(g_strDocumentation), false);
g_Assert.equal(g_strDocumentation.includes("raw-string fallback"), false);
CheckDocumentationExamples(g_Listeners, g_strDocumentation, 13);
CheckDocumentationContractSelection(g_Listeners, g_strDocumentation);
CheckDocumentationRegistrationFailure(g_Listeners, g_strDocumentation);
g_Assert.equal(g_mapNativeEvents.size, 0, "every runtime bridge and low-level registration is released");
g_Assert.throws(() => LoadListeners(), (ErrorValue) => (ErrorValue.constructor === Error) && (ErrorValue.code !== "MODULE_NOT_FOUND") && (ErrorValue.message === "SourceJS native runtime is not installed."));

console.log("[  OK  ] listeners strict smoke passed");
