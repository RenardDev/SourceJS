# `require("translations/manager")`

> Warning: this page documents the complete `LanguageManager` wrapper, including its process-wide writable default.
> Review the ownership section before changing server language state from a plugin.

`translations/manager` provides object-oriented current-value access to the native language registry. Use it when a
component benefits from a stable manager object while observing the current `languages.ini`, default-language override,
and fallback language on every property or method call.

The package file is `packages/sourcejs/translations/manager.js`. It delegates directly to `require("translations")`;
it does not cache registry contents, duplicate native state, expose compatibility exports, or install a fallback
implementation.

The default implementation is synchronous and confined to the JavaScript caller/game thread. Native registry operations
read `languages.ini` on each call and may create a missing file; they are not worker requests and take no `Options` or
`Callback`. Importing the package or constructing a manager alone performs no registry lookup.

## Contents

- [Import](#import)
- [Exports](#exports)
- [LanguageManager](#languagemanager)
- [Inspecting Languages](#inspecting-languages)
- [Configuring The Default](#configuring-the-default)
- [Multiple Manager Views](#multiple-manager-views)
- [Errors and Ownership](#errors-and-ownership)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

```js
const { LANGUAGE_MANAGER, LanguageManager } = require("translations/manager");
```

`LANGUAGE_MANAGER` is the canonical instance in one plugin context. Requiring the module again in that context returns
the same CommonJS-cached instance. Another plugin context receives another JavaScript instance, while all instances
delegate to the same process-wide native translation state.

## Exports

| Export | Type | Result |
| --- | --- | --- |
| [`LanguageManager`](#languagemanager) | `class` | Stateless language-registry view. |
| `LANGUAGE_MANAGER` | `LanguageManager` | Canonical convenience instance for the current plugin context. |

There is no lowercase singleton name, `default` export, or compatibility alias.

## LanguageManager

`LanguageManager` declares no custom constructor. Use `new LanguageManager()`; additional JavaScript arguments are
ignored by the default constructor and do not configure a separate registry.

| Member | Kind | Result |
| --- | --- | --- |
| `Aliases` | getter | Fresh owning record mapping built-in and currently configured language aliases to normalized short names; calls native `GetLanguages().Languages`. |
| `DefaultLanguage` | getter/setter | Current normalized process default; assignment installs a native override. |
| `FallbackLanguage` | getter | Current fallback short name, `en`; no setter exists. |
| `GetLanguage(strLanguageName)` | method | Normalized short name or `null`. |
| `Has(strLanguageName)` | method | Whether `this.GetLanguage(strLanguageName)` returns a non-null value. |

Every accessor delegates immediately. A manager does not retain returned alias records or own the native default or
language file. Alias keys and short-code values are resource-defined language identifiers, not PascalCase API properties.

## Inspecting Languages

Read related values in one explicit operation and retain the returned owning data when a stable report is needed.
This collects separate native reads, not an atomic snapshot: external file edits between calls can produce mixed values.

```js
const { LANGUAGE_MANAGER } = require("translations/manager");

function InspectLanguageManager(vecLanguageNames, Manager = LANGUAGE_MANAGER) {
	const Aliases = Manager.Aliases;
	const vecResolutions = [];
	for (const strLanguageName of vecLanguageNames) {
		vecResolutions.push({ Registered: Manager.Has(strLanguageName), Name: strLanguageName, ShortName: Manager.GetLanguage(strLanguageName) });
	}

	return { Resolutions: vecResolutions, Aliases, DefaultLanguage: Manager.DefaultLanguage, FallbackLanguage: Manager.FallbackLanguage };
}
```

For example, when `english = en` and `russian = ru` are registered, `InspectLanguageManager(["english", " Russian ", "missing"])`
returns current aliases plus `en`, `ru`, and `null` resolutions. Native lookup trims whitespace and normalizes alias case;
unknown or empty string names return `null`. `Aliases` is an owning record parsed by that call: mutating it changes only
the returned object, and the next property access parses current native state again.

`Has(strLanguageName)` deliberately calls `this.GetLanguage(strLanguageName)`. A subclass that overrides `GetLanguage()` also changes membership behavior.

## Configuring The Default

Assigning `DefaultLanguage` calls native `SetDefaultLanguage()`. The value may be a configured full name or short alias
and affects every manager and plugin in the process.

Validate and report a deliberate server-wide configuration change like this:

```js
const { LANGUAGE_MANAGER } = require("translations/manager");

function ConfigureManagerDefault(strLanguageName, Manager = LANGUAGE_MANAGER) {
	const strResolvedLanguage = Manager.GetLanguage(strLanguageName);
	if (strResolvedLanguage === null) {
		throw new RangeError(`Unknown configured language: ${strLanguageName}`);
	}

	const strPreviousLanguage = Manager.DefaultLanguage;
	Manager.DefaultLanguage = strResolvedLanguage;

	return { Changed: strPreviousLanguage !== strResolvedLanguage, CurrentLanguage: Manager.DefaultLanguage, PreviousLanguage: strPreviousLanguage };
}
```

`ConfigureManagerDefault("russian")` leaves `ru` active and returns the previous visible value. The native root has no
operation that clears the override and resumes following `DEFAULT_LANGUAGE` from `languages.ini`. Assigning the
previous value is another override assignment, not a reset.

The setter does not write the selected default back to `languages.ini`. File creation is best-effort: unavailable or
unreadable language configuration leaves the built-in English aliases and `en` fallback usable. A successful override
continues to supply the default even if a later file edit removes its alias; other lookups still use the current registry.

JavaScript assignment expressions evaluate to the assigned value, so
`const strResult = Manager.DefaultLanguage = "english"` produces `"english"`; it does not expose the native setter's
internal `true` return.

## Multiple Manager Views

Constructing another manager creates only another stateless JavaScript view. This workflow verifies independent owning
alias records and shared native values without changing global state:

```js
const { LANGUAGE_MANAGER, LanguageManager } = require("translations/manager");

function CompareLanguageManagerViews(strLanguageName) {
	const OtherManager = new LanguageManager();
	const SharedAliases = LANGUAGE_MANAGER.Aliases;
	const OtherAliases = OtherManager.Aliases;

	return {
		AliasesAreIndependent: SharedAliases !== OtherAliases,
		DefaultMatches: LANGUAGE_MANAGER.DefaultLanguage === OtherManager.DefaultLanguage,
		FallbackMatches: LANGUAGE_MANAGER.FallbackLanguage === OtherManager.FallbackLanguage,
		KnownByBoth: LANGUAGE_MANAGER.Has(strLanguageName) && OtherManager.Has(strLanguageName),
		OtherAliases,
		SharedAliases,
	};
}
```

Two alias records own independent data; their entries match only if the registry stayed unchanged between reads. A later
write through either manager is immediately visible through the other manager's `DefaultLanguage` getter.

## Errors and Ownership

- Requiring the module without the SourceJS native runtime throws; there is no JavaScript fallback.
- `GetLanguage(strLanguageName)` and the default `Has(strLanguageName)` forward non-string arguments to native lookup and throw an `Error`; an unknown string instead returns `null`/`false`.
- Assigning an unknown default language throws a native V8 error and leaves the previous value active.
- `FallbackLanguage` has no setter. In strict mode, assigning it throws a JavaScript `TypeError`.
- `Aliases` is an owning record, not an address-backed map and not a writable configuration object.
- Native language lookups synchronously read configuration and can attempt to create a missing `languages.ini`; a failed creation/read does not itself throw and built-in defaults remain usable.
- Manager instances require no disposal and hold no native handle.
- The default-language override is process-wide, is not JavaScript-plugin-owned, and survives unloading a JavaScript plugin; this is not a persistence guarantee across native module reloads or process restarts.

## Common Mistakes

- Do not use a temporary assignment pattern expecting assignment of the previous value to clear the native override.
- Do not retain `Aliases` when code needs to observe runtime edits to `languages.ini`.
- Do not construct one manager per subsystem expecting isolated language state.
- Do not assign `FallbackLanguage`; configure phrase fallback data through the supported translation files instead.
- Do not add a lowercase singleton alias; import `LANGUAGE_MANAGER` directly.

## Related Modules

- [`translations`](translations.md) documents native registry parsing, phrase selection, process state, and file side effects.
- [`translations/strings`](translations-strings.md) provides reusable phrase-file and per-language containers.
