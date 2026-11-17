"use strict";

const {
	AddParentParent,
	AddParentPermission,
	AddPlayerParent,
	AddPlayerPermission,
	HasPlayerPermission,
	Parents,
	Players,
	RemoveParentParent,
	RemoveParentPermission,
	RemovePlayerParent,
	RemovePlayerPermission,
} = require("auth");
const { CORE_COMMAND } = require("core/command");

const g_strModuleName = "core/command/auth";

function GrantPlayerPermission(Subject, strPermission) {
	const bPermissionGranted = AddPlayerPermission(Subject, strPermission);
	const strPermissionResultMessage = bPermissionGranted ? `Granted "${strPermission}" to "${Subject}".` : `Unable to grant "${strPermission}" to "${Subject}".`;
	CORE_COMMAND.LogCommandMessage(strPermissionResultMessage);

	return bPermissionGranted;
}

function RevokePlayerPermission(Subject, strPermission) {
	const bPermissionRevoked = RemovePlayerPermission(Subject, strPermission);
	const strPermissionResultMessage = bPermissionRevoked ? `Removed "${strPermission}" from "${Subject}".` : `Unable to remove "${strPermission}" from "${Subject}".`;
	CORE_COMMAND.LogCommandMessage(strPermissionResultMessage);

	return bPermissionRevoked;
}

function GrantParentPermission(strParentName, strPermission) {
	const bPermissionGranted = AddParentPermission(strParentName, strPermission);
	const strPermissionResultMessage = bPermissionGranted ? `Added "${strPermission}" to parent "${strParentName}".` : `Unable to add "${strPermission}" to parent "${strParentName}".`;
	CORE_COMMAND.LogCommandMessage(strPermissionResultMessage);

	return bPermissionGranted;
}

function RevokeParentPermission(strParentName, strPermission) {
	const bPermissionRevoked = RemoveParentPermission(strParentName, strPermission);
	const strPermissionResultMessage = bPermissionRevoked ? `Removed "${strPermission}" from parent "${strParentName}".` : `Unable to remove "${strPermission}" from parent "${strParentName}".`;
	CORE_COMMAND.LogCommandMessage(strPermissionResultMessage);

	return bPermissionRevoked;
}

function AddPlayerToParent(Subject, strParentName) {
	const bParentAdded = AddPlayerParent(Subject, strParentName);
	const strParentResultMessage = bParentAdded ? `Added parent "${strParentName}" to "${Subject}".` : `Unable to add parent "${strParentName}" to "${Subject}".`;
	CORE_COMMAND.LogCommandMessage(strParentResultMessage);

	return bParentAdded;
}

function RemovePlayerFromParent(Subject, strParentName) {
	const bParentRemoved = RemovePlayerParent(Subject, strParentName);
	const strParentResultMessage = bParentRemoved ? `Removed parent "${strParentName}" from "${Subject}".` : `Unable to remove parent "${strParentName}" from "${Subject}".`;
	CORE_COMMAND.LogCommandMessage(strParentResultMessage);

	return bParentRemoved;
}

function AddParentToParent(strParentName, strInheritedParentName) {
	const bInheritanceAdded = AddParentParent(strParentName, strInheritedParentName);
	const strInheritanceResultMessage = bInheritanceAdded ? `Added parent "${strInheritedParentName}" to parent "${strParentName}".` : `Unable to add parent "${strInheritedParentName}" to parent "${strParentName}".`;
	CORE_COMMAND.LogCommandMessage(strInheritanceResultMessage);

	return bInheritanceAdded;
}

function RemoveParentFromParent(strParentName, strInheritedParentName) {
	const bInheritanceRemoved = RemoveParentParent(strParentName, strInheritedParentName);
	const strInheritanceResultMessage = bInheritanceRemoved ? `Removed parent "${strInheritedParentName}" from parent "${strParentName}".` : `Unable to remove parent "${strInheritedParentName}" from parent "${strParentName}".`;
	CORE_COMMAND.LogCommandMessage(strInheritanceResultMessage);

	return bInheritanceRemoved;
}

function PrintAuthPlayers() {
	const PlayerPermissions = Players();
	const strPlayerPermissionsText = JSON.stringify(PlayerPermissions, null, "\t");
	CORE_COMMAND.LogCommandMessage(strPlayerPermissionsText);

	return PlayerPermissions;
}

function PrintAuthParents() {
	const ParentPermissions = Parents();
	const strParentPermissionsText = JSON.stringify(ParentPermissions, null, "\t");
	CORE_COMMAND.LogCommandMessage(strParentPermissionsText);

	return ParentPermissions;
}

function TestPermission(Subject, strPermission) {
	const bPermissionGranted = HasPlayerPermission(Subject, strPermission);
	const strPermissionResultText = bPermissionGranted ? "yes" : "no";
	const strPermissionResultMessage = `Permission "${strPermission}" for "${Subject}": ${strPermissionResultText}`;
	CORE_COMMAND.LogCommandMessage(strPermissionResultMessage);

	return bPermissionGranted;
}

function DispatchAuthenticationCommand(vecArguments) {
	const unPermissionOperandCount = 2;
	const unSplitSteam2OperandCount = 6;
	const [strRoot, strCategory, strSubjectKind, strAction, ...vecEngineOperands] = vecArguments;
	if ((strRoot === "auth") && (vecArguments.length === 1)) {
		CORE_COMMAND.PrintCommandHelp(["auth"]);
		return;
	}

	const bPlayer = strSubjectKind === "player";
	const bParent = strSubjectKind === "parent";
	const bListsRecords = strAction === "list";
	const bEditsRecords = (strAction === "add") || (strAction === "remove") || (strAction === "add_parent") || (strAction === "remove_parent");
	const bTestsPlayerPermission = bPlayer && (strAction === "test");
	const unExpectedOperands = bListsRecords ? 0 : unPermissionOperandCount;
	let vecOperands = vecEngineOperands;

	if (bPlayer && (unExpectedOperands === unPermissionOperandCount) && (vecEngineOperands.length === unSplitSteam2OperandCount)) {
		const [strUniverse, strFirstSeparator, strParity, strSecondSeparator, strAccount, strPermission] = vecEngineOperands;
		// Some Source branches tokenize an unquoted Steam2 ID at the colons.
		if (/^STEAM_\d+$/.test(strUniverse) && (strFirstSeparator === ":") && /^[01]$/.test(strParity) && (strSecondSeparator === ":") && /^\d+$/.test(strAccount)) {
			vecOperands = [`${strUniverse}:${strParity}:${strAccount}`, strPermission];
		}
	}

	const IsNonempty = (strOperand) => (typeof strOperand === "string") && (strOperand.trim().length > 0);
	if ((strRoot !== "auth") || (strCategory !== "permission") || !(bPlayer || bParent) || !(bListsRecords || bEditsRecords || bTestsPlayerPermission) || (vecOperands.length !== unExpectedOperands) || !vecOperands.every(IsNonempty)) {
		CORE_COMMAND.LogCommandWarning("Invalid authorization command. Use sjs auth to list commands.");
		return;
	}

	CORE_COMMAND.RunCommand([strRoot, strCategory, strSubjectKind, strAction, ...vecOperands]);
}

CORE_COMMAND.RegisterCommand(["auth", "permission", "player", "add"], function GrantPlayerPermissionCommand(CommandContext) {
	const [strPlayerSubject, strPermissionName] = CommandContext.CommandArguments;

	return GrantPlayerPermission(strPlayerSubject, strPermissionName);
}, { Description: "Grant a permission to a player identity." });
CORE_COMMAND.RegisterCommand(["auth", "permission", "player", "remove"], function RevokePlayerPermissionCommand(CommandContext) {
	const [strPlayerSubject, strPermissionName] = CommandContext.CommandArguments;

	return RevokePlayerPermission(strPlayerSubject, strPermissionName);
}, { Description: "Remove a permission from a player identity." });
CORE_COMMAND.RegisterCommand(["auth", "permission", "player", "add_parent"], function AddPlayerToParentCommand(CommandContext) {
	const [strPlayerSubject, strParentName] = CommandContext.CommandArguments;

	return AddPlayerToParent(strPlayerSubject, strParentName);
}, { Description: "Add a parent to a player identity." });
CORE_COMMAND.RegisterCommand(["auth", "permission", "player", "remove_parent"], function RemovePlayerFromParentCommand(CommandContext) {
	const [strPlayerSubject, strParentName] = CommandContext.CommandArguments;

	return RemovePlayerFromParent(strPlayerSubject, strParentName);
}, { Description: "Remove a parent from a player identity." });
CORE_COMMAND.RegisterCommand(["auth", "permission", "player", "test"], function TestPlayerPermissionCommand(CommandContext) {
	const [strPlayerSubject, strPermissionName] = CommandContext.CommandArguments;

	return TestPermission(strPlayerSubject, strPermissionName);
}, { Description: "Test a player permission." });
CORE_COMMAND.RegisterCommand(["auth", "permission", "player", "list"], PrintAuthPlayers, { Description: "List player permissions." });
CORE_COMMAND.RegisterCommand(["auth", "permission", "parent", "add"], function GrantParentPermissionCommand(CommandContext) {
	const [strParentName, strPermissionName] = CommandContext.CommandArguments;

	return GrantParentPermission(strParentName, strPermissionName);
}, { Description: "Grant a permission to a parent." });
CORE_COMMAND.RegisterCommand(["auth", "permission", "parent", "remove"], function RevokeParentPermissionCommand(CommandContext) {
	const [strParentName, strPermissionName] = CommandContext.CommandArguments;

	return RevokeParentPermission(strParentName, strPermissionName);
}, { Description: "Remove a permission from a parent." });
CORE_COMMAND.RegisterCommand(["auth", "permission", "parent", "add_parent"], function AddParentToParentCommand(CommandContext) {
	const [strParentName, strInheritedParentName] = CommandContext.CommandArguments;

	return AddParentToParent(strParentName, strInheritedParentName);
}, { Description: "Add an inherited parent." });
CORE_COMMAND.RegisterCommand(["auth", "permission", "parent", "remove_parent"], function RemoveParentFromParentCommand(CommandContext) {
	const [strParentName, strInheritedParentName] = CommandContext.CommandArguments;

	return RemoveParentFromParent(strParentName, strInheritedParentName);
}, { Description: "Remove an inherited parent." });
CORE_COMMAND.RegisterCommand(["auth", "permission", "parent", "list"], PrintAuthParents, { Description: "List parent permissions." });

module.exports = {
	MODULE_NAME: g_strModuleName,
	AddParentToParent,
	AddPlayerToParent,
	GrantParentPermission,
	GrantPlayerPermission,
	PrintAuthParents,
	PrintAuthPlayers,
	RemoveParentFromParent,
	RemovePlayerFromParent,
	RevokeParentPermission,
	RevokePlayerPermission,
	TestPermission,
	DispatchAuthenticationCommand,
};
