# External Libraries

> Warning: This file describes the mandatory native dependency contract. Use
> the linked API pages for runtime methods and executable examples.

## Table of Contents

- [Build Contract](#build-contract)
- [Runtime API](#runtime-api)
- [Request Scheduling And Ownership](#request-scheduling-and-ownership)

SourceJS requires SOCI, redis++ and cpr at build time. They are not optional
features and there are no JS fallbacks for them.

## Build Contract

CMake must find all three packages before `sourcejs` can be configured:

```cmake
find_package(SOCI CONFIG REQUIRED)
find_package(redis++ CONFIG REQUIRED)
find_package(cpr CONFIG REQUIRED)
```

GitHub Actions installs them with vcpkg for the manually selected SDK,
platform and architecture before configuring SourceJS.

SOCI must export both SQLite3 and MySQL backend targets. Package layouts such as
`SOCI::SQLite3`, `SOCI::soci_sqlite3_static`, `SOCI::MySQL` and
`SOCI::soci_mysql_static` are accepted; configuration fails if either backend
is absent. SourceJS calls `register_factory_sqlite3()` and
`register_factory_mysql()` before the first session opens. CMake links both
targets with `WHOLE_ARCHIVE` to retain their static implementations and factory
registrations in the VSP binary. The repository's SOCI
vcpkg overlay disables SOCI's GCC LTO so Linux x64 can link it with the
LLVM-bitcode V8 archive through `lld`. CI installs `soci[mysql,sqlite3]` for
every job.

Every Linux SDK workflow inspects the final symbol table after linking. The job
rejects undefined symbols matching `cpr::`, `soci::`, `sw::redis::`,
`register_factory_sqlite3` or `register_factory_mysql`, and requires a defined
symbol matching each of those five patterns in `sourcejs.so`. This is a linkage
check, not an exercise of HTTP, Redis or database operations on a running server.

On Windows with vcpkg, SourceJS normalizes the existing `SQLite3::SQLite3`
imported target for Debug, Release, MinSizeRel and RelWithDebInfo. Both debug and
release `sqlite3.lib` files must exist in the selected triplet. Release-family
configurations use the release library instead of inheriting the single debug
path selected by CMake's `FindSQLite3` module during a multi-configuration
configure; Debug uses the debug library.

## Runtime API

The `soci`, `redis` and `cpr` modules use these mandatory native libraries with
strict argument validation and no JavaScript fallback. Their complete runtime
contracts and practical examples are documented separately:

- [SOCI API](api/soci.md), including SQLite, MySQL and MariaDB sessions;
- [Redis API](api/redis.md), including string command parts and structured
  replies;
- [CPR API](api/cpr.md), including raw response bytes, generic requests and the
  supported `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` and `OPTIONS`
  methods.

The [Socket API](api/socket.md) uses the operating system's native TCP socket
facilities, not another optional vcpkg library. Its methods use PascalCase,
including `Connect`, `Send`, `Receive`, `Close` and `CancelRequest`; Redis alone retains lowercase
method names such as `connect`, `get`, `set` and `close`. Socket sends accept bytes,
not text strings, and receives return `Uint8Array`; handle short writes and
encode or decode text explicitly.

The runnable integration example lives in
[`examples/plugins/disabled/api-external-libraries`](../examples/plugins/disabled/api-external-libraries).

## Request Scheduling And Ownership

Every request in `soci`, `redis`, `cpr` and `socket` requires a trailing `Options`
object and `Callback`, even when no option is set. CPR also puts its HTTP request
settings in that same `Options` object. Every accepted request runs its native
operation on a separate worker thread; results are converted and callbacks run
on the game thread, never on the worker. Normal asynchronous completion is
delivered by the game-frame pump.

`Options.Blocking` defaults to `false`, including when missing, `null` or
`undefined`. With `{ Blocking: true }`, the game thread waits for that request's
worker and invokes the same required callback before the call returns. Blocking
does not turn the return value into a result or remove the callback requirement.
Use it deliberately for bootstrap work; live-frame calls and long callbacks can
stall the server. Socket `Receive`, for example, may wait for incoming data or a
closed connection. Consult each API for timeout and failure semantics; an HTTP
status or CPR transport diagnostic belongs to the response record, not
necessarily the callback's error argument.

Invalid arguments, rejected admission and worker-start failures throw
synchronously. The runtime shares a limit of 128 outstanding asynchronous
requests across these APIs and cleanup tasks. Independent worker threads are
not a transaction or completion-order guarantee: sequence dependent operations
through callbacks and respect each connection's concurrency rules.

SOCI sessions, Redis clients and socket connection handles belong to their
creating runtime owner; CPR returns a response through its callback, not a
connection handle. Close owned connections explicitly when finished, using the
required `Options` and `Callback`. Plugin unload and runtime shutdown release
owned resources and suppress callback delivery to removed contexts; they do not
make retained numeric handles transferable to another plugin. See the API pages
and [runtime architecture](architecture.md) for cleanup and lifetime limits.
