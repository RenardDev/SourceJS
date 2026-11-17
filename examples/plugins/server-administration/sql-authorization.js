"use strict";

const { SQLBackend } = require("auth/backends/sql");
const { AuthManager } = require("auth/manager");
const { LogWarning } = require("core/logger");
const { CreateConVar } = require("cvars");
const { CommandFailure } = require("./translations");

const g_SQLRequestOptions = Object.freeze({ Blocking: false });
let g_SQLAuthorizationOption = null;
let g_SQLManager = null;
let g_SQLBackend = null;
let g_bSQLReady = false;
let g_bSQLBusy = false;

function IsSQLAuthorizationEnabled() {
	return Number(g_SQLAuthorizationOption?.Value) === 1;
}

function ConfigureSQLAuthorization() {
	g_SQLAuthorizationOption = CreateConVar("sjs_sql_admin_enabled", "0", "Use the optional SQL administrator database for bundled commands.", 0, 0, 1);
}

function AllowsSQLPermission(unClientIndex, strPermission) {
	return IsSQLAuthorizationEnabled() && g_bSQLReady && !g_bSQLBusy && g_SQLManager.IsPlayerAuthorized(unClientIndex, strPermission);
}

function AllowsSQLIdentityPermission(unSteamID64, strPermission) {
	if (!IsSQLAuthorizationEnabled()) {
		return false;
	}

	if (!g_bSQLReady || g_bSQLBusy) {
		throw CommandFailure("SQLUnavailable", "Offline ban permissions cannot be verified while SQL authorization is unavailable.");
	}

	return g_SQLManager.Players.get(unSteamID64.toString())?.HasPermission(strPermission) ?? false;
}

function RunSQLAuthorizationRequest(Mutate, Callback) {
	if (!IsSQLAuthorizationEnabled()) {
		throw CommandFailure("SQLDisabled", "SQL administration is disabled. Set sjs_sql_admin_enabled to 1 first.");
	}

	if (g_bSQLBusy) {
		throw CommandFailure("SQLBusy", "The SQL administrator database is busy. Try again after the current operation.");
	}

	if (!g_SQLBackend) {
		g_SQLManager = new AuthManager();
		g_SQLBackend = g_SQLManager.AddBackend(new SQLBackend({ Manager: g_SQLManager }));
	}

	g_bSQLBusy = true;
	let bCompleted = false;
	const Complete = (Failure, Result) => {
		bCompleted = true;
		g_bSQLBusy = false;
		g_bSQLReady = Failure === null;
		Callback(Failure, Result);
	};
	const Dispatch = (Submit) => {
		try {
			Submit();
		} catch (Failure) {
			if (bCompleted) {
				throw Failure;
			}

			Complete(Failure);
		}
	};
	const Execute = () => {
		if (!Mutate) {
			g_SQLManager.Synchronize(g_SQLRequestOptions, (Failure) => Complete(Failure, true));
			return;
		}

		Mutate(g_SQLBackend, g_SQLRequestOptions, (MutationError, Result) => {
			if (MutationError !== null) {
				Complete(MutationError);
				return;
			}

			Dispatch(() => g_SQLManager.Synchronize(g_SQLRequestOptions, (RefreshError) => Complete(RefreshError, Result)));
		});
	};

	Dispatch(() => {
		if (g_SQLManager.IsBackendLoaded(g_SQLBackend.Name)) {
			Execute();
		} else {
			g_SQLManager.SetActiveBackend(g_SQLBackend.Name, g_SQLRequestOptions, (LoadError) => {
				if ((LoadError !== null) || !Mutate) {
					Complete(LoadError, LoadError === null);
					return;
				}

				Dispatch(Execute);
			});
		}
	});
}

function RefreshSQLAuthorizationOnMap() {
	if (!IsSQLAuthorizationEnabled() || g_bSQLBusy) {
		return;
	}

	RunSQLAuthorizationRequest(null, (Failure) => {
		if (Failure) {
			LogWarning("SQL administrator permissions could not be loaded.");
		}
	});
}

function CloseSQLAuthorization() {
	g_bSQLReady = false;

	if (g_SQLBackend && !g_bSQLBusy) {
		g_SQLBackend.Unload({ Blocking: true }, (Failure) => {
			if (Failure) {
				LogWarning("Could not close the SQL administrator database.");
			}
		});
	}
}

module.exports = {
	IsSQLAuthorizationEnabled,
	ConfigureSQLAuthorization,
	AllowsSQLPermission,
	AllowsSQLIdentityPermission,
	RunSQLAuthorizationRequest,
	RefreshSQLAuthorizationOnMap,
	CloseSQLAuthorization,
};
