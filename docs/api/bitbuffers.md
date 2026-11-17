# `require("bitbuffers")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`BitBufferRead`](#bitbufferread)
- [`BitBufferWrite`](#bitbufferwrite)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. Read examples encode matching wire data before decoding it.

Module index: [SourceJS API Reference](README.md)

The native runtime omits `WriteLongLong`, `ReadLongLong`, and `ReadBitCoordMP` when the selected SDK lacks the corresponding `bf_write` or `bf_read` method. The public JavaScript classes define their canonical methods unconditionally, so checking the wrapper method with `typeof` does not detect native support; calling one of those methods on an unsupported SDK produces a normal JavaScript error. SourceJS does not install fallback implementations.

The module exposes only the canonical PascalCase API. Legacy lower-camel-case aliases are not exported. Native state and vector/angle records are read through canonical PascalCase properties only; underscore-prefixed aliases such as `_Bytes` are not read. A canonical `null` or `undefined` value is left to the caller's required-field or default handling; no private-name getter is tried.

## Location and purpose

The JavaScript wrappers live in [`packages/sourcejs/bitbuffers.js`](../../packages/sourcejs/bitbuffers.js) and delegate their state transitions to the native `bitbuffers` module. Use them when SourceJS code must encode or decode Source Engine bit-level wire data with matching cursor, overflow, coordinate, angle, vector, and integer behavior. Each wrapper retains a native state object; this alone does not establish the lifetime of memory referenced by that state. Follow the address and lifetime requirements in the method contracts and safe-use notes below.

## Import

```js
const { PackUInt32 } = require("bitbuffers");

console.log(PackUInt32(1));
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`BitBufferRead`](#bitbufferread-1) | Class | `new BitBufferRead(Source, bCreateCopy = true)` |
| [`BitBufferWrite`](#bitbufferwrite-1) | Class | `new BitBufferWrite(DataByteCountOrBytes = 0, nDataBitCount = null)` |
| [`PackUInt32`](#packuint32) | Function | `PackUInt32(unUInt32Value)`; requires an unsigned 32-bit integer and returns a plain JavaScript array of four bytes in little-endian order. All four indices are own data properties; inherited indexed setters are not called. Wrap it in `Uint8Array` before passing it as raw binary input. Unexpected native C++ exceptions become JavaScript errors identifying `PackUInt32`. |

`Source` may be a `BitBufferRead` or `BitBufferWrite` instance. A compatible native state object is also accepted for low-level integration. For raw binary input, use an `ArrayBuffer` or an array-buffer view such as `Uint8Array`, not a plain JavaScript array. The reader copies the input bytes; the native constructor currently ignores `bCreateCopy`, including `false`. A new reader starts at bit zero, not the source's current cursor. A writer source supplies its written bit count; a reader source supplies its data bit count.

Fresh native reader/writer state objects retain the ordinary object prototype and expose `Bytes`, `DataBitCount`, `DataByteCount`, `CurrentBit`, and `Overflowed` as own writable, enumerable, configurable data properties. Initial construction does not invoke inherited setters. Updates to an existing state retain the final-store setter behavior described below.

`nDataBitCount` sets the writer's data-bit limit; it does not mark those bits as written. A count larger than the supplied storage expands it with zero bytes; a negative count is clamped to zero. Reader state-object bit counts are clamped to the supplied byte capacity instead.

Native writer operations use private, zero-padded DWORD-aligned word storage; `Bytes` and `DataByteCount` retain their logical byte size, including sizes not divisible by four. Initialization rejects sizes whose padded bit capacity would overflow the SDK's signed `int` arithmetic, invalid bit limits or cursors, and word-storage allocation failures.

Reader operations likewise use private aligned word storage while enforcing the supplied logical bit limit, including empty buffers and partial bytes. SDKs with separate cached-word and checked readers use the checked reader for these owned buffers; engine ABI readers and native export availability are unchanged. Padding is not readable data. Scalar-overrun arithmetic retains signed-integer headroom for both reader and writer initialization.

Byte, character, long, scalar/vector coordinate and normal, multiplayer-coordinate and angle reads, plus scalar/vector normal writes, avoid the SDK's word-width shifts at aligned positions. These paths preserve the selected SDK's flag/payload order, sticky-overflow behavior and partial-field boundaries. `ReadLong()` reads a signed 32-bit field, independent of the C++ `long` width; use `ReadLongLong()` for a signed 64-bit BigInt.

The native reader/writer operation wrappers translate unexpected C++ exceptions from state parsing, SDK operations, or state storage into JavaScript errors identifying the reader or writer operation. Original JavaScript errors from state getters and byte conversion remain unchanged, including a byte-conversion error pending while a C++ exception unwinds the local native error handler.

Native creation, state getters, state setters, overflow operations, reset, absolute and relative seek, byte snapshots, and bit-buffer copying likewise translate unexpected C++ exceptions into JavaScript errors identifying the affected API. Reader construction preserves the original JavaScript error from a source-state `Bytes` getter or byte conversion, including one pending during native C++ unwinding; it does not replace that error with a generic missing-bytes or native-exception error. Native-state bit counts and cursors require signed 32-bit integer values; mutating-method arguments retain JavaScript's signed 32-bit conversion. State getters and byte snapshots parse a copy without writing state properties. Mutating operations parse and prepare a copy before storing it; a failure before the store does not commit that copy. Property writes during the final store are not transactional: a throwing setter can leave earlier writes visible. Bit-buffer copying stores the writer state before the reader state. If the writer store fails, the reader store is not attempted. An original setter exception propagates unchanged; failure during either store does not roll back writes already made.

Do not rely on invalid input types being rejected uniformly. The writer's byte conversion falls back to UTF-8 text conversion for non-buffer values, so a plain array is not interpreted as a numeric byte list. The reader treats ordinary objects, including plain arrays, as state objects that must expose `Bytes`.

## `BitBufferRead`

| Member | Signature or access |
| --- | --- |
| [`Bytes`](#bitbufferreadbytes) | Writable property. |
| [`Overflowed`](#bitbufferreadoverflowed) | Writable boolean property; assigning a non-boolean throws `TypeError`. |
| [`CurrentBit`](#bitbufferreadcurrentbit) | Writable property. |
| [`DataBitCount`](#bitbufferreaddatabitcount) | Writable property. |
| [`DataByteCount`](#bitbufferreaddatabytecount) | Writable property. |
| [`MaximumBitCount`](#bitbufferreadmaximumbitcount) | Read-only current data-bit limit, equal to `DataBitCount`; not an independent storage-capacity limit. |
| [`ReadBitCount`](#bitbufferreadreadbitcount) | Read-only current cursor position in bits. |
| [`ReadByteCount`](#bitbufferreadreadbytecount) | Read-only consumed-byte count, rounded up for a partial byte. |
| [`RemainingBitCount`](#bitbufferreadremainingbitcount) | Read-only data-bit limit minus the current cursor. |
| [`RemainingByteCount`](#bitbufferreadremainingbytecount) | Read-only remaining-byte count, rounded up for a partial byte. |
| [`CheckForOverflow`](#bitbufferreadcheckforoverflow) | `CheckForOverflow(nRequestedBitCount = 0)`; sets the overflow flag when a positive request exceeds the remaining bits and returns the current flag. It does not advance the cursor or clear an existing overflow. |
| [`ClearOverflowFlag`](#bitbufferreadclearoverflowflag) | `ClearOverflowFlag()`; clears the flag and returns `true` when state storage succeeds. |
| [`IsOverflowed`](#bitbufferreadisoverflowed) | `IsOverflowed()`; returns the current overflow flag. |
| [`PeekUBitLong`](#bitbufferreadpeekubitlong) | `PeekUBitLong(nBitCount)`; returns an unsigned value for a width from 0 through 32 without writing cursor or overflow changes back to the reader state. Native C++ exceptions from state conversion become JavaScript errors; existing JavaScript getter/conversion errors remain unchanged. |
| [`ReadBitAngle`](#bitbufferreadreadbitangle) | `ReadBitAngle(nBitCount)`; reads an unsigned fixed-width angle in degrees for widths 0 through 32. Width zero returns zero without consuming bits. The 31/32-bit conversion avoids the SDK's signed-scale limitation. |
| [`ReadBitAngles`](#bitbufferreadreadbitangles) | `ReadBitAngles()`; decodes the SDK's coordinate-compressed angle vector and returns `{ X, Y, Z }`. Match it with `WriteBitAngles`, not three fixed-width `WriteBitAngle` calls. |
| [`ReadBitCoord`](#bitbufferreadreadbitcoord) | `ReadBitCoord()`; returns the SDK-decoded coordinate as a Number. |
| [`ReadBitCoordMP`](#bitbufferreadreadbitcoordmp) | `ReadBitCoordMP(bIntegral = false, bLowPrecision = false)`; returns a Number. Requires native SDK support; flags use JavaScript truthiness. |
| [`ReadBitFloat`](#bitbufferreadreadbitfloat) | `ReadBitFloat()`; reads 32 bits, interprets them as an IEEE-754 single-precision value, and returns a Number. |
| [`ReadBitNormal`](#bitbufferreadreadbitnormal) | `ReadBitNormal()`; returns the SDK-decoded normal component as a Number. |
| [`ReadBitVec3Coord`](#bitbufferreadreadbitvec3coord) | `ReadBitVec3Coord()`; returns the SDK-decoded coordinate vector as `{ X, Y, Z }`. |
| [`ReadBitVec3Normal`](#bitbufferreadreadbitvec3normal) | `ReadBitVec3Normal()`; returns the SDK-decoded normal vector as `{ X, Y, Z }`. |
| [`ReadByte`](#bitbufferreadreadbyte) | `ReadByte()`; returns a Number. |
| [`ReadChar`](#bitbufferreadreadchar) | `ReadChar()`; returns a numeric character value, not a string. |
| [`ReadFloat`](#bitbufferreadreadfloat) | `ReadFloat()`; returns a Number. |
| [`ReadLong`](#bitbufferreadreadlong) | `ReadLong()`; reads 32 bits and returns a signed Number in the range -2147483648 through 2147483647. |
| [`ReadLongLong`](#bitbufferreadreadlonglong) | `ReadLongLong()`; returns a signed BigInt. Requires native SDK support. |
| [`ReadOneBit`](#bitbufferreadreadonebit) | `ReadOneBit()`; returns a numeric bit, not a Boolean. |
| [`ReadSBitLong`](#bitbufferreadreadsbitlong) | `ReadSBitLong(nBitCount)`; returns a signed Number for widths 0 through 32. Width zero returns zero without consuming bits. |
| [`ReadShort`](#bitbufferreadreadshort) | `ReadShort()`; reads 16 bits and returns a signed Number in the range -32768 through 32767. |
| [`ReadString`](#bitbufferreadreadstring) | `ReadString()`; reads a zero-terminated UTF-8 string of at most 4095 bytes, excluding the terminator. Throws on input overflow or excessive length instead of returning truncated text; the consumed cursor and overflow state are retained. An overlong string is consumed through its terminator or input overflow. Excessive output length alone does not set the overflow flag, so handle the exception rather than relying only on `IsOverflowed()`. |
| [`ReadUBitLong`](#bitbufferreadreadubitlong) | `ReadUBitLong(nBitCount)`; returns an unsigned Number for widths 0 through 32. Width zero returns zero without consuming bits. |
| [`ReadUBitVar`](#bitbufferreadreadubitvar) | `ReadUBitVar()`; returns a Number using the selected SDK variable-width unsigned format. PORTAL2/SWARM place the selector after the low four payload bits; DARKM/EPISODE1 use a zero-run prefix terminated by a one bit; remaining branches place the selector first, matching their `WriteUBitVar` layout. None of these is the byte-oriented `ReadVarInt32` encoding. Check `IsOverflowed()` before using the result; truncated input, unary prefixes longer than 32 zeros and values exceeding `uint32` set overflow. |
| [`ReadVarInt32`](#bitbufferreadreadvarint32) | `ReadVarInt32()`; accumulates seven payload bits per byte into an unsigned 32-bit Number. Missing input, a fifth continuation bit or fifth-byte payload above `0x0F` sets overflow. Check `IsOverflowed()` before using the result: failures can return a partial value, and consumed input is not rolled back. |
| [`ReadWord`](#bitbufferreadreadword) | `ReadWord()`; reads 16 bits and returns an unsigned Number in the range 0 through 65535. |
| [`SeekRelative`](#bitbufferreadseekrelative) | `SeekRelative(nBitDelta)`; moves by a signed 32-bit bit offset and returns success. An out-of-range target moves the cursor to the data-bit limit, sets overflow and returns `false`. A successful seek does not clear an existing overflow. |
| [`SeekToBit`](#bitbufferreadseektobit) | `SeekToBit(nBitIndex)`; seeks to an absolute bit position and returns success. A negative position or one beyond the data-bit limit moves the cursor to that limit, sets overflow and returns `false`. A valid seek preserves an existing overflow flag. |
| [`SetOverflowFlag`](#bitbufferreadsetoverflowflag) | `SetOverflowFlag()`; sets the overflow flag without moving the cursor and returns `true` when state storage succeeds. |

## `BitBufferWrite`

| Member | Signature or access |
| --- | --- |
| [`Bytes`](#bitbufferwritebytes) | Writable property. |
| [`Overflowed`](#bitbufferwriteoverflowed) | Writable boolean property; non-boolean assignments throw `TypeError`. Assigning `false` clears the overflow flag. |
| [`CurrentBit`](#bitbufferwritecurrentbit) | Writable property. |
| [`DataBitCount`](#bitbufferwritedatabitcount) | Writable property. |
| [`DataByteCount`](#bitbufferwritedatabytecount) | Writable property. |
| [`MaximumBitCount`](#bitbufferwritemaximumbitcount) | Read-only data-bit limit, not a separate physical-storage capacity. |
| [`RemainingBitCount`](#bitbufferwriteremainingbitcount) | Read-only data-bit limit minus the current cursor. |
| [`RemainingByteCount`](#bitbufferwriteremainingbytecount) | Read-only remaining-byte count, rounded up for a partial byte. |
| [`WrittenBitCount`](#bitbufferwritewrittenbitcount) | Read-only current cursor position in bits; seeking backward reduces it. This is not a high-water mark. |
| [`WrittenByteCount`](#bitbufferwritewrittenbytecount) | Read-only current cursor position expressed in bytes, rounded up for a partial byte. |
| [`CheckForOverflow`](#bitbufferwritecheckforoverflow) | `CheckForOverflow(nRequestedBitCount = 0)`; sets overflow when a positive request exceeds the remaining bits and returns the current flag. Does not move the cursor or clear existing overflow. |
| [`ClearOverflowFlag`](#bitbufferwriteclearoverflowflag) | `ClearOverflowFlag()`; clears the flag without moving the cursor and returns `true` when state storage succeeds. |
| [`IsOverflowed`](#bitbufferwriteisoverflowed) | `IsOverflowed()`; returns the current overflow flag. |
| [`ResetBuffer`](#bitbufferwriteresetbuffer) | `ResetBuffer()`; zeroes all stored bytes, resets the cursor to zero and clears overflow without changing the data limits. Returns `true` when state storage succeeds. |
| [`SeekToBit`](#bitbufferwriteseektobit) | `SeekToBit(nBitIndex)`; seeks to an absolute bit position. An out-of-range position moves the cursor to the data-bit limit, sets overflow and returns `false`; a valid position returns `true` without clearing existing overflow. |
| [`SetOverflowFlag`](#bitbufferwritesetoverflowflag) | `SetOverflowFlag()`; sets overflow without moving the cursor and returns `true` when state storage succeeds. |
| [`ToBytes`](#bitbufferwritetobytes) | `ToBytes()`; returns a new `Uint8Array` containing bytes up to the current cursor, rounded up for a partial byte. Does not change the cursor or mask unused bits in the final byte. Seeking backward shortens the result. |
| [`WriteBitAngle`](#bitbufferwritewritebitangle) | `WriteBitAngle(flAngleValue, nBitCount)`; writes a degree angle using 0–32 bits and returns success. Omitted or nullish arguments default individually to zero; width zero writes nothing. The finite float value wraps modulo 360 and is quantized toward zero. Match with `ReadBitAngle(nBitCount)`. |
| [`WriteBitAngles`](#bitbufferwritewritebitangles) | `WriteBitAngles(AngleVector)`; accepts a three-component Array or an object with `X/Y/Z` (falling back individually to `Pitch/Yaw/Roll` for nullish fields). For a `mathlib.QAngle`, pass `AngleVector.ConvertMathStructureToArray()`. An omitted or nullish `AngleVector` defaults to three zero components. Each float-converted component must have magnitude below `2^COORD_INTEGER_BITS + 1`; invalid range throws before this call writes any bits. Uses SDK coordinate-compressed encoding and returns success; match with `ReadBitAngles()`, not three fixed-width angle reads. |
| [`WriteBitCoord`](#bitbufferwritewritebitcoord) | `WriteBitCoord(flCoordinateValue)`; converts to a finite float and writes SDK coordinate-compressed data, returning success. An omitted or nullish value defaults to zero. The float-converted magnitude must be below `2^COORD_INTEGER_BITS + 1`; invalid input throws before writing. Fractional precision is `1 / 2^COORD_FRACTIONAL_BITS`, truncated toward zero. Match with `ReadBitCoord()`. |
| [`WriteBitCoordMP`](#bitbufferwritewritebitcoordmp) | `WriteBitCoordMP(flCoordinateValue, bIntegral = false, bLowPrecision = false)`; writes multiplayer-compressed coordinate data and returns success. Omitted or nullish values default to zero; mode arguments use JavaScript truthiness. Integral mode omits the fraction; otherwise low precision selects the reduced fractional width. The finite float-converted magnitude must be below `2^COORD_INTEGER_BITS + 1`; invalid input throws before writing. The `darkm` and `episode1` SDK branches lack this operation and throw an unavailable-operation error. Match with `ReadBitCoordMP(bIntegral, bLowPrecision)` using the same modes. |
| [`WriteBitFloat`](#bitbufferwritewritebitfloat) | `WriteBitFloat(flValue)`; writes the IEEE-754 binary32 representation and returns success. Omitted or nullish values default to zero. Numeric conversion must produce a finite value within the `float` range; invalid input throws before writing. Match with `ReadBitFloat()`. |
| [`WriteBitNormal`](#bitbufferwritewritebitnormal) | `WriteBitNormal(flNormalValue)`; writes a compressed normal component and returns success. Omitted or nullish values default to zero. Numeric conversion must produce a finite value within the `float` range; invalid input throws before writing. The float-converted value is saturated to `[-1, 1]`, then encoded as a sign bit and a truncated fractional magnitude. Match with `ReadBitNormal()`. |
| [`WriteBitVec3Coord`](#bitbufferwritewritebitvec3coord) | `WriteBitVec3Coord(CoordinateVector)`; writes a compressed three-component coordinate and returns success. Accepts array indices `0`, `1`, `2`, or object properties `X`, `Y`, `Z`, with nullish properties falling back individually to `Pitch`, `Yaw`, `Roll`. An omitted or nullish vector defaults to zero; a supplied vector requires all three non-nullish components. Components undergo numeric conversion and must be finite and within the `float` range. Every float-converted component must have magnitude below `2^COORD_INTEGER_BITS + 1`; invalid input throws before any writing. Match with `ReadBitVec3Coord()`. |
| [`WriteBitVec3Normal`](#bitbufferwritewritebitvec3normal) | `WriteBitVec3Normal(NormalVector)`; writes a compressed normal vector and returns success. Accepts the same component forms as `WriteBitVec3Coord`; an omitted or nullish vector defaults to zero. Components must convert to finite values within the `float` range. The `X` and `Y` components are saturated individually to `[-1, 1]` and encoded when their magnitudes reach `NORMAL_RESOLUTION`; only the sign of `Z` is stored, using `Z <= -NORMAL_RESOLUTION`. This does not normalize the input vector or preserve the magnitude of `Z`. Match with `ReadBitVec3Normal()`. |
| [`WriteBitsFromBuffer`](#bitbufferwritewritebitsfrombuffer) | `WriteBitsFromBuffer(Buffer, nBitCount)`; copies bits from a reader's current position into this writer. A `BitBufferRead` source is reused and advanced; other supported sources are wrapped in a new `BitBufferRead`. A writer source exposes only its written extent and keeps its own cursor unchanged. The count undergoes JavaScript signed 32-bit integer conversion; a negative converted count throws before copying. Returns success only when neither reader nor writer is overflowed. Copy failure is not transactional: cursor and buffer changes may already have occurred. |
| [`WriteByte`](#bitbufferwritewritebyte) | `WriteByte(nValue)`; writes the low eight bits after JavaScript signed 32-bit integer conversion and returns success. Omitted or nullish values default to zero. This is not strict `0..255` validation; an SDK Debug build may diagnose an out-of-range value without rejecting the write. Match with `ReadByte()`. |
| [`WriteChar`](#bitbufferwritewritechar) | `WriteChar(nValue)`; writes an eight-bit signed value after JavaScript signed 32-bit integer conversion and returns success. Omitted or nullish values default to zero. Use values in `[-128, 127]`; outside that range, the writer preserves the original sign and low seven bits rather than simply truncating to a byte, and Debug builds may assert or report a range diagnostic. Writes stay within the character's eight-bit extent. Overflow returns `false`; some SDK profiles write the seven-bit payload separately from the sign, so failure can leave a partial write. Match with `ReadChar()`. |
| [`WriteFloat`](#bitbufferwritewritefloat) | `WriteFloat(flValue)`; writes a 32-bit floating-point value and returns success. Omitted or nullish values default to zero. Numeric conversion must produce a finite value within the `float` range; invalid values throw before writing. Conversion to single precision can round the value. Match with `ReadFloat()`. |
| [`WriteLong`](#bitbufferwritewritelong) | `WriteLong(nValue)` writes the converted signed 32-bit integer, least-significant bit first, without alignment padding. Omitted or nullish values default to zero. JavaScript signed 32-bit conversion truncates fractions and wraps values modulo `2^32`; `NaN` and infinities become zero; BigInt is rejected. Match with `ReadLong()`. Returns false when overflow is set, including an existing flag. Failure preserves SDK-specific payload/sign block boundaries and can retain partially written data or advance the cursor to capacity; it does not roll back the operation. |
| [`WriteLongLong`](#bitbufferwritewritelonglong) | `WriteLongLong(nInt64Value)`; writes a signed 64-bit integer and returns success when supported by the selected SDK. Accepts only a `BigInt` in `[-2^63, 2^63 - 1]`; an explicit `Number` or out-of-range value throws before writing. Omitted or nullish values default to zero. Words are encoded least-significant first without alignment padding; if the high word overruns, a successfully written low word remains committed. Unavailable on `darkm` and `episode1`. Match with `ReadLongLong()`. |
| [`WriteOneBit`](#bitbufferwritewriteonebit) | `WriteOneBit(bValue)`; writes one bit using JavaScript truthiness (`1` for truthy values, otherwise `0`). An omitted value writes `0`. Returns `false` if the writer is overflowed, including a previously set overflow flag; otherwise returns `true`. At the buffer limit, no bit is written. Match with `ReadOneBit()`. |
| [`WriteOneBitAt`](#bitbufferwritewriteonebitat) | `WriteOneBitAt(bBitValue, nBitIndex)`; overwrites the zero-based bit using JavaScript truthiness without advancing the write cursor. The index uses signed 32-bit conversion; omitted or nullish indices default to zero. A negative converted index throws before writing. An index at or beyond the bit capacity sets overflow without writing. Returns `false` if the writer is overflowed, otherwise `true`; changing a bit beyond the cursor does not extend the written length. |
| [`WriteOneBitWithoutCheck`](#bitbufferwritewriteonebitwithoutcheck) | `WriteOneBitWithoutCheck(bValue)`; writes one bit using JavaScript truthiness and advances the cursor by one. Despite the SDK-style name, the JavaScript wrapper checks remaining capacity: at the limit it sets overflow, returns `false`, and leaves storage and cursor unchanged. With capacity available it writes even if overflow was already set, but returns `false` while that flag remains set; otherwise returns `true`. An omitted value writes `0`. |
| [`WriteSBitLong`](#bitbufferwritewritesbitlong) | `WriteSBitLong(nIntegerValue, nBitCount)`; converts both arguments to signed 32-bit integers, with omitted or nullish arguments defaulting to zero. The converted width must be in `[0, 32]`; zero writes nothing. For a positive width, writes the original sign and low `nBitCount - 1` bits. Use values representable in that signed width; otherwise Debug builds may assert or report a range diagnostic. Returns `false` while overflow is set, otherwise `true`. SDK profiles may write payload and sign separately, so overflow can leave a partial write. Match with `ReadSBitLong(nBitCount)`. |
| [`WriteShort`](#bitbufferwritewriteshort) | `WriteShort(nValue)`; writes a signed 16-bit value after JavaScript signed 32-bit conversion. Omitted or nullish values default to zero. Use values in `[-32768, 32767]`; outside that range the writer preserves the original sign and low 15 bits, and Debug builds may assert or report a range diagnostic. Returns `false` while overflow is set, otherwise `true`; some SDK profiles can leave a partial write on overflow. Match with `ReadShort()`. |
| [`WriteString`](#bitbufferwritewritestring) | `WriteString(strValue)`; converts the argument to a string and writes UTF-8 bytes up to (but not including) the first embedded NUL, followed by one zero-byte terminator. `null` writes `"null"`; an omitted or `undefined` argument to this package method writes `"undefined"`. Conversion exceptions are preserved and string preparation finishes before native writer-state processing. Project-owned string-allocation failures become JavaScript errors; fatal V8 out-of-memory failures are not recoverable. Returns `false` while overflow is set, otherwise `true`; failure can leave a partial string without its terminator. Capacity is measured in encoded bytes, not JavaScript string length. Match with `ReadString()`. |
| [`WriteUBitLong`](#bitbufferwritewriteubitlong) | `WriteUBitLong(unValue, nBitCount, bCheckRange = true)`; converts data to an unsigned 32-bit integer and width to a signed 32-bit integer, with omitted or nullish data/width defaulting to zero. Width must be in `[0, 32]`; zero writes nothing. Writes the low `nBitCount` bits. `bCheckRange` enables SDK Debug range diagnostics, not rejection or clamping of the value. Insufficient capacity writes no bits, moves the cursor to the bit limit, and sets overflow. Returns `false` while overflow is set, otherwise `true`. Match with `ReadUBitLong(nBitCount)`. |
| [`WriteUBitVar`](#bitbufferwritewriteubitvar) | `WriteUBitVar(unValue)` converts the value to uint32 (fractional values truncate, integers wrap modulo 2^32, NaN/infinities become zero; omitted/nullish values default to zero; BigInt is rejected), then writes the SDK-specific variable-width encoding, not a protobuf varint. DARKM/EPISODE1 use a zero-bit prefix, a one-bit marker, then the same number of payload bits; uint32 maximum requires 65 bits. PORTAL2/SWARM put a two-bit selector after the low four payload bits. Other branches put the selector first. Non-unary encodings occupy 6/10/14/34 bits for values below 16/256/4096 or larger, respectively. Capacity checks retain SDK block boundaries: TF2/CSS/DODS/HL2DM/BMS/SDK2013/PVKII write 6/10/14 bits or 18 + 16; PORTAL2/SWARM write 6/10/14 bits or 6 + 28; other non-unary branches write the selector separately from the payload. Returns false on overflow, including an existing overflow flag; a failed write can retain partial data and advance the cursor to capacity. SDK Debug range diagnostics are preserved. Match with `ReadUBitVar()` using the same SDK branch. |
| [`WriteVarInt32`](#bitbufferwritewritevarint32) | `WriteVarInt32(unValue)` converts the value to uint32 (fractional values truncate, integers wrap modulo 2^32, NaN/infinities become zero; omitted/nullish values default to zero; BigInt is rejected). Writes one to five 8-bit groups at the current bit position without alignment padding: each group contains seven low payload bits and a continuation bit; zero writes one zero group. This is unsigned protobuf-style varint encoding, not ZigZag or the SDK-specific `WriteUBitVar` format; pair it with `ReadVarInt32()`. Returns false on overflow, including an existing overflow flag. Capacity is checked for each full 8-bit group; earlier groups remain written, an incomplete group writes no bits and advances the cursor to capacity, and subsequent groups are still attempted. |
| [`WriteWord`](#bitbufferwritewriteword) | `WriteWord(nValue)` converts the argument to int32 (fractional values truncate, integers wrap modulo 2^32, NaN/infinities become zero; omitted/nullish values default to zero; BigInt is rejected), then writes its low 16 bits, least-significant bit first, at the current bit position without alignment padding. The intended word range is 0–65535; values outside that range after conversion retain SDK Debug range diagnostics but are still masked for writing. Pair with `ReadWord()`. Returns false when overflow is set, including an existing flag. If fewer than 16 bits remain, no bits are written, the cursor advances to capacity and overflow is set; sufficient capacity permits writing even with a pre-existing overflow flag. |

## Examples

### `BitBufferRead`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteString("round_start")) {
	throw new Error("Unable to write the event name.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_strEventName = g_Reader.ReadString();
if (g_Reader.IsOverflowed()) {
	throw new Error("Unable to read the event name.");
}

console.log(g_strEventName);
```

### `BitBufferWrite`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(64);
if (!g_Writer.WriteByte(7)) {
	throw new Error("Unable to write the message type.");
}

if (!g_Writer.WriteString("ready")) {
	throw new Error("Unable to write the message state.");
}

console.log(g_Writer.ToBytes());
```

### `PackUInt32`

```js
const { PackUInt32 } = require("bitbuffers");

const g_vecBytes = PackUInt32(0x12345678);
console.log([...g_vecBytes]);
```

### `BitBufferRead.Bytes`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteWord(0x534A)) {
	throw new Error("Unable to write the sample word.");
}

const g_Reader = new BitBufferRead(g_Writer);
g_Reader.Bytes = new Uint8Array([0x2A]);
g_Reader.DataBitCount = 8;
g_Reader.CurrentBit = 0;

const g_vecBytes = [...g_Reader.Bytes];
const g_unByteValue = g_Reader.ReadByte();
if (g_Reader.IsOverflowed()) {
	throw new Error("Unable to read the replacement byte.");
}

console.log(g_vecBytes, g_unByteValue);
```

### `BitBufferRead.CheckForOverflow`

```js
const { BitBufferRead } = require("bitbuffers");

const g_Reader = new BitBufferRead(new Uint8Array([0xFF]));
console.log(g_Reader.CheckForOverflow(8));

g_Reader.CurrentBit = 8;

console.log(g_Reader.CheckForOverflow(1), g_Reader.Overflowed);
```

### `BitBufferRead.ClearOverflowFlag`

```js
const { BitBufferRead } = require("bitbuffers");

const g_Reader = new BitBufferRead(new Uint8Array([0xFF]));
// A 32-bit read from one byte intentionally sets overflow for this example.
g_Reader.ReadLong();

console.log(g_Reader.IsOverflowed());

if (!g_Reader.ClearOverflowFlag()) {
	throw new Error("Unable to clear the overflow flag.");
}

console.log(g_Reader.IsOverflowed());
```

### `BitBufferRead.CurrentBit`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteOneBit(true) || !g_Writer.WriteOneBit(false)) {
	throw new Error("Unable to write the sample bits.");
}

const g_Reader = new BitBufferRead(g_Writer);
// Only the cursor movement is used here; the bit value is intentionally ignored.
g_Reader.ReadOneBit();

if (g_Reader.IsOverflowed()) {
	throw new Error("Unable to advance the bit reader.");
}

g_Reader.CurrentBit = 0;
const g_unCurrentBit = g_Reader.CurrentBit;
const g_unBitValue = g_Reader.ReadOneBit();
if (g_Reader.IsOverflowed()) {
	throw new Error("Unable to read the first bit.");
}

console.log(g_unCurrentBit, g_unBitValue);
```

### `BitBufferRead.DataBitCount`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteUBitLong(5, 3)) {
	throw new Error("Unable to write the sample field.");
}

const g_Reader = new BitBufferRead(g_Writer);
g_Reader.DataBitCount = 2;
console.log(g_Reader.DataBitCount);
```

### `BitBufferRead.DataByteCount`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteLong(1024)) {
	throw new Error("Unable to write the sample integer.");
}

const g_Reader = new BitBufferRead(g_Writer);
g_Reader.DataByteCount = 2;
console.log(g_Reader.DataByteCount);
```

### `BitBufferRead.IsOverflowed`

```js
const { BitBufferRead } = require("bitbuffers");

const g_Reader = new BitBufferRead(new Uint8Array([0xFF]));
// A 32-bit read from one byte intentionally sets overflow for this example.
g_Reader.ReadLong();

console.log(g_Reader.IsOverflowed());
```

### `BitBufferRead.MaximumBitCount`

```js
const { BitBufferRead } = require("bitbuffers");

const g_Reader = new BitBufferRead(new Uint8Array(16));
console.log(g_Reader.MaximumBitCount);
```

### `BitBufferRead.Overflowed`

```js
const { BitBufferRead } = require("bitbuffers");

const g_Reader = new BitBufferRead(new Uint8Array([0xFF]));
g_Reader.Overflowed = true;
console.log(g_Reader.Overflowed);

g_Reader.Overflowed = false;
console.log(g_Reader.Overflowed);
```

### `BitBufferRead.PeekUBitLong`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteUBitLong(13, 4)) {
	throw new Error("Unable to write the value to inspect.");
}

const g_Reader = new BitBufferRead(g_Writer);
console.log(g_Reader.PeekUBitLong(4));
console.log(g_Reader.CurrentBit);
```

### `BitBufferRead.ReadBitAngle`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteBitAngle(90, 8)) {
	throw new Error("Unable to write the angle.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flAngle = g_Reader.ReadBitAngle(8);
if (g_Reader.IsOverflowed()) {
	throw new Error("Unable to read the angle.");
}

console.log(g_flAngle);
```

### `BitBufferRead.ReadBitAngles`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { QAngle } = require("mathlib");

const g_Writer = new BitBufferWrite(128);
const g_InputAngles = new QAngle(10, 90, 0);
// Convert mathlib's component fields to the array accepted by bitbuffers.
if (!g_Writer.WriteBitAngles(g_InputAngles.ConvertMathStructureToArray())) {
	throw new Error("Unable to write the angles.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_Angles = g_Reader.ReadBitAngles();
if (g_Reader.IsOverflowed()) {
	throw new Error("Unable to read the angles.");
}

console.log(g_Angles);
```

### `BitBufferRead.ReadBitCoord`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteBitCoord(128.5)) {
	throw new Error("Unable to write the coordinate.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flCoordinate = g_Reader.ReadBitCoord();
if (g_Reader.IsOverflowed()) {
	throw new Error("Unable to read the coordinate.");
}

console.log(g_flCoordinate);
```

### `BitBufferRead.ReadBitCoordMP`

This example requires native multiplayer-coordinate support; it is unavailable on `darkm` and `episode1`.

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteBitCoordMP(128, true, false)) {
	throw new Error("Unable to write the multiplayer coordinate.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flCoordinate = g_Reader.ReadBitCoordMP(true, false);
if (g_Reader.IsOverflowed()) {
	throw new Error("Unable to read the multiplayer coordinate.");
}

console.log(g_flCoordinate);
```

### `BitBufferRead.ReadBitCount`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteByte(64)) {
	throw new Error("Unable to write the sample byte.");
}

const g_Reader = new BitBufferRead(g_Writer);
// The byte value is intentionally ignored; this example measures consumption.
g_Reader.ReadByte();

if (g_Reader.IsOverflowed()) {
	throw new Error("Unable to advance the byte reader.");
}

console.log(g_Reader.ReadBitCount);
```

### `BitBufferRead.ReadBitFloat`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteBitFloat(12.5)) {
	throw new Error("WriteBitFloat overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flValue = g_Reader.ReadBitFloat();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitFloat overflowed.");
}

console.log(g_flValue);
```

### `BitBufferRead.ReadBitNormal`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteBitNormal(0.75)) {
	throw new Error("WriteBitNormal overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flNormal = g_Reader.ReadBitNormal();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitNormal overflowed.");
}

console.log(g_flNormal);
```

### `BitBufferRead.ReadBitVec3Coord`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { Vector } = require("mathlib");

const g_Writer = new BitBufferWrite(128);
const g_InputVector = new Vector(128.5, -64.25, 32);
// Convert mathlib's component fields to the array accepted by bitbuffers.
if (!g_Writer.WriteBitVec3Coord(g_InputVector.ConvertMathStructureToArray())) {
	throw new Error("WriteBitVec3Coord overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_VectorValue = g_Reader.ReadBitVec3Coord();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitVec3Coord overflowed.");
}

console.log(g_VectorValue);
```

### `BitBufferRead.ReadBitVec3Normal`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { Vector } = require("mathlib");

const g_Writer = new BitBufferWrite(128);
const g_InputNormal = new Vector(0, 0, 1);
// Convert mathlib's component fields to the array accepted by bitbuffers.
if (!g_Writer.WriteBitVec3Normal(g_InputNormal.ConvertMathStructureToArray())) {
	throw new Error("WriteBitVec3Normal overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_Normal = g_Reader.ReadBitVec3Normal();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitVec3Normal overflowed.");
}

console.log(g_Normal);
```

### `BitBufferRead.ReadByte`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteByte(200)) {
	throw new Error("WriteByte overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unByteValue = g_Reader.ReadByte();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadByte overflowed.");
}

console.log(g_unByteValue);
```

### `BitBufferRead.ReadByteCount`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteWord(0x534A)) {
	throw new Error("WriteWord overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
// Consume the word to demonstrate the byte count; its value is not needed here.
g_Reader.ReadWord();

if (g_Reader.IsOverflowed()) {
	throw new Error("ReadWord overflowed.");
}

console.log(g_Reader.ReadByteCount);
```

### `BitBufferRead.ReadChar`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteChar(-42)) {
	throw new Error("WriteChar overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_nCharacterValue = g_Reader.ReadChar();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadChar overflowed.");
}

console.log(g_nCharacterValue);
```

### `BitBufferRead.ReadFloat`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteFloat(1.25)) {
	throw new Error("WriteFloat overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flValue = g_Reader.ReadFloat();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadFloat overflowed.");
}

console.log(g_flValue);
```

### `BitBufferRead.ReadLong`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteLong(-123456)) {
	throw new Error("WriteLong overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_nValue = g_Reader.ReadLong();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadLong overflowed.");
}

console.log(g_nValue);
```

### `BitBufferRead.ReadLongLong`

This example requires native 64-bit bit-buffer support; it is unavailable on `darkm` and `episode1`.

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteLongLong(BigInt("76561198000000000"))) {
	throw new Error("WriteLongLong overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_nValue = g_Reader.ReadLongLong();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadLongLong overflowed.");
}

console.log(g_nValue);
```

### `BitBufferRead.ReadOneBit`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteOneBit(true)) {
	throw new Error("WriteOneBit overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unBitValue = g_Reader.ReadOneBit();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadOneBit overflowed.");
}

console.log(g_unBitValue);
```

### `BitBufferRead.ReadSBitLong`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteSBitLong(-3, 5)) {
	throw new Error("WriteSBitLong overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_nValue = g_Reader.ReadSBitLong(5);
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadSBitLong overflowed.");
}

console.log(g_nValue);
```

### `BitBufferRead.ReadShort`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteShort(-32000)) {
	throw new Error("WriteShort overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_nValue = g_Reader.ReadShort();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadShort overflowed.");
}

console.log(g_nValue);
```

### `BitBufferRead.ReadString`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteString("c1m1_hotel")) {
	throw new Error("WriteString failed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_strValue = g_Reader.ReadString();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadString overflowed.");
}

console.log(g_strValue);
```

### `BitBufferRead.ReadUBitLong`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteUBitLong(42, 6)) {
	throw new Error("WriteUBitLong overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unValue = g_Reader.ReadUBitLong(6);
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadUBitLong overflowed.");
}

console.log(g_unValue);
```

### `BitBufferRead.ReadUBitVar`

Use a writer and reader from the same SDK branch for this round trip. The selector-first, selector-after-low-nibble, and unary-prefix wire layouts differ between branch families; see the `WriteUBitVar` contract above.

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteUBitVar(0xABC)) {
	throw new Error("WriteUBitVar overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unValue = g_Reader.ReadUBitVar();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadUBitVar overflowed.");
}

console.log(g_unValue);
```

### `BitBufferRead.ReadVarInt32`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteVarInt32(300)) {
	throw new Error("WriteVarInt32 overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unValue = g_Reader.ReadVarInt32();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadVarInt32 overflowed.");
}

console.log(g_unValue);
```

### `BitBufferRead.ReadWord`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteWord(60000)) {
	throw new Error("WriteWord overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unValue = g_Reader.ReadWord();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadWord overflowed.");
}

console.log(g_unValue);
```

### `BitBufferRead.RemainingBitCount`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteByte(0b10100101)) {
	throw new Error("WriteByte overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
// Consume one bit to demonstrate the remaining count; its value is not needed here.
g_Reader.ReadOneBit();

if (g_Reader.IsOverflowed()) {
	throw new Error("ReadOneBit overflowed.");
}

console.log(g_Reader.RemainingBitCount);
```

### `BitBufferRead.RemainingByteCount`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteLong(0x12345678)) {
	throw new Error("WriteLong overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
// Consume one byte to demonstrate the remaining count; its value is not needed here.
g_Reader.ReadByte();

if (g_Reader.IsOverflowed()) {
	throw new Error("ReadByte overflowed.");
}

console.log(g_Reader.RemainingByteCount);
```

### `BitBufferRead.SeekRelative`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteByte(0b10100101)) {
	throw new Error("WriteByte overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
if (!g_Reader.SeekRelative(4)) {
	throw new Error("SeekRelative failed.");
}

const g_unValue = g_Reader.ReadUBitLong(4);
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadUBitLong overflowed.");
}

console.log(g_unValue);
```

### `BitBufferRead.SeekToBit`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteByte(0b10100101)) {
	throw new Error("WriteByte overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
// Advance the cursor before seeking back; the first value is not needed here.
g_Reader.ReadUBitLong(4);

if (g_Reader.IsOverflowed()) {
	throw new Error("Initial ReadUBitLong overflowed.");
}

if (!g_Reader.SeekToBit(0)) {
	throw new Error("SeekToBit failed.");
}

const g_unValue = g_Reader.ReadUBitLong(4);
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadUBitLong after seeking overflowed.");
}

console.log(g_unValue);
```

### `BitBufferRead.SetOverflowFlag`

```js
const { BitBufferRead } = require("bitbuffers");

const g_Reader = new BitBufferRead(new Uint8Array([0xFF]));
if (!g_Reader.SetOverflowFlag()) {
	throw new Error("SetOverflowFlag failed.");
}

console.log(g_Reader.IsOverflowed());
```

### `BitBufferWrite.Bytes`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(2);
g_Writer.Bytes = new Uint8Array([0x4A, 0x53]);
console.log([...g_Writer.Bytes]);
```

### `BitBufferWrite.CheckForOverflow`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(1, 8);
console.log(g_Writer.CheckForOverflow(9));
console.log(g_Writer.IsOverflowed());
```

### `BitBufferWrite.ClearOverflowFlag`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(1, 8);
// Intentionally exceed the capacity to demonstrate clearing the overflow flag.
g_Writer.WriteLong(1024);

console.log(g_Writer.IsOverflowed());

if (!g_Writer.ClearOverflowFlag()) {
	throw new Error("ClearOverflowFlag failed.");
}

console.log(g_Writer.IsOverflowed());
```

### `BitBufferWrite.CurrentBit`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteUBitLong(5, 3)) {
	throw new Error("Initial WriteUBitLong overflowed.");
}

g_Writer.CurrentBit = 0;
if (!g_Writer.WriteUBitLong(2, 2)) {
	throw new Error("WriteUBitLong after seeking overflowed.");
}

console.log(g_Writer.CurrentBit);
```

### `BitBufferWrite.DataBitCount`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(1, 8);
g_Writer.DataBitCount = 16;
console.log(g_Writer.DataBitCount);
```

### `BitBufferWrite.DataByteCount`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(4, 32);
g_Writer.DataByteCount = 2;
console.log(g_Writer.DataByteCount);
```

### `BitBufferWrite.IsOverflowed`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(1, 8);
// Intentionally exceed the capacity to demonstrate the overflow state.
g_Writer.WriteLong(1024);

console.log(g_Writer.IsOverflowed());
```

### `BitBufferWrite.MaximumBitCount`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(2, 12);
console.log(g_Writer.MaximumBitCount);
```

### `BitBufferWrite.Overflowed`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(1, 8);
g_Writer.Overflowed = true;
console.log(g_Writer.Overflowed);

g_Writer.Overflowed = false;
console.log(g_Writer.Overflowed);
```

### `BitBufferWrite.RemainingBitCount`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(1, 8);
if (!g_Writer.WriteOneBit(true)) {
	throw new Error("WriteOneBit overflowed.");
}

console.log(g_Writer.RemainingBitCount);
```

### `BitBufferWrite.RemainingByteCount`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(4, 32);
if (!g_Writer.WriteByte(200)) {
	throw new Error("WriteByte overflowed.");
}

console.log(g_Writer.RemainingByteCount);
```

### `BitBufferWrite.ResetBuffer`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteString("temporary")) {
	throw new Error("WriteString failed.");
}

if (!g_Writer.ResetBuffer()) {
	throw new Error("ResetBuffer failed.");
}

console.log(g_Writer.CurrentBit);
console.log(g_Writer.IsOverflowed());
```

### `BitBufferWrite.SeekToBit`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(1, 8);
if (!g_Writer.WriteUBitLong(0xF, 4)) {
	throw new Error("Initial WriteUBitLong overflowed.");
}

if (!g_Writer.SeekToBit(0)) {
	throw new Error("SeekToBit failed.");
}

if (!g_Writer.WriteUBitLong(5, 4)) {
	throw new Error("WriteUBitLong after seeking overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unValue = g_Reader.ReadUBitLong(4);
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadUBitLong overflowed.");
}

console.log(g_unValue);
```

### `BitBufferWrite.SetOverflowFlag`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.SetOverflowFlag()) {
	throw new Error("SetOverflowFlag failed.");
}

console.log(g_Writer.IsOverflowed());
```

### `BitBufferWrite.ToBytes`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteByte(7)) {
	throw new Error("WriteByte overflowed.");
}

if (!g_Writer.WriteString("ready")) {
	throw new Error("WriteString failed.");
}

console.log([...g_Writer.ToBytes()]);
```

### `BitBufferWrite.WriteBitAngle`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteBitAngle(90, 8)) {
	throw new Error("WriteBitAngle overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flAngle = g_Reader.ReadBitAngle(8);
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitAngle overflowed.");
}

console.log(g_flAngle);
```

### `BitBufferWrite.WriteBitAngles`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { QAngle } = require("mathlib");

const g_Writer = new BitBufferWrite(128);
const g_InputAngles = new QAngle(10, 90, 0);
// Convert mathlib's component fields to the array accepted by bitbuffers.
if (!g_Writer.WriteBitAngles(g_InputAngles.ConvertMathStructureToArray())) {
	throw new Error("WriteBitAngles overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_Angles = g_Reader.ReadBitAngles();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitAngles overflowed.");
}

console.log(g_Angles);
```

### `BitBufferWrite.WriteBitCoord`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteBitCoord(128.5)) {
	throw new Error("WriteBitCoord overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flCoordinate = g_Reader.ReadBitCoord();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitCoord overflowed.");
}

console.log(g_flCoordinate);
```

### `BitBufferWrite.WriteBitCoordMP`

Requires native MP-coordinate support; unavailable on `darkm` and `episode1`. Use the same integral and precision flags when writing and reading.

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteBitCoordMP(128, true, false)) {
	throw new Error("WriteBitCoordMP overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flCoordinate = g_Reader.ReadBitCoordMP(true, false);
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitCoordMP overflowed.");
}

console.log(g_flCoordinate);
```

### `BitBufferWrite.WriteBitFloat`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteBitFloat(12.5)) {
	throw new Error("WriteBitFloat overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flValue = g_Reader.ReadBitFloat();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitFloat overflowed.");
}

console.log(g_flValue);
```

### `BitBufferWrite.WriteBitNormal`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteBitNormal(0.75)) {
	throw new Error("WriteBitNormal overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flNormal = g_Reader.ReadBitNormal();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitNormal overflowed.");
}

console.log(g_flNormal);
```

### `BitBufferWrite.WriteBitVec3Coord`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { Vector } = require("mathlib");

const g_Writer = new BitBufferWrite(128);
const g_InputVector = new Vector(128.5, -64.25, 32);
// Convert mathlib's component fields to the array accepted by bitbuffers.
if (!g_Writer.WriteBitVec3Coord(g_InputVector.ConvertMathStructureToArray())) {
	throw new Error("WriteBitVec3Coord overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_VectorValue = g_Reader.ReadBitVec3Coord();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitVec3Coord overflowed.");
}

console.log(g_VectorValue);
```

### `BitBufferWrite.WriteBitVec3Normal`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { Vector } = require("mathlib");

const g_Writer = new BitBufferWrite(128);
const g_InputNormal = new Vector(0, 0, 1);
// Convert mathlib's component fields to the array accepted by bitbuffers.
if (!g_Writer.WriteBitVec3Normal(g_InputNormal.ConvertMathStructureToArray())) {
	throw new Error("WriteBitVec3Normal overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_Normal = g_Reader.ReadBitVec3Normal();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadBitVec3Normal overflowed.");
}

console.log(g_Normal);
```

### `BitBufferWrite.WriteBitsFromBuffer`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_SourceWriter = new BitBufferWrite(1);
if (!g_SourceWriter.WriteUBitLong(3, 2)) {
	throw new Error("WriteUBitLong overflowed.");
}

const g_SourceReader = new BitBufferRead(g_SourceWriter);
const g_DestinationWriter = new BitBufferWrite(1, 8);
if (!g_DestinationWriter.WriteBitsFromBuffer(g_SourceReader, 2)) {
	throw new Error("WriteBitsFromBuffer failed.");
}

const g_DestinationReader = new BitBufferRead(g_DestinationWriter);
const g_unValue = g_DestinationReader.ReadUBitLong(2);
if (g_DestinationReader.IsOverflowed()) {
	throw new Error("ReadUBitLong overflowed.");
}

console.log(g_unValue);
```

### `BitBufferWrite.WriteByte`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteByte(200)) {
	throw new Error("WriteByte overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unByteValue = g_Reader.ReadByte();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadByte overflowed.");
}

console.log(g_unByteValue);
```

### `BitBufferWrite.WriteChar`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteChar(-42)) {
	throw new Error("WriteChar overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_nCharacterValue = g_Reader.ReadChar();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadChar overflowed.");
}

console.log(g_nCharacterValue);
```

### `BitBufferWrite.WriteFloat`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteFloat(1.25)) {
	throw new Error("WriteFloat overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_flValue = g_Reader.ReadFloat();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadFloat overflowed.");
}

console.log(g_flValue);
```

### `BitBufferWrite.WriteLong`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteLong(-123456)) {
	throw new Error("WriteLong overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_nValue = g_Reader.ReadLong();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadLong overflowed.");
}

console.log(g_nValue);
```

### `BitBufferWrite.WriteLongLong`

This example requires native 64-bit bit-buffer support; it is unavailable on `darkm` and `episode1`.

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteLongLong(BigInt("76561198000000000"))) {
	throw new Error("WriteLongLong overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_nValue = g_Reader.ReadLongLong();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadLongLong overflowed.");
}

console.log(g_nValue);
```

### `BitBufferWrite.WriteOneBit`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteOneBit(true)) {
	throw new Error("WriteOneBit overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unBitValue = g_Reader.ReadOneBit();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadOneBit overflowed.");
}

console.log(g_unBitValue);
```

### `BitBufferWrite.WriteOneBitAt`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(1, 8);
if (!g_Writer.WriteByte(0)) {
	throw new Error("WriteByte overflowed.");
}

if (!g_Writer.WriteOneBitAt(true, 7)) {
	throw new Error("WriteOneBitAt failed.");
}

const g_Reader = new BitBufferRead(g_Writer);
if (!g_Reader.SeekToBit(7)) {
	throw new Error("SeekToBit failed.");
}

const g_unBitValue = g_Reader.ReadOneBit();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadOneBit overflowed.");
}

console.log(g_unBitValue);
```

### `BitBufferWrite.WriteOneBitWithoutCheck`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(1, 8);
if (g_Writer.CheckForOverflow(1)) {
	throw new Error("Insufficient capacity for one bit.");
}

if (!g_Writer.WriteOneBitWithoutCheck(true)) {
	throw new Error("WriteOneBitWithoutCheck failed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unBitValue = g_Reader.ReadOneBit();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadOneBit overflowed.");
}

console.log(g_unBitValue);
```

### `BitBufferWrite.WriteSBitLong`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteSBitLong(-3, 5)) {
	throw new Error("WriteSBitLong overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_nValue = g_Reader.ReadSBitLong(5);
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadSBitLong overflowed.");
}

console.log(g_nValue);
```

### `BitBufferWrite.WriteShort`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteShort(-32000)) {
	throw new Error("WriteShort overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_nValue = g_Reader.ReadShort();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadShort overflowed.");
}

console.log(g_nValue);
```

### `BitBufferWrite.WriteString`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteString("c1m1_hotel")) {
	throw new Error("WriteString failed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_strValue = g_Reader.ReadString();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadString overflowed.");
}

console.log(g_strValue);
```

### `BitBufferWrite.WriteUBitLong`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteUBitLong(42, 6)) {
	throw new Error("WriteUBitLong overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unValue = g_Reader.ReadUBitLong(6);
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadUBitLong overflowed.");
}

console.log(g_unValue);
```

### `BitBufferWrite.WriteUBitVar`

Use a writer and reader from the same SDK branch for this round trip. The selector-first, selector-after-low-nibble, and unary-prefix wire layouts differ between branch families; see the `WriteUBitVar` contract above.

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteUBitVar(0xABC)) {
	throw new Error("WriteUBitVar overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unValue = g_Reader.ReadUBitVar();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadUBitVar overflowed.");
}

console.log(g_unValue);
```

### `BitBufferWrite.WriteVarInt32`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteVarInt32(300)) {
	throw new Error("WriteVarInt32 overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unValue = g_Reader.ReadVarInt32();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadVarInt32 overflowed.");
}

console.log(g_unValue);
```

### `BitBufferWrite.WriteWord`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteWord(60000)) {
	throw new Error("WriteWord overflowed.");
}

const g_Reader = new BitBufferRead(g_Writer);
const g_unValue = g_Reader.ReadWord();
if (g_Reader.IsOverflowed()) {
	throw new Error("ReadWord overflowed.");
}

console.log(g_unValue);
```

### `BitBufferWrite.WrittenBitCount`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteUBitLong(42, 6)) {
	throw new Error("WriteUBitLong overflowed.");
}

console.log(g_Writer.WrittenBitCount);
```

### `BitBufferWrite.WrittenByteCount`

```js
const { BitBufferWrite } = require("bitbuffers");

const g_Writer = new BitBufferWrite(128);
if (!g_Writer.WriteString("round_start")) {
	throw new Error("WriteString failed.");
}

console.log(g_Writer.WrittenByteCount);
```

## Safe use and common mistakes

- The native reader constructor copies bytes and currently ignores `bCreateCopy`; `false` does not enable shared-buffer semantics. A reader created from a writer uses the writer's written bit count, not its full capacity.
- Treat `Bytes`, `DataBitCount`, `DataByteCount`, and `CurrentBit` as one state contract. When replacing writable state manually, set the meaningful length and cursor deliberately before reading or writing.
- Native state parsing preserves JavaScript exceptions from `Bytes` conversion instead of replacing them with a generic conversion error, and commits the parsed state only after all fields are validated.
- Use the same bit width and mode flags for matching write/read pairs. `WriteBitCoordMP` and `ReadBitCoordMP`, for example, must receive the same `bIntegral` and `bLowPrecision` values. Keep the SDK branch consistent for `WriteUBitVar` and `ReadUBitVar`; see the branch-specific wire layouts in the `WriteUBitVar` contract above.
- Check `CheckForOverflow` before `WriteOneBitWithoutCheck` and stop if it returns true. Prefer the checked write methods for ordinary code. Check write and seek results and inspect `IsOverflowed` after reads; zero can be valid data, not proof of a successful read. Failed operations may retain partial data or advance the cursor; clearing the overflow flag does not undo those changes.
- Pass booleans to the `bValue` bit-write parameters; numeric `0` and `1` do not express the canonical parameter contract.
- `WriteLongLong` requires a `BigInt` for every explicit signed 64-bit value;
  it rejects `Number` even when that Number is safe. Do not round a 64-bit
  identifier through `Number` first.
- `SeekRelative(nBitDelta)` uses a signed 32-bit relative offset; `SeekToBit(nBitIndex)` converts an absolute position to a signed 32-bit integer. Keep the resulting position between zero and `DataBitCount`, inclusive. Negative or out-of-range targets set overflow and move the cursor to the data-bit limit rather than wrapping to an unsigned position.
- `WriteOneBitAt` changes a bit without advancing the write cursor. Initialize the meaningful data first when patching it; constructing a reader from a fresh writer whose cursor is still zero exposes no readable bits.

## Related files

- [`packages/sourcejs/bitbuffers.js`](../../packages/sourcejs/bitbuffers.js) defines the JavaScript wrappers and canonical method names.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs the native bit-buffer operations.
- [`docs/api/mathlib.md`](mathlib.md) documents the `Vector` and `QAngle` values used by vector and angle methods.
- [`docs/api/README.md`](README.md) links the complete hand-maintained SourceJS API reference.
