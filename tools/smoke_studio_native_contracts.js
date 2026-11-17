#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
		console.log("Usage: node tools/smoke_studio_native_contracts.js\nChecks source contracts only; does not execute live V8 or engine code.");
		process.exit(0);
	}

	console.error("Usage: node tools/smoke_studio_native_contracts.js");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecBoundaries = [
	{ Name: "GetStudioModelHandleFromValue", Guards: 1, Result: "false" },
	{ Name: "RequireStudioModelCache", Guards: 0, Result: "nullptr" },
	{ Name: "RequireStudioModelHandle", Guards: 0, Result: "false" },
	{ Name: "GetStudioModelHandleFromCallback", Guards: 3, Result: "false" },
	{ Name: "IsStudioModelValidCallback", Guards: 2 },
	{ Name: "GetStudioModelNameCallback", Guards: 5 },
	{ Name: "GetStudioModelReferenceCountCallback", Guards: 4 },
	{ Name: "MakeStudioModelObject", Guards: 10, Result: "{}" },
	{ Name: "MakeStudioAddressValue", Guards: 1, Result: "{}" },
	{ Name: "InstallStudioAddress", Guards: 3, Result: "false" },
	{ Name: "GetStudioFloatPropertyAddress", Guards: 0, Result: "nullptr" },
	{ Name: "GetStudioFloatPropertyCallback", Guards: 1 },
	{ Name: "SetStudioFloatPropertyCallback", Guards: 2 },
	{ Name: "InstallStudioFloatProperty", Guards: 3, Result: "false" },
	{ Name: "GetStudioIntegerPropertyAddress", Guards: 0, Result: "nullptr" },
	{ Name: "GetStudioIntegerPropertyCallback", Guards: 1 },
	{ Name: "SetStudioIntegerPropertyCallback", Guards: 2 },
	{ Name: "InstallStudioIntegerProperty", Guards: 3, Result: "false" },
	{ Name: "GetStudioCStringPropertyAddress", Guards: 0, Result: "nullptr" },
	{ Name: "GetStudioCStringPropertyCallback", Guards: 2 },
	{ Name: "InstallStudioCStringProperty", Guards: 3, Result: "false" },
	{ Name: "MakeStudioVectorObject", Guards: 5, Result: "{}" },
	{ Name: "MakeStudioIntegerArray", Guards: 3, Result: "{}" },
	{ Name: "MakeStudioQuaternionObject", Guards: 6, Result: "{}" },
	{ Name: "MakeStudioRadianEulerObject", Guards: 5, Result: "{}" },
	{ Name: "MakeStudioMatrix3x4Array", Guards: 5, Result: "{}" },
	{ Name: "GetStudioAddressFromValue", Guards: 1, Result: "false" },
	{ Name: "GetStudioAddressFromObject", Guards: 3, Result: "false" },
	{ Name: "GetStudioHeaderFromObject", Guards: 1, Result: "nullptr" },
	{ Name: "GetStudioHitboxSetFromValue", Guards: 1, Result: "nullptr" },
	{ Name: "GetStudioSequenceFromValue", Guards: 1, Result: "nullptr" },
	{ Name: "GetStudioBoneProcedureAddressCallback", Guards: 2 },
	{ Name: "InstallStudioBoneSurfacePropertyLookup", Guards: 1, Result: "false" },
	{ Name: "InstallStudioValue", Guards: 3, Result: "false" },
	{ Name: "InstallStudioFunction", Guards: 3, Result: "false" },
	{ Name: "MakeStudioBoneObject", Guards: 31, Result: "{}" },
	{ Name: "MakeStudioBoneControllerObject", Guards: 8, Result: "{}" },
	{ Name: "MakeStudioHitboxObject", Guards: 10, Result: "{}" },
	{ Name: "GetStudioUnsignedIntegerPropertyAddress", Guards: 0, Result: "nullptr" },
	{ Name: "GetStudioUnsignedIntegerPropertyCallback", Guards: 2 },
	{ Name: "SetStudioUnsignedIntegerPropertyCallback", Guards: 2 },
	{ Name: "InstallStudioUnsignedIntegerProperty", Guards: 3, Result: "false" },
	{ Name: "MakeStudioAttachmentObject", Guards: 8, Result: "{}" },
	{ Name: "GetStudioIndexArgument", Guards: 1, Result: "false" },
	{ Name: "GetStudioCollectionOperationFromCallback", Guards: 0, Result: "false" },
	{ Name: "RequireStudioHeaderFromThis", Guards: 1, Result: "nullptr" },
	{ Name: "RequireStudioHitboxSetFromThis", Guards: 1, Result: "nullptr" },
	{ Name: "GetStudioHitboxSetHitboxCallback", Guards: 3 },
	{ Name: "GetStudioHitboxSetHitboxesCallback", Guards: 4 },
	{ Name: "InstallStudioHitboxSetMethods", Guards: 3, Result: "false" },
	{ Name: "MakeStudioHitboxSetObject", Guards: 7, Result: "{}" },
	{ Name: "RequireStudioSequenceFromThis", Guards: 1, Result: "nullptr" },
	{ Name: "GetStudioHeaderBoneCallback", Guards: 3 },
	{ Name: "GetStudioHeaderBoneControllerCallback", Guards: 3 },
	{ Name: "GetStudioHeaderHitboxSetCallback", Guards: 3 },
	{ Name: "GetStudioHeaderHitboxCallback", Guards: 4 },
	{ Name: "GetStudioHeaderLocalSequenceCallback", Guards: 3 },
	{ Name: "GetStudioHeaderAttachmentCallback", Guards: 3 },
	{ Name: "GetStudioHeaderCollectionCallback", Guards: 5 },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Guards: 4 },
	{ Name: "GetStudioSequenceWeightCallback", Guards: 2 },
	{ Name: "InstallStudioHeaderMethods", Guards: 17, Result: "false" },
	{ Name: "InstallStudioSequenceMethods", Guards: 4, Result: "false" },
	{ Name: "GetStudioSignedIntegerPropertyAddress", Guards: 0, Result: "nullptr" },
	{ Name: "GetStudioSignedIntegerPropertyCallback", Guards: 2 },
	{ Name: "SetStudioSignedIntegerPropertyCallback", Guards: 3 },
	{ Name: "InstallStudioSignedIntegerProperty", Guards: 4, Result: "false" },
	{ Name: "MakeStudioHeaderObject", Guards: 35, Result: "{}" },
	{ Name: "GetStudioSequenceModelHeaderCallback", Guards: 3, Isolate: "pCallbackIsolate" },
	{ Name: "MakeStudioSequenceObject", Guards: 33, Result: "{}" },
	{ Name: "FindStudioModelCallback", Guards: 5 },
	{ Name: "FindStudioModelHandleCallback", Guards: 4 },
	{ Name: "AddStudioReferenceCallback", Guards: 4 },
	{ Name: "ReleaseStudioReferenceCallback", Guards: 4 },
	{ Name: "GetStudioReferenceCountCallback", Guards: 4 },
	{ Name: "GetStudioCacheModelNameCallback", Guards: 5 },
	{ Name: "GetStudioModelHeaderAddressCallback", Guards: 5 },
	{ Name: "GetStudioModelHeaderCallback", Guards: 5 },
	{ Name: "RequireStudioModelHeaderCallback", Guards: 5 },
	{ Name: "MakeStudioModelCacheDataTypeObject", Guards: 15, Result: "{}" },
	{ Name: "InstallStudioCacheFunctions", Guards: 14, Result: "false" },
	{ Name: "InstallStudioConstants", Guards: 23, Result: "false" },
];
const g_vecCacheMethods = [
	{ Role: "FindModel", Callback: "FindStudioModelCallback" },
	{ Role: "FindModelHandle", Callback: "FindStudioModelHandleCallback" },
	{ Role: "AddReference", Callback: "AddStudioReferenceCallback", SDK: "AddRef", Local: "nReferenceCount" },
	{ Role: "Release", Callback: "ReleaseStudioReferenceCallback", SDK: "Release", Local: "nReferenceCount" },
	{ Role: "GetReferenceCount", Callback: "GetStudioReferenceCountCallback", SDK: "GetRef", Local: "nReferenceCount" },
	{ Role: "GetModelName", Callback: "GetStudioCacheModelNameCallback", SDK: "GetModelName", Local: "pszModelName" },
	{ Role: "GetModelHeaderAddress", Callback: "GetStudioModelHeaderAddressCallback", SDK: "GetStudioHdr", Local: "pStudioHeader" },
	{ Role: "GetModelHeader", Callback: "GetStudioModelHeaderCallback", SDK: "GetStudioHdr", Local: "pStudioHeader" },
	{ Role: "RequireModelHeader", Callback: "RequireStudioModelHeaderCallback", SDK: "GetStudioHdr", Local: "pStudioHeader" },
];
const g_vecCacheDataTypes = [
	{ Role: "StudioHeader", SDK: "MDLCACHE_STUDIOHDR", Local: "LocalStudioHeaderDataTypeValue" },
	{ Role: "StudioHardwareData", SDK: "MDLCACHE_STUDIOHWDATA", Local: "LocalStudioHardwareDataTypeValue" },
	{ Role: "PhysicsCollision", SDK: "MDLCACHE_VCOLLIDE", Local: "LocalPhysicsCollisionDataTypeValue" },
	{ Role: "AnimationBlock", SDK: "MDLCACHE_ANIMBLOCK", Local: "LocalAnimationBlockDataTypeValue" },
	{ Role: "VirtualModel", SDK: "MDLCACHE_VIRTUALMODEL", Local: "LocalVirtualModelDataTypeValue" },
	{ Role: "Vertices", SDK: "MDLCACHE_VERTEXES", Local: "LocalVerticesDataTypeValue" },
	{ Role: "DecodedAnimationBlock", SDK: "MDLCACHE_DECODEDANIMBLOCK", Local: "LocalDecodedAnimationBlockDataTypeValue" },
];
const g_vecStudioModelTypes = [
	["Bad", "mod_bad"],
	["Brush", "mod_brush"],
	["Sprite", "mod_sprite"],
	["Studio", "mod_studio"],
];
const g_vecStudioFlags = [
	["None", "STUDIO_NONE"],
	["Render", "STUDIO_RENDER"],
	["ViewTransformAttachments", "STUDIO_VIEWXFORMATTACHMENTS"],
	["DrawTranslucentSubmodels", "STUDIO_DRAWTRANSLUCENTSUBMODELS"],
	["TwoPass", "STUDIO_TWOPASS"],
	["StaticLighting", "STUDIO_STATIC_LIGHTING"],
	["Wireframe", "STUDIO_WIREFRAME"],
	["ItemBlink", "STUDIO_ITEM_BLINK"],
	["NoShadows", "STUDIO_NOSHADOWS"],
	["WireframePhysicsCollision", "STUDIO_WIREFRAME_VCOLLIDE"],
	["Transparency", "STUDIO_TRANSPARENCY"],
	["ShadowDepthTexture", "STUDIO_SHADOWDEPTHTEXTURE"],
];
const g_vecModelMethods = [
	{ Role: "IsValid", Callback: "IsStudioModelValidCallback" },
	{ Role: "GetName", Callback: "GetStudioModelNameCallback" },
	{ Role: "GetReferenceCount", Callback: "GetStudioModelReferenceCountCallback" },
];
const g_vecScalarProperties = [
	{ Role: "Float", Type: "float", Address: "pflFloatPropertyValue", Value: "flPropertyValue" },
	{ Role: "Integer", Type: "int", Address: "pnIntegerPropertyValue", Value: "nIntegerPropertyValue" },
];
const g_vecMathViews = [
	{ Name: "MakeStudioVectorObject", Type: "Vector", Address: "pVectorValue", Object: "LocalVectorObject", Components: [["X", "x"], ["Y", "y"], ["Z", "z"]] },
	{ Name: "MakeStudioQuaternionObject", Type: "Quaternion", Address: "pQuaternionValue", Object: "LocalQuaternionObject", Components: [["X", "x"], ["Y", "y"], ["Z", "z"], ["W", "w"]] },
	{ Name: "MakeStudioRadianEulerObject", Type: "RadianEuler", Address: "pRadianEulerValue", Object: "LocalRadianEulerObject", Components: [["Pitch", "y"], ["Yaw", "z"], ["Roll", "x"]] },
];
const g_vecAddressResolvers = [
	{ Name: "GetStudioHeaderFromObject", Type: "studiohdr_t", Address: "unStudioHeaderAddress" },
	{ Name: "GetStudioHitboxSetFromValue", Type: "mstudiohitboxset_t", Address: "unStudioHitboxSetAddress" },
	{ Name: "GetStudioSequenceFromValue", Type: "mstudioseqdesc_t", Address: "unStudioSequenceAddress" },
];
const g_vecBoneViews = [
	{ Role: "ControllerIndexes", Public: "BoneControllerIndexes", Local: "LocalBoneControllerIndexArray", Call: "MakeStudioIntegerArray(pIsolate, LocalContext, pStudioBone->bonecontroller, kBoneControllerCount)" },
	{ Role: "Position", Public: "Position", Local: "LocalBonePositionObject", Call: "MakeStudioVectorObject(pIsolate, LocalContext, &pStudioBone->pos)" },
	{ Role: "Quaternion", Public: "Quaternion", Local: "LocalBoneQuaternionObject", Call: "MakeStudioQuaternionObject(pIsolate, LocalContext, &pStudioBone->quat)" },
	{ Role: "RadianEuler", Public: "RadianEuler", Local: "LocalBoneRadianEulerObject", Call: "MakeStudioRadianEulerObject(pIsolate, LocalContext, &pStudioBone->rot)" },
	{ Role: "PositionScale", Public: "PositionScale", Local: "LocalBonePositionScaleObject", Call: "MakeStudioVectorObject(pIsolate, LocalContext, &pStudioBone->posscale)" },
	{ Role: "RadianEulerScale", Public: "RadianEulerScale", Local: "LocalBoneRadianEulerScaleObject", Call: "MakeStudioVectorObject(pIsolate, LocalContext, &pStudioBone->rotscale)" },
	{ Role: "PositionToBone", Public: "PositionToBone", Local: "LocalBonePositionToBoneMatrix", Call: "MakeStudioMatrix3x4Array(pIsolate, LocalContext, &pStudioBone->poseToBone)" },
	{ Role: "Alignment", Public: "Alignment", Local: "LocalBoneAlignmentObject", Call: "MakeStudioQuaternionObject(pIsolate, LocalContext, &pStudioBone->qAlignment)" },
];

const g_vecIndexedRecords = [
	{ Name: "GetStudioHeaderLocalSequenceCallback", Require: "RequireStudioHeaderFromThis", Argument: "LocalSequence", Source: "pStudioHeader", Count: "numlocalseq", SDK: "pLocalSeqdesc", Record: "pStudioLocalSequence", Factory: "MakeStudioSequenceObject", Object: "LocalStudioSequenceObject" },
	{ Name: "GetStudioHeaderAttachmentCallback", Require: "RequireStudioHeaderFromThis", Argument: "Attachment", Source: "pStudioHeader", Count: "numlocalattachments", SDK: "pLocalAttachment", Record: "pStudioAttachment", Factory: "MakeStudioAttachmentObject", Object: "LocalModelAttachmentObject" },
	{ Name: "GetStudioHitboxSetHitboxCallback", Require: "RequireStudioHitboxSetFromThis", Argument: "Hitbox", Source: "pStudioHitboxSet", Count: "numhitboxes", SDK: "pHitbox", Record: "pStudioHitbox", Factory: "MakeStudioHitboxObject", Object: "LocalHitboxObject" },
	{ Name: "GetStudioHeaderBoneCallback", Require: "RequireStudioHeaderFromThis", Argument: "Bone", Source: "pStudioHeader", Count: "numbones", SDK: "pBone", Record: "pStudioBone", Factory: "MakeStudioBoneObject", Object: "LocalModelBoneObject" },
	{ Name: "GetStudioHeaderBoneControllerCallback", Require: "RequireStudioHeaderFromThis", Argument: "BoneController", Source: "pStudioHeader", Count: "numbonecontrollers", SDK: "pBonecontroller", Record: "pStudioBoneController", Factory: "MakeStudioBoneControllerObject", Object: "LocalBoneControllerObject" },
	{ Name: "GetStudioHeaderHitboxSetCallback", Require: "RequireStudioHeaderFromThis", Argument: "HitboxSet", Source: "pStudioHeader", Count: "numhitboxsets", SDK: "pHitboxSet", Record: "pStudioHitboxSet", Factory: "MakeStudioHitboxSetObject", Object: "LocalHitboxSetObject" },
];
const g_vecHitboxSetMethods = [
	{ Role: "GetHitbox", Callback: "GetStudioHitboxSetHitboxCallback" },
	{ Role: "Hitboxes", Callback: "GetStudioHitboxSetHitboxesCallback" },
];

const g_vecHeaderMethods = [
	{ Role: "GetBone", Callback: "GetStudioHeaderBoneCallback" },
	{ Role: "GetBoneController", Callback: "GetStudioHeaderBoneControllerCallback" },
	{ Role: "GetHitboxSet", Callback: "GetStudioHeaderHitboxSetCallback" },
	{ Role: "GetHitbox", Callback: "GetStudioHeaderHitboxCallback" },
	{ Role: "GetLocalSequence", Callback: "GetStudioHeaderLocalSequenceCallback" },
	{ Role: "GetAttachment", Callback: "GetStudioHeaderAttachmentCallback" },
];
const g_vecHeaderCollections = [
	{ Role: "Bones", Count: "numbones", Type: "mstudiobone_t", SDK: "pBone", Factory: "MakeStudioBoneObject", Metadata: "LocalBonesCollectionOperation" },
	{ Role: "BoneControllers", Count: "numbonecontrollers", Type: "mstudiobonecontroller_t", SDK: "pBonecontroller", Factory: "MakeStudioBoneControllerObject", Metadata: "LocalBoneControllersCollectionOperation" },
	{ Role: "HitboxSets", Count: "numhitboxsets", Type: "mstudiohitboxset_t", SDK: "pHitboxSet", Factory: "MakeStudioHitboxSetObject", Metadata: "LocalHitboxSetsCollectionOperation" },
	{ Role: "LocalSequences", Count: "numlocalseq", Type: "mstudioseqdesc_t", SDK: "pLocalSeqdesc", Factory: "MakeStudioSequenceObject", Metadata: "LocalSequencesCollectionOperation" },
	{ Role: "Attachments", Count: "numlocalattachments", Type: "mstudioattachment_t", SDK: "pLocalAttachment", Factory: "MakeStudioAttachmentObject", Metadata: "LocalAttachmentsCollectionOperation" },
];

const g_vecRecords = [
	{
		Name: "MakeStudioHitboxSetObject", Type: "mstudiohitboxset_t", Address: "pStudioHitboxSet", Object: "LocalHitboxSetObject", Role: "HitboxSet",
		Fields: [
			["Integer", "NameOffset", "NameOffset", "&pStudioHitboxSet->sznameindex"],
			["CString", "Name", "Name", "pStudioHitboxSet->pszName()"],
			["Integer", "HitboxCount", "HitboxCount", "&pStudioHitboxSet->numhitboxes"],
			["Integer", "HitboxOffset", "HitboxOffset", "&pStudioHitboxSet->hitboxindex"],
		],
		Views: [],
	},
	{
		Name: "MakeStudioBoneControllerObject", Type: "mstudiobonecontroller_t", Address: "pStudioBoneController", Object: "LocalBoneControllerObject", Role: "BoneController",
		Fields: [
			["Integer", "BoneIndex", "Bone", "&pStudioBoneController->bone"],
			["Integer", "Type", "Type", "&pStudioBoneController->type"],
			["Float", "Start", "Start", "&pStudioBoneController->start"],
			["Float", "End", "End", "&pStudioBoneController->end"],
			["Integer", "Rest", "Rest", "&pStudioBoneController->rest"],
			["Integer", "InputField", "InputField", "&pStudioBoneController->inputfield"],
		],
		Views: [],
	},
	{
		Name: "MakeStudioHitboxObject", Type: "mstudiobbox_t", Address: "pStudioHitbox", Object: "LocalHitboxObject", Role: "Hitbox",
		Fields: [
			["Integer", "NameOffset", "NameOffset", "&pStudioHitbox->szhitboxnameindex"],
			["CString", "Name", "Name", "pStudioHitbox->pszHitboxName()"],
			["Integer", "BoneIndex", "Bone", "&pStudioHitbox->bone"],
			["Integer", "GroupIndex", "Group", "&pStudioHitbox->group"],
		],
		Views: [
			["Minimums", "Mins", "LocalHitboxMinimumsObject", "MakeStudioVectorObject(pIsolate, LocalContext, &pStudioHitbox->bbmin)"],
			["Maximums", "Maxs", "LocalHitboxMaximumsObject", "MakeStudioVectorObject(pIsolate, LocalContext, &pStudioHitbox->bbmax)"],
		],
	},
	{
		Name: "MakeStudioAttachmentObject", Type: "mstudioattachment_t", Address: "pStudioAttachment", Object: "LocalModelAttachmentObject", Role: "Attachment",
		Fields: [
			["Integer", "NameOffset", "NameOffset", "&pStudioAttachment->sznameindex"],
			["CString", "Name", "Name", "pStudioAttachment->pszName()"],
			["UnsignedInteger", "Flags", "Flags", "&pStudioAttachment->flags"],
			["Integer", "LocalBoneIndex", "LocalBone", "&pStudioAttachment->localbone"],
		],
		Views: [["LocalTransform", "LocalTransform", "LocalAttachmentTransformMatrix", "MakeStudioMatrix3x4Array(pIsolate, LocalContext, &pStudioAttachment->local)"]],
	},
];

const g_vecHeaderSequenceChecks = [
	{
		Name: "MakeStudioHeaderObject",
		Fragments: [
			"(unStudioHeaderAddress % alignof(studiohdr_t)) != 0",
			"!IsMemoryAddressRangeRepresentable(unStudioHeaderAddress, sizeof(studiohdr_t))",
			"kStudioHeaderIDPropertyName = \"ID\";",
			"kStudioHeaderVersionPropertyName = \"Version\";",
			"kStudioHeaderChecksumPropertyName = \"Checksum\";",
			"kStudioHeaderNamePropertyName = \"Name\";",
			"kStudioHeaderLengthPropertyName = \"Length\";",
			"kStudioHeaderFlagsPropertyName = \"Flags\";",
			"kStudioHeaderBoneCountPropertyName = \"BoneCount\";",
			"kStudioHeaderBoneOffsetPropertyName = \"BoneOffset\";",
			"kStudioHeaderBoneControllerCountPropertyName = \"BoneControllerCount\";",
			"kStudioHeaderBoneControllerOffsetPropertyName = \"BoneControllerOffset\";",
			"kStudioHeaderHitboxSetCountPropertyName = \"HitboxSetCount\";",
			"kStudioHeaderHitboxSetOffsetPropertyName = \"HitboxSetOffset\";",
			"kStudioHeaderLocalAnimationCountPropertyName = \"LocalAnimationCount\";",
			"kStudioHeaderLocalAnimationOffsetPropertyName = \"LocalAnimationOffset\";",
			"kStudioHeaderAttachmentCountPropertyName = \"AttachmentCount\";",
			"kStudioHeaderAttachmentOffsetPropertyName = \"AttachmentOffset\";",
			"kStudioHeaderLocalSequenceCountPropertyName = \"LocalSequenceCount\";",
			"kStudioHeaderLocalSequenceOffsetPropertyName = \"LocalSequenceOffset\";",
			"kStudioHeaderMassPropertyName = \"Mass\";",
			"kStudioHeaderContentsPropertyName = \"Contents\";",
			"kStudioHeaderEyePositionPropertyName = \"EyePosition\";",
			"kStudioHeaderIlluminationCenterPropertyName = \"IlluminationCenter\";",
			"kStudioHeaderHullMinimumsPropertyName = \"HullMinimums\";",
			"kStudioHeaderHullMaximumsPropertyName = \"HullMaximums\";",
			"kStudioHeaderViewMinimumsPropertyName = \"ViewMinimums\";",
			"kStudioHeaderViewMaximumsPropertyName = \"ViewMaximums\";",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderIDPropertyName, &pStudioHeader->id)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderVersionPropertyName, &pStudioHeader->version)",
			"!InstallStudioSignedIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderChecksumPropertyName, &pStudioHeader->checksum)",
			"!InstallStudioCStringProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderNamePropertyName, pStudioHeader->pszName())",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderLengthPropertyName, &pStudioHeader->length)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderFlagsPropertyName, &pStudioHeader->flags)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderBoneCountPropertyName, &pStudioHeader->numbones)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderBoneOffsetPropertyName, &pStudioHeader->boneindex)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderBoneControllerCountPropertyName, &pStudioHeader->numbonecontrollers)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderBoneControllerOffsetPropertyName, &pStudioHeader->bonecontrollerindex)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderHitboxSetCountPropertyName, &pStudioHeader->numhitboxsets)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderHitboxSetOffsetPropertyName, &pStudioHeader->hitboxsetindex)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderLocalAnimationCountPropertyName, &pStudioHeader->numlocalanim)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderLocalAnimationOffsetPropertyName, &pStudioHeader->localanimindex)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderAttachmentCountPropertyName, &pStudioHeader->numlocalattachments)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderAttachmentOffsetPropertyName, &pStudioHeader->localattachmentindex)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderLocalSequenceCountPropertyName, &pStudioHeader->numlocalseq)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderLocalSequenceOffsetPropertyName, &pStudioHeader->localseqindex)",
			"!InstallStudioFloatProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderMassPropertyName, &pStudioHeader->mass)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderContentsPropertyName, &pStudioHeader->contents)",
			"LocalEyePositionObject = MakeStudioVectorObject(pIsolate, LocalContext, &pStudioHeader->eyeposition);",
			"!InstallStudioValue(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderEyePositionPropertyName, LocalEyePositionObject)",
			"LocalIlluminationCenterObject = MakeStudioVectorObject(pIsolate, LocalContext, &pStudioHeader->illumposition);",
			"!InstallStudioValue(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderIlluminationCenterPropertyName, LocalIlluminationCenterObject)",
			"LocalHullMinimumsObject = MakeStudioVectorObject(pIsolate, LocalContext, &pStudioHeader->hull_min);",
			"!InstallStudioValue(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderHullMinimumsPropertyName, LocalHullMinimumsObject)",
			"LocalHullMaximumsObject = MakeStudioVectorObject(pIsolate, LocalContext, &pStudioHeader->hull_max);",
			"!InstallStudioValue(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderHullMaximumsPropertyName, LocalHullMaximumsObject)",
			"LocalViewMinimumsObject = MakeStudioVectorObject(pIsolate, LocalContext, &pStudioHeader->view_bbmin);",
			"!InstallStudioValue(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderViewMinimumsPropertyName, LocalViewMinimumsObject)",
			"LocalViewMaximumsObject = MakeStudioVectorObject(pIsolate, LocalContext, &pStudioHeader->view_bbmax);",
			"!InstallStudioValue(pIsolate, LocalContext, LocalStudioHeaderObject, kStudioHeaderViewMaximumsPropertyName, LocalViewMaximumsObject)",
		],
		Order: ["!IsMemoryAddressRangeRepresentable(unStudioHeaderAddress, sizeof(studiohdr_t))", "v8::Object::New(pIsolate)", "if (LocalStudioHeaderObject.IsEmpty()", "!InstallStudioAddress(pIsolate, LocalContext, LocalStudioHeaderObject, pStudioHeader)", "!InstallStudioHeaderMethods(", "return LocalStudioHeaderObject;"],
		Forbidden: ["SetValue(", "SetFunction(", "->Set(", "->pStudiohdr()"],
	},
	{
		Name: "MakeStudioSequenceObject",
		Fragments: [
			"(unStudioSequenceAddress % alignof(mstudioseqdesc_t)) != 0",
			"!IsMemoryAddressRangeRepresentable(unStudioSequenceAddress, sizeof(mstudioseqdesc_t))",
			"kStudioSequenceModelHeaderOffsetPropertyName = \"ModelHeaderOffset\";",
			"kStudioSequenceLabelOffsetPropertyName = \"LabelOffset\";",
			"kStudioSequenceLabelPropertyName = \"Label\";",
			"kStudioSequenceActivityOffsetPropertyName = \"ActivityOffset\";",
			"kStudioSequenceActivityPropertyName = \"Activity\";",
			"kStudioSequenceFlagsPropertyName = \"Flags\";",
			"kStudioSequenceActivityIndexPropertyName = \"ActivityIndex\";",
			"kStudioSequenceActivityWeightPropertyName = \"ActivityWeight\";",
			"kStudioSequenceEventCountPropertyName = \"EventCount\";",
			"kStudioSequenceEventOffsetPropertyName = \"EventOffset\";",
			"kStudioSequenceBlendCountPropertyName = \"BlendCount\";",
			"kStudioSequenceAnimationOffsetPropertyName = \"AnimationOffset\";",
			"kStudioSequenceMovementOffsetPropertyName = \"MovementOffset\";",
			"kStudioSequenceFadeInTimePropertyName = \"FadeInTime\";",
			"kStudioSequenceFadeOutTimePropertyName = \"FadeOutTime\";",
			"kStudioSequenceLocalEntryNodePropertyName = \"LocalEntryNode\";",
			"kStudioSequenceLocalExitNodePropertyName = \"LocalExitNode\";",
			"kStudioSequenceNodeFlagsPropertyName = \"NodeFlags\";",
			"kStudioSequenceEntryPhasePropertyName = \"EntryPhase\";",
			"kStudioSequenceExitPhasePropertyName = \"ExitPhase\";",
			"kStudioSequenceLastFramePropertyName = \"LastFrame\";",
			"kStudioSequenceNextSequencePropertyName = \"NextSequence\";",
			"kStudioSequenceDeltaAnimationIndexPropertyName = \"DeltaAnimationIndex\";",
			"kStudioSequenceMinimumsPropertyName = \"Minimums\";",
			"kStudioSequenceMaximumsPropertyName = \"Maximums\";",
			"kStudioSequenceGetModelHeaderFunctionName = \"GetModelHeader\";",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceModelHeaderOffsetPropertyName, &pStudioSequence->baseptr)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceLabelOffsetPropertyName, &pStudioSequence->szlabelindex)",
			"!InstallStudioCStringProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceLabelPropertyName, pStudioSequence->pszLabel())",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceActivityOffsetPropertyName, &pStudioSequence->szactivitynameindex)",
			"!InstallStudioCStringProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceActivityPropertyName, pStudioSequence->pszActivityName())",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceFlagsPropertyName, &pStudioSequence->flags)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceActivityIndexPropertyName, &pStudioSequence->activity)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceActivityWeightPropertyName, &pStudioSequence->actweight)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceEventCountPropertyName, &pStudioSequence->numevents)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceEventOffsetPropertyName, &pStudioSequence->eventindex)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceBlendCountPropertyName, &pStudioSequence->numblends)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceAnimationOffsetPropertyName, &pStudioSequence->animindexindex)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceMovementOffsetPropertyName, &pStudioSequence->movementindex)",
			"!InstallStudioFloatProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceFadeInTimePropertyName, &pStudioSequence->fadeintime)",
			"!InstallStudioFloatProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceFadeOutTimePropertyName, &pStudioSequence->fadeouttime)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceLocalEntryNodePropertyName, &pStudioSequence->localentrynode)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceLocalExitNodePropertyName, &pStudioSequence->localexitnode)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceNodeFlagsPropertyName, &pStudioSequence->nodeflags)",
			"!InstallStudioFloatProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceEntryPhasePropertyName, &pStudioSequence->entryphase)",
			"!InstallStudioFloatProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceExitPhasePropertyName, &pStudioSequence->exitphase)",
			"!InstallStudioFloatProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceLastFramePropertyName, &pStudioSequence->lastframe)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceNextSequencePropertyName, &pStudioSequence->nextseq)",
			"!InstallStudioIntegerProperty(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceDeltaAnimationIndexPropertyName, &pStudioSequence->pose)",
			"LocalStudioSequenceMinimumsObject = MakeStudioVectorObject(pIsolate, LocalContext, &pStudioSequence->bbmin);",
			"!InstallStudioValue(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceMinimumsPropertyName, LocalStudioSequenceMinimumsObject)",
			"LocalStudioSequenceMaximumsObject = MakeStudioVectorObject(pIsolate, LocalContext, &pStudioSequence->bbmax);",
			"!InstallStudioValue(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceMaximumsPropertyName, LocalStudioSequenceMaximumsObject)",
			"!ApplyMemoryAddressOffset(pIsolate, unStudioSequenceAddress, static_cast<std::int64_t>(pStudioSequence->baseptr), false, kMissingStudioModelHeaderErrorMessage, unStudioHeaderAddress)",
			"unStudioHeaderAddress == 0x0",
			"(unStudioHeaderAddress % alignof(studiohdr_t)) != 0",
			"!IsMemoryAddressRangeRepresentable(unStudioHeaderAddress, sizeof(studiohdr_t))",
			"!InstallStudioFunction(pIsolate, LocalContext, LocalStudioSequenceObject, kStudioSequenceGetModelHeaderFunctionName, GetStudioSequenceModelHeaderCallback, LocalMethodData)",
		],
		Order: ["!IsMemoryAddressRangeRepresentable(unStudioSequenceAddress, sizeof(mstudioseqdesc_t))", "!ApplyMemoryAddressOffset(", "!IsMemoryAddressRangeRepresentable(unStudioHeaderAddress, sizeof(studiohdr_t))", "v8::Object::New(pIsolate)", "if (LocalStudioSequenceObject.IsEmpty()", "!InstallStudioAddress(pIsolate, LocalContext, LocalStudioSequenceObject, pStudioSequence)", "v8::Undefined(pIsolate)", "if (LocalMethodData.IsEmpty()", "!InstallStudioFunction(", "!InstallStudioSequenceMethods(", "return LocalStudioSequenceObject;"],
		Forbidden: ["SetValue(", "SetFunction(", "->Set(", "->pStudiohdr()"],
	},
	{
		Name: "InstallStudioSequenceMethods",
		Fragments: [
			"kGetAnimationIndexFunctionName = \"GetAnimationIndex\";",
			"kGetWeightFunctionName = \"GetWeight\";",
			"!InstallStudioFunction(pIsolate, LocalContext, LocalSequenceObject, kGetAnimationIndexFunctionName, GetStudioSequenceAnimationIndexCallback, LocalMethodData)",
			"!InstallStudioFunction(pIsolate, LocalContext, LocalSequenceObject, kGetWeightFunctionName, GetStudioSequenceWeightCallback, LocalMethodData)",
		],
		Order: ["v8::Undefined(pIsolate)", "if (LocalMethodData.IsEmpty()", "!InstallStudioFunction(", "return true;"],
		Forbidden: ["SetFunction("],
	},
	{
		Name: "GetStudioSignedIntegerPropertyAddress",
		Fragments: [
			"std::is_integral_v<TValue> && std::is_signed_v<TValue>",
			"std::numeric_limits<TValue>::digits <= std::numeric_limits<std::int64_t>::digits",
			"!LocalPropertyMetadata->IsExternal()",
			"if (!pnSignedIntegerPropertyValue)",
			"(unSignedIntegerPropertyAddress % alignof(TValue)) != 0",
			"!IsMemoryAddressRangeRepresentable(unSignedIntegerPropertyAddress, sizeof(TValue))",
		],
		Order: ["!LocalPropertyMetadata->IsExternal()", "->Value()", "if (!pnSignedIntegerPropertyValue)", "!IsMemoryAddressRangeRepresentable(", "return pnSignedIntegerPropertyValue;"],
		Forbidden: [],
	},
	{
		Name: "GetStudioSignedIntegerPropertyCallback",
		Fragments: [
			"TValue nPropertyValue = 0;",
			"std::numeric_limits<TValue>::digits > std::numeric_limits<std::int32_t>::digits",
			"v8::BigInt::New(pIsolate, static_cast<std::int64_t>(nPropertyValue))",
			"v8::Number::New(pIsolate, static_cast<double>(nPropertyValue))",
		],
		Order: ["GetStudioSignedIntegerPropertyAddress<TValue>(", "if (!pnSignedIntegerPropertyValue", "!ReadMemoryScalarFromAddress(", "if constexpr", "if (LocalPropertyValue.IsEmpty()", "PropertyInformation.GetReturnValue().Set(LocalPropertyValue);"],
		Forbidden: ["= *pnSignedIntegerPropertyValue", "kMaximumSafeNumberInteger"],
	},
	{
		Name: "SetStudioSignedIntegerPropertyCallback",
		Fragments: [
			"std::numeric_limits<TValue>::digits > std::numeric_limits<std::int32_t>::digits",
			"!LocalPropertyValue->IsBigInt()",
			"bool bLosslessConversion = false;",
			"!bLosslessConversion ||",
			"nConvertedPropertyValue < std::numeric_limits<TValue>::min()",
			"nConvertedPropertyValue > std::numeric_limits<TValue>::max()",
			"!LocalPropertyValue->IsNumber()",
			"!std::isfinite(dblPropertyValue)",
			"std::trunc(dblPropertyValue) != dblPropertyValue",
			"dblPropertyValue < static_cast<double>(std::numeric_limits<TValue>::min())",
			"dblPropertyValue > static_cast<double>(std::numeric_limits<TValue>::max())",
			"nPropertyValue = static_cast<TValue>(nConvertedPropertyValue);",
			"nPropertyValue = static_cast<TValue>(dblPropertyValue);",
		],
		Order: ["if (LocalPropertyValue.IsEmpty())", "if constexpr", "!LocalPropertyValue->IsBigInt()", "->Int64Value(&bLosslessConversion)", "if (!bLosslessConversion", "!LocalPropertyValue->IsNumber()", "->NumberValue(LocalContext)", "if (MaybePropertyValue.IsNothing()", "!std::isfinite(", "GetStudioSignedIntegerPropertyAddress<TValue>(", "if (!pnSignedIntegerPropertyValue", "WriteMemoryScalarToAddress(reinterpret_cast<std::uintptr_t>(pnSignedIntegerPropertyValue), nPropertyValue);"],
		Forbidden: ["*pnSignedIntegerPropertyValue =", "kMaximumSafeNumberInteger"],
	},
	{
		Name: "InstallStudioSignedIntegerProperty",
		Fragments: [
			"(unSignedIntegerPropertyAddress % alignof(TValue)) != 0",
			"!IsMemoryAddressRangeRepresentable(unSignedIntegerPropertyAddress, sizeof(TValue))",
			"GetStudioSignedIntegerPropertyCallback<TValue>, SetStudioSignedIntegerPropertyCallback<TValue>, LocalPropertyMetadata).FromMaybe(false)",
		],
		Order: ["if (!pnSignedIntegerPropertyValue", "!IsMemoryAddressRangeRepresentable(", "MakeString(", "if (LocalPropertyName.IsEmpty()", "v8::External::New(", "if (LocalPropertyMetadata.IsEmpty()", "->SetNativeDataProperty(", "if (!bPropertyInstalled", "return true;"],
		Forbidden: [],
	},
	{
		Name: "GetStudioSequenceModelHeaderCallback",
		Fragments: [
			"kGetModelHeaderOperationName = \"Sequence.GetModelHeader()\";",
			"!ApplyMemoryAddressOffset(pCallbackIsolate, unCallbackStudioSequenceAddress, static_cast<std::int64_t>(pCallbackStudioSequence->baseptr), false, kStudioHeaderResolutionErrorMessage, unCallbackStudioHeaderAddress)",
		],
		Order: ["RequireStudioSequenceFromThis(", "if (!pCallbackStudioSequence", "!IsMemoryAddressRangeRepresentable(unCallbackStudioSequenceAddress, sizeof(mstudioseqdesc_t))", "!ApplyMemoryAddressOffset(", "reinterpret_cast<studiohdr_t*>(unCallbackStudioHeaderAddress)", "MakeStudioHeaderObject(", "if (LocalStudioHeaderObject.IsEmpty()", "CallbackInformation.GetReturnValue().Set(LocalStudioHeaderObject);"],
		Forbidden: ["->pStudiohdr()"],
	},
];

let g_unRejectedMutationCount = 0;

function GetRawDefinition(strSource, strName) {
	// Literal candidates avoid a full regular-expression scan for every source mutation.
	const strEscapedName = strName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const strDefinitionName = strName + "(";
	const HeaderPattern = new RegExp("^(\\t{1,2})(?:bool|TValue\\*|IMDLCache\\*|float\\*|int\\*|unsigned int\\*|char const\\*|studiohdr_t\\*|mstudiohitboxset_t\\*|mstudioseqdesc_t\\*|void|v8::Local<v8::(?:Object|Array|BigInt)>) " + strEscapedName + "\\([^\\n;{}]*\\)(?: noexcept)? \\{$");
	const vecMatches = [];
	let nCandidateIndex = strSource.indexOf(strDefinitionName);
	while (nCandidateIndex >= 0) {
		const unLineStart = strSource.lastIndexOf("\n", nCandidateIndex) + 1;
		const nLineEnd = strSource.indexOf("\n", nCandidateIndex);
		const unLineEnd = (nLineEnd < 0) ? strSource.length : nLineEnd;
		const vecCandidate = HeaderPattern.exec(strSource.slice(unLineStart, unLineEnd));
		if (vecCandidate) {
			vecMatches.push({ Index: unLineStart, Indentation: vecCandidate[1], HeaderLength: vecCandidate[0].length });
		}

		nCandidateIndex = strSource.indexOf(strDefinitionName, unLineEnd);
	}

	g_Assert.equal(vecMatches.length, 1, "Expected exactly one real Studio definition: " + strName);
	const Definition = vecMatches[0];
	const ClosingPattern = new RegExp("^" + Definition.Indentation + "\\}$", "gm");
	ClosingPattern.lastIndex = Definition.Index + Definition.HeaderLength;
	const vecClosing = ClosingPattern.exec(strSource);
	g_Assert(vecClosing && (vecClosing.index > Definition.Index), "Missing Studio definition closing brace: " + strName);

	return strSource.slice(Definition.Index, vecClosing.index + vecClosing[0].length);
}

function GetDefinition(strSource, strName) {
	const strActualDefinition = GetRawDefinition(strSource, strName);
	const bNested = strActualDefinition.startsWith("\t\t");
	const strDefinition = bNested ? strActualDefinition.replace(/^\t/gm, "") : strActualDefinition;
	g_Assert.equal(bNested ? strDefinition.replace(/^\t/gm, "\t\t") : strDefinition, strActualDefinition, "Normalize namespace indentation reversibly without changing preprocessor lines.");

	return strDefinition;
}

function CheckDefinitionExtraction() {
	for (const strIndentation of ["\t", "\t\t"]) {
		const strPrototype = strIndentation + "bool Probe(int nValue); // signature marker ) {\n";
		const strUnrelated = strIndentation + "bool Other(int nValue) {\n" + strIndentation + "\treturn Probe(nValue);\n" + strIndentation + "}\n";
		const strDefinition = strIndentation + "bool Probe(int nValue) noexcept {\n#if defined(SOURCEJS_EXTRACTOR_TEST)\n" + strIndentation + "\treturn true;\n#else\n" + strIndentation + "\treturn false;\n#endif\n" + strIndentation + "}";
		const strSource = strPrototype + strUnrelated + strDefinition + "\n";
		g_Assert.equal(GetRawDefinition(strSource, "Probe"), strDefinition, "Ignore prototypes, comments, and unrelated bodies.");
		const strNormalizedDefinition = (strIndentation === "\t\t") ? strDefinition.replace(/^\t/gm, "") : strDefinition;
		g_Assert.equal(GetDefinition(strSource, "Probe"), strNormalizedDefinition, "Namespace normalization preserves preprocessor lines.");

		const strEmptyArgumentDefinition = strIndentation + "bool Probe() {\n" + strIndentation + "\treturn true;\n" + strIndentation + "}";
		g_Assert.equal(GetRawDefinition(strEmptyArgumentDefinition + "\n", "Probe"), strEmptyArgumentDefinition);
		g_Assert.throws(() => GetRawDefinition(strPrototype + strUnrelated, "Probe"), { code: "ERR_ASSERTION" });
		g_Assert.throws(() => GetRawDefinition(strDefinition + "\n" + strDefinition + "\n", "Probe"), { code: "ERR_ASSERTION" });
	}
}

function CheckOrder(strDefinition, vecFragments) {
	let nPreviousIndex = -1;
	for (const strFragment of vecFragments) {
		const nIndex = strDefinition.indexOf(strFragment);
		g_Assert(nIndex >= 0, "Missing ordered fragment: " + strFragment);
		g_Assert(nIndex > nPreviousIndex, "Unexpected fragment order: " + strFragment);
		nPreviousIndex = nIndex;
	}
}

function GetFailureBranches(strDefinition) {
	return [...strDefinition.matchAll(/^\t+if \([^\n]*StudioFailure.HasCaught\(\)[^\n]*\) \{\n\t+(RethrowV8InstallationFailure\([^\n]+\);)\n\t+return(?: [^\n;]+)?;/gm)];
}

function CheckHeaderSequenceContracts(strSource) {
	for (const Check of g_vecHeaderSequenceChecks) {
		const strDefinition = GetDefinition(strSource, Check.Name);
		for (const strFragment of Check.Fragments) {
			g_Assert(strDefinition.includes(strFragment), Check.Name + ": " + strFragment);
		}

		CheckOrder(strDefinition, Check.Order);

		for (const strForbidden of Check.Forbidden) {
			g_Assert(!strDefinition.includes(strForbidden), Check.Name + ": forbidden " + strForbidden);
		}
	}
}

function CheckCacheContracts(strSource) {
	for (const Method of g_vecCacheMethods) {
		const strDefinition = GetDefinition(strSource, Method.Callback);
		g_Assert(strDefinition.includes("kRequiredArgumentCount = 1;"));
		g_Assert(strDefinition.includes("if (CallbackInformation.Length() < kRequiredArgumentCount)"));
		g_Assert.equal(strDefinition.split("CallbackInformation.GetReturnValue().Set(").length - 1, (Method.Role === "GetModelHeader") ? 2 : 1);
		g_Assert.doesNotMatch(strDefinition, /SetValue\(|SetFunction\(|ThrowError\(/);

		if (Method.SDK === undefined) {
			g_Assert(strDefinition.includes("kModelPathArgumentIndex = 0;"));
			g_Assert(strDefinition.includes("LocalModelPathValue.IsEmpty() || !LocalModelPathValue->IsString() ||"));
			g_Assert(strDefinition.includes("studio/cache." + Method.Role + "(strModelPath) expects a non-empty model path."));
			g_Assert(strDefinition.includes("studio/cache model paths must not contain embedded NUL bytes."));
			g_Assert.equal(strDefinition.split("->FindMDL(strModelPath.c_str())").length - 1, 1);
			CheckOrder(strDefinition, ["if (CallbackInformation.Length()", "CallbackInformation[kModelPathArgumentIndex]", "if (LocalModelPathValue.IsEmpty()", "ValueToString(pIsolate, LocalModelPathValue)", "if (StudioFailure.HasCaught()", "if (strModelPath.empty())", "if (strModelPath.find('\\0') != std::string::npos)", "RequireStudioModelCache(pIsolate, k" + Method.Role + "OperationName)", "->FindMDL(strModelPath.c_str());\n\t\t\tStudioModelReferenceOwner ReferenceOwner = StudioModelReferenceOwner(pStudioModelCache, hModelHandle);", "CallbackInformation.GetReturnValue().Set(", "ReferenceOwner.ReleaseOwnership();"]);
			g_Assert(strDefinition.includes((Method.Role === "FindModel") ? "MakeStudioModelObject(pIsolate, LocalContext, hModelHandle)" : "CallbackInformation.GetReturnValue().Set(static_cast<int>(hModelHandle));"));

		} else {
			g_Assert(strDefinition.includes("kModelHandleArgumentIndex = 0;"));
			g_Assert(strDefinition.includes("MDLHandle_t hModelHandle = MDLHANDLE_INVALID;"));
			g_Assert(strDefinition.includes("if (!GetStudioModelHandleFromValue(LocalContext, LocalModelHandleValue, hModelHandle) ||"));
			g_Assert.equal(strDefinition.split("pStudioModelCache->" + Method.SDK + "(hModelHandle)").length - 1, 1);
			g_Assert(strDefinition.includes(Method.Local + " = pStudioModelCache->" + Method.SDK + "(hModelHandle);"));
			CheckOrder(strDefinition, ["CallbackInformation[kModelHandleArgumentIndex]", "!GetStudioModelHandleFromValue(LocalContext, LocalModelHandleValue, hModelHandle)", "!RequireStudioModelHandle(pIsolate, k" + Method.Role + "OperationName, hModelHandle)", "RequireStudioModelCache(pIsolate, k" + Method.Role + "OperationName)", "pStudioModelCache->" + Method.SDK + "(hModelHandle);\n\t\t\tif (StudioFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set("]);
			g_Assert(strDefinition.includes("studio/cache." + Method.Role + "(hModelHandle) expects a model handle."));
		}
	}

	CheckOrder(GetDefinition(strSource, "FindStudioModelCallback"), ["MakeStudioModelObject(pIsolate, LocalContext, hModelHandle)", "if (LocalStudioModelObject.IsEmpty()", "CallbackInformation.GetReturnValue().Set(LocalStudioModelObject);", "ReferenceOwner.ReleaseOwnership();"]);

	for (const strName of ["AddStudioReferenceCallback", "ReleaseStudioReferenceCallback", "GetStudioReferenceCountCallback"]) {
		g_Assert(GetDefinition(strSource, strName).includes("CallbackInformation.GetReturnValue().Set(nReferenceCount);"));
	}

	CheckOrder(GetDefinition(strSource, "GetStudioCacheModelNameCallback"), ["if (!pszModelName)", "kMissingModelNameErrorMessage);", "MakeString(pIsolate, pszModelName)", "if (LocalModelName.IsEmpty()", "CallbackInformation.GetReturnValue().Set(LocalModelName);"]);

	const strHeaderAddress = GetDefinition(strSource, "GetStudioModelHeaderAddressCallback");
	CheckOrder(strHeaderAddress, ["->GetStudioHdr(hModelHandle)", "MakeStudioAddressValue(pIsolate, pStudioHeader)", "if (LocalModelHeaderAddressValue.IsEmpty()", "CallbackInformation.GetReturnValue().Set(LocalModelHeaderAddressValue);"]);
	g_Assert.doesNotMatch(strHeaderAddress, /v8::Number|static_cast<double>|if \(!pStudioHeader\)/);

	for (const strName of ["GetStudioModelHeaderCallback", "RequireStudioModelHeaderCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		const strMissingResult = (strName === "GetStudioModelHeaderCallback") ? "CallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));" : "RethrowV8InstallationFailure(pIsolate, StudioFailure, kMissingModelHeaderErrorMessage);";
		CheckOrder(strDefinition, ["if (!pStudioHeader)", strMissingResult + "\n\t\t\t\treturn;", "MakeStudioHeaderObject(pIsolate, LocalContext, pStudioHeader)", "if (LocalStudioHeaderObject.IsEmpty()", "CallbackInformation.GetReturnValue().Set(LocalStudioHeaderObject);"]);
	}

	const strDataTypes = GetDefinition(strSource, "MakeStudioModelCacheDataTypeObject");
	g_Assert.doesNotMatch(strDataTypes, /SetInteger\(|SetValue\(|->Set\(/);
	for (const DataType of g_vecCacheDataTypes) {
		g_Assert(strDataTypes.includes("kStudioModelCacheDataType" + DataType.Role + 'PropertyName = "' + DataType.Role + '";'));
		CheckOrder(strDataTypes, [DataType.Local + " = v8::Integer::New(pIsolate, static_cast<int>(" + DataType.SDK + "))", "if (" + DataType.Local + ".IsEmpty()", "!InstallStudioValue(pIsolate, LocalContext, LocalStudioModelCacheDataTypeObject, kStudioModelCacheDataType" + DataType.Role + "PropertyName, " + DataType.Local + ") ||"]);
	}

	g_Assert(strDataTypes.includes("#if !defined(SOURCEJS_OLD_CONSOLE_API)\n\t\tconstexpr char const* const kStudioModelCacheDataTypeDecodedAnimationBlockPropertyName"));
	g_Assert(strDataTypes.includes("#if !defined(SOURCEJS_OLD_CONSOLE_API)\n\t\t\tv8::Local<v8::Integer> const LocalDecodedAnimationBlockDataTypeValue"));

	const strInstaller = GetDefinition(strSource, "InstallStudioCacheFunctions");
	g_Assert.doesNotMatch(strInstaller, /SetInteger\(|SetFunction\(|SetValue\(|->Set\(/);
	g_Assert(strInstaller.includes("LocalContext.IsEmpty() || LocalTargetObject.IsEmpty() || LocalRuntimeData.IsEmpty() ||"));
	g_Assert(strInstaller.includes('kStudioCacheInvalidModelHandlePropertyName = "INVALID_MODEL_HANDLE";'));
	g_Assert(strInstaller.includes('kStudioCacheModelCacheDataTypePropertyName = "ModelCacheDataType";'));
	CheckOrder(strInstaller, ["LocalInvalidModelHandleValue = v8::Integer::New(pIsolate, static_cast<int>(MDLHANDLE_INVALID))", "if (LocalInvalidModelHandleValue.IsEmpty()", "!InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioCacheInvalidModelHandlePropertyName, LocalInvalidModelHandleValue)", "MakeStudioModelCacheDataTypeObject(pIsolate, LocalContext)", "if (LocalStudioModelCacheDataTypeObject.IsEmpty()", "!InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioCacheModelCacheDataTypePropertyName, LocalStudioModelCacheDataTypeObject)"]);
	for (const Method of g_vecCacheMethods) {
		g_Assert(strInstaller.includes("kStudioCache" + Method.Role + 'FunctionName = "' + Method.Role + '";'));
		g_Assert(strInstaller.includes("!InstallStudioFunction(pIsolate, LocalContext, LocalTargetObject, kStudioCache" + Method.Role + "FunctionName, " + Method.Callback + ", LocalRuntimeData) ||"));
	}

	g_Assert(strInstaller.includes("#if !defined(SOURCEJS_OLD_CONSOLE_API)\n\t\tconstexpr char const* const kStudioCacheGetReferenceCountFunctionName"));
	g_Assert(strInstaller.includes("#if !defined(SOURCEJS_OLD_CONSOLE_API)\n\t\t\tif (!InstallStudioFunction(pIsolate, LocalContext, LocalTargetObject, kStudioCacheGetReferenceCountFunctionName"));
}

function CheckConstantContracts(strSource) {
	const strDefinition = GetDefinition(strSource, "InstallStudioConstants");
	g_Assert.doesNotMatch(strDefinition, /SetInteger\(|SetNumber\(|SetValue\(|->Set\(/);
	g_Assert(strDefinition.includes("LocalContext.IsEmpty() || LocalTargetObject.IsEmpty() || StudioFailure.HasCaught()"));
	g_Assert.equal(strDefinition.split("!InstallStudioValue(").length - 1, 20);
	for (const strRole of ["Attachment", "Bone"]) {
		g_Assert(strDefinition.includes("kStudioInvalid" + strRole + "Index = -1;"));
		g_Assert(strDefinition.includes("kStudioInvalid" + strRole + 'IndexPropertyName = "INVALID_' + strRole.toUpperCase() + '_INDEX";'));
		g_Assert(strDefinition.includes("!InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioInvalid" + strRole + "IndexPropertyName, v8::Integer::New(pIsolate, kStudioInvalid" + strRole + "Index)) ||"));
	}

	for (const Group of [
		{ Role: "ModelType", Factory: "Integer", Cast: "int", Values: g_vecStudioModelTypes },
		{ Role: "Flags", Factory: "Number", Cast: "double", Values: g_vecStudioFlags },
	]) {
		const strObject = "LocalStudio" + Group.Role + "Object";
		g_Assert(strDefinition.includes("kStudio" + Group.Role + 'ObjectPropertyName = "' + ((Group.Role === "Flags") ? "StudioFlags" : "ModelType") + '";'));
		CheckOrder(strDefinition, [strObject + " = v8::Object::New(pIsolate)", "if (" + strObject + ".IsEmpty()", "!InstallStudioValue(pIsolate, LocalContext, " + strObject + ", kStudio" + Group.Role + Group.Values[0][0] + "PropertyName", "!InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudio" + Group.Role + "ObjectPropertyName, " + strObject + ") ||"]);
		for (const vecValue of Group.Values) {
			g_Assert(strDefinition.includes("kStudio" + Group.Role + vecValue[0] + 'PropertyName = "' + vecValue[0] + '";'));
			g_Assert(strDefinition.includes("!InstallStudioValue(pIsolate, LocalContext, " + strObject + ", kStudio" + Group.Role + vecValue[0] + "PropertyName, v8::" + Group.Factory + "::New(pIsolate, static_cast<" + Group.Cast + ">(" + vecValue[1] + "))) ||"));
		}
	}

	for (const strRole of ["WireframePhysicsCollision", "ShadowDepthTexture"]) {
		g_Assert(strDefinition.includes("#if !defined(SOURCEJS_OLD_CONSOLE_API)\n\t\t\tif (!InstallStudioValue(pIsolate, LocalContext, LocalStudioFlagsObject, kStudioFlags" + strRole + "PropertyName"));
	}
}

function CheckContracts(strSource) {
	for (const Boundary of g_vecBoundaries) {
		const strIsolate = Boundary.Isolate ?? "pIsolate";
		const strRethrow = "RethrowV8InstallationFailure(" + strIsolate + ", StudioFailure, kFailureErrorMessage);";
		const strDefinition = GetDefinition(strSource, Boundary.Name);
		const nFrame = strDefinition.indexOf("v8::TryCatch StudioFailure(" + strIsolate + ");\n\t\ttry {");
		g_Assert(nFrame >= 0, "Missing failure frame: " + Boundary.Name);
		g_Assert(!strDefinition.slice(0, nFrame).includes("RethrowV8InstallationFailure("));
		g_Assert(strDefinition.includes("} catch (std::exception const&) {\n\t\t\t" + strRethrow));
		g_Assert(strDefinition.includes("} catch (...) {\n\t\t\t" + strRethrow));
		g_Assert.doesNotMatch(strDefinition, /ThrowError\(|noexcept/);
		g_Assert.equal(GetFailureBranches(strDefinition).length, Boundary.Guards, "Missing immediate propagation: " + Boundary.Name);

		if (Boundary.Result !== undefined) {
			g_Assert(strDefinition.endsWith("\n\n\t\treturn " + Boundary.Result + ";\n\t}"));
		}

		for (const strGuard of ["StudioFailure.HasCaught()", strIsolate + "->IsExecutionTerminating()", strIsolate + "->HasPendingException()"]) {
			g_Assert.equal(strDefinition.split(strGuard).length - 1, Boundary.Guards);
		}
	}

	g_Assert.equal(GetDefinition(strSource, "GetStudioModelCache"), "\tIMDLCache* GetStudioModelCache() noexcept {\n\t\treturn g_Application.GetEngineInterfaces().GetModelCache();\n\t}");

	const strHandle = GetDefinition(strSource, "GetStudioModelHandleFromValue");
	g_Assert(strHandle.includes("auto* const pIsolate = v8::Isolate::GetCurrent();"));
	g_Assert(strHandle.includes("!LocalModelHandleValue->IsUint32()"));
	g_Assert(strHandle.includes("MaybeModelHandle.IsNothing() || StudioFailure.HasCaught()"));
	g_Assert(strHandle.includes("unModelHandle > static_cast<std::uint32_t>(std::numeric_limits<MDLHandle_t>::max())"));
	CheckOrder(strHandle, ["if (LocalContext.IsEmpty()", "v8::Isolate::GetCurrent()", "->Uint32Value(", "if (MaybeModelHandle.IsNothing()", "if (unModelHandle >", "hModelHandleOut = static_cast<MDLHandle_t>(unModelHandle);", "return true;"]);
	g_Assert.doesNotMatch(strHandle, /LocalContext->GetIsolate\(/);

	const strCallbackHandle = GetDefinition(strSource, "GetStudioModelHandleFromCallback");
	g_Assert(strCallbackHandle.includes('kModelHandlePropertyName = "Handle";'));
	g_Assert(strCallbackHandle.includes("MDLHandle_t hModelHandle = MDLHANDLE_INVALID;"));
	g_Assert(strCallbackHandle.includes("!GetStudioModelHandleFromValue(LocalContext, LocalModelHandleValue, hModelHandle) || StudioFailure.HasCaught()"));
	CheckOrder(strCallbackHandle, ["->Get(LocalContext, LocalModelHandlePropertyName)", "GetStudioModelHandleFromValue(", "hModelHandleOut = hModelHandle;", "return true;"]);

	const strValid = GetDefinition(strSource, "IsStudioModelValidCallback");
	g_Assert(strValid.includes("CallbackInformation.GetReturnValue().Set(hModelHandle != MDLHANDLE_INVALID);"));
	g_Assert.doesNotMatch(strValid, /RequireStudioModelHandle\(/);
	g_Assert(GetDefinition(strSource, "RequireStudioModelHandle").includes("if (hModelHandle == MDLHANDLE_INVALID)"));
	CheckOrder(GetDefinition(strSource, "GetStudioModelNameCallback"), ["RequireStudioModelCache(", "GetStudioModelHandleFromCallback(", "RequireStudioModelHandle(", "->GetModelName(hModelHandle)", "if (!pszModelName", "MakeString(pIsolate, pszModelName)", "if (LocalModelName.IsEmpty()", "CallbackInformation.GetReturnValue().Set(LocalModelName);"]);
	CheckOrder(GetDefinition(strSource, "GetStudioModelReferenceCountCallback"), ["RequireStudioModelCache(", "GetStudioModelHandleFromCallback(", "RequireStudioModelHandle(", "->GetRef(hModelHandle)", "if (StudioFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(nReferenceCount);"]);

	const strModel = GetDefinition(strSource, "MakeStudioModelObject");
	g_Assert.doesNotMatch(strModel, /SetInteger\(|SetFunction\(|SetValue\(|->Set\(/);
	g_Assert(strModel.includes('kModelHandlePropertyName = "Handle";'));
	g_Assert(strModel.includes("v8::Local<v8::Value> const LocalModelMethodData = v8::Undefined(pIsolate);"));
	g_Assert(strModel.includes("LocalModelObject->CreateDataProperty(LocalContext, LocalName, LocalValue).FromMaybe(false)"));
	g_Assert(strModel.includes("if (!bValueDefined || StudioFailure.HasCaught()"));
	g_Assert(strModel.includes("if (!v8::Function::New(LocalContext, Callback, LocalModelMethodData).ToLocal(&LocalFunction) || StudioFailure.HasCaught()"));
	g_Assert(strModel.includes("return DefineValue(pszName, LocalFunction);"));
	g_Assert(strModel.includes("if (!DefineValue(kModelHandlePropertyName, v8::Integer::New(pIsolate, static_cast<int>(hModelHandle))) || StudioFailure.HasCaught()"));
	for (const Method of g_vecModelMethods) {
		g_Assert(strModel.includes("kModel" + Method.Role + 'FunctionName = "' + Method.Role + '";'));
		g_Assert(strModel.includes("if (!DefineFunction(kModel" + Method.Role + "FunctionName, " + Method.Callback + ") || StudioFailure.HasCaught()"));
	}

	g_Assert(strModel.includes("#if !defined(SOURCEJS_OLD_CONSOLE_API)\n\t\tconstexpr char const* const kModelGetReferenceCountFunctionName"));
	g_Assert(strModel.includes("#if !defined(SOURCEJS_OLD_CONSOLE_API)\n\t\t\tif (!DefineFunction(kModelGetReferenceCountFunctionName"));

	const strAddress = GetDefinition(strSource, "MakeStudioAddressValue");
	g_Assert(strAddress.includes("reinterpret_cast<std::uintptr_t>(pStudioAddress)"));
	g_Assert(strAddress.includes("v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unStudioAddress))"));
	CheckOrder(strAddress, ["v8::BigInt::NewFromUnsigned(", "if (LocalStudioAddress.IsEmpty()", "return LocalStudioAddress;"]);
	g_Assert.doesNotMatch(strAddress, /v8::Number|static_cast<double>|!pStudioAddress/);

	const strInstallAddress = GetDefinition(strSource, "InstallStudioAddress");
	g_Assert(strInstallAddress.includes('kStudioAddressPropertyName = "Address";'));
	g_Assert(strInstallAddress.includes("LocalTargetObject->CreateDataProperty(LocalContext, LocalAddressPropertyName, LocalStudioAddress).FromMaybe(false)"));
	CheckOrder(strInstallAddress, ["MakeStudioAddressValue(pIsolate, pStudioAddress)", "if (LocalStudioAddress.IsEmpty()", "MakeString(pIsolate, kStudioAddressPropertyName)", "if (LocalAddressPropertyName.IsEmpty()", "->CreateDataProperty(", "if (!bAddressDefined", "return true;"]);
	g_Assert.doesNotMatch(strInstallAddress, /SetValue\(|->Set\(/);

	for (const Scalar of g_vecScalarProperties) {
		for (const strName of ["GetStudio" + Scalar.Role + "PropertyAddress", "InstallStudio" + Scalar.Role + "Property"]) {
			const strDefinition = GetDefinition(strSource, strName);
			g_Assert(strDefinition.includes("if (!" + Scalar.Address + ")"));
			g_Assert(strDefinition.includes("if ((un" + Scalar.Role + "PropertyAddress % alignof(" + Scalar.Type + ")) != 0)"));
			g_Assert(strDefinition.includes("if (!IsMemoryAddressRangeRepresentable(un" + Scalar.Role + "PropertyAddress, sizeof(" + Scalar.Type + ")))"));
		}

		const strGetter = GetDefinition(strSource, "GetStudio" + Scalar.Role + "PropertyCallback");
		g_Assert(strGetter.includes("if (!ReadMemoryScalarFromAddress(reinterpret_cast<std::uintptr_t>(" + Scalar.Address + "), " + Scalar.Value + "))"));
		CheckOrder(strGetter, ["GetStudio" + Scalar.Role + "PropertyAddress(", "if (!" + Scalar.Address, "if (!ReadMemoryScalarFromAddress(", "PropertyInformation.GetReturnValue().Set(" + Scalar.Value + ");"]);
		g_Assert.doesNotMatch(strGetter, new RegExp("= \\*" + Scalar.Address));

		const strSetter = GetDefinition(strSource, "SetStudio" + Scalar.Role + "PropertyCallback");
		g_Assert(strSetter.includes("WriteMemoryScalarToAddress(reinterpret_cast<std::uintptr_t>(" + Scalar.Address + "), " + Scalar.Value + ");"));
		CheckOrder(strSetter, ["GetStudio" + Scalar.Role + "PropertyAddress(", "if (!" + Scalar.Address, (Scalar.Role === "Float") ? "->NumberValue(" : "->Int32Value(", "WriteMemoryScalarToAddress("]);
		g_Assert.doesNotMatch(strSetter, new RegExp("\\*" + Scalar.Address + " ="));

		const strInstaller = GetDefinition(strSource, "InstallStudio" + Scalar.Role + "Property");
		g_Assert(strInstaller.includes("LocalTargetObject->SetNativeDataProperty(LocalContext, LocalPropertyName, GetStudio" + Scalar.Role + "PropertyCallback, SetStudio" + Scalar.Role + "PropertyCallback, Local" + Scalar.Role + "PropertyMetadata).FromMaybe(false)"));
		CheckOrder(strInstaller, ["if (!IsMemoryAddressRangeRepresentable(", "MakeString(", "if (LocalPropertyName.IsEmpty()", "v8::External::New(", "if (Local" + Scalar.Role + "PropertyMetadata.IsEmpty()", "->SetNativeDataProperty(", "if (!bPropertyInstalled", "return true;"]);
	}

	const strFloat = GetDefinition(strSource, "SetStudioFloatPropertyCallback");
	g_Assert(strFloat.includes("!LocalFloatPropertyValue->IsNumber()"));
	g_Assert(strFloat.includes("MaybeFloatPropertyNumberValue.IsNothing() || StudioFailure.HasCaught()"));
	g_Assert(strFloat.includes("!std::isfinite(dblFloatPropertyValue) || (dblFloatPropertyValue < kMinimumFloatPropertyValue) || (dblFloatPropertyValue > kMaximumFloatPropertyValue)"));

	const strInteger = GetDefinition(strSource, "SetStudioIntegerPropertyCallback");
	g_Assert(strInteger.includes("!LocalIntegerPropertyValue->IsInt32()"));
	g_Assert(strInteger.includes("MaybeIntegerPropertyValue.IsNothing() || StudioFailure.HasCaught()"));
	g_Assert(strSource.includes('static_assert(sizeof(int) == sizeof(std::int32_t), "Studio integer accessors require 32-bit SDK integers.");'));

	const strStringAddress = GetDefinition(strSource, "GetStudioCStringPropertyAddress");
	g_Assert(strStringAddress.includes("!LocalStringPropertyMetadataValue->IsExternal()"));
	g_Assert(strStringAddress.includes("static_cast<char const*>(LocalStringPropertyMetadata->Value())"));
	g_Assert.doesNotMatch(strStringAddress, /!pszStringPropertyValue/);

	const strString = GetDefinition(strSource, "GetStudioCStringPropertyCallback");
	g_Assert(strString.includes("if (!pszStringPropertyValue) {\n\t\t\t\tPropertyInformation.GetReturnValue().Set(v8::Null(pIsolate));\n\t\t\t\treturn;"));
	CheckOrder(strString, ["GetStudioCStringPropertyAddress(", "if (StudioFailure.HasCaught()", "if (!pszStringPropertyValue)", "MakeString(pIsolate, pszStringPropertyValue)", "if (LocalStringPropertyValue.IsEmpty()", "PropertyInformation.GetReturnValue().Set(LocalStringPropertyValue);"]);

	const strStringInstaller = GetDefinition(strSource, "InstallStudioCStringProperty");
	g_Assert(strStringInstaller.includes("const_cast<char*>(pszStringPropertyValue)"));
	g_Assert(strStringInstaller.includes("LocalTargetObject->SetNativeDataProperty(LocalContext, LocalPropertyName, GetStudioCStringPropertyCallback, nullptr, LocalStringPropertyMetadata).FromMaybe(false)"));
	g_Assert.doesNotMatch(strStringInstaller, /!pszStringPropertyValue/);
	CheckOrder(strStringInstaller, ["MakeString(", "if (LocalPropertyName.IsEmpty()", "v8::External::New(", "if (LocalStringPropertyMetadata.IsEmpty()", "->SetNativeDataProperty(", "if (!bPropertyInstalled", "return true;"]);

	for (const View of g_vecMathViews) {
		const strDefinition = GetDefinition(strSource, View.Name);
		g_Assert(strDefinition.includes("if (!" + View.Address + ")"));
		g_Assert(strDefinition.includes("((unStorageAddress % alignof(" + View.Type + ")) != 0) || !IsMemoryAddressRangeRepresentable(unStorageAddress, sizeof(" + View.Type + "))"));
		CheckOrder(strDefinition, ["if (!" + View.Address, "IsMemoryAddressRangeRepresentable(", "v8::Object::New(", "InstallStudioAddress(", "InstallStudioFloatProperty(", "return " + View.Object + ";"]);

		for (const vecComponent of View.Components) {
			g_Assert(strDefinition.includes('PropertyName = "' + vecComponent[0] + '";'));
			g_Assert(strDefinition.includes(", &" + View.Address + "->" + vecComponent[1] + ") || StudioFailure.HasCaught()"));
		}
	}

	const strIntegerArray = GetDefinition(strSource, "MakeStudioIntegerArray");
	g_Assert(strIntegerArray.includes("!pnIntegerValues || (nElementCount < 0)"));
	g_Assert(strIntegerArray.includes("unElementCount > (std::numeric_limits<std::size_t>::max() / sizeof(int))"));
	g_Assert(strIntegerArray.includes("if (unElementCount != 0) {"));
	g_Assert(strIntegerArray.includes("((unIntegerArrayAddress % alignof(int)) != 0) || !IsMemoryAddressRangeRepresentable(unIntegerArrayAddress, unIntegerArrayByteCount)"));
	g_Assert(strIntegerArray.includes("&pnIntegerValues[unIndex]) || StudioFailure.HasCaught()"));
	CheckOrder(strIntegerArray, ["if (!pnIntegerValues", "if (unElementCount >", "if (unElementCount != 0)", "unElementCount * sizeof(int)", "IsMemoryAddressRangeRepresentable(", "v8::Array::New(", "InstallStudioAddress(", "std::to_string(unIndex)", "InstallStudioIntegerProperty(", "return LocalIntegerArray;"]);

	const strMatrix = GetDefinition(strSource, "MakeStudioMatrix3x4Array");
	g_Assert(strMatrix.includes("((unStorageAddress % alignof(matrix3x4_t)) != 0) || !IsMemoryAddressRangeRepresentable(unStorageAddress, sizeof(matrix3x4_t))"));
	g_Assert(strMatrix.includes("LocalMatrixRows->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(unRowIndex), LocalMatrixRow).FromMaybe(false)"));
	g_Assert(strMatrix.includes("&(*pMatrix3x4Value)[static_cast<int>(unRowIndex)][unColumnIndex]) || StudioFailure.HasCaught()"));
	g_Assert.doesNotMatch(strMatrix, /->Set\(/);
	CheckOrder(strMatrix, ["if (!pMatrix3x4Value", "IsMemoryAddressRangeRepresentable(", "v8::Array::New(", "InstallStudioAddress(", "for (std::size_t unRowIndex", "if (LocalMatrixRow.IsEmpty()", "for (std::size_t unColumnIndex", "InstallStudioFloatProperty(", "->CreateDataProperty(", "return LocalMatrixRows;"]);

	const strAddressDecoder = GetDefinition(strSource, "GetStudioAddressFromValue");
	g_Assert(strAddressDecoder.includes("!LocalAddressValue->IsBigInt()"));
	g_Assert(strAddressDecoder.includes("v8::Isolate::GetCurrent()"));
	g_Assert(strAddressDecoder.includes("!bLossless || (unAddressValue > std::numeric_limits<std::uintptr_t>::max())"));
	CheckOrder(strAddressDecoder, ["->Uint64Value(&bLossless)", "if (StudioFailure.HasCaught()", "if (!bLossless", "unAddressOut = static_cast<std::uintptr_t>(unAddressValue);", "return true;"]);

	const strAddressReader = GetDefinition(strSource, "GetStudioAddressFromObject");
	g_Assert(strAddressReader.includes('kAddressPropertyName = "Address";'));
	g_Assert(strAddressReader.includes("GetStudioAddressFromValue(LocalAddressValue, unAddress)"));
	CheckOrder(strAddressReader, ["->Get(LocalContext, LocalAddressPropertyName)", "GetStudioAddressFromValue(", "if (StudioFailure.HasCaught()", "if (!bAddressConverted)", "unAddressOut = unAddress;", "return true;"]);

	for (const Resolver of g_vecAddressResolvers) {
		const strDefinition = GetDefinition(strSource, Resolver.Name);
		CheckOrder(strDefinition, ["GetStudioAddressFromObject(", "if (StudioFailure.HasCaught()", "if (!bAddressResolved)", "if (!" + Resolver.Address, Resolver.Address + " % alignof(" + Resolver.Type + ")", "IsMemoryAddressRangeRepresentable(" + Resolver.Address + ", sizeof(" + Resolver.Type + "))", "return reinterpret_cast<" + Resolver.Type + "*>(" + Resolver.Address + ");"]);
	}

	const strProcedure = GetDefinition(strSource, "GetStudioBoneProcedureAddressCallback");
	CheckOrder(strProcedure, ["GetStudioAddressFromObject(", "if (!unStudioBoneAddress)", "unStudioBoneAddress % alignof(mstudiobone_t)", "IsMemoryAddressRangeRepresentable(unStudioBoneAddress, sizeof(mstudiobone_t))", "reinterpret_cast<mstudiobone_t*>", "pStudioBone->pProcedure()", "if (LocalStudioBoneProcedureAddressValue.IsEmpty()", "CallbackInformation.GetReturnValue().Set(LocalStudioBoneProcedureAddressValue);"]);
	g_Assert(GetDefinition(strSource, "InstallStudioBoneSurfacePropertyLookup").includes("if constexpr (requires(T& StudioBoneValue) { StudioBoneValue.surfacepropLookup; })"));

	const strOwnValue = GetDefinition(strSource, "InstallStudioValue");
	g_Assert(strOwnValue.includes("LocalTargetObject->CreateDataProperty(LocalContext, LocalPropertyName, LocalValue).FromMaybe(false)"));
	CheckOrder(strOwnValue, ["if (LocalValue.IsEmpty()", "MakeString(", "if (LocalPropertyName.IsEmpty()", "->CreateDataProperty(", "if (!bValueInstalled", "return true;"]);

	const strOwnFunction = GetDefinition(strSource, "InstallStudioFunction");
	g_Assert(strOwnFunction.includes("!v8::Function::New(LocalContext, Callback, LocalFunctionData).ToLocal(&LocalFunction)"));
	CheckOrder(strOwnFunction, ["if (LocalFunctionData.IsEmpty()", "v8::Function::New(", "InstallStudioValue(", "if (!bFunctionInstalled", "return true;"]);

	const strBone = GetDefinition(strSource, "MakeStudioBoneObject");
	g_Assert(strBone.includes("((unStorageAddress % alignof(mstudiobone_t)) != 0) || !IsMemoryAddressRangeRepresentable(unStorageAddress, sizeof(mstudiobone_t))"));
	g_Assert.doesNotMatch(strBone, /SetValue\(|SetFunction\(/);
	CheckOrder(strBone, ["if (!pStudioBone)", "IsMemoryAddressRangeRepresentable(", "v8::Object::New(", "InstallStudioAddress(", "InstallStudioBoneSurfacePropertyLookup(", "MakeStudioIntegerArray(", "return LocalModelBoneObject;"]);

	for (const View of g_vecBoneViews) {
		g_Assert(strBone.includes("kBone" + View.Role + 'PropertyName = "' + View.Public + '";'));
		CheckOrder(strBone, [View.Call, "if (" + View.Local + ".IsEmpty() || StudioFailure.HasCaught()", "!InstallStudioValue(pIsolate, LocalContext, LocalModelBoneObject, kBone" + View.Role + "PropertyName, " + View.Local + ")"]);
	}

	g_Assert(strBone.includes("v8::Local<v8::Primitive> const LocalBoneMethodData = v8::Undefined(pIsolate);"));
	CheckOrder(strBone, ["v8::Undefined(pIsolate)", "if (LocalBoneMethodData.IsEmpty()", "InstallStudioFunction(pIsolate, LocalContext, LocalModelBoneObject, kBoneProcedureAddressFunctionName, GetStudioBoneProcedureAddressCallback, LocalBoneMethodData)", "return LocalModelBoneObject;"]);

	for (const Record of g_vecRecords) {
		const strDefinition = GetDefinition(strSource, Record.Name);
		g_Assert(strDefinition.includes("((unStorageAddress % alignof(" + Record.Type + ")) != 0) || !IsMemoryAddressRangeRepresentable(unStorageAddress, sizeof(" + Record.Type + "))"));
		g_Assert.doesNotMatch(strDefinition, /SetValue\(|SetFunction\(/);
		CheckOrder(strDefinition, ["if (!" + Record.Address + ")", "IsMemoryAddressRangeRepresentable(", "v8::Object::New(", "InstallStudioAddress(", "return " + Record.Object + ";"]);

		for (const vecField of Record.Fields) {
			const strProperty = "k" + Record.Role + vecField[1] + "PropertyName";
			g_Assert(strDefinition.includes(strProperty + ' = "' + vecField[2] + '";'));
			g_Assert(strDefinition.includes("!InstallStudio" + vecField[0] + "Property(pIsolate, LocalContext, " + Record.Object + ", " + strProperty + ", " + vecField[3] + ") || StudioFailure.HasCaught()"));
		}

		for (const vecView of Record.Views) {
			const strProperty = "k" + Record.Role + vecView[0] + "PropertyName";
			g_Assert(strDefinition.includes(strProperty + ' = "' + vecView[1] + '";'));
			CheckOrder(strDefinition, [vecView[3], "if (" + vecView[2] + ".IsEmpty() || StudioFailure.HasCaught()", "!InstallStudioValue(pIsolate, LocalContext, " + Record.Object + ", " + strProperty + ", " + vecView[2] + ")"]);
		}
	}

	for (const strName of ["GetStudioUnsignedIntegerPropertyAddress", "InstallStudioUnsignedIntegerProperty"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("if (!punUnsignedIntegerPropertyValue)"));
		g_Assert(strDefinition.includes("if ((unUnsignedIntegerPropertyAddress % alignof(unsigned int)) != 0)"));
		g_Assert(strDefinition.includes("if (!IsMemoryAddressRangeRepresentable(unUnsignedIntegerPropertyAddress, sizeof(unsigned int)))"));
	}

	const strUnsignedGetter = GetDefinition(strSource, "GetStudioUnsignedIntegerPropertyCallback");
	g_Assert.doesNotMatch(strUnsignedGetter, /= \*punUnsignedIntegerPropertyValue/);
	CheckOrder(strUnsignedGetter, ["GetStudioUnsignedIntegerPropertyAddress(", "if (!punUnsignedIntegerPropertyValue", "if (!ReadMemoryScalarFromAddress(reinterpret_cast<std::uintptr_t>(punUnsignedIntegerPropertyValue), unUnsignedIntegerPropertyValue))", "v8::Integer::NewFromUnsigned(pIsolate, unUnsignedIntegerPropertyValue)", "if (LocalUnsignedIntegerPropertyValue.IsEmpty()", "PropertyInformation.GetReturnValue().Set(LocalUnsignedIntegerPropertyValue);"]);

	const strUnsignedSetter = GetDefinition(strSource, "SetStudioUnsignedIntegerPropertyCallback");
	g_Assert.doesNotMatch(strUnsignedSetter, /\*punUnsignedIntegerPropertyValue =/);
	CheckOrder(strUnsignedSetter, ["if (LocalUnsignedIntegerPropertyValue.IsEmpty())", "!LocalUnsignedIntegerPropertyValue->IsUint32()", "GetStudioUnsignedIntegerPropertyAddress(", "if (!punUnsignedIntegerPropertyValue", "->Uint32Value(", "if (MaybeUnsignedIntegerPropertyValue.IsNothing()", "WriteMemoryScalarToAddress(reinterpret_cast<std::uintptr_t>(punUnsignedIntegerPropertyValue), static_cast<unsigned int>(unUnsignedIntegerPropertyValue));"]);

	const strUnsignedInstaller = GetDefinition(strSource, "InstallStudioUnsignedIntegerProperty");
	g_Assert(strUnsignedInstaller.includes("LocalTargetObject->SetNativeDataProperty(LocalContext, LocalPropertyName, GetStudioUnsignedIntegerPropertyCallback, SetStudioUnsignedIntegerPropertyCallback, LocalUnsignedIntegerPropertyMetadata).FromMaybe(false)"));
	CheckOrder(strUnsignedInstaller, ["IsMemoryAddressRangeRepresentable(", "MakeString(", "if (LocalPropertyName.IsEmpty()", "v8::External::New(", "if (LocalUnsignedIntegerPropertyMetadata.IsEmpty()", "->SetNativeDataProperty(", "if (!bPropertyInstalled", "return true;"]);
	g_Assert(GetDefinition(strSource, "GetStudioUnsignedIntegerPropertyAddress").includes("!LocalUnsignedIntegerPropertyMetadataValue->IsExternal()"));

	const strIndex = GetDefinition(strSource, "GetStudioIndexArgument");
	g_Assert(strIndex.includes("(nCallbackArgumentIndex < kMinimumCallbackArgumentIndex) || (bOptional && (nDefaultStudioIndex < 0))"));
	g_Assert(strIndex.includes("(CallbackInformation.Length() <= nCallbackArgumentIndex) || CallbackInformation[nCallbackArgumentIndex]->IsUndefined()"));
	g_Assert(strIndex.includes("!LocalStudioIndexArgumentValue->IsInt32()"));
	CheckOrder(strIndex, ["if (bOptional)", "nStudioIndexOut = nDefaultStudioIndex;", "GetInt32Argument(pIsolate, LocalContext, LocalStudioIndexArgumentValue, pszErrorMessage, nParsedStudioIndex)", "if (nParsedStudioIndex < 0)", "nStudioIndexOut = nParsedStudioIndex;", "\n\n\t\t\treturn true;"]);

	const strOperation = GetDefinition(strSource, "GetStudioCollectionOperationFromCallback");
	g_Assert(strOperation.includes("!LocalStudioCollectionOperationData->IsInt32()"));
	CheckOrder(strOperation, ["->Value()", "nStudioCollectionOperationValue < static_cast<int>(StudioCollectionOperation::Bones)", "nStudioCollectionOperationValue > static_cast<int>(StudioCollectionOperation::Attachments)", "CollectionOperationOut = static_cast<StudioCollectionOperation>(nStudioCollectionOperationValue);", "return true;"]);
	CheckOrder(GetDefinition(strSource, "RequireStudioHeaderFromThis"), ["GetStudioHeaderFromObject(", "if (StudioFailure.HasCaught()", "if (!pStudioHeader)", "std::string(pszOperationName)", "strInvalidStudioHeaderErrorMessage.c_str()", "return pStudioHeader;"]);

	for (const strRole of ["HitboxSet", "Sequence"]) {
		const strDefinition = GetDefinition(strSource, "RequireStudio" + strRole + "FromThis");
		g_Assert(strDefinition.includes("if (!pszOperationName || !*pszOperationName)"));
		CheckOrder(strDefinition, ["GetStudio" + strRole + "FromValue(", "if (StudioFailure.HasCaught()", "if (!pStudio" + strRole + ")", "std::string(pszOperationName)", "strInvalidStudio" + strRole + "ErrorMessage.c_str()", "return pStudio" + strRole + ";"]);
	}

	for (const Record of g_vecIndexedRecords) {
		const strDefinition = GetDefinition(strSource, Record.Name);
		const strIndex = "n" + Record.Argument + "Index";
		g_Assert(strDefinition.includes("k" + Record.Argument + "IndexArgumentIndex = 0;"));
		g_Assert(strDefinition.includes("kDefault" + Record.Argument + "Index = 0;"));
		g_Assert(strDefinition.includes(Record.Source + "->" + Record.SDK + "(" + strIndex + ") : nullptr;"));
		CheckOrder(strDefinition, [Record.Require + "(", "if (!" + Record.Source + " || StudioFailure.HasCaught()", "!GetStudioIndexArgument(CallbackInformation, k" + Record.Argument + "IndexArgumentIndex, false, kDefault" + Record.Argument + "Index,", "(" + strIndex + " < " + Record.Source + "->" + Record.Count + ")", "if (!" + Record.Record + ")", "CallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));", Record.Factory + "(", "if (" + Record.Object + ".IsEmpty() || StudioFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(" + Record.Object + ");"]);
	}

	const strHitboxSetMethods = GetDefinition(strSource, "InstallStudioHitboxSetMethods");
	g_Assert.doesNotMatch(strHitboxSetMethods, /SetFunction\(/);
	CheckOrder(strHitboxSetMethods, ["v8::Undefined(pIsolate)", "if (LocalHitboxSetMethodData.IsEmpty()", "!InstallStudioFunction(", "return true;"]);

	for (const Method of g_vecHitboxSetMethods) {
		g_Assert(strHitboxSetMethods.includes("kHitboxSet" + Method.Role + 'FunctionName = "' + Method.Role + '";'));
		g_Assert(strHitboxSetMethods.includes("!InstallStudioFunction(pIsolate, LocalContext, LocalHitboxSetObject, kHitboxSet" + Method.Role + "FunctionName, " + Method.Callback + ", LocalHitboxSetMethodData) || StudioFailure.HasCaught()"));
	}

	CheckOrder(GetDefinition(strSource, "MakeStudioHitboxSetObject"), ["InstallStudioAddress(", "InstallStudioIntegerProperty(", "!InstallStudioHitboxSetMethods(pIsolate, LocalContext, LocalHitboxSetObject) || StudioFailure.HasCaught()", "return LocalHitboxSetObject;"]);

	const strHitboxes = GetDefinition(strSource, "GetStudioHitboxSetHitboxesCallback");
	g_Assert(strHitboxes.includes("if (nHitboxCount < 0) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, StudioFailure, kNegativeHitboxSetHitboxCountErrorMessage);"));
	g_Assert(strHitboxes.includes("unHitboxCount > (std::numeric_limits<std::size_t>::max() / sizeof(mstudiobbox_t))"));
	g_Assert(strHitboxes.includes("((unHitboxStorageAddress % alignof(mstudiobbox_t)) != 0) || !IsMemoryAddressRangeRepresentable(unHitboxStorageAddress, unHitboxStorageByteCount)"));
	g_Assert(strHitboxes.includes("LocalHitboxArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(nHitboxIndex), LocalHitboxObject).FromMaybe(false)"));
	g_Assert.doesNotMatch(strHitboxes, /->Set\(/);
	CheckOrder(strHitboxes, ["RequireStudioHitboxSetFromThis(", "if (!pStudioHitboxSet || StudioFailure.HasCaught()", "if (nHitboxCount < 0)", "if (unHitboxCount >", "if (unHitboxCount > 0)", "pStudioHitboxSet->pHitbox(0)", "unHitboxCount * sizeof(mstudiobbox_t)", "IsMemoryAddressRangeRepresentable(", "v8::Array::New(", "if (LocalHitboxArray.IsEmpty()", "for (int nHitboxIndex", "MakeStudioHitboxObject(", "if (LocalHitboxObject.IsEmpty() || StudioFailure.HasCaught()", "->CreateDataProperty(", "if (!bHitboxInstalled || StudioFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalHitboxArray);"]);

	const strHeaderHitbox = GetDefinition(strSource, "GetStudioHeaderHitboxCallback");
	g_Assert(strHeaderHitbox.includes("kHitboxIndexArgumentIndex = 0;"));
	g_Assert(strHeaderHitbox.includes("kHitboxSetIndexArgumentIndex = 1;"));
	g_Assert(strHeaderHitbox.includes("kDefaultHitboxSetIndex = 0;"));
	g_Assert(strHeaderHitbox.includes("((unStorageAddress % alignof(mstudiohitboxset_t)) != 0) || !IsMemoryAddressRangeRepresentable(unStorageAddress, sizeof(mstudiohitboxset_t))"));
	g_Assert(strHeaderHitbox.includes("(nHitboxIndex < pStudioHeader->iHitboxCount(nHitboxSetIndex)) ? pStudioHeader->pHitbox(nHitboxIndex, nHitboxSetIndex) : nullptr;"));
	g_Assert.equal(strHeaderHitbox.split("CallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));").length - 1, 3);
	CheckOrder(strHeaderHitbox, ["RequireStudioHeaderFromThis(", "if (!pStudioHeader || StudioFailure.HasCaught()", "!GetStudioIndexArgument(CallbackInformation, kHitboxIndexArgumentIndex, false, kDefaultHitboxIndex,", "!GetStudioIndexArgument(CallbackInformation, kHitboxSetIndexArgumentIndex, true, kDefaultHitboxSetIndex,", "if (nHitboxSetIndex >= pStudioHeader->numhitboxsets)", "pStudioHeader->pHitboxSet(nHitboxSetIndex)", "if (!pStudioHitboxSet)", "IsMemoryAddressRangeRepresentable(", "pStudioHeader->iHitboxCount(nHitboxSetIndex)", "if (!pStudioHitbox)", "MakeStudioHitboxObject(", "if (LocalHitboxObject.IsEmpty() || StudioFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalHitboxObject);"]);

	const strHeaderMethods = GetDefinition(strSource, "InstallStudioHeaderMethods");
	g_Assert.doesNotMatch(strHeaderMethods, /SetFunction\(/);
	CheckOrder(strHeaderMethods, ["v8::Undefined(pIsolate)", "if (LocalMethodData.IsEmpty()", "!InstallStudioFunction(", "return true;"]);

	for (const Method of g_vecHeaderMethods) {
		g_Assert(strHeaderMethods.includes("k" + Method.Role + 'FunctionName = "' + Method.Role + '";'));
		g_Assert(strHeaderMethods.includes("!InstallStudioFunction(pIsolate, LocalContext, LocalHeaderObject, k" + Method.Role + "FunctionName, " + Method.Callback + ", LocalMethodData) || StudioFailure.HasCaught()"));
	}

	const strCollection = GetDefinition(strSource, "GetStudioHeaderCollectionCallback");
	g_Assert(strCollection.includes("unStudioCollectionElementByteCount == 0"));
	g_Assert(strCollection.includes("unStudioCollectionElementAlignment == 0"));
	g_Assert(strCollection.includes("unStudioCollectionElementCount > (std::numeric_limits<std::size_t>::max() / unStudioCollectionElementByteCount)"));
	g_Assert(strCollection.includes("((unStudioCollectionStorageAddress % unStudioCollectionElementAlignment) != 0) || !IsMemoryAddressRangeRepresentable(unStudioCollectionStorageAddress, unStudioCollectionStorageByteCount)"));
	g_Assert(strCollection.includes("LocalStudioCollectionArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(nStudioCollectionElementIndex), LocalStudioCollectionElementValue).FromMaybe(false)"));
	g_Assert.doesNotMatch(strCollection, /->Set\(/);
	CheckOrder(strCollection, ["!GetStudioCollectionOperationFromCallback(", "kStudioCollectionOperationNames[unStudioCollectionOperationIndex]", "RequireStudioHeaderFromThis(", "if (nStudioCollectionElementCount < 0)", "unStudioCollectionElementCount > (std::numeric_limits", "if (unStudioCollectionElementCount > 0)", "unStudioCollectionElementCount * unStudioCollectionElementByteCount", "IsMemoryAddressRangeRepresentable(", "v8::Array::New(", "if (LocalStudioCollectionArray.IsEmpty()", "for (int nStudioCollectionElementIndex", "if (LocalStudioCollectionElementValue.IsEmpty() || StudioFailure.HasCaught()", "->CreateDataProperty(", "if (!bStudioCollectionElementInstalled || StudioFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalStudioCollectionArray);"]);

	for (const Collection of g_vecHeaderCollections) {
		const strMetadata = Collection.Metadata;
		g_Assert(strHeaderMethods.includes("k" + Collection.Role + 'FunctionName = "' + Collection.Role + '";'));
		CheckOrder(strHeaderMethods, ["v8::Integer::New(pIsolate, static_cast<int>(StudioCollectionOperation::" + Collection.Role + "))", "if (" + strMetadata + ".IsEmpty()", "!InstallStudioFunction(pIsolate, LocalContext, LocalHeaderObject, k" + Collection.Role + "FunctionName, GetStudioHeaderCollectionCallback, " + strMetadata + ") || StudioFailure.HasCaught()"]);
		g_Assert(strCollection.includes("case StudioCollectionOperation::" + Collection.Role + ":\n\t\t\t\t\tnStudioCollectionElementCount = pStudioHeader->" + Collection.Count + ";\n\t\t\t\t\tunStudioCollectionElementByteCount = sizeof(" + Collection.Type + ");\n\t\t\t\t\tunStudioCollectionElementAlignment = alignof(" + Collection.Type + ");"));
		CheckOrder(strCollection, ["if (unStudioCollectionElementCount > 0)", "pStudioHeader->" + Collection.SDK + "(0)", "v8::Array::New(", Collection.Factory + "(pIsolate, LocalContext, pStudioHeader->" + Collection.SDK + "(nStudioCollectionElementIndex))"]);
	}

	const strAnimation = GetDefinition(strSource, "GetStudioSequenceAnimationIndexCallback");
	g_Assert(strAnimation.includes("kAnimationXIndexArgumentIndex = 0;"));
	g_Assert(strAnimation.includes("kAnimationYIndexArgumentIndex = 1;"));
	g_Assert(strAnimation.includes("kDefaultAnimationGridIndex = 0;"));
	g_Assert(strAnimation.includes("if ((nAnimationXCount <= 0) || (nAnimationYCount <= 0))"));
	g_Assert(strAnimation.includes("if ((nAnimationXIndex >= nAnimationXCount) || (nAnimationYIndex >= nAnimationYCount))"));
	g_Assert(strAnimation.includes("nAnimationYIndex > ((std::numeric_limits<int>::max() - nAnimationXIndex) / nAnimationXCount)"));
	g_Assert(strAnimation.includes("unAnimationElementCount > (std::numeric_limits<std::size_t>::max() / sizeof(short))"));
	g_Assert(strAnimation.includes("((unAnimationStorageAddress % alignof(short)) != 0) || !IsMemoryAddressRangeRepresentable(unAnimationStorageAddress, unAnimationStorageByteCount)"));
	CheckOrder(strAnimation, ["RequireStudioSequenceFromThis(", "!GetStudioIndexArgument(CallbackInformation, kAnimationXIndexArgumentIndex, true, kDefaultAnimationGridIndex,", "!GetStudioIndexArgument(CallbackInformation, kAnimationYIndexArgumentIndex, true, kDefaultAnimationGridIndex,", "if ((nAnimationXCount <= 0)", "if ((nAnimationXIndex >=", "if (nAnimationYIndex >", "const int nAnimationOffset = nAnimationYIndex * nAnimationXCount + nAnimationXIndex;", "unAnimationElementCount > (std::numeric_limits", "!ApplyMemoryAddressOffset(pIsolate, reinterpret_cast<std::uintptr_t>(pStudioSequence), static_cast<std::int64_t>(pStudioSequence->animindexindex), false, kInvalidStudioAnimationStorageErrorMessage, unAnimationStorageAddress)", "unAnimationElementCount * sizeof(short)", "IsMemoryAddressRangeRepresentable(", "CallbackInformation.GetReturnValue().Set(pStudioSequence->anim(nAnimationXIndex, nAnimationYIndex));"]);

	CheckHeaderSequenceContracts(strSource);
	CheckCacheContracts(strSource);
	CheckConstantContracts(strSource);

	const strWeight = GetDefinition(strSource, "GetStudioSequenceWeightCallback");
	g_Assert(strWeight.includes("kBoneIndexArgumentIndex = 0;"));
	g_Assert(strWeight.includes("kDefaultBoneIndex = 0;"));
	g_Assert(strWeight.includes("!unStudioHeaderAddress || ((unStudioHeaderAddress % alignof(studiohdr_t)) != 0)"));
	g_Assert(strWeight.includes("!unStudioWeightAddress || ((unStudioWeightAddress % alignof(float)) != 0)"));
	g_Assert.doesNotMatch(strWeight, /= \*pflStudioWeight/);
	CheckOrder(strWeight, ["RequireStudioSequenceFromThis(", "!GetStudioIndexArgument(CallbackInformation, kBoneIndexArgumentIndex, true, kDefaultBoneIndex,", "pStudioSequence->pStudiohdr()", "!IsMemoryAddressRangeRepresentable(unStudioHeaderAddress, sizeof(studiohdr_t))", "if (nBoneIndex >= pStudioHeader->numbones)", "pStudioSequence->pBoneweight(nBoneIndex)", "!IsMemoryAddressRangeRepresentable(unStudioWeightAddress, sizeof(float))", "!ReadMemoryScalarFromAddress(unStudioWeightAddress, flStudioWeight)", "CallbackInformation.GetReturnValue().Set(flStudioWeight);"]);
}

function RejectMutation(strName, strOld, strNew, unTargetOccurrence = 0) {
	const strActualDefinition = GetRawDefinition(g_strSource, strName);
	const strDefinition = GetDefinition(g_strSource, strName);
	g_Assert(strDefinition.includes(strOld), "Missing mutation anchor: " + strName + ": " + strOld);

	let unOccurrence = 0;
	const strChanged = strDefinition.replaceAll(strOld, () => (unOccurrence++ === unTargetOccurrence) ? strNew : strOld);
	g_Assert.notEqual(strChanged, strDefinition);
	const strActualChanged = strActualDefinition.startsWith("\t\t") ? strChanged.replace(/^\t/gm, "\t\t") : strChanged;
	const strChangedSource = g_strSource.replace(strActualDefinition, () => strActualChanged);
	g_Assert.notEqual(strChangedSource, g_strSource, "Mutate the actual source definition.");
	g_Assert.throws(() => CheckContracts(strChangedSource), g_Assert.AssertionError, strName + ": " + strOld);
	++g_unRejectedMutationCount;
}

CheckDefinitionExtraction();
CheckContracts(g_strSource);

for (const Boundary of g_vecBoundaries) {
	const strIsolate = Boundary.Isolate ?? "pIsolate";
	for (const strPart of ["v8::TryCatch StudioFailure(" + strIsolate + ");", "catch (std::exception const&)", "catch (...)"]) {
		RejectMutation(Boundary.Name, strPart, "");
	}

	for (const strGuard of ["StudioFailure.HasCaught()", strIsolate + "->IsExecutionTerminating()", strIsolate + "->HasPendingException()"]) {
		for (let unOccurrence = 0; unOccurrence < Boundary.Guards; ++unOccurrence) {
			RejectMutation(Boundary.Name, strGuard, "false", unOccurrence);
		}
	}

	const strDefinition = GetDefinition(g_strSource, Boundary.Name);
	for (const vecMatch of GetFailureBranches(strDefinition)) {
		const unOccurrence = strDefinition.slice(0, vecMatch.index).split(vecMatch[1]).length - 1;
		RejectMutation(Boundary.Name, vecMatch[1], "", unOccurrence);
	}
}

for (const Scalar of g_vecScalarProperties) {
	for (const strName of ["GetStudio" + Scalar.Role + "PropertyAddress", "InstallStudio" + Scalar.Role + "Property"]) {
		RejectMutation(strName, "if (!" + Scalar.Address + ")", "if (false)");
		RejectMutation(strName, "(un" + Scalar.Role + "PropertyAddress % alignof(" + Scalar.Type + ")) != 0", "false");
		RejectMutation(strName, "!IsMemoryAddressRangeRepresentable(un" + Scalar.Role + "PropertyAddress, sizeof(" + Scalar.Type + "))", "false");
	}

	RejectMutation("GetStudio" + Scalar.Role + "PropertyCallback", "!ReadMemoryScalarFromAddress(", "ReadMemoryScalarFromAddress(");
	RejectMutation("SetStudio" + Scalar.Role + "PropertyCallback", "WriteMemoryScalarToAddress(", "SkippedWrite(");
	RejectMutation("InstallStudio" + Scalar.Role + "Property", "if (!bPropertyInstalled ||", "if (");
}

for (const Method of g_vecModelMethods) {
	const strCall = "DefineFunction(kModel" + Method.Role + "FunctionName, " + Method.Callback + ")";
	RejectMutation("MakeStudioModelObject", "!" + strCall, strCall);
	RejectMutation("MakeStudioModelObject", strCall, strCall.replace(Method.Callback, "nullptr"));
	RejectMutation("MakeStudioModelObject", "kModel" + Method.Role + 'FunctionName = "' + Method.Role + '";', "kModel" + Method.Role + 'FunctionName = "Changed";');
}

for (const View of g_vecMathViews) {
	RejectMutation(View.Name, "(unStorageAddress % alignof(" + View.Type + ")) != 0", "false");
	RejectMutation(View.Name, "!IsMemoryAddressRangeRepresentable(unStorageAddress, sizeof(" + View.Type + "))", "false");

	for (const vecComponent of View.Components) {
		RejectMutation(View.Name, 'PropertyName = "' + vecComponent[0] + '";', 'PropertyName = "Changed";');
		RejectMutation(View.Name, ", &" + View.Address + "->" + vecComponent[1] + ")", ", nullptr)");
	}
}

for (const Resolver of g_vecAddressResolvers) {
	RejectMutation(Resolver.Name, "if (!bAddressResolved)", "if (false)");
	RejectMutation(Resolver.Name, "if (!" + Resolver.Address + ")", "if (false)");
	RejectMutation(Resolver.Name, "(" + Resolver.Address + " % alignof(" + Resolver.Type + ")) != 0", "false");
	RejectMutation(Resolver.Name, "!IsMemoryAddressRangeRepresentable(" + Resolver.Address + ", sizeof(" + Resolver.Type + "))", "false");
}

for (const View of g_vecBoneViews) {
	RejectMutation("MakeStudioBoneObject", "if (" + View.Local + ".IsEmpty() ||", "if (");
	RejectMutation("MakeStudioBoneObject", "!InstallStudioValue(pIsolate, LocalContext, LocalModelBoneObject, kBone" + View.Role + "PropertyName, " + View.Local + ")", "true");
}

for (const Record of g_vecRecords) {
	RejectMutation(Record.Name, "if (!" + Record.Address + ")", "if (false)");
	RejectMutation(Record.Name, "(unStorageAddress % alignof(" + Record.Type + ")) != 0", "false");
	RejectMutation(Record.Name, "!IsMemoryAddressRangeRepresentable(unStorageAddress, sizeof(" + Record.Type + "))", "false");

	for (const vecField of Record.Fields) {
		RejectMutation(Record.Name, "k" + Record.Role + vecField[1] + 'PropertyName = "' + vecField[2] + '";', "k" + Record.Role + vecField[1] + 'PropertyName = "Changed";');
		RejectMutation(Record.Name, ", " + vecField[3] + ")", ", nullptr)");
	}

	for (const vecView of Record.Views) {
		RejectMutation(Record.Name, "if (" + vecView[2] + ".IsEmpty() ||", "if (");
		RejectMutation(Record.Name, "!InstallStudioValue(pIsolate, LocalContext, " + Record.Object + ", k" + Record.Role + vecView[0] + "PropertyName, " + vecView[2] + ")", "true");
	}
}

for (const strName of ["GetStudioUnsignedIntegerPropertyAddress", "InstallStudioUnsignedIntegerProperty"]) {
	RejectMutation(strName, "if (!punUnsignedIntegerPropertyValue)", "if (false)");
	RejectMutation(strName, "(unUnsignedIntegerPropertyAddress % alignof(unsigned int)) != 0", "false");
	RejectMutation(strName, "!IsMemoryAddressRangeRepresentable(unUnsignedIntegerPropertyAddress, sizeof(unsigned int))", "false");
}

for (const Record of g_vecIndexedRecords) {
	const strIndex = "n" + Record.Argument + "Index";
	RejectMutation(Record.Name, "k" + Record.Argument + "IndexArgumentIndex = 0;", "k" + Record.Argument + "IndexArgumentIndex = 1;");
	RejectMutation(Record.Name, "Index, false, kDefault" + Record.Argument + "Index,", "Index, true, kDefault" + Record.Argument + "Index,");
	RejectMutation(Record.Name, "(" + strIndex + " < " + Record.Source + "->" + Record.Count + ")", "true");
	RejectMutation(Record.Name, Record.Source + "->" + Record.SDK + "(" + strIndex + ")", Record.Source + "->" + Record.SDK + "(0)");
	RejectMutation(Record.Name, "CallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));", "");
	RejectMutation(Record.Name, "CallbackInformation.GetReturnValue().Set(" + Record.Object + ");", "");
}

for (const Method of g_vecHitboxSetMethods) {
	const strCall = "InstallStudioFunction(pIsolate, LocalContext, LocalHitboxSetObject, kHitboxSet" + Method.Role + "FunctionName, " + Method.Callback + ", LocalHitboxSetMethodData)";
	RejectMutation("InstallStudioHitboxSetMethods", "kHitboxSet" + Method.Role + 'FunctionName = "' + Method.Role + '";', "kHitboxSet" + Method.Role + 'FunctionName = "Changed";');
	RejectMutation("InstallStudioHitboxSetMethods", strCall, strCall.replace(Method.Callback, "nullptr"));
	RejectMutation("InstallStudioHitboxSetMethods", strCall, strCall.replace("LocalHitboxSetMethodData", "v8::Undefined(pIsolate)"));
}

for (const Method of g_vecHeaderMethods) {
	const strCall = "InstallStudioFunction(pIsolate, LocalContext, LocalHeaderObject, k" + Method.Role + "FunctionName, " + Method.Callback + ", LocalMethodData)";
	RejectMutation("InstallStudioHeaderMethods", "k" + Method.Role + 'FunctionName = "' + Method.Role + '";', "k" + Method.Role + 'FunctionName = "Changed";');
	RejectMutation("InstallStudioHeaderMethods", strCall, strCall.replace(Method.Callback, "nullptr"));
	RejectMutation("InstallStudioHeaderMethods", strCall, strCall.replace("LocalMethodData", "v8::Undefined(pIsolate)"));
}

for (const Collection of g_vecHeaderCollections) {
	RejectMutation("GetStudioHeaderCollectionCallback", "nStudioCollectionElementCount = pStudioHeader->" + Collection.Count + ";", "nStudioCollectionElementCount = 0;");
	RejectMutation("GetStudioHeaderCollectionCallback", "unStudioCollectionElementByteCount = sizeof(" + Collection.Type + ");", "unStudioCollectionElementByteCount = 1;");
	RejectMutation("GetStudioHeaderCollectionCallback", "unStudioCollectionElementAlignment = alignof(" + Collection.Type + ");", "unStudioCollectionElementAlignment = 1;");
	RejectMutation("GetStudioHeaderCollectionCallback", "pStudioHeader->" + Collection.SDK + "(0)", "pStudioHeader->" + Collection.SDK + "(1)");
	RejectMutation("InstallStudioHeaderMethods", "k" + Collection.Role + 'FunctionName = "' + Collection.Role + '";', "k" + Collection.Role + 'FunctionName = "Changed";');
	RejectMutation("InstallStudioHeaderMethods", "StudioCollectionOperation::" + Collection.Role + ")", "StudioCollectionOperation::Changed)");
}

for (const Mutation of [
	{ Name: "GetStudioHeaderCollectionCallback", Old: "nStudioCollectionElementCount < 0", New: "false" },
	{ Name: "GetStudioHeaderCollectionCallback", Old: "unStudioCollectionElementByteCount == 0", New: "false" },
	{ Name: "GetStudioHeaderCollectionCallback", Old: "unStudioCollectionElementAlignment == 0", New: "false" },
	{ Name: "GetStudioHeaderCollectionCallback", Old: "unStudioCollectionElementCount > (std::numeric_limits<std::size_t>::max() / unStudioCollectionElementByteCount)", New: "false" },
	{ Name: "GetStudioHeaderCollectionCallback", Old: "if (unStudioCollectionElementCount > 0)", New: "if (true)" },
	{ Name: "GetStudioHeaderCollectionCallback", Old: "(unStudioCollectionStorageAddress % unStudioCollectionElementAlignment) != 0", New: "false" },
	{ Name: "GetStudioHeaderCollectionCallback", Old: "!IsMemoryAddressRangeRepresentable(unStudioCollectionStorageAddress, unStudioCollectionStorageByteCount)", New: "false" },
	{ Name: "GetStudioHeaderCollectionCallback", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "GetStudioHeaderCollectionCallback", Old: "if (!bStudioCollectionElementInstalled ||", New: "if (" },
	{ Name: "GetStudioHeaderCollectionCallback", Old: "CallbackInformation.GetReturnValue().Set(LocalStudioCollectionArray);", New: "" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "kAnimationYIndexArgumentIndex = 1;", New: "kAnimationYIndexArgumentIndex = 0;" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "kDefaultAnimationGridIndex = 0;", New: "kDefaultAnimationGridIndex = 1;" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "nAnimationXCount <= 0", New: "false" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "nAnimationYCount <= 0", New: "false" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "nAnimationXIndex >= nAnimationXCount", New: "false" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "nAnimationYIndex >= nAnimationYCount", New: "false" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "nAnimationYIndex > ((std::numeric_limits<int>::max() - nAnimationXIndex) / nAnimationXCount)", New: "false" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "unAnimationElementCount > (std::numeric_limits<std::size_t>::max() / sizeof(short))", New: "false" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "!ApplyMemoryAddressOffset(", New: "ApplyMemoryAddressOffset(" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "(unAnimationStorageAddress % alignof(short)) != 0", New: "false" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "!IsMemoryAddressRangeRepresentable(unAnimationStorageAddress, unAnimationStorageByteCount)", New: "false" },
	{ Name: "GetStudioSequenceAnimationIndexCallback", Old: "CallbackInformation.GetReturnValue().Set(pStudioSequence->anim(nAnimationXIndex, nAnimationYIndex));", New: "" },
	{ Name: "GetStudioSequenceWeightCallback", Old: "kDefaultBoneIndex = 0;", New: "kDefaultBoneIndex = 1;" },
	{ Name: "GetStudioSequenceWeightCallback", Old: "(unStudioHeaderAddress % alignof(studiohdr_t)) != 0", New: "false" },
	{ Name: "GetStudioSequenceWeightCallback", Old: "!IsMemoryAddressRangeRepresentable(unStudioHeaderAddress, sizeof(studiohdr_t))", New: "false" },
	{ Name: "GetStudioSequenceWeightCallback", Old: "nBoneIndex >= pStudioHeader->numbones", New: "false" },
	{ Name: "GetStudioSequenceWeightCallback", Old: "(unStudioWeightAddress % alignof(float)) != 0", New: "false" },
	{ Name: "GetStudioSequenceWeightCallback", Old: "!IsMemoryAddressRangeRepresentable(unStudioWeightAddress, sizeof(float))", New: "false" },
	{ Name: "GetStudioSequenceWeightCallback", Old: "!ReadMemoryScalarFromAddress(", New: "ReadMemoryScalarFromAddress(" },
	{ Name: "GetStudioSequenceWeightCallback", Old: "CallbackInformation.GetReturnValue().Set(flStudioWeight);", New: "" },
	{ Name: "MakeStudioHitboxSetObject", Old: "!InstallStudioHitboxSetMethods(", New: "InstallStudioHitboxSetMethods(" },
	{ Name: "GetStudioHitboxSetHitboxesCallback", Old: "nHitboxCount < 0", New: "false" },
	{ Name: "GetStudioHitboxSetHitboxesCallback", Old: "unHitboxCount > (std::numeric_limits<std::size_t>::max() / sizeof(mstudiobbox_t))", New: "false" },
	{ Name: "GetStudioHitboxSetHitboxesCallback", Old: "if (unHitboxCount > 0)", New: "if (true)" },
	{ Name: "GetStudioHitboxSetHitboxesCallback", Old: "(unHitboxStorageAddress % alignof(mstudiobbox_t)) != 0", New: "false" },
	{ Name: "GetStudioHitboxSetHitboxesCallback", Old: "!IsMemoryAddressRangeRepresentable(unHitboxStorageAddress, unHitboxStorageByteCount)", New: "false" },
	{ Name: "GetStudioHitboxSetHitboxesCallback", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "GetStudioHitboxSetHitboxesCallback", Old: "if (!bHitboxInstalled ||", New: "if (" },
	{ Name: "GetStudioHitboxSetHitboxesCallback", Old: "CallbackInformation.GetReturnValue().Set(LocalHitboxArray);", New: "" },
	{ Name: "GetStudioHeaderHitboxCallback", Old: "kHitboxIndexArgumentIndex = 0;", New: "kHitboxIndexArgumentIndex = 1;" },
	{ Name: "GetStudioHeaderHitboxCallback", Old: "kHitboxSetIndexArgumentIndex = 1;", New: "kHitboxSetIndexArgumentIndex = 0;" },
	{ Name: "GetStudioHeaderHitboxCallback", Old: "kDefaultHitboxSetIndex = 0;", New: "kDefaultHitboxSetIndex = 1;" },
	{ Name: "GetStudioHeaderHitboxCallback", Old: "kHitboxIndexArgumentIndex, false, kDefaultHitboxIndex,", New: "kHitboxIndexArgumentIndex, true, kDefaultHitboxIndex," },
	{ Name: "GetStudioHeaderHitboxCallback", Old: "kHitboxSetIndexArgumentIndex, true, kDefaultHitboxSetIndex,", New: "kHitboxSetIndexArgumentIndex, false, kDefaultHitboxSetIndex," },
	{ Name: "GetStudioHeaderHitboxCallback", Old: "nHitboxSetIndex >= pStudioHeader->numhitboxsets", New: "false" },
	{ Name: "GetStudioHeaderHitboxCallback", Old: "(unStorageAddress % alignof(mstudiohitboxset_t)) != 0", New: "false" },
	{ Name: "GetStudioHeaderHitboxCallback", Old: "!IsMemoryAddressRangeRepresentable(unStorageAddress, sizeof(mstudiohitboxset_t))", New: "false" },
	{ Name: "GetStudioHeaderHitboxCallback", Old: "(nHitboxIndex < pStudioHeader->iHitboxCount(nHitboxSetIndex))", New: "true" },
	{ Name: "GetStudioHeaderHitboxCallback", Old: "CallbackInformation.GetReturnValue().Set(LocalHitboxObject);", New: "" },
	{ Name: "GetStudioModelHandleFromValue", Old: "v8::Isolate::GetCurrent()", New: "LocalContext->GetIsolate()" },
	{ Name: "GetStudioModelHandleFromValue", Old: "!LocalModelHandleValue->IsUint32()", New: "false" },
	{ Name: "GetStudioModelHandleFromValue", Old: "MaybeModelHandle.IsNothing() ||", New: "" },
	{ Name: "GetStudioModelHandleFromValue", Old: "unModelHandle > static_cast<std::uint32_t>(std::numeric_limits<MDLHandle_t>::max())", New: "false" },
	{ Name: "GetStudioModelHandleFromValue", Old: "hModelHandleOut = static_cast<MDLHandle_t>(unModelHandle);", New: "hModelHandleOut = MDLHANDLE_INVALID;" },
	{ Name: "GetStudioModelHandleFromCallback", Old: 'kModelHandlePropertyName = "Handle";', New: 'kModelHandlePropertyName = "m_unHandle";' },
	{ Name: "GetStudioModelHandleFromCallback", Old: "LocalModelHandleValue, hModelHandle)", New: "LocalModelHandleValue, hModelHandleOut)" },
	{ Name: "GetStudioModelHandleFromCallback", Old: "hModelHandleOut = hModelHandle;", New: "" },
	{ Name: "RequireStudioModelHandle", Old: "hModelHandle == MDLHANDLE_INVALID", New: "false" },
	{ Name: "IsStudioModelValidCallback", Old: "hModelHandle != MDLHANDLE_INVALID", New: "true" },
	{ Name: "GetStudioModelNameCallback", Old: "CallbackInformation.GetReturnValue().Set(LocalModelName);", New: "" },
	{ Name: "GetStudioModelReferenceCountCallback", Old: "CallbackInformation.GetReturnValue().Set(nReferenceCount);", New: "" },
	{ Name: "MakeStudioModelObject", Old: 'kModelHandlePropertyName = "Handle";', New: 'kModelHandlePropertyName = "m_unHandle";' },
	{ Name: "MakeStudioModelObject", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "MakeStudioModelObject", Old: "if (!bValueDefined ||", New: "if (" },
	{ Name: "MakeStudioModelObject", Old: "!v8::Function::New(", New: "v8::Function::New(" },
	{ Name: "MakeStudioModelObject", Old: "v8::Function::New(LocalContext, Callback, LocalModelMethodData)", New: "v8::Function::New(LocalContext, Callback)" },
	{ Name: "MakeStudioModelObject", Old: "return DefineValue(pszName, LocalFunction);", New: "return true;" },
	{ Name: "MakeStudioModelObject", Old: "!DefineValue(kModelHandlePropertyName,", New: "DefineValue(kModelHandlePropertyName," },
	{ Name: "MakeStudioAddressValue", Old: "v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unStudioAddress))", New: "v8::Number::New(pIsolate, 0)" },
	{ Name: "InstallStudioAddress", Old: 'kStudioAddressPropertyName = "Address";', New: 'kStudioAddressPropertyName = "m_pAddress";' },
	{ Name: "InstallStudioAddress", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "SetStudioFloatPropertyCallback", Old: "!LocalFloatPropertyValue->IsNumber()", New: "false" },
	{ Name: "SetStudioFloatPropertyCallback", Old: "!std::isfinite(dblFloatPropertyValue)", New: "false" },
	{ Name: "SetStudioFloatPropertyCallback", Old: "dblFloatPropertyValue < kMinimumFloatPropertyValue", New: "false" },
	{ Name: "SetStudioFloatPropertyCallback", Old: "dblFloatPropertyValue > kMaximumFloatPropertyValue", New: "false" },
	{ Name: "SetStudioIntegerPropertyCallback", Old: "!LocalIntegerPropertyValue->IsInt32()", New: "false" },
	{ Name: "GetStudioCStringPropertyAddress", Old: "!LocalStringPropertyMetadataValue->IsExternal()", New: "false" },
	{ Name: "GetStudioCStringPropertyCallback", Old: "if (!pszStringPropertyValue)", New: "if (false)" },
	{ Name: "GetStudioCStringPropertyCallback", Old: "PropertyInformation.GetReturnValue().Set(v8::Null(pIsolate));", New: "PropertyInformation.GetReturnValue().Set(false);" },
	{ Name: "InstallStudioCStringProperty", Old: "if (!bPropertyInstalled ||", New: "if (" },
	{ Name: "InstallStudioCStringProperty", Old: "GetStudioCStringPropertyCallback, nullptr, LocalStringPropertyMetadata", New: "GetStudioCStringPropertyCallback, SetStudioIntegerPropertyCallback, LocalStringPropertyMetadata" },
	{ Name: "MakeStudioIntegerArray", Old: "!pnIntegerValues || (nElementCount < 0)", New: "false" },
	{ Name: "MakeStudioIntegerArray", Old: "unElementCount > (std::numeric_limits<std::size_t>::max() / sizeof(int))", New: "false" },
	{ Name: "MakeStudioIntegerArray", Old: "if (unElementCount != 0)", New: "if (true)" },
	{ Name: "MakeStudioIntegerArray", Old: "(unIntegerArrayAddress % alignof(int)) != 0", New: "false" },
	{ Name: "MakeStudioIntegerArray", Old: "!IsMemoryAddressRangeRepresentable(unIntegerArrayAddress, unIntegerArrayByteCount)", New: "false" },
	{ Name: "MakeStudioMatrix3x4Array", Old: "(unStorageAddress % alignof(matrix3x4_t)) != 0", New: "false" },
	{ Name: "MakeStudioMatrix3x4Array", Old: "!IsMemoryAddressRangeRepresentable(unStorageAddress, sizeof(matrix3x4_t))", New: "false" },
	{ Name: "MakeStudioMatrix3x4Array", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "GetStudioAddressFromValue", Old: "!LocalAddressValue->IsBigInt()", New: "false" },
	{ Name: "GetStudioAddressFromValue", Old: "!bLossless ||", New: "" },
	{ Name: "GetStudioAddressFromValue", Old: "unAddressValue > std::numeric_limits<std::uintptr_t>::max()", New: "false" },
	{ Name: "GetStudioAddressFromValue", Old: "unAddressOut = static_cast<std::uintptr_t>(unAddressValue);", New: "" },
	{ Name: "GetStudioAddressFromObject", Old: 'kAddressPropertyName = "Address";', New: 'kAddressPropertyName = "m_pAddress";' },
	{ Name: "GetStudioAddressFromObject", Old: "GetStudioAddressFromValue(LocalAddressValue, unAddress)", New: "GetStudioAddressFromValue(LocalAddressValue, unAddressOut)" },
	{ Name: "GetStudioAddressFromObject", Old: "unAddressOut = unAddress;", New: "" },
	{ Name: "GetStudioBoneProcedureAddressCallback", Old: "!IsMemoryAddressRangeRepresentable(unStudioBoneAddress, sizeof(mstudiobone_t))", New: "false" },
	{ Name: "InstallStudioBoneSurfacePropertyLookup", Old: "StudioBoneValue.surfacepropLookup;", New: "StudioBoneValue.changed;" },
	{ Name: "InstallStudioValue", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "InstallStudioValue", Old: "if (!bValueInstalled ||", New: "if (" },
	{ Name: "InstallStudioFunction", Old: "v8::Function::New(LocalContext, Callback, LocalFunctionData)", New: "v8::Function::New(LocalContext, Callback)" },
	{ Name: "InstallStudioFunction", Old: "if (!bFunctionInstalled ||", New: "if (" },
	{ Name: "MakeStudioBoneObject", Old: "!IsMemoryAddressRangeRepresentable(unStorageAddress, sizeof(mstudiobone_t))", New: "false" },
	{ Name: "MakeStudioBoneObject", Old: "GetStudioBoneProcedureAddressCallback, LocalBoneMethodData", New: "nullptr, LocalBoneMethodData" },
	{ Name: "GetStudioUnsignedIntegerPropertyAddress", Old: "!LocalUnsignedIntegerPropertyMetadataValue->IsExternal()", New: "false" },
	{ Name: "GetStudioUnsignedIntegerPropertyCallback", Old: "!ReadMemoryScalarFromAddress(", New: "ReadMemoryScalarFromAddress(" },
	{ Name: "SetStudioUnsignedIntegerPropertyCallback", Old: "!LocalUnsignedIntegerPropertyValue->IsUint32()", New: "false" },
	{ Name: "SetStudioUnsignedIntegerPropertyCallback", Old: "MaybeUnsignedIntegerPropertyValue.IsNothing() ||", New: "" },
	{ Name: "SetStudioUnsignedIntegerPropertyCallback", Old: "WriteMemoryScalarToAddress(", New: "SkippedWrite(" },
	{ Name: "InstallStudioUnsignedIntegerProperty", Old: "if (!bPropertyInstalled ||", New: "if (" },
	{ Name: "GetStudioIndexArgument", Old: "nCallbackArgumentIndex < kMinimumCallbackArgumentIndex", New: "false" },
	{ Name: "GetStudioIndexArgument", Old: "bOptional && (nDefaultStudioIndex < 0)", New: "false" },
	{ Name: "GetStudioIndexArgument", Old: "!LocalStudioIndexArgumentValue->IsInt32()", New: "false" },
	{ Name: "GetStudioIndexArgument", Old: "nParsedStudioIndex < 0", New: "false" },
	{ Name: "GetStudioIndexArgument", Old: "pszErrorMessage, nParsedStudioIndex)", New: "pszErrorMessage, nStudioIndexOut)" },
	{ Name: "GetStudioIndexArgument", Old: "nStudioIndexOut = nParsedStudioIndex;", New: "" },
	{ Name: "GetStudioCollectionOperationFromCallback", Old: "!LocalStudioCollectionOperationData->IsInt32()", New: "false" },
	{ Name: "GetStudioCollectionOperationFromCallback", Old: "nStudioCollectionOperationValue < static_cast<int>(StudioCollectionOperation::Bones)", New: "false" },
	{ Name: "GetStudioCollectionOperationFromCallback", Old: "nStudioCollectionOperationValue > static_cast<int>(StudioCollectionOperation::Attachments)", New: "false" },
	{ Name: "GetStudioCollectionOperationFromCallback", Old: "CollectionOperationOut = static_cast<StudioCollectionOperation>(nStudioCollectionOperationValue);", New: "" },
]) {
	RejectMutation(Mutation.Name, Mutation.Old, Mutation.New);
}

for (const Check of g_vecHeaderSequenceChecks) {
	for (const strFragment of Check.Fragments) {
		RejectMutation(Check.Name, strFragment, "");
	}

	for (const strFragment of Check.Order) {
		RejectMutation(Check.Name, strFragment, "");
	}
}

for (const Method of g_vecCacheMethods) {
	RejectMutation("InstallStudioCacheFunctions", "kStudioCache" + Method.Role + 'FunctionName = "' + Method.Role + '";', "kStudioCache" + Method.Role + 'FunctionName = "Changed";');
	RejectMutation("InstallStudioCacheFunctions", Method.Callback + ", LocalRuntimeData)", Method.Callback + ", v8::Undefined(pIsolate))");
	RejectMutation("InstallStudioCacheFunctions", "!InstallStudioFunction(pIsolate, LocalContext, LocalTargetObject, kStudioCache" + Method.Role + "FunctionName", "SkippedInstallation(pIsolate, LocalContext, LocalTargetObject, kStudioCache" + Method.Role + "FunctionName");
	RejectMutation(Method.Callback, "kRequiredArgumentCount = 1;", "kRequiredArgumentCount = 0;");

	if (Method.SDK === undefined) {
		for (const strFragment of ["kModelPathArgumentIndex = 0;", "!LocalModelPathValue->IsString()", "if (strModelPath.empty())", "if (strModelPath.find('\\0') != std::string::npos)", "StudioModelReferenceOwner ReferenceOwner = StudioModelReferenceOwner(pStudioModelCache, hModelHandle);", "ReferenceOwner.ReleaseOwnership();"]) {
			RejectMutation(Method.Callback, strFragment, "");
		}

		RejectMutation(Method.Callback, "StudioModelReferenceOwner ReferenceOwner = StudioModelReferenceOwner(pStudioModelCache, hModelHandle);", "StudioModelReferenceOwner ReferenceOwner(pStudioModelCache, hModelHandle);");

	} else {
		RejectMutation(Method.Callback, "kModelHandleArgumentIndex = 0;", "kModelHandleArgumentIndex = 1;");
		RejectMutation(Method.Callback, "!GetStudioModelHandleFromValue(LocalContext, LocalModelHandleValue, hModelHandle)", "false");
		RejectMutation(Method.Callback, "!RequireStudioModelHandle(pIsolate, k" + Method.Role + "OperationName, hModelHandle)", "false");
		RejectMutation(Method.Callback, "pStudioModelCache->" + Method.SDK + "(hModelHandle)", "pStudioModelCache->" + Method.SDK + "(MDLHANDLE_INVALID)");
	}
}

for (const DataType of g_vecCacheDataTypes) {
	RejectMutation("MakeStudioModelCacheDataTypeObject", "kStudioModelCacheDataType" + DataType.Role + 'PropertyName = "' + DataType.Role + '";', "kStudioModelCacheDataType" + DataType.Role + 'PropertyName = "Changed";');
	RejectMutation("MakeStudioModelCacheDataTypeObject", "static_cast<int>(" + DataType.SDK + ")", "0");
	RejectMutation("MakeStudioModelCacheDataTypeObject", "if (" + DataType.Local + ".IsEmpty() ||", "if (");
	RejectMutation("MakeStudioModelCacheDataTypeObject", "!InstallStudioValue(pIsolate, LocalContext, LocalStudioModelCacheDataTypeObject, kStudioModelCacheDataType" + DataType.Role + "PropertyName", "SkippedInstallation(pIsolate, LocalContext, LocalStudioModelCacheDataTypeObject, kStudioModelCacheDataType" + DataType.Role + "PropertyName");
}

for (const Mutation of [
	{ Name: "FindStudioModelCallback", Old: "if (LocalStudioModelObject.IsEmpty() ||", New: "if (" },
	{ Name: "GetStudioCacheModelNameCallback", Old: "if (!pszModelName)", New: "if (false)" },
	{ Name: "GetStudioModelHeaderAddressCallback", Old: "MakeStudioAddressValue(pIsolate, pStudioHeader)", New: "MakeStudioAddressValue(pIsolate, nullptr)" },
	{ Name: "GetStudioModelHeaderCallback", Old: "CallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));", New: "CallbackInformation.GetReturnValue().Set(v8::Undefined(pIsolate));" },
	{ Name: "RequireStudioModelHeaderCallback", Old: "RethrowV8InstallationFailure(pIsolate, StudioFailure, kMissingModelHeaderErrorMessage);", New: "" },
	{ Name: "InstallStudioCacheFunctions", Old: "LocalRuntimeData.IsEmpty() ||", New: "" },
	{ Name: "InstallStudioCacheFunctions", Old: "static_cast<int>(MDLHANDLE_INVALID)", New: "0" },
	{ Name: "InstallStudioCacheFunctions", Old: "!InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioCacheInvalidModelHandlePropertyName", New: "SkippedInstallation(pIsolate, LocalContext, LocalTargetObject, kStudioCacheInvalidModelHandlePropertyName" },
	{ Name: "InstallStudioCacheFunctions", Old: "!InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioCacheModelCacheDataTypePropertyName", New: "SkippedInstallation(pIsolate, LocalContext, LocalTargetObject, kStudioCacheModelCacheDataTypePropertyName" },
]) {
	RejectMutation(Mutation.Name, Mutation.Old, Mutation.New);
}

for (const strRole of ["Attachment", "Bone"]) {
	RejectMutation("InstallStudioConstants", "kStudioInvalid" + strRole + "Index = -1;", "kStudioInvalid" + strRole + "Index = 0;");
	RejectMutation("InstallStudioConstants", 'PropertyName = "INVALID_' + strRole.toUpperCase() + '_INDEX";', 'PropertyName = "Changed";');
}

for (const Group of [
	{ Role: "ModelType", Values: g_vecStudioModelTypes },
	{ Role: "Flags", Values: g_vecStudioFlags },
]) {
	for (const vecValue of Group.Values) {
		RejectMutation("InstallStudioConstants", "kStudio" + Group.Role + vecValue[0] + 'PropertyName = "' + vecValue[0] + '";', "kStudio" + Group.Role + vecValue[0] + 'PropertyName = "Changed";');
		RejectMutation("InstallStudioConstants", "(" + vecValue[1] + ")", "(0)");
		RejectMutation("InstallStudioConstants", "!InstallStudioValue(pIsolate, LocalContext, LocalStudio" + Group.Role + "Object, kStudio" + Group.Role + vecValue[0] + "PropertyName", "SkippedInstallation(pIsolate, LocalContext, LocalStudio" + Group.Role + "Object, kStudio" + Group.Role + vecValue[0] + "PropertyName");
	}
}

console.log("Studio native source contracts PASS; rejected mutations=" + g_unRejectedMutationCount + "; live V8/engine execution not exercised.");
