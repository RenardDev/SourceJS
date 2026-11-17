"use strict";

const { Get, Head, Post } = require("cpr");
const { DoesFileExist, RemoveFile, SourceFile } = require("filesystem");
const { LogError, LogInfo, LogWarning } = require("loggers");
const { DATA_ROOT } = require("paths");
const g_Redis = require("redis");
const {
	Begin,
	Close,
	Commit,
	Connect,
	Execute,
	GetBackendName,
	GetNextSequenceValue,
	IsConnected,
	LastInsertId,
	Query,
	Reconnect,
	Rollback,
} = require("soci");
const { Close: g_CloseSocket, Connect: g_ConnectSocket, Receive, Send } = require("socket");
const { RegisterCommand, UnregisterCommand } = require("source");

const g_strCommandName = "sjs_api_external";
const g_unHTTPTimeoutMilliseconds = 5000;
const g_unHTTPConnectionTimeoutMilliseconds = 2000;
const g_unMaximumRedirects = 5;
const g_unHeaderPreviewEntryLimit = 6;
const g_nRedisExpirationSeconds = 60;
const g_setPendingResources = new Set();
let g_unRedisExampleSequence = 0n;
let g_bCleaning = false;
let g_bUnloading = false;

function TrackResource(strName, Release) {
	const Resource = { Name: strName, Release: Release, Releasing: false };
	g_setPendingResources.add(Resource);

	return Resource;
}

function ReleaseResource(Resource) {
	if (!g_setPendingResources.has(Resource) || Resource.Releasing) {
		return;
	}

	Resource.Releasing = true;
	try {
		if (Resource.Release() !== true) {
			throw new Error(`Could not release ${Resource.Name}.`);
		}

		g_setPendingResources.delete(Resource);
	} finally {
		Resource.Releasing = false;
	}
}

function UseResource(strName, Release, Use) {
	const Resource = TrackResource(strName, Release);
	let bOperationFailed = false;
	let OperationError = undefined;
	try {
		return Use();
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
		throw CaughtError;
	} finally {
		try {
			ReleaseResource(Resource);
		} catch (CleanupError) {
			if (bOperationFailed) {
				throw new AggregateError([OperationError, CleanupError], `${strName} operation and cleanup failed.`);
			}

			throw CleanupError;
		}
	}
}

async function UseAsyncResource(strName, Use, Release) {
	let bOperationFailed = false;
	let OperationError = undefined;
	try {
		return await Use();
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
		throw CaughtError;
	} finally {
		try {
			await Release();
		} catch (CleanupError) {
			if (bOperationFailed) {
				throw new AggregateError([OperationError, CleanupError], `${strName} operation and cleanup failed.`);
			}

			throw CleanupError;
		}
	}
}

function GetCommandArguments(InputCommand) {
	return InputCommand.Arguments.slice(1);
}

function ConvertBigIntToString(...vecArguments) {
	const Value = vecArguments[1];

	return (typeof Value === "bigint") ? `${Value}n` : Value;
}

function SummarizeValue(Value) {
	if (Value === undefined) {
		return "undefined";
	}

	if (Value === null) {
		return "null";
	}

	if (typeof Value === "object") {
		return JSON.stringify(Value, ConvertBigIntToString);
	}

	return String(Value);
}

function CreateRequestPromise(Options, StartRequest, OnResult = null) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			try {
				if (RequestError !== null) {
					throw RequestError;
				}

				if (OnResult !== null) {
					OnResult(Result);
				}

				Resolve(Result);
			} catch (CompletionError) {
				Reject(CompletionError);
			}
		});
	});
}

function AwaitRequest(Options, StartRequest) {
	if (g_bUnloading) {
		throw new Error("The external-library example is unloading.");
	}

	return CreateRequestPromise(Options, StartRequest);
}

function RunBlockingRequest(StartRequest) {
	let bCompleted = false;
	let RequestError = null;
	let Result = undefined;
	StartRequest({ Blocking: true }, (ErrorValue, ResultValue) => {
		bCompleted = true;
		RequestError = ErrorValue;
		Result = ResultValue;
	});

	if (!bCompleted) {
		throw new Error("Blocking cleanup did not deliver its required callback.");
	}

	if (RequestError !== null) {
		throw RequestError;
	}

	return Result;
}

function TrackConnection(strName, StartClose) {
	const Resource = TrackResource(strName, () => {
		const bClosed = RunBlockingRequest(StartClose);
		if (typeof bClosed !== "boolean") {
			throw new TypeError(`${strName} close returned an invalid status.`);
		}

		// False means the handle is already absent/closing; native workers retain any in-flight ownership.
		return true;
	});
	Resource.StartClose = StartClose;

	return Resource;
}

async function CloseTrackedConnection(Resource) {
	if (!g_setPendingResources.has(Resource)) {
		return;
	}

	const bClosed = await CreateRequestPromise({}, Resource.StartClose, (Result) => {
		if (typeof Result !== "boolean") {
			throw new TypeError(`${Resource.Name} close returned an invalid status.`);
		}

		g_setPendingResources.delete(Resource);
	});
	if (!bClosed) {
		throw new Error(`Unable to close ${Resource.Name}.`);
	}
}

function LogRequestResult(strLabel, Result) {
	if (!g_bUnloading) {
		LogInfo("%s", `${strLabel}: ${SummarizeValue(Result)}`);
	}

	return Result;
}

function LogQueryResult(strLabel, vecRows) {
	LogRequestResult(strLabel, { RowCount: vecRows.length });

	return vecRows;
}

function ShowUsage() {
	LogInfo(`Use "${g_strCommandName} cpr <url> [output-path]".`);
	LogInfo(`Use "${g_strCommandName} soci <connection-string> [backend] [sql] [table] [sequence]".`);
	LogInfo(`MySQL/MariaDB: "${g_strCommandName} soci \"host=127.0.0.1 db=test user=root password=secret\" mysql".`);
	LogInfo(`Use "${g_strCommandName} redis <uri> [namespace]".`);
	LogInfo(`Use "${g_strCommandName} socket <host> <port> <byte> [byte ...]" with a responding TCP server.`);
	LogWarning("Use isolated test services and non-sensitive data: console command text may be recorded. Unloading does not roll back remote HTTP, SQL or Redis side effects.");
}

function WriteDownload(strOutputPath, arrBytes) {
	if (g_bUnloading) {
		throw new Error("The external-library example is unloading.");
	}

	// The Source filesystem has no exclusive-create contract here; this demo requires no concurrent writers.
	if (DoesFileExist(strOutputPath)) {
		throw new Error("Refusing to overwrite an existing download file.");
	}

	let OutputFile = null;
	let bWriteComplete = false;
	let unBytesWritten = 0;
	UseResource("download output", () => {
		if (OutputFile && !OutputFile.Closed && !OutputFile.CloseSourceFile()) {
			return false;
		}

		return bWriteComplete || !DoesFileExist(strOutputPath) || RemoveFile(strOutputPath);
	}, () => {
		OutputFile = SourceFile.OpenSourceFile(strOutputPath, "wb");
		unBytesWritten = OutputFile.WriteSourceFile(arrBytes);
		if (unBytesWritten !== arrBytes.byteLength) {
			throw new Error("The complete binary response could not be written.");
		}

		bWriteComplete = true;
	});

	return unBytesWritten;
}

async function RunCPR(vecCommandArguments) {
	const strURL = vecCommandArguments[1];
	if ((vecCommandArguments.length < 2) || (vecCommandArguments.length > 3) || !strURL) {
		LogWarning(`Use "${g_strCommandName} cpr <url> [output-path]".`);
		return;
	}

	const strOutputPath = vecCommandArguments[2] || `${DATA_ROOT}/api-external-libraries.bin`;
	if (DoesFileExist(strOutputPath)) {
		throw new Error("Refusing to overwrite an existing download file.");
	}

	const HTTPResponse = await AwaitRequest({
		URL: strURL,
		Parameters: { sourcejs: "1" },
		Timeout: g_unHTTPTimeoutMilliseconds,
		ConnectionTimeout: g_unHTTPConnectionTimeoutMilliseconds,
		FollowRedirects: true,
		MaximumRedirects: g_unMaximumRedirects,
		UserAgent: "SourceJS/api-external-libraries",
		VerifySSL: true,
	}, (Options, Callback) => Get(Options, Callback));
	LogRequestResult("cpr.Get", {
		ByteLength: HTTPResponse.Bytes.byteLength,
		ElapsedMilliseconds: HTTPResponse.ElapsedMilliseconds,
		ErrorCode: HTTPResponse.ErrorCode,
		OK: HTTPResponse.OK,
		StatusCode: HTTPResponse.StatusCode,
	});

	const HeadResponse = await AwaitRequest({
		URL: strURL,
		Timeout: g_unHTTPTimeoutMilliseconds,
		ConnectionTimeout: g_unHTTPConnectionTimeoutMilliseconds,
		Headers: { "X-SourceJS-Example": "1" },
		Cookies: { sourcejs: "example" },
	}, (Options, Callback) => Head(Options, Callback));
	LogRequestResult("cpr.Head", { HeaderNames: Object.keys(HeadResponse.Headers).slice(0, g_unHeaderPreviewEntryLimit), OK: HeadResponse.OK, StatusCode: HeadResponse.StatusCode });

	const PostResponse = await AwaitRequest({
		URL: strURL,
		Timeout: g_unHTTPTimeoutMilliseconds,
		ConnectionTimeout: g_unHTTPConnectionTimeoutMilliseconds,
		Body: new Uint8Array([0x00, 0x01, 0x02, 0x7F, 0xFF]),
		Headers: { "Content-Type": "application/octet-stream" },
		VerifySSL: true,
	}, (Options, Callback) => Post(Options, Callback));
	LogRequestResult("cpr.Post binary", {
		ByteLength: PostResponse.Bytes.byteLength,
		DownloadedBytes: PostResponse.DownloadedBytes,
		ErrorCode: PostResponse.ErrorCode,
		OK: PostResponse.OK,
		StatusCode: PostResponse.StatusCode,
		UploadedBytes: PostResponse.UploadedBytes,
	});

	const FileResponse = await AwaitRequest({ URL: strURL, Timeout: g_unHTTPTimeoutMilliseconds, ConnectionTimeout: g_unHTTPConnectionTimeoutMilliseconds, VerifySSL: true }, (Options, Callback) => Get(Options, Callback));
	if (g_bUnloading) {
		return;
	}

	if (!FileResponse.OK) {
		LogError(`Unable to fetch binary response: Status=${FileResponse.StatusCode}; Error=${FileResponse.ErrorCode}.`);
		return;
	}

	const unBytesWritten = WriteDownload(strOutputPath, FileResponse.Bytes);
	LogRequestResult("cpr.Get binary file", { BytesWritten: unBytesWritten, Destination: strOutputPath, DownloadedBytes: FileResponse.DownloadedBytes, StatusCode: FileResponse.StatusCode });
}

async function UseSOCITransaction(hSOCIConnection, bCommit, Use) {
	if (await AwaitRequest({}, (Options, Callback) => Begin(hSOCIConnection, Options, Callback)) !== true) {
		throw new Error("The SOCI transaction did not begin.");
	}

	let bFinished = false;

	return UseAsyncResource("SOCI transaction", async () => {
		LogRequestResult(bCommit ? "soci.Begin commit transaction" : "soci.Begin rollback transaction", true);
		const Result = await Use();
		const Complete = bCommit ? Commit : Rollback;
		if (await AwaitRequest({}, (Options, Callback) => Complete(hSOCIConnection, Options, Callback)) !== true) {
			throw new Error("The SOCI transaction did not finish.");
		}

		bFinished = true;
		LogRequestResult(bCommit ? "soci.Commit" : "soci.Rollback", true);

		return Result;
	}, async () => {
		if (!bFinished && (await CreateRequestPromise({}, (Options, Callback) => Rollback(hSOCIConnection, Options, Callback)) !== true)) {
			throw new Error("The SOCI transaction could not be rolled back.");
		}
	});
}

async function RunSOCI(vecCommandArguments) {
	const strConnectionString = vecCommandArguments[1] || "";
	if ((vecCommandArguments.length < 2) || (vecCommandArguments.length > 6) || !strConnectionString) {
		LogWarning(`Use "${g_strCommandName} soci <connection-string> [backend] [sql] [table] [sequence]".`);
		return;
	}

	const strBackendName = vecCommandArguments[2] || "";
	const strSQLStatement = vecCommandArguments[3] || "select 1 as Value";
	const hSOCIConnection = await AwaitRequest({}, (Options, Callback) => {
		if (strBackendName) {
			Connect(strConnectionString, strBackendName, Options, Callback);
			return;
		}

		Connect(strConnectionString, Options, Callback);
	});
	const Resource = TrackConnection("SOCI session", (Options, Callback) => Close(hSOCIConnection, Options, Callback));

	return UseAsyncResource("SOCI workflow", async () => {
		LogRequestResult("soci.IsConnected", await AwaitRequest({}, (Options, Callback) => IsConnected(hSOCIConnection, Options, Callback)));
		LogRequestResult("soci.GetBackendName", await AwaitRequest({}, (Options, Callback) => GetBackendName(hSOCIConnection, Options, Callback)));
		LogQueryResult("soci.Query", await AwaitRequest({}, (Options, Callback) => Query(hSOCIConnection, strSQLStatement, Options, Callback)));
		LogQueryResult("soci.Query named parameters", await AwaitRequest({}, (Options, Callback) => Query(hSOCIConnection, "select :SourceJSValue as SourceJSValue", { SourceJSValue: 7 }, Options, Callback)));
		await UseSOCITransaction(hSOCIConnection, true, async () => {
			LogRequestResult("soci.Execute positional parameters", await AwaitRequest({}, (Options, Callback) => Execute(hSOCIConnection, "select ?", [1], Options, Callback)));
		});
		await UseSOCITransaction(hSOCIConnection, false, () => undefined);

		if (vecCommandArguments[4]) {
			LogRequestResult("soci.LastInsertId", await AwaitRequest({}, (Options, Callback) => LastInsertId(hSOCIConnection, vecCommandArguments[4], Options, Callback)));
		}

		if (vecCommandArguments[5]) {
			LogRequestResult("soci.GetNextSequenceValue", await AwaitRequest({}, (Options, Callback) => GetNextSequenceValue(hSOCIConnection, vecCommandArguments[5], Options, Callback)));
		}

		LogRequestResult("soci.Reconnect", await AwaitRequest({}, (Options, Callback) => Reconnect(hSOCIConnection, Options, Callback)));

		const bIsConnected = await AwaitRequest({}, (Options, Callback) => IsConnected(hSOCIConnection, Options, Callback));
		if (!bIsConnected) {
			throw new Error("The SOCI session remained disconnected after Reconnect().");
		}
	}, () => CloseTrackedConnection(Resource));
}

async function RunRedis(vecCommandArguments) {
	const strURI = vecCommandArguments[1] || "";
	if ((vecCommandArguments.length < 2) || (vecCommandArguments.length > 3) || !strURI) {
		LogWarning(`Use "${g_strCommandName} redis <uri> [namespace]".`);
		return;
	}

	const strNamespace = vecCommandArguments[2] || "sourcejs:api-external-libraries";
	const hRedisConnection = await AwaitRequest({}, (Options, Callback) => g_Redis.connect(strURI, Options, Callback));
	const Resource = TrackConnection("Redis client", (Options, Callback) => g_Redis.close(hRedisConnection, Options, Callback));
	let vecOwnedKeys = [];

	return UseAsyncResource("Redis workflow", async () => {
		const strKey = `${strNamespace}:${hRedisConnection}:${Date.now()}:${g_unRedisExampleSequence++}`;
		const strSecondKey = `${strKey}:second`;
		const strCounterKey = `${strKey}:counter`;
		const strHashKey = `${strKey}:hash`;
		const strListKey = `${strKey}:list`;
		const strSetKey = `${strKey}:set`;
		const vecCandidateKeys = [strKey, strSecondKey, strCounterKey, strHashKey, strListKey, strSetKey];
		// Use an exclusively owned test namespace. These checks do not atomically reserve keys against other clients.
		for (const strCandidateKey of vecCandidateKeys) {
			if (await AwaitRequest({}, (Options, Callback) => g_Redis.exists(hRedisConnection, strCandidateKey, Options, Callback))) {
				throw new Error("Refusing to overwrite an existing Redis example key.");
			}
		}

		vecOwnedKeys = vecCandidateKeys;
		LogRequestResult("redis.ping", await AwaitRequest({}, (Options, Callback) => g_Redis.ping(hRedisConnection, Options, Callback)));
		LogRequestResult("redis.command", await AwaitRequest({}, (Options, Callback) => g_Redis.command(hRedisConnection, ["PING"], Options, Callback)));
		LogRequestResult("redis.dbsize", await AwaitRequest({}, (Options, Callback) => g_Redis.dbsize(hRedisConnection, Options, Callback)));
		LogRequestResult("redis.mset", await AwaitRequest({}, (Options, Callback) => g_Redis.mset(hRedisConnection, { [strKey]: "SourceJS", [strSecondKey]: "JavaScript" }, Options, Callback)));
		LogRequestResult("redis.set", await AwaitRequest({}, (Options, Callback) => g_Redis.set(hRedisConnection, strCounterKey, "0", Options, Callback)));
		LogRequestResult("redis.mget", await AwaitRequest({}, (Options, Callback) => g_Redis.mget(hRedisConnection, [strKey, strSecondKey], Options, Callback)));
		LogRequestResult("redis.get", await AwaitRequest({}, (Options, Callback) => g_Redis.get(hRedisConnection, strKey, Options, Callback)));
		LogRequestResult("redis.exists", await AwaitRequest({}, (Options, Callback) => g_Redis.exists(hRedisConnection, strKey, Options, Callback)));
		LogRequestResult("redis.type", await AwaitRequest({}, (Options, Callback) => g_Redis.type(hRedisConnection, strKey, Options, Callback)));
		let strKeyPattern = "";
		for (const strCharacter of strKey) {
			if ("\\*?[]".includes(strCharacter)) {
				strKeyPattern += "\\";
			}

			strKeyPattern += strCharacter;
		}

		LogRequestResult("redis.keys", await AwaitRequest({}, (Options, Callback) => g_Redis.keys(hRedisConnection, `${strKeyPattern}*`, Options, Callback)));
		LogRequestResult("redis.hset", await AwaitRequest({}, (Options, Callback) => g_Redis.hset(hRedisConnection, strHashKey, "Field", "Value", Options, Callback)));
		LogRequestResult("redis.hget", await AwaitRequest({}, (Options, Callback) => g_Redis.hget(hRedisConnection, strHashKey, "Field", Options, Callback)));
		LogRequestResult("redis.hexists", await AwaitRequest({}, (Options, Callback) => g_Redis.hexists(hRedisConnection, strHashKey, "Field", Options, Callback)));
		LogRequestResult("redis.hlen", await AwaitRequest({}, (Options, Callback) => g_Redis.hlen(hRedisConnection, strHashKey, Options, Callback)));
		LogRequestResult("redis.hgetall", await AwaitRequest({}, (Options, Callback) => g_Redis.hgetall(hRedisConnection, strHashKey, Options, Callback)));
		LogRequestResult("redis.hdel", await AwaitRequest({}, (Options, Callback) => g_Redis.hdel(hRedisConnection, strHashKey, "Field", Options, Callback)));
		LogRequestResult("redis.incr", await AwaitRequest({}, (Options, Callback) => g_Redis.incr(hRedisConnection, strCounterKey, Options, Callback)));
		LogRequestResult("redis.incrby", await AwaitRequest({}, (Options, Callback) => g_Redis.incrby(hRedisConnection, strCounterKey, 5n, Options, Callback)));
		LogRequestResult("redis.decr", await AwaitRequest({}, (Options, Callback) => g_Redis.decr(hRedisConnection, strCounterKey, Options, Callback)));
		LogRequestResult("redis.expire", await AwaitRequest({}, (Options, Callback) => g_Redis.expire(hRedisConnection, strCounterKey, g_nRedisExpirationSeconds, Options, Callback)));
		LogRequestResult("redis.ttl", await AwaitRequest({}, (Options, Callback) => g_Redis.ttl(hRedisConnection, strCounterKey, Options, Callback)));
		LogRequestResult("redis.persist", await AwaitRequest({}, (Options, Callback) => g_Redis.persist(hRedisConnection, strCounterKey, Options, Callback)));
		LogRequestResult("redis.rpush", await AwaitRequest({}, (Options, Callback) => g_Redis.rpush(hRedisConnection, strListKey, ["a", "b"], Options, Callback)));
		LogRequestResult("redis.lpush", await AwaitRequest({}, (Options, Callback) => g_Redis.lpush(hRedisConnection, strListKey, "first", Options, Callback)));
		LogRequestResult("redis.lrange", await AwaitRequest({}, (Options, Callback) => g_Redis.lrange(hRedisConnection, strListKey, 0n, -1n, Options, Callback)));
		LogRequestResult("redis.lpop", await AwaitRequest({}, (Options, Callback) => g_Redis.lpop(hRedisConnection, strListKey, Options, Callback)));
		LogRequestResult("redis.rpop", await AwaitRequest({}, (Options, Callback) => g_Redis.rpop(hRedisConnection, strListKey, Options, Callback)));
		LogRequestResult("redis.sadd", await AwaitRequest({}, (Options, Callback) => g_Redis.sadd(hRedisConnection, strSetKey, ["a", "b"], Options, Callback)));
		LogRequestResult("redis.smembers", await AwaitRequest({}, (Options, Callback) => g_Redis.smembers(hRedisConnection, strSetKey, Options, Callback)));
		LogRequestResult("redis.srem", await AwaitRequest({}, (Options, Callback) => g_Redis.srem(hRedisConnection, strSetKey, "a", Options, Callback)));
		LogRequestResult("redis.publish", await AwaitRequest({}, (Options, Callback) => g_Redis.publish(hRedisConnection, `${strKey}:Channel`, "SourceJS", Options, Callback)));

		LogRequestResult("redis.del", await AwaitRequest({}, (Options, Callback) => g_Redis.del(hRedisConnection, strKey, Options, Callback)));
	}, async () => {
		const vecCleanupErrors = [];
		if (g_setPendingResources.has(Resource)) {
			for (const strOwnedKey of vecOwnedKeys) {
				try {
					await CreateRequestPromise({}, (Options, Callback) => g_Redis.del(hRedisConnection, strOwnedKey, Options, Callback));
				} catch (CleanupError) {
					vecCleanupErrors.push(CleanupError);
				}
			}
		}

		try {
			await CloseTrackedConnection(Resource);
		} catch (CloseError) {
			vecCleanupErrors.push(CloseError);
		}

		if (vecCleanupErrors.length > 0) {
			throw new AggregateError(vecCleanupErrors, "Unable to clean up the Redis example.");
		}
	});
}

async function RunSocket(vecCommandArguments) {
	const unMaximumPort = 65535;
	const unMaximumByteValue = 0xFF;
	const strHost = vecCommandArguments[1] || "";
	const nPort = Number(vecCommandArguments[2]);
	const vecBytes = vecCommandArguments.slice(3).map(Number);
	if (!strHost || !Number.isInteger(nPort) || (nPort < 1) || (nPort > unMaximumPort) || (vecBytes.length === 0) || vecBytes.some((nByte) => !Number.isInteger(nByte) || (nByte < 0) || (nByte > unMaximumByteValue))) {
		LogWarning(`Use "${g_strCommandName} socket <host> <port> <byte> [byte ...]"; ports must be 1-65535 and bytes 0-255.`);
		return;
	}

	const hSocketConnection = await AwaitRequest({}, (Options, Callback) => g_ConnectSocket(strHost, nPort, Options, Callback));
	const Resource = TrackConnection("socket connection", (Options, Callback) => g_CloseSocket(hSocketConnection, Options, Callback));

	return UseAsyncResource("socket workflow", async () => {
		let unSentByteCount = 0;
		while (unSentByteCount < vecBytes.length) {
			const unRemainingByteCount = vecBytes.length - unSentByteCount;
			const unWrittenByteCount = await AwaitRequest({}, (Options, Callback) => Send(hSocketConnection, vecBytes.slice(unSentByteCount), Options, Callback));
			if (!Number.isInteger(unWrittenByteCount) || (unWrittenByteCount <= 0) || (unWrittenByteCount > unRemainingByteCount)) {
				throw new Error("The socket did not make valid progress while sending the byte array.");
			}

			unSentByteCount += unWrittenByteCount;
		}

		const arrReceivedBytes = await AwaitRequest({}, (Options, Callback) => Receive(hSocketConnection, vecBytes.length, Options, Callback));
		LogRequestResult("socket.Send/Receive", { ReceivedByteCount: arrReceivedBytes.byteLength, SentByteCount: unSentByteCount });
	}, () => CloseTrackedConnection(Resource));
}

async function RunExternalExample(InputCommand) {
	if (g_bUnloading) {
		return;
	}

	const vecCommandArguments = GetCommandArguments(InputCommand);
	try {
		if (vecCommandArguments[0] === "cpr") {
			await RunCPR(vecCommandArguments);
			return;
		}

		if (vecCommandArguments[0] === "soci") {
			await RunSOCI(vecCommandArguments);
			return;
		}

		if (vecCommandArguments[0] === "redis") {
			await RunRedis(vecCommandArguments);
			return;
		}

		if (vecCommandArguments[0] === "socket") {
			await RunSocket(vecCommandArguments);
			return;
		}

		ShowUsage();
	} catch {
		if (!g_bUnloading) {
			// Native errors, URLs, connection strings and arbitrary query rows can contain credentials or private data.
			LogError("External-library example failed; request and cleanup details are omitted to protect sensitive data.");
		}
	}
}

function Cleanup() {
	g_bUnloading = true;

	if (g_bCleaning) {
		return;
	}

	g_bCleaning = true;
	const vecErrors = [];
	try {
		// Unload is synchronous: known handles use Blocking + Callback; accepted remote operations are not rolled back.
		for (const Resource of [...g_setPendingResources].reverse()) {
			try {
				ReleaseResource(Resource);
			} catch (CleanupError) {
				vecErrors.push(CleanupError);
			}
		}
	} finally {
		g_bCleaning = false;
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "External-library example cleanup failed.");
	}
}

exports.Unload = Cleanup;

try {
	if (!RegisterCommand(g_strCommandName, RunExternalExample)) {
		throw new Error(`Unable to register the ${g_strCommandName} command.`);
	}

	TrackResource("external-library command", () => UnregisterCommand(g_strCommandName, RunExternalExample));
	LogInfo(`Plugin loaded; run "${g_strCommandName}".`);
} catch (ErrorValue) {
	try {
		Cleanup();
	} catch (CleanupError) {
		throw new AggregateError([ErrorValue, CleanupError], "External-library example startup and cleanup failed.");
	}

	throw ErrorValue;
}
