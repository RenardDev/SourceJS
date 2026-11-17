# `require("translations/catalog")`

`RenderEnglish(Message)` renders the built-in English text without consulting any catalog. It accepts a phrase
record, a plain string, or a callback returning a string. The callback receives `null`.

`CreateTranslationCatalog(strDirectory)` creates a plugin-owned translator. Use a single directory name starting
with a lowercase ASCII letter and containing only lowercase ASCII letters, digits, and hyphens. The translator
lazily reads UTF-8 JSON phrase objects from
`<game>/resource/sourcejs/translations/<strDirectory>/<language>.json`.

```js
const { RenderEnglish, CreateTranslationCatalog } = require("translations/catalog");

const { Phrase, RenderPhrase, Translate } = CreateTranslationCatalog("my-plugin");

const Message = Phrase("RoundStart", "Round {Round} is starting.", { Round: 3 });
const unClientIndex = 2;
const strForClient = RenderPhrase(unClientIndex, Message);
const strForConsole = RenderEnglish(Message);
const strForServerChat = Translate(0, "Ready", "The server is ready.");
```

Language is selected for the receiving client, then falls back to the server default and the English text supplied
in the call. An explicitly English client receives English even when the server's default is different. The catalog
recognizes Steam language names and short codes, including regional variants. Use client index `0` to pick the
default language when there is no receiving client, not to force English for console output.

For each language, an optional `<language>.server.json` entry takes precedence over the shipped phrase. If the
override is missing, invalid, empty, or changes the set of named placeholders, the translator tries the shipped
translation before moving to the next fallback language. For `en`, it instead uses the built-in English text
when there is no valid `en.server.json` entry; it does not read phrases from the shipped English file for rendering.
Replacement values are inserted once and are not interpreted as more tokens. Pass through player-authored text
unchanged; do not make it a catalog key.

`RenderPhrase(unClientIndex, Message)` also accepts a plain string or a callback returning a string for that client.
Pass `null` to render the built-in English text regardless of the server default or local override. Callbacks receive
`null` for this mode. Use it for messages destined for the server or client console.

`ResetTranslations()` clears only this catalog's cache, including its cached server default. The stock plugins
reset their catalogs at map boundaries. Calls do not change the native translation registry.
