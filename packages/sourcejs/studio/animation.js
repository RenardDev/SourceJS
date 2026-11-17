"use strict";

const { GetModule } = require("internal/runtime");
const { FindModelHandle, INVALID_MODEL_HANDLE, Release } = require("studio/cache");

const g_StudioAnimationRuntime = GetModule("internal/studio-animation");

function GetAnimationInformation(hModelHandle) {
	return g_StudioAnimationRuntime.GetAnimationInformation(hModelHandle);
}

function DescribeModelAnimation(strModelPath) {
	const hModelHandle = FindModelHandle(strModelPath);
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Studio model not found: ${strModelPath}`);
	}

	try {
		const Information = GetAnimationInformation(hModelHandle);
		if (Information === null) {
			throw new Error(`Studio animation data not found: ${strModelPath}`);
		}

		return Information;
	} finally {
		Release(hModelHandle);
	}
}

function FindAnimationEntry(vecEntries, Selector) {
	if (typeof Selector === "string") {
		return vecEntries.find((Entry) => Entry.Name === Selector) ?? null;
	}

	if (!Number.isInteger(Selector) || (Selector < 0)) {
		throw new TypeError("Animation selectors must be a name or a non-negative integer index.");
	}

	return vecEntries[Selector] ?? null;
}

function FindSequence(Information, Selector) {
	return FindAnimationEntry(Information.Sequences, Selector);
}

function FindPoseParameter(Information, Selector) {
	return FindAnimationEntry(Information.PoseParameters, Selector);
}

function GetAnimationFrame(Information, Selector, flFrame) {
	const Clip = FindAnimationEntry(Information.Clips, Selector);
	if (Clip === null) {
		return null;
	}

	const unLastFrame = Clip.FrameCount - 1;
	if (!Number.isFinite(flFrame) || (flFrame < 0) || (flFrame > unLastFrame)) {
		throw new RangeError(`flFrame must be between 0 and ${unLastFrame}.`);
	}

	return {
		Clip,
		Frame: flFrame,
		Cycle: (unLastFrame === 0) ? 0 : flFrame / unLastFrame,
		Time: (Clip.FramesPerSecond > 0) ? flFrame / Clip.FramesPerSecond : null,
	};
}

function GetSequenceFrame(Information, Selector, flFrame) {
	const Sequence = FindSequence(Information, Selector);
	if ((Sequence === null) || (Sequence.ClipIndex < 0)) {
		return null;
	}

	const Frame = GetAnimationFrame(Information, Sequence.ClipIndex, flFrame);
	return (Frame === null) ? null : { ...Frame, Sequence };
}

function NormalizePoseParameter(Parameter, flValue) {
	const { Start, End, Loop } = Parameter;
	if (!Number.isFinite(flValue)) {
		throw new TypeError("flValue must be a finite pose parameter value.");
	}

	if (Start === End) {
		return 0;
	}

	let flAdjustedValue = flValue;
	if (Loop > 0) {
		const flWrap = (Start + End + Loop) / 2;
		const flShift = Loop - flWrap;
		flAdjustedValue -= Loop * Math.floor((flAdjustedValue + flShift) / Loop);
	}

	return Math.min(1, Math.max(0, (flAdjustedValue - Start) / (End - Start)));
}

function PrepareModelPose(Information, Selector, flFrame, PoseParameters = {}) {
	const Frame = GetSequenceFrame(Information, Selector, flFrame);
	if (Frame === null) {
		return null;
	}

	if ((PoseParameters === null) || (typeof PoseParameters !== "object") || Array.isArray(PoseParameters)) {
		throw new TypeError("PoseParameters must be an object mapping model pose names to numbers.");
	}

	const vecPoseParameters = [];
	for (const strName of Object.keys(PoseParameters)) {
		const Parameter = FindPoseParameter(Information, strName);
		if (Parameter === null) {
			throw new RangeError(`Unknown model pose parameter: ${strName}`);
		}

		const flValue = PoseParameters[strName];
		const flNormalized = NormalizePoseParameter(Parameter, flValue);
		vecPoseParameters.push({ ...Parameter, Value: flValue, Normalized: flNormalized });
	}

	return { ...Frame, PoseParameters: vecPoseParameters };
}

module.exports = {
	GetAnimationInformation,
	DescribeModelAnimation,
	FindSequence,
	FindPoseParameter,
	GetAnimationFrame,
	GetSequenceFrame,
	NormalizePoseParameter,
	PrepareModelPose,
};
