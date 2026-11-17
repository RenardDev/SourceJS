# `require("auth/index")`

`Backend` is the base class for SourceJS authorization backends. The public
lifecycle and callback names are the names implemented by the package; no
`*Backend` compatibility aliases are installed.

> AI-agent navigation: start with the member contract and safe-use notes below.
> Verify lifecycle changes against the base class and manager linked in Related
> files; examples preserve the package's public names.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Export](#export)
- [Backend](#backend)
- [Example](#example)
  - [Change notifications](#change-notifications)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

## Location and purpose

The class is defined in [`packages/sourcejs/auth/index.js`](../../packages/sourcejs/auth/index.js)
and coordinated by [`packages/sourcejs/auth/manager.js`](../../packages/sourcejs/auth/manager.js).
Extend it when an authorization backend must load, synchronize, and observe
permission or parent changes through the same lifecycle as the bundled backends.
The shared base contract lets the manager switch implementations without
changing the authorization API or notification flow.

## Import

```js
const { Backend } = require("auth/index");
```

## Export

| Export | Kind | Signature |
| --- | --- | --- |
| [`Backend`](#backend) | Class | `new Backend(Options = {})`; rejects `null`, arrays and non-object options. |

## `Backend`

| Member | Signature |
| --- | --- |
| `BackendName` | Static string. |
| `Options` | Static default-options object; instance getter returns the mutable shallow merge of the defaults and constructor options. |
| `Name` | Read-only getter returning the lowercase `BackendName`; throws unless `BackendName` is a nonempty string. |
| `Loaded` | Read-only getter returning the current load state; subclass lifecycle overrides must keep its backing state accurate. |
| `Load` | `Load(Options, Callback)`; sets `Loaded` to `true` and calls the required error-first callback with `(null, BackendInstance)`. |
| `Unload` | `Unload(Options, Callback)`; sets `Loaded` to `false` and calls the required error-first callback with `(null, BackendInstance)`. |
| `Synchronize` | `Synchronize(Options, Callback)`; the base implementation throws; overrides report errors or state through the error-first callback. |
| `PermissionAdded` | `PermissionAdded(Node, strPermission, nServerID, Options, Callback)`; the base implementation calls `Callback(null)`. |
| `PermissionRemoved` | `PermissionRemoved(Node, strPermission, nServerID, Options, Callback)`; the base implementation calls `Callback(null)`. |
| `ParentAdded` | `ParentAdded(Node, strParentName, Options, Callback)`; the base implementation calls `Callback(null)`. |
| `ParentRemoved` | `ParentRemoved(Node, strParentName, Options, Callback)`; the base implementation calls `Callback(null)`. |

## Example

```js
const { Backend } = require("auth/index");

function RequireBackendOperationArguments(Options, Callback) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Backend operation expects an options object.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Backend operation expects a callback function.");
	}
}

class MemoryBackend extends Backend {
	Synchronize(Options, Callback) {
		RequireBackendOperationArguments(Options, Callback);
		Callback(null, { Parents: {}, Players: {} });
	}
}

MemoryBackend.BackendName = "memory";
MemoryBackend.Options = { Label: "default" };

const g_BackendInstance = new MemoryBackend({ Label: "example" });

function RunBackendOperation(CallbackAction) {
	return new Promise((Resolve, Reject) => {
		CallbackAction((OperationError, Result) => {
			if (OperationError !== null) {
				Reject(OperationError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function RunBackendExample() {
	await RunBackendOperation((Callback) => g_BackendInstance.Load({}, Callback));

	try {
		console.log(g_BackendInstance.Name, g_BackendInstance.Loaded, g_BackendInstance.Options);
		console.log(await RunBackendOperation((Callback) => g_BackendInstance.Synchronize({}, Callback)));
	} finally {
		await RunBackendOperation((Callback) => g_BackendInstance.Unload({}, Callback));
	}
}

RunBackendExample().catch(console.error);
```

### Change notifications

This standalone example calls the overrides with a detached permission node: it
does not attach a backend to `AUTH_MANAGER` or change live authorization state.
In normal use, the manager invokes these callbacks after the corresponding
changes. Logging an event does not persist it; a storage backend must implement
persistence. The shown `Synchronize` implementation returns empty records.
Replace it with storage-backed loading before using this audit example as a
persistent backend.

```js
const { Backend } = require("auth/index");
const { ParentPermissions } = require("auth/manager");

function RequireBackendOperationArguments(Options, Callback) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Backend operation expects an options object.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Backend operation expects a callback function.");
	}
}

class AuditBackend extends Backend {
	Synchronize(Options, Callback) {
		RequireBackendOperationArguments(Options, Callback);
		Callback(null, { Parents: {}, Players: {} });
	}

	PermissionAdded(Node, strPermission, nServerID, Options, Callback) {
		RequireBackendOperationArguments(Options, Callback);
		console.log(Node.Name, "permission added", strPermission, nServerID);
		Callback(null);
	}

	PermissionRemoved(Node, strPermission, nServerID, Options, Callback) {
		RequireBackendOperationArguments(Options, Callback);
		console.log(Node.Name, "permission removed", strPermission, nServerID);
		Callback(null);
	}

	ParentAdded(Node, strParentName, Options, Callback) {
		RequireBackendOperationArguments(Options, Callback);
		console.log(Node.Name, "parent added", strParentName);
		Callback(null);
	}

	ParentRemoved(Node, strParentName, Options, Callback) {
		RequireBackendOperationArguments(Options, Callback);
		console.log(Node.Name, "parent removed", strParentName);
		Callback(null);
	}
}

AuditBackend.BackendName = "audit";

const g_Audit = new AuditBackend();
const g_mapParent = new ParentPermissions("moderator");

function RunBackendOperation(CallbackAction) {
	return new Promise((Resolve, Reject) => {
		CallbackAction((OperationError, Result) => {
			if (OperationError !== null) {
				Reject(OperationError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function RunAuditExample() {
	await RunBackendOperation((Callback) => g_Audit.Load({}, Callback));

	try {
		await RunBackendOperation((Callback) => g_Audit.PermissionAdded(g_mapParent, "sourcejs.kick", 1, {}, Callback));
		await RunBackendOperation((Callback) => g_Audit.PermissionRemoved(g_mapParent, "sourcejs.kick", 1, {}, Callback));
		await RunBackendOperation((Callback) => g_Audit.ParentAdded(g_mapParent, "guest", {}, Callback));
		await RunBackendOperation((Callback) => g_Audit.ParentRemoved(g_mapParent, "guest", {}, Callback));
	} finally {
		await RunBackendOperation((Callback) => g_Audit.Unload({}, Callback));
	}
}

RunAuditExample().catch(console.error);
```

## Safe use and common mistakes

- Define a non-empty string in the subclass's static `BackendName`; validation
  occurs when `Name` is read, and the getter normalizes it to lower case.
- Pass a non-null, non-array object to the constructor. Arrays and non-object
  values are rejected, while valid values are shallow-merged over the subclass's
  static `Options` defaults into a new `Options` object.
- Let the authorization manager own normal `Load` and `Unload` transitions. These
  methods require `Options` and an error-first `Callback`; the base
  implementations update `Loaded` and pass the backend instance to the callback
  on success. Overrides must keep `Loaded` accurate while the manager
  coordinates the active backend.
- Override `Synchronize(Options, Callback)`; the base implementation throws
  because it cannot supply authorization records. Its error-first callback
  reports failures or the synchronized state.
- `PermissionAdded`, `PermissionRemoved`, `ParentAdded`, and `ParentRemoved`
  require both `Options` and `Callback`; complete the callback with an error or
  `null` after persisting/mirroring each notification.
- Overrides must validate the required per-call `Options` and `Callback` before
  logging, mutation, or IO. Constructor options configure the instance; they do
  not replace the separate options required by each operation.
- Base `Load`, `Unload`, and change-notification callbacks run synchronously.
  An IO backend may complete later; callers must not assume every callback is deferred.

## Related files

- [`packages/sourcejs/auth/index.js`](../../packages/sourcejs/auth/index.js) defines and exports `Backend`.
- [`packages/sourcejs/auth/manager.js`](../../packages/sourcejs/auth/manager.js) owns backend selection, lifecycle, synchronization, and notifications.
- [`packages/sourcejs/auth/backends/flatfile.js`](../../packages/sourcejs/auth/backends/flatfile.js) implements the native flat-file adapter.
- [`packages/sourcejs/auth/backends/sql.js`](../../packages/sourcejs/auth/backends/sql.js) implements the SQL backend.
