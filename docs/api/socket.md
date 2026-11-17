# `socket`

`require("socket")` provides TCP client connections through the native socket APIs. DNS lookup, connect, send, receive, and close work on a dedicated thread for each request. JavaScript callbacks are delivered on the game thread.

Every method requires an `Options` object followed by a `Callback`, including when no option is set:

```js
const {
	Close,
	Connect,
	Send,
} = require("socket");

function AwaitSocketRequest(Options, StartRequest) {
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

async function SendSocketBytes(strHost, nPort, vecBytes) {
	const nSocketConnectionHandle = await AwaitSocketRequest({}, (Options, Callback) => Connect(strHost, nPort, Options, Callback));
	let unSentByteCount = 0;
	let OperationError = null;
	let bOperationFailed = false;

	try {
		while (unSentByteCount < vecBytes.length) {
			const unWrittenByteCount = await AwaitSocketRequest({}, (Options, Callback) => Send(nSocketConnectionHandle, vecBytes.slice(unSentByteCount), Options, Callback));
			if (!Number.isInteger(unWrittenByteCount) || (unWrittenByteCount <= 0) || (unWrittenByteCount > (vecBytes.length - unSentByteCount))) {
				throw new Error("Socket send returned an invalid progress count.");
			}

			unSentByteCount += unWrittenByteCount;
		}
	} catch (RequestError) {
		OperationError = RequestError;
		bOperationFailed = true;
	}

	try {
		const bClosed = await AwaitSocketRequest({}, (Options, Callback) => Close(nSocketConnectionHandle, Options, Callback));
		if (bClosed !== true) {
			throw new Error("Close did not confirm release of the socket connection.");
		}
	} catch (CloseError) {
		const vecErrors = bOperationFailed ? [OperationError, CloseError] : [CloseError];
		const CompletionError = new AggregateError(vecErrors, "Socket byte workflow could not confirm connection cleanup.", { cause: bOperationFailed ? OperationError : CloseError });
		CompletionError.ConnectionHandle = nSocketConnectionHandle;
		throw CompletionError;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	console.log(`Sent ${unSentByteCount} bytes.`);
}

module.exports = { SendSocketBytes };
```

The helper attempts `Close()` once after a successful connection and reports success only after confirmed cleanup.
Confirmed cleanup preserves an original send or byte-access failure unchanged. Unconfirmed cleanup throws an
`AggregateError` containing every failure and `ConnectionHandle` for owner recovery; it does not guarantee that
the connection is still open. Already sent bytes cannot be rolled back: do not resend them merely to retry cleanup.

## Methods

| Method | Signature | Result |
| --- | --- | --- |
| `Connect` | `Connect(strHost, nPort, Options, Callback)` | Callback receives the numeric `nSocketConnectionHandle`, not a native socket handle or memory address. |
| `Close` | `Close(ConnectionReference, Options, Callback)` | Callback receives `true` when this call closes the connection, or `false` if another close had already begun. |
| `Send` | `Send(ConnectionReference, ByteSource, Options, Callback)` | Callback receives the number of bytes written by one native send operation; a short write is possible. An empty input validates the connection and returns `0` through the callback. |
| `Receive` | `Receive(ConnectionReference, nMaximumByteCount, Options, Callback)` | Callback receives a `Uint8Array` containing up to the requested bytes. |
| `CancelRequest` | `CancelRequest(nRequestHandle)` | Requests cancellation of a pending request owned by the calling plugin. Returns `false` if the handle is unknown, foreign, already cancelled, or no longer pending. |

`ConnectionReference` is the numeric handle returned by `Connect`, or an object whose `Handle` property contains that same handle. Both forms refer to the same plugin-owned registry entry; neither is a native address or an owning wrapper.

## Request Admission and Completion

Each `Callback` has the form `Callback(RequestError, Result)`. `RequestError` is `null` on success; on an operating-system or request failure it is an `Error` and `Result` is `undefined`. Invalid arguments and requests rejected by the queue throw synchronously. Each runtime accepts at most 128 outstanding asynchronous requests. Each accepted request invokes its required callback once while its creating runtime context remains alive.

Each nonblocking operation returns a positive request handle distinct from the connection handle delivered by `Connect`'s callback. `CancelRequest` accepts only the request handle. A blocking operation returns `undefined` after invoking its callback, and has no handle to cancel from JavaScript.

If argument or option getters remove the calling JavaScript context, request admission throws synchronously before starting a worker or retaining the callback for delivery. This applies to asynchronous and blocking requests.

Each game-frame pump uses the number of completions ready at entry as its ordinary drain-loop budget. This does not bound reentrant completion delivery, individual callback duration or blocking waits, and does not guarantee that every request queued by a callback waits for the next frame.

## Input Validation

`strHost` must be a non-empty string without null bytes. `nPort` must be an integer from 1 through 65535. Invalid hosts and ports are rejected before queuing the request; DNS and connection failures are reported through the callback.

`ByteSource` must be an array of integer byte values from 0 through 255, an `ArrayBuffer`, or an `ArrayBufferView`, no larger than 16 MiB. Text strings are not accepted; encode text to bytes explicitly before sending. `Send` copies the bytes before queuing, so later changes to the original input do not affect the request. Exceptions thrown by byte or `Handle` getters propagate unchanged, before request admission.

`nMaximumByteCount` must be an integer from 1 through 16 MiB. `Receive` waits for data on its request thread; it returns as soon as at least one byte is available, up to the maximum. A zero-length result means the stream has shut down. Local `Close()` or plugin cleanup interrupts pending transfers; depending on the platform and completion timing, a pending receive can return empty bytes or report a native cancellation error through its callback.

## Blocking Option

`Options` must be a non-array object. `Options.Blocking` is optional and defaults to `false`; `null` and `undefined` also select that default. Other supplied values must be booleans:

- With the default, the method returns after the request is queued; the required callback runs later on the game thread.
- With `{ Blocking: true }`, the game thread waits for that request's dedicated worker, then the same required callback runs on the game thread before the method returns.

The callback is not replaced by a direct return value in blocking mode. Blocking calls can stall the game thread until the native operation completes; in particular, `Receive` can wait until data arrives or the connection is closed.

## Timeout and Cancellation

`Options.Timeout` is a whole number of milliseconds from `0` through `2147483647`. Omitted, `null`, `undefined`, and `0` mean no deadline. The monotonic deadline starts at admission and covers time waiting for another operation in the same direction. The setting is available in both execution modes.

```js
const { CancelRequest, Receive } = require("socket");

function StartRead(nConnectionHandle, Callback) {
	const nRequestHandle = Receive(nConnectionHandle, 4096, { Timeout: 2000 }, Callback);
	return () => CancelRequest(nRequestHandle);
}

module.exports = { StartRead };
```

A timeout or observed cancellation calls `Callback` with an `Error` and `undefined`, not empty bytes. A completed transfer can win a cancellation race and still return its bytes or count; bytes already transmitted or consumed cannot be rolled back. Cancelling a pending `Send` or `Receive` does not close the connection or cancel other requests on it. `Close` cannot be cancelled once teardown starts. `Connect` counts time in the system resolver toward its deadline, but cannot interrupt `getaddrinfo` on either platform: it checks for expiry or cancellation when resolution returns, before attempting TCP. Use numeric addresses if DNS latency must not delay completion.

## Ownership and Concurrency

Connections are owned by the creating plugin. Unknown, removed, and foreign-plugin handles throw synchronously. A connection that is closing but still registered is checked on the request worker; transfers can fail through their callback instead. The handle is removed when a `Close` result is processed on the game thread.

Connection lookup checks the calling context and handle conversion before accessing the game-thread registry. It contains C++ lookup failures and preserves existing V8 errors, including exceptions from a `Handle` getter. Lookup does not acquire the socket mutex or wait for native IO; workers retain shared ownership and check the native handle under that mutex before transferring bytes.

All four native callbacks contain C++ exceptions and preserve existing V8 failures while parsing arguments and dispatching requests. `Send` validates each byte read and buffer snapshot before admission; a failed read cannot queue a partially copied request. This does not roll back getter side effects.

`Connect` validates its JavaScript handle before inserting a non-replacing registry entry. `Close` validates its JavaScript boolean result before removing only the matching connection entry. These checks stage registry updates, not a rollback of completed native IO or callback effects.

Send requests serialize with other sends on the same connection, and receive requests serialize with other receives; sending and receiving use independent locks. Dedicated threads do not guarantee submission order. `Close` marks the connection as closing, calls native shutdown, and waits for active transfers before releasing its socket.

Windows transfers use overlapped IO with per-operation completion events; close cancels outstanding IO, and each worker waits for completion before releasing its event and byte storage. New submissions and closing use the same state mutex, preventing submissions after cancellation has begun. Native IO completion waits occur outside that mutex.

Plugin cleanup requests cancellation of pending operations and closes registered connections. No callback runs after its context is removed. Shutdown can still wait for native teardown and an already-running system DNS lookup.

This module provides TCP only; it does not add TLS, framing, or automatic full-write/retry behavior. `SendSocketBytes` above expects a byte array and handles short writes explicitly; the native `Send` method does not retry automatically.

Implementation: [native module bindings](../../src/sourcejs/modules/ModuleBindings.cpp). [Socket smoke checks](../../tools/smoke_socket.js) exercise the copyable examples with controlled Node doubles and inspect native source contracts. The [native loopback test](../../tools/smoke_socket_native.js) compiles the socket implementation and verifies timeout, cancellation, and reuse on a real local TCP connection without V8. The [live V8 probe](../../tools/fixtures/SocketRequestV8Probe.js) requires a loopback byte-echo server on port `27391` and a server that is pumping game frames; it is not part of the installed plugins.
