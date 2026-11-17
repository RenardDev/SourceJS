# `require("entities/animation")`

Reads and changes a live entity's animation on the game thread. World transforms reflect the server's current evaluated pose, not a client-rendered pose or a lag-compensated rewind. No operation schedules a server tick.

## Bones, hitboxes, and attachments

An entity reference is a live entity or its index. A selector is a zero-based model index or an exact model name.

| Function | Result |
| --- | --- |
| `GetBones(EntityReference)` | Detached array of `{ Index, Name, Parent }` records. |
| `GetBone(EntityReference, Selector)` | Bone record with world `Position`, `Angles`, `Transform` and server `Tick`, or `null` if missing. |
| `GetHitboxSet(EntityReference)` | Active hitbox-set index, or `null` if the SDK does not expose it. Never substitutes set zero. |
| `GetHitboxes(EntityReference, unSetIndex = GetHitboxSet(EntityReference))` | Detached hitbox descriptions with `Index`, `Set`, `Name`, `Bone`, `Group`, and bone-local `Mins` and `Maxs`. An unavailable set yields an empty array. |
| `FindHitboxesByGroup(EntityReference, nGroup, unSetIndex = GetHitboxSet(EntityReference))` | All matching descriptions in model order. |
| `GetHitbox(EntityReference, Selector, unSetIndex = GetHitboxSet(EntityReference))` | Hitbox description plus world `Center`, eight oriented `Corners`, bone `Transform`, `Angles` and server `Tick`, or `null`. |
| `GetAttachments(EntityReference)` | Detached array of `{ Index, Name, Bone }` attachment records. |
| `GetAttachment(EntityReference, Selector)` | Attachment record with world `Position`, `Angles`, `Transform` and server `Tick`, or `null`. |

The transforms are detached [Matrix3x4](mathlib.md#matrix3x4) values. Center and corner coordinates are detached vectors; orientation is expressed in degrees as `Pitch`, `Yaw`, and `Roll`. These are bone and attachment angles, not player view angles. For entity movement or facing use the entity's existing [Teleport](entities-entity.md) support.

Pass the group you want to inspect, such as `HitGroup.Head` from [players/constants](players-constants.md) when the SDK exposes it. A model can have more than one hitbox in a group. Use the returned model indices rather than assuming a fixed index; a hitbox center is not an eye position or a trace result.

```js
const { FindHitboxesByGroup, GetAttachment, GetAttachments, GetBone, GetBones, GetHitbox, GetHitboxes, GetHitboxSet } = require("entities/animation");

function GetHitboxCentersByGroup(EntityReference, nGroup) {
	const vecCenters = [];
	for (const Hitbox of FindHitboxesByGroup(EntityReference, nGroup)) {
		const Bounds = GetHitbox(EntityReference, Hitbox.Index, Hitbox.Set);
		if (Bounds !== null) {
			vecCenters.push({ Index: Bounds.Index, Position: Bounds.Center, Tick: Bounds.Tick });
		}
	}

	return vecCenters;
}

function InspectLiveModel(EntityReference, nGroup) {
	const unSetIndex = GetHitboxSet(EntityReference);
	const [Hitbox] = FindHitboxesByGroup(EntityReference, nGroup, unSetIndex);
	const [Attachment] = GetAttachments(EntityReference);

	return {
		Bones: GetBones(EntityReference),
		Hitboxes: GetHitboxes(EntityReference, unSetIndex),
		Bone: Hitbox ? GetBone(EntityReference, Hitbox.Bone) : null,
		SelectedHitbox: Hitbox ? GetHitbox(EntityReference, Hitbox.Index, unSetIndex) : null,
		Attachment: Attachment ? GetAttachment(EntityReference, Attachment.Index) : null,
	};
}

module.exports = { GetHitboxCentersByGroup, InspectLiveModel };
```

## Sequences, playback, and pose

| Function | Result |
| --- | --- |
| `GetSequences(EntityReference)` | Local sequence descriptions from the loaded model. |
| `FindSequencesByActivity(EntityReference, Activity)` | Local sequences matching an exact activity name or numeric activity index. There can be multiple matches. |
| `GetSequence(EntityReference)` / `SetSequence(EntityReference, Selector)` | Read the entity's current sequence index, or choose a local sequence. Writes use a reflected `SetAnimation` input or a verified server sequence-reset function where available. |
| `GetCycle(EntityReference)` / `SetCycle(EntityReference, flCycle)` | Read or set the normalized playback phase, from 0 through 1. |
| `GetPlaybackRate(EntityReference)` / `SetPlaybackRate(EntityReference, flPlaybackRate)` | Read or set the finite playback multiplier; 1 is normal speed. |
| `GetPoseParameters(EntityReference)` | Local pose parameter definitions and ranges. |
| `GetPoseParameter(EntityReference, Selector)` / `SetPoseParameter(EntityReference, Selector, flValue)` | Read the model-unit value and `Normalized` value, or set a model-unit value. A write wraps looping values and clamps them to the parameter's range. |
| `ApplyModelPose(EntityReference, Selector, flFrame, PoseParameters = {})` | Select the sequence and clip frame and apply optional name-to-value pose parameters now. A failure after the first write does not roll back prior writes. |
| `SetSequenceFrame(EntityReference, Selector, flFrame)` | Apply a clip frame without additional pose parameters. |

Single-value reads return `null` if unavailable. Writes return `false` when the operation or target is unavailable, and reject invalid values. Pose writes require a reflected float-array layout; they decline included-model pose index mappings rather than treating local indices as virtual indices. A model-name or model-cache failure can throw. Game code can update sequence, pose and playback again during the same or a later tick.

```js
const { ApplyModelPose, FindSequencesByActivity, GetCycle, GetPlaybackRate, GetPoseParameter, GetPoseParameters, GetSequence, GetSequences, SetCycle, SetPlaybackRate, SetPoseParameter, SetSequence, SetSequenceFrame } = require("entities/animation");

function ConfigureAnimatedEntity(EntityReference, strSequenceName, flFrame, PoseParameters) {
	return ApplyModelPose(EntityReference, strSequenceName, flFrame, PoseParameters);
}

function InspectPlayback(EntityReference, strActivityName, strParameterName) {
	return {
		Sequence: GetSequence(EntityReference),
		Cycle: GetCycle(EntityReference),
		PlaybackRate: GetPlaybackRate(EntityReference),
		Sequences: GetSequences(EntityReference),
		MatchingSequences: FindSequencesByActivity(EntityReference, strActivityName),
		PoseParameters: GetPoseParameters(EntityReference),
		SelectedParameter: GetPoseParameter(EntityReference, strParameterName),
	};
}

function ConfigurePlayback(EntityReference, strSequenceName, flCycle, flPlaybackRate) {
	return SetSequence(EntityReference, strSequenceName) && SetCycle(EntityReference, flCycle) && SetPlaybackRate(EntityReference, flPlaybackRate);
}

function ConfigurePoseParameterAtFrame(EntityReference, strSequenceName, flFrame, strParameterName, flValue) {
	return SetSequenceFrame(EntityReference, strSequenceName, flFrame) && SetPoseParameter(EntityReference, strParameterName, flValue);
}

module.exports = { ConfigureAnimatedEntity, InspectPlayback, ConfigurePlayback, ConfigurePoseParameterAtFrame };
```

## Layers

| Function | Result |
| --- | --- |
| `GetLayer(EntityReference, unLayerIndex)` | `{ Index, Sequence, Cycle, Weight, Tick }` for an active native overlay layer, or `null`. |
| `SetLayerCycle(EntityReference, unLayerIndex, flCycle)` | Set an existing layer's phase (0 to 1). |
| `SetLayerWeight(EntityReference, unLayerIndex, flWeight)` | Set an existing layer's weight (0 to 1). |
| `SetLayerPlaybackRate(EntityReference, unLayerIndex, flPlaybackRate)` | Set an existing layer's finite playback multiplier. |

Layer writes return `false` when no verified overlay method is available. These operations do not create or remove layers.

```js
const { GetLayer, SetLayerCycle, SetLayerPlaybackRate, SetLayerWeight } = require("entities/animation");

function ConfigureExistingLayer(EntityReference, unLayerIndex, flCycle, flWeight, flPlaybackRate) {
	if (GetLayer(EntityReference, unLayerIndex) === null) {
		return false;
	}

	return SetLayerCycle(EntityReference, unLayerIndex, flCycle) && SetLayerWeight(EntityReference, unLayerIndex, flWeight) && SetLayerPlaybackRate(EntityReference, unLayerIndex, flPlaybackRate);
}

module.exports = { ConfigureExistingLayer };
```

For model data without a live entity, see [studio/animation](studio-animation.md).

## Native transform availability

`GetBone`, world-space `GetHitbox`, and `GetAttachment` use the packaged `addons/sourcejs/gamedata/main/VirtualMethodPatches/server.json`. The current profile includes Windows and Linux x86 L4D2. The patcher reads verified virtual slots; it does not modify the game's vtables.

On Windows, the class must match the expected RTTI inheritance, table sizes, and ordered base-slot override pattern. These structural checks do not detect every possible reorder. On Linux, SourceJS checks the RTTI class and verifies each slot against its exact ELF method symbol. An unavailable symbol or a changed slot makes that transform unavailable.

Linux sequence reset and layer access also require the corresponding native ELF symbols. Unsupported world transforms and layer reads return `null`; model-local descriptions remain available. Windows does not have a native sequence-reset or layer backend; an entity's `SetAnimation` input still works where exposed.

SourceJS caches method addresses and misses on first use. Reload SourceJS after changing the patch profile. See [Native GameData](../native-gamedata.md) for the profile format and its ABI limits.
