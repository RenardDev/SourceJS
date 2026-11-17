#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strHelpersPath = g_Path.join(g_strPackageRootPath, "players", "helpers.js");
const g_strHooksPath = g_Path.join(g_strPackageRootPath, "memory", "hooks.js");
const g_strListenersPath = g_Path.join(g_strPackageRootPath, "listeners.js");
const g_strPlayersPath = g_Path.join(g_strPackageRootPath, "players", "index.js");
const g_strVoicePath = g_Path.join(g_strPackageRootPath, "players", "voice.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-voice.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_unPlayerCount = 4;
const g_unDocumentationBlockCount = 4;
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_DocumentationBlocks = { Direct: 0, Hook: 1, SharedMute: 2, CustomMute: 3 };
const g_vecDocumentationOwners = [];
const g_setMuteManagerOwners = new Set();
const g_vecVoiceWarnings = [];
let g_MuteManagerPrototype = null;
let g_EnsureDisconnectListenerDescriptor = null;

const g_setListenerCallbacks = new Set();
const g_vecListeningQueryCalls = [];
const g_vecListeningNativeCalls = [];
const g_mapListeningStates = new Map();
const g_vecProximityNativeCalls = [];
const g_mapProximityStates = new Map();
const g_vecHookCreateCalls = [];
const g_NativeHook = {
	ID: 7,
	Address: 0x100000000004000n,
	Created: true,
	PreCallbacks: new Set(),
	PostCallbacks: new Set(),
	TrampolineAddress: 0x100000000004100n,

	Pre(Callback) {
		this.PreCallbacks.add(Callback);

		return true;
	},

	Post(Callback) {
		this.PostCallbacks.add(Callback);

		return true;
	},

	RemovePre(Callback) {
		return this.PreCallbacks.delete(Callback);
	},

	RemovePost(Callback) {
		return this.PostCallbacks.delete(Callback);
	},

	Remove() {
		this.PreCallbacks.clear();
		this.PostCallbacks.clear();

		return true;
	},

	Run(Payload) {
		for (const Callback of this.PreCallbacks) {
			Callback(Payload);
		}
	},
};

let g_NativeHookOptions = null;

const g_NativeVoice = {
	GetClientListening(nReceiverIndex, nSenderIndex) {
		g_vecListeningQueryCalls.push({ ReceiverIndex: nReceiverIndex, SenderIndex: nSenderIndex });

		return g_mapListeningStates.get(`${nReceiverIndex}:${nSenderIndex}`) ?? true;
	},

	SetClientListening(nReceiverIndex, nSenderIndex, bShouldListen) {
		const vecHookArguments = [g_NativeVoice.VoiceServer.Address, nReceiverIndex, nSenderIndex, bShouldListen];
		const HookContext = {
			Arguments: vecHookArguments,

			SetHookArgument(unArgumentIndex, ArgumentValue) {
				vecHookArguments[unArgumentIndex] = ArgumentValue;
			},
		};

		g_NativeHook.Run(HookContext);

		const bEffectiveShouldListen = vecHookArguments[3];
		g_vecListeningNativeCalls.push({ Listening: bEffectiveShouldListen, ReceiverIndex: nReceiverIndex, SenderIndex: nSenderIndex });
		g_mapListeningStates.set(`${nReceiverIndex}:${nSenderIndex}`, bEffectiveShouldListen);

		return true;
	},

	SetClientListeningAddress: 0x100000000004000n,

	SetClientProximity(nReceiverIndex, nSenderIndex, bUseProximity) {
		g_vecProximityNativeCalls.push({ ReceiverIndex: nReceiverIndex, SenderIndex: nSenderIndex, UseProximity: bUseProximity });
		g_mapProximityStates.set(`${nReceiverIndex}:${nSenderIndex}`, bUseProximity);

		return true;
	},

	VoiceServer: {
		GetClientListening(nReceiverIndex, nSenderIndex) {
			return g_NativeVoice.GetClientListening(nReceiverIndex, nSenderIndex);
		},

		GetClientListeningIndex: 1,
		GetClientListeningAddress: 0x100000000003F00n,
		Address: 0x100000000003000n,

		SetClientListening(nReceiverIndex, nSenderIndex, bListen = true) {
			return g_NativeVoice.SetClientListening(nReceiverIndex, nSenderIndex, bListen);
		},

		SetClientListeningIndex: 2,
		SetClientListeningAddress: 0x100000000004000n,

		SetClientProximity(nReceiverIndex, nSenderIndex, bUseProximity = true) {
			return g_NativeVoice.SetClientProximity(nReceiverIndex, nSenderIndex, bUseProximity);
		},

		SetClientProximityIndex: 3,
		SetClientProximityAddress: 0x100000000004200n,
	},
};

const g_mapPlayers = new Map();

function Player(nPlayerIndex) {
	if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > g_unPlayerCount)) {
		throw new RangeError(`Unknown fixture player index: ${nPlayerIndex}`);
	}

	if (!g_mapPlayers.has(nPlayerIndex)) {
		g_mapPlayers.set(nPlayerIndex, {
			Connected: true,
			Index: nPlayerIndex,

			IsConnected() {
				return this.Connected;
			},
		});
	}

	return g_mapPlayers.get(nPlayerIndex);
}

function RunWithSetClientListeningFailure(nFailedReceiverIndex, nFailedSenderIndex, bFailedShouldListen, OperationCallback) {
	const OriginalSetClientListening = g_NativeVoice.SetClientListening;
	let bFailurePending = true;

	g_NativeVoice.SetClientListening = function SetClientListeningWithFailure(nReceiverIndex, nSenderIndex, bShouldListen) {
		if (bFailurePending && (nReceiverIndex === nFailedReceiverIndex) && (nSenderIndex === nFailedSenderIndex) && (bShouldListen === bFailedShouldListen)) {
			bFailurePending = false;
			return false;
		}

		return OriginalSetClientListening.call(this, nReceiverIndex, nSenderIndex, bShouldListen);
	};

	try {
		return OperationCallback();
	} finally {
		g_NativeVoice.SetClientListening = OriginalSetClientListening;
	}
}

function InstallDependency(strFilePath, ModuleExports) {
	delete require.cache[strFilePath];
	require.cache[strFilePath] = { children: [], exports: ModuleExports, filename: strFilePath, id: strFilePath, loaded: true, paths: [] };
}

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_mapPackageCacheDescriptors = new Map();
for (const strPath of Object.getOwnPropertyNames(require.cache)) {
	if (strPath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strPath, Object.getOwnPropertyDescriptor(require.cache, strPath));
	}
}

const g_vecVoiceFixtureStates = [g_NativeVoice, g_NativeHook].map((Fixture) => ({ Fixture, Descriptors: Object.getOwnPropertyDescriptors(Fixture), Prototype: Object.getPrototypeOf(Fixture) }));

function RestoreVoiceFixtures() {
	g_mapPlayers.clear();

	const vecFailures = [];
	for (const State of g_vecVoiceFixtureStates) {
		for (const Key of Reflect.ownKeys(State.Fixture)) {
			try {
				g_Assert.ok(Reflect.deleteProperty(State.Fixture, Key), "Temporary voice fixture property must be removable: " + String(Key));
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}

		for (const Key of Reflect.ownKeys(State.Descriptors)) {
			try {
				Object.defineProperty(State.Fixture, Key, State.Descriptors[Key]);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}

		try {
			Object.setPrototypeOf(State.Fixture, State.Prototype);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Voice fixture restoration failed.");
	}
}

function ObserveMuteManagers(Voice) {
	g_setMuteManagerOwners.add(Voice.MUTE_MANAGER);
	const Prototype = Voice.MuteManager.prototype;
	const Descriptor = Object.getOwnPropertyDescriptor(Prototype, "EnsureDisconnectListener");
	g_Assert.equal(typeof Descriptor?.value, "function", "Mute manager listener acquisition must be observable.");
	g_vecVoiceFixtureStates.push({ Fixture: Prototype, Descriptors: Object.getOwnPropertyDescriptors(Prototype), Prototype: Object.getPrototypeOf(Prototype) });
	g_MuteManagerPrototype = Prototype;
	g_EnsureDisconnectListenerDescriptor = Descriptor;
	Object.defineProperty(g_MuteManagerPrototype, "EnsureDisconnectListener", {
		...g_EnsureDisconnectListenerDescriptor,

		value: function EnsureDisconnectListener() {
			g_setMuteManagerOwners.add(this);

			return g_EnsureDisconnectListenerDescriptor.value.apply(this, arguments);
		},
	});
}

function RestoreVoiceResources() {
	const vecFailures = [];
	for (const ModuleRecord of g_vecDocumentationOwners) {
		try {
			const ModuleExports = ModuleRecord.exports;
			if (ModuleExports && (typeof ModuleExports.Unload === "function")) {
				// False may mean already inactive; concrete manager and SDK-double cleanup below verifies release.
				ModuleExports.Unload();
			}
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	for (const Manager of g_setMuteManagerOwners) {
		try {
			// False is also valid for inactive owners; listener/mute postconditions and hook cleanup verify release.
			Manager.Unload();
			g_Assert.equal(Manager.DisconnectCallback, null, "Owned mute manager must release its disconnect listener.");
			g_Assert.equal(Manager.MutedSenderIndexesByReceiver.size, 0, "Owned mute manager must release its mute state.");
			g_setMuteManagerOwners.delete(Manager);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	// These callbacks belong only to this fresh SDK double, never a caller's hook.
	for (const [setCallbacks, Remove] of [[g_NativeHook.PreCallbacks, g_NativeHook.RemovePre], [g_NativeHook.PostCallbacks, g_NativeHook.RemovePost]]) {
		for (const Callback of [...setCallbacks]) {
			try {
				g_Assert.equal(Remove.call(g_NativeHook, Callback), true, "Owned voice hook callback must be removable.");
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}
	}

	try {
		g_Assert.equal(g_NativeHook.Remove(), true, "Owned voice hook must be removable.");
		g_Assert.equal(g_setListenerCallbacks.size, 0, "Owned voice listeners must be released.");
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Voice resource restoration failed.");
	}
}

function RestoreMuteManagerObserver() {
	if ((g_MuteManagerPrototype !== null) && (g_EnsureDisconnectListenerDescriptor !== null)) {
		Object.defineProperty(g_MuteManagerPrototype, "EnsureDisconnectListener", g_EnsureDisconnectListenerDescriptor);
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
				g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Temporary package cache entry must be removable: " + strPath);
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
		throw new AggregateError(vecFailures, "Player voice package cache restoration failed.");
	}
}

// The same-realm deadline bounds JavaScript execution, not native IO or untrusted code.
function RunDocumentationTask(Callback, strRole) {
	return g_VM.runInNewContext("Run()", { Run: Callback }, { filename: g_strDocumentationPath + "#" + strRole, timeout: g_unDocumentationTimeoutMilliseconds });
}

function CompileDocumentationBlock(strSource, unBlockIndex) {
	return g_VM.compileFunction(strSource, ["require", "module", "exports"], { filename: g_strDocumentationPath + "#js-" + (unBlockIndex + 1) });
}

function CheckVoiceNativeHookLifecycle(Voice) {
	const OriginalPre = g_NativeHook.Pre;
	const OriginalRemove = g_NativeHook.Remove;
	const CreatedDescriptor = Object.getOwnPropertyDescriptor(g_NativeHook, "Created");
	const ForeignPreCallback = () => {};
	let unRemovalCount = 0;

	try {
		g_Assert.equal(Voice.MUTE_MANAGER.Unload(), false, "Hook lifecycle regression must start without a voice-owned hook.");
		g_NativeHook.PreCallbacks.add(ForeignPreCallback);
		g_NativeHook.Created = false;
		g_NativeHook.Remove = function ObserveCompleteHookRemoval() {
			unRemovalCount += 1;

			return OriginalRemove.call(this);
		};

		g_Assert.strictEqual(Voice.HookSetClientListening(), g_NativeHook, "Voice may borrow an existing native record.");
		g_Assert.equal(g_NativeHook.PreCallbacks.size, 2, "Borrowing installs only the additional voice callback.");
		g_NativeHook.Created = true;
		g_Assert.equal(Voice.MUTE_MANAGER.Unload(), true, "Borrowed voice callback cleanup must succeed.");
		g_Assert.equal(unRemovalCount, 0, "Editing public Created metadata must not turn a borrowed record into an owned record.");
		g_Assert.ok(g_NativeHook.PreCallbacks.has(ForeignPreCallback), "Borrowed cleanup must retain foreign callbacks.");

		const vecRegistrationErrors = [null, new Error("borrowed hook registration failed")];
		for (const RegistrationError of vecRegistrationErrors) {
			g_NativeHook.Created = false;
			g_NativeHook.Pre = function FailBorrowedHookRegistration() {
				throw RegistrationError;
			};

			let bCaught = false;
			let Failure = undefined;
			try {
				Voice.HookSetClientListening();
			} catch (ErrorValue) {
				bCaught = true;
				Failure = ErrorValue;
			}

			g_Assert.equal(bCaught, true, "Borrowed registration failure must propagate.");
			g_Assert.strictEqual(Failure, RegistrationError, "Borrowed registration must preserve the exact original thrown value.");
			g_Assert.equal(unRemovalCount, 0, "Failed borrowed registration must not remove the native record.");
			g_Assert.ok(g_NativeHook.PreCallbacks.has(ForeignPreCallback), "Failed borrowed registration must not discard foreign callbacks.");
			g_Assert.equal(Voice.MUTE_MANAGER.Unload(), false, "A failed borrowed registration leaves no voice-owned handle.");
		}

		g_NativeHook.Pre = function RejectBorrowedHookRegistration() {
			return false;
		};
		g_Assert.throws(() => Voice.HookSetClientListening(), /Unable to register/, "False borrowed registration must fail without deleting the record.");
		g_Assert.equal(unRemovalCount, 0);
		g_Assert.ok(g_NativeHook.PreCallbacks.has(ForeignPreCallback));

		let unPreCallCount = 0;
		g_NativeHook.Created = undefined;
		g_NativeHook.Pre = function ObserveInvalidCreationMetadata() {
			unPreCallCount += 1;

			return true;
		};
		g_Assert.throws(() => Voice.HookSetClientListening(), /Created must be a boolean/, "Creation metadata must be validated before callback acquisition.");
		g_Assert.equal(unPreCallCount, 0);
		g_Assert.equal(unRemovalCount, 0, "Unknown creation ownership must not permit native record removal.");
		g_Assert.equal(g_NativeHook.RemovePre(ForeignPreCallback), true, "The foreign fixture owner removes its own callback.");

		const RegistrationError = new Error("owned hook registration failed");
		const CleanupError = new Error("owned hook removal failed");
		for (const bRetryRegistration of [false, true]) {
			g_NativeHook.Created = true;
			g_NativeHook.Pre = function FailOwnedHookRegistration() {
				throw RegistrationError;
			};
			g_NativeHook.Remove = function FailOwnedHookRemoval() {
				throw CleanupError;
			};

			g_Assert.throws(() => Voice.HookSetClientListening(), (Failure) => {
				g_Assert.ok(Failure instanceof AggregateError);
				g_Assert.strictEqual(Failure.errors[0], RegistrationError);
				g_Assert.strictEqual(Failure.errors[1], CleanupError);

				return Failure.errors.length === 2;
			}, "Failed owned cleanup must preserve error order and retain a retryable handle.");

			const unCreationCountBeforeRetry = g_vecHookCreateCalls.length;
			g_NativeHook.Pre = OriginalPre;
			g_NativeHook.Remove = OriginalRemove;
			if (bRetryRegistration) {
				g_Assert.strictEqual(Voice.HookSetClientListening(), g_NativeHook, "Pending owned cleanup may retry callback registration on the retained handle.");
				g_Assert.equal(g_NativeHook.PreCallbacks.size, 1);
			}

			g_Assert.equal(Voice.MUTE_MANAGER.Unload(), true, "Pending owned hook must remain available for explicit cleanup.");
			g_Assert.equal(g_vecHookCreateCalls.length, unCreationCountBeforeRetry, "Retry must not allocate a replacement native record.");
			g_Assert.equal(g_NativeHook.PreCallbacks.size, 0);
		}
	} finally {
		g_NativeHook.Pre = OriginalPre;
		g_NativeHook.Remove = OriginalRemove;
		Object.defineProperty(g_NativeHook, "Created", CreatedDescriptor);
		// False is valid after successful or already-inactive fixture cleanup.
		g_Assert.equal(typeof Voice.MUTE_MANAGER.Unload(), "boolean");
		g_NativeHook.PreCallbacks.delete(ForeignPreCallback);
	}
}

function CheckVoiceDuplicateReceiverRollback(Voice) {
	const unReceiverIndex = 1;
	const unSenderIndex = 2;
	const unFailedListeningAttempt = 2;
	const OperationError = new Error("duplicate receiver update failed");
	const OriginalSetClientListening = g_NativeVoice.SetClientListening;
	const Manager = new Voice.MuteManager();
	let unListeningAttempts = 0;

	try {
		g_Assert.equal(Manager.MutePlayer(unSenderIndex, [unReceiverIndex]), true);
		const setOriginalMutedSenders = Manager.GetMutedSenderIndexes(unReceiverIndex);
		g_NativeVoice.SetClientListening = function FailRepeatedListeningUpdate(nReceiverIndex, nSenderIndex, bShouldListen) {
			if ((nReceiverIndex === unReceiverIndex) && (nSenderIndex === unSenderIndex) && !bShouldListen) {
				unListeningAttempts += 1;
				if (unListeningAttempts === unFailedListeningAttempt) {
					throw OperationError;
				}
			}

			return OriginalSetClientListening.call(this, nReceiverIndex, nSenderIndex, bShouldListen);
		};

		let bCaught = false;
		let Failure = undefined;
		try {
			Manager.ApplyMuteState([unReceiverIndex, unReceiverIndex]);
		} catch (ErrorValue) {
			bCaught = true;
			Failure = ErrorValue;
		}

		g_Assert.equal(bCaught, true, "The repeated receiver update must reach its injected native failure.");
		g_Assert.equal(Failure === OperationError, true, "Duplicate receivers must preserve the original error after successful rollback.");
		g_Assert.equal(Manager.IsMutedForReceiver(unSenderIndex, unReceiverIndex), true, "Rollback must retain original sender ownership.");
		g_Assert.strictEqual(Manager.GetMutedSenderIndexes(unReceiverIndex), setOriginalMutedSenders, "Rollback must retain the original receiver set.");
		g_Assert.equal(g_mapListeningStates.get(`${unReceiverIndex}:${unSenderIndex}`), false, "Rollback must restore the native listening state.");
	} finally {
		g_NativeVoice.SetClientListening = OriginalSetClientListening;
		g_Assert.equal(Manager.Unload(), true, "Duplicate receiver fixture must release its listener/mute/hook resources.");
	}
}

let g_PrimaryFailure = undefined;
let g_bFailed = false;
let g_unDocumentationScenarioCount = 0;

try {
	g_Assert.ok((g_SourceJSDescriptor === undefined) || g_SourceJSDescriptor.configurable, "Existing SourceJS global must be restorable.");
	g_Assert.ok(g_ModuleLoadDescriptor && Object.hasOwn(g_ModuleLoadDescriptor, "value") && (typeof g_ModuleLoadDescriptor.value === "function"), "Node module loader must have its normal data descriptor.");

	for (const [strPath, Descriptor] of g_mapPackageCacheDescriptors) {
		g_Assert.ok(Descriptor.configurable, "Existing package cache must be restorable: " + strPath);
	}

	for (const strPath of g_mapPackageCacheDescriptors.keys()) {
		g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Existing package cache must be removable: " + strPath);
	}

	InstallDependency(g_strHelpersPath, {
		GetPlayerIndex(PlayerReference) {
			return (typeof PlayerReference === "number") ? PlayerReference : PlayerReference.Index;
		},
	});

	InstallDependency(g_strHooksPath, {
		CreateFunctionHook(Options) {
			g_Assert.ok(Array.isArray(Options.Arguments), "Hook definition must use Arguments.");
			g_Assert.equal(Object.hasOwn(Options, "ArgumentTypes"), false, "Legacy ArgumentTypes is not a native hook definition field.");
			g_Assert.deepEqual(Options.Arguments, ["address", "int", "int", "bool"], "Voice hook must declare this/receiver/sender/listen ABI arguments.");
			g_NativeHookOptions = Options;
			g_vecHookCreateCalls.push(Options);

			return g_NativeHook;
		},
	});

	InstallDependency(g_strListenersPath, {
		ClientDisconnectManager: {
			RegisterListener(Callback) {
				g_setListenerCallbacks.add(Callback);

				return Callback;
			},

			UnregisterListener(Callback) {
				return g_setListenerCallbacks.delete(Callback);
			},
		},
	});

	InstallDependency(g_strPlayersPath, {
		GetMaximumClients() {
			return g_unPlayerCount;
		},
	});

	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { players: require(g_strPlayersPath), "players/voice": g_NativeVoice } });
	delete require.cache[g_strVoicePath];

	Object.defineProperty(g_Module, "_load", {
		...g_ModuleLoadDescriptor,

		value: function LoadModule(strRequest) {
			if (strRequest === "core/logger") {
				return { LogWarning: (strWarning) => g_vecVoiceWarnings.push(strWarning) };
			}

			if (strRequest === "internal/runtime") {
				return require(g_strRuntimePath);
			}

			if (strRequest === "listeners") {
				return require(g_strListenersPath);
			}

			if (strRequest === "memory/hooks") {
				return require(g_strHooksPath);
			}

			if (strRequest === "players") {
				return require(g_strPlayersPath);
			}

			if (strRequest === "players/helpers") {
				return require(g_strHelpersPath);
			}

			return g_ModuleLoadDescriptor.value.apply(this, arguments);
		},
	});

	const g_Voice = require(g_strVoicePath);
	RestoreModuleLoader();
	ObserveMuteManagers(g_Voice);

	const g_vecExpectedExports = [
		"MUTE_MANAGER",
		"MuteManager",
		"GetClientListening",
		"HookSetClientListening",
		"SetClientListening",
		"GetSetClientListeningHookOptions",
		"SetClientProximity",
		"VoiceServer",
	];

	g_Assert.deepEqual(Object.keys(g_Voice).sort(), g_vecExpectedExports.slice().sort(), "players/voice exact exports");
	g_Assert.equal(g_Voice.VoiceServer.Address, 0x100000000003000n, "live voice server BigInt address");

	g_NativeVoice.VoiceServer = {
		GetClientListening(nReceiverIndex, nSenderIndex) {
			return g_NativeVoice.GetClientListening(nReceiverIndex, nSenderIndex);
		},

		GetClientListeningIndex: 1,
		GetClientListeningAddress: 0x100000000004F00n,
		Address: 0x100000000005000n,

		SetClientListening(nReceiverIndex, nSenderIndex, bListen = true) {
			return g_NativeVoice.SetClientListening(nReceiverIndex, nSenderIndex, bListen);
		},

		SetClientListeningIndex: 2,
		SetClientListeningAddress: 0x100000000004000n,

		SetClientProximity(nReceiverIndex, nSenderIndex, bUseProximity = true) {
			return g_NativeVoice.SetClientProximity(nReceiverIndex, nSenderIndex, bUseProximity);
		},

		SetClientProximityIndex: 3,
		SetClientProximityAddress: 0x100000000005200n,
	};
	g_Assert.equal(g_Voice.VoiceServer.Address, 0x100000000005000n, "VoiceServer getter must read the current native wrapper.");

	const g_Options = g_Voice.GetSetClientListeningHookOptions();
	g_Options.Arguments[0] = "int";
	g_Assert.deepEqual(g_Voice.GetSetClientListeningHookOptions().Arguments, ["address", "int", "int", "bool"], "hook options must return a fresh argument-type array.");
	g_Assert.equal(g_Voice.GetSetClientListeningHookOptions().Convention, "thiscall", "voice hook convention");
	g_Assert.equal(g_Voice.GetSetClientListeningHookOptions().ReturnType, "bool", "voice hook return type");
	g_Assert.equal(g_Voice.GetSetClientListeningHookOptions().Address, 0x100000000004000n, "voice hook BigInt address");

	g_Assert.equal(g_Voice.GetClientListening(1, 2), true, "default directed listening state");
	g_Assert.ok(g_Voice.SetClientListening(Player(1), Player(2), false), "SetClientListening direct call");
	g_Assert.equal(g_Voice.GetClientListening(1, 2), false, "directed listening state write");
	g_Assert.ok(g_Voice.SetClientListening(1, 2, true), "restore directed listening state");
	g_Assert.throws(() => g_Voice.SetClientListening(1, 2, 1), /boolean/, "SetClientListening must reject non-booleans.");
	g_Assert.ok(g_Voice.SetClientProximity(1, 2, false), "SetClientProximity direct call");
	g_Assert.equal(g_mapProximityStates.get("1:2"), false, "strict proximity value");
	g_Assert.throws(() => g_Voice.SetClientProximity(1, 2, 0), /boolean/, "SetClientProximity must reject non-booleans.");
	g_Assert.ok(g_Voice.SetClientProximity(1, 2, true), "restore direct proximity state");

	g_Assert.ok(g_Voice.MUTE_MANAGER.MutePlayer(2, [1, 3]), "shared mute manager explicit receivers");
	g_Assert.ok(g_Voice.MUTE_MANAGER.IsMuted(2, [1, 3]), "shared mute manager state");
	g_Assert.equal(g_NativeHookOptions.Address, 0x100000000004000n, "hook BigInt function address");
	g_Assert.deepEqual(g_NativeHookOptions.Arguments, ["address", "int", "int", "bool"], "hook argument types");
	g_Assert.equal(g_NativeHook.PreCallbacks.size, 1, "one module mute-enforcement callback");

	const g_Payload = {
		Arguments: [0x100000000005000n, 1, 2, true],

		SetHookArgument(unArgumentIndex, ArgumentValue) {
			this.Arguments[unArgumentIndex] = ArgumentValue;
		},
	};
	g_NativeHook.Run(g_Payload);
	g_Assert.equal(g_Payload.Arguments[3], false, "mute hook must rewrite only the listening argument.");
	g_Assert.ok(g_Voice.SetClientListening(1, 2, true), "SetClientListening while muted");
	g_Assert.equal(g_mapListeningStates.get("1:2"), false, "mute must override a direct listening request.");

	const g_CustomManager = new g_Voice.MuteManager();
	g_Assert.ok(g_CustomManager.MutePlayer(2, [1]), "custom mute manager directed pair");
	g_Assert.equal(g_setListenerCallbacks.size, 2, "each active manager owns one disconnect listener.");
	g_Assert.ok(g_Voice.MUTE_MANAGER.UnmutePlayer(2, [1]), "shared manager removes its directed pair");
	g_Assert.equal(g_mapListeningStates.get("1:2"), false, "custom manager must keep the pair muted.");
	g_Assert.ok(g_CustomManager.UnmutePlayer(2, [1]), "custom manager removes its directed pair");
	g_Assert.equal(g_mapListeningStates.get("1:2"), true, "last manager unmute must restore listening.");

	g_Assert.ok(g_Voice.MUTE_MANAGER.ApplyMuteState([3]), "shared manager reapplies owned mute state");
	g_Assert.equal(g_mapListeningStates.get("3:2"), false, "apply must enforce the stored pair.");
	g_Assert.ok(g_Voice.MUTE_MANAGER.ClearMuteState(), "shared manager clear");
	g_Assert.equal(g_mapListeningStates.get("3:2"), true, "clear must restore an unowned pair.");

	g_Assert.ok(g_Voice.MUTE_MANAGER.MutePlayer(2, [3]), "receiver disconnect setup");

	for (const Callback of [...g_setListenerCallbacks]) {
		Callback(3);
	}

	g_Assert.equal(g_Voice.MUTE_MANAGER.IsMutedForReceiver(2, 3), false, "disconnect must remove receiver-owned state.");
	g_Assert.ok(g_Voice.MUTE_MANAGER.MutePlayer(2, [1]), "sender disconnect setup");

	for (const Callback of [...g_setListenerCallbacks]) {
		Callback(2);
	}

	g_Assert.equal(g_Voice.MUTE_MANAGER.IsMutedForReceiver(2, 1), false, "disconnect must remove sender-owned state.");
	g_Assert.equal(g_mapListeningStates.get("1:2"), true, "sender disconnect cleanup must restore listening.");

	g_Assert.ok(g_Voice.MUTE_MANAGER.MutePlayer(2, [1, 3]), "failed sender cleanup setup");
	g_Assert.ok(g_Voice.MUTE_MANAGER.MutePlayer(1, [2]), "failed receiver cleanup setup");
	g_Assert.ok(g_CustomManager.MutePlayer(2, [1]), "second manager owns a pair for the departing sender");
	const unBeforeDisconnectWarnings = g_vecVoiceWarnings.length;
	RunWithSetClientListeningFailure(1, 2, true, () => {
		g_Voice.MUTE_MANAGER.DisconnectCallback(2);
		g_Assert.equal(g_mapListeningStates.get("1:2"), false, "disconnect cleanup must respect the second owner's mute");
		g_Assert.equal(g_vecVoiceWarnings.length, unBeforeDisconnectWarnings, "a pair still owned by another manager should not be restored");
		g_CustomManager.DisconnectCallback(2);
	});
	g_Assert.equal(g_vecVoiceWarnings.length, unBeforeDisconnectWarnings + 1, "native refusal must be reported");
	g_Assert.equal(g_Voice.MUTE_MANAGER.IsMutedForReceiver(2, 1), false, "disconnect must not restore old sender ownership after native refusal");
	g_Assert.equal(g_Voice.MUTE_MANAGER.IsMutedForReceiver(1, 2), false, "failure restoring one pair must not retain receiver ownership");
	g_Assert.equal(g_CustomManager.IsMutedForReceiver(2, 1), false, "the manager whose native restore failed must release the pair");
	g_Assert.equal(g_mapListeningStates.get("3:2"), true, "disconnect must continue restoring other pairs");

	g_Payload.Arguments[3] = true;
	g_NativeHook.Run(g_Payload);
	g_Assert.equal(g_Payload.Arguments[3], true, "the hook must not mute the replacement connection");

	g_Assert.ok(g_CustomManager.Unload(), "custom mute manager unload");
	g_Assert.equal(g_NativeHook.PreCallbacks.size, 1, "shared active manager must retain the module callback.");
	g_Assert.ok(g_Voice.MUTE_MANAGER.Unload(), "shared mute manager unload");
	g_Assert.equal(g_setListenerCallbacks.size, 0, "manager unload must release disconnect listeners.");
	g_Assert.equal(g_NativeHook.PreCallbacks.size, 0, "last manager unload must remove the module pre callback.");

	g_mapListeningStates.set("1:2", true);
	g_mapListeningStates.set("3:2", true);

	const g_TransactionalManager = new g_Voice.MuteManager();
	g_Assert.throws(() => {
		RunWithSetClientListeningFailure(3, 2, false, () => g_TransactionalManager.MutePlayer(2, [1, 3]));
	}, /did not update/, "partial mute failure must surface the native error.");
	g_Assert.equal(g_mapListeningStates.get("1:2"), true, "failed mute must restore the first native pair.");
	g_Assert.equal(g_mapListeningStates.get("3:2"), true, "failed mute must restore the failing native pair.");
	g_Assert.equal(g_TransactionalManager.IsMuted(2, [1, 3]), false, "failed mute must not commit manager ownership.");
	g_Assert.equal(g_setListenerCallbacks.size, 0, "failed mute must not register a disconnect listener.");
	g_Assert.equal(g_NativeHook.PreCallbacks.size, 0, "failed mute must not install the native hook.");

	g_Assert.ok(g_TransactionalManager.MutePlayer(2, [1, 3]), "transactional manager setup");
	g_mapListeningStates.set("1:2", true);
	g_mapListeningStates.set("3:2", true);
	g_Assert.throws(() => {
		RunWithSetClientListeningFailure(3, 2, false, () => g_TransactionalManager.ApplyMuteState([1, 3]));
	}, /did not update/, "partial apply failure must surface the native error.");
	g_Assert.equal(g_mapListeningStates.get("1:2"), true, "failed apply must restore the first native pair.");
	g_Assert.equal(g_mapListeningStates.get("3:2"), true, "failed apply must restore the failing native pair.");
	g_Assert.ok(g_TransactionalManager.IsMuted(2, [1, 3]), "failed apply must retain manager ownership.");

	g_Assert.ok(g_TransactionalManager.ApplyMuteState([1, 3]), "transactional manager native-state setup");
	g_Assert.throws(() => {
		RunWithSetClientListeningFailure(3, 2, true, () => g_TransactionalManager.UnmutePlayer(2, [1, 3]));
	}, /did not update/, "partial unmute failure must surface the native error.");
	g_Assert.equal(g_mapListeningStates.get("1:2"), false, "failed unmute must restore the first native pair.");
	g_Assert.equal(g_mapListeningStates.get("3:2"), false, "failed unmute must restore the failing native pair.");
	g_Assert.ok(g_TransactionalManager.IsMuted(2, [1, 3]), "failed unmute must restore manager ownership.");
	g_Assert.ok(g_TransactionalManager.UnmutePlayer(2, [1, 3]), "transactional manager recovery");

	const g_OriginalRemovePre = g_NativeHook.RemovePre;
	let g_bRemovePreFailurePending = true;

	g_NativeHook.RemovePre = function RemovePreWithFailure(Callback) {
		if (g_bRemovePreFailurePending) {
			g_bRemovePreFailurePending = false;
			return false;
		}

		return g_OriginalRemovePre.call(this, Callback);
	};

	g_Assert.equal(g_TransactionalManager.Unload(), false, "failed final hook removal must report failure.");
	g_Assert.equal(g_NativeHook.PreCallbacks.size, 1, "failed final hook removal must retain callback ownership.");
	g_Assert.ok(g_TransactionalManager.Unload(), "failed final hook removal must be retryable.");
	g_Assert.equal(g_NativeHook.PreCallbacks.size, 0, "retried final hook removal must release callback ownership.");
	g_NativeHook.RemovePre = g_OriginalRemovePre;

	for (const strRemovedName of [
		"available",
		"default",
		"moduleName",
		"muteManager",
		"unhookSetClientListening",
	]) {
		g_Assert.ok(!Object.hasOwn(g_Voice, strRemovedName), `players/voice must not expose ${strRemovedName}.`);
	}

	g_vecListeningQueryCalls.length = 0;
	g_vecListeningNativeCalls.length = 0;
	g_vecProximityNativeCalls.length = 0;
	g_vecHookCreateCalls.length = 0;

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	function DocumentationRequire(strModuleName) {
		if (strModuleName === "players/entity") {
			return { Player };
		}

		if (strModuleName === "players/voice") {
			return g_Voice;
		}

		throw new Error(`unexpected players/voice documentation module ${strModuleName}`);
	}

	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationBlockCount, "players/voice documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/voice documentation must be maintained by hand.");
	g_Assert.ok(g_strDocumentation.includes("receiver hears sender"), "players/voice documentation must define argument direction.");
	g_Assert.ok(g_strDocumentation.includes("does not skip the original function"), "players/voice documentation must define pre-hook behavior.");
	g_Assert.ok(!g_strDocumentation.includes("console."), "players/voice documentation must not depend on console-only inspection.");
	g_Assert.ok(!/[^\x00-\x7F]/.test(g_strDocumentation), "players/voice documentation must remain valid ASCII.");

	const g_vecDocumentationModules = [];

	function CheckVoiceDocumentationExamples() {
		for (let unDocumentationCodeBlockIndex = 0; unDocumentationCodeBlockIndex < g_vecCodeBlocks.length; ++unDocumentationCodeBlockIndex) {
			const ModuleRecord = { exports: {} };
			g_vecDocumentationOwners.push(ModuleRecord);
			CompileDocumentationBlock(g_vecCodeBlocks[unDocumentationCodeBlockIndex], unDocumentationCodeBlockIndex)(DocumentationRequire, ModuleRecord, ModuleRecord.exports);
			g_vecDocumentationModules.push(ModuleRecord.exports);
		}

		g_Assert.equal(g_vecListeningQueryCalls.length, 0, "players/voice examples must not query listening state during block load");
		g_Assert.equal(g_vecListeningNativeCalls.length, 0, "players/voice examples must not change listening state during block load");
		g_Assert.equal(g_vecProximityNativeCalls.length, 0, "players/voice examples must not change proximity during block load");
		g_Assert.equal(g_vecHookCreateCalls.length, 0, "players/voice examples must not install hooks during block load");

		const InspectedPair = g_vecDocumentationModules[g_DocumentationBlocks.Direct].InspectVoicePair(1, 2);
		g_Assert.deepEqual(InspectedPair, { GetListeningIndex: 1, GetListeningAddress: 0x100000000004F00n, Listening: true, ReceiverIndex: 1, SenderIndex: 2, SetListeningIndex: 2, SetListeningAddress: 0x100000000004000n, SetProximityIndex: 3, SetProximityAddress: 0x100000000005200n, VoiceServerAddress: 0x100000000005000n }, "documented current voice-pair inspection");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.Direct].SetVoicePairListening(1, 2, false), true, "documented listening setter returns previous state");
		g_Assert.equal(g_mapListeningStates.get("1:2"), false, "documented directed listening disable");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.Direct].SetVoicePairListening(1, 2, true), false, "documented listening restore returns disabled state");
		g_Assert.equal(g_mapListeningStates.get("1:2"), true, "documented directed listening restore");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.Direct].SetVoicePairProximity(1, 2, false), "documented proximity disable");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.Direct].SetVoicePairProximity(1, 2, true), "documented explicit proximity final state");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.Direct].SetVoiceServerListening(1, 2, false), true, "documented direct voice-server setter");
		g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.Direct].SetVoiceServerListening(1, 2, true), false, "documented direct voice-server restore");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.Direct].SetVoiceServerProximity(1, 2, false), "documented direct voice-server proximity setter");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.Direct].SetVoiceServerProximity(1, 2, true), "documented direct voice-server proximity restore");
		g_Assert.equal(g_mapProximityStates.get("1:2"), true, "documented proximity state returns to baseline");

		const DocumentedHook = g_vecDocumentationModules[g_DocumentationBlocks.Hook].Load();
		g_Assert.deepEqual(DocumentedHook.Arguments, ["address", "int", "int", "bool"], "documented hook argument types");
		g_Assert.equal(DocumentedHook.Address, 0x100000000004000n, "documented hook address");
		g_Assert.equal(DocumentedHook.TrampolineAddress, 0x100000000004100n, "documented hook trampoline address");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.Hook].Unload(), "documented hook ownership cleanup");
		g_Assert.equal(g_NativeHook.PreCallbacks.size, 0, "documented direct hook cleanup");

		g_Assert.deepEqual(g_vecDocumentationModules[g_DocumentationBlocks.SharedMute].MuteForReceivers(2, [1, 3]), { AllSelectedMuted: true, FirstReceiverMuted: true }, "documented shared mute workflow");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.SharedMute].UnmuteForReceivers(2, [1, 3]), "documented shared unmute workflow");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.SharedMute].Unload(), "documented shared manager cleanup");

		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.CustomMute].Load(), "documented custom manager load");

		const DocumentedCustomMute = g_vecDocumentationModules[g_DocumentationBlocks.CustomMute].MuteScoped(2, [1, 3]);
		g_Assert.deepEqual(DocumentedCustomMute.FirstReceiverSenders, [2], "documented custom receiver sender set");
		g_Assert.equal(DocumentedCustomMute.MutedForFirst, true, "documented custom pair state");
		g_Assert.deepEqual(DocumentedCustomMute.Receivers, [1, 3], "documented custom receiver indices");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.CustomMute].ClearMutes(), "documented custom mute clear");
		g_Assert.ok(g_vecDocumentationModules[g_DocumentationBlocks.CustomMute].Unload(), "documented custom manager unload");
		g_Assert.equal(g_setListenerCallbacks.size, 0, "documentation cleanup must release listeners.");
		g_Assert.equal(g_NativeHook.PreCallbacks.size, 0, "documentation cleanup must release the pre callback.");
		g_Assert.ok(g_vecHookCreateCalls.length >= 3, "voice hook must support clean reinstallation for each documented owner.");
	}

	RunDocumentationTask(CheckVoiceDocumentationExamples, "root");
	CheckVoiceNativeHookLifecycle(g_Voice);
	CheckVoiceDuplicateReceiverRollback(g_Voice);

	const g_vecDocumentedMembers = [
		"ApplyMuteState",
		"ClearMuteState",
		"IsMuted",
		"IsMutedForReceiver",
		"MutePlayer",
		"GetMutedSenderIndexes",
		"GetReceiverIndexes",
		"Unload",
		"UnmutePlayer",
	];

	const g_vecDocumentedVoiceServerMembers = [
		"GetClientListening",
		"GetClientListeningIndex",
		"GetClientListeningAddress",
		"Address",
		"SetClientListening",
		"SetClientListeningIndex",
		"SetClientListeningAddress",
		"SetClientProximity",
		"SetClientProximityIndex",
		"SetClientProximityAddress",
	];

	for (const strMemberName of g_vecDocumentedMembers) {
		g_Assert.ok(g_strDocumentation.includes(`.${strMemberName}(`), `players/voice documentation must use MuteManager.${strMemberName}().`);
	}

	for (const strMemberName of g_vecDocumentedVoiceServerMembers) {
		g_Assert.ok(g_strDocumentation.includes(strMemberName), `players/voice documentation must cover VoiceServer.${strMemberName}.`);
	}

	for (const strFunctionName of [
		"GetClientListening",
		"HookSetClientListening",
		"SetClientListening",
		"GetSetClientListeningHookOptions",
		"SetClientProximity",
	]) {
		g_Assert.ok(g_strDocumentation.includes(`${strFunctionName}(`), `players/voice documentation must use ${strFunctionName}().`);
	}

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/voice documentation link must exist: ${strTarget}`);
	}

	const g_strVoiceSource = g_FileSystem.readFileSync(g_strVoicePath, "utf8");
	const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");

	g_Assert.ok(g_strVoiceSource.includes("const g_setMuteManagers = new Set();"), "multiple mute-manager ownership");
	g_Assert.ok(g_strVoiceSource.includes("HookHandle.RemovePre(HookCallback)"), "owned pre-callback cleanup");
	g_Assert.ok(g_strVoiceSource.includes("ReleaseDisconnectedPlayer(this, unDisconnectedPlayerIndex)"), "disconnect receiver cleanup");
	g_Assert.ok(g_strVoiceSource.includes("!IsMutedForAnyManager(unSenderIndex, unReceiverIndex)"), "last-manager listening restore");
	g_Assert.ok(g_strModuleBindings.includes("pVoiceServer->GetClientListening(nReceiverIndex, nSenderIndex)"), "native directed voice query");
	g_Assert.ok(g_strModuleBindings.includes("pVoiceServer->SetClientListening(nReceiverIndex, nSenderIndex, bListen)"), "native directed voice write");
	g_Assert.ok(g_strModuleBindings.includes("GetVoiceSetClientProximityVTableIndex"), "selected-SDK proximity capability");
	g_Assert.ok(g_strModuleBindings.includes("v8::Local<v8::Object> const LocalPlayerVoiceModule = MakeModule(pIsolate);"), "native players/voice module installation");
	g_Assert.ok(g_strModuleBindings.includes("LocalPlayerVoiceModule->SetNativeDataProperty(LocalContext, LocalPlayerVoiceModuleVoiceServerPropertyName, GetVoiceServerPropertyCallback"), "live native VoiceServer property");

	function VerifyVoiceDocumentationCase(strScenarioName, Callback) {
		g_Assert.doesNotThrow(Callback, strScenarioName);
		++g_unDocumentationScenarioCount;
	}

	function WithNativeVoiceMethod(strMethodName, Replacement, Callback) {
		const OriginalMethod = g_NativeVoice[strMethodName];
		g_NativeVoice[strMethodName] = Replacement;

		try {
			Callback();
		} finally {
			g_NativeVoice[strMethodName] = OriginalMethod;
		}
	}

	function CheckVoiceDocumentationScenarios() {
		const DirectDocumentation = g_vecDocumentationModules[g_DocumentationBlocks.Direct];
		const CustomDocumentation = g_vecDocumentationModules[g_DocumentationBlocks.CustomMute];
		const vecDirectOperations = [
			["InspectVoicePair", []],
			["SetVoicePairListening", [false]],
			["SetVoicePairProximity", [false]],
			["SetVoiceServerListening", [false]],
			["SetVoiceServerProximity", [false]],
		];

		const strNativeRuntimeSource = g_FileSystem.readFileSync(g_Path.resolve(__dirname, "..", "src", "sourcejs", "V8Runtime.cpp"), "utf8");
		for (const unBlockIndex of [g_DocumentationBlocks.Hook, g_DocumentationBlocks.SharedMute, g_DocumentationBlocks.CustomMute]) {
			VerifyVoiceDocumentationCase("documented owner exports exact current native lifecycle keys without case aliases", () => {
				const ModuleExports = g_vecDocumentationModules[unBlockIndex];
				g_Assert.equal(typeof ModuleExports.Unload, "function");
				g_Assert.equal(Object.hasOwn(ModuleExports, "unload"), false);
				// Nesting is not part of the case-sensitive native export contract.
				g_Assert.match(strNativeRuntimeSource, /^\t+CallPluginExportFunction\(strPluginName, "Unload"\);\r?$/m);

				if ((unBlockIndex === g_DocumentationBlocks.Hook) || (unBlockIndex === g_DocumentationBlocks.CustomMute)) {
					g_Assert.equal(typeof ModuleExports.Load, "function");
					g_Assert.equal(Object.hasOwn(ModuleExports, "load"), false);
					g_Assert.ok(strNativeRuntimeSource.includes('CallPluginExportFunction(strPluginName, "Load")'));
				}
			});
		}

		for (const [strOperationName, vecExtraArguments] of vecDirectOperations) {
			for (const InvalidIndex of [
				undefined,
				null,
				false,
				"1",
				1n,
				{},
				[],
				NaN,
				Infinity,
				-1,
				0,
				1.5,
				2147483648,
				4294967297,
			]) {
				for (const bReceiver of [true, false]) {
					VerifyVoiceDocumentationCase(`reject invalid ${strOperationName} ${bReceiver ? "receiver" : "sender"} before voice IO`, () => {
						g_vecListeningQueryCalls.length = 0;
						g_vecListeningNativeCalls.length = 0;
						g_vecProximityNativeCalls.length = 0;
						const vecIndices = bReceiver ? [InvalidIndex, 2] : [1, InvalidIndex];
						g_Assert.throws(() => DirectDocumentation[strOperationName](...vecIndices, ...vecExtraArguments), TypeError);
						g_Assert.equal(g_vecListeningQueryCalls.length, 0);
						g_Assert.equal(g_vecListeningNativeCalls.length, 0);
						g_Assert.equal(g_vecProximityNativeCalls.length, 0);
					});
				}
			}
		}

		for (const strOperationName of ["SetVoicePairListening", "SetVoicePairProximity", "SetVoiceServerListening", "SetVoiceServerProximity"]) {
			for (const InvalidStatus of [
				undefined,
				null,
				0,
				1,
				"true",
				{},
			]) {
				VerifyVoiceDocumentationCase(`reject non-boolean ${strOperationName} before voice IO`, () => {
					g_vecListeningQueryCalls.length = 0;
					g_vecListeningNativeCalls.length = 0;
					g_vecProximityNativeCalls.length = 0;
					g_Assert.throws(() => DirectDocumentation[strOperationName](1, 2, InvalidStatus), TypeError);
					g_Assert.equal(g_vecListeningQueryCalls.length, 0);
					g_Assert.equal(g_vecListeningNativeCalls.length, 0);
					g_Assert.equal(g_vecProximityNativeCalls.length, 0);
				});
			}
		}

		for (const strOperationName of ["InspectVoicePair", "SetVoicePairListening", "SetVoiceServerListening"]) {
			for (const InvalidStatus of [undefined, null, 1, "true"]) {
				VerifyVoiceDocumentationCase(`reject invalid query state in ${strOperationName}`, () => {
					WithNativeVoiceMethod("GetClientListening", () => InvalidStatus, () => {
						g_vecListeningNativeCalls.length = 0;
						g_Assert.throws(() => DirectDocumentation[strOperationName](1, 2, false));
						g_Assert.equal(g_vecListeningNativeCalls.length, 0);
					});
				});
			}
		}

		for (const [strOperationName, strNativeMethodName] of [
			["SetVoicePairListening", "SetClientListening"],
			["SetVoicePairProximity", "SetClientProximity"],
			["SetVoiceServerListening", "SetClientListening"],
			["SetVoiceServerProximity", "SetClientProximity"],
		]) {
			for (const InvalidStatus of [
				undefined,
				null,
				false,
				1,
				"true",
			]) {
				VerifyVoiceDocumentationCase(`require exact true in ${strOperationName}`, () => {
					WithNativeVoiceMethod(strNativeMethodName, () => InvalidStatus, () => {
						g_Assert.throws(() => DirectDocumentation[strOperationName](1, 2, false));
					});
				});
			}
		}

		for (const Failure of [new Error("original voice failure"), null]) {
			for (const [strOperationName, strNativeMethodName] of [
				["InspectVoicePair", "GetClientListening"],
				["SetVoicePairListening", "SetClientListening"],
				["SetVoicePairProximity", "SetClientProximity"],
				["SetVoiceServerListening", "SetClientListening"],
				["SetVoiceServerProximity", "SetClientProximity"],
			]) {
				VerifyVoiceDocumentationCase(`preserve original failure in ${strOperationName}`, () => {
					WithNativeVoiceMethod(strNativeMethodName, () => {
						throw Failure;
					}, () => {
						g_Assert.throws(() => DirectDocumentation[strOperationName](1, 2, false), (ErrorValue) => ErrorValue === Failure);
					});
				});
			}
		}

		for (const Status of [
			undefined,
			null,
			false,
			1,
			"true",
		]) {
			VerifyVoiceDocumentationCase("require a strict connected player before native voice query", () => {
				const Original = Player(1);
				g_mapPlayers.set(1, {
					Index: 1,

					IsConnected() {
						return Status;
					},
				});

				try {
					g_vecListeningQueryCalls.length = 0;
					g_Assert.throws(() => DirectDocumentation.InspectVoicePair(1, 2));
					g_Assert.equal(g_vecListeningQueryCalls.length, 0);
				} finally {
					g_mapPlayers.set(1, Original);
				}
			});
		}

		VerifyVoiceDocumentationCase("numeric pair captures player index/method once and preserves receiver", () => {
			const Original = Player(1);
			let unIndexReads = 0;
			let unMethodReads = 0;
			const PlayerValue = {
				get Index() {
					++unIndexReads;

					return 1;
				},

				get IsConnected() {
					++unMethodReads;

					return function ReadConnected() {
						g_Assert.equal(this, PlayerValue);

						return true;
					};
				},
			};
			g_mapPlayers.set(1, PlayerValue);

			try {
				const Report = DirectDocumentation.InspectVoicePair(1, 2);
				g_Assert.equal(Report.ReceiverIndex, 1);
				g_Assert.equal(unIndexReads, 1);
				g_Assert.equal(unMethodReads, 1);
				g_Assert.equal(typeof Report.VoiceServerAddress, "bigint");
				g_Assert.equal(Report.VoiceServerAddress, g_NativeVoice.VoiceServer.Address);
			} finally {
				g_mapPlayers.set(1, Original);
			}
		});

		VerifyVoiceDocumentationCase("unused custom owner unloads without acquiring a hook or listener", () => {
			const unHookCount = g_vecHookCreateCalls.length;
			g_Assert.equal(CustomDocumentation.Load(), true);
			g_Assert.equal(CustomDocumentation.Unload(), true);
			g_Assert.equal(CustomDocumentation.Unload(), false);
			g_Assert.equal(g_vecHookCreateCalls.length, unHookCount);
			g_Assert.equal(g_setListenerCallbacks.size, 0);
		});

		VerifyVoiceDocumentationCase("failed custom hook removal retains owner for exact pending cleanup retry", () => {
			g_Assert.equal(CustomDocumentation.Load(), true);
			CustomDocumentation.MuteScoped(2, [1]);
			const OriginalRemovePre = g_NativeHook.RemovePre;
			g_NativeHook.RemovePre = () => false;

			try {
				g_Assert.equal(CustomDocumentation.Unload(), false);
				g_Assert.throws(() => CustomDocumentation.Load(), /already loaded/);
				g_Assert.equal(g_NativeHook.PreCallbacks.size, 1);
			} finally {
				g_NativeHook.RemovePre = OriginalRemovePre;
			}

			g_Assert.equal(CustomDocumentation.Unload(), true);
			g_Assert.equal(g_NativeHook.PreCallbacks.size, 0);
			g_Assert.equal(g_setListenerCallbacks.size, 0);
		});

		for (const Failure of [new Error("original unload failure"), null, 1]) {
			VerifyVoiceDocumentationCase("throwing/non-boolean custom unload keeps the cleanup owner", () => {
				g_Assert.equal(CustomDocumentation.Load(), true);
				CustomDocumentation.MuteScoped(2, [1]);
				const OriginalUnload = g_Voice.MuteManager.prototype.Unload;
				g_Voice.MuteManager.prototype.Unload = function FailUnload() {
					if (Failure === 1) {
						return 1;
					}

					throw Failure;
				};

				try {
					if (Failure === 1) {
						g_Assert.throws(() => CustomDocumentation.Unload(), TypeError);
					} else {
						g_Assert.throws(() => CustomDocumentation.Unload(), (ErrorValue) => ErrorValue === Failure);
					}

					g_Assert.throws(() => CustomDocumentation.Load(), /already loaded/);
				} finally {
					g_Voice.MuteManager.prototype.Unload = OriginalUnload;
				}

				g_Assert.equal(CustomDocumentation.Unload(), true);
				g_Assert.equal(g_NativeHook.PreCallbacks.size, 0);
				g_Assert.equal(g_setListenerCallbacks.size, 0);
			});
		}

		VerifyVoiceDocumentationCase("unused/already-unloaded native manager false differs from the lazy owner result", () => {
			const Manager = new g_Voice.MuteManager();
			g_Assert.equal(Manager.Unload(), false);
			g_Assert.equal(Manager.IsMuted(2, []), true);
			g_Assert.deepEqual(Manager.GetReceiverIndexes(null), [1, 2, 3, 4]);
			g_Assert.deepEqual(Manager.GetReceiverIndexes([3, 1, 3]), [3, 1, 3]);
		});

		for (const PlayerValue of [
			undefined,
			null,
			false,
			1,
			"player",
			[],
		]) {
			VerifyVoiceDocumentationCase("reject a non-record player before voice IO", () => {
				const Original = Player(1);
				g_mapPlayers.set(1, PlayerValue);

				try {
					g_vecListeningQueryCalls.length = 0;
					g_Assert.throws(() => DirectDocumentation.InspectVoicePair(1, 2), TypeError);
					g_Assert.equal(g_vecListeningQueryCalls.length, 0);
				} finally {
					g_mapPlayers.set(1, Original);
				}
			});
		}

		for (const PlayerIndex of [undefined, "1", 1n, 2]) {
			VerifyVoiceDocumentationCase("reject a mismatched player index before voice IO", () => {
				const Original = Player(1);
				g_mapPlayers.set(1, { Index: PlayerIndex });

				try {
					g_vecListeningQueryCalls.length = 0;
					g_Assert.throws(() => DirectDocumentation.InspectVoicePair(1, 2), /different index/);
					g_Assert.equal(g_vecListeningQueryCalls.length, 0);
				} finally {
					g_mapPlayers.set(1, Original);
				}
			});
		}

		for (const MethodValue of [undefined, null, 1]) {
			VerifyVoiceDocumentationCase("reject a non-callable connection method at the documented boundary", () => {
				const Original = Player(1);
				g_mapPlayers.set(1, { Index: 1, IsConnected: MethodValue });

				try {
					g_Assert.throws(() => DirectDocumentation.InspectVoicePair(1, 2), (ErrorValue) => (ErrorValue instanceof TypeError) && ErrorValue.message.includes("requires IsConnected()."));
				} finally {
					g_mapPlayers.set(1, Original);
				}
			});
		}

		g_Assert.equal(g_setListenerCallbacks.size, 0, "new documentation cases must release listeners");
		g_Assert.equal(g_NativeHook.PreCallbacks.size, 0, "new documentation cases must release hook callbacks");
	}

	RunDocumentationTask(CheckVoiceDocumentationScenarios, "scenarios");
} catch (ErrorValue) {
	g_PrimaryFailure = ErrorValue;
	g_bFailed = true;
} finally {
	const vecCleanupFailures = [];
	for (const Restore of [
		RestoreVoiceFixtures,
		RestoreVoiceResources,
		RestoreMuteManagerObserver,
		RestorePackageCache,
		RestoreModuleLoader,
		RestoreSourceJS,
	]) {
		try {
			Restore();
		} catch (ErrorValue) {
			vecCleanupFailures.push(ErrorValue);
		}
	}

	if (vecCleanupFailures.length > 0) {
		if (g_bFailed) {
			throw new AggregateError([g_PrimaryFailure, ...vecCleanupFailures], "Player voice review and restoration failed.");
		}

		throw new AggregateError(vecCleanupFailures, "Player voice restoration failed.");
	}
}

if (g_bFailed) {
	throw g_PrimaryFailure;
}

console.log(`[  OK  ] smoke_players_voice documentation cases=${g_unDocumentationScenarioCount}`);
