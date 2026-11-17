"use strict";

const { GetModule } = require("internal/runtime");
const { CallEntityInputFunction, GetEntityInput, GetEntityModelHeader, GetEntityModelName } = require("entities/index");
const { FindEntityDataMapField, GetEntityDataMap } = require("entities/datamaps");
const { GetEntityProperty, GetEntitySendProperty, SetEntityProperty } = require("entities/props");
const { GetGlobalVariables } = require("globals");
const { Matrix3x4, Vector } = require("mathlib");
const { DescribeModelAnimation, FindPoseParameter, FindSequence, NormalizePoseParameter, PrepareModelPose } = require("studio/animation");

const g_AnimationRuntime = GetModule("internal/entity-animation");

function RequireIndex(unIndex, strRole) {
	if (!Number.isInteger(unIndex) || (unIndex < 0) || (unIndex > 0x7FFFFFFF)) {
		throw new RangeError(`${strRole} must be a non-negative Int32 index.`);
	}

	return unIndex;
}

function FindIndex(vecRecords, Selector) {
	if (typeof Selector === "string") {
		return vecRecords.findIndex((Entry) => Entry.Name === Selector);
	}

	const unIndex = RequireIndex(Selector, "Selector");
	return (unIndex < vecRecords.length) ? unIndex : -1;
}

function ReadAnimationProperty(EntityReference, strPropertyName, strType = undefined) {
	if (GetEntitySendProperty(EntityReference, strPropertyName) === null) {
		return null;
	}

	return GetEntityProperty(EntityReference, strPropertyName, strType);
}

function WriteAnimationProperty(EntityReference, strPropertyName, Value, strType = undefined) {
	if (GetEntitySendProperty(EntityReference, strPropertyName) === null) {
		return false;
	}

	return SetEntityProperty(EntityReference, strPropertyName, Value, strType);
}

function CopyVector(Position) {
	return new Vector(Position.X, Position.Y, Position.Z);
}

function TransformPoint(vecMatrix, Point) {
	const TransformComponent = (vecRow) => (vecRow[0] * Point.X) + (vecRow[1] * Point.Y) + (vecRow[2] * Point.Z) + vecRow[3];

	return new Vector(TransformComponent(vecMatrix[0]), TransformComponent(vecMatrix[1]), TransformComponent(vecMatrix[2]));
}

function ReadTransform(EntityReference, unIndex, bAttachment) {
	const vecMatrix = g_AnimationRuntime.GetEntityAnimationTransform(EntityReference, unIndex, bAttachment);
	if (vecMatrix === null) {
		return null;
	}

	const Transform = new Matrix3x4(vecMatrix);
	return { Transform, Position: Transform.Position, Angles: Transform.Angles, Tick: GetGlobalVariables().TickCount };
}

function GetBones(EntityReference) {
	return GetEntityModelHeader(EntityReference).Bones().map((Bone, unIndex) => ({ Index: unIndex, Name: Bone.Name, Parent: Bone.Parent }));
}

function GetBone(EntityReference, Selector) {
	const vecBones = GetBones(EntityReference);
	const nIndex = FindIndex(vecBones, Selector);
	if (nIndex < 0) {
		return null;
	}

	const Transform = ReadTransform(EntityReference, nIndex, false);
	return (Transform === null) ? null : { ...vecBones[nIndex], ...Transform };
}

function GetHitboxSet(EntityReference) {
	// Do not silently assume set zero when the currently selected set is unknown.
	return ReadAnimationProperty(EntityReference, "m_nHitboxSet", "int");
}

function GetHitboxes(EntityReference, unSetIndex = GetHitboxSet(EntityReference)) {
	if (unSetIndex === null) {
		return [];
	}

	const HitboxSet = GetEntityModelHeader(EntityReference).GetHitboxSet(RequireIndex(unSetIndex, "Hitbox set"));
	if (HitboxSet === null) {
		return [];
	}

	return HitboxSet.Hitboxes().map((Hitbox, unIndex) => ({
		Index: unIndex,
		Set: unSetIndex,
		Name: Hitbox.Name,
		Bone: Hitbox.Bone,
		Group: Hitbox.Group,
		Mins: CopyVector(Hitbox.Mins),
		Maxs: CopyVector(Hitbox.Maxs),
	}));
}

function GetHitboxWorldBounds(EntityReference, Hitbox) {
	const Bone = ReadTransform(EntityReference, RequireIndex(Hitbox.Bone, "Hitbox bone"), false);
	if (Bone === null) {
		return null;
	}

	const { Mins, Maxs } = Hitbox;
	const vecMatrix = Bone.Transform.ConvertMatrixToArray();
	const LocalCenter = {
		X: (Mins.X + Maxs.X) / 2,
		Y: (Mins.Y + Maxs.Y) / 2,
		Z: (Mins.Z + Maxs.Z) / 2,
	};
	const vecCorners = [];
	for (const flX of [Mins.X, Maxs.X]) {
		for (const flY of [Mins.Y, Maxs.Y]) {
			for (const flZ of [Mins.Z, Maxs.Z]) {
				vecCorners.push(TransformPoint(vecMatrix, { X: flX, Y: flY, Z: flZ }));
			}
		}
	}

	return { ...Hitbox, Center: TransformPoint(vecMatrix, LocalCenter), Corners: vecCorners, Transform: Bone.Transform, Angles: Bone.Angles, Tick: Bone.Tick };
}

function GetHitbox(EntityReference, Selector, unSetIndex = GetHitboxSet(EntityReference)) {
	const vecHitboxes = GetHitboxes(EntityReference, unSetIndex);
	const nIndex = FindIndex(vecHitboxes, Selector);

	return (nIndex < 0) ? null : GetHitboxWorldBounds(EntityReference, vecHitboxes[nIndex]);
}

function FindHitboxesByGroup(EntityReference, nGroup, unSetIndex = GetHitboxSet(EntityReference)) {
	if (!Number.isInteger(nGroup)) {
		throw new TypeError("nGroup must be an integer hit group.");
	}

	return GetHitboxes(EntityReference, unSetIndex).filter((Hitbox) => Hitbox.Group === nGroup);
}

function GetAttachments(EntityReference) {
	return GetEntityModelHeader(EntityReference).Attachments().map((Attachment, unIndex) => ({ Index: unIndex, Name: Attachment.Name, Bone: Attachment.LocalBone }));
}

function GetAttachment(EntityReference, Selector) {
	const vecAttachments = GetAttachments(EntityReference);
	const nIndex = FindIndex(vecAttachments, Selector);
	if (nIndex < 0) {
		return null;
	}

	const Transform = ReadTransform(EntityReference, nIndex, true);
	return (Transform === null) ? null : { ...vecAttachments[nIndex], ...Transform };
}

function GetSequences(EntityReference) {
	return DescribeModelAnimation(GetEntityModelName(EntityReference)).Sequences;
}

function FindSequencesByActivity(EntityReference, Activity) {
	if ((typeof Activity !== "string") && !Number.isInteger(Activity)) {
		throw new TypeError("Activity must be an activity name or integer index.");
	}

	return GetSequences(EntityReference).filter((Sequence) => (typeof Activity === "string") ? (Sequence.Activity === Activity) : (Sequence.ActivityIndex === Activity));
}

function GetSequence(EntityReference) {
	return ReadAnimationProperty(EntityReference, "m_nSequence", "int");
}

function SetSequence(EntityReference, Selector) {
	const Information = DescribeModelAnimation(GetEntityModelName(EntityReference));
	const Sequence = FindSequence(Information, Selector);
	if (Sequence === null) {
		return false;
	}

	if (GetEntityInput(EntityReference, "SetAnimation") !== null) {
		return CallEntityInputFunction(EntityReference, "SetAnimation", Sequence.Name);
	}

	if (Information.IncludesModels) {
		return false;
	}

	return g_AnimationRuntime.ResetSequence(EntityReference, Sequence.Index);
}

function GetCycle(EntityReference) {
	return ReadAnimationProperty(EntityReference, "m_flCycle", "float");
}

function SetCycle(EntityReference, flCycle) {
	if (!Number.isFinite(flCycle) || (flCycle < 0) || (flCycle > 1)) {
		throw new RangeError("flCycle must be a finite number between 0 and 1.");
	}

	return WriteAnimationProperty(EntityReference, "m_flCycle", flCycle, "float");
}

function GetPlaybackRate(EntityReference) {
	return ReadAnimationProperty(EntityReference, "m_flPlaybackRate", "float");
}

function SetPlaybackRate(EntityReference, flPlaybackRate) {
	if (!Number.isFinite(flPlaybackRate)) {
		throw new TypeError("flPlaybackRate must be a finite number.");
	}

	return WriteAnimationProperty(EntityReference, "m_flPlaybackRate", flPlaybackRate, "float");
}

function FindEntityPoseParameter(EntityReference, Selector, Information = DescribeModelAnimation(GetEntityModelName(EntityReference))) {
	if (Information.IncludesModels) {
		return null;
	}

	const Parameter = FindPoseParameter(Information, Selector);
	if (Parameter === null) {
		return null;
	}

	const DataMap = GetEntityDataMap(EntityReference);
	if (DataMap === null) {
		return null;
	}

	const Field = FindEntityDataMapField(DataMap, "m_flPoseParameter");
	const unFloatSize = Float32Array.BYTES_PER_ELEMENT;
	if ((Field === null) || (Field.Type !== "float") || (Field.SizeInBytes !== (Field.ElementCount * unFloatSize)) || (Parameter.Index >= Field.ElementCount)) {
		return null;
	}

	return { Parameter, Offset: Field.Offset + (Parameter.Index * unFloatSize) };
}

function GetPoseParameters(EntityReference) {
	return DescribeModelAnimation(GetEntityModelName(EntityReference)).PoseParameters;
}

function GetPoseParameter(EntityReference, Selector) {
	const Entry = FindEntityPoseParameter(EntityReference, Selector);
	if (Entry === null) {
		return null;
	}

	const flNormalized = GetEntityProperty(EntityReference, Entry.Offset, "float");
	const { Start, End } = Entry.Parameter;
	return { ...Entry.Parameter, Value: Start + (flNormalized * (End - Start)), Normalized: flNormalized };
}

function SetPoseParameter(EntityReference, Selector, flValue) {
	const Entry = FindEntityPoseParameter(EntityReference, Selector);
	if (Entry === null) {
		return false;
	}

	const flNormalized = NormalizePoseParameter(Entry.Parameter, flValue);
	return SetEntityProperty(EntityReference, Entry.Offset, flNormalized, "float");
}

function ApplyModelPose(EntityReference, Selector, flFrame, PoseParameters = {}) {
	const Information = DescribeModelAnimation(GetEntityModelName(EntityReference));
	const Pose = PrepareModelPose(Information, Selector, flFrame, PoseParameters);
	if ((Pose === null) || (GetEntitySendProperty(EntityReference, "m_flCycle") === null)) {
		return false;
	}

	const vecWrites = [];
	for (const Parameter of Pose.PoseParameters) {
		const Entry = FindEntityPoseParameter(EntityReference, Parameter.Index, Information);
		if (Entry === null) {
			return false;
		}

		vecWrites.push({ Offset: Entry.Offset, Normalized: Parameter.Normalized });
	}

	if (!SetSequence(EntityReference, Pose.Sequence.Index) || !SetCycle(EntityReference, Pose.Cycle)) {
		return false;
	}

	for (const Write of vecWrites) {
		if (!SetEntityProperty(EntityReference, Write.Offset, Write.Normalized, "float")) {
			return false;
		}
	}

	return true;
}

function SetSequenceFrame(EntityReference, Selector, flFrame) {
	return ApplyModelPose(EntityReference, Selector, flFrame);
}

function GetLayer(EntityReference, unLayerIndex) {
	const Layer = g_AnimationRuntime.AccessLayer(EntityReference, RequireIndex(unLayerIndex, "Layer"));

	return (Layer === null) ? null : { ...Layer, Tick: GetGlobalVariables().TickCount };
}

function SetLayerCycle(EntityReference, unLayerIndex, flCycle) {
	if (!Number.isFinite(flCycle) || (flCycle < 0) || (flCycle > 1)) {
		throw new RangeError("flCycle must be a finite number between 0 and 1.");
	}

	return g_AnimationRuntime.AccessLayer(EntityReference, RequireIndex(unLayerIndex, "Layer"), 0, flCycle);
}

function SetLayerWeight(EntityReference, unLayerIndex, flWeight) {
	if (!Number.isFinite(flWeight) || (flWeight < 0) || (flWeight > 1)) {
		throw new RangeError("flWeight must be a finite number between 0 and 1.");
	}

	return g_AnimationRuntime.AccessLayer(EntityReference, RequireIndex(unLayerIndex, "Layer"), 1, flWeight);
}

function SetLayerPlaybackRate(EntityReference, unLayerIndex, flPlaybackRate) {
	if (!Number.isFinite(flPlaybackRate)) {
		throw new TypeError("flPlaybackRate must be a finite number.");
	}

	return g_AnimationRuntime.AccessLayer(EntityReference, RequireIndex(unLayerIndex, "Layer"), 2, flPlaybackRate);
}

module.exports = {
	GetBones,
	GetBone,
	GetHitboxSet,
	GetHitboxes,
	GetHitbox,
	FindHitboxesByGroup,
	GetAttachments,
	GetAttachment,
	GetSequences,
	FindSequencesByActivity,
	GetSequence,
	SetSequence,
	GetCycle,
	SetCycle,
	GetPlaybackRate,
	SetPlaybackRate,
	GetPoseParameters,
	GetPoseParameter,
	SetPoseParameter,
	ApplyModelPose,
	SetSequenceFrame,
	GetLayer,
	SetLayerCycle,
	SetLayerWeight,
	SetLayerPlaybackRate,
};
