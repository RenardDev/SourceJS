"use strict";

const { GetModule } = require("internal/runtime");
const { RegisterObjectType } = require("memory");

const g_PhysicsRuntime = GetModule("physics");

function RequirePhysicsAddress(unAddress) {
	if ((typeof unAddress !== "bigint") || (unAddress <= 0n)) {
		throw new TypeError("Address must be a positive BigInt address.");
	}

	return unAddress;
}

function DefinePhysicsMethod(Target, strMethodName, Callback) {
	Object.defineProperty(Target, strMethodName, { configurable: true, value: Callback, writable: true });
}

function DecoratePhysicsObject(PhysicsObject) {
	if (!PhysicsObject || (typeof PhysicsObject !== "object")) {
		return PhysicsObject;
	}

	const mapMethods = new Map([
		["IsPhysicsObjectStatic", "IsStatic"],
		["IsPhysicsObjectAsleep", "IsAsleep"],
		["IsPhysicsObjectTrigger", "IsTrigger"],
		["IsPhysicsObjectFluid", "IsFluid"],
		["IsPhysicsObjectHinged", "IsHinged"],
		["IsPhysicsObjectCollisionEnabled", "IsCollisionEnabled"],
		["IsPhysicsObjectGravityEnabled", "IsGravityEnabled"],
		["IsPhysicsObjectDragEnabled", "IsDragEnabled"],
		["IsPhysicsObjectMotionEnabled", "IsMotionEnabled"],
		["IsPhysicsObjectMoveable", "IsMoveable"],
		["IsPhysicsObjectAttachedToConstraint", "IsAttachedToConstraint"],
		["GetPhysicsObjectName", "GetName"],
		["SetPhysicsObjectCollisionEnabled", "EnableCollisions"],
		["SetPhysicsObjectGravityEnabled", "EnableGravity"],
		["SetPhysicsObjectDragEnabled", "EnableDrag"],
		["SetPhysicsObjectMotionEnabled", "EnableMotion"],
		["SetPhysicsObjectAsleep", "SetAsleep"],
		["GetPhysicsObjectGameDataAddress", "GetGameData"],
		["SetPhysicsObjectGameDataAddress", "SetGameData"],
		["GetPhysicsObjectGameFlags", "GetGameFlags"],
		["SetPhysicsObjectGameFlags", "SetGameFlags"],
		["GetPhysicsObjectGameIndex", "GetGameIndex"],
		["SetPhysicsObjectGameIndex", "SetGameIndex"],
		["GetPhysicsObjectCallbackFlags", "GetCallbackFlags"],
		["SetPhysicsObjectCallbackFlags", "SetCallbackFlags"],
		["GetPhysicsObjectMass", "GetMass"],
		["SetPhysicsObjectMass", "SetMass"],
		["GetPhysicsObjectInverseMass", "GetInverseMass"],
		["GetPhysicsObjectMaterialIndex", "GetMaterialIndex"],
		["SetPhysicsObjectMaterialIndex", "SetMaterialIndex"],
		["GetPhysicsObjectContents", "GetContents"],
		["SetPhysicsObjectContents", "SetContents"],
		["GetPhysicsObjectSphereRadius", "GetSphereRadius"],
		["SetPhysicsObjectSphereRadius", "SetSphereRadius"],
		["GetPhysicsObjectEnergy", "GetEnergy"],
		["GetPhysicsObjectInertia", "GetInertia"],
		["SetPhysicsObjectInertia", "SetInertia"],
		["GetPhysicsObjectInverseInertia", "GetInverseInertia"],
		["GetPhysicsObjectMassCenterLocalSpace", "GetMassCenterLocalSpace"],
		["GetPhysicsObjectContactPoint", "GetContactPoint"],
		["GetPhysicsObjectCollideAddress", "GetCollide"],
		["GetPhysicsObjectPosition", "GetPosition"],
		["SetPhysicsObjectPosition", "SetPosition"],
		["GetPhysicsObjectVelocity", "GetVelocity"],
		["SetPhysicsObjectVelocity", "SetVelocity"],
		["SetPhysicsObjectVelocityInstantaneous", "SetVelocityInstantaneous"],
		["AddPhysicsObjectVelocity", "AddVelocity"],
		["ApplyPhysicsObjectForceAtCenter", "ApplyForceCenter"],
		["ApplyPhysicsObjectForceAtOffset", "ApplyForceOffset"],
		["ApplyPhysicsObjectTorqueAtCenter", "ApplyTorqueCenter"],
		["ConvertPhysicsObjectLocalPointToWorld", "LocalToWorld"],
		["ConvertPhysicsObjectWorldPointToLocal", "WorldToLocal"],
		["ConvertPhysicsObjectLocalVectorToWorld", "LocalToWorldVector"],
		["ConvertPhysicsObjectWorldVectorToLocal", "WorldToLocalVector"],
		["RecheckPhysicsObjectCollisionFilter", "RecheckCollisionFilter"],
		["RecheckPhysicsObjectContactPoints", "RecheckContactPoints"],
		["SetPhysicsObjectTrigger", "SetTrigger"],
		["SetPhysicsObjectHinged", "SetHinged"],
		["OutputPhysicsObjectDebugInfo", "OutputDebugInfo"],
	]);

	for (const vecMethodEntry of mapMethods) {
		const strMethodName = vecMethodEntry[0];
		const strRuntimeMethodName = vecMethodEntry[1];
		if (typeof PhysicsObject[strRuntimeMethodName] !== "function") {
			continue;
		}

		const Callback = (...vecArguments) => PhysicsObject[strRuntimeMethodName](...vecArguments);
		DefinePhysicsMethod(PhysicsObject, strMethodName, Callback);
	}

	return PhysicsObject;
}

function DecoratePhysicsEnvironment(PhysicsEnvironment) {
	if (!PhysicsEnvironment || (typeof PhysicsEnvironment !== "object")) {
		return PhysicsEnvironment;
	}

	const mapMethods = new Map([
		["GetPhysicsEnvironmentGravity", (...vecArguments) => PhysicsEnvironment.GetGravity(...vecArguments)],
		["SetPhysicsEnvironmentGravity", (...vecArguments) => PhysicsEnvironment.SetGravity(...vecArguments)],
		["GetPhysicsEnvironmentAirDensity", (...vecArguments) => PhysicsEnvironment.GetAirDensity(...vecArguments)],
		["SetPhysicsEnvironmentAirDensity", (...vecArguments) => PhysicsEnvironment.SetAirDensity(...vecArguments)],
		["GetActivePhysicsObjectCount", (...vecArguments) => PhysicsEnvironment.GetActiveObjectCount(...vecArguments)],
		["GetActivePhysicsObjects", (...vecArguments) => PhysicsEnvironment.ActiveObjects(...vecArguments).map(DecoratePhysicsObject)],
		["GetActivePhysicsObjectByEntity", (...vecArguments) => DecoratePhysicsObject(PhysicsEnvironment.GetActiveObjectByEntity(...vecArguments))],
		["IsPhysicsEnvironmentInSimulation", (...vecArguments) => PhysicsEnvironment.IsInSimulation(...vecArguments)],
		["GetPhysicsEnvironmentSimulationTime", (...vecArguments) => PhysicsEnvironment.GetSimulationTime(...vecArguments)],
		["GetPhysicsEnvironmentSimulationTimeStep", (...vecArguments) => PhysicsEnvironment.GetSimulationTimestep(...vecArguments)],
		["GetPhysicsEnvironmentNextFrameTime", (...vecArguments) => PhysicsEnvironment.GetNextFrameTime(...vecArguments)],
	]);

	for (const vecMethodEntry of mapMethods) {
		const strMethodName = vecMethodEntry[0];
		const Method = vecMethodEntry[1];
		if ((strMethodName === "GetPhysicsEnvironmentNextFrameTime") && (typeof PhysicsEnvironment.GetNextFrameTime !== "function")) {
			continue;
		}

		DefinePhysicsMethod(PhysicsEnvironment, strMethodName, Method);
	}

	return PhysicsEnvironment;
}

function DecoratePhysicsInterface(PhysicsInterface) {
	if (!PhysicsInterface || (typeof PhysicsInterface !== "object")) {
		return PhysicsInterface;
	}

	const GetActivePhysicsEnvironmentByIndex = (unEnvironmentIndex = 0) => DecoratePhysicsEnvironment(PhysicsInterface.GetActiveEnvironmentByIndex(unEnvironmentIndex));
	DefinePhysicsMethod(PhysicsInterface, "GetActivePhysicsEnvironmentByIndex", GetActivePhysicsEnvironmentByIndex);

	return PhysicsInterface;
}

class PhysicsInterface {
	constructor() {
		return DecoratePhysicsInterface(g_PhysicsRuntime.Interface);
	}

	static CreatePhysicsInterfaceFromAddress(unAddress) {
		return DecoratePhysicsInterface(g_PhysicsRuntime.InterfaceFromAddress(RequirePhysicsAddress(unAddress)));
	}

	// memory.MakeObject() invokes this exact factory on registered constructors.
	static CreateFromAddress(unAddress) {
		return this.CreatePhysicsInterfaceFromAddress(unAddress);
	}
}

class PhysicsEnvironment {
	constructor(unEnvironmentIndex = 0) {
		return DecoratePhysicsEnvironment(g_PhysicsRuntime.GetActiveEnvironmentByIndex(unEnvironmentIndex, true));
	}

	static CreatePhysicsEnvironmentFromAddress(unAddress) {
		return DecoratePhysicsEnvironment(g_PhysicsRuntime.EnvironmentFromAddress(RequirePhysicsAddress(unAddress)));
	}

	// memory.MakeObject() invokes this exact factory on registered constructors.
	static CreateFromAddress(unAddress) {
		return this.CreatePhysicsEnvironmentFromAddress(unAddress);
	}
}

class PhysicsObject {
	constructor(PhysicsObject) {
		return DecoratePhysicsObject(g_PhysicsRuntime.Object(PhysicsObject, true));
	}

	static CreatePhysicsObjectFromAddress(unAddress) {
		return DecoratePhysicsObject(g_PhysicsRuntime.ObjectFromAddress(RequirePhysicsAddress(unAddress)));
	}

	// memory.MakeObject() invokes this exact factory on registered constructors.
	static CreateFromAddress(unAddress) {
		return this.CreatePhysicsObjectFromAddress(unAddress);
	}
}

function GetServerGravityConVarValue() {
	return g_PhysicsRuntime.Gravity();
}

function GetActivePhysicsEnvironmentByIndex(unEnvironmentIndex = 0, bRequired = false) {
	return DecoratePhysicsEnvironment(g_PhysicsRuntime.GetActiveEnvironmentByIndex(unEnvironmentIndex, bRequired));
}

function CreatePhysicsInterfaceFromAddress(unAddress) {
	return PhysicsInterface.CreatePhysicsInterfaceFromAddress(unAddress);
}

function CreatePhysicsEnvironmentFromAddress(unAddress, nEnvironmentIndex = -1) {
	return DecoratePhysicsEnvironment(g_PhysicsRuntime.EnvironmentFromAddress(RequirePhysicsAddress(unAddress), nEnvironmentIndex));
}

function ResolvePhysicsObject(PhysicsObject, bRequired = false) {
	return DecoratePhysicsObject(g_PhysicsRuntime.Object(PhysicsObject, bRequired));
}

function CreatePhysicsObjectFromAddress(unAddress) {
	return PhysicsObject.CreatePhysicsObjectFromAddress(unAddress);
}

function GetEntityPhysicsObject(Entity, unPhysicsObjectListIndex = 0) {
	return DecoratePhysicsObject(g_PhysicsRuntime.ObjectByEntity(Entity, unPhysicsObjectListIndex));
}

function GetEntityPhysicsObjects(Entity) {
	return g_PhysicsRuntime.ObjectsByEntity(Entity).map(DecoratePhysicsObject);
}

RegisterObjectType("PhysicsInterface", PhysicsInterface);
RegisterObjectType("PhysicsEnvironment", PhysicsEnvironment);
RegisterObjectType("PhysicsObject", PhysicsObject);

const g_PhysicsAPI = {
	CreatePhysicsEnvironmentFromAddress: CreatePhysicsEnvironmentFromAddress,
	CreatePhysicsInterfaceFromAddress: CreatePhysicsInterfaceFromAddress,
	CreatePhysicsObjectFromAddress: CreatePhysicsObjectFromAddress,
	GetActivePhysicsEnvironmentByIndex: GetActivePhysicsEnvironmentByIndex,
	GetEntityPhysicsObject: GetEntityPhysicsObject,
	GetEntityPhysicsObjects: GetEntityPhysicsObjects,
	GetServerGravityConVarValue: GetServerGravityConVarValue,
	PhysicsEnvironment: PhysicsEnvironment,
	PhysicsInterface: PhysicsInterface,
	PhysicsObject: PhysicsObject,
	ResolvePhysicsObject: ResolvePhysicsObject,
};

Object.defineProperty(g_PhysicsAPI, "PHYSICS_INTERFACE", {
	configurable: true,
	enumerable: true,
	get() {
		return DecoratePhysicsInterface(g_PhysicsRuntime.Interface);
	},
});

module.exports = g_PhysicsAPI;
