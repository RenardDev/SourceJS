"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks source contracts without executing native IO or V8/threads.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strRepositoryRoot = g_Path.resolve(__dirname, "..");
const g_strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRoot, "src/sourcejs/V8Runtime.cpp"), "utf8");
const g_strBuildSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRoot, "cmake/SourceJSPackage.cmake"), "utf8");
const g_strBindingsSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8");

function GetMethod(strSource, strBegin, strEnd) {
	const vecBegins = [strBegin, "\t" + strBegin];
	const strActualBegin = vecBegins.find((strCandidate) => strSource.startsWith(strCandidate) || strSource.includes("\n" + strCandidate));
	g_Assert.ok(strActualBegin, "Native method start must have exact namespace indentation.");

	const nBegin = strSource.startsWith(strActualBegin) ? 0 : (strSource.indexOf("\n" + strActualBegin) + 1);
	let strActualEnd = strEnd;
	if (strActualBegin !== strBegin) {
		strActualEnd = strEnd.startsWith("\n") ? ("\n\t" + strEnd.slice(1)) : ("\t" + strEnd);
	}

	const nEnd = strSource.indexOf(strActualEnd, nBegin + strActualBegin.length);
	g_Assert.ok((nBegin >= 0) && (nEnd > nBegin), "Native method boundaries must exist.");

	return strSource.slice(nBegin, nEnd);
}

// Source guards complement native V8/thread execution; they do not prove engine IO or lifecycle.
function CheckContracts(strRuntimeSource, strBuildSource) {
	const strPump = GetMethod(strRuntimeSource, "\tvoid V8Runtime::ProcessAsyncRequests() {", "\tvoid V8Runtime::RunAsyncRequest(");
	const strDelivery = GetMethod(strRuntimeSource, "\tbool V8Runtime::DeliverAsyncRequest(", "\tbool V8Runtime::WaitForAsyncRequest(");
	const strWait = GetMethod(strRuntimeSource, "\tbool V8Runtime::WaitForAsyncRequest(", "\tvoid V8Runtime::ProcessAsyncRequests() {");
	const strQueue = GetMethod(strRuntimeSource, "\tbool V8Runtime::QueueAsyncRequestRecord(", "\tbool V8Runtime::DeliverAsyncRequest(");
	const strBlocking = GetMethod(strRuntimeSource, "\tbool V8Runtime::RunRequestOnDedicatedThread(", "\tbool V8Runtime::RunBlockingRequest(");
	const strBlockingCallback = GetMethod(strRuntimeSource, "\tbool V8Runtime::RunBlockingRequest(", "\tbool V8Runtime::QueueAsyncRequestRecord(");
	const strQueuedCallback = GetMethod(strRuntimeSource, "\tbool V8Runtime::QueueAsyncRequest(", "\tbool V8Runtime::QueueAsyncTask(");
	const strStop = GetMethod(strRuntimeSource, "\tvoid V8Runtime::StopAsyncRequests() {", "\tvoid V8Runtime::RemoveAsyncRequestsForContext(");
	const strCleanup = GetMethod(strRuntimeSource, "\tvoid V8Runtime::ConsumeAsyncRequestResult(", "\tvoid V8Runtime::RunBlockingAsyncRequest(");
	const strWorker = GetMethod(strRuntimeSource, "\tvoid V8Runtime::RunAsyncRequest(", "\tvoid V8Runtime::StopAsyncRequests() {");
	const strReap = GetMethod(strRuntimeSource, "\tvoid V8Runtime::ReapAsyncRequests() {", "\tbool V8Runtime::RunBlockingRequest(");
	for (const strAdmission of [strQueuedCallback, strBlockingCallback]) {
		g_Assert.match(strAdmission, /const bool bRootContext = !m_V8Context.IsEmpty\(\) && \(m_V8Context.Get\(m_pIsolate\) == LocalContext\);/);
		g_Assert.match(strAdmission, /if \(!bRootContext && !FindPluginRuntimeRecord\(LocalContext\)\) \{\s*return false;/);
		const nOwnershipGuard = strAdmission.indexOf("if (!bRootContext && !FindPluginRuntimeRecord(LocalContext))");
		const nFirstRequestOperation = strAdmission.includes("AsyncRequestCallbackRecord CallbackRecord") ? strAdmission.indexOf("AsyncRequestCallbackRecord CallbackRecord") : strAdmission.indexOf("AsyncRequestRecord RequestRecord");
		g_Assert.ok((nOwnershipGuard >= 0) && (nFirstRequestOperation >= 0) && (nOwnershipGuard < nFirstRequestOperation), "Reject a removed calling context before callback retention or worker startup.");
	}

	g_Assert.match(strPump, /for \(auto\* pCompletionRecord = m_pFirstAsyncCompletion; pCompletionRecord; pCompletionRecord = pCompletionRecord->m_pNextCompletion\) \{\s*\+\+unCompletionCount;/);
	g_Assert.match(strPump, /for \(std::size_t unCompletionIndex = 0; unCompletionIndex < unCompletionCount; \+\+unCompletionIndex\)/);
	g_Assert.ok(strPump.indexOf("++unCompletionCount;") < strPump.indexOf("DeliverAsyncRequest(pCompletionRecord);"), "Snapshot completion count before delivery.");
	g_Assert.match(strDelivery, /AsyncRequestCallbackRecord CallbackRecord \{\};/);
	g_Assert.match(strDelivery, /CallbackRecord = std::move\(itAsyncCallback->second\);\s*m_mapAsyncRequestCallbacks.erase\(itAsyncCallback\);/);
	g_Assert.ok(strDelivery.indexOf("m_mapAsyncRequestCallbacks.erase(itAsyncCallback);") < strDelivery.indexOf("std::rethrow_exception"), "Own and unregister callbacks before exception formatting can throw.");
	g_Assert.match(strWait, /m_Context.Get\(m_pIsolate\) == LocalContext/);
	g_Assert.match(strWait, /m_Function.Get\(m_pIsolate\) == LocalCallbackFunction/);
	g_Assert.match(strWait, /pSelectedRequest->m_bResultReady.wait\(false\);/);
	g_Assert.ok(strWait.indexOf("m_bResultReady.wait(false);") < strWait.indexOf("std::lock_guard"), "Wait for the selected result without the completion mutex.");
	g_Assert.match(strWait, /return DeliverAsyncRequest\(pSelectedRequest\);/);
	for (const strCallbackDelivery of [strDelivery, strBlockingCallback]) {
		g_Assert.match(strCallbackDelivery, /constexpr int kCallbackArgumentCount = 2;/);
		g_Assert.match(strCallbackDelivery, /if \(!bConverted \|\| CallbackTryCatch.HasCaught\(\)\) \{/);
		g_Assert.match(strCallbackDelivery, /if \(!strError.empty\(\)\) \{\s*LocalResultValue = v8::Undefined\(m_pIsolate\);/);
		g_Assert.match(strCallbackDelivery, /Call\(LocalContext, LocalContext->Global\(\), kCallbackArgumentCount, arrCallbackArguments\)/);
	}

	g_Assert.match(strQueue, /std::thread\(&V8Runtime::RunAsyncRequest, this, pRequestRecord\)/);
	g_Assert.match(strBlocking, /std::thread RequestThread\(\[Task, &RequestResult\]/);
	g_Assert.match(strBlocking, /RequestThread.join\(\);/);
	g_Assert.match(strStop, /m_bAcceptAsyncRequests = false;/);
	g_Assert.match(strStop, /m_Thread.join\(\);/);
	g_Assert.doesNotMatch(strPump + strWait + strDelivery, /m_Thread.join\(/, "Main-frame delivery never waits for native cleanup.");
	g_Assert.match(strDelivery, /m_lstActiveAsyncRequests.splice\(m_lstActiveAsyncRequests.end\(\), m_lstAsyncRequests, itAsyncRequest\);/);
	g_Assert.match(strDelivery, /AsyncRequestCompletionScope CompletionScope\(this, pCompletionRecord\);/);
	g_Assert.ok(strDelivery.indexOf("AsyncRequestCompletionScope CompletionScope") < strDelivery.indexOf("AsyncRequestCallbackRecord CallbackRecord"), "Callback/converter captures die before worker consumption acknowledgement.");
	g_Assert.match(strCleanup, /m_bResultConsumed.wait\(false\);\s*pRequestRecord->m_Result = \{\};\s*pRequestRecord->m_Task = \{\};\s*pRequestRecord->m_bCleanupComplete.store\(true\);/);
	g_Assert.match(strWorker, /m_bResultReady.store\(true\);/);
	g_Assert.match(strWorker, /ConsumeAsyncRequestResult\(pRequestRecord\);/);
	g_Assert.doesNotMatch(strWorker, /m_Task = \{\}/, "Task retains native owners through converter teardown.");
	g_Assert.match(strBlockingCallback, /std::thread\(&V8Runtime::RunBlockingAsyncRequest, &RequestRecord\)/);
	g_Assert.match(strBlockingCallback, /AsyncRequestCompletionScope CompletionScope\(nullptr, &RequestRecord\);\s*RequestRecord.m_bResultReady.wait\(false\);/);
	g_Assert.match(strReap, /if \(!\(\*itAsyncRequest\)->m_bCleanupComplete.load\(\)\) \{\s*\+\+itAsyncRequest;\s*continue;/);
	g_Assert.match(strStop, /m_mapAsyncRequestCallbacks.clear\(\);/);
	g_Assert.ok(strStop.indexOf("m_mapAsyncRequestCallbacks.clear();") < strStop.indexOf("m_bResultConsumed.store(true);"), "Shutdown releases converter captures before worker cleanup acknowledgement.");
	g_Assert.match(strBuildSource, /v8_build_config\.json/);
	g_Assert.match(strBuildSource, /CMAKE_CONFIGURE_DEPENDS/);
	g_Assert.match(strBuildSource, /pointer_compression\s+pointer_compression_shared_cage\s+sandbox\s+direct_handle/);
	g_Assert.match(strBuildSource, /V8_COMPRESS_POINTERS\s+V8_COMPRESS_POINTERS_IN_SHARED_CAGE\s+V8_ENABLE_SANDBOX\s+V8_ENABLE_DIRECT_HANDLE/);
	g_Assert.match(strBuildSource, /string\(JSON strFeatureType ERROR_VARIABLE strFeatureError TYPE/);
	g_Assert.match(strBuildSource, /if\(NOT strFeatureType STREQUAL "BOOLEAN"\)/);
	g_Assert.match(strBuildSource, /if\(bFeatureEnabled\)\s*target_compile_definitions\(\$\{strTargetName\} PRIVATE "\$\{strDefinition\}"\)/);
}

function CheckAdapterContracts(strBindingsSource) {
	const strMode = GetMethod(strBindingsSource, "\tstruct AsyncRequestExecutionMode {", "\tbool ParseAsyncRequestExecutionMode(");
	const strAdapter = GetMethod(strBindingsSource, "\tbool RunAsyncRequest(", "\n\t}\n");
	const strFailure = GetMethod(strBindingsSource, "\tvoid RethrowV8InstallationFailure(", "\n\t}\n");
	g_Assert.match(strMode, /AsyncRequestExecutionMode::AsyncRequestExecutionMode\(void\) \{\s*m_bBlocking = false;\s*\}/);
	g_Assert.match(strAdapter, /v8::TryCatch AsyncFailure\(pIsolate\);\s*try \{/);
	g_Assert.match(strAdapter, /if \(!pRuntime->GetCurrentPluginName\(pIsolate, strPluginName\) \|\| AsyncFailure.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)\) \{\s*RethrowV8InstallationFailure\(pIsolate, AsyncFailure, pszRequestFailureErrorMessage\);\s*return false;\s*\}/);
	g_Assert.ok(strAdapter.indexOf("GetCurrentPluginName") < strAdapter.indexOf("auto Task ="), "Validate the context before creating or submitting backend work.");
	g_Assert.match(strAdapter, /\[Operation = std::move\(Operation\)\]\(\) mutable -> AsyncRequestResult/);
	g_Assert.match(strFailure, /if \(pszFallbackErrorMessage && !InstallationFailure.HasCaught\(\) && !pIsolate->IsExecutionTerminating\(\) && !pIsolate->HasPendingException\(\)\) \{\s*ThrowError\(pIsolate, pszFallbackErrorMessage\);\s*\}/);
	g_Assert.match(strFailure, /if \(InstallationFailure.HasCaught\(\)\) \{\s*InstallationFailure.ReThrow\(\);\s*\}/);
}

function CheckCommonJSContracts(strRuntimeSource, strBindingsSource) {
	// CommonJS entry points and module loading must share the external lowercase global name.
	g_Assert.match(strBindingsSource, /SetFunction\(pIsolate, LocalContext, LocalContext->Global\(\), "require", RequireCallback, LocalRuntimeData\)/);
	g_Assert.doesNotMatch(strBindingsSource, /SetFunction\(pIsolate, LocalContext, LocalContext->Global\(\), "Require", RequireCallback, LocalRuntimeData\)/);

	const vecRequireLookups = strRuntimeSource.match(/MakeRuntimeString\(m_pIsolate, "require", LocalRequirePropertyName\)/g) ?? [];
	g_Assert.equal(vecRequireLookups.length, 2, "Script execution and package loading must resolve the registered CommonJS global.");
}

CheckContracts(g_strRuntimeSource, g_strBuildSource);
CheckAdapterContracts(g_strBindingsSource.replace(/\r\n/g, "\n"));
CheckCommonJSContracts(g_strRuntimeSource, g_strBindingsSource);

const g_vecCommonJSMutations = [
	{ Bindings: true, Last: false, Needle: 'LocalContext->Global(), "require", RequireCallback', Replacement: 'LocalContext->Global(), "Require", RequireCallback' },
	{ Bindings: false, Last: false, Needle: 'MakeRuntimeString(m_pIsolate, "require", LocalRequirePropertyName)', Replacement: 'MakeRuntimeString(m_pIsolate, "Require", LocalRequirePropertyName)' },
	{ Bindings: false, Last: true, Needle: 'MakeRuntimeString(m_pIsolate, "require", LocalRequirePropertyName)', Replacement: 'MakeRuntimeString(m_pIsolate, "Require", LocalRequirePropertyName)' },
];
for (const Mutation of g_vecCommonJSMutations) {
	const strSource = Mutation.Bindings ? g_strBindingsSource : g_strRuntimeSource;
	const nOffset = Mutation.Last ? strSource.lastIndexOf(Mutation.Needle) : strSource.indexOf(Mutation.Needle);
	g_Assert.ok(nOffset >= 0, "CommonJS negative scenario must alter actual source.");
	const strMutatedSource = strSource.slice(0, nOffset) + Mutation.Replacement + strSource.slice(nOffset + Mutation.Needle.length);
	g_Assert.throws(() => CheckCommonJSContracts(Mutation.Bindings ? g_strRuntimeSource : strMutatedSource, Mutation.Bindings ? strMutatedSource : g_strBindingsSource), { name: "AssertionError" });
}

const g_vecMutations = [
	{ Build: false, Needle: "const bool bRootContext = !m_V8Context.IsEmpty() && (m_V8Context.Get(m_pIsolate) == LocalContext);", Replacement: "const bool bRootContext = true;" },
	{ Build: false, Needle: "if (!bRootContext && !FindPluginRuntimeRecord(LocalContext))", Replacement: "if (false)" },
	{ Build: false, Needle: "++unCompletionCount;", Replacement: "unCompletionCount += 0;" },
	{ Build: false, Needle: "unCompletionIndex < unCompletionCount", Replacement: "true" },
	{ Build: false, Needle: "std::thread(&V8Runtime::RunAsyncRequest, this, pRequestRecord)", Replacement: "std::thread()" },
	{ Build: false, Needle: "RequestThread.join();", Replacement: "RequestThread.detach();" },
	{ Build: false, Needle: "m_bAcceptAsyncRequests = false;", Replacement: "m_bAcceptAsyncRequests = true;" },
	{ Build: false, Needle: "CallbackRecord = std::move(itAsyncCallback->second);", Replacement: "CallbackRecord = {};" },
	{ Build: false, Needle: "m_mapAsyncRequestCallbacks.erase(itAsyncCallback);", Replacement: "m_mapAsyncRequestCallbacks.size();" },
	{ Build: false, Needle: "if (!bConverted || CallbackTryCatch.HasCaught())", Replacement: "if (!bConverted)" },
	{ Build: false, Needle: "LocalResultValue = v8::Undefined(m_pIsolate);", Replacement: "LocalResultValue = v8::Null(m_pIsolate);" },
	{ Build: false, Needle: "constexpr int kCallbackArgumentCount = 2;", Replacement: "constexpr int kCallbackArgumentCount = 1;" },
	{ Build: false, Needle: "m_Context.Get(m_pIsolate) == LocalContext", Replacement: "true" },
	{ Build: false, Needle: "m_Function.Get(m_pIsolate) == LocalCallbackFunction", Replacement: "true" },
	{ Build: false, Needle: "pSelectedRequest->m_bResultReady.wait(false);", Replacement: "pSelectedRequest->m_bResultReady.load();" },
	{ Build: false, Needle: "m_lstActiveAsyncRequests.splice(m_lstActiveAsyncRequests.end(), m_lstAsyncRequests, itAsyncRequest);", Replacement: "m_lstAsyncRequests.erase(itAsyncRequest);" },
	{ Build: false, Needle: "AsyncRequestCompletionScope CompletionScope(this, pCompletionRecord);", Replacement: "// Missing consumption owner." },
	{ Build: false, Needle: "pRequestRecord->m_bResultConsumed.wait(false);", Replacement: "pRequestRecord->m_bResultConsumed.load();" },
	{ Build: false, Needle: "pRequestRecord->m_Task = {};", Replacement: "// Retained forever." },
	{ Build: false, Needle: "ConsumeAsyncRequestResult(pRequestRecord);", Replacement: "// Missing worker cleanup." },
	{ Build: false, Needle: "std::thread(&V8Runtime::RunBlockingAsyncRequest, &RequestRecord)", Replacement: "std::thread()" },
	{ Build: false, Needle: "if (!(*itAsyncRequest)->m_bCleanupComplete.load())", Replacement: "if (false)" },
	{ Build: false, Needle: "m_mapAsyncRequestCallbacks.clear();", Replacement: "m_mapAsyncRequestCallbacks.size();" },
	{ Build: false, Needle: "return DeliverAsyncRequest(pSelectedRequest);", Replacement: "return true;" },
	{ Build: true, Needle: "v8_build_config.json", Replacement: "OtherConfiguration.json" },
	{ Build: true, Needle: "CMAKE_CONFIGURE_DEPENDS", Replacement: "OTHER_DEPENDENCY_PROPERTY" },
	{ Build: true, Needle: "V8_ENABLE_SANDBOX", Replacement: "V8_DISABLE_SANDBOX" },
	{ Build: true, Needle: 'strFeatureType STREQUAL "BOOLEAN"', Replacement: 'strFeatureType STREQUAL "STRING"' },
	{ Build: true, Needle: "if(bFeatureEnabled)", Replacement: "if(NOT bFeatureEnabled)" },
];
for (const Mutation of g_vecMutations) {
	const strSource = Mutation.Build ? g_strBuildSource : g_strRuntimeSource;
	g_Assert.ok(strSource.includes(Mutation.Needle), "Negative scenario must alter actual source.");
	const strMutatedSource = strSource.replaceAll(Mutation.Needle, Mutation.Replacement);
	g_Assert.throws(() => CheckContracts(Mutation.Build ? g_strRuntimeSource : strMutatedSource, Mutation.Build ? strMutatedSource : g_strBuildSource), { name: "AssertionError" }, Mutation.Needle);
}

const g_vecAdapterMutations = [
	{ Mode: true, Needle: "m_bBlocking = false;", Replacement: "m_bBlocking = true;" },
	{ Mode: false, Needle: "!pRuntime->GetCurrentPluginName(pIsolate, strPluginName)", Replacement: "false" },
	{ Mode: false, Needle: "mutable -> AsyncRequestResult", Replacement: "mutable" },
	{ Mode: false, Needle: "v8::TryCatch AsyncFailure(pIsolate);", Replacement: "v8::TryCatch OtherFailure(pIsolate);" },
	{ Mode: false, Needle: "GetCurrentPluginName(pIsolate, strPluginName) || AsyncFailure.HasCaught()", Replacement: "GetCurrentPluginName(pIsolate, strPluginName)" },
	{ Mode: false, Needle: "RethrowV8InstallationFailure(pIsolate, AsyncFailure, pszRequestFailureErrorMessage);", Replacement: "ThrowError(pIsolate, pszRequestFailureErrorMessage);" },
];
for (const Mutation of g_vecAdapterMutations) {
	const strBindingsSource = g_strBindingsSource.replace(/\r\n/g, "\n");
	const strOwner = Mutation.Mode ? GetMethod(strBindingsSource, "\tstruct AsyncRequestExecutionMode {", "\tbool ParseAsyncRequestExecutionMode(") : GetMethod(strBindingsSource, "\tbool RunAsyncRequest(", "\n\t}\n");
	g_Assert.ok(strOwner.includes(Mutation.Needle), "Adapter negative scenario must alter its actual owner.");
	const strMutatedOwner = strOwner.replace(Mutation.Needle, Mutation.Replacement);
	const strMutatedSource = strBindingsSource.replace(strOwner, strMutatedOwner);
	g_Assert.throws(() => CheckAdapterContracts(strMutatedSource.replace(/\r\n/g, "\n")), { name: "AssertionError" });
}

const g_vecFailureMutations = [
	{ Needle: "!InstallationFailure.HasCaught()", Replacement: "true" },
	{ Needle: "!pIsolate->IsExecutionTerminating()", Replacement: "true" },
	{ Needle: "!pIsolate->HasPendingException()", Replacement: "true" },
	{ Needle: "InstallationFailure.ReThrow();", Replacement: "InstallationFailure.Reset();" },
];
for (const Mutation of g_vecFailureMutations) {
	const strBindingsSource = g_strBindingsSource.replace(/\r\n/g, "\n");
	const strOwner = GetMethod(strBindingsSource, "\tvoid RethrowV8InstallationFailure(", "\n\t}\n");
	g_Assert.ok(strOwner.includes(Mutation.Needle), "Failure negative scenario must alter its actual owner.");
	const strMutatedSource = strBindingsSource.replace(strOwner, strOwner.replace(Mutation.Needle, Mutation.Replacement));
	g_Assert.throws(() => CheckAdapterContracts(strMutatedSource), { name: "AssertionError" });
}

const g_unScenarioCount = g_vecCommonJSMutations.length + g_vecMutations.length + g_vecAdapterMutations.length + g_vecFailureMutations.length;
console.log(`Native async request source contracts passed, including ${g_unScenarioCount} negative scenarios (structural checks; no native IO or V8/thread execution).`);
