#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strBasePath = g_Path.join(g_strPackageRoot, "entities", "index.js");
const g_strClassesPath = g_Path.join(g_strPackageRoot, "entities", "classes.js");
const g_strDatamapsPath = g_Path.join(g_strPackageRoot, "entities", "datamaps.js");
const g_strEntityDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "entities-entity.md");
const g_strEntityPath = g_Path.join(g_strPackageRoot, "entities", "entity.js");
const g_strRootDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "entities.md");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");
const g_strSoundPath = g_Path.join(g_strPackageRoot, "engines", "sound.js");
const g_strStudioCachePath = g_Path.join(g_strPackageRoot, "studio", "cache.js");
const g_strTickPath = g_Path.join(g_strPackageRoot, "listeners", "tick.js");

const g_vecBaseExpectedExports = [
	"CallEntityInputFunction",
	"CancelEntityTimers",
	"DecorateEntity",
	"DelayEntityCallback",
	"Entity",
	"EmitEntitySound",
	"GetAllEntities",
	"GetEntityClassNameByIndex",
	"GetEntityCount",
	"GetEntityDynamicAttributes",
	"GetEntitiesByClassName",
	"GetEntityHitbox",
	"GetEntityInput",
	"GetEntityInputs",
	"GetEntityKeyValues",
	"GetMaximumEntityCount",
	"GetEntityModelHeader",
	"GetEntityModelName",
	"GetEntityOutput",
	"GetEntityOutputs",
	"GetEntityProperties",
	"GetEntityServerClasses",
	"IsEntityNetworked",
	"RemoveEntityByIndex",
	"RepeatEntityCallback",
];
const g_vecRootExpectedExports = [
	...g_vecBaseExpectedExports,
];
const g_vecEntityExpectedExports = [
	"CallEntityInputFunction",
	"Entity",
	"GetEntityModelName",
	"GetNativeEntityByIndex",
];
const g_unEntityBaseAddress = 0x100000n;
const g_unEntityAddressStride = 0x100n;
const g_unHitboxAddress = 0x6400n;
const g_unModelHeaderAddress = 0x6300n;
const g_unMaximumEntities = 2_048;
const g_unEntitySerialNumberBase = 10;
const g_nInt32Minimum = -2_147_483_648;
const g_nInt32Maximum = 2_147_483_647;
const g_strModuleBindingsPath = g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp");

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	const ModulePaths = {
		entities: g_strBasePath,
		"entities/classes": g_strClassesPath,
		"entities/datamaps": g_strDatamapsPath,
		"entities/entity": g_strEntityPath,
		"engines/sound": g_strSoundPath,
		"listeners/tick": g_strTickPath,
		"studio/cache": g_strStudioCachePath,
	};
	if (Object.hasOwn(ModulePaths, strRequestName)) {
		return require(ModulePaths[strRequestName]);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

const g_vecNativeCalls = [];
const g_vecSoundCalls = [];
const g_mapEntityStates = new Map();
const g_vecCreatedEntityIndexes = [];

function CreateVector(flX, flY, flZ) {
	return { X: flX, Y: flY, Z: flZ };
}

function AddEntity(unIndex, strClassName, Options = {}) {
	g_mapEntityStates.set(unIndex, {
		Animation: "idle",
		BaseHandle: { EntryIndex: unIndex, SerialNumber: g_unEntitySerialNumberBase + unIndex },
		ClassName: strClassName,
		DatamapValues: {
			m_flDelay: Options.Delay ?? 0,
			m_hOwnerEntity: null,
			m_ModelName: Options.Model ?? `models/sourcejs/entity_${unIndex}.mdl`,
			m_spawnflags: Options.SpawnFlags ?? 0x00,
		},
		Enabled: true,
		Free: false,
		HandleValue: 0x1000 + unIndex,
		Health: Options.Health ?? 100,
		Model: Options.Model ?? `models/sourcejs/entity_${unIndex}.mdl`,
		NetworkSerialNumber: g_unEntitySerialNumberBase + unIndex,
		Origin: CreateVector(Options.Origin?.X ?? unIndex * 10, Options.Origin?.Y ?? 0, Options.Origin?.Z ?? 0),
		Owner: null,
		Speed: Options.Speed ?? 1,
		StateFlags: Options.StateFlags ?? 0x00,
	});

	g_mapEntityStates.get(unIndex).DatamapValues.m_vecAbsOrigin = g_mapEntityStates.get(unIndex).Origin;
}

AddEntity(0, "worldspawn", { Model: "models/world.mdl" });
AddEntity(1, "player", { Health: 80, Model: "models/survivors/survivor_gambler.mdl" });
AddEntity(2, "prop_dynamic", { Model: "models/props_interiors/table_folding.mdl" });
AddEntity(3, "logic_relay", { Delay: 1.5, Model: "models/error.mdl" });
AddEntity(4, "prop_door_rotating", { Model: "models/props_doors/doormainmetal01.mdl" });
AddEntity(5, "env_sprite", { Model: "sprites/glow01.vmt" });
AddEntity(6, "env_sprite", { Model: "sprites/glow01.vmt" });
AddEntity(40, "prop_dynamic", { Model: "models/props_junk/wood_crate001a.mdl" });
AddEntity(41, "prop_dynamic", { Model: "models/props_junk/wood_crate002a.mdl" });

const g_Hitbox = {
	Address: g_unHitboxAddress,
	Maxs: { X: 16, Y: 16, Z: 72 },
	Mins: { X: -16, Y: -16, Z: 0 },
};

const g_ModelHeader = {
	GetHitbox(unHitboxIndex, unHitboxSetIndex) {
		g_vecNativeCalls.push(["GetHitbox", unHitboxIndex, unHitboxSetIndex]);

		return g_Hitbox;
	},
	Address: g_unModelHeaderAddress,
};

const g_vecInputFields = [
	{ Input: true, Key: false, Output: false, Name: "SetAnimation", Address: 0x7100n },
	{ Input: true, Key: false, Output: false, Name: "Disable", Address: 0x7104n },
	{ Input: true, Key: false, Output: false, Name: "Enable", Address: 0x7108n },
	{ Input: true, Key: false, Output: false, Name: "Toggle", Address: 0x710Cn },
];
const g_vecOutputFields = [
	{ Input: false, Key: false, Output: true, Name: "OnAnimationDone", Address: 0x7200n },
];
const g_vecKeyValueFields = [
	{ Input: false, Key: true, Output: false, Name: "model", Address: 0x7300n },
];
const g_vecPropertyFields = [
	{ Name: "m_iHealth", Type: "int" },
	{ Name: "m_vecOrigin", Type: "vector" },
];
const g_vecDataMapFields = g_vecInputFields.concat(g_vecOutputFields, g_vecKeyValueFields, [
	{ Input: false, Key: false, Output: false, Name: "m_flDelay", Address: 0x7400n },
]);

const g_BaseServerClass = { Name: "CBaseEntity", Address: 0x7500n };
const g_DynamicServerClass = { Name: "CDynamicProp", Address: 0x7504n };
const g_PlayerServerClass = { Name: "CTerrorPlayer", Address: 0x7508n };
const g_ServerClasses = {
	Get(strServerClassName) {
		return new Map([
			[g_BaseServerClass.Name, g_BaseServerClass],
			[g_DynamicServerClass.Name, g_DynamicServerClass],
			[g_PlayerServerClass.Name, g_PlayerServerClass],
		]).get(strServerClassName) ?? null;
	},
};

g_Assert.deepEqual([g_unHitboxAddress, g_unModelHeaderAddress, ...g_vecDataMapFields.map((Field) => Field.Address), g_BaseServerClass.Address, g_DynamicServerClass.Address, g_PlayerServerClass.Address], [0x6400n, 0x6300n, 0x7100n, 0x7104n, 0x7108n, 0x710Cn, 0x7200n, 0x7300n, 0x7400n, 0x7500n, 0x7504n, 0x7508n], "entity metadata fixture addresses must be exact BigInt values");

function RequireState(unEntityIndex, strOperation) {
	const State = g_mapEntityStates.get(unEntityIndex);
	if ((State === undefined) || State.Free) {
		throw new TypeError(`${strOperation} expects a valid entity.`);
	}

	return State;
}

function RemoveEntityByIndex(unEntityIndex, strOperation) {
	const State = RequireState(unEntityIndex, strOperation);
	State.Free = true;
	g_vecNativeCalls.push([strOperation, unEntityIndex]);

	return true;
}

function GetEntityArgumentIndex(EntityValue, strOperation) {
	const nEntityIndex = (typeof EntityValue === "number") ? EntityValue : EntityValue?.Index;
	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < g_nInt32Minimum) || (nEntityIndex > g_nInt32Maximum)) {
		throw new TypeError(`${strOperation} expects an integer entity index or an object with an integer Index property.`);
	}

	return nEntityIndex;
}

function ValidateInputValue(Value) {
	if ((Value === undefined) || (Value === null) || (typeof Value === "boolean") || (typeof Value === "string")) {
		return;
	}

	if ((typeof Value === "number") && Number.isFinite(Value)) {
		return;
	}

	throw new TypeError("Entity input value must be undefined, null, a boolean, a finite number, or a string.");
}

function CallInputByIndex(EntityValue, strInputName, Value = undefined, flDelaySeconds = 0) {
	const nEntityIndex = GetEntityArgumentIndex(EntityValue, "CallEntityInput");
	const State = RequireState(nEntityIndex, "CallEntityInput");

	if ((typeof strInputName !== "string") || (strInputName.length === 0)) {
		throw new TypeError("Entity input name must be a non-empty string.");
	}

	if ((typeof flDelaySeconds !== "number") || !Number.isFinite(flDelaySeconds)) {
		throw new TypeError("Entity input delay must be finite.");
	}

	ValidateInputValue(Value);

	g_vecNativeCalls.push(["CallEntityInput", nEntityIndex, strInputName, Value, flDelaySeconds]);

	if (strInputName === "Disable") {
		State.Enabled = false;
	} else if (strInputName === "Enable") {
		State.Enabled = true;
	} else if (strInputName === "Toggle") {
		State.Enabled = !State.Enabled;
	} else if (strInputName === "SetAnimation") {
		State.Animation = Value;
	} else if (strInputName === "Kill") {
		State.Free = true;
	}

	return true;
}

const g_unDataMapBaseAddress = 0x8000n;
const g_unDataMapAddressStride = 0x100n;
const g_mapDataMaps = new Map();
for (const [nEntityIndex, State] of g_mapEntityStates) {
	g_mapDataMaps.set(nEntityIndex, {
		ClassName: State.ClassName,
		Fields: g_vecDataMapFields,
		Address: g_unDataMapBaseAddress + BigInt(nEntityIndex) * g_unDataMapAddressStride,
	});
}

g_Assert.deepEqual([...g_mapDataMaps.values()].map((DataMap) => DataMap.Address), [0x8000n, 0x8100n, 0x8200n, 0x8300n, 0x8400n, 0x8500n, 0x8600n, 0xA800n, 0xA900n], "entity datamap fixture addresses must be exact BigInt values");

function MakeNativeEntity(nEntityIndex) {
	const InitialState = g_mapEntityStates.get(nEntityIndex);
	if (!InitialState || InitialState.Free) {
		return null;
	}

	const Entity = {};
	Object.defineProperties(Entity, {
		Index: {
			enumerable: true,
			value: nEntityIndex,
		},
		BaseEntity: {
			enumerable: true,
			get() {
				return Entity.Valid ? { Index: nEntityIndex, Kind: "baseentity" } : null;
			},
		},
		BaseHandle: {
			enumerable: true,
			get() {
				return Entity.Valid ? g_mapEntityStates.get(nEntityIndex).BaseHandle : null;
			},
		},
		ClassName: {
			enumerable: true,
			get() {
				return Entity.Valid ? g_mapEntityStates.get(nEntityIndex).ClassName : "";
			},
		},
		Edict: {
			enumerable: true,
			get() {
				return Entity.Valid ? { Index: nEntityIndex, Kind: "edict" } : null;
			},
		},
		Free: {
			enumerable: true,
			get() {
				return !Entity.Valid;
			},
			set(bValue) {
				if (typeof bValue !== "boolean") {
					throw new TypeError("Entity.Free requires a boolean.");
				}

				const State = g_mapEntityStates.get(nEntityIndex);
				if (!State) {
					throw new TypeError("Entity property target is unavailable.");
				}

				State.Free = bValue;
			},
		},
		HandleValue: {
			enumerable: true,
			get() {
				return Entity.Valid ? g_mapEntityStates.get(nEntityIndex).HandleValue : -1;
			},
		},
		NetworkSerialNumber: {
			enumerable: true,
			get() {
				return g_mapEntityStates.get(nEntityIndex)?.NetworkSerialNumber ?? 0;
			},
			set(nValue) {
				if (!Number.isInteger(nValue)) {
					throw new TypeError("Entity.NetworkSerialNumber requires an integer.");
				}

				RequireState(nEntityIndex, "Entity.NetworkSerialNumber").NetworkSerialNumber = nValue;
			},
		},
		Address: {
			enumerable: true,
			get() {
				return Entity.Valid ? (g_unEntityBaseAddress + BigInt(nEntityIndex) * g_unEntityAddressStride) : 0n;
			},
		},
		StateFlags: {
			enumerable: true,
			get() {
				return g_mapEntityStates.get(nEntityIndex)?.StateFlags ?? 0;
			},
			set(nValue) {
				if (!Number.isInteger(nValue)) {
					throw new TypeError("Entity.StateFlags requires an integer.");
				}

				RequireState(nEntityIndex, "Entity.StateFlags").StateFlags = nValue;
			},
		},
		Valid: {
			enumerable: true,
			get() {
				const State = g_mapEntityStates.get(nEntityIndex);

				return Boolean(State && !State.Free);
			},
		},
	});

	Entity.SlayEntity = function SlayEntity() {
		const State = RequireState(nEntityIndex, "Entity.SlayEntity");
		State.Health = 0;
		State.Free = true;
		g_vecNativeCalls.push(["SlayEntity", nEntityIndex]);

		return true;
	};

	Entity.CallEntityInput = function CallEntityInput(strInputName, Value = undefined, flDelaySeconds = 0) {
		return CallInputByIndex(Entity, strInputName, Value, flDelaySeconds);
	};

	Entity.RemoveEntity = function RemoveEntity() {
		return RemoveEntityByIndex(nEntityIndex, "Entity.RemoveEntity");
	};

	Entity.GetEntityProperty = function GetEntityProperty(strPropertyName, strType = undefined) {
		g_vecNativeCalls.push(["GetEntityProperty", nEntityIndex, strPropertyName, strType]);

		if (strPropertyName === "m_iHealth") {
			return RequireState(nEntityIndex, "Entity.GetEntityProperty").Health;
		}

		if (strPropertyName === "m_vecOrigin") {
			return RequireState(nEntityIndex, "Entity.GetEntityProperty").Origin;
		}

		if (strPropertyName === "m_flLaggedMovementValue") {
			return RequireState(nEntityIndex, "Entity.GetEntityProperty").Speed;
		}

		if (strPropertyName === "m_ModelName") {
			return RequireState(nEntityIndex, "Entity.GetEntityProperty").Model;
		}

		if (strPropertyName === "m_hOwnerEntity") {
			return RequireState(nEntityIndex, "Entity.GetEntityProperty").Owner;
		}

		throw new TypeError(`Unknown send property: ${strPropertyName}`);
	};

	Entity.SetEntityProperty = function SetEntityProperty(strPropertyName, Value, strType = undefined) {
		g_vecNativeCalls.push(["SetEntityProperty", nEntityIndex, strPropertyName, Value, strType]);

		if (strPropertyName === "m_iHealth") {
			RequireState(nEntityIndex, "Entity.SetEntityProperty").Health = Value;
			return true;
		}

		if (strPropertyName === "m_flLaggedMovementValue") {
			RequireState(nEntityIndex, "Entity.SetEntityProperty").Speed = Value;
			return true;
		}

		if (strPropertyName === "m_ModelName") {
			RequireState(nEntityIndex, "Entity.SetEntityProperty").Model = Value;
			return true;
		}

		if (strPropertyName === "m_hOwnerEntity") {
			RequireState(nEntityIndex, "Entity.SetEntityProperty").Owner = Value;
			return true;
		}

		throw new TypeError(`Unknown send property: ${strPropertyName}`);
	};

	Entity.GetEntityPropertyInteger = function GetEntityPropertyInteger(strPropertyName) {
		return Entity.GetEntityProperty(strPropertyName, "int");
	};

	Entity.SetEntityPropertyInteger = function SetEntityPropertyInteger(strPropertyName, Value) {
		return Entity.SetEntityProperty(strPropertyName, Value, "int");
	};

	Entity.GetEntityPropertyFloat = function GetEntityPropertyFloat(strPropertyName) {
		return Number(Entity.GetEntityProperty(strPropertyName, "float"));
	};

	Entity.SetEntityPropertyFloat = function SetEntityPropertyFloat(strPropertyName, Value) {
		return Entity.SetEntityProperty(strPropertyName, Value, "float");
	};

	Entity.GetEntityPropertyString = function GetEntityPropertyString(strPropertyName) {
		return String(Entity.GetEntityProperty(strPropertyName, "string"));
	};

	Entity.SetEntityPropertyString = function SetEntityPropertyString(strPropertyName, Value) {
		return Entity.SetEntityProperty(strPropertyName, Value, "string");
	};

	Entity.GetEntityPropertyVector = function GetEntityPropertyVector(strPropertyName) {
		return Entity.GetEntityProperty(strPropertyName, "vector");
	};

	Entity.SetEntityPropertyVector = function SetEntityPropertyVector(...vecArguments) {
		const Value = vecArguments[1];
		const State = RequireState(nEntityIndex, "Entity.SetEntityPropertyVector");
		State.Origin.X = Value.X;
		State.Origin.Y = Value.Y;
		State.Origin.Z = Value.Z;

		return true;
	};

	Entity.GetEntityPropertyEntity = function GetEntityPropertyEntity(strPropertyName) {
		return Entity.GetEntityProperty(strPropertyName, "entity");
	};

	Entity.SetEntityPropertyEntity = function SetEntityPropertyEntity(strPropertyName, Value) {
		return Entity.SetEntityProperty(strPropertyName, Value, "entity");
	};

	Entity.GetEntityDataMap = function GetEntityDataMap() {
		return g_mapDataMaps.get(nEntityIndex);
	};

	Entity.GetEntityDataMapProperty = function GetEntityDataMapProperty(strPropertyName, strType = undefined) {
		g_vecNativeCalls.push(["GetEntityDataMapProperty", nEntityIndex, strPropertyName, strType]);

		return RequireState(nEntityIndex, "Entity.GetEntityDataMapProperty").DatamapValues[strPropertyName];
	};

	Entity.SetEntityDataMapProperty = function SetEntityDataMapProperty(strPropertyName, Value, strType = undefined) {
		g_vecNativeCalls.push(["SetEntityDataMapProperty", nEntityIndex, strPropertyName, Value, strType]);
		RequireState(nEntityIndex, "Entity.SetEntityDataMapProperty").DatamapValues[strPropertyName] = Value;

		return true;
	};

	Entity.GetEntityDataMapPropertyInteger = function GetEntityDataMapPropertyInteger(strPropertyName) {
		return Entity.GetEntityDataMapProperty(strPropertyName, "int");
	};

	Entity.SetEntityDataMapPropertyInteger = function SetEntityDataMapPropertyInteger(strPropertyName, Value) {
		return Entity.SetEntityDataMapProperty(strPropertyName, Value, "int");
	};

	Entity.GetEntityDataMapPropertyFloat = function GetEntityDataMapPropertyFloat(strPropertyName) {
		return Entity.GetEntityDataMapProperty(strPropertyName, "float");
	};

	Entity.SetEntityDataMapPropertyFloat = function SetEntityDataMapPropertyFloat(strPropertyName, Value) {
		return Entity.SetEntityDataMapProperty(strPropertyName, Value, "float");
	};

	Entity.GetEntityDataMapPropertyString = function GetEntityDataMapPropertyString(strPropertyName) {
		return String(Entity.GetEntityDataMapProperty(strPropertyName, "string"));
	};

	Entity.SetEntityDataMapPropertyString = function SetEntityDataMapPropertyString(strPropertyName, Value) {
		return Entity.SetEntityDataMapProperty(strPropertyName, Value, "string");
	};

	Entity.GetEntityDataMapPropertyVector = function GetEntityDataMapPropertyVector(strPropertyName) {
		return Entity.GetEntityDataMapProperty(strPropertyName, "vector");
	};

	Entity.SetEntityDataMapPropertyVector = function SetEntityDataMapPropertyVector(strPropertyName, Value) {
		const CurrentValue = Entity.GetEntityDataMapProperty(strPropertyName, "vector");
		CurrentValue.X = Value.X;
		CurrentValue.Y = Value.Y;
		CurrentValue.Z = Value.Z;
		g_vecNativeCalls.push(["SetEntityDataMapProperty", nEntityIndex, strPropertyName, Value, "vector"]);

		return true;
	};

	Entity.GetEntityDataMapPropertyEntity = function GetEntityDataMapPropertyEntity(strPropertyName) {
		return Entity.GetEntityDataMapProperty(strPropertyName, "entity");
	};

	Entity.SetEntityDataMapPropertyEntity = function SetEntityDataMapPropertyEntity(strPropertyName, Value) {
		return Entity.SetEntityDataMapProperty(strPropertyName, Value, "entity");
	};

	return Entity;
}

const g_NativeEntities = {
	GetAllEntities() {
		g_vecNativeCalls.push(["GetAllEntities"]);

		return Array.from(g_mapEntityStates.keys()).map((nEntityIndex) => MakeNativeEntity(nEntityIndex)).filter(Boolean);
	},
	GetEntitiesByClassName(strEntityClassName) {
		if ((typeof strEntityClassName !== "string") || (strEntityClassName.length === 0)) {
			throw new TypeError("entities.GetEntitiesByClassName expects a non-empty class name.");
		}

		g_vecNativeCalls.push(["GetEntitiesByClassName", strEntityClassName]);

		return Array.from(g_mapEntityStates.entries())
			.filter(([, State]) => !State.Free && (State.ClassName === strEntityClassName))
			.map(([nEntityIndex]) => MakeNativeEntity(nEntityIndex));
	},
	CallInput(EntityValue, strInputName, Value = undefined, flDelaySeconds = 0) {
		return CallInputByIndex(EntityValue, strInputName, Value, flDelaySeconds);
	},
	GetEntityClassName(nEntityIndex) {
		if (!Number.isInteger(nEntityIndex)) {
			throw new TypeError("entities.GetEntityClassName expects an integer index.");
		}

		const State = g_mapEntityStates.get(nEntityIndex);

		return (State && !State.Free) ? State.ClassName : "";
	},
	GetEntityCount() {
		return Array.from(g_mapEntityStates.values()).filter((State) => !State.Free).length;
	},
	GetEntity(nEntityIndex) {
		if (!Number.isInteger(nEntityIndex) || (nEntityIndex < g_nInt32Minimum) || (nEntityIndex > g_nInt32Maximum)) {
			throw new TypeError("Entity expects an integer index.");
		}

		return MakeNativeEntity(nEntityIndex);
	},
	GetModel(Entity) {
		const State = RequireState(Entity.Index, "entities.GetModel");

		g_vecNativeCalls.push(["GetModel", Entity.Index]);

		return State.Model;
	},
	GetMaximumEntityCount() {
		return g_unMaximumEntities;
	},
	RemoveEntity(nEntityIndex) {
		return RemoveEntityByIndex(nEntityIndex, "entities.RemoveEntity");
	},
};

const g_NativeEntityModule = {
	CallInput: g_NativeEntities.CallInput,
	GetEntity: g_NativeEntities.GetEntity,
	GetModel: g_NativeEntities.GetModel,
};

const g_Classes = {
	SERVER_CLASSES: g_ServerClasses,
	GetServerClasses() {
		return [g_BaseServerClass, g_DynamicServerClass, g_PlayerServerClass];
	},
	GetBaseClassNames(ServerClass) {
		return (ServerClass.Name === "CBaseEntity") ? [] : ["CBaseEntity"];
	},
	GetServerClassProperties(Entity) {
		return (Entity.ClassName === "worldspawn") ? [] : g_vecPropertyFields;
	},
	GetServerClass(Entity) {
		if (!Entity?.Valid) {
			return null;
		}

		if (Entity.ClassName === "player") {
			return g_PlayerServerClass;
		}

		return (Entity.ClassName === "prop_dynamic") ? g_DynamicServerClass : g_BaseServerClass;
	},
};

const g_DataMaps = {
	FindEntityDataMapField(DataMap, strName) {
		return DataMap.Fields.find((Field) => Field.Name === strName) ?? null;
	},
	GetEntityDataMap(Entity) {
		return g_mapDataMaps.get(Entity.Index) ?? null;
	},
	GetEntityInputFunction(Entity, Field) {
		return {
			Description: Field,
			Entity: g_unEntityBaseAddress + BigInt(Entity.Index) * g_unEntityAddressStride,
			Address: Field.Address,
		};
	},
	GetEntityDataMapFields(DataMap) {
		return DataMap.Fields;
	},
};

const g_hStudioModelHandle = 12;
const g_unEngineModelReferenceCount = 1;
let g_unStudioReferenceCount = g_unEngineModelReferenceCount;
const g_StudioCache = {
	INVALID_MODEL_HANDLE: 0xFFFF,
	FindModelHandle(strModelPath) {
		g_vecNativeCalls.push(["FindModelHandle", strModelPath]);
		g_unStudioReferenceCount += 1;

		return g_hStudioModelHandle;
	},
	RequireModelHeader(hModelHandle) {
		g_vecNativeCalls.push(["RequireModelHeader", hModelHandle]);

		if (hModelHandle === this.INVALID_MODEL_HANDLE) {
			throw new Error("Invalid model handle.");
		}

		return g_ModelHeader;
	},
	Release(hModelHandle) {
		g_Assert.equal(hModelHandle, g_hStudioModelHandle);
		g_Assert.equal(g_unStudioReferenceCount > 0, true);

		g_unStudioReferenceCount -= 1;

		return g_unStudioReferenceCount;
	},
};

class TickDelay {
	constructor(flDelaySeconds, Callback, vecCallbackArguments = [], bCancelOnLevelEnd = false) {
		this.Callback = Callback;
		this.CallbackArguments = vecCallbackArguments;
		this.CancelOnLevelEnd = bCancelOnLevelEnd;
		this.DelaySeconds = flDelaySeconds;
		this.Running = true;
		this.TimeElapsedSeconds = 0;
		this.TimeRemainingSeconds = flDelaySeconds;
	}

	InvokeTickDelayCallback() {
		this.CancelTickDelay();

		return this.Callback(...this.CallbackArguments);
	}

	ExecuteTickDelayCallback() {
		return this.Callback(...this.CallbackArguments);
	}

	CancelTickDelay() {
		this.Running = false;
		this.TimeRemainingSeconds = 0;

		return true;
	}

	DisposeTickDelay() {
		if (!this.Running) {
			return false;
		}

		return this.CancelTickDelay();
	}
}

const g_RepeatingTickTaskStatus = Object.freeze({ STOPPED: 1, RUNNING: 2, PAUSED: 3 });

class RepeatingTickTask {
	constructor(Callback, vecCallbackArguments = [], bCancelOnLevelEnd = false) {
		this.Callback = Callback;
		this.CallbackArguments = vecCallbackArguments;
		this.CancelOnLevelEnd = bCancelOnLevelEnd;
		this.Running = false;
		this.RepeatingTickTaskStatus = g_RepeatingTickTaskStatus.STOPPED;
	}

	StartRepeatingTickTask(flIntervalSeconds, unLoopCountLimit = Infinity, bExecuteOnStart = false) {
		this.IntervalSeconds = flIntervalSeconds;
		this.LoopCountLimit = unLoopCountLimit;
		this.Running = true;
		this.RepeatingTickTaskStatus = g_RepeatingTickTaskStatus.RUNNING;

		if (bExecuteOnStart) {
			this.Callback(...this.CallbackArguments);
		}

		return true;
	}

	StopRepeatingTickTask() {
		if (!this.Running) {
			return false;
		}

		this.Running = false;
		this.RepeatingTickTaskStatus = g_RepeatingTickTaskStatus.STOPPED;

		return true;
	}
}

class Sound {
	constructor(strSample, Options = {}) {
		this.Entity = Options.Entity ?? 0;
		this.Options = Options;
		this.Sample = strSample;
		this.Stream = false;
	}

	PlaySound(Recipients = null) {
		g_vecSoundCalls.push(["Sound", this.Sample, this.Entity, Recipients]);

		return true;
	}

	StopSound() {
		g_vecSoundCalls.push(["StopSound", this.Sample, this.Entity]);

		return true;
	}
}

class StreamSound extends Sound {
	constructor(strSample, Options = {}) {
		super(strSample, Options);
		this.Stream = true;
	}

	PlaySound(Recipients = null) {
		g_vecSoundCalls.push(["StreamSound", this.Sample, this.Entity, Recipients]);

		return true;
	}
}

function InstallDependency(strFilePath, ModuleExports) {
	require.cache[strFilePath] = {
		children: [],
		exports: ModuleExports,
		filename: strFilePath,
		id: strFilePath,
		loaded: true,
		paths: [],
	};
}

function LoadEntities() {
	InstallDependency(g_strRuntimePath, {
		GetModule(strModuleName) {
			if (strModuleName === "entities") {
				return g_NativeEntities;
			}

			if (strModuleName === "entities/entity") {
				return g_NativeEntityModule;
			}

			throw new Error(`Unexpected native module: ${strModuleName}`);
		},
	});
	InstallDependency(g_strTickPath, { RepeatingTickTask, RepeatingTickTaskStatus: g_RepeatingTickTaskStatus, TickDelay });
	InstallDependency(g_strSoundPath, { Sound, StreamSound });
	InstallDependency(g_strDatamapsPath, g_DataMaps);
	InstallDependency(g_strClassesPath, g_Classes);
	InstallDependency(g_strStudioCachePath, g_StudioCache);
	delete require.cache[g_strBasePath];
	delete require.cache[g_strEntityPath];

	return require(g_strBasePath);
}

function VerifyEntitySoundRouting() {
	const nSourceEntityIndex = 3;
	const nExplicitEntityIndex = 7;
	const nLegacyEntityIndex = 91;
	const flVolume = 0.75;
	const vecRecipients = [1, 2];
	const vecEmissions = [];
	let bEmitSuccess = true;
	const NativeSound = {
		Attenuation: { NONE: 0 },
		Channel: { AUTO: 0 },
		Pitch: { NORMAL: 100 },
		SoundFlags: { NO_FLAGS: 0 },
		MAX_ATTENUATION: 3.98,
		SOUND_FROM_LOCAL_PLAYER: -1,
		SOUND_FROM_WORLD: 0,
		VOL_NORM: 1,
		IsSoundPrecached() {
			return false;
		},
		PrecacheSound() {
			return true;
		},
		EmitSound(Options) {
			vecEmissions.push(Options);

			return bEmitSuccess;
		},
	};
	const LoadModule = (strFilePath, RequireDependency) => {
		const ModuleRecord = { exports: {} };
		g_VM.runInNewContext(g_FileSystem.readFileSync(strFilePath, "utf8"), { module: ModuleRecord, require: RequireDependency }, { filename: strFilePath });

		return ModuleRecord.exports;
	};
	const ActualSound = LoadModule(g_strSoundPath, (strModuleName) => {
		if (strModuleName === "internal/runtime") {
			return {
				GetModule(strNativeModuleName) {
					g_Assert.equal(strNativeModuleName, "engines/sound");

					return NativeSound;
				},
			};
		}

		g_Assert.equal(strModuleName, "stringtables");

		return {
			DOWNLOADABLES: {
				Add() {
					throw new Error("Entity sound routing must not enable downloads.");
				},
			},
			AddString(strTableName, strSample) {
				g_Assert.equal(strTableName, "soundprecache");
				g_Assert.equal(strSample, "*/sourcejs/entity.wav");

				return 1;
			},
		};
	});
	const Dependencies = {
		"internal/runtime": {
			GetModule(strModuleName) {
				g_Assert.equal(strModuleName, "entities");

				return g_NativeEntities;
			},
		},
		"listeners/tick": { RepeatingTickTask, RepeatingTickTaskStatus: g_RepeatingTickTaskStatus, TickDelay },
		"engines/sound": ActualSound,
		"studio/cache": g_StudioCache,
		"entities/datamaps": g_DataMaps,
		"entities/classes": g_Classes,
	};
	const ActualEntities = LoadModule(g_strBasePath, (strModuleName) => {
		g_Assert.ok(Object.hasOwn(Dependencies, strModuleName), `Unexpected entity sound dependency: ${strModuleName}`);

		return Dependencies[strModuleName];
	});
	const vecProfiles = [
		{ Options: {}, Entity: nSourceEntityIndex, ResolveEntity: true },
		{ Options: { Entity: undefined }, Entity: nSourceEntityIndex, ResolveEntity: true },
		{ Options: { Entity: nExplicitEntityIndex }, Entity: nExplicitEntityIndex, ResolveEntity: false },
		{ Options: { Entity: 0 }, Entity: 0, ResolveEntity: false },
		{ Options: { Entity: -1 }, Entity: -1, ResolveEntity: false },
		{ Options: { Entity: null }, Entity: 0, ResolveEntity: false },
		{ Options: { EntityIndex: nLegacyEntityIndex }, Entity: nSourceEntityIndex, ResolveEntity: true },
		{ Options: { Entity: undefined, EntityIndex: nLegacyEntityIndex }, Entity: nSourceEntityIndex, ResolveEntity: true },
	];
	let unScenarioCount = 0;
	for (const bStream of [false, true]) {
		for (const bObjectReference of [false, true]) {
			for (const Profile of vecProfiles) {
				let unIndexReads = 0;
				const EntityReference = bObjectReference ? {
					get Index() {
						++unIndexReads;
						g_Assert.ok(Profile.ResolveEntity, "An explicit sound Entity must bypass the source Index getter.");

						return nSourceEntityIndex;
					},
				} : nSourceEntityIndex;
				const Options = { ...Profile.Options, Stream: bStream, Recipients: vecRecipients, Volume: flVolume };
				const OriginalOptions = { ...Options };
				const SoundValue = ActualEntities.EmitEntitySound(EntityReference, "sourcejs\\entity.wav", Options);
				g_Assert.equal(SoundValue.Entity, Profile.Entity, "Entity sound must use Sound.Entity rather than an unused option.");
				g_Assert.equal(SoundValue instanceof ActualSound.Sound, true);
				g_Assert.equal(SoundValue instanceof ActualSound.StreamSound, bStream);
				g_Assert.equal(Object.hasOwn(SoundValue, "EntityIndex"), false);
				g_Assert.equal(vecEmissions.at(-1).Entity, Profile.Entity);
				g_Assert.equal(vecEmissions.at(-1).Sample, bStream ? "*/sourcejs/entity.wav" : "sourcejs/entity.wav");
				g_Assert.strictEqual(vecEmissions.at(-1).Recipients, vecRecipients);
				g_Assert.equal(vecEmissions.at(-1).Volume, flVolume);
				g_Assert.deepEqual(Options, OriginalOptions, "The caller's sound options must remain unchanged.");
				g_Assert.equal(unIndexReads, (bObjectReference && Profile.ResolveEntity) ? 1 : 0);
				++unScenarioCount;
			}
		}

		for (const InvalidEntity of [true, 1n, "7", 1.5, Number.NaN, Infinity, 2_147_483_648]) {
			const unEmissionCount = vecEmissions.length;
			g_Assert.throws(() => ActualEntities.EmitEntitySound(nSourceEntityIndex, "sourcejs/entity.wav", { Entity: InvalidEntity, Stream: bStream }), /Entity must be a signed 32-bit integer/);
			g_Assert.equal(vecEmissions.length, unEmissionCount, "Invalid sound sources must fail before native emission.");
			++unScenarioCount;
		}

		bEmitSuccess = false;
		g_Assert.throws(() => ActualEntities.EmitEntitySound(nSourceEntityIndex, "sourcejs/entity.wav", { Stream: bStream }), /Unable to emit entity sound/);
		bEmitSuccess = true;
		++unScenarioCount;
	}

	g_Assert.equal(unScenarioCount, 48);
	console.log("Entity sound routing 48 actual-JS profiles passed (native dispatch doubled).");
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return Array.from(strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function ExecuteDocumentationBlock(strSource, unIndex, ModuleMap, strDocumentationName, ConsoleOverride = null) {
	const Script = new g_VM.Script(`(function (require, console) {\n${strSource}\n})`, {
		filename: `${strDocumentationName}:block-${unIndex + 1}`,
	});
	const Callback = Script.runInNewContext({ TypeError });
	const DocumentationRequire = (strModuleName) => {
		if (!Object.hasOwn(ModuleMap, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		return ModuleMap[strModuleName];
	};
	const DocumentationConsole = ConsoleOverride ?? {
		log() {
		},
	};
	Callback(DocumentationRequire, DocumentationConsole);
}

function ValidateEntityDocumentationLog(strFormat, Result) {
	g_Assert.match(strFormat, /^[A-Z][A-Za-z]+ Result=%j$/);
	g_Assert.doesNotThrow(() => JSON.stringify(Result));
}

function VerifyEntityCoreDocumentation(vecBlocks) {
	const vecAddresses = [0n, 0xFEDCBA9876543210n, 0xFFFFFFFFFFFFFFFFn];
	const vecExpectedOperations = ["ReportEntityCapabilities", "InspectEntityFactory", "ReportLiveEntityFields", "ReportEntityReflection"];
	const vecBlockIndexes = [0, 1, 2, 4];
	for (const unAddress of vecAddresses) {
		const OpaqueValue = { Address: unAddress };
		OpaqueValue.Self = OpaqueValue;

		const EntityRecord = {
			Address: unAddress,
			BaseEntity: OpaqueValue,
			BaseHandle: OpaqueValue,
			ClassName: "info_target",
			Edict: OpaqueValue,
			Free: false,
			HandleValue: -2,
			Index: 2,
			NetworkSerialNumber: 17,
			StateFlags: 0x08,
			Valid: true,
			GetEntityDynamicAttributes() {
				return { Inputs: [{}], KeyValues: [{}], Outputs: [{}], Properties: [{}], ServerClasses: [{}] };
			},
			GetEntityInput() {
				return { Address: unAddress };
			},
			GetEntityInputs() {
				return [{ Name: "Enable" }];
			},
			GetEntityKeyValues() {
				return [{ Name: "targetname" }];
			},
			GetEntityOutput() {
				return { Name: "OnTrigger" };
			},
			GetEntityOutputs() {
				return [{ Name: "OnTrigger" }];
			},
			GetEntityProperties() {
				return [{ Name: "m_iHealth" }];
			},
			GetEntityServerClasses() {
				return [{ Name: "CBaseEntity" }];
			},
			IsEntityNetworked() {
				return true;
			},
		};
		const EntityAPI = {
			CallEntityInputFunction() {
				return true;
			},
			Entity(nEntityIndex) {
				return (nEntityIndex === 2_147_483_647) ? null : EntityRecord;
			},
			GetEntityModelName() {
				return "";
			},
			GetNativeEntityByIndex() {
				return EntityRecord;
			},
		};
		const vecRecords = [];
		const Loggers = {
			LogInfo(strFormat, Result) {
				g_Assert.equal(strFormat, `${vecExpectedOperations[vecRecords.length]} Result=%j`);
				vecRecords.push(JSON.parse(JSON.stringify(Result)));
			},
		};
		for (const unBlockIndex of vecBlockIndexes) {
			ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, { "entities/entity": EntityAPI, loggers: Loggers }, "entities-entity.md:core-contracts");
		}

		const strAddress = `0x${unAddress.toString(16).toUpperCase()}`;
		g_Assert.equal(vecRecords.length, vecExpectedOperations.length);
		g_Assert.equal(vecRecords[1].WorldAddress, strAddress);
		g_Assert.equal(vecRecords[2].Address, strAddress);
		g_Assert.equal(vecRecords[3].InputAddress, strAddress);
		g_Assert.equal(vecRecords[2].HandleValue, -2);
		for (const strPresenceField of ["HasBaseEntity", "HasBaseHandle", "HasEdict"]) {
			g_Assert.equal(vecRecords[2][strPresenceField], true);
		}

		g_Assert.equal(EntityRecord.StateFlags, 0x08);
		g_Assert.equal(EntityRecord.NetworkSerialNumber, 17);

		const LoggingFailure = new Error("Controlled entity field logging failure.");
		g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[2], 2, {
			"entities/entity": EntityAPI,
			loggers: {
				LogInfo() {
					throw LoggingFailure;
				},
			},
		}, "entities-entity.md:field-cleanup"), (ErrorValue) => ErrorValue === LoggingFailure);
		g_Assert.equal(EntityRecord.StateFlags, 0x08);
		g_Assert.equal(EntityRecord.NetworkSerialNumber, 17);
	}
}

function VerifyEntityIdentityDocumentation(vecBlocks) {
	for (const unBlockIndex of [7, 11]) {
		for (const nInitialHandleValue of [-1, -2]) {
			const vecCallbacks = [];
			let unInputCallCount = 0;
			const EntityRecord = {
				Index: 2,
				HandleValue: nInitialHandleValue,
				NetworkSerialNumber: 31,
				Valid: true,
				CallEntityInput() {
					unInputCallCount += 1;

					return true;
				},
				CallEntityInputFunction() {
					unInputCallCount += 1;

					return true;
				},
				DelayEntityCallback(flDelaySeconds, Callback, vecCallbackArguments) {
					g_Assert(flDelaySeconds > 0);
					vecCallbacks.push({ Callback, Arguments: vecCallbackArguments });

					return { Running: true };
				},
				RepeatEntityCallback(Callback, vecCallbackArguments) {
					vecCallbacks.push({ Callback, Arguments: vecCallbackArguments });

					return { StartRepeat: () => true };
				},
				CancelEntityTimers() {
					return true;
				},
				EmitEntitySound() {
					return { Entity: 2, StopSound: () => true };
				},
			};
			const ModuleMap = { "entities/entity": { Entity: () => EntityRecord }, loggers: { LogInfo: ValidateEntityDocumentationLog } };
			const Run = () => ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, ModuleMap, "entities-entity.md:identity");
			if (nInitialHandleValue === -1) {
				g_Assert.throws(Run, /no valid native handle for scheduling/);
				g_Assert.equal(vecCallbacks.length, 0);
				continue;
			}

			Run();
			const unExpectedCallbackCount = (unBlockIndex === 7) ? 2 : 1;
			g_Assert.equal(vecCallbacks.length, unExpectedCallbackCount);
			for (const Invocation of vecCallbacks) {
				Invocation.Callback.apply(EntityRecord, Invocation.Arguments);
			}

			g_Assert.equal(unInputCallCount, unExpectedCallbackCount);
			EntityRecord.HandleValue = -3;
			for (const Invocation of vecCallbacks) {
				Invocation.Callback.apply(EntityRecord, Invocation.Arguments);
			}

			g_Assert.equal(unInputCallCount, unExpectedCallbackCount, "Reused entity index reached an input callback.");
			EntityRecord.HandleValue = nInitialHandleValue;

			if (unBlockIndex === 11) {
				EntityRecord.NetworkSerialNumber += 1;
			} else {
				EntityRecord.Valid = false;
			}

			for (const Invocation of vecCallbacks) {
				Invocation.Callback.apply(EntityRecord, Invocation.Arguments);
			}

			g_Assert.equal(unInputCallCount, unExpectedCallbackCount, "Invalid entity identity reached an input callback.");
		}
	}
}

function VerifyRootEntityCoreDocumentation(vecBlocks) {
	const vecProfiles = [];
	for (const unAddress of [0n, 0xFEDCBA9876543210n, 0xFFFFFFFFFFFFFFFFn]) {
		for (const bHasOpaqueRecords of [false, true]) {
			for (const bHasModelMethods of [false, true]) {
				vecProfiles.push({ Address: unAddress, HasOpaqueRecords: bHasOpaqueRecords, HasModelMethods: bHasModelMethods });
			}
		}
	}

	const vecBlockIndexes = [0, 1, 2, 3, 5, 6];
	const vecOperations = ["ReportRootEntityCounts", "ReportRootEntityCapabilities", "ReportOccupiedEntityScan", "ReportRootLiveEntityFields", "ReportDecoratedEntity", "ReportRootEntityReflection"];
	const unActiveEntityCount = 7;
	const unMaximumEntityCount = 128;
	for (const Profile of vecProfiles) {
		const OpaqueRecord = { Address: Profile.Address };
		OpaqueRecord.Self = OpaqueRecord;

		const CreateRecord = (unIndex) => ({
			Address: Profile.Address,
			BaseEntity: Profile.HasOpaqueRecords ? OpaqueRecord : null,
			BaseHandle: Profile.HasOpaqueRecords ? OpaqueRecord : null,
			Edict: Profile.HasOpaqueRecords ? OpaqueRecord : null,
			ClassName: (unIndex === 0) ? "worldspawn" : "prop_dynamic",
			Free: false,
			Valid: true,
			HandleValue: -2,
			Index: unIndex,
			NetworkSerialNumber: 17,
			StateFlags: 0x08,
			GetEntityDataMap: () => null,
			GetEntityProperty: () => 0,
		});
		const mapRecords = new Map([[0, CreateRecord(0)], [1, CreateRecord(1)], [2, CreateRecord(2)]]);
		const Reflection = { Inputs: [{ Name: "Enable" }], KeyValues: [{ Name: "targetname" }], Outputs: [{ Name: "OnTrigger" }], Properties: [{ Name: "m_iHealth" }], ServerClasses: [{ Name: "CBaseEntity" }] };
		const EntityAPI = {
			Entity: unIndex => mapRecords.get(unIndex) ?? null,
			GetEntityCount: () => unActiveEntityCount,
			GetMaximumEntityCount: () => unMaximumEntityCount,
			GetAllEntities: () => [mapRecords.get(0), mapRecords.get(2)],
			GetEntitiesByClassName: () => [mapRecords.get(2)],
			GetEntityClassNameByIndex: unIndex => mapRecords.get(unIndex).ClassName,
			GetEntityDynamicAttributes: () => Reflection,
			GetEntityInputs: () => Reflection.Inputs,
			GetEntityKeyValues: () => Reflection.KeyValues,
			GetEntityOutputs: () => Reflection.Outputs,
			GetEntityProperties: () => Reflection.Properties,
			GetEntityServerClasses: () => Reflection.ServerClasses,
			IsEntityNetworked: () => true,
			DecorateEntity(EntityValue) {
				EntityValue.IsEntityNetworked = () => true;

				if (Profile.HasModelMethods) {
					EntityValue.GetEntityModelName = () => "models/fixture.mdl";
				}

				return EntityValue;
			},
		};
		const vecRecords = [];
		const Loggers = {
			LogInfo(strFormat, Result) {
				ValidateEntityDocumentationLog(strFormat, Result);
				g_Assert.equal(strFormat, `${vecOperations[vecRecords.length]} Result=%j`);
				vecRecords.push(JSON.parse(JSON.stringify(Result)));
			},
		};
		for (const unBlockIndex of vecBlockIndexes) {
			ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, { entities: EntityAPI, loggers: Loggers }, "entities.md:core-contracts");
		}

		g_Assert.equal(vecRecords.length, vecOperations.length);
		g_Assert.deepEqual(vecRecords[0], { ActiveEntityCount: unActiveEntityCount, DynamicPropEntityCount: 1, MaximumEntityCount: unMaximumEntityCount, WorldEntityIndex: 0 });
		g_Assert.deepEqual(vecRecords[1], { DataMapsSupported: true, SendPropertiesSupported: true });
		g_Assert.deepEqual(vecRecords[2], { DynamicPropEntityIndexes: [2], FirstEntityClassName: "worldspawn", ActiveEntityCount: unActiveEntityCount, MaximumEntityCount: unMaximumEntityCount, OccupiedEdictCount: 2 });
		g_Assert.deepEqual(vecRecords[3], { Free: false, Valid: true, HandleValue: -2, HasBaseEntity: Profile.HasOpaqueRecords, HasBaseHandle: Profile.HasOpaqueRecords, HasEdict: Profile.HasOpaqueRecords, Address: `0x${Profile.Address.toString(16).toUpperCase()}`, ClassName: "prop_dynamic", Index: 2, NetworkSerialNumber: 17, StateFlags: 0x08 });
		g_Assert.deepEqual(vecRecords[4], { EntityModelMethodsAvailable: Profile.HasModelMethods, Networked: true, EntityModelName: Profile.HasModelMethods ? "models/fixture.mdl" : "", Source: "example-extension" });
		g_Assert.deepEqual(vecRecords[5], { InputNames: ["Enable"], KeyValueNames: ["targetname"], OutputNames: ["OnTrigger"], PropertyNames: ["m_iHealth"], ServerClassNames: ["CBaseEntity"], Networked: true, DynamicCounts: { InputCount: 1, KeyValueCount: 1, OutputCount: 1, PropertyCount: 1, ServerClassCount: 1 } });
		g_Assert.equal(mapRecords.get(2).StateFlags, 0x08);
		g_Assert.equal(mapRecords.get(2).NetworkSerialNumber, 17);
	}

	for (const bDataMapsSupported of [false, true]) {
		for (const bSendPropertiesSupported of [false, true]) {
			const EntityRecord = {};
			if (bDataMapsSupported) {
				EntityRecord.GetEntityDataMap = () => null;
			}

			if (bSendPropertiesSupported) {
				EntityRecord.GetEntityProperty = () => null;
			}

			let unLogCount = 0;
			ExecuteDocumentationBlock(vecBlocks[1], 1, {
				entities: { Entity: () => EntityRecord },
				loggers: {
					LogInfo(strFormat, Result) {
						unLogCount++;
						g_Assert.equal(strFormat, "ReportRootEntityCapabilities Result=%j");
						g_Assert.deepEqual(JSON.parse(JSON.stringify(Result)), { DataMapsSupported: bDataMapsSupported, SendPropertiesSupported: bSendPropertiesSupported });
					},
				},
			}, "entities.md:optional-capabilities");
			g_Assert.equal(unLogCount, 1);
		}
	}

	g_Assert.equal(g_Entities.Entity(2).BaseEntity.Kind, "baseentity", "The controlled record uses the actual native compact type discriminator.");
}

function VerifyRootEntityLifecycleDocumentation(vecBlocks) {
	const unLifecycleBlockIndex = 4;
	const nOriginalHandle = 7;
	const nOriginalSerial = 3;

	const vecScenarios = [
		"SlayKeepsLive",
		"SlayRemoves",
		"SlayThrows",
		"SlayUnsupported",
		"SlayRejected",
		"SlayReplacesEntity",
		"ObjectRemoveThrows",
		"ObjectRemoveRejected",
		"ObjectRemoveReplacesEntity",
		"ObjectCleanupThrows",
		"RootRemoveThrows",
		"RootRemoveRejected",
		"RootRemoveReplacesEntity",
		"RootCleanupThrows",
	];
	for (const strScenario of vecScenarios) {
		const mapStates = new Map();
		const mapEntities = new Map();
		const vecRemoved = [];
		const SlayError = new Error("The selected input failed.");
		const ObjectRemovalError = new Error("The object removal failed.");
		const RootRemovalError = new Error("The root removal failed.");
		const CleanupError = new Error("The temporary-entity cleanup failed after removal.");
		let nNextIndex = 1;
		const CreateTemporaryEntity = () => {
			const nIndex = nNextIndex++;
			const State = { Valid: true, HandleValue: nOriginalHandle, NetworkSerialNumber: nOriginalSerial, RemoveAttempts: 0 };
			mapStates.set(nIndex, State);
			const EntityValue = {
				Index: nIndex,
				get Valid() {
					return State.Valid;
				},
				get HandleValue() {
					return State.HandleValue;
				},
				get NetworkSerialNumber() {
					return State.NetworkSerialNumber;
				},
				RemoveEntity() {
					State.RemoveAttempts++;

					if ((nIndex === 2) && (State.RemoveAttempts === 1)) {
						if ((strScenario === "ObjectRemoveThrows") || (strScenario === "ObjectCleanupThrows")) {
							throw ObjectRemovalError;
						}

						if (strScenario === "ObjectRemoveRejected") {
							return false;
						}

						if (strScenario === "ObjectRemoveReplacesEntity") {
							State.HandleValue++;
							State.NetworkSerialNumber++;
							return true;
						}
					}

					vecRemoved.push(nIndex);
					State.Valid = false;

					if (((nIndex === 2) && (strScenario === "ObjectCleanupThrows")) || ((nIndex === 3) && (strScenario === "RootCleanupThrows"))) {
						throw CleanupError;
					}

					return true;
				},
			};

			if (strScenario !== "SlayUnsupported") {
				EntityValue.SlayEntity = () => {
					if (strScenario === "SlayThrows") {
						throw SlayError;
					}

					if (strScenario === "SlayRejected") {
						return false;
					}

					if (strScenario === "SlayRemoves") {
						State.Valid = false;

					} else if (strScenario === "SlayReplacesEntity") {
						State.HandleValue++;
						State.NetworkSerialNumber++;
					}

					return true;
				};
			}

			mapEntities.set(nIndex, EntityValue);

			return EntityValue;
		};
		const ModuleMap = {
			entities: {
				Entity: (nIndex) => mapStates.get(nIndex)?.Valid ? mapEntities.get(nIndex) : null,
				RemoveEntityByIndex(nIndex) {
					if ((strScenario === "RootRemoveThrows") || (strScenario === "RootCleanupThrows")) {
						throw RootRemovalError;
					}

					if (strScenario === "RootRemoveRejected") {
						return false;
					}

					if (strScenario === "RootRemoveReplacesEntity") {
						mapStates.get(nIndex).HandleValue++;
						mapStates.get(nIndex).NetworkSerialNumber++;
						return true;
					}

					return mapEntities.get(nIndex).RemoveEntity();
				},
			},
			"entities/factories": { CreateAndSpawnEntityByClassName: CreateTemporaryEntity },
		};
		const Run = () => ExecuteDocumentationBlock(vecBlocks[unLifecycleBlockIndex], unLifecycleBlockIndex, ModuleMap, "entities.md");
		if (strScenario === "SlayThrows") {
			g_Assert.throws(Run, (ErrorValue) => ErrorValue === SlayError);

		} else if (strScenario === "SlayUnsupported") {
			g_Assert.throws(Run, /does not expose Entity.SlayEntity/);

		} else if (strScenario === "SlayRejected") {
			g_Assert.throws(Run, /rejected its kill input/);

		} else if (strScenario === "ObjectRemoveThrows") {
			g_Assert.throws(Run, ErrorValue => ErrorValue === ObjectRemovalError);

		} else if (strScenario === "ObjectRemoveRejected") {
			g_Assert.throws(Run, /Entity\.RemoveEntity\(\) failed/);

		} else if (strScenario === "RootRemoveThrows") {
			g_Assert.throws(Run, ErrorValue => ErrorValue === RootRemovalError);

		} else if (strScenario === "RootRemoveRejected") {
			g_Assert.throws(Run, /entities\.RemoveEntityByIndex/);

		} else if ((strScenario === "ObjectCleanupThrows") || (strScenario === "RootCleanupThrows")) {
			g_Assert.throws(Run, ErrorValue => ErrorValue === CleanupError);

		} else {
			Run();
		}

		if ((strScenario === "SlayRemoves") || (strScenario === "SlayReplacesEntity")) {
			g_Assert.equal(vecRemoved.includes(1), false, "Cleanup must not remove an already destroyed or replaced entity.");

		} else {
			g_Assert.equal(mapStates.get(1).Valid, false, `The temporary entity leaked after ${strScenario}.`);
			g_Assert.equal(vecRemoved.filter((nIndex) => nIndex === 1).length, 1);
		}

		if (strScenario === "SlayReplacesEntity") {
			g_Assert.equal(mapStates.get(1).Valid, true);
		}

		for (const [nIndex, State] of mapStates) {
			if (nIndex === 1) {
				continue;
			}

			const bReplacement = ((nIndex === 2) && (strScenario === "ObjectRemoveReplacesEntity")) || ((nIndex === 3) && (strScenario === "RootRemoveReplacesEntity"));
			g_Assert.equal(State.Valid, bReplacement, `Temporary entity ${nIndex} leaked or a replacement was removed after ${strScenario}.`);

			if (bReplacement) {
				g_Assert.equal(State.RemoveAttempts, (nIndex === 2) ? 1 : 0, "Cleanup must skip the replacement.");
			}
		}
	}
}

function VerifyRootEntityTimerDocumentation(vecBlocks) {
	const nEntityIndex = 2;
	const nOriginalHandle = 7;
	const nOriginalSerial = 3;
	const vecTimerBlockIndexes = [8, 9, 10];

	for (const unBlockIndex of vecTimerBlockIndexes) {
		for (const strScenario of ["OriginalEntity", "RemovedEntity", "ChangedHandle", "ChangedSerial"]) {
			const State = { Valid: true, HandleValue: nOriginalHandle, NetworkSerialNumber: nOriginalSerial, InputCallCount: 0 };
			const vecCallbacks = [];
			const EntityValue = {
				Index: nEntityIndex,
				get Valid() {
					return State.Valid;
				},
				get HandleValue() {
					return State.HandleValue;
				},
				get NetworkSerialNumber() {
					return State.NetworkSerialNumber;
				},
				CallEntityInputFunction() {
					State.InputCallCount++;

					return true;
				},
			};
			const RegisterTimer = (Callback, vecArguments = []) => {
				vecCallbacks.push({ Callback, Arguments: vecArguments });

				return {
					Running: false,
					Status: g_RepeatingTickTaskStatus.STOPPED,
					TimeRemainingSeconds: 0,
					CallDelay() {
						return Callback.apply(EntityValue, vecArguments);
					},
					StartRepeat(...vecStartArguments) {
						const bImmediate = vecStartArguments[2];
						if (bImmediate) {
							Callback.apply(EntityValue, vecArguments);
						}

						return true;
					},
				};
			};
			const FixtureEntities = {
				Entity: () => EntityValue,
				DelayEntityCallback(CurrentEntity, ...vecArguments) {
					g_Assert.strictEqual(CurrentEntity, EntityValue);

					return RegisterTimer(vecArguments[1], vecArguments[2]);
				},
				RepeatEntityCallback(CurrentEntity, Callback, vecArguments) {
					g_Assert.strictEqual(CurrentEntity, EntityValue);

					return RegisterTimer(Callback, vecArguments);
				},
				CancelEntityTimers: () => true,
			};
			EntityValue.DelayEntityCallback = (...vecArguments) => RegisterTimer(vecArguments[1]);
			EntityValue.RepeatEntityCallback = (Callback) => RegisterTimer(Callback);
			EntityValue.CancelEntityTimers = () => true;
			ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, { entities: FixtureEntities, loggers: { LogInfo: ValidateEntityDocumentationLog } }, "entities.md");
			g_Assert.equal(vecCallbacks.length, (unBlockIndex === 10) ? 2 : 1);
			State.InputCallCount = 0;

			if (strScenario === "RemovedEntity") {
				State.Valid = false;

			} else if (strScenario === "ChangedHandle") {
				State.HandleValue++;

			} else if (strScenario === "ChangedSerial") {
				State.NetworkSerialNumber++;
			}

			for (const Record of vecCallbacks) {
				Record.Callback.apply(EntityValue, Record.Arguments);
			}

			g_Assert.equal(State.InputCallCount, (strScenario === "OriginalEntity") ? vecCallbacks.length : 0, `Timer block ${unBlockIndex} accessed entity inputs after ${strScenario}.`);
		}
	}
}

function VerifyRootEntityTimerFailureDocumentation(vecBlocks) {
	const vecSpecifications = [
		{ BlockIndex: 8, Scenarios: ["Success", "LoggingFailure", "CallbackFailure", "LoggingAndCancellationFailure"] },
		{ BlockIndex: 9, Scenarios: ["Success", "LoggingFailure", "CallbackFailure", "StartRejected", "CancellationFailure", "CallbackAndCancellationFailure"] },
		{ BlockIndex: 10, Scenarios: ["Success", "LoggingFailure", "RepeatCreationFailure", "StartRejected", "CancellationFailure", "RepeatCreationAndCancellationFailure"] },
	];
	for (const Specification of vecSpecifications) {
		for (const strScenario of Specification.Scenarios) {
			const vecTimers = [];
			const LoggingError = new Error("The timer report failed.");
			const CallbackError = new Error("The immediate timer callback failed.");
			const CreationError = new Error("Repeat creation failed after delay creation.");
			const CleanupError = new Error("Timer cancellation failed after stopping timers.");
			const bCancellationFailure = strScenario.includes("CancellationFailure");
			const CancelAll = () => {
				for (const Timer of vecTimers) {
					Timer.Running = false;
					Timer.Status = g_RepeatingTickTaskStatus.STOPPED;
				}

				if (bCancellationFailure) {
					throw CleanupError;
				}

				return true;
			};
			const EntityValue = {
				Index: 2,
				Valid: true,
				HandleValue: 7,
				NetworkSerialNumber: 3,
				CancelEntityTimers: CancelAll,
				CallEntityInputFunction() {
					if (strScenario.includes("Callback")) {
						throw CallbackError;
					}

					return true;
				},
			};
			const CreateDelay = (flDelaySeconds, Callback, vecArguments = []) => {
				const Timer = {
					Running: true,
					TimeRemainingSeconds: flDelaySeconds,
					Cancel: CancelAll,
					CallDelay() {
						this.Running = false;

						return Callback.apply(EntityValue, vecArguments);
					},
				};
				vecTimers.push(Timer);

				return Timer;
			};
			const CreateRepeat = (Callback, vecArguments = []) => {
				if (strScenario.startsWith("RepeatCreation")) {
					throw CreationError;
				}

				const Timer = {
					Running: false,
					Status: g_RepeatingTickTaskStatus.STOPPED,
					StartRepeat(...vecStartArguments) {
						if (strScenario === "StartRejected") {
							return false;
						}

						this.Running = true;
						this.Status = g_RepeatingTickTaskStatus.RUNNING;

						const bImmediate = vecStartArguments[2];
						if (bImmediate) {
							Callback.apply(EntityValue, vecArguments);
						}

						return true;
					},
				};
				vecTimers.push(Timer);

				return Timer;
			};
			EntityValue.DelayEntityCallback = CreateDelay;
			EntityValue.RepeatEntityCallback = CreateRepeat;

			let unReportCount = 0;
			const Report = (strFormat, Result) => {
				unReportCount++;
				ValidateEntityDocumentationLog(strFormat, Result);

				if (Specification.BlockIndex === 8) {
					g_Assert.equal(strFormat, "ReportRootEntityDelay Result=%j");
					g_Assert.deepEqual(JSON.parse(JSON.stringify(Result)), { Running: true, TimeRemainingSeconds: 0.25 });

				} else if (Specification.BlockIndex === 9) {
					g_Assert.equal(strFormat, "ReportRootEntityRepeat Result=%j");
					g_Assert.deepEqual(JSON.parse(JSON.stringify(Result)), { Running: false, Status: g_RepeatingTickTaskStatus.STOPPED });

				} else {
					g_Assert.equal(strFormat, "ReportDecoratedRootEntityTimers Result=%j");
					g_Assert.deepEqual(JSON.parse(JSON.stringify(Result)), { DelayRunning: false, RepeatRunning: false });
				}

				if (strScenario.startsWith("Logging")) {
					throw LoggingError;
				}
			};
			const FixtureEntities = {
				Entity: () => EntityValue,
				CancelEntityTimers: CancelAll,
				DelayEntityCallback: (...vecArguments) => CreateDelay(vecArguments[1], vecArguments[2], vecArguments[3]),
				RepeatEntityCallback: (...vecArguments) => CreateRepeat(vecArguments[1], vecArguments[2]),
			};
			const Run = () => ExecuteDocumentationBlock(vecBlocks[Specification.BlockIndex], Specification.BlockIndex, { entities: FixtureEntities, loggers: { LogInfo: Report } }, "entities.md:timer-failure", { log: Report });
			if (bCancellationFailure) {
				g_Assert.throws(Run, ErrorValue => ErrorValue === CleanupError);

			} else if (strScenario === "LoggingFailure") {
				g_Assert.throws(Run, ErrorValue => ErrorValue === LoggingError);

			} else if (strScenario === "CallbackFailure") {
				g_Assert.throws(Run, ErrorValue => ErrorValue === CallbackError);

			} else if (strScenario === "RepeatCreationFailure") {
				g_Assert.throws(Run, ErrorValue => ErrorValue === CreationError);

			} else if (strScenario === "StartRejected") {
				g_Assert.throws(Run, /Unable to start/);

			} else {
				Run();
			}

			g_Assert.equal(vecTimers.some(Timer => Timer.Running), false, `Timer block ${Specification.BlockIndex} leaked an active timer after ${strScenario}.`);
			g_Assert.equal(unReportCount, ((Specification.BlockIndex === 8) || (strScenario === "Success") || (strScenario === "LoggingFailure")) ? 1 : 0);
		}
	}
}

function VerifyRootEntitySoundCleanupDocumentation(vecBlocks) {
	const unSoundBlockIndex = 11;
	for (const strScenario of ["Success", "SecondEmitThrows", "LoggingFailure", "FirstStopThrows", "FirstStopRejected", "LoggingAndStopThrow"]) {
		const vecSounds = [];
		const vecStopAttempts = [];
		const EmissionError = new Error("The second sound emission failed.");
		const LoggingError = new Error("The sound report failed.");
		const StopError = new Error("The first sound stop failed.");
		const Emit = (strSample, Options = {}) => {
			const unSoundIndex = vecSounds.length;
			if ((unSoundIndex === 1) && (strScenario === "SecondEmitThrows")) {
				throw EmissionError;
			}

			const SoundValue = {
				EngineSample: Options.Stream ? `*/${strSample}` : strSample,
				Entity: 2,
				StopSound() {
					vecStopAttempts.push(unSoundIndex);

					if ((unSoundIndex === 0) && ((strScenario === "FirstStopThrows") || (strScenario === "LoggingAndStopThrow"))) {
						throw StopError;
					}

					return (unSoundIndex !== 0) || (strScenario !== "FirstStopRejected");
				},
			};
			vecSounds.push(SoundValue);

			return SoundValue;
		};
		const EntityValue = { Index: 2, EmitEntitySound: Emit };
		let unReportCount = 0;
		const Report = (strFormat, Result) => {
			unReportCount++;
			ValidateEntityDocumentationLog(strFormat, Result);
			g_Assert.equal(strFormat, "ReportRootEntitySounds Result=%j");
			g_Assert.deepEqual(JSON.parse(JSON.stringify(Result)), { StreamSample: "*/sourcejs/tutorial/line01.wav", MechanicalEntityIndex: 2 });

			if (strScenario.startsWith("Logging")) {
				throw LoggingError;
			}
		};
		const Run = () => ExecuteDocumentationBlock(vecBlocks[unSoundBlockIndex], unSoundBlockIndex, { entities: { Entity: () => EntityValue, EmitEntitySound: (...vecArguments) => Emit(vecArguments[1], vecArguments[2]) }, loggers: { LogInfo: Report } }, "entities.md:sound-cleanup", { log: Report });
		if ((strScenario === "FirstStopThrows") || (strScenario === "LoggingAndStopThrow")) {
			g_Assert.throws(Run, ErrorValue => ErrorValue === StopError);

		} else if (strScenario === "SecondEmitThrows") {
			g_Assert.throws(Run, ErrorValue => ErrorValue === EmissionError);

		} else if (strScenario === "LoggingFailure") {
			g_Assert.throws(Run, ErrorValue => ErrorValue === LoggingError);

		} else if (strScenario === "FirstStopRejected") {
			g_Assert.throws(Run, /Unable to stop/);

		} else {
			Run();
		}

		g_Assert.deepEqual(vecStopAttempts, vecSounds.map((SoundValue, unIndex) => unIndex), "Cleanup must attempt every successfully returned sound even if an earlier stop throws.");
		g_Assert.equal(unReportCount, (strScenario === "SecondEmitThrows") ? 0 : 1);
	}
}

function VerifyRootEntityFiniteRestorationDocumentation(vecBlocks) {
	const vecSpecifications = [
		{ Index: 12, Role: "hitbox", Name: "g_flPreviousMinimumX", Message: "Temporary hitbox access requires a finite original minimum X component." },
		{ Index: 13, Role: "origin", Name: "g_flPreviousOriginX", Message: "Temporary entity property access requires a finite original origin X component." },
	];

	for (const Specification of vecSpecifications) {
		const strSource = vecBlocks[Specification.Index];
		const strGuard = `if (!Number.isFinite(${Specification.Name})) {`;
		g_Assert.equal(strSource.split(strGuard).length, 2, "Each reviewed snapshot has one finite guard.");

		const strMutant = strSource.replace(strGuard, "if (false) {");
		new g_VM.Script(strMutant);

		for (const flOriginalValue of [NaN, Infinity, -Infinity]) {
			const VerifyRejectedBeforeWrite = (strProgram) => {
				const State = { Value: flOriginalValue, Health: 100, Writes: 0 };
				const Components = {
					Address: 0x40n,
					Y: 0,
					Z: 0,
					get X() {
						return State.Value;
					},
					set X(flValue) {
						State.Writes++;
						State.Value = flValue;
					},
				};
				const WriteHealth = (strPropertyName, nValue) => {
					g_Assert.equal(strPropertyName, "m_iHealth");

					State.Writes++;
					State.Health = nValue;

					return true;
				};
				const ModelHeader = { Address: 0x80n };
				const Hitbox = { Address: 0x40n, Mins: Components };
				const EntityValue = {
					Index: 2,
					Valid: true,
					HandleValue: 7,
					NetworkSerialNumber: 3,
					GetEntityModelHeader: () => ModelHeader,
					GetEntityPropertyInteger: () => State.Health,
					GetEntityPropertyVector: () => Components,
					GetEntityProperty: () => State.Health,
					SetEntityPropertyInteger: WriteHealth,
					SetEntityProperty: WriteHealth,
				};
				const EntityAPI = {
					Entity: () => EntityValue,
					GetEntityModelName: () => "models/fixture.mdl",
					GetEntityModelHeader: () => ModelHeader,
					GetEntityHitbox: () => Hitbox,
				};
				const Loggers = {
					LogInfo() {
					},
				};
				let Failure = null;

				try {
					ExecuteDocumentationBlock(strProgram, Specification.Index, { entities: EntityAPI, loggers: Loggers }, "entities.md:finite-restoration");
				} catch (ErrorValue) {
					Failure = ErrorValue;
				}

				g_Assert.equal(State.Writes, 0, "Non-finite originals must be rejected before any temporary write.");
				g_Assert.equal(Failure?.name, "RangeError");
				g_Assert.equal(Failure?.message, Specification.Message);
				g_Assert.ok(Object.is(State.Value, flOriginalValue));
				g_Assert.equal(State.Health, 100);
			};

			VerifyRejectedBeforeWrite(strSource);
			g_Assert.throws(() => VerifyRejectedBeforeWrite(strMutant), ErrorValue => (ErrorValue.code === "ERR_ASSERTION") && ErrorValue.message.includes("Non-finite originals must be rejected before any temporary write."), `The ${Specification.Role} guard-bypass mutation must fail the no-write assertion.`);
		}
	}
}

function VerifyRootEntitySecondaryReports(vecBlocks) {
	VerifyRootEntityFiniteRestorationDocumentation(vecBlocks);

	const vecAddresses = [0n, 0xFEDCBA9876543210n, 0xFFFFFFFFFFFFFFFFn];
	for (const unAddress of vecAddresses) {
		const ModelHeader = { Address: unAddress };
		const Hitbox = { Address: unAddress, Mins: { X: -16 } };
		const EntityValue = { Index: 2, CallEntityInputFunction: () => true, GetEntityModelHeader: () => ModelHeader };
		const EntityAPI = {
			Entity: unIndex => (unIndex === 9_999) ? null : EntityValue,
			GetEntitiesByClassName: () => [EntityValue],
			GetEntityInput: () => ({ Address: unAddress }),
			GetEntityOutput: () => ({ Name: "OnAnimationDone" }),
			CallEntityInputFunction: () => true,
			GetEntityModelName: () => "models/fixture.mdl",
			GetEntityModelHeader: () => ModelHeader,
			GetEntityHitbox: () => Hitbox,
		};
		const vecRecords = [];
		const Loggers = {
			LogInfo(strFormat, Result) {
				ValidateEntityDocumentationLog(strFormat, Result);
				vecRecords.push({ Format: strFormat, Result: JSON.parse(JSON.stringify(Result)) });
			},
		};
		for (const unBlockIndex of [7, 12, 16]) {
			ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, { entities: EntityAPI, loggers: Loggers }, "entities.md:secondary-reports");
		}

		const strAddress = `0x${unAddress.toString(16).toUpperCase()}`;
		g_Assert.deepEqual(vecRecords, [
			{ Format: "ReportRootEntityInputMetadata Result=%j", Result: { InputDescriptionAddress: strAddress, OutputName: "OnAnimationDone" } },
			{ Format: "ReportRootEntityHitbox Result=%j", Result: { HitboxAddress: strAddress, ModelHeaderAddress: strAddress, ModelPath: "models/fixture.mdl" } },
			{ Format: "ReportMissingRootEntity Result=%j", Result: { EntityIndex: 9_999, Missing: true } },
		]);
		g_Assert.equal(Hitbox.Mins.X, -16, "The borrowed hitbox write must be restored.");

		const LoggingError = new Error("The hitbox report failed.");
		const FailingLoggers = {
			LogInfo() {
				throw LoggingError;
			},
		};
		g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[12], 12, { entities: EntityAPI, loggers: FailingLoggers }, "entities.md:hitbox-report-failure"), ErrorValue => ErrorValue === LoggingError);
		g_Assert.equal(Hitbox.Mins.X, -16, "Logging failure must not leave shared model memory changed.");
	}

	for (const bMissing of [false, true]) {
		let unLogCount = 0;
		ExecuteDocumentationBlock(vecBlocks[16], 16, {
			entities: { Entity: () => bMissing ? null : { Index: 9_999 } },
			loggers: {
				LogInfo(strFormat, Result) {
					unLogCount++;
					g_Assert.equal(strFormat, "ReportMissingRootEntity Result=%j");
					g_Assert.deepEqual(JSON.parse(JSON.stringify(Result)), { EntityIndex: 9_999, Missing: bMissing });
				},
			},
		}, "entities.md:missing-index");
		g_Assert.equal(unLogCount, 1);
	}
}

function VerifyRootEntityPropertyDocumentation(vecBlocks) {
	const nOriginalHandle = 7;
	const nOriginalSerial = 3;

	for (const unBlockIndex of [13, 14]) {
		const bSendProperties = unBlockIndex === 13;
		const vecScenarios = ["RoundTrip", "WriteRejected", "WriteThrows", "RemovedDuringWrite", "ChangedHandleDuringWrite", "ChangedSerialDuringWrite", "LoggingFailure"];
		if (bSendProperties) {
			vecScenarios.push("VectorXYRoundTrip");
		}

		for (const strScenario of vecScenarios) {
			const State = { Valid: true, HandleValue: nOriginalHandle, NetworkSerialNumber: nOriginalSerial, Health: 100, OriginX: 32, DelaySeconds: Math.fround(0.2), WriteCount: 0, VectorWriteCount: 0 };
			const flOriginalDelaySeconds = State.DelaySeconds;
			const WriteError = new Error("The native property write failed.");
			const LoggingError = new Error("The property report failed.");
			const bWriteFailureScenario = ["WriteThrows", "RemovedDuringWrite", "ChangedHandleDuringWrite", "ChangedSerialDuringWrite"].includes(strScenario);
			const WriteProperty = (strPropertyName, Value) => {
				g_Assert.equal(strPropertyName, bSendProperties ? "m_iHealth" : "m_flDelay");

				State.WriteCount++;

				if ((State.WriteCount === 1) && (strScenario === "WriteRejected")) {
					return false;
				}

				if (bSendProperties) {
					State.Health = Value;

				} else {
					State.DelaySeconds = Math.fround(Value);
				}

				if ((State.WriteCount === 1) && bWriteFailureScenario) {
					if (strScenario === "RemovedDuringWrite") {
						State.Valid = false;

					} else if (strScenario === "ChangedHandleDuringWrite") {
						State.HandleValue++;

					} else if (strScenario === "ChangedSerialDuringWrite") {
						State.NetworkSerialNumber++;
					}

					throw WriteError;
				}

				return true;
			};
			const Origin = {
				Address: 0xFEDCBA9876543210n,
				Y: 0,
				Z: 0,
				get X() {
					return State.OriginX;
				},
				set X(flValue) {
					State.VectorWriteCount++;
					State.OriginX = Math.fround(flValue);
				},
			};
			Origin.Self = Origin;

			if (strScenario === "VectorXYRoundTrip") {
				delete Origin.Z;
			}

			const EntityValue = {
				Index: 2,
				get Valid() {
					return State.Valid;
				},
				get HandleValue() {
					return State.HandleValue;
				},
				get NetworkSerialNumber() {
					return State.NetworkSerialNumber;
				},
				GetEntityPropertyInteger: () => State.Health,
				GetEntityPropertyVector: () => Origin,
				GetEntityProperty: () => State.Health,
				SetEntityPropertyInteger: WriteProperty,
				SetEntityProperty: WriteProperty,
				GetEntityDataMap: () => ({ ClassName: "CLogicRelay" }),
				GetEntityDataMapPropertyFloat: () => State.DelaySeconds,
				GetEntityDataMapProperty: () => State.DelaySeconds,
				SetEntityDataMapPropertyFloat: WriteProperty,
				SetEntityDataMapProperty: WriteProperty,
			};
			const FixtureEntities = { Entity: () => EntityValue, GetEntitiesByClassName: () => [EntityValue] };
			const Loggers = {
				LogInfo(strFormat, Result) {
					ValidateEntityDocumentationLog(strFormat, Result);
					g_Assert.equal(strFormat, bSendProperties ? "ReportRootEntityProperties Result=%j" : "ReportRootEntityDatamap Result=%j");

					if (bSendProperties) {
						const ExpectedOrigin = (strScenario === "VectorXYRoundTrip") ? { X: 40, Y: 0 } : { X: 40, Y: 0, Z: 0 };
						g_Assert.deepEqual(JSON.parse(JSON.stringify(Result)), { Health: 99, Origin: ExpectedOrigin });

					} else {
						g_Assert.deepEqual(JSON.parse(JSON.stringify(Result)), { Delay: Math.fround(flOriginalDelaySeconds + 0.25), ClassName: "CLogicRelay" });
					}

					if (strScenario === "LoggingFailure") {
						throw LoggingError;
					}
				},
			};
			const Run = () => ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, { entities: FixtureEntities, loggers: Loggers }, "entities.md");
			if ((strScenario === "RoundTrip") || (strScenario === "VectorXYRoundTrip")) {
				Run();

			} else if (strScenario === "LoggingFailure") {
				g_Assert.throws(Run, ErrorValue => ErrorValue === LoggingError);

			} else if (strScenario === "WriteRejected") {
				g_Assert.throws(Run, /Unable to write/);

			} else {
				g_Assert.throws(Run, (ErrorValue) => ErrorValue === WriteError);
			}

			const bOriginalEntity = State.Valid && (State.HandleValue === nOriginalHandle) && (State.NetworkSerialNumber === nOriginalSerial);
			g_Assert.equal(State.WriteCount, bOriginalEntity ? 2 : 1, "Cleanup must not restore properties on an invalid or replaced entity.");

			if (bOriginalEntity) {
				g_Assert.equal(State.Health, 100);
				g_Assert.equal(State.OriginX, 32);
				g_Assert.equal(State.DelaySeconds, flOriginalDelaySeconds);

			} else {
				g_Assert.equal(State.VectorWriteCount, 0, "Cleanup must not touch a borrowed vector after entity invalidation.");
			}
		}
	}
}

function VerifyRootEntityCleanupDocumentation(vecBlocks) {
	const unCleanupBlockIndex = 15;
	const nEntityIndex = 2;
	const nOriginalHandle = 7;
	const nOriginalSerial = 3;

	for (const strScenario of ["OriginalEntity", "RemovedOnResolve", "ChangedHandleOnResolve", "ChangedSerialOnResolve", "MissingInputMethod"]) {
		const State = { Valid: true, HandleValue: nOriginalHandle, NetworkSerialNumber: nOriginalSerial, InputCallCount: 0 };
		const Sprite = {
			Index: nEntityIndex,
			get HandleValue() {
				return State.HandleValue;
			},
			get NetworkSerialNumber() {
				return State.NetworkSerialNumber;
			},
		};
		const CurrentEntity = {
			Index: nEntityIndex,
			get Valid() {
				return State.Valid;
			},
			get HandleValue() {
				return State.HandleValue;
			},
			get NetworkSerialNumber() {
				return State.NetworkSerialNumber;
			},
		};

		if (strScenario !== "MissingInputMethod") {
			CurrentEntity.CallEntityInputFunction = function CallEntityInputFunction(strInputName) {
				g_Assert.strictEqual(this, CurrentEntity);
				g_Assert.equal(strInputName, "Kill");
				State.InputCallCount++;

				return true;
			};
		}

		const FixtureEntities = {
			GetEntitiesByClassName: () => [Sprite],
			Entity(nIndex) {
				g_Assert.equal(nIndex, nEntityIndex);

				if (strScenario === "RemovedOnResolve") {
					State.Valid = false;
					return null;
				}

				if (strScenario === "ChangedHandleOnResolve") {
					State.HandleValue++;

				} else if (strScenario === "ChangedSerialOnResolve") {
					State.NetworkSerialNumber++;
				}

				return CurrentEntity;
			},
		};
		const Run = () => ExecuteDocumentationBlock(vecBlocks[unCleanupBlockIndex], unCleanupBlockIndex, { entities: FixtureEntities }, "entities.md");
		if (strScenario === "MissingInputMethod") {
			g_Assert.throws(Run, /does not expose CBaseEntity::AcceptInput/);

		} else {
			Run();
		}

		g_Assert.equal(State.InputCallCount, (strScenario === "OriginalEntity") ? 1 : 0, "A live scan wrapper is not an immutable identity snapshot.");
	}
}

function VerifyEntityModelHitboxDocumentation(vecBlocks) {
	const strModelBlock = vecBlocks.find((strBlock) => strBlock.includes("function InspectEntityModelAndHitbox()"));
	g_Assert.equal(typeof strModelBlock, "string");

	const ModelEntity = {
		GetEntityModelHeader: () => ({ Address: 0x40n }),
		GetEntityHitbox: () => null,
	};
	const EntityModule = {
		Entity: () => ModelEntity,
		GetEntityModelName: () => "models/sourcejs_test.mdl",
	};

	// A retained model need not contain any hitbox; the example must check before reading bounds.
	const ModuleMap = { "entities/entity": EntityModule, loggers: { LogInfo: ValidateEntityDocumentationLog } };
	g_Assert.throws(() => ExecuteDocumentationBlock(strModelBlock, 0, ModuleMap, "entities-entity.md"), /no hitbox at index 0/);

	const strFiniteBoundsGuard = '\tif (!Number.isFinite(flPreviousMinimumX) || !Number.isFinite(flPreviousMaximumX)) {\n\t\tthrow new Error("The selected hitbox has non-finite X bounds that cannot be restored.");\n\t}\n';
	g_Assert.equal(strModelBlock.split(strFiniteBoundsGuard).length, 2, "The model example must contain one pre-write finite-bounds guard.");
	const strGuardBypassBlock = strModelBlock.replace(strFiniteBoundsGuard, "");
	for (const strInvalidBoundName of ["Mins", "Maxs"]) {
		for (const flInvalidBound of [NaN, Infinity, -Infinity]) {
			const VerifyUnrestorableBoundsRejected = (strCode) => {
				const Hitbox = { Address: 0x40n, Mins: {}, Maxs: {} };
				let unWriteCount = 0;
				for (const strBoundName of ["Mins", "Maxs"]) {
					let flStoredX = (strBoundName === strInvalidBoundName) ? flInvalidBound : ((strBoundName === "Mins") ? -1 : 1);
					Object.defineProperty(Hitbox[strBoundName], "X", {
						get() {
							return flStoredX;
						},
						set(flValue) {
							unWriteCount += 1;
							if (!Number.isFinite(flValue)) {
								throw new Error("Controlled studio float setter rejected a non-finite value.");
							}

							flStoredX = flValue;
						},
					});
				}

				ModelEntity.GetEntityHitbox = () => Hitbox;
				const GuardModuleMap = {
					"entities/entity": EntityModule,
					loggers: {
						LogInfo() {
							throw new Error("An unrestorable hitbox must not reach logging.");
						},
					},
				};
				g_Assert.throws(() => ExecuteDocumentationBlock(strCode, 0, GuardModuleMap, "entities-entity.md:unrestorable-hitbox"), /non-finite X bounds that cannot be restored\./, "Unrestorable hitbox bounds must be rejected before writing.");
				g_Assert.equal(unWriteCount, 0, "The guard must reject either invalid saved bound before any setter runs.");
				g_Assert.ok(Object.is(Hitbox[strInvalidBoundName].X, flInvalidBound));
				g_Assert.equal(Hitbox[(strInvalidBoundName === "Mins") ? "Maxs" : "Mins"].X, (strInvalidBoundName === "Mins") ? 1 : -1);
			};
			VerifyUnrestorableBoundsRejected(strModelBlock);
			g_Assert.throws(() => VerifyUnrestorableBoundsRejected(strGuardBypassBlock), (ErrorValue) => (ErrorValue.code === "ERR_ASSERTION") && ErrorValue.message.includes("Unrestorable hitbox bounds must be rejected before writing."), "A missing bounds guard must fail this specific regression.");
		}
	}

	for (const unAddress of [0n, 0xFEDCBA9876543210n, 0xFFFFFFFFFFFFFFFFn]) {
		const Hitbox = { Address: unAddress, Mins: { X: -1 }, Maxs: { X: 1 } };
		ModelEntity.GetEntityHitbox = () => Hitbox;
		ModelEntity.GetEntityModelHeader = () => ({ Address: unAddress });
		ModelEntity.GetEntityModelName = EntityModule.GetEntityModelName;

		let unLogCount = 0;
		ModuleMap.loggers.LogInfo = (strFormat, Result) => {
			g_Assert.equal(strFormat, "InspectEntityModelAndHitbox Result=%j");
			const Snapshot = JSON.parse(JSON.stringify(Result));
			const strAddress = `0x${unAddress.toString(16).toUpperCase()}`;
			g_Assert.equal(Snapshot.HitboxAddress, strAddress);
			g_Assert.equal(Snapshot.ModelHeaderAddress, strAddress);
			g_Assert.equal(Snapshot.ModelPath, EntityModule.GetEntityModelName());
			g_Assert.equal(Snapshot.ObjectModelPath, EntityModule.GetEntityModelName());
			unLogCount += 1;
		};
		ExecuteDocumentationBlock(strModelBlock, 0, ModuleMap, "entities-entity.md:model-addresses");
		g_Assert.equal(unLogCount, 1);
		g_Assert.equal(Hitbox.Mins.X, -1);
		g_Assert.equal(Hitbox.Maxs.X, 1);

		const LoggingFailure = new Error("Controlled model logging failure.");
		ModuleMap.loggers.LogInfo = () => {
			throw LoggingFailure;
		};
		g_Assert.throws(() => ExecuteDocumentationBlock(strModelBlock, 0, ModuleMap, "entities-entity.md:model-cleanup"), (ErrorValue) => ErrorValue === LoggingFailure);
		g_Assert.equal(Hitbox.Mins.X, -1);
		g_Assert.equal(Hitbox.Maxs.X, 1);
	}
}

function VerifyEntityFloatWriteDocumentation(vecBlocks) {
	const vecScenarios = ["ExerciseEntitySendProperties", "ExerciseEntityDataMapProperties"];

	for (const strScenario of vecScenarios) {
		const strBlock = vecBlocks.find((strSource) => strSource.includes(`function ${strScenario}()`));
		g_Assert.equal(typeof strBlock, "string");

		const flRoundingBoundary = 16_777_216;
		const OwnerReference = { Index: 3, Address: 0xFEDCBA9876543210n };
		const State = { Health: 100, Model: "models/sourcejs_float_test.mdl", Owner: OwnerReference, Speed: 1, Delay: flRoundingBoundary, SpawnFlags: 0x00, Origin: { X: flRoundingBoundary, Y: 0, Z: 0 } };
		let unPropertyWriteCount = 0;
		const SerializeState = () => JSON.stringify({ ...State, Owner: State.Owner.Index });
		const strInitialState = SerializeState();
		const mapPropertyNames = new Map([
			["m_iHealth", "Health"],
			["m_ModelName", "Model"],
			["m_hOwnerEntity", "Owner"],
			["m_flLaggedMovementValue", "Speed"],
			["m_flDelay", "Delay"],
			["m_spawnflags", "SpawnFlags"],
			["m_vecOrigin", "Origin"],
			["m_vecAbsOrigin", "Origin"],
		]);
		const Origin = { Address: 0xFEDCBA9876543210n };
		Origin.Self = Origin;
		for (const strAxis of ["X", "Y", "Z"]) {
			Object.defineProperty(Origin, strAxis, {
				get: () => State.Origin[strAxis],
				set: (flValue) => {
					unPropertyWriteCount += 1;
					if (!Number.isFinite(flValue)) {
						throw new Error("Controlled vector setter requires a finite value.");
					}

					State.Origin[strAxis] = Math.fround(flValue);
				},
			});
		}

		const ReadProperty = (strPropertyName) => {
			const strFieldName = mapPropertyNames.get(strPropertyName);
			g_Assert.equal(typeof strFieldName, "string");

			return (strFieldName === "Origin") ? Origin : State[strFieldName];
		};
		const WriteProperty = (strPropertyName, PropertyValue) => {
			unPropertyWriteCount += 1;
			const strFieldName = mapPropertyNames.get(strPropertyName);
			g_Assert.equal(typeof strFieldName, "string");

			if (strFieldName === "Origin") {
				if (!["X", "Y", "Z"].every((strAxis) => Number.isFinite(PropertyValue[strAxis]))) {
					throw new Error("Controlled vector property setter requires finite components.");
				}

				for (const strAxis of ["X", "Y", "Z"]) {
					State.Origin[strAxis] = Math.fround(PropertyValue[strAxis]);
				}

			} else {
				if (((strFieldName === "Speed") || (strFieldName === "Delay")) && !Number.isFinite(PropertyValue)) {
					throw new Error("Controlled float property setter requires a finite value.");
				}

				State[strFieldName] = ((strFieldName === "Speed") || (strFieldName === "Delay")) ? Math.fround(PropertyValue) : PropertyValue;
			}

			return true;
		};
		const EntityObject = { GetEntityDataMap: () => ({ ClassName: "CLogicRelay" }) };
		for (const strFamily of ["GetEntityProperty", "GetEntityDataMapProperty"]) {
			for (const strSuffix of ["", "Integer", "Float", "String", "Vector", "Entity"]) {
				EntityObject[strFamily + strSuffix] = ReadProperty;
				EntityObject[strFamily.replace("Get", "Set") + strSuffix] = WriteProperty;
			}
		}

		const ModuleMap = {
			"entities/entity": { Entity: () => EntityObject },
			entities: { GetEntitiesByClassName: () => [EntityObject] },
			loggers: {
				LogInfo(strFormat, Result) {
					g_Assert.equal(strFormat, `${strScenario} Result=%j`);
					const Snapshot = JSON.parse(JSON.stringify(Result));
					g_Assert.equal(Snapshot.OwnerIndex, OwnerReference.Index);
					g_Assert.deepEqual(Snapshot.Origin, State.Origin);
				},
			},
		};
		ExecuteDocumentationBlock(strBlock, 0, ModuleMap, "entities-entity.md");
		g_Assert.equal(SerializeState(), strInitialState, `${strScenario} did not restore native float state.`);
		g_Assert.strictEqual(State.Owner, OwnerReference);

		const bDataMap = strScenario === "ExerciseEntityDataMapProperties";
		const strSavedFloatName = bDataMap ? "flPreviousDelay" : "flPreviousSpeed";
		const strPropertyFamily = bDataMap ? "datamap" : "send";
		const strFiniteStateGuard = `\tif (!Number.isFinite(${strSavedFloatName}) || !Number.isFinite(PreviousOrigin.X) || !Number.isFinite(PreviousOrigin.Y) || !Number.isFinite(PreviousOrigin.Z)) {\n\t\tthrow new Error("The selected ${strPropertyFamily} properties contain non-finite values that cannot be restored.");\n\t}\n`;
		g_Assert.equal(strBlock.split(strFiniteStateGuard).length, 2, "Each property example must contain one pre-write finite-state guard.");
		const strGuardBypassBlock = strBlock.replace(strFiniteStateGuard, "");
		const vecTargetNames = [bDataMap ? "Delay" : "Speed", "Origin.X", "Origin.Y", "Origin.Z"];
		for (const strTargetName of vecTargetNames) {
			for (const flInvalidValue of [NaN, Infinity, -Infinity]) {
				const VerifyUnrestorableStateRejected = (strCode) => {
					const StateSnapshot = { ...State, Origin: { ...State.Origin } };
					const vecTargetPath = strTargetName.split(".");
					const Target = (vecTargetPath.length === 1) ? State : State.Origin;
					const strTargetProperty = vecTargetPath[vecTargetPath.length - 1];

					try {
						Target[strTargetProperty] = flInvalidValue;
						unPropertyWriteCount = 0;
						g_Assert.throws(() => ExecuteDocumentationBlock(strCode, 0, ModuleMap, "entities-entity.md:unrestorable-properties"), /properties contain non-finite values that cannot be restored\./, "Unrestorable property values must be rejected before writing.");
						g_Assert.equal(unPropertyWriteCount, 0, "The guard must validate every saved float before any setter runs.");
						g_Assert.ok(Object.is(Target[strTargetProperty], flInvalidValue));
					} finally {
						Object.assign(State, StateSnapshot);
						unPropertyWriteCount = 0;
					}
				};
				VerifyUnrestorableStateRejected(strBlock);
				g_Assert.throws(() => VerifyUnrestorableStateRejected(strGuardBypassBlock), (ErrorValue) => (ErrorValue.code === "ERR_ASSERTION") && ErrorValue.message.includes("Unrestorable property values must be rejected before writing."), "A missing property guard must fail this specific regression.");
				g_Assert.equal(SerializeState(), strInitialState);
				g_Assert.strictEqual(State.Owner, OwnerReference);
			}
		}

		const vecUnsafeExpressions = ["Math.fround(PreviousOrigin.X + flOriginDisplacement)"];
		if (strScenario === "ExerciseEntityDataMapProperties") {
			vecUnsafeExpressions.push("Math.fround(flPreviousDelay + flDelayIncrement)");
		}

		for (const strExpression of vecUnsafeExpressions) {
			const strUnroundedBlock = strBlock.replace(strExpression, strExpression.slice("Math.fround".length));
			g_Assert.notEqual(strUnroundedBlock, strBlock);
			g_Assert.throws(() => ExecuteDocumentationBlock(strUnroundedBlock, 0, ModuleMap, "entities-entity.md"), /writes were not visible in native memory/);
			g_Assert.equal(SerializeState(), strInitialState, `${strScenario} did not restore state after an unrounded write.`);
		}

		const LoggingFailure = new Error("Controlled property logging failure.");
		ModuleMap.loggers.LogInfo = () => {
			throw LoggingFailure;
		};
		g_Assert.throws(() => ExecuteDocumentationBlock(strBlock, 0, ModuleMap, "entities-entity.md:property-cleanup"), (ErrorValue) => ErrorValue === LoggingFailure);
		g_Assert.equal(SerializeState(), strInitialState);
		g_Assert.strictEqual(State.Owner, OwnerReference);
	}
}

const g_Entities = LoadEntities();

const g_EntityFactories = {
	CreateAndSpawnEntityByClassName(strClassName) {
		if ((typeof strClassName !== "string") || (strClassName.length === 0)) {
			throw new TypeError("entities/factories.CreateAndSpawnEntityByClassName expects a non-empty class name.");
		}

		const nEntityIndex = Math.max(...g_mapEntityStates.keys()) + 1;
		AddEntity(nEntityIndex, strClassName, { Model: "models/error.mdl" });
		g_vecCreatedEntityIndexes.push(nEntityIndex);
		g_vecNativeCalls.push(["CreateAndSpawnEntityByClassName", strClassName, nEntityIndex]);

		return g_Entities.DecorateEntity(MakeNativeEntity(nEntityIndex));
	},
	CreateAndSpawnEntity(strClassName) {
		return g_EntityFactories.CreateAndSpawnEntityByClassName(strClassName);
	},
};

const g_EntityBase = require(g_strBasePath);
const g_EntityAPI = require(g_strEntityPath);

VerifyEntitySoundRouting();

g_Assert.deepEqual(Object.keys(g_EntityBase).sort(), g_vecBaseExpectedExports.slice().sort());
g_Assert.notStrictEqual(g_EntityAPI, g_NativeEntityModule);
g_Assert.deepEqual(Object.keys(g_EntityAPI).sort(), g_vecEntityExpectedExports.slice().sort());
g_Assert.equal(typeof g_EntityAPI.Entity, "function");
g_Assert.deepEqual(Object.keys(g_Entities).sort(), g_vecRootExpectedExports.slice().sort());

const g_OriginalFocusedEntityFactory = g_EntityAPI.Entity;
const g_FocusedEntityReplacement = MakeNativeEntity(2);
g_EntityAPI.Entity = () => g_FocusedEntityReplacement;
g_Assert.strictEqual(g_EntityAPI.Entity(2), g_FocusedEntityReplacement);
g_EntityAPI.Entity = g_OriginalFocusedEntityFactory;

const g_OriginalAllEntities = g_NativeEntities.GetAllEntities;
const g_OriginalEntityClassName = g_NativeEntities.GetEntityClassName;
const g_vecLiveEntityList = [MakeNativeEntity(2)];
g_NativeEntities.GetAllEntities = () => g_vecLiveEntityList;
g_Assert.strictEqual(g_Entities.GetAllEntities(), g_vecLiveEntityList);
g_Assert.equal(typeof g_vecLiveEntityList[0].GetEntityProperties, "function");
g_NativeEntities.GetAllEntities = g_OriginalAllEntities;

g_NativeEntities.GetEntityClassName = () => "live_entity_class";
g_Assert.equal(g_Entities.GetEntityClassNameByIndex(2), "live_entity_class");
g_NativeEntities.GetEntityClassName = g_OriginalEntityClassName;

const g_Entity = g_Entities.Entity(2);
const g_CanceledDelay = g_Entities.DelayEntityCallback(g_Entity, 1, () => true);
const g_StoppedRepeat = g_Entities.RepeatEntityCallback(g_Entity, () => true);

g_Assert.equal(g_CanceledDelay.Cancel(), true);
g_Assert.equal(g_StoppedRepeat.Stop(), false);
g_CanceledDelay.Cancel = () => {
	throw new Error("Canceled delay remained tracked.");
};
g_StoppedRepeat.Stop = () => {
	throw new Error("Stopped repeat remained tracked.");
};
g_Assert.equal(g_Entities.CancelEntityTimers(g_Entity), true);
g_Assert.throws(() => g_Entities.DelayEntityCallback(g_Entity, 1, () => true, [], null), /Timer options/);

for (const InvalidCallback of [undefined, null, false, 1, "Callback", {}]) {
	g_Assert.throws(() => g_Entities.DelayEntityCallback(g_Entity, 1, InvalidCallback), { name: "TypeError", message: "Callback must be a function." });
	g_Assert.throws(() => g_Entities.RepeatEntityCallback(g_Entity, InvalidCallback), { name: "TypeError", message: "Callback must be a function." });
}

{
	const RepeatTimer = g_Entities.RepeatEntityCallback(g_Entity, () => true);
	try {
		g_Assert.equal(RepeatTimer.StartRepeat(1), true);
		g_Assert.equal(RepeatTimer.Stop(), true);
		g_Assert.equal(RepeatTimer.StartRepeat(1), true);
		g_Assert.equal(g_Entities.CancelEntityTimers(g_Entity), true);
		g_Assert.equal(RepeatTimer.RepeatingTickTaskStatus, g_RepeatingTickTaskStatus.STOPPED);
	} finally {
		RepeatTimer.Stop();
	}
}

{
	const unMillisecondsPerSecond = 1_000;
	let unNowMilliseconds = 0;
	const mapTickListeners = new Map();
	const LoadActualModule = (strFilePath, ModuleMap, strResultExpression) => {
		const strSource = g_FileSystem.readFileSync(strFilePath, "utf8");
		const Script = new g_VM.Script(`(function (require, module, exports) {\n${strSource}\nreturn (${strResultExpression});\n})`, { filename: strFilePath });
		const Factory = Script.runInNewContext({ Date: { now: () => unNowMilliseconds }, TypeError });
		const ModuleInstance = { exports: {} };
		const RequireModule = (strModuleName) => {
			g_Assert.equal(Object.hasOwn(ModuleMap, strModuleName), true, strModuleName);

			return ModuleMap[strModuleName];
		};

		return Factory(RequireModule, ModuleInstance, ModuleInstance.exports);
	};
	const TickModule = LoadActualModule(g_strTickPath, {
		"internal/runtime": {
			GetModule(strModuleName) {
				g_Assert.equal(strModuleName, "listeners/tick");

				return {
					GetMonotonicTimeSeconds() {
						return unNowMilliseconds / unMillisecondsPerSecond;
					},
				};
			},
		},
		listeners: {
			RegisterListener(strEventName, Callback) {
				g_Assert.equal(mapTickListeners.has(strEventName), false);

				mapTickListeners.set(strEventName, Callback);

				return true;
			},
			UnregisterListener(strEventName, Callback) {
				g_Assert.strictEqual(mapTickListeners.get(strEventName), Callback);

				return mapTickListeners.delete(strEventName);
			},
		},
		"memory/hooks/exceptions": {
			EXCEPTION_HOOKS: {
				PrintException(ErrorValue) {
					throw ErrorValue;
				},
			},
		},
	}, "{ API: module.exports, ScheduledDelays: g_vecScheduledTickDelays, ActiveRepeats: g_setActiveRepeatingTickTasks }");
	const NativeEntities = { ...g_NativeEntities };
	const EntityModule = LoadActualModule(g_strBasePath, {
		"internal/runtime": {
			GetModule(strModuleName) {
				g_Assert.equal(strModuleName, "entities");

				return NativeEntities;
			},
		},
		"listeners/tick": TickModule.API,
		"engines/sound": { Sound, StreamSound },
		"studio/cache": g_StudioCache,
		"entities/datamaps": g_DataMaps,
		"entities/classes": g_Classes,
	}, "{ API: module.exports, DelayRegistry: g_mapTrackedDelays, RepeatRegistry: g_mapTrackedRepeats }");
	const EntityReference = { Index: 2 };
	const RepeatingTaskStatus = TickModule.API.RepeatingTickTaskStatus;

	for (const InvalidCallback of [undefined, null, false, 1, "Callback", {}]) {
		g_Assert.throws(() => EntityModule.API.DelayEntityCallback(EntityReference, 1, InvalidCallback), { name: "TypeError", message: "Callback must be a function." });
		g_Assert.throws(() => EntityModule.API.RepeatEntityCallback(EntityReference, InvalidCallback), { name: "TypeError", message: "Callback must be a function." });
	}

	g_Assert.equal(TickModule.ScheduledDelays.length, 0);
	g_Assert.equal(EntityModule.DelayRegistry.size, 0);
	g_Assert.equal(EntityModule.RepeatRegistry.size, 0);

	const RestartedTimer = EntityModule.API.RepeatEntityCallback(EntityReference, () => true);
	g_Assert.equal(RestartedTimer.StartRepeat(1), true);
	g_Assert.equal(RestartedTimer.Stop(), true);
	g_Assert.equal(RestartedTimer.StartRepeatingTickTask(1), true);
	g_Assert.equal(RestartedTimer.RestartRepeatingTickTask(), true);
	g_Assert.equal(RestartedTimer.PauseRepeatingTickTask(), true);
	g_Assert.equal(EntityModule.RepeatRegistry.has(EntityReference.Index), true);
	g_Assert.equal(RestartedTimer.ResumeRepeatingTickTask(), true);
	g_Assert.equal(EntityModule.API.CancelEntityTimers(EntityReference), true);
	g_Assert.equal(RestartedTimer.RepeatingTickTaskStatus, RepeatingTaskStatus.STOPPED);
	g_Assert.equal(EntityModule.RepeatRegistry.size, 0);

	const OwnerTimer = EntityModule.API.RepeatEntityCallback(EntityReference, () => true);
	const ForeignTimer = new TickModule.API.RepeatingTickTask(() => true);
	g_Assert.equal(OwnerTimer.StartRepeat(1), true);
	g_Assert.equal(OwnerTimer.StartRepeatingTickTask.call(ForeignTimer, 1), true);
	g_Assert.equal(OwnerTimer.StopRepeatingTickTask.call(ForeignTimer), true);
	g_Assert.equal(OwnerTimer.RepeatingTickTaskStatus, RepeatingTaskStatus.RUNNING);
	g_Assert.equal(Object.getOwnPropertyDescriptor(OwnerTimer, "StartRepeatingTickTask").enumerable, false);
	g_Assert.equal(Object.getOwnPropertyDescriptor(OwnerTimer, "StopRepeatingTickTask").enumerable, false);
	EntityModule.API.CancelEntityTimers(EntityReference);
	g_Assert.equal(OwnerTimer.RepeatingTickTaskStatus, RepeatingTaskStatus.STOPPED);

	let unImmediateCallbackCount = 0;
	const CanceledOnStartTimer = EntityModule.API.RepeatEntityCallback(EntityReference, function CancelOnStart(strArgument) {
		g_Assert.strictEqual(this, EntityReference);
		g_Assert.equal(strArgument, "Immediate");

		unImmediateCallbackCount += 1;
		EntityModule.API.CancelEntityTimers(EntityReference);
	}, ["Immediate"]);
	CanceledOnStartTimer.Stop();
	g_Assert.equal(CanceledOnStartTimer.StartRepeat(1, Infinity, true), true);
	g_Assert.equal(unImmediateCallbackCount, 1);
	g_Assert.equal(CanceledOnStartTimer.RepeatingTickTaskStatus, RepeatingTaskStatus.STOPPED);
	g_Assert.equal(EntityModule.RepeatRegistry.size, 0);

	const CallbackError = new Error("Immediate callback failure");
	const ThrowingTimer = EntityModule.API.RepeatEntityCallback(EntityReference, () => {
		throw CallbackError;
	});
	ThrowingTimer.Stop();
	g_Assert.throws(() => ThrowingTimer.StartRepeat(1, Infinity, true), (ErrorValue) => ErrorValue === CallbackError);
	g_Assert.equal(ThrowingTimer.RepeatingTickTaskStatus, RepeatingTaskStatus.RUNNING);
	EntityModule.API.CancelEntityTimers(EntityReference);
	g_Assert.equal(ThrowingTimer.RepeatingTickTaskStatus, RepeatingTaskStatus.STOPPED);

	const InvalidStartTimer = EntityModule.API.RepeatEntityCallback(EntityReference, () => true);
	InvalidStartTimer.Stop();
	g_Assert.throws(() => InvalidStartTimer.StartRepeat(-1), /non-negative finite number/);
	g_Assert.equal(EntityModule.RepeatRegistry.size, 0);
	g_Assert.equal(InvalidStartTimer.StartRepeat(1, 0), true);
	g_Assert.equal(EntityModule.RepeatRegistry.size, 0);

	let unFinishedCallbackCount = 0;
	const FinishedTimer = EntityModule.API.RepeatEntityCallback(EntityReference, () => {
		unFinishedCallbackCount += 1;
	});
	g_Assert.equal(FinishedTimer.StartRepeat(1, 1), true);
	unNowMilliseconds += unMillisecondsPerSecond;
	mapTickListeners.get("Tick")();
	g_Assert.equal(unFinishedCallbackCount, 1);
	g_Assert.equal(FinishedTimer.RepeatingTickTaskStatus, RepeatingTaskStatus.STOPPED);
	g_Assert.equal(EntityModule.RepeatRegistry.size, 0);

	const CompletedCallbackError = new Error("Completed callback failure");
	const CompletedThrowingTimer = EntityModule.API.RepeatEntityCallback(EntityReference, () => {
		throw CompletedCallbackError;
	});
	CompletedThrowingTimer.StartRepeat(1, 1);
	unNowMilliseconds += unMillisecondsPerSecond;
	g_Assert.throws(() => mapTickListeners.get("Tick")(), (ErrorValue) => ErrorValue === CompletedCallbackError);
	g_Assert.equal(CompletedThrowingTimer.RepeatingTickTaskStatus, RepeatingTaskStatus.STOPPED);
	g_Assert.equal(EntityModule.RepeatRegistry.size, 0);

	const CanceledDelay = EntityModule.API.DelayEntityCallback(EntityReference, 1, () => true);
	g_Assert.equal(CanceledDelay.CancelTickDelay(), true);
	g_Assert.equal(EntityModule.DelayRegistry.size, 0);
	g_Assert.throws(() => CanceledDelay.CancelTickDelay(), /not running/);

	const DisposedDelay = EntityModule.API.DelayEntityCallback(EntityReference, 1, () => true);
	g_Assert.equal(DisposedDelay.DisposeTickDelay(), true);
	g_Assert.equal(EntityModule.DelayRegistry.size, 0);

	const FinishedDelay = EntityModule.API.DelayEntityCallback(EntityReference, 1, () => true);
	unNowMilliseconds += unMillisecondsPerSecond;
	mapTickListeners.get("Tick")();
	g_Assert.equal(FinishedDelay.Running, false);
	g_Assert.equal(EntityModule.DelayRegistry.size, 0);

	const LevelEndDelay = EntityModule.API.DelayEntityCallback(EntityReference, 1, () => true, [], { CancelOnLevelEnd: true });
	const LevelEndRepeat = EntityModule.API.RepeatEntityCallback(EntityReference, () => true, [], { CancelOnLevelEnd: true });
	g_Assert.equal(LevelEndRepeat.StartRepeat(1), true);
	mapTickListeners.get("LevelEnd")();
	g_Assert.equal(LevelEndDelay.Running, false);
	g_Assert.equal(LevelEndRepeat.RepeatingTickTaskStatus, RepeatingTaskStatus.STOPPED);
	g_Assert.equal(EntityModule.DelayRegistry.size, 0);
	g_Assert.equal(EntityModule.RepeatRegistry.size, 0);
	g_Assert.equal(TickModule.ScheduledDelays.length, 0);
	g_Assert.equal(TickModule.ActiveRepeats.size, 0);
}

g_Assert.equal(g_Entity.Index, 2);
g_Assert.equal(g_Entity.Valid, true);
g_Assert.equal(g_Entity.Free, false);
g_Assert.equal(g_Entity.ClassName, "prop_dynamic");
g_Assert.equal(g_Entity.Address, 0x100200n);

{
	const State = g_mapEntityStates.get(g_Entity.Index);
	const bWasFree = State.Free;
	try {
		State.Free = true;
		g_Assert.equal(g_Entity.Address, 0n, "detached entity fixture address must be BigInt zero");
	} finally {
		State.Free = bWasFree;
	}
}
g_Assert.equal(g_Entity.GetEntityModelName(), "models/props_interiors/table_folding.mdl");

function VerifyEntityModelHeaderCleanupFailures() {
	const FindModelHandle = g_StudioCache.FindModelHandle;
	const RequireModelHeader = g_StudioCache.RequireModelHeader;
	const ReleaseModelHandle = g_StudioCache.Release;
	const vecFailureValues = [new Error("model-header failure"), { Failure: "opaque" }, null, undefined, false, 0, ""];
	const Header = {};
	let unScenarioCount = 0;
	try {
		for (const FailureValue of vecFailureValues) {
			const CleanupFailureValue = vecFailureValues[(vecFailureValues.indexOf(FailureValue) + 1) % vecFailureValues.length];
			for (const strFailureMode of ["None", "Header", "Release", "Both", "Invalid"]) {
				const bInvalidHandle = strFailureMode === "Invalid";
				const bHeaderFailure = (strFailureMode === "Header") || (strFailureMode === "Both") || bInvalidHandle;
				const bReleaseFailure = (strFailureMode === "Release") || (strFailureMode === "Both");
				const hModelHandle = bInvalidHandle ? g_StudioCache.INVALID_MODEL_HANDLE : g_hStudioModelHandle;
				const vecCalls = [];
				g_StudioCache.FindModelHandle = (strPath) => {
					g_Assert.equal(strPath, "models/props_interiors/table_folding.mdl");
					vecCalls.push("Find");

					return hModelHandle;
				};
				g_StudioCache.RequireModelHeader = (hHandle) => {
					g_Assert.equal(hHandle, hModelHandle);
					vecCalls.push("Header");

					if (bHeaderFailure) {
						throw FailureValue;
					}

					return Header;
				};
				g_StudioCache.Release = (hHandle) => {
					g_Assert.equal(hHandle, hModelHandle);
					vecCalls.push("Release");

					if (bReleaseFailure) {
						throw CleanupFailureValue;
					}

					return 1;
				};

				let Result;
				let CaughtError;
				let bCaught = false;
				try {
					Result = g_Entities.GetEntityModelHeader(g_Entity);
				} catch (ErrorValue) {
					bCaught = true;
					CaughtError = ErrorValue;
				}

				const unErrorCount = Number(bHeaderFailure) + Number(bReleaseFailure);
				g_Assert.equal(bCaught, unErrorCount !== 0);

				if (unErrorCount === 0) {
					g_Assert.strictEqual(Result, Header);
				} else if (unErrorCount === 1) {
					g_Assert.strictEqual(CaughtError, bHeaderFailure ? FailureValue : CleanupFailureValue);
				} else {
					g_Assert.ok((CaughtError !== null) && (typeof CaughtError === "object") && (CaughtError.name === "AggregateError"), "Model header cleanup must preserve both failures.");
					g_Assert.deepEqual(Array.from(CaughtError.errors), [FailureValue, CleanupFailureValue]);
				}

				g_Assert.deepEqual(vecCalls, bInvalidHandle ? ["Find", "Header"] : ["Find", "Header", "Release"]);
				unScenarioCount += 1;
			}
		}
	} finally {
		g_StudioCache.FindModelHandle = FindModelHandle;
		g_StudioCache.RequireModelHeader = RequireModelHeader;
		g_StudioCache.Release = ReleaseModelHandle;
	}

	g_Assert.equal(unScenarioCount, 35);
	console.log("Entity model-header cleanup 35 profiles passed.");
}

VerifyEntityModelHeaderCleanupFailures();

g_Assert.equal(g_Entity.GetEntityModelHeader(), g_ModelHeader);
g_Assert.equal(g_unStudioReferenceCount, g_unEngineModelReferenceCount);

{
	const FindModelHandle = g_StudioCache.FindModelHandle;
	const RequireModelHeader = g_StudioCache.RequireModelHeader;
	const ReleaseModelHandle = g_StudioCache.Release;
	const ModelHeaderError = new Error("Model header unavailable.");
	try {
		g_StudioCache.RequireModelHeader = () => {
			throw ModelHeaderError;
		};
		g_Assert.throws(() => g_Entity.GetEntityModelHeader(), (ErrorValue) => ErrorValue === ModelHeaderError);
		g_Assert.equal(g_unStudioReferenceCount, g_unEngineModelReferenceCount);
		g_StudioCache.RequireModelHeader = RequireModelHeader;
		g_StudioCache.FindModelHandle = () => g_StudioCache.INVALID_MODEL_HANDLE;
		g_StudioCache.Release = () => {
			throw new Error("An invalid model handle must not be released.");
		};
		g_Assert.throws(() => g_Entity.GetEntityModelHeader(), { name: "Error", message: "Invalid model handle." });
		g_Assert.equal(g_unStudioReferenceCount, g_unEngineModelReferenceCount);
		g_StudioCache.FindModelHandle = FindModelHandle;
		g_StudioCache.Release = ReleaseModelHandle;
		g_unStudioReferenceCount = 0;
		g_Assert.throws(() => g_Entity.GetEntityModelHeader(), /must remain retained/);
		g_Assert.equal(g_unStudioReferenceCount, 0);
	} finally {
		g_StudioCache.FindModelHandle = FindModelHandle;
		g_StudioCache.RequireModelHeader = RequireModelHeader;
		g_StudioCache.Release = ReleaseModelHandle;
		g_unStudioReferenceCount = g_unEngineModelReferenceCount;
	}
}

g_Assert.equal(g_Entity.GetEntityHitbox(0), g_Hitbox);
g_Assert.equal(g_Entity.GetEntityInput("SetAnimation").Description.Name, "SetAnimation");
g_Assert.equal(g_Entity.GetEntityOutput("OnAnimationDone").Name, "OnAnimationDone");
g_Assert.equal(g_Entity.GetEntityServerClasses()[0], g_DynamicServerClass);
g_Assert.deepEqual(g_Entity.GetEntityProperties(), g_vecPropertyFields);
g_Assert.equal(g_Entity.GetEntityDynamicAttributes().Inputs.length, g_vecInputFields.length);
g_Assert.equal(g_Entity.CallEntityInputFunction("SetAnimation", "idle_closed"), true);
g_Assert.equal(g_mapEntityStates.get(2).Animation, "idle_closed");
g_Assert.equal(g_Entities.Entity(9_999), null);
g_Assert.equal(typeof g_Entity.GetEntityPropertyInteger, "function");
g_Assert.equal(typeof g_Entity.GetEntityDataMapPropertyFloat, "function");
g_Assert.equal(Object.hasOwn(g_Entities, "moduleName"), false);
g_Assert.throws(() => g_EntityAPI.Entity("2"), /integer index/);

{
	const nMinimumEntityIndex = -2_147_483_648;
	const nMaximumEntityIndex = 2_147_483_647;
	for (const nMissingEntityIndex of [nMinimumEntityIndex, -1, nMaximumEntityIndex]) {
		g_Assert.equal(g_EntityAPI.GetNativeEntityByIndex(nMissingEntityIndex), null);
		g_Assert.equal(g_EntityAPI.Entity(nMissingEntityIndex), null);
	}

	for (const nInvalidEntityIndex of [nMinimumEntityIndex - 1, nMaximumEntityIndex + 1]) {
		g_Assert.throws(() => g_EntityAPI.GetNativeEntityByIndex(nInvalidEntityIndex), /integer index/);
		g_Assert.throws(() => g_EntityAPI.Entity(nInvalidEntityIndex), /integer index/);
	}
}

g_Assert.throws(() => g_EntityAPI.CallEntityInputFunction(g_Entity, "Enable", {}, 0), /input value/);
g_Assert.throws(() => g_EntityAPI.CallEntityInputFunction(g_Entity, "Enable", undefined, Number.NaN), /delay/);
g_Assert.throws(() => g_EntityAPI.CallEntityInputFunction(g_Entity, "", undefined, 0), /input name/);
g_Assert.throws(() => g_Entities.EmitEntitySound(g_Entity, "buttons/button10.wav", null), /SoundOptions must be an object/);
g_Assert.throws(() => g_Entities.EmitEntitySound(g_Entity, "buttons/button10.wav", { Stream: "true" }), /Stream must be a boolean/);

const g_setExercisedExports = new Set();
const g_setExercisedEntityExports = new Set();
const g_DocumentedEntityAPI = {};
const g_DocumentedEntities = {};

for (const [strName, Export] of Object.entries(g_Entities)) {
	g_DocumentedEntities[strName] = (...vecArguments) => {
		g_setExercisedExports.add(strName);

		return Export(...vecArguments);
	};
}

for (const [strName, Export] of Object.entries(g_EntityAPI)) {
	g_DocumentedEntityAPI[strName] = (...vecArguments) => {
		g_setExercisedEntityExports.add(strName);

		return Export(...vecArguments);
	};
}

function VerifyWorldEntityExamples(EntityAPI) {
	const unScriptTimeoutMilliseconds = 1_000;

	const strExamplePath = g_Path.join(g_strProjectRoot, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8").replace(/\r\n/g, "\n");
	const vecFunctions = ["IsInt32", "ParseIndex", "RunEntityAction"].map((strName) => {
		const nFunctionStart = strExample.indexOf(`\nfunction ${strName}(`);
		const nFunctionEnd = strExample.indexOf("\nfunction ", nFunctionStart + 1);
		g_Assert.ok((nFunctionStart >= 0) && (nFunctionEnd > nFunctionStart), `world function ${strName} must remain available`);

		return strExample.slice(nFunctionStart, nFunctionEnd);
	});
	const vecWarnings = [];
	g_VM.runInNewContext(`${vecFunctions.join("\n")}\nRunEntityAction(["entity", "9999", "remove", "confirm"]);`, {
		Entity: EntityAPI.Entity,
		g_strCommandName: "sjs_api_world",
		LogWarning: (strMessage) => vecWarnings.push(strMessage),
	}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });
	g_Assert.equal(vecWarnings.length, 1);
	g_Assert.match(vecWarnings[0], /Entity 9999 was not found/);

	const unExampleEntityIndex = Math.max(...g_mapEntityStates.keys()) + 1;
	AddEntity(unExampleEntityIndex, "logic_relay");
	try {
		for (const vecArguments of [["entity", String(unExampleEntityIndex), "input", "Enable", "", "0", "confirm"], ["entity", String(unExampleEntityIndex), "remove", "confirm"]]) {
			g_VM.runInNewContext(`${vecFunctions.join("\n")}\nRunEntityAction(vecArguments);`, {
				Entity: EntityAPI.Entity,
				g_strCommandName: "sjs_api_world",
				vecArguments,
				LogWarning: (strMessage) => g_Assert.fail(strMessage),
			}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });
		}

		g_Assert.equal(g_mapEntityStates.get(unExampleEntityIndex).Free, true);
		g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "CallEntityInput") && (vecCall[1] === unExampleEntityIndex) && (vecCall[2] === "Enable")));
	} finally {
		g_mapEntityStates.delete(unExampleEntityIndex);
	}

	const vecMatch = strExample.match(/\tLogResult\("entities\/entity.Entity",[\s\S]*?\n\t}\);/);
	g_Assert.ok(vecMatch, "world entity inspection callback must remain available");

	for (const bPresent of [false, true]) {
		let Result = undefined;
		g_VM.runInNewContext(vecMatch[0], {
			Entity: EntityAPI.Entity,
			GetEntitiesByClassName: (strClassName) => bPresent ? g_Entities.GetEntitiesByClassName(strClassName) : [],
			IsEntityValid: (unIndex) => g_Entities.Entity(unIndex)?.Valid === true,
			LogResult: (strLabel, Callback) => {
				g_Assert.equal(strLabel, "entities/entity.Entity");
				Result = Callback();
			},
		}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });

		if (!bPresent) {
			g_Assert.equal(Result, null);
			continue;
		}

		g_Assert.equal(Result.Index, 0);
		g_Assert.equal(Result.ClassName, "worldspawn");
		g_Assert.equal(Result.ModelName, g_mapEntityStates.get(0).Model);
		g_Assert.equal(Result.Valid, true);
		g_Assert.equal(Array.isArray(Result.Inputs) && Array.isArray(Result.Outputs) && Array.isArray(Result.Properties), true);
	}
}

VerifyWorldEntityExamples(g_EntityAPI);

const g_strRootDocumentation = g_FileSystem.readFileSync(g_strRootDocumentationPath, "utf8");
const g_vecRootDocumentationBlocks = ExtractJavaScriptBlocks(g_strRootDocumentation);
g_Assert.equal(g_vecRootDocumentationBlocks.length, 17);
VerifyRootEntityCoreDocumentation(g_vecRootDocumentationBlocks);
VerifyRootEntityLifecycleDocumentation(g_vecRootDocumentationBlocks);
VerifyRootEntityTimerDocumentation(g_vecRootDocumentationBlocks);
VerifyRootEntityTimerFailureDocumentation(g_vecRootDocumentationBlocks);
VerifyRootEntitySoundCleanupDocumentation(g_vecRootDocumentationBlocks);
VerifyRootEntitySecondaryReports(g_vecRootDocumentationBlocks);
VerifyRootEntityPropertyDocumentation(g_vecRootDocumentationBlocks);
VerifyRootEntityCleanupDocumentation(g_vecRootDocumentationBlocks);

for (const [unIndex, strSource] of g_vecRootDocumentationBlocks.entries()) {
	ExecuteDocumentationBlock(strSource, unIndex, {
		entities: g_DocumentedEntities,
		"entities/factories": g_EntityFactories,
		loggers: { LogInfo: ValidateEntityDocumentationLog },
	}, "entities.md");
}

for (const strExportName of g_vecRootExpectedExports) {
	g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not execute entities.${strExportName}().`);
}

const g_strEntityDocumentation = g_FileSystem.readFileSync(g_strEntityDocumentationPath, "utf8");
const g_vecEntityDocumentationBlocks = ExtractJavaScriptBlocks(g_strEntityDocumentation);
g_Assert.equal(g_vecEntityDocumentationBlocks.length, 12);
g_Assert.doesNotMatch(g_strEntityDocumentation, /Generated by|generate_api_docs/);

VerifyEntityModelHitboxDocumentation(g_vecEntityDocumentationBlocks);
VerifyEntityFloatWriteDocumentation(g_vecEntityDocumentationBlocks);
VerifyEntityCoreDocumentation(g_vecEntityDocumentationBlocks);
VerifyEntityIdentityDocumentation(g_vecEntityDocumentationBlocks);

for (const [unIndex, strSource] of g_vecEntityDocumentationBlocks.entries()) {
	ExecuteDocumentationBlock(strSource, unIndex, {
		entities: g_DocumentedEntities,
		"entities/entity": g_DocumentedEntityAPI,
		"entities/factories": g_EntityFactories,
		loggers: { LogInfo: ValidateEntityDocumentationLog },
	}, "entities-entity.md");
}

for (const strExportName of g_vecEntityExpectedExports) {
	g_Assert.equal(g_setExercisedEntityExports.has(strExportName), true, `Documentation did not execute entities/entity.${strExportName}().`);
}

g_Assert.equal(g_vecCreatedEntityIndexes.length, 5);

for (const nEntityIndex of g_vecCreatedEntityIndexes) {
	g_Assert.equal(g_mapEntityStates.get(nEntityIndex).Free, true, `Created entity ${nEntityIndex} was not removed.`);
}

g_Assert.equal(g_mapEntityStates.get(5).Free, true);
g_Assert.equal(g_mapEntityStates.get(6).Free, true);
g_Assert.equal(g_mapEntityStates.get(1).Health, 80);
g_Assert.equal(g_mapEntityStates.get(1).Origin.X, 10);
g_Assert.equal(g_mapEntityStates.get(2).StateFlags, 0x00);
g_Assert.equal(g_mapEntityStates.get(3).DatamapValues.m_flDelay, 1.5);
g_Assert.equal(g_Hitbox.Mins.X, -16);
g_Assert.equal(g_vecSoundCalls.some(([strKind]) => strKind === "Sound"), true);
g_Assert.equal(g_vecSoundCalls.some(([strKind]) => strKind === "StreamSound"), true);
g_Assert.equal(g_vecSoundCalls.filter(([strKind]) => strKind === "StopSound").length, g_vecSoundCalls.filter(([strKind]) => (strKind === "Sound") || (strKind === "StreamSound")).length);
g_Assert.equal(g_vecNativeCalls.some(([strOperation]) => strOperation === "SlayEntity"), true);
g_Assert.equal(g_vecNativeCalls.some(([strOperation]) => strOperation === "Entity.RemoveEntity"), true);
g_Assert.equal(g_vecNativeCalls.some(([strOperation]) => strOperation === "entities.RemoveEntity"), true);
g_Assert.equal(g_vecNativeCalls.some(([strOperation]) => strOperation === "GetEntityProperty"), true);
g_Assert.equal(g_vecNativeCalls.some(([strOperation]) => strOperation === "SetEntityProperty"), true);
g_Assert.equal(g_vecNativeCalls.some(([strOperation]) => strOperation === "GetEntityDataMapProperty"), true);
g_Assert.equal(g_vecNativeCalls.some(([strOperation]) => strOperation === "SetEntityDataMapProperty"), true);

const g_ReducedEntityRuntime = {
	GetEntity(nEntityIndex) {
		const ReducedEntity = MakeNativeEntity(nEntityIndex);
		if (!ReducedEntity) {
			return null;
		}

		delete ReducedEntity.CallEntityInput;
		delete ReducedEntity.SlayEntity;

		return ReducedEntity;
	},
};

const g_ReducedRootRuntime = {
	GetEntity: g_ReducedEntityRuntime.GetEntity,
};

InstallDependency(g_strRuntimePath, {
	GetModule(strModuleName) {
		if (strModuleName === "entities") {
			return g_ReducedRootRuntime;
		}

		if (strModuleName === "entities/entity") {
			return g_ReducedEntityRuntime;
		}

		throw new Error(`Unexpected reduced native module: ${strModuleName}`);
	},
});

delete require.cache[g_strBasePath];
delete require.cache[g_strEntityPath];

const g_ReducedEntityAPI = require(g_strEntityPath);
const g_ReducedEntity = g_ReducedEntityAPI.Entity(2);

g_Assert.deepEqual(Object.keys(g_ReducedEntityAPI), ["Entity", "GetNativeEntityByIndex"]);
g_Assert.equal(typeof g_ReducedEntity.CallEntityInputFunction, "undefined");
g_Assert.equal(typeof g_ReducedEntity.GetEntityHitbox, "undefined");
g_Assert.equal(typeof g_ReducedEntity.GetEntityModelName, "undefined");
g_Assert.equal(typeof g_ReducedEntity.GetEntityModelHeader, "undefined");
g_Assert.equal(typeof g_ReducedEntity.SlayEntity, "undefined");

function AssertEntityInputLifetime(strBindings, strApplicationSource) {
	const GetBlock = (strSource, strBegin, strEnd) => {
		const nBegin = strSource.indexOf(strBegin);
		g_Assert.ok(nBegin >= 0, "The native input lifetime block must exist.");
		const nEnd = strSource.indexOf(strEnd, nBegin + strBegin.length);
		g_Assert.ok(nEnd > nBegin, "The native input lifetime block must have a bounded end.");

		return strSource.slice(nBegin, nEnd);
	};

	const strNameStorage = GetBlock(strBindings, "void* GetEntityInputNameStorage(", "bool AllocateEntityInputString(");
	g_Assert.match(strNameStorage, /std::is_trivially_copyable_v<string_t>/);
	g_Assert.match(strNameStorage, /TypeDescription\.fieldType != FIELD_STRING/);
	g_Assert.match(strNameStorage, /TypeDescription\.fieldSize != 1/);
	g_Assert.match(strNameStorage, /nFieldOffset < 0[\s\S]*sizeof\(CBaseEntity\) - sizeof\(string_t\)/);

	const strAllocation = GetBlock(strBindings, "bool AllocateEntityInputString(", "bool VariantFromValue(");
	g_Assert.match(strAllocation, /GetEntityInputNameStorage\(pWorldEntity\)/);

	const strRestorer = GetBlock(strBindings, "class EntityInputNameRestorer {", "bool AllocateEntityInputString(");
	g_Assert.match(strRestorer, /std::memcpy\(m_arrOriginalName\.data\(\), m_pNameStorage, m_arrOriginalName\.size\(\)\);/);
	g_Assert.match(strRestorer, /~EntityInputNameRestorer\(\) noexcept \{[\s\S]*std::memcpy\(m_pNameStorage, m_arrOriginalName\.data\(\), m_arrOriginalName\.size\(\)\);/);
	g_Assert.match(strAllocation, /\{\s*EntityInputNameRestorer const NameRestorer \{ pNameStorage \};\s*bAssigned = pWorldEntity->KeyValue\(kTargetNameKey, strValue\.c_str\(\)\);\s*AllocatedName = pWorldEntity->GetEntityName\(\);\s*\}\s*if \(!bAssigned/);
	g_Assert.match(strAllocation, /std::strcmp\(STRING\(AllocatedName\), strValue\.c_str\(\)\) != 0/);
	g_Assert.doesNotMatch(strAllocation, /SetName\(|MAKE_STRING\(/);

	const strVariant = GetBlock(strBindings, "bool VariantFromValue(", "bool IsEntityAcceptInputAvailable(");
	g_Assert.match(strVariant, /if \(!AllocateEntityInputString\(strValue, StringValue\)\)/);
	g_Assert.match(strVariant, /VariantOut\.SetString\(StringValue\);/);
	g_Assert.doesNotMatch(strVariant, /MAKE_STRING\(/);

	const strStringCall = GetBlock(strBindings, "bool CallEntityInputNow(const int nEntityIndex, std::string const& strInputName, std::string const& strValue)", "bool ScheduleEntityInput(");
	g_Assert.match(strStringCall, /AllocateEntityInputString\(strValue, StringValue\)/);
	g_Assert.doesNotMatch(strStringCall, /MAKE_STRING\(/);

	const strSchedule = GetBlock(strBindings, "bool ScheduleEntityInput(", "void ClearDelayedEntityInputs(");
	g_Assert.match(strSchedule, /const double dblFireTime = static_cast<double>\(pGlobalVariables->curtime\) \+ static_cast<double>\(flDelay\)/);
	g_Assert.match(strSchedule, /!std::isfinite\(dblFireTime\)[\s\S]*dblFireTime < std::numeric_limits<float>::lowest\(\)[\s\S]*dblFireTime > std::numeric_limits<float>::max\(\)/);
	g_Assert.match(strSchedule, /!pUnknown->GetRefEHandle\(\)\.IsValid\(\)/);
	g_Assert.match(strSchedule, /DelayedInput\.m_nEntityHandleValue = pUnknown->GetRefEHandle\(\)\.ToInt\(\);/);
	g_Assert.match(strSchedule, /DelayedInput\.m_flFireTime = static_cast<float>\(dblFireTime\);/);

	const strDispatch = GetBlock(strBindings, "void ProcessDelayedEntityInputs(", "\n\tnamespace {");
	g_Assert.match(strDispatch, /DelayedInput = std::move\(g_vecDelayedEntityInputs\[unDelayedInputIndex\]\);[\s\S]*g_vecDelayedEntityInputs\.erase\([\s\S]*pUnknown->GetRefEHandle\(\)\.ToInt\(\) != DelayedInput\.m_nEntityHandleValue[\s\S]*CallEntityInputNow\(/);

	const strLevelShutdown = GetBlock(strApplicationSource, "void Application::LevelShutdown()", "bool Application::ClientConnect(");
	g_Assert.match(strLevelShutdown, /if \(!m_bLoaded \|\| m_bPaused\) \{\s*ClearDelayedEntityInputs\(\);\s*return;/);
	g_Assert.match(strLevelShutdown, /m_HookManager\.Emit\("LevelEnd"[\s\S]*ClearDelayedEntityInputs\(\);/);

	const strUnload = GetBlock(strApplicationSource, "void Application::Unload()", "void Application::Pause()");
	g_Assert.match(strUnload, /ClearDelayedEntityInputs\(\);[\s\S]*if \(!m_bLoaded && !m_Runtime\.IsInitialized\(\)\)/);
	g_Assert.match(strUnload, /m_Runtime\.Shutdown\(\);\s*ClearDelayedEntityInputs\(\);\s*ClearCreatedConVarRegistrations\(\);\s*m_EngineInterfaces\.Disconnect\(\);/);
}

const g_strNativeBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
const g_strApplicationSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "Application.cpp"), "utf8");
AssertEntityInputLifetime(g_strNativeBindings, g_strApplicationSource);

function AssertEntityCallbackIndexReads(strSource) {
	const ExtractFunction = (strSignature) => {
		const nStart = strSource.indexOf("\t\t" + strSignature);
		g_Assert.ok(nStart >= 0, strSignature);
		const nEnd = strSource.indexOf("\n\t\t}", nStart);
		g_Assert.ok(nEnd > nStart, strSignature);

		return strSource.slice(nStart, nEnd);
	};

	const strReader = ExtractFunction("bool ReadEntityIndex(v8::Isolate* const pIsolate");
	g_Assert.match(strReader, /!pIsolate \|\| LocalContext\.IsEmpty\(\) \|\| LocalValue\.IsEmpty\(\)/);
	g_Assert.match(strReader, /v8::TryCatch IndexFailure\(pIsolate\);/);
	g_Assert.match(strReader, /if \(IndexFailure\.HasCaught\(\)\) \{\s*IndexFailure\.ReThrow\(\);\s*return false;\s*}[\s\S]*nEntityIndexOut = nEntityIndex;/);

	const vecReceiverCallbacks = [
		"PlayerGiveNamedItemMethodCallback",
		"EntitySlayMethodCallback",
		"EntityCallInputMethodCallback",
		"EntityRemoveMethodCallback",
		"PlayerExecuteClientCommandMethodCallback",
		"PlayerSetNameMethodCallback",
		"PlayerSlayMethodCallback",
		"PlayerSayMethodCallback",
		"PlayerSayTeamMethodCallback",
	];

	for (const strCallbackName of vecReceiverCallbacks) {
		const strCallbackSource = ExtractFunction("void " + strCallbackName + "(");
		g_Assert.match(strCallbackSource, /if \(!ReadEntityIndex\(CallbackInformation, n(?:Entity|Player)Index\)\) \{\s*return;\s*}/);
		g_Assert.doesNotMatch(strCallbackSource, /GetEntityIndexFromCallbackThis\(/);
	}

	const strExplicitReferenceSource = ExtractFunction("void CallEntityInputCallback(");
	g_Assert.match(strExplicitReferenceSource, /if \(!ReadEntityIndex\(pIsolate, LocalContext, CallbackInformation\[kEntityArgumentIndex\], nEntityIndex\)\) \{\s*return;\s*}/);
	g_Assert.doesNotMatch(strExplicitReferenceSource, /GetValueIndex\(/);
}

AssertEntityCallbackIndexReads(g_strNativeBindings);

const g_vecCallbackIndexRegressions = [
	["bool ReadEntityIndex(v8::Isolate* const pIsolate", "IndexFailure.ReThrow();"],
	["void PlayerGiveNamedItemMethodCallback(", "!ReadEntityIndex(CallbackInformation, nPlayerIndex)"],
	["void EntitySlayMethodCallback(", "!ReadEntityIndex(CallbackInformation, nEntityIndex)"],
	["void EntityCallInputMethodCallback(", "!ReadEntityIndex(CallbackInformation, nEntityIndex)"],
	["void EntityRemoveMethodCallback(", "!ReadEntityIndex(CallbackInformation, nEntityIndex)"],
	["void PlayerExecuteClientCommandMethodCallback(", "!ReadEntityIndex(CallbackInformation, nPlayerIndex)"],
	["void PlayerSetNameMethodCallback(", "!ReadEntityIndex(CallbackInformation, nPlayerIndex)"],
	["void PlayerSlayMethodCallback(", "!ReadEntityIndex(CallbackInformation, nPlayerIndex)"],
	["void PlayerSayMethodCallback(", "!ReadEntityIndex(CallbackInformation, nPlayerIndex)"],
	["void PlayerSayTeamMethodCallback(", "!ReadEntityIndex(CallbackInformation, nPlayerIndex)"],
	["void CallEntityInputCallback(", "!ReadEntityIndex(pIsolate, LocalContext, CallbackInformation[kEntityArgumentIndex], nEntityIndex)"],
];

for (const [strSignature, strGuard] of g_vecCallbackIndexRegressions) {
	const nStart = g_strNativeBindings.indexOf("\t\t" + strSignature);
	const nEnd = g_strNativeBindings.indexOf("\n\t\t}", nStart);
	const strOriginal = g_strNativeBindings.slice(nStart, nEnd);
	g_Assert.equal(strOriginal.split(strGuard).length, 2, strSignature);
	g_Assert.throws(() => AssertEntityCallbackIndexReads(g_strNativeBindings.replace(strOriginal, strOriginal.replace(strGuard, "false"))), g_Assert.AssertionError, strSignature);
}

const g_vecEntityInputLifetimeMutations = [
	["TypeDescription.fieldType != FIELD_STRING", "false"],
	["TypeDescription.fieldSize != 1", "false"],
	["nFieldOffset < 0", "false"],
	["std::memcpy(m_arrOriginalName.data(), m_pNameStorage, m_arrOriginalName.size());", ""],
	["std::memcpy(m_pNameStorage, m_arrOriginalName.data(), m_arrOriginalName.size());", ""],
	["EntityInputNameRestorer const NameRestorer { pNameStorage };", ""],
	["std::strcmp(STRING(AllocatedName), strValue.c_str()) != 0", "false"],
	["VariantOut.SetString(StringValue);", "VariantOut.SetString(MAKE_STRING(strValue.c_str()));"],
	["InputValue.SetString(StringValue);", "InputValue.SetString(MAKE_STRING(strValue.c_str()));"],
	["!std::isfinite(dblFireTime)", "false"],
	["DelayedInput.m_nEntityHandleValue = pUnknown->GetRefEHandle().ToInt();", ""],
	["pUnknown->GetRefEHandle().ToInt() != DelayedInput.m_nEntityHandleValue", "false"],
];

for (const vecMutation of g_vecEntityInputLifetimeMutations) {
	const strMutatedBindings = g_strNativeBindings.replace(vecMutation[0], vecMutation[1]);
	g_Assert.notEqual(strMutatedBindings, g_strNativeBindings, "Each native input lifetime regression must alter its source.");
	g_Assert.throws(() => AssertEntityInputLifetime(strMutatedBindings, g_strApplicationSource), g_Assert.AssertionError);
}

const g_vecEntityInputCleanupMutations = [
	["\t\t\tClearDelayedEntityInputs();\n\t\t\treturn;", "\t\t\treturn;"],
	["\t\tm_Runtime.Shutdown();\n\t\tClearDelayedEntityInputs();", "\t\tm_Runtime.Shutdown();"],
	["\t\tClearDelayedEntityInputs();\n\t\tClearCreatedConVarRegistrations();\n\t\tm_EngineInterfaces.Disconnect();", "\t\tClearDelayedEntityInputs();\n\t\tm_EngineInterfaces.Disconnect();"],
	["\t\tClearDelayedEntityInputs();\n\t\tClearCreatedConVarRegistrations();\n\t\tm_EngineInterfaces.Disconnect();", "\t\tClearDelayedEntityInputs();\n\t\tm_EngineInterfaces.Disconnect();\n\t\tClearCreatedConVarRegistrations();"],
];

for (const vecMutation of g_vecEntityInputCleanupMutations) {
	const strMutatedApplication = g_strApplicationSource.replaceAll("\r\n", "\n").replace(vecMutation[0], vecMutation[1]);
	g_Assert.notEqual(strMutatedApplication, g_strApplicationSource.replaceAll("\r\n", "\n"), "Each native input cleanup regression must alter its source.");
	g_Assert.throws(() => AssertEntityInputLifetime(g_strNativeBindings, strMutatedApplication), g_Assert.AssertionError);
}

const g_nEntityObjectSearchStart = g_strNativeBindings.indexOf("bool InstallEntityLiveProperty");
g_Assert.ok(g_nEntityObjectSearchStart >= 0, "native entity live-property installation marker must exist");

const g_nEntityObjectBegin = g_strNativeBindings.indexOf("v8::Local<v8::Object> MakeEntityObject", g_nEntityObjectSearchStart);
const g_nEntityObjectEnd = g_strNativeBindings.indexOf("std::string NormalizeWeaponClassName", g_nEntityObjectBegin);
g_Assert.ok((g_nEntityObjectBegin >= 0) && (g_nEntityObjectEnd > g_nEntityObjectBegin), "native entity object block must have ordered bounds");

const g_strNativeEntityObjectBlock = g_strNativeBindings.slice(g_nEntityObjectBegin, g_nEntityObjectEnd);
const g_nEntityModuleBegin = g_strNativeBindings.indexOf("v8::Local<v8::Object> const LocalEntitiesModule = MakeModule");
const g_nEntityModuleEnd = g_strNativeBindings.indexOf("v8::Local<v8::Object> const LocalEntityEnginesModule = MakeModule", g_nEntityModuleBegin);
g_Assert.ok((g_nEntityModuleBegin >= 0) && (g_nEntityModuleEnd > g_nEntityModuleBegin), "native entity module block must have ordered bounds");

const g_strNativeEntityModuleBlock = g_strNativeBindings.slice(g_nEntityModuleBegin, g_nEntityModuleEnd);

g_Assert.match(g_strNativeEntityObjectBlock, /#if defined\(SOURCEJS_HAS_BASE_ENTITY\)[\s\S]*"SlayEntity"[\s\S]*"CallEntityInput"[\s\S]*#endif/);
g_Assert.match(g_strNativeEntityModuleBlock, /#ifdef SOURCEJS_HAS_BASE_ENTITY[\s\S]*LocalEntitiesModule, "CallInput"[\s\S]*#endif/);
g_Assert.match(g_strNativeEntityModuleBlock, /#ifdef SOURCEJS_HAS_BASE_ENTITY[\s\S]*LocalEntityModule, "CallInput"[\s\S]*#endif/);
g_Assert.match(g_strNativeBindings, /expects an undefined, null, boolean, integer, finite number, or string input value/);
g_Assert.doesNotMatch(g_strNativeBindings, /Entity\.(?:Slay|CallInput|Remove|getDatamap|setDatamap)\(/);

globalThis.sourcejs = {};
delete require.cache[g_strRuntimePath];
delete require.cache[g_strBasePath];
delete require.cache[g_strEntityPath];
g_Assert.throws(() => require(g_strBasePath), /SourceJS module is not installed/);
g_Assert.throws(() => require(g_strEntityPath), /SourceJS module is not installed/);

console.log("[smoke] entities root/base/entity and documentation contracts passed");

g_Module._load = g_OriginalModuleLoad;
