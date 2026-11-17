"use strict";

const { EnsureDirectoryExists, SourceFile } = require("filesystem");
const { GetModule } = require("internal/runtime");
const { LOG_ROOT } = require("paths");

const g_LogLevels = Object.freeze({
	DEBUG: 10,
	INFO: 20,
	WARNING: 30,
	ERROR: 40,
	CRITICAL: 50,
	MESSAGE: 60,
});

const g_LogArea = Object.freeze({
	CONSOLE: 1 << 0,
	MAIN: 1 << 1,
	SOURCEJS: 1 << 2,
	SCRIPT: 1 << 3,
	ALL: (1 << 4) - 1,
});

const g_strDefaultDateFormat = "yyyy-MM-dd HH:mm:ss";
const g_strDefaultRecordFormat = "{Timestamp} - {LoggerName}\t-\t{LevelName}\t{Message}";

const g_mapLogLevelNames = new Map([
	[g_LogLevels.DEBUG, "DEBUG"],
	[g_LogLevels.INFO, "INFO"],
	[g_LogLevels.WARNING, "WARNING"],
	[g_LogLevels.ERROR, "ERROR"],
	[g_LogLevels.CRITICAL, "CRITICAL"],
	[g_LogLevels.MESSAGE, "MESSAGE"],
]);
const g_LoggersRuntime = GetModule("loggers");

function ResolveIntegerValue(IntegerSource, strValueName) {
	let ResolvedIntegerValue = IntegerSource;
	if ((IntegerSource !== null) && ((typeof IntegerSource === "object") || (typeof IntegerSource === "function"))) {
		const GetInteger = IntegerSource.GetInteger;
		if (GetInteger !== undefined) {
			if (typeof GetInteger !== "function") {
				throw new TypeError(`${strValueName} GetInteger must be a function.`);
			}

			ResolvedIntegerValue = GetInteger.call(IntegerSource);
		}
	}

	if (!Number.isSafeInteger(ResolvedIntegerValue)) {
		throw new TypeError(`${strValueName} must be an integer or expose GetInteger() returning a safe integer.`);
	}

	return ResolvedIntegerValue;
}

function ResolveLogLevel(LogLevelSource) {
	return ResolveIntegerValue(LogLevelSource, "Log level");
}

function GetLogLevelName(nLogLevel) {
	const strLogLevelName = g_mapLogLevelNames.get(nLogLevel);
	if (strLogLevelName === undefined) {
		return String(nLogLevel);
	}

	return strLogLevelName;
}

function WriteRuntimeLog(nLogLevel, strLogMessage) {
	// Preserve the public script-level routing contract: the native sink exposes only INFO/WARNING/ERROR.
	const InformationLogger = g_LoggersRuntime.LogInfo;
	const WarningLogger = g_LoggersRuntime.LogWarning;
	const ErrorLogger = g_LoggersRuntime.LogError;

	if (nLogLevel === g_LogLevels.MESSAGE) {
		return InformationLogger(strLogMessage);
	}

	if (nLogLevel >= g_LogLevels.ERROR) {
		return ErrorLogger(strLogMessage);
	}

	if (nLogLevel >= g_LogLevels.WARNING) {
		return WarningLogger(strLogMessage);
	}

	return InformationLogger(strLogMessage);
}

function StringifyLogValue(LogValue) {
	if (LogValue instanceof Error) {
		return LogValue.stack || LogValue.message;
	}

	if (typeof LogValue === "string") {
		return LogValue;
	}

	if (typeof LogValue === "bigint") {
		return LogValue.toString();
	}

	const strSerializedValue = JSON.stringify(LogValue);
	if (strSerializedValue === undefined) {
		return String(LogValue);
	}

	return strSerializedValue;
}

function FormatNumericLogValue(dblLogValue, bIntegerFormat) {
	if ((typeof dblLogValue !== "number") || !Number.isFinite(dblLogValue)) {
		throw new TypeError("Numeric log format tokens require finite numbers.");
	}

	return bIntegerFormat ? Math.trunc(dblLogValue) : dblLogValue;
}

function FormatLogMessage(strMessage, vecFormatArguments) {
	if (typeof strMessage !== "string") {
		throw new TypeError("Log message must be a string.");
	}

	let unFormatArgumentIndex = 0;
	let strFormattedMessage = strMessage.replace(/%([sdifjoO%])/g, (strMatchedToken, strFormatToken) => {
		if (strFormatToken === "%") {
			return "%";
		}

		if (unFormatArgumentIndex >= vecFormatArguments.length) {
			return strMatchedToken;
		}

		const FormatValue = vecFormatArguments[unFormatArgumentIndex];
		unFormatArgumentIndex += 1;

		if ((strFormatToken === "d") || (strFormatToken === "i")) {
			return String(FormatNumericLogValue(FormatValue, true));
		}

		if (strFormatToken === "f") {
			return String(FormatNumericLogValue(FormatValue, false));
		}

		if ((strFormatToken === "j") || (strFormatToken === "o") || (strFormatToken === "O")) {
			return StringifyLogValue(FormatValue);
		}

		return String(FormatValue);
	});

	for (; unFormatArgumentIndex < vecFormatArguments.length; ++unFormatArgumentIndex) {
		strFormattedMessage += ` ${StringifyLogValue(vecFormatArguments[unFormatArgumentIndex])}`;
	}

	return strFormattedMessage;
}

function FormatLogDate(LogDate, strDateFormat = g_strDefaultDateFormat) {
	if (!(LogDate instanceof Date) || !Number.isFinite(LogDate.getTime())) {
		throw new TypeError("Log date must be a valid Date.");
	}

	if ((strDateFormat !== null) && (typeof strDateFormat !== "string")) {
		throw new TypeError("Log date format must be a string or null.");
	}

	const strSelectedDateFormat = (strDateFormat === null) ? g_strDefaultDateFormat : strDateFormat;
	const PadDateComponent = (unComponentValue, unComponentWidth = 2) => String(unComponentValue).padStart(unComponentWidth, "0");
	const DateTokenValues = {
		Year: String(LogDate.getFullYear()),
		Month: PadDateComponent(LogDate.getMonth() + 1),
		Day: PadDateComponent(LogDate.getDate()),
		Hour: PadDateComponent(LogDate.getHours()),
		Minute: PadDateComponent(LogDate.getMinutes()),
		Second: PadDateComponent(LogDate.getSeconds()),
		Millisecond: PadDateComponent(LogDate.getMilliseconds(), 3),
	};

	return strSelectedDateFormat.replaceAll("%Y", DateTokenValues.Year).replaceAll("%m", DateTokenValues.Month).replaceAll("%d", DateTokenValues.Day).replaceAll("%H", DateTokenValues.Hour).replaceAll("%M", DateTokenValues.Minute).replaceAll("%S", DateTokenValues.Second).replaceAll("yyyy", DateTokenValues.Year).replaceAll("MM", DateTokenValues.Month).replaceAll("dd", DateTokenValues.Day).replaceAll("HH", DateTokenValues.Hour).replaceAll("mm", DateTokenValues.Minute).replaceAll("ss", DateTokenValues.Second).replaceAll("SSS", DateTokenValues.Millisecond);
}

function FormatLogRecord(strRecordFormat, strDateFormat, LogRecord) {
	if ((strRecordFormat !== null) && (typeof strRecordFormat !== "string")) {
		throw new TypeError("Log record format must be a string or null.");
	}

	if (!LogRecord || (typeof LogRecord !== "object") || Array.isArray(LogRecord)) {
		throw new TypeError("Log record must be an object.");
	}

	const strSelectedRecordFormat = (strRecordFormat === null) ? g_strDefaultRecordFormat : strRecordFormat;
	const RecordTokenValues = {
		Timestamp: FormatLogDate(LogRecord.Date, strDateFormat),
		LoggerName: LogRecord.LoggerName,
		LevelName: LogRecord.LevelName,
		Message: LogRecord.Message,
	};
	if ((typeof RecordTokenValues.LoggerName !== "string") || (typeof RecordTokenValues.LevelName !== "string") || (typeof RecordTokenValues.Message !== "string")) {
		throw new TypeError("Log record name, level, and message must be strings.");
	}

	// Match only the template: field text must never become another format token.
	const strFormattedRecord = strSelectedRecordFormat.replace(/\{(?:Timestamp|LoggerName|LevelName|Message)\}|%\((?:Timestamp|LoggerName|LevelName|Message)\)s/g, (strToken) => {
		const strFieldName = strToken.startsWith("{") ? strToken.slice(1, -1) : strToken.slice(2, -2);

		return RecordTokenValues[strFieldName];
	});

	return strFormattedRecord;
}

function JoinLogPath(strRootPath, strChildPath) {
	if ((typeof strRootPath !== "string") || (typeof strChildPath !== "string") || (strChildPath.length === 0)) {
		throw new TypeError("Log root and child paths must be strings, and the child path must not be empty.");
	}

	if (/^[A-Za-z]:[\\/]|^\\\\|^\//.test(strChildPath) || (strRootPath.length === 0)) {
		return strChildPath;
	}

	const strPathSeparator = strRootPath.includes("\\") ? "\\" : "/";
	const strNormalizedRootPath = strRootPath.replace(/[\\/]+$/, "");
	const strNormalizedChildPath = strChildPath.replace(/^[\\/]+/, "");

	return `${strNormalizedRootPath}${strPathSeparator}${strNormalizedChildPath}`;
}

function GetLogDirectoryPath(strFilePath) {
	const nSeparatorIndex = Math.max(strFilePath.lastIndexOf("\\"), strFilePath.lastIndexOf("/"));

	return (nSeparatorIndex >= 0) ? strFilePath.slice(0, nSeparatorIndex) : "";
}

function NormalizeLogFilePath(strFilePath) {
	if (strFilePath === null) {
		return null;
	}

	if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
		throw new TypeError("Log file path must be a string or null, and strings must not be empty.");
	}

	let strNormalizedPath = strFilePath;
	if (!strNormalizedPath.toLowerCase().endsWith(".log")) {
		strNormalizedPath = `${strNormalizedPath}.log`;
	}

	if (!/^[A-Za-z]:[\\/]|^\\\\|^\//.test(strNormalizedPath)) {
		strNormalizedPath = JoinLogPath(LOG_ROOT, strNormalizedPath);
	}

	return strNormalizedPath;
}

function GetUTF8ByteCount(strText) {
	const unMaximumASCIICodePoint = 0x7F;
	const unMaximumTwoByteCodePoint = 0x7FF;
	const unMaximumThreeByteCodePoint = 0xFFFF;

	let unByteCount = 0;
	for (const strCharacter of strText) {
		const unCodePoint = strCharacter.codePointAt(0);
		if (unCodePoint <= unMaximumASCIICodePoint) {
			unByteCount += 1;
		} else if (unCodePoint <= unMaximumTwoByteCodePoint) {
			unByteCount += 2;
		} else if (unCodePoint <= unMaximumThreeByteCodePoint) {
			unByteCount += 3;
		} else {
			unByteCount += 4;
		}
	}

	return unByteCount;
}

function AppendLogLine(strFilePath, strLogLine) {
	if (strFilePath === null) {
		return false;
	}

	if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
		throw new TypeError("Log file path must be a string or null, and strings must not be empty.");
	}

	if (typeof strLogLine !== "string") {
		throw new TypeError("Log line must be a string.");
	}

	const strDirectoryPath = GetLogDirectoryPath(strFilePath);
	if ((strDirectoryPath.length > 0) && !EnsureDirectoryExists(strDirectoryPath)) {
		throw new Error(`Could not create log directory: ${strDirectoryPath}`);
	}

	const strLogText = `${strLogLine}\n`;
	const unExpectedByteCount = GetUTF8ByteCount(strLogText);
	const LogFile = SourceFile.OpenSourceFile(strFilePath, "at");
	let bOperationFailed = false;
	let OperationError = null;
	try {
		const unWrittenByteCount = LogFile.WriteSourceFile(strLogText);
		if (unWrittenByteCount !== unExpectedByteCount) {
			throw new Error(`Could not append log file: ${strFilePath} (expected ${unExpectedByteCount} bytes, wrote ${unWrittenByteCount}).`);
		}

		if (!LogFile.FlushSourceFile()) {
			throw new Error(`Could not flush log file: ${strFilePath}`);
		}
	} catch (ErrorValue) {
		bOperationFailed = true;
		OperationError = ErrorValue;
	}

	let bCloseFailed = false;
	let CloseError = null;
	try {
		if (!LogFile.CloseSourceFile()) {
			throw new Error(`Could not close log file: ${strFilePath}`);
		}
	} catch (ErrorValue) {
		bCloseFailed = true;
		CloseError = ErrorValue;
	}

	if (bOperationFailed) {
		if (bCloseFailed) {
			throw new AggregateError([OperationError, CloseError], `Could not append log file: ${strFilePath}`);
		}

		throw OperationError;
	}

	if (bCloseFailed) {
		throw CloseError;
	}

	return true;
}

class LogInstance {
	constructor(ParentLogger = null, strLoggerName = "", LoggerOptions = {}) {
		if ((ParentLogger !== null) && !(ParentLogger instanceof LogInstance)) {
			throw new TypeError("LogInstance parent must be another LogInstance or null.");
		}

		if ((new.target === LogInstance) && (ParentLogger === null)) {
			throw new TypeError("Standalone LogInstance objects require a parent logger.");
		}

		if ((typeof strLoggerName !== "string") || !LoggerOptions || (typeof LoggerOptions !== "object") || Array.isArray(LoggerOptions)) {
			throw new TypeError("LogInstance requires a string name and options object.");
		}

		const strLoggerPrefix = Object.hasOwn(LoggerOptions, "Prefix") ? LoggerOptions.Prefix : ((ParentLogger === null) ? "" : ParentLogger.Prefix);
		if (typeof strLoggerPrefix !== "string") {
			throw new TypeError("Logger prefix must be a string.");
		}

		this.#m_ParentLogger = ParentLogger;
		this.#m_strLocalLoggerName = strLoggerName;
		this.#m_mapChildLoggers = new Map();
		this.#m_strPrefix = strLoggerPrefix;
	}

	GetOrCreateChildLogger(strChildLoggerName) {
		if ((typeof strChildLoggerName !== "string") || (strChildLoggerName.length === 0)) {
			throw new TypeError("Child logger name must be a string; a non-empty string is required.");
		}

		const mapChildLoggers = this.#m_mapChildLoggers;
		if (!(mapChildLoggers instanceof Map)) {
			throw new TypeError("Logger children must be a Map.");
		}

		if (!mapChildLoggers.has(strChildLoggerName)) {
			const ChildLogger = new LogInstance(this, strChildLoggerName, { Prefix: this.Prefix });
			mapChildLoggers.set(strChildLoggerName, ChildLogger);
			return ChildLogger;
		}

		const ChildLogger = mapChildLoggers.get(strChildLoggerName);
		if (!(ChildLogger instanceof LogInstance)) {
			throw new TypeError("Registered child logger must be a LogInstance.");
		}

		return ChildLogger;
	}

	DeleteChildLogger(strChildLoggerName) {
		if ((typeof strChildLoggerName !== "string") || (strChildLoggerName.length === 0)) {
			throw new TypeError("Child logger name must be a string; a non-empty string is required.");
		}

		const mapChildLoggers = this.#m_mapChildLoggers;
		if (!(mapChildLoggers instanceof Map)) {
			throw new TypeError("Logger children must be a Map.");
		}

		if (!mapChildLoggers.has(strChildLoggerName)) {
			return false;
		}

		const ChildLogger = mapChildLoggers.get(strChildLoggerName);
		if (!(ChildLogger instanceof LogInstance)) {
			throw new TypeError("Registered child logger must be a LogInstance.");
		}

		ChildLogger.ClearChildLoggers();

		return mapChildLoggers.delete(strChildLoggerName);
	}

	ClearChildLoggers() {
		const setPendingLoggers = new Set([this]);
		const setVisitedLoggers = new Set();
		while (setPendingLoggers.size > 0) {
			const CurrentLogger = setPendingLoggers.values().next().value;
			setPendingLoggers.delete(CurrentLogger);

			if (setVisitedLoggers.has(CurrentLogger)) {
				throw new Error("Logger child tree contains a repeated or cyclic logger.");
			}

			const mapChildLoggers = CurrentLogger.#m_mapChildLoggers;
			if (!(mapChildLoggers instanceof Map)) {
				throw new TypeError("Logger children must be a Map.");
			}

			setVisitedLoggers.add(CurrentLogger);

			for (const ChildLogger of mapChildLoggers.values()) {
				if (!(ChildLogger instanceof LogInstance)) {
					throw new TypeError("Registered child logger must be a LogInstance.");
				}

				// A Set must not silently coalesce two pending references to the same child.
				if (setPendingLoggers.has(ChildLogger)) {
					throw new Error("Logger child tree contains a repeated or cyclic logger.");
				}

				setPendingLoggers.add(ChildLogger);
			}
		}

		for (const VisitedLogger of setVisitedLoggers) {
			VisitedLogger.#m_mapChildLoggers.clear();
		}
	}

	LogAtLevel(LogLevel, strLogMessage, ...vecFormatArguments) {
		const nResolvedLogLevel = ResolveLogLevel(LogLevel);
		const nMinimumLogLevel = this.LogLevel;
		if ((nResolvedLogLevel < nMinimumLogLevel) && (nResolvedLogLevel !== g_LogLevels.MESSAGE)) {
			return false;
		}

		const strLoggerPrefix = this.Prefix;
		if (typeof strLoggerPrefix !== "string") {
			throw new TypeError("Logger prefix must be a string.");
		}

		const strFormattedMessage = FormatLogMessage(strLogMessage, vecFormatArguments);
		const strPrefixedMessage = `${strLoggerPrefix}${strFormattedMessage}`;
		const nLoggerAreas = this.LogAreas;
		const strLoggerName = this.LoggerName;
		if (typeof strLoggerName !== "string") {
			throw new TypeError("Logger name must be a string.");
		}

		const strRecordLoggerName = (strLoggerName.length === 0) ? "sourcejs" : strLoggerName;
		const strFormattedRecord = FormatLogRecord(this.LogRecordFormat, this.LogDateFormat, {
			Date: new Date(),
			LevelName: GetLogLevelName(nResolvedLogLevel),
			LoggerName: strRecordLoggerName,
			Message: strFormattedMessage,
		});

		if ((nLoggerAreas & g_LogArea.CONSOLE) || (nLoggerAreas & g_LogArea.MAIN) || (nLoggerAreas & g_LogArea.SOURCEJS)) {
			WriteRuntimeLog(nResolvedLogLevel, strPrefixedMessage);
		}

		if (nLoggerAreas & g_LogArea.SCRIPT) {
			const strLogFilePath = this.FilePath;
			if ((strLogFilePath !== null) && !AppendLogLine(strLogFilePath, strFormattedRecord)) {
				throw new Error("Log file append returned false for an active file path.");
			}
		}

		return true;
	}

	LogDebug(strMessage, ...vecFormatArguments) {
		return this.LogAtLevel(g_LogLevels.DEBUG, strMessage, ...vecFormatArguments);
	}

	LogInfo(strMessage, ...vecFormatArguments) {
		return this.LogAtLevel(g_LogLevels.INFO, strMessage, ...vecFormatArguments);
	}

	LogWarning(strMessage, ...vecFormatArguments) {
		return this.LogAtLevel(g_LogLevels.WARNING, strMessage, ...vecFormatArguments);
	}

	LogError(strMessage, ...vecFormatArguments) {
		return this.LogAtLevel(g_LogLevels.ERROR, strMessage, ...vecFormatArguments);
	}

	LogException(strMessage, ErrorValue = null, ...vecFormatArguments) {
		if (typeof strMessage !== "string") {
			throw new TypeError("Log message must be a string.");
		}

		if ((ErrorValue !== null) && !(ErrorValue instanceof Error)) {
			throw new TypeError("Logger exception value must be an Error or null.");
		}

		let strErrorDetails = "";
		if (ErrorValue !== null) {
			strErrorDetails = `\n${ErrorValue.stack || ErrorValue.message}`;
		}

		return this.LogAtLevel(g_LogLevels.ERROR, `${strMessage}${strErrorDetails}`, ...vecFormatArguments);
	}

	LogCritical(strMessage, ...vecFormatArguments) {
		return this.LogAtLevel(g_LogLevels.CRITICAL, strMessage, ...vecFormatArguments);
	}

	LogMessage(strMessage, ...vecFormatArguments) {
		return this.LogAtLevel(g_LogLevels.MESSAGE, strMessage, ...vecFormatArguments);
	}

	get ParentLogger() {
		return this.#m_ParentLogger;
	}

	get LocalLoggerName() {
		return this.#m_strLocalLoggerName;
	}

	get ChildLoggers() {
		return this.#m_mapChildLoggers;
	}

	get Prefix() {
		return this.#m_strPrefix;
	}

	get LoggerName() {
		const ParentLogger = this.#m_ParentLogger;
		const strLocalLoggerName = this.#m_strLocalLoggerName;
		if (ParentLogger === null) {
			return strLocalLoggerName;
		}

		const strParentLoggerName = ParentLogger.LoggerName;
		if (strParentLoggerName.length === 0) {
			return strLocalLoggerName;
		}

		return (strLocalLoggerName.length > 0) ? `${strParentLoggerName}.${strLocalLoggerName}` : strParentLoggerName;
	}

	get RootLogManager() {
		// This computed property walks the parent chain and allocates temporary state to detect cycles.
		const setVisitedLoggers = new Set();
		let RootLogger = this;
		while (RootLogger.#m_ParentLogger !== null) {
			if (setVisitedLoggers.has(RootLogger)) {
				throw new Error("Logger parent chain contains a cycle.");
			}

			setVisitedLoggers.add(RootLogger);

			const ParentLogger = RootLogger.#m_ParentLogger;
			if (!(ParentLogger instanceof LogInstance)) {
				throw new TypeError("Logger parent must be another LogInstance or null.");
			}

			RootLogger = ParentLogger;
		}

		return RootLogger;
	}

	get LogAreas() {
		return this.RootLogManager.LogAreas;
	}

	get LogLevel() {
		return this.RootLogManager.LogLevel;
	}

	get FilePath() {
		return this.RootLogManager.FilePath;
	}

	get LogRecordFormat() {
		return this.RootLogManager.LogRecordFormat;
	}

	get LogDateFormat() {
		return this.RootLogManager.LogDateFormat;
	}

	#m_ParentLogger;
	#m_strLocalLoggerName;
	#m_mapChildLoggers;
	#m_strPrefix;
}

class LogManager extends LogInstance {
	constructor(strLoggerName = "sourcejs", LoggerOptions = {}) {
		if (!LoggerOptions || (typeof LoggerOptions !== "object") || Array.isArray(LoggerOptions)) {
			throw new TypeError("LogManager options must be an object.");
		}

		if (typeof strLoggerName !== "string") {
			throw new TypeError("LogInstance requires a string name and options object.");
		}

		const strLoggerPrefix = Object.hasOwn(LoggerOptions, "Prefix") ? LoggerOptions.Prefix : "";
		const ConfiguredLevel = Object.hasOwn(LoggerOptions, "LogLevel") ? LoggerOptions.LogLevel : undefined;
		const ConfiguredAreas = Object.hasOwn(LoggerOptions, "LogAreas") ? LoggerOptions.LogAreas : undefined;
		const ConfiguredFilePath = Object.hasOwn(LoggerOptions, "FilePath") ? LoggerOptions.FilePath : undefined;
		const ConfiguredRecordFormat = Object.hasOwn(LoggerOptions, "LogRecordFormat") ? LoggerOptions.LogRecordFormat : undefined;
		const ConfiguredDateFormat = Object.hasOwn(LoggerOptions, "LogDateFormat") ? LoggerOptions.LogDateFormat : undefined;
		const LevelSource = ((ConfiguredLevel === null) || (ConfiguredLevel === undefined)) ? g_LogLevels.INFO : ConfiguredLevel;
		const AreaSource = ((ConfiguredAreas === null) || (ConfiguredAreas === undefined)) ? g_LogArea.CONSOLE : ConfiguredAreas;
		const strFilePath = (ConfiguredFilePath === undefined) ? null : ConfiguredFilePath;
		const strRecordFormat = (ConfiguredRecordFormat === undefined) ? null : ConfiguredRecordFormat;
		const strRecordDateFormat = (ConfiguredDateFormat === undefined) ? null : ConfiguredDateFormat;
		if (typeof strLoggerPrefix !== "string") {
			throw new TypeError("Logger prefix must be a string.");
		}

		if ((strRecordFormat !== null) && (typeof strRecordFormat !== "string")) {
			throw new TypeError("Logger record format must be a string or null.");
		}

		if ((strRecordDateFormat !== null) && (typeof strRecordDateFormat !== "string")) {
			throw new TypeError("Logger date format must be a string or null.");
		}

		const strLogFilePath = NormalizeLogFilePath(strFilePath);

		super(null, strLoggerName, { Prefix: strLoggerPrefix });
		this.#m_LogLevelSource = LevelSource;
		this.#m_LogAreasSource = AreaSource;
		this.#m_strStoredLogFilePath = strLogFilePath;
		this.#m_strStoredLogRecordFormat = strRecordFormat;
		this.#m_strStoredLogDateFormat = strRecordDateFormat;
	}

	UnloadLogManager() {
		this.ClearChildLoggers();

		return true;
	}

	get ValueLogLevelSource() {
		return this.#m_LogLevelSource;
	}

	set ValueLogLevelSource(LogLevelSource) {
		this.#m_LogLevelSource = LogLevelSource;
	}

	get LogLevel() {
		return ResolveLogLevel(this.#m_LogLevelSource);
	}

	set LogLevel(LogLevelSource) {
		this.ValueLogLevelSource = LogLevelSource;
	}

	get ValueLogAreasSource() {
		return this.#m_LogAreasSource;
	}

	set ValueLogAreasSource(LogAreaSource) {
		this.#m_LogAreasSource = LogAreaSource;
	}

	get LogAreas() {
		return ResolveIntegerValue(this.#m_LogAreasSource, "Log areas");
	}

	set LogAreas(LogAreaSource) {
		this.ValueLogAreasSource = LogAreaSource;
	}

	get FilePath() {
		return this.#m_strStoredLogFilePath;
	}

	set FilePath(strLogFilePath) {
		this.#m_strStoredLogFilePath = NormalizeLogFilePath(strLogFilePath);
	}

	get LogRecordFormat() {
		return this.#m_strStoredLogRecordFormat;
	}

	set LogRecordFormat(strRecordFormat) {
		if ((strRecordFormat !== null) && (typeof strRecordFormat !== "string")) {
			throw new TypeError("Log record format must be a string or null.");
		}

		this.#m_strStoredLogRecordFormat = strRecordFormat;
	}

	get LogDateFormat() {
		return this.#m_strStoredLogDateFormat;
	}

	set LogDateFormat(strRecordDateFormat) {
		if ((strRecordDateFormat !== null) && (typeof strRecordDateFormat !== "string")) {
			throw new TypeError("Log date format must be a string or null.");
		}

		this.#m_strStoredLogDateFormat = strRecordDateFormat;
	}

	#m_LogLevelSource;
	#m_LogAreasSource;
	#m_strStoredLogFilePath;
	#m_strStoredLogRecordFormat;
	#m_strStoredLogDateFormat;
}

const g_RootLogger = new LogManager("sourcejs", { LogAreas: g_LogArea.CONSOLE, LogLevel: g_LogLevels.DEBUG });

function LogAtLevel(LogLevel, strLogMessage, ...vecFormatArguments) {
	return g_RootLogger.LogAtLevel(LogLevel, strLogMessage, ...vecFormatArguments);
}

function LogDebug(strMessage, ...vecFormatArguments) {
	return g_RootLogger.LogDebug(strMessage, ...vecFormatArguments);
}

function LogInfo(strMessage, ...vecFormatArguments) {
	return g_RootLogger.LogInfo(strMessage, ...vecFormatArguments);
}

function LogWarning(strMessage, ...vecFormatArguments) {
	return g_RootLogger.LogWarning(strMessage, ...vecFormatArguments);
}

function LogError(strMessage, ...vecFormatArguments) {
	return g_RootLogger.LogError(strMessage, ...vecFormatArguments);
}

function LogException(strMessage, ErrorValue = null, ...vecFormatArguments) {
	return g_RootLogger.LogException(strMessage, ErrorValue, ...vecFormatArguments);
}

function LogCritical(strMessage, ...vecFormatArguments) {
	return g_RootLogger.LogCritical(strMessage, ...vecFormatArguments);
}

function LogMessage(strMessage, ...vecFormatArguments) {
	return g_RootLogger.LogMessage(strMessage, ...vecFormatArguments);
}

module.exports = {
	LogArea: g_LogArea,
	LogInstance,
	LogLevel: g_LogLevels,
	LogManager,
	ROOT_LOGGER: g_RootLogger,
	LogAtLevel,
	LogCritical,
	LogDebug,
	LogError,
	LogException,
	LogInfo,
	LogMessage,
	LogWarning,
};
