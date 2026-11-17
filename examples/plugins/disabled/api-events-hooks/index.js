"use strict";

const { BitBufferRead, BitBufferWrite, PackUInt32 } = require("bitbuffers");
const { Color } = require("colors");
const { TempEntityPreHook } = require("effects/hooks");
const { CreateCustomEvent, CreateEventPayload, CreateEventResourceText } = require("events");
const { CreateEventResourceText: g_CreateCustomEventResourceText } = require("events/custom");
const { FireEvent, RegisterEventListener, UnregisterEventListener } = require("events/listener");
const { EventListener, EventManager } = require("events/manager");
const { EventResourceFile } = require("events/resource");
const {
	BoolVariable,
	ByteVariable,
	FloatVariable,
	GetEventVariableTypes,
	ShortVariable,
	StringVariable,
} = require("events/variable");
const { DoesFileExist, RemoveFile } = require("filesystem");
const { KeyValues, CreateKeyValues } = require("keyvalues");
const { Address, Convention, DataType, Register } = require("memory");
const { ADDRESS_SIZE, CALLING_CONVENTIONS, Address: g_NormalizeAddress } = require("memory/helpers");
const {
	CallFunction,
	CreateFunctionHook,
	GetHooksDisabled,
	GetHookList,
	RemoveHook,
} = require("memory/hooks");
const { GetEntityHookList } = require("memory/hooks/entities");
const {
	EventAction,
	FireEventHookOptions,
	GetInt,
	GetPreEventHook,
	IsPreEventHookInstalled,
	ManagerAddress,
	OffPre,
	OnPre,
	SetInt,
} = require("memory/hooks/events");
const { Off: g_OffException, On: g_OnExceptionHook } = require("memory/hooks/exceptions");
const g_MessageHooksAPI = require("memory/hooks/messages");
const { Off: g_OffWarning, On: g_OnWarningHook } = require("memory/hooks/warnings");
const {
	ARCHITECTURE,
	GetAllBinaries,
	GetAllGameDataFiles,
	GetBinary,
	GetBinarySymbol,
	PLATFORM,
	ScanBinary,
} = require("memory/manager");
const {
	EmitListenerEvent,
	RegisterLevelInitListener,
	RegisterPluginUnloadingListener,
	ClientConnectManager,
} = require("listeners");
const { TickDelay } = require("listeners/tick");
const { LogError, LogInfo, LogWarning } = require("loggers");
const { RegisterCommand, UnregisterCommand } = require("source");

const g_strPluginName = "api-events-hooks";
const g_strCommandName = "sjs_api_hooks";
const g_unPreviewEntryLimit = 8;
const g_unDelaySeconds = 60;
const g_unBitBufferByteCount = 256;
const g_mapInstalledHooks = new Map();
const g_setPendingResources = new Set();
let g_bCleaning = false;

function TrackResource(strName, Release) {
	const Resource = { Name: strName, Release: Release, Releasing: false };
	g_setPendingResources.add(Resource);

	return Resource;
}

function ReleaseResource(Resource) {
	if (!g_setPendingResources.has(Resource) || Resource.Releasing) {
		return;
	}

	Resource.Releasing = true;
	try {
		if (Resource.Release() !== true) {
			throw new Error(`Could not release ${Resource.Name}.`);
		}

		g_setPendingResources.delete(Resource);
	} finally {
		Resource.Releasing = false;
	}
}

function UseResource(strName, Release, Use) {
	const Resource = TrackResource(strName, Release);
	let bOperationFailed = false;
	let OperationError = undefined;
	try {
		return Use();
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
		throw CaughtError;
	} finally {
		try {
			ReleaseResource(Resource);
		} catch (CleanupError) {
			if (bOperationFailed) {
				throw new AggregateError([OperationError, CleanupError], `${strName} operation and cleanup failed.`);
			}

			throw CleanupError;
		}
	}
}

function ReleaseKeyValuesResource(KeyValuesInstance) {
	if (KeyValuesInstance.Handle === null) {
		return true;
	}

	const bDestroyed = KeyValuesInstance.DestroyKeyValues();

	return bDestroyed || (KeyValuesInstance.Handle === null);
}

function CreateHookOptions(unAddress) {
	return { Address: unAddress, Convention: Convention.Fastcall, ReturnType: DataType.Int, Arguments: [DataType.Address] };
}

function OnLevelInitialize(strMapName) {
	LogInfo("%s", `Level initialization: ${strMapName}`);
}

function OnPlayerDeath(Event) {
	LogInfo("%s", `${Event.EventName}: Address=${Event.Address}, UserID=${Event.GetEventInteger("userid", 0)}`);
}

function OnPrePlayerDeath(Context) {
	const nUserID = GetInt(Context.Address, "userid", 0);
	if (!SetInt(Context.Address, "userid", nUserID)) {
		throw new Error("Unable to write the player_death userid field.");
	}

	LogInfo("%s", `Pre-event ${Context.Name}: Address=${Context.Address}, UserID=${nUserID}`);

	return EventAction.Continue;
}

function OnWarning(WarningRecord) {
	LogWarning("%s", `Warning event: ${WarningRecord.Category}: ${WarningRecord.Message}`);
}

function OnException(Exception) {
	LogError("%s", `Exception event: ${Exception.Name}: ${Exception.Message}`);
}

function LogResult(strLabel, Callback) {
	const Value = Callback();
	LogInfo("%s", `${strLabel}: ${String(Value)}`);

	return Value;
}

function InspectTickAPI() {
	const TickDelayInstance = new TickDelay(g_unDelaySeconds, () => undefined, [], true);

	return UseResource("demo tick delay", () => !TickDelayInstance.Running || TickDelayInstance.DisposeTickDelay(), () => ({ Running: TickDelayInstance.Running, TimeRemainingSeconds: TickDelayInstance.TimeRemainingSeconds }));
}

function InspectEventAndHookAPI() {
	LogResult("listeners.EmitListenerEvent", () => EmitListenerEvent("APIEventsHooksPing", "ok"));
	LogResult("listeners/tick.TickDelay", InspectTickAPI);
	LogResult("listeners.ClientConnectManager registration", () => {
		const Callback = () => undefined;
		ClientConnectManager.RegisterListener(Callback);

		return UseResource("demo client listener", () => ClientConnectManager.UnregisterListener(Callback), () => ({ Registered: ClientConnectManager.HasListener(Callback), ListenerCount: ClientConnectManager.ListenerCount }));
	});
	LogResult("events.CreateEventPayload", () => CreateEventPayload({ UserID: "short" }, { UserID: 1 }));
	LogResult("events.RegisterEventListener/UnregisterEventListener", () => {
		const Callback = () => {};
		if (!RegisterEventListener("player_death", Callback)) {
			throw new Error("Unable to register the player_death example listener.");
		}

		UseResource("demo player_death listener", () => UnregisterEventListener("player_death", Callback), () => undefined);

		return { Registered: true, Removed: true };
	});
	LogResult("events.CreateCustomEvent", () => {
		const Variables = { Enabled: new BoolVariable("Enabled", true), Message: new StringVariable("Message", "hello"), UserID: new ShortVariable("UserID", 0) };
		const Event = CreateCustomEvent("SourceJSAPIExample", Variables);

		return { Event, Payload: CreateEventPayload(Variables, { UserID: 1 }), ResourceText: CreateEventResourceText("SourceJSAPIExample", Variables) };
	});
	LogResult("events/variable classes", () => {
		const BoolVariableInstance = new BoolVariable("Flag", true);

		return {
			Bool: { DefaultValue: BoolVariableInstance.DefaultValue, SetterType: BoolVariableInstance.SetterType, Type: BoolVariableInstance.Type },
			ByteSetterType: new ByteVariable("Byte", 7).SetterType,
			Float: new FloatVariable("Scale", 1.25).DefineEventVariable("Scale"),
			Types: GetEventVariableTypes(),
		};
	});
	LogResult("events/custom.CreateEventResourceText", () => g_CreateCustomEventResourceText("SourceJSAPIExample", { Message: "string" }));
	LogResult("events/resource.EventResourceFile", () => {
		const ResourceFile = new EventResourceFile("sourcejs/api-events-hooks", {
			EventName: "SourceJSAPIExample",
			EventVariables: { Enabled: new BoolVariable("Enabled", true), Message: new StringVariable("Message", "hello"), UserID: new ShortVariable("UserID", 0) },
		});
		const strResourcePath = ResourceFile.FullEventResourceFilePath;
		// This isolated demo requires no concurrent writers; the existence check is not an exclusive reservation.
		if (DoesFileExist(strResourcePath)) {
			throw new Error(`Refusing to overwrite the existing event resource: ${strResourcePath}`);
		}

		return UseResource("demo event resource file", () => !DoesFileExist(strResourcePath) || RemoveFile(strResourcePath), function UseEventResourceFile() {
			const strWrittenPath = ResourceFile.WriteEventResourceFile();

			return {
				LoadedCount: ResourceFile.LoadEventsFromFile(),
				WrittenPath: strWrittenPath,
				Preview: ResourceFile.CreateEventResourceText().split("\n").slice(0, g_unPreviewEntryLimit).join(" | "),
				Count: ResourceFile.EventResourceCount,
			};
		});
	});
	LogResult("memory/hooks/events FireEventHookOptions", () => FireEventHookOptions());
	LogResult("memory/hooks/events native hook status", () => ({ Hook: GetPreEventHook(), Installed: IsPreEventHookInstalled(), ManagerAddress: ManagerAddress() }));
	LogResult("events/listener live dispatch", () => {
		let Observed = null;

		function InspectEvent(Event) {
			Observed = { Name: Event.EventName, Address: Event.Address, Value: Event.GetEventInteger("UserID", 0) };
		}

		if (!RegisterEventListener("SourceJSAPIExample", InspectEvent)) {
			throw new Error("Unable to register the listener probe.");
		}

		return UseResource("demo live event listener", () => UnregisterEventListener("SourceJSAPIExample", InspectEvent), function FireDemoEvent() {
			if (!FireEvent("SourceJSAPIExample", { UserID: 7 }, true)) {
				throw new Error("Unable to fire the listener probe.");
			}

			return Observed;
		});
	});
	LogResult("events/manager local dispatch", () => {
		const vecEventListenerInstance = new EventListener("SourceJSAPILocalProbe");
		const mapEventManagerInstance = new EventManager();
		let nObservedValue = null;

		function InspectEvent(Event) {
			nObservedValue = Event.GetEventValue("Value", 0);
		}

		vecEventListenerInstance.AppendEventCallback(InspectEvent);

		return UseResource("demo local event callback", () => vecEventListenerInstance.RemoveEventCallback(InspectEvent) === InspectEvent, function DispatchDemoEvent() {
			const bDispatched = vecEventListenerInstance.DispatchGameEvent({
				EventName: "SourceJSAPILocalProbe",
				GetEventValue(strKey, DefaultValue) {
					return (strKey === "Value") ? 11 : DefaultValue;
				},
			});

			return { Dispatched: bDispatched, EmptyManagerDispatch: mapEventManagerInstance.DispatchEvent("SourceJSAPILocalProbe", { Value: 12 }), ObservedValue: nObservedValue };
		});
	});
	LogResult("keyvalues.KeyValues object", () => {
		const KeyValuesInstance = CreateKeyValues("SourceJS", {
			Enabled: true,
			Plugin: g_strPluginName,
			RetryCount: 3,
			Nested: {
				Label: "events-hooks",
			},
		});

		return UseResource("demo KeyValues", () => ReleaseKeyValuesResource(KeyValuesInstance), function InspectKeyValues() {
			const ScaleKeyValues = KeyValuesInstance.SetKeyValuesFloat("Scale", 1.25);
			ReleaseResource(TrackResource("demo Scale child", () => ReleaseKeyValuesResource(ScaleKeyValues)));

			const ColorKeyValues = KeyValuesInstance.SetKeyValuesColor("Color", new Color(64, 192, 255));
			ReleaseResource(TrackResource("demo Color child", () => ReleaseKeyValuesResource(ColorKeyValues)));

			const AddressKeyValues = KeyValuesInstance.SetKeyValuesAddress("Address", 0x1234n);
			ReleaseResource(TrackResource("demo Address child", () => ReleaseKeyValuesResource(AddressKeyValues)));

			const ColorValue = KeyValuesInstance.GetKeyValuesColor("Color");
			const Values = KeyValuesInstance.ConvertKeyValuesToObject();

			return {
				Enabled: KeyValuesInstance.GetKeyValuesBoolean("Enabled"),
				Color: { Alpha: ColorValue.Alpha, Blue: ColorValue.Blue, Green: ColorValue.Green, Red: ColorValue.Red },
				ColorHex: ColorValue.ConvertColorToHexString(),
				Keys: [...KeyValuesInstance],
				NestedLabel: Values.Nested.Label,
				Values,
				Address: KeyValuesInstance.GetKeyValuesAddress("Address"),
			};
		});
	});
	LogResult("keyvalues.VDF roundtrip", () => {
		const KeyValuesInstance = CreateKeyValues("SourceJS", { Plugin: g_strPluginName, RetryCount: 3 });

		return UseResource("demo VDF source", () => ReleaseKeyValuesResource(KeyValuesInstance), function ConvertDemoKeyValues() {
			const ParsedKeyValues = KeyValues.CreateKeyValuesFromBuffer(KeyValuesInstance.ConvertKeyValuesToString());

			return UseResource("demo parsed VDF", () => ReleaseKeyValuesResource(ParsedKeyValues), () => ParsedKeyValues.ConvertKeyValuesToObject());
		});
	});
	LogResult("bitbuffers.PackUInt32", () => PackUInt32(0x12345678));
	LogResult("bitbuffers.BitBuffer primitive roundtrip", () => {
		const Writer = new BitBufferWrite(g_unBitBufferByteCount);
		Writer.WriteByte(255);
		Writer.WriteShort(-1234);
		Writer.WriteLong(0x12345678);
		Writer.WriteFloat(3.5);
		Writer.WriteString("sjs");

		const Reader = new BitBufferRead(Writer);

		return {
			Byte: Reader.ReadByte(),
			Short: Reader.ReadShort(),
			Long: Reader.ReadLong(),
			Float: Number(Reader.ReadFloat().toFixed(2)),
			Value: Reader.ReadString(),
			WrittenBitCount: Writer.WrittenBitCount,
			WrittenByteCount: Writer.WrittenByteCount,
			RemainingBitCount: Reader.RemainingBitCount,
		};
	});
	LogResult("bitbuffers.BitBuffer coordinate roundtrip", () => {
		const Writer = new BitBufferWrite(g_unBitBufferByteCount);
		Writer.WriteBitCoord(-12.25);
		Writer.WriteBitVec3Coord([1.5, -2.25, 0]);
		Writer.WriteBitNormal(-0.5);

		const Reader = new BitBufferRead(Writer);
		const flCoordinate = Reader.ReadBitCoord();
		const CoordinateVector = Reader.ReadBitVec3Coord();
		const flNormal = Reader.ReadBitNormal();

		return { Coordinate: flCoordinate, Vector: CoordinateVector, Normal: Number(flNormal.toFixed(3)), Overflowed: Reader.IsOverflowed() };
	});
	LogResult("memory/helpers.ADDRESS_SIZE", () => ADDRESS_SIZE);
	LogResult("memory.Address BigInt", () => new Address(0x1000n).GetMemoryAddress());
	LogResult("memory/helpers.Address BigInt", () => g_NormalizeAddress(0x1000n));
	LogResult("memory/helpers.CALLING_CONVENTIONS", () => CALLING_CONVENTIONS);
	LogResult("memory/manager.PLATFORM", () => PLATFORM);
	LogResult("memory/manager.ARCHITECTURE", () => ARCHITECTURE);
	LogResult("memory/manager.GetAllGameDataFiles", () => GetAllGameDataFiles());
	LogResult("memory/manager.GetAllBinaries", () => GetAllBinaries().slice(0, g_unPreviewEntryLimit));
	LogResult("memory/hooks.GetHooksDisabled", () => GetHooksDisabled());
	LogResult("memory/hooks.GetHookList", () => GetHookList());
	LogResult("memory/hooks/entities.GetEntityHookList", () => GetEntityHookList());
	LogResult("effects/hooks.TempEntityPreHook", () => {
		const Hook = new TempEntityPreHook("BeamPoints");
		const Callback = () => true;
		Hook.RegisterTemporaryEntityHook(Callback);

		return UseResource("demo temporary-entity hook", () => Hook.UnregisterTemporaryEntityHook(), () => ({ Phase: Hook.Phase, Registered: Hook.Callback === Callback, TemporaryEntityName: Hook.Template.Name }));
	});
	LogResult("memory/hooks/messages backend", () => ({ Backend: g_MessageHooksAPI.Backend(), BitBufferBeginInstalled: g_MessageHooksAPI.HOOK_STATUS.BitBufferBeginInstalled, BitBufferEndInstalled: g_MessageHooksAPI.HOOK_STATUS.BitBufferEndInstalled, ProtobufSendInstalled: g_MessageHooksAPI.HOOK_STATUS.ProtobufSendInstalled }));
}

function GetCommandArguments(InputCommand) {
	return InputCommand.Arguments.slice(1);
}

function ConvertStringToAddress(strValue) {
	try {
		const unAddress = BigInt(strValue);
		const unMaximumAddress = (1n << BigInt(ADDRESS_SIZE * 8)) - 1n;
		if ((unAddress <= 0n) || (unAddress > unMaximumAddress)) {
			return null;
		}

		return unAddress;
	} catch {
		return null;
	}
}

function CreateCallOptions(unFunctionAddress, unThisObjectAddress) {
	return {
		Address: unFunctionAddress,
		Convention: Convention.Fastcall,
		ReturnType: DataType.Int,
		ThisObject: unThisObjectAddress,
		Registers: { [(ADDRESS_SIZE === 8) ? Register.RCX : Register.ECX]: unThisObjectAddress },
		Arguments: [
			{ Type: DataType.Int, Value: 7 },
			{ Type: DataType.String, Value: "SourceJS" },
		],
		ReturnContext: true,
	};
}

function SummarizeValue(Value) {
	if (typeof Value === "number") {
		return String(Value);
	}

	if (Array.isArray(Value)) {
		return `${Value.length} entries`;
	}

	if (Value && (typeof Value === "object")) {
		return `{ ${Object.keys(Value).slice(0, g_unPreviewEntryLimit).join(", ")} }`;
	}

	return String(Value);
}

function RunHookExample(InputCommand) {
	const vecCommandArguments = GetCommandArguments(InputCommand);
	if (vecCommandArguments[0] === "call") {
		const unAddress = ConvertStringToAddress(vecCommandArguments[1]);
		const unThisObjectAddress = ConvertStringToAddress(vecCommandArguments[2]);
		if ((vecCommandArguments.length !== 4) || (unAddress === null) || (unThisObjectAddress === null) || (vecCommandArguments[3] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} call <address> <this-address> confirm".`);
			return;
		}

		LogResult("memory/hooks.CallFunction", () => {
			const Invocation = CallFunction(CreateCallOptions(unAddress, unThisObjectAddress));
			if ((Invocation === null) || (typeof Invocation !== "object")) {
				LogWarning("The native ABI call did not return an execution context.");
				return Invocation;
			}

			const strDataRegisterName = (ADDRESS_SIZE === 8) ? "RDX" : "EDX";
			LogInfo(`Return value: ${String(Invocation.ReturnValue)}`);
			LogInfo(`${strDataRegisterName}: ${String(Invocation.Registers[strDataRegisterName])}`);

			return Invocation;
		});
		return;
	}

	if ((vecCommandArguments[0] === "pre") || (vecCommandArguments[0] === "post")) {
		const unAddress = ConvertStringToAddress(vecCommandArguments[1]);
		const bUseTrampoline = (vecCommandArguments[0] === "pre") && (vecCommandArguments.length === 4) && (vecCommandArguments[2] === "trampoline");
		const bValidSyntax = ((vecCommandArguments.length === 3) && (vecCommandArguments[2] === "confirm")) || (bUseTrampoline && (vecCommandArguments[3] === "confirm"));
		if ((unAddress === null) || !bValidSyntax) {
			LogWarning(`Use "${g_strCommandName} pre <address> [trampoline] confirm" or "${g_strCommandName} post <address> confirm".`);
			return;
		}

		const HookOptions = CreateHookOptions(unAddress);
		const setPreviousHookIDs = new Set(GetHookList().map((HookRecord) => HookRecord.ID));
		const Callback = (HookContext) => {
			LogInfo("%s", `${vecCommandArguments[0]} hook fired: ${SummarizeValue(HookContext)}`);

			if (bUseTrampoline) {
				const Invocation = HookContext.CallHookTrampoline({ Arguments: [...HookContext.Arguments], Registers: { ...HookContext.Registers } });
				if ((Invocation === null) || (typeof Invocation !== "object")) {
					LogWarning("The hook trampoline did not return an execution context.");
					return;
				}

				const strDataRegisterName = (ADDRESS_SIZE === 8) ? "RDX" : "EDX";
				LogInfo(`Trampoline return value: ${String(Invocation.ReturnValue)}`);
				LogInfo(`Trampoline ${strDataRegisterName}: ${String(Invocation.Registers[strDataRegisterName])}`);

				return Invocation.ReturnValue;
			}
		};
		const Hook = CreateFunctionHook(HookOptions);
		if ((Hook === null) || (typeof Hook !== "object")) {
			throw new Error("Unable to create the native function hook; verify the address and target ABI.");
		}

		if (setPreviousHookIDs.has(Hook.ID)) {
			throw new Error(`Hook ID ${Hook.ID} already exists; the example will not take ownership of it.`);
		}

		const unHookID = Hook.ID;
		const Resource = TrackResource(`hook ID ${unHookID}`, function RemoveOwnedHook() {
			const bRemoved = RemoveHook(unHookID);
			if (bRemoved) {
				g_mapInstalledHooks.delete(unHookID);
			}

			return bRemoved;
		});
		g_mapInstalledHooks.set(unHookID, Resource);

		try {
			const bCallbackRegistered = (vecCommandArguments[0] === "pre") ? Hook.Pre(Callback) : Hook.Post(Callback);
			if (!bCallbackRegistered) {
				throw new Error(`Unable to register the ${vecCommandArguments[0]} hook callback.`);
			}
		} catch (ErrorValue) {
			try {
				ReleaseResource(Resource);
			} catch (CleanupError) {
				throw new AggregateError([ErrorValue, CleanupError], `Hook ID ${unHookID} callback registration and cleanup failed.`);
			}

			throw ErrorValue;
		}

		LogInfo(`Installed ${vecCommandArguments[0]} hook ID ${Hook.ID}.`);
		return;
	}

	if (vecCommandArguments[0] === "remove") {
		const unMaximumHookID = 2147483647;
		const unHookID = Number(vecCommandArguments[1]);
		if ((vecCommandArguments.length !== 2) || !Number.isInteger(unHookID) || (unHookID <= 0) || (unHookID > unMaximumHookID)) {
			LogWarning(`Use "${g_strCommandName} remove <hook-id>".`);
			return;
		}

		const bRemoved = RemoveHook(unHookID);
		if (bRemoved) {
			g_setPendingResources.delete(g_mapInstalledHooks.get(unHookID));
			g_mapInstalledHooks.delete(unHookID);
		}

		LogResult("memory/hooks.RemoveHook", () => bRemoved);
		return;
	}

	if (vecCommandArguments[0] === "symbol") {
		if (vecCommandArguments.length > 3) {
			LogWarning(`Use "${g_strCommandName} symbol [module] [symbol]".`);
			return;
		}

		const strModuleName = vecCommandArguments[1] || "server";
		const strSymbolName = vecCommandArguments[2] || "_ZN16CCoreDispSurface4InitEv";
		LogResult(`memory/manager.GetBinarySymbol ${strModuleName} ${strSymbolName}`, () => GetBinarySymbol(strModuleName, strSymbolName));
		return;
	}

	if (vecCommandArguments[0] === "scan") {
		const strModuleName = vecCommandArguments[1] || "server";
		const strPattern = vecCommandArguments.slice(2).join(" ");
		if (!strPattern) {
			LogWarning(`Use "${g_strCommandName} scan <module> <signature bytes>".`);
			return;
		}

		LogResult(`memory/manager.ScanBinary ${strModuleName}`, () => ScanBinary(strModuleName, strPattern));
		return;
	}

	if (vecCommandArguments[0] === "binary") {
		if (vecCommandArguments.length > 2) {
			LogWarning(`Use "${g_strCommandName} binary [module]".`);
			return;
		}

		const strModuleName = vecCommandArguments[1] || "server";
		LogResult(`memory/manager.GetBinary ${strModuleName}`, () => GetBinary(strModuleName));
		return;
	}

	if (vecCommandArguments.length !== 0) {
		LogWarning(`Use "${g_strCommandName} [call|pre|post|remove|symbol|scan|binary ...]".`);
		return;
	}

	InspectEventAndHookAPI();
	LogInfo(`Use "${g_strCommandName} call <address> <this-address> confirm".`);
	LogInfo(`Use "${g_strCommandName} pre <address> trampoline confirm".`);
	LogInfo(`Use "${g_strCommandName} symbol server _ZN16CCoreDispSurface4InitEv".`);
	LogInfo(`Use "${g_strCommandName} scan server 55 8B EC ? ?".`);
}

function Cleanup() {
	if (g_bCleaning) {
		return;
	}

	g_bCleaning = true;
	const vecErrors = [];
	try {
		for (const Resource of [...g_setPendingResources].reverse()) {
			try {
				ReleaseResource(Resource);
			} catch (CleanupError) {
				vecErrors.push(CleanupError);
			}
		}
	} finally {
		g_bCleaning = false;
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "Event/hook example cleanup failed.");
	}
}

function HandlePluginUnloading(strUnloadingPluginName) {
	if (strUnloadingPluginName === g_strPluginName) {
		Cleanup();
	}
}

exports.Unload = Cleanup;

try {
	if (!RegisterCommand(g_strCommandName, RunHookExample)) {
		throw new Error(`Unable to register the ${g_strCommandName} command.`);
	}

	TrackResource(`the ${g_strCommandName} command`, () => UnregisterCommand(g_strCommandName, RunHookExample));

	const LevelInitializationRegistration = RegisterLevelInitListener(OnLevelInitialize);
	if (!LevelInitializationRegistration) {
		throw new Error("Unable to register the LevelInit listener.");
	}

	TrackResource("the LevelInit listener", () => LevelInitializationRegistration.Disposed || LevelInitializationRegistration.DisposeListener());
	const PluginUnloadingRegistration = RegisterPluginUnloadingListener(HandlePluginUnloading);
	if (!PluginUnloadingRegistration) {
		throw new Error("Unable to register the plugin-unloading listener.");
	}

	TrackResource("the plugin-unloading listener", () => PluginUnloadingRegistration.Disposed || PluginUnloadingRegistration.DisposeListener());

	if (!RegisterEventListener("player_death", OnPlayerDeath)) {
		throw new Error("Unable to register the player_death listener.");
	}

	TrackResource("the player_death listener", () => UnregisterEventListener("player_death", OnPlayerDeath));
	OnPre("player_death", OnPrePlayerDeath);
	TrackResource("the player_death pre-hook", () => OffPre("player_death", OnPrePlayerDeath));
	g_OnWarningHook(OnWarning);
	TrackResource("the warning listener", () => g_OffWarning(OnWarning));
	g_OnExceptionHook(OnException);
	TrackResource("the exception listener", () => g_OffException(OnException));

	LogWarning("Native call/pre/post example signatures are placeholders; verify the target ABI, live addresses and object lifetimes before use.");
	LogInfo(`Plugin loaded; run "${g_strCommandName}".`);
} catch (ErrorValue) {
	try {
		Cleanup();
	} catch (CleanupError) {
		throw new AggregateError([ErrorValue, CleanupError], "Event/hook example startup and cleanup failed.");
	}

	throw ErrorValue;
}
