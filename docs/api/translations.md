# `require("translations")`

> Warning: this page documents the complete low-level translation module, including process-wide state and
> filesystem side effects. Use the table of contents to review the relevant contract before calling it from a plugin.

`translations` parses the runtime language registry and SourceJS phrase files directly in native code. Use it for
one-shot language resolution, raw file inspection, phrase selection, and token formatting when the higher-level
translation classes are unnecessary.

The package file is `packages/sourcejs/translations.js`. It returns the plugin context's native
`sourcejs.translations` object by identity. It does not aggregate `translations/manager` or `translations/strings`,
cache parsed files in JavaScript, provide aliases, or install a fallback implementation.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Language Registry](#language-registry)
- [Default Language](#default-language)
- [Translation Files](#translation-files)
- [Phrase Selection](#phrase-selection)
- [Arbitrary Formatting](#arbitrary-formatting)
- [INI Format](#ini-format)
- [Errors and Side Effects](#errors-and-side-effects)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

```js
const {
	FormatText,
	GetDefaultLanguage,
	GetFallbackLanguage,
	GetLanguage,
	GetLanguages,
	GetPhrase,
	GetPhraseKeys,
	GetText,
	HasPhrase,
	LoadFile,
	SetDefaultLanguage,
} = require("translations");
```

Valid language and file lookups parse current filesystem state on each call. `FormatText()` is the only export that performs
no language-file or phrase-file access.

These calls are synchronous on the JavaScript caller/game thread, not worker requests. They take no request `Options` or
`Callback`; filesystem work and token-value getters/conversions can delay that thread. Requiring the facade alone does not
read the language registry.

## Exports

| Export | Result |
| --- | --- |
| `GetLanguages()` | Fresh language-registry record. |
| `GetLanguage(strLanguageAlias)` | Registered normalized short name or `null`. |
| `GetDefaultLanguage()` | Current process-wide default short name. |
| `SetDefaultLanguage(strLanguageAlias)` | Installs a process-wide default override and returns `true`. |
| `GetFallbackLanguage()` | Fallback short name, currently always `en`. |
| `LoadFile(strTranslationFilePath)` | Fresh parsed translation-file record. |
| `GetPhraseKeys(strTranslationFilePath)` | Fresh sorted phrase-key array. |
| `GetPhrase(strTranslationFilePath, strPhraseKey)` | Fresh phrase record or `null`. |
| `HasPhrase(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias?)` | Phrase membership; with a language string, exact resolved-language membership. |
| `GetText(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias?, ReplacementTokens?)` | Selected phrase text after token replacement. |
| `FormatText(strMessageTemplate, ReplacementValues?)` | Arbitrary text after replacing own enumerable string `{Token}` names. |

There is no `default` export, reset operation, cached file object, or higher-level class on this module.

## Language Registry

The registry lives at `<game>/addons/sourcejs/data/languages.ini`. When the file is absent, SourceJS attempts to
create a default registry with the 31 Steam platform language names and short aliases. It does not rewrite an
existing registry. If creation or reading fails, the built-in `english` and `en` mappings still exist.

`GetLanguages()` returns a new owning record on every call:

| Field | Type | Meaning |
| --- | --- | --- |
| `DefaultLanguage` | `string` | Current normalized default short name. |
| `FallbackLanguage` | `string` | Normalized fallback short name, `en`. |
| `Languages` | `object` | Lowercase full names and aliases mapped to normalized short names. |

`GetLanguage(strLanguageAlias)` trims the input, compares it case-insensitively, and returns `null` when no configured name or
alias matches. The following example cross-checks the fresh registry against the individual current-value accessors:

```js
const {
	GetDefaultLanguage,
	GetFallbackLanguage,
	GetLanguage,
	GetLanguages,
} = require("translations");

function InspectLanguageRegistry(strLanguageAlias) {
	const Registry = GetLanguages();
	const strResolvedLanguage = GetLanguage(strLanguageAlias);

	return {
		DefaultMatchesRegistry: Registry.DefaultLanguage === GetDefaultLanguage(),
		FallbackMatchesRegistry: Registry.FallbackLanguage === GetFallbackLanguage(),
		Registered: strResolvedLanguage !== null,
		Registry,
		DefaultLanguage: GetDefaultLanguage(),
		FallbackLanguage: GetFallbackLanguage(),
		ResolvedLanguage: strResolvedLanguage,
	};
}
```

For example, `InspectLanguageRegistry(" Russian ")` resolves to `ru` when the default registry is installed. Mutating
the returned owning JavaScript record does not change native state; call `GetLanguages()` again to parse current disk and
process state.

The inspection workflow combines separate reads, not an atomic snapshot. Configuration edits between calls can make its
comparison fields `false`. Language aliases and short codes retain their resource spelling; they are not PascalCase API
properties. Empty or whitespace-only aliases return `null`.
Case normalization applies C character conversion to individual bytes, not Unicode case folding.

## Default Language

`SetDefaultLanguage(strLanguageAlias)` resolves a registered full name or short alias and stores the normalized short name in
process-wide native state. Every plugin context and later translation call observes the override.

The override is native module state shared across JavaScript plugins, not persistent configuration. It survives JavaScript
plugin unload, but is not guaranteed across native module reloads or process restarts. Calling `SetDefaultLanguage()` with
the previous short code restores the same visible value, but it does not restore control to `DEFAULT_LANGUAGE` in
`languages.ini`. This module has no clear or reset API. Use the setter only for a deliberate server-wide configuration decision:

```js
const {
	GetDefaultLanguage,
	GetLanguage,
	SetDefaultLanguage,
} = require("translations");

function ConfigureDefaultLanguage(strLanguageAlias) {
	const strResolvedLanguage = GetLanguage(strLanguageAlias);
	if (strResolvedLanguage === null) {
		throw new RangeError(`Unknown configured language: ${strLanguageAlias}`);
	}

	const strPreviousLanguage = GetDefaultLanguage();
	SetDefaultLanguage(strResolvedLanguage);

	return { Changed: strPreviousLanguage !== strResolvedLanguage, CurrentLanguage: GetDefaultLanguage(), PreviousLanguage: strPreviousLanguage };
}
```

`ConfigureDefaultLanguage("russian")` returns the current and previous short codes and leaves `ru` active process-wide.
A plugin must not treat unload as an automatic rollback point because the native override is not owned by that plugin.
The setter does not save the selected language to disk. A successful override remains the default even if a later file
edit removes its alias; other language lookups still parse the current registry.

## Translation Files

Relative file names resolve below `<game>/resource/sourcejs/translations`. Backslashes are converted to slashes, a
missing extension receives `.ini`, and the lexical path is normalized. Absolute paths are accepted. Relative `..`
components can leave the translation root, so pass only trusted plugin-owned paths.

The main file is merged with a sibling `<stem>_server<extension>` file. Server phrases and language entries parsed
later replace matching main-file entries. For a non-core name, any operation that loads the file attempts to create the
server file when it is absent, even if the operation appears read-only.

File creation is best-effort. A missing or unreadable main file does not itself make `LoadFile()` throw: the result still
contains metadata and any parsed server overrides. Files whose normalized names start with `_core/` skip missing-server-file
creation, but an existing core server override is still parsed. No native call writes or repairs the main phrase file.

`LoadFile(strTranslationFilePath)` requires a non-empty string and returns a fresh record:

| Field | Type | Meaning |
| --- | --- | --- |
| `Name` | `string` | Name relative to the translation root without its final extension when relative calculation succeeds; otherwise the main-file stem. |
| `Path` | `string` | Platform-native physical main-file path. |
| `ServerPath` | `string` | Platform-native physical server-override path. |
| `DefaultLanguage` | `string` | File default, or the current global default when the file defines none. |
| `Strings` | `object` | Exact phrase names mapped to fresh phrase records. |

A phrase record contains `Name`, `DefaultLanguage`, and `Languages`. The `Languages` object maps normalized short names
to parsed text. `GetPhraseKeys(strTranslationFilePath)` returns exact phrase names in sorted native-map order, and
`GetPhrase(strTranslationFilePath, strPhraseKey)` returns `null` when the exact case-sensitive key is absent.

This workflow exercises every raw inspection operation and keeps the returned owning records together:

```js
const {
	GetPhrase,
	GetPhraseKeys,
	HasPhrase,
	LoadFile,
} = require("translations");

function InspectTranslationFile(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias = undefined) {
	const File = LoadFile(strTranslationFilePath);
	const vecPhraseKeys = GetPhraseKeys(strTranslationFilePath);
	const PhraseRecord = GetPhrase(strTranslationFilePath, strPhraseKey);

	return {
		PhraseKeys: vecPhraseKeys,
		HasExactLanguage: (strRequestedLanguageAlias === undefined) ? undefined : HasPhrase(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias),
		HasPhrase: HasPhrase(strTranslationFilePath, strPhraseKey),
		File,
		PhraseRecord,
	};
}
```

Call `InspectTranslationFile("plugin_translations", "RoundStart", "russian")` with a plugin-owned file name. Every
returned object and array owns ordinary JavaScript data; edit it locally if useful, but call the native API again to
observe later disk changes.

These operations parse separately; the inspection record is retained owning data, not an atomic file snapshot. Phrase names,
language codes, and replacement-token names are resource-defined keys and must match their intended spelling.

`GetPhrase(strTranslationFilePath, strPhraseKey)`, `GetPhraseKeys(strTranslationFilePath)`,
`HasPhrase(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias?)`, and
`GetText(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias?, ReplacementTokens?)` map an empty file path to
`_core/translations_strings`. `LoadFile("")` throws instead. Prefer an explicit file path so the dependency remains visible.

## Phrase Selection

`GetText(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias?, ReplacementTokens?)` reparses the language registry and both translation files, then selects text in this order:

1. The requested language, when it resolves and the phrase has that exact short name.
2. The current process-wide default language.
3. The phrase record's default language.
4. The `en` fallback language.

An unknown requested language does not throw by itself; selection continues through the defaults. In contrast,
`HasPhrase(strTranslationFilePath, strPhraseKey)` returns phrase membership. When a language alias is supplied as a
string, it returns `false` unless that alias resolves and the phrase has text for its exact short language; an omitted
or explicit `undefined` alias behaves like the two-argument call.

Use `HasPhrase(strTranslationFilePath, strPhraseKey)` to distinguish an absent key before requesting formatted text:

```js
const { GetText, HasPhrase } = require("translations");

function GetRequiredTranslation(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias, ReplacementTokens = {}) {
	if (!HasPhrase(strTranslationFilePath, strPhraseKey)) {
		throw new Error(`Missing translation phrase: ${strPhraseKey}`);
	}

	return GetText(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias, ReplacementTokens);
}
```

For a phrase named `RoundStart` with English text `"Round {Round} has started."`, calling
`GetRequiredTranslation(strTranslationFilePath, "RoundStart", "english", { Round: 3 })` returns `"Round 3 has started."`.

The replacement-token argument must be a non-null V8 object when supplied; arrays and callable objects qualify, but
explicitly passing `undefined` is invalid. Pass `undefined` in the language slot when supplying tokens without a requested
language: `GetText(strTranslationFilePath, strPhraseKey, undefined, ReplacementTokens)`.

SourceJS enumerates the supplied object's own enumerable string property names, converts each key and value to text, and replaces every exact
`{Token}` occurrence. Non-enumerable properties, symbol keys, and inherited properties are not replacement names. Missing placeholders remain unchanged;
getters and value conversions run synchronously, not as awaited callbacks. Later replacement names can also match tokens
introduced by an earlier replacement, so do not assume simultaneous substitution.

## Arbitrary Formatting

`FormatText(strMessageTemplate, ReplacementValues?)` uses the same token replacement algorithm without reading translation files. It is useful
when the message template comes from a cvar, database, or another trusted runtime source:

```js
const { FormatText } = require("translations");

function FormatCaptureNotice(strPlayerName, strItemName, nScore) {
	return FormatText("{Player} captured {Item}; {Player} scored {Score}.", { Item: strItemName, Player: strPlayerName, Score: nScore });
}
```

`FormatCaptureNotice("Ren", "the checkpoint", 5)` returns `"Ren captured the checkpoint; Ren scored 5."`. Repeated
placeholders are all replaced; a placeholder with no matching own property remains in the returned string.
Omitting the value map returns the template unchanged. Supplying `null` or `undefined` instead throws; the same object and
sequential-replacement rules as `GetText()` apply.

## INI Format

Language files use top-level key/value entries. Translation files may define a top-level default and use one section
per exact phrase name:

```ini
DEFAULT_LANGUAGE = en

[RoundStart]
en = "Round {Round} has started."
es = "La ronda {Round} ha comenzado."
```

Both `=` and `:` separators are accepted; the first occurrence separates key and value. Blank lines and lines beginning
with `#` or `;` are ignored. Values are trimmed, matching outer single/double quotes are removed, and escapes are decoded
even for unquoted values. Escapes support `\n`, `\r`, `\t`, `\\`, escaped single/double quotes, and valid `\xNN` bytes.
Unknown language keys and lines without a non-empty key and separator are ignored. Inline comment markers are ordinary
value text; unmatched quotes and unknown escapes are not validation errors. An unknown escape removes its backslash,
whereas a final lone backslash remains literal.
An empty section with no recognized language entry does not create a phrase record. Duplicate accepted language entries
replace earlier text; file defaults are normalized through the current language registry.

## Errors and Side Effects

- Requiring the package without the SourceJS native runtime throws; there is no JavaScript fallback.
- Functions with required string arguments validate their presence and type and throw native V8 `Error` objects, not
  guaranteed JavaScript `TypeError` instances. When supplied, language arguments accept only a string or `undefined`.
  `HasPhrase()` returns `false` for a missing phrase before validating its optional language argument; do not rely on it as
  an argument validator.
- `LoadFile()` rejects an empty string; other phrase-file operations use the core file for an empty path.
- Embedded NUL bytes make path normalization return an empty path. The parsed file then has no phrases and empty name/path
  fields, but retains the current default language; this is not a thrown path-validation error.
- `SetDefaultLanguage()` throws when the supplied language alias does not resolve.
- `GetText()` throws for a missing key, an unselectable language, missing text for that language, or a non-object replacement-token argument.
- `FormatText()` throws for a non-string message or a supplied non-object value map.
- Language lookup can create `languages.ini`; non-core phrase lookup can create a server override file.
- A failed best-effort creation or file read does not itself throw. Built-in English registry defaults and any readable
  server overrides remain available; absent phrases still produce the documented `null`/`false`/text-error outcomes.
- File records own the data parsed by that call. Process default-language state is current and shared across plugins.
- Absolute and traversal-containing relative paths are not confined to the translation root. Do not expose file
  arguments directly to players or untrusted network input.

## Common Mistakes

- Do not set a temporary default language expecting plugin unload or resetting the previous short code with `SetDefaultLanguage()` to clear the native override.
- Do not use `HasPhrase(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias)` to predict fallback behavior; a supplied string checks exact language membership rather than `GetText()` selection.
- Do not mutate a `GetLanguages()`, `LoadFile()`, or `GetPhrase()` result expecting native state or disk to change.
- Do not assume read-named phrase operations are filesystem-pure for a non-core file.
- Do not reuse an earlier file record when the server override can change at runtime.
- Do not pass player-controlled absolute or traversal paths to any file operation.

## Related Modules

- [`translations/catalog`](translations-catalog.md) provides plugin-owned JSON catalogs and per-client rendering.
- [`translations/manager`](translations-manager.md) provides reusable stateless language-registry views.
- [`translations/strings`](translations-strings.md) provides `LangStrings` and `TranslationStrings` containers.
