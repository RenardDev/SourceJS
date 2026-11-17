# `require("filesystem")`

> AI processing note: this page is hand-maintained from `packages/sourcejs/filesystem.js` and the native `IFileSystem` binding. Keep the low-level handle rules, high-level ownership rules, and executable workflows synchronized with both implementations.

`filesystem` combines two deliberately different kinds of file access:

- physical-path helpers backed by the operating system filesystem;
- Source engine file handles backed by the selected SDK's `IFileSystem`, including files mounted from VPK archives.

Use `SourceFile` for ordinary plugin I/O. Use the low-level functions when an extension or serializer needs direct control over an engine handle. Use `AcquireSourceFileLease()` when a library needs a physical path for an asset that may live inside a VPK.

Module index: [SourceJS API Reference](README.md)

## Contents

- [Import](#import)
- [Path domains](#path-domains)
- [Exports](#exports)
- [SeekType](#seektype)
- [Physical helpers](#physical-helpers)
- [Raw engine handles](#raw-engine-handles)
- [SourceFile](#sourcefile)
- [SourceFileLease](#sourcefilelease)
- [Workflows](#workflows)
- [Errors and ownership](#errors-and-ownership)

## Import

```js
const { AcquireSourceFileLease, DoesFileExist, ReadTextFile, SourceFile, SourceFileLease } = require("filesystem");

const g_VerifyFilesystemImports = () => {
	if ((typeof SourceFile !== "function") || (typeof SourceFileLease !== "function") || (typeof AcquireSourceFileLease !== "function") || (typeof DoesFileExist !== "function") || (typeof ReadTextFile !== "function")) {
		throw new Error("The filesystem module has an incomplete high-level surface.");
	}
};

g_VerifyFilesystemImports();
```

The module preserves the plugin context's native `filesystem` object and extends it with `SeekType`, `SourceFile`, `SourceFileLease`, and `AcquireSourceFileLease()`. The native `GetSeekTypes()` function remains available. The module does not expose a default export, a `ModuleName` snapshot, or alternate VPK/TTY spellings.

File operations run synchronously on the calling thread; this module does not enqueue IO requests or accept `Blocking` options. `UseSourceFile()` and `UseSourceFileLease()` do not await callback promises: the file is closed or the lease released when the callback returns. Finish file access inside a synchronous callback.

## Path domains

The path domain matters more than the spelling of the path:

| API family | Path domain | VPK access | `strPathID` |
| --- | --- | --- | --- |
| `ReadTextFile`, `WriteTextFile`, `EnsureDirectoryExists`, `GetTemporaryFilePath`, `RemoveFile` | Physical OS path relative to the server process, or absolute | No | No |
| [`DoesFileExist`](#doesfileexiststrfilepath) | Physical path first, then the engine search paths | Yes | No |
| `IsVPKFile` | Engine search paths compared with the physical filesystem | Yes | No |
| `OpenSourceFile`, `SourceFile.OpenSourceFile`, `SourceFile.UseSourceFile` | Source `IFileSystem` path | Yes | Optional |
| `SaveSourceFile`, `SourceFile.SaveSourceFile` | Borrowed Source handle input; `IFileSystem` destination path | Source may be VPK-backed; destination must be writable | No |
| `AcquireSourceFileLease` | Source `IFileSystem` input; physical OS path output | Yes | No |

`strPathID` names the SDK search-path identifier, such as `"GAME"`. Pass `null` or omit it to use the engine's default search order. It is not a directory name. For physical example data, use [`paths`](paths.md)'s `SOURCE_DATA_ROOT` rather than assuming the process working directory is the game directory.

## Exports

The public module exposes 27 names:

| Export | Kind | Result |
| --- | --- | --- |
| [`SeekType`](#seektype) | Frozen namespace | `HEAD`/`CURRENT`/`TAIL` seek origins |
| [`SourceFile`](#sourcefile) | Class | Owned high-level wrapper around one engine handle |
| [`SourceFileLease`](#sourcefilelease) | Class | Physical-path lease with optional deletion ownership |
| `GetSeekTypes()` | Function | Selected SDK's native seek-origin values: `Head`, `Current`, and `Tail` |
| [`DoesFileExist(strFilePath)`](#doesfileexiststrfilepath) | Function | Whether a physical or engine-visible path exists |
| [`ReadTextFile(strFilePath)`](#readtextfilestrfilepath) | Function | Physical UTF-8 text, or `null` on an open, read, or buffering failure |
| [`WriteTextFile(strFilePath, strText)`](#writetextfilestrfilepath-strtext) | Function | `true` when a physical file was written; parent directories are created |
| [`EnsureDirectoryExists(strDirectoryPath)`](#ensuredirectoryexistsstrdirectorypath) | Function | `true` when the physical directory exists after the call |
| `IsVPKFile(strFilePath)` | Function | Whether an engine-visible file lacks a physical counterpart |
| `OpenSourceFile(strFilePath, strFileMode?, strPathID?)` | Function | File record with `Handle`/`FileMode`/`FilePath`/`PathID` fields |
| `CloseSourceFile(hFile)` | Function | Closes an engine handle and returns `true` |
| `ReadSourceFile(hFile, nSize?, bBinary?)` | Function | `string` or `Uint8Array` from the current cursor |
| `ReadSourceFileLine(hFile, nSize?, bBinary?)` | Function | One string or `Uint8Array` line from the current cursor |
| `WriteSourceFile(hFile, Data)` | Function | Nonnegative byte count; buffers/views supply bytes, other values undergo JavaScript string coercion and UTF-8 encoding |
| `TruncateSourceFile(hSourceFile, strFilePath, strFileMode?, strPathID?, nTargetSize?)` | Function | Reopened handle record with `Handle`/`BytesWritten`/`FileSize` fields |
| `SeekSourceFile(hFile, nSeekOffset?, nSeekType?)` | Function | Moves the cursor and returns `true` |
| `GetSourceFileOffset(hFile)` | Function | Current byte offset |
| `GetSourceFileSize(hFile)` | Function | Complete file size in bytes |
| `FlushSourceFile(hFile)` | Function | Flushes buffered writes and returns `true` |
| `IsSourceFileAtEnd(hFile)` | Function | Whether the cursor reached the end |
| `IsSourceFileTTY(hFile)` | Function | Always `false` for Source `IFileSystem` handles |
| `IsSourceFileSeekable(hFile)` | Function | `true` for a valid Source file handle |
| `GetSourceFileDescriptor(hFile)` | Function | Throws because a Source handle is not an OS descriptor |
| `SaveSourceFile(hFile, strDestinationPath)` | Function | Copies bytes from the current cursor and returns the copied byte count |
| [`GetTemporaryFilePath(strFileNamePrefix?)`](#gettemporaryfilepathstrfilenameprefix--sourcejs-) | Function | Unique physical temporary path; it does not create the file |
| [`RemoveFile(strFilePath)`](#removefilestrfilepath) | Function | Whether a physical file was removed |
| `AcquireSourceFileLease(strFilePath)` | Function | `SourceFileLease` for a physical path, extracting VPK data when needed |

## SeekType

`SeekType` is frozen and uses the selected SDK's `FileSystemSeek_t` values:

| Member | Meaning |
| --- | --- |
| `SeekType.HEAD` | Offset from the beginning of the file |
| `SeekType.CURRENT` | Offset from the current cursor |
| `SeekType.TAIL` | Offset from the end of the file |

Use the namespace instead of embedding integer seek origins in plugin code. `GetSeekTypes()` separately returns a fresh record with own `Head`, `Current`, and `Tail` data properties; inherited setters cannot intercept them. Its native C++ exceptions become JavaScript `Error` exceptions.

| Use | Example |
| --- | --- |
| Obtain the SDK's seek origin for the start of the file. Import `GetSeekTypes` from `filesystem`. | `const nSeekOrigin = GetSeekTypes().Head;` |

## Physical helpers

`DoesFileExist()`, `ReadTextFile()`, `WriteTextFile()`, and `EnsureDirectoryExists()` perform synchronous physical filesystem operations on the calling thread. Required path arguments, and `WriteTextFile()`'s `strText`, use JavaScript string coercion. Missing required arguments throw `TypeError`; exceptions thrown during coercion propagate unchanged. Native C++ exceptions become JavaScript `Error` exceptions with the operation name. Ordinary IO failures retain the return values described below.

Paths containing NUL throw `TypeError` before physical IO or engine lookup; they are not shortened to a valid prefix. `WriteTextFile()` rejects such a path before coercing its text argument. Native `SourceFile` path, mode, and path-ID string arguments also reject NUL before committing their value. This restriction does not apply to file contents: text APIs preserve embedded NUL bytes.

### `DoesFileExist(strFilePath)`

Checks the physical filesystem first and then `IFileSystem::FileExists`. This makes it suitable for presence checks, but not for determining where the file lives. Use `IsVPKFile()` for that distinction. Both physical-path checks interpret JavaScript path bytes as UTF-8 on every supported platform, so an existing physical Unicode file is not classified as VPK-only because of the host's legacy code page.

### `ReadTextFile(strFilePath)`

Reads a physical file without going through Source search paths. It returns `null` when opening or reading fails, or a stream reports a buffering failure; it does not publish partially read text as a successful result. An empty file returns `""`. The result is a JavaScript string and preserves valid UTF-8 text and embedded NUL characters across read-buffer boundaries; use `SourceFile` in binary mode when arbitrary bytes must be preserved. Native C++ exceptions retain the error translation described above.

### `WriteTextFile(strFilePath, strText)`

Creates missing parent directories and replaces the physical file. It writes the complete UTF-8 encoding of `strText`, including embedded NUL bytes. It returns a boolean rather than throwing for ordinary directory-creation, open, or write failures. `ReadTextFile()` preserves embedded NUL characters when reading valid UTF-8 text; use binary APIs for arbitrary bytes.

### `EnsureDirectoryExists(strDirectoryPath)`

Creates the complete physical directory chain. Passing a file path would create a directory with that file name, so pass the directory itself.

### `GetTemporaryFilePath(strFileNamePrefix = "sourcejs-")`

Returns a unique physical path encoded as UTF-8, preserving Unicode in both the operating system's temporary directory and the supplied prefix on every supported platform. The path is not reserved and no file is created until it is opened or written. The caller owns cleanup. A supplied prefix is string-coerced before full-length UTF-8 encoding; any exception from that coercion propagates unchanged. NUL in the prefix throws `TypeError` before generating a path; it is never silently shortened to a valid prefix. Filename-formatting failure throws `Error` rather than returning a partial name. The generated name is an opaque implementation detail, not a stable format or security token.

### `RemoveFile(strFilePath)`

Interprets `strFilePath` as UTF-8 and removes one physical file or empty directory, returning whether anything was removed. It does not recursively delete directories and cannot remove a file from a VPK.

## Raw engine handles

### Native file record

The package-level `OpenSourceFile()` returns a plain record. Its native implementation record uses `Handle`, `Mode`, `Path`, and `PathID`; the package maps these to the public fields below. There are no lowercase aliases. Both records expose own data properties, so inherited setters cannot intercept their construction.

The native opener retains the acquired handle in a rollback owner until its result record is complete, then transfers ownership to the caller. Close a successful raw handle exactly once with `CloseSourceFile()`, or let the owning `SourceFile` instance close it; do not mix these owners.

`IsVPKFile()`, `OpenSourceFile()`, `CloseSourceFile()`, `ReadSourceFile()`, `ReadSourceFileLine()`, `WriteSourceFile()`, `TruncateSourceFile()`, `SeekSourceFile()`, `GetSourceFileOffset()`, `GetSourceFileSize()`, `FlushSourceFile()`, `IsSourceFileAtEnd()`, `IsSourceFileTTY()`, `IsSourceFileSeekable()`, `GetSourceFileDescriptor()`, `SaveSourceFile()`, `GetTemporaryFilePath()`, and `RemoveFile()` translate native C++ exceptions into JavaScript `Error` exceptions naming the operation. Argument validation and ordinary results retain their documented contracts; string-coercion exceptions from `WriteSourceFile()` and `GetTemporaryFilePath()` propagate unchanged.

| Field | Type | Meaning |
| --- | --- | --- |
| `Handle` | Opaque engine handle (`bigint`) | Pass only to this module's raw handle functions or the `SourceFile` constructor |
| `FileMode` | string | Exact mode used to open the file |
| `FilePath` | string | Exact engine file path |
| `PathID` | string | Selected search-path ID, or an empty string |

The opaque handle is not a memory address and must not be used with the `memory` module. Pass only a live handle obtained from this filesystem API; a positive `bigint` alone does not establish validity. Never close a raw handle while an owning wrapper still uses it. Raw callers must keep the handle live for the entire call, including JavaScript data coercion; the native raw-handle functions do not pin ownership.

### Modes

The selected SDK interprets C-style modes. Common modes are:

| Mode | Behavior |
| --- | --- |
| `"rt"` | Read text |
| `"rb"` | Read bytes |
| `"wt"` | Replace and write text |
| `"wb"` | Replace and write bytes |
| `"at"` | Append text |
| `"rb+"` or `"wb+"` | Read and write |

Text `ReadSourceFileLine()` removes carriage returns and converts embedded NUL line separators to `\n`; the returned line includes its terminating newline when present. Binary reads return `Uint8Array` and preserve bytes exactly; binary line reads stop at a newline byte without normalizing carriage returns or NUL bytes.

Native `ReadSourceFile()` and `ReadSourceFileLine()` accept a signed integer size: a negative size means unlimited input, while zero returns an empty result without advancing the cursor. A positive size bounds returned bytes, not JavaScript string code units. Line reads count retained bytes, so discarded text-mode carriage returns can consume additional input. A read may return fewer bytes at EOF. `SourceFile.ReadSourceFileLines()` instead uses its positive size hint as a threshold across complete returned lines, so it can exceed that hint by the last line.

### Cursor-sensitive operations

`ReadSourceFile()`, `ReadSourceFileLine()`, `WriteSourceFile()`, and `SaveSourceFile()` operate from the current cursor and advance it. `GetSourceFileSize()` always reports the complete file size. Call `SeekSourceFile(hFile, 0, SeekType.HEAD)` before saving when the destination must contain the whole source file. `SaveSourceFile()` opens the destination through `IFileSystem`, not the physical text helpers; use an absolute destination when a specific physical location is required, and prepare its directory separately. It borrows the source handle without closing it, owns and closes the destination handle, and accepts a bounded short read from the current cursor. It returns the number of bytes actually read and written; a failed write can leave a partial destination because saving is not transactional.

`TruncateSourceFile()` closes the supplied handle, rewrites the file, reopens it, and returns a package-level record. The native implementation record uses `Size` for the resulting size; the package exposes it as `FileSize`. There are no lowercase aliases. Temporary native read/write handles and the replacement handle are rollback-owned until explicitly closed or transferred. The returned native and package records have own data properties. Validation and retained-data read failures leave the supplied handle open. Immediately before attempting to close it, the native implementation relinquishes the original handle through private ownership state. A subsequent failure throws a package `Error` with own `OriginalHandleConsumed: true` and `cause` containing the original failure. This flag means the old handle must not be reused or closed again, even if the SDK close itself threw; it does not prove that close succeeded. Earlier failures propagate unchanged. The operation is not transactional.

| Field | Type | Meaning |
| --- | --- | --- |
| `Handle` | Opaque engine handle (`bigint`) | Replacement handle; the old handle is no longer valid |
| `FileSize` | number | Requested resulting size |
| `BytesWritten` | number | Bytes written while recreating the file |

When `nTargetSize` is `-1` or omitted by `SourceFile.TruncateSourceFile()`, the current cursor becomes the new file size. Values below `-1` are rejected. Modes containing `w` or `x` are reopened through a non-truncating equivalent after the rewrite.

| Use | Example |
| --- | --- |
| Shrink a plugin-owned scratch file opened with `"r+b"` in the engine's default search path. Import `TruncateSourceFile` from `filesystem`. Close the new handle, not the consumed one. On failure follow the ownership rule above. | `const ReopenedFile = TruncateSourceFile(hSourceFile, strScratchPath, "r+b", null, 16);` |

## SourceFile

`SourceFile` owns one engine handle and closes it through its `CloseSourceFile()` method or `SourceFile.UseSourceFile()`'s cleanup. Closing the raw handle separately does not update the wrapper's `Closed` state and can lead to reuse or double-closing of an invalid handle. Do not create competing owners. JavaScript garbage collection does not close the handle automatically.

### Construction

| API | Result |
| --- | --- |
| [`new SourceFile(hSourceFile, strFileMode = "rt", strFilePath = "", strPathID = "")`](#sourcefile) | Wraps an already-open native `bigint` handle and assumes close ownership |
| `SourceFile.OpenSourceFile(strFilePath, strFileMode = "rt", strPathID = null)` | Opens through `IFileSystem` and returns an owned wrapper |
| `SourceFile.UseSourceFile(strFilePath, SourceFileCallback, Options?)` | Opens, calls the callback with the owned wrapper, returns its result, and closes in `finally` |

`SourceFile.UseSourceFile()` accepts options `{ FileMode?: string, PathID?: string | null }`. Omitted or `undefined` options use defaults; `null`, arrays, and functions are rejected. It reads option values before opening the file, calls the callback once, and closes in `finally` unless the callback already closed the wrapper. A cleanup error can replace a callback error. It is the preferred API for short synchronous operations.

### Fields and properties

| Member | Type | Behavior |
| --- | --- | --- |
| `Handle` | Opaque engine `bigint` handle or `null` | Live owned handle; becomes `null` after a successful close |
| `FileMode` | string | Open mode used by `IsSourceFileReadable()` and `IsSourceFileWritable()` and for binary checks |
| `FilePath` | string | Source path needed when reopening after truncate |
| `PathID` | string | Source search-path ID, or empty string |
| `Closed` | boolean getter | Whether the wrapper no longer owns a handle |
| `FileSize` | number getter | Complete live file size; throws after close |
| `EndOfFile` | boolean getter | Live end-of-file state at the current cursor |
| `BinaryMode` | boolean getter | Whether `FileMode` contains `b` |

Treat `Handle`, `FileMode`, `FilePath`, and `PathID` as synchronized ownership metadata. Mutating these fields can leak a handle or make truncation reopen the wrong file.

### Methods

| Method | Result |
| --- | --- |
| `CheckSourceFileClosed()` | Throws if closed; otherwise returns `undefined` |
| `CheckSourceFileReadable()` | Throws unless the mode contains `r` or `+` |
| `CheckSourceFileWritable()` | Throws unless the mode contains `w`, `x`, `a`, or `+` |
| `ReadSourceFile(nSize = -1)` | `string` or `Uint8Array` according to `BinaryMode` |
| `ReadSourceFileLine(nSize = -1)` | One normalized text line or exact binary line |
| `ReadSourceFileLines(nSizeHint = -1)` | Lines until EOF, or until total returned string code units / binary bytes exceed a positive hint |
| `WriteSourceFile(FileData)` | `number` of bytes written |
| `WriteSourceFileLines(vecFileLines)` | Sum of bytes written; separators are not added automatically |
| `TruncateSourceFile(nTargetSize = -1)` | Resulting size; replaces the internal handle with the reopened one |
| `SeekSourceFile(nSeekOffset, unSeekTypeValue = SeekType.HEAD)` | `true` after moving the cursor |
| `GetSourceFileOffset()` | Current byte offset |
| `FlushSourceFile()` | `true` after flushing |
| `IsSourceFileTTY()` | `false` for a valid Source handle |
| `IsSourceFileSeekable()` | `true` for a valid Source handle |
| `GetSourceFileDescriptor()` | Throws because no OS descriptor exists |
| `IsSourceFileReadable()` | Whether the wrapper is open in a readable mode |
| `IsSourceFileWritable()` | Whether the wrapper is open in a writable mode |
| `SaveSourceFile(strDestinationPath)` | Bytes copied from the current cursor to an `IFileSystem` destination |
| `CloseSourceFile()` | `true` on first successful close, then `false` |

Methods that need a live handle reject a closed wrapper before touching the native runtime. `Closed`, `BinaryMode`, `IsSourceFileReadable()`, `IsSourceFileWritable()`, and repeated `CloseSourceFile()` remain safe to inspect or call after closure. During a synchronous `WriteSourceFile()` call, including data coercion and nested writes, the owning wrapper rejects `CloseSourceFile()`, `TruncateSourceFile()`, and assignment to `Handle` with an `Error` before they change the handle or call native cleanup. Protection is released when the write returns or throws, preserving the original failure. It does not defer IO or protect competing owners or direct raw-handle calls.

On truncation failure before ownership handoff, `SourceFile.TruncateSourceFile()` preserves its handle and `Closed` remains false. After handoff, it clears its handle and `Closed` becomes true, so repeated close does not call the native closer again. The thrown `Error` has `OriginalHandleConsumed: true` and retains the original failure as `cause`. Raw-handle callers must likewise discard the old handle when this flag is present. This ownership protocol does not undo a partial rewrite or guarantee successful SDK cleanup.

## SourceFileLease

`SourceFileLease` lets code consume a physical path without separately tracking whether that path is temporary.

| Member | Type | Behavior |
| --- | --- | --- |
| `FilePath` | string property | Physical path supplied to consumers |
| `TemporaryFile` | boolean property | Whether `ReleaseSourceFileLease()` owns deletion of `FilePath` |
| `ReleaseSourceFileLease()` | Method | Returns removal status for a temporary path; successful removal clears `TemporaryFile`, while a failed removal leaves it available for retry; permanent/already-released leases return `false` |
| `UseSourceFileLease(LeaseCallback)` | Method | Calls the callback with `FilePath`, returns its result, and releases in `finally` |

`AcquireSourceFileLease(strFilePath)` returns a non-temporary lease whenever `IsVPKFile()` is false, including when the path does not exist; acquiring such a lease is not an existence check. For a VPK-backed file it opens in binary mode, saves to a unique physical temporary path, and returns a temporary lease. Treat `FilePath` and `TemporaryFile` as ownership metadata: changing them can redirect or suppress deletion. Leases are not released by garbage collection. Cleanup in `UseSourceFileLease()` can replace a callback error, and a missing temporary file is still a failed removal rather than a successful release.

## Workflows

### Bootstrap and validate a plugin JSON file

This workflow uses only physical helpers. It preserves an existing settings file and removes only a file it attempted to create itself; the reusable directory is left in place. Run these fixed-path workflows in an isolated example-data directory without concurrent writers: existence checks are not an exclusive reservation. The manual cleanup examples retain a sole failure unchanged and report simultaneous operation/cleanup failures in an `AggregateError`, in that order. This does not change `UseSourceFile()`'s documented internal cleanup-error behavior.

```js
const { DoesFileExist, EnsureDirectoryExists, ReadTextFile, RemoveFile, WriteTextFile } = require("filesystem");
const { SOURCE_DATA_ROOT } = require("paths");

const g_VerifyPluginSettingsFile = () => {
	const strDataDirectoryPath = `${SOURCE_DATA_ROOT}/examples`;
	const strSettingsFilePath = `${strDataDirectoryPath}/filesystem-settings.json`;
	if (!EnsureDirectoryExists(strDataDirectoryPath)) {
		throw new Error(`Unable to create ${strDataDirectoryPath}.`);
	}

	const vecFailures = [];
	let bCreatedExampleFile = false;
	try {
		if (!DoesFileExist(strSettingsFilePath)) {
			bCreatedExampleFile = true;

			if (!WriteTextFile(strSettingsFilePath, `${JSON.stringify({ Enabled: true, UpdateIntervalSeconds: 15 }, null, 2)}\n`)) {
				throw new Error(`Unable to write ${strSettingsFilePath}.`);
			}
		}

		const strSettingsFileText = ReadTextFile(strSettingsFilePath);
		if (strSettingsFileText === null) {
			throw new Error(`Unable to read ${strSettingsFilePath}.`);
		}

		const Settings = JSON.parse(strSettingsFileText);
		if ((typeof Settings.Enabled !== "boolean") || !Number.isInteger(Settings.UpdateIntervalSeconds)) {
			throw new TypeError("The filesystem example settings are malformed.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (bCreatedExampleFile && DoesFileExist(strSettingsFilePath) && !RemoveFile(strSettingsFilePath)) {
				throw new Error(`Unable to remove ${strSettingsFilePath}.`);
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Settings validation and cleanup failed.");
	}
};

g_VerifyPluginSettingsFile();
```

### Append and inspect an audit log

`SourceFile.UseSourceFile()` makes closure deterministic even when formatting or writing throws. `WriteSourceFileLines()` writes each supplied string exactly, so newline characters are explicit. This isolated test refuses an existing log path instead of appending to and then deleting someone else's log.

```js
const { DoesFileExist, EnsureDirectoryExists, ReadTextFile, RemoveFile, SourceFile } = require("filesystem");
const { GetRuntimeInfo } = require("globals");
const { SOURCE_DATA_ROOT } = require("paths");

const g_VerifyAuditLog = () => {
	const strDataDirectoryPath = `${SOURCE_DATA_ROOT}/examples`;
	const strLogFilePath = `${strDataDirectoryPath}/filesystem-audit.log`;
	const strMapName = GetRuntimeInfo().MapName;
	if (!strMapName) {
		throw new Error("The audit-log example requires an active map.");
	}

	if (!EnsureDirectoryExists(strDataDirectoryPath)) {
		throw new Error(`Unable to create ${strDataDirectoryPath}.`);
	}

	if (DoesFileExist(strLogFilePath)) {
		throw new Error(`The isolated audit-log path already exists: ${strLogFilePath}.`);
	}

	const WriteAuditLog = (SourceFileValue) => {
		SourceFileValue.CheckSourceFileWritable();

		const unAuditLogBytesWritten = SourceFileValue.WriteSourceFileLines([`MapStart MapName=${strMapName}\n`, "PluginLoaded Name=filesystem-example\n"]);
		if (!SourceFileValue.FlushSourceFile()) {
			throw new Error("The audit log could not be flushed.");
		}

		return unAuditLogBytesWritten;
	};

	const vecFailures = [];
	try {
		const unAuditLogBytesWritten = SourceFile.UseSourceFile(strLogFilePath, WriteAuditLog, { FileMode: "at" });
		if (!Number.isInteger(unAuditLogBytesWritten) || (unAuditLogBytesWritten <= 0)) {
			throw new Error("The audit log write returned no bytes.");
		}

		const strAuditLogText = ReadTextFile(strLogFilePath);
		if ((strAuditLogText === null) || !strAuditLogText.includes("PluginLoaded")) {
			throw new Error("The audit record was not persisted.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (DoesFileExist(strLogFilePath) && !RemoveFile(strLogFilePath)) {
				throw new Error(`Unable to remove ${strLogFilePath}.`);
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Audit-log IO and cleanup failed.");
	}
};

g_VerifyAuditLog();
```

### Stream a line-oriented rules file

The loop observes the live `EndOfFile` property. It ignores comments and parses key/value records without loading unrelated engine files.

```js
const { DoesFileExist, EnsureDirectoryExists, RemoveFile, SourceFile, WriteTextFile } = require("filesystem");
const { SOURCE_DATA_ROOT } = require("paths");

const g_VerifyRulesFile = () => {
	const strDataDirectoryPath = `${SOURCE_DATA_ROOT}/examples`;
	const strRulesFilePath = `${strDataDirectoryPath}/filesystem-rules.txt`;
	if (!EnsureDirectoryExists(strDataDirectoryPath)) {
		throw new Error(`Unable to create ${strDataDirectoryPath}.`);
	}

	if (DoesFileExist(strRulesFilePath)) {
		throw new Error(`The isolated rules path already exists: ${strRulesFilePath}.`);
	}

	const vecFailures = [];
	let RulesSourceFile = null;
	try {
		if (!WriteTextFile(strRulesFilePath, "# example\nMaximumPlayers=8\nFriendlyFire=0\n")) {
			throw new Error(`Unable to write ${strRulesFilePath}.`);
		}

		RulesSourceFile = SourceFile.OpenSourceFile(strRulesFilePath, "rt");
		RulesSourceFile.CheckSourceFileClosed();
		RulesSourceFile.CheckSourceFileReadable();

		const mapRuleValues = new Map();
		while (!RulesSourceFile.EndOfFile) {
			const strRuleLine = RulesSourceFile.ReadSourceFileLine().trim();
			if ((strRuleLine.length === 0) || strRuleLine.startsWith("#")) {
				continue;
			}

			const nRuleSeparatorIndex = strRuleLine.indexOf("=");
			if (nRuleSeparatorIndex < 1) {
				throw new Error(`Malformed rule: ${strRuleLine}.`);
			}

			mapRuleValues.set(strRuleLine.slice(0, nRuleSeparatorIndex), strRuleLine.slice(nRuleSeparatorIndex + 1));
		}

		if (mapRuleValues.get("MaximumPlayers") !== "8") {
			throw new Error("The rules file was not parsed correctly.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if ((RulesSourceFile !== null) && !RulesSourceFile.CloseSourceFile()) {
				throw new Error("The rules file could not be closed.");
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}

		try {
			if (DoesFileExist(strRulesFilePath) && !RemoveFile(strRulesFilePath)) {
				throw new Error(`Unable to remove ${strRulesFilePath}.`);
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Rules-file IO and cleanup failed.");
	}
};

g_VerifyRulesFile();
```

### Write and inspect binary state

Binary mode preserves all bytes and returns `Uint8Array`. This isolated workflow refuses existing source or copy paths and demonstrates binary IO without truncation. For truncation ownership and failure handling, see [SourceFile](#sourcefile).

```js
const { DoesFileExist, EnsureDirectoryExists, RemoveFile, SeekType, SourceFile } = require("filesystem");
const { SOURCE_DATA_ROOT } = require("paths");

const g_VerifyBinaryState = () => {
	const strDataDirectoryPath = `${SOURCE_DATA_ROOT}/examples`;
	const strStateFilePath = `${strDataDirectoryPath}/filesystem-state.bin`;
	const strStateCopyFilePath = `${strDataDirectoryPath}/filesystem-state-copy.bin`;
	if (!EnsureDirectoryExists(strDataDirectoryPath)) {
		throw new Error(`Unable to create ${strDataDirectoryPath}.`);
	}

	if (DoesFileExist(strStateFilePath) || DoesFileExist(strStateCopyFilePath)) {
		throw new Error("An isolated binary state path already exists.");
	}

	const vecFailures = [];
	let StateSourceFile = null;
	try {
		StateSourceFile = SourceFile.OpenSourceFile(strStateFilePath, "wb+");
		if (!StateSourceFile.BinaryMode || !StateSourceFile.IsSourceFileReadable() || !StateSourceFile.IsSourceFileWritable()) {
			throw new Error("The binary state file has the wrong mode.");
		}

		if (StateSourceFile.WriteSourceFile(Uint8Array.from([0x53, 0x4A, 0x53, 0x01, 0xFF])) !== 5) {
			throw new Error("The binary state write returned the wrong byte count.");
		}

		if (!StateSourceFile.FlushSourceFile()) {
			throw new Error("The binary state file could not be flushed.");
		}

		if ((StateSourceFile.FileSize !== 5) || (StateSourceFile.GetSourceFileOffset() !== 5)) {
			throw new Error("The binary state size or cursor is incorrect.");
		}

		if (!StateSourceFile.SeekSourceFile(0, SeekType.HEAD)) {
			throw new Error("The binary state cursor could not seek to the head.");
		}

		const arrStateHeaderBytes = StateSourceFile.ReadSourceFile(4);
		if (!(arrStateHeaderBytes instanceof Uint8Array) || (arrStateHeaderBytes[0] !== 0x53) || (arrStateHeaderBytes[3] !== 0x01)) {
			throw new Error("The binary header did not round-trip.");
		}

		if (!StateSourceFile.SeekSourceFile(0, SeekType.HEAD)) {
			throw new Error("The binary state cursor could not return to the head.");
		}

		if (StateSourceFile.SaveSourceFile(strStateCopyFilePath) !== 5) {
			throw new Error("SourceFile.SaveSourceFile() did not copy the complete binary state.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if ((StateSourceFile !== null) && !StateSourceFile.CloseSourceFile()) {
				throw new Error("The binary state file could not be closed.");
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}

		for (const strCleanupFilePath of [strStateFilePath, strStateCopyFilePath]) {
			try {
				if (DoesFileExist(strCleanupFilePath) && !RemoveFile(strCleanupFilePath)) {
					throw new Error(`Unable to remove ${strCleanupFilePath}.`);
				}
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Binary-state IO and cleanup failed.");
	}
};

g_VerifyBinaryState();
```

### Exercise raw handle IO

`SaveSourceFile()` copies from the current cursor, so this isolated workflow seeks to the head first and refuses existing source or copy paths. It demonstrates saving rather than truncation; raw truncation callers must follow the ownership handoff documented under [SourceFile](#sourcefile).

```js
const {
	CloseSourceFile,
	DoesFileExist,
	EnsureDirectoryExists,
	FlushSourceFile,
	GetSourceFileDescriptor,
	GetSourceFileOffset,
	GetSourceFileSize,
	IsSourceFileAtEnd,
	IsSourceFileSeekable,
	IsSourceFileTTY,
	OpenSourceFile,
	ReadSourceFile,
	ReadSourceFileLine,
	RemoveFile,
	SaveSourceFile,
	SeekSourceFile,
	SeekType,
	WriteSourceFile,
	WriteTextFile,
} = require("filesystem");
const { SOURCE_DATA_ROOT } = require("paths");

const g_VerifyRawHandleOperations = () => {
	const strDataDirectoryPath = `${SOURCE_DATA_ROOT}/examples`;
	const strSourceFilePath = `${strDataDirectoryPath}/filesystem-raw.txt`;
	const strCopyFilePath = `${strDataDirectoryPath}/filesystem-raw-copy.txt`;
	if (!EnsureDirectoryExists(strDataDirectoryPath)) {
		throw new Error(`Unable to create ${strDataDirectoryPath}.`);
	}

	if (DoesFileExist(strSourceFilePath) || DoesFileExist(strCopyFilePath)) {
		throw new Error("An isolated raw file path already exists.");
	}

	const vecFailures = [];
	let hSourceFile = null;
	try {
		if (!WriteTextFile(strSourceFilePath, "alpha\nbeta\n")) {
			throw new Error(`Unable to write ${strSourceFilePath}.`);
		}

		const SourceFileRecord = OpenSourceFile(strSourceFilePath, "rb+");
		hSourceFile = SourceFileRecord.Handle;
		if (!SeekSourceFile(hSourceFile, 0, SeekType.TAIL)) {
			throw new Error("The raw cursor could not seek to the tail.");
		}

		if (WriteSourceFile(hSourceFile, Uint8Array.from([0x67, 0x61, 0x6D, 0x6D, 0x61, 0x0A])) !== 6) {
			throw new Error("The raw append returned the wrong byte count.");
		}

		if (!FlushSourceFile(hSourceFile)) {
			throw new Error("The raw file could not be flushed.");
		}

		if (!SeekSourceFile(hSourceFile, 0, SeekType.HEAD)) {
			throw new Error("The raw cursor could not seek to the head.");
		}

		if (ReadSourceFileLine(hSourceFile) !== "alpha\n") {
			throw new Error("Raw line reading failed.");
		}

		if (ReadSourceFile(hSourceFile, 4) !== "beta") {
			throw new Error("Raw bounded reading failed.");
		}

		if ((GetSourceFileOffset(hSourceFile) !== 10) || (GetSourceFileSize(hSourceFile) !== 17) || IsSourceFileAtEnd(hSourceFile)) {
			throw new Error("Raw cursor metadata is inconsistent.");
		}

		if (!IsSourceFileSeekable(hSourceFile) || IsSourceFileTTY(hSourceFile)) {
			throw new Error("Unexpected Source handle capabilities.");
		}

		let bDescriptorRejected = false;

		try {
			GetSourceFileDescriptor(hSourceFile);
		} catch (ErrorValue) {
			if (!String(ErrorValue.message).includes("descriptor")) {
				throw ErrorValue;
			}

			bDescriptorRejected = true;
		}

		if (!bDescriptorRejected) {
			throw new Error("Source handles must not expose OS descriptors.");
		}

		if (!SeekSourceFile(hSourceFile, 0, SeekType.HEAD)) {
			throw new Error("The raw cursor could not return to the head.");
		}

		if (SaveSourceFile(hSourceFile, strCopyFilePath) !== 17) {
			throw new Error("Raw save did not copy the complete file.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if ((hSourceFile !== null) && !CloseSourceFile(hSourceFile)) {
				throw new Error("The raw source file could not be closed.");
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}

		for (const strCleanupFilePath of [strSourceFilePath, strCopyFilePath]) {
			try {
				if (DoesFileExist(strCleanupFilePath) && !RemoveFile(strCleanupFilePath)) {
					throw new Error(`Unable to remove ${strCleanupFilePath}.`);
				}
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Raw file IO and cleanup failed.");
	}
};

g_VerifyRawHandleOperations();
```

### Wrap an existing native record

Successful `SourceFile` construction transfers close responsibility to the wrapper. Until construction succeeds, the raw caller still owns the handle and must close it on failure. Do not also call raw `CloseSourceFile()` after a wrapper takes ownership of the same handle.

```js
const { CloseSourceFile, DoesFileExist, EnsureDirectoryExists, OpenSourceFile, RemoveFile, SourceFile } = require("filesystem");
const { SOURCE_DATA_ROOT } = require("paths");

const g_VerifyWrappedNativeRecord = () => {
	const strDataDirectoryPath = `${SOURCE_DATA_ROOT}/examples`;
	const strWrappedFilePath = `${strDataDirectoryPath}/filesystem-wrapped.txt`;
	if (!EnsureDirectoryExists(strDataDirectoryPath)) {
		throw new Error(`Unable to create ${strDataDirectoryPath}.`);
	}

	if (DoesFileExist(strWrappedFilePath)) {
		throw new Error(`The isolated wrapper path already exists: ${strWrappedFilePath}.`);
	}

	const vecFailures = [];
	let hUnwrappedSourceFile = null;
	let WrappedSourceFile = null;
	try {
		const SourceFileRecord = OpenSourceFile(strWrappedFilePath, "wt", null);
		hUnwrappedSourceFile = SourceFileRecord.Handle;
		WrappedSourceFile = new SourceFile(SourceFileRecord.Handle, SourceFileRecord.FileMode, SourceFileRecord.FilePath, SourceFileRecord.PathID);
		hUnwrappedSourceFile = null;

		WrappedSourceFile.CheckSourceFileWritable();

		if (WrappedSourceFile.WriteSourceFile("owned by SourceFile\n") !== 20) {
			throw new Error("The wrapped SourceFile write returned the wrong byte count.");
		}

		if (WrappedSourceFile.IsSourceFileTTY() || !WrappedSourceFile.IsSourceFileSeekable()) {
			throw new Error("The wrapped Source handle has unexpected capabilities.");
		}

		let bDescriptorRejected = false;

		try {
			WrappedSourceFile.GetSourceFileDescriptor();
		} catch (DescriptorError) {
			if (!String(DescriptorError.message).includes("descriptor")) {
				throw DescriptorError;
			}

			bDescriptorRejected = true;
		}

		if (!bDescriptorRejected) {
			throw new Error("SourceFile must not expose an OS descriptor.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (WrappedSourceFile !== null) {
				if (!WrappedSourceFile.CloseSourceFile()) {
					throw new Error("The wrapped source file could not be closed.");
				}
			} else if ((hUnwrappedSourceFile !== null) && !CloseSourceFile(hUnwrappedSourceFile)) {
				throw new Error("The unwrapped source file could not be closed.");
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}

		try {
			if (DoesFileExist(strWrappedFilePath) && !RemoveFile(strWrappedFilePath)) {
				throw new Error(`Unable to remove ${strWrappedFilePath}.`);
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Wrapped file IO and cleanup failed.");
	}

	if (!WrappedSourceFile.Closed || WrappedSourceFile.CloseSourceFile()) {
		throw new Error("SourceFile close ownership is inconsistent.");
	}

	let bClosedGuardRejected = false;

	try {
		WrappedSourceFile.CheckSourceFileClosed();
	} catch (ClosedFileError) {
		if (!String(ClosedFileError.message).includes("closed")) {
			throw ClosedFileError;
		}

		bClosedGuardRejected = true;
	}

	if (!bClosedGuardRejected) {
		throw new Error("Closed SourceFile should reject CheckSourceFileClosed().");
	}
};

g_VerifyWrappedNativeRecord();
```

### Read all lines with a size hint

For a positive `nSizeHint`, `ReadSourceFileLines(nSizeHint)` stops when the accumulated returned text length or binary byte count exceeds the hint, or at EOF; it never splits a line to satisfy the hint. Zero and negative hints read until EOF. The hint must be a JavaScript safe integer.

```js
const { DoesFileExist, EnsureDirectoryExists, RemoveFile, SourceFile, WriteTextFile } = require("filesystem");
const { SOURCE_DATA_ROOT } = require("paths");

const g_VerifyQueueFile = () => {
	const strDataDirectoryPath = `${SOURCE_DATA_ROOT}/examples`;
	const strQueueFilePath = `${strDataDirectoryPath}/filesystem-queue.txt`;
	if (!EnsureDirectoryExists(strDataDirectoryPath)) {
		throw new Error(`Unable to create ${strDataDirectoryPath}.`);
	}

	if (DoesFileExist(strQueueFilePath)) {
		throw new Error(`The isolated queue path already exists: ${strQueueFilePath}.`);
	}

	const ReadQueueFile = (QueueSourceFile) => {
		const vecFirstQueueLineBatch = QueueSourceFile.ReadSourceFileLines(7);
		if (vecFirstQueueLineBatch.join("") !== "first\nsecond\n") {
			throw new Error("SourceFile.ReadSourceFileLines() did not preserve complete lines.");
		}
	};

	const vecFailures = [];
	try {
		if (!WriteTextFile(strQueueFilePath, "first\nsecond\nthird\n")) {
			throw new Error(`Unable to write ${strQueueFilePath}.`);
		}

		SourceFile.UseSourceFile(strQueueFilePath, ReadQueueFile);
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (DoesFileExist(strQueueFilePath) && !RemoveFile(strQueueFilePath)) {
				throw new Error(`Unable to remove ${strQueueFilePath}.`);
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Queue-file IO and cleanup failed.");
	}
};

g_VerifyQueueFile();
```

### Give an OS-only library a VPK-backed asset

The callback receives a physical path whether the selected asset is loose or packed. Cleanup attempts to delete a temporary extraction in `finally`, including callback failures; removal failure leaves `TemporaryFile` true and can replace the callback error.

```js
const { AcquireSourceFileLease, DoesFileExist, IsVPKFile, ReadTextFile } = require("filesystem");

const g_VerifyVPKBackedAsset = () => {
	const strAssetFilePath = "materials/vgui/white_additive.vmt";
	const bAssetPacked = IsVPKFile(strAssetFilePath);
	const SourceFileLease = AcquireSourceFileLease(strAssetFilePath);

	const ReadLeasedAsset = (strPhysicalFilePath) => {
		if (bAssetPacked && (strPhysicalFilePath === strAssetFilePath)) {
			throw new Error("A packed asset must be extracted to a physical path.");
		}

		if (!DoesFileExist(strPhysicalFilePath)) {
			throw new Error(`The leased asset does not exist: ${strPhysicalFilePath}.`);
		}

		const strAssetFileText = ReadTextFile(strPhysicalFilePath);
		if (strAssetFileText === null) {
			throw new Error(`Unable to read leased asset: ${strPhysicalFilePath}.`);
		}

		return strAssetFileText.length;
	};

	const unAssetTextLength = SourceFileLease.UseSourceFileLease(ReadLeasedAsset);
	if (unAssetTextLength === 0) {
		throw new Error("The leased material is empty.");
	}

	if (SourceFileLease.TemporaryFile || (bAssetPacked && DoesFileExist(SourceFileLease.FilePath))) {
		throw new Error("The VPK extraction lease was not released.");
	}
};

g_VerifyVPKBackedAsset();
```

### Own a custom temporary lease

Construct a temporary lease only for a path the plugin really owns. A generated path is not an exclusive reservation: this isolated example refuses an existing path and requires no concurrent writers. It also cleans up a partially written file when writing fails. `UseSourceFileLease()` attempts release in `finally` and flips `TemporaryFile` to `false` only after successful deletion.

```js
const { DoesFileExist, GetTemporaryFilePath, ReadTextFile, SourceFileLease, WriteTextFile } = require("filesystem");

const g_VerifyCustomTemporaryLease = () => {
	const strTemporaryFilePath = GetTemporaryFilePath("sourcejs-filesystem-example-");
	if (DoesFileExist(strTemporaryFilePath)) {
		throw new Error(`The isolated temporary path already exists: ${strTemporaryFilePath}.`);
	}

	const ReadSourceFileLeaseText = (strPhysicalFilePath) => {
		const strSourceFileLeaseText = ReadTextFile(strPhysicalFilePath);
		if (strSourceFileLeaseText === null) {
			throw new Error(`Unable to read ${strPhysicalFilePath}.`);
		}

		return strSourceFileLeaseText;
	};

	const vecFailures = [];
	const CustomSourceFileLease = new SourceFileLease(strTemporaryFilePath, true);
	try {
		if (!WriteTextFile(strTemporaryFilePath, "temporary payload")) {
			throw new Error(`Unable to write ${strTemporaryFilePath}.`);
		}

		const strLeasePayload = CustomSourceFileLease.UseSourceFileLease(ReadSourceFileLeaseText);
		if ((strLeasePayload !== "temporary payload") || DoesFileExist(strTemporaryFilePath) || CustomSourceFileLease.TemporaryFile) {
			throw new Error("The temporary lease lifecycle failed.");
		}

		if (CustomSourceFileLease.ReleaseSourceFileLease()) {
			throw new Error("A released lease must not delete twice.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (CustomSourceFileLease.TemporaryFile && DoesFileExist(CustomSourceFileLease.FilePath) && !CustomSourceFileLease.ReleaseSourceFileLease()) {
				throw new Error(`Unable to remove ${CustomSourceFileLease.FilePath}.`);
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Temporary lease IO and cleanup failed.");
	}
};

g_VerifyCustomTemporaryLease();
```

## Errors and ownership

- All operations are synchronous; ordinary plugin calls block the server/game thread. Keep engine-handle access on that thread and file sizes and per-tick work bounded.
- `SourceFile.OpenSourceFile()` throws when the engine cannot open the requested path.
- Wrapper read results use text or binary form according to `FileMode`. Writes take raw bytes from buffers/views and UTF-8 from other string-coercible values; a binary mode does not turn a JavaScript array into a byte buffer.
- `SourceFile.UseSourceFile()` and `SourceFileLease.UseSourceFileLease()` close or release in `finally`, including callback failures.
- After a successful wrapper close, further `SourceFile.CloseSourceFile()` calls return `false`. Raw `CloseSourceFile(hFile)` is not an ownership guard; never call it twice or after a wrapper has closed the same handle.
- Successful `TruncateSourceFile()` invalidates the old raw handle and supplies its replacement. Failure before ownership handoff leaves the old handle live; afterward, `OriginalHandleConsumed: true` prohibits reusing or closing it again. The wrapper clears its handle on such failures; see [SourceFile](#sourcefile).
- `SaveSourceFile()` advances the source cursor. Seek explicitly when later code depends on the cursor position.
- `GetSourceFileDescriptor()` always throws because Source `FileHandle_t` is not an OS descriptor. Use `AcquireSourceFileLease()` when another library requires a named physical file.
- `AcquireSourceFileLease()` cannot modify data inside a VPK. Changes to a temporary extracted path affect only that temporary copy.
- Plugin unload does not close arbitrary `SourceFile` instances automatically. Prefer scoped `SourceFile.UseSourceFile()` calls or close long-lived files from the plugin's unload handler.
