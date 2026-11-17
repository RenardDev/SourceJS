# `require("cpr")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

`cpr` provides asynchronous HTTP and HTTPS requests through the mandatory native CPR library. It supports text and binary request bodies, raw response bytes, redirects, cookies, query parameters, authentication, and request diagnostics.

Module guide: [external-libraries.md](../external-libraries.md)

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Request Options](#request-options)
- [Response](#response)
- [Examples](#examples)
- [Binary Request Bodies](#binary-request-bodies)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

[`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs `cpr` as a native module, validates JavaScript request values, runs each CPR request on its own thread, and converts each response into a stable JavaScript record on the game thread.

Use this module when a plugin must make an HTTP or HTTPS request without blocking the Source server thread. Each accepted request gets a separate worker thread, so unrelated requests can progress concurrently. Its completion callback runs on the Source server thread.

## Import

```js
const { Request, Get, Post } = require("cpr");
```

Each request uses its own worker thread. Asynchronous callbacks are delivered by the game-frame pump on the Source server thread; keep them short. Argument validation is synchronous, and asynchronous queue admission happens before return, so invalid arguments or a full queue throw immediately. With `Blocking: true`, the call waits for its worker and invokes the callback on the calling server thread before returning.

If argument or option getters remove the calling JavaScript context, request admission throws synchronously before starting a worker or retaining the callback for delivery. This applies to asynchronous and blocking requests.

Each game-frame pump delivers at most the number of completions ready when it begins. Requests queued by callbacks are delivered by a later pump. This bounds queue draining, not the duration of an individual callback or a blocking request.

## Exports

| Export | Signature | HTTP method |
| --- | --- | --- |
| [`Request`](#requestoptions-callback) | `Request(Options, Callback)` | Method from `Options.Method`; defaults to `GET`. |
| [`Get`](#getoptions-callback) | `Get(Options, Callback)` | `GET` |
| [`Post`](#postoptions-callback) | `Post(Options, Callback)` | `POST` |
| [`Put`](#putoptions-callback) | `Put(Options, Callback)` | `PUT` |
| [`Patch`](#patchoptions-callback) | `Patch(Options, Callback)` | `PATCH` |
| [`Delete`](#deleteoptions-callback) | `Delete(Options, Callback)` | `DELETE` |
| [`Head`](#headoptions-callback) | `Head(Options, Callback)` | `HEAD` |
| [`Options`](#optionsoptions-callback) | `Options(Options, Callback)` | `OPTIONS` |

Every function requires exactly two arguments: an `Options` object and a `Callback` function. It normally returns `undefined`, never a response record or request handle, including in blocking mode. `Options.URL` must be a non-empty string. `Callback` receives `(ErrorValue, Response)`: `ErrorValue` is `null` when CPR produces a response record; HTTP status and CPR transport diagnostics are reported on `Response`, not in `ErrorValue`. After a request is accepted, a worker-operation exception or response-record conversion failure produces an `Error` in `ErrorValue` and `undefined` in `Response`; argument validation, request-admission, and worker-start failures throw synchronously. Omit `Options.Blocking` for asynchronous execution; it defaults to `false`. Setting it to `true` waits for completion on the game thread, but still requires and invokes `Callback` before the method returns. Only `Request(Options, Callback)` accepts a non-null `Options.Method` field. Named-method functions reject it even when it matches their fixed method; `null` or `undefined` is treated as absent.

## Request Options

| Option | Type | Meaning |
| --- | --- | --- |
| `Method` | `string` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, or `OPTIONS`; case-insensitive. Only valid with `Request`. |
| `URL` | `string` | Required non-empty request URL. |
| `Body` | `string \| ArrayBuffer \| ArrayBufferView` | Optional text or binary request body. |
| `UserAgent` | `string` | Optional request user agent. |
| `BearerToken` | `string` | Optional non-empty bearer token; requires libcurl 7.61.0 or newer. |
| `Timeout` | `number` | Integer from `0` to `2147483647`, in milliseconds; defaults to `0` (CPR's unlimited total timeout). |
| `ConnectionTimeout` | `number` | Integer from `0` to `2147483647`, in milliseconds; defaults to `0`, which leaves CPR's connection timeout unset. |
| `MaximumRedirects` | `number` | Integer from `-1` to `2147483647`; defaults to `50`, and `-1` removes the redirect limit. |
| `VerifySSL` | `boolean` | Verify the server TLS certificate; defaults to `true`. |
| `FollowRedirects` | `boolean` | Follow redirects; defaults to `true`. |
| `Blocking` | `boolean` | Missing, `null`, or `undefined` means `false`. When `true`, still runs the request on its own worker thread and blocks the calling thread while waiting; the required callback receives the response before the method returns. Use for controlled pre-server/bootstrap work; calling it during a live server frame blocks that frame. Bounded timeouts are strongly recommended. |
| `Headers` | `object` | String header names mapped to string values. |
| `Parameters` | `object` | String query parameter names mapped to string values. |
| `Cookies` | `object` | String cookie names mapped to string values. |
| `Auth` | `object` | Optional `{ Username, Password, Mode? }`; `Username` and `Password` are required strings and may be empty, while `Mode` is an optional non-empty string. |

Authentication modes are `basic`, `digest`, `ntlm`, `negotiate`, `any`, and `anysafe` (case-insensitive); the default is `basic`. `Auth` and `BearerToken` are mutually exclusive when both are supplied with non-null values.

Public option names use the exact PascalCase spellings above, including the `SSL` acronym in `VerifySSL`.

Optional string, boolean and integer properties retain their initialized defaults when missing, `null` or `undefined`. Supplied booleans must be actual booleans; integer options must be finite integral numbers in the stated ranges, without string coercion or truncation. Their native parsers preserve getter exceptions and commit an individual parsed output only after successful conversion. This does not roll back getter side effects or make a whole request transactional.

The native `Body`, `Auth` and string-map property readers stop after a failed read or conversion, preserve caught V8 exceptions and execution termination, and contain C++ exceptions. Body bytes and authentication fields are committed only after their validation completes; getter side effects are not rolled back.

## Response

When CPR produces a response record, `Response` has these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `StatusCode` | `number` | HTTP status code. |
| `Text` | `string` | Response body decoded as a JavaScript string. |
| `Bytes` | `Uint8Array` | Exact raw response bytes. |
| `URL` | `string` | Final response URL. |
| `Error` | `string` | CPR transport error text, or an empty string. |
| `ErrorCode` | `number` | CPR transport error code. |
| `Elapsed` | `number` | Elapsed request time in seconds. |
| `ElapsedMilliseconds` | `number` | Elapsed request time in milliseconds. |
| `RawHeader` | `string` | Raw response header block. |
| `StatusLine` | `string` | HTTP status line. |
| `Reason` | `string` | HTTP reason phrase. |
| `UploadedBytes` | `bigint` | Number of uploaded bytes. |
| `DownloadedBytes` | `bigint` | Number of downloaded bytes. |
| `RedirectCount` | `bigint` | Exact number of followed redirects on every supported platform. |
| `PrimaryIP` | `string` | Connected server IP address. |
| `PrimaryPort` | `number` | Connected server port. |
| `OK` | `boolean` | `true` only for a 2xx response with no CPR transport error. |
| `Headers` | `object` | Null-prototype response-header map. |
| `Cookies` | `object` | Null-prototype response-cookie map; duplicate names keep the last encountered value. |

String fields and header/cookie names and values are decoded as UTF-8 using their full byte length; embedded NUL bytes are not terminators. Use `Bytes` for arbitrary binary bodies. Header and cookie names retain CPR's external spellings, not SourceJS PascalCase names; this does not relax HTTP or cookie syntax requirements.

An HTTP error response such as `404` is still delivered normally with `OK === false`. Invalid arguments, queue-admission failures, and worker-start failures throw synchronously. After a request is accepted, worker-operation exceptions and response-record conversion failures are delivered through `Callback` as an `Error`, with `Response` set to `undefined`.

## Examples

### Pre-start blocking fetch

Use `Blocking: true` only when startup must wait for remote data before proceeding. The HTTP request still runs on its own worker thread; the calling thread waits, and the required callback receives the response before `Get()` returns. Validate the response before continuing with package preparation and server-startup logic. Set finite timeouts so startup cannot wait indefinitely:

```js
const { Get } = require("cpr");

let g_Response = null;
let g_RequestError = null;

Get({
	URL: "https://updates.example.net/package-manifest.json",
	Blocking: true,
	Timeout: 5000,
	ConnectionTimeout: 2000,
}, (ErrorValue, ResponseValue) => {
	g_RequestError = ErrorValue;
	g_Response = ResponseValue;
});

if (g_RequestError) {
	throw g_RequestError;
}

if (!g_Response.OK) {
	throw new Error(`Package manifest request failed: HTTP ${g_Response.StatusCode}; ${g_Response.Error}`);
}

const g_PackageManifest = JSON.parse(g_Response.Text);
```

### `Request(Options, Callback)`

Use `Request` when the method is selected dynamically. This example updates a remote moderation record and preserves the HTTP diagnostics when it fails. The `muted` and `reason` body keys belong to the illustrative remote JSON schema, not SourceJS:

```js
const { Request } = require("cpr");

Request({
	Method: "PATCH",
	URL: "https://admin.example.net/api/players/STEAM_1:0:12345",
	Body: JSON.stringify({ muted: true, reason: "voice abuse" }),
	Timeout: 5000,
	ConnectionTimeout: 1500,
	VerifySSL: true,
	Headers: {
		accept: "application/json",
		"content-type": "application/json",
	},
}, (RequestError, Response) => {
	if (RequestError) {
		throw RequestError;
	}

	if (!Response.OK) {
		throw new Error(`Moderation API failed: Status=${Response.StatusCode}; Reason=${Response.Reason}; Error=${Response.Error}`);
	}
});
```

### `Get(Options, Callback)`

Download a binary file and write the raw bytes through the Source filesystem API. Enforce an application-specific response-size limit before opening the destination. Its directory must already exist and be writable. Opening with `wb` truncates an existing file: this example is not an atomic replacement, and a failed write can leave a partial file. A close exception can mask an earlier write error; successful close does not prove durable storage.

```js
const { Get } = require("cpr");
const { OpenSourceFile, CloseSourceFile, WriteSourceFile } = require("filesystem");

Get({
	URL: "https://cdn.example.net/sourcejs/rotation.dat",
	UserAgent: "SourceJS/rotation-sync",
	Timeout: 10000,
	ConnectionTimeout: 2000,
	VerifySSL: true,
}, (RequestError, Response) => {
	if (RequestError) {
		throw RequestError;
	}

	if (!Response.OK) {
		throw new Error(`Rotation download failed: HTTP ${Response.StatusCode}, ${Response.Error}`);
	}

	const unMaximumRotationFileByteCount = 16 * 1024 * 1024;
	if (Response.Bytes.byteLength > unMaximumRotationFileByteCount) {
		throw new Error(`Rotation download exceeds ${unMaximumRotationFileByteCount} bytes.`);
	}

	const OutputFile = OpenSourceFile("addons/sourcejs/data/sourcejs/rotation.dat", "wb");

	try {
		const unWrittenBytes = WriteSourceFile(OutputFile.Handle, Response.Bytes);
		if (unWrittenBytes !== Response.Bytes.byteLength) {
			throw new Error(`Only ${unWrittenBytes} of ${Response.Bytes.byteLength} bytes were written.`);
		}
	} finally {
		if (!CloseSourceFile(OutputFile.Handle)) {
			throw new Error("Unable to close the downloaded rotation file.");
		}
	}
});
```

`Bytes` is the raw body. It does not pass through UTF-8 conversion.

### `Post(Options, Callback)`

Create a remote match record and parse its JSON response. Replace the illustrative token with a securely loaded configuration value; never commit or log a real token. The `map`, `players`, and `id` keys belong to the illustrative remote JSON schema. This example expects a non-empty string or a non-negative safe-integer `id`. Malformed JSON or an unexpected response shape throws:

```js
const { Post } = require("cpr");

Post({
	URL: "https://stats.example.net/api/matches",
	Body: JSON.stringify({ map: "c1m1_hotel", players: 8 }),
	BearerToken: "replace-with-plugin-configuration-token",
	Timeout: 4000,
	Headers: { "content-type": "application/json" },
}, (RequestError, Response) => {
	if (RequestError) {
		throw RequestError;
	}

	if (!Response.OK) {
		throw new Error(`Match creation failed: HTTP ${Response.StatusCode}.`);
	}

	const Match = JSON.parse(Response.Text);
	if ((Match === null) || (typeof Match !== "object") || Array.isArray(Match)) {
		throw new Error("Match response must be an object.");
	}

	const bValidMatchID = ((typeof Match.id === "string") && (Match.id.length > 0)) || (Number.isSafeInteger(Match.id) && (Match.id >= 0));
	if (!bValidMatchID) {
		throw new Error("Match response has an invalid id.");
	}

	console.log(`Created match ${Match.id}.`);
});
```

### `Put(Options, Callback)`

Replace a complete remote map-rotation resource:

`maps` and `revision` are illustrative external JSON keys, not SourceJS properties; use the remote service's exact schema.

```js
const { Put } = require("cpr");

const g_Rotation = {
	maps: ["c1m1_hotel", "c2m1_highway", "c5m1_waterfront"],
	revision: 12,
};
Put({
	URL: "https://admin.example.net/api/servers/eu-1/rotation",
	Body: JSON.stringify(g_Rotation),
	Timeout: 5000,
	Headers: { "content-type": "application/json" },
}, (RequestError, Response) => {
	if (RequestError) {
		throw RequestError;
	}

	if (!Response.OK) {
		throw new Error(`Rotation update failed: HTTP ${Response.StatusCode}`);
	}
});
```

### `Patch(Options, Callback)`

Send a partial status update. The `map` and `players` body keys belong to the remote JSON schema, not the SourceJS property-naming convention; preserve the exact keys required by that service. The `content-type` name is an HTTP header and is case-insensitive.

```js
const { Patch } = require("cpr");

Patch({
	URL: "https://status.example.net/api/servers/eu-1",
	Body: JSON.stringify({ map: "c1m2_streets", players: 6 }),
	Timeout: 3000,
	Headers: { "content-type": "application/json" },
}, (RequestError, Response) => {
	if (RequestError) {
		throw RequestError;
	}

	if (!Response.OK) {
		throw new Error(`Status update failed: HTTP ${Response.StatusCode}; StatusLine=${Response.StatusLine}; Error=${Response.Error}`);
	}
});
```

### `Delete(Options, Callback)`

Delete a remote temporary ban by its stable identifier. Replace the illustrative token with a securely loaded configuration value; never commit or log a real token:

```js
const { Delete } = require("cpr");

const g_strBanID = "ban-7f42";
Delete({
	URL: `https://admin.example.net/api/bans/${encodeURIComponent(g_strBanID)}`,
	BearerToken: "replace-with-plugin-configuration-token",
	Timeout: 3000,
}, (RequestError, Response) => {
	if (RequestError) {
		throw RequestError;
	}

	if ((Response.ErrorCode !== 0) || (!Response.OK && (Response.StatusCode !== 404))) {
		throw new Error(`Could not delete ${g_strBanID}: HTTP ${Response.StatusCode}; Error=${Response.ErrorCode}`);
	}
});
```

This example accepts a transport-error-free `404` as an already-absent resource. Use that policy only when the remote API guarantees this meaning; it does not prove that the server's deletion behavior is idempotent. A transport error still fails, even if its response contains status `404`.

### `Head(Options, Callback)`

Inspect an artifact's advertised size before downloading it. `Content-Length` may be absent; this example prints the header text without validating it as a numeric size. A successful HEAD response does not guarantee that a later download succeeds or returns unchanged content:

```js
const { Head } = require("cpr");

Head({ URL: "https://cdn.example.net/sourcejs/rotation.dat", Timeout: 3000, FollowRedirects: true }, (RequestError, Response) => {
	if (RequestError) {
		throw RequestError;
	}

	if (!Response.OK) {
		throw new Error(`Artifact check failed: HTTP ${Response.StatusCode}`);
	}

	const vecContentLengthEntry = Object.entries(Response.Headers).find(function IsContentLengthHeader([strHeaderName]) {
		return strHeaderName.toLowerCase() === "content-length";
	});
	const strContentLength = vecContentLengthEntry ? vecContentLengthEntry[1] : null;
	console.log(`Remote artifact size: ${strContentLength || "unknown"} bytes.`);
});
```

### `Options(Options, Callback)`

Inspect the methods advertised by an administrative endpoint before enabling a remote feature. A missing `Allow` header fails this example's check, but does not prove that the method is unsupported. An advertised method does not grant authorization or guarantee that a later request succeeds:

```js
const { Options } = require("cpr");

Options({ URL: "https://admin.example.net/api/bans", Timeout: 3000 }, (RequestError, Response) => {
	if (RequestError) {
		throw RequestError;
	}

	if (!Response.OK) {
		throw new Error(`Capability request failed: HTTP ${Response.StatusCode}`);
	}

	const vecAllowHeaderEntry = Object.entries(Response.Headers).find(function IsAllowHeader([strHeaderName]) {
		return strHeaderName.toLowerCase() === "allow";
	});
	const strAllowedMethods = vecAllowHeaderEntry ? vecAllowHeaderEntry[1] : "";
	const vecAllowedMethods = strAllowedMethods
		.split(",")
		.map(function NormalizeHTTPMethod(strHTTPMethod) {
			return strHTTPMethod.trim().toUpperCase();
		})
		.filter(function IsHTTPMethodPresent(strHTTPMethod) {
			return Boolean(strHTTPMethod);
		});

	if (!vecAllowedMethods.includes("DELETE")) {
		throw new Error("The remote ban API does not advertise DELETE support.");
	}
});
```

## Binary Request Bodies

Pass a typed array directly when an endpoint expects raw bytes; `Body` sends these bytes unchanged. A view's bytes are copied during synchronous option parsing, using that view's byte offset and length, before the worker starts. Later changes to the original buffer do not change the accepted request's native body. The `content-type` name is an external, case-insensitive HTTP header, not a SourceJS property:

```js
const { Post } = require("cpr");

const g_arrSnapshotPayload = new Uint8Array([0x53, 0x4A, 0x53, 0x01]);
Post({
	URL: "https://collector.example.net/api/snapshots",
	Body: g_arrSnapshotPayload,
	Timeout: 5000,
	Headers: { "content-type": "application/octet-stream" },
}, (RequestError, Response) => {
	if (RequestError) {
		throw RequestError;
	}

	if (!Response.OK) {
		throw new Error(`Binary upload failed after ${Response.ElapsedMilliseconds} ms.`);
	}
});
```

## Safe use

- Every request runs on its own worker thread. The shared runtime queue admits at most 128 outstanding nonblocking requests, not 128 per CPR method. Validation, queue-admission, and worker-start failures throw synchronously; after acceptance, ordinary worker-operation and response-conversion failures are delivered through `Callback` as `ErrorValue`.
- Option parsing stops at the first failed getter or conversion, preserves the original JavaScript exception, and commits the parsed request only after all options pass validation. Native allocation or standard-library exceptions are translated at the parsing boundary.
- Request dispatch validates the required options and callback before starting a worker; the worker captures only native request data, not V8 handles. Dispatch and result conversion preserve pending JavaScript exceptions and execution termination instead of replacing them with a generic CPR error, and contain C++ exceptions at their boundaries.
- Both `Options` and `Callback` are mandatory in every mode. Nonblocking callbacks run on the Source server thread, but are discarded if their V8 context is removed before completion; removing the context does not cancel the native HTTP operation. `Blocking: true` waits for that request's worker and invokes the same callback on the calling server thread before the request method returns, including before the game-frame loop starts.
- Callback exceptions are caught and logged by the runtime, including in blocking mode; they do not propagate as synchronous exceptions from the request method. Runtime termination or failure to construct an error value can prevent callback delivery. Inspect server logs and use explicit callback state, as in the pre-start example, when later work depends on the result.
- Use bounded `Timeout` and `ConnectionTimeout` values for production calls; `0` leaves the corresponding CPR timeout unlimited or unset. Runtime shutdown waits for active request threads to finish.
- Preserve the public function, option, and response-key spellings exactly as documented in PascalCase. Local bindings still use the applicable Systems Hungarian categories.
- HTTP failures still deliver a response record with `OK === false`, so check `OK` and the diagnostic fields appropriate to the operation.
- Keep `VerifySSL` enabled unless a controlled environment explicitly requires otherwise. Non-null `Auth` and `BearerToken` cannot be supplied together, and secrets should come from protected configuration rather than source literals.
- Use `Bytes` for binary payloads. `Text` is the same response body exposed as a JavaScript string and may not be suitable for arbitrary binary data.
- `Headers` and `Cookies` have null prototypes. Use `Object.entries()`, `Object.keys()`, or an explicit own-property check instead of assuming inherited object methods exist.
- Response fields, headers, and cookies are created as own data properties without invoking inherited setters. Conversion stops on a failed property creation, pending exception, or execution termination; no partially constructed response is returned. Native allocation or standard-library exceptions are translated at the response boundary.
- `UploadedBytes`, `DownloadedBytes`, and `RedirectCount` are always `bigint`; use BigInt-safe arithmetic and handle them explicitly before JSON serialization.

## Related files

- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) — request validation, CPR session configuration, per-request worker dispatch, stable exports, and game-thread response conversion.
- [`external-libraries.md`](../external-libraries.md) — mandatory CPR dependency and build integration.
- [`core-update.md`](core-update.md) — release lookup using the CPR API.
- [`filesystem.md`](filesystem.md) — Source filesystem APIs used by the binary-download example.
