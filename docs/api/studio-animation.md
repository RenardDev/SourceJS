# `require("studio/animation")`

Inspects model-local animation clips, sequences and pose parameters, and describes a frame without touching a live entity. A model animation frame is not a server tick. This module does not evaluate an offline skeleton; use [entities/animation](entities-animation.md) to apply a pose and query live bones or hitboxes.

| Function | Result |
| --- | --- |
| `GetAnimationInformation(hModelHandle)` | Detached snapshot from a caller-retained [studio/cache](studio.md) handle. |
| `DescribeModelAnimation(strModelPath)` | Same snapshot, owning the temporary model-cache reference for the call. |
| `FindSequence(Information, Selector)` / `FindPoseParameter(Information, Selector)` | Match an exact name or a zero-based model-local index; return the record or `null`. |
| `GetAnimationFrame(Information, Selector, flFrame)` | `{ Clip, Frame, Cycle, Time }` for a clip. Fractional frames are allowed; the range is `0` through `FrameCount - 1`. Time is in seconds at the source frame rate (or `null` if unknown). |
| `GetSequenceFrame(Information, Selector, flFrame)` | A frame description plus `Sequence`; returns `null` for missing or blended sequences with no single local clip. |
| `NormalizePoseParameter(Parameter, flValue)` | The model's clamped, normalized 0-to-1 pose value after applying its loop range. |
| `PrepareModelPose(Information, Selector, flFrame, PoseParameters = {})` | Sequence-frame description plus validated and normalized pose overrides by exact model parameter name. It does not change the model or entity. |

The snapshot contains `Clips` (`Index`, `Name`, `FrameCount`, `FramesPerSecond`), `Sequences` (`Index`, `Name`, `Activity`, `ActivityIndex`, `ClipIndex`), `PoseParameters` (`Index`, `Name`, `Start`, `End`, `Loop`) and `IncludesModels`. A sequence with no unambiguous local clip uses `ClipIndex: -1`. Included-model indices are not interchangeable with the indices in this snapshot.

```js
const { DescribeModelAnimation, FindPoseParameter, FindSequence, GetAnimationFrame, GetAnimationInformation, GetSequenceFrame, NormalizePoseParameter, PrepareModelPose } = require("studio/animation");

function DescribePoseAtFrame(strModelPath, strSequenceName, flFrame, PoseParameters) {
	const Information = DescribeModelAnimation(strModelPath);
	return PrepareModelPose(Information, strSequenceName, flFrame, PoseParameters);
}

function InspectRetainedModel(hModelHandle, strSequenceName, strPoseName, flFrame, flValue) {
	const Information = GetAnimationInformation(hModelHandle);
	if (Information === null) {
		return null;
	}

	const Sequence = FindSequence(Information, strSequenceName);
	const Parameter = FindPoseParameter(Information, strPoseName);

	return {
		SequenceFrame: GetSequenceFrame(Information, strSequenceName, flFrame),
		ClipFrame: (Sequence && (Sequence.ClipIndex >= 0)) ? GetAnimationFrame(Information, Sequence.ClipIndex, flFrame) : null,
		Normalized: Parameter ? NormalizePoseParameter(Parameter, flValue) : null,
	};
}

module.exports = { DescribePoseAtFrame, InspectRetainedModel };
```
