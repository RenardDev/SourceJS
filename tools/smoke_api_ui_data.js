"use strict";

const g_Assert = require("node:assert/strict");
const g_Filesystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strExamplePath = g_Path.resolve(__dirname, "../examples/plugins/disabled/api-ui-data/index.js");
const g_strExampleSource = g_Filesystem.readFileSync(g_strExamplePath, "utf8");
const g_strLoggerPath = g_Path.resolve(__dirname, "../packages/sourcejs/loggers.js");
const g_LoggerScript = new g_VM.Script(g_Filesystem.readFileSync(g_strLoggerPath, "utf8"), { filename: g_strLoggerPath });
const g_unLoggerExecutionTimeoutMilliseconds = 1_000;

function CreateExampleLoggers(NativeLoggers) {
	const LoggerModule = { exports: {} };
	const Dependencies = {
		filesystem: {
			EnsureDirectoryExists: () => g_Assert.fail("UI/data logging must not create directories."),
			SourceFile: { OpenSourceFile: () => g_Assert.fail("UI/data logging must not write files.") },
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

	g_LoggerScript.runInNewContext({ module: LoggerModule, require: RequireLoggerDependency }, { timeout: g_unLoggerExecutionTimeoutMilliseconds });

	return LoggerModule.exports;
}

// Runs the complete plugin with isolated callback doubles. Unrelated synchronous SDK
// inspections are skipped; native IO, worker threads and engine lifetime are not modeled.
function CreateExampleContext({ bImmediate = false, bDuplicate = false, strFailure = "", strRegistrationFailure = "", vecCleanupFailures = [], strExampleSource = g_strExampleSource, ModuleOverrides = {} } = {}) {
	const State = {
		Logs: [],
		Pending: [],
		Requests: [],
		Settings: new Map(),
		Stores: [],
		Unregistered: [],
		CleanupAttempts: [],
		Commands: new Map(),
		Listener: null,
		ListenerActive: false,
		ListenerDisposals: 0,
		MenuCloses: 0,
		PlayerCalls: 0,
		SQLLoaded: false,
		Failure: strFailure,
	};

	const Fail = (strOperation) => {
		if (strOperation === State.Failure) {
			throw new Error(`Injected ${strOperation}`);
		}
	};

	const Request = (strOperation, Options, Callback, ProduceResult, Storage = null) => {
		g_Assert.equal(typeof Options, "object", strOperation);
		g_Assert.notEqual(Options, null, strOperation);
		g_Assert.equal(Array.isArray(Options), false, strOperation);
		if (Options.Blocking === true) {
			g_Assert.equal(strOperation.endsWith(":Close") || strOperation.endsWith(":Unload"), true, "Only cleanup may block");

		} else {
			g_Assert.equal(Options.Blocking, false, strOperation);
		}
		g_Assert.equal(typeof Callback, "function", strOperation);
		State.Requests.push(strOperation);

		if (Storage !== null) {
			g_Assert.equal(Storage.Closed, false, strOperation);
			Storage.Pending += 1;
		}

		const Complete = () => {
			let RequestError = null;
			let Value = null;
			try {
				Fail(strOperation);
				Value = ProduceResult();
			} catch (ErrorValue) {
				RequestError = ErrorValue;
			}

			if (Storage !== null) {
				Storage.Pending -= 1;
			}

			Callback(RequestError, Value);

			if (bDuplicate) {
				Callback(RequestError, Value);
			}
		};

		if (bImmediate || Options.Blocking) {
			Complete();

		} else {
			State.Pending.push(Complete);
		}
	};

	const CreateStorage = (strName, StorageOptions) => {
		Fail(`${strName}:Create`);
		const Storage = { Name: strName, Options: StorageOptions, Values: new Map(), Pending: 0, Closed: false, CloseAttempts: 0 };
		const Values = {
			SetSetting: (strKey, Value, Options, Callback) => Request(`${strName}:Set`, Options, Callback, () => {
				Storage.Values.set(strKey, Value);

				return true;
			}, Storage),
			GetSetting: (strKey, DefaultValue, Options, Callback) => Request(`${strName}:Get`, Options, Callback, () => Storage.Values.get(strKey) ?? DefaultValue, Storage),
			HasSetting: (strKey, Options, Callback) => Request(`${strName}:Has`, Options, Callback, () => Storage.Values.has(strKey), Storage),
			DeleteSetting: (strKey, Options, Callback) => Request(`${strName}:Delete`, Options, Callback, () => Storage.Values.delete(strKey), Storage),
			Keys: () => {
				Fail(`${strName}:Keys`);

				return Array.from(Storage.Values.keys());
			},
			get Size() {
				return Storage.Values.size;
			},
		};
		Storage.GetSettingsForPlayer = () => Values;
		Storage.Save = (Options, Callback) => Request(`${strName}:Save`, Options, Callback, () => true, Storage);
		Storage.ClearSettings = (Options, Callback) => Request(`${strName}:Clear`, Options, Callback, () => {
			Storage.Values.clear();

			return true;
		}, Storage);
		Storage.Close = (Options, Callback) => {
			g_Assert.equal(Storage.Pending, 0, "Storage closed before its requests completed");
			Storage.CloseAttempts += 1;
			Request(`${strName}:Close`, Options, Callback, () => {
				Storage.Closed = true;

				return true;
			}, Storage);
		};
		State.Stores.push(Storage);

		return Storage;
	};

	class IntegerSetting {
		constructor(strName, DefaultValue, Options) {
			this.Name = strName;
			this.ConVar = "sjs_example_volume";
			this.Storage = Options.Storage;
			this.Value = DefaultValue;
		}

		Set(strPlayerUniqueID, Value, Options, Callback) {
			g_Assert.equal(strPlayerUniqueID, "SOURCEJS_API_UI_DATA");
			Request(`${this.Storage.Name}:${this.Name}:Set`, Options, Callback, () => {
				this.Value = Value;

				return true;
			}, this.Storage);
		}

		Get(strPlayerUniqueID, Options, Callback) {
			g_Assert.equal(strPlayerUniqueID, "SOURCEJS_API_UI_DATA");
			Request(`${this.Storage.Name}:${this.Name}:Get`, Options, Callback, () => this.Value, this.Storage);
		}

		IsValid(Value) {
			const unMaximumValue = 10;

			return Number.isInteger(Value) && (Value >= 0) && (Value <= unMaximumValue);
		}
	}

	class ChoiceSetting extends IntegerSetting {
		constructor(strName, DefaultValue, Options) {
			super(strName, DefaultValue, Options);
			this.Choices = Options.Choices;
		}
	}

	const BuildSettingsMenu = (strPlayerUniqueID, Options) => {
		g_Assert.equal(strPlayerUniqueID, "SOURCEJS_API_UI_DATA");
		let bRefreshed = false;

		return {
			RefreshValues: (RequestOptions, Callback) => Request("Menu:Refresh", RequestOptions, Callback, () => {
				bRefreshed = true;

				return true;
			}),
			GetMenuRenderData: () => {
				g_Assert.equal(bRefreshed, true, "Rendered before refreshed values arrived");

				return { MenuMessage: "Volume 7", MenuTitle: Options.Title };
			},
			SelectMenuOption: (unPlayerIndex) => Options.SelectCallback(unPlayerIndex, Options.Settings[0]),
			CloseMenuForPlayer: () => {
				State.MenuCloses += 1;
			},
		};
	};

	class Backend {
		constructor(strName) {
			this.Name = strName;
		}
	}

	class FlatFileBackend extends Backend {
		constructor() {
			super("flatfile");
		}

		Unload(Options, Callback) {
			Request("FlatFile:Unload", Options, Callback, () => true);
		}
	}

	class SQLBackend extends Backend {
		constructor() {
			super("sql");
		}

		GetParent(strName, Options, Callback) {
			g_Assert.equal(State.SQLLoaded, true);
			Request("SQL:Parent", Options, Callback, () => ({ Name: strName }));
		}

		GetPlayer(strSteamID64, Options, Callback) {
			g_Assert.equal(State.SQLLoaded, true);
			Request("SQL:Player", Options, Callback, () => ({ SteamID64: strSteamID64 }));
		}

		Unload(Options, Callback) {
			Request("SQL:Unload", Options, Callback, () => true);
		}
	}

	class PlayerPermissions {
		constructor() {
			this.Name = "Player";
			this.SteamID64 = "76561197960265737";
			this.Permissions = new Set();
			this.Parents = new Set();
		}

		AddParent(strName, Options, Callback) {
			Request("Auth:AddParent", Options, Callback, () => {
				this.Parents.add({ Name: strName });

				return this;
			});
		}

		Add(strPermission, Options, Callback) {
			Request("Auth:AddPermission", Options, Callback, () => {
				this.Permissions.add(strPermission);

				return this;
			});
		}

		HasPermission() {
			return this.Parents.size > 0;
		}

		HasDirectPermission(strPermission) {
			return this.Permissions.has(strPermission);
		}

		Flatten() {
			return Array.from(this.Permissions);
		}

		keys() {
			return this.Permissions.keys();
		}
	}

	class AuthManager {
		FindAndAddAvailableBackends(vecBackends) {
			return vecBackends;
		}

		SetActiveBackend(strName, Options, Callback) {
			g_Assert.equal(strName, "sql");
			Request("SQL:Load", Options, Callback, () => {
				State.SQLLoaded = true;

				return true;
			});
		}

		GetParentPermissions(strName) {
			return { Name: strName, Add: (strPermission, Options, Callback) => Request("Auth:Permissions", Options, Callback, () => true) };
		}

		GetPlayerPermissionsFromSteamID(strSteamID) {
			g_Assert.equal(strSteamID, "STEAM_1:1:4");

			return new PlayerPermissions();
		}

		TargetsThisServer(Server) {
			return Server === null;
		}

		Unload(Options, Callback) {
			Request("Manager:Unload", Options, Callback, () => true);
		}
	}

	const mapCleanupFailures = new Map(vecCleanupFailures.map((Failure) => [Failure.Operation, Failure.Mode]));
	const AttemptCleanup = (strOperation) => {
		State.CleanupAttempts.push(strOperation);
		const strMode = mapCleanupFailures.get(strOperation);
		mapCleanupFailures.delete(strOperation);

		if (strMode === "throw") {
			throw new Error(`Injected ${strOperation} cleanup failure`);
		}

		return strMode !== "false";
	};

	const RegisterCommand = (strKind, strName, Callback) => {
		if (strRegistrationFailure === `${strKind}Throw`) {
			throw new Error(`Injected ${strKind} registration failure`);
		}

		if (strRegistrationFailure === strKind) {
			return false;
		}

		State.Commands.set(strKind, { Name: strName, Callback });

		return true;
	};

	const UnregisterCommand = (strKind, strName, Callback) => {
		const Command = State.Commands.get(strKind);
		g_Assert.ok(Command, `Do not retry a released ${strKind} command`);
		g_Assert.equal(Command.Name, strName);
		g_Assert.equal(Command.Callback, Callback);

		if (!AttemptCleanup(strKind)) {
			return false;
		}

		State.Commands.delete(strKind);
		State.Unregistered.push(strKind);

		return true;
	};

	const CommandModule = (strKind) => ({
		RegisterCommand: (strName, Callback) => RegisterCommand(strKind, strName, Callback),
		UnregisterCommand: (strName, Callback) => UnregisterCommand(strKind, strName, Callback),
	});

	const Modules = {
		"auth": { Backend },
		"auth/backends/flatfile": { FlatFileBackend },
		"auth/backends/sql": { SQLBackend },
		"auth/permissions": { PlayerPermissions },
		"auth/manager": { AuthManager, AUTH_MANAGER: { Parents: new Map([["admins", {}]]), Players: new Map([["Player", {}]]) } },
		"commands/client": CommandModule("Client"),
		"source": CommandModule("Source"),
		"settings/storage": { CreateStorage },
		"settings/menu": { BuildSettingsMenu },
		"settings/types": {
			IntegerSetting,
			ChoiceSetting,
			GetSetting: (strName) => State.Settings.get(strName) ?? null,
			ListSettings: () => Array.from(State.Settings.values()),
			RegisterSetting: (Setting) => {
				if (State.Settings.has(Setting.Name)) {
					throw new Error("Setting already registered.");
				}

				State.Settings.set(Setting.Name, Setting);

				return Setting;
			},
			UnregisterSetting: (strName) => State.Settings.delete(strName),
		},
		"messages": { GetBaseMessageConstants: () => ({ HUD_DESTINATION: {} }) },
		"players/entity": {
			Player: (unPlayerIndex) => {
				g_Assert.equal(unPlayerIndex, 1);
				State.PlayerCalls += 1;

				return { IsConnected: () => true, IsFakeClient: () => false };
			},
		},
		"loggers": CreateExampleLoggers({
			LogInfo: (strText) => {
				if (strRegistrationFailure === "Log") {
					throw new Error("Injected startup logging failure");
				}

				State.Logs.push({ Severity: "INFO", Text: strText });
			},
			LogWarning: (strText) => State.Logs.push({ Severity: "WARNING", Text: strText }),
		}),
		"listeners": {
			RegisterPluginUnloadingListener: (Callback) => {
				if (strRegistrationFailure === "Listener") {
					throw new Error("Unable to register the plugin-unloading listener.");
				}

				if (strRegistrationFailure === "ListenerNull") {
					return null;
				}

				State.Listener = Callback;
				State.ListenerActive = true;

				return {
					DisposeListener: () => {
						State.ListenerDisposals += 1;

						if (!AttemptCleanup("Listener")) {
							return false;
						}

						State.ListenerActive = false;

						return true;
					},
				};
			},
		},
		"translations": {
			GetLanguages: () => ({ en: "English" }),
			FormatText: (strText, Tokens) => strText.replace("{Name}", Tokens.Name),
		},
	};

	const unExecutionTimeoutMilliseconds = 5_000;
	const Context = g_VM.createContext({ exports: {}, require: (strName) => ModuleOverrides[strName] ?? Modules[strName] ?? {} });
	let LoadError = null;
	try {
		g_VM.runInContext(strExampleSource, Context, { filename: g_strExamplePath, timeout: unExecutionTimeoutMilliseconds });
	} catch (ErrorValue) {
		LoadError = ErrorValue;
	}

	return { Context, LoadError, State };
}

function VerifyOwnedSettingsResources(strExampleSource = g_strExampleSource) {
	let unScenarios = 0;
	const GetAPIs = (Example) => {
		g_Assert.equal(Example.LoadError, null);

		return g_VM.runInContext("({ RunStorageExample, RunRequestSequence, InvokeRequest, SummarizeValue, GetPendingCount: () => g_unPendingExampleCount, GetResourceCount: () => g_setPendingResources.size })", Example.Context);
	};
	const Isolated = CreateExampleContext({ bImmediate: true, strExampleSource });
	const IsolatedAPIs = GetAPIs(Isolated);
	IsolatedAPIs.RunStorageExample("isolated storage", "test", (Storage, Options, Callback) => Callback(null, true));
	g_Assert.equal(Isolated.State.Stores.length, 1);
	g_Assert.equal(Isolated.State.Stores[0].Options?.ConnectionString, "dbname=:memory:", "The example must not clear a namespace in the shared persistent database");
	g_Assert.deepEqual(JSON.parse(JSON.stringify(Isolated.State.Stores[0].Options)), { Backend: "sqlite3", ConnectionString: "dbname=:memory:" }, "The example must not clear a namespace in the shared persistent database");
	g_Assert.equal(Isolated.State.Stores[0].Closed, true);
	g_Assert.equal(IsolatedAPIs.GetPendingCount(), 0);
	g_Assert.equal(IsolatedAPIs.GetResourceCount(), 0);
	unScenarios += 1;

	for (const bImmediate of [false, true]) {
		for (const strName of ["Example Volume", "Example Theme"]) {
			const Example = CreateExampleContext({ bImmediate, strExampleSource });
			const APIs = PrepareInspection(Example);
			const Foreign = { Name: strName };
			Example.State.Settings.set(strName, Foreign);
			Example.State.Commands.get("Source").Callback({ Arguments: ["sjs_api_ui", "inspect"] });
			DrainRequests(Example.State);
			g_Assert.equal(Example.State.Settings.size, 1);
			g_Assert.equal(Example.State.Settings.get(strName), Foreign, "The example replaced or removed another owner's setting");
			g_Assert.equal(APIs.GetPendingCount(), 0);
			g_Assert(Example.State.Stores.every(Storage => Storage.Closed));
			Example.Context.exports.Unload();
			g_Assert.equal(Example.State.Settings.get(strName), Foreign);
			unScenarios += 1;
		}
	}

	const vecOpaqueErrors = [undefined, null, false, 0, "private operation data", Object.freeze(new Error("private operation data"))];
	for (const OperationError of vecOpaqueErrors) {
		let bUnexpectedStep = false;
		let bCompleted = false;
		IsolatedAPIs.RunRequestSequence([
			() => {
				throw OperationError;
			},
			(Next) => {
				bUnexpectedStep = true;
				Next(null);
			},
		], (SequenceError) => {
			bCompleted = true;
			if (OperationError === null) {
				g_Assert.equal(SequenceError.cause, null);

			} else {
				g_Assert.equal(SequenceError, OperationError);
			}
		});
		g_Assert.equal(bCompleted, true);
		g_Assert.equal(bUnexpectedStep, false, "An opaque failure started the next request");
		unScenarios += 1;

		for (const bClearFails of [false, true]) {
			for (const bCloseFails of [false, true]) {
				const ClearError = Object.freeze(new Error("private clear data"));
				const CloseError = Object.freeze(new Error("private close data"));
				let unCloseAttempts = 0;
				const Storage = {
					ClearSettings: (Options, Callback) => {
						g_Assert.equal(Options.Blocking, false);
						Callback(bClearFails ? ClearError : null, !bClearFails);
					},
					Close: (Options, Callback) => {
						unCloseAttempts += 1;
						g_Assert.equal(Options.Blocking, unCloseAttempts > 1);
						Callback((bCloseFails && (unCloseAttempts === 1)) ? CloseError : null, true);
					},
				};
				const Example = CreateExampleContext({ strExampleSource, ModuleOverrides: { "settings/storage": { CreateStorage: () => Storage } } });
				const APIs = GetAPIs(Example);
				let Captured = null;
				Example.Context.CaptureCompletion = (strLabel, RequestError) => {
					Captured = RequestError;
				};
				g_VM.runInContext("CompleteExampleRequest = (strLabel, RequestError) => { try { CaptureCompletion(strLabel, RequestError); } finally { g_unPendingExampleCount -= 1; } };", Example.Context);
				APIs.RunStorageExample("opaque failure", "isolated", () => {
					throw OperationError;
				});
				const vecFailures = (bClearFails || bCloseFails) ? Array.from(Captured.errors) : [Captured];
				g_Assert.equal(vecFailures.length, 1 + Number(bClearFails) + Number(bCloseFails));
				if (OperationError === null) {
					g_Assert.equal(vecFailures[0].cause, null, "A thrown null must not become callback success");

				} else {
					g_Assert.equal(vecFailures[0], OperationError);
				}

				if (bClearFails) {
					g_Assert.equal(vecFailures[1], ClearError);
				}

				if (bCloseFails) {
					g_Assert.equal(vecFailures.at(-1), CloseError);
				}

				g_Assert.equal(APIs.GetPendingCount(), 0);
				g_Assert.equal(APIs.GetResourceCount(), Number(bCloseFails));
				Example.Context.exports.Unload();
				g_Assert.equal(APIs.GetResourceCount(), 0);
				g_Assert.equal(unCloseAttempts, bCloseFails ? 2 : 1);
				unScenarios += 1;
			}
		}
	}

	Isolated.Context.exports.Unload();

	const strTreeName = "SourceJS API UI Data";
	for (const strFailure of ["existing", "menu", "tree", "both", "false"]) {
		const PrimaryError = Object.freeze(new Error("private tree data"));
		const MenuError = Object.freeze(new Error("private menu data"));
		const TreeError = Object.freeze(new Error("private unregister data"));
		const Stop = {};
		const setTrees = new Set();
		let unCreated = 0;
		let unMenuCloseAttempts = 0;
		let unUnregisterAttempts = 0;
		let Captured = null;
		let bThrew = false;
		const Foreign = { Name: strTreeName, Unregister: () => g_Assert.fail("Foreign tree must not be unregistered") };
		if (strFailure === "existing") {
			setTrees.add(Foreign);
		}

		class PlayerSettings {
			constructor(strName) {
				this.Name = strName;
				this.Menu = { CloseMenuForPlayer: () => {
					unMenuCloseAttempts += 1;
					if (((strFailure === "menu") || (strFailure === "both")) && (unMenuCloseAttempts === 1)) {
						throw MenuError;
					}
				} };
				setTrees.add(this);
				unCreated += 1;
			}

			AddIntegerSetting() {
				throw PrimaryError;
			}

			Unregister() {
				unUnregisterAttempts += 1;
				if (((strFailure === "tree") || (strFailure === "both")) && (unUnregisterAttempts === 1)) {
					throw TreeError;
				}

				if ((strFailure === "false") && (unUnregisterAttempts === 1)) {
					return false;
				}

				return setTrees.delete(this);
			}
		}

		const Example = CreateExampleContext({ strExampleSource, ModuleOverrides: { "settings/player": { PlayerSettings, GetPlayerSettings: () => setTrees.values() } } });
		const APIs = GetAPIs(Example);
		Example.Context.InspectOnlyTree = (strLabel, Use) => {
			if (strLabel !== "settings/player registry tree") {
				return null;
			}

			try {
				Use();
			} catch (CaughtError) {
				Captured = CaughtError;
				bThrew = true;
			}

			throw Stop;
		};
		g_VM.runInContext("LogResult = InspectOnlyTree;", Example.Context);
		g_Assert.throws(() => g_VM.runInContext("InspectUIAndData();", Example.Context), ErrorValue => ErrorValue === Stop);
		g_Assert.equal(bThrew, true);
		if (strFailure === "existing") {
			g_Assert.equal(unCreated, 0);
			g_Assert.equal(unUnregisterAttempts, 0);
			g_Assert.equal(setTrees.has(Foreign), true);

		} else {
			const Flatten = (ErrorValue) => Array.isArray(ErrorValue?.errors) ? Array.from(ErrorValue.errors).flatMap(Flatten) : [ErrorValue];
			const vecFailures = Flatten(Captured);
			g_Assert(vecFailures.includes(PrimaryError));
			g_Assert.equal(unMenuCloseAttempts, 1);
			g_Assert.equal(unUnregisterAttempts, 1, "Menu failure skipped tree unregistration");
			if ((strFailure === "menu") || (strFailure === "both")) {
				g_Assert(vecFailures.includes(MenuError));
			}

			if ((strFailure === "tree") || (strFailure === "both")) {
				g_Assert(vecFailures.includes(TreeError));
			}
		}

		Example.Context.exports.Unload();
		g_Assert.equal(APIs.GetResourceCount(), 0);
		g_Assert.equal(setTrees.size, (strFailure === "existing") ? 1 : 0);
		unScenarios += 1;
	}

	const Safe = CreateExampleContext({ bImmediate: true, strExampleSource });
	const SafeAPIs = GetAPIs(Safe);
	SafeAPIs.RunStorageExample("safe diagnostic", "test", () => {
		throw new Error("PASSWORD=private database data");
	});
	g_Assert(Safe.State.Logs.every(Record => !Record.Text.includes("private database data")));
	const Unserializable = { toJSON: () => {
		throw new Error("private serialization data");
	} };
	g_Assert.equal(SafeAPIs.SummarizeValue(Unserializable), "[unserializable value]");
	Safe.Context.exports.Unload();
	unScenarios += 1;

	return unScenarios;
}

function VerifyUILifecycleGuards() {
	let unProfiles = 0;
	for (const bImmediate of [false, true]) {
		for (const bDuplicate of [false, true]) {
			const Example = CreateExampleContext({ bImmediate, bDuplicate });
			const APIs = PrepareInspection(Example);
			const SourceCommand = Example.State.Commands.get("Source").Callback;
			const ClientCommand = Example.State.Commands.get("Client").Callback;
			for (const vecArguments of [["show"], ["show", "1", "extra"], ["inspect", "extra"]]) {
				g_Assert.equal(SourceCommand({ Arguments: ["sjs_api_ui", ...vecArguments] }), false);
			}

			g_Assert.equal(Example.State.PlayerCalls, 0);
			g_Assert.equal(Example.State.Requests.length, 0);
			SourceCommand({ Arguments: ["sjs_api_ui", "inspect"] });
			const unPriorRequestCount = Example.State.Requests.length;
			const unPriorLogCount = Example.State.Logs.length;
			Example.Context.exports.Unload();
			g_Assert.equal(SourceCommand({ Arguments: ["sjs_api_ui", "show", "1"] }), false);
			g_Assert.equal(ClientCommand({ Arguments: ["sjs_api_ui", "show", "1"] }), false);
			g_Assert.equal(Example.State.PlayerCalls, 0);
			DrainRequests(Example.State);
			const vecLaterRequests = Example.State.Requests.slice(unPriorRequestCount);
			g_Assert(vecLaterRequests.every(strName => strName.endsWith(":Clear") || strName.endsWith(":Close") || strName.endsWith(":Unload")), `Ordinary request after unload: ${vecLaterRequests}`);
			g_Assert.equal(Example.State.Logs.length, unPriorLogCount, "Completed callbacks logged after unload");
			g_Assert.equal(APIs.GetPendingCount(), 0);
			g_Assert.equal(g_VM.runInContext("g_setPendingResources.size", Example.Context), 0);
			g_Assert(Example.State.Stores.every(Storage => Storage.Closed));
			unProfiles += 1;
		}
	}

	const vecErrors = [new Error("Primary"), new Error("Manager"), new Error("SQL"), new Error("FlatFile")];
	const vecRetryOwners = [];
	class AuthManager {
		FindAndAddAvailableBackends(vecBackends) {
			return vecBackends;
		}

		SetActiveBackend(strName, Options, Callback) {
			Callback(vecErrors[0]);
		}

		Unload(Options, Callback) {
			if (Options.Blocking) {
				vecRetryOwners.push("Manager");
			}

			Callback(Options.Blocking ? null : vecErrors[1], true);
		}
	}

	class SQLBackend {
		constructor() {
			this.Name = "sql";
		}

		Unload(Options, Callback) {
			if (Options.Blocking) {
				vecRetryOwners.push("SQL");
			}

			Callback(Options.Blocking ? null : vecErrors[2], true);
		}
	}

	class FlatFileBackend {
		constructor() {
			this.Name = "flatfile";
		}

		Unload(Options, Callback) {
			if (Options.Blocking) {
				vecRetryOwners.push("FlatFile");
			}

			Callback(Options.Blocking ? null : vecErrors[3], true);
		}
	}

	const Authentication = CreateExampleContext({ bImmediate: true, ModuleOverrides: {
		"auth/manager": { AuthManager },
		"auth/backends/sql": { SQLBackend },
		"auth/backends/flatfile": { FlatFileBackend },
	} });
	g_Assert.equal(Authentication.LoadError, null);
	let Captured = null;
	Authentication.Context.IgnoreInspection = () => null;
	Authentication.Context.CaptureCompletion = (strLabel, RequestError) => {
		if (strLabel === "auth/manager permissions") {
			Captured = RequestError;
		}
	};
	g_VM.runInContext("LogResult = IgnoreInspection; CompleteExampleRequest = (strLabel, RequestError) => { try { CaptureCompletion(strLabel, RequestError); } finally { g_unPendingExampleCount -= 1; } }; InspectUIAndData();", Authentication.Context);
	g_Assert.deepEqual(Array.from(Captured.errors), vecErrors);
	g_Assert.equal(g_VM.runInContext("g_setPendingResources.size", Authentication.Context), 3);
	Authentication.Context.exports.Unload();
	g_Assert.deepEqual(vecRetryOwners, ["SQL", "FlatFile", "Manager"]);
	g_Assert.equal(g_VM.runInContext("g_setPendingResources.size", Authentication.Context), 0);
	unProfiles += 1;

	const StartupError = new Error("Startup logging");
	const Startup = CreateExampleContext({ ModuleOverrides: { "loggers": { LogInfo: () => { throw StartupError; }, LogWarning: () => {} } } });
	g_Assert.equal(Startup.LoadError, StartupError);
	g_Assert.equal(typeof Startup.Context.exports.Unload, "function");
	g_Assert.equal(Startup.Context.exports.Unload(), true);
	unProfiles += 1;

	return unProfiles;
}

function VerifyBorrowedStateCleanup(strExampleSource = g_strExampleSource) {
	let unScenarios = 0;
	const Flatten = (ErrorValue) => Array.isArray(ErrorValue?.errors) ? Array.from(ErrorValue.errors).flatMap(Flatten) : [ErrorValue];
	const CreateRun = (strLabel, ModuleOverrides) => {
		const strMarker = `LogResult("${strLabel}", `;
		const nStart = strExampleSource.indexOf(strMarker);
		g_Assert(nStart >= 0);
		g_Assert.equal(strExampleSource.indexOf(strMarker, nStart + strMarker.length), -1);
		const nEnd = strExampleSource.indexOf("\n\t});", nStart + strMarker.length);
		g_Assert(nEnd > nStart);
		const strCallback = strExampleSource.slice(nStart + strMarker.length, nEnd + "\n\t}".length);
		const Example = CreateExampleContext({ strExampleSource, ModuleOverrides });
		g_Assert.equal(Example.LoadError, null);

		return { Example, Run: () => g_VM.runInContext(`(${strCallback})()`, Example.Context, { timeout: 1000 }) };
	};
	const vecOpaqueErrors = [undefined, null, false, 0, "opaque operation", Object.freeze(new Error("opaque operation"))];
	const vecPhysicsProfiles = vecOpaqueErrors.flatMap(OperationError => ["", "Air", "Gravity", "Both"].map(strRestoreFailure => ({ OperationError, strRestoreFailure, bOperationFails: true })));
	vecPhysicsProfiles.push({ bOperationFails: false }, { strFalseResult: "Gravity" }, { strFalseResult: "Air" }, { strFalseResult: "RestoreGravity" }, { strFalseResult: "RestoreAir" });
	for (const Profile of vecPhysicsProfiles) {
		const AirError = Object.freeze(new Error("Air restoration"));
		const GravityError = Object.freeze(new Error("Gravity restoration"));
		const Gravity = { X: 0, Y: 0, Z: -800 };
		let flDensity = 1;
		let unActiveQueries = 0;
		const vecRestores = [];
		class PhysicsInterface {
			constructor() {
				this.Address = 1n;
			}

			static CreatePhysicsInterfaceFromAddress(unAddress) {
				return { Address: unAddress };
			}
		}

		class PhysicsEnvironment {
			constructor() {
				this.Address = 2n;
			}

			GetGravity() {
				return Gravity;
			}

			GetAirDensity() {
				return flDensity;
			}

			GetActiveObjectCount() {
				return 0;
			}

			IsInSimulation() {
				return false;
			}

			GetNextFrameTime() {
				return 1;
			}

			GetSimulationTime() {
				return 0;
			}

			GetSimulationTimestep() {
				return 1 / 64;
			}

			SetGravity(Value) {
				const bRestore = Value.Z === -800;
				if (bRestore) {
					vecRestores.push("Gravity");

					if (["Gravity", "Both"].includes(Profile.strRestoreFailure)) {
						throw GravityError;
					}
				}

				if (Profile.strFalseResult === (bRestore ? "RestoreGravity" : "Gravity")) {
					return false;
				}

				Object.assign(Gravity, Value);

				return true;
			}

			SetAirDensity(flValue) {
				const bRestore = flValue === 1;
				if (bRestore) {
					vecRestores.push("Air");

					if (["Air", "Both"].includes(Profile.strRestoreFailure)) {
						throw AirError;
					}
				}

				if (Profile.strFalseResult === (bRestore ? "RestoreAir" : "Air")) {
					return false;
				}

				flDensity = flValue;

				return true;
			}

			ActiveObjects() {
				unActiveQueries += 1;
				if (Profile.bOperationFails) {
					throw Profile.OperationError;
				}

				return [];
			}

			static CreatePhysicsEnvironmentFromAddress(unAddress) {
				return { Address: unAddress };
			}
		}

		const Inspection = CreateRun("physics live environment", { "physics": { PhysicsInterface, PhysicsEnvironment, GetServerGravityConVarValue: () => 800 } });
		let bThrew = false;
		let Caught = null;
		try {
			const Result = Inspection.Run();
			g_Assert.equal(Result.Before.Gravity.Z, -800);
			g_Assert.equal(Result.After.Gravity.Z, -801);
		} catch (ErrorValue) {
			bThrew = true;
			Caught = ErrorValue;
		}

		g_Assert.deepEqual(vecRestores, ["Air", "Gravity"]);
		g_Assert.equal(bThrew, Boolean(Profile.bOperationFails || Profile.strFalseResult));
		if (Profile.bOperationFails) {
			const vecExpected = [Profile.OperationError];
			if (["Air", "Both"].includes(Profile.strRestoreFailure)) {
				vecExpected.push(AirError);
			}

			if (["Gravity", "Both"].includes(Profile.strRestoreFailure)) {
				vecExpected.push(GravityError);
			}

			g_Assert.deepEqual(Flatten(Caught), vecExpected, "Physics lost an operation or independent restoration failure");
		}

		if (["Gravity", "Air"].includes(Profile.strFalseResult)) {
			g_Assert.equal(unActiveQueries, 0, "False mutation result did not stop the operation");
		}

		Inspection.Example.Context.exports.Unload();
		g_Assert.deepEqual(vecRestores, ["Air", "Gravity"], "Borrowed physics writes were retained for unload");
		unScenarios += 1;
	}

	const vecStudioProfiles = vecOpaqueErrors.flatMap(OperationError => ["", "Minimums", "Maximums", "Release", "All"].map(strCleanupFailure => ({ OperationError, strCleanupFailure, bOperationFails: true })));
	vecStudioProfiles.push({ bOperationFails: false }, { bHeaderLookupFails: true }, { bMissingHitbox: true });
	for (const Profile of vecStudioProfiles) {
		const MinimumsError = Object.freeze(new Error("Minimums restoration"));
		const MaximumsError = Object.freeze(new Error("Maximums restoration"));
		const ReleaseError = Object.freeze(new Error("Native release after decrement"));
		const HeaderError = Object.freeze(new Error("Header lookup"));
		const vecRestores = [];
		let unReleaseAttempts = 0;
		let bReleased = false;
		const CreateBounds = (flInitialX, strRole, Failure) => {
			let flX = flInitialX;

			return {
				get X() {
					return flX;
				},
				set X(flValue) {
					g_Assert.equal(bReleased, false, "Borrowed header was written after release");
					if (flValue === flInitialX) {
						vecRestores.push(strRole);
						if ((Profile.strCleanupFailure === strRole) || (Profile.strCleanupFailure === "All")) {
							throw Failure;
						}
					}

					flX = flValue;
				},
				Y: 2,
				Z: 3,
			};
		};
		const Hitbox = { Mins: CreateBounds(1, "Minimums", MinimumsError), Maxs: CreateBounds(4, "Maximums", MaximumsError), Bone: 1, Group: 2, Name: "fixture", Address: 0x3000n };
		const HitboxSet = { GetHitbox: () => Profile.bMissingHitbox ? null : Hitbox, HitboxCount: 1, Name: "fixture", Address: 0x2000n };
		const Header = {
			GetHitboxSet: () => HitboxSet,
			GetHitbox: () => {
				if (Profile.bOperationFails) {
					throw Profile.OperationError;
				}

				return Hitbox;
			},
			HitboxSetCount: 1,
			Name: "fixture",
			Address: 0x1000n,
		};
		const Model = { Handle: 9, IsValid: () => true, GetName: () => "fixture.mdl" };
		const Inspection = CreateRun("studio/cache live hitbox", {
			"stringtables": { STRING_TABLES: { Find: () => ({ GetValues: () => ["models/fixture.mdl"] }) } },
			"studio/constants": { INVALID_MODEL_HANDLE: 0xFFFF, StudioFlags: { Render: 1 } },
			"studio/cache": {
				FindModel: () => Model,
				GetModelHeader: () => {
					if (Profile.bHeaderLookupFails) {
						throw HeaderError;
					}

					return Header;
				},
				Release: (hModelHandle) => {
					g_Assert.equal(hModelHandle, 9);
					bReleased = true;
					unReleaseAttempts += 1;
					if (["Release", "All"].includes(Profile.strCleanupFailure)) {
						throw ReleaseError;
					}

					return 0;
				},
			},
		});
		let bThrew = false;
		let Caught = null;
		try {
			Inspection.Run();
		} catch (ErrorValue) {
			bThrew = true;
			Caught = ErrorValue;
		}

		g_Assert.equal(bThrew, Boolean(Profile.bOperationFails || Profile.bHeaderLookupFails || Profile.bMissingHitbox));
		if (Profile.bOperationFails) {
			const vecExpected = [Profile.OperationError];
			if (["Minimums", "All"].includes(Profile.strCleanupFailure)) {
				vecExpected.push(MinimumsError);
			}

			if (["Maximums", "All"].includes(Profile.strCleanupFailure)) {
				vecExpected.push(MaximumsError);
			}

			if (["Release", "All"].includes(Profile.strCleanupFailure)) {
				vecExpected.push(ReleaseError);
			}

			g_Assert.deepEqual(Flatten(Caught), vecExpected, "Studio lost an operation or independent cleanup failure");
			if (["Release", "All"].includes(Profile.strCleanupFailure)) {
				const HasUnknownRelease = (ErrorValue) => (ErrorValue?.UnconfirmedReleaseCount === 1) || (Array.isArray(ErrorValue?.errors) && Array.from(ErrorValue.errors).some(HasUnknownRelease));
				g_Assert(HasUnknownRelease(Caught), "Native release uncertainty was not reported");
			}
		}

		if (Profile.bHeaderLookupFails) {
			g_Assert.equal(Caught, HeaderError);
		}

		if (!Profile.bHeaderLookupFails && !Profile.bMissingHitbox) {
			g_Assert.deepEqual(vecRestores, ["Minimums", "Maximums"]);
		}

		g_Assert.equal(unReleaseAttempts, 1);
		Inspection.Example.Context.exports.Unload();
		g_Assert.equal(unReleaseAttempts, 1, "Unknown native release outcome was blindly retried");
		unScenarios += 1;
	}

	const Template = { ResolveTemporaryEntityField: () => ({ ValueType: "color", ValueFields: ["Red", "Green", "Blue", "Alpha"] }), GetTemporaryEntityFieldNames: () => ["Color", "StartPoint", "LifeTime"] };
	class TemporaryEntity {
		constructor(strName, Values) {
			g_Assert.equal(strName, "BeamEntPoint");
			this.Values = { ...Values };
		}

		SetTemporaryEntityPropertyFloat(strName, flValue) {
			this.Values[strName] = flValue;
		}

		GetTemporaryEntityPropertyFloat(strName) {
			return this.Values[strName];
		}

		GetTemporaryEntityProperty(strName) {
			g_Assert.equal(strName, "Color");

			return { ConvertColorToArray: () => this.Values.Color };
		}

		GetTemporaryEntityPropertyVector(strName) {
			g_Assert.equal(strName, "StartPoint");

			return { ConvertMathStructureToArray: () => this.Values.StartPoint };
		}
	}

	const Detached = CreateRun("effects TemporaryEntity typed fields", { "effects": { TemporaryEntity, GetTemporaryEntityTemplate: () => Template } });
	const DescriptorResult = Detached.Run();
	g_Assert.equal(DescriptorResult.ValueType, "color", "The example must consume the real descriptor ValueType property");
	g_Assert.equal(DescriptorResult.LifeTime, 1.5);
	Detached.Example.Context.exports.Unload();
	unScenarios += 1;

	return unScenarios;
}

function PrepareInspection(Example) {
	g_Assert.equal(Example.LoadError, null);
	Example.State.InspectionResults = new Map();
	Example.Context.LogResultOverride = (strLabel, Operation) => {
		if (["translations languages", "translations format", "auth runtime state"].includes(strLabel)) {
			const Value = Operation();
			Example.State.InspectionResults.set(strLabel, Value);
			return Value;
		}

		return null;
	};

	g_VM.runInContext("LogResult = LogResultOverride;", Example.Context);

	return g_VM.runInContext("({ InvokeRequest, RunRequestSequence, SummarizeValue, ShowToPlayer, GetPendingCount: () => g_unPendingExampleCount })", Example.Context);
}

function DrainRequests(State, unMaximumCompletionCount = 100) {
	let unCompletionCount = 0;
	while (State.Pending.length !== 0) {
		unCompletionCount += 1;
		g_Assert.ok(unCompletionCount <= unMaximumCompletionCount, `DrainRequests exceeded completion limit Count=${unCompletionCount} Limit=${unMaximumCompletionCount}`);
		const Complete = State.Pending.shift();
		Complete();
	}
}

function FindWorkflowRecords(State, strLabel) {
	return State.Logs.filter((Record) => Record.Text.startsWith(`${strLabel}: `));
}

function ParseWorkflowResult(State, strLabel) {
	const vecRecords = FindWorkflowRecords(State, strLabel);
	g_Assert.equal(vecRecords.length, 1, strLabel);
	g_Assert.equal(vecRecords[0].Severity, "INFO", vecRecords[0].Text);

	return JSON.parse(vecRecords[0].Text.slice(`${strLabel}: `.length));
}

function GetFailedWorkflowLabel(strFailure, vecLabels) {
	if ((strFailure === "Menu:Refresh") || strFailure.startsWith("api_ui_data_menu_example:")) {
		return vecLabels[0];
	}

	if (strFailure.startsWith("api_ui_data_storage_example:")) {
		return vecLabels[1];
	}

	if (strFailure.startsWith("api_ui_data_types_example:")) {
		return vecLabels[2];
	}

	return (strFailure === "") ? "" : vecLabels[3];
}

function RunScenario(Options) {
	const Example = CreateExampleContext(Options);
	g_Assert.equal(Object.hasOwn(Example.Context.exports, "unload"), false, "UI example must not export the obsolete lowercase lifecycle");
	g_Assert.equal(typeof Example.Context.exports.Unload, "function", "UI example must publish canonical cleanup");

	const APIs = PrepareInspection(Example);
	const State = Example.State;
	const Command = State.Commands.get("Source");
	const vecLabels = ["settings/menu rendered value", "settings/storage player view", "settings/types registered values", "auth/manager permissions"];
	const strFailure = Options.strFailure ?? "";
	g_Assert.equal(Command.Callback({ Arguments: ["sjs_api_ui", "inspect"] }), true);

	if (!Options.bImmediate && (strFailure === "")) {
		g_Assert.equal(APIs.GetPendingCount(), vecLabels.length);
		g_Assert.ok(State.Pending.length > 0);

		for (const strLabel of vecLabels) {
			g_Assert.equal(FindWorkflowRecords(State, strLabel).length, 0, "Reported before callbacks");
		}
	}

	if (State.Pending.length !== 0) {
		const unRequestCount = State.Requests.length;
		g_Assert.equal(Command.Callback({ Arguments: ["sjs_api_ui", "inspect"] }), false);
		g_Assert.equal(State.Requests.length, unRequestCount, "Overlapping inspection started requests");
	}

	DrainRequests(State);
	g_Assert.equal(APIs.GetPendingCount(), 0);
	g_Assert.equal(State.Settings.size, 0, "Temporary settings remained registered");

	for (const Storage of State.Stores) {
		g_Assert.equal(Storage.Pending, 0);
		g_Assert.equal(Storage.CloseAttempts, 1);
		g_Assert.equal(Storage.Closed, strFailure !== `${Storage.Name}:Close`);

		if (strFailure !== `${Storage.Name}:Clear`) {
			g_Assert.equal(Storage.Values.size, 0);
		}
	}

	const strFailedLabel = GetFailedWorkflowLabel(strFailure, vecLabels);
	for (const strLabel of vecLabels) {
		const vecRecords = FindWorkflowRecords(State, strLabel);
		g_Assert.equal(vecRecords.length, 1, strLabel);
		g_Assert.equal(vecRecords[0].Severity, (strLabel === strFailedLabel) ? "WARNING" : "INFO", vecRecords[0].Text);

		if (strLabel === strFailedLabel) {
			g_Assert.ok(vecRecords[0].Text.endsWith("request failed; details are omitted to protect sensitive data."), vecRecords[0].Text);
		}
	}

	for (const strOperation of ["Manager:Unload", "SQL:Unload", "FlatFile:Unload"]) {
		g_Assert.equal(State.Requests.filter((strRequest) => strRequest === strOperation).length, 1, strOperation);
	}

	g_Assert.deepEqual(JSON.parse(JSON.stringify(State.InspectionResults.get("translations languages"))), { en: "English" });
	g_Assert.equal(State.InspectionResults.get("translations format"), "Hello SourceJS");
	g_Assert.deepEqual(JSON.parse(JSON.stringify(State.InspectionResults.get("auth runtime state"))), { Parents: ["admins"], Players: ["Player"] });

	if (strFailure === "") {
		g_Assert.deepEqual(ParseWorkflowResult(State, vecLabels[0]), { Message: "Volume 7", Selected: { PlayerIndex: 1, Setting: "Example Volume" }, Title: "SourceJS Settings" });
		g_Assert.deepEqual(ParseWorkflowResult(State, vecLabels[1]), { Has: true, Keys: ["sjs_api_volume"], Size: 1, Value: 7, Saved: true, Deleted: true });
		const Types = ParseWorkflowResult(State, vecLabels[2]);
		g_Assert.deepEqual(Types, { Choice: "light", ChoiceOptions: ["dark", "light"], ConVar: "sjs_example_volume", Registered: true, Valid: true, Value: 7 });

		const Auth = ParseWorkflowResult(State, vecLabels[3]);
		g_Assert.equal(Auth.Authorized, true);
		g_Assert.equal(Auth.Direct, true);
		g_Assert.equal(Auth.PermissionType, true);
		g_Assert.deepEqual(Auth.Backends, ["flatfile", "sql"]);
		g_Assert.equal(Auth.SQLParent.Name, "admins");
		g_Assert.equal(Auth.SQLPlayer.SteamID64, Auth.Player.SteamID64);
		g_Assert.equal(State.MenuCloses, 1);
	}

	State.Listener("another-plugin");
	g_Assert.equal(State.Commands.size, 2);
	// The first close failed above; a later lifecycle cleanup must retry the retained owner.
	State.Failure = "";
	State.Listener("api-ui-data");
	g_Assert.equal(State.Commands.size, 0);
	g_Assert.equal(Example.Context.exports.Unload(), true);
	g_Assert.equal(State.ListenerDisposals, 1);
	g_Assert.deepEqual(State.Unregistered, ["Source", "Client"]);
}

function VerifyRequestCompletionLimit() {
	const unMaximumCompletionCount = 1;
	let unCompletionCount = 0;
	const Complete = () => {
		unCompletionCount += 1;
	};

	DrainRequests({ Pending: [] }, 0);
	DrainRequests({ Pending: [Complete] }, unMaximumCompletionCount);
	g_Assert.equal(unCompletionCount, 1);
	g_Assert.throws(() => DrainRequests({ Pending: [Complete, Complete] }, unMaximumCompletionCount), /DrainRequests exceeded completion limit/);
	g_Assert.equal(unCompletionCount, 2);
}

function VerifyRequestHelpersAndCommands() {
	const unExpectedPlayerSummaryPropertyCount = 11;
	const Example = CreateExampleContext();
	g_Assert.equal(Object.hasOwn(Example.Context.exports, "unload"), false, "UI example must not export the obsolete lowercase lifecycle");
	g_Assert.equal(typeof Example.Context.exports.Unload, "function", "UI example must publish canonical cleanup");

	const APIs = PrepareInspection(Example);
	let unCompletionCount = 0;
	const RequestError = new Error("callback failure");
	g_Assert.throws(() => APIs.InvokeRequest((Complete) => Complete(null), () => {
		unCompletionCount += 1;
		throw RequestError;
	}), (ErrorValue) => ErrorValue === RequestError);
	g_Assert.equal(unCompletionCount, 1);

	APIs.RunRequestSequence([
		(Next) => {
			Next(null);
			Next(RequestError);
		},
		(Next) => Next(null),
	], (ErrorValue) => {
		g_Assert.equal(ErrorValue, null);
		unCompletionCount += 1;
	});
	g_Assert.equal(unCompletionCount, 2);

	const unAddress = 0x20_0000_0000_0001n;
	g_Assert.equal(APIs.SummarizeValue({ Address: unAddress }), `{"Address":"${unAddress}n"}`);

	const strUnsafePlayerIndex = String(Number.MAX_SAFE_INTEGER + 1);
	for (const Value of [undefined, "", "0", "-1", "1.5", "NaN", "Infinity", strUnsafePlayerIndex]) {
		g_Assert.equal(APIs.ShowToPlayer(Value), false);
	}

	g_Assert.equal(Example.State.PlayerCalls, 0);
	g_Assert.equal(Object.keys(APIs.ShowToPlayer("1")).length, unExpectedPlayerSummaryPropertyCount);
	g_Assert.equal(Example.State.PlayerCalls, 1);
	g_Assert.equal(Example.Context.exports.Unload(), true);
	g_Assert.equal(Example.Context.exports.Unload(), true);
	g_Assert.equal(Example.State.ListenerDisposals, 1);
}

function VerifyCleanupFailures(strExampleSource = g_strExampleSource) {
	const unInitialCleanupAttemptCount = 3;
	const vecProfiles = [[]];
	for (const strOperation of ["Source", "Client", "Listener"]) {
		for (const strMode of ["false", "throw"]) {
			vecProfiles.push([{ Operation: strOperation, Mode: strMode }]);
		}
	}

	vecProfiles.push([{ Operation: "Source", Mode: "throw" }, { Operation: "Client", Mode: "false" }, { Operation: "Listener", Mode: "throw" }]);
	for (const vecCleanupFailures of vecProfiles) {
		const Example = CreateExampleContext({ vecCleanupFailures, strExampleSource });
		g_Assert.equal(Example.LoadError, null);
		g_Assert.equal(Object.hasOwn(Example.Context.exports, "unload"), false, "Cleanup fixture must not export the obsolete lowercase lifecycle");
		g_Assert.equal(typeof Example.Context.exports.Unload, "function", "Cleanup fixture must publish canonical cleanup");

		if (vecCleanupFailures.length > 0) {
			g_Assert.throws(() => Example.Context.exports.Unload(), (ErrorValue) => {
				g_Assert.equal(ErrorValue.name, "AggregateError");
				g_Assert.equal(ErrorValue.errors.length, vecCleanupFailures.length);

				return true;
			});
		} else {
			g_Assert.equal(Example.Context.exports.Unload(), true);
		}

		g_Assert.deepEqual(Example.State.CleanupAttempts, ["Source", "Client", "Listener"]);
		g_Assert.equal(Example.Context.exports.Unload(), true);
		g_Assert.deepEqual(Example.State.CleanupAttempts.slice(unInitialCleanupAttemptCount), vecCleanupFailures.map((Failure) => Failure.Operation));
		g_Assert.equal(Example.State.Commands.size, 0);
		g_Assert.equal(Example.State.ListenerActive, false);
		const unAttemptCount = Example.State.CleanupAttempts.length;
		g_Assert.equal(Example.Context.exports.Unload(), true);
		g_Assert.equal(Example.State.CleanupAttempts.length, unAttemptCount);
	}

	for (const strRegistrationFailure of ["Source", "Client", "SourceThrow", "ClientThrow", "Listener", "ListenerNull", "Log"]) {
		const Example = CreateExampleContext({ strRegistrationFailure, strExampleSource });
		g_Assert.notEqual(Example.LoadError, null, strRegistrationFailure);
		g_Assert.equal(Example.State.Commands.size, 0, strRegistrationFailure);
		g_Assert.equal(Example.State.ListenerActive, false, strRegistrationFailure);
	}

	const FailedRollback = CreateExampleContext({ strRegistrationFailure: "Listener", vecCleanupFailures: [{ Operation: "Source", Mode: "throw" }, { Operation: "Client", Mode: "false" }], strExampleSource });
	g_Assert.equal(FailedRollback.LoadError.name, "AggregateError");
	g_Assert.equal(FailedRollback.LoadError.errors.length, 2);
	g_Assert.deepEqual(FailedRollback.State.CleanupAttempts, ["Source", "Client"]);
	g_Assert.equal(FailedRollback.Context.Cleanup(), true);
	g_Assert.equal(FailedRollback.State.Commands.size, 0);
}

function VerifyStudioCacheExample(strExampleSource = g_strExampleSource) {
	const unExecutionTimeoutMilliseconds = 1_000;
	const strMarker = 'LogResult("studio/cache live hitbox", ';
	const strCallbackBodyEnd = "\n\t}";
	const strCallbackEndMarker = strCallbackBodyEnd + ");";
	const nMarkerIndex = strExampleSource.indexOf(strMarker);
	g_Assert.ok(nMarkerIndex >= 0);
	g_Assert.equal(strExampleSource.indexOf(strMarker, nMarkerIndex + strMarker.length), -1);
	const nCallbackStart = nMarkerIndex + strMarker.length;
	const nCallbackEnd = strExampleSource.indexOf(strCallbackEndMarker, nCallbackStart);
	g_Assert.ok(nCallbackEnd > nCallbackStart);
	const strCallback = strExampleSource.slice(nCallbackStart, nCallbackEnd + strCallbackBodyEnd.length);

	for (const Scenario of [{ HeaderFailure: false, MissingHitbox: false }, { HeaderFailure: true, MissingHitbox: false }, { HeaderFailure: false, MissingHitbox: true }]) {
		let unReleaseCount = 0;
		const Hitbox = { Mins: { X: 1, Y: 2, Z: 3 }, Maxs: { X: 4, Y: 5, Z: 6 }, Bone: 1, Group: 2, Name: "fixture", Address: 0x3000n };
		const HitboxSet = { GetHitbox: () => Scenario.MissingHitbox ? null : Hitbox, HitboxCount: 1, Name: "fixture", Address: 0x2000n };
		const Header = {
			GetHitboxSet: () => HitboxSet,
			GetHitbox: () => Scenario.HeaderFailure ? null : Hitbox,
			HitboxSetCount: 1,
			Name: "fixture",
			Address: 0x1000n,
		};
		const Model = { Handle: 9, IsValid: () => true, GetName: () => "fixture.mdl" };
		const Context = {
			STRING_TABLES: {
				Find: (strName) => {
					g_Assert.equal(strName, "modelprecache");

					return { GetValues: () => ["models/fixture.mdl"] };
				},
			},
			FindModel: () => Model,
			GetModelHeader: () => Header,
			Release: (hModelHandle) => {
				g_Assert.equal(hModelHandle, Model.Handle);
				unReleaseCount += 1;

				return 0;
			},
			INVALID_MODEL_HANDLE: 0xFFFF,
			StudioFlags: { Render: 0x01 },
		};
		const Example = CreateExampleContext({ strExampleSource, ModuleOverrides: {
			"studio/cache": { FindModel: Context.FindModel, GetModelHeader: Context.GetModelHeader, Release: Context.Release },
			"studio/constants": { INVALID_MODEL_HANDLE: Context.INVALID_MODEL_HANDLE, StudioFlags: Context.StudioFlags },
			"stringtables": { STRING_TABLES: Context.STRING_TABLES },
		} });
		g_Assert.equal(Example.LoadError, null);
		const Run = () => g_VM.runInContext(`(${strCallback})()`, Example.Context, { timeout: unExecutionTimeoutMilliseconds });
		if (Scenario.HeaderFailure || Scenario.MissingHitbox) {
			g_Assert.throws(Run, /selected hitbox|No precached studio model/);
		} else {
			const Result = Run();
			g_Assert.equal(Result.After.Minimums.X, 0.875);
			g_Assert.equal(Result.After.Maximums.X, 4.125);
			g_Assert.equal(Result.SameAddress, true);
		}

		g_Assert.equal(Hitbox.Mins.X, 1);
		g_Assert.equal(Hitbox.Maxs.X, 4);
		g_Assert.equal(unReleaseCount, 1);
		Example.Context.exports.Unload();
	}
}

function VerifyLiteralExampleLogging(strRestoredFunction = null) {
	const strLabel = "UI 100%% %j";
	const Value = { Value: "Result 100%% %s", Address: 0x1234n };
	const strSummary = '{"Value":"Result 100%% %s","Address":"4660n"}';
	let unProfileCount = 0;
	for (const strOperation of ["Sync", "Success", "Failure"]) {
		for (const bUnloading of [false, true]) {
			const Example = CreateExampleContext({ bImmediate: true });
			g_Assert.equal(Example.LoadError, null);
			try {
				if (strRestoredFunction !== null) {
					g_VM.runInContext(strRestoredFunction, Example.Context, { timeout: g_unLoggerExecutionTimeoutMilliseconds });
				}

				if (bUnloading) {
					Example.Context.exports.Unload();
				}

				Example.State.Logs.length = 0;
				let unCallbackCount = 0;
				if (strOperation === "Sync") {
					const Result = Example.Context.LogResult(strLabel, () => {
						unCallbackCount += 1;

						return Value;
					});
					g_Assert.equal(Result, bUnloading ? undefined : Value);
					g_Assert.equal(unCallbackCount, Number(!bUnloading));

				} else {
					const RequestError = (strOperation === "Failure") ? new Error("PASSWORD=private data") : null;
					g_Assert.equal(Example.Context.LogRequestResult(strLabel, RequestError, Value), undefined);
				}

				const vecExpected = bUnloading ? [] : [{
					Severity: (strOperation === "Failure") ? "WARNING" : "INFO",
					Text: (strOperation === "Failure") ? `${strLabel}: request failed; details are omitted to protect sensitive data.` : `${strLabel}: ${strSummary}`,
				}];
				g_Assert.deepEqual(Example.State.Logs, vecExpected, "UI/data logging must preserve literal data, including percent sequences and BigInt JSON");
				g_Assert.equal(Example.State.Requests.length, 0, "Logging must not start external requests");
				g_Assert.equal(Example.State.Stores.length, 0);
			} finally {
				Example.Context.exports.Unload();
				g_Assert.equal(Example.State.Commands.size, 0);
			}

			unProfileCount += 1;
		}
	}

	return unProfileCount;
}

function VerifyShowSummaryLogging(strRestoredFunction = null) {
	const unExpectedMessageCallCount = 11;
	const Example = CreateExampleContext();
	g_Assert.equal(Example.LoadError, null);
	try {
		if (strRestoredFunction !== null) {
			g_VM.runInContext(strRestoredFunction, Example.Context, { timeout: g_unLoggerExecutionTimeoutMilliseconds });
		}

		let unMessageCallCount = 0;
		// Deliberately noncanonical results probe literal-data transport, not native message return types.
		Example.Context.CaptureMessageResult = () => {
			unMessageCallCount += 1;

			return { Text: "Message 100%% %s" };
		};
		g_VM.runInContext("LogResult = CaptureMessageResult;", Example.Context, { timeout: g_unLoggerExecutionTimeoutMilliseconds });
		Example.State.Logs.length = 0;
		const Results = Example.Context.ShowToPlayer("1");
		const strExpectedText = `show 1: ${JSON.stringify(Results)}`;
		g_Assert.equal(unMessageCallCount, unExpectedMessageCallCount);
		g_Assert.equal(Example.State.PlayerCalls, 1);
		g_Assert.deepEqual(Example.State.Logs, [{ Severity: "INFO", Text: strExpectedText }], "Show summary must preserve literal result data");
		g_Assert.equal(Example.State.Requests.length, 0);
		Example.Context.exports.Unload();
		const unPriorLogCount = Example.State.Logs.length;
		g_Assert.equal(Example.Context.RunUIExample({ Arguments: ["sjs_api_ui", "show", "1"] }), false);
		g_Assert.equal(unMessageCallCount, unExpectedMessageCallCount);
		g_Assert.equal(Example.State.Logs.length, unPriorLogCount);
	} finally {
		Example.Context.exports.Unload();
		g_Assert.equal(Example.State.Commands.size, 0);
	}
}

function RunSmoke() {
	VerifyShowSummaryLogging();

	const strShowFunction = g_strExampleSource.slice(g_strExampleSource.indexOf("function ShowToPlayer("), g_strExampleSource.indexOf("function HandleDownload("));
	const strShowCall = 'LogInfo("%s", `show ${unPlayerIndex}: ${SummarizeValue(Results)}`);';
	g_Assert.equal(strShowFunction.split(strShowCall).length, 2);
	const strRestoredShowFunction = strShowFunction.replace(strShowCall, () => strShowCall.replace('("%s", ', "("));
	g_Assert.throws(() => VerifyShowSummaryLogging(strRestoredShowFunction), Failure => (Failure instanceof g_Assert.AssertionError) && Failure.message.includes("Show summary must preserve literal result data"), "Restored summary call must fail for data corruption, not unrelated fixture errors");
	console.log("[ui show summary] literal result transport and one restored-source control passed; noncanonical controlled message results, not native return-type proof.");

	g_Assert.equal(VerifyLiteralExampleLogging(), 6);

	const vecLoggingFunctions = [
		["function LogResult(", "function InvokeRequest("],
		["function LogRequestResult(", "function CompleteExampleRequest("],
	];
	let unRestoredSourceControls = 0;
	for (const [strStart, strEnd] of vecLoggingFunctions) {
		g_Assert.equal(g_strExampleSource.split(strStart).length, 2);
		g_Assert.equal(g_strExampleSource.split(strEnd).length, 2);
		const strFunction = g_strExampleSource.slice(g_strExampleSource.indexOf(strStart), g_strExampleSource.indexOf(strEnd));
		const vecLiteralCalls = [...strFunction.matchAll(/Log(?:Info|Warning)\("%s", `[^\n]+`\);/g)];
		g_Assert.equal(vecLiteralCalls.length, (strStart === "function LogResult(") ? 1 : 2);
		for (const Match of vecLiteralCalls) {
			const strRestoredFunction = strFunction.replace(Match[0], () => Match[0].replace('("%s", ', "("));
			g_Assert.throws(() => VerifyLiteralExampleLogging(strRestoredFunction), Failure => (Failure instanceof g_Assert.AssertionError) && Failure.message.includes("UI/data logging must preserve literal data"), "Each restored call must fail for changed literal data, not an unrelated error");
			unRestoredSourceControls += 1;
		}
	}

	g_Assert.equal(unRestoredSourceControls, 3);
	console.log("[ui literal logging] 6 active/unloading profiles and 3 restored-source controls passed through the actual JavaScript formatter; native sinks and IO are controlled doubles.");

	VerifyStudioCacheExample();

	const vecFailures = [
		"api_ui_data_menu_example:Create",
		"api_ui_data_menu_example:Example Volume:Set",
		"Menu:Refresh",
		"api_ui_data_menu_example:Clear",
		"api_ui_data_menu_example:Close",
		"api_ui_data_storage_example:Create",
		"api_ui_data_storage_example:Set",
		"api_ui_data_storage_example:Has",
		"api_ui_data_storage_example:Keys",
		"api_ui_data_storage_example:Get",
		"api_ui_data_storage_example:Save",
		"api_ui_data_storage_example:Delete",
		"api_ui_data_storage_example:Clear",
		"api_ui_data_storage_example:Close",
		"api_ui_data_types_example:Create",
		"api_ui_data_types_example:Example Volume:Set",
		"api_ui_data_types_example:Example Theme:Set",
		"api_ui_data_types_example:Example Theme:Get",
		"api_ui_data_types_example:Example Volume:Get",
		"api_ui_data_types_example:Clear",
		"api_ui_data_types_example:Close",
		"SQL:Load",
		"Auth:Permissions",
		"Auth:AddParent",
		"Auth:AddPermission",
		"SQL:Parent",
		"SQL:Player",
		"Manager:Unload",
		"SQL:Unload",
		"FlatFile:Unload",
	];
	let unScenarioCount = 0;
	for (const bImmediate of [false, true]) {
		for (const bDuplicate of [false, true]) {
			RunScenario({ bImmediate, bDuplicate });
			unScenarioCount += 1;
		}

		for (const strFailure of vecFailures) {
			RunScenario({ bImmediate, strFailure });
			unScenarioCount += 1;
		}
	}

	for (const strRegistrationFailure of ["Source", "Client", "Listener"]) {
		const Example = CreateExampleContext({ strRegistrationFailure });
		g_Assert.notEqual(Example.LoadError, null);
		g_Assert.equal(Example.State.Commands.size, 0);
		g_Assert.deepEqual(Example.State.Unregistered, (strRegistrationFailure === "Source") ? [] : (strRegistrationFailure === "Client") ? ["Source"] : ["Source", "Client"]);
	}

	VerifyRequestCompletionLimit();
	VerifyRequestHelpersAndCommands();

	const vecMutations = [
		['() => GetLanguages()', '() => Languages()'],
		['mapAdministratorPermissions.Add("sourcejs.example.*", Options, Next);', 'mapAdministratorPermissions.Add("sourcejs.example.*");'],
		['mapPlayerPermissions.AddParent("admins", Options, Next);', 'mapPlayerPermissions.AddParent("admins");'],
		['mapPlayerPermissions.Add("sourcejs.example.self", Options, Next)', 'mapPlayerPermissions.Add("sourcejs.example.self")'],
		['const Options = { Blocking: false };', 'const Options = { Blocking: true };'],
		['VolumeSetting.Set(strPlayerUniqueID, 7, Options, Next)', 'VolumeSetting.Set(strPlayerUniqueID, 7, Next)'],
		['RegisterPluginUnloadingListener(HandlePluginUnloading)', 'OnPluginUnloading(HandlePluginUnloading)'],
		['.DisposeListener()', '.Dispose()'],
	];
	for (const vecMutation of vecMutations) {
		g_Assert.ok(g_strExampleSource.includes(vecMutation[0]));
		const strExampleSource = g_strExampleSource.replace(vecMutation[0], vecMutation[1]);
		g_Assert.throws(() => RunScenario({ bImmediate: true, strExampleSource }), undefined, `Undetected mutation: ${vecMutation[1]}`);
	}

	for (const strPropertyName of ["Mins", "Maxs"]) {
		const strIncorrectPropertyName = (strPropertyName === "Mins") ? "Minimums" : "Maximums";
		const strExampleSource = g_strExampleSource.replaceAll(`Hitbox.${strPropertyName}`, `Hitbox.${strIncorrectPropertyName}`);
		g_Assert.notEqual(strExampleSource, g_strExampleSource);
		g_Assert.throws(() => VerifyStudioCacheExample(strExampleSource), undefined, `Undetected studio field mutation: ${strPropertyName}`);
	}

	console.log(`[  OK  ] smoke_api_ui_data: ${unScenarioCount} callback scenarios, 3 studio cases, 16 cleanup/startup lifecycle profiles, helpers/commands/completion limits and contract mutations; isolated doubles, not native IO/SDK/thread proof.`);
}

console.log(`[ui ownership] ${VerifyOwnedSettingsResources()} storage/registry/error/cleanup scenarios; controlled JavaScript dependencies, not native IO`);
console.log(`[ui lifecycle] ${VerifyUILifecycleGuards()} arity/unload/auth/startup profiles; controlled callbacks, not native lifecycle proof`);
console.log(`[ui borrowed state] ${VerifyBorrowedStateCleanup()} physics/studio/effects profiles; controlled callbacks, not native ownership proof`);
VerifyCleanupFailures();
RunSmoke();
