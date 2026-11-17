"use strict";

const {
	CreateEntityFireOutputHook,
	RemoveEntityFireOutputHook,
	GetEntityFireOutputContext,
} = require("entities/outputs");
const { GetModule } = require("internal/runtime");

const g_ListenersRuntime = GetModule("listeners");
const g_ButtonStatus = Object.freeze({ PRESSED: 1, RELEASED: 0 });
const g_strLifecycleReentrancyErrorMessage = "ListenerManager registrations cannot change during a lifecycle transition.";

function EnsureEventName(strEventName) {
	if ((typeof strEventName !== "string") || (strEventName.length === 0)) {
		throw new TypeError("Listener event name must be a non-empty string.");
	}

	return strEventName;
}

function EnsureCallback(Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("Listener callback must be a function.");
	}

	return Callback;
}

function SerializePayload(Payload) {
	if ((Payload === null) || (Payload === undefined)) {
		return "";
	}

	if (typeof Payload === "string") {
		return Payload;
	}

	const strSerializedPayload = JSON.stringify(Payload);
	if (typeof strSerializedPayload !== "string") {
		throw new TypeError("Listener payload must be serializable.");
	}

	return strSerializedPayload;
}

function DecodePayload(strPayload) {
	if (typeof strPayload !== "string") {
		throw new TypeError("Native listener payload must be a string.");
	}

	let DecodedPayload = null;
	try {
		DecodedPayload = JSON.parse(strPayload);
	} catch (ErrorValue) {
		throw new TypeError("Native listener payload must be valid JSON.", { cause: ErrorValue });
	}

	if ((DecodedPayload === null) || (typeof DecodedPayload !== "object") || Array.isArray(DecodedPayload) || !Object.hasOwn(DecodedPayload, "Arguments")) {
		throw new TypeError("Native listener payload must contain an Arguments array.");
	}

	const vecCallbackArguments = DecodedPayload.Arguments;
	if (!Array.isArray(vecCallbackArguments)) {
		throw new TypeError("Native listener payload must contain an Arguments array.");
	}

	for (let unArgumentIndex = 0; unArgumentIndex < vecCallbackArguments.length; ++unArgumentIndex) {
		const Argument = vecCallbackArguments[unArgumentIndex];
		if ((Argument === null) || (typeof Argument !== "object") || Array.isArray(Argument)) {
			continue;
		}

		const vecArgumentKeys = Object.keys(Argument);
		if ((vecArgumentKeys.length !== 1) || (vecArgumentKeys[0] !== "$SourceJSBigInt") || (typeof Argument.$SourceJSBigInt !== "string")) {
			continue;
		}

		try {
			vecCallbackArguments[unArgumentIndex] = BigInt(Argument.$SourceJSBigInt);
		} catch (ErrorValue) {
			throw new TypeError("Native listener payload contains an invalid BigInt argument.", { cause: ErrorValue });
		}
	}

	return vecCallbackArguments;
}

function EncodeArguments(vecCallbackArguments) {
	return SerializePayload({ Arguments: vecCallbackArguments });
}

function RegisterListener(strEventName, Callback) {
	return g_ListenersRuntime.AddListener(EnsureEventName(strEventName), EnsureCallback(Callback));
}

function UnregisterListener(strEventName, Callback) {
	return g_ListenersRuntime.RemoveListener(EnsureEventName(strEventName), EnsureCallback(Callback));
}

function EmitListenerEvent(strEventName, Payload = "") {
	return g_ListenersRuntime.Emit(EnsureEventName(strEventName), SerializePayload(Payload));
}

function GetListenerCount(strEventName) {
	return g_ListenersRuntime.GetListenerCount(EnsureEventName(strEventName));
}

function RethrowWithCleanupErrors(OperationError, vecCleanupErrors, strErrorMessage) {
	if (vecCleanupErrors.length === 0) {
		throw OperationError;
	}

	throw new AggregateError([OperationError, ...vecCleanupErrors], strErrorMessage);
}

class ListenerManager {
	constructor(strEventName, ManagerOptions = {}) {
		if ((ManagerOptions === null) || (typeof ManagerOptions !== "object") || Array.isArray(ManagerOptions)) {
			throw new TypeError("ListenerManager ManagerOptions must be an object.");
		}

		for (const OptionName of Reflect.ownKeys(ManagerOptions)) {
			if (OptionName !== "AutoBridge") {
				throw new TypeError(`Unknown ListenerManager option '${String(OptionName)}'.`);
			}
		}

		let bAutomaticBridgeEnabled = true;
		if (Object.hasOwn(ManagerOptions, "AutoBridge")) {
			bAutomaticBridgeEnabled = ManagerOptions.AutoBridge;
			if (typeof bAutomaticBridgeEnabled !== "boolean") {
				throw new TypeError("ListenerManager AutoBridge must be a boolean.");
			}
		}

		this.EventName = EnsureEventName(strEventName);
		this.ListenerCallbacks = new Set();
		this.AutoBridge = bAutomaticBridgeEnabled;
		this.RuntimeCallback = (strEmittedEventName, strPayload) => {
			if (strEmittedEventName !== this.EventName) {
				return 0;
			}

			return this.NotifyListeners(...DecodePayload(strPayload));
		};
		this.Initialized = false;
		this.#m_bLifecycleTransitionActive = false;
	}

	RegisterListener(ListenerCallback) {
		EnsureCallback(ListenerCallback);

		if (this.#m_bLifecycleTransitionActive) {
			throw new Error(g_strLifecycleReentrancyErrorMessage);
		}

		this.#m_bLifecycleTransitionActive = true;

		try {
			const setListenerCallbacks = this.ListenerCallbacks;
			if (setListenerCallbacks.has(ListenerCallback)) {
				throw new Error("Listener callback is already registered.");
			}

			if (setListenerCallbacks.size !== 0) {
				setListenerCallbacks.add(ListenerCallback);
				return ListenerCallback;
			}

			const bAutomaticBridgeEnabled = this.AutoBridge;
			const InitializationCallback = this.InitializeListenerManager;
			const FinalizationCallback = this.FinalizeListenerManager;
			const strManagerEventName = this.EventName;
			const ManagerRuntimeCallback = this.RuntimeCallback;

			if (typeof bAutomaticBridgeEnabled !== "boolean") {
				throw new TypeError("ListenerManager AutoBridge must be a boolean.");
			}

			if ((InitializationCallback !== undefined) && (typeof InitializationCallback !== "function")) {
				throw new TypeError("ListenerManager InitializeListenerManager must be a function or undefined.");
			}

			if ((FinalizationCallback !== undefined) && (typeof FinalizationCallback !== "function")) {
				throw new TypeError("ListenerManager FinalizeListenerManager must be a function or undefined.");
			}

			let bInitializationCompleted = false;
			let bBridgeRegistered = false;

			try {
				if (InitializationCallback !== undefined) {
					InitializationCallback.call(this);
					bInitializationCompleted = true;
				}

				if (bAutomaticBridgeEnabled) {
					if (!RegisterListener(strManagerEventName, ManagerRuntimeCallback)) {
						throw new Error("ListenerManager runtime bridge registration was rejected.");
					}

					bBridgeRegistered = true;
				}

				setListenerCallbacks.add(ListenerCallback);
			} catch (RegistrationError) {
				const vecCleanupErrors = [];
				if (bBridgeRegistered) {
					try {
						// User code may already have removed the bridge; an absent match needs no further rollback.
						UnregisterListener(strManagerEventName, ManagerRuntimeCallback);
					} catch (CleanupError) {
						vecCleanupErrors.push(CleanupError);
					}
				}

				if (bInitializationCompleted && (FinalizationCallback !== undefined)) {
					try {
						FinalizationCallback.call(this);
					} catch (CleanupError) {
						vecCleanupErrors.push(CleanupError);
					}
				}

				RethrowWithCleanupErrors(RegistrationError, vecCleanupErrors, "ListenerManager registration and cleanup failed.");
			}

			this.Initialized = true;

			return ListenerCallback;
		} finally {
			this.#m_bLifecycleTransitionActive = false;
		}
	}

	UnregisterListener(ListenerCallback) {
		EnsureCallback(ListenerCallback);

		if (this.#m_bLifecycleTransitionActive) {
			throw new Error(g_strLifecycleReentrancyErrorMessage);
		}

		this.#m_bLifecycleTransitionActive = true;

		try {
			const setListenerCallbacks = this.ListenerCallbacks;
			if (!setListenerCallbacks.has(ListenerCallback)) {
				throw new Error("Listener callback is not registered.");
			}

			if (setListenerCallbacks.size === 1) {
				const bManagerInitialized = this.Initialized;
				if (typeof bManagerInitialized !== "boolean") {
					throw new TypeError("ListenerManager Initialized must be a boolean.");
				}

				if (bManagerInitialized) {
					const bAutomaticBridgeEnabled = this.AutoBridge;
					const FinalizationCallback = this.FinalizeListenerManager;
					const strManagerEventName = this.EventName;
					const ManagerRuntimeCallback = this.RuntimeCallback;
					let bBridgeRemoved = false;

					if (typeof bAutomaticBridgeEnabled !== "boolean") {
						throw new TypeError("ListenerManager AutoBridge must be a boolean.");
					}

					if ((FinalizationCallback !== undefined) && (typeof FinalizationCallback !== "function")) {
						throw new TypeError("ListenerManager FinalizeListenerManager must be a function or undefined.");
					}

					if (bAutomaticBridgeEnabled) {
						// No matching bridge is harmless here; manager resources must still be finalized.
						UnregisterListener(strManagerEventName, ManagerRuntimeCallback);
						bBridgeRemoved = true;
					}

					try {
						if (FinalizationCallback !== undefined) {
							FinalizationCallback.call(this);
						}
					} catch (FinalizationError) {
						const vecCleanupErrors = [];
						if (bBridgeRemoved) {
							try {
								if (!RegisterListener(strManagerEventName, ManagerRuntimeCallback)) {
									throw new Error("ListenerManager runtime bridge restoration was rejected.");
								}
							} catch (CleanupError) {
								vecCleanupErrors.push(CleanupError);
							}
						}

						RethrowWithCleanupErrors(FinalizationError, vecCleanupErrors, "ListenerManager finalization and bridge restoration failed.");
					}

					this.Initialized = false;
				}
			}

			setListenerCallbacks.delete(ListenerCallback);

			return true;
		} finally {
			this.#m_bLifecycleTransitionActive = false;
		}
	}

	HasListener(ListenerCallback) {
		return this.ListenerCallbacks.has(ListenerCallback);
	}

	NotifyListeners(...vecCallbackArguments) {
		let unCallbackCount = 0;
		for (const ListenerCallback of [...this.ListenerCallbacks]) {
			ListenerCallback(...vecCallbackArguments);
			unCallbackCount += 1;
		}

		return unCallbackCount;
	}

	EmitListenerEvent(...vecCallbackArguments) {
		return EmitListenerEvent(this.EventName, EncodeArguments(vecCallbackArguments));
	}

	ClearListeners() {
		if (this.#m_bLifecycleTransitionActive) {
			throw new Error(g_strLifecycleReentrancyErrorMessage);
		}

		for (const ListenerCallback of [...this.ListenerCallbacks]) {
			this.UnregisterListener(ListenerCallback);
		}

		return this;
	}

	GetAllListeners() {
		return [...this.ListenerCallbacks];
	}

	[Symbol.iterator]() {
		return this.ListenerCallbacks[Symbol.iterator]();
	}

	get ListenerCount() {
		return this.ListenerCallbacks.size;
	}

	get Empty() {
		return this.ListenerCount === 0;
	}

	#m_bLifecycleTransitionActive;
}

class ListenerManagerDecorator {
	constructor(ListenerManagerValue, ListenerCallback) {
		if (!(ListenerManagerValue instanceof ListenerManager)) {
			throw new TypeError("ListenerManagerDecorator requires a ListenerManager.");
		}

		this.ListenerManager = ListenerManagerValue;
		this.ListenerCallback = EnsureCallback(ListenerCallback);
		this.Disposed = false;

		this.ListenerManager.RegisterListener(this.ListenerCallback);
	}

	InvokeListenerCallback(...vecCallbackArguments) {
		return this.ListenerCallback(...vecCallbackArguments);
	}

	DisposeListener() {
		if (this.Disposed) {
			return false;
		}

		const bUnregistered = this.ListenerManager.UnregisterListener(this.ListenerCallback);
		this.Disposed = bUnregistered;

		return bUnregistered;
	}
}

class EntityOutputListenerManager extends ListenerManager {
	constructor() {
		super("EntityOutput", { AutoBridge: false });
		this.EntityOutputHook = null;
	}

	InitializeListenerManager() {
		const EntityOutputHook = CreateEntityFireOutputHook((Payload) => {
			const OutputContext = GetEntityFireOutputContext(Payload);
			if (!OutputContext.OutputName) {
				return;
			}

			this.NotifyListeners(OutputContext.OutputName, OutputContext.Activator, OutputContext.Caller, OutputContext.Value, OutputContext.Delay, OutputContext);
		}, undefined, true);
		if ((EntityOutputHook === null) || (EntityOutputHook === undefined)) {
			throw new Error("EntityOutputListenerManager could not create the FireOutput hook.");
		}

		this.EntityOutputHook = EntityOutputHook;
	}

	FinalizeListenerManager() {
		if (!RemoveEntityFireOutputHook()) {
			throw new Error("EntityOutputListenerManager could not remove the FireOutput hook.");
		}

		this.EntityOutputHook = null;
	}
}

const g_ClientActiveManager = new ListenerManager("ClientActive");
const g_ClientConnectManager = new ListenerManager("ClientConnect");
const g_ClientDisconnectManager = new ListenerManager("ClientDisconnect");
const g_ClientFullyConnectManager = new ListenerManager("ClientFullyConnect");
const g_ClientPutInServerManager = new ListenerManager("ClientPutInServer");
const g_ClientSettingsChangedManager = new ListenerManager("ClientSettingsChanged");
const g_CombinerPrecacheManager = new ListenerManager("CombinerPreCache");
const g_ConVarChangedManager = new ListenerManager("ConVarChanged");
const g_DataLoadedManager = new ListenerManager("DataLoaded");
const g_DataUnloadedManager = new ListenerManager("DataUnloaded");
const g_EdictAllocatedManager = new ListenerManager("EdictAllocated");
const g_EdictFreedManager = new ListenerManager("EdictFreed");
const g_EntityCreatedManager = new ListenerManager("EntityCreated");
const g_NetworkedEntityCreatedManager = new ListenerManager("NetworkedEntityCreated");
const g_EntityDeletedManager = new ListenerManager("EntityDeleted");
const g_NetworkedEntityDeletedManager = new ListenerManager("NetworkedEntityDeleted");
const g_EntityCollisionManager = new ListenerManager("EntityCollision");
const g_EntityTransmitManager = new ListenerManager("EntityTransmit");
const g_EntityOutputManager = new EntityOutputListenerManager();
const g_EntityPreSpawnedManager = new ListenerManager("EntityPreSpawned");
const g_NetworkedEntityPreSpawnedManager = new ListenerManager("NetworkedEntityPreSpawned");
const g_EntitySpawnedManager = new ListenerManager("EntitySpawned");
const g_NetworkedEntitySpawnedManager = new ListenerManager("NetworkedEntitySpawned");
const g_LevelInitManager = new ListenerManager("LevelInit");
const g_LevelShutdownManager = new ListenerManager("LevelShutdown");
const g_LevelEndManager = new ListenerManager("LevelEnd");
const g_NetworkIDValidatedManager = new ListenerManager("NetworkIDValidated");
const g_ButtonStateChangedManager = new ListenerManager("ButtonStateChanged");
const g_PlayerCollisionManager = new ListenerManager("PlayerCollision");
const g_PlayerTransmitManager = new ListenerManager("PlayerTransmit");
const g_PlayerRunCommandManager = new ListenerManager("PlayerRunCommand");
const g_PlayerPostRunCommandManager = new ListenerManager("PlayerPostRunCommand");
const g_PluginLoadedManager = new ListenerManager("PluginLoaded");
const g_PluginLoadingManager = new ListenerManager("PluginLoading");
const g_PluginUnloadedManager = new ListenerManager("PluginUnloaded");
const g_PluginUnloadingManager = new ListenerManager("PluginUnloading");
const g_QueryCVarValueFinishedManager = new ListenerManager("QueryCVarValueFinished");
const g_ServerActivateManager = new ListenerManager("ServerActivate");
const g_TickManager = new ListenerManager("Tick");
const g_VersionUpdateManager = new ListenerManager("VersionUpdate");
const g_ServerOutputManager = new ListenerManager("ServerOutput");

function CreateListenerDecoratorFactory(ListenerManagerValue) {
	return (ListenerCallback) => new ListenerManagerDecorator(ListenerManagerValue, ListenerCallback);
}

function GetButtonCombinationStatus(nPreviousButtons, nCurrentButtons, nButtonCombination) {
	if (!Number.isSafeInteger(nPreviousButtons) || !Number.isSafeInteger(nCurrentButtons) || !Number.isSafeInteger(nButtonCombination)) {
		throw new TypeError("Button values and combination must be integers.");
	}

	const bPreviousCombinationActive = (nPreviousButtons & nButtonCombination) === nButtonCombination;
	const bCurrentCombinationActive = (nCurrentButtons & nButtonCombination) === nButtonCombination;
	if (!bPreviousCombinationActive && bCurrentCombinationActive) {
		return g_ButtonStatus.PRESSED;
	}

	if (bPreviousCombinationActive && !bCurrentCombinationActive) {
		return g_ButtonStatus.RELEASED;
	}

	return null;
}

function CreateClientConnectContext(nClientIndex, strClientName, strNetworkAddress, unMaximumRejectLength) {
	if (!Number.isSafeInteger(nClientIndex) || (typeof strClientName !== "string") || (typeof strNetworkAddress !== "string") || !Number.isSafeInteger(unMaximumRejectLength) || (unMaximumRejectLength < 0)) {
		throw new TypeError("Client connect values are invalid.");
	}

	const ClientConnectContext = {
		Allowed: true,
		ClientIndex: nClientIndex,
		MaximumRejectLength: unMaximumRejectLength,
		NetworkAddress: strNetworkAddress,
		PlayerName: strClientName,
		RejectMessage: "",
		AcceptClientConnection() {
			this.Allowed = true;
			this.RejectMessage = "";

			return true;
		},
		RejectClientConnection(strMessage = "") {
			if (typeof strMessage !== "string") {
				throw new TypeError("Client rejection message must be a string.");
			}

			this.Allowed = false;
			this.RejectMessage = strMessage;

			return false;
		},
	};

	return ClientConnectContext;
}

function ApplyClientConnectResult(ClientConnectContext, CallbackResult) {
	if ((CallbackResult === false) || (CallbackResult === 0)) {
		ClientConnectContext.Allowed = false;
		return;
	}

	if (typeof CallbackResult === "string") {
		ClientConnectContext.RejectClientConnection(CallbackResult);
		return;
	}

	if ((CallbackResult === null) || (CallbackResult === undefined) || (typeof CallbackResult !== "object")) {
		return;
	}

	const bCallbackAllowsConnection = CallbackResult.Allowed;
	const strCallbackRejectMessage = CallbackResult.RejectMessage;

	if (bCallbackAllowsConnection === false) {
		ClientConnectContext.Allowed = false;
	}

	if (typeof strCallbackRejectMessage === "string") {
		ClientConnectContext.RejectClientConnection(strCallbackRejectMessage);
	}
}

function NotifyClientConnect(...vecCallbackArguments) {
	const ClientConnectContext = CreateClientConnectContext(...vecCallbackArguments);
	let bConnectionAllowed = true;
	let strRejectionMessage = "";

	for (const ListenerCallback of [...g_ClientConnectManager.ListenerCallbacks]) {
		ApplyClientConnectResult(ClientConnectContext, ListenerCallback(ClientConnectContext));

		if (!ClientConnectContext.Allowed) {
			bConnectionAllowed = false;
			if (ClientConnectContext.RejectMessage.length > 0) {
				strRejectionMessage = ClientConnectContext.RejectMessage;
			}
		}
	}

	if (bConnectionAllowed) {
		return true;
	}

	ClientConnectContext.Allowed = false;
	ClientConnectContext.RejectMessage = strRejectionMessage;

	return (strRejectionMessage.length === 0) ? false : strRejectionMessage;
}

function NotifyServerOutput(...vecCallbackArguments) {
	let bOutputBlocked = false;
	for (const ListenerCallback of [...g_ServerOutputManager.ListenerCallbacks]) {
		const OutputAction = ListenerCallback(...vecCallbackArguments);
		if ((OutputAction === 0) || (OutputAction === false)) {
			bOutputBlocked = true;
		}
	}

	return bOutputBlocked ? 0 : 1;
}

g_ClientConnectManager.RuntimeCallback = (strEmittedEventName, strPayload) => {
	if (strEmittedEventName !== g_ClientConnectManager.EventName) {
		return true;
	}

	return NotifyClientConnect(...DecodePayload(strPayload));
};

g_ServerOutputManager.RuntimeCallback = (strEmittedEventName, strPayload) => {
	if (strEmittedEventName !== g_ServerOutputManager.EventName) {
		return 1;
	}

	return NotifyServerOutput(...DecodePayload(strPayload));
};

const g_RegisterClientActiveListener = CreateListenerDecoratorFactory(g_ClientActiveManager);
const g_RegisterClientConnectListener = CreateListenerDecoratorFactory(g_ClientConnectManager);
const g_RegisterClientDisconnectListener = CreateListenerDecoratorFactory(g_ClientDisconnectManager);
const g_RegisterClientFullyConnectListener = CreateListenerDecoratorFactory(g_ClientFullyConnectManager);
const g_RegisterClientPutInServerListener = CreateListenerDecoratorFactory(g_ClientPutInServerManager);
const g_RegisterClientSettingsChangedListener = CreateListenerDecoratorFactory(g_ClientSettingsChangedManager);
const g_RegisterCombinerPrecacheListener = CreateListenerDecoratorFactory(g_CombinerPrecacheManager);
const g_RegisterConVarChangedListener = CreateListenerDecoratorFactory(g_ConVarChangedManager);
const g_RegisterDataLoadedListener = CreateListenerDecoratorFactory(g_DataLoadedManager);
const g_RegisterDataUnloadedListener = CreateListenerDecoratorFactory(g_DataUnloadedManager);
const g_RegisterEdictAllocatedListener = CreateListenerDecoratorFactory(g_EdictAllocatedManager);
const g_RegisterEdictFreedListener = CreateListenerDecoratorFactory(g_EdictFreedManager);
const g_RegisterEntityCreatedListener = CreateListenerDecoratorFactory(g_EntityCreatedManager);
const g_RegisterNetworkedEntityCreatedListener = CreateListenerDecoratorFactory(g_NetworkedEntityCreatedManager);
const g_RegisterEntityDeletedListener = CreateListenerDecoratorFactory(g_EntityDeletedManager);
const g_RegisterNetworkedEntityDeletedListener = CreateListenerDecoratorFactory(g_NetworkedEntityDeletedManager);
const g_RegisterEntityCollisionListener = CreateListenerDecoratorFactory(g_EntityCollisionManager);
const g_RegisterEntityTransmitListener = CreateListenerDecoratorFactory(g_EntityTransmitManager);
const g_RegisterEntityOutputListener = CreateListenerDecoratorFactory(g_EntityOutputManager);
const g_RegisterEntityPreSpawnedListener = CreateListenerDecoratorFactory(g_EntityPreSpawnedManager);
const g_RegisterNetworkedEntityPreSpawnedListener = CreateListenerDecoratorFactory(g_NetworkedEntityPreSpawnedManager);
const g_RegisterEntitySpawnedListener = CreateListenerDecoratorFactory(g_EntitySpawnedManager);
const g_RegisterNetworkedEntitySpawnedListener = CreateListenerDecoratorFactory(g_NetworkedEntitySpawnedManager);
const g_RegisterLevelInitListener = CreateListenerDecoratorFactory(g_LevelInitManager);
const g_RegisterLevelShutdownListener = CreateListenerDecoratorFactory(g_LevelShutdownManager);
const g_RegisterLevelEndListener = CreateListenerDecoratorFactory(g_LevelEndManager);
const g_RegisterNetworkIDValidatedListener = CreateListenerDecoratorFactory(g_NetworkIDValidatedManager);
const g_RegisterButtonStateChangedListener = CreateListenerDecoratorFactory(g_ButtonStateChangedManager);
const g_RegisterPlayerCollisionListener = CreateListenerDecoratorFactory(g_PlayerCollisionManager);
const g_RegisterPlayerTransmitListener = CreateListenerDecoratorFactory(g_PlayerTransmitManager);
const g_RegisterPlayerRunCommandListener = CreateListenerDecoratorFactory(g_PlayerRunCommandManager);
const g_RegisterPlayerPostRunCommandListener = CreateListenerDecoratorFactory(g_PlayerPostRunCommandManager);
const g_RegisterPluginLoadedListener = CreateListenerDecoratorFactory(g_PluginLoadedManager);
const g_RegisterPluginLoadingListener = CreateListenerDecoratorFactory(g_PluginLoadingManager);
const g_RegisterPluginUnloadedListener = CreateListenerDecoratorFactory(g_PluginUnloadedManager);
const g_RegisterPluginUnloadingListener = CreateListenerDecoratorFactory(g_PluginUnloadingManager);
const g_RegisterQueryCVarValueFinishedListener = CreateListenerDecoratorFactory(g_QueryCVarValueFinishedManager);
const g_RegisterServerActivateListener = CreateListenerDecoratorFactory(g_ServerActivateManager);
const g_RegisterTickListener = CreateListenerDecoratorFactory(g_TickManager);
const g_RegisterVersionUpdateListener = CreateListenerDecoratorFactory(g_VersionUpdateManager);
const g_RegisterServerOutputListener = CreateListenerDecoratorFactory(g_ServerOutputManager);

module.exports = {
	ButtonStatus: g_ButtonStatus,
	EntityOutputListenerManager,
	ListenerManager,
	ListenerManagerDecorator,
	RegisterListener,
	UnregisterListener,
	EmitListenerEvent,
	GetListenerCount,
	GetButtonCombinationStatus,
	get ButtonStateChangedManager() {
		return g_ButtonStateChangedManager;
	},
	get ClientActiveManager() {
		return g_ClientActiveManager;
	},
	get ClientConnectManager() {
		return g_ClientConnectManager;
	},
	get ClientDisconnectManager() {
		return g_ClientDisconnectManager;
	},
	get ClientFullyConnectManager() {
		return g_ClientFullyConnectManager;
	},
	get ClientPutInServerManager() {
		return g_ClientPutInServerManager;
	},
	get ClientSettingsChangedManager() {
		return g_ClientSettingsChangedManager;
	},
	get CombinerPreCacheManager() {
		return g_CombinerPrecacheManager;
	},
	get ConVarChangedManager() {
		return g_ConVarChangedManager;
	},
	get DataLoadedManager() {
		return g_DataLoadedManager;
	},
	get DataUnloadedManager() {
		return g_DataUnloadedManager;
	},
	get EdictAllocatedManager() {
		return g_EdictAllocatedManager;
	},
	get EdictFreedManager() {
		return g_EdictFreedManager;
	},
	get EntityCollisionManager() {
		return g_EntityCollisionManager;
	},
	get EntityCreatedManager() {
		return g_EntityCreatedManager;
	},
	get EntityDeletedManager() {
		return g_EntityDeletedManager;
	},
	get EntityOutputManager() {
		return g_EntityOutputManager;
	},
	get EntityPreSpawnedManager() {
		return g_EntityPreSpawnedManager;
	},
	get EntitySpawnedManager() {
		return g_EntitySpawnedManager;
	},
	get EntityTransmitManager() {
		return g_EntityTransmitManager;
	},
	get LevelEndManager() {
		return g_LevelEndManager;
	},
	get LevelInitManager() {
		return g_LevelInitManager;
	},
	get LevelShutdownManager() {
		return g_LevelShutdownManager;
	},
	get NetworkIDValidatedManager() {
		return g_NetworkIDValidatedManager;
	},
	get NetworkedEntityCreatedManager() {
		return g_NetworkedEntityCreatedManager;
	},
	get NetworkedEntityDeletedManager() {
		return g_NetworkedEntityDeletedManager;
	},
	get NetworkedEntityPreSpawnedManager() {
		return g_NetworkedEntityPreSpawnedManager;
	},
	get NetworkedEntitySpawnedManager() {
		return g_NetworkedEntitySpawnedManager;
	},
	get PlayerCollisionManager() {
		return g_PlayerCollisionManager;
	},
	get PlayerPostRunCommandManager() {
		return g_PlayerPostRunCommandManager;
	},
	get PlayerRunCommandManager() {
		return g_PlayerRunCommandManager;
	},
	get PlayerTransmitManager() {
		return g_PlayerTransmitManager;
	},
	get PluginLoadedManager() {
		return g_PluginLoadedManager;
	},
	get PluginLoadingManager() {
		return g_PluginLoadingManager;
	},
	get PluginUnloadedManager() {
		return g_PluginUnloadedManager;
	},
	get PluginUnloadingManager() {
		return g_PluginUnloadingManager;
	},
	get QueryCVarValueFinishedManager() {
		return g_QueryCVarValueFinishedManager;
	},
	get ServerActivateManager() {
		return g_ServerActivateManager;
	},
	get ServerOutputManager() {
		return g_ServerOutputManager;
	},
	get TickManager() {
		return g_TickManager;
	},
	get VersionUpdateManager() {
		return g_VersionUpdateManager;
	},
	RegisterButtonStateChangedListener: g_RegisterButtonStateChangedListener,
	RegisterClientActiveListener: g_RegisterClientActiveListener,
	RegisterClientConnectListener: g_RegisterClientConnectListener,
	RegisterClientDisconnectListener: g_RegisterClientDisconnectListener,
	RegisterClientFullyConnectListener: g_RegisterClientFullyConnectListener,
	RegisterClientPutInServerListener: g_RegisterClientPutInServerListener,
	RegisterClientSettingsChangedListener: g_RegisterClientSettingsChangedListener,
	RegisterCombinerPreCacheListener: g_RegisterCombinerPrecacheListener,
	RegisterConVarChangedListener: g_RegisterConVarChangedListener,
	RegisterDataLoadedListener: g_RegisterDataLoadedListener,
	RegisterDataUnloadedListener: g_RegisterDataUnloadedListener,
	RegisterEdictAllocatedListener: g_RegisterEdictAllocatedListener,
	RegisterEdictFreedListener: g_RegisterEdictFreedListener,
	RegisterEntityCollisionListener: g_RegisterEntityCollisionListener,
	RegisterEntityCreatedListener: g_RegisterEntityCreatedListener,
	RegisterEntityDeletedListener: g_RegisterEntityDeletedListener,
	RegisterEntityOutputListener: g_RegisterEntityOutputListener,
	RegisterEntityPreSpawnedListener: g_RegisterEntityPreSpawnedListener,
	RegisterEntitySpawnedListener: g_RegisterEntitySpawnedListener,
	RegisterEntityTransmitListener: g_RegisterEntityTransmitListener,
	RegisterLevelEndListener: g_RegisterLevelEndListener,
	RegisterLevelInitListener: g_RegisterLevelInitListener,
	RegisterLevelShutdownListener: g_RegisterLevelShutdownListener,
	RegisterNetworkIDValidatedListener: g_RegisterNetworkIDValidatedListener,
	RegisterNetworkedEntityCreatedListener: g_RegisterNetworkedEntityCreatedListener,
	RegisterNetworkedEntityDeletedListener: g_RegisterNetworkedEntityDeletedListener,
	RegisterNetworkedEntityPreSpawnedListener: g_RegisterNetworkedEntityPreSpawnedListener,
	RegisterNetworkedEntitySpawnedListener: g_RegisterNetworkedEntitySpawnedListener,
	RegisterPlayerCollisionListener: g_RegisterPlayerCollisionListener,
	RegisterPlayerPostRunCommandListener: g_RegisterPlayerPostRunCommandListener,
	RegisterPlayerRunCommandListener: g_RegisterPlayerRunCommandListener,
	RegisterPlayerTransmitListener: g_RegisterPlayerTransmitListener,
	RegisterPluginLoadedListener: g_RegisterPluginLoadedListener,
	RegisterPluginLoadingListener: g_RegisterPluginLoadingListener,
	RegisterPluginUnloadedListener: g_RegisterPluginUnloadedListener,
	RegisterPluginUnloadingListener: g_RegisterPluginUnloadingListener,
	RegisterQueryCVarValueFinishedListener: g_RegisterQueryCVarValueFinishedListener,
	RegisterServerActivateListener: g_RegisterServerActivateListener,
	RegisterServerOutputListener: g_RegisterServerOutputListener,
	RegisterTickListener: g_RegisterTickListener,
	RegisterVersionUpdateListener: g_RegisterVersionUpdateListener,
};
