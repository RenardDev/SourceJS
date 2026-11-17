"use strict";

const { HasPlayerPermission } = require("auth");
const {
	GetBotPlayers,
	GetConnectedPlayers,
	GetHumanPlayers,
	GetPlayersByTeam,
} = require("filters/players");
const { LogInfo } = require("loggers");
const { SendClientConsoleMessage } = require("messages");
const { CommandReturn } = require("commands");
const { GetCommandModuleRuntime } = require("internal/commands");
const { CommandRegistrationManager } = require("commands/manager");

const g_strPrivateCommandPrefix = "/";
const g_strTeamPlayerExpressionPrefix = "team:";
const g_ServerCommandRuntime = GetCommandModuleRuntime("server");
const g_ClientCommandRuntime = GetCommandModuleRuntime("client");
const g_SayCommandRuntime = GetCommandModuleRuntime("say");
const g_ServerCommandRegistrationManager = new CommandRegistrationManager(Object.freeze({ Register: g_ServerCommandRuntime.RegisterCommand, Unregister: g_ServerCommandRuntime.UnregisterCommand }));
const g_ClientCommandRegistrationManager = new CommandRegistrationManager(Object.freeze({ Register: g_ClientCommandRuntime.RegisterClientCommand, Unregister: g_ClientCommandRuntime.UnregisterClientCommand }));
const g_SayCommandRegistrationManager = new CommandRegistrationManager(Object.freeze({ Register: g_SayCommandRuntime.RegisterSayCommand, Unregister: g_SayCommandRuntime.UnregisterSayCommand }));

class ValidationError extends Error {
	constructor(strValidationMessage = "", ValidationOptions = {}) {
		super(strValidationMessage);
		this.name = this.constructor.name;
		this.Language = ValidationOptions.Language ?? null;
		this.Tokens = ValidationOptions.Tokens ?? {};
	}
}

class ArgumentError extends ValidationError {
}

class ArgumentNumberMismatch extends ArgumentError {
}

class InvalidArgumentValue extends ArgumentError {
}

class SubCommandError extends ValidationError {
}

class SubCommandNotFound extends SubCommandError {
}

class SubCommandExpectedError extends SubCommandError {
}

function ConvertCommandArgument(CommandParameter, ArgumentValue) {
	try {
		if (CommandParameter.Type === String) {
			return String(ArgumentValue);
		}

		if (CommandParameter.Type === Number) {
			const dblNumericArgument = Number(ArgumentValue);
			if (!Number.isFinite(dblNumericArgument)) {
				throw new Error("invalid number");
			}

			return dblNumericArgument;
		}

		if (CommandParameter.Type === Boolean) {
			const strNormalizedBooleanArgument = String(ArgumentValue).toLowerCase();
			switch (strNormalizedBooleanArgument) {
				case "1":
				case "true":
				case "yes":
				case "on":
					return true;

				case "0":
				case "false":
				case "no":
				case "off":
					return false;

				default:
					throw new Error("invalid boolean");
			}
		}

		return CommandParameter.Type(ArgumentValue);
	} catch (ConversionError) {
		if (ConversionError instanceof ValidationError) {
			throw ConversionError;
		}

		throw new InvalidArgumentValue(`"${ArgumentValue}" is an invalid value for "${CommandParameter.Name}".`);
	}
}

function FilterPlayers(strPlayerExpression) {
	const strNormalizedPlayerExpression = String(strPlayerExpression).toLowerCase();
	const bTargetsAllPlayers = (strNormalizedPlayerExpression === "*") || (strNormalizedPlayerExpression === "all") || (strNormalizedPlayerExpression === "#all");
	if (bTargetsAllPlayers) {
		return GetConnectedPlayers();
	}

	const bTargetsHumanPlayers = (strNormalizedPlayerExpression === "human") || (strNormalizedPlayerExpression === "humans") || (strNormalizedPlayerExpression === "#human") || (strNormalizedPlayerExpression === "#humans");
	if (bTargetsHumanPlayers) {
		return GetHumanPlayers();
	}

	const bTargetsBotPlayers = (strNormalizedPlayerExpression === "bot") || (strNormalizedPlayerExpression === "bots") || (strNormalizedPlayerExpression === "#bot") || (strNormalizedPlayerExpression === "#bots");
	if (bTargetsBotPlayers) {
		return GetBotPlayers();
	}

	if (strNormalizedPlayerExpression.startsWith(g_strTeamPlayerExpressionPrefix)) {
		const nTeamIndex = Number(strNormalizedPlayerExpression.slice(g_strTeamPlayerExpressionPrefix.length));
		if (!Number.isInteger(nTeamIndex)) {
			throw new InvalidArgumentValue(`"${strPlayerExpression}" does not contain a valid team index.`);
		}

		return GetPlayersByTeam(nTeamIndex);
	}

	const MatchesPlayerExpression = (ConnectedPlayer) => {
		return (ConnectedPlayer.Name === strPlayerExpression) || (String(ConnectedPlayer.Index) === strNormalizedPlayerExpression);
	};

	return GetConnectedPlayers().filter(MatchesPlayerExpression);
}

class CommandTreeNode {
	constructor(vecCommandPath = [], strCommandDescription = null) {
		this.Commands = vecCommandPath;
		this.Description = strCommandDescription;
	}

	get Signature() {
		return this.Commands.join(" ");
	}
}

class CommandTreeStore extends CommandTreeNode {
	constructor(vecCommandPath = [], strCommandDescription = null) {
		super(vecCommandPath, strCommandDescription);
		this.Children = new Map();
	}

	HasCommand(strCommandName) {
		return this.Children.has(strCommandName);
	}

	GetCommand(strCommandName) {
		return this.Children.get(strCommandName);
	}

	SetCommand(strCommandName, CommandNode) {
		this.Children.set(strCommandName, CommandNode);

		return CommandNode;
	}

	DeleteCommand(strCommandName) {
		return this.Children.delete(strCommandName);
	}

	Values() {
		return this.Children.values();
	}

	get Signature() {
		return `${this.Commands.join(" ")} <sub-command>`.trim();
	}

	get HelpText() {
		const vecSortedCommandNodes = Array.from(this.Children.values());
		const CompareCommandNodes = (LeftNode, RightNode) => LeftNode.Signature.localeCompare(RightNode.Signature);
		vecSortedCommandNodes.sort(CompareCommandNodes);

		const FormatCommandNode = (CommandNode) => `${CommandNode.Signature}${CommandNode.Description ? ` - ${CommandNode.Description}` : ""}`;
		const vecCommandHelpLines = vecSortedCommandNodes.map(FormatCommandNode);

		return vecCommandHelpLines.join("\n");
	}

	get Size() {
		return this.Children.size;
	}
}

function CommandParameterToString(CommandParameter) {
	const strParameterTypeSuffix = (CommandParameter.Type && CommandParameter.Type.name) ? `:${CommandParameter.Type.name}` : "";
	const strParameterName = CommandParameter.Rest ? `*${CommandParameter.Name}` : CommandParameter.Name;
	const strDefaultValueSuffix = CommandParameter.Required ? "" : `=${CommandParameter.DefaultValue}`;
	const bUsesRequiredDelimiters = CommandParameter.Required && !CommandParameter.Rest;
	const strOpeningDelimiter = bUsesRequiredDelimiters ? "<" : "[";
	const strClosingDelimiter = bUsesRequiredDelimiters ? ">" : "]";

	return `${strOpeningDelimiter}${strParameterName}${strParameterTypeSuffix}${strDefaultValueSuffix}${strClosingDelimiter}`;
}

class TypedCommandNode extends CommandTreeNode {
	constructor(vecCommandPath, vecCommandParameters, CommandCallback, strCommandDescription, RequiredPermission, AuthorizationFailureCallback, bRequiresRegistration) {
		super(vecCommandPath, strCommandDescription);
		this.Parameters = vecCommandParameters;
		this.Callback = CommandCallback;
		this.Permission = (RequiredPermission === true) ? vecCommandPath.join(".") : RequiredPermission;
		this.FailureCallback = AuthorizationFailureCallback;
		this.RequiresRegistration = bRequiresRegistration;
		this.CommandToRegister = vecCommandPath[0];
	}

	get Signature() {
		const vecParameterSignatures = this.Parameters.map(CommandParameterToString);

		return this.Commands.concat(vecParameterSignatures).join(" ");
	}
}

function ValidateCommandPath(CommandPath) {
	const vecCommandNames = (typeof CommandPath === "string") ? [CommandPath] : CommandPath;
	if (!Array.isArray(vecCommandNames)) {
		throw new TypeError("Commands must be a string or a non-empty array.");
	}

	const unCommandCount = vecCommandNames.length;
	if (!Number.isSafeInteger(unCommandCount) || (unCommandCount <= 0)) {
		throw new TypeError("Commands must be a string or a non-empty array.");
	}

	const vecValidatedCommandNames = [];
	for (let unCommandIndex = 0; unCommandIndex < unCommandCount; unCommandIndex += 1) {
		if (!Object.prototype.hasOwnProperty.call(vecCommandNames, unCommandIndex)) {
			throw new TypeError("Command names must be non-empty strings.");
		}

		const strCommandName = vecCommandNames[unCommandIndex];
		if ((typeof strCommandName !== "string") || (strCommandName.length === 0)) {
			throw new TypeError("Command names must be non-empty strings.");
		}

		if (strCommandName.includes(" ")) {
			throw new TypeError("Command names must not contain spaces.");
		}

		Object.defineProperty(vecValidatedCommandNames, unCommandIndex, { value: strCommandName, writable: true, enumerable: true, configurable: true });
	}

	return vecValidatedCommandNames;
}

function NormalizeParameters(vecCommandParameters) {
	if (!Array.isArray(vecCommandParameters)) {
		throw new TypeError("Typed command parameters must be an array.");
	}

	const unParameterCount = vecCommandParameters.length;
	if (!Number.isSafeInteger(unParameterCount) || (unParameterCount < 0)) {
		throw new TypeError("Typed command parameters must be an array.");
	}

	const NormalizeCommandParameter = (CommandParameter, unParameterIndex) => {
		if (typeof CommandParameter === "string") {
			const strParameterName = CommandParameter.trim();
			if (strParameterName === "") {
				throw new TypeError("Typed command parameter names must not be empty.");
			}

			return {
				Name: strParameterName,
				Type: String,
				Required: true,
				Rest: false,
			};
		}

		if (typeof CommandParameter === "function") {
			return {
				Name: CommandParameter.name || `Argument${unParameterIndex + 1}`,
				Type: CommandParameter,
				Required: true,
				Rest: false,
			};
		}

		if (!CommandParameter || (typeof CommandParameter !== "object") || Array.isArray(CommandParameter)) {
			throw new TypeError("Typed command parameters must be strings, converters or parameter objects.");
		}

		const bHasDefaultValue = Object.prototype.hasOwnProperty.call(CommandParameter, "DefaultValue");
		const strParameterName = CommandParameter.Name ?? `Argument${unParameterIndex + 1}`;
		const ParameterType = CommandParameter.Type ?? String;

		if ((typeof strParameterName !== "string") || (strParameterName.trim() === "")) {
			throw new TypeError("Typed command parameter names must be non-empty strings.");
		}

		if (typeof ParameterType !== "function") {
			throw new TypeError("Typed command parameter types must be converter functions.");
		}

		return {
			Name: strParameterName.trim(),
			Type: ParameterType,
			Required: (CommandParameter.Required !== undefined) ? Boolean(CommandParameter.Required) : !bHasDefaultValue,
			Rest: Boolean(CommandParameter.Rest),
			DefaultValue: CommandParameter.DefaultValue,
		};
	};

	const vecNormalizedParameters = [];
	for (let unParameterIndex = 0; unParameterIndex < unParameterCount; unParameterIndex += 1) {
		if (!Object.prototype.hasOwnProperty.call(vecCommandParameters, unParameterIndex)) {
			throw new TypeError("Typed command parameters must be strings, converters or parameter objects.");
		}

		const NormalizedParameter = NormalizeCommandParameter(vecCommandParameters[unParameterIndex], unParameterIndex);
		Object.defineProperty(vecNormalizedParameters, unParameterIndex, { value: NormalizedParameter, writable: true, enumerable: true, configurable: true });
	}

	for (let unParameterIndex = 0; unParameterIndex < unParameterCount; unParameterIndex += 1) {
		const NormalizedParameter = vecNormalizedParameters[unParameterIndex];
		if (NormalizedParameter.Rest && (unParameterIndex !== (unParameterCount - 1))) {
			throw new TypeError("A typed command may have one rest parameter in the final position only.");
		}
	}

	return vecNormalizedParameters;
}

function RemoveCommandPathFromStore(CommandStore, vecNormalizedCommandPath, unCommandIndex) {
	const vecParentFrames = [];
	let CurrentCommandStore = CommandStore;
	for (let unCurrentCommandIndex = unCommandIndex; unCurrentCommandIndex < (vecNormalizedCommandPath.length - 1); unCurrentCommandIndex += 1) {
		const strCommandName = vecNormalizedCommandPath[unCurrentCommandIndex];
		const ChildCommandStore = CommandTreeStore.prototype.GetCommand.call(CurrentCommandStore, strCommandName);
		if (!(ChildCommandStore instanceof CommandTreeStore)) {
			throw new Error("Command does not exist.");
		}

		vecParentFrames.push({ CommandStore: CurrentCommandStore, ChildCommandStore, Name: strCommandName });
		CurrentCommandStore = ChildCommandStore;
	}

	const strCommandName = vecNormalizedCommandPath[vecNormalizedCommandPath.length - 1];
	if (!CurrentCommandStore.HasCommand(strCommandName)) {
		throw new Error("Command does not exist.");
	}

	CurrentCommandStore.DeleteCommand(strCommandName);

	let bChildPathRemoved = true;
	for (let nParentIndex = vecParentFrames.length - 1; nParentIndex >= 0; nParentIndex -= 1) {
		const ParentFrame = vecParentFrames[nParentIndex];
		if (ParentFrame.ChildCommandStore.Size === 0) {
			ParentFrame.CommandStore.DeleteCommand(ParentFrame.Name);
		}

		bChildPathRemoved = bChildPathRemoved && !ParentFrame.CommandStore.HasCommand(ParentFrame.Name);
	}

	return bChildPathRemoved;
}

class TypedCommandParser extends CommandTreeStore {
	AddCommand(CommandPath, vecCommandParameters, CommandCallback, strCommandDescription = null, RequiredPermission = null, AuthorizationFailureCallback = null) {
		const vecValidatedCommandPath = ValidateCommandPath(CommandPath);
		const vecNormalizedCommandParameters = NormalizeParameters(vecCommandParameters);
		const bRequiresRegistration = !this.HasCommand(vecValidatedCommandPath[0].toLowerCase());
		const CommandNode = new TypedCommandNode(vecValidatedCommandPath, vecNormalizedCommandParameters, CommandCallback, strCommandDescription, RequiredPermission, AuthorizationFailureCallback, bRequiresRegistration);

		let CurrentCommandStore = this;
		const vecParsedCommandPath = [];
		for (let unCommandIndex = 0; unCommandIndex < vecValidatedCommandPath.length; unCommandIndex += 1) {
			const strCommandName = vecValidatedCommandPath[unCommandIndex].toLowerCase();
			vecParsedCommandPath.push(strCommandName);

			if (unCommandIndex === (vecValidatedCommandPath.length - 1)) {
				if (CurrentCommandStore.HasCommand(strCommandName)) {
					throw new Error("Command already exists.");
				}

				CurrentCommandStore.SetCommand(strCommandName, CommandNode);

				continue;
			}

			let NextCommandStore = CommandTreeStore.prototype.GetCommand.call(CurrentCommandStore, strCommandName);
			if (!NextCommandStore) {
				NextCommandStore = new CommandTreeStore(vecParsedCommandPath.slice());
				CurrentCommandStore.SetCommand(strCommandName, NextCommandStore);
			}

			if (!(NextCommandStore instanceof CommandTreeStore)) {
				throw new Error("Command already exists.");
			}

			CurrentCommandStore = NextCommandStore;
		}

		return CommandNode;
	}

	RemoveCommand(CommandPath) {
		const NormalizeCommandName = (strCommandName) => strCommandName.toLowerCase();
		const vecNormalizedCommandPath = ValidateCommandPath(CommandPath).map(NormalizeCommandName);

		return this.RemoveCommandPath(vecNormalizedCommandPath);
	}

	RemoveCommandPath(vecNormalizedCommandPath) {
		return RemoveCommandPathFromStore(this, vecNormalizedCommandPath, 0);
	}

	GetNode(CommandPath) {
		const vecValidatedCommandPath = ValidateCommandPath(CommandPath);
		let CurrentCommandNode = this;
		for (const strCommandName of vecValidatedCommandPath) {
			const strNormalizedCommandName = strCommandName.toLowerCase();
			if (!(CurrentCommandNode instanceof CommandTreeStore) || !CurrentCommandNode.HasCommand(strNormalizedCommandName)) {
				throw new Error("Node does not exist.");
			}

			CurrentCommandNode = CommandTreeStore.prototype.GetCommand.call(CurrentCommandNode, strNormalizedCommandName);
		}

		return CurrentCommandNode;
	}

	GetCommand(CommandPath) {
		const CommandNode = this.GetNode(CommandPath);
		if (!(CommandNode instanceof TypedCommandNode)) {
			throw new Error("Command does not exist.");
		}

		return CommandNode;
	}

	SetNodeDescription(CommandPath, strNodeDescription) {
		this.GetNode(CommandPath).Description = strNodeDescription;
	}

	ParseCommand(CommandContext) {
		const vecArgumentValues = Array.from(CommandContext.Arguments);
		let CurrentCommandNode = this;
		while ((vecArgumentValues.length > 0) && (CurrentCommandNode instanceof CommandTreeStore)) {
			const strNormalizedCommandName = String(vecArgumentValues.shift()).toLowerCase();
			if (!CurrentCommandNode.HasCommand(strNormalizedCommandName)) {
				throw new SubCommandNotFound(`Sub-command "${strNormalizedCommandName}" was not found.`);
			}

			CurrentCommandNode = CommandTreeStore.prototype.GetCommand.call(CurrentCommandNode, strNormalizedCommandName);
		}

		if (CurrentCommandNode instanceof CommandTreeStore) {
			throw new SubCommandExpectedError(`A sub-command is required.\n${CurrentCommandNode.HelpText}`);
		}

		return [CurrentCommandNode, vecArgumentValues];
	}

	CleanCommand(CommandNode, vecArgumentValues) {
		const vecConvertedArgumentValues = [];
		let unParameterIndex = 0;
		for (const ArgumentValue of vecArgumentValues) {
			if (unParameterIndex >= CommandNode.Parameters.length) {
				throw new ArgumentNumberMismatch(`Too many arguments:\n  ${CommandNode.Signature}`);
			}

			const CommandParameter = CommandNode.Parameters[unParameterIndex];
			vecConvertedArgumentValues.push(ConvertCommandArgument(CommandParameter, ArgumentValue));

			if (!CommandParameter.Rest) {
				unParameterIndex += 1;
			}
		}

		for (; unParameterIndex < CommandNode.Parameters.length; unParameterIndex += 1) {
			const CommandParameter = CommandNode.Parameters[unParameterIndex];
			if (CommandParameter.Rest) {
				break;
			}

			if (!CommandParameter.Required) {
				vecConvertedArgumentValues.push(CommandParameter.DefaultValue);
				continue;
			}

			throw new ArgumentNumberMismatch(`Not enough arguments:\n  ${CommandNode.Signature}`);
		}

		return vecConvertedArgumentValues;
	}
}

class TypedCommandContext {
	constructor(CommandPayload, TypedCommand) {
		this.Command = CommandPayload;
		this.TypedCommand = TypedCommand;
	}

	Reply(strReplyMessage, strLanguageCode = null, TranslationTokens = {}) {
		return this.TypedCommand.SendMessage(this, strReplyMessage, strLanguageCode, TranslationTokens);
	}

	IsPrivateCommand() {
		return this.Command.Name.startsWith(g_strPrivateCommandPrefix);
	}

	get Arguments() {
		return this.Command.Arguments;
	}

	get Index() {
		return this.Command.Index;
	}

	set Index(nIndex) {
		this.Command.Index = nIndex;
	}

	get TeamOnly() {
		return Boolean(this.Command.TeamOnly);
	}

	set TeamOnly(bTeamOnlyFlag) {
		this.Command.TeamOnly = Boolean(bTeamOnlyFlag);
	}

	get AutoCommandReturn() {
		return this.TypedCommand.GetCommandReturn(this);
	}
}

class TypedCommandRegistration {
	constructor(CommandPath, RegistrationOptions = {}) {
		this.Commands = CommandPath;
		this.Permission = RegistrationOptions.Permission ?? null;
		this.FailureCallback = RegistrationOptions.FailureCallback ?? null;
		this.Description = RegistrationOptions.Description ?? null;
		this.Parameters = RegistrationOptions.Parameters ?? [];
		this.CommandNode = null;
	}

	Register(CommandCallback, vecCommandParameters = this.Parameters) {
		if (typeof CommandCallback !== "function") {
			throw new TypeError("Typed command callback must be a function.");
		}

		if (this.CommandNode !== null) {
			throw new Error("Typed command registration is already loaded.");
		}

		if ((this.FailureCallback !== null) && (typeof this.FailureCallback !== "function")) {
			throw new TypeError("Typed command failure callback must be a function or null.");
		}

		const TypedCommandType = this.constructor;
		this.CommandNode = TypedCommandType.Parser.AddCommand(this.Commands, vecCommandParameters, CommandCallback, this.Description, this.Permission, this.FailureCallback);
		if (this.CommandNode.RequiresRegistration) {
			const strBaseCommandName = this.CommandNode.CommandToRegister;
			const strNativeRegistrationKey = strBaseCommandName.toLowerCase();

			try {
				const NativeCommandRegistration = TypedCommandType.Manager.Register(strBaseCommandName, TypedCommandType.CommandHandler);
				TypedCommandType.NativeRegistrations.set(strNativeRegistrationKey, NativeCommandRegistration);
			} catch (RegistrationError) {
				try {
					TypedCommandType.Parser.RemoveCommand(this.CommandNode.Commands);
					this.CommandNode = null;
				} catch (CleanupError) {
					throw new AggregateError([RegistrationError, CleanupError], "Unable to roll back typed command registration.");
				}

				throw RegistrationError;
			}
		}

		return this;
	}

	Unload() {
		if (this.CommandNode === null) {
			return false;
		}

		const TypedCommandType = this.constructor;
		const CommandNode = this.CommandNode;
		const strBaseCommandName = CommandNode.CommandToRegister;
		const strNativeRegistrationKey = strBaseCommandName.toLowerCase();
		const NativeCommandRegistration = TypedCommandType.NativeRegistrations.get(strNativeRegistrationKey);
		if (!NativeCommandRegistration) {
			throw new Error(`Native registration for '${strBaseCommandName}' does not exist.`);
		}

		const vecCommandPath = CommandNode.Commands.map((strCommandName) => strCommandName.toLowerCase());
		let CurrentNode = TypedCommandType.Parser;
		let bShouldRemoveBaseRegistration = true;
		for (let unCommandIndex = 0; unCommandIndex < vecCommandPath.length; unCommandIndex += 1) {
			if (!(CurrentNode instanceof CommandTreeStore)) {
				throw new Error("Typed command path no longer belongs to this registration.");
			}

			if ((unCommandIndex > 0) && (CurrentNode.Size !== 1)) {
				bShouldRemoveBaseRegistration = false;
			}

			CurrentNode = CommandTreeStore.prototype.GetCommand.call(CurrentNode, vecCommandPath[unCommandIndex]);
		}

		if (CurrentNode !== CommandNode) {
			throw new Error("Typed command path no longer belongs to this registration.");
		}

		// Native unregistration must not reenter or mutate this parser.
		// Keep the original tree intact until the fallible native operation succeeds.
		if (bShouldRemoveBaseRegistration) {
			if (!TypedCommandType.Manager.Unregister(NativeCommandRegistration)) {
				throw new Error(`Unable to unregister native command '${strBaseCommandName}'.`);
			}
		}

		TypedCommandType.Parser.RemoveCommandPath(vecCommandPath);

		if (bShouldRemoveBaseRegistration) {
			TypedCommandType.NativeRegistrations.delete(strNativeRegistrationKey);
		}

		this.CommandNode = null;

		return true;
	}

	static HandleCommand(CommandPayload) {
		const CommandContext = new TypedCommandContext(CommandPayload, this);

		try {
			const [CommandNode, vecArgumentValues] = this.Parser.ParseCommand(CommandContext);
			const vecConvertedArgumentValues = this.Parser.CleanCommand(CommandNode, vecArgumentValues);
			const CommandResult = this.RunCommand(CommandContext, CommandNode, vecConvertedArgumentValues);

			return ((CommandResult === undefined) || (CommandResult === null)) ? CommandContext.AutoCommandReturn : CommandResult;
		} catch (CommandError) {
			if (CommandError instanceof ValidationError) {
				try {
					if (CommandContext.Reply(CommandError.message, CommandError.Language, CommandError.Tokens) === false) {
						throw new Error("Typed command validation error reply was rejected.");
					}
				} catch (ReplyError) {
					throw new AggregateError([CommandError, ReplyError], "Unable to send the typed command validation error message.");
				}

				return CommandReturn.Continue;
			}

			throw CommandError;
		}
	}

	static RunCommand(CommandContext, CommandNode, vecConvertedArgumentValues) {
		return CommandNode.Callback(CommandContext, ...vecConvertedArgumentValues);
	}

	static SendMessage(CommandContext, strReplyMessage) {
		return LogInfo(String(strReplyMessage));
	}

	static GetCommandReturn() {
		return CommandReturn.Continue;
	}
}

class TypedServerCommandRegistration extends TypedCommandRegistration {
}

class TypedPlayerCommandRegistration extends TypedCommandRegistration {
	static RunCommand(CommandContext, CommandNode, vecConvertedArgumentValues) {
		if (!CommandNode.Permission || HasPlayerPermission(CommandContext.Index, CommandNode.Permission)) {
			return CommandNode.Callback(CommandContext, ...vecConvertedArgumentValues);
		}

		if (CommandNode.FailureCallback !== null) {
			return CommandNode.FailureCallback(CommandContext, ...vecConvertedArgumentValues);
		}

		if (this.SendMessage(CommandContext, `You are not authorized to use this command. Required permission: ${CommandNode.Permission}`) === false) {
			throw new Error("Unable to send the typed command authorization failure message.");
		}

		return CommandReturn.Continue;
	}
}

class TypedClientCommandRegistration extends TypedPlayerCommandRegistration {
	static SendMessage(CommandContext, strReplyMessage) {
		return SendClientConsoleMessage(CommandContext.Index, String(strReplyMessage));
	}

	static GetCommandReturn() {
		return CommandReturn.Block;
	}
}

class TypedSayCommandRegistration extends TypedPlayerCommandRegistration {
	static SendMessage(CommandContext, strReplyMessage) {
		return SendClientConsoleMessage(CommandContext.Index, String(strReplyMessage));
	}

	static GetCommandReturn(CommandContext) {
		return CommandContext.IsPrivateCommand() ? CommandReturn.Block : CommandReturn.Continue;
	}
}

TypedServerCommandRegistration.Parser = new TypedCommandParser();
TypedServerCommandRegistration.Manager = g_ServerCommandRegistrationManager;
TypedServerCommandRegistration.NativeRegistrations = new Map();
TypedServerCommandRegistration.CommandHandler = function HandleTypedServerCommand(CommandPayload) {
	return TypedServerCommandRegistration.HandleCommand(CommandPayload);
};

TypedClientCommandRegistration.Parser = new TypedCommandParser();
TypedClientCommandRegistration.Manager = g_ClientCommandRegistrationManager;
TypedClientCommandRegistration.NativeRegistrations = new Map();
TypedClientCommandRegistration.CommandHandler = function HandleTypedClientCommand(CommandPayload) {
	return TypedClientCommandRegistration.HandleCommand(CommandPayload);
};

TypedSayCommandRegistration.Parser = new TypedCommandParser();
TypedSayCommandRegistration.Manager = g_SayCommandRegistrationManager;
TypedSayCommandRegistration.NativeRegistrations = new Map();
TypedSayCommandRegistration.CommandHandler = function HandleTypedSayCommand(CommandPayload) {
	return TypedSayCommandRegistration.HandleCommand(CommandPayload);
};

function RegisterTypedServerCommand(CommandPath, RegistrationOptions = {}) {
	return new TypedServerCommandRegistration(CommandPath, RegistrationOptions);
}

function RegisterTypedClientCommand(CommandPath, RegistrationOptions = {}) {
	return new TypedClientCommandRegistration(CommandPath, RegistrationOptions);
}

function RegisterTypedSayCommand(CommandPath, RegistrationOptions = {}) {
	return new TypedSayCommandRegistration(CommandPath, RegistrationOptions);
}

module.exports = {
	ArgumentError: ArgumentError,
	ArgumentNumberMismatch: ArgumentNumberMismatch,
	CommandTreeNode: CommandTreeNode,
	CommandTreeStore: CommandTreeStore,
	InvalidArgumentValue: InvalidArgumentValue,
	PRIVATE_COMMAND_PREFIX: g_strPrivateCommandPrefix,
	SubCommandError: SubCommandError,
	SubCommandExpectedError: SubCommandExpectedError,
	SubCommandNotFound: SubCommandNotFound,
	TypedClientCommandRegistration: TypedClientCommandRegistration,
	TypedCommandContext: TypedCommandContext,
	TypedCommandNode: TypedCommandNode,
	TypedCommandParser: TypedCommandParser,
	TypedPlayerCommandRegistration: TypedPlayerCommandRegistration,
	TypedSayCommandRegistration: TypedSayCommandRegistration,
	TypedServerCommandRegistration: TypedServerCommandRegistration,
	ValidationError: ValidationError,
	FilterPlayers: FilterPlayers,
	RegisterTypedClientCommand: RegisterTypedClientCommand,
	RegisterTypedSayCommand: RegisterTypedSayCommand,
	RegisterTypedServerCommand: RegisterTypedServerCommand,
};
