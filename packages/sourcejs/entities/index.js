"use strict";

const { GetModule } = require("internal/runtime");
const { RepeatingTickTask, RepeatingTickTaskStatus, TickDelay } = require("listeners/tick");
const g_SoundAPI = require("engines/sound");
const g_StudioCacheRuntime = require("studio/cache");
const g_EntityDataMaps = require("entities/datamaps");
const g_EntityClasses = require("entities/classes");

const g_EntitiesRuntime = GetModule("entities");
const g_mapTrackedDelays = new Map();
const g_mapTrackedRepeats = new Map();

function ResolveEntityIndex(EntityReference) {
	const unResolvedEntityIndex = (typeof EntityReference === "number") ? EntityReference : EntityReference?.Index;
	if (!Number.isInteger(unResolvedEntityIndex) || (unResolvedEntityIndex < 0)) {
		throw new TypeError("Entity operations require an integer entity index or an object with an integer Index getter.");
	}

	return unResolvedEntityIndex;
}

function DefineEntityMethod(EntityObject, strMethodName, Callback) {
	if ((EntityObject === null) || (typeof EntityObject !== "object") || (strMethodName in EntityObject)) {
		return;
	}

	Object.defineProperty(EntityObject, strMethodName, { configurable: true, enumerable: false, value: Callback, writable: true });
}

function AddTrackedTimer(mapTimerRegistry, unEntityIndex, Timer) {
	let setEntityTimers = mapTimerRegistry.get(unEntityIndex);
	if (setEntityTimers === undefined) {
		setEntityTimers = new Set();
		mapTimerRegistry.set(unEntityIndex, setEntityTimers);
	}

	setEntityTimers.add(Timer);
}

function RemoveTrackedTimer(mapTimerRegistry, unEntityIndex, Timer) {
	const setEntityTimers = mapTimerRegistry.get(unEntityIndex);
	if (setEntityTimers === undefined) {
		return;
	}

	setEntityTimers.delete(Timer);

	if (setEntityTimers.size === 0) {
		mapTimerRegistry.delete(unEntityIndex);
	}
}

function GetFilteredEntityFields(EntityReference, FieldPredicate) {
	const EntityDataMap = g_EntityDataMaps.GetEntityDataMap(EntityReference);
	if (EntityDataMap === null) {
		return [];
	}

	const vecEntityFields = g_EntityDataMaps.GetEntityDataMapFields(EntityDataMap, true);
	const vecMatchingEntityFields = [];
	for (const EntityField of vecEntityFields) {
		if (FieldPredicate(EntityField)) {
			vecMatchingEntityFields.push(EntityField);
		}
	}

	return vecMatchingEntityFields;
}

function IsEntityNetworked(EntityReference) {
	return Boolean(g_EntityClasses.GetServerClass(EntityReference));
}

function GetEntityServerClasses(EntityReference) {
	const ServerClass = g_EntityClasses.GetServerClass(EntityReference);
	if (ServerClass === null) {
		return [];
	}

	const vecServerClasses = [ServerClass];
	const vecBaseClassNames = g_EntityClasses.GetBaseClassNames(ServerClass);
	for (const strBaseClassName of vecBaseClassNames) {
		const BaseServerClass = g_EntityClasses.SERVER_CLASSES.Get(strBaseClassName);
		if (BaseServerClass !== undefined) {
			vecServerClasses.push(BaseServerClass);
		}
	}

	return vecServerClasses;
}

function GetEntityProperties(EntityReference) {
	return g_EntityClasses.GetServerClassProperties(EntityReference);
}

function GetEntityInputs(EntityReference) {
	return GetFilteredEntityFields(EntityReference, (EntityField) => Boolean(EntityField.Input));
}

function GetEntityOutputs(EntityReference) {
	return GetFilteredEntityFields(EntityReference, (EntityField) => Boolean(EntityField.Output));
}

function GetEntityKeyValues(EntityReference) {
	return GetFilteredEntityFields(EntityReference, (EntityField) => Boolean(EntityField.Key));
}

function GetEntityDynamicAttributes(EntityReference) {
	return {
		Inputs: GetEntityInputs(EntityReference),
		KeyValues: GetEntityKeyValues(EntityReference),
		Outputs: GetEntityOutputs(EntityReference),
		Properties: GetEntityProperties(EntityReference),
		ServerClasses: GetEntityServerClasses(EntityReference),
	};
}

function GetEntityInput(EntityReference, strInputName) {
	const EntityDataMap = g_EntityDataMaps.GetEntityDataMap(EntityReference);
	const EntityInputField = (EntityDataMap === null) ? null : g_EntityDataMaps.FindEntityDataMapField(EntityDataMap, strInputName);

	return ((EntityInputField !== null) && EntityInputField.Input) ? g_EntityDataMaps.GetEntityInputFunction(EntityReference, EntityInputField) : null;
}

function GetEntityOutput(EntityReference, strOutputName) {
	const EntityDataMap = g_EntityDataMaps.GetEntityDataMap(EntityReference);
	const EntityOutputField = (EntityDataMap === null) ? null : g_EntityDataMaps.FindEntityDataMapField(EntityDataMap, strOutputName);

	return ((EntityOutputField !== null) && EntityOutputField.Output) ? EntityOutputField : null;
}

function CallEntityInputFunction(EntityReference, strInputName, InputValue = undefined, flInputDelay = 0) {
	return g_EntitiesRuntime.CallInput(EntityReference, strInputName, InputValue, flInputDelay);
}

function ResolveTimerCancelOnLevelEnd(TimerOptions) {
	if ((TimerOptions === null) || (typeof TimerOptions !== "object") || Array.isArray(TimerOptions)) {
		throw new TypeError("Timer options must be an object.");
	}

	const bProvidedCancelOnLevelEnd = TimerOptions.CancelOnLevelEnd;
	const bCancelOnLevelEnd = (bProvidedCancelOnLevelEnd === undefined) ? false : bProvidedCancelOnLevelEnd;
	if (typeof bCancelOnLevelEnd !== "boolean") {
		throw new TypeError("Timer CancelOnLevelEnd must be a boolean.");
	}

	return bCancelOnLevelEnd;
}

function DelayEntityCallback(EntityReference, flDelaySeconds, Callback, vecCallbackArguments = [], DelayOptions = {}) {
	const unEntityIndex = ResolveEntityIndex(EntityReference);
	const bCancelOnLevelEnd = ResolveTimerCancelOnLevelEnd(DelayOptions);
	if (typeof Callback !== "function") {
		throw new TypeError("Callback must be a function.");
	}

	const DelayTimer = new TickDelay(flDelaySeconds, (...vecInvocationArguments) => {
		RemoveTrackedTimer(g_mapTrackedDelays, unEntityIndex, DelayTimer);

		return Callback.apply(EntityReference, vecInvocationArguments);
	}, vecCallbackArguments, bCancelOnLevelEnd);
	const CancelScheduledDelay = DelayTimer.CancelTickDelay;
	Object.defineProperty(DelayTimer, "CancelTickDelay", {
		configurable: true,
		value: function CancelEntityTickDelay() {
			const bCancelResult = CancelScheduledDelay.call(this);
			if (this === DelayTimer) {
				RemoveTrackedTimer(g_mapTrackedDelays, unEntityIndex, DelayTimer);
			}

			return bCancelResult;
		},
		writable: true,
	});
	const CancelDelayTimer = DelayTimer.DisposeTickDelay.bind(DelayTimer);
	DelayTimer.Cancel = () => {
		const bCancelResult = CancelDelayTimer();
		RemoveTrackedTimer(g_mapTrackedDelays, unEntityIndex, DelayTimer);

		return bCancelResult;
	};
	Object.defineProperty(DelayTimer, "CallDelay", { configurable: true, value: DelayTimer.InvokeTickDelayCallback.bind(DelayTimer), writable: true });

	AddTrackedTimer(g_mapTrackedDelays, unEntityIndex, DelayTimer);

	return DelayTimer;
}

function RepeatEntityCallback(EntityReference, Callback, vecCallbackArguments = [], RepeatOptions = {}) {
	const unEntityIndex = ResolveEntityIndex(EntityReference);
	const bCancelOnLevelEnd = ResolveTimerCancelOnLevelEnd(RepeatOptions);
	if (typeof Callback !== "function") {
		throw new TypeError("Callback must be a function.");
	}

	const RepeatCallback = (...vecInvocationArguments) => {
		try {
			return Callback.apply(EntityReference, vecInvocationArguments);
		} finally {
			if (RepeatTimer.RepeatingTickTaskStatus === RepeatingTickTaskStatus.STOPPED) {
				RemoveTrackedTimer(g_mapTrackedRepeats, unEntityIndex, RepeatTimer);
			}
		}
	};
	const RepeatTimer = new RepeatingTickTask(RepeatCallback, vecCallbackArguments, bCancelOnLevelEnd);
	const StartRepeatTimer = RepeatTimer.StartRepeatingTickTask;
	const StopRepeatTimer = RepeatTimer.StopRepeatingTickTask;
	Object.defineProperty(RepeatTimer, "StartRepeatingTickTask", {
		configurable: true,
		value: function StartEntityRepeatingTickTask(flIntervalSeconds, unLoopCountLimit = Infinity, bExecuteCallbackOnStart = false) {
			if (this !== RepeatTimer) {
				return StartRepeatTimer.call(this, flIntervalSeconds, unLoopCountLimit, bExecuteCallbackOnStart);
			}

			AddTrackedTimer(g_mapTrackedRepeats, unEntityIndex, RepeatTimer);
			try {
				return StartRepeatTimer.call(this, flIntervalSeconds, unLoopCountLimit, bExecuteCallbackOnStart);
			} finally {
				if (this.RepeatingTickTaskStatus === RepeatingTickTaskStatus.STOPPED) {
					RemoveTrackedTimer(g_mapTrackedRepeats, unEntityIndex, RepeatTimer);
				}
			}
		},
		writable: true,
	});

	Object.defineProperty(RepeatTimer, "StopRepeatingTickTask", {
		configurable: true,
		value: function StopEntityRepeatingTickTask() {
			const bStopResult = StopRepeatTimer.call(this);
			if (this === RepeatTimer) {
				RemoveTrackedTimer(g_mapTrackedRepeats, unEntityIndex, RepeatTimer);
			}

			return bStopResult;
		},
		writable: true,
	});

	RepeatTimer.Stop = RepeatTimer.StopRepeatingTickTask.bind(RepeatTimer);
	Object.defineProperty(RepeatTimer, "StartRepeat", { configurable: true, value: RepeatTimer.StartRepeatingTickTask.bind(RepeatTimer), writable: true });

	AddTrackedTimer(g_mapTrackedRepeats, unEntityIndex, RepeatTimer);

	return RepeatTimer;
}

function CancelEntityTimers(EntityReference) {
	const unEntityIndex = ResolveEntityIndex(EntityReference);
	const setDelayTimers = g_mapTrackedDelays.get(unEntityIndex);
	const setRepeatTimers = g_mapTrackedRepeats.get(unEntityIndex);
	if (setDelayTimers !== undefined) {
		for (const DelayTimer of setDelayTimers) {
			if (DelayTimer.Running) {
				DelayTimer.Cancel();
			}
		}
	}

	if (setRepeatTimers !== undefined) {
		for (const RepeatTimer of setRepeatTimers) {
			RepeatTimer.Stop();
		}
	}

	g_mapTrackedDelays.delete(unEntityIndex);
	g_mapTrackedRepeats.delete(unEntityIndex);

	return true;
}

function EmitEntitySound(EntityReference, strSoundSample, SoundOptions = {}) {
	if ((SoundOptions === null) || (typeof SoundOptions !== "object") || Array.isArray(SoundOptions)) {
		throw new TypeError("SoundOptions must be an object.");
	}

	const ResolvedSoundOptions = { ...SoundOptions };
	const bStreamSound = (ResolvedSoundOptions.Stream === undefined) ? false : ResolvedSoundOptions.Stream;
	if (typeof bStreamSound !== "boolean") {
		throw new TypeError("Stream must be a boolean.");
	}

	if (ResolvedSoundOptions.Entity === undefined) {
		ResolvedSoundOptions.Entity = ResolveEntityIndex(EntityReference);
	}

	const SoundClass = bStreamSound ? g_SoundAPI.StreamSound : g_SoundAPI.Sound;
	const SoundInstance = new SoundClass(strSoundSample, ResolvedSoundOptions);
	const SoundRecipients = (ResolvedSoundOptions.Recipients === undefined) ? null : ResolvedSoundOptions.Recipients;
	if (!SoundInstance.PlaySound(SoundRecipients)) {
		throw new Error(`Unable to emit entity sound: ${SoundInstance.EngineSample}`);
	}

	return SoundInstance;
}

function GetEntityModelName(EntityReference) {
	return g_EntitiesRuntime.GetModel(EntityReference);
}

function GetEntityModelHeader(EntityReference) {
	const strModelPath = GetEntityModelName(EntityReference);
	const hModelHandle = g_StudioCacheRuntime.FindModelHandle(strModelPath);
	const vecModelHeaderErrors = [];
	let ModelHeader;
	let nRemainingReferenceCount = 0;
	try {
		ModelHeader = g_StudioCacheRuntime.RequireModelHeader(hModelHandle);
	} catch (ErrorValue) {
		vecModelHeaderErrors.push(ErrorValue);
	}

	try {
		if (hModelHandle !== g_StudioCacheRuntime.INVALID_MODEL_HANDLE) {
			nRemainingReferenceCount = g_StudioCacheRuntime.Release(hModelHandle);
		}
	} catch (ErrorValue) {
		vecModelHeaderErrors.push(ErrorValue);
	}

	if (vecModelHeaderErrors.length === 1) {
		throw vecModelHeaderErrors[0];
	}

	if (vecModelHeaderErrors.length > 1) {
		throw new AggregateError(vecModelHeaderErrors, "Entity model-header lookup and handle cleanup failed.");
	}

	if (nRemainingReferenceCount <= 0) {
		throw new Error("The entity model must remain retained by the engine or another model-cache owner.");
	}

	return ModelHeader;
}

function GetEntityHitbox(EntityReference, unHitboxIndex, unHitboxSet = 0) {
	return GetEntityModelHeader(EntityReference).GetHitbox(unHitboxIndex, unHitboxSet);
}

function DecorateEntity(EntityObject) {
	if ((EntityObject === null) || (typeof EntityObject !== "object")) {
		return EntityObject;
	}

	DefineEntityMethod(EntityObject, "IsEntityNetworked", function IsEntityNetworkedMethod() {
		return IsEntityNetworked(this);
	});

	DefineEntityMethod(EntityObject, "GetEntityServerClasses", function GetEntityServerClassesMethod() {
		return GetEntityServerClasses(this);
	});

	DefineEntityMethod(EntityObject, "GetEntityDynamicAttributes", function GetEntityDynamicAttributesMethod() {
		return GetEntityDynamicAttributes(this);
	});

	DefineEntityMethod(EntityObject, "GetEntityProperties", function GetEntityPropertiesMethod() {
		return GetEntityProperties(this);
	});

	DefineEntityMethod(EntityObject, "GetEntityInputs", function GetEntityInputsMethod() {
		return GetEntityInputs(this);
	});

	DefineEntityMethod(EntityObject, "GetEntityOutputs", function GetEntityOutputsMethod() {
		return GetEntityOutputs(this);
	});

	DefineEntityMethod(EntityObject, "GetEntityKeyValues", function GetEntityKeyValuesMethod() {
		return GetEntityKeyValues(this);
	});

	DefineEntityMethod(EntityObject, "GetEntityInput", function GetEntityInputMethod(strInputName) {
		return GetEntityInput(this, strInputName);
	});

	DefineEntityMethod(EntityObject, "GetEntityOutput", function GetEntityOutputMethod(strOutputName) {
		return GetEntityOutput(this, strOutputName);
	});

	if (typeof g_EntitiesRuntime.CallInput === "function") {
		DefineEntityMethod(EntityObject, "CallEntityInputFunction", function CallEntityInputFunctionMethod(strInputName, InputValue = undefined, flInputDelay = 0) {
			return CallEntityInputFunction(this, strInputName, InputValue, flInputDelay);
		});
	}

	DefineEntityMethod(EntityObject, "DelayEntityCallback", function DelayEntityCallbackMethod(flDelaySeconds, Callback, vecCallbackArguments = [], DelayOptions = {}) {
		return DelayEntityCallback(this, flDelaySeconds, Callback, vecCallbackArguments, DelayOptions);
	});

	DefineEntityMethod(EntityObject, "RepeatEntityCallback", function RepeatEntityCallbackMethod(Callback, vecCallbackArguments = [], RepeatOptions = {}) {
		return RepeatEntityCallback(this, Callback, vecCallbackArguments, RepeatOptions);
	});

	DefineEntityMethod(EntityObject, "CancelEntityTimers", function CancelEntityTimersMethod() {
		return CancelEntityTimers(this);
	});

	DefineEntityMethod(EntityObject, "EmitEntitySound", function EmitEntitySoundMethod(strSoundSample, SoundOptions = {}) {
		return EmitEntitySound(this, strSoundSample, SoundOptions);
	});

	if (typeof g_EntitiesRuntime.GetModel === "function") {
		DefineEntityMethod(EntityObject, "GetEntityModelName", function GetEntityModelNameMethod() {
			return GetEntityModelName(this);
		});

		DefineEntityMethod(EntityObject, "GetEntityModelHeader", function GetEntityModelHeaderMethod() {
			return GetEntityModelHeader(this);
		});

		DefineEntityMethod(EntityObject, "GetEntityHitbox", function GetEntityHitboxMethod(unHitboxIndex, unHitboxSet = 0) {
			return GetEntityHitbox(this, unHitboxIndex, unHitboxSet);
		});
	}

	return EntityObject;
}

function Entity(nEntityIndex) {
	return DecorateEntity(g_EntitiesRuntime.GetEntity(nEntityIndex));
}

function GetEntityClassNameByIndex(EntityReference) {
	return g_EntitiesRuntime.GetEntityClassName(EntityReference);
}

function GetEntityCount() {
	return g_EntitiesRuntime.GetEntityCount();
}

function GetMaximumEntityCount() {
	return g_EntitiesRuntime.GetMaximumEntityCount();
}

function RemoveEntityByIndex(EntityReference) {
	return g_EntitiesRuntime.RemoveEntity(EntityReference);
}

function DecorateEntityList(vecEntityList) {
	for (let unEntityListIndex = 0; unEntityListIndex < vecEntityList.length; ++unEntityListIndex) {
		vecEntityList[unEntityListIndex] = DecorateEntity(vecEntityList[unEntityListIndex]);
	}

	return vecEntityList;
}

function GetAllEntities() {
	return DecorateEntityList(g_EntitiesRuntime.GetAllEntities());
}

function GetEntitiesByClassName(strEntityClassName) {
	return DecorateEntityList(g_EntitiesRuntime.GetEntitiesByClassName(strEntityClassName));
}

const g_EntitiesAPI = {
	CallEntityInputFunction,
	CancelEntityTimers,
	DecorateEntity,
	DelayEntityCallback,
	Entity,
	EmitEntitySound,
	GetAllEntities,
	GetEntityClassNameByIndex,
	GetEntityCount,
	GetEntityDynamicAttributes,
	GetEntitiesByClassName,
	GetEntityHitbox,
	GetEntityInput,
	GetEntityInputs,
	GetEntityKeyValues,
	GetEntityModelHeader,
	GetEntityModelName,
	GetEntityOutput,
	GetEntityOutputs,
	GetEntityProperties,
	GetEntityServerClasses,
	GetMaximumEntityCount,
	IsEntityNetworked,
	RemoveEntityByIndex,
	RepeatEntityCallback,
};

module.exports = g_EntitiesAPI;
