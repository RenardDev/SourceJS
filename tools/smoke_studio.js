#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "studio.md");
const g_strPackagePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "studio.js");
const g_strInternalRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_strModelPath = "models/error.mdl";
const g_hModelHandle = 12;
const g_hInvalidModelHandle = 0xFFFF;
const g_unModelHeaderAddress = 0xFEDCBA9876543210n;
const g_unBoneAddress = 0xFEDCBA9876545100n;
const g_unBoneControllerAddress = 0xFEDCBA9876545200n;
const g_unHitboxSetAddress = 0xFEDCBA9876545300n;
const g_unHitboxAddress = 0xFEDCBA9876545400n;
const g_unSequenceAddress = 0xFEDCBA9876545500n;
const g_unAttachmentAddress = 0xFEDCBA9876545600n;
const g_vecExpectedDocumentationWorkflows = [
	"CreateModelHeaderInspection",
	"CreateModelInspection",
	"CreateStudioClassifier",
	"TemporarilyAdjustFirstBoneController",
	"TemporarilyAdjustFirstSequence",
	"TemporarilyExpandHitbox",
	"TemporarilyOffsetNamedAttachment",
	"TemporarilyOffsetRootBone",
	"WithAdditionalModelReference",
];

const g_vecCallLog = [];
let g_unReferenceCount = 0;

function InstallLiveProperties(Target, State, vecPropertyNames, bWritable = true) {
	for (const strPropertyName of vecPropertyNames) {
		const Descriptor = {
			enumerable: true,

			get() {
				return State[strPropertyName];
			},
		};

		if (bWritable) {
			Descriptor.set = (Value) => {
				State[strPropertyName] = Value;
			};
		}

		Object.defineProperty(Target, strPropertyName, Descriptor);
	}
}

function CreateVectorView(State, unAddress) {
	const Vector = { Address: unAddress };
	InstallLiveProperties(Vector, State, ["X", "Y", "Z"]);

	return Vector;
}

function CreateQuaternionView(State, unAddress) {
	const Quaternion = { Address: unAddress };
	InstallLiveProperties(Quaternion, State, ["X", "Y", "Z", "W"]);

	return Quaternion;
}

function CreateRadianEulerView(State, unAddress) {
	const RadianEuler = { Address: unAddress };
	InstallLiveProperties(RadianEuler, State, ["Pitch", "Yaw", "Roll"]);

	return RadianEuler;
}

function CreateIntegerArray(vecState, unAddress) {
	const vecValues = [];
	Object.defineProperty(vecValues, "Address", {
		enumerable: true,
		value: unAddress,
	});

	for (let unIndex = 0; unIndex < vecState.length; unIndex += 1) {
		Object.defineProperty(vecValues, String(unIndex), {
			enumerable: true,

			get() {
				return vecState[unIndex];
			},

			set(nValue) {
				vecState[unIndex] = nValue;
			},
		});
	}

	return vecValues;
}

function CreateMatrixView(vecState, unAddress) {
	const vecRows = [];
	Object.defineProperty(vecRows, "Address", {
		enumerable: true,
		value: unAddress,
	});

	for (let unRowIndex = 0; unRowIndex < vecState.length; unRowIndex += 1) {
		const vecColumns = [];
		for (let unColumnIndex = 0; unColumnIndex < vecState[unRowIndex].length; unColumnIndex += 1) {
			Object.defineProperty(vecColumns, String(unColumnIndex), {
				enumerable: true,

				get() {
					return vecState[unRowIndex][unColumnIndex];
				},

				set(flValue) {
					vecState[unRowIndex][unColumnIndex] = flValue;
				},
			});
		}

		vecRows.push(vecColumns);
	}

	return vecRows;
}

function RequireIndex(nIndex, strName) {
	const nMaximumIndex = 2_147_483_647;
	if (!Number.isInteger(nIndex) || (nIndex < 0) || (nIndex > nMaximumIndex)) {
		throw new TypeError(`${strName} must be a non-negative integer in the signed 32-bit range`);
	}

	return nIndex;
}

function RequireHandle(hHandle) {
	if (!Number.isInteger(hHandle) || (hHandle < 0) || (hHandle >= g_hInvalidModelHandle)) {
		throw new TypeError("handle must be a valid model handle");
	}

	return hHandle;
}

function RequirePath(strPathValue) {
	if ((typeof strPathValue !== "string") || (strPathValue.length === 0) || strPathValue.includes("\0")) {
		throw new TypeError("path must be a non-empty string without embedded NUL");
	}

	return strPathValue;
}

const g_HeaderState = {
	AttachmentCount: 1,
	AttachmentOffset: 0x300,
	BoneControllerCount: 1,
	BoneControllerOffset: 0x180,
	BoneCount: 1,
	BoneOffset: 0x100,
	Checksum: 123456,
	Contents: 0x1,
	Flags: 0x0,
	HitboxSetCount: 1,
	HitboxSetOffset: 0x200,
	ID: 0x54534449,
	Length: 2048,
	LocalAnimationCount: 1,
	LocalAnimationOffset: 0x380,
	LocalSequenceCount: 1,
	LocalSequenceOffset: 0x400,
	Mass: 25,
	Name: "error.mdl",
	Version: 48,
};

const g_BoneState = {
	Contents: 0x1,
	Flags: 0x0,
	Name: "root",
	NameOffset: 0x20,
	Parent: -1,
	PhysicsBone: 0,
	ProceduralType: 0,
	ProcedureOffset: 0x0,
	SurfaceName: "default",
	SurfaceNameOffset: 0x40,
	SurfacePropertyLookup: 0,
};

const g_BoneControllerState = { Bone: 0, End: 45, InputField: 0, Rest: 0, Start: -45, Type: 1 };

const g_HitboxSetState = { HitboxCount: 1, HitboxOffset: 0x40, Name: "default", NameOffset: 0x10 };

const g_HitboxState = { Bone: 0, Group: 1, Name: "body", NameOffset: 0x30 };

const g_SequenceState = {
	Activity: "ACT_IDLE",
	ActivityIndex: 1,
	ActivityOffset: 0x30,
	ActivityWeight: 1,
	AnimationOffset: 0x80,
	BlendCount: 1,
	DeltaAnimationIndex: 0,
	EntryPhase: 0,
	EventCount: 0,
	EventOffset: 0x0,
	ExitPhase: 1,
	FadeInTime: 0.2,
	FadeOutTime: 0.2,
	Flags: 0x0,
	Label: "idle",
	LabelOffset: 0x20,
	LastFrame: 30,
	LocalEntryNode: 0,
	LocalExitNode: 0,
	ModelHeaderOffset: -0x400,
	MovementOffset: 0x0,
	NextSequence: -1,
	NodeFlags: 0x0,
};

const g_AttachmentState = { Flags: 0x0, LocalBone: 0, Name: "eyes", NameOffset: 0x18 };

const g_EyePositionState = { X: 0, Y: 0, Z: 64 };
const g_IlluminationCenterState = { X: 0, Y: 0, Z: 32 };
const g_HullMinimumsState = { X: -16, Y: -16, Z: 0 };
const g_HullMaximumsState = { X: 16, Y: 16, Z: 72 };
const g_ViewMinimumsState = { X: -16, Y: -16, Z: 0 };
const g_ViewMaximumsState = { X: 16, Y: 16, Z: 64 };
const g_vecBoneControllerIndexesState = [-1, -1, -1, -1, -1, -1];
const g_BonePositionState = { X: 0, Y: 0, Z: 0 };
const g_BoneQuaternionState = { W: 1, X: 0, Y: 0, Z: 0 };
const g_BoneRadianEulerState = { Pitch: 0.125, Yaw: 0.25, Roll: -0.5 };
const g_BonePositionScaleState = { X: 1, Y: 1, Z: 1 };
const g_BoneRadianEulerScaleState = { X: 1, Y: 1, Z: 1 };

const g_vecBonePositionToBoneState = [
	[1, 0, 0, 0],
	[0, 1, 0, 0],
	[0, 0, 1, 0],
];

const g_BoneAlignmentState = { W: 1, X: 0, Y: 0, Z: 0 };
const g_HitboxMinimumsState = { X: -16, Y: -16, Z: 0 };
const g_HitboxMaximumsState = { X: 16, Y: 16, Z: 72 };
const g_SequenceMinimumsState = { X: -16, Y: -16, Z: 0 };
const g_SequenceMaximumsState = { X: 16, Y: 16, Z: 72 };
const g_vecAttachmentTransformState = [
	[1, 0, 0, 4],
	[0, 1, 0, 8],
	[0, 0, 1, 64],
];

const g_NativeBone = {
	Address: g_unBoneAddress,
	BoneControllerIndexes: CreateIntegerArray(g_vecBoneControllerIndexesState, g_unBoneAddress + 0x20n),
	Position: CreateVectorView(g_BonePositionState, g_unBoneAddress + 0x40n),
	Quaternion: CreateQuaternionView(g_BoneQuaternionState, g_unBoneAddress + 0x50n),
	RadianEuler: CreateRadianEulerView(g_BoneRadianEulerState, g_unBoneAddress + 0x60n),
	PositionScale: CreateVectorView(g_BonePositionScaleState, g_unBoneAddress + 0x70n),
	RadianEulerScale: CreateVectorView(g_BoneRadianEulerScaleState, g_unBoneAddress + 0x80n),
	PositionToBone: CreateMatrixView(g_vecBonePositionToBoneState, g_unBoneAddress + 0x90n),
	Alignment: CreateQuaternionView(g_BoneAlignmentState, g_unBoneAddress + 0xC0n),

	GetProcedureAddress() {
		g_vecCallLog.push(["GetProcedureAddress"]);

		return 0n;
	},
};

InstallLiveProperties(g_NativeBone, g_BoneState, [
	"NameOffset",
	"Parent",
	"Flags",
	"ProceduralType",
	"ProcedureOffset",
	"PhysicsBone",
	"SurfaceNameOffset",
	"Contents",
	"SurfacePropertyLookup",
]);
InstallLiveProperties(g_NativeBone, g_BoneState, ["Name", "SurfaceName"], false);

const g_NativeBoneController = { Address: g_unBoneControllerAddress };
InstallLiveProperties(g_NativeBoneController, g_BoneControllerState, [
	"Bone",
	"Type",
	"Start",
	"End",
	"Rest",
	"InputField",
]);

const g_NativeHitbox = {
	Address: g_unHitboxAddress,
	Mins: CreateVectorView(g_HitboxMinimumsState, g_unHitboxAddress + 0x10n),
	Maxs: CreateVectorView(g_HitboxMaximumsState, g_unHitboxAddress + 0x20n),
};

InstallLiveProperties(g_NativeHitbox, g_HitboxState, ["NameOffset", "Bone", "Group"]);
InstallLiveProperties(g_NativeHitbox, g_HitboxState, ["Name"], false);

const g_NativeHitboxSet = {
	Address: g_unHitboxSetAddress,

	GetHitbox(nHitboxIndex) {
		g_vecCallLog.push(["HitboxSet.GetHitbox", nHitboxIndex]);

		const nValidatedIndex = RequireIndex(nHitboxIndex, "hitbox index");
		if (nValidatedIndex === 0) {
			return g_NativeHitbox;
		}

		return null;
	},

	Hitboxes() {
		g_vecCallLog.push(["HitboxSet.Hitboxes"]);

		return [g_NativeHitbox];
	},
};

InstallLiveProperties(g_NativeHitboxSet, g_HitboxSetState, ["NameOffset", "HitboxCount", "HitboxOffset"]);
InstallLiveProperties(g_NativeHitboxSet, g_HitboxSetState, ["Name"], false);

// Sequence records refer back to the header built after its child records.
let g_NativeModelHeader = null;

const g_NativeSequence = {
	Address: g_unSequenceAddress,
	Minimums: CreateVectorView(g_SequenceMinimumsState, g_unSequenceAddress + 0x20n),
	Maximums: CreateVectorView(g_SequenceMaximumsState, g_unSequenceAddress + 0x30n),

	GetModelHeader() {
		g_vecCallLog.push(["Sequence.GetModelHeader"]);

		return g_NativeModelHeader;
	},

	GetAnimationIndex(nAnimationXIndex = 0, nAnimationYIndex = 0) {
		g_vecCallLog.push(["Sequence.GetAnimationIndex", nAnimationXIndex, nAnimationYIndex]);

		const nValidatedXIndex = RequireIndex(nAnimationXIndex, "animation x");
		const nValidatedYIndex = RequireIndex(nAnimationYIndex, "animation y");
		if ((nValidatedXIndex !== 0) || (nValidatedYIndex !== 0)) {
			throw new RangeError("animation index is outside the grid");
		}

		return 7;
	},

	GetWeight(nBoneIndex = 0) {
		g_vecCallLog.push(["Sequence.GetWeight", nBoneIndex]);

		if (RequireIndex(nBoneIndex, "bone index") !== 0) {
			throw new RangeError("bone index is outside the model");
		}

		return 1;
	},
};

InstallLiveProperties(g_NativeSequence, g_SequenceState, [
	"ModelHeaderOffset",
	"LabelOffset",
	"ActivityOffset",
	"Flags",
	"ActivityIndex",
	"ActivityWeight",
	"EventCount",
	"EventOffset",
	"BlendCount",
	"AnimationOffset",
	"MovementOffset",
	"FadeInTime",
	"FadeOutTime",
	"LocalEntryNode",
	"LocalExitNode",
	"NodeFlags",
	"EntryPhase",
	"ExitPhase",
	"LastFrame",
	"NextSequence",
	"DeltaAnimationIndex",
]);
InstallLiveProperties(g_NativeSequence, g_SequenceState, ["Label", "Activity"], false);

const g_NativeAttachment = {
	Address: g_unAttachmentAddress,
	LocalTransform: CreateMatrixView(g_vecAttachmentTransformState, g_unAttachmentAddress + 0x20n),
};

InstallLiveProperties(g_NativeAttachment, g_AttachmentState, ["NameOffset", "Flags", "LocalBone"]);
InstallLiveProperties(g_NativeAttachment, g_AttachmentState, ["Name"], false);

g_NativeModelHeader = {
	Address: g_unModelHeaderAddress,
	EyePosition: CreateVectorView(g_EyePositionState, g_unModelHeaderAddress + 0x40n),
	IlluminationCenter: CreateVectorView(g_IlluminationCenterState, g_unModelHeaderAddress + 0x50n),
	HullMinimums: CreateVectorView(g_HullMinimumsState, g_unModelHeaderAddress + 0x60n),
	HullMaximums: CreateVectorView(g_HullMaximumsState, g_unModelHeaderAddress + 0x70n),
	ViewMinimums: CreateVectorView(g_ViewMinimumsState, g_unModelHeaderAddress + 0x80n),
	ViewMaximums: CreateVectorView(g_ViewMaximumsState, g_unModelHeaderAddress + 0x90n),

	GetBone(nBoneIndex) {
		g_vecCallLog.push(["Header.GetBone", nBoneIndex]);

		const nValidatedIndex = RequireIndex(nBoneIndex, "bone index");
		if (nValidatedIndex === 0) {
			return g_NativeBone;
		}

		return null;
	},

	GetBoneController(nBoneControllerIndex) {
		g_vecCallLog.push(["Header.GetBoneController", nBoneControllerIndex]);

		const nValidatedIndex = RequireIndex(nBoneControllerIndex, "bone-controller index");
		if (nValidatedIndex === 0) {
			return g_NativeBoneController;
		}

		return null;
	},

	GetHitboxSet(nHitboxSetIndex) {
		g_vecCallLog.push(["Header.GetHitboxSet", nHitboxSetIndex]);

		const nValidatedIndex = RequireIndex(nHitboxSetIndex, "hitbox-set index");
		if (nValidatedIndex === 0) {
			return g_NativeHitboxSet;
		}

		return null;
	},

	GetHitbox(nHitboxIndex, nHitboxSetIndex = 0) {
		g_vecCallLog.push(["Header.GetHitbox", nHitboxIndex, nHitboxSetIndex]);

		const nValidatedIndex = RequireIndex(nHitboxIndex, "hitbox index");
		const nValidatedHitboxSetIndex = RequireIndex(nHitboxSetIndex, "hitbox-set index");
		if (nValidatedIndex !== 0) {
			return null;
		}

		if (nValidatedHitboxSetIndex === 0) {
			return g_NativeHitbox;
		}

		return null;
	},

	GetLocalSequence(nLocalSequenceIndex) {
		g_vecCallLog.push(["Header.GetLocalSequence", nLocalSequenceIndex]);

		const nValidatedIndex = RequireIndex(nLocalSequenceIndex, "sequence index");
		if (nValidatedIndex === 0) {
			return g_NativeSequence;
		}

		return null;
	},

	GetAttachment(nAttachmentIndex) {
		g_vecCallLog.push(["Header.GetAttachment", nAttachmentIndex]);

		const nValidatedIndex = RequireIndex(nAttachmentIndex, "attachment index");
		if (nValidatedIndex === 0) {
			return g_NativeAttachment;
		}

		return null;
	},

	Bones() {
		g_vecCallLog.push(["Header.Bones"]);

		return [g_NativeBone];
	},

	BoneControllers() {
		g_vecCallLog.push(["Header.BoneControllers"]);

		return [g_NativeBoneController];
	},

	HitboxSets() {
		g_vecCallLog.push(["Header.HitboxSets"]);

		return [g_NativeHitboxSet];
	},

	LocalSequences() {
		g_vecCallLog.push(["Header.LocalSequences"]);

		return [g_NativeSequence];
	},

	Attachments() {
		g_vecCallLog.push(["Header.Attachments"]);

		return [g_NativeAttachment];
	},
};

InstallLiveProperties(g_NativeModelHeader, g_HeaderState, [
	"ID",
	"Version",
	"Checksum",
	"Length",
	"Flags",
	"BoneCount",
	"BoneOffset",
	"BoneControllerCount",
	"BoneControllerOffset",
	"HitboxSetCount",
	"HitboxSetOffset",
	"LocalAnimationCount",
	"LocalAnimationOffset",
	"AttachmentCount",
	"AttachmentOffset",
	"LocalSequenceCount",
	"LocalSequenceOffset",
	"Mass",
	"Contents",
]);
InstallLiveProperties(g_NativeModelHeader, g_HeaderState, ["Name"], false);

function CreateModelRecord(hHandle, bIncludeReferenceCount) {
	const Model = {
		Handle: hHandle,

		IsValid() {
			const hModelHandle = this.Handle;
			if (!Number.isInteger(hModelHandle) || (hModelHandle < 0) || (hModelHandle > g_hInvalidModelHandle)) {
				throw new TypeError("ModelHandle must fit the selected SDK range");
			}

			return hModelHandle !== g_hInvalidModelHandle;
		},

		GetName() {
			return g_NativeStudio.GetModelName(this.Handle);
		},
	};

	if (bIncludeReferenceCount) {
		Model.GetReferenceCount = function GetModelReferenceCount() {
			return g_NativeStudio.GetReferenceCount(this.Handle);
		};
	}

	return Model;
}

const g_ModelCacheDataType = {
	AnimationBlock: 3,
	DecodedAnimationBlock: 6,
	PhysicsCollision: 2,
	StudioHardwareData: 1,
	StudioHeader: 0,
	Vertices: 5,
	VirtualModel: 4,
};

const g_ModelType = { Bad: 0, Brush: 1, Sprite: 2, Studio: 3 };

const g_StudioFlags = {
	DrawTranslucentSubmodels: 0x04,
	ItemBlink: 0x40,
	NoShadows: 0x80,
	None: 0x0,
	Render: 0x01,
	ShadowDepthTexture: 0x40000000,
	StaticLighting: 0x10,
	Transparency: 0x80000000,
	TwoPass: 0x08,
	ViewTransformAttachments: 0x02,
	Wireframe: 0x20,
	WireframePhysicsCollision: 0x100,
};

function ResolveModelHandle(strPathName) {
	if (strPathName === g_strModelPath) {
		return g_hModelHandle;
	}

	return g_hInvalidModelHandle;
}

const g_NativeStudio = {
	INVALID_ATTACHMENT_INDEX: -1,
	INVALID_BONE_INDEX: -1,
	INVALID_MODEL_HANDLE: g_hInvalidModelHandle,
	ModelCacheDataType: g_ModelCacheDataType,
	ModelType: g_ModelType,
	StudioFlags: g_StudioFlags,

	AddReference(hHandle) {
		RequireHandle(hHandle);
		g_unReferenceCount += 1;
		g_vecCallLog.push(["AddReference", hHandle]);

		return g_unReferenceCount;
	},

	FindModel(strModelPath) {
		const strPathName = RequirePath(strModelPath);
		const hHandle = ResolveModelHandle(strPathName);
		if (hHandle !== g_hInvalidModelHandle) {
			g_unReferenceCount += 1;
		}

		g_vecCallLog.push(["FindModel", strPathName]);

		return CreateModelRecord(hHandle, true);
	},

	FindModelHandle(strModelPath) {
		const strPathName = RequirePath(strModelPath);
		const hHandle = ResolveModelHandle(strPathName);
		if (hHandle !== g_hInvalidModelHandle) {
			g_unReferenceCount += 1;
		}

		g_vecCallLog.push(["FindModelHandle", strPathName]);

		return hHandle;
	},

	GetModelHeader(hHandle) {
		RequireHandle(hHandle);
		g_vecCallLog.push(["GetModelHeader", hHandle]);

		if (hHandle === g_hModelHandle) {
			return g_NativeModelHeader;
		}

		return null;
	},

	GetModelHeaderAddress(hHandle) {
		RequireHandle(hHandle);
		g_vecCallLog.push(["GetModelHeaderAddress", hHandle]);

		if (hHandle === g_hModelHandle) {
			return g_unModelHeaderAddress;
		}

		return 0n;
	},

	GetModelName(hHandle) {
		RequireHandle(hHandle);
		g_vecCallLog.push(["GetModelName", hHandle]);

		if (hHandle !== g_hModelHandle) {
			throw new Error("model name is unavailable");
		}

		return g_strModelPath;
	},

	GetReferenceCount(hHandle) {
		RequireHandle(hHandle);
		g_vecCallLog.push(["GetReferenceCount", hHandle]);

		return g_unReferenceCount;
	},

	Release(hHandle) {
		RequireHandle(hHandle);

		if (g_unReferenceCount <= 0) {
			throw new Error("model reference count underflow");
		}

		g_unReferenceCount -= 1;
		g_vecCallLog.push(["Release", hHandle]);

		return g_unReferenceCount;
	},

	RequireModelHeader(hHandle) {
		const Header = g_NativeStudio.GetModelHeader(hHandle);
		if (Header === null) {
			throw new Error("model header is unavailable");
		}

		return Header;
	},
};

function CreateOldConsoleStudio() {
	const OldDataTypes = { ...g_ModelCacheDataType };
	const OldFlags = { ...g_StudioFlags };
	const OldStudio = { ...g_NativeStudio };

	delete OldDataTypes.DecodedAnimationBlock;
	delete OldFlags.ShadowDepthTexture;
	delete OldFlags.WireframePhysicsCollision;
	delete OldStudio.GetReferenceCount;
	OldStudio.ModelCacheDataType = OldDataTypes;
	OldStudio.StudioFlags = OldFlags;
	OldStudio.FindModel = (strPathValue) => {
		const Model = g_NativeStudio.FindModel(strPathValue);
		delete Model.GetReferenceCount;

		return Model;
	};

	return OldStudio;
}

function ExecuteCodeBlock(strSource, unIndex, StudioAPI) {
	const unCompilationTimeoutMilliseconds = 1000;

	const strDocumentationBlockPath = `${g_strDocumentationPath}:example-${unIndex + 1}.js`;
	const ModuleRecord = new g_Module(strDocumentationBlockPath, module);
	ModuleRecord.filename = strDocumentationBlockPath;
	ModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
	ModuleRecord.require = function RequireDocumentationModule(strIdentifier) {
		if (strIdentifier === "studio") {
			return StudioAPI;
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
	const vecImportMatch = strSource.match(/const\s*\{([\s\S]*?)\}\s*=\s*require\("studio"\);/);
	g_Assert.ok(vecImportMatch, "documentation starts with a destructured studio import");

	const vecImportNames = [];
	const vecRawImportNames = vecImportMatch[1].split(",");
	for (const strRawImportName of vecRawImportNames) {
		const strImportName = strRawImportName.split(":", 1)[0].trim();
		if (strImportName.length > 0) {
			vecImportNames.push(strImportName);
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

function CaptureStudioOutcome(Callback) {
	try {
		return { Thrown: false, Result: Callback() };
	} catch (ExceptionValue) {
		return { Thrown: true, Error: ExceptionValue };
	}
}

function AssertStudioReferenceFailures(strSource, unBlockIndex, strWorkflowName) {
	const hSecondaryModelHandle = 13;
	const bInspection = strWorkflowName === "CreateModelInspection";
	const vecThrownValues = [undefined, null, false, 0, "", Symbol("ReferenceFailure"), new Error("Reference failure")];
	let unScenarioCount = 0;

	const RunScenario = Options => {
		const hRecordHandle = Options.InvalidModel ? g_hInvalidModelHandle : g_hModelHandle;
		const hDirectHandle = Options.InvalidDirectHandle ? g_hInvalidModelHandle : (bInspection ? hSecondaryModelHandle : g_hModelHandle);
		const mapReferences = new Map([[g_hModelHandle, 0], [hSecondaryModelHandle, 0]]);
		const vecReleaseHandles = [];
		const vecCleanupErrors = [];
		const vecUnconfirmedHandles = [];
		let unCallbackCount = 0;
		let unLookupCount = 0;
		let Controller = undefined;

		const FailOperation = strOperationName => {
			if (Options.OperationName === strOperationName) {
				throw Options.OperationError;
			}
		};

		const Acquire = hModelHandle => {
			if (hModelHandle !== g_hInvalidModelHandle) {
				mapReferences.set(hModelHandle, mapReferences.get(hModelHandle) + 1);
			}

			return hModelHandle;
		};

		const StudioAPI = {
			INVALID_MODEL_HANDLE: g_hInvalidModelHandle,

			FindModel() {
				unLookupCount += 1;
				FailOperation("FindModel");
				Acquire(hRecordHandle);

				const Model = {
					Handle: hRecordHandle,

					IsValid() {
						FailOperation("IsValid");

						return this.Handle !== g_hInvalidModelHandle;
					},

					GetName() {
						return g_strModelPath;
					},
				};

				if (!Options.MissingReferenceCount) {
					Model.GetReferenceCount = function GetModelReferenceCount() {
						return mapReferences.get(this.Handle);
					};
				}

				return Model;
			},

			FindModelHandle() {
				unLookupCount += 1;
				FailOperation("FindModelHandle");

				return Acquire(hDirectHandle);
			},

			GetModelName() {
				return g_strModelPath;
			},

			AddReference(hModelHandle) {
				if ((Options.OperationName !== "AddReference") || Options.AddAfterMutation) {
					Acquire(hModelHandle);
				}

				FailOperation("AddReference");

				return mapReferences.get(hModelHandle);
			},

			GetReferenceCount(hModelHandle) {
				FailOperation("GetReferenceCount");

				return mapReferences.get(hModelHandle);
			},

			Release(hModelHandle) {
				g_Assert.equal(mapReferences.get(hModelHandle) > 0, true, "release uses an originally acquired handle, never overwritten metadata");
				vecReleaseHandles.push(hModelHandle);

				if (Controller) {
					g_Assert.throws(() => Controller.Inspect(), /disposed/, "inspection is disarmed before native cleanup reenters");
					g_Assert.equal(Controller.Dispose(), false, "reentrant disposal cannot replay release");
				}

				const bFailRelease = (Options.CleanupFailureMask & (0x01 << (vecReleaseHandles.length - 1))) !== 0;
				if (!bFailRelease || Options.ReleaseAfterMutation) {
					mapReferences.set(hModelHandle, mapReferences.get(hModelHandle) - 1);
				}

				if (bFailRelease) {
					const CleanupError = (vecReleaseHandles.length === 1) ? Options.FirstCleanupError : Options.SecondCleanupError;
					vecCleanupErrors.push(CleanupError);
					vecUnconfirmedHandles.push(hModelHandle);
					throw CleanupError;
				}

				return mapReferences.get(hModelHandle);
			},
		};

		if (Options.MissingReferenceCount) {
			StudioAPI.GetReferenceCount = Options.MissingReferenceCount.Value;
		}

		const Workflows = ExecuteCodeBlock(strSource, unBlockIndex, StudioAPI);
		const Callback = ReferenceInformation => {
			unCallbackCount += 1;
			g_Assert.equal(ReferenceInformation.Handle, g_hModelHandle);
			g_Assert.equal(ReferenceInformation.CountAfterAdd, 2);
			g_Assert.equal(Object.hasOwn(ReferenceInformation, "CurrentReferenceCount"), !Options.MissingReferenceCount, "old-console reference counts remain optional");
			FailOperation("Callback");

			return Options.CallbackResult;
		};

		let Outcome = CaptureStudioOutcome(() => bInspection ? Workflows.CreateModelInspection(g_strModelPath) : Workflows.WithAdditionalModelReference(g_strModelPath, Options.InvalidCallback ? Options.InvalidCallback.Value : Callback));
		if (Options.InvalidCallback) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.match(Outcome.Error.message, /Callback must be a function/);
			g_Assert.equal(unLookupCount, 0, "callback validation precedes every model acquisition");
			g_Assert.equal(vecReleaseHandles.length, 0);
			unScenarioCount += 1;
			return;
		}

		if (bInspection && (Options.OperationName === "Dispose")) {
			g_Assert.equal(Outcome.Thrown, false, "both acquisitions succeed before disposal faults");
			Controller = Outcome.Result;
			Controller.Model.Handle = g_hInvalidModelHandle;
			Outcome = CaptureStudioOutcome(() => Controller.Dispose());
			g_Assert.equal(Controller.Dispose(), false, "failed release is not replayed");
			g_Assert.throws(() => Controller.Inspect(), /disposed/);
		}

		const bUnavailable = Options.InvalidModel || Options.InvalidDirectHandle;
		const vecExpectedHandles = [];
		if (bInspection) {
			if ((Options.OperationName !== "FindModel") && !Options.InvalidModel) {
				vecExpectedHandles.push(hRecordHandle);
			}

			if ((Options.OperationName !== "FindModel") && (Options.OperationName !== "FindModelHandle") && !Options.InvalidDirectHandle) {
				vecExpectedHandles.push(hDirectHandle);
			}

		} else if (Options.OperationName !== "FindModelHandle") {
			vecExpectedHandles.push(hDirectHandle);

			if (Options.OperationName !== "AddReference") {
				vecExpectedHandles.push(hDirectHandle);
			}
		}

		g_Assert.deepEqual(vecReleaseHandles, vecExpectedHandles, "every confirmed acquisition gets one independent cleanup attempt in original order");

		const bAddOutcomeUnknown = !bInspection && (Options.OperationName === "AddReference");
		const bOperationFailed = !["None", "Dispose"].includes(Options.OperationName);
		if ((vecCleanupErrors.length > 0) || bAddOutcomeUnknown) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.equal(Outcome.Error && Outcome.Error.name, "AggregateError");
			const vecExpectedErrors = bOperationFailed ? [Options.OperationError, ...vecCleanupErrors] : vecCleanupErrors;
			g_Assert.deepEqual(Array.from(Outcome.Error.errors), vecExpectedErrors, "primary and all cleanup exceptions preserve identity and order");

			if (bInspection) {
				g_Assert.deepEqual(Array.from(Outcome.Error.UnconfirmedModelHandles), vecUnconfirmedHandles);

			} else {
				g_Assert.equal(Outcome.Error.ModelHandle, hDirectHandle);
				g_Assert.equal(Outcome.Error.UnconfirmedReleaseCount, vecCleanupErrors.length);
				g_Assert.equal(Outcome.Error.AddReferenceOutcomeUnknown, bAddOutcomeUnknown);
			}

		} else if (bOperationFailed || bUnavailable) {
			g_Assert.equal(Outcome.Thrown, true);

			if (bUnavailable) {
				g_Assert.match(Outcome.Error.message, /Model is unavailable/);

			} else {
				g_Assert.equal(Outcome.Error, Options.OperationError, "successful cleanup preserves falsy operation exceptions");
			}

		} else {
			g_Assert.equal(Outcome.Thrown, false);
			g_Assert.equal(Outcome.Result, bInspection ? true : Options.CallbackResult);
		}

		const unExpectedRemainingReferences = (Options.ReleaseAfterMutation ? 0 : vecCleanupErrors.length) + ((bAddOutcomeUnknown && Options.AddAfterMutation) ? 1 : 0);
		g_Assert.equal(mapReferences.get(g_hModelHandle) + mapReferences.get(hSecondaryModelHandle), unExpectedRemainingReferences, "unknown native mutations are not guessed or blindly replayed");

		if (!bInspection) {
			g_Assert.equal(unCallbackCount, ["None", "Callback"].includes(Options.OperationName) ? 1 : 0);
		}

		unScenarioCount += 1;
	};

	const vecOperationNames = bInspection ? ["FindModel", "FindModelHandle", "IsValid", "Dispose"] : ["FindModelHandle", "AddReference", "GetReferenceCount", "Callback"];
	for (const strOperationName of vecOperationNames) {
		const unMaximumReleaseCount = ((strOperationName === "FindModel") || (!bInspection && (strOperationName === "FindModelHandle"))) ? 0 : (["FindModelHandle", "AddReference"].includes(strOperationName) ? 1 : 2);
		const vecFailureMasks = (unMaximumReleaseCount === 0) ? [0x0] : ((unMaximumReleaseCount === 1) ? [0x0, 0x01] : ((strOperationName === "Dispose") ? [0x01, 0x02, 0x03] : [0x0, 0x01, 0x02, 0x03]));
		for (const OperationError of vecThrownValues) {
			for (const unCleanupFailureMask of vecFailureMasks) {
				for (const bReleaseAfterMutation of (unMaximumReleaseCount === 0) ? [false] : [false, true]) {
					for (const bAddAfterMutation of (strOperationName === "AddReference") ? [false, true] : [false]) {
						RunScenario({ OperationName: strOperationName, OperationError, CleanupFailureMask: unCleanupFailureMask, ReleaseAfterMutation: bReleaseAfterMutation, AddAfterMutation: bAddAfterMutation, FirstCleanupError: OperationError, SecondCleanupError: Symbol("SecondReleaseFailure") });
					}
				}
			}
		}
	}

	if (bInspection) {
		RunScenario({ OperationName: "Dispose", CleanupFailureMask: 0x0 });

		for (const Options of [{ InvalidModel: true }, { InvalidDirectHandle: true }, { InvalidModel: true, InvalidDirectHandle: true }]) {
			RunScenario({ OperationName: "None", ...Options });
		}

	} else {
		for (const CallbackResult of vecThrownValues) {
			for (const unCleanupFailureMask of [0x0, 0x01, 0x02, 0x03]) {
				for (const bReleaseAfterMutation of [false, true]) {
					RunScenario({ OperationName: "None", CallbackResult, CleanupFailureMask: unCleanupFailureMask, ReleaseAfterMutation: bReleaseAfterMutation, FirstCleanupError: CallbackResult, SecondCleanupError: Symbol("SecondReleaseFailure") });
				}
			}
		}

		for (const Value of [undefined, null, 0]) {
			RunScenario({ OperationName: "None", MissingReferenceCount: { Value } });
		}

		for (const Value of [undefined, null, false, 0, "", 1n, {}, []]) {
			RunScenario({ InvalidCallback: { Value } });
		}
	}

	g_Assert.equal(unScenarioCount, bInspection ? 137 : 242, "all studio reference scenarios ran");
}

function AssertStudioHeaderCleanupFailures(strSource, unBlockIndex) {
	const vecThrownValues = [undefined, null, false, 0, "", Symbol("HeaderFailure"), new Error("Header failure")];
	let unScenarioCount = 0;

	const RunScenario = Options => {
		let unReferences = 0;
		let unReleaseCount = 0;
		let Controller = undefined;

		const FailOperation = strOperationName => {
			if (Options.OperationName === strOperationName) {
				throw Options.OperationError;
			}
		};

		const StudioAPI = {
			INVALID_MODEL_HANDLE: g_hInvalidModelHandle,

			FindModelHandle() {
				FailOperation("FindModelHandle");

				if (Options.InvalidHandle) {
					return g_hInvalidModelHandle;
				}

				unReferences += 1;

				return g_hModelHandle;
			},

			GetModelHeader() {
				FailOperation("GetModelHeader");

				return (Options.OperationName === "AbsentNullable") ? null : g_NativeModelHeader;
			},

			GetModelHeaderAddress() {
				FailOperation("GetModelHeaderAddress");

				return (Options.OperationName === "AbsentAddress") ? 0n : g_unModelHeaderAddress;
			},

			RequireModelHeader() {
				FailOperation("RequireModelHeader");

				return g_NativeModelHeader;
			},

			Release(hModelHandle) {
				g_Assert.equal(hModelHandle, g_hModelHandle);
				unReleaseCount += 1;
				g_Assert.equal(unReleaseCount, 1, "header cleanup never replays a release");

				if (Controller) {
					g_Assert.throws(() => Controller.Inspect(), /disposed/);
					g_Assert.equal(Controller.Dispose(), false, "header owner disarms before reentrant release");
				}

				if (!Options.FailRelease || Options.ReleaseAfterMutation) {
					unReferences -= 1;
				}

				if (Options.FailRelease) {
					throw Options.CleanupError;
				}

				return unReferences;
			},
		};

		const Workflows = ExecuteCodeBlock(strSource, unBlockIndex, StudioAPI);
		let Outcome = CaptureStudioOutcome(() => Workflows.CreateModelHeaderInspection(g_strModelPath));
		if (!Outcome.Thrown) {
			Controller = Outcome.Result;
			g_Assert.equal(Controller.Header, g_NativeModelHeader);
			Outcome = CaptureStudioOutcome(() => Controller.Dispose());
			g_Assert.equal(Controller.Dispose(), false, "header disposal stays disarmed after failure");
			g_Assert.throws(() => Controller.Inspect(), /disposed/);
		}

		const bAcquired = (Options.OperationName !== "FindModelHandle") && !Options.InvalidHandle;
		g_Assert.equal(unReleaseCount, bAcquired ? 1 : 0);
		g_Assert.equal(unReferences, (bAcquired && Options.FailRelease && !Options.ReleaseAfterMutation) ? 1 : 0);

		if (Options.FailRelease && bAcquired) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.equal(Outcome.Error && Outcome.Error.name, "AggregateError");
			g_Assert.equal(Outcome.Error.ModelHandle, g_hModelHandle);
			g_Assert.equal(Outcome.Error.ReferenceReleaseOutcomeUnknown, true);
			const vecErrors = Array.from(Outcome.Error.errors);
			g_Assert.equal(vecErrors.at(-1), Options.CleanupError, "falsy cleanup errors retain identity");

			if (["AbsentNullable", "AbsentAddress"].includes(Options.OperationName)) {
				g_Assert.equal(vecErrors.length, 2);
				g_Assert.match(vecErrors[0].message, /header is not loaded/);

			} else {
				g_Assert.deepEqual(vecErrors, (Options.OperationName === "Dispose") ? [Options.CleanupError] : [Options.OperationError, Options.CleanupError]);
			}

		} else if (["AbsentNullable", "AbsentAddress"].includes(Options.OperationName) || Options.InvalidHandle) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.match(Outcome.Error.message, Options.InvalidHandle ? /Model is unavailable/ : /header is not loaded/);

		} else if (["None", "Dispose"].includes(Options.OperationName)) {
			g_Assert.equal(Outcome.Thrown, false);
			g_Assert.equal(Outcome.Result, true);

		} else {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.equal(Outcome.Error, Options.OperationError);
		}

		unScenarioCount += 1;
	};

	for (const OperationError of vecThrownValues) {
		RunScenario({ OperationName: "FindModelHandle", OperationError });

		for (const strOperationName of ["GetModelHeader", "GetModelHeaderAddress", "RequireModelHeader"]) {
			for (const ReleaseOptions of [{ FailRelease: false }, { FailRelease: true }, { FailRelease: true, ReleaseAfterMutation: true }]) {
				RunScenario({ OperationName: strOperationName, OperationError, CleanupError: OperationError, ...ReleaseOptions });
			}
		}

		for (const bReleaseAfterMutation of [false, true]) {
			RunScenario({ OperationName: "Dispose", FailRelease: true, ReleaseAfterMutation: bReleaseAfterMutation, CleanupError: OperationError });
		}
	}

	for (const strOperationName of ["AbsentNullable", "AbsentAddress"]) {
		for (const ReleaseOptions of [{ FailRelease: false }, { FailRelease: true }, { FailRelease: true, ReleaseAfterMutation: true }]) {
			RunScenario({ OperationName: strOperationName, CleanupError: null, ...ReleaseOptions });
		}
	}

	RunScenario({ OperationName: "None" });
	RunScenario({ OperationName: "None", InvalidHandle: true });
	g_Assert.equal(unScenarioCount, 92, "all header setup/disposal failure scenarios ran");
}

function AssertStudioBoneCleanupFailures(strSource, unBlockIndex) {
	const vecThrownValues = [undefined, null, false, 0, "", Symbol("BoneFailure"), new Error("Bone failure")];
	const vecSetupNames = ["FindModelHandle", "RequireModelHeader", "Bones", "GetBone", "ReadPosition", "ReadMatrix"];
	let unScenarioCount = 0;

	const RunScenario = Options => {
		let unLookupCount = 0;
		let unReferences = 0;
		let flPositionX = 7;
		let flMatrixX = 11;
		let unPositionReads = 0;
		let unMatrixReads = 0;
		let unPositionWrites = 0;
		let unMatrixWrites = 0;
		const vecCleanupNames = [];
		const vecCleanupErrors = [];
		const vecFailureNames = ["Position", "Matrix", "Release"];
		const vecFailureValues = Options.CleanupValues || [Options.OperationError, Symbol("MatrixRestorationFailure"), Symbol("ReferenceReleaseFailure")];

		const FailOperation = strOperationName => {
			if (Options.OperationName === strOperationName) {
				throw Options.OperationError;
			}
		};

		const Cleanup = (unFailureIndex, ApplyMutation) => {
			vecCleanupNames.push(vecFailureNames[unFailureIndex]);
			const bFailed = (Options.CleanupFailureMask & (0x01 << unFailureIndex)) !== 0;
			if (!bFailed || Options.CleanupAfterMutation) {
				ApplyMutation();
			}

			if (bFailed) {
				const ErrorValue = vecFailureValues[unFailureIndex];
				vecCleanupErrors.push(ErrorValue);
				throw ErrorValue;
			}
		};

		const Position = {
			Address: g_unBoneAddress + 0x40n,
			Y: 0,
			Z: 0,

			get X() {
				unPositionReads += 1;

				if (unPositionReads === 1) {
					FailOperation("ReadPosition");
				}

				return flPositionX;
			},

			set X(flValue) {
				unPositionWrites += 1;

				if (unPositionWrites > 1) {
					Cleanup(0, () => {
						flPositionX = flValue;
					});
					return;
				}

				if ((Options.OperationName !== "WritePosition") || Options.WriteAfterMutation) {
					flPositionX = flValue;
				}

				FailOperation("WritePosition");
			},
		};

		const vecMatrixRow = [1, 0, 0, 11];
		Object.defineProperty(vecMatrixRow, "3", {
			get() {
				unMatrixReads += 1;

				if (unMatrixReads === 1) {
					FailOperation("ReadMatrix");
				}

				return flMatrixX;
			},

			set(flValue) {
				unMatrixWrites += 1;

				if (unMatrixWrites > 1) {
					Cleanup(1, () => {
						flMatrixX = flValue;
					});
					return;
				}

				if ((Options.OperationName !== "WriteMatrix") || Options.WriteAfterMutation) {
					flMatrixX = flValue;
				}

				FailOperation("WriteMatrix");
			},
		});

		const vecMatrixRows = [vecMatrixRow];
		vecMatrixRows.Address = g_unBoneAddress + 0x90n;

		const Bone = {
			...g_NativeBone,
			Position,
			PositionToBone: vecMatrixRows,
			Parent: -1,

			GetProcedureAddress() {
				FailOperation("GetProcedureAddress");

				return 0n;
			},
		};

		const Header = {
			Bones() {
				FailOperation("Bones");

				return (Options.OperationName === "NoRoot") ? [] : [Bone];
			},

			GetBone() {
				FailOperation("GetBone");

				return (Options.OperationName === "AbsentBone") ? null : Bone;
			},
		};

		const StudioAPI = {
			INVALID_MODEL_HANDLE: g_hInvalidModelHandle,
			INVALID_BONE_INDEX: -1,

			FindModelHandle() {
				unLookupCount += 1;
				FailOperation("FindModelHandle");
				unReferences += 1;

				return g_hModelHandle;
			},

			RequireModelHeader() {
				FailOperation("RequireModelHeader");

				return Header;
			},

			Release(hModelHandle) {
				g_Assert.equal(hModelHandle, g_hModelHandle);
				Cleanup(2, () => {
					unReferences -= 1;
				});

				return unReferences;
			},
		};

		const Workflows = ExecuteCodeBlock(strSource, unBlockIndex, StudioAPI);
		const Outcome = CaptureStudioOutcome(() => Workflows.TemporarilyOffsetRootBone(g_strModelPath, Options.Offset));
		if (Options.InvalidOffset) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.match(Outcome.Error.message, /Offset must be a finite number/);
			g_Assert.equal(unLookupCount, 0, "offset validation precedes acquisition");
			g_Assert.equal(vecCleanupNames.length, 0);
			unScenarioCount += 1;
			return;
		}

		const bAcquired = Options.OperationName !== "FindModelHandle";
		const bPositionAttempted = !vecSetupNames.includes(Options.OperationName) && !["NoRoot", "AbsentBone"].includes(Options.OperationName);
		const bMatrixAttempted = bPositionAttempted && (Options.OperationName !== "WritePosition");
		const vecExpectedCleanupNames = [...(bPositionAttempted ? ["Position"] : []), ...(bMatrixAttempted ? ["Matrix"] : []), ...(bAcquired ? ["Release"] : [])];
		g_Assert.deepEqual(vecCleanupNames, vecExpectedCleanupNames, "each attempted write restores independently before one reference release");
		g_Assert.equal(unReferences, (bAcquired && ((Options.CleanupFailureMask & 0x04) !== 0) && !Options.CleanupAfterMutation) ? 1 : 0);

		const flOffset = (Options.Offset === undefined) ? 0.125 : Options.Offset;
		const bPositionMutated = bPositionAttempted && ((Options.OperationName !== "WritePosition") || Options.WriteAfterMutation);
		const bMatrixMutated = bMatrixAttempted && ((Options.OperationName !== "WriteMatrix") || Options.WriteAfterMutation);
		g_Assert.equal(flPositionX, (bPositionMutated && ((Options.CleanupFailureMask & 0x01) !== 0) && !Options.CleanupAfterMutation) ? (7 + flOffset) : 7);
		g_Assert.equal(flMatrixX, (bMatrixMutated && ((Options.CleanupFailureMask & 0x02) !== 0) && !Options.CleanupAfterMutation) ? (11 + flOffset) : 11);

		if (vecCleanupErrors.length > 0) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.equal(Outcome.Error && Outcome.Error.name, "AggregateError");
			g_Assert.equal(Outcome.Error.ModelHandle, g_hModelHandle);
			g_Assert.equal(Outcome.Error.PositionRestorationOutcomeUnknown, bPositionAttempted && ((Options.CleanupFailureMask & 0x01) !== 0));
			g_Assert.equal(Outcome.Error.MatrixRestorationOutcomeUnknown, bMatrixAttempted && ((Options.CleanupFailureMask & 0x02) !== 0));
			g_Assert.equal(Outcome.Error.ReferenceReleaseOutcomeUnknown, (Options.CleanupFailureMask & 0x04) !== 0);
			const vecErrors = Array.from(Outcome.Error.errors);
			if (["NoRoot", "AbsentBone"].includes(Options.OperationName)) {
				g_Assert.match(vecErrors[0].message, (Options.OperationName === "NoRoot") ? /no root bone/ : /Root bone is unavailable/);
				g_Assert.deepEqual(vecErrors.slice(1), vecCleanupErrors);

			} else {
				g_Assert.deepEqual(vecErrors, (Options.OperationName === "None") ? vecCleanupErrors : [Options.OperationError, ...vecCleanupErrors], "original and cleanup errors preserve falsy identities and order");
			}

		} else if (Options.OperationName !== "None") {
			g_Assert.equal(Outcome.Thrown, true);

			if (["NoRoot", "AbsentBone"].includes(Options.OperationName)) {
				g_Assert.match(Outcome.Error.message, (Options.OperationName === "NoRoot") ? /no root bone/ : /Root bone is unavailable/);

			} else {
				g_Assert.equal(Outcome.Error, Options.OperationError);
			}

		} else {
			g_Assert.equal(Outcome.Thrown, false);
			g_Assert.equal(Outcome.Result.Position.X, 7 + flOffset);
			g_Assert.equal(Outcome.Result.PositionToBone.Rows[0][3], 11 + flOffset);
		}

		unScenarioCount += 1;
	};

	for (const OperationError of vecThrownValues) {
		for (const strOperationName of [...vecSetupNames, "WritePosition", "WriteMatrix", "GetProcedureAddress"]) {
			const vecFailureMasks = (strOperationName === "FindModelHandle") ? [0x0] : (vecSetupNames.includes(strOperationName) ? [0x0, 0x04] : ((strOperationName === "WritePosition") ? [0x0, 0x01, 0x04, 0x05] : [0x0, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));
			for (const unFailureMask of vecFailureMasks) {
				for (const bCleanupAfterMutation of (unFailureMask === 0) ? [false] : [false, true]) {
					for (const bWriteAfterMutation of ["WritePosition", "WriteMatrix"].includes(strOperationName) ? [false, true] : [false]) {
						RunScenario({ OperationName: strOperationName, OperationError, CleanupFailureMask: unFailureMask, CleanupAfterMutation: bCleanupAfterMutation, WriteAfterMutation: bWriteAfterMutation });
					}
				}
			}
		}

		for (const unFailureMask of [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]) {
			for (const bCleanupAfterMutation of [false, true]) {
				RunScenario({ OperationName: "None", OperationError, CleanupFailureMask: unFailureMask, CleanupAfterMutation: bCleanupAfterMutation });
			}
		}
	}

	for (const strOperationName of ["NoRoot", "AbsentBone"]) {
		for (const ReleaseOptions of [{ CleanupFailureMask: 0x0 }, { CleanupFailureMask: 0x04 }, { CleanupFailureMask: 0x04, CleanupAfterMutation: true }]) {
			RunScenario({ OperationName: strOperationName, ...ReleaseOptions });
		}
	}

	for (const CleanupError of vecThrownValues) {
		for (const unFailureMask of [0x01, 0x02, 0x04]) {
			for (const bCleanupAfterMutation of [false, true]) {
				RunScenario({ OperationName: "None", CleanupFailureMask: unFailureMask, CleanupAfterMutation: bCleanupAfterMutation, CleanupValues: [CleanupError, CleanupError, CleanupError] });
			}
		}
	}

	for (const Offset of [null, false, true, NaN, Infinity, -Infinity, 1n, "0", {}, [], () => 0, Symbol("Offset"), new Number(0)]) {
		RunScenario({ InvalidOffset: true, Offset });
	}

	for (const flOffset of [undefined, 0, -0, 0.125, -0.125]) {
		RunScenario({ OperationName: "None", Offset: flOffset });
	}

	g_Assert.equal(unScenarioCount, 689, "all bone write/restoration/release scenarios ran");
}

function AssertStudioTemporaryEditFailures(strSource, unBlockIndex, strWorkflowName) {
	const vecThrownValues = [undefined, null, false, 0, "", Symbol("TemporaryEditFailure"), new Error("Temporary edit failure")];
	const bHitbox = strWorkflowName === "TemporarilyExpandHitbox";
	const bSequence = strWorkflowName === "TemporarilyAdjustFirstSequence";
	const bAttachment = strWorkflowName === "TemporarilyOffsetNamedAttachment";
	const unTargetCount = (bHitbox || bSequence) ? 2 : 1;
	const unReleaseFailureBit = 0x01 << unTargetCount;
	const unAllFailureBits = (unReleaseFailureBit << 1) - 1;
	let unScenarioCount = 0;

	const RunScenario = Options => {
		let unLookups = 0;
		let unReferences = 0;
		const vecAttemptedNames = [];
		const vecCleanupNames = [];
		const vecCleanupErrors = [];
		const vecFailureValues = [Options.ErrorValue, Symbol("SecondRestorationFailure"), Symbol("ReferenceReleaseFailure")];
		const Record = { ...(bHitbox ? g_NativeHitbox : (bSequence ? g_NativeSequence : (bAttachment ? g_NativeAttachment : g_NativeBoneController))) };

		const FailOperation = strOperationName => {
			if (Options.OperationName === strOperationName) {
				throw Options.ErrorValue;
			}
		};

		const vecTargets = [];
		if (bHitbox) {
			Record.Mins = { ...g_NativeHitbox.Mins };
			Record.Maxs = { ...g_NativeHitbox.Maxs };
			vecTargets.push({ Target: Record.Mins, Key: "X", Name: "Mins.X" }, { Target: Record.Maxs, Key: "X", Name: "Maxs.X" });

		} else if (bSequence) {
			Record.GetAnimationIndex = () => 7;
			Record.GetModelHeader = () => ({ Address: g_unModelHeaderAddress });
			vecTargets.push({ Target: Record, Key: "FadeInTime", Name: "FadeInTime" }, { Target: Record, Key: "FadeOutTime", Name: "FadeOutTime" });

		} else if (bAttachment) {
			Record.LocalTransform = Array.from(g_NativeAttachment.LocalTransform, vecRow => Array.from(vecRow));
			Record.LocalTransform.Address = g_NativeAttachment.LocalTransform.Address;
			vecTargets.push({ Target: Record.LocalTransform[0], Key: "3", Name: "LocalTransform[0][3]" });

		} else {
			vecTargets.push({ Target: Record, Key: "Start", Name: "Start" });
		}

		const vecOriginalValues = [];
		const vecCurrentValues = [];
		for (let unTargetIndex = 0; unTargetIndex < vecTargets.length; unTargetIndex += 1) {
			const Entry = vecTargets[unTargetIndex];
			vecOriginalValues.push(Entry.Target[Entry.Key]);
			vecCurrentValues.push(Entry.Target[Entry.Key]);
			let unReads = 0;
			let unWrites = 0;
			Object.defineProperty(Entry.Target, Entry.Key, {
				get() {
					unReads += 1;

					if (unReads === 1) {
						FailOperation(`Read${unTargetIndex}`);
					}

					return vecCurrentValues[unTargetIndex];
				},

				set(flValue) {
					unWrites += 1;

					if (unWrites === 1) {
						vecAttemptedNames.push(Entry.Name);

						if ((Options.OperationName !== `Write${unTargetIndex}`) || Options.WriteAfterMutation) {
							vecCurrentValues[unTargetIndex] = flValue;
						}

						FailOperation(`Write${unTargetIndex}`);
						return;
					}

					vecCleanupNames.push(Entry.Name);
					const bFailed = (Options.FailureMask & (0x01 << unTargetIndex)) !== 0;
					if (!bFailed || Options.CleanupAfterMutation) {
						vecCurrentValues[unTargetIndex] = flValue;
					}

					if (bFailed) {
						const ErrorValue = vecFailureValues[unTargetIndex];
						vecCleanupErrors.push(ErrorValue);
						throw ErrorValue;
					}
				},
			});
		}

		const unRecordAddress = Record.Address;
		Object.defineProperty(Record, "Address", {
			get() {
				FailOperation("Snapshot");

				return unRecordAddress;
			},
		});

		const Header = {
			Address: g_unModelHeaderAddress,

			BoneControllers: () => Options.Unavailable ? [] : [Record],
			GetBoneController: () => Record,
			LocalSequences: () => Options.Unavailable ? [] : [Record],
			GetLocalSequence: () => Record,
			Attachments: () => Options.Unavailable ? [] : [Record],
			GetAttachment: () => Record,
			GetHitboxSet: () => Options.Unavailable ? null : { GetHitbox: () => Record, Hitboxes: () => [Record] },
			GetHitbox: () => Record,
		};

		const StudioAPI = {
			INVALID_MODEL_HANDLE: g_hInvalidModelHandle,
			INVALID_ATTACHMENT_INDEX: -1,

			FindModelHandle() {
				unLookups += 1;
				FailOperation("FindModelHandle");
				unReferences += 1;

				return g_hModelHandle;
			},

			RequireModelHeader() {
				FailOperation("RequireModelHeader");

				return Header;
			},

			Release(hModelHandle) {
				g_Assert.equal(hModelHandle, g_hModelHandle);
				vecCleanupNames.push("Release");
				const bFailed = (Options.FailureMask & unReleaseFailureBit) !== 0;
				if (!bFailed || Options.CleanupAfterMutation) {
					unReferences -= 1;
				}

				if (bFailed) {
					const ErrorValue = vecFailureValues[unTargetCount];
					vecCleanupErrors.push(ErrorValue);
					throw ErrorValue;
				}
			},
		};

		const Workflows = ExecuteCodeBlock(strSource, unBlockIndex, StudioAPI);
		const vecArguments = [g_strModelPath, Options.EditValue];
		if (Options.IndexCase) {
			vecArguments.push(Options.IndexCase.SetIndex ? Options.IndexCase.Value : 0, Options.IndexCase.SetIndex ? 0 : Options.IndexCase.Value);
		}

		const Outcome = CaptureStudioOutcome(() => Workflows[strWorkflowName](...vecArguments));
		if (Options.InvalidValue) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.match(Outcome.Error.message, /must be a finite number/);
			g_Assert.equal(unLookups, 0, "numeric validation precedes acquisition");
			unScenarioCount += 1;
			return;
		}

		if (Options.IndexCase) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.match(Outcome.Error.message, /non-negative Int32 values/);
			g_Assert.equal(unLookups, 0, "both hitbox indexes validate before acquisition");
			g_Assert.equal(vecAttemptedNames.length, 0);
			unScenarioCount += 1;
			return;
		}

		const bAcquired = Options.OperationName !== "FindModelHandle";
		g_Assert.deepEqual(vecCleanupNames, [...vecAttemptedNames, ...(bAcquired ? ["Release"] : [])], "every attempted write restores once, independently, before release");
		g_Assert.equal(unReferences, (bAcquired && ((Options.FailureMask & unReleaseFailureBit) !== 0) && !Options.CleanupAfterMutation) ? 1 : 0);

		if (vecCleanupErrors.length > 0) {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.equal(Outcome.Error && Outcome.Error.name, "AggregateError");
			g_Assert.equal(Outcome.Error.ModelHandle, g_hModelHandle);
			const vecUnknownNames = vecTargets.filter((Entry, unIndex) => vecAttemptedNames.includes(Entry.Name) && ((Options.FailureMask & (0x01 << unIndex)) !== 0)).map(Entry => Entry.Name);
			g_Assert.deepEqual(Array.from(Outcome.Error.UnconfirmedRestorations), vecUnknownNames);
			g_Assert.equal(Outcome.Error.ReferenceReleaseOutcomeUnknown, (Options.FailureMask & unReleaseFailureBit) !== 0);
			g_Assert.deepEqual(Array.from(Outcome.Error.errors), (Options.OperationName === "None") ? vecCleanupErrors : [Options.ErrorValue, ...vecCleanupErrors], "ordered primary and cleanup errors retain identity");

		} else if (Options.OperationName !== "None") {
			g_Assert.equal(Outcome.Thrown, true);
			g_Assert.equal(Outcome.Error, Options.ErrorValue);

		} else {
			g_Assert.equal(Outcome.Thrown, false);
			g_Assert.equal(Outcome.Result === null, Boolean(Options.Unavailable));
		}

		if (!Options.FailureMask || Options.CleanupAfterMutation) {
			g_Assert.deepEqual(vecCurrentValues, vecOriginalValues, "successful restorations preserve original storage");
		}

		unScenarioCount += 1;
	};

	const vecTargetOperationNames = [];
	for (let unTargetIndex = 0; unTargetIndex < unTargetCount; unTargetIndex += 1) {
		vecTargetOperationNames.push(`Read${unTargetIndex}`, `Write${unTargetIndex}`);
	}

	for (const ErrorValue of vecThrownValues) {
		for (const strOperationName of ["FindModelHandle", "RequireModelHeader", ...vecTargetOperationNames, "Snapshot"]) {
			for (const unFailureMask of [0x0, unAllFailureBits]) {
				for (const bCleanupAfterMutation of (unFailureMask === 0) ? [false] : [false, true]) {
					for (const bWriteAfterMutation of strOperationName.startsWith("Write") ? [false, true] : [false]) {
						RunScenario({ OperationName: strOperationName, ErrorValue, FailureMask: unFailureMask, CleanupAfterMutation: bCleanupAfterMutation, WriteAfterMutation: bWriteAfterMutation });
					}
				}
			}
		}

		for (let unFailureMask = 0x1; unFailureMask <= unAllFailureBits; unFailureMask += 1) {
			for (const bCleanupAfterMutation of [false, true]) {
				RunScenario({ OperationName: "None", ErrorValue, FailureMask: unFailureMask, CleanupAfterMutation: bCleanupAfterMutation });
			}
		}
	}

	for (const EditValue of [null, false, true, NaN, Infinity, -Infinity, 1n, "0", {}, [], () => 0, Symbol("EditValue"), new Number(0)]) {
		RunScenario({ InvalidValue: true, EditValue });
	}

	if (bHitbox) {
		for (const Value of [null, false, 0.5, -1, 0x80000000, 0xFFFFFFFF, 1n, "0"]) {
			for (const bSetIndex of [false, true]) {
				RunScenario({ IndexCase: { SetIndex: bSetIndex, Value } });
			}
		}
	}

	RunScenario({ OperationName: "None" });
	RunScenario({ OperationName: "None", Unavailable: true });
	g_Assert.equal(unScenarioCount, bHitbox ? 318 : (bSequence ? 302 : 183), "all temporary-edit failure scenarios ran");
}

function ReadMutableStudioState(bIncludeCallCount = true) {
	const State = ToPlainValue({
		AttachmentState: g_AttachmentState,
		AttachmentTransformState: g_vecAttachmentTransformState,
		BoneAlignmentState: g_BoneAlignmentState,
		BoneControllerIndexesState: g_vecBoneControllerIndexesState,
		BoneControllerState: g_BoneControllerState,
		BonePositionScaleState: g_BonePositionScaleState,
		BonePositionState: g_BonePositionState,
		BonePositionToBoneState: g_vecBonePositionToBoneState,
		BoneQuaternionState: g_BoneQuaternionState,
		BoneRadianEulerScaleState: g_BoneRadianEulerScaleState,
		BoneRadianEulerState: g_BoneRadianEulerState,
		BoneState: g_BoneState,
		EyePositionState: g_EyePositionState,
		HeaderState: g_HeaderState,
		HitboxMaximumsState: g_HitboxMaximumsState,
		HitboxMinimumsState: g_HitboxMinimumsState,
		HitboxSetState: g_HitboxSetState,
		HitboxState: g_HitboxState,
		HullMaximumsState: g_HullMaximumsState,
		HullMinimumsState: g_HullMinimumsState,
		IlluminationCenterState: g_IlluminationCenterState,
		ReferenceCount: g_unReferenceCount,
		SequenceMaximumsState: g_SequenceMaximumsState,
		SequenceMinimumsState: g_SequenceMinimumsState,
		SequenceState: g_SequenceState,
		ViewMaximumsState: g_ViewMaximumsState,
		ViewMinimumsState: g_ViewMinimumsState,
	});

	if (bIncludeCallCount) {
		State.CallCount = g_vecCallLog.length;
	}

	return State;
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

function VerifyWorldHitboxExample(Studio) {
	const unScriptTimeoutMilliseconds = 1000;

	const strExamplePath = g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecFunctions = ["IsInt32", "ParseVectorArgument", "AreBoundsOrdered", "ParseHitboxArguments", "LogHitboxUsage", "UpdateHitbox"].map((strName) => {
		const nStart = strExample.indexOf(`\nfunction ${strName}(`);
		const nEnd = strExample.indexOf("\nfunction ", nStart + 1);
		g_Assert.ok((nStart >= 0) && (nEnd > nStart), `world helper ${strName} must remain available`);

		return strExample.slice(nStart, nEnd);
	});

	class Vector {
		constructor(flX, flY, flZ) {
			this.X = flX;
			this.Y = flY;
			this.Z = flZ;
		}
	}

	const Header = Studio.GetModelHeader(g_hModelHandle);
	const OriginalMinimums = { ...g_HitboxMinimumsState };
	const OriginalMaximums = { ...g_HitboxMaximumsState };

	try {
		for (const bMissingHitbox of [false, true]) {
			let Result = null;
			let unWarningCount = 0;
			g_VM.runInNewContext(`${vecFunctions.join("\n")}\nUpdateHitbox(Owner, ParseHitboxArguments(["entity", "1", "hitbox", "0", "0", "1", "2", "3", "4", "5", "6", "confirm"]));`, {
				Vector,
				Owner: {
					GetEntityHitbox(unHitboxIndex, unHitboxSetIndex) {
						return bMissingHitbox ? null : Header.GetHitbox(unHitboxIndex, unHitboxSetIndex);
					},
				},
				g_strCommandName: "sjs_api_world",
				LogWarning: () => unWarningCount++,
				LogResult: (strLabel, Callback) => {
					g_Assert.equal(strLabel, "studio live hitbox");
					Result = Callback();
				},
			}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });

			if (bMissingHitbox) {
				g_Assert.equal(Result, null);
				g_Assert.equal(unWarningCount, 1);
				continue;
			}

			g_Assert.equal(unWarningCount, 0);
			g_Assert.equal(Result.Address, g_unHitboxAddress);
			g_Assert.deepEqual(Array.from(Result.Minimums), [1, 2, 3]);
			g_Assert.deepEqual(Array.from(Result.Maximums), [4, 5, 6]);
		}
	} finally {
		Object.assign(g_HitboxMinimumsState, OriginalMinimums);
		Object.assign(g_HitboxMaximumsState, OriginalMaximums);
	}
}

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

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned studio fixture property must be removable: " + strKey);
}

function ReleaseStudioFixture() {
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
		throw new AggregateError(vecFailures, "Studio fixture restoration failed.");
	}

	process.removeListener("exit", ReleaseStudioFixture);
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(g_SourceJSDescriptor || Object.isExtensible(globalThis), "Studio runtime fixture must support installation.");
g_Assert.ok(Object.isExtensible(require.cache), "Studio package cache must support exact restoration.");
g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Studio runtime fixture must support exact restoration.");
g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_OriginalModuleLoad === "function"), "Studio loader must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed studio cache entries must support exact restoration.");
}

// Exit cleanup also restores borrowed state after synchronous assertion failures.
process.once("exit", ReleaseStudioFixture);
g_bPackageCacheOwned = true;

for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
	RestoreFixtureProperty(require.cache, strModulePath, undefined);
}

function LoadStudioPackage() {
	Object.defineProperty(g_Module, "_load", {
		...g_LoaderDescriptor,
		writable: true,
		value: function LoadStudioModule(strRequest, Parent, bIsMain) {
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

Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { studio: g_NativeStudio } });
g_bSourceJSOwned = true;

const g_StudioAPI = LoadStudioPackage();
g_Assert.equal(g_StudioAPI, g_NativeStudio, "studio preserves native object identity");
g_Assert.deepEqual(Object.keys(g_StudioAPI).sort(), [
	"INVALID_ATTACHMENT_INDEX",
	"INVALID_BONE_INDEX",
	"INVALID_MODEL_HANDLE",
	"ModelCacheDataType",
	"ModelType",
	"StudioFlags",
	"AddReference",
	"FindModel",
	"FindModelHandle",
	"GetModelHeader",
	"GetModelHeaderAddress",
	"GetModelName",
	"GetReferenceCount",
	"Release",
	"RequireModelHeader",
].sort(), "exact full studio exports");
g_Assert.deepEqual(Object.keys(g_StudioAPI.ModelCacheDataType).sort(), [
	"AnimationBlock",
	"DecodedAnimationBlock",
	"PhysicsCollision",
	"StudioHardwareData",
	"StudioHeader",
	"Vertices",
	"VirtualModel",
], "full model-cache data types");
g_Assert.deepEqual(Object.keys(g_StudioAPI.ModelType).sort(), ["Bad", "Brush", "Sprite", "Studio"], "model types");
g_Assert.deepEqual(Object.keys(g_StudioAPI.StudioFlags).sort(), [
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
].sort(), "full studio flags");

const g_Model = g_StudioAPI.FindModel(g_strModelPath);
const g_hHandle = g_StudioAPI.FindModelHandle(g_strModelPath);
g_Assert.equal(g_Model.Handle, g_hModelHandle, "model handle record");
g_Assert.equal(g_Model.IsValid(), true, "valid model record");
g_Assert.equal(g_Model.GetName(), g_strModelPath, "model record name");
g_Assert.equal(g_Model.GetReferenceCount(), 2, "model record reference count");
g_Model.Handle = g_hInvalidModelHandle;
g_Assert.equal(g_Model.IsValid(), false, "model validity reads writable receiver metadata, not a captured acquisition");
g_Assert.throws(() => g_Model.GetName(), /valid model handle/);
g_Model.Handle = g_hModelHandle;
g_Assert.equal(Reflect.apply(g_Model.GetName, { Handle: g_hModelHandle }, []), g_strModelPath, "model methods honor their current native-style receiver");

for (const strMethodName of ["IsValid", "GetName", "GetReferenceCount"]) {
	let unHandleReadCount = 0;
	const Receiver = {
		get Handle() {
			unHandleReadCount += 1;

			return g_hModelHandle;
		},
	};

	Reflect.apply(g_Model[strMethodName], Receiver, []);
	g_Assert.equal(unHandleReadCount, 1, "each model method consumes exactly one receiver Handle read");
}

for (const strLookupName of ["FindModel", "FindModelHandle"]) {
	const unReferencesBefore = g_unReferenceCount;
	const unCallCountBefore = g_vecCallLog.length;
	g_Assert.throws(() => g_StudioAPI[strLookupName](`${g_strModelPath}\0tail`), /embedded NUL/);
	g_Assert.equal(g_unReferenceCount, unReferencesBefore, "NUL rejection acquires nothing");
	g_Assert.equal(g_vecCallLog.length, unCallCountBefore, "NUL rejection precedes the native lookup");
}

g_Assert.equal(g_hHandle, g_hModelHandle, "direct model handle");
g_Assert.equal(g_StudioAPI.GetModelName(g_hHandle), g_strModelPath, "direct model name");
g_Assert.equal(g_StudioAPI.GetModelHeaderAddress(g_hHandle), g_unModelHeaderAddress, "exact BigInt model-header address");
g_Assert.equal(typeof g_StudioAPI.GetModelHeaderAddress(g_hHandle), "bigint", "model-header address type");
g_Assert.equal(g_StudioAPI.GetModelHeader(g_hHandle), g_NativeModelHeader, "nullable model header");
g_Assert.equal(g_StudioAPI.RequireModelHeader(g_hHandle), g_NativeModelHeader, "required model header");
g_Assert.equal(g_StudioAPI.AddReference(g_hHandle), 3, "AddReference result");
g_Assert.equal(g_StudioAPI.Release(g_hHandle), 2, "Release added reference");
g_Assert.equal(g_StudioAPI.Release(g_Model.Handle), 1, "Release model-record reference");
g_Assert.equal(g_StudioAPI.Release(g_hHandle), 0, "Release direct-handle reference");

let g_unHeaderIndexScenarioCount = 0;
for (const vecMethod of [
	["GetBone", g_NativeBone],
	["GetBoneController", g_NativeBoneController],
	["GetHitboxSet", g_NativeHitboxSet],
	["GetLocalSequence", g_NativeSequence],
	["GetAttachment", g_NativeAttachment],
]) {
	const strMethodName = vecMethod[0];
	g_Assert.throws(() => g_NativeModelHeader[strMethodName](), /signed 32-bit range/, "omitted native index is required");
	g_Assert.throws(() => g_NativeModelHeader[strMethodName](undefined), /signed 32-bit range/, "undefined native index is rejected");
	g_Assert.equal(g_NativeModelHeader[strMethodName](0), vecMethod[1], "an explicit zero selects the first native record");
	g_Assert.equal(g_NativeModelHeader[strMethodName](0x7FFFFFFF), null, "the largest signed index is valid but outside this fixture");
	g_unHeaderIndexScenarioCount += 4;

	for (const Value of [null, false, 0.5, -1, 0x80000000, 0xFFFFFFFF, 1n, "0"]) {
		g_Assert.throws(() => g_NativeModelHeader[strMethodName](Value), /signed 32-bit range/);
		g_unHeaderIndexScenarioCount += 1;
	}
}

g_Assert.equal(g_NativeModelHeader.GetHitbox(0, undefined), g_NativeHitbox, "undefined optional hitbox-set index selects zero");
g_Assert.throws(() => g_NativeModelHeader.GetHitbox(), /signed 32-bit range/, "the hitbox index remains required");
g_Assert.throws(() => g_NativeModelHeader.GetHitbox(1, 0x80000000), /signed 32-bit range/, "both inputs are validated before any out-of-table return");
g_unHeaderIndexScenarioCount += 3;
g_Assert.equal(g_unHeaderIndexScenarioCount, 63, "all reviewed required and optional signed-index scenarios ran");

let g_unHitboxSetIndexScenarioCount = 0;
g_Assert.throws(() => g_NativeHitboxSet.GetHitbox(), /signed 32-bit range/, "omitted native index is required");
g_Assert.throws(() => g_NativeHitboxSet.GetHitbox(undefined), /signed 32-bit range/, "undefined native hitbox-set index is rejected");
g_Assert.equal(g_NativeHitboxSet.GetHitbox(0), g_NativeHitbox, "an explicit zero selects the first hitbox");
g_Assert.equal(g_NativeHitboxSet.GetHitbox(0x7FFFFFFF), null, "the largest signed hitbox index is valid but outside this fixture");
g_unHitboxSetIndexScenarioCount += 4;

for (const Value of [null, false, 0.5, -1, 0x80000000, 0xFFFFFFFF, 1n, "0"]) {
	g_Assert.throws(() => g_NativeHitboxSet.GetHitbox(Value), /signed 32-bit range/);
	g_unHitboxSetIndexScenarioCount += 1;
}

g_Assert.equal(g_unHitboxSetIndexScenarioCount, 12, "all required hitbox-set index scenarios ran");

let g_unNestedIndexScenarioCount = 0;
for (const Method of [
	{ Target: g_NativeSequence, Name: "GetAnimationIndex", DefaultResult: 7 },
	{ Target: g_NativeSequence, Name: "GetWeight", DefaultResult: 1 },
]) {
	g_Assert.equal(Method.Target[Method.Name](), Method.DefaultResult);
	g_Assert.equal(Method.Target[Method.Name](undefined), Method.DefaultResult);
	g_unNestedIndexScenarioCount += 2;

	for (const Value of [null, false, 0.5, -1, 0x80000000, 0xFFFFFFFF, 1n, "0"]) {
		g_Assert.throws(() => Method.Target[Method.Name](Value), /signed 32-bit range/);
		g_unNestedIndexScenarioCount += 1;
	}
}

g_Assert.equal(g_NativeSequence.GetAnimationIndex(0, undefined), 7);
g_Assert.throws(() => g_NativeSequence.GetAnimationIndex(1, 0x80000000), /signed 32-bit range/, "both animation inputs validate before any range rejection");
g_unNestedIndexScenarioCount += 2;
g_Assert.equal(g_unNestedIndexScenarioCount, 22, "all optional sequence signed-index default and validation scenarios ran");

g_Assert.deepEqual(Object.keys(g_NativeModelHeader).sort(), [
	"Address",
	"Attachments",
	"AttachmentCount",
	"AttachmentOffset",
	"BoneControllers",
	"BoneControllerCount",
	"BoneControllerOffset",
	"Bones",
	"BoneCount",
	"BoneOffset",
	"Checksum",
	"Contents",
	"EyePosition",
	"Flags",
	"GetAttachment",
	"GetBone",
	"GetBoneController",
	"GetHitbox",
	"GetHitboxSet",
	"GetLocalSequence",
	"HitboxSetCount",
	"HitboxSetOffset",
	"HitboxSets",
	"HullMaximums",
	"HullMinimums",
	"ID",
	"IlluminationCenter",
	"Length",
	"LocalAnimationCount",
	"LocalAnimationOffset",
	"LocalSequenceCount",
	"LocalSequenceOffset",
	"LocalSequences",
	"Mass",
	"Name",
	"Version",
	"ViewMaximums",
	"ViewMinimums",
].sort(), "exact model-header members");
g_Assert.deepEqual(Object.keys(g_NativeBone).sort(), [
	"Address",
	"Alignment",
	"BoneControllerIndexes",
	"Contents",
	"Flags",
	"GetProcedureAddress",
	"Name",
	"NameOffset",
	"Parent",
	"PhysicsBone",
	"Position",
	"PositionScale",
	"PositionToBone",
	"ProceduralType",
	"ProcedureOffset",
	"Quaternion",
	"RadianEuler",
	"RadianEulerScale",
	"SurfaceName",
	"SurfaceNameOffset",
	"SurfacePropertyLookup",
].sort(), "exact model-bone members");
g_Assert.deepEqual(Object.keys(g_NativeBoneController).sort(), [
	"Address",
	"Bone",
	"End",
	"InputField",
	"Rest",
	"Start",
	"Type",
].sort(), "exact bone-controller members");
g_Assert.deepEqual(Object.keys(g_NativeHitboxSet).sort(), [
	"Address",
	"GetHitbox",
	"HitboxCount",
	"HitboxOffset",
	"Hitboxes",
	"Name",
	"NameOffset",
].sort(), "exact hitbox-set members");
g_Assert.deepEqual(Object.keys(g_NativeHitbox).sort(), [
	"Address",
	"Bone",
	"Group",
	"Maxs",
	"Mins",
	"Name",
	"NameOffset",
].sort(), "exact hitbox members");
g_Assert.deepEqual(Object.keys(g_NativeSequence).sort(), [
	"Activity",
	"ActivityIndex",
	"ActivityOffset",
	"ActivityWeight",
	"Address",
	"AnimationOffset",
	"BlendCount",
	"DeltaAnimationIndex",
	"EntryPhase",
	"EventCount",
	"EventOffset",
	"ExitPhase",
	"FadeInTime",
	"FadeOutTime",
	"Flags",
	"GetAnimationIndex",
	"GetModelHeader",
	"GetWeight",
	"Label",
	"LabelOffset",
	"LastFrame",
	"LocalEntryNode",
	"LocalExitNode",
	"Maximums",
	"Minimums",
	"ModelHeaderOffset",
	"MovementOffset",
	"NextSequence",
	"NodeFlags",
].sort(), "exact sequence members");
g_Assert.deepEqual(Object.keys(g_NativeAttachment).sort(), [
	"Address",
	"Flags",
	"LocalBone",
	"LocalTransform",
	"Name",
	"NameOffset",
].sort(), "exact attachment members");

g_Assert.equal(g_NativeModelHeader.GetBone(0), g_NativeBone, "header bone lookup");
g_Assert.equal(g_NativeModelHeader.GetBone(1), null, "missing header bone");
g_Assert.equal(g_NativeModelHeader.GetBoneController(0), g_NativeBoneController, "header bone-controller lookup");
g_Assert.equal(g_NativeModelHeader.GetHitboxSet(0), g_NativeHitboxSet, "header hitbox-set lookup");
g_Assert.equal(g_NativeModelHeader.GetHitbox(0), g_NativeHitbox, "header hitbox lookup");
g_Assert.equal(g_NativeModelHeader.GetLocalSequence(0), g_NativeSequence, "header sequence lookup");
g_Assert.equal(g_NativeModelHeader.GetAttachment(0), g_NativeAttachment, "header attachment lookup");
g_Assert.notEqual(g_NativeModelHeader.Bones(), g_NativeModelHeader.Bones(), "header collections are fresh arrays");
g_Assert.notEqual(g_NativeHitboxSet.Hitboxes(), g_NativeHitboxSet.Hitboxes(), "hitbox collections are fresh arrays");
g_Assert.equal(g_NativeSequence.GetAnimationIndex(), 7, "sequence animation lookup");
g_Assert.equal(g_NativeSequence.GetWeight(), 1, "sequence weight lookup");
g_Assert.equal(g_NativeSequence.GetModelHeader(), g_NativeModelHeader, "sequence header lookup");

g_Assert.throws(() => g_NativeModelHeader.GetBone(-1), TypeError, "negative bone index");
g_Assert.throws(() => g_NativeSequence.GetAnimationIndex(1, 0), RangeError, "animation grid range");
g_Assert.throws(() => g_NativeSequence.GetWeight(1), RangeError, "sequence weight range");

const g_flOriginalHitboxMinimumX = g_HitboxMinimumsState.X;
const g_flOriginalAttachmentX = g_vecAttachmentTransformState[0][3];
const g_nOriginalBoneController = g_vecBoneControllerIndexesState[0];

g_NativeHitbox.Mins.X = g_flOriginalHitboxMinimumX - 4;
g_NativeAttachment.LocalTransform[0][3] = g_flOriginalAttachmentX + 2;
g_NativeBone.BoneControllerIndexes[0] = 3;

g_Assert.equal(g_HitboxMinimumsState.X, g_flOriginalHitboxMinimumX - 4, "hitbox vector writes native state");
g_Assert.equal(g_vecAttachmentTransformState[0][3], g_flOriginalAttachmentX + 2, "attachment matrix writes native state");
g_Assert.equal(g_vecBoneControllerIndexesState[0], 3, "bone integer array writes native state");

g_NativeHitbox.Mins.X = g_flOriginalHitboxMinimumX;
g_NativeAttachment.LocalTransform[0][3] = g_flOriginalAttachmentX;
g_NativeBone.BoneControllerIndexes[0] = g_nOriginalBoneController;

g_Assert.equal(typeof Object.getOwnPropertyDescriptor(g_NativeHitbox.Mins, "X").get, "function", "vector getter is live");
g_Assert.equal(typeof Object.getOwnPropertyDescriptor(g_NativeHitbox.Mins, "X").set, "function", "vector setter writes through");
g_Assert.equal(Object.getOwnPropertyDescriptor(g_NativeBone, "Name").set, undefined, "native strings are read-only");
g_Assert.equal(typeof g_NativeBone.PositionToBone.Address, "bigint", "exact BigInt matrix address");
g_Assert.equal(g_NativeBone.GetProcedureAddress(), 0n, "absent procedure address is exact BigInt zero");

for (const View of [
	g_NativeBone,
	g_NativeBoneController,
	g_NativeHitboxSet,
	g_NativeHitbox,
	g_NativeSequence,
	g_NativeAttachment,
	g_NativeBone.Position,
	g_NativeBone.Quaternion,
	g_NativeBone.RadianEuler,
	g_NativeBone.BoneControllerIndexes,
]) {
	g_Assert.equal(typeof View.Address, "bigint", "every tested live native view exposes an exact BigInt address");
	g_Assert.equal(View.Address > 0n, true);
}

g_Assert.equal(Object.hasOwn(g_NativeBone.RadianEuler, "X"), false, "Euler does not invent vector aliases");

g_Assert.equal(g_StudioAPI.FindModel("models/missing.mdl").IsValid(), false, "invalid model record");
g_Assert.equal(g_StudioAPI.FindModelHandle("models/missing.mdl"), g_hInvalidModelHandle, "invalid direct model handle");

const g_hUnavailableModelHandle = 13;
g_Assert.equal(g_StudioAPI.GetModelHeader(g_hUnavailableModelHandle), null, "nullable missing model header");
g_Assert.equal(g_StudioAPI.GetModelHeaderAddress(g_hUnavailableModelHandle), 0n, "missing model-header address");
g_Assert.throws(() => g_StudioAPI.RequireModelHeader(g_hUnavailableModelHandle), /unavailable/, "required missing model header");
g_Assert.throws(() => g_StudioAPI.FindModel(""), TypeError, "empty model path");
g_Assert.throws(() => g_StudioAPI.AddReference(g_hInvalidModelHandle), TypeError, "invalid model handle rejection");
g_Assert.equal(g_unReferenceCount, 0, "direct tests release every model reference");

let g_bModelHeaderOperationLogged = false;
let g_bHeaderHitboxOperationLogged = false;
let g_bSequenceAnimationOperationLogged = false;
for (const [strOperation] of g_vecCallLog) {
	if (strOperation === "GetModelHeader") {
		g_bModelHeaderOperationLogged = true;

	} else if (strOperation === "Header.GetHitbox") {
		g_bHeaderHitboxOperationLogged = true;

	} else if (strOperation === "Sequence.GetAnimationIndex") {
		g_bSequenceAnimationOperationLogged = true;
	}
}

g_Assert.ok(g_bModelHeaderOperationLogged, "model-cache header operation delegates directly");
g_Assert.ok(g_bHeaderHitboxOperationLogged, "model-header operation delegates directly");
g_Assert.ok(g_bSequenceAnimationOperationLogged, "nested studio operation delegates directly");

const g_OldConsoleStudio = CreateOldConsoleStudio();
globalThis.sourcejs.studio = g_OldConsoleStudio;

const g_OldStudioAPI = LoadStudioPackage();
const g_OldModel = g_OldStudioAPI.FindModel(g_strModelPath);
const g_bOldStudioHasDecodedAnimation = Object.hasOwn(g_OldStudioAPI.ModelCacheDataType, "DecodedAnimationBlock");
const g_bOldStudioHasPhysicsWireframe = Object.hasOwn(g_OldStudioAPI.StudioFlags, "WireframePhysicsCollision");
const g_bOldStudioHasShadowDepthTexture = Object.hasOwn(g_OldStudioAPI.StudioFlags, "ShadowDepthTexture");
g_Assert.equal(g_OldStudioAPI, g_OldConsoleStudio, "old-console package preserves native identity");
g_Assert.equal(Object.hasOwn(g_OldStudioAPI, "GetReferenceCount"), false, "old-console root omits reference getter");
g_Assert.equal(g_bOldStudioHasDecodedAnimation, false, "old-console data types omit decoded animation");
g_Assert.equal(g_bOldStudioHasPhysicsWireframe, false, "old-console flags omit physics wireframe");
g_Assert.equal(g_bOldStudioHasShadowDepthTexture, false, "old-console flags omit shadow-depth texture");
g_Assert.equal(Object.hasOwn(g_OldModel, "GetReferenceCount"), false, "old-console model record omits reference getter");

g_Assert.equal(g_OldStudioAPI.Release(g_OldModel.Handle), 0, "old-console model reference release result");

g_Assert.equal(g_unReferenceCount, 0, "old-console test releases model reference");

globalThis.sourcejs.studio = g_NativeStudio;

const g_DocumentationStudioAPI = LoadStudioPackage();
const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecCodeBlocks = [];
const g_ModuleObjectImportPattern = /const\s+[A-Za-z_$][\w$]*\s*=\s*require\("studio"\)/;

for (const strSignature of [
	"GetBone(nBoneIndex)",
	"GetBoneController(nBoneControllerIndex)",
	"GetHitboxSet(nHitboxSetIndex)",
	"GetLocalSequence(nLocalSequenceIndex)",
	"GetAttachment(nAttachmentIndex)",
	"GetHitbox(nHitboxIndex)",
]) {
	g_Assert.equal(g_strDocumentation.includes(`| \`${strSignature}\` | Requires a non-negative Int32 index;`), true, "the documented studio record index is required, matching the native callback");
}

for (const vecMatch of g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecCodeBlocks.push(vecMatch[1]);
}

g_Assert.equal(g_vecCodeBlocks.length, 10, "all studio documentation JavaScript blocks are present");

const g_BlockLoadState = ReadMutableStudioState();
const g_DocumentationWorkflows = {};
const g_vecDocumentationImportNames = ExtractDocumentationImports(g_vecCodeBlocks[0]).sort();
const g_vecNativeExportNames = Object.keys(g_DocumentationStudioAPI).sort();
g_Assert.deepEqual(g_vecDocumentationImportNames, g_vecNativeExportNames, "documentation imports every exact export");

for (let unIndex = 0; unIndex < g_vecCodeBlocks.length; unIndex += 1) {
	const WorkflowExports = ExecuteCodeBlock(g_vecCodeBlocks[unIndex], unIndex, g_DocumentationStudioAPI);
	for (const strWorkflowName of Object.keys(WorkflowExports)) {
		g_Assert.equal(Object.hasOwn(g_DocumentationWorkflows, strWorkflowName), false, `unique documentation workflow: ${strWorkflowName}`);
		Object.defineProperty(g_DocumentationWorkflows, strWorkflowName, { configurable: true, enumerable: true, value: WorkflowExports[strWorkflowName], writable: true });
	}

	if (typeof WorkflowExports.CreateStudioClassifier === "function") {
		const Classifier = WorkflowExports.CreateStudioClassifier();
		let unMaskScenarioCount = 0;
		for (const nFlags of [-0x80000000, -0x1, 0x0, 0x7FFFFFFF]) {
			g_Assert.equal(Classifier.WithRenderFlag(nFlags), nFlags | g_StudioFlags.Render, "render masks preserve signed SDK storage");
			unMaskScenarioCount += 1;
		}

		for (const Value of [undefined, null, false, true, NaN, Infinity, -Infinity, -0x80000001, 0x80000000, 0x100000000, 0.5, 1n, "1", {}, []]) {
			g_Assert.throws(() => Classifier.WithRenderFlag(Value), /signed 32-bit integer mask/, "invalid render masks are never silently coerced");
			unMaskScenarioCount += 1;
		}

		g_Assert.equal(unMaskScenarioCount, 19, "all signed render-mask scenarios ran");
	}

	for (const strWorkflowName of ["WithAdditionalModelReference", "CreateModelInspection"]) {
		if (typeof WorkflowExports[strWorkflowName] === "function") {
			AssertStudioReferenceFailures(g_vecCodeBlocks[unIndex], unIndex, strWorkflowName);
		}
	}

	if (typeof WorkflowExports.CreateModelHeaderInspection === "function") {
		AssertStudioHeaderCleanupFailures(g_vecCodeBlocks[unIndex], unIndex);
	}

	if (typeof WorkflowExports.TemporarilyOffsetRootBone === "function") {
		AssertStudioBoneCleanupFailures(g_vecCodeBlocks[unIndex], unIndex);
	}

	for (const strWorkflowName of ["TemporarilyAdjustFirstBoneController", "TemporarilyExpandHitbox", "TemporarilyAdjustFirstSequence", "TemporarilyOffsetNamedAttachment"]) {
		if (typeof WorkflowExports[strWorkflowName] === "function") {
			AssertStudioTemporaryEditFailures(g_vecCodeBlocks[unIndex], unIndex, strWorkflowName);
		}
	}
}

const g_StateAfterBlockLoad = ReadMutableStudioState();
const g_vecDocumentationWorkflowNames = Object.keys(g_DocumentationWorkflows).sort();
g_Assert.deepEqual(g_StateAfterBlockLoad, g_BlockLoadState, "documentation blocks do not touch native state while loading");
g_Assert.deepEqual(g_vecDocumentationWorkflowNames, g_vecExpectedDocumentationWorkflows.slice().sort(), "documentation exports every workflow");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by/, "studio documentation is hand-maintained");
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

const g_InitialWorkflowState = ReadMutableStudioState(false);
const g_Classifier = g_DocumentationWorkflows.CreateStudioClassifier();
g_Assert.deepEqual(ToPlainValue(g_Classifier.Capabilities), { HasDecodedAnimationBlock: true, HasShadowDepthTexture: true, HasWireframePhysicsCollision: true }, "constant workflow capability inventory");
g_Assert.equal(g_Classifier.AcceptsCacheNotification(g_ModelCacheDataType.StudioHeader), true, "constant workflow cache type");
g_Assert.equal(g_Classifier.AcceptsCacheNotification(g_ModelCacheDataType.AnimationBlock), false, "constant workflow rejects other type");
g_Assert.equal(g_Classifier.GetModelTypeName(g_ModelType.Studio), "studio", "constant workflow model type");
g_Assert.equal(g_Classifier.GetModelTypeName(g_ModelType.Bad), "invalid", "constant workflow invalid model type");
g_Assert.equal(g_Classifier.WithRenderFlag(0), g_StudioFlags.Render, "constant workflow studio flag");

const g_NativeReferenceResult = g_DocumentationWorkflows.WithAdditionalModelReference(g_strModelPath, (Value) => Value);
const g_ReferenceResult = ToPlainValue(g_NativeReferenceResult);
g_Assert.deepEqual(g_ReferenceResult, { Handle: g_hModelHandle, CountAfterAdd: 2, CurrentReferenceCount: 2 }, "additional-reference workflow");
g_Assert.equal(g_unReferenceCount, 0, "additional-reference workflow releases both references");

const g_ModelController = g_DocumentationWorkflows.CreateModelInspection(g_strModelPath);
const g_ModelInspection = ToPlainValue(g_ModelController.Inspect());
g_Assert.deepEqual(g_ModelInspection, { HandleMatches: true, Valid: true, DirectName: g_strModelPath, ModelName: g_strModelPath, ReferenceCount: 2 }, "model-record workflow");
g_Assert.equal(g_ModelController.Dispose(), true, "model-record workflow disposal");
g_Assert.equal(g_ModelController.Dispose(), false, "model-record repeated disposal");
g_Assert.throws(() => g_ModelController.Inspect(), /disposed/, "disposed model workflow rejects borrowed access");
g_Assert.equal(g_unReferenceCount, 0, "model-record workflow releases both references");

const g_HeaderController = g_DocumentationWorkflows.CreateModelHeaderInspection(g_strModelPath);
const g_HeaderInspection = g_HeaderController.Inspect();
g_Assert.equal(g_HeaderInspection.Address, g_unModelHeaderAddress, "header workflow address");
g_Assert.equal(g_HeaderInspection.NullableHeaderAddress, g_unModelHeaderAddress, "header workflow nullable address");
g_Assert.equal(g_HeaderInspection.Name, "error.mdl", "header workflow name");
g_Assert.equal(g_HeaderInspection.Scalar.BoneCount, 1, "header workflow scalar fields");
g_Assert.equal(g_HeaderInspection.Scalar.AttachmentCount, 1, "header workflow attachment metadata");
g_Assert.equal(g_HeaderInspection.Vectors.EyePosition.Address, g_unModelHeaderAddress + 0x40n, "header workflow live vector");
g_Assert.equal(g_HeaderInspection.Bone.Address, g_unBoneAddress, "header workflow bone lookup");
g_Assert.equal(g_HeaderInspection.BoneController.Address, g_unBoneControllerAddress, "header workflow controller lookup");
g_Assert.equal(g_HeaderInspection.HitboxSet.Address, g_unHitboxSetAddress, "header workflow hitbox-set lookup");
g_Assert.equal(g_HeaderInspection.Hitbox.Address, g_unHitboxAddress, "header workflow hitbox lookup");
g_Assert.equal(g_HeaderInspection.LocalSequence.Address, g_unSequenceAddress, "header workflow sequence lookup");
g_Assert.equal(g_HeaderInspection.Attachment.Address, g_unAttachmentAddress, "header workflow attachment lookup");
g_Assert.equal(g_HeaderController.Dispose(), true, "header workflow disposal");
g_Assert.equal(g_HeaderController.Dispose(), false, "header workflow repeated disposal");
g_Assert.throws(() => g_HeaderController.Inspect(), /disposed/, "disposed header workflow rejects borrowed access");
g_Assert.equal(g_unReferenceCount, 0, "header workflow releases its reference");

const g_BoneResult = ToPlainValue(g_DocumentationWorkflows.TemporarilyOffsetRootBone(g_strModelPath));
g_Assert.equal(g_BoneResult.Name, "root", "bone workflow name");
g_Assert.equal(g_BoneResult.Address, g_unBoneAddress, "bone workflow address");
g_Assert.equal(g_BoneResult.Position.X, g_BonePositionState.X + 0.125, "bone workflow temporary vector edit");
g_Assert.equal(g_BoneResult.PositionToBone.Rows[0][3], g_vecBonePositionToBoneState[0][3] + 0.125, "bone workflow temporary matrix edit");
g_Assert.equal(g_BoneResult.Position.Address, g_unBoneAddress + 0x40n, "bone workflow vector address");
g_Assert.equal(g_BoneResult.PositionToBone.Address, g_unBoneAddress + 0x90n, "bone workflow matrix address");
g_Assert.equal(g_BoneResult.RadianEuler.Address, g_unBoneAddress + 0x60n, "bone workflow Euler address");
g_Assert.equal(g_BoneResult.RadianEuler.Pitch, g_BoneRadianEulerState.Pitch, "bone workflow native Pitch component");
g_Assert.equal(g_BoneResult.RadianEuler.Yaw, g_BoneRadianEulerState.Yaw, "bone workflow native Yaw component");
g_Assert.equal(g_BoneResult.RadianEuler.Roll, g_BoneRadianEulerState.Roll, "bone workflow native Roll component");
g_Assert.equal(g_BoneResult.SurfacePropertyLookup, 0, "bone workflow SDK-conditioned field");
g_Assert.equal(g_unReferenceCount, 0, "bone workflow releases its reference");

const g_BoneControllerResult = ToPlainValue(g_DocumentationWorkflows.TemporarilyAdjustFirstBoneController(g_strModelPath));
g_Assert.equal(g_BoneControllerResult.Address, g_unBoneControllerAddress, "bone-controller workflow address");
g_Assert.equal(g_BoneControllerResult.Start, g_BoneControllerState.Start + 1, "bone-controller workflow temporary edit");
g_Assert.equal(g_BoneControllerResult.End, g_BoneControllerState.End, "bone-controller workflow fields");
g_Assert.equal(g_unReferenceCount, 0, "bone-controller workflow releases its reference");

const g_HitboxResult = ToPlainValue(g_DocumentationWorkflows.TemporarilyExpandHitbox(g_strModelPath));
g_Assert.equal(g_HitboxResult.Address, g_unHitboxAddress, "hitbox workflow address");
g_Assert.equal(g_HitboxResult.SetAddress, g_unHitboxSetAddress, "hitbox workflow set address");
g_Assert.equal(g_HitboxResult.SameAddress, true, "hitbox workflow shared memory identity");
g_Assert.equal(g_HitboxResult.Minimums.X, g_HitboxMinimumsState.X - 2, "hitbox workflow temporary minimum");
g_Assert.equal(g_HitboxResult.Maximums.X, g_HitboxMaximumsState.X + 2, "hitbox workflow temporary maximum");
g_Assert.equal(g_HitboxResult.Hitboxes.length, 1, "hitbox workflow collection");
g_Assert.equal(g_unReferenceCount, 0, "hitbox workflow releases its reference");

const g_SequenceResult = ToPlainValue(g_DocumentationWorkflows.TemporarilyAdjustFirstSequence(g_strModelPath));
g_Assert.equal(g_SequenceResult.Address, g_unSequenceAddress, "sequence workflow address");
g_Assert.equal(g_SequenceResult.Label, "idle", "sequence workflow label");
g_Assert.equal(g_SequenceResult.Activity, "ACT_IDLE", "sequence workflow activity");
g_Assert.equal(g_SequenceResult.AnimationIndex, 7, "sequence workflow animation lookup");
g_Assert.equal(g_SequenceResult.HeaderAddress, g_unModelHeaderAddress, "sequence workflow owning header");
g_Assert.equal(g_unReferenceCount, 0, "sequence workflow releases its reference");

const g_AttachmentResult = ToPlainValue(g_DocumentationWorkflows.TemporarilyOffsetNamedAttachment(g_strModelPath));
const g_flAttachmentTranslationX = g_AttachmentResult.LocalTransform.Rows[0][3];
g_Assert.equal(g_AttachmentResult.Address, g_unAttachmentAddress, "attachment workflow address");
g_Assert.equal(g_AttachmentResult.Name, "eyes", "attachment workflow name");
g_Assert.equal(g_AttachmentResult.LocalBone, 0, "attachment workflow local bone");
g_Assert.equal(g_AttachmentResult.LocalTransform.Address, g_unAttachmentAddress + 0x20n, "attachment workflow matrix address");
g_Assert.equal(g_flAttachmentTranslationX, g_vecAttachmentTransformState[0][3] + 0.5, "attachment workflow temporary matrix edit");
g_Assert.equal(g_unReferenceCount, 0, "attachment workflow releases its reference");

const g_FinalWorkflowState = ReadMutableStudioState(false);
g_Assert.deepEqual(g_FinalWorkflowState, g_InitialWorkflowState, "documentation workflows restore every mutable studio value");

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
g_Assert.equal(g_MissingRuntime.status, 1, "studio requires the native runtime");
g_Assert.match(g_MissingRuntime.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

VerifyWorldHitboxExample(g_DocumentationStudioAPI);

ReleaseStudioFixture();

console.log("[  OK  ] smoke_studio");
