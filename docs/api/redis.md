# `require("redis")`

> AI processing note: this page documents asynchronous SourceJS-runtime-owned redis++ clients. Keep runtime ownership, Redis key cleanup, 64-bit integer conversion and arbitrary reply conversion distinct.

`redis` is the mandatory native redis++ integration. Every supported SourceJS build requires redis++; there is no JavaScript fallback or optional stub.

Redis method names are lowercase (`get`, `set`, `hgetall`, `incrby`, and so on). Module guide: [External libraries](../external-libraries.md).

## Contents

- [Import](#import)
- [Exports](#exports)
- [Connection And Commands](#connection-and-commands)
- [Strings Counters And Keys](#strings-counters-and-keys)
- [Hashes](#hashes)
- [Lists](#lists)
- [Sets And Publish](#sets-and-publish)
- [Return Values](#return-values)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const g_Redis = require("redis");
```

Every method requires a trailing `Options` object and `Callback`, even when no option is set. `Options.Blocking` is optional; missing, `null`, or `undefined` means `false`. Each request uses its own worker thread; its error-first `Callback(RequestError, Result)` runs on the game thread. With `{ Blocking: true }`, the game thread waits for that request and the same callback still runs before the method returns. Each runtime accepts at most 128 outstanding asynchronous requests; invalid arguments and requests rejected by the queue throw synchronously, while native request failures are reported through the callback.

Successful callbacks receive `null` as `RequestError`; failed operations or result conversions receive an `Error` and `undefined` as `Result`. Callback exceptions are logged by the runtime rather than becoming a second request failure. Request admission and argument conversion run on the game thread; only the native operation runs on its worker. Blocking waits, result conversion and user callbacks can still stall the game thread. Requests are not a Redis transaction or an ordering guarantee: await dependent calls explicitly.

If argument or option getters remove the calling JavaScript context, request admission throws synchronously before starting a worker or retaining the callback for delivery. This applies to asynchronous and blocking requests.

Each game-frame pump caps its outer drain at the number of completions ready when it begins. This is a count budget, not an immutable batch or a time budget; it does not bound an individual callback or blocking request. Blocking callbacks and reentrant request delivery are separate from this outer budget. The 128-request limit is shared with the runtime's other asynchronous native APIs and cleanup tasks, not reserved for Redis.

## Exports

| Method | Callback result | Purpose |
| --- | --- | --- |
| `connect(strRedisURI, Options, Callback)` | Positive integer client handle | Creates a redis++ client scoped to the current runtime owner from a non-empty URI. |
| `close(hRedisClient, Options, Callback)` | `boolean` | Closes the current runtime owner's client. |
| `command(hRedisClient, Command, ...vecArguments, Options, Callback)` | Reply-dependent value | Executes arbitrary string command parts; `Command` may instead be a non-empty string array whose first element is non-empty. |
| `ping(hRedisClient, strMessage?, Options, Callback)` | `string` | Executes payload-free `PING` when `strMessage` is omitted or nullish; otherwise echoes the supplied string, including an empty string. |
| `get(hRedisClient, strKey, Options, Callback)` | `string \| null` | Reads one string key. |
| `set(hRedisClient, strKey, strValue, Options, Callback)` | `true` | Writes one string value. |
| `del(hRedisClient, strKey, Options, Callback)` | Integer | Deletes one key. |
| `exists(hRedisClient, strKey, Options, Callback)` | `boolean` | Tests one key. |
| `incr(hRedisClient, strKey, Options, Callback)` | Integer | Increments one integer string by one. |
| `decr(hRedisClient, strKey, Options, Callback)` | Integer | Decrements one integer string by one. |
| `incrby(hRedisClient, strKey, nIncrement, Options, Callback)` | Integer | Applies a lossless signed 64-bit increment. |
| `expire(hRedisClient, strKey, nSeconds, Options, Callback)` | `boolean` | Applies signed 32-bit expiration seconds. |
| `ttl(hRedisClient, strKey, Options, Callback)` | Integer | Reads TTL seconds, including Redis negative sentinels. |
| `persist(hRedisClient, strKey, Options, Callback)` | `boolean` | Removes a key expiration. |
| `type(hRedisClient, strKey, Options, Callback)` | `string` | Reads the Redis type name. |
| `dbsize(hRedisClient, Options, Callback)` | Integer | Reads the current database key count. |
| `keys(hRedisClient, strPattern, Options, Callback)` | `string[]` | Executes blocking `KEYS` on its worker; reserve it for controlled diagnostics. |
| `mget(hRedisClient, vecKeys, Options, Callback)` | `(string \| null)[]` | Reads a non-empty key array in order. |
| `mset(hRedisClient, Values, Options, Callback)` | `true` | Writes a non-empty object of string values. |
| `hget(hRedisClient, strKey, strField, Options, Callback)` | `string \| null` | Reads one hash field. |
| `hset(hRedisClient, strKey, strField, strValue, Options, Callback)` | Integer | Writes one hash field. |
| `hdel(hRedisClient, strKey, Fields, Options, Callback)` | Integer | Deletes one field string or non-empty field array. |
| `hexists(hRedisClient, strKey, strField, Options, Callback)` | `boolean` | Tests one hash field. |
| `hlen(hRedisClient, strKey, Options, Callback)` | Integer | Reads a hash field count. |
| `hgetall(hRedisClient, strKey, Options, Callback)` | Null-prototype object | Reads all hash fields as string properties. |
| `lpush(hRedisClient, strKey, Values, Options, Callback)` | Integer | Pushes one string or a non-empty string array on the left. |
| `rpush(hRedisClient, strKey, Values, Options, Callback)` | Integer | Pushes one string or a non-empty string array on the right. |
| `lpop(hRedisClient, strKey, Options, Callback)` | `string \| null` | Pops the leftmost value. |
| `rpop(hRedisClient, strKey, Options, Callback)` | `string \| null` | Pops the rightmost value. |
| `lrange(hRedisClient, strKey, nStart, nStop, Options, Callback)` | `string[]` | Reads an inclusive lossless signed 64-bit range. |
| `sadd(hRedisClient, strKey, Members, Options, Callback)` | Integer | Adds one string or a non-empty string array. |
| `srem(hRedisClient, strKey, Members, Options, Callback)` | Integer | Removes one string or a non-empty string array. |
| `smembers(hRedisClient, strKey, Options, Callback)` | `string[]` | Reads all set members. |
| `publish(hRedisClient, strChannel, strMessage, Options, Callback)` | Integer | Publishes a string and returns the receiving subscriber count. |

`Integer` means an exact signed 64-bit JavaScript `bigint` at every magnitude, including `0n` and `1n`. Client handles are separate process-local 32-bit identifiers and remain `number` values. Use BigInt literals for 64-bit arguments such as `nIncrement`, `nStart` and `nStop`.

## Connection And Commands

The callback is required even when `Options.Blocking` is true. This Promise adapter keeps the example sequential while passing both required trailing arguments on every native call:

```js
const g_Redis = require("redis");

function AwaitRedisRequest(Options, StartRequest) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			if (RequestError) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function InspectRedisConnection(strURI) {
	const hRedisClient = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.connect(strURI, Options, Callback));
	const vecFailures = [];

	try {
		return {
			CommandEcho: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.command(hRedisClient, "ECHO", "sourcejs-command", Options, Callback)),
			Echo: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.ping(hRedisClient, "sourcejs", Options, Callback)),
			Ping: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.ping(hRedisClient, Options, Callback)),
			ServerTime: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.command(hRedisClient, ["TIME"], Options, Callback)),
		};
	} catch (RequestError) {
		vecFailures.push(RequestError);
		throw RequestError;
	} finally {
		const unOperationFailureCount = vecFailures.length;
		try {
			const bClosed = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.close(hRedisClient, Options, Callback));
			if (!bClosed) {
				throw new Error("Redis client handle did not close.");
			}
		} catch (CleanupError) {
			vecFailures.push(CleanupError);
		}

		if (vecFailures.length > unOperationFailureCount) {
			throw new AggregateError(vecFailures, "Redis connection workflow cleanup failed.");
		}
	}
}

module.exports = { InspectRedisConnection };
```

The examples preserve the original operation failure, including a thrown `null` or `undefined`. If cleanup also fails, they report an `AggregateError` containing that failure and each cleanup failure in occurrence order. Successful cleanup does not replace the original failure. Use dedicated caller-owned keys: cleanup attempts every listed deletion and then closes the handle, but failed cleanup can leave remote data behind. These examples do not roll back Redis commands or prevent concurrent clients from changing the same keys.

`command()` converts Redis replies recursively: nil becomes `null`; signed 64-bit integers always become `bigint`; supported RESP3 doubles and booleans become `number` and `boolean`; strings, status, big-number and verbatim replies become strings; and arrays plus supported RESP3 aggregates become arrays. A RESP3 map remains a flat alternating key/value array, not a JavaScript `Map` or object. RESP3-specific conversion depends on the linked hiredis headers and client/server protocol setup; `connect()` alone is not a promise of RESP3 replies. Redis error replies are reported through `Callback`; an aggregate with more than `INT_MAX` elements fails without publishing a partial result.

Aggregate indexes are created as own data properties, without invoking inherited array setters. Native result conversion checks each value and index before returning the complete array; conversion failures do not publish a partially constructed aggregate.

## Strings Counters And Keys

This workflow uses a dedicated caller-owned namespace, exercises every string/counter/key API and attempts to delete every owned key:

```js
const g_Redis = require("redis");

function AwaitRedisRequest(Options, StartRequest) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			if (RequestError) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function ExerciseRedisStrings(strURI, strNamespace) {
	const strStateKey = `${strNamespace}:State`;
	const strPeerKey = `${strNamespace}:Peer`;
	const strCounterKey = `${strNamespace}:Counter`;
	const vecOwnedKeys = [strStateKey, strPeerKey, strCounterKey];

	const hRedisClient = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.connect(strURI, Options, Callback));
	const vecFailures = [];

	try {
		for (const strKey of vecOwnedKeys) {
			await AwaitRedisRequest({}, (Options, Callback) => g_Redis.del(hRedisClient, strKey, Options, Callback));
		}

		const bValuesSet = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.mset(hRedisClient, { [strPeerKey]: "ready", [strStateKey]: "online" }, Options, Callback));
		const bCounterSet = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.set(hRedisClient, strCounterKey, "0", Options, Callback));
		if ((bValuesSet !== true) || (bCounterSet !== true)) {
			throw new Error("Redis string setup failed.");
		}

		const vecInitialValues = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.mget(hRedisClient, [strStateKey, strPeerKey, `${strNamespace}:Missing`], Options, Callback));
		const vecCounterValues = [
			await AwaitRedisRequest({}, (Options, Callback) => g_Redis.incr(hRedisClient, strCounterKey, Options, Callback)),
			await AwaitRedisRequest({}, (Options, Callback) => g_Redis.incrby(hRedisClient, strCounterKey, 4n, Options, Callback)),
			await AwaitRedisRequest({}, (Options, Callback) => g_Redis.decr(hRedisClient, strCounterKey, Options, Callback)),
		];

		if (await AwaitRedisRequest({}, (Options, Callback) => g_Redis.expire(hRedisClient, strStateKey, 60, Options, Callback)) !== true) {
			throw new Error("Redis expiration setup failed.");
		}

		const nExpiringTTL = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.ttl(hRedisClient, strStateKey, Options, Callback));
		const bPersisted = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.persist(hRedisClient, strStateKey, Options, Callback)) === true;

		return {
			CounterValues: vecCounterValues,
			DatabaseSize: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.dbsize(hRedisClient, Options, Callback)),
			Exists: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.exists(hRedisClient, strStateKey, Options, Callback)),
			ExpiringTTL: nExpiringTTL,
			InitialValues: vecInitialValues,
			MatchingKeys: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.keys(hRedisClient, `${strNamespace}:*`, Options, Callback)),
			Persisted: bPersisted,
			PersistentTTL: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.ttl(hRedisClient, strStateKey, Options, Callback)),
			State: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.get(hRedisClient, strStateKey, Options, Callback)),
			Type: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.type(hRedisClient, strStateKey, Options, Callback)),
		};
	} catch (RequestError) {
		vecFailures.push(RequestError);
		throw RequestError;
	} finally {
		const unOperationFailureCount = vecFailures.length;
		for (const strKey of vecOwnedKeys) {
			try {
				await AwaitRedisRequest({}, (Options, Callback) => g_Redis.del(hRedisClient, strKey, Options, Callback));
			} catch (CleanupError) {
				vecFailures.push(CleanupError);
			}
		}

		try {
			const bClosed = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.close(hRedisClient, Options, Callback));
			if (!bClosed) {
				throw new Error("Redis string workflow handle did not close.");
			}
		} catch (CleanupError) {
			vecFailures.push(CleanupError);
		}

		if (vecFailures.length > unOperationFailureCount) {
			throw new AggregateError(vecFailures, "Redis string workflow cleanup failed.");
		}
	}
}

module.exports = { ExerciseRedisStrings };
```

`keys()` scans the complete keyspace and can stall a production server. Use `g_Redis.command(hRedisClient, "SCAN", ...vecArguments, Options, Callback)` for incremental production iteration.

## Hashes

```js
const g_Redis = require("redis");

function AwaitRedisRequest(Options, StartRequest) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			if (RequestError) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function ExerciseRedisHash(strURI, strHashKey) {
	const hRedisClient = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.connect(strURI, Options, Callback));
	const vecFailures = [];

	try {
		await AwaitRedisRequest({}, (Options, Callback) => g_Redis.del(hRedisClient, strHashKey, Options, Callback));

		const vecCreatedFields = [
			await AwaitRedisRequest({}, (Options, Callback) => g_Redis.hset(hRedisClient, strHashKey, "Score", "125", Options, Callback)),
			await AwaitRedisRequest({}, (Options, Callback) => g_Redis.hset(hRedisClient, strHashKey, "Status", "alive", Options, Callback)),
		];
		const Fields = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.hgetall(hRedisClient, strHashKey, Options, Callback));
		const strScore = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.hget(hRedisClient, strHashKey, "Score", Options, Callback));
		const bScoreExists = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.hexists(hRedisClient, strHashKey, "Score", Options, Callback));
		const unLengthBeforeDelete = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.hlen(hRedisClient, strHashKey, Options, Callback));
		const unDeletedFields = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.hdel(hRedisClient, strHashKey, ["Score", "Status"], Options, Callback));

		return {
			CreatedFields: vecCreatedFields,
			DeletedFields: unDeletedFields,
			Fields,
			LengthAfterDelete: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.hlen(hRedisClient, strHashKey, Options, Callback)),
			LengthBeforeDelete: unLengthBeforeDelete,
			Score: strScore,
			ScoreExists: bScoreExists,
		};
	} catch (RequestError) {
		vecFailures.push(RequestError);
		throw RequestError;
	} finally {
		const unOperationFailureCount = vecFailures.length;
		try {
			await AwaitRedisRequest({}, (Options, Callback) => g_Redis.del(hRedisClient, strHashKey, Options, Callback));
		} catch (CleanupError) {
			vecFailures.push(CleanupError);
		}

		try {
			const bClosed = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.close(hRedisClient, Options, Callback));
			if (!bClosed) {
				throw new Error("Redis hash workflow handle did not close.");
			}
		} catch (CleanupError) {
			vecFailures.push(CleanupError);
		}

		if (vecFailures.length > unOperationFailureCount) {
			throw new AggregateError(vecFailures, "Redis hash workflow cleanup failed.");
		}
	}
}

module.exports = { ExerciseRedisHash };
```

`hgetall()` returns an object whose prototype is `null`, so Redis field names such as `__proto__` remain ordinary data properties. Use `Object.hasOwn(Fields, strFieldName)` rather than prototype methods. Returned field names preserve the stored Redis data without renaming: `Name` and `Name\0Suffix` are distinct keys. This also includes empty field names created by another Redis client, even though SourceJS `hset()` requires a non-empty field argument.

## Lists

```js
const g_Redis = require("redis");

function AwaitRedisRequest(Options, StartRequest) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			if (RequestError) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function ExerciseRedisList(strURI, strListKey) {
	const hRedisClient = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.connect(strURI, Options, Callback));
	const vecFailures = [];

	try {
		await AwaitRedisRequest({}, (Options, Callback) => g_Redis.del(hRedisClient, strListKey, Options, Callback));
		await AwaitRedisRequest({}, (Options, Callback) => g_Redis.rpush(hRedisClient, strListKey, ["RoundStart", "TankSpawn"], Options, Callback));
		await AwaitRedisRequest({}, (Options, Callback) => g_Redis.lpush(hRedisClient, strListKey, "MapStart", Options, Callback));

		const vecSnapshot = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.lrange(hRedisClient, strListKey, 0n, -1n, Options, Callback));
		const strLeft = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.lpop(hRedisClient, strListKey, Options, Callback));
		const strRight = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.rpop(hRedisClient, strListKey, Options, Callback));
		const vecRemaining = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.lrange(hRedisClient, strListKey, 0n, -1n, Options, Callback));

		return { Left: strLeft, Remaining: vecRemaining, Right: strRight, Snapshot: vecSnapshot };
	} catch (RequestError) {
		vecFailures.push(RequestError);
		throw RequestError;
	} finally {
		const unOperationFailureCount = vecFailures.length;
		try {
			await AwaitRedisRequest({}, (Options, Callback) => g_Redis.del(hRedisClient, strListKey, Options, Callback));
		} catch (CleanupError) {
			vecFailures.push(CleanupError);
		}

		try {
			const bClosed = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.close(hRedisClient, Options, Callback));
			if (!bClosed) {
				throw new Error("Redis list workflow handle did not close.");
			}
		} catch (CleanupError) {
			vecFailures.push(CleanupError);
		}

		if (vecFailures.length > unOperationFailureCount) {
			throw new AggregateError(vecFailures, "Redis list workflow cleanup failed.");
		}
	}
}

module.exports = { ExerciseRedisList };
```

The `nStart` and `nStop` arguments are signed 64-bit `bigint` indexes, not vectors or memory objects. Negative Redis indexes such as `-1n` are supported; both endpoints are inclusive.

## Sets And Publish

```js
const g_Redis = require("redis");

function AwaitRedisRequest(Options, StartRequest) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			if (RequestError) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function ExerciseRedisSetAndPublish(strURI, strSetKey, strChannel) {
	const hRedisClient = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.connect(strURI, Options, Callback));
	const vecFailures = [];

	try {
		await AwaitRedisRequest({}, (Options, Callback) => g_Redis.del(hRedisClient, strSetKey, Options, Callback));

		const unAdded = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.sadd(hRedisClient, strSetKey, ["Admin", "Moderator"], Options, Callback));
		const vecMembersBefore = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.smembers(hRedisClient, strSetKey, Options, Callback));
		const unRemoved = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.srem(hRedisClient, strSetKey, "Moderator", Options, Callback));
		const unSubscribers = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.publish(hRedisClient, strChannel, JSON.stringify({ Event: "PermissionsChanged", SetKey: strSetKey }), Options, Callback));

		return {
			Added: unAdded,
			MembersAfter: await AwaitRedisRequest({}, (Options, Callback) => g_Redis.smembers(hRedisClient, strSetKey, Options, Callback)),
			MembersBefore: vecMembersBefore,
			Removed: unRemoved,
			Subscribers: unSubscribers,
		};
	} catch (RequestError) {
		vecFailures.push(RequestError);
		throw RequestError;
	} finally {
		const unOperationFailureCount = vecFailures.length;
		try {
			await AwaitRedisRequest({}, (Options, Callback) => g_Redis.del(hRedisClient, strSetKey, Options, Callback));
		} catch (CleanupError) {
			vecFailures.push(CleanupError);
		}

		try {
			const bClosed = await AwaitRedisRequest({}, (Options, Callback) => g_Redis.close(hRedisClient, Options, Callback));
			if (!bClosed) {
				throw new Error("Redis set workflow handle did not close.");
			}
		} catch (CleanupError) {
			vecFailures.push(CleanupError);
		}

		if (vecFailures.length > unOperationFailureCount) {
			throw new AggregateError(vecFailures, "Redis set workflow cleanup failed.");
		}
	}
}

module.exports = { ExerciseRedisSetAndPublish };
```

`publish()` does not create a SourceJS cross-plugin channel. It publishes to Redis subscribers; use [`plugins/bus`](plugins-bus.md) for in-process isolated-plugin messages.

## Return Values

- Optional Redis strings return `null` when the key, field or list element is absent.
- String results are decoded as UTF-8 using their explicit byte length. Embedded `\0` characters are not terminators, and an empty string remains distinct from a missing value. This is a text API, not an arbitrary byte-buffer API.
- Redis signed 64-bit values always return exact `bigint` values, never magnitude-dependent `number` values. Do not normalize these results through `JSON.stringify()` without an explicit application serialization policy.
- `mget()` preserves input order and uses `null` for each missing key. Native result conversion creates own array-element data properties without invoking inherited setters.
- `hgetall()` returns a null-prototype object with own data properties and preserves external Redis field names exactly. Native conversion checks prototype setup and each field name, value and property write before continuing. List/set/key collectors return new string arrays.
- `ttl()` preserves Redis sentinel values as `-1n` for no expiration and `-2n` for an absent key.
- `command()` recursively converts RESP arrays and supported RESP3 aggregate replies to JavaScript arrays.

## Errors

- Every operation requires a registered SourceJS runtime context. Plugin contexts use their plugin name as the owner; the main runtime uses its dedicated owner scope. Any other context throws before accessing a client.
- Every `hRedisClient` argument accepts either a positive signed 32-bit integer `number` or an object whose `Handle` property is such a number; it is not a native address or a `bigint`. A missing or malformed handle argument throws an argument-validation error. Every operation except `connect()` and `close()` requires the resolved handle to belong to the current runtime owner. A well-formed unknown or foreign-owner handle passed to another operation throws; an admitted `close()` reports `false` through its callback for an unknown or foreign-owner handle, but still requires valid options, callback and queue admission.
- Keys, fields, URI, patterns, channels and command names must be non-empty strings. Values and messages may be empty where the native signature allows them.
- Collection arguments must use the documented non-empty string array or object shape. `mset()` rejects empty objects and non-string values. Native collection parsing snapshots array lengths or own property names and commits copied values only after validation completes. A failed getter or conversion stops parsing without committing a partial native collection; getter side effects are not rolled back.
- For `command()`, use either a command name followed by string arguments or one array containing the complete command. Do not combine the array form with extra positional command parts: the current native parser reads only the array in that form and ignores those extra parts. The first part must be non-empty; later parts may be empty strings.
- `expire()` requires a signed 32-bit `number`. `incrby()` and `lrange()` require `bigint` values within the signed 64-bit range; even small `number` arguments are rejected.
- Every operation requires both a trailing `Options` object and a `Callback` function. Argument/context validation failures throw before scheduling; Redis error replies, connection failures and redis++ exceptions are delivered to `Callback` as `(RequestError, Result)`.
- Native client lookup, request setup, command parsing and result conversion contain C++ exceptions. During synchronous admission and validation, a caught V8 exception or execution termination is preserved rather than replaced with a generic validation error. Callback request errors are newly constructed JavaScript `Error` values using the captured native message or conversion diagnostic; do not rely on the original exception's identity or class surviving this boundary. The `command()`, `get()`, `set()`, `del()`, `exists()`, `incr()`, `expire()`, `hget()`, `hset()`, `dbsize()`, `keys()`, `type()`, `ttl()`, `persist()`, `decr()`, `incrby()`, `mget()`, `mset()`, `hdel()`, `hexists()`, `hlen()`, `hgetall()`, `lpush()`, `rpush()`, `lpop()`, `rpop()`, `lrange()`, `sadd()`, `srem()`, `smembers()` and `publish()` entry points stop after a failed argument/context check; `command()`, `mget()` and `hgetall()` result converters check the complete value before returning it. These checks do not roll back side effects from JavaScript argument or option getters, or cancel an already admitted request.
- Native string-array results create their own indexed data properties rather than invoking inherited indexed setters. Allocation, string conversion and property-definition failures stop conversion without returning a partial array.
- If SourceJS exhausts its process-local positive external-handle range while creating a client handle, no handle is returned and `Callback` receives an error. With `Options.Blocking: true`, SourceJS waits for that request on the game thread and still invokes the required callback there.

## Lifecycle

Handles are positive process-local integers bound to the runtime owner that created them: a plugin name for plugin contexts or the dedicated main-runtime owner scope. Plugin contexts cannot share handles with one another; exchange connection configuration through [`plugins/bus`](plugins-bus.md) and let each plugin open its own client.

`connect()` registers a new native client only after successfully constructing its JavaScript handle result.

An executed Redis command is not undone by a later conversion or callback failure. Once a client is registered, a callback exception does not unregister it. Keep ownership of a successful handle and close it explicitly; a callback exception is logged, not an automatic close or command retry.

Close clients with `close(hRedisClient, Options, Callback)` in `finally` blocks as soon as the workflow ends. SourceJS erases plugin-owned clients when that plugin context unloads and main-runtime clients during runtime shutdown, but explicit close keeps normal reload and error paths deterministic.

An accepted `close()` makes the handle unavailable to subsequent commands. Its worker releases the close request's client reference; requests accepted earlier retain their own references until they finish, so `close()` is not a cancellation or completion barrier for those requests. Repeated closes report `false`. If queue submission is rejected before its worker starts, SourceJS restores the original registration rather than losing or closing that client.

Each Redis request runs on its own worker thread. Its callback is delivered on the game thread; setting `Options.Blocking` to `true` makes the game thread wait for that same request, but does not remove the callback requirement. Avoid remote high-latency endpoints, unbounded `keys` scans, large aggregate replies and long retry behavior in gameplay callbacks.

Unloading a context discards its pending callbacks; it does not cancel work already running on request threads. Runtime shutdown joins those workers and drops pending callbacks before disposing the V8 isolate. Keep remote timeouts bounded, including during shutdown; a worker per request does not remove Redis server latency or connection-pool limits.

The example Promise adapter does not keep a plugin context alive. If that context unloads before callback delivery, the pending Promise need not settle and its JavaScript `finally` block is not guaranteed to run. Native owner cleanup is separate from that example control flow; do not rely on awaiting a request across plugin unload or shutdown.

## Related Modules

- [External libraries](../external-libraries.md) documents the mandatory redis++ build contract.
- [`plugins/bus`](plugins-bus.md) provides serialized communication inside one SourceJS process.
- [`filesystem`](filesystem.md) can persist non-secret local connection configuration.
