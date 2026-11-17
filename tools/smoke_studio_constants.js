#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "studio-constants.md");
const g_strPackagePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "studio", "constants.js");
const g_strInternalRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_strRootDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "studio.md");
const g_strCacheDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "studio-cache.md");
const g_strModelPath = "models/sourcejs/verification.mdl";
const g_strMissingModelPath = "models/sourcejs/missing.mdl";
const g_hModelHandle = 12;
const g_hInvalidModelHandle = 0xFFFF;
const g_unDocumentationTimeoutMilliseconds = 1000;

// Controlled header metadata, not a STUDIO_* model/render option.
const g_nHeaderDiagnosticFlag = 0x00020000;

const g_HeaderState = {
	Attachments: [
		{ Name: "muzzle" },
		{ Name: "eyes" },
	],
	Bones: [
		{ Name: "root", Parent: -1 },
		{ Name: "spine", Parent: 0 },
	],
	Flags: 0x00,
};

let g_unCacheOperationCount = 0;
let g_unReferenceCount = 0;

const g_ModelHeader = {
	get Flags() {
		return g_HeaderState.Flags;
	},

	set Flags(nValue) {
		if (!Number.isInteger(nValue) || (nValue < -0x80000000) || (nValue > 0x7FFFFFFF)) {
			throw new TypeError("Studio integer properties require signed 32-bit integer values.");
		}

		g_HeaderState.Flags = nValue;
	},

	Attachments() {
		g_unCacheOperationCount += 1;

		const vecAttachments = [];
		for (const Attachment of g_HeaderState.Attachments) {
			vecAttachments.push(Attachment);
		}

		return vecAttachments;
	},

	Bones() {
		g_unCacheOperationCount += 1;

		const vecBones = [];
		for (const Bone of g_HeaderState.Bones) {
			vecBones.push(Bone);
		}

		return vecBones;
	},
};

const g_NativeConstants = {
	INVALID_ATTACHMENT_INDEX: -1,
	INVALID_BONE_INDEX: -1,
	ModelType: { Bad: 0, Brush: 1, Sprite: 2, Studio: 3 },
	StudioFlags: {
		DrawTranslucentSubmodels: 0x04,
		ItemBlink: 0x40,
		NoShadows: 0x80,
		None: 0x00,
		Render: 0x01,
		ShadowDepthTexture: 0x40000000,
		StaticLighting: 0x10,
		Transparency: 0x80000000,
		TwoPass: 0x08,
		ViewTransformAttachments: 0x02,
		Wireframe: 0x20,
		WireframePhysicsCollision: 0x100,
	},
};

const g_NativeCache = {
	INVALID_MODEL_HANDLE: g_hInvalidModelHandle,

	FindModelHandle(strModelPath) {
		g_unCacheOperationCount += 1;

		if (strModelPath !== g_strModelPath) {
			return g_hInvalidModelHandle;
		}

		g_unReferenceCount += 1;

		return g_hModelHandle;
	},

	Release(hModelHandle) {
		g_unCacheOperationCount += 1;

		if ((hModelHandle !== g_hModelHandle) || (g_unReferenceCount <= 0)) {
			throw new Error("invalid model reference release");
		}

		g_unReferenceCount -= 1;

		return g_unReferenceCount;
	},

	RequireModelHeader(hModelHandle) {
		g_unCacheOperationCount += 1;

		if ((hModelHandle !== g_hModelHandle) || (g_unReferenceCount <= 0)) {
			throw new Error("model header is unavailable");
		}

		return g_ModelHeader;
	},
};

function CopyStudioIndexResult(IndexResult) {
	return { HasAttachment: IndexResult.HasAttachment, HasRootBone: IndexResult.HasRootBone, AttachmentIndex: IndexResult.AttachmentIndex, RootBoneIndex: IndexResult.RootBoneIndex };
}

function RunDocumentationBlock(strCodeBlock, unIndex, ConstantsAPI) {
	const Context = g_VM.createContext({
		require(strIdentifier) {
			if (strIdentifier === "studio/constants") {
				return ConstantsAPI;
			}

			if (strIdentifier === "studio/cache") {
				return g_NativeCache;
			}

			throw new Error(`Unexpected documentation import: ${strIdentifier}`);
		},
	});

	const unCacheOperationCountBefore = g_unCacheOperationCount;
	const unReferenceCountBefore = g_unReferenceCount;
	const nHeaderFlagsBefore = g_HeaderState.Flags;
	const strDocumentationBlockLabel = `documentation block ${unIndex + 1}`;

	g_VM.runInContext(strCodeBlock, Context, {
		filename: `${g_strDocumentationPath}:example-${unIndex + 1}.js`,
		timeout: g_unDocumentationTimeoutMilliseconds,
	});

	g_Assert.equal(g_unCacheOperationCount, unCacheOperationCountBefore, `${strDocumentationBlockLabel} performs no cache work while loading`);
	g_Assert.equal(g_unReferenceCount, unReferenceCountBefore, `${strDocumentationBlockLabel} acquires no model reference while loading`);
	g_Assert.equal(g_HeaderState.Flags, nHeaderFlagsBefore, `${strDocumentationBlockLabel} changes no model flags while loading`);

	return Context;
}

function AssertStudioCleanupFailures(strSource, unBlockIndex, strWorkflowName, ConstantsAPI) {
	const bTemporaryFlags = strWorkflowName === "WithTemporaryHeaderFlags";
	const vecThrownValues = [undefined, null, false, 0, "", Symbol("StudioFailure"), new Error("Studio failure")];
	let unScenarioCount = 0;

	const CaptureOutcome = Callback => {
		try {
			return { Thrown: false, Result: Callback() };
		} catch (ExceptionValue) {
			return { Thrown: true, Error: ExceptionValue };
		}
	};

	const RunScenario = Options => {
		let unReferenceCount = 0;
		let unReleaseCount = 0;
		let unWriteCount = 0;
		let unCallbackCount = 0;
		let nFlags = -0x80000000;
		const vecCleanupErrors = [];

		const FailOperation = strOperationName => {
			if (Options.OperationName === strOperationName) {
				throw Options.OperationError;
			}
		};

		const Header = {
			get Flags() {
				g_Assert.equal(unReferenceCount, 1, "flag reads require the acquired reference");
				FailOperation("ReadFlags");

				return nFlags;
			},

			set Flags(nValue) {
				g_Assert.equal(unReferenceCount, 1, "restoration precedes release");
				g_Assert.equal(Number.isInteger(nValue) && (nValue >= -0x80000000) && (nValue <= 0x7FFFFFFF), true, "native Header.Flags accepts signed int32, not unsigned masks");
				unWriteCount += 1;
				const bRestore = unWriteCount === 2;
				const bFailWrite = bRestore ? (Options.CleanupFailureMask & 0x01) !== 0 : Options.OperationName === "ApplyFlags";
				if (!bFailWrite || Options.WriteAfterMutation) {
					nFlags = nValue;
				}

				if (bRestore && bFailWrite) {
					vecCleanupErrors.push(Options.RestoreError);
					throw Options.RestoreError;
				}

				if (!bRestore) {
					FailOperation("ApplyFlags");
				}
			},

			Bones() {
				FailOperation("Bones");

				return [{
					get Parent() {
						FailOperation("BoneParent");

						return -1;
					},
				}];
			},

			Attachments() {
				FailOperation("Attachments");

				return [{
					get Name() {
						FailOperation("AttachmentName");

						return "eyes";
					},
				}];
			},
		};

		const CacheAPI = {
			INVALID_MODEL_HANDLE: g_hInvalidModelHandle,

			FindModelHandle() {
				unReferenceCount += 1;

				return g_hModelHandle;
			},

			RequireModelHeader() {
				FailOperation("RequireModelHeader");

				return Header;
			},

			Release(hModelHandle) {
				g_Assert.equal(hModelHandle, g_hModelHandle, "cleanup uses the originally acquired handle");
				g_Assert.equal(unReferenceCount, 1, "each acquired reference gets one release attempt");
				unReleaseCount += 1;
				const bFailRelease = (Options.CleanupFailureMask & 0x02) !== 0;
				if (!bFailRelease || Options.ReleaseAfterMutation) {
					unReferenceCount -= 1;
				}

				if (bFailRelease) {
					vecCleanupErrors.push(Options.ReleaseError);
					throw Options.ReleaseError;
				}

				return unReferenceCount;
			},
		};

		const Context = g_VM.createContext({
			require(strIdentifier) {
				if (strIdentifier === "studio/constants") {
					return ConstantsAPI;
				}

				g_Assert.equal(strIdentifier, "studio/cache");

				return CacheAPI;
			},
		});
		g_VM.runInContext(strSource, Context, { filename: `${g_strDocumentationPath}:fault-${unBlockIndex + 1}.js`, timeout: g_unDocumentationTimeoutMilliseconds });

		const Callback = () => {
			unCallbackCount += 1;
			FailOperation("Callback");

			return Options.CallbackResult;
		};

		const Outcome = CaptureOutcome(() => bTemporaryFlags ? Context.WithTemporaryHeaderFlags(g_strModelPath, g_nHeaderDiagnosticFlag, Callback) : Context.InspectStudioIndexes(g_strModelPath, "eyes"));
		g_Assert.equal(unReleaseCount, 1, "setup, callback and restoration failures never skip or replay release");

		const bOriginalFlagsRead = bTemporaryFlags && !["RequireModelHeader", "ReadFlags"].includes(Options.OperationName);
		g_Assert.equal(unWriteCount, bOriginalFlagsRead ? 2 : 0, "restore is attempted exactly once only after reading the original flags");

		const bRestoreFailed = bOriginalFlagsRead && ((Options.CleanupFailureMask & 0x01) !== 0);
		const bReleaseFailed = (Options.CleanupFailureMask & 0x02) !== 0;
		const bOperationFailed = Options.OperationName !== "None";
		if (vecCleanupErrors.length > 0) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.equal(Outcome.Error && Outcome.Error.name, "AggregateError");
			const vecExpectedErrors = bOperationFailed ? [Options.OperationError, ...vecCleanupErrors] : vecCleanupErrors;
			g_Assert.deepEqual(Array.from(Outcome.Error.errors), vecExpectedErrors, "original and all cleanup failures preserve identity and order");
			g_Assert.equal(Outcome.Error.ModelHandle, g_hModelHandle);
			g_Assert.equal(Outcome.Error.UnconfirmedReleaseCount, bReleaseFailed ? 1 : 0);
			g_Assert.equal(Boolean(Outcome.Error.FlagsRestoreOutcomeUnknown), bRestoreFailed);

		} else if (bOperationFailed) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.equal(Outcome.Error, Options.OperationError, "successful cleanup retains falsy exceptions too");

		} else {
			g_Assert.equal(Outcome.Thrown, false);

			if (bTemporaryFlags) {
				g_Assert.equal(Outcome.Result, Options.CallbackResult);

			} else {
				g_Assert.deepEqual({ ...Outcome.Result }, { HasAttachment: true, HasRootBone: true, AttachmentIndex: 0, RootBoneIndex: 0 });
			}
		}

		g_Assert.equal(unReferenceCount, (bReleaseFailed && !Options.ReleaseAfterMutation) ? 1 : 0, "unknown release outcome is not guessed or retried");

		if (bOriginalFlagsRead && (!bRestoreFailed || Options.WriteAfterMutation)) {
			g_Assert.equal(nFlags, -0x80000000, "restoration preserves an original high-bit signed mask");
		}

		if (bTemporaryFlags) {
			g_Assert.equal(unCallbackCount, ["None", "Callback"].includes(Options.OperationName) ? 1 : 0, "pre-callback failures invoke no user code");
		}

		unScenarioCount += 1;
	};

	const vecOperationNames = bTemporaryFlags ? ["RequireModelHeader", "ReadFlags", "ApplyFlags", "Callback"] : ["RequireModelHeader", "Bones", "BoneParent", "Attachments", "AttachmentName"];
	for (const strOperationName of vecOperationNames) {
		const bMayRestore = bTemporaryFlags && !["RequireModelHeader", "ReadFlags"].includes(strOperationName);
		for (const OperationError of vecThrownValues) {
			for (const unCleanupFailureMask of bMayRestore ? [0x00, 0x01, 0x02, 0x03] : [0x00, 0x02]) {
				for (const bWriteAfterMutation of bMayRestore ? [false, true] : [false]) {
					for (const bReleaseAfterMutation of [false, true]) {
						RunScenario({ OperationName: strOperationName, OperationError, CleanupFailureMask: unCleanupFailureMask, WriteAfterMutation: bWriteAfterMutation, ReleaseAfterMutation: bReleaseAfterMutation, RestoreError: false, ReleaseError: null });
					}
				}
			}
		}
	}

	for (const CallbackResult of bTemporaryFlags ? vecThrownValues : [undefined]) {
		for (const unCleanupFailureMask of bTemporaryFlags ? [0x00, 0x01, 0x02, 0x03] : [0x00, 0x02]) {
			for (const bWriteAfterMutation of bTemporaryFlags ? [false, true] : [false]) {
				for (const bReleaseAfterMutation of [false, true]) {
					RunScenario({ OperationName: "None", CallbackResult, CleanupFailureMask: unCleanupFailureMask, WriteAfterMutation: bWriteAfterMutation, ReleaseAfterMutation: bReleaseAfterMutation, RestoreError: CallbackResult, ReleaseError: Symbol("ReleaseFailure") });
				}
			}
		}
	}

	g_Assert.equal(unScenarioCount, bTemporaryFlags ? 392 : 144, "all studio cleanup scenarios ran");
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

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned studio/constants fixture property must be removable: " + strKey);
}

function ReleaseStudioConstantsFixture() {
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
		throw new AggregateError(vecFailures, "Studio/constants fixture restoration failed.");
	}

	process.removeListener("exit", ReleaseStudioConstantsFixture);
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(g_SourceJSDescriptor || Object.isExtensible(globalThis), "Studio/constants runtime fixture must support installation.");
g_Assert.ok(Object.isExtensible(require.cache), "Studio/constants package cache must support exact restoration.");
g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Studio/constants runtime fixture must support exact restoration.");
g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_OriginalModuleLoad === "function"), "Studio/constants loader must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed studio/constants cache entries must support exact restoration.");
}

// Exit cleanup also restores borrowed state after synchronous assertion failures.
process.once("exit", ReleaseStudioConstantsFixture);
g_bPackageCacheOwned = true;

for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
	RestoreFixtureProperty(require.cache, strModulePath, undefined);
}

function LoadStudioConstantsPackage() {
	Object.defineProperty(g_Module, "_load", {
		...g_LoaderDescriptor,
		writable: true,
		value: function LoadStudioConstantsModule(strRequest, Parent, bIsMain) {
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

Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "studio/constants": g_NativeConstants } });
g_bSourceJSOwned = true;

const g_ConstantsAPI = LoadStudioConstantsPackage();
g_Assert.equal(g_ConstantsAPI, g_NativeConstants, "studio/constants preserves native object identity");
g_Assert.deepEqual(Object.keys(g_ConstantsAPI).sort(), [
	"INVALID_ATTACHMENT_INDEX",
	"INVALID_BONE_INDEX",
	"ModelType",
	"StudioFlags",
], "exact studio/constants exports");
g_Assert.deepEqual(Object.keys(g_ConstantsAPI.ModelType).sort(), ["Bad", "Brush", "Sprite", "Studio"], "exact model types");
g_Assert.deepEqual(Object.values(g_ConstantsAPI.ModelType), [0, 1, 2, 3], "exact model-type values");
g_Assert.deepEqual(Object.keys(g_ConstantsAPI.StudioFlags).sort(), [
	"DrawTranslucentSubmodels",
	"ItemBlink",
	"NoShadows",
	"None",
	"Render",
	"ShadowDepthTexture",
	"StaticLighting",
	"Transparency",
	"TwoPass",
	"ViewTransformAttachments",
	"Wireframe",
	"WireframePhysicsCollision",
], "exact full studio flags");
g_Assert.deepEqual(g_ConstantsAPI.StudioFlags, {
	DrawTranslucentSubmodels: 0x00000004,
	ItemBlink: 0x00000040,
	NoShadows: 0x00000080,
	None: 0x00000000,
	Render: 0x00000001,
	ShadowDepthTexture: 0x40000000,
	StaticLighting: 0x00000010,
	Transparency: 0x80000000,
	TwoPass: 0x00000008,
	ViewTransformAttachments: 0x00000002,
	Wireframe: 0x00000020,
	WireframePhysicsCollision: 0x00000100,
}, "exact full studio-flag values");
g_Assert.equal(g_ConstantsAPI.INVALID_BONE_INDEX, -1, "invalid bone index");
g_Assert.equal(g_ConstantsAPI.INVALID_ATTACHMENT_INDEX, -1, "invalid attachment index");
g_Assert.equal(Object.hasOwn(g_ConstantsAPI, "number"), false, "generic number lookup is absent");
g_Assert.equal(Object.hasOwn(g_ConstantsAPI, "object"), false, "generic object lookup is absent");
g_Assert.equal(Object.hasOwn(g_ConstantsAPI, "default"), false, "default alias is absent");

const g_OldConsoleConstants = { ...g_NativeConstants, StudioFlags: { ...g_NativeConstants.StudioFlags } };

delete g_OldConsoleConstants.StudioFlags.ShadowDepthTexture;
delete g_OldConsoleConstants.StudioFlags.WireframePhysicsCollision;
globalThis.sourcejs["studio/constants"] = g_OldConsoleConstants;

const g_OldConstantsAPI = LoadStudioConstantsPackage();
g_Assert.equal(g_OldConstantsAPI, g_OldConsoleConstants, "old-console constants preserve native identity");
g_Assert.equal(Object.hasOwn(g_OldConstantsAPI.StudioFlags, "ShadowDepthTexture"), false, "old-console shadow flag omission");
g_Assert.equal(Object.hasOwn(g_OldConstantsAPI.StudioFlags, "WireframePhysicsCollision"), false, "old-console physics flag omission");

globalThis.sourcejs["studio/constants"] = g_NativeConstants;

const g_DocumentationConstantsAPI = LoadStudioConstantsPackage();
const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecCodeBlocks = [];

for (const vecMatch of g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecCodeBlocks.push(vecMatch[1]);
}

g_Assert.equal(g_vecCodeBlocks.length, 5, "all studio/constants documentation JavaScript blocks are present");

const g_vecDocumentationContexts = [];
for (let unIndex = 0; unIndex < g_vecCodeBlocks.length; unIndex += 1) {
	g_vecDocumentationContexts.push(RunDocumentationBlock(g_vecCodeBlocks[unIndex], unIndex, g_DocumentationConstantsAPI));
}

const g_ModelTypeContext = g_vecDocumentationContexts[1];
g_Assert.equal(g_ModelTypeContext.DescribeModelType(g_ConstantsAPI.ModelType.Bad), "bad", "bad model type workflow");
g_Assert.equal(g_ModelTypeContext.DescribeModelType(g_ConstantsAPI.ModelType.Brush), "brush", "brush model type workflow");
g_Assert.equal(g_ModelTypeContext.DescribeModelType(g_ConstantsAPI.ModelType.Sprite), "sprite", "sprite model type workflow");
g_Assert.equal(g_ModelTypeContext.DescribeModelType(g_ConstantsAPI.ModelType.Studio), "studio", "studio model type workflow");
g_Assert.throws(() => g_ModelTypeContext.DescribeModelType(27), /Unknown model type: 27/, "unknown model type rejection");

const g_StudioFlagContext = g_vecDocumentationContexts[2];
const g_unRenderFlag = g_ConstantsAPI.StudioFlags.Render;
const g_unTransparencyFlag = g_ConstantsAPI.StudioFlags.Transparency;
const g_unNoShadowsFlag = g_ConstantsAPI.StudioFlags.NoShadows;
const g_unRenderTransparencyFlags = g_StudioFlagContext.CreateStudioFlagSet(g_unRenderFlag, g_unTransparencyFlag);
g_Assert.equal(g_unRenderTransparencyFlags, 0x80000001, "high-bit flag set remains an unsigned Number");
g_Assert.equal(g_StudioFlagContext.HasStudioFlag(g_unRenderTransparencyFlags, g_unRenderFlag), true, "render flag detection");
g_Assert.equal(g_StudioFlagContext.HasStudioFlag(g_unRenderTransparencyFlags, g_unTransparencyFlag), true, "high-bit flag detection");
g_Assert.equal(g_StudioFlagContext.HasStudioFlag(g_unRenderTransparencyFlags, g_unNoShadowsFlag), false, "absent flag detection");

const g_StudioFlagCapabilities = g_StudioFlagContext.GetStudioFlagCapabilities();
g_Assert.deepEqual({ HasShadowDepthTexture: g_StudioFlagCapabilities.HasShadowDepthTexture, HasWireframePhysicsCollision: g_StudioFlagCapabilities.HasWireframePhysicsCollision }, { HasShadowDepthTexture: true, HasWireframePhysicsCollision: true }, "full SDK capability detection");

globalThis.sourcejs["studio/constants"] = g_OldConsoleConstants;

const g_OldDocumentationConstantsAPI = LoadStudioConstantsPackage();
const g_OldConsoleCapabilityContext = g_VM.createContext({
	require(strIdentifier) {
		if (strIdentifier === "studio/constants") {
			return g_OldDocumentationConstantsAPI;
		}

		throw new Error(`Unexpected old-console documentation import: ${strIdentifier}`);
	},
});

g_VM.runInContext(g_vecCodeBlocks[2], g_OldConsoleCapabilityContext, {
	filename: `${g_strDocumentationPath}:old-console-capabilities.js`,
	timeout: g_unDocumentationTimeoutMilliseconds,
});

const g_OldConsoleCapabilities = g_OldConsoleCapabilityContext.GetStudioFlagCapabilities();
g_Assert.deepEqual({ HasShadowDepthTexture: g_OldConsoleCapabilities.HasShadowDepthTexture, HasWireframePhysicsCollision: g_OldConsoleCapabilities.HasWireframePhysicsCollision }, { HasShadowDepthTexture: false, HasWireframePhysicsCollision: false }, "old-console capability detection");

globalThis.sourcejs["studio/constants"] = g_NativeConstants;
RestoreFixtureProperty(require.cache, g_strPackagePath, undefined);

const g_TemporaryHeaderFlagsContext = g_vecDocumentationContexts[3];
g_Assert.doesNotMatch(g_vecCodeBlocks[3], /\bStudioFlags\b/, "header metadata workflow does not import or pass the model/render namespace");
AssertStudioCleanupFailures(g_vecCodeBlocks[3], 3, "WithTemporaryHeaderFlags", g_DocumentationConstantsAPI);

const g_vecInvalidFlagValues = [
	undefined,
	null,
	false,
	true,
	NaN,
	Infinity,
	-Infinity,
	-1,
	0.5,
	0x100000000,
	"1",
	1n,
	{},
	[],
	Symbol("InvalidFlags"),
	{
		valueOf() {
			throw new Error("Flag coercion must not run");
		},
	},
];

let g_unInputValidationCount = 0;
for (const Value of g_vecInvalidFlagValues) {
	const unCacheOperationsBefore = g_unCacheOperationCount;
	g_Assert.throws(() => g_StudioFlagContext.CreateStudioFlagSet(Value), /unsigned 32-bit integer masks/);
	g_Assert.throws(() => g_StudioFlagContext.HasStudioFlag(Value, g_unRenderFlag), /unsigned 32-bit integer masks/);
	g_Assert.throws(() => g_StudioFlagContext.HasStudioFlag(g_unRenderFlag, Value), /unsigned 32-bit integer masks/);
	g_Assert.equal(g_unCacheOperationCount, unCacheOperationsBefore, "invalid masks are rejected before any cache operation");
	g_unInputValidationCount += 3;
}

const g_vecInvalidHeaderFlagValues = [...g_vecInvalidFlagValues.filter(Value => Value !== -1), -0x80000001, 0x80000000];
for (const Value of g_vecInvalidHeaderFlagValues) {
	const unCacheOperationsBefore = g_unCacheOperationCount;
	g_Assert.throws(() => g_TemporaryHeaderFlagsContext.WithTemporaryHeaderFlags(g_strModelPath, Value, () => undefined), /signed 32-bit header mask/);
	g_Assert.equal(g_unCacheOperationCount, unCacheOperationsBefore, "invalid signed header masks are rejected before model lookup");
	g_unInputValidationCount += 1;
}

for (const Value of [undefined, null, false, 0, "", 1n, {}, []]) {
	const unCacheOperationsBefore = g_unCacheOperationCount;
	g_Assert.throws(() => g_TemporaryHeaderFlagsContext.WithTemporaryHeaderFlags(g_strModelPath, g_nHeaderDiagnosticFlag, Value), /Callback must be a function/);
	g_Assert.equal(g_unCacheOperationCount, unCacheOperationsBefore, "invalid callbacks are rejected before model lookup");
	g_unInputValidationCount += 1;
}

g_Assert.equal(g_unInputValidationCount, 73, "all separate model/render-mask, header-mask and callback checks ran");

// Raw int32 boundary masks test storage, not SDK permission to change those metadata bits.
let g_unSignedMaskScenarioCount = 0;
for (const nOriginalFlags of [0x00, -0x80000000, 0x7FFFFFFF]) {
	for (const nAdditionalHeaderFlags of [-0x80000000, -1, 0x00, 0x01, 0x7FFFFFFF]) {
		g_HeaderState.Flags = nOriginalFlags;
		const nFlags = g_TemporaryHeaderFlagsContext.WithTemporaryHeaderFlags(g_strModelPath, nAdditionalHeaderFlags, Header => Header.Flags);
		g_Assert.equal(nFlags, nOriginalFlags | nAdditionalHeaderFlags, "signed header masks preserve the native int32 representation");
		g_Assert.equal(g_HeaderState.Flags, nOriginalFlags, "the original signed representation is restored exactly");
		g_Assert.equal(g_unReferenceCount, 0);
		g_unSignedMaskScenarioCount += 1;
	}
}

g_HeaderState.Flags = 0;
g_Assert.equal(g_unSignedMaskScenarioCount, 15, "all signed header boundary combinations ran");

const g_nTemporaryFlagResult = g_TemporaryHeaderFlagsContext.WithTemporaryHeaderFlags(g_strModelPath, g_nHeaderDiagnosticFlag, (...vecArguments) => {
	g_Assert.equal(vecArguments.length, 1, "header workflow passes no model/render constants to the callback");
	const [Header] = vecArguments;
	g_Assert.equal(Header, g_ModelHeader, "temporary flag workflow exposes the live header only inside the callback");
	g_Assert.equal(Header.Flags, g_nHeaderDiagnosticFlag, "only the caller-selected header metadata mask is applied");
	g_Assert.equal(g_unReferenceCount, 1, "temporary flag callback owns one model reference");

	return Header.Flags;
});
g_Assert.equal(g_nTemporaryFlagResult, g_nHeaderDiagnosticFlag, "temporary flag workflow returns the callback result");
g_Assert.equal(g_HeaderState.Flags, 0, "temporary flag workflow restores shared flags");
g_Assert.equal(g_unReferenceCount, 0, "temporary flag workflow releases the model reference");

const g_nSignedHeaderFlags = g_TemporaryHeaderFlagsContext.WithTemporaryHeaderFlags(g_strModelPath, -0x80000000, Header => Header.Flags);
g_Assert.equal(g_nSignedHeaderFlags, -0x80000000, "live Header.Flags uses signed int32 storage");
g_Assert.equal(g_nSignedHeaderFlags >>> 0, 0x80000000, "a copied raw header int32 retains its representation without becoming a model/render flag");
g_Assert.equal(g_HeaderState.Flags, 0, "high-bit temporary edits restore original signed flags");
g_Assert.equal(g_unReferenceCount, 0, "high-bit temporary edits release the acquired reference");
g_Assert.throws(() => g_TemporaryHeaderFlagsContext.WithTemporaryHeaderFlags(g_strModelPath, g_nHeaderDiagnosticFlag, () => {
	throw new Error("stop temporary inspection");
}), /stop temporary inspection/, "temporary flag workflow propagates callback errors");
g_Assert.equal(g_HeaderState.Flags, 0, "callback error restores shared flags");
g_Assert.equal(g_unReferenceCount, 0, "callback error releases the model reference");
g_Assert.throws(() => g_TemporaryHeaderFlagsContext.WithTemporaryHeaderFlags(g_strMissingModelPath, g_nHeaderDiagnosticFlag, () => undefined), /Model is unavailable/, "temporary flag workflow rejects an invalid handle");
g_Assert.equal(g_unReferenceCount, 0, "invalid temporary flag lookup acquires no reference");
g_Assert.throws(() => g_TemporaryHeaderFlagsContext.WithTemporaryHeaderFlags(g_strModelPath, g_nHeaderDiagnosticFlag, null), /Callback must be a function/, "temporary flag callback validation");
g_Assert.equal(g_unReferenceCount, 0, "callback validation performs no model lookup");

const g_StudioIndexContext = g_vecDocumentationContexts[4];
AssertStudioCleanupFailures(g_vecCodeBlocks[4], 4, "InspectStudioIndexes", g_DocumentationConstantsAPI);

const g_KnownIndexResult = g_StudioIndexContext.InspectStudioIndexes(g_strModelPath, "eyes");
g_Assert.deepEqual(CopyStudioIndexResult(g_KnownIndexResult), { HasAttachment: true, HasRootBone: true, AttachmentIndex: 1, RootBoneIndex: 0 }, "live studio index workflow finds the requested records");
g_Assert.equal(g_unReferenceCount, 0, "studio index workflow releases the model reference");

const g_MissingIndexResult = g_StudioIndexContext.InspectStudioIndexes(g_strModelPath, "camera");
g_Assert.deepEqual(CopyStudioIndexResult(g_MissingIndexResult), { HasAttachment: false, HasRootBone: true, AttachmentIndex: g_ConstantsAPI.INVALID_ATTACHMENT_INDEX, RootBoneIndex: 0 }, "live studio index workflow preserves the no-match sentinel");
g_Assert.equal(g_unReferenceCount, 0, "missing attachment workflow releases the model reference");
g_Assert.throws(() => g_StudioIndexContext.InspectStudioIndexes(g_strMissingModelPath, "eyes"), /Model is unavailable/, "studio index workflow rejects an invalid handle");
g_Assert.equal(g_unReferenceCount, 0, "invalid index lookup acquires no reference");
g_Assert.equal(g_HeaderState.Flags, 0, "all documentation workflows restore shared model state");

for (const strExportName of Object.keys(g_NativeConstants)) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation covers ${strExportName}`);
}

for (const strMemberName of Object.keys(g_NativeConstants.ModelType)) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMemberName}\\b`), `documentation covers ModelType.${strMemberName}`);
}

for (const strMemberName of Object.keys(g_NativeConstants.StudioFlags)) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMemberName}\\b`), `documentation covers StudioFlags.${strMemberName}`);
}

g_Assert.doesNotMatch(g_strDocumentation, /console\.(?:log|warn|error)/, "studio/constants examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentation, /models\/error\.mdl/, "studio/constants examples do not hard-code an engine fallback model");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by/, "studio/constants documentation is hand-maintained");
g_Assert.equal(g_FileSystem.existsSync(g_strRootDocumentationPath), true, "studio documentation exists");
g_Assert.equal(g_FileSystem.existsSync(g_strCacheDocumentationPath), true, "studio/cache documentation exists");

ReleaseStudioConstantsFixture();

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
g_Assert.equal(g_MissingRuntime.status, 1, "studio/constants requires the native runtime");
g_Assert.match(g_MissingRuntime.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_studio_constants");
