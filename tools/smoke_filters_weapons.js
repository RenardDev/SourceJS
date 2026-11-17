#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryPath, "packages", "sourcejs");
const g_strPackagePath = g_Path.join(g_strPackageRootPath, "filters", "weapons.js");
const g_strWeaponDataPath = g_Path.join(g_strPackageRootPath, "weapons", "data.js");
const g_strWeaponScriptsPath = g_Path.join(g_strPackageRootPath, "weapons", "scripts.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryPath, "docs", "api", "filters-weapons.md");
const g_strNativeBindingsPath = g_Path.join(g_strRepositoryPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strIteratorPath = g_Path.join(g_strPackageRootPath, "filters", "iterator.js");
const g_OriginalModuleLoad = g_Module._load;
const g_OriginalSourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_vecCachePaths = [
	g_strPackagePath,
	g_strWeaponDataPath,
	g_strWeaponScriptsPath,
	g_strRuntimePath,
	g_strIteratorPath,
];
const g_mapOriginalCacheEntries = new Map(g_vecCachePaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));

const g_unMaximumEntityIndex = 0x7FFFFFFF;

const g_setNativeMethodCalls = new Set();
const g_vecEntityInputCalls = [];
const g_mapEntityRecords = new Map();
const g_mapPlayerWeaponIndexes = new Map([[1, 1], [9, null]]);
let g_unNextEntityIndex = 10;

function CreateVector(flX, flY, flZ) {
	return { X: flX, Y: flY, Z: flZ };
}

function CreateEntityRecord(unIndex, strClassName, Options = {}) {
	const unBaseEntityAddress = 0x2000n + BigInt(unIndex);
	const unEncodedHandleValue = 0x10000 + unIndex;
	const Record = {
		Index: unIndex,
		Free: Options.Free === true,
		ClassName: strClassName,
		NetworkSerialNumber: 100 + unIndex,
		StateFlags: 2,
		Edict: { Index: unIndex, Kind: "edict", Address: 0x1000n + BigInt(unIndex) },
		BaseEntity: { Index: unIndex, Kind: "baseentity", Address: unBaseEntityAddress },
		Address: unBaseEntityAddress,
		BaseHandle: { Index: unIndex, Kind: "basehandle", Value: unEncodedHandleValue },
		HandleValue: unEncodedHandleValue,
		Valid: true,
		IsWeapon: false,
		Weapon: "",
		// Exact SDK network/datamap field spellings are not project-owned JavaScript API keys.
		Properties: new Map([
			["m_iClip1", 30],
			["m_flNextPrimaryAttack", 1.25],
			["m_ModelName", "models/weapons/w_rifle.mdl"],
			["m_vecOrigin", CreateVector(unIndex, unIndex + 1, unIndex + 2)],
			["m_hOwnerEntity", { Index: 1 }],
		]),
		DataMapProperties: new Map([
			["m_spawnflags", 4],
			["m_flDelay", 0.25],
			["m_ModelName", "models/weapons/w_rifle.mdl"],
			["m_vecAbsOrigin", CreateVector(unIndex + 3, unIndex + 4, unIndex + 5)],
			["m_hOwnerEntity", { Index: 1 }],
		]),
	};

	g_mapEntityRecords.set(unIndex, Record);

	return Record;
}

function RequireNonEmptyString(strValue, strOperation) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new Error(`${strOperation} expects a non-empty string.`);
	}

	return strValue;
}

function GetEntityIndex(Value, strOperation) {
	const unIndex = (typeof Value === "number") ? Value : Value?.Index;
	if (!Number.isInteger(unIndex) || (unIndex < 0) || (unIndex > g_unMaximumEntityIndex)) {
		throw new Error(`${strOperation} expects a non-negative integer or indexed object.`);
	}

	return unIndex;
}

function IsCurrentWeaponRecord(Record) {
	return Boolean(Record && !Record.Free && Record.ClassName.startsWith("weapon_"));
}

function ReadStoredValue(mapValues, strName, strOperation) {
	RequireNonEmptyString(strName, strOperation);

	if (!mapValues.has(strName)) {
		throw new ReferenceError(`${strOperation} property does not exist: ${strName}`);
	}

	return mapValues.get(strName);
}

function WriteStoredValue(mapValues, strName, Value, strOperation) {
	ReadStoredValue(mapValues, strName, strOperation);
	mapValues.set(strName, Value);

	return true;
}

function CreateWeapon(unIndex) {
	const Weapon = {};

	function GetCurrentRecord() {
		return g_mapEntityRecords.get(unIndex) ?? null;
	}

	function GetValidRecord() {
		const Record = GetCurrentRecord();

		return (Record && !Record.Free) ? Record : null;
	}

	function RequireValidRecord(strOperation) {
		const Record = GetValidRecord();
		if (!Record) {
			throw new ReferenceError(`${strOperation} target is unavailable.`);
		}

		return Record;
	}

	function GetDataMapValue(strOperation, strName, strType = undefined) {
		g_setNativeMethodCalls.add(strOperation);
		g_Assert.equal((strType === undefined) || (typeof strType === "string"), true);

		return ReadStoredValue(RequireValidRecord(`Weapon.${strOperation}`).DataMapProperties, strName, `Weapon.${strOperation}`);
	}

	function GetPropertyValue(strOperation, strName, strType = undefined) {
		g_setNativeMethodCalls.add(strOperation);
		g_Assert.equal((strType === undefined) || (typeof strType === "string"), true);

		return ReadStoredValue(RequireValidRecord(`Weapon.${strOperation}`).Properties, strName, `Weapon.${strOperation}`);
	}

	function SetDataMapValue(strOperation, strName, Value, strType = undefined) {
		g_setNativeMethodCalls.add(strOperation);
		g_Assert.equal((strType === undefined) || (typeof strType === "string"), true);

		return WriteStoredValue(RequireValidRecord(`Weapon.${strOperation}`).DataMapProperties, strName, Value, `Weapon.${strOperation}`);
	}

	function SetPropertyValue(strOperation, strName, Value, strType = undefined) {
		g_setNativeMethodCalls.add(strOperation);
		g_Assert.equal((strType === undefined) || (typeof strType === "string"), true);

		return WriteStoredValue(RequireValidRecord(`Weapon.${strOperation}`).Properties, strName, Value, `Weapon.${strOperation}`);
	}

	Object.defineProperties(Weapon, {
		Free: {
			enumerable: true,
			get: () => !GetValidRecord(),
			set(bValue) {
				if (typeof bValue !== "boolean") {
					throw new TypeError("Weapon.Free requires a boolean.");
				}

				const Record = GetCurrentRecord();
				if (!Record) {
					throw new ReferenceError("Weapon.Free target is unavailable.");
				}

				Record.Free = bValue;
			},
		},

		IsWeapon: { enumerable: true, get: () => IsCurrentWeaponRecord(GetCurrentRecord()) },
		Valid: { enumerable: true, get: () => Boolean(GetValidRecord()) },
		HandleValue: { enumerable: true, get: () => GetValidRecord()?.HandleValue ?? -1 },
		BaseEntity: { enumerable: true, get: () => GetValidRecord()?.BaseEntity ?? null },
		BaseHandle: { enumerable: true, get: () => GetValidRecord()?.BaseHandle ?? null },
		Edict: { enumerable: true, get: () => GetValidRecord()?.Edict ?? null },
		Address: { enumerable: true, get: () => GetValidRecord()?.Address ?? 0n },
		ClassName: { enumerable: true, get: () => GetValidRecord()?.ClassName ?? "" },

		Weapon: {
			enumerable: true,
			get() {
				const strWeaponClassPrefix = "weapon_";
				const strClassName = GetValidRecord()?.ClassName ?? "";

				return strClassName.startsWith(strWeaponClassPrefix) ? strClassName.slice(strWeaponClassPrefix.length) : strClassName;
			},
		},

		Index: { enumerable: true, get: () => unIndex },
		NetworkSerialNumber: {
			enumerable: true,
			get: () => GetCurrentRecord()?.NetworkSerialNumber ?? 0,
			set(nValue) {
				if (!Number.isInteger(nValue)) {
					throw new TypeError("Weapon.NetworkSerialNumber requires an integer.");
				}

				RequireValidRecord("Weapon.NetworkSerialNumber").NetworkSerialNumber = nValue;
			},
		},

		StateFlags: {
			enumerable: true,
			get: () => GetCurrentRecord()?.StateFlags ?? 0,
			set(nValue) {
				if (!Number.isInteger(nValue)) {
					throw new TypeError("Weapon.StateFlags requires an integer.");
				}

				RequireValidRecord("Weapon.StateFlags").StateFlags = nValue;
			},
		},

		CallEntityInput: {
			value(strInputName, InputValue = undefined, flInputDelaySeconds = 0) {
				g_setNativeMethodCalls.add("CallEntityInput");
				RequireValidRecord("Weapon.CallEntityInput");
				RequireNonEmptyString(strInputName, "Weapon.CallEntityInput");

				if ((typeof flInputDelaySeconds !== "number") || !Number.isFinite(flInputDelaySeconds) || (flInputDelaySeconds < 0)) {
					throw new TypeError("Weapon.CallEntityInput delay must be a non-negative finite number.");
				}

				g_vecEntityInputCalls.push({ InputDelaySeconds: flInputDelaySeconds, Index: unIndex, InputName: strInputName, InputValue });

				return true;
			},
		},

		GetEntityDataMap: {
			value() {
				g_setNativeMethodCalls.add("GetEntityDataMap");
				RequireValidRecord("Weapon.GetEntityDataMap");

				return { ClassName: "CBaseCombatWeapon", Address: 0x6000n + BigInt(unIndex) };
			},
		},

		GetEntityDataMapProperty: { value: (strName, strType = undefined) => GetDataMapValue("GetEntityDataMapProperty", strName, strType) },
		GetEntityDataMapPropertyEntity: { value: (strName) => GetDataMapValue("GetEntityDataMapPropertyEntity", strName) },
		GetEntityDataMapPropertyFloat: { value: (strName) => GetDataMapValue("GetEntityDataMapPropertyFloat", strName) },
		GetEntityDataMapPropertyInteger: { value: (strName) => GetDataMapValue("GetEntityDataMapPropertyInteger", strName) },
		GetEntityDataMapPropertyString: { value: (strName) => GetDataMapValue("GetEntityDataMapPropertyString", strName) },
		GetEntityDataMapPropertyVector: { value: (strName) => GetDataMapValue("GetEntityDataMapPropertyVector", strName) },
		GetEntityProperty: { value: (strName, strType = undefined) => GetPropertyValue("GetEntityProperty", strName, strType) },
		GetEntityPropertyEntity: { value: (strName) => GetPropertyValue("GetEntityPropertyEntity", strName) },
		GetEntityPropertyFloat: { value: (strName) => GetPropertyValue("GetEntityPropertyFloat", strName) },
		GetEntityPropertyInteger: { value: (strName) => GetPropertyValue("GetEntityPropertyInteger", strName) },
		GetEntityPropertyString: { value: (strName) => GetPropertyValue("GetEntityPropertyString", strName) },
		GetEntityPropertyVector: { value: (strName) => GetPropertyValue("GetEntityPropertyVector", strName) },

		RemoveEntity: {
			value() {
				g_setNativeMethodCalls.add("RemoveEntity");
				RequireValidRecord("Weapon.RemoveEntity").Free = true;

				return true;
			},
		},

		SetEntityDataMapProperty: { value: (strName, Value, strType = undefined) => SetDataMapValue("SetEntityDataMapProperty", strName, Value, strType) },
		SetEntityDataMapPropertyEntity: { value: (strName, Value) => SetDataMapValue("SetEntityDataMapPropertyEntity", strName, Value) },
		SetEntityDataMapPropertyFloat: { value: (strName, Value) => SetDataMapValue("SetEntityDataMapPropertyFloat", strName, Value) },
		SetEntityDataMapPropertyInteger: { value: (strName, Value) => SetDataMapValue("SetEntityDataMapPropertyInteger", strName, Value) },
		SetEntityDataMapPropertyString: { value: (strName, Value) => SetDataMapValue("SetEntityDataMapPropertyString", strName, Value) },
		SetEntityDataMapPropertyVector: { value: (strName, Value) => SetDataMapValue("SetEntityDataMapPropertyVector", strName, Value) },
		SetEntityProperty: { value: (strName, Value, strType = undefined) => SetPropertyValue("SetEntityProperty", strName, Value, strType) },
		SetEntityPropertyEntity: { value: (strName, Value) => SetPropertyValue("SetEntityPropertyEntity", strName, Value) },
		SetEntityPropertyFloat: { value: (strName, Value) => SetPropertyValue("SetEntityPropertyFloat", strName, Value) },
		SetEntityPropertyInteger: { value: (strName, Value) => SetPropertyValue("SetEntityPropertyInteger", strName, Value) },
		SetEntityPropertyString: { value: (strName, Value) => SetPropertyValue("SetEntityPropertyString", strName, Value) },
		SetEntityPropertyVector: { value: (strName, Value) => SetPropertyValue("SetEntityPropertyVector", strName, Value) },

		SlayEntity: {
			value() {
				g_setNativeMethodCalls.add("SlayEntity");
				RequireValidRecord("Weapon.SlayEntity");

				return true;
			},
		},
	});

	return Weapon;
}

function GetCurrentWeaponIndexes() {
	return Array.from(g_mapEntityRecords.values()).filter(IsCurrentWeaponRecord).map((Record) => Record.Index).sort((unLeft, unRight) => unLeft - unRight);
}

const g_NativeWeaponFilters = {
	GetAllWeapons() {
		return GetCurrentWeaponIndexes().map((unIndex) => CreateWeapon(unIndex));
	},

	GetWeaponsByClassName(strClassName) {
		RequireNonEmptyString(strClassName, "filters/weapons.GetWeaponsByClassName");

		return GetCurrentWeaponIndexes().filter((unIndex) => g_mapEntityRecords.get(unIndex).ClassName === strClassName).map(CreateWeapon);
	},

	GetWeaponsByName(strWeaponName) {
		RequireNonEmptyString(strWeaponName, "filters/weapons.GetWeaponsByName");

		const strClassName = strWeaponName.startsWith("weapon_") ? strWeaponName : `weapon_${strWeaponName}`;

		return GetCurrentWeaponIndexes().filter((unIndex) => g_mapEntityRecords.get(unIndex).ClassName === strClassName).map(CreateWeapon);
	},

	GetWeaponCount() {
		return GetCurrentWeaponIndexes().length;
	},

	GetCurrentWeapon(Player) {
		const unPlayerIndex = GetEntityIndex(Player, "filters/weapons.GetCurrentWeapon");
		if (!g_mapPlayerWeaponIndexes.has(unPlayerIndex)) {
			throw new Error("filters/weapons.GetCurrentWeapon expects a live player entity.");
		}

		const unWeaponIndex = g_mapPlayerWeaponIndexes.get(unPlayerIndex);
		const WeaponRecord = g_mapEntityRecords.get(unWeaponIndex);

		return (WeaponRecord && !WeaponRecord.Free) ? CreateWeapon(unWeaponIndex) : null;
	},

	GetWeapon(Value) {
		const unIndex = GetEntityIndex(Value, "filters/weapons.GetWeapon");
		const Record = g_mapEntityRecords.get(unIndex);

		return IsCurrentWeaponRecord(Record) ? CreateWeapon(unIndex) : null;
	},
};

const g_NativeWeapons = {
	Classes() {
		return Array.from(new Set(GetCurrentWeaponIndexes().map((unIndex) => g_mapEntityRecords.get(unIndex).ClassName)));
	},
};

// Raw weapon-data sections retain external/user INI keys and values.
const g_RifleData = { profile: "rifle", tags: "all,primary,rifle" };
const g_SMGData = { profile: "smg", tags: "all,primary,smg" };
const g_PistolData = { profile: "pistol", tags: "all,secondary,pistol" };
const g_vecWeaponDataRecords = [
	{
		AmmoProperty: "m_iAmmo.",
		BaseName: "rifle",
		ClassName: "weapon_rifle",
		Classes: ["weapon_rifle"],
		Clip: 1,
		Cost: 3100,
		Data: g_RifleData,
		ID: "50",
		ItemDefinitionIndex: 50,
		MaximumAmmo: "ammo_assaultrifle_max",
		Name: "rifle",
		Names: ["rifle"],
		ParentClass: "primary",
		Script: null,
		SecondaryAmmoProperty: null,
		SecondaryMaximumAmmo: null,
		Slot: "0",
		Tags: ["all", "primary", "rifle"],
		Type: "primary",
	},
	{
		AmmoProperty: "m_iAmmo.",
		BaseName: "smg",
		ClassName: "weapon_smg",
		Classes: ["weapon_smg"],
		Clip: 1,
		Cost: 1250,
		Data: g_SMGData,
		ID: "51",
		ItemDefinitionIndex: 51,
		MaximumAmmo: "ammo_smg_max",
		Name: "smg",
		Names: ["smg"],
		ParentClass: "primary",
		Script: null,
		SecondaryAmmoProperty: null,
		SecondaryMaximumAmmo: null,
		Slot: "0",
		Tags: ["all", "primary", "smg"],
		Type: "primary",
	},
	{
		AmmoProperty: "m_iAmmo.",
		BaseName: "pistol",
		ClassName: "weapon_pistol",
		Classes: ["weapon_pistol"],
		Clip: 1,
		Cost: 400,
		Data: g_PistolData,
		ID: "1",
		ItemDefinitionIndex: 1,
		MaximumAmmo: "ammo_pistol_max",
		Name: "pistol",
		Names: ["pistol"],
		ParentClass: "secondary",
		Script: null,
		SecondaryAmmoProperty: "m_iSecondaryAmmo.",
		SecondaryMaximumAmmo: "ammo_pistol_secondary_max",
		Slot: "1",
		Tags: ["all", "secondary", "pistol"],
		Type: "secondary",
	},
];

// KeyValues records here are opaque identity sentinels, not native address models.
const g_RifleScript = { ClassName: "weapon_rifle", KeyValues: { Handle: 1, Name: "WeaponData" }, Name: "rifle", Path: "game/scripts/weapon_rifle.txt" };
const g_PistolScript = { ClassName: "weapon_pistol", KeyValues: { Handle: 2, Name: "WeaponData" }, Name: "pistol", Path: "game/scripts/weapon_pistol.txt" };
const g_vecWeaponScriptRecords = [g_RifleScript, g_PistolScript];

const g_Factories = {
	CreateAndSpawnEntityByClassName(strClassName) {
		RequireNonEmptyString(strClassName, "entities/factories.CreateAndSpawnEntityByClassName");

		const unIndex = g_unNextEntityIndex;
		g_unNextEntityIndex += 1;
		CreateEntityRecord(unIndex, strClassName);

		return CreateWeapon(unIndex);
	},
};

const g_DataMaps = {
	FindEntityDataMapField(DataMap, strFieldName) {
		if (!DataMap || (DataMap.ClassName !== "CBaseCombatWeapon") || (strFieldName !== "m_spawnflags")) {
			return null;
		}

		return { Path: strFieldName, Type: "int" };
	},
};
const g_EntityProperties = {
	GetEntitySendProperty(Entity, strPropertyName) {
		const Record = g_mapEntityRecords.get(GetEntityIndex(Entity, "entities/props.GetEntitySendProperty"));
		if (!Record || Record.Free || !Record.Properties.has(strPropertyName)) {
			return null;
		}

		return { Path: strPropertyName, Type: "int" };
	},
};
const g_PlayerFilters = {
	GetAllPlayers() {
		return Array.from(g_mapPlayerWeaponIndexes.keys(), (unIndex) => ({ Index: unIndex }));
	},
};
const g_Players = {
	Player(unIndex) {
		return g_mapPlayerWeaponIndexes.has(unIndex) ? { Index: unIndex, Name: "Ren" } : null;
	},
};

function ExtractJavaScriptBlocks(strMarkdown) {
	return [...strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
}

function CreateDocumentationRequire(WeaponFilters, LogInfo) {
	return function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "filters/weapons") {
			return WeaponFilters;
		}

		if (strModuleName === "players/entity") {
			return g_Players;
		}

		if (strModuleName === "filters/players") {
			return g_PlayerFilters;
		}

		if (strModuleName === "entities/factories") {
			return g_Factories;
		}

		if (strModuleName === "entities/datamaps") {
			return g_DataMaps;
		}

		if (strModuleName === "entities/props") {
			return g_EntityProperties;
		}

		if (strModuleName === "loggers") {
			return { LogInfo };
		}

		throw new Error(`Unexpected documentation module: ${strModuleName}`);
	};
}

function VerifyWorldWeaponFilterExample(WeaponFilters) {
	const unExecutionTimeoutMilliseconds = 1000;
	const strSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryPath, "examples/plugins/disabled/api-world-objects/index.js"), "utf8").replace(/\r\n/g, "\n");
	const vecImportMatch = strSource.match(/const\s*\{([^}]+)\}\s*=\s*require\("filters\/weapons"\);/);
	g_Assert.ok(vecImportMatch);
	const strMarker = 'LogResult("filters/weapons current state", ';
	const nMarkerIndex = strSource.indexOf(strMarker);
	g_Assert.ok(nMarkerIndex >= 0);
	g_Assert.equal(strSource.indexOf(strMarker, nMarkerIndex + strMarker.length), -1);
	const unCallbackStart = nMarkerIndex + strMarker.length;
	const nCallbackEnd = strSource.indexOf("\n\t});", unCallbackStart);
	g_Assert.ok(nCallbackEnd > unCallbackStart);
	const strCallback = strSource.slice(unCallbackStart, nCallbackEnd + 3);
	const vecExpectedIndexes = WeaponFilters.GetAllWeapons().map((Weapon) => Weapon.Index);
	g_Assert.ok(vecExpectedIndexes.length > 0, "Exercise the live native weapon fields, not only the empty path");
	g_Assert.notEqual(WeaponFilters.GetCurrentWeapon({ Index: 1 }), null, "Exercise active-weapon name extraction");

	let unVerifiedProfileCount = 0;
	for (const bConnected of [false, true]) {
		const Context = {
			GetAllPlayers: () => [{ Index: 1, Connected: bConnected }],
			GetEntityIndexes: (vecValues) => vecValues.map((Value) => Value.Index),
		};
		for (const strBinding of vecImportMatch[1].split(",").map((strValue) => strValue.trim()).filter(Boolean)) {
			const [strExportName, strAlias] = strBinding.split(":").map((strValue) => strValue.trim());
			g_Assert.ok(Object.hasOwn(WeaponFilters, strExportName), `World example imports absent filters/weapons.${strExportName}`);
			Context[strAlias || strExportName] = WeaponFilters[strExportName];
		}

		const Result = g_VM.runInNewContext(`(${strCallback})()`, Context, { timeout: unExecutionTimeoutMilliseconds });
		g_Assert.deepEqual(Array.from(Result.All), vecExpectedIndexes);
		g_Assert.deepEqual(Array.from(Result.Iterator), vecExpectedIndexes);
		g_Assert.ok(Array.isArray(Result.Classes));
		g_Assert.equal(Result.RoundTripIndex, vecExpectedIndexes[0] ?? null);

		if (bConnected) {
			g_Assert.equal(Result.CurrentPlayer.Index, 1);
			g_Assert.equal(Result.CurrentPlayer.WeaponName, WeaponFilters.GetCurrentWeapon({ Index: 1 })?.Weapon ?? null);
		} else {
			g_Assert.equal(Result.CurrentPlayer, null);
		}

		++unVerifiedProfileCount;
	}

	return unVerifiedProfileCount;
}

const g_RejectDocumentationConsole = () => {
	throw new Error("Weapon documentation must use the typed logger.");
};
const g_ConsoleDouble = new Proxy({}, { get: g_RejectDocumentationConsole });

function VerifyDocumentationRequireContracts() {
	const WeaponFilters = {};
	const vecLogCalls = [];
	const LogInfo = (...vecArguments) => vecLogCalls.push(vecArguments);
	const DocumentationRequire = CreateDocumentationRequire(WeaponFilters, LogInfo);
	g_Assert.strictEqual(DocumentationRequire("filters/weapons"), WeaponFilters);
	g_Assert.strictEqual(DocumentationRequire("players/entity"), g_Players);
	g_Assert.strictEqual(DocumentationRequire("filters/players"), g_PlayerFilters);
	g_Assert.strictEqual(DocumentationRequire("entities/factories"), g_Factories);
	g_Assert.strictEqual(DocumentationRequire("entities/datamaps"), g_DataMaps);
	g_Assert.strictEqual(DocumentationRequire("entities/props"), g_EntityProperties);
	g_Assert.strictEqual(DocumentationRequire("loggers").LogInfo, LogInfo);
	DocumentationRequire("loggers").LogInfo("WeaponFilterProbe Count=%d", 2);
	g_Assert.deepEqual(vecLogCalls, [["WeaponFilterProbe Count=%d", 2]]);
	g_Assert.throws(() => DocumentationRequire("UnknownModule"), /Unexpected documentation module/);
	g_Assert.throws(() => g_ConsoleDouble.log, /typed logger/);
}

function VerifyWeaponDocumentationCleanup(vecExamples) {
	const unExpectedScenarioCount = 60;
	const unExpectedTypedWriteCount = 2;
	const nStoredPropertyValue = 73;
	const vecOperationFailures = [
		new Error("Controlled weapon operation failure."),
		null,
		undefined,
		0,
	];
	const vecSpecifications = [
		{ Name: "g_InspectWeaponLifecycle", Kind: "LIFECYCLE" },
		{ Name: "g_InspectWeaponClipProperty", Kind: "PROPERTY" },
		{ Name: "g_InspectWeaponDataMap", Kind: "DATAMAP" },
	];
	let unScenarioCount = 0;
	for (const Specification of vecSpecifications) {
		const strExample = vecExamples.find(strSource => strSource.includes("const " + Specification.Name + " ="));
		g_Assert.equal(typeof strExample, "string");
		const RunExample = new Function("require", "console", strExample);
		const vecPrimaryCases = [
			{ Throws: false },
			...vecOperationFailures.map(Value => ({ Throws: true, Value, Phase: "OPERATION" })),
		];
		if (Specification.Kind === "LIFECYCLE") {
			vecPrimaryCases.push(...vecOperationFailures.map(Value => ({ Throws: true, Value, Phase: "LOOKUP" })), { Throws: true, Phase: "LOOKUP_NULL", Message: /not recognized as a weapon/ });
		}

		for (const PrimaryCase of vecPrimaryCases) {
			for (const strCleanupMode of ["SUCCESS", "FALSE", "THROWS"]) {
				const CleanupFailure = new Error("Controlled weapon cleanup failure.");
				let unCleanupCallCount = 0;
				let unTypedWriteCount = 0;
				let bEntityValid = true;
				let CapturedFailure = null;
				const FailAtPhase = strPhase => {
					if (PrimaryCase.Throws && (PrimaryCase.Phase === strPhase)) {
						throw PrimaryCase.Value;
					}
				};
				const Cleanup = () => {
					++unCleanupCallCount;

					if (strCleanupMode === "THROWS") {
						throw CleanupFailure;
					}

					if (strCleanupMode === "FALSE") {
						return false;
					}

					bEntityValid = false;

					return true;
				};
				const WriteStoredProperty = (strPropertyName, nValue) => {
					g_Assert.equal(strPropertyName, (Specification.Kind === "PROPERTY") ? "m_iClip1" : "m_spawnflags");
					g_Assert.equal(nValue, nStoredPropertyValue);
					++unTypedWriteCount;

					return (unTypedWriteCount === unExpectedTypedWriteCount) ? Cleanup() : true;
				};
				const Owner = {
					get Valid() {
						return bEntityValid;
					},
					RemoveEntity: Cleanup,
				};
				const Weapon = {
					CallEntityInput() {
						FailAtPhase("OPERATION");

						return true;
					},
					SlayEntity: () => true,
					GetEntityProperty: () => nStoredPropertyValue,
					GetEntityPropertyInteger: () => nStoredPropertyValue,
					SetEntityProperty: () => true,
					SetEntityPropertyInteger: WriteStoredProperty,
					GetEntityDataMap: () => ({ ClassName: "CBaseCombatWeapon" }),
					GetEntityDataMapProperty: () => nStoredPropertyValue,
					GetEntityDataMapPropertyInteger: () => nStoredPropertyValue,
					SetEntityDataMapProperty: () => true,
					SetEntityDataMapPropertyInteger: WriteStoredProperty,
				};

				class WeaponClassIterator {
					First() {
						return { ClassName: "weapon_fixture" };
					}
				}

				const DocumentationRequire = strModuleName => {
					if (strModuleName === "filters/weapons") {
						return {
							WeaponClassIterator,
							GetAllWeapons: () => [Weapon],
							GetWeapon(Entity) {
								g_Assert.strictEqual(Entity, Owner);
								FailAtPhase("LOOKUP");

								return (PrimaryCase.Phase === "LOOKUP_NULL") ? null : Weapon;
							},
						};
					}

					if (strModuleName === "entities/factories") {
						return { CreateAndSpawnEntityByClassName: () => Owner };
					}

					if (strModuleName === "entities/props") {
						return { GetEntitySendProperty: () => ({ Path: "m_iClip1", Type: "int" }) };
					}

					if (strModuleName === "loggers") {
						return { LogInfo: () => FailAtPhase("OPERATION") };
					}

					g_Assert.equal(strModuleName, "entities/datamaps");

					return { FindEntityDataMapField: () => ({ Path: "m_spawnflags", Type: "int" }) };
				};
				try {
					RunExample(DocumentationRequire, g_ConsoleDouble);
				} catch (Failure) {
					CapturedFailure = { Value: Failure };
				}

				g_Assert.equal(unCleanupCallCount, 1, Specification.Name + " must attempt its owning cleanup once after every acquired-resource outcome.");
				g_Assert.equal(bEntityValid, strCleanupMode !== "SUCCESS");

				if (Specification.Kind !== "LIFECYCLE") {
					g_Assert.equal(unTypedWriteCount, unExpectedTypedWriteCount, "Property restoration must follow the main write even after an operation failure.");
				}

				const unExpectedFailureCount = Number(PrimaryCase.Throws) + Number(strCleanupMode !== "SUCCESS");
				if (unExpectedFailureCount === 0) {
					g_Assert.equal(CapturedFailure, null);
				} else {
					g_Assert.notEqual(CapturedFailure, null);
					let PrimaryFailure = CapturedFailure.Value;
					let ReportedCleanupFailure = CapturedFailure.Value;
					if (unExpectedFailureCount === 2) {
						g_Assert(CapturedFailure.Value instanceof AggregateError);
						g_Assert.equal(CapturedFailure.Value.errors.length, unExpectedFailureCount);
						PrimaryFailure = CapturedFailure.Value.errors[0];
						ReportedCleanupFailure = CapturedFailure.Value.errors[1];
					}

					if (PrimaryCase.Throws) {
						if (PrimaryCase.Message) {
							g_Assert(PrimaryFailure instanceof Error);
							g_Assert.match(PrimaryFailure.message, PrimaryCase.Message);
						} else {
							g_Assert.strictEqual(PrimaryFailure, PrimaryCase.Value);
						}
					}

					if (strCleanupMode === "THROWS") {
						g_Assert.strictEqual(ReportedCleanupFailure, CleanupFailure);
					} else if (strCleanupMode === "FALSE") {
						g_Assert(ReportedCleanupFailure instanceof Error);
						g_Assert.match(ReportedCleanupFailure.message, /restoration failed|cleanup failed/);
					}
				}

				++unScenarioCount;
			}
		}
	}

	g_Assert.equal(unScenarioCount, unExpectedScenarioCount);
}

function VerifyNamedWeaponFilterCleanup(vecExamples, WeaponFilters) {
	const strFilterName = "ExampleEvenWeaponIndex";
	const unExpectedScenarioCount = 15;
	const strExample = vecExamples.find(strSource => strSource.includes("const g_InspectNamedWeaponFilter ="));
	g_Assert.equal(typeof strExample, "string");
	const RunExample = new Function("require", "console", strExample);
	const IteratorClass = WeaponFilters.WeaponIterator;
	const IteratorPrototype = IteratorClass.prototype;
	const OriginalResolve = IteratorPrototype.Resolve;
	const OriginalUnregister = IteratorClass.UnregisterFilter;
	const OriginalResolveDescriptor = Object.getOwnPropertyDescriptor(IteratorPrototype, "Resolve");
	const OriginalUnregisterDescriptor = Object.getOwnPropertyDescriptor(IteratorClass, "UnregisterFilter");
	IteratorClass.Iterator();
	const vecOriginalFilterNames = IteratorClass.GetFilterNames();
	const DocumentationRequire = CreateDocumentationRequire(WeaponFilters, () => undefined);
	const RestoreOverrides = () => {
		for (const Property of [
			{ Owner: IteratorPrototype, Name: "Resolve", Descriptor: OriginalResolveDescriptor },
			{ Owner: IteratorClass, Name: "UnregisterFilter", Descriptor: OriginalUnregisterDescriptor },
		]) {
			if (Property.Descriptor === undefined) {
				delete Property.Owner[Property.Name];
			} else {
				Object.defineProperty(Property.Owner, Property.Name, Property.Descriptor);
			}
		}
	};
	const vecPrimaryCases = [
		{ Throws: false },
		...[
			new Error("Controlled named weapon iteration failure."),
			null,
			undefined,
			0,
		].map(Value => ({ Throws: true, Value })),
	];
	let unScenarioCount = 0;
	for (const PrimaryCase of vecPrimaryCases) {
		for (const strCleanupMode of ["SUCCESS", "FALSE", "THROWS"]) {
			g_Assert.equal(IteratorClass.HasFilter(strFilterName), false);
			const CleanupFailure = new Error("Controlled named weapon cleanup failure.");
			let CapturedFailure = null;
			let unUnregisterCallCount = 0;
			IteratorPrototype.Resolve = function ResolveControlledWeapons(...vecArguments) {
				const vecWeapons = Reflect.apply(OriginalResolve, this, vecArguments);
				if (PrimaryCase.Throws) {
					throw PrimaryCase.Value;
				}

				return vecWeapons;
			};
			IteratorClass.UnregisterFilter = function UnregisterControlledWeaponFilter(...vecArguments) {
				const bResult = Reflect.apply(OriginalUnregister, this, vecArguments);
				++unUnregisterCallCount;

				if (strCleanupMode === "THROWS") {
					throw CleanupFailure;
				}

				return (strCleanupMode === "FALSE") ? false : bResult;
			};

			try {
				RunExample(DocumentationRequire, g_ConsoleDouble);
			} catch (Failure) {
				CapturedFailure = { Value: Failure };
			} finally {
				RestoreOverrides();

				if (IteratorClass.HasFilter(strFilterName)) {
					g_Assert.equal(OriginalUnregister.call(IteratorClass, strFilterName), true);
				}
			}

			g_Assert.equal(unUnregisterCallCount, 1);
			g_Assert.deepEqual(Object.getOwnPropertyDescriptor(IteratorPrototype, "Resolve"), OriginalResolveDescriptor);
			g_Assert.deepEqual(Object.getOwnPropertyDescriptor(IteratorClass, "UnregisterFilter"), OriginalUnregisterDescriptor);
			const unExpectedFailureCount = Number(PrimaryCase.Throws) + Number(strCleanupMode !== "SUCCESS");
			if (unExpectedFailureCount === 0) {
				g_Assert.equal(CapturedFailure, null);
			} else {
				g_Assert.notEqual(CapturedFailure, null);
				let PrimaryFailure = CapturedFailure.Value;
				let ReportedCleanupFailure = CapturedFailure.Value;
				if (unExpectedFailureCount === 2) {
					g_Assert(CapturedFailure.Value instanceof AggregateError);
					g_Assert.equal(CapturedFailure.Value.errors.length, unExpectedFailureCount);
					PrimaryFailure = CapturedFailure.Value.errors[0];
					ReportedCleanupFailure = CapturedFailure.Value.errors[1];
				}

				if (PrimaryCase.Throws) {
					g_Assert.strictEqual(PrimaryFailure, PrimaryCase.Value);
				}

				if (strCleanupMode === "THROWS") {
					g_Assert.strictEqual(ReportedCleanupFailure, CleanupFailure);
				} else if (strCleanupMode === "FALSE") {
					g_Assert(ReportedCleanupFailure instanceof Error);
					g_Assert.match(ReportedCleanupFailure.message, /cleanup failed/);
				}
			}

			++unScenarioCount;
		}
	}

	g_Assert.equal(unScenarioCount, unExpectedScenarioCount);

	const ExistingFilter = () => true;
	let unForeignCleanupCallCount = 0;
	g_Assert.strictEqual(IteratorClass.RegisterFilter(strFilterName, ExistingFilter), ExistingFilter);
	IteratorClass.UnregisterFilter = function CountForeignWeaponFilterCleanup(...vecArguments) {
		++unForeignCleanupCallCount;

		return Reflect.apply(OriginalUnregister, this, vecArguments);
	};

	try {
		g_Assert.throws(() => RunExample(DocumentationRequire, g_ConsoleDouble), ReferenceError);
		g_Assert.equal(unForeignCleanupCallCount, 0);
		g_Assert.strictEqual(IteratorClass.Filters.get(strFilterName), ExistingFilter);
	} finally {
		RestoreOverrides();

		if (IteratorClass.HasFilter(strFilterName)) {
			g_Assert.equal(OriginalUnregister.call(IteratorClass, strFilterName), true);
		}
	}

	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(IteratorPrototype, "Resolve"), OriginalResolveDescriptor);
	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(IteratorClass, "UnregisterFilter"), OriginalUnregisterDescriptor);
	g_Assert.deepEqual(IteratorClass.GetFilterNames(), vecOriginalFilterNames);
}

function InstallDependency(strModulePath, Dependency) {
	require.cache[strModulePath] = { exports: Dependency, filename: strModulePath, id: strModulePath, loaded: true };
}

try {
	for (const strModulePath of g_vecCachePaths) {
		delete require.cache[strModulePath];
	}

	CreateEntityRecord(1, "weapon_rifle");
	CreateEntityRecord(2, "weapon_smg");
	CreateEntityRecord(3, "weapon_pistol", { Free: true });
	CreateEntityRecord(4, "prop_physics");
	CreateEntityRecord(5, "weapon_nativeonly");

	// Replace the fixture bridge without invoking a prior accessor; restore its exact descriptor below.
	Object.defineProperty(globalThis, "sourcejs", {
		configurable: true,
		enumerable: true,
		writable: true,
		value: { "filters/weapons": g_NativeWeaponFilters, weapons: g_NativeWeapons },
	});
	InstallDependency(g_strWeaponDataPath, {
		GetAll() {
			return g_vecWeaponDataRecords;
		},
	});
	InstallDependency(g_strWeaponScriptsPath, {
		GetAll() {
			return g_vecWeaponScriptRecords;
		},
	});

	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		if (strRequestName === "weapons/scripts") {
			return require(g_strWeaponScriptsPath);
		}

		if (strRequestName === "weapons/data") {
			return require(g_strWeaponDataPath);
		}

		if (strRequestName === "filters/iterator") {
			return require(g_strIteratorPath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	const g_WeaponFilters = require(g_strPackagePath);
	g_Module._load = g_OriginalModuleLoad;
	VerifyDocumentationRequireContracts();

	g_Assert.strictEqual(g_WeaponFilters, g_NativeWeaponFilters);
	g_Assert.deepEqual(Object.keys(g_WeaponFilters).sort(), [
		"GetAllWeapons",
		"GetCurrentWeapon",
		"GetWeapon",
		"GetWeaponCount",
		"GetWeaponsByClassName",
		"GetWeaponsByName",
		"WeaponClassIterator",
		"WeaponIterator",
	].sort());

	const g_vecFirstScan = g_WeaponFilters.GetAllWeapons();
	const g_vecSecondScan = g_WeaponFilters.GetAllWeapons();
	g_Assert.deepEqual(g_vecFirstScan.map((Weapon) => Weapon.Index), [1, 2, 5]);
	g_Assert.notStrictEqual(g_vecFirstScan, g_vecSecondScan);
	g_Assert.notStrictEqual(g_vecFirstScan[0], g_vecSecondScan[0]);
	g_Assert.deepEqual(g_WeaponFilters.GetWeaponsByClassName("weapon_rifle").map((Weapon) => Weapon.Index), [1]);
	g_Assert.deepEqual(g_WeaponFilters.GetWeaponsByName("rifle").map((Weapon) => Weapon.Index), [1]);
	g_Assert.deepEqual(g_WeaponFilters.GetWeaponsByName("weapon_smg").map((Weapon) => Weapon.Index), [2]);
	g_Assert.equal(g_WeaponFilters.GetWeaponCount(), 3);
	const g_CurrentWeapon = g_WeaponFilters.GetCurrentWeapon(1);
	g_Assert.equal(g_CurrentWeapon.Index, 1, "GetCurrentWeapon must return the current native Weapon object");
	g_Assert.equal(g_CurrentWeapon.ClassName, "weapon_rifle");
	g_Assert.equal(typeof g_CurrentWeapon.Address, "bigint");
	g_Assert.equal(typeof g_CurrentWeapon.RemoveEntity, "function");
	g_Assert.throws(() => g_WeaponFilters.GetWeaponsByClassName(""), { name: "Error" });
	g_Assert.throws(() => g_WeaponFilters.GetWeaponsByName(42), { name: "Error" });
	g_Assert.throws(() => g_WeaponFilters.GetCurrentWeapon(null), { name: "Error" });
	g_Assert.throws(() => g_WeaponFilters.GetCurrentWeapon(4), { name: "Error" });
	g_Assert.throws(() => g_WeaponFilters.GetWeapon(-1), { name: "Error" });
	g_Assert.equal(g_WeaponFilters.GetCurrentWeapon({ Index: 9 }), null);
	g_Assert.equal(g_WeaponFilters.GetWeapon(3), null);
	g_Assert.equal(g_WeaponFilters.GetWeapon(4), null);

	const g_Rifle = g_WeaponFilters.GetWeapon({ Index: 1 });
	g_Assert.ok(g_Rifle);
	for (const strFieldName of [
		"BaseEntity",
		"BaseHandle",
		"ClassName",
		"Edict",
		"Free",
		"HandleValue",
		"Index",
		"IsWeapon",
		"NetworkSerialNumber",
		"Address",
		"StateFlags",
		"Valid",
		"Weapon",
	]) {
		g_Assert.equal(Object.hasOwn(g_Rifle, strFieldName), true, `Weapon must expose ${strFieldName}`);
	}

	g_Assert.equal(g_Rifle.ClassName, "weapon_rifle");
	g_Assert.equal(g_Rifle.Weapon, "rifle");
	g_Assert.equal(g_Rifle.IsWeapon, true);
	g_Assert.equal(g_Rifle.Valid, true);
	g_Assert.equal(g_Rifle.Free, false);
	g_Assert.equal(typeof g_Rifle.Address, "bigint");
	g_Assert.equal(typeof g_Rifle.Edict.Address, "bigint");
	g_Assert.equal(typeof g_Rifle.BaseEntity.Address, "bigint");
	g_Assert.equal(g_Rifle.Edict.Kind, "edict");
	g_Assert.equal(g_Rifle.BaseEntity.Kind, "baseentity");
	g_Assert.equal(g_Rifle.BaseHandle.Kind, "basehandle");

	const g_RifleRecord = g_mapEntityRecords.get(1);
	const g_strPreviousClassName = g_RifleRecord.ClassName;

	g_RifleRecord.ClassName = "prop_physics";
	try {
		g_Assert.equal(g_Rifle.ClassName, "prop_physics");
		g_Assert.equal(g_Rifle.IsWeapon, false);
		g_Assert.equal(g_Rifle.Weapon, "prop_physics");
	} finally {
		g_RifleRecord.ClassName = g_strPreviousClassName;
	}

	const g_nPreviousStateFlags = g_Rifle.StateFlags;
	const g_nPreviousSerialNumber = g_Rifle.NetworkSerialNumber;

	try {
		g_Rifle.StateFlags = g_nPreviousStateFlags + 1;
		g_Rifle.NetworkSerialNumber = g_nPreviousSerialNumber + 1;
		g_Assert.equal(g_Rifle.StateFlags, g_nPreviousStateFlags + 1);
		g_Assert.equal(g_Rifle.NetworkSerialNumber, g_nPreviousSerialNumber + 1);
	} finally {
		g_Rifle.StateFlags = g_nPreviousStateFlags;
		g_Rifle.NetworkSerialNumber = g_nPreviousSerialNumber;
	}

	g_Assert.equal(g_Rifle.SlayEntity(), true);
	g_Assert.equal(g_Rifle.CallEntityInput("AddOutput", "targetname smoke_weapon", 0.5), true);
	g_Assert.equal(g_Rifle.GetEntityProperty("m_iClip1", "int"), 30);
	g_Assert.equal(g_Rifle.SetEntityProperty("m_iClip1", 29, "int"), true);
	g_Assert.equal(g_Rifle.GetEntityPropertyInteger("m_iClip1"), 29);
	g_Assert.equal(g_Rifle.SetEntityPropertyInteger("m_iClip1", 30), true);
	g_Assert.equal(g_Rifle.GetEntityPropertyFloat("m_flNextPrimaryAttack"), 1.25);
	g_Assert.equal(g_Rifle.SetEntityPropertyFloat("m_flNextPrimaryAttack", 1.5), true);
	g_Assert.equal(g_Rifle.GetEntityPropertyString("m_ModelName"), "models/weapons/w_rifle.mdl");
	g_Assert.equal(g_Rifle.SetEntityPropertyString("m_ModelName", "models/weapons/w_rifle_updated.mdl"), true);
	g_Assert.equal(g_Rifle.GetEntityPropertyVector("m_vecOrigin").X, 1);
	g_Assert.equal(g_Rifle.SetEntityPropertyVector("m_vecOrigin", CreateVector(4, 5, 6)), true);
	g_Assert.equal(g_Rifle.GetEntityPropertyEntity("m_hOwnerEntity").Index, 1);
	g_Assert.equal(g_Rifle.SetEntityPropertyEntity("m_hOwnerEntity", { Index: 2 }), true);

	g_Assert.equal(g_Rifle.GetEntityDataMap().ClassName, "CBaseCombatWeapon");
	g_Assert.equal(typeof g_Rifle.GetEntityDataMap().Address, "bigint");
	g_Assert.equal(g_Rifle.GetEntityDataMapProperty("m_spawnflags", "int"), 4);
	g_Assert.equal(g_Rifle.SetEntityDataMapProperty("m_spawnflags", 5, "int"), true);
	g_Assert.equal(g_Rifle.GetEntityDataMapPropertyInteger("m_spawnflags"), 5);
	g_Assert.equal(g_Rifle.SetEntityDataMapPropertyInteger("m_spawnflags", 4), true);
	g_Assert.equal(g_Rifle.GetEntityDataMapPropertyFloat("m_flDelay"), 0.25);
	g_Assert.equal(g_Rifle.SetEntityDataMapPropertyFloat("m_flDelay", 0.5), true);
	g_Assert.equal(g_Rifle.GetEntityDataMapPropertyString("m_ModelName"), "models/weapons/w_rifle.mdl");
	g_Assert.equal(g_Rifle.SetEntityDataMapPropertyString("m_ModelName", "models/weapons/w_rifle_updated.mdl"), true);
	g_Assert.equal(g_Rifle.GetEntityDataMapPropertyVector("m_vecAbsOrigin").X, 4);
	g_Assert.equal(g_Rifle.SetEntityDataMapPropertyVector("m_vecAbsOrigin", CreateVector(7, 8, 9)), true);
	g_Assert.equal(g_Rifle.GetEntityDataMapPropertyEntity("m_hOwnerEntity").Index, 1);
	g_Assert.equal(g_Rifle.SetEntityDataMapPropertyEntity("m_hOwnerEntity", { Index: 2 }), true);

	const g_vecRequiredWeaponMethods = [
		"CallEntityInput",
		"GetEntityDataMap",
		"GetEntityDataMapProperty",
		"GetEntityDataMapPropertyEntity",
		"GetEntityDataMapPropertyFloat",
		"GetEntityDataMapPropertyInteger",
		"GetEntityDataMapPropertyString",
		"GetEntityDataMapPropertyVector",
		"GetEntityProperty",
		"GetEntityPropertyEntity",
		"GetEntityPropertyFloat",
		"GetEntityPropertyInteger",
		"GetEntityPropertyString",
		"GetEntityPropertyVector",
		"RemoveEntity",
		"SetEntityDataMapProperty",
		"SetEntityDataMapPropertyEntity",
		"SetEntityDataMapPropertyFloat",
		"SetEntityDataMapPropertyInteger",
		"SetEntityDataMapPropertyString",
		"SetEntityDataMapPropertyVector",
		"SetEntityProperty",
		"SetEntityPropertyEntity",
		"SetEntityPropertyFloat",
		"SetEntityPropertyInteger",
		"SetEntityPropertyString",
		"SetEntityPropertyVector",
		"SlayEntity",
	];

	const g_RemovableRecord = CreateEntityRecord(9, "weapon_pistol");
	const g_RemovableWeapon = g_WeaponFilters.GetWeapon(9);
	g_Assert.ok(g_RemovableWeapon);
	g_Assert.equal(g_RemovableWeapon.RemoveEntity(), true);
	g_Assert.equal(g_RemovableRecord.Free, true);
	g_Assert.equal(g_RemovableWeapon.Valid, false);
	g_Assert.equal(g_RemovableWeapon.IsWeapon, false);
	g_Assert.equal(g_RemovableWeapon.Weapon, "");
	g_Assert.equal(g_RemovableWeapon.Address, 0n);

	for (const strMethodName of g_vecRequiredWeaponMethods) {
		g_Assert.equal(g_setNativeMethodCalls.has(strMethodName), true, `Weapon method was not exercised: ${strMethodName}`);
	}

	const g_WeaponIterator = new g_WeaponFilters.WeaponIterator(["All", "Valid"], []);
	g_Assert.equal(typeof g_WeaponIterator.IteratorItems, "function");
	g_Assert.equal(g_WeaponIterator.IteratorPredicate, null);
	g_Assert.deepEqual(g_WeaponIterator.RequiredFilterNames, ["All", "Valid"]);
	g_Assert.deepEqual(g_WeaponIterator.ExcludedFilterNames, []);
	g_Assert.deepEqual(g_WeaponIterator.Resolve().map((Weapon) => Weapon.Index), [1, 2, 5]);
	g_Assert.deepEqual(g_WeaponIterator.Values().map((Weapon) => Weapon.Index), [1, 2, 5]);
	g_Assert.deepEqual(g_WeaponIterator.ToArray().map((Weapon) => Weapon.Index), [1, 2, 5]);
	g_Assert.equal(g_WeaponIterator.Count(), 3);
	g_Assert.equal(g_WeaponIterator.First().Index, 1);
	g_Assert.deepEqual(g_WeaponIterator.Filter((Weapon) => Weapon.Index > 1).ToArray().map((Weapon) => Weapon.Index), [2, 5]);
	g_Assert.deepEqual(g_WeaponIterator.Map((Weapon) => Weapon.Weapon), ["rifle", "smg", "nativeonly"]);

	const g_vecVisitedWeaponIndexes = [];
	g_Assert.strictEqual(g_WeaponIterator.ForEach((Weapon) => g_vecVisitedWeaponIndexes.push(Weapon.Index)), g_WeaponIterator);
	g_Assert.deepEqual(g_vecVisitedWeaponIndexes, [1, 2, 5]);
	g_Assert.deepEqual([...g_WeaponIterator].map((Weapon) => Weapon.Index), [1, 2, 5]);
	g_Assert.deepEqual(Array.from(g_WeaponIterator.Iterate()).map((Weapon) => Weapon.Index), [1, 2, 5]);
	g_Assert.equal(g_WeaponIterator.GetIteratorFilterCallback("Valid")(g_Rifle), true);
	g_Assert.equal(g_WeaponIterator.IsValid(g_Rifle), true);

	for (const strStaticMethodName of [
		"DefaultFilters",
		"GetFilterNames",
		"HasFilter",
		"Iterator",
		"RegisterFilter",
		"UnregisterFilter",
	]) {
		g_Assert.equal(typeof g_WeaponFilters.WeaponIterator[strStaticMethodName], "function");
		g_Assert.equal(typeof g_WeaponFilters.WeaponClassIterator[strStaticMethodName], "function");
	}

	g_Assert.equal(g_WeaponFilters.WeaponIterator.HasFilter("All"), true);
	g_Assert.equal(g_WeaponFilters.WeaponIterator.HasFilter("Valid"), true);
	g_Assert.equal(g_WeaponFilters.WeaponIterator.HasFilter("valid"), false);
	g_Assert.equal(g_WeaponFilters.WeaponIterator.HasFilter("primary"), true);
	g_Assert.equal(g_WeaponFilters.WeaponClassIterator.HasFilter("secondary"), true);
	g_Assert.equal(g_WeaponFilters.WeaponIterator.Filters instanceof Map, true);
	g_Assert.equal(g_WeaponFilters.WeaponClassIterator.Filters instanceof Map, true);

	// Metadata filter keys preserve exact user/INI tag values; built-in All is a separate scan.
	const g_DefaultWeaponFilters = g_WeaponFilters.WeaponIterator.DefaultFilters();
	g_Assert.equal(Object.getPrototypeOf(g_DefaultWeaponFilters), null);
	g_Assert.deepEqual(Array.from(g_DefaultWeaponFilters.All, (Weapon) => Weapon.Index), [1, 2, 5]);
	g_Assert.deepEqual(Array.from(g_DefaultWeaponFilters["all"], (Weapon) => Weapon.Index), [1, 2]);
	g_Assert.equal(g_DefaultWeaponFilters.primary instanceof Set, true);
	g_Assert.deepEqual(Array.from(g_DefaultWeaponFilters.primary).map((Weapon) => Weapon.Index), [1, 2]);

	const g_vecOriginalRifleTags = g_vecWeaponDataRecords[0].Tags.slice();
	const g_vecTemporaryFilterNames = [
		"SmokeOddIndex",
		"TemporaryOwnedTag",
		"TemporaryOverrideTag",
		"TemporaryRemovedTag",
	];
	for (const strFilterName of g_vecTemporaryFilterNames) {
		g_Assert.equal(g_WeaponFilters.WeaponIterator.HasFilter(strFilterName), false);
		g_Assert.equal(g_WeaponFilters.WeaponClassIterator.HasFilter(strFilterName), false);
	}

	try {
		const g_strCustomFilterName = "SmokeOddIndex";
		const g_CustomFilter = g_WeaponFilters.WeaponIterator.RegisterFilter(g_strCustomFilterName, (Weapon) => (Weapon.Index % 2) === 1);
		g_Assert.equal(typeof g_CustomFilter, "function");
		g_Assert.equal(g_WeaponFilters.WeaponIterator.HasFilter(g_strCustomFilterName), true);
		g_Assert.deepEqual(new g_WeaponFilters.WeaponIterator(g_strCustomFilterName).ToArray().map((Weapon) => Weapon.Index), [1, 5]);
		g_Assert.throws(() => g_WeaponFilters.WeaponIterator.RegisterFilter(g_strCustomFilterName, g_CustomFilter), /already exists/);
		g_Assert.equal(g_WeaponFilters.WeaponIterator.UnregisterFilter(g_strCustomFilterName), true);
		g_Assert.throws(() => g_WeaponFilters.WeaponIterator.UnregisterFilter(g_strCustomFilterName), /does not exist/);

		g_vecWeaponDataRecords[0].Tags.push("TemporaryOwnedTag");
		try {
			g_Assert.deepEqual(new g_WeaponFilters.WeaponIterator("TemporaryOwnedTag").ToArray().map((Weapon) => Weapon.Index), [1]);
			g_Assert.deepEqual(new g_WeaponFilters.WeaponClassIterator("TemporaryOwnedTag").ToArray().map((Record) => Record.ClassName), ["weapon_rifle"]);
		} finally {
			g_vecWeaponDataRecords[0].Tags.pop();
		}

		g_Assert.doesNotThrow(() => new g_WeaponFilters.WeaponIterator(), "removing metadata tags must remove owned callbacks without calling an instance method statically");
		g_Assert.equal(g_WeaponFilters.WeaponIterator.HasFilter("TemporaryOwnedTag"), false);
		g_Assert.equal(g_WeaponFilters.WeaponClassIterator.HasFilter("TemporaryOwnedTag"), false);

		const g_ReplacementTagCallback = (Weapon) => Weapon.Index === 5;
		g_vecWeaponDataRecords[0].Tags.push("TemporaryOverrideTag");
		try {
			new g_WeaponFilters.WeaponIterator("TemporaryOverrideTag").ToArray();
			g_WeaponFilters.WeaponIterator.UnregisterFilter("TemporaryOverrideTag");
			g_WeaponFilters.WeaponIterator.RegisterFilter("TemporaryOverrideTag", g_ReplacementTagCallback);
		} finally {
			g_vecWeaponDataRecords[0].Tags.pop();
		}

		try {
			g_Assert.deepEqual(new g_WeaponFilters.WeaponIterator("TemporaryOverrideTag").ToArray().map((Weapon) => Weapon.Index), [5]);
			g_Assert.strictEqual(g_WeaponFilters.WeaponIterator.Filters.get("TemporaryOverrideTag"), g_ReplacementTagCallback);
			g_Assert.equal(g_WeaponFilters.WeaponClassIterator.HasFilter("TemporaryOverrideTag"), false);
		} finally {
			g_WeaponFilters.WeaponIterator.UnregisterFilter("TemporaryOverrideTag");
		}

		g_vecWeaponDataRecords[0].Tags.push("TemporaryRemovedTag");
		try {
			new g_WeaponFilters.WeaponIterator("TemporaryRemovedTag").ToArray();
			g_WeaponFilters.WeaponIterator.UnregisterFilter("TemporaryRemovedTag");
			g_WeaponFilters.WeaponClassIterator.UnregisterFilter("TemporaryRemovedTag");
		} finally {
			g_vecWeaponDataRecords[0].Tags.pop();
		}

		g_Assert.doesNotThrow(() => new g_WeaponFilters.WeaponIterator(), "metadata cleanup must tolerate manually removed callbacks");
		g_Assert.equal(g_WeaponFilters.WeaponIterator.HasFilter("TemporaryRemovedTag"), false);
		g_Assert.equal(g_WeaponFilters.WeaponClassIterator.HasFilter("TemporaryRemovedTag"), false);
	} finally {
		g_vecWeaponDataRecords[0].Tags.splice(0, g_vecWeaponDataRecords[0].Tags.length, ...g_vecOriginalRifleTags);
		// Refresh metadata-owned callbacks before removing explicit test registrations.
		new g_WeaponFilters.WeaponIterator();
		for (const IteratorType of [g_WeaponFilters.WeaponIterator, g_WeaponFilters.WeaponClassIterator]) {
			for (const strFilterName of g_vecTemporaryFilterNames) {
				if (IteratorType.HasFilter(strFilterName)) {
					IteratorType.UnregisterFilter(strFilterName);
				}
			}
		}
	}

	const g_vecFirstClassRecords = new g_WeaponFilters.WeaponClassIterator().ToArray();
	const g_vecSecondClassRecords = new g_WeaponFilters.WeaponClassIterator().ToArray();
	const g_RifleClass = g_vecFirstClassRecords.find((Record) => Record.ClassName === "weapon_rifle");
	const g_PistolClass = g_vecFirstClassRecords.find((Record) => Record.ClassName === "weapon_pistol");
	const g_NativeOnlyClass = g_vecFirstClassRecords.find((Record) => Record.ClassName === "weapon_nativeonly");

	g_Assert.ok(g_RifleClass);
	g_Assert.ok(g_PistolClass);
	g_Assert.ok(g_NativeOnlyClass);
	g_Assert.notStrictEqual(g_vecFirstClassRecords, g_vecSecondClassRecords);
	g_Assert.notStrictEqual(g_RifleClass, g_vecSecondClassRecords.find((Record) => Record.ClassName === "weapon_rifle"));
	g_Assert.strictEqual(g_RifleClass.WeaponData, g_RifleData);
	g_Assert.strictEqual(g_RifleClass.WeaponScript, g_RifleScript);
	g_Assert.deepEqual(g_RifleClass.WeaponTags, ["all", "primary", "rifle"]);
	g_Assert.equal(g_RifleClass.WeaponData.profile, "rifle");
	g_Assert.equal(g_RifleClass.PrimaryAmmoProperty, "m_iAmmo.");
	g_Assert.deepEqual(g_RifleClass.WeaponClassNames, ["weapon_rifle"]);
	g_Assert.equal(g_RifleClass.WeaponClip, 1);
	g_Assert.equal(g_RifleClass.WeaponCost, 3100);
	g_Assert.equal(g_RifleClass.WeaponID, "50");
	g_Assert.equal(g_RifleClass.ItemDefinitionIndex, 50);
	g_Assert.equal(g_RifleClass.PrimaryMaximumAmmo, "ammo_assaultrifle_max");
	g_Assert.deepEqual(g_RifleClass.WeaponLookupNames, ["rifle"]);
	g_Assert.equal(g_RifleClass.ParentWeaponClassName, "primary");
	g_Assert.equal(g_RifleClass.SecondaryAmmoProperty, null);
	g_Assert.equal(g_RifleClass.SecondaryMaximumAmmo, null);
	g_Assert.equal(g_RifleClass.WeaponSlot, "0");
	g_Assert.equal(g_RifleClass.WeaponType, "primary");
	g_Assert.strictEqual(g_PistolClass.WeaponData, g_PistolData);
	g_Assert.strictEqual(g_PistolClass.WeaponScript, g_PistolScript);
	g_Assert.deepEqual(g_PistolClass.WeaponTags, ["all", "secondary", "pistol"]);
	g_Assert.deepEqual(g_NativeOnlyClass, { BaseWeaponName: "nativeonly", ClassName: "weapon_nativeonly", WeaponName: "nativeonly", WeaponTags: [] });
	g_Assert.deepEqual(new g_WeaponFilters.WeaponClassIterator("secondary").ToArray().map((Record) => Record.ClassName), ["weapon_pistol"]);
	g_Assert.deepEqual(new g_WeaponFilters.WeaponIterator("primary").ToArray().map((Weapon) => Weapon.Index), [1, 2]);

	const g_LazyIterator = new g_WeaponFilters.WeaponIterator("Valid");
	const g_unInitialLazyCount = g_LazyIterator.Count();
	const g_AddedRecord = CreateEntityRecord(6, "weapon_pistol");

	g_Assert.equal(g_LazyIterator.Count(), g_unInitialLazyCount + 1);
	g_AddedRecord.Free = true;
	g_Assert.equal(g_LazyIterator.Count(), g_unInitialLazyCount);

	for (const InvalidOperation of [
		() => g_WeaponFilters.GetWeaponsByClassName(""),
		() => g_WeaponFilters.GetWeaponsByClassName(1),
		() => g_WeaponFilters.GetWeaponsByName(""),
		() => g_WeaponFilters.GetWeaponsByName(1),
		() => g_WeaponFilters.GetCurrentWeapon(null),
		() => g_WeaponFilters.GetCurrentWeapon(-1),
		() => g_WeaponFilters.GetCurrentWeapon(1.5),
		() => g_WeaponFilters.GetWeapon(undefined),
		() => g_WeaponFilters.GetWeapon(-1),
		() => g_WeaponFilters.GetWeapon("1"),
		() => new g_WeaponFilters.WeaponIterator("MissingFilter"),
		() => new g_WeaponFilters.WeaponIterator(1),
	]) {
		g_Assert.throws(InvalidOperation);
	}

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecDocumentationExamples = ExtractJavaScriptBlocks(g_strDocumentation);
	const g_vecDocumentationLogCalls = [];
	const g_LogDocumentationInfo = (...vecArguments) => g_vecDocumentationLogCalls.push(vecArguments);
	const g_DocumentationRequire = CreateDocumentationRequire(g_WeaponFilters, g_LogDocumentationInfo);
	let g_unExecutedDocumentationExampleCount = 0;
	g_Assert.equal(g_vecDocumentationExamples.length, 14, "filters/weapons documentation must contain fourteen executable JavaScript blocks");
	VerifyWeaponDocumentationCleanup(g_vecDocumentationExamples);
	VerifyNamedWeaponFilterCleanup(g_vecDocumentationExamples, g_WeaponFilters);

	for (const strExample of g_vecDocumentationExamples) {
		const RunExample = new Function("require", "console", strExample);
		RunExample(g_DocumentationRequire, g_ConsoleDouble);
		++g_unExecutedDocumentationExampleCount;
	}

	g_Assert.equal(g_unExecutedDocumentationExampleCount, g_vecDocumentationExamples.length, "Every weapon documentation block must execute.");

	const g_vecDocumentationRecordGroups = [
		{ Format: "WeaponCapabilities %s", Count: 1 },
		{ Format: "WeaponNativeScan %s", Count: 1 },
		{ Format: "WeaponCurrent WeaponIndex=%d PlayerIndex=%d", Count: 1 },
		{ Format: "WeaponLiveFields %s", Count: 1 },
		{ Format: "WeaponClip GenericClipValue=%d TypedClipValue=%d", Count: 1 },
		{ Format: "WeaponDataMap GenericSpawnFlagsValue=%d TypedSpawnFlagsValue=%d ClassName=%s", Count: 1 },
		{ Format: "WeaponIterator %s", Count: 1 },
		{ Format: "WeaponClassIterator %s", Count: 1 },
		{ Format: "WeaponNamedFilter %s", Count: 1 },
		{ Format: "WeaponClassMetadata %s", Count: 4 },
		{ Format: "WeaponInventory %s", Count: 1 },
		{ Format: "WeaponRealtimeResolution %s", Count: 1 },
		{ Format: "WeaponExpectedError Operation=%s ErrorType=%s Message=%s", Count: 5 },
	];
	const g_vecExpectedDocumentationFormats = g_vecDocumentationRecordGroups.flatMap(Group => Array(Group.Count).fill(Group.Format));
	g_Assert.deepEqual(g_vecDocumentationLogCalls.map(vecArguments => vecArguments[0]), g_vecExpectedDocumentationFormats, "Every weapon diagnostic must use the typed logger in order.");
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\s*\./, "Weapon documentation must not use console logging.");

	const g_vecLiveWeaponDiagnosticCall = g_vecDocumentationLogCalls.find(vecArguments => vecArguments[0] === "WeaponLiveFields %s");
	g_Assert.ok(g_vecLiveWeaponDiagnosticCall);
	const g_LiveWeaponDiagnostic = JSON.parse(g_vecLiveWeaponDiagnosticCall[1]);
	g_Assert.equal(typeof g_LiveWeaponDiagnostic.Address, "string");
	g_Assert.equal(g_LiveWeaponDiagnostic.Address, g_Rifle.Address.toString());
	g_Assert.equal(g_LiveWeaponDiagnostic.HasBaseEntity, true);
	g_Assert.equal(g_LiveWeaponDiagnostic.HasBaseHandle, true);
	g_Assert.equal(g_LiveWeaponDiagnostic.HasEdict, true);

	for (const vecArguments of g_vecDocumentationLogCalls) {
		if (vecArguments[0] !== "WeaponClassMetadata %s") {
			continue;
		}

		const MetadataReport = JSON.parse(vecArguments[1]);
		g_Assert.equal(Object.hasOwn(MetadataReport, "WeaponData"), false);

		if (MetadataReport.WeaponScript !== undefined) {
			g_Assert.equal(Object.hasOwn(MetadataReport.WeaponScript, "KeyValues"), false);
			g_Assert.equal(typeof MetadataReport.WeaponScript.HasKeyValues, "boolean");
		}
	}

	for (const strExportName of [
		"WeaponClassIterator",
		"WeaponIterator",
		"GetAllWeapons",
		"GetWeaponsByClassName",
		"GetWeaponsByName",
		"GetWeaponCount",
		"GetCurrentWeapon",
		"GetWeapon",
	]) {
		g_Assert.equal(new RegExp(`\\b${strExportName}\\b`).test(g_strDocumentation), true, `Documentation must cover ${strExportName}`);
	}

	for (const strFieldName of [
		"Index",
		"Valid",
		"Free",
		"ClassName",
		"StateFlags",
		"NetworkSerialNumber",
		"Edict",
		"BaseEntity",
		"Address",
		"BaseHandle",
		"HandleValue",
		"IsWeapon",
		"Weapon",
	]) {
		g_Assert.equal(new RegExp(`\\b${strFieldName}\\b`).test(g_strDocumentation), true, `Documentation must cover Weapon.${strFieldName}`);
	}

	for (const strMethodName of [
		"RemoveEntity",
		"SlayEntity",
		"CallEntityInput",
		"GetEntityProperty",
		"GetEntityPropertyInteger",
		"GetEntityPropertyFloat",
		"GetEntityPropertyString",
		"GetEntityPropertyVector",
		"GetEntityPropertyEntity",
		"SetEntityProperty",
		"SetEntityPropertyInteger",
		"SetEntityPropertyFloat",
		"SetEntityPropertyString",
		"SetEntityPropertyVector",
		"SetEntityPropertyEntity",
		"GetEntityDataMap",
		"GetEntityDataMapProperty",
		"GetEntityDataMapPropertyInteger",
		"GetEntityDataMapPropertyFloat",
		"GetEntityDataMapPropertyString",
		"GetEntityDataMapPropertyVector",
		"GetEntityDataMapPropertyEntity",
		"SetEntityDataMapProperty",
		"SetEntityDataMapPropertyInteger",
		"SetEntityDataMapPropertyFloat",
		"SetEntityDataMapPropertyString",
		"SetEntityDataMapPropertyVector",
		"SetEntityDataMapPropertyEntity",
	]) {
		g_Assert.equal(new RegExp(`\\b${strMethodName}\\b`).test(g_strDocumentation), true, `Documentation must cover Weapon.${strMethodName}`);
	}

	for (const strIteratorMemberName of [
		"IteratorPredicate",
		"RequiredFilterNames",
		"ExcludedFilterNames",
		"Resolve",
		"Values",
		"ToArray",
		"Count",
		"First",
		"Filter",
		"Map",
		"ForEach",
		"Iterator",
		"RegisterFilter",
		"UnregisterFilter",
		"HasFilter",
		"GetFilterNames",
		"DefaultFilters",
		"GetIteratorFilterCallback",
		"IsValid",
		"Symbol.iterator",
	]) {
		g_Assert.equal(new RegExp(strIteratorMemberName.replace(".", "\\.")).test(g_strDocumentation), true, `Documentation must cover iterator member ${strIteratorMemberName}`);
	}

	for (const strMetadataName of [
		"BaseWeaponName",
		"ClassName",
		"WeaponName",
		"WeaponTags",
		"PrimaryAmmoProperty",
		"WeaponClassNames",
		"WeaponClip",
		"WeaponCost",
		"WeaponData",
		"WeaponID",
		"ItemDefinitionIndex",
		"PrimaryMaximumAmmo",
		"WeaponLookupNames",
		"ParentWeaponClassName",
		"WeaponScript",
		"SecondaryAmmoProperty",
		"SecondaryMaximumAmmo",
		"WeaponSlot",
		"WeaponType",
		"KeyValues",
		"Name",
		"Path",
	]) {
		g_Assert.equal(new RegExp(`\\b${strMetadataName}\\b`).test(g_strDocumentation), true, `Documentation must cover class metadata ${strMetadataName}`);
	}

	for (const vecMatch of g_strDocumentation.matchAll(/\]\(([^)#]+\.md)(?:#[^)]+)?\)/g)) {
		const strLinkedPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), vecMatch[1]);
		g_Assert.equal(g_FileSystem.existsSync(strLinkedPath), true, `Documentation link does not exist: ${vecMatch[1]}`);
	}

	for (const strForbiddenTerm of [
		"Generated by",
		"generate_api_docs",
		"console.log(instance)",
		"console.log(result)",
		"sourcejs:example",
		"weaponNameFromClassName(",
		"record.data.WeaponData",
	]) {
		g_Assert.equal(g_strDocumentation.includes(strForbiddenTerm), false, `Documentation must not contain ${strForbiddenTerm}`);
	}

	const g_strNativeBindings = g_FileSystem.readFileSync(g_strNativeBindingsPath, "utf8");
	for (const NativePattern of [
		/EntityLiveProperty::IsWeapon/,
		/EntityLiveProperty::WeaponName/,
		/InstallEntityLiveProperty\([^\n]+kIsWeaponPropertyName, EntityLiveProperty::IsWeapon\)/,
		/InstallEntityLiveProperty\([^\n]+kWeaponNamePropertyName, EntityLiveProperty::WeaponName\)/,
		/RequireWeaponsStringArgument\(CallbackInformation, kWeaponClassNameArgumentIndex, "Weapons\.GetWeaponsByClassName\(strWeaponClassName\)/,
		/RequireWeaponsStringArgument\(CallbackInformation, kWeaponNameArgumentIndex, "Weapons\.GetWeaponsByName\(strWeaponName\)/,
		/GetCurrentWeaponCallback/,
		/RequireWeaponsIndexArgument\(CallbackInformation, kWeaponReferenceArgumentIndex, "Weapons\.GetWeapon\(WeaponReference\)/,
	]) {
		g_Assert.equal(NativePattern.test(g_strNativeBindings), true, "Native weapon binding missing: " + NativePattern);
	}

	for (const strRemovedName of [
		"Weapon",
		"WeaponClassIter",
		"WeaponIter",
		"byIndex",
		"classes",
		"moduleName",
		"valid",
		"default",
	]) {
		g_Assert.equal(Object.hasOwn(g_WeaponFilters, strRemovedName), false, `Removed filters/weapons export remains: ${strRemovedName}`);
	}

	g_Assert.equal(VerifyWorldWeaponFilterExample(g_WeaponFilters), 2, "Both weapon world example profiles must execute.");

	g_Assert.equal(g_vecEntityInputCalls.some((Call) => Call.InputName === "AddOutput"), true);

	console.log("[  OK  ] filters/weapons contracts and documentation passed with native weapon/data/script/player doubles; native SDK execution not exercised");
} finally {
	g_Module._load = g_OriginalModuleLoad;
	for (const [strModulePath, CacheEntry] of g_mapOriginalCacheEntries) {
		delete require.cache[strModulePath];

		if (CacheEntry !== undefined) {
			require.cache[strModulePath] = CacheEntry;
		}
	}

	if (g_OriginalSourceJSDescriptor === undefined) {
		delete globalThis.sourcejs;
	} else {
		Object.defineProperty(globalThis, "sourcejs", g_OriginalSourceJSDescriptor);
	}
}
