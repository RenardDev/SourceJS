"use strict";

const { GetGlobalInfo, Tokenizer } = require("core");
const { LogInfo, LogWarning } = require("loggers");

const g_strModuleName = "core/command";

function NormalizeCommandPath(CommandPath) {
	if (typeof CommandPath === "string") {
		return Array.from(new Tokenizer(CommandPath));
	}

	if (!Array.isArray(CommandPath)) {
		throw new TypeError("Command path must be a string or array.");
	}

	const vecNormalizedPath = [];
	for (const strPathPart of CommandPath) {
		if (typeof strPathPart !== "string") {
			throw new TypeError("Command path parts must be strings.");
		}

		if (strPathPart.length > 0) {
			vecNormalizedPath.push(strPathPart);
		}
	}

	return vecNormalizedPath;
}

class CoreCommandManager {
	constructor(Options = {}) {
		if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("CoreCommandManager options must be an object.");
		}

		const strRequestedName = Options.Name;
		const RequestedLogger = Options.Logger;
		const strManagerName = (strRequestedName === undefined) ? "sjs" : strRequestedName;
		const Logger = (RequestedLogger === undefined) ? { LogInfo, LogWarning } : RequestedLogger;

		if ((typeof strManagerName !== "string") || (strManagerName.length === 0)) {
			throw new TypeError("CoreCommandManager Name must be a non-empty string.");
		}

		if (((typeof Logger !== "object") || (Logger === null)) && (typeof Logger !== "function")) {
			throw new TypeError("CoreCommandManager Logger must be an object or function.");
		}

		if ((typeof Logger.LogInfo !== "function") || (typeof Logger.LogWarning !== "function")) {
			throw new TypeError("CoreCommandManager Logger must provide LogInfo and LogWarning functions.");
		}

		this.Name = strManagerName;
		this.Commands = new Map();
		this.Logger = Logger;
	}

	GetCommandPathKey(CommandPath) {
		return NormalizeCommandPath(CommandPath).join(" ");
	}

	RegisterCommand(CommandPath, Callback, Options = {}) {
		if (typeof Callback !== "function") {
			throw new TypeError("Core command callback must be a function.");
		}

		if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Core command options must be an object.");
		}

		const strRequestedDescription = Options.Description;
		const strDescription = (strRequestedDescription === undefined) ? "" : strRequestedDescription;
		if (typeof strDescription !== "string") {
			throw new TypeError("Core command Description must be a string.");
		}

		const vecNormalizedCommandPath = NormalizeCommandPath(CommandPath);
		const strCommandPathKey = vecNormalizedCommandPath.join(" ");
		this.Commands.set(strCommandPathKey, { Callback: Callback, Description: strDescription, Path: vecNormalizedCommandPath });

		return Callback;
	}

	UnregisterCommand(CommandPath) {
		return this.Commands.delete(this.GetCommandPathKey(CommandPath));
	}

	RunCommand(CommandLine, Context = {}) {
		const vecArguments = NormalizeCommandPath(CommandLine);

		if (!Context || (typeof Context !== "object") || Array.isArray(Context)) {
			throw new TypeError("Core command context must be an object.");
		}

		if ((typeof this.Name !== "string") || (this.Name.length === 0)) {
			throw new TypeError("CoreCommandManager Name must be a non-empty string.");
		}

		if (vecArguments[0] === this.Name) {
			vecArguments.shift();
		}

		let CommandRecord = undefined;
		let vecCommandArguments = [];
		for (let nCommandPathLength = vecArguments.length; nCommandPathLength >= 0; --nCommandPathLength) {
			const strCommandPathKey = vecArguments.slice(0, nCommandPathLength).join(" ");
			const CandidateRecord = this.Commands.get(strCommandPathKey);
			if (CandidateRecord !== undefined) {
				CommandRecord = CandidateRecord;
				vecCommandArguments = vecArguments.slice(nCommandPathLength);
				break;
			}
		}

		if (CommandRecord === undefined) {
			const strRequestedCommand = (vecArguments.length === 0) ? this.Name : `${this.Name} ${vecArguments.join(" ")}`;
			this.LogCommandMessage(`Command "${strRequestedCommand}" was not found.`);
			return false;
		}

		CommandRecord.Callback({
			...Context,
			Arguments: vecArguments,
			CommandArguments: vecCommandArguments,
			CommandManager: this,
		});

		return true;
	}

	GetCommandList(CommandPath = []) {
		const vecCommandPathPrefix = NormalizeCommandPath(CommandPath);

		if ((typeof this.Name !== "string") || (this.Name.length === 0)) {
			throw new TypeError("CoreCommandManager Name must be a non-empty string.");
		}

		const vecCommandList = [];
		for (const CommandRecord of this.Commands.values()) {
			const PathMatches = (strPathPart, unPathIndex) => CommandRecord.Path[unPathIndex] === strPathPart;
			const bPathMatches = vecCommandPathPrefix.every(PathMatches);
			if (!bPathMatches) {
				continue;
			}

			const strCommandPath = CommandRecord.Path.join(" ");
			const strSignature = (strCommandPath.length === 0) ? this.Name : `${this.Name} ${strCommandPath}`;
			vecCommandList.push({ Description: CommandRecord.Description, Signature: strSignature });
		}

		const CompareCommandRows = (LeftCommand, RightCommand) => LeftCommand.Signature.localeCompare(RightCommand.Signature);
		vecCommandList.sort(CompareCommandRows);

		return vecCommandList;
	}

	GetCommandHelp(CommandPath = []) {
		const vecCommandList = this.GetCommandList(CommandPath);
		if (vecCommandList.length === 0) {
			const strCommandPath = NormalizeCommandPath(CommandPath).join(" ");
			const strRequestedCommand = (strCommandPath.length === 0) ? this.Name : `${this.Name} ${strCommandPath}`;
			return `No commands found for ${strRequestedCommand}`;
		}

		const FormatCommandRow = (CommandRow) => (CommandRow.Description.length === 0) ? CommandRow.Signature : `${CommandRow.Signature} - ${CommandRow.Description}`;

		return vecCommandList.map(FormatCommandRow).join("\n");
	}

	LogCommandMessage(Message) {
		this.Logger.LogInfo(String(Message));
	}

	LogCommandWarning(Message) {
		this.Logger.LogWarning(String(Message));
	}

	PrintSourceJSCredits() {
		const strCredits = "SourceJS\n=======\n\nJavaScript/V8 runtime for Source Engine VSP plugins.";
		this.LogCommandMessage(strCredits);

		return strCredits;
	}

	PrintSourceJSInfo() {
		const RuntimeInformation = GetGlobalInfo();
		const FormatRuntimeInformationEntry = ([strFieldName, FieldValue]) => `${strFieldName}: ${FieldValue}`;
		const strRuntimeInformation = Object.entries(RuntimeInformation).map(FormatRuntimeInformationEntry).join("\n");
		this.LogCommandMessage(strRuntimeInformation);

		return strRuntimeInformation;
	}

	PrintCommandHelp(CommandPath = []) {
		this.LogCommandMessage(this.GetCommandHelp(CommandPath));
	}
}

const g_CoreCommand = new CoreCommandManager();

g_CoreCommand.RegisterCommand(["credits"], function PrintCreditsCommand() {
	return g_CoreCommand.PrintSourceJSCredits();
}, { Description: "List SourceJS credits." });
g_CoreCommand.RegisterCommand(["help"], function PrintCommandHelpCommand(CommandContext) {
	return g_CoreCommand.PrintCommandHelp(CommandContext.CommandArguments);
}, { Description: "Print SourceJS command help." });
g_CoreCommand.RegisterCommand(["info"], function PrintRuntimeInformationCommand() {
	return g_CoreCommand.PrintSourceJSInfo();
}, { Description: "Print SourceJS runtime information." });

module.exports = {
	CORE_COMMAND: g_CoreCommand,
	CoreCommandManager: CoreCommandManager,
	MODULE_NAME: g_strModuleName,
	NormalizeCommandPath: NormalizeCommandPath,
};
