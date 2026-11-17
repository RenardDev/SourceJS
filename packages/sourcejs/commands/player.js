"use strict";

const { CreateAuthorizedCommandCallback } = require("commands/auth");
const { CommandRegistrationManager } = require("commands/manager");

class PlayerCommandRegistrationManager extends CommandRegistrationManager {
	Register(CommandNameOrNames, CommandCallback, strRequiredPermission = null, AuthorizationFailureCallback = null) {
		return super.Register(CommandNameOrNames, CreateAuthorizedCommandCallback(CommandCallback, strRequiredPermission, AuthorizationFailureCallback));
	}
}

module.exports = {
	PlayerCommandRegistrationManager: PlayerCommandRegistrationManager,
};
