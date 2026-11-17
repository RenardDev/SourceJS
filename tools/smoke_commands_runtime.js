#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strCommandsPath = g_Path.join(g_strPackageRoot, "commands.js");
const g_strClientPath = g_Path.join(g_strPackageRoot, "commands", "client.js");
const g_strSayPath = g_Path.join(g_strPackageRoot, "commands", "say.js");
const g_strServerPath = g_Path.join(g_strPackageRoot, "commands", "server.js");

process.env.NODE_PATH = [g_strPackageRoot, process.env.NODE_PATH].filter(Boolean).join(g_Path.delimiter);
g_Module._initPaths();

const g_unMaximumCommandLength = 511;
const g_CommandReturn = Object.freeze({ Block: 1, Continue: 0, Handled: 1 });
const g_mapCommandCallbacks = new Map();
const g_mapCommandFilters = new Map();
const g_vecSentCommands = [];
const g_vecSpokenMessages = [];

function Assert(bCondition, strErrorMessage) {
	if (!bCondition) {
		throw new Error(strErrorMessage);
	}
}

function AssertEqual(ActualValue, ExpectedValue, strErrorMessage) {
	if (ActualValue !== ExpectedValue) {
		throw new Error(`${strErrorMessage}: expected ${String(ExpectedValue)}, got ${String(ActualValue)}`);
	}
}

function AssertJSON(ActualValue, ExpectedValue, strErrorMessage) {
	AssertEqual(JSON.stringify(ActualValue), JSON.stringify(ExpectedValue), strErrorMessage);
}

function AssertThrows(Callback, strErrorMessage) {
	let CaughtError = null;

	try {
		Callback();
	} catch (ErrorValue) {
		CaughtError = ErrorValue;
	}

	Assert(CaughtError instanceof Error, strErrorMessage);
}

function RequireText(strValue, strValueName) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strValueName} must be a non-empty string.`);
	}

	return strValue;
}

function CreateCommandCallbackKey(strKind, strName) {
	return `${strKind}:${strName}`;
}

function BuildCommandPayload(strCommandLine, strKind, Options = {}) {
	RequireText(strCommandLine, "Command line");
	RequireText(strKind, "Command kind");

	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Command options must be an object.");
	}

	const vecCommandArguments = strCommandLine.split(/\s+/);
	const nSourceIndex = (Options.Index === undefined) ? 0 : Options.Index;
	if (!Number.isInteger(nSourceIndex)) {
		throw new TypeError("Command index must be an integer.");
	}

	return {
		Arguments: vecCommandArguments,
		Index: nSourceIndex,
		Kind: strKind,
		Message: (Options.Message === undefined) ? "" : Options.Message,
		Name: vecCommandArguments[0],
		Raw: strCommandLine,
		TeamOnly: (Options.TeamOnly === undefined) ? false : Options.TeamOnly,
	};
}

function NormalizeReturn(Value) {
	return ((Value === false) || (Value === g_CommandReturn.Block) || (Value === g_CommandReturn.Handled)) ? g_CommandReturn.Block : g_CommandReturn.Continue;
}

function Execute(strKind, strCommandLine, Options = {}) {
	const Payload = BuildCommandPayload(strCommandLine, strKind, Options);
	let nResult = g_CommandReturn.Continue;
	for (const FilterCallback of g_mapCommandFilters.get(strKind) ?? []) {
		nResult = Math.max(nResult, NormalizeReturn(FilterCallback(Payload)));
	}

	if (nResult === g_CommandReturn.Block) {
		return nResult;
	}

	for (const CommandCallback of g_mapCommandCallbacks.get(CreateCommandCallbackKey(strKind, Payload.Name)) ?? []) {
		nResult = Math.max(nResult, NormalizeReturn(CommandCallback(Payload)));
	}

	return nResult;
}

function CreateCommandRuntime(strKind) {
	return {
		Execute(strCommandLine, Options = {}) {
			return Execute(strKind, strCommandLine, Options);
		},
		Register(strName, Callback) {
			RequireText(strName, "Command name");

			if (typeof Callback !== "function") {
				throw new TypeError("Command callback must be a function.");
			}

			const strKey = CreateCommandCallbackKey(strKind, strName);
			const vecCallbacks = g_mapCommandCallbacks.get(strKey) ?? [];
			if (!vecCallbacks.includes(Callback)) {
				vecCallbacks.push(Callback);
				g_mapCommandCallbacks.set(strKey, vecCallbacks);
			}

			return true;
		},
		RegisterFilter(Callback) {
			if (typeof Callback !== "function") {
				throw new TypeError("Command filter must be a function.");
			}

			const vecFilters = g_mapCommandFilters.get(strKind) ?? [];
			if (!vecFilters.includes(Callback)) {
				vecFilters.push(Callback);
				g_mapCommandFilters.set(strKind, vecFilters);
			}

			return true;
		},
		Say(nPlayerIndex, strMessage) {
			if (!Number.isInteger(nPlayerIndex)) {
				throw new TypeError("Player index must be an integer.");
			}

			g_vecSpokenMessages.push(["SAY", nPlayerIndex, RequireText(strMessage, "Message")]);

			return true;
		},
		SayTeam(nPlayerIndex, strMessage) {
			if (!Number.isInteger(nPlayerIndex)) {
				throw new TypeError("Player index must be an integer.");
			}

			g_vecSpokenMessages.push(["SAYTEAM", nPlayerIndex, RequireText(strMessage, "Message")]);

			return true;
		},
		Send(nPlayerIndex, strCommandLine) {
			if (!Number.isInteger(nPlayerIndex)) {
				throw new TypeError("Player index must be an integer.");
			}

			g_vecSentCommands.push([nPlayerIndex, RequireText(strCommandLine, "Command line")]);

			return true;
		},
		Unregister(strName, Callback) {
			const strKey = CreateCommandCallbackKey(strKind, RequireText(strName, "Command name"));
			const vecCallbacks = g_mapCommandCallbacks.get(strKey) ?? [];
			const nCallbackIndex = vecCallbacks.indexOf(Callback);
			if (nCallbackIndex >= 0) {
				vecCallbacks.splice(nCallbackIndex, 1);
			}

			if (vecCallbacks.length === 0) {
				g_mapCommandCallbacks.delete(strKey);
			}

			return true;
		},
		UnregisterFilter(Callback) {
			const vecFilters = g_mapCommandFilters.get(strKind) ?? [];
			const nCallbackIndex = vecFilters.indexOf(Callback);
			if (nCallbackIndex >= 0) {
				vecFilters.splice(nCallbackIndex, 1);
			}

			return true;
		},
	};
}

function VerifyCommandsCvarsExampleLifecycle() {
	const unExampleExecutionTimeoutMilliseconds = 1000;

	const strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "examples", "plugins", "disabled", "api-commands-cvars", "index.js"), "utf8");
	const strLoggerPath = g_Path.join(g_strPackageRoot, "loggers.js");
	const LoggerScript = new g_VM.Script(g_FileSystem.readFileSync(strLoggerPath, "utf8"), { filename: strLoggerPath });
	const vecRoles = ["Source", "Typed", "Server", "Client", "PublicSay", "PrivateSay", "ClientFilter", "SayFilter", "Listener"];
	const vecOpaqueErrors = [new Error("Controlled lifecycle failure"), undefined, null, 0, "", new AggregateError([undefined, 0], "Opaque aggregate")];
	const mapCommandNames = new Map([["Source", "sjs_api_commands"], ["Server", "sjs_api_server"], ["Client", "sjs_api_client"], ["PublicSay", "!sjsapi"], ["PrivateSay", "/sjsapi"]]);

	function CreateExample(Options = {}) {
		const State = { Registered: new Map(), Acquisitions: [], Releases: [], Logs: [], InjectFailure: true, Listener: null, TypedCallback: null, OnRelease: null, Mutations: [], Executions: [], ConfigurationCalls: [], PublicActive: false, PublicReleases: 0, DemoConVar: null };
		const Register = (strRole, Callback, strName = null) => {
			if (mapCommandNames.has(strRole)) {
				g_Assert.equal(strName, mapCommandNames.get(strRole), "registration command name");
			}

			State.Acquisitions.push(strRole);

			if ((Options.RegisterFailure === strRole) && State.InjectFailure) {
				if (Options.RegisterFalse) {
					return false;
				}

				throw Options.Failure;
			}

			State.Registered.set(strRole, Callback);

			return true;
		};
		const Release = (strRole, Callback, strName = null) => {
			if (mapCommandNames.has(strRole)) {
				g_Assert.equal(strName, mapCommandNames.get(strRole), "cleanup command name");
			}

			State.Releases.push(strRole);

			if (State.OnRelease) {
				State.OnRelease(strRole);
			}

			if ((Options.ReleaseFailures ?? []).includes(strRole) && State.InjectFailure) {
				if (Options.ReleaseFalse) {
					return false;
				}

				throw Options.ReleaseErrors?.has(strRole) ? Options.ReleaseErrors.get(strRole) : Options.Failure;
			}

			if (!State.Registered.has(strRole) || (State.Registered.get(strRole) !== Callback)) {
				return false;
			}

			State.Registered.delete(strRole);

			return true;
		};
		const TypedRegistration = {
			Register(Callback) {
				if (Register("Typed", Callback) !== true) {
					throw new Error("Typed registration failed");
				}

				State.TypedCallback = Callback;

				return this;
			},
			Unload() {
				return Release("Typed", State.TypedCallback);
			},
		};
		const Log = (strSeverity, strMessage) => {
			if ((Options.LogFailure === strSeverity) && State.InjectFailure) {
				throw Options.Failure;
			}

			State.Logs.push({ Severity: strSeverity, Message: strMessage });
		};
		const LoggerModule = { exports: {} };
		const NativeLoggers = {
			LogInfo: strMessage => Log("INFO", strMessage),
			LogWarning: strMessage => Log("WARNING", strMessage),
			LogError: strMessage => Log("ERROR", strMessage),
		};
		const LoggerDependencies = {
			filesystem: {
				EnsureDirectoryExists: () => g_Assert.fail("Command example must not create logger directories."),
				SourceFile: { OpenSourceFile: () => g_Assert.fail("Command example must not write log files.") },
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
			g_Assert(Object.hasOwn(LoggerDependencies, strName), "Unexpected logger dependency: " + strName);

			return LoggerDependencies[strName];
		};

		LoggerScript.runInNewContext({ module: LoggerModule, require: RequireLoggerDependency }, { timeout: unExampleExecutionTimeoutMilliseconds });

		const Commands = {
			CommandReturn: { Continue: 0, Block: 1, Handled: 1 },
			Command: class Command {
				constructor(Payload) {
					Object.assign(this, Payload, { Length: Payload.Arguments.length, ArgumentString: Payload.Arguments.slice(1).join(" ") });
				}

				GetArgument(unIndex) {
					return this.Arguments[unIndex];
				}
			},
			ExecuteCommand(strCommand) {
				State.Executions.push(strCommand);

				return true;
			},
		};
		const PublicConVarRegistration = {
			Name: "sourcejs_api_public_demo",
			get ConVar() {
				if (Options.PublicInspectionFailure && State.InjectFailure) {
					throw Options.PublicFailure;
				}

				return { Value: "0" };
			},
			UnregisterPublicConVar(bRestore) {
				g_Assert.equal(bRestore, true);
				State.PublicReleases++;

				if (Options.PublicReleaseFailure && State.InjectFailure) {
					if (Options.PublicReleaseFalse) {
						return false;
					}

					throw Options.PublicCleanupFailure;
				}

				g_Assert.equal(State.PublicActive, true, "temporary public ConVar released exactly once");
				State.PublicActive = false;

				return true;
			},
		};
		const Modules = {
			commands: Commands,
			"commands/typed": { RegisterTypedServerCommand: () => TypedRegistration },
			"commands/server": { RegisterCommand: (strName, Callback) => Register("Server", Callback, strName), UnregisterCommand: (strName, Callback) => Release("Server", Callback, strName) },
			"commands/client": {
				RegisterCommand: (strName, Callback) => Register("Client", Callback, strName),
				UnregisterCommand: (strName, Callback) => Release("Client", Callback, strName),
				RegisterCommandFilter: Callback => Register("ClientFilter", Callback),
				UnregisterCommandFilter: Callback => Release("ClientFilter", Callback),
			},
			"commands/say": {
				RegisterCommand: (strName, Callback) => Register((strName === "!sjsapi") ? "PublicSay" : "PrivateSay", Callback, strName),
				UnregisterCommand: (strName, Callback) => Release((strName === "!sjsapi") ? "PublicSay" : "PrivateSay", Callback, strName),
				RegisterCommandFilter: Callback => Register("SayFilter", Callback),
				UnregisterCommandFilter: Callback => Release("SayFilter", Callback),
			},
			source: { RegisterCommand: (strName, Callback) => Register("Source", Callback, strName), UnregisterCommand: (strName, Callback) => Release("Source", Callback, strName) },
			listeners: {
				RegisterPluginUnloadingListener(Callback) {
					if (Register("Listener", Callback) !== true) {
						throw new Error("Listener registration failed");
					}

					State.Listener = Callback;

					return { DisposeListener: () => Release("Listener", Callback) };
				},
			},
			loggers: LoggerModule.exports,
			config: {
				ResolveConfigPath: strPath => "/configuration/" + strPath,
				ConfigManager: class ConfigManager {
					constructor(strPath, ConfigurationOptions) {
						State.ConfigurationCalls.push(["Constructor", strPath, ConfigurationOptions]);
					}

					AddConfigSection(...vecArguments) {
						State.ConfigurationCalls.push(["Section", ...vecArguments]);
					}

					AddCVarConfigEntry(...vecArguments) {
						State.ConfigurationCalls.push(["ConVar", ...vecArguments]);
					}

					AddCommandConfigEntry(...vecArguments) {
						State.ConfigurationCalls.push(["Command", ...vecArguments]);
					}

					RenderConfig() {
						return ["// Example configuration"];
					}
				},
			},
			cvars: {
				CreateConVar(strName, strDefaultValue) {
					State.DemoConVar = {
						Name: strName,
						DefaultValue: strDefaultValue,
						Address: 0n,
						Value: strDefaultValue,
						get IntValue() {
							return Number(this.Value);
						},
					};

					return State.DemoConVar;
				},
				DoesConVarExist: () => true,
				GetConVar: () => ({ Name: "hostname" }),
				GetConVarBoolean: () => true,
				GetConVarFloat: () => 1,
				GetConVarInteger: () => 0,
				GetConCommandBaseRecords: () => [{ Name: "hostname" }, { Name: "sv_lan" }],
				RequireConVar: () => ({ Exists: true, Flags: 0, HasMinimum: false }),
				RevertConVarToDefault(strName) {
					g_Assert.equal(strName, State.DemoConVar.Name);
					State.DemoConVar.Value = State.DemoConVar.DefaultValue;

					return true;
				},
				SetConVar(strName, Value) {
					State.Mutations.push({ Name: strName, Value });

					if (strName === State.DemoConVar?.Name) {
						State.DemoConVar.Value = String(Value);
					}

					return true;
				},
			},
			"cvars/flags": { NOTIFY: 256 },
			"cvars/public": {
				IsConVarPublic: () => true,
				RegisterPublicConVar() {
					g_Assert.equal(State.PublicActive, false);
					State.PublicActive = true;

					return PublicConVarRegistration;
				},
			},
			"cvars/tags": { HasServerTag: () => true, GetServerTags: () => ["sourcejs"] },
		};
		const Exports = {};
		const Require = strName => {
			g_Assert(Object.hasOwn(Modules, strName), strName);

			return Modules[strName];
		};
		const Context = g_VM.createContext({ require: Require, exports: Exports });
		let bThrown = false;
		let CaughtValue;
		try {
			new g_VM.Script(Options.SourceOverride ?? strSource, { filename: "api-commands-cvars/index.js" }).runInContext(Context, { timeout: unExampleExecutionTimeoutMilliseconds });
		} catch (CaughtError) {
			bThrown = true;
			CaughtValue = CaughtError;
		}

		return { State, Exports, Context, Thrown: bThrown, Error: CaughtValue };
	}

	function CallCleanup(Example) {
		return g_VM.runInContext("Cleanup()", Example.Context, { timeout: unExampleExecutionTimeoutMilliseconds });
	}

	function Flatten(Value, setOpaque) {
		if (!setOpaque.has(Value) && (Value?.name === "AggregateError")) {
			return [...Value.errors].flatMap(ErrorValue => Flatten(ErrorValue, setOpaque));
		}

		return [Value];
	}

	function Capture(Call) {
		try {
			return { Thrown: false, Value: Call() };
		} catch (CaughtError) {
			return { Thrown: true, Value: CaughtError };
		}
	}

	function InvokeCommand(Example, strRole, vecArguments = ["sjs_api_commands"]) {
		return Example.State.Registered.get(strRole)({ Name: vecArguments[0], Arguments: vecArguments, Index: 21, Kind: "server" });
	}

	let unCases = 0;
	for (const strRole of vecRoles) {
		for (const Failure of vecOpaqueErrors) {
			const Example = CreateExample({ RegisterFailure: strRole, Failure });
			g_Assert(Example.Thrown, "startup failure propagated");
			g_Assert.strictEqual(Example.Error, Failure, "startup error identity preserved when rollback succeeds");
			g_Assert.equal(Example.State.Registered.size, 0, "partial startup releases every acquired registration");
			g_Assert.deepEqual(Example.State.Releases, vecRoles.slice(0, vecRoles.indexOf(strRole)), "rollback never releases unacquired resources");
			unCases++;
		}
	}

	for (const strSeverity of ["WARNING", "INFO"]) {
		for (const Failure of vecOpaqueErrors) {
			const Example = CreateExample({ LogFailure: strSeverity, Failure });
			g_Assert(Example.Thrown);
			g_Assert.strictEqual(Example.Error, Failure, "startup log error identity");
			g_Assert.equal(Example.State.Registered.size, 0, "logging failure rolls back every registration");
			unCases++;
		}
	}

	for (const strRole of vecRoles) {
		for (const Failure of vecOpaqueErrors) {
			const Example = CreateExample({ ReleaseFailures: [strRole], Failure });
			g_Assert.equal(Example.Thrown, false);
			let bThrown = false;
			let CaughtValue;
			try {
				CallCleanup(Example);
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			g_Assert(bThrown);
			g_Assert.strictEqual(CaughtValue, Failure, "single cleanup error identity");
			g_Assert.deepEqual(Example.State.Releases, vecRoles, "all independent releases attempted after failure");
			g_Assert.deepEqual([...Example.State.Registered.keys()], [strRole], "only failed resource retained");
			Example.State.InjectFailure = false;
			CallCleanup(Example);
			g_Assert.equal(Example.State.Registered.size, 0, "explicit cleanup retry succeeds");
			g_Assert.deepEqual(Example.State.Releases.slice(vecRoles.length), [strRole], "successful releases are not repeated");
			CallCleanup(Example);
			g_Assert.equal(Example.State.Releases.length, vecRoles.length + 1, "repeated cleanup harmless");
			unCases++;
		}
	}

	for (const Failure of vecOpaqueErrors) {
		const Example = CreateExample({ RegisterFailure: "Listener", ReleaseFailures: ["Source", "Server"], Failure });
		g_Assert(Example.Thrown);
		const vecFailures = Flatten(Example.Error, new Set([Failure]));
		g_Assert.equal(vecFailures.length, 3, "startup plus both cleanup failures preserved");
		g_Assert(vecFailures.every(Value => Value === Failure));
		g_Assert.deepEqual(Example.State.Releases, vecRoles.slice(0, -1), "startup cleanup continues independently");
		unCases++;
	}

	const Example = CreateExample();
	g_Assert.equal(Example.Thrown, false);
	g_Assert.equal(Object.hasOwn(Example.Exports, "unload"), false);
	g_Assert.equal(typeof Example.Exports.Unload, "function");
	Example.State.Listener("another-plugin");
	g_Assert.equal(Example.State.Registered.size, vecRoles.length);
	g_Assert.equal(Example.Exports.Unload(), undefined, "normal exported return contract unchanged");
	g_Assert.equal(Example.State.Registered.size, 0);
	Example.Exports.Unload();
	g_Assert.equal(Example.State.Releases.length, vecRoles.length);
	unCases++;

	for (const strRole of vecRoles) {
		const FailedExample = CreateExample({ RegisterFailure: strRole, RegisterFalse: true });
		g_Assert(FailedExample.Thrown, "registration false is a startup failure");
		g_Assert.match(FailedExample.Error.message, /Could not register|registration failed/);
		g_Assert.equal(FailedExample.State.Registered.size, 0);
		g_Assert.deepEqual(FailedExample.State.Releases, vecRoles.slice(0, vecRoles.indexOf(strRole)));
		unCases++;
	}

	for (const strRole of vecRoles) {
		const FailedExample = CreateExample({ ReleaseFailures: [strRole], ReleaseFalse: true });
		const Outcome = Capture(() => FailedExample.Exports.Unload());
		g_Assert(Outcome.Thrown);
		g_Assert.match(Outcome.Value.message, /Could not release/);
		g_Assert.deepEqual(FailedExample.State.Releases, vecRoles);
		g_Assert.deepEqual([...FailedExample.State.Registered.keys()], [strRole]);
		FailedExample.State.InjectFailure = false;
		FailedExample.Exports.Unload();
		g_Assert.equal(FailedExample.State.Registered.size, 0);
		g_Assert.deepEqual(FailedExample.State.Releases.slice(vecRoles.length), [strRole]);
		unCases++;
	}

	const mapReleaseErrors = new Map([["Source", undefined], ["Server", 0], ["Listener", ""]]);
	const DistinctErrorsExample = CreateExample({ ReleaseFailures: [...mapReleaseErrors.keys()], ReleaseErrors: mapReleaseErrors });
	const DistinctOutcome = Capture(() => DistinctErrorsExample.Exports.Unload());
	g_Assert(DistinctOutcome.Thrown);
	g_Assert.equal(DistinctOutcome.Value.name, "AggregateError");
	g_Assert.deepEqual([...DistinctOutcome.Value.errors], [...mapReleaseErrors.values()], "independent opaque cleanup errors retain identity and acquisition order");
	g_Assert.deepEqual(DistinctErrorsExample.State.Releases, vecRoles);
	DistinctErrorsExample.State.InjectFailure = false;
	DistinctErrorsExample.Exports.Unload();
	g_Assert.equal(DistinctErrorsExample.State.Registered.size, 0);
	unCases++;

	for (const strRole of vecRoles) {
		const ReentrantExample = CreateExample();
		let unReentrantCalls = 0;
		ReentrantExample.State.OnRelease = strCurrentRole => {
			if (strCurrentRole === strRole) {
				unReentrantCalls++;
				g_Assert.equal(ReentrantExample.Exports.Unload(), undefined);
			}
		};
		ReentrantExample.Exports.Unload();
		g_Assert.equal(unReentrantCalls, 1);
		g_Assert.deepEqual(ReentrantExample.State.Releases, vecRoles, "reentrant cleanup never recurses into active releases");
		g_Assert.equal(ReentrantExample.State.Registered.size, 0);
		unCases++;
	}

	const SnapshotExample = CreateExample();
	let unLateReleases = 0;
	SnapshotExample.Context.LateRelease = () => {
		unLateReleases++;

		return true;
	};
	SnapshotExample.State.OnRelease = strRole => {
		if (strRole === "Source") {
			g_VM.runInContext("TrackRegistration(\"late registration\", LateRelease); Cleanup();", SnapshotExample.Context, { timeout: unExampleExecutionTimeoutMilliseconds });
		}
	};
	SnapshotExample.Exports.Unload();
	g_Assert.equal(unLateReleases, 0, "cleanup traverses a stable snapshot, not newly inserted registrations");
	SnapshotExample.Exports.Unload();
	g_Assert.equal(unLateReleases, 1, "late registration stays owned until explicit next cleanup");
	SnapshotExample.Exports.Unload();
	g_Assert.equal(unLateReleases, 1);
	unCases++;

	for (const [strRole, nExpected] of [["Server", 1], ["Client", 1], ["PublicSay", 1], ["PrivateSay", 1], ["ClientFilter", 0], ["SayFilter", 0]]) {
		const CallbackExample = CreateExample();
		const strCommandName = { Server: "sjs_api_server", Client: "sjs_api_client", PublicSay: "!sjsapi", PrivateSay: "/sjsapi", ClientFilter: "sjs_api_client", SayFilter: "!sjsapi" }[strRole];
		g_Assert.equal(InvokeCommand(CallbackExample, strRole, [strCommandName, "hello"]), nExpected);
		g_Assert(CallbackExample.State.Logs.some(Entry => Entry.Message.includes(strRole.includes("Filter") ? "observed" : "hello")));
		CallbackExample.Exports.Unload();
		g_Assert.equal(CallbackExample.State.Registered.size, 0);
		unCases++;
	}

	const AssertNoDemoSideEffects = Example => {
		g_Assert.deepEqual(Example.State.Executions, [], "Malformed API example arguments must not execute commands");
		g_Assert.equal(Example.State.Mutations.length, 0, "Malformed API example arguments must not mutate ConVars");
		g_Assert.equal(Example.State.DemoConVar, null);
		g_Assert.equal(Example.State.PublicActive, false);
		g_Assert.equal(Example.State.PublicReleases, 0);
		g_Assert.equal(Example.State.ConfigurationCalls.length, 0);
	};

	for (const bConfirm of [false, true]) {
		const CallbackExample = CreateExample();
		const vecArguments = ["sjs_api_commands", "set", "hostname", "New", "Name"];
		if (bConfirm) {
			vecArguments.push("confirm");
		}

		const nResult = InvokeCommand(CallbackExample, "Source", vecArguments);
		const vecHostNameMutations = CallbackExample.State.Mutations.filter(Entry => Entry.Name === "hostname");
		g_Assert.equal(vecHostNameMutations.length, bConfirm ? 1 : 0, "live ConVar mutation requires confirm token");

		if (bConfirm) {
			g_Assert.equal(vecHostNameMutations[0].Value, "New Name");
			g_Assert.equal(CallbackExample.State.Executions.length, 0);

		} else {
			AssertNoDemoSideEffects(CallbackExample);
			g_Assert(CallbackExample.State.Logs.some(Entry => Entry.Message.startsWith("Usage:")));
		}

		g_Assert.equal(nResult, 1, "A set attempt is handled, including rejected syntax");
		CallbackExample.Exports.Unload();
		g_Assert.equal(CallbackExample.State.Registered.size, 0);
		g_Assert.equal(CallbackExample.State.PublicReleases, 0);
		unCases++;
	}

	const DemoExample = CreateExample();
	g_Assert.equal(InvokeCommand(DemoExample, "Source"), 0);
	g_Assert.deepEqual(DemoExample.State.Executions, ["echo SourceJS commands example"]);
	g_Assert.equal(DemoExample.State.DemoConVar.Value, "0", "argument-free demo still restores its ConVar");
	g_Assert.equal(DemoExample.State.PublicActive, false);
	g_Assert.equal(DemoExample.State.PublicReleases, 1);
	g_Assert.equal(DemoExample.State.ConfigurationCalls.length, 4);
	DemoExample.Exports.Unload();
	g_Assert.equal(DemoExample.State.Registered.size, 0);
	g_Assert.equal(DemoExample.State.PublicReleases, 1, "successful temporary release is not repeated by unload");
	unCases++;

	const vecMalformedArguments = [
		["sjs_api_commands", "bogus"],
		["sjs_api_commands", "set"],
		["sjs_api_commands", "set", "hostname"],
		["sjs_api_commands", "set", "hostname", "confirm"],
		["sjs_api_commands", "set", "hostname", "New", "Name", "CONFIRM"],
		["sjs_api_commands", "bogus", "hostname", "value", "confirm"],
		["sjs_api_commands", "set", "hostname", "value", "confirm", "extra"],
	];
	for (const vecArguments of vecMalformedArguments) {
		const InvalidExample = CreateExample();
		const nResult = InvokeCommand(InvalidExample, "Source", vecArguments);
		AssertNoDemoSideEffects(InvalidExample);
		g_Assert.equal(nResult, 1);
		g_Assert(InvalidExample.State.Logs.some(Entry => Entry.Message.startsWith("Usage:")));
		InvalidExample.Exports.Unload();
		g_Assert.equal(InvalidExample.State.Registered.size, 0);
		unCases++;
	}

	const strArgumentGuard = [
		"\tif ((vecCommandArguments.length > 0) && (!bSetRequested || !bConfirmed)) {",
		"\t\tLogWarning(`Usage: ${g_strCommandName} [set <cvar> <value> confirm]`);",
		"\t\treturn CommandReturn.Handled;",
		"\t}",
		"",
		"",
	].join("\n");
	const strNormalizedSource = strSource.replace(/\r\n/g, "\n");
	g_Assert.equal(strNormalizedSource.split(strArgumentGuard).length, 2, "Unique API example command validation guard");
	const LegacyExample = CreateExample({ SourceOverride: strNormalizedSource.replace(strArgumentGuard, "") });
	InvokeCommand(LegacyExample, "Source", ["sjs_api_commands", "set", "hostname", "value"]);
	g_Assert.throws(() => AssertNoDemoSideEffects(LegacyExample), Failure => (Failure instanceof g_Assert.AssertionError) && Failure.message.includes("Malformed API example arguments must not execute commands"), "Removed guard must reproduce native-command side effects, not an unrelated error");
	LegacyExample.Exports.Unload();
	g_Assert.equal(LegacyExample.State.Registered.size, 0);
	unCases++;

	for (const vecParts of [[], ["hello", "world"]]) {
		const TypedExample = CreateExample();
		let strReply;
		const ReplyResult = Symbol("Reply result");
		const Context = {
			Reply(strMessage) {
				strReply = strMessage;

				return ReplyResult;
			},
		};
		g_Assert.strictEqual(TypedExample.State.TypedCallback(Context, ...vecParts), ReplyResult);
		g_Assert.equal(strReply, vecParts.join(" ") || "typed command works");
		TypedExample.Exports.Unload();
		unCases++;
	}

	function VerifyLiteralLogs(strExampleSource) {
		const strPercentData = "100%% %s %d %j $&";
		for (const [strRole, strPrefix] of [["Server", "Server command arguments: "], ["Client", "Client command from index 21: "], ["PublicSay", "Say command from index 21: "]]) {
			const LiteralExample = CreateExample({ SourceOverride: strExampleSource });
			LiteralExample.State.Logs.length = 0;
			InvokeCommand(LiteralExample, strRole, [mapCommandNames.get(strRole), strPercentData]);
			g_Assert.deepEqual(LiteralExample.State.Logs, [{ Severity: "INFO", Message: strPrefix + strPercentData }], "Command log data must remain literal through the actual logger formatter");
			LiteralExample.Exports.Unload();
			g_Assert.equal(LiteralExample.State.Registered.size, 0);
		}

		const SummaryExample = CreateExample({ SourceOverride: strExampleSource });
		SummaryExample.State.Logs.length = 0;
		g_VM.runInContext('LogResult("Label 100%% %s", "Value 100%% %j");', SummaryExample.Context, { timeout: unExampleExecutionTimeoutMilliseconds });
		g_Assert.deepEqual(SummaryExample.State.Logs, [{ Severity: "INFO", Message: "Label 100%% %s: Value 100%% %j" }], "Summary labels and values are data, not format strings");
		SummaryExample.Exports.Unload();
		g_Assert.equal(SummaryExample.State.Registered.size, 0);

		const TypedLiteralExample = CreateExample({ SourceOverride: strExampleSource });
		TypedLiteralExample.State.Logs.length = 0;
		let strLiteralReply = "";
		TypedLiteralExample.State.TypedCallback({
			Reply(strMessage) {
				strLiteralReply = strMessage;
			},
		}, strPercentData);
		g_Assert.equal(strLiteralReply, strPercentData);
		g_Assert.deepEqual(TypedLiteralExample.State.Logs, [{ Severity: "INFO", Message: "Typed echo: " + strPercentData }], "Typed command log and reply must preserve identical literal data");
		TypedLiteralExample.Exports.Unload();
		g_Assert.equal(TypedLiteralExample.State.Registered.size, 0);

		return 5;
	}

	unCases += VerifyLiteralLogs(strSource);

	const vecLiteralLogCalls = [
		'LogInfo("%s", `${strLabel}: ${SummarizeValue(Value)}`);',
		'LogInfo("%s", `Server command arguments: ${GetCommandArguments(InputCommand).join(" ")}`);',
		'LogInfo("%s", `Client command from index ${ParsedCommand.Index}: ${ParsedCommand.ArgumentString}`);',
		'LogInfo("%s", `Say command from index ${ParsedCommand.Index}: ${ParsedCommand.ArgumentString}`);',
		'LogInfo("%s", `Typed echo: ${strMessage}`);',
	];
	for (const strLiteralCall of vecLiteralLogCalls) {
		g_Assert.equal(strSource.split(strLiteralCall).length, 2, "Unique literal-data logger call");
		const strLegacySource = strSource.replace(strLiteralCall, () => strLiteralCall.replace('LogInfo("%s", ', "LogInfo("));
		g_Assert.throws(() => VerifyLiteralLogs(strLegacySource), Failure => (Failure instanceof g_Assert.AssertionError) && /Command log data must remain literal|Summary labels and values are data|Typed command log and reply/.test(Failure.message), "Each old format-string call must fail for changed literal data, not an unrelated error");
		unCases++;
	}

	console.log("Commands/cvars literal logging: 5 payload profiles and 5 restored-source regressions passed through actual JavaScript logger; native sinks are controlled doubles.");

	for (const Failure of vecOpaqueErrors) {
		for (const strMode of ["INSPECTION", "RELEASE", "BOTH", "FALSE_RELEASE_AND_INSPECTION"]) {
			const bInspection = strMode !== "RELEASE";
			const bRelease = strMode !== "INSPECTION";
			const bFalseRelease = strMode === "FALSE_RELEASE_AND_INSPECTION";
			const CleanupFailure = new Error("Distinct public ConVar cleanup failure");
			const PublicExample = CreateExample({ PublicInspectionFailure: bInspection, PublicFailure: Failure, PublicReleaseFailure: bRelease, PublicReleaseFalse: bFalseRelease, PublicCleanupFailure: CleanupFailure });
			const Outcome = Capture(() => InvokeCommand(PublicExample, "Source"));
			g_Assert(Outcome.Thrown);

			if (bInspection && bRelease) {
				g_Assert.equal(Outcome.Value.name, "AggregateError");
				g_Assert.strictEqual(Outcome.Value.errors[0], Failure, "inspection error remains primary even for undefined/null/zero");

				if (bFalseRelease) {
					g_Assert.match(Outcome.Value.errors[1].message, /Could not release public ConVar/);

				} else {
					g_Assert.strictEqual(Outcome.Value.errors[1], CleanupFailure);
				}

			} else {
				g_Assert.strictEqual(Outcome.Value, bInspection ? Failure : CleanupFailure);
			}

			g_Assert.equal(PublicExample.State.PublicActive, bRelease);
			g_Assert.equal(PublicExample.State.PublicReleases, 1);
			PublicExample.State.InjectFailure = false;
			PublicExample.Exports.Unload();
			g_Assert.equal(PublicExample.State.Registered.size, 0);
			g_Assert.equal(PublicExample.State.PublicActive, false);
			g_Assert.equal(PublicExample.State.PublicReleases, bRelease ? 2 : 1, "only failed temporary restoration remains pending for unload");
			PublicExample.Exports.Unload();
			g_Assert.equal(PublicExample.State.PublicReleases, bRelease ? 2 : 1);
			unCases++;
		}
	}

	const FalsePublicReleaseExample = CreateExample({ PublicReleaseFailure: true, PublicReleaseFalse: true });
	const FalsePublicOutcome = Capture(() => InvokeCommand(FalsePublicReleaseExample, "Source"));
	g_Assert(FalsePublicOutcome.Thrown);
	g_Assert.match(FalsePublicOutcome.Value.message, /Could not release public ConVar/);
	FalsePublicReleaseExample.State.InjectFailure = false;
	FalsePublicReleaseExample.Exports.Unload();
	g_Assert.equal(FalsePublicReleaseExample.State.PublicReleases, 2);
	g_Assert.equal(FalsePublicReleaseExample.State.PublicActive, false);
	unCases++;

	console.log("Commands/cvars actual example: " + unCases + " startup/log/cleanup/error-identity/retry/false/reentrant/snapshot/command/public-ConVar cases passed;controlled dependency adapters,not native SDK/backend proof.");
}

const g_ClientRuntime = CreateCommandRuntime("client");
const g_ClientModule = {
	RegisterClientCommand: g_ClientRuntime.Register,
	RegisterClientCommandFilter: g_ClientRuntime.RegisterFilter,
	SendClientCommand: g_ClientRuntime.Send,
	UnregisterClientCommand: g_ClientRuntime.Unregister,
	UnregisterClientCommandFilter: g_ClientRuntime.UnregisterFilter,
};
const g_SayRuntime = CreateCommandRuntime("say");
const g_SayModule = {
	RegisterSayCommand: g_SayRuntime.Register,
	RegisterSayCommandFilter: g_SayRuntime.RegisterFilter,
	Say: g_SayRuntime.Say,
	SayToTeam: g_SayRuntime.SayTeam,
	UnregisterSayCommand: g_SayRuntime.Unregister,
	UnregisterSayCommandFilter: g_SayRuntime.UnregisterFilter,
};
const g_ServerRuntime = CreateCommandRuntime("server");
const g_RootRuntime = {
	BLOCK: g_CommandReturn.Block,
	CONTINUE: g_CommandReturn.Continue,
	CommandReturn: g_CommandReturn,
	HANDLED: g_CommandReturn.Handled,
	ExecuteServerCommand(strCommandLine, Options = {}) {
		g_ServerRuntime.Execute(strCommandLine, Options);

		return true;
	},
	MAX_COMMAND_LENGTH: g_unMaximumCommandLength,
	RegisterCommand: g_ServerRuntime.Register,
	UnregisterCommand: g_ServerRuntime.Unregister,
};

globalThis.sourcejs = {
	commands: g_RootRuntime,
	"commands/client": g_ClientModule,
	"commands/say": g_SayModule,
	"commands/server": {
		ExecuteServerCommand: g_RootRuntime.ExecuteServerCommand,
		RegisterCommand: g_ServerRuntime.Register,
		UnregisterCommand: g_ServerRuntime.Unregister,
	},
};

function VerifyCommandPayloadSnapshots(Commands) {
	const CreatePayload = () => ({ Arguments: ["known", "value"], Raw: "known value", Name: "known", Kind: "server", Index: -1, Message: "chat", TeamOnly: false });
	let unScenarios = 0;
	for (const strField of ["Arguments", "Raw", "Name", "Kind", "Index", "Message", "TeamOnly"]) {
		const Payload = CreatePayload();
		const Expected = Payload[strField];
		let unReads = 0;
		Object.defineProperty(Payload, strField, {
			get() {
				return (++unReads === 1) ? Expected : null;
			},
		});
		const Snapshot = new Commands.Command(Payload);
		g_Assert.equal(unReads, 1);
		g_Assert.deepEqual(Snapshot[strField], Expected);
		unScenarios++;
	}

	const CustomSlicePayload = CreatePayload();
	CustomSlicePayload.Arguments.slice = () => {
		g_Assert.fail("Command must not call the source array's custom slice method.");
	};
	const CustomSliceSnapshot = new Commands.Command(CustomSlicePayload);
	CustomSlicePayload.Arguments[0] = "changed";
	g_Assert.deepEqual(CustomSliceSnapshot.Arguments, ["known", "value"]);
	unScenarios++;

	class ArgumentArray extends Array {
		static get [Symbol.species]() {
			g_Assert.fail("Command must not call the source array's species constructor.");
		}
	}

	const SpeciesPayload = CreatePayload();
	SpeciesPayload.Arguments = new ArgumentArray("known", "value");
	g_Assert.deepEqual(new Commands.Command(SpeciesPayload).Arguments, ["known", "value"]);
	unScenarios++;

	for (const bInherited of [false, true]) {
		const Payload = CreatePayload();
		Payload.Arguments = new Array(2);
		Payload.Arguments[1] = "value";

		if (bInherited) {
			const Prototype = Object.create(Array.prototype);
			Object.defineProperty(Prototype, 0, { value: "inherited", configurable: true });
			Object.setPrototypeOf(Payload.Arguments, Prototype);
		}

		g_Assert.throws(() => new Commands.Command(Payload), TypeError);
		unScenarios++;
	}

	const GetterPayload = CreatePayload();
	let unArgumentReads = 0;
	Object.defineProperty(GetterPayload.Arguments, 0, {
		get() {
			return (++unArgumentReads === 1) ? "known" : 42;
		},
	});
	GetterPayload.Arguments.slice = function() {
		return this;
	};
	const GetterSnapshot = new Commands.Command(GetterPayload);
	g_Assert.equal(GetterSnapshot.GetArgument(0), "known");
	g_Assert.deepEqual(GetterSnapshot.Arguments, ["known", "value"]);
	g_Assert.equal(unArgumentReads, 1);
	unScenarios++;

	for (const InvalidValue of [undefined, null, false, 0, 1n, {}, () => {}, Symbol("argument"), NaN]) {
		const Payload = CreatePayload();
		Payload.Arguments[1] = InvalidValue;
		g_Assert.throws(() => new Commands.Command(Payload), TypeError);
		unScenarios++;
	}

	for (const InvalidLength of [undefined, null, -1, NaN, Infinity, 1.5, "2", 1n, Symbol("length")]) {
		const Payload = CreatePayload();
		Payload.Arguments = new Proxy(Payload.Arguments, {
			get(Target, Property, Receiver) {
				return (Property === "length") ? InvalidLength : Reflect.get(Target, Property, Receiver);
			},
		});
		g_Assert.throws(() => new Commands.Command(Payload), TypeError);
		unScenarios++;
	}

	const vecFields = ["Arguments", "Raw", "Name", "Kind", "Index"];
	for (let unFieldIndex = 0; unFieldIndex < (vecFields.length - 1); ++unFieldIndex) {
		const Payload = CreatePayload();
		Payload[vecFields[unFieldIndex]] = null;
		Object.defineProperty(Payload, vecFields[unFieldIndex + 1], {
			get() {
				g_Assert.fail("Invalid earlier fields must short-circuit later getters.");
			},
		});
		g_Assert.throws(() => new Commands.Command(Payload), TypeError);
		unScenarios++;
	}

	for (const Failure of [undefined, null, false, 0, 0n, "", NaN, Object.create(null), new Error("payload getter")]) {
		for (const strField of [...vecFields, "Message", "TeamOnly"]) {
			const Payload = CreatePayload();
			Object.defineProperty(Payload, strField, {
				get() {
					throw Failure;
				},
			});
			let bCaught = false;
			try {
				new Commands.Command(Payload);
			} catch (Exception) {
				g_Assert(Object.is(Exception, Failure));
				bCaught = true;
			}

			g_Assert(bCaught);
			unScenarios++;
		}
	}

	const Context = g_VM.createContext({
		module: { exports: {} },
		require(strName) {
			g_Assert.equal(strName, "internal/commands");

			return { CommandsRuntime: {} };
		},
	});
	new g_VM.Script(g_FileSystem.readFileSync(g_strCommandsPath, "utf8"), { filename: g_strCommandsPath }).runInContext(Context);
	const unSetterCalls = new g_VM.Script(`(() => {
		let unCalls = 0;
		Object.defineProperty(Array.prototype, 0, {
			configurable: true,
			set() {
				unCalls++;
			},
		});

		try {
			const Snapshot = new module.exports.Command({ Arguments: ["known"], Raw: "known", Name: "known", Kind: "server", Index: 0 });
			if (Snapshot.GetArgument(0) !== "known") {
				throw new Error("Argument copy lost its own first slot.");
			}

			return unCalls;
		} finally {
			delete Array.prototype[0];
		}
	})()`).runInContext(Context);
	g_Assert.equal(unSetterCalls, 0);
	unScenarios++;

	console.log(`Command payload ${unScenarios} snapshot/array/getter/failure profiles passed (actual wrapper;controlled native runtime,no engine IO).`);
}

try {
	const Commands = require(g_strCommandsPath);
	const Client = require(g_strClientPath);
	const Say = require(g_strSayPath);
	const Server = require(g_strServerPath);
	VerifyCommandPayloadSnapshots(Commands);

	let ServerPayload = null;

	function ServerCallback(Payload) {
		ServerPayload = Payload;

		return g_CommandReturn.Block;
	}

	AssertEqual(Commands.RegisterCommand("sjs_runtime", ServerCallback), true, "root RegisterCommand");
	AssertEqual(Commands.ExecuteCommand("sjs_runtime one two"), true, "root ExecuteCommand dispatch");
	AssertJSON(ServerPayload.Arguments, ["sjs_runtime", "one", "two"], "root dispatch arguments");
	AssertEqual(ServerPayload.Raw, "sjs_runtime one two", "root dispatch raw command");
	AssertEqual(Commands.UnregisterCommand("sjs_runtime", ServerCallback), true, "root UnregisterCommand");
	ServerPayload = null;
	AssertEqual(Commands.ExecuteCommand("sjs_runtime one two"), true, "root ExecuteCommand after unregister");
	AssertEqual(ServerPayload, null, "root ExecuteCommand should not invoke an unregistered callback");

	let strServerValue = null;
	const ModuleCallback = (Payload) => {
		strServerValue = Payload.Arguments[1];

		return g_CommandReturn.Handled;
	};
	AssertEqual(Server.RegisterCommand("sjs_server", ModuleCallback), true, "server RegisterCommand");
	AssertEqual(Server.ExecuteCommand("sjs_server value"), true, "server ExecuteCommand reports dispatch");
	AssertEqual(strServerValue, "value", "server payload");
	AssertEqual(Server.UnregisterCommand("sjs_server", ModuleCallback), true, "server UnregisterCommand");

	const vecFilteredNames = [];
	const ClientFilter = (Payload) => {
		vecFilteredNames.push(Payload.Name);

		return Commands.CommandReturn.Continue;
	};
	const ClientCallback = () => Commands.CommandReturn.Block;
	AssertEqual(Client.RegisterCommandFilter(ClientFilter), true, "client RegisterCommandFilter");
	AssertEqual(Client.RegisterCommand("sjs_client", ClientCallback), true, "client RegisterCommand");
	AssertEqual(g_ClientRuntime.Execute("sjs_client"), Commands.CommandReturn.Block, "client dispatch");
	AssertJSON(vecFilteredNames, ["sjs_client"], "client filter calls");
	AssertEqual(Client.UnregisterCommand("sjs_client", ClientCallback), true, "client UnregisterCommand");
	AssertEqual(Client.UnregisterCommandFilter(ClientFilter), true, "client UnregisterCommandFilter");
	AssertEqual(Client.SendCommand(3, "say hello"), true, "client SendCommand");
	AssertThrows(() => Client.SendCommand(3, ""), "client SendCommand should reject empty commands");
	AssertJSON(g_vecSentCommands, [[3, "say hello"]], "sent command log");

	AssertEqual(Say.SayCommand(4, "hello"), true, "SayCommand");
	AssertEqual(Say.SayTeamCommand(5, "team"), true, "SayTeamCommand");
	AssertJSON(g_vecSpokenMessages, [["SAY", 4, "hello"], ["SAYTEAM", 5, "team"]], "spoken message log");
	AssertEqual(Object.hasOwn(Server, "ModuleName"), false, "server should not expose ModuleName");
	AssertEqual(Object.hasOwn(Client, "ClientCommand"), false, "client should not expose ClientCommand alias");
	AssertEqual(Object.hasOwn(Commands.CommandReturn, "CONTINUE"), false, "CommandReturn should not expose uppercase members");

	VerifyCommandsCvarsExampleLifecycle();

	console.log("[smoke_commands_runtime] ok");
} finally {
	delete globalThis.sourcejs;
}
