"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackagePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "entities", "engines.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "entities-engines.md");
const g_strNativeBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_vecExpectedMaximumExports = [
	"BRANCH",
	"CreateEntityByClassName",
	"FindEntityByClassName",
	"GetEntitiesByClassName",
	"GetEntityByIndex",
];
const g_vecExpectedReducedExports = [
	"BRANCH",
	"FindEntityByClassName",
	"GetEntitiesByClassName",
	"GetEntityByIndex",
];

const g_unEntityBaseAddress = 0x2000n;
const g_unEntityAddressStride = 0x100n;
const g_unFixtureHandleBase = 0x20000;
const g_unFixtureNetworkSerialBase = 200;
const g_nMinimumFixtureInteger = -0x80000000;
const g_nMaximumFixtureInteger = 0x7FFFFFFF;

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js"));
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

const g_mapEntityStates = new Map();
const g_vecCreationCalls = [];
let g_unNextEntityIndex = 3;

function RequireClassName(strEntityClassName, strOperationName) {
	if ((typeof strEntityClassName !== "string") || (strEntityClassName.length === 0)) {
		throw new TypeError(`${strOperationName} expects a non-empty entity class name.`);
	}

	return strEntityClassName;
}

// Controlled Number inputs and synthetic handles do not model SDK storage widths or native handle packing.
function RequireFixtureInteger(nValue, strErrorMessage) {
	if (!Number.isInteger(nValue) || (nValue < g_nMinimumFixtureInteger) || (nValue > g_nMaximumFixtureInteger)) {
		throw new TypeError(strErrorMessage);
	}

	return (nValue === 0) ? 0 : nValue;
}

function InstallEntity(unEntityIndex, strEntityClassName, KeyValues = {}) {
	const State = {
		ClassName: strEntityClassName,
		Free: false,
		HandleValue: g_unFixtureHandleBase + unEntityIndex,
		Index: unEntityIndex,
		Inputs: [],
		KeyValues: { ...KeyValues },
		NetworkSerialNumber: g_unFixtureNetworkSerialBase + unEntityIndex,
		Removed: false,
		Slain: false,
		Spawned: false,
		StateFlags: 0x00,
	};

	g_mapEntityStates.set(unEntityIndex, State);

	return State;
}

function MakeEntity(State) {
	if (!State || State.Free || State.Removed) {
		return null;
	}

	const Entity = {
		CallEntityInput(strInputName, ValueEntityInput = null, flDelay = 0) {
			if ((typeof strInputName !== "string") || (strInputName.length === 0)) {
				throw new TypeError("Entity.CallEntityInput(strInputName, ValueEntityInput?, flDelay?) expects a non-empty input name.");
			}

			State.Inputs.push({ Delay: flDelay, Name: strInputName, Value: ValueEntityInput });

			return true;
		},
		RemoveEntity() {
			State.Removed = true;

			return true;
		},
		SlayEntity() {
			State.Slain = true;

			return true;
		},
	};
	Object.defineProperties(Entity, {
		BaseEntity: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? null : Entity,
		},
		BaseHandle: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? null : { Value: State.HandleValue },
		},
		ClassName: {
			enumerable: true,
			get: () => State.Removed ? "" : State.ClassName,
		},
		Edict: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? null : Entity,
		},
		Free: {
			enumerable: true,
			get: () => State.Free,
			set: (bValue) => {
				if (typeof bValue !== "boolean") {
					throw new TypeError("Entity.Free must be a boolean.");
				}

				State.Free = bValue;
			},
		},
		HandleValue: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? -1 : State.HandleValue,
		},
		Index: {
			enumerable: true,
			get: () => State.Index,
		},
		NetworkSerialNumber: {
			enumerable: true,
			get: () => State.NetworkSerialNumber,
			set: (nValue) => {
				State.NetworkSerialNumber = RequireFixtureInteger(nValue, "Entity.NetworkSerialNumber requires an integer.");
			},
		},
		Address: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? 0n : (g_unEntityBaseAddress + BigInt(State.Index) * g_unEntityAddressStride),
		},
		StateFlags: {
			enumerable: true,
			get: () => State.StateFlags,
			set: (nValue) => {
				State.StateFlags = RequireFixtureInteger(nValue, "Entity.StateFlags requires an integer.");
			},
		},
		Valid: {
			enumerable: true,
			get: () => !State.Free && !State.Removed,
		},
	});

	return Entity;
}

function GetCurrentStates() {
	return Array.from(g_mapEntityStates.values()).filter((State) => !State.Free && !State.Removed).sort((LeftState, RightState) => LeftState.Index - RightState.Index);
}

function GetEntityByIndex(nEntityIndex) {
	return MakeEntity(g_mapEntityStates.get(RequireFixtureInteger(nEntityIndex, "GetEntityByIndex(nEntityIndex) expects an integer entity index.")));
}

function GetEntitiesByClassName(strEntityClassName) {
	const strRequiredClassName = RequireClassName(strEntityClassName, "GetEntitiesByClassName(strEntityClassName)");

	return GetCurrentStates().filter((State) => State.ClassName === strRequiredClassName).map(MakeEntity);
}

function FindEntityByClassName(strEntityClassName) {
	const strRequiredClassName = RequireClassName(strEntityClassName, "FindEntityByClassName(strEntityClassName)");
	const State = GetCurrentStates().find((CandidateState) => CandidateState.ClassName === strRequiredClassName);

	return MakeEntity(State);
}

function CreateEntityByClassName(strEntityClassName, Options = undefined) {
	const strRequiredClassName = RequireClassName(strEntityClassName, "CreateEntityByClassName(strEntityClassName, Options?)");
	if ((Options !== undefined) && (!Options || (typeof Options !== "object") || Array.isArray(Options))) {
		throw new TypeError("CreateEntityByClassName(strEntityClassName, Options?) expects Options to be an object.");
	}

	let bDispatchSpawn = false;
	let KeyValues = {};

	if (Options !== undefined) {
		if (Object.hasOwn(Options, "DispatchSpawn") || Object.hasOwn(Options, "KeyValues")) {
			if (Object.hasOwn(Options, "DispatchSpawn") && (typeof Options.DispatchSpawn !== "boolean")) {
				throw new TypeError("CreateEntityByClassName DispatchSpawn must be a boolean.");
			}

			bDispatchSpawn = Options.DispatchSpawn ?? false;
			KeyValues = Options.KeyValues ?? {};

		} else {
			KeyValues = Options;
		}
	}

	if (!KeyValues || (typeof KeyValues !== "object") || Array.isArray(KeyValues)) {
		throw new TypeError("CreateEntityByClassName KeyValues must be an object.");
	}

	const State = InstallEntity(g_unNextEntityIndex, strRequiredClassName, KeyValues);
	g_unNextEntityIndex += 1;
	State.Spawned = bDispatchSpawn;
	g_vecCreationCalls.push({ ClassName: strRequiredClassName, DispatchSpawn: bDispatchSpawn, KeyValues: { ...KeyValues }, State });

	return MakeEntity(State);
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return Array.from(strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function ExtractSourceBlock(strSource, strStartMarker, strEndMarker) {
	const nStartIndex = strSource.indexOf(strStartMarker);
	const nEndIndex = strSource.indexOf(strEndMarker, nStartIndex + strStartMarker.length);

	g_Assert.notEqual(nStartIndex, -1, `Missing native start marker: ${strStartMarker}`);
	g_Assert.notEqual(nEndIndex, -1, `Missing native end marker: ${strEndMarker}`);

	return strSource.slice(nStartIndex, nEndIndex);
}

function TrackModule(ModuleExports, setExercisedExports) {
	const TrackedExports = {};
	for (const [strName, Value] of Object.entries(ModuleExports)) {
		Object.defineProperty(TrackedExports, strName, {
			enumerable: true,
			get() {
				setExercisedExports.add(strName);

				return Value;
			},
		});
	}

	return TrackedExports;
}

function ExecuteDocumentationBlock(strSource, unBlockIndex, Modules) {
	const Script = new g_VM.Script(`(function (require) {\n${strSource}\n})`, { filename: `entities-engines.md:block-${unBlockIndex + 1}` });
	const Callback = Script.runInNewContext({});
	const vecRecords = [];
	const DocumentationRequire = (strModuleName) => {
		if (strModuleName === "loggers") {
			return {
				LogInfo(strFormat, Result) {
					g_Assert.match(strFormat, /^[A-Z][A-Za-z]+ Result=%j$/);
					g_Assert.equal(typeof Result, "object");
					g_Assert.notEqual(Result, null);
					vecRecords.push({ Format: strFormat, Result: JSON.parse(JSON.stringify(Result)) });
				},
			};
		}

		if (!Object.hasOwn(Modules, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		return Modules[strModuleName];
	};

	g_Assert.doesNotMatch(strSource, /console\./);
	Callback(DocumentationRequire);

	return vecRecords;
}

function VerifyEntityIdentityDocumentation(vecBlocks) {
	const strIdentityBlock = vecBlocks.find((strBlock) => strBlock.includes("The prop_physics identity changed during resolution."));
	g_Assert.equal(typeof strIdentityBlock, "string");

	const unEntityIndex = 2;
	const nInitialHandleValue = 0x20002;
	const nReplacementHandleValue = 0x40002;
	let nLiveHandleValue = nInitialHandleValue;
	const FirstPhysicsProp = {
		Index: unEntityIndex,
		get HandleValue() {
			return nLiveHandleValue;
		},
	};
	const ReusedIndexModule = {
		BRANCH: "l4d2",
		GetEntitiesByClassName: () => [FirstPhysicsProp],
		FindEntityByClassName: () => FirstPhysicsProp,
		GetEntityByIndex() {
			nLiveHandleValue = nReplacementHandleValue;

			return { Index: unEntityIndex, HandleValue: nLiveHandleValue };
		},
	};

	// A second live getter can already observe the reused index, unlike the earlier snapshot.
	g_Assert.throws(() => ExecuteDocumentationBlock(strIdentityBlock, 0, { "entities/engines": ReusedIndexModule }), /identity changed during resolution/);

	let bResolvedWithoutHandle = false;
	const MissingHandleModule = {
		...ReusedIndexModule,
		FindEntityByClassName: () => ({ Index: unEntityIndex, HandleValue: -1 }),
		GetEntityByIndex() {
			bResolvedWithoutHandle = true;

			return { Index: unEntityIndex, HandleValue: -1 };
		},
	};
	g_Assert.throws(() => ExecuteDocumentationBlock(strIdentityBlock, 0, { "entities/engines": MissingHandleModule }), /no valid packed handle/);
	g_Assert.equal(bResolvedWithoutHandle, false);

	const SignedHandleModule = {
		...ReusedIndexModule,
		FindEntityByClassName: () => ({ Index: unEntityIndex, HandleValue: -2 }),
		GetEntityByIndex() {
			return { Index: unEntityIndex, HandleValue: -2 };
		},
	};
	const vecRecords = ExecuteDocumentationBlock(strIdentityBlock, 0, { "entities/engines": SignedHandleModule });
	g_Assert.equal(vecRecords.length, 1);
	g_Assert.equal(vecRecords[0].Result.FirstEntityIndex, unEntityIndex);
	g_Assert.equal(vecRecords[0].Result.ResolvedEntityIndex, unEntityIndex);
}

function VerifyEngineDocumentationContracts(vecBlocks, NativeModule) {
	const strWorldBlock = vecBlocks.find((strBlock) => strBlock.includes("const g_WorldEntity ="));
	const strCreationBlock = vecBlocks.find((strBlock) => strBlock.includes("function CreateUseAndRemoveEntity()"));
	g_Assert.equal(typeof strWorldBlock, "string");
	g_Assert.equal(typeof strCreationBlock, "string");

	const World = GetEntityByIndex(0);
	g_Assert(World);

	for (const unAddress of [0n, 0xFEDCBA9876543210n, 0xFFFFFFFFFFFFFFFFn]) {
		const WorldView = new Proxy(World, {
			get(Target, Property, Receiver) {
				return (Property === "Address") ? unAddress : Reflect.get(Target, Property, Receiver);
			},
		});
		const Module = {
			GetEntityByIndex(nEntityIndex) {
				g_Assert.equal(nEntityIndex, 0);

				return WorldView;
			},
		};
		const vecRecords = ExecuteDocumentationBlock(strWorldBlock, 2, { "entities/engines": Module });
		g_Assert.equal(vecRecords.length, 1);
		g_Assert.equal(vecRecords[0].Format, "ReadEngineEntity Result=%j");
		g_Assert.equal(vecRecords[0].Result.Address, "0x" + unAddress.toString(16).toUpperCase());
		g_Assert.equal(vecRecords[0].Result.EntityIndex, 0);
		g_Assert.equal(vecRecords[0].Result.ClassName, World.ClassName);
	}

	const ReducedModule = { ...NativeModule };
	delete ReducedModule.CreateEntityByClassName;
	const unCreationCountBeforeMissingCapability = g_vecCreationCalls.length;
	g_Assert.throws(() => ExecuteDocumentationBlock(strCreationBlock, 3, { "entities/engines": ReducedModule }), /Entity creation is unavailable/);
	g_Assert.equal(g_vecCreationCalls.length, unCreationCountBeforeMissingCapability);

	for (const strFailureMode of ["MISSINGINPUT", "REJECTEDINPUT", "THROWNINPUT"]) {
		const InputError = new Error("The native input failed.");
		const Module = {
			...NativeModule,
			CreateEntityByClassName(...vecArguments) {
				const Entity = CreateEntityByClassName(...vecArguments);
				if (strFailureMode === "MISSINGINPUT") {
					delete Entity.CallEntityInput;
				} else {
					Entity.CallEntityInput = () => {
						if (strFailureMode === "THROWNINPUT") {
							throw InputError;
						}

						return false;
					};
				}

				return Entity;
			},
		};
		const unLiveCount = GetCurrentStates().length;
		const unCreationCount = g_vecCreationCalls.length;
		const ExpectedError = (strFailureMode === "THROWNINPUT") ? (ErrorValue) => ErrorValue === InputError : /does not expose CBaseEntity::AcceptInput|rejected FireUser1/;
		g_Assert.throws(() => ExecuteDocumentationBlock(strCreationBlock, 3, { "entities/engines": Module }), ExpectedError);
		g_Assert.equal(g_vecCreationCalls.length, unCreationCount + 1);
		g_Assert.equal(g_vecCreationCalls.at(-1).State.Removed, true);
		g_Assert.equal(GetCurrentStates().length, unLiveCount);
	}
}

function VerifyEngineEntityFixture() {
	const unFixtureIndex = 64;
	const State = InstallEntity(unFixtureIndex, "FixtureEntity");
	const Entity = MakeEntity(State);
	try {
		g_Assert.equal(Entity.Address, 0x6000n, "engine fixture addresses must be exact BigInt values");
		g_Assert.equal(Entity.HandleValue, 0x20040, "engine fixture handles remain 32-bit Numbers");
		g_Assert.equal(Entity.BaseHandle.Value, 0x20040);

		for (const strPropertyName of ["StateFlags", "NetworkSerialNumber"]) {
			for (const nValue of [-1, 0, 1]) {
				Entity[strPropertyName] = nValue;
				g_Assert.equal(Entity[strPropertyName], nValue, "engine fixture live fields accept signed integers");
			}

			for (const InvalidValue of [undefined, null, true, "1", 1n, NaN, Infinity, 0.5, g_nMinimumFixtureInteger - 1, g_nMaximumFixtureInteger + 1]) {
				const nPreviousValue = Entity[strPropertyName];
				g_Assert.throws(() => {
					Entity[strPropertyName] = InvalidValue;
				}, TypeError, "engine fixture live fields reject non-Int32 Number inputs");
				g_Assert.equal(Entity[strPropertyName], nPreviousValue, "invalid engine fixture writes preserve prior state");
			}
		}

		Entity.Free = true;
		g_Assert.equal(Entity.Address, 0n, "invalid engine fixture address must be BigInt zero");
		g_Assert.equal(Entity.HandleValue, -1, "invalid engine fixture handle must be signed -1");
		for (const strPropertyName of ["BaseEntity", "BaseHandle", "Edict"]) {
			g_Assert.equal(Entity[strPropertyName], null, "invalid engine fixture views must be null");
		}

		Entity.Free = false;
		g_Assert.equal(Entity.Address, 0x6000n, "reattached engine fixture address must be exact");
		g_Assert.equal(Entity.RemoveEntity(), true);
		g_Assert.equal(Entity.Address, 0n, "removed engine fixture address must be BigInt zero");
		g_Assert.equal(Entity.HandleValue, -1, "removed engine fixture handle must be signed -1");
		for (const strPropertyName of ["BaseEntity", "BaseHandle", "Edict"]) {
			g_Assert.equal(Entity[strPropertyName], null, "removed engine fixture views must be null");
		}
	} finally {
		g_mapEntityStates.delete(unFixtureIndex);
	}

	g_Assert.equal(g_mapEntityStates.has(unFixtureIndex), false, "engine fixture self-check must restore its state");
}

VerifyEngineEntityFixture();

InstallEntity(0, "worldspawn");
InstallEntity(1, "CBasePlayer");
InstallEntity(2, "prop_physics");

const g_MaximumNativeModule = {
	BRANCH: "l4d2",
	GetEntitiesByClassName,
	CreateEntityByClassName,
	GetEntityByIndex,
	FindEntityByClassName,
};

const g_ReducedNativeModule = {
	BRANCH: "episode1",
	GetEntitiesByClassName,
	GetEntityByIndex,
	FindEntityByClassName,
};

const g_PreviousSourceJS = globalThis.sourcejs;

globalThis.sourcejs = { "entities/engines": g_MaximumNativeModule };
delete require.cache[g_strPackagePath];

const g_EntitiesEngine = require(g_strPackagePath);
g_Assert.strictEqual(g_EntitiesEngine, g_MaximumNativeModule);
g_Assert.deepEqual(Object.keys(g_EntitiesEngine).sort(), g_vecExpectedMaximumExports.slice().sort());
g_Assert.equal(g_EntitiesEngine.BRANCH, "l4d2");
g_Assert.equal(g_EntitiesEngine.GetEntitiesByClassName("prop_physics").length, 1);
g_Assert.equal(g_EntitiesEngine.GetEntitiesByClassName("info_target").length, 0);
g_Assert.equal(g_EntitiesEngine.FindEntityByClassName("prop_physics").Index, 2);
g_Assert.equal(g_EntitiesEngine.FindEntityByClassName("info_target"), null);
g_Assert.equal(g_EntitiesEngine.GetEntityByIndex(0).ClassName, "worldspawn");
g_Assert.equal(g_EntitiesEngine.GetEntityByIndex(2047), null);
g_Assert.throws(() => g_EntitiesEngine.GetEntityByIndex("0"), /integer entity index/);
g_Assert.throws(() => g_EntitiesEngine.GetEntitiesByClassName(), /non-empty entity class name/);
g_Assert.throws(() => g_EntitiesEngine.GetEntitiesByClassName(7), /non-empty entity class name/);
g_Assert.throws(() => g_EntitiesEngine.FindEntityByClassName(""), /non-empty entity class name/);
g_Assert.throws(() => g_EntitiesEngine.FindEntityByClassName(false), /non-empty entity class name/);

const g_CreatedMarker = g_EntitiesEngine.CreateEntityByClassName("info_target", {
	DispatchSpawn: true,
	KeyValues: {
		origin: { X: 10, Y: 20, Z: 30 },
		targetname: "sourcejs_native_marker",
	},
});

g_Assert.equal(g_CreatedMarker.ClassName, "info_target");
g_Assert.equal(g_CreatedMarker.Address, 0x2300n, "engine creation must expose a BigInt address");
g_Assert.equal(g_CreatedMarker.Valid, true);
g_Assert.equal(g_vecCreationCalls.at(-1).DispatchSpawn, true);
g_Assert.deepEqual(g_vecCreationCalls.at(-1).KeyValues.origin, { X: 10, Y: 20, Z: 30 });
g_Assert.equal(g_EntitiesEngine.FindEntityByClassName("info_target").Index, g_CreatedMarker.Index);
g_Assert.equal(g_CreatedMarker.CallEntityInput("FireUser1"), true);
g_Assert.equal(g_vecCreationCalls.at(-1).State.Inputs.length, 1);
g_Assert.equal(g_CreatedMarker.RemoveEntity(), true);
g_Assert.equal(g_CreatedMarker.Valid, false);
g_Assert.equal(g_CreatedMarker.Address, 0n, "removed engine creation must detach its address");
g_Assert.equal(g_EntitiesEngine.FindEntityByClassName("info_target"), null);
g_Assert.throws(() => g_EntitiesEngine.CreateEntityByClassName(42), /non-empty entity class name/);
g_Assert.throws(() => g_EntitiesEngine.CreateEntityByClassName("info_target", false), /Options to be an object/);

const g_DirectKeyValueEntity = g_EntitiesEngine.CreateEntityByClassName("info_target", { origin: { X: 1, Y: 2, Z: 3 }, targetname: "sourcejs_direct_keyvalues" });
g_Assert.equal(g_vecCreationCalls.at(-1).DispatchSpawn, false);
g_Assert.equal(g_vecCreationCalls.at(-1).KeyValues.targetname, "sourcejs_direct_keyvalues");
g_Assert.equal(g_DirectKeyValueEntity.RemoveEntity(), true, "direct key-value entity cleanup must succeed");

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
const g_setExercisedExports = new Set();
const g_DocumentedModule = TrackModule(g_EntitiesEngine, g_setExercisedExports);

g_Assert.equal(g_vecDocumentationBlocks.length, 4);
g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|generate_api_docs/i);
g_Assert.doesNotMatch(g_strDocumentation, /const result = (?:GetEntitiesByClassName|FindEntityByClassName)\(\)|console\.log\(result\)|console\.log\(instance\)/);

for (const strRelatedPath of [
	"entities.md",
	"entities-entity.md",
	"entities-factories.md",
	"entities-dictionary.md",
	"entities-engines-csgo-csgo.md",
]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\(${strRelatedPath.replace(".", "\\.")}\\)`));
}

for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
	const vecRecords = ExecuteDocumentationBlock(strSource, unBlockIndex, { "entities/engines": g_DocumentedModule });
	const vecExpectedFormats = [
		[],
		["InspectEngineEntities Result=%j"],
		["ReadEngineEntity Result=%j"],
		["CreateEngineMarker Result=%j"],
	][unBlockIndex];
	g_Assert.deepEqual(vecRecords.map((Record) => Record.Format), vecExpectedFormats);

	if (unBlockIndex === 1) {
		g_Assert.equal(vecRecords[0].Result.SDKBranch, g_EntitiesEngine.BRANCH);
		g_Assert.equal(vecRecords[0].Result.FirstEntityIndex, vecRecords[0].Result.ResolvedEntityIndex);
		g_Assert(vecRecords[0].Result.PhysicsPropCount > 0);
	}

	if (unBlockIndex === 2) {
		g_Assert.equal(typeof vecRecords[0].Result.Valid, "boolean");
		g_Assert.match(vecRecords[0].Result.Address, /^0x[0-9A-F]+$/);
		g_Assert.equal(vecRecords[0].Result.EntityIndex, 0);
	}

	if (unBlockIndex === 3) {
		g_Assert.equal(vecRecords[0].Result.ClassName, "info_target");
		g_Assert.equal(vecRecords[0].Result.EntityIndex, g_vecCreationCalls.at(-1).State.Index);
		g_Assert.equal(g_vecCreationCalls.at(-1).State.Removed, true);
	}
}

VerifyEntityIdentityDocumentation(g_vecDocumentationBlocks);
VerifyEngineDocumentationContracts(g_vecDocumentationBlocks, g_EntitiesEngine);

for (const strExportName of g_vecExpectedMaximumExports) {
	g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not reference entities/engines.${strExportName}.`);
}

g_Assert.equal(GetCurrentStates().length, 3);

const g_strNativeBindings = g_FileSystem.readFileSync(g_strNativeBindingsPath, "utf8");
const g_strByClassNameBinding = ExtractSourceBlock(g_strNativeBindings, "void GetEntitiesByClassNameCallback", "void FindEntityByClassNameCallback");
const g_strFindBinding = ExtractSourceBlock(g_strNativeBindings, "void FindEntityByClassNameCallback", "bool CollectEntityIndices");
const g_strCreateBinding = ExtractSourceBlock(g_strNativeBindings, "void CreateEntityByClassNameCallback", "void CreateAndSpawnEntityByClassNameCallback");
const g_strCreateAndSpawnBinding = ExtractSourceBlock(g_strNativeBindings, "void CreateAndSpawnEntityByClassNameCallback", "void DispatchEntitySpawnCallback");

for (const strBinding of [g_strByClassNameBinding, g_strFindBinding, g_strCreateBinding, g_strCreateAndSpawnBinding]) {
	g_Assert.match(strBinding, /CallbackInformation\[kClassNameArgumentIndex\]->IsString\(\)/);
	g_Assert.doesNotMatch(strBinding, /CallbackInformation\.Length\(\) > 0 \? ValueToString/);
}

globalThis.sourcejs = { "entities/engines": g_ReducedNativeModule };
delete require.cache[g_strPackagePath];

const g_ReducedEntitiesEngine = require(g_strPackagePath);
g_Assert.strictEqual(g_ReducedEntitiesEngine, g_ReducedNativeModule);
g_Assert.deepEqual(Object.keys(g_ReducedEntitiesEngine).sort(), g_vecExpectedReducedExports.slice().sort());
g_Assert.equal(g_ReducedEntitiesEngine.CreateEntityByClassName, undefined);
g_Assert.throws(() => g_ReducedEntitiesEngine.CreateEntityByClassName("info_target"), /is not a function/);

delete globalThis.sourcejs["entities/engines"];
delete require.cache[g_strPackagePath];
g_Assert.throws(() => require(g_strPackagePath), /SourceJS module is not installed: entities\/engines/);

delete require.cache[g_strPackagePath];

if (g_PreviousSourceJS === undefined) {
	delete globalThis.sourcejs;
} else {
	globalThis.sourcejs = g_PreviousSourceJS;
}

console.log("[  OK  ] entities/engines API and documentation contracts passed");

g_Module._load = g_OriginalModuleLoad;
