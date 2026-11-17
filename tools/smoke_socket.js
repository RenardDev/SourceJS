"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_socket.js\nChecks native source guards and executes socket documentation with Node doubles; no native socket IO or V8.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_socket.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

const g_strRepositoryRoot = g_Path.resolve(__dirname, "..");
const g_strBindingsPath = g_Path.join(g_strRepositoryRoot, "src/sourcejs/modules/ModuleBindings.cpp");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRoot, "docs/api/socket.md");

function ReadNativeFunction(strBindings, strSignature, bPreserveIndent = false) {
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecStarts = Array.from(strBindings.matchAll(new RegExp("^(\\t{1,2})" + strEscapedSignature + "\\([^;\\n]*\\)(?: const)?(?: noexcept)?(?: try)? \\{$", "gm")));
	g_Assert.equal(vecStarts.length, 1, `Missing or ambiguous native definition: ${strSignature}`);

	const vecStartMatch = vecStarts[0];
	const unStartIndex = vecStartMatch.index;
	const strEnd = "\n" + vecStartMatch[1] + "}";
	const nEndIndex = strBindings.indexOf(strEnd + "\n", unStartIndex + vecStartMatch[0].length);
	g_Assert(nEndIndex > unStartIndex, `Missing native function boundary: ${strSignature}`);

	const strDefinition = strBindings.slice(unStartIndex, nEndIndex + strEnd.length);
	if (!bPreserveIndent && (vecStartMatch[1].length === 2)) {
		return strDefinition.split("\n").map((strLine) => strLine.startsWith("\t") ? strLine.slice(1) : strLine).join("\n");
	}

	return strDefinition;
}

function VerifyNativeFunctionExtraction() {
	for (const strIndent of ["\t", "\t\t"]) {
		const strPrototype = strIndent + "bool SocketProbe();\n";
		const strDefinition = strIndent + "bool SocketProbe() noexcept {\n" + strIndent + "\treturn true;\n" + strIndent + "}";
		const strExpected = "\tbool SocketProbe() noexcept {\n\t\treturn true;\n\t}";
		g_Assert.equal(ReadNativeFunction(strPrototype + strDefinition + "\n", "bool SocketProbe"), strExpected);
		g_Assert.equal(ReadNativeFunction(strPrototype + strDefinition + "\n", "bool SocketProbe", true), strDefinition);
		g_Assert.throws(() => ReadNativeFunction(strPrototype, "bool SocketProbe"), g_Assert.AssertionError);
	}
}

// These source guards detect known regressions; they do not execute V8 or native IO.
function VerifyNativeSurface(strBindings) {
	const vecExports = Array.from(strBindings.matchAll(/SetFunction\(pIsolate, LocalContext, LocalSocketModule, "([^"]+)"/g), (vecMatch) => vecMatch[1]).sort();
	g_Assert.deepEqual(vecExports, ["CancelRequest", "Close", "Connect", "Receive", "Send"]);
	g_Assert.match(strBindings, /constexpr std::size_t kMaximumSocketTransferByteCount = 16 \* 1024 \* 1024;/);

	const strExecutionParser = ReadNativeFunction(strBindings, "bool ParseAsyncRequestExecutionMode");
	g_Assert.match(strExecutionParser, /LocalOptionsValue->IsObject\(\)/);
	g_Assert.match(strExecutionParser, /LocalOptionsValue->IsArray\(\)/);
	g_Assert.match(strExecutionParser, /LocalCallbackValue->IsFunction\(\)/);
	g_Assert.match(strExecutionParser, /ParseOptionalExternalBooleanProperty\([^\n]+bBlocking\)/);
	g_Assert.match(strExecutionParser, /ExecutionModeOut\.m_bBlocking = bBlocking;/);
	g_Assert.match(strExecutionParser, /v8::Local<v8::Function> const LocalCallbackFunction = LocalCallbackValue\.As<v8::Function>\(\);/);
	g_Assert.match(strExecutionParser, /if \(LocalCallbackFunction\.IsEmpty\(\) \|\| AsyncFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)\)/);
	g_Assert.match(strExecutionParser, /ExecutionModeOut\.m_CallbackFunction = LocalCallbackFunction;/);

	const strRunSocket = ReadNativeFunction(strBindings, "bool RunSocketRequest");
	g_Assert.match(strRunSocket, /NewFromUtf8Literal\(pIsolate, "Timeout"\)/);
	g_Assert.match(strRunSocket, /!GetIntegerFromValue\(LocalContext, LocalTimeout, nTimeoutMilliseconds\)/);
	g_Assert.match(strRunSocket, /RunAsyncRequest<TResult>/);
	g_Assert(strRunSocket.indexOf("RequireExternalPluginName") < strRunSocket.indexOf("RunAsyncRequest<TResult>"));
	g_Assert.match(ReadNativeFunction(strBindings, "void CancelSocketRequestCallback"), /pRequest->m_strPluginName == strPluginName/);

	const vecOperations = [
		{ Name: "Connect", RequiredCount: 2, ResultType: "bool" },
		{ Name: "Close", RequiredCount: 1, ResultType: "bool" },
		{ Name: "Send", RequiredCount: 2, ResultType: "std::size_t" },
		{ Name: "Receive", RequiredCount: 2, ResultType: "std::vector<char>" },
	];
	for (const Operation of vecOperations) {
		const strCallback = ReadNativeFunction(strBindings, `void ${Operation.Name}SocketCallback`);
		g_Assert(strCallback.includes(`kSocket${Operation.Name}RequiredArgumentCount = ${Operation.RequiredCount};`));
		g_Assert(strCallback.includes(`kSocket${Operation.Name}OptionalArgumentCount = 0;`));
		g_Assert.match(strCallback, /try \{[\s\S]+ParseAsyncRequestExecutionMode\(/);
		g_Assert.match(strCallback, /v8::TryCatch SocketFailure\(pIsolate\);\n\t\ttry \{/);
		g_Assert(strCallback.includes(`RunSocketRequest<${Operation.ResultType}>`));

		const nOperationStart = strCallback.indexOf("\n\t\t\tauto Operation = ");
		g_Assert(nOperationStart >= 0, `${Operation.Name} must queue a worker operation`);
		g_Assert.doesNotMatch(strCallback.slice(0, nOperationStart), /\b(?:send|recv|ConnectNativeSocket|CloseSocketConnection)\(/);
	}

	const strConnect = ReadNativeFunction(strBindings, "void ConnectSocketCallback");
	g_Assert(strConnect.includes("strHost.find('\\0') != std::string::npos"));
	g_Assert.match(strConnect, /GetIntegerFromValue\([^\n]+nPort\)/);
	g_Assert.match(strConnect, /nPort < kMinimumSocketPort/);
	g_Assert.match(strConnect, /nPort > kMaximumSocketPort/);
	g_Assert(strConnect.indexOf("strHost.find") < strConnect.indexOf("auto Operation ="));
	g_Assert.match(strConnect, /if \(LocalPortValue\.IsEmpty\(\) \|\| SocketFailure\.HasCaught\(\)/);
	g_Assert.match(strConnect, /if \(LocalConnectionHandle\.IsEmpty\(\) \|\| SocketResultFailure\.HasCaught\(\)/);
	g_Assert(strConnect.indexOf("LocalConnectionHandle.IsEmpty()") < strConnect.indexOf("GetSocketConnections().emplace("));
	g_Assert.doesNotMatch(strConnect, /GetSocketConnections\(\)\[/);

	const strRequireConnection = ReadNativeFunction(strBindings, "std::shared_ptr<SocketConnectionRecord> RequireSocketConnectionFromCallbackInformation");
	g_Assert.match(strRequireConnection, /v8::TryCatch SocketFailure\(pIsolate\);\n\t\ttry \{/);
	g_Assert.match(strRequireConnection, /if \(LocalSocketConnectionHandleValue\.IsEmpty\(\) \|\| SocketFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)\)/);
	g_Assert.match(strRequireConnection, /if \(!ParseExternalHandleFromValue\([^\n]+\) \|\| SocketFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)\) \{\n\t\t\t\tRethrowV8InstallationFailure\(pIsolate, SocketFailure, kMissingSocketConnectionHandleErrorMessage\);\n\t\t\t\treturn \{\};/);
	g_Assert.match(strRequireConnection, /if \(!RequireExternalPluginName\([^\n]+\) \|\| SocketFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)\)/);
	g_Assert.match(strRequireConnection, /catch \(std::exception const&\) \{\n\t\t\tRethrowV8InstallationFailure\(pIsolate, SocketFailure, kFailureErrorMessage\);\n\t\t\} catch \(\.\.\.\) \{\n\t\t\tRethrowV8InstallationFailure\(pIsolate, SocketFailure, kFailureErrorMessage\);/);
	g_Assert(strRequireConnection.indexOf("!ParseExternalHandleFromValue(") < strRequireConnection.indexOf("GetSocketConnections();"));
	g_Assert.doesNotMatch(strRequireConnection, /ThrowError\(|HandleTryCatch|std::(?:lock_guard|unique_lock)/);

	const strSend = ReadNativeFunction(strBindings, "void SendSocketCallback");
	g_Assert.match(strSend, /LocalDataValue->IsArray\(\)/);
	g_Assert.match(strSend, /LocalDataValue->IsArrayBufferView\(\)/);
	g_Assert.match(strSend, /LocalDataValue->IsArrayBuffer\(\)/);
	g_Assert.match(strSend, /!LocalByteValue->IsNumber\(\)/);
	g_Assert.match(strSend, /!std::isfinite\(dblByteValue\)/);
	g_Assert.match(strSend, /std::floor\(dblByteValue\) != dblByteValue/);
	g_Assert.match(strSend, /dblByteValue < kMinimumSocketByteValue/);
	g_Assert.match(strSend, /dblByteValue > kMaximumSocketByteValue/);
	g_Assert.match(strSend, /CopyContents\(vecDataBytes\.data\(\), unDataByteCount\)/);
	g_Assert.match(strSend, /std::memcpy\(vecDataBytes\.data\(\), pSourceBytes, unDataByteCount\);/);
	g_Assert.match(strSend, /vecDataBytes = std::move\(vecDataBytes\)/);
	g_Assert.match(strSend, /if \(!LocalDataArray->Get\(LocalContext, unByteIndex\)\.ToLocal\(&LocalByteValue\) \|\| LocalByteValue\.IsEmpty\(\) \|\| SocketFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)\) \{\s+RethrowV8InstallationFailure\(pIsolate, SocketFailure, kSocketSendInvalidDataErrorMessage\);\s+return;\s+\}/);
	g_Assert(strSend.indexOf("!LocalDataArray->Get(") < strSend.indexOf("if (!LocalByteValue->IsNumber())"));
	g_Assert.match(strSend, /if \(!RequireExternalPluginName\(CallbackInformation, strCurrentPluginName\) \|\| SocketFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)\) \{\s+RethrowV8InstallationFailure\(pIsolate, SocketFailure, kSocketSendRequestFailureErrorMessage\);\s+return;\s+\}/);
	g_Assert.match(strSend, /if \(strCurrentPluginName != SocketConnectionRecordOwner->m_strPluginName\) \{\s+RethrowV8InstallationFailure\(pIsolate, SocketFailure, kSocketSendChangedRuntimeContextErrorMessage\);\s+return;\s+\}/);
	g_Assert(strSend.indexOf("RequireExternalPluginName") > strSend.indexOf("LocalDataArray->Get"));
	g_Assert(strSend.indexOf("RequireExternalPluginName") < strSend.indexOf("auto Operation ="));
	g_Assert.match(strSend, /SocketConnectionOperation SocketOperation = \*SocketConnectionRecordOwner;[\s\S]+m_SendMutex[\s\S]+if \(vecDataBytes\.empty\(\)\) \{\s+return 0;\s+\}/);
	g_Assert(strSend.indexOf("vecDataBytes.empty()") < strSend.indexOf("return TransferNativeSocketBytes("));

	const strReceive = ReadNativeFunction(strBindings, "void ReceiveSocketCallback");
	g_Assert.match(strReceive, /nMaximumByteCount < kMinimumSocketReceiveByteCount/);
	g_Assert.match(strReceive, /static_cast<std::size_t>\(nMaximumByteCount\) > kMaximumSocketTransferByteCount/);
	g_Assert.match(strReceive, /m_ReceiveMutex/);
	g_Assert.match(strReceive, /MakeFilesystemByteArrayValue\(pResultIsolate, vecReceivedBytes\.data\(\), vecReceivedBytes\.size\(\)\)/);
	g_Assert.match(strReceive, /if \(LocalMaximumByteCountValue\.IsEmpty\(\) \|\| SocketFailure\.HasCaught\(\)/);

	const strCloseCallback = ReadNativeFunction(strBindings, "void CloseSocketCallback");
	g_Assert.match(strCloseCallback, /if \(LocalConnectionClosed\.IsEmpty\(\) \|\| SocketResultFailure\.HasCaught\(\)/);
	g_Assert(strCloseCallback.indexOf("LocalConnectionClosed.IsEmpty()") < strCloseCallback.indexOf("umapSocketConnections.erase("));
	g_Assert.match(strCloseCallback, /itSocketConnection->second == SocketConnectionRecordOwner/);

	const strTransfer = ReadNativeFunction(strBindings, "std::size_t TransferNativeSocketBuffer");
	g_Assert.match(strTransfer, /std::unique_ptr<void, fnNativeSocketEventDeleter> EventOwner/);
	g_Assert.match(strTransfer, /Overlapped\.hEvent = hEvent;/);
	g_Assert.match(strTransfer, /std::lock_guard<std::mutex> Lock\(SocketConnection\.m_Mutex\);[\s\S]+if \(SocketConnection\.m_bClosing\)/);
	g_Assert.match(strTransfer, /WSARecv\([^\n]+&unFlags, &Overlapped, nullptr\)/);
	g_Assert.match(strTransfer, /WSASend\([^\n]+0, &Overlapped, nullptr\)/);
	g_Assert.match(strTransfer, /WSAGetOverlappedResult\(hSocket, &Overlapped, &unTransferredByteCount, TRUE, &unFlags\)/);
	g_Assert.match(strTransfer, /CancelIoEx\(reinterpret_cast<HANDLE>\(hSocket\), &Overlapped\)/);
	g_Assert.match(strSend, /TransferNativeSocketBuffer\(\*SocketConnectionRecordOwner, SocketOperation\.m_hSocket, Buffer, false, Request\)/);
	g_Assert.match(strReceive, /TransferNativeSocketBuffer\(\*SocketConnectionRecordOwner, SocketOperation\.m_hSocket, Buffer, true, Request\)/);

	const strClose = ReadNativeFunction(strBindings, "bool CloseSocketConnection");
	const strErrorFormatter = ReadNativeFunction(strBindings, "std::string FormatNativeSocketErrorMessage");
	g_Assert.match(strErrorFormatter, /std::ostringstream ErrorStream \{\};/);
	g_Assert.match(strErrorFormatter, /constexpr std::streamsize kNativeSocketErrorHexWidth = 8;/);
	g_Assert.match(strErrorFormatter, /ErrorStream << strOperation << " failed Error=0x" << std::uppercase << std::hex;/);
	g_Assert.match(strErrorFormatter, /ErrorStream\.width\(kNativeSocketErrorHexWidth\);/);
	g_Assert.match(strErrorFormatter, /ErrorStream\.fill\('0'\);/);
	g_Assert.match(strErrorFormatter, /ErrorStream << static_cast<std::uint32_t>\(nSocketError\);/);
	const strNativeConnect = ReadNativeFunction(strBindings, "void ConnectNativeSocket");
	g_Assert.match(strNativeConnect, /constexpr WORD kWinsockVersion = MAKEWORD\(2, 2\);/);
	g_Assert.match(strNativeConnect, /WSAStartup\(kWinsockVersion, &WinsockData\)/);
	g_Assert.match(strNativeConnect, /AddressInformationOwner\(pRawAddressInformation, &freeaddrinfo\);/);
	const nAddressLengthGuard = strNativeConnect.indexOf("if (pAddressInformation->ai_addrlen > static_cast<std::size_t>(std::numeric_limits<NativeSocketLength>::max()))");
	const nAddressLengthConversion = strNativeConnect.indexOf("ConnectNativeSocketAddress(hSocket, *pAddressInformation, Request)");
	g_Assert((nAddressLengthGuard >= 0) && (nAddressLengthConversion > nAddressLengthGuard), "Validate native address length before narrowing for connect.");
	g_Assert.match(strNativeConnect, /catch \(\.\.\.\) \{\s+CloseNativeSocket\(hSocket\);\s+throw;/);
	g_Assert(strNativeConnect.includes('"socket.Connect getaddrinfo failed Result="'));
	g_Assert(strNativeConnect.includes('FormatNativeSocketErrorMessage("socket.Connect", nLastSocketError)'));
	g_Assert.match(strClose, /CancelIoEx\(reinterpret_cast<HANDLE>\(hSocket\), nullptr\)/);
	g_Assert(strClose.indexOf("SocketConnection.m_bClosing = true") < strClose.indexOf("CancelIoEx"));
	g_Assert(strClose.indexOf("CancelIoEx") < strClose.indexOf("m_OperationsFinished.wait"));
	g_Assert(strClose.indexOf("m_OperationsFinished.wait") < strClose.indexOf("CloseNativeSocketHandle"));
	g_Assert.match(strClose, /constexpr std::streamsize kSocketCancellationErrorHexWidth = 8;/);
	g_Assert.match(strClose, /std::ostringstream ErrorStream \{\};/);
	g_Assert.match(strClose, /ErrorStream << "socket.Close cancellation failed Error=0x" << std::uppercase << std::hex;/);
	g_Assert.match(strClose, /ErrorStream\.width\(kSocketCancellationErrorHexWidth\);/);
	g_Assert.match(strClose, /ErrorStream\.fill\('0'\);/);
	g_Assert.match(strClose, /ErrorStream << unCancellationError;/);
	g_Assert.match(strClose, /throw std::runtime_error\(ErrorStream\.str\(\)\);/);

	const strByteConverter = ReadNativeFunction(strBindings, "v8::Local<v8::Value> MakeFilesystemByteArrayValue");
	g_Assert.match(strByteConverter, /std::memcpy\(pDestinationBytes, pchByteData, unSize\);/);
	g_Assert.match(strByteConverter, /v8::Uint8Array::New\(LocalArrayBuffer, kByteOffset, unSize\)/);
}

function VerifyNativeGuardMutations(strBindings) {
	const vecMutations = [
		{ Owner: "", From: 'LocalSocketModule, "Send"', To: 'LocalSocketModule, "send"' },
		{ Owner: "bool ParseAsyncRequestExecutionMode", From: "LocalCallbackValue->IsFunction()", To: "LocalCallbackValue->IsObject()" },
		{ Owner: "void ConnectNativeSocket", From: "kWinsockVersion = MAKEWORD(2, 2)", To: "kWinsockVersion = MAKEWORD(1, 1)" },
		{ Owner: "void ConnectNativeSocket", From: "WSAStartup(kWinsockVersion, &WinsockData)", To: "WSAStartup(MAKEWORD(2, 2), &WinsockData)" },
		{ Owner: "void ConnectNativeSocket", From: "AddressInformationOwner(pRawAddressInformation, &freeaddrinfo)", To: "AddressInformationOwner(nullptr, &freeaddrinfo)" },
		{ Owner: "void ConnectNativeSocket", From: "pAddressInformation->ai_addrlen > static_cast<std::size_t>(std::numeric_limits<NativeSocketLength>::max())", To: "false" },
		{ Owner: "void ConnectNativeSocket", From: "CloseNativeSocket(hSocket);\n\t\t\t\t\tthrow;", To: "throw;" },
		{ Owner: "void ConnectSocketCallback", From: "strHost.find('\\0') != std::string::npos", To: "false" },
		{ Owner: "void SendSocketCallback", From: "if (vecDataBytes.empty())", To: "if (false)" },
		{ Owner: "void SendSocketCallback", From: "SocketConnectionRecordOwner->m_SendMutex", To: "SocketConnectionRecordOwner->m_ReceiveMutex" },
		{ Owner: "void SendSocketCallback", From: "vecDataBytes = std::move(vecDataBytes)", To: "&vecDataBytes" },
		{ Owner: "void SendSocketCallback", From: "v8::TryCatch SocketFailure(pIsolate);", To: "v8::TryCatch HandleTryCatch(pIsolate);" },
		{ Owner: "void SendSocketCallback", From: "!LocalDataArray->Get(LocalContext, unByteIndex).ToLocal(&LocalByteValue)", To: "false" },
		{ Owner: "void SendSocketCallback", From: "strCurrentPluginName != SocketConnectionRecordOwner->m_strPluginName", To: "false" },
		{ Owner: "bool CloseSocketConnection", From: "CancelIoEx(reinterpret_cast<HANDLE>(hSocket), nullptr)", To: "CancelIo(reinterpret_cast<HANDLE>(hSocket))" },
		{ Owner: "bool CloseSocketConnection", From: "kSocketCancellationErrorHexWidth = 8;", To: "kSocketCancellationErrorHexWidth = 7;" },
		{ Owner: "bool CloseSocketConnection", From: "std::ostringstream ErrorStream {};", To: "std::ostringstream ErrorStream;" },
		{ Owner: "std::string FormatNativeSocketErrorMessage", From: "kNativeSocketErrorHexWidth = 8;", To: "kNativeSocketErrorHexWidth = 7;" },
		{ Owner: "std::string FormatNativeSocketErrorMessage", From: "std::ostringstream ErrorStream {};", To: "std::ostringstream ErrorStream;" },
		{ Owner: "std::string FormatNativeSocketErrorMessage", From: "ErrorStream << static_cast<std::uint32_t>(nSocketError);", To: "ErrorStream << 0;" },
		{ Owner: "void ConnectNativeSocket", From: "socket.Connect getaddrinfo failed Result=", To: "socket.Connect getaddrinfo failed Error=" },
		{ Owner: "std::string FormatNativeSocketErrorMessage", From: "<< std::uppercase << std::hex;", To: "<< std::dec;" },
		{ Owner: "bool CloseSocketConnection", From: "ErrorStream.width(kSocketCancellationErrorHexWidth);", To: "ErrorStream.width(1);" },
		{ Owner: "std::size_t TransferNativeSocketBuffer", From: "&unFlags, &Overlapped, nullptr", To: "&unFlags, nullptr, nullptr" },
		{ Owner: "std::size_t TransferNativeSocketBuffer", From: "&unTransferredByteCount, TRUE, &unFlags", To: "&unTransferredByteCount, FALSE, &unFlags" },
		{ Owner: "std::size_t TransferNativeSocketBuffer", From: "CancelIoEx(reinterpret_cast<HANDLE>(hSocket), &Overlapped)", To: "CancelIoEx(reinterpret_cast<HANDLE>(hSocket), nullptr)" },
		{ Owner: "bool RunSocketRequest", From: 'NewFromUtf8Literal(pIsolate, "Timeout")', To: 'NewFromUtf8Literal(pIsolate, "Blocking")' },
		{ Owner: "void CancelSocketRequestCallback", From: "pRequest->m_strPluginName == strPluginName", To: "true" },
		{ Owner: "v8::Local<v8::Value> MakeFilesystemByteArrayValue", From: "v8::Uint8Array::New(LocalArrayBuffer, kByteOffset, unSize)", To: "v8::Array::New(pIsolate)" },
	];
	let unRejectedMutationCount = 0;
	for (const Mutation of vecMutations) {
		const strOriginal = Mutation.Owner ? ReadNativeFunction(strBindings, Mutation.Owner, true) : strBindings;
		g_Assert.equal(strOriginal.split(Mutation.From).length, 2, `Missing or ambiguous mutation target: ${Mutation.From}`);

		const strModified = strOriginal.replace(Mutation.From, () => Mutation.To);
		g_Assert.notEqual(strModified, strOriginal, Mutation.From);

		const strMutatedBindings = Mutation.Owner ? strBindings.replace(strOriginal, () => strModified) : strModified;
		g_Assert.notEqual(strMutatedBindings, strBindings, Mutation.From);
		g_Assert.throws(() => VerifyNativeSurface(strMutatedBindings), g_Assert.AssertionError);
		++unRejectedMutationCount;
	}

	g_Assert.equal(unRejectedMutationCount, vecMutations.length);
}

function ValidateRequestControls(Options, Callback) {
	g_Assert((Options !== null) && (typeof Options === "object") && !Array.isArray(Options), "Options must be a non-array object");
	g_Assert.equal(typeof Callback, "function", "Callback is required");

	if ((Options.Blocking !== undefined) && (Options.Blocking !== null)) {
		g_Assert.equal(typeof Options.Blocking, "boolean", "Blocking must be a boolean");
	}
}

function CompleteMockRequest(Options, Callback, Operation) {
	ValidateRequestControls(Options, Callback);

	const Complete = () => {
		let RequestError = null;
		let Result;
		try {
			Result = Operation();
		} catch (OperationError) {
			RequestError = OperationError;
		}

		Callback(RequestError, Result);
	};

	if (Options.Blocking === true) {
		Complete();
		return;
	}

	queueMicrotask(Complete);
}

// Only the documentation's byte-array workflow is doubled here, not the full native API.
function CreateSocketDouble(Scenario = {}) {
	const State = { ConnectCount: 0, CloseCount: 0, SentBytes: [], SubmittedBytes: [], Messages: [] };
	const Socket = {
		Connect(strHost, nPort, Options, Callback) {
			CompleteMockRequest(Options, Callback, () => {
				++State.ConnectCount;
				g_Assert.equal(strHost, "127.0.0.1");
				g_Assert.equal(nPort, 27015);

				if (Scenario.ConnectError) {
					throw Scenario.ConnectError;
				}

				return 7;
			});
		},
		Send(nSocketConnectionHandle, vecBytes, Options, Callback) {
			ValidateRequestControls(Options, Callback);
			g_Assert.equal(nSocketConnectionHandle, 7);
			g_Assert(Array.isArray(vecBytes), "the documented helper accepts a byte array");
			const vecSnapshotBytes = Array.from(vecBytes);
			State.SubmittedBytes.push(vecSnapshotBytes);
			CompleteMockRequest(Options, Callback, () => {
				if (Scenario.SendError) {
					throw Scenario.SendError;
				}

				if (Object.prototype.hasOwnProperty.call(Scenario, "Progress")) {
					return Scenario.Progress;
				}

				const unWrittenByteCount = Math.min(Scenario.MaximumWrite ?? vecSnapshotBytes.length, vecSnapshotBytes.length);
				State.SentBytes.push(...vecSnapshotBytes.slice(0, unWrittenByteCount));

				return unWrittenByteCount;
			});
		},
		Close(nSocketConnectionHandle, Options, Callback) {
			if (Object.prototype.hasOwnProperty.call(Scenario, "SynchronousCloseError")) {
				ValidateRequestControls(Options, Callback);
				++State.CloseCount;
				throw Scenario.SynchronousCloseError;
			}

			CompleteMockRequest(Options, Callback, () => {
				g_Assert.equal(nSocketConnectionHandle, 7);
				++State.CloseCount;

				if (Scenario.CloseError) {
					throw Scenario.CloseError;
				}

				if (Object.prototype.hasOwnProperty.call(Scenario, "CloseResult")) {
					return Scenario.CloseResult;
				}

				return true;
			});
		},
	};

	return { Socket, State };
}

function LoadDocumentationExample(strExample, SocketDouble) {
	const Context = g_VM.createContext({
		module: { exports: {} },
		console: { log: (strMessage) => SocketDouble.State.Messages.push(strMessage) },
		require(strName) {
			g_Assert.equal(strName, "socket");

			return SocketDouble.Socket;
		},
	});
	const Script = new g_VM.Script(strExample, { filename: g_strDocumentationPath });
	Script.runInContext(Context);
	g_Assert.equal(typeof Context.module.exports.SendSocketBytes, "function");

	return Context.module.exports.SendSocketBytes;
}

async function VerifyDocumentationExample(strExample) {
	const unByteValueCount = 256;
	const vecBytes = [];
	for (let unByteValue = 0; unByteValue < unByteValueCount; ++unByteValue) {
		vecBytes.push(unByteValue);
	}

	const ShortWriteDouble = CreateSocketDouble({ MaximumWrite: 73 });
	const SendShortWrites = LoadDocumentationExample(strExample, ShortWriteDouble);
	await SendShortWrites("127.0.0.1", 27015, vecBytes);
	g_Assert.deepEqual(ShortWriteDouble.State.SentBytes, vecBytes);
	g_Assert.deepEqual(ShortWriteDouble.State.SubmittedBytes.map((vecSubmittedBytes) => vecSubmittedBytes.length), [256, 183, 110, 37]);
	g_Assert.equal(ShortWriteDouble.State.ConnectCount, 1);
	g_Assert.equal(ShortWriteDouble.State.CloseCount, 1);
	g_Assert.deepEqual(ShortWriteDouble.State.Messages, ["Sent 256 bytes."]);

	const EmptyDouble = CreateSocketDouble();
	await LoadDocumentationExample(strExample, EmptyDouble)("127.0.0.1", 27015, []);
	g_Assert.deepEqual(EmptyDouble.State.SubmittedBytes, []);
	g_Assert.equal(EmptyDouble.State.CloseCount, 1);
	g_Assert.deepEqual(EmptyDouble.State.Messages, ["Sent 0 bytes."]);

	const vecInvalidProgressValues = [0, -1, 0.5, NaN, Infinity, 257, 1n, "1", undefined];
	for (const Progress of vecInvalidProgressValues) {
		const InvalidProgressDouble = CreateSocketDouble({ Progress });
		const SendInvalidProgress = LoadDocumentationExample(strExample, InvalidProgressDouble);
		await g_Assert.rejects(SendInvalidProgress("127.0.0.1", 27015, vecBytes), /invalid progress count/);
		g_Assert.equal(InvalidProgressDouble.State.SubmittedBytes.length, 1);
		g_Assert.equal(InvalidProgressDouble.State.CloseCount, 1);
	}

	for (const strFailureStage of ["Connect", "Send", "Close"]) {
		const RequestError = new Error(`${strFailureStage} failed`);
		const FailureDouble = CreateSocketDouble({ [`${strFailureStage}Error`]: RequestError });
		await g_Assert.rejects(LoadDocumentationExample(strExample, FailureDouble)("127.0.0.1", 27015, vecBytes), (CaughtError) => {
			if (strFailureStage !== "Close") {
				return CaughtError === RequestError;
			}

			return (CaughtError.name === "AggregateError") && (CaughtError.ConnectionHandle === 7) && (CaughtError.cause === RequestError) && (CaughtError.errors.length === 1) && (CaughtError.errors[0] === RequestError);
		});
		g_Assert.equal(FailureDouble.State.CloseCount, (strFailureStage === "Connect") ? 0 : 1);
		g_Assert.deepEqual(FailureDouble.State.Messages, []);
	}

	async function CaptureFailure(SocketDouble, vecInputBytes) {
		try {
			await LoadDocumentationExample(strExample, SocketDouble)("127.0.0.1", 27015, vecInputBytes);
		} catch (CaughtError) {
			return { Failed: true, Error: CaughtError };
		}

		return { Failed: false, Error: null };
	}

	const CleanupError = new Error("Connection cleanup failed");
	const vecCleanupScenarios = [{ CloseResult: false }, { CloseError: CleanupError }, { SynchronousCloseError: CleanupError }];
	const vecOperationErrors = [new Error("Byte access failed"), null, undefined, 0, false, "", Symbol("Byte access failed")];
	let unCleanupScenarioCount = 0;
	for (const OperationError of vecOperationErrors) {
		const vecFailingBytes = new Proxy([1], {
			get(vecTarget, PropertyKey, Receiver) {
				if (PropertyKey === "slice") {
					throw OperationError;
				}

				return Reflect.get(vecTarget, PropertyKey, Receiver);
			},
		});
		const ConfirmedDouble = CreateSocketDouble();
		const ConfirmedFailure = await CaptureFailure(ConfirmedDouble, vecFailingBytes);
		g_Assert.equal(ConfirmedFailure.Failed, true);
		g_Assert.equal(ConfirmedFailure.Error, OperationError);
		g_Assert.equal(ConfirmedDouble.State.CloseCount, 1);
		g_Assert.deepEqual(ConfirmedDouble.State.Messages, []);
		unCleanupScenarioCount++;

		for (const Scenario of vecCleanupScenarios) {
			const SocketDouble = CreateSocketDouble(Scenario);
			const Failure = await CaptureFailure(SocketDouble, vecFailingBytes);
			g_Assert.equal(Failure.Failed, true);
			g_Assert.equal(Failure.Error.name, "AggregateError");
			g_Assert.equal(Failure.Error.ConnectionHandle, 7);
			g_Assert.equal(Failure.Error.cause, OperationError);
			g_Assert.equal(Failure.Error.errors.length, 2);
			g_Assert.equal(Failure.Error.errors[0], OperationError);
			if (Scenario.CloseResult === false) {
				g_Assert.match(Failure.Error.errors[1].message, /did not confirm release/);
			} else {
				g_Assert.equal(Failure.Error.errors[1], CleanupError);
			}

			g_Assert.equal(SocketDouble.State.CloseCount, 1);
			g_Assert.deepEqual(SocketDouble.State.Messages, []);
			unCleanupScenarioCount++;
		}
	}

	for (const Scenario of vecCleanupScenarios) {
		const SocketDouble = CreateSocketDouble(Scenario);
		const Failure = await CaptureFailure(SocketDouble, vecBytes);
		g_Assert.equal(Failure.Failed, true);
		g_Assert.equal(Failure.Error.name, "AggregateError");
		g_Assert.equal(Failure.Error.ConnectionHandle, 7);
		g_Assert.equal(Failure.Error.errors.length, 1);
		if (Scenario.CloseResult === false) {
			g_Assert.match(Failure.Error.errors[0].message, /did not confirm release/);
			g_Assert.equal(Failure.Error.cause, Failure.Error.errors[0]);
		} else {
			g_Assert.equal(Failure.Error.errors[0], CleanupError);
			g_Assert.equal(Failure.Error.cause, CleanupError);
		}

		g_Assert.equal(SocketDouble.State.CloseCount, 1);
		g_Assert.deepEqual(SocketDouble.State.Messages, []);
		unCleanupScenarioCount++;
	}

	g_Assert.equal(unCleanupScenarioCount, 31);
	console.log("Socket documentation cleanup 31 fault profiles passed (Node doubles).");
}

async function VerifyMockControls() {
	const vecInvalidOptions = [undefined, null, [], true, "options", { Blocking: 1 }];
	for (const Options of vecInvalidOptions) {
		g_Assert.throws(() => CompleteMockRequest(Options, () => {
		}, () => true), g_Assert.AssertionError);
	}

	g_Assert.throws(() => CompleteMockRequest({}, null, () => true), /Callback is required/);

	for (const Options of [{}, { Blocking: false }, { Blocking: null }, { Blocking: undefined }]) {
		let bCompleted = false;
		CompleteMockRequest(Options, (RequestError, bResult) => {
			g_Assert.equal(RequestError, null);
			g_Assert.equal(bResult, true);
			bCompleted = true;
		}, () => true);
		g_Assert.equal(bCompleted, false);
		await Promise.resolve();
		g_Assert.equal(bCompleted, true);
	}

	let unCallbackCount = 0;
	CompleteMockRequest({}, (RequestError, nResult) => {
		g_Assert.equal(RequestError, null);
		g_Assert.equal(nResult, 7);
		++unCallbackCount;
	}, () => 7);
	g_Assert.equal(unCallbackCount, 0);
	await Promise.resolve();
	g_Assert.equal(unCallbackCount, 1);

	CompleteMockRequest({ Blocking: true }, (RequestError, unResult) => {
		g_Assert.equal(RequestError, null);
		g_Assert.equal(unResult, 0);
		++unCallbackCount;
	}, () => 0);
	g_Assert.equal(unCallbackCount, 2);

	const NativeError = new Error("request failed");
	CompleteMockRequest({}, (RequestError, Result) => {
		g_Assert.equal(RequestError, NativeError);
		g_Assert.equal(Result, undefined);
		++unCallbackCount;
	}, () => {
		throw NativeError;
	});
	await Promise.resolve();
	g_Assert.equal(unCallbackCount, 3);

	const CallbackError = new Error("callback failed");
	g_Assert.throws(() => CompleteMockRequest({ Blocking: true }, () => {
		++unCallbackCount;
		throw CallbackError;
	}, () => true), (CaughtError) => CaughtError === CallbackError);
	g_Assert.equal(unCallbackCount, 4);
}

function VerifyCancellationExample(strExample) {
	const Module = { exports: {} };
	const vecCancelled = [];
	function CompleteRead() {
	}

	g_VM.runInNewContext(strExample, {
		module: Module,
		require(strModule) {
			g_Assert.equal(strModule, "socket");
			return {
				Receive(nConnectionHandle, unByteCount, Options, Callback) {
					g_Assert.equal(nConnectionHandle, 4);
					g_Assert.equal(unByteCount, 4096);
					g_Assert.equal(Options.Timeout, 2000);
					g_Assert.equal(Callback, CompleteRead);
					return 11;
				},
				CancelRequest(nRequestHandle) {
					vecCancelled.push(nRequestHandle);
					return true;
				},
			};
		},
	});
	const CancelRead = Module.exports.StartRead(4, CompleteRead);
	g_Assert.equal(CancelRead(), true);
	g_Assert.deepEqual(vecCancelled, [11]);
}

async function RunSmokeTest() {
	VerifyNativeFunctionExtraction();

	const strBindings = g_FileSystem.readFileSync(g_strBindingsPath, "utf8").replace(/\r\n/g, "\n");
	VerifyNativeSurface(strBindings);
	VerifyNativeGuardMutations(strBindings);

	const strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const vecExamples = Array.from(strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, 2, "review additional documentation workflows explicitly");
	await VerifyDocumentationExample(vecExamples[0]);
	VerifyCancellationExample(vecExamples[1]);
	await VerifyMockControls();

	console.log("Socket smoke passed: documentation byte workflows, short-write/error cleanup and source regression guards (Node doubles; no native IO or V8 execution).");
}

RunSmokeTest().catch((TestError) => {
	console.error(TestError.stack || TestError);
	process.exitCode = 1;
});
