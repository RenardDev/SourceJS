# `require("effects/hooks")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

`effects/hooks` registers JavaScript callbacks around managed temporary-entity creation. Pre-create hooks receive the same mutable `TemporaryEntity` used by the creation call and can cancel it by returning exactly `false`. Post-create hooks run after the template's creation call returns a truthy result; this is not confirmation of client delivery or visibility.

The managed `TemporaryEntity.CreateTemporaryEntity()` lifecycle invokes these hooks, including calls through `effects.CreateTemporaryEntity()`. Calling `TemporaryEntityTemplate.CreateTemporaryEntity()` directly delegates to the native runtime without invoking them. They do not intercept arbitrary engine-generated effects. Callback exceptions propagate; a post-create exception occurs after the creation call and does not undo its effects.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Callback contract](#callback-contract)
- [Hook classes](#hook-classes)
- [Examples](#examples)
- [Errors and lifecycle](#errors-and-lifecycle)
- [Related modules](#related-modules)

## Location and purpose

[`packages/sourcejs/effects/hooks.js`](../../packages/sourcejs/effects/hooks.js) implements the managed hook objects over the shared template hook lists in [`packages/sourcejs/effects/templates.js`](../../packages/sourcejs/effects/templates.js). [`packages/sourcejs/effects/index.js`](../../packages/sourcejs/effects/index.js) invokes those lists around managed temporary-entity creation.

Use this module when a plugin must validate, modify, cancel, or observe managed temporary-entity sends without bypassing the shared template lifecycle.

## Import

```js
const {
	TemporaryEntityPostCreateHook,
	TemporaryEntityPreCreateHook,
	RegisterTemporaryEntityPostCreateHook,
	RegisterTemporaryEntityPreCreateHook,
} = require("effects/hooks");
```

## Exports

| Export | Signature | Result |
| --- | --- | --- |
| [`TemporaryEntityPostCreateHook`](#temporaryentitypostcreatehook) | `new TemporaryEntityPostCreateHook(strTemporaryEntityName)` | Unregistered post-create hook bound to one shared template. |
| [`TemporaryEntityPreCreateHook`](#temporaryentityprecreatehook) | `new TemporaryEntityPreCreateHook(strTemporaryEntityName)` | Unregistered pre-create hook bound to one shared template. |
| [`RegisterTemporaryEntityPostCreateHook`](#registertemporaryentitypostcreatehookstrtemporaryentityname-hookcallback) | `RegisterTemporaryEntityPostCreateHook(strTemporaryEntityName, HookCallback)` | Constructs a hook, registers the callback, and returns the `TemporaryEntityPostCreateHook`; lookup or registration failures throw. |
| [`RegisterTemporaryEntityPreCreateHook`](#registertemporaryentityprecreatehookstrtemporaryentityname-hookcallback) | `RegisterTemporaryEntityPreCreateHook(strTemporaryEntityName, HookCallback)` | Constructs a hook, registers the callback, and returns the `TemporaryEntityPreCreateHook`; lookup or registration failures throw. |

## Callback contract

Both phases receive the same entity object and the recipients argument supplied to managed creation, without normalization by the hook loop. Recipients can be omitted; this observational callback does not assume an array:

```js
function HandleTemporaryEntityCreation(TemporaryEntity, Recipients) {
	console.log(TemporaryEntity.Name, Recipients);
}
```

| Argument | Meaning |
| --- | --- |
| `TemporaryEntity` | Mutable `TemporaryEntity` whose `Values` are used by this creation request. |
| `Recipients` | The original recipients argument, possibly `undefined`; the hook loop neither copies nor validates it. Native recipient acceptance is a separate contract. |

A pre-create callback cancels creation only by returning the boolean `false`. Cancellation stops the remaining pre-create hooks, returns `false` from `TemporaryEntity.CreateTemporaryEntity()`, skips the native send, and skips every post-create hook. Other return values continue creation.

A post-create callback runs after the template's creation call returns a truthy result. Its return value is ignored; changing staged values does not retroactively change that call. The entity remains mutable, so changes can affect a later creation using it. Neither phase catches callback exceptions: a thrown exception stops the loop and propagates to the caller; post-create failures do not undo creation. Callbacks run synchronously and promises are not awaited, so an asynchronous `false` does not cancel creation.

## Hook classes

`TemporaryEntityPreCreateHook` and `TemporaryEntityPostCreateHook` expose the same lifecycle members:

| Field or method | Signature | Meaning |
| --- | --- | --- |
| `Template` | Property | Initially the shared template resolved by the constructor; registration reads this property. Changing it does not move an existing registration. |
| `Phase` | Property | Initially `"PreCreate"` or `"PostCreate"`; registration requires one of these exact values. Changing it does not move an existing registration. |
| `Callback` | Property | Public mirror set after successful registration and cleared after successful removal; assigning it does not change the privately tracked callback or template list. |
| [`RegisterTemporaryEntityHook`](#registertemporaryentityhookhookcallback) | `RegisterTemporaryEntityHook(HookCallback)` | Validates the callback and phase, removes an existing registration, then registers the new callback and returns it. Replacement is not transactional: a later failure does not restore the old registration. |
| [`UnregisterTemporaryEntityHook`](#unregistertemporaryentityhook) | `UnregisterTemporaryEntityHook()` | Removes the privately tracked callback from its captured template/phase. Returns `false` when privately idle and `true` after successful removal; an externally removed callback causes the standard template implementation to throw. |

Constructing either class resolves the temporary-entity template immediately. An unknown name therefore throws before `RegisterTemporaryEntityHook()`.

`RegisterTemporaryEntityHook()` captures the current `Template` and `Phase` used for the successful registration. Later edits to those public fields configure the next registration; `UnregisterTemporaryEntityHook()` still removes the callback from the template and phase where it was actually installed. Assigning `Callback` directly does not register anything, so use `RegisterTemporaryEntityHook()` and `UnregisterTemporaryEntityHook()` for lifecycle changes.

## Examples

### `TemporaryEntityPreCreateHook`

Temporarily clamp the `LifeTime` profile alias during a controlled managed-creation test. Run only in an initialized server context where BeamPoints and its profiles are available; omitted recipients use the creation API's default recipient policy. The assertion checks this hook's observation, not client delivery or changes made by later hooks:

```js
const { CreateTemporaryEntity } = require("effects");
const { TemporaryEntityPreCreateHook } = require("effects/hooks");

const g_flMaximumBeamLifetime = 2;
let g_flObservedBeamLifetime = null;
let g_bBeamLifetimePreCreateHookRegistered = false;

function ClampBeamLifetime(TemporaryEntity) {
	const flLifetime = TemporaryEntity.GetTemporaryEntityPropertyFloat("LifeTime");
	if (flLifetime > g_flMaximumBeamLifetime) {
		TemporaryEntity.SetTemporaryEntityPropertyFloat("LifeTime", g_flMaximumBeamLifetime);
	}

	g_flObservedBeamLifetime = TemporaryEntity.GetTemporaryEntityPropertyFloat("LifeTime");

	return true;
}

const g_BeamLifetimePreCreateHook = new TemporaryEntityPreCreateHook("BeamPoints");
try {
	g_BeamLifetimePreCreateHook.RegisterTemporaryEntityHook(ClampBeamLifetime);
	g_bBeamLifetimePreCreateHookRegistered = true;

	const bBeamTemporaryEntityCreated = CreateTemporaryEntity("BeamPoints", { LifeTime: 5 });
	if (!bBeamTemporaryEntityCreated || (g_flObservedBeamLifetime !== g_flMaximumBeamLifetime)) {
		throw new Error("BeamPoints creation failed or the hook did not observe the expected lifetime.");
	}
} finally {
	if (g_bBeamLifetimePreCreateHookRegistered) {
		const bBeamLifetimePreCreateHookRemoved = g_BeamLifetimePreCreateHook.UnregisterTemporaryEntityHook();
		if (!bBeamLifetimePreCreateHookRemoved) {
			throw new Error("The BeamPoints lifetime hook could not be removed.");
		}
	}
}
```

The callback edits the actual staged object used by this creation request; it does not edit a detached payload snapshot.

### `TemporaryEntityPostCreateHook`

Count post-create callback invocations during a controlled BeamPoints creation. Run in an initialized server context with no concurrent or reentrant BeamPoints creation during the assertion. Omitted recipients use the creation API's default policy; the count is not a client-delivery acknowledgement:

```js
const { CreateTemporaryEntity } = require("effects");
const { TemporaryEntityPostCreateHook } = require("effects/hooks");

let g_unBeamPostCreateCount = 0;
let g_bBeamAuditHookRegistered = false;

function AuditTemporaryEntityCreation(TemporaryEntity) {
	g_unBeamPostCreateCount += 1;
	console.log({ TemporaryEntityName: TemporaryEntity.Name, PostCreateCount: g_unBeamPostCreateCount });
}

const g_BeamAuditPostCreateHook = new TemporaryEntityPostCreateHook("BeamPoints");
try {
	g_BeamAuditPostCreateHook.RegisterTemporaryEntityHook(AuditTemporaryEntityCreation);
	g_bBeamAuditHookRegistered = true;

	const bBeamTemporaryEntityCreated = CreateTemporaryEntity("BeamPoints", { LifeTime: 0.5 });
	if (!bBeamTemporaryEntityCreated || (g_unBeamPostCreateCount !== 1)) {
		throw new Error("BeamPoints creation failed or the audit hook did not run exactly once.");
	}
} finally {
	if (g_bBeamAuditHookRegistered) {
		const bBeamAuditHookRemoved = g_BeamAuditPostCreateHook.UnregisterTemporaryEntityHook();
		if (!bBeamAuditHookRemoved) {
			throw new Error("The BeamPoints audit hook could not be removed.");
		}
	}
}
```

The count is not incremented when a pre-create hook cancels, the template's creation call throws or returns a falsy result, or an earlier post-create hook throws before this callback runs. This callback increments before logging; if logging throws, the template call has already succeeded and the exception still propagates. Cleanup in `finally` is attempted on failure; a cleanup exception can replace the original error.

### `RegisterTemporaryEntityPreCreateHook(strTemporaryEntityName, HookCallback)`

Reject non-finite or non-positive profile widths with the convenience function. This controlled test requires an initialized server with BeamPoints profiles; it deliberately requests cancellation, so no send should occur. Earlier hooks can prevent this validator from running, and later hooks could alter values after validation in other calls:

```js
const { CreateTemporaryEntity } = require("effects");
const { RegisterTemporaryEntityPreCreateHook } = require("effects/hooks");

let g_bBeamWidthRejected = false;

function ValidateBeamWidth(TemporaryEntity) {
	const flStartWidth = TemporaryEntity.GetTemporaryEntityPropertyFloat("StartWidth");
	const flEndWidth = TemporaryEntity.GetTemporaryEntityPropertyFloat("EndWidth");
	const bValidWidths = Number.isFinite(flStartWidth) && Number.isFinite(flEndWidth) && (flStartWidth > 0) && (flEndWidth > 0);
	if (!bValidWidths) {
		g_bBeamWidthRejected = true;
		return false;
	}

	return true;
}

const g_BeamWidthPreCreateHook = RegisterTemporaryEntityPreCreateHook("BeamPoints", ValidateBeamWidth);
try {
	const bBeamTemporaryEntityCreated = CreateTemporaryEntity("BeamPoints", { EndWidth: 0, StartWidth: 4 });
	if ((bBeamTemporaryEntityCreated !== false) || !g_bBeamWidthRejected) {
		throw new Error("The width validator did not reject and cancel the invalid beam.");
	}
} finally {
	const bBeamWidthPreCreateHookRemoved = g_BeamWidthPreCreateHook.UnregisterTemporaryEntityHook();
	if (!bBeamWidthPreCreateHookRemoved) {
		throw new Error("The BeamPoints width hook could not be removed.");
	}
}
```

`RegisterTemporaryEntityPreCreateHook()` returns the hook resource, not the callback, so retain that result for cleanup.

### `RegisterTemporaryEntityPostCreateHook(strTemporaryEntityName, HookCallback)`

Record the entity name observed by a post-create callback without manually constructing the hook class. Run this controlled example only with an initialized server and valid BeamPoints profiles, without other or reentrant creations during the assertion. Default recipients apply; an observation does not establish client delivery:

```js
const { CreateTemporaryEntity } = require("effects");
const { RegisterTemporaryEntityPostCreateHook } = require("effects/hooks");

const g_vecObservedTemporaryEntityNames = [];

function RecordTemporaryEntityObservation(TemporaryEntity) {
	g_vecObservedTemporaryEntityNames.push(TemporaryEntity.Name);
}

const g_BeamObservationPostCreateHook = RegisterTemporaryEntityPostCreateHook("BeamPoints", RecordTemporaryEntityObservation);
try {
	const bBeamTemporaryEntityCreated = CreateTemporaryEntity("BeamPoints", { LifeTime: 0.25 });
	if (!bBeamTemporaryEntityCreated || (g_vecObservedTemporaryEntityNames.length !== 1) || (g_vecObservedTemporaryEntityNames[0] !== "BeamPoints")) {
		throw new Error("BeamPoints creation failed or exactly one matching observation was not recorded.");
	}
} finally {
	const bBeamObservationHookRemoved = g_BeamObservationPostCreateHook.UnregisterTemporaryEntityHook();
	if (!bBeamObservationHookRemoved) {
		throw new Error("The BeamPoints observation hook could not be removed.");
	}
}
```

### `RegisterTemporaryEntityHook(HookCallback)`

Replace one hook's lifetime upper-bound predicate, then remove it. This example requires an available BeamPoints template but does not create an effect. The predicates demonstrate different limits, not complete value validation. Replacement removes the old callback before adding the new one; failure of the second step does not restore the old callback:

```js
const { TemporaryEntityPreCreateHook } = require("effects/hooks");

const g_flDevelopmentBeamLifetimeLimit = 10;
const g_flProductionBeamLifetimeLimit = 2;

function IsDevelopmentBeamAllowed(TemporaryEntity) {
	return TemporaryEntity.GetTemporaryEntityPropertyFloat("LifeTime") <= g_flDevelopmentBeamLifetimeLimit;
}

function IsProductionBeamAllowed(TemporaryEntity) {
	return TemporaryEntity.GetTemporaryEntityPropertyFloat("LifeTime") <= g_flProductionBeamLifetimeLimit;
}

const g_BeamPolicyPreCreateHook = new TemporaryEntityPreCreateHook("BeamPoints");
try {
	g_BeamPolicyPreCreateHook.RegisterTemporaryEntityHook(IsDevelopmentBeamAllowed);
	// Replacement unregisters the current callback before adding its successor.
	g_BeamPolicyPreCreateHook.RegisterTemporaryEntityHook(IsProductionBeamAllowed);

	if (g_BeamPolicyPreCreateHook.Callback !== IsProductionBeamAllowed) {
		throw new Error("The hook's callback mirror does not match the production predicate.");
	}
} finally {
	// False is valid when failed replacement already removed the old callback.
	// With the standard template, an active removal failure throws.
	g_BeamPolicyPreCreateHook.UnregisterTemporaryEntityHook();
}
```

Registering a non-function throws `TypeError` before removal of an existing registration. Cleanup is attempted even if replacement throws while removing the old callback. `false` is valid when the hook is already idle after a failed replacement; cleanup failure can still mask the original error. The public `Callback` check above confirms the mirror value, not independent proof of template-list membership. Do not modify public hook state or template lists during this test; an external removal can make cleanup throw.

### `UnregisterTemporaryEntityHook()`

Check the normal idle → registered → idle lifecycle without creating an effect. Repeated removal returns `false` only after the hook's private state is idle; external template-list edits or removal failures are not silently ignored:

```js
const { TemporaryEntityPostCreateHook } = require("effects/hooks");

let g_bBeamPostCreateHookRegistered = false;

function IgnoreTemporaryEntityCreation() {
	return undefined;
}

const g_BeamPostCreateHook = new TemporaryEntityPostCreateHook("BeamPoints");
if (g_BeamPostCreateHook.UnregisterTemporaryEntityHook() !== false) {
	throw new Error("An idle hook must not report a removal.");
}

try {
	g_BeamPostCreateHook.RegisterTemporaryEntityHook(IgnoreTemporaryEntityCreation);
	g_bBeamPostCreateHookRegistered = true;
} finally {
	if (g_bBeamPostCreateHookRegistered) {
		const bBeamPostCreateHookRemoved = g_BeamPostCreateHook.UnregisterTemporaryEntityHook();
		if (!bBeamPostCreateHookRemoved) {
			throw new Error("The BeamPoints post-create hook could not be removed.");
		}
	}
}

const g_bIdleBeamPostCreateHookRemoved = g_BeamPostCreateHook.UnregisterTemporaryEntityHook();
if (g_bIdleBeamPostCreateHookRemoved) {
	throw new Error("Hook cleanup did not transition to the idle state.");
}
```

Unregister owned hooks during plugin unload. The template list retains callback functions until removal; discarding the hook object does not remove the callback. Keep the registration resource for cleanup and do not assume a retry will succeed after another caller modifies its template list.

### Full pre/post lifecycle

Verify cancellation and observed pre/post ordering in an initialized server with valid BeamPoints profiles. This test makes one non-cancelled creation using default recipients; it requires no interfering or reentrant BeamPoints calls. The observed sequence is not proof of client delivery. Nested cleanup attempts pre-hook removal even if post-hook registration or removal throws, but a cleanup exception can replace an earlier failure:

```js
const { CreateTemporaryEntity } = require("effects");
const { RegisterTemporaryEntityPostCreateHook, RegisterTemporaryEntityPreCreateHook } = require("effects/hooks");

const g_vecTemporaryEntityHookPhases = [];

function RecordPreCreatePhase(TemporaryEntity) {
	const flLifetime = TemporaryEntity.GetTemporaryEntityPropertyFloat("LifeTime");
	g_vecTemporaryEntityHookPhases.push(`pre:${flLifetime}`);

	return flLifetime > 0;
}

function RecordPostCreatePhase(TemporaryEntity) {
	g_vecTemporaryEntityHookPhases.push(`post:${TemporaryEntity.GetTemporaryEntityPropertyFloat("LifeTime")}`);
}

const g_BeamPreCreateHook = RegisterTemporaryEntityPreCreateHook("BeamPoints", RecordPreCreatePhase);
try {
	const BeamPostCreateHook = RegisterTemporaryEntityPostCreateHook("BeamPoints", RecordPostCreatePhase);
	try {
		const bCancelledBeamTemporaryEntityCreated = CreateTemporaryEntity("BeamPoints", { LifeTime: 0 });
		if (bCancelledBeamTemporaryEntityCreated !== false) {
			throw new Error("The zero-lifetime creation was not cancelled.");
		}

		const bSuccessfulBeamTemporaryEntityCreated = CreateTemporaryEntity("BeamPoints", { LifeTime: 1 });
		if (!bSuccessfulBeamTemporaryEntityCreated) {
			throw new Error("The positive-lifetime creation did not succeed.");
		}

		if (g_vecTemporaryEntityHookPhases.join(",") !== "pre:0,pre:1,post:1") {
			throw new Error(`Unexpected temporary-entity hook order: ${g_vecTemporaryEntityHookPhases.join(",")}`);
		}

		console.log(g_vecTemporaryEntityHookPhases);
	} finally {
		const bBeamPostCreateHookRemoved = BeamPostCreateHook.UnregisterTemporaryEntityHook();
		if (!bBeamPostCreateHookRemoved) {
			throw new Error("The BeamPoints lifecycle post-hook could not be removed.");
		}
	}
} finally {
	const bBeamPreCreateHookRemoved = g_BeamPreCreateHook.UnregisterTemporaryEntityHook();
	if (!bBeamPreCreateHookRemoved) {
		throw new Error("The BeamPoints lifecycle pre-hook could not be removed.");
	}
}
```

## Errors and lifecycle

- Use these resources in SourceJS game-thread execution. Dispatch is synchronous in the caller's context; this API does not queue callbacks on request worker threads.
- Use the native temporary-entity name, such as `BeamPoints`, not the server class name `CTEBeamPoints`.
- Register functions and retain their hook resources. Template lists compare callbacks by identity; adding an already-registered callback to the same template/phase throws, including registration through a second hook object. Re-registering through the same hook object first removes its current registration, so replacing it with the same callback is allowed.
- Return the boolean `false` only when cancellation is intended; `undefined`, `null`, `0`, and empty strings do not cancel.
- A thrown callback error propagates to the caller and stops the current managed lifecycle.
- Callbacks are synchronous; returned promises are not awaited. Do not use an asynchronous result to cancel creation.
- Hook loops iterate the actual arrays, not snapshots. Do not add or remove hooks, edit hook state, or mutate template lists during dispatch; such changes can affect which callbacks run in that same loop. No reentrancy isolation is provided.
- Keep hook resources in plugin-owned state and call `UnregisterTemporaryEntityHook()` deterministically during unload or reload.
- Callback retention is not automatic plugin ownership. Dropping the resource does not unregister it, and a public callback mirror is not proof of list membership. Replacement is not transactional; cleanup can throw and can mask an earlier failure.
- Use `memory/hooks` for machine-code/vtable detours. `effects/hooks` is a higher-level managed temporary-entity lifecycle and does not expose a trampoline.

## Related modules

- [`effects`](effects.md) exposes the managed root helpers and native temporary-entity operations.
- [The `TemporaryEntity` guide](effects-temp-entity.md) describes staging and creation through `effects`.
- [`effects/templates`](effects-templates.md) owns the shared template hook arrays and direct native template creation.
- [`memory/hooks`](memory-hooks.md) owns Detours function and vtable hooks.
