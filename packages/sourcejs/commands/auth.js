"use strict";

const { HasPlayerPermission } = require("auth");
const { CommandReturn } = require("commands");

function CreateAuthorizedCommandCallback(Callback, strPermission = null, FailCallback = null) {
	if (typeof Callback !== "function") {
		throw new TypeError("Authorized command callback must be a function.");
	}

	if ((FailCallback !== null) && (typeof FailCallback !== "function")) {
		throw new TypeError("Authorized command failure callback must be a function or null.");
	}

	function AuthorizedCommandCallback(Command) {
		const nCommandIndex = Command.Index;
		if ((strPermission === null) || HasPlayerPermission(nCommandIndex, strPermission)) {
			return Callback(Command);
		}

		if (FailCallback !== null) {
			return FailCallback(Command);
		}

		return CommandReturn.Continue;
	}

	AuthorizedCommandCallback.Callback = Callback;
	AuthorizedCommandCallback.Permission = strPermission;
	AuthorizedCommandCallback.FailCallback = FailCallback;

	return AuthorizedCommandCallback;
}

module.exports = {
	CreateAuthorizedCommandCallback: CreateAuthorizedCommandCallback,
};
