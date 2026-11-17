#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPhysicsPath = g_Path.join(g_strPackageRootPath, "physics.js");
const g_strMemoryPath = g_Path.join(g_strPackageRootPath, "memory.js");
const g_strPhysicsDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "physics.md");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_mapRegisteredTypes = new Map();
const g_vecNativeCalls = [];
const g_vecAppliedForces = [];

const g_OriginalModuleLoad = g_Module._load;

function LoadRuntimeModule(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	if (strRequestName === "memory") {
		return require(g_strMemoryPath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
}

function VerifyLocalLinks(strMarkdown) {
	const strProse = strMarkdown.replace(/```[\s\S]*?```/g, "");
	for (const vecLinkMatch of strProse.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strTarget = vecLinkMatch[1];
		if (/^(?:[a-z]+:|#)/i.test(strTarget)) {
			continue;
		}

		const strPathWithoutFragment = strTarget.split("#", 1)[0];
		const strResolvedPath = g_Path.resolve(g_Path.dirname(g_strPhysicsDocumentationPath), strPathWithoutFragment);
		g_Assert.ok(g_FileSystem.existsSync(strResolvedPath), `missing documentation target: ${strTarget}`);
	}
}

function GetHeadingAnchor(strHeading) {
	return strHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function VerifyContentsAnchors(strMarkdown) {
	const vecContents = strMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContents, "physics contents section");

	const vecDocumentedAnchors = [...vecContents[1].matchAll(/\]\(#([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	const vecSectionAnchors = [...strMarkdown.matchAll(/^## (.+)$/gm)].map((vecMatch) => GetHeadingAnchor(vecMatch[1])).filter((strAnchor) => strAnchor !== "contents");
	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "physics contents anchors");
}

function CreateVector(flX, flY, flZ) {
	return { X: flX, Y: flY, Z: flZ };
}

function CopyVector(Value) {
	return CreateVector(Value.X, Value.Y, Value.Z);
}

function AssignVector(Target, Value) {
	Target.X = Value.X;
	Target.Y = Value.Y;
	Target.Z = Value.Z;

	return Target;
}

function AddVector(Target, Value) {
	Target.X += Value.X;
	Target.Y += Value.Y;
	Target.Z += Value.Z;

	return Target;
}

function CreateAngle(flPitch, flYaw, flRoll) {
	return { Pitch: flPitch, Yaw: flYaw, Roll: flRoll };
}

function CopyAngle(Value) {
	return CreateAngle(Value.Pitch, Value.Yaw, Value.Roll);
}

function AssignAngle(Target, Value) {
	Target.Pitch = Value.Pitch;
	Target.Yaw = Value.Yaw;
	Target.Roll = Value.Roll;

	return Target;
}

function CreatePhysicsObject(unAddress, strName) {
	const State = {
		Asleep: false,
		CallbackFlags: 0x04,
		CollisionsEnabled: true,
		Contents: 0x01,
		DragEnabled: true,
		GameDataAddress: 0n,
		GameFlags: 0x02,
		GameIndex: 7,
		GravityEnabled: true,
		Hinged: false,
		Inertia: CreateVector(8, 9, 10),
		InverseInertia: CreateVector(0.125, 1 / 9, 0.1),
		Mass: 4,
		MassCenterLocalSpace: CreateVector(0, 0, 1),
		MaterialIndex: 3,
		MotionEnabled: true,
		Position: CreateVector(100, 200, 300),
		Angles: CreateAngle(0, 90, 0),
		LinearVelocity: CreateVector(10, 20, 30),
		AngularVelocity: CreateVector(1, 2, 3),
		SphereRadius: 16,
		Trigger: false,
	};

	const PhysicsObject = {
		Address: unAddress,
		Position: { Position: State.Position, Angles: State.Angles },
		Velocity: { LinearVelocity: State.LinearVelocity, AngularVelocity: State.AngularVelocity },
		Inertia: State.Inertia,
		InverseInertia: State.InverseInertia,
		MassCenterLocalSpace: State.MassCenterLocalSpace,

		IsStatic() {
			return false;
		},

		IsAsleep() {
			return State.Asleep;
		},

		IsTrigger() {
			return State.Trigger;
		},

		IsFluid() {
			return false;
		},

		IsHinged() {
			return State.Hinged;
		},

		IsCollisionEnabled() {
			return State.CollisionsEnabled;
		},

		IsGravityEnabled() {
			return State.GravityEnabled;
		},

		IsDragEnabled() {
			return State.DragEnabled;
		},

		IsMotionEnabled() {
			return State.MotionEnabled;
		},

		IsMoveable() {
			return State.MotionEnabled;
		},

		IsAttachedToConstraint(bExternalOnly = false) {
			return bExternalOnly ? false : State.Hinged;
		},

		GetName() {
			return strName;
		},

		EnableCollisions(bEnabled = true) {
			State.CollisionsEnabled = bEnabled;

			return true;
		},

		EnableGravity(bEnabled = true) {
			State.GravityEnabled = bEnabled;

			return true;
		},

		EnableDrag(bEnabled = true) {
			State.DragEnabled = bEnabled;

			return true;
		},

		EnableMotion(bEnabled = true) {
			State.MotionEnabled = bEnabled;

			return true;
		},

		SetAsleep(bAsleep = true) {
			State.Asleep = bAsleep;

			return true;
		},

		GetGameData() {
			return State.GameDataAddress;
		},

		SetGameData(unGameDataAddress) {
			State.GameDataAddress = unGameDataAddress;

			return true;
		},

		GetGameFlags() {
			return State.GameFlags;
		},

		SetGameFlags(unGameFlags) {
			State.GameFlags = unGameFlags;

			return true;
		},

		GetGameIndex() {
			return State.GameIndex;
		},

		SetGameIndex(unGameIndex) {
			State.GameIndex = unGameIndex;

			return true;
		},

		GetCallbackFlags() {
			return State.CallbackFlags;
		},

		SetCallbackFlags(unCallbackFlags) {
			State.CallbackFlags = unCallbackFlags;

			return true;
		},

		GetMass() {
			return State.Mass;
		},

		SetMass(flMass) {
			State.Mass = flMass;

			return true;
		},

		GetInverseMass() {
			return 1 / State.Mass;
		},

		GetMaterialIndex() {
			return State.MaterialIndex;
		},

		SetMaterialIndex(unMaterialIndex) {
			State.MaterialIndex = unMaterialIndex;

			return true;
		},

		GetContents() {
			return State.Contents;
		},

		SetContents(unContents) {
			State.Contents = unContents;

			return true;
		},

		GetSphereRadius() {
			return State.SphereRadius;
		},

		SetSphereRadius(flSphereRadius) {
			State.SphereRadius = flSphereRadius;

			return true;
		},

		GetEnergy() {
			return State.Mass * 12;
		},

		GetInertia() {
			return State.Inertia;
		},

		SetInertia(Value) {
			AssignVector(State.Inertia, Value);

			return true;
		},

		GetInverseInertia() {
			return State.InverseInertia;
		},

		GetMassCenterLocalSpace() {
			return State.MassCenterLocalSpace;
		},

		GetPosition() {
			return { Position: State.Position, Angles: State.Angles };
		},

		SetPosition(PositionOrOptions, Angles, bTeleport = false) {
			const Options = Object.hasOwn(PositionOrOptions, "Position") ? PositionOrOptions : { Position: PositionOrOptions, Angles, Teleport: bTeleport };
			AssignVector(State.Position, Options.Position);

			if (Options.Angles !== undefined) {
				AssignAngle(State.Angles, Options.Angles);
			}

			g_vecNativeCalls.push(["SetPosition", CopyVector(State.Position), CopyAngle(State.Angles), Options.Teleport === true]);

			return true;
		},

		GetVelocity() {
			return { LinearVelocity: State.LinearVelocity, AngularVelocity: State.AngularVelocity };
		},

		SetVelocity(LinearOrOptions, Angular) {
			const Options = (LinearOrOptions && Object.hasOwn(LinearOrOptions, "LinearVelocity")) ? LinearOrOptions : { LinearVelocity: LinearOrOptions, AngularVelocity: Angular };
			if (Options.LinearVelocity !== undefined) {
				AssignVector(State.LinearVelocity, Options.LinearVelocity);
			}

			if (Options.AngularVelocity !== undefined) {
				AssignVector(State.AngularVelocity, Options.AngularVelocity);
			}

			return true;
		},

		SetVelocityInstantaneous(LinearVelocity, AngularVelocity) {
			return this.SetVelocity(LinearVelocity, AngularVelocity);
		},

		AddVelocity(LinearVelocity, AngularVelocity) {
			if (LinearVelocity !== undefined) {
				AddVector(State.LinearVelocity, LinearVelocity);
			}

			if (AngularVelocity !== undefined) {
				AddVector(State.AngularVelocity, AngularVelocity);
			}

			return true;
		},

		ApplyForceCenter(Force) {
			g_vecAppliedForces.push({ Kind: "CENTER", Force: CopyVector(Force) });

			return true;
		},

		ApplyForceOffset(Force, WorldPosition) {
			g_vecAppliedForces.push({ Kind: "OFFSET", Force: CopyVector(Force), WorldPosition: CopyVector(WorldPosition) });

			return true;
		},

		ApplyTorqueCenter(Torque) {
			g_vecAppliedForces.push({ Kind: "TORQUE", Torque: CopyVector(Torque) });

			return true;
		},

		LocalToWorld(Value) {
			return CreateVector(Value.X + State.Position.X, Value.Y + State.Position.Y, Value.Z + State.Position.Z);
		},

		WorldToLocal(Value) {
			return CreateVector(Value.X - State.Position.X, Value.Y - State.Position.Y, Value.Z - State.Position.Z);
		},

		LocalToWorldVector(Value) {
			return CopyVector(Value);
		},

		WorldToLocalVector(Value) {
			return CopyVector(Value);
		},

		RecheckCollisionFilter() {
			g_vecNativeCalls.push(["RecheckCollisionFilter", unAddress]);

			return true;
		},

		RecheckContactPoints() {
			g_vecNativeCalls.push(["RecheckContactPoints", unAddress]);

			return true;
		},

		GetContactPoint() {
			return { Hit: true, Point: CopyVector(State.Position), Object: g_SecondaryPhysicsObject };
		},

		GetCollide() {
			return 0x7000n;
		},

		SetTrigger(bEnabled = true) {
			State.Trigger = bEnabled;

			return true;
		},

		SetHinged(AxisOrEnabled = 0) {
			State.Hinged = AxisOrEnabled !== false;

			return true;
		},

		OutputDebugInfo() {
			g_vecNativeCalls.push(["OutputDebugInfo", unAddress]);

			return true;
		},
	};

	return PhysicsObject;
}

const g_SecondaryPhysicsObject = CreatePhysicsObject(0x4001n, "secondary_prop_physics");
const g_PrimaryPhysicsObject = CreatePhysicsObject(0x4000n, "prop_physics");
const g_EnvironmentGravity = CreateVector(0, 0, -800);
const g_EnvironmentState = { AirDensity: 2, Gravity: g_EnvironmentGravity };

const g_PrimaryEnvironment = {
	Index: 0,
	Address: 0x3000n,
	Gravity: g_EnvironmentGravity,

	GetGravity() {
		return g_EnvironmentState.Gravity;
	},

	SetGravity(Value) {
		AssignVector(g_EnvironmentState.Gravity, Value);

		return true;
	},

	GetAirDensity() {
		return g_EnvironmentState.AirDensity;
	},

	SetAirDensity(flAirDensity) {
		g_EnvironmentState.AirDensity = flAirDensity;

		return true;
	},

	GetActiveObjectCount() {
		return 2;
	},

	ActiveObjects() {
		return [g_PrimaryPhysicsObject, g_SecondaryPhysicsObject];
	},

	GetActiveObjectByEntity(Entity) {
		return (Entity.Index === 1) ? g_PrimaryPhysicsObject : null;
	},

	GetNextFrameTime() {
		return 12.515;
	},

	IsInSimulation() {
		return true;
	},

	GetSimulationTime() {
		return 12.5;
	},

	GetSimulationTimestep() {
		return 0.015;
	},
};

function CreatePhysicsInterface(unAddress = 0x2000n) {
	return {
		Address: unAddress,

		GetActiveEnvironmentByIndex(unIndex = 0) {
			g_vecNativeCalls.push(["Interface.GetActiveEnvironmentByIndex", unAddress, unIndex]);

			return (unIndex === 0) ? g_PrimaryEnvironment : null;
		},
	};
}

function CreateEnvironmentFromAddress(unAddress, nEnvironmentIndex = -1) {
	if (unAddress === g_PrimaryEnvironment.Address) {
		return g_PrimaryEnvironment;
	}

	return { ...g_PrimaryEnvironment, Index: nEnvironmentIndex, Address: unAddress };
}

function ResolvePhysicsObject(Value) {
	if ((Value === g_PrimaryPhysicsObject) || (Value === g_SecondaryPhysicsObject)) {
		return Value;
	}

	if (Value === g_PrimaryPhysicsObject.Address) {
		return g_PrimaryPhysicsObject;
	}

	if (Value === g_SecondaryPhysicsObject.Address) {
		return g_SecondaryPhysicsObject;
	}

	return null;
}

const g_PrimaryInterface = CreatePhysicsInterface();

const g_NativePhysics = {
	Gravity() {
		return 800;
	},

	get Interface() {
		return g_PrimaryInterface;
	},

	InterfaceFromAddress(unAddress) {
		g_vecNativeCalls.push(["InterfaceFromAddress", unAddress]);

		return (unAddress === g_PrimaryInterface.Address) ? g_PrimaryInterface : CreatePhysicsInterface(unAddress);
	},

	GetActiveEnvironmentByIndex(unIndex = 0, bRequired = false) {
		g_vecNativeCalls.push(["GetActiveEnvironmentByIndex", unIndex, bRequired]);

		const Environment = (unIndex === 0) ? g_PrimaryEnvironment : null;
		if ((Environment === null) && bRequired) {
			throw new Error("native physics environment is not active");
		}

		return Environment;
	},

	EnvironmentFromAddress(unAddress, nEnvironmentIndex = -1) {
		g_vecNativeCalls.push(["EnvironmentFromAddress", unAddress, nEnvironmentIndex]);

		return CreateEnvironmentFromAddress(unAddress, nEnvironmentIndex);
	},

	Object(Value, bRequired = false) {
		g_vecNativeCalls.push(["Object", Value, bRequired]);

		const PhysicsObject = ResolvePhysicsObject(Value);
		if ((PhysicsObject === null) && bRequired) {
			throw new Error("native physics object is not available");
		}

		return PhysicsObject;
	},

	ObjectFromAddress(unAddress) {
		g_vecNativeCalls.push(["ObjectFromAddress", unAddress]);

		return ResolvePhysicsObject(unAddress);
	},

	ObjectByEntity(Entity, unListIndex = 0) {
		g_vecNativeCalls.push(["ObjectByEntity", Entity, unListIndex]);

		return ((Entity.Index === 1) && (unListIndex === 0)) ? g_PrimaryPhysicsObject : null;
	},

	ObjectsByEntity(Entity) {
		g_vecNativeCalls.push(["ObjectsByEntity", Entity]);

		return (Entity.Index === 1) ? [g_PrimaryPhysicsObject, g_SecondaryPhysicsObject] : [];
	},
};

function Entity(unIndex) {
	return { Index: unIndex, Address: 0x1000n + BigInt(unIndex) };
}

function RunDocumentationFunction(Callback, Receiver, vecArguments, strLabel) {
	const unScriptTimeoutMilliseconds = 1000;
	const Script = new g_VM.Script("Reflect.apply(Callback, Receiver, Arguments)", { filename: `${g_strPhysicsDocumentationPath}:${strLabel}` });

	// Bounds synchronous JavaScript, not native IO; this is not an untrusted-code sandbox.
	return Script.runInNewContext({ Callback, Receiver, Arguments: vecArguments }, { timeout: unScriptTimeoutMilliseconds });
}

function CheckDocumentationRestorationFailures(strDocumentation) {
	const strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "V8Runtime.cpp"), "utf8");
	const vecUnloadDefinition = strRuntimeSource.match(/^\tvoid V8Runtime::UnloadPlugin\([^\r\n]*\) \{[\s\S]*?^\t}/m);
	g_Assert.ok(vecUnloadDefinition, "Native plugin unload definition");
	g_Assert.match(vecUnloadDefinition[0], /CallPluginExportFunction\(strPluginName,\s*"Unload"\)/, "Physics documentation must follow the exact current native unload export key");

	const strReviewedExamples = strDocumentation.split("## Resolving entity objects")[0];
	const vecExamples = [...strReviewedExamples.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, 5, "reviewed physics C1 example inventory");

	const vecScenarios = [];
	for (const strKind of ["LOWGRAVITY", "GRAVITYPROPERTY", "AIRDENSITY"]) {
		for (const strFault of [
			"SUCCESS",
			"VERIFYTHROW",
			"VERIFYNULL",
			"RESTORETHROW",
			"BOTHTHROW",
			"NULLBOTHTHROW",
			"VERIFYMISMATCH",
		]) {
			vecScenarios.push({ Kind: strKind, Fault: strFault });
		}

		if (strKind !== "GRAVITYPROPERTY") {
			for (const strFault of ["APPLYFALSE", "APPLYTHROW", "RESTOREFALSE", "APPLYANDRESTOREFALSE"]) {
				vecScenarios.push({ Kind: strKind, Fault: strFault });
			}
		}
	}

	vecScenarios.push({ Kind: "AIRDENSITY", Fault: "SUCCESS", InitialAirDensity: Math.fround(2 ** -149) });

	for (const Scenario of vecScenarios) {
		const strKind = Scenario.Kind;
		const strFault = Scenario.Fault;
		const strLabel = `${strKind}/${strFault}`;
		const OperationError = new Error(`${strLabel} operation`);
		const RestorationError = new Error(`${strLabel} restoration`);
		const bNullOperation = (strFault === "VERIFYNULL") || (strFault === "NULLBOTHTHROW");
		const bOperationThrows = (strFault === "VERIFYTHROW") || (strFault === "BOTHTHROW") || bNullOperation || (strFault === "APPLYTHROW");
		const bOperationGeneratesError = (strFault === "APPLYFALSE") || (strFault === "APPLYANDRESTOREFALSE") || (strFault === "VERIFYMISMATCH");
		const bRestorationThrows = (strFault === "RESTORETHROW") || (strFault === "BOTHTHROW") || (strFault === "NULLBOTHTHROW");
		const bRestorationGeneratesError = (strFault === "RESTOREFALSE") || (strFault === "APPLYANDRESTOREFALSE");
		const bOperationFails = bOperationThrows || bOperationGeneratesError;
		const bRestorationFails = bRestorationThrows || bRestorationGeneratesError;
		const flInitialAirDensity = Scenario.InitialAirDensity ?? 2;
		const State = { Gravity: { X: 11, Y: 22, Z: -800 }, AirDensity: flInitialAirDensity };
		let unWriteCount = 0;

		function BeginWrite() {
			++unWriteCount;
			if ((unWriteCount > 1) && bRestorationThrows) {
				throw RestorationError;
			}

			return !((unWriteCount > 1) && bRestorationGeneratesError);
		}

		function FinishWrite() {
			if ((unWriteCount === 1) && (strFault === "APPLYTHROW")) {
				throw OperationError;
			}

			return !((unWriteCount === 1) && ((strFault === "APPLYFALSE") || (strFault === "APPLYANDRESTOREFALSE")));
		}

		function ReadVerificationValue(flValue) {
			if (unWriteCount === 1) {
				if (bNullOperation) {
					throw null;
				}

				if ((strFault === "VERIFYTHROW") || (strFault === "BOTHTHROW")) {
					throw OperationError;
				}

				if (strFault === "VERIFYMISMATCH") {
					return flValue + 1;
				}
			}

			return flValue;
		}

		const Gravity = {};
		// Property-assignment scenarios never inject false statuses; write failures are thrown.
		Object.defineProperties(Gravity, {
			X: { get: () => State.Gravity.X },
			Y: { get: () => State.Gravity.Y },
			Z: {
				get: () => ReadVerificationValue(State.Gravity.Z),

				set: (flValue) => {
					if (!BeginWrite()) {
						return;
					}

					State.Gravity.Z = Math.fround(flValue);
					FinishWrite();
				},
			},
		});

		const Environment = {
			Gravity,

			SetGravity(Vector) {
				if (!BeginWrite()) {
					return false;
				}

				State.Gravity = { X: Math.fround(Vector.X), Y: Math.fround(Vector.Y), Z: Math.fround(Vector.Z) };

				return FinishWrite();
			},

			GetGravity: () => Gravity,

			GetAirDensity: () => ReadVerificationValue(State.AirDensity),

			SetAirDensity(flValue) {
				if (!BeginWrite()) {
					return false;
				}

				State.AirDensity = Math.fround(flValue);

				return FinishWrite();
			},

			ActiveObjects: () => [],

			GetActiveObjectCount: () => 0,

			GetSimulationTime: () => 1,

			GetSimulationTimestep: () => Math.fround(0.01),
		};

		const PhysicsAPI = {
			GetActivePhysicsEnvironmentByIndex: () => Environment,

			PhysicsEnvironment: function PhysicsEnvironment() {
				return Environment;
			},
		};

		const DocumentationRequire = (strModuleName) => {
			g_Assert.equal(strModuleName, "physics", strLabel);

			return PhysicsAPI;
		};

		const unExampleIndex = (strKind === "LOWGRAVITY") ? 2 : ((strKind === "GRAVITYPROPERTY") ? 3 : 4);
		const ExecuteDocumentation = g_VM.compileFunction(`"use strict";\n${vecExamples[unExampleIndex]}`, ["require", "module"], { filename: `${g_strPhysicsDocumentationPath}:${strLabel}` });
		const DocumentationModule = { exports: {} };
		let bExecutionFailed = false;
		let ExecutionErrorValue = null;

		try {
			RunDocumentationFunction(ExecuteDocumentation, undefined, [DocumentationRequire, DocumentationModule], `${strLabel}:initialize`);

			if (strKind === "LOWGRAVITY") {
				g_Assert.equal(typeof DocumentationModule.exports.Unload, "function", "The low-gravity example must export the native unload entry point");
				g_Assert.equal(Object.hasOwn(DocumentationModule.exports, "unload"), false, "No lowercase lifecycle alias");
			}

			if (typeof DocumentationModule.exports.Unload === "function") {
				RunDocumentationFunction(DocumentationModule.exports.Unload, DocumentationModule.exports, [], `${strLabel}:unload`);
			}
		} catch (ExecutionError) {
			bExecutionFailed = true;
			ExecutionErrorValue = ExecutionError;
		}

		g_Assert.equal(bExecutionFailed, bOperationFails || bRestorationFails, strLabel);

		const vecExpectedErrors = [];
		if (bOperationFails) {
			vecExpectedErrors.push((bOperationGeneratesError || bNullOperation) ? null : OperationError);
		}

		if (bRestorationFails) {
			vecExpectedErrors.push(bRestorationGeneratesError ? null : RestorationError);
		}

		if (bOperationFails && bRestorationFails) {
			g_Assert.ok(ExecutionErrorValue instanceof AggregateError, strLabel);
		}

		const vecActualErrors = (bOperationFails && bRestorationFails) ? ExecutionErrorValue.errors : (bExecutionFailed ? [ExecutionErrorValue] : []);
		const strOperationMessage = (strKind === "LOWGRAVITY") ? "The low-gravity setting was not applied." : ((strKind === "GRAVITYPROPERTY") ? "The live gravity property did not write through to VPhysics." : "The temporary air density was not applied.");
		const strRestorationMessage = (strKind === "LOWGRAVITY") ? (bOperationFails ? "The original gravity vector could not be restored after initialization failed." : "The original gravity vector could not be restored.") : "The original air density could not be restored.";

		g_Assert.equal(vecActualErrors.length, vecExpectedErrors.length, strLabel);
		for (let unErrorIndex = 0; unErrorIndex < vecExpectedErrors.length; ++unErrorIndex) {
			const bGeneratedError = ((unErrorIndex === 0) && bOperationFails) ? bOperationGeneratesError : bRestorationGeneratesError;
			if (bGeneratedError) {
				const bOperationError = (unErrorIndex === 0) && bOperationFails;
				const strExpectedMessage = bOperationError ? strOperationMessage : strRestorationMessage;
				g_Assert.equal(vecActualErrors[unErrorIndex].message, strExpectedMessage, strLabel);

			} else {
				g_Assert.equal(vecActualErrors[unErrorIndex], vecExpectedErrors[unErrorIndex], `${strLabel}: preserve thrown identity, including null`);
			}
		}

		g_Assert.equal(unWriteCount, 2, `${strLabel}: one operation and one restoration attempt`);

		if (!bRestorationFails) {
			g_Assert.deepEqual(State.Gravity, { X: 11, Y: 22, Z: -800 }, strLabel);
			g_Assert.equal(State.AirDensity, flInitialAirDensity, strLabel);
		}
	}

	g_Assert.equal(vecScenarios.length, 30, "restoration scenarios, including native-float subnormal readback");
}

function CheckDocumentationObjectRestorationFailures(strDocumentation) {
	const strReviewedExamples = strDocumentation.split(/^## Forces [^\r\n]+$/m)[0];
	const vecExamples = [...strReviewedExamples.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, 10, "reviewed physics C1 and C2 example inventory");

	const vecMassFields = [
		"Mass",
		"MaterialIndex",
		"Contents",
		"GameFlags",
		"GameIndex",
		"CallbackFlags",
		"GameData",
		"Inertia",
	];
	const vecScenarios = [];
	for (const strKind of ["MASS", "COMPONENTS", "METHODS"]) {
		for (const strFault of [
			"SUCCESS",
			"OPERATIONTHROW",
			"OPERATIONNULL",
			"CLEANUPALLTHROW",
			"OPERATIONANDCLEANUPALLTHROW",
			"NULLANDCLEANUPALLTHROW",
		]) {
			vecScenarios.push({ Kind: strKind, Fault: strFault });
		}

		if (strKind !== "COMPONENTS") {
			vecScenarios.push({ Kind: strKind, Fault: "OPERATIONFALSE" });
		}

		const unRestoreCount = (strKind === "MASS") ? 8 : 2;
		for (let unRestoreIndex = 0; unRestoreIndex < unRestoreCount; ++unRestoreIndex) {
			vecScenarios.push({ Kind: strKind, Fault: "CLEANUPONETHROW", RestoreIndex: unRestoreIndex });
			vecScenarios.push({ Kind: strKind, Fault: "NULLANDCLEANUPONETHROW", RestoreIndex: unRestoreIndex });

			if (strKind !== "COMPONENTS") {
				vecScenarios.push({ Kind: strKind, Fault: "CLEANUPONEFALSE", RestoreIndex: unRestoreIndex });
			}
		}
	}

	vecScenarios.push({ Kind: "MASS", Fault: "SUCCESS", LargeFloat: true });
	vecScenarios.push({ Kind: "COMPONENTS", Fault: "SUCCESS", LargeFloat: true });

	for (const Scenario of vecScenarios) {
		const strKind = Scenario.Kind;
		const strFault = Scenario.Fault;
		const strLabel = `${strKind}/${strFault}/${Scenario.RestoreIndex ?? "ALL"}`;
		const OperationError = new Error(`${strLabel} operation`);
		const bNullOperation = strFault.startsWith("NULL") || (strFault === "OPERATIONNULL");
		const bOperationGeneratesError = strFault === "OPERATIONFALSE";
		const bOperationFails = bNullOperation || bOperationGeneratesError || (strFault === "OPERATIONTHROW") || (strFault === "OPERATIONANDCLEANUPALLTHROW");
		const bCleanupFails = strFault.includes("CLEANUP");
		const bCleanupAll = strFault.includes("CLEANUPALL");
		const bCleanupFalse = strFault === "CLEANUPONEFALSE";
		const vecCleanupFields = (strKind === "MASS") ? vecMassFields : ((strKind === "COMPONENTS") ? ["PositionZ", "LinearZ"] : ["Velocity", "Position"]);
		const vecCleanupErrors = vecCleanupFields.map((strFieldName) => new Error(`${strLabel}/${strFieldName}`));
		const vecAttemptedRestorations = [];
		const Initial = {
			Mass: Scenario.LargeFloat ? Math.fround((2 ** 30) + 128) : 5,
			MaterialIndex: 3,
			Contents: 0x0C,
			GameFlags: 0x04,
			GameIndex: 9,
			CallbackFlags: 0x02,
			GameData: 0xFEDCBA9876543210n,
			Inertia: { X: Scenario.LargeFloat ? Math.fround((2 ** 30) + 128) : 9, Y: 17, Z: 23 },
			Position: { X: 1, Y: 2, Z: Scenario.LargeFloat ? Math.fround(2 ** 30) : 3 },
			Angles: { Pitch: 4, Yaw: 5, Roll: 6 },
			LinearVelocity: { X: 7, Y: 8, Z: 9 },
			AngularVelocity: { X: 10, Y: 11, Z: 12 },
		};

		const State = structuredClone(Initial);
		const vecOperationWrites = [];
		const unOperationWriteCount = (strKind === "MASS") ? 8 : ((strKind === "COMPONENTS") ? 2 : 4);
		let bRestoring = false;

		function BeginWrite(strFieldName) {
			if (bRestoring) {
				const unRestoreIndex = vecAttemptedRestorations.length;
				vecAttemptedRestorations.push(strFieldName);

				if (bCleanupFails && (bCleanupAll || (Scenario.RestoreIndex === unRestoreIndex))) {
					if (bCleanupFalse) {
						return false;
					}

					throw vecCleanupErrors[unRestoreIndex];
				}

				return true;
			}

			vecOperationWrites.push(strFieldName);

			if (bOperationFails) {
				bRestoring = true;

				if (bOperationGeneratesError) {
					return false;
				}

				if (bNullOperation) {
					throw null;
				}

				throw OperationError;
			}

			if (vecOperationWrites.length === unOperationWriteCount) {
				bRestoring = true;
			}

			return true;
		}

		const PhysicsObject = {};
		for (const strFieldName of vecMassFields) {
			PhysicsObject["Get" + strFieldName] = () => State[strFieldName];

			PhysicsObject["Set" + strFieldName] = (Value) => {
				if (!BeginWrite(strFieldName)) {
					return false;
				}

				State[strFieldName] = (strFieldName === "Mass") ? Math.fround(Value) : ((strFieldName === "Inertia") ? { X: Math.fround(Value.X), Y: Math.fround(Value.Y), Z: Math.fround(Value.Z) } : Value);

				return true;
			};
		}

		PhysicsObject.GetInverseInertia = () => ({ X: 1, Y: 2, Z: 3 });

		PhysicsObject.GetMassCenterLocalSpace = () => ({ X: 4, Y: 5, Z: 6 });

		// Component-property scenarios inject thrown failures, never false statuses; assignments have no status result.
		const Position = { X: Initial.Position.X, Y: Initial.Position.Y };
		const LinearVelocity = { X: Initial.LinearVelocity.X, Y: Initial.LinearVelocity.Y };
		Object.defineProperty(Position, "Z", {
			get: () => State.Position.Z,

			set: (flValue) => {
				BeginWrite("PositionZ");
				State.Position.Z = Math.fround(flValue);
			},
		});

		Object.defineProperty(LinearVelocity, "Z", {
			get: () => State.LinearVelocity.Z,

			set: (flValue) => {
				BeginWrite("LinearZ");
				State.LinearVelocity.Z = Math.fround(flValue);
			},
		});

		PhysicsObject.Position = { Position, Angles: State.Angles };
		PhysicsObject.Velocity = { LinearVelocity, AngularVelocity: State.AngularVelocity };

		PhysicsObject.GetPosition = () => ({ Position: State.Position, Angles: State.Angles });

		PhysicsObject.GetVelocity = () => ({ LinearVelocity: State.LinearVelocity, AngularVelocity: State.AngularVelocity });

		PhysicsObject.SetPosition = (PositionVector, Angles) => {
			if (!BeginWrite("Position")) {
				return false;
			}

			State.Position = { X: Math.fround(PositionVector.X), Y: Math.fround(PositionVector.Y), Z: Math.fround(PositionVector.Z) };
			State.Angles = structuredClone(Angles);

			return true;
		};

		const SetVelocity = (LinearVector, AngularVector) => {
			if (!BeginWrite("Velocity")) {
				return false;
			}

			State.LinearVelocity = structuredClone(LinearVector);
			State.AngularVelocity = structuredClone(AngularVector);

			return true;
		};

		PhysicsObject.SetVelocity = SetVelocity;
		PhysicsObject.SetVelocityInstantaneous = SetVelocity;

		PhysicsObject.AddVelocity = (Vector) => {
			if (!BeginWrite("Velocity")) {
				return false;
			}

			State.LinearVelocity.X += Vector.X;
			State.LinearVelocity.Y += Vector.Y;
			State.LinearVelocity.Z += Vector.Z;

			return true;
		};

		const EntityValue = { Index: 1, Address: 0x77770000n };

		const DocumentationRequire = (strModuleName) => {
			if (strModuleName === "entities/entity") {
				return { Entity: () => EntityValue };
			}

			g_Assert.equal(strModuleName, "physics", strLabel);

			return {
				GetEntityPhysicsObject(Entity) {
					g_Assert.equal(Entity, EntityValue, `${strLabel}: use entity lookup, not direct physics-address resolution`);

					return PhysicsObject;
				},
			};
		};

		const unExampleIndex = (strKind === "MASS") ? 7 : ((strKind === "COMPONENTS") ? 8 : 9);
		const ExecuteDocumentation = g_VM.compileFunction(`"use strict";\n${vecExamples[unExampleIndex]}`, ["require", "module"], { filename: `${g_strPhysicsDocumentationPath}:${strLabel}` });
		let bExecutionFailed = false;
		let ExecutionErrorValue = null;

		try {
			RunDocumentationFunction(ExecuteDocumentation, undefined, [DocumentationRequire, { exports: {} }], `${strLabel}:initialize`);
		} catch (ExecutionError) {
			bExecutionFailed = true;
			ExecutionErrorValue = ExecutionError;
		}

		g_Assert.equal(bExecutionFailed, bOperationFails || bCleanupFails, strLabel);
		g_Assert.deepEqual(vecAttemptedRestorations, vecCleanupFields, `${strLabel}: every restoration attempted exactly once, including after failure`);
		g_Assert.equal(vecOperationWrites.length, bOperationFails ? 1 : unOperationWriteCount, strLabel);

		if (bCleanupFails) {
			g_Assert.ok(ExecutionErrorValue instanceof AggregateError, strLabel);

			const vecExpectedErrors = bOperationFails ? [bNullOperation ? null : OperationError] : [];
			for (let unRestoreIndex = 0; unRestoreIndex < vecCleanupFields.length; ++unRestoreIndex) {
				if (bCleanupAll || (Scenario.RestoreIndex === unRestoreIndex)) {
					if (bCleanupFalse) {
						const strMessage = (strKind === "MASS") ? `The original ${vecCleanupFields[unRestoreIndex]} property could not be restored.` : ((unRestoreIndex === 0) ? "The original physics-object velocity could not be restored." : "The original physics-object position could not be restored.");
						g_Assert.equal(ExecutionErrorValue.errors[vecExpectedErrors.length].message, strMessage, strLabel);
						vecExpectedErrors.push(ExecutionErrorValue.errors[vecExpectedErrors.length]);

					} else {
						vecExpectedErrors.push(vecCleanupErrors[unRestoreIndex]);
					}
				}
			}

			g_Assert.deepEqual(ExecutionErrorValue.errors, vecExpectedErrors, strLabel);

		} else {
			if (bOperationGeneratesError) {
				const strMessage = (strKind === "MASS") ? "The Mass property could not be updated." : "The physics-object position could not be changed.";
				g_Assert.equal(ExecutionErrorValue.message, strMessage, strLabel);

			} else if (bOperationFails) {
				g_Assert.equal(ExecutionErrorValue, bNullOperation ? null : OperationError, strLabel);
			}

			g_Assert.deepEqual(State, Initial, `${strLabel}: all captured fields restored`);
		}
	}

	g_Assert.equal(vecScenarios.length, 56, "object restoration scenarios");
}

function CheckDocumentationPhysicsStateFailures(strDocumentation) {
	const strReviewedExamples = strDocumentation.split(/^## Forces [^\r\n]+$/m)[1];
	const vecExamples = [...strReviewedExamples.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, 4, "reviewed physics C3 example inventory");

	const vecForceMethods = ["ApplyForceCenter", "ApplyForceOffset", "ApplyTorqueCenter"];
	const vecForceScenarios = [
		{ Fault: "SUCCESS" },
		{ Fault: "TRANSFORMMISMATCH" },
		{ Fault: "SMALLTRANSFORMDIFFERENCE" },
	];
	for (let unIndex = 0; unIndex < vecForceMethods.length; ++unIndex) {
		for (const strFault of ["FALSE", "THROW", "NULL"]) {
			vecForceScenarios.push({ Fault: strFault, Index: unIndex });
		}
	}

	for (const Scenario of vecForceScenarios) {
		const vecAttempts = [];
		const Position = { X: 2, Y: 3, Z: 4 };
		const OperationError = new Error("impulse operation");
		const PhysicsObject = {
			GetPosition: () => ({ Position }),

			WorldToLocal: (Value) => ({ X: Value.X, Y: Value.Y, Z: Value.Z }),

			LocalToWorld: (Value) => ({ X: Value.X, Y: Value.Y, Z: Value.Z + ((Scenario.Fault === "TRANSFORMMISMATCH") ? 0.001 : ((Scenario.Fault === "SMALLTRANSFORMDIFFERENCE") ? 0.00001 : 0)) }),

			WorldToLocalVector: (Value) => ({ ...Value }),

			LocalToWorldVector: (Value) => ({ ...Value }),
		};
		for (const vecMethodEntry of vecForceMethods.entries()) {
			const unIndex = vecMethodEntry[0];
			const strMethodName = vecMethodEntry[1];
			PhysicsObject[strMethodName] = (Impulse, WorldPosition) => {
				const vecExpectedImpulses = [
					{ X: 0, Y: 0, Z: 5000 },
					{ X: 1000, Y: 0, Z: 0 },
					{ X: 0, Y: 0, Z: 200 },
				];
				g_Assert.deepEqual(Impulse, vecExpectedImpulses[unIndex], "impulse example arguments");
				vecAttempts.push(strMethodName);

				if (strMethodName === "ApplyForceOffset") {
					g_Assert.deepEqual(WorldPosition, { X: 2, Y: 3, Z: 20 }, "offset uses a detached center snapshot despite an earlier impulse");
				}

				Position.Z += 10;

				if (Scenario.Index === unIndex) {
					if (Scenario.Fault === "THROW") {
						throw OperationError;
					}

					if (Scenario.Fault === "NULL") {
						throw null;
					}

					return false;
				}

				return true;
			};
		}

		const TestEntity = { Address: 0x77770000n };

		const DocumentationRequire = (strName) => {
			g_Assert.equal(strName, "physics", "impulse documentation import");

			const GetEntityPhysicsObject = (EntityValue) => {
				g_Assert.equal(EntityValue, TestEntity, "impulse example resolves the supplied entity");

				return PhysicsObject;
			};

			return { GetEntityPhysicsObject };
		};

		const strLabel = `force/${Scenario.Fault}/${Scenario.Index ?? "ALL"}`;
		const Execute = g_VM.compileFunction(`"use strict";\n${vecExamples[0]}\nreturn ApplyForcesToTestPhysicsObject;`, ["require"], { filename: `${g_strPhysicsDocumentationPath}:${strLabel}` });
		const ApplyImpulses = RunDocumentationFunction(Execute, undefined, [DocumentationRequire], `${strLabel}:initialize`);
		let bCaught = false;
		let ErrorValue = null;

		try {
			RunDocumentationFunction(ApplyImpulses, undefined, [TestEntity], `${strLabel}:apply`);
		} catch (CaughtError) {
			bCaught = true;
			ErrorValue = CaughtError;
		}

		const bFails = (Scenario.Index !== undefined) || (Scenario.Fault === "TRANSFORMMISMATCH");
		g_Assert.equal(bCaught, bFails, `impulse ${Scenario.Fault}: failure visibility`);

		const unExpectedAttempts = (Scenario.Fault === "TRANSFORMMISMATCH") ? 0 : ((Scenario.Index !== undefined) ? (Scenario.Index + 1) : 3);
		g_Assert.deepEqual(vecAttempts, vecForceMethods.slice(0, unExpectedAttempts), "failed impulse stops later operations without pretending to undo earlier impulses");

		if (Scenario.Fault === "THROW") {
			g_Assert.equal(ErrorValue, OperationError, "impulse exception identity");
		}

		if (Scenario.Fault === "NULL") {
			g_Assert.equal(ErrorValue, null, "impulse null exception identity");
		}
	}

	const vecCollisionFields = ["Collision", "Gravity", "Drag", "Motion", "Asleep"];
	const vecScenarios = [];
	for (const strKind of ["COLLISION", "TRIGGER"]) {
		const vecFields = (strKind === "COLLISION") ? vecCollisionFields : ["Trigger", "Hinged"];
		for (const strFault of [
			"SUCCESS",
			"OPERATIONTHROW",
			"OPERATIONNULL",
			"CLEANUPALLTHROW",
			"BOTHALLTHROW",
			"NULLBOTHALLTHROW",
		]) {
			vecScenarios.push({ Kind: strKind, Fault: strFault });
		}

		for (let unIndex = 0; unIndex < vecFields.length; ++unIndex) {
			for (const strFault of [
				"INVALIDPREVIOUS",
				"PREVIOUSGETTERTHROW",
				"OPERATIONFALSE",
				"CLEANUPTHROW",
				"CLEANUPFALSE",
				"CLEANUPREADBACKMISMATCH",
				"CLEANUPREADBACKTHROW",
			]) {
				vecScenarios.push({ Kind: strKind, Fault: strFault, Index: unIndex });
			}

			if ((strKind === "COLLISION") && (unIndex < 4)) {
				vecScenarios.push({ Kind: strKind, Fault: "MISSINGGETTER", Index: unIndex });
				vecScenarios.push({ Kind: strKind, Fault: "MISSINGSETTER", Index: unIndex });
			}
		}
	}

	vecScenarios.push({ Kind: "TRIGGER", Fault: "SUCCESS", AlreadyHinged: true });
	vecScenarios.push({ Kind: "TRIGGER", Fault: "SUCCESS", AlreadyTrigger: true });

	for (const Scenario of vecScenarios) {
		const bCollision = Scenario.Kind === "COLLISION";
		const vecFields = bCollision ? vecCollisionFields : ["Trigger", "Hinged"];
		const vecGetters = bCollision ? ["IsCollisionEnabled", "IsGravityEnabled", "IsDragEnabled", "IsMotionEnabled", "IsAsleep"] : ["IsTrigger", "IsHinged"];
		const vecSetters = bCollision ? ["EnableCollisions", "EnableGravity", "EnableDrag", "EnableMotion", "SetAsleep"] : ["SetTrigger", "SetHinged"];
		const Initial = bCollision ? { Collision: false, Gravity: false, Drag: false, Motion: false, Asleep: true } : { Trigger: !!Scenario.AlreadyTrigger, Hinged: !!Scenario.AlreadyHinged };
		const State = { ...Initial };
		const vecRestorationAttempts = [];
		const vecOperationAttempts = [];
		const vecCleanupErrors = vecFields.map((strField) => new Error(`restore ${strField}`));
		const OperationError = new Error("state operation");
		const bPreconditionFails = ["INVALIDPREVIOUS", "PREVIOUSGETTERTHROW", "MISSINGSETTER"].includes(Scenario.Fault);
		const bOriginalNull = (Scenario.Fault === "OPERATIONNULL") || (Scenario.Fault === "NULLBOTHALLTHROW");
		const bOperationThrows = bOriginalNull || (Scenario.Fault === "OPERATIONTHROW") || (Scenario.Fault === "BOTHALLTHROW");
		const bCleanupAll = Scenario.Fault.includes("ALLTHROW");
		const vecExpectedCleanupErrors = [];
		const PhysicsObject = {};
		for (const vecFieldEntry of vecFields.entries()) {
			const unIndex = vecFieldEntry[0];
			const strField = vecFieldEntry[1];
			let bRestorationReadback = false;

			PhysicsObject[vecGetters[unIndex]] = () => {
				if ((Scenario.Index === unIndex) && bRestorationReadback) {
					if (Scenario.Fault === "CLEANUPREADBACKTHROW") {
						throw vecCleanupErrors[unIndex];
					}

					if (Scenario.Fault === "CLEANUPREADBACKMISMATCH") {
						return !Initial[strField];
					}
				}

				if ((Scenario.Index === unIndex) && (vecOperationAttempts.length === 0)) {
					if (Scenario.Fault === "INVALIDPREVIOUS") {
						return "invalid";
					}

					if (Scenario.Fault === "PREVIOUSGETTERTHROW") {
						throw OperationError;
					}
				}

				return State[strField];
			};

			PhysicsObject[vecSetters[unIndex]] = (Value) => {
				const bRestoring = Value === Initial[strField];
				bRestorationReadback = bRestoring;
				if (bRestoring) {
					vecRestorationAttempts.push(strField);

					if (bCleanupAll || ((Scenario.Index === unIndex) && (Scenario.Fault === "CLEANUPTHROW"))) {
						vecExpectedCleanupErrors.push(vecCleanupErrors[unIndex]);
						throw vecCleanupErrors[unIndex];
					}

					if ((Scenario.Index === unIndex) && Scenario.Fault.startsWith("CLEANUP")) {
						if (Scenario.Fault === "CLEANUPREADBACKTHROW") {
							vecExpectedCleanupErrors.push(vecCleanupErrors[unIndex]);

						} else {
							vecExpectedCleanupErrors.push(null);
						}

						if (Scenario.Fault === "CLEANUPFALSE") {
							return false;
						}
					}

				} else {
					vecOperationAttempts.push(strField);

					if ((Scenario.Index === unIndex) && (Scenario.Fault === "OPERATIONFALSE")) {
						return false;
					}

					if (strField === "Hinged") {
						g_Assert.equal(Value, 2, "new hinge uses local axis 2, not the unknown prior axis");
					}
				}

				State[strField] = (strField === "Hinged") ? Value !== false : Value;

				return true;
			};
		}

		if (Scenario.Fault === "MISSINGGETTER") {
			delete PhysicsObject[vecGetters[Scenario.Index]];
		}

		if (Scenario.Fault === "MISSINGSETTER") {
			delete PhysicsObject[vecSetters[Scenario.Index]];
		}

		const FinishOperation = () => {
			if (bOperationThrows) {
				throw bOriginalNull ? null : OperationError;
			}

			return true;
		};
		PhysicsObject.RecheckCollisionFilter = FinishOperation;

		PhysicsObject.RecheckContactPoints = () => true;

		PhysicsObject.GetContactPoint = () => ({ Hit: true, Point: { X: 1, Y: 2, Z: 3 }, Object: { Address: 0x88880000n } });

		PhysicsObject.OutputDebugInfo = FinishOperation;

		const TestEntity = { Index: 1, Address: 0x77770000n };

		const DocumentationRequire = (strName) => {
			if (strName === "entities/entity") {
				const Entity = (unIndex) => {
					g_Assert.equal(unIndex, 1, "state example entity index");

					return TestEntity;
				};
				return { Entity };
			}

			g_Assert.equal(strName, "physics", "state example import");

			const GetEntityPhysicsObject = (EntityValue) => {
				g_Assert.equal(EntityValue, TestEntity, "state example resolves an entity instead of reinterpreting its base address");

				return PhysicsObject;
			};

			return { GetEntityPhysicsObject };
		};

		const strLabel = `state/${Scenario.Kind}/${Scenario.Fault}/${Scenario.Index ?? "ALL"}`;
		const Execute = g_VM.compileFunction(`"use strict";\n${vecExamples[bCollision ? 1 : 2]}`, ["require"], { filename: `${g_strPhysicsDocumentationPath}:${strLabel}` });
		let bCaught = false;
		let ErrorValue = null;

		try {
			RunDocumentationFunction(Execute, undefined, [DocumentationRequire], `${strLabel}:initialize`);
		} catch (CaughtError) {
			bCaught = true;
			ErrorValue = CaughtError;
		}

		const vecExpectedRestorations = bPreconditionFails ? [] : vecFields.filter((strField, unIndex) => !((Scenario.Fault === "MISSINGGETTER") && (Scenario.Index === unIndex)) && !((strField === "Hinged") && Scenario.AlreadyHinged));
		g_Assert.deepEqual(vecRestorationAttempts, vecExpectedRestorations, `${Scenario.Kind}/${Scenario.Fault}: attempt every independent restoration in order`);

		if (bPreconditionFails) {
			g_Assert.equal(vecOperationAttempts.length, 0, "invalid or unreadable prior state must fail before mutation");
		}

		const bFails = bPreconditionFails || bOperationThrows || (Scenario.Fault === "OPERATIONFALSE") || (vecExpectedCleanupErrors.length > 0);
		g_Assert.equal(bCaught, bFails, `${Scenario.Kind}/${Scenario.Fault}: error visibility`);

		if (vecExpectedCleanupErrors.length > 0) {
			g_Assert.ok(ErrorValue instanceof AggregateError, "restoration failures use AggregateError");

			const unOperationErrorCount = (bOperationThrows || (Scenario.Fault === "OPERATIONFALSE")) ? 1 : 0;
			g_Assert.equal(ErrorValue.errors.length, vecExpectedCleanupErrors.length + unOperationErrorCount, "no original or cleanup errors are lost");

			if (bOperationThrows) {
				g_Assert.equal(ErrorValue.errors[0], bOriginalNull ? null : OperationError, "original error including null precedes restoration errors");
			}

			for (const vecCleanupEntry of vecExpectedCleanupErrors.entries()) {
				const ErrorExpected = vecCleanupEntry[1];
				const ErrorActual = ErrorValue.errors[vecCleanupEntry[0] + unOperationErrorCount];
				if (ErrorExpected !== null) {
					g_Assert.equal(ErrorActual, ErrorExpected, "cleanup exception identity and order");

				} else {
					g_Assert.ok(ErrorActual instanceof Error, "false result or readback mismatch is reported");
				}
			}

		} else if (bOperationThrows || (Scenario.Fault === "PREVIOUSGETTERTHROW")) {
			g_Assert.equal(ErrorValue, bOriginalNull ? null : OperationError, "original failure is not replaced when cleanup succeeds");
		}

		if (Scenario.AlreadyHinged) {
			g_Assert.ok(!vecOperationAttempts.includes("Hinged"), "an existing hinge axis must not be replaced");
		}

		if (Scenario.Fault === "OPERATIONFALSE") {
			g_Assert.deepEqual(vecOperationAttempts, vecFields.slice(0, Scenario.Index + 1), "failed state operation stops later mutations");
			g_Assert.ok(ErrorValue instanceof Error, "failed state setter is reported");
		}

		for (const strField of vecExpectedRestorations) {
			const bFieldCleanupFails = bCleanupAll || (Scenario.Fault.startsWith("CLEANUP") && (strField === vecFields[Scenario.Index]));
			if (!bFieldCleanupFails) {
				g_Assert.equal(State[strField], Initial[strField], "successful restoration restores the saved state");
			}
		}
	}

	const TestEntity = { Index: 1, Address: 0x77770000n };
	const unPhysicsAddress = 0x88880000n;
	const PHYSICS_INTERFACE = { Address: 0x99990000n };
	const vecResolvedInputs = [];

	const PhysicsInterface = function() {
		return { Address: PHYSICS_INTERFACE.Address };
	};

	const PhysicsEnvironment = function() {
		return { Address: 0xAAAA0000n, Index: 0 };
	};

	const PhysicsObject = function(unAddress) {
		g_Assert.equal(unAddress, unPhysicsAddress, "object constructor must not receive a base-entity address");

		return { Address: unAddress };
	};

	const CreatePhysicsObjectFromAddress = (unAddress) => new PhysicsObject(unAddress);

	const CreatePhysicsInterfaceFromAddress = (unAddress) => ({ Address: unAddress });

	const CreatePhysicsEnvironmentFromAddress = (unAddress) => ({ Address: unAddress, Index: 0 });

	PhysicsInterface.CreatePhysicsInterfaceFromAddress = CreatePhysicsInterfaceFromAddress;
	PhysicsEnvironment.CreatePhysicsEnvironmentFromAddress = CreatePhysicsEnvironmentFromAddress;
	PhysicsObject.CreatePhysicsObjectFromAddress = CreatePhysicsObjectFromAddress;

	const PhysicsModule = {
		PHYSICS_INTERFACE,
		PhysicsInterface,
		PhysicsEnvironment,
		PhysicsObject,
		CreatePhysicsInterfaceFromAddress,
		CreatePhysicsEnvironmentFromAddress,
		CreatePhysicsObjectFromAddress,

		GetEntityPhysicsObject: (EntityValue) => {
			g_Assert.equal(EntityValue, TestEntity, "interop resolves entity before extracting the physics address");

			return { Address: unPhysicsAddress };
		},

		ResolvePhysicsObject: (Value, bRequired) => {
			vecResolvedInputs.push(Value);
			g_Assert.equal(bRequired, true, "interop requires a resolved physics object");
			const unAddress = (typeof Value === "bigint") ? Value : Value.Address;

			return CreatePhysicsObjectFromAddress(unAddress);
		},
	};

	const DocumentationRequire = (strName) => (strName === "physics") ? PhysicsModule : { Entity: () => TestEntity };

	const ExecuteInterop = g_VM.compileFunction(`"use strict";\n${vecExamples[3]}`, ["require"], { filename: `${g_strPhysicsDocumentationPath}:interop` });
	g_Assert.doesNotThrow(() => RunDocumentationFunction(ExecuteInterop, undefined, [DocumentationRequire], "interop:initialize"), "interop uses plain native wrappers without instanceof or JavaScript identity requirements");
	g_Assert.equal(vecResolvedInputs.length, 2, "interop resolves a wrapper and its physics address");
	g_Assert.equal(vecResolvedInputs[0].Address, unPhysicsAddress, "interop physics wrapper");
	g_Assert.equal(vecResolvedInputs[1], unPhysicsAddress, "interop physics address, not entity address");
	g_Assert.notEqual(unPhysicsAddress, TestEntity.Address, "distinct native types must not share the fixture address");
}

function RunDocumentationExamples(PhysicsObject) {
	const strDocumentation = g_FileSystem.readFileSync(g_strPhysicsDocumentationPath, "utf8");
	g_Assert.doesNotMatch(strDocumentation, /Generated by|generate_api_docs/, "physics documentation must be hand-maintained");
	g_Assert.doesNotMatch(strDocumentation, /\bconsole\.[A-Za-z_$]/, "physics documentation must use checked workflows instead of console output");
	VerifyLocalLinks(strDocumentation);
	VerifyContentsAnchors(strDocumentation);

	CheckDocumentationRestorationFailures(strDocumentation);
	CheckDocumentationObjectRestorationFailures(strDocumentation);
	CheckDocumentationPhysicsStateFailures(strDocumentation);

	const vecModuleSection = strDocumentation.match(/## Module API\r?\n([\s\S]*?)\r?\n## Physics interface/);
	g_Assert.ok(vecModuleSection, "physics module API section");

	const vecDocumentedExports = [...vecModuleSection[1].matchAll(/^\| `([A-Za-z_][A-Za-z0-9_]*)(?:\([^`]*)?` \|/gm)].map((vecMatch) => vecMatch[1]).sort();
	g_Assert.deepEqual(vecDocumentedExports, Object.keys(PhysicsObject).sort(), "documented physics export inventory");

	for (const strPublicMethodName of [
		"GetActivePhysicsEnvironmentByIndex",
		"GetServerGravityConVarValue",
		"SetGravity",
		"GetPosition",
		"SetPosition",
		"ApplyForceCenter",
		"GetContactPoint",
	]) {
		g_Assert.match(strDocumentation, new RegExp(`\\b${strPublicMethodName}\\b`), `documented physics method: ${strPublicMethodName}`);
	}

	const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, 14, "physics documentation example count");

	for (const vecExampleEntry of vecExamples.entries()) {
		const unExampleIndex = vecExampleEntry[0];
		const strExample = vecExampleEntry[1];
		const DocumentationModule = { exports: {} };

		const DocumentationRequire = (strModuleName) => {
			if (strModuleName === "physics") {
				return PhysicsObject;
			}

			if (strModuleName === "entities/entity") {
				return { Entity };
			}

			throw new Error(`Unexpected documentation import: ${strModuleName}`);
		};

		const strLabel = `example-${unExampleIndex + 1}`;
		const ExecuteDocumentation = g_VM.compileFunction(`"use strict";\n${strExample}\nreturn (typeof ApplyForcesToTestPhysicsObject === "function") ? ApplyForcesToTestPhysicsObject : null;`, ["require", "module"], { filename: `${g_strPhysicsDocumentationPath}:${strLabel}` });
		const ApplyForcesExample = RunDocumentationFunction(ExecuteDocumentation, undefined, [DocumentationRequire, DocumentationModule], `${strLabel}:initialize`);
		if (ApplyForcesExample !== null) {
			RunDocumentationFunction(ApplyForcesExample, undefined, [Entity(1)], `${strLabel}:apply`);
		}

		if (strExample.includes("function UnloadPlugin()")) {
			g_Assert.equal(typeof DocumentationModule.exports.Unload, "function", "The cleanup example must export the native unload entry point");
		}

		if (typeof DocumentationModule.exports.Unload === "function") {
			RunDocumentationFunction(DocumentationModule.exports.Unload, DocumentationModule.exports, [], `${strLabel}:unload`);
		}

		g_Assert.equal(g_EnvironmentState.Gravity.Z, -800, `example ${unExampleIndex + 1} must restore environment gravity`);
		g_Assert.equal(g_EnvironmentState.AirDensity, 2, `example ${unExampleIndex + 1} must restore air density`);
	}
}

function VerifyWorldPhysicsExample(PhysicsAPI) {
	const unScriptTimeoutMilliseconds = 1000;

	const strExamplePath = g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecMatch = strExample.match(/\tLogResult\("physics live environment",[\s\S]*?\r?\n\t}\);/);
	g_Assert.ok(vecMatch, "world example must retain its physics callback");

	const nCleanupStart = strExample.indexOf("\nfunction UseCleanup(");
	const nCleanupEnd = strExample.indexOf("\nfunction GetCommandArguments(", nCleanupStart);
	g_Assert.ok((nCleanupStart >= 0) && (nCleanupEnd > nCleanupStart));

	const strCallbackSource = `${strExample.slice(nCleanupStart, nCleanupEnd)}\n${vecMatch[0]}`;

	const GravityBefore = CopyVector(g_EnvironmentState.Gravity);
	const GravityStorage = g_EnvironmentState.Gravity;
	const flAirDensityBefore = g_EnvironmentState.AirDensity;
	let Result = null;

	try {
		g_VM.runInNewContext(strCallbackSource, {
			...PhysicsAPI,

			LogResult: (strLabel, Callback) => {
				g_Assert.equal(strLabel, "physics live environment");
				Result = Callback();
			},
		}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });

		g_Assert.deepEqual(g_EnvironmentState.Gravity, GravityBefore, "world example must restore native gravity");
		g_Assert.equal(g_EnvironmentState.AirDensity, flAirDensityBefore, "world example must restore native air density");

		g_Assert.deepEqual(Array.from(Result.After.Gravity), [GravityBefore.X, GravityBefore.Y, GravityBefore.Z - 1]);
		g_Assert.deepEqual(Array.from(Result.Object.Position.Origin), [100, 200, 300]);
		g_Assert.deepEqual(Array.from(Result.Object.Position.Angles), [0, 90, 0]);
		g_Assert.deepEqual(Array.from(Result.Object.Velocity.Linear), [10, 20, 30]);
		g_Assert.deepEqual(Array.from(Result.Object.Velocity.Angular), [1, 2, 3]);

		const FlattenErrors = (Failure) => Array.isArray(Failure?.errors) ? Array.from(Failure.errors).flatMap(FlattenErrors) : [Failure];

		const vecBodyProfiles = [
			{ Failed: false },
			...[
				undefined,
				null,
				false,
				0,
				"opaque physics error",
				Object.freeze(new Error("opaque physics error")),
			].map((Failure) => ({ Failed: true, Failure })),
		];

		let unFailureScenarios = 0;
		for (const Body of vecBodyProfiles) {
			for (const strAirFailure of ["", "FALSE", "THROW"]) {
				for (const strGravityFailure of ["", "FALSE", "THROW"]) {
					AssignVector(GravityStorage, GravityBefore);
					g_EnvironmentState.Gravity = GravityStorage;
					g_EnvironmentState.AirDensity = flAirDensityBefore;

					const Environment = PhysicsAPI.GetActivePhysicsEnvironmentByIndex(0);
					const WrappedEnvironment = Object.create(Environment);
					const SetAirDensity = Environment.SetAirDensity.bind(Environment);
					const SetGravity = Environment.SetGravity.bind(Environment);
					const ActiveObjects = Environment.ActiveObjects.bind(Environment);

					const AirError = Object.freeze(new Error("opaque air restoration error"));
					const GravityError = Object.freeze(new Error("opaque gravity restoration error"));
					let unAirCalls = 0;
					let unGravityCalls = 0;
					const vecRestorations = [];

					Object.defineProperties(WrappedEnvironment, {
						SetAirDensity: { value: (flValue) => {
							unAirCalls += 1;
							if (unAirCalls === 2) {
								vecRestorations.push("air");

								if (strAirFailure === "FALSE") {
									return false;
								}

								if (strAirFailure === "THROW") {
									throw AirError;
								}
							}

							return SetAirDensity(flValue);
						} },

						SetGravity: { value: (Value) => {
							unGravityCalls += 1;
							if (unGravityCalls === 2) {
								vecRestorations.push("gravity");

								if (strGravityFailure === "FALSE") {
									return false;
								}

								if (strGravityFailure === "THROW") {
									throw GravityError;
								}
							}

							return SetGravity(Value);
						} },

						ActiveObjects: { value: () => {
							if (Body.Failed) {
								throw Body.Failure;
							}

							return ActiveObjects();
						} },
					});

					let bCaught = false;
					let Failure = undefined;

					try {
						g_VM.runInNewContext(strCallbackSource, {
							...PhysicsAPI,
							PhysicsEnvironment: { CreatePhysicsEnvironmentFromAddress: () => WrappedEnvironment },

							LogResult: (strLabel, Callback) => {
								g_Assert.equal(strLabel, "physics live environment");

								return Callback();
							},
						}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });
					} catch (CaughtError) {
						bCaught = true;
						Failure = CaughtError;
					}

					const bExpectedFailure = Body.Failed || Boolean(strAirFailure || strGravityFailure);
					g_Assert.equal(bCaught, bExpectedFailure);
					g_Assert.equal(unAirCalls, 2);
					g_Assert.equal(unGravityCalls, 2);
					g_Assert.deepEqual(vecRestorations, ["air", "gravity"]);

					if (bCaught) {
						const vecFailures = FlattenErrors(Failure);
						g_Assert.equal(vecFailures.length, Number(Body.Failed) + Number(Boolean(strAirFailure)) + Number(Boolean(strGravityFailure)));

						if (Body.Failed) {
							g_Assert.equal(vecFailures[0], Body.Failure);
						}

						if (strAirFailure === "THROW") {
							g_Assert.equal(vecFailures[Number(Body.Failed)], AirError);
						}

						if (strGravityFailure === "THROW") {
							g_Assert.equal(vecFailures.at(-1), GravityError);
						}
					}

					unFailureScenarios += 1;
				}
			}
		}

		console.log(`[world physics example] ${unFailureScenarios} operation/independent-restoration scenarios; controlled native doubles, not live engine proof`);
	} finally {
		AssignVector(GravityStorage, GravityBefore);
		g_EnvironmentState.Gravity = GravityStorage;
		g_EnvironmentState.AirDensity = flAirDensityBefore;
	}
}

function RestoreProperty(Owner, strName, Descriptor) {
	if (Descriptor === undefined) {
		delete Owner[strName];
		return;
	}

	Object.defineProperty(Owner, strName, Descriptor);
}

function LoadPhysicsModule() {
	const ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");

	try {
		Object.defineProperty(g_Module, "_load", { configurable: true, enumerable: ModuleLoadDescriptor.enumerable, writable: true, value: LoadRuntimeModule });

		return require(g_strPhysicsPath);
	} finally {
		Object.defineProperty(g_Module, "_load", ModuleLoadDescriptor);
	}
}

function VerifyRuntimeRequirement() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const PhysicsCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strPhysicsPath);

	try {
		delete globalThis.sourcejs;
		delete require.cache[g_strPhysicsPath];
		g_Assert.throws(() => LoadPhysicsModule(), /SourceJS native runtime is not installed/, "physics requires native runtime");
	} finally {
		RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor);
		RestoreProperty(require.cache, g_strPhysicsPath, PhysicsCacheDescriptor);
	}
}

function CheckPhysics() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const PhysicsCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strPhysicsPath);
	const MemoryCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strMemoryPath);
	const RuntimeCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strRuntimePath);

	try {
		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { physics: g_NativePhysics } });
		delete require.cache[g_strPhysicsPath];
		delete require.cache[g_strMemoryPath];
		delete require.cache[g_strRuntimePath];

		require.cache[g_strMemoryPath] = {
			exports: {
				RegisterObjectType(strName, Constructor) {
					g_mapRegisteredTypes.set(strName, Constructor);
				},
			},
			filename: g_strMemoryPath,
			id: g_strMemoryPath,
			loaded: true,
		};

		const PhysicsAPI = LoadPhysicsModule();
		const strPhysicsPackageSource = g_FileSystem.readFileSync(g_strPhysicsPath, "utf8");

		g_Assert.notStrictEqual(PhysicsAPI, g_NativePhysics, "physics exposes the public facade object");
		g_Assert.deepEqual(Object.keys(PhysicsAPI).sort(), [
			"CreatePhysicsEnvironmentFromAddress",
			"CreatePhysicsInterfaceFromAddress",
			"CreatePhysicsObjectFromAddress",
			"GetActivePhysicsEnvironmentByIndex",
			"GetEntityPhysicsObject",
			"GetEntityPhysicsObjects",
			"GetServerGravityConVarValue",
			"PHYSICS_INTERFACE",
			"PhysicsEnvironment",
			"PhysicsInterface",
			"PhysicsObject",
			"ResolvePhysicsObject",
		].sort(), "physics exports");

		for (const strPhysicsConstructorName of ["PhysicsInterface", "PhysicsEnvironment", "PhysicsObject"]) {
			const PhysicsConstructorDescriptor = Object.getOwnPropertyDescriptor(PhysicsAPI, strPhysicsConstructorName);
			g_Assert.equal(PhysicsConstructorDescriptor.enumerable, true, `${strPhysicsConstructorName} must be enumerable`);
			g_Assert.equal(PhysicsConstructorDescriptor.configurable, true, `${strPhysicsConstructorName} must be configurable`);
			g_Assert.equal(PhysicsConstructorDescriptor.writable, true, `${strPhysicsConstructorName} must be writable`);
		}

		g_Assert.doesNotMatch(strPhysicsPackageSource, /requireNativeObject|not available from the selected SDK runtime/, "physics constructors must propagate native V8 errors");
		g_Assert.ok(!Object.hasOwn(PhysicsAPI, "moduleName"), "physics must not expose moduleName");
		g_Assert.ok(!Object.hasOwn(PhysicsAPI, "isAvailable"), "physics must not expose an availability fallback");
		g_Assert.ok(!Object.hasOwn(PhysicsAPI, "objectList"), "physics must not expose objectList alias");
		g_Assert.ok(!Object.hasOwn(PhysicsAPI, "objectFromAddress"), "physics must not expose address aliases");

		const PhysicsInterfaceInstance = new PhysicsAPI.PhysicsInterface();
		const AddressInterface = PhysicsAPI.PhysicsInterface.CreatePhysicsInterfaceFromAddress(0x2100n);
		const PhysicsEnvironmentInstance = new PhysicsAPI.PhysicsEnvironment(0);
		const AddressEnvironment = PhysicsAPI.PhysicsEnvironment.CreatePhysicsEnvironmentFromAddress(0x3100n);
		const PhysicsObjectInstance = new PhysicsAPI.PhysicsObject(g_PrimaryPhysicsObject.Address);
		const AddressObject = PhysicsAPI.PhysicsObject.CreatePhysicsObjectFromAddress(g_SecondaryPhysicsObject.Address);

		g_Assert.equal(PhysicsInterfaceInstance.Address, 0x2000n, "PhysicsInterface constructor");
		g_Assert.equal(AddressInterface.Address, 0x2100n, "PhysicsInterface.CreatePhysicsInterfaceFromAddress");
		g_Assert.equal(PhysicsEnvironmentInstance.Index, 0, "PhysicsEnvironment constructor");
		g_Assert.equal(AddressEnvironment.Address, 0x3100n, "PhysicsEnvironment.CreatePhysicsEnvironmentFromAddress");
		g_Assert.equal(PhysicsObjectInstance.GetPhysicsObjectMass(), 4, "PhysicsObject constructor");
		g_Assert.equal(AddressObject.Address, 0x4001n, "PhysicsObject.CreatePhysicsObjectFromAddress");

		for (const TypeInformation of [
			{ Name: "PhysicsInterface", Address: 0x2100n },
			{ Name: "PhysicsEnvironment", Address: 0x3100n },
			{ Name: "PhysicsObject", Address: 0x4001n },
		]) {
			const Constructor = g_mapRegisteredTypes.get(TypeInformation.Name);
			g_Assert.equal((typeof Constructor.CreateFromAddress === "function") && (Constructor.CreateMathStructureFromAddress === undefined), true, `${TypeInformation.Name} exposes only the canonical memory.MakeObject factory`);

			const PhysicsView = Constructor.CreateFromAddress(TypeInformation.Address);
			g_Assert.equal(PhysicsView.Address, TypeInformation.Address, `${TypeInformation.Name} registry factory preserves the BigInt address`);
			g_Assert.throws(() => Constructor.CreateFromAddress(0n), TypeError, `${TypeInformation.Name} registry factory rejects a null address`);
			g_Assert.throws(() => Constructor.CreateFromAddress(1), TypeError, `${TypeInformation.Name} registry factory rejects Number addresses`);
		}

		g_Assert.equal(PhysicsAPI.GetActivePhysicsEnvironmentByIndex(1), null, "direct environment lookup remains nullable");
		g_Assert.throws(() => new PhysicsAPI.PhysicsEnvironment(1), /native physics environment is not active/, "PhysicsEnvironment constructor requires a native object");
		g_Assert.equal(PhysicsAPI.ResolvePhysicsObject(0x4FFFn), null, "direct physics-object lookup remains nullable");
		g_Assert.throws(() => new PhysicsAPI.PhysicsObject(0x4FFFn), /native physics object is not available/, "PhysicsObject constructor requires a native object");

		g_Assert.ok(PhysicsObjectInstance.SetPhysicsObjectGravityEnabled(false), "public PhysicsObject method");
		g_Assert.equal(PhysicsObjectInstance.IsPhysicsObjectGravityEnabled(), false, "public PhysicsObject live state");
		g_Assert.ok(PhysicsObjectInstance.SetPhysicsObjectGravityEnabled(true), "public PhysicsObject state restore");
		g_Assert.equal(PhysicsAPI.GetEntityPhysicsObjects(Entity(1)).length, 2, "public GetEntityPhysicsObjects");
		g_Assert.throws(() => PhysicsAPI.PhysicsObject.CreatePhysicsObjectFromAddress("0x4100"), "string address must be rejected");

		for (const InvalidAddress of [
			0n,
			-1n,
			0x2100,
			NaN,
			Infinity,
			"0x2100",
			null,
			undefined,
			false,
			{},
		]) {
			g_Assert.throws(() => PhysicsAPI.CreatePhysicsInterfaceFromAddress(InvalidAddress), TypeError, "interface requires a positive BigInt address");
			g_Assert.throws(() => PhysicsAPI.CreatePhysicsEnvironmentFromAddress(InvalidAddress), TypeError, "environment requires a positive BigInt address");
			g_Assert.throws(() => PhysicsAPI.CreatePhysicsObjectFromAddress(InvalidAddress), TypeError, "object requires a positive BigInt address");
		}

		g_Assert.equal(Entity(1).Address, 0x1001n, "entity fixture addresses must be BigInt");
		g_Assert.equal(g_PrimaryPhysicsObject.GetGameData(), 0n, "null native game-data address must be BigInt");
		g_Assert.equal(g_PrimaryPhysicsObject.GetCollide(), 0x7000n, "native collide address must be BigInt");

		for (const strName of ["PhysicsInterface", "PhysicsEnvironment", "PhysicsObject"]) {
			g_Assert.ok(g_mapRegisteredTypes.has(strName), `${strName} should be registered for MakeObject`);
		}

		RunDocumentationExamples(PhysicsAPI);

		g_Assert.deepEqual(PhysicsObjectInstance.GetPhysicsObjectPosition().Position, CreateVector(100, 200, 300), "documentation must restore position");
		g_Assert.deepEqual(PhysicsObjectInstance.GetPhysicsObjectPosition().Angles, CreateAngle(0, 90, 0), "documentation must restore angles");
		g_Assert.deepEqual(PhysicsObjectInstance.GetPhysicsObjectVelocity().LinearVelocity, CreateVector(10, 20, 30), "documentation must restore linear velocity");
		g_Assert.deepEqual(PhysicsObjectInstance.GetPhysicsObjectVelocity().AngularVelocity, CreateVector(1, 2, 3), "documentation must restore angular velocity");
		g_Assert.equal(PhysicsObjectInstance.IsPhysicsObjectAsleep(), false, "documentation must restore sleep state");
		g_Assert.equal(PhysicsObjectInstance.IsPhysicsObjectTrigger(), false, "documentation must restore trigger state");
		g_Assert.equal(PhysicsObjectInstance.IsPhysicsObjectHinged(), false, "documentation must restore hinge state");
		g_Assert.equal(g_vecAppliedForces.length, 3, "documentation must demonstrate center, offset and torque forces");
		g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "InterfaceFromAddress") && (vecCall[1] === 0x2100n)), "interface address must reach native unchanged");
		g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "ObjectFromAddress") && (vecCall[1] === 0x4001n)), "object address must reach native unchanged");
		g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "GetActiveEnvironmentByIndex") && (vecCall[2] === true)), "PhysicsEnvironment must require the native result");
		g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "Object") && (vecCall[2] === true)), "PhysicsObject must require the native result");

		VerifyWorldPhysicsExample(PhysicsAPI);
		VerifyRuntimeRequirement();
	} finally {
		RestoreProperty(require.cache, g_strPhysicsPath, PhysicsCacheDescriptor);
		RestoreProperty(require.cache, g_strMemoryPath, MemoryCacheDescriptor);
		RestoreProperty(require.cache, g_strRuntimePath, RuntimeCacheDescriptor);
		RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor);
	}

	console.log("[smoke_physics] ok");
}

CheckPhysics();
