# `require("engines/sound")`

> Warning: this page documents the exact SourceJS runtime contract. Use the table of contents, and do not infer fallback stubs, universal DSP values, or APIs that the selected HL2SDK branch does not expose.

[`engines/sound`](../../packages/sourcejs/engines/sound.js) is a JavaScript package over the native sound module registered in [`ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp). Package functions prepare arguments before calling the native bindings for the selected Source 1 SDK's `IEngineSound`. `Sound` and `StreamSound` are higher-level helpers; their resource and playback contracts are described below.

Use this module when a plugin needs to inspect, precache, emit, route, or stop engine sounds. Use [messages](messages.md) for chat or HUD text and [effects](effects.md) for temporary entities.

Native sound calls dispatch synchronously and are confined to the game thread. Dedicated Redis/HTTP/SQL/socket request workers do not execute engine sound calls; invoke these APIs from game-thread callbacks while the relevant interfaces, map, and clients remain valid.

## Table of contents

- [Import and capabilities](#import-and-capabilities)
- [Exports](#exports)
- [Constants](#constants)
- [Resource operations](#resource-operations)
- [Emission and routing](#emission-and-routing)
- [Recipients and vectors](#recipients-and-vectors)
- [`Sound`](#sound)
- [`StreamSound`](#streamsound)
- [Lifecycle and safety](#lifecycle-and-safety)
- [Practical workflows](#practical-workflows)
- [Common mistakes](#common-mistakes)
- [Related modules](#related-modules)

## Import and capabilities

Import the package directly:

```js
const { EmitSound, PrecacheSound, StopSound } = require("engines/sound");
```

After successful package loading, the module object provides 19 unconditional package exports. Export presence does not establish runtime interface readiness or argument validity: package validation may fail before a native call, and native calls requiring an unavailable `IEngineSound` interface throw an error. Two additional functions are selected-SDK capability-dependent:

- `IsLoopingSound` exists only when `IEngineSound::IsLoopingSound` is declared by the selected SDK.
- `PrecacheSoundSentenceGroup` exists only when `IEngineSound::PrecacheSentenceGroup` is declared by the selected SDK.

Check the property before using a capability-dependent operation:

```js
const { IsLoopingSound } = require("engines/sound");
const { LogInfo } = require("loggers");

if (typeof IsLoopingSound !== "function") {
	throw new Error("This SDK does not expose IEngineSound::IsLoopingSound.");
}

const g_bLoops = IsLoopingSound("ambient/alarms/klaxon1.wav");
LogInfo("%j", { Operation: "IsLoopingSound", Sample: "ambient/alarms/klaxon1.wav", Loops: g_bLoops });
```

For the two capability-dependent functions above, an absent capability is an absent JavaScript property. Unconditional functions remain present, but package validation may reject arguments before native interface checks. Export presence is not proof that a call can succeed.

## Exports

The complete possible surface contains 21 exports. Nineteen are always present; the two marked **capability** are omitted when the SDK declaration is absent.

| Export | Kind | Contract |
| --- | --- | --- |
| [`Attenuation`](#attenuation) | Namespace | Canonical attenuation constants. |
| [`Channel`](#channel) | Namespace | Engine sound-channel constants. |
| `MAX_ATTENUATION` | Number | Exported value `3.98`. Native `EmitSound` requires supplied attenuation to convert to a finite, native-float-range value; it does not enforce this constant as a maximum. |
| [`Pitch`](#pitch) | Namespace | Normal, low, and high pitch constants. |
| `SOUND_FROM_LOCAL_PLAYER` | Number | Entity sentinel for recipient-local playback. |
| `SOUND_FROM_WORLD` | Number | World entity index used for non-entity sound. |
| [`SoundFlags`](#soundflags) | Namespace | Bit flags passed to sound emission. |
| `VOL_NORM` | Number | Normal volume, `1`. |
| [`Sound`](#sound) | Class | Mutable plugin-owned playback configuration. |
| [`StreamSound`](#streamsound) | Class | `Sound` variant whose precache method adds the `*/`-prefixed engine sample to `soundprecache`. |
| [`PrecacheSound(strSample, bPreload = false, bUISound = false)`](#precachesound) | Function | Calls `IEngineSound::PrecacheSound`; returns its boolean result. |
| `IsSoundPrecached(strSample)` | Function | Reads current engine precache state. |
| `PrefetchSound(strSample)` | Function | Calls `IEngineSound::PrefetchSound`, discards its SDK result, and returns `true` after dispatch. |
| [`IsLoopingSound(strSample)`](#isloopingsound) | Function, **capability** | Reads loop metadata and returns a boolean. |
| `GetSoundDuration(strSample)` | Function | Returns engine-reported duration in seconds. |
| `EmitSound(Options)` | Function | Copies the options object and normalizes its sample before native emission; `true` reports dispatch, not audibility or completion. |
| [`StopSound(Options)`](#stopsound) | Function | Copies the options object and normalizes its sample before native stop dispatch; `true` does not prove a matching sound existed or stopped. |
| `SetSoundRoomType(Recipients, nRoomType, bReliable = false)` | Function | Routes an integer room type, discards the SDK result, and returns `true` after dispatch. |
| `SetPlayerDSP(Recipients, nDSPType, bFastReset = false)` | Function | Routes an integer DSP preset, discards the SDK result, and returns `true` after dispatch. |
| [`GetDistanceGainFromSoundLevel(nSoundLevel, flDistance)`](#getdistancegainfromsoundlevel) | Function | Requires a primitive signed 32-bit integer `nSoundLevel` from `0` through `255` and a distance converting to a finite native-range float. Returns `IEngineSound::GetDistGainFromSoundLevel` unchanged. |
| [`PrecacheSoundSentenceGroup(strGroupName)`](#precachesoundsentencegroup) | Function, **capability** | Normalizes a nonempty group name before native precache dispatch. The package rejects a missing argument; it does not expose the native callback's no-argument `undefined` result. Native dispatch returns `true`, not loading completion; unavailable `IEngineSound` reports an error. If exposed on Dark Messiah, the callback reports unsupported operation. |

Package sample and sentence-group arguments must be nonempty primitive strings; backslashes are normalized to forward slashes. Native operations also require a nonempty UTF-8 prefix before the first NUL; JavaScript nonemptiness alone does not satisfy that requirement. Numeric representation checks, optional defaults, and null handling depend on the operation, as detailed below. Native-float conversion also checks float range; representation checks do not validate SDK-specific sound levels, room types, or DSP presets.

## Constants

The top-level scalar constants, the `Channel`, `Attenuation`, `SoundFlags`, and `Pitch` records, and all entries in those records are own writable, enumerable, configurable data properties. Their installation does not invoke inherited setters; all four records retain ordinary object prototypes. Established uppercase names and published numeric values are preserved.

### `Channel`

| Member | Value | Typical use |
| --- | ---: | --- |
| `REPLACE` | `-1` | Replace an existing sound selected by the engine. |
| `AUTO` | `0` | Let the engine select the channel. |
| `WEAPON` | `1` | Weapon fire and weapon mechanisms. |
| `VOICE` | `2` | Character voice playback. |
| `ITEM` | `3` | Item and UI-like entity sounds. |
| `BODY` | `4` | Body and movement sounds. |
| `STREAM` | `5` | Streamed audio. |
| `STATIC` | `6` | Static or ambient world sound. |
| `VOICE_BASE` | `7` | Current binding value, not a portable network-voice boundary: the pinned TF2 SDK defines `CHAN_VOICE_BASE` as `8`. |
| `USER_BASE` | `135` | Current binding value, not a portable user-channel boundary: the pinned TF2 SDK defines `CHAN_USER_BASE` as `136`. |

### `Attenuation`

| Member | Value | Meaning |
| --- | ---: | --- |
| `NONE` | `0` | No distance attenuation. |
| `GUNFIRE` | `0.27` | Long-range gunfire attenuation. |
| `NORMAL` | `0.8` | Ordinary positional sound. |
| `STATIC` | `1.25` | Static world sound. |
| `RICOCHET` | `1.5` | Shorter-range impact sound. |
| `IDLE` | `2` | Short-range idle sound. |
| `MAXIMUM` | `3.98` | Maximum attenuation. |

`MAX_ATTENUATION` is also `3.98`. These exported constants do not cause `EmitSound` to reject attenuation above that value; choose attenuation supported by the target engine.

| Use | Example |
| --- | --- |
| Apply the module constant as a plugin's own limit for a validated nonnegative setting. Import it from `engines/sound`. | `const flAttenuation = Math.min(flConfiguredAttenuation, MAX_ATTENUATION);` |

### `Pitch`

| Member | Value |
| --- | ---: |
| `NORMAL` | `100` |
| `LOW` | `95` |
| `HIGH` | `120` |

### `SoundFlags`

| Member | Value | Purpose |
| --- | ---: | --- |
| `NO_FLAGS` | `0` | Ordinary emission. |
| `CHANGE_VOLUME` | `1` | Change the volume of a matching active sound. |
| `CHANGE_PITCH` | `2` | Change the pitch of a matching active sound. |
| `STOP` | `4` | Stop a matching sound through the engine flag path. |
| `SPAWNING` | `8` | Emission occurs during entity spawning. |
| `DELAY` | `16` | Sound has an initial delay, as described by the target SDK. |
| `STOP_LOOPING` | `32` | In the TF2 SDK, stop all looping sounds on the entity; not a request to finish the current loop first. |
| `SPEAKER` | `64` | In the TF2 SDK, sound replayed by a microphone through a speaker. |
| `SHOULD_PAUSE` | `128` | Sound should pause with the game. |
| `IGNORE_PHONEMES` | `256` | Ignore phoneme processing. |
| `IGNORE_NAME` | `512` | In the TF2 SDK, change all sounds emitted by an entity regardless of script name. |

Flags are bit values and may be combined with `|`; choose a combination meaningful for the target operation and SDK:

```js
const { SoundFlags } = require("engines/sound");

const g_unUpdateFlags = SoundFlags.CHANGE_VOLUME | SoundFlags.CHANGE_PITCH;
```

Standalone entity sentinels and the normal-volume constant are:

```js
const { SOUND_FROM_LOCAL_PLAYER, SOUND_FROM_WORLD, VOL_NORM } = require("engines/sound");
const { LogInfo } = require("loggers");

LogInfo("%j", { Operation: "SoundConstants", SoundFromLocalPlayer: SOUND_FROM_LOCAL_PLAYER, SoundFromWorld: SOUND_FROM_WORLD, VolumeNormal: VOL_NORM });
```

## Resource operations

### `PrecacheSound`

```js
const { PrecacheSound } = require("engines/sound");

const g_bPrecached = PrecacheSound("ui/buttonclick.wav", true, true);
if (!g_bPrecached) {
	throw new Error("The engine rejected ui/buttonclick.wav.");
}
```

Call during the target engine's permitted precache phase. `bPreload` requests immediate loading; a successful precache result is not client download or playback confirmation. `bUISound` marks a UI sound when the selected SDK exposes that native parameter; older overloads ignore the validated flag. Omitted or `undefined` flags default to `false`; supplied `null` is rejected. The package normalizes backslashes in a nonempty sample string, but does not add a download entry.

### `IsSoundPrecached`, `PrefetchSound`, and `GetSoundDuration`

```js
const { GetSoundDuration, IsSoundPrecached, PrecacheSound, PrefetchSound } = require("engines/sound");

const g_strSample = "ambient/alarms/klaxon1.wav";
if (!IsSoundPrecached(g_strSample) && !PrecacheSound(g_strSample, false, false)) {
	throw new Error(`Unable to precache sound: ${g_strSample}.`);
}

PrefetchSound(g_strSample);

const g_flDurationSeconds = GetSoundDuration(g_strSample);
if (!Number.isFinite(g_flDurationSeconds) || (g_flDurationSeconds <= 0)) {
	throw new Error(`No usable positive duration metadata for ${g_strSample}.`);
}
```

Use the example during a permitted resource-loading phase. `PrefetchSound` returns `true` after native dispatch; it provides neither completion status nor a promise to await. `GetSoundDuration` returns the engine's duration without validating finiteness or positivity and does not parse WAV or MP3 files in JavaScript. The example rejects unusable timing metadata; a positive duration still does not prove playback readiness or completion.

Native C++ failures while preparing or dispatching `PrecacheSound`, `IsSoundPrecached`, `PrefetchSound`, `IsLoopingSound`, `GetSoundDuration`, `EmitSound`, `StopSound`, `SetSoundRoomType`, `SetPlayerDSP`, `GetDistanceGainFromSoundLevel`, and an available `PrecacheSoundSentenceGroup` become operation-specific JavaScript errors. They do not escape the V8 callback boundary or become successful results.

### `IsLoopingSound`

```js
const { IsLoopingSound } = require("engines/sound");
const { LogInfo } = require("loggers");

const g_strSample = "ambient/alarms/klaxon1.wav";

if (typeof IsLoopingSound !== "function") {
	throw new Error("This SDK does not expose IEngineSound::IsLoopingSound.");
}

const g_bLoops = IsLoopingSound(g_strSample);
LogInfo("%j", { Operation: "IsLoopingSound", Loops: g_bLoops, Sample: g_strSample });
```

## Emission and routing

### Options-object `EmitSound`

SourceJS selects the attenuation-based `IEngineSound::EmitSound` signature declared by the SDK, without selecting by game name. When the signature also requires sound-entry metadata, SourceJS submits the sample path as a raw sound file, not as a soundscript entry. A `true` result confirms that SourceJS called the engine, not that a client played the sample.

```js
const {
	Attenuation,
	Channel,
	EmitSound,
	Pitch,
	SOUND_FROM_WORLD,
	SoundFlags,
} = require("engines/sound");

const g_vecOriginComponents = [512, -128, 96];
if (!EmitSound({
	Origins: [],
	Reliable: false,
	UpdatePositions: true,
	Attenuation: Attenuation.STATIC,
	SoundTime: 0,
	Volume: 0.8,
	Channel: Channel.STATIC,
	Pitch: Pitch.NORMAL,
	SpeakerEntity: -1,
	Sample: "ambient/alarms/klaxon1.wav",
	Flags: SoundFlags.NO_FLAGS,
	Direction: null,
	Entity: SOUND_FROM_WORLD,
	Origin: g_vecOriginComponents,
	Recipients: null,
})) {
	throw new Error("World klaxon emission call did not report success.");
}
```

Run this example only with the sample already precached, the position valid for the current map, and playback to the current human recipients intended. A `true` result reports native dispatch, not audibility or playback completion.

The complete options object is:

| Property | Default | Accepted value |
| --- | --- | --- |
| `Sample` | Required | Nonempty primitive sample string; the package normalizes backslashes and the native UTF-8 string ends at the first NUL. A nonempty native prefix is required. |
| `Recipients` | `undefined` | `null`/`undefined` for every connected human player, positive player index, player object, array of either, or recipient-filter object with `RecipientIndexes`. |
| `Entity` | `SOUND_FROM_WORLD` | `null`/`undefined`, signed 32-bit entity index, or index-bearing entity object resolving to a nonnegative index. Numeric conversion does not establish entity liveness; use only SDK-supported indices or sentinels. |
| [`Channel`](#channel) | `Channel.AUTO` | Signed 32-bit channel. |
| `Volume` | `VOL_NORM` | Value converting to a finite native-range float; no volume-domain bounds are enforced. Nullish selects the default. |
| [`Attenuation`](#attenuation) | `Attenuation.NONE` | Value converting to a finite native-range float; no attenuation-domain bounds are enforced. Nullish selects the default. |
| `Flags` | `SoundFlags.NO_FLAGS` | Signed 32-bit bit mask. |
| [`Pitch`](#pitch) | `Pitch.NORMAL` | Signed 32-bit pitch. |
| `Origin` | Absent | `null`/`undefined` or a component array/object; see component conversion below. |
| `Direction` | Absent | `null`/`undefined` or a component array/object; see component conversion below. |
| `Origins` | Absent | `null`/`undefined` or array of component arrays/objects, each exposing at least one accepted component. |
| `UpdatePositions` | `true` | Boolean; nullish selects the default. |
| `SoundTime` | `0` | Value converting to a finite native-range float for engine sound time; nullish selects the default. |
| `SpeakerEntity` | `-1` | Signed 32-bit entity index; nullish selects the default. No entity-object conversion. |
| `Reliable` | `false` | Boolean recipient-filter reliability; nullish selects the default. |

Before native parsing, `EmitSound` and `StopSound` shallow-copy all own enumerable option properties, invoking their getters in enumeration order, then read `Sample` again from the original object for normalization. Enumerable `Sample` is therefore read twice. Other inherited or non-enumerable option properties are not copied; the explicit `Sample` lookup is the exception. Even unused enumerable properties are read, and a throwing copy or sample getter aborts before native dispatch. Nested objects and arrays remain shared references.

After copying, native parsing stops at the first failing property lookup. Errors from nested recipient properties or an entity object's `Index` getter propagate unchanged instead of becoming a type diagnostic. During emission or stop entity selection, a pending JavaScript error also survives native C++ unwinding; a native failure without a pending JavaScript error becomes an operation-specific error. Nullish defaults apply only after a successful property lookup, never as a fallback for a throwing getter.

Non-nullish `Channel`, `Flags`, `Pitch`, and `SpeakerEntity` require primitive Number values that are exact signed 32-bit integers, not values coerced through `ToInt32`. Nullish values select their documented defaults.

Vector arrays read indices `0`/`1`/`2`; objects read `X`/`Y`/`Z`, falling back per nullish component to `Pitch`/`Yaw`/`Roll`. Present components convert to finite native-range floats; missing components become zero. At least one component must be present to produce a vector. For optional origin/direction, a primitive or component-free value is currently treated as absent; each `Origins` entry instead rejects an absent vector. Supply explicit numeric components rather than relying on coercion or silent omission.

Explicit recipient indexes, player objects, arrays, and recipient filters can include bots. The nullish recipient form deliberately selects human players only.

### `StopSound`

Stopping dispatches the `(Entity, Channel, Sample)` identity to the engine; use the same emitter, channel, and sample as the emission to target that sound:

```js
const { Channel, SOUND_FROM_WORLD, StopSound } = require("engines/sound");

if (!StopSound({
	Channel: Channel.STATIC,
	Sample: "ambient/alarms/klaxon1.wav",
	Entity: SOUND_FROM_WORLD,
})) {
	throw new Error("World klaxon stop call did not report success.");
}
```

Pass one options object to `StopSound`. The package copies it, normalizes `Sample`, and forwards exactly one object to the native callback; extra package-call arguments are not forwarded. The sample requires a nonempty native string prefix as for `EmitSound`. Nullish `Entity` uses `SOUND_FROM_WORLD`, and nullish `Channel` uses `Channel.AUTO`; non-nullish values follow the emission entity/channel rules. A `true` result reports dispatch, not that a matching playing sound was found or stopped.

Changing any one of the three values can leave the original sound playing.

### `SetSoundRoomType` and `SetPlayerDSP`

Room and DSP preset values are signed 32-bit, game-specific engine data. SourceJS does not define a universal preset enum across SDK branches. Both functions require recipients and a preset; their optional third boolean defaults to `false` when omitted or `undefined`, but rejects `null`. Run this example only when client 1 is connected and both preset changes are intended. Preset `0` has no universal meaning across games:

```js
const { SetPlayerDSP, SetSoundRoomType } = require("engines/sound");

const g_vecRecipientIndexes = [1];
if (!SetSoundRoomType(g_vecRecipientIndexes, 0, true) || !SetPlayerDSP(g_vecRecipientIndexes, 0, true)) {
	throw new Error("Room or DSP preset call did not report success for client 1.");
}
```

The recipient argument accepts the same forms as `EmitSound`; nullish recipients select all connected human players. `bReliable` belongs to `SetSoundRoomType`. `SetPlayerDSP` always builds an unreliable recipient filter, and its third parameter is `bFastReset`. Both bindings report `true` after dispatch, not client receipt or completion. The example short-circuits if the room call fails; if the DSP call then fails, the room change is not rolled back.

### `GetDistanceGainFromSoundLevel`

`GetDistanceGainFromSoundLevel(nSoundLevel, flDistance)` requires an integer sound level from 0 through 255 and a distance converting to a finite native-range float. Unnamed values within the SDK's regular sound-level range are valid; GoldSrc attenuation encodings (256 through 511) are rejected before conversion to `soundlevel_t`. Distance validation precedes the range check and does not require a nonnegative distance. The binding returns the engine's raw gain without validating finiteness or bounds; validate the result before clamping it to a receiving API's volume range:

```js
const {
	Attenuation,
	Channel,
	EmitSound,
	GetDistanceGainFromSoundLevel,
	Pitch,
	SOUND_FROM_WORLD,
	SoundFlags,
} = require("engines/sound");

const g_flGain = GetDistanceGainFromSoundLevel(75, 512);
if (!Number.isFinite(g_flGain)) {
	throw new Error("Distance gain is not finite.");
}

const g_flVolume = Math.max(0, Math.min(1, g_flGain));
if (!EmitSound({
	Attenuation: Attenuation.NORMAL,
	Volume: g_flVolume,
	Channel: Channel.STATIC,
	Pitch: Pitch.NORMAL,
	Sample: "ambient/alarms/klaxon1.wav",
	Flags: SoundFlags.NO_FLAGS,
	Entity: SOUND_FROM_WORLD,
	Origin: [0, 0, 64],
})) {
	throw new Error("Attenuated world sound emission call did not report success.");
}
```

Run this example only after precaching the sample, with a valid map position and intended human recipients. The calculated gain scales the base volume using the example distance `512`; `Attenuation.NORMAL` still applies engine attenuation for each recipient. This is not a per-recipient distance calculation. The return value confirms dispatch only.

### `PrecacheSoundSentenceGroup`

`PrecacheSoundSentenceGroup` is a conditional export gated by the selected SDK's `IEngineSound::PrecacheSentenceGroup` capability. Export presence alone does not prove runtime support: the Dark Messiah callback rejects the operation, and other branches require an available engine sound interface. The caller must separately verify the group name and permitted precache phase for the active game:

```js
const { PrecacheSoundSentenceGroup } = require("engines/sound");

function PrecacheVerifiedSentenceGroup(strGroupName) {
	if (typeof PrecacheSoundSentenceGroup !== "function") {
		throw new Error("This SDK does not expose IEngineSound::PrecacheSentenceGroup.");
	}

	return PrecacheSoundSentenceGroup(strGroupName);
}
```

The argument must be a nonempty primitive sentence-group string with a nonempty native UTF-8 prefix before any NUL. The package normalizes `\` to `/`; a successful native call reports `true` without confirming group existence or loading completion. `PrecacheVerifiedSentenceGroup` only checks export availability: its caller must already have verified the group and precache phase, and must handle a thrown error or unsuccessful result. Do not pass a sound-script entry or file path where the engine expects a sentence-group name.

## Recipients and vectors

Recipient arguments accept:

- `null` or `undefined` to collect all currently connected human players;
- one positive signed 32-bit player index;
- one index-bearing object with a positive signed 32-bit `Index` (a live player wrapper is the usual form);
- an array of positive indexes or player objects;
- a recipient-filter object whose `RecipientIndexes` property is an array.

Explicit recipient forms can include connected bots. Collection removes duplicates and silently omits positive indexes that do not resolve to connected players with valid, non-free edicts. Index validation alone does not establish player liveness. A non-nullish `RecipientIndexes` must be an array and takes precedence over an object's `Index`; a nullish property falls back to the index-bearing object form. Each selected filter property and array entry is read once; each selected recipient occurrence resolves its player index once into a validated numeric snapshot before SDK eligibility filtering. Repeating an object in multiple entries can therefore invoke its `Index` getter multiple times. Getter exceptions propagate unchanged, and parsing failure leaves the native output unchanged. This snapshot does not retain player objects or pin a connection's lifetime across later option getters or engine operations.

An explicit empty array means no recipients. It does not become broadcast-all:

```js
const { Channel, EmitSound } = require("engines/sound");

if (!EmitSound({
	Channel: Channel.AUTO,
	Sample: "ui/buttonclick.wav",
	Entity: 0,
	Recipients: [],
})) {
	throw new Error("The empty-recipient sound request failed.");
}
```

An empty filter therefore avoids accidental broadcast when no players match. The call still performs argument validation and native dispatch; it is not a dry run or a substitute for engine readiness and precaching the sample.

For a reusable filter, import it directly. Use current, intended player indexes and a precached sample; the sound call reads the filter's current `RecipientIndexes`, not a promise of future recipients:

```js
const { RecipientFilter } = require("filters/recipients");
const { Channel, EmitSound } = require("engines/sound");

const g_VoiceRecipientFilter = new RecipientFilter([1, 2], { Reliable: true });
if (!EmitSound({
	Reliable: g_VoiceRecipientFilter.IsRecipientFilterReliable(),
	Channel: Channel.VOICE,
	Sample: "ui/buttonclick.wav",
	Entity: 0,
	Recipients: g_VoiceRecipientFilter,
})) {
	throw new Error("Filtered voice sound emission call did not report success.");
}
```

`Recipients` reads the filter's indexes, not its reliability flag. Copy `IsRecipientFilterReliable()` into `Reliable` explicitly, as shown above.

`Origin`, `Direction`, and each `Origins` entry use the component conversion described in the `EmitSound` options table: array indices `0`/`1`/`2` or object keys `X`/`Y`/`Z` with per-component `Pitch`/`Yaw`/`Roll` fallbacks. Present values must convert to finite native-range floats. A `mathlib.Vector` can be passed directly through its `X`/`Y`/`Z` getters while its backing storage remains valid; `ConvertMathStructureToArray()` is an explicit component-snapshot alternative. Component reads can throw, and native conversion still checks float range. Missing components become zero when at least one component is present; optional component-free vectors become absent, whereas each `Origins` entry must contain a component.

The native `Origins` parser rejects an array length that cannot leave room for the SDK's capacity doubling within both its signed element count and the platform's address-sized byte range. This check runs before reading elements or allocating origin storage. It prevents arithmetic overflow, not memory exhaustion; smaller arrays still depend on available memory. Getter or validation failures before the final copy leave the caller's existing origin list unchanged; the helper does not provide a general allocation-failure recovery guarantee.

## `Sound`

`Sound` is a mutable JavaScript sound configuration object, not a live native sound instance or owner of an active engine channel. Construction can register a download when `Download` is enabled; it is not always side-effect-free.

### Constructor

```js
const { Sound } = require("engines/sound");
const { LogInfo } = require("loggers");

const g_NotificationSound = new Sound("ui/buttonclick.wav");
LogInfo("%j", { Operation: "CreateSound", Sample: g_NotificationSound.EngineSample });
```

The constructor requires a nonempty primitive sample string, normalizes `\` to `/`, and accepts an optional non-array options object (`undefined` selects `{}`, but `null` is rejected). Scalar validators require actual booleans, finite numbers, or signed 32-bit integers, with nullish scalar properties selecting defaults. `Origins` defaults to `[]` only when `undefined`; `null` is rejected. Vector contents and recipients are stored without validation, and arrays/objects remain shared references rather than snapshots. Native float-range and component/recipient checks occur during playback. With `Download: true`, construction calls `DOWNLOADABLES.Add(RelativePath)` after validation. That operation returns the tracker, not a boolean status. Adding an untracked path requires a valid native string-table index and otherwise throws; an already tracked path returns without a fresh native registration. Construction does not confirm client download.

| Field | Default | Meaning |
| --- | --- | --- |
| `Sample` | Required | Non-empty normalized sample without an automatic `sound/` prefix. |
| `Entity` | `SOUND_FROM_WORLD` | Signed 32-bit emitter index; unlike native `EmitSound`, the constructor does not accept an entity object. |
| `Volume` | `VOL_NORM` | Finite JavaScript number for emission volume; constructor validation does not enforce native float range or volume bounds. |
| [`Attenuation`](#attenuation) | `Attenuation.NONE` | Finite JavaScript number for distance attenuation; constructor validation does not enforce native float range or attenuation bounds. |
| [`Channel`](#channel) | `Channel.AUTO` | Signed 32-bit engine channel. |
| `Flags` | `SoundFlags.NO_FLAGS` | Signed 32-bit sound flags. |
| [`Pitch`](#pitch) | `Pitch.NORMAL` | Signed 32-bit pitch. |
| `Origin` | `null` | Stored origin value, converted by the native binding when played; component-free values can become absent. |
| `Direction` | `null` | Stored direction value, converted by the native binding when played; component-free values can become absent. |
| `Origins` | `[]` | Shared additional-origin array; the constructor checks only array shape, and the native binding requires a present vector for each entry when played. |
| `UpdatePositions` | `true` | Boolean controlling emitter position updates. |
| `SoundTime` | `0` | Finite JavaScript number for engine sound time; native float range is checked on playback, not construction. |
| `SpeakerEntity` | `-1` | Signed 32-bit optional speaker entity index. |
| `Recipients` | `null` | Default recipients used by `PlaySound()`; nullish selects every connected human player. |
| `Reliable` | `false` | Boolean copied into the native recipient filter. |
| `Preload` | `false` | Boolean passed to `PrecacheSound()`. |
| `UISound` | `false` | Boolean passed to `PrecacheSound()`. |
| `Download` | `false` | Calls `DOWNLOADABLES.Add(RelativePath)` when true. A failed first registration throws; an already tracked path may skip native registration. Neither case confirms client download. |

### Getters

| Getter | Result |
| --- | --- |
| `EngineSample` | Sample passed to `IEngineSound`; equal to `Sample` for `Sound`. |
| `RelativePath` | Normalized sample unchanged when it already starts with `sound/`; otherwise the sample with `sound/` prepended. |
| `Duration` | Current native `GetSoundDuration(EngineSample)` result. |
| `Precached` | Current native `IsSoundPrecached(EngineSample)` result. |

The getters are evaluated on access, not constructor snapshots. `Duration` and `Precached` call the engine and can throw; neither is a stored playback state.

### Methods

| Method | Behavior |
| --- | --- |
| [`PrecacheSound()`](#precachesound) | Calls `PrecacheSound(EngineSample, Preload, UISound)`. |
| `PlaySound(Recipients = this.Recipients)` | Checks `Precached`, calls `PrecacheSound()` when false, then returns `EmitSound()` with current emission fields and selected recipients. Omitted/`undefined` uses the stored recipients; explicit `null` selects current human recipients instead. |
| [`StopSound(nEntityIndex = this.Entity, nChannel = this.Channel)`](#stopsound) | Dispatches `StopSound()` using the current sample and selected entity/channel, returning its result without confirming a matching playing sound. Omitted/`undefined` parameters use the stored fields. |

`PlaySound()` does not inspect the boolean returned by its automatic `PrecacheSound()` call; it proceeds to `EmitSound()` either way. Its `true` result confirms native dispatch, not that a client received or played the sample. Call `PrecacheSound()` explicitly when its engine result matters.

### Managed playback

```js
const {
	Attenuation,
	Channel,
	Pitch,
	SOUND_FROM_WORLD,
	Sound,
	SoundFlags,
} = require("engines/sound");
const { Vector } = require("mathlib");

const g_AlarmSound = new Sound("ambient/alarms/klaxon1.wav", {
	Origins: [],
	Download: true,
	Preload: true,
	Reliable: true,
	UISound: false,
	UpdatePositions: true,
	Attenuation: Attenuation.STATIC,
	SoundTime: 0,
	Volume: 0.65,
	Channel: Channel.STATIC,
	Entity: SOUND_FROM_WORLD,
	Pitch: Pitch.NORMAL,
	SpeakerEntity: -1,
	Flags: SoundFlags.NO_FLAGS,
	Direction: null,
	Origin: new Vector(256, 128, 72),
	Recipients: [1],
});
if (!g_AlarmSound.PrecacheSound()) {
	throw new Error(`Unable to precache ${g_AlarmSound.EngineSample}.`);
}

const g_flDurationSeconds = g_AlarmSound.Duration;
if (!Number.isFinite(g_flDurationSeconds) || (g_flDurationSeconds <= 0)) {
	throw new Error(`Engine did not report a usable positive duration for ${g_AlarmSound.EngineSample}.`);
}

const g_vecPlaybackErrors = [];
let g_bHasDispatchedSound = false;

try {
	g_bHasDispatchedSound = g_AlarmSound.PlaySound();
	if (!g_bHasDispatchedSound) {
		throw new Error(`Unable to dispatch ${g_AlarmSound.EngineSample}.`);
	}

	g_AlarmSound.Volume = 0.35;
	g_AlarmSound.Flags = SoundFlags.CHANGE_VOLUME;
	if (!g_AlarmSound.PlaySound()) {
		throw new Error(`Unable to update ${g_AlarmSound.EngineSample} volume.`);
	}
} catch (PlaybackError) {
	g_vecPlaybackErrors.push(PlaybackError);
} finally {
	if (g_bHasDispatchedSound) {
		try {
			if (!g_AlarmSound.StopSound()) {
				throw new Error(`Stop call did not report success for ${g_AlarmSound.EngineSample}.`);
			}
		} catch (StopError) {
			g_vecPlaybackErrors.push(StopError);
		}
	}
}

if (g_vecPlaybackErrors.length === 1) {
	throw g_vecPlaybackErrors[0];
}

if (g_vecPlaybackErrors.length > 1) {
	throw new AggregateError(g_vecPlaybackErrors, "Sound playback and stop both failed.");
}
```

Mutating a field changes the next `PlaySound()` call. It does not silently update a sound already playing; use matching engine flags or stop/re-emit as appropriate for the selected game.

Run the preceding example only in a permitted precache/download-registration phase, with client 1 connected, the sample available, and the origin valid for the active map. It immediately emits, changes volume, and stops in one synchronous sequence; it is a lifecycle demonstration, not a timed audible alarm. A positive duration is not a delivery guarantee. Cleanup is attempted only after the initial call reports successful dispatch; an exception after a native side effect does not prove ownership of that effect. Keep the sample/entity/channel identity unchanged until stopping; otherwise cleanup can target a different sound.

## `StreamSound`

`StreamSound` inherits `Sound` state and behavior, overriding two operations:

- `EngineSample` is `*/${Sample}`.
- `PrecacheSound()` calls `AddString("soundprecache", EngineSample)` and returns whether its result is nonnegative. It does not use `Preload` or `UISound`, and a successful table result does not confirm client download or playback.

Use a game-supported streaming sample and permitted string-table update phase. This example requires intended, connected client 1 and an available sample; the path is illustrative, not a file supplied by every game.

```js
const { Channel, StreamSound } = require("engines/sound");

const g_MusicStream = new StreamSound("music/flu/jukebox/all_i_want_for_xmas.wav", {
	Download: true,
	Volume: 0.5,
	Channel: Channel.STREAM,
	Recipients: [1],
});
if (!g_MusicStream.PrecacheSound()) {
	throw new Error(`Could not register ${g_MusicStream.EngineSample}.`);
}

let g_bSoundDispatched = false;

try {
	g_bSoundDispatched = g_MusicStream.PlaySound();
	if (!g_bSoundDispatched) {
		throw new Error(`Could not dispatch ${g_MusicStream.EngineSample}.`);
	}
} finally {
	if (g_bSoundDispatched && !g_MusicStream.StopSound()) {
		throw new Error(`Could not stop ${g_MusicStream.EngineSample}.`);
	}
}
```

This synchronous example stops immediately after confirmed dispatch; it does not wait for the track to finish. If playback throws or returns false, the example does not attempt a stop because dispatch was not confirmed. Successful dispatch and stop results do not prove client playback. `StreamSound` does not add a universal media decoder: the file and codec must be supported by the selected game engine.

## Lifecycle and safety

- `engines/sound` callbacks invoke the SDK synchronously during the current JavaScript call. Do not perform long loops of resource or playback calls in one tick.
- `Sound` and `StreamSound` are plugin-context JavaScript configuration objects, not native playback handles. These classes provide no cross-plugin transfer operation.
- `Download: true` calls the plugin-owned `DOWNLOADABLES` tracker. Failure to register a new path throws; an already tracked path may skip a fresh native call. Successful construction does not prove that a previously tracked native entry still exists or that a client downloaded the file.
- `StreamSound.PrecacheSound()` requires the `soundprecache` network string table and a permitted update phase. Table existence alone does not establish that an update is safe for the active game.
- Precache resources in the active game's permitted initialization/precache phase, not repeatedly in a hot tick listener. A plugin initialization callback alone is not proof of an engine precache window.
- Preserve the same entity, channel, and sample when calling `StopSound()`.
- Treat room/DSP values and sentence groups as selected-game data.
- An explicit empty recipient list is intentionally silent; `null`/`undefined` means all connected human players.
- The classes validate the sample, options shape, scalar fields, and initial origin-list array shape in the constructor, but their fields remain mutable JavaScript. Later calls apply their own package/native conversion rules, not the constructor's exact validation contract. Optional vectors can silently become absent, and numerically valid entity indexes do not prove liveness.

## Practical workflows

### Prewarm a map sound once

Run once in the active game's permitted precache phase, with an available sample. Prefetch submits a request rather than waiting for completion; duration and looping queries are metadata, not proof that clients can play the sound.

```js
const {
	GetSoundDuration,
	IsLoopingSound,
	IsSoundPrecached,
	PrecacheSound,
	PrefetchSound,
} = require("engines/sound");
const { LogInfo } = require("loggers");

const g_strSample = "ambient/alarms/klaxon1.wav";
if (!IsSoundPrecached(g_strSample) && !PrecacheSound(g_strSample, true, false)) {
	throw new Error(`Unable to precache sound: ${g_strSample}.`);
}

PrefetchSound(g_strSample);

const g_flDurationSeconds = GetSoundDuration(g_strSample);
if (!Number.isFinite(g_flDurationSeconds) || (g_flDurationSeconds <= 0)) {
	throw new Error(`No usable positive duration metadata for ${g_strSample}.`);
}

LogInfo("%j", { Operation: "PrewarmSound", Sample: g_strSample, Looping: (typeof IsLoopingSound === "function") ? IsLoopingSound(g_strSample) : null, DurationSeconds: g_flDurationSeconds });
```

### Play privately for one connected player

Use a precached sample and the intended current player index. Do not retain the player wrapper across disconnects or map changes; the connected-state check is a current observation, not a lifetime guarantee.

```js
const { Player } = require("players/entity");
const {
	Attenuation,
	Channel,
	EmitSound,
	Pitch,
	SoundFlags,
	VOL_NORM,
} = require("engines/sound");

const g_PlayerEntity = Player(1);
if (!g_PlayerEntity || !g_PlayerEntity.Connected) {
	throw new Error("Player 1 is not available and connected.");
}

if (!EmitSound({
	Reliable: true,
	Attenuation: Attenuation.NONE,
	Volume: VOL_NORM,
	Channel: Channel.ITEM,
	Pitch: Pitch.NORMAL,
	Sample: "ui/buttonclick.wav",
	Flags: SoundFlags.NO_FLAGS,
	Entity: g_PlayerEntity,
	Recipients: [g_PlayerEntity],
})) {
	throw new Error(`Private sound dispatch did not report success for player ${g_PlayerEntity.Index}.`);
}
```

### Apply game-verified acoustic state during cleanup

Room and DSP presets have no portable meaning across games. Supply values verified for the selected game and server build, and an intended, currently connected player. This helper checks integer representation, not connection state or preset support. Applying presets is not an automatic restoration of earlier acoustic state; the caller must know the required cleanup values.

```js
const { SetPlayerDSP, SetSoundRoomType } = require("engines/sound");

const g_nSignedInt32Minimum = -2147483648;
const g_nSignedInt32Maximum = 2147483647;

function ApplyPlayerAcoustics(nPlayerIndex, nRoomType, nDSPType) {
	if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > g_nSignedInt32Maximum)) {
		throw new TypeError("nPlayerIndex must be a positive signed 32-bit integer.");
	}

	if (!Number.isInteger(nRoomType) || (nRoomType < g_nSignedInt32Minimum) || (nRoomType > g_nSignedInt32Maximum)) {
		throw new TypeError("nRoomType must be a signed 32-bit integer.");
	}

	if (!Number.isInteger(nDSPType) || (nDSPType < g_nSignedInt32Minimum) || (nDSPType > g_nSignedInt32Maximum)) {
		throw new TypeError("nDSPType must be a signed 32-bit integer.");
	}

	const vecRecipientIndexes = [nPlayerIndex];
	if (!SetSoundRoomType(vecRecipientIndexes, nRoomType, true) || !SetPlayerDSP(vecRecipientIndexes, nDSPType, true)) {
		throw new Error(`Acoustic state dispatch did not report success for player ${nPlayerIndex}.`);
	}
}
```

The room call runs first and short-circuits the DSP call on failure. A subsequent DSP failure does not roll back the room change. Both successful results report dispatch, not delivery; do not interpret this helper as a transactional reset.

## Common mistakes

- Passing `"sound/ui/buttonclick.wav"` to `EmitSound`; engine samples normally omit the download-path `sound/` prefix.
- Passing a string channel such as `"voice"`; channels are integer constants such as `Channel.VOICE`.
- Using an entity object for the `Sound` constructor's `Entity` property; use its signed 32-bit index there. In direct `EmitSound(Options)` and `StopSound(Options)` calls, the `Entity` property also accepts an object with a nonnegative signed 32-bit `Index`; this does not establish entity liveness.
- Treating `IsLoopingSound === undefined` as a false loop result. It means the SDK capability is absent.
- Passing a sound-script entry to `PrecacheSoundSentenceGroup`.
- Assuming any DSP or room preset, including `0`, has a portable meaning across games.
- Passing a stale address-backed `mathlib.Vector` to a sound vector option; direct `X`/`Y`/`Z` access and `ConvertMathStructureToArray()` both require valid backing storage. Taking a snapshot does not make reading invalid storage safe.
- Using `[]` when all connected human players were intended; use `null` or omit `Recipients`.
- Calling `StopSound()` with a channel or sample different from the original emission.
- Expecting `Sound` field writes to mutate engine memory. `Sound` is mutable staging state; modules such as `mathlib`, `studio`, and `physics` have separate value, view, and ownership contracts.

## Related modules

- [engines](engines.md) for the smaller root engine sound subset.
- [engines/precache](engines-precache.md) for generic string-table-backed resources.
- [stringtables](stringtables.md) for direct network string-table access.
- [filters/recipients](filters-recipients.md) for reusable recipient filters.
- [mathlib](mathlib.md) for vector value/view types and `ConvertMathStructureToArray()` when adapting them to sound arguments.
