"use strict";

const { FindHitboxesByGroup, GetAttachment, GetAttachments, GetBone, GetBones, GetHitbox, GetHitboxes, GetHitboxSet, GetPlaybackRate, GetPoseParameters, GetSequences, SetPlaybackRate } = require("entities/animation");
const { GetGlobalVariables } = require("globals");
const { LogInfo } = require("loggers");
const { GetAllPlayers } = require("players");

function IsFinitePosition(Position) {
	return Number.isFinite(Position.X) && Number.isFinite(Position.Y) && Number.isFinite(Position.Z);
}

function GetVerifiedBounds(Player, Hitbox, nTick, nSet) {
	const Bounds = GetHitbox(Player, Hitbox.Index, nSet);
	if (Bounds === null) {
		throw new Error(`ANIMATION_LIVE_NO_HITBOX_TRANSFORM Tick=${nTick} Set=${nSet} Index=${Hitbox.Index}`);
	}

	const Bone = GetBone(Player, Bounds.Bone);
	if ((Bounds.Set !== nSet) || (Bounds.Tick !== nTick) || !IsFinitePosition(Bounds.Center) || (Bounds.Corners.length !== 8) ||
		(Bone === null) || (Bone.Tick !== nTick) || !IsFinitePosition(Bone.Position)) {
		throw new Error("ANIMATION_LIVE_INCONSISTENT_TRANSFORM");
	}

	return { Bounds, Bone };
}

function Load() {
	const vecPlayers = GetAllPlayers().filter((Player) => Player.Valid && !Player.Dead);
	if (vecPlayers.length === 0) {
		throw new Error("ANIMATION_LIVE_NO_TEST_PLAYER");
	}

	const Player = vecPlayers[0];
	const nTick = GetGlobalVariables().TickCount;
	const nSet = GetHitboxSet(Player);
	if (nSet === null) {
		throw new Error("ANIMATION_LIVE_NO_ACTIVE_HITBOX_SET");
	}

	const vecHitboxes = GetHitboxes(Player, nSet);
	const [Hitbox] = vecHitboxes;
	if (Hitbox === undefined) {
		throw new Error("ANIMATION_LIVE_EMPTY_HITBOX_SET");
	}

	const vecGroup = FindHitboxesByGroup(Player, Hitbox.Group, nSet);
	if (!vecGroup.some((Entry) => Entry.Index === Hitbox.Index)) {
		throw new Error("ANIMATION_LIVE_HITBOX_GROUP_MISMATCH");
	}

	const OtherHitbox = vecHitboxes.find((Entry) => Entry.Bone !== Hitbox.Bone);
	if (OtherHitbox === undefined) {
		throw new Error("ANIMATION_LIVE_EXPECTED_DISTINCT_HITBOX_BONES");
	}

	const { Bounds, Bone } = GetVerifiedBounds(Player, Hitbox, nTick, nSet);
	const OtherResult = GetVerifiedBounds(Player, OtherHitbox, nTick, nSet);
	const { Position } = Bone;
	const OtherPosition = OtherResult.Bone.Position;
	if ((Position.X === OtherPosition.X) && (Position.Y === OtherPosition.Y) && (Position.Z === OtherPosition.Z)) {
		throw new Error("ANIMATION_LIVE_DISTINCT_BONES_SHARE_ORIGIN");
	}

	const vecAttachments = GetAttachments(Player);
	let unAttachmentTransforms = 0;
	for (const Entry of vecAttachments) {
		const Attachment = GetAttachment(Player, Entry.Index);
		if (Attachment !== null) {
			if ((Attachment.Tick !== nTick) || !IsFinitePosition(Attachment.Position)) {
				throw new Error("ANIMATION_LIVE_INVALID_ATTACHMENT");
			}

			++unAttachmentTransforms;
		}
	}

	if ((vecAttachments.length > 0) && (unAttachmentTransforms === 0)) {
		throw new Error("ANIMATION_LIVE_NO_ATTACHMENT_TRANSFORM");
	}

	const vecBones = GetBones(Player);
	const vecSequences = GetSequences(Player);
	const vecPoseParameters = GetPoseParameters(Player);
	const flRate = GetPlaybackRate(Player);
	if (!Number.isFinite(flRate) || (vecBones.length === 0) || (vecSequences.length === 0)) {
		throw new Error("ANIMATION_LIVE_INVALID_METADATA");
	}

	try {
		const flTestRate = 0.75;
		if (!SetPlaybackRate(Player, flTestRate) || (GetPlaybackRate(Player) !== flTestRate)) {
			throw new Error("ANIMATION_LIVE_PLAYBACK_WRITE_FAILED");
		}
	} finally {
		if (!SetPlaybackRate(Player, flRate)) {
			throw new Error("ANIMATION_LIVE_PLAYBACK_RESTORE_FAILED");
		}
	}

	const strCenter = `(${Bounds.Center.X},${Bounds.Center.Y},${Bounds.Center.Z})`;
	const strOtherCenter = `(${OtherResult.Bounds.Center.X},${OtherResult.Bounds.Center.Y},${OtherResult.Bounds.Center.Z})`;
	LogInfo(`ANIMATION_LIVE_PASS Tick=${nTick} Entity=${Player.Index} Set=${nSet} Group=${Hitbox.Group} Hitbox=${Hitbox.Index} OtherHitbox=${OtherHitbox.Index} Bones=${vecBones.length} Attachments=${unAttachmentTransforms} Sequences=${vecSequences.length} PoseParameters=${vecPoseParameters.length} Center=${strCenter} OtherCenter=${strOtherCenter}`);
}

module.exports = { Load };
