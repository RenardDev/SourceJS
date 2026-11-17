#!/usr/bin/env node

const g_FileSystem = require("fs");
const g_Module = require("module");
const g_Path = require("path");
const g_VM = require("node:vm");
const g_Assert = require("node:assert/strict");

const g_strRootPath = g_Path.resolve(__dirname, "..");
const g_strExamplePath = g_Path.join(g_strRootPath, "examples", "plugins", "disabled", "api-external-libraries", "index.js");
const g_strLoggerPath = g_Path.join(g_strRootPath, "packages", "sourcejs", "loggers.js");
const g_LoggerScript = new g_VM.Script(g_FileSystem.readFileSync(g_strLoggerPath, "utf8"), { filename: g_strLoggerPath });
const g_unExampleExecutionTimeoutMilliseconds = 1000;

const g_hSocketConnection = 42;
const g_hRedisConnection = 10;
const g_hSOCIConnection = 20;
const g_hSourceFile = 30;

const g_mapCommandCallbacks = new Map();
const g_vecRecordedCalls = [];
const g_vecLogMessages = [];
const g_mapMockFiles = new Map();
const g_setMockRedisKeys = new Set();
const g_unFixedClockMilliseconds = 1000;
const g_unSocketMaximumWriteByteCount = 2;
let g_nSocketForcedWriteByteCount = null;
let g_unSocketForcedSendCount = 0;
let g_bSocketReceiveFails = false;
let g_unRedisDeleteCallCount = 0;
let g_unRedisDeleteFailureIndex = 0;

function Assert(bCondition, strErrorMessage) {
	if (!bCondition) {
		throw new Error(strErrorMessage);
	}
}

function AssertThrows(Action, Expression, strErrorMessage) {
	try {
		Action();
	} catch (ThrownError) {
		Assert(Expression.test(ThrownError.message), strErrorMessage);
		return;
	}

	Assert(false, strErrorMessage);
}

async function Invoke(vecCommandArguments) {
	const Callback = g_mapCommandCallbacks.get("sjs_api_external");
	Assert(typeof Callback === "function", "sjs_api_external should be registered");
	await Callback({ Arguments: vecCommandArguments.slice(), Name: vecCommandArguments[0] });
}

function RecordRequestContract(strModuleName, strMethodName, Options, Callback) {
	Assert(Options && (typeof Options === "object") && !Array.isArray(Options), `${strModuleName}.${strMethodName} must receive an options object`);
	Assert(typeof Callback === "function", `${strModuleName}.${strMethodName} must receive a callback`);
	Assert((Options.Blocking === undefined) || (typeof Options.Blocking === "boolean"), `${strModuleName}.${strMethodName} Blocking must be a boolean`);
	g_vecRecordedCalls.push(["request.contract", strModuleName, strMethodName, Options, typeof Callback]);
}

function CompleteMockRequest(Options, Callback, Operation) {
	const ExecuteMockRequest = () => {
		let Result = undefined;

		try {
			Result = Operation();
		} catch (RequestError) {
			Callback(RequestError, undefined);
			return;
		}

		Callback(null, Result);
	};

	if (Options.Blocking === true) {
		ExecuteMockRequest();
		return;
	}

	queueMicrotask(ExecuteMockRequest);
}

function AssertRedisInt64(Value) {
	const nMinimumValue = -(1n << 63n);
	const nMaximumValue = (1n << 63n) - 1n;
	Assert((typeof Value === "bigint") && (Value >= nMinimumValue) && (Value <= nMaximumValue), "Redis integer arguments must be signed 64-bit BigInt values");
}

function MakeAsyncFacade(strModuleName, NativeMethods, bLowercaseMethods) {
	return new Proxy(NativeMethods, {
		get(Target, PropertyName, Receiver) {
			if (typeof PropertyName !== "string") {
				return Reflect.get(Target, PropertyName, Receiver);
			}

			if (bLowercaseMethods && (PropertyName !== PropertyName.toLowerCase())) {
				return undefined;
			}

			const NativeMethod = Reflect.get(Target, PropertyName, Receiver);
			if (typeof NativeMethod !== "function") {
				return NativeMethod;
			}

			return (...vecArguments) => {
				const Callback = vecArguments.pop();
				const Options = vecArguments.pop();
				RecordRequestContract(strModuleName, PropertyName, Options, Callback);

				if ((strModuleName === "redis") && (PropertyName === "incrby")) {
					AssertRedisInt64(vecArguments[2]);
				}

				if ((strModuleName === "redis") && (PropertyName === "lrange")) {
					AssertRedisInt64(vecArguments[2]);
					AssertRedisInt64(vecArguments[3]);
				}

				const vecSnapshotArguments = structuredClone(vecArguments);
				CompleteMockRequest(Options, Callback, () => NativeMethod(...vecSnapshotArguments));
			};
		},
	});
}

function LoadExampleLoggers(NativeLoggers) {
	const LoggerModule = { exports: {} };
	const Dependencies = {
		filesystem: {
			EnsureDirectoryExists: () => g_Assert.fail("External example must not create logger directories."),
			SourceFile: { OpenSourceFile: () => g_Assert.fail("External example must not write logger files.") },
		},
		"internal/runtime": {
			GetModule(strName) {
				g_Assert.equal(strName, "loggers");

				return NativeLoggers;
			},
		},
		paths: { LOG_ROOT: "/controlled/logs" },
	};
	const RequireLoggerDependency = strName => {
		g_Assert(Object.hasOwn(Dependencies, strName), "Unexpected logger dependency: " + strName);

		return Dependencies[strName];
	};

	g_LoggerScript.runInNewContext({ module: LoggerModule, require: RequireLoggerDependency }, { timeout: g_unExampleExecutionTimeoutMilliseconds });

	return LoggerModule.exports;
}

const g_Mocks = {
	cpr: {
		Get(Options, Callback) {
			RecordRequestContract("cpr", "Get", Options, Callback);
			g_vecRecordedCalls.push(["cpr.get", Options]);

			const SnapshotOptions = structuredClone(Options);
			CompleteMockRequest(Options, Callback, () => ({
				Bytes: new Uint8Array([0, 1, 2, 127, 255]),
				DownloadedBytes: 5n,
				OK: true,
				RedirectCount: 0n,
				StatusCode: 200,
				UploadedBytes: 0n,
				URL: SnapshotOptions.URL,
			}));
		},
		Head(Options, Callback) {
			RecordRequestContract("cpr", "Head", Options, Callback);
			g_vecRecordedCalls.push(["cpr.head", Options]);
			CompleteMockRequest(Options, Callback, () => ({
				DownloadedBytes: 0n,
				Headers: Object.assign(Object.create(null), { server: "mock" }),
				RedirectCount: 0n,
				StatusCode: 204,
				UploadedBytes: 0n,
			}));
		},
		Post(Options, Callback) {
			RecordRequestContract("cpr", "Post", Options, Callback);
			g_vecRecordedCalls.push(["cpr.post", Options]);

			const SnapshotOptions = structuredClone(Options);
			CompleteMockRequest(Options, Callback, () => ({
				Bytes: new Uint8Array([9, 8, 7]),
				DownloadedBytes: 3n,
				RedirectCount: 0n,
				StatusCode: 200,
				UploadedBytes: BigInt(SnapshotOptions.Body.byteLength),
			}));
		},
	},
	socket: MakeAsyncFacade("socket", {
		Connect(strHost, nPort) {
			g_vecRecordedCalls.push(["socket.Connect", strHost, nPort]);

			return g_hSocketConnection;
		},
		Close(hSocketConnection) {
			g_vecRecordedCalls.push(["socket.Close", hSocketConnection]);

			return true;
		},
		Send(hSocketConnection, vecBytes) {
			g_vecRecordedCalls.push(["socket.Send", hSocketConnection, vecBytes.slice()]);

			if (g_nSocketForcedWriteByteCount !== null) {
				g_unSocketForcedSendCount += 1;
				if (g_unSocketForcedSendCount > 1) {
					throw new Error("The example retried invalid send progress.");
				}

				return g_nSocketForcedWriteByteCount;
			}

			return Math.min(vecBytes.length, g_unSocketMaximumWriteByteCount);
		},
		Receive(hSocketConnection, nMaximumByteCount) {
			if (g_bSocketReceiveFails) {
				throw new Error("The mock socket receive failed.");
			}

			const arrReceivedBytes = new Uint8Array([0, 127, 128, 255]).slice(0, nMaximumByteCount);
			g_vecRecordedCalls.push(["socket.Receive", hSocketConnection, nMaximumByteCount, arrReceivedBytes]);

			return arrReceivedBytes;
		},
	}, false),
	filesystem: {
		DoesFileExist(strFilePath) {
			return g_mapMockFiles.has(strFilePath);
		},
		RemoveFile(strFilePath) {
			return g_mapMockFiles.delete(strFilePath);
		},
		SourceFile: class SourceFile {
			constructor(hSourceFile, strFilePath) {
				this.m_hSourceFile = hSourceFile;
				this.m_strFilePath = strFilePath;
			}

			static OpenSourceFile(strFilePath, strMode) {
				g_vecRecordedCalls.push(["filesystem.open", strFilePath, strMode]);
				g_mapMockFiles.set(strFilePath, new Uint8Array());

				return new this(g_hSourceFile, strFilePath);
			}

			WriteSourceFile(arrBytes) {
				g_vecRecordedCalls.push(["filesystem.write", this.m_hSourceFile, arrBytes]);
				g_mapMockFiles.set(this.m_strFilePath, arrBytes.slice());

				return arrBytes.byteLength;
			}

			CloseSourceFile() {
				g_vecRecordedCalls.push(["filesystem.close", this.m_hSourceFile]);
				this.m_hSourceFile = null;

				return true;
			}

			get Closed() {
				return this.m_hSourceFile === null;
			}
		},
	},
	loggers: LoadExampleLoggers({
		LogError(strMessage) {
			g_vecLogMessages.push(["error", strMessage]);

			return true;
		},
		LogInfo(strMessage) {
			g_vecLogMessages.push(["info", strMessage]);

			return true;
		},
		LogWarning(strMessage) {
			g_vecLogMessages.push(["warning", strMessage]);

			return true;
		},
	}),
	paths: {
		DATA_ROOT: "C:/sourcejs/data",
	},
	redis: {
		close(hRedisConnection) {
			g_vecRecordedCalls.push(["redis.close", hRedisConnection]);

			return true;
		},
		command(hRedisConnection, CommandValue, ...vecCommandArguments) {
			g_vecRecordedCalls.push(["redis.command", hRedisConnection, CommandValue, vecCommandArguments]);

			if (Array.isArray(CommandValue) && (CommandValue[0] === "GET")) {
				return new Uint8Array([0, 1, 2, 127, 255]);
			}

			return "PONG";
		},
		connect(strURI) {
			g_vecRecordedCalls.push(["redis.connect", strURI]);

			return g_hRedisConnection;
		},
		dbsize(hRedisConnection) {
			g_vecRecordedCalls.push(["redis.dbsize", hRedisConnection]);

			return 2n;
		},
		decr(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.decr", hRedisConnection, strKey]);

			return 5n;
		},
		del(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.del", hRedisConnection, strKey]);
			g_unRedisDeleteCallCount += 1;
			if (g_unRedisDeleteCallCount === g_unRedisDeleteFailureIndex) {
				throw new Error("The mock Redis key deletion failed.");
			}

			return g_setMockRedisKeys.delete(strKey) ? 1n : 0n;
		},
		expire(hRedisConnection, strKey, nSeconds) {
			g_vecRecordedCalls.push(["redis.expire", hRedisConnection, strKey, nSeconds]);

			return true;
		},
		exists(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.exists", hRedisConnection, strKey]);

			return g_setMockRedisKeys.has(strKey);
		},
		get(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.get", hRedisConnection, strKey]);

			return "SourceJS";
		},
		hdel(hRedisConnection, strKey, strField) {
			g_vecRecordedCalls.push(["redis.hdel", hRedisConnection, strKey, strField]);

			return 1n;
		},
		hexists(hRedisConnection, strKey, strField) {
			g_vecRecordedCalls.push(["redis.hexists", hRedisConnection, strKey, strField]);

			return true;
		},
		hget(hRedisConnection, strKey, strField) {
			g_vecRecordedCalls.push(["redis.hget", hRedisConnection, strKey, strField]);

			return "value";
		},
		hgetall(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.hgetall", hRedisConnection, strKey]);

			return Object.assign(Object.create(null), { Field: "Value" });
		},
		hlen(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.hlen", hRedisConnection, strKey]);

			return 1n;
		},
		hset(hRedisConnection, strKey, strField, strValue) {
			g_vecRecordedCalls.push(["redis.hset", hRedisConnection, strKey, strField, strValue]);
			g_setMockRedisKeys.add(strKey);

			return 1n;
		},
		incr(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.incr", hRedisConnection, strKey]);

			return 2n;
		},
		incrby(hRedisConnection, strKey, nIncrement) {
			g_vecRecordedCalls.push(["redis.incrby", hRedisConnection, strKey, nIncrement]);

			return 7n;
		},
		keys(hRedisConnection, strPattern) {
			g_vecRecordedCalls.push(["redis.keys", hRedisConnection, strPattern]);

			return ["key"];
		},
		lpop(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.lpop", hRedisConnection, strKey]);

			return "first";
		},
		lpush(hRedisConnection, strKey, vecValues) {
			g_vecRecordedCalls.push(["redis.lpush", hRedisConnection, strKey, vecValues]);
			g_setMockRedisKeys.add(strKey);

			return 3n;
		},
		lrange(hRedisConnection, strKey, nStart, nStop) {
			g_vecRecordedCalls.push(["redis.lrange", hRedisConnection, strKey, nStart, nStop]);

			return ["first", "a", "b"];
		},
		mget(hRedisConnection, vecKeys) {
			g_vecRecordedCalls.push(["redis.mget", hRedisConnection, vecKeys]);

			return ["SourceJS", "JavaScript"];
		},
		mset(hRedisConnection, Values) {
			g_vecRecordedCalls.push(["redis.mset", hRedisConnection, Values]);
			for (const strKey of Object.keys(Values)) {
				g_setMockRedisKeys.add(strKey);
			}

			return true;
		},
		persist(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.persist", hRedisConnection, strKey]);

			return true;
		},
		ping(hRedisConnection) {
			g_vecRecordedCalls.push(["redis.ping", hRedisConnection]);

			return "PONG";
		},
		publish(hRedisConnection, strChannel, strMessage) {
			g_vecRecordedCalls.push(["redis.publish", hRedisConnection, strChannel, strMessage]);

			return 0n;
		},
		rpop(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.rpop", hRedisConnection, strKey]);

			return "b";
		},
		rpush(hRedisConnection, strKey, vecValues) {
			g_vecRecordedCalls.push(["redis.rpush", hRedisConnection, strKey, vecValues]);
			g_setMockRedisKeys.add(strKey);

			return 2n;
		},
		sadd(hRedisConnection, strKey, vecMembers) {
			g_vecRecordedCalls.push(["redis.sadd", hRedisConnection, strKey, vecMembers]);
			g_setMockRedisKeys.add(strKey);

			return 2n;
		},
		smembers(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.smembers", hRedisConnection, strKey]);

			return ["a", "b"];
		},
		srem(hRedisConnection, strKey, vecMembers) {
			g_vecRecordedCalls.push(["redis.srem", hRedisConnection, strKey, vecMembers]);

			return 1n;
		},
		set(hRedisConnection, strKey, strValue) {
			g_vecRecordedCalls.push(["redis.set", hRedisConnection, strKey, strValue]);
			g_setMockRedisKeys.add(strKey);

			return true;
		},
		ttl(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.ttl", hRedisConnection, strKey]);

			return 60n;
		},
		type(hRedisConnection, strKey) {
			g_vecRecordedCalls.push(["redis.type", hRedisConnection, strKey]);

			return "string";
		},
	},
	soci: {
		GetBackendName(hSOCIConnection) {
			g_vecRecordedCalls.push(["soci.backendName", hSOCIConnection]);

			return "sqlite3";
		},
		Begin(hSOCIConnection) {
			g_vecRecordedCalls.push(["soci.begin", hSOCIConnection]);

			return true;
		},
		Close(hSOCIConnection) {
			g_vecRecordedCalls.push(["soci.close", hSOCIConnection]);

			return true;
		},
		Commit(hSOCIConnection) {
			g_vecRecordedCalls.push(["soci.commit", hSOCIConnection]);

			return true;
		},
		Connect(strConnectionString, strBackend) {
			g_vecRecordedCalls.push(["soci.connect", strConnectionString, strBackend]);

			return g_hSOCIConnection;
		},
		Execute(hSOCIConnection, strSQL, Parameters) {
			g_vecRecordedCalls.push(["soci.execute", hSOCIConnection, strSQL, Parameters]);

			return 0n;
		},
		IsConnected(hSOCIConnection) {
			g_vecRecordedCalls.push(["soci.isConnected", hSOCIConnection]);

			return true;
		},
		LastInsertId(hSOCIConnection, strTable) {
			g_vecRecordedCalls.push(["soci.lastInsertId", hSOCIConnection, strTable]);

			return 1n;
		},
		GetNextSequenceValue(hSOCIConnection, strSequence) {
			g_vecRecordedCalls.push(["soci.nextSequenceValue", hSOCIConnection, strSequence]);

			return 2n;
		},
		Query(hSOCIConnection, strSQL, Parameters) {
			g_vecRecordedCalls.push(["soci.query", hSOCIConnection, strSQL, Parameters]);

			return [{ Value: 1 }];
		},
		Reconnect(hSOCIConnection) {
			g_vecRecordedCalls.push(["soci.reconnect", hSOCIConnection]);

			return true;
		},
		Rollback(hSOCIConnection) {
			g_vecRecordedCalls.push(["soci.rollback", hSOCIConnection]);

			return true;
		},
	},
	source: {
		RegisterCommand(strName, Callback) {
			g_vecRecordedCalls.push(["source.registerCommand", strName]);
			g_mapCommandCallbacks.set(strName, Callback);

			return true;
		},
		UnregisterCommand(strName, Callback) {
			g_vecRecordedCalls.push(["source.unregisterCommand", strName, typeof Callback]);
			g_mapCommandCallbacks.delete(strName);

			return true;
		},
	},
};

g_Mocks.redis = MakeAsyncFacade("redis", g_Mocks.redis, true);
g_Mocks.soci = MakeAsyncFacade("soci", g_Mocks.soci, false);

function CreateIsolatedExample() {
	const State = {
		Context: null,
		Exports: {},
		Requests: [],
		Messages: [],
		Actions: new Map(),
		Held: [],
		Hold: null,
		RequestCounts: new Map(),
		Command: null,
		UnregisterActions: [],
		LogAction: null,
	};
	const Modules = { ...g_Mocks };
	for (const strLibrary of ["cpr", "soci", "redis", "socket"]) {
		Modules[strLibrary] = new Proxy(g_Mocks[strLibrary], {
			get(Target, PropertyName) {
				if (typeof PropertyName !== "string") {
					return Reflect.get(Target, PropertyName);
				}

				const Method = Target[PropertyName];
				if (typeof Method !== "function") {
					return Method;
				}

				return (...vecArguments) => {
					const strName = `${strLibrary}.${PropertyName}`;
					const Options = vecArguments[vecArguments.length - 2];
					const Callback = vecArguments[vecArguments.length - 1];
					const unOrdinal = (State.RequestCounts.get(strName) || 0) + 1;
					State.RequestCounts.set(strName, unOrdinal);
					State.Requests.push({ Name: strName, Options, Arguments: vecArguments.slice(0, -2) });
					const InvokeRequest = () => {
						const vecActions = State.Actions.get(strName);
						if (vecActions?.length) {
							RecordRequestContract(strLibrary, PropertyName, Options, Callback);
							const Action = vecActions.shift();
							CompleteMockRequest(Options, Callback, () => Action(...vecArguments.slice(0, -2)));
							return;
						}

						Method(...vecArguments);
					};
					if ((State.Hold?.Name === strName) && (State.Hold.Ordinal === unOrdinal) && !Options.Blocking) {
						State.Held.push(InvokeRequest);
						return;
					}

					InvokeRequest();
				};
			},
		});
	}

	Modules.source = {
		RegisterCommand(strName, Callback) {
			g_Assert.equal(strName, "sjs_api_external");
			State.Command = Callback;

			return true;
		},
		UnregisterCommand(strName, Callback) {
			g_Assert.equal(strName, "sjs_api_external");
			g_Assert.equal(Callback, State.Command);

			if (State.UnregisterActions.length) {
				return State.UnregisterActions.shift()();
			}

			State.Command = null;

			return true;
		},
	};
	const Log = (strLevel, strMessage) => {
		State.Messages.push([strLevel, strMessage]);

		if (State.LogAction) {
			State.LogAction(strLevel, strMessage);
		}

		return true;
	};
	Modules.loggers = LoadExampleLoggers({ LogInfo: strMessage => Log("info", strMessage), LogWarning: strMessage => Log("warning", strMessage), LogError: strMessage => Log("error", strMessage) });
	State.Modules = Modules;
	State.Context = g_VM.createContext({
		exports: State.Exports,
		Uint8Array,
		ArrayBuffer,
		Date: { now: () => g_unFixedClockMilliseconds },
		require(strName) {
			g_Assert.ok(Object.hasOwn(Modules, strName), `Unexpected example dependency ${strName}`);

			return Modules[strName];
		},
	});
	State.Load = () => g_VM.runInContext(g_FileSystem.readFileSync(g_strExamplePath, "utf8"), State.Context, { filename: g_strExamplePath });

	return State;
}

function VerifyLiteralRequestLogging(strLogSource = null) {
	for (const bUnloading of [false, true]) {
		const State = CreateIsolatedExample();
		State.Load();
		try {
			if (strLogSource !== null) {
				g_VM.runInContext(strLogSource, State.Context, { timeout: g_unExampleExecutionTimeoutMilliseconds });
			}

			if (bUnloading) {
				g_VM.runInContext("g_bUnloading = true;", State.Context, { timeout: g_unExampleExecutionTimeoutMilliseconds });
			}

			const unMessageCount = State.Messages.length;
			const Result = { Value: "Result 100%% %s", Address: 0x1234n };
			g_Assert.strictEqual(State.Context.LogRequestResult("Request 100%% %j", Result), Result);
			g_Assert.deepEqual(State.Messages.slice(unMessageCount), bUnloading ? [] : [["info", 'Request 100%% %j: {"Value":"Result 100%% %s","Address":"4660n"}']], "External result logging must preserve literal data and BigInt serialization");
			g_Assert.equal(State.Requests.length, 0, "Logging results must not start external requests");
		} finally {
			State.Exports.Unload();
		}

		g_Assert.equal(State.Command, null);
	}

	return 2;
}

g_Assert.equal(VerifyLiteralRequestLogging(), 2);

const g_strLoggingSource = g_FileSystem.readFileSync(g_strExamplePath, "utf8");
const g_strLogStart = "function LogRequestResult(";
const g_strLogEnd = "function LogQueryResult(";
g_Assert.equal(g_strLoggingSource.split(g_strLogStart).length, 2);
g_Assert.equal(g_strLoggingSource.split(g_strLogEnd).length, 2);
const g_strLiteralLogCall = 'LogInfo("%s", `${strLabel}: ${SummarizeValue(Result)}`);';
const g_strCurrentLogFunction = g_strLoggingSource.slice(g_strLoggingSource.indexOf(g_strLogStart), g_strLoggingSource.indexOf(g_strLogEnd));
g_Assert.equal(g_strCurrentLogFunction.split(g_strLiteralLogCall).length, 2);
const g_strLegacyLogFunction = g_strCurrentLogFunction.replace(g_strLiteralLogCall, () => g_strLiteralLogCall.replace('LogInfo("%s", ', "LogInfo("));
g_Assert.throws(() => VerifyLiteralRequestLogging(g_strLegacyLogFunction), Failure => (Failure instanceof g_Assert.AssertionError) && Failure.message.includes("External result logging must preserve literal data"), "Restored result-format call must fail for changed literal data, not an unrelated error");

console.log("[external example] literal logging: two active/unloading profiles and one restored-source regression passed through actual JavaScript formatter; no native request IO.");

function VerifyIsolatedSymbolProperties() {
	for (const strLibrary of ["cpr", "soci", "redis", "socket"]) {
		const Target = g_Mocks[strLibrary];
		const Property = Symbol("Native module protocol probe");
		let unCallCount = 0;
		const SymbolMethod = () => {
			unCallCount += 1;

			return "symbol value";
		};
		Object.defineProperty(Target, Property, { configurable: true, value: SymbolMethod });
		try {
			const State = CreateIsolatedExample();
			g_Assert.equal(State.Modules[strLibrary][Property], SymbolMethod, "Preserve symbolic properties instead of creating a native request wrapper");
			g_Assert.equal(State.Modules[strLibrary][Property](), "symbol value");
			g_Assert.equal(unCallCount, 1);
			g_Assert.equal(State.Requests.length, 0, "Symbolic protocol calls must not become native requests");
		} finally {
			delete Target[Property];
		}
	}
}

VerifyIsolatedSymbolProperties();

async function WaitForExample(Predicate) {
	const unMaximumMicrotaskTurns = 512;
	for (let unTurn = 0; unTurn < unMaximumMicrotaskTurns; unTurn += 1) {
		if (Predicate()) {
			return;
		}

		await Promise.resolve();
	}

	throw new Error("The controlled example did not reach its expected request boundary.");
}

async function VerifyExampleResourceContracts() {
	let unScenarioCount = 0;
	const strExistingPath = "C:/sourcejs/data/protected-example.bin";
	g_mapMockFiles.set(strExistingPath, new Uint8Array([42]));
	const Existing = CreateIsolatedExample();
	Existing.Load();
	await g_Assert.rejects(Existing.Context.RunCPR(["cpr", "https://sourcejs.invalid", strExistingPath]), /Refusing to overwrite/, "CPR must refuse an existing output before any request");
	g_Assert.equal(Existing.Requests.length, 0);
	g_Assert.equal(g_mapMockFiles.get(strExistingPath)[0], 42);
	Existing.Exports.Unload();
	g_mapMockFiles.delete(strExistingPath);
	unScenarioCount += 1;

	for (const vecArguments of [["cpr", "url", "path", "extra"], ["soci", "connection", "backend", "sql", "table", "sequence", "extra"], ["redis", "uri", "namespace", "extra"]]) {
		const State = CreateIsolatedExample();
		State.Load();
		await State.Command({ Arguments: ["sjs_api_external", ...vecArguments] });
		g_Assert.equal(State.Requests.length, 0, "Validate complete command syntax before native requests");
		State.Exports.Unload();
		unScenarioCount += 1;
	}

	for (const PrimaryError of [new Error("primary"), null, undefined, false, 0, "failure"]) {
		const State = CreateIsolatedExample();
		State.Load();
		const CleanupError = new Error("secondary");
		await g_Assert.rejects(State.Context.UseAsyncResource("controlled", async () => {
			throw PrimaryError;
		}, async () => {
			throw CleanupError;
		}), ErrorValue => (ErrorValue.errors[0] === PrimaryError) && (ErrorValue.errors[1] === CleanupError));
		State.Exports.Unload();
		unScenarioCount += 1;
	}

	for (const strWriteMode of ["SHORT", "THROW"]) {
		for (const strCloseMode of ["OK", "FALSE", "THROW"]) {
			const State = CreateIsolatedExample();
			const strPath = `C:/sourcejs/data/failure-${strWriteMode}-${strCloseMode}.bin`;
			const WriteError = new Error("write failure");
			const CloseError = new Error("close failure");
			let unCloseCount = 0;
			class OutputFile {
				constructor() {
					this.Closed = false;
				}

				static OpenSourceFile() {
					g_mapMockFiles.set(strPath, new Uint8Array());

					return new OutputFile();
				}

				WriteSourceFile() {
					g_mapMockFiles.set(strPath, new Uint8Array([1]));

					if (strWriteMode === "THROW") {
						throw WriteError;
					}

					return 1;
				}

				CloseSourceFile() {
					unCloseCount += 1;
					if (unCloseCount === 1) {
						if (strCloseMode === "THROW") {
							throw CloseError;
						}

						if (strCloseMode === "FALSE") {
							return false;
						}
					}

					this.Closed = true;

					return true;
				}
			}

			State.Modules.filesystem = { ...g_Mocks.filesystem, SourceFile: OutputFile };
			State.Load();
			await g_Assert.rejects(State.Context.RunCPR(["cpr", "https://sourcejs.invalid", strPath]), ErrorValue => {
				const OperationError = (strCloseMode === "OK") ? ErrorValue : ErrorValue.errors[0];
				if (strWriteMode === "THROW") {
					g_Assert.equal(OperationError, WriteError);
				} else {
					g_Assert.match(OperationError.message, /complete binary response/);
				}

				if (strCloseMode === "THROW") {
					g_Assert.equal(ErrorValue.errors[1], CloseError);
				}

				return true;
			});
			State.Exports.Unload();
			g_Assert.equal(g_mapMockFiles.has(strPath), false);
			g_Assert.equal(unCloseCount, (strCloseMode === "OK") ? 1 : 2);
			unScenarioCount += 1;
		}
	}

	for (const Case of [
		{ Connect: "soci.Connect", Close: "soci.Close", Invoke: Context => Context.RunSOCI(["soci", "dbname=:memory:", "sqlite3"]) },
		{ Connect: "redis.connect", Close: "redis.close", Invoke: Context => Context.RunRedis(["redis", "uri", "late"]) },
		{ Connect: "socket.Connect", Close: "socket.Close", Invoke: Context => Context.RunSocket(["socket", "localhost", "27015", "1"]) },
	]) {
		const State = CreateIsolatedExample();
		State.Load();
		State.Hold = { Name: Case.Connect, Ordinal: 1 };
		const Pending = Case.Invoke(State.Context).then(() => null, ErrorValue => ErrorValue);
		await WaitForExample(() => State.Held.length === 1);
		State.Exports.Unload();
		State.Held.shift()();
		const ErrorValue = await Pending;
		g_Assert.match(ErrorValue.message, /unloading/);
		g_Assert.deepEqual(State.Requests.map(Request => Request.Name), [Case.Connect, Case.Close]);
		State.Exports.Unload();
		unScenarioCount += 1;
	}

	const LateDownload = CreateIsolatedExample();
	LateDownload.Load();
	LateDownload.Hold = { Name: "cpr.Get", Ordinal: 2 };
	const strLatePath = "C:/sourcejs/data/late-download.bin";
	const PendingDownload = LateDownload.Context.RunCPR(["cpr", "https://sourcejs.invalid", strLatePath]);
	await WaitForExample(() => LateDownload.Held.length === 1);
	LateDownload.Exports.Unload();
	const unLogCount = LateDownload.Messages.length;
	LateDownload.Held.shift()();
	await PendingDownload;
	g_Assert.equal(g_mapMockFiles.has(strLatePath), false);
	g_Assert.equal(LateDownload.Messages.length, unLogCount);
	unScenarioCount += 1;

	for (const strMode of ["FALSE", "THROW"]) {
		const State = CreateIsolatedExample();
		State.Load();
		const ReleaseError = new Error("unregister");
		State.UnregisterActions.push(() => {
			if (strMode === "THROW") {
				throw ReleaseError;
			}

			return false;
		});
		g_Assert.throws(State.Exports.Unload);
		g_Assert.equal(typeof State.Command, "function");
		await State.Command({ Arguments: ["sjs_api_external", "soci", "connection"] });
		g_Assert.equal(State.Requests.length, 0);
		State.Exports.Unload();
		g_Assert.equal(State.Command, null);
		unScenarioCount += 1;
	}

	const Startup = CreateIsolatedExample();
	const StartupError = new Error("startup log");
	Startup.LogAction = () => {
		throw StartupError;
	};
	g_Assert.throws(Startup.Load, ErrorValue => ErrorValue === StartupError);
	g_Assert.equal(Startup.Command, null);
	Startup.Exports.Unload();
	unScenarioCount += 1;

	const Race = CreateIsolatedExample();
	Race.Load();
	const strRacePath = "C:/sourcejs/data/concurrent-download.bin";
	const unWritesBefore = g_vecRecordedCalls.filter(vecCall => vecCall[0] === "filesystem.write").length;
	const vecRaceResults = await Promise.allSettled([Race.Context.RunCPR(["cpr", "url", strRacePath]), Race.Context.RunCPR(["cpr", "url", strRacePath])]);
	g_Assert.deepEqual(vecRaceResults.map(Result => Result.status).sort(), ["fulfilled", "rejected"]);
	g_Assert.equal(g_vecRecordedCalls.filter(vecCall => vecCall[0] === "filesystem.write").length, unWritesBefore + 1);
	Race.Exports.Unload();
	g_mapMockFiles.delete(strRacePath);
	unScenarioCount += 1;

	const Secret = CreateIsolatedExample();
	const strSecret = "SOURCEJS_TEST_SECRET_SENTINEL";
	const Response = { OK: true, StatusCode: 200, ErrorCode: 0, Error: strSecret, URL: strSecret, Bytes: new Uint8Array([1, 2]), DownloadedBytes: 2n, UploadedBytes: 0n };
	Secret.Actions.set("cpr.Get", [() => Response, () => Response]);
	Secret.Actions.set("cpr.Head", [() => ({ OK: true, StatusCode: 200, Headers: { "Set-Cookie": strSecret, Authorization: strSecret } })]);
	Secret.Actions.set("cpr.Post", [() => Response]);
	Secret.Actions.set("soci.Query", [() => [{ Password: strSecret }], () => [{ Token: strSecret }]]);
	Secret.Load();
	const strSecretPath = "C:/sourcejs/data/redacted-response.bin";
	await Secret.Command({ Arguments: ["sjs_api_external", "cpr", `https://user:${strSecret}@sourcejs.invalid`, strSecretPath] });
	await Secret.Command({ Arguments: ["sjs_api_external", "soci", strSecret, "sqlite3"] });
	Secret.Actions.set("soci.Query", [() => {
		throw new Error(strSecret);
	}]);
	await Secret.Command({ Arguments: ["sjs_api_external", "soci", strSecret, "sqlite3"] });
	g_Assert.equal(Secret.Messages.some(Entry => Entry[1].includes(strSecret)), false, "Do not log native errors, response URLs, header values or arbitrary SQL row values");
	g_Assert.ok(Secret.Messages.some(Entry => Entry[1].includes('"RowCount":1')));
	Secret.Exports.Unload();
	g_mapMockFiles.delete(strSecretPath);
	unScenarioCount += 1;

	const Collision = CreateIsolatedExample();
	Collision.Load();
	const strForeignKey = `protected:${g_hRedisConnection}:${g_unFixedClockMilliseconds}:0:hash`;
	g_setMockRedisKeys.add(strForeignKey);
	await g_Assert.rejects(Collision.Context.RunRedis(["redis", "uri", "protected"]), /Refusing to overwrite/);
	g_Assert.equal(g_setMockRedisKeys.has(strForeignKey), true);
	g_Assert.equal(Collision.Requests.some(Request => ["redis.mset", "redis.set", "redis.hset", "redis.del"].includes(Request.Name)), false);
	Collision.Exports.Unload();
	g_setMockRedisKeys.delete(strForeignKey);
	unScenarioCount += 1;

	const Parallel = CreateIsolatedExample();
	Parallel.Load();
	await Promise.all([Parallel.Context.RunRedis(["redis", "uri", "parallel"]), Parallel.Context.RunRedis(["redis", "uri", "parallel"])]);
	const vecWrittenKeys = Parallel.Requests.filter(Request => Request.Name === "redis.mset").flatMap(Request => Object.keys(Request.Arguments[1]));
	g_Assert.equal(vecWrittenKeys.length, 4);
	g_Assert.equal(new Set(vecWrittenKeys).size, 4, "Concurrent workflows in the same millisecond must not share keys");
	Parallel.Exports.Unload();
	unScenarioCount += 1;

	const Pattern = CreateIsolatedExample();
	Pattern.Load();
	await Pattern.Context.RunRedis(["redis", "uri", "test*?[x]\\namespace"]);
	const strPatternKey = Object.keys(Pattern.Requests.find(Request => Request.Name === "redis.mset").Arguments[1])[0];
	const strExpectedPattern = strPatternKey.replaceAll("\\", "\\\\").replaceAll("*", "\\*").replaceAll("?", "\\?").replaceAll("[", "\\[").replaceAll("]", "\\]") + "*";
	g_Assert.equal(Pattern.Requests.find(Request => Request.Name === "redis.keys").Arguments[1], strExpectedPattern);
	Pattern.Exports.Unload();
	unScenarioCount += 1;

	const Transaction = CreateIsolatedExample();
	Transaction.Load();
	const TransactionError = new Error("transaction log");
	const RollbackError = Object.freeze(new Error("rollback"));
	const SessionCloseError = new Error("session close");
	Transaction.LogAction = (strLevel, strMessage) => {
		if ((strLevel === "info") && strMessage.startsWith("soci.Begin commit transaction:")) {
			throw TransactionError;
		}
	};
	Transaction.Actions.set("soci.Rollback", [() => {
		throw RollbackError;
	}]);
	Transaction.Actions.set("soci.Close", [() => {
		throw SessionCloseError;
	}]);
	await g_Assert.rejects(Transaction.Context.RunSOCI(["soci", "connection", "sqlite3"]), ErrorValue => {
		g_Assert.equal(ErrorValue.errors[0].errors[0], TransactionError);
		g_Assert.equal(ErrorValue.errors[0].errors[1], RollbackError);
		g_Assert.equal(ErrorValue.errors[1], SessionCloseError);

		return true;
	});
	g_Assert.equal(Transaction.Requests.some(Request => Request.Name === "soci.Execute"), false);
	Transaction.Exports.Unload();
	g_Assert.equal(Transaction.Requests.at(-1).Name, "soci.Close");
	g_Assert.equal(Transaction.Requests.at(-1).Options.Blocking, true, "Synchronous lifecycle cleanup still supplies Options and Callback");
	unScenarioCount += 1;

	for (const Case of [
		{ Hold: "soci.Query", Close: "soci.Close", Invoke: Context => Context.RunSOCI(["soci", "connection", "sqlite3"]) },
		{ Hold: "redis.ping", Close: "redis.close", Invoke: Context => Context.RunRedis(["redis", "uri", "active"]) },
		{ Hold: "socket.Receive", Close: "socket.Close", Invoke: Context => Context.RunSocket(["socket", "localhost", "27015", "1"]) },
	]) {
		const State = CreateIsolatedExample();
		State.Load();
		State.Hold = { Name: Case.Hold, Ordinal: 1 };
		const Pending = Case.Invoke(State.Context).then(() => null, ErrorValue => ErrorValue);
		await WaitForExample(() => State.Held.length === 1);
		State.Exports.Unload();
		g_Assert.ok(State.Requests.some(Request => (Request.Name === Case.Close) && Request.Options.Blocking));
		const unRequestCount = State.Requests.length;
		State.Held.shift()();
		await Pending;
		g_Assert.equal(State.Requests.length, unRequestCount, "An unloaded workflow must not issue another ordinary request");
		State.Exports.Unload();
		unScenarioCount += 1;
	}

	console.log(`[external example] ${unScenarioCount} resource/error/arity/unload scenarios; current JavaScript with controlled callbacks, not native IO`);
}

function ExtractNativeCPRFunction(strBindings, strFunctionMarker) {
	const strSignature = strFunctionMarker.trimStart();
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecStartMatches = [...strBindings.matchAll(new RegExp(`^(\\t{1,2})${strEscapedSignature}`, "gm"))];
	Assert(vecStartMatches.length === 1, `native CPR function should exist exactly once: ${strFunctionMarker}`);

	const vecStartMatch = vecStartMatches[0];
	const strClosingMarker = `\n${vecStartMatch[1]}}`;
	const unStartIndex = vecStartMatch.index;
	const nEndIndex = strBindings.indexOf(`${strClosingMarker}\n`, unStartIndex + vecStartMatch[0].length);
	Assert(nEndIndex > unStartIndex, "native CPR function should have its own closing boundary");

	const strFunction = strBindings.slice(unStartIndex, nEndIndex + strClosingMarker.length);

	return (vecStartMatch[1].length === 2) ? strFunction.replace(/^\t/gm, "") : strFunction;
}

function VerifyNativeCPRContracts(strBindings) {
	const strResponseSource = ExtractNativeCPRFunction(strBindings, "\tv8::Local<v8::Object> MakeCPRResponseObject(");
	const vecResponseContracts = [
		"MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.redirect_count))",
		"CreateResponseProperty(kRedirectCountPropertyName, LocalHTTPResponseRedirectCount)",
		"MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.uploaded_bytes))",
		"MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.downloaded_bytes))",
		"MakeString(pIsolate, itCPRResponseHeader->first)",
		"MakeString(pIsolate, itCPRResponseHeader->second)",
		"MakeString(pIsolate, itCPRResponseCookie->GetName())",
		"MakeString(pIsolate, itCPRResponseCookie->GetValue())",
		"v8::Local<v8::Primitive> const LocalCPRResponseNullPrototype = v8::Null(pIsolate);",
		"if (LocalCPRResponseNullPrototype.IsEmpty() || CPRResponseFailure.HasCaught()",
		"LocalCPRResponseHeaders->SetPrototypeV2(LocalCPRResponseContext, LocalCPRResponseNullPrototype)",
		"LocalCPRResponseCookies->SetPrototypeV2(LocalCPRResponseContext, LocalCPRResponseNullPrototype)",
		"LocalCPRResponseObject->CreateDataProperty(LocalCPRResponseContext, LocalPropertyName, LocalPropertyValue).FromMaybe(false)",
		"LocalCPRResponseHeaders->CreateDataProperty(LocalCPRResponseContext, LocalCPRResponseHeaderName, LocalCPRResponseHeaderValue).FromMaybe(false)",
		"LocalCPRResponseCookies->CreateDataProperty(LocalCPRResponseContext, LocalCPRResponseCookieName, LocalCPRResponseCookieValue).FromMaybe(false)",
	];
	for (const strContract of vecResponseContracts) {
		Assert(strResponseSource.includes(strContract), `native CPR response should preserve: ${strContract}`);
	}

	const strRequestSource = ExtractNativeCPRFunction(strBindings, "\tvoid QueueCPRRequest(");
	const nTryIndex = strRequestSource.indexOf("\n\t\ttry {");
	const nParseIndex = strRequestSource.indexOf("ParseHTTPRequestOptions(CallbackInformation, pszFixedHTTPMethod, ParsedHTTPRequestOptions)");
	const nTaskIndex = strRequestSource.indexOf("auto Task =");
	const nCatchIndex = strRequestSource.indexOf("} catch (std::exception const& Exception)");
	Assert((nTryIndex >= 0) && (nParseIndex > nTryIndex) && (nTaskIndex > nParseIndex) && (nCatchIndex > nTaskIndex), "native CPR parsing and task setup should stay inside the exception boundary");

	const vecRequestContracts = [
		"[ParsedHTTPRequestOptions = std::move(ParsedHTTPRequestOptions)]() -> AsyncRequestResult",
		"RunBlockingRequest(LocalCallbackFunction, std::move(Task), ConvertResult)",
		"QueueAsyncRequest(LocalCallbackFunction, std::move(Task), ConvertResult)",
	];
	for (const strContract of vecRequestContracts) {
		Assert(strRequestSource.includes(strContract), `native CPR request should preserve: ${strContract}`);
	}
}

function VerifyNativeCPRGuardMutations(strBindings) {
	// These read-only source mutations check guard sensitivity, not native IO or V8 execution.
	const vecResponseMutations = [
		["MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.redirect_count))", "v8::Number::New(pIsolate, static_cast<double>(HTTPResponse.redirect_count))"],
		["kRedirectCountPropertyName, LocalHTTPResponseRedirectCount)", "kRedirectCountPropertyName, v8::Undefined(pIsolate))"],
		["MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.uploaded_bytes))", "v8::Number::New(pIsolate, static_cast<double>(HTTPResponse.uploaded_bytes))"],
		["MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.downloaded_bytes))", "v8::Number::New(pIsolate, static_cast<double>(HTTPResponse.downloaded_bytes))"],
		["MakeString(pIsolate, itCPRResponseHeader->first)", "MakeString(pIsolate, itCPRResponseHeader->first.c_str())"],
		["MakeString(pIsolate, itCPRResponseHeader->second)", "MakeString(pIsolate, itCPRResponseHeader->second.c_str())"],
		["MakeString(pIsolate, itCPRResponseCookie->GetName())", "MakeString(pIsolate, itCPRResponseCookie->GetName().c_str())"],
		["MakeString(pIsolate, itCPRResponseCookie->GetValue())", "MakeString(pIsolate, itCPRResponseCookie->GetValue().c_str())"],
		["LocalCPRResponseHeaders->SetPrototypeV2(LocalCPRResponseContext, LocalCPRResponseNullPrototype)", "LocalCPRResponseHeaders->SetPrototypeV2(LocalCPRResponseContext, v8::Object::New(pIsolate))"],
		["LocalCPRResponseCookies->SetPrototypeV2(LocalCPRResponseContext, LocalCPRResponseNullPrototype)", "LocalCPRResponseCookies->SetPrototypeV2(LocalCPRResponseContext, v8::Object::New(pIsolate))"],
		["LocalCPRResponseObject->CreateDataProperty(", "LocalCPRResponseObject->Set("],
		["LocalCPRResponseHeaders->CreateDataProperty(", "LocalCPRResponseHeaders->Set("],
		["LocalCPRResponseCookies->CreateDataProperty(", "LocalCPRResponseCookies->Set("],
	];
	const vecRequestMutations = [
		["\n\t\ttry {", "\n\t\t{ // exception boundary removed"],
		["[ParsedHTTPRequestOptions = std::move(ParsedHTTPRequestOptions)]() -> AsyncRequestResult", "[ParsedHTTPRequestOptions = std::move(ParsedHTTPRequestOptions)]()"],
		["RunBlockingRequest(LocalCallbackFunction, std::move(Task), ConvertResult)", "RunBlockingRequest(LocalCallbackFunction, Task, ConvertResult)"],
		["QueueAsyncRequest(LocalCallbackFunction, std::move(Task), ConvertResult)", "QueueAsyncRequest(LocalCallbackFunction, Task, ConvertResult)"],
	];
	const vecMutationGroups = [
		{ Marker: "\tv8::Local<v8::Object> MakeCPRResponseObject(", Mutations: vecResponseMutations },
		{ Marker: "\tvoid QueueCPRRequest(", Mutations: vecRequestMutations },
	];
	let unRejectedMutationCount = 0;
	for (const MutationGroup of vecMutationGroups) {
		const strFunctionSource = ExtractNativeCPRFunction(strBindings, MutationGroup.Marker);
		for (const vecMutation of MutationGroup.Mutations) {
			const strOriginal = vecMutation[0];
			const strReplacement = vecMutation[1];
			const nMatchIndex = strFunctionSource.indexOf(strOriginal);
			Assert((nMatchIndex >= 0) && (nMatchIndex === strFunctionSource.lastIndexOf(strOriginal)), "native CPR mutation should target exactly one fragment");

			const strMutatedFunction = strFunctionSource.replace(strOriginal, strReplacement);
			const bNestedFunction = strBindings.includes(`\n\t\t${MutationGroup.Marker.trimStart()}`);
			const strOriginalSource = bNestedFunction ? strFunctionSource.replace(/^\t/gm, "\t\t") : strFunctionSource;
			const strMutatedSource = bNestedFunction ? strMutatedFunction.replace(/^\t/gm, "\t\t") : strMutatedFunction;
			Assert(strBindings.split(strOriginalSource).length === 2, "native CPR mutation should match exactly one actual function");

			const strMutatedBindings = strBindings.replace(strOriginalSource, strMutatedSource);
			Assert(strMutatedBindings !== strBindings, "native CPR mutation should change actual source");
			AssertThrows(() => VerifyNativeCPRContracts(strMutatedBindings), /native CPR/, `native CPR guard should reject: ${strOriginal}`);
			++unRejectedMutationCount;
		}
	}

	return unRejectedMutationCount;
}

async function VerifyCPRMockContracts() {
	for (const bBlocking of [false, true]) {
		for (const strMethodName of ["Get", "Head", "Post"]) {
			const Options = { URL: "https://sourcejs.invalid", Body: new Uint8Array([0, 128, 255]), Blocking: bBlocking };
			let unCallbackCount = 0;
			const ResponsePromise = new Promise((Resolve, Reject) => {
				g_Mocks.cpr[strMethodName](Options, (RequestError, Response) => {
					++unCallbackCount;

					if (RequestError) {
						Reject(RequestError);
						return;
					}

					Resolve(Response);
				});
			});
			Assert(unCallbackCount === (bBlocking ? 1 : 0), "CPR mock should respect deferred and Blocking callback timing");

			const Response = await ResponsePromise;
			Assert(unCallbackCount === 1, "CPR mock should invoke each successful callback once");
			Assert(Response.RedirectCount === 0n, "CPR mock RedirectCount should be bigint");
			Assert((typeof Response.UploadedBytes === "bigint") && (typeof Response.DownloadedBytes === "bigint"), "CPR mock transfer counts should be bigint");

			if (strMethodName === "Head") {
				Assert(Object.getPrototypeOf(Response.Headers) === null, "CPR HEAD mock should preserve a null-prototype header dictionary");
				Assert(Response.Headers.server === "mock", "CPR HEAD mock should preserve raw external header names");
			}

			if (strMethodName === "Post") {
				Assert(Response.UploadedBytes === 3n, "CPR POST mock should count the exact binary request bytes");
				Assert(Response.DownloadedBytes === 3n, "CPR POST mock should count the exact binary response bytes");
			}
		}
	}
}

function LoadExamplePlugin() {
	const OriginalModuleLoad = g_Module._load;
	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (Object.prototype.hasOwnProperty.call(g_Mocks, strRequestName)) {
			return g_Mocks[strRequestName];
		}

		return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	try {
		return require(g_strExamplePath);
	} finally {
		g_Module._load = OriginalModuleLoad;
	}
}

const g_PluginModule = LoadExamplePlugin();

function VerifyFailureReporting() {
	const strSource = g_FileSystem.readFileSync(__filename, "utf8");
	const vecHandlerMatches = strSource.match(/\nRunSmokeTest\(\)\.catch\(([\s\S]+)\);\s*$/);
	Assert(vecHandlerMatches, "Find the actual terminal smoke failure handler");

	for (const Failure of [null, undefined, false, 0, 0n, "primitive failure", Symbol("failure"), new Error("controlled reporter failure")]) {
		const vecReportedValues = [];
		const ProcessState = { exitCode: 0 };
		const Reporter = g_VM.runInNewContext("(" + vecHandlerMatches[1] + ")", {
			console: {
				error(Value) {
					vecReportedValues.push(Value);
				},
			},
			process: ProcessState,
		}, { filename: "SmokeFailureReporterFixture.js" });
		Reporter(Failure);
		const Expected = (Failure instanceof Error) ? Failure.stack : Failure;
		g_Assert.deepEqual(vecReportedValues, [Expected], "Report the original smoke failure without a secondary reporting exception");
		g_Assert.equal(ProcessState.exitCode, 1, "Smoke failures must produce a failing process status");
	}
}

async function RunSmokeTest() {
	VerifyFailureReporting();

	const strBindings = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
	VerifyNativeCPRContracts(strBindings);
	const unRejectedMutationCount = VerifyNativeCPRGuardMutations(strBindings);
	Assert(unRejectedMutationCount === 17, "CPR source guards should reject all seventeen read-only mutations");

	const vecRedisMethodNames = Object.getOwnPropertyNames(g_Mocks.redis);
	Assert((vecRedisMethodNames.length > 0) && vecRedisMethodNames.every((strMethodName) => strMethodName === strMethodName.toLowerCase()), "Redis mock must expose lowercase own method names without case aliases");
	Assert(typeof g_Mocks.redis.Get === "undefined", "Redis mock must not expose a PascalCase forwarding alias");

	Assert(g_mapCommandCallbacks.has("sjs_api_external"), "example should register sjs_api_external");
	await Invoke(["sjs_api_external"]);
	await Invoke(["sjs_api_external", "cpr", "https://sourcejs.invalid", "C:/sourcejs/data/example.bin"]);
	await Invoke(["sjs_api_external", "soci", "dbname=:memory:", "sqlite3", "select 1 as value", "demo", "demo_sequence"]);
	await Invoke(["sjs_api_external", "redis", "tcp://127.0.0.1:6379", "sourcejs:test"]);
	await Invoke(["sjs_api_external", "socket", "localhost", "27015", "0", "127", "128", "255"]);
	Assert(g_vecRecordedCalls.some((vecCall) => (vecCall[0] === "socket.Connect") && (vecCall[1] === "localhost") && (vecCall[2] === 27015)), "Socket example should connect to the requested TCP endpoint");
	Assert(g_vecRecordedCalls.some((vecCall) => (vecCall[0] === "socket.Send") && (vecCall[2].join(",") === "0,127,128,255")), "Socket example should send the requested byte array");
	Assert(g_vecRecordedCalls.some((vecCall) => (vecCall[0] === "socket.Send") && (vecCall[2].join(",") === "128,255")), "Socket example should retry the unsent suffix after a short write");
	Assert(g_vecLogMessages.some((vecEntry) => (vecEntry[0] === "info") && vecEntry[1].includes('"SentByteCount":4')), "Socket example should report all sent bytes");

	const unSocketConnectionsBefore = g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "socket.Connect").length;
	for (const vecInvalidArguments of [
		["localhost", "0", "1"],
		["localhost", "65536", "1"],
		["localhost", "1.5", "1"],
		["localhost", "NaN", "1"],
		["localhost", "27015"],
		["localhost", "27015", "-1"],
		["localhost", "27015", "256"],
		["localhost", "27015", "1.5"],
	]) {
		await Invoke(["sjs_api_external", "socket", ...vecInvalidArguments]);
	}

	Assert(g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "socket.Connect").length === unSocketConnectionsBefore, "Invalid socket ports/bytes should be rejected before a request");

	for (const nWriteByteCount of [0, -1, 5]) {
		const unClosesBefore = g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "socket.Close").length;
		const unReceivesBefore = g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "socket.Receive").length;
		g_nSocketForcedWriteByteCount = nWriteByteCount;
		g_unSocketForcedSendCount = 0;
		try {
			await Invoke(["sjs_api_external", "socket", "localhost", "27015", "0", "127", "128", "255"]);
			Assert(g_unSocketForcedSendCount === 1, "Socket example should reject invalid send progress without retrying");
		} finally {
			g_nSocketForcedWriteByteCount = null;
			g_unSocketForcedSendCount = 0;
		}

		Assert(g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "socket.Receive").length === unReceivesBefore, "Invalid socket send progress should not start a receive");
		Assert(g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "socket.Close").length === (unClosesBefore + 1), "Socket example should close after zero/negative/oversized send progress");
	}

	const unClosesBeforeReceiveFailure = g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "socket.Close").length;
	g_bSocketReceiveFails = true;
	try {
		await Invoke(["sjs_api_external", "socket", "localhost", "27015", "0", "127", "128", "255"]);
	} finally {
		g_bSocketReceiveFails = false;
	}

	Assert(g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "socket.Close").length === (unClosesBeforeReceiveFailure + 1), "Socket example should close after a receive error");

	const unRedisDeletesBefore = g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "redis.del").length;
	const unRedisClosesBefore = g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "redis.close").length;
	g_unRedisDeleteCallCount = 0;
	g_unRedisDeleteFailureIndex = 2;
	try {
		await Invoke(["sjs_api_external", "redis", "tcp://127.0.0.1:6379", "sourcejs:cleanup-failure"]);
	} finally {
		g_unRedisDeleteFailureIndex = 0;
		g_unRedisDeleteCallCount = 0;
	}

	Assert(g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "redis.del").length === (unRedisDeletesBefore + 7), "Redis example should attempt every owned key deletion even when the first cleanup deletion fails");
	Assert(g_vecRecordedCalls.filter((vecCall) => vecCall[0] === "redis.close").length === (unRedisClosesBefore + 1), "Redis example should close after key cleanup failure");
	Assert(g_vecLogMessages.some((vecEntry) => (vecEntry[0] === "error") && vecEntry[1].includes("External-library example failed")), "Redis example should report failure without disclosing native error details");

	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "cpr.get") && (vecRecordedCall[1].URL === "https://sourcejs.invalid") && (vecRecordedCall[1].ConnectionTimeout === 2000)), "CPR example should pass native request options");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "cpr.head") && (vecRecordedCall[1].URL === "https://sourcejs.invalid") && (vecRecordedCall[1].Cookies.sourcejs === "example")), "CPR example should pass headers and cookies");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "cpr.post") && (vecRecordedCall[1].Body instanceof Uint8Array)), "CPR example should send binary request bodies");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "filesystem.write") && (vecRecordedCall[2] instanceof Uint8Array)), "CPR example should persist raw response bytes explicitly");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "soci.connect") && (vecRecordedCall[2] === "sqlite3")), "SOCI example should pass backend as second argument");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "soci.query") && (vecRecordedCall[2] === "select 1 as value")), "SOCI example should query SQL");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "soci.query") && vecRecordedCall[3] && (vecRecordedCall[3].SourceJSValue === 7)), "SOCI example should use named parameters");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "soci.execute") && Array.isArray(vecRecordedCall[3]) && (vecRecordedCall[3][0] === 1)), "SOCI example should use positional parameters");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => vecRecordedCall[0] === "soci.backendName"), "SOCI example should read the backend name");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "soci.lastInsertId") && (vecRecordedCall[2] === "demo")), "SOCI example should expose last insert IDs");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "soci.nextSequenceValue") && (vecRecordedCall[2] === "demo_sequence")), "SOCI example should expose sequences");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "redis.connect") && (vecRecordedCall[1] === "tcp://127.0.0.1:6379")), "Redis example should connect");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "redis.command") && Array.isArray(vecRecordedCall[2]) && (vecRecordedCall[2][0] === "PING")), "Redis example should call command arrays");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => vecRecordedCall[0] === "redis.hset"), "Redis example should call hset");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => vecRecordedCall[0] === "redis.mset"), "Redis example should call mset");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "redis.lrange") && (vecRecordedCall[3] === 0n) && (vecRecordedCall[4] === -1n)), "Redis example should cover lists with signed 64-bit BigInt indices");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => vecRecordedCall[0] === "redis.smembers"), "Redis example should cover sets");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => vecRecordedCall[0] === "redis.publish"), "Redis example should cover publish");

	const vecRequestContracts = g_vecRecordedCalls.filter((vecRecordedCall) => vecRecordedCall[0] === "request.contract");
	Assert(vecRequestContracts.length > 0, "example should issue native requests");
	Assert(vecRequestContracts.every((vecRecordedCall) => (vecRecordedCall[4] === "function") && vecRecordedCall[3] && (typeof vecRecordedCall[3] === "object") && !Array.isArray(vecRecordedCall[3])), "all native requests should provide options and callbacks");

	await VerifyCPRMockContracts();

	const vecSocketBytes = [0, 127, 128, 255];
	let unSentByteCount = 0;
	g_Mocks.socket.Send(g_hSocketConnection, vecSocketBytes, { Blocking: true }, (RequestError, unResult) => {
		Assert(RequestError === null, "Socket send should succeed");
		unSentByteCount = unResult;
	});
	Assert(unSentByteCount === Math.min(vecSocketBytes.length, g_unSocketMaximumWriteByteCount), "Blocking socket send should deliver its short-write result before returning");

	let arrReceivedBytes = null;
	g_Mocks.socket.Receive(g_hSocketConnection, vecSocketBytes.length, {}, (RequestError, arrResult) => {
		Assert(RequestError === null, "Socket receive should succeed");
		arrReceivedBytes = arrResult;
	});
	Assert(arrReceivedBytes === null, "default socket receive should defer its callback");
	await Promise.resolve();

	Assert(arrReceivedBytes instanceof Uint8Array, "Socket receive should return bytes, not text");
	Assert(arrReceivedBytes.join(",") === vecSocketBytes.join(","), "Socket receive should preserve all byte values");

	let bSocketClosed = false;
	g_Mocks.socket.Close(g_hSocketConnection, {}, (RequestError, bResult) => {
		Assert(RequestError === null, "Socket close should succeed");
		bSocketClosed = bResult;
	});
	Assert(!bSocketClosed, "default socket close should defer its callback");
	await Promise.resolve();

	Assert(bSocketClosed, "Socket close should report a closed connection");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "socket.Send") && (vecRecordedCall[2].join(",") === "0,127,128,255")), "Socket send should preserve unsigned byte values");
	Assert(g_vecRecordedCalls.some((vecRecordedCall) => (vecRecordedCall[0] === "socket.Receive") && (vecRecordedCall[3] instanceof Uint8Array)), "Socket receive should expose Uint8Array bytes");

	AssertThrows(() => g_Mocks.redis.get(g_hRedisConnection, "key", {}, null), /must receive a callback/, "Redis callback should be required");
	AssertThrows(() => g_Mocks.redis.get(g_hRedisConnection, "key", null, () => {}), /must receive an options object/, "Redis options should be required");
	AssertThrows(() => g_Mocks.soci.Query(g_hSOCIConnection, "select 1", {}, null), /must receive a callback/, "SOCI callback should be required");
	AssertThrows(() => g_Mocks.soci.Query(g_hSOCIConnection, "select 1", null, () => {}), /must receive an options object/, "SOCI options should be required");
	AssertThrows(() => g_Mocks.cpr.Get({ URL: "https://sourcejs.invalid" }), /must receive a callback/, "CPR callback should be required");
	AssertThrows(() => g_Mocks.cpr.Get(null, () => {}), /must receive an options object/, "CPR options should be required");
	AssertThrows(() => g_Mocks.socket.Connect("localhost", 27015, {}, null), /must receive a callback/, "Socket callback should be required");
	AssertThrows(() => g_Mocks.socket.Connect("localhost", 27015, null, () => {}), /must receive an options object/, "Socket options should be required");
	AssertThrows(() => g_Mocks.socket.Send(g_hSocketConnection, vecSocketBytes, {}, null), /must receive a callback/, "Socket send callback should be required");
	AssertThrows(() => g_Mocks.socket.Send(g_hSocketConnection, vecSocketBytes, null, () => {}), /must receive an options object/, "Socket send options should be required");
	AssertThrows(() => g_Mocks.socket.Receive(g_hSocketConnection, 4, {}, null), /must receive a callback/, "Socket receive callback should be required");
	AssertThrows(() => g_Mocks.socket.Receive(g_hSocketConnection, 4, null, () => {}), /must receive an options object/, "Socket receive options should be required");
	AssertThrows(() => g_Mocks.socket.Close(g_hSocketConnection, {}, null), /must receive a callback/, "Socket close callback should be required");
	AssertThrows(() => g_Mocks.socket.Close(g_hSocketConnection, null, () => {}), /must receive an options object/, "Socket close options should be required");

	await VerifyExampleResourceContracts();

	Assert(typeof g_PluginModule.Unload === "function", "canonical lifecycle export must exist");
	Assert(!Object.hasOwn(g_PluginModule, "unload"), "no lowercase lifecycle alias");
	g_PluginModule.Unload();

	Assert(!g_mapCommandCallbacks.has("sjs_api_external"), "example unload should unregister command");
	Assert(g_vecLogMessages.some((vecEntry) => (vecEntry[0] === "info") && vecEntry[1].includes("loaded")), "example should log load message");

	console.log("[smoke_api_external_libraries] ok; Node request doubles + " + unRejectedMutationCount + " read-only CPR source mutations; native IO/V8/game-thread delivery not exercised");
}

RunSmokeTest().catch((TestError) => {
	console.error(TestError?.stack || TestError);
	process.exitCode = 1;
});
