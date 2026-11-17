"use strict";

const Assert = require("node:assert/strict");
const FileSystem = require("node:fs");
const Path = require("node:path");
const VirtualMachine = require("node:vm");

const g_strPackageRoot = Path.resolve(__dirname, "../packages/sourcejs");
const g_strGameDataRoot = Path.resolve(__dirname, "../packaging/runtime/addons/sourcejs/gamedata/main");
const g_strVirtualMethodPatchPath = Path.join(g_strGameDataRoot, "VirtualMethodPatches/server.json");
function ReadGameDataProfile(strPath) {
	Assert.ok(FileSystem.readdirSync(Path.dirname(strPath)).includes(Path.basename(strPath)), `Missing exact GameData filename: ${strPath}`);
	return JSON.parse(FileSystem.readFileSync(strPath, "utf8"));
}

function VerifyVirtualMethodPatches() {
	const { Version, ...Platforms } = ReadGameDataProfile(g_strVirtualMethodPatchPath);
	Assert.equal(Version, 1);

	for (const [strPlatform, Architectures] of Object.entries(Platforms)) {
		for (const SDKs of Object.values(Architectures)) {
			for (const Classes of Object.values(SDKs)) {
				for (const Patch of Object.values(Classes)) {
					Assert.ok(Number.isInteger(Patch.Slots) && (Patch.Slots > 0) && (Patch.Slots <= 1024));
					if (strPlatform === "windows") {
						Assert.match(Patch.BaseClass, /^[A-Za-z_]\w*$/);
						Assert.match(Patch.BaseOverrides, /^[+-]+$/);
						Assert.ok(Patch.Slots > Patch.BaseOverrides.length);
					} else {
						Assert.equal(strPlatform, "linux");
						Assert.match(Patch.TypeName, /^\w+$/);
						Assert.deepEqual(Object.keys(Patch).sort(), ["Methods", "Slots", "TypeName"]);
					}

					Assert.ok(Object.keys(Patch.Methods).length > 0);

					for (const [strName, Method] of Object.entries(Patch.Methods)) {
						const nSlot = (strPlatform === "linux") ? Method.Slot : Method;
						Assert.match(strName, /^[A-Za-z_]\w*$/);
						Assert.ok(Number.isInteger(nSlot) && (nSlot >= 0) && (nSlot < Patch.Slots));
						if (strPlatform === "linux") {
							Assert.match(Method.Symbol, /^_ZN[A-Za-z0-9_]+$/);
							Assert.deepEqual(Object.keys(Method), ["Slot", "Symbol"]);
						}
					}
				}
			}
		}
	}
}

function LoadFacade(strPath, Require) {
	const Module = { exports: {} };
	const strFilename = Path.join(g_strPackageRoot, strPath);
	const strSource = FileSystem.readFileSync(strFilename, "utf8");
	VirtualMachine.runInThisContext(`(function(require, module) { ${strSource}\n})`, { filename: strFilename })(Require, Module);

	return Module.exports;
}

function VerifyAnimation() {
	const Information = {
		Clips: [{ Name: "Walk", Index: 0, FrameCount: 11, FramesPerSecond: 20 }],
		Sequences: [{ Name: "Walk", Index: 0, ClipIndex: 0, Activity: "Walk", ActivityIndex: 7 }],
		PoseParameters: [{ Name: "Yaw", Index: 0, Start: -180, End: 180, Loop: 360 }],
		IncludesModels: false,
	};
	const vecReleases = [];
	const Studio = LoadFacade("studio/animation.js", (strModule) => ({
		"internal/runtime": { GetModule: () => ({ GetAnimationInformation: () => Information }) },
		"studio/cache": { FindModelHandle: () => 23, INVALID_MODEL_HANDLE: -1, Release: (hHandle) => vecReleases.push(hHandle) },
	}[strModule]));

	Assert.equal(Studio.DescribeModelAnimation("model"), Information);
	Assert.deepEqual(vecReleases, [23]);
	Assert.equal(Studio.GetSequenceFrame(Information, "Walk", 5).Cycle, 0.5);
	Assert.equal(Studio.GetSequenceFrame(Information, 0, 5).Time, 0.25);
	Assert.throws(() => Studio.GetSequenceFrame(Information, 0, 11), RangeError);
	Assert.equal(Studio.PrepareModelPose(Information, "Walk", 5, { Yaw: 450 }).PoseParameters[0].Normalized, 0.75);
	Assert.throws(() => Studio.PrepareModelPose(Information, "Walk", 5, { Missing: 0 }), RangeError);

	function Vector(flX, flY, flZ) {
		return { X: flX, Y: flY, Z: flZ };
	}

	function Matrix3x4(vecRows) {
		return { Position: new Vector(vecRows[0][3], vecRows[1][3], vecRows[2][3]), Angles: { Pitch: 0, Yaw: 90, Roll: 0 }, ConvertMatrixToArray: () => vecRows };
	}

	const Entity = { Index: 4 };
	const FirstHitbox = { Bone: 0, Name: "First", Group: 8, Mins: new Vector(0, 0, 0), Maxs: new Vector(2, 4, 6) };
	const SecondHitbox = { Bone: 0, Name: "Second", Group: 9, Mins: new Vector(2, 0, 0), Maxs: new Vector(4, 4, 6) };
	const Header = {
		Bones: () => [{ Name: "RootBone", Parent: -1 }],
		GetHitboxSet: (unIndex) => (unIndex === 1) ? { Hitboxes: () => [FirstHitbox, SecondHitbox] } : null,
		Attachments: () => [{ Name: "Eyes", LocalBone: 0 }],
	};
	const mapProperties = new Map([["m_nHitboxSet", 1], ["m_nSequence", 0], ["m_flCycle", 0], ["m_flPlaybackRate", 1], [32, 0.5]]);
	const Animation = LoadFacade("entities/animation.js", (strModule) => ({
		"internal/runtime": {
			GetModule: () => ({
				GetEntityAnimationTransform(Reference, unIndex) {
					Assert.equal(Reference, Entity);
					Assert.equal(unIndex, 0);
					return [[0, -1, 0, 100], [1, 0, 0, 200], [0, 0, 1, 300]];
				},
				ResetSequence: () => true,
				AccessLayer: (Reference, unIndex, nOperation) => (nOperation === undefined) ? null : false,
			}),
		},
		"entities/index": { GetEntityModelHeader: () => Header, GetEntityModelName: () => "model", GetEntityInput: () => null },
		"entities/datamaps": { FindEntityDataMapField: () => ({ Type: "float", ElementCount: 1, SizeInBytes: 4, Offset: 32 }), GetEntityDataMap: () => ({}) },
		"entities/props": {
			GetEntitySendProperty: (Reference, Property) => mapProperties.has(Property) ? {} : null,
			GetEntityProperty: (Reference, Property) => mapProperties.get(Property),
			SetEntityProperty: (Reference, Property, Value) => Boolean(mapProperties.set(Property, Value)),
		},
		globals: { GetGlobalVariables: () => ({ TickCount: 313 }) },
		mathlib: { Matrix3x4, Vector },
		"studio/animation": Studio,
	}[strModule]));

	const vecMatches = Animation.FindHitboxesByGroup(Entity, SecondHitbox.Group);
	Assert.deepEqual(vecMatches.map((Hitbox) => Hitbox.Index), [1]);
	Assert.deepEqual(Animation.FindHitboxesByGroup(Entity, FirstHitbox.Group).map((Hitbox) => Hitbox.Index), [0]);
	Assert.deepEqual(Animation.FindHitboxesByGroup(Entity, 0), []);

	const Bounds = Animation.GetHitbox(Entity, vecMatches[0].Index, vecMatches[0].Set);
	Assert.deepEqual(Bounds.Center, { X: 98, Y: 203, Z: 303 });
	Assert.equal(Bounds.Tick, 313);
	Assert.equal(Bounds.Set, 1);
	Assert.equal(Bounds.Corners.length, 8);
	Assert.deepEqual(Bounds.Corners[7], { X: 96, Y: 204, Z: 306 });
	Assert.notEqual(Bounds.Mins, SecondHitbox.Mins);
	Assert.equal(Animation.GetHitbox(Entity, "Absent"), null);
	Assert.equal(Animation.GetHitbox(Entity, 0, 0), null);
	Assert.equal(Animation.GetBone(Entity, "RootBone").Angles.Yaw, 90);
	Assert.equal(Animation.GetAttachment(Entity, "Eyes").Position.Z, 300);
	Assert.equal(Animation.FindSequencesByActivity(Entity, 7).length, 1);
	Assert.equal(Animation.GetPoseParameter(Entity, "Yaw").Value, 0);
	Assert.equal(Animation.ApplyModelPose(Entity, "Walk", 5, { Yaw: 90 }), true);
	Assert.equal(Animation.GetCycle(Entity), 0.5);
	Assert.equal(Animation.GetPoseParameter(Entity, "Yaw").Normalized, 0.75);
	Assert.equal(Animation.SetPlaybackRate(Entity, 2), true);
	Assert.equal(Animation.GetPlaybackRate(Entity), 2);
	Assert.throws(() => Animation.SetCycle(Entity, 2), RangeError);
	Assert.equal(Animation.GetLayer(Entity, 0), null);
	Assert.equal(Animation.SetLayerWeight(Entity, 0, 0.5), false);
	Assert.equal(Object.hasOwn(Animation, "ScheduleAtTick"), false);
}

VerifyVirtualMethodPatches();
VerifyAnimation();
