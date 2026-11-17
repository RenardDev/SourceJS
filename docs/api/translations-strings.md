# `require("translations/strings")`

> Warning: this page documents the complete reusable translation-view API.
> Composite collection methods can parse a file more than once, so review the consistency and side-effect sections
> before using them on frequently edited files.

`translations/strings` provides reusable JavaScript views over native translation files and phrases.
The objects retain file, phrase, and token identity. Their getters and methods delegate to `require("translations")`,
so later disk changes are visible on the next operation.

The package file is [`packages/sourcejs/translations/strings.js`](../../packages/sourcejs/translations/strings.js).
It exports two classes without aliases, native addresses, hidden caches, or fallback data.

## Contents

- [Import](#import)
- [Exports](#exports)
- [LangStrings](#langstrings)
- [Inspecting A File View](#inspecting-a-file-view)
- [Reading Through A File View](#reading-through-a-file-view)
- [Iterating A File View](#iterating-a-file-view)
- [TranslationStrings](#translationstrings)
- [Inspecting A Phrase View](#inspecting-a-phrase-view)
- [Token Ownership](#token-ownership)
- [Consistency and Side Effects](#consistency-and-side-effects)
- [Errors and Lifetime](#errors-and-lifetime)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

```js
const { LangStrings, TranslationStrings } = require("translations/strings");
```

Importing the module constructs no view and performs no native parse.
Constructing a view immediately invokes a native file or phrase lookup.
That lookup is not a guarantee that a main file exists or is readable.

## Exports

| Export | Type | Result |
| --- | --- | --- |
| [`LangStrings`](#langstrings) | `class` | Repeatedly-read view of one translation file. |
| [`TranslationStrings`](#translationstrings) | `class` | Repeatedly-read view of one phrase and its language texts. |

Neither class owns a native handle or borrowed SDK memory.
Native file and phrase calls return ordinary owning JavaScript records; the class object is the reusable view.

## LangStrings

`new LangStrings(strFile)` calls native `LoadFile(strFile)` immediately, then stores the original `strFile` value in its public `File` field.
The constructor therefore validates a non-empty file string.
Missing or unreadable main files still produce a record with resolved metadata and any successfully parsed server overrides.
Loading can attempt best-effort language-file and non-core server-override creation; creation failure does not itself make the lookup fail.

| Member | Kind | Result |
| --- | --- | --- |
| `File` | field | Current file argument used by later native calls. |
| `Data` | getter | Fresh native file record. |
| `DefaultLanguage` | getter | Current default language code from a fresh record. |
| `Name` | getter | Current resolved file name from a fresh record. |
| `Path` | getter | Current platform-native main-file path from a fresh record. |
| `ServerPath` | getter | Current platform-native server-override path from a fresh record. |
| `Size` | getter | Current `Keys().length`. |
| `Keys()` | method | Fresh sorted phrase-name array. |
| `Values()` | method | Fresh `TranslationStrings` view for every current key. |
| `Entries()` | method | Fresh `[strKey, TranslationStrings]` pair for every current key. |
| `Get(strKey)` | method | New phrase view or `null`. |
| `Has(strKey, strLanguage?)` | method | Phrase membership or exact resolved-language membership. |
| `GetString(strKey, strLanguage?, Tokens?)` | method | Current selected and formatted phrase text. |
| `ForEach(Callback, ThisArgument?)` | method | Map-like `(Value, strKey, Collection)` iteration; returns `undefined`. |
| `[Symbol.iterator]()` | method | Iterator over a newly built `Entries()` array. |

`File` is an ordinary writable field rather than a private immutable slot.
Assigning another value retargets later operations without constructor validation.
The next native call validates or rejects it.

## Inspecting A File View

Build an owning report when the caller wants current metadata without retaining several unrelated result records:

```js
const { LangStrings } = require("translations/strings");

function InspectTranslationFileView(strFileName) {
	const TranslationFile = new LangStrings(strFileName);
	const FileData = TranslationFile.Data;

	return {
		Keys: TranslationFile.Keys(),
		Data: FileData,
		DefaultLanguage: TranslationFile.DefaultLanguage,
		File: TranslationFile.File,
		Path: TranslationFile.Path,
		ServerPath: TranslationFile.ServerPath,
		Size: TranslationFile.Size,
	};
}
```

Each derived getter shown above performs its own native call; it does not reuse `Data`.
The returned values are ordinary owning records and arrays.
Keep the `LangStrings` instance when later operations must observe future file changes.

## Reading Through A File View

`Get(strKey)` first calls `Has(strKey)`.
When the key exists, constructing the returned `TranslationStrings` performs a second native phrase parse.
`GetString(strKey, strLanguage, Tokens)` delegates directly to native phrase selection and token formatting.

Unlike `TranslationStrings.GetString()`, `LangStrings.GetString()` neither merges nor validates tokens in JavaScript.
It forwards them to native `GetText`, whose non-null object contract also accepts arrays and functions.

```js
const { LangStrings } = require("translations/strings");

function ReadFilePhrase(strFileName, strPhraseName, strLanguage, Tokens = {}) {
	const TranslationFile = new LangStrings(strFileName);
	const PhraseView = TranslationFile.Get(strPhraseName);

	return {
		ExactLanguageAvailable: (strLanguage === undefined) ? undefined : TranslationFile.Has(strPhraseName, strLanguage),
		PhraseAvailable: TranslationFile.Has(strPhraseName),
		PhraseView,
		Text: (PhraseView === null) ? null : TranslationFile.GetString(strPhraseName, strLanguage, Tokens),
	};
}
```

For a phrase containing `en = "Round {Round} has started."`,
`ReadFilePhrase(strFileName, "RoundStart", "english", { Round: 3 })` returns the formatted English text.
A missing key returns `PhraseView: null` and `PhraseAvailable: false`.
`ExactLanguageAvailable` is `false` when a language was supplied, or `undefined` when it was omitted.
No native `GetText(strFile, strKey, strLanguage, Tokens)` call is attempted for that missing key.

## Iterating A File View

`Entries()` and `Values()` call `Keys()` once and then construct one phrase view per key.
Each phrase-view constructor calls native `GetPhrase(strFile, strKey)`.
The iterator eagerly builds `Entries()` before returning its array iterator.
`ForEach(Callback, ThisArgument?)` also builds `Entries()` first, then invokes callbacks in key order.

```js
const { LangStrings } = require("translations/strings");

function CollectTranslationFileViews(strFileName) {
	const TranslationFile = new LangStrings(strFileName);
	const IterationState = { Visited: [] };
	const vecIteratedEntries = [];

	TranslationFile.ForEach(function VisitPhrase(PhraseView, strPhraseName, CurrentFile) {
		this.Visited.push({ SameCollection: CurrentFile === TranslationFile, PhraseView, PhraseName: strPhraseName });
	}, IterationState);

	for (const vecTranslationEntry of TranslationFile) {
		vecIteratedEntries.push(vecTranslationEntry);
	}

	return {
		Entries: TranslationFile.Entries(),
		IteratedEntries: vecIteratedEntries,
		Values: TranslationFile.Values(),
		Visited: IterationState.Visited,
	};
}
```

Every returned `TranslationStrings` remains a reusable view.
The arrays are separate owning collections, and repeated calls create different view objects even for the same key.
`ForEach` calls its callback synchronously with the requested receiver, ignores its return value, and does not await promises.
It invokes the function through `Reflect.apply`, without reading mutable `Callback.call` or `Callback.apply` properties.
Any thrown callback value, including `null` or `undefined`, propagates unchanged and stops the remaining visits.

## TranslationStrings

`new TranslationStrings(strFile, strKey, Tokens = {})` calls native `GetPhrase(strFile, strKey)` first.
It throws when the exact key is absent, then validates that `Tokens` is a non-null, non-array object.
The accepted token object is retained by identity.

| Member | Kind | Result |
| --- | --- | --- |
| `File` | field | Current file argument used by later native calls. |
| `Key` | field | Current exact phrase key used by later native calls. |
| `Tokens` | field | Base token object retained by identity. |
| `Record` | getter | Fresh phrase record; throws if the phrase has disappeared. |
| `Name` | getter | Current `Record.Name`. |
| `DefaultLanguage` | getter | Current `Record.DefaultLanguage`. |
| `Languages` | getter | Fresh current record mapping short language names to text. |
| `Size` | getter | Current `Object.keys(Languages).length`. |
| `Keys()` | method | Fresh current language-key array. |
| `Values()` | method | Fresh current language-text array. |
| `Entries()` | method | Fresh current `[strLanguage, strText]` array. |
| `Has(strLanguage?)` | method | Phrase membership or exact resolved-language membership. |
| `GetString(strLanguage?, Tokens?)` | method | Current selected text using merged base and per-call tokens. |
| `Tokenized(Tokens)` | method | New validated phrase view with a newly merged base-token object. |
| `[Symbol.iterator]()` | method | Iterator over a fresh `Entries()` array. |

The public `File`, `Key`, and `Tokens` fields are writable.
Changing `File` or `Key` defers validation to the next native call. Replacing `Tokens` bypasses constructor validation;
`GetString()` and `Tokenized()` do not revalidate that base field before copying it. Keep it a non-null, non-array object.
Prefer constructing a new view to keep identity clear.

Token merging copies own enumerable keys from base tokens first and per-call tokens second.
Reserved names such as `__proto__` remain data properties and cannot change the merged record's prototype.

## Inspecting A Phrase View

This workflow reads every phrase collection and returns both the reusable view and owning current values:

```js
const { TranslationStrings } = require("translations/strings");

function InspectTranslationPhraseView(strFileName, strPhraseName, strLanguage, Tokens = {}) {
	const PhraseView = new TranslationStrings(strFileName, strPhraseName);
	const vecIteratedEntries = [];
	for (const vecLanguageEntry of PhraseView) {
		vecIteratedEntries.push(vecLanguageEntry);
	}

	return {
		Entries: PhraseView.Entries(),
		IteratedEntries: vecIteratedEntries,
		Keys: PhraseView.Keys(),
		Values: PhraseView.Values(),
		HasLanguage: (strLanguage === undefined) ? undefined : PhraseView.Has(strLanguage),
		Languages: PhraseView.Languages,
		Record: PhraseView.Record,
		Tokens: PhraseView.Tokens,
		View: PhraseView,
		DefaultLanguage: PhraseView.DefaultLanguage,
		File: PhraseView.File,
		Key: PhraseView.Key,
		Name: PhraseView.Name,
		Text: PhraseView.GetString(strLanguage, Tokens),
		Size: PhraseView.Size,
	};
}
```

Every getter or collection call parses the phrase independently.
Use the returned `Record` or `Languages` owning record for internally consistent repeated reads.
Use `PhraseView` for later operations that must observe current phrase data.

## Token Ownership

`TranslationStrings.GetString(strLanguage, Tokens = {})` validates the per-call object.
It creates a shallow temporary object with object spread, copying own enumerable base-token keys first and per-call keys second.
Enumerable per-call names override matching base names.
The native root then converts token values to strings and replaces every matching placeholder.

`Tokenized(Tokens)` validates the overlay and uses object spread to copy its own enumerable keys over those of the current base tokens.
It constructs a new phrase view and revalidates the phrase immediately.
The new view owns the merged object; the source view continues to reference its original base object.
Both copies are shallow: object-valued tokens retain their original identity.

```js
const { TranslationStrings } = require("translations/strings");

function CreateTokenizedPhraseController(strFileName, strPhraseName, BaseTokens, OverlayTokens) {
	const BaseView = new TranslationStrings(strFileName, strPhraseName, BaseTokens);
	const TokenizedView = BaseView.Tokenized(OverlayTokens);

	return {
		BaseView,
		Read(strLanguage, CallTokens = {}) {
			return { BaseText: BaseView.GetString(strLanguage, CallTokens), TokenizedText: TokenizedView.GetString(strLanguage, CallTokens) };
		},
		TokenizedView,
	};
}
```

If `BaseTokens.FileName` changes later, `BaseView` observes it because the constructor retained that object.
`TokenizedView` keeps the value copied when `Tokenized()` ran.
`CallTokens.FileName` overrides either base for that one read.

## Consistency and Side Effects

- These calls are synchronous and can perform filesystem IO on the calling/game thread; they are not worker-backed `Options` + `Callback` requests.
- Every getter and collection method performs a new root-module operation; composed results can observe different file revisions.
- `LangStrings.Entries()`, `Values()`, iteration and `ForEach(Callback, ThisArgument?)` perform one key parse plus one phrase parse per current key.
- `LangStrings.Get(strKey)` can observe a key in `Has(strKey)` and then throw if the phrase disappears before constructor validation.
- Constructors and read methods can attempt best-effort language/server-override creation according to the root translation contract. Successful construction does not prove main-file readability or override creation.
- For one internally consistent parsed record, call `Data` once and derive values from that result.
  Do not mix independent getters for that operation. This is not a filesystem transaction.

## Errors and Lifetime

- Requiring the module without the SourceJS native runtime throws; there is no fallback.
- `LangStrings` construction rejects an invalid or empty file argument through native `LoadFile(strFile)`, but does not require an existing main file.
- `TranslationStrings` construction and `Record` throw when the exact phrase key is absent.
- The `TranslationStrings` constructor, `TranslationStrings.GetString(strLanguage?, Tokens?)`, and `TranslationStrings.Tokenized(Tokens)` reject `null`, arrays, or non-object tokens; a replaced base `Tokens` field is not revalidated.
- `LangStrings.ForEach(Callback, ThisArgument?)` rejects a non-function callback before parsing Entries.
- Language arguments retain the strict root-module string-or-`undefined` contract.
- `Has(strLanguage)` checks exact resolved-language availability; `GetString` can instead select the runtime default, phrase default, or fallback language through native `GetText`. A `false` language-membership result does not by itself mean text selection will fail.
- Views need no disposal and hold no native address. Returned records and arrays are independently owned JavaScript values.

## Common Mistakes

- Do not treat a sequence of getters as one parsed file record.
- Do not mutate `Data`, `Record`, or `Languages` expecting disk state to change.
- Do not retain `Entries()` when code needs later file edits; retain the view and call again.
- Do not assume `Tokenized()` shares the source base-token object; it stores a merged copy.
- Do not retarget public identity fields casually; create a new view for a new file or phrase.
- Match resource-defined placeholder names and language codes exactly; a differently cased token name does not replace the original placeholder.
- Do not add `set`, `delete`, `clear`, `toJSON`, or address compatibility helpers.

## Related Modules

- [`translations`](translations.md) documents native file format, path trust, selection, and process-wide state.
- [`translations/manager`](translations-manager.md) provides realtime language-registry and default-language views.
