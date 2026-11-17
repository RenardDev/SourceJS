"use strict";

const { GetModule } = require("internal/runtime");

const g_FilesystemRuntime = GetModule("filesystem");
const g_NativeSeekTypes = g_FilesystemRuntime.GetSeekTypes();
const g_NativeOpenSourceFile = g_FilesystemRuntime.OpenSourceFile;
const g_NativeTruncateSourceFile = g_FilesystemRuntime.TruncateSourceFile;
const g_SeekType = Object.freeze({
	CURRENT: g_NativeSeekTypes.Current,
	HEAD: g_NativeSeekTypes.Head,
	TAIL: g_NativeSeekTypes.Tail,
});

function RequireSourceFileUseOptions(Options) {
	if (Options === undefined) {
		return {};
	}

	if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("SourceFile.UseSourceFile() Options must be an object.");
	}

	return Options;
}

function IsReadableFileMode(strFileMode) {
	return strFileMode.includes("r") || strFileMode.includes("+");
}

function IsWritableFileMode(strFileMode) {
	return strFileMode.includes("w") || strFileMode.includes("x") || strFileMode.includes("a") || strFileMode.includes("+");
}

function InvokeSourceFileTruncation(hSourceFile, strFilePath, strFileMode, strPathID, nTargetSize, OwnershipState) {
	// Prepare failure metadata before native code can relinquish the old handle.
	const ConsumedFailure = new Error("filesystem.TruncateSourceFile() failed after consuming the original handle.");
	Object.defineProperty(ConsumedFailure, "OriginalHandleConsumed", { value: true });
	Object.defineProperty(ConsumedFailure, "cause", { value: undefined, writable: true });
	const InvalidResultFailure = new TypeError("filesystem.TruncateSourceFile() returned an invalid handle record.");

	try {
		const TruncationResult = g_NativeTruncateSourceFile(hSourceFile, strFilePath, strFileMode, strPathID, nTargetSize, OwnershipState);
		if ((TruncationResult === null) || (typeof TruncationResult !== "object") || (typeof TruncationResult.Handle !== "bigint") || (TruncationResult.Handle <= 0n)) {
			throw InvalidResultFailure;
		}

		return TruncationResult;
	} catch (Failure) {
		if (!OwnershipState.OriginalHandleConsumed) {
			throw Failure;
		}

		ConsumedFailure.cause = Failure;
		throw ConsumedFailure;
	}
}

class SourceFile {
	constructor(hSourceFile, strFileMode = "rt", strFilePath = "", strPathID = "") {
		if ((typeof hSourceFile !== "bigint") || (hSourceFile <= 0n)) {
			throw new TypeError("SourceFile handle must be a positive bigint.");
		}

		if ((typeof strFileMode !== "string") || (strFileMode.length === 0) || (typeof strFilePath !== "string") || (typeof strPathID !== "string")) {
			throw new TypeError("SourceFile mode must be non-empty, and file path and path ID must be strings.");
		}

		this.#m_hSourceFile = hSourceFile;
		this.#m_strFileMode = strFileMode;
		this.#m_strFilePath = strFilePath;
		this.#m_strPathID = strPathID;
		this.#m_unActiveWriteCount = 0;
	}

	static OpenSourceFile(strFilePath, strFileMode = "rt", strPathID = null) {
		if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
			throw new TypeError("SourceFile.OpenSourceFile(strFilePath, strFileMode, strPathID) expects string strFilePath/strFileMode values and a string or null strPathID.");
		}

		if ((typeof strFileMode !== "string") || (strFileMode.length === 0) || ((strPathID !== null) && (typeof strPathID !== "string"))) {
			throw new TypeError("SourceFile.OpenSourceFile(strFilePath, strFileMode, strPathID) expects non-empty string strFilePath/strFileMode values and a string or null strPathID.");
		}

		const SourceFileInformation = g_NativeOpenSourceFile(strFilePath, strFileMode, strPathID);

		return new SourceFile(SourceFileInformation.Handle, SourceFileInformation.Mode, SourceFileInformation.Path, SourceFileInformation.PathID);
	}

	static UseSourceFile(strFilePath, SourceFileCallback, Options = undefined) {
		if (typeof SourceFileCallback !== "function") {
			throw new TypeError("SourceFile.UseSourceFile(strFilePath, SourceFileCallback, Options?) expects a callback function.");
		}

		const SelectedSourceFileOptions = RequireSourceFileUseOptions(Options);
		const strSelectedFileMode = SelectedSourceFileOptions.FileMode;
		const strSelectedPathID = SelectedSourceFileOptions.PathID;
		const strFileMode = (strSelectedFileMode === undefined) ? "rt" : strSelectedFileMode;
		const strPathID = (strSelectedPathID === undefined) ? null : strSelectedPathID;
		const SourceFileInstance = SourceFile.OpenSourceFile(strFilePath, strFileMode, strPathID);
		try {
			return SourceFileCallback(SourceFileInstance);
		} finally {
			if (!SourceFileInstance.Closed && !SourceFileInstance.CloseSourceFile()) {
				throw new Error("SourceFile.UseSourceFile() could not close the file.");
			}
		}
	}

	ReadSourceFile(nSize = -1) {
		this.CheckSourceFileClosed();
		this.CheckSourceFileReadable();

		return g_FilesystemRuntime.ReadSourceFile(this.#m_hSourceFile, nSize, this.BinaryMode);
	}

	ReadSourceFileLine(nSize = -1) {
		this.CheckSourceFileClosed();
		this.CheckSourceFileReadable();

		return g_FilesystemRuntime.ReadSourceFileLine(this.#m_hSourceFile, nSize, this.BinaryMode);
	}

	ReadSourceFileLines(nSizeHint = -1) {
		this.CheckSourceFileClosed();
		this.CheckSourceFileReadable();

		if (!Number.isSafeInteger(nSizeHint)) {
			throw new TypeError("SourceFile.ReadSourceFileLines() size hint must be a safe integer.");
		}

		const vecFileLines = [];
		let unReadLength = 0;
		while (!this.EndOfFile) {
			const FileLine = this.ReadSourceFileLine();
			vecFileLines.push(FileLine);
			unReadLength += (typeof FileLine === "string") ? FileLine.length : FileLine.byteLength;

			if ((nSizeHint > 0) && (unReadLength > nSizeHint)) {
				break;
			}
		}

		return vecFileLines;
	}

	WriteSourceFile(FileData) {
		this.CheckSourceFileClosed();
		this.CheckSourceFileWritable();

		++this.#m_unActiveWriteCount;
		try {
			return g_FilesystemRuntime.WriteSourceFile(this.#m_hSourceFile, FileData);
		} finally {
			--this.#m_unActiveWriteCount;
		}
	}

	WriteSourceFileLines(vecFileLines) {
		this.CheckSourceFileClosed();
		this.CheckSourceFileWritable();

		if (!Array.isArray(vecFileLines)) {
			throw new TypeError("SourceFile.WriteSourceFileLines() expects an array.");
		}

		let unWrittenByteCount = 0;
		for (const FileLine of vecFileLines) {
			unWrittenByteCount += this.WriteSourceFile(FileLine);
		}

		return unWrittenByteCount;
	}

	TruncateSourceFile(nTargetSize = -1) {
		this.CheckSourceFileClosed();
		this.#CheckSourceFileOwnershipChangeAllowed();

		const hSourceFile = this.#m_hSourceFile;
		const strFilePath = this.#m_strFilePath;
		const strFileMode = this.#m_strFileMode;
		const strPathID = this.#m_strPathID;
		if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
			throw new TypeError("SourceFile.TruncateSourceFile() requires a non-empty string file path.");
		}

		if ((typeof strFileMode !== "string") || (strFileMode.length === 0) || (typeof strPathID !== "string")) {
			throw new TypeError("SourceFile.TruncateSourceFile() requires a non-empty mode and string path ID.");
		}

		if (!IsWritableFileMode(strFileMode)) {
			throw new Error("File is not writable.");
		}

		const OwnershipState = { OriginalHandleConsumed: false };
		try {
			const TruncationResult = InvokeSourceFileTruncation(hSourceFile, strFilePath, strFileMode, strPathID, nTargetSize, OwnershipState);
			this.#m_hSourceFile = TruncationResult.Handle;

			return TruncationResult.Size;
		} catch (Failure) {
			if (OwnershipState.OriginalHandleConsumed) {
				this.#m_hSourceFile = null;
			}

			throw Failure;
		}
	}

	CloseSourceFile() {
		if (this.Closed) {
			return false;
		}

		this.#CheckSourceFileOwnershipChangeAllowed();

		const bCloseResult = g_FilesystemRuntime.CloseSourceFile(this.#m_hSourceFile);
		if (bCloseResult) {
			this.#m_hSourceFile = null;
		}

		return bCloseResult;
	}

	SeekSourceFile(nSeekOffset, unSeekTypeValue = g_SeekType.HEAD) {
		this.CheckSourceFileClosed();

		return g_FilesystemRuntime.SeekSourceFile(this.#m_hSourceFile, nSeekOffset, unSeekTypeValue);
	}

	FlushSourceFile() {
		this.CheckSourceFileClosed();

		return g_FilesystemRuntime.FlushSourceFile(this.#m_hSourceFile);
	}

	SaveSourceFile(strDestinationPath) {
		if ((typeof strDestinationPath !== "string") || (strDestinationPath.length === 0)) {
			throw new TypeError("SourceFile.SaveSourceFile() expects a non-empty destination path.");
		}

		this.CheckSourceFileClosed();

		return g_FilesystemRuntime.SaveSourceFile(this.#m_hSourceFile, strDestinationPath);
	}

	GetSourceFileOffset() {
		this.CheckSourceFileClosed();

		return g_FilesystemRuntime.GetSourceFileOffset(this.#m_hSourceFile);
	}

	IsSourceFileTTY() {
		this.CheckSourceFileClosed();

		return g_FilesystemRuntime.IsSourceFileTTY(this.#m_hSourceFile);
	}

	IsSourceFileSeekable() {
		this.CheckSourceFileClosed();

		return g_FilesystemRuntime.IsSourceFileSeekable(this.#m_hSourceFile);
	}

	GetSourceFileDescriptor() {
		this.CheckSourceFileClosed();

		return g_FilesystemRuntime.GetSourceFileDescriptor(this.#m_hSourceFile);
	}

	IsSourceFileReadable() {
		if (this.Closed) {
			return false;
		}

		const strFileMode = this.#m_strFileMode;

		return IsReadableFileMode(strFileMode);
	}

	IsSourceFileWritable() {
		if (this.Closed) {
			return false;
		}

		const strFileMode = this.#m_strFileMode;

		return IsWritableFileMode(strFileMode);
	}

	get Handle() {
		return this.#m_hSourceFile;
	}

	set Handle(hSourceFile) {
		this.#CheckSourceFileOwnershipChangeAllowed();

		this.#m_hSourceFile = hSourceFile;
	}

	get FileMode() {
		return this.#m_strFileMode;
	}

	set FileMode(strFileMode) {
		this.#m_strFileMode = strFileMode;
	}

	get FilePath() {
		return this.#m_strFilePath;
	}

	set FilePath(strFilePath) {
		this.#m_strFilePath = strFilePath;
	}

	get PathID() {
		return this.#m_strPathID;
	}

	set PathID(strPathID) {
		this.#m_strPathID = strPathID;
	}

	get Closed() {
		return this.#m_hSourceFile === null;
	}

	get FileSize() {
		this.CheckSourceFileClosed();

		return g_FilesystemRuntime.GetSourceFileSize(this.#m_hSourceFile);
	}

	get EndOfFile() {
		this.CheckSourceFileClosed();

		return g_FilesystemRuntime.IsSourceFileAtEnd(this.#m_hSourceFile);
	}

	get BinaryMode() {
		return this.#m_strFileMode.includes("b");
	}

	CheckSourceFileClosed() {
		if (this.Closed) {
			throw new Error("File is already closed.");
		}
	}

	CheckSourceFileReadable() {
		if (!this.IsSourceFileReadable()) {
			throw new Error("File is not readable.");
		}
	}

	CheckSourceFileWritable() {
		if (!this.IsSourceFileWritable()) {
			throw new Error("File is not writable.");
		}
	}

	#CheckSourceFileOwnershipChangeAllowed() {
		if (this.#m_unActiveWriteCount > 0) {
			throw new Error("SourceFile ownership cannot change during an active write.");
		}
	}

	#m_hSourceFile;
	#m_strFileMode;
	#m_strFilePath;
	#m_strPathID;
	#m_unActiveWriteCount;
}

class SourceFileLease {
	constructor(strFilePath, bTemporaryFile) {
		if ((typeof strFilePath !== "string") || (strFilePath.length === 0) || (typeof bTemporaryFile !== "boolean")) {
			throw new TypeError("SourceFileLease expects a non-empty string path and boolean temporary state.");
		}

		this.#m_strFilePath = strFilePath;
		this.#m_bTemporaryFile = bTemporaryFile;
	}

	ReleaseSourceFileLease() {
		const bTemporaryFile = this.#m_bTemporaryFile;
		if (typeof bTemporaryFile !== "boolean") {
			throw new TypeError("SourceFileLease TemporaryFile must be a boolean.");
		}

		if (!bTemporaryFile) {
			return false;
		}

		const strFilePath = this.#m_strFilePath;
		if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
			throw new TypeError("SourceFileLease FilePath must be a non-empty string.");
		}

		const bFileRemoved = g_FilesystemRuntime.RemoveFile(strFilePath);
		if (bFileRemoved) {
			this.#m_bTemporaryFile = false;
		}

		return bFileRemoved;
	}

	UseSourceFileLease(LeaseCallback) {
		if (typeof LeaseCallback !== "function") {
			throw new TypeError("SourceFileLease.UseSourceFileLease() expects a callback function.");
		}

		try {
			return LeaseCallback(this.#m_strFilePath);
		} finally {
			if (this.#m_bTemporaryFile && !this.ReleaseSourceFileLease()) {
				throw new Error("SourceFileLease.UseSourceFileLease() could not remove the temporary file.");
			}
		}
	}

	get FilePath() {
		return this.#m_strFilePath;
	}

	set FilePath(strFilePath) {
		this.#m_strFilePath = strFilePath;
	}

	get TemporaryFile() {
		return this.#m_bTemporaryFile;
	}

	set TemporaryFile(bTemporaryFile) {
		this.#m_bTemporaryFile = bTemporaryFile;
	}

	#m_strFilePath;
	#m_bTemporaryFile;
}

function OpenSourceFile(strFilePath, strFileMode = "rt", strPathID = null) {
	const SourceFileInformation = g_NativeOpenSourceFile(strFilePath, strFileMode, strPathID);

	return { Handle: SourceFileInformation.Handle, FileMode: SourceFileInformation.Mode, FilePath: SourceFileInformation.Path, PathID: SourceFileInformation.PathID };
}

function TruncateSourceFile(hSourceFile, strFilePath, strFileMode, strPathID, nTargetSize = -1) {
	const OwnershipState = { OriginalHandleConsumed: false };
	const TruncationResult = InvokeSourceFileTruncation(hSourceFile, strFilePath, strFileMode, strPathID, nTargetSize, OwnershipState);

	return { Handle: TruncationResult.Handle, BytesWritten: TruncationResult.BytesWritten, FileSize: TruncationResult.Size };
}

function AcquireSourceFileLease(strFilePath) {
	if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
		throw new TypeError("filesystem.AcquireSourceFileLease(strFilePath) expects a non-empty string file path.");
	}

	if (!g_FilesystemRuntime.IsVPKFile(strFilePath)) {
		return new SourceFileLease(strFilePath, false);
	}

	const strTemporaryFilePath = g_FilesystemRuntime.GetTemporaryFilePath("sourcejs-vpk-");
	if ((typeof strTemporaryFilePath !== "string") || (strTemporaryFilePath.length === 0)) {
		throw new TypeError("filesystem.GetTemporaryFilePath() must return a non-empty string path.");
	}

	const SaveOpenedSourceFile = (OpenedSourceFile) => OpenedSourceFile.SaveSourceFile(strTemporaryFilePath);

	try {
		SourceFile.UseSourceFile(strFilePath, SaveOpenedSourceFile, { FileMode: "rb" });
	} catch (SourceFileError) {
		// The source may have failed before creating this file; ignore a false removal status.
		g_FilesystemRuntime.RemoveFile(strTemporaryFilePath);

		throw SourceFileError;
	}

	return new SourceFileLease(strTemporaryFilePath, true);
}

g_FilesystemRuntime.AcquireSourceFileLease = AcquireSourceFileLease;
g_FilesystemRuntime.OpenSourceFile = OpenSourceFile;
g_FilesystemRuntime.SeekType = g_SeekType;
g_FilesystemRuntime.SourceFile = SourceFile;
g_FilesystemRuntime.SourceFileLease = SourceFileLease;
g_FilesystemRuntime.TruncateSourceFile = TruncateSourceFile;

module.exports = g_FilesystemRuntime;
