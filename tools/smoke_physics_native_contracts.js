#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_physics_native_contracts.js\nChecks physics source contracts and negative regressions; does not execute V8 or physics objects.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_physics_native_contracts.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecBoundaries = [
	{ Name: "GetPhysicsGravityCallback", Guards: 3 },
	{ Name: "GetPhysicsEnvironmentFromThis", Guards: 4, Result: "nullptr" },
	{ Name: "RequirePhysicsEnvironmentFromThis", Guards: 1, Result: "nullptr" },
	{ Name: "CollectPhysicsObjectsForEntity", Guards: 5 },
	{ Name: "GetPhysicsObjectFromEntityValue", Guards: 2, Result: "nullptr" },
	{ Name: "GetPhysicsObjectFromValue", Guards: 4, Result: "nullptr" },
	{ Name: "GetPhysicsObjectFromThis", Guards: 1, Result: "nullptr" },
	{ Name: "RequirePhysicsObjectFromThis", Guards: 1, Result: "nullptr" },
	{ Name: "GetPhysicsVectorFromValue", Guards: 4, Result: "false" },
	{ Name: "GetPhysicsAngleFromValue", Guards: 4, Result: "false" },
	{ Name: "GetPhysicsOperationFromCallback", Guards: 2, Result: "false" },
	{ Name: "GetPhysicsBooleanFromValue", Guards: 2, Result: "false", Diagnostic: "pszTypeErrorMessage" },
	{ Name: "GetPhysicsInt32FromValue", Guards: 2, Result: "false", Diagnostic: "pszTypeErrorMessage" },
	{ Name: "GetPhysicsUInt32FromValue", Guards: 2, Result: "false", Diagnostic: "pszTypeErrorMessage" },
	{ Name: "GetPhysicsUInt16FromValue", Guards: 1, Result: "false", Diagnostic: "pszTypeErrorMessage" },
	{ Name: "GetPhysicsFloatFromValue", Guards: 2, Result: "false", Diagnostic: "pszTypeErrorMessage" },
	{ Name: "GetPhysicsObjectFromLiveComponentMetadata", Guards: 2, Result: "nullptr" },
	{ Name: "GetPhysicsLiveComponentCallback", Guards: 6 },
	{ Name: "InstallPhysicsValue", Guards: 3, Result: "false" },
	{ Name: "SetPhysicsLiveComponentCallback", Guards: 9 },
	{ Name: "InstallPhysicsLiveComponent", Guards: 4, Result: "false" },
	{ Name: "MakePhysicsLiveVectorObject", Guards: 4, Result: "{}" },
	{ Name: "MakePhysicsVectorObject", Guards: 4, Result: "{}" },
	{ Name: "MakePhysicsPositionObject", Guards: 8, Result: "{}" },
	{ Name: "MakePhysicsVelocityObject", Guards: 5, Result: "{}" },
	{ Name: "MakePhysicsInertiaObject", Guards: 1, Result: "{}" },
	{ Name: "MakePhysicsInverseInertiaObject", Guards: 1, Result: "{}" },
	{ Name: "MakePhysicsMassCenterObject", Guards: 1, Result: "{}" },
	{ Name: "GetPhysicsObjectBooleanStateCallback", Guards: 3 },
	{ Name: "IsPhysicsObjectAttachedToConstraintCallback", Guards: 3 },
	{ Name: "SetPhysicsObjectBooleanStateCallback", Guards: 4 },
	{ Name: "GetPhysicsObjectNumberCallback", Guards: 13 },
	{ Name: "SetPhysicsObjectSphereRadiusCallback", Guards: 4 },
	{ Name: "SetPhysicsObjectNumberCallback", Guards: 11 },
	{ Name: "GetPhysicsObjectGameDataCallback", Guards: 3 },
	{ Name: "SetPhysicsObjectGameDataCallback", Guards: 3 },
	{ Name: "GetPhysicsObjectInertiaCallback", Guards: 3 },
	{ Name: "GetPhysicsObjectInverseInertiaCallback", Guards: 3 },
	{ Name: "SetPhysicsObjectInertiaCallback", Guards: 5 },
	{ Name: "GetPhysicsObjectMassCenterLocalSpaceCallback", Guards: 3 },
	{ Name: "GetPhysicsObjectPositionCallback", Guards: 3 },
	{ Name: "SetPhysicsObjectPositionCallback", Guards: 15 },
	{ Name: "GetPhysicsObjectVelocityCallback", Guards: 3 },
	{ Name: "ParsePhysicsVelocityArguments", Guards: 14, Result: "false", GuardDiagnostic: "nullptr" },
	{ Name: "SetPhysicsObjectVelocityCallback", Guards: 3 },
	{ Name: "SetPhysicsObjectVelocityInstantaneousCallback", Guards: 3 },
	{ Name: "AddPhysicsObjectVelocityCallback", Guards: 3 },
	{ Name: "ApplyPhysicsObjectForceCenterCallback", Guards: 5 },
	{ Name: "ApplyPhysicsObjectForceOffsetCallback", Guards: 6 },
	{ Name: "ApplyPhysicsObjectTorqueCenterCallback", Guards: 5 },
	{ Name: "TransformPhysicsObjectVectorCallback", Guards: 7 },
	{ Name: "RecheckPhysicsObjectCollisionFilterCallback", Guards: 2 },
	{ Name: "RecheckPhysicsObjectContactPointsCallback", Guards: 2 },
	{ Name: "GetPhysicsObjectContactPointCallback", Guards: 10 },
	{ Name: "GetPhysicsObjectCollideCallback", Guards: 3 },
	{ Name: "SetPhysicsObjectTriggerCallback", Guards: 3 },
	{ Name: "SetPhysicsObjectHingedCallback", Guards: 7 },
	{ Name: "OutputPhysicsObjectDebugInformationCallback", Guards: 2 },
	{ Name: "GetPhysicsObjectNameCallback", Guards: 3 },
	{ Name: "GetPhysicsObjectInverseMassCallback", Guards: 2 },
	{ Name: "GetPhysicsObjectEnergyCallback", Guards: 2 },
	{ Name: "InstallPhysicsSphereRadiusSetter", Guards: 4, Result: "false" },
	{ Name: "InstallPhysicsObjectMethods", Guards: 7, Result: "false" },
	{ Name: "MakePhysicsObject", Guards: 15, Result: "{}" },
	{ Name: "FindActivePhysicsObjectByEntityIndex", Guards: 5, Result: "nullptr" },
	{ Name: "RequirePhysicsEnvironmentFromLiveComponentData", Guards: 3, Result: "nullptr" },
	{ Name: "GetPhysicsEnvironmentLiveComponentCallback", Guards: 2 },
	{ Name: "SetPhysicsEnvironmentLiveComponentCallback", Guards: 5 },
	{ Name: "InstallPhysicsEnvironmentLiveComponent", Guards: 4, Result: "false" },
	{ Name: "MakePhysicsEnvironmentGravityObject", Guards: 5, Result: "{}" },
	{ Name: "GetPhysicsEnvironmentGravityCallback", Guards: 3 },
	{ Name: "SetPhysicsEnvironmentGravityCallback", Guards: 5 },
	{ Name: "GetPhysicsEnvironmentAirDensityCallback", Guards: 2 },
	{ Name: "SetPhysicsEnvironmentAirDensityCallback", Guards: 5 },
	{ Name: "GetPhysicsEnvironmentActiveObjectCountCallback", Guards: 2 },
	{ Name: "GetPhysicsEnvironmentActiveObjectsCallback", Guards: 8 },
	{ Name: "GetPhysicsEnvironmentActiveObjectByEntityCallback", Guards: 5 },
	{ Name: "IsPhysicsEnvironmentInSimulationCallback", Guards: 2 },
	{ Name: "GetPhysicsEnvironmentSimulationTimeCallback", Guards: 2 },
	{ Name: "GetPhysicsEnvironmentSimulationTimestepCallback", Guards: 2 },
	{ Name: "GetPhysicsEnvironmentNextFrameTimeCallback", Guards: 2 },
	{ Name: "InstallPhysicsEnvironmentMethods", Guards: 5, Result: "false" },
	{ Name: "MakePhysicsEnvironmentObject", Guards: 8, Result: "{}" },
	{ Name: "GetActivePhysicsEnvironmentByIndexCallback", Guards: 6 },
	{ Name: "CreatePhysicsEnvironmentFromAddressCallback", Guards: 5 },
	{ Name: "GetPhysicsObjectByEntityCallback", Guards: 6 },
	{ Name: "ResolvePhysicsObjectCallback", Guards: 5 },
	{ Name: "CreatePhysicsObjectFromAddressCallback", Guards: 4 },
	{ Name: "GetPhysicsObjectsByEntityCallback", Guards: 8 },
	{ Name: "MakePhysicsInterfaceObject", Guards: 7, Result: "{}" },
	{ Name: "GetPhysicsInterfacePropertyCallback", Guards: 3 },
	{ Name: "SetPhysicsInterfacePropertyCallback", Guards: 1 },
	{ Name: "CreatePhysicsInterfaceFromAddressCallback", Guards: 3 },
	{ Name: "InstallPhysicsFunctions", Guards: 8, Result: "false" },
];
const g_vecAddressResolvers = [
	{ Name: "GetPhysicsEnvironmentFromValue", Value: "LocalPhysicsEnvironmentValue", Address: "unPhysicsEnvironmentAddress", Type: "IPhysicsEnvironment" },
	{ Name: "GetPhysicsObjectFromAddressValue", Value: "LocalPhysicsObjectAddressValue", Address: "unPhysicsObjectAddress", Type: "IPhysicsObject" },
];
const g_vecChecks = [
	{
		Name: "GetPhysicsGravityCallback",
		Fragments: ['kGravityConVarName = "sv_gravity";', 'kFailureErrorMessage = "physics.Gravity() failed.";', "if (!pCVarInterface || PhysicsFailure.HasCaught()", "if (!pGravityConVar || PhysicsFailure.HasCaught()"],
		Order: ["RequireCVarInterface(pIsolate)", "if (!pCVarInterface ||", "->FindVar(kGravityConVarName)", "if (!pGravityConVar ||", "->GetFloat();\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(flGravity);"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsEnvironmentFromThis",
		Fragments: ['kPhysicsEnvironmentAddressPropertyName = "Address";', "if (!bHasPhysicsEnvironmentAddressValue || LocalPhysicsEnvironmentAddressValue.IsEmpty() || PhysicsFailure.HasCaught()"],
		Order: ["LocalPhysicsEnvironmentObject = CallbackInformation.This();", "if (LocalPhysicsEnvironmentObject.IsEmpty()", "MakeString(pIsolate, kPhysicsEnvironmentAddressPropertyName)", "if (LocalPhysicsEnvironmentAddressPropertyName.IsEmpty()", "LocalPhysicsEnvironmentObject->Get(LocalContext, LocalPhysicsEnvironmentAddressPropertyName).ToLocal(&LocalPhysicsEnvironmentAddressValue)", "if (!bHasPhysicsEnvironmentAddressValue ||", "GetPhysicsEnvironmentFromValue(LocalPhysicsEnvironmentAddressValue);\n\t\t\tif (PhysicsFailure.HasCaught()", "return pPhysicsEnvironment;"],
		Forbidden: ["GetPhysicsEnvironmentFromValue(CallbackInformation.This())"],
	},
	{
		Name: "RequirePhysicsEnvironmentFromThis",
		Fragments: ["if (!pPhysicsEnvironment) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kInvalidPhysicsEnvironmentErrorMessage);\n\t\t\t\treturn nullptr;"],
		Order: ["GetPhysicsEnvironmentFromThis(CallbackInformation);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysicsEnvironment)", "return pPhysicsEnvironment;"],
		Forbidden: [],
	},
	{
		Name: "CollectPhysicsObjectsForEntity",
		Fragments: ["kMaximumPhysicsEnvironmentCount = 16;", "if (!pPhysicsInterface) {\n\t\t\t\treturn;", "if (nActivePhysicsObjectCount <= 0)", "std::vector<IPhysicsObject*> vecMatchedPhysicsObjects {};", "if (vecMatchedPhysicsObjects.size() > (vecPhysicsObjectsOut.max_size() - vecPhysicsObjectsOut.size()))", "if (pPhysicsObjectGameData == pEntityGameData)", "vecMatchedPhysicsObjects.push_back(pPhysicsObject);"],
		Order: ["if (!pBaseEntity)", "v8::Isolate::GetCurrent()", "GetPhysicsInterface();\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysicsInterface)", "->GetActiveEnvironmentByIndex(nPhysicsEnvironmentIndex);\n\t\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysicsEnvironment)", "->GetActiveObjectCount();\n\t\t\t\tif (PhysicsFailure.HasCaught()", "if (nActivePhysicsObjectCount <= 0)", "std::vector<IPhysicsObject*>(static_cast<std::size_t>(nActivePhysicsObjectCount), nullptr)", "->GetActiveObjects(vecActivePhysicsObjects.data());\n\t\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysicsObject)", "->GetGameData();\n\t\t\t\t\tif (PhysicsFailure.HasCaught()", "vecMatchedPhysicsObjects.push_back(pPhysicsObject);", "vecMatchedPhysicsObjects.size() >", "vecPhysicsObjectsOut.insert(vecPhysicsObjectsOut.end(), vecMatchedPhysicsObjects.begin(), vecMatchedPhysicsObjects.end());"],
		Forbidden: ["vecPhysicsObjectsOut.push_back("],
	},
	{
		Name: "GetPhysicsObjectFromEntityValue",
		Fragments: ["(nPhysicsObjectListIndex < 0)", "if (!pBaseEntity) {\n\t\t\t\treturn nullptr;", "if (unPhysicsObjectListIndex >= vecPhysicsObjects.size())"],
		Order: ["(nPhysicsObjectListIndex < 0)", "GetBaseEntityFromValue(pIsolate, LocalContext, LocalEntityValue);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pBaseEntity)", "CollectPhysicsObjectsForEntity(pBaseEntity, vecPhysicsObjects);\n\t\t\tif (PhysicsFailure.HasCaught()", "static_cast<std::size_t>(nPhysicsObjectListIndex)", "if (unPhysicsObjectListIndex >= vecPhysicsObjects.size())", "return vecPhysicsObjects[unPhysicsObjectListIndex];"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsObjectFromValue",
		Fragments: ['kPhysicsObjectAddressPropertyName = "Address";', "kDefaultPhysicsObjectListIndex = 0;", "if (LocalPhysicsObjectValue->IsUndefined() || LocalPhysicsObjectValue->IsNull())", "if (LocalPhysicsObjectCandidate.IsEmpty() || LocalPhysicsObjectAddressPropertyName.IsEmpty() || PhysicsFailure.HasCaught()"],
		Order: ["LocalPhysicsObjectValue->IsObject()", "MakeString(pIsolate, kPhysicsObjectAddressPropertyName)", "if (LocalPhysicsObjectCandidate.IsEmpty()", "LocalPhysicsObjectCandidate->Get(LocalContext, LocalPhysicsObjectAddressPropertyName).ToLocal(&LocalPhysicsObjectAddressValue)", "if (!bHasPhysicsObjectAddressValue || PhysicsFailure.HasCaught()", "if (!LocalPhysicsObjectAddressValue.IsEmpty() && LocalPhysicsObjectAddressValue->IsBigInt())", "return GetPhysicsObjectFromAddressValue(LocalPhysicsObjectAddressValue);", "if (LocalPhysicsObjectValue->IsBigInt())", "return GetPhysicsObjectFromAddressValue(LocalPhysicsObjectValue);", "GetPhysicsObjectFromEntityValue(pIsolate, LocalContext, LocalPhysicsObjectValue, kDefaultPhysicsObjectListIndex);\n\t\t\tif (PhysicsFailure.HasCaught()", "return pPhysicsObject;"],
		Forbidden: ["IsNumber()", "NumberValue("],
	},
	{
		Name: "GetPhysicsObjectFromThis",
		Fragments: ["if (LocalContext.IsEmpty())"],
		Order: ["pIsolate->GetCurrentContext()", "if (LocalContext.IsEmpty())", "GetPhysicsObjectFromValue(pIsolate, LocalContext, CallbackInformation.This());\n\t\t\tif (PhysicsFailure.HasCaught()", "return pPhysicsObject;"],
		Forbidden: ["return GetPhysicsObjectFromValue("],
	},
	{
		Name: "RequirePhysicsObjectFromThis",
		Fragments: ["if (!pPhysicsObject) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kInvalidPhysicsObjectErrorMessage);\n\t\t\t\treturn nullptr;"],
		Order: ["GetPhysicsObjectFromThis(CallbackInformation);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysicsObject)", "return pPhysicsObject;"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsVectorFromValue",
		Fragments: ["kPhysicsVectorXPropertyName = \"X\";", "kPhysicsVectorYPropertyName = \"Y\";", "kPhysicsVectorZPropertyName = \"Z\";", "if (!bHasVectorX || !bHasVectorY || !bHasVectorZ) {\n\t\t\t\treturn false;"],
		Order: ["!LocalPhysicsVectorValue->IsObject()", "if (LocalPhysicsVectorObject.IsEmpty()", "!OptionalFloatFromObject(pIsolate, LocalContext, LocalPhysicsVectorObject, kPhysicsVectorXPropertyName, kInvalidPhysicsVectorXErrorMessage, bHasVectorX, flVectorX) || PhysicsFailure.HasCaught()", "!OptionalFloatFromObject(pIsolate, LocalContext, LocalPhysicsVectorObject, kPhysicsVectorYPropertyName, kInvalidPhysicsVectorYErrorMessage, bHasVectorY, flVectorY) || PhysicsFailure.HasCaught()", "!OptionalFloatFromObject(pIsolate, LocalContext, LocalPhysicsVectorObject, kPhysicsVectorZPropertyName, kInvalidPhysicsVectorZErrorMessage, bHasVectorZ, flVectorZ) || PhysicsFailure.HasCaught()", "if (!bHasVectorX || !bHasVectorY || !bHasVectorZ) {\n\t\t\t\treturn false;", "VectorValueOut.Init(flVectorX, flVectorY, flVectorZ);"],
		Forbidden: ["ToNumber(", "NumberValue("],
	},
	{
		Name: "GetPhysicsAngleFromValue",
		Fragments: ["kPhysicsAnglePitchPropertyName = \"Pitch\";", "kPhysicsAngleYawPropertyName = \"Yaw\";", "kPhysicsAngleRollPropertyName = \"Roll\";", "if (!bHasAnglePitch || !bHasAngleYaw || !bHasAngleRoll) {\n\t\t\t\treturn false;"],
		Order: ["!LocalPhysicsAngleValue->IsObject()", "if (LocalPhysicsAngleObject.IsEmpty()", "!OptionalFloatFromObject(pIsolate, LocalContext, LocalPhysicsAngleObject, kPhysicsAnglePitchPropertyName, kInvalidPhysicsAnglePitchErrorMessage, bHasAnglePitch, flAnglePitch) || PhysicsFailure.HasCaught()", "!OptionalFloatFromObject(pIsolate, LocalContext, LocalPhysicsAngleObject, kPhysicsAngleYawPropertyName, kInvalidPhysicsAngleYawErrorMessage, bHasAngleYaw, flAngleYaw) || PhysicsFailure.HasCaught()", "!OptionalFloatFromObject(pIsolate, LocalContext, LocalPhysicsAngleObject, kPhysicsAngleRollPropertyName, kInvalidPhysicsAngleRollErrorMessage, bHasAngleRoll, flAngleRoll) || PhysicsFailure.HasCaught()", "if (!bHasAnglePitch || !bHasAngleYaw || !bHasAngleRoll) {\n\t\t\t\treturn false;", "PhysicsAngleValueOut.Init(flAnglePitch, flAngleYaw, flAngleRoll);"],
		Forbidden: ["ToNumber(", "NumberValue("],
	},
	{
		Name: "GetPhysicsOperationFromCallback",
		Fragments: ["std::is_enum_v<TOperation>", "std::is_same_v<std::underlying_type_t<TOperation>, int>"],
		Order: ["LocalOperationMetadata = CallbackInformation.Data();", "if (LocalOperationMetadata.IsEmpty() || !LocalOperationMetadata->IsInt32() || PhysicsFailure.HasCaught()", "nOperationValue = LocalOperationMetadata.As<v8::Int32>()->Value();\n\t\t\tif (PhysicsFailure.HasCaught()", "OperationOut = static_cast<TOperation>(nOperationValue);"],
		Forbidden: ["Int32Value(LocalContext)"],
	},
	{
		Name: "GetPhysicsBooleanFromValue",
		Fragments: ["!pszTypeErrorMessage"],
		Order: ["if (LocalBooleanValue.IsEmpty() || !LocalBooleanValue->IsBoolean() || PhysicsFailure.HasCaught()", "const bool bBooleanValue = LocalBooleanValue->BooleanValue(pIsolate);\n\t\t\tif (PhysicsFailure.HasCaught()", "bBooleanValueOut = bBooleanValue;"],
		Forbidden: ["bBooleanValueOut = LocalBooleanValue->BooleanValue("],
	},
	{
		Name: "GetPhysicsInt32FromValue",
		Fragments: ["!pszTypeErrorMessage"],
		Order: ["if (LocalInt32Value.IsEmpty() || !LocalInt32Value->IsInt32() || PhysicsFailure.HasCaught()", "int nInt32Value = 0;", "!GetInt32Argument(pIsolate, LocalContext, LocalInt32Value, pszTypeErrorMessage, nInt32Value) || PhysicsFailure.HasCaught()", "nInt32ValueOut = nInt32Value;"],
		Forbidden: ["GetInt32Argument(pIsolate, LocalContext, LocalInt32Value, pszTypeErrorMessage, nInt32ValueOut)"],
	},
	{
		Name: "GetPhysicsUInt32FromValue",
		Fragments: ["!pszTypeErrorMessage"],
		Order: ["if (LocalUInt32Value.IsEmpty() || !LocalUInt32Value->IsUint32() || PhysicsFailure.HasCaught()", "std::uint32_t unUInt32Value = 0;", "!GetUInt32Argument(pIsolate, LocalContext, LocalUInt32Value, pszTypeErrorMessage, unUInt32Value) || PhysicsFailure.HasCaught()", "unUInt32ValueOut = unUInt32Value;"],
		Forbidden: ["GetUInt32Argument(pIsolate, LocalContext, LocalUInt32Value, pszTypeErrorMessage, unUInt32ValueOut)"],
	},
	{
		Name: "GetPhysicsFloatFromValue",
		Fragments: ["!pszTypeErrorMessage"],
		Order: ["if (LocalFloatValue.IsEmpty() || !LocalFloatValue->IsNumber() || PhysicsFailure.HasCaught()", "float flFloatValue = 0.0F;", "!GetFloatArgument(pIsolate, LocalContext, LocalFloatValue, pszTypeErrorMessage, flFloatValue) || PhysicsFailure.HasCaught()", "flFloatValueOut = flFloatValue;"],
		Forbidden: ["GetFloatArgument(pIsolate, LocalContext, LocalFloatValue, pszTypeErrorMessage, flFloatValueOut)"],
	},
	{
		Name: "GetPhysicsUInt16FromValue",
		Fragments: ["sizeof(unsigned short) == sizeof(std::uint16_t)"],
		Order: ["!GetPhysicsUInt32FromValue(pIsolate, LocalContext, LocalUInt16Value, pszTypeErrorMessage, unUInt32Value) || PhysicsFailure.HasCaught()", "if (unUInt32Value > static_cast<std::uint32_t>(std::numeric_limits<unsigned short>::max()))", "unUInt16ValueOut = static_cast<unsigned short>(unUInt32Value);"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsObjectFromLiveComponentMetadata",
		Fragments: ["auto* const pPhysicsObject = static_cast<IPhysicsObject*>(LocalExternalPhysicsLiveComponentMetadata->Value());"],
		Order: ["if (LocalPhysicsLiveComponentMetadata.IsEmpty() || !LocalPhysicsLiveComponentMetadata->IsExternal() || PhysicsFailure.HasCaught()", "LocalExternalPhysicsLiveComponentMetadata = LocalPhysicsLiveComponentMetadata.As<v8::External>();", "if (LocalExternalPhysicsLiveComponentMetadata.IsEmpty() || PhysicsFailure.HasCaught()", "LocalExternalPhysicsLiveComponentMetadata->Value()", "if (!pPhysicsObject)", "return pPhysicsObject;"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsLiveComponentCallback",
		Fragments: ["kPhysicsVectorComponentCount = 3;", "kPhysicsVectorComponentIndex = kPhysicsLiveComponentOperationValue % kPhysicsVectorComponentCount;", "static_assert((kPhysicsLiveComponentOperationValue >= static_cast<int>(PhysicsLiveComponentOperation::PhysicsLivePositionX)) && (kPhysicsLiveComponentOperationValue <= static_cast<int>(PhysicsLiveComponentOperation::PhysicsLiveMassCenterZ))", "static_assert((kPhysicsVectorComponentIndex >= 0) && (kPhysicsVectorComponentIndex < kPhysicsVectorComponentCount)", "GetPhysicsVectorComponent(PositionVector, kPhysicsVectorComponentIndex);", "GetPhysicsVectorComponent(AngleValue, kPhysicsVectorComponentIndex);", "GetPhysicsVectorComponent(LinearVelocity, kPhysicsVectorComponentIndex);", "GetPhysicsVectorComponent(AngularVelocity, kPhysicsVectorComponentIndex);", "GetPhysicsVectorComponent(InertiaVector, kPhysicsVectorComponentIndex);", "GetPhysicsVectorComponent(InverseInertiaVector, kPhysicsVectorComponentIndex);", "GetPhysicsVectorComponent(MassCenterVector, kPhysicsVectorComponentIndex);"],
		Order: ["GetPhysicsObjectFromLiveComponentMetadata(pIsolate, PropertyInformation.Data());", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "pPhysicsObject->GetPosition(&PositionVector, &AngleValue);\n\t\t\t\tif (PhysicsFailure.HasCaught()", "pPhysicsObject->GetVelocity(&LinearVelocity, &AngularVelocity);\n\t\t\t\tif (PhysicsFailure.HasCaught()", "pPhysicsObject->GetInertia();\n\t\t\t\tif (PhysicsFailure.HasCaught()", "pPhysicsObject->GetInvInertia();\n\t\t\t\tif (PhysicsFailure.HasCaught()", "pPhysicsObject->GetMassCenterLocalSpace();\n\t\t\tif (PhysicsFailure.HasCaught()"],
		Forbidden: ["ThrowError("],
	},
	{
		Name: "InstallPhysicsValue",
		Fragments: ["if (!pIsolate || LocalContext.IsEmpty() || LocalTargetObject.IsEmpty() || !pszPropertyName)", 'kFailureErrorMessage = "physics record property installation failed.";'],
		Order: ["if (LocalValue.IsEmpty() || PhysicsFailure.HasCaught()", "MakeString(pIsolate, pszPropertyName);", "if (LocalPropertyName.IsEmpty() || PhysicsFailure.HasCaught()", "v8::Maybe<bool> const MaybeCreationResult = LocalTargetObject->CreateDataProperty(LocalContext, LocalPropertyName, LocalValue);", "if (!MaybeCreationResult.FromMaybe(false) || PhysicsFailure.HasCaught()", "return true;"],
		Forbidden: ["->Set(", "return LocalTargetObject->"],
	},
	{
		Name: "SetPhysicsLiveComponentCallback",
		Fragments: ["kPhysicsVectorComponentCount = 3;", "kPhysicsVectorComponentIndex = kPhysicsLiveComponentOperationValue % kPhysicsVectorComponentCount;", "kTeleportPhysicsObject = false;", "static_assert((kPhysicsLiveComponentOperationValue >= static_cast<int>(PhysicsLiveComponentOperation::PhysicsLivePositionX)) && (kPhysicsLiveComponentOperationValue <= static_cast<int>(PhysicsLiveComponentOperation::PhysicsLiveMassCenterZ))", "static_assert((kPhysicsVectorComponentIndex >= 0) && (kPhysicsVectorComponentIndex < kPhysicsVectorComponentCount)", "SetPhysicsVectorComponent(PositionVector, kPhysicsVectorComponentIndex, flPhysicsLiveComponentValue);", "SetPhysicsVectorComponent(AngleValue, kPhysicsVectorComponentIndex, flPhysicsLiveComponentValue);", "SetPhysicsVectorComponent(LinearVelocity, kPhysicsVectorComponentIndex, flPhysicsLiveComponentValue);", "SetPhysicsVectorComponent(AngularVelocity, kPhysicsVectorComponentIndex, flPhysicsLiveComponentValue);", "SetPhysicsVectorComponent(InertiaVector, kPhysicsVectorComponentIndex, flPhysicsLiveComponentValue);", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kReadOnlyPhysicsVectorErrorMessage);"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsFloatFromValue(pIsolate, LocalContext, LocalPhysicsLiveComponentValue, kInvalidPhysicsLiveComponentValueErrorMessage, flPhysicsLiveComponentValue) || PhysicsFailure.HasCaught()", "GetPhysicsObjectFromLiveComponentMetadata(pIsolate, PropertyInformation.Data());", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "pPhysicsObject->GetPosition(&PositionVector, &AngleValue);\n\t\t\t\tif (PhysicsFailure.HasCaught()", "pPhysicsObject->SetPosition(PositionVector, AngleValue, kTeleportPhysicsObject);\n\t\t\t\tif (PhysicsFailure.HasCaught()", "pPhysicsObject->GetVelocity(&LinearVelocity, &AngularVelocity);\n\t\t\t\tif (PhysicsFailure.HasCaught()", "pPhysicsObject->SetVelocity(&LinearVelocity, &AngularVelocity);\n\t\t\t\tif (PhysicsFailure.HasCaught()", "pPhysicsObject->GetInertia();\n\t\t\t\tif (PhysicsFailure.HasCaught()", "pPhysicsObject->SetInertia(InertiaVector);\n\t\t\t\tif (PhysicsFailure.HasCaught()"],
		Forbidden: ["ThrowError(", "->SetInvInertia(", "->SetMassCenterLocalSpace("],
	},
	{
		Name: "InstallPhysicsLiveComponent",
		Fragments: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "GetPhysicsLiveComponentCallback<ComponentOperation>, SetPhysicsLiveComponentCallback<ComponentOperation>, LocalPhysicsLiveComponentMetadata);"],
		Order: ["MakeString(pIsolate, pszPhysicsLiveComponentPropertyName);", "if (LocalPhysicsLiveComponentPropertyName.IsEmpty() || PhysicsFailure.HasCaught()", "v8::External::New(pIsolate, pPhysicsObject);", "if (LocalPhysicsLiveComponentMetadata.IsEmpty() || PhysicsFailure.HasCaught()", "v8::Maybe<bool> const MaybeInstallationResult = LocalPhysicsLiveComponentTargetObject->SetNativeDataProperty(", "if (!MaybeInstallationResult.FromMaybe(false) || PhysicsFailure.HasCaught()", "return true;"],
		Forbidden: ["return LocalPhysicsLiveComponentTargetObject->", "return MaybeInstallationResult.FromMaybe("],
	},
	{
		Name: "MakePhysicsLiveVectorObject",
		Fragments: ['kPhysicsLiveVectorXPropertyName = "X";', 'kPhysicsLiveVectorYPropertyName = "Y";', 'kPhysicsLiveVectorZPropertyName = "Z";'],
		Order: ["if (LocalPhysicsLiveVectorObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsLiveComponent<XComponentOperation>(pIsolate, LocalContext, LocalPhysicsLiveVectorObject, kPhysicsLiveVectorXPropertyName, pPhysicsObject) || PhysicsFailure.HasCaught()", "!InstallPhysicsLiveComponent<YComponentOperation>(pIsolate, LocalContext, LocalPhysicsLiveVectorObject, kPhysicsLiveVectorYPropertyName, pPhysicsObject) || PhysicsFailure.HasCaught()", "!InstallPhysicsLiveComponent<ZComponentOperation>(pIsolate, LocalContext, LocalPhysicsLiveVectorObject, kPhysicsLiveVectorZPropertyName, pPhysicsObject) || PhysicsFailure.HasCaught()", "return LocalPhysicsLiveVectorObject;"],
		Forbidden: ["SetValue(", "SetNumber("],
	},
	{
		Name: "MakePhysicsVectorObject",
		Fragments: ['kPhysicsVectorXPropertyName = "X";', 'kPhysicsVectorYPropertyName = "Y";', 'kPhysicsVectorZPropertyName = "Z";'],
		Order: ["if (LocalPhysicsVectorObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsVectorObject, kPhysicsVectorXPropertyName, v8::Number::New(pIsolate, static_cast<double>(VectorValue.x))) || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsVectorObject, kPhysicsVectorYPropertyName, v8::Number::New(pIsolate, static_cast<double>(VectorValue.y))) || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsVectorObject, kPhysicsVectorZPropertyName, v8::Number::New(pIsolate, static_cast<double>(VectorValue.z))) || PhysicsFailure.HasCaught()", "return LocalPhysicsVectorObject;"],
		Forbidden: ["SetValue(", "SetNumber("],
	},
	{
		Name: "MakePhysicsPositionObject",
		Fragments: ['kPhysicsPositionVectorPropertyName = "Position";', 'kPhysicsAnglesVectorPropertyName = "Angles";', 'kPhysicsAnglePitchPropertyName = "Pitch";', 'kPhysicsAngleYawPropertyName = "Yaw";', 'kPhysicsAngleRollPropertyName = "Roll";', "MakePhysicsLiveVectorObject<PhysicsLiveComponentOperation::PhysicsLivePositionX, PhysicsLiveComponentOperation::PhysicsLivePositionY, PhysicsLiveComponentOperation::PhysicsLivePositionZ>(pIsolate, LocalContext, pPhysicsObject);"],
		Order: ["if (LocalPhysicsPositionObject.IsEmpty() || PhysicsFailure.HasCaught()", "if (LocalPhysicsPositionVectorObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsPositionObject, kPhysicsPositionVectorPropertyName, LocalPhysicsPositionVectorObject) || PhysicsFailure.HasCaught()", "if (LocalPhysicsAngleObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsLiveComponent<PhysicsLiveComponentOperation::PhysicsLiveAngleX>(pIsolate, LocalContext, LocalPhysicsAngleObject, kPhysicsAnglePitchPropertyName, pPhysicsObject) || PhysicsFailure.HasCaught()", "!InstallPhysicsLiveComponent<PhysicsLiveComponentOperation::PhysicsLiveAngleY>(pIsolate, LocalContext, LocalPhysicsAngleObject, kPhysicsAngleYawPropertyName, pPhysicsObject) || PhysicsFailure.HasCaught()", "!InstallPhysicsLiveComponent<PhysicsLiveComponentOperation::PhysicsLiveAngleZ>(pIsolate, LocalContext, LocalPhysicsAngleObject, kPhysicsAngleRollPropertyName, pPhysicsObject) || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsPositionObject, kPhysicsAnglesVectorPropertyName, LocalPhysicsAngleObject) || PhysicsFailure.HasCaught()", "return LocalPhysicsPositionObject;"],
		Forbidden: ["SetValue(", "SetNumber("],
	},
	{
		Name: "MakePhysicsVelocityObject",
		Fragments: ['kPhysicsLinearVelocityVectorPropertyName = "LinearVelocity";', 'kPhysicsAngularVelocityVectorPropertyName = "AngularVelocity";', "MakePhysicsLiveVectorObject<PhysicsLiveComponentOperation::PhysicsLiveLinearVelocityX, PhysicsLiveComponentOperation::PhysicsLiveLinearVelocityY, PhysicsLiveComponentOperation::PhysicsLiveLinearVelocityZ>(pIsolate, LocalContext, pPhysicsObject);", "MakePhysicsLiveVectorObject<PhysicsLiveComponentOperation::PhysicsLiveAngularVelocityX, PhysicsLiveComponentOperation::PhysicsLiveAngularVelocityY, PhysicsLiveComponentOperation::PhysicsLiveAngularVelocityZ>(pIsolate, LocalContext, pPhysicsObject);"],
		Order: ["if (LocalPhysicsVelocityObject.IsEmpty() || PhysicsFailure.HasCaught()", "if (LocalPhysicsLinearVelocityObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsVelocityObject, kPhysicsLinearVelocityVectorPropertyName, LocalPhysicsLinearVelocityObject) || PhysicsFailure.HasCaught()", "if (LocalPhysicsAngularVelocityObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsVelocityObject, kPhysicsAngularVelocityVectorPropertyName, LocalPhysicsAngularVelocityObject) || PhysicsFailure.HasCaught()", "return LocalPhysicsVelocityObject;"],
		Forbidden: ["SetValue(", "SetNumber("],
	},
	{
		Name: "MakePhysicsInertiaObject",
		Fragments: ["MakePhysicsLiveVectorObject<PhysicsLiveComponentOperation::PhysicsLiveInertiaX, PhysicsLiveComponentOperation::PhysicsLiveInertiaY, PhysicsLiveComponentOperation::PhysicsLiveInertiaZ>(pIsolate, LocalContext, pPhysicsObject);"],
		Order: ["LocalPhysicsInertiaObject = MakePhysicsLiveVectorObject<", "if (LocalPhysicsInertiaObject.IsEmpty() || PhysicsFailure.HasCaught()", "return LocalPhysicsInertiaObject;"],
		Forbidden: ["return MakePhysicsLiveVectorObject<"],
	},
	{
		Name: "MakePhysicsInverseInertiaObject",
		Fragments: ["MakePhysicsLiveVectorObject<PhysicsLiveComponentOperation::PhysicsLiveInverseInertiaX, PhysicsLiveComponentOperation::PhysicsLiveInverseInertiaY, PhysicsLiveComponentOperation::PhysicsLiveInverseInertiaZ>(pIsolate, LocalContext, pPhysicsObject);"],
		Order: ["LocalPhysicsInverseInertiaObject = MakePhysicsLiveVectorObject<", "if (LocalPhysicsInverseInertiaObject.IsEmpty() || PhysicsFailure.HasCaught()", "return LocalPhysicsInverseInertiaObject;"],
		Forbidden: ["return MakePhysicsLiveVectorObject<"],
	},
	{
		Name: "MakePhysicsMassCenterObject",
		Fragments: ["MakePhysicsLiveVectorObject<PhysicsLiveComponentOperation::PhysicsLiveMassCenterX, PhysicsLiveComponentOperation::PhysicsLiveMassCenterY, PhysicsLiveComponentOperation::PhysicsLiveMassCenterZ>(pIsolate, LocalContext, pPhysicsObject);"],
		Order: ["LocalPhysicsMassCenterObject = MakePhysicsLiveVectorObject<", "if (LocalPhysicsMassCenterObject.IsEmpty() || PhysicsFailure.HasCaught()", "return LocalPhysicsMassCenterObject;"],
		Forbidden: ["return MakePhysicsLiveVectorObject<"],
	},
	{
		Name: "GetPhysicsObjectBooleanStateCallback",
		Fragments: ["bPhysicsObjectBooleanState = pPhysicsObject->IsStatic();", "bPhysicsObjectBooleanState = pPhysicsObject->IsAsleep();", "bPhysicsObjectBooleanState = pPhysicsObject->IsTrigger();", "bPhysicsObjectBooleanState = pPhysicsObject->IsFluid();", "bPhysicsObjectBooleanState = pPhysicsObject->IsHinged();", "#if !defined(SOURCEJS_OLD_CONSOLE_API)", "bPhysicsObjectBooleanState = pPhysicsObject->IsCollisionEnabled();", "bPhysicsObjectBooleanState = pPhysicsObject->IsGravityEnabled();", "bPhysicsObjectBooleanState = pPhysicsObject->IsDragEnabled();", "bPhysicsObjectBooleanState = pPhysicsObject->IsMotionEnabled();", "#endif // !defined(SOURCEJS_OLD_CONSOLE_API)", "bPhysicsObjectBooleanState = pPhysicsObject->IsMoveable();"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "!GetPhysicsOperationFromCallback(CallbackInformation, BooleanOperation) || PhysicsFailure.HasCaught()", "bool bPhysicsObjectBooleanState = false;", "switch (BooleanOperation)", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kUnknownPhysicsObjectBooleanOperationErrorMessage);", "if (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(bPhysicsObjectBooleanState);"],
		Forbidden: ["GetReturnValue().Set(pPhysicsObject->"],
	},
	{
		Name: "IsPhysicsObjectAttachedToConstraintCallback",
		Fragments: ["kDefaultPhysicsConstraintExternalOnly = false;", "if (((CallbackInformation.Length() > kPhysicsConstraintExternalOnlyArgumentIndex) && !GetPhysicsBooleanFromValue(pIsolate, CallbackInformation[kPhysicsConstraintExternalOnlyArgumentIndex], kPhysicsConstraintExternalOnlyArgumentErrorMessage, bPhysicsConstraintExternalOnly)) || PhysicsFailure.HasCaught()"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "bool bPhysicsConstraintExternalOnly = kDefaultPhysicsConstraintExternalOnly;", "!GetPhysicsBooleanFromValue(", "const bool bPhysicsObjectAttachedToConstraint = pPhysicsObject->IsAttachedToConstraint(bPhysicsConstraintExternalOnly);\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(bPhysicsObjectAttachedToConstraint);"],
		Forbidden: ["GetReturnValue().Set(pPhysicsObject->"],
	},
	{
		Name: "SetPhysicsObjectBooleanStateCallback",
		Fragments: ["kDefaultPhysicsObjectBooleanSetterEnabled = true;", "static_assert(kPhysicsObjectBooleanSetterArgumentErrorMessageCount == (static_cast<std::size_t>(PhysicsObjectBooleanSetterOperation::PhysicsObjectSetAsleep) + 1)", "pPhysicsObject->EnableCollisions(bPhysicsObjectBooleanSetterEnabled);", "pPhysicsObject->EnableGravity(bPhysicsObjectBooleanSetterEnabled);", "pPhysicsObject->EnableDrag(bPhysicsObjectBooleanSetterEnabled);", "pPhysicsObject->EnableMotion(bPhysicsObjectBooleanSetterEnabled);", "pPhysicsObject->Sleep();", "pPhysicsObject->Wake();"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "!GetPhysicsOperationFromCallback(CallbackInformation, BooleanSetterOperation) || PhysicsFailure.HasCaught()", "if ((BooleanSetterOperation < PhysicsObjectBooleanSetterOperation::PhysicsObjectSetCollisions) || (BooleanSetterOperation > PhysicsObjectBooleanSetterOperation::PhysicsObjectSetAsleep))", "static_cast<std::size_t>(BooleanSetterOperation)", "if (((CallbackInformation.Length() > kPhysicsObjectBooleanSetterEnabledArgumentIndex) && !GetPhysicsBooleanFromValue(", "switch (BooleanSetterOperation)", "if (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsObjectNumberCallback",
		Fragments: ["const unsigned short unPhysicsObjectGameFlags = pPhysicsObject->GetGameFlags();", "const unsigned short unPhysicsObjectGameIndex = pPhysicsObject->GetGameIndex();", "const unsigned short unPhysicsObjectCallbackFlags = pPhysicsObject->GetCallbackFlags();", "const float flPhysicsObjectMass = pPhysicsObject->GetMass();", "const int nPhysicsObjectMaterialIndex = pPhysicsObject->GetMaterialIndex();", "const unsigned int unPhysicsObjectContents = pPhysicsObject->GetContents();", "const float flPhysicsObjectSphereRadius = pPhysicsObject->GetSphereRadius();", "v8::Integer::NewFromUnsigned(pIsolate, unPhysicsObjectGameFlags)", "v8::Integer::NewFromUnsigned(pIsolate, unPhysicsObjectGameIndex)", "v8::Integer::NewFromUnsigned(pIsolate, unPhysicsObjectCallbackFlags)", "v8::Integer::NewFromUnsigned(pIsolate, unPhysicsObjectContents)"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "!GetPhysicsOperationFromCallback(CallbackInformation, NumberOperation) || PhysicsFailure.HasCaught()", "pPhysicsObject->GetGameFlags();\n\t\t\t\t\tif (PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectGameFlagsValue.IsEmpty() || PhysicsFailure.HasCaught()", "GetReturnValue().Set(LocalPhysicsObjectGameFlagsValue);", "pPhysicsObject->GetGameIndex();\n\t\t\t\t\tif (PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectGameIndexValue.IsEmpty() || PhysicsFailure.HasCaught()", "GetReturnValue().Set(LocalPhysicsObjectGameIndexValue);", "pPhysicsObject->GetCallbackFlags();\n\t\t\t\t\tif (PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectCallbackFlagsValue.IsEmpty() || PhysicsFailure.HasCaught()", "GetReturnValue().Set(LocalPhysicsObjectCallbackFlagsValue);", "pPhysicsObject->GetMass();\n\t\t\t\t\tif (PhysicsFailure.HasCaught()", "GetReturnValue().Set(flPhysicsObjectMass);", "pPhysicsObject->GetMaterialIndex();\n\t\t\t\t\tif (PhysicsFailure.HasCaught()", "GetReturnValue().Set(nPhysicsObjectMaterialIndex);", "pPhysicsObject->GetContents();\n\t\t\t\t\tif (PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectContentsValue.IsEmpty() || PhysicsFailure.HasCaught()", "GetReturnValue().Set(LocalPhysicsObjectContentsValue);", "pPhysicsObject->GetSphereRadius();\n\t\t\t\t\tif (PhysicsFailure.HasCaught()", "GetReturnValue().Set(flPhysicsObjectSphereRadius);", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kUnknownPhysicsObjectNumberOperationErrorMessage);"],
		Forbidden: ["GetReturnValue().Set(pPhysicsObject->", "v8::Integer::NewFromUnsigned(pIsolate, pPhysicsObject->"],
	},
	{
		Name: "SetPhysicsObjectSphereRadiusCallback",
		Fragments: ["kPhysicsObjectSphereRadiusRequiredArgumentCount = 1;", "auto* const pPhysicsObject = static_cast<TPhysicsObject*>(RequirePhysicsObjectFromThis(CallbackInformation));"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() < kPhysicsObjectSphereRadiusRequiredArgumentCount)", "!GetPhysicsFloatFromValue(pIsolate, LocalContext, CallbackInformation[kPhysicsObjectSphereRadiusArgumentIndex], kInvalidPhysicsObjectSphereRadiusErrorMessage, flPhysicsObjectSphereRadius) || PhysicsFailure.HasCaught()", "pPhysicsObject->SetSphereRadius(flPhysicsObjectSphereRadius);\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	},
	{
		Name: "SetPhysicsObjectNumberCallback",
		Fragments: ["kPhysicsObjectNumberSetterRequiredArgumentCount = 1;", "static_assert(kPhysicsObjectNumberSetterValueArgumentErrorMessageCount == (static_cast<std::size_t>(PhysicsObjectNumberOperation::PhysicsObjectNumberContents) + 1)", "pPhysicsObject->SetGameFlags(unPhysicsObjectGameFlags);", "pPhysicsObject->SetGameIndex(unPhysicsObjectGameIndex);", "pPhysicsObject->SetCallbackFlags(unPhysicsObjectCallbackFlags);", "pPhysicsObject->SetMass(flPhysicsObjectMass);", "pPhysicsObject->SetMaterialIndex(nPhysicsObjectMaterialIndex);", "pPhysicsObject->SetContents(unPhysicsObjectContents);"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "!GetPhysicsOperationFromCallback(CallbackInformation, NumberSetterOperation) || PhysicsFailure.HasCaught()", "if ((NumberSetterOperation < PhysicsObjectNumberOperation::PhysicsObjectNumberGameFlags) || (NumberSetterOperation > PhysicsObjectNumberOperation::PhysicsObjectNumberContents))", "static_cast<std::size_t>(NumberSetterOperation)", "if (CallbackInformation.Length() < kPhysicsObjectNumberSetterRequiredArgumentCount)", "if (LocalPhysicsObjectNumberSetterValueArgument.IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsUInt16FromValue(pIsolate, LocalContext, LocalPhysicsObjectNumberSetterValueArgument, pszPhysicsObjectNumberSetterValueArgumentErrorMessage, unPhysicsObjectGameFlags) || PhysicsFailure.HasCaught()", "!GetPhysicsUInt16FromValue(pIsolate, LocalContext, LocalPhysicsObjectNumberSetterValueArgument, pszPhysicsObjectNumberSetterValueArgumentErrorMessage, unPhysicsObjectGameIndex) || PhysicsFailure.HasCaught()", "!GetPhysicsUInt16FromValue(pIsolate, LocalContext, LocalPhysicsObjectNumberSetterValueArgument, pszPhysicsObjectNumberSetterValueArgumentErrorMessage, unPhysicsObjectCallbackFlags) || PhysicsFailure.HasCaught()", "!GetPhysicsFloatFromValue(pIsolate, LocalContext, LocalPhysicsObjectNumberSetterValueArgument, pszPhysicsObjectNumberSetterValueArgumentErrorMessage, flPhysicsObjectMass) || PhysicsFailure.HasCaught()", "!GetPhysicsInt32FromValue(pIsolate, LocalContext, LocalPhysicsObjectNumberSetterValueArgument, pszPhysicsObjectNumberSetterValueArgumentErrorMessage, nPhysicsObjectMaterialIndex) || PhysicsFailure.HasCaught()", "!GetPhysicsUInt32FromValue(pIsolate, LocalContext, LocalPhysicsObjectNumberSetterValueArgument, pszPhysicsObjectNumberSetterValueArgumentErrorMessage, unPhysicsObjectContents) || PhysicsFailure.HasCaught()", "if (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	},
];

for (const Getter of [
	{ Name: "GetPhysicsObjectInertiaCallback", Builder: "MakePhysicsInertiaObject", Value: "LocalPhysicsObjectInertiaObject" },
	{ Name: "GetPhysicsObjectInverseInertiaCallback", Builder: "MakePhysicsInverseInertiaObject", Value: "LocalPhysicsObjectInverseInertiaObject" },
	{ Name: "GetPhysicsObjectMassCenterLocalSpaceCallback", Builder: "MakePhysicsMassCenterObject", Value: "LocalPhysicsObjectMassCenterObject" },
	{ Name: "GetPhysicsObjectPositionCallback", Builder: "MakePhysicsPositionObject", Value: "LocalPhysicsObjectPositionObject" },
	{ Name: "GetPhysicsObjectVelocityCallback", Builder: "MakePhysicsVelocityObject", Value: "LocalPhysicsObjectVelocityObject" },
]) {
	g_vecChecks.push({
		Name: Getter.Name,
		Fragments: [],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", Getter.Value + " = " + Getter.Builder + "(pIsolate, LocalContext, pPhysicsObject);", "if (" + Getter.Value + ".IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(" + Getter.Value + ");"],
		Forbidden: [],
	});
}

g_vecChecks.push(
	{
		Name: "GetPhysicsObjectGameDataCallback",
		Fragments: ["sizeof(std::uintptr_t) <= sizeof(std::uint64_t)", "reinterpret_cast<std::uintptr_t>(pPhysicsObjectGameData)", "static_cast<std::uint64_t>(unPhysicsObjectGameDataAddress)"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "pPhysicsObject->GetGameData();\n\t\t\tif (PhysicsFailure.HasCaught()", "v8::BigInt::NewFromUnsigned(", "if (LocalPhysicsObjectGameDataAddressValue.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsObjectGameDataAddressValue);"],
		Forbidden: ["v8::Number::", "if (!pPhysicsObjectGameData)", "unPhysicsObjectGameDataAddress == 0"],
	},
	{
		Name: "SetPhysicsObjectGameDataCallback",
		Fragments: ["unPhysicsObjectGameDataAddress ? reinterpret_cast<void*>(unPhysicsObjectGameDataAddress) : nullptr;", "kPhysicsObjectGameDataRequiredArgumentCount = 1;"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() < kPhysicsObjectGameDataRequiredArgumentCount)", "!GetAddressSizedUnsignedIntegerFromValue(CallbackInformation[kPhysicsObjectGameDataAddressArgumentIndex], unPhysicsObjectGameDataAddress) || PhysicsFailure.HasCaught()", "pPhysicsObject->SetGameData(pPhysicsObjectGameData);\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: ["NumberValue(", "unPhysicsObjectGameDataAddress == 0"],
	},
	{
		Name: "SetPhysicsObjectInertiaCallback",
		Fragments: ["kPhysicsObjectInertiaRequiredArgumentCount = 1;", "if (CallbackInformation.Length() < kPhysicsObjectInertiaRequiredArgumentCount) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectInertiaArgumentErrorMessage);\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() < kPhysicsObjectInertiaRequiredArgumentCount)", "if (LocalPhysicsObjectInertiaArgument.IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsObjectInertiaArgument, InertiaVector) || PhysicsFailure.HasCaught()", "pPhysicsObject->SetInertia(InertiaVector);\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	},
	{
		Name: "SetPhysicsObjectPositionCallback",
		Fragments: ["kDefaultPhysicsObjectTeleport = false;", 'kPhysicsObjectPositionVectorPropertyName = "Position";', 'kPhysicsObjectAnglesVectorPropertyName = "Angles";', 'kPhysicsObjectTeleportPropertyName = "Teleport";', "LocalPhysicsObjectResolvedPositionValue = IsValueNullish(LocalPhysicsObjectNestedPositionValue) ? LocalPhysicsObjectPositionArgument : LocalPhysicsObjectNestedPositionValue;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() < kPhysicsObjectPositionRequiredArgumentCount)", "if (LocalPhysicsObjectPositionArgument.IsEmpty() || PhysicsFailure.HasCaught()", "pPhysicsObject->GetPosition(&PhysicsObjectPositionVector, &PhysicsObjectAngleValue);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectPositionOptionsObject.IsEmpty() || PhysicsFailure.HasCaught()", "kPhysicsObjectPositionVectorPropertyName);\n\t\t\t\tif (LocalPhysicsObjectNestedPositionValue.IsEmpty() || PhysicsFailure.HasCaught()", "kPhysicsObjectAnglesVectorPropertyName);\n\t\t\t\tif (LocalPhysicsObjectNestedAnglesValue.IsEmpty() || PhysicsFailure.HasCaught()", "kPhysicsObjectTeleportPropertyName);\n\t\t\t\tif (LocalPhysicsObjectNestedTeleportValue.IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsBooleanFromValue(pIsolate, LocalPhysicsObjectNestedTeleportValue,", "LocalPhysicsObjectResolvedPositionValue =", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsObjectResolvedPositionValue, PhysicsObjectPositionVector) || PhysicsFailure.HasCaught()", "!GetPhysicsAngleFromValue(pIsolate, LocalContext, LocalPhysicsObjectNestedAnglesValue, PhysicsObjectAngleValue) || PhysicsFailure.HasCaught()", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsObjectPositionArgument, PhysicsObjectPositionVector) || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() > kPhysicsObjectAnglesArgumentIndex)", "!GetPhysicsAngleFromValue(pIsolate, LocalContext, LocalPhysicsObjectAnglesArgument, PhysicsObjectAngleValue) || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() > kPhysicsObjectTeleportArgumentIndex)", "!GetPhysicsBooleanFromValue(pIsolate, LocalPhysicsObjectTeleportArgument,", "pPhysicsObject->SetPosition(PhysicsObjectPositionVector, PhysicsObjectAngleValue, bPhysicsObjectTeleport);\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	},
	{
		Name: "ParsePhysicsVelocityArguments",
		Fragments: ['kPhysicsLinearVelocityVectorPropertyName = "LinearVelocity";', 'kPhysicsAngularVelocityVectorPropertyName = "AngularVelocity";', "&bHasAngularVelocity, &PhysicsFailure]", "if (!bHasNamedPhysicsLinearVelocity && !bHasNamedPhysicsAngularVelocity)", "if (!bHasLinearVelocity && !bHasAngularVelocity) {\n\t\t\t\treturn false;", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, nullptr);\n\t\t\t\treturn false;", "if (bHasLinearVelocity) {\n\t\t\t\tLinearVelocityValueOut = LinearVelocityValue;\n\t\t\t\tpLinearVelocityOut = &LinearVelocityValueOut;\n\t\t\t} else {\n\t\t\t\tpLinearVelocityOut = nullptr;", "if (bHasAngularVelocity) {\n\t\t\t\tAngularVelocityValueOut = AngularVelocityValue;\n\t\t\t\tpAngularVelocityOut = &AngularVelocityValueOut;\n\t\t\t} else {\n\t\t\t\tpAngularVelocityOut = nullptr;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "auto ParsePrimaryPhysicsVelocityArgument =", "if (LocalPhysicsLinearVelocityArgument.IsEmpty() || PhysicsFailure.HasCaught()", "if (!LocalPhysicsLinearVelocityArgument->IsObject())", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsLinearVelocityArgument, LinearVelocityValue) || PhysicsFailure.HasCaught()", "if (LocalPhysicsVelocityOptionsObject.IsEmpty() || PhysicsFailure.HasCaught()", "kPhysicsLinearVelocityVectorPropertyName);\n\t\t\t\tif (LocalPhysicsNamedLinearVelocityValue.IsEmpty() || PhysicsFailure.HasCaught()", "kPhysicsAngularVelocityVectorPropertyName);\n\t\t\t\tif (LocalPhysicsNamedAngularVelocityValue.IsEmpty() || PhysicsFailure.HasCaught()", "if (!bHasNamedPhysicsLinearVelocity && !bHasNamedPhysicsAngularVelocity)", "if (bHasNamedPhysicsLinearVelocity)", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsNamedLinearVelocityValue, LinearVelocityValue) || PhysicsFailure.HasCaught()", "if (bHasNamedPhysicsAngularVelocity)", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsNamedAngularVelocityValue, AngularVelocityValue) || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() > kPhysicsLinearVelocityArgumentIndex)", "if ((!IsValueNullish(LocalPhysicsLinearVelocityArgument) && !ParsePrimaryPhysicsVelocityArgument(LocalPhysicsLinearVelocityArgument)) || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() > kPhysicsAngularVelocityArgumentIndex)", "if (LocalPhysicsAngularVelocityArgument.IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsAngularVelocityArgument, AngularVelocityValue) || PhysicsFailure.HasCaught()", "if (!bHasLinearVelocity && !bHasAngularVelocity)", "if (PhysicsFailure.HasCaught()", "LinearVelocityValueOut = LinearVelocityValue;", "pLinearVelocityOut = &LinearVelocityValueOut;", "AngularVelocityValueOut = AngularVelocityValue;", "pAngularVelocityOut = &AngularVelocityValueOut;"],
		Forbidden: ["pLinearVelocityOut = &LinearVelocityValue;", "pAngularVelocityOut = &AngularVelocityValue;"],
	},
);

for (const Operation of [
	{ Name: "SetPhysicsObjectVelocityCallback", Method: "SetVelocity", Diagnostic: "kPhysicsObjectSetVelocityArgumentErrorMessage" },
	{ Name: "SetPhysicsObjectVelocityInstantaneousCallback", Method: "SetVelocityInstantaneous", Diagnostic: "kPhysicsObjectSetVelocityInstantaneousArgumentErrorMessage" },
	{ Name: "AddPhysicsObjectVelocityCallback", Method: "AddVelocity", Diagnostic: "kPhysicsObjectAddVelocityArgumentErrorMessage" },
]) {
	g_vecChecks.push({
		Name: Operation.Name,
		Fragments: ["Vector const* pPhysicsLinearVelocity = nullptr;", "AngularImpulse const* pPhysicsAngularVelocity = nullptr;", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, " + Operation.Diagnostic + ");\n\t\t\t\treturn;"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "!ParsePhysicsVelocityArguments(CallbackInformation, PhysicsLinearVelocityValue, PhysicsAngularVelocityValue, pPhysicsLinearVelocity, pPhysicsAngularVelocity) || PhysicsFailure.HasCaught()", "pPhysicsObject->" + Operation.Method + "(pPhysicsLinearVelocity, pPhysicsAngularVelocity);\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	});
}

for (const Operation of [
	{ Name: "ApplyPhysicsObjectForceCenterCallback", Method: "ApplyForceCenter", ArgumentIndex: "kPhysicsObjectApplyForceCenterForceArgumentIndex", RequiredCount: "kPhysicsObjectApplyForceCenterRequiredArgumentCount", Argument: "LocalPhysicsForceArgument", Vector: "PhysicsForceVector", Diagnostic: "kPhysicsObjectApplyForceCenterArgumentErrorMessage" },
	{ Name: "ApplyPhysicsObjectTorqueCenterCallback", Method: "ApplyTorqueCenter", ArgumentIndex: "kPhysicsObjectApplyTorqueCenterTorqueArgumentIndex", RequiredCount: "kPhysicsObjectApplyTorqueCenterRequiredArgumentCount", Argument: "LocalPhysicsTorqueArgument", Vector: "PhysicsTorqueImpulse", Diagnostic: "kPhysicsObjectApplyTorqueCenterArgumentErrorMessage" },
]) {
	g_vecChecks.push({
		Name: Operation.Name,
		Fragments: [Operation.ArgumentIndex + " = 0;", Operation.RequiredCount + " = 1;", "if (CallbackInformation.Length() < " + Operation.RequiredCount + ") {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, " + Operation.Diagnostic + ");\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() < " + Operation.RequiredCount + ")", "if (" + Operation.Argument + ".IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, " + Operation.Argument + ", " + Operation.Vector + ") || PhysicsFailure.HasCaught()", "pPhysicsObject->" + Operation.Method + "(" + Operation.Vector + ");\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	});
}

for (const Operation of [
	{ Name: "RecheckPhysicsObjectCollisionFilterCallback", Method: "RecheckCollisionFilter" },
	{ Name: "RecheckPhysicsObjectContactPointsCallback", Method: "RecheckContactPoints" },
]) {
	g_vecChecks.push({
		Name: Operation.Name,
		Fragments: [],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "pPhysicsObject->" + Operation.Method + "();\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	});
}

g_vecChecks.push(
	{
		Name: "ApplyPhysicsObjectForceOffsetCallback",
		Fragments: ["kPhysicsObjectApplyForceOffsetForceArgumentIndex = 0;", "kPhysicsObjectApplyForceOffsetWorldPositionArgumentIndex = 1;", "kPhysicsObjectApplyForceOffsetRequiredArgumentCount = 2;", "if (CallbackInformation.Length() < kPhysicsObjectApplyForceOffsetRequiredArgumentCount) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectApplyForceOffsetArgumentsErrorMessage);\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() < kPhysicsObjectApplyForceOffsetRequiredArgumentCount)", "if (LocalPhysicsForceArgument.IsEmpty() || LocalPhysicsWorldPositionArgument.IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsForceArgument, PhysicsForceVector) || PhysicsFailure.HasCaught()", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsWorldPositionArgument, PhysicsWorldPositionVector) || PhysicsFailure.HasCaught()", "pPhysicsObject->ApplyForceOffset(PhysicsForceVector, PhysicsWorldPositionVector);\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	},
	{
		Name: "TransformPhysicsObjectVectorCallback",
		Fragments: ["kPhysicsObjectVectorTransformRequiredArgumentCount = 1;", "static_assert(kPhysicsObjectVectorTransformArgumentErrorMessageCount == (static_cast<std::size_t>(PhysicsObjectVectorTransformOperation::PhysicsObjectVectorTransformWorldToLocalVector) + 1)", "pPhysicsObject->LocalToWorld(&PhysicsObjectVectorTransformOutput, PhysicsObjectVectorTransformInput);", "pPhysicsObject->WorldToLocal(&PhysicsObjectVectorTransformOutput, PhysicsObjectVectorTransformInput);", "pPhysicsObject->LocalToWorldVector(&PhysicsObjectVectorTransformOutput, PhysicsObjectVectorTransformInput);", "pPhysicsObject->WorldToLocalVector(&PhysicsObjectVectorTransformOutput, PhysicsObjectVectorTransformInput);", "if (CallbackInformation.Length() < kPhysicsObjectVectorTransformRequiredArgumentCount) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, pszPhysicsObjectVectorTransformArgumentErrorMessage);\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "!GetPhysicsOperationFromCallback(CallbackInformation, VectorTransformOperation) || PhysicsFailure.HasCaught()", "if ((VectorTransformOperation < PhysicsObjectVectorTransformOperation::PhysicsObjectVectorTransformLocalToWorld) || (VectorTransformOperation > PhysicsObjectVectorTransformOperation::PhysicsObjectVectorTransformWorldToLocalVector))", "static_cast<std::size_t>(VectorTransformOperation)", "if (CallbackInformation.Length() < kPhysicsObjectVectorTransformRequiredArgumentCount)", "if (LocalPhysicsObjectVectorTransformArgument.IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsObjectVectorTransformArgument, PhysicsObjectVectorTransformInput) || PhysicsFailure.HasCaught()", "switch (VectorTransformOperation)", "if (PhysicsFailure.HasCaught()", "MakePhysicsVectorObject(pIsolate, LocalContext, PhysicsObjectVectorTransformOutput);", "if (LocalPhysicsObjectVectorTransformResultObject.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsObjectVectorTransformResultObject);"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsObjectContactPointCallback",
		Fragments: ['kPhysicsObjectContactPointHitPropertyName = "Hit";', 'kPhysicsObjectContactPointVectorPropertyName = "Point";', 'kPhysicsObjectContactPointObjectPropertyName = "Object";', "IPhysicsObject* pContactPhysicsObject = nullptr;", "Vector PhysicsObjectContactPoint = Vector(0, 0, 0);", "pContactPhysicsObject, &PhysicsFailure]", "if (!bPhysicsObjectContactPointHit || !pContactPhysicsObject) {\n\t\t\t\t\treturn v8::Null(pIsolate);"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "pPhysicsObject->GetContactPoint(&PhysicsObjectContactPoint, &pContactPhysicsObject);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectContactPointResultObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObjectContactPointResultObject, kPhysicsObjectContactPointHitPropertyName, v8::Boolean::New(pIsolate, bPhysicsObjectContactPointHit)) || PhysicsFailure.HasCaught()", "MakePhysicsVectorObject(pIsolate, LocalContext, PhysicsObjectContactPoint);", "if (LocalPhysicsObjectContactPointVectorObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObjectContactPointResultObject, kPhysicsObjectContactPointVectorPropertyName, LocalPhysicsObjectContactPointVectorObject) || PhysicsFailure.HasCaught()", "if (!bPhysicsObjectContactPointHit || !pContactPhysicsObject)", "MakePhysicsObject(pIsolate, LocalContext, pContactPhysicsObject);", "if (LocalPhysicsObjectContactObject.IsEmpty() || PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectContactObjectValue.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObjectContactPointResultObject, kPhysicsObjectContactPointObjectPropertyName, LocalPhysicsObjectContactObjectValue) || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsObjectContactPointResultObject);"],
		Forbidden: ["SetBoolean(", "SetValue("],
	},
);

for (const Getter of [
	{ Name: "GetPhysicsObjectInverseMassCallback", Method: "GetInvMass", Value: "flPhysicsObjectInverseMass" },
	{ Name: "GetPhysicsObjectEnergyCallback", Method: "GetEnergy", Value: "flPhysicsObjectEnergy" },
]) {
	g_vecChecks.push({
		Name: Getter.Name,
		Fragments: ["const float " + Getter.Value + " = pPhysicsObject->" + Getter.Method + "();"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "pPhysicsObject->" + Getter.Method + "();\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(" + Getter.Value + ");"],
		Forbidden: ["GetReturnValue().Set(pPhysicsObject->"],
	});
}

g_vecChecks.push(
	{
		Name: "GetPhysicsObjectCollideCallback",
		Fragments: ["sizeof(std::uintptr_t) <= sizeof(std::uint64_t)", "reinterpret_cast<std::uintptr_t>(pPhysicsCollide)", "static_cast<std::uint64_t>(unPhysicsObjectCollideAddress)"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "pPhysicsObject->GetCollide();\n\t\t\tif (PhysicsFailure.HasCaught()", "v8::BigInt::NewFromUnsigned(", "if (LocalPhysicsObjectCollideAddressValue.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsObjectCollideAddressValue);"],
		Forbidden: ["v8::Number::", "if (!pPhysicsCollide)"],
	},
	{
		Name: "SetPhysicsObjectTriggerCallback",
		Fragments: ["kPhysicsObjectTriggerDefaultEnabled = true;", "kPhysicsObjectTriggerEnabledArgumentIndex = 0;"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "bool bPhysicsObjectTriggerEnabled = kPhysicsObjectTriggerDefaultEnabled;", "if (((CallbackInformation.Length() > kPhysicsObjectTriggerEnabledArgumentIndex) && !GetPhysicsBooleanFromValue(", "if (bPhysicsObjectTriggerEnabled)", "pPhysicsObject->BecomeTrigger();", "pPhysicsObject->RemoveTrigger();", "if (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	},
	{
		Name: "SetPhysicsObjectHingedCallback",
		Fragments: ["kPhysicsObjectHingedDefaultAxis = 0;", "kPhysicsObjectHingedAxisOrEnabledArgumentIndex = 0;", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectHingedAxisOrEnabledArgumentErrorMessage);\n\t\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsObject || PhysicsFailure.HasCaught()", "int nPhysicsObjectHingeAxis = kPhysicsObjectHingedDefaultAxis;", "if (CallbackInformation.Length() > kPhysicsObjectHingedAxisOrEnabledArgumentIndex)", "if (LocalPhysicsObjectHingedAxisOrEnabledArgument.IsEmpty() || PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectHingedAxisOrEnabledArgument->IsBoolean())", "->BooleanValue(pIsolate);\n\t\t\t\t\tif (PhysicsFailure.HasCaught()", "if (!bPhysicsObjectHingedEnabled)", "pPhysicsObject->RemoveHinged();\n\t\t\t\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);\n\t\t\t\t\t\treturn;", "} else if (!GetPhysicsInt32FromValue(", "pPhysicsObject->BecomeHinged(nPhysicsObjectHingeAxis);\n\t\t\tif (PhysicsFailure.HasCaught()"],
		Forbidden: [],
	},
	{
		Name: "OutputPhysicsObjectDebugInformationCallback",
		Fragments: [],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "pPhysicsObject->OutputDebugInfo();\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsObjectNameCallback",
		Fragments: ["char const* const pszPhysicsObjectName = pPhysicsObject->GetName();"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "pPhysicsObject->GetName();\n\t\t\tif (PhysicsFailure.HasCaught()", "MakeString(pIsolate, pszPhysicsObjectName);", "if (LocalPhysicsObjectNameValue.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsObjectNameValue);"],
		Forbidden: ["MakeString(pIsolate, pPhysicsObject->"],
	},
	{
		Name: "InstallPhysicsSphereRadiusSetter",
		Fragments: ['kPhysicsObjectSphereRadiusSetterFunctionName = "SetSphereRadius";'],
		Order: ["if (PhysicsFailure.HasCaught()", "if constexpr (SupportsPhysicsObjectSphereRadiusSetter<TPhysicsObject>())", "if (LocalPhysicsObjectSphereRadiusSetterCallbackData.IsEmpty() || PhysicsFailure.HasCaught()", "!v8::Function::New(LocalContext, SetPhysicsObjectSphereRadiusCallback<TPhysicsObject>, LocalPhysicsObjectSphereRadiusSetterCallbackData).ToLocal(&LocalPhysicsObjectSphereRadiusSetter) || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObject, kPhysicsObjectSphereRadiusSetterFunctionName, LocalPhysicsObjectSphereRadiusSetter) || PhysicsFailure.HasCaught()", "return true;"],
		Forbidden: ["SetFunction(", "SetValue("],
	},
	{
		Name: "InstallPhysicsObjectMethods",
		Fragments: ["#if !defined(SOURCEJS_OLD_CONSOLE_API)", '"IsCollisionEnabled", GetPhysicsObjectBooleanStateCallback', "&PhysicsFailure](PhysicsObjectMethodRegistration const& PhysicsObjectMethodRegistrationInformation)", "m_bHasOperation ? v8::Integer::New(pIsolate, PhysicsObjectMethodRegistrationInformation.m_nOperation).As<v8::Value>() : v8::Undefined(pIsolate).As<v8::Value>();"],
		Order: ["if (PhysicsFailure.HasCaught()", "auto InstallPhysicsObjectMethod =", "if (LocalPhysicsObjectMethodCallbackData.IsEmpty() || PhysicsFailure.HasCaught()", "!v8::Function::New(LocalContext, PhysicsObjectMethodRegistrationInformation.m_Callback, LocalPhysicsObjectMethodCallbackData).ToLocal(&LocalPhysicsObjectMethod) || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObject, PhysicsObjectMethodRegistrationInformation.m_pszFunctionName, LocalPhysicsObjectMethod) || PhysicsFailure.HasCaught()", "for (auto const& PhysicsObjectMethodRegistrationInformation : kPhysicsObjectPrimaryMethodRegistrations)", "!InstallPhysicsObjectMethod(PhysicsObjectMethodRegistrationInformation) || PhysicsFailure.HasCaught()", "!InstallPhysicsSphereRadiusSetter<IPhysicsObject>(pIsolate, LocalContext, LocalPhysicsObject) || PhysicsFailure.HasCaught()", "for (auto const& PhysicsObjectMethodRegistrationInformation : kPhysicsObjectRemainingMethodRegistrations)"],
		Forbidden: ["SetFunction(", "SetValue("],
	},
	{
		Name: "MakePhysicsObject",
		Fragments: ["sizeof(std::uintptr_t) <= sizeof(std::uint64_t)", 'kPhysicsObjectAddressPropertyName = "Address";', 'kPhysicsObjectInertiaPropertyName = "Inertia";', 'kPhysicsObjectInverseInertiaPropertyName = "InverseInertia";', 'kPhysicsObjectMassCenterLocalSpacePropertyName = "MassCenterLocalSpace";', 'kPhysicsObjectPositionPropertyName = "Position";', 'kPhysicsObjectVelocityPropertyName = "Velocity";', "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectNullAddressErrorMessage);\n\t\t\t\treturn {};"],
		Order: ["if (!pPhysicsObject || PhysicsFailure.HasCaught()", "if (LocalPhysicsObject.IsEmpty() || PhysicsFailure.HasCaught()", "v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unPhysicsObjectAddress))", "if (LocalPhysicsObjectAddressValue.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObject, kPhysicsObjectAddressPropertyName, LocalPhysicsObjectAddressValue) || PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectInertiaObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObject, kPhysicsObjectInertiaPropertyName, LocalPhysicsObjectInertiaObject) || PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectInverseInertiaObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObject, kPhysicsObjectInverseInertiaPropertyName, LocalPhysicsObjectInverseInertiaObject) || PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectMassCenterObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObject, kPhysicsObjectMassCenterLocalSpacePropertyName, LocalPhysicsObjectMassCenterObject) || PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectPositionObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObject, kPhysicsObjectPositionPropertyName, LocalPhysicsObjectPositionObject) || PhysicsFailure.HasCaught()", "if (LocalPhysicsObjectVelocityObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsObject, kPhysicsObjectVelocityPropertyName, LocalPhysicsObjectVelocityObject) || PhysicsFailure.HasCaught()", "!InstallPhysicsObjectMethods(pIsolate, LocalContext, LocalPhysicsObject) || PhysicsFailure.HasCaught()", "return LocalPhysicsObject;"],
		Forbidden: ["SetValue(", "SetFunction(", "v8::Number::"],
	},
);

for (const Getter of [
	{ Name: "GetPhysicsEnvironmentAirDensityCallback", Method: "GetAirDensity", Type: "float", Value: "flPhysicsEnvironmentAirDensity" },
	{ Name: "GetPhysicsEnvironmentActiveObjectCountCallback", Method: "GetActiveObjectCount", Type: "int", Value: "nActivePhysicsObjectCount" },
]) {
	g_vecChecks.push({
		Name: Getter.Name,
		Fragments: ["const " + Getter.Type + " " + Getter.Value + " = pPhysicsEnvironment->" + Getter.Method + "();"],
		Order: ["if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "pPhysicsEnvironment->" + Getter.Method + "();\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(" + Getter.Value + ");"],
		Forbidden: ["GetReturnValue().Set(pPhysicsEnvironment->"],
	});
}

for (const strName of ["GetPhysicsEnvironmentLiveComponentCallback", "SetPhysicsEnvironmentLiveComponentCallback"]) {
	g_vecChecks.push({
		Name: strName,
		Fragments: ["kPhysicsEnvironmentGravityComponentCount = 3;", "kPhysicsEnvironmentGravityComponentIndex = static_cast<int>(ComponentOperation);", "static_assert((kPhysicsEnvironmentGravityComponentIndex >= 0) && (kPhysicsEnvironmentGravityComponentIndex < kPhysicsEnvironmentGravityComponentCount)", "#if defined(SOURCEJS_OLD_CONSOLE_API)\n\t\t\tpPhysicsEnvironment->GetGravity(PhysicsEnvironmentGravityVector);\n#else\n\t\t\tpPhysicsEnvironment->GetGravity(&PhysicsEnvironmentGravityVector);\n#endif // SOURCEJS_OLD_CONSOLE_API\n\t\t\tif (PhysicsFailure.HasCaught()"],
		Order: ["RequirePhysicsEnvironmentFromLiveComponentData(pIsolate, CallbackInformation.Data());", "if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "Vector PhysicsEnvironmentGravityVector = Vector(0, 0, 0);", "#endif // SOURCEJS_OLD_CONSOLE_API", "if (PhysicsFailure.HasCaught()"],
		Forbidden: [],
	});
}

g_vecChecks.push(
	{
		Name: "FindActivePhysicsObjectByEntityIndex",
		Fragments: ["if (!pPhysicsEnvironment || (nEntityIndex < 0)) {\n\t\t\treturn nullptr;", "if (nActivePhysicsObjectCount <= 0) {\n\t\t\t\treturn nullptr;", "if (!pActivePhysicsObject) {\n\t\t\t\t\tcontinue;", "auto* const pPhysicsObjectBaseEntity = static_cast<CBaseEntity*>(pActivePhysicsObject->GetGameData());", "if (nPhysicsObjectEntityIndex == nEntityIndex) {\n\t\t\t\t\treturn pActivePhysicsObject;"],
		Order: ["v8::Isolate::GetCurrent()", "if (PhysicsFailure.HasCaught()", "pPhysicsEnvironment->GetActiveObjectCount();\n\t\t\tif (PhysicsFailure.HasCaught()", "if (nActivePhysicsObjectCount <= 0)", "std::vector<IPhysicsObject*>(static_cast<std::size_t>(nActivePhysicsObjectCount), nullptr)", "pPhysicsEnvironment->GetActiveObjects(vecActivePhysicsObjects.data());\n\t\t\tif (PhysicsFailure.HasCaught()", "for (auto const& pActivePhysicsObject : vecActivePhysicsObjects)", "if (!pActivePhysicsObject)", "pActivePhysicsObject->GetGameData());\n\t\t\t\tif (PhysicsFailure.HasCaught()", "GetEntityIndexFromBaseEntity(pPhysicsObjectBaseEntity);\n\t\t\t\tif (PhysicsFailure.HasCaught()", "if (nPhysicsObjectEntityIndex == nEntityIndex)"],
		Forbidden: [],
	},
	{
		Name: "RequirePhysicsEnvironmentFromLiveComponentData",
		Fragments: ["RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentLiveComponentInvalidMetadataErrorMessage);", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentLiveComponentNullEnvironmentErrorMessage);"],
		Order: ["if (LocalPhysicsEnvironmentLiveComponentData.IsEmpty() || !LocalPhysicsEnvironmentLiveComponentData->IsExternal() || PhysicsFailure.HasCaught()", "LocalPhysicsEnvironmentLiveComponentData.As<v8::External>()", "if (LocalPhysicsEnvironmentLiveComponentExternalData.IsEmpty() || PhysicsFailure.HasCaught()", "auto* const pPhysicsEnvironment = static_cast<IPhysicsEnvironment*>(LocalPhysicsEnvironmentLiveComponentExternalData->Value());", "if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "return pPhysicsEnvironment;"],
		Forbidden: ["reinterpret_cast<"],
	},
	{
		Name: "GetPhysicsEnvironmentLiveComponentCallback",
		Fragments: [],
		Order: ["#endif // SOURCEJS_OLD_CONSOLE_API", "if (PhysicsFailure.HasCaught()", "GetPhysicsVectorComponent(PhysicsEnvironmentGravityVector, kPhysicsEnvironmentGravityComponentIndex);", "CallbackInformation.GetReturnValue().Set(flPhysicsEnvironmentGravityComponent);"],
		Forbidden: [],
	},
	{
		Name: "SetPhysicsEnvironmentLiveComponentCallback",
		Fragments: [],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsFloatFromValue(pIsolate, LocalContext, LocalPhysicsEnvironmentLiveComponentValue, kPhysicsEnvironmentLiveComponentInvalidValueErrorMessage, flPhysicsEnvironmentGravityComponentValue) || PhysicsFailure.HasCaught()", "RequirePhysicsEnvironmentFromLiveComponentData(pIsolate, CallbackInformation.Data());", "#endif // SOURCEJS_OLD_CONSOLE_API", "if (PhysicsFailure.HasCaught()", "SetPhysicsVectorComponent(PhysicsEnvironmentGravityVector, kPhysicsEnvironmentGravityComponentIndex, flPhysicsEnvironmentGravityComponentValue);", "pPhysicsEnvironment->SetGravity(PhysicsEnvironmentGravityVector);\n\t\t\tif (PhysicsFailure.HasCaught()"],
		Forbidden: [],
	},
	{
		Name: "InstallPhysicsEnvironmentLiveComponent",
		Fragments: ["if (!pszPhysicsEnvironmentLiveComponentPropertyName || !*pszPhysicsEnvironmentLiveComponentPropertyName)", "GetPhysicsEnvironmentLiveComponentCallback<ComponentOperation>, SetPhysicsEnvironmentLiveComponentCallback<ComponentOperation>, LocalPhysicsEnvironmentLiveComponentData);"],
		Order: ["if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "MakeString(pIsolate, pszPhysicsEnvironmentLiveComponentPropertyName);", "if (LocalPhysicsEnvironmentLiveComponentPropertyName.IsEmpty() || PhysicsFailure.HasCaught()", "v8::External::New(pIsolate, pPhysicsEnvironment);", "if (LocalPhysicsEnvironmentLiveComponentData.IsEmpty() || PhysicsFailure.HasCaught()", "v8::Maybe<bool> const MaybeInstallationResult = LocalPhysicsEnvironmentObject->SetNativeDataProperty(", "if (!MaybeInstallationResult.FromMaybe(false) || PhysicsFailure.HasCaught()", "return true;"],
		Forbidden: ["return LocalPhysicsEnvironmentObject->", "return MaybeInstallationResult.FromMaybe("],
	},
	{
		Name: "MakePhysicsEnvironmentGravityObject",
		Fragments: ['kPhysicsEnvironmentGravityXPropertyName = "X";', 'kPhysicsEnvironmentGravityYPropertyName = "Y";', 'kPhysicsEnvironmentGravityZPropertyName = "Z";'],
		Order: ["if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "if (LocalPhysicsEnvironmentGravityObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsEnvironmentLiveComponent<PhysicsEnvironmentLiveComponentOperation::PhysicsEnvironmentLiveGravityX>(pIsolate, LocalContext, LocalPhysicsEnvironmentGravityObject, kPhysicsEnvironmentGravityXPropertyName, pPhysicsEnvironment) || PhysicsFailure.HasCaught()", "!InstallPhysicsEnvironmentLiveComponent<PhysicsEnvironmentLiveComponentOperation::PhysicsEnvironmentLiveGravityY>(pIsolate, LocalContext, LocalPhysicsEnvironmentGravityObject, kPhysicsEnvironmentGravityYPropertyName, pPhysicsEnvironment) || PhysicsFailure.HasCaught()", "!InstallPhysicsEnvironmentLiveComponent<PhysicsEnvironmentLiveComponentOperation::PhysicsEnvironmentLiveGravityZ>(pIsolate, LocalContext, LocalPhysicsEnvironmentGravityObject, kPhysicsEnvironmentGravityZPropertyName, pPhysicsEnvironment) || PhysicsFailure.HasCaught()", "return LocalPhysicsEnvironmentGravityObject;"],
		Forbidden: ["SetValue(", "SetNumber("],
	},
	{
		Name: "GetPhysicsEnvironmentGravityCallback",
		Fragments: [],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "MakePhysicsEnvironmentGravityObject(pIsolate, LocalContext, pPhysicsEnvironment);", "if (LocalPhysicsEnvironmentGravityObject.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsEnvironmentGravityObject);"],
		Forbidden: [],
	},
	{
		Name: "SetPhysicsEnvironmentGravityCallback",
		Fragments: ["kPhysicsEnvironmentGravityArgumentIndex = 0;", "kPhysicsEnvironmentGravityRequiredArgumentCount = 1;", "if (CallbackInformation.Length() < kPhysicsEnvironmentGravityRequiredArgumentCount) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentGravityArgumentErrorMessage);\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() < kPhysicsEnvironmentGravityRequiredArgumentCount)", "if (LocalPhysicsEnvironmentGravityValue.IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsVectorFromValue(pIsolate, LocalContext, LocalPhysicsEnvironmentGravityValue, PhysicsEnvironmentGravityVector) || PhysicsFailure.HasCaught()", "pPhysicsEnvironment->SetGravity(PhysicsEnvironmentGravityVector);\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	},
	{
		Name: "SetPhysicsEnvironmentAirDensityCallback",
		Fragments: ["kPhysicsEnvironmentAirDensityArgumentIndex = 0;", "kPhysicsEnvironmentAirDensityRequiredArgumentCount = 1;", "if (CallbackInformation.Length() < kPhysicsEnvironmentAirDensityRequiredArgumentCount) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentAirDensityArgumentErrorMessage);\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() < kPhysicsEnvironmentAirDensityRequiredArgumentCount)", "if (LocalPhysicsEnvironmentAirDensityValue.IsEmpty() || PhysicsFailure.HasCaught()", "!GetPhysicsFloatFromValue(pIsolate, LocalContext, LocalPhysicsEnvironmentAirDensityValue, kPhysicsEnvironmentAirDensityArgumentErrorMessage, flPhysicsEnvironmentAirDensity) || PhysicsFailure.HasCaught()", "pPhysicsEnvironment->SetAirDensity(flPhysicsEnvironmentAirDensity);\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(true);"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsEnvironmentActiveObjectsCallback",
		Fragments: ["if (nActivePhysicsObjectCount < 0) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentNegativeActiveObjectCountErrorMessage);\n\t\t\t\treturn;", "const std::uint32_t unActivePhysicsObjectIndex = static_cast<std::uint32_t>(nActivePhysicsObjectIndex);", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentNullActivePhysicsObjectErrorMessage);"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "pPhysicsEnvironment->GetActiveObjectCount();\n\t\t\tif (PhysicsFailure.HasCaught()", "if (nActivePhysicsObjectCount < 0)", "std::vector<IPhysicsObject*>(static_cast<std::size_t>(nActivePhysicsObjectCount), nullptr)", "if (nActivePhysicsObjectCount > 0)", "pPhysicsEnvironment->GetActiveObjects(vecActivePhysicsObjects.data());\n\t\t\t\tif (PhysicsFailure.HasCaught()", "v8::Array::New(pIsolate, nActivePhysicsObjectCount);", "if (LocalActivePhysicsObjectArray.IsEmpty() || PhysicsFailure.HasCaught()", "for (int nActivePhysicsObjectIndex = 0; nActivePhysicsObjectIndex < nActivePhysicsObjectCount; ++nActivePhysicsObjectIndex)", "if (!pActivePhysicsObject || PhysicsFailure.HasCaught()", "MakePhysicsObject(pIsolate, LocalContext, pActivePhysicsObject);", "if (LocalActivePhysicsObject.IsEmpty() || PhysicsFailure.HasCaught()", "LocalActivePhysicsObjectArray->CreateDataProperty(LocalContext, unActivePhysicsObjectIndex, LocalActivePhysicsObject);", "if (!MaybeCreationResult.FromMaybe(false) || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalActivePhysicsObjectArray);"],
		Forbidden: ["LocalActivePhysicsObjectArray->Set("],
	},
);

g_vecChecks.push(
	{
		Name: "GetPhysicsEnvironmentActiveObjectByEntityCallback",
		Fragments: ["kPhysicsEnvironmentActiveObjectByEntityArgumentIndex = 0;", "kPhysicsEnvironmentActiveObjectByEntityRequiredArgumentCount = 1;", "if (CallbackInformation.Length() < kPhysicsEnvironmentActiveObjectByEntityRequiredArgumentCount) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentActiveObjectByEntityArgumentErrorMessage);\n\t\t\t\treturn;", "if (LocalPhysicsEnvironmentActiveObjectEntityValue.IsEmpty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentActiveObjectByEntityArgumentErrorMessage);\n\t\t\t\treturn;", "if (nPhysicsEnvironmentActiveObjectEntityIndex < 0) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentActiveObjectByEntityArgumentErrorMessage);\n\t\t\t\treturn;", "if (!pActivePhysicsObject) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "GetValueIndex(pIsolate, LocalContext, LocalPhysicsEnvironmentActiveObjectEntityValue);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (nPhysicsEnvironmentActiveObjectEntityIndex < 0)", "FindActivePhysicsObjectByEntityIndex(pPhysicsEnvironment, nPhysicsEnvironmentActiveObjectEntityIndex);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pActivePhysicsObject)", "MakePhysicsObject(pIsolate, LocalContext, pActivePhysicsObject);", "if (LocalActivePhysicsObject.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalActivePhysicsObject);"],
		Forbidden: [],
	},
	{
		Name: "IsPhysicsEnvironmentInSimulationCallback",
		Fragments: [],
		Order: ["if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "pPhysicsEnvironment->IsInSimulation();\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(bPhysicsEnvironmentInSimulation);"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsEnvironmentSimulationTimeCallback",
		Fragments: [],
		Order: ["if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "pPhysicsEnvironment->GetSimulationTime();\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(flPhysicsEnvironmentSimulationTime);"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsEnvironmentSimulationTimestepCallback",
		Fragments: [],
		Order: ["if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "pPhysicsEnvironment->GetSimulationTimestep();\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(flPhysicsEnvironmentSimulationTimestep);"],
		Forbidden: [],
	},
	{
		Name: "GetPhysicsEnvironmentNextFrameTimeCallback",
		Fragments: [],
		Order: ["if (!pPhysicsEnvironment || PhysicsFailure.HasCaught()", "pPhysicsEnvironment->GetNextFrameTime();\n\t\t\tif (PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(flPhysicsEnvironmentNextFrameTime);"],
		Forbidden: [],
	},
	{
		Name: "InstallPhysicsEnvironmentMethods",
		Fragments: ["kPhysicsEnvironmentExpectedCommonMethodRegistrationCount = 10;", '{ "GetGravity", GetPhysicsEnvironmentGravityCallback }', '{ "SetGravity", SetPhysicsEnvironmentGravityCallback }', '{ "GetAirDensity", GetPhysicsEnvironmentAirDensityCallback }', '{ "SetAirDensity", SetPhysicsEnvironmentAirDensityCallback }', '{ "GetActiveObjectCount", GetPhysicsEnvironmentActiveObjectCountCallback }', '{ "ActiveObjects", GetPhysicsEnvironmentActiveObjectsCallback }', '{ "GetActiveObjectByEntity", GetPhysicsEnvironmentActiveObjectByEntityCallback }', '{ "IsInSimulation", IsPhysicsEnvironmentInSimulationCallback }', '{ "GetSimulationTime", GetPhysicsEnvironmentSimulationTimeCallback }', '{ "GetSimulationTimestep", GetPhysicsEnvironmentSimulationTimestepCallback }', '#if !defined(SOURCEJS_OLD_CONSOLE_API)\n\t\tconstexpr PhysicsEnvironmentMethodRegistration kPhysicsEnvironmentNextFrameTimeMethodRegistration = { "GetNextFrameTime", GetPhysicsEnvironmentNextFrameTimeCallback };\n#endif'],
		Order: ["if (LocalPhysicsEnvironmentMethodFunctionData.IsEmpty() || PhysicsFailure.HasCaught()", "for (auto const& MethodRegistration : kPhysicsEnvironmentCommonMethodRegistrations)", "!v8::Function::New(LocalContext, MethodRegistration.m_Callback, LocalPhysicsEnvironmentMethodFunctionData).ToLocal(&LocalPhysicsEnvironmentMethod) || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsEnvironmentObject, MethodRegistration.m_pszFunctionName, LocalPhysicsEnvironmentMethod) || PhysicsFailure.HasCaught()", "#if !defined(SOURCEJS_OLD_CONSOLE_API)\n\t\t\tv8::Local<v8::Function> LocalPhysicsEnvironmentNextFrameTimeMethod {};", "!v8::Function::New(LocalContext, kPhysicsEnvironmentNextFrameTimeMethodRegistration.m_Callback, LocalPhysicsEnvironmentMethodFunctionData).ToLocal(&LocalPhysicsEnvironmentNextFrameTimeMethod) || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsEnvironmentObject, kPhysicsEnvironmentNextFrameTimeMethodRegistration.m_pszFunctionName, LocalPhysicsEnvironmentNextFrameTimeMethod) || PhysicsFailure.HasCaught()", "return true;"],
		Forbidden: ["SetFunction("],
	},
	{
		Name: "MakePhysicsEnvironmentObject",
		Fragments: ['kPhysicsEnvironmentIndexPropertyName = "Index";', 'kPhysicsEnvironmentAddressPropertyName = "Address";', 'kPhysicsEnvironmentGravityPropertyName = "Gravity";', "if (!pPhysicsEnvironment) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentNullAddressErrorMessage);\n\t\t\t\treturn {};", "v8::Integer::New(pIsolate, nPhysicsEnvironmentIndex)", "static_assert(sizeof(std::uintptr_t) <= sizeof(std::uint64_t)"],
		Order: ["if (PhysicsFailure.HasCaught()", "if (!pPhysicsEnvironment)", "v8::Object::New(pIsolate);", "if (LocalPhysicsEnvironmentObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsEnvironmentObject, kPhysicsEnvironmentIndexPropertyName, LocalPhysicsEnvironmentIndexValue) || PhysicsFailure.HasCaught()", "v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unPhysicsEnvironmentAddress));", "if (LocalPhysicsEnvironmentAddressValue.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsEnvironmentObject, kPhysicsEnvironmentAddressPropertyName, LocalPhysicsEnvironmentAddressValue) || PhysicsFailure.HasCaught()", "MakePhysicsEnvironmentGravityObject(pIsolate, LocalContext, pPhysicsEnvironment);", "if (LocalPhysicsEnvironmentGravityObject.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsEnvironmentObject, kPhysicsEnvironmentGravityPropertyName, LocalPhysicsEnvironmentGravityObject) || PhysicsFailure.HasCaught()", "!InstallPhysicsEnvironmentMethods(pIsolate, LocalContext, LocalPhysicsEnvironmentObject) || PhysicsFailure.HasCaught()", "return LocalPhysicsEnvironmentObject;"],
		Forbidden: ["!SetInteger(", "!SetValue(", "v8::Number::New("],
	},
	{
		Name: "GetActivePhysicsEnvironmentByIndexCallback",
		Fragments: ["int nActivePhysicsEnvironmentIndex = 0;", "bool bActivePhysicsEnvironmentRequired = false;", "if (!pPhysics) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsInterfaceUnavailableErrorMessage);\n\t\t\t\treturn;", "if (LocalActivePhysicsEnvironmentIndexValue.IsEmpty()) {\n\t\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kActivePhysicsEnvironmentIndexArgumentErrorMessage);\n\t\t\t\t\treturn;", "if (nActivePhysicsEnvironmentIndex < 0) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kActivePhysicsEnvironmentIndexArgumentErrorMessage);\n\t\t\t\treturn;", "if (LocalActivePhysicsEnvironmentRequiredValue.IsEmpty()) {\n\t\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kActivePhysicsEnvironmentRequiredArgumentErrorMessage);\n\t\t\t\t\treturn;", "if (!pActivePhysicsEnvironment && bActivePhysicsEnvironmentRequired) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kActivePhysicsEnvironmentUnresolvedErrorMessage);\n\t\t\t\treturn;", "if (!pActivePhysicsEnvironment) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "GetPhysicsInterface();\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysics)", "!GetPhysicsInt32FromValue(pIsolate, LocalContext, LocalActivePhysicsEnvironmentIndexValue, kActivePhysicsEnvironmentIndexArgumentErrorMessage, nActivePhysicsEnvironmentIndex) || PhysicsFailure.HasCaught()", "if (nActivePhysicsEnvironmentIndex < 0)", "!GetPhysicsBooleanFromValue(pIsolate, LocalActivePhysicsEnvironmentRequiredValue, kActivePhysicsEnvironmentRequiredArgumentErrorMessage, bActivePhysicsEnvironmentRequired) || PhysicsFailure.HasCaught()", "pPhysics->GetActiveEnvironmentByIndex(nActivePhysicsEnvironmentIndex);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pActivePhysicsEnvironment && bActivePhysicsEnvironmentRequired)", "if (!pActivePhysicsEnvironment)", "MakePhysicsEnvironmentObject(pIsolate, LocalContext, pActivePhysicsEnvironment, nActivePhysicsEnvironmentIndex);", "if (LocalActivePhysicsEnvironmentObject.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalActivePhysicsEnvironmentObject);"],
		Forbidden: [],
	},
	{
		Name: "CreatePhysicsEnvironmentFromAddressCallback",
		Fragments: ["kPhysicsEnvironmentFromAddressArgumentIndex = 0;", "kPhysicsEnvironmentFromAddressIndexArgumentIndex = 1;", "kPhysicsEnvironmentFromAddressRequiredArgumentCount = 1;", "int nPhysicsEnvironmentIndex = -1;", "if (!pPhysics) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentFromAddressUnavailableInterfaceErrorMessage);\n\t\t\t\treturn;", "if (CallbackInformation.Length() < kPhysicsEnvironmentFromAddressRequiredArgumentCount) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentFromAddressInvalidAddressErrorMessage);\n\t\t\t\treturn;", "if (LocalPhysicsEnvironmentAddressValue.IsEmpty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentFromAddressInvalidAddressErrorMessage);\n\t\t\t\treturn;", "if (!pPhysicsEnvironmentFromAddress || PhysicsFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentFromAddressInvalidAddressErrorMessage);\n\t\t\t\treturn;", "if (LocalPhysicsEnvironmentIndexValue.IsEmpty()) {\n\t\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentFromAddressInvalidIndexErrorMessage);\n\t\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "GetPhysicsInterface();\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysics)", "if (CallbackInformation.Length() < kPhysicsEnvironmentFromAddressRequiredArgumentCount)", "GetPhysicsEnvironmentFromValue(LocalPhysicsEnvironmentAddressValue);", "if (!pPhysicsEnvironmentFromAddress || PhysicsFailure.HasCaught()", "!GetPhysicsInt32FromValue(pIsolate, LocalContext, LocalPhysicsEnvironmentIndexValue, kPhysicsEnvironmentFromAddressInvalidIndexErrorMessage, nPhysicsEnvironmentIndex) || PhysicsFailure.HasCaught()", "MakePhysicsEnvironmentObject(pIsolate, LocalContext, pPhysicsEnvironmentFromAddress, nPhysicsEnvironmentIndex);", "if (LocalPhysicsEnvironmentFromAddressObject.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsEnvironmentFromAddressObject);"],
		Forbidden: ["NumberValue(", "IsNumber("],
	},
);

g_vecChecks.push(
	{
		Name: "GetPhysicsObjectByEntityCallback",
		Fragments: ["kPhysicsObjectByEntityArgumentIndex = 0;", "kPhysicsObjectByEntityListIndexArgumentIndex = 1;", "kPhysicsObjectByEntityRequiredArgumentCount = 1;", "int nPhysicsObjectListIndex = 0;", "if (LocalPhysicsObjectEntityValue.IsEmpty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectByEntityInvalidEntityErrorMessage);\n\t\t\t\treturn;", "if (LocalPhysicsObjectListIndexValue.IsEmpty()) {\n\t\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectByEntityInvalidListIndexErrorMessage);\n\t\t\t\t\treturn;", "if (!pPhysicsObjectByEntity) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "GetPhysicsInterface();\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysics)", "if (CallbackInformation.Length() < kPhysicsObjectByEntityRequiredArgumentCount)", "GetBaseEntityFromValue(pIsolate, LocalContext, LocalPhysicsObjectEntityValue);", "if (!pPhysicsObjectBaseEntity || PhysicsFailure.HasCaught()", "!GetPhysicsInt32FromValue(pIsolate, LocalContext, LocalPhysicsObjectListIndexValue, kPhysicsObjectByEntityInvalidListIndexErrorMessage, nPhysicsObjectListIndex) || PhysicsFailure.HasCaught()", "if (nPhysicsObjectListIndex < 0)", "GetPhysicsObjectFromEntityValue(pIsolate, LocalContext, LocalPhysicsObjectEntityValue, nPhysicsObjectListIndex);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysicsObjectByEntity)", "MakePhysicsObject(pIsolate, LocalContext, pPhysicsObjectByEntity);", "if (LocalPhysicsObjectByEntity.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsObjectByEntity);"],
		Forbidden: [],
	},
	{
		Name: "ResolvePhysicsObjectCallback",
		Fragments: ["kPhysicsObjectResolveValueArgumentIndex = 0;", "kPhysicsObjectResolveRequiredArgumentIndex = 1;", "kPhysicsObjectResolveRequiredArgumentCount = 1;", "bool bResolvedPhysicsObjectRequired = false;", "if (LocalPhysicsObjectResolveValue.IsEmpty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectResolveInvalidValueErrorMessage);\n\t\t\t\treturn;", "if (LocalPhysicsObjectResolveRequiredValue.IsEmpty()) {\n\t\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectResolveInvalidRequiredErrorMessage);\n\t\t\t\t\treturn;", "if (!pResolvedPhysicsObject && bResolvedPhysicsObjectRequired) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectResolveUnresolvedErrorMessage);\n\t\t\t\treturn;", "if (!pResolvedPhysicsObject) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "GetPhysicsInterface();\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysics)", "if (CallbackInformation.Length() < kPhysicsObjectResolveRequiredArgumentCount)", "!GetPhysicsBooleanFromValue(pIsolate, LocalPhysicsObjectResolveRequiredValue, kPhysicsObjectResolveInvalidRequiredErrorMessage, bResolvedPhysicsObjectRequired) || PhysicsFailure.HasCaught()", "GetPhysicsObjectFromValue(pIsolate, LocalContext, LocalPhysicsObjectResolveValue);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pResolvedPhysicsObject && bResolvedPhysicsObjectRequired)", "if (!pResolvedPhysicsObject)", "MakePhysicsObject(pIsolate, LocalContext, pResolvedPhysicsObject);", "if (LocalResolvedPhysicsObject.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalResolvedPhysicsObject);"],
		Forbidden: [],
	},
	{
		Name: "CreatePhysicsObjectFromAddressCallback",
		Fragments: ["kPhysicsObjectFromAddressArgumentIndex = 0;", "kPhysicsObjectFromAddressRequiredArgumentCount = 1;", "if (LocalPhysicsObjectAddressValue.IsEmpty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectFromAddressInvalidAddressErrorMessage);\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "GetPhysicsInterface();\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysics)", "if (CallbackInformation.Length() < kPhysicsObjectFromAddressRequiredArgumentCount)", "GetPhysicsObjectFromAddressValue(LocalPhysicsObjectAddressValue);", "if (!pPhysicsObjectFromAddress || PhysicsFailure.HasCaught()", "MakePhysicsObject(pIsolate, LocalContext, pPhysicsObjectFromAddress);", "if (LocalPhysicsObjectFromAddress.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsObjectFromAddress);"],
		Forbidden: ["IsNumber(", "NumberValue("],
	},
	{
		Name: "GetPhysicsObjectsByEntityCallback",
		Fragments: ["kPhysicsObjectsByEntityArgumentIndex = 0;", "kPhysicsObjectsByEntityRequiredArgumentCount = 1;", "if (LocalPhysicsObjectsByEntityValue.IsEmpty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectsByEntityInvalidEntityErrorMessage);\n\t\t\t\treturn;", "const std::uint32_t unPhysicsObjectArrayIndex = static_cast<std::uint32_t>(unPhysicsObjectIndex);", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectsByEntityExcessiveObjectCountErrorMessage);", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectsByEntityNullPhysicsObjectErrorMessage);"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "GetPhysicsInterface();\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysics)", "if (CallbackInformation.Length() < kPhysicsObjectsByEntityRequiredArgumentCount)", "GetBaseEntityFromValue(pIsolate, LocalContext, LocalPhysicsObjectsByEntityValue);", "if (!pPhysicsObjectOwnerEntity || PhysicsFailure.HasCaught()", "CollectPhysicsObjectsForEntity(pPhysicsObjectOwnerEntity, vecPhysicsObjects);\n\t\t\tif (PhysicsFailure.HasCaught()", "if (unPhysicsObjectCount > static_cast<std::size_t>(std::numeric_limits<int>::max()))", "const int nPhysicsObjectCount = static_cast<int>(unPhysicsObjectCount);", "v8::Array::New(pIsolate, nPhysicsObjectCount);", "if (LocalPhysicsObjectArray.IsEmpty() || PhysicsFailure.HasCaught()", "for (std::size_t unPhysicsObjectIndex = 0; unPhysicsObjectIndex < unPhysicsObjectCount; ++unPhysicsObjectIndex)", "if (!pEntityPhysicsObject || PhysicsFailure.HasCaught()", "MakePhysicsObject(pIsolate, LocalContext, pEntityPhysicsObject);", "if (LocalEntityPhysicsObject.IsEmpty() || PhysicsFailure.HasCaught()", "LocalPhysicsObjectArray->CreateDataProperty(LocalContext, unPhysicsObjectArrayIndex, LocalEntityPhysicsObject);", "if (!MaybeCreationResult.FromMaybe(false) || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsObjectArray);"],
		Forbidden: ["LocalPhysicsObjectArray->Set("],
	},
	{
		Name: "MakePhysicsInterfaceObject",
		Fragments: ['kPhysicsInterfaceAddressPropertyName = "Address";', 'kPhysicsInterfaceGetActiveEnvironmentByIndexFunctionName = "GetActiveEnvironmentByIndex";', "if (!pPhysics) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsInterfaceNullAddressErrorMessage);\n\t\t\t\treturn {};", "static_assert(sizeof(std::uintptr_t) <= sizeof(std::uint64_t)"],
		Order: ["if (PhysicsFailure.HasCaught()", "if (!pPhysics)", "v8::Object::New(pIsolate);", "if (LocalPhysicsInterfaceObject.IsEmpty() || PhysicsFailure.HasCaught()", "v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unPhysicsInterfaceAddress));", "if (LocalPhysicsInterfaceAddressValue.IsEmpty() || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsInterfaceObject, kPhysicsInterfaceAddressPropertyName, LocalPhysicsInterfaceAddressValue) || PhysicsFailure.HasCaught()", "v8::Undefined(pIsolate);", "if (LocalPhysicsInterfaceFunctionData.IsEmpty() || PhysicsFailure.HasCaught()", "!v8::Function::New(LocalContext, GetActivePhysicsEnvironmentByIndexCallback, LocalPhysicsInterfaceFunctionData).ToLocal(&LocalPhysicsInterfaceGetActiveEnvironmentByIndexFunction) || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsInterfaceObject, kPhysicsInterfaceGetActiveEnvironmentByIndexFunctionName, LocalPhysicsInterfaceGetActiveEnvironmentByIndexFunction) || PhysicsFailure.HasCaught()", "return LocalPhysicsInterfaceObject;"],
		Forbidden: ["!SetValue(", "SetFunction(", "v8::Number::New(", "v8::External::New("],
	},
	{
		Name: "GetPhysicsInterfacePropertyCallback",
		Fragments: ["if (!pPhysics) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsInterfaceUnavailableErrorMessage);\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "GetPhysicsInterface();\n\t\t\tif (PhysicsFailure.HasCaught()", "if (!pPhysics)", "MakePhysicsInterfaceObject(pIsolate, LocalContext, pPhysics);", "if (LocalPhysicsInterfaceObject.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsInterfaceObject);"],
		Forbidden: [],
	},
	{
		Name: "SetPhysicsInterfacePropertyCallback",
		Fragments: ['kPhysicsInterfaceReadOnlyErrorMessage = "physics.Interface is a read-only live SDK interface reference.";'],
		Order: ["if (PhysicsFailure.HasCaught()", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsInterfaceReadOnlyErrorMessage);"],
		Forbidden: ["GetReturnValue()", "GetPhysicsInterface("],
	},
	{
		Name: "CreatePhysicsInterfaceFromAddressCallback",
		Fragments: ["kPhysicsInterfaceAddressArgumentIndex = 0;", "kPhysicsInterfaceFromAddressRequiredArgumentCount = 1;", "if (LocalPhysicsInterfaceAddressValue.IsEmpty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsInterfaceFromAddressInvalidAddressErrorMessage);\n\t\t\t\treturn;", "if (!LocalPhysicsInterfaceAddressValue->IsBigInt()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsInterfaceFromAddressInvalidAddressErrorMessage);\n\t\t\t\treturn;"],
		Order: ["if (LocalContext.IsEmpty() || PhysicsFailure.HasCaught()", "if (CallbackInformation.Length() < kPhysicsInterfaceFromAddressRequiredArgumentCount)", "if (!LocalPhysicsInterfaceAddressValue->IsBigInt())", "std::uintptr_t unPhysicsInterfaceAddress = 0x0;", "!GetAddressSizedUnsignedIntegerFromValue(LocalPhysicsInterfaceAddressValue, unPhysicsInterfaceAddress) || PhysicsFailure.HasCaught()", "if ((unPhysicsInterfaceAddress == 0x0) || ((unPhysicsInterfaceAddress % alignof(IPhysics)) != 0))", "auto* const pPhysicsInterface = reinterpret_cast<IPhysics*>(unPhysicsInterfaceAddress);", "MakePhysicsInterfaceObject(pIsolate, LocalContext, pPhysicsInterface);", "if (LocalPhysicsInterfaceObject.IsEmpty() || PhysicsFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPhysicsInterfaceObject);"],
		Forbidden: ["IsNumber(", "NumberValue(", "GetPhysicsInterface("],
	},
);

g_vecChecks.push(
	{
		Name: "InstallPhysicsFunctions",
		Fragments: ["kExpectedPhysicsDefaultDataFunctionRegistrationCount = 7;", '{ "GetActiveEnvironmentByIndex", GetActivePhysicsEnvironmentByIndexCallback }', '{ "InterfaceFromAddress", CreatePhysicsInterfaceFromAddressCallback }', '{ "EnvironmentFromAddress", CreatePhysicsEnvironmentFromAddressCallback }', '{ "Object", ResolvePhysicsObjectCallback }', '{ "ObjectFromAddress", CreatePhysicsObjectFromAddressCallback }', '{ "ObjectByEntity", GetPhysicsObjectByEntityCallback }', '{ "ObjectsByEntity", GetPhysicsObjectsByEntityCallback }', "LocalPhysicsInterfacePropertyName, GetPhysicsInterfacePropertyCallback, SetPhysicsInterfacePropertyCallback);", "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsInterfaceInstallationErrorMessage);"],
		Order: ["if (PhysicsFailure.HasCaught()", "!v8::Function::New(LocalContext, GetPhysicsGravityCallback, LocalRuntimeData).ToLocal(&LocalPhysicsGravityFunction) || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsModule, kPhysicsGravityFunctionName, LocalPhysicsGravityFunction) || PhysicsFailure.HasCaught()", "MakeString(pIsolate, kPhysicsInterfacePropertyName);", "if (LocalPhysicsInterfacePropertyName.IsEmpty() || PhysicsFailure.HasCaught()", "LocalPhysicsModule->SetNativeDataProperty(", "if (!MaybeInstallationResult.FromMaybe(false) || PhysicsFailure.HasCaught()", "v8::Undefined(pIsolate);", "if (LocalPhysicsFunctionData.IsEmpty() || PhysicsFailure.HasCaught()", "for (auto const& FunctionRegistration : kPhysicsDefaultDataFunctionRegistrations)", "!v8::Function::New(LocalContext, FunctionRegistration.m_Callback, LocalPhysicsFunctionData).ToLocal(&LocalPhysicsFunction) || PhysicsFailure.HasCaught()", "!InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsModule, FunctionRegistration.m_pszFunctionName, LocalPhysicsFunction) || PhysicsFailure.HasCaught()", "return true;"],
		Forbidden: ["SetFunction("],
	},
);

function GetRawDefinition(strSource, strName) {
	const vecMatch = new RegExp("^(\\t{1,2})(?:void|bool|IPhysics\\*|IPhysicsEnvironment\\*|IPhysicsObject\\*|v8::Local<v8::Object>) " + strName + "\\([^\\n]*\\)(?: noexcept)? \\{", "m").exec(strSource);
	g_Assert(vecMatch, "Missing Physics definition: " + strName);

	const ClosingPattern = new RegExp("^" + vecMatch[1] + "\\}$", "gm");
	ClosingPattern.lastIndex = vecMatch.index + vecMatch[0].length;
	const vecClosingMatch = ClosingPattern.exec(strSource);
	g_Assert(vecClosingMatch && (vecClosingMatch.index > vecMatch.index), "Missing Physics definition end: " + strName);

	return strSource.slice(vecMatch.index, vecClosingMatch.index + vecClosingMatch[0].length);
}

function GetDefinition(strSource, strName) {
	const strDefinition = GetRawDefinition(strSource, strName);
	if (strDefinition.startsWith("\t\t")) {
		return strDefinition.split("\n").map((strLine) => strLine.startsWith("\t") ? strLine.slice(1) : strLine).join("\n");
	}

	return strDefinition;
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
	return [...strDefinition.matchAll(/^\t+(?:\} else )?if \([^\n]*PhysicsFailure\.HasCaught\(\)[^\n]*\) \{\n\t+(RethrowV8InstallationFailure\([^\n]+\);)\n\t+return(?: [^\n;]+)?;/gm)];
}

function CheckContracts(strSource) {
	for (const Boundary of g_vecBoundaries) {
		const strDefinition = GetDefinition(strSource, Boundary.Name);
		const strDiagnostic = Boundary.Diagnostic ?? "kFailureErrorMessage";
		g_Assert(strDefinition.includes("v8::TryCatch PhysicsFailure(pIsolate);\n\t\ttry {"));
		g_Assert(strDefinition.includes("} catch (std::exception const&) {\n\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, " + strDiagnostic + ");"));
		g_Assert(strDefinition.includes("} catch (...) {\n\t\t\tRethrowV8InstallationFailure(pIsolate, PhysicsFailure, " + strDiagnostic + ");"));
		g_Assert.doesNotMatch(strDefinition, /ThrowError\(|noexcept/);
		g_Assert.equal(GetFailureBranches(strDefinition).length, Boundary.Guards, "Missing immediate propagation: " + Boundary.Name);

		if (Boundary.GuardDiagnostic !== undefined) {
			for (const vecMatch of GetFailureBranches(strDefinition)) {
				g_Assert.equal(vecMatch[1], "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, " + Boundary.GuardDiagnostic + ");");
			}
		}

		for (const strGuard of ["PhysicsFailure.HasCaught()", "pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"]) {
			g_Assert.equal(strDefinition.split(strGuard).length - 1, Boundary.Guards);
		}

		if (Boundary.Result !== undefined) {
			g_Assert(strDefinition.endsWith("\n\n\t\treturn " + Boundary.Result + ";\n\t}"));
		}
	}

	for (const Resolver of g_vecAddressResolvers) {
		const strDefinition = GetDefinition(strSource, Resolver.Name);
		g_Assert(strDefinition.includes(" noexcept {"));
		g_Assert.doesNotMatch(strDefinition, /IsNumber\(|NumberValue\(|double/);
		CheckOrder(strDefinition, ["std::uintptr_t " + Resolver.Address + " = 0x0;", "if (!GetAddressSizedUnsignedIntegerFromValue(" + Resolver.Value + ", " + Resolver.Address + "))", "if ((" + Resolver.Address + " == 0x0) || ((" + Resolver.Address + " % alignof(" + Resolver.Type + ")) != 0))", "return reinterpret_cast<" + Resolver.Type + "*>(" + Resolver.Address + ");"]);
	}

	for (const Check of g_vecChecks) {
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

let g_unRejectedMutationCount = 0;

function RejectMutation(strName, strOld, strNew, unTargetOccurrence = 0) {
	const strDefinition = GetDefinition(g_strSource, strName);
	g_Assert(strDefinition.includes(strOld), "Missing mutation anchor: " + strName + ": " + strOld);

	let unOccurrence = 0;
	const strChanged = strDefinition.replaceAll(strOld, () => (unOccurrence++ === unTargetOccurrence) ? strNew : strOld);
	g_Assert.notEqual(strChanged, strDefinition);

	const strRawDefinition = GetRawDefinition(g_strSource, strName);
	g_Assert.equal(g_strSource.indexOf(strRawDefinition), g_strSource.lastIndexOf(strRawDefinition), strName + ": mutation requires one actual definition.");

	const strRawChanged = strRawDefinition.startsWith("\t\t") ? strChanged.split("\n").map((strLine) => strLine.startsWith("\t") ? "\t" + strLine : strLine).join("\n") : strChanged;
	const strChangedSource = g_strSource.replace(strRawDefinition, () => strRawChanged);
	g_Assert.notEqual(strChangedSource, g_strSource, strName + ": mutation must reach the actual source.");
	g_Assert.throws(() => CheckContracts(strChangedSource), g_Assert.AssertionError, strName + ": " + strOld);
	++g_unRejectedMutationCount;
}

CheckContracts(g_strSource);

for (const Boundary of g_vecBoundaries) {
	for (const strPart of ["v8::TryCatch PhysicsFailure(pIsolate);", "catch (std::exception const&)", "catch (...)"]) {
		RejectMutation(Boundary.Name, strPart, "");
	}

	for (const strGuard of ["PhysicsFailure.HasCaught()", "pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"]) {
		for (let unOccurrence = 0; unOccurrence < Boundary.Guards; ++unOccurrence) {
			RejectMutation(Boundary.Name, strGuard, "false", unOccurrence);
		}
	}

	const strDefinition = GetDefinition(g_strSource, Boundary.Name);
	for (const vecMatch of GetFailureBranches(strDefinition)) {
		const unOccurrence = strDefinition.slice(0, vecMatch.index).split(vecMatch[1]).length - 1;
		RejectMutation(Boundary.Name, vecMatch[1], "", unOccurrence);

		if (Boundary.GuardDiagnostic !== undefined) {
			RejectMutation(Boundary.Name, vecMatch[1], "RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kFailureErrorMessage);", unOccurrence);
		}
	}
}

for (const Resolver of g_vecAddressResolvers) {
	RejectMutation(Resolver.Name, "!GetAddressSizedUnsignedIntegerFromValue(" + Resolver.Value + ", " + Resolver.Address + ")", "false");
	RejectMutation(Resolver.Name, Resolver.Address + " == 0x0", "false");
	RejectMutation(Resolver.Name, "(" + Resolver.Address + " % alignof(" + Resolver.Type + ")) != 0", "false");
	RejectMutation(Resolver.Name, "return reinterpret_cast<" + Resolver.Type + "*>(" + Resolver.Address + ");", "return nullptr;");
}

for (const Check of g_vecChecks) {
	for (const strFragment of Check.Fragments) {
		RejectMutation(Check.Name, strFragment, "");
	}

	for (const strFragment of Check.Order) {
		RejectMutation(Check.Name, strFragment, "");
	}
}

RejectMutation("InstallPhysicsValue", "->CreateDataProperty(", "->Set(");
RejectMutation("InstallPhysicsLiveComponent", "!MaybeInstallationResult.FromMaybe(false)", "false");
RejectMutation("MakePhysicsVectorObject", "static_cast<double>(VectorValue.x)", "static_cast<double>(VectorValue.y)");
RejectMutation("MakePhysicsPositionObject", "LocalPhysicsAngleObject, kPhysicsAnglePitchPropertyName", "LocalPhysicsAngleObject, kPhysicsAngleYawPropertyName");
RejectMutation("SetPhysicsLiveComponentCallback", "kTeleportPhysicsObject = false;", "kTeleportPhysicsObject = true;");
RejectMutation("IsPhysicsObjectAttachedToConstraintCallback", "kDefaultPhysicsConstraintExternalOnly = false;", "kDefaultPhysicsConstraintExternalOnly = true;");
RejectMutation("SetPhysicsObjectBooleanStateCallback", "kDefaultPhysicsObjectBooleanSetterEnabled = true;", "kDefaultPhysicsObjectBooleanSetterEnabled = false;");
RejectMutation("GetPhysicsObjectNumberCallback", "v8::Integer::NewFromUnsigned(pIsolate, unPhysicsObjectContents)", "v8::Integer::New(pIsolate, unPhysicsObjectContents)");
RejectMutation("SetPhysicsObjectSphereRadiusCallback", "auto* const pPhysicsObject =", "TPhysicsObject* const pPhysicsObject =");
RejectMutation("SetPhysicsObjectNumberCallback", "NumberSetterOperation > PhysicsObjectNumberOperation::PhysicsObjectNumberContents", "NumberSetterOperation > PhysicsObjectNumberOperation::PhysicsObjectNumberSphereRadius");
RejectMutation("SetPhysicsObjectGameDataCallback", "unPhysicsObjectGameDataAddress ? reinterpret_cast<void*>(unPhysicsObjectGameDataAddress) : nullptr;", "nullptr;");
RejectMutation("SetPhysicsObjectPositionCallback", "kDefaultPhysicsObjectTeleport = false;", "kDefaultPhysicsObjectTeleport = true;");
RejectMutation("ParsePhysicsVelocityArguments", "pLinearVelocityOut = &LinearVelocityValueOut;", "pLinearVelocityOut = &LinearVelocityValue;");
RejectMutation("ParsePhysicsVelocityArguments", "pAngularVelocityOut = &AngularVelocityValueOut;", "pAngularVelocityOut = &AngularVelocityValue;");
RejectMutation("GetPhysicsObjectContactPointCallback", "!bPhysicsObjectContactPointHit || !pContactPhysicsObject", "!bPhysicsObjectContactPointHit && !pContactPhysicsObject");
RejectMutation("GetPhysicsObjectContactPointCallback", "!InstallPhysicsValue(", "!SetValue(");
RejectMutation("TransformPhysicsObjectVectorCallback", "VectorTransformOperation > PhysicsObjectVectorTransformOperation::PhysicsObjectVectorTransformWorldToLocalVector", "VectorTransformOperation > PhysicsObjectVectorTransformOperation::PhysicsObjectVectorTransformLocalToWorldVector");
RejectMutation("SetPhysicsObjectTriggerCallback", "kPhysicsObjectTriggerDefaultEnabled = true;", "kPhysicsObjectTriggerDefaultEnabled = false;");
RejectMutation("SetPhysicsObjectHingedCallback", "if (!bPhysicsObjectHingedEnabled)", "if (bPhysicsObjectHingedEnabled)");
RejectMutation("InstallPhysicsSphereRadiusSetter", "!InstallPhysicsValue(", "!SetValue(");
RejectMutation("InstallPhysicsObjectMethods", "!InstallPhysicsValue(", "!SetValue(");
RejectMutation("MakePhysicsObject", "!InstallPhysicsValue(", "!SetValue(");
RejectMutation("GetPhysicsEnvironmentActiveObjectsCallback", "->CreateDataProperty(", "->Set(");
RejectMutation("InstallPhysicsEnvironmentLiveComponent", "!MaybeInstallationResult.FromMaybe(false)", "false");
RejectMutation("FindActivePhysicsObjectByEntityIndex", "nPhysicsObjectEntityIndex == nEntityIndex", "nPhysicsObjectEntityIndex != nEntityIndex");
RejectMutation("InstallPhysicsEnvironmentMethods", "!InstallPhysicsValue(", "!SetValue(");
RejectMutation("MakePhysicsEnvironmentObject", "!InstallPhysicsValue(", "!SetValue(");
RejectMutation("GetPhysicsObjectsByEntityCallback", "->CreateDataProperty(", "->Set(");
RejectMutation("MakePhysicsInterfaceObject", "!InstallPhysicsValue(", "!SetValue(");
RejectMutation("InstallPhysicsFunctions", "!InstallPhysicsValue(", "!SetValue(");

console.log("Physics native source contracts PASS; rejected mutations=" + g_unRejectedMutationCount + "; live V8/engine execution not exercised.");
