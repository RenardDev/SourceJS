"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	const bHelp = (process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2]);
	const strUsage = "Usage: node tools/smoke_sound_trace_parser_contracts.js";
	if (bHelp) {
		console.log(strUsage + "\nChecks source contracts only; does not execute native IO, SDK or V8.");
		process.exit(0);
	}

	console.error(strUsage);
	process.exit(2);
}

const g_strSourcePath = g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strSource = g_FileSystem.readFileSync(g_strSourcePath, "utf8").replace(/\r\n/g, "\n");
let g_unRejectedMutationCount = 0;
const g_vecQueryOwners = [
	["StopSoundCallback", "IndexLookupFailure"],
	["GetPointContentsCallback", "PositionLookupFailure"],
	["GetPointContentsOfCollideableCallback", "EntityLookupFailure"],
	["GetPointContentsOfCollideableCallback", "PositionLookupFailure"],
	["TraceRayCallback", "RayLookupFailure"],
	["ClipRayToEntityCallback", "EntityLookupFailure"],
	["ClipRayToEntityCallback", "RayLookupFailure"],
	["ClipRayToCollideableCallback", "EntityLookupFailure"],
	["ClipRayToCollideableCallback", "RayLookupFailure"],
	["EnumerateEntitiesCallback", "RayLookupFailure"],
	["EnumerateEntitiesInBoxCallback", "MinimumBoundsLookupFailure"],
	["EnumerateEntitiesInBoxCallback", "MaximumBoundsLookupFailure"],
	["GetCollideableCallback", "IndexLookupFailure"],
	["IsPointOutsideWorldCallback", "PositionLookupFailure"],
	["GetLeafContainingPointCallback", "PositionLookupFailure"],
	["SweepCollideableCallback", "EntityLookupFailure"],
	["SweepCollideableCallback", "StartPositionLookupFailure"],
	["SweepCollideableCallback", "EndPositionLookupFailure"],
	["SweepCollideableCallback", "AnglesLookupFailure"],
	["GetEngineServerClientCVarValueCallback", "IndexLookupFailure"],
	["RequireEngineEdictArgument", "EntityLookupFailure"],
	["GetEngineServerClusterForOriginCallback", "OriginLookupFailure"],
];

const g_vecMutations = [
	["Sweep copied native identity","SweepCollideableCallback","CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();","CBaseHandle const& EntityHandle = pHandleEntity->GetRefEHandle();"],
	["Sweep captured handle validity","SweepCollideableCallback","if (!EntityHandle.IsValid())","if (false)"],
	["Sweep owner handle validity","SweepCollideableCallback","if (!pHandleEntity)","if (false)"],
	["Sweep fresh collideable commit","SweepCollideableCallback","pEntityCollideable = GetTraceCollideableFromEntityHandle(EntityHandle);","GetTraceCollideableFromEntityHandle(EntityHandle);"],
	["Sweep user Entity reread","SweepCollideableCallback","GetTraceCollideableFromEntityHandle(EntityHandle)","GetTraceCollideableFromValue(pIsolate, LocalContext, LocalEntityValue)"],
	["Collideable record native address snapshot","GetCollideableCallback","const std::uintptr_t unCollideableAddress = reinterpret_cast<std::uintptr_t>(pEntityCollideable);","const std::uintptr_t unCollideableAddress = 0;"],
	["Collideable record descriptor snapshot","GetCollideableCallback","MakeTraceEntityObject(pIsolate, LocalContext, pEntityCollideable->GetEntityHandle())","v8::Object::New(pIsolate)"],
	["Collideable record exact BigInt address","GetCollideableCallback","v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unCollideableAddress))","v8::Number::New(pIsolate, static_cast<double>(unCollideableAddress))"],
	["Entity clip copied identity","ClipRayToEntityCallback","CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();","CBaseHandle const& EntityHandle = pHandleEntity->GetRefEHandle();"],
	["Entity clip captured handle validity","ClipRayToEntityCallback","if (!EntityHandle.IsValid())","if (false)"],
	["Entity clip current handle validity","ClipRayToEntityCallback","!CurrentEntityHandle.IsValid()","false"],
	["Entity clip current entry identity","ClipRayToEntityCallback","(CurrentEntityHandle.GetEntryIndex() != EntityHandle.GetEntryIndex())","false"],
	["Entity clip current serial identity","ClipRayToEntityCallback","(CurrentEntityHandle.GetSerialNumber() != EntityHandle.GetSerialNumber())","false"],
	["Entity clip current edict validity","ClipRayToEntityCallback","if (!pEntityEdict || pEntityEdict->IsFree())","if (!pEntityEdict)"],
	["Entity clip current unknown validity","ClipRayToEntityCallback","if (!pServerUnknown)","if (false)"],
	["Entity clip fresh address commit","ClipRayToEntityCallback","pHandleEntity = pServerUnknown;","pHandleEntity = nullptr;"],
	["Collideable clip copied identity","ClipRayToCollideableCallback","CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();","CBaseHandle const& EntityHandle = pHandleEntity->GetRefEHandle();"],
	["Collideable clip captured handle validity","ClipRayToCollideableCallback","if (!EntityHandle.IsValid())","if (false)"],
	["Collideable clip initial handle validity","ClipRayToCollideableCallback","if (!pHandleEntity)","if (false)"],
	["Collideable clip fresh address commit","ClipRayToCollideableCallback","pEntityCollideable = GetTraceCollideableFromEntityHandle(EntityHandle);","GetTraceCollideableFromEntityHandle(EntityHandle);"],
	["Point contents native index snapshot", "GetPointContentsCallback", "const int nEntityIndex = GetTraceEntityIndexFromHandle(pHandleEntity);", "const int nEntityIndex = -1;"],
	["Point contents native descriptor snapshot", "GetPointContentsCallback", "MakeTraceEntityObject(pIsolate, LocalContext, pHandleEntity)", "v8::Object::New(pIsolate)"],
	["Collideable copied identity", "GetPointContentsOfCollideableCallback", "CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();", "CBaseHandle const& EntityHandle = pHandleEntity->GetRefEHandle();"],
	["Collideable fresh address assignment", "GetPointContentsOfCollideableCallback", "pCollideable = GetTraceCollideableFromEntityHandle(EntityHandle);", "GetTraceCollideableFromEntityHandle(EntityHandle);"],
	["Collideable serial identity", "GetTraceCollideableFromEntityHandle", "(CurrentEntityHandle.GetSerialNumber() != EntityHandle.GetSerialNumber())", "false"],
	["Collideable current handle validity", "GetTraceCollideableFromEntityHandle", "!CurrentEntityHandle.IsValid()", "false"],
	["Collideable current edict validity", "GetTraceCollideableFromEntityHandle", "if (!pEntityEdict || pEntityEdict->IsFree())", "if (!pEntityEdict)"],
	["Collideable captured handle validity", "GetPointContentsOfCollideableCallback", "if (!EntityHandle.IsValid())", "if (false)"],
	["Trace result entity snapshot", "MakeTraceResultObject", "const int nEntityIndex = GetTraceEntityIndexFromGameTrace(TraceInformation);", "const int nEntityIndex = -1;"],
	["Trace result surface name ownership", "MakeTraceResultObject", "SurfaceInformation.name = strSurfaceName.c_str();", "SurfaceInformation.name = TraceInformation.surface.name;"],
	["Trace result copied surface", "MakeTraceResultObject", "MakeSurfaceObject(pIsolate, LocalContext, SurfaceInformation);", "MakeSurfaceObject(pIsolate, LocalContext, TraceInformation.surface);"],
	["Trace property failed lookup", "GetTraceObjectPropertyValue", "if (!LocalSourceObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalPropertyValue) || LocalPropertyValue.IsEmpty()) {\n\t\t\t\treturn {};\n\t\t\t}", "if (!LocalSourceObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalPropertyValue) || LocalPropertyValue.IsEmpty()) {\n\t\t\t\treturn v8::Undefined(pIsolate);\n\t\t\t}"],
	["Trace type default", "GetTraceTypeFromObject", "if (IsValueNullish(LocalPropertyValue))", "if (true)"],
	["Trace type absent presence", "GetTraceTypeFromObject", "bHasTraceTypeOut = false;", "bHasTraceTypeOut = true;"],
	["Trace type present presence", "GetTraceTypeFromObject", "bHasTraceTypeOut = true;", "bHasTraceTypeOut = false;"],
	["Trace type failed presence output", "GetTraceTypeFromObject", "v8::Local<v8::Value> const LocalPropertyValue =", "bHasTraceTypeOut = false;\n\t\t\tv8::Local<v8::Value> const LocalPropertyValue ="],
	["Trace ignored index error boundary", "GetTraceIgnoredEntityIndexFromValue", "GetEntityIndexFromValue(pIsolate, LocalContext, LocalValue, nEntityIndex)", "GetIntegerFromValue(LocalContext, LocalValue, nEntityIndex)"],
	["Trace ignored index failed output", "GetTraceIgnoredEntityIndexFromValue", "int nEntityIndex = -1;", "nEntityIndexOut = -1;\n\t\t\tint nEntityIndex = -1;"],
	["Trace ray range gate", "RequireTraceRayFromValue", "if (!IsRayGeometrySafe(StartVector, EndVector, MinimumBounds, MaximumBounds, bHasMinimums))", "if (false)"],
	["Trace ray delta range", "RequireTraceRayFromValue", "!IsFiniteFloatValue(dblDelta)", "false"],
	["Trace ray extent range", "RequireTraceRayFromValue", "!IsFiniteFloatValue(dblExtent)", "false"],
	["Trace ray bounds-sum range", "RequireTraceRayFromValue", "!IsFiniteFloatValue(dblBoundsSum)", "false"],
	["Trace ray centered-start range", "RequireTraceRayFromValue", "!IsFiniteFloatValue(dblStart + dblStartOffset)", "false"],
	["Trace mask default", "GetTraceMaskFromValue", "if (IsValueNullish(LocalValue))", "if (true)"],
	["Trace vector failed output", "GetTraceRayVectorPropertyFromObject", "v8::Local<v8::Value> const LocalPropertyValue =", "bHasVectorOut = false;\n\t\t\tv8::Local<v8::Value> const LocalPropertyValue ="],
	["Sound origins failed output", "CollectSoundOrigins", "if (IsValueNullish(LocalValue))", "if (true)"],
	["Sound recipients failed output", "CollectSoundRecipients", "std::vector<int> vecRecipientEntityIndices {};", "vecRecipientEntityIndicesOut.clear();\n\t\t\tstd::vector<int> vecRecipientEntityIndices {};"],
	["Sound recipient original exception", "GetSoundRecipientIndexFromValue", "GetEntityIndexFromValue(pIsolate, LocalContext, LocalValue, nRecipientIndex)", "GetIntegerFromValue(LocalContext, LocalValue, nRecipientIndex)"],
	["Sound recipient positive range", "GetSoundRecipientIndexFromValue", "if (nRecipientIndex <= 0)", "if (false)"],
	["Sound recipient snapshot failed output", "CollectSoundRecipientIndicesFromValue", "std::vector<int> vecRecipientIndices {};", "vecRecipientIndicesOut.clear();\n\t\t\tstd::vector<int> vecRecipientIndices {};"],
	["Sound recipient filter shape", "CollectSoundRecipientIndicesFromValue", "if (!LocalRecipientIndexesValue->IsArray())", "if (false)"],
	["Sound recipient eligibility", "CollectSoundRecipients", "AddUniqueRecipientEntityIndex(vecRecipientEntityIndices, nRecipientIndex, kIncludeBots);", "vecRecipientEntityIndices.push_back(nRecipientIndex);"],
	["Sound recipient snapshot collection", "CollectSoundRecipients", "CollectSoundRecipientIndicesFromValue(pIsolate, LocalContext, LocalRecipientValue, pszOperationName, vecValidatedRecipientIndices)", "CollectRecipientEntityIndicesFromValue(pIsolate, LocalContext, LocalRecipientValue, vecValidatedRecipientIndices, kIncludeBots, pszOperationName)"],
	["SDK unsupported looping output", "TryGetEngineSoundLoopingState", "if constexpr (kSDKHasIsLoopingSound<TEngineSound>)", "bIsLoopingOut = false;\n\t\t\tif constexpr (kSDKHasIsLoopingSound<TEngineSound>)"],
	["Sound property native propagation", "GetSoundObjectPropertyValue", ") {", ") noexcept {", true],
	["Trace property native propagation", "GetTraceObjectPropertyValue", ") {", ") noexcept {", true],
	["Sound origin growth headroom", "CollectSoundOrigins", "kMaximumSDKGrowthFactor = 2", "kMaximumSDKGrowthFactor = 1"],
	["Sound origin signed capacity", "CollectSoundOrigins", "static_cast<std::size_t>(std::numeric_limits<int>::max()) / kMaximumSDKGrowthFactor", "static_cast<std::size_t>(std::numeric_limits<int>::max())"],
	["Sound origin byte capacity", "CollectSoundOrigins", "std::numeric_limits<std::size_t>::max() / sizeof(Vector) / kMaximumSDKGrowthFactor", "std::numeric_limits<std::size_t>::max() / sizeof(Vector)"],
	["Sound origin capacity gate", "CollectSoundOrigins", "if (static_cast<std::size_t>(unOriginCount) > kMaximumOriginCount)", "if (false)"],
	["Trace type native propagation", "GetTraceTypeFromObject", ") {", ") noexcept {", true],
	["Trace function native propagation", "GetTraceFunctionFromValue", ") {", ") noexcept {", true],
	["Trace type failed value output", "GetTraceTypeFromObject", "v8::Local<v8::Value> const LocalPropertyValue =", "nTraceTypeOut = 0;\n\t\t\tv8::Local<v8::Value> const LocalPropertyValue ="],
	["Trace direct function", "GetTraceFunctionFromValue", "return LocalValue.As<v8::Function>();", "return {};"],
	["Game directory bounded termination", "GetEngineServerGameDirectoryCallback", "szGameDirectory[kGameDirectoryBufferSize - 1] = '\\0';", ""],
	["Spatial partition early release", "CreateEngineServerSpatialPartitionCallback", "v8::Local<v8::Object> const LocalSpatialPartitionObject =", "pSpatialPartitionOwner.release();\n\t\t\t\tv8::Local<v8::Object> const LocalSpatialPartitionObject ="],
	["Spatial partition missing handoff", "CreateEngineServerSpatialPartitionCallback", "pSpatialPartitionOwner.release();", ""],
	["Spatial partition cleanup diagnostics", "CreateEngineServerSpatialPartitionCallback", "bSpatialPartitionCleanupFailed = !ReleaseUnreturnedEngineServerSpatialPartition(pEngineServer, pUnreturnedSpatialPartition);", "ReleaseUnreturnedEngineServerSpatialPartition(pEngineServer, pUnreturnedSpatialPartition);"],
];

function GetFunctionBody(strSource, strName) {
	const strEscapedName = strName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const Expression = new RegExp("^(\\t+)(?!(?:if|for|while|switch|catch|return|else)\\b)[A-Za-z_][^\\t\\n;{}=]*[ &*]" + strEscapedName + "\\([^;\\n]*\\)(?: const)?(?: noexcept)?(?: try)? \\{$", "gm");
	const vecMatches = Array.from(strSource.matchAll(Expression));
	g_Assert.equal(vecMatches.length, 1, strName + ": function definition is missing or ambiguous.");

	const vecMatch = vecMatches[0];
	const strTerminator = "\n" + vecMatch[1] + "}";
	const nEndIndex = strSource.indexOf(strTerminator + "\n", vecMatch.index);
	g_Assert(nEndIndex > vecMatch.index, strName + ": function closing brace is missing.");

	return strSource.slice(vecMatch.index, nEndIndex + strTerminator.length);
}

function GetTraceOwnerBody(strSource, strClassName) {
	const strEscapedName = strClassName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecMatches = Array.from(strSource.matchAll(new RegExp("^(\\t+)class " + strEscapedName + " : public I" + strEscapedName + " \\{$", "gm")));
	g_Assert.equal(vecMatches.length, 1, strClassName + ": class is missing or ambiguous.");

	const vecMatch = vecMatches[0];
	const vecConstructors = Array.from(strSource.matchAll(new RegExp("^" + vecMatch[1] + strEscapedName + "::" + strEscapedName + "\\([^;\\n]*\\) :$", "gm")));
	g_Assert.equal(vecConstructors.length, 1, strClassName + ": constructor is missing or ambiguous.");

	const unConstructorStartIndex = vecConstructors[0].index;
	const strTerminator = "\n" + vecMatch[1] + "}";
	const nEndIndex = strSource.indexOf(strTerminator + "\n", unConstructorStartIndex);
	g_Assert((unConstructorStartIndex > vecMatch.index) && (nEndIndex > unConstructorStartIndex), strClassName + ": constructor boundary is missing.");

	return strSource.slice(vecMatch.index, nEndIndex + strTerminator.length);
}

function VerifyExtractors() {
	for (const strIndent of ["\t", "\t\t"]) {
		const strCall = strIndent + "if (Probe()) {\n" + strIndent + "}\n";
		const strPrototype = strIndent + "bool Probe();\n";
		for (const strSuffix of ["", " noexcept", " try"]) {
			const strCatch = (strSuffix === " try") ? (" catch (...) {\n" + strIndent + "\treturn false;\n" + strIndent + "}") : "";
			const strDefinition = strIndent + "bool Probe()" + strSuffix + " {\n" + strIndent + "\treturn true;\n" + strIndent + "}" + strCatch;
			g_Assert.equal(GetFunctionBody(strCall + strPrototype + strDefinition + "\n", "Probe"), strDefinition);
		}

		g_Assert.throws(() => GetFunctionBody(strCall + strPrototype, "Probe"), g_Assert.AssertionError);

		const strClass = strIndent + "class Probe : public IProbe {\n" + strIndent + "public:\n" + strIndent + "\tProbe(bool bReady);\n" + strIndent + "\tbool m_bReady;\n" + strIndent + "};\n\n";
		const strConstructor = strIndent + "Probe::Probe(bool bReady) :\n" + strIndent + "\tm_bReady(bReady)\n" + strIndent + "{\n" + strIndent + "}\n";
		g_Assert.equal(GetTraceOwnerBody(strClass + strConstructor, "Probe"), (strClass + strConstructor).trimEnd());
		g_Assert.throws(() => GetTraceOwnerBody(strClass, "Probe"), g_Assert.AssertionError);
	}
}

function VerifyContracts(strSource) {
	const strPropertyReader = GetFunctionBody(strSource, "GetTraceObjectPropertyValue");
	g_Assert(!strPropertyReader.includes("return v8::Undefined(pIsolate);"), "Trace property failure must not become a nullish default.");
	g_Assert(strPropertyReader.includes("->Get(LocalContext, LocalPropertyName).ToLocal(&LocalPropertyValue)"), "Trace property lookup must preserve the pending getter error.");
	g_Assert(!strPropertyReader.split("\n")[0].includes("noexcept"), "Trace property lookup must allow native failures to reach the owning boundary.");
	g_Assert(!GetFunctionBody(strSource, "GetSoundObjectPropertyValue").split("\n")[0].includes("noexcept"), "Sound property lookup must allow native failures to reach the owning boundary.");

	g_Assert(!strSource.includes("\t\tbool TryGetTraceObjectPropertyPresence("), "Do not retain the unused old presence helper.");

	const strFunction = GetFunctionBody(strSource, "GetTraceFunctionFromValue");
	g_Assert(!strFunction.split("\n")[0].includes("noexcept"), "Trace function lookup must allow native failures to reach the owning boundary.");
	g_Assert(/if \(LocalValue->IsFunction\(\)\) \{\n\t+return LocalValue.As<v8::Function>\(\);/.test(strFunction), "Trace function lookup must preserve direct function inputs.");

	const vecUnwindGuards = [...GetTraceOwnerBody(strSource, "TraceFilter").matchAll(/if \((MethodLookupFailure|CallbackTryCatch)\.HasCaught\(\)\) \{\n\t+\1\.ReThrow\(\);\n\t+}\n\n\t+throw;/g)];
	g_Assert.equal(vecUnwindGuards.length, 3, "Trace filter must preserve pending errors during both method lookups and callback unwinding.");

	const vecEnumeratorUnwindGuards = [...GetTraceOwnerBody(strSource, "EntityEnumerator").matchAll(/if \((MethodLookupFailure|CallbackTryCatch)\.HasCaught\(\)\) \{\n\t+\1\.ReThrow\(\);\n\t+}\n\n\t+throw;/g)];
	g_Assert.equal(vecEnumeratorUnwindGuards.length, 2, "Trace enumerator must preserve pending errors during method lookup and callback unwinding.");
	g_Assert(GetTraceOwnerBody(strSource, "EntityEnumerator").includes("engines/trace enumerator EnumEntity(EntityInformation) must return a boolean."), "Enumerator diagnostics must name the actual callback argument.");

	const strResult = GetFunctionBody(strSource, "MakeTraceResultObject");
	const nFirstJSPhase = strResult.indexOf("v8::Local<v8::Object> LocalTraceResultObject {};");
	for (const strSnapshot of [
		"csurface_t SurfaceInformation = TraceInformation.surface;",
		"std::string const strSurfaceName = SurfaceInformation.name ? SurfaceInformation.name : \"\";",
		"SurfaceInformation.name = strSurfaceName.c_str();",
		"const int nEntityIndex = GetTraceEntityIndexFromGameTrace(TraceInformation);",
	]) {
		const nSnapshot = strResult.indexOf(strSnapshot);
		g_Assert((nSnapshot >= 0) && (nSnapshot < nFirstJSPhase), "Snapshot borrowed trace data before any JavaScript result construction or writes.");
		g_Assert.equal(strResult.split(strSnapshot).length, 2, "Borrowed data snapshot must be unique.");
	}

	g_Assert(strResult.includes("MakeSurfaceObject(pIsolate, LocalContext, SurfaceInformation);"), "Render from the surface copy with its owned name.");

	const strPoint = GetFunctionBody(strSource, "GetPointContentsCallback");
	const nPointIndex = strPoint.indexOf("const int nEntityIndex = GetTraceEntityIndexFromHandle(pHandleEntity);");
	const nPointDescriptor = strPoint.indexOf("MakeTraceEntityObject(pIsolate, LocalContext, pHandleEntity)");
	const nPointResult = strPoint.indexOf("v8::Local<v8::Object> const LocalPointContentsResultObject = v8::Object::New(pIsolate);");
	g_Assert((nPointIndex >= 0) && (nPointDescriptor > nPointIndex) && (nPointResult > nPointDescriptor), "Capture native point index and descriptor before output record setters.");
	g_Assert(strPoint.lastIndexOf("pHandleEntity") < nPointResult, "Never consume the native entity after any point result write.");
	g_Assert.equal(strPoint.split("GetTraceEntityIndexFromHandle(").length, 2, "Point index snapshot must be read once by its owner.");

	const strCollideable = GetFunctionBody(strSource, "GetPointContentsOfCollideableCallback");
	const nCopiedHandle = strCollideable.indexOf("CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();");
	const nPositionRead = strCollideable.indexOf("v8::Local<v8::Value> const LocalPositionValue =");
	const nVectorRead = strCollideable.indexOf("RequireTraceVectorFromValue(");
	const nFreshCollideable = strCollideable.indexOf("pCollideable = GetTraceCollideableFromEntityHandle(EntityHandle);");
	const nCollideableDispatch = strCollideable.indexOf("pEngineTrace->GetPointContents_Collideable(");
	g_Assert((nCopiedHandle >= 0) && (nPositionRead > nCopiedHandle) && (nVectorRead > nPositionRead) && (nFreshCollideable > nVectorRead) && (nCollideableDispatch > nFreshCollideable), "Copy native identity before Position getters and resolve a fresh collideable before SDK dispatch.");
	g_Assert(strCollideable.includes("if (!EntityHandle.IsValid())"), "Reject an invalid captured handle.");
	g_Assert.equal(strCollideable.split("GetTraceCollideableFromValue(").length, 2, "Read user Entity only once through its initial resolver.");
	g_Assert.equal(strCollideable.split("GetTraceCollideableFromEntityHandle(").length, 2, "Revalidate from the saved native identity, not user Entity.");
	const strCurrentCollideable = GetFunctionBody(strSource, "GetTraceCollideableFromEntityHandle");
	for (const strGuard of ["!CurrentEntityHandle.IsValid()", "(CurrentEntityHandle.GetEntryIndex() != EntityHandle.GetEntryIndex())", "(CurrentEntityHandle.GetSerialNumber() != EntityHandle.GetSerialNumber())", "if (!pEntityEdict || pEntityEdict->IsFree())", "return pServerUnknown->GetCollideable();"]) {
		g_Assert(strCurrentCollideable.includes(strGuard), "Resolve fresh collideable only from a current complete native identity.");
	}

	g_Assert(!strCurrentCollideable.includes("v8::") && !strCurrentCollideable.includes("GetValueIndex("), "Native identity revalidation must not reread JavaScript values.");

	for (const strCallbackName of ["ClipRayToEntityCallback", "ClipRayToCollideableCallback"]) {
		const strClip = GetFunctionBody(strSource, strCallbackName);
		const bCollideable = strCallbackName === "ClipRayToCollideableCallback";
		const nIdentityCopy = strClip.indexOf("CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();");
		const nRayValue = strClip.indexOf("v8::Local<v8::Value> const LocalRayValue =");
		const nRayParser = strClip.indexOf("RequireTraceRayFromValue(");
		const nTargetValidation = strClip.indexOf("ValidateTraceResultTarget(");
		const strFreshIdentity = bCollideable ? "pEntityCollideable = GetTraceCollideableFromEntityHandle(EntityHandle);" : "GetEdictFromEntityIndex(EntityHandle.GetEntryIndex())";
		const nFreshIdentity = strClip.indexOf(strFreshIdentity);
		const nDispatch = strClip.indexOf(bCollideable ? "pEngineTrace->ClipRayToCollideable(" : "pEngineTrace->ClipRayToEntity(");
		g_Assert((nIdentityCopy >= 0) && (nRayValue > nIdentityCopy) && (nRayParser > nRayValue) && (nTargetValidation > nRayParser) && (nFreshIdentity > nTargetValidation) && (nDispatch > nFreshIdentity), "Copy clip native identity before Ray getters and revalidate after all user parsing, immediately before SDK dispatch.");
		g_Assert(strClip.includes("if (!EntityHandle.IsValid())") && strClip.includes("if (!pHandleEntity)"), "Reject invalid clip native identity before Ray getters.");
		g_Assert.equal(strClip.split(bCollideable ? "GetTraceCollideableFromValue(" : "GetTraceHandleEntityFromValue(").length, 2, "Read user clip Entity once through its initial resolver.");
		if (bCollideable) {
			g_Assert(strClip.indexOf("pEntityCollideable->GetEntityHandle()") < nIdentityCopy, "Copy the collideable owner handle before Ray getters.");
			g_Assert.equal(strClip.split("GetTraceCollideableFromEntityHandle(").length, 2, "Refresh collideable only from the saved native identity.");

		} else {
			for (const strGuard of ["!CurrentEntityHandle.IsValid()", "(CurrentEntityHandle.GetEntryIndex() != EntityHandle.GetEntryIndex())", "(CurrentEntityHandle.GetSerialNumber() != EntityHandle.GetSerialNumber())", "if (!pEntityEdict || pEntityEdict->IsFree())", "if (!pServerUnknown)"]) {
				g_Assert(strClip.includes(strGuard), "Resolve the clip entity from a current complete native identity.");
			}

			const nFreshCommit = strClip.indexOf("pHandleEntity = pServerUnknown;");
			g_Assert((nFreshCommit > nFreshIdentity) && (nDispatch > nFreshCommit), "Commit the fresh entity address rather than the pre-getter address.");
		}
	}

	g_Assert(/if \(IndexLookupFailure\.HasCaught\(\)\) \{\n\t+IndexLookupFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/.test(GetFunctionBody(strSource, "EmitSoundCallback")), "Sound entity selection must preserve pending errors during native unwinding.");
	for (const vecOwner of g_vecQueryOwners) {
		const UnwindPattern = new RegExp("if \\(" + vecOwner[1] + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + vecOwner[1] + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;", "g");
		g_Assert.equal([...GetFunctionBody(strSource, vecOwner[0]).matchAll(UnwindPattern)].length, 1, vecOwner.join(": ") + ": preserve the pending error during native unwinding.");
	}

	const strSweep = GetFunctionBody(strSource, "SweepCollideableCallback");
	const nSweepOwnerHandle = strSweep.indexOf("pEntityCollideable->GetEntityHandle()");
	const nSweepIdentityCopy = strSweep.indexOf("CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();");
	const nSweepStartValue = strSweep.indexOf("v8::Local<v8::Value> const LocalStartPositionValue =");
	const nSweepLastVector = strSweep.lastIndexOf("RequireTraceVectorFromValue(");
	const nSweepAngles = strSweep.indexOf("RequireTraceAngleFromValue(");
	const nSweepTargetValidation = strSweep.indexOf("ValidateTraceResultTarget(");
	const nSweepFilter = strSweep.indexOf("TraceFilter TraceFilterAdapter = TraceFilter(pIsolate, LocalContext, LocalFilterValue);");
	const nSweepFilterValidity = strSweep.indexOf("if (!TraceFilterAdapter.IsValid())", nSweepFilter);
	const nSweepRefresh = strSweep.indexOf("pEntityCollideable = GetTraceCollideableFromEntityHandle(EntityHandle);");
	const nSweepDispatch = strSweep.indexOf("pEngineTrace->SweepCollideable(");
	g_Assert((nSweepOwnerHandle >= 0) && (nSweepIdentityCopy > nSweepOwnerHandle) && (nSweepStartValue > nSweepIdentityCopy) && (nSweepLastVector > nSweepStartValue) && (nSweepAngles > nSweepLastVector) && (nSweepTargetValidation > nSweepAngles) && (nSweepFilter > nSweepTargetValidation) && (nSweepFilterValidity > nSweepFilter) && (nSweepRefresh > nSweepFilterValidity) && (nSweepDispatch > nSweepRefresh), "Copy sweep identity before input callbacks and refresh only after filter preparation, before SDK dispatch.");
	g_Assert(strSweep.includes("if (!pHandleEntity)") && strSweep.includes("if (!EntityHandle.IsValid())"), "Validate the copied sweep owner identity before input getters.");
	g_Assert.equal(strSweep.split("GetTraceCollideableFromValue(").length, 2, "Read user sweep Entity only once.");
	g_Assert.equal(strSweep.split("GetTraceCollideableFromEntityHandle(").length, 2, "Refresh sweep collider only from saved native identity.");

	const strCollideableRecord = GetFunctionBody(strSource, "GetCollideableCallback");
	const nRecordAddress = strCollideableRecord.indexOf("const std::uintptr_t unCollideableAddress = reinterpret_cast<std::uintptr_t>(pEntityCollideable);");
	const nRecordDescriptor = strCollideableRecord.indexOf("MakeTraceEntityObject(pIsolate, LocalContext, pEntityCollideable->GetEntityHandle())");
	const nRecordFirstWrite = strCollideableRecord.indexOf("SetRecordProperty(pIsolate, LocalContext, LocalCollideableObject, kEntityIndexPropertyName, v8::Integer::New(pIsolate, nEntityIndex))");
	g_Assert((nRecordAddress >= 0) && (nRecordDescriptor > nRecordAddress) && (nRecordFirstWrite > nRecordDescriptor), "Snapshot collideable address and entity descriptor before defining record fields.");
	g_Assert(strCollideableRecord.lastIndexOf("pEntityCollideable") < nRecordFirstWrite, "Never consume borrowed collider data after defining record fields.");
	g_Assert(strCollideableRecord.includes("v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unCollideableAddress))"), "Expose the borrowed address as exact BigInt, never Number.");

	const strGameDirectory = GetFunctionBody(strSource, "GetEngineServerGameDirectoryCallback");
	const nDirectoryWrite = strGameDirectory.indexOf("pEngineServer->GetGameDir(");
	const nDirectoryTerminator = strGameDirectory.indexOf("szGameDirectory[kGameDirectoryBufferSize - 1] = '\\0';");
	const nDirectoryRead = strGameDirectory.indexOf("MakeString(pIsolate, szGameDirectory)");
	g_Assert((nDirectoryWrite >= 0) && (nDirectoryTerminator > nDirectoryWrite) && (nDirectoryRead > nDirectoryTerminator), "Game directory must terminate the bounded SDK buffer before string conversion.");

	const strPartition = GetFunctionBody(strSource, "CreateEngineServerSpatialPartitionCallback");
	const nPartitionOwner = strPartition.indexOf("std::unique_ptr<ISpatialPartition, decltype(ReleaseSpatialPartition)> pSpatialPartitionOwner(");
	const nPartitionWrapper = strPartition.indexOf("MakeEngineServerAddressObject(");
	const nPartitionCommit = strPartition.indexOf("CallbackInformation.GetReturnValue().Set(LocalSpatialPartitionObject);");
	const nPartitionRelease = strPartition.indexOf("pSpatialPartitionOwner.release();");
	g_Assert((nPartitionOwner >= 0) && (nPartitionOwner < nPartitionWrapper) && (nPartitionRelease > nPartitionCommit) && (strPartition.split("pSpatialPartitionOwner.release();").length === 2), "Spatial-partition ownership must cover wrapping and transfer exactly once after result commit.");
	g_Assert(strPartition.includes("pSpatialPartitionOwner.reset();"), "An empty spatial-partition wrapper must run cleanup before returning.");
	g_Assert(strPartition.includes("bSpatialPartitionCleanupFailed = !ReleaseUnreturnedEngineServerSpatialPartition(pEngineServer, pUnreturnedSpatialPartition);"), "Spatial-partition cleanup failure must reach the contextual error boundary.");

	const strTraceType = GetFunctionBody(strSource, "GetTraceTypeFromObject");
	g_Assert(!strTraceType.split("\n")[0].includes("noexcept"), "The used type/presence parser must allow native failures to reach its owner.");
	g_Assert(strTraceType.indexOf("nTraceTypeOut = ") > strTraceType.indexOf("if (IsValueNullish(LocalPropertyValue))"), "A failed property lookup must not change integer output.");
	g_Assert(strTraceType.includes("if (LocalPropertyValue.IsEmpty())"), "Trace type must reject a failed property lookup.");
	g_Assert(/if \(IsValueNullish\(LocalPropertyValue\)\) \{\n(\t+)nTraceTypeOut = nDefaultTraceType;\n\1bHasTraceTypeOut = false;\n\1return true;/.test(strTraceType), "Trace type default and absent-presence flag must commit from one successful nullish lookup.");
	g_Assert.equal(strTraceType.split("GetTraceObjectPropertyValue(").length, 2, "Trace type must read its property once.");
	g_Assert(strTraceType.indexOf("bHasTraceTypeOut = false;") > strTraceType.indexOf("if (IsValueNullish(LocalPropertyValue))"), "Failed type lookup must not modify presence output.");
	g_Assert(strTraceType.indexOf("nTraceTypeOut = nTraceType;") > strTraceType.indexOf("if (!GetInt32Argument("), "Parse type into a temporary before committing.");
	g_Assert(strTraceType.indexOf("bHasTraceTypeOut = true;") > strTraceType.indexOf("nTraceTypeOut = nTraceType;"), "Commit present type and presence only after successful parsing.");

	const strFilter = GetTraceOwnerBody(strSource, "TraceFilter");
	g_Assert(strFilter.includes("engines/trace filter ShouldHitEntity(EntityInformation, nContentsMask) must return a boolean."), "Callback diagnostics must use the actual documented signature.");
	const strShouldHitLookup = "GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kShouldHitEntityPropertyName)";
	const strGetTypeLookup = "GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kGetTraceTypePropertyName)";
	const strTypeLookup = "GetTraceTypeFromObject(pIsolate, LocalContext, LocalFilterObject, kTraceTypePropertyName, TRACE_EVERYTHING, nTraceType, bHasTraceType)";
	for (const strLookup of [strShouldHitLookup, strGetTypeLookup, strTypeLookup]) {
		g_Assert.equal(strFilter.split(strLookup).length, 2, "Read each selected filter property once.");
	}

	g_Assert(!strFilter.includes("TryGetTraceObjectPropertyPresence(pIsolate, LocalContext, LocalFilterObject, kShouldHitEntityPropertyName,") && !strFilter.includes("TryGetTraceObjectPropertyPresence(pIsolate, LocalContext, LocalFilterObject, kTraceTypePropertyName,") && !strFilter.includes("TryGetTraceObjectPropertyPresence(pIsolate, LocalContext, LocalFilterObject, kGetTraceTypePropertyName,"), "Do not reread selected filter properties for presence.");
	g_Assert(strFilter.includes("if (!IsValueNullish(LocalShouldHitEntityValue))") && strFilter.includes("if (!LocalShouldHitEntityValue->IsFunction())") && strFilter.includes("m_ShouldHitEntityFunctionHandle.Reset(pIsolate, LocalShouldHitEntityValue.As<v8::Function>());"), "Validate and store the same nullable ShouldHitEntity snapshot.");
	g_Assert((strFilter.indexOf(strTypeLookup) < strFilter.indexOf("if (!bHasTraceType)")) && (strFilter.indexOf("if (!bHasTraceType)") < strFilter.indexOf(strGetTypeLookup)), "Preserve explicit TraceType precedence without reading GetTraceType.");
	g_Assert(strFilter.includes("if (!IsValueNullish(LocalGetTraceTypeValue))") && strFilter.includes("if (!LocalGetTraceTypeValue->IsFunction())") && strFilter.includes("LocalGetTraceTypeValue.As<v8::Function>();"), "Validate and call the same nullable GetTraceType snapshot.");

	const strIgnoredIndex = GetFunctionBody(strSource, "GetTraceIgnoredEntityIndexFromValue");
	g_Assert(strIgnoredIndex.includes("GetEntityIndexFromValue(pIsolate, LocalContext, LocalValue, nEntityIndex)"), "Ignored indexes require the shared original-error/native-unwind boundary.");
	g_Assert(!strIgnoredIndex.includes("nEntityIndexOut = -1;") && (strIgnoredIndex.indexOf("nEntityIndexOut = nEntityIndex;") > strIgnoredIndex.indexOf("if (nEntityIndex < 0)")), "Commit only successfully parsed nonnegative ignored indexes.");

	const strRay = GetFunctionBody(strSource, "RequireTraceRayFromValue");
	const strRayGate = "if (!IsRayGeometrySafe(StartVector, EndVector, MinimumBounds, MaximumBounds, bHasMinimums))";
	g_Assert((strRay.indexOf(strRayGate) >= 0) && (strRay.indexOf(strRayGate) < strRay.indexOf("RayOut.Init(")), "Reject unsafe coordinate construction before mutating the SDK ray.");
	for (const strCheck of ["!IsFiniteFloatValue(dblDelta)", "!IsFiniteFloatValue(dblExtent)", "!IsFiniteFloatValue(dblBoundsSum)", "!IsFiniteFloatValue(dblStart + dblStartOffset)"]) {
		g_Assert(strRay.includes(strCheck), "Keep each derived coordinate range check.");
	}

	g_Assert(strRay.includes("std::isfinite(dblValue) && (std::fabs(dblValue) <= kMaximumFloat)"), "Coordinate range checks must reject nonfinite and out-of-range values.");
	g_Assert(strRay.indexOf("!IsFiniteFloatValue(dblBoundsSum)") < strRay.indexOf("static_cast<float>(dblBoundsSum)"), "Validate the wider sum before narrowing.");
	g_Assert(strRay.includes("static_cast<double>(static_cast<float>(dblBoundsSum)) * kCenterScale"), "Preserve the SDK's rounded float sum before centering.");

	const strTraceMask = GetFunctionBody(strSource, "GetTraceMaskFromValue");
	g_Assert(/if \(IsValueNullish\(LocalValue\)\) \{\n(\t+)unTraceMaskOut = unDefaultTraceMask;\n\1return true;/.test(strTraceMask), "Trace mask default must commit only for a valid nullish input.");
	g_Assert(strTraceMask.indexOf("unTraceMaskOut = static_cast<unsigned int>(unParsedTraceMask);") > strTraceMask.indexOf("GetUInt32Argument("), "Trace mask must validate before committing its output.");

	const strTraceVector = GetFunctionBody(strSource, "GetTraceRayVectorPropertyFromObject");
	g_Assert(strTraceVector.includes("if (LocalPropertyValue.IsEmpty())"), "Trace vector must reject a failed property lookup.");
	g_Assert(!strTraceVector.includes("bHasVectorOut = false;") && !strTraceVector.includes("VectorValueOut.Init("), "Trace vector must not reset outputs before parsing.");

	const strOrigins = GetFunctionBody(strSource, "CollectSoundOrigins");
	g_Assert(/if \(IsValueNullish\(LocalValue\)\) \{\n(\t+)vecOriginsOut.RemoveAll\(\);\n\1return true;/.test(strOrigins), "Sound origins must clear output only on successful nullish input.");
	g_Assert(strOrigins.indexOf("vecOriginsOut = vecOrigins;") > strOrigins.indexOf("vecOrigins.AddToTail("), "Sound origins must parse into temporary storage before committing.");
	g_Assert(strOrigins.includes("kMaximumSDKGrowthFactor = 2;"), "Sound origins must reserve one SDK capacity doubling.");
	g_Assert(strOrigins.includes("std::min(static_cast<std::size_t>(std::numeric_limits<int>::max()) / kMaximumSDKGrowthFactor, std::numeric_limits<std::size_t>::max() / sizeof(Vector) / kMaximumSDKGrowthFactor)"), "Sound origins must bound both signed element count and address-sized bytes.");

	const nCapacityCheck = strOrigins.indexOf("if (static_cast<std::size_t>(unOriginCount) > kMaximumOriginCount)");
	g_Assert((nCapacityCheck >= 0) && (nCapacityCheck < strOrigins.indexOf("CUtlVector<Vector> vecOrigins {};")) && (nCapacityCheck < strOrigins.indexOf("LocalOriginsArray->Get(")), "Sound origins must reject unsafe capacity before storage or element access.");

	const strRecipients = GetFunctionBody(strSource, "CollectSoundRecipients");
	g_Assert(strRecipients.includes("std::vector<int> vecRecipientEntityIndices {};"), "Sound recipients require temporary output storage.");
	g_Assert(!strRecipients.includes("vecRecipientEntityIndicesOut.clear();"), "Sound recipients must not clear failed output.");
	g_Assert(strRecipients.includes("CollectPlayerEntityIndices(pIsolate, vecRecipientEntityIndices,"), "Default recipients must collect into temporary storage.");
	const strSnapshotCall = "CollectSoundRecipientIndicesFromValue(pIsolate, LocalContext, LocalRecipientValue, pszOperationName, vecValidatedRecipientIndices)";
	g_Assert(strRecipients.includes(strSnapshotCall) && !strRecipients.includes("CollectRecipientEntityIndicesFromValue("), "Explicit recipients must use one validated snapshot, not reread JavaScript values.");
	g_Assert(strRecipients.indexOf(strSnapshotCall) < strRecipients.indexOf("RequirePlayerLookup("), "Validate explicit recipients before checking lookup availability, including empty arrays.");
	g_Assert(strRecipients.includes("for (auto const& nRecipientIndex : vecValidatedRecipientIndices)") && strRecipients.includes("AddUniqueRecipientEntityIndex(vecRecipientEntityIndices, nRecipientIndex, kIncludeBots);"), "Filter SDK eligibility and uniqueness using validated indexes only.");
	g_Assert(strRecipients.includes("constexpr bool kIncludeBots = true;") && strRecipients.includes("PlayerFakeClientFilter::HUMAN"), "Keep explicit bots and default human recipients.");
	g_Assert(strRecipients.includes("vecRecipientEntityIndicesOut = std::move(vecRecipientEntityIndices);"), "Sound recipients must commit only the successfully collected result.");

	const strRecipientEntry = GetFunctionBody(strSource, "GetSoundRecipientIndexFromValue");
	g_Assert(strRecipientEntry.includes("GetIntegerFromValue(LocalContext, LocalValue, nRecipientIndex)") && strRecipientEntry.includes("if (!LocalValue->IsObject())"), "Keep strict primitive-number and object input validation.");
	g_Assert(strRecipientEntry.includes("GetEntityIndexFromValue(pIsolate, LocalContext, LocalValue, nRecipientIndex)"), "Use the shared exception-preserving object-index boundary.");
	g_Assert((strRecipientEntry.indexOf("if (nRecipientIndex <= 0)") >= 0) && (strRecipientEntry.indexOf("nRecipientIndexOut = nRecipientIndex;") > strRecipientEntry.indexOf("if (nRecipientIndex <= 0)")), "Commit only a successfully validated positive signed32 index.");
	const strIndexBoundary = GetFunctionBody(strSource, "GetEntityIndexFromValue");
	g_Assert(strIndexBoundary.includes("v8::TryCatch IndexTryCatch(pIsolate);") && /if \(IndexTryCatch.HasCaught\(\)\) \{\n(\t+)IndexTryCatch.ReThrow\(\);\n\1return false;/.test(strIndexBoundary), "Shared index lookup must preserve the original getter error.");
	g_Assert(/catch \(\.\.\.\) \{\n\t+if \(IndexTryCatch.HasCaught\(\)\) \{\n\t+IndexTryCatch.ReThrow\(\);/.test(strIndexBoundary), "Preserve pending JavaScript errors during C++ unwinding.");

	const strSnapshot = GetFunctionBody(strSource, "CollectSoundRecipientIndicesFromValue");
	g_Assert.equal(strSnapshot.split("GetSoundObjectPropertyValue(").length, 2, "Read a recipient filter property exactly once.");
	g_Assert.equal(strSnapshot.split("LocalRecipientIndexesArray->Get(").length, 2, "Read each array element once in the indexed loop.");
	g_Assert(strSnapshot.includes("if (!IsValueNullish(LocalRecipientIndexesValue))") && strSnapshot.includes("if (!LocalRecipientIndexesValue->IsArray())"), "Preserve nullish fallback and reject malformed filter properties.");
	g_Assert(strSnapshot.includes("const std::uint32_t unRecipientValueCount = LocalRecipientIndexesArray->Length();") && strSnapshot.includes("unRecipientValueIndex < unRecipientValueCount"), "Capture array length once and validate sparse entries too.");
	g_Assert(!strSnapshot.includes("vecRecipientIndicesOut.clear();") && !strSnapshot.includes(".reserve("), "Do not clear failed outputs or reserve an untrusted capacity.");
	g_Assert.equal(strSnapshot.split("GetSoundRecipientIndexFromValue(").length, 3, "Both singleton and array paths must use the same strict parser.");
	g_Assert(strSnapshot.indexOf("vecRecipientIndicesOut = std::move(vecRecipientIndices);") > strSnapshot.lastIndexOf("vecRecipientIndices.push_back(nRecipientIndex);"), "Commit the complete validated snapshot last.");

	const strLoopingState = GetFunctionBody(strSource, "TryGetEngineSoundLoopingState");
	g_Assert(!strLoopingState.includes("bIsLoopingOut = false;"), "An unavailable SDK looping query must leave failed output unchanged.");
	g_Assert(strLoopingState.includes("bIsLoopingOut = pEngineSound->IsLoopingSound(pszSample);"), "A supported SDK looping query must commit its actual result.");
}

function AssertRejectedMutation(strOwner, strMutatedOwner, strMessage) {
	g_Assert.equal(g_strSource.split(strOwner).length, 2, strMessage + ": mutation owner must be unique.");
	g_Assert.notEqual(strMutatedOwner, strOwner, strMessage + ": mutation must change its owner.");

	const strMutatedSource = g_strSource.replace(strOwner, () => strMutatedOwner);
	g_Assert.notEqual(strMutatedSource, g_strSource, strMessage + ": mutation must change the audited source.");
	g_Assert.throws(() => VerifyContracts(strMutatedSource), g_Assert.AssertionError, strMessage + ": the contract audit accepted a regression.");
	++g_unRejectedMutationCount;
}

VerifyExtractors();
VerifyContracts(g_strSource);

for (const vecMutation of g_vecMutations) {
	const strBody = GetFunctionBody(g_strSource, vecMutation[1]);
	const strTarget = vecMutation[4] ? strBody.split("\n")[0] : strBody;
	g_Assert.equal(strTarget.split(vecMutation[2]).length, 2, vecMutation[0] + ": mutation target is missing or ambiguous.");

	const strMutatedTarget = strTarget.replace(vecMutation[2], () => vecMutation[3]);
	const strMutatedBody = strBody.replace(strTarget, () => strMutatedTarget);
	AssertRejectedMutation(strBody, strMutatedBody, vecMutation[0]);
}

const g_strTraceFilter = GetTraceOwnerBody(g_strSource, "TraceFilter");
const g_vecTraceFilterMatches = Array.from(g_strTraceFilter.matchAll(/if \((MethodLookupFailure|CallbackTryCatch)\.HasCaught\(\)\) \{\n\t+\1\.ReThrow\(\);\n\t+}\n\n\t+throw;/g));
const g_vecTraceSnapshotMutations = [
	[
		"LocalShouldHitEntityValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kShouldHitEntityPropertyName);",
		"LocalShouldHitEntityValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kShouldHitEntityPropertyName);\n\t\t\t\t\t\tLocalShouldHitEntityValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kShouldHitEntityPropertyName);"
	],
	[
		"if (!GetTraceTypeFromObject(pIsolate, LocalContext, LocalFilterObject, kTraceTypePropertyName, TRACE_EVERYTHING, nTraceType, bHasTraceType))",
		"if (!GetTraceTypeFromObject(pIsolate, LocalContext, LocalFilterObject, kTraceTypePropertyName, TRACE_EVERYTHING, nTraceType, bHasTraceType) || !GetTraceTypeFromObject(pIsolate, LocalContext, LocalFilterObject, kTraceTypePropertyName, TRACE_EVERYTHING, nTraceType, bHasTraceType))"
	],
	[
		"LocalGetTraceTypeValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kGetTraceTypePropertyName);",
		"LocalGetTraceTypeValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kGetTraceTypePropertyName);\n\t\t\t\t\t\t\tLocalGetTraceTypeValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kGetTraceTypePropertyName);"
	],
	[
		"engines/trace filter ShouldHitEntity(EntityInformation, nContentsMask) must return a boolean.",
		"engines/trace filter ShouldHitEntity() must return a boolean."
	]
];
for (const vecMutation of g_vecTraceSnapshotMutations) {
	g_Assert.equal(g_strTraceFilter.split(vecMutation[0]).length, 2, "Snapshot mutation must have a unique target.");
	AssertRejectedMutation(g_strTraceFilter, g_strTraceFilter.replace(vecMutation[0], () => vecMutation[1]), "Trace filter property snapshot");
}
for (const vecMatch of g_vecTraceFilterMatches) {
	const strMutatedOwner = g_strTraceFilter.slice(0, vecMatch.index) + "throw;" + g_strTraceFilter.slice(vecMatch.index + vecMatch[0].length);
	AssertRejectedMutation(g_strTraceFilter, strMutatedOwner, "Trace filter native unwinding");
}

const g_strTraceEnumerator = GetTraceOwnerBody(g_strSource, "EntityEnumerator");
const g_vecTraceEnumeratorMatches = Array.from(g_strTraceEnumerator.matchAll(/if \((MethodLookupFailure|CallbackTryCatch)\.HasCaught\(\)\) \{\n\t+\1\.ReThrow\(\);\n\t+}\n\n\t+throw;/g));
for (const vecMatch of g_vecTraceEnumeratorMatches) {
	const strMutatedOwner = g_strTraceEnumerator.slice(0, vecMatch.index) + "throw;" + g_strTraceEnumerator.slice(vecMatch.index + vecMatch[0].length);
	AssertRejectedMutation(g_strTraceEnumerator, strMutatedOwner, "Trace enumerator native unwinding");
}

const g_strEmitSound = GetFunctionBody(g_strSource, "EmitSoundCallback");
const g_EmitSoundUnwindPattern = /if \(IndexLookupFailure\.HasCaught\(\)\) \{\n\t+IndexLookupFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/;
AssertRejectedMutation(g_strEmitSound, g_strEmitSound.replace(g_EmitSoundUnwindPattern, () => "throw;"), "Sound entity native unwinding");

for (const vecOwner of g_vecQueryOwners) {
	const strBody = GetFunctionBody(g_strSource, vecOwner[0]);
	const UnwindPattern = new RegExp("if \\(" + vecOwner[1] + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + vecOwner[1] + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
	AssertRejectedMutation(strBody, strBody.replace(UnwindPattern, () => "throw;"), vecOwner.join(": "));
}

g_Assert.equal(g_unRejectedMutationCount, g_vecMutations.length + g_vecTraceFilterMatches.length + g_vecTraceSnapshotMutations.length + g_vecTraceEnumeratorMatches.length + 1 + g_vecQueryOwners.length);

console.log("Sound/trace parser source contracts passed: " + g_unRejectedMutationCount + " rejected mutations; source-only, no native IO, SDK or V8 execution.");
