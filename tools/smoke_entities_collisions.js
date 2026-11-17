#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strCollisionsPath = g_Path.join(g_strPackageRoot, "entities", "collisions.js");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");
const g_strDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "entities-collisions.md");
const g_nCollisionGroupMinimum = -2_147_483_648;
const g_nCollisionGroupMaximum = 2_147_483_647;
const g_unSolidTypeMaximum = 255;
const g_unSolidFlagsMaximum = 0xFFFF;
const g_unEntityBaseAddress = 0x4000n;
const g_unEntityAddressStride = 0x10n;
const g_unEntityIndexMaximum = 0x7FFFFFFF;
const g_dblNativeFloatMaximum = 3.4028234663852886e+38;

// Synthetic entity/storage and return-value doubles are not SDK execution or identity/storage-safety proof.

const g_vecExpectedExports = [
	"GetCollisionGroupConstants",
	"GetSolidFlagConstants",
	"GetSolidTypeConstants",
	"AddEntitySolidFlags",
	"CollisionGroup",
	"CollisionRules",
	"GetEntityCollisionBounds",
	"GetEntityCollisionGroup",
	"GetEntityCollisionMaximums",
	"GetEntityCollisionMinimums",
	"GetEntitySolidFlags",
	"GetEntitySolidType",
	"HasEntitySolidFlags",
	"IsEntityCollisionEnabled",
	"RemoveEntitySolidFlags",
	"SetEntityCollisionBounds",
	"SetEntityCollisionEnabled",
	"SetEntityCollisionGroup",
	"SetEntityCollisionMaximums",
	"SetEntityCollisionMinimums",
	"SetEntitySolidFlags",
	"SetEntitySolidType",
	"SolidFlags",
	"SolidType",
];

const g_CollisionGroup = {
	None: 0,
	Debris: 1,
	DebrisTrigger: 2,
	InteractiveDebris: 3,
	Interactive: 4,
	Player: 5,
	BreakableGlass: 6,
	Vehicle: 7,
	PlayerMovement: 8,
	NPC: 9,
	InVehicle: 10,
	Weapon: 11,
	VehicleClip: 12,
	Projectile: 13,
	DoorBlocker: 14,
	PassableDoor: 15,
	Dissolving: 16,
	PushAway: 17,
	NPCActor: 18,
	NPCScripted: 19,
};

const g_SolidFlags = {
	CustomRayTest: 0x01,
	CustomBoxTest: 0x02,
	NotSolid: 0x04,
	Trigger: 0x08,
	NotStandable: 0x10,
	VolumeContents: 0x20,
	ForceWorldAligned: 0x40,
	UseTriggerBounds: 0x80,
	RootParentAligned: 0x100,
	TriggerTouchDebris: 0x200,
};

const g_SolidType = {
	None: 0,
	BSP: 1,
	BoundingBox: 2,
	OBB: 3,
	OBBYaw: 4,
	Custom: 5,
	VPhysics: 6,
};

class DocumentationVector {
	constructor(flX = 0, flY = 0, flZ = 0) {
		this.m_vecValues = [flX, flY, flZ];
	}

	get X() {
		return this.m_vecValues[0];
	}

	get Y() {
		return this.m_vecValues[1];
	}

	get Z() {
		return this.m_vecValues[2];
	}
}

function CreateVector(unAddress, flX, flY, flZ) {
	return { Address: unAddress, X: flX, Y: flY, Z: flZ };
}

const g_CollisionState = {
	Group: g_CollisionGroup.Player,
	Maximums: CreateVector(0x5100n, 16, 32, 72),
	Minimums: CreateVector(0x5000n, -16, -32, 0),
	SolidFlags: 0x00,
	SolidType: g_SolidType.BoundingBox,
};

// Controlled missing results/errors/statuses test JS forwarding, not native write atomicity.
const g_NativeSolidFlagCalls = {
	GetterCount: 0,
	SetterCount: 0,
	GetterReceiver: undefined,
	SetterReceiver: undefined,
	GetterEntity: undefined,
	SetterEntity: undefined,
	WrittenValue: undefined,
	ThrowGetter: false,
	GetterError: undefined,
	ThrowSetter: false,
	SetterError: undefined,
	SetterResult: true,
};

g_Assert.deepEqual([g_CollisionState.Minimums.Address, g_CollisionState.Maximums.Address], [0x5000n, 0x5100n], "collision bound fixture addresses must be exact BigInt values");

function Entity(unIndex) {
	if (!Number.isInteger(unIndex) || (unIndex < 0) || (unIndex > g_unEntityIndexMaximum)) {
		throw new Error("Entity index must be a non-negative native signed-32-bit integer.");
	}

	return { Index: (unIndex === 0) ? 0 : unIndex, Address: g_unEntityBaseAddress + BigInt(unIndex) * g_unEntityAddressStride };
}

function RequireEntity(EntityReference, strOperationName) {
	let nEntityIndex;
	if (typeof EntityReference === "number") {
		nEntityIndex = EntityReference;
	} else if (EntityReference && ((typeof EntityReference === "object") || (typeof EntityReference === "function"))) {
		nEntityIndex = EntityReference.Index;
	} else if (typeof EntityReference === "bigint") {
		// Decode only this fixture's aligned synthetic addresses, never arbitrary native addresses.
		const nDisplacement = EntityReference - g_unEntityBaseAddress;
		if ((nDisplacement >= 0n) && ((nDisplacement % g_unEntityAddressStride) === 0n) && ((nDisplacement / g_unEntityAddressStride) <= BigInt(g_unEntityIndexMaximum))) {
			nEntityIndex = Number(nDisplacement / g_unEntityAddressStride);
		}
	}

	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < 0) || (nEntityIndex > g_unEntityIndexMaximum)) {
		throw new Error(`${strOperationName} requires a resolvable fixture entity.`);
	}

	return Entity(nEntityIndex);
}

function RequireInteger(Value, strOperationName, nMinimum, nMaximum) {
	if (typeof Value === "bigint") {
		if ((Value < BigInt(nMinimum)) || (Value > BigInt(nMaximum))) {
			throw new Error(`${strOperationName} requires an integer value in the native field storage range.`);
		}

		return Number(Value);
	}

	if (!Number.isInteger(Value) || (Value < nMinimum) || (Value > nMaximum)) {
		throw new Error(`${strOperationName} requires an integer value in the native field storage range.`);
	}

	return (Value === 0) ? 0 : Value;
}

function RequireFiniteNumber(Value, strOperationName) {
	const dblValue = +Value;
	if (!Number.isFinite(dblValue) || (Math.abs(dblValue) > g_dblNativeFloatMaximum)) {
		throw new Error(`${strOperationName} requires a finite native float.`);
	}

	return Math.fround(dblValue);
}

function IsNullish(Value) {
	return (Value === null) || (Value === undefined);
}

function RequireVector(VectorValue, strOperationName) {
	if (!VectorValue || ((typeof VectorValue !== "object") && (typeof VectorValue !== "function"))) {
		throw new Error(`${strOperationName} requires a vector object.`);
	}

	const bArrayInput = Array.isArray(VectorValue);
	const vecComponents = [];
	let bHasComponent = false;
	for (const [unIndex, strName, strFallback] of [[0, "X", "Pitch"], [1, "Y", "Yaw"], [2, "Z", "Roll"]]) {
		let Value = bArrayInput ? VectorValue[unIndex] : VectorValue[strName];
		if (!bArrayInput && IsNullish(Value)) {
			Value = VectorValue[strFallback];
		}

		const bPresent = !IsNullish(Value);
		vecComponents.push(bPresent ? RequireFiniteNumber(Value, `${strOperationName}.${strName}`) : 0);
		bHasComponent = bHasComponent || bPresent;
	}

	if (!bHasComponent) {
		throw new Error(`${strOperationName} requires at least one vector component.`);
	}

	return { X: vecComponents[0], Y: vecComponents[1], Z: vecComponents[2] };
}

function WriteVector(Target, Value, strOperationName) {
	const Source = RequireVector(Value, strOperationName);
	Target.X = Source.X;
	Target.Y = Source.Y;
	Target.Z = Source.Z;

	return true;
}

const g_NativeCollisions = {
	GetCollisionGroupConstants() {
		return g_CollisionGroup;
	},
	GetCollisionGroup(Entity) {
		RequireEntity(Entity, "GetCollisionGroup");

		return g_CollisionState.Group;
	},
	GetMaximumBounds(Entity) {
		RequireEntity(Entity, "GetMaximumBounds");

		return g_CollisionState.Maximums;
	},
	GetMinimumBounds(Entity) {
		RequireEntity(Entity, "GetMinimumBounds");

		return g_CollisionState.Minimums;
	},
	GetSolidFlags(Entity) {
		g_NativeSolidFlagCalls.GetterCount++;
		g_NativeSolidFlagCalls.GetterReceiver = this;
		g_NativeSolidFlagCalls.GetterEntity = Entity;

		if (g_NativeSolidFlagCalls.ThrowGetter) {
			throw g_NativeSolidFlagCalls.GetterError;
		}

		RequireEntity(Entity, "GetSolidFlags");

		return g_CollisionState.SolidFlags;
	},
	GetSolidType(Entity) {
		RequireEntity(Entity, "GetSolidType");

		return g_CollisionState.SolidType;
	},
	SetCollisionGroup(Entity, nValue) {
		RequireEntity(Entity, "SetCollisionGroup");
		g_CollisionState.Group = RequireInteger(nValue, "SetCollisionGroup", g_nCollisionGroupMinimum, g_nCollisionGroupMaximum);

		return true;
	},
	SetMaximumBounds(Entity, Value) {
		RequireEntity(Entity, "SetMaximumBounds");

		return WriteVector(g_CollisionState.Maximums, Value, "SetMaximumBounds");
	},
	SetMinimumBounds(Entity, Value) {
		RequireEntity(Entity, "SetMinimumBounds");

		return WriteVector(g_CollisionState.Minimums, Value, "SetMinimumBounds");
	},
	SetSolidFlags(Entity, unValue) {
		g_NativeSolidFlagCalls.SetterCount++;
		g_NativeSolidFlagCalls.SetterReceiver = this;
		g_NativeSolidFlagCalls.SetterEntity = Entity;
		g_NativeSolidFlagCalls.WrittenValue = unValue;

		if (g_NativeSolidFlagCalls.ThrowSetter) {
			throw g_NativeSolidFlagCalls.SetterError;
		}

		RequireEntity(Entity, "SetSolidFlags");
		g_CollisionState.SolidFlags = RequireInteger(unValue, "SetSolidFlags", 0, g_unSolidFlagsMaximum);

		return g_NativeSolidFlagCalls.SetterResult;
	},
	SetSolidType(Entity, unValue) {
		RequireEntity(Entity, "SetSolidType");
		g_CollisionState.SolidType = RequireInteger(unValue, "SetSolidType", 0, g_unSolidTypeMaximum);

		return true;
	},
	GetSolidFlagConstants() {
		return g_SolidFlags;
	},
	GetSolidTypeConstants() {
		return g_SolidType;
	},
};

g_Assert.equal(Entity(2).Address, 0x4020n, "collision entity fixture address must be an exact BigInt value");

function InstallDependency(strRelativePath, ModuleExports) {
	const strFilePath = g_Path.join(g_strPackageRoot, strRelativePath);
	require.cache[strFilePath] = {
		children: [],
		exports: ModuleExports,
		filename: strFilePath,
		id: strFilePath,
		loaded: true,
		paths: [],
	};
}

function SnapshotState() {
	return {
		Group: g_CollisionState.Group,
		Maximums: [g_CollisionState.Maximums.X, g_CollisionState.Maximums.Y, g_CollisionState.Maximums.Z],
		Minimums: [g_CollisionState.Minimums.X, g_CollisionState.Minimums.Y, g_CollisionState.Minimums.Z],
		SolidFlags: g_CollisionState.SolidFlags,
		SolidType: g_CollisionState.SolidType,
	};
}

function RestoreState(Snapshot) {
	g_CollisionState.Group = Snapshot.Group;
	WriteVector(g_CollisionState.Maximums, Snapshot.Maximums, "restore maximums");
	WriteVector(g_CollisionState.Minimums, Snapshot.Minimums, "restore minimums");
	g_CollisionState.SolidFlags = Snapshot.SolidFlags;
	g_CollisionState.SolidType = Snapshot.SolidType;
}

function ResetSolidFlagCalls() {
	Object.assign(g_NativeSolidFlagCalls, {
		GetterCount: 0,
		SetterCount: 0,
		GetterReceiver: undefined,
		SetterReceiver: undefined,
		GetterEntity: undefined,
		SetterEntity: undefined,
		WrittenValue: undefined,
		ThrowGetter: false,
		GetterError: undefined,
		ThrowSetter: false,
		SetterError: undefined,
		SetterResult: true,
	});
}

function VerifyNativeSelectionAndVectorFixtures() {
	const Snapshot = SnapshotState();
	try {
		const EntityFunction = () => undefined;
		EntityFunction.Index = 2;
		for (const EntityReference of [0, Entity(0), { Index: 0 }, g_unEntityBaseAddress, Entity(2).Address, EntityFunction]) {
			g_Assert.equal(g_NativeCollisions.GetCollisionGroup(EntityReference), Snapshot.Group);
		}

		for (const EntityReference of [-1, 0.5, g_unEntityIndexMaximum + 1, "1", null, undefined, 0n, g_unEntityBaseAddress + 1n, { Index: 1n }, { Index: "1" }]) {
			g_Assert.throws(() => g_NativeCollisions.GetCollisionGroup(EntityReference), { name: "Error" });
		}

		const EntityError = new Error("Original fixture Index getter error.");
		const InvalidEntity = {
			get Index() {
				throw EntityError;
			},
		};
		g_Assert.throws(() => g_NativeCollisions.GetCollisionGroup(InvalidEntity), (ErrorValue) => ErrorValue === EntityError);

		for (const [Value, vecExpected] of [
			[[1, 2, 3], [1, 2, 3]],
			[{ X: "1.1", Y: true, Z: false }, [Math.fround(1.1), 1, 0]],
			[{ X: null, Pitch: 2, Y: null, Yaw: 3 }, [2, 3, 0]],
			[{ X: false, Y: null, Z: undefined }, [0, 0, 0]],
			[new DocumentationVector(4, 5, 6), [4, 5, 6]],
		]) {
			g_Assert.equal(g_NativeCollisions.SetMinimumBounds(0, Value), true);
			g_Assert.deepEqual([g_CollisionState.Minimums.X, g_CollisionState.Minimums.Y, g_CollisionState.Minimums.Z], vecExpected);
		}

		for (const Value of [[], {}, { X: null, Y: null, Z: null }, { X: Infinity }, { X: NaN }, { X: g_dblNativeFloatMaximum * 2 }, { X: 1n }, { X: Symbol("invalid") }]) {
			const vecBefore = [g_CollisionState.Minimums.X, g_CollisionState.Minimums.Y, g_CollisionState.Minimums.Z];
			g_Assert.throws(() => g_NativeCollisions.SetMinimumBounds(0, Value), Error);
			g_Assert.deepEqual([g_CollisionState.Minimums.X, g_CollisionState.Minimums.Y, g_CollisionState.Minimums.Z], vecBefore);
		}

		const vecOrder = [];
		const VectorError = new Error("Original vector conversion error.");
		const InvalidVector = {
			get X() {
				vecOrder.push("X");

				return {
					valueOf() {
						vecOrder.push("ConvertX");
						throw VectorError;
					},
				};
			},
			get Y() {
				vecOrder.push("Y");

				return 1;
			},
		};
		g_Assert.throws(() => g_NativeCollisions.SetMinimumBounds(0, InvalidVector), (ErrorValue) => ErrorValue === VectorError);
		g_Assert.deepEqual(vecOrder, ["X", "ConvertX"], "Conversion must precede the next component getter.");
	} finally {
		RestoreState(Snapshot);
		ResetSolidFlagCalls();
	}
}

function VerifyNativeIntegerFixture() {
	const Snapshot = SnapshotState();
	const EntityValue = Entity(2);
	try {
		for (const Scenario of [
			{ Set: g_NativeCollisions.SetCollisionGroup, Get: g_NativeCollisions.GetCollisionGroup, Minimum: -2_147_483_648, Maximum: 2_147_483_647 },
			{ Set: g_NativeCollisions.SetSolidType, Get: g_NativeCollisions.GetSolidType, Minimum: 0, Maximum: 255 },
			{ Set: g_NativeCollisions.SetSolidFlags, Get: g_NativeCollisions.GetSolidFlags, Minimum: 0, Maximum: 0xFFFF },
		]) {
			for (const Value of [Scenario.Minimum, Scenario.Maximum, -0, BigInt(Scenario.Minimum), BigInt(Scenario.Maximum)]) {
				g_Assert.equal(Scenario.Set(EntityValue, Value), true);
				const nExpected = Number(Value);
				g_Assert.equal(Scenario.Get(EntityValue), (nExpected === 0) ? 0 : nExpected, "collision scalar fixture must preserve lossless native-width writes");
			}

			for (const InvalidValue of [Scenario.Minimum - 1, Scenario.Maximum + 1, BigInt(Scenario.Minimum) - 1n, BigInt(Scenario.Maximum) + 1n, 0.5, Number.NaN, Infinity, -Infinity, true, null, undefined, "1", {}, []]) {
				const nBefore = Scenario.Get(EntityValue);
				g_Assert.throws(() => Scenario.Set(EntityValue, InvalidValue), { name: "Error" }, "collision scalar fixture must reject invalid and out-of-range writes");
				g_Assert.equal(Scenario.Get(EntityValue), nBefore, "rejected collision writes must preserve fixture state");
			}
		}
	} finally {
		RestoreState(Snapshot);
	}
}

VerifyNativeIntegerFixture();
VerifyNativeSelectionAndVectorFixtures();

function ExtractJavaScriptBlocks(strMarkdown) {
	return Array.from(strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function TrackModule(ModuleExports, setExercisedExports) {
	const TrackedExports = {};

	for (const [strName, Value] of Object.entries(ModuleExports)) {
		Object.defineProperty(TrackedExports, strName, {
			enumerable: true,
			get() {
				setExercisedExports.add(strName);

				if (typeof Value !== "function") {
					return Value;
				}

				function TrackedFunction(...vecArguments) {
					setExercisedExports.add(strName);

					if (new.target) {
						return Reflect.construct(Value, vecArguments, Value);
					}

					return Value(...vecArguments);
				}

				TrackedFunction.prototype = Value.prototype;

				return TrackedFunction;
			},
		});
	}

	return TrackedExports;
}

function VerifySolidFlagReadContract(Collisions, EntityReference) {
	const Snapshot = SnapshotState();
	const Rules = new Collisions.CollisionRules(EntityReference);
	const vecOperations = [
		{ Name: "Add", Kind: "ADD", Mutation: true, Run: () => Collisions.AddEntitySolidFlags(EntityReference, g_SolidFlags.TRIGGER) },
		{ Name: "Remove", Kind: "REMOVE", Mutation: true, Run: () => Collisions.RemoveEntitySolidFlags(EntityReference, g_SolidFlags.TRIGGER) },
		{ Name: "HasZero", Kind: "ZERO", Mutation: false, Run: () => Collisions.HasEntitySolidFlags(EntityReference, 0) },
		{ Name: "Has", Kind: "HAS", Mutation: false, Run: () => Collisions.HasEntitySolidFlags(EntityReference, g_SolidFlags.TRIGGER) },
		{ Name: "Enabled", Kind: "ENABLED", Mutation: false, Run: () => Collisions.IsEntityCollisionEnabled(EntityReference) },
		{ Name: "Enable", Kind: "ENABLE", Mutation: true, Run: () => Collisions.SetEntityCollisionEnabled(EntityReference, true) },
		{ Name: "Disable", Kind: "DISABLE", Mutation: true, Run: () => Collisions.SetEntityCollisionEnabled(EntityReference, false) },
		{ Name: "ClassAdd", Kind: "ADD", Mutation: true, Run: () => Rules.AddSolidFlags(g_SolidFlags.TRIGGER) },
		{ Name: "ClassRemove", Kind: "REMOVE", Mutation: true, Run: () => Rules.RemoveSolidFlags(g_SolidFlags.TRIGGER) },
		{ Name: "ClassHasZero", Kind: "ZERO", Mutation: false, Run: () => Rules.HasSolidFlags(0) },
		{ Name: "ClassHas", Kind: "HAS", Mutation: false, Run: () => Rules.HasSolidFlags(g_SolidFlags.TRIGGER) },
		{ Name: "ClassEnabled", Kind: "ENABLED", Mutation: false, Run: () => Rules.CollisionEnabled },
		{ Name: "ClassEnable", Kind: "ENABLE", Mutation: true, Assignment: true, Run: () => Rules.CollisionEnabled = true },
		{ Name: "ClassDisable", Kind: "DISABLE", Mutation: true, Assignment: true, Run: () => Rules.CollisionEnabled = false },
	];
	let unCoercions = 0;
	const NoCoercion = {
		[Symbol.toPrimitive]() {
			unCoercions++;
			throw new Error("Native flags and masks must not be coerced.");
		},
	};
	const vecInvalidNativeFlags = [undefined, null, false, true, 0n, 1n, "0", "8", {}, [], NoCoercion, NaN, Infinity, -Infinity, 0.5, -1, g_unSolidFlagsMaximum + 1, -0.5, Symbol("invalid flags")];

	try {
		for (const Value of vecInvalidNativeFlags) {
			for (const Operation of vecOperations) {
				g_CollisionState.SolidFlags = Value;
				ResetSolidFlagCalls();
				g_Assert.throws(Operation.Run, { name: "TypeError", message: /native solid-flags getter.*unsigned 16-bit/ }, "Invalid native flag result must fail before writes.");
				g_Assert.equal(g_NativeSolidFlagCalls.GetterCount, 1, Operation.Name);
				g_Assert.equal(g_NativeSolidFlagCalls.SetterCount, 0, Operation.Name);
				g_Assert.equal(g_NativeSolidFlagCalls.GetterEntity, EntityReference);
				g_Assert.equal(g_NativeSolidFlagCalls.GetterReceiver, undefined);
				g_Assert.equal(g_CollisionState.SolidFlags, Value);
			}

			for (const Read of [() => Collisions.GetEntitySolidFlags(EntityReference), () => Rules.SolidFlags]) {
				ResetSolidFlagCalls();
				g_Assert.equal(Read(), Value, "Raw flag getters must continue forwarding native results.");
				g_Assert.equal(g_NativeSolidFlagCalls.GetterCount, 1);
				g_Assert.equal(g_NativeSolidFlagCalls.SetterCount, 0);
			}
		}

		const vecSetterResults = [true, false, undefined, 0, "controlled", Symbol("setter status"), Object.freeze({ Controlled: true })];
		for (const unFlags of [0, -0, 1, g_SolidFlags.NOT_SOLID, g_SolidFlags.TRIGGER, 16, 17, g_unSolidFlagsMaximum]) {
			for (const Result of vecSetterResults) {
				for (const Operation of vecOperations) {
					g_CollisionState.SolidFlags = unFlags;
					ResetSolidFlagCalls();
					g_NativeSolidFlagCalls.SetterResult = Result;
					const Actual = Operation.Run();
					g_Assert.equal(g_NativeSolidFlagCalls.GetterCount, 1);
					g_Assert.equal(g_NativeSolidFlagCalls.GetterEntity, EntityReference);
					g_Assert.equal(g_NativeSolidFlagCalls.GetterReceiver, undefined);
					g_Assert.equal(g_NativeSolidFlagCalls.SetterCount, Operation.Mutation ? 1 : 0);

					if (Operation.Mutation) {
						let nExpectedFlags;
						switch (Operation.Kind) {
							case "ADD":
								nExpectedFlags = unFlags | g_SolidFlags.TRIGGER;
								break;

							case "REMOVE":
								nExpectedFlags = unFlags & ~g_SolidFlags.TRIGGER;
								break;

							case "ENABLE":
								nExpectedFlags = unFlags & ~g_SolidFlags.NOT_SOLID;
								break;

							default:
								nExpectedFlags = unFlags | g_SolidFlags.NOT_SOLID;
								break;
						}

						g_Assert.equal(g_NativeSolidFlagCalls.WrittenValue, nExpectedFlags);
						g_Assert.equal(g_CollisionState.SolidFlags, nExpectedFlags);
						g_Assert.equal(g_NativeSolidFlagCalls.SetterEntity, EntityReference);
						g_Assert.equal(g_NativeSolidFlagCalls.SetterReceiver, undefined);
						g_Assert.equal(Actual, Operation.Assignment ? Operation.Kind === "ENABLE" : Result, "Setter statuses must not be coerced.");
					} else {
						const bExpected = (Operation.Kind === "ZERO") || ((Operation.Kind === "HAS") ? (unFlags & g_SolidFlags.TRIGGER) === g_SolidFlags.TRIGGER : (unFlags & g_SolidFlags.NOT_SOLID) === 0);
						g_Assert.equal(Actual, bExpected);
					}
				}
			}
		}

		for (const InvalidMask of [undefined, null, false, 0n, "8", {}, NoCoercion, 0.5, NaN, Infinity, Symbol("mask")]) {
			for (const Run of [
				() => Collisions.AddEntitySolidFlags(EntityReference, InvalidMask),
				() => Collisions.RemoveEntitySolidFlags(EntityReference, InvalidMask),
				() => Collisions.HasEntitySolidFlags(EntityReference, InvalidMask),
				() => Rules.AddSolidFlags(InvalidMask),
				() => Rules.RemoveSolidFlags(InvalidMask),
				() => Rules.HasSolidFlags(InvalidMask),
			]) {
				ResetSolidFlagCalls();
				g_NativeSolidFlagCalls.ThrowGetter = true;
				g_NativeSolidFlagCalls.GetterError = new Error("Input validation must precede native lookup.");
				g_Assert.throws(Run, { name: "TypeError", message: "nSolidFlags must be an integer." });
				g_Assert.equal(g_NativeSolidFlagCalls.GetterCount, 0);
				g_Assert.equal(g_NativeSolidFlagCalls.SetterCount, 0);
			}
		}

		for (const InvalidEnabled of [undefined, null, 0, 1, 0n, "true", {}, NoCoercion]) {
			for (const Run of [() => Collisions.SetEntityCollisionEnabled(EntityReference, InvalidEnabled), () => Rules.CollisionEnabled = InvalidEnabled]) {
				ResetSolidFlagCalls();
				g_Assert.throws(Run, { name: "TypeError", message: "bCollisionEnabled must be a boolean." });
				g_Assert.equal(g_NativeSolidFlagCalls.GetterCount, 0);
				g_Assert.equal(g_NativeSolidFlagCalls.SetterCount, 0);
			}
		}

		for (const ErrorValue of [new Error("Original native flag error."), undefined, 0, "controlled", Symbol("error")]) {
			for (const Operation of vecOperations) {
				g_CollisionState.SolidFlags = 0;
				ResetSolidFlagCalls();
				g_NativeSolidFlagCalls.ThrowGetter = true;
				g_NativeSolidFlagCalls.GetterError = ErrorValue;
				g_Assert.throws(Operation.Run, (Caught) => Object.is(Caught, ErrorValue));
				g_Assert.equal(g_NativeSolidFlagCalls.GetterCount, 1);
				g_Assert.equal(g_NativeSolidFlagCalls.SetterCount, 0);
			}

			for (const Operation of vecOperations.filter((Entry) => Entry.Mutation)) {
				g_CollisionState.SolidFlags = 0;
				ResetSolidFlagCalls();
				g_NativeSolidFlagCalls.ThrowSetter = true;
				g_NativeSolidFlagCalls.SetterError = ErrorValue;
				g_Assert.throws(Operation.Run, (Caught) => Object.is(Caught, ErrorValue));
				g_Assert.equal(g_NativeSolidFlagCalls.GetterCount, 1);
				g_Assert.equal(g_NativeSolidFlagCalls.SetterCount, 1);
			}
		}

		g_Assert.equal(unCoercions, 0);
	} finally {
		RestoreState(Snapshot);
		ResetSolidFlagCalls();
	}
}

function ExecuteDocumentationBlock(strSource, unIndex, ModuleMap) {
	const Script = new g_VM.Script(`(function (require, console) {\n${strSource}\n})`, { filename: `entities-collisions.md:block-${unIndex + 1}` });
	const Callback = Script.runInNewContext({});
	const DocumentationRequire = (strModuleName) => {
		if (!Object.hasOwn(ModuleMap, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		return ModuleMap[strModuleName];
	};
	const DocumentationConsole = {
		log() {
			throw new Error("Collision documentation must use the typed logger.");
		},
	};
	Callback(DocumentationRequire, DocumentationConsole);
}

g_Assert.throws(() => ExecuteDocumentationBlock('console.log("must fail");', 0, {}), /Collision documentation must use the typed logger\./);

InstallDependency("internal/runtime.js", {
	GetModule(strModuleName) {
		if (strModuleName !== "entities/collisions") {
			throw new Error(`Native module is unavailable: ${strModuleName}`);
		}

		return g_NativeCollisions;
	},
});

delete require.cache[g_strCollisionsPath];

const g_OriginalResolveFilename = g_Module._resolveFilename;
g_Module._resolveFilename = function ResolveFilename(strRequest, Parent, bIsMain, Options) {
	if (strRequest === "internal/runtime") {
		return g_strRuntimePath;
	}

	return g_OriginalResolveFilename.call(this, strRequest, Parent, bIsMain, Options);
};

let g_Collisions;
try {
	g_Collisions = require(g_strCollisionsPath);
} finally {
	g_Module._resolveFilename = g_OriginalResolveFilename;
}

const g_EntityRecord = Entity(7);
const g_BaselineState = SnapshotState();

g_Assert.strictEqual(g_Collisions, g_NativeCollisions);
g_Assert.deepEqual(Object.keys(g_Collisions).sort(), g_vecExpectedExports.slice().sort());
VerifySolidFlagReadContract(g_Collisions, g_EntityRecord);
g_Assert.strictEqual(g_Collisions.CollisionGroup, g_CollisionGroup);
g_Assert.strictEqual(g_Collisions.SolidFlags, g_SolidFlags);
g_Assert.strictEqual(g_Collisions.SolidType, g_SolidType);
g_Assert.equal(typeof g_EntityRecord.Address, "bigint");
g_Assert.equal(g_Collisions.GetEntityCollisionGroup(g_EntityRecord), g_CollisionGroup.Player);
g_Assert.equal(g_Collisions.SetEntityCollisionGroup(g_EntityRecord, g_CollisionGroup.Interactive), true);
g_Assert.equal(g_Collisions.GetEntityCollisionGroup(g_EntityRecord), g_CollisionGroup.Interactive);
g_Assert.equal(g_Collisions.GetEntitySolidType(g_EntityRecord), g_SolidType.BoundingBox);
g_Assert.equal(g_Collisions.SetEntitySolidType(g_EntityRecord, g_SolidType.VPhysics), true);
g_Assert.equal(g_Collisions.GetEntitySolidType(g_EntityRecord), g_SolidType.VPhysics);
g_Assert.equal(g_Collisions.SetEntityCollisionEnabled(g_EntityRecord, false), true);
g_Assert.equal(g_Collisions.IsEntityCollisionEnabled(g_EntityRecord), false);
g_Assert.throws(() => g_Collisions.SetEntityCollisionEnabled(g_EntityRecord, 0), /boolean/);
g_Assert.throws(() => g_Collisions.AddEntitySolidFlags(g_EntityRecord, "1"), { name: "TypeError", message: "nSolidFlags must be an integer." });
g_Assert.throws(() => g_Collisions.HasEntitySolidFlags(g_EntityRecord, 1.5), { name: "TypeError", message: "nSolidFlags must be an integer." });

const g_unOriginalSolidFlags = g_CollisionState.SolidFlags;
g_CollisionState.SolidFlags = 0x00;
g_Assert.equal(g_Collisions.IsEntityCollisionEnabled(g_EntityRecord), true);
g_CollisionState.SolidFlags = g_unOriginalSolidFlags;
g_Assert.equal(g_Collisions.IsEntityCollisionEnabled(g_EntityRecord), false);

const g_unHighBitMask = 0x8000;
const g_unLowBitMask = 0x01;
const g_nAllBitsMask = ~0;

for (const nInvalidFlags of [-2_147_483_648, 0x10000]) {
	const Snapshot = SnapshotState();
	g_Assert.throws(() => g_Collisions.SetEntitySolidFlags(g_EntityRecord, nInvalidFlags), { name: "Error" });
	g_Assert.throws(() => g_Collisions.AddEntitySolidFlags(g_EntityRecord, nInvalidFlags), { name: "Error" });
	g_Assert.equal(g_Collisions.HasEntitySolidFlags(g_EntityRecord, nInvalidFlags), false);
	g_Assert.equal(g_Collisions.RemoveEntitySolidFlags(g_EntityRecord, nInvalidFlags), true);
	g_Assert.deepEqual(SnapshotState(), Snapshot, "out-of-field masks must not change native ushort fixture state");
}

g_Assert.equal(g_Collisions.SetEntitySolidFlags(g_EntityRecord, g_unHighBitMask), true);
g_Assert.equal(g_Collisions.HasEntitySolidFlags(g_EntityRecord, g_unHighBitMask), true);
g_Assert.equal(g_Collisions.AddEntitySolidFlags(g_EntityRecord, g_unLowBitMask), true);
g_Assert.equal(g_Collisions.GetEntitySolidFlags(g_EntityRecord), 0x8001);
g_Assert.equal(g_Collisions.RemoveEntitySolidFlags(g_EntityRecord, g_unHighBitMask), true);
g_Assert.equal(g_Collisions.GetEntitySolidFlags(g_EntityRecord), g_unLowBitMask);
g_Assert.equal(g_Collisions.RemoveEntitySolidFlags(g_EntityRecord, g_nAllBitsMask), true);
g_Assert.equal(g_Collisions.GetEntitySolidFlags(g_EntityRecord), 0x00);
g_CollisionState.SolidFlags = g_unOriginalSolidFlags;

const g_OriginalMinimumsView = g_Collisions.GetEntityCollisionMinimums(g_EntityRecord);
const g_OriginalMaximumsView = g_Collisions.GetEntityCollisionMaximums(g_EntityRecord);

g_Assert.equal(typeof g_OriginalMinimumsView.Address, "bigint");
g_Assert.equal(typeof g_OriginalMaximumsView.Address, "bigint");
g_Assert.deepEqual(g_Collisions.GetEntityCollisionBounds(g_EntityRecord), {
	Maximums: g_OriginalMaximumsView,
	Minimums: g_OriginalMinimumsView,
});
g_Assert.equal(g_Collisions.SetEntityCollisionBounds(g_EntityRecord, [-8, -8, 1], [8, 8, 64]), true);
g_Assert.strictEqual(g_Collisions.GetEntityCollisionMinimums(g_EntityRecord), g_OriginalMinimumsView);
g_Assert.strictEqual(g_Collisions.GetEntityCollisionMaximums(g_EntityRecord), g_OriginalMaximumsView);
g_Assert.deepEqual([g_OriginalMinimumsView.X, g_OriginalMinimumsView.Y, g_OriginalMinimumsView.Z], [-8, -8, 1]);
g_Assert.deepEqual([g_OriginalMaximumsView.X, g_OriginalMaximumsView.Y, g_OriginalMaximumsView.Z], [8, 8, 64]);

const g_Rules = new g_Collisions.CollisionRules(g_EntityRecord);
g_Rules.CollisionGroup = g_CollisionGroup.NPC;
g_Assert.equal(g_Rules.CollisionGroup, g_CollisionGroup.NPC);
g_Rules.CollisionEnabled = true;
g_Assert.equal(g_Rules.CollisionEnabled, true);
g_Rules.SolidType = g_SolidType.BoundingBox;
g_Assert.equal(g_Rules.SolidType, g_SolidType.BoundingBox);
g_Rules.SolidFlags = 0x00;
g_Rules.AddSolidFlags(g_SolidFlags.Trigger);
g_Assert.equal(g_Rules.HasSolidFlags(g_SolidFlags.Trigger), true);
g_Rules.RemoveSolidFlags(g_SolidFlags.Trigger);
g_Assert.equal(g_Rules.HasSolidFlags(g_SolidFlags.Trigger), false);
g_Assert.equal(g_Rules.SetEntityCollisionBounds([-4, -4, 0], [4, 4, 32]), true);
g_Assert.strictEqual(g_Rules.GetEntityCollisionBounds().Minimums, g_OriginalMinimumsView);
// These legacy facade spellings are intentional negative cases.
g_Assert.equal(Object.hasOwn(g_Collisions, "moduleName"), false);
g_Assert.equal(Object.hasOwn(g_Collisions, "default"), false);

RestoreState(g_BaselineState);

function VerifyWorldCollisionExample(Collisions) {
	const strExamplePath = g_Path.join(g_strProjectRoot, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecMatch = strExample.match(/\tLogResult\("entities\/collisions.CollisionRules",[\s\S]*?\r?\n\t}\);/);
	g_Assert.ok(vecMatch, "world collision callback must remain available");

	const RunExample = new Function("CollisionRules", "SolidFlags", "GetEntitiesByClassName", "LogResult", vecMatch[0]);
	for (const vecEntities of [[], [g_EntityRecord]]) {
		let Result = undefined;
		RunExample(Collisions.CollisionRules, Collisions.SolidFlags, () => vecEntities, (strLabel, Callback) => {
			g_Assert.equal(strLabel, "entities/collisions.CollisionRules");

			Result = Callback();
		});

		if (vecEntities.length === 0) {
			g_Assert.equal(Result, null);
			continue;
		}

		const Minimums = Collisions.GetEntityCollisionMinimums(g_EntityRecord);
		const Maximums = Collisions.GetEntityCollisionMaximums(g_EntityRecord);
		g_Assert.deepEqual(Result.Bounds.Minimums, [Minimums.X, Minimums.Y, Minimums.Z]);
		g_Assert.deepEqual(Result.Bounds.Maximums, [Maximums.X, Maximums.Y, Maximums.Z]);
		g_Assert.equal(Result.HasNotSolid, Collisions.HasEntitySolidFlags(g_EntityRecord, Collisions.SolidFlags.NotSolid));
	}
}

VerifyWorldCollisionExample(g_Collisions);

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
g_Assert.ok(!/not (?:itself a valid native setter input|returned live views)|(?:Returned `X\/Y\/Z` live views and `mathlib\.Vector` instances are not accepted)/.test(g_strDocumentation), "collision documentation must not reject valid live/getter-backed vector inputs");
g_Assert.ok(g_strDocumentation.includes("new Vector(-24, -24, 0)"), "collision documentation must demonstrate direct mathlib.Vector input");
g_Assert.ok(g_strDocumentation.includes("SetEntityCollisionBounds(g_EntityReference, g_LiveMinimums, g_LiveMaximums)"), "collision documentation must demonstrate direct live-vector input");

const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
const g_setExercisedExports = new Set();
const g_TrackedCollisions = TrackModule(g_Collisions, g_setExercisedExports);
const g_vecDocumentationLogRecords = [];
const g_DocumentationLoggers = {
	LogInfo(strMessage, LogRecord) {
		g_Assert.equal(strMessage, "%j", "Structured documentation logs must use the JSON format token.");
		g_Assert.equal(Object.keys(LogRecord)[0], "Operation", "Documentation logs must put operation first.");
		g_vecDocumentationLogRecords.push(JSON.parse(JSON.stringify(LogRecord)));
	},
};
const g_ModuleMap = {
	"entities/collisions": g_TrackedCollisions,
	"entities/entity": { Entity },
	loggers: g_DocumentationLoggers,
	mathlib: { Vector: DocumentationVector },
};

g_Assert.equal(g_vecDocumentationBlocks.length, 8);

for (const [unIndex, strSource] of g_vecDocumentationBlocks.entries()) {
	ExecuteDocumentationBlock(strSource, unIndex, g_ModuleMap);
}

g_Assert.deepEqual(g_vecDocumentationLogRecords, [
	{ Operation: "InspectCollisionExports", ExportCount: 24, Exports: g_vecExpectedExports.slice().sort() },
	{ Operation: "InspectCollisionConstants", CollisionGroups: Object.keys(g_CollisionGroup), SolidTypes: Object.keys(g_SolidType), SolidFlags: Object.keys(g_SolidFlags) },
	{ Operation: "InspectEntityCollision", Maximums: g_BaselineState.Maximums, Minimums: g_BaselineState.Minimums, CollisionGroup: g_BaselineState.Group, SolidType: g_BaselineState.SolidType, EntityIndex: 1, SolidFlags: g_BaselineState.SolidFlags },
	{ Operation: "InspectTemporaryCollisionGroup", CollisionGroup: g_CollisionGroup.PlayerMovement },
	{ Operation: "InspectTemporarySolidFlags", SolidFlags: g_SolidFlags.Trigger },
	{ Operation: "VerifyCollisionEnabledToggle", EntityIndex: 1 },
	{ Operation: "InspectTemporaryCollisionBounds", Height: 84 },
	{ Operation: "VerifyTemporaryCollisionRules", EntityIndex: 1 },
], "Every collision documentation block must emit its complete structured observation without raw native BigInt records.");

for (const strExportName of g_vecExpectedExports.filter((strName) => /^[A-Z]/.test(strName))) {
	g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not exercise ${strExportName}.`);
}

g_Assert.deepEqual(SnapshotState(), g_BaselineState);

delete require.cache[g_strCollisionsPath];

const g_NativeModuleError = new Error("Native entities/collisions module is unavailable.");
InstallDependency("internal/runtime.js", {
	GetModule() {
		throw g_NativeModuleError;
	},
});

const g_FinalResolveFilename = g_Module._resolveFilename;
g_Module._resolveFilename = function ResolveFilename(strRequest, Parent, bIsMain, Options) {
	if (strRequest === "internal/runtime") {
		return g_strRuntimePath;
	}

	return g_FinalResolveFilename.call(this, strRequest, Parent, bIsMain, Options);
};

try {
	g_Assert.throws(() => require(g_strCollisionsPath), (ErrorValue) => ErrorValue === g_NativeModuleError);
} finally {
	g_Module._resolveFilename = g_FinalResolveFilename;
}

console.log("[smoke] entities/collisions and documentation contracts passed with native doubles; native SDK execution not exercised");
