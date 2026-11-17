"use strict";

const { SteamID } = require("steam");
const { DefineCommand, Reply } = require("./administration");
const { RunSQLAuthorizationRequest } = require("./sql-authorization");
const { CommandFailure, CommandUsage, Phrase } = require("./translations");

function RequirePlayerIdentifier(strSteamID) {
	if ((typeof strSteamID !== "string") || !/^(?:STEAM_\d+:[01]:\d+|\d{17,20})$/i.test(strSteamID)) {
		throw CommandFailure("InvalidInput", "Specify a Steam2 or SteamID64 identifier.");
	}

	const unSteamID = SteamID.Parse(strSteamID).ConvertSteamIDToUInt64();
	if ((typeof unSteamID !== "bigint") || (unSteamID <= 0n)) {
		throw CommandFailure("InvalidInput", "Invalid Steam identifier.");
	}

	return unSteamID.toString();
}

function RequireGroupName(strName) {
	if ((typeof strName !== "string") || !/^[a-z0-9_-]{1,64}$/i.test(strName)) {
		throw CommandFailure("InvalidInput", "An authorization group name must contain 1–64 letters, digits, underscores or hyphens.");
	}

	return strName;
}

function RequirePermissionName(strPermission) {
	if ((typeof strPermission !== "string") || !/^sourcejs\.[a-z0-9.*_-]{1,120}$/.test(strPermission)) {
		throw CommandFailure("InvalidInput", "Specify a SourceJS permission such as sourcejs.kick.");
	}

	return strPermission;
}

function DefineSQLCommand(strName, strUsage, Prepare) {
	DefineCommand(strName, null, strUsage, (unClientIndex, vecArguments) => {
		const Mutate = Prepare(vecArguments);
		RunSQLAuthorizationRequest(Mutate, (Failure, bChanged) => {
			if (Failure !== null) {
				Reply(unClientIndex, Phrase("SQLFailed", "SQL administrator operation failed. Verify database access and group names."));
				return;
			}

			Reply(unClientIndex, bChanged ? Phrase("SQLUpdated", "SQL administrator permissions updated.") : Phrase("SQLNotFound", "No matching SQL administrator record."));
		});
	}, true);
}

function DefineSQLSchemaCommand(strName, MaintainSchema, strSuccessMessage) {
	DefineCommand(strName, null, "", (unClientIndex, vecArguments) => {
		if (vecArguments.length !== 0) {
			throw CommandUsage(`sjs_${strName}`);
		}

		RunSQLAuthorizationRequest(MaintainSchema, (Failure) => {
			Reply(unClientIndex, (Failure === null) ? Phrase("SQLSchemaReady", strSuccessMessage) : Phrase("SQLFailed", "SQL administrator schema maintenance failed. Verify database access and schema compatibility."));
		});
	}, true);
}

function RegisterSQLAdministrationCommands() {
	DefineSQLSchemaCommand("create_adm_tables", (Backend, Options, Callback) => Backend.CreateSchema(Options, Callback), "SourceJS administrator tables are ready.");
	DefineSQLSchemaCommand("update_adm_tables", (Backend, Options, Callback) => Backend.UpdateSQLiteSchema(Options, Callback), "SourceJS administrator schema is up to date.");
	DefineSQLCommand("sql_reload", "", () => null);
	DefineSQLCommand("sql_addadmin", "<Steam ID> [groups...]", (vecArguments) => {
		const [strSteamID, ...vecGroupArguments] = vecArguments;
		const strPlayerID = RequirePlayerIdentifier(strSteamID);
		const vecGroups = vecGroupArguments.map(RequireGroupName);
		if (vecGroups.length === 0) {
			return (Backend, Options, Callback) => Backend.CreateAuthorizationObject(strPlayerID, "Player", Options, Callback);
		}

		return (Backend, Options, Callback) => Backend.ReplacePlayerParents(strPlayerID, vecGroups, Options, Callback);
	});
	DefineSQLCommand("sql_deladmin", "<Steam ID>", (vecArguments) => {
		const strPlayerID = RequirePlayerIdentifier(vecArguments[0]);

		return (Backend, Options, Callback) => Backend.DeleteAuthorizationObject(strPlayerID, "Player", Options, Callback);
	});
	DefineSQLCommand("sql_addgroup", "<group> [permission]", (vecArguments) => {
		const strGroupName = RequireGroupName(vecArguments[0]);
		if (vecArguments.length > 1) {
			const strPermission = RequirePermissionName(vecArguments[1]);
			return (Backend, Options, Callback) => Backend.AddParentPermission(strGroupName, strPermission, -1, Options, Callback);
		}

		return (Backend, Options, Callback) => Backend.CreateAuthorizationObject(strGroupName, "Parent", Options, Callback);
	});
	DefineSQLCommand("sql_delgroup", "<group>", (vecArguments) => {
		const strGroupName = RequireGroupName(vecArguments[0]);

		return (Backend, Options, Callback) => Backend.DeleteAuthorizationObject(strGroupName, "Parent", Options, Callback);
	});
	DefineSQLCommand("sql_setadmingroups", "<Steam ID> [groups...]", (vecArguments) => {
		const [strSteamID, ...vecGroupArguments] = vecArguments;
		const strPlayerID = RequirePlayerIdentifier(strSteamID);
		const vecGroups = vecGroupArguments.map(RequireGroupName);

		return (Backend, Options, Callback) => Backend.ReplacePlayerParents(strPlayerID, vecGroups, Options, Callback);
	});
}

module.exports = { RegisterSQLAdministrationCommands };
