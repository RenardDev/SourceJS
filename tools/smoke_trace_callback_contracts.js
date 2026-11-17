"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
		console.log("Usage: node tools/smoke_trace_callback_contracts.js\nChecks source contracts only; does not execute live V8 or engine code.");
		process.exit(0);
	}

	console.error("Usage: node tools/smoke_trace_callback_contracts.js");
	process.exit(2);
}

const g_strSourcePath = g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strSource = g_FileSystem.readFileSync(g_strSourcePath, "utf8").replace(/\r\n/g, "\n");
const g_strEngineSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "EngineInterfaces.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strEngineHeader = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "EngineInterfaces.h"), "utf8").replace(/\r\n/g, "\n");
const g_unEngineMutationCount = 3;

function GetBodyRegion(strSource, strName, unIndentationLevel, bConstructor) {
	const strEscapedName = strName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const strTail = bConstructor ? " :$" : "(?: (?:const|noexcept|override|final|try))* \\{$";
	const vecPatterns = [unIndentationLevel, unIndentationLevel + 1].map(unDepth => {
		const strTabs = "\t".repeat(unDepth);

		// Constructors without initializer lists have no return-type prefix.
		return { Indentation: unDepth, Tabs: strTabs, Expression: new RegExp("^" + strTabs + "(?:[A-Za-z_][\\w:<>,*& ]* )?" + strEscapedName + "\\([^\\n;{}]*\\)" + strTail) };
	});
	const vecRegions = [];
	const strNameToken = strName + "(";
	let nCandidateIndex = strSource.indexOf(strNameToken);
	while (nCandidateIndex >= 0) {
		const unLineStart = strSource.lastIndexOf("\n", nCandidateIndex) + 1;
		const nLineEnd = strSource.indexOf("\n", nCandidateIndex);
		const unLineEnd = (nLineEnd < 0) ? strSource.length : nLineEnd;
		const strLine = strSource.slice(unLineStart, unLineEnd);
		for (const Pattern of vecPatterns) {
			if (!Pattern.Expression.test(strLine)) {
				continue;
			}

			const strTerminator = "\n" + Pattern.Tabs + "}";
			const nEnd = strSource.indexOf(strTerminator, unLineEnd);
			g_Assert(nEnd >= 0, strName + ": closing brace missing.");
			vecRegions.push({ Start: unLineStart, End: nEnd + strTerminator.length, Indentation: Pattern.Indentation });
		}

		nCandidateIndex = strSource.indexOf(strNameToken, unLineEnd);
	}

	g_Assert.equal(vecRegions.length, 1, strName + ": expected exactly one definition.");

	return vecRegions[0];
}

function GetBody(strSource, strName, unIndentationLevel = 1, bConstructor = false) {
	const Region = GetBodyRegion(strSource, strName, unIndentationLevel, bConstructor);
	const strActualTabs = "\t".repeat(Region.Indentation);
	const strExpectedTabs = "\t".repeat(unIndentationLevel);

	// Behavioral views allow one namespace-indent step; the source is not rewritten.
	return strSource.slice(Region.Start, Region.End).split("\n").map(strLine => (strLine.startsWith(strActualTabs) && !/^\s*#/.test(strLine)) ? strExpectedTabs + strLine.slice(Region.Indentation) : strLine).join("\n");
}

function ReplaceBody(strSource, strName, strBody, unIndentationLevel = 1, bConstructor = false) {
	const Region = GetBodyRegion(strSource, strName, unIndentationLevel, bConstructor);
	const strActualTabs = "\t".repeat(Region.Indentation);
	const strExpectedTabs = "\t".repeat(unIndentationLevel);
	const strReplacement = strBody.split("\n").map(strLine => (strLine.startsWith(strExpectedTabs) && !/^\s*#/.test(strLine)) ? strActualTabs + strLine.slice(unIndentationLevel) : strLine).join("\n");

	return strSource.slice(0, Region.Start) + strReplacement + strSource.slice(Region.End);
}

function AssertBodyExtraction() {
	for (const unDepth of [0, 1, 2, 3]) {
		const unExpectedDepth = (unDepth > 0) ? unDepth - 1 : 0;
		const strTabs = "\t".repeat(unDepth);
		const strExpectedTabs = "\t".repeat(unExpectedDepth);
		const strQualifier = (unDepth === 3) ? " const noexcept" : " noexcept";
		const MakeDefinition = strIndentation => strIndentation + "bool Probe(int nValue)" + strQualifier + " {\n#if defined(SOURCEJS_EXTRACTOR_TEST)\n" + strIndentation + "\treturn nValue > 0;\n#else\n" + strIndentation + "\treturn false;\n#endif\n" + strIndentation + "}";
		const strDefinition = MakeDefinition(strTabs);
		const strPrototype = strTabs + "bool Probe(int nValue); // marker ) {\n";
		const strStatement = strTabs + "if (Probe(1)) {\n" + strTabs + "\treturn false;\n" + strTabs + "}\n";
		const strSource = strPrototype + strStatement + strDefinition + "\n";
		const strBody = GetBody(strSource, "Probe", unExpectedDepth);
		g_Assert.equal(strBody, MakeDefinition(strExpectedTabs), "Ignore statement/prototype candidates and preserve preprocessor lines.");
		g_Assert.equal(ReplaceBody(strSource, "Probe", strBody, unExpectedDepth), strSource, "Body replacement must preserve all unrelated source.");

		const MakeConstructor = strIndentation => strIndentation + "Sample::Sample(int nValue) :\n" + strIndentation + "\tm_nValue(nValue)\n" + strIndentation + "{\n" + strIndentation + "}";
		g_Assert.equal(GetBody(MakeConstructor(strTabs) + "\n", "Sample::Sample", unExpectedDepth, true), MakeConstructor(strExpectedTabs));
		g_Assert.equal(GetBody(strTabs + "Sample::Sample() {\n" + strTabs + "}\n", "Sample::Sample", unExpectedDepth), strExpectedTabs + "Sample::Sample() {\n" + strExpectedTabs + "}");
		g_Assert.throws(() => GetBody(strPrototype, "Probe", unExpectedDepth), { code: "ERR_ASSERTION" });
		g_Assert.throws(() => GetBody(strStatement, "Probe", unExpectedDepth), { code: "ERR_ASSERTION" });
		g_Assert.throws(() => GetBody(strDefinition + "\n" + strDefinition + "\n", "Probe", unExpectedDepth), { code: "ERR_ASSERTION" });
	}
}

function AssertServerCallbackBoundary(strSource, strCallbackName, strDiagnostic, strInterfaceResolverName = "RequireEngineServer", strErrorExpression = "kNativeExceptionErrorMessage") {
	const strCallback = GetBody(strSource, strCallbackName);
	const nBoundaryStart = strCallback.indexOf("try {");
	g_Assert(strCallback.includes("catch (...) {\n\t\t\tThrowError(pIsolate, " + strErrorExpression + ");"), "Server callback C++ failures need contextual JavaScript errors.");
	g_Assert((nBoundaryStart >= 0) && (nBoundaryStart < strCallback.indexOf(strInterfaceResolverName + "(")), "Server preparation must remain inside the callback exception boundary.");
	g_Assert(strCallback.includes('"' + strDiagnostic + ' failed with a native C++ exception."'), "Server diagnostics must identify the operation.");
}

function VerifyContracts(strSource) {
	const strProperty = GetBody(strSource, "GetTraceObjectPropertyValue");
	g_Assert(strProperty.includes("if (!LocalSourceObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalPropertyValue) || LocalPropertyValue.IsEmpty()) {\n\t\t\treturn {};"), "Property lookup must reject failed or empty V8 results.");

	const strTraceType = GetBody(strSource, "GetTraceTypeFromObject");
	g_Assert(strTraceType.includes("if (LocalPropertyValue.IsEmpty()) {\n\t\t\treturn false;"), "Trace-type presence must reject failed lookup.");
	g_Assert(strTraceType.indexOf("bHasTraceTypeOut =") > strTraceType.indexOf("if (LocalPropertyValue.IsEmpty())"), "Trace-type presence commits only after successful lookup.");

	const strIndex = GetBody(strSource, "GetTraceIgnoredEntityIndexFromValue");
	g_Assert(strIndex.includes("if (!GetEntityIndexFromValue(pIsolate, LocalContext, LocalValue, nEntityIndex)) {\n\t\t\treturn false;"), "Ignored entity lookup must propagate the shared index failure before diagnostics.");

	const strEntityIndex = GetBody(strSource, "GetEntityIndexFromValue");
	g_Assert(strEntityIndex.includes("if (IndexTryCatch.HasCaught())"), "Shared index lookup preserves original errors.");
	g_Assert.equal(strEntityIndex.split("IndexTryCatch.ReThrow();").length - 1, 2, "Index getter errors must survive normal failure and native unwinding.");

	const strIgnore = GetBody(strSource, "CollectTraceIgnoredEntityIndexes");
	g_Assert(strIgnore.includes("if (IsValueNullish(LocalValue)) {\n\t\t\tvecIgnoredEntityIndexesOut.clear();\n\t\t\treturn true;"), "Only successful nullish input clears Ignore.");
	g_Assert(strIgnore.includes("std::vector<int> vecIgnoredEntityIndexes {};"), "Ignore needs temporary storage.");
	g_Assert(strIgnore.includes("vecIgnoredEntityIndexesOut = std::move(vecIgnoredEntityIndexes);"), "Ignore commits a complete successful collection.");
	g_Assert(!strIgnore.includes("vecIgnoredEntityIndexesOut.push_back("), "Ignore must not append partial failed results.");

	const strFilter = GetBody(strSource, "TraceFilter::TraceFilter", 1, true);
	g_Assert(strSource.includes("TraceFilter(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalFilterValue);"), "Runtime constructor must be declared, not defined in class.");
	for (const strPropertyName of ["kShouldHitEntityPropertyName", "kGetTraceTypePropertyName", "kIgnorePropertyName"]) {
		g_Assert.equal(strFilter.split("GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, " + strPropertyName + ")").length - 1, 1, "Each optional filter value must be read exactly once.");
	}

	g_Assert(strFilter.includes("if (!GetTraceTypeFromObject(pIsolate, LocalContext, LocalFilterObject, kTraceTypePropertyName, TRACE_EVERYTHING, nTraceType, bHasTraceType)) {\n\t\t\t\tm_bValid = false;\n\t\t\t\treturn;"), "Filter initialization must stop on trace-type lookup failure.");
	g_Assert.equal(strFilter.split("MethodLookupFailure.ReThrow();").length - 1, 4, "Function getters must propagate original errors, including native unwinding.");
	g_Assert(strFilter.includes("if (!IsSupportedEngineTraceType(nTraceType))"), "Native enum conversion needs value validation.");
	g_Assert(strFilter.indexOf("m_nTraceType = nTraceType;") > strFilter.indexOf("CollectTraceIgnoredEntityIndexes("), "Filter commits type only after successful Ignore.");
	g_Assert(strFilter.includes("Call(LocalContext, LocalFilterObject,"), "GetTraceType requires original object receiver.");

	const strTypes = GetBody(strSource, "IsSupportedEngineTraceType");
	for (const strTypeName of ["TRACE_EVERYTHING", "TRACE_WORLD_ONLY", "TRACE_ENTITIES_ONLY", "TRACE_EVERYTHING_FILTER_PROPS"]) {
		g_Assert(strTypes.includes("nTraceType == " + strTypeName), "Each supported SDK trace type must be explicit.");
	}

	for (const strMethodName of ["ShouldHitEntity", "EnumEntity"]) {
		const strMethod = GetBody(strSource, strMethodName, 2);
		g_Assert(strMethod.includes("if (!m_bValid) {\n\t\t\t\treturn false;"), "Failed callbacks must stop subsequent native calls.");
		g_Assert(strMethod.includes("catch (...)"), "C++ failures must not escape SDK callback ABI.");
		g_Assert.equal(strMethod.split("CallbackTryCatch.ReThrow();").length - 1, 3, "Thrown, invalid-result and native-unwind callback errors must escape.");
		g_Assert(strMethod.includes("LocalCallbackReceiver"), "Callback receiver contract must be retained.");
	}

	const strEnumerator = GetBody(strSource, "EntityEnumerator::EntityEnumerator", 1, true);
	g_Assert.equal(strEnumerator.split("MethodLookupFailure.ReThrow();").length - 1, 2, "Enumerator getter errors must survive normal failure and native unwinding.");

	const strPointContents = GetBody(strSource, "TryGetEngineTracePointContents");
	g_Assert(!strPointContents.includes("nContentsOut = 0;") && !strPointContents.includes("*ppHandleEntityOut = nullptr;"), "Failed SDK dispatch must preserve outputs.");
	g_Assert(strPointContents.includes("ppHandleEntityOut ? &pHandleEntity : nullptr"), "SDK must write into temporary entity output.");
	g_Assert.equal(strPointContents.split("const int nContents = pEngineTrace->GetPointContents(").length - 1, 2, "Both SDK overloads need local results.");
	g_Assert.equal(strPointContents.split("*ppHandleEntityOut = pHandleEntity;").length - 1, 2, "Both SDK overloads commit successful entity output.");

	for (const strCallbackName of ["PrecacheSoundCallback", "IsSoundPrecachedCallback", "PrefetchSoundCallback", "IsLoopingSoundCallback", "GetSoundDurationCallback", "EmitSoundCallback", "StopSoundCallback", "SetSoundRoomTypeCallback", "SetPlayerDSPCallback", "GetDistanceGainFromSoundLevelCallback", "PrecacheSoundSentenceGroupCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert(strCallback.includes("catch (...) {\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);"), "Sound C++ failures must become operation-specific JavaScript errors.");
		g_Assert(strCallback.indexOf("try {") < strCallback.indexOf("RequireEngineSoundInterface("), "Sound interface/error and string preparation must remain inside the V8 exception boundary.");
	}

	for (const strCallbackName of ["EmitSoundCallback", "StopSoundCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert(strCallback.includes("v8::TryCatch IndexLookupFailure(pIsolate);"), "Entity Index lookup needs a narrow error-identity boundary.");
		g_Assert(/if \(IndexLookupFailure\.HasCaught\(\)\) \{\n(\t+)IndexLookupFailure\.ReThrow\(\);\n\1return;/.test(strCallback), "Entity Index errors must propagate before type diagnostics.");
		g_Assert(strCallback.indexOf("IndexLookupFailure.ReThrow();") < strCallback.indexOf("if (nEntityIndex < 0)"), "Throwing Index must not become a negative-index diagnostic.");
	}

	const strEmitSound = GetBody(strSource, "EmitSoundCallback");
	for (const strValueName of ["LocalRecipientsValue", "LocalOriginValue", "LocalDirectionValue", "LocalOriginListValue"]) {
		const nDeclarationPosition = strEmitSound.indexOf("const " + strValueName + " =");
		const nFailurePosition = strEmitSound.indexOf("if (" + strValueName + ".IsEmpty()) {\n\t\t\t\treturn;", nDeclarationPosition);
		const nNextLookupPosition = strEmitSound.indexOf("GetSoundObjectPropertyValue(", strEmitSound.indexOf(";", nDeclarationPosition) + 1);
		g_Assert((nDeclarationPosition >= 0) && (nFailurePosition > nDeclarationPosition) && (nFailurePosition < nNextLookupPosition), "Each emitting option lookup must abort before reading the next property.");
	}

	const strLoopingState = GetBody(strSource, "TryGetEngineSoundLoopingState");
	g_Assert(!strLoopingState.includes(" noexcept {"), "A potentially throwing engine call must reach the callback exception boundary, not terminate.");

	const strHandleIndex = GetBody(strSource, "GetTraceEntityIndexFromHandle");
	g_Assert(!strHandleIndex.includes(" noexcept {"), "Virtual entity handle lookup must reach the callback exception boundary.");
	g_Assert(!GetBody(strSource, "GetTraceEntityIndexFromGameTrace").includes(" noexcept {"), "Trace-result handle lookup must reach the callback exception boundary.");

	const strPointCallback = GetBody(strSource, "GetPointContentsCallback");
	g_Assert(strPointCallback.includes("catch (...) {\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);"), "Point query C++ failures must become operation-specific JavaScript errors.");
	g_Assert(strPointCallback.indexOf("try {") < strPointCallback.indexOf("RequireEngineTraceInterface("), "Trace interface lookup must remain inside the V8 exception boundary.");
	g_Assert(strPointCallback.includes("v8::TryCatch PositionLookupFailure(pIsolate);"), "Position parsing needs an error-identity boundary.");
	g_Assert.equal(strPointCallback.split("PositionLookupFailure.ReThrow();").length - 1, 3, "Position getter, diagnostic and native-unwind errors must escape the local catch.");
	g_Assert(strPointCallback.indexOf("PositionLookupFailure.HasCaught()") < strPointCallback.indexOf("ThrowError(pIsolate, kPositionInvalidErrorMessage)"), "Position errors must propagate before generic diagnostics.");

	const strDistanceGain = GetBody(strSource, "GetDistanceGainFromSoundLevelCallback");
	g_Assert(strDistanceGain.includes("constexpr int kMinimumSoundLevel = 0;") && strDistanceGain.includes("constexpr int kMaximumSoundLevel = 255;"), "Sound level bounds must match the SDK regular enum range.");
	const nSoundLevelCheck = strDistanceGain.indexOf("if ((nSoundLevel < kMinimumSoundLevel) || (nSoundLevel > kMaximumSoundLevel))");
	g_Assert(nSoundLevelCheck > strDistanceGain.indexOf("GetFloatArgument("), "Sound level range validation must preserve earlier distance validation.");
	g_Assert((nSoundLevelCheck >= 0) && (nSoundLevelCheck < strDistanceGain.indexOf("static_cast<soundlevel_t>")), "Sound level bounds must be checked before conversion to the non-fixed enum.");

	for (const strCallbackName of ["GetPointContentsOfCollideableCallback", "TraceRayCallback", "ClipRayToEntityCallback", "ClipRayToCollideableCallback", "EnumerateEntitiesCallback", "EnumerateEntitiesInBoxCallback", "GetCollideableCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert(strCallback.includes("catch (...) {\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);"), "Trace C++ failures must become operation-specific JavaScript errors.");
		g_Assert(strCallback.indexOf("try {") < strCallback.indexOf("RequireEngineTraceInterface("), "Trace interface lookup and preparation must remain inside the V8 exception boundary.");
	}

	for (const strCallbackName of ["TraceRayCallback", "ClipRayToEntityCallback", "ClipRayToCollideableCallback", "EnumerateEntitiesCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert(strCallback.includes("v8::TryCatch RayLookupFailure(pIsolate);"), "Ray validation needs a narrow original-error boundary.");
		g_Assert.equal(strCallback.split("RayLookupFailure.ReThrow();").length - 1, 3, "Ray getter, diagnostic and native-unwind errors must escape the local catch.");
	}

	const strCollideablePoint = GetBody(strSource, "GetPointContentsOfCollideableCallback");
	g_Assert.equal(strCollideablePoint.split("PositionLookupFailure.ReThrow();").length - 1, 3, "Collideable point parsing must propagate getter, parser and native-unwind errors.");

	for (const strCallbackName of ["GetPointContentsOfCollideableCallback", "ClipRayToEntityCallback", "ClipRayToCollideableCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert.equal(strCallback.split("EntityLookupFailure.ReThrow();").length - 1, 2, "Entity lookup must preserve original Index errors through native unwinding.");
		const strDiagnostic = (strCallbackName === "ClipRayToEntityCallback") ? "kEntityErrorMessage" : "kCollideableErrorMessage";
		g_Assert(strCallback.indexOf("EntityLookupFailure.HasCaught()") < strCallback.indexOf("ThrowError(pIsolate, " + strDiagnostic), strCallbackName + ": entity lookup must fail before replacement diagnostics.");
	}

	const strCollideable = GetBody(strSource, "GetCollideableCallback");
	g_Assert.equal(strCollideable.split("IndexLookupFailure.ReThrow();").length - 1, 2, "Collideable Index lookup must preserve the original getter error through native unwinding.");
	g_Assert(strCollideable.indexOf("IndexLookupFailure.HasCaught()") < strCollideable.indexOf("if (nEntityIndex < kMinimumEntityIndex)"), "Index getter failure must precede the invalid-index diagnostic.");

	for (const strHelperName of ["GetTraceHandleEntityFromValue", "GetTraceCollideableFromValue"]) {
		const strHelper = GetBody(strSource, strHelperName);
		g_Assert(!strHelper.includes(" noexcept {"), "Potentially throwing lookup must not terminate before the callback boundary.");
		const nIndexGuard = strHelper.indexOf("if (nEntityIndex < kMinimumEntityIndex)");
		g_Assert((nIndexGuard >= 0) && (nIndexGuard < strHelper.indexOf("GetEdictFromEntityIndex(")), "Failed Index parsing must stop before native edict lookup.");
	}

	const strBox = GetBody(strSource, "EnumerateEntitiesInBoxCallback");
	for (const strRole of ["Minimum", "Maximum"]) {
		g_Assert.equal(strBox.split(strRole + "BoundsLookupFailure.ReThrow();").length - 1, 3, "Bounds getter, parser and native-unwind errors must propagate.");
		g_Assert(new RegExp("Vector const Ordered" + strRole + "Bounds = Vector\\([^\\n]+\\);").test(strBox), "Simple bounds constructor arguments stay on one line.");
	}

	for (const strCallbackName of ["IsPointOutsideWorldCallback", "GetLeafContainingPointCallback", "SweepCollideableCallback", "IsDedicatedServerCallback", "GetEngineServerEntityCountCallback", "GetEngineServerMaximumClientsCallback", "GetEngineServerMaximumEntitiesCallback", "GetEngineServerCountCallback", "GetEngineServerTimeCallback", "GetEngineServerTickCallback", "GetEngineServerTickIntervalCallback", "GetEngineServerMapNameCallback", "GetEngineServerGameDirectoryCallback", "GetEngineServerClientCVarValueCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert(strCallback.includes("catch (...) {\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);"), "World/server native exceptions must become operation-specific JavaScript errors.");
		const nPreparationPosition = strCallback.indexOf("RequireEngine");
		g_Assert((nPreparationPosition >= 0) && (strCallback.indexOf("try {") < nPreparationPosition), "World/server lookup and preparation must remain inside the callback exception boundary.");
	}

	for (const strCallbackName of ["IsPointOutsideWorldCallback", "GetLeafContainingPointCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert.equal(strCallback.split("PositionLookupFailure.ReThrow();").length - 1, 3, "World position getter, parser and native-unwind errors must escape the narrow catch.");
	}

	const strSweep = GetBody(strSource, "SweepCollideableCallback");
	for (const strRole of ["StartPosition", "EndPosition", "Angles"]) {
		g_Assert.equal(strSweep.split(strRole + "LookupFailure.ReThrow();").length - 1, 3, "Sweep getter, parser and native-unwind errors must escape the narrow catch.");
	}

	g_Assert.equal(strSweep.split("EntityLookupFailure.ReThrow();").length - 1, 2, "Sweep entity lookup must retain the original error through native unwinding.");
	g_Assert(strSweep.indexOf("EntityLookupFailure.HasCaught()") < strSweep.indexOf("ThrowError(pIsolate, kCollideableErrorMessage)"), "Sweep entity lookup must fail before replacement diagnostics.");

	const strClientCVar = GetBody(strSource, "GetEngineServerClientCVarValueCallback");
	g_Assert.equal(strClientCVar.split("IndexLookupFailure.ReThrow();").length - 1, 2, "Client Index errors must survive normal failure and native unwinding.");
	const nClientIndexFailure = strClientCVar.indexOf("IndexLookupFailure.ReThrow();");
	g_Assert((nClientIndexFailure >= 0) && (nClientIndexFailure < strClientCVar.indexOf("ValueToString(")), "Client Index failure must stop before name conversion or native query.");

	const strEdictArgument = GetBody(strSource, "RequireEngineEdictArgument");
	g_Assert.equal(strEdictArgument.split("EntityLookupFailure.ReThrow();").length - 1, 2, "Required edict lookup must preserve the original getter error through native unwinding.");
	g_Assert(strEdictArgument.indexOf("EntityLookupFailure.HasCaught()") < strEdictArgument.indexOf("if (!pEntityEdict)"), "Required edict lookup must fail before replacement diagnostics.");

	const strServerCount = GetBody(strSource, "GetGlobalServerCount");
	g_Assert(!strServerCount.includes("nServerCountOut = 0;"), "Failed server-count lookup must preserve the caller output.");
	g_Assert(strServerCount.indexOf("nServerCountOut =") > strServerCount.indexOf("if constexpr"), "Server count commits only within the supported SDK branch.");

	for (const strCallbackName of ["ChangeEngineServerLevelCallback", "CheckEnginePrecacheCallback", "GetEngineServerClusterForOriginCallback", "GetEngineServerPVSForClusterCallback", "CheckEngineServerOriginInPVSCallback", "CheckEngineServerBoxInPVSCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert(strCallback.includes("catch (...) {\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);"), "Level/precache/PVS C++ failures must become contextual JavaScript errors.");
		g_Assert(strCallback.indexOf("try {") < strCallback.indexOf("RequireEngineServer("), "Level/precache/PVS preparation must remain inside the callback exception boundary.");
	}

	const strClusterOrigin = GetBody(strSource, "GetEngineServerClusterForOriginCallback");
	g_Assert(strClusterOrigin.includes("RequireVectorFromValue(pIsolate, LocalContext, LocalOriginValue, kOriginErrorMessage, Origin)"), "Cluster Origin validation needs its server diagnostic context.");
	g_Assert.equal(strClusterOrigin.split("OriginLookupFailure.ReThrow();").length - 1, 3, "Cluster Origin getter, parser and native-unwind errors must escape the narrow catch.");
	g_Assert(strClusterOrigin.indexOf("OriginLookupFailure.HasCaught()") < strClusterOrigin.indexOf("ThrowError(pIsolate, kOriginErrorMessage);", strClusterOrigin.indexOf("OriginLookupFailure.HasCaught()")), "Cluster Origin errors must precede the replacement diagnostic.");

	const strClusterCount = GetBody(strSource, "GetEngineServerClusterCount");
	g_Assert(!strClusterCount.includes("nClusterCountOut = 0;"), "Failed cluster-count lookup must preserve the caller output.");
	g_Assert(strClusterCount.indexOf("nClusterCountOut =") > strClusterCount.indexOf("if constexpr"), "Cluster count commits only within the supported SDK branch.");

	const strPVSByteCount = GetBody(strSource, "GetEngineServerPVSByteCount");
	g_Assert(!strPVSByteCount.includes("nPVSByteCountOut = 0;"), "Failed PVS-size lookup must preserve the caller output.");
	g_Assert(strPVSByteCount.indexOf("nPVSByteCountOut =") > strPVSByteCount.indexOf("if (nClusterCount <= 0)"), "PVS size commits only after a positive cluster count.");

	for (const strCallbackName of ["GetEngineServerMulticastRecipientsCallback", "ResetEngineServerPVSCallback", "AddOriginToEngineServerPVSCallback", "SetEngineServerAreaPortalStateCallback", "IsEngineServerHeadNodeVisibleCallback", "AreEngineServerAreasConnectedCallback", "GetEngineServerAreaForOriginCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert(strCallback.includes("catch (...) {\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);"), "Visibility/area callback C++ failures need contextual JavaScript errors.");
		g_Assert(strCallback.indexOf("try {") < strCallback.indexOf("RequireEngineServer("), "Visibility/area preparation must remain inside the callback exception boundary.");
	}

	for (const strCallbackName of ["GetEngineServerAreaBitsCallback", "GetEngineServerAreaPortalPlaneCallback", "SetEngineServerAreaPortalStatesCallback", "LoadEngineServerGameStateCallback", "LoadEngineServerAdjacentEntitiesCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert(strCallback.includes("catch (...) {\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);"), "Area/transition callback C++ failures need contextual JavaScript errors.");
		g_Assert(strCallback.indexOf("try {") < strCallback.indexOf("RequireEngineServer("), "Area/transition preparation must remain inside the callback exception boundary.");
	}

	for (const vecCallback of [
		["GetEngineServerTextMessageCallback", "GetTextMessage"],
		["GetEngineServerPlayerInformationCallback", "GetPlayerInformation"],
		["PrintEngineServerDeveloperOverlayLineCallback", "PrintDeveloperOverlayLine"],
		["PrintEngineServerDeveloperOverlayLineExtendedCallback", "PrintDeveloperOverlayLineExtended"],
	]) {
		const strCallback = GetBody(strSource, vecCallback[0]);
		const nBoundaryStart = strCallback.indexOf("try {");
		g_Assert(strCallback.includes("catch (...) {\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);"), "Text/player/overlay callback C++ failures need contextual JavaScript errors.");
		g_Assert((nBoundaryStart >= 0) && (nBoundaryStart < strCallback.indexOf("RequireEngineServer(")), "Text/player/overlay preparation must remain inside the callback exception boundary.");
		g_Assert(strCallback.includes('"engines/server.' + vecCallback[1] + '() failed with a native C++ exception."'), "Callback diagnostics must use the installed public export.");
	}

	const strPlayerInformation = GetBody(strSource, "GetEngineServerPlayerInformationCallback");
	g_Assert(strPlayerInformation.includes("if (nPlayerIndex < 0) {\n\t\t\t\tif (!pIsolate->HasPendingException()) {"), "Player Index getter errors must not be replaced by the argument diagnostic.");
	g_Assert(!strPlayerInformation.includes("engines/server.GetPlayerInfo("), "Player information diagnostics must match GetPlayerInformation, not the SDK method.");

	const strTextMessage = GetBody(strSource, "GetEngineServerTextMessage");
	g_Assert(!strTextMessage.includes("bIsTextMessageAPIAvailableOut = false;"), "Failed text-message lookup must preserve the caller availability output.");
	g_Assert(strTextMessage.indexOf("bIsTextMessageAPIAvailableOut = true;") > strTextMessage.indexOf("pEngineServer->TextMessageGet("), "Supported text-message availability commits only after native success, including a native null result.");

	for (const vecCallback of [
		["ExecuteEngineServerClientCommandKeyValuesCallback", "ExecuteClientCommandKeyValues"],
		["GetEngineServerEntityTransmitBitsForClientCallback", "GetEntityTransmitBitsForClient"],
		["NotifyEngineServerEdictFlagsChangeCallback", "NotifyEdictFlagsChange"],
		["GetEngineServerPreviousCheckTransmitInformationCallback", "GetPreviousCheckTransmitInformation"],
		["GetEngineServerSharedEdictChangeInformationCallback", "GetSharedEdictChangeInformation"],
		["GetEngineServerEntityChangeAccessorCallback", "GetEntityChangeAccessor"],
		["CreateEngineServerSpatialPartitionCallback", "CreateSpatialPartition"],
		["DestroyEngineServerSpatialPartitionCallback", "DestroySpatialPartition"],
		["DrawEngineServerSpatialPartitionMapToScratchPadCallback", "DrawSpatialPartitionMapToScratchPad"],
		["NotifyEngineServerSolidMovedCallback", "NotifySolidMoved"],
		["NotifyEngineServerTriggerMovedCallback", "NotifyTriggerMoved"],
		["BuildEngineServerEntityClusterListCallback", "BuildEntityClusterList"],
		["CleanupEngineServerEntityClusterListCallback", "CleanUpEntityClusterList"],
		["GetEngineServerVersionCallback", "GetServerVersion"],
		["EndEngineServerMultiplayerGameCallback", "EndMultiplayerGame"],
		["CreateEngineServerFakeClientWithOptionsCallback", "CreateFakeClientWithOptions"],
		["GetEngineServerLaunchOptionsCallback", "GetLaunchOptions"],
		["IsEngineServerLogEnabledCallback", "IsEngineLogEnabled"],
		["IsEngineServerSplitScreenPlayerCallback", "IsSplitScreenPlayer"],
		["GetEngineServerAttachedSplitScreenUserCountCallback", "GetAttachedSplitScreenUserCount"],
		["ForceFlushEngineServerEntityCallback", "ForceFlushEntity"],
		["GetEngineServerSinglePlayerSharedMemorySpaceCallback", "GetSinglePlayerSharedMemorySpace"],
		["SetEngineServerPausedCallback", "SetPaused"],
		["HasEngineServerPaintMapCallback", "HasPaintMap"],
		["RemoveAllPaintFromEngineServerCallback", "RemoveAllPaint"],
		["PaintAllSurfacesOnEngineServerCallback", "PaintAllSurfaces"],
		["GetEngineServerClientXUIDCallback", "GetClientXUID"],
		["IsEngineServerApplicationActiveCallback", "IsApplicationActive"],
		["SetEngineServerNoClipEnabledCallback", "SetNoClipEnabled"],
		["SendEngineServerPaintMapDataToClientCallback", "SendPaintMapDataToClient"],
		["GetEngineServerChoreographySoundLatencyCallback", "GetChoreographySoundLatency"],
		["GetEngineServerClientCrossPlayPlatformCallback", "GetClientCrossPlayPlatform"],
		["EnsureEngineServerInstanceBaselineCallback", "EnsureEntityInstanceBaseline"],
		["ReserveEngineServerForQueuedGameCallback", "ReserveServerForQueuedGame"],
		["CreateEngineServerEdictCallback", "CreateEdict"],
		["RemoveEngineServerEdictCallback", "RemoveEdict"],
		["EmitEngineServerAmbientSoundCallback", "EmitAmbientSound"],
		["PrintEngineServerClientConsoleMessageCallback", "PrintToClientConsole"],
		["FadeEngineServerClientVolumeCallback", "FadeClientVolume"],
		["PickEngineServerSentenceFromGroupCallback", "PickSentenceFromGroup"],
		["PickSequentialEngineServerSentenceFromGroupCallback", "PickSequentialSentenceFromGroup"],
		["SetEngineServerLightStyleCallback", "SetLightStyle"],
		["PlaceEngineServerStaticDecalCallback", "PlaceStaticDecal"],
		["SetEngineServerClientViewEntityCallback", "SetClientViewEntity"],
		["SetEngineServerClientCrosshairAngleCallback", "SetClientCrosshairAngle"],
		["SetEngineServerNetworkStringTablesLockedCallback", "SetNetworkStringTablesLocked"],
		["CreateEngineServerFakeClientCallback", "CreateFakeClient"],
		["ForceEngineServerModelBoundsCallback", "ForceModelBounds"],
		["SetEngineServerFakeClientCVarValueCallback", "SetFakeClientCVarValue"],
		["StartEngineServerClientCVarQueryCallback", "StartClientCVarQuery"],
		["IsEngineServerClientFullyAuthenticatedCallback", "IsClientFullyAuthenticated"],
		["SetEngineServerDedicatedServerBenchmarkModeCallback", "SetDedicatedServerBenchmarkMode"],
	]) {
		const strErrorExpression = (vecCallback[0] === "CreateEngineServerSpatialPartitionCallback") ? "bSpatialPartitionCleanupFailed ? kSpatialPartitionCleanupErrorMessage : kNativeExceptionErrorMessage" : "kNativeExceptionErrorMessage";
		AssertServerCallbackBoundary(strSource, vecCallback[0], "engines/server." + vecCallback[1] + "()", "RequireEngineServer", strErrorExpression);
	}

	const strClientKeyValuesCallback = GetBody(strSource, "ExecuteEngineServerClientCommandKeyValuesCallback");
	g_Assert(strClientKeyValuesCallback.includes("if (pIsolate->HasPendingException()) {\n\t\t\t\treturn;"), "Client Index errors must stop before player lookup and ownership transfer.");
	g_Assert(strClientKeyValuesCallback.indexOf("HasPendingException()") < strClientKeyValuesCallback.indexOf("RequirePlayerInformationFromIndex("), "Failed Client parsing must not enter native player lookup.");

	const strClientKeyValues = GetBody(strSource, "ExecuteEngineServerClientCommandKeyValues");
	const nOwnershipTransferPosition = strClientKeyValues.indexOf("ReleaseKeyValuesOwnershipToEngine(");
	const nClientCommandPosition = strClientKeyValues.indexOf("pEngineServer->ClientCommandKeyValues(");
	g_Assert((nOwnershipTransferPosition >= 0) && (nClientCommandPosition > nOwnershipTransferPosition), "KeyValues ownership transfers before native submission, never as rollback after it.");

	for (const vecHelper of [
		["GetEngineServerEntityTransmitBitsForClient", "bIsEntityTransmitBitsAPIAvailableOut", "GetEntityTransmitBitsForClient"],
		["GetEngineServerPreviousCheckTransmitInformation", "bIsPreviousTransmitInformationAPIAvailableOut", "GetPrevCheckTransmitInfo"],
		["GetEngineServerSharedEdictChangeInformation", "bIsSharedEdictChangeInformationAPIAvailableOut", "GetSharedEdictChangeInfo"],
		["GetEngineServerEntityChangeAccessor", "bIsChangeAccessorAPIAvailableOut", "GetChangeAccessor"],
		["CreateEngineServerSpatialPartition", "bIsSpatialPartitionCreationAPIAvailableOut", "CreateSpatialPartition"],
		["CreateEngineServerFakeClientWithOptions", "bIsFakeClientWithOptionsCreationAPIAvailableOut", "CreateFakeClientEx"],
		["GetEngineServerLaunchOptions", "bIsLaunchOptionsAPIAvailableOut", "GetLaunchOptions"],
	]) {
		const strHelper = GetBody(strSource, vecHelper[0]);
		g_Assert(!strHelper.includes(vecHelper[1] + " = false;"), "Failed server API lookup must preserve the caller availability output.");
		const nNativeCallPosition = strHelper.indexOf("pEngineServer->" + vecHelper[2] + "(");
		const nCommitPosition = strHelper.indexOf(vecHelper[1] + " = true;");
		g_Assert((nNativeCallPosition >= 0) && (nCommitPosition > nNativeCallPosition), "Server API availability commits only after a completed native call, including native null.");
	}

	for (const strCallbackName of ["NotifyEngineServerEdictFlagsChangeCallback", "GetEngineServerPreviousCheckTransmitInformationCallback", "GetEngineServerEntityChangeAccessorCallback", "NotifyEngineServerSolidMovedCallback", "NotifyEngineServerTriggerMovedCallback", "BuildEngineServerEntityClusterListCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert(strCallback.includes("if (!pIsolate->HasPendingException()) {"), "Entity/Client Index getter errors must not be replaced by a generic argument error.");
	}

	const strPVSResolver = GetBody(strSource, "RequireEngineServerPVSInformationFromValue");
	const nPVSIndexPosition = strPVSResolver.indexOf("GetValueIndex(");
	const nPVSPendingExceptionPosition = strPVSResolver.indexOf("pIsolate->HasPendingException()");
	const nPVSEdictLookupPosition = strPVSResolver.indexOf("GetEdictFromEntityIndex(");
	const nPVSAddressFallbackPosition = strPVSResolver.indexOf("RequireOpaqueAddressFromValue(");
	g_Assert(strPVSResolver.includes("if (pIsolate->HasPendingException()) {\n\t\t\treturn nullptr;\n\t\t}"), "PVS Index errors must stop before entity lookup or the address fallback.");
	g_Assert((nPVSIndexPosition >= 0) && (nPVSPendingExceptionPosition > nPVSIndexPosition) && (nPVSEdictLookupPosition > nPVSPendingExceptionPosition) && (nPVSAddressFallbackPosition > nPVSEdictLookupPosition), "PVS error preservation must precede every native lookup and address fallback.");

	for (const vecCallback of [
		["QueryEngineServerUserIDStateCallback", "engines/server user-ID operation"],
		["GetOrSetEngineServerTimescaleCallback", "engines/server timescale operation"],
		["GetEngineServerBranchBooleanCallback", "engines/server branch boolean query"],
		["GetEngineServerSplitScreenEdictCallback", "engines/server split-screen edict query"],
		["ExecuteEngineServerBranchVoidOperationCallback", "engines/server branch void operation"],
		["GetOrSetEngineServerAchievementManagerCallback", "engines/server achievement manager operation"],
		["GetOrLoadEngineServerPaintMapDataRLECallback", "engines/server paint-map RLE operation"],
		["GetEngineServerSentenceInformationCallback", "engines/server sentence operation"],
		["ExecuteEngineServerNoArgumentOperationCallback", "engines/server no-argument operation"],
		["ExecuteEngineServerStringCommandOperationCallback", "engines/server string-command operation"],
	]) {
		AssertServerCallbackBoundary(strSource, vecCallback[0], vecCallback[1]);
	}

	AssertServerCallbackBoundary(strSource, "SetServerGameDLLHibernatingCallback", "engines/server.SetServerHibernation()", "RequireServerGameDLL");

	AssertServerCallbackBoundary(strSource, "ExecuteEngineServerClientCommandCallback", "engines/server.ExecuteClientCommand()", "ExecuteClientCommandForPlayerIndex");

	const strEngineStringArgument = GetBody(strSource, "RequireEngineStringArgument");
	g_Assert(strEngineStringArgument.includes("std::string const strValue = *UTF8Value;"), "Engine string arguments preserve the native UTF-8 prefix before the first NUL, including before LightStyle caching.");

	for (const vecPrecache of [
		["PrecacheEngineModelCallback", "PrecacheModel", "nModelIndex"],
		["PrecacheEngineGenericResourceCallback", "PrecacheGeneric", "nGenericResourceIndex"],
		["PrecacheEngineDecalCallback", "PrecacheDecal", "nDecalIndex"],
	]) {
		AssertServerCallbackBoundary(strSource, vecPrecache[0], "engines/precache." + vecPrecache[1] + "()");
		const strCallback = GetBody(strSource, vecPrecache[0]);
		const nInterfaceLookup = strCallback.indexOf("RequireEngineServer(");
		const nStringRead = strCallback.indexOf("RequireEngineStringArgument(");
		const nFlagRead = strCallback.indexOf("ReadOptionalEngineBooleanArgument(");
		const nDispatch = strCallback.indexOf("pEngineServer->" + vecPrecache[1] + "(");
		const nResultCommit = strCallback.indexOf("CallbackInformation.GetReturnValue().Set(" + vecPrecache[2] + ");");
		g_Assert((nInterfaceLookup >= 0) && (nStringRead > nInterfaceLookup) && (nFlagRead > nStringRead) && (nDispatch > nFlagRead) && (nResultCommit > nDispatch), "Precache interface, path, boolean, dispatch, and raw integer result order must be preserved.");
		g_Assert(!strCallback.includes("if (" + vecPrecache[2] + " < 0)"), "Native precache failure sentinels must not become binding errors.");
	}

	AssertServerCallbackBoundary(strSource, "GetEngineServerConstantsCallback", "engines/server.GetServerConstants()", "InstallMapLoadTypeConstants");
	const strConstantsCallback = GetBody(strSource, "GetEngineServerConstantsCallback");
	g_Assert(strConstantsCallback.indexOf("GetCurrentContext()") > strConstantsCallback.indexOf("try {"), "Constants context and result preparation must be inside the C++ boundary.");
	g_Assert(strConstantsCallback.includes("if (!InstallMapLoadTypeConstants(pIsolate, LocalContext, LocalServerConstantsObject)) {\n\t\t\t\treturn;"), "Failed constants installation must not commit a partial result.");

	const strConstantsInstallation = GetBody(strSource, "InstallMapLoadTypeConstants");
	g_Assert(strConstantsInstallation.includes("if (!InstallationFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {\n\t\t\t\t\tThrowError(pIsolate, kInstallationErrorMessage);"), "Constants installation fallback must preserve an original JavaScript error and execution termination.");
	const nInstallationCatch = strConstantsInstallation.indexOf("v8::TryCatch InstallationFailure(pIsolate);");
	g_Assert((nInstallationCatch >= 0) && (nInstallationCatch < strConstantsInstallation.indexOf("v8::Object::New(")), "A local V8 TryCatch must capture installation failures even when an outer handler clears the pending-exception flag.");
	g_Assert(strConstantsInstallation.includes("if (InstallationFailure.HasCaught()) {\n\t\t\t\tInstallationFailure.ReThrow();"), "Both original and newly created fallback exceptions must escape the local V8 TryCatch.");
	g_Assert.equal(strConstantsInstallation.split("InstallationFailure.ReThrow();").length - 1, 2, "MapLoadType errors must survive regular failure and native unwinding.");
	g_Assert.equal(strConstantsInstallation.split("ThrowError(pIsolate, kInstallationErrorMessage);").length - 1, 1, "Only the guarded fallback emits an installation error.");
	g_Assert.equal(strConstantsInstallation.split("ThrowInstallationFallbackError();").length - 1, 6, "All object/field/final-attachment failures use the guarded constants fallback.");

	const strStringCommand = GetBody(strSource, "ExecuteEngineServerStringCommandOperationCallback");
	g_Assert(strStringCommand.indexOf("CallbackInformation.Data()") > strStringCommand.indexOf("try {"), "String-command metadata preparation belongs inside the C++ boundary.");
	g_Assert(strStringCommand.indexOf("RequireEngineStringArgument(") > strStringCommand.indexOf("RequireEngineServer("), "String commands preserve interface lookup before argument conversion.");

	for (const vecUnsupported of [
		["StartEngineServerClientCVarQueryCallback", "ENGINE_BRANCH_DARKM"],
		["IsEngineServerClientFullyAuthenticatedCallback", "SOURCEJS_OLD_CONSOLE_API"],
		["SetEngineServerDedicatedServerBenchmarkModeCallback", "SOURCEJS_OLD_CONSOLE_API"],
	]) {
		const strCallback = GetBody(strSource, vecUnsupported[0]);
		g_Assert(strCallback.includes("try {\n#if defined(" + vecUnsupported[1] + ")\n\t\t\tThrowError(pIsolate, kUnsupportedErrorMessage);\n\t\t\treturn;\n#else"), "Existing unsupported branches must remain explicit and covered by the C++ boundary.");
	}

	const strConsoleCallback = GetBody(strSource, "PrintEngineServerClientConsoleMessageCallback");
	g_Assert.equal(strConsoleCallback.split("PrintToClientConsole(ClientOrIndex, strMessage)").length - 1, 2, "Both root console diagnostics need the actual argument role.");
	const nConsoleIndexStop = strConsoleCallback.indexOf("if (nPlayerIndex < 0) {\n\t\t\t\treturn;");
	g_Assert((nConsoleIndexStop > strConsoleCallback.indexOf("GetValueIndex(")) && (nConsoleIndexStop < strConsoleCallback.indexOf("RequirePlayerInformationFromIndex(")) && (nConsoleIndexStop < strConsoleCallback.indexOf("ValueToString(")), "Failed client Index must stop before lookup, conversion, or printing.");

	for (const strCallbackName of ["PickEngineServerSentenceFromGroupCallback", "PickSequentialEngineServerSentenceFromGroupCallback"]) {
		const strCallback = GetBody(strSource, strCallbackName);
		g_Assert(strCallback.includes("constexpr std::size_t kSentenceNameBufferSize = 256;"), "Sentence buffer extent must have the size category.");
		g_Assert(strCallback.includes("char szSentenceName[kSentenceNameBufferSize] {};"), "Sentence name storage must start defined.");
		g_Assert(strCallback.includes("szSentenceName, static_cast<int>(kSentenceNameBufferSize)"), "Only the native int-capacity boundary narrows the extent.");
		const nTerminatorCheck = strCallback.indexOf("if (!std::memchr(szSentenceName, '\\0', sizeof(szSentenceName))) {\n\t\t\t\tThrowError(pIsolate, kSentenceNameBufferErrorMessage);\n\t\t\t\treturn;");
		const nSentenceNameRead = strCallback.search(/\b(?:MakeString|SetString)\([^;\n]*\bszSentenceName\)/);
		g_Assert((nTerminatorCheck > strCallback.indexOf("pEngineServer->SentenceGroupPick")) && (nTerminatorCheck < strCallback.indexOf("v8::Object::New(")) && (nTerminatorCheck < nSentenceNameRead), "Native sentence termination must be checked before result construction or C-string reading.");
		g_Assert(!/if \((?:nSentenceIndex|nPickedSentenceIndex) < 0\)/.test(strCallback), "Native negative sentence indices retain their ordinary result meanings.");
		g_Assert(strCallback.includes("returned an unterminated native sentence-name buffer."), "Sentence termination diagnostics need operation context.");
	}

	const strLightStorage = GetBody(strSource, "AllocateProcessLifetimeEngineServerLightPattern");
	g_Assert(!strLightStorage.includes("noexcept"), "Throwing cache allocation must remain catchable at the callback boundary.");
	const nLengthCheck = strLightStorage.indexOf("if (unPatternByteCount > kMaximumLightPatternByteCount) {\n\t\t\treturn {};");
	g_Assert(strLightStorage.includes("kMaximumLightPatternByteCount = std::numeric_limits<std::size_t>::max() - 1;"), "Pattern capacity must account for the terminator before overflow.");
	g_Assert((nLengthCheck >= 0) && (nLengthCheck < strLightStorage.indexOf("unPatternByteCount + 1")), "Pattern size overflow must be rejected before addition.");
	g_Assert(strLightStorage.includes("find(strLightPattern)") && strLightStorage.includes("return { itLightPattern->second, unAllocationByteCount, 0 };"), "Identical complete byte strings reuse their original stable address.");
	const nCacheInsertion = strLightStorage.indexOf("try_emplace(strLightPattern, nullptr).first");
	g_Assert((nCacheInsertion >= 0) && (nCacheInsertion < strLightStorage.indexOf("::VirtualAlloc(")) && (nCacheInsertion < strLightStorage.indexOf("::mmap(")), "Throwing cache insertion must precede OS allocation.");

	for (const strCapture of ["static_cast<unsigned int>(::GetLastError())", "static_cast<unsigned int>(errno)"]) {
		g_Assert(strLightStorage.includes("const unsigned int unPlatformError = " + strCapture + ";\n\t\t\ts_umapProcessLifetimeLightPatterns.erase(itNewLightPattern);\n\t\t\treturn { nullptr, unAllocationByteCount, unPlatformError };"), "OS allocation errors must be captured immediately, then remove the uncommitted cache slot.");
	}

	g_Assert(strLightStorage.includes("if (pLightPatternStorage == MAP_FAILED)"), "Linux mmap failure must use its actual sentinel.");
	g_Assert(strLightStorage.includes("if (!pLightPatternStorage) {\n\t\t\tconst unsigned int unPlatformError = (::munmap(pLightPatternStorage, unAllocationByteCount) == 0) ? static_cast<unsigned int>(EFAULT) : static_cast<unsigned int>(errno);"), "Successful null mappings cannot become C++ string storage; cleanup failure captures errno immediately.");
	const nStorageCopy = strLightStorage.indexOf("std::memcpy(pszLightPatternStorage, strLightPattern.c_str(), unAllocationByteCount);");
	g_Assert((nStorageCopy >= 0) && (nStorageCopy < strLightStorage.indexOf("itNewLightPattern->second = pszLightPatternStorage;")), "Copy the complete bytes and terminator before committing the cache address.");
	g_Assert.equal(strLightStorage.split("::munmap(").length - 1, 1, "Only an unusable null mapping is released; successful native storage survives teardown.");
	g_Assert(!strLightStorage.includes("::VirtualFree("), "Successful native storage must survive DLL/context teardown.");

	const strLightCallback = GetBody(strSource, "SetEngineServerLightStyleCallback");
	const nPatternAllocation = strLightCallback.indexOf("AllocateProcessLifetimeEngineServerLightPattern(strLightPattern)");
	const nPatternFailure = strLightCallback.indexOf("if (!LightPatternAllocation.m_pszLightPattern)");
	const nLightDispatch = strLightCallback.indexOf("pEngineServer->LightStyle(nLightStyle, LightPatternAllocation.m_pszLightPattern);");
	g_Assert((nPatternAllocation >= 0) && (nPatternFailure > nPatternAllocation) && (nLightDispatch > nPatternFailure), "Stable pattern allocation and failure handling must precede LightStyle.");
	g_Assert(strLightCallback.includes("ThrowError(pIsolate, szAllocationErrorMessage);\n\t\t\t\treturn;"), "An allocation error must stop before native dispatch.");
	g_Assert(strLightCallback.includes("(static_cast<std::size_t>(nMessageLength) >= sizeof(szAllocationErrorMessage))"), "Allocation diagnostics must check formatting truncation.");
	g_Assert(!strLightCallback.includes("pEngineServer->LightStyle(nLightStyle, strLightPattern.c_str())"), "LightStyle must not retain temporary string storage.");

	for (const vecOperation of [
		["GetEngineServerSentenceInformationCallback", "EngineServerSentenceOperation"],
		["ExecuteEngineServerNoArgumentOperationCallback", "EngineServerNoArgumentOperation"],
	]) {
		const strCallback = GetBody(strSource, vecOperation[0]);
		const nPreparation = strCallback.indexOf("CallbackInformation.Data()");
		g_Assert((nPreparation > strCallback.indexOf("try {")) && (nPreparation < strCallback.indexOf("static_cast<" + vecOperation[1] + ">")), "Generic operation metadata must be prepared inside the exception boundary.");
	}

	const strBaselineCallback = GetBody(strSource, "EnsureEngineServerInstanceBaselineCallback");
	g_Assert(strBaselineCallback.includes("if (!pIsolate->HasPendingException()) {\n\t\t\t\t\tThrowError(pIsolate, kEntityArgumentErrorMessage);"), "Baseline Index getter errors must not be replaced.");
	g_Assert(strBaselineCallback.indexOf("HasPendingException()") > strBaselineCallback.indexOf("GetValueIndex("), "Baseline Index failure must be checked after lookup.");
	g_Assert(strBaselineCallback.indexOf("HasPendingException()") < strBaselineCallback.indexOf("EnsureEngineServerInstanceBaseline(pIsolate"), "Baseline Index failure must stop before native dispatch.");
	g_Assert(strBaselineCallback.includes("EnsureEntityInstanceBaseline(EntityOrIndex)"), "Baseline diagnostics must describe the actual argument role.");

	const strAmbientCallback = GetBody(strSource, "EmitEngineServerAmbientSoundCallback");
	g_Assert(strAmbientCallback.includes("constexpr int kMinimumSoundLevel = 0;") && strAmbientCallback.includes("constexpr int kMaximumSoundLevel = 255;"), "Ambient sound must use the SDK regular enum range.");
	const nAmbientSoundLevelCheck = strAmbientCallback.indexOf("if ((nSoundLevel < kMinimumSoundLevel) || (nSoundLevel > kMaximumSoundLevel))");
	g_Assert(nAmbientSoundLevelCheck > strAmbientCallback.indexOf("GetInt32Argument(pIsolate, LocalContext, LocalSoundLevelValue"), "Ambient sound level validation must follow the existing numeric conversion.");
	g_Assert((nAmbientSoundLevelCheck >= 0) && (nAmbientSoundLevelCheck < strAmbientCallback.indexOf("static_cast<soundlevel_t>")), "Ambient sound level must be validated before the non-fixed enum cast.");
	g_Assert(strAmbientCallback.includes("if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {"), "Ambient fallback diagnostics must preserve original errors and termination.");
	g_Assert(strAmbientCallback.includes("EmitAmbientSound(EntityOrIndex, Position,"), "Ambient sound diagnostics must describe the actual entity argument.");
	g_Assert(strAmbientCallback.includes("if (nSoundEntityIndex < 0) {\n\t\t\t\tThrowAmbientSoundFallbackError();\n\t\t\t\treturn;"), "Failed entity Index must stop processing.");
	g_Assert(strAmbientCallback.indexOf("if (nSoundEntityIndex < 0)") < strAmbientCallback.indexOf("RequireVectorFromValue("), "Failed entity Index must stop before reading the position.");

	const strClientCommandCallback = GetBody(strSource, "ExecuteEngineServerClientCommandCallback");
	g_Assert.equal(strClientCommandCallback.split("ExecuteClientCommand(ClientOrIndex, strCommand, bServerSide?)").length - 1, 3, "All client-command diagnostics must describe the actual client argument.");
	const nClientCommandIndexCheck = strClientCommandCallback.indexOf("if (nPlayerIndex < 0) {\n\t\t\t\treturn;");
	g_Assert((nClientCommandIndexCheck > strClientCommandCallback.indexOf("GetValueIndex(")) && (nClientCommandIndexCheck < strClientCommandCallback.indexOf("ValueToString(")), "Failed client Index must stop before command conversion or player lookup.");

	for (const vecHelper of [
		["IsEngineServerUserIDInUse", "bIsUserIDInUseOut"],
		["IsEngineServerLogEnabled", "bIsLogEnabledOut"],
		["GetEngineServerBranchBoolean", "bBranchBooleanResultOut"],
		["IsEngineServerSplitScreenPlayer", "bIsSplitScreenPlayerOut"],
		["HasEngineServerPaintMap", "bHasPaintMapOut"],
		["IsEngineServerApplicationActive", "bApplicationActiveOut"],
	]) {
		const strHelper = GetBody(strSource, vecHelper[0]);
		g_Assert(!strHelper.includes(vecHelper[1] + " = false;"), "Failed server predicates must not overwrite the caller output.");
	}

	const strSplitScreenEdict = GetBody(strSource, "GetEngineServerSplitScreenEdict");
	g_Assert(!strSplitScreenEdict.includes("bIsSplitScreenEdictQueryAPIAvailableOut = false;"), "Failed split-screen lookup must preserve availability.");

	for (const strMethodName of ["GetSplitScreenPlayerAttachToEdict", "GetSplitScreenPlayerForEdict"]) {
		const nNativeCallPosition = strSplitScreenEdict.indexOf("pEngineServer->" + strMethodName + "(");
		const nBranchStart = strSplitScreenEdict.lastIndexOf("if constexpr (", nNativeCallPosition);
		const nCommitPosition = strSplitScreenEdict.indexOf("bIsSplitScreenEdictQueryAPIAvailableOut = true;", nBranchStart);
		const nReturnPosition = strSplitScreenEdict.indexOf("return pSplitScreenEdict;", nNativeCallPosition);
		g_Assert((nBranchStart >= 0) && (nNativeCallPosition > nBranchStart) && (nCommitPosition > nNativeCallPosition) && (nCommitPosition < nReturnPosition), "Each split-screen overload commits availability only after a completed native call, including null.");
	}

	for (const vecHelper of [
		["GetEngineServerSinglePlayerSharedMemory", "GetSinglePlayerSharedMemorySpace", "bSinglePlayerSharedMemoryAPIAvailableOut", "pSinglePlayerSharedMemory"],
		["GetEngineServerAchievementManager", "GetAchievementMgr", "bAchievementManagerAPIAvailableOut", "pAchievementManager"],
	]) {
		const strHelper = GetBody(strSource, vecHelper[0]);
		const nNativeCallPosition = strHelper.indexOf("pEngineServer->" + vecHelper[1] + "(");
		const nBranchStart = strHelper.lastIndexOf("if constexpr (", nNativeCallPosition);
		const nCommitPosition = strHelper.indexOf(vecHelper[2] + " = true;", nBranchStart);
		const nReturnPosition = strHelper.indexOf("return " + vecHelper[3] + ";", nNativeCallPosition);
		g_Assert(!strHelper.includes(vecHelper[2] + " = false;"), "Failed server address queries must preserve availability.");
		g_Assert((nBranchStart >= 0) && (nNativeCallPosition > nBranchStart) && (nCommitPosition > nNativeCallPosition) && (nCommitPosition < nReturnPosition), "Server address queries commit availability only after a completed native call, including null.");
	}

	const strSharedMemoryCallback = GetBody(strSource, "GetEngineServerSinglePlayerSharedMemorySpaceCallback");
	g_Assert(strSharedMemoryCallback.includes("#if !defined(MAX_EDICTS)\n\t\tconstexpr char kMissingEntityIndexErrorMessage[]") && strSharedMemoryCallback.includes("#endif // !defined(MAX_EDICTS)"), "The missing-index diagnostic belongs only to the SDK branch without MAX_EDICTS.");

	const strAchievementManagerCallback = GetBody(strSource, "GetOrSetEngineServerAchievementManagerCallback");
	g_Assert(strAchievementManagerCallback.includes("SetAchievementManager(unAchievementManagerAddress?)"), "Achievement-manager diagnostics must use the actual unsigned address argument category.");

	for (const vecCallback of [
		["GetEngineServerClientXUIDCallback", "GetClientXUID"],
		["SendEngineServerPaintMapDataToClientCallback", "SendPaintMapDataToClient"],
	]) {
		const strCallback = GetBody(strSource, vecCallback[0]);
		const nClientIndexPosition = strCallback.indexOf("GetValueIndex(");
		const nPendingExceptionPosition = strCallback.indexOf("HasPendingException()");
		const nEdictLookupPosition = strCallback.indexOf("GetEdictFromEntityIndex(");
		g_Assert(strCallback.includes("if (nClientIndex <= 0) {\n\t\t\t\tif (!pIsolate->HasPendingException()) {"), "Paint/XUID callbacks must preserve an original client Index getter error.");
		g_Assert((nClientIndexPosition >= 0) && (nPendingExceptionPosition > nClientIndexPosition) && (nEdictLookupPosition > nPendingExceptionPosition), "Client Index failures must stop before native edict lookup.");
		g_Assert(strCallback.includes(vecCallback[1] + "(ClientOrIndex)"), "Client diagnostics must describe the actual generic index-bearing argument.");
	}

	const strXUIDHelper = GetBody(strSource, "GetEngineServerClientXUID");
	g_Assert(!strXUIDHelper.includes("unXUIDOut = 0;"), "Failed XUID queries must preserve the caller output.");

	const strXUIDCallback = GetBody(strSource, "GetEngineServerClientXUIDCallback");
	g_Assert(strXUIDCallback.includes("v8::BigInt::NewFromUnsigned(pIsolate, unXUID)"), "XUID results must remain exact unsigned BigInt values.");

	const strRLEParser = GetBody(strSource, "ReadEngineServerPaintMapDataRLEFromValue");
	g_Assert(strRLEParser.includes("kMaximumNativePaintMapDataRLEEntryCount = static_cast<std::size_t>(std::numeric_limits<int>::max());"), "RLE counts must fit the actual native int representation.");
	g_Assert(strRLEParser.includes("kMaximumStoragePaintMapDataRLEEntryCount = std::numeric_limits<std::size_t>::max() / sizeof(unsigned int);"), "RLE byte sizes must be checked before multiplication.");
	const nRLESizeGuardPosition = strRLEParser.indexOf("if ((unPaintMapDataRLEEntryCount > kMaximumNativePaintMapDataRLEEntryCount) || (unPaintMapDataRLEEntryCount > kMaximumStoragePaintMapDataRLEEntryCount)) {");
	const nRLECapacityPosition = strRLEParser.indexOf("vecPaintMapDataRLE.EnsureCapacity(static_cast<int>(unPaintMapDataRLEEntryCount));");
	const nRLEAllocationGuardPosition = strRLEParser.indexOf("if ((unPaintMapDataRLEEntryCount != 0) && !vecPaintMapDataRLE.Base()) {");
	const nRLEEntryReadPosition = strRLEParser.indexOf("LocalPaintMapDataRLEArray->Get(");
	const nRLELastEntryAppendPosition = strRLEParser.lastIndexOf("vecPaintMapDataRLE.AddToTail(");
	const nRLECommitPosition = strRLEParser.indexOf("vecPaintMapDataRLEOut.Swap(vecPaintMapDataRLE);");
	g_Assert((nRLESizeGuardPosition >= 0) && (nRLECapacityPosition > nRLESizeGuardPosition) && (nRLEAllocationGuardPosition > nRLECapacityPosition) && (nRLEEntryReadPosition > nRLEAllocationGuardPosition), "RLE representation and allocation checks must precede entry reads.");
	g_Assert((nRLELastEntryAppendPosition > nRLEEntryReadPosition) && (nRLECommitPosition > nRLELastEntryAppendPosition) && !strRLEParser.includes("vecPaintMapDataRLEOut = vecPaintMapDataRLE;"), "Only a fully parsed RLE buffer may be transferred without allocating again.");

	const strRLEGetter = GetBody(strSource, "GetEngineServerPaintMapDataRLE");
	const nRLENativeGetPosition = strRLEGetter.indexOf("pEngineServer->GetPaintmapDataRLE(");
	const nRLENativeCommitPosition = strRLEGetter.indexOf("vecPaintMapDataRLEOut.Swap(vecPaintMapDataRLE);");
	g_Assert((nRLENativeGetPosition >= 0) && (nRLENativeCommitPosition > nRLENativeGetPosition) && !strRLEGetter.includes("vecPaintMapDataRLEOut = vecPaintMapDataRLE;"), "Native RLE output commits only after success and must not grow again during a copy.");

	const strRLELoader = GetBody(strSource, "LoadEngineServerPaintMapDataRLE");
	g_Assert(strRLELoader.includes("CUtlVector<unsigned int>& vecPaintMapDataRLE)"), "The native RLE loader takes an input buffer, not a caller output parameter.");

	const strFlushEntity = GetBody(strSource, "ForceFlushEngineServerEntityCallback");
	g_Assert(strFlushEntity.includes("if (nEntityIndex < 0) {\n\t\t\t\tif (!pIsolate->HasPendingException()) {"), "ForceFlushEntity must preserve an original Index getter error.");

	const strPreviousTransmit = GetBody(strSource, "GetEngineServerPreviousCheckTransmitInformationCallback");
	for (const strMember of ["m_PVS", "m_Areas", "m_AreaFloodNums"]) {
		g_Assert(strPreviousTransmit.includes("sizeof(CCheckTransmitInfo::" + strMember + ")"), "Transmit copy capacities must derive from actual SDK storage.");
	}

	for (const strHelperName of ["RequireEngineIntegerArrayFromValue", "RequireEngineBooleanArrayFromValue"]) {
		const strHelper = GetBody(strSource, strHelperName);
		g_Assert(strHelper.includes("Out = std::move("), "Array parser outputs commit only a complete successful copy.");
		g_Assert(!strHelper.includes("ValuesOut.push_back("), "Array parsers must not commit partial results before a later element fails.");
	}

	const strPortalPlane = GetBody(strSource, "GetEngineServerAreaPortalPlaneCallback");
	g_Assert(strPortalPlane.includes("VPlane AreaPortalPlane = VPlane(Vector(kInitialPlaneComponent, kInitialPlaneComponent, kInitialPlaneComponent), kInitialPlaneComponent);"), "SDK VPlane's empty constructor must not leave output fields undefined before use.");

	const strAreaBits = GetBody(strSource, "GetEngineServerAreaBits");
	g_Assert(strAreaBits.includes("std::vector<unsigned char> vecAreaStateBytes = vecAreaStateBytesOut;"), "Area-state staging must preserve the initial bytes and extent.");
	g_Assert(strAreaBits.includes("GetAreaBits(nAreaNumber, vecAreaStateBytes.data(), nAreaStateByteCount)"), "Native area-state writes must not expose partial output.");
	g_Assert(strAreaBits.indexOf("vecAreaStateBytesOut = std::move(vecAreaStateBytes);") > strAreaBits.indexOf("pEngineServer->GetAreaBits("), "Area-state output commits only after native success.");

	const strPVSArgument = GetBody(strSource, "RequireEnginePVSArgument");
	g_Assert(strPVSArgument.indexOf("vecPVSBytesOut = std::move(vecPVSBytes);") > strPVSArgument.indexOf("unPVSByteCount > kMaximumPVSByteCount"), "PVS argument output commits only after all byte-count validation.");

	const strResetPVS = GetBody(strSource, "ResetEngineServerPVSCallback");
	g_Assert(strResetPVS.indexOf("GetEngineServerPVSByteCount(") < strResetPVS.indexOf("LocalPVSByteCountValue ="), "Reset requires current cluster information even with an explicit byte count.");
	g_Assert(strResetPVS.includes("vecAccumulatedPVSBytes.clear();\n\t\t\t\treturn;"), "Failed reset status must retain the established accumulator cleanup.");

	const strAreasConnected = GetBody(strSource, "CheckEngineServerAreasConnected");
	g_Assert(!strAreasConnected.includes("bAreAreasConnectedOut = false;"), "Failed area connectivity dispatch must preserve the caller output.");
	g_Assert(strAreasConnected.includes("bAreAreasConnectedOut = pEngineServer->CheckAreasConnected(nFirstAreaNumber, nSecondAreaNumber) != 0;"), "Connectivity must commit the native nonzero predicate unchanged.");

	const strOptionalBoolean = GetBody(strSource, "ReadOptionalEngineBooleanArgument");
	g_Assert(strOptionalBoolean.includes("if (!LocalOptionalBooleanValue->IsBoolean())"), "Optional sound flags must not coerce non-booleans.");
	g_Assert(strOptionalBoolean.indexOf("bValueOut = bValue;") > strOptionalBoolean.indexOf("return false;"), "Optional flag output commits only after successful validation.");

	const strIndexArray = GetBody(strSource, "MakeTraceEntityIndexArray");
	g_Assert(strIndexArray.indexOf("unEntityIndexCount > kMaximumV8ArrayLength") < strIndexArray.indexOf("static_cast<int>(unEntityIndexCount)"), "Trace result length must be validated before narrowing.");
}

function VerifyEngineLookup(strSource, strHeader) {
	g_Assert(!GetBody(strSource, "FindSourceSDKEdictByIndex", 2).includes(" noexcept {"), "Virtual SDK edict lookup must not terminate before the callback boundary.");
	g_Assert(!GetBody(strSource, "EngineInterfaces::GetEdict").includes(" noexcept {"), "Edict wrapper must propagate native exceptions.");
	g_Assert(strHeader.includes("edict_t* GetEdict(const int nEntityIndex) const;"), "Edict declaration must agree with its exception contract.");
}

AssertBodyExtraction();
VerifyContracts(g_strSource);
VerifyEngineLookup(g_strEngineSource, g_strEngineHeader);

for (const strFunctionName of ["FindSourceSDKEdictByIndex", "EngineInterfaces::GetEdict"]) {
	const unIndentationLevel = (strFunctionName === "FindSourceSDKEdictByIndex") ? 2 : 1;
	const strBody = GetBody(g_strEngineSource, strFunctionName, unIndentationLevel);
	const strMutatedBody = strBody.replace(" {", " noexcept {");
	g_Assert.notEqual(strMutatedBody, strBody, "Edict mutation must change its owning definition.");
	g_Assert.equal(ReplaceBody(g_strEngineSource, strFunctionName, strBody, unIndentationLevel), g_strEngineSource, "Unmodified engine-body views must round-trip exactly.");
	g_Assert.throws(() => VerifyEngineLookup(ReplaceBody(g_strEngineSource, strFunctionName, strMutatedBody, unIndentationLevel), g_strEngineHeader), g_Assert.AssertionError, "Edict native exception propagation regression.");
}

g_Assert.throws(() => VerifyEngineLookup(g_strEngineSource, g_strEngineHeader.replace("edict_t* GetEdict(const int nEntityIndex) const;", "edict_t* GetEdict(const int nEntityIndex) const noexcept;")), g_Assert.AssertionError, "Edict declaration exception regression.");

// Keep the large negative-source inventory beside its runner, after baseline validation.
const g_vecMutations = [
	["constants local V8 catch", "InstallMapLoadTypeConstants", 1, false, "v8::TryCatch InstallationFailure(pIsolate);", "// lost local V8 catch"],
	["constants local caught error preservation", "InstallMapLoadTypeConstants", 1, false, "!InstallationFailure.HasCaught()", "true"],
	["constants original and fallback rethrow", "InstallMapLoadTypeConstants", 1, false, "InstallationFailure.ReThrow();", "InstallationFailure.Reset();"],
	["engine string native prefix", "RequireEngineStringArgument", 1, false, "std::string const strValue = *UTF8Value;", "std::string const strValue = std::string(*UTF8Value, static_cast<std::size_t>(UTF8Value.length()));"],
	["engines/server string-command operation exception boundary", "ExecuteEngineServerStringCommandOperationCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server string-command operation preparation boundary", "ExecuteEngineServerStringCommandOperationCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server string-command operation diagnostic identity", "ExecuteEngineServerStringCommandOperationCallback", 1, false, "\"engines/server string-command operation failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.ForceModelBounds() exception boundary", "ForceEngineServerModelBoundsCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.ForceModelBounds() preparation boundary", "ForceEngineServerModelBoundsCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.ForceModelBounds() diagnostic identity", "ForceEngineServerModelBoundsCallback", 1, false, "\"engines/server.ForceModelBounds() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.SetFakeClientCVarValue() exception boundary", "SetEngineServerFakeClientCVarValueCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.SetFakeClientCVarValue() preparation boundary", "SetEngineServerFakeClientCVarValueCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.SetFakeClientCVarValue() diagnostic identity", "SetEngineServerFakeClientCVarValueCallback", 1, false, "\"engines/server.SetFakeClientCVarValue() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.StartClientCVarQuery() exception boundary", "StartEngineServerClientCVarQueryCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.StartClientCVarQuery() preparation boundary", "StartEngineServerClientCVarQueryCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.StartClientCVarQuery() diagnostic identity", "StartEngineServerClientCVarQueryCallback", 1, false, "\"engines/server.StartClientCVarQuery() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.GetServerConstants() exception boundary", "GetEngineServerConstantsCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["MapLoadType native-unwind identity", "InstallMapLoadTypeConstants", 1, false, "if (InstallationFailure.HasCaught()) {\n\t\t\t\tInstallationFailure.ReThrow();\n\t\t\t}\n\n\t\t\tthrow;", "throw;"],
	["engines/server.GetServerConstants() preparation boundary", "GetEngineServerConstantsCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.GetServerConstants() diagnostic identity", "GetEngineServerConstantsCallback", 1, false, "\"engines/server.GetServerConstants() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.IsClientFullyAuthenticated() exception boundary", "IsEngineServerClientFullyAuthenticatedCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.IsClientFullyAuthenticated() preparation boundary", "IsEngineServerClientFullyAuthenticatedCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.IsClientFullyAuthenticated() diagnostic identity", "IsEngineServerClientFullyAuthenticatedCallback", 1, false, "\"engines/server.IsClientFullyAuthenticated() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.SetDedicatedServerBenchmarkMode() exception boundary", "SetEngineServerDedicatedServerBenchmarkModeCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.SetDedicatedServerBenchmarkMode() preparation boundary", "SetEngineServerDedicatedServerBenchmarkModeCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.SetDedicatedServerBenchmarkMode() diagnostic identity", "SetEngineServerDedicatedServerBenchmarkModeCallback", 1, false, "\"engines/server.SetDedicatedServerBenchmarkMode() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/precache.PrecacheModel() exception boundary", "PrecacheEngineModelCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/precache.PrecacheModel() preparation boundary", "PrecacheEngineModelCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/precache.PrecacheModel() diagnostic identity", "PrecacheEngineModelCallback", 1, false, "\"engines/precache.PrecacheModel() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/precache.PrecacheGeneric() exception boundary", "PrecacheEngineGenericResourceCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/precache.PrecacheGeneric() preparation boundary", "PrecacheEngineGenericResourceCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/precache.PrecacheGeneric() diagnostic identity", "PrecacheEngineGenericResourceCallback", 1, false, "\"engines/precache.PrecacheGeneric() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/precache.PrecacheDecal() exception boundary", "PrecacheEngineDecalCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/precache.PrecacheDecal() preparation boundary", "PrecacheEngineDecalCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/precache.PrecacheDecal() diagnostic identity", "PrecacheEngineDecalCallback", 1, false, "\"engines/precache.PrecacheDecal() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["constants original JavaScript error", "InstallMapLoadTypeConstants", 1, false, "!pIsolate->HasPendingException()", "true"],
	["constants execution termination", "InstallMapLoadTypeConstants", 1, false, "!pIsolate->IsExecutionTerminating()", "true"],
	["constants creation fallback", "InstallMapLoadTypeConstants", 1, false, "ThrowInstallationFallbackError();", "ThrowError(pIsolate, kInstallationErrorMessage);"],
	["constants installation fail-stop", "GetEngineServerConstantsCallback", 1, false, "if (!InstallMapLoadTypeConstants(pIsolate, LocalContext, LocalServerConstantsObject)) {\n\t\t\t\treturn;", "if (!InstallMapLoadTypeConstants(pIsolate, LocalContext, LocalServerConstantsObject)) {\n\t\t\t\t// lost stop"],
	["PrecacheModel raw result", "PrecacheEngineModelCallback", 1, false, "CallbackInformation.GetReturnValue().Set(nModelIndex);", "CallbackInformation.GetReturnValue().Set(true);"],
	["PrecacheModel sentinel preservation", "PrecacheEngineModelCallback", 1, false, "CallbackInformation.GetReturnValue().Set(nModelIndex);", "if (nModelIndex < 0) { return; }\n\t\t\tCallbackInformation.GetReturnValue().Set(nModelIndex);"],
	["PrecacheGeneric raw result", "PrecacheEngineGenericResourceCallback", 1, false, "CallbackInformation.GetReturnValue().Set(nGenericResourceIndex);", "CallbackInformation.GetReturnValue().Set(true);"],
	["PrecacheGeneric sentinel preservation", "PrecacheEngineGenericResourceCallback", 1, false, "CallbackInformation.GetReturnValue().Set(nGenericResourceIndex);", "if (nGenericResourceIndex < 0) { return; }\n\t\t\tCallbackInformation.GetReturnValue().Set(nGenericResourceIndex);"],
	["PrecacheDecal raw result", "PrecacheEngineDecalCallback", 1, false, "CallbackInformation.GetReturnValue().Set(nDecalIndex);", "CallbackInformation.GetReturnValue().Set(true);"],
	["PrecacheDecal sentinel preservation", "PrecacheEngineDecalCallback", 1, false, "CallbackInformation.GetReturnValue().Set(nDecalIndex);", "if (nDecalIndex < 0) { return; }\n\t\t\tCallbackInformation.GetReturnValue().Set(nDecalIndex);"],
	["StartEngineServerClientCVarQueryCallback unsupported branch", "StartEngineServerClientCVarQueryCallback", 1, false, "try {\n#if defined(ENGINE_BRANCH_DARKM)", "try {\n#if 0"],
	["IsEngineServerClientFullyAuthenticatedCallback unsupported branch", "IsEngineServerClientFullyAuthenticatedCallback", 1, false, "try {\n#if defined(SOURCEJS_OLD_CONSOLE_API)", "try {\n#if 0"],
	["SetEngineServerDedicatedServerBenchmarkModeCallback unsupported branch", "SetEngineServerDedicatedServerBenchmarkModeCallback", 1, false, "try {\n#if defined(SOURCEJS_OLD_CONSOLE_API)", "try {\n#if 0"],
	["engines/server.PrintToClientConsole() exception boundary", "PrintEngineServerClientConsoleMessageCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.PrintToClientConsole() preparation boundary", "PrintEngineServerClientConsoleMessageCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.PrintToClientConsole() diagnostic identity", "PrintEngineServerClientConsoleMessageCallback", 1, false, "\"engines/server.PrintToClientConsole() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.FadeClientVolume() exception boundary", "FadeEngineServerClientVolumeCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.FadeClientVolume() preparation boundary", "FadeEngineServerClientVolumeCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.FadeClientVolume() diagnostic identity", "FadeEngineServerClientVolumeCallback", 1, false, "\"engines/server.FadeClientVolume() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server sentence operation exception boundary", "GetEngineServerSentenceInformationCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server sentence operation preparation boundary", "GetEngineServerSentenceInformationCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server sentence operation diagnostic identity", "GetEngineServerSentenceInformationCallback", 1, false, "\"engines/server sentence operation failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.PickSentenceFromGroup() exception boundary", "PickEngineServerSentenceFromGroupCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.PickSentenceFromGroup() preparation boundary", "PickEngineServerSentenceFromGroupCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.PickSentenceFromGroup() diagnostic identity", "PickEngineServerSentenceFromGroupCallback", 1, false, "\"engines/server.PickSentenceFromGroup() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.PickSequentialSentenceFromGroup() exception boundary", "PickSequentialEngineServerSentenceFromGroupCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.PickSequentialSentenceFromGroup() preparation boundary", "PickSequentialEngineServerSentenceFromGroupCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.PickSequentialSentenceFromGroup() diagnostic identity", "PickSequentialEngineServerSentenceFromGroupCallback", 1, false, "\"engines/server.PickSequentialSentenceFromGroup() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.SetLightStyle() exception boundary", "SetEngineServerLightStyleCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.SetLightStyle() preparation boundary", "SetEngineServerLightStyleCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.SetLightStyle() diagnostic identity", "SetEngineServerLightStyleCallback", 1, false, "\"engines/server.SetLightStyle() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.PlaceStaticDecal() exception boundary", "PlaceEngineServerStaticDecalCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.PlaceStaticDecal() preparation boundary", "PlaceEngineServerStaticDecalCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.PlaceStaticDecal() diagnostic identity", "PlaceEngineServerStaticDecalCallback", 1, false, "\"engines/server.PlaceStaticDecal() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.SetClientViewEntity() exception boundary", "SetEngineServerClientViewEntityCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.SetClientViewEntity() preparation boundary", "SetEngineServerClientViewEntityCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.SetClientViewEntity() diagnostic identity", "SetEngineServerClientViewEntityCallback", 1, false, "\"engines/server.SetClientViewEntity() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.SetClientCrosshairAngle() exception boundary", "SetEngineServerClientCrosshairAngleCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.SetClientCrosshairAngle() preparation boundary", "SetEngineServerClientCrosshairAngleCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.SetClientCrosshairAngle() diagnostic identity", "SetEngineServerClientCrosshairAngleCallback", 1, false, "\"engines/server.SetClientCrosshairAngle() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.SetNetworkStringTablesLocked() exception boundary", "SetEngineServerNetworkStringTablesLockedCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.SetNetworkStringTablesLocked() preparation boundary", "SetEngineServerNetworkStringTablesLockedCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.SetNetworkStringTablesLocked() diagnostic identity", "SetEngineServerNetworkStringTablesLockedCallback", 1, false, "\"engines/server.SetNetworkStringTablesLocked() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.CreateFakeClient() exception boundary", "CreateEngineServerFakeClientCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.CreateFakeClient() preparation boundary", "CreateEngineServerFakeClientCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.CreateFakeClient() diagnostic identity", "CreateEngineServerFakeClientCallback", 1, false, "\"engines/server.CreateFakeClient() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server no-argument operation exception boundary", "ExecuteEngineServerNoArgumentOperationCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server no-argument operation preparation boundary", "ExecuteEngineServerNoArgumentOperationCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server no-argument operation diagnostic identity", "ExecuteEngineServerNoArgumentOperationCallback", 1, false, "\"engines/server no-argument operation failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["root console argument role", "PrintEngineServerClientConsoleMessageCallback", 1, false, "PrintToClientConsole(ClientOrIndex, strMessage)", "PrintToClientConsole(client, strMessage)"],
	["root console getter failure", "PrintEngineServerClientConsoleMessageCallback", 1, false, "if (nPlayerIndex < 0) {\n\t\t\t\treturn;", "if (nPlayerIndex < 0) {\n\t\t\t\t// lost stop"],
	["PickEngineServerSentenceFromGroupCallback capacity", "PickEngineServerSentenceFromGroupCallback", 1, false, "constexpr std::size_t kSentenceNameBufferSize = 256;", "constexpr int kSentenceNameBufferSize = 256;"],
	["PickEngineServerSentenceFromGroupCallback defined name", "PickEngineServerSentenceFromGroupCallback", 1, false, "char szSentenceName[kSentenceNameBufferSize] {};", "char szSentenceName[kSentenceNameBufferSize];"],
	["PickEngineServerSentenceFromGroupCallback native capacity", "PickEngineServerSentenceFromGroupCallback", 1, false, "static_cast<int>(kSentenceNameBufferSize)", "kSentenceNameBufferSize"],
	["PickEngineServerSentenceFromGroupCallback name termination", "PickEngineServerSentenceFromGroupCallback", 1, false, "if (!std::memchr(szSentenceName, '\\0', sizeof(szSentenceName)))", "if (false)"],
	["PickEngineServerSentenceFromGroupCallback negative sentinel", "PickEngineServerSentenceFromGroupCallback", 1, false, "v8::Local<v8::Object> const LocalPickedSentenceObject =", "if (nSentenceIndex < 0) { return; }\n\t\t\tv8::Local<v8::Object> const LocalPickedSentenceObject ="],
	["PickSequentialEngineServerSentenceFromGroupCallback capacity", "PickSequentialEngineServerSentenceFromGroupCallback", 1, false, "constexpr std::size_t kSentenceNameBufferSize = 256;", "constexpr int kSentenceNameBufferSize = 256;"],
	["PickSequentialEngineServerSentenceFromGroupCallback defined name", "PickSequentialEngineServerSentenceFromGroupCallback", 1, false, "char szSentenceName[kSentenceNameBufferSize] {};", "char szSentenceName[kSentenceNameBufferSize];"],
	["PickSequentialEngineServerSentenceFromGroupCallback native capacity", "PickSequentialEngineServerSentenceFromGroupCallback", 1, false, "static_cast<int>(kSentenceNameBufferSize)", "kSentenceNameBufferSize"],
	["PickSequentialEngineServerSentenceFromGroupCallback name termination", "PickSequentialEngineServerSentenceFromGroupCallback", 1, false, "if (!std::memchr(szSentenceName, '\\0', sizeof(szSentenceName)))", "if (false)"],
	["PickSequentialEngineServerSentenceFromGroupCallback negative sentinel", "PickSequentialEngineServerSentenceFromGroupCallback", 1, false, "v8::Local<v8::Object> const LocalPickedSentenceObject =", "if (nPickedSentenceIndex < 0) { return; }\n\t\t\tv8::Local<v8::Object> const LocalPickedSentenceObject ="],
	["light pattern overflow", "AllocateProcessLifetimeEngineServerLightPattern", 1, false, "if (unPatternByteCount > kMaximumLightPatternByteCount)", "if (false)"],
	["light pattern terminator capacity", "AllocateProcessLifetimeEngineServerLightPattern", 1, false, "std::numeric_limits<std::size_t>::max() - 1", "std::numeric_limits<std::size_t>::max()"],
	["light pattern reuse", "AllocateProcessLifetimeEngineServerLightPattern", 1, false, "return { itLightPattern->second, unAllocationByteCount, 0 };", "return {};"],
	["light pattern cache preparation", "AllocateProcessLifetimeEngineServerLightPattern", 1, false, "try_emplace(strLightPattern, nullptr).first", "insert_or_assign(strLightPattern, nullptr).first"],
	["light pattern Windows error", "AllocateProcessLifetimeEngineServerLightPattern", 1, false, "static_cast<unsigned int>(::GetLastError())", "0"],
	["light pattern Linux error", "AllocateProcessLifetimeEngineServerLightPattern", 1, false, "static_cast<unsigned int>(errno)", "0"],
	["light pattern Linux failure sentinel", "AllocateProcessLifetimeEngineServerLightPattern", 1, false, "if (pLightPatternStorage == MAP_FAILED)", "if (false)"],
	["light pattern null mapping", "AllocateProcessLifetimeEngineServerLightPattern", 1, false, "(::munmap(pLightPatternStorage, unAllocationByteCount) == 0) ? static_cast<unsigned int>(EFAULT) : static_cast<unsigned int>(errno)", "0"],
	["light pattern complete copy", "AllocateProcessLifetimeEngineServerLightPattern", 1, false, "std::memcpy(pszLightPatternStorage, strLightPattern.c_str(), unAllocationByteCount);", "std::memcpy(pszLightPatternStorage, strLightPattern.c_str(), unPatternByteCount);"],
	["light pattern stable dispatch", "SetEngineServerLightStyleCallback", 1, false, "pEngineServer->LightStyle(nLightStyle, LightPatternAllocation.m_pszLightPattern);", "pEngineServer->LightStyle(nLightStyle, strLightPattern.c_str());"],
	["light pattern allocation fail-stop", "SetEngineServerLightStyleCallback", 1, false, "ThrowError(pIsolate, szAllocationErrorMessage);\n\t\t\t\treturn;", "ThrowError(pIsolate, szAllocationErrorMessage);"],
	["light pattern diagnostic truncation", "SetEngineServerLightStyleCallback", 1, false, "(static_cast<std::size_t>(nMessageLength) >= sizeof(szAllocationErrorMessage))", "false"],
	["engines/server.GetChoreographySoundLatency() exception boundary", "GetEngineServerChoreographySoundLatencyCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.GetChoreographySoundLatency() preparation boundary", "GetEngineServerChoreographySoundLatencyCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.GetChoreographySoundLatency() diagnostic identity", "GetEngineServerChoreographySoundLatencyCallback", 1, false, "\"engines/server.GetChoreographySoundLatency() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.GetClientCrossPlayPlatform() exception boundary", "GetEngineServerClientCrossPlayPlatformCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.GetClientCrossPlayPlatform() preparation boundary", "GetEngineServerClientCrossPlayPlatformCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.GetClientCrossPlayPlatform() diagnostic identity", "GetEngineServerClientCrossPlayPlatformCallback", 1, false, "\"engines/server.GetClientCrossPlayPlatform() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.EnsureEntityInstanceBaseline() exception boundary", "EnsureEngineServerInstanceBaselineCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.EnsureEntityInstanceBaseline() preparation boundary", "EnsureEngineServerInstanceBaselineCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.EnsureEntityInstanceBaseline() diagnostic identity", "EnsureEngineServerInstanceBaselineCallback", 1, false, "\"engines/server.EnsureEntityInstanceBaseline() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.ReserveServerForQueuedGame() exception boundary", "ReserveEngineServerForQueuedGameCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.ReserveServerForQueuedGame() preparation boundary", "ReserveEngineServerForQueuedGameCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.ReserveServerForQueuedGame() diagnostic identity", "ReserveEngineServerForQueuedGameCallback", 1, false, "\"engines/server.ReserveServerForQueuedGame() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.CreateEdict() exception boundary", "CreateEngineServerEdictCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.CreateEdict() preparation boundary", "CreateEngineServerEdictCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.CreateEdict() diagnostic identity", "CreateEngineServerEdictCallback", 1, false, "\"engines/server.CreateEdict() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.RemoveEdict() exception boundary", "RemoveEngineServerEdictCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.RemoveEdict() preparation boundary", "RemoveEngineServerEdictCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.RemoveEdict() diagnostic identity", "RemoveEngineServerEdictCallback", 1, false, "\"engines/server.RemoveEdict() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.EmitAmbientSound() exception boundary", "EmitEngineServerAmbientSoundCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.EmitAmbientSound() preparation boundary", "EmitEngineServerAmbientSoundCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.EmitAmbientSound() diagnostic identity", "EmitEngineServerAmbientSoundCallback", 1, false, "\"engines/server.EmitAmbientSound() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.ExecuteClientCommand() exception boundary", "ExecuteEngineServerClientCommandCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.ExecuteClientCommand() preparation boundary", "ExecuteEngineServerClientCommandCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.ExecuteClientCommand() diagnostic identity", "ExecuteEngineServerClientCommandCallback", 1, false, "\"engines/server.ExecuteClientCommand() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["baseline getter identity", "EnsureEngineServerInstanceBaselineCallback", 1, false, "if (!pIsolate->HasPendingException()) {", "if (true) {"],
	["baseline argument role", "EnsureEngineServerInstanceBaselineCallback", 1, false, "EnsureEntityInstanceBaseline(EntityOrIndex)", "EnsureEntityInstanceBaseline(entity)"],
	["ambient enum minimum", "EmitEngineServerAmbientSoundCallback", 1, false, "constexpr int kMinimumSoundLevel = 0;", "constexpr int kMinimumSoundLevel = -1;"],
	["ambient enum maximum", "EmitEngineServerAmbientSoundCallback", 1, false, "constexpr int kMaximumSoundLevel = 255;", "constexpr int kMaximumSoundLevel = 511;"],
	["ambient enum validation", "EmitEngineServerAmbientSoundCallback", 1, false, "if ((nSoundLevel < kMinimumSoundLevel) || (nSoundLevel > kMaximumSoundLevel))", "if (false)"],
	["ambient fallback identity", "EmitEngineServerAmbientSoundCallback", 1, false, "if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {", "if (true) {"],
	["ambient argument role", "EmitEngineServerAmbientSoundCallback", 1, false, "EmitAmbientSound(EntityOrIndex, Position,", "EmitAmbientSound(entity, Position,"],
	["client command argument role", "ExecuteEngineServerClientCommandCallback", 1, false, "ExecuteClientCommand(ClientOrIndex, strCommand, bServerSide?)", "ExecuteClientCommand(client, strCommand, bServerSide?)"],
	["client command getter failure", "ExecuteEngineServerClientCommandCallback", 1, false, "if (nPlayerIndex < 0) {\n\t\t\t\treturn;", "if (nPlayerIndex < 0) {\n\t\t\t\t// lost stop"],
	["engines/server.RemoveAllPaint() exception boundary", "RemoveAllPaintFromEngineServerCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.RemoveAllPaint() preparation boundary", "RemoveAllPaintFromEngineServerCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.RemoveAllPaint() diagnostic identity", "RemoveAllPaintFromEngineServerCallback", 1, false, "\"engines/server.RemoveAllPaint() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.PaintAllSurfaces() exception boundary", "PaintAllSurfacesOnEngineServerCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.PaintAllSurfaces() preparation boundary", "PaintAllSurfacesOnEngineServerCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.PaintAllSurfaces() diagnostic identity", "PaintAllSurfacesOnEngineServerCallback", 1, false, "\"engines/server.PaintAllSurfaces() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.GetClientXUID() exception boundary", "GetEngineServerClientXUIDCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.GetClientXUID() preparation boundary", "GetEngineServerClientXUIDCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.GetClientXUID() diagnostic identity", "GetEngineServerClientXUIDCallback", 1, false, "\"engines/server.GetClientXUID() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.IsApplicationActive() exception boundary", "IsEngineServerApplicationActiveCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.IsApplicationActive() preparation boundary", "IsEngineServerApplicationActiveCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.IsApplicationActive() diagnostic identity", "IsEngineServerApplicationActiveCallback", 1, false, "\"engines/server.IsApplicationActive() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.SetNoClipEnabled() exception boundary", "SetEngineServerNoClipEnabledCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.SetNoClipEnabled() preparation boundary", "SetEngineServerNoClipEnabledCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.SetNoClipEnabled() diagnostic identity", "SetEngineServerNoClipEnabledCallback", 1, false, "\"engines/server.SetNoClipEnabled() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server paint-map RLE operation exception boundary", "GetOrLoadEngineServerPaintMapDataRLECallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server paint-map RLE operation preparation boundary", "GetOrLoadEngineServerPaintMapDataRLECallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server paint-map RLE operation diagnostic identity", "GetOrLoadEngineServerPaintMapDataRLECallback", 1, false, "\"engines/server paint-map RLE operation failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.SendPaintMapDataToClient() exception boundary", "SendEngineServerPaintMapDataToClientCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.SendPaintMapDataToClient() preparation boundary", "SendEngineServerPaintMapDataToClientCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.SendPaintMapDataToClient() diagnostic identity", "SendEngineServerPaintMapDataToClientCallback", 1, false, "\"engines/server.SendPaintMapDataToClient() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["GetClientXUID Index error identity", "GetEngineServerClientXUIDCallback", 1, false, "if (!pIsolate->HasPendingException()) {", "if (true) {"],
	["GetClientXUID argument category", "GetEngineServerClientXUIDCallback", 1, false, "GetClientXUID(ClientOrIndex)", "GetClientXUID(client)"],
	["SendPaintMapDataToClient Index error identity", "SendEngineServerPaintMapDataToClientCallback", 1, false, "if (!pIsolate->HasPendingException()) {", "if (true) {"],
	["SendPaintMapDataToClient argument category", "SendEngineServerPaintMapDataToClientCallback", 1, false, "SendPaintMapDataToClient(ClientOrIndex)", "SendPaintMapDataToClient(client)"],
	["Application activity failure output", "IsEngineServerApplicationActive", 1, false, "\n\t\tif constexpr (", "\n\t\tbApplicationActiveOut = false;\n\n\t\tif constexpr ("],
	["XUID failure output", "GetEngineServerClientXUID", 1, false, "\n\t\tif constexpr (", "\n\t\tunXUIDOut = 0;\n\n\t\tif constexpr ("],
	["Exact unsigned XUID result", "GetEngineServerClientXUIDCallback", 1, false, "v8::BigInt::NewFromUnsigned(pIsolate, unXUID)", "v8::Number::New(pIsolate, static_cast<double>(unXUID))"],
	["RLE native count limit", "ReadEngineServerPaintMapDataRLEFromValue", 1, false, "static_cast<std::size_t>(std::numeric_limits<int>::max())", "static_cast<std::size_t>(std::numeric_limits<std::uint32_t>::max())"],
	["RLE storage limit", "ReadEngineServerPaintMapDataRLEFromValue", 1, false, "std::numeric_limits<std::size_t>::max() / sizeof(unsigned int)", "std::numeric_limits<std::size_t>::max() * sizeof(unsigned int)"],
	["RLE native count validation", "ReadEngineServerPaintMapDataRLEFromValue", 1, false, "unPaintMapDataRLEEntryCount > kMaximumNativePaintMapDataRLEEntryCount", "false"],
	["RLE storage validation", "ReadEngineServerPaintMapDataRLEFromValue", 1, false, "unPaintMapDataRLEEntryCount > kMaximumStoragePaintMapDataRLEEntryCount", "false"],
	["RLE exact capacity", "ReadEngineServerPaintMapDataRLEFromValue", 1, false, "vecPaintMapDataRLE.EnsureCapacity(static_cast<int>(unPaintMapDataRLEEntryCount));", "// lost exact capacity"],
	["RLE allocation check", "ReadEngineServerPaintMapDataRLEFromValue", 1, false, "if ((unPaintMapDataRLEEntryCount != 0) && !vecPaintMapDataRLE.Base()) {", "if (false) {"],
	["RLE parse ownership transfer", "ReadEngineServerPaintMapDataRLEFromValue", 1, false, "vecPaintMapDataRLEOut.Swap(vecPaintMapDataRLE);", "vecPaintMapDataRLEOut = vecPaintMapDataRLE;"],
	["RLE native ownership transfer", "GetEngineServerPaintMapDataRLE", 1, false, "vecPaintMapDataRLEOut.Swap(vecPaintMapDataRLE);", "vecPaintMapDataRLEOut = vecPaintMapDataRLE;"],
	["RLE native success commit", "GetEngineServerPaintMapDataRLE", 1, false, "pEngineServer->GetPaintmapDataRLE(vecPaintMapDataRLE);", "vecPaintMapDataRLEOut.Swap(vecPaintMapDataRLE);\n\t\t\tpEngineServer->GetPaintmapDataRLE(vecPaintMapDataRLE);"],
	["RLE parser success commit", "ReadEngineServerPaintMapDataRLEFromValue", 1, false, "\t\tCUtlVector<unsigned int> vecPaintMapDataRLE {};", "\t\tCUtlVector<unsigned int> vecPaintMapDataRLE {};\n\t\tvecPaintMapDataRLEOut.Swap(vecPaintMapDataRLE);"],
	["RLE SDK input role", "LoadEngineServerPaintMapDataRLE", 1, false, "CUtlVector<unsigned int>& vecPaintMapDataRLE)", "CUtlVector<unsigned int>& vecPaintMapDataRLEOut)"],
	["engines/server.GetSinglePlayerSharedMemorySpace() exception boundary", "GetEngineServerSinglePlayerSharedMemorySpaceCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.GetSinglePlayerSharedMemorySpace() preparation boundary", "GetEngineServerSinglePlayerSharedMemorySpaceCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.GetSinglePlayerSharedMemorySpace() diagnostic identity", "GetEngineServerSinglePlayerSharedMemorySpaceCallback", 1, false, "\"engines/server.GetSinglePlayerSharedMemorySpace() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.SetPaused() exception boundary", "SetEngineServerPausedCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.SetPaused() preparation boundary", "SetEngineServerPausedCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.SetPaused() diagnostic identity", "SetEngineServerPausedCallback", 1, false, "\"engines/server.SetPaused() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server branch void operation exception boundary", "ExecuteEngineServerBranchVoidOperationCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server branch void operation preparation boundary", "ExecuteEngineServerBranchVoidOperationCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server branch void operation diagnostic identity", "ExecuteEngineServerBranchVoidOperationCallback", 1, false, "\"engines/server branch void operation failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server achievement manager operation exception boundary", "GetOrSetEngineServerAchievementManagerCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server achievement manager operation preparation boundary", "GetOrSetEngineServerAchievementManagerCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server achievement manager operation diagnostic identity", "GetOrSetEngineServerAchievementManagerCallback", 1, false, "\"engines/server achievement manager operation failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.SetServerHibernation() exception boundary", "SetServerGameDLLHibernatingCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.SetServerHibernation() preparation boundary", "SetServerGameDLLHibernatingCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.SetServerHibernation() diagnostic identity", "SetServerGameDLLHibernatingCallback", 1, false, "\"engines/server.SetServerHibernation() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.HasPaintMap() exception boundary", "HasEngineServerPaintMapCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.HasPaintMap() preparation boundary", "HasEngineServerPaintMapCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.HasPaintMap() diagnostic identity", "HasEngineServerPaintMapCallback", 1, false, "\"engines/server.HasPaintMap() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["GetEngineServerSinglePlayerSharedMemory availability preservation", "GetEngineServerSinglePlayerSharedMemory", 1, false, "\n\t\tif constexpr (", "\n\t\tbSinglePlayerSharedMemoryAPIAvailableOut = false;\n\n\t\tif constexpr ("],
	["GetEngineServerSinglePlayerSharedMemory availability commit", "GetEngineServerSinglePlayerSharedMemory", 1, false, "void* const pSinglePlayerSharedMemory = pEngineServer->GetSinglePlayerSharedMemorySpace(", "bSinglePlayerSharedMemoryAPIAvailableOut = true;\n\t\t\tvoid* const pSinglePlayerSharedMemory = pEngineServer->GetSinglePlayerSharedMemorySpace("],
	["GetEngineServerAchievementManager availability preservation", "GetEngineServerAchievementManager", 1, false, "\n\t\tif constexpr (", "\n\t\tbAchievementManagerAPIAvailableOut = false;\n\n\t\tif constexpr ("],
	["GetEngineServerAchievementManager availability commit", "GetEngineServerAchievementManager", 1, false, "auto* const pAchievementManager = pEngineServer->GetAchievementMgr(", "bAchievementManagerAPIAvailableOut = true;\n\t\t\tauto* const pAchievementManager = pEngineServer->GetAchievementMgr("],
	["Shared-memory missing-index diagnostic branch", "GetEngineServerSinglePlayerSharedMemorySpaceCallback", 1, false, "#if !defined(MAX_EDICTS)", "#if defined(MAX_EDICTS)"],
	["Achievement-manager address diagnostic", "GetOrSetEngineServerAchievementManagerCallback", 1, false, "SetAchievementManager(unAchievementManagerAddress?)", "SetAchievementManager(Manager?)"],
	["Paint-map query failure output", "HasEngineServerPaintMap", 1, false, "\n\t\tif constexpr (", "\n\t\tbHasPaintMapOut = false;\n\n\t\tif constexpr ("],
	["engines/server.IsEngineLogEnabled() exception boundary", "IsEngineServerLogEnabledCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.IsEngineLogEnabled() preparation boundary", "IsEngineServerLogEnabledCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.IsEngineLogEnabled() diagnostic identity", "IsEngineServerLogEnabledCallback", 1, false, "\"engines/server.IsEngineLogEnabled() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server timescale operation exception boundary", "GetOrSetEngineServerTimescaleCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server timescale operation preparation boundary", "GetOrSetEngineServerTimescaleCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server timescale operation diagnostic identity", "GetOrSetEngineServerTimescaleCallback", 1, false, "\"engines/server timescale operation failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server branch boolean query exception boundary", "GetEngineServerBranchBooleanCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server branch boolean query preparation boundary", "GetEngineServerBranchBooleanCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server branch boolean query diagnostic identity", "GetEngineServerBranchBooleanCallback", 1, false, "\"engines/server branch boolean query failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.IsSplitScreenPlayer() exception boundary", "IsEngineServerSplitScreenPlayerCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.IsSplitScreenPlayer() preparation boundary", "IsEngineServerSplitScreenPlayerCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.IsSplitScreenPlayer() diagnostic identity", "IsEngineServerSplitScreenPlayerCallback", 1, false, "\"engines/server.IsSplitScreenPlayer() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server split-screen edict query exception boundary", "GetEngineServerSplitScreenEdictCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server split-screen edict query preparation boundary", "GetEngineServerSplitScreenEdictCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server split-screen edict query diagnostic identity", "GetEngineServerSplitScreenEdictCallback", 1, false, "\"engines/server split-screen edict query failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.GetAttachedSplitScreenUserCount() exception boundary", "GetEngineServerAttachedSplitScreenUserCountCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.GetAttachedSplitScreenUserCount() preparation boundary", "GetEngineServerAttachedSplitScreenUserCountCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.GetAttachedSplitScreenUserCount() diagnostic identity", "GetEngineServerAttachedSplitScreenUserCountCallback", 1, false, "\"engines/server.GetAttachedSplitScreenUserCount() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["engines/server.ForceFlushEntity() exception boundary", "ForceFlushEngineServerEntityCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["engines/server.ForceFlushEntity() preparation boundary", "ForceFlushEngineServerEntityCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["engines/server.ForceFlushEntity() diagnostic identity", "ForceFlushEngineServerEntityCallback", 1, false, "\"engines/server.ForceFlushEntity() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["Branch predicate output preservation", "GetEngineServerBranchBoolean", 1, false, "\n\t\tswitch (Operation) {", "\n\t\tbBranchBooleanResultOut = false;\n\n\t\tswitch (Operation) {"],
	["Split-screen player output preservation", "IsEngineServerSplitScreenPlayer", 1, false, "\n\t\tif constexpr (", "\n\t\tbIsSplitScreenPlayerOut = false;\n\n\t\tif constexpr ("],
	["Split-screen edict availability preservation", "GetEngineServerSplitScreenEdict", 1, false, "\n\t\tif (bShouldGetAttachmentEdict) {", "\n\t\tbIsSplitScreenEdictQueryAPIAvailableOut = false;\n\n\t\tif (bShouldGetAttachmentEdict) {"],
	["pEngineServer->GetSplitScreenPlayerAttachToEdict(nReferenceIndex) availability commit", "GetEngineServerSplitScreenEdict", 1, false, "auto* const pSplitScreenEdict = pEngineServer->GetSplitScreenPlayerAttachToEdict(nReferenceIndex);", "bIsSplitScreenEdictQueryAPIAvailableOut = true;\n\t\t\t\tauto* const pSplitScreenEdict = pEngineServer->GetSplitScreenPlayerAttachToEdict(nReferenceIndex);"],
	["pEngineServer->GetSplitScreenPlayerForEdict(nReferenceIndex, nSplitScreenSlot) availability commit", "GetEngineServerSplitScreenEdict", 1, false, "auto* const pSplitScreenEdict = pEngineServer->GetSplitScreenPlayerForEdict(nReferenceIndex, nSplitScreenSlot);", "bIsSplitScreenEdictQueryAPIAvailableOut = true;\n\t\t\t\tauto* const pSplitScreenEdict = pEngineServer->GetSplitScreenPlayerForEdict(nReferenceIndex, nSplitScreenSlot);"],
	["ForceFlushEntity Index error preservation", "ForceFlushEngineServerEntityCallback", 1, false, "if (!pIsolate->HasPendingException()) {", "if (true) {"],
	["GetServerVersion exception boundary", "GetEngineServerVersionCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetServerVersion preparation boundary", "GetEngineServerVersionCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["GetServerVersion diagnostic identity", "GetEngineServerVersionCallback", 1, false, "\"engines/server.GetServerVersion() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["EndMultiplayerGame exception boundary", "EndEngineServerMultiplayerGameCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["EndMultiplayerGame preparation boundary", "EndEngineServerMultiplayerGameCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["EndMultiplayerGame diagnostic identity", "EndEngineServerMultiplayerGameCallback", 1, false, "\"engines/server.EndMultiplayerGame() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["CreateFakeClientWithOptions exception boundary", "CreateEngineServerFakeClientWithOptionsCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["CreateFakeClientWithOptions preparation boundary", "CreateEngineServerFakeClientWithOptionsCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["CreateFakeClientWithOptions diagnostic identity", "CreateEngineServerFakeClientWithOptionsCallback", 1, false, "\"engines/server.CreateFakeClientWithOptions() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["GetLaunchOptions exception boundary", "GetEngineServerLaunchOptionsCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetLaunchOptions preparation boundary", "GetEngineServerLaunchOptionsCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["GetLaunchOptions diagnostic identity", "GetEngineServerLaunchOptionsCallback", 1, false, "\"engines/server.GetLaunchOptions() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["User-ID query exception boundary", "QueryEngineServerUserIDStateCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["User-ID query preparation boundary", "QueryEngineServerUserIDStateCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["User-ID query diagnostic identity", "QueryEngineServerUserIDStateCallback", 1, false, "\"engines/server user-ID operation failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["Fake-client creation availability preservation", "CreateEngineServerFakeClientWithOptions", 1, false, "\n\t\tif constexpr (", "\n\t\tbIsFakeClientWithOptionsCreationAPIAvailableOut = false;\n\n\t\tif constexpr ("],
	["Fake-client creation availability commit", "CreateEngineServerFakeClientWithOptions", 1, false, "auto* const pFakeClientEdict = pEngineServer->CreateFakeClientEx(strFakeClientName.c_str(), bReportFakeClient);", "bIsFakeClientWithOptionsCreationAPIAvailableOut = true;\n\t\t\tauto* const pFakeClientEdict = pEngineServer->CreateFakeClientEx(strFakeClientName.c_str(), bReportFakeClient);"],
	["Launch-options lookup availability preservation", "GetEngineServerLaunchOptions", 1, false, "\n\t\tif constexpr (", "\n\t\tbIsLaunchOptionsAPIAvailableOut = false;\n\n\t\tif constexpr ("],
	["Launch-options lookup availability commit", "GetEngineServerLaunchOptions", 1, false, "auto* const pLaunchOptions = pEngineServer->GetLaunchOptions();", "bIsLaunchOptionsAPIAvailableOut = true;\n\t\t\tauto* const pLaunchOptions = pEngineServer->GetLaunchOptions();"],
	["User-ID output preservation", "IsEngineServerUserIDInUse", 1, false, "\n\t\tif constexpr (", "\n\t\tbIsUserIDInUseOut = false;\n\n\t\tif constexpr ("],
	["Log-state output preservation", "IsEngineServerLogEnabled", 1, false, "\n\t\tif constexpr (", "\n\t\tbIsLogEnabledOut = false;\n\n\t\tif constexpr ("],
	["Presence failure", "GetTraceTypeFromObject", 1, false, "if (LocalPropertyValue.IsEmpty())", "if (false)"],
	["Index error identity", "GetEntityIndexFromValue", 1, false, "IndexTryCatch.ReThrow();", "IndexTryCatch.Reset();"],
	["Ignore transaction", "CollectTraceIgnoredEntityIndexes", 1, false, "vecIgnoredEntityIndexesOut = std::move(vecIgnoredEntityIndexes);", "vecIgnoredEntityIndexesOut.clear();"],
	["Native enum validity", "TraceFilter::TraceFilter", 1, true, "if (!IsSupportedEngineTraceType(nTraceType))", "if (false)"],
	["Filter fail-stop", "ShouldHitEntity", 2, false, "if (!m_bValid)", "if (false)"],
	["Filter result diagnostic", "ShouldHitEntity", 2, false, "CallbackTryCatch.ReThrow();", "CallbackTryCatch.Reset();"],
	["Enumerator fail-stop", "EnumEntity", 2, false, "if (!m_bValid)", "if (false)"],
	["Enumerator getter identity", "EntityEnumerator::EntityEnumerator", 1, true, "MethodLookupFailure.ReThrow();", "MethodLookupFailure.Reset();"],
	["Point contents transaction", "TryGetEngineTracePointContents", 1, false, "ppHandleEntityOut ? &pHandleEntity : nullptr", "ppHandleEntityOut"],
	["Sound precache exception boundary", "PrecacheSoundCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Sound query exception boundary", "IsSoundPrecachedCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Sound prefetch exception boundary", "PrefetchSoundCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Sound looping exception boundary", "IsLoopingSoundCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Sound duration exception boundary", "GetSoundDurationCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Sound emit exception boundary", "EmitSoundCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Sound stop exception boundary", "StopSoundCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Sound emit entity getter identity", "EmitSoundCallback", 1, false, "IndexLookupFailure.ReThrow();", "IndexLookupFailure.Reset();"],
	["Sound stop entity getter identity", "StopSoundCallback", 1, false, "IndexLookupFailure.ReThrow();", "IndexLookupFailure.Reset();"],
	["Sound recipients lookup fail-stop", "EmitSoundCallback", 1, false, "if (LocalRecipientsValue.IsEmpty())", "if (false)"],
	["Sound origin lookup fail-stop", "EmitSoundCallback", 1, false, "if (LocalOriginValue.IsEmpty())", "if (false)"],
	["Sound direction lookup fail-stop", "EmitSoundCallback", 1, false, "if (LocalDirectionValue.IsEmpty())", "if (false)"],
	["Sound origins lookup fail-stop", "EmitSoundCallback", 1, false, "if (LocalOriginListValue.IsEmpty())", "if (false)"],
	["Sound looping exception propagation", "TryGetEngineSoundLoopingState", 1, false, "bool& bIsLoopingOut) {", "bool& bIsLoopingOut) noexcept {"],
	["Sound room exception boundary", "SetSoundRoomTypeCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Sound DSP exception boundary", "SetPlayerDSPCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Sound gain exception boundary", "GetDistanceGainFromSoundLevelCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Sound sentence exception boundary", "PrecacheSoundSentenceGroupCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Point query exception boundary", "GetPointContentsCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Point position error identity", "GetPointContentsCallback", 1, false, "PositionLookupFailure.ReThrow();", "PositionLookupFailure.Reset();"],
	["Point entity exception propagation", "GetTraceEntityIndexFromHandle", 1, false, "pHandleEntity) {", "pHandleEntity) noexcept {"],
	["Sound gain minimum", "GetDistanceGainFromSoundLevelCallback", 1, false, "nSoundLevel < kMinimumSoundLevel", "false"],
	["Sound gain maximum", "GetDistanceGainFromSoundLevelCallback", 1, false, "nSoundLevel > kMaximumSoundLevel", "false"],
	["Optional sound flag type", "ReadOptionalEngineBooleanArgument", 1, false, "if (!LocalOptionalBooleanValue->IsBoolean())", "if (false)"],
	["Collideable point exception boundary", "GetPointContentsOfCollideableCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Trace ray exception boundary", "TraceRayCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Entity ray clip exception boundary", "ClipRayToEntityCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Collideable ray clip exception boundary", "ClipRayToCollideableCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Entity enumeration exception boundary", "EnumerateEntitiesCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Box enumeration exception boundary", "EnumerateEntitiesInBoxCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Collideable lookup exception boundary", "GetCollideableCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Trace ray error identity", "TraceRayCallback", 1, false, "RayLookupFailure.ReThrow();", "RayLookupFailure.Reset();"],
	["Entity ray error identity", "ClipRayToEntityCallback", 1, false, "RayLookupFailure.ReThrow();", "RayLookupFailure.Reset();"],
	["Collideable ray error identity", "ClipRayToCollideableCallback", 1, false, "RayLookupFailure.ReThrow();", "RayLookupFailure.Reset();"],
	["Enumeration ray error identity", "EnumerateEntitiesCallback", 1, false, "RayLookupFailure.ReThrow();", "RayLookupFailure.Reset();"],
	["Collideable position error identity", "GetPointContentsOfCollideableCallback", 1, false, "PositionLookupFailure.ReThrow();", "PositionLookupFailure.Reset();"],
	["Minimum bounds error identity", "EnumerateEntitiesInBoxCallback", 1, false, "MinimumBoundsLookupFailure.ReThrow();", "MinimumBoundsLookupFailure.Reset();"],
	["Maximum bounds error identity", "EnumerateEntitiesInBoxCallback", 1, false, "MaximumBoundsLookupFailure.ReThrow();", "MaximumBoundsLookupFailure.Reset();"],
	["Collideable point entity error identity", "GetPointContentsOfCollideableCallback", 1, false, "EntityLookupFailure.ReThrow();", "EntityLookupFailure.Reset();"],
	["Entity clip lookup error identity", "ClipRayToEntityCallback", 1, false, "EntityLookupFailure.ReThrow();", "EntityLookupFailure.Reset();"],
	["Collideable clip lookup error identity", "ClipRayToCollideableCallback", 1, false, "EntityLookupFailure.ReThrow();", "EntityLookupFailure.Reset();"],
	["Collideable Index error identity", "GetCollideableCallback", 1, false, "IndexLookupFailure.ReThrow();", "IndexLookupFailure.Reset();"],
	["Handle lookup exception propagation", "GetTraceHandleEntityFromValue", 1, false, "LocalValue) {", "LocalValue) noexcept {"],
	["Collideable lookup exception propagation", "GetTraceCollideableFromValue", 1, false, "LocalValue) {", "LocalValue) noexcept {"],
	["Handle lookup invalid Index", "GetTraceHandleEntityFromValue", 1, false, "if (nEntityIndex < kMinimumEntityIndex)", "if (false)"],
	["Collideable lookup invalid Index", "GetTraceCollideableFromValue", 1, false, "if (nEntityIndex < kMinimumEntityIndex)", "if (false)"],
	["Minimum bounds call layout", "EnumerateEntitiesInBoxCallback", 1, false, "OrderedMinimumBounds = Vector(", "OrderedMinimumBounds = Vector(\n"],
	["Maximum bounds call layout", "EnumerateEntitiesInBoxCallback", 1, false, "OrderedMaximumBounds = Vector(", "OrderedMaximumBounds = Vector(\n"],
	["Trace result handle exception propagation", "GetTraceEntityIndexFromGameTrace", 1, false, "TraceInformation) {", "TraceInformation) noexcept {"],
	["IsPointOutsideWorldCallback exception boundary", "IsPointOutsideWorldCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetLeafContainingPointCallback exception boundary", "GetLeafContainingPointCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["SweepCollideableCallback exception boundary", "SweepCollideableCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["IsDedicatedServerCallback exception boundary", "IsDedicatedServerCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEngineServerEntityCountCallback exception boundary", "GetEngineServerEntityCountCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEngineServerMaximumClientsCallback exception boundary", "GetEngineServerMaximumClientsCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEngineServerMaximumEntitiesCallback exception boundary", "GetEngineServerMaximumEntitiesCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEngineServerCountCallback exception boundary", "GetEngineServerCountCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEngineServerTimeCallback exception boundary", "GetEngineServerTimeCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEngineServerTickCallback exception boundary", "GetEngineServerTickCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEngineServerTickIntervalCallback exception boundary", "GetEngineServerTickIntervalCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEngineServerMapNameCallback exception boundary", "GetEngineServerMapNameCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEngineServerGameDirectoryCallback exception boundary", "GetEngineServerGameDirectoryCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEngineServerClientCVarValueCallback exception boundary", "GetEngineServerClientCVarValueCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["IsPointOutsideWorldCallback position error", "IsPointOutsideWorldCallback", 1, false, "PositionLookupFailure.ReThrow();", "PositionLookupFailure.Reset();"],
	["GetLeafContainingPointCallback position error", "GetLeafContainingPointCallback", 1, false, "PositionLookupFailure.ReThrow();", "PositionLookupFailure.Reset();"],
	["Sweep StartPosition error", "SweepCollideableCallback", 1, false, "StartPositionLookupFailure.ReThrow();", "StartPositionLookupFailure.Reset();"],
	["Sweep EndPosition error", "SweepCollideableCallback", 1, false, "EndPositionLookupFailure.ReThrow();", "EndPositionLookupFailure.Reset();"],
	["Sweep Angles error", "SweepCollideableCallback", 1, false, "AnglesLookupFailure.ReThrow();", "AnglesLookupFailure.Reset();"],
	["Sweep entity error", "SweepCollideableCallback", 1, false, "EntityLookupFailure.ReThrow();", "EntityLookupFailure.Reset();"],
	["Client CVar Index error", "GetEngineServerClientCVarValueCallback", 1, false, "IndexLookupFailure.ReThrow();", "IndexLookupFailure.Reset();"],
	["Required edict getter error", "RequireEngineEdictArgument", 1, false, "EntityLookupFailure.ReThrow();", "EntityLookupFailure.Reset();"],
	["Server count output transaction", "GetGlobalServerCount", 1, false, "if (!pIsolate || !pGlobalVariables)", "nServerCountOut = 0;\n\t\tif (!pIsolate || !pGlobalVariables)"],
	["Change level exception boundary", "ChangeEngineServerLevelCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Precache check exception boundary", "CheckEnginePrecacheCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Cluster origin exception boundary", "GetEngineServerClusterForOriginCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Cluster PVS exception boundary", "GetEngineServerPVSForClusterCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Origin PVS exception boundary", "CheckEngineServerOriginInPVSCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Box PVS exception boundary", "CheckEngineServerBoxInPVSCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Cluster Origin error identity", "GetEngineServerClusterForOriginCallback", 1, false, "OriginLookupFailure.ReThrow();", "OriginLookupFailure.Reset();"],
	["Cluster Origin diagnostic context", "GetEngineServerClusterForOriginCallback", 1, false, "RequireVectorFromValue(pIsolate, LocalContext, LocalOriginValue, kOriginErrorMessage, Origin)", "RequireTraceVectorFromValue(pIsolate, LocalContext, LocalOriginValue, Origin)"],
	["Cluster count output transaction", "GetEngineServerClusterCount", 1, false, "if (!pIsolate || !pEngineServer || !pszOperationName)", "nClusterCountOut = 0;\n\t\tif (!pIsolate || !pEngineServer || !pszOperationName)"],
	["PVS byte count output transaction", "GetEngineServerPVSByteCount", 1, false, "if (!pIsolate || !pEngineServer)", "nPVSByteCountOut = 0;\n\t\tif (!pIsolate || !pEngineServer)"],
	["Multicast exception boundary", "GetEngineServerMulticastRecipientsCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Reset PVS exception boundary", "ResetEngineServerPVSCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Add PVS origin exception boundary", "AddOriginToEngineServerPVSCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Area portal exception boundary", "SetEngineServerAreaPortalStateCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Head-node visibility exception boundary", "IsEngineServerHeadNodeVisibleCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Area connectivity exception boundary", "AreEngineServerAreasConnectedCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Area origin exception boundary", "GetEngineServerAreaForOriginCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Area-state partial output", "GetEngineServerAreaBits", 1, false, "vecAreaStateBytes.data()", "vecAreaStateBytesOut.data()"],
	["Area-state initial bytes", "GetEngineServerAreaBits", 1, false, "vecAreaStateBytes = vecAreaStateBytesOut", "vecAreaStateBytes = std::vector<unsigned char>(vecAreaStateBytesOut.size())"],
	["Area connectivity failure output", "CheckEngineServerAreasConnected", 1, false, "if (!pIsolate || !pEngineServer)", "bAreAreasConnectedOut = false;\n\t\tif (!pIsolate || !pEngineServer)"],
	["Area connectivity nonzero result", "CheckEngineServerAreasConnected", 1, false, "!= 0", "== 1"],
	["Reset failed-status cleanup", "ResetEngineServerPVSCallback", 1, false, "vecAccumulatedPVSBytes.clear();", "vecAccumulatedPVSBytes.reserve(0);"],
	["Area bits exception boundary", "GetEngineServerAreaBitsCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Area plane exception boundary", "GetEngineServerAreaPortalPlaneCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Bulk portal exception boundary", "SetEngineServerAreaPortalStatesCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Game state exception boundary", "LoadEngineServerGameStateCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Adjacent entities exception boundary", "LoadEngineServerAdjacentEntitiesCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Text-message failure output", "GetEngineServerTextMessage", 1, false, "if (!pIsolate || !pEngineServer)", "bIsTextMessageAPIAvailableOut = false;\n\t\tif (!pIsolate || !pEngineServer)"],
	["Text-message early output", "GetEngineServerTextMessage", 1, false, "auto* const pClientTextMessage = pEngineServer->TextMessageGet", "bIsTextMessageAPIAvailableOut = true;\n\t\t\tauto* const pClientTextMessage = pEngineServer->TextMessageGet"],
	["Integer array partial output", "RequireEngineIntegerArrayFromValue", 1, false, "vecIntegerValues.push_back(nIntegerValue)", "vecIntegerValuesOut.push_back(nIntegerValue)"],
	["Boolean array partial output", "RequireEngineBooleanArrayFromValue", 1, false, "vecBooleanIntegerValues.push_back(nBooleanIntegerValue)", "vecBooleanIntegerValuesOut.push_back(nBooleanIntegerValue)"],
	["Undefined plane output", "GetEngineServerAreaPortalPlaneCallback", 1, false, "VPlane AreaPortalPlane = VPlane(Vector(kInitialPlaneComponent, kInitialPlaneComponent, kInitialPlaneComponent), kInitialPlaneComponent)", "VPlane AreaPortalPlane {}"],
	["GetTextMessage exception boundary", "GetEngineServerTextMessageCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetTextMessage preparation boundary", "GetEngineServerTextMessageCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["GetTextMessage diagnostic identity", "GetEngineServerTextMessageCallback", 1, false, "\"engines/server.GetTextMessage() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["GetPlayerInformation exception boundary", "GetEngineServerPlayerInformationCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetPlayerInformation preparation boundary", "GetEngineServerPlayerInformationCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["GetPlayerInformation diagnostic identity", "GetEngineServerPlayerInformationCallback", 1, false, "\"engines/server.GetPlayerInformation() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["PrintDeveloperOverlayLine exception boundary", "PrintEngineServerDeveloperOverlayLineCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["PrintDeveloperOverlayLine preparation boundary", "PrintEngineServerDeveloperOverlayLineCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["PrintDeveloperOverlayLine diagnostic identity", "PrintEngineServerDeveloperOverlayLineCallback", 1, false, "\"engines/server.PrintDeveloperOverlayLine() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["PrintDeveloperOverlayLineExtended exception boundary", "PrintEngineServerDeveloperOverlayLineExtendedCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["PrintDeveloperOverlayLineExtended preparation boundary", "PrintEngineServerDeveloperOverlayLineExtendedCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["PrintDeveloperOverlayLineExtended diagnostic identity", "PrintEngineServerDeveloperOverlayLineExtendedCallback", 1, false, "\"engines/server.PrintDeveloperOverlayLineExtended() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["Player Index getter identity", "GetEngineServerPlayerInformationCallback", 1, false, "if (!pIsolate->HasPendingException())", "if (true)"],
	["Player public diagnostic spelling", "GetEngineServerPlayerInformationCallback", 1, false, "engines/server.GetPlayerInformation(Player)", "engines/server.GetPlayerInfo(Player)"],
	["Client KeyValues exception boundary", "ExecuteEngineServerClientCommandKeyValuesCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Client KeyValues preparation boundary", "ExecuteEngineServerClientCommandKeyValuesCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["Client KeyValues diagnostic identity", "ExecuteEngineServerClientCommandKeyValuesCallback", 1, false, "\"engines/server.ExecuteClientCommandKeyValues() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["Client KeyValues Index fail-stop", "ExecuteEngineServerClientCommandKeyValuesCallback", 1, false, "if (pIsolate->HasPendingException())", "if (false)"],
	["Client KeyValues transfer order", "ExecuteEngineServerClientCommandKeyValues", 1, false, "ReleaseKeyValuesOwnershipToEngine(pNativeKeyValues)", "GetKeyValuesWithoutTransfer(pNativeKeyValues)"],
	["Transmit bits exception boundary", "GetEngineServerEntityTransmitBitsForClientCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Transmit bits preparation boundary", "GetEngineServerEntityTransmitBitsForClientCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["Transmit bits diagnostic identity", "GetEngineServerEntityTransmitBitsForClientCallback", 1, false, "\"engines/server.GetEntityTransmitBitsForClient() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["Transmit bits failure output", "GetEngineServerEntityTransmitBitsForClient", 1, false, "if (!pIsolate || !pEngineServer)", "bIsEntityTransmitBitsAPIAvailableOut = false;\n\t\tif (!pIsolate || !pEngineServer)"],
	["Transmit bits early commit", "GetEngineServerEntityTransmitBitsForClient", 1, false, "auto const* const pEntityTransmitBits =", "bIsEntityTransmitBitsAPIAvailableOut = true;\n\t\t\tauto const* const pEntityTransmitBits ="],
	["Notify edict exception boundary", "NotifyEngineServerEdictFlagsChangeCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Notify edict preparation boundary", "NotifyEngineServerEdictFlagsChangeCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["Notify edict diagnostic identity", "NotifyEngineServerEdictFlagsChangeCallback", 1, false, "\"engines/server.NotifyEdictFlagsChange() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["Notify edict Index getter identity", "NotifyEngineServerEdictFlagsChangeCallback", 1, false, "if (!pIsolate->HasPendingException())", "if (true)"],
	["Previous transmit exception boundary", "GetEngineServerPreviousCheckTransmitInformationCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["Previous transmit preparation boundary", "GetEngineServerPreviousCheckTransmitInformationCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["Previous transmit diagnostic identity", "GetEngineServerPreviousCheckTransmitInformationCallback", 1, false, "\"engines/server.GetPreviousCheckTransmitInformation() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["Previous transmit Index getter identity", "GetEngineServerPreviousCheckTransmitInformationCallback", 1, false, "if (!pIsolate->HasPendingException())", "if (true)"],
	["Previous transmit failure output", "GetEngineServerPreviousCheckTransmitInformation", 1, false, "if (!pIsolate || !pEngineServer || !pEntityEdict)", "bIsPreviousTransmitInformationAPIAvailableOut = false;\n\t\tif (!pIsolate || !pEngineServer || !pEntityEdict)"],
	["Previous transmit early commit", "GetEngineServerPreviousCheckTransmitInformation", 1, false, "auto const* const pPreviousTransmitInformation =", "bIsPreviousTransmitInformationAPIAvailableOut = true;\n\t\t\tauto const* const pPreviousTransmitInformation ="],
	["Transmit PVS storage capacity", "GetEngineServerPreviousCheckTransmitInformationCallback", 1, false, "sizeof(CCheckTransmitInfo::m_PVS)", "sizeof(void*)"],
	["Transmit areas storage capacity", "GetEngineServerPreviousCheckTransmitInformationCallback", 1, false, "sizeof(CCheckTransmitInfo::m_Areas)", "sizeof(void*)"],
	["Transmit flood storage capacity", "GetEngineServerPreviousCheckTransmitInformationCallback", 1, false, "sizeof(CCheckTransmitInfo::m_AreaFloodNums)", "sizeof(void*)"],
	["GetSharedEdictChangeInformation exception boundary", "GetEngineServerSharedEdictChangeInformationCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetSharedEdictChangeInformation preparation boundary", "GetEngineServerSharedEdictChangeInformationCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["GetSharedEdictChangeInformation diagnostic identity", "GetEngineServerSharedEdictChangeInformationCallback", 1, false, "\"engines/server.GetSharedEdictChangeInformation() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["GetEntityChangeAccessor exception boundary", "GetEngineServerEntityChangeAccessorCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["GetEntityChangeAccessor preparation boundary", "GetEngineServerEntityChangeAccessorCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["GetEntityChangeAccessor diagnostic identity", "GetEngineServerEntityChangeAccessorCallback", 1, false, "\"engines/server.GetEntityChangeAccessor() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["CreateSpatialPartition exception boundary", "CreateEngineServerSpatialPartitionCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["CreateSpatialPartition preparation boundary", "CreateEngineServerSpatialPartitionCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["CreateSpatialPartition diagnostic identity", "CreateEngineServerSpatialPartitionCallback", 1, false, "\"engines/server.CreateSpatialPartition() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["DestroySpatialPartition exception boundary", "DestroyEngineServerSpatialPartitionCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["DestroySpatialPartition preparation boundary", "DestroyEngineServerSpatialPartitionCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["DestroySpatialPartition diagnostic identity", "DestroyEngineServerSpatialPartitionCallback", 1, false, "\"engines/server.DestroySpatialPartition() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["DrawSpatialPartitionMapToScratchPad exception boundary", "DrawEngineServerSpatialPartitionMapToScratchPadCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["DrawSpatialPartitionMapToScratchPad preparation boundary", "DrawEngineServerSpatialPartitionMapToScratchPadCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["DrawSpatialPartitionMapToScratchPad diagnostic identity", "DrawEngineServerSpatialPartitionMapToScratchPadCallback", 1, false, "\"engines/server.DrawSpatialPartitionMapToScratchPad() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["NotifySolidMoved exception boundary", "NotifyEngineServerSolidMovedCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["NotifySolidMoved preparation boundary", "NotifyEngineServerSolidMovedCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["NotifySolidMoved diagnostic identity", "NotifyEngineServerSolidMovedCallback", 1, false, "\"engines/server.NotifySolidMoved() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["NotifyTriggerMoved exception boundary", "NotifyEngineServerTriggerMovedCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["NotifyTriggerMoved preparation boundary", "NotifyEngineServerTriggerMovedCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["NotifyTriggerMoved diagnostic identity", "NotifyEngineServerTriggerMovedCallback", 1, false, "\"engines/server.NotifyTriggerMoved() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["BuildEntityClusterList exception boundary", "BuildEngineServerEntityClusterListCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["BuildEntityClusterList preparation boundary", "BuildEngineServerEntityClusterListCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["BuildEntityClusterList diagnostic identity", "BuildEngineServerEntityClusterListCallback", 1, false, "\"engines/server.BuildEntityClusterList() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["CleanUpEntityClusterList exception boundary", "CleanupEngineServerEntityClusterListCallback", 1, false, "catch (...)", "catch (std::bad_alloc const&)"],
	["CleanUpEntityClusterList preparation boundary", "CleanupEngineServerEntityClusterListCallback", 1, false, "try {", "try /* lost preparation boundary */ {"],
	["CleanUpEntityClusterList diagnostic identity", "CleanupEngineServerEntityClusterListCallback", 1, false, "\"engines/server.CleanUpEntityClusterList() failed with a native C++ exception.\"", "\"engines/server.OtherOperation() failed with a native C++ exception.\""],
	["NotifyTriggerMoved Index error", "NotifyEngineServerTriggerMovedCallback", 1, false, "if (!pIsolate->HasPendingException()) {", "if (true) {"],
	["BuildEntityClusterList Index error", "BuildEngineServerEntityClusterListCallback", 1, false, "if (!pIsolate->HasPendingException()) {", "if (true) {"],
	["PVS resolver Index error", "RequireEngineServerPVSInformationFromValue", 1, false, "if (pIsolate->HasPendingException()) {", "if (false) {"],
	["PVS resolver fail-stop ordering", "RequireEngineServerPVSInformationFromValue", 1, false, "const int nEntityIndex = GetValueIndex(pIsolate, LocalContext, LocalPVSInformationValue);", "const int nEntityIndex = GetValueIndex(pIsolate, LocalContext, LocalPVSInformationValue);\n\t\tGetEdictFromEntityIndex(nEntityIndex);"],
	["GetEngineServerSharedEdictChangeInformation failure output", "GetEngineServerSharedEdictChangeInformation", 1, false, "if (!pIsolate || !pEngineServer)", "bIsSharedEdictChangeInformationAPIAvailableOut = false;\n\t\tif (!pIsolate || !pEngineServer)"],
	["GetEngineServerSharedEdictChangeInformation early commit", "GetEngineServerSharedEdictChangeInformation", 1, false, "auto* const pSharedEdictChangeInformation =", "bIsSharedEdictChangeInformationAPIAvailableOut = true;\n\t\t\tauto* const pSharedEdictChangeInformation ="],
	["GetEngineServerEntityChangeAccessor failure output", "GetEngineServerEntityChangeAccessor", 1, false, "if (!pIsolate || !pEngineServer || !pEntityEdict)", "bIsChangeAccessorAPIAvailableOut = false;\n\t\tif (!pIsolate || !pEngineServer || !pEntityEdict)"],
	["GetEngineServerEntityChangeAccessor early commit", "GetEngineServerEntityChangeAccessor", 1, false, "auto* const pChangeInformationAccessor =", "bIsChangeAccessorAPIAvailableOut = true;\n\t\t\tauto* const pChangeInformationAccessor ="],
	["CreateEngineServerSpatialPartition failure output", "CreateEngineServerSpatialPartition", 1, false, "if (!pIsolate || !pEngineServer)", "bIsSpatialPartitionCreationAPIAvailableOut = false;\n\t\tif (!pIsolate || !pEngineServer)"],
	["CreateEngineServerSpatialPartition early commit", "CreateEngineServerSpatialPartition", 1, false, "auto* const pSpatialPartition =", "bIsSpatialPartitionCreationAPIAvailableOut = true;\n\t\t\tauto* const pSpatialPartition ="],
	["Change accessor Index getter identity", "GetEngineServerEntityChangeAccessorCallback", 1, false, "if (!pIsolate->HasPendingException())", "if (true)"],
	["Solid moved Index getter identity", "NotifyEngineServerSolidMovedCallback", 1, false, "if (!pIsolate->HasPendingException())", "if (true)"],
];

for (const vecMutation of g_vecMutations) {
	const strBody = GetBody(g_strSource, vecMutation[1], vecMutation[2], vecMutation[3]);
	g_Assert.equal(ReplaceBody(g_strSource, vecMutation[1], strBody, vecMutation[2], vecMutation[3]), g_strSource, vecMutation[0] + ": unmodified body view must round-trip exactly.");

	// Boundary controls target the outer catch, not a nested getter-preservation catch.
	const strTarget = (vecMutation[4] === "catch (...)") ? "\n" + "\t".repeat(vecMutation[2] + 1) + "} catch (...)" : vecMutation[4];
	const strReplacement = (vecMutation[4] === "catch (...)") ? strTarget.replace(vecMutation[4], vecMutation[5]) : vecMutation[5];
	g_Assert(strBody.includes(strTarget), vecMutation[0] + ": mutation target missing.");

	const strMutatedBody = strBody.replace(strTarget, () => strReplacement);
	const strMutatedSource = ReplaceBody(g_strSource, vecMutation[1], strMutatedBody, vecMutation[2], vecMutation[3]);
	g_Assert.notEqual(strMutatedSource, g_strSource, vecMutation[0] + ": mutation must modify the actual source region.");
	g_Assert.throws(() => VerifyContracts(strMutatedSource), g_Assert.AssertionError, vecMutation[0] + ": accepted regression.");
}

console.log("Trace/sound callback source contracts passed: " + (g_vecMutations.length + g_unEngineMutationCount) + " rejected mutations; native execution is checked separately.");
