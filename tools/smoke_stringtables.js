#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "stringtables.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strDownloadsPath = g_Path.join(g_strPackageRootPath, "stringtables", "downloads.js");
const g_strEventManagerPath = g_Path.join(g_strPackageRootPath, "events", "manager.js");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strPathsPath = g_Path.join(g_strPackageRootPath, "paths.js");
const g_strStringTablesPath = g_Path.join(g_strPackageRootPath, "stringtables.js");
const g_vecExpectedDocumentationWorkflows = [
	"CreateDownloadOwner",
	"CreateSharedDownloadController",
	"ExerciseSharedDownloadOwnership",
	"InspectAndAddString",
	"InspectStringTableContainer",
	"InspectWrappedTable",
	"TrackDownloadDirectory",
	"TrackDownloadFile",
];

const g_strGameRootPath = g_Path.join(g_strRepositoryRootPath, "game");
const g_unMaximumStringCount = 4096;
const g_unStringTableBaseAddress = 0x1000n;
const g_mapStringTableValues = new Map([
	["downloadables", ["materials/example.vmt"]],
	["soundprecache", ["ui/beep07.wav"]],
]);
const g_vecTrackedDownloadPaths = [];
const g_vecEventListeners = [];
let g_arrStringUserData = new Uint8Array([0x00, 0xFF, 0x09]);

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_mapPackageCacheDescriptors = new Map();
let g_bSourceJSOwned = false;
let g_bLoaderOwned = false;
let g_bPackageCacheOwned = false;

function RestoreFixtureProperty(Target, strKey, Descriptor) {
	if (Descriptor) {
		Object.defineProperty(Target, strKey, Descriptor);
		return;
	}

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned stringtables fixture property must be removable: " + strKey);
}

function ReleaseStringTablesFixture() {
	const vecFailures = [];
	const AttemptRestoration = (Restore) => {
		try {
			Restore();
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	};

	if (g_bLoaderOwned) {
		AttemptRestoration(() => {
			RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
			g_bLoaderOwned = false;
		});
	}

	if (g_bPackageCacheOwned) {
		const unPreviousFailureCount = vecFailures.length;
		for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
			if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
				AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, undefined));
			}
		}

		for (const [strModulePath, Descriptor] of g_mapPackageCacheDescriptors) {
			AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, Descriptor));
		}

		if (vecFailures.length === unPreviousFailureCount) {
			g_bPackageCacheOwned = false;
		}
	}

	if (g_bSourceJSOwned) {
		AttemptRestoration(() => {
			RestoreFixtureProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
			g_bSourceJSOwned = false;
		});
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Stringtables fixture restoration failed.");
	}

	process.removeListener("exit", ReleaseStringTablesFixture);
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(g_SourceJSDescriptor || Object.isExtensible(globalThis), "Stringtables runtime fixture must support installation.");
g_Assert.ok(Object.isExtensible(require.cache), "Stringtables package cache must support exact restoration.");
g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Stringtables runtime fixture must support exact restoration.");
g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_LoaderDescriptor.value === "function"), "Stringtables loader must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed stringtables cache entries must support exact restoration.");
}

// The owner covers the later fixture setup and synchronous assertion failures.
process.once("exit", ReleaseStringTablesFixture);
g_bSourceJSOwned = true;
g_bLoaderOwned = true;
g_bPackageCacheOwned = true;

for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
	RestoreFixtureProperty(require.cache, strModulePath, undefined);
}

function InstallDependency(strModulePath, ModuleExports) {
	Object.defineProperty(require.cache, strModulePath, {
		configurable: true,
		enumerable: true,
		writable: true,
		value: {
			children: [],
			exports: ModuleExports,
			filename: strModulePath,
			id: strModulePath,
			loaded: true,
			paths: [],
		},
	});
}

function CreateStringTableObject(strName, unTableID) {
	return {
		get ID() {
			return unTableID;
		},

		get MaximumStringCount() {
			return g_unMaximumStringCount;
		},

		get Name() {
			return strName;
		},

		get Address() {
			return g_unStringTableBaseAddress + BigInt(unTableID);
		},

		get StringCount() {
			return g_mapStringTableValues.get(strName).length;
		},
	};
}

const g_EventsManager = {
	FireEvent(strEventName, Payload = {}, bDoNotBroadcast = false) {
		const vecListeners = [];
		for (const Entry of g_vecEventListeners) {
			vecListeners.push(Entry);
		}

		for (const Entry of vecListeners) {
			if (Entry.EventName === strEventName) {
				Entry.Callback(strEventName, Payload, bDoNotBroadcast);
			}
		}

		return true;
	},

	UnregisterEventListener(strEventName, Callback) {
		let nListenerIndex = -1;
		for (let unIndex = 0; unIndex < g_vecEventListeners.length; unIndex += 1) {
			const Entry = g_vecEventListeners[unIndex];
			if ((Entry.EventName === strEventName) && (Entry.Callback === Callback)) {
				nListenerIndex = unIndex;
				break;
			}
		}

		if (nListenerIndex < 0) {
			return false;
		}

		g_vecEventListeners.splice(nListenerIndex, 1);

		return true;
	},

	RegisterEventListener(strEventName, Callback) {
		g_vecEventListeners.push({ Callback: Callback, EventName: strEventName });

		return true;
	},
};

const g_EventsManagerAPI = {
	EVENT_MANAGER: g_EventsManager,
	FireEvent: g_EventsManager.FireEvent.bind(g_EventsManager),
	RegisterEventListener: g_EventsManager.RegisterEventListener.bind(g_EventsManager),
	UnregisterEventListener: g_EventsManager.UnregisterEventListener.bind(g_EventsManager),
};

const g_NativeStringTables = {
	DOWNLOADABLES_TABLE_NAME: "downloadables",

	GetStringUserData(strTableName, nStringIndex) {
		return ((strTableName === "soundprecache") && (nStringIndex === 0)) ? g_arrStringUserData.slice() : null;
	},

	SetStringUserData(strTableName, nStringIndex, arrBytes) {
		if ((strTableName !== "soundprecache") || (nStringIndex !== 0) || (arrBytes.length !== g_arrStringUserData.length)) {
			return false;
		}

		g_arrStringUserData = arrBytes.slice();

		return true;
	},

	AddString(strTableName, strValue) {
		if ((typeof strTableName !== "string") || (strTableName.length === 0) || (typeof strValue !== "string")) {
			throw new TypeError("TableName and Value must be strings");
		}

		const vecValues = g_mapStringTableValues.get(strTableName);
		if (vecValues === undefined) {
			return -1;
		}

		const nExistingIndex = vecValues.indexOf(strValue);
		if (nExistingIndex >= 0) {
			return nExistingIndex;
		}

		vecValues.push(strValue);

		return vecValues.length - 1;
	},

	AddDownloadable(strPathValue) {
		if ((typeof strPathValue !== "string") || (strPathValue.length === 0)) {
			throw new TypeError("Path must be a non-empty string");
		}

		if (strPathValue === "materials/fail.vmt") {
			return -1;
		}

		const nIndex = this.AddString("downloadables", strPathValue);
		let bAlreadyTracked = false;
		for (const strTrackedPath of g_vecTrackedDownloadPaths) {
			if (strTrackedPath === strPathValue) {
				bAlreadyTracked = true;
				break;
			}
		}

		if ((nIndex >= 0) && !bAlreadyTracked) {
			g_vecTrackedDownloadPaths.push(strPathValue);
		}

		return nIndex;
	},

	AddDownloadableDirectory(strPathValue, bRecursive = true) {
		if ((typeof strPathValue !== "string") || (strPathValue.length === 0) || (typeof bRecursive !== "boolean")) {
			throw new TypeError("Directory and Recursive must be strict values");
		}

		const strDirectory = strPathValue.replace(/\\/g, "/").replace(/\/$/, "");
		const vecDownloadPaths = [`${strDirectory}/first.vmt`];

		if (bRecursive) {
			vecDownloadPaths.push(`${strDirectory}/nested/second.vtf`);
		}

		const vecAddedDownloadPaths = [];
		for (const strDownloadPath of vecDownloadPaths) {
			if (this.AddDownloadable(strDownloadPath) >= 0) {
				vecAddedDownloadPaths.push(strDownloadPath);
			}
		}

		return vecAddedDownloadPaths;
	},

	HasDownloadable(strPathValue) {
		return this.GetDownloadableIndex(strPathValue) >= 0;
	},

	GetDownloadableIndex(strPathValue) {
		if ((typeof strPathValue !== "string") || (strPathValue.length === 0)) {
			throw new TypeError("Path must be a non-empty string");
		}

		return g_mapStringTableValues.get("downloadables").indexOf(strPathValue);
	},

	GetDownloadablesList() {
		const vecDownloadPaths = [];
		for (const strDownloadPath of g_mapStringTableValues.get("downloadables")) {
			vecDownloadPaths.push(strDownloadPath);
		}

		return vecDownloadPaths;
	},

	RestoreDownloadables() {
		let unRestoredCount = 0;
		for (const strDownloadPath of g_vecTrackedDownloadPaths) {
			if (this.AddString("downloadables", strDownloadPath) >= 0) {
				unRestoredCount += 1;
			}
		}

		return unRestoredCount;
	},

	GetDownloadablesTable() {
		return CreateStringTableObject("downloadables", 0);
	},

	GetTrackedDownloadables() {
		const vecDownloadPaths = [];
		for (const strDownloadPath of g_vecTrackedDownloadPaths) {
			vecDownloadPaths.push(strDownloadPath);
		}

		return vecDownloadPaths;
	},

	UntrackDownloadable(strPathValue) {
		if ((typeof strPathValue !== "string") || (strPathValue.length === 0)) {
			throw new TypeError("Path must be a non-empty string");
		}

		const nIndex = g_vecTrackedDownloadPaths.indexOf(strPathValue);
		if (nIndex < 0) {
			return false;
		}

		g_vecTrackedDownloadPaths.splice(nIndex, 1);

		return true;
	},

	UntrackDownloadableDirectory(strPathValue) {
		if ((typeof strPathValue !== "string") || (strPathValue.length === 0)) {
			throw new TypeError("Directory must be a non-empty string");
		}

		const strDirectory = strPathValue.replace(/\\/g, "/").replace(/\/$/, "");
		let unRemovedCount = 0;
		for (let nIndex = g_vecTrackedDownloadPaths.length - 1; nIndex >= 0; nIndex -= 1) {
			const strTrackedPath = g_vecTrackedDownloadPaths[nIndex];
			if ((strTrackedPath === strDirectory) || strTrackedPath.startsWith(`${strDirectory}/`)) {
				g_vecTrackedDownloadPaths.splice(nIndex, 1);
				unRemovedCount += 1;
			}
		}

		return unRemovedCount;
	},

	FindStringTable(strName) {
		if ((typeof strName !== "string") || (strName.length === 0)) {
			throw new TypeError("Name must be a non-empty string");
		}

		let unTableID = 0;
		for (const strTableName of g_mapStringTableValues.keys()) {
			if (strTableName === strName) {
				return CreateStringTableObject(strName, unTableID);
			}

			unTableID += 1;
		}

		return null;
	},

	GetRequiredString(strTableName, unIndex) {
		if ((typeof strTableName !== "string") || (strTableName.length === 0) || !Number.isSafeInteger(unIndex) || (unIndex < 0)) {
			throw new TypeError("TableName and Index must be strict values");
		}

		const vecValues = g_mapStringTableValues.get(strTableName);
		if ((vecValues === undefined) || (unIndex >= vecValues.length)) {
			throw new Error(`missing string: ${strTableName}[${unIndex}]`);
		}

		return vecValues[unIndex];
	},

	GetString(strTableName, nIndex) {
		if ((typeof strTableName !== "string") || (strTableName.length === 0) || !Number.isSafeInteger(nIndex)) {
			throw new TypeError("TableName and Index must be strict values");
		}

		const vecValues = g_mapStringTableValues.get(strTableName);
		if ((vecValues === undefined) || (nIndex < 0) || (nIndex >= vecValues.length)) {
			return null;
		}

		return vecValues[nIndex];
	},

	GetAllStringTables() {
		const vecTables = [];
		let unTableID = 0;
		for (const strName of g_mapStringTableValues.keys()) {
			vecTables.push(CreateStringTableObject(strName, unTableID));
			unTableID += 1;
		}

		return vecTables;
	},
};

function ExecuteCodeBlock(strSource, unIndex, StringTablesAPI) {
	const unCompilationTimeoutMilliseconds = 1000;

	const strDocumentationBlockPath = `${g_strDocumentationPath}:example-${unIndex + 1}.js`;
	const ModuleRecord = new g_Module(strDocumentationBlockPath, module);
	ModuleRecord.filename = strDocumentationBlockPath;
	ModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
	ModuleRecord.require = function RequireDocumentationModule(strIdentifier) {
		if (strIdentifier === "stringtables") {
			return StringTablesAPI;
		}

		throw new Error(`Unexpected documentation import: ${strIdentifier}`);
	};

	g_VM.runInNewContext("Compile();", {
		Compile() {
			ModuleRecord._compile(strSource, strDocumentationBlockPath);
		},
	}, { filename: strDocumentationBlockPath, timeout: unCompilationTimeoutMilliseconds });

	return ModuleRecord.exports;
}

function ExtractDocumentationImports(strSource) {
	const vecImportMatch = strSource.match(/const\s*\{([\s\S]*?)\}\s*=\s*require\("stringtables"\);/);
	g_Assert.ok(vecImportMatch, "documentation starts with a destructured stringtables import");

	const vecImportNames = [];
	for (const strValue of vecImportMatch[1].split(",")) {
		const strImportName = strValue.split(":", 1)[0].trim();
		if (strImportName.length > 0) {
			vecImportNames.push(strImportName);
		}
	}

	return vecImportNames;
}

function NormalizeHeadingAnchor(strHeading) {
	let strAnchor = strHeading.toLowerCase();
	strAnchor = strAnchor.replace(/`/g, "");
	strAnchor = strAnchor.replace(/[^a-z0-9]+/g, "-");
	strAnchor = strAnchor.replace(/^-|-$/g, "");

	return strAnchor;
}

function ToPlainValue(Value) {
	return JSON.parse(JSON.stringify(Value));
}

function CollectValues(Iterable) {
	const vecCollectedValues = [];
	for (const Value of Iterable) {
		vecCollectedValues.push(Value);
	}

	return vecCollectedValues;
}

function ContainsValue(vecValues, Target) {
	for (const Value of vecValues) {
		if (Value === Target) {
			return true;
		}
	}

	return false;
}

function CaptureRuntimeState(StringTablesAPI) {
	const vecDownloadables = [];
	const vecEventNames = [];
	const vecTables = [];
	const vecTrackedPaths = [];

	for (const strDownloadPath of StringTablesAPI.DOWNLOADABLES) {
		vecDownloadables.push(strDownloadPath);
	}

	for (const Entry of g_vecEventListeners) {
		vecEventNames.push(Entry.EventName);
	}

	for (const [strName, vecValues] of g_mapStringTableValues) {
		const vecCopiedValues = [];
		for (const strValue of vecValues) {
			vecCopiedValues.push(strValue);
		}

		vecTables.push([strName, vecCopiedValues]);
	}

	for (const strTrackedPath of g_vecTrackedDownloadPaths) {
		vecTrackedPaths.push(strTrackedPath);
	}

	return { Downloadables: vecDownloadables, EventNames: vecEventNames, Tables: vecTables, TrackedPaths: vecTrackedPaths };
}

function VerifyContentsAnchors(strDocumentation) {
	const vecContentsMatch = strDocumentation.match(/^## Contents\r?\n\r?\n([\s\S]*?)(?=\r?\n\r?\n## )/m);
	g_Assert.ok(vecContentsMatch, "documentation Contents section");

	const vecLinkedAnchors = [];
	const vecHeadingAnchors = [];

	for (const vecMatch of vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecLinkedAnchors.push(vecMatch[1]);
	}

	for (const vecMatch of strDocumentation.matchAll(/^## (?!Contents$)(.+)$/gm)) {
		vecHeadingAnchors.push(NormalizeHeadingAnchor(vecMatch[1]));
	}

	g_Assert.deepEqual(vecLinkedAnchors, vecHeadingAnchors, "Contents links every level-two section in order");
}

function VerifyDocumentationLinks(strDocumentation) {
	const strDocumentationDirectory = g_Path.dirname(g_strDocumentationPath);
	for (const vecMatch of strDocumentation.matchAll(/\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/g)) {
		const strLinkTarget = vecMatch[1];
		const nSeparatorIndex = strLinkTarget.indexOf("#");
		let strRelativePath = strLinkTarget;
		let strFragment = null;

		if (nSeparatorIndex >= 0) {
			strRelativePath = strLinkTarget.slice(0, nSeparatorIndex);
			strFragment = strLinkTarget.slice(nSeparatorIndex + 1);
		}

		const strTargetPath = g_Path.resolve(strDocumentationDirectory, strRelativePath);
		g_Assert.equal(g_FileSystem.existsSync(strTargetPath), true, `documentation link exists: ${vecMatch[1]}`);

		if (strFragment !== null) {
			const strTargetDocumentation = g_FileSystem.readFileSync(strTargetPath, "utf8");
			let bTargetAnchorFound = false;

			for (const vecHeadingMatch of strTargetDocumentation.matchAll(/^#{1,6} (.+)$/gm)) {
				if (NormalizeHeadingAnchor(vecHeadingMatch[1]) === strFragment) {
					bTargetAnchorFound = true;
					break;
				}
			}

			g_Assert.equal(bTargetAnchorFound, true, `documentation anchor exists: ${vecMatch[1]}`);
		}
	}
}

function AssertSingleReadTableInputs() {
	let unScenarioCount = 0;
	const vecTargets = [g_StringTablesAPI, new g_StringTablesAPI.StringTableContainer()];
	const vecOperationNames = ["GetString", "GetRequiredString", "AddString"];
	const vecThrownValues = [
		undefined,
		null,
		false,
		0,
		"",
		Symbol("GetterFailure"),
		new Error("Getter failure"),
	];
	const ExpectExactException = (Callback, ExceptionValue) => {
		let bThrown = false;
		let CaughtException = undefined;

		try {
			Callback();
		} catch (CaughtValue) {
			bThrown = true;
			CaughtException = CaughtValue;
		}

		g_Assert.equal(bThrown, true, "the original getter exception must escape");
		g_Assert.equal(CaughtException, ExceptionValue, "getter exceptions retain identity, including falsy values");
	};

	for (const Target of vecTargets) {
		for (const strOperationName of vecOperationNames) {
			const OriginalOperation = g_NativeStringTables[strOperationName];
			const ArgumentValue = (strOperationName === "AddString") ? "materials/getter-input.vmt" : 0;
			const ResultValue = (strOperationName === "AddString") ? 1 : "TableGetterResult";
			let unNativeCallCount = 0;
			g_NativeStringTables[strOperationName] = function RecordTableOperation(strTableName, ...vecArguments) {
				unNativeCallCount += 1;
				g_Assert.equal(strTableName, "downloadables", "the checked table name is passed to the native operation");
				g_Assert.deepEqual(vecArguments, [ArgumentValue], "the remaining argument is unchanged");

				return ResultValue;
			};

			try {
				for (const bInherited of [false, true]) {
					for (const bSecondReadThrows of [false, true]) {
						let unNameReadCount = 0;
						const NameOwner = {};
						const TableValue = bInherited ? Object.create(NameOwner) : NameOwner;
						Object.defineProperty(NameOwner, "Name", {
							get() {
								g_Assert.equal(this, TableValue, "inherited getters retain their receiver");
								unNameReadCount += 1;

								if (unNameReadCount > 1) {
									if (bSecondReadThrows) {
										throw new Error("Name must not be read twice");
									}

									return "soundprecache";
								}

								return "downloadables";
							},
						});
						const unPreviousNativeCallCount = unNativeCallCount;
						g_Assert.equal(Reflect.apply(Target[strOperationName], Target, [TableValue, ArgumentValue]), ResultValue, "the native result is returned unchanged");
						g_Assert.equal(unNameReadCount, 1, "table-name validation and use share one getter read");
						g_Assert.equal(unNativeCallCount, unPreviousNativeCallCount + 1, "one native operation follows validation");
						unScenarioCount += 1;
					}
				}

				for (const ExceptionValue of vecThrownValues) {
					const TableValue = {
						get Name() {
							throw ExceptionValue;
						},
					};
					const unPreviousNativeCallCount = unNativeCallCount;
					ExpectExactException(() => Reflect.apply(Target[strOperationName], Target, [TableValue, ArgumentValue]), ExceptionValue);
					g_Assert.equal(unNativeCallCount, unPreviousNativeCallCount, "a failed getter never reaches the native operation");
					unScenarioCount += 1;
				}

				for (const NameValue of [
					undefined,
					null,
					false,
					0,
					1n,
					Symbol("InvalidName"),
					{},
					[],
				]) {
					let unNameReadCount = 0;
					const TableValue = {
						get Name() {
							unNameReadCount += 1;

							return NameValue;
						},
					};
					const unPreviousNativeCallCount = unNativeCallCount;
					g_Assert.throws(() => Reflect.apply(Target[strOperationName], Target, [TableValue, ArgumentValue]), TypeError);
					g_Assert.equal(unNameReadCount, 1, "invalid names are checked once");
					g_Assert.equal(unNativeCallCount, unPreviousNativeCallCount, "invalid names never reach the native operation");
					unScenarioCount += 1;
				}
			} finally {
				g_NativeStringTables[strOperationName] = OriginalOperation;
			}
		}
	}

	for (const bInherited of [false, true]) {
		let unAddressReadCount = 0;
		let unCurrentAddress = 0x1000n;
		const AddressOwner = { ID: 0 };
		const TableValue = bInherited ? Object.create(AddressOwner) : AddressOwner;
		Object.defineProperty(AddressOwner, "Address", {
			get() {
				g_Assert.equal(this, TableValue, "address getters retain their receiver");
				unAddressReadCount += 1;

				return unCurrentAddress;
			},
		});
		const Table = new g_StringTablesAPI.StringTable(TableValue);
		g_Assert.equal(unAddressReadCount, 1, "constructor validation reads Address once");

		unCurrentAddress = 0xFEDCBA9876543210n;
		g_Assert.equal(Table.Address, unCurrentAddress, "later property reads remain live and preserve all address bits");
		g_Assert.equal(unAddressReadCount, 2, "the validated address is not cached as a property snapshot");

		const SharedTable = new g_StringTablesAPI.StringTable(Table);
		g_Assert.equal(unAddressReadCount, 3, "wrapper sharing performs one validation read");
		g_Assert.equal(SharedTable.Address, unCurrentAddress, "a shared wrapper retains the original descriptor");

		unCurrentAddress = 0n;
		g_Assert.equal(Table.Valid, false, "live invalidation remains visible");
		unScenarioCount += 1;
	}

	let unOneShotAddressReadCount = 0;
	new g_StringTablesAPI.StringTable({
		get Address() {
			unOneShotAddressReadCount += 1;

			if (unOneShotAddressReadCount > 1) {
				throw new Error("Address must not be read twice during construction");
			}

			return 0x1000n;
		},
	});
	g_Assert.equal(unOneShotAddressReadCount, 1, "a one-shot address getter supports construction");
	unScenarioCount += 1;

	for (const AddressValue of [
		undefined,
		null,
		false,
		0,
		-1,
		0x1000,
		"0x1000",
		0n,
		-1n,
		Symbol("InvalidAddress"),
		{},
		[],
	]) {
		let unAddressReadCount = 0;
		const TableValue = {
			get Address() {
				unAddressReadCount += 1;

				return AddressValue;
			},
		};
		g_Assert.throws(() => new g_StringTablesAPI.StringTable(TableValue), TypeError);
		g_Assert.equal(unAddressReadCount, 1, "invalid addresses are checked once without coercion");
		unScenarioCount += 1;
	}

	for (const ExceptionValue of vecThrownValues) {
		ExpectExactException(() => new g_StringTablesAPI.StringTable({
			get Address() {
				throw ExceptionValue;
			},
		}), ExceptionValue);
		unScenarioCount += 1;
	}

	g_Assert.equal(unScenarioCount, 136, "all single-read and exception scenarios ran");
}

function AssertDownloadOwnerFailureContracts() {
	let unScenarioCount = 0;
	const vecTableValues = g_mapStringTableValues.get("downloadables");
	const unInitialStringCount = vecTableValues.length;
	const vecInitialTrackedPaths = g_vecTrackedDownloadPaths.slice();
	const OriginalAddDownloadable = g_NativeStringTables.AddDownloadable;
	const OriginalUntrackDownloadable = g_NativeStringTables.UntrackDownloadable;
	const vecThrownValues = [
		undefined,
		null,
		false,
		0,
		"",
		Symbol("DownloadFailure"),
		new Error("Download failure"),
	];
	const CaptureException = Callback => {
		try {
			Callback();
		} catch (ExceptionValue) {
			return { Thrown: true, Error: ExceptionValue };
		}

		return { Thrown: false };
	};

	for (const strOperationName of [
		"delete",
		"clear",
		"RemoveDirectory",
		"Dispose",
	]) {
		for (const ExceptionValue of vecThrownValues) {
			const strPath = `materials/sourcejs/failure-owner-${unScenarioCount}.vmt`;
			const setDownloads = new g_StringTablesAPI.Downloadables([strPath]);

			try {
				let unUntrackCallCount = 0;
				g_NativeStringTables.UntrackDownloadable = function FailUntrack(strNormalizedPath) {
					g_Assert.equal(strNormalizedPath, strPath);
					unUntrackCallCount += 1;
					throw ExceptionValue;
				};

				const Failure = CaptureException(() => Reflect.apply(setDownloads[strOperationName], setDownloads, [strPath]));
				g_Assert.equal(Failure.Thrown, true, "native untrack failures propagate");
				g_Assert.equal(Failure.Error, ExceptionValue, "untrack preserves the original exception, even falsy values");
				g_Assert.equal(unUntrackCallCount, 1, "cleanup stops at the first failed native operation");
				g_Assert.equal(setDownloads.has(strPath), true, "failed untracking retains the local path for recovery");
				g_NativeStringTables.UntrackDownloadable = OriginalUntrackDownloadable;

				const setOtherOwner = new g_StringTablesAPI.Downloadables([strPath]);

				try {
					g_Assert.equal(setOtherOwner.Dispose(), true, "secondary owner unregisters after failed primary release");
					g_Assert.equal(g_vecTrackedDownloadPaths.includes(strPath), true, "a failed owner remains registered and protects shared tracking");
				} finally {
					// Dispose may already have unregistered this owner; false is valid here.
					setOtherOwner.Dispose();
				}

				g_Assert.equal(setDownloads.Dispose(), true, "cleanup can be retried through the retained owner");
				g_Assert.equal(g_vecTrackedDownloadPaths.includes(strPath), false, "successful retry releases tracking");
				unScenarioCount += 1;
			} finally {
				g_NativeStringTables.UntrackDownloadable = OriginalUntrackDownloadable;
				// Dispose may already have unregistered this owner; false is valid here.
				setDownloads.Dispose();
			}
		}
	}

	for (const ExceptionValue of vecThrownValues) {
		for (const CleanupError of vecThrownValues) {
			const strFirstPath = `materials/sourcejs/partial-owner-${unScenarioCount}.vmt`;
			const strSecondPath = `${strFirstPath}.second`;
			let setRecoveredDownloads = undefined;

			try {
				g_NativeStringTables.AddDownloadable = function FailSecondAdd(strPath) {
					if (strPath === strSecondPath) {
						throw ExceptionValue;
					}

					return Reflect.apply(OriginalAddDownloadable, g_NativeStringTables, [strPath]);
				};

				g_NativeStringTables.UntrackDownloadable = function FailConstructorCleanup() {
					throw CleanupError;
				};

				const Failure = CaptureException(() => new g_StringTablesAPI.Downloadables([strFirstPath, strSecondPath]));
				g_Assert.equal(Failure.Thrown, true, "partial construction reports failure");
				g_Assert.equal(Failure.Error instanceof AggregateError, true, "both construction and cleanup errors are preserved");
				g_Assert.deepEqual(Failure.Error.errors, [ExceptionValue, CleanupError], "error order is construction then cleanup");

				setRecoveredDownloads = Failure.Error.UnreleasedDownloadables;
				g_Assert.equal(setRecoveredDownloads instanceof g_StringTablesAPI.Downloadables, true, "an incompletely cleared owner is recoverable");
				g_Assert.equal(setRecoveredDownloads.has(strFirstPath), true, "the retained owner identifies the untracked-failure path");
				g_Assert.equal(setRecoveredDownloads.has(strSecondPath), false, "an unsuccessful add never becomes locally owned");

				g_NativeStringTables.AddDownloadable = OriginalAddDownloadable;
				g_NativeStringTables.UntrackDownloadable = OriginalUntrackDownloadable;

				const setOtherOwner = new g_StringTablesAPI.Downloadables([strFirstPath]);

				try {
					g_Assert.equal(setOtherOwner.Dispose(), true, "secondary owner unregisters while partial primary remains");
					g_Assert.equal(g_vecTrackedDownloadPaths.includes(strFirstPath), true, "the recoverable partial owner participates in shared ownership");
				} finally {
					// Dispose may already have unregistered this owner; false is valid here.
					setOtherOwner.Dispose();
				}

				g_Assert.equal(setRecoveredDownloads.Dispose(), true, "the partial owner can release and unregister itself");
				unScenarioCount += 1;
			} finally {
				g_NativeStringTables.AddDownloadable = OriginalAddDownloadable;
				g_NativeStringTables.UntrackDownloadable = OriginalUntrackDownloadable;

				if (setRecoveredDownloads) {
					// Dispose may already have unregistered this owner; false is valid here.
					setRecoveredDownloads.Dispose();
				}
			}
		}
	}

	for (const ExceptionValue of vecThrownValues) {
		const strFirstPath = `materials/sourcejs/cleared-owner-${unScenarioCount}.vmt`;
		const strSecondPath = `${strFirstPath}.second`;

		try {
			g_NativeStringTables.AddDownloadable = function FailSecondAdd(strPath) {
				if (strPath === strSecondPath) {
					throw ExceptionValue;
				}

				return Reflect.apply(OriginalAddDownloadable, g_NativeStringTables, [strPath]);
			};

			const Failure = CaptureException(() => new g_StringTablesAPI.Downloadables([strFirstPath, strSecondPath]));
			g_Assert.equal(Failure.Thrown, true);
			g_Assert.equal(Failure.Error, ExceptionValue, "successful rollback retains the original construction exception");
			g_Assert.equal(g_vecTrackedDownloadPaths.includes(strFirstPath), false, "successful constructor cleanup releases partial tracking");
			unScenarioCount += 1;
		} finally {
			g_NativeStringTables.AddDownloadable = OriginalAddDownloadable;
		}
	}

	for (const ResultValue of [
		-1,
		-2,
		undefined,
		null,
		false,
		"1",
		1.5,
		Infinity,
	]) {
		const strPath = `materials/sourcejs/restore-owner-${unScenarioCount}.vmt`;
		const setDownloads = new g_StringTablesAPI.Downloadables([strPath]);

		try {
			g_NativeStringTables.AddDownloadable = function FailRestore() {
				return ResultValue;
			};

			g_Assert.throws(() => setDownloads.Restore(), /Unable to add downloadable path:/, "a failed restore is not successful completion");
			g_Assert.equal(setDownloads.has(strPath), true, "failed restoration retains the owner's retryable path");
			unScenarioCount += 1;
		} finally {
			g_NativeStringTables.AddDownloadable = OriginalAddDownloadable;
			g_Assert.equal(setDownloads.Dispose(), true, "failed restore owner unregisters during fixture cleanup");
		}
	}

	for (const ExceptionValue of vecThrownValues) {
		const strPath = `materials/sourcejs/restore-exception-${unScenarioCount}.vmt`;
		const setDownloads = new g_StringTablesAPI.Downloadables([strPath]);

		try {
			g_NativeStringTables.AddDownloadable = function FailRestore() {
				throw ExceptionValue;
			};

			const Failure = CaptureException(() => setDownloads.Restore());
			g_Assert.equal(Failure.Thrown, true);
			g_Assert.equal(Failure.Error, ExceptionValue, "restore preserves native exceptions, even falsy values");
			g_Assert.equal(setDownloads.has(strPath), true);
			unScenarioCount += 1;
		} finally {
			g_NativeStringTables.AddDownloadable = OriginalAddDownloadable;
			g_Assert.equal(setDownloads.Dispose(), true, "throwing restore owner unregisters during fixture cleanup");
		}
	}

	g_Assert.equal(unScenarioCount, 99, "all download-owner failure and recovery scenarios ran");
	g_Assert.deepEqual(g_vecTrackedDownloadPaths, vecInitialTrackedPaths, "failure scenarios leave no restoration owners behind");

	// Reset only this isolated engine double; real table entries cannot be removed.
	vecTableValues.length = unInitialStringCount;
}

function AssertSharedOwnerWorkflowFailures(strSource, unBlockIndex) {
	let unScenarioCount = 0;
	const vecThrownValues = [
		undefined,
		null,
		false,
		0,
		"",
		Symbol("WorkflowFailure"),
		new Error("Workflow failure"),
	];
	const RunFailure = (bFailWork, bFailSecondConstructor, unCleanupFailureMask, WorkError, FirstCleanupError, SecondCleanupError) => {
		const vecAcquiredOwners = [];
		const vecDisposeCounts = [];

		class FailureDownloadables extends Set {
			constructor() {
				super();
				const unOwnerIndex = vecAcquiredOwners.length;
				if (bFailSecondConstructor && (unOwnerIndex === 1)) {
					throw WorkError;
				}

				this.OwnerIndex = unOwnerIndex;
				vecAcquiredOwners.push(this);
				vecDisposeCounts.push(0);
			}

			Add(strPath) {
				if (bFailWork && (this.OwnerIndex === 1)) {
					throw WorkError;
				}

				super.add(strPath);

				return this;
			}

			Restore() {
				return this;
			}

			Dispose() {
				vecDisposeCounts[this.OwnerIndex] += 1;

				if ((unCleanupFailureMask & (0x1 << this.OwnerIndex)) !== 0x0) {
					const CleanupError = (this.OwnerIndex === 0) ? FirstCleanupError : SecondCleanupError;
					throw CleanupError;
				}

				super.clear();

				return true;
			}
		}

		const WorkflowExports = ExecuteCodeBlock(strSource, unBlockIndex, {
			Downloadables: FailureDownloadables,

			GetTrackedDownloadables() {
				return [];
			},
		});

		let bThrown = false;
		let Failure = undefined;

		try {
			WorkflowExports.ExerciseSharedDownloadOwnership("materials/sourcejs/workflow.vmt");
		} catch (ExceptionValue) {
			bThrown = true;
			Failure = ExceptionValue;
		}

		g_Assert.equal(bThrown, true, "operation and cleanup failures are reported");
		g_Assert.equal(vecAcquiredOwners.length, bFailSecondConstructor ? 1 : 2, "only successful acquisitions require cleanup");

		for (const unDisposeCount of vecDisposeCounts) {
			g_Assert.equal(unDisposeCount, 1, "every acquired owner is attempted exactly once");
		}

		if (unCleanupFailureMask === 0x0) {
			g_Assert.equal(Failure, WorkError, "successful cleanup preserves the exact operation exception");

		} else {
			const vecExpectedErrors = (bFailWork || bFailSecondConstructor) ? [WorkError] : [];
			const vecExpectedOwners = [];
			for (const setOwner of vecAcquiredOwners) {
				if ((unCleanupFailureMask & (0x1 << setOwner.OwnerIndex)) !== 0x0) {
					vecExpectedErrors.push((setOwner.OwnerIndex === 0) ? FirstCleanupError : SecondCleanupError);
					vecExpectedOwners.push(setOwner);
				}
			}

			g_Assert.equal(Failure.name, "AggregateError", "the actual documentation VM reports aggregated cleanup errors");
			g_Assert.deepEqual(Array.from(Failure.errors), vecExpectedErrors, "operation and cleanup errors preserve order and identity");
			g_Assert.deepEqual(Array.from(Failure.UnreleasedDownloadOwners), vecExpectedOwners, "failed owners remain available for explicit recovery");
		}

		unScenarioCount += 1;
	};

	for (const ExceptionValue of vecThrownValues) {
		for (const unCleanupFailureMask of [0x0, 0x1, 0x2, 0x3]) {
			RunFailure(true, false, unCleanupFailureMask, ExceptionValue, false, null);
		}

		for (const unCleanupFailureMask of [0x1, 0x2, 0x3]) {
			RunFailure(false, false, unCleanupFailureMask, undefined, ExceptionValue, Symbol("SecondCleanupFailure"));
		}

		for (const unCleanupFailureMask of [0x0, 0x1]) {
			RunFailure(false, true, unCleanupFailureMask, ExceptionValue, false, null);
		}
	}

	g_Assert.equal(unScenarioCount, 63, "all documentation ownership failure scenarios ran");
}

InstallDependency(g_strEventManagerPath, g_EventsManagerAPI);
InstallDependency(g_strPathsPath, { GAME_ROOT: g_strGameRootPath });

Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { stringtables: g_NativeStringTables } });

globalThis.sourcejs["stringtables/downloads"] = {
	DOWNLOADABLES_TABLE_NAME: g_NativeStringTables.DOWNLOADABLES_TABLE_NAME,
	AddDownloadable: g_NativeStringTables.AddDownloadable.bind(g_NativeStringTables),
	AddDownloadableDirectory: g_NativeStringTables.AddDownloadableDirectory.bind(g_NativeStringTables),
	HasDownloadable: g_NativeStringTables.HasDownloadable.bind(g_NativeStringTables),
	GetDownloadableIndex: g_NativeStringTables.GetDownloadableIndex.bind(g_NativeStringTables),
	GetDownloadablesList: g_NativeStringTables.GetDownloadablesList.bind(g_NativeStringTables),
	RestoreDownloadables: g_NativeStringTables.RestoreDownloadables.bind(g_NativeStringTables),
	GetDownloadablesTable: g_NativeStringTables.GetDownloadablesTable.bind(g_NativeStringTables),
	GetTrackedDownloadables: g_NativeStringTables.GetTrackedDownloadables.bind(g_NativeStringTables),
	UntrackDownloadable: g_NativeStringTables.UntrackDownloadable.bind(g_NativeStringTables),
	UntrackDownloadableDirectory: g_NativeStringTables.UntrackDownloadableDirectory.bind(g_NativeStringTables),
};

RestoreFixtureProperty(require.cache, g_strStringTablesPath, undefined);
RestoreFixtureProperty(require.cache, g_strDownloadsPath, undefined);

const g_OriginalModuleLoad = g_LoaderDescriptor.value;
Object.defineProperty(g_Module, "_load", {
	...g_LoaderDescriptor,
	writable: true,
	value: function LoadStringTablesTestModule(strRequest, Parent, bIsMain) {
		if (strRequest === "internal/runtime") {
			return g_OriginalModuleLoad(g_strInternalRuntimePath, Parent, bIsMain);
		}

		if (strRequest === "events/manager") {
			return g_OriginalModuleLoad(g_strEventManagerPath, Parent, bIsMain);
		}

		if (strRequest === "paths") {
			return g_OriginalModuleLoad(g_strPathsPath, Parent, bIsMain);
		}

		return g_OriginalModuleLoad(strRequest, Parent, bIsMain);
	},
});

let g_StringTablesAPI = undefined;
let g_DownloadsAPI = undefined;

try {
	g_StringTablesAPI = require(g_strStringTablesPath);
	g_DownloadsAPI = require(g_strDownloadsPath);
} finally {
	RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
	g_bLoaderOwned = false;
}

AssertSingleReadTableInputs();
AssertDownloadOwnerFailureContracts();

g_Assert.deepEqual(Object.keys(g_StringTablesAPI).sort(), [
	"DOWNLOADABLES",
	"DOWNLOADABLES_TABLE_NAME",
	"Downloadables",
	"INVALID_STRING_INDEX",
	"INVALID_STRING_TABLE",
	"STRING_TABLES",
	"StringTable",
	"StringTableContainer",
	"AddDownloadable",
	"AddDownloadableDirectory",
	"AddString",
	"Find",
	"GetAll",
	"GetDownloadableIndex",
	"GetDownloadablesList",
	"GetDownloadablesTable",
	"GetRequiredString",
	"GetString",
	"GetStringUserData",
	"GetTrackedDownloadables",
	"HasDownloadable",
	"RestoreDownloadables",
	"SetStringUserData",
	"UntrackDownloadable",
	"UntrackDownloadableDirectory",
].sort(), "exact stringtables exports");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_StringTablesAPI.StringTable.prototype).sort(), [
	"Add",
	"Get",
	"GetEntries",
	"GetKeys",
	"GetStringUserData",
	"GetValues",
	"Has",
	"IndexOf",
	"SetStringUserData",
	"constructor",
	"Address",
	"ID",
	"Length",
	"MaximumStringCount",
	"Name",
	"StringCount",
	"Valid",
].sort(), "StringTable members");
g_Assert.equal(typeof g_StringTablesAPI.StringTable.prototype[Symbol.iterator], "function", "StringTable iterator");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_StringTablesAPI.StringTableContainer.prototype).sort(), [
	"AddString",
	"Find",
	"FindByID",
	"GetAll",
	"GetDownloadables",
	"GetNames",
	"GetRequiredString",
	"GetString",
	"GetStringUserData",
	"Has",
	"SetStringUserData",
	"constructor",
	"Length",
].sort(), "StringTableContainer members");
g_Assert.equal(typeof g_StringTablesAPI.StringTableContainer.prototype[Symbol.iterator], "function", "StringTableContainer iterator");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_StringTablesAPI.Downloadables.prototype).sort(), [
	"AddDirectory",
	"Add",
	"clear",
	"constructor",
	"delete",
	"has",
	"Dispose",
	"RemoveDirectory",
	"Restore",
].sort(), "Downloadables members");
g_Assert.equal(g_DownloadsAPI, globalThis.sourcejs["stringtables/downloads"], "downloads submodule preserves native identity");
g_Assert.equal(g_StringTablesAPI.INVALID_STRING_INDEX, -1, "invalid string index");
g_Assert.equal(g_StringTablesAPI.INVALID_STRING_TABLE, -1, "invalid table ID");
g_Assert.equal(g_StringTablesAPI.DOWNLOADABLES_TABLE_NAME, "downloadables", "downloadables table name");
g_Assert.ok(g_StringTablesAPI.DOWNLOADABLES instanceof g_StringTablesAPI.Downloadables, "shared Downloadables owner");

const g_vecNativeTables = g_StringTablesAPI.GetAll();
const g_NativeDownloadables = g_StringTablesAPI.Find("downloadables");
g_Assert.equal(g_vecNativeTables.length, 2, "native table list");
g_Assert.equal(g_NativeDownloadables.Address, 0x1000n, "native address is a BigInt");
g_Assert.equal(g_NativeDownloadables.Name, "downloadables", "native table name");
g_Assert.equal(g_NativeDownloadables.ID, 0, "native table ID");
g_Assert.equal(g_NativeDownloadables.StringCount, 1, "native live string count");
g_Assert.equal(g_NativeDownloadables.MaximumStringCount, 4096, "native maximum count");
g_Assert.equal(g_StringTablesAPI.Find("missing"), null, "missing native table");
g_Assert.equal(g_StringTablesAPI.GetString("downloadables", 99), null, "optional missing string");
g_Assert.throws(() => g_StringTablesAPI.GetRequiredString("downloadables", 99), /missing string/, "required missing strings throw");
g_Assert.throws(() => g_StringTablesAPI.Find(1), TypeError, "Find requires string names");

const g_nDirectIndex = g_StringTablesAPI.AddString(g_NativeDownloadables, "materials/direct-table.vmt");
const g_strDirectObjectValue = g_StringTablesAPI.GetString({ Name: "downloadables" }, g_nDirectIndex);
g_Assert.equal(g_strDirectObjectValue, "materials/direct-table.vmt", "object table names");
g_Assert.equal(g_StringTablesAPI.GetRequiredString("downloadables", g_nDirectIndex), "materials/direct-table.vmt", "required string");

const g_UserDataTable = new g_StringTablesAPI.StringTable("soundprecache");
const g_arrUserDataInput = new Uint8Array([0x01, 0xFF, 0x00, 0xA5, 0x02]);
g_Assert.deepEqual(g_StringTablesAPI.GetStringUserData(g_UserDataTable, 0), new Uint8Array([0x00, 0xFF, 0x09]));
g_Assert.equal(g_UserDataTable.SetStringUserData(0, g_arrUserDataInput.subarray(1, 4)), true);
g_arrUserDataInput[1] = 0;
const g_arrUserDataCopy = g_StringTablesAPI.STRING_TABLES.GetStringUserData({ Name: "soundprecache" }, 0);
g_Assert.deepEqual(g_arrUserDataCopy, new Uint8Array([0xFF, 0x00, 0xA5]));
g_arrUserDataCopy[0] = 0;
g_Assert.deepEqual(g_UserDataTable.GetStringUserData(0), new Uint8Array([0xFF, 0x00, 0xA5]));
g_Assert.equal(g_UserDataTable.GetStringUserData(-1), null);
g_Assert.equal(g_StringTablesAPI.SetStringUserData("missing", 0, g_arrUserDataCopy), false);
g_Assert.equal(g_StringTablesAPI.STRING_TABLES.SetStringUserData(g_UserDataTable, 0, new Uint8Array(1)), false);

const g_Table = new g_StringTablesAPI.StringTable("downloadables");
const g_SharedWrapper = new g_StringTablesAPI.StringTable(g_Table);
g_Assert.equal(g_Table.Address, 0x1000n, "StringTable address");
g_Assert.equal(g_Table.ID, 0, "StringTable ID");
g_Assert.equal(g_Table.MaximumStringCount, 4096, "StringTable capacity");
g_Assert.equal(g_Table.Valid, true, "StringTable validity");

for (const InvalidAddress of [
	0,
	0x1000,
	"0x1000",
	0n,
	-1n,
]) {
	g_Assert.throws(() => new g_StringTablesAPI.StringTable({ Address: InvalidAddress }), TypeError, "table addresses require a positive BigInt");
}

const g_LargeAddressTableRecord = { Address: 0xFEDCBA9876543210n, ID: 1 };
const g_LargeAddressTable = new g_StringTablesAPI.StringTable(g_LargeAddressTableRecord);
g_Assert.equal(g_LargeAddressTable.Address, 0xFEDCBA9876543210n, "table addresses retain all 64 bits");
g_Assert.equal(g_LargeAddressTable.Valid, true, "large-address table is valid");
g_LargeAddressTableRecord.Address = 0n;
g_Assert.equal(g_LargeAddressTable.Valid, false, "a cleared native BigInt address invalidates the live wrapper");

g_Assert.equal(g_SharedWrapper.Address, g_Table.Address, "wrapper construction shares native descriptor");
g_Assert.equal(g_Table.Get(0), "materials/example.vmt", "StringTable Get");
g_Assert.equal(g_Table.IndexOf("materials/example.vmt"), 0, "StringTable IndexOf");
g_Assert.equal(g_Table.IndexOf("missing"), -1, "StringTable missing index");
g_Assert.equal(g_Table.Has("materials/example.vmt"), true, "StringTable Has");

const g_nAddedIndex = g_Table.Add("models/sourcejs/example.mdl");
const g_vecExpectedTableValues = g_mapStringTableValues.get("downloadables");
const g_vecExpectedTableKeys = [];
const g_vecExpectedTableEntries = [];
for (let unIndex = 0; unIndex < g_vecExpectedTableValues.length; unIndex += 1) {
	g_vecExpectedTableKeys.push(unIndex);
	g_vecExpectedTableEntries.push([unIndex, g_vecExpectedTableValues[unIndex]]);
}

g_Assert.equal(g_Table.Length, g_mapStringTableValues.get("downloadables").length, "StringTable length is live");
g_Assert.equal(g_Table.Get(g_nAddedIndex), "models/sourcejs/example.mdl", "StringTable Add");
g_Assert.deepEqual(CollectValues(g_Table.GetKeys()), g_vecExpectedTableKeys, "StringTable GetKeys");
g_Assert.deepEqual(CollectValues(g_Table.GetValues()), g_vecExpectedTableValues, "StringTable GetValues");
g_Assert.deepEqual(CollectValues(g_Table.GetEntries()), g_vecExpectedTableEntries, "StringTable GetEntries");
g_Assert.deepEqual(CollectValues(g_Table), g_vecExpectedTableValues, "StringTable iterator");
g_Assert.throws(() => new g_StringTablesAPI.StringTable("missing"), TypeError, "missing StringTable names throw");
g_Assert.throws(() => g_Table.IndexOf(1), TypeError, "StringTable IndexOf requires strings");

const g_Container = new g_StringTablesAPI.StringTableContainer();
g_Assert.equal(g_Container.Length, 2, "container length");
g_Assert.deepEqual(g_Container.GetNames(), ["downloadables", "soundprecache"], "container names");

for (const Entry of g_Container.GetAll()) {
	g_Assert.ok(Entry instanceof g_StringTablesAPI.StringTable, "container wrapper");
}

g_Assert.equal(g_Container.Find("downloadables").Name, "downloadables", "container Find");
g_Assert.equal(g_Container.FindByID(0).Name, "downloadables", "container FindByID");
g_Assert.equal(g_Container.FindByID(99), null, "container missing ID");
g_Assert.equal(g_Container.Has("downloadables"), true, "container Has");
g_Assert.equal(g_Container.GetDownloadables.Name, "downloadables", "container GetDownloadables uses SDK constant");
g_Assert.equal(g_Container.GetString(g_Table, 0), "materials/example.vmt", "container GetString");
g_Assert.equal(g_Container.GetRequiredString(g_Table, 0), "materials/example.vmt", "container GetRequiredString");
g_Assert.equal(g_Container.AddString(g_Table, "materials/container.vmt") >= 0, true, "container AddString");
g_Assert.equal(CollectValues(g_Container).length, 2, "container iterator");
g_Assert.equal(g_StringTablesAPI.STRING_TABLES.GetDownloadables.Name, "downloadables", "shared container");
g_Assert.throws(() => g_Container.FindByID("0"), TypeError, "container IDs are strict integers");

const g_vecFailingDownloadPaths = ["materials/rollback.vmt", "materials/fail.vmt"];

g_Assert.throws(() => new g_StringTablesAPI.Downloadables({}), TypeError, "Downloadables values must be arrays");
g_Assert.throws(() => new g_StringTablesAPI.Downloadables([""]), TypeError, "Downloadables rejects empty initial paths");
g_Assert.throws(() => new g_StringTablesAPI.Downloadables(g_vecFailingDownloadPaths), /Unable to add/, "constructor rolls back failed ownership");
g_Assert.equal(ContainsValue(g_vecTrackedDownloadPaths, "materials/rollback.vmt"), false, "failed constructors untrack partial paths");

const g_nRollbackTableIndex = g_mapStringTableValues.get("downloadables").indexOf("materials/rollback.vmt");
if (g_nRollbackTableIndex >= 0) {
	g_mapStringTableValues.get("downloadables").splice(g_nRollbackTableIndex, 1);
}

g_Assert.equal(g_EventsManager.FireEvent("server_spawn"), true, "failed ownership restore event");

const g_vecDownloadPathsAfterFailedRestore = g_mapStringTableValues.get("downloadables");
let g_unServerSpawnListenerCount = 0;
for (const Entry of g_vecEventListeners) {
	if (Entry.EventName === "server_spawn") {
		g_unServerSpawnListenerCount += 1;
	}
}

const g_bFailedPathRestored = ContainsValue(g_vecDownloadPathsAfterFailedRestore, "materials/rollback.vmt");
g_Assert.equal(g_bFailedPathRestored, false, "failed constructors are not restored");
g_Assert.equal(g_unServerSpawnListenerCount, 1, "restore listener registers once");

const g_setOwnedDownloads = new g_StringTablesAPI.Downloadables();
g_Assert.equal(g_setOwnedDownloads.Add("materials/owned.vmt"), g_setOwnedDownloads, "Downloadables Add result");
g_Assert.equal(g_setOwnedDownloads.has("materials/owned.vmt"), true, "Downloadables has");
g_Assert.throws(() => g_setOwnedDownloads.Add(""), TypeError, "Downloadables Add rejects empty paths");
g_Assert.throws(() => g_setOwnedDownloads.Add("materials/fail.vmt"), /Unable to add/, "Downloadables rejects native Add failures");
g_Assert.equal(g_setOwnedDownloads.has("materials/fail.vmt"), false, "failed native adds are not locally owned");

const g_strAbsolutePath = g_Path.join(g_strGameRootPath, "materials", "absolute.vmt");
g_setOwnedDownloads.Add(g_strAbsolutePath);
g_Assert.equal(g_setOwnedDownloads.has("materials/absolute.vmt"), true, "game-root absolute paths normalize");

const g_setDirectoryDownloads = new g_StringTablesAPI.Downloadables();
g_Assert.equal(g_setDirectoryDownloads.AddDirectory("materials/sourcejs", true), 2, "recursive directory count");
g_Assert.equal(g_setDirectoryDownloads.has("materials/sourcejs/first.vmt"), true, "directory top-level file");
g_Assert.equal(g_setDirectoryDownloads.has("materials/sourcejs/nested/second.vtf"), true, "directory nested file");
g_setDirectoryDownloads.Add("materials/sourcejs-other/kept.vmt");
g_Assert.equal(g_setDirectoryDownloads.RemoveDirectory("materials/sourcejs"), 2, "directory removal count");
g_Assert.equal(g_setDirectoryDownloads.has("materials/sourcejs-other/kept.vmt"), true, "directory removal respects path boundaries");
g_Assert.throws(() => g_setDirectoryDownloads.RemoveDirectory(""), TypeError, "empty directory removal throws");

const g_setFirstSharedOwner = new g_StringTablesAPI.Downloadables(["materials/shared.vmt"]);
const g_setSecondSharedOwner = new g_StringTablesAPI.Downloadables(["materials/shared.vmt"]);

g_Assert.equal(g_setFirstSharedOwner.delete("materials/shared.vmt"), true, "first shared delete");
g_Assert.equal(ContainsValue(g_vecTrackedDownloadPaths, "materials/shared.vmt"), true, "other owner retains tracking");
g_Assert.equal(g_setSecondSharedOwner.delete("materials/shared.vmt"), true, "last shared delete");
g_Assert.equal(ContainsValue(g_vecTrackedDownloadPaths, "materials/shared.vmt"), false, "last owner untracks");
g_Assert.equal(g_setFirstSharedOwner.Dispose(), true, "first owner disposal");
g_Assert.equal(g_setFirstSharedOwner.Dispose(), false, "repeated disposal reports false");
g_Assert.equal(g_setSecondSharedOwner.Dispose(), true, "second owner disposal");

{
	const setDisposedDownloads = new g_StringTablesAPI.Downloadables();
	g_Assert.equal(setDisposedDownloads.Dispose(), true, "disposed-owner fixture unregisters");
	const vecTrackedPathsBefore = g_StringTablesAPI.GetTrackedDownloadables();
	const vecDisposedOperations = [
		{ Name: "Add", Operation: () => setDisposedDownloads.Add("materials/disposed-owner.vmt") },
		{ Name: "AddDirectory", Operation: () => setDisposedDownloads.AddDirectory("materials/sourcejs", false) },
		{ Name: "Restore", Operation: () => setDisposedDownloads.Restore() },
	];

	try {
		for (const DisposedOperation of vecDisposedOperations) {
			g_Assert.throws(DisposedOperation.Operation, /disposed/, `disposed owners reject ${DisposedOperation.Name}`);
		}

		g_Assert.equal(setDisposedDownloads.size, 0, "disposed-owner failures retain an empty set");
		g_Assert.deepEqual(g_StringTablesAPI.GetTrackedDownloadables(), vecTrackedPathsBefore, "disposed owners do not acquire native tracking");
		g_Assert.equal(setDisposedDownloads.Dispose(), false, "repeated disposal remains harmless");
	} finally {
		setDisposedDownloads.clear();
		setDisposedDownloads.Dispose();
	}
}

g_Assert.equal(g_StringTablesAPI.AddDownloadable("materials/restored.vmt") >= 0, true, "direct downloadable insertion index");
g_Assert.equal(g_StringTablesAPI.GetDownloadableIndex("materials/restored.vmt") >= 0, true, "GetDownloadableIndex");
g_Assert.equal(g_StringTablesAPI.HasDownloadable("materials/restored.vmt"), true, "HasDownloadable");
g_Assert.equal(ContainsValue(g_StringTablesAPI.GetDownloadablesList(), "materials/restored.vmt"), true, "GetDownloadablesList");
g_Assert.equal(ContainsValue(g_StringTablesAPI.GetTrackedDownloadables(), "materials/restored.vmt"), true, "GetTrackedDownloadables");
g_Assert.equal(g_StringTablesAPI.GetDownloadablesTable().Address, 0x1000n, "GetDownloadablesTable");
g_mapStringTableValues.set("downloadables", []);
g_Assert.equal(g_EventsManager.FireEvent("server_spawn"), true, "server_spawn event");

const g_vecRestoredDownloadPaths = g_mapStringTableValues.get("downloadables");
g_Assert.equal(ContainsValue(g_vecRestoredDownloadPaths, "materials/restored.vmt"), true, "native tracked paths restore");
g_Assert.equal(ContainsValue(g_vecRestoredDownloadPaths, "materials/owned.vmt"), true, "owned paths restore");
g_Assert.equal(g_setOwnedDownloads.Restore(), g_setOwnedDownloads, "manual owner Restore");
g_Assert.equal(g_StringTablesAPI.RestoreDownloadables() >= 1, true, "manual native restore count");
g_Assert.equal(g_StringTablesAPI.UntrackDownloadable("materials/restored.vmt"), true, "UntrackDownloadable");
g_Assert.equal(g_StringTablesAPI.UntrackDownloadable("materials/restored.vmt"), false, "UntrackDownloadable missing path");
g_Assert.equal(g_StringTablesAPI.UntrackDownloadableDirectory("materials/sourcejs-other") >= 1, true, "UntrackDownloadableDirectory");

g_Assert.equal(g_setOwnedDownloads.Dispose(), true, "owned downloads Dispose");
g_Assert.equal(g_setDirectoryDownloads.Dispose(), true, "directory downloads Dispose");
g_Assert.deepEqual(g_vecTrackedDownloadPaths, [], "direct tests release native tracking");

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecCodeBlocks = [];
for (const vecMatch of g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecCodeBlocks.push(vecMatch[1]);
}

g_Assert.equal(g_vecCodeBlocks.length, 8, "all stringtables documentation JavaScript blocks are present");

const g_BlockLoadState = CaptureRuntimeState(g_StringTablesAPI);
const g_DocumentationWorkflows = {};
const g_vecDocumentedExportNames = ExtractDocumentationImports(g_vecCodeBlocks[0]).sort();
const g_vecActualExportNames = Object.keys(g_StringTablesAPI).sort();
const g_WholeModuleImportPattern = /const\s+[A-Za-z_$][\w$]*\s*=\s*require\("stringtables"\)/;

g_Assert.deepEqual(g_vecDocumentedExportNames, g_vecActualExportNames, "documentation imports every exact export");

for (let unIndex = 0; unIndex < g_vecCodeBlocks.length; unIndex += 1) {
	const WorkflowExports = ExecuteCodeBlock(g_vecCodeBlocks[unIndex], unIndex, g_StringTablesAPI);
	if (typeof WorkflowExports.ExerciseSharedDownloadOwnership === "function") {
		AssertSharedOwnerWorkflowFailures(g_vecCodeBlocks[unIndex], unIndex);
	}

	for (const strName of Object.keys(WorkflowExports)) {
		g_Assert.equal(Object.hasOwn(g_DocumentationWorkflows, strName), false, `documentation workflow is unique: ${strName}`);
		g_DocumentationWorkflows[strName] = WorkflowExports[strName];
	}
}

const g_StateAfterBlockLoad = CaptureRuntimeState(g_StringTablesAPI);
const g_vecDocumentedWorkflowNames = Object.keys(g_DocumentationWorkflows).sort();

g_Assert.deepEqual(g_StateAfterBlockLoad, g_BlockLoadState, "documentation blocks perform no work while loading");
g_Assert.deepEqual(g_vecDocumentedWorkflowNames, g_vecExpectedDocumentationWorkflows, "documentation exports every workflow");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by/, "stringtables documentation is hand-maintained");
g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "documentation does not use console-only output");
g_Assert.doesNotMatch(g_strDocumentation, g_WholeModuleImportPattern, "documentation uses direct destructured imports");
g_Assert.doesNotMatch(g_strDocumentation, /[^\x00-\x7F]/, "documentation stays ASCII");
g_Assert.doesNotMatch(g_strDocumentation, /[ \t]+$/m, "documentation has no trailing whitespace");
g_Assert.doesNotMatch(g_strDocumentation, /\r?\n\r?\n\r?\n/, "documentation has no consecutive blank lines");

for (const strCodeBlock of g_vecCodeBlocks) {
	for (const strLine of strCodeBlock.split(/\r?\n/)) {
		g_Assert.doesNotMatch(strLine, /^ +\S/, "documentation JavaScript indentation uses tabs");
	}
}

VerifyContentsAnchors(g_strDocumentation);
VerifyDocumentationLinks(g_strDocumentation);

const g_RootResult = g_DocumentationWorkflows.InspectAndAddString("soundprecache", "sourcejs/documentation/root.wav");
g_Assert.equal(g_RootResult.Index >= 0, true, "root workflow adds a string");
g_Assert.equal(g_RootResult.RequiredValue, "sourcejs/documentation/root.wav", "root workflow required value");
g_Assert.equal(g_RootResult.Value, "sourcejs/documentation/root.wav", "root workflow optional value");
g_Assert.equal(g_RootResult.Table.Name, "soundprecache", "root workflow returns the live descriptor");
g_Assert.deepEqual(ToPlainValue(g_RootResult.TableNames), ["downloadables", "soundprecache"], "root workflow lists table names");

const g_WrappedResult = g_DocumentationWorkflows.InspectWrappedTable("downloadables", "materials/sourcejs/documentation/wrapped.vmt");
const g_vecWrappedKeys = ToPlainValue(g_WrappedResult.Keys);
const g_vecWrappedValues = ToPlainValue(g_WrappedResult.Values);
const g_vecWrappedIteratedValues = ToPlainValue(g_WrappedResult.IteratedValues);
const g_vecWrappedEntries = ToPlainValue(g_WrappedResult.Entries);
let g_bWrappedEntryFound = false;
for (const [unIndex, strValue] of g_vecWrappedEntries) {
	if ((unIndex === g_WrappedResult.Index) && (strValue === g_WrappedResult.Value)) {
		g_bWrappedEntryFound = true;
		break;
	}
}

g_Assert.equal(g_WrappedResult.Index >= 0, true, "wrapper workflow adds a string");
g_Assert.equal(g_WrappedResult.HasValue, true, "wrapper workflow has");
g_Assert.equal(g_WrappedResult.IndexOfValue, g_WrappedResult.Index, "wrapper workflow indexOf");
g_Assert.equal(g_WrappedResult.Valid, true, "wrapper workflow validity");
g_Assert.equal(g_WrappedResult.Address, g_WrappedResult.SharedAddress, "wrapper workflow shares descriptors");
g_Assert.equal(g_WrappedResult.Value, "materials/sourcejs/documentation/wrapped.vmt", "wrapper workflow get");
g_Assert.equal(ContainsValue(g_vecWrappedKeys, g_WrappedResult.Index), true, "wrapper workflow keys");
g_Assert.equal(ContainsValue(g_vecWrappedValues, g_WrappedResult.Value), true, "wrapper workflow values");
g_Assert.equal(ContainsValue(g_vecWrappedIteratedValues, g_WrappedResult.Value), true, "wrapper workflow iterator");
g_Assert.equal(g_bWrappedEntryFound, true, "wrapper workflow entries");

const g_ContainerResult = g_DocumentationWorkflows.InspectStringTableContainer("materials/sourcejs/documentation/container.vmt");
g_Assert.equal(g_ContainerResult.Index >= 0, true, "container workflow adds a string");
g_Assert.equal(g_ContainerResult.Downloadables.Name, "downloadables", "container workflow GetDownloadables");
g_Assert.equal(g_ContainerResult.FoundByID.ID, g_ContainerResult.Downloadables.ID, "container workflow FindByID");
g_Assert.equal(g_ContainerResult.HasDownloadables, true, "container workflow Has");
g_Assert.equal(g_ContainerResult.RequiredValue, "materials/sourcejs/documentation/container.vmt", "container workflow required value");
g_Assert.equal(g_ContainerResult.Value, g_ContainerResult.RequiredValue, "container workflow optional value");
g_Assert.equal(g_ContainerResult.Length, 2, "container workflow length");
g_Assert.equal(ContainsValue(ToPlainValue(g_ContainerResult.Names), "downloadables"), true, "container workflow names");
g_Assert.equal(g_ContainerResult.ListedTables.length, 2, "container workflow list");
g_Assert.equal(g_ContainerResult.IteratedTables.length, 2, "container workflow iterator");
g_Assert.equal(g_ContainerResult.SharedDownloads.Name, "downloadables", "container workflow shared facade");

const g_strDirectDocumentationPath = g_Path.join(g_strGameRootPath, "materials", "sourcejs", "documentation", "direct.vmt");
const g_FileController = g_DocumentationWorkflows.TrackDownloadFile(g_strDirectDocumentationPath);

try {
	const FileInspection = g_FileController.Inspect();

	g_Assert.equal(g_FileController.Index >= 0, true, "direct file workflow index");
	g_Assert.equal(FileInspection.HasPath, true, "direct file workflow has");
	g_Assert.equal(FileInspection.Index, g_FileController.Index, "direct file workflow indexOf");
	g_Assert.equal(FileInspection.Listed, true, "direct file workflow list");
	g_Assert.equal(FileInspection.Path, "materials/sourcejs/documentation/direct.vmt", "direct file workflow normalization");
	g_Assert.equal(FileInspection.Table.Name, "downloadables", "direct file workflow table");
	g_Assert.equal(FileInspection.Tracked, true, "direct file workflow tracking");
	g_Assert.equal(g_FileController.Restore() >= 1, true, "direct file workflow Restore");
} finally {
	g_Assert.equal(g_FileController.Dispose(), true, "direct file workflow disposal");
}

const g_vecExpectedDirectoryPaths = ["materials/sourcejs/documentation/directory/first.vmt"];
const g_DirectoryController = g_DocumentationWorkflows.TrackDownloadDirectory("materials/sourcejs/documentation/directory", false);

try {
	const vecDirectoryPaths = ToPlainValue(g_DirectoryController.Paths);
	g_Assert.deepEqual(vecDirectoryPaths, g_vecExpectedDirectoryPaths, "direct directory workflow paths");
} finally {
	g_Assert.equal(g_DirectoryController.Dispose(), 1, "direct directory workflow disposal");
}

const g_OwnerController = g_DocumentationWorkflows.CreateDownloadOwner(["materials/sourcejs/documentation/owner-initial.vmt"]);
const g_strOwnerDirectoryPath = "materials/sourcejs/documentation/owner-directory";

try {
	g_Assert.equal(g_OwnerController.Add("materials/sourcejs/documentation/owner-added.vmt"), true, "owner workflow Add");
	g_Assert.equal(g_OwnerController.AddDirectory(g_strOwnerDirectoryPath, false), 1, "owner workflow AddDirectory");
	g_Assert.equal(g_OwnerController.Remove("materials/sourcejs/documentation/owner-added.vmt"), true, "owner workflow delete");
	g_Assert.equal(g_OwnerController.RemoveDirectory(g_strOwnerDirectoryPath), 1, "owner workflow RemoveDirectory");
	g_Assert.equal(g_OwnerController.Restore(), g_OwnerController.Downloads, "owner workflow Restore");
	g_Assert.equal(g_OwnerController.Clear(), undefined, "owner workflow Clear");
	g_Assert.equal(g_OwnerController.Downloads.size, 0, "owner workflow clear releases local ownership");
} finally {
	g_Assert.equal(g_OwnerController.Dispose(), true, "owner workflow disposal");
}

g_Assert.equal(g_OwnerController.Dispose(), false, "owner workflow repeated disposal");

const g_strSharedOwnershipPath = g_Path.join(g_strGameRootPath, "materials", "sourcejs", "documentation", "shared.vmt");
const g_SharedResult = ToPlainValue(g_DocumentationWorkflows.ExerciseSharedDownloadOwnership(g_strSharedOwnershipPath));
g_Assert.deepEqual(g_SharedResult, {
	FirstRemoved: true,
	TrackedAfterFirst: true,
	SecondStillOwns: true,
	Restored: true,
	SecondRemoved: true,
	TrackedAfterSecond: false,
}, "shared ownership workflow");

const g_strSharedSingletonPath = "sound\\sourcejs\\documentation\\shared.wav";
const g_strNormalizedSharedSingletonPath = "sound/sourcejs/documentation/shared.wav";
const g_SharedController = g_DocumentationWorkflows.CreateSharedDownloadController(g_strSharedSingletonPath);

try {
	g_Assert.equal(g_SharedController.Inspect(), true, "shared singleton workflow inspection");

	const SharedRestoreResult = ToPlainValue(g_SharedController.Restore());
	g_Assert.equal(SharedRestoreResult.NativeCount >= 1, true, "shared singleton native restore");
	g_Assert.equal(SharedRestoreResult.OwnerRestored, true, "shared singleton owner restore");
} finally {
	g_Assert.equal(g_SharedController.Dispose(), true, "shared singleton workflow disposal");
}

g_Assert.equal(g_SharedController.Dispose(), false, "shared singleton repeated disposal");

const g_bSharedSingletonPathOwned = g_StringTablesAPI.DOWNLOADABLES.has(g_strNormalizedSharedSingletonPath);
g_Assert.equal(g_bSharedSingletonPathOwned, false, "shared singleton releases exact ownership");
g_Assert.deepEqual(g_vecTrackedDownloadPaths, [], "documentation workflows release native tracking");
g_Assert.equal(g_StringTablesAPI.DOWNLOADABLES.size, 0, "documentation workflows leave the shared owner empty");

let g_unDocumentationRestoreListenerCount = 0;
for (const Entry of g_vecEventListeners) {
	if (Entry.EventName === "server_spawn") {
		g_unDocumentationRestoreListenerCount += 1;
	}
}

const g_vecDocumentedTableValues = g_mapStringTableValues.get("downloadables");
const g_bDocumentedTableValuePresent = ContainsValue(g_vecDocumentedTableValues, "materials/sourcejs/documentation/wrapped.vmt");

g_Assert.equal(g_unDocumentationRestoreListenerCount, 1, "documentation preserves one restore listener");
g_Assert.equal(g_bDocumentedTableValuePresent, true, "documented table additions remain in the current table");

ReleaseStringTablesFixture();

const g_vecMissingRuntimeArguments = ["-e", `require(${JSON.stringify(g_strStringTablesPath)});`];
const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntimeOptions = {
	encoding: "utf8",
	env: {
		...process.env,
		NODE_PATH: g_strPackageRootPath,
	},
	timeout: g_unMissingRuntimeTimeoutMilliseconds,
};
const g_MissingRuntime = g_ChildProcess.spawnSync(process.execPath, g_vecMissingRuntimeArguments, g_MissingRuntimeOptions);
g_Assert.equal(g_MissingRuntime.error, undefined, "missing-runtime child starts and completes");
g_Assert.equal(g_MissingRuntime.status, 1, "stringtables requires the native runtime");
g_Assert.match(g_MissingRuntime.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_stringtables");
