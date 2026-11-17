#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons-engines-csgo.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strCSGOPath = g_Path.join(g_strPackageRootPath, "weapons", "engines", "csgo.js");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");

const g_nMaximumSignedInteger = 2147483647;
const g_nMinimumSignedInteger = -2147483648;
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_vecForbiddenCSGOExports = [
	"itemDefinitionProperty",
	"primaryAmmoProperty",
	"CSGOWeapon",
	"Weapon",
	"byIndex",
	"available",
	"moduleName",
	"runtime",
	"default",
];
const g_vecRequiredCSGOBindingTokens = [
	"\"weapons/engines/csgo\"",
	"\"ITEM_DEFINITION_PROPERTY\"",
	"\"CLIP_PROPERTY\"",
	"\"PRIMARY_AMMO_PROPERTY\"",
	"\"GetWeaponItemDefinitionIndex\"",
	"\"SetWeaponItemDefinitionIndex\"",
	"\"GetWeaponAmmo\"",
	"\"SetWeaponAmmo\"",
];

const g_WeaponState = { Ammo: 30, ItemDefinitionIndex: 7 };
const g_strInitialWeaponState = JSON.stringify(g_WeaponState);

let g_unNativeOperationCount = 0;
let g_unReflectionOperationCount = 0;

function GetWeaponIndex(WeaponReference) {
	let IndexValue = WeaponReference;
	if ((WeaponReference !== null) && (typeof WeaponReference === "object")) {
		IndexValue = WeaponReference.Index;
	}

	if (IndexValue !== 11) {
		throw new Error(`CS:GO weapon not found: ${String(IndexValue)}`);
	}

	return IndexValue;
}

function RequireSignedInteger(nIntegerValue, strValueName) {
	if (typeof nIntegerValue === "bigint") {
		if ((nIntegerValue < BigInt(g_nMinimumSignedInteger)) || (nIntegerValue > BigInt(g_nMaximumSignedInteger))) {
			throw new TypeError(`${strValueName} must be an in-range signed integer`);
		}

		return Number(nIntegerValue);
	}

	if (!Number.isInteger(nIntegerValue) || (nIntegerValue < g_nMinimumSignedInteger) || (nIntegerValue > g_nMaximumSignedInteger)) {
		throw new TypeError(`${strValueName} must be an in-range signed integer`);
	}

	return nIntegerValue;
}

const g_NativeCSGOWeapons = {
	CLIP_PROPERTY: "m_iClip1",
	ITEM_DEFINITION_PROPERTY: "m_AttributeManager.m_Item.m_iItemDefinitionIndex",
	PRIMARY_AMMO_PROPERTY: "m_iPrimaryReserveAmmoCount",

	GetWeaponAmmo(WeaponReference) {
		g_unNativeOperationCount += 1;

		GetWeaponIndex(WeaponReference);

		return g_WeaponState.Ammo;
	},

	GetWeaponItemDefinitionIndex(WeaponReference) {
		g_unNativeOperationCount += 1;

		GetWeaponIndex(WeaponReference);

		return g_WeaponState.ItemDefinitionIndex;
	},

	SetWeaponAmmo(WeaponReference, nAmmoCount) {
		g_unNativeOperationCount += 1;

		GetWeaponIndex(WeaponReference);

		g_WeaponState.Ammo = RequireSignedInteger(nAmmoCount, "ammo");

		return true;
	},

	SetWeaponItemDefinitionIndex(WeaponReference, nItemDefinitionIndex) {
		g_unNativeOperationCount += 1;

		GetWeaponIndex(WeaponReference);

		g_WeaponState.ItemDefinitionIndex = RequireSignedInteger(nItemDefinitionIndex, "item definition index");

		return true;
	},
};

function RunDocumentationBlock(strDocumentationCode, unDocumentationBlockIndex, CSGOWeaponsAPI) {
	function RequireDocumentationModule(strIdentifier) {
		if (strIdentifier === "weapons/engines/csgo") {
			return CSGOWeaponsAPI;
		}

		if (strIdentifier === "entities/props") {
			return {
				GetEntitySendProperty(WeaponReference, strPropertyName) {
					g_unReflectionOperationCount += 1;
					GetWeaponIndex(WeaponReference);

					const PropertyOffsets = { [CSGOWeaponsAPI.CLIP_PROPERTY]: 0x10, [CSGOWeaponsAPI.ITEM_DEFINITION_PROPERTY]: 0x18, [CSGOWeaponsAPI.PRIMARY_AMMO_PROPERTY]: 0x20 };
					if (!Object.hasOwn(PropertyOffsets, strPropertyName)) {
						return null;
					}

					return { Offset: PropertyOffsets[strPropertyName] };
				},
			};
		}

		throw new Error(`Unexpected documentation import: ${strIdentifier}`);
	}

	const Context = g_VM.createContext({ require: RequireDocumentationModule });
	const unNativeOperationCountBefore = g_unNativeOperationCount;
	const unReflectionOperationCountBefore = g_unReflectionOperationCount;

	g_VM.runInContext(strDocumentationCode, Context, { filename: `${g_strDocumentationPath}#example-${unDocumentationBlockIndex + 1}`, timeout: g_unDocumentationTimeoutMilliseconds });

	g_Assert.equal(g_unNativeOperationCount, unNativeOperationCountBefore, `example ${unDocumentationBlockIndex + 1} avoids native work`);
	g_Assert.equal(g_unReflectionOperationCount, unReflectionOperationCountBefore, `example ${unDocumentationBlockIndex + 1} avoids reflection work`);

	return Context;
}

function VerifyTemporaryWorkflow(unBlockIndex, strWorkflowName, strGetterName, strSetterName, strStatePropertyName, Scenario) {
	const nOriginalValue = g_WeaponState[strStatePropertyName];
	const nTemporaryValue = nOriginalValue + 1;
	const vecWrites = [];
	const CSGOWeaponsAPI = Object.assign({}, g_NativeCSGOWeapons);
	CSGOWeaponsAPI[strSetterName] = function SetScenarioValue(WeaponReference, nValue) {
		GetWeaponIndex(WeaponReference);
		vecWrites.push(nValue);

		if ((vecWrites.length === 1) && Scenario.FailInitialWrite) {
			throw Scenario.WriteError;
		}

		if ((vecWrites.length === 2) && Scenario.FailRestoration) {
			throw Scenario.RestorationError;
		}

		g_WeaponState[strStatePropertyName] = RequireSignedInteger(nValue, "scenario value");

		return true;
	};

	CSGOWeaponsAPI[strGetterName] = function GetScenarioValue(WeaponReference) {
		GetWeaponIndex(WeaponReference);

		return g_WeaponState[strStatePropertyName];
	};

	const Context = RunDocumentationBlock(g_vecDocumentationCodeBlocks[unBlockIndex], unBlockIndex, CSGOWeaponsAPI);
	let bCallbackCalled = false;
	let bCaught = false;
	let CaughtError = undefined;
	let Result = undefined;
	try {
		try {
			Result = Context[strWorkflowName]({ Index: 11 }, nTemporaryValue, function RunScenarioCallback(nValue) {
				bCallbackCalled = true;
				g_Assert.equal(nValue, nTemporaryValue, "temporary callback reads the written value");

				if (Scenario.FailCallback) {
					throw Scenario.CallbackError;
				}

				return Scenario.CallbackResult;
			});
		} catch (ErrorValue) {
			bCaught = true;
			CaughtError = ErrorValue;
		}

		g_Assert.equal(bCallbackCalled, !Scenario.FailInitialWrite, "initial setter failure prevents callback execution");
		g_Assert.equal(vecWrites.length, Scenario.FailInitialWrite ? 1 : 2, "restoration is attempted exactly once only after the initial write succeeds");

		const bExpectedFailure = Scenario.FailInitialWrite || Scenario.FailRestoration || Scenario.FailCallback;
		g_Assert.equal(bCaught, bExpectedFailure, "temporary workflow reports its actual failure state");

		if (bExpectedFailure) {
			const ExpectedError = Scenario.FailInitialWrite ? Scenario.WriteError : (Scenario.FailRestoration ? Scenario.RestorationError : Scenario.CallbackError);
			g_Assert.equal(CaughtError, ExpectedError, "temporary workflow preserves the documented failure priority and identity");

		} else {
			g_Assert.equal(Result, Scenario.CallbackResult, "temporary workflow preserves callback result identity");
		}

		g_Assert.equal(g_WeaponState[strStatePropertyName], Scenario.FailRestoration ? nTemporaryValue : nOriginalValue, "restoration failure does not imply rollback success");
	} finally {
		g_WeaponState[strStatePropertyName] = nOriginalValue;
	}
}

function LoadTestAPI(Runtime) {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	const OriginalModuleLoad = LoaderDescriptor?.value;
	const mapCachedModules = new Map();
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Weapons/engines/csgo runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Weapons/engines/csgo package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Weapons/engines/csgo runtime fixture must support exact restoration.");
	g_Assert.ok(LoaderDescriptor && LoaderDescriptor.configurable && (typeof OriginalModuleLoad === "function"), "Weapons/engines/csgo loader must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed weapons/engines/csgo cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned weapons/engines/csgo fixture property must be removable: " + strKey);
	};

	let bSourceJSOwned = false;
	let bLoaderOwned = false;
	let bCacheOwned = false;
	let bFailed = false;
	let Failure = undefined;
	let Result = undefined;

	try {
		bCacheOwned = true;

		for (const strModulePath of mapCachedModules.keys()) {
			RestoreProperty(require.cache, strModulePath, undefined);
		}

		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: Runtime });
		bSourceJSOwned = true;

		Object.defineProperty(g_Module, "_load", {
			...LoaderDescriptor,
			writable: true,
			value: function Load(strRequest, ParentModule, bIsMain) {
				if (strRequest === "internal/runtime") {
					return require(g_strRuntimePath);
				}

				return OriginalModuleLoad.call(this, strRequest, ParentModule, bIsMain);
			},
		});
		bLoaderOwned = true;

		Result = require(g_strCSGOPath);
	} catch (ExceptionValue) {
		Failure = ExceptionValue;
		bFailed = true;
	} finally {
		const vecFailures = [];
		const AttemptRestoration = Restore => {
			try {
				Restore();
			} catch (ExceptionValue) {
				vecFailures.push(ExceptionValue);
			}
		};

		if (bLoaderOwned) {
			AttemptRestoration(() => RestoreProperty(g_Module, "_load", LoaderDescriptor));
		}

		if (bCacheOwned) {
			for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
				if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
					AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, undefined));
				}
			}

			for (const [strModulePath, Descriptor] of mapCachedModules) {
				AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, Descriptor));
			}
		}

		if (bSourceJSOwned) {
			AttemptRestoration(() => RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor));
		}

		if (vecFailures.length > 0) {
			if (bFailed) {
				vecFailures.unshift(Failure);
			}

			throw new AggregateError(vecFailures, "Weapons/engines/csgo fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

const g_CSGOWeaponsAPI = LoadTestAPI({ "weapons/engines/csgo": g_NativeCSGOWeapons });
g_Assert.equal(g_CSGOWeaponsAPI, g_NativeCSGOWeapons, "weapons/engines/csgo exposes the exact native object");
g_Assert.deepEqual(Object.keys(g_CSGOWeaponsAPI).sort(), [
	"CLIP_PROPERTY",
	"GetWeaponAmmo",
	"GetWeaponItemDefinitionIndex",
	"ITEM_DEFINITION_PROPERTY",
	"PRIMARY_AMMO_PROPERTY",
	"SetWeaponAmmo",
	"SetWeaponItemDefinitionIndex",
], "exact CS:GO weapon exports");
g_Assert.equal(g_CSGOWeaponsAPI.ITEM_DEFINITION_PROPERTY, "m_AttributeManager.m_Item.m_iItemDefinitionIndex", "item definition property");
g_Assert.equal(g_CSGOWeaponsAPI.CLIP_PROPERTY, "m_iClip1", "clip property");
g_Assert.equal(g_CSGOWeaponsAPI.PRIMARY_AMMO_PROPERTY, "m_iPrimaryReserveAmmoCount", "primary ammo property");

{
	const OriginalWeaponState = { ...g_WeaponState };
	try {
		g_Assert.equal(g_CSGOWeaponsAPI.GetWeaponItemDefinitionIndex(11), 7, "item definition index");
		g_Assert.equal(g_CSGOWeaponsAPI.SetWeaponItemDefinitionIndex(11, 9), true, "set item definition index");
		g_Assert.equal(g_CSGOWeaponsAPI.GetWeaponItemDefinitionIndex(11), 9, "item definition mutation");
		g_Assert.equal(g_CSGOWeaponsAPI.SetWeaponItemDefinitionIndex(11, 8n), true, "item definition setter accepts BigInt");
		g_Assert.equal(g_CSGOWeaponsAPI.GetWeaponItemDefinitionIndex(11), 8, "item definition BigInt conversion");
		g_Assert.equal(g_CSGOWeaponsAPI.SetWeaponItemDefinitionIndex(11, 7), true, "item definition restoration succeeds");
		g_Assert.equal(g_CSGOWeaponsAPI.GetWeaponAmmo(11), 30, "primary ammo");
		g_Assert.equal(g_CSGOWeaponsAPI.SetWeaponAmmo(11, 35), true, "set primary ammo");
		g_Assert.equal(g_CSGOWeaponsAPI.GetWeaponAmmo(11), 35, "primary ammo mutation");
		g_Assert.equal(g_CSGOWeaponsAPI.SetWeaponAmmo(11, 30), true, "primary ammo restoration succeeds");
		g_Assert.equal(JSON.stringify(g_WeaponState), g_strInitialWeaponState, "direct tests restore weapon state");
		g_Assert.throws(function SetFractionalAmmo() {
			g_CSGOWeaponsAPI.SetWeaponAmmo(11, 1.5);
		}, TypeError, "ammo setter requires an integer");
		g_Assert.throws(function SetStringItemDefinition() {
			g_CSGOWeaponsAPI.SetWeaponItemDefinitionIndex(11, "7");
		}, TypeError, "item setter requires an integer");
	} finally {
		Object.assign(g_WeaponState, OriginalWeaponState);
	}
}

for (const strForbiddenExport of g_vecForbiddenCSGOExports) {
	g_Assert.equal(Object.hasOwn(g_CSGOWeaponsAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
}

const g_strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_DocumentationCodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecDocumentationCodeBlocks = [];
let g_vecDocumentationCodeBlockMatch = g_DocumentationCodeBlockPattern.exec(g_strDocumentationSource);
while (g_vecDocumentationCodeBlockMatch !== null) {
	g_vecDocumentationCodeBlocks.push(g_vecDocumentationCodeBlockMatch[1]);
	g_vecDocumentationCodeBlockMatch = g_DocumentationCodeBlockPattern.exec(g_strDocumentationSource);
}

g_Assert.equal(g_vecDocumentationCodeBlocks.length, 4, "all CS:GO weapon documentation JavaScript blocks are present");

const g_vecDocumentationContexts = [];
for (let unDocumentationBlockIndex = 0; unDocumentationBlockIndex < g_vecDocumentationCodeBlocks.length; unDocumentationBlockIndex += 1) {
	const strDocumentationCode = g_vecDocumentationCodeBlocks[unDocumentationBlockIndex];
	g_vecDocumentationContexts.push(RunDocumentationBlock(strDocumentationCode, unDocumentationBlockIndex, g_CSGOWeaponsAPI));
}

const g_vecWeaponPropertyDetails = g_vecDocumentationContexts[1].InspectCSGOWeaponProperties({ Index: 11 });
const g_vecCurrentWeaponPropertyDetails = [];
for (const PropertyDetail of g_vecWeaponPropertyDetails) {
	g_vecCurrentWeaponPropertyDetails.push({ Offset: PropertyDetail.SendProperty.Offset, PropertyName: PropertyDetail.PropertyName });
}

g_Assert.deepEqual(g_vecCurrentWeaponPropertyDetails, [{ Offset: 0x10, PropertyName: g_CSGOWeaponsAPI.CLIP_PROPERTY }, { Offset: 0x18, PropertyName: g_CSGOWeaponsAPI.ITEM_DEFINITION_PROPERTY }, { Offset: 0x20, PropertyName: g_CSGOWeaponsAPI.PRIMARY_AMMO_PROPERTY }], "metadata workflow resolves every exported property path");

const g_nTemporaryItemDefinitionIndex = g_vecDocumentationContexts[2].WithTemporaryItemDefinition({ Index: 11 }, 9, function ReadTemporaryItemDefinitionIndex(nItemDefinitionIndex) {
	return nItemDefinitionIndex;
});
g_Assert.equal(g_nTemporaryItemDefinitionIndex, 9, "item-definition workflow exposes the temporary value");
g_Assert.equal(g_WeaponState.ItemDefinitionIndex, 7, "item-definition workflow restores the original value");
g_Assert.throws(function InvokeFailingItemDefinitionCallback() {
	g_vecDocumentationContexts[2].WithTemporaryItemDefinition({ Index: 11 }, 10, function ThrowItemDefinitionCallbackError() {
		throw new Error("item callback failure");
	});
}, /item callback failure/, "item-definition workflow propagates callback errors");
g_Assert.equal(g_WeaponState.ItemDefinitionIndex, 7, "item-definition workflow restores after callback errors");

const g_nTemporaryAmmoCount = g_vecDocumentationContexts[3].WithTemporaryCSGOAmmo({ Index: 11 }, 31, function ReadTemporaryAmmoCount(nAmmoCount) {
	return nAmmoCount;
});
g_Assert.equal(g_nTemporaryAmmoCount, 31, "ammo workflow exposes the temporary value");
g_Assert.equal(g_WeaponState.Ammo, 30, "ammo workflow restores the original value");
g_Assert.throws(function InvokeFailingAmmoCallback() {
	g_vecDocumentationContexts[3].WithTemporaryCSGOAmmo({ Index: 11 }, 32, function ThrowAmmoCallbackError() {
		throw new Error("ammo callback failure");
	});
}, /ammo callback failure/, "ammo workflow propagates callback errors");
g_Assert.equal(g_WeaponState.Ammo, 30, "ammo workflow restores after callback errors");
g_Assert.equal(JSON.stringify(g_WeaponState), g_strInitialWeaponState, "documentation workflows restore exact weapon state");

for (const Workflow of [
	{ BlockIndex: 2, Name: "WithTemporaryItemDefinition", Getter: "GetWeaponItemDefinitionIndex", Setter: "SetWeaponItemDefinitionIndex", State: "ItemDefinitionIndex" },
	{ BlockIndex: 3, Name: "WithTemporaryCSGOAmmo", Getter: "GetWeaponAmmo", Setter: "SetWeaponAmmo", State: "Ammo" },
]) {
	for (const ErrorValue of [new Error("temporary failure"), false, null, 0, undefined]) {
		VerifyTemporaryWorkflow(Workflow.BlockIndex, Workflow.Name, Workflow.Getter, Workflow.Setter, Workflow.State, { FailInitialWrite: true, WriteError: ErrorValue, FailRestoration: false, FailCallback: false });
		VerifyTemporaryWorkflow(Workflow.BlockIndex, Workflow.Name, Workflow.Getter, Workflow.Setter, Workflow.State, { FailInitialWrite: false, FailRestoration: false, FailCallback: true, CallbackError: ErrorValue });
		VerifyTemporaryWorkflow(Workflow.BlockIndex, Workflow.Name, Workflow.Getter, Workflow.Setter, Workflow.State, { FailInitialWrite: false, FailRestoration: true, RestorationError: ErrorValue, FailCallback: true, CallbackError: new Error("original callback failure") });
	}

	const CallbackResult = Promise.resolve("later result");
	VerifyTemporaryWorkflow(Workflow.BlockIndex, Workflow.Name, Workflow.Getter, Workflow.Setter, Workflow.State, { FailInitialWrite: false, FailRestoration: false, FailCallback: false, CallbackResult });
}

g_Assert.match(g_strDocumentationSource, /restoration are not attempted/, "documentation states the initial-write failure boundary");
g_Assert.match(g_strDocumentationSource, /restoration is attempted once/, "documentation states one restoration attempt");
g_Assert.match(g_strDocumentationSource, /cleanup error replaces any callback error or result/, "documentation states cleanup failure priority");
g_Assert.match(g_strDocumentationSource, /promise does not delay restoration/, "documentation does not imply asynchronous temporary state");
g_Assert.doesNotMatch(g_strDocumentationSource, /console\.(?:log|warn|error)/, "CS:GO weapon examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentationSource, /Generated by|Entity\(1\)|Weapon\(2\)|const api =/, "CS:GO weapon documentation is handwritten");
g_Assert.doesNotMatch(g_strDocumentationSource, /\bsnapshots?\b/i, "CS:GO weapon documentation describes live values");

for (const strExportName of Object.keys(g_CSGOWeaponsAPI)) {
	g_Assert.match(g_strDocumentationSource, new RegExp(`\\b${strExportName}\\b`), `documentation covers ${strExportName}`);
}

for (const strRelativeLink of ["weapons-engines.md", "weapons-entity.md", "entities-props.md", "globals.md"]) {
	g_Assert.equal(g_FileSystem.existsSync(g_Path.join(g_Path.dirname(g_strDocumentationPath), strRelativeLink)), true, `documentation link exists: ${strRelativeLink}`);
}

const g_strModuleBindingsSource = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
const g_strCSGOModuleMarker = "v8::Local<v8::Object> const LocalWeaponsEnginesCSGOModule = MakeModule(pIsolate);";
const g_strCSGOBranchMarker = "#if defined(ENGINE_CSGO)";
const g_nCSGOModuleIndex = g_strModuleBindingsSource.indexOf(g_strCSGOModuleMarker);
g_Assert.notEqual(g_nCSGOModuleIndex, -1, "native CS:GO module binding is present");

const g_nCSGOBindingStartIndex = g_strModuleBindingsSource.lastIndexOf(g_strCSGOBranchMarker, g_nCSGOModuleIndex);
const g_nCSGOBindingEndIndex = g_strModuleBindingsSource.indexOf("#endif", g_nCSGOModuleIndex);

g_Assert.notEqual(g_nCSGOBindingStartIndex, -1, "native CS:GO branch starts before the module");
g_Assert.notEqual(g_nCSGOBindingEndIndex, -1, "native CS:GO branch ends after the module");

const g_strCSGOBindingSource = g_strModuleBindingsSource.slice(g_nCSGOBindingStartIndex, g_nCSGOBindingEndIndex);
// Require a flat installation block; a closed or alternative branch must not satisfy this guard.
g_Assert.doesNotMatch(g_strModuleBindingsSource.slice(g_nCSGOBindingStartIndex + g_strCSGOBranchMarker.length, g_nCSGOModuleIndex), /^\s*#\s*(?:if|ifdef|ifndef|elif|else|endif)\b/m, "native CS:GO module remains inside its opening branch");
g_Assert.doesNotMatch(g_strCSGOBindingSource.slice(g_strCSGOBranchMarker.length), /^\s*#\s*(?:if|ifdef|ifndef|elif|else|endif)\b/m, "native CS:GO module stays in the direct branch without alternatives");

for (const strRequiredToken of g_vecRequiredCSGOBindingTokens) {
	g_Assert.equal(g_strCSGOBindingSource.includes(strRequiredToken), true, `native CS:GO binding contains ${strRequiredToken}`);
}

g_Assert.throws(function RequireMissingCSGOModule() {
	LoadTestAPI({});
}, /SourceJS module is not installed: weapons\/engines\/csgo/, "non-CS:GO runtime omits the module");

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntimeResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strCSGOPath)});`], { encoding: "utf8", timeout: g_unMissingRuntimeTimeoutMilliseconds, env: { ...process.env, NODE_PATH: g_strPackageRootPath } });
g_Assert.equal(g_MissingRuntimeResult.error, undefined, "missing-runtime child starts and completes without timeout");
g_Assert.equal(g_MissingRuntimeResult.signal, null, "missing-runtime child exits without a signal");
g_Assert.equal(g_MissingRuntimeResult.status, 1, "CS:GO weapons require the native runtime");
g_Assert.match(g_MissingRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_weapons_engines_csgo");
