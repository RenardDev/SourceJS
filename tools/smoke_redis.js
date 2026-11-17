#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "redis.md");
const g_strModuleBindingsSourcePath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_unExpectedCodeBlockCount = 6;
const g_unRequestControlArgumentCount = 2;
const g_unIncrementArgumentIndex = 2;
const g_unListStartArgumentIndex = 2;
const g_unListStopArgumentIndex = 3;
const g_nMinimumInt64 = -(1n << 63n);
const g_nMaximumInt64 = (1n << 63n) - 1n;

const g_vecExpectedExports = [
	"close",
	"command",
	"connect",
	"dbsize",
	"decr",
	"del",
	"exists",
	"expire",
	"get",
	"hdel",
	"hexists",
	"hget",
	"hgetall",
	"hlen",
	"hset",
	"incr",
	"incrby",
	"keys",
	"lpop",
	"lpush",
	"lrange",
	"mget",
	"mset",
	"persist",
	"ping",
	"publish",
	"rpop",
	"rpush",
	"sadd",
	"set",
	"smembers",
	"srem",
	"ttl",
	"type",
];

const g_mapActiveHandles = new Map();
const g_mapDatabase = new Map();
const g_vecRecordedCalls = [];

let g_unNextHandle = 1;

function AssertHandle(hHandle) {
	g_Assert.ok(Number.isInteger(hHandle) && (hHandle > 0) && g_mapActiveHandles.has(hHandle), `active Redis handle expected: ${hHandle}`);
}

function SetStringRecord(strKey, strValue) {
	g_mapDatabase.set(strKey, { TTL: null, Type: "string", Value: strValue });
}

function ToArray(Value) {
	return Array.isArray(Value) ? Value : [Value];
}

function GetOrCreateRecord(strKey, strType, CreateValue) {
	const ExistingRecord = g_mapDatabase.get(strKey);
	if (ExistingRecord) {
		g_Assert.equal(ExistingRecord.Type, strType, `Redis key ${strKey} type`);
		return ExistingRecord;
	}

	const RecordValue = { TTL: null, Type: strType, Value: CreateValue() };
	g_mapDatabase.set(strKey, RecordValue);

	return RecordValue;
}

function GetTypedRecord(strKey, strType) {
	const RecordValue = g_mapDatabase.get(strKey);
	if (!RecordValue) {
		return null;
	}

	g_Assert.equal(RecordValue.Type, strType, `Redis key ${strKey} type`);

	return RecordValue;
}

function RequireRedisInt64Argument(nValue, strMethodName, strArgumentName) {
	if (typeof nValue !== "bigint") {
		throw new TypeError(`${strMethodName} ${strArgumentName} requires a signed 64-bit BigInt.`);
	}

	if ((nValue < g_nMinimumInt64) || (nValue > g_nMaximumInt64)) {
		throw new RangeError(`${strMethodName} ${strArgumentName} exceeds the signed 64-bit range.`);
	}
}

function ChangeInteger(hHandle, strKey, nIncrement) {
	AssertHandle(hHandle);

	const RecordValue = g_mapDatabase.get(strKey);
	const nCurrentValue = RecordValue ? BigInt(RecordValue.Value) : 0n;
	const nNextValue = nCurrentValue + nIncrement;
	if ((nNextValue < g_nMinimumInt64) || (nNextValue > g_nMaximumInt64)) {
		throw new RangeError("Redis signed 64-bit integer overflow.");
	}

	SetStringRecord(strKey, String(nNextValue));

	return nNextValue;
}

function NormalizeListIndex(nIndex, unLength) {
	if (nIndex < 0n) {
		return BigInt(unLength) + nIndex;
	}

	return nIndex;
}

function PopListValue(strKey, bFromRight) {
	const RecordValue = GetTypedRecord(strKey, "list");
	if (!RecordValue || (RecordValue.Value.length === 0)) {
		return null;
	}

	const strValue = bFromRight ? RecordValue.Value.pop() : RecordValue.Value.shift();
	if (RecordValue.Value.length === 0) {
		g_mapDatabase.delete(strKey);
	}

	return strValue;
}

const g_RedisOperations = {
	Close(hHandle) {
		g_vecRecordedCalls.push(["Close", hHandle]);

		return g_mapActiveHandles.delete(hHandle);
	},

	ExecuteCommand(hHandle, CommandValue, ...vecCommandArguments) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["ExecuteCommand", hHandle, CommandValue, vecCommandArguments]);

		const vecParts = Array.isArray(CommandValue) ? CommandValue : [CommandValue, ...vecCommandArguments];
		const strCommandName = vecParts[0].toUpperCase();
		if (strCommandName === "ECHO") {
			return vecParts[1];
		}

		if (strCommandName === "PING") {
			return vecParts[1] ?? "PONG";
		}

		if (strCommandName === "TIME") {
			return ["1700000000", "0"];
		}

		throw new Error(`Unsupported smoke Redis Command: ${strCommandName}`);
	},

	Connect(strURI) {
		g_vecRecordedCalls.push(["Connect", strURI]);

		const hHandle = g_unNextHandle;
		g_unNextHandle += 1;
		g_mapActiveHandles.set(hHandle, strURI);

		return hHandle;
	},

	GetDatabaseSize(hHandle) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["GetDatabaseSize", hHandle]);

		return BigInt(g_mapDatabase.size);
	},

	Decrement(hHandle, strKey) {
		g_vecRecordedCalls.push(["Decrement", hHandle, strKey]);

		return ChangeInteger(hHandle, strKey, -1n);
	},

	Delete(hHandle, Keys) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["Delete", hHandle, Keys]);

		let unDeleted = 0;
		for (const strKey of ToArray(Keys)) {
			if (g_mapDatabase.delete(strKey)) {
				unDeleted += 1;
			}
		}

		return BigInt(unDeleted);
	},

	Exists(hHandle, strKey) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["Exists", hHandle, strKey]);

		return g_mapDatabase.has(strKey);
	},

	Expire(hHandle, strKey, nSeconds) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["Expire", hHandle, strKey, nSeconds]);

		const RecordValue = g_mapDatabase.get(strKey);
		if (!RecordValue) {
			return false;
		}

		RecordValue.TTL = nSeconds;

		return true;
	},

	Get(hHandle, strKey) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["Get", hHandle, strKey]);

		const RecordValue = g_mapDatabase.get(strKey);

		return (RecordValue && (RecordValue.Type === "string")) ? RecordValue.Value : null;
	},

	DeleteHashFields(hHandle, strKey, Fields) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["DeleteHashFields", hHandle, strKey, Fields]);

		const RecordValue = GetTypedRecord(strKey, "hash");
		if (!RecordValue) {
			return 0n;
		}

		let unDeleted = 0;
		for (const strField of ToArray(Fields)) {
			if (RecordValue.Value.delete(strField)) {
				unDeleted += 1;
			}
		}

		if (RecordValue.Value.size === 0) {
			g_mapDatabase.delete(strKey);
		}

		return BigInt(unDeleted);
	},

	HasHashField(hHandle, strKey, strField) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["HasHashField", hHandle, strKey, strField]);

		const RecordValue = GetTypedRecord(strKey, "hash");

		return Boolean(RecordValue && RecordValue.Value.has(strField));
	},

	GetHashField(hHandle, strKey, strField) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["GetHashField", hHandle, strKey, strField]);

		const RecordValue = GetTypedRecord(strKey, "hash");

		return (RecordValue && RecordValue.Value.has(strField)) ? RecordValue.Value.get(strField) : null;
	},

	GetAllHashFields(hHandle, strKey) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["GetAllHashFields", hHandle, strKey]);

		const Result = Object.create(null);
		const RecordValue = GetTypedRecord(strKey, "hash");
		if (!RecordValue) {
			return Result;
		}

		for (const [strField, strValue] of RecordValue.Value) {
			Result[strField] = strValue;
		}

		return Result;
	},

	GetHashSize(hHandle, strKey) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["GetHashSize", hHandle, strKey]);

		const RecordValue = GetTypedRecord(strKey, "hash");

		return RecordValue ? BigInt(RecordValue.Value.size) : 0n;
	},

	SetHashField(hHandle, strKey, strField, strValue) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["SetHashField", hHandle, strKey, strField, strValue]);

		const RecordValue = GetOrCreateRecord(strKey, "hash", () => new Map());
		const bCreated = !RecordValue.Value.has(strField);

		RecordValue.Value.set(strField, strValue);

		return bCreated ? 1n : 0n;
	},

	Increment(hHandle, strKey) {
		g_vecRecordedCalls.push(["Increment", hHandle, strKey]);

		return ChangeInteger(hHandle, strKey, 1n);
	},

	IncrementBy(hHandle, strKey, nIncrement) {
		g_vecRecordedCalls.push(["IncrementBy", hHandle, strKey, nIncrement]);

		return ChangeInteger(hHandle, strKey, nIncrement);
	},

	GetKeys(hHandle, strPattern) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["GetKeys", hHandle, strPattern]);

		const strPrefix = strPattern.endsWith("*") ? strPattern.slice(0, -1) : strPattern;

		return [...g_mapDatabase.keys()].filter((strKey) => strPattern.endsWith("*") ? strKey.startsWith(strPrefix) : strKey === strPattern).sort();
	},

	PopLeft(hHandle, strKey) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["PopLeft", hHandle, strKey]);

		return PopListValue(strKey, false);
	},

	PushLeft(hHandle, strKey, Values) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["PushLeft", hHandle, strKey, Values]);

		const RecordValue = GetOrCreateRecord(strKey, "list", () => []);
		for (const strValue of ToArray(Values)) {
			RecordValue.Value.unshift(strValue);
		}

		return BigInt(RecordValue.Value.length);
	},

	GetListRange(hHandle, strKey, nStart, nStop) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["GetListRange", hHandle, strKey, nStart, nStop]);

		const RecordValue = GetTypedRecord(strKey, "list");
		if (!RecordValue) {
			return [];
		}

		const unLength = RecordValue.Value.length;
		const unListLength = BigInt(unLength);
		const nFirst = NormalizeListIndex(nStart, unLength);
		const nLast = NormalizeListIndex(nStop, unLength);
		if ((nFirst >= unListLength) || (nLast < 0n) || (nFirst > nLast)) {
			return [];
		}

		const unFirstIndex = (nFirst < 0n) ? 0 : Number(nFirst);
		const unEndIndex = (nLast >= unListLength) ? unLength : (Number(nLast) + 1);

		return RecordValue.Value.slice(unFirstIndex, unEndIndex);
	},

	GetValues(hHandle, vecKeys) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["GetValues", hHandle, vecKeys]);

		return vecKeys.map((strKey) => {
			const RecordValue = g_mapDatabase.get(strKey);

			return (RecordValue && (RecordValue.Type === "string")) ? RecordValue.Value : null;
		});
	},

	SetValues(hHandle, Values) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["SetValues", hHandle, Values]);

		for (const [strKey, strValue] of Object.entries(Values)) {
			SetStringRecord(strKey, strValue);
		}

		return true;
	},

	Persist(hHandle, strKey) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["Persist", hHandle, strKey]);

		const RecordValue = g_mapDatabase.get(strKey);
		if (!RecordValue || (RecordValue.TTL === null)) {
			return false;
		}

		RecordValue.TTL = null;

		return true;
	},

	Ping(hHandle, strMessage) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["Ping", hHandle, strMessage]);

		return (strMessage === undefined) ? "PONG" : strMessage;
	},

	Publish(hHandle, strChannel, strMessage) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["Publish", hHandle, strChannel, strMessage]);

		return 2n;
	},

	PopRight(hHandle, strKey) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["PopRight", hHandle, strKey]);

		return PopListValue(strKey, true);
	},

	PushRight(hHandle, strKey, Values) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["PushRight", hHandle, strKey, Values]);

		const RecordValue = GetOrCreateRecord(strKey, "list", () => []);
		RecordValue.Value.push(...ToArray(Values));

		return BigInt(RecordValue.Value.length);
	},

	AddSetMembers(hHandle, strKey, Members) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["AddSetMembers", hHandle, strKey, Members]);

		const RecordValue = GetOrCreateRecord(strKey, "set", () => new Set());
		let unAdded = 0;
		for (const strMember of ToArray(Members)) {
			if (!RecordValue.Value.has(strMember)) {
				RecordValue.Value.add(strMember);
				unAdded += 1;
			}
		}

		return BigInt(unAdded);
	},

	Set(hHandle, strKey, strValue) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["Set", hHandle, strKey, strValue]);
		SetStringRecord(strKey, strValue);

		return true;
	},

	GetSetMembers(hHandle, strKey) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["GetSetMembers", hHandle, strKey]);

		const RecordValue = GetTypedRecord(strKey, "set");

		return RecordValue ? [...RecordValue.Value].sort() : [];
	},

	RemoveSetMembers(hHandle, strKey, Members) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["RemoveSetMembers", hHandle, strKey, Members]);

		const RecordValue = GetTypedRecord(strKey, "set");
		if (!RecordValue) {
			return 0n;
		}

		let unRemoved = 0;
		for (const strMember of ToArray(Members)) {
			if (RecordValue.Value.delete(strMember)) {
				unRemoved += 1;
			}
		}

		if (RecordValue.Value.size === 0) {
			g_mapDatabase.delete(strKey);
		}

		return BigInt(unRemoved);
	},

	GetTTL(hHandle, strKey) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["GetTTL", hHandle, strKey]);

		const RecordValue = g_mapDatabase.get(strKey);

		return RecordValue ? BigInt(RecordValue.TTL ?? -1) : -2n;
	},

	GetType(hHandle, strKey) {
		AssertHandle(hHandle);
		g_vecRecordedCalls.push(["GetType", hHandle, strKey]);

		const RecordValue = g_mapDatabase.get(strKey);

		return RecordValue ? RecordValue.Type : "none";
	},
};

const g_RedisOperationNames = {
	close: "Close",
	command: "ExecuteCommand",
	connect: "Connect",
	dbsize: "GetDatabaseSize",
	decr: "Decrement",
	del: "Delete",
	exists: "Exists",
	expire: "Expire",
	get: "Get",
	hdel: "DeleteHashFields",
	hexists: "HasHashField",
	hget: "GetHashField",
	hgetall: "GetAllHashFields",
	hlen: "GetHashSize",
	hset: "SetHashField",
	incr: "Increment",
	incrby: "IncrementBy",
	keys: "GetKeys",
	lpop: "PopLeft",
	lpush: "PushLeft",
	lrange: "GetListRange",
	mget: "GetValues",
	mset: "SetValues",
	persist: "Persist",
	ping: "Ping",
	publish: "Publish",
	rpop: "PopRight",
	rpush: "PushRight",
	sadd: "AddSetMembers",
	set: "Set",
	smembers: "GetSetMembers",
	srem: "RemoveSetMembers",
	ttl: "GetTTL",
	type: "GetType",
};

const g_setHashKeyMethodNames = new Set([
	"hdel",
	"hexists",
	"hget",
	"hgetall",
	"hlen",
	"hset",
]);
const g_setHashFieldMethodNames = new Set(["hexists", "hget", "hset"]);

function RequireRedisStringArgument(Value, strMethodName, strParameterName, bAllowEmpty = false) {
	if ((typeof Value !== "string") || (!bAllowEmpty && (Value.length === 0))) {
		throw new TypeError(`${strMethodName} requires ${bAllowEmpty ? "a string" : "a non-empty string"} for ${strParameterName}.`);
	}
}

function ValidateRedisHashRequestArguments(strMethodName, vecArguments) {
	const unKeyArgumentIndex = 1;
	const unFieldArgumentIndex = 2;
	const unValueArgumentIndex = 3;

	if (!g_setHashKeyMethodNames.has(strMethodName)) {
		return;
	}

	RequireRedisStringArgument(vecArguments[unKeyArgumentIndex], strMethodName, "strKey");

	if (g_setHashFieldMethodNames.has(strMethodName)) {
		RequireRedisStringArgument(vecArguments[unFieldArgumentIndex], strMethodName, "strField");

	} else if (strMethodName === "hdel") {
		const Fields = vecArguments[unFieldArgumentIndex];
		if (typeof Fields === "string") {
			RequireRedisStringArgument(Fields, strMethodName, "strField");

		} else if (Array.isArray(Fields) && (Fields.length > 0)) {
			for (const Field of Fields) {
				RequireRedisStringArgument(Field, strMethodName, "strField");
			}

		} else {
			throw new TypeError(`${strMethodName} requires a string or non-empty string array for Fields.`);
		}
	}

	if (strMethodName === "hset") {
		const bAllowEmptyValue = true;
		RequireRedisStringArgument(vecArguments[unValueArgumentIndex], strMethodName, "strValue", bAllowEmptyValue);
	}
}

// This double models copied request data and callback timing, not native worker threads or IO.
const g_RedisModule = Object.fromEntries(Object.entries(g_RedisOperationNames).map(([strMethodName, strOperationName]) => {
	const Operation = g_RedisOperations[strOperationName];

	return [
		strMethodName,
		(...vecArguments) => {
			if (vecArguments.length < g_unRequestControlArgumentCount) {
				throw new TypeError(`${strMethodName} requires an options object and callback.`);
			}

			const Callback = vecArguments.pop();
			const Options = vecArguments.pop();
			if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
				throw new TypeError(`${strMethodName} requires an options object.`);
			}

			if (typeof Callback !== "function") {
				throw new TypeError(`${strMethodName} requires a callback.`);
			}

			if ((Options.Blocking !== undefined) && (typeof Options.Blocking !== "boolean")) {
				throw new TypeError(`${strMethodName} requires a boolean Blocking option.`);
			}

			ValidateRedisHashRequestArguments(strMethodName, vecArguments);

			if (strMethodName === "incrby") {
				RequireRedisInt64Argument(vecArguments[g_unIncrementArgumentIndex], strMethodName, "nIncrement");

			} else if (strMethodName === "lrange") {
				RequireRedisInt64Argument(vecArguments[g_unListStartArgumentIndex], strMethodName, "nStart");
				RequireRedisInt64Argument(vecArguments[g_unListStopArgumentIndex], strMethodName, "nStop");
			}

			const vecRequestArguments = structuredClone(vecArguments);
			const ExecuteRequest = () => {
				let Result;
				try {
					Result = Operation(...vecRequestArguments);
				} catch (RequestError) {
					Callback(RequestError, undefined);
					return;
				}

				Callback(null, Result);
			};

			if (Options.Blocking) {
				ExecuteRequest();
			} else {
				queueMicrotask(ExecuteRequest);
			}
		},
	];
}));

function CallRedis(strMethodName, ...vecArguments) {
	let bCallbackCompleted = false;
	let RequestError = null;
	let Result;

	g_RedisModule[strMethodName](...vecArguments, { Blocking: true }, (CallbackError, CallbackResult) => {
		RequestError = CallbackError;
		Result = CallbackResult;
		bCallbackCompleted = true;
	});

	if (!bCallbackCompleted) {
		throw new Error("Blocking Redis smoke callback did not run before return.");
	}

	if (RequestError) {
		throw RequestError;
	}

	return Result;
}

function NormalizeHeadingAnchor(strHeading) {
	return strHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function CloneForAssertion(Value) {
	return structuredClone(Value);
}

function VerifyContentsAnchors(strMarkdown) {
	const vecContentsMatch = strMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "redis contents section");

	const vecDocumentedAnchors = [...vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	const vecSectionAnchors = [...strMarkdown.matchAll(/^## (.+)$/gm)].map((vecMatch) => NormalizeHeadingAnchor(vecMatch[1])).filter((strAnchor) => strAnchor !== "contents");
	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "redis contents anchors");
}

function VerifyDocumentationLinks(strMarkdown) {
	const strDocumentationWithoutCode = strMarkdown.replace(/```[\s\S]*?```/g, "");
	const vecLinks = [...strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `redis documentation link must exist: ${strTarget}`);
	}
}

function ExecuteCodeBlock(strCode, unBlockIndex, RedisModule = g_RedisModule) {
	const unSetupTimeoutMilliseconds = 1000;

	const ModuleRecord = { exports: {} };
	const Context = g_VM.createContext({
		module: ModuleRecord,
		exports: ModuleRecord.exports,
		require(strRequestName) {
			g_Assert.equal(strRequestName, "redis", `redis code block ${unBlockIndex} import`);

			return RedisModule;
		},
	});

	const Script = new g_VM.Script(strCode, { filename: `redis.md:block-${unBlockIndex}.js` });
	Script.runInContext(Context, { timeout: unSetupTimeoutMilliseconds });

	return ModuleRecord.exports;
}

function RequestRedis(strMethodName, vecArguments, Options = {}) {
	return new Promise((Resolve, Reject) => {
		g_RedisModule[strMethodName](...vecArguments, Options, (RequestError, Result) => {
			if (RequestError) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

// Structural regression guards only; these do not execute Redis, V8, or game-thread callbacks.
function ExtractNativeCallbackSource(strBindings, strCallbackName, bPreserveIndentation = false) {
	const strNormalizedBindings = strBindings.replace(/\r\n/g, "\n");
	const vecStartMatches = [...strNormalizedBindings.matchAll(new RegExp(`^(\\t{1,2})void ${strCallbackName}\\(`, "gm"))];
	g_Assert.equal(vecStartMatches.length, 1, `unique native callback: ${strCallbackName}`);

	const vecStartMatch = vecStartMatches[0];
	const strClosingLine = `\n${vecStartMatch[1]}}`;
	const unStartIndex = vecStartMatch.index;
	const nEndIndex = strNormalizedBindings.indexOf(`${strClosingLine}\n`, unStartIndex + vecStartMatch[0].length);
	g_Assert.ok(nEndIndex > unStartIndex, `native callback boundary: ${strCallbackName}`);

	const strCallback = strNormalizedBindings.slice(unStartIndex, nEndIndex + strClosingLine.length);

	return (!bPreserveIndentation && (vecStartMatch[1].length === 2)) ? strCallback.replace(/^\t/gm, "") : strCallback;
}

function ExtractNativeHelperSource(strBindings, strHelperSignature) {
	const strNormalizedBindings = strBindings.replace(/\r\n/g, "\n");
	const nStartIndex = strNormalizedBindings.indexOf(strHelperSignature);
	const nEndIndex = strNormalizedBindings.indexOf("\n\t\t}", nStartIndex + strHelperSignature.length);
	g_Assert.ok((nStartIndex >= 0) && (nEndIndex > nStartIndex), `native helper boundary: ${strHelperSignature}`);

	return strNormalizedBindings.slice(nStartIndex, nEndIndex + "\n\t\t}".length);
}

function VerifyNativeExecutionModeInitialization(strBindings) {
	// Source shape controls only; callback behavior is checked separately with Node doubles.
	const strNormalizedBindings = strBindings.replace(/\r\n/g, "\n");
	const strDeclaration = "\t\tstruct RedisRequestExecutionMode {\n\t\t\tRedisRequestExecutionMode(void);\n\n\t\t\tbool m_bBlocking;\n\t\t\tv8::Local<v8::Function> m_CallbackFunction;\n\t\t};";
	const strConstructor = "\t\tRedisRequestExecutionMode::RedisRequestExecutionMode(void) {\n\t\t\tm_bBlocking = false;\n\t\t}";
	const Verify = (strSource) => {
		g_Assert.equal(strSource.split(strDeclaration).length - 1, 1, "Redis execution mode declares its initializing constructor without in-class defaults");
		g_Assert.equal(strSource.split(strConstructor).length - 1, 1, "Redis execution mode initializes Blocking to false in its source constructor");
	};
	Verify(strNormalizedBindings);

	const vecMutations = [
		strNormalizedBindings.replace(strDeclaration, strDeclaration.replace("\t\t\tRedisRequestExecutionMode(void);\n\n", "")),
		strNormalizedBindings.replace(strConstructor, strConstructor.replace("= false;", "= true;")),
		strNormalizedBindings.replace(strConstructor, ""),
	];
	for (const strChangedSource of vecMutations) {
		g_Assert.notEqual(strChangedSource, strNormalizedBindings, "Redis execution mode mutation anchor exists");
		g_Assert.throws(() => Verify(strChangedSource), g_Assert.AssertionError, "Redis execution mode initialization regression must be rejected");
	}
}

function VerifyNativeCloseOwnership(strBindings) {
	const strCloseCallback = ExtractNativeCallbackSource(strBindings, "CloseRedisCallback");
	g_Assert.match(strCloseCallback, /try \{[\s\S]+ParseRedisRequestExecutionMode\(/, "close setup remains inside the native exception boundary");
	g_Assert.match(strCloseCallback, /std::shared_ptr<RedisClientRecord> const RedisCloseRecordOwner = std::make_shared<RedisClientRecord>\(\);/, "task copies share one native client owner slot");
	g_Assert.match(strCloseCallback, /auto Operation = \[RedisCloseRecordOwner, bRedisClientClosed\]\(\) -> bool \{\s+RedisCloseRecordOwner->m_pClient\.reset\(\);/, "close worker releases the shared slot, not a private copied reference");
	g_Assert.match(strCloseCallback, /auto itClosingClient = umapRedisClients\.find\(nRedisClientHandle\);/, "submission cleanup re-finds the handle after callback reentry");
	g_Assert.match(strCloseCallback, /if \(!bAccepted && RedisCloseRecordOwner->m_pClient\) \{\s+itClosingClient->second\.m_pClient = std::move\(RedisCloseRecordOwner->m_pClient\);/, "rejected close restores the original client");
	g_Assert.match(strCloseCallback, /RunRedisRequest<bool>\([^\n]+std::move\(Operation\), ConvertResult\)/, "close submits its operation by move");
	g_Assert.match(strCloseCallback, /CompleteSubmission\(bAccepted\);/, "normal submission commits or restores the reservation");
	g_Assert.match(strCloseCallback, /catch \(\.\.\.\) \{\s+CompleteSubmission\(false\);\s+throw;/, "submission exceptions restore the reservation before propagation");

	const nRuntimeValidationIndex = strCloseCallback.indexOf("GetRuntimeFromCallbackInformation(");
	const nOwnershipTransferIndex = strCloseCallback.indexOf("RedisCloseRecordOwner->m_pClient = std::move(itRedisClient->second.m_pClient);");
	g_Assert.ok((nRuntimeValidationIndex >= 0) && (nOwnershipTransferIndex > nRuntimeValidationIndex), "validate runtime before reserving client ownership");
}

function VerifyNativeCloseGuardMutations(strBindings) {
	const vecMutations = [
		{ From: "RedisCloseRecordOwner->m_pClient.reset();", To: "pRedisClient.reset();" },
		{ From: "auto itClosingClient = umapRedisClients.find(nRedisClientHandle);", To: "auto itClosingClient = itRedisClient;" },
		{ From: "if (!bAccepted && RedisCloseRecordOwner->m_pClient)", To: "if (false)" },
		{ From: "CompleteSubmission(bAccepted);", To: "CompleteSubmission(true);" },
		{ From: "CompleteSubmission(false);", To: "CompleteSubmission(true);" },
	];
	for (const Mutation of vecMutations) {
		g_Assert.ok(strBindings.includes(Mutation.From), `native close mutation target: ${Mutation.From}`);
		const strMutatedBindings = strBindings.replace(Mutation.From, Mutation.To);
		g_Assert.throws(() => VerifyNativeCloseOwnership(strMutatedBindings), g_Assert.AssertionError);
	}
}

function VerifyReviewedNativeRequestBoundaries(strBindings) {
	const strSharedConverter = ExtractNativeHelperSource(strBindings, "\t\tv8::MaybeLocal<v8::Value> MakeRedisOptionalStringValue(");
	g_Assert.match(strSharedConverter, /if \(!pIsolate \|\| LocalContext\.IsEmpty\(\)\) \{\s+return \{\};/, "shared optional-string converter validates its context");
	g_Assert.match(strSharedConverter, /if \(!OptionalRedisStringValue\) \{\s+return v8::Null\(pIsolate\);/, "missing Redis string remains null");
	g_Assert.match(strSharedConverter, /return MakeString\(pIsolate, OptionalRedisStringValue\.value\(\)\);/, "present Redis strings preserve their contents, including empty strings");
	g_Assert.doesNotMatch(strSharedConverter, /value\(\)\.empty\(\)|v8::Undefined\(/);

	const strSharedInt64Converter = ExtractNativeHelperSource(strBindings, "\t\tv8::MaybeLocal<v8::Value> MakeRedisInt64Value(");
	g_Assert.match(strSharedInt64Converter, /std::int64_t const& nValue/);
	g_Assert.match(strSharedInt64Converter, /if \(!pIsolate \|\| LocalContext\.IsEmpty\(\)\) \{\s+return \{\};/);
	g_Assert.match(strSharedInt64Converter, /return MakeExternalInt64Value\(pIsolate, nValue\);/, "Redis signed64 results preserve BigInt and negative sentinels");
	g_Assert.doesNotMatch(strSharedInt64Converter, /v8::Number::New\(|MakeExternalUInt64Value\(/);

	const strSharedBooleanConverter = ExtractNativeHelperSource(strBindings, "\t\tv8::MaybeLocal<v8::Value> MakeRedisBooleanValue(");
	g_Assert.match(strSharedBooleanConverter, /bool const& bValue/);
	g_Assert.match(strSharedBooleanConverter, /if \(!pIsolate \|\| LocalContext\.IsEmpty\(\)\) \{\s+return \{\};/);
	g_Assert.match(strSharedBooleanConverter, /return v8::Boolean::New\(pIsolate, bValue\);/);
	g_Assert.doesNotMatch(strSharedBooleanConverter, /v8::Number::New\(|v8::Integer::New\(/);

	const setSharedConverterCallbacks = new Set(["GetRedisValueCallback", "GetRedisHashFieldCallback", "PopRedisListValue"]);
	const setSharedInt64ConverterCallbacks = new Set(["GetRedisKeyTTLCallback", "DecrementRedisValueCallback", "IncrementRedisValueByAmountCallback", "DeleteRedisHashFieldsCallback", "GetRedisHashFieldCountCallback", "PushRedisListValues", "AddOrRemoveRedisSetMembers", "PublishRedisMessageCallback"]);
	const setSharedBooleanConverterCallbacks = new Set(["SetMultipleRedisValuesCallback", "DoesRedisHashFieldExistCallback"]);
	const setSharedStringArrayConverterCallbacks = new Set(["GetRedisListRangeCallback", "GetRedisSetMembersCallback"]);

	// This inventory covers only callbacks and shared request helpers already reviewed chunk by chunk.
	const vecReviewedCallbackNames = [
		"GetRedisValueCallback",
		"SetRedisValueCallback",
		"DeleteRedisKeyCallback",
		"DoesRedisKeyExistCallback",
		"IncrementRedisValueCallback",
		"ExpireRedisKeyCallback",
		"GetRedisHashFieldCallback",
		"SetRedisHashFieldCallback",
		"GetRedisDatabaseSizeCallback",
		"GetRedisKeysCallback",
		"GetRedisKeyTypeCallback",
		"GetRedisKeyTTLCallback",
		"PersistRedisKeyCallback",
		"DecrementRedisValueCallback",
		"IncrementRedisValueByAmountCallback",
		"GetMultipleRedisValuesCallback",
		"SetMultipleRedisValuesCallback",
		"DeleteRedisHashFieldsCallback",
		"DoesRedisHashFieldExistCallback",
		"GetRedisHashFieldCountCallback",
		"GetAllRedisHashFieldsCallback",
		"PushRedisListValues",
		"PopRedisListValue",
		"GetRedisListRangeCallback",
		"AddOrRemoveRedisSetMembers",
		"GetRedisSetMembersCallback",
		"PublishRedisMessageCallback",
	];
	for (const strCallbackName of vecReviewedCallbackNames) {
		const strCallback = ExtractNativeCallbackSource(strBindings, strCallbackName);
		const nTryIndex = strCallback.indexOf("\n\t\ttry {");
		const nParseIndex = strCallback.indexOf("ParseRedisRequestExecutionMode(");
		const nClientAcquisitionIndex = strCallback.indexOf("AcquireRedisClientFromCallbackInformation(");
		const nWorkerIndex = strCallback.indexOf("\n\t\t\tauto Operation =");
		const nCatchIndex = strCallback.indexOf("\n\t\t} catch (std::exception const& Exception) {");
		g_Assert.ok((nTryIndex >= 0) && (nParseIndex > nTryIndex) && (nClientAcquisitionIndex > nParseIndex) && (nWorkerIndex > nClientAcquisitionIndex) && (nCatchIndex > nWorkerIndex), `${strCallbackName} prepares the request inside its exception boundary`);
		g_Assert.match(strCallback, /auto Operation = [^\n]+\(\) -> [^\n]+ \{/, `${strCallbackName} exposes its native worker result type`);
		if (setSharedConverterCallbacks.has(strCallbackName)) {
			g_Assert.match(strCallback, /RunRedisRequest<sw::redis::OptionalString>\([^\n]+std::move\(Operation\), MakeRedisOptionalStringValue\)/, `${strCallbackName} shares the checked optional-string converter`);
			g_Assert.doesNotMatch(strCallback, /auto Convert(?:Result|Value) =/);

		} else if (setSharedInt64ConverterCallbacks.has(strCallbackName)) {
			g_Assert.match(strCallback, /RunRedisRequest<std::int64_t>\([^\n]+std::move\(Operation\), MakeRedisInt64Value\)/, `${strCallbackName} shares the signed64 result converter`);
			g_Assert.doesNotMatch(strCallback, /auto Convert(?:Result|Value) =/);

		} else if (setSharedBooleanConverterCallbacks.has(strCallbackName)) {
			g_Assert.match(strCallback, /RunRedisRequest<bool>\([^\n]+std::move\(Operation\), MakeRedisBooleanValue\)/, `${strCallbackName} shares the boolean result converter`);
			g_Assert.doesNotMatch(strCallback, /auto Convert(?:Result|Value) =/);

		} else if (setSharedStringArrayConverterCallbacks.has(strCallbackName)) {
			g_Assert.match(strCallback, /RunRedisRequest<std::vector<std::string>>\([^\n]+std::move\(Operation\), MakeStringArray\)/, `${strCallbackName} shares the checked string-array result converter`);
			g_Assert.doesNotMatch(strCallback, /auto Convert(?:Result|Value) =/);

		} else {
			g_Assert.match(strCallback, /auto Convert(?:Result|Value) = [^\n]+ -> v8::MaybeLocal<v8::Value> \{\s+if \(!pResultIsolate \|\| LocalResultContext\.IsEmpty\(\)\) \{\s+return \{\};/, `${strCallbackName} validates the result conversion context`);
			g_Assert.match(strCallback, /RunRedisRequest<[^\n]+\([^\n]+std::move\(Operation\), Convert(?:Result|Value)\)/, `${strCallbackName} transfers its worker operation`);
		}
	}
}

function VerifyNativeRequestBoundaryMutations(strBindings) {
	const strNormalizedBindings = strBindings.replace(/\r\n/g, "\n");
	const strGetCallback = ExtractNativeCallbackSource(strNormalizedBindings, "GetRedisValueCallback");
	const vecMutations = [
		{ From: "\n\t\ttry {", To: "\n\t\t{" },
		{ From: "() -> sw::redis::OptionalString {", To: "() {" },
		{ From: "std::move(Operation), MakeRedisOptionalStringValue", To: "std::move(Operation), MakeString" },
		{ From: "std::move(Operation), MakeRedisOptionalStringValue", To: "Operation, MakeRedisOptionalStringValue" },
	];
	for (const Mutation of vecMutations) {
		g_Assert.equal(strGetCallback.split(Mutation.From).length, 2, `unique request boundary mutation target: ${Mutation.From}`);
		const strMutatedCallback = strGetCallback.replace(Mutation.From, Mutation.To);
		const bNestedCallback = /^\t\tvoid GetRedisValueCallback\(/m.test(strNormalizedBindings);
		const strOriginalSource = bNestedCallback ? strGetCallback.replace(/^\t/gm, "\t\t") : strGetCallback;
		const strMutatedSource = bNestedCallback ? strMutatedCallback.replace(/^\t/gm, "\t\t") : strMutatedCallback;
		g_Assert.equal(strNormalizedBindings.split(strOriginalSource).length, 2, "unique original callback source");

		const strMutatedBindings = strNormalizedBindings.replace(strOriginalSource, strMutatedSource);
		g_Assert.notEqual(strMutatedBindings, strNormalizedBindings, "request mutation changes actual native source");
		g_Assert.throws(() => VerifyReviewedNativeRequestBoundaries(strMutatedBindings), g_Assert.AssertionError);
	}

	const vecConverterModels = [
		{
			Signature: "\t\tv8::MaybeLocal<v8::Value> MakeRedisOptionalStringValue(",
			Mutations: [
				{ From: "if (!pIsolate || LocalContext.IsEmpty())", To: "if (false)" },
				{ From: "return v8::Null(pIsolate);", To: "return v8::Undefined(pIsolate);" },
				{ From: "OptionalRedisStringValue.value()", To: "std::string {}" },
				{ From: "if (!OptionalRedisStringValue)", To: "if (!OptionalRedisStringValue || OptionalRedisStringValue.value().empty())" },
			],
		},
		{
			Signature: "\t\tv8::MaybeLocal<v8::Value> MakeRedisInt64Value(",
			Mutations: [
				{ From: "if (!pIsolate || LocalContext.IsEmpty())", To: "if (false)" },
				{ From: "MakeExternalInt64Value(pIsolate, nValue)", To: "v8::Number::New(pIsolate, nValue)" },
				{ From: "MakeExternalInt64Value(pIsolate, nValue)", To: "MakeExternalUInt64Value(pIsolate, nValue)" },
				{ From: "MakeExternalInt64Value(pIsolate, nValue)", To: "MakeExternalInt64Value(pIsolate, 0)" },
			],
		},
		{
			Signature: "\t\tv8::MaybeLocal<v8::Value> MakeRedisBooleanValue(",
			Mutations: [
				{ From: "if (!pIsolate || LocalContext.IsEmpty())", To: "if (false)" },
				{ From: "v8::Boolean::New(pIsolate, bValue)", To: "v8::Boolean::New(pIsolate, false)" },
				{ From: "v8::Boolean::New(pIsolate, bValue)", To: "v8::Boolean::New(pIsolate, !bValue)" },
				{ From: "v8::Boolean::New(pIsolate, bValue)", To: "v8::Integer::New(pIsolate, bValue)" },
			],
		},
	];
	for (const ConverterModel of vecConverterModels) {
		const strSharedConverter = ExtractNativeHelperSource(strNormalizedBindings, ConverterModel.Signature);
		for (const Mutation of ConverterModel.Mutations) {
			g_Assert.equal(strSharedConverter.split(Mutation.From).length, 2, `unique converter mutation target: ${Mutation.From}`);
			const strMutatedConverter = strSharedConverter.replace(Mutation.From, Mutation.To);
			const strMutatedBindings = strNormalizedBindings.replace(strSharedConverter, strMutatedConverter);
			g_Assert.notEqual(strMutatedBindings, strNormalizedBindings, "converter mutation changes actual native source");
			g_Assert.throws(() => VerifyReviewedNativeRequestBoundaries(strMutatedBindings), g_Assert.AssertionError);
		}
	}
}

function VerifyNativeStringConversion(strBindings) {
	const strHelper = ExtractNativeHelperSource(strBindings, "\t\tv8::Local<v8::String> MakeString(v8::Isolate* const pIsolate, std::string const& strValue) {");
	const nLengthIndex = strHelper.indexOf("const std::size_t unValueByteCount = strValue.size();");
	const nGuardIndex = strHelper.indexOf("if (!pIsolate || (unValueByteCount > kMaximumStringByteCount))");
	const nConversionIndex = strHelper.indexOf("v8::String::NewFromUtf8(");
	g_Assert.match(strHelper, /kMaximumStringByteCount = static_cast<std::size_t>\(std::numeric_limits<int>::max\(\)\);/, "native string length limit matches the V8 integer parameter");
	g_Assert.ok((nLengthIndex >= 0) && (nGuardIndex > nLengthIndex) && (nConversionIndex > nGuardIndex), "native byte length is checked before narrowing");
	g_Assert.match(strHelper, /NewFromUtf8\(pIsolate, strValue\.data\(\), v8::NewStringType::kNormal, static_cast<int>\(unValueByteCount\)\)/, "native std::string conversion preserves the full byte length");
	g_Assert.doesNotMatch(strHelper, /strValue\.c_str\(\)/, "native std::string conversion must not use a terminator as its length");

	const strInputHelper = ExtractNativeHelperSource(strBindings, "\t\tstd::string ValueToString(v8::Isolate* const pIsolate, v8::Local<v8::Value> const LocalValue) {");
	g_Assert.match(strInputHelper, /if \(!pIsolate \|\| LocalValue\.IsEmpty\(\)\) \{\s+return \{\};/, "native string input conversion validates its isolate and value");
	g_Assert.match(strInputHelper, /char const\* const pszEncodedValue = \*UTF8Value;\s+if \(!pszEncodedValue\) \{\s+return \{\};/, "native string input conversion checks encoding success");
	g_Assert.match(strInputHelper, /return std::string\(pszEncodedValue, static_cast<std::size_t>\(UTF8Value\.length\(\)\)\);/, "native string input conversion preserves the full UTF8 byte length");

	const strArrayHelper = ExtractNativeHelperSource(strBindings, "\t\tv8::Local<v8::Array> MakeStringArray(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, std::vector<std::string> const& vecValues) {");
	const nArrayGuardIndex = strArrayHelper.indexOf("if (!pIsolate || LocalContext.IsEmpty() || (unStringCount > kMaximumArrayLength) || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())");
	const nArrayCreationIndex = strArrayHelper.indexOf("v8::Array::New(pIsolate, static_cast<int>(unStringCount))");
	const nStringGuardIndex = strArrayHelper.indexOf("if (LocalString.IsEmpty() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())");
	const nArrayWriteIndex = strArrayHelper.indexOf("LocalArray->CreateDataProperty(");
	const nPropertyGuardIndex = strArrayHelper.indexOf("if (MaybeCreatedProperty.IsNothing() || !MaybeCreatedProperty.FromJust() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())");
	g_Assert.match(strArrayHelper, /kMaximumArrayLength = static_cast<std::size_t>\(std::numeric_limits<int>::max\(\)\);/, "native string-array length matches the V8 integer parameter");
	g_Assert.match(strArrayHelper, /const std::size_t unStringCount = vecValues\.size\(\);/, "native string-array length comes from the actual snapshot");
	g_Assert.ok((nArrayGuardIndex >= 0) && (nArrayCreationIndex > nArrayGuardIndex), "native string-array input and length are checked before allocation and narrowing");
	g_Assert.match(strArrayHelper, /if \(LocalArray\.IsEmpty\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)\) \{\s+return \{\};/, "native string-array allocation and execution failures are checked before use");
	g_Assert.ok((nStringGuardIndex >= 0) && (nArrayWriteIndex > nStringGuardIndex), "native string-array elements are checked before defining an own property");
	g_Assert.match(strArrayHelper, /v8::Maybe<bool> const MaybeCreatedProperty = LocalArray->CreateDataProperty\(LocalContext, static_cast<std::uint32_t>\(unStringIndex\), LocalString\);/, "native string-array writes use the checked element handle and create own indexed properties");
	g_Assert.ok(nPropertyGuardIndex > nArrayWriteIndex, "native string-array own-property failures are checked before continuing");
	g_Assert.doesNotMatch(strArrayHelper, /LocalArray->Set\(/, "native string-array results must not invoke inherited indexed setters");

	const strHashCallback = ExtractNativeCallbackSource(strBindings, "GetAllRedisHashFieldsCallback");
	g_Assert.match(strHashCallback, /LocalRedisHashFieldName = MakeString\(pResultIsolate, itRedisHashField->first\);/, "native hash names preserve their full string length");
	g_Assert.match(strHashCallback, /LocalRedisHashFieldValue = MakeString\(pResultIsolate, itRedisHashField->second\);/, "native hash values preserve their full string length");
	g_Assert.match(strHashCallback, /CreateDataProperty\(LocalResultContext, LocalRedisHashFieldName, LocalRedisHashFieldValue\)\.FromMaybe\(false\)/, "native hash conversion creates own data properties using the length-aware key and value");
	g_Assert.match(strHashCallback, /LocalNullPrototype = v8::Null\(pResultIsolate\);/, "native hash conversion creates the checked null prototype");
	g_Assert.match(strHashCallback, /SetPrototypeV2\(LocalResultContext, LocalNullPrototype\)\.FromMaybe\(false\)/, "native hash conversion retains a null prototype for raw user keys");
}

function VerifyNativeStringGuardMutations(strBindings) {
	const strNormalizedBindings = strBindings.replace(/\r\n/g, "\n");
	const vecOwners = [
		ExtractNativeHelperSource(strBindings, "\t\tv8::Local<v8::String> MakeString(v8::Isolate* const pIsolate, std::string const& strValue) {"),
		ExtractNativeHelperSource(strBindings, "\t\tstd::string ValueToString(v8::Isolate* const pIsolate, v8::Local<v8::Value> const LocalValue) {"),
		ExtractNativeHelperSource(strBindings, "\t\tv8::Local<v8::Array> MakeStringArray(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, std::vector<std::string> const& vecValues) {"),
		ExtractNativeCallbackSource(strBindings, "GetAllRedisHashFieldsCallback", true),
	];
	const vecMutations = [
		{ From: "strValue.data(), v8::NewStringType::kNormal, static_cast<int>(unValueByteCount)", To: "strValue.c_str(), v8::NewStringType::kNormal" },
		{ From: "if (!pIsolate || (unValueByteCount > kMaximumStringByteCount))", To: "if (!pIsolate)" },
		{ From: "const std::size_t unValueByteCount = strValue.size();", To: "const std::size_t unValueByteCount = 0;" },
		{ From: "LocalRedisHashFieldName = MakeString(pResultIsolate, itRedisHashField->first);", To: "LocalRedisHashFieldName = MakeString(pResultIsolate, itRedisHashField->first.c_str());" },
		{ From: "LocalRedisHashFieldsObject->CreateDataProperty(", To: "LocalRedisHashFieldsObject->Set(" },
		{ From: "LocalNullPrototype = v8::Null(pResultIsolate);", To: "LocalNullPrototype = v8::Object::New(pResultIsolate);" },
		{ From: "return std::string(pszEncodedValue, static_cast<std::size_t>(UTF8Value.length()));", To: "return pszEncodedValue;" },
		{ From: "if (!pIsolate || LocalContext.IsEmpty() || (unStringCount > kMaximumArrayLength) || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (!pIsolate || LocalContext.IsEmpty() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())" },
		{ From: "if (!pIsolate || LocalContext.IsEmpty() || (unStringCount > kMaximumArrayLength) || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if ((unStringCount > kMaximumArrayLength) || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())" },
		{ From: "const std::size_t unStringCount = vecValues.size();", To: "const std::size_t unStringCount = 0;" },
		{ From: "v8::Local<v8::Array> const LocalArray = v8::Array::New(pIsolate, static_cast<int>(unStringCount));\n\t\t\tif (LocalArray.IsEmpty() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "v8::Local<v8::Array> const LocalArray = v8::Array::New(pIsolate, static_cast<int>(unStringCount));\n\t\t\tif (false)" },
		{ From: "v8::Local<v8::String> const LocalString = MakeString(pIsolate, vecValues[unStringIndex]);\n\t\t\t\tif (LocalString.IsEmpty() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "v8::Local<v8::String> const LocalString = MakeString(pIsolate, vecValues[unStringIndex]);\n\t\t\t\tif (false)" },
		{ From: "LocalArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(unStringIndex), LocalString)", To: "LocalArray->Set(LocalContext, static_cast<std::uint32_t>(unStringIndex), LocalString)" },
		{ From: "if (MaybeCreatedProperty.IsNothing() || !MaybeCreatedProperty.FromJust() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (!MaybeCreatedProperty.FromJust() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())" },
		{ From: "if (MaybeCreatedProperty.IsNothing() || !MaybeCreatedProperty.FromJust() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (MaybeCreatedProperty.IsNothing() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())" },
		{ From: "if (!pIsolate || LocalContext.IsEmpty() || (unStringCount > kMaximumArrayLength) || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (!pIsolate || LocalContext.IsEmpty() || (unStringCount > kMaximumArrayLength) || pIsolate->HasPendingException())" },
		{ From: "if (!pIsolate || LocalContext.IsEmpty() || (unStringCount > kMaximumArrayLength) || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (!pIsolate || LocalContext.IsEmpty() || (unStringCount > kMaximumArrayLength) || pIsolate->IsExecutionTerminating())" },
		{ From: "if (LocalArray.IsEmpty() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (LocalArray.IsEmpty() || pIsolate->HasPendingException())" },
		{ From: "if (LocalArray.IsEmpty() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (LocalArray.IsEmpty() || pIsolate->IsExecutionTerminating())" },
		{ From: "if (LocalString.IsEmpty() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (LocalString.IsEmpty() || pIsolate->HasPendingException())" },
		{ From: "if (LocalString.IsEmpty() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (LocalString.IsEmpty() || pIsolate->IsExecutionTerminating())" },
		{ From: "if (MaybeCreatedProperty.IsNothing() || !MaybeCreatedProperty.FromJust() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (MaybeCreatedProperty.IsNothing() || !MaybeCreatedProperty.FromJust() || pIsolate->HasPendingException())" },
		{ From: "if (MaybeCreatedProperty.IsNothing() || !MaybeCreatedProperty.FromJust() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", To: "if (MaybeCreatedProperty.IsNothing() || !MaybeCreatedProperty.FromJust() || pIsolate->IsExecutionTerminating())" },
	];
	for (const Mutation of vecMutations) {
		const vecMatchingOwners = vecOwners.filter(strOwner => strOwner.includes(Mutation.From));
		g_Assert.equal(vecMatchingOwners.length, 1, `unique native string mutation owner: ${Mutation.From}`);
		const strOwner = vecMatchingOwners[0];
		g_Assert.equal(strOwner.split(Mutation.From).length, 2, `unique native string mutation target within owner: ${Mutation.From}`);
		g_Assert.equal(strNormalizedBindings.split(strOwner).length, 2, "native mutation owner must occur exactly once");
		const strMutatedBindings = strNormalizedBindings.replace(strOwner, strOwner.replace(Mutation.From, Mutation.To));
		g_Assert.throws(() => VerifyNativeStringConversion(strMutatedBindings), g_Assert.AssertionError);
	}
}

async function VerifyBinaryRedisStrings(hRedisClient) {
	const strValueKey = "SourceJSSmokeBinaryValue";
	const strHashKey = "SourceJSSmokeBinaryHash";
	const vecStringCases = [
		"",
		"\0",
		"\0Leading",
		"Trailing\0",
		"Name\0Suffix",
		"Value\0Suffix",
		"PlainText",
		"Snowman\u2603",
	];
	const vecHashFields = [
		{ Name: "EmptyValue", Value: "" },
		{ Name: "Name", Value: "PrefixOnly" },
		{ Name: "Name\0Suffix", Value: "Value\0Suffix" },
		{ Name: "\0Leading", Value: "Trailing\0" },
		{ Name: "Snowman\u2603", Value: "Snowman\u2603" },
		{ Name: "__proto__", Value: "OwnPrototypeField" },
		{ Name: "constructor", Value: "OwnConstructorField" },
		{ Name: "toString", Value: "OwnToStringField" },
	];

	for (const bBlocking of [false, true]) {
		const Options = { Blocking: bBlocking };
		try {
			for (const strValue of vecStringCases) {
				g_Assert.equal(await RequestRedis("set", [hRedisClient, strValueKey, strValue], Options), true, "binary string write succeeds");
				g_Assert.equal(await RequestRedis("get", [hRedisClient, strValueKey], Options), strValue, "Node double preserves full string values");
			}

			for (const HashField of vecHashFields) {
				g_Assert.equal(await RequestRedis("hset", [hRedisClient, strHashKey, HashField.Name, HashField.Value], Options), 1n, "each full hash name creates a distinct field");
				g_Assert.equal(await RequestRedis("hget", [hRedisClient, strHashKey, HashField.Name], Options), HashField.Value, "Node double preserves full hash values");
			}

			const Fields = await RequestRedis("hgetall", [hRedisClient, strHashKey], Options);
			g_Assert.equal(Object.getPrototypeOf(Fields), null, "raw hash keys do not change the null prototype");
			g_Assert.equal(Object.keys(Fields).length, vecHashFields.length, "NUL-containing field names do not collide with their prefixes");

			for (const HashField of vecHashFields) {
				g_Assert.equal(Object.hasOwn(Fields, HashField.Name), true, "hash result retains each complete own field name");
				g_Assert.equal(Fields[HashField.Name], HashField.Value, "hash result retains each complete string value");
			}
		} finally {
			for (const strKey of [strValueKey, strHashKey]) {
				// Either key may be absent after failed setup; cleanup only needs all present keys removed.
				CallRedis("del", hRedisClient, strKey);
			}
		}
	}
}

async function VerifyRejectedHashArguments(hRedisClient) {
	const strHashKey = "SourceJSSmokeHashValidation";
	const vecInvalidStrings = [
		"",
		null,
		undefined,
		0,
		false,
		[],
		{},
	];
	const vecRequests = [
		{ Method: "hdel", Tail: ["Name"] },
		{ Method: "hexists", Tail: ["Name"] },
		{ Method: "hget", Tail: ["Name"] },
		{ Method: "hgetall", Tail: [] },
		{ Method: "hlen", Tail: [] },
		{ Method: "hset", Tail: ["Name", ""] },
	];
	const unCallsBeforeValidation = g_vecRecordedCalls.length;
	const unKeysBeforeValidation = g_mapDatabase.size;
	let unCallbackCount = 0;
	const Callback = () => {
		unCallbackCount += 1;
	};

	for (const bBlocking of [false, true]) {
		const Options = { Blocking: bBlocking };
		for (const Request of vecRequests) {
			for (const Key of vecInvalidStrings) {
				g_Assert.throws(() => g_RedisModule[Request.Method](hRedisClient, Key, ...Request.Tail, Options, Callback), TypeError, `${Request.Method} rejects an invalid key before scheduling (Blocking=${bBlocking})`);
			}
		}

		for (const strMethodName of ["hexists", "hget", "hset"]) {
			for (const Field of vecInvalidStrings) {
				const vecArguments = [hRedisClient, strHashKey, Field];
				if (strMethodName === "hset") {
					vecArguments.push("");
				}

				g_Assert.throws(() => g_RedisModule[strMethodName](...vecArguments, Options, Callback), TypeError, `${strMethodName} rejects an invalid field before scheduling (Blocking=${bBlocking})`);
			}
		}

		for (const Fields of [
			"",
			[],
			[""],
			["Name", ""],
			["Name", null],
			[1],
			new Array(1),
			{},
		]) {
			g_Assert.throws(() => g_RedisModule.hdel(hRedisClient, strHashKey, Fields, Options, Callback), TypeError, `hdel rejects empty, mixed, or sparse field arrays before scheduling (Blocking=${bBlocking})`);
		}

		for (const Value of [
			null,
			undefined,
			0,
			false,
			[],
			{},
		]) {
			g_Assert.throws(() => g_RedisModule.hset(hRedisClient, strHashKey, "Name", Value, Options, Callback), TypeError, `hset rejects a non-string value before scheduling (Blocking=${bBlocking})`);
		}
	}

	await Promise.resolve();

	g_Assert.equal(unCallbackCount, 0, "invalid hash inputs never invoke Callback in the Node double");
	g_Assert.equal(g_vecRecordedCalls.length, unCallsBeforeValidation, "invalid hash inputs never execute an operation");
	g_Assert.equal(g_mapDatabase.size, unKeysBeforeValidation, "invalid hash inputs never create a database key");

	for (const bBlocking of [false, true]) {
		const Options = { Blocking: bBlocking };
		try {
			g_Assert.equal(await RequestRedis("hset", [hRedisClient, strHashKey, "Name", ""], Options), 1n, "empty string hash values remain valid");
			g_Assert.equal(await RequestRedis("hget", [hRedisClient, strHashKey, "Name"], Options), "", "empty string hash values remain intact");
			g_Assert.equal(await RequestRedis("hdel", [hRedisClient, strHashKey, ["Name"]], Options), 1n, "a nonempty field array remains valid");
		} finally {
			// The last hdel may already have removed the key; zero deletions are valid cleanup.
			CallRedis("del", hRedisClient, strHashKey);
		}
	}
}

async function VerifyRejectedInt64Arguments(hRedisClient) {
	const vecInvalidInputs = [
		{ Value: 4, ErrorType: TypeError },
		{ Value: 0, ErrorType: TypeError },
		{ Value: -1, ErrorType: TypeError },
		{ Value: 1.5, ErrorType: TypeError },
		{ Value: NaN, ErrorType: TypeError },
		{ Value: Infinity, ErrorType: TypeError },
		{ Value: "4", ErrorType: TypeError },
		{ Value: true, ErrorType: TypeError },
		{ Value: null, ErrorType: TypeError },
		{ Value: undefined, ErrorType: TypeError },
		{ Value: g_nMinimumInt64 - 1n, ErrorType: RangeError },
		{ Value: g_nMaximumInt64 + 1n, ErrorType: RangeError },
	];
	const unCallsBeforeValidation = g_vecRecordedCalls.length;
	let unCallbackCount = 0;

	for (const bBlocking of [false, true]) {
		for (const Input of vecInvalidInputs) {
			const vecInvalidRequests = [
				{ Method: "incrby", Arguments: [hRedisClient, "InvalidCounter", Input.Value] },
				{ Method: "lrange", Arguments: [hRedisClient, "InvalidList", Input.Value, -1n] },
				{ Method: "lrange", Arguments: [hRedisClient, "InvalidList", 0n, Input.Value] },
			];
			for (const Request of vecInvalidRequests) {
				g_Assert.throws(() => g_RedisModule[Request.Method](...Request.Arguments, { Blocking: bBlocking }, () => {
					unCallbackCount += 1;
				}), Input.ErrorType, `${Request.Method} rejects invalid int64 input before scheduling (Blocking=${bBlocking})`);
			}
		}
	}

	await Promise.resolve();

	g_Assert.equal(unCallbackCount, 0, "invalid int64 arguments never invoke Callback");
	g_Assert.equal(g_vecRecordedCalls.length, unCallsBeforeValidation, "invalid int64 arguments never execute an operation");
}

async function VerifyRequestContracts() {
	const strCounterKey = "SourceJSSmokeCounter";
	const strSnapshotKey = "SourceJSSmokeSnapshot";
	const strListKey = "SourceJSSmokeList";

	for (const strExportName of g_vecExpectedExports) {
		g_Assert.throws(() => g_RedisModule[strExportName]({}, null), /requires a callback/, `${strExportName} requires Callback`);
		g_Assert.throws(() => g_RedisModule[strExportName](null, () => {}), /requires an options object/, `${strExportName} requires Options`);
		g_Assert.throws(() => g_RedisModule[strExportName]({ Blocking: "true" }, () => {}), /boolean Blocking/, `${strExportName} rejects a non-boolean Blocking option`);
	}

	const hRedisClient = CallRedis("connect", "tcp://127.0.0.1:6379");
	try {
		await VerifyRejectedInt64Arguments(hRedisClient);
		await VerifyRejectedHashArguments(hRedisClient);
		await VerifyBinaryRedisStrings(hRedisClient);

		let bCallbackCalled = false;
		const PendingPing = new Promise((Resolve, Reject) => {
			g_RedisModule.ping(hRedisClient, {}, (RequestError, Result) => {
				bCallbackCalled = true;

				if (RequestError) {
					Reject(RequestError);
					return;
				}

				Resolve(Result);
			});
		});
		g_Assert.equal(bCallbackCalled, false, "default request callback is deferred");
		g_Assert.equal(await PendingPing, "PONG", "deferred request result");
		g_Assert.equal(bCallbackCalled, true, "deferred callback completes");

		bCallbackCalled = false;
		g_RedisModule.ping(hRedisClient, { Blocking: true }, (RequestError, Result) => {
			g_Assert.equal(RequestError, null, "Blocking callback error");
			g_Assert.equal(Result, "PONG", "Blocking callback result");
			bCallbackCalled = true;
		});
		g_Assert.equal(bCallbackCalled, true, "Blocking callback runs before return");

		const Values = { [strSnapshotKey]: "Original" };
		const PendingSave = RequestRedis("mset", [hRedisClient, Values]);
		Values[strSnapshotKey] = "Changed";
		g_Assert.equal(await PendingSave, true, "queued write succeeds");
		g_Assert.equal(await RequestRedis("get", [hRedisClient, strSnapshotKey]), "Original", "queued input is a snapshot");

		g_Assert.equal(await RequestRedis("incr", [hRedisClient, strCounterKey]), 1n, "small integer results remain BigInt");

		g_Assert.equal(await RequestRedis("set", [hRedisClient, strCounterKey, String(g_nMaximumInt64 - 1n)]), true, "maximum-boundary setup write succeeds");
		g_Assert.equal(await RequestRedis("incr", [hRedisClient, strCounterKey]), g_nMaximumInt64, "maximum int64 result is lossless");
		await g_Assert.rejects(RequestRedis("incr", [hRedisClient, strCounterKey]), /integer overflow/, "positive overflow is a callback error");
		g_Assert.equal(await RequestRedis("get", [hRedisClient, strCounterKey]), String(g_nMaximumInt64), "overflow preserves the previous value");

		g_Assert.equal(await RequestRedis("set", [hRedisClient, strCounterKey, String(g_nMinimumInt64)]), true, "minimum-boundary setup write succeeds");
		await g_Assert.rejects(RequestRedis("decr", [hRedisClient, strCounterKey], { Blocking: true }), /integer overflow/, "Blocking failures also reach Callback");
		g_Assert.equal(await RequestRedis("get", [hRedisClient, strCounterKey]), String(g_nMinimumInt64), "negative overflow preserves the previous value");
		g_Assert.equal(await RequestRedis("incrby", [hRedisClient, strCounterKey, g_nMaximumInt64]), -1n, "large int64 increment is exact");

		g_Assert.equal(await RequestRedis("set", [hRedisClient, strCounterKey, "0"]), true, "zero-counter setup write succeeds");
		g_Assert.equal(await RequestRedis("incrby", [hRedisClient, strCounterKey, g_nMinimumInt64], { Blocking: true }), g_nMinimumInt64, "minimum int64 input and result are lossless in Blocking mode");

		g_Assert.equal(await RequestRedis("rpush", [hRedisClient, strListKey, ["First", "Second", "Third"]]), 3n, "list lengths remain BigInt");
		g_Assert.deepEqual(await RequestRedis("lrange", [hRedisClient, strListKey, g_nMinimumInt64, g_nMaximumInt64]), ["First", "Second", "Third"], "extreme int64 indices clamp before Number conversion");
		g_Assert.deepEqual(await RequestRedis("lrange", [hRedisClient, strListKey, g_nMaximumInt64, g_nMaximumInt64]), [], "a huge start index returns an empty range");
		g_Assert.deepEqual(await RequestRedis("lrange", [hRedisClient, strListKey, 0n, g_nMinimumInt64]), [], "a huge negative stop index returns an empty range");
		g_Assert.deepEqual(await RequestRedis("lrange", [hRedisClient, strListKey, -2n, -1n]), ["Second", "Third"], "negative BigInt indices remain relative to the list end");
	} finally {
		for (const strKey of [strCounterKey, strSnapshotKey, strListKey]) {
			// Failure may occur before a key exists; cleanup accepts zero deletions.
			CallRedis("del", hRedisClient, strKey);
		}

		g_Assert.equal(CallRedis("close", hRedisClient), true, "request fixture closes its handle");
	}

	g_Assert.equal(g_mapActiveHandles.size, 0, "request fixture leaves no handles");
	g_Assert.equal(g_mapDatabase.size, 0, "request fixture leaves no keys");
}

async function VerifyDocumentedRedisCleanup() {
	const vecWorkflows = [
		{ Name: "InspectRedisConnection", Method: "command", Arguments: [], CleanupKeyCount: 0 },
		{ Name: "ExerciseRedisStrings", Method: "mset", Arguments: ["OwnedNamespace"], CleanupKeyCount: 3 },
		{ Name: "ExerciseRedisHash", Method: "hset", Arguments: ["OwnedHash"], CleanupKeyCount: 1 },
		{ Name: "ExerciseRedisList", Method: "rpush", Arguments: ["OwnedList"], CleanupKeyCount: 1 },
		{ Name: "ExerciseRedisSetAndPublish", Method: "sadd", Arguments: ["OwnedSet", "OwnedChannel"], CleanupKeyCount: 1 },
	];

	for (const Workflow of vecWorkflows) {
		for (const Scenario of [
			{ ShouldFail: true, Failure: new Error("operation failed") },
			{ ShouldFail: true, Failure: null },
			{ ShouldFail: true, Failure: undefined },
			{ ShouldFail: false },
		]) {
			const OperationFailure = Scenario.Failure;

			for (const strCleanupMode of [
				"SUCCESS",
				"DELETE_FAILURE",
				"CLOSE_FAILURE",
				"CLOSE_FALSE",
				"BOTH_FAILURES",
			]) {
				const DeleteFailure = new Error("delete failed");
				const CloseFailure = new Error("close failed");
				const vecCleanupCalls = [];
				let bOperationStarted = false;
				const RedisModule = {};
				for (const strMethodName of Object.keys(g_RedisModule)) {
					RedisModule[strMethodName] = (...vecArguments) => {
						const Callback = vecArguments.pop();
						const Options = vecArguments.pop();
						g_Assert.equal(typeof Callback, "function", "cleanup workflow keeps required callback");
						g_Assert.deepEqual(CloneForAssertion(Options), {}, "cleanup workflow keeps required options");

						if (strMethodName === "connect") {
							Callback(null, 42);
							return;
						}

						g_Assert.equal(vecArguments[0], 42, "cleanup uses its acquired handle");

						if (strMethodName === Workflow.Method) {
							bOperationStarted = true;

							if (Scenario.ShouldFail) {
								throw OperationFailure;
							}
						}

						if (strMethodName === "del") {
							if (bOperationStarted) {
								vecCleanupCalls.push(strMethodName);

								if ((strCleanupMode === "DELETE_FAILURE") || (strCleanupMode === "BOTH_FAILURES")) {
									Callback(DeleteFailure, undefined);
									return;
								}
							}

							Callback(null, 1n);
							return;
						}

						if (strMethodName === "close") {
							vecCleanupCalls.push(strMethodName);

							if ((strCleanupMode === "CLOSE_FAILURE") || (strCleanupMode === "BOTH_FAILURES")) {
								Callback(CloseFailure, undefined);
								return;
							}

							Callback(null, strCleanupMode !== "CLOSE_FALSE");
							return;
						}

						// Minimal native double: only setup booleans and workflow control flow matter here.
						Callback(null, ["mset", "set", "expire"].includes(strMethodName) ? true : 1n);
					};
				}

				const DocumentedWorkflows = {};
				for (const [unBlockOffset, strCode] of g_vecCodeBlocks.entries()) {
					Object.assign(DocumentedWorkflows, ExecuteCodeBlock(strCode, unBlockOffset + 1, RedisModule));
				}

				let bRejected = false;
				let ReceivedFailure;

				try {
					await DocumentedWorkflows[Workflow.Name]("tcp://127.0.0.1:6379", ...Workflow.Arguments);
				} catch (Failure) {
					bRejected = true;
					ReceivedFailure = Failure;
				}

				g_Assert.deepEqual(vecCleanupCalls, [...Array(Workflow.CleanupKeyCount).fill("del"), "close"], "every deletion is attempted before closing despite failures");
				const vecExpectedFailures = Scenario.ShouldFail ? [OperationFailure] : [];
				if ((strCleanupMode === "DELETE_FAILURE") || (strCleanupMode === "BOTH_FAILURES")) {
					vecExpectedFailures.push(...Array(Workflow.CleanupKeyCount).fill(DeleteFailure));
				}

				if ((strCleanupMode === "CLOSE_FAILURE") || (strCleanupMode === "BOTH_FAILURES")) {
					vecExpectedFailures.push(CloseFailure);
				}

				if (strCleanupMode === "CLOSE_FALSE") {
					g_Assert.equal(bRejected, true);
					g_Assert.equal(ReceivedFailure.name, "AggregateError", "false close result becomes a cleanup failure");
					g_Assert.equal(ReceivedFailure.errors.length, vecExpectedFailures.length + 1);

					if (Scenario.ShouldFail) {
						g_Assert.equal(ReceivedFailure.errors[0], OperationFailure);
					}

					g_Assert.match(ReceivedFailure.errors.at(-1).message, /did not close/);
				} else if (vecExpectedFailures.length > (Scenario.ShouldFail ? 1 : 0)) {
					g_Assert.equal(bRejected, true);
					g_Assert.equal(ReceivedFailure.name, "AggregateError");
					g_Assert.deepEqual(Array.from(ReceivedFailure.errors), vecExpectedFailures, "operation and cleanup failure identity/order are preserved");
				} else if (Scenario.ShouldFail) {
					g_Assert.equal(bRejected, true, "operation failure rejects even when it is null or undefined");
					g_Assert.equal(ReceivedFailure, OperationFailure, "successful cleanup preserves the original thrown value");
				} else {
					g_Assert.equal(bRejected, false, "successful work and cleanup resolve normally");
				}
			}
		}
	}

	const strStringWorkflowCode = g_vecCodeBlocks.find((strCode) => strCode.includes("async function ExerciseRedisStrings("));
	g_Assert.equal(typeof strStringWorkflowCode, "string");

	for (const PreparationFailure of [
		new Error("namespace preparation failed"),
		null,
		undefined,
	]) {
		let unConnectCalls = 0;
		const RedisModule = {
			connect() {
				++unConnectCalls;
				throw new Error("connect must not run before namespace preparation");
			},
		};
		const DocumentedWorkflow = ExecuteCodeBlock(strStringWorkflowCode, 0, RedisModule);
		const Namespace = {
			[Symbol.toPrimitive]() {
				throw PreparationFailure;
			},
		};

		let bRejected = false;
		let ReceivedFailure;

		try {
			await DocumentedWorkflow.ExerciseRedisStrings("tcp://127.0.0.1:6379", Namespace);
		} catch (Failure) {
			bRejected = true;
			ReceivedFailure = Failure;
		}

		g_Assert.equal(bRejected, true);
		g_Assert.equal(ReceivedFailure, PreparationFailure, "namespace failure is preserved exactly");
		g_Assert.equal(unConnectCalls, 0, "namespace preparation failure does not acquire a handle");
	}
}

async function VerifyDocumentedRedisWorkflows() {
	const hUnknownRedisClient = 9999;
	const DocumentedWorkflows = {};
	for (const [unBlockOffset, strCode] of g_vecCodeBlocks.entries()) {
		Object.assign(DocumentedWorkflows, ExecuteCodeBlock(strCode, unBlockOffset + 1));
	}

	g_Assert.equal(g_vecRecordedCalls.length, 0, "redis code blocks must not call native APIs while loading");
	g_Assert.deepEqual(Object.keys(DocumentedWorkflows).sort(), [
		"ExerciseRedisHash",
		"ExerciseRedisList",
		"ExerciseRedisSetAndPublish",
		"ExerciseRedisStrings",
		"InspectRedisConnection",
	], "redis documented workflows");

	const ConnectionResult = CloneForAssertion(await DocumentedWorkflows.InspectRedisConnection("tcp://127.0.0.1:6379"));
	g_Assert.deepEqual(ConnectionResult, {
		CommandEcho: "sourcejs-command",
		Echo: "sourcejs",
		Ping: "PONG",
		ServerTime: ["1700000000", "0"],
	}, "redis Connection workflow result");

	const StringResult = CloneForAssertion(await DocumentedWorkflows.ExerciseRedisStrings("tcp://127.0.0.1:6379", "sourcejs:smoke"));
	g_Assert.deepEqual(StringResult, {
		CounterValues: [1n, 5n, 4n],
		DatabaseSize: 3n,
		Exists: true,
		ExpiringTTL: 60n,
		InitialValues: ["online", "ready", null],
		MatchingKeys: ["sourcejs:smoke:Counter", "sourcejs:smoke:Peer", "sourcejs:smoke:State"],
		Persisted: true,
		PersistentTTL: -1n,
		State: "online",
		Type: "string",
	}, "redis string workflow result");

	const HashResult = await DocumentedWorkflows.ExerciseRedisHash("tcp://127.0.0.1:6379", "sourcejs:smoke:hash");
	g_Assert.equal(Object.getPrototypeOf(HashResult.Fields), null, "redis hgetall null prototype");
	g_Assert.deepEqual(CloneForAssertion(HashResult), {
		CreatedFields: [1n, 1n],
		DeletedFields: 2n,
		Fields: { Score: "125", Status: "alive" },
		LengthAfterDelete: 0n,
		LengthBeforeDelete: 2n,
		Score: "125",
		ScoreExists: true,
	}, "redis hash workflow result");

	g_Assert.deepEqual(CloneForAssertion(await DocumentedWorkflows.ExerciseRedisList("tcp://127.0.0.1:6379", "sourcejs:smoke:list")), {
		Left: "MapStart",
		Remaining: ["RoundStart"],
		Right: "TankSpawn",
		Snapshot: ["MapStart", "RoundStart", "TankSpawn"],
	}, "redis list workflow result");

	g_Assert.deepEqual(CloneForAssertion(await DocumentedWorkflows.ExerciseRedisSetAndPublish("tcp://127.0.0.1:6379", "sourcejs:smoke:set", "sourcejs:events")), {
		Added: 2n,
		MembersAfter: ["Admin"],
		MembersBefore: ["Admin", "Moderator"],
		Removed: 1n,
		Subscribers: 2n,
	}, "redis set and publish workflow result");

	g_Assert.equal(CallRedis("close", hUnknownRedisClient), false, "Redis close should reject an unknown handle without throwing");
	g_Assert.equal(g_mapActiveHandles.size, 0, "redis workflows must close every handle");
	g_Assert.equal(g_mapDatabase.size, 0, "redis workflows must delete every owned key");

	const mapInternalToPublicOperationNames = new Map(Object.entries(g_RedisOperationNames).map(([strPublicName, strOperationName]) => [strOperationName, strPublicName]));
	const setCalledExportNames = new Set(g_vecRecordedCalls.map((vecCall) => mapInternalToPublicOperationNames.get(vecCall[0])));
	for (const strExportName of g_vecExpectedExports) {
		g_Assert.ok(setCalledExportNames.has(strExportName), `redis workflow must call ${strExportName}`);
	}

	await VerifyRequestContracts();
	await VerifyDocumentedRedisCleanup();

	console.log("Redis smoke passed: exact lowercase exports, documentation workflows and 100 cleanup/3 input-preparation scenarios, callback controls, snapshots, UTF8/NUL strings and BigInt boundaries (Node double); native close/request/string source guards and forty-four mutation rejections plus three execution-mode initialization controls.");
}

const g_strMarkdown = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_strBindings = g_FileSystem.readFileSync(g_strModuleBindingsSourcePath, "utf8");
const g_vecCodeBlocks = [...g_strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
const g_vecRedisBindingBlock = g_strBindings.match(/v8::Local<v8::Object>\s+const\s+LocalRedisModule\s*=\s*MakeModule[\s\S]*?InstallModule\(\s*pIsolate,\s*LocalContext,\s*LocalSourceJS,\s*"redis",\s*LocalRedisModule\s*\)\)/);
g_Assert.ok(g_vecRedisBindingBlock, "native Redis registration block");

const g_vecNativeExports = [...g_vecRedisBindingBlock[0].matchAll(/SetFunction\([^\n]+LocalRedisModule, "([^"]+)"/g)].map((vecMatch) => vecMatch[1]).sort();
const g_bHasNamespaceImport = (g_vecCodeBlocks.length > 0) && /const g_Redis = require\("redis"\);/.test(g_vecCodeBlocks[0]);
const g_vecExportsSectionMatch = g_strMarkdown.match(/## Exports\r?\n([\s\S]*?)\r?\n## /);
g_Assert.ok(g_bHasNamespaceImport, "redis namespace import example");
g_Assert.ok(g_vecExportsSectionMatch, "redis exports table");

g_Assert.deepEqual(g_vecNativeExports, g_vecExpectedExports, "native Redis exact exports");
VerifyNativeExecutionModeInitialization(g_strBindings);
VerifyNativeCloseOwnership(g_strBindings);
VerifyNativeCloseGuardMutations(g_strBindings);
VerifyReviewedNativeRequestBoundaries(g_strBindings);
VerifyNativeRequestBoundaryMutations(g_strBindings);
VerifyNativeStringConversion(g_strBindings);
VerifyNativeStringGuardMutations(g_strBindings);
g_Assert.deepEqual(Object.keys(g_RedisModule).sort(), g_vecExpectedExports, "Redis smoke exact exports");
g_Assert.deepEqual([...g_vecExportsSectionMatch[1].matchAll(/^\| `([a-z]+)\(/gm)].map((vecMatch) => vecMatch[1]).sort(), g_vecExpectedExports, "documented Redis exact exports");
g_Assert.equal(g_vecCodeBlocks.length, g_unExpectedCodeBlockCount, "redis JavaScript block count");
g_Assert.doesNotMatch(g_strMarkdown, /Generated by|\bconsole\./, "redis documentation must remain hand-written");
g_Assert.match(g_strMarkdown, /g_Redis\.connect\(/, "Redis lowercase connect usage");
g_Assert.match(g_strMarkdown, /g_Redis\.get\(/, "Redis lowercase get usage");
g_Assert.doesNotMatch(g_strMarkdown, /Redis\.(?:Close|Connect|Get|Set)\(/, "Redis docs must not use obsolete PascalCase methods");
g_Assert.doesNotMatch(g_strMarkdown, /[^\x00-\x7F]/, "redis documentation ASCII");
g_Assert.doesNotMatch(g_strMarkdown, /[ \t]+$/m, "redis documentation trailing whitespace");

for (const strCode of g_vecCodeBlocks) {
	g_Assert.doesNotMatch(strCode, /^ +\S/m, "redis JavaScript fence indentation must use tabs");
}

VerifyContentsAnchors(g_strMarkdown);
VerifyDocumentationLinks(g_strMarkdown);

VerifyDocumentedRedisWorkflows().catch((RequestError) => {
	process.stderr.write(`${RequestError.stack}\n`);
	process.exitCode = 1;
});
