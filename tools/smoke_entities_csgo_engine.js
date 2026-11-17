#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strRepositoryRoot = g_Path.resolve(__dirname, "..");
const g_strPackagePath = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs", "entities", "engines", "csgo", "csgo.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRoot, "docs", "api", "entities-engines-csgo-csgo.md");
const g_strNativeBindingsPath = g_Path.join(g_strRepositoryRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRuntimePath = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs", "internal", "runtime.js");
const g_EntityStateKey = Symbol("EntityState");

const g_nInt32Minimum = -2_147_483_648;
const g_nInt32Maximum = 2_147_483_647;
const g_unEntityBaseAddress = 0x500000n;
const g_unEntityAddressStride = 0x100n;
const g_unHandleBaseValue = 0x1000;
const g_unFirstCreatedEntityIndex = 40;
const g_unNativeBigIntStorageBits = 64;
const g_vecNativeIntegerStorageBits = [8, 16, 32, g_unNativeBigIntStorageBits];
const g_strItemDefinitionProperty = "m_AttributeManager.m_Item.m_iItemDefinitionIndex";
const g_vecMaximumExportNames = [
	"ITEM_DEFINITION_PROPERTY",
	"BRANCH",
	"CreateEntityByClassName",
	"FindEntityByClassName",
	"GetEntitiesByClassName",
	"GetEntityByIndex",
	"GetEntityItemDefinitionIndex",
	"SetEntityItemDefinitionIndex",
];

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

function MakeEntity(mapEntityState, unEntityIndex, strClassName, nItemDefinitionIndex = null) {
	const State = {
		BaseEntity: { Index: unEntityIndex },
		BaseHandle: { Value: unEntityIndex + g_unHandleBaseValue },
		ClassName: strClassName,
		Edict: { Index: unEntityIndex },
		Free: false,
		HandleValue: unEntityIndex + g_unHandleBaseValue,
		Index: unEntityIndex,
		ItemDefinitionIndex: nItemDefinitionIndex,
		NetworkSerialNumber: 10 + unEntityIndex,
		Address: g_unEntityBaseAddress + BigInt(unEntityIndex) * g_unEntityAddressStride,
		Removed: false,
		Spawned: false,
		StateFlags: 0x00,
	};
	const Entity = {
		get BaseEntity() {
			return (State.Removed || State.Free) ? null : State.BaseEntity;
		},
		get BaseHandle() {
			return (State.Removed || State.Free) ? null : State.BaseHandle;
		},
		get ClassName() {
			return State.Removed ? "" : State.ClassName;
		},
		get Edict() {
			return (State.Removed || State.Free) ? null : State.Edict;
		},
		get Free() {
			return State.Free;
		},
		set Free(bValue) {
			if (typeof bValue !== "boolean") {
				throw new TypeError("Free must be a boolean.");
			}

			State.Free = bValue;
		},
		get HandleValue() {
			return State.Removed ? -1 : State.HandleValue;
		},
		get Index() {
			return State.Index;
		},
		get NetworkSerialNumber() {
			return State.NetworkSerialNumber;
		},
		set NetworkSerialNumber(nValue) {
			State.NetworkSerialNumber = nValue;
		},
		get Address() {
			return (State.Removed || State.Free) ? 0n : State.Address;
		},
		get StateFlags() {
			return State.StateFlags;
		},
		set StateFlags(nValue) {
			State.StateFlags = nValue;
		},
		get Valid() {
			return !State.Removed && !State.Free;
		},
		CallEntityInput(strName) {
			if ((typeof strName !== "string") || (strName.length === 0)) {
				throw new TypeError("CallEntityInput() expects a non-empty input name.");
			}

			return true;
		},
		GetEntityProperty(strPropertyName) {
			if ((strPropertyName !== g_strItemDefinitionProperty) || (State.ItemDefinitionIndex === null)) {
				throw new Error(`missing property ${strPropertyName}`);
			}

			return State.ItemDefinitionIndex;
		},
		RemoveEntity() {
			State.Removed = true;
			mapEntityState.delete(unEntityIndex);

			return true;
		},
	};

	Object.defineProperty(Entity, g_EntityStateKey, {
		configurable: false,
		enumerable: false,
		value: State,
		writable: false,
	});

	return Entity;
}

function MakeNativeModule(Options = {}) {
	const bWithCreate = Options.WithCreate !== false;
	const unStorageBits = Options.StorageBits ?? 32;
	const bSignedStorage = Options.SignedStorage ?? true;
	if (!g_vecNativeIntegerStorageBits.includes(unStorageBits) || (typeof bSignedStorage !== "boolean")) {
		throw new TypeError("The controlled integer-storage profile requires a supported width and signedness.");
	}

	const bBigIntStorage = unStorageBits === g_unNativeBigIntStorageBits;
	const nMinimumStorageValue = bSignedStorage ? -(1n << BigInt(unStorageBits - 1)) : 0n;
	const nMaximumStorageValue = (1n << BigInt(unStorageBits - (bSignedStorage ? 1 : 0))) - 1n;
	const mapEntityState = new Map();
	let unNextEntityIndex = g_unFirstCreatedEntityIndex;

	// Controlled storage profiles exercise representation/range rules, not native SDK proxy discovery.
	function NormalizeItemDefinitionIndex(nValue) {
		const strStorageName = `${bSignedStorage ? "Int" : "Uint"}${unStorageBits}`;
		const strRangeError = `An integer within the ${strStorageName} native storage range is required; 64-bit fields require BigInt.`;
		let nIntegerValue = nValue;
		if (typeof nValue === "number") {
			if (bBigIntStorage || !Number.isInteger(nValue)) {
				throw new TypeError(strRangeError);
			}

			nIntegerValue = BigInt(nValue);

		} else if (typeof nValue !== "bigint") {
			throw new TypeError(strRangeError);
		}

		if ((nIntegerValue < nMinimumStorageValue) || (nIntegerValue > nMaximumStorageValue)) {
			throw new TypeError(strRangeError);
		}

		return bBigIntStorage ? nIntegerValue : Number(nIntegerValue);
	}

	const nInitialItemDefinitionIndex = Options.InitialItemDefinitionIndex ?? (bBigIntStorage ? 7n : 7);
	mapEntityState.set(0, MakeEntity(mapEntityState, 0, "worldspawn"));
	mapEntityState.set(31, MakeEntity(mapEntityState, 31, "weapon_ak47", NormalizeItemDefinitionIndex(nInitialItemDefinitionIndex)));
	mapEntityState.set(32, MakeEntity(mapEntityState, 32, "weapon_knife", NormalizeItemDefinitionIndex(42n)));

	function RequireClassName(strClassName, strOperation) {
		if ((typeof strClassName !== "string") || (strClassName.length === 0)) {
			throw new TypeError(`${strOperation} expects a non-empty class name.`);
		}
	}

	function RequireEntity(Value) {
		if ((Value === null) || (typeof Value !== "object") || !Value[g_EntityStateKey] || !Value.Valid) {
			throw new TypeError("A live entity is required.");
		}

		return Value[g_EntityStateKey];
	}

	const NativeModule = {
		ITEM_DEFINITION_PROPERTY: g_strItemDefinitionProperty,
		BRANCH: "csgo",
		GetEntitiesByClassName(strClassName) {
			RequireClassName(strClassName, "GetEntitiesByClassName(strClassName)");

			return [...mapEntityState.values()].filter((Entity) => Entity.Valid && (Entity.ClassName === strClassName));
		},
		GetEntityByIndex(nEntityIndex) {
			if (!Number.isInteger(nEntityIndex) || (nEntityIndex < g_nInt32Minimum) || (nEntityIndex > g_nInt32Maximum)) {
				throw new TypeError("GetEntityByIndex(nEntityIndex) expects an Int32 index.");
			}

			const Entity = mapEntityState.get(nEntityIndex);

			return (Entity && Entity.Valid) ? Entity : null;
		},
		FindEntityByClassName(strClassName) {
			RequireClassName(strClassName, "FindEntityByClassName(strClassName)");

			for (const Entity of mapEntityState.values()) {
				if (Entity.Valid && (Entity.ClassName === strClassName)) {
					return Entity;
				}
			}

			return null;
		},
		// Native helpers discover actual storage; this fixture uses the explicit controlled profile above.
		GetEntityItemDefinitionIndex(EntityValue) {
			const State = RequireEntity(EntityValue);
			if (State.ItemDefinitionIndex === null) {
				throw new Error(`missing property ${g_strItemDefinitionProperty}`);
			}

			return State.ItemDefinitionIndex;
		},
		SetEntityItemDefinitionIndex(EntityValue, nItemDefinitionIndex) {
			const State = RequireEntity(EntityValue);
			const nNormalizedItemDefinitionIndex = NormalizeItemDefinitionIndex(nItemDefinitionIndex);

			if (State.ItemDefinitionIndex === null) {
				throw new Error(`missing property ${g_strItemDefinitionProperty}`);
			}

			State.ItemDefinitionIndex = nNormalizedItemDefinitionIndex;

			return true;
		},
	};

	if (bWithCreate) {
		NativeModule.CreateEntityByClassName = (strClassName, CreateOptions = undefined) => {
			RequireClassName(strClassName, "CreateEntityByClassName(strClassName, CreateOptions?)");

			if ((CreateOptions !== undefined) && ((CreateOptions === null) || (typeof CreateOptions !== "object") || Array.isArray(CreateOptions))) {
				throw new TypeError("CreateEntityByClassName() options must be an object.");
			}

			if ((CreateOptions !== undefined) && Object.hasOwn(CreateOptions, "DispatchSpawn") && (typeof CreateOptions.DispatchSpawn !== "boolean")) {
				throw new TypeError("DispatchSpawn must be a boolean.");
			}

			const Entity = MakeEntity(mapEntityState, unNextEntityIndex, strClassName, NormalizeItemDefinitionIndex(0n));
			unNextEntityIndex += 1;
			Entity[g_EntityStateKey].Spawned = CreateOptions?.DispatchSpawn === true;
			mapEntityState.set(Entity.Index, Entity);

			return Entity;
		};
	}

	return {
		EntityState: mapEntityState,
		NativeModule,
	};
}

function VerifyEntityFixture() {
	const Fixture = MakeNativeModule();
	const vecEntities = [...Fixture.EntityState.values()];
	g_Assert.deepEqual(vecEntities.map((Entity) => Entity.Address), [0x500000n, 0x501F00n, 0x502000n], "CSGO fixture addresses must be exact BigInt values");

	for (const Entity of vecEntities) {
		const State = Entity[g_EntityStateKey];
		g_Assert.equal(Entity.BaseEntity.Index, Entity.Index);
		g_Assert.equal(Entity.Edict.Index, Entity.Index);
		g_Assert.equal(Entity.BaseHandle.Value, Entity.HandleValue);

		for (const Record of [State, Entity.BaseEntity, Entity.BaseHandle, Entity.Edict]) {
			g_Assert.equal(Object.keys(Record).some((strName) => strName.startsWith("m_")), false, "CSGO fixture records must use PascalCase fields");
		}

		Entity.Free = true;
		g_Assert.equal(Entity.Address, 0n, "free CSGO fixture address must be BigInt zero");
		g_Assert.equal(Entity.BaseEntity, null);
		g_Assert.equal(Entity.BaseHandle, null);
		g_Assert.equal(Entity.Edict, null);
		Entity.Free = false;
		g_Assert.equal(Entity.Address, State.Address);
	}

	const World = Fixture.NativeModule.GetEntityByIndex(0);
	g_Assert.equal(World.RemoveEntity(), true);
	g_Assert.equal(World.Address, 0n, "removed CSGO fixture address must be BigInt zero");
	g_Assert.equal(World.Valid, false);
	g_Assert.equal(Fixture.EntityState.has(0), false);
}

VerifyEntityFixture();

function LoadPackage(NativeModule) {
	globalThis.sourcejs = {
		"entities/engines/csgo/csgo": NativeModule,
	};
	delete require.cache[g_strPackagePath];

	return require(g_strPackagePath);
}

function ExtractJavaScriptBlocks(strDocumentation) {
	const vecBlocks = [];
	const Expression = /```js\r?\n([\s\S]*?)```/g;
	let vecMatch = Expression.exec(strDocumentation);

	while (vecMatch) {
		vecBlocks.push(vecMatch[1]);
		vecMatch = Expression.exec(strDocumentation);
	}

	return vecBlocks;
}

function TrackModule(NativeModule, setExercisedExports) {
	return new Proxy(NativeModule, {
		get(Target, Property, Receiver) {
			if ((typeof Property === "string") && g_vecMaximumExportNames.includes(Property)) {
				setExercisedExports.add(Property);
			}

			const Value = Reflect.get(Target, Property, Receiver);

			if (typeof Value !== "function") {
				return Value;
			}

			return (...vecArguments) => Value(...vecArguments);
		},
	});
}

function ExecuteDocumentationBlock(strSource, ModuleObject) {
	const vecRecords = [];
	const BlockRequire = (strSpecifier) => {
		if (strSpecifier === "entities/engines/csgo/csgo") {
			return ModuleObject;
		}

		if (strSpecifier === "loggers") {
			return {
				LogInfo(strFormat, Result) {
					g_Assert.match(strFormat, /^[A-Z][A-Za-z]+ Result=%j$/);
					g_Assert.equal(typeof Result, "object");
					g_Assert.notEqual(Result, null);
					vecRecords.push({ Format: strFormat, Result: JSON.parse(JSON.stringify(Result)) });
				},
			};
		}

		throw new Error(`Unexpected documentation dependency: ${strSpecifier}`);
	};
	const Execute = new Function("require", `"use strict";\n${strSource}`);
	g_Assert.doesNotMatch(strSource, /console\./);
	Execute(BlockRequire);

	return vecRecords;
}

function VerifyDocumentationStorageProfiles(vecBlocks) {
	const unWideEntityAddress = 0xFEDCBA9876543210n;
	const vecExpectedFormats = [[], ["InspectCSGOEntityCreation Result=%j"], ["InspectCSGOWeapon Result=%j"], ["ResolveCSGOEntity Result=%j"], [], [], ["InitializeCSGOWeapon Result=%j"]];
	const strTemporaryWriteBlock = vecBlocks.find((strBlock) => strBlock.includes("function ChangeItemDefinitionTemporarily()"));
	const strCreationBlock = vecBlocks.find((strBlock) => strBlock.includes("function CreateInitializeAndRemoveWeaponEntity()"));
	g_Assert.equal(typeof strTemporaryWriteBlock, "string");
	g_Assert.equal(typeof strCreationBlock, "string");

	for (const unStorageBits of g_vecNativeIntegerStorageBits) {
		for (const bSignedStorage of [true, false]) {
			const bBigIntStorage = unStorageBits === g_unNativeBigIntStorageBits;
			const nMinimumValue = bSignedStorage ? -(1n << BigInt(unStorageBits - 1)) : 0n;
			const nMaximumValue = (1n << BigInt(unStorageBits - (bSignedStorage ? 1 : 0))) - 1n;
			const nInitialValue = bSignedStorage ? nMinimumValue : nMaximumValue;
			const Fixture = MakeNativeModule({ StorageBits: unStorageBits, SignedStorage: bSignedStorage, InitialItemDefinitionIndex: nInitialValue });
			const NativeModule = Fixture.NativeModule;
			const Weapon = NativeModule.GetEntityByIndex(31);
			Weapon[g_EntityStateKey].Address = unWideEntityAddress;

			for (let unBlockIndex = 0; unBlockIndex < vecBlocks.length; unBlockIndex++) {
				const vecRecords = ExecuteDocumentationBlock(vecBlocks[unBlockIndex], NativeModule);
				g_Assert.deepEqual(vecRecords.map((Record) => Record.Format), vecExpectedFormats[unBlockIndex]);

				for (const Record of vecRecords) {
					if (Record.Format === "InspectCSGOWeapon Result=%j") {
						g_Assert.equal(Record.Result.Address, "0xFEDCBA9876543210");
						g_Assert.equal(Record.Result.ItemDefinitionIndexText, String(nInitialValue));
					}

					if (Record.Format === "InspectCSGOEntityCreation Result=%j") {
						g_Assert.equal(Record.Result.CanCreateNativeEntities, true);
					}

					if (Record.Format === "ResolveCSGOEntity Result=%j") {
						g_Assert.equal(Record.Result.Valid, true);
						g_Assert.equal(Record.Result.FirstEntityIndex, Record.Result.ResolvedEntityIndex);
					}

					if (Record.Format === "InitializeCSGOWeapon Result=%j") {
						g_Assert.equal(Record.Result.ItemDefinitionIndexText, "7");
					}
				}
			}

			g_Assert.equal(Fixture.EntityState.size, 3);
			g_Assert.strictEqual(NativeModule.GetEntityItemDefinitionIndex(Weapon), bBigIntStorage ? nInitialValue : Number(nInitialValue));

			for (const nBoundaryValue of [nMinimumValue, nMaximumValue]) {
				g_Assert.equal(NativeModule.SetEntityItemDefinitionIndex(Weapon, nBoundaryValue), true);
				g_Assert.strictEqual(NativeModule.GetEntityItemDefinitionIndex(Weapon), bBigIntStorage ? nBoundaryValue : Number(nBoundaryValue));
			}

			const nPreservedValue = NativeModule.GetEntityItemDefinitionIndex(Weapon);
			for (const InvalidValue of [nMinimumValue - 1n, nMaximumValue + 1n, undefined, null, false, "7", 1.5, NaN, Infinity]) {
				g_Assert.throws(() => NativeModule.SetEntityItemDefinitionIndex(Weapon, InvalidValue), /native storage range/);
				g_Assert.strictEqual(NativeModule.GetEntityItemDefinitionIndex(Weapon), nPreservedValue);
			}

			if (bBigIntStorage) {
				g_Assert.throws(() => NativeModule.SetEntityItemDefinitionIndex(Weapon, 7), /BigInt/);
				g_Assert.strictEqual(NativeModule.GetEntityItemDefinitionIndex(Weapon), nPreservedValue);
			} else {
				g_Assert.equal(NativeModule.SetEntityItemDefinitionIndex(Weapon, Number(nMinimumValue)), true);
				g_Assert.equal(NativeModule.SetEntityItemDefinitionIndex(Weapon, Number(nMaximumValue)), true);
			}

			g_Assert.equal(NativeModule.SetEntityItemDefinitionIndex(Weapon, nInitialValue), true);

			const GetItemDefinitionIndex = NativeModule.GetEntityItemDefinitionIndex;
			const WriteProbeError = new Error("The read after the temporary write failed.");
			let unReadCount = 0;
			NativeModule.GetEntityItemDefinitionIndex = (EntityValue) => {
				unReadCount++;
				if (unReadCount === 2) {
					throw WriteProbeError;
				}

				return GetItemDefinitionIndex(EntityValue);
			};

			try {
				g_Assert.throws(() => ExecuteDocumentationBlock(strTemporaryWriteBlock, NativeModule), (ErrorValue) => ErrorValue === WriteProbeError);
			} finally {
				NativeModule.GetEntityItemDefinitionIndex = GetItemDefinitionIndex;
			}

			g_Assert.strictEqual(GetItemDefinitionIndex(Weapon), bBigIntStorage ? nInitialValue : Number(nInitialValue));

			const CreationProbeError = new Error("The newly created entity's initial read failed.");
			NativeModule.GetEntityItemDefinitionIndex = (EntityValue) => {
				if (EntityValue.Index >= g_unFirstCreatedEntityIndex) {
					throw CreationProbeError;
				}

				return GetItemDefinitionIndex(EntityValue);
			};

			try {
				g_Assert.throws(() => ExecuteDocumentationBlock(strCreationBlock, NativeModule), (ErrorValue) => ErrorValue === CreationProbeError);
			} finally {
				NativeModule.GetEntityItemDefinitionIndex = GetItemDefinitionIndex;
			}

			g_Assert.equal(Fixture.EntityState.size, 3);
		}
	}

	const ReducedFixture = MakeNativeModule({ WithCreate: false });
	const vecCapabilityRecords = ExecuteDocumentationBlock(vecBlocks[1], ReducedFixture.NativeModule);
	g_Assert.equal(vecCapabilityRecords[0].Result.CanCreateNativeEntities, false);
	g_Assert.throws(() => ExecuteDocumentationBlock(strCreationBlock, ReducedFixture.NativeModule), /does not expose native entity creation/);
	g_Assert.equal(ReducedFixture.EntityState.size, 3);
}

function VerifyEntityIdentityDocumentation(vecBlocks) {
	const strIdentityBlock = vecBlocks.find((strBlock) => strBlock.includes("function ResolveEntityAgainByIndex()"));
	g_Assert.equal(typeof strIdentityBlock, "string");

	const nEntityIndex = 31;
	const nInitialHandleValue = 31;
	const nReplacementHandleValue = 63;
	let nLiveHandleValue = nInitialHandleValue;
	const FirstKnife = {
		Index: nEntityIndex,
		get HandleValue() {
			return nLiveHandleValue;
		},
	};
	const ReusedIndexModule = {
		FindEntityByClassName: () => FirstKnife,
		GetEntityByIndex() {
			nLiveHandleValue = nReplacementHandleValue;

			return { Index: nEntityIndex, HandleValue: nLiveHandleValue, Valid: true };
		},
	};

	// Both live wrappers can observe the replacement; only the earlier snapshot detects reuse.
	g_Assert.throws(() => ExecuteDocumentationBlock(strIdentityBlock, ReusedIndexModule), /identity changed during resolution/);

	let bResolvedWithoutHandle = false;
	const MissingHandleModule = {
		FindEntityByClassName: () => ({ Index: nEntityIndex, HandleValue: -1 }),
		GetEntityByIndex() {
			bResolvedWithoutHandle = true;

			return { Index: nEntityIndex, HandleValue: -1, Valid: true };
		},
	};
	g_Assert.throws(() => ExecuteDocumentationBlock(strIdentityBlock, MissingHandleModule), /no valid packed handle/);
	g_Assert.equal(bResolvedWithoutHandle, false);

	const SignedHandleModule = {
		FindEntityByClassName: () => ({ Index: nEntityIndex, HandleValue: -2 }),
		GetEntityByIndex() {
			return { Index: nEntityIndex, HandleValue: -2, Valid: true };
		},
	};
	const vecSignedHandleRecords = ExecuteDocumentationBlock(strIdentityBlock, SignedHandleModule);
	g_Assert.equal(vecSignedHandleRecords.length, 1);
	g_Assert.equal(vecSignedHandleRecords[0].Result.Valid, true);
}

function VerifyNativeItemDefinitionContexts(strBindings) {
	const vecOperations = [
		{ ExportName: "GetEntityItemDefinitionIndex", CallbackName: "GetCSGOEntityItemDefinitionIndexCallback", HelperName: "EntityPropertiesGetNamedIntegerProperty", ErrorMessage: "entities/engines/csgo/csgo.GetEntityItemDefinitionIndex(Entity) expects an entity." },
		{ ExportName: "SetEntityItemDefinitionIndex", CallbackName: "SetCSGOEntityItemDefinitionIndexCallback", HelperName: "EntityPropertiesSetNamedIntegerProperty", ErrorMessage: "entities/engines/csgo/csgo.SetEntityItemDefinitionIndex(Entity, nValue) expects an entity and value." },
	];

	for (const Operation of vecOperations) {
		const nCallbackStart = strBindings.indexOf(`\t\tvoid ${Operation.CallbackName}(`);
		g_Assert.notEqual(nCallbackStart, -1, `Missing entity callback: ${Operation.CallbackName}`);

		const nCallbackEnd = strBindings.indexOf("\n\t\t}", nCallbackStart);
		g_Assert.notEqual(nCallbackEnd, -1);

		const strCallback = strBindings.slice(nCallbackStart, nCallbackEnd);
		g_Assert.ok(strCallback.includes(`kPropertyName = "${g_strItemDefinitionProperty}";`));
		g_Assert.ok(strCallback.includes(`kErrorMessage = "${Operation.ErrorMessage}";`), `Incorrect entity diagnostic: ${Operation.CallbackName}`);
		g_Assert.ok(strCallback.includes(`${Operation.HelperName}(CallbackInformation, kPropertyName, kErrorMessage);`));
		g_Assert.ok(strBindings.includes(`LocalCSGOEntityEngineModule, "${Operation.ExportName}", ${Operation.CallbackName}, LocalRuntimeData)`), `Incorrect entity registration: ${Operation.ExportName}`);
	}

	g_Assert.ok(/#if defined\(SOURCEJS_HAS_SENDPROPS\)\n\t\tvoid GetCSGOEntityItemDefinitionIndexCallback\([\s\S]*?\n\t\tvoid SetCSGOEntityItemDefinitionIndexCallback\([\s\S]*?\n#endif \/\/ defined\(SOURCEJS_HAS_SENDPROPS\)/.test(strBindings), "Guard both CSGO item-definition callbacks with sendprop capability and namespace indentation.");
	g_Assert.ok(strBindings.includes('LocalWeaponsEnginesCSGOModule, "GetWeaponItemDefinitionIndex", GetCSGOItemDefinitionIndexCallback, LocalRuntimeData)'));
	g_Assert.ok(strBindings.includes('LocalWeaponsEnginesCSGOModule, "SetWeaponItemDefinitionIndex", SetCSGOItemDefinitionIndexCallback, LocalRuntimeData)'));
	g_Assert.ok(strBindings.includes('kErrorMessage = "weapons/engines/csgo.GetWeaponItemDefinitionIndex(Entity) expects an entity.";'));
	g_Assert.ok(strBindings.includes('kErrorMessage = "weapons/engines/csgo.SetWeaponItemDefinitionIndex(Entity, nValue) expects an entity and value.";'));
}

const g_MaximumFixture = MakeNativeModule();
const g_CSGOEntities = LoadPackage(g_MaximumFixture.NativeModule);

g_Assert.strictEqual(g_CSGOEntities, g_MaximumFixture.NativeModule);
g_Assert.deepEqual(Object.keys(g_CSGOEntities).sort(), [...g_vecMaximumExportNames].sort());
g_Assert.equal(g_CSGOEntities.BRANCH, "csgo");
g_Assert.equal(g_CSGOEntities.ITEM_DEFINITION_PROPERTY, g_strItemDefinitionProperty);
g_Assert.ok(!Object.hasOwn(g_CSGOEntities, "itemDefinitionProperty"));

const g_WeaponEntity = g_CSGOEntities.GetEntityByIndex(31);
g_Assert.strictEqual(g_WeaponEntity, g_MaximumFixture.EntityState.get(31));
g_Assert.deepEqual(g_CSGOEntities.GetEntitiesByClassName("weapon_ak47"), [g_WeaponEntity]);
g_Assert.strictEqual(g_CSGOEntities.FindEntityByClassName("weapon_ak47"), g_WeaponEntity);
g_Assert.equal(g_CSGOEntities.FindEntityByClassName("weapon_missing"), null);
g_Assert.equal(g_CSGOEntities.GetEntityItemDefinitionIndex(g_WeaponEntity), 7);
g_Assert.equal(g_CSGOEntities.SetEntityItemDefinitionIndex(g_WeaponEntity, 9), true);
g_Assert.equal(g_CSGOEntities.GetEntityItemDefinitionIndex(g_WeaponEntity), 9);
g_Assert.equal(g_WeaponEntity.GetEntityProperty(g_strItemDefinitionProperty), 9);

const g_CreatedEntity = g_CSGOEntities.CreateEntityByClassName("weapon_ak47", {
	DispatchSpawn: true,
	KeyValues: {
		TargetName: "sourcejs_test_ak47",
	},
});

g_Assert.equal(g_CreatedEntity.ClassName, "weapon_ak47");
g_Assert.equal(g_CreatedEntity[g_EntityStateKey].Spawned, true);
g_Assert.equal(g_CSGOEntities.SetEntityItemDefinitionIndex(g_CreatedEntity, 7), true);
g_Assert.equal(g_CSGOEntities.GetEntityItemDefinitionIndex(g_CreatedEntity), 7);
g_Assert.equal(g_CreatedEntity.RemoveEntity(), true);
g_Assert.equal(g_CSGOEntities.GetEntityByIndex(g_CreatedEntity.Index), null);

g_Assert.throws(() => g_CSGOEntities.GetEntityByIndex("31"), /Int32/);
g_Assert.throws(() => g_CSGOEntities.GetEntitiesByClassName(""), /non-empty/);
g_Assert.throws(() => g_CSGOEntities.FindEntityByClassName(1), /non-empty/);
g_Assert.throws(() => g_CSGOEntities.CreateEntityByClassName("", {}), /non-empty/);
g_Assert.throws(() => g_CSGOEntities.CreateEntityByClassName("weapon_ak47", { DispatchSpawn: 1 }), /boolean/);
g_Assert.throws(() => g_CSGOEntities.GetEntityItemDefinitionIndex(g_CSGOEntities.GetEntityByIndex(0)), /missing property/);
g_Assert.throws(() => g_CSGOEntities.GetEntityItemDefinitionIndex({}), /live entity/);
g_Assert.throws(() => g_CSGOEntities.SetEntityItemDefinitionIndex(g_WeaponEntity, 1.5), /Int32/);

const g_ReducedFixture = MakeNativeModule({ WithCreate: false });
const g_ReducedCSGOEntities = LoadPackage(g_ReducedFixture.NativeModule);

g_Assert.equal(typeof g_ReducedCSGOEntities.CreateEntityByClassName, "undefined");
g_Assert.deepEqual(Object.keys(g_ReducedCSGOEntities).sort(), g_vecMaximumExportNames.filter((strName) => strName !== "CreateEntityByClassName").sort());

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
const g_setExercisedExports = new Set();
const g_DocumentedModule = TrackModule(g_MaximumFixture.NativeModule, g_setExercisedExports);

g_Assert.equal(g_vecDocumentationBlocks.length, 7);
g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|generate_api_docs/i);
g_Assert.doesNotMatch(g_strDocumentation, /const result = |console\.log\(result\)|console\.log\(instance\)/);

for (const strRelatedPath of [
	"entities-engines.md",
	"entities-entity.md",
	"entities-props.md",
	"entities-factories.md",
	"weapons-engines-csgo.md",
	"weapons-data.md",
]) {
	g_Assert.ok(g_FileSystem.existsSync(g_Path.join(g_strRepositoryRoot, "docs", "api", strRelatedPath)), `Missing related documentation: ${strRelatedPath}`);
}

for (const strBlock of g_vecDocumentationBlocks) {
	ExecuteDocumentationBlock(strBlock, g_DocumentedModule);
}

VerifyEntityIdentityDocumentation(g_vecDocumentationBlocks);
VerifyDocumentationStorageProfiles(g_vecDocumentationBlocks);

g_Assert.deepEqual([...g_setExercisedExports].sort(), [
	"BRANCH",
	"CreateEntityByClassName",
	"FindEntityByClassName",
	"GetEntitiesByClassName",
	"GetEntityByIndex",
	"GetEntityItemDefinitionIndex",
	"ITEM_DEFINITION_PROPERTY",
	"SetEntityItemDefinitionIndex",
].sort());

const g_strNativeBindings = g_FileSystem.readFileSync(g_strNativeBindingsPath, "utf8");
const g_nCSGOInstallerStart = g_strNativeBindings.indexOf("v8::Local<v8::Object> const LocalCSGOEntityEngineModule");
const g_nCSGOInstallerEnd = g_strNativeBindings.indexOf("v8::Local<v8::Object> const LocalEntityHelpersModule", g_nCSGOInstallerStart);

g_Assert.ok((g_nCSGOInstallerStart >= 0) && (g_nCSGOInstallerEnd > g_nCSGOInstallerStart), "CSGO entity installer must have ordered bounds");

const g_strCSGOInstaller = g_strNativeBindings.slice(g_nCSGOInstallerStart, g_nCSGOInstallerEnd);

g_Assert.match(g_strCSGOInstaller, /SetString\(pIsolate, LocalContext, LocalCSGOEntityEngineModule, "ITEM_DEFINITION_PROPERTY"/);
g_Assert.doesNotMatch(g_strCSGOInstaller, /"itemDefinitionProperty"/);
g_Assert.match(g_strCSGOInstaller, /#if defined\(SOURCEJS_HAS_SERVER_TOOLS\)[\s\S]*"CreateEntityByClassName"/);
g_Assert.match(g_strCSGOInstaller, /"GetEntityItemDefinitionIndex"/);
g_Assert.match(g_strCSGOInstaller, /"SetEntityItemDefinitionIndex"/);
g_Assert.match(g_strNativeBindings, /#if defined\(ENGINE_CSGO\) && defined\(SOURCEJS_HAS_SENDPROPS\)/);

const g_strNormalizedNativeBindings = g_strNativeBindings.replace(/\r\n/g, "\n");
VerifyNativeItemDefinitionContexts(g_strNormalizedNativeBindings);

const g_vecNativeContextMutations = [
	['entities/engines/csgo/csgo.GetEntityItemDefinitionIndex(Entity)', 'weapons/engines/csgo.GetWeaponItemDefinitionIndex(Entity)'],
	['entities/engines/csgo/csgo.SetEntityItemDefinitionIndex(Entity, nValue)', 'weapons/engines/csgo.SetWeaponItemDefinitionIndex(Entity, nValue)'],
	['LocalCSGOEntityEngineModule, "GetEntityItemDefinitionIndex", GetCSGOEntityItemDefinitionIndexCallback', 'LocalCSGOEntityEngineModule, "GetEntityItemDefinitionIndex", GetCSGOItemDefinitionIndexCallback'],
	['LocalCSGOEntityEngineModule, "SetEntityItemDefinitionIndex", SetCSGOEntityItemDefinitionIndexCallback', 'LocalCSGOEntityEngineModule, "SetEntityItemDefinitionIndex", SetCSGOItemDefinitionIndexCallback'],
	['#if defined(SOURCEJS_HAS_SENDPROPS)\n\t\tvoid GetCSGOEntityItemDefinitionIndexCallback', '#if defined(ENGINE_CSGO)\n\t\tvoid GetCSGOEntityItemDefinitionIndexCallback'],
	['LocalWeaponsEnginesCSGOModule, "GetWeaponItemDefinitionIndex", GetCSGOItemDefinitionIndexCallback', 'LocalWeaponsEnginesCSGOModule, "GetWeaponItemDefinitionIndex", GetCSGOEntityItemDefinitionIndexCallback'],
	['LocalWeaponsEnginesCSGOModule, "SetWeaponItemDefinitionIndex", SetCSGOItemDefinitionIndexCallback', 'LocalWeaponsEnginesCSGOModule, "SetWeaponItemDefinitionIndex", SetCSGOEntityItemDefinitionIndexCallback'],
];

for (const vecMutation of g_vecNativeContextMutations) {
	const strMutatedBindings = g_strNormalizedNativeBindings.replace(vecMutation[0], vecMutation[1]);
	g_Assert.ok(strMutatedBindings !== g_strNormalizedNativeBindings, "Apply each native context mutation before verifying rejection.");
	g_Assert.throws(() => VerifyNativeItemDefinitionContexts(strMutatedBindings), g_Assert.AssertionError, "Native context mutations must reach a source-contract assertion.");
}

delete require.cache[g_strPackagePath];
delete globalThis.sourcejs;

g_Assert.throws(() => require(g_strPackagePath), /SourceJS native runtime is not installed/);

console.log("[smoke] entities/engines/csgo/csgo API and documentation contracts passed");

g_Module._load = g_OriginalModuleLoad;
