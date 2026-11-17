#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "studio-cache.md");
const g_strPackagePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "studio", "cache.js");
const g_strInternalRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_strModelPath = "models/error.mdl";
const g_hModelHandle = 12;
const g_hInvalidModelHandle = 0xFFFF;
const g_unModelHeaderAddress = 0xFEDCBA9876543210n;
const g_vecExpectedDocumentationWorkflows = [
	"CreateCacheDataTypeClassifier",
	"CreateCachedModel",
	"CreateCachedModelHeader",
	"WithAddedCacheReference",
];

let g_unReferenceCount = 0;

function RequireHandle(hModelHandle) {
	if (!Number.isInteger(hModelHandle) || (hModelHandle < 0) || (hModelHandle >= g_hInvalidModelHandle)) {
		throw new TypeError("ModelHandle must be a valid model handle");
	}

	return hModelHandle;
}

function RequirePath(strPathValue) {
	if ((typeof strPathValue !== "string") || (strPathValue.length === 0) || strPathValue.includes("\0")) {
		throw new TypeError("Path must be a non-empty string without embedded NUL.");
	}

	return strPathValue;
}

const g_ModelHeader = { Name: "error.mdl", Address: g_unModelHeaderAddress };

const g_ModelCacheDataType = {
	AnimationBlock: 3,
	DecodedAnimationBlock: 6,
	PhysicsCollision: 2,
	StudioHardwareData: 1,
	StudioHeader: 0,
	Vertices: 5,
	VirtualModel: 4,
};

function ResolveModelHandle(strPathName) {
	if (strPathName === g_strModelPath) {
		return g_hModelHandle;
	}

	return g_hInvalidModelHandle;
}

function CreateModelRecord(hModelHandle, bIncludeReferenceCount) {
	const Model = {
		Handle: hModelHandle,

		IsValid() {
			const hReceiverHandle = this.Handle;
			if (!Number.isInteger(hReceiverHandle) || (hReceiverHandle < 0) || (hReceiverHandle > g_hInvalidModelHandle)) {
				throw new TypeError("ModelHandle must be in the selected SDK range");
			}

			return hReceiverHandle !== g_hInvalidModelHandle;
		},

		GetName() {
			return g_NativeCache.GetModelName(this.Handle);
		},
	};

	if (bIncludeReferenceCount) {
		Model.GetReferenceCount = function GetModelReferenceCount() {
			return g_NativeCache.GetReferenceCount(this.Handle);
		};
	}

	return Model;
}

const g_NativeCache = {
	INVALID_MODEL_HANDLE: g_hInvalidModelHandle,
	ModelCacheDataType: g_ModelCacheDataType,

	AddReference(hModelHandle) {
		RequireHandle(hModelHandle);

		g_unReferenceCount += 1;

		return g_unReferenceCount;
	},

	FindModel(strModelPath) {
		const strPathName = RequirePath(strModelPath);
		const hModelHandle = ResolveModelHandle(strPathName);
		if (hModelHandle !== g_hInvalidModelHandle) {
			g_unReferenceCount += 1;
		}

		return CreateModelRecord(hModelHandle, true);
	},

	FindModelHandle(strModelPath) {
		const strPathName = RequirePath(strModelPath);
		const hModelHandle = ResolveModelHandle(strPathName);
		if (hModelHandle !== g_hInvalidModelHandle) {
			g_unReferenceCount += 1;
		}

		return hModelHandle;
	},

	GetModelHeader(hModelHandle) {
		RequireHandle(hModelHandle);

		if (hModelHandle === g_hModelHandle) {
			return g_ModelHeader;
		}

		return null;
	},

	GetModelHeaderAddress(hModelHandle) {
		RequireHandle(hModelHandle);

		if (hModelHandle === g_hModelHandle) {
			return g_unModelHeaderAddress;
		}

		return 0n;
	},

	GetModelName(hModelHandle) {
		RequireHandle(hModelHandle);

		if (hModelHandle !== g_hModelHandle) {
			throw new Error("ModelName is unavailable");
		}

		return g_strModelPath;
	},

	GetReferenceCount(hModelHandle) {
		RequireHandle(hModelHandle);

		return g_unReferenceCount;
	},

	Release(hModelHandle) {
		RequireHandle(hModelHandle);

		if (g_unReferenceCount <= 0) {
			throw new Error("Model reference count underflow");
		}

		g_unReferenceCount -= 1;

		return g_unReferenceCount;
	},

	RequireModelHeader(hModelHandle) {
		const Header = g_NativeCache.GetModelHeader(hModelHandle);
		if (Header === null) {
			throw new Error("Model header is unavailable");
		}

		return Header;
	},
};

function CreateOldConsoleCache() {
	const OldCache = { ...g_NativeCache };
	const OldDataTypes = { ...g_ModelCacheDataType };

	delete OldCache.GetReferenceCount;
	delete OldDataTypes.DecodedAnimationBlock;
	OldCache.ModelCacheDataType = OldDataTypes;
	OldCache.FindModel = (strPathValue) => {
		const Model = g_NativeCache.FindModel(strPathValue);
		delete Model.GetReferenceCount;

		return Model;
	};

	return OldCache;
}

function ExecuteCodeBlock(strSource, unIndex, CacheAPI) {
	const unCompilationTimeoutMilliseconds = 1000;

	const strDocumentationBlockPath = `${g_strDocumentationPath}:example-${unIndex + 1}.js`;
	const ModuleRecord = new g_Module(strDocumentationBlockPath, module);
	ModuleRecord.filename = strDocumentationBlockPath;
	ModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
	ModuleRecord.require = function RequireDocumentationModule(strIdentifier) {
		if (strIdentifier === "studio/cache") {
			return CacheAPI;
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
	const vecImportMatch = strSource.match(/const\s*\{([\s\S]*?)\}\s*=\s*require\("studio\/cache"\);/);
	g_Assert.ok(vecImportMatch, "documentation starts with a destructured studio/cache import");

	const vecImportNames = [];
	const vecRawNames = vecImportMatch[1].split(",");
	for (const strRawName of vecRawNames) {
		const strName = strRawName.split(":", 1)[0].trim();
		if (strName.length > 0) {
			vecImportNames.push(strName);
		}
	}

	return vecImportNames;
}

function NormalizeHeadingAnchor(strHeading) {
	return strHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function ToPlainValue(Value) {
	if (Array.isArray(Value)) {
		return Array.from(Value, ToPlainValue);
	}

	if (Value && (typeof Value === "object")) {
		return Object.fromEntries(Object.entries(Value).map(([strName, Entry]) => [strName, ToPlainValue(Entry)]));
	}

	return Value;
}

function AssertCacheWorkflowFailures(strSource, unBlockIndex, strWorkflowName) {
	let unScenarioCount = 0;
	const vecThrownValues = [undefined, null, false, 0, "", Symbol("CacheFailure"), new Error("Cache failure")];
	const bAdditionalReferences = strWorkflowName === "WithAddedCacheReference";

	const CaptureOutcome = Callback => {
		try {
			return { Thrown: false, Result: Callback() };
		} catch (ExceptionValue) {
			return { Thrown: true, Error: ExceptionValue };
		}
	};

	const RunScenario = Options => {
		let unReferenceCount = 0;
		let unReleaseCallCount = 0;
		let unLookupCallCount = 0;
		let unCallbackCallCount = 0;
		let Controller = undefined;
		const vecReleaseErrors = [];
		const Header = { Address: 0xFEDCBA9876543210n, Name: "error.mdl" };

		const FailOperation = strOperationName => {
			if (Options.OperationName === strOperationName) {
				throw Options.OperationError;
			}
		};

		const CacheAPI = {
			INVALID_MODEL_HANDLE: g_hInvalidModelHandle,

			FindModel() {
				unLookupCallCount += 1;
				unReferenceCount += 1;

				return {
					Handle: g_hModelHandle,

					IsValid() {
						FailOperation("IsValid");

						return true;
					},

					GetName() {
						return g_strModelPath;
					},
				};
			},

			FindModelHandle() {
				unLookupCallCount += 1;
				unReferenceCount += 1;

				return g_hModelHandle;
			},

			GetModelHeader() {
				FailOperation("GetModelHeader");

				return Header;
			},

			GetModelHeaderAddress() {
				FailOperation("GetModelHeaderAddress");

				return Header.Address;
			},

			RequireModelHeader() {
				FailOperation("RequireModelHeader");

				return Header;
			},

			GetModelName() {
				return g_strModelPath;
			},

			AddReference() {
				if ((Options.OperationName !== "AddReference") || Options.AddAfterMutation) {
					unReferenceCount += 1;
				}

				FailOperation("AddReference");

				return unReferenceCount;
			},

			GetReferenceCount() {
				FailOperation("GetReferenceCount");

				return unReferenceCount;
			},

			Release(hModelHandle) {
				g_Assert.equal(hModelHandle, g_hModelHandle, "cleanup uses the originally acquired handle");
				unReleaseCallCount += 1;

				if (Controller) {
					g_Assert.throws(() => Controller.Inspect(), /disposed/, "a controller is disarmed before native Release can reenter");
				}

				const bFailRelease = (Options.ReleaseFailureMask & (0x01 << (unReleaseCallCount - 1))) !== 0;
				if (!bFailRelease || Options.ReleaseAfterMutation) {
					g_Assert.equal(unReferenceCount > 0, true, "cleanup must not over-release the fake cache");
					unReferenceCount -= 1;
				}

				if (bFailRelease) {
					const CleanupError = (unReleaseCallCount === 1) ? Options.FirstCleanupError : Options.SecondCleanupError;
					vecReleaseErrors.push(CleanupError);
					throw CleanupError;
				}

				return unReferenceCount;
			},
		};

		if (Options.MissingReferenceCount) {
			CacheAPI.GetReferenceCount = Options.MissingReferenceCount.Value;
		}

		const Workflows = ExecuteCodeBlock(strSource, unBlockIndex, CacheAPI);
		const Callback = () => {
			unCallbackCallCount += 1;
			FailOperation("Callback");

			return Options.CallbackResult;
		};

		let Outcome = CaptureOutcome(() => Workflows[strWorkflowName](g_strModelPath, Options.InvalidCallback ? Options.InvalidCallback.Value : Callback));
		if (Options.OperationName === "Dispose") {
			g_Assert.equal(Outcome.Thrown, false, "controller setup succeeds before injected cleanup failure");
			Controller = Outcome.Result;
			Outcome = CaptureOutcome(() => Controller.Dispose());
			g_Assert.equal(Controller.Dispose(), false, "failed Release is never blindly replayed");
			g_Assert.throws(() => Controller.Inspect(), /disposed/);
		}

		if (Options.MissingReferenceCount || Options.InvalidCallback) {
			g_Assert.equal(Outcome.Thrown, true, "required capabilities and callbacks are validated");
			g_Assert.equal(unLookupCallCount, 0, "preflight failure acquires no references");
			g_Assert.equal(unReleaseCallCount, 0);
			unScenarioCount += 1;
			return;
		}

		const bAddOutcomeUnknown = Options.OperationName === "AddReference";
		const unExpectedReleaseCalls = (bAdditionalReferences && !bAddOutcomeUnknown) ? 2 : 1;
		g_Assert.equal(unReleaseCallCount, unExpectedReleaseCalls, "every confirmed reference gets one cleanup attempt");

		const bOperationFailed = (Options.OperationName !== "None") && (Options.OperationName !== "Dispose");
		if ((vecReleaseErrors.length > 0) || bAddOutcomeUnknown) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.equal(Outcome.Error && Outcome.Error.name, "AggregateError", "failure metadata does not discard primitive exceptions");
			const vecExpectedErrors = bOperationFailed ? [Options.OperationError, ...vecReleaseErrors] : vecReleaseErrors;
			g_Assert.deepEqual(Array.from(Outcome.Error.errors), vecExpectedErrors, "operation and cleanup failures preserve identity and order");
			g_Assert.equal(Outcome.Error.ModelHandle, g_hModelHandle, "ambiguous native outcomes retain the original handle for investigation");
			g_Assert.equal(Outcome.Error.UnconfirmedReleaseCount, vecReleaseErrors.length);
			g_Assert.equal(Boolean(Outcome.Error.AddReferenceOutcomeUnknown), bAddOutcomeUnknown);

		} else if (bOperationFailed) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.equal(Outcome.Error, Options.OperationError, "successful cleanup retains the exact original exception");

		} else {
			g_Assert.equal(Outcome.Thrown, false);
			g_Assert.equal(Outcome.Result, Options.CallbackResult, "successful cleanup preserves the callback result");
		}

		if (bAdditionalReferences && (Options.OperationName !== "None")) {
			g_Assert.equal(unCallbackCallCount, (Options.OperationName === "Callback") ? 1 : 0, "pre-callback failures do not invoke user code");
		}

		unScenarioCount += 1;
	};

	const vecOperationNames = bAdditionalReferences ? ["Callback", "GetReferenceCount", "AddReference"] : ((strWorkflowName === "CreateCachedModel") ? ["IsValid"] : ["GetModelHeader", "GetModelHeaderAddress", "RequireModelHeader"]);
	for (const strOperationName of vecOperationNames) {
		for (const OperationError of vecThrownValues) {
			const vecReleaseMasks = (bAdditionalReferences && (strOperationName !== "AddReference")) ? [0x00, 0x01, 0x02, 0x03] : [0x00, 0x01];
			for (const unReleaseFailureMask of vecReleaseMasks) {
				for (const bReleaseAfterMutation of [false, true]) {
					for (const bAddAfterMutation of (strOperationName === "AddReference") ? [false, true] : [false]) {
						RunScenario({ OperationName: strOperationName, OperationError, ReleaseFailureMask: unReleaseFailureMask, ReleaseAfterMutation: bReleaseAfterMutation, AddAfterMutation: bAddAfterMutation, FirstCleanupError: false, SecondCleanupError: null });
					}
				}
			}
		}
	}

	if (bAdditionalReferences) {
		for (const CallbackResult of vecThrownValues) {
			for (const unReleaseFailureMask of [0x00, 0x01, 0x02, 0x03]) {
				RunScenario({ OperationName: "None", CallbackResult, ReleaseFailureMask: unReleaseFailureMask, FirstCleanupError: CallbackResult, SecondCleanupError: Symbol("SecondCleanupFailure") });
			}
		}

		for (const Value of [undefined, null, 0]) {
			RunScenario({ MissingReferenceCount: { Value } });
		}

		for (const Value of [undefined, null, false, 0, "", 1n, {}, []]) {
			RunScenario({ InvalidCallback: { Value } });
		}

	} else {
		for (const CleanupError of vecThrownValues) {
			for (const bReleaseAfterMutation of [false, true]) {
				RunScenario({ OperationName: "Dispose", ReleaseFailureMask: 0x01, ReleaseAfterMutation: bReleaseAfterMutation, FirstCleanupError: CleanupError });
			}
		}
	}

	const unExpectedScenarios = bAdditionalReferences ? 207 : ((strWorkflowName === "CreateCachedModel") ? 42 : 98);
	g_Assert.equal(unScenarioCount, unExpectedScenarios, `${strWorkflowName} failure and ownership scenarios all ran`);
}

function VerifyContentsAnchors(strDocumentation) {
	const vecContentsMatch = strDocumentation.match(/^## Contents\r?\n\r?\n([\s\S]*?)(?=\r?\n\r?\n## )/m);
	g_Assert.ok(vecContentsMatch, "documentation Contents section");

	const vecLinkedAnchors = [];
	for (const vecMatch of vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecLinkedAnchors.push(vecMatch[1]);
	}

	const vecHeadingAnchors = [];
	for (const vecMatch of strDocumentation.matchAll(/^## (?!Contents$)(.+)$/gm)) {
		vecHeadingAnchors.push(NormalizeHeadingAnchor(vecMatch[1]));
	}

	g_Assert.deepEqual(vecLinkedAnchors, vecHeadingAnchors, "Contents links every level-two section in order");
}

function VerifyDocumentationLinks(strDocumentation) {
	const strDocumentationDirectory = g_Path.dirname(g_strDocumentationPath);
	for (const vecMatch of strDocumentation.matchAll(/\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/g)) {
		const [strRelativePath, strFragment] = vecMatch[1].split("#", 2);
		const strTargetPath = g_Path.resolve(strDocumentationDirectory, strRelativePath);
		g_Assert.equal(g_FileSystem.existsSync(strTargetPath), true, `documentation link exists: ${vecMatch[1]}`);

		if (strFragment) {
			const strTargetDocumentation = g_FileSystem.readFileSync(strTargetPath, "utf8");
			let bAnchorExists = false;

			for (const vecHeadingMatch of strTargetDocumentation.matchAll(/^#{1,6} (.+)$/gm)) {
				if (NormalizeHeadingAnchor(vecHeadingMatch[1]) === strFragment) {
					bAnchorExists = true;
					break;
				}
			}

			g_Assert.equal(bAnchorExists, true, `documentation anchor exists: ${vecMatch[1]}`);
		}
	}
}

function VerifySynchronousCacheCallbackLifetime(WithAddedReference) {
	g_Assert.equal(g_unReferenceCount, 0, "the callback lifetime scenario starts without outstanding references");

	let ResolvePending = null;
	let unCallbackCount = 0;
	const Pending = new Promise(Resolve => {
		ResolvePending = Resolve;
	});
	const ReturnedPromise = WithAddedReference(g_strModelPath, ReferenceInformation => {
		unCallbackCount += 1;
		g_Assert.equal(g_unReferenceCount, 2, "both confirmed references remain held during the synchronous callback");
		g_Assert.equal(ReferenceInformation.Handle, g_hModelHandle, "the callback receives the borrowed handle");

		return Pending;
	});
	g_Assert.equal(ReturnedPromise, Pending, "the pending Promise is forwarded without wrapping or awaiting");
	g_Assert.equal(unCallbackCount, 1, "the callback is invoked exactly once");
	g_Assert.equal(g_unReferenceCount, 0, "both references are released before the pending Promise settles");

	ResolvePending("Completed");

	let unThenReads = 0;
	const DeferredValue = {
		get then() {
			unThenReads += 1;
			throw new Error("The synchronous callback helper must not inspect thenables.");
		},
	};

	const ReturnedValue = WithAddedReference(g_strModelPath, () => DeferredValue);
	g_Assert.equal(ReturnedValue, DeferredValue, "a thenable is forwarded by identity");
	g_Assert.equal(unThenReads, 0, "the callback result's then getter is not read");
	g_Assert.equal(g_unReferenceCount, 0, "thenable forwarding also releases both confirmed references");
}

const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_OriginalModuleLoad = g_LoaderDescriptor?.value;
const g_mapPackageCacheDescriptors = new Map();
let g_bSourceJSOwned = false;
let g_bLoaderOwned = false;
let g_bPackageCacheOwned = false;

function RestoreFixtureProperty(Target, strKey, Descriptor) {
	if (Descriptor) {
		Object.defineProperty(Target, strKey, Descriptor);
		return;
	}

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned studio/cache fixture property must be removable: " + strKey);
}

function ReleaseStudioCacheFixture() {
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
		throw new AggregateError(vecFailures, "Studio/cache fixture restoration failed.");
	}

	process.removeListener("exit", ReleaseStudioCacheFixture);
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(g_SourceJSDescriptor || Object.isExtensible(globalThis), "Studio/cache runtime fixture must support installation.");
g_Assert.ok(Object.isExtensible(require.cache), "Studio/cache package cache must support exact restoration.");
g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Studio/cache runtime fixture must support exact restoration.");
g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_OriginalModuleLoad === "function"), "Studio/cache loader must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed studio/cache cache entries must support exact restoration.");
}

// Exit cleanup also restores borrowed state after synchronous assertion failures.
process.once("exit", ReleaseStudioCacheFixture);
g_bPackageCacheOwned = true;

for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
	RestoreFixtureProperty(require.cache, strModulePath, undefined);
}

function LoadStudioCachePackage() {
	Object.defineProperty(g_Module, "_load", {
		...g_LoaderDescriptor,
		writable: true,
		value: function LoadStudioCacheModule(strRequest, Parent, bIsMain) {
			if (strRequest === "internal/runtime") {
				return g_OriginalModuleLoad.call(this, g_strInternalRuntimePath, Parent, bIsMain);
			}

			return g_OriginalModuleLoad.call(this, strRequest, Parent, bIsMain);
		},
	});
	g_bLoaderOwned = true;

	try {
		RestoreFixtureProperty(require.cache, g_strPackagePath, undefined);

		return require(g_strPackagePath);
	} finally {
		RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
		g_bLoaderOwned = false;
	}
}

Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "studio/cache": g_NativeCache } });
g_bSourceJSOwned = true;

const g_CacheAPI = LoadStudioCachePackage();
g_Assert.equal(g_CacheAPI, g_NativeCache, "studio/cache preserves native object identity");
g_Assert.deepEqual(Object.keys(g_CacheAPI).sort(), [
	"INVALID_MODEL_HANDLE",
	"ModelCacheDataType",
	"AddReference",
	"FindModel",
	"FindModelHandle",
	"GetModelHeader",
	"GetModelHeaderAddress",
	"GetModelName",
	"GetReferenceCount",
	"Release",
	"RequireModelHeader",
].sort(), "exact full studio/cache exports");
g_Assert.deepEqual(Object.keys(g_CacheAPI.ModelCacheDataType).sort(), [
	"AnimationBlock",
	"DecodedAnimationBlock",
	"PhysicsCollision",
	"StudioHardwareData",
	"StudioHeader",
	"Vertices",
	"VirtualModel",
], "full model-cache data types");

const g_Model = g_CacheAPI.FindModel(g_strModelPath);
const g_hFoundModelHandle = g_CacheAPI.FindModelHandle(g_strModelPath);
g_Assert.equal(g_Model.Handle, g_hModelHandle, "model handle record");
g_Assert.equal(g_Model.IsValid(), true, "valid model record");
g_Assert.equal(g_Model.GetName(), g_strModelPath, "model record name");
g_Assert.equal(g_Model.GetReferenceCount(), 2, "model record reference count");
g_Model.Handle = g_hInvalidModelHandle;
g_Assert.equal(g_Model.IsValid(), false, "record methods read the current receiver Handle, not a captured reference");
g_Assert.throws(() => g_Model.GetName(), /valid model handle/, "overwriting metadata does not create a valid cache reference");
g_Model.Handle = g_hModelHandle;
g_Assert.equal(Reflect.apply(g_Model.GetName, { Handle: g_hModelHandle }, []), g_strModelPath, "model methods preserve native receiver-based handle lookup");

for (const strMethodName of ["IsValid", "GetName", "GetReferenceCount"]) {
	let unHandleReadCount = 0;
	const Receiver = {
		get Handle() {
			unHandleReadCount += 1;

			return g_hModelHandle;
		},
	};

	Reflect.apply(g_Model[strMethodName], Receiver, []);
	g_Assert.equal(unHandleReadCount, 1, "record methods consume one receiver-property read");
}

g_Assert.equal(g_hFoundModelHandle, g_hModelHandle, "direct model handle");
g_Assert.equal(g_CacheAPI.GetModelName(g_hFoundModelHandle), g_strModelPath, "direct model name");
g_Assert.equal(g_CacheAPI.GetModelHeader(g_hFoundModelHandle), g_ModelHeader, "nullable model header");
g_Assert.equal(g_CacheAPI.RequireModelHeader(g_hFoundModelHandle), g_ModelHeader, "required model header");
g_Assert.equal(g_CacheAPI.GetModelHeaderAddress(g_hFoundModelHandle), g_unModelHeaderAddress, "exact BigInt model-header address");
g_Assert.equal(typeof g_CacheAPI.GetModelHeaderAddress(g_hFoundModelHandle), "bigint", "model-header address type");
g_Assert.equal(typeof g_ModelHeader.Address, "bigint", "borrowed header records also use BigInt addresses");

for (const strLookupName of ["FindModel", "FindModelHandle"]) {
	const unReferenceCountBefore = g_unReferenceCount;
	g_Assert.throws(() => g_CacheAPI[strLookupName](`${g_strModelPath}\0tail`), /non-empty string/);
	g_Assert.equal(g_unReferenceCount, unReferenceCountBefore, "embedded-NUL rejection acquires no references");
}

g_Assert.equal(g_CacheAPI.AddReference(g_hFoundModelHandle), 3, "added reference count");
g_Assert.equal(g_CacheAPI.Release(g_hFoundModelHandle), 2, "release added reference");
g_Assert.equal(g_CacheAPI.Release(g_Model.Handle), 1, "release model-record reference");
g_Assert.equal(g_CacheAPI.Release(g_hFoundModelHandle), 0, "release direct-handle reference");

g_Assert.equal(g_CacheAPI.FindModel("models/missing.mdl").IsValid(), false, "invalid model record");
g_Assert.equal(g_CacheAPI.FindModelHandle("models/missing.mdl"), g_hInvalidModelHandle, "invalid direct model handle");

const g_hUnavailableModelHandle = 13;
g_Assert.equal(g_CacheAPI.GetModelHeader(g_hUnavailableModelHandle), null, "nullable missing model header");
g_Assert.equal(g_CacheAPI.GetModelHeaderAddress(g_hUnavailableModelHandle), 0n, "missing model-header address");
g_Assert.throws(() => g_CacheAPI.RequireModelHeader(g_hUnavailableModelHandle), /unavailable/, "required missing model header");
g_Assert.throws(() => g_CacheAPI.FindModel(""), TypeError, "empty model path");
g_Assert.throws(() => g_CacheAPI.AddReference(g_hInvalidModelHandle), TypeError, "invalid model handle rejection");
g_Assert.equal(g_unReferenceCount, 0, "direct cache tests release every model reference");

const g_OldConsoleCache = CreateOldConsoleCache();
globalThis.sourcejs["studio/cache"] = g_OldConsoleCache;

const g_OldCacheAPI = LoadStudioCachePackage();
const g_OldModel = g_OldCacheAPI.FindModel(g_strModelPath);
g_Assert.equal(g_OldCacheAPI, g_OldConsoleCache, "old-console cache preserves native identity");
g_Assert.equal(Object.hasOwn(g_OldCacheAPI, "GetReferenceCount"), false, "old-console cache omits reference getter");
g_Assert.equal(Object.hasOwn(g_OldCacheAPI.ModelCacheDataType, "DecodedAnimationBlock"), false, "old-console data type omission");
g_Assert.equal(Object.hasOwn(g_OldModel, "GetReferenceCount"), false, "old-console model record omission");
g_Assert.equal(g_OldCacheAPI.Release(g_OldModel.Handle), 0, "old-console model reference release result");

g_Assert.equal(g_unReferenceCount, 0, "old-console cache test releases model reference");

globalThis.sourcejs["studio/cache"] = g_NativeCache;

const g_DocumentationCacheAPI = LoadStudioCachePackage();
const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecCodeBlocks = [];
const g_ModuleObjectImportPattern = /const\s+[A-Za-z_$][\w$]*\s*=\s*require\("studio\/cache"\)/;

for (const vecMatch of g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecCodeBlocks.push(vecMatch[1]);
}

g_Assert.equal(g_vecCodeBlocks.length, 5, "all studio/cache documentation JavaScript blocks are present");

const g_unReferenceCountBeforeBlockLoad = g_unReferenceCount;
const g_DocumentationWorkflows = {};
const g_vecDocumentationImportNames = ExtractDocumentationImports(g_vecCodeBlocks[0]).sort();
const g_vecNativeExportNames = Object.keys(g_DocumentationCacheAPI).sort();
g_Assert.deepEqual(g_vecDocumentationImportNames, g_vecNativeExportNames, "documentation imports every exact export");

for (let unIndex = 0; unIndex < g_vecCodeBlocks.length; unIndex += 1) {
	const WorkflowExports = ExecuteCodeBlock(g_vecCodeBlocks[unIndex], unIndex, g_DocumentationCacheAPI);
	for (const strWorkflowName of Object.keys(WorkflowExports)) {
		g_Assert.equal(Object.hasOwn(g_DocumentationWorkflows, strWorkflowName), false, `unique documentation workflow: ${strWorkflowName}`);
		Object.defineProperty(g_DocumentationWorkflows, strWorkflowName, { configurable: true, enumerable: true, value: WorkflowExports[strWorkflowName], writable: true });
	}

	for (const strWorkflowName of ["CreateCachedModel", "CreateCachedModelHeader", "WithAddedCacheReference"]) {
		if (typeof WorkflowExports[strWorkflowName] === "function") {
			AssertCacheWorkflowFailures(g_vecCodeBlocks[unIndex], unIndex, strWorkflowName);
		}
	}
}

const g_vecDocumentationWorkflowNames = Object.keys(g_DocumentationWorkflows).sort();
g_Assert.equal(g_unReferenceCount, g_unReferenceCountBeforeBlockLoad, "documentation blocks acquire no references while loading");
g_Assert.deepEqual(g_vecDocumentationWorkflowNames, g_vecExpectedDocumentationWorkflows, "documentation exports every workflow");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by/, "studio/cache documentation is hand-maintained");
g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "documentation does not use console-only output");
g_Assert.doesNotMatch(g_strDocumentation, g_ModuleObjectImportPattern, "documentation uses direct destructured imports");
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

const g_Classifier = g_DocumentationWorkflows.CreateCacheDataTypeClassifier();
g_Assert.equal(g_Classifier.HasDecodedAnimationBlock, true, "cache data-type workflow capability");
g_Assert.equal(g_Classifier.ShouldDiscardBorrowedViews(g_ModelCacheDataType.StudioHeader), true, "cache data-type workflow invalidation");
g_Assert.equal(g_Classifier.ShouldDiscardBorrowedViews(g_ModelCacheDataType.AnimationBlock), false, "cache workflow retains other data");

const g_ModelController = g_DocumentationWorkflows.CreateCachedModel(g_strModelPath);
g_Assert.deepEqual(ToPlainValue(g_ModelController.Inspect()), { Name: g_strModelPath, ReferenceCount: 1, Valid: true }, "cached-model workflow inspection");
g_Assert.equal(g_ModelController.Handle, g_hModelHandle, "cached-model workflow handle");
g_Assert.equal(g_ModelController.Dispose(), true, "cached-model workflow disposal");
g_Assert.equal(g_ModelController.Dispose(), false, "cached-model repeated disposal");
g_Assert.throws(() => g_ModelController.Inspect(), /disposed/, "disposed cached-model workflow rejects access");
g_Assert.equal(g_unReferenceCount, 0, "cached-model workflow releases its reference");

const g_HeaderController = g_DocumentationWorkflows.CreateCachedModelHeader(g_strModelPath);
g_Assert.deepEqual(ToPlainValue(g_HeaderController.Inspect()), { ModelName: g_strModelPath, Name: "error.mdl", NullableHeaderAddress: g_unModelHeaderAddress, Address: g_unModelHeaderAddress, RequiredAddress: g_unModelHeaderAddress }, "cached-header workflow inspection");
g_Assert.equal(g_HeaderController.Header, g_ModelHeader, "cached-header workflow exposes the borrowed live record");
g_Assert.equal(g_HeaderController.Dispose(), true, "cached-header workflow disposal");
g_Assert.equal(g_HeaderController.Dispose(), false, "cached-header repeated disposal");
g_Assert.throws(() => g_HeaderController.Inspect(), /disposed/, "disposed cached-header workflow rejects access");
g_Assert.equal(g_unReferenceCount, 0, "cached-header workflow releases its reference");

const g_NativeReferenceResult = g_DocumentationWorkflows.WithAddedCacheReference(g_strModelPath, (Value) => Value);
const g_ReferenceResult = ToPlainValue(g_NativeReferenceResult);
g_Assert.deepEqual(g_ReferenceResult, { CountAfterAdd: 2, CurrentReferenceCount: 2, Handle: g_hModelHandle }, "additional cache-reference workflow");
g_Assert.equal(g_unReferenceCount, 0, "additional cache-reference workflow releases both references");

VerifySynchronousCacheCallbackLifetime(g_DocumentationWorkflows.WithAddedCacheReference);

ReleaseStudioCacheFixture();

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntime = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strPackagePath)});`], {
	encoding: "utf8",
	env: {
		...process.env,
		NODE_PATH: g_strPackageRootPath,
	},
	timeout: g_unMissingRuntimeTimeoutMilliseconds,
});
g_Assert.equal(g_MissingRuntime.error, undefined, "missing-runtime child starts and finishes before its deadline");
g_Assert.equal(g_MissingRuntime.status, 1, "studio/cache requires the native runtime");
g_Assert.match(g_MissingRuntime.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_studio_cache");
