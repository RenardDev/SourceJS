"use strict";

const { GetModule } = require("internal/runtime");
const { Backend } = require("auth/index");
const { SQLBackend } = require("auth/backends/sql");

const g_AuthorizationRuntime = GetModule("auth");
Object.defineProperties(g_AuthorizationRuntime, {
	Backend: {
		enumerable: true,
		value: Backend,
	},
	SQLBackend: {
		enumerable: true,
		value: SQLBackend,
	},
});

module.exports = g_AuthorizationRuntime;
